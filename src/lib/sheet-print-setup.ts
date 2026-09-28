// 打印设置的换算（纯函数，零 DOM）：把 xlsx 读回来的那张「页面设置」翻译成两件事——
// ① 这一趟打印作业怎么摆纸：纸张/方向/边距/缩放/页眉页脚的 @page margin box；
// ② 这一张表的网格该怎么裁：打印区域、重复标题行列、手动分页符、列带。
// 分工照 v0.47 条件格式那句话：算得出的绝不抄缓存，算不出的绝不假装——
// 到今天只剩一条没有对应通道（页码从 7 开始印，见 hfAndPageNumberNotes），其余都落了笔。
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
  /** 一页纸面上可放内容的高度（px；同一页的第一行从这里起算，v0.53 的页数模拟吃这个） */
  capacityHeightPx: number
  /** 页眉页脚的 @page margin box 规则（奇数版 / 偶数版 / 首页版各一处；承重的是首页那几格的复位，不是源序） */
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
  /** 勾了「上下居中打印」：一页装得下才落得了笔，装不下由排版的实测层记账 */
  vCentered: boolean
  /** 勾了「缩放到 N 页宽」：列宽都在载荷里，这一半我们量得出来 */
  fitToWidthPages: number | null
  /** 勾了「缩放到 N 页高」：行高不在载荷里（没声明的行由字体与换行现算），要靠实测 */
  fitToHeightPages: number | null
  /** 起始页码：文件里存得进、Excel 认得，我们的纸上做不到（见 planSheetPrint 里那条账） */
  firstPageNumber: number | null
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

/** 纸面减去上下边距后的可印高（px）。这里**不取整**：一页能放几行是拿实测行高（小数）
 *  来比这个数的，取整就是每页都可能少放一行（实测 697.92px 那一档正好卡在 33 行与 32 行之间） */
