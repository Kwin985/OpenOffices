// 表格 PDF 导出的数据侧：Univer 是 canvas 渲染，PrintToPdf 抓不到整表，
// 故从保存用的 WorkbookPayload 自绘 HTML 网格
// （值/数字格式/粗斜/字号/字色/底色/边框/对齐/换行/合并 + 条件格式算出的着色 + 图表位图
// + 页面设置：打印区域、重复标题行列、手动分页符、列带、缩放、网格线、行列标题、水平居中）。
import { evalSheetCondFormats, PRINT_MAX_COLS, PRINT_MAX_ROWS } from './sheet-cf-print'
import type { CfPatch } from './sheet-cf-print'
import {
  clampArea,
  columnLetter,
  jobPrintPlan,
  planColumnBands,
  planSheetPrint,
  printableWidthPx,
  titleColSpan,
  titleRowSpan,
} from './sheet-print-setup'
import type { JobPrintPlan, SheetPrintPlan } from './sheet-print-setup'
import type {
  BorderLine,
  CellPayload,
  CellStyle,
  MergeRange,
  SheetPayload,
  WorkbookPayload,
} from './fs'

const COL_WIDTH_PX = 96
/** 「打印行列标题」那一列（行号）的固定宽。它吃的是纸面宽度，所以分带之前要先扣掉 */
const HEADING_COL_PX = 30

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

/** 一张表的渲染上下文：格子、合并、条件格式着色、列宽与行高都在这张面上查 */
interface SheetGrid {
  grid: Map<string, CellPayload>
  /** 合并区里除左上角之外的格子 */
  covered: Set<string>
  /** 合并左上角 → 那个合并区 */
  merges: Map<string, MergeRange>
  /** 被吞的格子 → 所属合并区左上角的键（图表锚点要落到真正画出来的那一格） */
  mergeStart: Map<string, string>
  cf: Map<string, CfPatch>
  colAt: (c: number) => number
  rowStyle: (r: number) => string
}

const NO_BREAKS = new Set<number>()

function chartImgs(slots: ChartSlot[] | undefined): string {
  return (slots ?? [])
    .map(
      (s) =>
        `<img class="sheet-print-chart" alt="${esc(s.label)}" src="${s.src}" style="width:${Math.round(
          s.width,
        )}px;height:${Math.round(s.height)}px"/>`,
    )
    .join('')
}

function cellStyleAttr(
  cell: CellPayload | undefined,
  paint: CfPatch | undefined,
  floated: boolean,
): string {
  // 单元格默认裁掉溢出，浮在格上的图表要看得见就得先放开这一格
  const extra = floated ? ['position:relative', 'overflow:visible'] : []
  const parts = [...extra, ...styleParts(cell?.s, paint)]
  return parts.length ? ` style="${parts.join(';')}"` : ''
}

/** 重复标题行列与打印区域求交之后的账：整段落在外面与只掉几行，是两句不同的话 */
function spanAccount(
  notes: string[],
  name: string,
  want: [number, number] | null | undefined,
  got: [number, number] | null,
  unit: string,
): void {
  if (!want) return
  if (!got) {
    notes.push(`${name}整段落在打印区域之外，纸上不再重复`)
    return
  }
  const lost = want[1] - want[0] + 1 - (got[1] - got[0] + 1)
  if (lost > 0) {
    notes.push(
      `${name}有 ${lost} ${unit}在打印区域之外，纸上只重复剩下的 ${got[1] - got[0] + 1} ${unit}`,
    )
  }
}

/** 把一组行按一组列画出来（一个列带一张表；重复标题行自成一 thead 组）。
 *  合并的跨度只按"这一张表真的印出来的行列"数：隐藏行、越界端点、跨带的尾巴都会吃掉格子数，
 *  数不到的格子补空位占着——格子比 colgroup 少一格，整张表就往左塌一列，
 *  纸上看是"数据串了位"而不是"少了一格" */
