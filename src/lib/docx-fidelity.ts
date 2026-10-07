// docx 保真导入：手工拆 word/document.xml，把 OOXML 的段落/运行属性翻成 TipTap 能解析的 HTML。
//
// 为什么绕开 mammoth：mammoth 只认"语义样式"（标题/列表/加粗），把 Word 里最常见的**直接格式**
// 全丢了——居中、首行缩进、字号字族字色、表格合并与列宽、分页符位置、批注的精确区间。中文文档的
// 排版多数是直接敲出来的，走 mammoth 打开后只剩"文字 + 标题"，看着就像内容少了半截。
//
// 分工：本模块只产正文 HTML（批注 span 按 commentRangeStart/End 原位包，不按锚文本猜位置）。
// 页眉页脚与页面设置仍走 docxToDocMeta，批注列表仍走 docxToComments。
// 抛错或拆不出块时调用方回退 mammoth。
//
// schema 边界（TipTap 侧没有对应属性，导入时刻意不硬塞，全部记进 warnings）：OLE 对象的**内容**。
// 表格边框/单元格底纹与竖排/上下标/表格缩进在 v0.38 起已经能读进 cell-style 与上下标 schema；
// 段落行距/段前后/底纹/边框（w:spacing/w:shd/w:pBdr）在 v0.39 起读进 paragraph-style schema；
// 脚注与尾注（word/footnotes.xml、word/endnotes.xml）在 v0.40 起读进 note 节点，正文摊在文末脚注区；
// 文本框（w:txbxContent）与公式（m:oMath）在 v0.41 起不再整块消失：前者展平为段落（位置与环绕不保），
// 后者线性化成 `x^2`、`(-b+√(b^2-4ac))/(2a)` 这类可读文本（结构不保）——"字没了"比"版式没保真"严重一级。
// SmartArt 与图表在 v0.42 起按各自数据部件（diagrams/dataN.xml 的 dgm:pt 树、charts/chartN.xml 的
// c:*Cache）出嵌套列表与数据表：字与数不再整块不见，但版式类型、配色、连线方向与坐标轴仍旧不还原。
// 域（field）在 v0.43 起分两种待遇：SEQ 题注号是纯顺序计数，一律按当前文档顺序现算（文件里的缓存
// 在别的工具编辑过之后会与实际序号不符）；PAGE/PAGEREF/DOCPROPERTY 这类我们算不出正确值的仍读缓存。
// 只有代码没有结果的域（交叉引用、别的工具写出的件）以前会静默变空，现在 REF 退回收尾书签所在段落
// 的文本，其余记一条"没有缓存结果，未重算"。OLE 嵌入对象的**内容**在 v0.44 起能取的都取：
// 复合文档里的原生文件（\x01Ole10Native）与直接放 zip 的部件都会展开，工作表出表格、嵌入文档递归展开，
// 取不出来的（Excel 97 的 BIFF、Visio 绘图、超过 24MB 的大件）才留"内容未提取"那行可见占位。
// 表格读侧的三笔度量账在 v0.97 起认全：逐格 w:tcW（gridCol 缺列/全零时的权威账）、行高 w:trHeight、
// 格边距 w:tblCellMar / w:tcMar（落进 cell-style 的 pad*/rowHeight 属性，docx/odoc 保存链路往返）；
// 段落边框的第五边 w:between 同轮接上：与下一段是同一串「相同边框与底纹」时落成前一段的下边框。
// 格边距从此是四层逐边合并（样式基座 → 表级 → 条件层 → 逐格），条件层就是 `w:tblStylePr` 的 tcMar
// 配 `w:tblLook` 的闸门——只有首行/末行/首列/末列四型会把边距落到实处，而 `w:val` 那枚十六进制从不被读。

import { all, allDesc, attr, attrL, attrNum, els, find, findDesc, findL, local, parseXml, textOf, type XEl } from './ooxml'
import { FieldEngine, fieldLabel, parseInstr, recomputable } from './docx-fields'
import { embedHtml, inlineFlatten, unwrapEmbed, type EmbedHtml } from './ole'
import { chartToHtml, smartArtToHtml } from './ooxml-graphics'
import { CELL_EDGES, CSS_BORDER_STYLE, eighthsToPx, rgb2hex } from './cell-style'
import { ooxmlLine } from './paragraph-style'
import { commentRowsOf, type DocComment } from './docx'
import { encodeNoteText } from './note-extension'

export interface DocxImport {
  html: string
  comments: DocComment[]
  /** 拆出的顶层块数；0 表示这份文件没认出来，调用方应回退 mammoth */
  blocks: number
  warnings: string[]
}

/** jszip 部件的最小视图（不为一次只读导入把 JSZip 的完整类型面拉进来） */
interface ZipPart {
  async(t: 'string'): Promise<string>
  async(t: 'base64'): Promise<string>
  async(t: 'uint8array'): Promise<Uint8Array>
}
interface ZipLike {
  file(path: string): ZipPart | null
}

// 单位换算：1440 twip = 1in = 96px（故 1px = 15 twip）；914400 EMU = 1in（1px = 9525 EMU）；字号按半点存
const TWIP_PX = 1 / 15
const EMU_PX = 1 / 9525
/** 段前/段后只写"按行"时的换算基准：一行按小四（12pt）单倍行距估 */
const LINE_UNIT_PX = 19
/** 长度保留两位小数：行距/段间距正是往返要保的那个量，取整会把 0.67px 变成 1px */
const px2 = (n: number) => Math.round(n * 100) / 100
const HP_PX = 2 / 3 // 半点 → px（pt = hp/2，px = pt×4/3）
const PT_PX = 4 / 3

// Word 高亮色名 → CSS（导入后落在 highlight mark 的 color 上，导出按 shading 写回）
const HL: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkred: '#8b0000',
  darkmagenta: '#8b008b',
  darkyellow: '#808000',
  darkgray: '#808080',
  gray50: '#808080',
  lightgray: '#c0c0c0',
  gray25: '#d9d9d9',
}

/**
 * 行内序列里的"块级插入物"：图片与分页符在 TipTap 里都是块级节点，段落放不下，
 * 所以它们把段落切成多块（Word 的"图片独立成行"本就是这个形态）。
 */
type Piece = { kind: 'inline'; html: string } | { kind: 'block'; html: string }

// ---- 小工具 ---------------------------------------------------------------

