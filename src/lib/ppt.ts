export type SlideLayout = 'title' | 'bullets' | 'image' | 'blank'

export type SlideTransition = 'fade' | 'push' | 'wipe' | 'split'

export const TRANSITION_NAMES: Record<SlideTransition, string> = {
  fade: '淡入',
  push: '推入',
  wipe: '擦除',
  split: '劈开',
}

export type BulletAnim = 'fade' | 'fly' | 'wipe'

export const BULLET_ANIM_NAMES: Record<BulletAnim, string> = {
  fade: '淡入',
  fly: '飞入',
  wipe: '擦除',
}

// 方向位标志与 ECMA-376 presetSubtype 对齐：1=上 2=右 4=下 8=左
export type AnimDir = 'top' | 'right' | 'bottom' | 'left'

export const ANIM_DIR_NAMES: Record<AnimDir, string> = {
  top: '从上方',
  right: '从右侧',
  bottom: '从下方',
  left: '从左侧',
}

export const ANIM_DIR_SUBTYPE: Record<AnimDir, number> = { top: 1, right: 2, bottom: 4, left: 8 }

export type BulletExit = 'fade'

export const BULLET_EXIT_NAMES: Record<BulletExit, string> = {
  fade: '淡出',
}

export interface MasterRect {
  x: number
  y: number
  w: number
  h: number
}

export interface MasterStyle {
  bg?: string // 纯色背景 #rrggbb
  bgImage?: string // 背景图 data URI
  titleColor?: string
  bodyColor?: string
  titleRect?: MasterRect
  bodyRect?: MasterRect
  /** 主题标题字族（v0.140：theme1.xml fontScheme 的 majorFont/latin） */
  majorFont?: string
  /** 主题正文字族（v0.140：fontScheme 的 minorFont/latin） */
  minorFont?: string
}

export interface Slide {
  id: string
  layout: SlideLayout
  title: string
  body: string
  image?: string // data URI
  notes?: string // 演讲者备注
  bg?: string // 单页纯色背景覆盖
  transition?: SlideTransition // 切页动画，未设=无
  anim?: BulletAnim // 要点逐条入场动画；导出映射 PowerPoint 原生 <p:timing>，导入反向识别
  animDir?: AnimDir // 入场方向（fly/wipe 有意义，缺省从下方）
  exitAnim?: BulletExit // 逐条出场（须先有入场）；揭示满后每击退一条
  autoAdvance?: number // 自动换页秒数；导出为 OOXML advTm
  /** v0.140：false = 点击不换页（advClick="0" 且无 advTm 的页只能等自动翻）；未设 = 点击翻页 */
  advClick?: boolean
  /** v0.140：正文逐条入场时长（毫秒）；未设 = 导出默认 500 */
  animDur?: number
  shapes?: SlideShape[] // 自由形状层（v0.107）：不占版式槽的文本框与图片，绝对定位随导出入往返
  animOrder?: string[] // v0.115：放映/导出的揭示序；键形如 'l0'（正文第 1 条）、's2'（第 3 个形状）
}

export type SlideChartType = 'column' | 'bar' | 'line' | 'pie' | 'area'

export const SLIDE_CHART_NAMES: Record<SlideChartType, string> = {
  column: '柱形图',
  bar: '条形图',
  line: '折线图',
  pie: '饼图',
  area: '面积图',
}

/**
 * 幻灯片表格（v0.127）：只存文字与行列结构，不存格级样式——
 * 落 pptx 时交给 PowerPoint 自己的表样式，回读也只认文字。
 * `rows` 是行优先的二维数组，`hasHeader` 时第 0 行是表头行。
 */
