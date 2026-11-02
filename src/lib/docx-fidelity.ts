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
import { BDR_ATTR, CELL_EDGES, PBAR_ATTR, PBDR_ATTR, CNF_ATTR, CNF_KEYS, CSS_BORDER_STYLE, FRAME_NUMERIC_KEYS, FRAME_STR_KEYS, IMG_ATTR, PPR_ATTR, PPR_IND_KEYS, PPR_ONOFF_KEYS, PPR_STR_KEYS, SHD_ATTR, TAB_LEADERS, TBLB_ATTR, TBLB_EDGES, TBLB_KEYS, TBLPR_ATTR, TLOOK_ATTR, bdSpaceAttrs, bdrPayload, borderParts, cnfPayload, eighthsToPx, framePayload, imgPayload, pprPayload, ptToPx, rgb2hex, shadeCss, shdPayloadOf, tblbPayload, tblpPayload, tblPrPayload, tabsPayload, tlookPayload, pbdrPayload, type BdrOrigin, type CellEdge, type CnfPayload, type FramePayload, type ImgPayload, type PprPayload, type ShdPayload, type TabSpec, type TblbPayload, type TblpPayload } from './cell-style'
import { ooxmlLine } from './paragraph-style'
import {
  asTableCondType,
  type DocComment,
  type DocxLsdException,
  type DocxLatentStyles,
  type DocxLvlMeta,
  type DocxAbstractNumMeta,
  type DocxNumbering,
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
  /**
   * 文档背景（v0.155）：`w:background` 三枚（字面色 / 主题槽 / 主题深浅）。
   * 屏上兑现在外层容器的 background-color，导出回到 document 根——真双向
   */
  background?: DocBackground
  /**
   * 编号定义账（v0.150）：每份 `w:abstractNum` 的 nsid/tmpl/multiLevelType，加逐层的
   * tentative/tplc/suff。屏上一条都不兑现（列表是 ListRegistry 按段重建的），只随 meta
   * 往返——导出时按出现序补丁回 numbering.xml
   */
  numbering?: DocxNumbering
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
   * 样式身份两枚（v0.150）：`w:next` 是后续段落样式（标题里回车落到它身上），
   * `w:rsid` 是这份定义最后被改的修订会话号。屏上零兑现，只随快照往返
   */
  next?: string
  rsid?: string
  /**
   * 样式别名（v0.155）：`w:aliases/@w:val`，逗号分隔。Word 里样式的中文名常挂这儿
   * （id 是英文、面板上显示中文）。屏上零兑现，只随快照往返
   */
  aliases?: string
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
/**
 * onOff 三态：值不在值域里（含「元素在场而属性缺省」）一律 undefined，
 * 好让「显式关」与「没写」分得开（v0.146 起 latentStyles 那族就靠这个分档）。
 * 值域是 CT_OnOff（1/0/true/false/on/off）与 VML 的 ST_TrueFalse（t/f/true/false）
 * 的并集——两者不重叠，VML 那一支（v0.149）跟着一起收
 */
function onOff(v: string | undefined): boolean | undefined {
  const s = (v ?? '').toLowerCase()
  if (s === '1' || s === 'true' || s === 'on' || s === 't') return true
  if (s === '0' || s === 'false' || s === 'off' || s === 'f') return false
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
  // 部件根上的 mc:Ignorable（v0.152）：声明「这一部件里哪些命名空间的扩展可以安全
  // 忽略」。读手没有任何路径碰它（兼容分支不进分发、根属性没人读），与 document 根上
  // 那一枚同款：在跑样式前先按名查问一遍，只记账
  attrL(styles, 'Ignorable')
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
    // 样式身份两枚（v0.150）：next 是「回车后接着用哪个样式」（Word 的后续段落样式，
    // 它决定在标题样式里回车落到的下一段是什么样式），rsid 是这份定义最后被谁改过的
    // 修订会话号。两枚都不改屏上排版——next 的产品语义（回车行为）编辑器没接，rsid
    // 是流水号；但都随 meta 往返，丢了会让 Word 的样式继承链对不上
    const nxt = val(s, 'w:next')
    if (nxt) info.next = nxt
    const rsid = val(s, 'w:rsid')
    if (rsid) info.rsid = rsid
    // 别名（v0.155）：`w:aliases` 是这份样式的「也叫什么」（Word 里给样式起的中文名
    // 就住这儿，逗号分隔）。屏上不兑现——排版用它靠的是 id，与名字无关；但它随 meta
    // 往返，丢了 Word 的样式面板里就只剩英文名
    const ali = val(s, 'w:aliases')
    if (ali) info.aliases = ali
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

/** 样式元数据三枚（v0.146）+ 样式身份两枚（v0.150）+ 别名（v0.155）→ 快照字段；没说的不挂，与旧字节一致 */
function styleMetaOf(
  info: StyleInfo,
): Pick<DocxStyleInfo, 'uiPriority' | 'link' | 'customStyle' | 'next' | 'rsid' | 'aliases'> {
  return {
    ...(info.uiPriority !== undefined ? { uiPriority: info.uiPriority } : {}),
    ...(info.link ? { link: info.link } : {}),
    ...(info.customStyle !== undefined ? { customStyle: info.customStyle } : {}),
    ...(info.next ? { next: info.next } : {}),
    ...(info.rsid ? { rsid: info.rsid } : {}),
    ...(info.aliases ? { aliases: info.aliases } : {}),
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
 * 表级条件格式尺寸（v0.152）：`w:tblPr` 的 `w:tblStyleRowBandSize` /
 * `w:tblStyleColBandSize` 两枚元素 → `colBand=…;rowBand=…`。屏上不兑现
 * （隔行/隔列底纹的落点账不在我们模型里），只随 data-tblpr 往返。
 * 与 tlook 同住 tblPr、同一条补丁路数（写侧没有库槽）
 */
/**
 * 表条件格式的落点开关（v0.162）：`w:tblPr/w:cnfStyle` 十三枚 → data-cnf 定序格串。
 *
 * 此前这一族是**纯只读记账**（`noteCnfStyleMarks` 整树按名查问，一个数也不落地）；
 * 记账管的是保真账本那一本（「读手查问过哪些对」），这一趟管的是往返账（「回不回得来」）。
 * 两趟并存、各记各的：整树扫继续负责 tcPr 里那些格级 cnfStyle 的查问（格级没有往返通道，
 * 只有表级有），表级这一枚由这里读进载荷。
 *
 * 十三枚全用 attrL 查问（与 noteCnfStyleMarks 同一枚漏斗，分子不增不减）。
 */
/**
 * `w:tblPr/w:tblBorders` 六边的**原值**（v0.163）→ data-tblb 载荷。
 *
 * 七枚都按名查问、原值照带，一条也不解析：屏上那一半（格边 padding）由 `edgeCss` /
 * `edgeSpacePx` 那一趟负责，这一趟只管**源件在表级写过什么**。两趟同读一批属性名，
 * 但记的是两本账——保真账要的是「查问过」，往返账要的是「值回来了」。
 */
function readTblbPayload(tblBorders: XEl | undefined): string {
  if (!tblBorders) return ''
  const p: TblbPayload = {}
  for (const e of TBLB_EDGES) {
    const el = find(tblBorders, `w:${e}`)
    if (!el) continue
    const kv: Partial<Record<(typeof TBLB_KEYS)[number], string>> = {}
    for (const k of ['val', 'sz', 'color', 'space'] as const) {
      const v = attr(el, `w:${k}`)
      if (v) kv[k] = v.trim()
    }
    // 主题三枚：themeRefParts 恒查问（与 w:color 同款「查问与解析解耦」），
    // 这里要的是引用名本身而不是解析出来的 hex——解析值回不去包，只有原值回得去
    const t = themeRefParts(el)
    if (t.ref) kv.themeColor = t.ref
    if (t.tint) kv.themeTint = t.tint
    if (t.shade) kv.themeShade = t.shade
    if (Object.keys(kv).length) p[e] = kv
  }
  return tblbPayload(p)
}

function readCnfPayload(tblPr: XEl | undefined): string {
  if (!tblPr) return ''
  const el = find(tblPr, 'w:cnfStyle')
  if (!el) return ''
  const kv: CnfPayload = {}
  for (const k of CNF_KEYS) {
    const raw = attrL(el, `w:${k}`)
    if (raw === undefined || raw === '') continue
    // ST_OnOff 归一成 0/1：真件里 `true`/`on`/`1` 是同一件事，而载荷只有一种口径。
    // val 是 12 位位串，不参与这层归一（parseCnfPayload 那里再校验形状）
    if (k === 'val') kv.val = raw
    else {
      const s = raw.trim().toLowerCase()
      kv[k] = s === '0' || s === 'false' || s === 'off' ? '0' : '1'
    }
  }
  return cnfPayload(kv)
}

function readTblPrPayload(tblPr: XEl | undefined): string {
  if (!tblPr) return ''
  const kv: Record<string, string> = {}
  const col = valNum(tblPr, 'w:tblStyleColBandSize')
  if (col !== undefined) kv.colBand = String(col)
  const row = valNum(tblPr, 'w:tblStyleRowBandSize')
  if (row !== undefined) kv.rowBand = String(row)
  // 单元格间距（v0.154）：w 是缇（dxa 档），type 记原档位（写侧原样发回）。
  // 同一标签多枚元素按出现序取首个非空——与 table() 里屏上那一半同一口径
  for (const sp of all(tblPr, 'w:tblCellSpacing')) {
    if (kv.cellSp === undefined) {
      const v = attrNum(sp, 'w')
      if (v !== undefined) kv.cellSp = String(v)
    }
    if (!kv.cellSpType) {
      const t = (attr(sp, 'w:type') ?? '').toLowerCase()
      if (t) kv.cellSpType = t
    }
  }
  return tblPrPayload(kv)
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
  // v0.160：缩进的字符档两枚。`w:ind` 在 pPr 上是**一枚元素多个属性**，所以走带前缀的
  // 载荷键（不占 PPR_ONOFF_KEYS/STR_KEYS 那套「一枚属性一个元素」的通道）。只收整数：
  // 这两枚是百分之一字符数，Word 只写整数；脏值整键丢（比写回一个 Word 认不得的数好）
  const indEl = find(pPr, 'w:ind')
  if (indEl) {
    for (const k of PPR_IND_KEYS) {
      const v = attr(indEl, `w:${k}`)
      if (v && /^-?\d+$/.test(v)) kv[`ind${k[0].toUpperCase()}${k.slice(1)}`] = v
    }
  }
  return pprPayload(kv)
}

/**
 * VML 裁剪值 → CSS inset 的百分比数（v0.153）。
 *
 * VML 的 croptop 之类是 ST_Fraction：0..1 的小数（0.1 = 裁掉 10%），Word 也发 "10%"
 * 这种带百分号的串。CSS 的 clip-path:inset() 收百分比，两边只差一个「小数还是百分数」
 * 的换算。认不出来（空串、非数字）返回 undefined，调用方按「这一边没裁」处理。
 */
/**
 * 图片裁剪 → CSS `clip-path: inset()`（v0.154）。
 *
 * 两代写法裁的是同一件事：老式件的 `v:imagedata` 用 croptop/right/bottom/left（ST_Fraction，
 * 0..1 的小数或 `"5%"` 串），新式件的 `a:srcRect` 用 t/r/b/l（ST_Percentage，**千分比**
 * 整数：25000 = 25%）。序都是 上/右/下/左，与 CSS inset 一致，只差换算。
 * 两族都在时按 VML 那一族（Word 的兼容落法里老式值才是它真用的那一套）。
 *
 * 都在 `w:drawing`/`w:pict` 子树里按元素名深找：crop 只认 `v:imagedata`（a:blip 没有
 * 这组属性，问了就是假账），srcRect 只认 `a:srcRect`。
 */
function imgClipCss(el: XEl): string {
  const vml = findDesc(el, 'imagedata')
  const crop = (['croptop', 'cropright', 'cropbottom', 'cropleft'] as const).map((n) => cropPct(attrL(vml, n)))
  if (crop.some((v) => v)) return `clip-path:inset(${crop.map((v) => v ?? 0).join('% ')}%)`
  const srs = allDesc(el, 'srcRect')
  if (!srs.length) return ''
  const box = (['t', 'r', 'b', 'l'] as const).map((n) => {
    for (const s of srs) {
      const raw = attrL(s, n)
      if (raw === undefined || !raw.trim()) continue
      const v = Number(raw)
      if (Number.isFinite(v)) return Math.max(0, Math.min(100, v / 1000))
    }
    return undefined
  })
  if (!box.some((v) => v)) return ''
  return `clip-path:inset(${box.map((v) => v ?? 0).join('% ')}%)`
}

/**
 * 图形变换 → CSS `transform`（v0.155）：`a:xfrm` 的 rot（**六万分之一度**，Word 的角度
 * 单位）与 flipH/flipV（水平/垂直翻转，0/1）。CSS 的 rotate 收度、scaleX/scaleY(-1)
 * 收翻转，两边只差一个换算。三枚都是 0/无值时不发 style（旋转 0 度与不旋转同结果，
 * 显式写出来只会给每张图挂一句空声明）。
 *
 * **单边**：写侧只发 DrawingML 内嵌图，翻转与旋转都写不回——导出去的图是正的。
 * 与裁剪同款（读得进、写不出），如实记在审计里。
 */
function imgTransformCss(el: XEl): string {
  const xfrm = findDesc(el, 'xfrm')
  if (!xfrm) return ''
  const raw = attrL(xfrm, 'rot')
  const flipH = attrL(xfrm, 'flipH')
  const flipV = attrL(xfrm, 'flipV')
  const out: string[] = []
  const r = raw ? Number(raw) : 0
  if (Number.isFinite(r) && r !== 0) out.push(`rotate(${Math.round((r / 60000) * 100) / 100}deg)`)
  if (flipH === '1') out.push('scaleX(-1)')
  if (flipV === '1') out.push('scaleY(-1)')
  return out.length ? `transform:${out.join(' ')}` : ''
}

function cropPct(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  if (!s) return undefined
  const isPct = s.endsWith('%')
  const n = Number(isPct ? s.slice(0, -1) : s)
  if (!Number.isFinite(n)) return undefined
  // 小数档按分数换算（1 = 全裁），已是百分号档直接用；两端夹住防 CSS 越界
  return Math.max(0, Math.min(100, isPct ? n : n <= 1 ? n * 100 : n))
}

/**
 * 图片容器壳（v0.148）：一个 w:drawing 里除位图字节与尺寸外那一层壳——wp:inline/
 * wp:anchor 的四边避让与锚点、wp:effectExtent 四边、两处对象序号与对象名、两枚
 * locks、a:prstGeom 的档位、a:xfrm 的 a:off/a:ext。屏上一条都不兑现（Web 流式排版
 * 没有文字环绕与对象名，图片框恒矩形），但换编辑器打开时它决定图贴在哪个锚上。
 * 全部走 findDesc 深搜：壳各层的层级是固定的，深搜找同名元素不会认错（一个
 * w:drawing 里只有一枚 wp:inline、一枚 pic:pic）。EMU 档存整数原值——width/height
 * 那一道 EMU→px 只在尺寸上做过，这里要的是能原样写回去的数。
 */
function readImgPayload(el: XEl): string {
  const kv: ImgPayload = {}
  // wp:inline（内嵌）/ wp:anchor（浮动）各有四边避让；两者同名元素不同名，各查各的
  const inline = findDesc(el, 'inline')
  const anchor = findDesc(el, 'anchor')
  const box = inline ?? anchor
  if (box) {
    for (const k of ['distT', 'distB', 'distL', 'distR']) {
      const v = attrNum(box, k)
      if (v !== undefined) kv[k] = String(v)
    }
  }
  // wp:effectExtent：四边（Word 用它算阴影/发光占的溢出区，屏上不兑现）
  const ee = findDesc(el, 'effectExtent')
  if (ee) {
    for (const [k, n] of [['eeL', 'l'], ['eeT', 't'], ['eeR', 'r'], ['eeB', 'b']] as const) {
      const v = attrNum(ee, n)
      if (v !== undefined) kv[k] = String(v)
    }
  }
  // wp:docPr（画布级）与 pic:cNvPr（图形级）各有 id/name；name 那边读手已用 descr 优先
  // 取过 alt，这里收的是对象名本身。两处 id 都是整数、都只查一次（不用 ?? 短路——
  // 右支不求值会让后一枚永远不进探针账）
  const docPr = findDesc(el, 'docPr')
  const docPrId = attrNum(docPr, 'id')
  if (docPrId !== undefined) kv.docPrId = String(docPrId)
  // 画布级对象名（v0.158）：descr 是替代文本、name 是对象名，两码事。写手那一侧把 alt
  // 同时塞进 name 与 descr，源里的对象名（「图片 1」）就被替代文本顶掉了——对象名在
  // Word 的选择窗格与定位里是要用的，得单存一份带回去
  const docPrName = attr(docPr, 'name')
  if (docPrName) kv.docPrName = docPrName
  const cNvPr = findDesc(el, 'cNvPr')
  const cNvPrId = attrNum(cNvPr, 'id')
  if (cNvPrId !== undefined) kv.cNvPrId = String(cNvPrId)
  const cNvPrName = attr(cNvPr, 'name')
  if (cNvPrName) kv.cNvPrName = cNvPrName
  // 图形级替代文本（v0.158）：与画布级那枚 descr 是两枚不同的属性（读手取 alt 时才把它们
  // 当主次），写手只发画布级，图形级这一枚就整条没了。单存一份
  const cNvPrDescr = attr(cNvPr, 'descr')
  if (cNvPrDescr) kv.cNvPrDescr = cNvPrDescr
  // 两枚 locks：锁纵横比。onOff 三态（元素在场无 val 按「开」）
  const gfl = onOff(attrL(findDesc(el, 'graphicFrameLocks'), 'noChangeAspect'))
  if (gfl !== undefined) kv.gfl = gfl ? '1' : '0'
  const picLock = onOff(attrL(findDesc(el, 'picLocks'), 'noChangeAspect'))
  if (picLock !== undefined) kv.pic = picLock ? '1' : '0'
  // a:prstGeom：图片的图形框恒 rect，换了档位的（裁剪成异形）照收原值
  const prst = attr(findDesc(el, 'prstGeom'), 'prst')
  if (prst) kv.prst = prst
  // wp:anchor 的定位：simplePos（绝对坐标）与 positionH/V（相对哪个基准）
  const sp = findDesc(el, 'simplePos')
  if (sp) {
    const x = attrNum(sp, 'x')
    const y = attrNum(sp, 'y')
    if (x !== undefined) kv.spX = String(x)
    if (y !== undefined) kv.spY = String(y)
  }
  for (const [k, n] of [['posH', 'positionH'], ['posV', 'positionV']] as const) {
    const v = attr(findDesc(el, n), 'relativeFrom')
    if (v) kv[k] = v
  }
  // a:xfrm 的 a:off / a:ext：图形框自身的原点与尺寸（与 wp:extent 不同一枚元素，
  // 图片的两者同值，但换编辑器打开时只认 xfrm 那一枚）
  const xfrm = findDesc(el, 'xfrm')
  if (xfrm) {
    const off = find(xfrm, 'off') ?? findDesc(xfrm, 'off')
    const ext = find(xfrm, 'ext') ?? findDesc(xfrm, 'ext')
    for (const [k, src, n] of [['offX', off, 'x'], ['offY', off, 'y'], ['extCx', ext, 'cx'], ['extCy', ext, 'cy']] as const) {
      const v = attrNum(src, n)
      if (v !== undefined) kv[k] = String(v)
    }
  }
  // a:picLocks 的箭头锁（v0.149）：与纵横比锁同一枚元素，包两个属性都发，都能写回
  const arrow = onOff(attr(findDesc(el, 'picLocks'), 'noChangeArrowheads'))
  if (arrow !== undefined) kv.picArrow = arrow ? '1' : '0'
  // pic:spPr 的 bwMode（黑白模式档位）。spPr 可能套两层（pic:spPr 里再嵌一枚
  // a:spPr，VML↔DrawingML 互转的老文件里常见），全查一遍取第一枚说得上话的
  for (const sp of allDesc(el, 'spPr')) {
    const v = attr(sp, 'bwMode')
    if (v && kv.bwMode === undefined) kv.bwMode = v
  }
  // wp:anchor 六枚闸门（v0.149）：allowOverlap / behindDoc / layoutInCell / locked /
  // relativeHeight / simplePos。与 dist 四边同一枚元素，但只有浮动图才有——写侧只发
  // 内嵌图（包没有 wp:anchor 的槽），这一组只读不写（与 simplePos/positionH/V 同款）
  const anchorEl = findDesc(el, 'anchor')
  if (anchorEl) {
    for (const [k, n] of [
      ['anOver', 'allowOverlap'],
      ['anBehind', 'behindDoc'],
      ['anCell', 'layoutInCell'],
      ['anLocked', 'locked'],
      ['anRelH', 'relativeHeight'],
      ['anSimple', 'simplePos'],
    ] as const) {
      const v = onOff(attr(anchorEl, n))
      if (v !== undefined) kv[k] = v ? '1' : '0'
    }
  }
  // wp:inline 的两个流水号（v0.150）：anchorId 与 editId。Word 给内嵌图也发（锚点序号与
  // 编辑会话号），与 dist 四边同一枚元素——只读不写（包不认这两个槽）
  if (box) {
    const anId = attr(box, 'anchorId')
    if (anId !== undefined) kv.anId = anId
    const anEdit = attr(box, 'editId')
    if (anEdit !== undefined) kv.anEdit = anEdit
  }
  // a:blip 的 cstate（v0.150）：「只在打印时出图」那档。与 r:embed 同一枚元素
  const cstate = attrL(findDesc(el, 'blip'), 'cstate')
  if (cstate) kv.blipState = cstate
  // a:ext 的 uri（v0.150）：扩展点身份（a:ext 是 extLst 的条目，xfrm 里那枚同名元素没有 uri，
  // 所以全查一遍取第一枚说得上话的——与 bwMode 查 spPr 同款纪律）
  for (const e of allDesc(el, 'ext')) {
    const u = attrL(e, 'uri')
    if (u && kv.extUri === undefined) kv.extUri = u
  }
  // a:lumMod 的亮度调制（v0.150）：主题色的明度档位（schemeClr 的子元素），
  // 只记第一枚——同一枚填充里多档 lumMod/lumOff 串联时第一枚就是基准
  const lumMod = attrL(findDesc(el, 'lumMod'), 'val')
  if (lumMod) kv.lumModV = lumMod
  // a:lumOff 的明度偏移（v0.151）：与 lumMod 同住 schemeClr 里的明度档位，同款只记第一枚
  const lumOff = attrL(findDesc(el, 'lumOff'), 'val')
  if (lumOff) kv.lumOffV = lumOff
  // a:schemeClr 的主题色槽位（v0.151）：val 是槽位名（accent1/lt1/…），fill/line/effect
  // 三处的引用都长这样。全查一遍取第一枚说得上话的——与 bwMode 查 spPr 同款纪律。
  // 这是宇宙里最大的一枚单对（7668 字面）：屏上不兑现（Web 没有主题色概念），
  // 写侧也写不出（包不发 schemeClr）——只记账
  for (const sc of allDesc(el, 'schemeClr')) {
    const v = attrL(sc, 'val')
    if (v && kv.shClr === undefined) kv.shClr = v
  }
  // a:miter 的斜接限制（v0.151）：描边折角的斜接长度上限，EMU。a:ln 的子元素
  const miterLim = attrL(findDesc(el, 'miter'), 'lim')
  if (miterLim) kv.miterLim = miterLim
  // a:lum 的亮度/对比度（v0.152）：schemeClr 里的明暗两档（与 lumMod/lumOff 同住），
  // 两枚属性各查各的——bright 是亮度偏移、contrast 是对比度偏移，百分比
  {
    const lum = findDesc(el, 'lum')
    if (lum) {
      const br = attrL(lum, 'bright')
      if (br) kv.lumBright = br
      const ct = attrL(lum, 'contrast')
      if (ct) kv.lumContrast = ct
    }
  }
  // a:shade 的阴影档位（v0.152）：schemeClr 的压暗系数（与 lumMod 同族的另一枚）。
  // 注意与 w:shd（段落/单元格底纹）不是一枚——那一族的 val 早就由 shadeSpec 读着
  const shadeV = attrL(findDesc(el, 'shade'), 'val')
  if (shadeV) kv.shadeV = shadeV
  // a:gs 的色标位置（v0.152）：渐变色标在色带上的位置（千分比）。只记第一枚——
  // 一条 gradFill 里常有好几枚 gs，位置序列说明渐变形状，全挂撑爆 HTML
  {
    const gs = findDesc(el, 'gs')
    if (gs) {
      const pos = attrL(gs, 'pos')
      if (pos) kv.gsPos = pos
    }
  }
  // a:ln 的线宽（v0.150）：spPr 下的描边宽度，EMU。全查一遍（与 bwMode 同款）
  for (const l of allDesc(el, 'ln')) {
    const w = attrL(l, 'w')
    if (w && kv.lnW === undefined) kv.lnW = w
    // a:ln 的线端与复合线型（v0.152）：cap（flat/square/round）与 cmpd（sng/dbl/…）。
    // 与 w 同住 a:ln 上，同一条循环里顺手查
    const cap = attrL(l, 'cap')
    if (cap && kv.lnCap === undefined) kv.lnCap = cap
    const cmpd = attrL(l, 'cmpd')
    if (cmpd && kv.lnCmpd === undefined) kv.lnCmpd = cmpd
  }
  // ── VML 壳（v0.149）：w:pict 那一支。位图字节在 v:imagedata 里，其余壳属性屏上
  //    一条都不兑现；写侧只发 DrawingML 内嵌图，这一族读得回、写不出（记账边界）──
  const shape = findDesc(el, 'shape')
  if (shape) {
    for (const [k, n, isOn] of [
      ['shId', 'id', false],
      ['shSpid', 'spid', false],
      ['shSpt', 'spt', false],
      ['shType', 'type', false],
      ['shCoord', 'coordsize', false],
      ['shFill', 'filled', true],
      ['shStroke', 'stroked', true],
    ] as const) {
      // VML 属性常带 o: 前缀（o:title、o:lock 之类），一律按 local name 取
      if (isOn) {
        const v = onOff(attrL(shape, n))
        if (v !== undefined) kv[k] = v ? '1' : '0'
      } else {
        const v = attrL(shape, n)
        if (v) kv[k] = v
      }
    }
    // gfxdata（7 字面）**裁定不收**：Word 缓存的图元字节（base64），能有几 KB，
    // 挂进 HTML 属性性价比极差，且写侧根本写不回去——与 t|space 同款裁定
    //
    // shape 身份两枚（v0.150）：path 是 Word 缓存的图元路径串（没装字体时靠它画出异形），
    // fillcolor 是填充底色。都是 shape 身上的字符串属性，只读不写
    const shPath = attrL(shape, 'path')
    if (shPath) kv.shPath = shPath
    const shFillColor = attrL(shape, 'fillcolor')
    if (shFillColor) kv.shFillColor = shFillColor
    // 图元几何族（v0.150）：v:gd（公式）、v:pt（顶点）、v:cxn（连线手柄）、v:pos（手柄位置）
    // 与 v:path 的盒子。一条 path 上几十上百枚 pt 是常事，所以每族只记「枚数 + 首枚值」：
    // 枚数说明这个族在这里出现了（探针要的正是这次按名查问），首枚值说明它长什么样，
    // 全挂会把 HTML 撑爆。屏上零兑现（Web 没有 VML 图元引擎），写侧也写不回——只记账
    for (const [k, tag, names] of [
      ['shGd', 'gd', ['fmla', 'name']],
      ['shPt', 'pt', ['x', 'y']],
      ['shCxn', 'cxn', ['ang']],
      ['shPos', 'pos', ['x', 'y']],
      ['shBox', 'path', ['w', 'h']],
    ] as const) {
      const els = allDesc(shape, tag)
      if (!els.length) continue
      const first: string[] = []
      for (const n of names) {
        const v = attrL(els[0], n)
        first.push(v ?? '')
      }
      kv[k] = `${els.length} ${first.join(',')}`
    }
  }
  // v:group 的五枚（v0.150）：分组画布的身份（id/spid）与坐标约定（coordorigin/coordsize）
  // 加 style。同 VML 壳其余各枚：只读不写
  const grp = findDesc(el, 'group')
  if (grp) {
    for (const [k, n] of [
      ['grpId', 'id'],
      ['grpSpid', 'spid'],
      ['grpCoord', 'coordorigin'],
      ['grpSize', 'coordsize'],
      ['grpStyle', 'style'],
    ] as const) {
      const v = attrL(grp, n)
      if (v) kv[k] = v
    }
  }
  // o:useLocalDpi（v0.150）与 o:attr（v0.150）：遗留件的两个扩展点。useLocalDpi 是
  // 「按本机 DPI 量尺寸」的 onOff，attr 是一枚自定义名值对
  const dpi = onOff(attrL(findDesc(el, 'useLocalDpi'), 'val'))
  if (dpi !== undefined) kv.localDpi = dpi ? '1' : '0'
  const attrEl = findDesc(el, 'attr')
  if (attrEl) {
    const an = attrL(attrEl, 'name')
    if (an) kv.attrN = an
    const av = attrL(attrEl, 'val')
    if (av) kv.attrV = av
  }
  const lock = findDesc(el, 'lock')
  if (lock) {
    const asp = onOff(attrL(lock, 'aspectratio'))
    if (asp !== undefined) kv.lkAspect = asp ? '1' : '0'
    const ext = attrL(lock, 'ext')
    if (ext) kv.lkExt = ext
  }
  const idTitle = attrL(findDesc(el, 'imagedata'), 'title')
  if (idTitle) kv.idTitle = idTitle
  const vFill = findDesc(el, 'fill')
  if (vFill) {
    const on = onOff(attrL(vFill, 'on'))
    if (on !== undefined) kv.fOn = on ? '1' : '0'
    const fs = attrL(vFill, 'focussize')
    if (fs) kv.fFocus = fs
  }
  const vStroke = findDesc(el, 'stroke')
  if (vStroke) {
    const on = onOff(attrL(vStroke, 'on'))
    if (on !== undefined) kv.sOn = on ? '1' : '0'
    const join = attrL(vStroke, 'joinstyle')
    if (join) kv.sJoin = join
    const wt = attrL(vStroke, 'weight')
    if (wt) kv.sWeight = wt
    // 描边色与斜接限制（v0.151）：与上三枚同一枚元素，同族补两笔
    const sc = attrL(vStroke, 'color')
    if (sc) kv.sColor = sc
    const sm = attrL(vStroke, 'miterlimit')
    if (sm) kv.sMiter = sm
  }
  // v:path 的连接几何（v0.151）：connectangles 是各顶点的连接角、connectlocs 是连接点
  // 坐标串。与 w/h 同住 v:path 上（w/h 已由图元几何族记账）。两枚在真实件里常是空串
  // （=用默认角/默认点），而载荷拒收空值，所以按图元几何族同款记「枚数 + 首枚值」——
  // 枚数说明这一族在这里出现了（探针要的正是那次按名查问），首枚值说明它长什么样
  const vPaths = allDesc(el, 'path')
  if (vPaths.length) {
    const ca = attrL(vPaths[0], 'connectangles')
    kv.pathCa = `${vPaths.length} ${ca ?? ''}`
    const cl = attrL(vPaths[0], 'connectlocs')
    kv.pathCl = `${vPaths.length} ${cl ?? ''}`
  }
  // v:rect 四边（v0.151）：VML 矩形的上下左右（EMU）。textbox 的老式件把文字盒画成
  // v:rect（与 v:shape 平级），四边常是 0（=贴 shape 的盒子），非 0 时文字盒内缩
  for (const r of allDesc(el, 'rect')) {
    for (const [k, n] of [['rcT', 't'], ['rcL', 'l'], ['rcB', 'b'], ['rcR', 'r']] as const) {
      const v = attrL(r, n)
      if (v !== undefined && kv[k] === undefined) kv[k] = v
    }
  }
  // a:srcRect（v0.154）：blipFill 的**源裁剪框**——从原图哪一块取像素。四边是千分比
  // （25000 = 25%），与 VML 的 crop 是同一件事的新式写法。屏上那一半由 imgClipCss 兑现，
  // 这里存原值只为往返（写侧发不出 a:srcRect，是单边通道——见审计文档）
  for (const sr of allDesc(el, 'srcRect')) {
    for (const [k, n] of [['srT', 't'], ['srR', 'r'], ['srB', 'b'], ['srL', 'l']] as const) {
      const v = attrL(sr, n)
      if (v !== undefined && v.trim() && kv[k] === undefined) kv[k] = v
    }
  }
  return imgPayload(kv)
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

/**
 * 一份编号定义的内容指纹（v0.150）：按 ilvl 序的 `numFmt|lvlText` 序列。
 * 往返时包的 numId/abstractNumId 是自己发的、与原文未必同号，贴回定义账就靠这份指纹
 * 在包里认「原文那一条」——认不出来就不贴（缺几枚属性比贴错定义轻）。
 */
function numFingerprint(levels: Map<number, LvlDef>): string {
  return [...levels.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k}:${v.numFmt}|${v.lvlText ?? ''}`)
    .join(';')
}

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
  /**
   * 定义身份与层属性（v0.150）：按 `w:abstractNum` 出现序排的一份数组，随 DocxImport
   * 出去、由调用方折进 meta，导出时按同一个序补丁回 numbering.xml。
   * 编号 id 在往返里会重排（包按自己的注册顺序发 numId/abstractNumId），所以这一族
   * 刻意只记序、不记号——与段落余量（pprExtras）同一条纪律
   */
  defs: DocxAbstractNumMeta[]
}

function readNumbering(xml: string, theme?: ThemeFonts): Numbering {
  const out: Numbering = { byId: new Map(), multiLevels: new Map(), defs: [] }
  if (!xml) return out
  const num = find(parseXml(xml), 'w:numbering')
  if (!num) return out
  // 部件根上的 mc:Ignorable（v0.152）：与 styles 根同款只读记账
  attrL(num, 'Ignorable')
  // 编号层级的 rPr 同样可能只写主题引用（v0.138），与 styles 同一趟落地
  applyThemeFonts(num, theme)
  const abstract = new Map<string, Map<number, LvlDef>>()
  for (const a of all(num, 'w:abstractNum')) {
    // restartNumberingAfterBreak（v0.152）：一枚**属性**（与 multiLevelType 那枚子元素
    // 正相反），Word 的「分页后重新编号」总闸。按 **local name** 收——Word 与 docx 库
    // 发的都是 w15: 前缀的扩展属性（OOXML 里它定义在 w15 命名空间、不在 w: 上），
    // 语料里也见过 w: 形态，两种前缀都认。要先于 abstractNumId 那道闸读——语料里
    // 有一枚不带 id 的裸 `<w:abstractNum w:restartNumberingAfterBreak="0"/>`，
    // 闸在后面就整枚跳过（与 v0.146 customStyle 先于 styleId 同一条纪律）
    const rna = onOff(attrL(a, 'restartNumberingAfterBreak'))
    const id = attr(a, 'w:abstractNumId')
    if (!id) continue
    // multiLevelType（v0.145）：编号定义的身份属性——它描述的是「这份定义是否设计成
    // 多级联动」，而我们的模型把编号定义塌成逐段各自的档位（ListRegistry 只按段引用
    // 重建定义），这个身份带不回来。读入记账，由 docxToHtmlFidelity 统一 warn。
    // **v0.150 修正**：它是一枚**子元素**（`<w:multiLevelType w:val="…"/>`），不是
    // w:abstractNum 身上的属性——旧写法 `attr(a, 'w:multiLevelType')` 查的是一枚不存在
    // 的属性，这 9 个字面从来没进过分子（账本上一直在 neverConsulted 里）
    const mlt = val(a, 'w:multiLevelType')
    if (mlt) out.multiLevels.set(id, mlt)
    // 定义身份（v0.150）：nsid 是定义自身的流水号（Word 合并文档时按它对账），
    // tmpl 指着模板编号。两枚都是 `<w:x w:val="…"/>` 形态的子元素
    const nsid = val(a, 'w:nsid')
    const tmpl = val(a, 'w:tmpl')
    // styleLink（v0.155）：这份编号定义挂在哪条样式上（Word 的「列表样式」就是靠它
    // 让一串编号跟着样式走）。它是 `w:abstractNum` 的子元素，与 styles.xml 里那条
    // `w:link` 互为反向（那边是「样式链到编号」，这边是「编号链回样式」）
    const styleLink = val(a, 'w:styleLink')
    const lvls: Record<string, DocxLvlMeta> = {}
    const levels = new Map<number, LvlDef>()
    for (const l of all(a, 'w:lvl')) {
      const ilvl = Number(attr(l, 'w:ilvl') ?? '0')
      const numFmt = val(l, 'w:numFmt') ?? 'bullet'
      const lvlText = val(l, 'w:lvlText')
      levels.set(ilvl, {
        numFmt,
        start: valNum(l, 'w:start') ?? 1,
        lvlText,
        lvlJc: (val(l, 'w:lvlJc') ?? '').toLowerCase() || undefined,
      })
      // 层属性三枚（v0.150）：tentative 是 onOff（「这一层还在草拟」，显式关也是值），
      // tplc 是模板层号（十六进制串），suff 是编号与正文之间夹的那一段
      const meta: DocxLvlMeta = {}
      // 逐层档位（v0.158）：numFmt/lvlText 原本只拼进 fp 那一串里，写手取不到逐层的值，
      // 重建编号时三层全拍成一个符面，指纹因此对不上——整条定义的元数据（suff/
      // lvlRestart/styleLink/nsid/tmpl）也就跟着贴不回去。逐层单存一份（与 fp 同源，
      // 那边是给人看的串，这边是给写手用的值）
      meta.fmt = numFmt
      if (lvlText !== undefined) meta.text = lvlText
      const tnt = onOff(attr(l, 'w:tentative'))
      if (tnt !== undefined) meta.tentative = tnt
      const tplc = attr(l, 'w:tplc')
      if (tplc) meta.tplc = tplc
      const suff = val(l, 'w:suff')
      if (suff) meta.suff = suff
      // 层余量四枚（v0.155）：屏上零兑现（列表由 ListRegistry 按段重建，这些是 Word
      // 自己的编号排版状态）。前两枚随 numbering.xml 补丁往返，后两枚只读：
      //   lvlRestart     —— 这一层是否随上一级重新起号（0 = 永不重起）
      //   lvlPicBulletId —— 这一层用的是第几号图片项目符号（对着根上 numPicBullet 的 id）
      //   legacy         —— 三枚属性（legacy/legacySpace/legacyIndent），Word 2003 的
      //                     老式编号缩进补偿；**只读**（三枚同族不同名，写回要做属性组补丁，
      //                     而它对屏上零后果）
      //   numForm        —— 编号口径（default/…）。**只读**：它的位次在我们手上没有
      //                     可靠参考（CT_Lvl 的序里没有它，硬插会被 Word 判损坏件），
      //                     所以读了记账、不回写——宁可少写一枚，不赌一次乱序。
      //                     这一枚在 rPr 上还会再问一次（readRPr 拿它出
      //                     font-variant-numeric），两处问的是同一个对，不重复计数
      const rst = valNum(l, 'w:lvlRestart')
      if (rst !== undefined) meta.restart = rst
      const pic = valNum(l, 'w:lvlPicBulletId')
      if (pic !== undefined) meta.picBulletId = pic
      val(l, 'w:numForm')
      const lg = find(l, 'w:legacy')
      if (lg) {
        attr(lg, 'w:legacy')
        attr(lg, 'w:legacySpace')
        attr(lg, 'w:legacyIndent')
      }
      if (Object.keys(meta).length) lvls[String(ilvl)] = meta
    }
    if (nsid || tmpl || mlt || rna !== undefined || styleLink || Object.keys(lvls).length)
      out.defs.push({
        ...(nsid ? { nsid } : {}),
        ...(tmpl ? { tmpl } : {}),
        ...(mlt ? { multiLevelType: mlt } : {}),
        ...(rna !== undefined ? { rna } : {}),
        ...(styleLink ? { styleLink } : {}),
        fp: numFingerprint(levels),
        levels: lvls,
      })
    abstract.set(id, levels)
  }
  // 根级两枚（v0.155）：`w:numPicBullet`（图片项目符号的定义，id 属性是
  // numPicBulletId）与 `w:numIdMacAtCleanup`（Mac 版清理到哪一号的记账）。
  // **两枚都只读记账**：前者本体是图片字节（与 media 那条链同源，我们的导出不发图片
  // 项目符号），后者是 Word 自己的清理水位——把它抄回去等于替 Word 编造清理状态
  for (const npb of all(num, 'w:numPicBullet')) attrL(npb, 'numPicBulletId')
  const nmac = find(num, 'w:numIdMacAtCleanup')
  if (nmac) attrL(nmac, 'val')
  for (const n of all(num, 'w:num')) {
    // durableId（v0.152）：`w:num` 身上的持久编号 id（Word 合并文档时按它对账）。
    // 同 rna 的纪律：先于 numId/abstractNumId 那道闸读——语料里那枚只带 durableId。
    // **只读记账**：我们的 ListRegistry 按段引用重建定义，这枚身份带不回来
    attr(n, 'w:durableId')
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
    // 两枚都走 attrL：主题色也是按名查问，探针在漏斗上记的是这一笔。
    // v0.164：两枚都**无条件**取原值——写成 `srgb ? attrL(…) : undefined ?? sys ? …`，
    // 一槽写了 srgbClr 时 sysClr 那枚永不求值（同一形状的第三处，见 shd/边框那两处）
    const srgbVal = srgb ? attrL(srgb, 'val') : undefined
    const sysVal = sys ? attrL(sys, 'lastClr') : undefined
    const hex = srgbVal ?? sysVal
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

/** 元素上的主题引用三枚的**原值**（v0.159：`w:u` 要把它们带进模型，解析出来的 hex 回不去槽） */
interface ThemeRef {
  ref: string
  tint?: string
  shade?: string
}

/**
 * 读元素上的主题引用三枚（原值，不解析）。查问与解析分开：查问恒做（量具的分子就是
 * 这么来的），解析不出来也照样把原值带出来。
 *
 * 引用名先按名查问再谈解析：没有主题（或槽空）时旧写法在这里就 return，那枚
 * themeColor/tint/shade 属性等于没被读过——保真账上它一直挂在 neverConsulted。
 * 深浅两枚也**恒查问**（v0.155 修）：旧写法把它们放在三道 return 之后，于是
 * 「主题没装 / 槽名不认 / 引用为空」三种情形下这两枚属性等于没被读过——表级
 * insideH/insideV 的 themeShade/themeTint 就这么一直挂在 neverConsulted 里。
 *
 * 三个属性名做成参数：w:color 用 themeColor/themeTint/themeShade，
 * w:shd 用 themeFill/themeFillTint/themeFillShade，边框同 w:color 一族。
 */
function themeRefParts(
  el: XEl,
  refAttr = 'w:themeColor',
  tintAttr = 'w:themeTint',
  shadeAttr = 'w:themeShade',
): ThemeRef {
  const ref = (attr(el, refAttr) ?? '').trim()
  const tint = attr(el, tintAttr)
  const shade = attr(el, shadeAttr)
  return { ref, ...(tint ? { tint } : {}), ...(shade ? { shade } : {}) }
}

/** 主题引用 → '#hex'。解析不了（没主题、槽空、引用名不认识）返回 undefined，调用方落回字面值 */
function themeCssOf(theme: ThemeColors | undefined, p: ThemeRef): string | undefined {
  if (!theme || !p.ref) return undefined
  const slot = THEME_COLOR_SLOT[p.ref.toLowerCase()]
  const base = slot ? theme[slot] : undefined
  if (!base) return undefined
  return applyTintShade(base, tintShadeOf(p.shade), tintShadeOf(p.tint))
}

/**
 * 元素上的主题色引用（+tint/shade）→ '#hex'，供屏上兑现用。Word 的分工是主题引用
 * 为主、字面值兜底（两枚常一起写），所以解析不出就落回字面值的那一分。
 */
function themeRefCss(
  theme: ThemeColors | undefined,
  el: XEl,
  refAttr = 'w:themeColor',
  tintAttr = 'w:themeTint',
  shadeAttr = 'w:themeShade',
): string | undefined {
  return themeCssOf(theme, themeRefParts(el, refAttr, tintAttr, shadeAttr))
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
  /**
   * w:u/@w:val 的线型（single / double / dotted / wave …，v0.156）。
   * 屏上那一半此前只写 `<u>`——线型就此丢在模型外；现在与颜色一起进 data-u 载荷往返
   */
  uVal?: string
  /** w:emboss / w:imprint（v0.156）：浮雕与阴文。CSS 没有像样的对应物，屏上不兑现，只往返 */
  emboss?: boolean
  imprint?: boolean
  strike?: boolean
  color?: string
  hl?: string
  /** 半点 */
  sz?: number
  /** 字符间距：w:rPr/w:spacing/@w:val，单位缇（20 缇 = 1 磅），负值是紧缩 */
  sp?: number
  fonts?: string[]
  /**
   * rFonts 上的**主题字体引用名**（v0.161）：`w:asciiTheme` / `w:eastAsiaTheme` /
   * `w:hAnsiTheme` / `w:cstheme` 四枚的原值。
   *
   * 与 `fonts` 是两套并存的说法而不是两种用途：Word 的 Normal 样式只写引用名
   * （`asciiTheme="minorHAnsi"`），具名字体要靠主题部件解析出来。读手把解析值落在
   * `fonts` 上（屏上要它），但**引用名本身也是源件说过的话**——写回时只写解析值，
   * 就把「跟着主题走」这层意思改成了「钉死 Calibri」：换主题时文档不再跟着变。
   */
  fontThemes?: { ascii?: string; eastAsia?: string; hAnsi?: string; cs?: string }
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
  /**
   * w:position/@w:val：基线升降，半点，正升负降（手工调的上下标走这里，不走 vertAlign）。
   * v0.151 修正：元素名一直写成 w:pos——CT_RPr 里没有这枚元素，Word 与 docx 库发的都是
   * w:position（ST_SignedTwipsPerMil）。漏斗确实被调用了（所以量具不报错），但查的名字
   * 不在宇宙里：那 338 个字面从来没进过分子，而屏上的 vertical-align 升降对真实件
   * 一次都没生效过（读不回自己写的那一枚）。与 v0.150 的 multiLevelType 同款病
   */
  pos?: number
  /** w:iCs/@w:val：复杂文字（cs 字族）的斜体。CSS 无对应物，屏上不兑现（v0.143） */
  iCs?: boolean
  /** w:bCs/@w:val：复杂文字的粗体。同上（v0.143） */
  bCs?: boolean
  /** w:smallCaps/@w:val：小型大写。屏上走 font-variant-caps（v0.143） */
  smallCaps?: boolean
  /**
   * w:caps/@w:val：全大写（v0.152）。屏上走 text-transform: uppercase。
   * 与 smallCaps 同族同纪律：「关」（val=0）与「没写」往返同结果，只存 true
   */
  caps?: boolean
  /**
   * w:vanish/@w:val：隐藏文字（v0.154）。屏上走 visibility: hidden——不是 display:none，
   * 因为 Word 的隐藏文字不显示却仍占版面（行高与分页照算），抹掉布局等于改了周围排版。
   * 与 caps 同纪律：「关」（val=0）与「没写」往返同结果，只存 true
   */
  vanish?: boolean
  /**
   * w:bdr 四属性（v0.152）：字符边框。val 是线型枚举（single/dotted/…），sz 是
   * 八分之一磅，space 是磅，color 是 hex。屏上走 CSS border——sz/space 两枚要换算，
   * 其余原样。四枚都没写不挂。
   *
   * v0.166：`theme` 是同一枚元素上的主题引用原值（包外无槽，随 data-rbdr 走存盘通道）。
   * `screen` 是主题解析出来的颜色（**只给屏上用**）——字面色仍留在 `color` 里往存盘走，
   * 两个槽各管一段（v0.159 的 w:u 同一条纪律）。解析不出来时没有这一枚
   */
  bdr?: { val: string; sz?: string; space?: string; color?: string; screen?: string; theme?: ThemeRef }
  /**
   * w:u 的颜色三枚（v0.155）：字面色 w:color 与主题引用 w:themeColor + w:themeTint/Shade。
   * 屏上走 CSS text-decoration-color——这是 w:u 身上唯一能兑现的一枚（线型枚举 val 早已收，
   * 但线型的 CSS 对应物是 border-bottom 那套，读手仍用 text-decoration: underline 表达）。
   * 主题引用优先，与 w:color 同款主次
   */
  uColor?: string
  /**
   * w:u/@w:color 的**字面值**（v0.159，去掉 # 的小写 hex）。
   *
   * 为什么要与 uColor 分开：uColor 是解析主题之后给屏上用的颜色，源件里 `w:u` 常写成
   * `w:color="FF0000" w:themeColor="accent1"`——两枚是**两个不同的槽**。此前写手只拿到
   * 解析值，于是往 w:color 里写主题算出来的色（往返账上就记着 ff0000 → b4c7e7 这一笔
   * 「值变」），主题那两枚则整条掉。现在字面走字面、主题走主题（见 uTheme）
   */
  uColorLit?: string
  /**
   * w:u 上的主题引用原值（v0.159）：{ref, tint?, shade?}。
   * 写手的 underline 只有 `{type, color}` 两枚原生槽（dist 里 createUnderline 只写
   * w:val 与 w:color），主题三枚**包外无槽**——随 data-u 载荷进模型，存盘时由
   * docx.ts 的 patchUTheme 在 word/document.xml 上按序补回（与 w:sym 同一条「run 级
   * 补丁位」的机制，两处一起还的这笔债）
   */
  uTheme?: ThemeRef
  /**
   * w:color 上的主题引用原值（v0.160）：{ref, tint?, shade?}。
   *
   * 与 uTheme 同一条机制债的另一半：包发 `w:color` 时只写 w:val（createColor 就认这一枚），
   * 主题三枚包外无槽。屏上那一半由 `color`（解析后的 hex）兑现，这一格只为存盘——
   * 否则「Word 主题色」的文档一进一出，主题引用全被拍成字面值（改主题就换不了色了）
   */
  colorTheme?: ThemeRef
  /** w:em/@w:val（v0.155）：着重号型别（dot 圈点 / circle 空心圈 / comma 逗号 / underDot）。屏上走 text-emphasis */
  em?: string
  /** w:ligatures/@w:val（v0.155）：连字档。屏上走 font-variant-ligatures */
  lig?: string
  /** w:numSpacing/@w:val（v0.155）：数字间距档。屏上走 font-variant-numeric */
  numSpacing?: string
  /** w:numForm/@w:val（v0.155）：数字形式（lining 等高 / oldStyle 旧式）。同走 font-variant-numeric */
  numForm?: string
  /** w:cntxtalts/@w:val（v0.155）：上下文替代字形。屏上走 font-variant-alternates */
  cntxtalts?: boolean
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
  if (u) {
    const uv = attr(u, 'w:val')
    o.u = uv !== 'none'
    // 线型（v0.156）：写侧 docx 的 underline.type 认得这一枚，与颜色同走 data-u 载荷
    if (uv && uv !== 'none') o.uVal = uv
    // v0.155：下划线颜色。三枚都查问（字面色 / 主题槽 / 主题深浅），但只出一个 CSS 值——
    // 与 w:color 同一条主次：主题引用能解析就用主题，否则落字面。
    // v0.159：字面与主题**分开存**——写手把字面写回 w:color、主题三枚走补丁位补回，
    // 两枚各归各的槽（此前字面被解析值顶掉，往返账上记着 ff0000 → b4c7e7）
    const th = themeRefParts(u)
    const themed = themeCssOf(tc, th)
    const uc = (attr(u, 'w:color') ?? '').toLowerCase()
    const ucHex = uc && uc !== 'auto' ? uc.replace(/^#/, '') : undefined
    if (themed) o.uColor = themed
    else if (ucHex) o.uColor = '#' + ucHex
    if (ucHex) o.uColorLit = ucHex
    if (th.ref) o.uTheme = th
  }
  // v0.155：OpenType 字形档位四枚 + 着重号。屏上都有 CSS 对应物（font-variant-* 与
  // text-emphasis），但都是「浏览器与字体支持才生效」的软兑现：字体没有那张特性表就按默认画。
  // 挂 CSS 而不是当噪声跳过——声明本身是这些属性的正确含义，只是能否落地取决于字体
  const em = attr(find(el, 'w:em'), 'w:val')
  if (em) o.em = em
  const lig = attr(find(el, 'w:ligatures'), 'w:val')
  if (lig) o.lig = lig
  const nsp = attr(find(el, 'w:numSpacing'), 'w:val')
  if (nsp) o.numSpacing = nsp
  const nfm = attr(find(el, 'w:numForm'), 'w:val')
  if (nfm) o.numForm = nfm
  if (on(find(el, 'w:cntxtalts'))) o.cntxtalts = true
  // v0.155：字形装饰三枚（浮雕 / 阴文 / 镂空）。CSS 只有半吊子近似（text-shadow 模拟浮雕、
  // -webkit-text-stroke 模拟镂空，且都不在标准里），做了会画出与 Word 不像的样子——
  // 屏上不兑现。v0.156：浮雕与阴文在 docx 包里有原生槽（IRunOptions.emboss/imprint），
  // 所以这两枚从「纯记账」升成「只往返」——存盘不丢，屏上仍然不画。镂空没有槽，继续纯记账
  if (on(find(el, 'w:emboss'))) o.emboss = true
  if (on(find(el, 'w:imprint'))) o.imprint = true
  on(find(el, 'w:outline'))
  const colorEl = find(el, 'w:color')
  if (colorEl) {
    // 主题引用是主、字面值是兜底（Word 两枚常一起写）；主题解析不了才落字面。
    // v0.160：主题三枚另存一份原值——屏上用解析值、存盘写回引用，与 w:u 同款的两槽分工
    const th = themeRefParts(colorEl)
    const themed = themeCssOf(tc, th)
    const v = (attr(colorEl, 'w:val') ?? '').toLowerCase()
    if (themed) o.color = themed
    else if (v && v !== 'auto') o.color = '#' + v.replace(/^#/, '')
    if (th.ref) o.colorTheme = th
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
    // v0.164：两枚都无条件取原值。写成 `attr(w:ascii) ?? attr(w:hAnsi)` 时，写了 ascii 的
    // rFonts 上 hAnsi 永不求值——而 Word 几乎每处都把两枚一起写（同一形状的第四处）
    const asciiLit = attr(rf, 'w:ascii')
    const hAnsiLit = attr(rf, 'w:hAnsi')
    const ascii = asciiLit ?? hAnsiLit
    if (ascii) fams.push(ascii)
    const ea = attr(rf, 'w:eastAsia')
    if (ea && !fams.includes(ea)) fams.push(ea)
    if (fams.length) o.fonts = fams
    const hint = (attr(rf, 'w:hint') ?? '').toLowerCase()
    // 只认规范里的两个值；写别的（大小写变体除外）按没说话处理
    if (hint === 'eastasia' || hint === 'default') o.hint = hint
    const cs = attr(rf, 'w:cs')
    if (cs) o.cs = cs
    // 主题引用名（v0.161）：四枚都按名查问（applyThemeFonts 那一趟已查问过一遍，这里再
    // 查一次不新增分子，只是把**原值**带进模型——那一趟只落解析值，引用名就此没了）。
    // 空串不算声明：写了 `w:asciiTheme=""` 等于没说
    const ft = {
      ascii: attr(rf, 'w:asciiTheme') || undefined,
      eastAsia: attr(rf, 'w:eastAsiaTheme') || undefined,
      hAnsi: attr(rf, 'w:hAnsiTheme') || undefined,
      cs: attr(rf, 'w:cstheme') || undefined,
    }
    if (Object.values(ft).some(Boolean)) o.fontThemes = ft
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
  const pos = valNum(el, 'w:position')
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
  // 全大写（v0.152）：与 smallCaps 平级的一枚 onOff，Word 的「全部大写」。
  // 「关」与「没写」同结果，只存 true
  const cp = on(find(el, 'w:caps'))
  if (cp) o.caps = true
  // 隐藏文字（v0.154）：与 caps/smallCaps 平级的一枚 onOff。「关」与「没写」同结果
  const vn = on(find(el, 'w:vanish'))
  if (vn) o.vanish = true
  // 字符边框（v0.152）：w:bdr 四属性一组。val 缺省按 single（OOXML 默认线型），
  // 但一枚都不带时不挂载荷——Word 少写哪一枚就少哪一枚的屏上效果
  const bdrEl = find(el, 'w:bdr')
  if (bdrEl) {
    const bv = attr(bdrEl, 'w:val')
    const bs = attr(bdrEl, 'w:sz')
    const bp = attr(bdrEl, 'w:space')
    const bc = attr(bdrEl, 'w:color')
    // v0.166：主题三枚（与 w:u/w:color/表级边框同一族）。走 themeRefParts 是纪律：
    // 那是「按名查问这三枚」的唯一出口，自己再 attr 一遍会让 no-themeshade 腿失真
    const parts = themeRefParts(bdrEl)
    const theme = parts.ref || parts.tint || parts.shade ? parts : undefined
    // 屏上那一份：主题解析得出就画它（与 w:color/表级边框同一优先级），字面色只往存盘走
    const shown = themeCssOf(tc, parts)
    if (bv || bs || bp || bc || theme)
      o.bdr = {
        val: bv ?? 'single',
        ...(bs ? { sz: bs } : {}),
        ...(bp ? { space: bp } : {}),
        ...(bc ? { color: bc } : {}),
        ...(shown ? { screen: shown.replace('#', '').toUpperCase() } : {}),
        ...(theme ? { theme } : {}),
      }
  }
  return o
}

/** 段落样式链 → 段落标记 run（pPr/rPr）：本段文字的基准运行属性（docDefaults 故意不参与，见 readStyles） */
function baseRunProps(chain: StyleInfo[], pPr: XEl | undefined, tc?: ThemeColors, seed: RunProps = NONE): RunProps {
  // seed 是「比段落样式更弱的那一层」（v0.169：表样式条件层的 run）。链与段落标记
  // 依次盖在它上面——Word 的优先级也是段落样式压过表样式
  let p = seed
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
  // w:position 与 vertAlign 同时出现时 Word 按 vertAlign 渲染，故只在没有上下标时才兑现升降
  if (p.va === undefined && p.pos !== undefined) bits.push(`vertical-align: ${px2((p.pos / 2) * PT_PX)}px`)
  // 全大写（v0.152）：CSS 的 text-transform 正好是这一个（smallCaps 走 font-variant，同类不同族）
  if (p.caps) bits.push('text-transform: uppercase')
  // 隐藏文字（v0.154）：用 visibility 不用 display——占位得留着，否则整段行距与分页都变了
  if (p.vanish) bits.push('visibility: hidden')
  // 字符边框（v0.152）：w:bdr → CSS border。sz 是八分之一磅、space 是磅，两枚都要换算；
  // 缺 sz 时给 1px（Word 少写这一枚时屏上也得有条线，粗细取最细一档）
  if (p.bdr) bits.push(bdrCss(p.bdr))
  // v0.155：OpenType 字形档位四枚。都是有 CSS 对应物的软兑现——字体里没有那张特性表就按
  // 默认画，但声明本身是这些属性的正确含义，比当噪声跳过诚实。枚举值一律走白名单：
  // 值来自 XML 属性，不认识的档宁可不发，也不让它进 style 串
  if (p.em) {
    const e = EMPHASIS[p.em.toLowerCase()]
    if (e) {
      bits.push(`text-emphasis: ${e.style}`)
      if (e.under) bits.push('text-emphasis-position: under right')
    }
  }
  const lig = p.lig ? ligaturesCss(p.lig.toLowerCase()) : ''
  if (lig) bits.push(`font-variant-ligatures: ${lig}`)
  const numeric = fontVariantNumeric(p)
  if (numeric) bits.push(`font-variant-numeric: ${numeric}`)
  if (p.cntxtalts) bits.push('font-variant-alternates: contextual')
  return bits.join('; ')
}

/** 字符边框载荷 → CSS border 一句（val 枚举到 CSS 线型——cell-style 那份表是单一真源；auto 色不落，用 currentColor） */
function bdrCss(b: NonNullable<RunProps['bdr']>): string {
  const style = CSS_BORDER_STYLE[b.val.toLowerCase()] ?? 'solid'
  // sz 是八分之一磅；缺这一枚时按最细一档（1/8 磅）画——Word 少写也得有条线
  const w = b.sz !== undefined && Number(b.sz) > 0 ? eighthsToPx(Number(b.sz)) : eighthsToPx(1)
  // 颜色两槽取一（v0.166）：`screen` 是主题解析后的结果，`color` 是源件的字面色。
  // 屏上要的是最终生效色——Word 也是主题优先
  const raw = b.screen ?? b.color
  const c = raw && raw.toLowerCase() !== 'auto' ? `#${raw.replace(/^#/, '').toLowerCase()}` : 'currentColor'
  return `border: ${w}px ${style} ${c}`
}

/**
 * w:em 的着重号型别 → CSS text-emphasis（v0.155）。Word 的四档里 comma（逗号）在 CSS
 * 没有对应形状，用 sesame（芝麻点）顶——两者都是「字旁一个点状记号」，比干脆不发诚实。
 * underDot 是字**下**点（日文着重号在下方），CSS 的位置要另起一句（不在简写里）
 */
const EMPHASIS: Record<string, { style: string; under?: boolean }> = {
  dot: { style: 'dot' },
  circle: { style: 'circle' },
  comma: { style: 'sesame' },
  underdot: { style: 'dot', under: true },
}

/** w:ligatures → CSS font-variant-ligatures（v0.155）。枚举是组合值（standardContextual…），按子串拆 */
function ligaturesCss(v: string): string {
  if (!v || v === 'none') return 'none'
  const out: string[] = []
  if (v.includes('standard')) out.push('common-ligatures')
  if (v.includes('contextual')) out.push('contextual')
  if (v.includes('historical')) out.push('historical-ligatures')
  return out.join(' ')
}

/** w:numSpacing + w:numForm → CSS font-variant-numeric（两枚同属这一个属性，合成一句） */
function fontVariantNumeric(p: RunProps): string {
  const out: string[] = []
  const sp = (p.numSpacing ?? '').toLowerCase()
  if (sp === 'proportional') out.push('proportional-nums')
  else if (sp === 'tabular') out.push('tabular-nums')
  const fm = (p.numForm ?? '').toLowerCase()
  if (fm === 'lining') out.push('lining-nums')
  else if (fm === 'oldstyle') out.push('oldstyle-nums')
  return out.join(' ')
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
  // 下划线的往返载荷（v0.156，v0.159 扩到六格）：线型缺省按 single（OOXML 里缺 w:val
  // 就是默认单线），只有颜色没有线型时也按 single 记，颜色才不至于跟着丢。
  // 六格 = `线型;屏上色;字面色;themeColor;themeTint;themeShade`，空槽留空。
  // 屏上色（第二格）与字面色（第三格）必须分开：前者是解析主题后画屏用的颜色，
  // 后者是 `w:u/@w:color` 的原文；主题三枚回不去包的 underline 槽（只有 {type,color}
  // 两枚），要随载荷带走、由写手的 run 级补丁位补回
  const uPayload = (() => {
    if (!(p.uVal || p.uColor || p.uColorLit || p.uTheme)) return ''
    const t = p.uTheme
    return [p.uVal || 'single', p.uColor ?? '', p.uColorLit ?? '', t?.ref ?? '', t?.tint ?? '', t?.shade ?? ''].join(';')
  })()
  // 文字色的主题三枚（v0.160）：`ref;tint;shade`，缺的槽留空串。与 uPayload 分开走是因为
  // 它们落在**两个不同的元素**上（w:u / w:color），补丁位按元素分别计数，混一格就对不上位
  const cthemePayload = p.colorTheme ? [p.colorTheme.ref, p.colorTheme.tint ?? '', p.colorTheme.shade ?? ''].join(';') : ''
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
    // v0.152：全大写与字符边框。caps 屏上已由 cssOf 兑现（text-transform），载荷只为往返；
    // bdr 的屏上那一半同样在 cssOf（border），载荷带齐四枚（缺的槽留空串）
    p.caps ? ' data-caps="1"' : '',
    // v0.154：隐藏文字。屏上那一半在 cssOf（visibility: hidden），载荷只为往返
    p.vanish ? ' data-vanish="1"' : '',
    // v0.166：后三格是主题引用原值——属性名改成 data-rbdr，与段落/逐格那一枚
    // data-bdr（按边分格的另一种语法）分开：同一个名字挂两种 grammar 迟早出事
    p.bdr
      ? ` data-rbdr="${p.bdr.val};${p.bdr.sz ?? ''};${p.bdr.space ?? ''};${p.bdr.color ?? ''};${p.bdr.theme?.ref ?? ''};${p.bdr.theme?.tint ?? ''};${p.bdr.theme?.shade ?? ''}"`
      : '',
    // v0.156：下划线线型 + 颜色（载荷 `线型;颜色;主题三枚`，颜色是 #RRGGBB 或空槽）。
    // 屏上那一半此前挂在 `<u>` 的 inline style 上，过不了 TipParse（underline mark 只认标签），
    // 存盘就丢了；线型更是一直没有出口。两枚一起随 data-u 进模型走往返
    uPayload ? ` data-u="${attrEsc(uPayload)}"` : '',
    // v0.160：文字色的主题三枚（w:color/@w:themeColor 一族），走 run 级补丁位补回
    cthemePayload ? ` data-ctheme="${attrEsc(cthemePayload)}"` : '',
    p.em ? ` data-em="${attrEsc(p.em)}"` : '',
    p.emboss ? ' data-emboss="1"' : '',
    p.imprint ? ' data-imprint="1"' : '',
  ].join('')
  if (css || extra) s = `<span${css ? ` style="${css}"` : ''}${extra}>${s}</span>`
  if (p.hl) s = `<mark data-color="${p.hl}" style="background-color: ${p.hl}; color: inherit">${s}</mark>`
  if (p.strike) s = `<s>${s}</s>`
  // 下划线颜色（v0.155）：**必须落在 <u> 上**——text-decoration-color 不继承，写在内层
  // span 上只作用于 span 自己的装饰线，而线是 u 元素画的，写那儿等于没写
  if (p.u) s = p.uColor ? `<u style="text-decoration-color: ${attrEsc(p.uColor)}">${s}</u>` : `<u>${s}</u>`
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
    // v0.154：保真路径改由读手走 attr 漏斗读（下面 readComments）——docx.ts 那份
    // commentRowsOf 是正则读的，读是读了但**进不了保真账本**（与 v0.147 之前节属性
    // 那一处欠账同一款）。兜底（mammoth）路径不进账本，仍用 commentRowsOf
    this.comments = readComments(commentsXml, extXml)
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
        // 控件身份（v0.155）：与段内那一支同一条——块级内容控件也得把 sdtPr/w:id 问一遍
        // （两种承放都真实存在：整段整表被包起来是块级，包住几个字是段内）
        const bpr = find(n, 'w:sdtPr')
        if (bpr) val(bpr, 'w:id')
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

  private async paragraph(el: XEl, list: ListState, inCell: boolean, betweenCss = '', runSeed: RunProps = NONE): Promise<string> {
    const { pPr, effPPr } = this.effPPrOf(el)
    const view = styleView(this.book, pPr ? val(pPr, 'w:pStyle') : undefined)
    const base = baseRunProps(view.chain, effPPr, this.themeColors, runSeed)
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
    // 底纹的存盘原件（v0.164）：主题引用吃掉字面 fill 时，那一枚随 data-shd 走
    const shdAttr = shdOriginOf(find(effPPr, 'w:shd'), this.themeColors)
    // 边框的存盘原件（v0.165）：四边的字面色与主题三枚随 data-bdr 走。`paraCss` 里那
    // 一趟算的是屏上色（它要拼 CSS），这里再取一次原件——同一个元素，两趟各问各的
    const pbdrEl = find(effPPr, 'w:pBdr')
    const pbdrEdges = pbdrEl ? borderEdges(pbdrEl, this.themeColors) : {}
    const bdrAttr = pbdrEl ? borderOrigin(pbdrEl, pbdrEdges) : ''
    // 第五边（v0.167）：`betweenCss` 非空 = 本段真把它画成了下边框
    const pbdrAttr = pbdrOrigin(pbdrEl, pbdrEdges, !!betweenCss)
    const pbarAttr = barOrigin(pbdrEl)
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
      `${tag}${shadeAttr ? ` data-shade="${shadeAttr}"` : ''}${shdAttr ? ` ${SHD_ATTR}="${shdAttr}"` : ''}${bdrAttr ? ` ${BDR_ATTR}="${bdrAttr}"` : ''}${pbdrAttr ? ` ${PBDR_ATTR}="${pbdrAttr}"` : ''}${pbarAttr ? ` ${PBAR_ATTR}="${pbarAttr}"` : ''}${tabsAttr ? ` data-tabs="${tabsAttr}"` : ''}${frameAttr ? ` data-frame="${frameAttr}"` : ''}${pprAttr ? ` ${PPR_ATTR}="${pprAttr}"` : ''}${flags.join('')}`,
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
      // v0.164：left/right 与 start/end 两套写法各查各的（`??` 右侧不求值 → 写了 left
      // 的缩进上 start 永不进账；Word 的 bidi 件两枚都写，正落在短路那一支）
      const leftLit = attrNum(ind, 'w:left')
      const leftStart = attrNum(ind, 'w:start')
      const left = leftLit ?? leftStart
      const leftChars = attrNum(ind, 'w:leftChars')
      const hang = attrNum(ind, 'w:hanging')
      const rightLit = attrNum(ind, 'w:right')
      const rightEnd = attrNum(ind, 'w:end')
      const right = rightLit ?? rightEnd
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
      // 主题字体引用名**不在这里**落（v0.161）：它是「这一枚样式自己说过的话」，链合并
      // 会把 Normal 的引用名摊到子样式上。由调用方按 info 自己的 rPr 单独取
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
      // 主题字体引用是**这一枚样式自己说过的话**，不是继承来的（v0.161）：链合并会把
      // Normal 的引用名摊到 Report/ReportHead/ReportChar 上，而写手那份继承由包自己
      // 沿 basedOn 摊——再在子样式上写一遍就成了「用户在这层也钉了一次」，换主题时
      // 子样式不再跟着变。所以这里**只看 info 自己的 rPr**（传 NONE = 不继承）
      const own = info.rPr ? readRPr(info.rPr, NONE, this.themeColors) : undefined
      if (own?.fontThemes) run.fontTheme = own.fontThemes
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
          // 与 paraCss 那一处同款（v0.164）：left/right 与 start/end 两套写法各查各的
          const leftLit = attrNum(ind, 'w:left')
          const leftStart = attrNum(ind, 'w:start')
          const left = leftLit ?? leftStart
          const rightLit = attrNum(ind, 'w:right')
          const rightEnd = attrNum(ind, 'w:end')
          const right = rightLit ?? rightEnd
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
      case 'commentReference': {
        // 批注引用（v0.154）：不产可见文字（批注标记由 commentRangeStart/End 那一对
        // 区间包出来），但它的 w:id 是「这条引用指向哪一条批注」——与 rangeStart/End
        // 同一条链上的第三处 id。读手按区间定范围、这一枚只在账上，屏上零兑现
        attr(node, 'w:id')
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
        // v0.164：两枚各查各的（`??` 的右侧在写了 fldCharType 的件上永不求值；
        // w:type 是更早期的写法，兼容件里还见得到）
        const fldType = attr(node, 'w:fldCharType')
        const legacyType = attr(node, 'w:type')
        const k = fldType ?? legacyType
        // 域属性两枚（v0.155）：fldLock（这一枚域锁住，不许更新）与 dirty（结果已过期，
        // 打开时要重算）。两枚都不改我们屏上的样子——域是打开时算一次就固定下来的，
        // **只读记账**：写侧发包时域一律重建（meta 里没有「哪一枚锁着」这一栏）
        attr(node, 'w:fldLock')
        attr(node, 'w:dirty')
        // 表单域（v0.155）：`w:fldChar/w:ffData` 是 Word 表单控件（文本框/复选框/下拉）
        // 的配置壳——名字、是否启用、退出时算不算、宏、提示文字、文本域的默认值与长度上限。
        // 屏上**一个都不兑现**（我们把它当普通域渲染：中间那段结果文字照常显示），写侧
        // 也不发表单域（导出时域被重建为普通域），所以整族只读记账。真件里这一族不少，
        // 丢了等于把「这是张可填的表」变成「这是一段文字」，要在审计里说清楚
        const ff = find(node, 'w:ffData')
        if (ff) {
          for (const kid of ['name', 'enabled', 'calcOnExit', 'entryMacro', 'exitMacro', 'helpText', 'statusText', 'appearance']) {
            const el = find(ff, `w:${kid}`)
            if (!el) continue
            // 这几枚的值都在 `w:val` 上（enabled 常写成空元素，val 缺省即开）
            attr(el, 'w:val')
          }
          const ti = find(ff, 'w:textInput')
          if (ti) {
            for (const kid of ['default', 'maxLength', 'format']) {
              const el = find(ti, `w:${kid}`)
              if (el) attr(el, 'w:val')
            }
          }
          const cb = find(ff, 'w:checkBox')
          if (cb) {
            for (const kid of ['size', 'sizeAuto']) attr(cb, `w:${kid}`)
            for (const kid of ['default', 'checked']) {
              const el = find(cb, `w:${kid}`)
              if (el) attr(el, 'w:val')
            }
          }
        }
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
      case 'sym': {
        // v0.155：符号（w:sym）。此前只 warn 一声就把字丢了——w:sym 是正文里的**一个字符**
        // （「插入 → 符号」插的就是它），丢了等于文档平白少一个字。char 是十六进制码点，
        // font 是那一枚符号所在的字体（Wingdings/Webdings 之类，码位常落在 Unicode 私有区，
        // 只有配上原字体才画得出那个形状，所以 font 必须一起带走）。
        //
        // v0.159：此前只把字符当普通文字发出去（屏上看着对，存盘变 w:t + rFonts）——
        // 往返账上 `sym|char` 与 `sym|font` 两笔都是「掉了」。现在把 char/font 原值一起
        // 装进 data-sym，由写手发回真的 w:sym（docx 包有原生 SymbolRun，不需要补丁位）
        const char = attr(node, 'w:char')
        const font = attr(node, 'w:font')
        const cp = char ? parseInt(char, 16) : NaN
        if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) {
          const f = font ? ` style="font-family: ${attrEsc(font)}"` : ''
          const load = ` data-sym="${attrEsc(`${char};${font ?? ''}`)}"`
          push(st, `<span${f}${load}>&#x${cp.toString(16).toUpperCase()};</span>`)
        } else {
          this.warn(`符号（w:sym）缺可用的 char 属性（font=${font ?? '未写'}）`)
        }
        return
      }
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
        // v0.164：两枚各查各的（`??` 右侧在写了 ProgID 的件上永不求值）
        const progId = attr(ole, 'ProgID')
        const progType = attr(ole, 'Type')
        const prog = progId ?? progType
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
        // w:history（v0.152）：这一链链接进没进过「历史记录」（Word 的已访问链接账）。
        // 只读记账——HTML 的 <a> 没有这一位，写侧也无槽
        attr(node, 'w:history')
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
        // v0.155：链接的另两枚属性——tooltip（鼠标悬停提示）与 tgtFrame（打开到哪一帧）。
        // HTML 的 title 与 target 正好是这两个含义，屏上是**真的兑现**（悬停可见、点击跳窗）。
        // 写侧发不出：docx 的 ExternalHyperlink 只收 link，没有 tooltip/帧目标这两枚——单边
        const tip = attrL(node, 'tooltip')
        const frame = attrL(node, 'tgtFrame')
        const href = rel?.external ? rel.target : anchor ? `#${anchor}` : undefined
        if (!href) {
          for (const p of sub.pieces) st.pieces.push(p)
          st.outSeq += sub.pieces.length
          return
        }
        const aExtra = `${tip ? ` title="${attrEsc(tip)}"` : ''}${frame ? ` target="${attrEsc(frame)}"` : ''}`
        for (const p of sub.pieces)
          st.pieces.push(
            p.kind === 'inline' ? { kind: 'inline', html: `<a href="${esc(href)}"${aExtra}>${p.html}</a>` } : p,
          )
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
      case 'sdt': {
        // 内容控件（v0.155）：`w:sdtPr` 里的 `w:id`（控件唯一号）与 `w:alias`/`w:tag`
        // 是这一族的身份。屏上不兑现（我们照 sdtContent 下钻，控件壳本身没进模型），
        // 也不往返——导出时内容控件被摊成普通段落/文字。**只读记账**
        const pr = find(node, 'w:sdtPr')
        if (pr) val(pr, 'w:id')
        await this.children(node, props, st)
        return
      }
      case 'sdtContent':
      case 'customXml':
      case 'bdo':
      case 'dir':
        await this.children(node, props, st)
        return
      case 'smartTag': {
        // 智能标记（v0.154）：Word 2003 那一代的「认出这是个地址/人名/日期」的包裹壳，
        // 现在已废弃——壳本身对排版与文字都没有后果（上面 sdt 那一支同款：原样下钻），
        // 但 element（认出的是哪一类）与 uri（那一类的命名空间）是它仅有的两枚信息，
        // 只读记账。字一个都不少：下钻照旧
        attrL(node, 'element')
        attrL(node, 'uri')
        await this.children(node, props, st)
        return
      }
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
        // 修订身份（v0.155）：`w:id` 是这一枚修订的唯一号（Word 靠它对账「这条改动」）。
        // **只读记账**：我们往返的是作者与时间，号是 Word 自己的计数——照抄会让两枚
        // 不同修订撞号，重编又不该由我们决定
        attr(node, 'w:id')
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
    // 容器壳（v0.148）：位图出得来才有壳可挂——解不开字节时那张图本来就没进文档
    const shell = readImgPayload(el)
    // 裁剪四边（v0.153）：VML 的 v:imagedata 用 croptop/cropright/cropbottom/cropleft
    // 从各边裁掉一段，CSS 的 clip-path:inset() 有直接对应物——这是老式壳里唯一屏上
    // 真能兑现的一族（其余壳属性零兑现）。**单边通道**：写侧只发 DrawingML 内嵌图，
    // 裁剪写不回 docx，所以导出去的图是没裁的——读得进、写不出的又一处，如实记在
    // 审计文档里，不靠「反正屏上看着对」糊过去
    // 只在 VML 那一支上读裁剪：crop 四边是 v:imagedata 的属性，a:blip（DrawingML）身上
    // 没有这组属性，混着读一次就是在账本上记四枚「读手问过 blip 要 crop」的假对——
    // 与 noteVmlShellMarks 只在 w:pict 里扫是同一个道理
    const clip = imgClipCss(el)
    // 图形变换（v0.155）：旋转与翻转，与裁剪同挂一张图的 style
    const tf = imgTransformCss(el)
    const style = [clip, tf].filter(Boolean).join(';')
    return `<img src="data:${mime};base64,${b64}"${size}${style ? ` style="${style}"` : ''}${alt ? ` alt="${esc(alt)}"` : ''}${shell ? ` ${IMG_ATTR}="${esc(shell)}"` : ''}>`
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
    // 表级单元格间距（v0.154）：w:tblCellSpacing 的 w:w 与 w:type。CSS 的 border-spacing
    // 是它的对应物，但**只在 border-collapse: separate 下生效**——表声明了间距就得切到
    // separate（Word 那边同样是「有间距就不共享格边」）。dxa 档是缇，pct 档的基数是表宽
    // 而 CSS 的 border-spacing 不收百分比，如实告警、仍走载荷往返。
    // 同一标签多枚元素都扫：真实件里 type 与 w 同住一枚 w:tblCellSpacing 上，但分着写的
    // 也见过——按出现序取首个非空，与 v:rect 四边同款
    let spW: number | undefined
    let spType = ''
    for (const sp of all(tblPr, 'w:tblCellSpacing')) {
      if (spW === undefined) spW = attrNum(sp, 'w')
      if (!spType) spType = (attr(sp, 'w:type') ?? '').toLowerCase()
    }
    if (spW !== undefined && spType && spType !== 'dxa') this.warn(`表单元格间距档位 w:tblCellSpacing/@w:type=${spType} 未保留（CSS 的 border-spacing 不收百分比）`)
    // 表与浮动对象重叠的许可（v0.154）：Word 用 w:tblOverlap 记「这张表能不能和浮动的
    // 图叠在一起」。Web 流式排版没有浮动层，屏上零兑现，只按名查问上账
    attr(find(tblPr, 'w:tblOverlap'), 'w:val')
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
    // 单元格间距的屏上那一半（v0.154）：有间距就必须同时切到 separate——
    // CSS 的 border-spacing 在 collapse 下被忽略，而 Word 有间距时也不共享格边
    const spCss = spW !== undefined && spW > 0 && (!spType || spType === 'dxa') ? `border-collapse: separate; border-spacing: ${px2(spW * TWIP_PX)}px` : ''
    const tblStyle = [tblInd ? tableIndentCss(Math.round(tblInd * TWIP_PX)) : '', spCss].filter(Boolean).join('; ')
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
    // 表级条件格式尺寸（v0.152）：两枚 bandSize，屏上不兑现只往返
    const tblprAttr = readTblPrPayload(tblPr)
    // 表条件格式落点十三枚（v0.162）：屏上零兑现，只随 data-cnf 往返
    const cnfAttr = readCnfPayload(tblPr)
    // 表级边框六边原值（v0.163）：屏上那一半走「分摊到格」那一趟（上面 tbSpace 已经在跑），
    // 这一趟只把原件照带回去——两趟值是两回事，不能互相顶替
    const tblbAttr = readTblbPayload(tblBordersEl)
    let s = `<table${tblStyle ? ` style="${tblStyle}"` : ''}${ownerAttr}${tblpAttr ? ` data-tblp="${tblpAttr}"` : ''}${tlookAttr ? ` ${TLOOK_ATTR}="${tlookAttr}"` : ''}${tblprAttr ? ` ${TBLPR_ATTR}="${tblprAttr}"` : ''}${cnfAttr ? ` ${CNF_ATTR}="${cnfAttr}"` : ''}${tblbAttr ? ` ${TBLB_ATTR}="${tblbAttr}"` : ''}>`
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
      // v0.155：行属性余量三枚——gridAfter（这一行末尾空过几格）与 wAfter（行末留白，
      // w 是缇、type 是档位）。三枚都不改屏上：gridAfter 是网格记账用的补白格（我们按
      // 网格列还原合并，补白格在 HTML 里本来就不画），行末留白是 Word 排版期的余量。
      // 纯只读记账——写侧发不出（包没有这两枚元素的槽）
      if (trPr) {
        const ga = find(trPr, 'w:gridAfter')
        if (ga) attr(ga, 'w:val')
        const wa = find(trPr, 'w:wAfter')
        if (wa) {
          attr(wa, 'w:w')
          attr(wa, 'w:type')
        }
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
        // 存盘原件（v0.164）：逐格/条件层/样式层取一之后那一枚 w:shd 的主题引用，
        // 与屏上渲染同一个来源——否则「看到的色」与「写回去的色」会各说各的
        const shdAttr = shdOriginOf(shd, this.themeColors)
        // 逐格边框间距（v0.143）：只从 direct 层 w:tcPr/w:tcBorders 读——条件层与表级的
        // space 不叠加（单元格共用边框，padding 会重复计数），忽略
        const tcBordersEl = tcPr ? find(tcPr, 'w:tcBorders') : undefined
        // 边框的存盘原件（v0.165）：与 `cb` 同一层（只 direct）——条件层与表级那一趟
        // 是「屏上分摊」，写侧并没有把它们发成逐格 tcBorders，补丁位对不上
        const bdrAttr = tcBordersEl ? borderOrigin(tcBordersEl, cb) : ''
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
        // 条件层的 run（v0.169）：目前只有「首行加粗」这一枚进了快照。它此前只跟着
        // styles.xml 回去、屏上从没兑现——表里首行该粗不粗，而 Word 打开是粗的
        const condRun = condRunFor(look, conds, ri, ri === last, c.gc, c.colspan, acct.length)
        const cellRun: RunProps = condRun.bold ? { b: true } : NONE
        const style = [cellStyleCss(tcPr, {
          top: cb.top ?? cb2.top ?? (ri === 0 ? tb.top : tb.insideH),
          bottom: cb.bottom ?? cb2.bottom ?? (ri === last ? tb.bottom : tb.insideH),
          left: cb.left ?? cb2.left ?? (c.gc === 0 ? tb.left : tb.insideV),
          right: cb.right ?? cb2.right ?? (c.gc + c.colspan >= rowEnd ? tb.right : tb.insideV),
        }, shadingCss(shd, this.themeColors)), mar].filter(Boolean).join('; ')
        if (style) attrs.push(`style="${style}"`)
        if (shadeAttr) attrs.push(`data-shade="${shadeAttr}"`)
        if (shdAttr) attrs.push(`${SHD_ATTR}="${shdAttr}"`)
        if (bdrAttr) attrs.push(`${BDR_ATTR}="${bdrAttr}"`)
        // 单元格不换行（v0.152）：屏上那一半由 cellStyleCss 的 white-space 兑现，
        // 这一枚载荷只为写侧认回（白-space 会与用户手设的样式混，不放载荷里认）
        if (on(find(tcPr, 'w:noWrap'))) attrs.push('data-nowrap="1"')
        for (const [k, v] of Object.entries(bdSpaceAttrs(bdSpace))) attrs.push(`${k}="${v}"`)
        s += `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${await this.cellBlocks(c.el, cellRun)}</${tag}>`
      }
      s += '</tr>'
    }
    return s + '</table>'
  }

  /** 单元格内容：段落走"格内列表"的独立栈（不与外层正文的列表串台），嵌套表格出真表 */
  private async cellBlocks(tc: XEl, runSeed: RunProps = NONE): Promise<string> {
    const list = new ListState()
    let html = ''
    for (let i = 0; i < tc.children.length; i++) {
      const b = tc.children[i]
      if (typeof b === 'string') continue
      const t = local(b.name)
      if (t === 'p') html += await this.paragraph(b, list, true, this.betweenOfSiblings(tc.children, i), runSeed)
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
  // 主题色优先（accent1 一族在边框上真件 34 枚），字面 w:color 是兜底。
  // v0.164：字面值恒查问（`??` 的右侧不进探针账；表级那一趟 v0.163 已改成无条件取原值，
  // 这一处管的是段落 pBdr 与逐格 tcBorders——同一形状的两处，不能只改一处）
  const literal = attr(b, 'w:color')
  const hex = themeRefCss(tc, b) ?? rgb2hex(`#${(literal ?? '').replace(/^#/, '').toLowerCase()}`) ?? '#000000'
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

/**
 * 段落第五边 `w:between` 的存盘原件（v0.167）：`data-pbdr` 载荷。
 *
 * 它没有 `bd*` 槽，所以线型/粗细/间距四枚也得自己带——四边那几枚能从 CSS 反推，
 * 这一条反推不出来。`shown` 是本段有没有轮到这个 between 上屏（串尾、或被显式
 * 下边框顶掉时它不画）：没画的那一段屏上没有替身，写侧不做「改过色没有」的判据。
 */
function pbdrOrigin(el: XEl | undefined, css: Record<string, string | undefined>, shown: boolean): string {
  const b = el ? find(el, 'w:between') : undefined
  if (!b || !css.between || css.between === 'none') return ''
  const v = attr(b, 'w:val')
  const sz = attr(b, 'w:sz')
  const sp = attr(b, 'w:space')
  const c = attr(b, 'w:color')
  const parts = themeRefParts(b)
  const screen = (borderParts(css.between)?.hex ?? '').replace('#', '').toUpperCase()
  return pbdrPayload({
    ...(v ? { val: v } : {}),
    ...(sz ? { sz } : {}),
    ...(sp !== undefined ? { space: sp } : {}),
    ...(c ? { color: c } : {}),
    ...(parts.ref ? { themeColor: parts.ref } : {}),
    ...(parts.tint ? { themeTint: parts.tint } : {}),
    ...(parts.shade ? { themeShade: parts.shade } : {}),
    ...(screen ? { screen } : {}),
    ...(shown ? {} : { hidden: '1' }),
  })
}

/**
 * 段落第六条边 `w:bar` 的存盘原件（v0.168）：`data-pbar` 载荷。
 *
 * 比 between 简单：屏上没有替身（读手从来没画过它），所以没有 `screen`、也没有
 * `hidden`——前七格与 `data-pbdr` 同一套定序，写侧「有就插一枚」。
 */
function barOrigin(el: XEl | undefined): string {
  const b = el ? find(el, 'w:bar') : undefined
  if (!b) return ''
  const v = attr(b, 'w:val')
  const sz = attr(b, 'w:sz')
  const sp = attr(b, 'w:space')
  const c = attr(b, 'w:color')
  const parts = themeRefParts(b)
  return pbdrPayload({
    ...(v ? { val: v } : {}),
    ...(sz ? { sz } : {}),
    ...(sp !== undefined ? { space: sp } : {}),
    ...(c ? { color: c } : {}),
    ...(parts.ref ? { themeColor: parts.ref } : {}),
    ...(parts.tint ? { themeTint: parts.tint } : {}),
    ...(parts.shade ? { themeShade: parts.shade } : {}),
  })
}

/**
 * 边框的存盘原件（v0.165）：`data-bdr` 载荷。
 *
 * `borderEdges` 交出去的是**解析后的屏上色**，模型里 `bd*` 那一格也只装得下它；源件
 * 每条边上那四枚（字面色 + themeColor/tint/shade）于是在导出时整笔消失。这里按边把
 * 它们另存一份，`screen` 记导入那一刻的屏上色——写侧拿它当「用户改过色没有」的判据。
 *
 * 只收「有话说」的边：字面色与屏上色一致、且三枚引用一枚都没有 —— 那种边写手本来
 * 就写得对，进载荷只是给补丁位多添一条对不上的账。
 */
function borderOrigin(el: XEl | undefined, css: Record<string, string | undefined>): string {
  if (!el) return ''
  const out: BdrOrigin[] = []
  for (const edge of CELL_EDGES) {
    const shown = css[edge]
    // 'none' 是显式去边：没有线可画，颜色与主题引用都不参与渲染
    if (!shown || shown === 'none') continue
    const box = find(el, `w:${edge}`)
    if (!box) continue
    const screen = (borderParts(shown)?.hex ?? '').replace('#', '').toUpperCase()
    if (!screen) continue
    const color = attr(box, 'w:color')
    // 显式 `w:space="0"`（v0.168）：CSS 的 padding 没有「0 与没写」的区别，写手发不回来，
    // 所以只把这一档记进载荷。非零值不用记——padding 那条链已经能原样还原
    const space = attr(box, 'w:space')
    // 三枚引用交给 themeRefParts：它是「按名查问这三枚」的唯一出口——在这里再手写一遍
    // attr 会让 no-themeshade 那条变异腿失真（查问多了一条不受注入影响的路径）
    const parts = themeRefParts(box)
    const themeColor = parts.ref || undefined
    const themeTint = parts.tint
    const themeShade = parts.shade
    const sameLiteral = (color ?? '').toLowerCase() === screen.toLowerCase()
    // 显式 space="0" 也算「有话说」：字面与屏上色一致、没有主题引用时，这条边本来
    // 什么都不用补——但 space=0 这一档只有载荷记得住（v0.168）
    if (!themeColor && !themeTint && !themeShade && sameLiteral && space !== '0') continue
    out.push({
      edge,
      ...(color ? { color } : {}),
      ...(themeColor ? { themeColor } : {}),
      ...(themeTint ? { themeTint } : {}),
      ...(themeShade ? { themeShade } : {}),
      screen,
      ...(space === '0' ? { space: '0' } : {}),
    })
  }
  return bdrPayload(out)
}

/** `w:shd` 的 `w:fill` → 规范 hex；auto/无填充/纯白都给 null（白底等于没底纹） */
function shadingHex(shd: XEl | undefined, tc?: ThemeColors): string | null {
  if (!shd) return null
  // 主题填充优先（真件 31 枚带 themeFill），字面 fill 是兜底
  const themed = themeRefCss(tc, shd, 'w:themeFill', 'w:themeFillTint', 'w:themeFillShade')
  // v0.164：字面值**无条件按名查问**。写成 `themed ?? attr(shd,'w:fill')` 时，主题解析
  // 得出来那一支根本不求值——`w:fill` 那枚属性等于没被读过（与 v0.163 的 `w:color` 同形：
  // 漏的方向是分母变小，账面上看不出来）。这里取原值只为了「读过」，主次仍按主题优先
  const literal = attr(shd, 'w:fill')
  const fill = themed ?? literal ?? ''
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
  // v0.164：前景色**先按名查问**再谈档位。clear/none/nil 三档在 Word 里不画前景（那枚
  // w:color 写了也不参与渲染），旧写法在这一行就 return，于是「只有 clear 底纹的件」上
  // 这枚属性永不进账——查问与解析解耦，连明摆着不用的也得先问一声
  const literal = attr(shd, 'w:color')
  if (v === 'clear' || v === 'none' || v === 'nil') return null
  // 前景色与字色/边框同一套优先级：主题引用优先，字面 w:color 兜底
  const fg = themeRefCss(tc, shd) ?? rgb2hex(`#${(literal ?? '').replace(/^#/, '')}`)
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
 * 底纹的**存盘原件**（v0.164）→ data-shd 载荷。只在 `w:themeFill` 在场时给：
 * 那一枚解析得出来，`background` 装的就成了「屏上色」，字面 `w:fill` 无处安放。
 *
 * 载荷里带一枚 `bg`（导入那一刻的屏上色，不带 #）：回写时拿它与当前的 background 比，
 * 对不上就说明用户在编辑器里改过底纹色——那时主题引用作废，改色是显式决定。
 */
function shdOriginOf(shd: XEl | undefined, tc?: ThemeColors): string | null {
  if (!shd) return null
  const theme = themeRefParts(shd, 'w:themeFill', 'w:themeFillTint', 'w:themeFillShade')
  if (!theme.ref) return null
  const fill = attr(shd, 'w:fill')
  const p: ShdPayload = {
    ...(fill ? { fill } : {}),
    themeFill: theme.ref,
    ...(theme.tint ? { themeFillTint: theme.tint } : {}),
    ...(theme.shade ? { themeFillShade: theme.shade } : {}),
  }
  // 判据取**解析结果**（不是 shadingHex 的出口）：后者把纯白折成 null，
  // 白底件就没有比对基准了
  const resolved = themeCssOf(tc, theme)
  if (resolved) p.bg = resolved.replace('#', '')
  return shdPayloadOf(p)
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
  // 单元格不换行（v0.152）：w:tcPr/w:noWrap。CSS 的 white-space: nowrap 正是这一个——
  // 屏上直接兑现，与 vAlign 同属「有现成对应物」的一族
  if (on(find(tcPr, 'w:noWrap'))) bits.push('white-space: nowrap')
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
  /**
   * 条件层对文字的 run（v0.169）：目前只收 `w:rPr/w:b`——首行加粗是最常见的一条。
   * 此前它只跟着 styles.xml 回去，屏上从没兑现：表里首行该粗不粗，Word 打开却是粗的
   */
  bold?: boolean
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
      // 条件层的 run（v0.169）：只认 `w:rPr/w:b`。空元素与 val=1 都算开（ST_OnOff）
      const bold = on(find(find(pr, 'w:rPr'), 'w:b'))
      if (
        Object.keys(mar).length ||
        Object.keys(tblMar).length ||
        shd ||
        Object.keys(borders).length ||
        thv !== undefined ||
        bold
      ) {
        const k = asTableCondType(type)
        if (k)
          out[k] = {
            mar,
            tblMar,
            shd,
            ...(bold ? { bold } : {}),
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
/**
 * 这一格吃到的条件层 run（v0.169）：目前快照里只有 `bold` 一枚，按外观梯子取第一个
 * 说了话的档。表样式对表内文字的那份 `w:rPr`（非条件层）还没接——它是**常驻**的
 * 一层，不与位置相关，要接得另走一条（顺延）。
 */
function condRunFor(
  look: Record<string, boolean>,
  conds: Record<string, CondCell>,
  ri: number,
  isLastRow: boolean,
  gc: number,
  colspan: number,
  cols: number,
): { bold?: boolean } {
  for (const t of condLadderAppearance(look, ri, isLastRow, gc, colspan, cols)) {
    const c = conds[t]
    if (c?.bold) return { bold: true }
  }
  return {}
}

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
  // v0.154：部件根上的 mc:Ignorable（与 numbering/styles 两处同款——v0.152 收的那两枚
  // 的第三、四处）。「这个部件身上声明了哪些可忽略的命名空间」读写两侧都用不上
  // （我们照单全收、不挑命名空间），但它是这一份件的身份的一部分，只读记账
  attrL(root, 'Ignorable')
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

/**
 * 批注部件（v0.154）：word/comments.xml 的 `w:comment` 四枚（id/author/date/initials）、
 * word/commentsExtended.xml 的 `w15:commentEx/@w15:done`，加两份部件根上的 mc:Ignorable。
 *
 * 原来保真路径与 mammoth 兜底路径共用 `docx.ts` 的 `commentRowsOf`——那是**正则**读的，
 * 不进 attr 漏斗，于是「批注是谁写的、什么时候写的」在保真账本上是盲区（读是读了、
 * 账上没有，与 v0.147 之前节属性那一处欠账同一款）。保真路径改走漏斗，兜底路径不动。
 *
 * `initials`（作者姓名缩写）与 author 同属批注身份链，目前只随模型带走、UI 不显示——
 * 写侧也不回写（批注是"另存时原样带回去"的那一类，不是我们生成的）。
 */
function readComments(commentsXml: string, extXml: string): DocComment[] {
  const out: DocComment[] = []
  if (!commentsXml.trim()) return out
  const root = findDesc(parseXml(commentsXml), 'w:comments')
  if (!root) return out
  attrL(root, 'Ignorable')
  // 已解决的那几条：commentsExtended 里 done="1" 的 paraId。Word 写 w15: 前缀的属性式，
  // docx 库写 w15:val 元素式——按 local name 收，两种形态都认
  const done = new Set<string>()
  if (extXml.trim()) {
    const ext = findDesc(parseXml(extXml), 'w:commentsEx')
    if (ext) {
      attrL(ext, 'Ignorable')
      for (const ex of allDesc(ext, 'commentEx')) {
        const pid = attrL(ex, 'paraId')
        const d = onOff(attrL(ex, 'done'))
        if (pid && d) done.add(pid.toUpperCase())
      }
      // 创建会话号（v0.155）：`w15:creationId/@w15:id`，这条批注是哪一次编辑会话建的
      // （Word 靠它把同一次回复串里的批注认成一串）。**只读记账**：comments.xml 那条链
      // 我们只按 id/作者/时间/正文重建，这一枚是 Word 的会话账，写回去等于替它编会话号。
      // 位置不稳定——既见过它是 commentEx 的子元素，也见过与 commentEx 平级摆
      // （`cx:b0` 那一枚就是平级），所以按整树查问，两种形态都收
      for (const cid of allDesc(ext, 'creationId')) attrL(cid, 'id')
    }
  }
  for (const c of all(root, 'w:comment')) {
    const id = Number(attr(c, 'w:id'))
    if (!Number.isFinite(id)) continue
    const author = attr(c, 'w:author')
    const date = attr(c, 'w:date')
    const initials = attr(c, 'w:initials')
    // 批注正文：与脚注同口径，段落之间换行
    const text = all(c, 'w:p').map((p) => plainText(p)).join('\n')
    // 段落身份（w14:paraId）：把这条批注与 commentsExtended 里那条 done 对上
    let paraId: string | undefined
    for (const p of allDesc(c, 'p')) {
      const v = attrL(p, 'paraId')
      if (v) {
        paraId = v
        break
      }
    }
    out.push({
      id,
      text,
      ...(author ? { author } : {}),
      ...(date ? { date } : {}),
      ...(initials ? { initials } : {}),
      ...(paraId && done.has(paraId.toUpperCase()) ? { resolved: true } : {}),
    })
  }
  return out.sort((a, b) => a.id - b.id)
}

function plainText(el: XEl): string {
  return allDesc(el, 't')
    .map((c) => textOf(c))
    .join('')
}

// ---- 入口 ------------------------------------------------------------------

/**
 * 文档级标记（v0.150）：`w:proofErr`（Word 的拼写/语法检查标记，body 直子——块遍历
 * 不碰它）、`mc:Choice`（AlternateContent 的兼容分支，dispatch 那一族只认首选）与
 * `w:document` 根上的 `mc:Ignorable`（「这些前缀不认识的读者可以忽略」的白名单）。
 * 三枚都不改屏上排版，也都没有 PM 承载点（编辑器不存「这里有个拼写错误」），所以是
 * **只读记账**：读手按名查问过、上保真账，写侧不写。
 */
function noteDocumentMarks(doc: XEl | undefined): void {
  if (!doc) return
  // parseXml 出来的是 #doc 壳，真根在它下面一层
  const root = els(doc)[0]
  if (root) attrL(root, 'Ignorable')
  for (const pe of allDesc(doc, 'proofErr')) attr(pe, 'w:type')
  for (const ch of allDesc(doc, 'Choice')) attrL(ch, 'Requires')
}

/**
 * 形状壳标记（v0.151）：`wps:wsp`（DrawingML 形状/文本框）那一层壳。
 *
 * 文本框的**内容**由 drawing() 展平成段落落进文档流，但壳本身——`a:style` 的四枚样式
 * 矩阵引用（lnRef/fillRef/effectRef/fontRef 的 idx，各带一枚 schemeClr）、`a:bodyPr`
 * 的文本盒属性一族、`wps:cNvSpPr` 的 txBox——不在任何读手路径上：wsp 段里通常没有
 * a:blip，readImgPayload 的 bitmap 短路链第一步就断（v0.148 的 d:inline、v0.149 的
 * v:fill/stroke、v0.150 的 v:path 三度踩过的那个坑的第四形态）。
 *
 * 与 noteDocumentMarks 同款**只读记账**：屏上零兑现（Web 没有文本框与样式矩阵），
 * 写侧也写不出（包只发 pic:pic 与内嵌图，wps 那一支出不来）。跑正文前按名查问一遍。
 */
function noteShapeMarks(doc: XEl | undefined): void {
  if (!doc) return
  // 样式矩阵四枚引用：idx 是「用主题样式矩阵第几列」。fontRef 的 idx 是字体槽位名
  // （minor/major/none），另三枚是整数——查问时不解析，原值上账
  for (const el of allDesc(doc, 'lnRef')) attrL(el, 'idx')
  for (const el of allDesc(doc, 'fillRef')) attrL(el, 'idx')
  for (const el of allDesc(doc, 'effectRef')) attrL(el, 'idx')
  for (const el of allDesc(doc, 'fontRef')) attrL(el, 'idx')
  // txBox：这一枚形状是文本框（1）还是纯形状（0）。onOff 三态
  for (const el of allDesc(doc, 'cNvSpPr')) onOff(attrL(el, 'txBox'))
  // bodyPr 一族：CT_TextBodyProperties 的全部属性。19 枚全查问（不逐枚判存在——
  // 每一枚的查问本身就是账本要的那一次按名访问）
  for (const el of allDesc(doc, 'bodyPr')) {
    for (const n of BODYPR_ATTRS) attrL(el, n)
  }
  // 样式引用里的 schemeClr：val 是主题色槽位名。图片段那枚由 readImgPayload 收
  // （段内有 blip，短路链通），这里补 wsp 段那枚——两处都查问，同对只记一次
  const sc = findDesc(doc, 'schemeClr')
  if (sc) attrL(sc, 'val')
  // a:spLocks（v0.154）：形状自己的两把锁——不许改箭头、不许改顶点。与 a:picLocks
  // （图片那一把，readImgPayload 收）是同一族的两支，壳上零兑现（Web 没有"锁定编辑"），
  // 只读记账
  for (const el of allDesc(doc, 'spLocks')) {
    onOff(attrL(el, 'noChangeArrowheads'))
    onOff(attrL(el, 'noEditPoints'))
  }
}

/**
 * VML 形状壳余量（v0.153）：`w:pict` 里老式形状各族的属性面——v:shape 那七枚
 * （v0.149 起的）之外，roundrect / line / rect / shapetype / group / textbox 几个
 * 老式形状壳，加它们的填充（v:fill）、描边（v:stroke）、阴影（v:shadow）、图元路径
 * （v:path 的连接开关们）、公式（v:f）、手柄（v:h / v:cxn）、画布（v:chExt / v:chOff）
 * 与遗留开关（w10:wrap / v:rot / o:cxnSpLocks）这一整片。
 *
 * 三条与前几轮一致的边界：
 * 1. **gfxdata 一律不收**（v0.149 裁定）：Word 缓存的图元字节（base64 blob），挂 HTML
 *    属性性价比极差，写侧也写不回——roundrect/line/rect/shape/group 五处都不列它。
 * 2. **纯只读记账**：屏上零兑现（Web 没有 VML 图元引擎，也没有老式形状），写侧只发
 *    DrawingML，这一族一个属性都回不去。查问它的意义是把「读手认得这枚属性」上账，
 *    与 noteDocumentMarks / noteShapeMarks 同款。
 * 3. **按 local name 查**：VML 的 o: / w10: 前缀各家发得不一样（o:lock 与 v:lock 都
 *    见过），按前缀无关匹配才认得全。
 */
const VML_SHELL_ATTRS: Record<string, readonly string[]> = {
  // 圆角矩形：arcsize 是圆角弧度（VML 的分数串），其余与 v:shape 同族
  roundrect: ['id', 'spid', 'spt', 'style', 'coordsize', 'arcsize', 'fillcolor', 'filled', 'strokecolor', 'stroked', 'strokeweight', 'anchorId'],
  // 直线：from/to 是两个端点（「x,y」串），allowincell 是「允许放进表格单元格」
  line: ['id', 'spid', 'spt', 'style', 'coordsize', 'from', 'to', 'fillcolor', 'filled', 'strokecolor', 'stroked', 'strokeweight', 'allowincell', 'anchorId'],
  // 矩形（v0.151 已收四边 l/t/r/b，这里补剩下的）
  rect: ['id', 'spid', 'spt', 'style', 'coordsize', 'fillcolor', 'filled', 'strokecolor', 'stroked', 'strokeweight', 'allowincell'],
  // 形状（v0.149 已收七枚，这里补 adj/alt/bullet/connectortype/coordorigin/ole 等）
  shape: ['adj', 'alt', 'anchorId', 'bullet', 'connectortype', 'coordorigin', 'ole', 'preferrelative', 'strokecolor', 'strokeweight'],
  // 形状模板：<v:shapetype> 是可复用形状的模板，oned 是「单手柄形状」开关
  shapetype: ['adj', 'anchorId', 'coordsize', 'filled', 'id', 'oned', 'path', 'preferrelative', 'spt', 'stroked'],
  // 分组画布（v0.150 已收五枚，补 editas 与 spt）
  group: ['anchorId', 'editas', 'spt'],
  // 文字盒：inset 是四边内缩，style 常是 mso-fit-shape-to-text 之类
  textbox: ['inset', 'style'],
  // 图元路径的连接开关：arrowok/extrusionok/fillok/gradientshapeok/textboxrect 一串
  // 「这条路径允许哪种变换」，connecttype 是连接点类型
  path: ['arrowok', 'connecttype', 'extrusionok', 'fillok', 'gradientshapeok', 'textboxrect'],
  // 阴影：on/val 是开关与强度，dir/dist 是方向与距离，kx/ky/sx/sy 是斜切与缩放，
  // algn/origin 是原点对齐。VML 阴影与 CSS box-shadow 不同源（这里没有颜色可挂），只记账
  shadow: ['algn', 'blurRad', 'dir', 'dist', 'kx', 'ky', 'offset', 'on', 'opacity', 'origin', 'sx', 'sy', 'val'],
  // 填充（v0.149 已收 on/focussize）：type 是填充类型、color2 是渐变第二色、
  // colors 是渐变色串、rotate 是渐变转角、recolor 是「跟随主题重着色」
  fill: ['color2', 'colors', 'ext', 'focus', 'focusposition', 'id', 'opacity', 'opacity2', 'recolor', 'rotate', 'title', 'type'],
  // 描边（v0.149/0.151 已收五枚）：dashstyle 虚线样式、startarrow/endarrow 箭头、endcap 端帽
  stroke: ['dashstyle', 'endarrow', 'endcap', 'startarrow'],
  // 图片数据的裁剪四边（v0.149 已收 o:title）——这四个是**唯一会落到 CSS 的一族**，
  // 由 readImgPayload/bitmap 读出来渲染成 clip-path，这里再按名查问一遍上账
  imagedata: ['cropbottom', 'cropleft', 'cropright', 'croptop'],
  // 形状锁（v0.149 已收 aspectratio/ext）：shapetype 是「锁在哪个模板上」
  lock: ['shapetype'],
  // 三维旋转（lat/lon/rev 是纬度/经度/绕轴角）
  rot: ['lat', 'lon', 'rev'],
  // 隐藏线宽（表格里被隐藏的边框线）
  hiddenLine: ['w'],
  // 渐变填充的两种取景框（v:fill 的子元素）
  fillRect: ['b', 't'],
  fillToRect: ['b', 'l', 'r', 't'],
  // 线性渐变的角度与「是否随形缩放」
  lin: ['ang', 'scaled'],
  // 手柄：position 是坐标、xrange/yrange 是活动范围
  h: ['position', 'xrange', 'yrange'],
  // 画布尺寸与原点（v:group 的子元素，EMU 之外的另一套坐标）
  chExt: ['cx', 'cy'],
  chOff: ['x', 'y'],
  // 公式：<v:formulas><v:f eqn="sum 0 0 0"/></v:formulas>
  f: ['eqn'],
  // 遗留环绕（Word 97-2003 的 w10:wrap）：anchorx/anchory 是锚点参照、side 是环绕边
  wrap: ['anchorx', 'anchory', 'side', 'type'],
  // 连线锁：不允许改形状类型
  cxnSpLocks: ['noChangeShapeType'],
}

/**
 * VML 壳余量的按名查问（v0.153）。
 *
 * 只在 `w:pict` 子树里扫——VML 老式形状只住在这一支里，全局扫会和别处的同 local name
 * 撞车（比如 OMML 的 m:f 也叫 f， DrawingML 里也有 a:cxnSpLocks）。这一点比多扫几个
 * 元素重要：**账本记的是「读手在这一支上认得这枚属性」**，撞名记出来的对是假账。
 *
 * 同一标签的多枚元素都扫（不取首枚了事）：真实件里一个 pict 常有好几个 v:shape /
 * v:line，各自带自己的 id/style，只认第一枚等于把其余几枚的属性当不存在。
 */
function noteVmlShellMarks(doc: XEl | undefined): void {
  if (!doc) return
  for (const pict of allDesc(doc, 'pict')) {
    for (const tag of Object.keys(VML_SHELL_ATTRS)) {
      for (const el of allDesc(pict, tag)) {
        for (const n of VML_SHELL_ATTRS[tag]) attrL(el, n)
      }
    }
  }
  // 嵌入对象那一支（w:object + o:OLEObject）不在 w:pict 下（与 w:drawing 平级），
  // 单列两条：dxaOrig/dyaOrig 是原始尺寸（缇），DrawAspect/ObjectID/ShapeID 是
  // OLE 的显示方式与两个身份号（ProgID/Type 已由 embed 路径读了）
  for (const el of allDesc(doc, 'object')) {
    attrL(el, 'dxaOrig')
    attrL(el, 'dyaOrig')
  }
  for (const el of allDesc(doc, 'OLEObject')) {
    attrL(el, 'DrawAspect')
    attrL(el, 'ObjectID')
    attrL(el, 'ShapeID')
  }
}

/**
 * 表条件格式的落点开关（v0.154）：`w:cnfStyle` 十三枚——这一格/这一行/这一列算不算
 * 「首行/末行/奇偶数行/首列/末列/四角」，Word 的表样式靠这十三枚决定套哪一档条件格式。
 *
 * 屏上零兑现（我们没有表样式的条件层，tblLook 那道闸门只管样式自己声明的那几档），
 * 写侧也发不出（包只发它认得的表属性），是纯只读记账。
 *
 * 按整树扫而不按 tblPr/tcPr 找：这一枚在真件里两种容器都住（表级 tblPr 与逐格 tcPr），
 * 而它的 local name 不与别家撞（cnfStyle 只此一处），整树扫不会记假账。
 */
// 名单与 cell-style.ts 的 CNF_KEYS 同源（v0.162：那一族从「纯记账」升成「只往返」后，
// 记账这一趟与往返那一趟必须读同一组名字——两份名单迟早会走散）
const CNF_STYLE_ATTRS = CNF_KEYS

function noteCnfStyleMarks(doc: XEl | undefined): void {
  if (!doc) return
  for (const el of allDesc(doc, 'cnfStyle')) {
    for (const n of CNF_STYLE_ATTRS) attrL(el, n)
  }
}

/**
 * DrawingML 图形余量（v0.155）：`w:drawing` 里那一整片读手没有路径的属性——
 * 颜色变换（alpha/alphaOff/hueOff/satOff/tint/prstClr/scrgbClr）、线端与箭头
 * （prstDash/headEnd/tailEnd）、效果（outerShdw/glow/reflection）、三维（lightRig/props3d）、
 * 填充与图形框的开关（blipFill/gradFill 的 rotWithShape 与 flip）、浮动定位的档位
 * （sizeRelH/sizeRelV/wrapSquare）、文字轮廓与艺术字变形（textOutline/prstTxWarp）、
 * 形状锁剩下的一枚（spLocks|noEditPoints）。
 *
 * **全部屏上零兑现**：Web 没有 DrawingML 的阴影/反射/三维模型/箭头端头，颜色变换要
 * 在色彩管理里做（浏览器不认），艺术字变形与文字轮廓也不在 CSS 里。写侧同样发不出
 * （包只发它认得的那几枚图形属性）。所以这一族与 noteVmlShellMarks 同格：按名查问、
 * 只读记账，不假装在屏上兑现了什么。
 *
 * 只在 `w:drawing` 子树里扫：这些 local name 有别家同名的（w: 命名空间里也有 tint、
 * VML 的 v:stroke 上有同名的 headEnd/tailEnd），整树扫会把别家那一支记成自己的账。
 */
const DRAWING_SHELL_ATTRS: Record<string, readonly string[]> = {
  alpha: ['val'],
  alphaOff: ['val'],
  hueOff: ['val'],
  satOff: ['val'],
  tint: ['val'],
  prstClr: ['val'],
  scrgbClr: ['r', 'g', 'b'],
  prstDash: ['val'],
  headEnd: ['type', 'w', 'len'],
  tailEnd: ['type', 'w', 'len'],
  outerShdw: ['algn', 'blurRad', 'dir', 'dist', 'rotWithShape'],
  glow: ['rad'],
  reflection: ['algn', 'blurRad', 'dir', 'dist', 'endA', 'endPos', 'fadeDir', 'kx', 'ky', 'stA', 'stPos', 'sx', 'sy'],
  lightRig: ['dir', 'rig'],
  // 三维形状属性：**两个名字都问**。universe 这一族记的是 `props3d`（17 次/枚），
  // 而 DrawingML 的 schema 里这个元素叫 `a:sp3d`（contourW/extrusionH/prstMaterial
  // 正好是它的三枚属性）。手上没有能判定谁对谁错的参考，就把两个 local name 都查问：
  // 问不存在的元素不产生账，问对了才上账——比赌一个名字安全
  sp3d: ['contourW', 'extrusionH', 'prstMaterial'],
  props3d: ['contourW', 'extrusionH', 'prstMaterial'],
  blipFill: ['rotWithShape'],
  gradFill: ['flip', 'rotWithShape'],
  sizeRelH: ['relativeFrom'],
  sizeRelV: ['relativeFrom'],
  wrapSquare: ['wrapText'],
  textOutline: ['algn', 'cap', 'cmpd', 'w'],
  prstTxWarp: ['prst'],
  spLocks: ['noEditPoints'],
  // 自定义几何的路径数据（v0.155）：`a:custGeom/a:pathLst/a:path@path`——一条
  // moveTo/lnTo/cubicBezTo 串起来的路径命令。**注意别与 VML 那枚撞**：VML 的
  // 路径数据挂在形状自己的 `path` 属性上（shape|path，v0.153 已收），`v:path`
  // 元素身上没有它。这里问的是 DrawingML 那一支，只在 w:drawing 子树里扫
  path: ['path'],
}

function noteDrawingMarks(doc: XEl | undefined): void {
  if (!doc) return
  for (const drawing of allDesc(doc, 'drawing')) {
    for (const tag of Object.keys(DRAWING_SHELL_ATTRS)) {
      for (const el of allDesc(drawing, tag)) {
        for (const n of DRAWING_SHELL_ATTRS[tag]) attrL(el, n)
      }
    }
  }
}

/** bodyPr（CT_TextBodyProperties）的属性面——noteShapeMarks 的查问清单 */
const BODYPR_ATTRS = [
  'anchor', 'anchorCtr', 'bIns', 'compatLnSpc', 'forceAA', 'fromWordArt',
  'horzOverflow', 'lIns', 'numCol', 'rIns', 'rot', 'rtlCol', 'spcCol',
  'spcFirstLastPara', 'tIns', 'upright', 'vert', 'vertOverflow', 'wrap',
] as const

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
  // 文档级标记（v0.150）：proofErr/Choice/Ignorable 三族不在任何读手路径上（块遍历不碰
  // proofErr、兼容分支不进分发、根属性没人读），在跑正文前先把它们按名查问一遍
  noteDocumentMarks(parseXml(documentXml))
  // 形状壳（v0.151）：wsp 文本框的壳（样式矩阵引用/bodyPr/txBox/schemeClr）同上——
  // 段内无 blip，图片短路链够不着，跑正文前按名查问
  noteShapeMarks(parseXml(documentXml))
  // VML 壳余量（v0.153）：老式形状那一整片（roundrect/line/rect/shapetype/…）与它们的
  // 填充、描边、阴影、路径、手柄。与 noteShapeMarks 同款——段内可能没有 blip（pict 里
  // 压根没图时 bitmap() 第一步就返回 null），图片短路链够不着，跑正文前按名查问。
  // 两份 documentXml 各 parse 一次是浪费，但这两族都在「跑正文前」这一格，与 run() 分开
  noteVmlShellMarks(parseXml(documentXml))
  // 表条件格式十三枚（v0.154）：w:cnfStyle 在 tblPr 与 tcPr 里都住，整树扫一遍
  noteCnfStyleMarks(parseXml(documentXml))
  // DrawingML 图形余量（v0.155）：w:drawing 里那一整片（颜色变换/线端/效果/三维/浮动档位）。
  // 与 VML 壳同款：读手没有路径，跑正文前在 w:drawing 子树里按名查问
  noteDrawingMarks(parseXml(documentXml))
  const { html, blocks } = await f.run(documentXml)
  // 文档背景（v0.155）：屏上是整篇的底色，包在正文外层给出去——底色属于画布不属段落，
  // 塞进任何一段的 style 都会在选中/复制时跟着文字走，含义就变了
  const bg = docBackgroundOf(parseXml(documentXml), themeColors)
  const html2 = bg?.css ? `<div style="background-color: ${attrEsc(bg.css)}">${html}</div>` : html
  // 节属性（v0.147）：body 末尾 sectPr 走 attr 漏斗读一遍。这一族原本是 docxToDocMeta
  // 用正则读的（正则不进漏斗，保真账本上是盲区——读是读了，账上没有）；改由读手读、
  // 随 DocxImport 出来后调用方折成 PageSetup，同一份数只有一个读数出处
  const section = sectionOf(parseXml(documentXml))
  return {
    html: html2,
    comments: f.comments,
    blocks,
    warnings: f.warningList(),
    styles: f.styleList(),
    ...(f.latentStyles ? { latentStyles: f.latentStyles } : {}),
    ...(section ? { section } : {}),
    ...(bg ? { background: bg } : {}),
    // 编号定义账（v0.150）：只有真说了话的定义才出去（空件与旧 meta 保持字节一致）
    ...(numbering.defs.length ? { numbering: { defs: numbering.defs } } : {}),
  }
}

/**
 * 文档背景（v0.155）：`w:document/w:background` 三枚——整篇的底色。Word 里「设计 → 页面颜色」
 * 写在 document.xml 的根上（不在 sectPr 里），是画布的底而不是段落的底。
 *
 * 屏上兑现在最外层容器的 background-color；往返两边都是原生槽（docx 的 Document 收
 * IDocumentBackgroundOptions，四枚属性与本族一一对应），所以这一族是**真双向**。
 */
export interface DocBackground {
  /** 解析出来的 CSS 色（主题引用优先于字面值，与 w:color 同款主次） */
  css?: string
  /** 字面色原文（v0.157）：主题槽在场时 Word 按主题算，这枚是它的兜底值，仍要原样写回 */
  color?: string
  themeColor?: string
  themeShade?: string
  themeTint?: string
}

function docBackgroundOf(doc: XEl | undefined, tc: ThemeColors | undefined): DocBackground | undefined {
  if (!doc) return undefined
  // 根是 #doc 壳，真根在下一层——与 sectionOf 同款（findDesc 深找）
  const bg = findDesc(doc, 'w:background')
  if (!bg) return undefined
  const out: DocBackground = {}
  // 查问与解析分开：themeRefCss 会把 themeColor/themeShade/themeTint 三枚都问一遍，
  // 主题没装（或槽名不认）时解析不出值，但那三枚属性仍算读过
  const themed = themeRefCss(tc, bg)
  const c = (attr(bg, 'w:color') ?? '').toLowerCase()
  if (themed) out.css = themed
  else if (c && c !== 'auto') out.css = '#' + c.replace(/^#/, '')
  // v0.157：字面色单独留一份。主题槽在场时上面那支只记解析结果，字面值就没人记得——
  // 往返账第一次跑就照出来：源里 `w:color="FFE699" w:themeColor="background1"`，
  // 写出包只剩 themeColor，字面这枚整条掉了（Word 用它兜底，主题缺失时才看得见）
  if (c && c !== 'auto') out.color = c
  const thc = attr(bg, 'w:themeColor')
  if (thc) out.themeColor = thc
  const ths = attr(bg, 'w:themeShade')
  if (ths) out.themeShade = ths
  const tht = attr(bg, 'w:themeTint')
  if (tht) out.themeTint = tht
  return out.css || out.themeColor ? out : undefined
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
    // 每字符网格宽度（v0.152）：与 linePitch 同住 w:docGrid 上的第三枚。写侧有库槽
    // （包的 grid.charSpace），与 linePitch 同路读写
    const cs = attrNum(grid, 'w:charSpace')
    if (cs !== undefined) g.charSpace = cs
    if (Object.keys(g).length) out.docGrid = g
  }
  // v0.155：节属性余量七枚——全是「说了也不改屏上排版」的元信息，屏上零兑现，
  // 写侧也没有对应槽（包只发纸型/页边距/分栏数这几枚），纯只读记账：
  //   type        —— 这一节从哪儿起（nextPage 另起一页 / continuous 接着排 / evenPage …）
  //   pgSz|code   —— 纸型的打印机档位号（Word 记住「用户选的是 A4 那一格」用的）
  //   pgNumType   —— 页码型别与起始值（我们没有分页视图，页码是域算的）
  //   cols|equalWidth / col|w|space —— 逐栏不等宽的分栏表（我们只支持等宽 N 栏）
  //   rtlGutter   —— 装订线落在右侧（从右往左书写的件）
  //   formProt    —— 这一节受窗体保护（只填表单域，其余不可改）
  const ty = find(sect, 'w:type')
  if (ty) attr(ty, 'w:val')
  if (pg) attr(pg, 'w:code')
  const pgn = find(sect, 'w:pgNumType')
  if (pgn) {
    attr(pgn, 'w:fmt')
    attr(pgn, 'w:start')
  }
  if (cols) {
    attr(cols, 'w:equalWidth')
    // 逐栏：w:cols 的 w:col 子们（不等宽分栏才有；等宽时 Word 不写这些子）
    for (const c of all(cols, 'w:col')) {
      attr(c, 'w:w')
      attr(c, 'w:space')
    }
  }
  const rg = find(sect, 'w:rtlGutter')
  if (rg) attr(rg, 'w:val')
  const fp = find(sect, 'w:formProt')
  if (fp) attr(fp, 'w:val')
  // 页眉页脚引用（v0.152）：sectPr 上的 headerReference/footerReference 两族。
  // **只读记账**：id 是关系 id（r:id），写侧发包时自己重新编——照抄会把关系指到
  // 别人身上；type（default/first/even）我们只发 default 一档，first/even 读回来也没处写
  // （PM 没有「首页另版页眉」这个节点，审计里记为只读一半）。与浮动锚点四枚同界
  for (const tag of ['headerReference', 'footerReference'] as const) {
    for (const ref of all(sect, `w:${tag}`)) {
      attrL(ref, 'id')
      attr(ref, 'w:type')
    }
  }
  return Object.keys(out).length ? out : undefined
}