function on(el: XEl | undefined): boolean | undefined {
  if (!el) return undefined
  const v = attr(el, 'w:val')
  if (v === undefined) return true
  return !(v === '0' || v === 'false' || v === 'none')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 连续空格要在 HTML 里活下来（Word 用 xml:space="preserve" 表意，CSS 默认把空白折叠），
 * 故每串空白的第二个起换成 nbsp；单个空格保持普通空格以免影响断词。
 */
function escText(s: string): string {
  return esc(s).replace(/ {2,}/g, (run) => ' ' + '\u00a0'.repeat(run.length - 1))
}

/** `<w:x w:val="…">` 形式的取值 */
function val(el: XEl | undefined, name: string): string | undefined {
  return el ? attr(find(el, name), 'w:val') : undefined
}

/** `<w:x w:val="123">` 形式的数值 */
function valNum(el: XEl | undefined, name: string): number | undefined {
  const v = val(el, name)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function mimeOf(path: string): string | null {
  const e = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (e === 'png') return 'image/png'
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg'
  if (e === 'gif') return 'image/gif'
  if (e === 'bmp') return 'image/bmp'
  if (e === 'webp') return 'image/webp'
  if (e === 'svg') return 'image/svg+xml'
  return null
}

// rels 的 Target 相对 word/：可能是 media/image1.png、../styles.xml 或 /word/media/x.png
function normTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const out: string[] = []
  for (const p of ('word/' + target).split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

function wrap(tag: string, style: string, inner: string): string {
  return `<${tag}${style ? ` style="${style}"` : ''}>${inner}</${tag}>`
}

// ---- 样式表 ---------------------------------------------------------------

interface StyleInfo {
  id: string
  name: string
  type: string
  basedOn?: string
  rPr?: XEl
  pPr?: XEl
  /** 表样式的 w:tblPr（段落样式没有这一枚） */
  tblPr?: XEl
  /** 表样式自己的 w:tcPr：格底纹的基座层住这里（格边距不在这枚上，它在 tblPr/w:tblCellMar） */
  tcPr?: XEl
  /** w:default="1" 的那一枚：被表引用时它算一层，没被引用时不算；内建 TableNormal 由 Word 换自己的定义 */
  isDefault?: boolean
  /** 条件层 `w:tblStylePr`（一型一块，块里的 w:tcPr 同时说格边距与格底纹；顺序就是文档顺序） */
  tblStylePr?: XEl[]
  /** outlineLvl 或样式名推出的标题级别（1..9），非标题为 undefined */
  level?: number
  quote?: boolean
  preformatted?: boolean
}

interface StyleBook {
  byId: Map<string, StyleInfo>
}

function headingLevelOf(name: string): number | undefined {
  const n = name.trim().toLowerCase()
  const m = /^heading ([1-9])$/.exec(n) ?? /^标题\s*([1-9])$/.exec(n)
  if (m) return Number(m[1])
  if (n === 'title' || n === '标题') return 1
  return undefined
}

function readStyles(xml: string): StyleBook {
  const book: StyleBook = { byId: new Map() }
  if (!xml) return book
  const styles = find(parseXml(xml), 'w:styles')
  if (!styles) return book
  // docDefaults 不并入基准运行属性：它是"这份文档的默认字体"，而本应用自带版式默认值；
  // 逐 run 盖上 Calibri/宋体 11pt 会把应用级字体选择全部压掉，还会让 HTML 胖一倍。
  for (const s of all(styles, 'w:style')) {
    const id = attr(s, 'w:styleId')
    if (!id) continue
    const name = val(s, 'w:name') ?? ''
    const pPr = find(s, 'w:pPr')
    const info: StyleInfo = {
      id,
      name,
      type: attr(s, 'w:type') ?? 'paragraph',
      basedOn: val(s, 'w:basedOn'),
      isDefault: ['1', 'true'].includes(attr(s, 'w:default') ?? ''),
      rPr: find(s, 'w:rPr'),
      pPr,
      tblPr: find(s, 'w:tblPr'),
      tcPr: find(s, 'w:tcPr'),
      tblStylePr: all(s, 'w:tblStylePr'),
    }
    const outline = valNum(pPr, 'w:outlineLvl')
    if (outline !== undefined && outline >= 0 && outline <= 8) info.level = outline + 1
    info.level ??= headingLevelOf(name)
    const nm = name.trim().toLowerCase()
    if (nm === 'quote' || nm === 'intense quote' || nm === '引用' || nm === 'blockquote') info.quote = true
    if (nm === 'html preformatted' || nm === 'preformatted text' || nm === 'code' || nm === '预格式化')
      info.preformatted = true
    book.byId.set(id, info)
  }
  return book
}

/** 沿 basedOn 链自根向下（越靠后越具体，覆盖前者） */
function styleChain(book: StyleBook, id: string | undefined): StyleInfo[] {
  const out: StyleInfo[] = []
  const seen = new Set<string>()
  let cur = id ? book.byId.get(id) : undefined
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur)
    cur = cur.basedOn ? book.byId.get(cur.basedOn) : undefined
  }
  return out
}

/** 段落属性的合并视图：同名子元素后者覆盖前者（Word 的样式继承就这个语义） */
function mergePPr(list: (XEl | undefined)[]): XEl | undefined {
  let merged: XEl | undefined
  for (const add of list) {
    if (!add) continue
    if (!merged) {
      merged = add
      continue
    }
    const next: XEl = { name: '#merged', attrs: {}, children: [...merged.children] }
    for (const c of els(add)) {
      const old = find(next, c.name)
      if (old) next.children[next.children.indexOf(old)] = c
      else next.children.push(c)
    }
    merged = next
  }
  return merged
}

function styleView(book: StyleBook, id: string | undefined) {
  const chain = styleChain(book, id)
  let level: number | undefined
  let quote = false
  let preformatted = false
  for (const s of chain) {
    if (s.level !== undefined) level = s.level
    if (s.quote) quote = true
    if (s.preformatted) preformatted = true
  }
  return { level, quote, preformatted, chain, pPr: mergePPr(chain.map((s) => s.pPr)) }
}

// ---- 编号定义 -------------------------------------------------------------

interface Numbering {
  byId: Map<string, Map<number, { numFmt: string; start: number }>>
}

function readNumbering(xml: string): Numbering {
  const out: Numbering = { byId: new Map() }
  if (!xml) return out
  const num = find(parseXml(xml), 'w:numbering')
  if (!num) return out
  const abstract = new Map<string, Map<number, { numFmt: string; start: number }>>()
  for (const a of all(num, 'w:abstractNum')) {
    const id = attr(a, 'w:abstractNumId')
    if (!id) continue
    const levels = new Map<number, { numFmt: string; start: number }>()
    for (const l of all(a, 'w:lvl')) {
      levels.set(Number(attr(l, 'w:ilvl') ?? '0'), {
        numFmt: val(l, 'w:numFmt') ?? 'bullet',
        start: valNum(l, 'w:start') ?? 1,
      })
    }
    abstract.set(id, levels)
  }
  for (const n of all(num, 'w:num')) {
    const id = attr(n, 'w:numId')
    const aid = val(n, 'w:abstractNumId')
    if (id && aid) out.byId.set(id, abstract.get(aid) ?? new Map())
  }
  return out
}

// ---- 运行属性 → marks ------------------------------------------------------

interface RunProps {
  b?: boolean
  i?: boolean
  u?: boolean
  strike?: boolean
  color?: string
  hl?: string
  /** 半点 */
  sz?: number
  fonts?: string[]
  /** w:vertAlign：superscript / subscript（其余值视为 normal） */
  va?: 'sup' | 'sub'
}

const NONE: RunProps = {}

function readRPr(el: XEl | undefined, p: RunProps): RunProps {
  if (!el) return p
  const o: RunProps = { ...p }
  const b = on(find(el, 'w:b'))
  if (b !== undefined) o.b = b
  const i = on(find(el, 'w:i'))
  if (i !== undefined) o.i = i
  const st = on(find(el, 'w:strike'))
  if (st !== undefined) o.strike = st
  if (on(find(el, 'w:dstrike'))) o.strike = true
  const u = find(el, 'w:u')
  if (u) o.u = attr(u, 'w:val') !== 'none'
  const color = val(el, 'w:color')
  if (color && color.toLowerCase() !== 'auto') o.color = '#' + color.toLowerCase().replace(/^#/, '')
  const hlv = val(el, 'w:highlight')
  if (hlv) o.hl = HL[hlv.toLowerCase()] ?? '#ffff00'
  const sz = valNum(el, 'w:sz')
  if (sz) o.sz = sz
  const va = (val(el, 'w:vertAlign') ?? '').toLowerCase()
  if (va === 'superscript') o.va = 'sup'
  else if (va === 'subscript') o.va = 'sub'
  else if (va === 'normal' || va === 'baseline') o.va = undefined
  const rf = find(el, 'w:rFonts')
  if (rf) {
    const fams: string[] = []
    const ascii = attr(rf, 'w:ascii') ?? attr(rf, 'w:hAnsi')
    if (ascii) fams.push(ascii)
    const ea = attr(rf, 'w:eastAsia')
    if (ea && !fams.includes(ea)) fams.push(ea)
    if (fams.length) o.fonts = fams
  }
  return o
}

/** 段落样式链 → 段落标记 run（pPr/rPr）：本段文字的基准运行属性（docDefaults 故意不参与，见 readStyles） */
function baseRunProps(chain: StyleInfo[], pPr: XEl | undefined): RunProps {
  let p = NONE
  for (const s of chain) if (s.rPr) p = readRPr(s.rPr, p)
  const paraMark = pPr ? find(pPr, 'w:rPr') : undefined
  if (paraMark) p = readRPr(paraMark, p)
  return p
}

function cssOf(p: RunProps): string {
  const bits: string[] = []
  // 字体名要单引号：这段 CSS 会落进 style="…" 属性里，双引号会当场截断属性
  if (p.fonts?.length) bits.push(`font-family: ${p.fonts.map((f) => `'${f.replace(/'/g, '')}'`).join(', ')}`)
  if (p.sz) bits.push(`font-size: ${Math.round(p.sz * HP_PX)}px`)
  if (p.color) bits.push(`color: ${p.color}`)
  return bits.join('; ')
}

/** 套 marks：从内到外 样式属性 → 高亮 → 删除线 → 下划线 → 斜体 → 粗体 */
function marked(inner: string, p: RunProps): string {
  if (!inner) return ''
  let s = inner
  const css = cssOf(p)
  if (css) s = `<span style="${css}">${s}</span>`
  if (p.hl) s = `<mark data-color="${p.hl}" style="background-color: ${p.hl}; color: inherit">${s}</mark>`
  if (p.strike) s = `<s>${s}</s>`
  if (p.u) s = `<u>${s}</u>`
  if (p.i) s = `<em>${s}</em>`
  if (p.b) s = `<strong>${s}</strong>`
  // 上下标是最外层：Word 把 vertAlign 记在 rPr 里，与粗斜体同级，套在外面读回来不改变含义
  if (p.va === 'sup') s = `<sup>${s}</sup>`
  else if (p.va === 'sub') s = `<sub>${s}</sub>`
  return s
}

// ---- 列表栈 ---------------------------------------------------------------

/**
 * 只管"开到哪一层、上一项是否还开着"，返回要追加的 HTML 片段。
 * 进深层时父 <li> 保持打开——嵌套列表必须落在父项里面，bulletList 的内容只收 listItem。
 */
class ListState {
  private stack: { id: string; level: number; ordered: boolean }[] = []
  /** numId → 这一串列表的基准层：文档写 ilvl=2 而上游没有可挂靠的父项时，那层"2"我们当 0 用 */
  private base = new Map<string, number>()

  before(level: number, ordered: boolean, id: string): string {
    let s = ''
    // 跳档不造中间层：Word 常写「ilvl 直接从 0 跳到 2」（父项在上一页、或列表被手改过），
    // 凭空补出来的每一层都是一个空条目，屏幕上就是一排没有字的子弹。
    // 折算按 numId 记基准层，同串的后续项照同一个折算走——否则每来一项往下多爬一层，兄弟被当成子女。
    if (!this.stack.length) this.base.set(id, level)
    const prev = this.stack[this.stack.length - 1]
    const eff = Math.max(0, Math.min(level - (this.base.get(id) ?? 0), (prev?.level ?? level) + 1))
    while (this.stack.length && this.stack[this.stack.length - 1].level > eff) s += this.pop()
    const top = this.stack[this.stack.length - 1]
    if (top && top.level === eff) {
      if (top.id !== id) s += this.pop()
      else return s + '</li><li>'
    }
    while (!this.stack.length || this.stack[this.stack.length - 1].level < eff) {
      s += `<${ordered ? 'ol' : 'ul'}><li>`
      this.stack.push({ id, level: (this.stack[this.stack.length - 1]?.level ?? -1) + 1, ordered })
    }
    return s
  }

  private pop(): string {
    const t = this.stack.pop()!
    return `</li></${t.ordered ? 'ol' : 'ul'}>`
  }

  get open(): boolean {
    return this.stack.length > 0
  }

  flush(): string {
    let s = ''
    while (this.stack.length) s += this.pop()
    return s
  }
}

// ---- 行内遍历上下文 ---------------------------------------------------------

interface InlineState {
  pieces: Piece[]
  /** cid → 该批注区间在本段起始的下标 */
  openAt: Map<number, number>
  /** 域代码深度与"是否已到结果显示段" */
  fld: number
  show: boolean
  /** 从外到内的域栈：SEQ 这类要现算的在 begin 就把指令原文读全，结果段用现算值顶掉缓存 */
  stack: OpenField[]
  /** 已产出的行内容片计数：判断"这个域到底有没有产出结果"用（域没有结果时正文会静默变空） */
  outSeq: number
  /** 下一段文字必须另起一片：批注区间按片段下标切分，与邻片合并就会把边界吃掉 */
  split: boolean
  /** 格内流：文本框展平时要沿用同一个判定（格里的列表不并进外层列表栈） */
  inCell: boolean
}

/** 一个开着的域：instr 是攒起来的域代码原文，suppress 表示结果段由我们现算、不读文件里的缓存 */
interface OpenField {
  instr: string
  cmd: string
  arg: string
  switches: string[]
  suppress: boolean
  /** 已由我们现算产出过结果（SEQ 走这条），避免 separate 与 end 两处重复计数 */
  done: boolean
  /** 进入时 push() 的计数与片段数，出口比对就知道缓存有没有产出（块级产出只加片段数） */
  at: number
  piecesAt: number
}

function push(st: InlineState, html: string) {
  if (!html) return
  st.outSeq += 1
  const last = st.pieces[st.pieces.length - 1]
  if (last?.kind === 'inline' && !st.split) last.html += html
  else st.pieces.push({ kind: 'inline', html })
  st.split = false
}

/** 最内层开着的域是否由我们现算（现算时文件里的缓存文本要压掉，否则一份编号出两遍） */
function suppressField(st: InlineState): boolean {
  const f = st.stack[st.stack.length - 1]
  return !!f && f.suppress
}

/** 批注区间原位包 span：块级插入物（图片/分页符）前的行内容先闭合，块原样保留 */
function wrapComment(pieces: Piece[], from: number, cid: number): Piece[] {
  const tail = pieces.slice(from)
  const out: Piece[] = []
  let buf = ''
  for (const p of tail) {
    if (p.kind === 'block') {
      if (buf) out.push({ kind: 'inline', html: `<span data-oo-comment="${cid}">${buf}</span>` })
      buf = ''
      out.push(p)
    } else buf += p.html
  }
  if (buf) out.push({ kind: 'inline', html: `<span data-oo-comment="${cid}">${buf}</span>` })
  return out
}

// ---- 导入器 ---------------------------------------------------------------

class Fidelity {
  /** 告警文案 → 出现次数：一份文件里三个文本框是同一条边界，但"三处"比"一项"更有信息量 */
  warnings = new Map<string, number>()
  comments: DocComment[] = []  /** 已开未关的批注区间 id：跨段续挂（mark 不能跨块，故每段各一枚 span） */
  private openRanges = new Set<number>()
  private rels = new Map<string, { target: string; external: boolean }>()
  private media = new Map<string, Promise<string | null>>()
  /** 图形类部件（diagrams/dataN.xml、charts/chartN.xml）的 XML 文本缓存 */
  private parts = new Map<string, Promise<string>>()
  private zip: ZipLike | null = null
  /** 嵌入部件（word/embeddings/*）的二进制缓存：同一个对象被两处引用时只解一次 */
  private bins = new Map<string, Promise<Uint8Array | null>>()
  /** 书签表与 SEQ 计数（交叉引用可以指向后面的段落，所以正文渲染前先扫一遍整篇） */
  private fields = new FieldEngine()
  /** w:id → 正文（脚注与尾注各自的编号空间，故分两张表）；引用处按此查正文 */
  private noteBodies: Record<'footnote' | 'endnote', Map<number, string>> = {
    footnote: new Map(),
    endnote: new Map(),
  }

  constructor(
    private book: StyleBook,
    private numbering: Numbering,
    /** 嵌套深度：文档里嵌文档再嵌文档会没完，展平到这一层就停手记边界 */
    private depth = 0,
  ) {}

  private warn(msg: string) {
    this.warnings.set(msg, (this.warnings.get(msg) ?? 0) + 1)
  }

  /** 出口形态：按首次出现顺序，重复的写成「文案×N」 */
  warningList(): string[] {
    return [...this.warnings].map(([m, n]) => (n > 1 ? `${m}×${n}` : m))
  }

  load(zip: ZipLike) {
    this.zip = zip
  }

  setRels(xml: string) {
    for (const r of all(find(parseXml(xml), 'Relationships'), 'Relationship')) {
      const id = attr(r, 'Id')
      const target = attr(r, 'Target')
      if (!id || !target) continue
      const external = (attr(r, 'TargetMode') ?? '') === 'External'
      this.rels.set(id, { target: external ? target : normTarget(target), external })
    }
  }

  /**
   * 脚注与尾注正文：document.xml 里的引用只带 w:id，正文在 word/footnotes.xml 与 word/endnotes.xml。
   * 部件缺失时这里只是空表——引用处查不到正文才记告警（同一句话 Set 去重，不会一条一段地刷屏）。
   */
  setNotes(footnotesXml: string, endnotesXml: string) {
    const warn = (m: string) => this.warn(m)
    this.noteBodies.footnote = noteBodiesOf(footnotesXml, 'footnote', warn)
    this.noteBodies.endnote = noteBodiesOf(endnotesXml, 'endnote', warn)
  }

  setComments(commentsXml: string, extXml: string) {
    this.comments = commentRowsOf(commentsXml, extXml)
  }

  async run(documentXml: string): Promise<{ html: string; blocks: number }> {
    const doc = parseXml(documentXml)
    // w:body 是 w:document 的孩子，而 parseXml 的根是 '#doc'，所以要深找一层
    const body = findDesc(doc, 'w:body')
    if (!body) throw new Error('document.xml 缺 w:body')
    this.fields = FieldEngine.from(body)
    const list = new ListState()
    const r = await this.sequence(body.children, list)
    return { html: r.html + list.flush(), blocks: r.items }
  }

  /**
   * 块序列：段落 / 表格 / 内容控件递归展开。sectPr（分节符）由 docxToDocMeta 读成页面设置，
   * 这里忽略——本应用是单一版心模型，一节一种纸张不支持。
   */
  private async sequence(
    nodes: (XEl | string)[],
    list: ListState,
    inCell = false,
  ): Promise<{ html: string; items: number }> {
    let html = ''
    let items = 0
    // 带 下标 走：w:between 要看相邻的下一段是不是同一串边框（见 betweenOfSiblings）
    for (let ni = 0; ni < nodes.length; ni++) {
      const n = nodes[ni]
      if (typeof n === 'string') continue
      const t = local(n.name)
      if (t === 'sectPr' || t === 'altChunk') continue
      if (t === 'sdt' || t === 'sdtContent') {
        // Word 的目录是内容控件里的域缓存：本应用导出的是原生 TOC 字段，展开成正文会重复一份
        const gallery = findDesc(n, 'docPartGallery')
        // 画廊名在 w:val 属性里而非文字内容（自闭合元素），两处都认一下
        if (gallery && /table of contents/i.test(`${attrL(gallery, 'val') ?? ''} ${textOf(gallery)}`)) {
          this.warn('目录（TOC 内容控件）已跳过，用本应用的「插入目录」重建')
          continue
        }
        const r = await this.sequence(n.children, list, inCell)
        html += r.html
        items += r.items
        continue
      }
      // Word 给同一个构件常写新旧两条外壳（mc:Choice 走新命名空间，mc:Fallback 走 legacy VML），
      // 两条的正文是同一份。全收下就会翻倍，所以只取一条：Choice 优先，它什么都没产出才退回 Fallback。
      if (t === 'AlternateContent') {
        let produced = false
        for (const branch of [findL(n, 'Choice'), findL(n, 'Fallback')]) {
          if (!branch || produced) continue
          const r = await this.sequence(branch.children, list, inCell)
          html += r.html
          items += r.items
          if (r.html) produced = true
        }
        continue
      }
      if (t === 'p') {
        // 列表项之间由 ListState 负责开合；非列表段落出现即把整串列表关掉
        const numbered = !inCell && this.numOf(n).id !== undefined
        if (!numbered && list.open) html += list.flush()
        html += await this.paragraph(n, list, inCell, this.betweenOfSiblings(nodes, ni))
        items += 1
        continue
      }
      if (t === 'tbl') {
        if (list.open) html += list.flush()
        html += await this.table(n)
        items += 1
        continue
      }
      this.warn(`正文构造 <${n.name}> 未导入`)
    }
    return { html, items }
  }

  /** numPr：段落直接给的优先，否则取样式链上声明的 */
  private numOf(el: XEl): { id?: string; level: number } {
    const pPr = find(el, 'w:pPr')
    const direct = pPr ? val(find(pPr, 'w:numPr'), 'w:numId') : undefined
    const directLv = pPr ? valNum(find(pPr, 'w:numPr'), 'w:ilvl') : undefined
    if (direct !== undefined) return { id: direct, level: directLv ?? 0 }
    const styleId = pPr ? val(pPr, 'w:pStyle') : undefined
    const chain = styleChain(this.book, styleId)
    for (let i = chain.length - 1; i >= 0; i--) {
      const np = chain[i].pPr ? find(chain[i].pPr!, 'w:numPr') : undefined
      const v = np ? attr(find(np, 'w:numId'), 'w:val') : undefined
      if (v !== undefined) return { id: v, level: (np ? valNum(np, 'w:ilvl') : undefined) ?? directLv ?? 0 }
    }
    return { level: directLv ?? 0 }
  }

  /** 段落的生效 pPr：样式链给基线，段落自己的 pPr 覆盖同名项（Word 的直接格式优先于样式） */
  private effPPrOf(el: XEl): { pPr?: XEl; effPPr?: XEl } {
    const pPr = find(el, 'w:pPr')
    const view = styleView(this.book, pPr ? val(pPr, 'w:pStyle') : undefined)
    return { pPr, effPPr: mergePPr([view.pPr, pPr]) }
  }

  /**
   * 段落边框/底纹签名：四边 + between + 底纹全部一致才算 Word 说的「相同边框与底纹」。
   * 边框与底纹都取生效 pPr（样式链并入），样式里声明的边框同样参与同一串的判定。
   */
  private paraBorderSig(p: XEl): { sig: string; between?: string } | null {
    const { effPPr } = this.effPPrOf(p)
    const pbdr = effPPr ? find(effPPr, 'w:pBdr') : undefined
    if (!pbdr) return null
    const edges = borderEdges(pbdr)
    return {
      sig: JSON.stringify([
        edges.top ?? null,
        edges.right ?? null,
        edges.bottom ?? null,
        edges.left ?? null,
        edges.between ?? null,
        shadingHex(find(effPPr, 'w:shd')),
      ]),
      between: edges.between,
    }
  }

  /**
   * w:between（第五边）的落点：本段带 between、紧邻的下一段是 w:p 且签名一致时，
   * between 落成**本段**的下边框（Word 的 between 只画在「相同段落之间」，末段不画——
   * 这个方向天然满足：首段起每段都有下边、末段没有）。中间隔一张表、一个非段落构件即断串；
   * 元素之间的空白文本节点不算构件（手写/整理过的 XML 常带换行）。
   */
  private betweenOfSiblings(nodes: (XEl | string)[], i: number): string {
    const cur = nodes[i]
    if (typeof cur === 'string' || local(cur.name) !== 'p') return ''
    const curSig = this.paraBorderSig(cur)
    if (!curSig?.between) return ''
    let k = i + 1
    while (k < nodes.length && typeof nodes[k] === 'string') k++
    const nx = nodes[k]
    if (!nx || typeof nx === 'string' || local(nx.name) !== 'p') return ''
    const nxSig = this.paraBorderSig(nx)
    return nxSig && nxSig.sig === curSig.sig ? (curSig.between ?? '') : ''
  }

  private async paragraph(el: XEl, list: ListState, inCell: boolean, betweenCss = ''): Promise<string> {
    const { pPr, effPPr } = this.effPPrOf(el)
    const view = styleView(this.book, pPr ? val(pPr, 'w:pStyle') : undefined)
    const base = baseRunProps(view.chain, effPPr)

    let prefix = ''
    const num = inCell ? { level: 0 } : this.numOf(el)
    if (num.id !== undefined) {
      const def = this.numbering.byId.get(num.id)?.get(num.level)
      prefix = list.before(num.level, !!def && def.numFmt !== 'bullet', num.id)
    }

    const pieces = await this.inline(el, base, inCell)
    if (view.preformatted) return prefix + `<pre><code>${escText(plainText(el))}</code></pre>`

    const style = this.paraCss(effPPr, betweenCss)
    const tag = view.level && view.level <= 4 ? `h${view.level}` : 'p'
    const body = this.layout(tag, style, pieces)
    return view.quote ? prefix + `<blockquote>${body}</blockquote>` : prefix + body
  }

  /**
   * 段落样式 → CSS：对齐 + 缩进（lib/indent-extension.ts）+ 行距与段前后 + 底纹 + 四边边框
   * （后三项落在 lib/paragraph-style.ts 的属性上）
   */
  private paraCss(pPr: XEl | undefined, betweenCss = ''): string {
    const bits: string[] = []
    const jc = val(pPr, 'w:jc')
    const align =
      jc === 'center'
        ? 'center'
        : jc === 'right'
          ? 'right'
          : jc === 'both' || jc === 'distribute'
            ? 'justify'
            : jc === 'left'
              ? 'left'
              : undefined
    if (align) bits.push(`text-align: ${align}`)
    const ind = pPr ? find(pPr, 'w:ind') : undefined
    if (ind) {
      const left = attrNum(ind, 'w:left') ?? attrNum(ind, 'w:start')
      const hang = attrNum(ind, 'w:hanging')
      const right = attrNum(ind, 'w:right') ?? attrNum(ind, 'w:end')
      if (left) bits.push(`margin-left: ${Math.round(left * TWIP_PX)}px`)
      if (right) bits.push(`margin-right: ${Math.round(right * TWIP_PX)}px`)
      // firstLineChars 是"字符数×100"（Word 同时会写 firstLine 的 twips 值）；只给前者时按 16px 字宽估
      const first = attrNum(ind, 'w:firstLine')
      const firstChars = attrNum(ind, 'w:firstLineChars')
      const firstPx = first ? Math.round(first * TWIP_PX) : firstChars ? Math.round((firstChars / 100) * 16) : 0
      if (firstPx) bits.push(`text-indent: ${firstPx}px`)
      else if (hang) bits.push(`text-indent: ${-Math.round(hang * TWIP_PX)}px`)
    }
    const sp = pPr ? find(pPr, 'w:spacing') : undefined
    if (sp) {
      const ln = ooxmlLine(attrNum(sp, 'w:line'), attr(sp, 'w:lineRule'), (n) => px2(n * TWIP_PX))
      if (ln.length === 2) {
        const [v, rule] = ln
        // 倍数写成无单位（CSS 的 line-height 数值就是倍数），绝对值写成 px
        bits.push(rule === 'auto' ? `line-height: ${v}` : `line-height: ${v}px`)
        // 最小值行距 CSS 表达不了，就地记一笔让导出去认它
        if (rule === 'atLeast') bits.push('--oof-lr: atLeast')
      }
      const before = this.spaceOf(sp, 'w:before', 'w:beforeLines')
      const after = this.spaceOf(sp, 'w:after', 'w:afterLines')
      // 0 是有意义的：Word 用 after="0" 压掉样式里那段间距，不能用真值判断把它当没声明
      if (before !== undefined) bits.push(`margin-top: ${before}px`)
      if (after !== undefined) bits.push(`margin-bottom: ${after}px`)
    }
    const fill = shadingHex(find(pPr, 'w:shd'))
    if (fill) bits.push(`background-color: ${fill}`)
    const pbdr = pPr ? find(pPr, 'w:pBdr') : undefined
    if (pbdr) {
      const edges = borderEdges(pbdr)
      for (const edge of CELL_EDGES) {
        const v = edges[edge]
        if (v) bits.push(`border-${edge}: ${v}`)
      }
      // w:between（第五边）：与下一段是同一串时落成本段下边框；显式声明了 w:bottom 时
      // between 是冗余的，让位——两条都画会在同一条缝上叠出两根线
      if (betweenCss && edges.bottom === undefined) bits.push(`border-bottom: ${betweenCss}`)
      // 段落的边框离字有 w:space（磅）距离，schema 里没有 padding 这一层，丢了不假装在
      if (all(pbdr, 'w:top').some((e) => (attrNum(e, 'w:space') ?? 0) > 1)) this.warn('段落边框与文字的间距未保留')
    }
    return bits.join('; ')
  }

  /**
   * 段前/段后：优先 twips 的 `w:before`，只有"按行"写法时退到 `w:beforeLines`（值是行数×100）。
   * 行的绝对高度取决于字号与行距，这里按小四（12pt）单倍行距的 19px 估，并记一条告警说明是估的。
   */
  private spaceOf(sp: XEl, twips: string, lines: string): number | undefined {
    const tw = attrNum(sp, twips)
    if (tw !== undefined) return px2(tw * TWIP_PX)
    const ln = attrNum(sp, lines)
    if (ln === undefined || ln === 0) return undefined
    this.warn(`段前/段后按「行」计（${local(sp.name)} ${lines}），已按 19px/行 估算`)
    return Math.round((ln / 100) * LINE_UNIT_PX * 100) / 100
  }

  /** 行内片段落成块：块级插入物（图片/分页符）把段落切开；纯空段仍出一块以保留空行 */
  private layout(tag: string, style: string, pieces: Piece[]): string {
    let out = ''
    let buf = ''
    let any = false
    for (const p of pieces) {
      any = true
      if (p.kind === 'block') {
        if (buf) out += wrap(tag, style, buf)
        buf = ''
        out += p.html
        continue
      }
      buf += p.html
    }
    if (buf || !any) out += wrap(tag, style, buf)
    return out
  }

  // --- 行内 ---

  private async inline(el: XEl, base: RunProps, inCell: boolean): Promise<Piece[]> {
    // 跨段批注：上一段开着没关的区间，在本段开头继续（mark 不能跨块，故每段各一枚 span）
    const openAt = new Map<number, number>()
    for (const cid of this.openRanges) openAt.set(cid, 0)
    const st: InlineState = { pieces: [], openAt, fld: 0, show: false, stack: [], outSeq: 0, split: false, inCell }
    await this.children(el, base, st)
    for (const [cid, from] of st.openAt) {
      st.pieces.splice(from, st.pieces.length - from, ...wrapComment(st.pieces, from, cid))
      st.openAt.delete(cid)
    }
    return st.pieces
  }

  private async children(el: XEl, props: RunProps, st: InlineState): Promise<void> {
    for (const c of el.children) {
      if (typeof c !== 'string') await this.visit(c, props, st)
    }
  }

  private async visit(node: XEl, props: RunProps, st: InlineState): Promise<void> {
    const t = local(node.name)
    switch (t) {
      // 段落属性、书签、校对标记、已删除内容：都不产出可见文字
      case 'pPr':
      case 'proofErr':
      case 'bookmarkStart':
      case 'bookmarkEnd':
      case 'commentReference':
      case 'lastRenderedPageBreak':
      case 'delInstrText':
      case 'delText':
      case 'del':
      case 'moveFrom':
        return
      case 'instrText': {
        // 域代码原文本身不显示，但 SEQ/REF 要靠它才知道该现算什么
        const f = st.stack[st.stack.length - 1]
        if (f) f.instr += textOf(node)
        return
      }
      case 'commentRangeStart': {
        const cid = Number(attr(node, 'w:id'))
        if (Number.isFinite(cid)) {
          st.openAt.set(cid, st.pieces.length)
          st.split = true
          this.openRanges.add(cid)
        }
        return
      }
      case 'commentRangeEnd': {
        const cid = Number(attr(node, 'w:id'))
        this.openRanges.delete(cid)
        const from = st.openAt.get(cid)
        if (from === undefined) return
        st.pieces.splice(from, st.pieces.length - from, ...wrapComment(st.pieces, from, cid))
        st.openAt.delete(cid)
        st.split = true
        return
      }
      case 'fldChar': {
        const k = attr(node, 'w:fldCharType') ?? attr(node, 'w:type')
        if (k === 'begin') {
          st.fld += 1
          st.show = false
          st.stack.push({ instr: '', cmd: '', arg: '', switches: [], suppress: false, done: false, at: st.outSeq, piecesAt: st.pieces.length })
        } else if (k === 'separate') {
          st.show = true
          const f = st.stack[st.stack.length - 1]
          if (f && !f.cmd) this.resolveField(f, props, st)
        } else if (k === 'end') {
          st.fld = Math.max(0, st.fld - 1)
          st.show = false
          const f = st.stack.pop()
          if (f) this.closeField(f, props, st)
        }
        return
      }
      case 'br':
        if (attr(node, 'w:type') === 'page') st.pieces.push({ kind: 'block', html: PAGE_BREAK })
        else push(st, '<br>')
        return
      case 'cr':
        push(st, '<br>')
        return
      case 'tab':
        push(st, '\u00a0\u00a0\u00a0\u00a0')
        return
      case 'noBreakHyphen':
        push(st, '-')
        return
      case 'sym':
        this.warn('符号（w:sym）未导入')
        return
      case 'footnoteReference':
      case 'endnoteReference': {
        const kind: 'footnote' | 'endnote' = t === 'endnoteReference' ? 'endnote' : 'footnote'
        const body = this.noteBodies[kind].get(attrNum(node, 'w:id') ?? NaN)
        if (body === undefined) {
          this.warn(`${kind === 'endnote' ? '尾注' : '脚注'}正文缺失`)
          return
        }
        push(st, noteSpan(kind, body))
        return
      }
      case 'object': {
        // 预览位图常是 EMF/WMF（浏览器解不了），能出图就出图；出不了图也要在正文里留一行可见占位，
        // 否则"这里原本有一个嵌入的 Excel 工作表"这件事在打开的文档里彻底看不见，只在状态栏闪一下
        const img = await this.bitmap(node)
        if (img) st.pieces.push({ kind: 'block', html: img })
        const ole = findDesc(node, 'OLEObject')
        const prog = attr(ole, 'ProgID') ?? attr(ole, 'Type')
        const rel = this.rels.get(attrL(ole, 'id') ?? '')
        const file = rel?.target.split('/').pop() ?? ''
        const what = [prog, file].filter(Boolean).join('，')
        // 先试内容提取（v0.44）：嵌入的工作表/文档/CSV 里有真字，取到了就不该再写"内容未提取"
        const body = rel && !rel.external ? await this.embedContent(rel.target, file) : null
        if (body?.html) {
          // 单元格放不下一张嵌套表（本读侧对嵌套表格一律"展平为段落"），硬塞等于让
          // ProseMirror 的内容表达式把整块字丢掉；压成行文本至少字还在，并如实记一条
          if (st.inCell) {
            st.pieces.push({ kind: 'inline', html: inlineFlatten(body.html) })
            this.warn('单元格里的嵌入内容已展平为文字')
          } else st.pieces.push({ kind: 'block', html: body.html })
          for (const n of body.notes) this.warn(n)
          return
        }
        if (!img)
          st.pieces.push({
            kind: 'block',
            html: `<p>〔嵌入对象${what ? `：${esc(what)}` : ''}，内容未提取〕</p>`,
          })
        for (const n of body?.notes ?? []) this.warn(n)
        this.warn(`嵌入对象${prog ? `（${prog}）` : ''}未导入`)
        return
      }
      case 'AlternateContent': {
        // 同一构件的新旧两条外壳（mc:Choice + mc:Fallback），正文是同一份：Choice 有产出就不看 Fallback
        let produced = false
        for (const branch of [findL(node, 'Choice'), findL(node, 'Fallback')]) {
          if (!branch || produced) continue
          const before = st.pieces.length
          await this.children(branch, props, st)
          if (st.pieces.length > before) produced = true
        }
        return
      }
      case 'oMath':
      case 'oMathPara': {
        // OMML 结构（分式、根号、矩阵）TipTap 侧没有承载它的节点，线性化成可读文本：
        // 走默认的 children 会把 m:t 的字符粘成 "a2b2"，这里至少把 a/b、x^2、√y 那层意思写出来
        if (st.fld > 0 && (!st.show || suppressField(st))) return
        this.warn('公式（OMML）已线性化为文本，结构（分式/根号/上下标/矩阵）不保真')
        push(st, marked(escText(ommlLinear(node)).replace(/\u0001/g, '<br>'), props))
        return
      }
      case 'drawing':
      case 'pict': {
        const html = await this.drawing(node, st.inCell)
        if (html) st.pieces.push({ kind: 'block', html })
        return
      }
      case 'hyperlink': {
        const rid = attrL(node, 'id')
        const rel = rid ? this.rels.get(rid) : undefined
        const anchor = attr(node, 'w:anchor')
        // 子状态：链接内的批注区间若没在链接里闭合，下标要按"追加到主序列的位置"换算；
        // 域栈必须共用（超链接里开着域、域里套超链接都是常见写法），产出计数按增量并回主状态
        const sub: InlineState = {
          pieces: [],
          openAt: new Map(),
          fld: st.fld,
          show: st.show,
          stack: st.stack,
          outSeq: 0,
          split: false,
          inCell: st.inCell,
        }
        await this.children(node, props, sub)
        st.fld = sub.fld
        st.show = sub.show
        st.outSeq += sub.outSeq
        const base = st.pieces.length
        for (const [cid, from] of sub.openAt) st.openAt.set(cid, base + from)
        const href = rel?.external ? rel.target : anchor ? `#${anchor}` : undefined
        if (!href) {
          for (const p of sub.pieces) st.pieces.push(p)
          st.outSeq += sub.pieces.length
          return
        }
        for (const p of sub.pieces)
          st.pieces.push(p.kind === 'inline' ? { kind: 'inline', html: `<a href="${esc(href)}">${p.html}</a>` } : p)
        st.outSeq += sub.pieces.length
        return
      }
      case 'fldSimple': {
        // 简单域把代码写在属性上、结果当自己的孩子：同一条 SEQ 在这里也要现算，
        // 否则只有代码没有结果的那些（别的工具写的件）会静默变成空
        const f: OpenField = {
          instr: attr(node, 'w:instr') ?? '',
          cmd: '',
          arg: '',
          switches: [],
          suppress: false,
          done: false,
          at: st.outSeq,
          piecesAt: st.pieces.length,
        }
        if (!this.resolveField(f, props, st)) {
          await this.children(node, props, st)
          this.closeField(f, props, st)
        }
        return
      }
      // 容器类：原样下钻
      case 'sdt':
      case 'sdtContent':
      case 'ins':
      case 'customXml':
      case 'smartTag':
      case 'moveTo':
      case 'bdo':
      case 'dir':
        await this.children(node, props, st)
        return
      case 'r': {
        const rPr = find(node, 'w:rPr')
        let rp = props
        if (rPr) {
          const cs = val(rPr, 'w:rStyle')
          for (const s of styleChain(this.book, cs)) if (s.rPr) rp = readRPr(s.rPr, rp)
          rp = readRPr(rPr, rp)
        }
        // 一个 run 里文字与图片/域标记可以穿插，所以先攒文字、遇到非文字构件就落盘
        let text = ''
        const flush = () => {
          if (!text) return
          push(st, marked(escText(text).replace(/\u0001/g, '<br>'), rp))
          text = ''
        }
        for (const c of node.children) {
          if (typeof c === 'string') continue
          const ct = local(c.name)
          if (ct === 't') {
            if (st.fld > 0 && (!st.show || suppressField(st))) continue
            text += textOf(c)
          } else if (ct === 'br') {
            if (attr(c, 'w:type') === 'page') {
              flush()
              st.pieces.push({ kind: 'block', html: PAGE_BREAK })
              continue
            }
            text += '\u0001'
          } else if (ct === 'tab') text += '\u00a0\u00a0\u00a0\u00a0'
          else if (ct === 'noBreakHyphen') text += '-'
          else {
            flush()
            await this.visit(c, rp, st)
          }
        }
        flush()
        return
      }
      default:
        await this.children(node, props, st)
        return
    }
  }

  // --- 域：能现算的现算，算不了的按缓存读并说清楚 ---

  /**
   * 指令读全之后先判一次：SEQ 是纯顺序计数，缓存值在别的工具编辑过之后会与文档顺序不符
   * （1、2、2、5 这种），所以一律按当前遇到第几枚同名 SEQ 现算，并压掉文件里的结果文本。
   * 返回 true 表示结果已由我们产出。
   */
  private resolveField(f: OpenField, props: RunProps, st: InlineState): boolean {
    if (f.done) return true
    const i = parseInstr(f.instr)
    if (!i.cmd) return false
    f.cmd = i.cmd
    f.arg = i.arg
    f.switches = i.switches
    if (!recomputable(i)) return false
    f.done = true
    f.suppress = true
    push(st, marked(escText(this.fields.seqValue(i.arg, i.switches)), props))
    return true
  }

  /** 域闭合：有缓存结果就用它（PAGE/PAGEREF 这类我们算不了），什么都没有时 REF 退到书签所在段落文本 */
  private closeField(f: OpenField, props: RunProps, st: InlineState) {
    if (f.done) return
    // 有的写件把结果直接跟在代码后面、不写 separate：这种 SEQ 到出口才读得全指令，照样现算
    if (!f.cmd && this.resolveField(f, props, st)) return
    if (!f.cmd) return
    if (st.outSeq > f.at || st.pieces.length > f.piecesAt) return
    if (f.cmd === 'REF' && f.arg) {
      const t = this.fields.refText(f.arg)
      if (t) {
        push(st, marked(escText(t), props))
        this.warn(`交叉引用（${f.arg}）没有缓存结果，已按书签所在段落文本补`)
        return
      }
    }
    this.warn(`域（${fieldLabel(f)}）没有缓存结果，未重算`)
  }

  // --- 图片 ---

  // --- 图形：位图、文本框 ---

  /**
   * 一个 drawing/pict 里可能同时有位图与文本框，也可能只有文本框。
   * 文本框（w:txbxContent）里的正文原来会整块消失——那是"字没了"，比版式没保真严重一级，
   * 所以这里把它展平成正经的段落块落进文档流，位置与文字环绕仍旧只记一条告警。
   * SmartArt 与图表同理（v0.42 起）：字与数在 rels 指向的另一份部件里，见 graphics()。
   */
  private async drawing(el: XEl, inCell: boolean): Promise<string | null> {
    const parts: string[] = []
    const img = await this.bitmap(el)
    if (img) parts.push(img)
    for (const tb of allDesc(el, 'txbxContent')) {
      const r = await this.sequence(tb.children, new ListState(), inCell)
      if (!r.html) continue
      parts.push(r.html)
      // 计数由 warn() 自己聚合（同类出现 N 次出口写成「文案×N」）
      this.warn('文本框内容已展平为段落（位置与文字环绕未保留）')
    }
    const gfx = await this.graphics(el, inCell)
    if (gfx.html) parts.push(gfx.html)
    if (parts.length) return parts.join('')
    // graphics() 认出了 diagram/chart 引用却没取到字时已经报过更准的那条（关系缺失、部件没找到、无缓存）
    if (!gfx.saw) {
      // 有位图引用但解不开（EMF/WMF 这类）时 bitmap() 已经报过更准的那条，别再补一句"无位图"
      if (!findDesc(el, 'blip') && !findDesc(el, 'imagedata')) this.warn('矢量图形（drawing 无位图）未导入')
    }
    return null
  }

  /**
   * SmartArt 与图表：document.xml 里只剩一个关系 id（dgm:relIds 的 r:dm、c:chart 的 r:id），
   * 文字与数值全在被 rels 指向的 word/diagrams/dataN.xml 与 word/charts/chartN.xml 里。
   * v0.41 之前这里只记一条"未导入"，于是整块 SmartArt 的字在打开的文件里凭空不见。
   * 现在取回的是部件里真实存在的东西：层级（dgm:cxn 的 parOf 边）→ 嵌套列表，缓存值 → 数据表；
   * 版式类型、配色、连线方向、坐标轴这些仍然不还原，但改成明确写出"没保住哪几样"的告警。
   */
  private async graphics(el: XEl, inCell: boolean): Promise<{ html: string; saw: boolean }> {
    let html = ''
    let saw = false
    for (const g of allDesc(el, 'graphicData')) {
      const uri = attr(g, 'uri') ?? ''
      const kind = /diagram/.test(uri) ? 'diagram' : /chart/.test(uri) ? 'chart' : undefined
      if (!kind) continue
      saw = true
      const box = kind === 'diagram' ? findDesc(g, 'relIds') : findDesc(g, 'chart')
      const rid = box ? attrL(box, kind === 'diagram' ? 'dm' : 'id') : undefined
      const label = kind === 'diagram' ? 'SmartArt' : '图表'
      const rel = rid ? this.rels.get(rid) : undefined
      if (!rel) {
        this.warn(`${label}关系缺失（图形数据部件没跟着文件走）`)
        continue
      }
      const xml = await this.partText(rel.target)
      if (!xml) {
        this.warn(`${label}部件未找到：${rel.target}`)
        continue
      }
      const out = kind === 'diagram' ? smartArtToHtml(xml, inCell) : chartToHtml(xml, inCell)
      // 只捞回一个标题也照样落进文档流：字不许因为"没数据"就消失
      if (out.html) html += out.html
      if (!out.kept) {
        this.warn(
          out.html
            ? '图表部件里没有缓存数值，只取回标题'
            : `${label}部件里没有可读的文字${kind === 'chart' ? '或数值' : ''}`,
        )
        continue
      }
      this.warn(
        kind === 'diagram'
          ? 'SmartArt 已按数据模型的父子层级展平（图形版式、配色与连线方向未保留）'
          : '图表已按文件里的缓存值取回数据（图表类型、坐标轴与配色未保留）',
      )
    }
    return { html, saw }
  }

  /** 图形类部件的文本（同一份 data1.xml 被两处引用时只解一次） */  private partText(path: string): Promise<string> {
    let p = this.parts.get(path)
    if (!p) {
      const f = this.zip?.file(path)
      p = f ? f.async('string').catch(() => '') : Promise.resolve('')
      this.parts.set(path, p)
    }
    return p
  }

  /** 嵌入部件的二进制（同一份 oleObject 被两处引用时只解一次） */
  private partBytes(path: string): Promise<Uint8Array | null> {
    let p = this.bins.get(path)
    if (!p) {
      const f = this.zip?.file(path)
      p = f ? f.async('uint8array').catch(() => null) : Promise.resolve(null)
      this.bins.set(path, p)
    }
    return p
  }

  /**
   * 嵌入对象的内容：先按容器取回内层文件（CFB 里是 `\x01Ole10Native`，现代写法是部件自己），
   * 再按类型分派成 HTML。取不到内容时返回 null，调用方保留"内容未提取"那条可见占位。
   */
  private async embedContent(target: string, name: string): Promise<EmbedHtml | null> {
    const bytes = await this.partBytes(target)
    if (!bytes) {
      this.warn(`嵌入部件未找到：${target}`)
      return null
    }
    const content = unwrapEmbed(bytes, name)
    if (!content) {
      this.warn(`嵌入部件 ${name} 的容器没认出来`)
      return null
    }
    return embedHtml(content, this.depth)
  }

  /** 位图部分：找不到可解码的图像就返回 null（交给调用方决定是否另有文本框可出） */
  private async bitmap(el: XEl): Promise<string | null> {
    const blip = findDesc(el, 'blip') ?? findDesc(el, 'imagedata')
    const rid = blip ? (attrL(blip, 'embed') ?? attrL(blip, 'id')) : undefined
    if (!rid) return null
    const rel = this.rels.get(rid)
    if (!rel) {
      this.warn('图片关系缺失')
      return null
    }
    const b64 = await this.mediaOf(rel.target)
    if (!b64) {
      this.warn(`图片部件未找到：${rel.target}`)
      return null
    }
    const mime = mimeOf(rel.target)
    if (!mime) {
      this.warn(`浏览器不支持的图片格式：${rel.target}`)
      return null
    }
    const ext = findDesc(el, 'extent')
    let w = Math.round((attrNum(ext, 'cx') ?? 0) * EMU_PX)
    let h = Math.round((attrNum(ext, 'cy') ?? 0) * EMU_PX)
    if (!w || !h) {
      // 老式 vml 把尺寸写在 style 里（WIDTH:100pt;HEIGHT:50pt）
      const style = attr(findDesc(el, 'shape'), 'style') ?? ''
      const sw = /width:\s*([\d.]+)pt/i.exec(style)
      const sh = /height:\s*([\d.]+)pt/i.exec(style)
      if (!w && sw) w = Math.round(Number(sw[1]) * PT_PX)
      if (!h && sh) h = Math.round(Number(sh[1]) * PT_PX)
    }
    const name = attr(findDesc(el, 'docPr'), 'name') ?? ''
    const size = `${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}`
    return `<img src="data:${mime};base64,${b64}"${size}${name ? ` alt="${esc(name)}"` : ''}>`
  }

  private mediaOf(path: string): Promise<string | null> {
    let p = this.media.get(path)
    if (!p) {
      const f = this.zip?.file(path)
      p = f ? f.async('base64').catch(() => null) : Promise.resolve(null)
      this.media.set(path, p)
    }
    return p
  }

  // --- 表格 ---

  private async table(el: XEl): Promise<string> {
    const tblPr = find(el, 'w:tblPr')
    const gridRaw = all(find(el, 'w:tblGrid'), 'w:gridCol').map((g) => Math.round((attrNum(g, 'w') ?? 0) * TWIP_PX))
    const rows = all(el, 'w:tr')
    const tb = borderEdges(tblPr ? find(tblPr, 'w:tblBorders') : undefined)
    const tblInd = tblPr ? attrNum(find(tblPr, 'w:tblInd'), 'w') : undefined
    // 表级默认格边距（w:tblCellMar）：v0.97 之前整条丢弃，声明了的左右 108 缇（=7.2px）也读不出来。
    // 逐格 w:tcMar 只在它说到的那几边上优先。
    // 再往下一层（样式层）：表引用的样式（w:tblStyle）及其 basedOn 祖先说的格边距是这一层的基座，
    // 表自身说的边覆盖它，逐格说的边再覆盖表——这几层都是逐边合并，不是整组替换。
    // 四层都没说的边仍然不铺数：Word 那一头此时给的是它自带的 0/5.4/0/5.4 磅（a2/a10/a11 三臂量出来的），
    // 那是应用默认而不是文档说了的数，铺进我们的账里就是把别人的默认写成用户的声明
    const styleId = val(tblPr, 'w:tblStyle')
    const styleMarEdges = styleCellMargins(this.book, styleId)
    const tblMarEdges = marginsOf(find(tblPr, 'w:tblCellMar'))
    // 条件层（`w:tblStylePr` 那块 w:tcPr 同时说格边距与格底纹）与它的闸门（`w:tblLook`）：
    // 闸门只吃表上那一枚，边距按行型/列型取一份账落在样式基座与表级默认之上、逐格 tcMar 之下，
    // 底纹按位置取一型（含四角型），落在样式基座之上、逐格 w:shd 之下
    const conds = styleCondCells(this.book, styleId)
    const look = tblLookOn(el)
    const styleShd = styleCellShading(this.book, styleId)
    // 横向 gridSpan / 纵向 vMerge 都按网格列记账：Word 保证同一次纵向合并里各行的 gridSpan 一致，
    // 所以 continue 单元格就落在 restart 单元格同一批网格列上，无需跳过被占用列。
    type Span = { row: number; span: number }
    const spanAt: (Span | undefined)[] = []
    type Cell = { el: XEl; gc: number; colspan: number; cont: boolean }
    const plan: Cell[][] = []
    rows.forEach((tr, ri) => {
      const cells: Cell[] = []
      let gc = 0
      for (const tc of all(tr, 'w:tc')) {
        const tcPr = find(tc, 'w:tcPr')
        const colspan = Math.max(1, valNum(tcPr, 'w:gridSpan') ?? 1)
        const vm = tcPr ? find(tcPr, 'w:vMerge') : undefined
        // OOXML：无 w:val 的 w:vMerge 就是 continue（Word 常省属性，写 restart 时才带 val）
        const cont = !!vm && (attr(vm, 'w:val') ?? 'continue') === 'continue'
        if (cont) {
          const src = spanAt[gc]
          if (src && src.row < ri && src.row + src.span >= ri) src.span += 1
        } else if (vm) spanAt[gc] = { row: ri, span: 1 }
        cells.push({ el: tc, gc, colspan, cont })
        gc += colspan
      }
      plan.push(cells)
    })
    // 行 0 的网格账（px）：w:gridCol 说了数的列就是它的账（Word 解固定布局时按逐列网格排，
    // 实测跨列表头格的 tcW 与 gridCol 之和打架时纸上吃的是 gridCol），gridCol 缺列、全零或压根
    // 没有 grid 的那些列才由逐格 w:tcW 补——跨列格的 tcW 是这一跨的总宽，只能减掉已知列后分给
    // 缺账的列，摊开覆盖已有账会把不等宽的三列抹成等宽（v0.97 前置实测 span-clash 臂量出来的）
    const gridCols = Math.max(gridRaw.length, plan[0]?.reduce((m, c) => Math.max(m, c.gc + c.colspan), 0) ?? 0)
    const acct: number[] = new Array(Math.max(1, gridCols)).fill(0)
    for (let i = 0; i < acct.length; i++) if (gridRaw[i] > 0) acct[i] = gridRaw[i]
    for (const c of plan[0] ?? []) {
      const total = tcWpx(find(c.el, 'w:tcPr'))
      if (total === null) continue
      const holes: number[] = []
      let known = 0
      for (let i = 0; i < c.colspan; i++) {
        const k = c.gc + i
        if (k >= acct.length) break
        if (acct[k]) known += acct[k]
        else holes.push(k)
      }
      const rest = total - known
      if (!holes.length || rest <= 0) continue
      const each = Math.max(1, Math.round(rest / holes.length))
      for (const k of holes) acct[k] = each
    }
    const gridKnown = acct.some((v) => v > 0)
    // 记账完成后才出 HTML：rowspan 要等所有行的 continue 都数完
    const tblStyle = tblInd ? tableIndentCss(Math.round(tblInd * TWIP_PX)) : ''
    let s = `<table${tblStyle ? ` style="${tblStyle}"` : ''}>`
    for (let ri = 0; ri < plan.length; ri++) {
      const trPr = find(rows[ri], 'w:trPr')
      // 表头由 w:trPr/w:tblHeader 决定，不限首行（Word 里可以声明第 2 行起重复表头）
      const tag = trPr && find(trPr, 'w:tblHeader') ? 'th' : 'td'
      // 行高（w:trHeight）：HTML 里 tr 的高度本就是下限语义，atLeast 恰好同形；
      // exact 的"超高裁内容"CSS 表达不了，按最小行高读入并如实记一条。
      // 这一层的数住在 @w:val 而不是邻居 w:tcW / w:gridCol 那样的 @w:w
      let trStyle = ''
      const th = trPr ? find(trPr, 'w:trHeight') : undefined
      const thv = attrNum(th, 'w:val')
      if (thv !== undefined && thv > 0) {
        if ((attr(th, 'w:hRule') ?? 'atLeast').toLowerCase() === 'exact')
          this.warn('固定行高（exact）按最小行高读入，超高内容不再裁剪')
        trStyle = `height: ${px2(thv * TWIP_PX)}px`
      }
      const last = plan.length - 1
      const rowEnd = plan[ri].reduce((m, c) => Math.max(m, c.gc + c.colspan), 0)
      s += `<tr${trStyle ? ` style="${trStyle}"` : ''}>`
      for (const c of plan[ri]) {
        if (c.cont) continue
        const tcPr = find(c.el, 'w:tcPr')
        const cb = borderEdges(tcPr ? find(tcPr, 'w:tcBorders') : undefined)
        const attrs: string[] = []
        if (c.colspan > 1) attrs.push(`colspan="${c.colspan}"`)
        const sp = spanAt[c.gc]
        if (sp && sp.row === ri && sp.span > 1) attrs.push(`rowspan="${sp.span}"`)
        if (ri === 0 && gridKnown) {
          const widths = acct.slice(c.gc, c.gc + c.colspan).filter((v) => v > 0)
          if (widths.length) attrs.push(`colwidth="${widths.join(',')}"`)
        }
        const mar = marginsCss({
          ...styleMarEdges,
          ...tblMarEdges,
          ...condMarginsFor(look, conds, ri, ri === last),
          ...marginsOf(find(tcPr, 'w:tcMar')),
        })
        // 底纹三层取一（逐格 > 条件层 > 样式基座）：比的是哪一层的 w:shd 在场，
        // 所以逐格那枚说 fill="auto" 也是说了话——它把下面两层的色清掉（q15/r4）
        const shd = cellShadingEl(
          tcPr,
          condShadingFor(look, conds, ri, ri === last, c.gc, c.colspan, acct.length),
          styleShd,
        )
        const pat = patternVal(shd)
        if (pat) this.warn(`图案底纹（w:shd @w:val=${pat}）按纯色读入，图案那一半没铺`)
        const style = [cellStyleCss(tcPr, {
          top: cb.top ?? (ri === 0 ? tb.top : tb.insideH),
          bottom: cb.bottom ?? (ri === last ? tb.bottom : tb.insideH),
          left: cb.left ?? (c.gc === 0 ? tb.left : tb.insideV),
          right: cb.right ?? (c.gc + c.colspan >= rowEnd ? tb.right : tb.insideV),
        }, shadingHex(shd)), mar].filter(Boolean).join('; ')
        if (style) attrs.push(`style="${style}"`)
        s += `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${await this.cellBlocks(c.el)}</${tag}>`
      }
      s += '</tr>'
    }
    return s + '</table>'
  }

  /** 单元格内容：段落走"格内列表"的独立栈（不与外层正文的列表串台），嵌套表格展平成段落 */
  private async cellBlocks(tc: XEl): Promise<string> {
    const list = new ListState()
    let html = ''
    for (let i = 0; i < tc.children.length; i++) {
      const b = tc.children[i]
      if (typeof b === 'string') continue
      const t = local(b.name)
      if (t === 'p') html += await this.paragraph(b, list, true, this.betweenOfSiblings(tc.children, i))
      else if (t === 'tbl') {
        this.warn('嵌套表格已展平为段落')
        for (const tr of all(b, 'w:tr')) for (const inner of all(tr, 'w:tc')) html += await this.cellBlocks(inner)
      } else if (t === 'sdt' || t === 'sdtContent') {
        const r = await this.sequence(b.children, list, true)
        html += r.html
      }
    }
    return html + list.flush()
  }
}

const PAGE_BREAK = '<div data-oo-pagebreak class="doc-page-break"></div>'

/** 需要加括号才不歧义的片段：含运算符、空白，或本身就是多项式 */
const grouped = (s: string) => (/[\s/^_()+*\-]/.test(s) ? `(${s})` : s)
/** 上标额外看长度：`x^ij` 不加括号读不出 i 是不是也在指数上 */
const groupedSup = (s: string) => (/[\s/^_()+*\-]/.test(s) || s.length > 1 ? `(${s})` : s)

/**
 * OMML → 线性文本（`x^2+y^2`、`(-b+√(b^2-4ac))/(2a)`、`∑_i^n a_i`）。
 *
 * 为什么不走 MathML/KaTeX：TipTap 侧没有承载公式结构的节点，塞一枚只读图片又要多引一份渲染库；
 * 而"字不许消失"这条底线不需要结构——把分式/根号/上下标写成键盘能打的连接符，用户至少看得懂、改得了。
 * 规则刻意保守：只连不编，认不出的构件一律并进子节点；`m:*Pr` 那批属性构件（含 m:ctrlPr 里那坨
 * w:rPr）没有式子内容，跳过。返回值里的 \u0001 是换行占位，由调用方换成 <br>。
 */
export function ommlLinear(el: XEl): string {
  const t = local(el.name)
  if (t === 't') return textOf(el)
  if (t === 'br') return '\u0001'
  if (t.endsWith('Pr')) return ''
  const kids = els(el)
  const part = (name: string) => kids.filter((k) => local(k.name) === name).map(ommlLinear).join('')
  switch (t) {
    case 'f': {
      const num = part('num')
      const den = part('den')
      return `${grouped(num)}/${grouped(den)}`
    }
    case 'sSup':
      return `${grouped(part('e'))}^${groupedSup(part('sup'))}`
    case 'sSub':
      return `${grouped(part('e'))}_${grouped(part('sub'))}`
    case 'sSubSup':
      return `${grouped(part('e'))}_${grouped(part('sub'))}^${groupedSup(part('sup'))}`
    case 'rad': {
      const deg = part('deg')
      return `${deg ? `${deg}√` : '√'}(${part('e')})`
    }
    case 'd': {
      // 定界符字符写在 m:dPr/m:begChr 的 m:val 上，缺省是圆括号
      const dPr = findL(el, 'dPr')
      const beg = attrL(findL(dPr, 'begChr') ?? undefined, 'val') ?? '('
      const end = attrL(findL(dPr, 'endChr') ?? undefined, 'val') ?? ')'
      return `${beg}${part('e')}${end}`
    }
    case 'nary': {
      const chr = attrL(findL(findL(el, 'naryPr') ?? undefined, 'chr') ?? undefined, 'val') ?? '∫'
      const sub = part('sub')
      const sup = part('sup')
      return `${chr}${sub ? `_${sub}` : ''}${sup ? `^${sup}` : ''} ${grouped(part('e'))}`
    }
    case 'func':
      return `${part('fName')}(${part('e')})`
    case 'limLow':
      return `${part('e')}_${grouped(part('lim'))}`
    case 'limUpp':
      return `${part('e')}^${groupedSup(part('lim'))}`
    case 'm':
      return kids.filter((k) => local(k.name) === 'mr').map(ommlLinear).join(' ; ')
    default:
      return kids.map(ommlLinear).join('')
  }
}

/** 单边元素（w:top/w:bottom/…）→ 规范串；`w:val="none"/"nil"/"hidden"` 是「这条边明确不要」 */
function edgeCss(b: XEl): string {
  const style = CSS_BORDER_STYLE[(attr(b, 'w:val') ?? 'single').toLowerCase()] ?? 'solid'
  if (style === 'none') return 'none'
  const px = eighthsToPx(attrNum(b, 'w:sz') ?? 8)
  const hex = rgb2hex(`#${(attr(b, 'w:color') ?? '').replace(/^#/, '').toLowerCase()}`) ?? '#000000'
  return `${px}px ${style} ${hex}`
}

/**
 * `w:tblBorders` / `w:tcBorders` → 各边规范串。
 * 没写的边留 undefined（区别于显式的 'none'）：undefined 才允许落回表级或应用网格线。
 */
function borderEdges(el: XEl | undefined): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  if (!el) return out
  for (const child of els(el)) out[local(child.name)] = edgeCss(child)
  return out
}

