// Impress 查找 / 替换（v0.204）。
//
// 为什么单独一份：Writer 的 find-replace.ts 是 ProseMirror/TipTap 的 Extension，
// 靠 PMNode 的位置与 decoration 干活；Impress 是纯 React 状态 + 自研 Deck，
// 没有 PM 树。这一份只在 Deck 的**用户可见文本槽**上做纯函数读写，
// 不碰编辑器、不碰 DOM，Node 侧能直接钉。
//
// 三个诚实边界：
//   1. 只搜文本槽（标题/正文/备注/形状文字/形状名与替代文本/表格单元格/
//      图表标题·类目·系列名）；不搜 id、色值、坐标、data URI、枚举。
//   2. 一个命中是「某个槽里的某一次出现」，同一段文字里出现三次算三条。
//   3. 替换返回**新 Deck**（slides/shapes/table/chart 逐层换引用），
//      原对象一寸不动——memo(StaticSlide) 与自动保存都靠引用变化认人。

import type { Deck } from './ppt'

export const PPT_FIND_CAP = 2000

export type PptField =
  | 'deckTitle' | 'title' | 'body' | 'notes'
  | 'shapeText' | 'shapeName' | 'shapeAlt'
  | 'tableCell' | 'chartTitle' | 'chartCat' | 'chartSeries'

/** 一个文本槽的位置 + 当时的文本。 */
export interface PptSlot {
  slideIdx: number // -1 = 整份演示的标题（不属任何一页）
  field: PptField
  shapeIdx?: number
  row?: number
  col?: number
  catIdx?: number
  seriesIdx?: number
  text: string
}

/** 一条命中 = 一个槽 + 该槽内的字符区间。 */
export interface PptMatch extends PptSlot {
  start: number
  end: number
  preview: string
}

function push(out: PptSlot[], slideIdx: number, field: PptField, text: string | undefined, extra: Partial<PptSlot> = {}) {
  if (text) out.push({ slideIdx, field, text, ...extra })
}

/** 全 deck 的文本槽，顺序固定：演示名 → 逐页（标题/正文/备注/形状…）。 */
export function pptSlots(deck: Deck): PptSlot[] {
  const out: PptSlot[] = []
  push(out, -1, 'deckTitle', deck.title)
  deck.slides.forEach((s, si) => {
    push(out, si, 'title', s.title)
    push(out, si, 'body', s.body)
    push(out, si, 'notes', s.notes)
    s.shapes?.forEach((sh, shi) => {
      push(out, si, 'shapeText', sh.text, { shapeIdx: shi })
      push(out, si, 'shapeName', sh.name, { shapeIdx: shi })
      push(out, si, 'shapeAlt', sh.alt, { shapeIdx: shi })
      sh.table?.rows.forEach((row, r) =>
        row.forEach((cell, c) =>
          push(out, si, 'tableCell', cell, { shapeIdx: shi, row: r, col: c })))
      const ch = sh.chart
      if (ch) {
        push(out, si, 'chartTitle', ch.title, { shapeIdx: shi })
        ch.cats.forEach((cat, i) => push(out, si, 'chartCat', cat, { shapeIdx: shi, catIdx: i }))
        ch.series.forEach((ser, i) => push(out, si, 'chartSeries', ser.name, { shapeIdx: shi, seriesIdx: i }))
      }
    })
  })
  return out
}

/** 换引用地复制一层：只动可能被写到的那些结构，其余原样共享。 */
function cloneDeck(deck: Deck): Deck {
  return {
    ...deck,
    slides: deck.slides.map((s) => ({
      ...s,
      shapes: s.shapes?.map((sh) => ({
        ...sh,
        ...(sh.table ? { table: { ...sh.table, rows: sh.table.rows.map((r) => [...r]) } } : {}),
        ...(sh.chart
          ? {
              chart: {
                ...sh.chart,
                cats: [...sh.chart.cats],
                series: sh.chart.series.map((x) => ({ ...x, vals: [...x.vals] })),
              },
            }
          : {}),
      })),
    })),
  }
}

/** 在已复制的 Deck 上把一个槽写回。调用方必须传 cloneDeck 的结果。 */
function writeSlot(deck: Deck, slot: PptSlot, value: string): void {
  const si = slot.slideIdx
  if (si < 0) {
    deck.title = value
    return
  }
  const s = deck.slides[si]
  if (!s) return
  switch (slot.field) {
    case 'title': s.title = value; return
    case 'body': s.body = value; return
    case 'notes': s.notes = value; return
    default: break
  }
  const sh = slot.shapeIdx === undefined ? undefined : s.shapes?.[slot.shapeIdx]
  if (!sh) return
  switch (slot.field) {
    case 'shapeText': sh.text = value; return
    case 'shapeName': sh.name = value; return
    case 'shapeAlt': sh.alt = value; return
    case 'tableCell':
      if (sh.table && slot.row !== undefined && slot.col !== undefined) {
        sh.table.rows[slot.row][slot.col] = value
      }
      return
    case 'chartTitle': if (sh.chart) sh.chart.title = value; return
    case 'chartCat':
      if (sh.chart && slot.catIdx !== undefined) sh.chart.cats[slot.catIdx] = value
      return
    case 'chartSeries':
      if (sh.chart && slot.seriesIdx !== undefined) sh.chart.series[slot.seriesIdx].name = value
      return
    default: return
  }
}

