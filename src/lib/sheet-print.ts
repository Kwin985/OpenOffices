// 表格 PDF 导出的数据侧：Univer 是 canvas 渲染，PrintToPdf 抓不到整表，
// 故从保存用的 WorkbookPayload 自绘 HTML 网格（值/粗斜/字号/字色/底色/合并）。
import type { CellPayload, CellStyle, SheetPayload, WorkbookPayload } from './fs'

const MAX_ROWS = 2000
const MAX_COLS = 120
const COL_WIDTH_PX = 96

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function styleAttr(s: CellStyle | null | undefined): string {
  if (!s) return ''
  const parts: string[] = []
  if (s.bl) parts.push('font-weight:bold')
  if (s.it) parts.push('font-style:italic')
  if (s.fs) parts.push(`font-size:${Math.round(s.fs * 1.333)}px`) // pt→px
  if (s.cl) parts.push(`color:${esc(s.cl)}`)
  if (s.bg) parts.push(`background-color:${esc(s.bg)}`)
  return parts.length ? ` style="${parts.join(';')}"` : ''
}

function cellValue(v: CellPayload['v']): string {
  if (v === undefined || v === null) return ''
  return esc(String(v))
}

function sheetHtml(sheet: SheetPayload, first: boolean): string {
  const head = `<h3 class="sheet-print-title">${esc(sheet.name)}</h3>`
  const cls = first ? '' : ' class="sheet-print-break"'
  const grid = new Map<string, CellPayload>()
  let maxRow = -1
  let maxCol = -1
  for (const x of sheet.cells) {
    grid.set(`${x.r},${x.c}`, x)
    if (x.r > maxRow) maxRow = x.r
    if (x.c > maxCol) maxCol = x.c
  }
  for (const m of sheet.merges ?? []) {
    if (m.endRow > maxRow) maxRow = m.endRow
    if (m.endColumn > maxCol) maxCol = m.endColumn
  }
  if (maxRow < 0 || maxCol < 0) return `<section${cls}>${head}<p>（空表）</p></section>`
  const truncated = maxRow >= MAX_ROWS || maxCol >= MAX_COLS
  maxRow = Math.min(maxRow, MAX_ROWS - 1)
  maxCol = Math.min(maxCol, MAX_COLS - 1)
  // 合并覆盖矩阵：非左上角跳过，左上角带 rowspan/colspan
  const covered = new Set<string>()
  const spanAt = new Map<string, { cs: number; rs: number }>()
  for (const m of sheet.merges ?? []) {
    spanAt.set(`${m.startRow},${m.startColumn}`, {
      cs: m.endColumn - m.startColumn + 1,
      rs: m.endRow - m.startRow + 1,
    })
    for (let r = m.startRow; r <= Math.min(m.endRow, maxRow); r++)
      for (let c = m.startColumn; c <= Math.min(m.endColumn, maxCol); c++)
        if (r !== m.startRow || c !== m.startColumn) covered.add(`${r},${c}`)
  }
  const col = `<col style="width:${COL_WIDTH_PX}px"/>`
  const colgroup = `<colgroup>${col.repeat(maxCol + 1)}</colgroup>`
  let rows = ''
  for (let r = 0; r <= maxRow; r++) {
    let tds = ''
    for (let c = 0; c <= maxCol; c++) {
      const key = `${r},${c}`
      if (covered.has(key)) continue
      const cell = grid.get(key)
      const sp = spanAt.get(key)
      const span = sp ? ` colspan="${sp.cs}" rowspan="${sp.rs}"` : ''
      tds += `<td${span}${styleAttr(cell?.s)}>${cellValue(cell?.v)}</td>`
    }
    rows += `<tr>${tds}</tr>`
  }
  const note = truncated
    ? `<p class="sheet-print-note">（内容超出打印上限 ${MAX_ROWS} 行 × ${MAX_COLS} 列，已截断）</p>`
    : ''
  return `<section${cls}>${head}<table class="sheet-print-table">${colgroup}${rows}</table>${note}</section>`
}

export function sheetsToPrintHtml(payload: WorkbookPayload): string {
  return payload.sheets.map((s, i) => sheetHtml(s, i === 0)).join('')
}