/** `w:shd` 的 `w:fill` → 规范 hex；auto/无填充/纯白都给 null（白底等于没底纹） */
function shadingHex(shd: XEl | undefined): string | null {
  const fill = attr(shd, 'w:fill') ?? ''
  if (!fill || fill.toLowerCase() === 'auto') return null
  const hex = rgb2hex(`#${fill.replace(/^#/, '').toLowerCase()}`)
  return hex && hex !== '#ffffff' ? hex : null
}

/**
 * `w:shd` 的 @w:val 说的是图案而不是纯色时交回那一档的名字（clear/none/缺省给空串）。
 * Word 读这类件时把 fill 当颜色、把图案另住在 Texture（p19 的 pct50 在 Word 那头是 FF0000/500），
 * 而 CSS 里没有对应的底纹档位，所以这一半本轮不铺，只如实记一条。
 */
function patternVal(shd: XEl | undefined): string {
  const v = (attr(shd, 'w:val') ?? 'clear').toLowerCase()
  return v === 'clear' || v === 'none' ? '' : v
}

/** 单元格边框四边 + 底纹 + 竖排对齐 → 一段内联 style（顺序固定，供结构测试直接比对） */
function cellStyleCss(
  tcPr: XEl | undefined,
  edges: { top?: string; bottom?: string; left?: string; right?: string },
  hex: string | null,
): string {
  const bits: string[] = []
  for (const edge of CELL_EDGES) {
    const v = edges[edge]
    if (v) bits.push(`border-${edge}: ${v}`)
  }
  if (hex) bits.push(`background-color: ${hex}`)
  const va = (val(tcPr, 'w:vAlign') ?? '').toLowerCase()
  const align = va === 'center' ? 'middle' : va === 'top' || va === 'bottom' ? va : ''
  if (align) bits.push(`vertical-align: ${align}`)
  return bits.join('; ')
}