function rowMarkup(
  groupRows: number[],
  bandCols: number[],
  g: SheetGrid,
  o: { headings: boolean; breakRows: Set<number>; slots: Map<string, ChartSlot[]> },
): string {
  const eaten = new Set<string>()
  let out = ''
  for (const r of groupRows) {
    // 带首行已在页顶，再断一次就是凭空一张空白页
    const brk = o.breakRows.has(r) && r !== groupRows[0] ? ' class="sheet-print-break"' : ''
    let tds = o.headings ? `<th class="sheet-print-heading">${r + 1}</th>` : ''
    for (const c of bandCols) {
      const k = `${r},${c}`
      if (eaten.has(k)) continue
      const cell = g.grid.get(k)
      const paint = g.cf.get(k)
      const mine = o.slots.get(k)
      const m = g.merges.get(k)
      if (!m) {
        // 合并的另一半而左上角不在这张表里（在别的带／区域外／整行被隐藏）：位置要占住
        if (g.covered.has(k)) {
          tds += '<td></td>'
          continue
        }
        tds += `<td${cellStyleAttr(cell, paint, !!mine)}>${chartImgs(mine)}${cellText(
          cell?.v,
          cell?.s,
          paint,
        )}</td>`
        continue
      }
      const spanRows = groupRows.filter((x) => x >= r && x <= m.endRow)
      const spanCols = bandCols.filter((x) => x >= c && x <= m.endColumn)
      for (const rr of spanRows)
        for (const cc of spanCols) if (rr !== r || cc !== c) eaten.add(`${rr},${cc}`)
      const span = ` colspan="${spanCols.length}" rowspan="${spanRows.length}"`
      tds += `<td${span}${cellStyleAttr(cell, paint, !!mine)}>${chartImgs(mine)}${cellText(
        cell?.v,
        cell?.s,
        paint,
      )}</td>`
    }
    out += `<tr${brk}${g.rowStyle(r)}>${tds}</tr>`
  }
  return out
}

