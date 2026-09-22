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
// schema 边界（TipTap 侧没有对应属性，导入时刻意不硬塞，全部记进 warnings）：段落底纹与边框、
// 表格边框与单元格底纹/竖排、行距与段前段后、上下标、脚注尾注、图表与 OLE 对象。

import { all, allDesc, attr, attrL, attrNum, els, find, findDesc, local, parseXml, textOf, type XEl } from './ooxml'
import { commentRowsOf, type DocComment } from './docx'

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
}
interface ZipLike {
  file(path: string): ZipPart | null
}

// 单位换算：1440 twip = 1in = 96px（故 1px = 15 twip）；914400 EMU = 1in（1px = 9525 EMU）；字号按半点存
const TWIP_PX = 1 / 15
const EMU_PX = 1 / 9525
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
      rPr: find(s, 'w:rPr'),
      pPr,
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
  return s
}

// ---- 列表栈 ---------------------------------------------------------------

/**
 * 只管"开到哪一层、上一项是否还开着"，返回要追加的 HTML 片段。
 * 进深层时父 <li> 保持打开——嵌套列表必须落在父项里面，bulletList 的内容只收 listItem。
 */
class ListState {
  private stack: { id: string; level: number; ordered: boolean }[] = []

  before(level: number, ordered: boolean, id: string): string {
    let s = ''
    while (this.stack.length && this.stack[this.stack.length - 1].level > level) s += this.pop()
    const top = this.stack[this.stack.length - 1]
    if (top && top.level === level) {
      if (top.id !== id) s += this.pop()
      else return s + '</li><li>'
    }
    while (!this.stack.length || this.stack[this.stack.length - 1].level < level) {
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
  /** 下一段文字必须另起一片：批注区间按片段下标切分，与邻片合并就会把边界吃掉 */
  split: boolean
}

function push(st: InlineState, html: string) {
  if (!html) return
  const last = st.pieces[st.pieces.length - 1]
  if (last?.kind === 'inline' && !st.split) last.html += html
  else st.pieces.push({ kind: 'inline', html })
  st.split = false
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
  warnings = new Set<string>
  comments: DocComment[] = []
  /** 已开未关的批注区间 id：跨段续挂（mark 不能跨块，故每段各一枚 span） */
  private openRanges = new Set<number>()
  private rels = new Map<string, { target: string; external: boolean }>()
  private media = new Map<string, Promise<string | null>>()
  private zip: ZipLike | null = null

  constructor(
    private book: StyleBook,
    private numbering: Numbering,
  ) {}

  private warn(msg: string) {
    this.warnings.add(msg)
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

  setComments(commentsXml: string, extXml: string) {
    this.comments = commentRowsOf(commentsXml, extXml)
  }

  async run(documentXml: string): Promise<{ html: string; blocks: number }> {
    const doc = parseXml(documentXml)
    // w:body 是 w:document 的孩子，而 parseXml 的根是 '#doc'，所以要深找一层
    const body = findDesc(doc, 'w:body')
    if (!body) throw new Error('document.xml 缺 w:body')
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
    for (const n of nodes) {
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
      if (t === 'p') {
        // 列表项之间由 ListState 负责开合；非列表段落出现即把整串列表关掉
        const numbered = !inCell && this.numOf(n).id !== undefined
        if (!numbered && list.open) html += list.flush()
        html += await this.paragraph(n, list, inCell)
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

  private async paragraph(el: XEl, list: ListState, inCell: boolean): Promise<string> {
    const pPr = find(el, 'w:pPr')
    const styleId = pPr ? val(pPr, 'w:pStyle') : undefined
    const view = styleView(this.book, styleId)
    // 样式链给基线，段落自己的 pPr 覆盖同名项（Word 的直接格式优先于样式）
    const effPPr = mergePPr([view.pPr, pPr])
    const base = baseRunProps(view.chain, effPPr)

    let prefix = ''
    const num = inCell ? { level: 0 } : this.numOf(el)
    if (num.id !== undefined) {
      const def = this.numbering.byId.get(num.id)?.get(num.level)
      prefix = list.before(num.level, !!def && def.numFmt !== 'bullet', num.id)
    }

    const pieces = await this.inline(el, base)
    if (view.preformatted) return prefix + `<pre><code>${escText(plainText(el))}</code></pre>`

    const style = this.paraCss(effPPr)
    const tag = view.level && view.level <= 4 ? `h${view.level}` : 'p'
    const body = this.layout(tag, style, pieces)
    return view.quote ? prefix + `<blockquote>${body}</blockquote>` : prefix + body
  }

  /** 段落样式 → CSS：对齐 + 左缩进 + 首行缩进（缩进落在 lib/indent-extension.ts 的段落属性上） */
  private paraCss(pPr: XEl | undefined): string {
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
      if (right) this.warn('右缩进未导入')
      if (left) bits.push(`margin-left: ${Math.round(left * TWIP_PX)}px`)
      // firstLineChars 是"字符数×100"（Word 同时会写 firstLine 的 twips 值）；只给前者时按 16px 字宽估
      const first = attrNum(ind, 'w:firstLine')
      const firstChars = attrNum(ind, 'w:firstLineChars')
      const firstPx = first ? Math.round(first * TWIP_PX) : firstChars ? Math.round((firstChars / 100) * 16) : 0
      if (firstPx) bits.push(`text-indent: ${firstPx}px`)
      else if (hang) bits.push(`text-indent: ${-Math.round(hang * TWIP_PX)}px`)
    }
    return bits.join('; ')
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

  private async inline(el: XEl, base: RunProps): Promise<Piece[]> {
    // 跨段批注：上一段开着没关的区间，在本段开头继续（mark 不能跨块，故每段各一枚 span）
    const openAt = new Map<number, number>()
    for (const cid of this.openRanges) openAt.set(cid, 0)
    const st: InlineState = { pieces: [], openAt, fld: 0, show: false, split: false }
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
      // 段落属性、书签、校对标记、域代码原文、已删除内容：都不产出可见文字
      case 'pPr':
      case 'proofErr':
      case 'bookmarkStart':
      case 'bookmarkEnd':
      case 'commentReference':
      case 'lastRenderedPageBreak':
      case 'instrText':
      case 'delInstrText':
      case 'delText':
      case 'del':
      case 'moveFrom':
        return
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
        } else if (k === 'separate') st.show = true
        else if (k === 'end') {
          st.fld = Math.max(0, st.fld - 1)
          st.show = false
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
      case 'endnoteReference':
        this.warn('脚注/尾注引用未导入')
        return
      case 'object':
        this.warn('嵌入对象（w:object）未导入')
        return
      case 'drawing':
      case 'pict': {
        const img = await this.drawing(node)
        if (img) st.pieces.push({ kind: 'block', html: img })
        return
      }
      case 'hyperlink': {
        const rid = attrL(node, 'id')
        const rel = rid ? this.rels.get(rid) : undefined
        const anchor = attr(node, 'w:anchor')
        // 子状态：链接内的批注区间若没在链接里闭合，下标要按"追加到主序列的位置"换算
        const sub: InlineState = { pieces: [], openAt: new Map(), fld: st.fld, show: st.show, split: false }
        await this.children(node, props, sub)
        st.fld = sub.fld
        st.show = sub.show
        const base = st.pieces.length
        for (const [cid, from] of sub.openAt) st.openAt.set(cid, base + from)
        const href = rel?.external ? rel.target : anchor ? `#${anchor}` : undefined
        if (!href) {
          for (const p of sub.pieces) st.pieces.push(p)
          return
        }
        for (const p of sub.pieces)
          st.pieces.push(p.kind === 'inline' ? { kind: 'inline', html: `<a href="${esc(href)}">${p.html}</a>` } : p)
        return
      }
      // 容器类：原样下钻
      case 'sdt':
      case 'sdtContent':
      case 'fldSimple':
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
          const va = val(rPr, 'w:vertAlign')
          if (va === 'superscript' || va === 'subscript') this.warn('上标/下标未导入（文字保留）')
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
            if (st.fld > 0 && !st.show) continue
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

  // --- 图片 ---

  private async drawing(el: XEl): Promise<string | null> {
    const blip = findDesc(el, 'blip') ?? findDesc(el, 'imagedata')
    const rid = blip ? (attrL(blip, 'embed') ?? attrL(blip, 'id')) : undefined
    if (!rid) {
      if (findDesc(el, 'chart')) this.warn('图表（chart）未导入')
      else this.warn('矢量图形（drawing 无位图）未导入')
      return null
    }
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
    const grid = all(find(el, 'w:tblGrid'), 'w:gridCol').map((g) => Math.round((attrNum(g, 'w') ?? 0) * TWIP_PX))
    const rows = all(el, 'w:tr')
    const borders = tblPr ? find(tblPr, 'w:tblBorders') : undefined
    if (borders && els(borders).length) this.warn('表格边框未导入（应用自带网格线）')
    if (tblPr && find(tblPr, 'w:tblInd')) this.warn('表格缩进未导入')
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
    // 记账完成后才出 HTML：rowspan 要等所有行的 continue 都数完
    let s = '<table>'
    for (let ri = 0; ri < plan.length; ri++) {
      const trPr = find(rows[ri], 'w:trPr')
      // 表头由 w:trPr/w:tblHeader 决定，不限首行（Word 里可以声明第 2 行起重复表头）
      const tag = trPr && find(trPr, 'w:tblHeader') ? 'th' : 'td'
      s += '<tr>'
      for (const c of plan[ri]) {
        if (c.cont) continue
        const tcPr = find(c.el, 'w:tcPr')
        const attrs: string[] = []
        if (c.colspan > 1) attrs.push(`colspan="${c.colspan}"`)
        const sp = spanAt[c.gc]
        if (sp && sp.row === ri && sp.span > 1) attrs.push(`rowspan="${sp.span}"`)
        if (ri === 0) {
          const widths = grid.slice(c.gc, c.gc + c.colspan).filter((v) => v > 0)
          if (widths.length) attrs.push(`colwidth="${widths.join(',')}"`)
        }
        const shd = tcPr ? find(tcPr, 'w:shd') : undefined
        const fill = shd ? attr(shd, 'w:fill') : undefined
        if (fill && fill !== 'auto' && fill.toLowerCase() !== 'ffffff') this.warn('单元格底纹未导入')
        if (tcPr && find(tcPr, 'w:vAlign')) this.warn('单元格竖排对齐未导入')
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
    for (const b of tc.children) {
      if (typeof b === 'string') continue
      const t = local(b.name)
      if (t === 'p') html += await this.paragraph(b, list, true)
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

function plainText(el: XEl): string {
  return allDesc(el, 't')
    .map((c) => textOf(c))
    .join('')
}

// ---- 入口 ------------------------------------------------------------------

/** 保真导入一份 docx。抛错或 blocks=0 时调用方应回退 mammoth。 */
export async function docxToHtmlFidelity(bytes: Uint8Array): Promise<DocxImport> {
  const { default: JSZip } = await import('jszip')
  const zip = (await JSZip.loadAsync(bytes)) as unknown as ZipLike
  const read = async (p: string): Promise<string> => (await zip.file(p)?.async('string')) ?? ''
  const documentXml = await read('word/document.xml')
  if (!documentXml) throw new Error('缺 word/document.xml')
  const f = new Fidelity(readStyles(await read('word/styles.xml')), readNumbering(await read('word/numbering.xml')))
  f.load(zip)
  f.setRels(await read('word/_rels/document.xml.rels'))
  f.setComments(await read('word/comments.xml'), await read('word/commentsExtended.xml'))
  const { html, blocks } = await f.run(documentXml)
  return { html, comments: f.comments, blocks, warnings: [...f.warnings] }
}