/** `w:tblInd`（twips）→ 表格离版心的缩进；表宽 100%，右边要一起收，否则顶出页面 */
function tableIndentCss(px: number): string {
  return `margin-left: ${px}px; width: calc(100% - ${px}px)`
}

/**
 * 一格的 w:tcW（dxa）→ 这一跨的总宽（px）。
 * auto/pct 与没账都给 null：pct 的换算要版心宽（调用处没有），auto 本来就是"没账"。
 * 跨列格写的就是它跨的那几列之和，不是单列宽，所以这里只交回总数、由调用处去分账。
 */
function tcWpx(tcPr: XEl | undefined): number | null {
  const tcW = tcPr ? find(tcPr, 'w:tcW') : undefined
  if (!tcW) return null
  const type = (attr(tcW, 'w:type') ?? 'dxa').toLowerCase()
  if (type === 'auto' || type === 'pct') return null
  const v = attrNum(tcW, 'w')
  if (v === undefined || v <= 0) return null
  return Math.max(1, Math.round(v * TWIP_PX))
}

/** 四边格边距（px），没说的边是 undefined（不是 0） */
type Margins = { top?: number; bottom?: number; left?: number; right?: number }

/**
 * w:tblCellMar / w:tcMar → 逐边 px。缺省边不落（让应用默认说话），auto/pct 不落，
 * 0 是真值（Word 的上下边距常就是 0）。
 */
