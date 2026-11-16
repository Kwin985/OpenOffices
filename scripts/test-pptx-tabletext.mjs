// v0.191 断言：pptx 表格单元格文本零数组（v0.185 顺延的最后一处摊平）。
//
// 改前 `descendantsByName(tc,'t').map(textOf).join('')` 把整棵子树摊平成两个
// 数组；改后 `tableCellText` 一次前序、命中 a:t 即拼接。**语义刻意不变**：
// 仍是「一个单元格里所有 a:t 摊平成一个串」，不插段落换行（教训㉖）。
//
// 跑法：npx vite-node scripts/test-pptx-tabletext.mjs

import fs from 'node:fs'
import { emptyDeck, newSlide } from '../src/lib/ppt.ts'
import { deckToPptxBytes } from '../src/lib/pptx-export.ts'
import { pptxBytesToDeck, tableCellText } from '../src/lib/pptx-import.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `得到 ${JSON.stringify(got)} / 期望 ${JSON.stringify(want)}`)
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const el = (localName, kids = [], direct = '') => ({ name: `a:${localName}`, localName, attrs: {}, kids, direct })
const t = (s) => el('t', [], s)
const textOfLocal = (e) => {
  if (e._text !== undefined) return e._text
  let s = e.direct
  for (const k of e.kids) s += textOfLocal(k)
  e._text = s
  return s
}
/** 改前算法复刻：先摊平成数组，再 map(textOf) + join + trim */
const legacyCellText = (tc) => {
  const out = []
  const walk = (n) => {
    for (const c of n.kids) {
      if (c.localName === 't') out.push(c)
      walk(c)
    }
  }
  walk(tc)
  return out.map(textOfLocal).join('').trim()
}

async function main() {
  // ── ① 纯函数：与改前逐字相同（不改语义） ──────────────────────────
  const cases = [
    { name: '空单元格', tc: el('tc') },
    { name: '单枚 a:t', tc: el('tc', [t('甲')]) },
    { name: '两段各自多枚 a:t（跨段落仍摊平，不插换行）', tc: el('tc', [
      el('p', [t('第一'), t('段')]), el('p', [t('第二'), t('段')]),
    ]) },
    { name: '深层嵌套', tc: el('tc', [el('txBody', [el('p', [el('r', [t('深')]), t('浅')])])]) },
    { name: 'a:t 自身带子节点', tc: el('tc', [el('t', [t('嵌套文字')], '前缀')]) },
    { name: '首尾空白被 trim', tc: el('tc', [t('  前后  ')]) },
    { name: '非 t 节点带 direct 文本（不算进去）', tc: el('tc', [el('p', [t('算')], '不算')]) },
  ]
  for (const c of cases) {
    const a = legacyCellText(c.tc), b = tableCellText(JSON.parse(JSON.stringify(c.tc)))
    eq(c.name, b, a)
  }
  eq('two 段不插换行', tableCellText(el('tc', [el('p', [t('A')]), el('p', [t('B')])])), 'AB')

  // ── ② 端到端：含表格的 pptx 两腿 Deck 逐字相同 ───────────────────
  const slide = newSlide('blank')
  slide.shapes = [{
    id: 'tbl1', kind: 'table', x: 80, y: 80, w: 500, h: 240,
    table: {
      rows: [['表头一', '表头二', '表头三'], ['内容甲', '内容乙', '内容丙'], ['末行一', '末行二', '末行三']],
      hasHeader: true,
    },
  }]
  const deck = { ...emptyDeck(), slides: [slide] }
  const bytes = await deckToPptxBytes(deck)
  const stable = (v, key = '') => {
    if (key === 'id') return '<id>'
    if (v instanceof Map) return ['Map', [...v.entries()].map(([k, x]) => [k, stable(x)])]
    if (Array.isArray(v)) return v.map((x) => stable(x))
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k], k)]))
    return v
  }
  const A = await pptxBytesToDeck(bytes, { legacyTblText: true })
  const B = await pptxBytesToDeck(bytes)
  eq('两腿 Deck 稳定序列化逐字相同', stable(B), stable(A))
  const tblA = A.slides[0]?.shapes?.find((s) => s.kind === 'table')?.table
  const tblB = B.slides[0]?.shapes?.find((s) => s.kind === 'table')?.table
  check('夹具确实走到表格路径（两腿都读到三行）', !!tblA && !!tblB && tblA.rows.length === 3 && tblB.rows.length === 3)
  eq('单元格文本与导出前一致', tblB.rows[1], ['内容甲', '内容乙', '内容丙'])

  // ── ③ 源码级：入口开关与零数组 ───────────────────────────────────
  const w = read('../src/lib/pptx-import.ts')
  check('纯函数是导出的', /export function tableCellText\(tc: PEl\)/.test(w))
  check('产品路径走 tableCellText', /: tableCellText\(tc\)/.test(w))
  check('对照腿复刻改前摊平数组', /legacyTblText\s*\?\s*descendantsByName\(tc, 't'\)\.map\(\(t\) => textOf\(t\)\)\.join\(''\)\.trim\(\)/.test(w))
  check('入口有独立开关', /legacyTblText\?: boolean/.test(w) && /legacyTblText = !!opts\?\.legacyTblText/.test(w))
  check('单次前序、无临时数组', /if \(k\.localName === 't'\) s \+= textOf\(k\)/.test(w))
}

await main()
console.log(`通过 ${ok.length} 项` + (bad.length ? `，**失败 ${bad.length} 项**` : '，失败 0 项'))
for (const b of bad) console.log(`FAIL ${b}`)
if (bad.length) process.exitCode = 1
