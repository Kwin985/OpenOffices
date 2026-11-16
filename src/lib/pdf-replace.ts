// PDF 查找替换的规划与定位（v0.176）——纯函数，不碰 pdf.js / DOM。
//
// 搜索那一侧存的是 `Match { page, bItem, bOff, eItem, eOff }`（全文字符串偏移），
// 而写回那一侧要的是 `TextEdit`（未旋转空间的 x/y/size + 显示空间的包围盒）。
// 中间这层最容易写散，所以单独成模块：
//   replacementPlan —— 按「页 + 原文」给每处命中编号（同页同字串的第几次出现）；
//   locateReplace   —— 在文字项几何序列里按编号找到覆盖区间，合并成一个盒。
//
// 为什么不复用 Match 的 bItem 去索引 geoms：`loadPageGeom` 会丢掉
// `textItemBox` 返回 null 的项，两边下标未必一一对应。这里改用
// **geoms 自己的 str 拼串**来定位，自洽，不依赖另一份缓存的顺序。
//
// 诚实边界：定位不了（跨文字项且几何缺失、文字项被过滤）的命中返回 null，
// 由调用方跳过并如实报数，不假装替换成功；大小写折叠沿用搜索的 toLowerCase。

import type { PdfRect, TextItemGeom } from './pdf-geo'

export interface ReplaceMatch {
  page: number
  /** 命中的原文（保留原始大小写，来自搜索那一趟的 PageText.full） */
  from: string
}

export interface ReplacePlanItem extends ReplaceMatch {
  /** 替换成什么 */
  to: string
  /** 同页同 from 的第几次出现（0 起），交给 locateReplace */
  occurrence: number
}

export interface ReplaceGeom {
  /** 未旋转 PDF 空间的文字起点，写回 drawText 用（取覆盖区间的第一项） */
  x: number
  y: number
  size: number
  /** 显示空间的并集包围盒，盖底色 / 画虚线框用 */
  box: PdfRect
}

export function replacementPlan(matches: ReplaceMatch[], to: string): ReplacePlanItem[] {
  const seen = new Map<string, number>()
  return matches.map((m) => {
    const key = `${m.page}\u0000${m.from}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return { page: m.page, from: m.from, to, occurrence: n }
  })
}

function unionRect(boxes: PdfRect[]): PdfRect {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h))
  return { x, y, w: right - x, h: bottom - y }
}

export function locateReplace(
  items: TextItemGeom[],
  from: string,
  occurrence = 0,
): ReplaceGeom | null {
  if (!from || !items.length || !Number.isInteger(occurrence) || occurrence < 0) return null
  const full = items.map((i) => i.str ?? '').join('')
  let at = -1
  let seen = -1
  for (;;) {
    at = full.indexOf(from, at + 1)
    if (at < 0) return null
    if (++seen === occurrence) break
  }
  const end = at + from.length
  let acc = 0
  let first = -1
  let last = -1
  for (let i = 0; i < items.length; i++) {
    const s = acc
    const e = acc + (items[i].str?.length ?? 0)
    if (first < 0 && e > at) first = i
    if (first >= 0 && s < end) last = i
    acc = e
  }
  if (first < 0 || last < first) return null
  const picks = items.slice(first, last + 1)
  return {
    x: picks[0].x,
    y: picks[0].y,
    size: picks[0].size,
    box: unionRect(picks.map((p) => p.box)),
  }
}