function marginsOf(mar: XEl | undefined): Margins {
  if (!mar) return {}
  const side = (names: string[]): number | undefined => {
    for (const name of names) {
      const e = find(mar, name)
      if (!e) continue
      const type = (attr(e, 'w:type') ?? 'dxa').toLowerCase()
      if (type === 'auto' || type === 'pct') continue
      const v = attrNum(e, 'w')
      if (v !== undefined && v >= 0) return px2(v * TWIP_PX)
    }
    return undefined
  }
  const out: Margins = {}
  const t = side(['w:top'])
  if (t !== undefined) out.top = t
  const b = side(['w:bottom'])
  if (b !== undefined) out.bottom = b
  const l = side(['w:left', 'w:start'])
  if (l !== undefined) out.left = l
  const r = side(['w:right', 'w:end'])
  if (r !== undefined) out.right = r
  return out
}

/**
 * Word 打开文件时会把自己那套内建定义换上来的表样式 id——文件里往这几枚身上写的数从不落地。
 * 量出来的两枚同一天：u6 往 TableNormal 写 w:tblCellMar left=400 缇（=20 磅），Word 读回 5.4 磅
 * （它自带的那档应用默认）；q21 往同一枚身上写 w:tcPr/w:shd D9D9D9，Word 九枚格全读回无底纹。
 * v0.97 的 a11 那一臂（表直接引用 TableNormal）量的是同一件事的边距那一半。
 */
