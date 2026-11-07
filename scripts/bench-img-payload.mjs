// 图片载荷单次索引的性能判据（v0.179）。
//
// 热点：`bitmap()` / `readImgPayload()` / `imgClipCss()` / `imgTransformCss()` 对
// **同一个 w:drawing / w:pict 子树**各做几十次 `findDesc` / `allDesc` 深搜
// （`allDesc` 每次都把整棵子树摊平成数组再过滤）。v0.174 的 `buildDocIndex`
// 只服务 7 个只读记账的 note*，图片渲染主链没吃到那张索引——这是漏网之鱼。
// 本轮把同一枚 drawing 的查问收成一份一次遍历的子树索引。
//
// 判据两条，缺一不可：
//   ① 同进程 A/B：改前副本（HEAD 的 src/lib）与产品源，同一份图片密集件交替
//      顺序跑，各 10 样本取中位。跨进程绝对值随机器负载浮动，不能相减。
//   ② 语义等价：两腿产出的 **HTML 逐字相同**。索引只换「怎么找到那枚元素」，
//      不改 attr/attrL 的按名访问，探针查问集合必须一字不动。
//
// 跑法（副本由 git archive 生成，脚本不碰 git）：
//   mkdir -p tmp/bench-img-old && git archive HEAD src/lib | tar -x -C tmp/bench-img-old
//   npx vite-node scripts/bench-img-payload.mjs
import path from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { fixtureParts } from './lib/fixture.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const url = (p) => `file:///${p.replace(/\\/g, '/')}`
const ROUNDS = 10
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// 图片密集件：把夹具里含 w:drawing / w:pict 的段落重复 N 份，其余部件原样。
// 关系表 / 媒体只有一份，重复段沿用同一个 rId —— 与真实文档「一图多处引用」同形。
function denseFixture(n) {
  const parts = fixtureParts()
  const doc = parts.get('word/document.xml')
  const all = [...doc.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m) => m[0])
  // 只收 `<w:p>` 开闭配对的段：wps 文本框的 w:txbxContent 里还嵌着 <w:p>，
  // 非贪婪正则会把那种段从中间截断，拼出来的 document.xml 不闭合，读手会递归失控。
  // 那种段本身也是好夹具，但不适合「整段重复」这种造法，交给 N=1 的原生夹具覆盖
  const pics = all.filter(
    (p) => /<w:drawing>|<w:pict>/.test(p)
      && (p.match(/<w:p[\s>]/g) ?? []).length === (p.match(/<\/w:p>/g) ?? []).length,
  )
  if (pics.length < 3) throw new Error('夹具里找不到足够多闭合的图片段')
  const bodyOpen = doc.indexOf('<w:body>')
  const head = doc.slice(0, bodyOpen + '<w:body>'.length)
  const tail = doc.slice(doc.lastIndexOf('</w:body>'))
  const body = head + pics.join('').repeat(n) + tail
  const zip = new JSZip()
  for (const [p, c] of parts) zip.file(p, p === 'word/document.xml' ? body : c)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }).then((b) => new Uint8Array(b))
}

const oldReader = await import(url(path.join(REPO, 'tmp/bench-img-old/src/lib/docx-fidelity.ts')))
const newReader = await import(url(path.join(REPO, 'src/lib/docx-fidelity.ts')))

const legs = [
  { name: '改前（每张图各自深搜）', fn: oldReader.docxToHtmlFidelity },
  { name: '本轮（每 drawing 一份索引）', fn: newReader.docxToHtmlFidelity },
]

for (const n of [1, 20, 120]) {
  const bytes = await denseFixture(n)
  const a = await legs[0].fn(bytes)
  const b = await legs[1].fn(bytes)
  const same = a.html === b.html
  console.log(`N=${String(n).padStart(4)} 张图×5  语义等价（HTML 逐字）：${same ? '✓ 相同' : '✗ 不同'}`)
  if (!same) {
    let i = 0
    while (i < Math.min(a.html.length, b.html.length) && a.html[i] === b.html[i]) i++
    console.log(`  首个差异 @${i}: ${JSON.stringify(a.html.slice(i - 60, i + 80))} / ${JSON.stringify(b.html.slice(i - 60, i + 80))}`)
    process.exitCode = 1
  }
}

// 交替顺序，避免「先跑的腿吃冷缓存」这一类偏差
const bytes = await denseFixture(40)
const times = legs.map(() => [])
for (const { fn } of legs) { await fn(bytes); await fn(bytes) }
for (let r = 0; r < ROUNDS; r++) {
  const order = r % 2 === 0 ? [0, 1] : [1, 0]
  for (const i of order) {
    const t = performance.now()
    await legs[i].fn(bytes)
    times[i].push(performance.now() - t)
  }
}
const m = times.map(median)
console.log('')
for (let i = 0; i < legs.length; i++) {
  console.log(`${legs[i].name.padEnd(34)} ${m[i].toFixed(1)}ms（${ROUNDS} 趟中位，200 张图）`)
}
const drop = ((m[0] - m[1]) / m[0]) * 100
console.log(`变化 ${drop >= 0 ? '−' : '+'}${Math.abs(drop).toFixed(1)}%`)
