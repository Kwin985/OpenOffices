// ODT 导入「同一棵树重复全量物化 → 一次缓存」的性能判据（v0.181）。
//
// 热点：`odtToHtml` 里 `cdoc`（content.xml）与 `sdoc`（styles.xml）此前被
// `Array.from(doc.getElementsByTagName('*'))` 物化十几次，每次都新建一整份
// 数组；`findLocal` 更是「找第一枚也要先摊平整棵子树」。导入期间这两棵树不再变，
// 按树缓存一次即可。
//
// 判据两条（沿用本仓库范式）：
//   ① **两腿同源、只差一个参数**：`odtToHtml(bytes, {cacheDesc:false})` 是改前路径，
//      不传是缓存路径。不依赖手工 git archive 副本（v0.179 那种副本会过期）。
//   ② **语义等价**：`JSON.stringify({html, meta, warnings})` 逐字相同；
//      辅助判据 `getElementsByTagName('*')` 的调用次数下降。
//   夹具来自**产品真出口** `prosemirrorToOdtBytes`，不是手搓 XML。
//
// node 侧 DOM：@xmldom/xmldom 的 localName 符合标准、支持通配 getElementsByTagName，
// 但缺 `children`（odt.ts 大量使用），补一个 getter；linkedom 反之（localName 带前缀）。
//
// 跑法：npx vite-node scripts/bench-odt-desc.mjs

import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'

const { DOMParser } = await import('@xmldom/xmldom')
const probe = new DOMParser().parseFromString('<r><a/><b/></r>', 'text/xml')
// 补 children：只收元素节点，与浏览器 HTMLCollection 的语义一致
const elemProto = Object.getPrototypeOf(probe.documentElement)
Object.defineProperty(elemProto, 'children', {
  configurable: true,
  get() {
    const out = []
    const ns = this.childNodes
    for (let i = 0; i < (ns?.length ?? 0); i++) if (ns[i].nodeType === 1) out.push(ns[i])
    return out
  },
})
// 统计 `'*'` 查询次数：Element 与 Document 两条原型都包一层
let starCalls = 0
for (const obj of [probe.documentElement, probe]) {
  let proto = Object.getPrototypeOf(obj)
  while (proto && proto !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(proto, 'getElementsByTagName')) {
      const orig = proto.getElementsByTagName
      proto.getElementsByTagName = function (n) {
        if (n === '*') starCalls++
        return orig.call(this, n)
      }
      break
    }
    proto = Object.getPrototypeOf(proto)
  }
}
globalThis.DOMParser = DOMParser

const { prosemirrorToOdtBytes, odtToHtml } = await import('../src/lib/odt.ts')

const ROUNDS = 14
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })

async function fixture(n) {
  const content = []
  for (let i = 0; i < n; i++) content.push(p(`第 ${i + 1} 段：ODT 导入索引基准的填充文字 ABC 123`))
  const bytes = await prosemirrorToOdtBytes({ type: 'doc', content })
  // 语料放大：styles.xml（sdoc）被全量物化 5 次，是收益最集中的一棵树。
  // 往 office:styles 里补 N 枚空具名样式，只放大节点数、不改两腿的语义。
  const zip = await JSZip.loadAsync(bytes)
  const styles = await zip.file('styles.xml').async('string')
  const extra = Array.from({ length: n }, (_, i) => `<style:style style:name="bench${i}" style:family="paragraph"/>`).join('')
  zip.file('styles.xml', styles.replace('</office:styles>', extra + '</office:styles>'))
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer' }))
}

const legs = [
  {
    name: '改前（每处各物化一遍）',
    times: [],
    fn: (bytes) => odtToHtml(bytes, { cacheDesc: false }),
  },
  {
    name: '本轮（按树缓存一次）',
    times: [],
    fn: (bytes) => odtToHtml(bytes),
  },
]
const sig = (o) => JSON.stringify([o.html, o.meta, o.warnings])

for (const n of [1, 400, 1200]) {
  const bytes = await fixture(n)
  await legs[0].fn(bytes)
  await legs[1].fn(bytes)

  starCalls = 0
  const a = await legs[0].fn(bytes)
  const callsA = starCalls
  starCalls = 0
  const b = await legs[1].fn(bytes)
  const callsB = starCalls
  const same = sig(a) === sig(b)
  console.log(`N=${String(n).padStart(3)} 段  语义等价：${same ? '✓ 逐字相同' : '✗ 不同'}   getElementsByTagName('*') ${callsA} → ${callsB} 次`)
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
