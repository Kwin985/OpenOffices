// v0.190 基准：`patchBorderBlocks` 循环内按边名编译的 edgeRe → 字符串定位。
//
// 判据：① 逐部件字符串归一后逐字相同；② 同进程交替顺序各 10 样本取中位；
// ③ 纯函数段用逐字符 hash 对撞（只累加长度会假绿）；端到端被 XML 解析/
// 序列化盖住时如实写「噪声内」，不拿纯函数段冒充整链收益。
//
// 跑法：npx vite-node scripts/bench-edge-scan.mjs

import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import { docxToDocMeta, findEdgeTag, pageSetupOf, prosemirrorToDocxBytes } from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ROUNDS = 10
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const hashStr = (s, h) => { for (let j = 0; j < s.length; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619); return h | 0 }

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

function normalizePart(name, text) {
  if (name === 'docProps/core.xml') return text.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g, '$1TS$2')
  return text.replace(/\brId(?=[0-9]*[A-Za-z_-])[A-Za-z0-9_-]+/g, 'rIdRAND')
}
async function partsSignature(b) {
  const zip = await JSZip.loadAsync(b)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()
  const out = []
  for (const n of names) out.push(`${n}\u0000${normalizePart(n, await zip.file(n).async('string'))}`)
  return out.join('\u0001')
}

const legs = [
  { name: '改前（循环内 new RegExp）', fn: () => prosemirrorToDocxBytes(pmDoc, merged, { legacyEdgeScan: true }) },
  { name: '本轮（findEdgeTag 字符串定位）', fn: () => prosemirrorToDocxBytes(pmDoc, merged) },
]

console.log('端到端（完整写出链）')
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

// ---- 纯函数段：只比「按边名定位第一枚标签」这一件事 --------------------------
const EDGES = ['top', 'left', 'bottom', 'right']
const block = (i) => `<w:pBdr><w:top w:val="single" w:sz="${i % 9}"/>` +
  `<w:left w:val="dashed" w:color="112233"/><w:bottom w:val="dotted"/>` +
  `<w:right w:val="double" w:space="2"/></w:pBdr>`

/** 改前：每块每边编译一枚正则，命中后 String.replace 合并属性 */
const legacyScan = (xml) => {
  let h = 2166136261
  for (const edge of EDGES) {
    const re = new RegExp(`<w:${edge}(?=[\\s/>])[^>]*>`)
    const m = re.exec(xml)
    if (!m) continue
    const mergedTag = `${m[0].slice(0, -1)} w:color="AABBCC">`
    h = hashStr(xml.slice(0, m.index) + mergedTag + xml.slice(m.index + m[0].length), h)
  }
  return h
}
/** 本轮：字符串定位 + slice 拼接，零动态正则 */
const fastScan = (xml) => {
  let h = 2166136261
  for (const edge of EDGES) {
    const hit = findEdgeTag(xml, edge)
    if (!hit) continue
    const mergedTag = `${hit.xml.slice(0, -1)} w:color="AABBCC">`
    h = hashStr(xml.slice(0, hit.at) + mergedTag + xml.slice(hit.at + hit.xml.length), h)
  }
  return h
}

console.log('\n纯函数段（同一批 pBdr 块，循环内正则编译 vs 字符串定位）')
for (const [n, reps] of [[50, 400], [500, 80], [2000, 25]]) {
  const blocks = Array.from({ length: n }, (_, i) => block(i))
  const run = (fn) => { let sink = 0; for (let i = 0; i < reps; i++) for (const b of blocks) sink = (sink + fn(b)) | 0; return sink }
  const a = run(legacyScan), b = run(fastScan)
  if (a !== b) { console.log(`  结果不等价！${a} vs ${b}`); process.exitCode = 1; continue }
  for (const fn of [legacyScan, fastScan]) { run(fn); run(fn) }
  const t0 = [], t1 = []
  for (let r = 0; r < 20; r++) {
    let t = performance.now(); run(legacyScan); t0.push(performance.now() - t)
    t = performance.now(); run(fastScan); t1.push(performance.now() - t)
    t = performance.now(); run(fastScan); t1.push(performance.now() - t)
    t = performance.now(); run(legacyScan); t0.push(performance.now() - t)
  }
  const m0 = median(t0), m1 = median(t1)
  console.log(`${String(n).padStart(4)} 块 × ${String(reps).padStart(3)} 趟  ` +
    `${m0.toFixed(1)} → ${m1.toFixed(1)}ms  降幅 ${(((m0 - m1) / m0) * 100).toFixed(1)}%  | 逐字符 hash 一致 ✓`)
}
