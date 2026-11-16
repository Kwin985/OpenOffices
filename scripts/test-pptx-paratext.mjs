// v0.185 pptx 导入文本拼接「零数组」断言。
//
// 改前：`paragraphText` 用 `descendantsByName(p,'t').map(textOf).join('')`，
// 每个形状的每个段落都要把整棵子树按名摊平成两个数组。改后：一次前序遍历、
// 命中 `a:t` 即取文本并累加，零中间数组、不建缓存（与 v0.184 早停同族，
// 区别是这里「命中即拼接」而不是「命中即返回」）。
//
// 跑法：npx vite-node scripts/test-pptx-paratext.mjs

import fs from 'node:fs'
import { emptyDeck, newSlide } from '../src/lib/ppt.ts'
import { deckToPptxBytes } from '../src/lib/pptx-export.ts'
import { pptxBytesToDeck } from '../src/lib/pptx-import.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

// ---- 1. 源码级纪律 ----------------------------------------------------------
{
  const src = read('../src/lib/pptx-import.ts')
  check('入口：legacyParaText 可选参数', /legacyParaText\?: boolean/.test(src)
    && /legacyParaText = !!opts\?\.legacyParaText/.test(src))
  check('对照腿保留原来的两次数组物化', /if \(legacyParaText\) \{[\s\S]{0,180}descendantsByName\(p, 't'\)[\s\S]{0,80}\.map\(\(t\) => textOf\(t\)\)/.test(src))
  check('产品路径：单次前序 + 命中即拼接', /let s = ''/.test(src) && /if \(k\.localName === 't'\) s \+= textOf\(k\)/.test(src))
  check('产品路径：命中后不递归（a:t 是叶子，textOf 已含后代文本）', /if \(k\.localName === 't'\) s \+= textOf\(k\)\s*else walk\(k\)/.test(src))
  check('没有新建缓存 / 索引', !/_byTag|new Map<string, PEl\[\]>/.test(src))
  // 表格单元格那一处仍是摊平数组（按格收集、不是逐段热路径），本轮**刻意不动**：
  // 把它算进「只剩一份」会假红，把它顺手改掉又会让本轮范围失控
  check('paragraphText 的旧写法只剩对照腿一份',
    /if \(legacyParaText\) \{[\s\S]{0,220}\.map\(\(t\) => textOf\(t\)\)/.test(src))
  check('表格单元格那处仍按格摊平（诚实边界）', /descendantsByName\(tc, 't'\)/.test(src))
  eq('全文件只有两处 map(textOf)：对照腿 + 表格', (src.match(/\.map\(\(t\) => textOf\(t\)\)/g) ?? []).length, 2)
}

// ---- 2. 语义等价：改前算法复刻 vs 单次前序（同一棵合成 PEl 树） -------------
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
{
  const cases = [
    ['空段', node('p')],
    ['单 run 单 t', node('p', [node('r', [node('t', [], '正文')])])],
    ['多 run 顺序拼接', node('p', [node('r', [node('t', [], '甲')]), node('r', [node('t', [], '乙')]), node('br'), node('r', [node('t', [], '丙')])])],
    ['rPr 噪声不进文本', node('p', [node('r', [node('rPr', [], '不该出现'), node('t', [], '要出现')])])],
    ['fld 内的 a:t 也收（同为后代）', node('p', [node('fld', [node('t', [], '页码')])])],
    ['深层嵌套', node('p', [node('r', [node('x', [node('y', [node('t', [], '深')])])])])],
    ['endParaRPr 不带 t', node('p', [node('endParaRPr')])],
    ['空 t 与有字 t 混排', node('p', [node('r', [node('t'), node('t', [], '后')])])],
  ]
  for (const [name, tree] of cases) {
    const a = legacyText(tree), b = fastText(tree)
    eq(`等价：${name}`, b, a)
  }
  check('等价：普通文本确实被拼出来', fastText(cases[2][1]), '甲乙丙')
  check('等价：rPr 的直接文本没混进结果', fastText(cases[3][1]), '要出现')
}

// ---- 3. 产品入口：两腿同源、签名归一后逐字相同 -----------------------------
{
  const slides = []
  for (let i = 0; i < 3; i++) {
    const s = newSlide('bullets')
    s.title = `第 ${i + 1} 页标题`
    s.body = Array.from({ length: 8 }, (_, j) => `第 ${j + 1} 条要点文字`).join('\n')
    slides.push(s)
  }
  const bytes = await deckToPptxBytes({ ...emptyDeck(), slides })
  const stable = (v, key = '') => {
    if (key === 'id') return '<id>'
    if (v instanceof Map) return ['Map', [...v.entries()].map(([k, x]) => [k, stable(x)])]
    if (Array.isArray(v)) return v.map((x) => stable(x))
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k], k)]))
    return v
  }
  const sig = (d) => JSON.stringify(stable(d))
  const a = sig(await pptxBytesToDeck(bytes, { legacyParaText: true }))
  const b = sig(await pptxBytesToDeck(bytes))
  eq('产品入口：对照腿与本轮腿 Deck 逐字相同', b, a)
  check('产品入口：夹具正文确实被导入（A/B 测的是真文本路径）', /第 1 条要点文字/.test(b))
  // 两个开关互不干扰：同时开也只走各自那条旧路径，结果仍应相同
  const c = sig(await pptxBytesToDeck(bytes, { legacyAnimScan: true, legacyParaText: true }))
  eq('产品入口：与 v0.184 的开关互不干扰', c, a)
}

console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