export function printableHeightPx(
  pageSizeInches: [number, number],
  margins: [number, number, number, number],
): number {
  return Math.max(48, (pageSizeInches[1] - margins[0] - margins[2]) * PX_PER_INCH)
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
export function planSheetPrint(
  sheet: SheetPayload,
  ctx: PrintContext,
  opts?: { hfZoom?: number | null },
): SheetPrintPlan {
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
  const capacityHeightPx = printableHeightPx(pageSize, margins)
  let zoom = 1
  let fitToWidthPages: number | null = null
  let fitToHeightPages: number | null = null
  if (p.fitToPage) {
    const w = p.fitToWidth ?? 0
    const h = p.fitToHeight ?? 0
    fitToWidthPages = w >= 1 && w < 100 ? w : null
    fitToHeightPages = h >= 1 && h < 100 ? h : null
    if (w > 0 && fitToWidthPages === null) {
      notes.push(`「缩放到 ${w} 页宽」超出能排的页数，纸上按整幅分带`)
    }
    if (h > 0 && fitToHeightPages === null) {
      notes.push(`「缩放到 ${h} 页高」超出能排的页数，纸上按自然分页`)
    }
  } else if (p.scale != null) {
    if (p.scale >= 10 && p.scale <= 400) zoom = p.scale / 100
    else notes.push(`缩放比例 ${p.scale}% 不在 10~400 之间，纸上按 100% 排`)
  }
  if (p.pageOrder === 'overThenDown') {
    notes.push('页面顺序是「先横后竖」，但行带落在哪一页由分页决定，纸上按「先竖后横」排')
  }
  const firstPageNumber = p.firstPageNumber ?? null
  // 起始页码与页眉页脚三版在纸上的脾气：账目文案只此一处，面板与导出共吃（见 hfAndPageNumberNotes）
  notes.push(...hfAndPageNumberNotes(p))
  const hf = headerFooterCss(p.header, p.footer, p, ctx, {
    zoom: opts?.hfZoom ?? zoom,
    margins,
  })
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
    capacityHeightPx,
    pageStyle: hf.css,
    printArea: p.printArea ?? null,
    titleRows: p.titleRows ?? null,
    titleCols: p.titleCols ?? null,
    pageBreakRows: [...new Set(p.rowBreaks ?? [])].sort((a, b) => a - b),
    colBreaks: [...new Set(p.colBreaks ?? [])].sort((a, b) => a - b),
    gridLines: sheet.print ? p.gridLines === true : true,
    headings: p.headings === true,
    hCentered: p.hCentered === true,
    vCentered: p.vCentered === true,
    fitToWidthPages,
    fitToHeightPages,
    firstPageNumber,
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
    /** 排版实测后定下的最终缩放（「缩放到 N 页高」压出来的那一档）：说话权在它，
     *  宽度档与页高档取较小者由调用方算好，这里只照它分带 */
    forceZoom?: number | null
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
  if (opts.forceZoom != null) zoom = Math.min(zoom, opts.forceZoom)
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

/** 一张表在**最终缩放**下量出来的高度（px）：排版层从 DOM 读回来交给这里的纯函数。
 *  为什么必须实测而不是按行高算：实测发现我们新建的表一条 rowHeights 都没有（界面上默认行高
 *  由 Univer 现算），声明过的行高也只是**下限**（设 20px 实测 21px），长文字那一行会自己长到 244px。 */
export interface BandMeasure {
  /** 这一带的重复表头总高（每占一页就要付一次） */
  theadPx: number
  /** 表体每一行的高（升序，与纸上出现的顺序一致） */
  rowsPx: number[]
  /** 整张表的高 */
  tablePx: number
}

export interface SheetMeasure {
  /** 表格上面那一行表名（以及写在它后面的账目行）占的高，只算在第一页 */
  sectionHeadPx: number
  bands: BandMeasure[]
}

/** 按实测行高做贪心分页，**逐个列带**数它各自要占几页。行不拆开，一页装不下就整行挪到下一页；
 *  每一带自己起一页，第一页另付表名那一行。
 *  真机对照（A4 竖版 60 行）：模拟第一页放 50 行、断在 50，导出的 PDF 就是断在 50。
 *  分开数而不是只数总页数是因为「缩放到 N 页高」说的是竖着几页：三个列带各 2 页高，
 *  总共 6 页，而 Excel 那格里要压的是每一带的 2 */
export function printPagesPerBand(m: SheetMeasure, capacityPx: number): number[] {
  return m.bands.map((b, i) => {
    let pages = 1
    let used = b.theadPx + (i === 0 ? m.sectionHeadPx : 0)
    for (const h of b.rowsPx) {
      if (used + h > capacityPx) {
        pages += 1
        used = b.theadPx + h
      } else {
        used += h
      }
    }
    return pages
  })
}

/** 这一张表在纸上要占几页（各列带之和；每一带自己起一页） */
export function simulatePrintPages(m: SheetMeasure, capacityPx: number): number {
  return printPagesPerBand(m, capacityPx).reduce((a, x) => a + x, 0)
}

/** 把实测高按 f 倍折算（估算下一档缩放用）。CSS zoom 缩放后的行高**不等于**这里折出来的数：
 *  实测 zoom .6 下 20.61px 那行是 11.97px（比折算值矮），33% 下一页真装 95 行而折算估的是 97 行
 *  （比折算值高）——两头都会偏，所以这一档只用来**选**缩放，选完必须按新缩放重排再量一次。
 *  表名那一行**不折算**：zoom 落在 <table> 上，它外面的那一行一直是要高的那份（实测 29% 下
 *  行高从 20.615 掉到 6.427，而它仍是 26.667）——跟着折就等于替第一页凭空省出一截 */
function scaleMeasure(m: SheetMeasure, f: number): SheetMeasure {
  const r = (v: number) => v * f
  return {
    sectionHeadPx: m.sectionHeadPx,
    bands: m.bands.map((b) => ({
      theadPx: r(b.theadPx),
      rowsPx: b.rowsPx.map(r),
      tablePx: r(b.tablePx),
    })),
  }
}

/** 纸比屏幕高出来的那一截（px/行）。屏幕上的行矩形是在离屏容器的**屏幕媒体**下量的，
 *  同一张表上纸后每一行的推进都更大：实测 zoom 1 下 rect 20.615px 而纸上 21.0px
 *  （15.75pt ÷ 0.75），29% 下 rect 6.427px 而纸上平均 6.77px——两档的差都是 ~0.4px，
 *  与缩放无关 ⇒ 折完缩放再逐行加上。不加这一截，"刚好装得下"的那一档在纸上必然多一页
 *  （100 行按 29% 估是 1 页高、真排 98 + 2 两页就是这么来的） */
export const PRINT_ROW_BIAS_PX = 0.4

/** 折算到目标缩放档、再加上纸上的逐行偏置：交给贪心分页的那一份才是"纸上会怎么排" */
function paperAt(m: SheetMeasure, f: number): SheetMeasure {
  const scaled = scaleMeasure(m, f)
  const b = (h: number) => (h > 0 ? h + PRINT_ROW_BIAS_PX : h)
  return {
    sectionHeadPx: scaled.sectionHeadPx,
    bands: scaled.bands.map((x) => ({
      theadPx: b(x.theadPx),
      rowsPx: x.rowsPx.map(b),
      tablePx: x.tablePx + PRINT_ROW_BIAS_PX * x.rowsPx.length,
    })),
  }
}

/** 选档时的余量（一档 = 1%）。折算值只用来**选**缩放，不能当账：同一份表在 33% 下真排出来
 *  一页只有 95 行，而线性折算估的是 97 行——几个百分点的差在"刚好装得下"的那一档上就是多一页。
 *  所以找到第一档估得出 N 页高之后还要往下多退一档；已经够 N 页高的那一档不退，
 *  否则等于替用户白压一次缩放 */
const FIT_TALL_GUARD = 0.01

/** 找"能把每一带都压进 N 页高"的最大一档缩放（1% 一档，下限 10%——OOXML 只能写到 10%）。
 *  measuredZoom 是这份实测**当时所在的缩放**：搜索从它起往下走，返回它自己就等于"这档已经够了"。
 *  tallPages 是压完那一档下最高的那一带有几页高（估算值）：settled=false 表示压到下限还压不进 N 页 */
export function fitToPagesTallZoom(opts: {
  measure: SheetMeasure
  capacityPx: number
  pages: number
  measuredZoom: number
}): { zoom: number; tallPages: number; settled: boolean } {
  const from = Math.min(1, Math.max(0.1, opts.measuredZoom))
  const tallest = (f: number) => {
    const per = printPagesPerBand(paperAt(opts.measure, f), opts.capacityPx)
    return per.length ? Math.max(...per) : 0
  }
  const step = (z: number) => Math.round(z * 100) / 100
  for (let z = from; z >= 0.1 - 1e-9; z -= 0.01) {
    const found = step(z)
    const tallPages = tallest(found / from)
    if (tallPages <= opts.pages) {
      if (found >= from - 1e-9) return { zoom: found, tallPages, settled: true }
      const guarded = Math.max(0.1, step(found - FIT_TALL_GUARD))
      return { zoom: guarded, tallPages: tallest(guarded / from), settled: true }
    }
  }
  return { zoom: 0.1, tallPages: tallest(0.1 / from), settled: false }
}

/** 上下居中的上留白（px）：这一页装得下才给，装不下就是 0——居中的反面是"假居中"，
 *  宁可按顶端排并记账，也不许把第一页挤成两页去换"看起来居中" */
export function verticalCenterPadPx(capacityPx: number, usedPx: number): number {
  if (!(capacityPx > 0) || !(usedPx > 0) || usedPx > capacityPx) return 0
  return Math.round(((capacityPx - usedPx) / 2) * 100) / 100
}

/** 一张表实测完之后要落地的两件事：最终缩放（页高档）与各处上留白（垂直居中） */
export interface SheetFit {
  /** 最终缩放：与页面设置/页宽档取较小者；null = 这一张不动 */
  zoom: number | null
  /** 整张表的上留白（写在 section 上，只影响第一页：表名 + 第一带一起居中） */
  sectionPadPx: number
  /** 其余各带自己的上留白（每一带起新一页，逐带居中） */
  bandPadPx: number[]
  notes: string[]
}

/** 把实测结果落成这一张的排版决定。capacityHeightPx 是**页**的可印高（纸由这一趟作业定），
 *  measuredZoom 是这份实测所在的缩放——行数与留白都是在它之下量出来的，别拿计划里的档位当尺子 */
export function planSheetFit(
  measure: SheetMeasure,
  plan: SheetPrintPlan,
  opts: { capacityHeightPx: number; measuredZoom: number },
): SheetFit {
  const notes: string[] = []
  let zoom: number | null = null
  if (plan.fitToHeightPages) {
    const fit = fitToPagesTallZoom({
      measure,
      capacityPx: opts.capacityHeightPx,
      pages: plan.fitToHeightPages,
      measuredZoom: opts.measuredZoom,
    })
    if (fit.zoom < opts.measuredZoom) zoom = fit.zoom
    if (zoom !== null) {
      notes.push(
        `「缩放到 ${plan.fitToHeightPages} 页高」是按实测行高压出来的：纸上这一张缩到 ${Math.round(zoom * 100)}%`,
      )
    }
    if (!fit.settled) {
      notes.push(
        `「缩放到 ${plan.fitToHeightPages} 页高」压到 10% 仍要 ${fit.tallPages} 页高，纸上按 10% 排`,
      )
    }
  }
  if (!plan.vCentered || measure.bands.length === 0) {
    return { zoom, sectionPadPx: 0, bandPadPx: [], notes }
  }
  // 留白写在**没被 zoom 的那一层**（section 与带 div 都在表格的 zoom 之外），而实测的 tablePx
  // 已经是这一档缩放之后的高 ⇒ 两个数可直接比。比之前先把纸比屏幕高的那一截逐行补上：
  // 按屏幕高判"装得下"会在离满页只差十几 px 时给出一档真排不下第一页的留白，那就是假居中
  const paper = paperAt(measure, 1)
  const firstUsed = paper.sectionHeadPx + paper.bands[0].tablePx
  const sectionPadPx = verticalCenterPadPx(opts.capacityHeightPx, firstUsed)
  const bandPadPx = paper.bands.map((b) => verticalCenterPadPx(opts.capacityHeightPx, b.tablePx))
  // 第一带的留白由 section 承担：表名与第一带一起居中才叫"这张表上下居中"
  bandPadPx[0] = 0
  if (sectionPadPx === 0) {
    notes.push(
      `「上下居中打印」要第一页装得下：表名加第一带是 ${Math.round(firstUsed)}px，一页可印 ${Math.round(opts.capacityHeightPx)}px，纸上按顶端排`,
    )
  }
  const skipped = paper.bands
    .slice(1)
    .filter((b, i) => bandPadPx[i + 1] === 0 && b.tablePx > opts.capacityHeightPx).length
  if (skipped) notes.push(`另有 ${skipped} 带一页装不下，那几带按顶端排`)
  return { zoom, sectionPadPx, bandPadPx, notes }
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

/** 一档（odd/first）落成三条 margin box 规则时，两枚开关换算出来的落笔 */
interface HfRender {
  /** 页眉字号要乘的那一档倍数（不随文档缩放时恒 1） */
  scale: number
  /** 按纸张边缘对齐时，每一格往外推的英寸数（按边距对齐时为 null） */
  shift: { left: number; right: number } | null
}

function segStyle(seg: HfSegment, r: HfRender): string {
  const deco = [seg.underline && 'underline', seg.strike && 'line-through'].filter(Boolean).join(' ')
  const px = (pt: number) => Math.round(pt * 1.333 * r.scale * 100) / 100
  const parts = [
    seg.bold && 'font-weight:bold',
    seg.italic && 'font-style:italic',
    deco && `text-decoration:${deco}`,
    seg.pt && `font-size:${px(seg.pt)}px`,
    seg.font && `font-family:"${seg.font}"`,
  ].filter(Boolean)
  return parts.length ? `;${parts.join(';')}` : ''
}

/** 我们纸面页眉的基准字号（px）：内容没写 &"字号" 那一档时继承的就是它（实测 16px 上纸字形高 12pt）。
 *  Excel 的页眉默认是 11pt——两边差的那一档与本轮无关，记在路线图里 */
const HF_BASE_FONT_PX = 16

/** 「随文档缩放」：margin box 是页级的，不在挂着 CSS zoom 的那棵 <table> 树里（实测内容 zoom 0.5 时
 *  页眉字高一字没变），所以这一档只能由这里自己把字号乘出去；margin box 的 font-size 是认的（实测 40px 生效）。
 *  倍数正是 1 时一个字都不写——"没设过就跟默认"不该变成"每次都写死一个数"；
 *  段自己带了字号（那类码）就交给 segStyle 乘，这里不重复出手 */
function segScaleCss(seg: HfSegment, r: HfRender): string {
  if (r.scale === 1 || seg.pt) return ''
  return `;font-size:${Math.round(HF_BASE_FONT_PX * r.scale * 100) / 100}px`
}

/** 取消「与页边距对齐」：margin box 的 width:100% 不吃（实测），认的是 margin/padding——
 *  往外推的量**正好等于**那一条边距，文字就落在纸张边缘（实测 2in 边距配 -2in 时左端 x=0、右端贴到纸宽减字宽）。
 *  推过头会被整个丢掉（-3in 配 2in 边距 ⇒ 那一格空白，连账都不留），所以一丝都不许多给；
 *  边距本来就是 0 时无从可推，也不写。中格两边都推：不对称边距下它的中心会从可印区中心挪到纸中心 */
function shiftCss(box: HfSegment['box'], r: HfRender): string {
  if (!r.shift) return ''
  const push: string[] = []
  if (box !== 'right' && r.shift.left > 0) push.push(`margin-left:-${r.shift.left}in`)
  if (box !== 'left' && r.shift.right > 0) push.push(`margin-right:-${r.shift.right}in`)
  return push.length ? `;${push.join(';')}` : ''
}

const BOX_EDGE = { header: 'top', footer: 'bottom' } as const
/** 一页上页眉页脚能落笔的全部六格（两边的 @left/@right 竖格我们的三槽里没有对应，不在这份账里） */
const HF_BOXES = ['@top-left', '@top-center', '@top-right', '@bottom-left', '@bottom-center', '@bottom-right']

/** 首页那一版没写到的那几格复位成 normal：`:first` 的排名高于基 `@page` 与 `:right`/`:left`，
 *  但它只对**自己声明过的框**说话，没声明的框就顺着让下面那一版接着印——于是第 1 页会漏进奇数版的左右两格。
 *  复位写 `content:normal` 而不是省略：写成别的字面（实测用 "normal2" 当对照）就把那格占了 */
function resetRest(declared: string): string {
  return HF_BOXES.filter((b) => !declared.includes(`${b}{`))
    .map((b) => `${b}{content:normal;}`)
    .join('')
}

/** 一档（odd/first）落成三条 margin box 规则。
 *  CSS 的一个 margin box 只能整段一种样式，同一段落重复出现也只印第一段——两样都记账 */
function boxesFor(segs: HfSegment[], edge: 'header' | 'footer', notes: string[], r: HfRender): string {
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
    out += `@${BOX_EDGE[edge]}-${s.box}{content:${s.parts.join(' ')}${shiftCss(s.box, r)}${segScaleCss(s, r)}${segStyle(s, r)};}`
  }
  return out
}

/** 起始页码与页眉页脚三版（奇/偶/首）在纸上的全部账目。
 *  planSheetPrint 与面板的 draftPaperNotes 共吃这一份——同一笔账在面板上与在导出时说的是同一句话，
 *  所以文案只许写在这里。判据用的是载荷里有没有那一段字，不是"最后解析出几个框"：
 *  面板上按草稿说话，导出时按同一句草稿话说话，两边才不会各讲一套。
 *
 *  这一轮把「起始页码能不能上纸」重量了一遍（WebView2 150 / PrintToPdf，四页合成文档，五种写法）：
 *  ① `@page:first{counter-reset:page N}` 只改第 1 页显示 N，第 2 页起照旧从 1 数（N=7 → 7,1,2,3）；
 *  ② 复位写在基 `@page` 上 ⇒ 每一页都印同一个 N（没有"往后接着数"）；
 *  ③ `counter-increment:page N` 写在基上 ⇒ N,2N,3N（步长就是增量本身，凑不出"起点 N、步长 1"）；
 *  ④ 复位挂在正文块上（首页首块 / 首页末块两种）⇒ 对页码 counter 完全没有影响；
 *  ⑤ 宿主容器上复位、`@page:nth(1)` ⇒ 都没有效果。
 *  存进文件与 Excel 那头都认（v0.51/v0.52 的只读腿核过），我们的纸上只能从 1 数。
 *  而「设成 1」与「没设」在纸上同一句话：别把用户没写错的东西报成缺陷。 */
export function hfAndPageNumberNotes(print: SheetPrintPayload): string[] {
  const notes: string[] = []
  const start = print.firstPageNumber ?? null
  const filled = (s: string | null | undefined) => !!s && s.trim() !== ''
  const odd = filled(print.header?.odd) || filled(print.footer?.odd)
  const even = filled(print.header?.even) || filled(print.footer?.even)
  const first = filled(print.header?.first) || filled(print.footer?.first)
  if (start != null && start !== 1) {
    notes.push(
      `起始页码设的是 ${start}，纸上仍从 1 开始数（@page 的页码 counter 没有「从 ${start} 接着数」的通道）`,
    )
  }
  // 起始页码在纸上不算，所以奇偶页只能按物理页码分：Excel 里若从 7 起，第 1 页会算奇数页——这一点恰好一致；
  // 但从 2 起时 Excel 的第 1 页是偶数版，我们的是奇数版。这一条要说出口，否则偶数页那一版印在哪一页就成了猜
  if (print.oddEven && start != null && start !== 1) {
    notes.push('起始页码纸上不算，所以「奇偶页不同」是按物理页码分的：第 1 页算奇数页（Excel 按页码分，从偶数起时两边会反过来）')
  }
  if (!print.oddEven && even) {
    notes.push('文件里带着偶数页那一版，但没勾「奇偶页不同」，纸上按奇数那一版印（Excel 也是这样）')
  }
  if (!print.firstDiffers && first) {
    notes.push('文件里带着首页那一版，但没勾「首页不同」，纸上首页跟着奇数版走（Excel 也是这样）')
  }
  if (print.oddEven && odd && !even) {
    notes.push('勾了「奇偶页不同」而偶数页那一版是空的：纸上偶数页不印页眉页脚（Excel 也是这样）')
  }
  // 这一条不是"做不到"而是"做到了但差一圈"：照实说，否则用户会以为两边一模一样
  if (print.alignWithMargins === false && (odd || even || first)) {
    notes.push(
      '「与页边距对齐」是关着的：纸上页眉页脚铺到纸张边缘，Excel 铺到的是打印机的可打印区（比纸边还窄一圈），两边差的就是那一圈',
    )
  }
  return notes
}

/** 页眉页脚在纸上的两处换算，都只有真量才知道数（v0.55 前置实测）：
 *  ① `scaleWithDoc`（缺省开着）——Excel 的那一档**真的**跟着文档缩放：同一份 50% 的件，
 *     开着时页眉字高 5.5pt、关掉时 11pt（对照件 s-on / s-scaleoff）。而我们的缩放是挂在
 *     `<table>` 上的 CSS `zoom`，margin box 是页级的、不在那棵树里（实测内容 zoom 0.5 时
 *     页眉字高一字没变），所以这一档只能自己把字号乘上去；margin box 的 `font-size` 认（实测 40px 生效）。
 *  ② `alignWithMargins`（缺省开着＝按页边距，正好是我们现在的形状）——关掉时 Excel 把页眉条带
 *     铺到**打印机的可打印区**（实测左右对称各留 55pt，随打印机变），我们没有打印机概念，
 *     按纸张边缘铺（实测负 margin 正好等于左右边距时文字落在 x=0 与纸宽减字宽）。 */
export interface HfPaperOpts {
  /** 这一趟真正落到纸上的缩放（面板/文件声明的缩放比例，或被"缩放到 N 页高"压出来的那一档） */
  zoom: number
  /** 本张表的四边距（英寸，top/right/bottom/left）：负 margin 要按左右那两条往外推 */
  margins: [number, number, number, number]
}

/** 页眉页脚 → @page margin box 规则。三版各落一处，其中一条是本轮重量出来的：
 *  ① `@page:odd` / `@page:even` 这一台**不认**（导出来那两页整框空白），认的是 `@page:left` / `@page:right`——
 *     单面打印下第 1 页算 `:right`、往后左右相间，于是 odd↔:right、even↔:left 一一对上；
 *  ② 首页那一版**没写过的框要显式复位成 normal**：不补复位时第 1 页会把奇数版的那几格漏进首页
 *     （实测同一份草稿，只多写三条 `{content:normal}` —— 漏版的那页是「L-奇 C-首 R-奇」，补了才只剩「C-首」）。
 *     页眉三格 + 页脚三格就是这一处能落笔的全部，所以复位按那六格算；
 *     勾了「首页不同」而首页那一版是空的 ⇒ 六格全复位 ⇒ 首页不印页眉页脚（Excel 同义）；
 *  ③ 勾了「奇偶页不同」时奇数版要落在 `@page:right` 而不是基 `@page`：那样偶数页才只吃 even 那一版
 *     （even 空着就是空着，与 Excel 同义）；写在基上会把奇数版漏给偶数页。
 *  顺带把 v0.51 记的「`:first` 必须排在基 `@page` 之前」重量了一遍：**不成立**——同一形状调换源序，
 *  第 2 页起都没有丢框（当时的读数是把整页文字并成一串读的，同 :odd/:even 那次误判一个来源）。
 *  `:first` 的排名确实在 `:left`/`:right` 与基之上（按框逐条比），这一点实测坐实；源序仍按
 *  `:first → :right → :left` 发，为的是让"首页那份先说话"这件事在读代码时一眼可见。
 *  两枚开关决定那两版上不上纸：没勾「奇偶页不同」就不读 even 那一版、没勾「首页不同」就不读 first
 *  （与 Excel 同义——那一段字只是存着），账由 hfAndPageNumberNotes 说。
 *  margin box 只能写在 `@page{}` 里面（实测：裸的 `@top-left{}` 整条不被认），
 *  所以这里成对包好；整体排在 pdfprint 那份"十六个位复位成 normal"之后，后写的说话 */
export function headerFooterCss(
  header: PrintHfPayload | null | undefined,
  footer: PrintHfPayload | null | undefined,
  print: SheetPrintPayload,
  ctx: PrintContext,
  paper: HfPaperOpts,
): { css: string; notes: string[] } {
  const notes: string[] = []
  const r: HfRender = {
    scale: print.scaleWithDoc === false ? 1 : paper.zoom,
    shift: print.alignWithMargins === false ? { left: paper.margins[3], right: paper.margins[1] } : null,
  }
  const oddBoxes =
    boxesFor(parseHf(header?.odd ?? '', ctx, notes), 'header', notes, r) +
    boxesFor(parseHf(footer?.odd ?? '', ctx, notes), 'footer', notes, r)
  const evenBoxes = print.oddEven
    ? boxesFor(parseHf(header?.even ?? '', ctx, notes), 'header', notes, r) +
      boxesFor(parseHf(footer?.even ?? '', ctx, notes), 'footer', notes, r)
    : ''
  const firstBoxes = print.firstDiffers
    ? boxesFor(parseHf(header?.first ?? '', ctx, notes), 'header', notes, r) +
      boxesFor(parseHf(footer?.first ?? '', ctx, notes), 'footer', notes, r)
    : ''
  let css = print.firstDiffers ? `@page:first{${firstBoxes}${resetRest(firstBoxes)}}` : ''
  if (print.oddEven) {
    if (oddBoxes) css += `@page:right{${oddBoxes}}`
    if (evenBoxes) css += `@page:left{${evenBoxes}}`
  } else if (oddBoxes) {
    css += `@page{${oddBoxes}}`
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
  /** 同上，可印**高**：页数模拟与垂直居中比的是这一趟那张纸的高 */
  capacityHeightPx: number
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
      capacityHeightPx: printableHeightPx(SHEET_DEFAULT_PAGE, DEFAULT_MARGINS),
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
    capacityHeightPx: printableHeightPx(first.pageSizeInches, first.margins),
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