function sheetHtml(
  sheet: SheetPayload,
  first: boolean,
  chartImages: (string | undefined)[] | undefined,
  plan: SheetPrintPlan,
  job: JobPrintPlan,
  /** 上一趟实测定下的最终缩放（「缩放到 N 页高」压出来的那一档）；null = 照计划的缩放排 */
  forceZoom?: number | null,
): { html: string; notes: string[] } {
  const notes: string[] = []
  const head = `<h3 class="sheet-print-title">${esc(sheet.name)}</h3>`
  const cls = first ? '' : ' class="sheet-print-break"'
  const grid = new Map<string, CellPayload>()
  let dataRow = -1
  let dataCol = -1
  for (const x of sheet.cells) {
    grid.set(`${x.r},${x.c}`, x)
    if (x.r > dataRow) dataRow = x.r
    if (x.c > dataCol) dataCol = x.c
  }
  for (const m of sheet.merges ?? []) {
    if (m.endRow > dataRow) dataRow = m.endRow
    if (m.endColumn > dataCol) dataCol = m.endColumn
  }
  const charts = sheet.charts ?? []
  // 图表的锚点格也算网格的一部分：图表本来就常浮在数据块右下方，
  // 只按数据定界会把锚点整个裁掉——那张图在打印里就此不见了
  for (const ch of charts) {
    if (ch.anchorRow > dataRow) dataRow = ch.anchorRow
    if (ch.anchorCol > dataCol) dataCol = ch.anchorCol
  }
  if (dataRow < 0 || dataCol < 0) {
    if (plan.printArea) notes.push('打印区域指到的那一片一个格子都没有，纸上这一张表是空的')
    // 标题行始终给：没标题就没人知道这一页是哪个表打印出来的
    return { html: `<section${cls}>${head}<p>（空表）</p></section>`, notes }
  }
  const truncated = dataRow >= PRINT_MAX_ROWS || dataCol >= PRINT_MAX_COLS
  const maxRow = Math.min(dataRow, PRINT_MAX_ROWS - 1)
  const maxCol = Math.min(dataCol, PRINT_MAX_COLS - 1)
  // 打印区域：越界的端点收回而不是整条作废，收回这件事要说得出收了多少
  const pa = plan.printArea
  const area = clampArea(pa, maxRow, maxCol)
  if (pa && (pa.endRow > maxRow || pa.endColumn > maxCol)) {
    notes.push(
      `打印区域指到第 ${pa.endRow + 1} 行第 ${columnLetter(pa.endColumn)} 列，纸上只能印到第 ${
        maxRow + 1
      } 行第 ${columnLetter(maxCol)} 列，已按能印到的边界收`,
    )
  }
  const rowLo = area?.startRow ?? 0
  const rowHi = area?.endRow ?? maxRow
  const colLo = area?.startColumn ?? 0
  const colHi = area?.endColumn ?? maxCol
  const titleR = titleRowSpan(plan.titleRows, area)
  const titleC = titleColSpan(plan.titleCols, area)
  spanAccount(notes, '重复标题行', plan.titleRows, titleR, '行')
  spanAccount(notes, '重复标题列', plan.titleCols, titleC, '列')
  // 合并覆盖矩阵只铺到能印到的边界：区域外的格子不该在这里占位
  const covered = new Set<string>()
  const mergeStart = new Map<string, string>()
  const merges = new Map<string, MergeRange>()
  for (const m of sheet.merges ?? []) {
    merges.set(`${m.startRow},${m.startColumn}`, m)
    for (let r = m.startRow; r <= Math.min(m.endRow, rowHi); r++)
      for (let c = m.startColumn; c <= Math.min(m.endColumn, colHi); c++) {
        if (r === m.startRow && c === m.startColumn) continue
        covered.add(`${r},${c}`)
        mergeStart.set(`${r},${c}`, `${m.startRow},${m.startColumn}`)
      }
  }
  // 隐藏行列打印时整列/整行剔除（合并区跨隐藏列的 colspan 由补位保证不塌）。
  // 被筛掉的行也在这一并列：Univer 只在界面上现算它，快照的行数据里根本没有这些行，
  // 而第三方件的筛选在 OOXML 里就是 hidden 行——两样落到同一处才不会打出一份没筛的表。
  const hidR = new Set([...(sheet.hiddenRows ?? []), ...(sheet.filter?.filteredOut ?? [])])
  const hidC = new Set(sheet.hiddenCols ?? [])
  const cf = evalSheetCondFormats(sheet)
  notes.push(...cf.notes)
  const colAt = (c: number) => {
    const px = sheet.colWidths?.[String(c)]
    return typeof px === 'number' && px > 0 && Number.isFinite(px)
      ? Math.round(px)
      : COL_WIDTH_PX
  }
  const rowStyle = (r: number) => {
    const rh = sheet.rowHeights?.[String(r)]
    return typeof rh === 'number' && rh > 0 && Number.isFinite(rh)
      ? ` style="height:${Math.round(rh)}px"`
      : ''
  }
  const g: SheetGrid = { grid, covered, merges, mergeStart, cf: cf.patches, colAt, rowStyle }
  const allRows: number[] = []
  for (let r = rowLo; r <= rowHi; r++) if (!hidR.has(r)) allRows.push(r)
  const cols: { col: number; px: number }[] = []
  for (let c = colLo; c <= colHi; c++) if (!hidC.has(c)) cols.push({ col: c, px: colAt(c) })
  if (!allRows.length || !cols.length) {
    notes.push('这一张表的可见行或可见列都在打印区域之外，纸上没有它的网格')
    return { html: `<section${cls}>${head}<p>（打印区域里没有可打印的格子）</p></section>`, notes }
  }
  const inTitle = (r: number) => !!titleR && r >= titleR[0] && r <= titleR[1]
  const titleRows = allRows.filter(inTitle)
  const bodyRows = allRows.filter((r) => !inTitle(r))
  // 纸由这一趟作业定（第一张表的纸），分带就得按这张纸的可印宽度算，
  // 否则后几张表按自己那张更宽的纸排带，印出来却被压在同一张纸上
  const capacity = Math.max(
    48,
    printableWidthPx(job.pageSizeInches, job.margins) - (plan.headings ? HEADING_COL_PX : 0),
  )
  const bp = planColumnBands(cols, {
    capacityPx: capacity,
    zoom: plan.zoom,
    titleCols: titleC,
    forcedBreaks: plan.colBreaks,
    fitToWidthPages: plan.fitToWidthPages,
    forceZoom,
  })
  notes.push(...bp.notes)
  const zoom = Math.round(bp.zoom * 1000) / 1000
  // 图表锚在哪一格就挂在哪一格里（绝对定位从该格左上角起算），并按它落在哪个列带分给那一张表
  const slotsByBand: Map<string, ChartSlot[]>[] = bp.bands.map(() => new Map<string, ChartSlot[]>())
  charts.forEach((ch, i) => {
    const src = chartImages?.[i]
    const label = ch.title || `第 ${i + 1} 张`
    if (!src) {
      notes.push(`图表「${label}」没能渲染成图片，打印里是空的`)
      return
    }
    const at = mergeStart.get(`${ch.anchorRow},${ch.anchorCol}`) ?? `${ch.anchorRow},${ch.anchorCol}`
    const r = Number(at.split(',')[0])
    const c = Number(at.split(',')[1])
    if (r > maxRow || c > maxCol) {
      notes.push(
        `图表「${label}」锚在第 ${r + 1} 行第 ${c + 1} 列，超出打印上限 ${PRINT_MAX_ROWS} 行 × ${PRINT_MAX_COLS} 列，未放置`,
      )
      return
    }
    if (r < rowLo || r > rowHi || c < colLo || c > colHi) {
      notes.push(
        `图表「${label}」锚在第 ${r + 1} 行第 ${c + 1} 列，打印区域是第 ${rowLo + 1}~${
          rowHi + 1
        } 行第 ${columnLetter(colLo)}~${columnLetter(colHi)} 列，纸上没有它`,
      )
      return
    }
    if (hidR.has(r) || hidC.has(c)) {
      notes.push(`图表「${label}」锚在隐藏行/列上，打印里没有它的位置`)
      return
    }
    const bi = bp.bands.findIndex((bd) => bd.includes(c))
    if (bi < 0) {
      notes.push(`图表「${label}」所在的那一列没落进任何列带，纸上没有它`)
      return
    }
    if (inTitle(r)) notes.push(`图表「${label}」锚在重复标题行上，纸上是每页都带一张`)
    const list = slotsByBand[bi].get(at) ?? []
    list.push({ src, width: ch.width, height: ch.height, label })
    slotsByBand[bi].set(at, list)
  })
  const breakRows = new Set(
    plan.pageBreakRows.filter((r) => r >= rowLo && r <= rowHi && !hidR.has(r) && !inTitle(r)),
  )
  const lostBreaks = plan.pageBreakRows.filter((r) => !breakRows.has(r)).length
  if (lostBreaks) {
    notes.push(`有 ${lostBreaks} 处手动分页符落在打印区域或可见行之外，纸上不再断开`)
  }
  const tableCls = `sheet-print-table${plan.gridLines ? ' sheet-print-grid' : ''}`
  const tables = bp.bands.map((bandCols, bi) => {
    const widthPx = (plan.headings ? HEADING_COL_PX : 0) + bandCols.reduce((a, c) => a + colAt(c), 0)
    // 水平居中要给出这一带的实际宽，auto 边距才有东西可分
    const tstyle = [
      zoom !== 1 ? `zoom:${zoom}` : '',
      plan.hCentered ? `width:${widthPx}px;margin-left:auto;margin-right:auto` : '',
    ]
      .filter(Boolean)
      .join(';')
    const colgroup = `<colgroup>${
      plan.headings ? `<col style="width:${HEADING_COL_PX}px"/>` : ''
    }${bandCols.map((c) => `<col style="width:${colAt(c)}px"/>`).join('')}</colgroup>`
    const headRow = plan.headings
      ? `<tr class="sheet-print-heading-row"><th class="sheet-print-corner"></th>${bandCols
          .map((c) => `<th class="sheet-print-heading">${columnLetter(c)}</th>`)
          .join('')}</tr>`
      : ''
    const ro = { headings: plan.headings, slots: slotsByBand[bi] }
    const thead =
      headRow || titleRows.length
        ? `<thead>${headRow}${rowMarkup(titleRows, bandCols, g, {
            ...ro,
            breakRows: NO_BREAKS,
          })}</thead>`
        : ''
    const tbody = `<tbody>${rowMarkup(bodyRows, bandCols, g, { ...ro, breakRows })}</tbody>`
    return `<div class="sheet-print-band${bi ? ' sheet-print-break' : ''}"><table class="${tableCls}"${
      tstyle ? ` style="${tstyle}"` : ''
    }>${colgroup}${thead}${tbody}</table></div>`
  })
  const printNotes = [...notes]
  if (truncated) {
    printNotes.push(`内容超出打印上限 ${PRINT_MAX_ROWS} 行 × ${PRINT_MAX_COLS} 列，已截断`)
  }
  // 页面上只留"这份打印件缺了什么"这一条（拿到纸上看的人才用得上），其余账目交回调用方进状态栏
  const note = truncated
    ? `<p class="sheet-print-note">（内容超出打印上限 ${PRINT_MAX_ROWS} 行 × ${PRINT_MAX_COLS} 列，已截断）</p>`
    : ''
  return { html: `<section${cls}>${head}${tables.join('')}${note}</section>`, notes: printNotes }
}