export interface SlideTableData {
  rows: string[][]
  hasHeader: boolean
  /** 表头行底色 #rrggbb，未设 = 随主题强调色 */
  headerFill?: string
  /** 是否画格线；未设 = 画 */
  border?: boolean
  /** 表内字号（磅，6~96）；未设 = 14 */
  sizePt?: number
  /** v0.140：列宽——相对表总宽的分数（和为 1）；未设 = 等分 */
  colW?: number[]
  /** v0.140：行高——相对表总高的分数（和为 1）；未设 = PowerPoint 自适应 */
  rowH?: number[]
  /** v0.140：隔行底纹（tblPr@bandRow） */
  bandRow?: boolean
}

/**
 * 幻灯片图表（v0.127）：**只存数据，图由 VChart 现渲**。
 * 于是 .opd 里这一枚形状永远可再编辑（改数改图型都是重渲一张 PNG），
 * 而导出的 pptx 里它是图片——PowerPoint 拿不到原生图表对象，这是这一片的诚实边界。
 */
export interface SlideChartData {
  chartType: SlideChartType
  title?: string
  /** 类目（饼图即扇区名） */
  cats: string[]
  /** 系列；饼图只用第 0 条 */
  series: { name: string; vals: (number | null)[] }[]
  stacked?: boolean
}

/** 新建表格形状时的默认行列数（Word/PowerPoint 插入表格对话框都是这个起步尺寸） */
export const DEFAULT_TABLE_ROWS = 3
export const DEFAULT_TABLE_COLS = 3

/**
 * 自由形状（画布驱动第一片）：坐标是相对整页宽高的分数（0..1，允许少许越界——
 * 真实版面里就有出血元素），字号用 PowerPoint 的磅值（10 英寸页宽的语义）。
 */
export interface SlideShape {
  id: string
  kind: 'text' | 'image' | 'table' | 'chart'
  x: number
  y: number
  w: number
  h: number
  text?: string // kind=text：多行以 \n 分行
  color?: string // 文字色 #rrggbb
  sizePt?: number // 字号（磅，4~400）
  bold?: boolean
  italic?: boolean // v0.140：斜体（rPr@i）
  underline?: boolean // v0.140：下划线（rPr@u；只表达单线，双线/点线导入降级）
  /** v0.140：文本在框内的垂直锚点（bodyPr@anchor） */
  anchor?: 'top' | 'middle' | 'bottom'
  /** v0.140：false = 文本不换行、溢出框外（bodyPr@wrap="none"）；未设 = 换行 */
  wrap?: boolean
  /** v0.140：形状名（cNvPr@name）——PowerPoint 选择窗格与动画目标用它认人 */
  name?: string
  /** v0.140：替代文本（cNvPr@descr）——屏幕阅读器念的图说 */
  alt?: string
  align?: 'left' | 'center' | 'right'
  fill?: string // 文本框底色 #rrggbb（v0.108；kind=text；缺省透明）
  outline?: string // 边框色 #rrggbb（v0.108；导出仅文本形状落，图片边框只进渲染）
  outlineW?: number // 边框宽（磅，0.25~20；缺省 1）
  image?: string // kind=image：data URI
  /** kind=table：表格的文字与结构（v0.127） */
  table?: SlideTableData
  /** kind=chart：图表的数据（v0.127）；图不入库，按它现渲 */
  chart?: SlideChartData
  // 形状自己的逐条动画（v0.111）：带动画的形状各占揭示序里的一票，
  // 导出各占一枚 PowerPoint clickEffect（spTgt 指这个形状）；
  // v0.115 起次序可调，默认仍是「正文逐条在前、形状按数组序（= 层叠序）在后」
  anim?: BulletAnim
  animDir?: AnimDir
  exitAnim?: BulletExit
  /** v0.140：入场时长（毫秒，50~600000）；未设 = 导出默认 500 */
  animDur?: number
}

export interface DeckTheme {
  id: string
  name: string
  bg: string
  fg: string
  accent: string
}

export interface Deck {
  app: 'openoffices'
  kind: 'deck'
  version: 1
  title: string
  theme: string
  slides: Slide[]
  master?: MasterStyle
}

