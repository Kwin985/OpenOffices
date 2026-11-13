// v0.196 基准：写手最后两处动态正则 → 字符串定位（core.xml 五格 + sectPr 数值）。
//
// 判据：① 纯函数段用逐字符 hash 对撞（只累加长度会假绿）；② 两腿同源只差
// legacyMetaRegex 一个开关；③ 交替顺序各 10 样本取中位；④ 端到端两腿产物
// 逐部件字符串归一后逐字相同。收益小 / 端到端在噪声内都如实写，不冒充提速。
//
// 跑法：npx vite-node scripts/bench-meta-regex.mjs

import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'
import {
  docxToDocMeta, legacyParseCoreProps, legacyTwipsAttrOf, pageSetupOf,
  parseCoreProps, prosemirrorToDocxBytes, twipsAttrOf,
} from '../src/lib/docx.ts'
import { docExtensions } from '../src/lib/doc-schema.ts'

const ROUNDS = 10
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const hashStr = (s, h) => { for (let j = 0; j < s.length; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619); return h | 0 }

const z = new JSZip()
for (const [p, c] of fixtureParts()) z.file(p, c)
const bytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))

// ── ① 纯函数段：两腿逐字符 hash 对撞 + 计时 ────────────────────────────
const CORES = [
  '<dc:title>标题 A &amp; B</dc:title><dc:subject>主题</dc:subject><dc:creator>张三</dc:creator>' +
    '<cp:keywords>甲,乙,丙</cp:keywords><dc:description>说明文字</dc:description>',
  '<dc:title xml:lang="zh">带属性开标签</dc:title>',
  '<dc:title></dc:title><dc:creator>   </dc:creator>',
  '<dc:title>&#x4E2D;&#x6587;</dc:title><dc:subject>未闭合',
]
const TWS = [
  ['<w:pgSz w:w="11906" w:h="16838"/>', 'w'],
  ['<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/>', 'left'],
  ['<w:pgSz w:w="abc" w:w="11906"/>', 'w'],
  ['<w:pgSz/>', 'h'],
]
const pure = (fast, reps) => {
  let h = 2166136261
  const core = fast ? parseCoreProps : legacyParseCoreProps
  const tw = fast ? twipsAttrOf : legacyTwipsAttrOf
  for (let i = 0; i < reps; i++) {
    for (const x of CORES) h = hashStr(JSON.stringify(core(x)), h)
    for (const [x, a] of TWS) h = hashStr(String(tw(x, a)), h)
  }
  return h | 0
}
for (const reps of [2000, 20000, 80000]) {
  const a = pure(false, reps), b = pure(true, reps)
  if (a !== b) { console.log(`  ██ 结果不等价！${a} vs ${b}`); process.exitCode = 1; continue }
  pure(false, reps >> 2); pure(true, reps >> 2)
  const t0 = [], t1 = []
  for (let r = 0; r < ROUNDS; r++) {
    let s = performance.now(); pure(false, reps); t0.push(performance.now() - s)
    s = performance.now(); pure(true, reps); t1.push(performance.now() - s)
    s = performance.now(); pure(true, reps); t1.push(performance.now() - s)
    s = performance.now(); pure(false, reps); t0.push(performance.now() - s)
  }
  const m0 = median(t0), m1 = median(t1)
  console.log(`纯函数 ${String(reps).padStart(6)} 趟  ${m0.toFixed(1)} → ${m1.toFixed(1)}ms  ` +
    `降幅 ${(((m0 - m1) / m0) * 100).toFixed(1)}%  | 逐字符 hash 一致 ✓`)
}

// ── ② 端到端：两腿同源只差 legacyMetaRegex ─────────────────────────────
const fid = await docxToHtmlFidelity(bytes)
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pmDoc = PMDOMParser.fromSchema(getSchema(docExtensions())).parse(document.body).toJSON()
const norm = (name, text) => {
  let s = text
  if (name === 'docProps/core.xml') s = s.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g, '$1TS$2')
  // 两腿签名先归一随机量：rels 的 Id 与正文里的 r:id/r:embed 都可能是
  // newId() 生成的字母串（不只是 rId1 那种数字），不归一就会假报不等价。
  return s.replace(/\b(Id|r:id|r:embed|r:link)="rId[A-Za-z0-9_-]+"/g, (_m, k) => `${k}="rIdN"`)
}
const sigParts = async (legacy) => {
  const meta = await docxToDocMeta(bytes, undefined, legacy ? { legacyMetaRegex: true } : undefined)
  const merged = {
    ...meta,
    ...(fid.styles?.length ? { styles: fid.styles } : {}),
    ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
    ...(fid.numbering ? { numbering: fid.numbering } : {}),
    ...(fid.section ? { page: { ...meta.page, ...pageSetupOf(fid.section) } } : {}),
    ...(fid.background ? { background: fid.background } : {}),
    ...(fid.comments.length ? { comments: fid.comments } : {}),
  }
  const out = await JSZip.loadAsync(await prosemirrorToDocxBytes(pmDoc, merged))
  const names = Object.keys(out.files).filter((n) => !out.files[n].dir).sort()
  const parts = []
  for (const n of names) parts.push(`${n}\u0000${norm(n, await out.file(n).async('string'))}`)
  return parts
}
const [pa, pb] = [await sigParts(false), await sigParts(true)]
const [sa, sb] = [pa.join('\u0001'), pb.join('\u0001')]
console.log(`端到端两腿逐部件归一逐字相同：${sa === sb ? '✓' : '✗ 不等价'}`)
if (sa !== sb) {
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue
    const a = pa[i] ?? '', b = pb[i] ?? ''
    const k = [...Array(Math.min(a.length, b.length))].findIndex((_, j) => a[j] !== b[j])
    console.log('  首个差异部件:', a.split('\u0000')[0], '@', k,
      '\n   A:', JSON.stringify(a.slice(Math.max(0, k - 70), k + 110)),
      '\n   B:', JSON.stringify(b.slice(Math.max(0, k - 70), k + 110)))
    break
  }
  process.exitCode = 1
}
const metaRun = async (legacy) => { await docxToDocMeta(bytes, undefined, legacy ? { legacyMetaRegex: true } : undefined) }
const e0 = [], e1 = []
for (let r = 0; r < ROUNDS; r++) {
  let s = performance.now(); await metaRun(false); e0.push(performance.now() - s)
  s = performance.now(); await metaRun(true); e1.push(performance.now() - s)
  s = performance.now(); await metaRun(true); e1.push(performance.now() - s)
  s = performance.now(); await metaRun(false); e0.push(performance.now() - s)
}
const em0 = median(e0), em1 = median(e1)
console.log(`docxToDocMeta 端到端  ${em0.toFixed(2)} → ${em1.toFixed(2)}ms  ` +
  `降幅 ${(((em0 - em1) / em0) * 100).toFixed(1)}%（zip 解压主导，预期在噪声内）`)
