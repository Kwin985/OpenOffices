// ODT（OpenDocument 文本）导出/导入：ProseMirror JSON ⇄ content.xml，零新依赖（JSZip + DOMParser）。
// 范围：批注走 ODF 1.2 的 office:annotation(…annotation-end) 位置配对往返（v0.86）；目录节点不写 ODT；
// 脚注/尾注走 ODF 1.2 的 text:footnote(REFERENCE) 内联写法；
// 图片以 dataURL 内嵌进 Pictures/；页眉页脚/页码走 master-page。

import {
  DEFAULT_COL_GAP,
  detectPageFormat,
  pageNumberParts,
  resolvePage,
  type DocMeta,
  type DocComment,
  type DocxStyleInfo,
  type PageMargin,
  type PageSetup,
  type PMNode,
} from './docx'
import { bdAttr, borderParts, CELL_EDGES, cssBorder, rgb2hex, type CellEdge } from './cell-style'
import {
  condLadderAppearance,
  condLadderMargin,
  condLadderRowHeight,
  condLookBits,
  mergedTableOf,
  tableEdgeFor,
} from './table-cond'
import { encodeNoteText } from './note-extension'
import { embedHtml, inlineFlatten, unwrapEmbed, type EmbedHtml } from './ole'
import { ruleOf, type LineRule } from './paragraph-style'
import { toLetterSpacingPt } from './char-spacing'

const OD_MIME = 'application/vnd.oasis.opendocument.text'

// mm → ODF 长度字面量（cm 两位小数）
const mm2cm = (mm: number) => `${(mm / 10).toFixed(2)}cm`
// CSS px → ODF 长度：缩进写 cm，三位小数以免往返掉精度（32px ≈ 0.847cm）
const px2cm = (px: number) => `${(px / 37.795).toFixed(3)}cm`
// CSS px → ODF 长度：段前段后与绝对行距写 pt（px↔pt 是精确换算，cm 第三位小数就会磨掉零点几 px）
const px2pt = (px: number) => `${Math.round(px * 75) / 100}pt`
/** ODF 承认的四边框线型；inset/outset 之类翻成 solid，至少宽度与颜色还在 */
const ODF_BORDER_STYLE: Record<string, string> = { solid: 'solid', dashed: 'dashed', dotted: 'dotted', double: 'double' }
/** 规范边框串（`1px solid #8899aa`）→ fo:border-* 的值（宽度用 pt：px↔pt 换算是精确的） */
function odtBorder(v: string): string {
  const p = borderParts(v)
  if (!p) return 'none'
  const style = ODF_BORDER_STYLE[p.style] ?? 'solid'
  return `${Math.round(p.px * 75) / 100}pt ${style} ${p.hex}`
}
/**
 * fo:border-* 的值 → 规范边框串。
 * 第三方 ODF 的宽度多写 cm（本应用写 pt），cssBorder 只认 px/pt，故先把长度档位换成 px。
 * 这里不走 len2px：它按整数 px 取整，会把 0.5pt 的细线（0.67px）抬成 1px，
 * 而边框宽度正是往返要保真的量，故保留两位小数。
 */