export const THEMES: DeckTheme[] = [
  { id: 'default', name: '简洁白', bg: '#ffffff', fg: '#1f2329', accent: '#2c66d4' },
  { id: 'dark', name: '深夜蓝', bg: '#141a2b', fg: '#e8ecf5', accent: '#5b8cff' },
  { id: 'gray', name: '商务灰', bg: '#f2f3f5', fg: '#33383f', accent: '#4e5969' },
  { id: 'warm', name: '暖阳橙', bg: '#fff8ef', fg: '#4a3520', accent: '#e8732a' },
  { id: 'green', name: '墨绿青', bg: '#f0f7f2', fg: '#1e3a2b', accent: '#21a366' },
  { id: 'rose', name: '樱桃红', bg: '#fff5f5', fg: '#4a1f24', accent: '#d43c4f' },
]

export function themeOf(id: string): DeckTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export const LAYOUT_NAMES: Record<SlideLayout, string> = {
  title: '标题页',
  bullets: '内容页',
  image: '图片页',
  blank: '空白页',
}

let seq = 0
export function newId(): string {
  seq += 1
  return `s${Date.now().toString(36)}${seq}`
}

export function newSlide(layout: SlideLayout = 'bullets'): Slide {
  return {
    id: newId(),
    layout,
    title: layout === 'title' ? '演示文稿标题' : '',
    body: layout === 'title' ? '副标题 / 日期 / 作者' : '',
  }
}

/**
 * 新建表格形状（v0.127）：默认 3×3 带表头，落点避开标题条那一带。
 * 表头格先填占位字——全空的表会被 parseTable 判为「没数据」整枚丢掉。
 */
export function newTableShape(x = 0.15, y = 0.32, w = 0.7, h = 0.42): SlideShape {
  const rows = Array.from({ length: DEFAULT_TABLE_ROWS }, (_, r) =>
    Array.from({ length: DEFAULT_TABLE_COLS }, (_, c) => (r === 0 ? `表头${c + 1}` : '')),
  )
  return {
    id: newId(),
    kind: 'table',
    x,
    y,
    w,
    h,
    table: { rows, hasHeader: true },
  }
}

/** 新建图表形状（v0.127）：起手一支柱形图带四个月份，好过一枚空框不知道要填什么 */
export function newChartShape(x = 0.15, y = 0.3, w = 0.7, h = 0.45): SlideShape {
  return {
    id: newId(),
    kind: 'chart',
    x,
    y,
    w,
    h,
    chart: {
      chartType: 'column',
      cats: ['一月', '二月', '三月', '四月'],
      series: [{ name: '系列1', vals: [12, 19, 8, 15] }],
    },
  }
}

/**
 * 改表格行列数（v0.127）：短了裁掉、长了补空串，行 1..64 / 列 1..32。
 * 裁掉的那几行文字随之没了——这是「删行」的本来意思，不做撤销栈之外的保留。
 */
export function resizeTable(t: SlideTableData, rows: number, cols: number): SlideTableData {
  const R = Math.max(1, Math.min(Math.round(rows) || 1, 64))
  const C = Math.max(1, Math.min(Math.round(cols) || 1, 32))
  const out = Array.from({ length: R }, (_, r) => {
    const src = t.rows[r] ?? []
    return Array.from({ length: C }, (_, c) => src[c] ?? '')
  })
  return { ...t, rows: out }
}

/** 表格形状的行列数（UI 与导出共用同一份读法：行数是 rows.length，列数取最宽那行） */
export function tableDims(t: SlideTableData): { rows: number; cols: number } {
  return {
    rows: t.rows.length,
    cols: t.rows.reduce((m, r) => Math.max(m, r.length), 0),
  }
}

export function emptyDeck(): Deck {
  return {
    app: 'openoffices',
    kind: 'deck',
    version: 1,
    title: '未命名演示',
    theme: 'default',
    slides: [newSlide('title'), newSlide('bullets')],
  }
}