function previewOf(text: string, start: number, end: number): string {
  const a = Math.max(0, start - 12)
  const b = Math.min(text.length, end + 12)
  return `${a ? '…' : ''}${text.slice(a, b).replace(/\r?\n/g, ' ')}${b < text.length ? '…' : ''}`
}

/** 在一个字符串里找 needle 的所有出现（大小写可选，不重叠）。 */
function indicesOf(text: string, needle: string, caseSensitive: boolean): [number, number][] {
  const hay = caseSensitive ? text : text.toLowerCase()
  const n = caseSensitive ? needle : needle.toLowerCase()
  if (!n) return []
  const out: [number, number][] = []
  let from = 0
  for (;;) {
    const i = hay.indexOf(n, from)
    if (i < 0) break
    out.push([i, i + n.length])
    from = i + Math.max(1, n.length)
  }
  return out
}

/** 全 deck 查找；按槽顺序、槽内从左到右，最多 PPT_FIND_CAP 条。 */
export function pptFind(deck: Deck, needle: string, caseSensitive = false): PptMatch[] {
  if (!needle) return []
  const out: PptMatch[] = []
  for (const slot of pptSlots(deck)) {
    for (const [start, end] of indicesOf(slot.text, needle, caseSensitive)) {
      out.push({ ...slot, start, end, preview: previewOf(slot.text, start, end) })
      if (out.length >= PPT_FIND_CAP) return out
    }
  }
  return out
}

/** 把一段文字里的所有出现换掉（不用正则，避免用户输入被当元字符）。 */
function replaceAllInText(text: string, needle: string, replacement: string, caseSensitive: boolean): string {
  const hits = indicesOf(text, needle, caseSensitive)
  if (!hits.length) return text
  let out = ''
  let from = 0
  for (const [a, b] of hits) {
    out += text.slice(from, a) + replacement
    from = b
  }
  return out + text.slice(from)
}

export interface PptReplaceResult {
  deck: Deck
  count: number
}

/** 替换全部命中；返回新 Deck 与替换次数。原 Deck 不变。 */
export function pptReplaceAll(deck: Deck, needle: string, replacement: string, caseSensitive = false): PptReplaceResult {
  const hits = pptFind(deck, needle, caseSensitive)
  if (!hits.length) return { deck, count: 0 }
  const next = cloneDeck(deck)
  for (const slot of pptSlots(deck)) {
    const value = replaceAllInText(slot.text, needle, replacement, caseSensitive)
    if (value !== slot.text) writeSlot(next, slot, value)
  }
  return { deck: next, count: hits.length }
}

/** 只替换第 matchIdx 条命中；UI 替换完应重新 pptFind（索引会变）。 */
export function pptReplaceAt(deck: Deck, needle: string, replacement: string, caseSensitive: boolean, matchIdx: number): PptReplaceResult {
  const hits = pptFind(deck, needle, caseSensitive)
  const hit = hits[matchIdx]
  if (!hit) return { deck, count: 0 }
  const next = cloneDeck(deck)
  const value = hit.text.slice(0, hit.start) + replacement + hit.text.slice(hit.end)
  writeSlot(next, hit, value)
  return { deck: next, count: 1 }
}

/** 面板里给一条命中写的位置标签。 */
export function pptMatchLabel(m: PptMatch): string {
  const page = m.slideIdx < 0 ? '演示名' : `第 ${m.slideIdx + 1} 页`
  switch (m.field) {
    case 'deckTitle': return '演示名'
    case 'title': return `${page} · 标题`
    case 'body': return `${page} · 正文`
    case 'notes': return `${page} · 备注`
    case 'shapeText': return `${page} · 文本框 ${(m.shapeIdx ?? 0) + 1}`
    case 'shapeName': return `${page} · 形状名 ${(m.shapeIdx ?? 0) + 1}`
    case 'shapeAlt': return `${page} · 替代文本 ${(m.shapeIdx ?? 0) + 1}`
    case 'tableCell': return `${page} · 表格 ${(m.row ?? 0) + 1} 行 ${(m.col ?? 0) + 1} 列`
    case 'chartTitle': return `${page} · 图表标题`
    case 'chartCat': return `${page} · 图表类目 ${(m.catIdx ?? 0) + 1}`
    case 'chartSeries': return `${page} · 系列名 ${(m.seriesIdx ?? 0) + 1}`
    default: return page
  }
}
