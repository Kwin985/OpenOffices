// docx 打开路径「共享 zip 会话」的性能判据（v0.180）。
//
// 热点：`DocEditor` 打开一份 .docx 时，`docxToDocMeta` 与 `docxToHtmlFidelity`
// 各自 `JSZip.loadAsync(bytes)` 一遍；`word/document.xml`、`word/theme/theme1.xml`、
// `word/_rels/document.xml.rels` 三份部件各解压 + 转 UTF-8 两次。
// v0.173 收的是「同一份 document.xml 被 parseXml 8 次」，那是读手内部的树；
// 这一轮收的是**跨入口的 zip 解包与部件读取**，两层不同。
//
// 判据两条（沿用本仓库范式）：
//   ① **两腿同源、只差一个参数**：会话是可选参数，不传 = 改前路径，传 = 本轮路径。
//      不依赖手工 git archive 副本（v0.179 那种副本会随每轮改动过期、语义等价假红）。
//      同进程交替顺序各 10 样本取中位；跨进程绝对值不能相减。
//   ② **语义等价**：`JSON.stringify(meta)` 与读手产出的关键字段逐字相同；
//      辅助判据 `JSZip.loadAsync` 调用数 2 → 1。
//
// 跑法：npx vite-node scripts/bench-docx-open.mjs

import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { fixtureParts } from './lib/fixture.mjs'
import { docxToDocMeta, openDocxZip } from '../src/lib/docx.ts'
import { docxToHtmlFidelity } from '../src/lib/docx-fidelity.ts'

const ROUNDS = 10
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// 放大件：把夹具里开闭配对的 `<w:p>` 段重复 N 份，sectPr 仍留在 body 末尾。
// 只收配对段——wps 文本框的 w:txbxContent 里嵌着 <w:p>，非贪婪正则会截断（v0.179 教训）。
function denseFixture(n) {
  const parts = fixtureParts()
  const doc = parts.get('word/document.xml')
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] ?? ''
  const sect = /<w:sectPr\b[\s\S]*?<\/w:sectPr>/.exec(body)?.[0] ?? ''
  const paras = [...body.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
    .map((m) => m[0])
    .filter((p) => (p.match(/<w:p[\s>]/g) ?? []).length === (p.match(/<\/w:p>/g) ?? []).length)
  if (paras.length < 3) throw new Error('夹具里找不到足够多闭合的段落')
  const head = doc.slice(0, doc.indexOf('<w:body>') + '<w:body>'.length)
  const tail = doc.slice(doc.lastIndexOf('</w:body>'))
  const big = head + paras.join('').repeat(n) + sect + tail
  const zip = new JSZip()
  for (const [p, c] of parts) zip.file(p, p === 'word/document.xml' ? big : c)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }).then((b) => new Uint8Array(b))
}

// 统计解包 / 部件解压次数：两个入口都 `await import('jszip')` 取同一个 default 对象
const origLoad = JSZip.loadAsync.bind(JSZip)
let loads = 0
JSZip.loadAsync = async (...args) => {
  loads++
  return origLoad(...args)
}
const origFile = JSZip.prototype.file
let partReads = 0
JSZip.prototype.file = function (...args) {
  const part = origFile.apply(this, args)
  if (part && typeof part.async === 'function') {
    const origAsync = part.async.bind(part)
    part.async = (kind, ...rest) => {
      if (kind === 'string') partReads++
      return origAsync(kind, ...rest)
    }
  }
  return part
}

const legs = [
  {
    name: '改前（两入口各解包）',
    times: [],
    async fn(bytes) {
      const m = await docxToDocMeta(bytes)
      const f = await docxToHtmlFidelity(bytes)
      return { m, f }
    },
  },
  {
    name: '本轮（共享 zip 会话）',
    times: [],
    async fn(bytes) {
      const s = await openDocxZip(bytes)
      const m = await docxToDocMeta(bytes, s)
      const f = await docxToHtmlFidelity(bytes, 0, s)
      return { m, f }
    },
  },
]

for (const n of [1, 20, 60]) {
  const bytes = await denseFixture(n)
  // 预热两趟，避免首次 JIT / 模块加载污染样本
  await legs[0].fn(bytes)
  await legs[1].fn(bytes)

  // 语义等价：meta 与读手关键字段逐字相同
  loads = 0; partReads = 0
  const a = await legs[0].fn(bytes)
  const loadsA = loads, readsA = partReads
  loads = 0; partReads = 0
  const b = await legs[1].fn(bytes)
  const loadsB = loads, readsB = partReads
  const sig = (x) => JSON.stringify([
    x.m,
    x.f.html, x.f.blocks, x.f.comments, x.f.warnings, x.f.styles,
    x.f.section, x.f.background, x.f.numbering, x.f.latentStyles,
  ])
  const same = sig(a) === sig(b)
  console.log(`N=${String(n).padStart(3)}×${String((bytes.length / 1024) | 0)}KB  语义等价：${same ? '✓ 逐字相同' : '✗ 不同'}   loadAsync ${loadsA} → ${loadsB} 次   部件文本解压 ${readsA} → ${readsB} 次`)
  if (!same) process.exitCode = 1

  for (let r = 0; r < ROUNDS; r++) {
    for (const leg of r % 2 ? legs : [...legs].reverse()) {
      const t = performance.now()
      await leg.fn(bytes)
      leg.times.push(performance.now() - t)
    }
  }
  const [oldM, newM] = legs.map((l) => median(l.times))
  legs.forEach((l) => { l.times = [] })
  console.log(`   端到端中位  ${oldM.toFixed(1)} → ${newM.toFixed(1)}ms  (${((oldM - newM) / oldM * 100).toFixed(1)}% 降幅)`)
}
