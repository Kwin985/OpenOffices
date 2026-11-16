// v0.189 基准：patchNumOverrides / patchBorderBlocks 两处物化 → 惰性迭代。
//
// v0.188 只收了最热的 patchImgXml，这两处是同族顺延。三处共用
// `legacyBlockScan:true` 一个对照腿开关（两腿同源、只差这一个参数）。
//
// 判据：① 逐部件字符串归一后逐字相同；② 同进程交替顺序各 10 样本取中位；
// ③ 纯函数段用逐字符 hash 对撞（只累加长度会假绿）；端到端若被
//    XML 解析/序列化盖住，如实写「噪声内」，不拿纯函数段冒充整链收益。
//
// 跑法：npx vite-node scripts/bench-blocks-lazy.mjs

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
  { name: '改前（三处物化数组）', fn: () => prosemirrorToDocxBytes(pmDoc, merged, { legacyBlockScan: true }) },
  { name: '本轮（三处惰性迭代）', fn: () => prosemirrorToDocxBytes(pmDoc, merged) },
]

console.log('端到端（完整写出链；对照腿同时把 patchImgXml 也退回物化）')
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

// ---- 纯函数段 A：patchNumOverrides 形状（够数即停）--------------------------
const NUM_RE = /<w:num\b[^>]*>[\s\S]*?<\/w:num>/g
const numBlock = (i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${i}"/>` +
  `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${i % 7}"/></w:lvlOverride></w:num>`
const hashStr = (s, h) => { for (let j = 0; j < s.length; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619); return h }

const numMaterialized = (xml, startsLen) => {
  const blocks = [...xml.matchAll(NUM_RE)]
  let h = 2166136261
  for (let i = 0; i < blocks.length && i < startsLen; i++) h = hashStr(blocks[i][0], h)
  return h | 0
}
const numLazy = (xml, startsLen) => {
  let h = 2166136261
  let i = 0
  for (const m of xml.matchAll(NUM_RE)) {
    if (i++ >= startsLen) break
    h = hashStr(m[0], h)
  }
  return h | 0
}

// ---- 纯函数段 B：patchBorderBlocks 形状（末尾对账）---------------------------
const BDR_RE = /<w:pBdr(?=[\s/>])[^>]*?(?:\/>|>[\s\S]*?<\/w:pBdr>)/g
const bdrBlock = (i) => `<w:pBdr><w:top w:val="single" w:sz="${i % 9}" w:color="AABBCC"/>` +
  `<w:left w:val="single" w:sz="4" w:color="112233"/></w:pBdr>`
const bdrMaterialized = (xml) => {
  const blocks = [...xml.matchAll(BDR_RE)]
  let h = 2166136261
  for (const m of blocks) h = hashStr(m[0], h)
  return { h: h | 0, n: blocks.length }
}
const bdrLazy = (xml) => {
  let h = 2166136261
  let n = 0
  for (const m of xml.matchAll(BDR_RE)) { n++; h = hashStr(m[0], h) }
  return { h: h | 0, n }
}

function bench(pair, reps, rounds = 20) {
  const run = (fn) => { let sink = 0; for (let i = 0; i < reps; i++) sink = (sink + fn().h) | 0; return sink }
  for (const fn of pair) { run(fn); run(fn) }
  const t0 = [], t1 = []
  for (let r = 0; r < rounds; r++) {
    let t = performance.now(); run(pair[0]); t0.push(performance.now() - t)
    t = performance.now(); run(pair[1]); t1.push(performance.now() - t)
    t = performance.now(); run(pair[1]); t1.push(performance.now() - t)
    t = performance.now(); run(pair[0]); t0.push(performance.now() - t)
  }
  return [median(t0), median(t1)]
}
const pct = (a, b) => (((a - b) / a) * 100).toFixed(1) + '%'

console.log('\n纯函数段 A：patchNumOverrides（starts 只 2 枚，物化腿仍扫完全文）')
for (const [n, reps] of [[50, 400], [500, 80], [2000, 25]]) {
  const xml = Array.from({ length: n }, (_, i) => numBlock(i)).join('<w:numPr/>')
  const a = numMaterialized(xml, 2), b = numLazy(xml, 2)
  if (a !== b) { console.log(`  结果不等价！${a} vs ${b}`); process.exitCode = 1; continue }
  const [m0, m1] = bench([() => ({ h: numMaterialized(xml, 2) }), () => ({ h: numLazy(xml, 2) })], reps)
  console.log(`${String(n).padStart(4)} 块 × ${String(reps).padStart(3)} 趟  ` +
    `${m0.toFixed(1)} → ${m1.toFixed(1)}ms  降幅 ${pct(m0, m1)}  | 逐字符 hash 一致 ✓`)
}

console.log('\n纯函数段 B：patchBorderBlocks（块数闸门移到末尾，两腿都遍历全文）')
for (const [n, reps] of [[50, 400], [500, 80], [2000, 25]]) {
  const xml = Array.from({ length: n }, (_, i) => bdrBlock(i)).join('<w:p/>')
  const a = bdrMaterialized(xml), b = bdrLazy(xml)
  if (a.h !== b.h || a.n !== b.n) { console.log(`  结果不等价！${JSON.stringify(a)} vs ${JSON.stringify(b)}`); process.exitCode = 1; continue }
  const [m0, m1] = bench([() => bdrMaterialized(xml), () => bdrLazy(xml)], reps)
  console.log(`${String(n).padStart(4)} 块 × ${String(reps).padStart(3)} 趟  ` +
    `${m0.toFixed(1)} → ${m1.toFixed(1)}ms  降幅 ${pct(m0, m1)}  | 块数与 hash 一致 ✓`)
}
