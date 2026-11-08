// pptx 导入动画链「命中即停」基准（v0.184）。
//
// 改前：`animEffectOf` 用 `descendantsByName(c,'anim').some(a =>
//   descendantsByName(a,'attrName').some(...))` 嵌套两次把整棵子树按名摊平成数组；
// `parseAnim` 里出场判定也先收齐所有 animEffect。`.some` 自己短路，
// 浪费在「收齐数组」——动画一多就是 O(查问数 × 子树)。
// 改后：`hasFlyXY` / `hasExitEffect` 一次前序遍历、命中即返回，不物化任何数组。
// **不建缓存、不改数据结构**（v0.183 试过的惰性索引化因每子树只查一次实测慢 8~9%，已回退）。
//
// 判据：
//   ① 两腿同源、只差一个参数：`{legacyAnimScan:true}` 是改前路径，不传是本轮路径；
//   ② 语义等价：两腿导入出的 Deck 用稳定序列化（Map 展开 + 键排序 + 随机 id 归一）
//      逐字相同，覆盖 fade / wipe / fly 三支与出场效果；
//   ③ 同进程交替顺序各 10 样本取中位，跨进程绝对值不相减。
//
// 夹具来自**产品真出口** `deckToPptxBytes`（不是手搓 timing XML）：
// 每页多行正文 = 多枚 clickEffect，fly 生成 `<p:anim><p:attrName>ppt_x</p:attrName>`，
// exitAnim 生成 `<p:animEffect transition="out">`，两处早停分支都吃得到。
//
// 跑法：npx vite-node scripts/bench-pptx-anim.mjs

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
    s.body = Array.from({ length: lines }, (_, j) => `第 ${j + 1} 条要点文字`).join('\n')
    s.anim = i % 3 === 0 ? 'fly' : i % 3 === 1 ? 'wipe' : 'fade'
    s.animDir = 'right'
    s.exitAnim = 'fade'
    s.advClick = true
    slides.push(s)
  }
  return { ...emptyDeck(), slides }
}

/** Deck 含 Map（shapeAnims）与 newId() 随机 id：展开 Map、排序键、归一 id 后再比 */
const stable = (v, key = '') => {
  if (key === 'id') return '<id>'
  if (v instanceof Map) return ['Map', [...v.entries()].map(([k, x]) => [k, stable(x)])]
  if (Array.isArray(v)) return v.map((x) => stable(x))
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k], k)]))
  }
  return v
}
const sig = (deck) => JSON.stringify(stable(deck))

const legs = [
  { name: '改前（嵌套 some 全量摊平）', fn: (b) => pptxBytesToDeck(b, { legacyAnimScan: true }) },
  { name: '本轮（前序早停）', fn: (b) => pptxBytesToDeck(b) },
]

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
// 端到端里这处开销被 XML 解析/文本提取盖住（±3% 噪声），所以把两腿的**遍历算法**
// 复刻成第二条腿，在同一棵合成子树上对撞：既能证明布尔结果逐字相同，
// 也能量出「不再物化数组 + 命中即停」本身的降幅（v0.176 改前算法复刻的范式）。
const node = (localName, kids = [], direct = '') => ({ name: `p:${localName}`, localName, attrs: {}, kids, direct })
const textOf = (el) => el.direct
const descendantsByName = (n, name) => {
  const out = []
  const walk = (x) => { for (const c of x.kids) { if (c.localName === name) out.push(c); walk(c) } }
  walk(n)
  return out
}
/** 改前：嵌套两次全量摊平 + some */
const legacyFly = (c) => descendantsByName(c, 'anim').some((a) =>
  descendantsByName(a, 'attrName').some((x) => textOf(x) === 'ppt_x' || textOf(x) === 'ppt_y'))
/** 本轮：一次前序 + inAnim 门 + 命中即停，零数组物化 */
const fastFly = (c) => {
  const stack = []
  for (let i = c.kids.length - 1; i >= 0; i--) stack.push({ el: c.kids[i], inAnim: false })
  while (stack.length) {
    const { el, inAnim } = stack.pop()
    const inside = inAnim || el.localName === 'anim'
    if (inside && el.localName === 'attrName') {
      const t = textOf(el)
      if (t === 'ppt_x' || t === 'ppt_y') return true
    }
    for (let i = el.kids.length - 1; i >= 0; i--) stack.push({ el: el.kids[i], inAnim: inside })
  }
  return false
}
function animTree(anims, noise, hitAt) {
  const kids = []
  for (let i = 0; i < anims; i++) {
    const inner = Array.from({ length: noise }, () => node('cond'))
    inner.push(node('attrName', [], i === hitAt ? 'ppt_x' : 'style.visibility'))
    kids.push(node('anim', inner))
  }
  return node('cTn', kids)
}

console.log('\n纯遍历段（同一棵 PEl 树，改前算法复刻 vs 早停）')
for (const [anims, noise, hitAt] of [[60, 20, 0], [60, 20, -1], [200, 50, 199]]) {
  const tree = animTree(anims, noise, hitAt)
  const la = legacyFly(tree), fb = fastFly(tree)
  if (la !== fb) { console.log(`  结果不等价！${la} vs ${fb}`); process.exitCode = 1; continue }
  for (const fn of [legacyFly, fastFly]) { fn(tree); fn(tree) }
  const t0 = [], t1 = []
  for (let r = 0; r < 20; r++) {
    let t = performance.now(); legacyFly(tree); t0.push(performance.now() - t)
    t = performance.now(); fastFly(tree); t1.push(performance.now() - t)
    t = performance.now(); fastFly(tree); t1.push(performance.now() - t)
    t = performance.now(); legacyFly(tree); t0.push(performance.now() - t)
  }
  const ma = median(t0), mb = median(t1)
  console.log(`  ${String(anims).padStart(3)} anim × ${String(noise).padStart(2)} 噪声 命中=${hitAt < 0 ? '无' : hitAt}  ` +
    `${ma.toFixed(3)} → ${mb.toFixed(3)}ms  降幅 ${(((ma - mb) / ma) * 100).toFixed(1)}%  | 结果相同 ✓`)
}
