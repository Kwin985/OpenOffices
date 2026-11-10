// v0.192 基准：`patchElemAttrs` 物化开标签数组 → 惰性迭代。
//
// 判据：① 逐部件字符串归一后逐字相同；② 同进程交替顺序各 10 样本取中位；
// ③ 纯函数段用逐字符 hash 对撞（只累加长度会假绿）；端到端被 XML 解析/
// 序列化盖住时如实写「噪声内」，不拿纯函数段冒充整链收益。
//
// 跑法：npx vite-node scripts/bench-elem-scan.mjs

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
  { name: '改前（物化数组）', fn: () => prosemirrorToDocxBytes(pmDoc, merged, { legacyElemScan: true }) },
  { name: '本轮（惰性迭代）', fn: () => prosemirrorToDocxBytes(pmDoc, merged) },
]
console.log('端到端（完整写出链）')
const A = await partsSignature(await legs[0].fn())
const B = await partsSignature(await legs[1].fn())
const same = A === B
console.log(`语义等价（逐部件字符串归一）：${same ? '✓ 逐字相同' : '✗ 不同'}`)
if (!same) process.exitCode = 1
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

// ---- 纯函数段：只比「按出现序给开标签补属性」这一件事 --------------------------
const RE = /<w:color(?=[\s/>])[^>]*>/g
const applyChunk = (tag, add, at) => {
  const cut = tag.endsWith('/>') ? tag.length - 2 : tag.length - 1
  return tag.slice(0, cut) + add + tag.slice(cut) + at
}
/** 改前：先物化数组，数够不够，再逐块拼 */
const materialized = (xml, extras) => {
  const opens = [...xml.matchAll(RE)]
  if (opens.length !== extras.length) return ''
  let out = '', cursor = 0
  for (let i = 0; i < opens.length; i++) {
    const m = opens[i]
    const start = m.index ?? 0, stop = start + m[0].length
    const add = extras[i]
    out += xml.slice(cursor, start) + (add ? applyChunk(m[0], add, '') : m[0])
    cursor = stop
  }
  return out + xml.slice(cursor)
}
/** 本轮：惰性迭代器边走边拼，末尾对账 */
const lazy = (xml, extras) => {
  let out = '', cursor = 0, count = 0
  for (const m of xml.matchAll(RE)) {
    const start = m.index ?? 0, stop = start + m[0].length
    const add = extras[count++]
    out += xml.slice(cursor, start) + (add ? applyChunk(m[0], add, '') : m[0])
    cursor = stop
  }
  if (count !== extras.length) return ''
  return out + xml.slice(cursor)
}

console.log('\n纯函数段（同一份 document.xml，物化数组 vs 惰性遍历）')
for (const [n, reps] of [[50, 300], [500, 60], [2000, 20]]) {
  const xml = Array.from({ length: n }, (_, i) =>
    `<w:r><w:color w:val="${(i % 8).toString(16)}"/></w:r>`).join('<w:p/>')
  const extras = Array.from({ length: n }, (_, i) => (i % 3 === 0 ? ` w:themeColor="accent${i % 6}"` : ''))
  const a = hashStr(materialized(xml, extras), 2166136261)
  const b = hashStr(lazy(xml, extras), 2166136261)
  if (a !== b) { console.log(`  结果不等价！${a} vs ${b}`); process.exitCode = 1; continue }
  const run = (fn) => { let sink = 0; for (let i = 0; i < reps; i++) sink = (sink + hashStr(fn(xml, extras), 2166136261)) | 0; return sink }
  for (const fn of [materialized, lazy]) { run(fn); run(fn) }
  const t0 = [], t1 = []
  for (let r = 0; r < 20; r++) {
    let t = performance.now(); run(materialized); t0.push(performance.now() - t)
    t = performance.now(); run(lazy); t1.push(performance.now() - t)
    t = performance.now(); run(lazy); t1.push(performance.now() - t)
    t = performance.now(); run(materialized); t0.push(performance.now() - t)
  }
  const m0 = median(t0), m1 = median(t1)
  console.log(`${String(n).padStart(4)} 标签 × ${String(reps).padStart(3)} 趟  ` +
    `${m0.toFixed(1)} → ${m1.toFixed(1)}ms  降幅 ${(((m0 - m1) / m0) * 100).toFixed(1)}%  | 逐字符 hash 一致 ✓`)
}
