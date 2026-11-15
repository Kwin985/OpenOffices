// v0.204：Impress 查找/替换纯函数。
// 跑法：npx vite-node scripts/test-ppt-find.mjs

import { emptyDeck, newSlide } from '../src/lib/ppt.ts'
import {
  PPT_FIND_CAP, pptFind, pptReplaceAll, pptReplaceAt, pptMatchLabel, pptSlots,
} from '../src/lib/ppt-find.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}
const eq = (name, got, want) => check(name, got === want, `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)

const shape = (id, over = {}) => ({
  id, kind: 'text', x: 0.1, y: 0.1, w: 0.4, h: 0.2, text: '', ...over,
})

function deck() {
  const d = emptyDeck()
  d.title = 'Alpha 演示'
  const a = newSlide('bullets')
  a.title = 'Alpha 标题'
  a.body = 'alpha\nbeta Alpha'
  a.notes = '备注 Alpha'
  a.shapes = [
    shape('s1', { text: 'Alpha 文本框', name: '框 Alpha', alt: 'Alpha 说明', color: '#AlphaAABB' }),
    shape('s2', {
      kind: 'table',
      table: { rows: [['Alpha', 'B'], ['C', 'alpha']], hasHeader: true, headerFill: '#AlphaFFFF' },
    }),
    shape('s3', {
      kind: 'chart',
      chart: {
        chartType: 'column', title: 'Alpha 图表', cats: ['甲', 'Alpha'],
        series: [{ name: 'Alpha 系列', vals: [1, 2] }], stacked: false,
      },
    }),
    shape('s4', { kind: 'image', image: 'data:image/png;base64,Alpha' }),
  ]
  const b = newSlide('title')
  b.title = '另一页'
  b.body = '无命中'
  d.slides = [a, b]
  return d
}

// ---- 1. 槽与命中形状 ----
const d = deck()
const slots = pptSlots(d)
check('槽数合理', slots.length >= 16, `${slots.length}`)
check('槽顺序第一是演示名', slots[0].field === 'deckTitle')
const hits = pptFind(d, 'alpha')
eq('默认大小写不敏感命中数', hits.length, 13)
check('空 needle 返回空', pptFind(d, '').length === 0)
const cs = pptFind(d, 'alpha', true)
eq('区分大小写只命中全小写', cs.length, 2)
check('命中带字符区间', hits.every((h) => h.end > h.start))
check('命中带预览', hits.every((h) => typeof h.preview === 'string' && h.preview.length > 0))
check('正文里三次出现都在', pptFind(d, 'Alpha').filter((h) => h.field === 'body').length === 2)

// ---- 2. 不搜非文本 ----
const allText = slots.map((s) => s.text).join('\u0000')
check('不搜色值', !allText.includes('#AlphaAABB') && !allText.includes('#AlphaFFFF'))
check('不搜 data URI', !allText.includes('data:image/png'))
check('不搜形状 id', !allText.includes('s1\u0000'))
check('各字段都覆盖到', ['deckTitle', 'title', 'body', 'notes', 'shapeText', 'shapeName', 'shapeAlt',
  'tableCell', 'chartTitle', 'chartCat', 'chartSeries'].every((f) => slots.some((s) => s.field === f)))

// ---- 3. 替换全部：不可变 + 各字段都换 ----
const before = JSON.stringify(d)
const r = pptReplaceAll(d, 'alpha', 'X')
eq('替换全部次数', r.count, hits.length)
check('返回新 deck 引用', r.deck !== d)
check('原 deck 一寸未动', JSON.stringify(d) === before)
check('原 deck 的表格单元格未变', d.slides[0].shapes[1].table.rows[0][0] === 'Alpha')
check('原 deck 的图表系列未变', d.slides[0].shapes[2].chart.series[0].name === 'Alpha 系列')
eq('替换后无残留命中', pptFind(r.deck, 'alpha').length, 0)
check('演示名换了', r.deck.title === 'X 演示')
check('标题换了', r.deck.slides[0].title === 'X 标题')
check('正文换了', r.deck.slides[0].body === 'X\nbeta X')
check('备注换了', r.deck.slides[0].notes === '备注 X')
check('形状文字换了', r.deck.slides[0].shapes[0].text === 'X 文本框')
check('形状名/替代文本换了', r.deck.slides[0].shapes[0].name === '框 X' && r.deck.slides[0].shapes[0].alt === 'X 说明')
check('表格单元格换了', r.deck.slides[0].shapes[1].table.rows[0][0] === 'X' &&
  r.deck.slides[0].shapes[1].table.rows[1][1] === 'X')
check('图表标题/类目/系列换了', r.deck.slides[0].shapes[2].chart.title === 'X 图表' &&
  r.deck.slides[0].shapes[2].chart.cats[1] === 'X' &&
  r.deck.slides[0].shapes[2].chart.series[0].name === 'X 系列')
check('色值没被误改', r.deck.slides[0].shapes[0].color === '#AlphaAABB' &&
  r.deck.slides[0].shapes[1].table.headerFill === '#AlphaFFFF')
check('data URI 没被误改', r.deck.slides[0].shapes[3].image === 'data:image/png;base64,Alpha')
check('另一页未受影响', r.deck.slides[1].title === '另一页')
eq('无命中时返回原引用', pptReplaceAll(d, 'zzz', 'Y').deck, d)
eq('无命中时 count 0', pptReplaceAll(d, 'zzz', 'Y').count, 0)

// ---- 4. 替换单条 ----
const one = pptReplaceAt(d, 'alpha', 'Q', false, 0)
eq('单条 count', one.count, 1)
check('单条返回新 deck', one.deck !== d)
eq('单条后命中少一条', pptFind(one.deck, 'alpha').length, hits.length - 1)
check('单条只动演示名', one.deck.title === 'Q 演示' && one.deck.slides[0].title === 'Alpha 标题')
eq('越界 idx 不替换', pptReplaceAt(d, 'alpha', 'Q', false, 999).count, 0)
check('越界返回原引用', pptReplaceAt(d, 'alpha', 'Q', false, 999).deck === d)

// ---- 5. 正则元字符与大小写 ----
const meta = emptyDeck()
meta.slides[0].title = 'a.b [c] *d'
eq('点号是字面量', pptFind(meta, 'a.b').length, 1)
eq('方括号是字面量', pptFind(meta, '[c]').length, 1)
eq('星号是字面量', pptFind(meta, '*d').length, 1)
check('元字符替换是字面量', pptReplaceAll(meta, 'a.b', 'Z').deck.slides[0].title === 'Z [c] *d')
eq('区分大小写替换', pptReplaceAll(d, 'alpha', 'W', true).count, 2)

// ---- 6. 上限与标签 ----
const big = emptyDeck()
big.slides[0].body = 'x'.repeat(0) + 'a '.repeat(2100)
check('命中数封顶', pptFind(big, 'a').length === PPT_FIND_CAP)
check('标签含页码', pptMatchLabel(pptFind(d, 'beta')[0] ?? hits[1]).includes('第 1 页'))
check('演示名标签不带页码', pptMatchLabel(pptFind(d, 'Alpha')[0]) === '演示名')

console.log(`ppt-find: ${ok.length} 通过 / ${bad.length} 失败`)
for (const b of bad) console.error('  FAIL ' + b)
if (bad.length) process.exitCode = 1
