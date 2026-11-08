import {
  AlignmentType,
  BorderStyle,
  Bookmark,
  Column,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  DeletedTextRun,
  EndnoteReferenceRun,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  HeightRule,
  NumberFormat,
  type IBorderOptions,
  type ICharacterStyleOptions,
  type IFontAttributesProperties,
  type ILevelParagraphStylePropertiesOptions,
  type IParagraphStyleOptions,
  type IRunStylePropertiesOptions,
  type ISpacingProperties,
  ImageRun,
  ImportedXmlComponent,
  InsertedTextRun,
  LevelFormat,
  LineRuleType,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  SectionType,
  SymbolRun,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type   TabStopDefinition,
  type IFrameOptions,
  type ITableFloatOptions,
  HorizontalPositionRelativeFrom,
  VerticalPositionRelativeFrom,
  UnderlineType,
} from 'docx'
import { xml2js } from 'xml-js'
import { bdAttr, borderParts, parsePbdrPayload, parseTrPrPayload, pxToEighths, pxToPt, parseBdrPayload, parseCnfPayload, parseFramePayload, parseImgPayload, parsePprPayload, parseShadePayload, parseShdPayload, parseTabsPayload, parseTblbPayload, parseTblpPayload, parseTblPrPayload, parseTlookPayload, CELL_EDGES, CNF_KEYS, EFFECT_ATTRS, effectKey, PPR_IND_KEYS, TBLB_EDGES, TBLB_KEYS, type CellEdge } from './cell-style'
import { lineToOoxml, type LineRule } from './paragraph-style'
import { decodeEnt } from './ooxml'
import { condLookBits } from './table-cond'
import { letterSpacingToTwips } from './char-spacing'

export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  text?: string
}

/**
 * data-u 载荷 `线型;屏上色;字面色;themeColor;themeTint;themeShade` → 包的 underline 槽
 * + 待补的主题三枚（v0.156，v0.159 扩到六格）。
 *
 * 线型与字面色是包的原生槽（IRunOptions.underline.type / .color，dist/index.d.ts:1647），
 * 实现里 `createUnderline(type, color)` 逐枚写进 w:u 的 w:val 与 w:color（颜色过
 * hexColorValue 校验）。线型按 OOXML 那十八档的名字对（大小写不敏感），认不得的档
 * 落 single——宁可写成单线也不要写出一个 Word 认不得的枚举值。
 *
 * 主题三枚包外无槽（createUnderline 只认 val/color 两枚属性），返回值里的 `theme`
 * 是拼好的属性串，由 `patchUTheme` 在打包之后按序补回——与 w:sym 同一条 run 级
 * 补丁位的机制。第二格「屏上色」不写盘：它是解析主题之后的显示用色，落到 w:color
 * 会把主题引用钉死成一个字面值（往返账上那笔 ff0000 → b4c7e7 就是这么来的）
 */
type ULineType = (typeof UnderlineType)[keyof typeof UnderlineType]
const U_TYPE = new Map<string, ULineType>(Object.values(UnderlineType).map((v) => [String(v).toLowerCase(), v]))

/**
 * 主题引用三枚 → 待补的属性串（v0.159 用在 `w:u`、v0.160 用在 `w:color`）。
 *
 * 成品是 ` w:themeColor="accent1"` 这种**带前导空格**的串，直接拼进元素开标签的 `>`
 * 之前。空槽不写——「没写这一枚」与「写了 0」在 OOXML 里是两回事（themeTint="00"
 * 是「不调亮」，缺这一枚是「不声明」），别替源件补。
 */
function themeAttrs(ref: string | undefined, tint: string | undefined, shade: string | undefined): string {
  return [
    ref ? ` w:themeColor="${xmlAttr(ref)}"` : '',
    tint ? ` w:themeTint="${xmlAttr(tint)}"` : '',
    shade ? ` w:themeShade="${xmlAttr(shade)}"` : '',
  ].join('')
}