export function bodyLines(slide: Slide): string[] {
  return slide.body.split(/\r?\n/).filter((l) => l.trim().length > 0)
}

function isTransition(v: unknown): v is SlideTransition {
  return typeof v === 'string' && v in TRANSITION_NAMES
}

function isBulletAnim(v: unknown): v is BulletAnim {
  return typeof v === 'string' && v in BULLET_ANIM_NAMES
}

function isAnimDir(v: unknown): v is AnimDir {
  return typeof v === 'string' && v in ANIM_DIR_NAMES
}

function isBulletExit(v: unknown): v is BulletExit {
  return typeof v === 'string' && v in BULLET_EXIT_NAMES
}

/** 带入场动画的形状：数组序 = 默认序的后半段（v0.111） */
export function animShapes(slide: Slide): SlideShape[] {
  return (slide.shapes ?? []).filter((s) => s.anim)
}

/** 揭示序里的一项（v0.115）：正文第 idx 条（0 基）或第 idx 个形状（slides.shapes 的下标） */
export type RevealItem = { kind: 'line'; idx: number } | { kind: 'shape'; idx: number }

/** 这一项在 animOrder 里的写法：`l0` / `s2`（.opd 与 ordering UI 共用一套键） */
export function revealItemKey(it: RevealItem): string {
  return it.kind === 'line' ? `l${it.idx}` : `s${it.idx}`
}

/** 形状那一项指向的形状（line 那一类返回 undefined） */
export function revealItemShape(slide: Slide, it: RevealItem): SlideShape | undefined {
  return it.kind === 'shape' ? (slide.shapes ?? [])[it.idx] : undefined
}

/**
 * 默认揭示序（没有 animOrder 时走这一份）：正文逐条在前（只在真有动画时入场），
 * 形状按数组序（= 层叠序）在后。
 */
function defaultItems(slide: Slide): RevealItem[] {
  const out: RevealItem[] = []
  if (slide.anim) {
    for (let i = 0; i < bodyLines(slide).length; i++) out.push({ kind: 'line', idx: i })
  }
  ;(slide.shapes ?? []).forEach((sh, i) => {
    if (sh.anim) out.push({ kind: 'shape', idx: i })
  })
  return out
}

/**
 * 这一页真正的揭示序（v0.115）：按 animOrder 排，两份防线——
 * 认不出的键（改了正文条数、删了形状）丢掉，没点名的项按默认序补在末尾，
 * 于是排坏了的 animOrder 最坏退化成默认序，不会丢人或重复。
 */
export function revealOrder(slide: Slide): RevealItem[] {
  const items = defaultItems(slide)
  const want = slide.animOrder
  if (!want || !want.length) return items
  const rest = new Map(items.map((it) => [revealItemKey(it), it]))
  const out: RevealItem[] = []
  for (const k of want) {
    const it = rest.get(k)
    if (it) {
      out.push(it)
      rest.delete(k)
    }
  }
  for (const it of items) if (rest.has(revealItemKey(it))) out.push(it)
  return out
}

/**
 * 把 UI 上排好的序列写回 slide：与默认序相同就置 undefined——
 * 「没说话」和「说了一遍默认序」在文件里是同一件事，多存一份只是给将来留垃圾。
 */
export function writeAnimOrder(slide: Slide, items: RevealItem[]): string[] | undefined {
  const keys = items.map(revealItemKey)
  const def = defaultItems(slide).map(revealItemKey)
  return keys.join(',') === def.join(',') ? undefined : keys
}

/** 这一项会不会出场（正文看页级 exitAnim，形状看自己那份） */
function hasExit(slide: Slide, it: RevealItem): boolean {
  return it.kind === 'line' ? !!slide.exitAnim : !!revealItemShape(slide, it)?.exitAnim
}

