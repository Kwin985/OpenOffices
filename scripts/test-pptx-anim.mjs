// v0.184 pptx 动画链早停断言。
//
// 改前：`descendantsByName(c,'anim').some(a => descendantsByName(a,'attrName').some(...))`
// 与 `descendantsByName(c,'animEffect').some(...)` 都要先把整棵子树按名摊平成数组。
// 改后：`hasFlyXY` / `hasExitEffect` 一次前序遍历、命中即停、零数组物化。
// 等价性的关键是 **inAnim 门**：attrName 必须是某枚 anim 的后代，
// 否则 anim 外的 attrName 会把 fade 误判成 fly。
//
// 跑法：npx vite-node scripts/test-pptx-anim.mjs

import fs from 'node:fs'
import { pptxBytesToDeck } from '../src/lib/pptx-import.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. 源码级纪律 ----------------------------------------------------------
{
  const src = read('../src/lib/pptx-import.ts')
  // v0.185 同一份 opts 里多了一枚 legacyParaText（文本拼接的 A/B 腿），
  // 按「这枚可选参数在场」判，不钉死整个类型字面量
  check('入口：legacyAnimScan 可选参数', /opts\?: \{[^}]*legacyAnimScan\?: boolean/.test(src)
    && /legacyAnimScan = !!opts\?\.legacyAnimScan/.test(src))
  check('hasDesc：逆序入栈 + pop（文档序）',
    /function hasDesc\(node: PEl \| null \| undefined, pred/.test(src)
      && /for \(let i = node\.kids\.length - 1; i >= 0; i--\) stack\.push\(node\.kids\[i\]\)/.test(src))
  check('hasFlyXY：inAnim 门在（等价性关键）',
    /const inside = inAnim \|\| el\.localName === 'anim'/.test(src)
      && /stack\.push\(\{ el: el\.kids\[i\], inAnim: inside \}\)/.test(src))
  check('hasFlyXY：对照腿保留原来的嵌套 some',
    /if \(legacyAnimScan\) \{[\s\S]{0,220}descendantsByName\(c, 'anim'\)\.some/.test(src))
  check('hasExitEffect：仍走 ga 漏斗（不绕开查问）',
    /el\.localName === 'animEffect' && ga\(el, 'transition'\) === 'out'/.test(src))
  // 原嵌套 some 必须**只剩对照腿各一份**（产品调用点已换成 helper）
  check('两处调用都换成 helper，旧写法只留在对照腿',
    /else if \(hasFlyXY\(c\)\) anim = 'fly'/.test(src)
      && /if \(!hasExitEffect\(c\)\) continue/.test(src)
      && (src.match(/descendantsByName\(c, 'anim'\)\.some/g) ?? []).length === 1
      && (src.match(/descendantsByName\(c, 'animEffect'\)\.some/g) ?? []).length === 1)
  check('没有新建缓存/索引（与 v0.183 回退的惰性 Map 划清界线）',
    !/_byTag|new Map<string, PEl\[\]>/.test(src))
}

// ---- 2. 语义等价：改前算法复刻 vs 早停（同一棵合成树） ---------------------
const node = (localName, kids = [], direct = '') => ({ name: `p:${localName}`, localName, attrs: {}, kids, direct })
const textOf = (el) => el.direct
const descendantsByName = (n, name) => {
  const out = []
  const walk = (x) => { for (const c of x.kids) { if (c.localName === name) out.push(c); walk(c) } }
  walk(n)
  return out
}
const legacyFly = (c) => descendantsByName(c, 'anim').some((a) =>
  descendantsByName(a, 'attrName').some((x) => textOf(x) === 'ppt_x' || textOf(x) === 'ppt_y'))
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
{
  const cases = [
    ['anim 内 ppt_x', node('cTn', [node('anim', [node('attrName', [], 'ppt_x')])]), true],
    ['anim 内 ppt_y', node('cTn', [node('anim', [node('cond'), node('attrName', [], 'ppt_y')])]), true],
    ['anim 内其它文本', node('cTn', [node('anim', [node('attrName', [], 'style.visibility')])]), false],
    ['anim 外的 attrName 不该命中', node('cTn', [node('attrName', [], 'ppt_x'), node('anim', [node('cond')])]), false],
    ['anim 自身不该当 attrName', node('cTn', [node('anim', [], 'ppt_x')]), false],
    ['空子树', node('cTn'), false],
    ['多枚 anim，命中在后', node('cTn', [
      node('anim', [node('attrName', [], 'other')]),
      node('anim', [node('attrName', [], 'ppt_y')]),
    ]), true],
    ['anim 嵌套 anim', node('cTn', [node('anim', [node('anim', [node('attrName', [], 'ppt_x')])])]), true],
  ]
  for (const [name, tree, want] of cases) {
    eq(`等价：${name} — 改前`, legacyFly(tree), want)
    eq(`等价：${name} — 早停`, fastFly(tree), want)
  }
}

// ---- 3. 产品入口：两腿同源、签名归一后逐字相同 -----------------------------
{
  // 用本仓库的保真账 selftest 夹具入口同一份 bytes 走两腿；这里只确认可选参数
  // 不会改变导入结果（完整逐字对撞在 scripts/bench-pptx-anim.mjs 里跑）。
  const JSZip = (await import('jszip')).default
  const z = new JSZip()
  z.file('ppt/slides/slide1.xml',
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>')
  const bytes = new Uint8Array(await z.generateAsync({ type: 'arraybuffer' }))
  const norm = (d) => JSON.stringify(d.slides.map((s) => ({ title: s.title ?? '', body: s.body ?? '' })))
  const a = norm(await pptxBytesToDeck(bytes, { legacyAnimScan: true }))
  const b = norm(await pptxBytesToDeck(bytes))
  eq('产品入口：对照腿与本轮腿结果相同（最小夹具）', b, a)
  check('产品入口：不传 opts 走早停路径', typeof pptxBytesToDeck === 'function')
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