interface ULoad {
  value?: { type?: ULineType; color?: string }
  /** 待补进 `<w:u>` 开标签的属性串（前导空格起头）；没有主题引用时是空串 */
  theme: string
}
function underlineOf(child: PMNode, on: boolean): ULoad {
  const raw = markAttr(child, 'charExtra', 'u')
  const [val = '', , lit = '', thc = '', tht = '', ths = ''] = (raw ?? '').split(';')
  const theme = themeAttrs(thc, tht, ths)
  if (!raw) return { ...(on ? { value: {} } : {}), theme: '' }
  const type = U_TYPE.get((val || 'single').toLowerCase()) ?? UnderlineType.SINGLE
  // 字面走字面：主题在场时源件的 w:color 未必等于解析出来的色，两枚各归各的槽
  const c = lit && lit.toLowerCase() !== 'auto' ? lit.replace(/^#/, '').toUpperCase() : undefined
  return { value: { type, ...(c ? { color: c } : {}) }, theme }
}

// TipTap 3 getJSON 的文本节点是顶层 text；历史结构测试用过 attrs.text，两者都兼容
function textValue(node: PMNode): string {
  return node.text ?? (node.attrs?.text as string) ?? ''
}

// 批注条目：text 为批注内容，正文用 comment mark(cid) 锚定；docx 往返写 word/comments.xml
export interface DocComment {
  id: number
  author?: string
  /** 作者姓名缩写（w:comment/@w:initials，v0.154）：与 author 同属批注身份链，UI 暂不显示 */
  initials?: string
  date?: string
  text: string
  resolved?: boolean
}

// 页面设置：mm 存储；size=custom 时用 w/h，margin 缺项回退默认
export interface PageMargin {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PageSetup {
  size?: 'A4' | 'Letter' | 'custom'
  w?: number
  h?: number
  margin?: Partial<PageMargin>
  /** 装订线（v0.147，mm）：w:pgMar/@w:gutter。屏上不排页码边，只随页面设置往返 */
  gutter?: number
  /** 页眉/页脚距纸边（v0.147，mm）：w:pgMar/@w:header 与 @w:footer，缺省按上下边距取小 */
  header?: number
  footer?: number
  /** 文档网格（v0.147）：w:docGrid 的档位与行间距（linePitch 缇）。屏上不兑现，只往返。
   *  v0.152 补 charSpace（每字符网格宽度，缇）——与 linePitch 同住 w:docGrid 上的第三枚 */
  docGrid?: { type?: string; linePitch?: number; charSpace?: number }
  /** 纸张方向（v0.147）：w:pgSz/@w:orient。缺省按宽高比推（宽>高即横版） */
  orient?: 'portrait' | 'landscape'
  /** 分栏数（1=不分栏）；与 colGap（mm）一起贯穿视图/打印/docx/odt */
  cols?: number
  colGap?: number
  /**
   * 不等宽分栏（v0.182）：`w:cols/@w:equalWidth=0` 与逐枚 `w:col/@w:w|@w:space`。
   * 缇原值，屏上 CSS columns 只能等宽、不兑现，只用于 docx 往返；包的
   * `column.children: Column[]` 是原生槽，post-pack 不用动。
   */
  colsLayout?: { equalWidth?: boolean; widths?: { w: number; space?: number }[] }
  /**
   * 节起法与纸型档位号（v0.183）：`w:type/@w:val` 与 `w:pgSz/@w:code`。
   * 两枚都是屏上零兑现的元信息，但写好写回能让 Word 记住「这一节是接着排、
   * 用户选的是 A4 那一格」。包的两个原生槽直接吃这两个值，原样透传不换算。
   */
  sectionType?: string
  paperCode?: string
  /**
   * 页码型别与起始值（v0.170）：`w:pgNumType/@w:fmt|@w:start`。屏上没有分页视图，
   * 页码是域算的，但纸面上「这一节从 iii 开始、用罗马数字」是实打实的设置
   */
  pageNum?: { fmt?: string; start?: number }
}

/**
 * 节属性原文（v0.147）：body 末尾 `w:sectPr` 的 pgSz/pgMar/cols/docGrid，单位仍是缇
 * （与 OOXML 同，不做换算——换算是调用方那一头的事）。
 *
 * 这一族原本由 `docxToDocMeta` 用正则读（正则不进 attr 漏斗，保真账本上是盲区：
 * 读是读了，账上没有）。v0.147 起改由读手（docx-fidelity）走 attr 读、随 `DocxImport`
 * 出来，调用方折成 `PageSetup` 合并进 meta——同一份数只有一个读数出处
 */
export interface DocxSection {
  w?: number
  h?: number
  orient?: 'portrait' | 'landscape'
  margin?: { top?: number; right?: number; bottom?: number; left?: number; header?: number; footer?: number; gutter?: number }
  cols?: number
  colGap?: number
  /** v0.182：不等宽分栏逐栏表（缇原值），与 PageSetup.colsLayout 同形，只往返不屏现 */
  colsLayout?: { equalWidth?: boolean; widths?: { w: number; space?: number }[] }
  docGrid?: { type?: string; linePitch?: number; charSpace?: number }
  /** v0.183：节起法 `w:type/@w:val` 与纸型档位号 `w:pgSz/@w:code`，原值直传只往返 */
  sectionType?: string
  paperCode?: string
  /** 页码型别与起始值（v0.170）：`w:pgNumType` 的两枚属性，原样带回 `PageSetup.pageNum` */
  pageNum?: { fmt?: string; start?: number }
}

/**
 * 节属性原文（缇）→ PageSetup（mm）。与 `docxToDocMeta` 里那条正则腿同口径（尺寸档
 * 判定、分栏缺省回落、一位小数），两腿读的是同一份数——那条腿留给不跑读手的导入路径
 */
export function pageSetupOf(s: DocxSection): PageSetup {
  // 缇 → 毫米留两位（v0.158）：一位小数是**不可逆**的——1800 缇 = 31.7499…（浮点上差一点
  // 到不了 31.75），一位小数截成 31.7，回算只剩 1797；851 缇（15.0105）截成 15.0 回算 850。
  // 两位小数把往返误差压到 0.3 缇以内，取整后都能回到原值。毫米是 UI 上那一栏的单位，
  // 多一位只让显示多一位，语义不变
  const rmm = (v?: number) => (v === undefined ? undefined : Math.round(v * 100) / 100)
  const mm = (t?: number) => (t === undefined || !(t > 0) ? undefined : rmm(t / MM_TWIPS))
  const page: PageSetup = {}
  if (s.pageNum) page.pageNum = { ...s.pageNum }
  // v0.183：两枚都是字面值（不是尺寸），不做 mm / 缇换算
  if (s.sectionType) page.sectionType = s.sectionType
  if (s.paperCode) page.paperCode = s.paperCode
  const pw = mm(s.w)
  const ph = mm(s.h)
  if (pw && ph) {
    const near = (a: number, b: number) => Math.abs(a - b) < 1
    const size = near(pw, 210) && near(ph, 297) ? 'A4' : near(pw, 215.9) && near(ph, 279.4) ? 'Letter' : 'custom'
    const margin: Partial<PageMargin> = {}
    const tm = mm(s.margin?.top)
    const rm = mm(s.margin?.right)
    const bm = mm(s.margin?.bottom)
    const lm = mm(s.margin?.left)
    if (tm !== undefined) margin.top = tm
    if (rm !== undefined) margin.right = rm
    if (bm !== undefined) margin.bottom = bm
    if (lm !== undefined) margin.left = lm
    page.size = size
    if (size === 'custom') {
      page.w = rmm(pw)
      page.h = rmm(ph)
    }
    if (Object.keys(margin).length) page.margin = margin
  }
  // 方向：Word 的 orient 与宽高比一般同向，两样都说话时以 orient 为准（它是显式声明）
  if (s.orient) page.orient = s.orient
  const g = mm(s.margin?.gutter)
  if (g !== undefined) page.gutter = g
  const hd = mm(s.margin?.header)
  if (hd !== undefined) page.header = hd
  const ft = mm(s.margin?.footer)
  if (ft !== undefined) page.footer = ft
  if (s.cols && s.cols > 1) {
    page.cols = Math.min(4, s.cols)
    const gap = mm(s.colGap)
    if (gap && Math.abs(gap - DEFAULT_COL_GAP) > 0.6) page.colGap = gap
  }
  // v0.182：逐栏表是缇原值，不做 mm 换算（换算误差会写成源件没说过的话）
  if (s.colsLayout) page.colsLayout = s.colsLayout
  if (s.docGrid && Object.keys(s.docGrid).length) page.docGrid = s.docGrid
  return page
}

/** 页码呈现格式：仅影响页脚里的页码域写法（默认 cn=第 N 页，与 v0.30~v0.32 文件兼容） */
export type PageNumberFormat = 'plain' | 'cn' | 'dash' | 'ofTotal'

export const PAGE_NUMBER_FORMATS: { id: PageNumberFormat; label: string }[] = [
  { id: 'plain', label: '1' },
  { id: 'cn', label: '第 1 页' },
  { id: 'dash', label: '- 1 -' },
  { id: 'ofTotal', label: '1 / 3（含总页数）' },
]

// 页码格式的"屏幕/打印"两种渲染：CSS counter 用于 @page margin box，域用于 docx/odt
export function pageNumberParts(f: PageNumberFormat | undefined): { before: string; after: string; total: boolean } {
  switch (f) {
    case 'plain':
      return { before: '', after: '', total: false }
    case 'dash':
      return { before: '- ', after: ' -', total: false }
    case 'ofTotal':
      return { before: '', after: '', total: true }
    default:
      return { before: '第 ', after: ' 页', total: false }
  }
}

// 从页脚文本反推页码格式：页脚里还混着自定义文字，故只看紧邻页码数字的包裹符；判不出走 plain
export function detectPageFormat(rawText: string, hasNumPages: boolean): PageNumberFormat {
  const t = rawText.replace(/\s+/g, '')
  if (hasNumPages || /\d\/\d/.test(t)) return 'ofTotal'
  if (/第\d+页/.test(t)) return 'cn'
  if (/(-\d+-|^\d+-$)/.test(t)) return 'dash'
  return 'plain'
}

export const PAGE_SIZES_MM = { A4: [210, 297], Letter: [215.9, 279.4] } as const
export const DEFAULT_PAGE_MARGIN: PageMargin = { top: 20, right: 22, bottom: 20, left: 22 }
export const DEFAULT_COL_GAP = 8
export const MM_PX = 96 / 25.4
const MM_TWIPS = 1440 / 25.4

export function resolvePage(p?: PageSetup): {
  w: number
  h: number
  margin: PageMargin
  cols: number
  colGap: number
  /** 装订线（mm，v0.147）；没写是 undefined——与「装订线 0」不同，后者不占版心 */
  gutter?: number
  /** 页眉/页脚距纸边（mm，v0.147）；没写时写侧按上下边距取小 */
  header?: number
  footer?: number
  orient?: 'portrait' | 'landscape'
  docGrid?: { type?: string; linePitch?: number; charSpace?: number }
  /** v0.183：节起法与纸型档位号，原值透传给包的原生槽 */
  sectionType?: string
  paperCode?: string
  pageNum?: { fmt?: string; start?: number }
  colsLayout?: { equalWidth?: boolean; widths?: { w: number; space?: number }[] }
} {
  const preset = p?.size === 'Letter' ? PAGE_SIZES_MM.Letter : PAGE_SIZES_MM.A4
  const w = p?.size === 'custom' && p.w ? p.w : preset[0]
  const h = p?.size === 'custom' && p.h ? p.h : preset[1]
  const cols = Math.min(4, Math.max(1, Math.round(p?.cols ?? 1)))
  return {
    w,
    h,
    margin: { ...DEFAULT_PAGE_MARGIN, ...p?.margin },
    cols,
    colGap: p?.colGap ?? DEFAULT_COL_GAP,
    ...(p?.gutter !== undefined ? { gutter: p.gutter } : {}),
    ...(p?.header !== undefined ? { header: p.header } : {}),
    ...(p?.footer !== undefined ? { footer: p.footer } : {}),
    ...(p?.orient ? { orient: p.orient } : {}),
    ...(p?.docGrid ? { docGrid: p.docGrid } : {}),
    ...(p?.pageNum ? { pageNum: p.pageNum } : {}),
    ...(p?.colsLayout ? { colsLayout: p.colsLayout } : {}),
    ...(p?.sectionType ? { sectionType: p.sectionType } : {}),
    ...(p?.paperCode ? { paperCode: p.paperCode } : {}),
  }
}

type ResolvedPage = ReturnType<typeof resolvePage>

/**
 * 版心宽度（twips）：页宽减左右边距，多栏时再扣栏间距按栏数分。
 * 这是「一张表到底有多宽」的唯一一处算法——docx 写侧的等分与界面上的精确列宽都吃它，
 * 两边各算一份迟早会分叉（屏上 1:1、字节里另一套）。
 */
export function contentTwipsOf(pg: ResolvedPage): number {
  const tw = (mm: number) => Math.round(mm * MM_TWIPS)
  return Math.max(
    1,
    Math.floor((tw(pg.w) - tw(pg.margin.left) - tw(pg.margin.right) - tw(pg.colGap) * (pg.cols - 1)) / pg.cols),
  )
}

/** 版心宽度（px 整数，与写侧 gridTw 的 px↔twips 同一处换算） */
export function contentPxOf(pg: ResolvedPage): number {
  return Math.floor(contentTwipsOf(pg) / PX_TWIP)
}

/**
 * 表样式的条件层（v0.116）：`w:tblStylePr` 的 `@w:type`（ST_TblStyleOverrideType）。
 * 列出了 ST_TblStyleOverrideType 里 Word 真会落出来的十二型。`wholeTable` 不收：
 * 实测它换哪一格写都不落（见 docx-fidelity 里 styleCondCells 那条注），收进来只是给用户
 * 一个按下没反应的旋钮。
 */
export const TABLE_COND_TYPES = [
  'firstRow',
  'lastRow',
  'firstColumn',
  'lastColumn',
  'band1Vert',
  'band2Vert',
  'band1Horz',
  'band2Horz',
  'nwCell',
  'neCell',
  'swCell',
  'seCell',
] as const
export type TableCondType = (typeof TABLE_COND_TYPES)[number]

/** 一块条件里本体支持的那几样：默认格底纹与格边距住 `w:tcPr`，粗体住 `w:rPr` */
export interface TableCond {
  background?: string
  bold?: boolean
  padTopPx?: number
  padRightPx?: number
  padBottomPx?: number
  padLeftPx?: number
  /** 条件格边框（`w:tcBorders`，住 `w:tcPr` 内）：每条边是 CSS 边框串，与表级 `bdTop` 同格式 */
  borders?: Partial<Record<CellEdge, string>>
  /** 条件行高（`w:trPr`/`w:trHeight`，仅行型条件 firstRow/lastRow/band*Horz 有效）：px；
   *  Word 的 exact（超高裁内容）CSS 表达不了，按最小行高读入并标记 */
  rowHeightPx?: number
  rowHeightExact?: boolean
}

/** 条件格的中文名（Word「表样式」对话框那十二个勾位，band 就是"镶边"） */
export const TABLE_COND_LABEL: Record<TableCondType, string> = {
  firstRow: '首行',
  lastRow: '末行',
  firstColumn: '首列',
  lastColumn: '末列',
  band1Vert: '奇数列',
  band2Vert: '偶数列',
  band1Horz: '奇数行',
  band2Horz: '偶数行',
  nwCell: '左上角',
  neCell: '右上角',
  swCell: '左下角',
  seCell: '右下角',
}

/** 认 `w:type` 那串：Word 写的是 `firstRow` 这种驼峰，大小写差一级也算同一型，返回规范（驼峰）那枚 */
export function asTableCondType(v: string | undefined): TableCondType | undefined {
  if (!v) return undefined
  const low = v.trim().toLowerCase()
  return TABLE_COND_TYPES.find((t) => t.toLowerCase() === low)
}

/**
 * 命名样式（v0.102）：导入时从 styles.xml 读出的段落样式清单。
 * run/para 是沿 basedOn 链摊平后的快照（读侧 readRPr/styleView 现成的合并语义），
 * 单位与编辑器内部一致：字号/间距/缩进 px、行距倍数或 px、颜色 #rrggbb。
 * 快照只当「这份文档的样式长什么样」用——编辑器内不提供样式表编辑（改一处全文变），
 * 套用样式是把快照摊进段落直接格式 + 挂 pStyle 标签，导出时标签与样式表一起写回。
 */
export interface DocxStyleInfo {
  /** OOXML 的 w:styleId；导出按它写回 w:pStyle/w:rStyle，样式表定义也按它命名 */
  id: string
  name: string
  basedOn?: string
  /** 样式种类（v0.113）：'paragraph'（缺省，旧 meta 无此键）/ 'character' / 'table'（v0.114） */
  kind?: 'paragraph' | 'character' | 'table'
  /** 标题级别（1..9，outlineLvl+1），非标题没有 */
  level?: number
  /**
   * 样式元数据三枚（v0.146）：uiPriority 是 Word 样式库里的排序档位（w:uiPriority/@w:val），
   * link 指着配对的反向样式（段落↔字符，w:link/@w:val），customStyle 是「用户自建」标记
   * （w:style/@w:customStyle，onOff——false 是显式关，与没写不同结果）。屏上不兑现，只往返
   */
  uiPriority?: number
  link?: string
  customStyle?: boolean
  /**
   * 样式身份两枚（v0.150）：`w:next/@w:val` 是「回车后接着用哪个样式」（Word 里
   * 「样式→后续段落样式」那一项），`w:rsid/@w:val` 是这份样式定义最后被谁改过（
   * 修订会话号）。两枚都不改屏上排版；rsid 是流水号、屏上零语义，但它在真件里的
   * 字面量不小，且丢了会让 Word 的「合并文档」对不上账，所以照收照写
   */
  next?: string
  rsid?: string
  /**
   * 样式的别名（v0.155）：`w:aliases/@w:val`，逗号分隔的「也叫什么」。Word 的中文名
   * 常挂在这里（样式 id 是英文、面板上显示中文）。屏上不兑现、随补丁往返：丢了只剩英文名
   */
  aliases?: string
  run: {
    font?: string
    /**
     * 主题字体引用名（v0.161）：`w:asciiTheme` / `w:eastAsiaTheme` / `w:hAnsiTheme` /
     * `w:cstheme` 四枚的原值。与 `font`（解析后的具名字体）**同时写回**——只写解析值
     * 等于把「跟着主题走」改成「钉死某套字体」，换主题时文档不再跟着变。
     */
    fontTheme?: { ascii?: string; eastAsia?: string; hAnsi?: string; cs?: string }
    sizePx?: number
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strike?: boolean
    color?: string
  }
  para: {
    align?: string
    marginLeftPx?: number
    marginRightPx?: number
    textIndentPx?: number
    lineHeight?: number
    lineRule?: 'auto' | 'exact' | 'atLeast'
    spaceBeforePx?: number
    spaceAfterPx?: number
    /** 大纲级别 0..8：level 存在时恒为 level-1，单列出来是给没有标题名分级的自定义样式用 */
    outlineLevel?: number
  }
  /**
   * 表样式快照（v0.114，仅 kind='table'）：表级那一层说了什么。
   * 边框沿用单元格那套规范串（`"0.67px solid #8899aa"`，`'none'` 是显式无边，缺省是没声明），
   * 六条边分别是外框四边与内部横竖线（`w:tblBorders` 的六个槽）；格边距是 px；
   * align 是整张表的水平位置（`w:jc`），background 是**默认格底纹**（样式自己的 `w:tcPr/w:shd`，
   * 逐格 w:shd 仍优先——与任意层直接格式压样式同一条纪律）。
   */
  table?: {
    bdTop?: string
    bdRight?: string
    bdBottom?: string
    bdLeft?: string
    bdInsideH?: string
    bdInsideV?: string
    padTopPx?: number
    padRightPx?: number
    padBottomPx?: number
    padLeftPx?: number
    align?: string
    background?: string
    /**
     * 条件层（v0.116）：按部位再压一层——首行/末行/首列/末列/奇行偶行/四个角。
     * 每块只管格底纹、格边距与粗体这三样（`w:tcPr/w:shd`、`w:tcPr/w:tcMar`、`w:rPr/w:b`）；
     * 落到哪一格按位置算（见 doc-style-css 的 condRules）。空对象等于没开票：不写它那枚 `w:tblStylePr`。
     */
    cond?: Partial<Record<TableCondType, TableCond>>
    /**
     * 条件层闸门原文（v0.147）：表样式 `w:tblPr/w:tblLook` 的三枚——`val` 是 Word 存的
     * 那份四位闸门原值（十六进制串），`noHBand`/`noVBand` 是隔行/隔列带不套的 onOff。
     * 有它就照抄，没有才由 cond 反推（condLookBits）——反推出来的与原文不一定同
     */
    look?: { val?: string; noHBand?: boolean; noVBand?: boolean }
  }
}

/**
 * 潜在样式的一条（v0.146）：w:latentStyles/w:lsdException。onOff 三枚（semiHidden/
 * unhideWhenUsed/qFormat/locked）存布尔三态——false 是显式「关」，与没写（undefined）
 * 在 Word 里不同结果（显式关压过容器的 def* 缺省），往返必须分得开
 */
export interface DocxLsdException {
  name?: string
  uiPriority?: number
  semiHidden?: boolean
  unhideWhenUsed?: boolean
  qFormat?: boolean
  locked?: boolean
}

/**
 * 潜在样式容器（v0.146）：w:latentStyles 自己那六枚 + 全部 lsdException。
 * Word 样式库的门面账（哪些内建样式露面、排第几档），与正文排版无关，屏上不兑现。
 * docx 包没有这一族的槽，导出走打包后补丁（patchLatentStyles，与 w:tblLook 同路数）
 */
/**
 * 文档背景（v0.155）：与读手侧 DocBackground 同构（写手不反向依赖 docx-fidelity，
 * 故在此另立一份——与 DocxLatentStyles 同一格）
 */
export interface DocBackground {
  /** 解析出来的 CSS 色；没有主题槽时它就是回写的字面值（去掉 # 转大写） */
  css?: string
  /** 字面色原文（v0.157）：主题槽在场时 Word 按主题算，这枚是兜底值，跟着一起写回 */
  color?: string
  themeColor?: string
  themeShade?: string
  themeTint?: string
}

export interface DocxLatentStyles {
  count?: number
  defLockedState?: boolean
  defUIPriority?: number
  defSemiHidden?: boolean
  defUnhideWhenUsed?: boolean
  defQFormat?: boolean
  exceptions: DocxLsdException[]
}

/**
 * 编号定义一层的账（v0.150）：`w:numbering/w:abstractNum/w:lvl` 上的三枚。
 * `tentative` 是「这一层还在草拟」（Word 用它标记模板里没定稿的层，onOff），
 * `tplc` 是模板层号（十六进制串，与模板里的层对位），`suff` 是编号与正文之间
 * 夹的那一段（tab/space/nothing，`w:suff/@w:val`）。
 * 三枚都不改屏上编号——屏上那串是 ListRegistry 按段重建的，与定义层不是同一棵树
 */
export interface DocxLvlMeta {
  tentative?: boolean
  tplc?: string
  suff?: string
  /**
   * 这一层自己的档位（v0.158）：`w:numFmt/@w:val` 与 `w:lvlText/@w:val`，逐层单存一份。
   * 从前这两枚只以合并串的形式活在 `fp` 里（`0:bullet|·;1:lowerLetter|%2.`），写手拿不到
   * 「第 1 层是 lowerLetter」这种信息，重建编号时只能把三层全拍成同一个符面——于是内容
   * 指纹对不上，`patchNumberingXml` 认不出这条定义，**整族元数据（suff/lvlRestart/
   * styleLink/nsid/tmpl）跟着一起贴不回去**。存成字段后写手能照原样逐层重建。
   */
  fmt?: string
  text?: string
  /**
   * 这一层是否随上一级重新起号（v0.155）：`w:lvlRestart/@w:val`，0 表示永不重起。
   * 屏上零兑现（编号串由 ListRegistry 按段重建），随 numbering.xml 补丁往返
   */
  restart?: number
  /**
   * 图片项目符号的编号（v0.155）：`w:lvlPicBulletId/@w:val`，指着 numbering 根上
   * `w:numPicBullet/@w:numPicBulletId`。**只回写这一枚引用**——图片本体在
   * numPicBullet 里（我们不发图片项目符号），引用留着不指空是给 Word 看的
   */
  picBulletId?: number
  /**
   * Word 2003 老式编号缩进补偿（v0.183）：`w:legacy/@w:legacy|@w:legacySpace|
   * @w:legacyIndent` 三枚原值。屏上零兑现，随 numbering.xml 的 insertKid 往返；
   * 三枚都是字面值（onOff 也按原值存），不做归一，免得把源件没说过的话写回去。
   */
  legacy?: { legacy?: string; space?: string; indent?: string }
  /**
   * 编号符面对齐（v0.184）：`w:lvlJc/@w:val` 的源件字面值。屏上那一半早已由
   * `LvlDef.lvlJc` → `markerAlignOf` 走 `listLevels` 兑现，但那是「按段重建」的链；
   * numbering.xml 补丁链此前没带这一枚，包又恒发 `w:lvlJc=start`，于是源件里
   * `center` 那一层被冲掉。升成带值载荷后按 ilvl 改值（不是插元素）。
   */
  lvlJc?: string
}

/**
 * 编号定义一份的身份（v0.150）：`nsid` 是定义自身的流水号（Word 靠它认「这两份
 * 定义是同一份」，合并文档时对账用），`tmpl` 指着模板编号，`multiLevelType` 说
 * 这份定义是不是设计成多级联动（hybridMultilevel/multilevel/singleLevel）。
 * 与 DocxLvlMeta 同一条纪律：只往返，屏上不兑现
 */
export interface DocxAbstractNumMeta {
  nsid?: string
  tmpl?: string
  multiLevelType?: string
  /**
   * 分页后重新编号总闸（v0.152）：`w:abstractNum/@w:restartNumberingAfterBreak`——
   * 与上面三枚子元素相反，这一枚是开标签上的**属性**（onOff）。写侧由
   * patchOneAbstractNum 按 local name 设回开标签（包常写 w15: 同名属性，前缀不认）
   */
  rna?: boolean
  /**
   * 这份定义挂在哪条样式上（v0.155）：`w:abstractNum/w:styleLink/@w:val`。它是 styles.xml
   * 里 `w:link` 的反向（那边「样式链到编号」，这边「编号链回样式」）。屏上不兑现，
   * 随补丁往返——CT_AbstractNum 的序排在 styleLink 之前的是 tmpl/name，之后是 numStyleLink
   */
  styleLink?: string
  /**
   * 内容指纹（v0.150）：按 ilvl 序的 `numFmt|lvlText` 序列。包的编号 id 是自己发的
   * （与原文未必同号），贴回时就靠这份指纹把「原文那一条定义」在包里认出来——
   * 认不出来的不贴（宁缺毋滥），见 patchNumberingXml
   */
  fp: string
  /** ilvl（字符串键，JSON 落地后没有数字键）→ 那一层的三枚 */
  levels: Record<string, DocxLvlMeta>
}

/**
 * 编号定义表（v0.150）：按 `w:abstractNum` 在 numbering.xml 里的出现序排的一份数组。
 * 出包后由 patchNumberingXml 按同一个序贴回去——包的编号 id 与原文未必同号，
 * 所以这里刻意不存 numId/abstractNumId，只存序（与段落余量那笔同一路数）
 */
export interface DocxNumbering {
  defs: DocxAbstractNumMeta[]
}

// 页眉页脚设置 + 批注列表 + 页面设置：随 .odoc meta 存储，导出写入 OOXML
export interface DocMeta {
  headerText?: string
  footerText?: string
  /**
   * 首页另版档（b39）：ODT 的 `style:header-first` / `style:footer-first`（以及 LibreOffice 写成 `loext:` 的那一族同名的）。
   * 只上纸的第 1 页（DocEditor 的 `@page:first` margin box），屏上是连续流、没有「首页」这一位；
   * docx 读写与 odt 写手都还不吃这一层，所以它是读侧单向的账。
   */
  headerTextFirst?: string
  footerTextFirst?: string
  footerPageNumber?: boolean
  pageNumberFormat?: PageNumberFormat
  comments?: DocComment[]
  page?: PageSetup
  /** 文档带进来的段落样式清单（v0.102）：随 meta 持久化，导出时重建样式表 */
  styles?: DocxStyleInfo[]
  /**
   * 潜在样式（v0.146）：w:latentStyles 容器与全部 lsdException——Word 样式库的门面账。
   * 屏上不兑现，只随 meta 持久化、导出时补丁回 styles.xml；ODT 没有这一族，odt 导入不设置
   */
  latentStyles?: DocxLatentStyles
  /**
   * 编号定义账（v0.150）：nsid/tmpl/multiLevelType 与逐层的 tentative/tplc/suff。
   * 屏上不兑现，随 meta 持久化、导出时补丁回 numbering.xml；ODT 没有这一族，odt 导入不设置
   */
  numbering?: DocxNumbering
  /**
   * 文档背景（v0.155）：`w:document/w:background` 三枚——整篇的底色（Word「页面颜色」）。
   * 屏上兑现在外层容器的 background-color；导出是包的原生槽 IDocumentBackgroundOptions，
   * 四枚属性一一对应，所以这一族**真双向**（与 numbering/latentStyles 那两族不同：
   * 它们要 post-pack 补丁，这一族不用）
   */
  background?: DocBackground
  /**
   * 主题件原文（v0.164）：`word/theme/theme1.xml` 整份。写手发出去的主题引用
   * （`w:themeColor`/`w:themeFill`/`w:asciiTheme` 这一族）指着它，缺了就只能由 Word
   * 拿默认主题顶上——所以导出时原样带回去（见 attachThemePart）
   */
  themeXml?: string
}

export async function docxToHtml(bytes: Uint8Array): Promise<string> {
  const arrayBuffer = bytes.slice().buffer
  const mammoth = (await import('mammoth')).default
  const result = await mammoth.convertToHtml({ arrayBuffer })
  return result.value
}

/**
 * 打开一份 .docx 的**共享 zip 会话**（v0.180）。
 *
 * 此前 `docxToDocMeta` 与 `docxToHtmlFidelity` 各自 `JSZip.loadAsync(bytes)` 一遍，
 * `word/document.xml`、`word/theme/theme1.xml`、`word/_rels/document.xml.rels`
 * 三份部件各解压 + 转 UTF-8 两次。现在调用方先建一枚会话：zip 实例共享、
 * 部件文本按名缓存，两个入口都从同一处读。
 *
 * 会话是**可选参数**：不传就走原来的「各自解包」路径。这样 A/B 两腿同源、
 * 只差这一个参数，判据可长期复现（v0.179 的教训：手工 git archive 副本会过期）。
 */
export interface DocxZipSession {
  /** 同一个 zip 实例，供读手 f.load 直读图片字节；调用方只透传、不解类型 */
  zip: unknown
  /** 带缓存的部件文本读取；缺件一律返回空串，与原 read 闭包同义 */
  read(name: string): Promise<string>
}

interface ZipView {
  file(name: string): { async(kind: 'string'): Promise<string>; async(kind: 'arraybuffer'): Promise<ArrayBuffer> } | null
}

export async function openDocxZip(bytes: Uint8Array): Promise<DocxZipSession> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const cache = new Map<string, string>()
  const read = async (name: string): Promise<string> => {
    const hit = cache.get(name)
    if (hit !== undefined) return hit
    const text = (await zip.file(name)?.async('string')) ?? ''
    cache.set(name, text)
    return text
  }
  return { zip, read }
}

// mammoth 不读页眉页脚：直接解 zip 里 sectPr 引用的 header/footer XML，抽文本与 PAGE 页码域
export async function docxToDocMeta(bytes: Uint8Array, shared?: DocxZipSession): Promise<DocMeta> {
  let zip: ZipView
  if (shared) {
    zip = shared.zip as ZipView
  } else {
    const { default: JSZip } = await import('jszip')
    zip = (await JSZip.loadAsync(bytes)) as unknown as ZipView
  }
  const readText = shared?.read ?? (async (p: string) => (await zip.file(p)?.async('string')) ?? '')
  const docXml = await readText('word/document.xml')
  const relsText = await readText('word/_rels/document.xml.rels')
  const relFor = (rid: string) =>
    relsText.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ??
    relsText.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))?.[1]
  const refOf = (tag: string) => {
    // Word 可能同时写 even/default/first 三个引用，取 default（无 type 属性时取首个）
    const rid =
      docXml.match(new RegExp(`<w:${tag}Reference[^>]*w:type="default"[^>]*r:id="(rId\\d+)"`))?.[1] ??
      docXml.match(new RegExp(`<w:${tag}Reference[^>]*r:id="(rId\\d+)"`))?.[1]
    if (!rid) return undefined
    const target = relFor(rid)
    if (!target) return undefined
    return zip.file(target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`)
  }
  const readPart = async (tag: string): Promise<{ text?: string; raw: string; hasPage: boolean; hasNumPages: boolean }> => {
    const f = refOf(tag)
    if (!f) return { raw: '', hasPage: false, hasNumPages: false }
    const xml = await f.async('string')
    // 段落里文本按 w:t 顺序拼接（Word 会保留节点内空格，不要额外插空格）
    const text = (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
      .map((m) => m.replace(/<[^>]+>/g, ''))
      .join('')
      .trim()
    // 页码域形态多样：fldSimple instr / fldChar+instrText / instrText 含 PAGE
    const hasPage = /PAGE(\s|\*|"|'|<)/.test(xml)
    const hasNumPages = /NUMPAGES|SECTIONPAGES/.test(xml)
    return { text: text || undefined, raw: text, hasPage, hasNumPages }
  }
  const [head, foot] = await Promise.all([readPart('header'), readPart('footer')])
  // 页码域的缓存值（数字/第/页/共）混在 w:t 里，带页码域时把这些剔掉
  const stripPageTokens = (t: string) =>
    t
      .split(/\s+/)
      .filter((x) => x && x !== '第' && x !== '页' && x !== '共' && x !== '·' && x !== '-' && x !== '/' && !/^\d+$/.test(x))
      .join(' ')
  const out: DocMeta = {}
  if (head.text) out.headerText = head.text
  if (foot.text) {
    const rest = foot.hasPage ? stripPageTokens(foot.text) : foot.text
    if (rest) out.footerText = rest
  }
  if (foot.hasPage) {
    out.footerPageNumber = true
    out.pageNumberFormat = detectPageFormat(foot.raw, foot.hasNumPages)
  }
  // 页面设置：body 末尾 sectPr 的 pgSz/pgMar（twips → mm）
  const pgSz = docXml.match(/<w:pgSz[^>]*>/)?.[0]
  const pgMar = docXml.match(/<w:pgMar[^>]*>/)?.[0]
  const colsEl = docXml.match(/<w:cols[^>]*>/)?.[0]
  const pgNumEl = docXml.match(/<w:pgNumType[^>]*>/)?.[0]
  const tw = (xml: string | undefined, attr: string) => {
    const v = Number(xml?.match(new RegExp(`w:${attr}="(\\d+)"`))?.[1])
    return Number.isFinite(v) && v > 0 ? v / MM_TWIPS : undefined
  }
  const pw = tw(pgSz, 'w')
  const ph = tw(pgSz, 'h')
  const mt = tw(pgMar, 'top')
  const mr = tw(pgMar, 'right')
  const mb = tw(pgMar, 'bottom')
  const ml = tw(pgMar, 'left')
  // 与 pageSetupOf 那一处同一把尺子（v0.158）：两位小数，缇 → 毫米 → 缇 能回到原值
  const rmm = (v?: number) => (v === undefined ? undefined : Math.round(v * 100) / 100)
  const page: PageSetup = {}
  if (pw && ph) {
    const near = (a: number, b: number) => Math.abs(a - b) < 1
    const size = near(pw, 210) && near(ph, 297) ? 'A4' : near(pw, 215.9) && near(ph, 279.4) ? 'Letter' : 'custom'
    const margin: Partial<PageMargin> = {}
    const tm = rmm(mt)
    const rm = rmm(mr)
    const bm = rmm(mb)
    const lm = rmm(ml)
    if (tm !== undefined) margin.top = tm
    if (rm !== undefined) margin.right = rm
    if (bm !== undefined) margin.bottom = bm
    if (lm !== undefined) margin.left = lm
    page.size = size
    if (size === 'custom') {
      page.w = rmm(pw)
      page.h = rmm(ph)
    }
    if (Object.keys(margin).length) page.margin = margin
  }
  // 页码型别（v0.170）：与 pgSz/pgMar 同路——回退导入也把它带进 page
  if (pgNumEl) {
    const fmt = pgNumEl.match(/w:fmt="([A-Za-z]+)"/)?.[1]
    const st = Number(pgNumEl.match(/w:start="(\d+)"/)?.[1])
    const pageNum: NonNullable<PageSetup['pageNum']> = {}
    if (fmt) pageNum.fmt = fmt
    if (Number.isFinite(st) && st >= 0) pageNum.start = st
    if (Object.keys(pageNum).length) page.pageNum = pageNum
  }
  // 分栏：w:num>1 才算多栏；栏间距缺省时回退默认而不写进 meta
  const num = Number(colsEl?.match(/w:num="(\d+)"/)?.[1])
  if (num > 1) {
    page.cols = Math.min(4, num)
    const gap = tw(colsEl, 'space')
    if (gap && Math.abs(gap - DEFAULT_COL_GAP) > 0.6) page.colGap = rmm(gap)
  }
  if (Object.keys(page).length) out.page = page
  // 主题件（v0.164）：整份原样带走，导出时原样放回（见 attachThemePart）。
  // v0.180：走共享会话的 read（读手那份 theme1.xml 也走同一处），省掉第二次解压；
  // 缺件时返回空串，与原来 `if (themeFile)` 的门逐字同义
  const themeXml = await readText('word/theme/theme1.xml')
  if (themeXml.trim()) out.themeXml = themeXml
  return out
}

/** 批注条目列表（只到"有哪些批注"，不含正文锚点位置） */
export function commentRowsOf(commentsXml: string, extXml: string): DocComment[] {
  // 段落里文本按 w:t 顺序拼接（Word 会保留节点内空格，不要额外插空格）
  const joinT = (xml: string) => (xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? []).map((m) => m.replace(/<[^>]+>/g, '')).join('')
  // commentsExtended 里 done="1" 的 paraId 集合（docx 库写属性式，Word 写 w15:val 元素式，都兼容）
  const doneParaIds = new Set<string>()
  for (const m of extXml.matchAll(/<w15:commentEx[^>]*w15:paraId="([0-9A-Fa-f]+)"[^>]*w15:done="1"/g)) {
    doneParaIds.add(m[1].toUpperCase())
  }
  for (const m of extXml.matchAll(/<w15:commentEx[^>]*w15:done="1"[^>]*w15:paraId="([0-9A-Fa-f]+)"/g)) {
    doneParaIds.add(m[1].toUpperCase())
  }
  const rows = [...commentsXml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)]
    .map((m) => ({ attrs: m[1], body: m[2] }))
    .sort((a, b) => Number(a.attrs.match(/w:id="(\d+)"/)?.[1] ?? 0) - Number(b.attrs.match(/w:id="(\d+)"/)?.[1] ?? 0))
  const out: DocComment[] = []
  for (const { attrs, body } of rows) {
    const id = Number(attrs.match(/w:id="(\d+)"/)?.[1])
    if (!Number.isFinite(id)) continue
    const author = attrs.match(/w:author="([^"]*)"/)?.[1]
    const date = attrs.match(/w:date="([^"]*)"/)?.[1]
    // docx 库与 Word 都把 paraId 写成 w:p 上的 w14:paraId 属性；兼容 w15 写法
    const paraIdM =
      body.match(/w14:paraId="([0-9A-Fa-f]+)"/) ??
      body.match(/w15:paraId="([0-9A-Fa-f]+)"/) ??
      body.match(/<w15:paraId w15:val="([0-9A-Fa-f]+)"/)
    out.push({
      id,
      text: decodeEnt(joinT(body)),
      ...(author ? { author: decodeEnt(author) } : {}),
      ...(date ? { date } : {}),
      ...(paraIdM && doneParaIds.has(paraIdM[1].toUpperCase()) ? { resolved: true } : {}),
    })
  }
  return out
}

/**
 * v0.176：一次扫完 `document.xml`，收齐每个批注的锚文本。
 *
 * 此前 `anchorOf(id)` 对每个批注各跑一次全文正则、一次 `docXml.slice(bodyStart)`
 * 大串复制、一次全文 `indexOf` —— O(批注数 × 全文)。这里一趟 `matchAll` 收齐
 * 所有 Start/End，再按 id 配对，是 O(全文 + 各锚点片段)。
 *
 * 等价纪律（结构测试逐例对撞旧算法）：① 每个 id 只认第一对 Start/End；
 * ② 仍取「Start 之后第一个同 id End」；③ `indexOf('</w:p>', start) < endAt`
 * 这条跨段判据原样保留（含 indexOf 返回 -1 时 -1 < endAt 为真的边界）；
 * ④ joinT 由调用方传入，与旧路径同一份实现。
 */
function commentAnchorsOf(docXml: string, joinT: (xml: string) => string): Map<number, string> {
  const out = new Map<number, string>()
  const opens = new Map<number, number>()
  const seen = new Set<number>()
  const re = /<w:commentRange(Start|End)[^>]*w:id="(\d+)"[^>]*>/g
  for (const m of docXml.matchAll(re)) {
    const id = Number(m[2])
    if (seen.has(id)) continue
    const at = m.index ?? 0
    if (m[1] === 'Start') {
      if (!opens.has(id)) opens.set(id, at + m[0].length)
      continue
    }
    const bodyStart = opens.get(id)
    if (bodyStart === undefined) continue
    opens.delete(id)
    seen.add(id)
    if (docXml.indexOf('</w:p>', bodyStart) < at) continue
    const text = decodeEnt(joinT(docXml.slice(bodyStart, at)))
    if (text) out.set(id, text)
  }
  return out
}

// mammoth 会丢弃批注：兜底路径直读 word/comments.xml 取内容/作者，document.xml 里 commentRangeStart/End
// 取锚文本，在 HTML 中把锚文本包成 <span data-oo-comment>，由 Comment mark 还原。
// （保真导入路径按区间原位包 span，不走这里，只用 commentRowsOf）
export async function docxToCommentHtml(
  bytes: Uint8Array,
  html: string,
): Promise<{ html: string; comments: DocComment[] }> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const part = zip.file('word/comments.xml')
  if (!part) return { html, comments: [] }
  const [docXml, commentsXml, extXml] = await Promise.all([
    zip.file('word/document.xml')?.async('string') ?? Promise.resolve(''),
    part.async('string'),
    zip.file('word/commentsExtended.xml')?.async('string') ?? Promise.resolve(''),
  ])
  const joinT = (xml: string) =>
    (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
      .map((m) => m.replace(/<[^>]+>/g, ''))
      .join('')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const anchors = commentAnchorsOf(docXml, joinT)
  const comments = commentRowsOf(commentsXml, extXml)
  // v0.177：一次规划 + 分段构建，替掉「每枚批注把整串 outHtml 复制两遍」的
  // O(批注数 × HTML) 循环。每枚批注在**原始 html** 里认领自己那一处：
  // 同一锚文本的第 n 枚批注认领第 n 次出现（旧写法每次在累积串里从头找，
  // 第二枚会命中刚插进去的 span，把两枚批注套成嵌套——这里顺手修掉，
  // 单独立账，见 test-comment-anchor.mjs 第 9 条）。逆序批注也各自从头找，
  // 不按 id 顺序推进游标，免得把文档里排在前面的锚点漏掉。
  const used = new Map<string, number>()
  const marks: { at: number; id: number; needle: string }[] = []
  for (const comment of comments) {
    const anchor = anchors.get(comment.id)
    if (!anchor) continue
    const needle = esc(anchor)
    const nth = used.get(needle) ?? 0
    let at = -1
    for (let k = 0; k <= nth; k++) {
      at = html.indexOf(needle, at + 1)
      if (at < 0) break
    }
    if (at < 0) continue
    used.set(needle, nth + 1)
    marks.push({ at, id: comment.id, needle })
  }
  marks.sort((a, b) => a.at - b.at || a.id - b.id)
  let outHtml = ''
  let cursor = 0
  for (const m of marks) {
    if (m.at < cursor) continue // 锚文本重叠时后一枚让步，不造交叉 span
    outHtml += html.slice(cursor, m.at) + `<span data-oo-comment="${m.id}">${m.needle}</span>`
    cursor = m.at + m.needle.length
  }
  outHtml += html.slice(cursor)
  return { html: outHtml, comments }
}

function textOf(node: PMNode): string {
  if (node.type === 'text') return textValue(node)
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(textOf).join('')
}

function hasMark(node: PMNode, type: string): boolean {
  return (node.marks ?? []).some((m) => m.type === type)
}

function linkHref(node: PMNode): string | undefined {
  return node.marks?.find((m) => m.type === 'link')?.attrs?.href as string | undefined
}

function dataUriToBytes(dataUri: string): Uint8Array | null {
  const comma = dataUri.indexOf(',')
  if (comma < 0) return null
  const meta = dataUri.slice(0, comma)
  if (!meta.includes('base64')) return null
  try {
    const bin = atob(dataUri.slice(comma + 1))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

function imageType(src: string): 'png' | 'jpg' | 'gif' | 'bmp' {
  if (/^data:image\/jpeg/i.test(src) || /\.jpe?g([?#]|$)/i.test(src)) return 'jpg'
  if (/^data:image\/gif/i.test(src)) return 'gif'
  if (/^data:image\/bmp/i.test(src)) return 'bmp'
  return 'png'
}

interface Inherited {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  mono?: boolean
}

// 当前批注区间状态：cur 为段落内正在打开的 cid，used 汇总全文出现过的 cid（决定 comments part 收录谁）
interface CommentTrack {
  cur: number | null
  used: Set<number>
  ranges: Set<number>
  skipped: Set<number>
}

function commentCidOf(node: PMNode): number | null {
  const raw = node.marks?.find((m) => m.type === 'comment')?.attrs?.cid
  return raw === undefined ? null : Number(raw)
}

function closeComment(out: ParagraphChildLike[], cs: CommentTrack) {
  if (cs.cur === null) return
  // commentReference 必须在 w:r 内（schema），不能像 rangeStart/End 那样裸放段落级
  out.push(new CommentRangeEnd(cs.cur), new TextRun({ children: [new CommentReference(cs.cur)] }))
  cs.cur = null
}

function openComment(out: ParagraphChildLike[], cs: CommentTrack, cid: number) {
  if (cs.cur === cid) return
  closeComment(out, cs)
  // Word 不接受同一 w:id 的多组 commentRange（判定文档损坏）：每个 cid 只在首个出现处写一组区间
  if (!cs.ranges.has(cid)) {
    out.push(new CommentRangeStart(cid))
    cs.ranges.add(cid)
    cs.used.add(cid)
    cs.cur = cid
  } else {
    cs.skipped.add(cid)
  }
}

type ParagraphChildLike =
  | TextRun
  | SymbolRun
  | InsertedTextRun
  | DeletedTextRun
  | ExternalHyperlink
  | CommentRangeStart
  | CommentRangeEnd
  | CommentReference
  | FootnoteReferenceRun
  | EndnoteReferenceRun
  | Bookmark

function markAttr(node: PMNode, mark: string, attr: string): string | undefined {
  const m = node.marks?.find((x) => x.type === mark)
  const v = m?.attrs?.[attr]
  return typeof v === 'string' ? v : undefined
}

/** 段内一个孩子 → 它的 run 们（书签分组在外层 inlineToChildren 做，这里只管格式） */
function childToRuns(child: PMNode, inherited: Inherited, cs?: CommentTrack, dt?: DocTrack): ParagraphChildLike[] {
  const out: ParagraphChildLike[] = []
  if (child.type === 'text') {
    if (cs) {
      const cid = commentCidOf(child)
      if (cid === null) closeComment(out, cs)
      else openComment(out, cs, cid)
    }
      const text = textValue(child)
      const bold = inherited.bold || hasMark(child, 'bold')
      const italic = inherited.italic || hasMark(child, 'italic')
      const underline = inherited.underline || hasMark(child, 'underline')
      const strike = inherited.strike || hasMark(child, 'strike')
      const mono = inherited.mono || hasMark(child, 'code')
      const href = linkHref(child)
      // TextStyleKit 后字色/字体/字号统一挂 textStyle mark；历史文档可能残留独立 color mark
      const ts = (attr: string) => markAttr(child, 'textStyle', attr) ?? markAttr(child, 'color', attr)
      const color = ts('color')?.replace('#', '')
      const highlight = markAttr(child, 'highlight', 'color')?.replace('#', '')
      // 字符级命名样式标签（v0.113）：rStyle mark 的 id 写回 w:rStyle
      const rstyle = markAttr(child, 'rStyle', 'id')
      // fontSize 内部存 px（CSS 习惯），docx 字号是半点：pt = px×0.75，half-points = pt×2
      const fsPx = parseInt(ts('fontSize') ?? '', 10)
      // 字符间距：模型那一头存规范化 pt 串，这一层吃缇（1pt = 20 缇）。
      // 0 落不下，两条路都量过：库的门是 `if (options.characterSpacing)` 真值闸，数字 0 整枚不写；
      // 字符串绕开门会被 signedTwipsMeasureValue 涂成 w:val="00"，而 Word 16.0 另存时把那枚 00 整枚丢弃
      // （同批夹具里字符串写的 w:val="200" 原样保留），所以 0 这一档只能记账不能上纸。
      const lsTw = letterSpacingToTwips(ts('letterSpacing'))
      // 复杂文字与语言（v0.138）：cs/hint 走库的 font 对象，szCs/lang/pos/kern 四枚在库里
      // 实现着但类型面没暴露，由 withCharExtra 按库外槽并进去（见 lib/char-extra.ts 头注）
      const cx = (a: string) => markAttr(child, 'charExtra', a)
      const csFont = cx('cs')
      const hintVal = cx('hint')
      const baseFont = docFont(ts('fontFamily')) ?? (mono ? 'Consolas' : undefined)
      const font = csFont || hintVal ? fontWithCsHint(baseFont, csFont, hintVal) : baseFont
      // 下划线（v0.156 线型/色，v0.159 主题三枚）：包只有 {type,color} 两枚原生槽，
      // 主题三枚登记进 dt.uThemes 等打包后补。**每个发出 w:u 的 run 都要登记一格**
      // （无主题时是空串）——补丁按 `<w:u>` 出现序对位，靠条数闸门兜底
      const uLoad = underlineOf(child, underline)
      if (uLoad.value) dt?.uThemes.push(uLoad.theme)
      // 文字色的主题三枚（v0.160）：登记规则与 w:u 同款——**每个会发出 w:color 的 run
      // 都要占一格**（无主题时是空串），补丁按元素出现序对位、靠条数闸门兜底。
      // 只在真有 color 时登记：包发 w:color 的前提就是我们传了 color，两者必须一一对应。
      // 有主题却没有字面色（源件只写 themeColor）时无处附着——那笔账如实挂在
      // 「字面色与主题三枚一起丢」上，不去动闸门
      const ctheme = cx('ctheme')
      if (color) {
        // v0.184：载荷扩成 5 格 ref;tint;shade;lit;base。lit 是源件 w:val 原值，
        // base 是导入那一刻的屏上解析色；只有屏上色没被用户改过才回填旧字面值。
        const [thc = '', tht = '', ths = '', lit = '', base = ''] = (ctheme ?? '').split(';')
        dt?.colorThemes.push(themeAttrs(thc, tht, ths))
        const stillOriginal = !!lit && (!base || color.toLowerCase() === base.toLowerCase())
        dt?.colorLits.push(stillOriginal ? ` w:val="${xmlAttr(lit)}"` : '')
      }
      const runOpts = {
        text,
        bold,
        italics: italic,
        strike,
        font,
        ...(Number.isFinite(fsPx) && fsPx > 0 ? { size: Math.round(fsPx * 1.5) } : {}),
        ...(lsTw !== null && lsTw !== 0 ? { characterSpacing: lsTw } : {}),
        ...(color ? { color } : {}),
        ...(highlight ? { shading: { type: 'clear' as const, fill: highlight } } : {}),
        // v0.156：线型与颜色一起走 data-u 载荷（此前只有「有下划线」这一比特上纸）；
        // v0.159：主题三枚已在上面登记进 dt.uThemes，这里只落原生槽
        ...(uLoad.value ? { underline: uLoad.value } : {}),
        ...(rstyle ? { style: rstyle } : {}),
        ...vertAlignOf(child),
      }
      // 符号（v0.159）：data-sym 载荷 `char;font` → 包的原生 SymbolRun（发 <w:sym>）。
      // 只在「一个 run 一个字符」时发——载荷只能表达一枚码点，多字符会丢字；char 与
      // font 缺一也不发（SymbolRun 的 symbolfont 缺省是 Wingdings，猜一个字体比写错更坏）。
      // 带超链接或修订壳的符号不走这里（那两支的 children 类型不收 SymbolRun，且罕见），
      // 退化为普通文字：字还在，w:sym 这枚元素丢——如实记在这条边界上
      const symLoad = cx('sym')
      const revShell = dt && (hasMark(child, 'revDel') || hasMark(child, 'revIns'))
      if (symLoad && !href && !revShell) {
        const [symChar = '', symFont = ''] = symLoad.split(';')
        if (symChar && symFont && [...text].length === 1) {
          // w:sym 自带字体，rFonts 在这里没有意义（run 里没有普通文字），剥掉更干净
          const { font: _f, text: _t, ...rest } = runOpts
          out.push(
            new SymbolRun({
              char: symChar.toUpperCase(),
              symbolfont: symFont,
              ...(withCharExtra(rest, child, dt) as Record<string, unknown>),
            }),
          )
          return out
        }
      }
      if (href) {
        // 超链接里的文字不包修订壳（docx 库的链接子元素类型不收 Inserted/DeletedTextRun）：
        // 链接文字带修订是罕见写法，内容保住、标记丢失，这层边界在 README 里如实记着
        out.push(
          new ExternalHyperlink({
            link: href,
            children: [new TextRun(withCharExtra({ ...runOpts, style: 'Hyperlink' }, child, dt))],
          }),
        )
      } else if (dt && (hasMark(child, 'revDel') || hasMark(child, 'revIns'))) {
        // 修订壳（v0.100）：del 优先于 ins（一个文字段同时挂两种修订是病态件，删除裁决更保守）。
        // 作者/日期从标记属性原样带走；本应用里没有修订模式，读进来的件一定带着署名，
        // 兜底值只为手造文档不炸。DeletedTextRun 会把 w:t 自动写成 w:delText
        const isDel = hasMark(child, 'revDel')
        const markName = isDel ? 'revDel' : 'revIns'
        const author = markAttr(child, markName, 'author') || '未知'
        const date = markAttr(child, markName, 'date') || new Date().toISOString()
        const revOpts = { ...runOpts, id: dt.revId++, author, date }
        out.push(isDel ? new DeletedTextRun(withCharExtra(revOpts, child, dt)) : new InsertedTextRun(withCharExtra(revOpts, child, dt)))
      } else {
        out.push(new TextRun(withCharExtra(runOpts, child, dt)))
      }
    } else if (child.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }))
    } else if (child.type === 'image') {
      const run = imageRunOf(child, dt)
      if (run) out.push(run)
    } else if (child.type === 'note') {
      const kind: NoteKind = child.attrs?.kind === 'endnote' ? 'endnote' : 'footnote'
      const text = typeof child.attrs?.text === 'string' ? child.attrs.text : ''
      if (dt) {
        // 序号在遍历时现编：Word 与我们的屏幕/面板都按文档顺序自动编号，文件里没有第二个编号字段
        dt.seq[kind] += 1
        dt.notes[kind].set(dt.seq[kind], text)
        out.push(kind === 'endnote' ? new EndnoteReferenceRun(dt.seq[kind]) : new FootnoteReferenceRun(dt.seq[kind]))
      } else {
        out.push(new TextRun({ text: `[${kind === 'endnote' ? '尾注' : '脚注'}: ${text}]`, italics: true }))
      }
    } else {
      out.push(...inlineToChildren(child, inherited, cs, dt))
    }
  return out
}

/**
 * 行内内容 → 段落孩子（v0.146 起重排为先转后组：书签区间在段内按名字分组）。
 * 书签（w:bookmarkStart/End）在 PM 里是文字上的 mark，而 docx 要的是包住一串孩子的
 * Bookmark 组件。mark 模型不记区间端点，这里按「同名 mark 的首个孩子到最后一个孩子」
 * 切一段，中间无标记的内容（硬换行等）算在区间里——往返能保住名字与覆盖范围这两个
 * 事实。同段同名两组（病态件）会并成一组；w:id 由 docx 库自动重排（Word 自己复制
 * 书签时也重排）
 */
/**
 * 图片节点 → 一枚 TextRun（内含 ImageRun）。行内与**块级**两个调用点共用（v0.157）。
 *
 * 为什么提出来：schema 里 Image 是 **block** 节点（`@tiptap/extension-image` 的 `inline`
 * 缺省 false），读手又把 `<img>` 发在块层——于是真实链路里每张图都成了顶层节点，走的是
 * blocksOf 末尾那条兜底 `para(node, …)`，而 image 节点没有 content，整张图就被写成了一枚
 * 空段落：屏上看得见，另存一次就没了。此前只有行内那一支，逐族探针又都是按行内构造的 PM，
 * 两头对着演，谁也没碰到真实的形状。往返账第一次跑就撞上了：PM 里 5 张图，写出包 0 个
 * `w:drawing`。
 */
/** 位置基准：载荷里存的是源件的 relativeFrom 字面，认不出的落回 page（不猜别的档） */
function relFrom<T extends Record<string, string>>(table: T, raw: string | undefined, fallback: T[keyof T]): T[keyof T] {
  return (Object.values(table).find((v) => v === raw) as T[keyof T] | undefined) ?? fallback
}

function imageRunOf(child: PMNode, dt?: DocTrack): TextRun | null {
  const src = (child.attrs?.src as string) ?? ''
  const bytes = src.startsWith('data:') ? dataUriToBytes(src) : null
  if (!bytes) return src ? new TextRun({ text: `[图片: ${src}]`, italics: true }) : null
  // 替代文本（v0.145）：PM 的 alt 属性 → ImageRun 的 altText.description（docx 包
  // DocPropertiesOptions 原生槽）。读手那一侧 alt 以 docPr/cNvPr 的 descr 优先、
  // name 兜底（见 docx-fidelity 的 bitmap）；name 本身不进模型，对象名丢了无害
  const alt = typeof child.attrs?.alt === 'string' ? child.attrs.alt : ''
  // 容器壳（v0.148）：一枚 ImageRun 正对一个 `<w:drawing>`，登记顺序即出现序。
  // 只有真发得出位图的这一支才登记（另一支退化成 `[图片: src]` 字面，没有壳）
  const shell = typeof child.attrs?.img === 'string' ? child.attrs.img : ''
  dt?.imgExtras.push(shell)
  // v0.177：源件是浮动图（wp:anchor）时给 ImageRun 传 floating——包有原生槽
  // （翻 .d.ts 的 CoreImageOptions 才发现，此前注释一直写「包没有 wp:anchor 的槽」）。
  // 传了它包才发 <wp:anchor> 而不是 <wp:inline>；十枚 anchor 属性的**原值**
  // 仍由 patchImgXml 按载荷回填（包发出的是默认值/退化值，不能当源件说过的话）。
  const kv = parseImgPayload(shell)
  const floating = kv.anKind === 'anchor'
    ? {
        horizontalPosition: {
          relative: relFrom(HorizontalPositionRelativeFrom, kv.posH, HorizontalPositionRelativeFrom.PAGE),
          offset: 0,
        },
        verticalPosition: {
          relative: relFrom(VerticalPositionRelativeFrom, kv.posV, VerticalPositionRelativeFrom.PAGE),
          offset: 0,
        },
        allowOverlap: kv.anOver === '1',
        behindDocument: kv.anBehind === '1',
        lockAnchor: kv.anLocked === '1',
        layoutInCell: kv.anCell === '1',
        ...(kv.anRelH !== undefined && Number.isFinite(Number(kv.anRelH)) ? { zIndex: Number(kv.anRelH) } : {}),
        margins: {
          top: Number(kv.distT) || 0,
          bottom: Number(kv.distB) || 0,
          left: Number(kv.distL) || 0,
          right: Number(kv.distR) || 0,
        },
      }
    : undefined
  // v0.179：a:ln 描边线。翻 .d.ts 的 CoreImageOptions 才发现 outline 是原生槽
  // （读手注释一直写「包发不出 a:ln」）。只在源件说过线宽时传一枚最小壳——
  // 包的 ShapeProperties 见到 outline 才 push <a:ln>；cap/cmpd 的枚举键是
  // 'FLAT'/'SINGLE' 而源件字面是 'flat'/'sng'，直接传给包会写错值，所以这里
  // 只负责发壳，三枚属性一律由 patchImgXml 按载荷原值回填（与 v0.178 同款）
  const outline = kv.lnW !== undefined
    ? { type: 'noFill' as const, width: Number(kv.lnW) || 0 }
    : undefined
  return new TextRun({
    children: [
      new ImageRun({
        type: imageType(src),
        data: bytes,
        transformation: {
          width: Number(child.attrs?.width) || 320,
          height: Number(child.attrs?.height) || 240,
        },
        ...(alt ? { altText: { name: alt, description: alt } } : {}),
        ...(floating ? { floating } : {}),
        ...(outline ? { outline } : {}),
      }),
    ],
  })
}

function inlineToChildren(node: PMNode, inherited: Inherited = {}, cs?: CommentTrack, dt?: DocTrack): ParagraphChildLike[] {
  const kids = node.content ?? []
  const spanStart = new Map<number, { name: string; last: number }>()
  const open = new Map<string, [number, number]>()
  kids.forEach((c, i) => {
    if (c.type !== 'text') return
    const nm = markAttr(c, 'bookmark', 'name')
    if (!nm) return
    const cur = open.get(nm)
    if (cur) cur[1] = i
    else open.set(nm, [i, i])
  })
  for (const [name, [first, last]] of open) spanStart.set(first, { name, last })
  const out: ParagraphChildLike[] = []
  for (let i = 0; i < kids.length; i++) {
    const sp = spanStart.get(i)
    if (sp) {
      const inner = kids.slice(i, sp.last + 1).flatMap((c) => childToRuns(c, inherited, cs, dt))
      out.push(new Bookmark({ id: sp.name, children: inner }))
      i = sp.last
      continue
    }
    out.push(...childToRuns(kids[i], inherited, cs, dt))
  }
  return out
}

// 每个 cid 全局只写一组区间（Word 对同 id 多组 commentRange 判定文档损坏）；块间独立开闭
function inlineBlockChildren(node: PMNode, dt: DocTrack): ParagraphChildLike[] {
  const cs: CommentTrack = { cur: null, used: dt.used, ranges: dt.ranges, skipped: dt.skipped }
  const arr = inlineToChildren(node, {}, cs, dt)
  closeComment(arr, cs)
  return arr
}

function alignOf(node: PMNode): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (node.attrs?.textAlign) {
    case 'center':
      return AlignmentType.CENTER
    case 'right':
      return AlignmentType.RIGHT
    case 'justify':
      return AlignmentType.JUSTIFIED
    default:
      return undefined
  }
}

const PX_TWIP = 15

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : 0
}

/** 缩进属性 → w:ind：左缩进 w:left，正的首行进 firstLine、负的进 hanging */
function indentOf(node: PMNode, baseLeftTwip = 0) {
  const left = baseLeftTwip + Math.max(0, num(node.attrs?.indentLeft)) * PX_TWIP
  const right = Math.max(0, num(node.attrs?.indentRight)) * PX_TWIP
  const first = num(node.attrs?.indentFirst) * PX_TWIP
  const o: { left?: number; right?: number; firstLine?: number; hanging?: number } = {}
  if (left) o.left = Math.round(left)
  if (right) o.right = Math.round(right)
  if (first > 0) o.firstLine = Math.round(first)
  else if (first < 0) o.hanging = Math.round(-first)
  return Object.keys(o).length ? o : undefined
}

/** 数值属性 → px；null/NaN 算「没声明」。**不能走 num()**：它把 null 折成 0，而段后距 0 是真值 */
function ownedPx(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** 段落上挂的命名样式标签（w:styleId，v0.102）；没有或空串都不写 */
function pstyleOf(node: PMNode): string | undefined {
  const v = node.attrs?.pStyle
  return typeof v === 'string' && v ? v : undefined
}

/** CSS 对齐词 → OOXML（导入侧已归一到这几个词） */
const STYLE_ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

/**
 * docx 库 DefaultStylesFactory 每次构造都会生成这批定义并与外部样式合并：同 id 再写一枚
 * 会出两个 w:style 节点（Word 行为未定义），这些 id 的快照不落样式表——库内置定义的语义
 * （标题层级等）与原文档一致，够用。注意 Normal 不在库内置清单里，它的定义照写。
 * 原文档里对这些内置样式的定制（比如改过 Heading1 的字号）会丢，如实挂账。
 */
export const BUILTIN_STYLE_IDS = /^(Heading[1-6]|Title|Strong|ListParagraph|FootnoteText|EndnoteText|Hyperlink)$/i

/**
 * 样式快照 → 样式表定义（v0.102）。run/paragraph 写的是沿 basedOn 链摊平后的全量值
 * （basedOn 照抄原链，值重复无害），Word 打开的渲染结果正确；代价是样式面板里每层
 * 都看着是全量格式，父样式一改子样式不跟——摊平架构下这是诚实的选择，样式表的
 * 逐条保真不是这一轮的目标。
 */
function styleDefOf(info: DocxStyleInfo): IParagraphStyleOptions | ICharacterStyleOptions | undefined {
  if (BUILTIN_STYLE_IDS.test(info.id)) return undefined
  const r = info.run
  const run: IRunStylePropertiesOptions = {
    ...(r.font ? { font: docFont(r.font) } : {}),
    // px → 半点（1px = 0.75pt = 1.5 半点）；快照生成时已按同样精度取整，这里能精确往返
    ...(r.sizePx !== undefined ? { size: Math.round(r.sizePx * 1.5) } : {}),
    ...(r.bold ? { bold: true } : {}),
    ...(r.italic ? { italics: true } : {}),
    ...(r.underline ? { underline: {} } : {}),
    ...(r.strike ? { strike: true } : {}),
    ...(r.color ? { color: r.color.replace('#', '').toUpperCase() } : {}),
  }
  // 字符样式（v0.113）：只有 run 层，没有段落排版属性可言
  if (info.kind === 'character') {
    return {
      id: info.id,
      name: info.name,
      ...(info.basedOn ? { basedOn: info.basedOn } : {}),
      // 样式元数据（v0.146）：link/uiPriority 是包的原生槽（实测发射 w:link/w:uiPriority）；
      // customStyle 包丢（StyleForParagraph 只把 type/styleId 交给 StyleAttributes），
      // 由 patchStylesXml 补在开标签上
      ...(info.link ? { link: info.link } : {}),
      ...(info.uiPriority !== undefined ? { uiPriority: info.uiPriority } : {}),
      run,
    }
  }
  const p = info.para
  const spacing = spacingVals(p.lineHeight ?? null, p.lineRule ?? null, p.spaceBeforePx, p.spaceAfterPx)
  const indent =
    p.marginLeftPx !== undefined || p.marginRightPx !== undefined || p.textIndentPx !== undefined
      ? {
          ...(p.marginLeftPx !== undefined ? { left: Math.round(p.marginLeftPx * PX_TWIP) } : {}),
          ...(p.marginRightPx !== undefined ? { right: Math.round(p.marginRightPx * PX_TWIP) } : {}),
          // 负缩进读侧记成 hanging 的语义，回程按 firstLine 负值走（docx 库没有 firstLine 负值形态，
          // w:ind 的 firstLine 本就允许负值，Word 读作 hanging）
          ...(p.textIndentPx !== undefined ? { firstLine: Math.round(p.textIndentPx * PX_TWIP) } : {}),
        }
      : undefined
  const paragraph: ILevelParagraphStylePropertiesOptions = {
    ...(p.align && STYLE_ALIGN[p.align] ? { alignment: STYLE_ALIGN[p.align] } : {}),
    ...(spacing ? { spacing } : {}),
    ...(indent ? { indent } : {}),
    ...(p.outlineLevel !== undefined ? { outlineLevel: Math.max(0, Math.min(8, p.outlineLevel)) } : {}),
  }
  return {
    id: info.id,
    name: info.name,
    ...(info.basedOn ? { basedOn: info.basedOn } : {}),
    ...(info.link ? { link: info.link } : {}),
    ...(info.uiPriority !== undefined ? { uiPriority: info.uiPriority } : {}),
    run,
    paragraph,
  }
}

/** meta 里带的样式清单 → Document 的样式表参数；一条都落不下时整条不给（不给库就走默认样式表） */
function paragraphStylesOf(meta: DocMeta | undefined): { paragraphStyles: readonly IParagraphStyleOptions[] } | {} {
  const defs = (meta?.styles ?? [])
    .filter((s) => s.kind !== 'character' && s.kind !== 'table')
    .map(styleDefOf)
    .filter((d): d is IParagraphStyleOptions => !!d)
  return defs.length ? { paragraphStyles: defs } : {}
}

/** 字符样式（v0.113）→ styles.characterStyles：与段落样式同库、同 id 命名空间，分开两桶装 */
function characterStylesOf(meta: DocMeta | undefined): { characterStyles: readonly ICharacterStyleOptions[] } | {} {
  const defs = (meta?.styles ?? [])
    .filter((s) => s.kind === 'character')
    .map(styleDefOf)
    .filter((d): d is ICharacterStyleOptions => !!d)
  return defs.length ? { characterStyles: defs } : {}
}

/** XML 属性值转义：样式名是用户能改的自由文本，引号与 & 必须先处理 */
function xmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 规范边框串 → `w:tblBorders` 一条边的 XML；没给值（或读不懂）返回空 */
function tblBorderXml(tag: string, v: string | undefined): string {
  const b = cellBorder(v)
  if (!b) return ''
  const color = b.color ?? 'auto'
  return `<w:${tag} w:val="${b.style}" w:sz="${b.size ?? 0}" w:space="0" w:color="${color.toUpperCase()}"/>`
}

/** 一个方向的格边距（px → twips）；0 是真值（`w:w="0"` 就是 Word 自己写的) */
function tblMarXml(tag: string, px: number | undefined): string {
  if (typeof px !== 'number' || !Number.isFinite(px) || px < 0) return ''
  return `<w:${tag} w:w="${Math.round(px * PX_TWIP)}" w:type="dxa"/>`
}

/** 条件格边框 → `w:tcBorders`：四条边各调一次 `tblBorderXml`（它吃 CSS 边框串），一条都没有就不写 */
function bordersXml(borders: Partial<Record<CellEdge, string>> | undefined): string {
  if (!borders) return ''
  let out = ''
  for (const edge of CELL_EDGES) {
    const v = borders[edge]
    if (v) out += tblBorderXml(edge, v)
  }
  return out ? `<w:tcBorders>${out}</w:tcBorders>` : ''
}

/**
 * 表样式定义（v0.114）→ 一片 `w:style` XML。
 *
 * docx 库的 Document 只认段落与字符两类定义（`IStylesOptions` 里没有 tableStyles 这个槽），
 * 而 `styles.importedStyles` 是它留的那道「原样收一片 XML」的门——表样式走这道门进去，
 * 与 `w:tblStyle` 那一边的**引用**合起来才算完整：这两样缺一样，`word/styles.xml` 里就
 * 只有半套账（要么一张空壳定义没人指，要么一个悬空引用）。节点内部顺序按 CT_Style /
 * CT_TblPrBase 的 schema 排（name → basedOn → rPr → tblPr → tcPr），乱序会被 Word 判损坏件。
 */
function tableStyleXml(s: DocxStyleInfo): string | undefined {
  const t = s.table
  if (!t) return undefined
  // 样式元数据（v0.146）：customStyle 是 w:style 开标签上的属性（onOff），
  // uiPriority/link 是按 CT_Style 序排在 basedOn 之后、rPr 之前的两枚子元素
  let head =
    `<w:style w:type="table"${s.customStyle !== undefined ? ` w:customStyle="${s.customStyle ? '1' : '0'}"` : ''}` +
    ` w:styleId="${xmlAttr(s.id)}"><w:name w:val="${xmlAttr(s.name)}"/>`
  if (s.basedOn) head += `<w:basedOn w:val="${xmlAttr(s.basedOn)}"/>`
  if (s.link) head += `<w:link w:val="${xmlAttr(s.link)}"/>`
  if (s.uiPriority !== undefined) head += `<w:uiPriority w:val="${s.uiPriority}"/>`
  let rPr = ''
  const font = docFont(s.run.font)
  if (font) {
    rPr +=
      typeof font === 'string'
        ? `<w:rFonts w:ascii="${xmlAttr(font)}" w:hAnsi="${xmlAttr(font)}"/>`
        : `<w:rFonts${font.ascii ? ` w:ascii="${xmlAttr(font.ascii)}"` : ''}${
            font.hAnsi ? ` w:hAnsi="${xmlAttr(font.hAnsi)}"` : ''
          }${font.eastAsia ? ` w:eastAsia="${xmlAttr(font.eastAsia)}"` : ''}${
            font.cs ? ` w:cs="${xmlAttr(font.cs)}"` : ''
          }${font.hint ? ` w:hint="${xmlAttr(font.hint)}"` : ''}/>`
  }
  if (s.run.bold) rPr += '<w:b/>'
  if (s.run.italic) rPr += '<w:i/>'
  if (s.run.strike) rPr += '<w:strike/>'
  if (s.run.color) rPr += `<w:color w:val="${s.run.color.replace('#', '').toUpperCase()}"/>`
  if (s.run.sizePx !== undefined) rPr += `<w:sz w:val="${Math.max(1, Math.round(s.run.sizePx * 1.5))}"/>`
  if (s.run.underline) rPr += '<w:u w:val="single"/>'
  if (rPr) head += `<w:rPr>${rPr}</w:rPr>`
  const borders =
    tblBorderXml('top', t.bdTop) +
    tblBorderXml('left', t.bdLeft) +
    tblBorderXml('bottom', t.bdBottom) +
    tblBorderXml('right', t.bdRight) +
    tblBorderXml('insideH', t.bdInsideH) +
    tblBorderXml('insideV', t.bdInsideV)
  const mar =
    tblMarXml('top', t.padTopPx) +
    tblMarXml('left', t.padLeftPx) +
    tblMarXml('bottom', t.padBottomPx) +
    tblMarXml('right', t.padRightPx)
  let tblPr = ''
  if (t.align && STYLE_ALIGN[t.align]) {
    const word = t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : 'left'
    tblPr += `<w:jc w:val="${word}"/>`
  }
  if (borders) tblPr += `<w:tblBorders>${borders}</w:tblBorders>`
  if (mar) tblPr += `<w:tblCellMar>${mar}</w:tblCellMar>`
  if (tblPr) head += `<w:tblPr>${tblPr}</w:tblPr>`
  if (t.background) {
    head += `<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${t.background.replace('#', '').toUpperCase()}"/></w:tcPr>`
  }
  // 条件层（v0.116）：整串挂在最后——CT_Style 里 tblStylePr 是最后一枚孩子，
  // 每枚内部按 CT_TblStylePr 的序走 rPr → tblPr → trPr → tcPr（乱序会被 Word 判损坏件）
  for (const type of TABLE_COND_TYPES) {
    const c = t.cond?.[type]
    if (!c) continue
    // CT_TcMarInner 与 CT_TcPrInner 的序：边距四边按 top → left → bottom → right，
    // 而在 tcPr 里 `w:tcBorders` 在 `w:shd` 之后、`w:tcMar` 之前
    const tcMar =
      tblMarXml('top', c.padTopPx) +
      tblMarXml('left', c.padLeftPx) +
      tblMarXml('bottom', c.padBottomPx) +
      tblMarXml('right', c.padRightPx)
    // 条件格边框（v0.117）：`w:tcBorders` 住 `w:tcPr` 内
    const tcBorders = bordersXml(c.borders)
    const tcPrInner =
      (c.background
        ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.background.replace('#', '').toUpperCase()}"/>`
        : '') +
      tcBorders +
      (tcMar ? `<w:tcMar>${tcMar}</w:tcMar>` : '')
    const tcPr = tcPrInner ? `<w:tcPr>${tcPrInner}</w:tcPr>` : ''
    // 条件行高（v0.117）：`w:trPr` 在 CT_TblStylePr 的序里排在 `w:tcPr` 之前；
    // 仅行型条件（firstRow/lastRow/band*Horz）对 Word 有意义，列型/角型写了也会被忽略
    const trPr =
      c.rowHeightPx && c.rowHeightPx > 0
        ? `<w:trPr><w:trHeight w:val="${Math.max(1, Math.round(c.rowHeightPx * PX_TWIP))}" w:hRule="${
            c.rowHeightExact ? 'exact' : 'atLeast'
          }"/></w:trPr>`
        : ''
    const inner = (c.bold ? '<w:rPr><w:b/></w:rPr>' : '') + trPr + tcPr
    if (inner) head += `<w:tblStylePr w:type="${type}">${inner}</w:tblStylePr>`
  }
  return head + '</w:style>'
}

