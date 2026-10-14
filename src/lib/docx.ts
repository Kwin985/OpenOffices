import {
  AlignmentType,
  BorderStyle,
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
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from 'docx'
import { xml2js } from 'xml-js'
import { borderParts, pxToEighths, CELL_EDGES, type CellEdge } from './cell-style'
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

// TipTap 3 getJSON 的文本节点是顶层 text；历史结构测试用过 attrs.text，两者都兼容
function textValue(node: PMNode): string {
  return node.text ?? (node.attrs?.text as string) ?? ''
}

// 批注条目：text 为批注内容，正文用 comment mark(cid) 锚定；docx 往返写 word/comments.xml
export interface DocComment {
  id: number
  author?: string
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
  /** 分栏数（1=不分栏）；与 colGap（mm）一起贯穿视图/打印/docx/odt */
  cols?: number
  colGap?: number
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
} {
  const preset = p?.size === 'Letter' ? PAGE_SIZES_MM.Letter : PAGE_SIZES_MM.A4
  const w = p?.size === 'custom' && p.w ? p.w : preset[0]
  const h = p?.size === 'custom' && p.h ? p.h : preset[1]
  const cols = Math.min(4, Math.max(1, Math.round(p?.cols ?? 1)))
  return { w, h, margin: { ...DEFAULT_PAGE_MARGIN, ...p?.margin }, cols, colGap: p?.colGap ?? DEFAULT_COL_GAP }
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
  run: {
    font?: string
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
  }
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
}

export async function docxToHtml(bytes: Uint8Array): Promise<string> {
  const arrayBuffer = bytes.slice().buffer
  const mammoth = (await import('mammoth')).default
  const result = await mammoth.convertToHtml({ arrayBuffer })
  return result.value
}

// mammoth 不读页眉页脚：直接解 zip 里 sectPr 引用的 header/footer XML，抽文本与 PAGE 页码域
export async function docxToDocMeta(bytes: Uint8Array): Promise<DocMeta> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const docXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
  const relsText = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? ''
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
  const r1 = (v?: number) => (v === undefined ? undefined : Math.round(v * 10) / 10)
  const page: PageSetup = {}
  if (pw && ph) {
    const near = (a: number, b: number) => Math.abs(a - b) < 1
    const size = near(pw, 210) && near(ph, 297) ? 'A4' : near(pw, 215.9) && near(ph, 279.4) ? 'Letter' : 'custom'
    const margin: Partial<PageMargin> = {}
    const tm = r1(mt)
    const rm = r1(mr)
    const bm = r1(mb)
    const lm = r1(ml)
    if (tm !== undefined) margin.top = tm
    if (rm !== undefined) margin.right = rm
    if (bm !== undefined) margin.bottom = bm
    if (lm !== undefined) margin.left = lm
    page.size = size
    if (size === 'custom') {
      page.w = r1(pw)
      page.h = r1(ph)
    }
    if (Object.keys(margin).length) page.margin = margin
  }
  // 分栏：w:num>1 才算多栏；栏间距缺省时回退默认而不写进 meta
  const num = Number(colsEl?.match(/w:num="(\d+)"/)?.[1])
  if (num > 1) {
    page.cols = Math.min(4, num)
    const gap = tw(colsEl, 'space')
    if (gap && Math.abs(gap - DEFAULT_COL_GAP) > 0.6) page.colGap = r1(gap)
  }
  if (Object.keys(page).length) out.page = page
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
  // 锚文本限定在单段落内；跨段批注不重锚（侧栏仍显示，标记为未定位）
  const anchorOf = (id: number): string | undefined => {
    const startRe = new RegExp(`<w:commentRangeStart[^>]*w:id="${id}"[^>]*>`)
    const sm = startRe.exec(docXml)
    if (!sm) return undefined
    const bodyStart = sm.index + sm[0].length
    const endRe = new RegExp(`<w:commentRangeEnd[^>]*w:id="${id}"[^>]*>`)
    const em = endRe.exec(docXml.slice(bodyStart))
    if (!em) return undefined
    const endIdx = bodyStart + em.index
    if (docXml.indexOf('</w:p>', bodyStart) < endIdx) return undefined
    const text = decodeEnt(joinT(docXml.slice(bodyStart, endIdx)))
    return text || undefined
  }
  const comments = commentRowsOf(commentsXml, extXml)
  let outHtml = html
  for (const comment of comments) {
    const anchor = anchorOf(comment.id)
    if (!anchor) continue
    const needle = esc(anchor)
    const idx = outHtml.indexOf(needle)
    if (idx < 0) continue
    outHtml =
      outHtml.slice(0, idx) +
      `<span data-oo-comment="${comment.id}">${needle}</span>` +
      outHtml.slice(idx + needle.length)
  }
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
  | InsertedTextRun
  | DeletedTextRun
  | ExternalHyperlink
  | CommentRangeStart
  | CommentRangeEnd
  | CommentReference
  | FootnoteReferenceRun
  | EndnoteReferenceRun

function markAttr(node: PMNode, mark: string, attr: string): string | undefined {
  const m = node.marks?.find((x) => x.type === mark)
  const v = m?.attrs?.[attr]
  return typeof v === 'string' ? v : undefined
}

function inlineToChildren(node: PMNode, inherited: Inherited = {}, cs?: CommentTrack, dt?: DocTrack): ParagraphChildLike[] {
  const out: ParagraphChildLike[] = []
  for (const child of node.content ?? []) {
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
      const runOpts = {
        text,
        bold,
        italics: italic,
        strike,
        font: docFont(ts('fontFamily')) ?? (mono ? 'Consolas' : undefined),
        ...(Number.isFinite(fsPx) && fsPx > 0 ? { size: Math.round(fsPx * 1.5) } : {}),
        ...(lsTw !== null && lsTw !== 0 ? { characterSpacing: lsTw } : {}),
        ...(color ? { color } : {}),
        ...(highlight ? { shading: { type: 'clear' as const, fill: highlight } } : {}),
        ...(underline ? { underline: {} } : {}),
        ...(rstyle ? { style: rstyle } : {}),
        ...vertAlignOf(child),
      }
      if (href) {
        // 超链接里的文字不包修订壳（docx 库的链接子元素类型不收 Inserted/DeletedTextRun）：
        // 链接文字带修订是罕见写法，内容保住、标记丢失，这层边界在 README 里如实记着
        out.push(
          new ExternalHyperlink({
            link: href,
            children: [new TextRun({ ...runOpts, style: 'Hyperlink' })],
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
        out.push(isDel ? new DeletedTextRun(revOpts) : new InsertedTextRun(revOpts))
      } else {
        out.push(new TextRun(runOpts))
      }
    } else if (child.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }))
    } else if (child.type === 'image') {
      const src = (child.attrs?.src as string) ?? ''
      const bytes = src.startsWith('data:') ? dataUriToBytes(src) : null
      if (bytes) {
        out.push(
          new TextRun({
            children: [
              new ImageRun({
                type: imageType(src),
                data: bytes,
                transformation: {
                  width: Number(child.attrs?.width) || 320,
                  height: Number(child.attrs?.height) || 240,
                },
              }),
            ],
          }),
        )
      } else if (src) {
        out.push(new TextRun({ text: `[图片: ${src}]`, italics: true }))
      }
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
  let head = `<w:style w:type="table" w:styleId="${xmlAttr(s.id)}"><w:name w:val="${xmlAttr(s.name)}"/>`
  if (s.basedOn) head += `<w:basedOn w:val="${xmlAttr(s.basedOn)}"/>`
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
  return spacingVals(
    ownedPx(node.attrs?.lineHeight) ?? null,
    (typeof node.attrs?.lineRule === 'string' ? node.attrs.lineRule : null) as LineRule | null,
    ownedPx(node.attrs?.spaceBefore),
    ownedPx(node.attrs?.spaceAfter),
  )
}

/** 段落的直接格式（命名样式 / 行距段距 / 底纹 / 四边）一次拼好，供 new Paragraph 的参数展开。
 *  pstyle 由调用方决定给不给：heading 的样式标签由 HeadingLevel 承担（库会给 heading 和 style
 *  各写一枚 w:pStyle，并存会出两枚）；bullet 项库无条件补 ListParagraph 标签，同样不能并存 */
function paraFormatOf(node: PMNode, pstyle?: string | null) {
  const sp = spacingOf(node)
  const sh = shadingOf(node.attrs?.background)
  const bd = bordersOf(node.attrs)
  return {
    ...(pstyle ? { style: pstyle } : {}),
    ...(sp ? { spacing: sp } : {}),
    ...(sh ? { shading: sh } : {}),
    ...(bd ? { border: bd } : {}),
  }
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

/** 四边 → w:tcBorders（表格）或 w:pBdr（段落）；两者同形，一条都没有就不写这个元素 */
function bordersOf(attrs: Record<string, unknown> | undefined) {
  const b = {
    top: cellBorder(attrs?.bdTop),
    bottom: cellBorder(attrs?.bdBottom),
    left: cellBorder(attrs?.bdLeft),
    right: cellBorder(attrs?.bdRight),
  }
  return Object.values(b).some(Boolean) ? b : undefined
}

/** 底纹 → w:shd；Word 的 fill 是不带 # 的十六进制 */
function shadingOf(v: unknown) {
  const hex = typeof v === 'string' ? v : ''
  return hex ? { type: ShadingType.CLEAR, fill: hex.replace('#', '').toLowerCase() } : undefined
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

interface DocTrack {
  used: Set<number>
  ranges: Set<number>
  skipped: Set<number>
  /** 脚注/尾注正文：键是导出时现编的序号（1 起，两类各自计数），与 Word 的自动编号同一条规则 */
  notes: Record<NoteKind, Map<number, string>>
  seq: Record<NoteKind, number>
  /** 修订壳的 w:id 计数：Word 只要求文档内不重复，跟批注 id 不同名字空间，从 1 起即可 */
  revId: number
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
): (Paragraph | Table | TableOfContents)[] {
  const out: (Paragraph | Table | TableOfContents)[] = []
  for (const node of nodes) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const ordered = node.type === 'orderedList'
      for (const item of node.content ?? []) {
        const blocks = (item.content ?? []).filter((b) => b.type !== 'bulletList' && b.type !== 'orderedList')
        const nested = (item.content ?? []).filter((b) => b.type === 'bulletList' || b.type === 'orderedList')
        const main: PMNode = blocks[0] ?? { type: 'paragraph', content: [] }
        out.push(
          new Paragraph({
            children: inlineBlockChildren(main, dt),
            // 有序项必须走真编号：写成「1. 」字面文本时 Word 里既不续号也不重排，
            // 读回来更会把它当成普通段落（编号从此消失）。
            ...(ordered ? { numbering: { reference: ORDERED_REF, level: Math.min(2, depth) } } : { bullet: { level: depth } }),
            indent: indentOf(main),
            // 有序项库见 style 会跳过 ListParagraph 标签，命名样式可并存；子弹项库无条件
            // 补 ListParagraph（两枚 pStyle 撞车），样式标签只好丢（挂账）
            ...paraFormatOf(main, ordered ? pstyleOf(main) : undefined),
          }),
        )
        out.push(...blocksOf(blocks.slice(1), depth, dt, contentTwips))
        out.push(...blocksOf(nested, depth + 1, dt, contentTwips))
      }
      continue
    }
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level ?? 1)
      out.push(
        new Paragraph({
          children: inlineBlockChildren(node, dt),
          outlineLevel: Math.max(0, Math.min(8, level - 1)),
          indent: indentOf(node),
          alignment: alignOf(node),
          ...paraFormatOf(node),
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
        new Paragraph({
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
      out.push(new Paragraph({ children: [], thematicBreak: true }))
      continue
    }
    if (node.type === 'pageBreak') {
      out.push(new Paragraph({ children: [new PageBreak()] }))
      continue
    }
    if (node.type === 'blockquote') {
      out.push(
        new Paragraph({
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
          rows: rows.map((r, ri) => {
              // 逐格的 w:tcW 吃掉它跨的那几枚网格列；网格游标按 shape 给的真格子起始列走，
              // 被上面竖跨压掉的那几枚列不能省（不省就会把整行往左错一枚，键进去的账落错格子）
              let gc = 0
              let ck = 0
              // 行高（v0.97 起）：导入侧按 atLeast 读入（exact 的裁剪档 CSS 表达不了），
              // 导出同档回写，往返稳定在 atLeast
              const rh = num(r.attrs?.rowHeight)
              return new TableRow({
                // 表头行由行级 w:trPr/w:tblHeader 记账（TipTap 用 th 单元格类型表示）。
                // 只在命中时给属性：写成 tableHeader:false 会落 <w:tblHeader w:val="false"/>，
                // 而读侧按"有没有这个元素"判断，伪标记会把正文行错认成表头。
                ...(r.content ?? []).some((c) => c.type === 'tableHeader') ? { tableHeader: true } : {},
                ...(rh > 0 ? { height: { value: Math.round(rh * PX_TWIP), rule: HeightRule.ATLEAST } } : {}),
                children: (r.content ?? []).map((cell) => {
                  // TipTap 合并语义 colspan/rowspan → gridSpan + vMerge（docx 库内部展开 restart/continue）
                  const cs = colspanOf(cell)
                  const rs = rowspanOf(cell)
                  const isCell = isCellNode(cell)
                  const start = isCell && shape ? (shape.starts[ri][ck++] ?? gc) : gc
                  const cellTw = isCell ? gridTw.slice(start, start + cs).reduce((s, w) => s + w, 0) : 0
                  if (isCell) gc = start + cs
                  const borders = bordersOf(cell.attrs)
                  const bg = shadingOf(cell.attrs?.background)
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
                  const cellBlocks = blocksOf(cell.content ?? [], 0, dt, contentTwips)
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
                    // OOXML 要求 w:tc 里至少一个 w:p（空否则会成损坏件）
                    children: cellBlocks.length ? cellBlocks : [new Paragraph({ children: [] })],
                  })
                }),
              })
            },
          ),
        }),
      )
      continue
    }
    out.push(
      new Paragraph({
        children: inlineBlockChildren(node, dt),
        alignment: alignOf(node),
        indent: indentOf(node),
        ...paraFormatOf(node, pstyleOf(node)),
      }),
    )
  }
  return out
}

export async function prosemirrorToDocxBytes(json: PMNode, meta?: DocMeta): Promise<Uint8Array> {
  const dt = newDocTrack()
  const pg = resolvePage(meta?.page)
  const twips = (mm: number) => Math.round(mm * MM_TWIPS)
  // 版心宽度：与界面上的精确列宽同一个算法（contentTwipsOf），没有宽度账的表按它等分写真网格
  const contentTw = contentTwipsOf(pg)
  const section: {
    children: (Paragraph | Table | TableOfContents)[]
    properties?: {
      page: { size: { width: number; height: number; orientation?: 'landscape' | 'portrait' }; margin: Record<string, number> }
      column?: { count: number; space: number; equalWidth: true; separate: false }
    }
    headers?: { default: Header }
    footers?: { default: Footer }
  } = { children: blocksOf(json.content ?? [], 0, dt, contentTw) }
  {
    // docx 库按"竖版宽高 + orientation"理解 size（landscape 时自行交换写盘），故传排序后的尺寸
    section.properties = {
      page: {
        size: {
          width: twips(Math.min(pg.w, pg.h)),
          height: twips(Math.max(pg.w, pg.h)),
          ...(pg.w > pg.h ? { orientation: 'landscape' as const } : {}),
        },
        margin: {
          top: twips(pg.margin.top),
          bottom: twips(pg.margin.bottom),
          left: twips(pg.margin.left),
          right: twips(pg.margin.right),
          header: twips(Math.min(pg.margin.top, 12.7)),
          footer: twips(Math.min(pg.margin.bottom, 12.7)),
        },
      },
      // 单栏不写 w:cols（Word 默认即单栏，写出来反而让 diff 变噪）
      ...(pg.cols > 1
        ? { column: { count: pg.cols, space: twips(pg.colGap), equalWidth: true as const, separate: false } }
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
    numbering: { config: [{ reference: ORDERED_REF, levels: ORDERED_LEVELS }] },
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
  return looks.size ? patchTblLook(out, looks) : out
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
  if (!c || !Object.keys(c).length) return undefined
  // 四位闸门走 table-cond 的 condLookBits：odt 出口没处存闸门，只能按同一规则再推一次，
  // 两边共用这一枚函数才不会推出两个结果
  const look = condLookBits(c)
  const has = (...ts: TableCondType[]) => ts.some((t) => c[t])
  const bit = (b: boolean) => (b ? '1' : '0')
  return (
    `<w:tblLook` +
    ` w:firstRow="${bit(look.firstRow)}"` +
    ` w:lastRow="${bit(look.lastRow)}"` +
    ` w:firstColumn="${bit(look.firstColumn)}"` +
    ` w:lastColumn="${bit(look.lastColumn)}"` +
    ` w:noHBand="${bit(!has('band1Horz', 'band2Horz'))}"` +
    ` w:noVBand="${bit(!has('band1Vert', 'band2Vert'))}"` +
    `/>`
  )
}

/** 给引用了这些表样式的每一张表补 `<w:tblLook>`：`<w:tblPr>` 的最后一位，插到 `</w:tblPr>` 之前就是了 */
async function patchTblLook(bytes: Uint8Array, looks: Map<string, string>): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return bytes
  const xml = await file.async('string')
  let touched = false
  const patched = xml.replace(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/g, (all, inner: string) => {
    const id = /<w:tblStyle w:val="([^"]+)"/.exec(inner)?.[1]
    const look = id ? looks.get(id) : undefined
    if (!look) return all
    touched = true
    return all.replace('</w:tblPr>', `${look}</w:tblPr>`)
  })
  if (!touched) return bytes
  zip.file('word/document.xml', patched)
  const buf = (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer
  return new Uint8Array(buf)
}
