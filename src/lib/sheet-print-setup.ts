// 打印设置的换算（纯函数，零 DOM）：把 xlsx 读回来的那张「页面设置」翻译成两件事——
// ① 这一趟打印作业怎么摆纸：纸张/方向/边距/缩放/页眉页脚的 @page margin box；
// ② 这一张表的网格该怎么裁：打印区域、重复标题行列、手动分页符、列带。
// 分工照 v0.47 条件格式那句话：算得出的绝不抄缓存，算不出的绝不假装——
// 没有对应通道的东西（页码从 7 开始印、偶数页另有一版、缩放到 N 页高）一律只记账不落笔。
import type { PrintHfPayload, RangeRect, SheetPayload, SheetPrintPayload } from './fs'

/** 英寸 → CSS px（PrintToPdf 与屏幕同为 96dpi） */
export const PX_PER_INCH = 96

/** 表上什么都没声明时表格用的纸：A4 横向（v0.15 起表格一直是这张；真实文件都会自己声明方向） */
export const SHEET_DEFAULT_PAGE: [number, number] = [11.69, 8.27]

/** 边距缺省与 pdfprint 的 DEFAULT_MARGINS 同一组数（top/right/bottom/left，英寸） */
const DEFAULT_MARGINS: [number, number, number, number] = [0.5, 0.6, 0.5, 0.6]

/** OOXML paperSize 编号 → 短边×长边（英寸）。只收认得尺寸的号，认不出的记账后走默认纸。
 *  Tabloid/Ledger 是同一张纸换个走纸方向，所以成对出现很正常。
 *  导出只为让结构测试能把每一档点一遍（漏一档就是"文件说了而我们没纸"） */
export const PAPER_INCHES: Record<number, [number, number]> = {
  1: [8.5, 11], // Letter
  2: [8.5, 11], // Letter Small
  3: [11, 17], // Tabloid
  4: [11, 17], // Ledger
  5: [8.5, 14], // Legal
  6: [5.5, 8.5], // Statement
  7: [7.25, 10.5], // Executive
  8: [11.69, 16.54], // A3
  9: [8.27, 11.69], // A4
  10: [8.27, 11.69], // A4 Small
  11: [5.83, 8.27], // A5
  12: [9.84, 13.9], // B4（ISO 250×353mm）
  13: [6.93, 9.84], // B5（ISO 176×250mm）
  16: [10, 14], // 10×14
  17: [11, 17], // 11×17
  24: [8.27, 11.69], // A4 (rotated)
  25: [8.27, 11.69], // A4 Small (rotated)
  26: [5.83, 8.27], // A5 (rotated)
  27: [9.84, 13.9], // B4 (rotated)
  28: [6.93, 9.84], // B5 (rotated)
}

/** 换算要用的当下信息：由调用方给（纯函数不读时钟，也不碰文件系统，测试才跑得动） */
export interface PrintContext {
  /** &A 展开成什么 */
  sheetName: string
  /** &D 展开成什么 */
  dateText: string
  /** &F 展开成什么（还没选保存路径时可省） */
  fileName?: string
}

/** 一张表翻译出来的打印计划（与网格几何无关的那半边） */
export interface SheetPrintPlan {
  /** 纸面宽高（英寸，横向时 w>h） */
  pageSizeInches: [number, number]
  /** 四边边距（英寸，top/right/bottom/left） */
  margins: [number, number, number, number]
  /** Excel 的「缩放 %」→ CSS zoom（实测这一个旋钮就够，分页跟着走） */
  zoom: number
  /** 一页纸面上可放内容的宽度（px；内容坐标系里还要除以 zoom） */
  capacityPx: number
  /** 页眉页脚的 @page margin box 规则（含 :first 那一份） */
  pageStyle: string
  /** 打印区域（0 基含端点）；null = 整表 */
  printArea: RangeRect | null
  titleRows: [number, number] | null
  titleCols: [number, number] | null
  /** 要另起一页的行号：这些行**自己**开始新的一页（<brk id> 原样，0 基） */
  pageBreakRows: number[]
  /** 强制列带边界：这些列自己开始新的一带（<brk id> 原样，0 基） */
  colBreaks: number[]
  gridLines: boolean
  headings: boolean
  hCentered: boolean
  /** 勾了「缩放到 N 页宽」：列宽都在载荷里，这一半我们量得出来 */
  fitToWidthPages: number | null
  notes: string[]
}