function odfBorderCss(v: string | null | undefined): string | null {
  if (!v) return null
  const s = v.trim()
  if (!s || s === 'none' || s === 'hidden') return 'none'
  const m = s.match(/^(-?[\d.]+)(cm|mm|in|"|pt|px)?(.*)$/)
  if (!m) return cssBorder(s)
  const n = Number(m[1])
  const unit = m[2] ?? ''
  const px =
    unit === 'mm' ? n * 3.7795
    : unit === 'in' || unit === '"' ? n * 96
    : unit === 'pt' ? (n * 96) / 72
    : unit === 'px' ? n
    : n * 37.795
  return cssBorder(`${Math.round(px * 100) / 100}px${m[3]}`)
}
/** ODF 长度 → CSS px（保留两位小数）；行距/段间距正是往返要保的量，取整会把 0.67px 抬成 1px */
function lenPx(v: string | null | undefined): number | undefined {
  if (!v) return undefined
  const m = v.trim().match(/^(-?[\d.]+)(cm|mm|in|"|pt|px)?$/)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n)) return undefined
  const px =
    m[2] === 'mm' ? n * 3.7795
    : m[2] === 'in' || m[2] === '"' ? n * 96
    : m[2] === 'pt' ? (n * 96) / 72
    : m[2] === 'px' ? n
    : n * 37.795
  return Math.round(px * 100) / 100
}
/** ODF 长度 → CSS px；负值照收（悬挂缩进就是负的 fo:text-indent），0 按「没有缩进」 */
function len2px(v: string | null | undefined): number | undefined {
  const px = lenPx(v)
  return px === undefined || px === 0 ? undefined : Math.round(px)
}

/**
 * fo:padding 简写 → 四边各一枚 px，序为 top/right/bottom/left（就是 CELL_EDGES 那一序）。
 * CSS 的折叠规则：1 值四边同，2 值给上下/左右，3 值中间那枚管左右。
 * 任一段不是纯长度就整条算「没说」——混了线型或颜色的串不是边距简写。
 */
function expandPadding(v: string | null | undefined): number[] | undefined {
  if (!v) return undefined
  const parts = v.trim().split(/\s+/).filter(Boolean)
  if (!parts.length || parts.length > 4) return undefined
  const a: number[] = []
  for (const p of parts) {
    const px = lenPx(p)
    if (px === undefined) return undefined
    a.push(px)
  }
  const fold = a.length === 1 ? [0, 0, 0, 0] : a.length === 2 ? [0, 1, 0, 1] : a.length === 3 ? [0, 1, 2, 1] : [0, 1, 2, 3]
  return fold.map((i) => a[i])
}
/** CSS 属性值 → ODF 的 fo:text-align（start/center/end/justify） */
const FO_ALIGN: Record<string, string> = { left: 'start', center: 'center', right: 'end', justify: 'justify' }
/** ODF 的 fo:text-align → CSS 值（本编辑器的 textAlign 属性吃 CSS 词） */
const CSS_ALIGN: Record<string, string> = { start: 'left', center: 'center', end: 'right', justify: 'justify' }

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : 0
}

/** 数值属性 → 数字；null/NaN 一律算「没声明」。**0 是真值**，所以不能用 num() 或 if(v) 判 */
function owned(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * 具名段落样式：它们记的是「这一类段落」的默认排版，不是某一格的直接格式。
 * 本应用把 H1..H4/PC/PQ 和派生的 PSn 一起写进 content.xml 的 automatic-styles，只按"自动样式"分不开，
 * 故按名字排除（PQ 的 fo:border-left 若当成段落边框，导出再开就成了双份）；
 * 第三方文件的具名样式在 styles.xml 的 office:styles 里，读侧另外收。
 */
const FIXED_PARA_STYLES = new Set([
  'Standard',
  'Text_20_Body',
  'Default_20_Paragraph_20_Style',
  'PBK',
  'Header',
  'Footer',
  'PC',
  'PQ',
  'H1',
  'H2',
  'H3',
  'H4',
])

/**
 * CSS 字体列表 → ODF 的拉丁/中日韩两个槽。
 * 'Times New Roman', '宋体' 里前一个是拉丁名、后一个是中文名（保真导入就是这个排法）。
 */
function splitFont(family: string): { latin: string; cjk?: string } {
  const names = family
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  const cjk = names.find((n) => /[㐀-䶿一-鿿぀-ヿ가-힯]/.test(n))
  return { latin: names.find((n) => n !== cjk) ?? names[0] ?? '', cjk }
}
// ODF 长度字面量 → mm；无法解析回 undefined。单位榜由 Word 门面裁定：同一张纸写成 cm/mm/in/pt/px/pc 六臂纸账相同，em/ex/%、0 与负数一律按「没说」
function cm2mm(v: string | null | undefined): number | undefined {
  if (!v) return undefined
  const m = v.match(/^([\d.]+)\s*(cm|mm|in|"|pt|px|pc)?$/)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return undefined
  if (m[2] === 'in') return n * 25.4
  if (m[2] === 'mm') return n
  if (m[2] === 'pt') return (n * 25.4) / 72
  if (m[2] === 'px') return (n * 25.4) / 96
  if (m[2] === 'pc') return (n * 25.4) / 6
  return n * 10
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface ImageEntry {
  file: string
  mime: string
  bytes: Uint8Array
}

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink" ' +
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/"'

/**
 * 命名表样式按位置展开后给到某一格的那一层（v0.122）。
 * 格子自己的直接格式压在它上面（见 cStyle），所以这里只填"没人喊价"的那些槽。
 * 边框是 CSS 边框串（与节点上的直接格式同格式），边距是 px，bg 是 #rrggbb。
 */
interface CellStyleBase {
  bTop?: string
  bRight?: string
  bBottom?: string
  bLeft?: string
  pTop?: number
  pRight?: number
  pBottom?: number
  pLeft?: number
  bg?: string
}

/** 表样式的格边距四槽 ↔ 四边：`padTopPx` 那一族键名按边拼 */
const PAD_KEY = { top: 'padTopPx', right: 'padRightPx', bottom: 'padBottomPx', left: 'padLeftPx' } as const
/** 边名 → 首字母大写（拼 `bTop`/`pTop` 那一族键，别拼出 `btop`） */
const capEdge = (e: CellEdge) => (e[0].toUpperCase() + e.slice(1)) as 'Top' | 'Right' | 'Bottom' | 'Left'

class OdtBuilder {
  charStyles = new Map<string, string>() // 样式键 JSON → 样式名
  paraStyles = new Map<string, string>() // 段落直接格式键 JSON → 段落自动样式名
  cellStyles = new Map<string, string>() // 单元格样式键 JSON → 自动样式名（ce1…）
  rowStyles = new Map<string, string>() // 行样式键 JSON → 自动样式名（ro1…）
  tableStyles = new Map<string, string>() // 表格样式键 JSON → 自动样式名（TS1…）
  images = new Map<string, ImageEntry>() // src → entry
  private imageSeq = 0
  private paraSeq = 0
  private cellSeq = 0
  private rowSeq = 0
  private tableSeq = 0
  /** 脚注/尾注各自一套编号与 text:id 前缀（ODF 的 id 要引用与正文两处对上，编号按文档顺序现算） */
  private noteSeq: Record<'footnote' | 'endnote', number> = { footnote: 0, endnote: 0 }
  /** 当前开着的批注（office:annotation…annotation-end 位置配对；cid 变了才关开，atom 节点不打断区间） */
  private openAnn: number | null = null
  /** 已写过区间的 cid：ODT 与 Word 同一条规则——同一 cid 全局只写一组 annotation，续挂段不再重锚 */
  private usedAnn = new Set<number>()

  /**
   * 单元格直接格式（四边边框 + 四边内边距 + 底纹 + 竖排对齐）→ table-cell 家族自动样式。
   * ODF 的表格单元格样式必须走 `style:family="table-cell"`，不能像 HTML 那样写内联。
   * 边框宽度用 pt 而不是 cm：px↔pt 是 ×4/3 的精确换算，cm 保留两位小数会把 1px 变成 1.13px。
   */
  private cStyle(cell: PMNode, base?: CellStyleBase): string {
    const o: Record<string, string> = {}
    for (const edge of CELL_EDGES) {
      // 逐格直接格式优先于表样式展开出来的那一层（与 Word「直接格式压样式」同一条纪律）
      const own = cell.attrs?.[bdAttr(edge)]
      const v = typeof own === 'string' && own ? own : base?.[`b${capEdge(edge)}` as keyof CellStyleBase]
      if (typeof v !== 'string' || !v) continue
      o[`b${edge}`] = v === 'none' ? 'none' : odtBorder(v)
    }
    // 边距走 cm 三位小数：0.001cm = 0.038px，往返误差不到 0.02px，不必像边框那样换 pt。
    // 0 是真值（Word 的上下边距常就是 0），所以那道闸按「有限非负数」而不是按真值判
    for (const edge of CELL_EDGES) {
      const own = cell.attrs?.[`pad${edge[0].toUpperCase()}${edge.slice(1)}`]
      const v =
        typeof own === 'number' && Number.isFinite(own) && own >= 0
          ? own
          : base?.[`p${capEdge(edge)}` as keyof CellStyleBase]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
      o[`p${edge}`] = px2cm(v)
    }
    const ownBg = cell.attrs?.background
    const bg = typeof ownBg === 'string' && ownBg ? ownBg : base?.bg
    if (typeof bg === 'string' && bg) o.bg = bg
    const va = cell.attrs?.vAlign
    if (va === 'top' || va === 'middle' || va === 'bottom') o.va = va
    if (!Object.keys(o).length) return ''
    const key = JSON.stringify(o)
    let name = this.cellStyles.get(key)
    if (!name) {
      name = `ce${++this.cellSeq}`
      this.cellStyles.set(key, name)
    }
    return name
  }

  private cellStyleXml(): string {
    let out = ''
    for (const [key, name] of this.cellStyles) {
      const s = JSON.parse(key) as Record<string, string>
      let tp = ''
      for (const edge of CELL_EDGES) {
        if (s[`b${edge}`]) tp += ` fo:border-${edge}="${esc(s[`b${edge}`])}"`
      }
      for (const edge of CELL_EDGES) {
        if (s[`p${edge}`]) tp += ` fo:padding-${edge}="${s[`p${edge}`]}"`
      }
      if (s.bg) tp += ` fo:background-color="${esc(s.bg)}"`
      if (s.va) tp += ` style:vertical-align="${s.va}"`
      out += `<style:style style:name="${name}" style:family="table-cell"><style:table-cell-properties${tp}/></style:style>`
    }
    return out
  }

  /**
   * 行高（tableRow 的 rowHeight，模型里就是下限语义）→ table-row 家族自动样式。
   * 写 `style:min-row-height` 而不是 `style:row-height`：Word 读 ODT 时把后者一律折成
   * `w:hRule="exact"`（三臂同形），exact 会把比它高的内容裁进行底下——同一段三段内容的格，
   * 不给字面时这行占 44.8 磅，row-height="0.1cm"（=2.83 磅）把它压成 2.85 磅、41.95 磅正文
   * 推进下一行（字节还在，屏上没了）。
   * min-row-height 配 use-optimal-row-height="true" 落的是不带 hRule 的 w:trHeight
   * （OOXML 缺省即 atLeast），Word 门面活口 HeightRule=1，与我们的下限语义同形且不裁。
   */
  private rStyle(row: PMNode, condH?: number): string {
    // 行上没写直接行高时才认条件层那一档（与 docx 侧"先认 direct 再认条件"同序）
    let h = Number(row.attrs?.rowHeight)
    if (!Number.isFinite(h) || h <= 0) h = condH ?? Number.NaN
    if (!Number.isFinite(h) || h <= 0) return ''
    const key = JSON.stringify({ h: Math.round(h * 100) / 100 })
    let name = this.rowStyles.get(key)
    if (!name) {
      name = `ro${++this.rowSeq}`
      this.rowStyles.set(key, name)
    }
    return name
  }

  private rowStyleXml(): string {
    let out = ''
    for (const [key, name] of this.rowStyles) {
      const s = JSON.parse(key) as { h: number }
      out +=
        `<style:style style:name="${name}" style:family="table-row">` +
        `<style:table-row-properties style:min-row-height="${px2cm(s.h)}" style:use-optimal-row-height="true"/>` +
        `</style:style>`
    }
    return out
  }

  /**
   * 表格缩进（Word 的 w:tblInd 那一档）→ table 家族自动样式。
   * ODF 里整张表的左边距就是 `fo:margin-left`，表宽本应用不锁（版式表恒为满宽减缩进），
   * 所以只写 margin-left，导入侧按同一属性读回。
   */
  private tStyle(node: PMNode, al?: string): string {
    const ml = Number(node.attrs?.marginLeft)
    const align = al === 'center' || al === 'right' ? al : ''
    if ((!Number.isFinite(ml) || ml <= 0) && !align) return ''
    const key = JSON.stringify({ ml: Math.round(ml * 100) / 100, al: align })
    let name = this.tableStyles.get(key)
    if (!name) {
      name = `TS${++this.tableSeq}`
      this.tableStyles.set(key, name)
    }
    return name
  }

  private tableStyleXml(): string {
    let out = ''
    for (const [key, name] of this.tableStyles) {
      const s = JSON.parse(key) as { ml: number; al: string }
      // 表样式带了 align 就用它（center/right），否则维持 margins；缩进为 0 时不写 margin-left
      const align = s.al ? `table:align="${s.al}"` : 'table:align="margins"'
      const ml = s.ml > 0 ? ` fo:margin-left="${px2cm(s.ml)}"` : ''
      out +=
        `<style:style style:name="${name}" style:family="table">` +
        `<style:table-properties ${align}${ml}/></style:style>`
    }
    return out
  }

  constructor(private meta?: DocMeta) {}

  /**
   * 命名表样式 → 这一格的展开结果（v0.122）。
   *
   * ODF 没有 Word 那种「条件层」概念，命名表样式的定义（表级六边 / 格边距 / 默认格底纹，
   * 加 `w:tblStylePr` 那十二型）只能在出口这一层**按位置摊成逐格硬格式**再写出去。
   * 阶梯与尊卑一律走 `table-cond` 那批共享函数——与 docx 渲染（docx-fidelity）、CSS 层（doc-style-css）
   * 同源，不会三处各跑一套算法而慢慢跑偏。
   * 这里只填"样式说了话"的槽，格子自己的直接格式由 cStyle 压在上面。
   */
  private cellBase(
    t: NonNullable<DocxStyleInfo['table']>,
    look: Record<string, boolean>,
    ri: number,
    isLastRow: boolean,
    gc: number,
    colspan: number,
    cols: number,
  ): CellStyleBase {
    const cond = t.cond
    const o: Record<string, string | number> = {}
    const app = condLadderAppearance(look, ri, isLastRow, gc, colspan, cols)
    // 边框：表级六边先按位置落（首行吃 bdTop、其余行吃 bdInsideH，竖线同理），条件边框再逐边压上去
    const edges = tableEdgeFor(t, ri, isLastRow, gc, colspan, cols)
    const cEdge: Partial<Record<CellEdge, string>> = {}
    for (const ty of app) {
      const b = cond?.[ty]?.borders
      if (!b) continue
      for (const e of CELL_EDGES) {
        const v = b[e]
        if (v && cEdge[e] === undefined) cEdge[e] = v
      }
    }
    for (const e of CELL_EDGES) {
      const v = cEdge[e] ?? edges[e]
      if (v) o[`b${capEdge(e)}`] = v
    }
    // 底纹：默认格底纹打底，条件底纹取梯子上第一枚说话的那一型（角型压一切）
    let bg = t.background
    for (const ty of app) {
      const c = cond?.[ty]?.background
      if (c) {
        bg = c
        break
      }
    }
    if (bg) o.bg = bg
    // 边距：条件层压表级（表级是样式基座、条件层是再压一层），故先算条件层再让表级兜底。
    // 条件层内部按边距族梯子（行>角>列）逐边先到先得。
    const basePad: Partial<Record<CellEdge, number>> = {}
    if (t.padTopPx !== undefined) basePad.top = t.padTopPx
    if (t.padRightPx !== undefined) basePad.right = t.padRightPx
    if (t.padBottomPx !== undefined) basePad.bottom = t.padBottomPx
    if (t.padLeftPx !== undefined) basePad.left = t.padLeftPx
    const cPad: Partial<Record<CellEdge, number>> = {}
    for (const ty of condLadderMargin(look, ri, isLastRow)) {
      const c = cond?.[ty]
      if (!c) continue
      for (const e of CELL_EDGES) {
        const v = c[PAD_KEY[e]]
        if (v !== undefined && cPad[e] === undefined) cPad[e] = v
      }
    }
    for (const e of CELL_EDGES) {
      const v = cPad[e] ?? basePad[e]
      if (v !== undefined) o[`p${capEdge(e)}`] = v
    }
    return o as CellStyleBase
  }

  /** 这一行的条件行高（仅行型条件带；行上没写直接行高时这一档才上场） */
  private condRowHeight(
    t: NonNullable<DocxStyleInfo['table']>,
    look: Record<string, boolean>,
    ri: number,
    isLastRow: boolean,
  ): number | undefined {
    if (!t.cond || !Object.keys(t.cond).length) return undefined
    for (const ty of condLadderRowHeight(look, ri, isLastRow)) {
      const v = t.cond[ty]?.rowHeightPx
      if (v !== undefined && v > 0) return v
    }
    return undefined
  }

  /**
   * 段落直接格式（对齐 + 缩进 + 行距段距 + 底纹边框）→ 派生自动样式名。
   * ODF 一个段落只认一个 text:style-name，「居中 + 首行缩进两字符」这类组合只能另起一条样式，
   * 父样式指回基础样式（Standard/H1/PQ），同样的组合复用同一个名字。
   * leftAdd：基础样式自带的左边距（PQ 的 0.8cm），节点上的缩进是在它之外的增量。
   * dropLeft：左缩进交给 text:list-style 管（列表项节点上那份多半是从 docx 层级继承来的，再写就是双份）。
   */
  private pStyle(
    node: PMNode,
    base: string,
    opts: { leftAdd?: number; dropLeft?: boolean } = {},
  ): string {
    const align = String(node.attrs?.textAlign ?? '')
    const raw = opts.dropLeft ? 0 : Math.max(0, num(node.attrs?.indentLeft)) + (opts.leftAdd ?? 0)
    const right = Math.max(0, num(node.attrs?.indentRight))
    const first = num(node.attrs?.indentFirst)
    const bl = opts.leftAdd ?? 0
    const lh = owned(node.attrs?.lineHeight)
    const lr = typeof node.attrs?.lineRule === 'string' ? node.attrs.lineRule : ''
    const sb = owned(node.attrs?.spaceBefore)
    const sa = owned(node.attrs?.spaceAfter)
    const bg = typeof node.attrs?.background === 'string' ? node.attrs.background : ''
    const bd: Partial<Record<CellEdge, string>> = {}
    for (const edge of CELL_EDGES) {
      const v = node.attrs?.[bdAttr(edge)]
      if (typeof v === 'string' && v) bd[edge] = v
    }
    // 判空一律用 !== undefined：段后距 0 是"压掉样式那段间距"的真值，用 if 会静默丢掉
    if (
      !align &&
      raw <= bl &&
      !right &&
      !first &&
      lh === undefined &&
      sb === undefined &&
      sa === undefined &&
      !bg &&
      Object.keys(bd).length === 0
    )
      return base
    const key = JSON.stringify({ base, align, left: raw, right, first, bl, lh, lr, sb, sa, bg, bd })
    let name = this.paraStyles.get(key)
    if (!name) {
      name = `PS${++this.paraSeq}`
      this.paraStyles.set(key, name)
    }
    return name
  }

  private paraStyleXml(): string {
    let out = ''
    for (const [key, name] of this.paraStyles) {
      const s = JSON.parse(key) as {
        base?: string
        align?: string
        left?: number
        right?: number
        first?: number
        bl?: number
        lh?: number
        lr?: string
        sb?: number
        sa?: number
        bg?: string
        bd?: Partial<Record<CellEdge, string>>
      }
      let pp = ''
      const align = FO_ALIGN[s.align ?? '']
      if (align) pp += ` fo:text-align="${align}"`
      // 父样式链已经给到的左边距不必重写
      if ((s.left ?? 0) > (s.bl ?? 0)) pp += ` fo:margin-left="${px2cm(s.left ?? 0)}"`
      if (s.right) pp += ` fo:margin-right="${px2cm(s.right)}"`
      if (s.first) pp += ` fo:text-indent="${px2cm(s.first)}"`
      if (s.sb !== undefined) pp += ` fo:margin-top="${px2pt(s.sb)}"`
      if (s.sa !== undefined) pp += ` fo:margin-bottom="${px2pt(s.sa)}"`
      if (s.lh !== undefined) {
        // 倍数写百分比 + proportional；固定值/最小值写 pt，两档在 ODF 里分得清（CSS 分不出）
        pp +=
          ruleOf(s.lh, (s.lr || undefined) as LineRule | undefined) === 'auto'
            ? ` fo:line-height="${Math.round(s.lh * 100)}%" style:line-height="proportional"`
            : ` fo:line-height="${px2pt(s.lh)}" style:line-height="${s.lr === 'atLeast' ? 'minimum' : 'fixed'}"`
      }
      if (s.bg) pp += ` fo:background-color="${s.bg}"`
      for (const edge of CELL_EDGES) {
        const v = s.bd?.[edge]
        if (v) pp += ` fo:border-${edge}="${odtBorder(v)}"`
      }
      out +=
        `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${s.base || 'Standard'}">` +
        `<style:paragraph-properties${pp}/></style:style>`
    }
    return out
  }

  private charStyleXml(): string {
    let out = ''
    for (const [key, name] of this.charStyles) {
      const m = JSON.parse(key) as Record<string, unknown>
      let tp = ''
      if (m.bl) tp += ' fo:font-weight="bold"'
      if (m.it) tp += ' fo:font-style="italic"'
      if (m.ul)
        tp += ' style:text-underline-style="solid" style:text-underline-type="single" style:text-underline-width="auto"'
      if (m.st) tp += ' style:text-line-through-style="solid" style:text-line-through-type="single"'
      // 字体族拆拉丁/中日韩两槽；code 与 fam 都写 style:font-name，同元素重复属性会让 XML 解析失败
      const font = m.fam ? splitFont(String(m.fam)) : m.code ? { latin: 'Courier New' } : null
      if (font?.latin) tp += ` style:font-name="${esc(font.latin)}"`
      if (font?.cjk) tp += ` style:font-name-asian="${esc(font.cjk)}"`
      // fontSize 存 px，ODF 习惯 pt
      if (m.sz) tp += ` fo:font-size="${Math.round((Number(m.sz) * 72) / 96)}pt"`
      // 字符间距只走 fo:letter-spacing 这一条通道：Word 16.0 门面认它（character style /
      // paragraph style / styles.xml 具名样式三层都读得到，负数与 cm 也读得到），
      // 而 style:letter-spacing、loext:letter-spacing、loext:letter-spacing-padding|tracking 四写全不进账。
      // 0 在这一头写得出去且 Word 读作缺省（0pt 与无声明同形），与 docx 那一头的「0 落不下」是两笔形状差。
      if (m.ls) tp += ` fo:letter-spacing="${esc(String(m.ls))}"`
      if (m.cl) tp += ` fo:color="${esc(String(m.cl))}"`
      if (m.bg) tp += ` fo:background-color="${esc(String(m.bg))}"`
      // 58%/-25% 是 LibreOffice 自己写上下标时用的偏移档位，跟着它才不会被判成自定义位置
      if (m.sp) tp += ' style:text-position="super 58%"'
      else if (m.sb) tp += ' style:text-position="sub -25%"'
      out += `<style:style style:name="${name}" style:family="text"><style:text-properties${tp}/></style:style>`
    }
    return out
  }

  private autoStyles(): string {
    const headings = [1, 2, 3, 4]
      .map(
        (l) =>
          `<style:style style:name="H${l}" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="${22 - l * 3}pt" fo:font-weight="bold" fo:color="#111827"/></style:style>`,
      )
      .join('')
    const pc = `<style:style style:name="PC" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:background-color="#f3f4f6" fo:margin-left="0.4cm"/><style:text-properties style:font-name="Courier New" fo:font-size="9.5pt"/></style:style>`
    const pq = `<style:style style:name="PQ" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="0.8cm" fo:border-left="0.06cm solid #d1d5db" fo:padding-left="0.3cm"/></style:style>`
    // 脚注/尾注正文段落：小一号字，Word 与 LO 的脚注文本都短正文两档
    const fn = `<style:style style:name="FN" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="9pt"/></style:style>`
    const aligns = this.paraStyleXml()
    const lb = `<text:list-style style:name="LB">${[1, 2, 3]
      .map(
        (l) =>
          `<text:list-level-style-bullet text:level="${l}" text:bullet-char="•"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.6cm" fo:margin-left="${(0.6 * l).toFixed(2)}cm"/></style:list-level-properties></text:list-level-style-bullet>`,
      )
      .join('')}</text:list-style>`
    const lo = `<text:list-style style:name="LO">${[1, 2, 3]
      .map(
        (l) =>
          `<text:list-level-style-number text:level="${l}" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.7cm" fo:margin-left="${(0.7 * l).toFixed(2)}cm"/></style:list-level-properties></text:list-level-style-number>`,
      )
      .join('')}</text:list-style>`
    return (
      this.charStyleXml() +
      this.cellStyleXml() +
      this.rowStyleXml() +
      this.tableStyleXml() +
      headings +
      pc +
      pq +
      fn +
      aligns +
      lb +
      lo
    )
  }

  private registerImage(src: string): ImageEntry | null {
    const hit = this.images.get(src)
    if (hit) return hit
    const dm = src.match(/^data:([^;]+);base64,(.*)$/)
    if (!dm) return null
    try {
      const bin = atob(dm[2])
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const ext =
        dm[1] === 'image/jpeg' ? 'jpg' : dm[1] === 'image/svg+xml' ? 'svg' : (dm[1].split('/')[1] ?? 'png')
      const entry: ImageEntry = { file: `Pictures/odt${++this.imageSeq}.${ext}`, mime: dm[1], bytes }
      this.images.set(src, entry)
      return entry
    } catch {
      return null
    }
  }

  /**
   * 批注区间的开与收：正文/作者来自 meta.comments（author 进 dc:creator，多行正文换 text:line-break，
   * 与脚注正文同一条规则）。ODF 靠 office:name 配对，写上它比只靠位置稳。
   */
  private openAnnEl(cid: number): string {
    const c = this.meta?.comments?.find((x) => x.id === cid)
    const creator = c?.author ? `<dc:creator>${esc(c.author)}</dc:creator>` : ''
    const body = (c?.text ?? '').split('\n').map(esc).join('<text:line-break/>')
    return `<office:annotation office:name="ooc${cid}">${creator}<text:p text:style-name="FN">${body}</text:p></office:annotation>`
  }

  private closeAnnEl(cid: number): string {
    return `<office:annotation-end office:name="ooc${cid}"/>`
  }

  inline(nodes: PMNode[]): string {
    let out = ''
    for (const n of nodes) {
      if (n.type === 'text') {
        const cid = (n.marks ?? []).find((k) => k.type === 'comment')?.attrs?.cid as number | undefined
        if (this.openAnn != null && (!cid || cid !== this.openAnn)) {
          out += this.closeAnnEl(this.openAnn)
          this.openAnn = null
        }
        if (typeof cid === 'number' && cid !== this.openAnn && !this.usedAnn.has(cid)) {
          out += this.openAnnEl(cid)
          this.usedAnn.add(cid)
          this.openAnn = cid
        }
        let inner = esc(n.text ?? '')
        const marks = n.marks ?? []
        const at = (t: string) => marks.find((k) => k.type === t)?.attrs
        const markKey = {
          bl: marks.some((k) => k.type === 'bold'),
          it: marks.some((k) => k.type === 'italic'),
          ul: marks.some((k) => k.type === 'underline'),
          st: marks.some((k) => k.type === 'strike'),
          code: marks.some((k) => k.type === 'code'),
          cl: (at('textStyle')?.color ?? at('color')?.color) as string | undefined,
          bg: at('highlight')?.color as string | undefined,
          fam: (at('textStyle')?.fontFamily ?? at('fontFamily')?.fontFamily) as string | undefined,
          sz: parseInt(String(at('textStyle')?.fontSize ?? at('fontSize')?.fontSize ?? ''), 10) || undefined,
          // 字符间距：模型存规范化 pt 串，这里只认同一份闸（历史 .odoc 里可能是别的写法）。
          // 键名用 ls —— sp 已经被上标占了，两族挤一枚键会互相顶掉。
          ls: toLetterSpacingPt(at('textStyle')?.letterSpacing as string | null | undefined) ?? undefined,
          // ODF 的上下标是一个属性两值（style:text-position="super 58%"），故两个布尔键分开记
          sp: marks.some((k) => k.type === 'superscript'),
          sb: marks.some((k) => k.type === 'subscript'),
        }
        const hasAny = Object.values(markKey).some(Boolean)
        if (hasAny) {
          const key = JSON.stringify(markKey)
          let name = this.charStyles.get(key)
          if (!name) {
            name = `C${this.charStyles.size + 1}`
            this.charStyles.set(key, name)
          }
          inner = `<text:span text:style-name="${name}">${inner}</text:span>`
        }
        const href = at('link')?.href as string | undefined
        if (href) inner = `<text:a xlink:type="simple" xlink:href="${esc(href)}">${inner}</text:a>`
        out += inner
      } else if (n.type === 'hardBreak') {
        out += '<text:line-break/>'
      } else if (n.type === 'image') {
        const src = (n.attrs?.src as string) ?? ''
        if (!src) continue
        // 宽度属性是像素（UI 设定），换算成 ODF 长度；缺省回退 4.5in
        const pw = Number(n.attrs?.width)
        const wAttr = `svg:width="${Number.isFinite(pw) && pw > 0 ? mm2cm(pw * 25.4 / 96) : '4.5in'}"`
        const ph = Number(n.attrs?.height)
        const hAttr = Number.isFinite(ph) && ph > 0 ? ` svg:height="${mm2cm(ph * 25.4 / 96)}"` : ''
        const entry = this.registerImage(src)
        if (entry) {
          out += `<draw:frame draw:name="${entry.file}" text:anchor-type="as-char" ${wAttr}${hAttr}><draw:image xlink:href="${entry.file}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`
        } else if (!src.startsWith('data:')) {
          out += `<draw:frame text:anchor-type="as-char" ${wAttr}${hAttr}><draw:image xlink:href="${esc(src)}" xlink:type="simple"/></draw:frame>`
        }
      } else if (n.type === 'note') {
        // ODF 1.2：引用与正文是同一段落里相邻的两个元素，靠同一个 text:id 配对。
        // 编号写进 citation 的字面量而不是留空——本导出每次重算文档顺序，所以字面量不会过期，
        // 而只吃字面量的老阅读器（LO 早期版本、一些在线预览）也能显示出圈号。
        const kind: 'footnote' | 'endnote' = n.attrs?.kind === 'endnote' ? 'endnote' : 'footnote'
        const text = typeof n.attrs?.text === 'string' ? n.attrs.text : ''
        const seq = ++this.noteSeq[kind]
        const id = `${kind === 'endnote' ? 'ooen' : 'oofn'}${seq}`
        const ref = kind === 'endnote' ? 'text:endnote-reference' : 'text:footnote-reference'
        const bodyEl = kind === 'endnote' ? 'text:endnote' : 'text:footnote'
        const cite = kind === 'endnote' ? 'text:endnote-citation' : 'text:footnote-citation'
        const body = text.split('\n').map(esc).join('<text:line-break/>')
        out += `<${ref} text:id="${id}"/><${bodyEl} text:id="${id}"><text:p text:style-name="FN"><${cite}>${seq}</${cite}>${body}</text:p></${bodyEl}>`
      } else if (n.content) {
        out += this.inline(n.content)
      }
    }
    if (this.openAnn != null) {
      out += this.closeAnnEl(this.openAnn)
      this.openAnn = null
    }
    return out
  }

  blocks(nodes: PMNode[]): string {
    let out = ''
    for (const n of nodes) {
      switch (n.type) {
        case 'heading': {
          const level = Math.min(4, Math.max(1, Number(n.attrs?.level ?? 1)))
          const sn = this.pStyle(n, `H${level}`)
          out += `<text:h text:style-name="${sn}" text:outline-level="${level}">${this.inline(n.content ?? [])}</text:h>`
          break
        }
        case 'paragraph': {
          const sn = this.pStyle(n, '')
          out += `<text:p${sn ? ` text:style-name="${sn}"` : ''}>${this.inline(n.content ?? [])}</text:p>`
          break
        }
        case 'codeBlock': {
          const text = (n.content ?? []).map((x) => x.text ?? '').join('')
          out += `<text:p text:style-name="PC">${text.split('\n').map(esc).join('<text:line-break/>')}</text:p>`
          break
        }
        case 'blockquote':
          for (const c of n.content ?? []) {
            if (c.type === 'paragraph') {
              // PQ 自带 0.8cm 左边距：用户再缩进要在这个基础上加，否则派生样式会盖掉引用缩进
              out += `<text:p text:style-name="${this.pStyle(c, 'PQ', { leftAdd: 30 })}">${this.inline(c.content ?? [])}</text:p>`
            } else {
              out += this.blocks([c])
            }
          }
          break
        case 'bulletList':
          out += `<text:list text:style-name="LB">${this.listItems(n.content ?? [])}</text:list>`
          break
        case 'orderedList':
          out += `<text:list text:style-name="LO">${this.listItems(n.content ?? [])}</text:list>`
          break
        case 'table':
          out += this.table(n)
          break
        case 'image':
          // TipTap 允许图片作为顶层节点，包一层段落写出
          out += `<text:p>${this.inline([n])}</text:p>`
          break
        case 'pageBreak':
          // 空段落带 fo:break-before="page"：本段落在新页起始，正文随之续排
          out += `<text:p text:style-name="PBK"/>`
          break
        case 'toc':
          break // 目录是实时汇总节点，ODT 不写占位
        default:
          if (n.content) out += this.blocks(n.content)
      }
    }
    return out
  }

  private listItems(nodes: PMNode[]): string {
    let out = ''
    for (const li of nodes) {
      if (li.type !== 'listItem') continue
      const inner = (li.content ?? [])
        .map((c) => {
          if (c.type !== 'paragraph') return this.blocks([c])
          const sn = this.pStyle(c, '', { dropLeft: true })
          return `<text:p${sn ? ` text:style-name="${sn}"` : ''}>${this.inline(c.content ?? [])}</text:p>`
        })
        .join('')
      out += `<text:list-item>${inner}</text:list-item>`
    }
    return out
  }

  private table(node: PMNode): string {
    const rows = (node.content ?? []).filter((r) => r.type === 'tableRow')
    if (!rows.length) return ''
    // 预铺覆盖矩阵：合并区非左上角格子写 covered 占位（列序与 xlsx/ods 同一套语义）
    const covered = new Set<string>()
    const spans = new Map<string, { cs: number; rs: number }>()
    const grid: { col: number; cell: PMNode }[][] = []
    rows.forEach((row, ri) => {
      const line: { col: number; cell: PMNode }[] = []
      let c = 0
      for (const cell of row.content ?? []) {
        if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue
        while (covered.has(`${ri},${c}`)) c++
        const cs = Number(cell.attrs?.colspan ?? 1) || 1
        const rs = Number(cell.attrs?.rowspan ?? 1) || 1
        line.push({ col: c, cell })
        if (cs > 1 || rs > 1) spans.set(`${ri},${c}`, { cs, rs })
        for (let dr = 0; dr < rs; dr++)
          for (let dc = 0; dc < cs; dc++) if (dr || dc) covered.add(`${ri + dr},${c + dc}`)
        c += cs
      }
      grid.push(line)
    })
    // 后续行可能只写到部分列：补齐 covered 占位由 while+set 逻辑自然处理
    // 列数按"最右那一格的右缘"算（跨列的格把右缘推远），条件层的末列判据吃的是这个数
    let cols = 0
    for (const line of grid)
      for (const it of line) {
        const cs = Number(it.cell.attrs?.colspan ?? 1) || 1
        cols = Math.max(cols, it.col + cs)
      }
    // 命名表样式（v0.122）：表节点上的 tStyle 是 w:tblStyle 的身份，样式定义随 meta 带进来。
    // 没套样式时 mergedTableOf 返回空对象，下面的展开自然全空，与改版前逐字同形。
    const t = mergedTableOf(this.meta?.styles, String(node.attrs?.tStyle ?? ''))
    const look = condLookBits(t.cond)
    const hasT = Object.keys(t).length > 0
    const last = grid.length - 1
    const ts = this.tStyle(node, t.align)
    let out = `<table:table${ts ? ` table:style-name="${ts}"` : ''}>`
    grid.forEach((line, ri) => {
      let rowXml = ''
      const lastCol = Math.max(...line.map((x) => x.col), 0)
      let c = 0
      while (c <= lastCol) {
        if (covered.has(`${ri},${c}`)) {
          rowXml += '<table:covered-table-cell/>'
          c++
          continue
        }
        const item = line.find((x) => x.col === c)
        if (!item) {
          rowXml += '<table:table-cell/>'
          c++
          continue
        }
        const sp = spans.get(`${ri},${c}`)
        const colspan = sp?.cs ?? 1
        const base = hasT ? this.cellBase(t, look, ri, ri === last, c, colspan, cols) : undefined
        const cellStyle = this.cStyle(item.cell, base)
        const attrs = `${sp ? ` table:number-columns-spanned="${sp.cs}" table:number-rows-spanned="${sp.rs}"` : ''}${
          cellStyle ? ` table:style-name="${cellStyle}"` : ''
        }`
        const body = (item.cell.content ?? [])
          .map((x) => {
            if (x.type !== 'paragraph') return this.blocks([x])
            const sn = this.pStyle(x, '')
            return `<text:p${sn ? ` text:style-name="${sn}"` : ''}>${this.inline(x.content ?? [])}</text:p>`
          })
          .join('')
        rowXml += `<table:table-cell${attrs}>${body}</table:table-cell>`
        c += sp?.cs ?? 1
      }
      const rn = this.rStyle(rows[ri], hasT ? this.condRowHeight(t, look, ri, ri === last) : undefined)
      out += `<table:table-row${rn ? ` table:style-name="${rn}"` : ''}>${rowXml}</table:table-row>`
    })
    out += '</table:table>'
    return out
  }

  private stylesXml(): string {
    const footText = this.meta?.footerText?.trim()
    const withPage = this.meta?.footerPageNumber
    const pn = pageNumberParts(this.meta?.pageNumberFormat)
    // ODF 页码/总页数字段：缓存值写 1 / 3，应用打开后自行重算
    const pageField = `<text:page-number text:select-page="current">1</text:page-number>`
    const totalField = `<text:page-count>3</text:page-count>`
    const pageRun = `${esc(pn.before)}${pageField}${esc(pn.after)}${pn.total ? ` / ${totalField}` : ''}`
    let footer = ''
    if (footText && withPage) {
      footer = `<text:p text:style-name="Footer">${esc(footText)} · ${pageRun}</text:p>`
    } else if (withPage) {
      footer = `<text:p text:style-name="Footer">${pageRun}</text:p>`
    } else if (footText) {
      footer = `<text:p text:style-name="Footer">${esc(footText)}</text:p>`
    }
    const headerText = this.meta?.headerText?.trim()
    const master = `<style:master-page style:name="Standard" style:page-layout-name="pm1">${
      headerText ? `<style:header><text:p text:style-name="Header">${esc(headerText)}</text:p></style:header>` : ''
    }${footer ? `<style:footer>${footer}</style:footer>` : ''}</style:master-page>`
    const stylesNS = NS.split(' ')
      .filter((p) => /office|style|text|fo/.test(p))
      .join(' ')
    const pg = resolvePage(this.meta?.page)
    const pageProps =
      `<style:page-layout-properties ` +
      `fo:page-width="${mm2cm(pg.w)}" fo:page-height="${mm2cm(pg.h)}" ` +
      `fo:margin-top="${mm2cm(pg.margin.top)}" fo:margin-bottom="${mm2cm(pg.margin.bottom)}" ` +
      `fo:margin-left="${mm2cm(pg.margin.left)}" fo:margin-right="${mm2cm(pg.margin.right)}" ` +
      `style:num-format="1"/>`
    // 多栏：ODF 的栏数写在 page-layout 的 style:columns，栏分隔子元素个数 = 栏数-1（等宽用 rel-width="*"）
    const columns =
      pg.cols > 1
        ? `<style:columns fo:column-count="${pg.cols}" fo:column-gap="${mm2cm(pg.colGap)}">` +
          `<style:column style:rel-width="*" fo:break-before="auto"/></style:columns>`
        : ''
    return (
      `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${stylesNS} office:version="1.2">` +
      `<office:styles>` +
      `<style:style style:name="Standard" style:family="paragraph"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.2cm"/></style:style>` +
      `<style:style style:name="Text_20_Body" style:family="paragraph" style:parent-style-name="Standard"/>` +
      `<style:style style:name="PBK" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page" fo:margin-top="0cm" fo:margin-bottom="0cm"/></style:style>` +
      `<style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="end"/><style:text-properties fo:font-size="9pt" fo:color="#6b7280"/></style:style>` +
      `<style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="9pt" fo:color="#6b7280"/></style:style>` +
      `</office:styles>` +
      `<office:automatic-styles><style:page-layout style:name="pm1">${pageProps}${columns}</style:page-layout></office:automatic-styles>` +
      `<office:master-styles>${master}</office:master-styles>` +
      `</office:document-styles>`
    )
  }

  private manifestXml(): string {
    let entries =
      `<manifest:file-entry manifest:full-path="/" manifest:media-type="${OD_MIME}"/>` +
      `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
      `<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>`
    for (const e of this.images.values()) {
      entries += `<manifest:file-entry manifest:full-path="${e.file}" manifest:media-type="${e.mime}"/>`
    }
    return `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">${entries}</manifest:manifest>`
  }

  build(rootContent: PMNode[]): { content: string; styles: string; manifest: string } {
    // 先跑 blocks：charStyles 在行内渲染时才注册，autoStyles 必须后置求值
    const body = this.blocks(rootContent)
    const content =
      `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS} office:version="1.2">` +
      `<office:automatic-styles>${this.autoStyles()}</office:automatic-styles>` +
      `<office:body><office:text>${body}</office:text></office:body>` +
      `</office:document-content>`
    return { content, styles: this.stylesXml(), manifest: this.manifestXml() }
  }
}

export async function prosemirrorToOdtBytes(json: PMNode, meta?: DocMeta): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const builder = new OdtBuilder(meta)
  const parts = builder.build(json.content ?? [])
  const zip = new JSZip()
  // mimetype 必须为首条且不压缩
  zip.file('mimetype', OD_MIME, { compression: 'STORE' })
  zip.file('META-INF/manifest.xml', parts.manifest)
  zip.file('content.xml', parts.content)
  zip.file('styles.xml', parts.styles)
  for (const e of builder.images.values()) zip.file(e.file, e.bytes)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) as Promise<Uint8Array>
}