/** 出场序（v0.115）：揭示序里会出场的那几项，按原次序退去（全揭示完之后才开始） */
export function revealExits(slide: Slide, order?: RevealItem[]): RevealItem[] {
  return (order ?? revealOrder(slide)).filter((it) => hasExit(slide, it))
}

/** 这一项的入场效果与方向（UI 标签、放映动画类名与导出三处共用同一份裁决） */
export function revealAnimOf(slide: Slide, it: RevealItem): { anim: BulletAnim; dir: AnimDir } | undefined {
  if (it.kind === 'line') return slide.anim ? { anim: slide.anim, dir: slide.animDir ?? 'bottom' } : undefined
  const sh = revealItemShape(slide, it)
  return sh?.anim ? { anim: sh.anim, dir: sh.animDir ?? 'bottom' } : undefined
}

function countKind(items: RevealItem[], kind: RevealItem['kind']): number {
  let n = 0
  for (const it of items) if (it.kind === kind) n += 1
  return n
}

/**
 * 这一页放映一共几步（点击几次才翻页）：揭示序逐项入场，
 * 全部揭示完再按同一次序逐个出场。零步表示这页没有逐条，点击直接翻页
 */
export function revealSteps(slide: Slide): number {
  const order = revealOrder(slide)
  return order.length + revealExits(slide, order).length
}

/**
 * 放映揭示进度：正文与形状各记一套（v0.111 起形状也进逐条序列）。
 * 只记枚数不记名单：次序那一份账住在 slide.animOrder 里，
 * 放映侧按同一个 revealOrder 把枚数还原成「此刻该看见哪几条」（见 revealSets）
 */
export interface RevealState {
  lines: number // 已揭示的正文条数
  exitLines: number // 已退场的正文条数（从头退）
  shapes: number // 已揭示的形状数（只数带动画的）
  exitShapes: number // 已退场的形状数
  /** 刚揭示的那一项与它的入场效果（出场阶段没有） */
  fresh?: { kind: 'line' | 'shape'; anim: BulletAnim; dir: AnimDir }
}

/** 第 step 步（1 起）这一页长什么样 */
export function revealAt(slide: Slide, step: number): RevealState {
  const allLines = bodyLines(slide).length
  const order = revealOrder(slide)
  const enter = order.length
  const exits = revealExits(slide, order)
  const total = enter + exits.length
  const s = Math.min(Math.max(step, 1), Math.max(total, 1))
  if (s <= enter && enter > 0) {
    // 入场：按揭示序逐项揭示（各项按自己的 kind 分别计数交货）
    const seq = order.slice(0, s)
    const last = seq[seq.length - 1]
    const eff = last ? revealAnimOf(slide, last) : undefined
    return {
      lines: slide.anim ? countKind(seq, 'line') : allLines,
      exitLines: 0,
      shapes: countKind(seq, 'shape'),
      exitShapes: 0,
      ...(last && eff ? { fresh: { kind: last.kind, anim: eff.anim, dir: eff.dir } } : {}),
    }
  }
  // 出场：揭示完之后才开始，次序仍是揭示序里会出场的那几项
  const out = exits.slice(0, s - enter)
  return {
    lines: slide.anim ? countKind(order, 'line') : allLines,
    exitLines: countKind(out, 'line'),
    shapes: countKind(order, 'shape'),
    exitShapes: countKind(out, 'shape'),
  }
}

/**
 * 把 revealAt 的枚数还原成名单（v0.115）：次序一乱就再没有「前 n 条」这种说法了
 * （第 3 击可能揭示的是第 2 个形状），所以姓名 single source 仍是 revealOrder。
 * 名单里只有**参与逐条的那几项**：没动画的形状恒不在名单里，渲染层按它自己的
 * anim 判定能不能直接显示，不必在这里替它说话。
 */