/** 纸张编号 + 方向 → 纸面宽高（英寸）；编号认不出返回 null（调用方按默认纸并记账） */
export function pageSizeInches(
  code: number | null | undefined,
  orientation: string | null | undefined,
): [number, number] | null {
  const pair = code == null ? undefined : PAPER_INCHES[code]
  if (!pair) return null
  const [s, l] = pair
  return orientation === 'landscape' ? [l, s] : [s, l]
}

/** 纸面减去左右边距后的可印宽度（px）。48px 的下限防的是边距把纸吃光：
 *  负数会让分带变成"每带都装不下一列"，账就说不清到底是哪一列宽 */
export function printableWidthPx(
  pageSizeInches: [number, number],
  margins: [number, number, number, number],
): number {
  return Math.max(48, Math.round((pageSizeInches[0] - margins[1] - margins[3]) * PX_PER_INCH))
}

/** 边距：载荷说了几条算几条，没说的沿用 pdfprint 那组缺省数 */
function marginsOf(p: SheetPrintPayload): [number, number, number, number] {
  const m = p.margins
  return [
    m?.top ?? DEFAULT_MARGINS[0],
    m?.right ?? DEFAULT_MARGINS[1],
    m?.bottom ?? DEFAULT_MARGINS[2],
    m?.left ?? DEFAULT_MARGINS[3],
  ]
}

/** 把一张表的打印设置翻成打印计划。ctx 供页眉页脚展开，notes 是"这一版纸上做不到"的账 */
export function planSheetPrint(sheet: SheetPayload, ctx: PrintContext): SheetPrintPlan {
  const notes: string[] = []
  const p: SheetPrintPayload = sheet.print ?? {}
  const orientation = p.orientation === 'landscape' ? 'landscape' : 'portrait'
  if (p.orientation && orientation === 'portrait' && p.orientation !== 'portrait') {
    notes.push(`纸张方向写的是「${p.orientation}」，不是 landscape/portrait，纸上按竖版排`)
  }
  const paper = pageSizeInches(p.paperSize, orientation)
  if (p.paperSize != null && !paper) {
    notes.push(`纸张编号 ${p.paperSize} 我们没有尺寸表，纸上按默认纸排`)
  }
  // 连方向都没说（我们新建的表就是这张白纸）→ 沿用表格历史的 A4 横向；
  // 说了方向而纸张编号认不出时，方向那一半仍然要说得算（横版就是横版，别退回竖版）
  const A4: [number, number] = [8.27, 11.69]
  const pageSize =
    paper ?? (p.orientation ? (orientation === 'landscape' ? ([A4[1], A4[0]] as [number, number]) : A4) : SHEET_DEFAULT_PAGE)
  const margins = marginsOf(p)
  const capacityPx = printableWidthPx(pageSize, margins)
  let zoom = 1
  let fitToWidthPages: number | null = null
  if (p.fitToPage) {
    const w = p.fitToWidth ?? 0
    const h = p.fitToHeight ?? 0
    fitToWidthPages = w >= 1 && w < 100 ? w : null
    if (w > 0 && fitToWidthPages === null) {
      notes.push(`「缩放到 ${w} 页宽」超出能排的页数，纸上按整幅分带`)
    }
    if (h > 0) notes.push(`「缩放到 ${h} 页高」要预先行高总量，纸上的行数由分页自己定，这条没落`)
  } else if (p.scale != null) {
    if (p.scale >= 10 && p.scale <= 400) zoom = p.scale / 100
    else notes.push(`缩放比例 ${p.scale}% 不在 10~400 之间，纸上按 100% 排`)
  }
  if (p.pageOrder === 'overThenDown') {
    notes.push('页面顺序是「先横后竖」，但行带落在哪一页由分页决定，纸上按「先竖后横」排')
  }
  if (p.firstPageNumber) notes.push(`起始页码设的是 ${p.firstPageNumber}，纸上的页码从 1 开始数`)
  if (p.vCentered) notes.push('「上下居中打印」没有对应通道，纸上按顶端排')
  const hf = headerFooterCss(p.header, p.footer, p, ctx)
  notes.push(...hf.notes)
  if (hf.css && (margins[0] < 0.35 || margins[2] < 0.35)) {
    const side = margins[0] < 0.35 ? `上边距只有 ${margins[0]} 英寸` : `下边距只有 ${margins[2]} 英寸`
    notes.push(`页眉页脚有内容，但${side}，纸上那一行可能被裁掉`)
  }
  // 这一版开始纸上会照 printOptions 画网格线，但「从来没声明过页面设置」的表（我们在 Univer 里
  // 新建的就是这种）历史上纸上一直带一层细网格，这里保住那个观感；
  // 文件自己说过 printOptions 就照它说话——没勾「打印网格线」就不画
  return {
    pageSizeInches: pageSize,
    margins,
    zoom,
    capacityPx,
    pageStyle: hf.css,
    printArea: p.printArea ?? null,
    titleRows: p.titleRows ?? null,
    titleCols: p.titleCols ?? null,
    pageBreakRows: [...new Set(p.rowBreaks ?? [])].sort((a, b) => a - b),
    colBreaks: [...new Set(p.colBreaks ?? [])].sort((a, b) => a - b),
    gridLines: sheet.print ? p.gridLines === true : true,
    headings: p.headings === true,
    hCentered: p.hCentered === true,
    fitToWidthPages,
    notes,
  }
}