/** meta 里的表样式 → Document 的 importedStyles；一条都没有时不给这个槽 */
function tableStylesOf(meta: DocMeta | undefined): { importedStyles: ImportedXmlComponent[] } | {} {
  const xmls = (meta?.styles ?? [])
    .filter((s) => s.kind === 'table' && !BUILTIN_STYLE_IDS.test(s.id))
    .map(tableStyleXml)
    .filter((x): x is string => !!x)
  return xmls.length ? { importedStyles: xmls.map(importedStyleComponent) } : {}
}

/**
 * docx 这版的 `ImportedXmlComponent.fromXmlString` 有 bug：它把整段 XML 经 xml-js 解析后，
 * 顶层对象（没有 `type` 字段）被当成根，于是我们写的 `<w:style>` 落进一个名字为 `undefined`
 * 的外层元素里——Word 不认、回读也丢。这里直接拿 xml-js 的根元素（elements[0]）建组件树，
 * 绕开那个包裹，让 `<w:style>` 成为 `<w:styles>` 的直接子节点。
 */
function importedStyleComponent(xml: string): ImportedXmlComponent {
  const json = xml2js(xml, { compact: false }) as { elements?: XmlNode[] } | undefined
  const root = json?.elements?.[0]
  return (root ? buildImported(root) : new ImportedXmlComponent('w:style', {})) as ImportedXmlComponent
}
interface XmlNode {
  type?: string
  name?: string
  attributes?: Record<string, string>
  elements?: XmlNode[]
  text?: string
}
function buildImported(el: XmlNode): ImportedXmlComponent | string | undefined {
  if (el.type === 'text') return el.text
  if (el.type === 'element' && el.name) {
    const c = new ImportedXmlComponent(el.name, el.attributes ?? {})
    for (const child of el.elements ?? []) {
      const cc = buildImported(child)
      if (cc !== undefined) c.push(cc)
    }
    return c
  }
  return undefined
}

/**
 * 段落直接格式 → `w:spacing`（行距 + 段前段后）。
 * 只写用户声明过的那几项：整篇的默认行距段距归 Word 的 Normal 样式管，
 * 替每一段补一份默认值会把「没声明」这个信息擦掉（导出再开就长出一屏假的段后距）。
 * 显式的 0 是真值要照写——Word 就用 `w:after="0"` 压掉样式里那段间距。
 * 样式表定义（DocxStyleInfo 快照）与段落直接格式共用这一套换算。
 */
function spacingVals(
  lineHeight: number | null,
  lineRule: LineRule | null,
  beforePx: number | undefined,
  afterPx: number | undefined,
): ISpacingProperties | undefined {
  const o: {
    line?: number
    lineRule?: ISpacingProperties['lineRule']
    before?: number
    after?: number
  } = {}
  const ln = lineToOoxml(lineHeight, lineRule, (px) => px * PX_TWIP)
  if (ln) {
    o.line = ln.line
    o.lineRule = ln.lineRule === 'atLeast' ? LineRuleType.AT_LEAST : ln.lineRule === 'exact' ? LineRuleType.EXACT : LineRuleType.AUTO
  }
  // 显式的 0 是真值要照写——Word 就用 `w:after="0"` 压掉样式里那段间距
  if (beforePx !== undefined) o.before = Math.round(beforePx * PX_TWIP)
  if (afterPx !== undefined) o.after = Math.round(afterPx * PX_TWIP)
  return Object.keys(o).length ? o : undefined
}

function spacingOf(node: PMNode): ISpacingProperties | undefined {
  const base = spacingVals(
    ownedPx(node.attrs?.lineHeight) ?? null,
    (typeof node.attrs?.lineRule === 'string' ? node.attrs.lineRule : null) as LineRule | null,
    ownedPx(node.attrs?.spaceBefore),
    ownedPx(node.attrs?.spaceAfter),
  )
  // 两枚「自动段距」（v0.147）：w:spacing/@w:beforeAutospacing 与 @w:afterAutospacing，
  // 随 data-ppr 载荷来回。包里是布尔槽而 OOXML 是 onOff——包写出的字面是 "true"/"false"
  // （xsd:boolean 的两种写法都在 ST_OnOff 的值域里，Word 认），语义等价但字面不必同源
  const ppr = parsePprPayload(typeof node.attrs?.ppr === 'string' ? node.attrs.ppr : null)
  const flag = (k: string): boolean | undefined => (ppr[k] === '1' ? true : ppr[k] === '0' ? false : undefined)
  const beforeAuto = flag('beforeAutoSpace')
  const afterAuto = flag('afterAutoSpace')
  if (!base && beforeAuto === undefined && afterAuto === undefined) return undefined
  return {
    ...(base ?? {}),
    ...(beforeAuto !== undefined ? { beforeAutoSpacing: beforeAuto } : {}),
    ...(afterAuto !== undefined ? { afterAutoSpacing: afterAuto } : {}),
  }
}

/** 段落的直接格式（命名样式 / 行距段距 / 底纹 / 四边）一次拼好，供 new Paragraph 的参数展开。
 *  pstyle 由调用方决定给不给：heading 的样式标签由 HeadingLevel 承担（库会给 heading 和 style
 *  各写一枚 w:pStyle，并存会出两枚）；bullet 项库无条件补 ListParagraph 标签，同样不能并存 */
function paraFormatOf(node: PMNode, pstyle?: string | null, dt?: DocTrack) {
  const sp = spacingOf(node)
  const sh = shadingOf(node.attrs)
  // 底纹的存盘原件（v0.164）：**只在真发得出 `<w:shd>` 时登记**——补丁按出现序对位，
  // 多登记一条就把后面所有段落的那一枚都贴偏（少登记同样错位）
  if (sh) dt?.shdExtras.push(shdExtraOf(node.attrs))
  // 第一段那种「between 落成下边框」的情形：下边框不发，改发 `<w:between>`
  const bd = bordersOf(node.attrs, betweenAsBottom(node.attrs))
  // 边框的存盘原件（v0.165）：同一条纪律——发不出 `<w:pBdr>` 就不登记
  if (bd) dt?.paraBdrs.push(bdrExtraOf(node.attrs))
  // 分页四件套（v0.143）：data-* 三态 → docx 包原生槽。'0' 显式传 false
  // （widowControl 的「关」是真值），null 不传（落回 Word 默认的开）
  const flag = (a: string): boolean | undefined => {
    const v = node.attrs?.[a]
    return v === '1' ? true : v === '0' ? false : undefined
  }
  const keepNext = flag('keepNext')
  const keepLines = flag('keepLines')
  const pageBreakBefore = flag('pageBreakBefore')
  const widowControl = flag('widowControl')
  // 制表位表（v0.144）：data-tabs 载荷 → tabStops。type/position/leader 直接透传
  // （包的 createTabStopItem 不做单位换算，position 即缇）；leader 的 heavy 档在包的
  // LeaderType 里没有——库外槽照样落成 w:leader="heavy"，TS 那侧断言绕过
  const tabs = tabsOf(node.attrs?.tabs)
  // 浮动框架（v0.145）：data-frame 载荷 → 包 frame 槽。xAlign/yAlign 优先（alignment
  // 形态）、否则 absolute——Word 语义里 x 与 xAlign 互斥，同存是脏数据（alignment 优先
  // 时 x/y 被弃，Word 自己也是这个取舍）；width/height/anchor 包里是必填，源文件缺
  // w/h 时给 0（Word 对 0 宽框架的解释是自动宽，与「没写」不等但比丢整条框架好）
  const frame = frameOf(node.attrs?.frame)
  return {
    ...(pstyle ? { style: pstyle } : {}),
    ...(sp ? { spacing: sp } : {}),
    ...(sh ? { shading: sh } : {}),
    ...(bd ? { border: bd } : {}),
    ...(tabs ? { tabStops: tabs } : {}),
    ...(frame ? { frame } : {}),
    ...(keepNext !== undefined ? { keepNext } : {}),
    ...(keepLines !== undefined ? { keepLines } : {}),
    ...(pageBreakBefore !== undefined ? { pageBreakBefore } : {}),
    ...(widowControl !== undefined ? { widowControl } : {}),
  }
}

/** data-frame 载荷 → docx 包 frame 选项（IFrameOptions 两形态）；无有效键返回 undefined */
function frameOf(raw: unknown): IFrameOptions | undefined {
  const kv = parseFramePayload(typeof raw === 'string' ? raw : null)
  const num = (k: string): number | undefined => (kv[k] !== undefined ? Number(kv[k]) : undefined)
  const has = (...ks: string[]) => ks.some((k) => kv[k] !== undefined)
  if (!has('x', 'y', 'xAlign', 'yAlign', 'w', 'h', 'wrap', 'anchorLock', 'hRule', 'hAnchor', 'vAnchor', 'hSpace', 'vSpace')) return undefined
  // 纯 absolute 形态要有 x/y 至少一枚；只有对齐/尺寸而无 x/y 时走 absolute 补 0
  if (kv.x === undefined && kv.y === undefined && !has('xAlign', 'yAlign')) return undefined
  const alignment = has('xAlign', 'yAlign')
  const opts: Record<string, unknown> = alignment
    ? { type: 'alignment', alignment: { x: kv.xAlign ?? 'left', y: kv.yAlign ?? 'top' } }
    : { type: 'absolute', position: { x: num('x') ?? 0, y: num('y') ?? 0 } }
  // 必填槽：包里 width/height/anchor 缺了会写出畸形 framePr，源文件没有就给中性值
  opts.width = num('w') ?? 0
  opts.height = num('h') ?? 0
  opts.anchor = { horizontal: kv.hAnchor ?? 'page', vertical: kv.vAnchor ?? 'text' }
  if (has('hSpace', 'vSpace')) opts.space = { horizontal: num('hSpace') ?? 0, vertical: num('vSpace') ?? 0 }
  if (kv.hRule) opts.rule = kv.hRule
  if (kv.wrap) opts.wrap = kv.wrap
  if (kv.anchorLock !== undefined) opts.anchorLock = kv.anchorLock === '1' || kv.anchorLock === 'true' || kv.anchorLock === 'on'
  if (kv.dropCap) opts.dropCap = kv.dropCap
  if (kv.lines !== undefined) opts.lines = Number(kv.lines)
  // 载荷里的字符串键（xAlign/hAnchor/wrap…）是 OOXML 原值，与包枚举字面一致，直接透传
  return opts as unknown as IFrameOptions
}

/** data-tabs 载荷 → docx 包 TabStopDefinition[]（空数组当没有，不写 w:tabs 元素） */
function tabsOf(raw: unknown): TabStopDefinition[] | undefined {
  const specs = parseTabsPayload(typeof raw === 'string' ? raw : null)
  if (!specs.length) return undefined
  // type/position 直接透传（包的 createTabStopItem 不做单位换算，position 即缇）；
  // leader 的 heavy 档不在包的 LeaderType 里——与 withCharExtra 的库外槽同款断言
  return specs.map((t) => ({
    type: t.val,
    position: t.pos ?? 0,
    ...(t.leader ? { leader: t.leader } : {}),
  })) as unknown as TabStopDefinition[]
}

/**
 * data-tblp 载荷 → docx 包 ITableFloatOptions（v0.145）。键名一一对应：
 * tblpX→absoluteHorizontalPosition、tblpXSpec→relativeHorizontalPosition、
 * horzAnchor→horizontalAnchor、vertAnchor→verticalAnchor（原值透传——包里类型面是
 * TableAnchorType 而 OOXML 值域含 top/bottom/center 等，BuilderElement 不校验）、
 * tblpY→absoluteVerticalPosition、四 FromText 同名、overlap→overlap。
 * 空载荷返回 undefined（不写 w:tblpPr）。
 */
function tblpFloatOf(raw: unknown): ITableFloatOptions | undefined {
  const kv = parseTblpPayload(typeof raw === 'string' ? raw : null)
  if (!Object.keys(kv).length) return undefined
  const n = (k: string): number | undefined => (kv[k] !== undefined ? Number(kv[k]) : undefined)
  const opts: Record<string, unknown> = {}
  if (kv.horzAnchor) opts.horizontalAnchor = kv.horzAnchor
  if (kv.tblpXSpec) opts.relativeHorizontalPosition = kv.tblpXSpec
  if (n('tblpX') !== undefined) opts.absoluteHorizontalPosition = n('tblpX')
  if (kv.vertAnchor) opts.verticalAnchor = kv.vertAnchor
  if (n('tblpY') !== undefined) opts.absoluteVerticalPosition = n('tblpY')
  for (const k of ['topFromText', 'leftFromText', 'bottomFromText', 'rightFromText'] as const) {
    if (n(k) !== undefined) opts[k] = n(k)
  }
  if (kv.overlap) opts.overlap = kv.overlap
  return opts as unknown as ITableFloatOptions
}

/** CSS 线型词 → OOXML 线型（导入时已归一到这几个词） */
const OOXML_BORDER: Record<string, (typeof BorderStyle)[keyof typeof BorderStyle]> = {
  solid: BorderStyle.SINGLE,
  dashed: BorderStyle.DASHED,
  dotted: BorderStyle.DOTTED,
  double: BorderStyle.DOUBLE,
  inset: BorderStyle.INSET,
  outset: BorderStyle.OUTSET,
}

/**
 * 规范边框串 → `w:tcBorders` 的一边。
 * 空值返回 undefined（不写这一边），`'none'` 写 `w:val="nil"`——两者在 Word 里不是一回事：
 * 前者由表级/样式决定，后者是"这一格这条边明确不要"。
 * 实测 Word 会拿 `val="none"` 当"没指定"继续吃表级默认边框（导出再开变成 0.5pt 实线），
 * 只有 `nil` 真把边框压掉，故写 nil。
 */
function cellBorder(v: unknown): IBorderOptions | undefined {
  const s = typeof v === 'string' ? v : ''
  if (!s) return undefined
  if (s === 'none') return { style: BorderStyle.NIL, size: 0 }
  const p = borderParts(s)
  if (!p) return undefined
  return { style: OOXML_BORDER[p.style] ?? BorderStyle.SINGLE, size: pxToEighths(p.px), color: p.hex.slice(1) }
}

/**
 * 边框间距（v0.143）：`w:space`（磅）。段落侧住 pad*（pBdr 是段落的唯一来源），
 * 单元格侧住 bdSpace*（tcMar 与 tcBorders@space 在 Word 里叠加，回写要各走各的）——
 * 两种来源不会同节点并存（段落没有 tcMar、单元格的 pad 归 tcMar），取到即用。
 */
