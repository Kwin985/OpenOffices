// 写手 post-pack 部件文本缓存的性能判据（v0.183）。
//
// 热点（v0.178 共享 zip 之后剩下的第二层）：十余个补丁各自
// `zip.file('word/document.xml').async('string')` 解压同一份部件。
// JSZip 对同一条目**不缓存解压结果**（同一 ZipObject 连调两次仍各自 inflate），
// 所以链上有多少次补丁就有多少次重复解压（探针：17 次 / 占端到端 6.8%）。
// 现在 `PackSession.text` 按部件名缓存当前文本：读查表、写同步更新，
// 下一枚补丁读到的仍是刚写下的内容（等价性关键），整条链只真解压一次。
//
// 判据：
//   ① **两腿同源、只差一个参数**：`{legacyPartText:true}` 让会话不建缓存表，
//      其余（含 v0.178 的共享 zip）两腿完全一致；不依赖手工 git archive 副本。
//   ② **语义等价**：两腿 zip 的部件名集合 + 逐部件字符串逐字相同
//      （`docProps/core.xml` 的时间戳按既有口径排除）。
//   ③ 结构性收益：数 `ZipObject.prototype.async('string')` 的调用次数。
//
// 跑法：npx vite-node scripts/bench-docx-parts.mjs

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

const srcZip = new JSZip()
for (const [p, c] of fixtureParts()) srcZip.file(p, c)
const srcBytes = new Uint8Array(await srcZip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }))
const fid = await docxToHtmlFidelity(srcBytes)
const base = await docxToDocMeta(srcBytes)
const merged = {
  ...base,
  ...(fid.styles?.length ? { styles: fid.styles } : {}),
  ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
  ...(fid.numbering ? { numbering: fid.numbering } : {}),
  ...(fid.section ? { page: { ...base.page, ...pageSetupOf(fid.section) } } : {}),
  ...(fid.background ? { background: fid.background } : {}),
  ...(fid.comments?.length ? { comments: fid.comments } : {}),
}
const schema = getSchema(docExtensions())
const { document } = parseHTML(`<!doctype html><html><body>${fid.html}</body></html>`)
const pm = PMDOMParser.fromSchema(schema).parse(document.body).toJSON()

/**
 * 放大语料：只把**第一枚文本节点**的文字拉长，段落数保持不变。
 * 段落数不变 → pprExtras / uThemes 等按出现序贴回的计数闸门仍成立，13 个补丁
 * 都照跑；但 Packer 写出的 document.xml 变大，每次 inflate 的成本随之显性化。
 */
function amplify(doc, repeat) {
  const d = JSON.parse(JSON.stringify(doc))
  const walk = (n) => {
    if (!n || typeof n !== 'object') return false
    if (n.type === 'text' && typeof n.text === 'string') {
      n.text = n.text.repeat(repeat) || n.text
      return true
    }
    for (const k of n.content ?? []) if (walk(k)) return true
    return false
  }
  walk(d)
  return d
}

/** 逐部件签名：core.xml 的写入时间戳两腿天然不同，按既有口径排除 */
function normalizePart(name, text) {
  // core.xml 的写入时间戳两腿天然不同；docx 包给超链接发随机 rId
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

// 按原型 hook 一次（不是 JSZip.prototype.file，避免同一 part 被重复包装）
const probeZip = await JSZip.loadAsync(srcBytes)
const zoProto = Object.getPrototypeOf(probeZip.file('word/document.xml'))
const origAsync = zoProto.async
let reads = 0
let readMs = 0
zoProto.async = function (kind, ...rest) {
  if (kind !== 'string') return origAsync.call(this, kind, ...rest)
  reads++
  const t = performance.now()
  return Promise.resolve(origAsync.call(this, kind, ...rest)).then((v) => {
    readMs += performance.now() - t
    return v
  })
}
const measureReads = async (fn) => {
  reads = 0
  readMs = 0
  await fn()
  return { reads, ms: readMs }
}

for (const repeat of [1, 40, 160]) {
  const pmDoc = amplify(pm, repeat)
  const legs = [
    { name: '改前（每个补丁各自解压）', fn: () => prosemirrorToDocxBytes(pmDoc, merged, { legacyPartText: true }) },
    { name: '本轮（会话缓存部件文本）', fn: () => prosemirrorToDocxBytes(pmDoc, merged) },
  ]
  const sigA = await partsSignature(await legs[0].fn())
  const sigB = await partsSignature(await legs[1].fn())
  const same = sigA === sigB
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
  const ra = await measureReads(legs[0].fn), rb = await measureReads(legs[1].fn)
  console.log(`文字 ×${String(repeat).padStart(3)}  端到端 ${ma.toFixed(1)} → ${mb.toFixed(1)}ms ` +
    `(${(((ma - mb) / ma) * 100).toFixed(1)}%)  | 部件解压 ${ra.reads} → ${rb.reads} 次 / ` +
    `${ra.ms.toFixed(1)} → ${rb.ms.toFixed(1)}ms  | 语义等价 ${same ? '✓' : '✗'}`)
  if (!same) {
    const a = sigA.split('\u0001'), b = sigB.split('\u0001')
    for (let k = 0; k < Math.max(a.length, b.length); k++) {
      if (a[k] !== b[k]) { console.log('   首个差异部件：', (a[k] ?? b[k]).slice(0, 100)); break }
    }
    process.exitCode = 1
  }
}