/** 列带的结果：每带一组列索引，加上为了让这一整套排得下而定的缩放 */
export interface BandPlan {
  /** 每带是一组列索引（升序，标题列已排在每带最前） */
  bands: number[][]
  /** 最终缩放：勾了「缩放到 N 页宽」时会比计划里的小 */
  zoom: number
  notes: string[]
}

/** 把可见列按可印宽度切成列带。
 *  Excel 对过宽的表是整幅压进一页，我们是分带（一页放不下就横向多印几页）；
 *  标题列每带都要重复，所以先把它占的宽度从每带里扣掉。 */
export function planColumnBands(
  cols: { col: number; px: number }[],
  opts: {
    capacityPx: number
    zoom: number
    titleCols?: [number, number] | null
    forcedBreaks?: number[]
    fitToWidthPages?: number | null
  },
): BandPlan {
  const notes: string[] = []
  if (!cols.length) return { bands: [], zoom: opts.zoom, notes }
  const total = cols.reduce((a, x) => a + x.px, 0)
  let zoom = opts.zoom
  if (opts.fitToWidthPages) {
    // 压到刚好能分进 N 带：缩放只往下调，且不超过 OOXML 能写的 10% 下限
    zoom = Math.min(1, Math.max(0.1, (opts.capacityPx * opts.fitToWidthPages) / total))
  }
  const room = opts.capacityPx / zoom
  const titleCols = opts.titleCols ?? null
  const isTitle = (c: number) => !!titleCols && c >= titleCols[0] && c <= titleCols[1]
  const titleGeom = titleCols ? cols.filter((x) => isTitle(x.col)) : []
  const titleWidth = titleGeom.reduce((a, x) => a + x.px, 0)
  if (room - titleWidth <= 0) {
    notes.push(
      `重复标题列宽 ${Math.round(titleWidth)}px 已占满一页（可印 ${Math.round(room)}px），纸上不再分带`,
    )
    return { bands: [cols.map((x) => x.col)], zoom, notes }
  }
  const forced = new Set(opts.forcedBreaks ?? [])
  const bands: number[][] = []
  const head = () => titleGeom.map((x) => x.col)
  let cur = head()
  let used = 0
  const close = () => {
    if (cur.length) bands.push(cur)
    cur = head()
    used = 0
  }
  for (const x of cols.filter((y) => !isTitle(y.col))) {
    // <brk id> 说的是"这一列自己开始新的一带"（实测：Excel 在 D1 前插断点→它写 id=3），
    // 故断开要发生在把它放进带之前
    if (forced.has(x.col) && used > 0) close()
    if (used + x.px > room - titleWidth && used > 0) close()
    cur.push(x.col)
    used += x.px
  }
  if (cur.length) bands.push(cur)
  const widest = Math.max(...cols.map((x) => x.px))
  if (widest > room) {
    notes.push(`有一列宽 ${Math.round(widest)}px 超过一页可印的 ${Math.round(room)}px，纸上那一列会被裁掉`)
  }
  return { bands, zoom, notes }
}

