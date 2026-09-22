import {
  AlignmentType,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  type IFontAttributesProperties,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { decodeEnt } from './ooxml'

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

// 页眉页脚设置 + 批注列表 + 页面设置：随 .odoc meta 存储，导出写入 OOXML
export interface DocMeta {
  headerText?: string
  footerText?: string
  footerPageNumber?: boolean
  pageNumberFormat?: PageNumberFormat
  comments?: DocComment[]
  page?: PageSetup
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

type ParagraphChildLike = TextRun | ExternalHyperlink | CommentRangeStart | CommentRangeEnd | CommentReference

function markAttr(node: PMNode, mark: string, attr: string): string | undefined {
  const m = node.marks?.find((x) => x.type === mark)
  const v = m?.attrs?.[attr]
  return typeof v === 'string' ? v : undefined
}

function inlineToChildren(node: PMNode, inherited: Inherited = {}, cs?: CommentTrack): ParagraphChildLike[] {
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
      // fontSize 内部存 px（CSS 习惯），docx 字号是半点：pt = px×0.75，half-points = pt×2
      const fsPx = parseInt(ts('fontSize') ?? '', 10)
      const runOpts = {
        text,
        bold,
        italics: italic,
        strike,
        font: docFont(ts('fontFamily')) ?? (mono ? 'Consolas' : undefined),
        ...(Number.isFinite(fsPx) && fsPx > 0 ? { size: Math.round(fsPx * 1.5) } : {}),
        ...(color ? { color } : {}),
        ...(highlight ? { shading: { type: 'clear' as const, fill: highlight } } : {}),
        ...(underline ? { underline: {} } : {}),
      }
      if (href) {
        out.push(
          new ExternalHyperlink({
            link: href,
            children: [new TextRun({ ...runOpts, style: 'Hyperlink' })],
          }),
        )
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
    } else {
      out.push(...inlineToChildren(child, inherited, cs))
    }
  }
  return out
}

// 每个 cid 全局只写一组区间（Word 对同 id 多组 commentRange 判定文档损坏）；块间独立开闭
function inlineBlockChildren(node: PMNode, dt: DocTrack): ParagraphChildLike[] {
  const cs: CommentTrack = { cur: null, used: dt.used, ranges: dt.ranges, skipped: dt.skipped }
  const arr = inlineToChildren(node, {}, cs)
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
  const first = num(node.attrs?.indentFirst) * PX_TWIP
  const o: { left?: number; firstLine?: number; hanging?: number } = {}
  if (left) o.left = Math.round(left)
  if (first > 0) o.firstLine = Math.round(first)
  else if (first < 0) o.hanging = Math.round(-first)
  return Object.keys(o).length ? o : undefined
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

function blocksOf(nodes: PMNode[], depth = 0, dt: DocTrack = { used: new Set(), ranges: new Set(), skipped: new Set() }): (Paragraph | Table | TableOfContents)[] {
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
            spacing: { after: 60 },
          }),
        )
        out.push(...blocksOf(blocks.slice(1), depth, dt))
        out.push(...blocksOf(nested, depth + 1, dt))
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
      out.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(
            (r) =>
              new TableRow({
                // 表头行由行级 w:trPr/w:tblHeader 记账（TipTap 用 th 单元格类型表示）。
                // 只在命中时给属性：写成 tableHeader:false 会落 <w:tblHeader w:val="false"/>，
                // 而读侧按"有没有这个元素"判断，伪标记会把正文行错认成表头。
                ...(r.content ?? []).some((c) => c.type === 'tableHeader') ? { tableHeader: true } : {},
                children: (r.content ?? []).map((cell) => {
                  // TipTap 合并语义 colspan/rowspan → gridSpan + vMerge（docx 库内部展开 restart/continue）
                  const cs = Number(cell.attrs?.colspan ?? 1) || 1
                  const rs = Number(cell.attrs?.rowspan ?? 1) || 1
                  return new TableCell({
                    ...(cs > 1 ? { columnSpan: cs } : {}),
                    ...(rs > 1 ? { rowSpan: rs } : {}),
                    children: [new Paragraph({ children: inlineBlockChildren(cell, dt) })],
                  })
                }),
              }),
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
        spacing: { after: 120 },
      }),
    )
  }
  return out
}

export async function prosemirrorToDocxBytes(json: PMNode, meta?: DocMeta): Promise<Uint8Array> {
  const dt: DocTrack = { used: new Set(), ranges: new Set(), skipped: new Set() }
  const section: {
    children: (Paragraph | Table | TableOfContents)[]
    properties?: {
      page: { size: { width: number; height: number; orientation?: 'landscape' | 'portrait' }; margin: Record<string, number> }
      column?: { count: number; space: number; equalWidth: true; separate: false }
    }
    headers?: { default: Header }
    footers?: { default: Footer }
  } = { children: blocksOf(json.content ?? [], 0, dt) }
  {
    const pg = resolvePage(meta?.page)
    const twips = (mm: number) => Math.round(mm * MM_TWIPS)
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
  const doc = new Document({
    creator: 'OpenOffices',
    title: 'OpenOffices 文档',
    features: { updateFields: true },
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
    sections: [section],
  })
  // Packer.toBuffer 走 jszip 的 nodebuffer 通道，浏览器里没有 Buffer 会直接抛
  // 「nodebuffer is not supported by this platform」——应用内「导出 docx」一直就是坏的，
  // 只有 Node 侧结构测试能过。base64 两端都支持，解码后照样是同一份 zip 字节。
  const b64 = await Packer.toBase64String(doc)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