const SUBSTITUTED_TABLE_STYLES = new Set(['TableNormal'])

/**
 * 表样式那一层的格边距：`w:tblPr/w:tblStyle` 指着的样式及其 basedOn 祖先，沿链自根向下逐边合并。
 *
 * 这一层吃的不是「默认标记」而是「引用」：前置实测的三档 r1/v1（自造 id 的默认标记样式，被表引用）
 * 里 Word 把样式说的 240 缇读成 12 磅，而 r2/v2（同一枚样式没人引用）与 q19/q20 两头都什么都不落——
 * 没人引用的样式压根不在链上，我们本来也不读，所以这一族的门只留上面那条替换名单。
 * 四层都没说的边仍然不铺数：Word 那一头此时给的是它自带的 0/5.4/0/5.4 磅（u4 与 v0.97 的 a2/a10/a11），
 * 那是应用默认而不是文档说了的数，铺进我们的账里就是把别人的默认写成用户的声明。
 */
function styleCellMargins(book: StyleBook, id: string | undefined): Margins {
  const out: Margins = {}
  for (const s of styleChain(book, id)) {
    if (SUBSTITUTED_TABLE_STYLES.has(s.id)) continue
    Object.assign(out, marginsOf(find(s.tblPr, 'w:tblCellMar')))
  }
  return out
}

