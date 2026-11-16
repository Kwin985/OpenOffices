// v0.186 写手 `tagWithAttrs` / `retag` 零动态正则基准。
//
// 改前：两处每次调用都 `new RegExp(...)` 现编译——图片壳补丁里一个 `<w:drawing>`
// 要 retag 十几枚，每枚属性又各编译一次。改后：纯字符串定位，零动态正则。
//
// 判据：
//   ① 两腿同源、只差一个参数：`{legacyRetag:true}` 走改前的动态正则（原样留在产品源里
//      当第二条腿），不传是产品路径；语义等价 = zip 逐部件字符串归一后逐字相同；
//   ② 纯函数段把两腿算法复刻成对撞（同进程交替 20 轮取中位），既可证明字符串逐字
//      相同，也能量出「不再编译几千次正则」本身的降幅；
//   ③ 端到端如被 XML 解析/序列化盖住就如实写噪声，不冒充降幅。
//
// 夹具来自产品真出口 `prosemirrorToDocxBytes`（内置 fixtureParts 含 5 张图片壳）。
// 跑法：npx vite-node scripts/bench-docx-retag.mjs

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
  ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
  ...(fid.numbering ? { numbering: fid.numbering } : {}),
  ...(fid.section ? { page: { ...meta.page, ...pageSetupOf(fid.section) } } : {}),
  ...(fid.background ? { background: fid.background } : {}),
  ...(fid.comments.length ? { comments: fid.comments } : {}),
}
const schema = getSchema(docExtensions())
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pmDoc = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()

// 与 bench-docx-pack.mjs 同一套归一：压缩流/时间戳/随机 rId 天然不同，不参与比较
function normalizePart(name, text) {
  if (name === 'docProps/core.xml') {
    return text.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:)/g, '$1TS$2')
  }
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
  { name: '改前（每枚属性一次 new RegExp）', fn: () => prosemirrorToDocxBytes(pmDoc, merged, { legacyRetag: true }) },
  { name: '本轮（纯字符串定位）', fn: () => prosemirrorToDocxBytes(pmDoc, merged) },
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

// ---- 纯函数段：两腿算法复刻对撞 ---------------------------------------------
const legacyTagWithAttrs = (tag, kv) => {
  let out = tag
  for (const k of Object.keys(kv)) {
    const v = kv[k]
    if (!v) continue
    const re = new RegExp(`(\\s${k}=)"[^"]*"`)
    if (re.test(out)) { out = out.replace(re, `$1"${v}"`); continue }
    const m = /^(.*?)(\/?)>$/.exec(out)
    if (!m) continue
    out = `${m[1]} ${k}="${v}"${m[2]}>`
  }
  return out
}
const fastTagWithAttrs = (tag, kv) => {
  let out = tag
  for (const k of Object.keys(kv)) {
    const v = kv[k]
    if (!v) continue
    const needle = `${k}="`
    let at = out.indexOf(needle)
    while (at >= 0 && !(at > 0 && out[at - 1] <= ' ')) at = out.indexOf(needle, at + needle.length)
    if (at >= 0) {
      const q = out.indexOf('"', at + needle.length)
      if (q < 0) continue
      out = out.slice(0, at + needle.length) + v + out.slice(q)
      continue
    }
    const gt = out.lastIndexOf('>')
    if (gt < 0) continue
    const slash = gt > 0 && out[gt - 1] === '/' ? '/' : ''
    const cut = slash ? gt - 1 : gt
    out = out.slice(0, cut) + ` ${k}="${v}"` + slash + out.slice(gt)
  }
  return out
}
const legacyRetag = (chunk, tag, kv) => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?/?>`).exec(chunk)
  if (!m) return chunk
  return chunk.slice(0, m.index) + legacyTagWithAttrs(m[0], kv) + chunk.slice(m.index + m[0].length)
}
const fastRetag = (chunk, tag, kv) => {
  const needle = `<${tag}`
  let at = chunk.indexOf(needle)
  while (at >= 0) {
    const c = chunk[at + needle.length]
    if (c !== undefined && (c === '>' || c === '/' || c <= ' ')) break
    at = chunk.indexOf(needle, at + needle.length)
  }
  if (at < 0) return chunk
  const end = chunk.indexOf('>', at)
  if (end < 0) return chunk
  return chunk.slice(0, at) + fastTagWithAttrs(chunk.slice(at, end + 1), kv) + chunk.slice(end + 1)
}

/** 一枚典型的图片容器壳：15 层标签，模拟 patchImgXml 里那串 retag */
const shell = (n) =>
  `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
  `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${n}" name="图片 ${n}"/>` +
  `<pic:cNvPr id="0" name=""/><a:graphicFrameLocks noChangeAspect="1"/>` +
  `<a:picLocks noChangeAspect="1" noChangeArrowheads="1"/>` +
  `<pic:spPr bwMode="auto"><a:xfrm rot="0" flipH="0" flipV="0"><a:off x="0" y="0"/>` +
  `<a:ext cx="1000" cy="1000"/></a:xfrm><a:prstGeom prst="rect"/>` +
  `<a:srcRect t="0" r="0" b="0" l="0"/><a:blip cstate="none"/></pic:spPr>` +
  `</wp:inline></w:drawing>`