// ———— 导入 ————

interface StyleInfo {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  bg?: string
  mono?: boolean
  fam?: string
  szPx?: number
  /** 字符间距，规范化成 `"Npt"` */
  ls?: string
  sup?: boolean
  sub?: boolean
}

function pick(el: Element, localName: string): Element | null {
  for (const c of Array.from(el.children)) if (c.localName === localName) return c
  return null
}

/** 后代里首个指定 local name 的元素（不含自身）：draw:frame 与内容之间还隔着一层的情形 */
function findLocal(el: Element, localName: string): Element | null {
  for (const d of Array.from(el.getElementsByTagName('*'))) if (d.localName === localName) return d
  return null
}

/** 需要加括号才不歧义的片段（与 docx 侧 ommlLinear 同一条规则，两套标记语言翻成同一种线性写法） */
function mathGrouped(s: string): string {
  return /[\s/^_()+*\-]/.test(s) ? `(${s})` : s
}

const MATH_LEAF = new Set(['mi', 'mn', 'mo', 'mtext', 'ms'])

/**
 * MathML（呈现标记那一层）→ 线性文本。ODF 的公式存在 Objects/objectN/content.xml 里，
 * 本编辑器没有承载结构的节点，至少把字与运算关系留在文档里。
 * `annotation`/`annotation-xml` 里是 StarOffice 源码或 LaTeX 串，不是要显示的文字，一律跳过。
 */