/**
 * 底纹的基座层：被引用的表样式（及其 basedOn 祖先）自己那枚 `w:tcPr/w:shd`。
 *
 * 交回的是**元素**而不是色值——三层要比的是"哪一层说了话"，而「说了话」里包含「说了没有」
 * （`w:fill="auto"`：q15 里它清得掉样式基座，r4 里它清得掉条件层），色值那一档把这两种分不开。
 * 沿链自根向下后来者覆盖：p17（祖先 D9D9D9 + 本体 FFF2CC）Word 九枚格全读 FFF2CC，
 * p18（只有祖先说）读回 D9D9D9——所以本体说了才算本体的，没说就继承祖先的。
 */
function styleCellShading(book: StyleBook, id: string | undefined): XEl | undefined {
  let out: XEl | undefined
  for (const s of styleChain(book, id)) {
    if (SUBSTITUTED_TABLE_STYLES.has(s.id)) continue
    const shd = find(s.tcPr, 'w:shd')
    if (shd) out = shd
  }
  return out
}

/** 条件层里会把格边距落到实处的四型（Word 16.0 实测只有这四型落地） */
const LOOK_BITS = ['firstRow', 'lastRow', 'firstColumn', 'lastColumn'] as const

/** 一块条件里说的格载荷：格边距与格底纹住在同一枚 `w:tcPr` 上，两族共用同一份"同型整块替换"的账 */
type CondCell = { mar: Margins; shd?: XEl }

