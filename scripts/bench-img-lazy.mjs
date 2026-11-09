// v0.188 `patchImgXml` 惰性遍历基准。
//
// 改前：`[...xml.matchAll(/<w:drawing>…/g)]` 物化一个「每项都是整块 XML」的数组；
// 改后：产品路径直接用惰性迭代器边走边拼，计数闸门移到末尾。
// `legacyBlockScan:true` 是物化数组的对照腿，两腿同源只差一个参数。
//
// 判据：① 逐部件字符串归一后逐字相同；② 同进程交替顺序各 10 样本取中位；
// ③ 端到端若被 XML 解析/序列化盖住，另给「只比遍历本身」的纯函数段确定判据。
//
// 跑法：npx vite-node scripts/bench-img-lazy.mjs

import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, pageSetupOf, prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ROUNDS = 10
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

const z = new JSZip()
for (const [p, c] of fixtureParts()) z.file(p, c)
const srcBytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
const fid = await docxToHtmlFidelity(srcBytes)
const meta = await docxToDocMeta(srcBytes)
const merged = {
  ...meta,
  ...(fid.styles?.length ? { styles: fid.styles } : {}),
  ...(fid.numbering ? { numbering: fid.numbering } : {}),
  ...(fid.section ? { page: { ...meta.page, ...pageSetupOf(fid.section) } } : {}),
}
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pmDoc = PMDOMParser.fromSchema(getSchema(docExtensions())).parse(document.body).toJSON()

function normalizePart(name, text) {
  if (name === 'docProps/core.xml') return text.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g, '$1TS$2')
  return text.replace(/\brId(?=[0-9]*[A-Za-z_-])[A-Za-z0-9_-]+/g, 'rIdRAND')
}
async function partsSignature(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()
  const out = []
  for (const n of names) out.push(`${n}\u0000${normalizePart(n, await zip.file(n).async('string'))}`)
  return out.join('\u0001')
}

const legs = [
  { name: '改前（物化整块数组）', fn: () => prosemirrorToDocxBytes(pmDoc, merged, { legacyBlockScan: true }) },
  { name: '本轮（惰性迭代器）', fn: () => prosemirrorToDocxBytes(pmDoc, merged) },
]

console.log('端到端（完整写出链，夹具含 5 张图片壳）')
const A = await partsSignature(await legs[0].fn())
const B = await partsSignature(await legs[1].fn())
const same = A === B
console.log(`语义等价（逐部件字符串归一）：${same ? '✓ 逐字相同' : '✗ 不同'}`)
if (!same) {
  let i = 0
  while (i < Math.min(A.length, B.length) && A[i] === B[i]) i++
  console.log('   首个差异：', JSON.stringify(A.slice(i - 80, i + 160)), '/', JSON.stringify(B.slice(i - 80, i + 160)))
  process.exitCode = 1
}
for (const l of legs) { await l.fn(); await l.fn() }
const times = legs.map(() => [])
for (let r = 0; r < ROUNDS; r++) {
  for (const i of (r % 2 === 0 ? [0, 1, 1, 0] : [1, 0, 0, 1])) {
    const t = performance.now()
    await legs[i].fn()
    times[i].push(performance.now() - t)
  }
}
const ma = median(times[0]), mb = median(times[1])
console.log(`${ma.toFixed(1)} → ${mb.toFixed(1)}ms  降幅 ${(((ma - mb) / ma) * 100).toFixed(1)}%（小夹具，噪声内属正常）`)

// ---- 纯函数段：只比「把整块 XML 收进数组」这一件事 --------------------------
const drawing = (i) =>
  `<w:drawing><wp:inline distT="0" distB="0"><wp:extent cx="914400" cy="914400"/>` +
  `<wp:docPr id="${i}" name="图片 ${i}" descr="画布级替代文本"/>` +
  `<a:graphic><a:graphicData><pic:pic><pic:spPr><a:xfrm><a:off x="0" y="0"/>` +
  `<a:ext cx="1000" cy="1000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
  `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
const RE = /<w:drawing>[\s\S]*?<\/w:drawing>/g

/** 物化腿：数组装下每一块，再逐块滚 hash */
const materialized = (xml) => {
  const blocks = [...xml.matchAll(RE)]
  let h = 0
  for (const m of blocks) for (let j = 0; j < m[0].length; j++) h = Math.imul(h ^ m[0].charCodeAt(j), 16777619)
  return { h, n: blocks.length }
}
/** 惰性腿：边走边滚 hash，不建数组 */
const lazy = (xml) => {
  let h = 0
  let n = 0
  for (const m of xml.matchAll(RE)) {
    n++
    for (let j = 0; j < m[0].length; j++) h = Math.imul(h ^ m[0].charCodeAt(j), 16777619)
  }
  return { h, n }
}

console.log('\n纯函数段（同一份 document.xml，物化数组 vs 惰性遍历）')
for (const [drawings, reps] of [[50, 300], [500, 60], [2000, 20]]) {
  const xml = Array.from({ length: drawings }, (_, i) => drawing(i)).join('<w:p/>')
  const a = materialized(xml), b = lazy(xml)
  if (a.h !== b.h || a.n !== b.n) {
    console.log(`  结果不等价！${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
    process.exitCode = 1
    continue
  }
  const run = (fn) => { let sink = 0; for (let i = 0; i < reps; i++) sink = (sink + fn(xml).h) | 0; return sink }
  for (const fn of [materialized, lazy]) { run(fn); run(fn) }
  const t0 = [], t1 = []
  for (let r = 0; r < 20; r++) {
    let t = performance.now(); run(materialized); t0.push(performance.now() - t)
    t = performance.now(); run(lazy); t1.push(performance.now() - t)
    t = performance.now(); run(lazy); t1.push(performance.now() - t)
    t = performance.now(); run(materialized); t0.push(performance.now() - t)
  }
  const m0 = median(t0), m1 = median(t1)
  console.log(`${String(drawings).padStart(4)} drawing × ${String(reps).padStart(3)} 趟  ` +
    `${m0.toFixed(1)} → ${m1.toFixed(1)}ms  降幅 ${(((m0 - m1) / m0) * 100).toFixed(1)}%  ` +
    `| 块数与 hash 一致 ✓`)
}