/** 一段页眉/页脚解析出的 margin box 内容 */
interface HfSegment {
  box: 'left' | 'center' | 'right'
  /** 拼进 CSS content 的片段：字符串字面量或 counter(page)/counter(pages)，用空格串接 */
  parts: string[]
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** 磅（&nn），换算成 px 由 segStyle 负责 */
  pt?: number
  font?: string
}

/** 这些码我们没有任何对应通道：整码丢掉并记一笔，不把 &X 当字面文字印出去 */
const UNSUPPORTED = new Set(['X', 'Y', 'Z', 'G', 'T', 'H', 'K'])

function cssQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 把 `&L…&C…&R…` 那套码解析成段。没写过分段码的文字按 Excel 的旧规矩算左段 */
function parseHf(text: string, ctx: PrintContext, notes: string[]): HfSegment[] {
  const segs: HfSegment[] = []
  let cur: HfSegment = { box: 'left', parts: [] }
  let buf = ''
  const emit = () => {
    if (buf) {
      cur.parts.push(cssQuote(buf))
      buf = ''
    }
  }
  const flush = () => {
    if (cur.parts.length) segs.push(cur)
  }
  const dropped = new Set<string>()
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== '&') {
      buf += ch
      continue
    }
    const code = text[i + 1]
    if (code === undefined) {
      buf += '&'
      break
    }
    const done = () => {
      i += 1
    }
    switch (code.toLowerCase()) {
      case 'l':
      case 'c':
      case 'r': {
        // 分段码：收掉上一段，新段从"无格式"起算（Excel 的三段各自独立）
        emit()
        flush()
        cur = {
          box: code.toLowerCase() === 'l' ? 'left' : code.toLowerCase() === 'c' ? 'center' : 'right',
          parts: [],
        }
        done()
        break
      }
      case 'p':
        emit()
        cur.parts.push('counter(page)')
        done()
        break
      case 'n':
        emit()
        cur.parts.push('counter(pages)')
        done()
        break
      case 'a':
        emit()
        cur.parts.push(cssQuote(ctx.sheetName))
        done()
        break
      case 'f':
        emit()
        cur.parts.push(cssQuote(ctx.fileName ?? ''))
        done()
        break
      case 'd':
        emit()
        cur.parts.push(cssQuote(ctx.dateText))
        done()
        break
      case 'b':
        emit()
        cur.bold = !cur.bold
        done()
        break
      case 'i':
        emit()
        cur.italic = !cur.italic
        done()
        break
      case 'u':
        emit()
        cur.underline = !cur.underline
        done()
        break
      case 'e':
        emit()
        cur.strike = !cur.strike
        done()
        break
      case '&':
        buf += '&'
        done()
        break
      default: {
        // &"字体名,体" 与 &字号 各吃掉自己的尾巴；余下认不出的单码按表处理
        if (code === '"') {
          const close = text.indexOf('"', i + 2)
          const name = close > 0 ? text.slice(i + 2, close) : ''
          const fam = name.split(',')[0]?.replace(/["'\\;]/g, '').trim()
          if (fam) {
            emit()
            cur.font = fam.slice(0, 64)
          }
          i = close > 0 ? close : i + 1
          break
        }
        if (/[0-9]/.test(code)) {
          const two = text.slice(i + 1, i + 3)
          const n = /^[0-9]{2}/.test(two) ? two : code
          emit()
          cur.pt = Number(n)
          i += n.length
          break
        }
        if (UNSUPPORTED.has(code.toUpperCase())) {
          dropped.add(`&${code}`)
          done()
          break
        }
        // 认不出的码：留个字面，别把别人的文字吃掉
        buf += `&${code}`
        done()
        break
      }
    }
  }
  emit()
  flush()
  if (dropped.size) {
    notes.push(`页眉页脚里的 ${[...dropped].join('、')} 我们没有对应通道，纸上当作没写过`)
  }
  return segs
}

