// v0.187 写手补丁链「最后三处循环内动态正则」基准。
//
// v0.186 收掉了 `tagWithAttrs` / `retag`；本轮把 `mergeTagAttrs`、
// `patchStyleIndZeros`、`pprOrder` 三处剩下的 `new RegExp(...)` 换成共用的
// `hasAttrNamed`（字符串定位 + 空白收边）。旧算法原样留在 `legacyAttrScan:true`
// 对照腿，两腿同源只差一个参数。
//
// 跑法：npx vite-node scripts/bench-docx-attrscan.mjs

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
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pmDoc = PMDOMParser.fromSchema(getSchema(docExtensions())).parse(document.body).toJSON()

const normalizePart = (name, text) => {
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
  { name: '改前（三处各编译一次正则）', fn: () => prosemirrorToDocxBytes(pmDoc, merged, { legacyAttrScan: true }) },
  { name: '本轮（共用 hasAttrNamed）', fn: () => prosemirrorToDocxBytes(pmDoc, merged) },
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

// ---- 纯函数段：三处共同的开销（每次判属性是否存在） -------------------------
const legacyHas = (tag, name) => new RegExp(`\\s${name}=`).test(tag)
const fastHas = (tag, name) => {
  const needle = `${name}=`
  let at = tag.indexOf(needle)
  while (at >= 0) {
    if (at > 0 && tag[at - 1] <= ' ') return true
    at = tag.indexOf(needle, at + needle.length)
  }
  return false
}
const cases = [
  ['<w:ind w:left="0"/>', 'w:left'],
  ['<w:ind w:left="0" w:right="0"/>', 'w:right'],
  ['<w:rPr data-w:left="1"/>', 'w:left'],
  ['<w:rPr\tw:color="ff0000"/>', 'w:color'],
  ['<w:rPr\nw:sz="22"/>', 'w:sz'],
  ['<w:rPr/>', 'w:left'],
  ['<wp:docPr id="7" name="图片 1" descr="画布级替代文本"/>', 'descr'],
  ['<a:srcRect t="0" r="0" b="0" l="0"/>', 'l'],
]
for (const [tag, name] of cases) {
  if (legacyHas(tag, name) !== fastHas(tag, name)) {
    console.log(`  结果不等价！${tag} / ${name}`)
    process.exitCode = 1
  }
}
console.log('\n纯函数段（属性存在判定，改前正则复刻 vs 字符串定位）')
for (const reps of [20000, 100000, 400000]) {
  const run = (fn) => {
    let n = 0
    for (let i = 0; i < reps; i++) {
      const [tag, name] = cases[i % cases.length]
      if (fn(tag, name)) n++
    }
    return n
  }
  const a = run(legacyHas), b = run(fastHas)
  if (a !== b) { console.log(`  计数不等价！${a} vs ${b}`); process.exitCode = 1; continue }
  for (const fn of [legacyHas, fastHas]) { run(fn); run(fn) }
  const t0 = [], t1 = []
  for (let r = 0; r < 20; r++) {
    let t = performance.now(); run(legacyHas); t0.push(performance.now() - t)
    t = performance.now(); run(fastHas); t1.push(performance.now() - t)
    t = performance.now(); run(fastHas); t1.push(performance.now() - t)
    t = performance.now(); run(legacyHas); t0.push(performance.now() - t)
  }
  const m0 = median(t0), m1 = median(t1)
  console.log(`${String(reps).padStart(7)} 次判定  ${m0.toFixed(1)} → ${m1.toFixed(1)}ms  降幅 ${(((m0 - m1) / m0) * 100).toFixed(1)}%  | 结果逐字相同 ✓`)
}
