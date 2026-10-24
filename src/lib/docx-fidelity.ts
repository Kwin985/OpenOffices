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
// 表格读侧的三笔度量账在 v0.97 起认全：逐格 w:tcW（与 w:gridCol 谁说了算，第十笔账起看 w:tblLayout）、
// 行高 w:trHeight、格边距 w:tblCellMar / w:tcMar（落进 cell-style 的 pad*/rowHeight 属性，docx/odoc 保存链路往返）；
// 段落边框的第五边 w:between 同轮接上：与下一段是同一串「相同边框与底纹」时落成前一段的下边框。
// 格边距从此是四层逐边合并（样式基座 → 表级 → 条件层 → 逐格），条件层就是 `w:tblStylePr` 的 tcMar
// 配 `w:tblLook` 的闸门——只有首行/末行/首列/末列四型会把边距落到实处，而 `w:val` 那枚十六进制从不被读。
// 表级那一层的 w:tblW 从第八笔账起上账，但它只在整盘宽度账都没说时说话（无 w:gridCol、网格全零、
// 所有行也没逐格 w:tcW 的那些列）：Word 那趟量到的落点是「表宽折算后按列等分」，而 pct 那一档的口径是
// 五十分之一百分点（5000 = 100% 版心）。w:tblLayout 从第十笔账起吃：fixed 那一档网格是地板，
// 任何一行的逐格 w:tcW 只往宽里抬（缩小不落）、跨列格的正差落所跨最后一条而负差丢、w:vMerge=continue
// 那一格不参与；autofit 与 layout 缺失那一档反过来——网格让位、缩小照落，跨列格那一份均摊到所跨各列，
// 一行都没说话的列退网格（Word 那里按内容重排，是账外）。真数 w:tblW 压过逐格账那两道门仍未开。
// 逐格的 w:tcW 从此只认型别 dxa（没写 w:type 也算 dxa），auto/pct/nil/未知一律账外（第十一笔账）：
// pct 有基数、但那基数是**表宽**不是版心（夹具把表宽与版心拉开时，Word 读折表宽那档差 0.02 磅、折版心那档差 90.27 磅），
// 所以它落在上面那两道门之后；真件那侧同向——首行带 pct 的 30 枚表全为「缺 w:tblLayout × 有真数表宽」，pct 折宽离
// 声明网格 19 枚 ≤1 磅（no-op）、11 枚 2.08–65.28 磅；Word 能开的 6 枚件里 11 枚同族表有 10 枚读的就是声明网格（0.00 磅）。
// nil 是「这格没宽」而不是「宽是 0」：把它跟 dxa 一起当数字读会造出一枚假宽（夹具 p_type_nil：Word 60|90|120＝网格，旧码 75|90|120）。
// 段落缩进从第十七笔账起按属性名继承：样式链那枚 w:ind 上、段落没写的属性照旧说话（c19b 数出元素级替换
// 一次扔掉 18460 枚属性、住 190 枚文件；Word 门面五枚臂 c18b 两枚字符臂 + c20 三枚纯长度臂全 verdict=keep-style），
// 而 firstLine 与 hanging 是同一枚首行槽的正负两写法——段落写了其中任一拼法就整槽归段落（c20 两枚 drop 臂：段落的
// w:firstLine="0" 压掉样式的 w:hanging，Word 门面 HangingIndent=0；跨层两拼法 818 枚/46 件）。w:left 与 w:start 这对
// 别名在真件里既不同元素并存（0 枚）也不跨层混用（0 枚），故不设别名槽。字符缩进的宽度底数从硬写的 16px 换成段落
// 自己的字号折 px，取不到才退正文 15px；负数字面、rightChars 单独臂（真件 0 枚）、编号层 w:numPr 的 w:ind 与
// docDefaults 那一档字号仍在账外。

import { all, allDesc, attr, attrL, attrNum, els, find, findDesc, findL, local, parseXml, textOf, type XEl } from './ooxml'
import { FieldEngine, fieldLabel, parseInstr, recomputable } from './docx-fields'
import { embedHtml, inlineFlatten, unwrapEmbed, type EmbedHtml } from './ole'
import { chartToHtml, smartArtToHtml } from './ooxml-graphics'
import { CELL_EDGES, CSS_BORDER_STYLE, FRAME_NUMERIC_KEYS, FRAME_STR_KEYS, PPR_ATTR, PPR_ONOFF_KEYS, PPR_STR_KEYS, TAB_LEADERS, TLOOK_ATTR, bdSpaceAttrs, eighthsToPx, framePayload, pprPayload, ptToPx, rgb2hex, shadeCss, tblpPayload, tabsPayload, tlookPayload, type CellEdge, type FramePayload, type PprPayload, type TabSpec, type TblpPayload } from './cell-style'
import { ooxmlLine } from './paragraph-style'
import {
  asTableCondType,
  commentRowsOf,
  type DocComment,
  type DocxLsdException,
  type DocxLatentStyles,
  type DocxSection,
  type DocxStyleInfo,
  type TableCond,
  type TableCondType,
} from './docx'
import { encodeNoteText } from './note-extension'
import {
  condLadderAppearance,
  condLadderMargin,
  condLadderRowHeight,
  LOOK_BITS,
} from './table-cond'

export interface DocxImport {
  html: string
  comments: DocComment[]
  /** 拆出的顶层块数；0 表示这份文件没认出来，调用方应回退 mammoth */
  blocks: number
  warnings: string[]
  /** 文档带进来的段落样式清单（v0.102）：摊平快照，编辑器下拉与导出样式表共用 */
  styles?: DocxStyleInfo[]
  /**
   * 潜在样式（v0.146）：w:latentStyles 容器与全部 lsdException——Word 样式库门面账。
   * 屏上不兑现，随 meta 持久化、导出补丁回 styles.xml
   */
  latentStyles?: DocxLatentStyles
  /**
   * 节属性原文（v0.147）：body 末尾 sectPr 的 pgSz/pgMar/cols/docGrid，单位仍是缇。
   * 屏上有对应物的是页面设置那一半（纸型与页边距），装订线/页眉页脚距/文档网格只往返。
   * 由调用方折成 PageSetup（pageSetupOf）合并进 meta
   */
  section?: DocxSection
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
  // tag 可能是「p data-pstyle=… data-shade=…」这种带附加属性的形状：开标签用全串，
  // 闭标签只取元素名——闭标签上的属性 HTML 规范一律忽略（浏览器与 DOMParser 都忍早先的
  // data-pstyle 忍到现在），但写出来既是无效 markup，也让结构测试没法逐字节比对
  const name = tag.split(' ')[0]
  return `<${tag}${style ? ` style="${style}"` : ''}>${inner}</${name}>`
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
  /**
   * 样式元数据三枚（v0.146）：`w:uiPriority` 决定 Word 样式库里的排序档位、
   * `w:link` 指着配对的字符/段落样式（`w:styleLink` 的反向）、`w:customStyle`
   * 标记用户自建样式。屏上一概不兑现，只为存盘不丢。
   */
  uiPriority?: number
  link?: string
  customStyle?: boolean
  /**
   * 条件层的闸门（v0.147）：表样式 `w:tblPr/w:tblLook` 的那三枚属性——`w:val`
   * （Word 存的那份四位闸门原值）、`w:noHBand`/`w:noVBand`（隔行/隔列带不套）。
   * 写侧原本是拿 table.cond 反推的（`condLookBits`），推出来的与原文那枚不一定同；
   * 带上原文这一枚就照抄，没带才回落到反推。
   */
  look?: { val?: string; noHBand?: boolean; noVBand?: boolean }
}

/**
 * 潜在样式（v0.146）：`w:latentStyles` 容器 + 每条 `w:lsdException`。
 *
 * 这是 Word 样式库的门面数据——哪些内建样式在库里露面、排第几档、要不要隐藏，
 * 与正文排版无关，屏上无处兑现（参照浮动框架 framePr 的纪律：只往返）。
 * 写手没有库槽，由 docx.ts 打包后回头补进 styles.xml（与 w:tblLook 同一路数）。
 * 类型住在 docx.ts（DocMeta 的一员），这里只负责读。
 */

/** onOff 属性值 → 三态布尔；认不出的值（空串/怪串）按没说话处理 */
function onOff(v: string | undefined): boolean | undefined {
  const s = (v ?? '').toLowerCase()
  if (s === '1' || s === 'true' || s === 'on') return true
  if (s === '0' || s === 'false' || s === 'off') return false
  return undefined
}

interface StyleBook {
  byId: Map<string, StyleInfo>
  latentStyles?: DocxLatentStyles
}

function headingLevelOf(name: string): number | undefined {
  const n = name.trim().toLowerCase()
  const m = /^heading ([1-9])$/.exec(n) ?? /^标题\s*([1-9])$/.exec(n)
  if (m) return Number(m[1])
  if (n === 'title' || n === '标题') return 1
  return undefined
}