function mathmlLinear(el: Element): string {
  const t = el.localName
  if (t === 'annotation' || t === 'annotation-xml') return ''
  if (MATH_LEAF.has(t)) return el.textContent ?? ''
  const kids = Array.from(el.children)
  const at = (i: number) => (kids[i] ? mathmlLinear(kids[i]) : '')
  switch (t) {
    case 'mfrac':
      return `${mathGrouped(at(0))}/${mathGrouped(at(1))}`
    case 'msup':
      return `${mathGrouped(at(0))}^${at(1)}`
    case 'msub':
      return `${mathGrouped(at(0))}_${mathGrouped(at(1))}`
    case 'msubsup':
      return `${mathGrouped(at(0))}_${mathGrouped(at(1))}^${at(2)}`
    case 'munder':
      return `${mathGrouped(at(0))}_${mathGrouped(at(1))}`
    case 'mover':
      return `${mathGrouped(at(0))}^${at(1)}`
    case 'munderover':
      return `${mathGrouped(at(0))}_${mathGrouped(at(1))}^${at(2)}`
    case 'msqrt':
      return `√(${kids.map(mathmlLinear).join('')})`
    case 'mroot':
      // MathML 的 mroot 是「被开方数在前、次数在后」，与 OOXML 的 m:rad 正好相反
      return `${mathGrouped(at(1))}√(${mathGrouped(at(0))})`
    case 'semantics':
      // semantics 的第一个孩子才是要显示的那份，后面是等价写法与注释
      return kids.length ? mathmlLinear(kids[0]) : ''
    case 'mtable':
      return kids.map(mathmlLinear).join(' ; ')
    case 'mtr':
      return kids.map(mathmlLinear).join(' , ')
    default:
      return kids.map(mathmlLinear).join('')
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function odtToHtml(bytes: Uint8Array): Promise<{ html: string; meta: DocMeta; warnings: string[] }> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const contentText = await zip.file('content.xml')?.async('string')
  if (!contentText) throw new Error('odt 缺少 content.xml')
  const stylesText = (await zip.file('styles.xml')?.async('string')) ?? ''
  const parser = new DOMParser()
  const cdoc = parser.parseFromString(contentText, 'text/xml')
  // 解析失败时 DOMParser 不抛错，只给一棵 parsererror 树：不挡的话整篇是"打开了一份空白文档"，
  // 用户看不出是文件坏了；抛出去让界面能说"加载失败：……"
  const perr = cdoc.getElementsByTagName('parsererror')[0]
  if (perr) throw new Error(`content.xml 不是合法的 XML：${(perr.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)}`)
  const sdoc = stylesText ? parser.parseFromString(stylesText, 'text/xml') : null

  /** 与 docx 保真导入同一套边界账：同类只记一条，出口写成「文案×N」，显示在状态栏而不是静默丢 */
  const warnCount = new Map<string, number>()
  const warn = (m: string) => warnCount.set(m, (warnCount.get(m) ?? 0) + 1)

  // 批注：文档顺序编号进 DocComment；openCids 记「已开未关」的区间（annotation-end 位置配对弹最后一枚，
  // 跨段续挂——mark 不能跨块，下一段开头要补一枚 span，与 docx 保真导入同一条规则）。
  // 点批注（没有配对 annotation-end 的）进 pointCids：只锚到本段段尾，不跨段续挂。
  const comments: DocComment[] = []
  const openCids: number[] = []
  const pointCids: number[] = []
  const endNames = new Set(
    Array.from(cdoc.getElementsByTagName('*'))
      .filter((x) => x.localName === 'annotation-end')
      .map((x) => x.getAttribute('office:name') ?? ''),
  )
  // mark 不能跨块：本段渲染前后把仍开着的区间各补一枚 span（cid 留在 openCids，下一段再开）
  const annWrap = (inner: string) => {
    const pre = openCids.map((c) => `<span data-oo-comment="${c}">`).join('')
    const post =
      '</span>'.repeat(pointCids.length) + '</span>'.repeat(openCids.length)
    pointCids.length = 0
    return pre + inner + post
  }

  const styles = new Map<string, Element>() // name → style:style / default-style
  const listStyles = new Map<string, boolean>() // name → 是否有序
  /** styles.xml 的 office:styles 里那批具名样式（Text Body、Heading 1…）：它们的排版是文档默认，不是某段的直接格式 */
  const namedStyles = new Set<string>()
  for (const d of [cdoc, sdoc]) {
    if (!d) continue
    for (const el of Array.from(d.getElementsByTagName('*'))) {
      if (el.localName === 'style') {
        const name = el.getAttribute('style:name')
        if (name && !styles.has(name)) styles.set(name, el)
        if (name && el.parentElement?.localName === 'styles') namedStyles.add(name)
      } else if (el.localName === 'list-style') {
        const name = el.getAttribute('style:name')
        if (name)
          listStyles.set(
            name,
            Array.from(el.getElementsByTagName('*')).some((x) => x.localName === 'list-level-style-number'),
          )
      }
    }
  }

  const resolveStyle = (name: string | null | undefined, depth = 0): StyleInfo => {
    if (!name || depth > 5) return {}
    const el = styles.get(name)
    if (!el) return {}
    const out: StyleInfo = resolveStyle(el.getAttribute('style:parent-style-name'), depth + 1)
    const tp = pick(el, 'text-properties') ?? el
    if (tp.getAttribute('fo:font-weight') === 'bold') out.bold = true
    if (tp.getAttribute('fo:font-style') === 'italic') out.italic = true
    const ul = tp.getAttribute('style:text-underline-type') ?? tp.getAttribute('style:text-underline-style')
    if (ul && ul !== 'none') out.underline = true
    const lt = tp.getAttribute('style:text-line-through-type') ?? tp.getAttribute('style:text-line-through-style')
    if (lt && lt !== 'none') out.strike = true
    const color = tp.getAttribute('fo:color')
    if (color && color !== 'inherit') out.color = color
    const pp = pick(el, 'paragraph-properties')
    const bg = tp.getAttribute('fo:background-color') ?? pp?.getAttribute('fo:background-color')
    if (bg && bg !== 'transparent' && bg !== 'inherit') out.bg = bg
    const font =
      tp.getAttribute('style:font-name') ?? tp.getAttribute('fo:font-name') ?? tp.getAttribute('style:font-name-asian')
    if (font && /courier|mono|consolas|menlo/i.test(font)) out.mono = true
    if (font) out.fam = font
    const sz = tp.getAttribute('fo:font-size')
    if (sz) {
      const v = parseFloat(sz)
      // 导出统一写 pt；宽松兼容 cm/mm 与无前缀（px）写法
      if (Number.isFinite(v) && v > 0)
        out.szPx = /cm$/.test(sz) ? Math.round(v * 37.8) : /mm$/.test(sz) ? Math.round(v * 3.78) : /px$/.test(sz) ? Math.round(v) : Math.round((v * 96) / 72)
    }
    const ls = tp.getAttribute('fo:letter-spacing')
    if (ls) {
      // normal 不是「没声明」而是「说了没有间距」：Word 门面在声明 normal 的词上读 0，整枚不写才跟着祖先那一档；
      // 屏上 normal 与 0pt 等宽，而模型那头只留得下数（parseHTML 把 normal 整枚剥掉），所以这一档落 0pt 而不是落 normal 这个词。
      if (ls.trim().toLowerCase() === 'normal') out.ls = '0pt'
      // pt/px 直接进 char-spacing 那扇门（先折一趟 px 会把 0.05pt 变成 0.0525pt），其余单位走 lenPx 那枝梯子
      let v = toLetterSpacingPt(ls)
      if (!v) {
        const px = lenPx(ls)
        if (px !== undefined) v = toLetterSpacingPt(`${px}px`)
      }
      if (v) out.ls = v
    }
    const pos = tp.getAttribute('style:text-position')
    if (pos) {
      // ODF 一条属性同时表方向与偏移（super 58% / sub -25%），normal 表示回到基线
      const w = pos.trim().toLowerCase()
      out.sup = w.startsWith('super')
      out.sub = w.startsWith('sub')
    }
    return out
  }

  /** 样式名 → 从祖先到自己的样式元素链（派生样式要连父样式一起看） */
  const styleChain = (name: string | null | undefined): Element[] => {
    const out: Element[] = []
    let el = name ? styles.get(name) : undefined
    for (let guard = 0; el && guard < 6; guard++) {
      out.unshift(el)
      el = styles.get(el.getAttribute('style:parent-style-name') ?? '')
    }
    return out
  }

  /** 段落直接格式：对齐 + 缩进（本应用把它写成派生自动样式，第三方文件同理） */
  interface ParaFormat {
    align?: string
    leftPx?: number
    rightPx?: number
    firstPx?: number
    /** 行距：倍数（rule=auto）或 px（exact/atLeast） */
    lh?: number
    lr?: LineRule
    sb?: number
    sa?: number
    bg?: string
    bd?: Partial<Record<CellEdge, string>>
  }

  const resolvePara = (name: string | null | undefined): ParaFormat => {
    const out: ParaFormat = {}
    const bd = () => (out.bd ??= {})
    for (const el of styleChain(name)) {
      const pp = pick(el, 'paragraph-properties')
      if (!pp) continue
      const al = pp.getAttribute('fo:text-align')
      if (al) out.align = CSS_ALIGN[al] ?? out.align
      const ml = len2px(pp.getAttribute('fo:margin-left'))
      if (ml !== undefined) out.leftPx = ml
      const mr = len2px(pp.getAttribute('fo:margin-right'))
      if (mr !== undefined) out.rightPx = mr
      const ti = len2px(pp.getAttribute('fo:text-indent'))
      if (ti !== undefined) out.firstPx = ti
      // 下面这几项只从"这一段的样式"取：具名样式（Standard/PQ/H1…）里的那些是整篇的默认，
      // 摊到每一段上就等于把默认值写成直接格式，导出再开会长出一整篇的显式行距
      const sn = String(el.getAttribute('style:name'))
      if (namedStyles.has(sn) || FIXED_PARA_STYLES.has(sn)) continue
      const sh = lenPx(pp.getAttribute('fo:margin-top'))
      if (sh !== undefined) out.sb = sh
      const sv = lenPx(pp.getAttribute('fo:margin-bottom'))
      if (sv !== undefined) out.sa = sv
      const lv = pp.getAttribute('fo:line-height')
      if (lv) {
        const t = lv.trim().toLowerCase()
        if (t.endsWith('%')) {
          const n = Number.parseFloat(t)
          if (Number.isFinite(n) && n > 0) {
            out.lh = Math.round(n) / 100
            out.lr = 'auto'
          }
        } else {
          const px = lenPx(t)
          if (px !== undefined && px > 0) {
            out.lh = px
            // ODF 1.2 的 method 优先；老文件只有 style:line-height（proportional/fixed/minimum/leading）
            const m = (pp.getAttribute('style:line-height-method') ?? pp.getAttribute('style:line-height') ?? '')
              .trim()
              .toLowerCase()
            out.lr = m === 'minimum' ? 'atLeast' : 'exact'
          }
        }
      }
      const bg = pp.getAttribute('fo:background-color')
      if (bg && !/^(auto|transparent|inherit|none)$/.test(bg.trim().toLowerCase())) out.bg = rgb2hex(bg) ?? bg.trim()
      // 四边各一条 fo:border-<edge>，简写 fo:border 是「四边同值」的兜底
      const bs = pp.getAttribute('fo:border')
      for (const edge of CELL_EDGES) {
        const v = odfBorderCss(pp.getAttribute(`fo:border-${edge}`) ?? bs)
        if (v) bd()[edge] = v
      }
    }
    return out
  }

  /**
   * 段落 → 行内 style（textAlign / Indent / ParagraphStyle 三个扩展都按行内样式解析）。
   * minusLeft 是容器本身已经给出的左边距（blockquote 即 PQ 的 0.8cm），只把超出的那一档落成缩进属性。
   */
  const paraStyle = (name: string | null | undefined, minusLeft = 0): string => {
    const p = resolvePara(name)
    const bits: string[] = []
    if (p.align && p.align !== 'left') bits.push(`text-align: ${p.align}`)
    const left = (p.leftPx ?? 0) - minusLeft
    if (left > 0) bits.push(`margin-left: ${left}px`)
    if (p.rightPx) bits.push(`margin-right: ${p.rightPx}px`)
    if (p.firstPx) bits.push(`text-indent: ${p.firstPx}px`)
    if (p.lh !== undefined) bits.push(p.lr === 'auto' || p.lr === undefined ? `line-height: ${p.lh}` : `line-height: ${p.lh}px`)
    // 「最小值」与「固定值」在 CSS 里同为绝对行高，只有 OOXML 分这两档，靠自定义属性带回去
    if (p.lr === 'atLeast') bits.push('--oof-lr: atLeast')
    if (p.sb !== undefined) bits.push(`margin-top: ${p.sb}px`)
    if (p.sa !== undefined) bits.push(`margin-bottom: ${p.sa}px`)
    if (p.bg) bits.push(`background-color: ${p.bg}`)
    for (const edge of CELL_EDGES) {
      const v = p.bd?.[edge]
      if (v) bits.push(`border-${edge}: ${v}`)
    }
    return bits.length ? ` style="${bits.join('; ')}"` : ''
  }

  /**
   * 单元格样式（table-cell 家族）→ td 的行内 style。
   * CellStyle 扩展就是按 border 四边、background-color、vertical-align 这几条行内属性取值的，
   * 而 ODF 侧它们只能住在样式里（表格单元格不给内联），这里就是两者之间的桥。
   */
  const cellStyleCss = (name: string | null | undefined): string => {
    const o: Record<string, string> = {}
    for (const el of styleChain(name)) {
      const tp = pick(el, 'table-cell-properties')
      if (!tp) continue
      // 四边各有一条 fo:border-<edge>，简写 fo:border 是「四边同值」的兜底
      const shorthand = tp.getAttribute('fo:border')
      for (const edge of CELL_EDGES) {
        const v = odfBorderCss(tp.getAttribute(`fo:border-${edge}`) ?? shorthand)
        if (v) o[`border-${edge}`] = v
      }
      const bg = tp.getAttribute('fo:background-color')
      if (bg && !/^(auto|transparent|inherit)$/.test(bg.trim().toLowerCase()))
        o['background-color'] = rgb2hex(bg) ?? bg.trim()
      // 边距：四边各一条 fo:padding-<edge>，fo:padding 简写是兜底（逐边那份压过简写）；0 也上账
      const pd = expandPadding(tp.getAttribute('fo:padding'))
      CELL_EDGES.forEach((edge, i) => {
        const v = lenPx(tp.getAttribute(`fo:padding-${edge}`)) ?? pd?.[i]
        if (v !== undefined && v >= 0) o[`padding-${edge}`] = `${v}px`
      })
      const va = tp.getAttribute('style:vertical-align')?.trim().toLowerCase()
      if (va === 'top' || va === 'bottom') o['vertical-align'] = va
      else if (va === 'middle' || va === 'center') o['vertical-align'] = 'middle'
    }
    return Object.keys(o).length ? ` style="${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('; ')}"` : ''
  }

  /** 表格样式（table 家族）的 fo:margin-left → 缩进；表宽由 CellStyle 的 renderHTML 自己收 */
  const tableStyleCss = (name: string | null | undefined): string => {
    let ml: number | undefined
    for (const el of styleChain(name)) {
      const tp = pick(el, 'table-properties')
      const v = len2px(tp?.getAttribute('fo:margin-left'))
      if (v !== undefined) ml = v
    }
    return ml && ml > 0 ? ` style="margin-left: ${ml}px"` : ''
  }

  /**
   * 列样式（table-column 家族）→ 列宽 px。ODF 的列宽不挂在 `<table:table-column>` 元素上，
   * 而是挂在它自己的自动样式里（`style:table-column-properties/@style:column-width`）。
   * 同层的 `style:rel-column-width`（scale / proportional / 正整数百分比）不是长度 ⇒ 按「没说」记，
   * 宽度留给模型与浏览器自己分配。
   */
  const columnWidthPx = (name: string | null | undefined): number | undefined => {
    let w: number | undefined
    for (const el of styleChain(name)) {
      const cp = pick(el, 'table-column-properties')
      const v = lenPx(cp?.getAttribute('style:column-width'))
      if (v !== undefined && v > 0) w = v
    }
    return w
  }

  /**
   * 行样式（table-row 家族）→ 行高 px，出 `<tr style="height: Npx">`（CellStyle 的 rowHeight 就吃这一枚）。
   * ODF 这一头有四枚字面并存，全部收进模型同一枚下限，优先级 row-height > min-row-height >
   * fo:minimum-row-height > fo:min-height（同一枚样式里取先命中的那一档，与 Word 门面
   * 「两档并存时 row-height 压过 minimum」同形；样式链上则后代压过祖先，与其余样式通道一致）。
   * 其中只有 style:row-height 与 style:min-row-height 是 Word 读得进的（fo: 那两枚在它门面 0 进账），
   * 读侧仍放宽是为了第三方文件的现实；row-height 那档在 Word 侧是精确档，读进来按下限记是模型既有裁决。
   */
  const rowHeightPx = (name: string | null | undefined): number | undefined => {
    let h: number | undefined
    for (const el of styleChain(name)) {
      const rp = pick(el, 'table-row-properties')
      if (!rp) continue
      for (const k of ['style:row-height', 'style:min-row-height', 'fo:minimum-row-height', 'fo:min-height']) {
        const v = lenPx(rp.getAttribute(k))
        if (v !== undefined && v > 0) {
          h = v
          break
        }
      }
    }
    return h
  }

  const htmlOfStyle = (si: StyleInfo, inner: string): string => {
    let html = inner
    if (si.mono) html = `<code>${html}</code>`
    if (si.bg) html = `<span style="background-color: ${si.bg}">${html}</span>`
    // 字体族/字号/字色/字距同挂 textStyle mark，必须合成一个 span，不能嵌套两层同类 mark
    const css: string[] = []
    if (si.fam) css.push(`font-family: ${si.fam}`)
    if (si.szPx) css.push(`font-size: ${si.szPx}px`)
    if (si.color) css.push(`color: ${si.color}`)
    if (si.ls) css.push(`letter-spacing: ${si.ls}`)
    if (css.length) html = `<span style="${css.join('; ')}">${html}</span>`
    if (si.strike) html = `<s>${html}</s>`
    if (si.underline) html = `<u>${html}</u>`
    if (si.italic) html = `<em>${html}</em>`
    if (si.bold) html = `<strong>${html}</strong>`
    // 上下标套在最外层：superscript/subscript 是独立 mark，与加粗同层不会互相吞掉
    if (si.sup) html = `<sup>${html}</sup>`
    else if (si.sub) html = `<sub>${html}</sub>`
    return html
  }

  /**
   * 脚注/尾注正文表：`text:id` → 正文元素。
   * 三种外壳都收：ODF 1.2 的 `text:footnote` / `text:endnote`，与旧版（ODF 1.0/1.1、一些转换器）
   * 的单一 `text:note`（靠 `text:note-class` 分辨类型，正文再套一层 `text:note-body`）。
   * 建全表而不是"找下一个兄弟"：引用与正文按规范相邻，但第三方文件里位置未必守规矩。
   */
  const noteBodies = new Map<string, Element>()
  // 同一趟预扫里收「被独立引用枚配走的那些 id」：老式内联锚要不要自己出正文，取决于本件有没有别处已经在配它
  const refClaimed = new Set<string>()
  for (const el of Array.from(cdoc.getElementsByTagName('*'))) {
    if (el.localName === 'footnote-reference' || el.localName === 'endnote-reference' || el.localName === 'note-reference') {
      const id = el.getAttribute('text:id')
      if (id) refClaimed.add(id)
      continue
    }
    if (el.localName === 'footnote' || el.localName === 'endnote' || el.localName === 'note') {
      const id = el.getAttribute('text:id')
      if (id && !noteBodies.has(id)) noteBodies.set(id, el)
    }
  }

  /**
   * 注正文按文档顺序摊成行：`p`/`h` 各一行，`list` 递归进 `list-item`（真件 ooo77837-1 的 13 字住这一层，
   * 而主文对同一形状本来就有出口）。index 壳（bibliography / alphabetical-index / table-of-content）明不吃，
   * 与主文同一口径（c2：主文对这些壳出的字=0）。
   */
  function noteBlockLines(holder: Element): string[] {
    const lines: string[] = []
    for (const c of Array.from(holder.children)) {
      if (c.localName === 'p' || c.localName === 'h') lines.push(notePlainText(c))
      else if (c.localName === 'list') {
        for (const k of Array.from(c.children)) {
          if (k.localName === 'list-item' || k.localName === 'list') lines.push(...noteBlockLines(k))
        }
      }
    }
    return lines
  }

  /** 正文元素内的段落文本（不含 citation 的那个数字）；段间与段内换行都归一成 \n，与 docx 侧同一套约定 */
  function noteBodyText(body: Element): string {
    const holder = Array.from(body.children).find((c) => c.localName === 'note-body') ?? body
    const lines = noteBlockLines(holder)
    // 一枚认得的块都没有才整体兜底（真语料 c1 兜底路径 0 枚撞，这一枝只是给异形件留的门）
    return (lines.length ? lines : [notePlainText(holder)]).join('\n')
  }

  function notePlainText(el: Element): string {
    let s = ''
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3) s += c.nodeValue ?? ''
      else if (c.nodeType === 1) {
        const e = c as Element
        // citation 里是字面编号（老格式必须写），跟着正文读就会漏进用户文字
        if (/(^|-)citation$/.test(e.localName)) continue
        if (e.localName === 's') s += ' '.repeat(Math.max(1, Number(e.getAttribute('text:c') ?? 1)))
        else if (e.localName === 'tab') s += '    '
        else if (e.localName === 'line-break') s += '\n'
        else s += notePlainText(e)
      }
    }
    return s
  }

  /** 标记节点：正文只进 data 属性，序号交给 CSS counter（与 docx 保真导入写的完全同一个 span） */
  function noteSpanHtml(kind: 'footnote' | 'endnote', text: string): string {
    // 先编码换行（属性值里的 LF 会被解析器归一成空格），再转义 & < > "
    const a = encodeNoteText(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
    return `<span class="doc-note" data-oo-note-kind="${kind}" data-oo-note-text="${a}"></span>`
  }

  /**
   * 嵌入对象摊出来的**块级**正文。draw:frame 住在段落里，而表格一类必须是块（段内嵌表会被
   * ProseMirror 的内容表达式整块丢掉，等于字又没了），所以先攒在这里，由产出段落的那几处接在
   * 自己后面成为兄弟块。单元格里的对象不攒：改走 inlineFlatten 压成行文本。
   */
  const embedBlocks: string[] = []
  let inCell = 0
  const tail = (): string => embedBlocks.splice(0).join('')

  const imgCache = new Map<string, Promise<string>>()
  const imageDataUrl = (href: string): Promise<string> => {
    if (href.startsWith('data:')) return Promise.resolve(href)
    const hit = imgCache.get(href)
    if (hit) return hit
    const p = (async () => {
      const f = zip.file(href.replace(/^\.\//, ''))
      if (!f) return ''
      const b = await f.async('base64')
      const ext = href.split('.').pop()?.toLowerCase() ?? 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      return `data:${mime};base64,${b}`
    })()
    imgCache.set(href, p)
    return p
  }

  /** 嵌入对象的正文：公式部件（Objects/objectN/content.xml）里有 MathML，其它对象没有可读文字 */
  const objectText = async (href: string): Promise<string> => {
    const base = href.replace(/^\.\//, '').replace(/\/$/, '')
    for (const p of [`${base}/content.xml`, base]) {
      const f = zip.file(p)
      if (!f) continue
      const doc = parser.parseFromString(await f.async('string'), 'text/xml')
      const root = doc.documentElement
      if (!root || doc.querySelector('parsererror')) continue
      // 只认有呈现标记的那类；剩下是 StarOffice 源码或二进制注释，塞进正文等于凭空造字
      if (Array.from(root.getElementsByTagName('*')).some((x) => MATH_LEAF.has(x.localName))) return mathmlLinear(root)
      return ''
    }
    return ''
  }

  /** office:mime-type → 一个带扩展名的名字：unwrapEmbed 的主判据是魔数，扩展名只用来补文本与 CSV 那两类 */
  const MIME_NAME: Record<string, string> = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'sheet.xlsx',
    'application/vnd.ms-excel': 'sheet.xls',
    'application/msword': 'doc.doc',
    'text/csv': 'data.csv',
    'text/plain': 'text.txt',
  }
  /** 目录型对象里属于 ODF 自己的部件：剩下的那一个才是原生文件 */
  const ODF_OWN = new Set(['mimetype', 'content.xml', 'styles.xml', 'meta.xml', 'settings.xml', 'preview.wmf'])

  /**
   * 嵌入对象的**内容**。ODF 把外来件放成两种形状：老的是 `<office:binary-data>` 内联 base64，
   * 新的是 `Objects/objN/` 一个目录（里面是原生文件，或者整套迷你 ODF）。两种都先解出字节，
   * 再交给 lib/ole 那一套容器分派（CFB → `\x01Ole10Native` → 内层文件）。
   * 迷你 ODF 包不在这一版展开：它的样式表与本页的不是同一份，硬接等于假装能读。
   */
  const embedOfObject = async (obj: Element): Promise<EmbedHtml | null> => {
    let bytes: Uint8Array | null = null
    let name = MIME_NAME[(obj.getAttribute('office:mime-type') ?? '').toLowerCase()] ?? ''
    const inline = (findLocal(obj, 'binary-data')?.textContent ?? '').replace(/\s+/g, '')
    if (inline.length > 8) {
      try {
        const s = atob(inline)
        bytes = new Uint8Array(s.length)
        for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
      } catch {
        return null
      }
    }
    if (!bytes) {
      const base = (obj.getAttribute('xlink:href') ?? '').replace(/^\.\//, '').replace(/\/$/, '')
      if (!base) return null
      for (const n of Object.keys(zip.files)) {
        if (!n.startsWith(base + '/') || n.endsWith('/') || zip.file(n) === null) continue
        const rel = n.slice(base.length + 1)
        if (ODF_OWN.has(rel) || rel.includes('/')) continue
        bytes = await zip.file(n)!.async('uint8array')
        if (!name) name = rel
        break
      }
    }
    if (!bytes) return null
    const content = unwrapEmbed(bytes, name || '嵌入对象')
    if (!content) return null
    return embedHtml(content, 0)
  }

  async function renderInline(el: Element): Promise<string> {
    let out = ''
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        out += escapeHtml(child.nodeValue ?? '')
      } else if (child.nodeType === 1) {
        const e = child as Element
        switch (e.localName) {
          case 's':
            out += ' '.repeat(Math.max(1, Number(e.getAttribute('text:c') ?? 1)))
            break
          case 'tab':
            out += '    '
            break
          case 'line-break':
            out += '<br/>'
            break
          case 'span':
            out += htmlOfStyle(resolveStyle(e.getAttribute('text:style-name')), await renderInline(e))
            break
          case 'a':
            out += `<a href="${escapeHtml(e.getAttribute('xlink:href') ?? '')}">${await renderInline(e)}</a>`
            break
          case 'annotation': {
            // 批注本体：收进 DocComment（作者/日期/正文），正文不摊进段落；区间从此处包 span
            // 不收 e 的孩子——批注的 text:p 是内容不是正文，掉进 default 递归就会整段漏进文档（v0.86 前置实测量到的污染格）
            const bodyPs = Array.from(e.getElementsByTagName('*')).filter((x) => x.localName === 'p' && x.namespaceURI?.includes('text'))
            const text = bodyPs.length
              ? bodyPs.map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
              : (e.textContent ?? '').replace(/\s+/g, ' ').trim()
            const cid = comments.length + 1
            // dc:creator / dc:date 是 annotation 的子元素（ODF 1.2），不是属性——按元素收
            const dcEl = (name: string) =>
              Array.from(e.getElementsByTagName('*')).find(
                (x) => x.localName === name && (x.namespaceURI ?? '').includes('purl.org/dc'),
              )?.textContent?.trim() || undefined
            comments.push({
              id: cid,
              author: dcEl('creator'),
              date: dcEl('date'),
              text,
            })
            const name = e.getAttribute('office:name') ?? ''
            if (name && !endNames.has(name)) pointCids.push(cid)
            else openCids.push(cid)
            out += `<span data-oo-comment="${cid}">`
            break
          }
          case 'annotation-end': {
            const cid = openCids.pop()
            if (cid != null) out += '</span>'
            break
          }
          case 'frame': {
            // 一个 draw:frame 里装的是同类的一件东西：位图 / 文本框 / 嵌入对象（公式走这条）
            let src = ''
            let imgEl: Element | null = null
            for (const d of Array.from(e.getElementsByTagName('*'))) {
              if (d.localName === 'image') {
                imgEl = d
                break
              }
            }
            if (imgEl) {
              src = await imageDataUrl(imgEl.getAttribute('xlink:href') ?? '')
            }
            if (src) {
              const wmm = cm2mm(e.getAttribute('svg:width'))
              out += wmm
                ? `<img src="${src}" style="width:${Math.round((wmm / 25.4) * 96)}px"/>`
                : `<img src="${src}"/>`
              break
            }
            // 文本框：正文原来整块消失（比版式没保真严重一级），现在展平进所在段落，行与行之间用换行连
            const box = findLocal(e, 'text-box')
            if (box) {
              const lines: string[] = []
              for (const p of Array.from(box.children)) {
                if (!['p', 'h', 'list'].includes(p.localName)) continue
                const s = (await renderInline(p)).replace(/<br\/?>/g, ' ')
                if (s.trim()) lines.push(s)
              }
              if (lines.length) {
                out += lines.join('<br/>')
                warn('文本框内容已展平为文字（位置与文字环绕未保留）')
              } else warn('空文本框未导入')
              break
            }
            const obj = findLocal(e, 'object') ?? findLocal(e, 'embed') ?? findLocal(e, 'animate')
            if (obj) {
              // objectText 取的是 href 那个迷你 ODF 包里的正文，只有 href 才可能是公式
              const href = obj.getAttribute('xlink:href') ?? ''
              const s = href ? await objectText(href) : ''
              if (s) {
                out += escapeHtml(s)
                warn('公式已线性化为文本，结构不保真')
                break
              }
              // 内联 base64（<office:binary-data>）那种老写法根本没有 href，
              // 所以取内容这一趟不能压在 href 后面，否则它永远走不到
              const body = await embedOfObject(obj)
              if (body?.html) {
                if (inCell) out += inlineFlatten(body.html)
                else embedBlocks.push(body.html)
                for (const n of body.notes) warn(n)
                break
              }
              for (const n of body?.notes ?? []) warn(n)
              warn('嵌入对象（draw:object）未导入')
              break
            }
            if (findLocal(e, 'chart') || Array.from(e.getElementsByTagName('*')).some((d) => d.localName === 'chart'))
              warn('图表对象未导入')
            else warn('矢量图形（draw:frame 无位图）未导入')
            break
          }
          case 'noscript':
            break
          case 'footnote-reference':
          case 'endnote-reference':
          case 'note-reference': {
            // 旧版把类型记在 text:note-class 上，新版拆成两个元素名；两种都认
            const cls = (e.getAttribute('text:note-class') ?? '').toLowerCase()
            const kind: 'footnote' | 'endnote' =
              e.localName === 'endnote-reference' || cls === 'endnote' ? 'endnote' : 'footnote'
            const body = noteBodies.get(e.getAttribute('text:id') ?? '')
            // 有号没正文（损坏件或被截断的转换）就不产标记：留一枚空圈号会在下一次导出时长成一条真空白脚注
            if (body) out += noteSpanHtml(kind, noteBodyText(body))
            break
          }
          case 'footnote':
          case 'endnote':
            break // 新版正文与引用是同一段里相邻的两枚，出口已在上面那一枝；再摊进段落就成了"脚注文字混进正文"
          case 'note': {
            // 老式内联锚（ODF 1.0/1.1 与不少转换器）：`text:note` 自己就住在正文流里，正文套在自己的 `text:note-body` 里，
            // 而这一档压根不发独立引用枚——不给它出口，注文在屏上一枚都不会出现。
            if (refClaimed.has(e.getAttribute('text:id') ?? '')) break // 本件另有引用枚配过同一枚 id：正文已出过，这里再出就是双份
            const cls = (e.getAttribute('text:note-class') ?? '').toLowerCase()
            out += noteSpanHtml(cls === 'endnote' ? 'endnote' : 'footnote', noteBodyText(e))
            break
          }
          default:
            out += await renderInline(e)
        }
      }
    }
    return out
  }

  async function renderChildrenBlocks(el: Element): Promise<string> {
    let out = ''
    for (const child of Array.from(el.children)) {
      if (['s', 'tab', 'line-break', 'span', 'a', 'frame'].includes(child.localName)) {
        // 容器里直接散落的行内容（list-item/table-cell 均可能）
        out += `<p>${annWrap(await renderInline(el))}</p>${tail()}`
        return out
      }
      out += await renderBlock(child)
    }
    return out
  }

  async function renderBlock(el: Element): Promise<string> {
    switch (el.localName) {
      case 'h': {
        const level = Math.min(4, Math.max(1, Number(el.getAttribute('text:outline-level') ?? 1)))
        const sn = el.getAttribute('text:style-name')
        // 派生样式（PSn）挂在 H1..H4 之下，对齐与缩进照旧从样式链上取
        const hbrk = styleChain(sn).some(
          (x) => pick(x, 'paragraph-properties')?.getAttribute('fo:break-before') === 'page'
        )
        return `${hbrk ? '<div data-oo-pagebreak="1"></div>' : ''}<h${level}${paraStyle(sn)}>${annWrap(
          await renderInline(el)
        )}</h${level}>${tail()}`
      }
      case 'p': {
        const sn = el.getAttribute('text:style-name')
        const chain = styleChain(sn)
        const names = chain.map((x) => x.getAttribute('style:name'))
        // 分页符：本编辑器写 PBK，第三方按段落样式里的 break-before 识别
        if (
          names.includes('PBK') ||
          chain.some((x) => pick(x, 'paragraph-properties')?.getAttribute('fo:break-before') === 'page')
        ) {
          // 标记与该块自己的字是两件事：空分页段（自家写手发的就是空段）只出标记，多出 `<p></p>` 会让往返多出一枚凭空的空段；
          // 带字的分页段（只在第三方件里现形）两头都出——从前这一枝 return 掉整枚段而把字丢了。
          const inner = await renderInline(el)
          return inner.trim() === ''
            ? `<div data-oo-pagebreak="1"></div>`
            : `<div data-oo-pagebreak="1"></div><p${paraStyle(sn)}>${annWrap(inner)}</p>${tail()}`
        }
        if (names.includes('PC')) return `<pre><code>${await renderInline(el)}</code></pre>${tail()}`
        if (names.includes('PQ'))
          return `<blockquote><p${paraStyle(sn, 30)}>${annWrap(await renderInline(el))}</p></blockquote>${tail()}`
        return `<p${paraStyle(sn)}>${annWrap(await renderInline(el))}</p>${tail()}`
      }
      case 'list': {
        const ordered = listStyles.get(el.getAttribute('text:style-name') ?? '') ?? false
        const items: string[] = []
        for (const child of Array.from(el.children)) {
          if (child.localName === 'list-item') {
            items.push(`<li>${await renderChildrenBlocks(child)}</li>`)
          } else if (child.localName === 'list') {
            const nested = await renderBlock(child)
            if (items.length) items[items.length - 1] += nested
            else items.push(`<li>${nested}</li>`)
          }
        }
        return `<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`
      }
      case 'table': {
        const rows: string[] = []
        // 列宽槽表：一枚 `<table:table-column>` 按 `table:number-columns-repeated` 占连续多槽，
        // 首行每格按 colspan 吃同宽度的那几枚槽 ⇒ 宽度出在首行格子的 colwidth 上（docx 侧同名属性）。
        const slots: (number | undefined)[] = []
        for (const c of Array.from(el.children)) {
          if (c.localName !== 'table-column') continue
          const rep = Math.max(1, Math.round(Number(c.getAttribute('table:number-columns-repeated') ?? 1)) || 1)
          const w = columnWidthPx(c.getAttribute('table:style-name'))
          for (let k = 0; k < rep; k++) slots.push(w)
        }
        /** 这格那一刀的宽度账：连续 cs 枚槽全有账才出这一刀（抵出槽外的槽按「没账」走）；出整数 px（模型取 colwidth 用 parseInt，小数会被砍） */
        const colwidthOf = (gc: number, cs: number): string => {
          if (cs < 1) return ''
          const out: number[] = []
          for (let k = 0; k < cs; k++) {
            const v = slots[gc + k]
            if (v === undefined) return ''
            const px = Math.round(v)
            if (px < 1) return ''
            out.push(px)
          }
          return ` colwidth="${out.join(',')}"`
        }
        inCell++ // 单元格里放不下第二层表：嵌入正文改压成行内文本，别让它整块被内容表达式丢掉
        let ri = 0
        for (const r of Array.from(el.children)) {
          if (r.localName !== 'table-row') continue
          const cells: string[] = []
          let gc = 0
          for (const c of Array.from(r.children)) {
            // 首行的 covered 是前一格 colspan 的占位填充件（真件三张可裁的表上「跨度之和==槽数」而「跨度之和+covered」多出，
            // 见 a5b），它自己不再占一枚槽；首行之上没有行，所以这一行里的 covered 不可能来自纵向合并。
            if (c.localName === 'covered-table-cell') continue
            if (c.localName !== 'table-cell') continue
            const cs = Number(c.getAttribute('table:number-columns-spanned') ?? 1)
            const rs = Number(c.getAttribute('table:number-rows-spanned') ?? 1)
            // 首行的重复格（number-columns-repeated>1）在这一排被压成一枚 td，HTML 网格压根没有那些槽 ⇒ 不出账
            const rep = Number(c.getAttribute('table:number-columns-repeated') ?? 1)
            const cw = ri === 0 && rep === 1 ? colwidthOf(gc, cs) : ''
            gc += cs
            const attrs = `${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}${cw}${cellStyleCss(c.getAttribute('table:style-name'))}`
            cells.push(`<td${attrs}>${await renderChildrenBlocks(c)}</td>`)
          }
          ri += 1
          const rh = rowHeightPx(r.getAttribute('table:style-name'))
          rows.push(`<tr${rh !== undefined ? ` style="height: ${rh}px"` : ''}>${cells.join('')}</tr>`)
        }
        inCell--
        return `<table${tableStyleCss(el.getAttribute('table:style-name'))}><tbody>${rows.join('')}</tbody></table>`
      }
      case 'body':
      case 'text':
      case 'section':
        // 文本节是块容器不是排版单位：孩子平铺进同一股流。
        // `text:display="none"` / 隐藏条件那一档本轮不设求值器（条件要读文档设置），内容照落，门面上 Word 也是这么落的。
        return await renderChildrenBlocks(el)
      default:
        return ''
    }
  }

  const body = cdoc.getElementsByTagNameNS('*', 'body')[0]
  const otext = body ? pick(body, 'text') : null
  const html = otext ? `${await renderChildrenBlocks(otext)}${tail()}` : ''

  // —— meta：styles.xml 的 master-page 头脚
  const meta: DocMeta = {}
  if (comments.length) meta.comments = comments
  if (sdoc) {
    const master = Array.from(sdoc.getElementsByTagName('*')).find((x) => x.localName === 'master-page')
    const plain = (n: Element | null | undefined) => (n ? (n.textContent ?? '').replace(/\s+/g, ' ').trim() : '')
    const header = master ? pick(master, 'header') : null
    const footer = master ? pick(master, 'footer') : null
    const headText = plain(header ?? undefined)
    if (headText) meta.headerText = headText
    if (footer) {
      const kids = Array.from(footer.getElementsByTagName('*'))
      const hasPage = kids.some((x) => x.localName === 'page-number')
      const hasCount = kids.some((x) => x.localName === 'page-count')
      let foot = plain(footer)
      if (hasPage) {
        meta.footerPageNumber = true
        meta.pageNumberFormat = detectPageFormat(foot, hasCount)
        foot = foot
          .replace(/第\s*\d+\s*页/g, ' ')
          .replace(/-?\s*\d+\s*-?/g, ' ')
          .replace(/·/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      }
      if (foot) meta.footerText = foot
    }
    // 页面设置：page-layout-properties 的纸张与四边距 + style:columns 的分栏
    // 「这张纸」取哪一枚：ODF 由 master-page 的 style:page-layout-name 指定，而 styles.xml 文档序的第一枚
    // page-layout-properties 常是 <style:default-page-layout> 的孩子（真件 77 枚里 11 枚如此，那一枚六枚长度字面全缺）。
    // 引名查不到才回退旧行为（文档序第一枚）：缺引名的外部件不会因此从有账变没账。
    const firstPlp = Array.from(sdoc.getElementsByTagName('*')).find((x) => x.localName === 'page-layout-properties')
    const plpName = master?.getAttribute('style:page-layout-name')
    const plpEl = plpName
      ? Array.from(sdoc.getElementsByTagName('*')).find(
          (x) => x.localName === 'page-layout' && x.getAttribute('style:name') === plpName
        )
      : undefined
    const plp = (plpEl ? pick(plpEl, 'page-layout-properties') : null) ?? firstPlp
    const pw = cm2mm(plp?.getAttribute('fo:page-width') ?? null)
    const ph = cm2mm(plp?.getAttribute('fo:page-height') ?? null)
    const page: PageSetup = {}
    if (pw && ph) {
      const near = (a: number, b: number) => Math.abs(a - b) < 1.5
      const size = near(pw, 210) && near(ph, 297) ? 'A4' : near(pw, 215.9) && near(ph, 279.4) ? 'Letter' : 'custom'
      const r1 = (v: number) => Math.round(v * 10) / 10
      const margin: Partial<PageMargin> = {}
      const mt = cm2mm(plp?.getAttribute('fo:margin-top') ?? null)
      const mb = cm2mm(plp?.getAttribute('fo:margin-bottom') ?? null)
      const ml = cm2mm(plp?.getAttribute('fo:margin-left') ?? null)
      const mr = cm2mm(plp?.getAttribute('fo:margin-right') ?? null)
      if (mt) margin.top = r1(mt)
      if (mb) margin.bottom = r1(mb)
      if (ml) margin.left = r1(ml)
      if (mr) margin.right = r1(mr)
      page.size = size
      if (size === 'custom') {
        page.w = r1(pw)
        page.h = r1(ph)
      }
      if (Object.keys(margin).length) page.margin = margin
    }
    const colsEl = Array.from(sdoc.getElementsByTagName('*')).find((x) => x.localName === 'columns')
    const cn = Number(colsEl?.getAttribute('fo:column-count') ?? 1)
    if (cn > 1) {
      page.cols = Math.min(4, cn)
      // LibreOffice 可能只写 fo:column-gap 或 style:distance（后者为栏间距）
      const gap = cm2mm(colsEl?.getAttribute('fo:column-gap') ?? colsEl?.getAttribute('style:distance') ?? null)
      if (gap && Math.abs(gap - DEFAULT_COL_GAP) > 0.6) page.colGap = Math.round(gap * 10) / 10
    }
    if (Object.keys(page).length) meta.page = page
  }
  return {
    html,
    meta,
    warnings: [...warnCount].map(([m, n]) => (n > 1 ? `${m}×${n}` : m)),
  }
}