function segStyle(seg: HfSegment): string {
  const deco = [seg.underline && 'underline', seg.strike && 'line-through'].filter(Boolean).join(' ')
  const parts = [
    seg.bold && 'font-weight:bold',
    seg.italic && 'font-style:italic',
    deco && `text-decoration:${deco}`,
    seg.pt && `font-size:${Math.round(seg.pt * 1.333)}px`,
    seg.font && `font-family:"${seg.font}"`,
  ].filter(Boolean)
  return parts.length ? `;${parts.join(';')}` : ''
}

const BOX_EDGE = { header: 'top', footer: 'bottom' } as const

/** 一档（odd/first）落成三条 margin box 规则。
 *  CSS 的一个 margin box 只能整段一种样式，同一段落重复出现也只印第一段——两样都记账 */
function boxesFor(segs: HfSegment[], edge: 'header' | 'footer', notes: string[]): string {
  let out = ''
  const seen = new Set<HfSegment['box']>()
  const side = edge === 'header' ? '页眉' : '页脚'
  for (const s of segs) {
    const name = s.box === 'left' ? '左' : s.box === 'center' ? '中' : '右'
    if (seen.has(s.box)) {
      notes.push(`${side}里出现了两次${name}段，纸上只印第一段`)
      continue
    }
    seen.add(s.box)
    out += `@${BOX_EDGE[edge]}-${s.box}{content:${s.parts.join(' ')}${segStyle(s)};}`
  }
  return out
}

/** 页眉页脚 → @page margin box 规则。奇偶两版没有对应通道（偶数页只能跟着奇数版印），首页那一版有。
 *  margin box 只能写在 `@page{}` 里面（实测：裸的 `@top-left{}` 整条不被认），
 *  所以这里成对包好；顺序上排在 pdfprint 那份"十六个位复位成 normal"之后，后写的说话 */
export function headerFooterCss(
  header: PrintHfPayload | null | undefined,
  footer: PrintHfPayload | null | undefined,
  print: SheetPrintPayload,
  ctx: PrintContext,
): { css: string; notes: string[] } {
  const notes: string[] = []
  const oddBoxes =
    boxesFor(parseHf(header?.odd ?? '', ctx, notes), 'header', notes) +
    boxesFor(parseHf(footer?.odd ?? '', ctx, notes), 'footer', notes)
  const firstBoxes =
    boxesFor(parseHf(header?.first ?? '', ctx, notes), 'header', notes) +
    boxesFor(parseHf(footer?.first ?? '', ctx, notes), 'footer', notes)
  let css = oddBoxes ? `@page{${oddBoxes}}` : ''
  if (firstBoxes) css += `@page :first{${firstBoxes}}`
  if (print.oddEven && (header?.even || footer?.even)) {
    notes.push('页眉页脚分了奇偶两版，纸上没有按奇偶换内容的通道，偶数页印的是奇数那一版')
  }
  if (print.firstDiffers && !firstBoxes) {
    notes.push('页眉页脚勾了「首页不同」却没写首页的内容，纸上首页与其余页一样')
  }
  return { css, notes }
}

/** 一趟作业的纸：多张表各说各话时由第一张说话，其余记一笔
 *  （PrintToPdf 一次只认一份 @page 的纸面，实测认的是打印将要吃的那一条链） */
export interface JobPrintPlan {
  pageSizeInches: [number, number]
  margins: [number, number, number, number]
  pageStyle: string
  /** 这一趟真正落到纸上的可印宽度（px）：纸由第一张定，分带就得按它算，
   *  否则后几张表会按自己那张（更宽的）纸排带，印出来却挤在同一张纸上被压扁 */
  capacityPx: number
  notes: string[]
}