export function revealSets(
  slide: Slide,
  reveal: RevealState,
  order?: RevealItem[],
): {
  lines: Set<number>
  shapes: Set<number>
  exitedLines: Set<number>
  exitedShapes: Set<number>
  freshLine?: number
  freshShape?: number
} {
  const seq = order ?? revealOrder(slide)
  const lineSeq = seq.filter((it) => it.kind === 'line')
  const shapeSeq = seq.filter((it) => it.kind === 'shape')
  const exits = revealExits(slide, seq)
  const pick = (items: RevealItem[], n: number) =>
    new Set(items.slice(0, Math.max(0, Math.min(n, items.length))).map((it) => it.idx))
  return {
    lines: pick(lineSeq, reveal.lines),
    shapes: pick(shapeSeq, reveal.shapes),
    exitedLines: pick(exits.filter((it) => it.kind === 'line'), reveal.exitLines),
    exitedShapes: pick(exits.filter((it) => it.kind === 'shape'), reveal.exitShapes),
    freshLine: reveal.fresh?.kind === 'line' ? lineSeq[reveal.lines - 1]?.idx : undefined,
    freshShape: reveal.fresh?.kind === 'shape' ? shapeSeq[reveal.shapes - 1]?.idx : undefined,
  }
}

export function serializeDeck(deck: Deck): string {
  return JSON.stringify(deck, null, 2)
}

function parseRect(v: unknown): MasterRect | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const r = v as Record<string, unknown>
  const n = [r.x, r.y, r.w, r.h].map((k) => (typeof k === 'number' && Number.isFinite(k) ? k : NaN))
  return n.every((k) => !Number.isNaN(k)) ? { x: n[0], y: n[1], w: n[2], h: n[3] } : undefined
}

function parseMaster(v: unknown): MasterStyle | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const m = v as Record<string, unknown>
  const str = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : undefined)
  const out: MasterStyle = {
    bg: str('bg'),
    bgImage: str('bgImage'),
    titleColor: str('titleColor'),
    bodyColor: str('bodyColor'),
    titleRect: parseRect(m.titleRect),
    bodyRect: parseRect(m.bodyRect),
    majorFont: str('majorFont'),
    minorFont: str('minorFont'),
  }
  return Object.values(out).some((x) => x !== undefined) ? out : undefined
}

/** 表格守卫（v0.127）：行数封顶 64、每行 32 格，非字符串按空串收；整张空表不出形状 */
function parseTable(v: unknown): SlideTableData | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const r = v as Record<string, unknown>
  if (!Array.isArray(r.rows)) return undefined
  const rows = r.rows.slice(0, 64).map((row) =>
    Array.isArray(row) ? row.slice(0, 32).map((c) => (typeof c === 'string' ? c : c == null ? '' : String(c))) : [],
  )
  if (!rows.length || !rows.some((row) => row.some((c) => c.trim()))) return undefined
  const sizePt = typeof r.sizePt === 'number' && r.sizePt >= 6 && r.sizePt <= 96 ? r.sizePt : undefined
  const hex = /^#[0-9a-fA-F]{6}$/
  // v0.140：列宽/行高是「相对总宽/总高的分数」——每枚 0<f<=1，长度与行列数对齐才收，
  // 和是不是 1 不强求（导出时按和归一，手改过的 .opd 也翻不了天）
  const fracs = (v: unknown, max: number): number[] | undefined => {
    if (!Array.isArray(v)) return undefined
    const out = v
      .slice(0, max)
      .filter((f) => typeof f === 'number' && Number.isFinite(f) && f > 0 && f <= 1)
    return out.length ? out : undefined
  }
  return {
    rows,
    hasHeader: r.hasHeader === true,
    headerFill: typeof r.headerFill === 'string' && hex.test(r.headerFill) ? r.headerFill : undefined,
    border: r.border === false ? false : undefined,
    sizePt,
    colW: fracs(r.colW, 32),
    rowH: fracs(r.rowH, 64),
    bandRow: r.bandRow === true ? true : undefined,
  }
}

