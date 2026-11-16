// v0.192 断言：`patchElemAttrs` 物化开标签数组 → 惰性迭代。
//
// v0.188–v0.191 陆续收掉 patchImgXml / patchNumOverrides / patchBorderBlocks /
// pptx 表格的物化，这一处是写手补丁链里最后一类「先数一遍再逐块改」的
// `[...xml.matchAll(...)]`。计数闸门从循环前移到循环末尾（不符就整笔丢弃、
// 已拼的局部串不写盘），`legacyElemScan:true` 复刻改前路径供 A/B。
//
// 跑法：npx vite-node scripts/test-elem-scan.mjs

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
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

function normalizePart(name, text) {
  if (name === 'docProps/core.xml') return text.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g, '$1TS$2')
  return text.replace(/\brId(?=[0-9]*[A-Za-z_-])[A-Za-z0-9_-]+/g, 'rIdRAND')
}

async function main() {
  const z = new JSZip()
  for (const [p, c] of fixtureParts()) z.file(p, c)
  const bytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
  const fid = await docxToHtmlFidelity(bytes)
  const meta = await docxToDocMeta(bytes)
  const merged = {
    ...meta,
    ...(fid.styles?.length ? { styles: fid.styles } : {}),
    ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.section ? { page: { ...meta.page, ...pageSetupOf(fid.section) } } : {}),
    ...(fid.background ? { background: fid.background } : {}),
    ...(fid.comments.length ? { comments: fid.comments } : {}),
  }
  const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
  const pmDoc = PMDOMParser.fromSchema(getSchema(docExtensions())).parse(document.body).toJSON()
  const full = async (legacy) => {
    const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged, { legacyElemScan: legacy }))
    const names = Object.keys(out.files).filter((n) => !out.files[n].dir).sort()
    const rows = []
    for (const n of names) rows.push(`${n}\u0000${normalizePart(n, await out.file(n).async('string'))}`)
    return rows.join('\u0001')
  }
  const a = await full(true), b = await full(false)
  check('两腿逐部件字符串归一后逐字相同', a === b, a === b ? '' : `长度 ${a.length} vs ${b.length}`)
  check('夹具非空（确实走到写手补丁链）', b.includes('word/document.xml') && b.includes('<w:color'))

  const w = read('../src/lib/docx.ts')
  const fnBody = (from) => {
    const s = w.indexOf(from)
    return w.slice(s, w.indexOf('\n}\n', s))
  }
  const elem = fnBody('async function patchElemAttrs')
  check('惰性腿直接吃迭代器', /const opens: Iterable<RegExpMatchArray> = legacyElemScan \? \[\.\.\.xml\.matchAll\(re\)\] : xml\.matchAll\(re\)/.test(elem))
  check('计数闸门移到循环末尾', elem.indexOf('if (count !== extras.length) return bytes') > elem.indexOf('touched = true'))
  check('闸门在写盘之前', elem.indexOf('if (count !== extras.length) return bytes') < elem.indexOf('setPart('))
  check('载荷按 count 取', /const add = extras\[count\+\+\]/.test(elem))
  check('循环内不再有下标数组访问', !/opens\[i\]/.test(elem))
  check('入口有独立开关', /legacyElemScan\?: boolean/.test(w) && /legacyElemScan = !!opts\?\.legacyElemScan/.test(w))
  check('模块级单变量', /^let legacyElemScan = false$/m.test(w))
  check('与其它对照腿互不干扰（各自一个开关）',
    /^let legacyBlockScan = false$/m.test(w) && /^let legacyEdgeScan = false$/m.test(w))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