const PAIRS = [
  ['wp:inline', { distT: '1', distB: '2', distL: '3', distR: '4' }],
  ['wp:effectExtent', { l: '10', t: '20', r: '30', b: '40' }],
  ['wp:docPr', { id: '9', name: '形状 1' }],
  ['pic:cNvPr', { id: '7', descr: '替代文本' }],
  ['a:graphicFrameLocks', { noChangeAspect: '0' }],
  ['a:picLocks', { noChangeAspect: '0', noChangeArrowheads: '0' }],
  ['pic:spPr', { bwMode: 'gray' }],
  ['a:xfrm', { rot: '5400000', flipH: '1', flipV: '1' }],
  ['a:off', { x: '100', y: '200' }],
  ['a:ext', { cx: '300', cy: '400' }],
  ['a:prstGeom', { prst: 'ellipse' }],
  ['a:srcRect', { t: '1', r: '2', b: '3', l: '4' }],
  ['a:blip', { cstate: 'print' }],
]

console.log('\n纯函数段（同一枚图片壳，改前算法复刻 vs 字符串定位）')
for (const [drawings, reps] of [[20, 200], [200, 40], [1000, 8]]) {
  // patchImgXml 是把**每一枚** `<w:drawing>` 单独切出来再逐枚 retag，不是把全文
  // 拼成一个大串扫。按真实形状（每块各自 13 次）测，拼大串会把扫描成本算进去，
  // 那不是产品路径（v0.185 教训：判据按语料放大，但形状不能失真）。
  const chunks = Array.from({ length: drawings }, (_, i) => shell(i))
  // 判据必须比**内容**：只累加长度会假绿（两腿长度相同但值不同也过）。
  // 全部产物拼成一个大串太占内存，这里逐字符滚一个 32 位 hash，两腿同 hash
  // 才算逐字等价；结构测试里另有不含 $ 的形状逐字对撞。
  const run = (fn) => {
    let h = 2166136261
    for (let i = 0; i < reps; i++) {
      for (const chunk of chunks) {
        let s = chunk
        for (const [tag, kv] of PAIRS) s = fn(s, tag, kv)
        for (let j = 0; j < s.length; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619)
      }
    }
    return h | 0
  }
  const a = run(legacyRetag), b = run(fastRetag)
  if (a !== b) { console.log(`  结果不等价！hash ${a} vs ${b}`); process.exitCode = 1; continue }
  for (const fn of [legacyRetag, fastRetag]) { run(fn); run(fn) }
  const t0 = [], t1 = []
  for (let r = 0; r < 20; r++) {
    let t = performance.now(); run(legacyRetag); t0.push(performance.now() - t)
    t = performance.now(); run(fastRetag); t1.push(performance.now() - t)
    t = performance.now(); run(fastRetag); t1.push(performance.now() - t)
    t = performance.now(); run(legacyRetag); t0.push(performance.now() - t)
  }
  const m0 = median(t0), m1 = median(t1)
  console.log(`${String(drawings).padStart(4)} drawing × ${String(reps).padStart(3)} 趟 × 13 枚 retag  ` +
    `${m0.toFixed(1)} → ${m1.toFixed(1)}ms  降幅 ${(((m0 - m1) / m0) * 100).toFixed(1)}%  ` +
    `| 产物 hash 一致 ✓`)
}