export function jobPrintPlan(plans: SheetPrintPlan[]): JobPrintPlan {
  const first = plans[0]
  if (!first) {
    return {
      pageSizeInches: SHEET_DEFAULT_PAGE,
      margins: DEFAULT_MARGINS,
      pageStyle: '',
      capacityPx: printableWidthPx(SHEET_DEFAULT_PAGE, DEFAULT_MARGINS),
      notes: [],
    }
  }
  const notes: string[] = []
  const samePage = (p: SheetPrintPlan) =>
    p.pageSizeInches[0] === first.pageSizeInches[0] && p.pageSizeInches[1] === first.pageSizeInches[1]
  const sameMargin = (p: SheetPrintPlan) => p.margins.every((v, i) => v === first.margins[i])
  const sameHf = (p: SheetPrintPlan) => p.pageStyle === first.pageStyle
  const count = (same: (p: SheetPrintPlan) => boolean) => plans.slice(1).filter((p) => !same(p)).length
  if (count(samePage)) {
    notes.push(
      `各表的纸张不一样，纸上一趟只能摆一张：按第一张的 ${first.pageSizeInches[0]}×${first.pageSizeInches[1]} 英寸排，另有 ${count(samePage)} 张跟着走`,
    )
  }
  if (count(sameMargin)) {
    notes.push(`各表的页边距不一样，按第一张的 ${first.margins.join('/')} 英寸排，另有 ${count(sameMargin)} 张跟着走`)
  }
  if (count(sameHf)) {
    notes.push(
      `各表的页眉页脚不一样，${first.pageStyle ? '纸上印第一张那一版' : '纸上没有页眉页脚'}，另有 ${count(sameHf)} 张被略过`,
    )
  }
  return {
    pageSizeInches: first.pageSizeInches,
    margins: first.margins,
    pageStyle: first.pageStyle,
    capacityPx: first.capacityPx,
    notes,
  }
}

/** 列号 → 字母（打印行列标题时用；0 基：0→A，26→AA） */
export function columnLetter(c: number): string {
  let s = ''
  let n = c
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

/** 把打印区域与数据边界夹成一个矩形：越界的端点收回，而不是整条设置作废 */
export function clampArea(area: RangeRect | null, maxRow: number, maxCol: number): RangeRect | null {
  if (!area) return null
  return {
    startRow: Math.max(0, Math.min(area.startRow, maxRow)),
    startColumn: Math.max(0, Math.min(area.startColumn, maxCol)),
    endRow: Math.max(0, Math.min(area.endRow, maxRow)),
    endColumn: Math.max(0, Math.min(area.endColumn, maxCol)),
  }
}

function clampSpan(
  span: [number, number] | null,
  from: number,
  to: number,
): [number, number] | null {
  if (!span) return null
  const lo = Math.max(Math.max(0, span[0]), from)
  const hi = Math.min(span[1], to)
  return hi >= lo ? [lo, hi] : null
}

/** 重复标题行的合法区间：与打印区域求交（区域之外的行根本不印，标题也就无从重复） */
export function titleRowSpan(
  rows: [number, number] | null,
  area: RangeRect | null,
): [number, number] | null {
  return clampSpan(rows, area?.startRow ?? 0, area?.endRow ?? Number.MAX_SAFE_INTEGER)
}

/** 同上，列向 */
export function titleColSpan(
  cols: [number, number] | null,
  area: RangeRect | null,
): [number, number] | null {
  return clampSpan(cols, area?.startColumn ?? 0, area?.endColumn ?? Number.MAX_SAFE_INTEGER)
}

/** 一张表上所有打印账目的一次性汇总（含分带的账）：结构测试与状态栏都吃这个 */
export function sheetPrintNotes(
  sheet: SheetPayload,
  ctx: PrintContext,
  cols: { col: number; px: number }[],
): string[] {
  const plan = planSheetPrint(sheet, ctx)
  const bands = planColumnBands(cols, {
    capacityPx: plan.capacityPx,
    zoom: plan.zoom,
    titleCols: plan.titleCols,
    forcedBreaks: plan.colBreaks,
    fitToWidthPages: plan.fitToWidthPages,
  })
  return [...plan.notes, ...bands.notes]
}
