// 表格 PDF 导出的数据侧：Univer 是 canvas 渲染，PrintToPdf 抓不到整表，
// 故从保存用的 WorkbookPayload 自绘 HTML 网格
// （值/数字格式/粗斜/字号/字色/底色/边框/对齐/换行/合并）。
import type { BorderLine, CellPayload, CellStyle, SheetPayload, WorkbookPayload } from './fs'

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

// 边框样式名 → CSS（近似宽度/线型）
function borderCss(line: BorderLine | null | undefined): string | undefined {
  if (!line?.s) return undefined
  const color = line.c ?? '#000000'
  const map: Record<string, string> = {
    hair: `0.5px solid ${color}`,
    thin: `1px solid ${color}`,
    medium: `2px solid ${color}`,
    thick: `3px solid ${color}`,
    dashed: `1px dashed ${color}`,
    mediumDashed: `2px dashed ${color}`,
    dashDot: `1px dashed ${color}`,
    mediumDashDot: `2px dashed ${color}`,
    dashDotDot: `1px dashed ${color}`,
    mediumDashDotDot: `2px dashed ${color}`,
    slantDashDot: `1px dashed ${color}`,
    dotted: `1px dotted ${color}`,
    double: `3px double ${color}`,
  }
  return map[line.s] ?? `1px solid ${color}`
}

// 数字格式最小实现：千分位 / 小数位 / 百分比 / 文本 @，其余模式原样显示
export function formatNumberValue(v: number, pattern: string): string {
  if (pattern === '@') return String(v)
  const percent = pattern.includes('%')
  const dec = pattern.match(/\.([0#]+)/)
  const thousands = pattern.includes(',#') || /^#?,/.test(pattern)
  let n = v
  if (percent) n *= 100
  let out = dec ? n.toFixed(Math.min(dec[1].length, 20)) : String(n)
  if (thousands) {
    const [i, d] = out.split('.')
    out = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d != null ? `.${d}` : '')
  }
  return percent ? `${out}%` : out
}

function styleAttr(s: CellStyle | null | undefined): string {
  if (!s) return ''
  const parts: string[] = []
  if (s.bl) parts.push('font-weight:bold')
  if (s.it) parts.push('font-style:italic')
  if (s.fs) parts.push(`font-size:${Math.round(s.fs * 1.333)}px`) // pt→px
  if (s.ff) {
    const fam = s.ff.replace(/["'();<>\\]/g, '')
    if (fam) parts.push(`font-family:"${fam}"`)
  }
  if (s.cl) parts.push(`color:${esc(s.cl)}`)
  if (s.bg) parts.push(`background-color:${esc(s.bg)}`)
  if (s.ho) parts.push(`text-align:${s.ho === 'justify' ? 'justify' : s.ho}`)
  if (s.vo) parts.push(`vertical-align:${s.vo}`)
  if (s.wb) parts.push('white-space:normal')
  const bd = s.bd
  if (bd) {
    for (const [prop, line] of [
      ['border-left', bd.l],
      ['border-right', bd.r],
      ['border-top', bd.t],
      ['border-bottom', bd.b],
    ] as const) {
      const css = borderCss(line)
      if (css) parts.push(`${prop}:${css}`)
    }
  }
  return parts.length ? ` style="${parts.join(';')}"` : ''
}

function cellValue(v: CellPayload['v'], s: CellStyle | null | undefined): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'number' && s?.nf) return esc(formatNumberValue(v, s.nf))
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
  // 隐藏行列打印时整列/整行剔除（合并区跨隐藏列的 colspan 按近似保留）。
  // 被筛掉的行也在这一并列：Univer 只在界面上现算它，快照的行数据里根本没有这些行，
  // 而第三方件的筛选在 OOXML 里就是 hidden 行——两样落到同一处才不会打出一份没筛的表。
  const hidR = new Set([...(sheet.hiddenRows ?? []), ...(sheet.filter?.filteredOut ?? [])])
  const hidC = new Set(sheet.hiddenCols ?? [])
  // 列宽：colWidths 即像素，未设定的列用默认宽
  const colAt = (c: number) => {
    const px = sheet.colWidths?.[String(c)]
    return typeof px === 'number' && px > 0 && Number.isFinite(px)
      ? Math.round(px)
      : COL_WIDTH_PX
  }
  let colgroup = '<colgroup>'
  for (let c = 0; c <= maxCol; c++) {
    if (hidC.has(c)) continue
    colgroup += `<col style="width:${colAt(c)}px"/>`
  }
  colgroup += '</colgroup>'
  let rows = ''
  for (let r = 0; r <= maxRow; r++) {
    if (hidR.has(r)) continue
    let tds = ''
    for (let c = 0; c <= maxCol; c++) {
      if (hidC.has(c)) continue
      const key = `${r},${c}`
      if (covered.has(key)) continue
      const cell = grid.get(key)
      const sp = spanAt.get(key)
      const span = sp ? ` colspan="${sp.cs}" rowspan="${sp.rs}"` : ''
      tds += `<td${span}${styleAttr(cell?.s)}>${cellValue(cell?.v, cell?.s)}</td>`
    }
    const rh = sheet.rowHeights?.[String(r)]
    const h = typeof rh === 'number' && rh > 0 && Number.isFinite(rh) ? ` style="height:${Math.round(rh)}px"` : ''
    rows += `<tr${h}>${tds}</tr>`
  }
  const note = truncated
    ? `<p class="sheet-print-note">（内容超出打印上限 ${MAX_ROWS} 行 × ${MAX_COLS} 列，已截断）</p>`
    : ''
  return `<section${cls}>${head}<table class="sheet-print-table">${colgroup}${rows}</table>${note}</section>`
}

export function sheetsToPrintHtml(payload: WorkbookPayload): string {
  return payload.sheets.map((s, i) => sheetHtml(s, i === 0)).join('')
}
