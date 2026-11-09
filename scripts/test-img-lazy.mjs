// v0.188 `patchImgXml` 惰性遍历断言。
//
// 改前：`[...xml.matchAll(/<w:drawing>…/g)]` 把每个整块 XML 都收进一个数组，
// 只为「数够不够」再逐块改。改后：产品路径直接用惰性迭代器边走边拼，
// 计数闸门移到末尾（块数对不上就丢弃已算结果，语义等价）。
// `legacyBlockScan:true` 是物化数组的对照腿，两腿同源只差这一个参数。
//
// 跑法：npx vite-node scripts/test-img-lazy.mjs

import fs from 'node:fs'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, pageSetupOf, prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. 源码级纪律 ----------------------------------------------------------
{
  const w = read('../src/lib/docx.ts')
  const at = w.indexOf('async function patchImgXml(')
  const body = w.slice(at, w.indexOf('\n/**', at))
  check('入口 opts 多一枚 legacyBlockScan', /legacyBlockScan\?: boolean/.test(w) && /legacyBlockScan = !!opts\?\.legacyBlockScan/.test(w))
  check('产品路径用惰性 matchAll', /: xml\.matchAll\(DRAWING_RE\)/.test(body))
  check('对照腿才物化数组', /legacyBlockScan\s*\?\s*\[\.\.\.xml\.matchAll\(DRAWING_RE\)\]/.test(body))
  check('计数闸门移到末尾且先判块数', /if \(i !== shells\.length\) return bytes/.test(body))
  check('闸门在 setPart 之前（不匹配就不写回）',
    body.indexOf('if (i !== shells.length) return bytes') < body.indexOf("setPart(zip, 'word/document.xml', out, sess)"))
  check('循环体不再引用 blocks 数组', !/\bblocks\b/.test(body))
  check('越界取载荷不崩（空串占位）', /shells\[i\] \?\? ''/.test(body))
}

// ---- 2. 两腿遍历结果逐字相同 ------------------------------------------------
{
  const xml = Array.from({ length: 12 }, (_, i) =>
    `<w:drawing><wp:inline distT="0"><wp:docPr id="${i}" name="图 ${i}"/></wp:inline></w:drawing>`).join('<w:p/>')
  const RE = /<w:drawing>[\s\S]*?<\/w:drawing>/g
  const materialized = [...xml.matchAll(RE)].map((m) => m[0])
  const lazy = []
  for (const m of xml.matchAll(RE)) lazy.push(m[0]) // 惰性：不建中间数组
  eq('块数一致', materialized.length, lazy.length)
  eq('每块逐字相同', materialized.join('|'), lazy.join('|'))
  eq('空 XML 两腿都是零块', [...''.matchAll(RE)].length, 0)
}

// ---- 3. 产品入口两腿：逐部件归一后逐字相同 ----------------------------------
{
  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  const bytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const fid = await docxToHtmlFidelity(bytes)
  const meta = await docxToDocMeta(bytes)
  const merged = {
    ...meta,
    ...(fid.styles?.length ? { styles: fid.styles } : {}),
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.section ? { page: { ...meta.page, ...pageSetupOf(fid.section) } } : {}),
  }
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pmDoc = PMDOMParser.fromSchema(getSchema(docExtensions())).parse(document.body).toJSON()
  const partsSig = async (opts) => {
    const zip = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged, opts))
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()
    const out = []
    for (const n of names) {
      const text = await zip.file(n).async('string')
      const clean = n === 'docProps/core.xml'
        ? text.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g, '$1TS$2')
        : text.replace(/\brId(?=[0-9]*[A-Za-z_-])[A-Za-z0-9_-]+/g, 'rIdRAND')
      out.push(`${n}\u0000${clean}`)
    }
    return out.join('\u0001')
  }
  eq('产品入口：物化腿与惰性腿逐部件字符串归一后逐字相同',
    await partsSig(), await partsSig({ legacyBlockScan: true }))
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