/** 图表守卫（v0.127）：图型认不出即弃，类目 64 / 系列 16 / 值 64 三道封顶；一条像样的系列都没有就不出形状 */
function parseChart(v: unknown): SlideChartData | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const r = v as Record<string, unknown>
  const ct = r.chartType
  if (typeof ct !== 'string' || !(ct in SLIDE_CHART_NAMES)) return undefined
  const cats = Array.isArray(r.cats)
    ? r.cats.slice(0, 64).map((c) => (typeof c === 'string' ? c : String(c ?? '')))
    : []
  const series = Array.isArray(r.series)
    ? r.series.slice(0, 16).map((raw) => {
        const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
        const vals = Array.isArray(s.vals)
          ? s.vals.slice(0, 64).map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : null))
          : []
        return { name: typeof s.name === 'string' ? s.name : '', vals }
      })
    : []
  if (!series.length) return undefined
  return {
    chartType: ct as SlideChartType,
    title: typeof r.title === 'string' ? r.title : undefined,
    cats,
    series,
    stacked: r.stacked === true ? true : undefined,
  }
}

/** 形状守卫：坐标必须是有限数、宽高为正，字号/对齐/颜色越界即弃（.opd 是 JSON，别信旧文件的内容） */
function parseShapes(v: unknown): SlideShape[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: SlideShape[] = []
  for (const raw of v.slice(0, 64)) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const num = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? r[k] : NaN)
    const [x, y, w, h] = ['x', 'y', 'w', 'h'].map(num)
    if ([x, y, w, h].some((n) => Number.isNaN(n)) || w <= 0 || h <= 0) continue
    const kind =
      r.kind === 'image' ? 'image'
        : r.kind === 'text' ? 'text'
        : r.kind === 'table' ? 'table'
        : r.kind === 'chart' ? 'chart'
        : null
    if (!kind) continue
    // 表格/图表没有数据就没得画：整枚形状丢掉，而不是落一个空盒子
    const table = kind === 'table' ? parseTable(r.table) : undefined
    const chart = kind === 'chart' ? parseChart(r.chart) : undefined
    if ((kind === 'table' && !table) || (kind === 'chart' && !chart)) continue
    const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : undefined)
    const align = ['left', 'center', 'right'].includes(String(r.align)) ? (r.align as SlideShape['align']) : undefined
    const sizePt =
      typeof r.sizePt === 'number' && Number.isFinite(r.sizePt) && r.sizePt >= 4 && r.sizePt <= 400
        ? r.sizePt
        : undefined
    const hex = (k: string) => (typeof r[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(r[k] as string) ? (r[k] as string) : undefined)
    const outlineW =
      typeof r.outlineW === 'number' && Number.isFinite(r.outlineW) && r.outlineW >= 0.25 && r.outlineW <= 20
        ? r.outlineW
        : undefined
    // v0.140：斜体/下划线/锚点/换行 + 形状名/替代文本 + 动画时长。text 才有的样式别泄到别的 kind 上
    const dur = (k: string) =>
      typeof r[k] === 'number' && Number.isFinite(r[k] as number) && (r[k] as number) >= 50 && (r[k] as number) <= 600000
        ? (r[k] as number)
        : undefined
    const anchor = ['top', 'middle', 'bottom'].includes(String(r.anchor)) ? (r.anchor as SlideShape['anchor']) : undefined
    const short = (k: string) => (typeof r[k] === 'string' && (r[k] as string).trim() ? (r[k] as string).slice(0, 256) : undefined)
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      kind,
      x,
      y,
      w,
      h,
      text: kind === 'text' ? str('text') : undefined,
      color: kind === 'text' && /^#[0-9a-fA-F]{6}$/.test(String(r.color)) ? (r.color as string) : undefined,
      sizePt,
      bold: kind === 'text' && r.bold === true ? true : undefined,
      italic: kind === 'text' && r.italic === true ? true : undefined,
      underline: kind === 'text' && r.underline === true ? true : undefined,
      anchor: kind === 'text' ? anchor : undefined,
      wrap: kind === 'text' && r.wrap === false ? false : undefined,
      name: short('name'),
      alt: short('alt'),
      align,
      fill: kind === 'text' ? hex('fill') : undefined,
      outline: hex('outline'),
      outlineW,
      image: kind === 'image' ? str('image') : undefined,
      table,
      chart,
      anim: isBulletAnim(r.anim) ? r.anim : undefined,
      animDir: r.anim && isAnimDir(r.animDir) ? r.animDir : undefined,
      exitAnim: r.anim && isBulletExit(r.exitAnim) ? r.exitAnim : undefined,
      animDur: dur('animDur'),
    })
  }
  return out.length ? out : undefined
}