/**
 * 「这一段的下边框其实是 between 的替身」（v0.167）。
 *
 * 读手把 `w:between` 画成了本段的下边框（`betweenCss`），于是模型里的 `bdBottom`
 * 多出一条源件根本没有的 `w:bottom`。判据是 payload 的 `screen`：屏上那条下边框的色
 * 与它一致 = 它就是 between 的替身 → 下边框不发、改发 `w:between`；对不上说明用户
 * 换过色，那时 between 作废、下边框照发（用户的改动优先）。
 */
function betweenAsBottom(attrs: Record<string, unknown> | undefined): boolean {
  const p = parsePbdrPayload(typeof attrs?.pbdr === 'string' ? attrs.pbdr : null)
  if (p.hidden === '1') return false
  if (!p.val && !p.color && !p.themeColor) return false
  const cur = borderParts(attrs?.bdBottom as string | undefined)
  return !!cur && cur.hex.replace('#', '').toLowerCase() === (p.screen ?? '').toLowerCase()
}

function borderSpacePt(attrs: Record<string, unknown> | undefined, edge: 'top' | 'right' | 'bottom' | 'left'): number | undefined {
  const pad = attrs?.[`pad${edge[0].toUpperCase()}${edge.slice(1)}`]
  const bd = attrs?.[`bdSpace${edge[0].toUpperCase()}${edge.slice(1)}`]
  const px = typeof bd === 'number' ? bd : typeof pad === 'number' ? pad : undefined
  if (typeof px !== 'number' || !Number.isFinite(px) || px <= 0) return undefined
  return pxToPt(px)
}

/**
 * 四边 → w:tcBorders（表格）或 w:pBdr（段落）；两者同形，一条都没有就不写这个元素。
 * `noBottom` 是段落那一路的第五边让位（见 betweenAsBottom）：那一条下边框的真相是
 * `w:between`，发了 `w:bottom` 就会在 Word 里多画一根线
 */
function bordersOf(attrs: Record<string, unknown> | undefined, noBottom = false) {
  const withSpace = (edge: 'top' | 'right' | 'bottom' | 'left', v: IBorderOptions | undefined) => {
    const sp = borderSpacePt(attrs, edge)
    // 只有真画出了边才带 space——边都没有，间距无处附着
    return v && sp !== undefined ? { ...v, space: sp } : v
  }
  const b = {
    top: withSpace('top', cellBorder(attrs?.bdTop)),
    bottom: noBottom ? undefined : withSpace('bottom', cellBorder(attrs?.bdBottom)),
    left: withSpace('left', cellBorder(attrs?.bdLeft)),
    right: withSpace('right', cellBorder(attrs?.bdRight)),
  }
  return Object.values(b).some(Boolean) ? b : undefined
}

/**
 * 边框的存盘原件（v0.165）：`data-bdr` 载荷 → 每条边要**合并**进 `<w:top>` 的属性串，
 * 段间用 `;` 连、边名与属性串用 `|` 分。空串 = 这一块不补。
 *
 * 判据与 data-shd 的 `bg` 同一条：`screen` 是导入那一刻的屏上色，当前 `bd*` 的色与它
 * 对不上就说明用户在编辑器里改过色——主题引用那时必须让位，否则 Word 按主题解析，
 * 用户换的颜色在屏上、在纸上都看不见。线型与粗细改了不影响颜色，照补。
 */
function padTouched(attrs: Record<string, unknown> | undefined, edge: string): boolean {
  const cap = edge[0].toUpperCase() + edge.slice(1)
  // 段落落在 pad*、逐格落在 bdSpace*（v0.143 的两条通道）
  for (const a of [`pad${cap}`, `bdSpace${cap}`]) {
    const v = attrs?.[a]
    if (typeof v === 'number' && v > 0) return true
  }
  return false
}

function bdrExtraOf(attrs: Record<string, unknown> | undefined): string {
  const out: string[] = []
  for (const o of parseBdrPayload(typeof attrs?.bdr === 'string' ? attrs.bdr : null)) {
    const cur = borderParts(attrs?.[bdAttr(o.edge)] as string | undefined)
    if (!cur || cur.hex.replace('#', '').toLowerCase() !== (o.screen ?? '').toLowerCase()) continue
    const add = [
      o.color ? `w:color="${o.color}"` : '',
      o.themeColor ? `w:themeColor="${o.themeColor}"` : '',
      o.themeTint ? `w:themeTint="${o.themeTint}"` : '',
      o.themeShade ? `w:themeShade="${o.themeShade}"` : '',
      // 显式 `w:space="0"`（v0.168）：包按 padding 发，0 与「没写」在 CSS 里同形，
      // 只有载荷记得住；用户把内边距调大了就以用户为准（见 padTouched）
      o.space === '0' && !padTouched(attrs, o.edge) ? 'w:space="0"' : '',
    ]
      .filter(Boolean)
      .join(' ')
    if (add) out.push(`${o.edge}|${add}`)
  }
  // 第五边（v0.167）与第六条边（v0.168）：与四边同一块、同一个数组——它们都插在
  // `<w:pBdr>` 里，对位靠的就是这一块的出现序
  const bt = betweenExtraOf(attrs)
  if (bt) out.push(`between|${bt}`)
  const bar = barExtraOf(attrs)
  if (bar) out.push(`bar|${bar}`)
  return out.join(';')
}

/**
 * 段落第六条边（v0.168）：`data-pbar` 载荷 → 要写进 `<w:pBdr>` 的属性串。
 * 屏上没有替身、界面上也改不了它——没有判据，有就插一枚。
 */