/**
 * 条件层 `w:tblStylePr` 说的格载荷：型名 → 那一块的账。
 *
 * 同一型的两块、以及 basedOn 祖先与本体各说同一型时，都是**整块替换**而不是逐边合并——
 * 前置实测 r_dup_type_firstRow_L3（同一型两块 A{left,top} + B{left,bottom}）里 Word 落的是
 * B 的 left 与 bottom 而 A 的 top 一次都没出现（那一枚读回的是基座 4px）；q_basedon_L3 里本体的 firstRow
 * 说了 right 而祖先的 firstRow 说了 left，Word 只落 right 而 left 仍是基座。底纹那一半同一形状
 * （q18：同一型两块各说一枚色，Word 只落后面那枚）。
 * 不同型各落各的（r_basedon_diff_type_L3：祖先的 firstRow 落第 0 行、本体的 lastRow 落末行；
 * q17 底纹版：祖先的 firstRow 落第 0 行）。
 * 一块条件里只认 `w:tcPr` 那一格的载荷：同一块换成 `w:tblPr/w:tblCellMar` 那格写，Word 不落。
 */
function styleCondCells(book: StyleBook, id: string | undefined): Record<string, CondCell> {
  const out: Record<string, CondCell> = {}
  for (const s of styleChain(book, id)) {
    if (SUBSTITUTED_TABLE_STYLES.has(s.id)) continue
    for (const pr of s.tblStylePr ?? []) {
      const type = attr(pr, 'w:type')
      if (!type) continue
      const tcPr = find(pr, 'w:tcPr')
      const mar = marginsOf(find(tcPr, 'w:tcMar'))
      const shd = find(tcPr, 'w:shd')
      if (Object.keys(mar).length || shd) out[type.toLowerCase()] = { mar, shd }
    }
  }
  return out
}

/**
 * `w:tblLook` 的闸门（Word 16.0 实测四种形状，`w:val` 那位十六进制数从不被 consult）：
 * 元素不存在、或存在而一个属性都没写 → 首行与首列开、末行与末列关；
 * 只写 `w:val` 而没有逐位属性 → 四位全关（g_*_L2_val 那三臂连 firstRow=0001 都不 fire）；
 * 写了至少一枚逐位属性 → 说了的按说的算，没说的按开算（k5：val=0000 + firstRow=1 firstColumn=1，
 * 而末行与末列照 fire；k6：firstRow=0 关掉首行，未说的末行末列仍开）。
 * 样式自己写的那枚 `w:tblLook` 不参与裁决（r_style_look_on/off 两臂逐格同形，表上那枚 absent）。
 */
function tblLookOn(tbl: XEl): Record<string, boolean> {
  const look = find(find(tbl, 'w:tblPr'), 'w:tblLook')
  const on = (v: string | undefined, dflt: boolean) => (v === undefined ? dflt : ['1', 'true', 'on'].includes(v.toLowerCase()))
  const stated = LOOK_BITS.filter((b) => attr(look, `w:${b}`) !== undefined)
  if (!stated.length) {
    const off = look && attr(look, 'w:val') !== undefined
    return {
      firstRow: !off,
      lastRow: false,
      firstColumn: !off,
      lastColumn: false,
    }
  }
  const out: Record<string, boolean> = {}
  for (const b of LOOK_BITS) out[b] = on(attr(look, `w:${b}`), true)
  return out
}

/**
 * 这一格的条件层账：行型按行落，列型按全表落。
 *
 * 首列/末列那两型的 tcMar 在 Word 眼里落到**全表每一格**（g_firstCol 的 22px、g_lastCol 的 34px
 * 在九枚格上分毫不差），而同一个闸门同一个型换成 `w:rPr` 载荷时才是真按列落
 * （q_bold_firstCol_L3：加粗只出现在每行第 0 格）——这是边距这一族在 Word 里的形状，不是列作用域。
 * 撞车时的次序都量过：末列压首列、行压列（r_rowcol_same_edge_L3 里 firstCol 那枚 22px 一次都没出现）、
 * 单行既是首行又是末行时首行赢（r_one_row_first_last_L3）。
 */
function condMarginsFor(look: Record<string, boolean>, conds: Record<string, CondCell>, ri: number, isLastRow: boolean): Margins {
  const out: Margins = {}
  if (look.firstColumn) Object.assign(out, conds.firstcol?.mar)
  if (look.lastColumn) Object.assign(out, conds.lastcol?.mar)
  const row: Margins = {}
  if (isLastRow && look.lastRow) Object.assign(row, conds.lastrow?.mar)
  if (ri === 0 && look.firstRow) Object.assign(row, conds.firstrow?.mar)
  return Object.assign(out, row)
}

/**
 * 这一格的条件层底纹：底纹那一族**真按位置**落，跟上面那族格边距不是一种作用域。
 *
 * 同一个闸门、同一枚 firstCol，载荷是 w:tcMar 时九枚格全落（上一轮 g_firstCol 的 22px），
 * 载荷是 w:shd 时只落在每行第 0 网格列上（t7：FCE4D6 只在 #0/#3/#6，其余六枚格 Word 报 000000/0），
 * 而跨两列且从第 0 列起的那种格也算第 0 列（q16：那枚格落 FCE4D6 而它右边那枚落基座）。
 * 角型（nwCell/neCell/swCell/seCell）是一等型别：落点就是那一角那一格（u1 四枚各落一格），
 * 闸门要那一角的两枚位都开（u3 里只有 seCell 的末行+末列都开着，于是只有它落），
 * 尊卑按**型别**而不按声明顺序（u2 把 nwCell 写在 lastRow/lastCol 之后、u7 把它写在最前，
 * Word 两趟都在第 0 格落 D2691E 而把 firstRow 让到 #1/#2、firstCol 让到 #3/#6）。
 * 行型里首行压末行、列型里末列压首列沿用上一轮边距那头的读数（r_one_row_first_last / r_rowcol_same_edge）；
 * 一枚格同时踩到两型底纹时（比如 1×1 表上的四角同格）没有实测，按上面这条梯子取先说话的那一型。
 */
function condShadingFor(
  look: Record<string, boolean>,
  conds: Record<string, CondCell>,
  ri: number,
  isLastRow: boolean,
  gc: number,
  colspan: number,
  cols: number,
): XEl | undefined {
  const first = ri === 0
  const at0 = gc === 0
  const atEnd = gc + colspan >= cols
  const ladder: string[] = []
  if (first && at0 && look.firstRow && look.firstColumn) ladder.push('nwcell')
  if (first && atEnd && look.firstRow && look.lastColumn) ladder.push('necell')
  if (isLastRow && at0 && look.lastRow && look.firstColumn) ladder.push('swcell')
  if (isLastRow && atEnd && look.lastRow && look.lastColumn) ladder.push('secell')
  if (first && look.firstRow) ladder.push('firstrow')
  if (isLastRow && look.lastRow) ladder.push('lastrow')
  if (at0 && look.firstColumn) ladder.push('firstcol')
  if (atEnd && look.lastColumn) ladder.push('lastcol')
  for (const t of ladder) {
    const shd = conds[t]?.shd
    if (shd) return shd
  }
  return undefined
}

/**
 * 底纹三层取一：比的是"哪一层说了话"，所以逐格那枚 `w:shd` 只要在场就赢，
 * 哪怕它说的是 `w:fill="auto"`（q15/r4：那一枚把样式基座与条件层都清掉了）。
 * 纯色之外的图案那一半（`w:val="pct50"` 这类）CSS 里没有对应档位，只把 fill 当纯色读并如实记一条。
 */
function cellShadingEl(tcPr: XEl | undefined, cond: XEl | undefined, base: XEl | undefined): XEl | undefined {
  return find(tcPr, 'w:shd') ?? cond ?? base
}

/**
 * 逐边合并后的格边距 → padding。ECMA-376 §17.4.61 与 Word 实机读的都是"逐边"：
 * 一枚只写了 left 的 tcMar，其余三边在 Word 眼里仍是表级那几个数
 * （前置实测 mar-subset 臂：Word 报 15/5.4/1.5/2.25 磅而整组换那一档只剩 20px 的左边距）。
 */
function marginsCss(m: Margins): string {
  const bits: string[] = []
  if (m.top !== undefined) bits.push(`padding-top: ${m.top}px`)
  if (m.bottom !== undefined) bits.push(`padding-bottom: ${m.bottom}px`)
  if (m.left !== undefined) bits.push(`padding-left: ${m.left}px`)
  if (m.right !== undefined) bits.push(`padding-right: ${m.right}px`)
  return bits.join('; ')
}

/** 属性值里的引号要转义：脚注正文是用户文字，落在 data-* 属性上 */
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;')
}

/** 脚注/尾注标记：正文只存在 data 属性里（进 DOM 文本就会混进正文与字数），序号由 CSS counter 现算 */
function noteSpan(kind: 'footnote' | 'endnote', text: string): string {
  return `<span class="doc-note" data-oo-note-kind="${kind}" data-oo-note-text="${escAttr(encodeNoteText(text))}"></span>`
}

/**
 * footnotes.xml / endnotes.xml → `w:id` → 纯文本正文（段落之间以 \n 分隔）。
 * 结构性那两条（separator / continuationSeparator）不是正文，必须跳过——它们里面就是一条 `w:footnoteRef` 加一根线。
 */
function noteBodiesOf(
  xml: string,
  tag: 'footnote' | 'endnote',
  warn: (msg: string) => void,
): Map<number, string> {
  const out = new Map<number, string>()
  if (!xml.trim()) return out
  const root = findDesc(parseXml(xml), `w:${tag}s`)
  if (!root) return out
  const label = tag === 'footnote' ? '脚注' : '尾注'
  for (const el of all(root, `w:${tag}`)) {
    const type = (attr(el, 'w:type') ?? '').toLowerCase()
    if (type === 'separator' || type === 'continuationseparator') continue
    const id = Number(attr(el, 'w:id'))
    if (!Number.isFinite(id)) continue
    if (find(el, 'w:tbl')) warn(`${label}正文里的表格未保留`)
    if (findDesc(el, 'w:drawing') || findDesc(el, 'w:pict')) warn(`${label}正文里的图片未保留`)
    out.set(
      id,
      all(el, 'w:p')
        .map((p) => plainText(p))
        .join('\n'),
    )
  }
  return out
}

function plainText(el: XEl): string {
  return allDesc(el, 't')
    .map((c) => textOf(c))
    .join('')
}

// ---- 入口 ------------------------------------------------------------------

/** 保真导入一份 docx。抛错或 blocks=0 时调用方应回退 mammoth。`depth` 是嵌套层数（嵌入文档递归用）。 */
export async function docxToHtmlFidelity(bytes: Uint8Array, depth = 0): Promise<DocxImport> {
  const { default: JSZip } = await import('jszip')
  const zip = (await JSZip.loadAsync(bytes)) as unknown as ZipLike
  const read = async (p: string): Promise<string> => (await zip.file(p)?.async('string')) ?? ''
  const documentXml = await read('word/document.xml')
  if (!documentXml) throw new Error('缺 word/document.xml')
  const f = new Fidelity(
    readStyles(await read('word/styles.xml')),
    readNumbering(await read('word/numbering.xml')),
    depth,
  )
  f.load(zip)
  f.setRels(await read('word/_rels/document.xml.rels'))
  f.setNotes(await read('word/footnotes.xml'), await read('word/endnotes.xml'))
  f.setComments(await read('word/comments.xml'), await read('word/commentsExtended.xml'))
  const { html, blocks } = await f.run(documentXml)
  return { html, comments: f.comments, blocks, warnings: f.warningList() }
}
