// 表格 PDF 导出的数据侧：Univer 是 canvas 渲染，PrintToPdf 抓不到整表，
// 故从保存用的 WorkbookPayload 自绘 HTML 网格
// （值/数字格式/粗斜/字号/字色/底色/边框/对齐/换行/合并 + 条件格式算出的着色 + 图表位图）。
import { evalSheetCondFormats, PRINT_MAX_COLS, PRINT_MAX_ROWS } from './sheet-cf-print'
import type { CfPatch } from './sheet-cf-print'
import type { BorderLine, CellPayload, CellStyle, SheetPayload, WorkbookPayload } from './fs'

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

function styleParts(s: CellStyle | null | undefined, cf?: CfPatch): string[] {
  const parts: string[] = []
  const color = cf?.cl ?? s?.cl
  const fill = cf?.bg ?? s?.bg
  if (cf?.bl || s?.bl) parts.push('font-weight:bold')
  if (cf?.it || s?.it) parts.push('font-style:italic')
  if (s?.fs) parts.push(`font-size:${Math.round(s.fs * 1.333)}px`) // pt→px
  if (s?.ff) {
    const fam = s.ff.replace(/["'();<>\\]/g, '')
    if (fam) parts.push(`font-family:"${fam}"`)
  }
  if (color) parts.push(`color:${esc(color)}`)
  if (fill) parts.push(`background-color:${esc(fill)}`)
  // 数据条画在底色之上：CSS 的 background-image 与 background-color 本来就分层
  if (cf?.bar) parts.push(`background-image:${esc(cf.bar)}`)
  const deco = [cf?.ul && 'underline', cf?.st && 'line-through'].filter(Boolean).join(' ')
  if (deco) parts.push(`text-decoration:${deco}`)
  if (s?.ho) parts.push(`text-align:${s.ho === 'justify' ? 'justify' : s.ho}`)
  if (s?.vo) parts.push(`vertical-align:${s.vo}`)
  if (s?.wb) parts.push('white-space:normal')
  const bd = s?.bd
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
  return parts
}

function cellText(v: CellPayload['v'], s: CellStyle | null | undefined, cf?: CfPatch): string {
  if (cf?.hideValue || v === undefined || v === null) return ''
  if (typeof v === 'number' && s?.nf) return esc(formatNumberValue(v, s.nf))
  return esc(String(v))
}

interface ChartSlot {
  src: string
  width: number
  height: number
  label: string
}

function sheetHtml(
  sheet: SheetPayload,
  first: boolean,
  chartImages: (string | undefined)[] | undefined,
): { html: string; notes: string[] } {
  const notes: string[] = []
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
  const charts = sheet.charts ?? []
  // 图表的锚点格也算网格的一部分：图表本来就常浮在数据块右下方，
  // 只按数据定界会把锚点整个裁掉——那张图在打印里就此不见了
  for (const ch of charts) {
    if (ch.anchorRow > maxRow) maxRow = ch.anchorRow
    if (ch.anchorCol > maxCol) maxCol = ch.anchorCol
  }
  if (maxRow < 0 || maxCol < 0) {
    // 标题行始终给：没标题就没人知道这一页是哪个表打印出来的
    return { html: `<section${cls}>${head}<p>（空表）</p></section>`, notes }
  }
  const truncated = maxRow >= PRINT_MAX_ROWS || maxCol >= PRINT_MAX_COLS
  maxRow = Math.min(maxRow, PRINT_MAX_ROWS - 1)
  maxCol = Math.min(maxCol, PRINT_MAX_COLS - 1)
  // 合并覆盖矩阵：非左上角跳过，左上角带 rowspan/colspan
  const covered = new Set<string>()
  const spanAt = new Map<string, { cs: number; rs: number }>()
  const mergeStart = new Map<string, string>()
  for (const m of sheet.merges ?? []) {
    spanAt.set(`${m.startRow},${m.startColumn}`, {
      cs: m.endColumn - m.startColumn + 1,
      rs: m.endRow - m.startRow + 1,
    })
    for (let r = m.startRow; r <= Math.min(m.endRow, maxRow); r++)
      for (let c = m.startColumn; c <= Math.min(m.endColumn, maxCol); c++) {
        if (r !== m.startRow || c !== m.startColumn) {
          covered.add(`${r},${c}`)
          mergeStart.set(`${r},${c}`, `${m.startRow},${m.startColumn}`)
        }
      }
  }
  // 隐藏行列打印时整列/整行剔除（合并区跨隐藏列的 colspan 按近似保留）。
  // 被筛掉的行也在这一并列：Univer 只在界面上现算它，快照的行数据里根本没有这些行，
  // 而第三方件的筛选在 OOXML 里就是 hidden 行——两样落到同一处才不会打出一份没筛的表。
  const hidR = new Set([...(sheet.hiddenRows ?? []), ...(sheet.filter?.filteredOut ?? [])])
  const hidC = new Set(sheet.hiddenCols ?? [])
  const cf = evalSheetCondFormats(sheet)
  notes.push(...cf.notes)
  // 图表锚在哪一格就挂在哪一格里（绝对定位从该格左上角起算），锚点被吞时退到合并区左上角
  const slots = new Map<string, ChartSlot[]>()
  charts.forEach((ch, i) => {
    const src = chartImages?.[i]
    const label = ch.title || `第 ${i + 1} 张`
    if (!src) {
      notes.push(`图表「${label}」没能渲染成图片，打印里是空的`)
      return
    }
    const k = `${ch.anchorRow},${ch.anchorCol}`
    const at = mergeStart.get(k) ?? k
    const [r, c] = at.split(',').map(Number)
    if (hidR.has(r) || hidC.has(c)) {
      notes.push(`图表「${label}」锚在隐藏行/列上，打印里没有它的位置`)
      return
    }
    if (r > maxRow || c > maxCol) {
      notes.push(
        `图表「${label}」锚在第 ${r + 1} 行第 ${c + 1} 列，超出打印上限 ${PRINT_MAX_ROWS} 行 × ${PRINT_MAX_COLS} 列，未放置`,
      )
      return
    }
    const list = slots.get(at) ?? []
    list.push({ src, width: ch.width, height: ch.height, label })
    slots.set(at, list)
  })
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
      const paint = cf.patches.get(key)
      const mine = slots.get(key)
      const imgs = (mine ?? [])
        .map(
          (s) =>
            `<img class="sheet-print-chart" alt="${esc(s.label)}" src="${s.src}" style="width:${Math.round(
              s.width,
            )}px;height:${Math.round(s.height)}px"/>`,
        )
        .join('')
      // 表格单元格默认裁掉溢出，浮在格上的图表要看得见就得先放开这一格
      const extra = mine ? ['position:relative', 'overflow:visible'] : []
      const parts = [...extra, ...styleParts(cell?.s, paint)]
      const style = parts.length ? ` style="${parts.join(';')}"` : ''
      tds += `<td${span}${style}>${imgs}${cellText(cell?.v, cell?.s, paint)}</td>`
    }
    const rh = sheet.rowHeights?.[String(r)]
    const h = typeof rh === 'number' && rh > 0 && Number.isFinite(rh) ? ` style="height:${Math.round(rh)}px"` : ''
    rows += `<tr${h}>${tds}</tr>`
  }
  const printNotes = [...notes]
  if (truncated) {
    printNotes.push(`内容超出打印上限 ${PRINT_MAX_ROWS} 行 × ${PRINT_MAX_COLS} 列，已截断`)
  }
  // 页面上只留"这份打印件缺了什么"这一条（拿到纸上看的人才用得上），其余账目交回调用方进状态栏
  const note = truncated
    ? `<p class="sheet-print-note">（内容超出打印上限 ${PRINT_MAX_ROWS} 行 × ${PRINT_MAX_COLS} 列，已截断）</p>`
    : ''
  return {
    html: `<section${cls}>${head}<table class="sheet-print-table">${colgroup}${rows}</table>${note}</section>`,
    notes: printNotes,
  }
}

export function sheetsToPrintHtml(
  payload: WorkbookPayload,
  chartImages?: (string | undefined)[][],
): { html: string; notes: string[] } {
  const notes: string[] = []
  const html = payload.sheets
    .map((s, i) => {
      const r = sheetHtml(s, i === 0, chartImages?.[i])
      notes.push(...r.notes)
      return r.html
    })
    .join('')
  return { html, notes }
}
