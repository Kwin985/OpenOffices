// pptx 导入文本拼接「零数组」基准（v0.185）。
//
// 改前：`paragraphText(p) = descendantsByName(p,'t').map(textOf).join('')`，
// 每段把整棵子树按名摊平成两个数组。改后：一次前序遍历、命中 `a:t` 即拼接，
// 零中间数组。不建缓存、不改数据结构（v0.183 惰性索引化实测慢 8~9% 已回退）。
//
// 判据：
//   ① 两腿同源、只差一个参数：`{legacyParaText:true}` 是改前路径，不传是本轮路径；
//   ② 语义等价：Deck 稳定序列化（Map 展开 + 键排序 + 随机 id 归一）逐字相同；
//   ③ 同进程交替顺序各 10 样本取中位，跨进程绝对值不相减；
//   ④ 端到端若被 XML 解析盖住，另给「改前算法复刻 vs 本轮」的纯遍历段确定判据。
//
// 夹具来自产品真出口 `deckToPptxBytes`。
// 跑法：npx vite-node scripts/bench-pptx-paratext.mjs

import { performance } from 'node:perf_hooks'
import { emptyDeck, newSlide } from '../src/lib/ppt.ts'
import { deckToPptxBytes } from '../src/lib/pptx-export.ts'
import { pptxBytesToDeck } from '../src/lib/pptx-import.ts'

const ROUNDS = 10
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function fixture(pages, lines) {
  const slides = []
  for (let i = 0; i < pages; i++) {
    const s = newSlide('bullets')
    s.title = `第 ${i + 1} 页的标题`
    s.body = Array.from({ length: lines }, (_, j) => `第 ${j + 1} 条要点文字与若干正文`).join('\n')
    s.anim = i % 3 === 0 ? 'fly' : i % 3 === 1 ? 'wipe' : 'fade'
    slides.push(s)
  }
  return { ...emptyDeck(), slides }
}

const stable = (v, key = '') => {
  if (key === 'id') return '<id>'
  if (v instanceof Map) return ['Map', [...v.entries()].map(([k, x]) => [k, stable(x)])]
  if (Array.isArray(v)) return v.map((x) => stable(x))
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k], k)]))
  return v
}
const sig = (deck) => JSON.stringify(stable(deck))

const legs = [
  { name: '改前（摊平数组 + map + join）', fn: (b) => pptxBytesToDeck(b, { legacyParaText: true }) },
  { name: '本轮（单次前序拼接）', fn: (b) => pptxBytesToDeck(b) },
]

console.log('端到端（夹具来自 deckToPptxBytes）')
for (const [pages, lines] of [[4, 6], [24, 12], [60, 20]]) {
  const bytes = await deckToPptxBytes(fixture(pages, lines))
  const a = sig(await legs[0].fn(bytes))
  const b = sig(await legs[1].fn(bytes))
  const same = a === b
  for (const l of legs) { await l.fn(bytes); await l.fn(bytes) }
  const times = legs.map(() => [])
  for (let r = 0; r < ROUNDS; r++) {
    for (const i of (r % 2 === 0 ? [0, 1, 1, 0] : [1, 0, 0, 1])) {
      const t = performance.now()
      await legs[i].fn(bytes)
      times[i].push(performance.now() - t)
    }
  }
  const ma = median(times[0]), mb = median(times[1])
  console.log(`${String(pages).padStart(3)} 页 × ${String(lines).padStart(2)} 条  ` +
    `${ma.toFixed(1)} → ${mb.toFixed(1)}ms  降幅 ${(((ma - mb) / ma) * 100).toFixed(1)}%  ` +
    `| 语义等价 ${same ? '✓ 逐字相同' : '✗ 不同'}`)
  if (!same) {
    let i = 0
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
    console.log('   首个差异：', JSON.stringify(a.slice(i - 80, i + 160)), '/', JSON.stringify(b.slice(i - 80, i + 160)))
    process.exitCode = 1
  }
}

// ---- 纯遍历段微基准 ---------------------------------------------------------
// 端到端里这处开销被 XML 解析与 zip 解压盖住，所以把两腿的**遍历算法**复刻成
// 第二条腿，在同一棵合成 PEl 树上对撞：既证明字符串逐字相同，也能量出
// 「不再物化两个数组」本身的降幅。
const node = (localName, kids = [], direct = '') => ({ name: `a:${localName}`, localName, attrs: {}, kids, direct })
const textOf = (el) => el.direct + el.kids.map(textOf).join('')
const descendantsByName = (n, name) => {
  const out = []
  const walk = (x) => { for (const c of x.kids) { if (c.localName === name) out.push(c); walk(c) } }
  walk(n)
  return out
}
const legacyText = (p) => descendantsByName(p, 't').map(textOf).join('')
const fastText = (p) => {
  let s = ''
  const walk = (n) => { for (const k of n.kids) { if (k.localName === 't') s += textOf(k); else walk(k) } }
  walk(p)
  return s
}
/** 一段正文：runs 枚 a:r，每枚带 noise 枚 rPr 噪声 + 一枚 a:t */
function paraTree(runs, noise) {
  const kids = []
  for (let i = 0; i < runs; i++) {
    const r = []
    for (let j = 0; j < noise; j++) r.push(node('rPr', [node('latin', [], 'x')]))
    r.push(node('t', [], `第${i}段`))
    kids.push(node('r', r))
  }
  kids.push(node('endParaRPr'))
  return node('p', kids)
}

console.log('\n纯遍历段（同一棵 PEl 树，改前算法复刻 vs 单次前序拼接）')
for (const [runs, noise, paras] of [[4, 3, 200], [20, 6, 120], [80, 10, 40]]) {
  const tree = paraTree(runs, noise)
  const la = legacyText(tree), fb = fastText(tree)
  if (la !== fb) { console.log(`  结果不等价！${la} vs ${fb}`); process.exitCode = 1; continue }
  const run = (fn) => {
    let sink = 0
    for (let i = 0; i < paras; i++) sink += fn(tree).length
    return sink
  }
  for (const fn of [legacyText, fastText]) { run(fn); run(fn) }
  const t0 = [], t1 = []
  for (let r = 0; r < 20; r++) {
    let t = performance.now(); run(legacyText); t0.push(performance.now() - t)
    t = performance.now(); run(fastText); t1.push(performance.now() - t)
    t = performance.now(); run(fastText); t1.push(performance.now() - t)
    t = performance.now(); run(legacyText); t0.push(performance.now() - t)
  }
  const m0 = median(t0), m1 = median(t1)
  console.log(`${String(runs).padStart(3)} run × ${String(noise).padStart(2)} 噪声 × ${paras} 段  ` +
    `${m0.toFixed(2)} → ${m1.toFixed(2)}ms  降幅 ${(((m0 - m1) / m0) * 100).toFixed(1)}%  ` +
    `| 文本逐字相同 ✓ (${la.length} 字)`)
}