function readStyles(xml: string, theme?: ThemeFonts): StyleBook {
  const book: StyleBook = { byId: new Map() }
  if (!xml) return book
  const styles = find(parseXml(xml), 'w:styles')
  if (!styles) return book
  // 主题引用先落地成具名字体（v0.138）：Word 的 Normal 样式只写 asciiTheme，不解析就没有字族
  applyThemeFonts(styles, theme)
  // docDefaults 不并入基准运行属性：它是"这份文档的默认字体"，而本应用自带版式默认值；
  // 逐 run 盖上 Calibri/宋体 11pt 会把应用级字体选择全部压掉，还会让 HTML 胖一倍。
  for (const s of all(styles, 'w:style')) {
    // customStyle 要先于 styleId 那道闸读（v0.146）：语料里有一枚不带 styleId 的裸
    // <w:style w:customStyle="0"/>，attr 在不在身上都发探针，读了才上账
    const cs = onOff(attr(s, 'w:customStyle'))
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
    // 样式元数据三枚（v0.146）：uiPriority/link 是子元素，customStyle 是身上那枚属性
    const up = valNum(s, 'w:uiPriority')
    if (up !== undefined) info.uiPriority = up
    const link = val(s, 'w:link')
    if (link) info.link = link
    if (cs !== undefined) info.customStyle = cs
    // 条件层闸门（v0.147）：表样式 w:tblPr/w:tblLook 的三枚属性。val 是枚举串，
    // noHBand/noVBand 是 onOff——写侧原本拿 table.cond 反推（condLookBits），
    // 带上原文这一枚就照抄，没带才回落到反推
    const lookEl = info.tblPr ? find(info.tblPr, 'w:tblLook') : undefined
    if (lookEl) {
      const look: StyleInfo['look'] = {}
      const lv = attr(lookEl, 'w:val')
      if (lv) look.val = lv
      const hb = onOff(attr(lookEl, 'w:noHBand'))
      if (hb !== undefined) look.noHBand = hb
      const vb = onOff(attr(lookEl, 'w:noVBand'))
      if (vb !== undefined) look.noVBand = vb
      if (Object.keys(look).length) info.look = look
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
  // 潜在样式（v0.146）：w:latentStyles 是 w:styles 的单例容器，排在 docDefaults 之后、
  // 全部 w:style 之前。它是 Word 样式库的门面账（哪些内建样式露面、排第几档），与正文
  // 排版无关——读成结构化数据随 meta 走，导出时补丁回 styles.xml
  const latent = find(styles, 'w:latentStyles')
  if (latent) {
    const ls: DocxLatentStyles = { exceptions: [] }
    const cnt = attrNum(latent, 'w:count')
    if (cnt !== undefined) ls.count = cnt
    const dls = onOff(attr(latent, 'w:defLockedState'))
    if (dls !== undefined) ls.defLockedState = dls
    const dup = attrNum(latent, 'w:defUIPriority')
    if (dup !== undefined) ls.defUIPriority = dup
    const dsh = onOff(attr(latent, 'w:defSemiHidden'))
    if (dsh !== undefined) ls.defSemiHidden = dsh
    const duu = onOff(attr(latent, 'w:defUnhideWhenUsed'))
    if (duu !== undefined) ls.defUnhideWhenUsed = duu
    const dqf = onOff(attr(latent, 'w:defQFormat'))
    if (dqf !== undefined) ls.defQFormat = dqf
    for (const e of all(latent, 'w:lsdException')) {
      const ex: DocxLsdException = {}
      const nm2 = attr(e, 'w:name')
      if (nm2) ex.name = nm2
      const up2 = attrNum(e, 'w:uiPriority')
      if (up2 !== undefined) ex.uiPriority = up2
      const sh = onOff(attr(e, 'w:semiHidden'))
      if (sh !== undefined) ex.semiHidden = sh
      const uu = onOff(attr(e, 'w:unhideWhenUsed'))
      if (uu !== undefined) ex.unhideWhenUsed = uu
      const qf = onOff(attr(e, 'w:qFormat'))
      if (qf !== undefined) ex.qFormat = qf
      const lk = onOff(attr(e, 'w:locked'))
      if (lk !== undefined) ex.locked = lk
      ls.exceptions.push(ex)
    }
    book.latentStyles = ls
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

/** 样式元数据三枚（v0.146）→ 快照字段；没说的不挂，与旧字节一致 */
function styleMetaOf(info: StyleInfo): Pick<DocxStyleInfo, 'uiPriority' | 'link' | 'customStyle'> {
  return {
    ...(info.uiPriority !== undefined ? { uiPriority: info.uiPriority } : {}),
    ...(info.link ? { link: info.link } : {}),
    ...(info.customStyle !== undefined ? { customStyle: info.customStyle } : {}),
  }
}

/**
 * 段落属性的合并视图：同名子元素后者覆盖前者，而 PPR_ATTR_SLOTS 里那几枚要按属性名一枚一枚合。
 * 第十七笔账（w:ind）与本轮（w:spacing）的门面实测同形：段落只写一枚属性时，样式链那枚上它没写的
 * 属性照样说话（c20 三枚跨属性臂 verdict=keep-style；18 笔的 A1/A9/A10：段落写 before="240" 而样式的
 * line/lineRule/after 全留，Word 门面报 lineSpacing=18pt beforePt=10pt）。整枚替换扔掉的面
 * （c1）：spacing 多层在场 6275 段里丢账 1801 段、住 52 枚文件，其中样式链内部 170 段/12 枚，
 * 段落层丢掉的最大头是 line 679 段（正是 A10 那一形状）。同名者压前者、0 是真值
 * （A6/A7：段落 before="0"、after="0" 各压掉样式的 6 磅，Word 门面报 0pt）。
 * 槽：ind 的 firstLine 与 hanging 是同一枚首行槽的正负两写法（任一拼法在场即整槽归后写层，
 * 按名字各留各的会把号读反；c21 同槽跨层 818 枚/46 件）；spacing 的 lineRule 只是 line 的读法，
 * 因此那一槽以 line 为主属性——后写层带 line 就整槽归它（A2：样式的 lineRule="exact" 被段落的
 * line="360" 退回单倍档；A16 同形），后写层只带 lineRule 则整槽让给前写层（A3/A13：段落单独写的
 * atLeast 在 Word 门面从不说话，样式的 12pt exact / 18pt auto 原样留着）。
 * 同形状的问题在 w:pBdr/w:shd 上这批语料量不到：同一口径普查里两层都在场的段落 0 枚（可达性另立一轮）。
 */
type AttrSlot = { members: string[]; primary?: string }

const PPR_ATTR_SLOTS: Record<string, AttrSlot[]> = {
  ind: [{ members: ['firstLine', 'hanging'] }, { members: ['firstLineChars', 'hangingChars'] }],
  spacing: [{ members: ['line', 'lineRule'], primary: 'line' }],
}

/**
 * 分页四件套（v0.143）：Word 的分页与孤行控制，住 pPr 顶层（与 spacing/ind 平级）。
 * 屏上不兑现（Web 流式排版没有分页），只随 data-* 进出保往返——落点在
 * lib/paragraph-style.ts 的四个布尔属性，写手由 paraFormatOf 折回 w:pageBreakBefore 等。
 */
const PAGE_FLAGS = ['pageBreakBefore', 'keepNext', 'keepLines', 'widowControl'] as const
const FLAG_ATTR: Record<(typeof PAGE_FLAGS)[number], string> = {
  pageBreakBefore: 'pagebreak-before',
  keepNext: 'keepnext',
  keepLines: 'keeplines',
  widowControl: 'widowcontrol',
}

/**
 * 制表位表（v0.144）：pPr/w:tabs 下的 w:tab 逐条读成 `档位|缇|leader` 载荷。
 * 档位走 attr、缇走 attrNum（两枚漏斗各自记自己的账）、leader 走 attr；
 * clear 档是「到此清除继承制表位」，Word 里不带 pos/leader——载荷同规。
 * 非法条目（档位不在值域、非 clear 缺 pos）整条丢：宁缺勿错。
 */
function readTabsPayload(pPr: XEl | undefined): string {
  const tabs = pPr ? find(pPr, 'w:tabs') : undefined
  if (!tabs) return ''
  const specs: TabSpec[] = []
  for (const t of all(tabs, 'w:tab')) {
    const val = (attr(t, 'w:val') ?? '').toLowerCase()
    const pos = attrNum(t, 'w:pos')
    const leader = TAB_LEADERS[(attr(t, 'w:leader') ?? '').trim().toLowerCase()]
    if (!val) continue
    if (val !== 'clear' && (pos === undefined || pos < 0)) continue
    specs.push({ val, pos: pos ?? null, leader: leader && leader !== 'none' ? leader : null })
  }
  return tabsPayload(specs)
}

/**
 * 浮动框架（v0.145）：pPr/w:framePr 的十二枚属性 → `key=value;...` 载荷。
 * x/y/w/h/hSpace/vSpace 走 attrNum（缇），xAlign/yAlign/hRule/hAnchor/vAnchor/wrap/
 * anchorLock 走 attr（字符串枚举），dropCap/lines 顺带。屏上不兑现（Web 没有页定位），
 * 只保往返。数值键读不到数（属性在场但非整数）时整键丢——那一枚当没写。
 */
function readFramePayload(pPr: XEl | undefined): string {
  const fp = pPr ? find(pPr, 'w:framePr') : undefined
  if (!fp) return ''
  const kv: FramePayload = {}
  for (const k of FRAME_NUMERIC_KEYS) {
    const n = attrNum(fp, `w:${k}`)
    if (n !== undefined) kv[k] = String(n)
  }
  for (const k of FRAME_STR_KEYS) {
    const v = attr(fp, `w:${k}`)
    if (v) kv[k] = v
  }
  return framePayload(kv)
}

/**
 * 表格浮动（v0.145）：tblPr/w:tblpPr 的十枚属性 → `key=value;...` 载荷。
 * **注意 tblpPr 的属性无命名空间前缀**（tblpX/tblpXSpec/vertAnchor…，ECMA-376 CT_TblPPr），
 * 与 framePr 的 w:x 那族不同——枚举档一律走 attrL（按 local name 取，无前缀的才命中），
 * 数值档走 attrNum（内部自带 attrL fallback，两种前缀形态都吃）。
 * 屏上不兑现（Web 没有页定位），只保往返——与 readFramePayload 同款纪律。
 */
function readTblpPayload(tblPr: XEl | undefined): string {
  const tp = tblPr ? find(tblPr, 'w:tblpPr') : undefined
  if (!tp) return ''
  const kv: TblpPayload = {}
  for (const k of ['tblpX', 'tblpY', 'topFromText', 'leftFromText', 'bottomFromText', 'rightFromText']) {
    const n = attrNum(tp, k)
    if (n !== undefined) kv[k] = String(n)
  }
  for (const k of ['tblpXSpec', 'vertAnchor', 'horzAnchor', 'overlap']) {
    const v = attrL(tp, k)
    if (v) kv[k] = v
  }
  return tblpPayload(kv)
}

/**
 * 表自身的条件层闸门（v0.147）：`w:tblPr/w:tblLook` 的三枚属性 → `val=…;noHBand=…;noVBand=…`。
 * val 是 Word 存的四位闸门原值（原样带），两枚 no*Band 走 onOff 归一。
 */
function readTlookPayload(tblPr: XEl | undefined): string {
  const lk = tblPr ? find(tblPr, 'w:tblLook') : undefined
  if (!lk) return ''
  const kv: Record<string, string> = {}
  const v = attr(lk, 'w:val')
  if (v) kv.val = v
  const hb = onOff(attr(lk, 'w:noHBand'))
  if (hb !== undefined) kv.noHBand = hb ? '1' : '0'
  const vb = onOff(attr(lk, 'w:noVBand'))
  if (vb !== undefined) kv.noVBand = vb ? '1' : '0'
  return tlookPayload(kv)
}

/**
 * 段落属性余量（v0.147）：pPr 里那批「说了也不改屏上排版」的直接属性 → `key=value;...`
 * 载荷。七枚 onOff（adjustRightInd/snapToGrid/topLinePunct/bidi/autoSpaceDE/autoSpaceDN/
 * suppressLineNumbers）走 attr 读 w:val 后经 onOff 归一（**元素在场而无 val 按「开」**——
 * 不能与「没写」同路，Word 里 snapToGrid 默认开、显式关是真值）；textAlignment 是枚举档
 * 原样存；w:spacing 上的 beforeAutospacing/afterAutospacing 顺带（包里把布尔写成
 * "true"，语义与 '1' 同档）。样式链合并后的 effPPr 上读——样式层说的算数。
 */
function readPprPayload(pPr: XEl | undefined): string {
  if (!pPr) return ''
  const kv: PprPayload = {}
  for (const k of PPR_ONOFF_KEYS) {
    // 两枚自动段距住在 w:spacing 身上，其余各是 pPr 的直子
    const el = k === 'beforeAutoSpace' || k === 'afterAutoSpace' ? find(pPr, 'w:spacing') : find(pPr, `w:${k}`)
    if (!el) continue
    const name = k === 'beforeAutoSpace' ? 'w:beforeAutospacing' : k === 'afterAutoSpace' ? 'w:afterAutospacing' : `w:val`
    const v = onOff(attr(el, name))
    // 元素在场、没写 w:val：按「开」记（onOff 对 undefined 给 undefined，这里补 true）
    if (v === undefined) {
      if (name !== 'w:val') continue
      kv[k] = '1'
      continue
    }
    kv[k] = v ? '1' : '0'
  }
  for (const k of PPR_STR_KEYS) {
    const el = find(pPr, `w:${k}`)
    if (!el) continue
    const v = attr(el, 'w:val')
    if (v) kv[k] = v
  }
  return pprPayload(kv)
}

/** 属性级合并：同名后者压前者，后写层没写的属性留前写层那一枚；槽见 PPR_ATTR_SLOTS */
function mergeAttrAttrs(base: Record<string, string>, add: Record<string, string>, slots: AttrSlot[]): Record<string, string> {
  const out: Record<string, string> = {}
  const slotted = new Set<string>()
  for (const slot of slots) {
    const a = Object.keys(add).filter((k) => slot.members.includes(local(k)))
    const b = Object.keys(base).filter((k) => slot.members.includes(local(k)))
    for (const k of a.concat(b)) slotted.add(k)
    // 设了主属性的槽只认它：后写层光带附属属性（lineRule）时整槽仍归前写层
    const speaks = a.length > 0 && (slot.primary === undefined || a.some((k) => local(k) === slot.primary))
    for (const k of speaks ? a : b) out[k] = (speaks ? add : base)[k]
  }
  for (const [k, v] of Object.entries(add)) if (!slotted.has(k)) out[k] = v
  for (const [k, v] of Object.entries(base)) if (!slotted.has(k) && out[k] === undefined) out[k] = v
  return out
}

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
      if (!old) {
        next.children.push(c)
        continue
      }
      const at = next.children.indexOf(old)
      const slots = PPR_ATTR_SLOTS[local(c.name)]
      // 表里那几枚换成按属性名合，其余同名子元素仍是整枚替换；孩子仍取后写那层（与旧行为一字不差）
      next.children[at] = slots
        ? { name: c.name, attrs: mergeAttrAttrs(old.attrs, c.attrs, slots), children: [...c.children] }
        : c
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

/** 编号层级的定义：档位、起始值，加 v0.142 起上账的符面文字与符面对齐 */
interface LvlDef {
  numFmt: string
  start: number
  /** `w:lvlText/@w:val`：子弹档是符面字符（·/○/■），有序档是编号模板（"%1."/"第%1章"） */
  lvlText?: string
  /** `w:lvlJc/@w:val`：符面在编号空间里的左/中/右定位（CSS 无对应物，只往返） */
  lvlJc?: string
}

interface Numbering {
  byId: Map<string, Map<number, LvlDef>>
  /** abstractNumId → multiLevelType（v0.145 读账：hybridMultilevel/multilevel/singleLevel） */
  multiLevels: Map<string, string>
}

function readNumbering(xml: string, theme?: ThemeFonts): Numbering {
  const out: Numbering = { byId: new Map(), multiLevels: new Map() }
  if (!xml) return out
  const num = find(parseXml(xml), 'w:numbering')
  if (!num) return out
  // 编号层级的 rPr 同样可能只写主题引用（v0.138），与 styles 同一趟落地
  applyThemeFonts(num, theme)
  const abstract = new Map<string, Map<number, LvlDef>>()
  for (const a of all(num, 'w:abstractNum')) {
    const id = attr(a, 'w:abstractNumId')
    if (!id) continue
    // multiLevelType（v0.145）：编号定义的身份属性——它描述的是「这份定义是否设计成
    // 多级联动」，而我们的模型把编号定义塌成逐段各自的档位（ListRegistry 只按段引用
    // 重建定义），这个身份带不回来。读入记账，由 docxToHtmlFidelity 统一 warn
    const mlt = attr(a, 'w:multiLevelType')
    if (mlt) out.multiLevels.set(id, mlt)
    const levels = new Map<number, LvlDef>()
    for (const l of all(a, 'w:lvl')) {
      levels.set(Number(attr(l, 'w:ilvl') ?? '0'), {
        numFmt: val(l, 'w:numFmt') ?? 'bullet',
        start: valNum(l, 'w:start') ?? 1,
        lvlText: val(l, 'w:lvlText'),
        lvlJc: (val(l, 'w:lvlJc') ?? '').toLowerCase() || undefined,
      })
    }
    abstract.set(id, levels)
  }
  for (const n of all(num, 'w:num')) {
    const id = attr(n, 'w:numId')
    const aid = val(n, 'w:abstractNumId')
    if (!id || !aid) continue
    const levels = new Map(abstract.get(aid) ?? new Map<number, LvlDef>())
    // `w:num/w:lvlOverride/w:startOverride`（v0.142）：Word 靠它给同一份编号定义做
    // 「这一串从第 N 号起」——不读它，读来的一串列表起始值全是抽象的 1
    for (const lo of all(n, 'w:lvlOverride')) {
      const ilvl = attrNum(lo, 'w:ilvl') ?? 0
      const so = attrNum(find(lo, 'w:startOverride'), 'w:val')
      const cur = levels.get(ilvl)
      if (so !== undefined) levels.set(ilvl, { numFmt: cur?.numFmt ?? 'bullet', start: so, lvlText: cur?.lvlText, lvlJc: cur?.lvlJc })
    }
    out.byId.set(id, levels)
  }
  return out
}

// ---- 主题字体（v0.138）------------------------------------------------------

/**
 * theme1.xml 的六个字体槽。Word 的默认样式（Normal 与 docDefaults）几乎从不写具名字体，
 * 只写 `asciiTheme="minorHAnsi"` 一类引用——不解析主题，整篇文档的字族就掉回浏览器默认，
 * 而打开任何一份"没手动设过字体"的真件都是这个形态。这是长尾清单里屏上后果最大的一条。
 */
interface ThemeFonts {
  majorLatin?: string
  minorLatin?: string
  majorEa?: string
  minorEa?: string
  majorCs?: string
  minorCs?: string
}

/** rFonts 上的主题引用属性 → 要填到的具名属性（asciiTheme 与 hAnsiTheme 不同槽，规范如此） */
const THEME_ATTRS: [attr: string, target: string][] = [
  ['asciiTheme', 'ascii'],
  ['hAnsiTheme', 'hAnsi'],
  ['eastAsiaTheme', 'eastAsia'],
  ['cstheme', 'cs'],
]

/** 主题属性值（ST_ThemeFont）→ 槽名 */
function themeSlot(v: string): keyof ThemeFonts | undefined {
  switch (v) {
    case 'majorHAnsi':
      return 'majorLatin'
    case 'minorHAnsi':
      return 'minorLatin'
    case 'majorEastAsia':
      return 'majorEa'
    case 'minorEastAsia':
      return 'minorEa'
    case 'majorBidi':
      return 'majorCs'
    case 'minorBidi':
      return 'minorCs'
    default:
      return undefined
  }
}

/** 读 word/theme/theme1.xml。缺件、缺 fontScheme、或槽位空串都返回undefined（没有就解析不了） */
function readTheme(xml: string): ThemeFonts | undefined {
  if (!xml.trim()) return undefined
  // fontScheme 住在 theme → themeElements 之下，是孙级，用 findDesc 而不是 findL（那个只找直接子节点）
  const scheme = findDesc(parseXml(xml), 'fontScheme')
  if (!scheme) return undefined
  const slot = (family: string, part: string): string | undefined => {
    // majorFont/minorFont 是 fontScheme 的直接孩子，latin/ea/cs 又是它们的直接孩子
    const f = findL(scheme, family)
    const el = f ? findL(f, part) : undefined
    // 走 attrL 而不是自己扫 attrs：主题属性也是按名查问，得进覆盖率的分子（探针在那枚漏斗上）
    const t = el ? attrL(el, 'typeface') : undefined
    return t && t.trim() ? t.trim() : undefined
  }
  const out: ThemeFonts = {
    majorLatin: slot('majorFont', 'latin'),
    minorLatin: slot('minorFont', 'latin'),
    majorEa: slot('majorFont', 'ea'),
    minorEa: slot('minorFont', 'ea'),
    majorCs: slot('majorFont', 'cs'),
    minorCs: slot('minorFont', 'cs'),
  }
  return Object.values(out).some((v) => v !== undefined) ? out : undefined
}

// ---- 主题色（v0.142）--------------------------------------------------------

/**
 * theme1.xml 的十一个色槽。`w:color/@w:themeColor`、`w:shd/@w:themeFill` 与边框上的
 * 同名属性引用的就是这些槽——真件里 accent1 一族出现 92（字色）+ 31（底纹）+ 34（边框）
 * 次而读手一个都不认，带主题色的字/底纹/边框全掉回黑（Word 那头是主题蓝）。
 * dk1/lt1 在真件里常写 sysClr（windowText/window，lastClr 兜底），其余九枚一律 srgbClr。
 */
interface ThemeColors {
  dk1?: string
  lt1?: string
  dk2?: string
  lt2?: string
  accent1?: string
  accent2?: string
  accent3?: string
  accent4?: string
  accent5?: string
  accent6?: string
  hlink?: string
  folHlink?: string
}

/** 十一个槽名的运行时清单（ThemeColors 是文档用的接口，这里给查表与判重各一份真值） */
const SLOT_KEYS = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
] as const
type ThemeSlot = (typeof SLOT_KEYS)[number]

/**
 * ST_ThemeColor 的规范值 → 色槽。text1/background1 一族是 2010 后的别名，与
 * dark1/light1 同槽（Word 自己两套都写，混用件常见）。
 */
const THEME_COLOR_SLOT: Record<string, ThemeSlot> = {
  dark1: 'dk1',
  light1: 'lt1',
  dark2: 'dk2',
  light2: 'lt2',
  text1: 'dk1',
  background1: 'lt1',
  text2: 'dk2',
  background2: 'lt2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hyperlink: 'hlink',
  followedhyperlink: 'folHlink',
}

/** 读 theme1.xml 的 clrScheme。缺件、缺 scheme 或一槽都没解析出来都返回 undefined（颜色落回字面值，不炸） */
function readThemeColors(xml: string): ThemeColors | undefined {
  if (!xml.trim()) return undefined
  // clrScheme 与 fontScheme 并列住在 themeElements 之下，同为孙级
  const scheme = findDesc(parseXml(xml), 'clrScheme')
  if (!scheme) return undefined
  const out: ThemeColors = {}
  for (const slot of els(scheme)) {
    const name = local(slot.name)
    // 子元素名就是槽名（dk1/accent1/hlink…）；兼容件若写 dark1 一族别名也认
    const key: ThemeSlot | undefined =
      THEME_COLOR_SLOT[name] ?? (SLOT_KEYS.includes(name as ThemeSlot) ? (name as ThemeSlot) : undefined)
    // 一槽只记第一枚：真件里同槽不重名，重名件后来者不覆盖（与「先声明先说话」同向）
    if (!key || out[key]) continue
    const srgb = findL(slot, 'srgbClr')
    const sys = findL(slot, 'sysClr')
    // 两枚都走 attrL：主题色也是按名查问，探针在漏斗上记的是这一笔
    const hex = (srgb ? attrL(srgb, 'val') : undefined) ?? (sys ? attrL(sys, 'lastClr') : undefined)
    const norm = hex ? rgb2hex(`#${hex.replace(/^#/, '')}`) : null
    if (norm) out[key] = norm
  }
  return Object.keys(out).length ? out : undefined
}

/** OOXML 的 themeTint / themeShade：两位十六进制字节当 0..1 系数用；读不懂算没写 */
function tintShadeOf(v: string | undefined): number | undefined {
  if (!v || !/^[0-9a-f]{1,2}$/i.test(v.trim())) return undefined
  return Math.max(0, Math.min(1, Number.parseInt(v, 16) / 255))
}

/** shade 先染深、tint 后染淡（ECMA-376 没给两枚并存的次序，主流实现都走这个；注释在此备查） */
function applyTintShade(hex: string, shade?: number, tint?: number): string {
  const ch = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16)
  let [r, g, b] = [ch(1), ch(3), ch(5)]
  if (shade !== undefined) {
    r *= shade
    g *= shade
    b *= shade
  }
  if (tint !== undefined) {
    r += (255 - r) * tint
    g += (255 - g) * tint
    b += (255 - b) * tint
  }
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/**
 * 元素上的主题色引用（+tint/shade）→ '#hex'。解析不了（没主题、槽空、引用名不认识）
 * 返回 undefined，调用方落回字面值——Word 也是这个分工：主题引用是主，
 * 字面值是给不认主题的读者兜的底（所以两枚常一起写）。
 * 三个属性名做成参数：w:color 用 themeColor/themeTint/themeShade，
 * w:shd 用 themeFill/themeFillTint/themeFillShade，边框同 w:color 一族。
 */
function themeRefCss(
  theme: ThemeColors | undefined,
  el: XEl,
  refAttr = 'w:themeColor',
  tintAttr = 'w:themeTint',
  shadeAttr = 'w:themeShade',
): string | undefined {
  if (!theme) return undefined
  const ref = (attr(el, refAttr) ?? '').trim()
  if (!ref) return undefined
  const slot = THEME_COLOR_SLOT[ref.toLowerCase()]
  const base = slot ? theme[slot] : undefined
  if (!base) return undefined
  return applyTintShade(base, tintShadeOf(attr(el, shadeAttr)), tintShadeOf(attr(el, tintAttr)))
}

/**
 * 把树里所有 rFonts 的主题引用就地解析成具名属性（只填缺的，显式写了的一律不动）。
 *
 * 为什么改成写成树而不是在读手处解析：读手（readRPr）认的是具名属性，而 rFonts 散落在
 * document / styles / numbering 三棵树里，逐处改读手要动三个入口；在树上跑一遍等价于
 * "主题先落地、再按普通件读"，也让 w:asciiTheme 这类属性**被真的按名查问过**——
 * 覆盖率量具的分子就是这么来的。
 */
function applyThemeFonts(root: XEl | undefined, theme: ThemeFonts | undefined): void {
  if (!root || !theme) return
  const walk = (el: XEl) => {
    for (const c of el.children) {
      if (typeof c === 'string') continue
      if (local(c.name) === 'rFonts') {
        // 遍历属性而不是查死名字：主题属性的前缀随写件而变（w: 只是最常见那个），
        // 填进去的具名属性必须沿用同一个前缀——读手查的是 w:ascii 这一族
        for (const k in c.attrs) {
          const spec = THEME_ATTRS.find(([a]) => a === local(k))
          if (!spec) continue
          const slotKey = themeSlot(c.attrs[k])
          const font = slotKey ? theme[slotKey] : undefined
          if (!font) continue
          const prefix = k.includes(':') ? k.slice(0, k.indexOf(':') + 1) : ''
          // 两枚都走 attrL：查问主题属性与查问具名属性都如实进分子（探针只认那两枚漏斗）
          if (attrL(c, spec[0]) === undefined) continue
          if (attrL(c, spec[1]) === undefined) c.attrs[`${prefix}${spec[1]}`] = font
        }
      }
      walk(c)
    }
  }
  walk(root)
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
  /** 字符间距：w:rPr/w:spacing/@w:val，单位缇（20 缇 = 1 磅），负值是紧缩 */
  sp?: number
  fonts?: string[]
  /** w:vertAlign：superscript / subscript（其余值视为 normal） */
  va?: 'sup' | 'sub'
  /** 修订标记：这一段文字是 w:ins 包着的（插入）还是 w:del 包着的（删除，文字在 w:delText 里） */
  rev?: { kind: 'ins' | 'del'; author: string; date: string }
  /** 字符级命名样式标签（v0.113）：w:rStyle 的 styleId，随 run 输出 data-rstyle；不继承，无即清 */
  rstyle?: string
  /**
   * rFonts/@w:hint（v0.138）：eastAsia | default。只在这一枚上影响屏上——
   * 含混字符（引号/破折号/希腊/西里尔，见 emitRunText 那张表）该用哪一口字体画。
   * 其余三枚（cs / szCs / lang）在 HTML 里没有对应物，只随 data-* 属性进模型再走往返。
   */
  hint?: 'eastasia' | 'default'
  /** rFonts/@w:cs：复杂文字（阿拉伯/希伯来/泰文）的字族 */
  cs?: string
  /** w:szCs/@w:val：复杂文字的字号（半点）。CSS 的 font-size 不分文字系统，屏上不兑现 */
  szCs?: number
  /** w:lang/@w:val：这一段文字的语言（拼写检查与断行的判据） */
  lang?: string
  /** w:lang/@w:eastAsia：东亚文字的语言 */
  langEa?: string
  /**
   * w:lang/@w:bidi（v0.146）：复杂文字（阿拉伯/希伯来）的语言。CSS 没有这一槽，
   * 屏上不兑现——只随 data-lang-bidi 进模型再走往返（写手落 language.bidirectional）
   */
  langBidi?: string
  /**
   * w:w/@w:val（v0.146）：字符缩放百分比（Word 的「字符缩放」，1..600）。
   * CSS 的 inline 排版没有等价的横向缩放（transform:scaleX 会破坏行盒），屏上不兑现
   */
  scale?: number
  /** w:kern/@w:val：小于这个缇数的字对才做字偶距（0 = 关掉） */
  kern?: number
  /** w:pos/@w:val：基线升降，半点，正升负降（手工调的上下标走这里，不走 vertAlign） */
  pos?: number
  /** w:iCs/@w:val：复杂文字（cs 字族）的斜体。CSS 无对应物，屏上不兑现（v0.143） */
  iCs?: boolean
  /** w:bCs/@w:val：复杂文字的粗体。同上（v0.143） */
  bCs?: boolean
  /** w:smallCaps/@w:val：小型大写。屏上走 font-variant-caps（v0.143） */
  smallCaps?: boolean
}

const NONE: RunProps = {}

function readRPr(el: XEl | undefined, p: RunProps, tc?: ThemeColors): RunProps {
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
  const colorEl = find(el, 'w:color')
  if (colorEl) {
    // 主题引用是主、字面值是兜底（Word 两枚常一起写）；主题解析不了才落字面
    const themed = themeRefCss(tc, colorEl)
    const v = (attr(colorEl, 'w:val') ?? '').toLowerCase()
    if (themed) o.color = themed
    else if (v && v !== 'auto') o.color = '#' + v.replace(/^#/, '')
  }
  const hlv = val(el, 'w:highlight')
  if (hlv) o.hl = HL[hlv.toLowerCase()] ?? '#ffff00'
  const sz = valNum(el, 'w:sz')
  if (sz) o.sz = sz
  // 0 是真值：Word 门面（夹具 A7）拿样式那枚 60 缇被段内 run 的 0 压住，读回 0 磅；
  // 而同一样式链上没账时（A3），run 写的 0 会被 Word 整枚丢弃（另存后 val=NONE）。
  // 两头合起来只有一条口径：闸看「这一层有没有写这枚数」，写的就是它，包括 0。
  const sp = valNum(el, 'w:spacing')
  if (sp !== undefined) o.sp = sp
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
    const hint = (attr(rf, 'w:hint') ?? '').toLowerCase()
    // 只认规范里的两个值；写别的（大小写变体除外）按没说话处理
    if (hint === 'eastasia' || hint === 'default') o.hint = hint
    const cs = attr(rf, 'w:cs')
    if (cs) o.cs = cs
  }
  const szCs = valNum(el, 'w:szCs')
  if (szCs !== undefined && szCs > 0) o.szCs = szCs
  const langEl = find(el, 'w:lang')
  if (langEl) {
    const v = attr(langEl, 'w:val')
    if (v) o.lang = v
    const ea = attr(langEl, 'w:eastAsia')
    if (ea) o.langEa = ea
    // v0.146：复杂文字语言。w:bidi 与 val/eastAsia 同住 w:lang 上，但语义只管 cs 字族
    const bidi = attr(langEl, 'w:bidi')
    if (bidi) o.langBidi = bidi
  }
  // v0.146：字符缩放（w:w/@w:val，百分比）。元素名叫 w 而属性叫 val——探针键是 w|val。
  // 0 与负数是病态值（Word 只收 1..600），按没说话处理
  const scale = valNum(el, 'w:w')
  if (scale !== undefined && scale > 0) o.scale = scale
  const kern = valNum(el, 'w:kern')
  if (kern !== undefined && kern >= 0) o.kern = kern
  const pos = valNum(el, 'w:pos')
  // 0 是"没升降"而不是"升降 0"，与 w:spacing 那枚字符间距不同口径——那一枚 0 是真值（见上）
  if (pos !== undefined && pos !== 0) o.pos = pos
  // 复杂文字的粗斜与小型大写（v0.143）：与 w:b/w:i 平级的 onOff，只管 cs 字族那一口。
  // 「关」（val=0）与「没写」在往返里同结果，只存 true
  const iCs = on(find(el, 'w:iCs'))
  if (iCs) o.iCs = true
  const bCs = on(find(el, 'w:bCs'))
  if (bCs) o.bCs = true
  const sc = on(find(el, 'w:smallCaps'))
  if (sc) o.smallCaps = true
  return o
}

/** 段落样式链 → 段落标记 run（pPr/rPr）：本段文字的基准运行属性（docDefaults 故意不参与，见 readStyles） */
function baseRunProps(chain: StyleInfo[], pPr: XEl | undefined, tc?: ThemeColors): RunProps {
  let p = NONE
  for (const s of chain) if (s.rPr) p = readRPr(s.rPr, p, tc)
  const paraMark = pPr ? find(pPr, 'w:rPr') : undefined
  if (paraMark) {
    // 段落标记那层的字符间距只描在标记自己身上，不传给段内正文：Word 门面 A8（标记 +80 缇）
    // 量到正文 Font.Spacing=0、标记 Font.Spacing=4，而 A9（标记 4 磅 + run 5 磅）里 run 照旧赢。
    // 其余字段维持原样（这一层的粗体/字号本来就当基准用），只把 sp 按回样式链那一枚。
    const sp = p.sp
    p = readRPr(paraMark, p, tc)
    if (valNum(paraMark, 'w:spacing') !== undefined) p.sp = sp
  }
  return p
}

function cssOf(p: RunProps): string {
  const bits: string[] = []
  // 字体名要单引号：这段 CSS 会落进 style="…" 属性里，双引号会当场截断属性
  if (p.fonts?.length) bits.push(`font-family: ${p.fonts.map((f) => `'${f.replace(/'/g, '')}'`).join(', ')}`)
  if (p.sz) bits.push(`font-size: ${Math.round(p.sz * HP_PX)}px`)
  if (p.color) bits.push(`color: ${p.color}`)
  // 缇 → 磅是整数除以 20，Word 门面在 ±20/±200 缇四臂上分别读回 ±1/±10 磅；
  // 最短写法就够（整数除以 20 最多两位小数，JS 打出来就是最短形）
  if (p.sp !== undefined) bits.push(`letter-spacing: ${p.sp / 20}pt`)
  // w:kern=0 是"这一口字体不做字偶距"（浏览器默认 normal，只有 0 这一档有屏上后果）；
  // 写了正数等于浏览器的默认行为，也照样显式写出来——闸看"这一层有没有说这枚数"
  if (p.kern === 0) bits.push('font-kerning: none')
  else if (p.kern !== undefined) bits.push('font-kerning: normal')
  // w:pos 与 vertAlign 同时出现时 Word 按 vertAlign 渲染，故只在没有上下标时才兑现升降
  if (p.va === undefined && p.pos !== undefined) bits.push(`vertical-align: ${px2((p.pos / 2) * PT_PX)}px`)
  return bits.join('; ')
}

/** 属性值用的转义：esc 只管 <>&，作者名里出现引号会截断属性，这里一起防 */
function attrEsc(s: string): string {
  return esc(s).replace(/"/g, '&quot;')
}

/**
 * Unicode East Asian Width = Ambiguous 的子集（v0.138）：宽窄两可的字符。
 *
 * 全表很大（整个拉丁补充、希腊、西里尔、一堆符号），这里只收**中文文档里真会与汉字
 * 混排、且拉丁字体里确实有字形**的那几族——引号/破折号/项目符/ primes、希腊、西里尔、
 * 以及拉丁区里那几个两可符号。漏收的后果只是那一枚字符仍按拉丁字体画（与不加 hint 相同），
 * 错收才会把明显是拉丁的字符换成中文字体，所以边界取窄。
 * 完整表见 Unicode EastAsianWidth.txt 的 A 类。
 */
const EA_AMBIGUOUS: [number, number][] = [
  [0x00a1, 0x00a1],
  [0x00a4, 0x00a4],
  [0x00a7, 0x00a8],
  [0x00aa, 0x00aa],
  [0x00ad, 0x00ae],
  [0x00b0, 0x00b4],
  [0x00b6, 0x00ba],
  [0x00bc, 0x00bf],
  [0x00c6, 0x00c6],
  [0x00d0, 0x00d0],
  [0x00d7, 0x00d8],
  [0x00de, 0x00e1],
  [0x00e6, 0x00e6],
  [0x00e8, 0x00ea],
  [0x00ec, 0x00ed],
  [0x00f0, 0x00f0],
  [0x00f2, 0x00f3],
  [0x00f7, 0x00fa],
  [0x00fc, 0x00fc],
  [0x0391, 0x03a9], // 希腊大写
  [0x03b1, 0x03c9], // 希腊小写
  [0x0400, 0x04ff], // 西里尔
  [0x2010, 0x2027], // 连字符/破折号/引号/项目符/†‡•…‰
  [0x2030, 0x2033], // ‰′″‴
  [0x203b, 0x203b],
  [0x203d, 0x203e],
  [0x2103, 0x2103], // ℃
  [0x2109, 0x2109], // ℉
  [0x2116, 0x2116], // №
  [0x2160, 0x217f], // 罗马数字
]

/** 这一个字符是不是宽窄两可（表外用二分；表只有 28 段，顺序扫也够快） */
function isEaAmbiguous(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0
  for (const [lo, hi] of EA_AMBIGUOUS) if (cp >= lo && cp <= hi) return true
  return false
}

/**
 * 发一段 run 文字。hint=eastAsia 且拉丁/东亚两族字体不同时，**含混字符单独成段并把
 * 东亚字体排到栈首**：CSS 字体栈是"第一个含有该字形的字体赢"，而含混字符在拉丁字体里
 * 也有字形，不换序就永远画在拉丁字体上——Word 的 hint=eastAsia 说的正是这件事。
 */
function emitRunText(text: string, rp: RunProps): string {
  const [asciiF, eaF] = rp.fonts ?? []
  // \u0001 是软换行的占位（w:br），发射时换成 <br>；含混字符里不会有它，切段不受影响
  const body = () => escText(text).replace(/\u0001/g, '<br>')
  if (rp.hint !== 'eastasia' || !eaF || !asciiF || asciiF === eaF) return marked(body(), rp)
  // 按含混性切段，相邻同类合并；切完逐段各自 escaped（nbsp 那一套在 escText 里）
  const parts: { amb: boolean; text: string }[] = []
  for (const ch of text) {
    const amb = isEaAmbiguous(ch)
    const last = parts[parts.length - 1]
    if (last && last.amb === amb) last.text += ch
    else parts.push({ amb, text: ch })
  }
  return parts
    .filter((p) => p.text.length > 0)
    .map((p) => marked(escText(p.text).replace(/\u0001/g, '<br>'), p.amb ? { ...rp, fonts: [eaF, asciiF] } : rp))
    .join('')
}

/** 套 marks：从内到外 样式属性 → 高亮 → 删除线 → 下划线 → 斜体 → 粗体 */
function marked(inner: string, p: RunProps): string {
  if (!inner) return ''
  let s = inner
  const css = cssOf(p)
  // 复杂文字三件套与 hint（v0.138）：HTML 里没有对应物，随 data-* 进模型再走往返。
  // 由 lib/char-extra.ts 的 charExtra mark 接住（cs/hint 写回 docx，szCs/lang 见该文件头注）
  const extra = [
    p.cs ? ` data-cs="${attrEsc(p.cs)}"` : '',
    p.szCs !== undefined ? ` data-szcs="${p.szCs}"` : '',
    p.lang ? ` data-lang="${attrEsc(p.lang)}"` : '',
    p.langEa ? ` data-lang-ea="${attrEsc(p.langEa)}"` : '',
    // v0.146：复杂文字语言与字符缩放。两枚 CSS 都没有对应物，只随 data-* 进模型再走往返
    p.langBidi ? ` data-lang-bidi="${attrEsc(p.langBidi)}"` : '',
    p.scale !== undefined ? ` data-scale="${p.scale}"` : '',
    p.hint ? ` data-hint="${attrEsc(p.hint)}"` : '',
    p.pos !== undefined ? ` data-pos="${p.pos}"` : '',
    p.kern !== undefined ? ` data-kern="${p.kern}"` : '',
    p.iCs ? ' data-ics="1"' : '',
    p.bCs ? ' data-bcs="1"' : '',
    p.smallCaps ? ' data-smallcaps="1"' : '',
  ].join('')
  if (css || extra) s = `<span${css ? ` style="${css}"` : ''}${extra}>${s}</span>`
  if (p.hl) s = `<mark data-color="${p.hl}" style="background-color: ${p.hl}; color: inherit">${s}</mark>`
  if (p.strike) s = `<s>${s}</s>`
  if (p.u) s = `<u>${s}</u>`
  if (p.i) s = `<em>${s}</em>`
  if (p.b) s = `<strong>${s}</strong>`
  // 上下标是最外层：Word 把 vertAlign 记在 rPr 里，与粗斜体同级，套在外面读回来不改变含义
  if (p.va === 'sup') s = `<sup>${s}</sup>`
  else if (p.va === 'sub') s = `<sub>${s}</sub>`
  // 字符样式标签（v0.113）：在修订壳之内、格式 marks 之外——Word 里 rStyle 与 vertAlign 同级，
  // 编辑器侧由 rStyle mark（span[data-rstyle]）接住，样式表按它统一呈现
  if (p.rstyle) s = `<span data-rstyle="${attrEsc(p.rstyle)}">${s}</span>`
  // 修订壳在最外：正文格式包在修订里（Word 的层级关系正是如此），span[data-rev] 由
  // lib/revision-extension.ts 的两个 mark 接住——不用原生 <ins>/<del> 标签，<del> 已被删除线 mark 占用
  if (p.rev) s = `<span data-rev="${p.rev.kind}" data-rev-author="${attrEsc(p.rev.author)}" data-rev-date="${attrEsc(p.rev.date)}">${s}</span>`
  return s
}

// ---- 列表栈 ---------------------------------------------------------------

/**
 * 只管"开到哪一层、上一项是否还开着"，返回要追加的 HTML 片段。
 * 进深层时父 <li> 保持打开——嵌套列表必须落在父项里面，bulletList 的内容只收 listItem。
 */
/** 列表元素的标记信息（v0.142）：ul 走行内 CSS、ol 走 HTML 属性、对齐只往返不屏现 */
interface ListMarker {
  /** ul 的行内 CSS（list-style-type 符面字符） */
  css?: string
  /** ol 的 HTML type 属性（有序型别：1/a/A/i/I） */
  type?: string
  /** ol 的起始号（w:lvl/w:start 或 w:num/w:lvlOverride/w:startOverride） */
  start?: number
  /** lvlJc 的符面对齐（center/right；left 是默认，不挂属性） */
  align?: string
}

/** `w:numFmt` → HTML `<ol type>`（StarterKit 的 OrderedList 认 HTML type 属性） */
const OL_TYPE: Record<string, string> = {
  decimal: '1',
  lowerletter: 'a',
  upperletter: 'A',
  lowerroman: 'i',
  upperroman: 'I',
}

class ListState {
  private stack: { id: string; level: number; ordered: boolean }[] = []
  /** numId → 这一串列表的基准层：文档写 ilvl=2 而上游没有可挂靠的父项时，那层"2"我们当 0 用 */
  private base = new Map<string, number>()

  /**
   * 开串/续串时给出的标记信息（v0.142）：css 是 ul 的 list-style-type（子弹符面），
   * type/start 是 ol 的 HTML 属性（有序型别与起始号），align 是 lvlJc 的符面对齐
   * （CSS 画不了，只随 data-oo-marker-align 往返）。没有标记信息时一个属性都不加，
   * 与旧字节一致。
   */
  before(level: number, ordered: boolean, id: string, marker?: ListMarker): string {
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
    const attrs: string[] = []
    if (marker?.css) attrs.push(`style="${marker.css}"`)
    if (marker?.type) attrs.push(`type="${marker.type}"`)
    // 起始号只对有序档有意义（Word 的子弹层也写 w:start，但符面不看它）
    if (ordered && marker?.start !== undefined && marker.start !== 1) attrs.push(`start="${marker.start}"`)
    if (marker?.align) attrs.push(`data-oo-marker-align="${marker.align}"`)
    const tag = ordered ? 'ol' : 'ul'
    while (!this.stack.length || this.stack[this.stack.length - 1].level < eff) {
      s += `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}><li>`
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
  /**
   * 书签 id → 该区间在本段起始的下标与名字（v0.146）。与 openAt 同构：跨段书签
   * 每段各包一枚 span（mark 不能跨块），段界不断区间
   */
  openBm: Map<string, { name: string | undefined; at: number }>
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
  return wrapRange(pieces, from, (buf) => `<span data-oo-comment="${cid}">${buf}</span>`)
}

/**
 * 书签区间原位包 span（v0.146）：与批注同一副骨架——块级插入物前的行内容先闭合、
 * 块原样保留。空区间（起终点相邻、不包内容）产出空串，PM 的 mark 模型无处安放
 * 一枚没有内容的标记，往返丢失（记账，见审计）
 */
function wrapBookmark(pieces: Piece[], from: number, name: string | undefined): Piece[] {
  if (!name) return []
  return wrapRange(pieces, from, (buf) => `<span data-oo-bookmark="${attrEsc(name)}">${buf}</span>`)
}

/** 区间包裹的公共骨架：from 起的行内片并成一枚 span，块级片原样留在 span 之外 */
function wrapRange(pieces: Piece[], from: number, wrap: (buf: string) => string): Piece[] {
  const tail = pieces.slice(from)
  const out: Piece[] = []
  let buf = ''
  for (const p of tail) {
    if (p.kind === 'block') {
      if (buf) out.push({ kind: 'inline', html: wrap(buf) })
      buf = ''
      out.push(p)
    } else buf += p.html
  }
  if (buf) out.push({ kind: 'inline', html: wrap(buf) })
  return out
}

// ---- 导入器 ---------------------------------------------------------------

class Fidelity {
  /** 告警文案 → 出现次数：一份文件里三个文本框是同一条边界，但"三处"比"一项"更有信息量 */
  warnings = new Map<string, number>()
  comments: DocComment[] = []  /** 已开未关的批注区间 id：跨段续挂（mark 不能跨块，故每段各一枚 span） */
  private openRanges = new Set<number>()
  /** 已开未关的书签 id → 名字（v0.146）：跨段书签与批注同规矩，每段各包一枚 span */
  private openBookmarks = new Map<string, string | undefined>()
  private rels = new Map<string, { target: string; external: boolean }>()
  private media = new Map<string, Promise<string | null>>()
  /** 图形类部件（diagrams/dataN.xml、charts/chartN.xml）的 XML 文本缓存 */
  private parts = new Map<string, Promise<string>>()
  private zip: ZipLike | null = null
  /** 嵌入部件（word/embeddings/*）的二进制缓存：同一个对象被两处引用时只解一次 */
  private bins = new Map<string, Promise<Uint8Array | null>>()
  /** 书签表与 SEQ 计数（交叉引用可以指向后面的段落，所以正文渲染前先扫一遍整篇） */
  private fields = new FieldEngine()
  /** 版心宽（缇）：body 末尾 sectPr 的 pgSz 减左右页边距；表宽的 pct 那一档按它折算，说不全就是 0 */
  private contentTw = 0
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
    /** 主题字体槽（v0.138）：document 树在 run() 里落地，styles/numbering 在读入时已落地 */
    private theme?: ThemeFonts,    /** 主题色槽（v0.142）：w:color/@w:themeColor、w:shd/@w:themeFill 与边框上的同名属性引用的就是这些槽 */
    private themeColors?: ThemeColors,
  ) {}

  private warn(msg: string) {
    this.warnings.set(msg, (this.warnings.get(msg) ?? 0) + 1)
  }

  /**
   * 编号定义的多级身份记账（v0.145）：multiLevelType 描述「这份定义是否设计成多级联动」，
   * 而模型把编号定义塌成逐段档位（ListRegistry 按段引用重建），身份带不回来。
   * 每种类型一条（去重后由 warn 的 Map 自然合并计数）
   */
  noteNumberingIdentity(types: Iterable<string>) {
    for (const t of new Set(types)) {
      this.warn(`编号定义的多级类型 w:multiLevelType=${t} 未保留（编号按逐段档位重建，定义身份不带回）`)
    }
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
    // 主题引用在 document 树上落地（v0.138）：与 styles/numbering 同一趟，赶在一切读手之前
    applyThemeFonts(doc, this.theme)
    // w:body 是 w:document 的孩子，而 parseXml 的根是 '#doc'，所以要深找一层
    const body = findDesc(doc, 'w:body')
    if (!body) throw new Error('document.xml 缺 w:body')
    this.fields = FieldEngine.from(body)
    this.contentTw = contentTwipsOf(body)
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
  /**
   * 编号层级 → 列表元素的标记（v0.142）。子弹档的符面字符走 ul 的 list-style-type
   * （bullet-char 扩展在模型里收它，写侧按它生成编号定义）；有序档的型别走 ol 的
   * type 属性（StarterKit 的 OrderedList 收它）。lvlJc 只有左/中/右三值，
   * CSS 放不了符面在编号空间里的位置，只随 data-oo-marker-align 往返。
   */
  private markerOf(def: LvlDef | undefined): ListMarker | undefined {
    if (!def) return undefined
    const out: ListMarker = {}
    if (def.numFmt === 'bullet') {
      // 符面字符原样进 CSS 串：引号与反斜杠要转义，否则 style 属性当场被截断
      if (def.lvlText) out.css = `list-style-type:'${def.lvlText.replace(/['\\]/g, '\\$&')}'`
    } else {
      // numFmt 是 camelCase 字面（lowerRoman/upperLetter），查表先归小写
      const t = OL_TYPE[def.numFmt.toLowerCase()]
      if (t) out.type = t
      else this.warn(`编号档位 w:numFmt=${def.numFmt} 屏上按十进制渲染`)
      // 有序编号的文字模板不是「%N.」的简单形时（「第%1章」这类），屏上画不出它
      if (def.lvlText && !/^%\d+[.、)）]?$/.test(def.lvlText)) this.warn(`编号文字模板 w:lvlText=${def.lvlText} 未保留`)
    }
    if (def.start !== 1) out.start = def.start
    if (def.lvlJc === 'center' || def.lvlJc === 'right') out.align = def.lvlJc
    return out
  }

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
    const edges = borderEdges(pbdr, this.themeColors)
    return {
      sig: JSON.stringify([
        edges.top ?? null,
        edges.right ?? null,
        edges.bottom ?? null,
        edges.left ?? null,
        edges.between ?? null,
        shadingHex(find(effPPr, 'w:shd'), this.themeColors),
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
    const base = baseRunProps(view.chain, effPPr, this.themeColors)
    // 段落标记自身的修订（v0.100）：pPr/w:ins = 这是新插入的段落（接受后留下来）；文字若没被
    // w:ins 单独包住，段落级插入就是它唯一的变化，按普通段落读不丢内容。pPr/rPr/w:del =
    // 段落标记被删（接受后本段并入下一段），这一层意思模型里没有承载，如实记账
    if (pPr && find(pPr, 'w:ins')) this.warn('段落级修订（新插入的段落标记）按接受后的状态读入')
    if (pPr && find(pPr, 'w:rPr') && find(find(pPr, 'w:rPr') as XEl, 'w:del'))
      this.warn('段落级修订（段落标记被删除）未处理：Word 接受后本段会并入下一段')

    let prefix = ''
    const num = inCell ? { level: 0 } : this.numOf(el)
    if (num.id !== undefined) {
      const def = this.numbering.byId.get(num.id)?.get(num.level)
      prefix = list.before(num.level, !!def && def.numFmt !== 'bullet', num.id, this.markerOf(def))
    }

    const pieces = await this.inline(el, base, inCell)
    if (view.preformatted) return prefix + `<pre><code>${escText(plainText(el))}</code></pre>`

    const style = this.paraCss(effPPr, betweenCss, base.sz)
    // 命名样式标签（v0.102）：非标题段落把 pStyle 随标签带出去。h1-h4 的标题语义已由
    // heading 层级承载（导出走 HeadingLevel）；Heading5+ 与自定义样式落 p 标签时靠这一笔，
    // 导出按它写回 w:pStyle。preformatted 分支上面已返回（code 语义优先，不带样式标签）
    const pstyleId = pPr ? val(pPr, 'w:pStyle') : undefined
    const tag =
      view.level && view.level <= 4
        ? `h${view.level}`
        : pstyleId
          ? `p data-pstyle="${attrEsc(pstyleId)}"`
          : 'p'
    // 图案底纹的往返载荷（v0.142）：CSS 的 background-image 画得出图案，回写时还要知道
    // 是哪一档图案、前景背景各是什么色——data-shade 三件套随标签进出（clear 不挂）
    const shadeAttr = shadePayload(find(effPPr, 'w:shd'), this.themeColors)
    // 分页四件套（v0.143）：w:pageBreakBefore / w:keepNext / w:keepLines / w:widowControl。
    // Web 流式排版没有分页与孤行控制，屏上不兑现——只随 data-* 进出保往返。
    // onOff 三态：'1' 开、'0' 关（widowControl 在 Word 里默认就是开，「显式关」是真值，
    // 不能与「没写」同路）、没写不挂。样式链合并后的 effPPr 上读，样式层说的算数
    const flags: string[] = []
    for (const f of PAGE_FLAGS) {
      const v = on(find(effPPr, `w:${f}`))
      if (v !== undefined) flags.push(` data-${FLAG_ATTR[f]}="${v ? '1' : '0'}"`)
    }
    // 制表位表（v0.144）：w:tabs/w:tab 的 val|pos|leader。屏上无对应物（tab 字符驱动
    // 跳对齐，Word 之外没有这套档位表），只随 data-tabs 载荷往返。样式链合并后的
    // effPPr 上读——样式层声明的制表位与段内直接声明同权（后者追加在后）
    const tabsAttr = readTabsPayload(effPPr)
    // 浮动框架（v0.145）：w:framePr 的 key=value 载荷。Word 的纸面框架定位，Web 流式
    // 排版没有页这一层，屏上不兑现——只随 data-frame 往返
    const frameAttr = readFramePayload(effPPr)
    // 段落属性余量（v0.147）：pPr 里那批屏上不兑现的直接属性 → data-ppr 载荷
    const pprAttr = readPprPayload(effPPr)
    const body = this.layout(
      `${tag}${shadeAttr ? ` data-shade="${shadeAttr}"` : ''}${tabsAttr ? ` data-tabs="${tabsAttr}"` : ''}${frameAttr ? ` data-frame="${frameAttr}"` : ''}${pprAttr ? ` ${PPR_ATTR}="${pprAttr}"` : ''}${flags.join('')}`,
      style,
      pieces,
    )
    return view.quote ? prefix + `<blockquote>${body}</blockquote>` : prefix + body
  }

  /**
   * 段落样式 → CSS：对齐 + 缩进（lib/indent-extension.ts）+ 行距与段前后 + 底纹 + 四边边框
   * （后三项落在 lib/paragraph-style.ts 的属性上）
   */
  private paraCss(pPr: XEl | undefined, betweenCss = '', baseSz?: number): string {
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
      // 字符那一档的宽度底数取段落自己的字号（段标 > 样式链，与正文渲染同一份账），取不到才按
      // .doc-content 正文那 15px（src/index.css:996）：旧代码硬写的 16 在 c16b 那 282 枚字号可解的
      // leftChars 臂上平均偏 0.15px、最大 4.00px（12 枚超 0.5px），而字号不可解、只能吃这枚底数的只有 4 枚
      const charPx = baseSz ? Math.round(baseSz * HP_PX) : 15
      // 缇值先说话（c13 门面九枚「缇值 × 字符数双生」臂全 verdict=literal），字符那一枚只在缇值整枚没写时
      // 说话——缇值显式 0 时不接字符档（那一档的组合本轮没量过，不改道）；负数字面不上账
      // （c15w：w:leftChars="-49" 在 Word 门面报 wordPt=0）
      const left = attrNum(ind, 'w:left') ?? attrNum(ind, 'w:start')
      const leftChars = attrNum(ind, 'w:leftChars')
      const hang = attrNum(ind, 'w:hanging')
      const right = attrNum(ind, 'w:right') ?? attrNum(ind, 'w:end')
      const rightChars = attrNum(ind, 'w:rightChars')
      if (left) bits.push(`margin-left: ${Math.round(left * TWIP_PX)}px`)
      else if (left === undefined && leftChars && leftChars > 0) bits.push(`margin-left: ${Math.round((leftChars / 100) * charPx)}px`)
      if (right) bits.push(`margin-right: ${Math.round(right * TWIP_PX)}px`)
      // v0.143：右缩进的字符档（真件 0 枚、合成语料 34 枚——Word 的 ind 对话框「按字符」那一列
      // 写的就是它）。与左缩进同一纪律：缇值整枚没写才让字符档说话
      else if (right === undefined && rightChars && rightChars > 0) bits.push(`margin-right: ${Math.round((rightChars / 100) * charPx)}px`)
      const first = attrNum(ind, 'w:firstLine')
      const firstChars = attrNum(ind, 'w:firstLineChars')
      const hangChars = attrNum(ind, 'w:hangingChars')
      const firstPx = first
        ? Math.round(first * TWIP_PX)
        : first === undefined && firstChars && firstChars > 0
          ? Math.round((firstChars / 100) * charPx)
          : 0
      if (firstPx) bits.push(`text-indent: ${firstPx}px`)
      else if (hang) bits.push(`text-indent: ${-Math.round(hang * TWIP_PX)}px`)
      // v0.143：悬挂缩进的字符档——负 text-indent 与 hang（缇值）平级，缇值没写才说话
      // （「缇值先」的纪律同左缩进那一臂；firstLineChars 与 hangingChars 在样式链合并时
      // 同槽二选一，见 PPR_ATTR_SLOTS）
      else if (first === undefined && firstChars === undefined && hangChars && hangChars > 0) {
        bits.push(`text-indent: ${-Math.round((hangChars / 100) * charPx)}px`)
      }
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
    const bgCss = shadingCss(find(pPr, 'w:shd'), this.themeColors)
    if (bgCss) bits.push(bgCss)
    const pat = patternVal(pPr ? find(pPr, 'w:shd') : undefined)
    if (pat) this.warn(`图案底纹（w:shd @w:val=${pat}）按 CSS 近似渲染：条纹族精确，pct 族密度近似`)
    const pbdr = pPr ? find(pPr, 'w:pBdr') : undefined
    if (pbdr) {
      const edges = borderEdges(pbdr, this.themeColors)
      for (const edge of CELL_EDGES) {
        const v = edges[edge]
        if (v) bits.push(`border-${edge}: ${v}`)
      }
      // w:between（第五边）：与下一段是同一串时落成本段下边框；显式声明了 w:bottom 时
      // between 是冗余的，让位——两条都画会在同一条缝上叠出两根线
      if (betweenCss && edges.bottom === undefined) bits.push(`border-bottom: ${betweenCss}`)
      // 边框与文字的距离（w:space，磅→px，v0.143）：CSS 的 padding 正是 border 盒与内容盒
      // 的距离，语义同形，四边各落一条。between 是「串与串之间」的缝，没有内容盒可依，
      // 它的 space 只在同串让位时作废，忽略
      for (const edge of CELL_EDGES) {
        const sp = edgeSpacePx(find(pbdr, `w:${edge}`))
        if (sp > 0) bits.push(`padding-${edge}: ${sp}px`)
      }
      if (all(pbdr, 'w:between').some((e) => (attrNum(e, 'w:space') ?? 0) > 0)) {
        this.warn('段落边框 between 边的间距未保留（同串段落之间的缝没有内容盒可依）')
      }
    }
    return bits.join('; ')
  }

  /**
   * 段前/段后：按「行」的那一档（值是行数×100）只要说了话就压过缇档，同层并立压、跨层也压
   * （A4：样式 before="120" 而段落 beforeLines="100" → Word 门面 12pt 而不是 6pt；A12：段落自己写
   * before="200"（10 磅）而样式 beforeLines="100" → Word 仍报 12pt，缇档在哪一层都不加分；
   * A8/A15 同层并立同理报 24pt）。两档对「0」的语义相反，不能共用一条真值判断：
   * 行档的 0 不算说话（A18/A20/A21：beforeLines="0" 既压不住同层的缇值也压不住样式那层的，Word 退回
   * 6pt），但它压得住同名的前写层（A19：段落 beforeLines="0" 压掉样式的 100 → Word 报 0pt），
   * 所以行档 ≤0 且缇档整枚没写时落 0 而不是「没声明」；缇档的 0 直接是真值（A6/A7）。
   * 行的绝对高度取决于字号与行距，这里按小四（12pt）单倍行距的 19px 估，并记一条告警说明是估的。
   * 本轮 9 枚行档臂（A4/A5/A8/A12/A14/A15/A17/A22/A23）量到 Word 的底数全是 12pt（=16px；无样式的 A17
   * 与 line="240" exact 的 A22 也是 12pt），我们这一枚偏 3px/行——底数随字号与倍数怎么走还没量，不为它改道（见路线图）。
   */
  private spaceOf(sp: XEl, twips: string, lines: string): number | undefined {
    const ln = attrNum(sp, lines)
    const tw = attrNum(sp, twips)
    if (ln !== undefined && ln > 0) {
      this.warn(`段前/段后按「行」计（${local(sp.name)} ${lines}），已按 19px/行 估算`)
      return Math.round((ln / 100) * LINE_UNIT_PX * 100) / 100
    }
    if (tw !== undefined) return px2(tw * TWIP_PX)
    // 行档 ≤0 而缇档整枚没写：按 0 上账（A19）。负字面在这批语料里 0 枚（c4：beforeLines 正=1050/零=339/负=0，
    // afterLines 正=845/零=338/负=0），所以 ≤0 那一枝实际只走 0
    return ln === undefined ? undefined : 0
  }

  /**
   * 潜在样式（v0.146）：读 styles.xml 时收的 w:latentStyles 容器与全部 lsdException——
   * Word 样式库的门面账。屏上不兑现，随 DocxImport 出去、导出时补丁回 styles.xml
   */
  get latentStyles(): DocxLatentStyles | undefined {
    return this.book.latentStyles
  }

  /**
   * 命名样式清单（v0.102 段落 / v0.113 字符 / v0.114 表格）：styles.xml 里
   * type="paragraph|character|table" 的每一枚，沿 basedOn 链摊平成结构化快照——
   * run 层逐层 readRPr，para 层取合并视图 pPr 的各枚值（与 paraCss 同一套读取口径），
   * table 层取表级 tblPr 与自身 tcPr（见下面那一支）。字符样式只有 run 层，编号样式不进清单。
   * 段前后按「行」计时这里不 warn（warn 是给正文段落路径的；清单读的是样式定义本身，
   * 19px/行 的估算值就是快照的一部分，不算「未保留」）。
   */
  styleList(): DocxStyleInfo[] {
    const lineSpace = (sp: XEl, twips: string, lines: string): number | undefined => {
      const tw = attrNum(sp, twips)
      if (tw !== undefined) return px2(tw * TWIP_PX)
      const ln = attrNum(sp, lines)
      return ln === undefined || ln === 0 ? undefined : Math.round((ln / 100) * LINE_UNIT_PX * 100) / 100
    }
    const runSnapshot = (rp: RunProps): DocxStyleInfo['run'] => {
      const run: DocxStyleInfo['run'] = {}
      if (rp.fonts?.length) run.font = rp.fonts.join(', ')
      if (rp.sz) run.sizePx = Math.round(rp.sz * HP_PX * 100) / 100
      if (rp.b) run.bold = true
      if (rp.i) run.italic = true
      if (rp.u) run.underline = true
      if (rp.strike) run.strike = true
      if (rp.color) run.color = rp.color
      return run
    }
    const out: DocxStyleInfo[] = []
    for (const info of this.book.byId.values()) {
      if (!info.name || !['paragraph', 'character', 'table'].includes(info.type)) continue
      // 定义被 Word 换掉的那几枚（TableNormal）不进清单：再往前走一步它会以「用户声明」的面目出现
      if (SUBSTITUTED_TABLE_STYLES.has(info.id)) continue
      const view = styleView(this.book, info.id)
      let rp: RunProps = NONE
      for (const s of view.chain) if (s.rPr) rp = readRPr(s.rPr, rp, this.themeColors)
      const run = runSnapshot(rp)
      /**
       * 表样式（v0.114）：只摊"表级那一层"说了什么——外框四边与内部横竖线、默认格边距、
       * 整表对齐、默认格底纹，以及应用到表内文字的那份 run。
       * 沿 basedOn 链自根向下合并的纪律与样式注册内部的五层来历一致：
       * 后来者逐条盖（含显式 `nil` 与 `fill="auto"` 这两种"压掉"的说法），
       * 而 Word 会换掉自己那份定义的 `TableNormal`（`SUBSTITUTED_TABLE_STYLES`）
       * 压根不进链——往它身上写的数从不落地，照抄就是把别家的默认写成用户的声明。
       * 条件层（`w:tblStylePr`：首行/隔行那些带）从 v0.116 起也进快照——不再是只读也不可editor的一个洞；
       * 它同时还按位置逐格塌进 `<td>` 的内联样式（那一笔较早，落在它自己那一格里）。
       */
      if (info.type === 'table') {
        const bd: Record<string, string | undefined> = {}
        let mar: Record<string, number> = {}
        let shdEl: XEl | undefined
        let jc: string | undefined
        const cond: Partial<Record<TableCondType, TableCond>> = {}
        for (const anc of styleChain(this.book, info.id)) {
          if (SUBSTITUTED_TABLE_STYLES.has(anc.id)) continue
          const raw = borderEdges(find(anc.tblPr, 'w:tblBorders'), this.themeColors)
          // start/end 与 left/right 是同一条边的两种写法，先归一再合并，否则叶层的 start 盖不住祖先的 left
          const put = (canon: string, names: string[]) => {
            for (const n of names) if (raw[n] !== undefined) bd[canon] = raw[n]
          }
          put('top', ['top'])
          put('bottom', ['bottom'])
          put('left', ['left', 'start'])
          put('right', ['right', 'end'])
          put('insideH', ['insideH'])
          put('insideV', ['insideV'])
          mar = { ...mar, ...marginsOf(find(anc.tblPr, 'w:tblCellMar')) }
          const s = find(anc.tcPr, 'w:shd')
          if (s) shdEl = s
          const j = val(anc.tblPr, 'w:jc')
          if (j) jc = j.toLowerCase()
          // 条件层（v0.116）进快照：同型后出现的块**整套替换**前一块——Word 量的那一账
          // （r_dup_type_firstRow_L3：A{left,top} 之后 B{left,bottom}，落的是 B 的 two 条，
          // A 那条 top 一次都没出现），所以四边先清干净再按这一块重写，而不是逐边合并。
          // mar / shd / bold 三样各自成一回合互不 related：一块没说的那一样不牵动前者。
          // 只认 `w:tcPr` 那一格：`w:tblPr/w:tblCellMar` 那一格本轮不 snapshot（它会被 tcPr 盖）。
          for (const pr of anc.tblStylePr ?? []) {
            const key = asTableCondType(attr(pr, 'w:type'))
            if (!key) continue
            const tcPr = find(pr, 'w:tcPr')
            const cm = marginsOf(find(tcPr, 'w:tcMar'))
            const bgEl = find(tcPr, 'w:shd')
            const bEl = find(find(pr, 'w:rPr'), 'w:b')
            // 条件格边框（v0.117）：`w:tcBorders` 也住 `w:tcPr` 内
            const bcRaw = borderEdges(find(tcPr, 'w:tcBorders'), this.themeColors)
            const bc: Partial<Record<CellEdge, string>> = {}
            for (const e of CELL_EDGES) {
              const v = bcRaw[e]
              if (v) bc[e] = v
            }
            // 条件行高（v0.117）：`w:trPr`/`w:trHeight` 是这枚条件块的兄弟节点，不是 tcPr 的孩子
            const trPr = find(pr, 'w:trPr')
            const thEl = trPr ? find(trPr, 'w:trHeight') : undefined
            const thv = attrNum(thEl, 'w:val')
            const thExact = (attr(thEl, 'w:hRule') ?? 'atLeast').toLowerCase() === 'exact'
            if (
              !Object.keys(cm).length &&
              !bgEl &&
              !bEl &&
              !Object.keys(bc).length &&
              thv === undefined
            )
              continue
            const cur: TableCond = { ...(cond[key] ?? {}) }
            if (Object.keys(cm).length) {
              delete cur.padTopPx
              delete cur.padRightPx
              delete cur.padBottomPx
              delete cur.padLeftPx
              if (cm.top !== undefined) cur.padTopPx = cm.top
              if (cm.right !== undefined) cur.padRightPx = cm.right
              if (cm.bottom !== undefined) cur.padBottomPx = cm.bottom
              if (cm.left !== undefined) cur.padLeftPx = cm.left
            }
            if (Object.keys(bc).length) {
              delete cur.borders
              cur.borders = bc
            }
            if (thv !== undefined && thv > 0) {
              cur.rowHeightPx = px2(thv * TWIP_PX)
              cur.rowHeightExact = thExact
            } else {
              delete cur.rowHeightPx
              delete cur.rowHeightExact
            }
            const bg = bgEl ? shadingHex(bgEl, this.themeColors) : null
            if (bg) cur.background = bg
            if (bEl) cur.bold = !['0', 'false', 'off'].includes((attr(bEl, 'w:val') ?? 'true').toLowerCase())
            cond[key] = cur
          }
        }
        const tbl: NonNullable<DocxStyleInfo['table']> = {}
        const setBd = (key: keyof NonNullable<DocxStyleInfo['table']>, v: string | undefined) => {
          if (v) (tbl as Record<string, unknown>)[key] = v
        }
        setBd('bdTop', bd.top)
        setBd('bdRight', bd.right)
        setBd('bdBottom', bd.bottom)
        setBd('bdLeft', bd.left)
        setBd('bdInsideH', bd.insideH)
        setBd('bdInsideV', bd.insideV)
        if (mar.top !== undefined) tbl.padTopPx = mar.top
        if (mar.right !== undefined) tbl.padRightPx = mar.right
        if (mar.bottom !== undefined) tbl.padBottomPx = mar.bottom
        if (mar.left !== undefined) tbl.padLeftPx = mar.left
        if (jc === 'left' || jc === 'center' || jc === 'right') tbl.align = jc
        const bg = shadingHex(shdEl, this.themeColors)
        if (bg) tbl.background = bg
        // 一块载荷都没有的那几个型不进快照（点了又清空的部位不该在文件里留下痕迹）
        if (Object.keys(cond).length) tbl.cond = cond
        // 闸门原文（v0.147）：只认被快照这枚样式自己那一份，不沿链合并
        if (info.look) tbl.look = info.look
        out.push({
          id: info.id,
          name: info.name,
          kind: 'table',
          ...(info.basedOn ? { basedOn: info.basedOn } : {}),
          ...styleMetaOf(info),
          run,
          para: {},
          table: tbl,
        })
        continue
      }
      if (info.type === 'character') {
        out.push({
          id: info.id,
          name: info.name,
          kind: 'character',
          ...(info.basedOn ? { basedOn: info.basedOn } : {}),
          ...styleMetaOf(info),
          run,
          para: {},
        })
        continue
      }
      const para: DocxStyleInfo['para'] = {}
      const pPr = view.pPr
      if (pPr) {
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
        if (align) para.align = align
        const ind = find(pPr, 'w:ind')
        if (ind) {
          const left = attrNum(ind, 'w:left') ?? attrNum(ind, 'w:start')
          const right = attrNum(ind, 'w:right') ?? attrNum(ind, 'w:end')
          const first = attrNum(ind, 'w:firstLine')
          const firstChars = attrNum(ind, 'w:firstLineChars')
          const hang = attrNum(ind, 'w:hanging')
          if (left) para.marginLeftPx = px2(left * TWIP_PX)
          if (right) para.marginRightPx = px2(right * TWIP_PX)
          // 与 paraCss 同一套优先级：firstLine(twips) → firstLineChars（按 16px 字宽估）→ hanging 负缩进
          const firstPx = first ? px2(first * TWIP_PX) : firstChars ? Math.round((firstChars / 100) * 16) : 0
          if (firstPx) para.textIndentPx = firstPx
          else if (hang) para.textIndentPx = -px2(hang * TWIP_PX)
        }
        const sp = find(pPr, 'w:spacing')
        if (sp) {
          const ln = ooxmlLine(attrNum(sp, 'w:line'), attr(sp, 'w:lineRule'), (n) => px2(n * TWIP_PX))
          if (ln.length === 2) {
            para.lineHeight = ln[0]
            para.lineRule = ln[1]
          }
          const before = lineSpace(sp, 'w:before', 'w:beforeLines')
          const after = lineSpace(sp, 'w:after', 'w:afterLines')
          if (before !== undefined) para.spaceBeforePx = before
          if (after !== undefined) para.spaceAfterPx = after
        }
        const outline = valNum(pPr, 'w:outlineLvl')
        if (view.level !== undefined) para.outlineLevel = view.level - 1
        else if (outline !== undefined && outline >= 0 && outline <= 8) para.outlineLevel = outline
      }
      out.push({
        id: info.id,
        name: info.name,
        ...(info.basedOn ? { basedOn: info.basedOn } : {}),
        ...styleMetaOf(info),
        ...(view.level !== undefined ? { level: view.level } : {}),
        run,
        para,
      })
    }
    // Normal 恒排最前（它是「正文」），段落样式随后、字符样式再后、表样式垫底，组内按名字排
    const rank = (s: DocxStyleInfo) =>
      s.id === 'Normal' ? 0 : s.kind === 'table' ? 3 : s.kind === 'character' ? 2 : 1
    out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh'))
    return out
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
    // 跨段书签同理（v0.146）：上一段开着的书签在本段开头续挂
    const openBm = new Map<string, { name: string | undefined; at: number }>()
    for (const [id, name] of this.openBookmarks) openBm.set(id, { name, at: 0 })
    const st: InlineState = { pieces: [], openAt, openBm, fld: 0, show: false, stack: [], outSeq: 0, split: false, inCell }
    await this.children(el, base, st)
    for (const [cid, from] of st.openAt) {
      st.pieces.splice(from, st.pieces.length - from, ...wrapComment(st.pieces, from, cid))
      st.openAt.delete(cid)
    }
    // 段末仍开着的书签：本段这份内容包成一枚 span，区间继续开到下一段。
    // 按下标倒序处理——正序会让后一个区间的起始下标在前一次 splice 后失位
    const stillOpen = [...st.openBm.entries()].sort((a, b) => b[1].at - a[1].at)
    for (const [id, open] of stillOpen) {
      st.pieces.splice(open.at, st.pieces.length - open.at, ...wrapBookmark(st.pieces, open.at, open.name))
      st.openBm.delete(id)
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
      // 段落属性、校对标记、已删除内容：都不产出可见文字
      // （w:del / w:moveFrom 不在这里——它们在下面有各自的修订分支）
      case 'pPr':
      case 'proofErr':
      case 'commentReference':
      case 'lastRenderedPageBreak':
      case 'delInstrText':
      case 'delText':
        return
      case 'bookmarkStart':
      case 'bookmarkEnd': {
        // 书签区间（v0.146）：bookmarkStart/End 本身不产文字，但 id 与 name 两对要查问
        // （探针键 bookmarkStart|id / bookmarkStart|name / bookmarkEnd|id），区间内容
        // 包成 span[data-oo-bookmark] 由书签 mark 接住。跨段的在段末续挂（见 inline）
        const id = attr(node, 'w:id') ?? ''
        if (t === 'bookmarkStart') {
          const name = attr(node, 'w:name')
          st.openBm.set(id, { name, at: st.pieces.length })
          this.openBookmarks.set(id, name)
          return
        }
        const open = st.openBm.get(id)
        st.openBm.delete(id)
        this.openBookmarks.delete(id)
        if (open === undefined) return
        st.pieces.splice(open.at, st.pieces.length - open.at, ...wrapBookmark(st.pieces, open.at, open.name))
        return
      }
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
          // 压成行文本至少字还在，并如实记一条。这一枝留着展平而 w:tbl 那一枝不留（第十六笔账）：
          // 嵌入对象提出来的正文里有什么形状，本轮没像那 11 枚那样逐枚数过，没量过的形状不改道
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
        push(st, emitRunText(ommlLinear(node), props))
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
          // 书签不随子状态开合：链接里的书签区间归主序列管（与批注同一本账）
          openBm: new Map(),
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
        // 链接里开着没关的书签：区间续到主序列，下标按追加位置换算（同 openAt）
        for (const [id, open] of sub.openBm) st.openBm.set(id, { name: open.name, at: base + open.at })
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
      case 'customXml':
      case 'smartTag':
      case 'bdo':
      case 'dir':
        await this.children(node, props, st)
        return
      case 'ins':
      case 'del': {
        // 修订壳（v0.100）：插入的文字照常读但带上插入标记，删除的文字从 w:delText 里
        // 读出来并带上删除标记——以前前者被静默并入正文、后者整块消失，打开带修订的
        // 件等于强制"接受全部修订"且不告知。壳上的作者/日期原样带走，往返要认得出是谁改的
        const rev = {
          kind: t as 'ins' | 'del',
          author: attr(node, 'w:author') ?? '',
          date: attr(node, 'w:date') ?? '',
        }
        await this.children(node, { ...props, rev }, st)
        return
      }
      case 'moveTo':
        await this.children(node, props, st)
        this.warn('移动型修订（moveTo）按接受后的状态读入：落点文字保留，没有移动标记')
        return
      case 'moveFrom':
        this.warn('移动型修订（moveFrom）按接受后的状态读入：出发点文字不再保留')
        return
      case 'r': {
        const rPr = find(node, 'w:rPr')
        // rstyle 不继承：每个 run 只认自己 rPr 上的 w:rStyle，先清掉从父层带下来的
        let rp: RunProps = { ...props, rstyle: undefined }
        if (rPr) {
          const cs = val(rPr, 'w:rStyle')
          for (const s of styleChain(this.book, cs)) if (s.rPr) rp = readRPr(s.rPr, rp, this.themeColors)
          rp = readRPr(rPr, rp, this.themeColors)
          if (cs) rp.rstyle = cs
        }
        // 一个 run 里文字与图片/域标记可以穿插，所以先攒文字、遇到非文字构件就落盘
        let text = ''
        const flush = () => {
          if (!text) return
          push(st, emitRunText(text, rp))
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
          else if (ct === 'delText') {
            // 被删除的文字住在 w:delText 里（w:t 的位置被它顶替）：只在修订壳里才当文字读，
            // 裸露的 delText（脱离 w:del 的非法写法）仍按不存在处理
            if (rp.rev?.kind === 'del') text += textOf(c)
          } else {
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
    push(st, emitRunText(this.fields.seqValue(i.arg, i.switches), props))
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
        push(st, emitRunText(t, props))
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
    // docPr（wp 画布级）与 cNvPr（pic 图形级）都带 name/descr。Word 语义里 descr 才是
    // 替代文本（读屏软件念的那段），name 只是对象名——v0.145 起 alt 以 descr 优先、
    // 无 descr 时回落 name 保旧观感（老文件的 alt 一直装的 name，不能一夜间全空）。
    // 两处都查问（不用 ?? 短路——右支不求值会让 cNvPr 那半永远不进探针账）
    const docPr = findDesc(el, 'docPr')
    const cNvPr = findDesc(el, 'cNvPr')
    const name = attr(docPr, 'name') ?? attr(cNvPr, 'name') ?? ''
    const descrDocPr = attr(docPr, 'descr')
    const descrCNvPr = attr(cNvPr, 'descr')
    const alt = descrDocPr || descrCNvPr || name
    const size = `${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}`
    return `<img src="data:${mime};base64,${b64}"${size}${alt ? ` alt="${esc(alt)}"` : ''}>`
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
    const tblBordersEl = tblPr ? find(tblPr, 'w:tblBorders') : undefined
    const tb = borderEdges(tblBordersEl, this.themeColors)
    // 表级边框间距（v0.146）：六边的 space。单元格共用边框在 CSS 里没有对应物，
    // 但 space 与边框风格一样可以按「落到哪枚格边」分摊——外层四边贴外圈格，
    // insideH/insideV 贴相邻两格（每枚格边带自己那条边的 space，与 v0.143 实测的
    // 逐格 tcBorders direct 层同口径）。只在该边边框真回落到表级时才挂
    const tbSpace: Partial<Record<string, number>> = {}
    for (const edge of ['top', 'bottom', 'left', 'right', 'insideH', 'insideV']) {
      const sp = edgeSpacePx(find(tblBordersEl, `w:${edge}`))
      if (sp > 0) tbSpace[edge] = sp
    }
    const tblInd = tblPr ? attrNum(find(tblPr, 'w:tblInd'), 'w') : undefined
    // w:tblInd/@w:type（v0.144）：dxa（默认）时 w:w 是缇，现状读的就是它；pct 档 w:w 是
    // 百分之五十步长（ST_MeasurementOrPercent），nil 是不缩进、chars 是字符。非 dxa 档
    // 没有 px 化出路（pct 的分母是版心，随栏宽变），如实记账不假装
    {
      const t = tblPr ? (attr(find(tblPr, 'w:tblInd'), 'w:type') ?? '').toLowerCase() : ''
      if (t && t !== 'dxa') this.warn(`表缩进档位 w:tblInd/@w:type=${t} 未保留（dxa 之外的档位没有 px 化出路）`)
    }
    // 表级默认格边距（w:tblCellMar）：v0.97 之前整条丢弃，声明了的左右 108 缇（=7.2px）也读不出来。
    // 逐格 w:tcMar 只在它说到的那几边上优先。
    // 再往下一层（样式层）：表引用的样式（w:tblStyle）及其 basedOn 祖先说的格边距是这一层的基座，
    // 表自身说的边覆盖它，逐格说的边再覆盖表——这几层都是逐边合并，不是整组替换。
    // 四层都没说的边仍然不铺数：Word 那一头此时给的是它自带的 0/5.4/0/5.4 磅（a2/a10/a11 三臂量出来的），
    // 那是应用默认而不是文档说了的数，铺进我们的账里就是把别人的默认写成用户的声明
    const styleId = val(tblPr, 'w:tblStyle')
    const styleMarEdges = styleCellMargins(this.book, styleId)
    const tblMarEdges = marginsOf(find(tblPr, 'w:tblCellMar'))
    // 条件层（`w:tblStylePr`）与它的闸门（`w:tblLook`）：闸门只吃表上那一枚，两格各归各的层——
    // 那块里 `w:tcPr/w:tcMar` 归条件那一层（落在表级之上、逐格 tcMar 之下），
    // `w:tblPr/w:tblCellMar` 归的仍是样式那一层（压得过样式基座说的数，压不过表自身那枚；
    // sa_slot_top_vs_tbl 与 sc_slot_top_vs_stylebase 两臂用竖直位置尺量出来的），
    // 两族的落点作用域共用一份账：行型按行、列型按全表、角型按其所在那一行且要两枚位都开。
    // 底纹按位置取一型（含四角型，落点就是那一角那一格），落在样式基座之上、逐格 w:shd 之下
    const conds = styleCondCells(this.book, styleId, this.themeColors)
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
    // 列账（px）第一次由 `w:tblLayout` 分流，且**所有行**一起上账（第十笔账三头实测，53 臂）：
    // fixed 那一档网格是地板——任何一行的单列格都只往宽里抬，缩小不落（x_fix_nw 行0 各 1500 缇
    // 而网格 60|90|120 磅，纸上落 75|90|120；c_clash_sum_under 落 60|90|120 而不是 30|45|60），
    // 两行同列打架取最大而不是取最后一行（n_row12_big_first / _big_last 两序都落 105|90|120）；
    // 跨列格仍是「比它跨的那盘账还宽」那截上账、落所跨的最后一条，负差丢（n_row1_span_pos 60|120|120、
    // n_row1_span_neg 60|90|120），而 w:vMerge=continue 那一格的 tcW 根本不参与
    // （n_row1_vmerge_continue 只有「跳过 continue 那格」这一支对得上，尺子=列 75|90|120）。
    // autofit 与 layout 缺失那一档反过来：网格让位，逐列取所有行 tcW 的最大，缩小照落
    // （x_aut_aw_shrink 30|30|30、n_row1_only_autofit 75|75|45），跨列格那一份均摊到所跨各列
    // 而不是落最后一条（z_aut_row1_span 行1 跨 2 格 3600 缇 ⇒ 90|90|120，最后一条那一档是 60|120|120），
    // 一行都没说话的列 Word 按内容重排（z_aut_row12 那两列落 10.55 磅）——那是账外，这里退网格。
    const gridCols = Math.max(gridRaw.length, plan[0]?.reduce((m, c) => Math.max(m, c.gc + c.colspan), 0) ?? 0)
    const acct: number[] = new Array(Math.max(1, gridCols)).fill(0)
    for (let i = 0; i < acct.length; i++) if (gridRaw[i] > 0) acct[i] = gridRaw[i]
    const layEl = find(tblPr, 'w:tblLayout')
    const layFixed = !!layEl && (attr(layEl, 'w:type') ?? '').toLowerCase() === 'fixed'
    const pure: number[] = new Array(acct.length).fill(0)
    for (let ri = 0; ri < plan.length; ri++) {
      for (const c of plan[ri]) {
        if (c.cont) continue
        const total = tcWpx(find(c.el, 'w:tcPr'))
        if (total === null) continue
        const span: number[] = []
        for (let i = 0; i < c.colspan; i++) if (c.gc + i < acct.length) span.push(c.gc + i)
        if (!span.length) continue
        if (span.length === 1) {
          const k = span[0]
          if (layFixed) { if (total > acct[k]) acct[k] = total }
          else if (total > pure[k]) pure[k] = total
          continue
        }
        if (layFixed) {
          const holes = span.filter((k) => !acct[k])
          let known = 0
          for (const k of span) known += acct[k]
          if (holes.length) {
            const rest = total - known
            if (rest <= 0) continue
            const each = Math.max(1, Math.round(rest / holes.length))
            for (const k of holes) acct[k] = each
            continue
          }
          if (total > known) acct[span[span.length - 1]] += total - known
          continue
        }
        const each = total / span.length
        for (const k of span) if (each > pure[k]) pure[k] = each
      }
    }
    if (!layFixed) {
      for (let k = 0; k < acct.length; k++) if (pure[k] > 0) acct[k] = pure[k]
    }
    const gridKnown = acct.some((v) => v > 0)
    // 表级那一层的 w:tblW 只在整盘账都没说时说话：无网格、所有行也没逐格 tcW 的那些列，
    // Word 落的是「表宽折算后按列等分」（tb_pct30_nogrid 30% 版心 /3 格 = 45.2 磅、
    // tc_only_tblw 4500 缇 /3 格 = 75 磅，两臂实测逐格等宽，而自家此前整盘无账交给浏览器自动布局）。
    // 这一层留了两处已知不如 Word 的账（第十笔账 b4 实测，53 臂）：真数表宽（dxa 或 pct）在场时
    // Word 把它压在逐格账之上，且怎么压要看 layout——fixed 那一档是把上面这盘 max 形状**等比缩到表宽**
    // （x_fix_d3000 网格 60|90|120 + 行0 各 75 磅 ⇒ max 形状 75|90|120，表宽 3000 缇 ⇒ 纸上
    // 39.70|47.40|62.90 磅；n_row1_tblw_present 与 tc_tcw_vs_tblw 两臂同形），
    // autofit/缺失那一档是**表宽除以首行的格数**、跨列格那一份再摊到所跨各列
    // （x_aut_d3000_span 首行一枚跨 2 格 + 一枚单格 ⇒ 37.50|37.50|75.00 磅，而 tcW 自己说的 90|90|75 不作数；
    // d_clash_tblw_pct30_fixed 表宽 30% 版心 + 逐格各 1500 缇 ⇒ 35.95|42.90|56.85 而不是 75 磅）。
    // 动这两道要重标屏上与纸面三批基线（v0.92/v0.93/v0.94），故本轮仍不开，只把「谁压谁」的机理记清。
    const tblTotal = gridKnown ? null : tblWpx(tblPr, this.contentTw)
    if (tblTotal) {
      const each = Math.max(1, Math.round(tblTotal / acct.length))
      for (let i = 0; i < acct.length; i++) acct[i] = each
    }
    const acctKnown = gridKnown || !!tblTotal
    // 记账完成后才出 HTML：rowspan 要等所有行的 continue 都数完
    const tblStyle = tblInd ? tableIndentCss(Math.round(tblInd * TWIP_PX)) : ''
    // 表样式身份（v0.114）：样式 id 认得出才挂标签——认不出的 id 我们既没带定义、也没创同名
    // 引用（挂上去就是一枚指向不存在的 w:tblStyle）；表样式的**外观**不受影响，它早已逐格塌进
    // 内联样式（`styleId` 那五层合并的输出），挂标签多的是"改一处全表跟着变"的能力
    const owner = styleId && this.book.byId.has(styleId) && !SUBSTITUTED_TABLE_STYLES.has(styleId) ? styleId : ''
    const ownerAttr = owner ? ` data-tstyle="${escAttr(owner)}"` : ''
    // 表格浮动（v0.145）：w:tblpPr 的 key=value 载荷。Word 的纸面浮动表，Web 没有页定位
    // 语义，屏上不兑现——只随 data-tblp 往返（framePr 同款纪律）
    const tblpAttr = readTblpPayload(tblPr)
    // 表自身的闸门（v0.147）：w:tblPr/w:tblLook 三枚。与样式里那一枚同名同义，
    // 但归属不同——这张表自己说的压过样式说的，屏上一概不兑现，只随 data-tlook 往返
    const tlookAttr = readTlookPayload(tblPr)
    let s = `<table${tblStyle ? ` style="${tblStyle}"` : ''}${ownerAttr}${tblpAttr ? ` data-tblp="${tblpAttr}"` : ''}${tlookAttr ? ` ${TLOOK_ATTR}="${tlookAttr}"` : ''}>`
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
      const last = plan.length - 1
      if (thv !== undefined && thv > 0) {
        if ((attr(th, 'w:hRule') ?? 'atLeast').toLowerCase() === 'exact')
          this.warn('固定行高（exact）按最小行高读入，超高内容不再裁剪')
        trStyle = `height: ${px2(thv * TWIP_PX)}px`
      }
      // 条件行高（v0.117）：行上没直接写 w:trHeight 时才认条件层（direct > 条件）
      if (thv === undefined) {
        const ch = condRowHeightFor(look, conds, ri, ri === last)
        if (ch) {
          if (ch.exact) this.warn('固定行高（exact）按最小行高读入，超高内容不再裁剪')
          trStyle = `height: ${px2(ch.px)}px`
        }
      }
      // 行条件层 w:tblPrEx 的格边距：它是 w:tr 的首子（排在 w:trPr 之前），只说边距这一样上账
      const exMar = marginsOf(find(find(rows[ri], 'w:tblPrEx'), 'w:tblCellMar'))
      const rowEnd = plan[ri].reduce((m, c) => Math.max(m, c.gc + c.colspan), 0)
      s += `<tr${trStyle ? ` style="${trStyle}"` : ''}>`
      for (const c of plan[ri]) {
        if (c.cont) continue
        const tcPr = find(c.el, 'w:tcPr')
        const cb = borderEdges(tcPr ? find(tcPr, 'w:tcBorders') : undefined, this.themeColors)
        // 条件层边框（v0.117）：direct（上面 cb）> 条件层 > 表级（下面那枚 inside/outside 落点）
        const cb2 = condBordersFor(look, conds, ri, ri === last, c.gc, c.colspan, acct.length)
        const attrs: string[] = []
        if (c.colspan > 1) attrs.push(`colspan="${c.colspan}"`)
        const sp = spanAt[c.gc]
        if (sp && sp.row === ri && sp.span > 1) attrs.push(`rowspan="${sp.span}"`)
        if (ri === 0 && acctKnown) {
          const widths = acct.slice(c.gc, c.gc + c.colspan).filter((v) => v > 0)
          if (widths.length) attrs.push(`colwidth="${widths.join(',')}"`)
        }
        const mar = marginsCss({
          ...styleMarEdges,
          ...condMarginsFor(look, conds, ri, ri === last, 'tblMar'),
          ...tblMarEdges,
          ...condMarginsFor(look, conds, ri, ri === last, 'mar'),
          // 行条件层（w:tblPrEx/w:tblCellMar，第十五笔账）。四臂同批（b19 构造 / b20 Word 读数 /
          // b21 归档 / b22 改前读数；尺是每臂三行的 vpos 差，行盒高从 a1 定标成 14.00 磅）：
          // a2_ex_full 上下 14.90/15.25 磅 ⇒ 这一层吃、且压过表级（表级只说了 5 磅）；
          // a3_ex_top_only 上 14.90 而下 5.30 ⇒ **逐边合并**，它没说的那条边仍回落到表级，不是整组替换；
          // a4_ex_vs_cell 与 a5_cell_only 同形 10.10/10.10 ⇒ 逐格 w:tcMar 压过它，所以铺在最后一层之前；
          // a6_ex_over_missing 15.30/15.55 ⇒ 表级那层没说它也吃；a7_ex_zero 0.10/0.15 ⇒ 0 是真值。
          // 两处已知不如 Word / 无从裁决的账留这儿：
          // ① 与条件层（w:tblStylePr）、样式基座的先后——真件里行条件边距与那两层同槽 0 枚（b11），
          //    Word 无从裁决，本轮把它放在两者之上；
          // ② w:type="auto" 带一枚数时 Word 落 0（a8_ex_auto_type 上边 0.20 磅）而 marginsOf 把 auto
          //    归账外——真件里这一层的边距 12722 枚全是 dxa（b11），那一档在真件上够不着，不为它改闸。
          // 同层的 w:tblBorders / w:tblLayout / w:shd 仍不上账：真件里它们与表级同槽各 39400 边 /
          // 1353 表 / 12 枚，读数全同（0 分歧 / 1353 与 1353 identical / 12 枚全 auto 或没写），
          // 铺上去也改不了任何一张表。
          ...exMar,
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
        if (pat) this.warn(`图案底纹（w:shd @w:val=${pat}）按 CSS 近似渲染：条纹族精确，pct 族密度近似`)
        const shadeAttr = shadePayload(shd, this.themeColors)
        // 逐格边框间距（v0.143）：只从 direct 层 w:tcPr/w:tcBorders 读——条件层与表级的
        // space 不叠加（单元格共用边框，padding 会重复计数），忽略
        const tcBordersEl = tcPr ? find(tcPr, 'w:tcBorders') : undefined
        const bdSpace: Partial<Record<CellEdge, number>> = {}
        for (const edge of CELL_EDGES) {
          const sp = edgeSpacePx(find(tcBordersEl, `w:${edge}`))
          if (sp > 0) bdSpace[edge] = sp
        }
        // 表级边框的 space 补位（v0.146）：direct 层没说 space、且该边的边框风格本就
        // 回落到表级（cb/cb2 都没接）时，表级那条边的 space 归这枚格边。与边框风格
        // 同一套 fallback 口径（见下面 cellStyleCss 那一行），不会把表级 space 盖到
        // 格级边框上——Word 里格级 tcBorders 整条盖掉表级，space 随之一并不留
        for (const edge of CELL_EDGES) {
          if (bdSpace[edge]) continue
          if (edge === 'top' && (cb.top || cb2.top)) continue
          if (edge === 'bottom' && (cb.bottom || cb2.bottom)) continue
          if (edge === 'left' && (cb.left || cb2.left)) continue
          if (edge === 'right' && (cb.right || cb2.right)) continue
          const tblEdge =
            edge === 'top'
              ? ri === 0
                ? 'top'
                : 'insideH'
              : edge === 'bottom'
                ? ri === last
                  ? 'bottom'
                  : 'insideH'
                : edge === 'left'
                  ? c.gc === 0
                    ? 'left'
                    : 'insideV'
                  : c.gc + c.colspan >= rowEnd
                    ? 'right'
                    : 'insideV'
          const sp = tbSpace[tblEdge]
          if (sp) bdSpace[edge] = sp
        }
        const style = [cellStyleCss(tcPr, {
          top: cb.top ?? cb2.top ?? (ri === 0 ? tb.top : tb.insideH),
          bottom: cb.bottom ?? cb2.bottom ?? (ri === last ? tb.bottom : tb.insideH),
          left: cb.left ?? cb2.left ?? (c.gc === 0 ? tb.left : tb.insideV),
          right: cb.right ?? cb2.right ?? (c.gc + c.colspan >= rowEnd ? tb.right : tb.insideV),
        }, shadingCss(shd, this.themeColors)), mar].filter(Boolean).join('; ')
        if (style) attrs.push(`style="${style}"`)
        if (shadeAttr) attrs.push(`data-shade="${shadeAttr}"`)
        for (const [k, v] of Object.entries(bdSpaceAttrs(bdSpace))) attrs.push(`${k}="${v}"`)
        s += `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${await this.cellBlocks(c.el)}</${tag}>`
      }
      s += '</tr>'
    }
    return s + '</table>'
  }

  /** 单元格内容：段落走"格内列表"的独立栈（不与外层正文的列表串台），嵌套表格出真表 */
  private async cellBlocks(tc: XEl): Promise<string> {
    const list = new ListState()
    let html = ''
    for (let i = 0; i < tc.children.length; i++) {
      const b = tc.children[i]
      if (typeof b === 'string') continue
      const t = local(b.name)
      if (t === 'p') html += await this.paragraph(b, list, true, this.betweenOfSiblings(tc.children, i))
      else if (t === 'tbl') {
        // table() 里「整盘没账就按版心等分」那一档在格子里吃的是版心而不是外层格宽：真件 11 枚嵌套表
        // 枚枚带 w:tblGrid 与逐格 dxa 账（b6 的 N3/N4/N5），这一档在真件上够不着，本轮不为它改道
        html += await this.table(b)
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
function edgeCss(b: XEl, tc?: ThemeColors): string {
  const style = CSS_BORDER_STYLE[(attr(b, 'w:val') ?? 'single').toLowerCase()] ?? 'solid'
  if (style === 'none') return 'none'
  // Word 门面把 w:sz="0" 的实线报成 LineWidth=2（0.25 磅，它那刻度的最小发墨档），而 0px 的 CSS 边框一滴墨都不落；
  // 4/6/8 原样通过（真件表级与改造件段落两臂同测），所以这是地板不是一律取最小
  const px = eighthsToPx(Math.max(2, attrNum(b, 'w:sz') ?? 8))
  // 主题色优先（accent1 一族在边框上真件 34 枚），字面 w:color 是兜底
  const hex = themeRefCss(tc, b) ?? rgb2hex(`#${(attr(b, 'w:color') ?? '').replace(/^#/, '').toLowerCase()}`) ?? '#000000'
  return `${px}px ${style} ${hex}`
}

/**
 * 单边元素的 `w:space`（磅）→ CSS px；0/没写/读不懂都给 0（「没声明」与「0 距离」同路——
 * Word 自己默认就是 0，写不写这一枚屏上一个样）。
 * v0.143：段落侧（w:pBdr）与逐格侧（w:tcPr/w:tcBorders）的边都走这里；表级
 * w:tblBorders 与 insideH/insideV 的 space 不读（单元格共用边框，padding 会重复计数）。
 */
function edgeSpacePx(b: XEl | undefined): number {
  const pt = attrNum(b, 'w:space')
  return pt !== undefined && pt > 0 ? ptToPx(pt) : 0
}

/**
 * `w:tblBorders` / `w:tcBorders` → 各边规范串。
 * 没写的边留 undefined（区别于显式的 'none'）：undefined 才允许落回表级或应用网格线。
 */
function borderEdges(el: XEl | undefined, tc?: ThemeColors): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  if (!el) return out
  for (const child of els(el)) out[local(child.name)] = edgeCss(child, tc)
  return out
}

/** `w:shd` 的 `w:fill` → 规范 hex；auto/无填充/纯白都给 null（白底等于没底纹） */
function shadingHex(shd: XEl | undefined, tc?: ThemeColors): string | null {
  if (!shd) return null
  // 主题填充优先（真件 31 枚带 themeFill），字面 fill 是兜底；两枚都没有才按无底纹
  const themed = themeRefCss(tc, shd, 'w:themeFill', 'w:themeFillTint', 'w:themeFillShade')
  const fill = themed ?? attr(shd, 'w:fill') ?? ''
  if (!fill || fill.toLowerCase() === 'auto') return null
  const hex = rgb2hex(`#${fill.replace(/^#/, '')}`)
  return hex && hex !== '#ffffff' ? hex : null
}

/**
 * `w:shd` 的图案档位名（clear/none/nil/缺省给 null）+ 前景色。
 * Word 的语义：@w:color 是图案的前景、@w:fill 是背景；clear 时只有 fill 说话。
 * 前景色解析不了（auto/缺省/主题槽空）时给 null——图案没有前景就无从画起。
 */
function shadeSpec(shd: XEl | undefined, tc?: ThemeColors): { pattern: string; fg: string | null; bg: string | null } | null {
  if (!shd) return null
  const v = (attr(shd, 'w:val') ?? 'clear').toLowerCase()
  if (v === 'clear' || v === 'none' || v === 'nil') return null
  // 前景色与字色/边框同一套优先级：主题引用优先，字面 w:color 兜底
  const fg = themeRefCss(tc, shd) ?? rgb2hex(`#${(attr(shd, 'w:color') ?? '').replace(/^#/, '')}`)
  return { pattern: v, fg: fg && fg !== '#ffffff' ? fg : null, bg: shadingHex(shd, tc) }
}

/**
 * 底纹 → 一段内联 CSS（background-color 背景色；图案族再补 background-image）。
 * clear/无图案时只有背景一色，与 v0.142 之前逐字节一致；图案族才长出第二句。
 * 渐变公式不在本文件：cell-style 那份表是单一真源（扩展的 parse/render 与写侧都走它）。
 */
function shadingCss(shd: XEl | undefined, tc?: ThemeColors): string | null {
  const spec = shadeSpec(shd, tc)
  const bg = shadingHex(shd, tc)
  if (!spec || !spec.fg) return bg ? `background-color: ${bg}` : null
  return shadeCss({ pattern: spec.pattern, fg: spec.fg, bg: spec.bg ?? bg ?? '#ffffff' })
}

/**
 * 图案底纹的往返载荷：`图案|前景|背景`（hex 不带 #）。clear/无图案给 null——
 * 纯色底纹走 background 属性那一链，不需要第二份表示。
 */
function shadePayload(shd: XEl | undefined, tc?: ThemeColors): string | null {
  const spec = shadeSpec(shd, tc)
  if (!spec?.fg) return null
  const bg = spec.bg ?? shadingHex(shd, tc) ?? '#ffffff'
  return `${spec.pattern}|${spec.fg.replace('#', '')}|${bg.replace('#', '')}`
}

/** 图案档位名（给 warn 用）：clear/none/nil/缺省给空串 */
function patternVal(shd: XEl | undefined): string {
  const spec = shadeSpec(shd)
  return spec?.pattern ?? ''
}

/** 单元格边框四边 + 底纹 + 竖排对齐 → 一段内联 style（顺序固定，供结构测试直接比对） */
function cellStyleCss(
  tcPr: XEl | undefined,
  edges: { top?: string; bottom?: string; left?: string; right?: string },
  shadeCss: string | null,
): string {
  const bits: string[] = []
  for (const edge of CELL_EDGES) {
    const v = edges[edge]
    if (v) bits.push(`border-${edge}: ${v}`)
  }
  // 底纹可能是「背景一色」也可能是「背景 + background-image 图案」整段，原样接上（顺序固定）
  if (shadeCss) bits.push(shadeCss)
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
 * 一格的 w:tcW → 这一跨的总宽（px）：**只有 dxa（或没写 w:type）才是数字**。
 * auto/nil/未知型本来就是"没账"；nil 尤其容易被读出一枚假宽——它的 `w:w` 按规格常写 0，但第三方件里
 * 也带着旧数字（夹具 p_type_nil：Word 读 [60|90|120]＝声明的网格，旧码把 nil 的数字读成 75 磅）。
 * pct 不是没有基数，而是它的基数是**表宽**不是版心（第十一笔账 32 臂实测：`r_fix_dxa4513_uneven`
 * 表宽 225.65 磅时 pct 折宽对 Word 差 0.02 磅、折版心差 90.27 磅），而表宽在我们这里只在整盘宽度
 * 账都没说时才上账（第八笔账立着的那两扇门），所以 pct 落在门外＝账外。
 * 真件那侧同向：266 枚可读件里首行带 pct 的 30 枚表全为「缺 w:tblLayout × 有真数表宽」，pct 折宽离声明网格分两桶——
 * 19 枚 ≤1 磅（0.10–0.64，上不上账是 no-op）、11 枚差 2.08–65.28 磅；而 Word 能开的 6 枚件里 11 枚含首行 pct 的表
 * 有 10 枚读的就是声明的网格（0.00 磅）、1 枚读的是 pct 折出来的那档（0.32 磅）⇒ 折进来只会把前 10 枚推远。
 * nil 在这 266 枚里 0 命中（40196 枚 tcW），故此闸对真件可证不变。
 * 跨列格写的就是它跨的那几列之和，不是单列宽，所以这里只交回总数、由调用处去分账。
 */
function tcWpx(tcPr: XEl | undefined): number | null {
  const tcW = tcPr ? find(tcPr, 'w:tcW') : undefined
  if (!tcW) return null
  const type = (attr(tcW, 'w:type') ?? 'dxa').toLowerCase()
  if (type !== 'dxa') return null
  const v = attrNum(tcW, 'w')
  if (v === undefined || v <= 0) return null
  return Math.max(1, Math.round(v * TWIP_PX))
}

/**
 * 表级的 w:tblW → 整张表的宽（px）。auto/nil/0/没说都交回 null（那本来就是"没账"）。
 * pct 那一档的口径是五十分之一百分点（5000 = 100%），基数是版心宽：三臂实测
 * （tb_pct30_nogrid 3000 → Word 总宽 361.87px、tb_pct50_auto 与 tb_pct50_fixed 5000 → 603.07px，
 * 版心 601.73px）只有这一档撞得上，按"百分之几"折的那档全都差着一倍。
 * nil 那一档归入 auto（第十二笔账 b4 实测，37 臂）：带正数的 nil 在 Word 门面报 pwtype=1 pw=0.00，
 * 与 auto/没写/空字面/负数逐格同形（fixed 落 18.00 磅、autofit 与缺 layout 落 11.80 磅，两把内容重排尺），
 * 那枚 w 上的数字从不进账；规格外（w:type=foo）与缺 w:type 在表级 Word 复用数字（pwtype=3 pw=225.65 磅），
 * 所以这一层只把 nil 取出去、不设 dxa 白名单——方向与第十一笔账的格级闸相反。
 * w:w 还允许写成 "100%" 这种字面，且真件（含我们自己的写侧）把它落在带前缀的 w:w 属性名上——
 * 第十三笔账 b1 之前这一行只读无前缀的 w，那枚字面在真件上永远够不着（真件字节腿 b1：
 * 1154 表枚全带 tblW，百分号字面 0 枚），所以这一档只在自家写侧的往返与第三方件上兑现。
 * 两档口径不同、Word 门面各自说话（合并判据腿 b1，23 臂）：数值按五十分之一百分点
 * （2500 → pw=50、3000 → 60），字面按百分之几（"30%" → pw=30、"100%" → 100、"50%" → 50），
 * 按"百分之几"折字面这一档才撞得上（"100%" 两臂等严、总差 −0.05 磅，"30%"/"50%"/窄版心在松尺内）。
 * 字面只吃紧跟百分号的十进制："30 %" 在 Word 报 pw=0（无宽）故不上账，与 abc%/空/"0%"/"-10%" 同归账外。
 * 缺 w:type 而字面带百分号时 Word 仍推断成 pct（pw=30、45.2 磅）而我们按 dxa 落空——本轮不动。
 */
function tblWpx(tblPr: XEl | undefined, contentTw: number): number | null {
  const tblW = tblPr ? find(tblPr, 'w:tblW') : undefined
  if (!tblW) return null
  const type = (attr(tblW, 'w:type') ?? 'dxa').toLowerCase()
  if (type === 'auto' || type === 'nil') return null
  if (type === 'pct') {
    if (contentTw <= 0) return null
    const num = attrNum(tblW, 'w')
    const raw = attr(tblW, 'w') ?? attrL(tblW, 'w')
    let ratio: number | null = null
    if (num !== undefined) ratio = num / 5000
    else if (raw && /^-?\d+(?:\.\d+)?%$/.test(raw)) ratio = Number(raw.slice(0, -1)) / 100
    if (ratio === null || !(ratio > 0)) return null
    const px = Math.round(contentTw * ratio * TWIP_PX)
    return px > 0 ? px : null
  }
  const v = attrNum(tblW, 'w')
  if (v === undefined || v <= 0) return null
  return Math.max(1, Math.round(v * TWIP_PX))
}

/**
 * 版心宽（缇）：body 末尾 sectPr 的 pgSz 减左右页边距，两腿各自量出来的是同一枚
 * （字节腿 9026 缇 = 601.73px，Word 报 451.3 磅）。说不全给 0，pct 那一档就此没账。
 */
function contentTwipsOf(body: XEl): number {
  const sect = findDesc(body, 'w:sectPr')
  const pg = sect ? find(sect, 'w:pgSz') : undefined
  const mar = sect ? find(sect, 'w:pgMar') : undefined
  const w = attrNum(pg, 'w')
  const left = attrNum(mar, 'left')
  const right = attrNum(mar, 'right')
  if (w === undefined || left === undefined || right === undefined) return 0
  return w - left - right > 0 ? w - left - right : 0
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
 *
 * 条件块里 `w:tblPr/w:tblCellMar` 那一格也算这一层（第七笔账：表级 108 缇压得过它的 600，
 * 而它压得过样式基座说的 108），但它按型别作用域落、闸门跟着 `w:tblLook` 走，所以要逐格现取，
 * 见调用处 `condMarginsFor(..., 'tblMar')` 那一行——不在这一枚函数里，因为这枚不分位置。
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

// `w:tblLook` 上那四位闸门（LOOK_BITS）与三条型别梯子都在 table-cond 里定义一次：
// CSS 层（doc-style-css）与 ODT 出口（odt）按位置裁决时用的是同一批函数，三处不会各跑一套尊卑。

/**
 * 一块条件里说的格载荷：`w:tcPr` 那一格同时说格边距与格底纹（两族共用同一份"同型整块替换"的账），
 * `w:tblPr/w:tblCellMar` 那一格只说格边距，且它归的是样式那一层而不是条件那一层（见 styleCellMargins）
 */
type CondCell = {
  mar: Margins
  tblMar: Margins
  shd?: XEl
  borders?: Partial<Record<CellEdge, string>>
  rowHeightPx?: number
  rowHeightExact?: boolean
}

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
 * 一块条件里的两格都说格边距时是 **tcPr 那一格盖 tblPr 那一格**（sc_slot_top_vs_tcpr：同一块 tblPr 说 top 600
 * 缇而 tcPr 说 top 300 缇，位置尺读回 300 那一档，比只说 600 的那臂低 15.05 磅）；
 * `wholeTable` 那一型换哪一格写都不落（sa_slot_wholeTable 的左右仍是 Word 自带的 108 缇、sc_slot_top_whole 位移 0.00）。
 */
function styleCondCells(book: StyleBook, id: string | undefined, tc?: ThemeColors): Record<string, CondCell> {
  const out: Record<string, CondCell> = {}
  for (const s of styleChain(book, id)) {
    if (SUBSTITUTED_TABLE_STYLES.has(s.id)) continue
    for (const pr of s.tblStylePr ?? []) {
      const type = attr(pr, 'w:type')
      if (!type) continue
      const tcPr = find(pr, 'w:tcPr')
      const prTbl = find(pr, 'w:tblPr')
      const mar = marginsOf(find(tcPr, 'w:tcMar'))
      const tblMar = marginsOf(prTbl ? find(prTbl, 'w:tblCellMar') : undefined)
      const shd = find(tcPr, 'w:shd')
      // 条件格边框（v0.117）：`w:tcBorders` 也住 `w:tcPr` 内
      const bcRaw = borderEdges(find(tcPr, 'w:tcBorders'), tc)
      const borders: Partial<Record<CellEdge, string>> = {}
      for (const e of CELL_EDGES) {
        const v = bcRaw[e]
        if (v) borders[e] = v
      }
      // 条件行高（v0.117）：`w:trPr`/`w:trHeight` 是这枚条件块的兄弟节点
      const trPr = find(pr, 'w:trPr')
      const thEl = trPr ? find(trPr, 'w:trHeight') : undefined
      const thv = attrNum(thEl, 'w:val')
      const thExact = (attr(thEl, 'w:hRule') ?? 'atLeast').toLowerCase() === 'exact'
      if (
        Object.keys(mar).length ||
        Object.keys(tblMar).length ||
        shd ||
        Object.keys(borders).length ||
        thv !== undefined
      ) {
        const k = asTableCondType(type)
        if (k)
          out[k] = {
            mar,
            tblMar,
            shd,
            ...(Object.keys(borders).length ? { borders } : {}),
            ...(thv !== undefined && thv > 0
              ? { rowHeightPx: px2(thv * TWIP_PX), rowHeightExact: thExact }
              : {}),
          }
      }
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
 * 这一格的条件层账：行型按行落，列型按全表落，**角型也按行落而不按那一角**。
 *
 * 首列/末列那两型的 tcMar 在 Word 眼里落到**全表每一格**（g_firstCol 的 22px、g_lastCol 的 34px
 * 在九枚格上分毫不差），而同一个闸门同一个型换成 `w:rPr` 载荷时才是真按列落
 * （q_bold_firstCol_L3：加粗只出现在每行第 0 格）——这是边距这一族在 Word 里的形状，不是列作用域。
 * 角型换到边距这一族同样不按位置：sb_nw_all_on 的 left 落在第 0 行三枚格（各 30 磅）而第 1、2 行九枚里全 0，
 * ne 落首行的右边距、sw/se 落末行整行（sb_ne_all_on / sb_sw_all_on / sb_se_all_on）——
 * 与底纹那一族「只落那一角那一格」（u1）不是一种形状，两族的梯子也不同序（见 condShadingFor）。
 * 闸门要那一角的两枚位都开：sb_nw_fr_only（缺 firstColumn）与 sb_nw_fc_only（缺 firstRow）两臂九枚格全 0。
 * 撞车时的次序按型别而与**声明次序无关**：nw 与 firstRow 各说 left 600/300 缇，正反两序（sb_nw_vs_firstRow /
 * sb_firstrow_then_nw）都落 firstRow 那档 15 磅；nw 与 firstCol 各说 600/900，正反两序都落「第 0 行 30 磅、
 * 其余行 45 磅」；sw 与 lastRow 两序都落 lastRow 那档——所以梯子是 行型 > 角型 > 列型。
 * 三型同说而把 nw 写在最末（sb_nw_declared_last）仍落 firstRow 与 firstCol 的数，角型一次没赢。
 * 末列压首列、单行既是首行又是末行时首行赢沿用上一轮读数（r_rowcol_same_edge / r_one_row_first_last）。
 * 同一行里两枚角型说同一枚边（nw 说 right、ne 也说 right）没有实测，本序按后入的 necell 取，记为未量档。
 */
function condMarginsFor(
  look: Record<string, boolean>,
  conds: Record<string, CondCell>,
  ri: number,
  isLastRow: boolean,
  key: 'mar' | 'tblMar',
): Margins {
  const out: Margins = {}
  // 共享梯子从高到低排，故逐边「先到先得」（原来是从低到高、整块后写覆盖，两者逐边等价）
  for (const t of condLadderMargin(look, ri, isLastRow)) {
    const m = conds[t]?.[key]
    if (!m) continue
    for (const e of CELL_EDGES) {
      const v = m[e]
      if (v !== undefined && out[e] === undefined) out[e] = v
    }
  }
  return out
}

/**
 * 这一格的条件层边框：与底纹同一族——**真按位置**落（首列只落第 0 列、首行只落第 0 行、四角只落那一角），
 * 跟上面那族格边距"列型铺满全表"不是一种作用域。
 * 逐边取一：梯子先说话的那一型把某条边定了，后面同边的型就改不动——角型在最前，于是角格的边框压住行型与列型。
 * 不同边互不 related（首行说 bottom、首列说 left，两枚各落各的）。
 */
function condBordersFor(
  look: Record<string, boolean>,
  conds: Record<string, CondCell>,
  ri: number,
  isLastRow: boolean,
  gc: number,
  colspan: number,
  cols: number,
): Partial<Record<string, string>> {
  const ladder = condLadderAppearance(look, ri, isLastRow, gc, colspan, cols)
  const out: Record<string, string> = {}
  for (const t of ladder) {
    const b = conds[t]?.borders
    if (!b) continue
    for (const e of CELL_EDGES) {
      const v = b[e]
      if (v && out[e] === undefined) out[e] = v
    }
  }
  return out
}

/**
 * 这一行吃条件层的哪枚行高：只有行型条件（band*Horz / firstRow / lastRow）带行高，
 * 且行型间尊卑是 firstRow > lastRow > band（与底纹行型那序一致）——同一行既踩 band 又踩首行时首行赢。
 * 直接写在行上的 `w:trHeight` 优先于这里（调用处先认 direct 再认条件），所以这里只在没 direct 时上场。
 */
function condRowHeightFor(
  look: Record<string, boolean>,
  conds: Record<string, CondCell>,
  ri: number,
  isLastRow: boolean,
): { px: number; exact: boolean } | undefined {
  const ladder = condLadderRowHeight(look, ri, isLastRow)
  for (const t of ladder) {
    const c = conds[t]
    if (c?.rowHeightPx !== undefined) return { px: c.rowHeightPx, exact: !!c.rowHeightExact }
  }
  return undefined
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
 * 注意这一条梯子与边距那族**是反的**：边距里行型压角型、角型压列型（见 condMarginsFor），底纹里角型压一切——
 * 两族各自的序都是按自己那一族量出来的，不是一条通用梯子，别把它当成不一致去"统一"。
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
  const ladder = condLadderAppearance(look, ri, isLastRow, gc, colspan, cols)
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
  // 主题字体（v0.138）：Normal 与各级标题只写 asciiTheme 一类引用，解析不了整篇掉回默认字体
  const themeXml = await read('word/theme/theme1.xml')
  const theme = readTheme(themeXml)
  // 主题色（v0.142）：与字体同读一份 theme1.xml，clrScheme 住 fontScheme 旁边
  const themeColors = readThemeColors(themeXml)
  const numbering = readNumbering(await read('word/numbering.xml'), theme)
  const f = new Fidelity(readStyles(await read('word/styles.xml'), theme), numbering, depth, theme, themeColors)
  // 编号定义的多级身份（v0.145）：multiLevelType 描述「这份定义是否设计成多级联动」，
  // 而模型把编号定义塌成逐段档位（ListRegistry 按段引用重建），这个身份带不回来——
  // 每种类型记一条（不逐实例刷屏）
  f.noteNumberingIdentity(numbering.multiLevels.values())
  f.load(zip)
  f.setRels(await read('word/_rels/document.xml.rels'))
  f.setNotes(await read('word/footnotes.xml'), await read('word/endnotes.xml'))
  f.setComments(await read('word/comments.xml'), await read('word/commentsExtended.xml'))
  const { html, blocks } = await f.run(documentXml)
  // 节属性（v0.147）：body 末尾 sectPr 走 attr 漏斗读一遍。这一族原本是 docxToDocMeta
  // 用正则读的（正则不进漏斗，保真账本上是盲区——读是读了，账上没有）；改由读手读、
  // 随 DocxImport 出来后调用方折成 PageSetup，同一份数只有一个读数出处
  const section = sectionOf(parseXml(documentXml))
  return {
    html,
    comments: f.comments,
    blocks,
    warnings: f.warningList(),
    styles: f.styleList(),
    ...(f.latentStyles ? { latentStyles: f.latentStyles } : {}),
    ...(section ? { section } : {}),
  }
}

/**
 * 节属性原文（v0.147）：body 末尾 `w:sectPr` 的 pgSz/pgMar/cols/docGrid，单位仍是缇。
 * 值域不做裁剪（pgSz/@w:orient 只认 portrait/landscape，docGrid/@w:type 原样带）。
 */
function sectionOf(doc: XEl | undefined): DocxSection | undefined {
  if (!doc) return undefined
  // parseXml 出来的是 #doc 壳（真正的根元素在它下面一层），故这里走 findDesc
  const body = findDesc(doc, 'w:body')
  const sect = body ? find(body, 'w:sectPr') : undefined
  if (!sect) return undefined
  const out: DocxSection = {}
  const pg = find(sect, 'w:pgSz')
  if (pg) {
    const w = attrNum(pg, 'w')
    if (w !== undefined) out.w = w
    const h = attrNum(pg, 'h')
    if (h !== undefined) out.h = h
    const o = (attr(pg, 'w:orient') ?? '').toLowerCase()
    if (o === 'landscape' || o === 'portrait') out.orient = o
  }
  const mar = find(sect, 'w:pgMar')
  if (mar) {
    const m: NonNullable<DocxSection['margin']> = {}
    for (const k of ['top', 'right', 'bottom', 'left', 'header', 'footer', 'gutter'] as const) {
      const v = attrNum(mar, `w:${k}`)
      if (v !== undefined) m[k] = v
    }
    if (Object.keys(m).length) out.margin = m
  }
  const cols = find(sect, 'w:cols')
  if (cols) {
    const n = attrNum(cols, 'w:num')
    if (n !== undefined) out.cols = n
    const sp = attrNum(cols, 'w:space')
    if (sp !== undefined) out.colGap = sp
  }
  const grid = find(sect, 'w:docGrid')
  if (grid) {
    const g: NonNullable<DocxSection['docGrid']> = {}
    const t = attr(grid, 'w:type')
    if (t) g.type = t
    const lp = attrNum(grid, 'w:linePitch')
    if (lp !== undefined) g.linePitch = lp
    if (Object.keys(g).length) out.docGrid = g
  }
  return Object.keys(out).length ? out : undefined
}
