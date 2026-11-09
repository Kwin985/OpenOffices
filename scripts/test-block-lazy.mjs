// v0.189 断言：写手补丁链最后两处 `[...matchAll]` 物化改惰性迭代。
//
// v0.188 只改了最热的 patchImgXml；本轮收掉 patchNumOverrides 与
// patchBorderBlocks，三处共用 `legacyBlockScan` 一个 A/B 对照腿开关。
// 改法与语义：① 迭代边走边拼；② patchNumOverrides 够数即停；
// ③ patchBorderBlocks 的块数闸门从循环前移到循环末尾（不符就整笔丢弃、不写盘）。
//
// 跑法：npx vite-node scripts/test-block-lazy.mjs

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
  // 与 scripts/bench-img-lazy.mjs 同一把尺子：时间戳与随机 rId 都不进判据
  return text.replace(/\brId(?=[0-9]*[A-Za-z_-])[A-Za-z0-9_-]+/g, 'rIdRAND')
}

async function main() {
  const w = read('../src/lib/docx.ts')
  // 按「顶格 } 收尾」切出单个函数体，避免把后面别的补丁一起算进来
  const fnBody = (from) => {
    const s = w.indexOf(from)
    return w.slice(s, w.indexOf('\n}\n', s))
  }

  // ── ① 源码级：三处同款、产品路径惰性 ─────────────────────────────
  check('入口只有一个对照腿开关', /legacyBlockScan = !!opts\?\.legacyBlockScan/.test(w))
  check('开关是模块级单变量（三处共用）', /^let legacyBlockScan = false$/m.test(w))
  const num = fnBody('export async function patchNumOverrides')
  const bdr = fnBody('async function patchBorderBlocks')
  const img = fnBody('async function patchImgXml')
  check('patchNumOverrides 惰性腿直接吃迭代器', /const blocks: Iterable<RegExpMatchArray> = legacyBlockScan \? \[\.\.\.xml\.matchAll\(re\)\] : xml\.matchAll\(re\)/.test(num))
  check('patchNumOverrides 够数即停', /if \(i >= starts\.length\) break/.test(num))
  check('patchNumOverrides 不再是下标循环', !/for \(let i = 0; i < blocks\.length/.test(num))
  check('patchBorderBlocks 惰性腿直接吃迭代器', /const blocks: Iterable<RegExpMatchArray> = legacyBlockScan \? \[\.\.\.xml\.matchAll\(re\)\] : xml\.matchAll\(re\)/.test(bdr))
  check('patchBorderBlocks 载荷按 count 取', /const add = extras\[count\+\+\]/.test(bdr))
  check('块数闸门移到循环末尾', /if \(count !== extras\.length\) return bytes/.test(bdr)
    && bdr.indexOf('if (count !== extras.length) return bytes') > bdr.indexOf('touched = true'))
  check('闸门在写盘之前', bdr.indexOf('if (count !== extras.length) return bytes') < bdr.indexOf('setPart('))
  check('v0.188 的 patchImgXml 也由同一开关控制', /legacyBlockScan/.test(img))
  check('这两处函数体内只剩对照腿一处物化',
    (num.match(/\[\.\.\.xml\.matchAll\(/g) ?? []).length === 1
      && (bdr.match(/\[\.\.\.xml\.matchAll\(/g) ?? []).length === 1)
  check('循环内按边名编译的 edgeRe 仍在（顺延，不冒充收干净）', /const edgeRe = new RegExp/.test(bdr))

  // ── ② 端到端：两腿逐部件字符串归一后逐字相同 ─────────────────────
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
  // 逐部件异步读文本后比字符串（不拿压缩尺寸或长度和当判据，会假绿）
  const full = async (legacy) => {
    const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged, { legacyBlockScan: legacy }))
    const names = Object.keys(out.files).filter((n) => !out.files[n].dir).sort()
    const rows = []
    for (const n of names) rows.push(`${n}\u0000${normalizePart(n, await out.file(n).async('string'))}`)
    return rows.join('\u0001')
  }
  const a = await full(true), b = await full(false)
  check('两腿逐部件字符串归一后逐字相同', a === b, a === b ? '' : `长度 ${a.length} vs ${b.length}`)
  check('两腿都有部件产出（非空夹具）', a.includes('word/document.xml') && a.includes('word/numbering.xml'))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