function barExtraOf(attrs: Record<string, unknown> | undefined): string {
  const p = parsePbdrPayload(typeof attrs?.pbar === 'string' ? attrs.pbar : null)
  if (!p.val && !p.color && !p.themeColor) return ''
  return [
    p.val ? `w:val="${p.val}"` : '',
    p.sz ? `w:sz="${p.sz}"` : '',
    p.space !== undefined ? `w:space="${p.space}"` : '',
    p.color ? `w:color="${p.color}"` : '',
    p.themeColor ? `w:themeColor="${p.themeColor}"` : '',
    p.themeTint ? `w:themeTint="${p.themeTint}"` : '',
    p.themeShade ? `w:themeShade="${p.themeShade}"` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * 表行余量（v0.172）：`data-trpr` 载荷 → 要贴进 `<w:trPr>` 的两枚元素。
 *
 * `w:gridAfter` 与 `w:wAfter` 包都没有槽（`TableRow` 的选项里也没有），只能打包后补。
 * 两枚在 CT_TrPr 的序里排在 `cantSplit`/`trHeight`/`tblHeader` 之前——插错位置 Word 会
 * 判损坏件，所以补丁里按锚点插而不是直接追加。
 */
function trPrExtraOf(attrs: Record<string, unknown> | undefined): string {
  const p = parseTrPrPayload(typeof attrs?.trpr === 'string' ? attrs.trpr : null)
  return (
    (p.gridAfter !== undefined ? `<w:gridAfter w:val="${p.gridAfter}"/>` : '') +
    // w:type 缺省是 dxa；只有 w 给了才发这一枚（w 是必填）
    (p.wAfterW !== undefined ? `<w:wAfter w:w="${p.wAfterW}"${p.wAfterType ? ` w:type="${p.wAfterType}"` : ''}/>` : '')
  )
}

/**
 * 段落第五边（v0.167）：`data-pbdr` 载荷 → 要写进 `<w:pBdr>` 的属性串。
 * 空串 = 这一块不补。
 *
 * 两个方向：
 * - `hidden=1`（本段没轮到画）：屏上没有替身，原样带回；
 * - 画了：屏上的替身是本段的**下边框**。用户改过色、或把下边框删了，between 跟着走
 *   ——删了就一起删，别留一枚屏上不存在的旧线，等哪天去掉下边框它才冒出来。
 */
function betweenExtraOf(attrs: Record<string, unknown> | undefined): string {
  const p = parsePbdrPayload(typeof attrs?.pbdr === 'string' ? attrs.pbdr : null)
  if (!p.val && !p.color && !p.themeColor) return ''
  if (p.hidden !== '1' && !betweenAsBottom(attrs)) return ''
  return [
    p.val ? `w:val="${p.val}"` : '',
    p.sz ? `w:sz="${p.sz}"` : '',
    p.space !== undefined ? `w:space="${p.space}"` : '',
    p.color ? `w:color="${p.color}"` : '',
    p.themeColor ? `w:themeColor="${p.themeColor}"` : '',
    p.themeTint ? `w:themeTint="${p.themeTint}"` : '',
    p.themeShade ? `w:themeShade="${p.themeShade}"` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * 底纹 → w:shd。图案族（data-shade 三件套，v0.142）优先：type 是图案档位、
 * fill 是背景、color 是前景——Word 的图案底纹三件套就是这么分工的；
 * 纯色只有 fill。Word 的 fill/color 都不带 #。
 * 图案名不在规范档位表里（第三方怪件）按纯色写：色不丢、档位丢（读侧 warn 已记）。
 */
function shadingOf(attrs: Record<string, unknown> | undefined) {
  const spec = parseShadePayload(typeof attrs?.shade === 'string' ? attrs.shade : null)
  // 载荷里的档位名是全小写（读侧归一过），docx 包的规范名是驼峰（horzStripe）——过一遍映射
  const canonical = spec ? SHADING_TYPES[spec.pattern] : undefined
  if (spec && canonical) {
    return { type: canonical, fill: spec.bg.replace('#', ''), color: spec.fg.replace('#', '') }
  }
  const hex = typeof attrs?.background === 'string' ? attrs.background : ''
  return hex ? { type: ShadingType.CLEAR, fill: hex.replace('#', '').toLowerCase() } : undefined
}

/** OOXML 图案档位表：小写（读侧载荷的口径）→ docx 包的规范名（horzStripe 这一族是驼峰） */
const SHADING_TYPES: Record<string, (typeof ShadingType)[keyof typeof ShadingType]> = Object.fromEntries(
  (Object.values(ShadingType) as string[]).map((v) => [v.toLowerCase(), v as (typeof ShadingType)[keyof typeof ShadingType]]),
)

/**
 * 底纹的存盘原件（v0.164）：data-shd 载荷 → 要**合进** `<w:shd>` 的属性串。
 * 空串 = 这一枚底纹不补（补丁按出现序对位，空串占位）。
 *
 * 两道闸门：
 * 1. **用户改过底纹色就整笔作废。** 载荷里的 `bg` 是导入那一刻的屏上色；当前
 *    `background` 与它对不上，说明用户在编辑器里换了颜色。主题引用那时必须让位——
 *    否则 Word 按主题解析，用户的改色在屏上、在纸上都看不见。
 * 2. `background` 为空 = 包里根本不会发 `<w:shd>`（`shadingOf` 返回 undefined），
 *    没有开标签可合，补也白补。
 */
function shdExtraOf(attrs: Record<string, unknown> | undefined): string {
  const p = parseShdPayload(typeof attrs?.shd === 'string' ? attrs.shd : null)
  if (!p.themeFill) return ''
  const bg = typeof attrs?.background === 'string' ? attrs.background.replace('#', '').toLowerCase() : ''
  if (!bg) return ''
  if (p.bg && p.bg.toLowerCase() !== bg) return ''
  return (
    (p.fill ? ` w:fill="${xmlAttr(p.fill)}"` : '') +
    ` w:themeFill="${xmlAttr(p.themeFill)}"` +
    (p.themeFillTint ? ` w:themeFillTint="${xmlAttr(p.themeFillTint)}"` : '') +
    (p.themeFillShade ? ` w:themeFillShade="${xmlAttr(p.themeFillShade)}"` : '')
  )
}

/** 上下标：Word 把 vertAlign 记在 rPr，与粗斜体同级，所以是两个互斥的 run 属性 */
function vertAlignOf(node: PMNode): { superScript?: boolean; subScript?: boolean } {
  if (hasMark(node, 'superscript')) return { superScript: true }
  if (hasMark(node, 'subscript')) return { subScript: true }
  return {}
}

/**
 * CSS 字体列表 → docx 分区字体。一个名字直接给整体；两个名字（保真导入的排法是
 * 拉丁名在前、中文字体名在后）必须拆到 ascii/hAnsi 与 eastAsia，否则 Word 里
 * 中文只能落在 eastAsia 上，整串塞进 w:ascii 会让中文用回主题字体。
 */
export function docFont(family: string | undefined): string | IFontAttributesProperties | undefined {
  if (!family) return undefined
  const names = family
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  if (names.length === 0) return undefined
  if (names.length === 1) return names[0]
  const cjk = names.find((n) => /[㐀-鿿぀-ヿ가-힯]/.test(n))
  const latin = names.find((n) => n !== cjk) ?? names[0]
  if (!cjk) return names[0]
  return { ascii: latin, hAnsi: latin, eastAsia: cjk, cs: cjk }
}

/**
 * 把 charExtra mark 带来的 cs / hint 并进字体对象（v0.138）。
 * 显式 cs 压过 docFont 的推测（那个把中文字族当 cs 只是"没别的线索时的默认"）；
 * 单名字体先拆成 ascii/hAnsi 两槽再并——库对字符串只写 ascii/hAnsi，并不上 cs/hint。
 */
function fontWithCsHint(
  base: string | IFontAttributesProperties | undefined,
  cs?: string,
  hint?: string,
): IFontAttributesProperties {
  const merged: IFontAttributesProperties =
    typeof base === 'string' ? { ascii: base, hAnsi: base } : { ...(base ?? {}) }
  // 库的类型是 readonly，按不可变合并重建（显式 cs 压过 docFont 的推测）
  // 导入侧按小写存 hint（'eastasia'），而 ST_Hint 的字面是 eastAsia——写回前归一回位，
  // 免得严格校验的读手（Word 自己）对大小写挑刺
  const canon = hint ? (hint.toLowerCase() === 'eastasia' ? 'eastAsia' : 'default') : undefined
  return { ...merged, ...(cs ? { cs } : {}), ...(canon ? { hint: canon } : {}) }
}

/**
 * charExtra mark 的四枚库外槽（v0.138）：szCs / lang / pos / kern。
 *
 * 它们在 docx 库的 RunProperties 里逐枚实现着（options.sizeComplexScript → w:szCs、
 * options.language → w:lang、options.position → w:position、options.kern → w:kern），
 * 只是 IRunStylePropertiesOptions 的类型面没列这几枚——传进去要靠这一个断言。
 * 判据是库的 dist（node_modules/docx/dist/index.cjs 的 RunProperties 构造器），不是猜的。
 */
/**
 * 库外槽并回 options（见 lib/char-extra.ts 头注）。
 * `dt` 是打包后补丁的登记册——**必须传**：发 smallCaps 的路径有五条，而 caps 那一枚
 * 要按 `<w:smallCaps>` 出现序补（v0.161），漏登记一条就整体错位。
 */
function withCharExtra<T extends object>(opts: T, child: PMNode, dt?: DocTrack): T {
  const mark = child.marks?.find((x) => x.type === 'charExtra')
  // 数值槽不能走 markAttr——那个只返字符串，szcs/pos/kern 三枚在模型里是 number
  const num = (a: string): number | undefined => {
    const v = mark?.attrs?.[a]
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    return undefined
  }
  const str = (a: string) => markAttr(child, 'charExtra', a)
  const szcs = num('szcs')
  const lang = str('lang')
  const langEa = str('langEa')
  // v0.146：复杂文字语言（w:lang/@w:bidi）与字符缩放（w:w/@w:val）。两枚都是库里
  // 实现着、类型面也暴露了的原生槽（IRunOptions.language.bidirectional / IRunOptions.scale），
  // 不走库外断言
  const langBidi = str('langBidi')
  const scale = num('scale')
  const pos = num('pos')
  const kern = num('kern')
  // v0.156：着重号与浮雕/阴文三枚。emphasisMark 在库里实现着
  // （`if (options.emphasisMark) push(createEmphasisMark(options.emphasisMark.type))`，
  // 值原样写进 w:em/@w:val），但**类型面只列了 dot 一档**（EmphasisMarkType 只有一个
  // 成员），circle/comma/underDot 三档得按库外槽传——与 szCs/pos 同款断言，不是猜测。
  // emboss/imprint 两枚是类型面全暴露的原生槽（dist/index.d.ts:1670-1671），实现是
  // `if (options.emboss !== void 0) push(new OnOffElement("w:emboss", …))`，直接传
  const emVal = str('em')
  const emboss = str('emboss')
  const imprint = str('imprint')
  // v0.143：复杂文字粗斜与小型大写。库里实现着（boldComplexScript / **italicsComplexScript**
  // ——斜体那枚是复数 italics，类型面 dist/index.d.ts:1644 与实现一致，写单数 italic 不报错
  // 但静默不输出 / smallCaps），TS 类型面同样没暴露这几枚——与 szcs/lang 同走库外槽。
  // 另注意 boldComplexScript/italicsComplexScript 在库里是「跟随 b/i 的三态」：
  // 不显式传就吃 options.bold/italics，所以这里必须显式传 true（本函数从不管粗斜体本身）
  const ics = str('ics')
  const bcs = str('bcs')
  const sc = str('smallcaps')
  // v0.152：全大写与字符边框。两枚都是**类型面全暴露**的原生槽（IRunOptions.allCaps
  // 与 IRunOptions.border，dist/index.d.ts:1660 与 :1674）——库里实现着、类型也写着，
  // 不走库外断言（与上面 szcs/lang 那一族不同）
  const caps = str('caps')
  // v0.154：隐藏文字。同样是**类型面全暴露**的原生槽（IRunOptions.vanish，
  // dist/index.d.ts:1679），包里实现着、类型也写着——与 allCaps 同路数，不走库外断言
  const vanish = str('vanish')
  const bdr = str('bdr')
  const extra: Record<string, unknown> = {}
  if (szcs !== undefined && szcs > 0) extra.sizeComplexScript = szcs
  if (lang || langEa || langBidi)
    extra.language = { value: lang || undefined, eastAsia: langEa || undefined, bidirectional: langBidi || undefined }
  if (scale !== undefined && scale > 0) extra.scale = scale
  if (pos !== undefined && pos !== 0) extra.position = pos
  if (kern !== undefined && kern > 0) extra.kern = kern
  if (ics) extra.italicsComplexScript = true
  if (bcs) extra.boldComplexScript = true
  if (sc) extra.smallCaps = true
  if (caps) extra.allCaps = true
  if (vanish) extra.vanish = true
  if (emVal) extra.emphasisMark = { type: emVal }
  if (emboss) extra.emboss = true
  if (imprint) extra.imprint = true
  // 字符边框（v0.152）：w:bdr 四枚 → 包的 IRunOptions.border。val 是线型枚举、
  // sz 是八分之一磅、space 是磅、color 是 hex；缺的枚不给（包自己有默认）。
  // **type 面是 BorderStyle 枚举**（SINGLE/DOTTED/…），而 OOXML 的 val 是小写串
  // （single/dotted/…）——BuilderElement 透传不校验，但枚举映射更稳：
  // 只映射 CSS_BORDER_STYLE 认得的档，认不得的按 single
  if (bdr) {
    const [val = '', sz = '', space = '', color = ''] = bdr.split(';')
    const style = BDR_LINE[(val || 'single').toLowerCase()] ?? BorderStyle.SINGLE
    extra.border = {
      style,
      ...(/^\d+$/.test(sz) && Number(sz) > 0 ? { size: Number(sz) } : {}),
      // space 收 0：显式 0 与缺省同结果，但源件写了就原样往返（sz 不行——零宽边框
      // 不是合法档，缺了按包的默认走）
      ...(/^\d+$/.test(space) ? { space: Number(space) } : {}),
      ...(color && color.toLowerCase() !== 'auto' ? { color: color.replace(/^#/, '').toUpperCase() } : {}),
    }
    // 主题三枚（v0.166）：包外无槽，按 `<w:bdr>` 出现序补回。**只要发了这个元素就登记**
    // （与 caps 同一条纪律），空串占位
    dt?.bdrExtras.push(bdrRunExtraOf(bdr))
  }
  // 全大写与小型大写同时要时，包只发 smallCaps（else-if），caps 那一枚由补丁位补。
  // **只要发了 smallCaps 就登记一格**（不管这枚 run 要不要 caps）——闸门对的是
  // document.xml 里 `<w:smallCaps>` 的枚数，登记半截等于整笔错位
  if (sc) dt?.capsExtras.push(caps ? '<w:caps/>' : '')
  return Object.keys(extra).length ? ({ ...opts, ...extra } as unknown as T) : opts
}

/** w:bdr/@w:val → 包的 BorderStyle（OOXML 十六档里包有同名枚举的这几档；
 * dashLargeGap 一族包里没有对应成员，落到默认 single） */
const BDR_LINE: Record<string, (typeof BorderStyle)[keyof typeof BorderStyle]> = {
  single: BorderStyle.SINGLE,
  dotted: BorderStyle.DOTTED,
  dashed: BorderStyle.DASHED,
  double: BorderStyle.DOUBLE,
  dotdash: BorderStyle.DOT_DASH,
  dashsmallgap: BorderStyle.DASH_SMALL_GAP,
}

/**
 * 字符边框的主题三枚（v0.166）：`data-rbdr` 载荷 → 追加进 `<w:bdr>` 的属性串。
 * 空串 = 这一枚不补（补丁按 `<w:bdr>` 出现序对位，空串占位）。
 *
 * 与段落/逐格那一族同形、不同槽：那个是「按边分格」的 `data-bdr`，这个是定序七格
 * `val;sz;space;color;themeColor;themeTint;themeShade`。** `w:color` 不从载荷补**——
 * 写手本来就按字面色发，包也发得出来，只有主题三枚是包外槽。
 */
function bdrRunExtraOf(raw: string): string {
  const slots = raw.split(';')
  const [ref = '', tint = '', shade = ''] = slots.slice(4, 7)
  const okRef = /^[A-Za-z0-9]+$/.test(ref) ? ref : ''
  const okTint = /^[0-9A-Fa-f]{2}$/.test(tint) ? tint : ''
  const okShade = /^[0-9A-Fa-f]{2}$/.test(shade) ? shade : ''
  if (!okRef && !okTint && !okShade) return ''
  return (
    (okRef ? ` w:themeColor="${okRef}"` : '') +
    (okTint ? ` w:themeTint="${okTint}"` : '') +
    (okShade ? ` w:themeShade="${okShade}"` : '')
  )
}

interface DocTrack {
  used: Set<number>
  ranges: Set<number>
  skipped: Set<number>
  /** 脚注/尾注正文：键是导出时现编的序号（1 起，两类各自计数），与 Word 的自动编号同一条规则 */
  notes: Record<NoteKind, Map<number, string>>
  seq: Record<NoteKind, number>
  /** 修订壳的 w:id 计数：Word 只要求文档内不重复，跟批注 id 不同名字空间，从 1 起即可 */
  revId: number
  /**
   * 段落属性余量（v0.147）：与 `section.children` 里每个 Paragraph 一一对应、同序。
   * 包里没有这一族的槽（只有 autoSpaceDN 一枚，且它把 onOff 写成裸元素带不出 w:val），
   * 导出走打包后补丁——补丁按出现序贴回 `<w:pPr>`，所以这条数组必须与段落同序同长
   */
  pprExtras: string[]
  /**
   * 表自身的条件层闸门（v0.147）：与 `section.children` 里每个 Table 一一对应、同序。
   * 表上那一枚压过样式推出来的那一枚，同样走打包后补丁按出现序贴回 `<w:tblPr>`
   */
  tblLooks: string[]
  /**
   * 表级条件格式尺寸（v0.152）：与 tblLooks 同序同长——同一枚 `<w:tblPr>` 上要补的
   * 两枚 bandSize 元素（包里没有槽），与 tblLook 共用一次解压/重压
   */
  tblPrs: string[]
  /**
   * 表级单元格间距（v0.154）：与 tblPrs 同序同长（同一枚 `<w:tblPr>` 的第二笔补丁）。
   * 之所以不与 tblPrs 合并成一串：两族在 CT_TblPrBase 的序里**分居 tblW 两侧**
   * （bandSize 在前、tblCellSpacing 在后），必须各自找自己的插入锚点
   */
  cellSps: string[]
  /**
   * 单元格不换行（v0.152）：与 document.xml 里每个 `<w:tc>` 一一对应、同序（含嵌套
   * 表内的格——两族各自按自己的元素出现序对位，互不干扰）。包里没有 noWrap 的槽，
   * 走打包后补丁按 `<w:tc>` 出现序插 `<w:noWrap/>`（计数闸门同 pprExtras）
   */
  cellExtras: string[]
  /**
   * 图片容器壳（v0.148）：与 document.xml 里每个 `<w:drawing>` 一一对应、同序。
   * 包把整层壳都发出来了，只是值全部硬编码（dist*=0、effectExtent 四边=0、两枚
   * locks 恒 1、pic:cNvPr 的 name 是空串），所以也走打包后补丁——按出现序逐块改值
   */
  imgExtras: string[]
  /**
   * 下划线主题三枚（v0.159）：与 document.xml 里每个 `<w:u>` 一一对应、同序。
   * 包只有 `{type,color}` 两枚槽（createUnderline 只写 w:val 与 w:color），
   * `w:themeColor / w:themeTint / w:themeShade` 包外无槽，只能按出现序补回去
   * （计数闸门同 pprExtras：条数对不上就整笔放弃）
   */
  uThemes: string[]
  /**
   * 文字色主题三枚（v0.160）：与 document.xml 里每个 `<w:color>` 一一对应、同序。
   * 与 uThemes 同一条机制债的另一半（包发 w:color 时只写 w:val），两族各按自己的
   * 元素出现序对位，互不干扰
   */
  colorThemes: string[]
  /**
   * 文字色字面值原件（v0.184）：与 `<w:color>` 一一对应、同序。包发 w:val 时写的是
   * 主题解析后的屏上色，源件那枚字面值（如 FF0000）得按出现序**改值**补回。
   * 与 colorThemes 同一次登记，条数闸门共用；空串 = 用户改过色或源件没写字面值，不动。
   */
  colorLits: string[]
  /**
   * 表条件格式的落点开关（v0.162）：与 `section.children` 里每个 Table 一一对应、同序。
   * `w:cnfStyle` 十三枚在包里没有槽（包只发它认得的表属性），走打包后补丁按
   * `<w:tblPr>` 出现序插。与 tblLooks/tblPrs/cellSps 同住一处，但**插入锚点不同**——
   * cnfStyle 在 CT_TblPrBase 里紧跟 tblStyle，排在其它三族之前
   */
  cnfStyles: string[]
  /**
   * 表级边框六边原值（v0.163）：与 `section.children` 里每个 Table 一一对应、同序。
   * 包恒发 `<w:tblBorders>` 但值是硬编码默认（single/4/auto 六枚），且六个槽里装不下
   * 主题三枚——所以走打包后补丁**整片替换内容**（不是插元素、也不是补属性）。
   * 与前四族同住 `<w:tblPr>`、同序登记，但动作不同：那四族是「插一枚新元素」，
   * 这一族是「换掉一片已有元素的孩子」
   */
  tblBorders: string[]
  /**
   * 被包吞掉的那一枚全大写（v0.161）：与 document.xml 里每个 `<w:smallCaps>` 一一对应、
   * 同序。包的 RunProperties 里 `smallCaps` 与 `allCaps` 是 **else-if**（dist/index.mjs:
   * 10538-10539：先 smallCaps，有了就再不看 allCaps）——一个 run 同时要两枚时，库只发
   * smallCaps，`<w:caps/>` 整个消失。补丁按 `<w:smallCaps>` 出现序在它**前面**插
   * `<w:caps/>`（CT_RPrBase 里 caps 排在 smallCaps 之前）。
   *
   * 登记在 withCharExtra 内部而不是 childToRuns 里：发 smallCaps 的路径有五条
   * （普通 run / 超链接 / 修订插入 / 修订删除 / 符号），少登记一条就整体错位
   */
  capsExtras: string[]
  /**
   * 底纹的存盘原件（v0.164）：与 document.xml 里每个 `<w:shd>` 一一对应、同序。
   * 包只会发 `{val,color,fill}` 三枚（createShading），主题引用三枚在包外；而且它写的
   * `w:fill` 是**解析后的屏上色**，源件的字面 fill 已经没人记得。补丁按出现序把这
   * 几枚**合进**已有开标签（同名属性改值、缺的追加），而不是再插一枚元素——
   * `w:shd` 在 CT_PPrBase / CT_TcPrBase 里都是单枚
   */
  shdExtras: string[]
  /**
   * 段落边框的存盘原件（v0.165）：与 document.xml 里每个 `<w:pBdr>` 一一对应、同序。
   * 包会发四条边、也会发 `w:color`——但写的是**解析后的屏上色**，源件那枚字面色与
   * `w:themeColor/themeTint/themeShade` 三枚在包外。补丁按块贴：块内按边名找元素，
   * 同名属性改值、缺的追加（同 shdExtras 的动作；点分的是「哪一块」，不是「第几遍」）
   */
  paraBdrs: string[]
  /**
   * 逐格边框的存盘原件（v0.165）：与 document.xml 里每个 `<w:tcBorders>` 一一对应、
   * 同序。**只在真发得出这个块时登记**（`bordersOf` 有值），与 tblBorders 的区别是
   * 它按格走，所以对位靠「哪些格带边框」这一条，而不是按格数硬套
   */
  cellBdrs: string[]
  /**
   * 字符边框的主题三枚（v0.166）：与 document.xml 里每个 `<w:bdr>` 一一对应、同序。
   * 与 capsExtras 同一条登记纪律——**只要发了这个元素就登记**（空串占位），
   * 因为 `<w:bdr>` 只出现在 run 的 rPr 里，全部由 withCharExtra 那一处发出
   */
  bdrExtras: string[]
  /**
   * 表行余量（v0.172）：与 document.xml 里每个 `<w:tr>` 一一对应、同序（含嵌套表）。
   * `w:gridAfter` 与 `w:wAfter` 包没有槽，按行贴回 `<w:trPr>`（没有 trPr 就现开一枚）
   */
  rowPrs: string[]
}

type NoteKind = 'footnote' | 'endnote'

/** Document 构造参数里的脚注/尾注两栏：没内容时整条不给，避免给普通文档凭空挂上正文部件 */
type NoteRecordOption = {
  footnotes?: Record<string, { children: Paragraph[] }>
  endnotes?: Record<string, { children: Paragraph[] }>
}

function newDocTrack(): DocTrack {
  return {
    used: new Set(),
    ranges: new Set(),
    skipped: new Set(),
    notes: { footnote: new Map(), endnote: new Map() },
    seq: { footnote: 0, endnote: 0 },
    revId: 1,
    pprExtras: [],
    tblLooks: [],
    tblPrs: [],
    cellSps: [],
    cellExtras: [],
    imgExtras: [],
    cnfStyles: [],
    tblBorders: [],
    capsExtras: [],
    shdExtras: [],
    paraBdrs: [],
    cellBdrs: [],
    bdrExtras: [],
    rowPrs: [],
    uThemes: [],
    colorThemes: [],
    colorLits: [],
  }
}

/** 导出用的编号定义名：Document.numbering.config 与段落 numbering.reference 必须同名 */
const ORDERED_REF = 'oof-ordered'

/** 三级十进制/字母/罗马数字，缩进交编号层管（用户另有直接格式缩进时段落级覆盖它） */
const ORDERED_LEVELS = [0, 1, 2].map((level) => ({
  level,
  format: level === 0 ? LevelFormat.DECIMAL : level === 1 ? LevelFormat.LOWER_LETTER : LevelFormat.LOWER_ROMAN,
  text: `%${level + 1}.`,
  alignment: AlignmentType.START,
  style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
}))

/**
 * 一条列表串的编号档位（v0.142）：子弹档 marker 是符面字符，有序档是 LevelFormat；
 * align 是 w:lvlJc 的符面对齐，start 是起始号（w:start / w:startOverride）。
 */
interface ListKind {
  ordered: boolean
  marker: string
  align: 'left' | 'center' | 'right'
  start: number
}

/** HTML `<ol type>` → LevelFormat（读侧 OL_TYPE 的反向表；StarterKit 只认 1/a/A/i/I） */
const OL_FMT: Record<string, (typeof LevelFormat)[keyof typeof LevelFormat]> = {
  '1': LevelFormat.DECIMAL,
  a: LevelFormat.LOWER_LETTER,
  A: LevelFormat.UPPER_LETTER,
  i: LevelFormat.LOWER_ROMAN,
  I: LevelFormat.UPPER_ROMAN,
}

/** 模型上的 markerAlign 属性 → 三档；null/不认识按 left（Word 的默认） */
function markerAlignOf(v: unknown): 'left' | 'center' | 'right' {
  return v === 'center' || v === 'right' ? v : 'left'
}

/**
 * 一条编号定义的三层（v0.142）：符面/格式照 kind 走，缩进沿用 ORDERED_LEVELS 那把尺子
 * （720×(层+1) 左缩进 + 360 悬挂——Word 默认编号层的形状）。
 * 起始号落在**使用层**（startLevel）：段落的 w:numPr 指哪一层，Word 就从那一层的
 * w:start 起算——落在第 0 层而段落引用第 1 层的话，Word 整条读不到起始值。
 */
/** 一层的档位类型：`format` 是包里那 63 档枚举，不是裸字符串 */
type LvlFormat = (typeof LevelFormat)[keyof typeof LevelFormat]

/**
 * OOXML 的 `w:numFmt` 取值 → 包里的 `LevelFormat`：63 档一一对应，值就是同一串
 * （decimal / lowerLetter / chicago / …）。认不出的档位（自定义格式串）不硬猜。
 */
const NUM_FMT = new Map<string, LvlFormat>(Object.values(LevelFormat).map((v) => [String(v), v]))

/**
 * 源文档那份编号定义的逐层档位（v0.158）。有一层认不出（不在那 63 档里），或者层号
 * 跳着来（没法按 ilvl 对位），就整条不认——宁可按段的档位重建，也不写一枚 Word 打不
 * 开的 numFmt。与 patchNumberingXml 同一条纪律：认不出就不贴。
 */
function defLvlsOf(def?: DocxAbstractNumMeta): { level: number; format: LvlFormat; text: string }[] | null {
  if (!def) return null
  const out: { level: number; format: LvlFormat; text: string }[] = []
  for (const k of Object.keys(def.levels)) {
    const lv = def.levels[k]
    const format = lv.fmt ? NUM_FMT.get(lv.fmt) : undefined
    if (!format) return null
    out.push({ level: Number(k), format, text: lv.text ?? '' })
  }
  if (!out.length) return null
  out.sort((a, b) => a.level - b.level)
  for (let i = 0; i < out.length; i++) if (out[i].level !== i) return null
  return out
}

function listLevels(kind: ListKind, startLevel = 0, def?: DocxAbstractNumMeta) {
  const align =
    kind.align === 'center' ? AlignmentType.CENTER : kind.align === 'right' ? AlignmentType.END : AlignmentType.START
  const one = (level: number, format: LvlFormat, text: string) => ({
    level,
    format,
    text,
    alignment: align,
    ...(kind.ordered && kind.start !== 1 && level === startLevel ? { start: kind.start } : {}),
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  })
  // 按段档位造一层：有序档的 `text` 是 `%N.`（N = 层 + 1），符面档三层共用同一个字符
  const synth = (level: number) =>
    kind.ordered
      ? one(level, kind.marker as LvlFormat, `%${level + 1}.`)
      : one(level, LevelFormat.BULLET, kind.marker)
  const src = defLvlsOf(def)
  if (!src) return [0, 1, 2].map(synth)
  // 源有几层就写几层，不足三层用按段档位补齐：段落引用的层号被截到 2，写少了那一段
  // 在 Word 里没有档位可用。多出来的尾层不影响对位——patchNumberingXml 比的是前缀
  const n = Math.max(3, src.length)
  return Array.from({ length: n }, (_, level) => (src[level] ? one(level, src[level].format, src[level].text) : synth(level)))
}

/**
 * 导出用的编号注册表：把文档里每串列表的档位收成一条 numbering config。
 * 默认档不进表——子弹（•、左对齐）走包自带的 `bullet`，无型别有序（左对齐、起始 1）
 * 走既有的 ORDERED_REF，这两种情形导出的字节与 v0.142 之前一致；
 * 只有「档位与默认不同」的列表才生成独立 reference（符面字符、罗马数字、居中对齐…）。
 */
class ListRegistry {
  private refs = new Map<string, { ref: string; kind: ListKind; level: number; def?: DocxAbstractNumMeta }>()
  /** 源文档的编号定义（v0.158）：按「第 0 层的档位」认领，一份定义只许一串列表用 */
  private defs: DocxAbstractNumMeta[]
  private claimed = new Set<number>()

  constructor(defs: DocxAbstractNumMeta[] = []) {
    this.defs = defs
  }

  /**
   * 认领一份源定义：**只比第 0 层**的 `numFmt|lvlText`——更深那几层本来就是写手拍平
   * 拍没了的东西，拿它们当判据等于永远认不出。第 0 层是屏上那一串真正用的档位，
   * 读手把它带进了模型（`<ol type>` / `<ul data-marker>`），两边对得上。
   *
   * 认不出就返回 undefined（退回到按段重建），绝不去够第二份——两份定义都挂着同一个
   * 第 0 层时，第二串列表不该抢走第一串的那份（patchNumberingXml 也是一份定义只贴一枚）。
   */
  private claim(kind: ListKind): DocxAbstractNumMeta | undefined {
    const fmt = kind.ordered ? String(kind.marker) : String(LevelFormat.BULLET)
    const text = kind.ordered ? '%1.' : kind.marker
    for (let i = 0; i < this.defs.length; i++) {
      if (this.claimed.has(i)) continue
      const lv = this.defs[i].levels['0']
      if (!lv || lv.fmt !== fmt || (lv.text ?? '') !== text) continue
      this.claimed.add(i)
      return this.defs[i]
    }
    return undefined
  }

  /**
   * 取这一串列表的 reference。level 是段落将引用的层（= 嵌套深度，已截到 2）：
   * 有序档的起始号要落在这一层上，所以层号进键——同一个罗马数字串出现在两层时
   * 各有一条定义，互不抢对方的 start。子弹档没有起始号，层号不进键，全篇复用。
   */
  refOf(kind: ListKind, level: number): string {
    const key = JSON.stringify([kind.ordered, kind.marker, kind.align, kind.ordered ? [kind.start, level] : 0])
    const hit = this.refs.get(key)
    if (hit) return hit.ref
    const ref = `oof-list-${this.refs.size}`
    this.refs.set(key, { ref, kind, level, def: this.claim(kind) })
    return ref
  }

  config(): { reference: string; levels: ReturnType<typeof listLevels> }[] {
    return [...this.refs.values()].map(({ ref, kind, level, def }) => ({
      reference: ref,
      levels: listLevels(kind, level, def),
    }))
  }
}

/** 行内的单元格（TipTap 用 tableHeader 表示表头行那一格的类型） */
function cellsOf(row: PMNode): PMNode[] {
  return (row.content ?? []).filter((c) => c.type === 'tableCell' || c.type === 'tableHeader')
}

function colspanOf(cell: PMNode): number {
  return Number(cell.attrs?.colspan ?? 1) || 1
}

function rowspanOf(cell: PMNode): number {
  return Number(cell.attrs?.rowspan ?? 1) || 1
}

function isCellNode(cell: PMNode): boolean {
  return cell.type === 'tableCell' || cell.type === 'tableHeader'
}

/**
 * 按网格走一遍表：给出列数与每行每枚真格子的**网格起始列**。
 * 竖跨（rowspan）会在下面那一行压掉一枚格子——TipTap 模型里那一行真的少一个子节点，
 * 而网格上那几枚列仍被上面那格占着。早先「每行 colspan 之和等于列数」那道门只数行内自己的格子，
 * 于是含竖跨的表整表判成形状不合、宽度账整表作废（屏上有、字节里没有、Word 里也没有）。
 * 现在按占位走：行宽对不上、跨越出界、格子互相压住 ⇒ null（调用方一律按「没有宽度账」处理）。
 */
function gridShapeOf(rows: PMNode[]): { cols: number; starts: number[][] } | null {
  if (rows.length === 0) return null
  const first = cellsOf(rows[0])
  if (first.length === 0) return null
  const cols = first.reduce((s, c) => s + colspanOf(c), 0)
  if (cols === 0) return null
  const taken: boolean[][] = rows.map(() => new Array<boolean>(cols).fill(false))
  const starts: number[][] = []
  for (let r = 0; r < rows.length; r++) {
    const rowStarts: number[] = []
    let gc = 0
    for (const c of cellsOf(rows[r])) {
      while (gc < cols && taken[r][gc]) gc += 1
      const cs = colspanOf(c)
      const rs = rowspanOf(c)
      if (gc + cs > cols || r + rs > rows.length) return null
      for (let k = 0; k < rs; k++) {
        for (let i = 0; i < cs; i++) {
          if (taken[r + k][gc + i]) return null
          taken[r + k][gc + i] = true
        }
      }
      rowStarts.push(gc)
      gc += cs
    }
    while (gc < cols && taken[r][gc]) gc += 1
    if (gc !== cols) return null
    starts.push(rowStarts)
  }
  return { cols, starts }
}

/**
 * 表的逐网格列宽（px）：行 0 各格的 colwidth 是按 colspan 展开的数组，摊平成逐网格列。
 * 四道认账门里只松「每一格都得带账」那一道——**部分账按剩余版心等分补平**：
 * 界面上拖一次只写被拖那一列（prosemirror-tables 的 updateColumnWidth 形状，实测 after=[248]|null|null），
 * 要求整表齐账等于把用户拖出来的那一枚宽度在导出时整表作废（屏上有、字节里没有、Word 里也没有）。
 * 另外三道形状门一道不松：数组长度必须等于该格 colspan、账必须是正数（0 = 该列没账，是库自己的约定）、
 * 每行在网格上的占位必须等于摊平出的网格列数（竖跨压掉的格子算占位，见 gridShapeOf）——
 * gridCol 枚数与跨度对不上在 Word 那头是损坏件档。
 * 一枚账都没有 ⇒ null（整表按「无宽度账」处理：版心等分 + 百分比表宽 + 不声明 fixed）
 */
function gridPxOf(rows: PMNode[], contentTwips: number): number[] | null {
  const shape = gridShapeOf(rows)
  if (!shape) return null
  const cols = shape.cols
  const laid: (number | null)[] = []
  for (const c of cellsOf(rows[0])) {
    const cw = c.attrs?.colwidth
    if (cw == null) {
      for (let i = 0; i < colspanOf(c); i++) laid.push(null)
      continue
    }
    if (!Array.isArray(cw) || cw.length !== colspanOf(c)) return null
    for (const w of cw) {
      const px = num(w)
      if (px === 0) laid.push(null)
      else if (px > 0) laid.push(px)
      else return null
    }
  }
  const known = laid.filter((x): x is number => x != null)
  if (known.length === 0) return null
  const rest = cols - known.length
  if (rest === 0) return known
  // 没带账的列分走剩下的版心：这一档在屏上就是浏览器的算法（实测 colsAfter 248/188.7/188.7）
  const contentPx = Math.floor(contentTwips / PX_TWIP)
  const fill = Math.max(1, Math.floor((contentPx - known.reduce((s, w) => s + w, 0)) / rest))
  return laid.map((px) => px ?? fill)
}

/** 版心宽度（twips）兜底：A4 + 默认边距，调用方没给页面设置时按它等分 */
const CONTENT_TWIPS_FALLBACK = Math.round(
  (PAGE_SIZES_MM.A4[0] - DEFAULT_PAGE_MARGIN.left - DEFAULT_PAGE_MARGIN.right) * MM_TWIPS,
)

/** 没有宽度账的表按版心等分写真网格：docx 库缺 columnWidths 会落 w:gridCol w="100" 的默认假网格（≈ 6.7px），
 *  那份假网格读回来会变成一个真实但荒谬的列宽 */
function equalGridPx(cols: number, contentTwips: number): number[] {
  const px = Math.max(1, Math.floor(contentTwips / PX_TWIP / cols))
  return Array.from({ length: cols }, () => px)
}

function blocksOf(
  nodes: PMNode[],
  depth = 0,
  dt: DocTrack = newDocTrack(),
  contentTwips = CONTENT_TWIPS_FALLBACK,
  /** 编号注册表（v0.142）：整篇文档共用一份，递归与格内都传同一枚 */
  lists: ListRegistry = new ListRegistry(),
): (Paragraph | Table | TableOfContents)[] {
  const out: (Paragraph | Table | TableOfContents)[] = []
  /**
   * 造段落的同时登记它的属性余量（v0.147）：顺序即 document.xml 里 `<w:p>` 的出现序，
   * 打包后补丁按这个序贴回去。非段落型（代码块/分页/水平线）按空串登记占住位置
   */
  const para = (node: PMNode | undefined, opts: ConstructorParameters<typeof Paragraph>[0]) => {
    dt.pprExtras.push(pprExtraXml(node))
    return new Paragraph(opts)
  }
  for (const node of nodes) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const ordered = node.type === 'orderedList'
      const attrs = (node.attrs ?? {}) as Record<string, unknown>
      const align = markerAlignOf(attrs.markerAlign)
      // 默认档不进注册表（字节与 v0.142 之前一致）：子弹（•/左对齐）走包自带 bullet，
      // 无型别有序（左对齐、起始 1）走 ORDERED_REF；其余档位各生成一条编号定义
      let numbering: { numbering: { reference: string; level: number } } | { bullet: { level: number } }
      if (ordered) {
        const type = typeof attrs.type === 'string' ? attrs.type : null
        const startRaw = Number(attrs.start)
        const start = Number.isFinite(startRaw) && startRaw > 0 ? Math.round(startRaw) : 1
        const lvl = Math.min(2, depth)
        const ref =
          !type && align === 'left' && start === 1
            ? ORDERED_REF
            : lists.refOf({ ordered: true, marker: OL_FMT[type ?? '1'] ?? LevelFormat.DECIMAL, align, start }, lvl)
        numbering = { numbering: { reference: ref, level: lvl } }
      } else {
        const ch = typeof attrs.bulletChar === 'string' && attrs.bulletChar ? attrs.bulletChar : '•'
        const ref = ch === '•' && align === 'left' ? null : lists.refOf({ ordered: false, marker: ch, align, start: 1 }, Math.min(2, depth))
        numbering = ref ? { numbering: { reference: ref, level: Math.min(2, depth) } } : { bullet: { level: depth } }
      }
      for (const item of node.content ?? []) {
        const blocks = (item.content ?? []).filter((b) => b.type !== 'bulletList' && b.type !== 'orderedList')
        const nested = (item.content ?? []).filter((b) => b.type === 'bulletList' || b.type === 'orderedList')
        const main: PMNode = blocks[0] ?? { type: 'paragraph', content: [] }
        out.push(
          para(main, {
            children: inlineBlockChildren(main, dt),
            // 有序项必须走真编号：写成「1. 」字面文本时 Word 里既不续号也不重排，
            // 读回来更会把它当成普通段落（编号从此消失）。
            ...numbering,
            indent: indentOf(main),
            // 有序项库见 style 会跳过 ListParagraph 标签，命名样式可并存；子弹项库无条件
            // 补 ListParagraph（两枚 pStyle 撞车），样式标签只好丢（挂账）
            ...paraFormatOf(main, ordered ? pstyleOf(main) : undefined, dt),
          }),
        )
        out.push(...blocksOf(blocks.slice(1), depth, dt, contentTwips, lists))
        out.push(...blocksOf(nested, depth + 1, dt, contentTwips, lists))
      }
      continue
    }
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level ?? 1)
      out.push(
        para(node, {
          children: inlineBlockChildren(node, dt),
          outlineLevel: Math.max(0, Math.min(8, level - 1)),
          indent: indentOf(node),
          alignment: alignOf(node),
          ...paraFormatOf(node, undefined, dt),
          heading:
            level === 1 ? HeadingLevel.HEADING_1
            : level === 2 ? HeadingLevel.HEADING_2
            : level === 3 ? HeadingLevel.HEADING_3
            : HeadingLevel.HEADING_4,
        }),
      )
      continue
    }
    if (node.type === 'codeBlock') {
      const lines = textOf(node).split('\n')
      out.push(
        para(node, {
          children: lines.flatMap((l, i) => [
            ...(i > 0 ? [new TextRun({ text: '', break: 1 })] : []),
            new TextRun({ text: l, font: 'Consolas' }),
          ]),
          shading: { type: 'clear', fill: 'F2F3F5' },
          spacing: { after: 120 },
        }),
      )
      continue
    }
    if (node.type === 'horizontalRule') {
      out.push(para(undefined, { children: [], thematicBreak: true }))
      continue
    }
    if (node.type === 'pageBreak') {
      out.push(para(undefined, { children: [new PageBreak()] }))
      continue
    }
    if (node.type === 'blockquote') {
      out.push(
        para(node, {
          children: inlineBlockChildren(node, dt),
          indent: indentOf(node, 480),
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: '9CA3AF', space: 8 } },
          spacing: { after: 120 },
        }),
      )
      continue
    }
    if (node.type === 'toc') {
      // \o 按内置标题样式 + \u 按段落大纲级别收集；Word 打开后"更新域"重生成
      out.push(
        new TableOfContents('目录', {
          hyperlink: true,
          headingStyleRange: '1-4',
          useAppliedParagraphOutlineLevel: true,
        }),
      )
      continue
    }
    if (node.type === 'table') {
      const rows = (node.content ?? []).filter((r) => r.type === 'tableRow')
      if (rows.length === 0) continue
      // 列宽这份账：带账的表（整表齐账或只有一列带账）按账写真网格并声明 fixed 布局
      // （逐格 w:tcW + 表级绝对 w:tblW），没带账的表按版心等分写真网格但仍交给 Word 自动布局；
      // 两条都不再落库默认的 100 twip 假网格
      const shape = gridShapeOf(rows)
      const cols = shape?.cols ?? Math.max(1, ...rows.map((r) => cellsOf(r).reduce((s, c) => s + colspanOf(c), 0)))
      const gridPx = gridPxOf(rows, contentTwips)
      const gridTw = (gridPx ?? equalGridPx(cols, contentTwips)).map((px) =>
        Math.max(1, Math.round(px * PX_TWIP)),
      )
      const totalTw = gridTw.reduce((s, w) => s + w, 0)
      // 表格浮动（v0.145）：data-tblp 载荷 → ITableFloatOptions，键名一一对应
      // （tblpX→absoluteHorizontalPosition、tblpXSpec→relativeHorizontalPosition、
      // horzAnchor→horizontalAnchor、四 FromText 同名、overlap→overlap 子元素）。
      // 包里 verticalAnchor 类型面是 TableAnchorType（margin/page/text），而 OOXML 的
      // vertAnchor 值域含 top/bottom/center/inside/outside——BuilderElement 透传不校验，
      // 原值落；类型面按库外槽断言绕过
      const tblp = tblpFloatOf(node.attrs?.tblp)
      // 表自身的闸门（v0.147）：与段落余量同理，按出现序登记，打包后贴回 <w:tblPr>
      dt.tblLooks.push(tlookXmlOf(node.attrs?.tlook))
      // 表级条件格式尺寸（v0.152）：两枚 bandSize 与 tblLook 同住 tblPr、同序登记，
      // 共用 patchTblLook 那一次解压/重压
      dt.tblPrs.push(tblPrXmlOf(node.attrs?.tblPr))
      // 单元格间距（v0.154）：同一张表的第二笔 tblPr 补丁，插入锚点与 bandSize 不同
      // （序里排在 tblW 之后），所以单列一条登记，共用那一次解压/重压
      dt.cellSps.push(tblCellSpacingXmlOf(node.attrs?.tblPr))
      // 表条件格式落点十三枚（v0.162）：第三笔 tblPr 补丁，锚点又不同（紧跟 tblStyle）
      dt.cnfStyles.push(cnfXmlOf(node.attrs?.cnf))
      // 表级边框六边原值（v0.163）：整片替换，与上面四族同序登记
      dt.tblBorders.push(tblBordersXmlOf(node.attrs?.tblb))
      out.push(
        new Table({
          // 表样式引用（v0.114）：表身上这枚 data-tstyle 就是 w:tblStyle，
          // 定义那一份由 tableStylesOf 写出搬到 styles.xml
          ...(typeof node.attrs?.tStyle === 'string' && node.attrs.tStyle ? { style: node.attrs.tStyle as string } : {}),
          ...(gridPx
            ? { width: { size: totalTw, type: WidthType.DXA }, layout: TableLayoutType.FIXED }
            : { width: { size: 100, type: WidthType.PERCENTAGE } }),
          columnWidths: gridTw,
          // w:tblInd 是表离版心左边距的距离（twips），由导入侧的 marginLeft 属性记着
          ...(num(node.attrs?.marginLeft) > 0
            ? { indent: { size: Math.round(num(node.attrs?.marginLeft) * PX_TWIP), type: WidthType.DXA } }
            : {}),
          ...(tblp ? { float: tblp } : {}),
          rows: rows.map((r, ri) => {
              // 逐格的 w:tcW 吃掉它跨的那几枚网格列；网格游标按 shape 给的真格子起始列走，
              // 被上面竖跨压掉的那几枚列不能省（不省就会把整行往左错一枚，键进去的账落错格子）
              let gc = 0
              let ck = 0
              // 行高（v0.97 起）：导入侧按 atLeast 读入（exact 的裁剪档 CSS 表达不了），
              // 导出同档回写，往返稳定在 atLeast
              const rh = num(r.attrs?.rowHeight)
              // 行余量（v0.172）：一行一格，登记序 = <w:tr> 出现序（含嵌套表的行——
              // 外层行先 push，XML 里外层 <w:tr> 也先出现）
              dt.rowPrs.push(trPrExtraOf(r.attrs))
              return new TableRow({
                // 表头行由行级 w:trPr/w:tblHeader 记账（TipTap 用 th 单元格类型表示）。
                // 只在命中时给属性：写成 tableHeader:false 会落 <w:tblHeader w:val="false"/>，
                // 而读侧按"有没有这个元素"判断，伪标记会把正文行错认成表头。
                ...(r.content ?? []).some((c) => c.type === 'tableHeader') ? { tableHeader: true } : {},
                ...(rh > 0 ? { height: { value: Math.round(rh * PX_TWIP), rule: HeightRule.ATLEAST } } : {}),
                children: (r.content ?? []).map((cell) => {
                  // 单元格不换行（v0.152）：登记必须赶在本格内容之前——嵌套表的内层格
                  // 在 blocksOf 里先入账，而 XML 里外层 <w:tc>（连它的 tcPr）排在
                  // 内层表前面。数组序 = <w:tc> 出现序，补丁按这个序对位
                  dt.cellExtras.push(noWrapXmlOf(cell.attrs?.noWrap))
                  // TipTap 合并语义 colspan/rowspan → gridSpan + vMerge（docx 库内部展开 restart/continue）
                  const cs = colspanOf(cell)
                  const rs = rowspanOf(cell)
                  const isCell = isCellNode(cell)
                  const start = isCell && shape ? (shape.starts[ri][ck++] ?? gc) : gc
                  const cellTw = isCell ? gridTw.slice(start, start + cs).reduce((s, w) => s + w, 0) : 0
                  if (isCell) gc = start + cs
                  const borders = bordersOf(cell.attrs)
                  // 边框的存盘原件（v0.165）：只在真发得出 `<w:tcBorders>` 时登记。
                  // 这一条必须在格内段落之前——XML 里 `<w:tcPr>` 排在格的 `<w:p>` 前面，
                  // 而 pBdr 那本账是另一条线，两族各自按自己的元素出现序对位
                  if (borders) dt.cellBdrs.push(bdrExtraOf(cell.attrs))
                  const bg = shadingOf(cell.attrs)
                  // 底纹的存盘原件（v0.164）：与下面的 tcPr 那一枚同序——格底纹在
                  // `<w:tcPr>` 里，排在格内段落的 `<w:shd>` 之前，所以必须**先**登记
                  if (bg) dt.shdExtras.push(shdExtraOf(cell.attrs))
                  const va = cell.attrs?.vAlign
                  // 格边距（v0.97 起）：pad* 属性（px，0 是真值）→ 逐边 w:tcMar（缇）；
                  // 只在有声明时给 margins，不给默认值——Word 读侧对缺省边自己有表级账
                  const padTw = (v: unknown): number | undefined =>
                    typeof v === 'number' && v >= 0 ? Math.round(v * PX_TWIP) : undefined
                  const mTop = padTw(cell.attrs?.padTop)
                  const mBottom = padTw(cell.attrs?.padBottom)
                  const mLeft = padTw(cell.attrs?.padLeft)
                  const mRight = padTw(cell.attrs?.padRight)
                  const margins = {
                    ...(mTop !== undefined ? { top: mTop } : {}),
                    ...(mBottom !== undefined ? { bottom: mBottom } : {}),
                    ...(mLeft !== undefined ? { left: mLeft } : {}),
                    ...(mRight !== undefined ? { right: mRight } : {}),
                  }
                  // 一格多段要一段一个 w:p：早先图省事把所有子节点并成一个段落，
                  // 于是格内的第二行起既没有换行也没有自己的缩进/对齐（读回来整格糊成一行）
                  const cellBlocks = blocksOf(cell.content ?? [], 0, dt, contentTwips, lists)
                  return new TableCell({
                    ...(gridPx && isCell && cellTw > 0 ? { width: { size: cellTw, type: WidthType.DXA } } : {}),
                    ...(cs > 1 ? { columnSpan: cs } : {}),
                    ...(rs > 1 ? { rowSpan: rs } : {}),
                    ...(borders ? { borders } : {}),
                    ...(bg ? { shading: bg } : {}),
                    ...(Object.keys(margins).length ? { margins: { marginUnitType: WidthType.DXA, ...margins } } : {}),
                    ...(va === 'top' || va === 'middle' || va === 'bottom'
                      ? { verticalAlign: va === 'middle' ? VerticalAlignTable.CENTER : va === 'top' ? VerticalAlignTable.TOP : VerticalAlignTable.BOTTOM }
                      : {}),
                    // OOXML 要求 w:tc 里至少一个 w:p（空否则会成损坏件）。
                    // 补的这一枚也要占住余量数组的位置（顺序必须与段落出现序一致）
                    children: cellBlocks.length ? cellBlocks : [para(undefined, { children: [] })],
                  })
                }),
              })
            },
          ),
        }),
      )
      continue
    }
    if (node.type === 'image') {
      // 块级图片（v0.157）：见 imageRunOf 的注释。一段一图，与 Word 存「独占一段的图」
      // 同形；对齐读的是 align 属性（读手把居中的块图记在 align 上，不是 textAlign）
      const run = imageRunOf(node, dt)
      out.push(
        para(node, {
          children: run ? [run] : [],
          ...(node.attrs?.align === 'center' ? { alignment: AlignmentType.CENTER } : {}),
        }),
      )
      continue
    }
    out.push(
      para(node, {
        children: inlineBlockChildren(node, dt),
        alignment: alignOf(node),
        indent: indentOf(node),
        ...paraFormatOf(node, pstyleOf(node), dt),
      }),
    )
  }
  return out
}

/**
 * post-pack 会话（v0.178）：一次解包、共享 zip、一次打包。
 *
 * 此前十余个补丁各自 `loadAsync(bytes)` → 改一枚部件 → `generateAsync()` 重压整包，
 * 写一份带图文档要解包/压包十余遍（实测占端到端 20.5%）。现在主链建一枚会话，
 * 所有补丁在同一 zip 实例上读写：写回后下一枚补丁读到的是刚改过的文本
 * （JSZip 的 file(name, data) 会替换条目，等价于原来「打包→解包」那一趟），
 * 末尾只 generate 一次。补丁仍保留 `sess` 缺省的独立路径，供 A/B 对照腿与调用方直用。
 */
async function loadZipOf(bytes: Uint8Array) {
  const { default: JSZip } = await import('jszip')
  return JSZip.loadAsync(bytes)
}

interface PackSession {
  zip: Awaited<ReturnType<typeof loadZipOf>>
  touched: boolean
  /**
   * v0.183：部件名 → 当前文本。`legacyPartText` 对照腿不建这份表，每次真解压。
   * 与 v0.178 的共享 zip 是同一条链的第二层：那次省了「整包解包 + 重压」，
   * 这次省的是「同一份 document.xml 被十余个补丁各解压一次」。
   */
  text?: Map<string, string>
}

/**
 * 读一枚部件：共享会话里查表，否则真解压。
 * `zip !== sess.zip` 的独立路径（A/B 对照腿各自解包 / 调用方直用补丁）
 * 一律不走缓存，避免跨 zip 实例串味——这条守卫让对照腿仍是逐字改前路径。
 */
async function partText(
  zip: PackSession['zip'],
  name: string,
  sess?: PackSession,
): Promise<string> {
  const cache = sess?.text
  const shared = !!cache && zip === sess!.zip
  if (shared && cache!.has(name)) return cache!.get(name)!
  const t = (await zip.file(name)?.async('string')) ?? ''
  if (shared) cache!.set(name, t)
  return t
}

/** 写回一枚部件：zip 与缓存同步更新，下一枚补丁读到的就是刚写下的文本 */
function setPart(zip: PackSession['zip'], name: string, text: string, sess?: PackSession): void {
  zip.file(name, text)
  if (sess?.text && zip === sess.zip) sess.text.set(name, text)
}

/** 补丁落地：有会话就只标脏（末尾统一打包），没有会话就照旧各自重压 */
async function finishPatch(
  bytes: Uint8Array,
  zip: PackSession['zip'],
  sess?: PackSession,
): Promise<Uint8Array> {
  if (sess) {
    sess.touched = true
    return bytes
  }
  const buf = (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer
  return new Uint8Array(buf)
}

export async function prosemirrorToDocxBytes(
  json: PMNode,
  meta?: DocMeta,
  opts?: { legacyPartText?: boolean },
): Promise<Uint8Array> {
  const dt = newDocTrack()
  // 编号注册表（v0.142）：blocksOf 一路往里传，收齐全篇的自定义档位后进 Document.numbering。
  // 带上源文档的编号定义（v0.158）：重建一串列表时能照原样逐层发，而不是三层拍成一个符面
  const lists = new ListRegistry(meta?.numbering?.defs ?? [])
  const pg = resolvePage(meta?.page)
  const twips = (mm: number) => Math.round(mm * MM_TWIPS)
  // 版心宽度：与界面上的精确列宽同一个算法（contentTwipsOf），没有宽度账的表按它等分写真网格
  const contentTw = contentTwipsOf(pg)
  const section: {
    children: (Paragraph | Table | TableOfContents)[]
    properties?: {
      page: {
        /** v0.183：w:pgSz/@w:code 纸型档位号（包的原生槽，屏上不兑现） */
        size: { width: number; height: number; orientation?: 'landscape' | 'portrait'; code?: number }
        margin: Record<string, number>
        /** 页码型别与起始值（v0.170）：包的 sections[].properties.page.pageNumbers 原生槽 */
        pageNumbers?: { start?: number; formatType?: (typeof NumberFormat)[keyof typeof NumberFormat] }
      }
      /** v0.183：节起法 w:type（nextPage/continuous/evenPage…），包的原生槽 */
      type?: (typeof SectionType)[keyof typeof SectionType]
      column?: {
        count: number
        space: number
        equalWidth: boolean
        /** 不等宽分支刻意不传：包会把 false 序列化成 w:sep="false"（非法的 ST_OnOff） */
        separate?: boolean
        /** v0.182：不等宽分栏时逐枚 w:col（包的 Column 原生槽） */
        children?: Column[]
      }
    }
    headers?: { default: Header }
    footers?: { default: Footer }
  } = { children: blocksOf(json.content ?? [], 0, dt, contentTw, lists) }
  {
    // docx 库按"竖版宽高 + orientation"理解 size（landscape 时自行交换写盘），故传排序后的尺寸
    // 方向（v0.147）：宽高比与显式 orient 两样都可能说话，显式那一枚为准
    const landscape = pg.orient === 'landscape' || (pg.orient !== 'portrait' && pg.w > pg.h)
    section.properties = {
      page: {
        size: {
          width: twips(Math.min(pg.w, pg.h)),
          height: twips(Math.max(pg.w, pg.h)),
          ...(landscape ? { orientation: 'landscape' as const } : {}),
          // v0.183：纸型档位号原值透传；非数值的脏值不写（宁可少一枚，不赌坏件）
          ...(pg.paperCode !== undefined && Number.isFinite(Number(pg.paperCode))
            ? { code: Number(pg.paperCode) }
            : {}),
        },
        margin: {
          top: twips(pg.margin.top),
          bottom: twips(pg.margin.bottom),
          left: twips(pg.margin.left),
          right: twips(pg.margin.right),
          // 页眉/页脚距纸边（v0.147）：源文件说了就照抄，没说才按上下边距取小
          header: twips(pg.header ?? Math.min(pg.margin.top, 12.7)),
          footer: twips(pg.footer ?? Math.min(pg.margin.bottom, 12.7)),
          // 装订线（v0.147）：说了才写（0 是真值——Word 里「装订线 0」与没写同源，仍写）
          ...(pg.gutter !== undefined ? { gutter: twips(pg.gutter) } : {}),
        },
        // 页码型别与起始值（v0.170）：包有原生槽（w:pgNumType），只是我们的模型此前没带。
        // start 是「这一节从第几页开始编号」，fmt 是「用阿拉伯数字还是罗马数字」
        ...(pg.pageNum
          ? {
              pageNumbers: {
                ...(pg.pageNum.start !== undefined ? { start: pg.pageNum.start } : {}),
                ...(pg.pageNum.fmt
                  ? { formatType: pg.pageNum.fmt as (typeof NumberFormat)[keyof typeof NumberFormat] }
                  : {}),
              },
            }
          : {}),
      },
      // 文档网格（v0.147）：档位与行间距（linePitch 缇）。屏上不兑现，只往返。
      // 包的 GridType 只认四档枚举，源文件里偶见的自造档照样透传（BuilderElement 不校验）
      // v0.152：charSpace（每字符网格宽度，缇）——与 linePitch 同住 w:docGrid 上的第三枚
      ...(pg.docGrid?.type || pg.docGrid?.linePitch !== undefined || pg.docGrid?.charSpace !== undefined
        ? {
            grid: {
              ...(pg.docGrid?.type ? { type: pg.docGrid.type } : {}),
              ...(pg.docGrid?.linePitch !== undefined ? { linePitch: pg.docGrid.linePitch } : {}),
              ...(pg.docGrid?.charSpace !== undefined ? { charSpace: pg.docGrid.charSpace } : {}),
            } as { type?: string; linePitch?: number; charSpace?: number },
          }
        : {}),
      // 单栏不写 w:cols（Word 默认即单栏，写出来反而让 diff 变噪）
      // v0.182：带逐栏表时走 `equalWidth:false + children`（包的原生槽），
      // 缇原值直接交给 Column，不做 mm 换算；没带表就照旧等宽 N 栏
      ...(pg.cols > 1
        ? {
            column: pg.colsLayout?.widths?.length
              ? {
                  count: pg.colsLayout.widths.length,
                  space: twips(pg.colGap),
                  equalWidth: false,
                  children: pg.colsLayout.widths.map(
                    (c) => new Column({ width: c.w, ...(c.space !== undefined ? { space: c.space } : {}) }),
                  ),
                }
              : { count: pg.cols, space: twips(pg.colGap), equalWidth: true as const, separate: false },
          }
        : {}),
      // v0.183：节起法（w:type）。只发包认的五档枚举，源文件偶见的自造档不写
      // （BuilderElement 不校验，但 Word 会判坏件）；schema 序由包负责，post-pack 不动
      ...(pg.sectionType && (Object.values(SectionType) as string[]).includes(pg.sectionType)
        ? { type: pg.sectionType as (typeof SectionType)[keyof typeof SectionType] }
        : {}),
    }
  }
  if (meta?.headerText?.trim()) {
    section.headers = {
      default: new Header({
        children: [
          new Paragraph({
            children: [new TextRun({ text: meta.headerText.trim(), size: 18, color: '6B7280' })],
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 2 } },
          }),
        ],
      }),
    }
  }
  const footText = meta?.footerText?.trim()
  if (footText || meta?.footerPageNumber) {
    const pn = pageNumberParts(meta?.pageNumberFormat)
    // 页码域片段：'第 '/PAGE/' 页' 之类；含总页数时再补 NUMPAGES
    const pageChildren: (string | (typeof PageNumber)[keyof typeof PageNumber])[] =
      meta?.footerPageNumber
        ? [pn.before, PageNumber.CURRENT, pn.after, ...(pn.total ? [' / ', PageNumber.TOTAL_PAGES] : [])]
        : []
    section.footers = {
      default: new Footer({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                ...(footText && meta?.footerPageNumber
                  ? { children: [`${footText} · `, ...pageChildren] }
                  : meta?.footerPageNumber
                    ? { children: pageChildren }
                    : { text: footText }),
                size: 18,
                color: '6B7280',
              }),
            ],
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 2 } },
          }),
        ],
      }),
    }
  }
  // 只导出正文中仍有锚点的批注；孤儿条目（原文被删）保留在 .odoc，不写进 docx
  const anchored = (meta?.comments ?? []).filter((c) => dt.used.has(c.id))
  // docx 只有在存在 parentId 时才生成 commentsExtended.xml（resolved 标志随它落盘），
  // 给 -1 触发该分支且 idToParaId.get(-1) 为 undefined，不会写出伪造的 parentParaId
  const anyResolved = anchored.some((c) => c.resolved)
  // 脚注/尾注正文落进 word/footnotes.xml 与 word/endnotes.xml（分隔符条目由 docx 库自己补齐）。
  // 正文里的换行按段落展开——与导入侧「逐个 <w:p> 取文字、段间补 \n」互为逆运算。
  const noteParts = (kind: NoteKind): NoteRecordOption => {
    const m = dt.notes[kind]
    if (!m.size) return {}
    const rec: Record<string, { children: Paragraph[] }> = {}
    for (const [id, text] of m) {
      rec[String(id)] = {
        children: text
          .split('\n')
          .map(
            (line) =>
              new Paragraph({
                style: kind === 'footnote' ? 'FootnoteText' : 'EndnoteText',
                children: line ? [new TextRun({ text: line })] : [],
              }),
          ),
      }
    }
    return kind === 'footnote' ? { footnotes: rec } : { endnotes: rec }
  }
  const doc = new Document({
    creator: 'OpenOffices',
    title: 'OpenOffices 文档',
    features: { updateFields: true },
    // 文档背景（v0.155）：整篇底色。有主题槽就按主题回（与源件同一种引用方式），
    // 没有主题槽才发解析出来的字面 hex——反过来会把「跟着主题变」写成「钉死一个色」
    ...(meta?.background
      ? {
          background: {
            ...(meta.background.themeColor ? { themeColor: meta.background.themeColor } : {}),
            ...(meta.background.themeShade ? { themeShade: meta.background.themeShade } : {}),
            ...(meta.background.themeTint ? { themeTint: meta.background.themeTint } : {}),
            // v0.157：字面色与主题槽并存（主题槽在场时 Word 按主题算，字面值是兜底）。
            // 此前只在没有 themeColor 时才写字面色，于是"两枚都有"的件一往返就少一枚
            ...(meta.background.color
              ? { color: meta.background.color.replace(/^#/, '').toUpperCase() }
              : !meta.background.themeColor && meta.background.css
                ? { color: meta.background.css.replace(/^#/, '').toUpperCase() }
                : {}),
          },
        }
      : {}),
    ...noteParts('footnote'),
    ...noteParts('endnote'),
    ...(anchored.length
      ? {
          comments: {
            children: anchored.map((c) => {
              const d = c.date ? new Date(c.date) : new Date()
              return {
                id: c.id,
                author: c.author || 'OpenOffices',
                date: Number.isNaN(d.getTime()) ? new Date() : d,
                ...(anyResolved ? { parentId: -1 } : {}),
                ...(c.resolved ? { resolved: true } : {}),
                children: [new Paragraph({ children: [new TextRun(c.text)] })],
              }
            }),
          },
        }
      : {}),
    numbering: { config: [{ reference: ORDERED_REF, levels: ORDERED_LEVELS }, ...lists.config()] },
    // 文档带进来的样式表（v0.102）：快照重建，Normal/内置 id 之外的定义都落回去，
    // 段落上的 w:pStyle 才有处可指——样式表不再在导出这一步被洗掉
    styles: { ...paragraphStylesOf(meta), ...characterStylesOf(meta), ...tableStylesOf(meta) },
    sections: [section],
  })
  // Packer.toBuffer 走 jszip 的 nodebuffer 通道，浏览器里没有 Buffer 会直接抛
  // 「nodebuffer is not supported by this platform」——应用内「导出 docx」一直就是坏的，
  // 只有 Node 侧结构测试能过。base64 两端都支持，解码后照样是同一份 zip 字节。
  const b64 = await Packer.toBase64String(doc)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  // 条件层的闸门（v0.116）：docx 库的 Table 不认 `w:tblLook`（<w:tblPr> 末位那一枚），
  // 只能像 pptx 那边一样打包后回头补；引用了带条件层样式的表才补，别的原样放出
  const looks = new Map<string, string>()
  for (const s of meta?.styles ?? []) {
    const look = tblLookOf(s)
    if (look) looks.set(s.id, look)
  }
  // 潜在样式与 customStyle（v0.146）：两样包都没有槽（latentStyles 整族没有 API，
  // customStyle 被 StyleForParagraph 丢掉——它只把 type/styleId 交给 StyleAttributes），
  // 与 w:tblLook 同路数打包后回头补；表样式的 customStyle 走 tableStyleXml 原始 XML，
  // 这里只补段落/字符两桶。
  // v0.150：同一路数再带上样式身份两枚——next（后续段落样式）与 rsid（修订会话号），
  // 一样是包不发的槽，按 styleId 逐枚补
  const props = new Map<string, StyleExtraProps>()
  for (const s of meta?.styles ?? []) {
    const p: StyleExtraProps = {}
    if (s.customStyle !== undefined && s.kind !== 'table') p.custom = s.customStyle ? '1' : '0'
    if (s.next) p.next = s.next
    if (s.rsid) p.rsid = s.rsid
    if (s.aliases) p.aliases = s.aliases
    // v0.161：主题字体引用名。只有**这一枚样式自己写过**才补——包会把 Normal 的字体
    // 沿 basedOn 链摊到子样式上（写出包里 Report/ReportHead/ReportChar 各有 rFonts 而
    // 源里没有），摊出来的那些不该凭空戴上引用名
    if (s.run?.fontTheme) p.fontTheme = s.run.fontTheme
    if (Object.keys(p).length) props.set(s.id, p)
  }
  const latent = meta?.latentStyles
  // 编号定义账（v0.150）：按 w:abstractNum 出现序贴回 numbering.xml
  const numDefs = meta?.numbering?.defs ?? []
  // v0.178：整条 post-pack 链共用一枚解包会话，末尾只 generate 一次。
  // 各补丁仍取「上一步的 bytes」作参数，但有会话时那个值只是占位——真正的数据在
  // sess.zip 里，串行顺序与原来「打包→解包」的链逐字同义
  const sess: PackSession = {
    zip: await loadZipOf(out),
    touched: false,
    ...(opts?.legacyPartText ? {} : { text: new Map<string, string>() }),
  }
  // v0.182：不等宽分栏的 w:cols/@equalWidth 回填成 onOff 字面（包发 "false"）
  const withCols = await patchColsOnOff(out, sess)
  // 段落属性余量（v0.147）：按出现序贴回各自的 <w:pPr>，与上面两笔同一路数
  const withPara = await patchParaProps(withCols, dt.pprExtras, sess)
  // 下划线主题三枚（v0.159）：按 <w:u> 出现序补属性——包只有 {type,color} 两枚槽
  const withU = await patchElemAttrs(withPara, 'u', dt.uThemes, sess)
  // 文字色主题三枚（v0.160）：按 <w:color> 出现序补——包只写 w:val 一枚
  const withColor = await patchElemAttrs(withU, 'color', dt.colorThemes, sess)
  // v0.184：字面 w:val 原值按同一出现序**改值**回填（包写的是主题解析后的屏上色）；
  // 与上面那笔共用 colorThemes/colorLits 的一一对应闸门，顺序不能反
  const withColorLit = await patchColorLits(withColor, dt.colorLits, sess)
  // 被包吞掉的全大写（v0.161）：按 <w:smallCaps> 出现序在它前面插 <w:caps/>
  const withCaps = await patchBeforeElem(withColorLit, 'smallCaps', dt.capsExtras, sess)
  // 图片容器壳（v0.148）：按 <w:drawing> 出现序逐块改值（包发得出壳，只是值硬编码）
  const withImg = await patchImgXml(withCaps, dt.imgExtras, sess)
  // 表闸门三样都要补：样式推出来的（looks）与表自己带的（dt.tblLooks），
  // v0.152 起再加表级条件格式尺寸两枚（dt.tblPrs，与 tblLook 同住 tblPr）
  const needTbl =
    looks.size ||
    dt.tblLooks.some((x) => x) ||
    dt.tblPrs.some((x) => x) ||
    dt.cellSps.some((x) => x) ||
    dt.cnfStyles.some((x) => x) ||
    dt.tblBorders.some((x) => x)
  // 单元格不换行（v0.152）：包里没有 noWrap 的槽，按 <w:tc> 出现序插 <w:noWrap/>
  const withCell = dt.cellExtras.some((x) => x) ? await patchTcPr(withImg, dt.cellExtras, sess) : withImg
  // 底纹的存盘原件（v0.164）：按 <w:shd> 出现序**合并**属性（包只发 val/color/fill 三枚，
  // 且 fill 写的是解析后的屏上色——源件的字面色与主题三枚都要改回来/补上去）
  const withShd = await patchShdAttrs(withCell, dt.shdExtras, sess)
  // 边框的存盘原件（v0.165）：按块合并属性（pBdr 与 tcBorders 两族，块级标签各自对位）
  const withBdr = await patchBorderBlocks(
    await patchBorderBlocks(withShd, 'w:pBdr', dt.paraBdrs, sess),
    'w:tcBorders',
    dt.cellBdrs,
    sess,
  )
  // 字符边框的主题三枚（v0.166）：<w:bdr> 在 document.xml 里只长在 run 的 rPr 上，
  // 没有同名歧义——所以这一族回到最简单的元素级追加（patchElemAttrs）
  const withRunBdr = await patchElemAttrs(withBdr, 'bdr', dt.bdrExtras, sess)
  // 表行余量（v0.172）：按 <w:tr> 出现序贴 gridAfter/wAfter
  const withRow = await patchTrPr(withRunBdr, dt.rowPrs, sess)
  const withStyles = props.size || latent
    ? await patchStylesXml(withRow, latent, props, sess)
    : withRow
  const withNum = numDefs.length ? await patchNumberingXml(withStyles, numDefs, sess) : withStyles
  const packed = needTbl
    ? await patchTblLook(withNum, looks, dt.tblLooks, dt.tblPrs, dt.cellSps, dt.cnfStyles, dt.tblBorders, sess)
    : withNum
  // 包对 w:pgNumType 是「无条件 push」（SectionProperties 里那行没有 if）——没话说时也发
  // 一枚空元素。源件没写过就不该凭空多这一枚（账本看不见，Word 的文件结构看得见）
  const withPgNum = pg.pageNum ? packed : await dropEmptyPgNum(packed, sess)
  await attachThemePart(withPgNum, meta?.themeXml, sess)
  // v0.178：链上所有改动都落在 sess.zip 里；没改动就原样放回 Packer 的字节，
  // 有改动才 generate 一次。两腿逐部件字符串必须完全一致（scripts/bench-docx-pack.mjs）
  if (!sess.touched) return out
  const buf = (await sess.zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer
  return new Uint8Array(buf)
}

/**
 * styles.xml 的补丁（v0.146，v0.150 扩）：潜在样式容器 + 段落/字符样式的三笔——
 * `w:customStyle`（属性）、`w:next` 与 `w:rsid`（子元素）。
 *
 * latentStyles 按 CT_Stylesheet 的序插在 `</w:docDefaults>` 之后、首个 `<w:style ` 之前
 * （docDefaults → latentStyles → style*，乱序会被 Word 判损坏件）；customStyle 是
 * `w:style` 开标签上的 onOff 属性，按 styleId 找到哪枚补哪枚。两笔共用一次解压/重压。
 *
 * next/rsid 按 CT_Style 的序列插：next 排在 name/aliases/basedOn 之后、link 之前，
 * rsid 排在 personal* 之后、pPr 之前（乱序同样会被 Word 判损坏件）。两枚都只有
 * 「子元素不在场」时才插——在场说明别的工具已经写过，按 styleId 对位即可
 */
/** 逐枚样式要补的余量：都是包不给槽、只能打包后按 styleId 补回去的东西 */
interface StyleExtraProps {
  custom?: string
  next?: string
  rsid?: string
  aliases?: string
  /**
   * 主题字体引用名（v0.161）：写手发的是解析后的具名字体（`w:ascii="Calibri"`），
   * 源件说的是「跟着 minorHAnsi 走」。两者一起写才与源等价——Word 认引用优先
   */
  fontTheme?: { ascii?: string; eastAsia?: string; hAnsi?: string; cs?: string }
}

async function patchStylesXml(
  bytes: Uint8Array,
  latent: DocxLatentStyles | undefined,
  props: Map<string, StyleExtraProps>,
  sess?: PackSession,
): Promise<Uint8Array> {
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/styles.xml')
  if (!file) return bytes
  let xml = await partText(zip, 'word/styles.xml', sess)
  let touched = false
  if (props.size) {
    xml = xml.replace(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g, (all) => {
      const id = /w:styleId="([^"]+)"/.exec(all)?.[1]
      const p = id ? props.get(id) : undefined
      if (!p) return all
      touched = true
      let out = all
      if (p.custom !== undefined) {
        out = out.replace(/^<w:style\b[^>]*>/, (tag) => tag.replace(/>$/, ` w:customStyle="${p.custom}">`))
      }
      // aliases（v0.155）：CT_Style 序上紧跟 name（name → **aliases** → basedOn → next）
      if (p.aliases !== undefined && !/<w:aliases\b/.test(out)) {
        out = insertStyleKid(out, `<w:aliases w:val="${xmlAttr(p.aliases)}"/>`, ['name'])
      }
      // next：CT_Style 序上跟在 name/aliases/basedOn 之后、link 之前
      if (p.next !== undefined && !/<w:next\b/.test(out)) {
        out = insertStyleKid(out, `<w:next w:val="${xmlAttr(p.next)}"/>`, ['name', 'aliases', 'basedOn'])
      }
      // rsid：序上在 personal* 之后、pPr 之前
      if (p.rsid !== undefined && !/<w:rsid\b/.test(out)) {
        out = insertStyleKid(out, `<w:rsid w:val="${xmlAttr(p.rsid)}"/>`, [
          'name', 'aliases', 'basedOn', 'next', 'link', 'autoRedefine', 'hidden', 'uiPriority',
          'semiHidden', 'unhideWhenUsed', 'qFormat', 'locked', 'personal', 'personalCompose', 'personalReply',
        ])
      }
      // 主题字体引用（v0.161）：补进已有那枚 `<w:rFonts>` 的开标签（属性无序，不必讲次位）。
      // 没有 rFonts 就不现开——源件没写具名字体时也确实不会写引用名，凭空造一枚等于
      // 把「继承上一层的字体」改成「钉在这一层」
      if (p.fontTheme) {
        const ft = p.fontTheme
        const add =
          (ft.ascii ? ` w:asciiTheme="${xmlAttr(ft.ascii)}"` : '') +
          (ft.eastAsia ? ` w:eastAsiaTheme="${xmlAttr(ft.eastAsia)}"` : '') +
          (ft.hAnsi ? ` w:hAnsiTheme="${xmlAttr(ft.hAnsi)}"` : '') +
          (ft.cs ? ` w:cstheme="${xmlAttr(ft.cs)}"` : '')
        if (add && /<w:rFonts\b/.test(out)) {
          out = out.replace(/<w:rFonts[^>]*>/, (tag) => (tag.endsWith('/>') ? tag.slice(0, -2) + add + '/>' : tag.slice(0, -1) + add + '>'))
        }
      }
      return out
    })
  }
  if (latent) {
    // 已有 latentStyles 的件（理论上是别的工具后处理过的）不重复插
    if (!xml.includes('<w:latentStyles')) {
      const at = xml.indexOf('<w:style ')
      if (at >= 0) {
        xml = xml.slice(0, at) + latentStylesXml(latent) + xml.slice(at)
        touched = true
      }
    }
  }
  if (!touched) return bytes
  setPart(zip, 'word/styles.xml', xml, sess)
  return finishPatch(bytes, zip, sess)
}

/** `DocxLatentStyles` → `<w:latentStyles>` 整块 XML（含全部 lsdException）；没话说的件给空容器 */
function latentStylesXml(ls: DocxLatentStyles): string {
  const bit = (v: boolean | undefined) => (v === undefined ? undefined : v ? '1' : '0')
  const parts: string[] = []
  if (ls.count !== undefined) parts.push(`w:count="${ls.count}"`)
  if (ls.defUIPriority !== undefined) parts.push(`w:defUIPriority="${ls.defUIPriority}"`)
  for (const [k, v] of [
    ['w:defLockedState', ls.defLockedState],
    ['w:defSemiHidden', ls.defSemiHidden],
    ['w:defUnhideWhenUsed', ls.defUnhideWhenUsed],
    ['w:defQFormat', ls.defQFormat],
  ] as [string, boolean | undefined][]) {
    const b = bit(v)
    if (b !== undefined) parts.push(`${k}="${b}"`)
  }
  let inner = ''
  for (const e of ls.exceptions) {
    inner +=
      `<w:lsdException` +
      (e.name !== undefined ? ` w:name="${xmlAttr(e.name)}"` : '') +
      (e.uiPriority !== undefined ? ` w:uiPriority="${e.uiPriority}"` : '') +
      (bit(e.semiHidden) !== undefined ? ` w:semiHidden="${bit(e.semiHidden)}"` : '') +
      (bit(e.unhideWhenUsed) !== undefined ? ` w:unhideWhenUsed="${bit(e.unhideWhenUsed)}"` : '') +
      (bit(e.qFormat) !== undefined ? ` w:qFormat="${bit(e.qFormat)}"` : '') +
      (bit(e.locked) !== undefined ? ` w:locked="${bit(e.locked)}"` : '') +
      `/>`
  }
  return `<w:latentStyles${parts.length ? ` ${parts.join(' ')}` : ''}>${inner}</w:latentStyles>`
}

/**
 * 一枚 `<w:kid …>` 元素（含自闭合那种）结束的下标；-1 = 块里没有这枚。
 * 名字不认前缀（w:/w15: 都算），属性值里不会有 '>'，所以从开标签往后找第一个就够。
 */
function kidEnd(block: string, kid: string): number {
  const re = new RegExp(`<[\\w:]*${kid}\\b`)
  const m = re.exec(block)
  if (!m) return -1
  const gt = block.indexOf('>', m.index)
  return gt < 0 ? -1 : gt + 1
}

/**
 * 在 `<w:style>` 块里插一枚子元素：插在 after 列表里**最靠后那枚**的元素之后
 * （列表按 CT_Style 的 schema 序给），一枚前置子元素都没有时插在开标签之后。
 * next/rsid 两枚的插入位次靠它落到 schema 序上——乱序写会被 Word 判损坏件。
 * 包写的子元素常是自闭合（`<w:name w:val="a"/>`），所以锚点认元素结束而不是闭标签。
 */
function insertStyleKid(block: string, frag: string, after: string[]): string {
  let at = -1
  for (const k of after) {
    const i = kidEnd(block, k)
    if (i >= 0) at = Math.max(at, i)
  }
  if (at < 0) {
    const m = /^<w:style\b[^>]*>/.exec(block)
    if (!m) return block
    at = m[0].length
  }
  return block.slice(0, at) + frag + block.slice(at)
}

/** 块内第一个出现的 `<w:kid…` 的下标（-1 = 一枚都没有） */
function firstIndexOf(block: string, kids: string[]): number {
  let at = -1
  for (const k of kids) {
    const i = block.indexOf(`<w:${k}`)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  return at
}

/** 在开标签上设一枚属性：先试替换同名（**按 local name**——包里 tentative 写成 w15:tentative，
 * 前缀与我们的 w: 不同，照全名匹配会补出第二枚），无则追加。调用方给的 tag 可能不含结尾
 * '>'（lvl 那枚是切片出来的），所以追加走「有 > 替换、没有就尾接」两条路 */
function setTagAttr(tag: string, name: string, value: string): string {
  const bare = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
  const frag = ` ${name}="${value}"`
  const re = new RegExp(`\\s[\\w:]*${bare}="[^"]*"`)
  if (re.test(tag)) return tag.replace(re, frag)
  return tag.endsWith('>') ? tag.replace(/>$/, frag) : tag + frag
}

/** `setTagAttr` 的**保前缀**变体：按 local name 找到那枚就换值不换前缀（w15: 还是 w15:），
 * 找不到才按调用方给的名追加。用于 restartNumberingAfterBreak——OOXML 里它定义在 w15
 * 命名空间，Word 与 docx 库发的都是 w15:，替换成 w: 会写出不在 schema 上的属性 */
function setTagAttrKeepPrefix(tag: string, name: string, value: string): string {
  const bare = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
  const re = new RegExp(`\\s([\\w:]*?)${bare}="[^"]*"`)
  const m = re.exec(tag)
  if (m) return tag.replace(re, ` ${m[1]}${bare}="${value}"`)
  const frag = ` ${name}="${value}"`
  return tag.endsWith('>') ? tag.replace(/>$/, frag) : tag + frag
}

/**
 * 编号定义账（v0.150）：nsid/tmpl/multiLevelType 与逐层 tentative/tplc/suff 贴回
 * numbering.xml。包的编号 id 是自己发的（ListRegistry 按段引用重建，numId/abstractNumId
 * 与原文未必同号），所以对位走**内容指纹**：每条 def 带一份层的 `numFmt|lvlText` 序列
 * （读手顺手记下），包里逐枚 abstractNum 抽同一份指纹，按 defs 顺序一对一配。指纹
 * 对不上就跳过那一条（宁可不补，也绝不补到别的定义上）——默认的两枚 bullet/ordered
 * 定义两边内容不同（包写 ●/○/■，Word 写自己的），本来就不该乱贴。
 *
 * 插入位次都按 schema 序：三枚身份属性排在 name/styleLink/numStyleLink/lvl 之前
 * （nsid → multiLevelType → tmpl）；suff 排在 lvlText 之前。乱序写会被 Word 判损坏件。
 */
async function patchNumberingXml(bytes: Uint8Array, defs: DocxAbstractNumMeta[], sess?: PackSession): Promise<Uint8Array> {
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/numbering.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/numbering.xml', sess)
  const blocks = xml.match(/<w:abstractNum\b[^>]*>[\s\S]*?<\/w:abstractNum>/g)
  if (!blocks || !blocks.length) return bytes
  // 包内每枚的层序列（按 ilvl 序的 `numFmt|lvlText`）→ 块下标
  const fps = blocks.map(numLvlSeqOf)
  const used = new Set<number>()
  // defs 顺序 → 命中的块下标（-1 = 没配上）
  const pick: number[] = []
  for (const d of defs) {
    // 包的定义层数常比原文多（内置九层 vs 原文两层），所以比的是「原文每一层在包的开头
    // 都对得上」——前缀匹配而不是全等
    const want = d.fp.split(';').filter(Boolean)
    let at = -1
    for (let i = 0; i < fps.length; i++) {
      if (used.has(i)) continue
      const got = fps[i]
      if (got.length < want.length) continue
      if (want.every((w, j) => w === got[j])) { at = i; break }
    }
    if (at >= 0) used.add(at)
    pick.push(at)
  }
  if (pick.every((x) => x < 0)) return bytes
  let out = ''
  let cursor = 0
  let touched = false
  for (let i = 0; i < blocks.length; i++) {
    const at = xml.indexOf(blocks[i], cursor)
    if (at < 0) return bytes
    const di = pick.indexOf(i)
    const patched = di >= 0 ? patchOneAbstractNum(blocks[i], defs[di]) : blocks[i]
    if (patched !== blocks[i]) touched = true
    out += xml.slice(cursor, at) + patched
    cursor = at + blocks[i].length
  }
  out += xml.slice(cursor)
  if (!touched) return bytes
  setPart(zip, 'word/numbering.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}

/** 一枚 `<w:abstractNum>` 块 → 层序列：按 ilvl 序的 `ilvl:numFmt|lvlText` */
function numLvlSeqOf(block: string): string[] {
  const lvls = [...block.matchAll(/<w:lvl\b[^>]*\b[\w:]*ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)]
  return lvls.map((m) => {
    const fmt = /<w:numFmt\b[^>]*\sw:val="([^"]*)"/.exec(m[2])?.[1] ?? ''
    const text = /<w:lvlText\b[^>]*\sw:val="([^"]*)"/.exec(m[2])?.[1] ?? ''
    return `${m[1]}:${fmt}|${text}`
  })
}

function patchOneAbstractNum(block: string, d: DocxAbstractNumMeta): string {
  let out = block
  // 分页后重新编号总闸（v0.152）：开标签上的属性（与下面三枚子元素正相反的一枚）。
  // **保留原前缀**——OOXML 里 restartNumberingAfterBreak 定义在 w15 命名空间
  // （CT_AbstractNum 的扩展属性），Word 与 docx 库发的都是 w15:，照 w: 全名替换会
  // 写出一枚不在 schema 上的属性（判损坏件风险）。包里对所有定义恒发这一枚，
  // 故实际走的都是「按 local name 认出来、换值不换前缀」这条路径
  if (d.rna !== undefined) {
    const openEnd = out.indexOf('>')
    if (openEnd > 0) {
      out =
        setTagAttrKeepPrefix(out.slice(0, openEnd), 'w15:restartNumberingAfterBreak', d.rna ? '1' : '0') +
        out.slice(openEnd)
    }
  }
  // 三枚身份属性：CT_AbstractNum 序 nsid → multiLevelType → tmpl → name → …
  // 前缀一律不认（w: 只是最常见那个，w15: 同族也放过）。插入锚点取「schema 序里排
  // 在自己之后的第一个在场元素」——包可能自带 multiLevelType（docx 库对所有定义都发），
  // 那时 nsid 要插到它前面而不是后面，否则整块乱序会被 Word 判损坏件
  const ORDER = ['nsid', 'multiLevelType', 'tmpl', 'name', 'styleLink', 'numStyleLink', 'lvl']
  for (const [el, v] of [
    ['nsid', d.nsid],
    ['multiLevelType', d.multiLevelType],
    ['tmpl', d.tmpl],
    ['styleLink', d.styleLink],
  ] as [string, string | undefined][]) {
    if (v === undefined) continue
    if (new RegExp(`<[\\w:]*${el}\\b`).test(out)) {
      out = out.replace(new RegExp(`(<[\\w:]*${el}\\b[^>]*?\\sw:val=")[^"]*(")`), `$1${xmlAttr(v)}$2`)
    } else {
      const anchor = firstIndexOf(out, ORDER.slice(ORDER.indexOf(el) + 1))
      const frag = `<w:${el} w:val="${xmlAttr(v)}"/>`
      out =
        anchor >= 0
          ? out.slice(0, anchor) + frag + out.slice(anchor)
          : out.replace('</w:abstractNum>', `${frag}</w:abstractNum>`)
    }
  }
  // 逐层三枚：tentative/tplc 是 `<w:lvl>` 开标签上的属性，suff 是子元素
  for (const [ilvl, m] of Object.entries(d.levels)) {
    const at = out.search(new RegExp(`<w:lvl\\b[^>]*\\b[\\w:]*ilvl="${ilvl}"[^>]*>`))
    if (at < 0) continue
    const end = out.indexOf('</w:lvl>', at)
    if (end < 0) continue
    const closeLen = '</w:lvl>'.length
    const lvl = out.slice(at, end + closeLen)
    const tagEnd = lvl.indexOf('>')
    let tag = lvl.slice(0, tagEnd)
    let inner = lvl.slice(tagEnd)
    if (m.tentative !== undefined) tag = setTagAttr(tag, 'w:tentative', m.tentative ? '1' : '0')
    if (m.tplc !== undefined) tag = setTagAttr(tag, 'w:tplc', xmlAttr(m.tplc))
    // 层子元素按 CT_Lvl 的序插（v0.155）：start → numFmt → **lvlRestart** → pStyle →
    // isLgl → suff → lvlText → **lvlPicBulletId** → legacy → lvlJc → pPr → rPr。
    // 锚点表写的是「schema 序里排在自己之后的第一个在场元素」——与自己之前的东西无关，
    // 所以三枚可以各自独立成表（不像表级那一族要分居 tblW 两侧，见 v0.154 那次教训）
    const insertKid = (frag: string, anchors: string[]): void => {
      const at2 = firstIndexOf(inner, anchors)
      inner = at2 >= 0 ? inner.slice(0, at2) + frag + inner.slice(at2) : inner.replace('</w:lvl>', `${frag}</w:lvl>`)
    }
    if (m.restart !== undefined) {
      if (/<[\w:]*lvlRestart\b/.test(inner)) {
        inner = inner.replace(/(<[\w:]*lvlRestart\b[^>]*?\sw:val=")[^"]*(")/, `$1${m.restart}$2`)
      } else {
        insertKid(`<w:lvlRestart w:val="${m.restart}"/>`, [
          'pStyle', 'isLgl', 'suff', 'lvlText', 'lvlPicBulletId', 'legacy', 'lvlJc', 'pPr', 'rPr',
        ])
      }
    }
    if (m.picBulletId !== undefined) {
      if (/<[\w:]*lvlPicBulletId\b/.test(inner)) {
        inner = inner.replace(/(<[\w:]*lvlPicBulletId\b[^>]*?\sw:val=")[^"]*(")/, `$1${m.picBulletId}$2`)
      } else {
        insertKid(`<w:lvlPicBulletId w:val="${m.picBulletId}"/>`, ['legacy', 'lvlJc', 'pPr', 'rPr'])
      }
    }
    if (m.suff !== undefined) {
      if (/<[\w:]*suff\b/.test(inner)) {
        inner = inner.replace(/(<[\w:]*suff\b[^>]*?\sw:val=")[^"]*(")/, `$1${xmlAttr(m.suff)}$2`)
      } else {
        // CT_Lvl 序：suff 在 lvlText 之前
        insertKid(`<w:suff w:val="${xmlAttr(m.suff)}"/>`, ['lvlText', 'lvlPicBulletId', 'legacy', 'lvlJc', 'pPr', 'rPr'])
      }
    }
    // v0.184：w:lvlJc 包恒发（默认 start），所以是「按 ilvl 改值」不是插元素——
    // 与 suff / lvlPicBulletId 同一条现成分支。源件里 center 那一层此前被冲成 start
    if (m.lvlJc) {
      const frag = `<w:lvlJc w:val="${xmlAttr(m.lvlJc)}"/>`
      if (/<[\w:]*lvlJc\b/.test(inner)) {
        inner = inner.replace(/(<[\w:]*lvlJc\b[^>]*?\sw:val=")[^"]*(")/, `$1${xmlAttr(m.lvlJc)}$2`)
      } else {
        insertKid(frag, ['pPr', 'rPr'])
      }
    }
    // v0.183：Word 2003 老式编号缩进补偿三枚。包不发 w:legacy，按 CT_Lvl 序
    // 插在 lvlJc / pPr / rPr 中第一枚在场者之前（锚点表与 restart/picBulletId/suff 同源）。
    // 三枚都是字面值原样回填，不做 onOff 归一——源件写 1/0 就还它 1/0
    if (m.legacy) {
      const lg = [
        m.legacy.legacy !== undefined ? ` w:legacy="${xmlAttr(m.legacy.legacy)}"` : '',
        m.legacy.space !== undefined ? ` w:legacySpace="${xmlAttr(m.legacy.space)}"` : '',
        m.legacy.indent !== undefined ? ` w:legacyIndent="${xmlAttr(m.legacy.indent)}"` : '',
      ].join('')
      const frag = `<w:legacy${lg}/>`
      if (/<[\w:]*legacy\b[^>]*\/>/.test(inner)) inner = inner.replace(/<[\w:]*legacy\b[^>]*\/>/, frag)
      else insertKid(frag, ['lvlJc', 'pPr', 'rPr'])
    }
    out = out.slice(0, at) + tag + inner + out.slice(end + closeLen)
  }
  return out
}

/**
 * 表样式 → 引用它的表上那枚 `<w:tblLook>`（v0.116）。
 *
 * 这一枚是条件层的总闸：Word 先按它决定某一型要不要落，再去样式表里找那一块。
 * 缺席那档的默认（读侧 tblLookOn 量过）是「首行首列开、末行末列关」，我们不赌这个默认——
 * 凡是用到的部位都显式写 1、没用到的显式写 0，等同于在 Word 里逐项勾选/取消勾选。
 * 四个角落在 `w:tblLook` 上没有自己的位，它要的是所在行列那两位同时开着。
 */
function tblLookOf(s: DocxStyleInfo): string | undefined {
  const c = s.table?.cond
  const lk = s.table?.look
  if ((!c || !Object.keys(c).length) && !lk) return undefined
  // 四位闸门走 table-cond 的 condLookBits：odt 出口没处存闸门，只能按同一规则再推一次，
  // 两边共用这一枚函数才不会推出两个结果。有原文那枚 w:val 时以它为准（v0.147）——
  // 它才是 Word 自己存的那份，反推只是同一规则的再推一次；ST_ShortHexNumber 的
  // 低四位依次是 firstRow/lastRow/firstColumn/lastColumn
  const look = condLookBits(c ?? {})
  const v = lk?.val ? Number.parseInt(lk.val, 16) : Number.NaN
  const bits = Number.isFinite(v)
    ? { firstRow: !!(v & 0x1), lastRow: !!(v & 0x2), firstColumn: !!(v & 0x4), lastColumn: !!(v & 0x8) }
    : look
  const has = (...ts: TableCondType[]) => ts.some((t) => c?.[t])
  const bit = (b: boolean) => (b ? '1' : '0')
  // 两枚 no*Band：原文说了按原文，没说才从条件层反推（有隔行带就套、没有就不套）
  const nh = lk?.noHBand !== undefined ? lk.noHBand : !has('band1Horz', 'band2Horz')
  const nv = lk?.noVBand !== undefined ? lk.noVBand : !has('band1Vert', 'band2Vert')
  return (
    `<w:tblLook` +
    (lk?.val ? ` w:val="${lk.val}"` : '') +
    ` w:firstRow="${bit(bits.firstRow)}"` +
    ` w:lastRow="${bit(bits.lastRow)}"` +
    ` w:firstColumn="${bit(bits.firstColumn)}"` +
    ` w:lastColumn="${bit(bits.lastColumn)}"` +
    ` w:noHBand="${bit(nh)}"` +
    ` w:noVBand="${bit(nv)}"` +
    `/>`
  )
}

/**
 * 段落属性余量 → 待补的 XML 串（v0.147）。按 CT_PPrBase 的 schema 序排好——`w:pPr`
 * 是有序序列，乱序写会被 Word 判损坏件（与 latentStyles 插 styles.xml 同一条纪律）。
 * 九枚里只有 textAlignment 是枚举档，其余是 onOff 的 '1'/'0'。
 */
const PPR_WRITE_ORDER = [
  'suppressLineNumbers',
  // 自动断字总闸（v0.155）：CT_PPrBase 里排在 suppressLineNumbers 之后、kinsoku 之前
  'suppressAutoHyphens',
  // v0.155：禁则三枚与文字方向。CT_PPrBase 里 kinsoku/wordWrap/overflowPunct 三枚
  // 排在 topLinePunct **之前**、suppressAutoHyphens 之后；textDirection 排在 jc 之后
  'kinsoku',
  'wordWrap',
  'overflowPunct',
  'topLinePunct',
  'autoSpaceDE',
  'autoSpaceDN',
  'bidi',
  'adjustRightInd',
  'snapToGrid',
  // 文字方向（v0.155）：CT_PPrBase 里排在 jc 之后、textAlignment 之前
  'textDirection',
  'textAlignment',
] as const

/** `w:pPr` 各子元素的 schema 位次（只列会碰到的；未知元素不参与比较） */
const PPR_RANK: Record<string, number> = {
  pStyle: 10,
  keepNext: 11,
  keepLines: 12,
  pageBreakBefore: 13,
  framePr: 14,
  widowControl: 15,
  numPr: 16,
  suppressLineNumbers: 17,
  pBdr: 18,
  shd: 19,
  tabs: 20,
  suppressAutoHyphens: 21,
  kinsoku: 22,
  wordWrap: 23,
  overflowPunct: 24,
  topLinePunct: 25,
  autoSpaceDE: 26,
  autoSpaceDN: 27,
  bidi: 28,
  adjustRightInd: 29,
  snapToGrid: 30,
  spacing: 31,
  ind: 32,
  contextualSpacing: 33,
  mirrorIndents: 34,
  suppressOverlap: 35,
  jc: 36,
  textDirection: 37,
  textAlignment: 38,
  textboxTightWrap: 39,
  outlineLvl: 40,
  divId: 41,
  cnfStyle: 42,
  rPr: 43,
  sectPr: 44,
  pPrChange: 45,
}

/** 段落节点的 data-ppr 载荷 → 余量 XML（没有可补的给空串）。属性值走 xmlAttr 转义 */
function pprExtraXml(node: PMNode | undefined): string {
  const raw = typeof node?.attrs?.ppr === 'string' ? node.attrs.ppr : ''
  const kv = parsePprPayload(raw)
  const bits: string[] = []
  // v0.160：缩进的字符档两枚在同一枚 `<w:ind>` 上（不是各开一个元素——CT_PPrBase 里
  // w:ind 是单枚，两枚并存时 Word 只认后写的那一枚）。载荷键带 ind 前缀，与下面那批
  // 「一枚属性一个元素」的键分开走。回写的是**原始整数**（百分之一字符数），不做缇↔字符
  // 的折算：折一次就对不上 Word 缩进对话框里那一栏的整数了
  const indAttrs = PPR_IND_KEYS.map((k) => [k, kv[`ind${k[0].toUpperCase()}${k.slice(1)}`]] as const)
    .filter(([, v]) => v !== undefined && v !== '' && /^-?\d+$/.test(v))
    .map(([k, v]) => ` w:${k}="${v}"`)
    .join('')
  if (indAttrs) bits.push(`<w:ind${indAttrs}/>`)
  for (const k of PPR_WRITE_ORDER) {
    const v = kv[k]
    if (v === undefined || v === '') continue
    bits.push(`<w:${k} w:val="${xmlAttr(v)}"/>`)
  }
  return bits.join('')
}

/**
 * 给每个 `<w:pPr>` 补段落属性余量（v0.147）：按**出现序**贴——第 i 段贴 `extras[i]`。
 *
 * 包对这一族没有槽（只有 autoSpaceDN 一枚，且它把 onOff 写成裸元素，带不出 w:val 的
 * 「显式关」），与 w:tblLook 同一路数打包后回头补。段落没有 tblStyle 那种天然键，
 * 只能按序；序会不会错由**计数闸门**兜底：document.xml 里 `<w:p>` 的枚数与走查时
 * 登记的条目数对不上就整笔放弃（宁可不补，也绝不补到别的段落上）。
 */
async function patchParaProps(bytes: Uint8Array, extras: string[], sess?: PackSession): Promise<Uint8Array> {
  if (!extras.some((x) => x)) return bytes
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  // 自闭合的 `<w:p/>` 也算一段（空的段、只有分页符的段都可能写成这样）
  const opens = [...xml.matchAll(/<w:p(?:\s[^>]*)?\/?>/g)]
  if (opens.length !== extras.length) return bytes
  let out = ''
  let cursor = 0
  let touched = false
  for (let i = 0; i < opens.length; i++) {
    const m = opens[i]
    const start = m.index ?? 0
    const selfClosed = m[0].endsWith('/>')
    const closeAt = selfClosed ? -1 : xml.indexOf('</w:p>', start)
    if (!selfClosed && closeAt < 0) return bytes
    const stop = selfClosed ? start + m[0].length : closeAt + '</w:p>'.length
    if (!extras[i]) {
      out += xml.slice(cursor, stop)
      cursor = stop
      continue
    }
    out += xml.slice(cursor, start) + pprInsert(xml.slice(start, stop), extras[i])
    cursor = stop
    touched = true
  }
  if (!touched) return bytes
  out += xml.slice(cursor)
  setPart(zip, 'word/document.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}

/**
 * 给 document.xml 里每个 `<w:{tag}>` 补属性串（v0.159 建、v0.160 泛化）：按**出现序**
 * 贴——第 i 枚贴 `extras[i]`。
 *
 * 为什么要有这一层：docx 包的一批元素只认自己那两三枚属性（`createUnderline` 只写
 * w:val 与 w:color，`createColor` 只写 w:val），`w:themeColor / w:themeTint /
 * w:themeShade` 这一族在包外。与 w:sym 一起是同一笔机制债——sym 那一半包里有原生
 * SymbolRun，这一半没有，于是只能走打包后的 run 级补丁位。
 *
 * 泛化到「任意元素名」是同一个形状的第二处需求（w:u 与 w:color 各带各的三枚）：
 * 两族的登记数组分开、各按自己的元素出现序对位，所以不是合并成一串而是开两个 tag。
 *
 * 对位靠**计数闸门**：document.xml 里 `<w:{tag}` 的枚数与登记条数对不上就整笔放弃
 * （宁可不补，也绝不补到别的 run 上）。匹配用 `(?=[\s/>])` 收边，免得把
 * `w:unhideWhenUsed`、`w:uiPriority` 这些同前缀的元素算进来。
 *
 * 只扫 document.xml：样式表里的同名元素（我们自己拼的表样式 rPr）不在这一族的账上，
 * 而 run 级补丁位管的就是正文里那一枚。脚注/批注的正文在我们的写手里走简单文本
 * （不带 charExtra），不会登记进这一族，所以计数是对得上的
 */
/**
 * v0.182：包的 `IColumnsAttributes.equalWidth` 是 boolean，序列化成
 * `w:equalWidth="false"`；而 OOXML 的 ST_OnOff 字面是 `"0"/"1"`，源件写 `"0"`。
 * 与 v0.179 的 `FLAT/flat` 同款：只让包发壳，字面由 post-pack 按源件回填。
 * 只动 `<w:cols>` 开标签上的这一枚值；幂等（第二趟已经没有 "false" 可换）。
 */
async function patchColsOnOff(bytes: Uint8Array, sess?: PackSession): Promise<Uint8Array> {
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  const out = xml.replace(
    /(<w:cols\b[^>]*\bw:equalWidth=")false(")/g,
    (_m: string, a: string, b: string) => `${a}0${b}`,
  )
  if (out === xml) return bytes
  setPart(zip, 'word/document.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}

async function patchElemAttrs(bytes: Uint8Array, tag: string, extras: string[], sess?: PackSession): Promise<Uint8Array> {
  if (!extras.some((x) => x)) return bytes
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  const opens = [...xml.matchAll(new RegExp(`<w:${tag}(?=[\\s/>])[^>]*>`, 'g'))]
  if (opens.length !== extras.length) return bytes
  let out = ''
  let cursor = 0
  let touched = false
  for (let i = 0; i < opens.length; i++) {
    const m = opens[i]
    const start = m.index ?? 0
    const stop = start + m[0].length
    const add = extras[i]
    if (!add) {
      out += xml.slice(cursor, stop)
      cursor = stop
      continue
    }
    // 属性追加在 `/>` 之前（自闭合）或最后那个 `>` 之前——XML 属性无序，不必讲次位
    const tag = m[0]
    const at = tag.endsWith('/>') ? tag.length - 2 : tag.length - 1
    out += xml.slice(cursor, start) + tag.slice(0, at) + add + tag.slice(at)
    cursor = stop
    touched = true
  }
  if (!touched) return bytes
  out += xml.slice(cursor)
  setPart(zip, 'word/document.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}

/**
 * 按出现序在锚点元素**前面**插一整枚元素（v0.161）：第 i 个 `<w:anchor>` 之前插
 * `extras[i]`（空串 = 这一处不用插）。
 *
 * 与 patchElemAttrs 的差别是**动作**：那一族是「属性补进已有元素的开标签」，这一族是
 * 「元素补进已有父的子女位」。两族共用同一套对位纪律（出现序 + 计数闸门），但动作不同，
 * 所以不合并——合并就得在一个函数里同时参数化「插哪」与「插什么」，读起来更费劲。
 *
 * 插在前面而不是后面，是因为 CT_RPrBase 这类 sequence 有次位要求：`<w:caps>` 排在
 * `<w:smallCaps>` 之前，反了就是 Word 认不得的 rPr。
 */
async function patchBeforeElem(bytes: Uint8Array, anchor: string, extras: string[], sess?: PackSession): Promise<Uint8Array> {
  if (!extras.some((x) => x)) return bytes
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  const opens = [...xml.matchAll(new RegExp(`<w:${anchor}(?=[\\s/>])[^>]*>`, 'g'))]
  if (opens.length !== extras.length) return bytes
  let out = ''
  let cursor = 0
  let touched = false
  for (let i = 0; i < opens.length; i++) {
    const start = opens[i].index ?? 0
    const add = extras[i]
    if (!add) continue
    out += xml.slice(cursor, start) + add
    cursor = start
    touched = true
  }
  if (!touched) return bytes
  out += xml.slice(cursor)
  setPart(zip, 'word/document.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}

/**
 * 开标签 + `w:xxx="…"` 串 → 同名改值、缺的追加（v0.165 从 patchShdAttrs 抽出）。
 *
 * 这是「包自己会发这一枚属性」时的唯一动作：追加会造出第二枚同名属性 = 非法 XML，
 * 而计数闸门不会替你发现。凡是要覆盖包里那个解析后的值，都得走这里。
 */
function mergeTagAttrs(tag: string, add: string): string {
  let out = tag
  // 属性串允许不带前导空格：匹配与追加都靠 `\sw:` 那一枚空白收边，而拼串的人很容易
  // 只在第二枚起才记得加空格（v0.165 踩过：第一枚 w:color 被整条跳过，themeColor 一族
  // 照贴不误——补丁「跑成功了一半」，账上只剩一笔没说法的值变）
  for (const am of ` ${add}`.matchAll(/\sw:([A-Za-z]+)="([^"]*)"/g)) {
    const re = new RegExp(`(\\sw:${am[1]}=)"[^"]*"`)
    out = re.test(out)
      ? out.replace(re, (_all, head: string) => `${head}"${am[2]}"`)
      : out.replace(/(\s*\/?>)$/, (_all, tail: string) => `${am[0]}${tail}`)
  }
  return out
}

/**
 * 给 document.xml 里每个 `<w:color>` 回填源件的字面 `w:val`（v0.184）。
 *
 * 与 `patchElemAttrs('color', ...)`（只追加主题三枚）不同：`w:val` 包自己会发，
 * 而且发的是主题解析后的屏上色（源 FF0000 → 写出 ADBBD4）。追加会造出第二枚
 * 同名属性 = 非法 XML，必须走 `mergeTagAttrs` **同名改值**。
 * 计数闸门与 `colorThemes` 共用（两者同一次登记、一一对应）；空串 = 用户后来改过色
 * 或源件没写字面值，这一枚不动。
 */
async function patchColorLits(bytes: Uint8Array, extras: string[], sess?: PackSession): Promise<Uint8Array> {
  if (!extras.some((x) => x)) return bytes
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  const opens = [...xml.matchAll(/<w:color(?=[\s/>])[^>]*>/g)]
  if (opens.length !== extras.length) return bytes
  let out = ''
  let cursor = 0
  let touched = false
  for (let i = 0; i < opens.length; i++) {
    const m = opens[i]
    const start = m.index ?? 0
    const stop = start + m[0].length
    const add = extras[i]
    if (!add) {
      out += xml.slice(cursor, stop)
      cursor = stop
      continue
    }
    out += xml.slice(cursor, start) + mergeTagAttrs(m[0], add)
    cursor = stop
    touched = true
  }
  if (!touched) return bytes
  out += xml.slice(cursor)
  setPart(zip, 'word/document.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}

/**
 * 给 document.xml 里每个 `<w:shd>` 合并属性（v0.164）：按**出现序**贴——第 i 枚合
 * `extras[i]`（空串 = 这一枚不动）。
 *
 * 与 patchElemAttrs 的差别是**动作**：那一族只追加（包压根不发那几枚），这一族要
 * **改值**——包的 createShading 会写 `w:fill`，而它写的是解析后的屏上色，源件的字面
 * fill 与之不同。同名的追加会造出第二枚 `w:fill`（非法 XML），所以这里先改后加。
 *
 * `w:shd` 在 CT_PPrBase 与 CT_TcPrBase 里都是单枚元素，所以「合并」而不是「再插一枚」
 * 是硬要求（v0.160 的 `<w:ind>` 同一条纪律）。计数闸门同前：条数对不上就整笔放弃。
 */
async function patchShdAttrs(bytes: Uint8Array, extras: string[], sess?: PackSession): Promise<Uint8Array> {
  if (!extras.some((x) => x)) return bytes
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  const opens = [...xml.matchAll(/<w:shd(?=[\s/>])[^>]*>/g)]
  if (opens.length !== extras.length) return bytes
  let out = ''
  let cursor = 0
  let touched = false
  for (let i = 0; i < opens.length; i++) {
    const m = opens[i]
    const start = m.index ?? 0
    const stop = start + m[0].length
    const add = extras[i]
    if (!add) {
      out += xml.slice(cursor, stop)
      cursor = stop
      continue
    }
    let tag = m[0]
    tag = mergeTagAttrs(tag, add)
    out += xml.slice(cursor, start) + tag
    cursor = stop
    touched = true
  }
  if (!touched) return bytes
  out += xml.slice(cursor)
  setPart(zip, 'word/document.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}

/**
 * 给每个 `<w:pBdr>` / `<w:tcBorders>` **块**里的单边元素合并属性（v0.165）。
 *
 * 为什么按块而不按 `<w:top>` 的出现序：`w:top` 在这份 XML 里同时长在
 * `w:tblBorders`、`w:tcBorders`、`w:pBdr`（还有 `w:tcMar` 那一族同名元素）上，
 * 一个全局出现序根本分不清哪一枚属于谁。块级标签是唯一的，块内再按边名找就没有歧义。
 *
 * 计数闸门比前几族更严：**块数对不上就整笔放弃**。登记只在「真发得出这个块」时
 * 才 push（见 paraFormatOf / 表格那一趟），多一条少一条都说明两边看的世界不一样。
 *
 * extras[i] 的形状：`edge|<属性串>` 用 `;` 连，属性串即 `w:color="…" w:themeColor="…"`。
 * 包会自己发 `w:color`（写的是解析后的屏上色），所以这一族同样是**改名不追加**。
 */
async function patchBorderBlocks(bytes: Uint8Array, tag: 'w:pBdr' | 'w:tcBorders', extras: string[], sess?: PackSession): Promise<Uint8Array> {
  if (!extras.some((x) => x)) return bytes
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  const blocks = [...xml.matchAll(new RegExp(`<${tag}(?=[\\s/>])[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g'))]
  if (blocks.length !== extras.length) return bytes
  let out = ''
  let cursor = 0
  let touched = false
  for (let i = 0; i < blocks.length; i++) {
    const m = blocks[i]
    const start = m.index ?? 0
    const stop = start + m[0].length
    const add = extras[i]
    if (!add) {
      out += xml.slice(cursor, stop)
      cursor = stop
      continue
    }
    let block = m[0]
    for (const chunk of add.split(';')) {
      const bar = chunk.indexOf('|')
      if (bar < 0) continue
      const edge = chunk.slice(0, bar)
      const attrs = chunk.slice(bar + 1)
      // 第五边（v0.167）：写手没有它的槽，块里不会有——要**插**一枚。
      // CT_PBdr 的序是 top → left → bottom → right → **between** → bar，
      // 所以插在 `<w:bar>` 之前；没有 bar 就落在块尾
      if (edge === 'between') {
        if (tag === 'w:pBdr' && !/<w:between(?=[\s/>])/.test(block)) {
          block = block.includes('<w:bar')
            ? block.replace(/<w:bar(?=[\s/>])/, `<w:between ${attrs}/><w:bar`)
            : block.replace('</w:pBdr>', `<w:between ${attrs}/></w:pBdr>`)
        }
        continue
      }
      // 第六条边（v0.168）：CT_PBdr 的序里它排在 between 之后、块尾
      if (edge === 'bar') {
        if (tag === 'w:pBdr' && !/<w:bar(?=[\s/>])/.test(block)) {
          block = block.replace('</w:pBdr>', `<w:bar ${attrs}/></w:pBdr>`)
        }
        continue
      }
      const edgeRe = new RegExp(`<w:${edge}(?=[\\s/>])[^>]*>`)
      // 块里没有这条边 = 写侧没发它（用户删了这一边），不是错位，跳过
      if (!edgeRe.test(block)) continue
      block = block.replace(edgeRe, (t) => mergeTagAttrs(t, attrs))
    }
    out += xml.slice(cursor, start) + block
    cursor = stop
    touched = true
  }
  if (!touched) return bytes
  out += xml.slice(cursor)
  setPart(zip, 'word/document.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}

/**
 * 摘掉包里那枚**空**的 `<w:pgNumType/>`（v0.170）。
 *
 * 包的 SectionProperties 构造器无条件 push 这一枚（`this.root.push(createPageNumberType(pageNumbers))`），
 * 没给 pageNumbers 时照样落一个空元素。Word 读它等于「全是默认」，渲染没差别，但那是
 * 源件没说过的一句话——我们的口径是「没写就别发」。只在有属性时才留。
 */
async function dropEmptyPgNum(bytes: Uint8Array, sess?: PackSession): Promise<Uint8Array> {
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  const out = xml.replace(/<w:pgNumType(?:\s*\/>|>\s*<\/w:pgNumType>)/g, '')
  if (out === xml) return bytes
  setPart(zip, 'word/document.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}

/**
 * 把源件的主题件带进写出包（v0.164）。
 *
 * 为什么必须带：写手会照原样发 `w:themeColor / w:themeFill / w:asciiTheme` 这一族引用
 * （v0.150 起的表级边框、v0.159 的 w:u、v0.160 的 w:color、v0.161 的样式主题字体），
 * 而 docx 包的成品里**根本没有 word/theme/theme1.xml**——引用全部悬空，Word 只能拿
 * 自己的默认主题去解析：用户那套 accent 色在导出后集体变了色，而屏上是对的。
 * 这一枚不是「补一个槽」，是给已经写出去的引用补上它们指着的东西。
 *
 * 三件事缺一不可：部件本体、`document.xml.rels` 里的关系、`[Content_Types].xml`
 * 里的 Override。少任一件 Word 都会报包损坏。
 */
async function attachThemePart(bytes: Uint8Array, themeXml?: string, sess?: PackSession): Promise<Uint8Array> {
  if (!themeXml) return bytes
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const THEME = 'word/theme/theme1.xml'
  if (await zip.file(THEME)?.async('string') === themeXml) return bytes
  zip.file(THEME, themeXml)
  const ct = await zip.file('[Content_Types].xml')?.async('string')
  if (ct && !ct.includes('/word/theme/theme1.xml')) {
    zip.file(
      '[Content_Types].xml',
      ct.replace(
        '</Types>',
        '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>',
      ),
    )
  }
  const relsPath = 'word/_rels/document.xml.rels'
  const rels = await zip.file(relsPath)?.async('string')
  if (rels && !rels.includes('/relationships/theme')) {
    // 关系 id 不能与已有的撞：数一遍 rId 取下一个空号（包自己的编号从 rId1 起）
    const used = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]))
    let n = 1
    while (used.has(`rIdTheme${n}`)) n++
    const rel = `<Relationship Id="rIdTheme${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`
    zip.file(
      relsPath,
      rels.includes('</Relationships>')
        ? rels.replace('</Relationships>', `${rel}</Relationships>`)
        : rels.replace(/<Relationships([^>]*)\/>/, `<Relationships$1>${rel}</Relationships>`),
    )
  }
  return finishPatch(bytes, zip, sess)
}

/** 一段 `<w:p>…</w:p>` → 补过 `<w:pPr>` 的那一段（没有 pPr 就现开一枚） */
function pprInsert(chunk: string, extra: string): string {
  const open = /<w:p(?:\s[^>]*)?\/?>/.exec(chunk)?.[0] ?? '<w:p>'
  if (open.endsWith('/>')) return `<w:p><w:pPr>${extra}</w:pPr></w:p>`
  const body = chunk.slice(open.length)
  const a = body.indexOf('<w:pPr>')
  if (a < 0) return open + `<w:pPr>${extra}</w:pPr>` + body
  if (body.startsWith('<w:pPr/>', a)) return open + body.slice(0, a) + `<w:pPr>${extra}</w:pPr>` + body.slice(a + 8)
  const b = body.indexOf('</w:pPr>', a)
  if (b < 0) return chunk
  const inner = body.slice(a + '<w:pPr>'.length, b)
  return open + body.slice(0, a) + `<w:pPr>${pprOrder(inner, extra)}</w:pPr>` + body.slice(b + '</w:pPr>'.length)
}

/**
 * 把余量元素插进既有 `<w:pPr>` 内容：逐枚找第一个 schema 位次更靠后的现有子元素，
 * 插在它前面；没有更靠后的就追加在末尾。余量自身按位次升序给（`PPR_WRITE_ORDER`），
 * 于是后插的天然落在先插的之后。
 *
 * v0.160 起多一条：**同名元素合并属性**而不是再插一枚。`w:ind` 是 CT_PPrBase 里的单枚
 * 元素，包自己发的那一枚常常已经带着 w:left/w:firstLine（模型里算出来的缩进），再插
 * 一枚新的会让 Word 只认后写的那一枚——先写的那枚整枚被丢，缩进静默变样。所以命中
 * 同名就把属性并进去（已有的同名属性不覆盖，以包自己那一枚为准）
 */
function pprOrder(inner: string, extra: string): string {
  const kids = [...inner.matchAll(/<w:([A-Za-z]+)[\s/>]/g)].map((m) => ({ name: m[1], at: m.index ?? 0 }))
  const items = [...extra.matchAll(/<w:([A-Za-z]+)[^>]*?>/g)].map((m) => ({ name: m[1], xml: m[0] }))
  let s = inner
  let shift = 0
  for (const it of items) {
    const r = PPR_RANK[it.name]
    if (r === undefined) continue
    const same = kids.find((k) => k.name === it.name)
    if (same) {
      const at = same.at + shift
      const tag = /^<w:[A-Za-z]+[^>]*>/.exec(s.slice(at))?.[0]
      if (!tag) continue
      const attrs = /^<w:[A-Za-z]+([^>]*?)\/?>/.exec(it.xml)?.[1] ?? ''
      const add = [...attrs.matchAll(/\s+w:([A-Za-z]+)="[^"]*"/g)]
        .filter((m) => !new RegExp(`\\sw:${m[1]}=`).test(tag))
        .map((m) => m[0])
        .join('')
      if (!add) continue
      const cut = tag.endsWith('/>') ? tag.length - 2 : tag.length - 1
      s = s.slice(0, at) + tag.slice(0, cut) + add + tag.slice(cut) + s.slice(at + tag.length)
      shift += add.length
      continue
    }
    let at = -1
    for (const k of kids) {
      const kr = PPR_RANK[k.name]
      if (kr !== undefined && kr > r) {
        at = k.at
        break
      }
    }
    const pos = at < 0 ? s.length : at + shift
    s = s.slice(0, pos) + it.xml + s.slice(pos)
    shift += it.xml.length
  }
  return s
}

/**
 * 表自身的闸门载荷 → `<w:tblLook>` XML（v0.147）。三枚里 val 原样带，两枚 no*Band
 * 是 onOff；一个都没说就给空串（那一格交给样式推出来的那一枚）
 */
function tlookXmlOf(raw: unknown): string {
  const kv = parseTlookPayload(typeof raw === 'string' ? raw : null)
  if (!Object.keys(kv).length) return ''
  const parts: string[] = []
  if (kv.val) parts.push(`w:val="${xmlAttr(kv.val)}"`)
  if (kv.noHBand) parts.push(`w:noHBand="${kv.noHBand}"`)
  if (kv.noVBand) parts.push(`w:noVBand="${kv.noVBand}"`)
  return `<w:tblLook ${parts.join(' ')}/>`
}

/**
 * 单元格不换行载荷 → `<w:noWrap/>`（v0.152）。'1' 才发（「显式关」与「没写」在
 * Word 里同结果，读侧只存 true）——空串那一格由 patchTcPr 原样跳过
 */
function noWrapXmlOf(raw: unknown): string {
  return raw === '1' || raw === 1 ? '<w:noWrap/>' : ''
}

/**
 * 表级条件格式尺寸载荷 → 两枚元素 XML（v0.152）。CT_TblPrBase 的序：
 * tblStyleRowBandSize 排在 tblStyleColBandSize 之前（都在 tblpPr 之后、tblW 之前）。
 * 一枚都没说给空串（那一格交给包的默认——它两枚都不发）
 */
function tblPrXmlOf(raw: unknown): string {
  const kv = parseTblPrPayload(typeof raw === 'string' ? raw : null)
  const parts: string[] = []
  if (kv.rowBand) parts.push(`<w:tblStyleRowBandSize w:val="${kv.rowBand}"/>`)
  if (kv.colBand) parts.push(`<w:tblStyleColBandSize w:val="${kv.colBand}"/>`)
  return parts.join('')
}

/**
 * 单元格间距 → `<w:tblCellSpacing>`（v0.154）。w 是缇（dxa 档），type 原档位发回——
 * 读侧 pct 档只记账不渲染，写侧照样原样写（那份数是从源件抄下来的，不该在往返里
 * 被改成 dxa）。
 *
 * **与 bandSize 分开发、插在不同的锚点上**：CT_TblPrBase 的序里两枚 bandSize 排在
 * `w:tblW` **之前**，而 `w:tblCellSpacing` 排在 `w:tblW`、`w:jc` **之后**（tblInd 之前）。
 * 共用「插到第一个已知后续元素之前」那一套会把间距插到 tblW 前面，写出一枚序不对的
 * 元素——Word 对 CT_TblPrBase 的序是认真的（判损坏件风险）。
 */
function tblCellSpacingXmlOf(raw: unknown): string {
  const kv = parseTblPrPayload(typeof raw === 'string' ? raw : null)
  if (kv.cellSp === undefined) return ''
  const t = kv.cellSpType ? ` w:type="${xmlAttr(kv.cellSpType)}"` : ''
  return `<w:tblCellSpacing w:w="${kv.cellSp}"${t}/>`
}

/** `w:tblCellSpacing` 的插入锚点：排在它**之后**的元素（CT_TblPrBase 序里 tblInd 起） */
const AFTER_CELL_SPACING: string[] = ['tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription']

/**
 * `w:cnfStyle` 的插入锚点（v0.162）：排在它**之后**的元素（CT_TblPrBase 序里
 * tblStyle → **cnfStyle** → tblpPr → …）。
 *
 * 这一族**不与 bandSize 共用锚点表**——v0.147 那条教训：同一套「插到第一个已知后续
 * 元素之前」的表不能给两组元素共用（bandSize 排在 tblW 前、cellSpacing 排在它后，
 * 共用会把后者插错位置）。cnfStyle 是第三组，自带第三张表。
 */
const AFTER_CNF_STYLE: string[] = [
  'tblpPr', 'bidiVisual', 'tblOverlap', 'tblStyleRowBandSize', 'tblStyleColBandSize',
  'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd', 'tblLayout',
  'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription',
]

/**
 * data-cnf 载荷 → `<w:cnfStyle/>`（v0.162）。
 * 十三枚按 CNF_KEYS 的序逐枚发，空槽不发（源件没写那枚就不替它写——「没写」与
 * 「显式 0」在 Word 里同结果，但照抄源件的形状最不容易出意外）。
 */
function cnfXmlOf(raw: unknown): string {
  const kv = parseCnfPayload(typeof raw === 'string' ? raw : null)
  const bits: string[] = []
  for (const k of CNF_KEYS) {
    const v = kv[k]
    if (v === undefined || v === '') continue
    bits.push(` w:${k}="${xmlAttr(v)}"`)
  }
  return bits.length ? `<w:cnfStyle${bits.join('')}/>` : ''
}

/**
 * data-tblb 载荷 → 整片 `<w:tblBorders>` 的**内容**（v0.163）。
 *
 * 包恒发六枚硬编码默认的边（`new TableBorders(options.borders ?? {})`，DEFAULT_BORDER
 * = single/4/auto），值一个都不对；而真要带上 space 与主题三枚，包那六个槽里也没有
 * （`createBorderElement` 只发 val/sz/color/space，主题一概不认）。所以这一族走
 * **整片替换**而不是属性补丁：`w:tblBorders` 里只有这六枚孩子，且六枚都是单枚元素，
 * 逐枚改与整片换等价，整片换还能顺带把源件没写的边**撤掉**（包默认发全六枚）。
 */
function tblBordersXmlOf(raw: unknown): string {
  const p = parseTblbPayload(typeof raw === 'string' ? raw : null)
  const edges = Object.keys(p) as (keyof typeof p)[]
  if (!edges.length) return ''
  let out = ''
  for (const e of TBLB_EDGES) {
    const kv = p[e]
    if (!kv) continue
    let a = ''
    for (const k of TBLB_KEYS) {
      const v = kv[k]
      if (v === undefined || v === '') continue
      a += ` w:${k}="${xmlAttr(v)}"`
    }
    if (a) out += `<w:${e}${a}/>`
  }
  return out
}

/**
 * 给表格补 `<w:tblLook>`：一是引用了带条件层样式的表（按 styleId 查 `looks`，老路数），
 * 二是表**自己**带闸门的那一张（按出现序查 `own`，v0.147）——后者压过前者。
 * 两路都走同一处补丁：贴 `<w:tblPr>` 的末位（已有 w:tblLook 就整枚替换）。
 * 出现序的那一路由**计数闸门**兜底：`<w:tblPr>` 枚数与登记条数对不上就整笔放弃
 */
async function patchTblLook(
  bytes: Uint8Array,
  looks: Map<string, string>,
  own: string[] = [],
  band: string[] = [],
  spacing: string[] = [],
  cnf: string[] = [],
  borders: string[] = [],
  sess?: PackSession,
): Promise<Uint8Array> {
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  // 计数闸门：两族（tblLook 与 bandSize）都按 tblPr 出现序对位，
  // 长度必须与 tblPr 枚数相等（两族在同一处 push，恒等长；取 max 只是防御）
  const n = (xml.match(/<w:tblPr>/g) ?? []).length
  // 计数闸门：四族都按 tblPr 出现序对位（同处 push，恒等长；取 max 只是防御）
  if ((own.length || band.length || cnf.length) && n !== Math.max(own.length, band.length, cnf.length)) return bytes
  let i = 0
  let touched = false
  const patched = xml.replace(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/g, (all: string) => {
    const inner = all.slice('<w:tblPr>'.length, -'</w:tblPr>'.length)
    const mine = own[i] ?? ''
    const bandMine = band[i] ?? ''
    i++
    const id = /<w:tblStyle w:val="([^"]+)"/.exec(inner)?.[1]
    const look = mine || (id ? looks.get(id) : undefined)
    let out = all
    if (look) {
      touched = true
      out = /<w:tblLook[^>]*\/>/.test(inner) ? out.replace(/<w:tblLook[^>]*\/>/, look) : out.replace('</w:tblPr>', `${look}</w:tblPr>`)
    }
    if (bandMine) {
      touched = true
      out = insertTblPrKids(out, bandMine)
    }
    // 单元格间距（v0.154）：同一张表的第二笔补丁，锚点与 bandSize 不同（排在 tblW 之后）
    const spFrag = spacing[i - 1] ?? ''
    if (spFrag) {
      touched = true
      out = insertTblPrKids(out, spFrag, AFTER_CELL_SPACING)
    }
    // 表条件格式落点（v0.162）：同一张表的第三笔补丁，锚点又不同（紧跟 tblStyle）。
    // 已在场的 cnfStyle 不重复插（读手只认表级那一枚，格级的仍走纯记账）
    const cnfFrag = cnf[i - 1] ?? ''
    if (cnfFrag && !/<w:cnfStyle\b/.test(inner)) {
      touched = true
      out = insertTblPrKids(out, cnfFrag, AFTER_CNF_STYLE)
    }
    // 表级边框六边（v0.163）：整片替换 `<w:tblBorders>` 的内容。包恒发这一片（六枚
    // 硬编码默认边），所以不需要插入锚点，只要把内容换掉；源件没写 tblBorders 的表
    // 不动（留包的默认壳，比凭空开一片更接近源件）
    const bdFrag = borders[i - 1] ?? ''
    if (bdFrag) {
      touched = true
      out = out.replace(/(<w:tblBorders>)[\s\S]*?(<\/w:tblBorders>)/, (_m: string, a: string, b: string) => a + bdFrag + b)
    }
    return out
  })
  if (!touched) return bytes
  setPart(zip, 'word/document.xml', patched, sess)
  return finishPatch(bytes, zip, sess)
}

/**
 * 把 bandSize 两枚元素插进 `<w:tblPr>`：CT_TblPrBase 的序里它们排在 tblW 之前
 * （tblStyle → tblpPr → tblOverlap → bidiVisual → **tblStyleRowBandSize →
 * tblStyleColBandSize** → tblW → …）。包里 tblW 恒发（Table 必有宽），所以锚点
 *  practically 总是 `<w:tblW`；找不着就退到第一个排在它们之后的元素，再不行才追加末尾
 */
function insertTblPrKids(all: string, frag: string, after?: string[]): string {
  // bandSize 那一族排在 tblW 之前（默认锚点）；单元格间距排在 tblW/jc 之后，自带锚点
  const AFTER = after ?? ['tblW', 'jc', 'tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription']
  const at = firstIndexOf(all, AFTER)
  if (at >= 0) return all.slice(0, at) + frag + all.slice(at)
  return all.replace('</w:tblPr>', `${frag}</w:tblPr>`)
}

/**
 * 单元格不换行补丁（v0.152）：`<w:noWrap/>` 按 `<w:tc>` 出现序插进各自的 tcPr。
 *
 * 包里没有 noWrap 的槽（grep dist 无运行时支持），与段落余量同路数走打包后补丁。
 * 计数闸门认 `<w:tc>` 开标签——它恒发（每格必有），而 `<w:tcPr>` 不一定（空属性的格
 * 可能整个不吐），所以按 tc 数对位、缺 tcPr 时现开一枚。注意正则不匹配 `<w:tcPr>`：
 * `<w:tc` 后面紧跟的 `P` 不是空白/斜杠/`>`，天然排掉。
 * 嵌套表安全：两族各自按自己的元素出现序对位（cellExtras 的 push 赶在格子内容之前，
 * 外层 tc 在内层表前面入账，与 XML 序一致）。
 */
/**
 * 给 document.xml 里每个 `<w:tr>` 的行属性补两枚元素（v0.172）：按**行出现序**贴——
 * 第 i 行用 `extras[i]`（空串 = 这一行不动）。
 *
 * 两种落点：行里已有 `<w:trPr>` 就按 CT_TrPr 的序插在 `cantSplit`/`trHeight`/`tblHeader`
 * 这些之后元素之前；没有就现开一枚 `<w:trPr>`（它必须是 `<w:tr>` 的第一个孩子）。
 * 计数闸门同前：`<w:tr>` 枚数对不上就整笔放弃（嵌套表的行也在里面，两边都按文档序数）。
 */
async function patchTrPr(bytes: Uint8Array, extras: string[], sess?: PackSession): Promise<Uint8Array> {
  if (!extras.some((x) => x)) return bytes
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  const rows = [...xml.matchAll(/<w:tr(?=[\s>])[^>]*>/g)]
  if (rows.length !== extras.length) return bytes
  let out = ''
  let cursor = 0
  let touched = false
  for (let i = 0; i < rows.length; i++) {
    const start = rows[i].index ?? 0
    const stop = start + rows[i][0].length
    const add = extras[i]
    if (!add) {
      out += xml.slice(cursor, stop)
      cursor = stop
      continue
    }
    const open = /^\s*<w:trPr(?=[\s/>])[^>]*>/.exec(xml.slice(stop))
    if (open && !open[0].trimEnd().endsWith('/>')) {
      const blockStart = stop + open[0].indexOf('<w:trPr')
      const blockEnd = xml.indexOf('</w:trPr>', blockStart)
      if (blockEnd < 0) {
        out += xml.slice(cursor, stop)
        cursor = stop
        continue
      }
      // CT_TrPr 的序：… gridBefore → gridAfter → wBefore → wAfter → cantSplit → trHeight …
      const anchor = /<w:(?:cantSplit|trHeight|tblHeader|tblCellSpacing|jc|hidden)(?=[\s/>])/.exec(
        xml.slice(blockStart, blockEnd),
      )
      const at = anchor ? blockStart + (anchor.index ?? 0) : blockEnd
      out += xml.slice(cursor, at) + add
      cursor = at
      touched = true
    } else {
      // 没有 trPr：现开一枚（必须是 <w:tr> 的第一个孩子）
      out += xml.slice(cursor, stop) + `<w:trPr>${add}</w:trPr>`
      cursor = stop
      touched = true
    }
  }
  if (!touched) return bytes
  out += xml.slice(cursor)
  setPart(zip, 'word/document.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}

async function patchTcPr(bytes: Uint8Array, extras: string[], sess?: PackSession): Promise<Uint8Array> {
  if (!extras.some((x) => x)) return bytes
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  const opens = [...xml.matchAll(/<w:tc(?:\s[^>]*)?\/?>/g)]
  if (opens.length !== extras.length) return bytes
  let out = ''
  let cursor = 0
  let touched = false
  for (let i = 0; i < opens.length; i++) {
    const m = opens[i]
    const start = m.index ?? 0
    const selfClosed = m[0].endsWith('/>')
    const closeAt = selfClosed ? -1 : xml.indexOf('</w:tc>', start)
    if (!selfClosed && closeAt < 0) return bytes
    const stop = selfClosed ? start + m[0].length : closeAt + '</w:tc>'.length
    if (!extras[i]) {
      out += xml.slice(cursor, stop)
      cursor = stop
      continue
    }
    out += xml.slice(cursor, start) + tcPrInsert(xml.slice(start, stop), extras[i])
    cursor = stop
    touched = true
  }
  if (!touched) return bytes
  out += xml.slice(cursor)
  setPart(zip, 'word/document.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}

/** CT_TcPrBase 里排在 noWrap 之后的元素（锚点表）——按 schema 序插 */
const TCPR_AFTER_NOWRAP = ['tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark', 'headers']

/** 一枚 `<w:tc>…</w:tc>` → 补过 `<w:tcPr>` 的那一枚（没有 tcPr 就现开一枚） */
function tcPrInsert(chunk: string, extra: string): string {
  const open = /<w:tc(?:\s[^>]*)?\/?>/.exec(chunk)?.[0] ?? '<w:tc>'
  if (open.endsWith('/>')) return `<w:tc><w:tcPr>${extra}</w:tcPr></w:tc>`
  const body = chunk.slice(open.length)
  const a = body.indexOf('<w:tcPr>')
  if (a < 0) return open + `<w:tcPr>${extra}</w:tcPr>` + body
  if (body.startsWith('<w:tcPr/>', a)) return open + body.slice(0, a) + `<w:tcPr>${extra}</w:tcPr>` + body.slice(a + 8)
  const b = body.indexOf('</w:tcPr>', a)
  if (b < 0) return chunk
  const inner = body.slice(a + '<w:tcPr>'.length, b)
  const at = firstIndexOf(inner, TCPR_AFTER_NOWRAP)
  const withKid = at >= 0 ? inner.slice(0, at) + extra + inner.slice(at) : inner + extra
  return open + body.slice(0, a) + `<w:tcPr>${withKid}</w:tcPr>` + body.slice(b + '</w:tcPr>'.length)
}

/** 在一枚开标签（含自闭合）上改/加属性：已有同名属性就地换值，没有就追加在 `>` 之前 */
function tagWithAttrs(tag: string, kv: Record<string, string>): string {
  let out = tag
  for (const k of Object.keys(kv)) {
    const v = kv[k]
    if (!v) continue
    const re = new RegExp(`(\\s${k}=)"[^"]*"`)
    if (re.test(out)) {
      out = out.replace(re, `$1"${v}"`)
      continue
    }
    const m = /^(.*?)(\/?)>$/.exec(out)
    if (!m) continue
    out = `${m[1]} ${k}="${v}"${m[2]}>`
  }
  return out
}

/** 块内按标签名改属性：只改第一枚（一个 w:drawing 里各层壳都只有一枚） */
function retag(chunk: string, tag: string, kv: Record<string, string>): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?/?>`)
  const m = re.exec(chunk)
  if (!m) return chunk
  return chunk.slice(0, m.index) + tagWithAttrs(m[0], kv) + chunk.slice(m.index + m[0].length)
}

/**
 * 环绕档位整片换（v0.178）：包恒发 `<wp:wrapNone/>`，源件说的是四周环绕。
 * 元素名与 wrapText 都是源件说过的话，不能只改名或只追加——直接换整片，
 * 位置（effectExtent 之后、docPr 之前）保持不动，符合 CT_Anchor 的 schema 序。
 */
function retagWrap(chunk: string, wrapText: string): string {
  return chunk.replace(/<wp:wrapNone\s*\/>/, `<wp:wrapSquare wrapText="${wrapText}"/>`)
}

/**
 * 图片容器壳（v0.148）：包把 wp:inline / effectExtent / docPr / cNvPr / 两枚 locks /
 * prstGeom / xfrm 的 off+ext 全都发出来了，只是值硬编码（dist*=0、effectExtent 四边=0、
 * locks 恒 1、cNvPr 的 name 干脆是空串）。所以这一族不像段落余量那样要插元素——
 * 按 `<w:drawing>` 出现序逐块**改值**即可。计数闸门同款：块数与登记条数对不上整笔放弃。
 * v0.177：载荷带 anKind=anchor 时写手给 ImageRun 传 floating，包会发 `<wp:anchor>`；
 * 本函数再把六枚闸门与 relativeHeight 按源件原值回填（包发出的是默认值/退化值）。
 * positionH/V 的 posOffset 与 simplePos 的 x/y 仍不在此列，账继续记。
 */
async function patchImgXml(bytes: Uint8Array, shells: string[], sess?: PackSession): Promise<Uint8Array> {
  if (!shells.some((x) => x)) return bytes
  const zip = sess ? sess.zip : await loadZipOf(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await partText(zip, 'word/document.xml', sess)
  const blocks = [...xml.matchAll(/<w:drawing>[\s\S]*?<\/w:drawing>/g)]
  if (blocks.length !== shells.length) return bytes
  let out = ''
  let cursor = 0
  let touched = false
  for (let i = 0; i < blocks.length; i++) {
    const m = blocks[i]
    const start = m.index ?? 0
    const stop = start + m[0].length
    const kv = parseImgPayload(shells[i])
    if (!Object.keys(kv).length) {
      out += xml.slice(cursor, stop)
      cursor = stop
      continue
    }
    let chunk = m[0]
    // wp:inline / wp:anchor 的四边避让
    const box: Record<string, string> = {}
    for (const k of ['distT', 'distB', 'distL', 'distR']) if (kv[k] !== undefined) box[k] = kv[k]
    if (Object.keys(box).length) {
      chunk = retag(chunk, 'wp:inline', box)
      chunk = retag(chunk, 'wp:anchor', box)
    }
    // v0.177：浮动图六枚闸门 + relativeHeight。包把 simplePos 硬编码成 "0"、
    // relativeHeight 在 zIndex 为 0 时退化成图片高度，其余四枚用布尔默认值——
    // 都不是源件说过的话，一律按载荷原值回填（tagWithAttrs 已有则改、没有则补）
    if (kv.anKind === 'anchor') {
      const an: Record<string, string> = {}
      for (const [k, n] of [
        ['anOver', 'allowOverlap'],
        ['anBehind', 'behindDoc'],
        ['anCell', 'layoutInCell'],
        ['anLocked', 'locked'],
        ['anSimple', 'simplePos'],
        ['anRelH', 'relativeHeight'],
      ] as const) {
        if (kv[k] !== undefined) an[n] = kv[k]
      }
      if (Object.keys(an).length) chunk = retag(chunk, 'wp:anchor', an)
      // 包的 createSimplePos() 把 x/y 硬编码成 0，源件的绝对坐标（spX/spY）得按载荷回填；
      // 不补的话这两对会从「掉了」变成「值变」——名字在、值不对，反而更难看
      if (kv.spX !== undefined || kv.spY !== undefined) {
        const sp: Record<string, string> = {}
        if (kv.spX !== undefined) sp.x = kv.spX
        if (kv.spY !== undefined) sp.y = kv.spY
        chunk = retag(chunk, 'wp:simplePos', sp)
      }
      // v0.178：环绕档位。包恒发 <wp:wrapNone/>，源件说的是四周环绕时整片换掉。
      // 只在浮动图这一支做——内嵌图（wp:inline）本来就没有环绕元素，别凭空插一枚
      if (kv.wrapText !== undefined) chunk = retagWrap(chunk, kv.wrapText)
    }
    // v0.178：wp:inline 的两个流水号（anchorId/editId）。v0.150 的注释写「包不认
    // 这两个槽」——包确实不发，但壳本身发得出，tagWithAttrs 追加即可，不必造元素
    const boxId: Record<string, string> = {}
    if (kv.anId !== undefined) boxId.anchorId = kv.anId
    if (kv.anEdit !== undefined) boxId.editId = kv.anEdit
    if (Object.keys(boxId).length) chunk = retag(chunk, 'wp:inline', boxId)
    // v0.178：a:srcRect 源裁剪框四边。包发 <a:srcRect/> 这枚空壳（屏上由
    // clip-path 兑现），此前只记不写——纯属性回填，零插元素、零 schema 风险
    const sr: Record<string, string> = {}
    for (const [k, n] of [['srT', 't'], ['srR', 'r'], ['srB', 'b'], ['srL', 'l']] as const) {
      if (kv[k] !== undefined) sr[n] = kv[k]
    }
    if (Object.keys(sr).length) chunk = retag(chunk, 'a:srcRect', sr)
    // v0.178：a:xfrm 的变换三枚（与 off/ext 同一枚元素，分开补各补各的）
    const xf: Record<string, string> = {}
    if (kv.xfRot !== undefined) xf.rot = kv.xfRot
    if (kv.xfFlipH !== undefined) xf.flipH = kv.xfFlipH
    if (kv.xfFlipV !== undefined) xf.flipV = kv.xfFlipV
    if (Object.keys(xf).length) chunk = retag(chunk, 'a:xfrm', xf)
    // wp:effectExtent 四边（载荷键 eeL/eeT/eeR/eeB，回写成 l/t/r/b）
    const ee: Record<string, string> = {}
    for (const [k, n] of [['eeL', 'l'], ['eeT', 't'], ['eeR', 'r'], ['eeB', 'b']] as const) {
      if (kv[k] !== undefined) ee[n] = kv[k]
    }
    if (Object.keys(ee).length) chunk = retag(chunk, 'wp:effectExtent', ee)
    // 画布级的对象序号与**对象名**（v0.158）：名字也走这一枚——包把 alt 同时写进 name
    // 与 descr，源里的对象名（「图片 1」）被替代文本顶掉，得按源值设回来
    const dp: Record<string, string> = {}
    if (kv.docPrId !== undefined) dp.id = kv.docPrId
    if (kv.docPrName !== undefined) dp.name = kv.docPrName
    if (Object.keys(dp).length) chunk = retag(chunk, 'wp:docPr', dp)
    const nv: Record<string, string> = {}
    if (kv.cNvPrId !== undefined) nv.id = kv.cNvPrId
    if (kv.cNvPrName !== undefined) nv.name = kv.cNvPrName
    // 图形级替代文本（v0.158）：与画布级那枚 descr 是两枚属性，包只发后者
    if (kv.cNvPrDescr !== undefined) nv.descr = kv.cNvPrDescr
    if (Object.keys(nv).length) chunk = retag(chunk, 'pic:cNvPr', nv)
    if (kv.gfl !== undefined) chunk = retag(chunk, 'a:graphicFrameLocks', { noChangeAspect: kv.gfl })
    // a:picLocks 的纵横比锁与箭头锁（v0.149）：同一枚元素两个属性，各补各的
    const pl: Record<string, string> = {}
    if (kv.pic !== undefined) pl.noChangeAspect = kv.pic
    if (kv.picArrow !== undefined) pl.noChangeArrowheads = kv.picArrow
    if (Object.keys(pl).length) chunk = retag(chunk, 'a:picLocks', pl)
    // pic:spPr 的黑白模式档位（v0.149）：包恒写 auto，说了才改
    if (kv.bwMode !== undefined) chunk = retag(chunk, 'pic:spPr', { bwMode: kv.bwMode })
    // a:blip 的 cstate（v0.150）：「打印才出图」那档。包恒写 none，说了才改
    if (kv.blipState !== undefined) chunk = retag(chunk, 'a:blip', { cstate: kv.blipState })
    if (kv.prst !== undefined) chunk = retag(chunk, 'a:prstGeom', { prst: kv.prst })
    // v0.179：a:ln 三枚（w 线宽 / cap 线端 / cmpd 复合线型）。包发的那枚壳
    // 上有 w（预打包按 lnW 传了），cap/cmpd 由这里按源件字面补——不能交给包，
    // 它的枚举键与 OOXML 字面不同名。已有则改、没有则补，零插元素
    const ln: Record<string, string> = {}
    if (kv.lnW !== undefined) ln.w = kv.lnW
    if (kv.lnCap !== undefined) ln.cap = kv.lnCap
    if (kv.lnCmpd !== undefined) ln.cmpd = kv.lnCmpd
    if (Object.keys(ln).length) chunk = retag(chunk, 'a:ln', ln)
    // v0.180：CT_LineProperties 的四枚子元素（v0.179 只补了 a:ln 的三枚属性）。
    // 包没有这些元素的构造器——v0.179 的 outline 槽让 `<a:ln>` 这枚壳发得出来之后，
    // 子元素要在这里按 schema 序补：fill（包发的 a:noFill）→ prstDash → miter
    // → headEnd → tailEnd。插在 `</a:ln>` 之前天然满足位次，且不需要新建 a:effectLst
    // 那张锚点表（那是下一族的事）。
    // 纪律：chunk 已是单个 w:drawing 块、只插第一枚 a:ln、已有同名元素改为改属性
    // 而不是再插一枚（第二枚同名子元素 = 非法 XML，计数闸门抓不到）。
    const lineKids: [string, Record<string, string>][] = []
    if (kv.dashVal !== undefined) lineKids.push(['prstDash', { val: kv.dashVal }])
    if (kv.miterLim !== undefined) lineKids.push(['miter', { lim: kv.miterLim }])
    for (const [prefix, tag] of [['he', 'headEnd'], ['te', 'tailEnd']] as const) {
      const a: Record<string, string> = {}
      if (kv[prefix + 'Type']) a.type = kv[prefix + 'Type']
      if (kv[prefix + 'W']) a.w = kv[prefix + 'W']
      if (kv[prefix + 'Len']) a.len = kv[prefix + 'Len']
      if (Object.keys(a).length) lineKids.push([tag, a])
    }
    if (lineKids.length) {
      const lnBox = /<a:ln\b[^>]*\/>|<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/.exec(chunk)
      if (lnBox) {
        const box = lnBox[0]
        if (lineKids.some(([tag]) => box.includes(`<a:${tag}`))) {
          // 包已自带其中一枚（或同一块跑第二趟）：逐枚改属性，不再插
          for (const [tag, a] of lineKids)
            if (box.includes(`<a:${tag}`)) chunk = retag(chunk, `a:${tag}`, a)
        } else {
          const frag = lineKids.map(([tag, a]) => tagWithAttrs(`<a:${tag}/>`, a)).join('')
          const at = box.lastIndexOf('</a:ln>')
          const fresh = box.endsWith('/>')
            ? box.slice(0, -2) + '>' + frag + '</a:ln>'
            : box.slice(0, at) + frag + box.slice(at)
          chunk = chunk.slice(0, lnBox.index) + fresh + chunk.slice(lnBox.index + box.length)
        }
      }
    }
    // v0.181：a:effectLst 整片。包连 effectLst 的发射器都没有，而 v0.180 那张
    // 「插在 </a:ln> 内部」的锚点表位次不同（这是 a:ln 的兄弟，不是它的子元素），
    // 必须另起一张：按 CT_ShapeProperties 排在 a:ln 之后、scene3d/sp3d/extLst
    // 之前。三维族在夹具里被塞进 effectLst 内部（结构非法），本轮不复刻。
    const effectKids: [string, Record<string, string>][] = []
    for (const { prefix, tag, attrs } of EFFECT_ATTRS) {
      const a: Record<string, string> = {}
      for (const n of attrs) {
        const v = kv[effectKey(prefix, n)]
        if (v !== undefined) a[n] = v
      }
      if (Object.keys(a).length) effectKids.push([tag, a])
    }
    if (effectKids.length) {
      const spPr = /<pic:spPr\b[^>]*>[\s\S]*?<\/pic:spPr>/.exec(chunk)
      if (spPr) {
        const box = spPr[0]
        if (box.includes('<a:effectLst')) {
          // 幂等：整片已在场时逐枚改属性，不再插第二枚（计数闸门抓不到重复片）
          for (const [tag, a] of effectKids)
            if (box.includes(`<a:${tag}`)) chunk = retag(chunk, `a:${tag}`, a)
        } else {
          const frag = `<a:effectLst>${effectKids
            .map(([tag, a]) => tagWithAttrs(`<a:${tag}/>`, a)).join('')}</a:effectLst>`
          // 锚点表：找第一枚「排在 effectLst 之后」的在场兄弟，插在它前面。
          // 写出包实际只发到 a:ln、这些兄弟都不在，退化到 </pic:spPr> 前——
          // 那也正好是 a:ln 之后，schema 位次成立。
          let at = -1
          for (const t of ['a:scene3d', 'a:sp3d', 'a:extLst', 'a:spLocks']) {
            const i = box.indexOf(`<${t}`)
            if (i >= 0 && (at < 0 || i < at)) at = i
          }
          if (at < 0) at = box.lastIndexOf('</pic:spPr>')
          const fresh = box.slice(0, at) + frag + box.slice(at)
          chunk = chunk.slice(0, spPr.index) + fresh + chunk.slice(spPr.index + box.length)
        }
      }
    }
    // a:xfrm 的 a:off / a:ext（图形框自身的原点与尺寸）
    const off: Record<string, string> = {}
    if (kv.offX !== undefined) off.x = kv.offX
    if (kv.offY !== undefined) off.y = kv.offY
    if (Object.keys(off).length) chunk = retag(chunk, 'a:off', off)
    const ext: Record<string, string> = {}
    if (kv.extCx !== undefined) ext.cx = kv.extCx
    if (kv.extCy !== undefined) ext.cy = kv.extCy
    if (Object.keys(ext).length) chunk = retag(chunk, 'a:ext', ext)
    out += xml.slice(cursor, start) + chunk
    cursor = stop
    touched = true
  }
  if (!touched) return bytes
  out += xml.slice(cursor)
  setPart(zip, 'word/document.xml', out, sess)
  return finishPatch(bytes, zip, sess)
}