export interface SheetsPrintResult {
  html: string
  notes: string[]
  /** 每张表自己的打印计划（状态栏与冒烟核对都吃这个） */
  plans: SheetPrintPlan[]
  /** 这一趟作业的纸面：调用方拿它喂 pdfprint 的 pageSizeInches/marginsSides/pageStyle */
  job: JobPrintPlan
}

/** ctx 的 dateText/fileName 供页眉页脚的 &D 与 &F 展开——换算层不读时钟，读时钟的是这一层。
 *  opts.zooms 是上一趟实测压出来的最终缩放（按表序，null = 这张不动）：
 *  「缩放到 N 页高」要靠真排版量行数，而量之前必须先有这一档缩放，于是分两趟建 */
export function sheetsToPrintHtml(
  payload: WorkbookPayload,
  chartImages?: (string | undefined)[][],
  ctx?: { dateText?: string; fileName?: string },
  opts?: { zooms?: (number | null)[] },
): SheetsPrintResult {
  const notes: string[] = []
  const dateText = ctx?.dateText ?? new Date().toLocaleDateString()
  const plans = payload.sheets.map((s) =>
    planSheetPrint(s, { sheetName: s.name, dateText, fileName: ctx?.fileName }),
  )
  const job = jobPrintPlan(plans)
  const html = payload.sheets
    .map((s, i) => {
      // 先是"这一张表想要什么纸"的账，再是网格排不下去的账
      notes.push(...plans[i].notes)
      const r = sheetHtml(s, i === 0, chartImages?.[i], plans[i], job, opts?.zooms?.[i] ?? null)
      notes.push(...r.notes)
      return r.html
    })
    .join('')
  notes.push(...job.notes)
  return { html, notes, plans, job }
}