/**
 * animOrder 守卫（v0.115）：只收 `l<n>` / `s<n>` 形状的键（别的一律丢），去重、
 * 长度封顶 64；收不出一枚就当没设（退化成默认序）。这里只挑「像不像键」，
 * 至于键有没有对应的正文行/形状，交给 revealOrder 那一层的无名项补回来
 */
function parseAnimOrder(v: unknown): { animOrder: string[] } | undefined {
  if (!Array.isArray(v)) return undefined
  const keys = v.filter((k): k is string => typeof k === 'string').filter((k) => /^[ls]\d{1,3}$/.test(k))
  const uniq = [...new Set(keys)]
  return uniq.length ? { animOrder: uniq.slice(0, 64) } : undefined
}

export function parseDeck(text: string): Deck {
  const raw = JSON.parse(text) as Partial<Deck>
  if (raw.app !== 'openoffices' || raw.kind !== 'deck' || !Array.isArray(raw.slides)) {
    throw new Error('不是有效的 OpenOffices 演示文件（.opd）')
  }
  const deck: Deck = {
    app: 'openoffices',
    kind: 'deck',
    version: 1,
    title: typeof raw.title === 'string' ? raw.title : '未命名演示',
    theme: typeof raw.theme === 'string' ? raw.theme : 'default',
    slides: raw.slides.map((s) => ({
      id: typeof s.id === 'string' ? s.id : newId(),
      layout: (['title', 'bullets', 'image', 'blank'] as string[]).includes(s.layout ?? '')
        ? s.layout!
        : 'bullets',
      title: typeof s.title === 'string' ? s.title : '',
      body: typeof s.body === 'string' ? s.body : '',
      image: typeof s.image === 'string' ? s.image : undefined,
      notes: typeof s.notes === 'string' ? s.notes : undefined,
      bg: typeof s.bg === 'string' ? s.bg : undefined,
      transition: isTransition(s.transition) ? s.transition : undefined,
      anim: isBulletAnim(s.anim) ? s.anim : undefined,
      animDir: isAnimDir(s.animDir) ? s.animDir : undefined,
      exitAnim: isBulletExit(s.exitAnim) ? s.exitAnim : undefined,
      autoAdvance:
        typeof s.autoAdvance === 'number' && s.autoAdvance > 0 && s.autoAdvance <= 3600
          ? s.autoAdvance
          : undefined,
      // v0.140：advClick 只存 false（「点击不换页」）；true 与未设同义，不占字节
      advClick: s.advClick === false ? false : undefined,
      animDur:
        typeof s.animDur === 'number' && Number.isFinite(s.animDur) && s.animDur >= 50 && s.animDur <= 600000
          ? s.animDur
          : undefined,
      shapes: parseShapes(s.shapes),
      ...(parseAnimOrder(s.animOrder) ?? {}), // v0.115：认不出的排坏了的次序不进模型（退化成默认序）
    })),
  }
  const master = parseMaster(raw.master)
  if (master) deck.master = master
  return deck
}
