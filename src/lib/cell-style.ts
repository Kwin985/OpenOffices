import { Extension } from '@tiptap/core'
import type { CommandProps } from '@tiptap/core'
import { TableView } from '@tiptap/extension-table'
import type { Node } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { accountTotalPx } from './table-width'

/**
 * 单元格与表格的样式属性：让 Word/LibreOffice 带进来的边框、底纹、竖排对齐和表格缩进
 * 在编辑器里看得见、在 .odoc/docx/odt 三条保存链路上回得去。
 *
 * 边框统一存成规范化字符串（CSSOM 读回来就是这个形状，省掉两套表示）：
 * `"0.67px solid #8899aa"` 有边框，`"none"` 是原文件显式去掉了这条边，
 * `null` 才是「原文件没声明」——此时不写内联样式，落回应用自带的网格线。
 */

export type BorderSide = { px: number; style: string; hex: string }

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/

/** OOXML/CSS 的边框线型 → CSS 线型词（不认识的一律按 solid，别让一条怪线型把整张表丢掉） */
export const CSS_BORDER_STYLE: Record<string, string> = {
  none: 'none',
  hidden: 'none',
  // OOXML 的 nil 才是"压掉表级边框"，none 在 Word 里会被表级默认边框盖回去
  nil: 'none',
  solid: 'solid',
  single: 'solid',
  thin: 'solid',
  thick: 'solid',
  double: 'double',
  dotted: 'dotted',
  dashed: 'dashed',
  dotdash: 'dashed',
  dashdot: 'dashed',
  // Word 的「虚线」对话框档位实际写的是 dashSmallGap，点划线族同理——不列进来会静默读成实线
  dashsmallgap: 'dashed',
  dashlargegap: 'dashed',
  dotdotdash: 'dashed',
  dashdotstroked: 'dashed',
  triple: 'double',
  wave: 'solid',
  inset: 'inset',
  outset: 'outset',
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function to3(hex: string): string {
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex
}

/** `#abc` / `rgb(136, 153, 170)` / `136, 153, 170` → `#8899aa`；读不懂给 null */
export function rgb2hex(v: string): string | null {
  const s = v.trim().toLowerCase()
  if (HEX.test(s)) return to3(s)
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s)
  if (!m) return null
  const b = (x: string) => Math.max(0, Math.min(255, Math.round(Number(x)))).toString(16).padStart(2, '0')
  return `#${b(m[1])}${b(m[2])}${b(m[3])}`
}

/** CSS 声明值（浏览器 CSSOM 或我们自写的规范串）→ 规范串；无意义值给 null */
export function cssBorder(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return null
  if (v === 'none' || v === 'hidden') return 'none'
  const m = /^([\d.]+)(px|pt)?\s+(\S+)?\s*(.*)$/.exec(v)
  if (!m || !m[1]) return null
  const px = round2(parseFloat(m[1]) * (m[2] === 'pt' ? 4 / 3 : 1))
  if (px <= 0) return 'none'
  const style = CSS_BORDER_STYLE[(m[3] ?? 'solid').replace(/[(),]/g, '')] ?? 'solid'
  const hex = rgb2hex(m[4] ?? '') ?? '#000000'
  if (style === 'none') return 'none'
  return `${px}px ${style} ${hex}`
}

/** 规范串 → 分量；`null`/`'none'` 都返回 null，调用方自己区分「没声明」和「显式无边框」 */
export function borderParts(v: string | null | undefined): BorderSide | null {
  const c = cssBorder(v)
  if (!c || c === 'none') return null
  const m = /^([\d.]+)px\s+(\S+)\s+(\S+)$/.exec(c)
  if (!m) return null
  return { px: Number(m[1]), style: m[2], hex: m[3] }
}

export const CELL_EDGES = ['top', 'right', 'bottom', 'left'] as const
export type CellEdge = (typeof CELL_EDGES)[number]

/** 边的属性名是 schema 里那几个字面量，收成联合类型好让属性补丁不必整体断言 */
const BD_ATTR: Record<CellEdge, 'bdTop' | 'bdRight' | 'bdBottom' | 'bdLeft'> = {
  top: 'bdTop',
  right: 'bdRight',
  bottom: 'bdBottom',
  left: 'bdLeft',
}

/** 单元格上存的边属性名：bdTop / bdRight / bdBottom / bdLeft */
export function bdAttr(edge: CellEdge): 'bdTop' | 'bdRight' | 'bdBottom' | 'bdLeft' {
  return BD_ATTR[edge]
}

/** 单元格内边距的四条属性（padTop/padRight/padBottom/padLeft），存 CSS px，0 是真值 */
const PAD_SIDES = ['top', 'right', 'bottom', 'left'] as const
type PadSide = (typeof PAD_SIDES)[number]

export function padAttrName(side: PadSide): 'padTop' | 'padRight' | 'padBottom' | 'padLeft' {
  return `pad${side[0].toUpperCase()}${side.slice(1)}` as 'padTop' | 'padRight' | 'padBottom' | 'padLeft'
}

// ---- 边框间距（v0.143）------------------------------------------------------
//
// OOXML 每条边框带 `w:space`（**磅**）：边框线与框内内容的距离。段落侧（w:pBdr）与逐格侧
// （w:tcPr/w:tcBorders）都读；CSS 的 padding 正好是「border 盒与内容盒的距离」，语义同形。
//
// 段落与单元格的落点不同，因为单元格已有 tcMar 竞争同一条 padding：
// - **段落**（ParagraphStyle 的 pad* 四属性）：段落没有「内边距」这一层，pBdr@space 是唯一
//   来源，直接落 padding-{side}，读回也从这个属性解析，无歧义；
// - **单元格**（CellStyle 的 bdSpace* 四属性，data-bdspace-{side} 载荷）：tcMar 与
//   tcBorders@space 在 Word 里**叠加**，CSS 只有一条 padding-{side} 表达不了叠加——所以
//   space 走独立 data-* 属性，renderHTML 时与 pad* 相加输出一条 padding，写回时 space 归
//   w:tcBorders/@w:space、pad* 归 w:tcMar，两边各得各的，往返无损。

/** 磅 → CSS px（1pt = 4/3px） */
export function ptToPx(pt: number): number {
  return round2(pt * (4 / 3))
}

/** CSS px → 磅 */
export function pxToPt(px: number): number {
  return round2((px * 3) / 4)
}

/** 边框间距载荷属性名（data-bdspace-top 等），存 CSS px 字面；0 不挂（与「没声明」同路） */
export function bdSpaceAttr(edge: CellEdge): string {
  return `data-bdspace-${edge}`
}

/** PM 属性名（bdSpaceTop/bdSpaceRight/bdSpaceBottom/bdSpaceLeft），存 CSS px 数值 */
function bdSpaceName(side: PadSide): 'bdSpaceTop' | 'bdSpaceRight' | 'bdSpaceBottom' | 'bdSpaceLeft' {
  return `bdSpace${side[0].toUpperCase()}${side.slice(1)}` as 'bdSpaceTop' | 'bdSpaceRight' | 'bdSpaceBottom' | 'bdSpaceLeft'
}

/** 几条边的间距补丁：只给 >0 的边，属性值 CSS px 字面 */
export function bdSpaceAttrs(edges: Partial<Record<CellEdge, number>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of CELL_EDGES) {
    const v = edges[e]
    if (typeof v === 'number' && v > 0) out[bdSpaceAttr(e)] = String(v)
  }
  return out
}

/** 四条边的属性补丁：段落的 bd* 与单元格的 bd* 同名，两家的命令共用这一处 */
export type BorderPatch = Partial<Record<'bdTop' | 'bdRight' | 'bdBottom' | 'bdLeft', string | null>>

export function edgeAttrs(edges: readonly CellEdge[], value: string | null): BorderPatch {
  return Object.fromEntries(edges.map((e) => [bdAttr(e), value])) as BorderPatch
}

/** 单元格节点上的样式补丁：底纹、竖排对齐、四条边——三枚命令共用一个写入形状 */
export type CellPatch = Partial<
  Record<'background' | 'vAlign' | 'bdTop' | 'bdRight' | 'bdBottom' | 'bdLeft', string | null>
>

/** 边的界面文案（顺序跟 CELL_EDGES 走，工具条上就按这个顺序排） */
export const EDGE_LABEL: Record<CellEdge, string> = { top: '上边', right: '右边', bottom: '下边', left: '左边' }

/** 界面上可选的线型：只列 CSS 真表达得了的那四档，异形线型（thinThick 之类）这里给不了 */
export const BORDER_STYLES: { css: string; label: string }[] = [
  { css: 'solid', label: '实线' },
  { css: 'dashed', label: '虚线' },
  { css: 'dotted', label: '点线' },
  { css: 'double', label: '双线' },
]

/**
 * Word 边框对话框的磅值梯子。界面按磅给、属性里存 CSS px，而这九档往返是稳定的：
 * 0.5 磅 → 0.67px → `w:sz="4"` → 0.67px，与 Word 自己写下的字节同形。
 */
export const BORDER_WIDTH_PT = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6]

/**
 * 界面三件（线型/磅/颜色）→ 规范边框串。
 * 线型只从 BORDER_STYLES 来、颜色只从 `<input type=color>` 来（必为 `#rrggbb`），
 * 所以拼出去的就是规范串本体，不再走 cssBorder 归一——那条路会给 null，
 * 而 null 在这套三态里是「清除这一边」，不能让一次「加边框」点下去变成清东西。
 */
export function borderCss(style: string, pt: number, hex: string): string {
  return `${round2(pt * (4 / 3))}px ${style} ${hex}`
}

/** OOXML `w:sz`（1/8 磅）→ CSS 像素 */
export function eighthsToPx(sz: number): number {
  return round2((sz / 8) * (4 / 3))
}

/** CSS 像素 → OOXML `w:sz`（1/8 磅） */
export function pxToEighths(px: number): number {
  return Math.max(1, Math.round(px * 6))
}

// ---- 图案底纹（v0.142）------------------------------------------------------
//
// OOXML 的 `w:shd` 是三件套：@w:val 图案档位、@w:color 前景、@w:fill 背景。
// CSS 只有背景一色，图案得用 background-image 画——这一份表是**单一真源**：
// docx-fidelity 的读侧、paragraph-style / cell-style 两个扩展的 parse/render、
// 以及 docx.ts 写侧的回写都走它，避免三处各写一份渐变公式对不上。
//
// 精度分两档，导入 warn 里如实说：条纹族（stripe/cross 及其 thin* 变体）是精确的，
// repeating-linear-gradient 就是等距条纹；pct 族是**密度近似**——Word 按像素点屏撒点，
// CSS 只能用定尺点阵逼近，25/50/75 三档用 conic 四象限棋盘精确命中。

/** 往返载荷属性名：`图案|前景|背景`（hex 不带 #）。clear 不挂——纯色走 background 那一链 */
export const SHADE_ATTR = 'data-shade'

/* ── 制表位（v0.144）─────────────────────────────────────────────
 * w:pPr/w:tabs/w:tab 三枚属性（@w:val 档位 / @w:pos 缇 / @w:leader 前导符）。
 * 屏上无对应物（Word 制表位由字符 tab 键驱动、按段落的档位表跳对齐），只往返。
 * 载荷：`档位|缇|leader` 多条用 `;` 分隔；leader 缺省 none 不写，clear 档无 pos/leader。
 * 档位值域与 docx 包 TabStopType 字面一致（left/center/right/decimal/bar/clear/end/num/start），
 * leader 包缺 heavy——库外槽透传（见 docx.ts 的 tabsOf）。 */
export const TABS_ATTR = 'data-tabs'

/** 单条制表位；val 原样存（大小写归一小写） */
export interface TabSpec {
  val: string
  /** 缇；clear 档为 null */
  pos: number | null
  /** 前导符；none/未声明为 null */
  leader: string | null
}

/** OOXML w:val 值域（与 docx 包 TabStopType 同款字面） */
const TAB_VALS = new Set(['left', 'start', 'center', 'right', 'end', 'decimal', 'bar', 'clear', 'num'])
/** OOXML w:leader 值域（docx 包 LeaderType 无 heavy，透传要靠库外槽）。
 * 键为小写归一形，值为规范名——ST_TabTlc 里 middleDot 是唯一驼峰值 */
export const TAB_LEADERS: Record<string, string> = {
  none: 'none',
  dot: 'dot',
  hyphen: 'hyphen',
  underscore: 'underscore',
  heavy: 'heavy',
  middledot: 'middleDot',
}

/** data-tabs 载荷 → TabSpec[]；非法条目整条丢（宁缺勿错） */
export function parseTabsPayload(raw: string | null | undefined): TabSpec[] {
  if (!raw) return []
  const out: TabSpec[] = []
  for (const item of raw.split(';')) {
    const parts = item.split('|')
    if (parts.length < 2 || parts.length > 3) continue
    const val = parts[0].trim().toLowerCase()
    if (!TAB_VALS.has(val)) continue
    const posRaw = parts[1].trim()
    const pos = val === 'clear' ? null : /^\d+$/.test(posRaw) ? Number(posRaw) : null
    if (val !== 'clear' && pos === null) continue
    let leader: string | null = null
    if (parts.length === 3) {
      const l = TAB_LEADERS[parts[2].trim().toLowerCase()]
      if (l && l !== 'none') leader = l
    }
    out.push({ val, pos, leader })
  }
  return out
}

/** TabSpec[] → data-tabs 载荷（与 parseTabsPayload 互逆） */
export function tabsPayload(tabs: readonly TabSpec[]): string {
  return tabs
    .filter((t) => TAB_VALS.has(t.val))
    .map((t) => {
      const pos = t.val === 'clear' ? '' : String(Math.max(0, Math.round(t.pos ?? 0)))
      return t.leader ? `${t.val}|${pos}|${t.leader}` : `${t.val}|${pos}`
    })
    .join(';')
}

/* ── 段落浮动框架（v0.145）─────────────────────────────────────
 * w:pPr/w:framePr 把段落固定在页面某处（Word 的「文字环绕框架」）。Web 流式排版没有页
 * 定位语义，屏上不兑现，只随 data-frame 载荷往返（参照分页四件套纪律）。
 * 载荷：`key=value;key=value`，键名即 OOXML 属性名（x/y/xAlign/yAlign/w/h/hRule/
 * hSpace/vSpace/hAnchor/vAnchor/wrap/anchorLock/dropCap/lines）。
 * 写侧二选一形态：xAlign/yAlign 优先（alignment 形态），否则 absolute——Word 语义里
 * x 与 xAlign 互斥，同存是脏数据，读侧照单全读、写侧择一（另 warn 记账）。 */
export const FRAME_ATTR = 'data-frame'

/** 载荷键 → 是否数值型（其余按字符串原样存） */
const FRAME_NUMERIC = new Set(['x', 'y', 'w', 'h', 'hSpace', 'vSpace', 'lines'])

/** 读手按此清单分流：数值键走 attrNum（缇），字符串键走 attr（枚举原样） */
export const FRAME_NUMERIC_KEYS = [...FRAME_NUMERIC] as string[]
export const FRAME_STR_KEYS = ['xAlign', 'yAlign', 'hRule', 'hAnchor', 'vAnchor', 'wrap', 'anchorLock', 'dropCap'] as string[]

export type FramePayload = Record<string, string>

/** data-frame 载荷 → key/value 表；空串/无值返回 {}。数值键校验为整数，脏值整键丢 */
export function parseFramePayload(raw: string | null | undefined): FramePayload {
  const out: FramePayload = {}
  if (!raw) return out
  for (const item of raw.split(';')) {
    const i = item.indexOf('=')
    if (i <= 0) continue
    const k = item.slice(0, i).trim()
    const v = item.slice(i + 1).trim()
    if (!k || !v) continue
    if (FRAME_NUMERIC.has(k) && !/^-?\d+$/.test(v)) continue
    out[k] = v
  }
  return out
}

/** key/value 表 → data-frame 载荷（与 parseFramePayload 互逆，按键名排序保稳定） */
export function framePayload(kv: FramePayload): string {
  return Object.keys(kv)
    .sort()
    .filter((k) => kv[k] !== '')
    .map((k) => `${k}=${kv[k]}`)
    .join(';')
}

/* ── 表格浮动（v0.145）─────────────────────────────────────────
 * w:tblPr/w:tblpPr 把表格固定在页面某处（Word 的浮动表）。与 framePr 同款纪律：Web
 * 没有页定位语义，屏上不兑现，只随 data-tblp 载荷往返。
 * 载荷键即 OOXML 属性名：tblpX/tblpXSpec/tblpY/vertAnchor/horzAnchor/topFromText/
 * leftFromText/bottomFromText/rightFromText/overlap（全数值型除枚举档）。
 * 写侧直接走 docx 包 ITableFloatOptions——键名一一对应（包多一枚 tblpYSpec，
 * OOXML 没有，不传）。注意包里 verticalAnchor 的类型面是 TableAnchorType
 * （margin/page/text），而 OOXML 的 vertAnchor 值域含 top/bottom/center/inside/
 * outside——BuilderElement 透传不校验，值按原样落。 */
export const TBLP_ATTR = 'data-tblp'

export type TblpPayload = Record<string, string>

const TBLP_NUMERIC = new Set(['tblpX', 'tblpY', 'topFromText', 'leftFromText', 'bottomFromText', 'rightFromText'])

/** data-tblp 载荷 → key/value 表；数值键校验为整数，脏值整键丢 */
export function parseTblpPayload(raw: string | null | undefined): TblpPayload {
  const out: TblpPayload = {}
  if (!raw) return out
  for (const item of raw.split(';')) {
    const i = item.indexOf('=')
    if (i <= 0) continue
    const k = item.slice(0, i).trim()
    const v = item.slice(i + 1).trim()
    if (!k || !v) continue
    if (TBLP_NUMERIC.has(k) && !/^-?\d+$/.test(v)) continue
    out[k] = v
  }
  return out
}

/** key/value 表 → data-tblp 载荷（与 parseTblpPayload 互逆，排序保稳定） */
export function tblpPayload(kv: TblpPayload): string {
  return Object.keys(kv)
    .sort()
    .filter((k) => kv[k] !== '')
    .map((k) => `${k}=${kv[k]}`)
    .join(';')
}

/* ── 表自身的条件层闸门（v0.147）───────────────────────────────
 * `w:tblPr/w:tblLook` 既可能出现在表样式里（随样式走），也可能直接出现在某张表的
 * `w:tblPr` 上（随这张表走）。两处同名的三枚属性：val / noHBand / noVBand。
 * 载荷：`val=04A0;noHBand=0;noVBand=0`，屏上不兑现（只影响 Word 套条件格式那一层），
 * 只随 data-tlook 往返。写侧走打包后补丁（包没有这一枚的槽）。 */
export const TLOOK_ATTR = 'data-tlook'

/** data-tlook 载荷 → key/value 表（只认这三枚键，脏值整键丢） */
export function parseTlookPayload(raw: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  const ok = new Set(['val', 'noHBand', 'noVBand'])
  for (const item of raw.split(';')) {
    const i = item.indexOf('=')
    if (i <= 0) continue
    const k = item.slice(0, i).trim()
    const v = item.slice(i + 1).trim()
    if (!ok.has(k) || !v) continue
    if (k !== 'val' && v !== '1' && v !== '0') continue
    out[k] = v
  }
  return out
}

/** key/value 表 → data-tlook 载荷（与 parseTlookPayload 互逆） */
export function tlookPayload(kv: Record<string, string>): string {
  return Object.keys(kv)
    .sort()
    .filter((k) => kv[k] !== '')
    .map((k) => `${k}=${kv[k]}`)
    .join(';')
}

/* ── 段落属性余量（v0.147）─────────────────────────────────────
 * w:pPr 里那一批「说了也不改屏上排版」的直接属性：adjustRightInd（编号右边缩进跟随
 * 自动缩进）、snapToGrid（对齐到文档网格）、topLinePunct（首尾标点压缩）、bidi（段落
 * 从右往左）、autoSpaceDE/autoSpaceDN（中西文/数字间自动加间距）、suppressLineNumbers
 * （本段不编号）、textAlignment（行内文字的上下对齐档）。Web 流式排版没有网格、没有
 * 纸张行、也不做中西文间距，屏上一条都不兑现——与分页四件套同款纪律：只随载荷往返。
 * 载荷：data-ppr="key=value;..."，键名即 OOXML 属性名（onOff 档存 '1'/'0'，
 * textAlignment 存枚举原值）。写侧走打包后补丁（包里只有 autoSpaceDN 一枚槽，且它把
 * onOff 写成裸元素——带不出 w:val 的「显式关」）。 */
export const PPR_ATTR = 'data-ppr'

export type PprPayload = Record<string, string>

/** onOff 档：w:val 的 '1'/'0'（元素在场而无 val 时按「开」记） */
export const PPR_ONOFF_KEYS = [
  'adjustRightInd',
  'snapToGrid',
  'topLinePunct',
  'bidi',
  'autoSpaceDE',
  'autoSpaceDN',
  'suppressLineNumbers',
  'beforeAutoSpace',
  'afterAutoSpace',
] as const

/** 枚举档：textAlignment 的 top/center/bottom/baseline/auto */
export const PPR_STR_KEYS = ['textAlignment'] as const

/** data-ppr 载荷 → key/value 表；onOff 键只收 '1'/'0'，脏值整键丢 */
export function parsePprPayload(raw: string | null | undefined): PprPayload {
  const out: PprPayload = {}
  if (!raw) return out
  const onoff = new Set<string>(PPR_ONOFF_KEYS)
  for (const item of raw.split(';')) {
    const i = item.indexOf('=')
    if (i <= 0) continue
    const k = item.slice(0, i).trim()
    const v = item.slice(i + 1).trim()
    if (!k || !v) continue
    if (onoff.has(k) && v !== '1' && v !== '0') continue
    out[k] = v
  }
  return out
}

/** key/value 表 → data-ppr 载荷（与 parsePprPayload 互逆，排序保稳定） */
export function pprPayload(kv: PprPayload): string {
  return Object.keys(kv)
    .sort()
    .filter((k) => kv[k] !== '')
    .map((k) => `${k}=${kv[k]}`)
    .join(';')
}

/* ── 图片容器壳（v0.148）─────────────────────────────────────
 * 一张位图在 OOXML 里不是「一个 <img>」而是三层壳：wp:inline/wp:anchor（画布定位）、
 * wp:docPr + pic:cNvPr（对象名与替代文本）、pic:spPr/a:xfrm + a:prstGeom（图形框）。
 * 这三层里除尺寸外的属性屏上一条都不兑现（Web 流式排版没有文字环绕、没有对象名、
 * 图片框恒为矩形），但换个编辑器打开时它们决定「图贴在哪个锚上、能不能被选中改形」。
 * 载荷：data-img="key=value;..."，EMU 档存整数原值（EMU→px 那一道只在 width/height
 * 上做过，这里要的是能原样写回去的数），onOff 档存 '1'/'0'。
 * 写侧走打包后补丁：包把整层壳都发出来了，只是值全部硬编码（dist*=0、effectExtent
 * 四边=0、graphicFrameLocks/picLocks 恒 1、cNvPr 的 name 干脆是空串），补丁按块改值。
 *
 * 键名（EMU 档）：distT/distB/distL/distR（wp:inline 四边避让）、eeL/eeT/eeR/eeB
 * （wp:effectExtent 四边）、offX/offY/extCx/extCy（a:xfrm 的 a:off/a:ext）、
 * spX/spY（wp:simplePos）、docPrId/cNvPrId（两处对象序号）。
 * 字符串档：cNvPrName、prst、posH、posV、bwMode（pic:spPr）。
 * onOff 档：gfl、pic（两枚 locks 的 noChangeAspect）、picArrow（a:picLocks 的
 * noChangeArrowheads）、anOver/anBehind/anCell/anLocked/anRelH/anSimple（wp:anchor 六枚闸门）。
 * VML 壳（v0.149，只读不写——写侧只发 DrawingML 内嵌图，w:pict 那一支出不来）：
 * 字符串档 shId/shSpid/shSpt/shType/shCoord（v:shape）、lkExt（o:lock）、idTitle
 * （v:imagedata）、fFocus（v:fill 焦点尺寸）、sJoin/sWeight（v:stroke 连接与粗细）；
 * onOff 档 shFill/shStroke（v:shape 的 filled/stroked）、lkAspect（o:lock 的
 * aspectratio）、fOn（v:fill）、sOn（v:stroke）——VML 走 ST_TrueFalse（t/f），
 * 与 CT_OnOff（1/0）值域不重叠，读手一并收、载荷里统一存 1/0。
 * v0.150 增（全部只读不写）：
 * - DrawingML 零星：blipState（a:blip 的 cstate，「打印才出」那档）、extUri（a:ext 的 uri，
 *   扩展点身份）、lumModV（a:lumMod 的亮度调制）、lnW（a:ln 的线宽，EMU）；
 * - wp:inline 的 anId/anEdit（anchorId/editId，Word 给内嵌图也发的两个流水号）；
 * - VML 形状余量与图元几何：shPath/shFillColor（v:shape 身上的 path 缓存与填充底色）、
 *   localDpi（o:useLocalDpi）、attrN/attrV（o:attr 扩展点一对）、
 *   grpId/grpSpid/grpCoord/grpSize/grpStyle（v:group 的五枚，分组画布的身份与坐标）；
 * - 图元几何族只记「枚数 + 首枚值」：shPt（v:pt 的 x/y）、shGd（v:gd 的 fmla/name）、
 *   shCxn（v:cxn 的 ang）、shPos（v:pos 的 x/y）、shBox（v:path 的 w/h）。一条 path 上
 *   几十上百枚 pt 是常事，全挂会把 HTML 撑爆；枚数说明「这个族在这里出现了」，
 *   首枚值说明「它长什么样」，合起来够保真账用 */
export const IMG_ATTR = 'data-img'

export type ImgPayload = Record<string, string>

/** onOff 档：两枚 locks、a:picLocks 的箭头锁、wp:anchor 六枚闸门、VML 的五枚 t/f */
export const IMG_ONOFF_KEYS = [
  'gfl',
  'pic',
  'picArrow',
  'anOver',
  'anBehind',
  'anCell',
  'anLocked',
  'anRelH',
  'anSimple',
  'shFill',
  'shStroke',
  'lkAspect',
  'fOn',
  'sOn',
] as const

/** 载荷分号分隔，字符串档的值里带 ';' 或 '=' 会撕裂载荷——那就不记（整键丢） */
function imgValOk(v: string): boolean {
  return v !== '' && !v.includes(';') && !v.includes('=')
}

/** data-img 载荷 → key/value 表；onOff 键只收 '1'/'0'，字符串键不带分隔符，脏值整键丢 */
export function parseImgPayload(raw: string | null | undefined): ImgPayload {
  const out: ImgPayload = {}
  if (!raw) return out
  const onoff = new Set<string>(IMG_ONOFF_KEYS)
  for (const item of raw.split(';')) {
    const i = item.indexOf('=')
    if (i <= 0) continue
    const k = item.slice(0, i).trim()
    const v = item.slice(i + 1).trim()
    if (!k || !imgValOk(v)) continue
    if (onoff.has(k) && v !== '1' && v !== '0') continue
    out[k] = v
  }
  return out
}

/** key/value 表 → data-img 载荷（与 parseImgPayload 互逆，排序保稳定） */
export function imgPayload(kv: ImgPayload): string {
  return Object.keys(kv)
    .sort()
    .filter((k) => imgValOk(kv[k]))
    .map((k) => `${k}=${kv[k]}`)
    .join(';')
}

/** 点阵：cell 见方的格子里一枚半径 1px 的点（密集档反过来把背景当时点） */
function dots(fg: string, bg: string, cell: number): string {
  return `radial-gradient(${fg} 1px, ${bg} 1.5px) 0 0/${cell}px ${cell}px`
}

/** 等距条纹：deg 走向、period 周期（px） */
function stripes(fg: string, bg: string, deg: number, period: number): string {
  return `repeating-linear-gradient(${deg}deg, ${fg} 0 ${period}px, ${bg} ${period}px ${period * 2}px)`
}

const PATTERN_GRAD: Record<string, (fg: string, bg: string) => string> = {
  solid: (fg) => `linear-gradient(${fg}, ${fg})`,
  pct5: (fg, bg) => dots(fg, bg, 16),
  pct10: (fg, bg) => dots(fg, bg, 11),
  pct12: (fg, bg) => dots(fg, bg, 10),
  pct15: (fg, bg) => dots(fg, bg, 9),
  pct20: (fg, bg) => dots(fg, bg, 8),
  pct25: (fg, bg) => `conic-gradient(${fg} 0 25%, ${bg} 0 100%) 0 0/4px 4px`,
  pct50: (fg, bg) => `conic-gradient(${fg} 0 25%, ${bg} 0 50%, ${fg} 0 75%, ${bg} 0) 0 0/4px 4px`,
  pct75: (fg, bg) => `conic-gradient(${bg} 0 25%, ${fg} 0 100%) 0 0/4px 4px`,
  pct30: (fg, bg) => dots(fg, bg, 7),
  pct35: (fg, bg) => dots(fg, bg, 6),
  pct37: (fg, bg) => dots(fg, bg, 6),
  pct40: (fg, bg) => dots(fg, bg, 6),
  pct45: (fg, bg) => dots(fg, bg, 5),
  pct55: (fg, bg) => dots(bg, fg, 5),
  pct60: (fg, bg) => dots(bg, fg, 4),
  pct62: (fg, bg) => dots(bg, fg, 4),
  pct65: (fg, bg) => dots(bg, fg, 4),
  pct70: (fg, bg) => dots(bg, fg, 4),
  pct80: (fg, bg) => dots(bg, fg, 3),
  pct85: (fg, bg) => dots(bg, fg, 3),
  pct87: (fg, bg) => dots(bg, fg, 3),
  pct90: (fg, bg) => dots(bg, fg, 3),
  pct95: (fg, bg) => dots(bg, fg, 2),
  horzstripe: (fg, bg) => stripes(fg, bg, 0, 2),
  thinhorzstripe: (fg, bg) => stripes(fg, bg, 0, 1),
  vertstripe: (fg, bg) => stripes(fg, bg, 90, 2),
  thinvertstripe: (fg, bg) => stripes(fg, bg, 90, 1),
  diagstripe: (fg, bg) => stripes(fg, bg, 45, 2),
  thindiagstripe: (fg, bg) => stripes(fg, bg, 45, 1),
  reversediagstripe: (fg, bg) => stripes(fg, bg, -45, 2),
  thinreversediagstripe: (fg, bg) => stripes(fg, bg, -45, 1),
  horzcross: (fg, bg) =>
    `repeating-linear-gradient(0deg, ${fg} 0 2px, ${bg} 2px 4px), repeating-linear-gradient(90deg, ${fg} 0 2px, ${bg} 2px 4px)`,
  thinhorzcross: (fg, bg) =>
    `repeating-linear-gradient(0deg, ${fg} 0 1px, ${bg} 1px 2px), repeating-linear-gradient(90deg, ${fg} 0 1px, ${bg} 1px 2px)`,
  diagcross: (fg, bg) =>
    `repeating-linear-gradient(45deg, ${fg} 0 2px, ${bg} 2px 4px), repeating-linear-gradient(-45deg, ${fg} 0 2px, ${bg} 2px 4px)`,
  thindiagcross: (fg, bg) =>
    `repeating-linear-gradient(45deg, ${fg} 0 1px, ${bg} 1px 2px), repeating-linear-gradient(-45deg, ${fg} 0 1px, ${bg} 1px 2px)`,
}

/** 图案三件套（pattern 小写档位名、fg/bg 为 '#rrggbb'） */
export interface ShadeSpec {
  pattern: string
  fg: string
  bg: string
}

/** `图案|前景|背景` → 三件套；形状不对（缺段、hex 不合法）算未声明，与 null 同路 */
export function parseShadePayload(raw: string | null | undefined): ShadeSpec | null {
  if (!raw) return null
  const parts = raw.split('|')
  if (parts.length !== 3) return null
  const [pattern, fg, bg] = parts.map((p) => p.trim())
  const ok = (h: string) => /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)
  if (!pattern || !ok(fg) || !ok(bg)) return null
  return { pattern: pattern.toLowerCase(), fg: `#${fg.replace('#', '').toLowerCase()}`, bg: `#${bg.replace('#', '').toLowerCase()}` }
}

/** 三件套 → 一段内联 CSS（背景色 + 图案渐变）；认不出的图案名只留背景一色 */
export function shadeCss(spec: ShadeSpec): string | null {
  const grad = PATTERN_GRAD[spec.pattern]
  const bg = spec.bg ?? '#ffffff'
  return grad ? `background-color: ${bg}; background-image: ${grad(spec.fg, bg)}` : `background-color: ${bg}`
}

/**
 * data-shade 载荷 → 扩展属性要渲染的东西（属性本身 + 内联样式两段）。
 * 载荷非法时两样都不给——那一栏当未声明，落回 background 那一链。
 */
export function shadeAttrs(raw: unknown): Record<string, string> {
  const payload = typeof raw === 'string' ? raw : ''
  const spec = parseShadePayload(payload)
  if (!spec) return {}
  const css = shadeCss(spec)
  return css ? { [SHADE_ATTR]: payload, style: css } : { [SHADE_ATTR]: payload }
}

function vAlignOf(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase()
  if (v.startsWith('top')) return 'top'
  if (v.startsWith('middle') || v.startsWith('center')) return 'middle'
  if (v.startsWith('bottom')) return 'bottom'
  return null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cellStyle: {
      /** 给选中的一格或多格设底纹色；传 null 清除 */
      setCellBackground: (color: string | null) => ReturnType
      /**
       * 给光标所在的整张表套/摘命名表样式（w:tblStyle）；传 null 清除回到「未套样式」。
       * 与段落那个套路一致：只挂标签，呈现由样式表驱动，逐格手调的格式天然压过样式层。
       */
      setTableStyle: (id: string | null) => ReturnType
      /** 给选中的单元格设竖排对齐（top/middle/bottom）；传 null 清除 */
      setCellVAlign: (align: string | null) => ReturnType
      /**
       * 给选中的单元格把若干条边一起设成同一个值：规范串加边框，`'none'` 压掉表级边框，
       * `null` 回到未声明。一次调用一条事务——「四周」点一下应该只撤销一次。
       */
      setCellBorder: (edges: readonly CellEdge[], value: string | null) => ReturnType
    }
  }
}

/** CSS 关键字线宽 → px（Chrome 把 `border-right: none` 拆成长写后，宽度会退回 medium） */
const KEYWORD_WIDTH: Record<string, number> = { thin: 1, medium: 3, thick: 5 }

/**
 * 内联样式的一边 → 规范串。
 * 不能读 `border-right` 这条简写：Chrome 对 `border-right: none` 只落成三条长写，
 * 简写取值器返回空串，于是"明确去边"和"没声明"就分不出来了，故逐条长写拼。
 */
export function inlineBorder(el: HTMLElement, edge: CellEdge): string | null {
  const style = el.style.getPropertyValue(`border-${edge}-style`).trim().toLowerCase()
  const width = el.style.getPropertyValue(`border-${edge}-width`).trim().toLowerCase()
  const color = el.style.getPropertyValue(`border-${edge}-color`).trim()
  if (!style && !width && !color) return cssBorder(el.style.getPropertyValue(`border-${edge}`))
  if (style === 'none' || style === 'hidden') return 'none'
  const w = KEYWORD_WIDTH[width] !== undefined ? `${KEYWORD_WIDTH[width]}px` : width
  return cssBorder([w, style, color].filter(Boolean).join(' '))
}

/**
 * 单元格样式扩展。只声明属性，不改内容模型；写入走 TipTap 的 updateAttributes
 * （选中范围内所有 tableCell/tableHeader 一并改，光标落在哪一格就改那一格）。
 */
export const CellStyle = Extension.create({
  name: 'cellStyle',

  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          ...Object.fromEntries(
            CELL_EDGES.map((edge) => [
              bdAttr(edge),
              {
                default: null as string | null,
                parseHTML: (el: HTMLElement) => inlineBorder(el, edge),
                renderHTML: (attrs: Record<string, unknown>) => {
                  const v = attrs[bdAttr(edge)] as string | null
                  return v ? { style: `border-${edge}: ${v}` } : {}
                },
              },
            ]),
          ),
          background: {
            default: null as string | null,
            parseHTML: (el: HTMLElement) => rgb2hex(el.style.getPropertyValue('background-color')),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.background ? { style: `background-color: ${attrs.background}` } : {},
          },
          // 图案底纹的往返载荷（v0.142）：与段落那一枚同源（SHADE_ATTR/shadeAttrs），
          // 纯色 background 之外的第二份表示——w:shd 的图案档位与前景色只有它带得回来
          shade: {
            default: null as string | null,
            parseHTML: (el: HTMLElement) => el.getAttribute(SHADE_ATTR) || null,
            renderHTML: (attrs: Record<string, unknown>) => shadeAttrs(attrs.shade),
          },
          vAlign: {
            default: null as string | null,
            parseHTML: (el: HTMLElement) => vAlignOf(el.style.getPropertyValue('vertical-align')),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.vAlign ? { style: `vertical-align: ${attrs.vAlign}` } : {},
          },
          // 格边距：docx 的 w:tblCellMar / w:tcMar 落这里（v0.97 起）。0 是真值（Word 的上下边距
          // 常就是 0），判空不用真值判断；mergeAttributes 会把各属性给出的 style 片段串起来，
          // 所以每条属性只写自己的那一边
          ...Object.fromEntries(
            PAD_SIDES.map((side) => [
              padAttrName(side),
              {
                default: null as number | null,
                parseHTML: (el: HTMLElement) => {
                  const px = Number.parseFloat(el.style.getPropertyValue(`padding-${side}`))
                  return Number.isFinite(px) && px >= 0 ? round2(px) : null
                },
                renderHTML: (attrs: Record<string, unknown>) => {
                  const v = attrs[padAttrName(side)]
                  // v0.143：与边框间距（bdSpace*）相加——Word 里 tcMar 与 tcBorders@space
                  // 是叠加关系，CSS 一条 padding-{side} 就是两者的和；两条属性各输出同一个
                  // 合并值，mergeAttributes 串起来后谁盖谁都是这个数
                  const sp = attrs[bdSpaceName(side)]
                  const sum = (typeof v === 'number' ? v : 0) + (typeof sp === 'number' ? sp : 0)
                  return sum > 0 ? { style: `padding-${side}: ${round2(sum)}px` } : {}
                },
              },
            ]),
          ),
          // 边框间距（v0.143）：docx 的 w:tcBorders/@w:space（磅→px）走 data-bdspace-{side}
          // 独立载荷——与 pad* 相加才是 Word 的叠加语义，但回写时 space 归 tcBorders、
          // pad 归 tcMar，两边各得各的（详见 cell-style.ts 头注的 v0.143 段）
          ...Object.fromEntries(
            PAD_SIDES.map((side) => [
              bdSpaceName(side),
              {
                default: null as number | null,
                parseHTML: (el: HTMLElement) => {
                  const v = Number.parseFloat(el.getAttribute(bdSpaceAttr(side)) ?? '')
                  return Number.isFinite(v) && v > 0 ? round2(v) : null
                },
                renderHTML: (attrs: Record<string, unknown>) => {
                  const own = attrs[bdSpaceName(side)]
                  if (typeof own !== 'number' || own <= 0) return {}
                  const pad = attrs[padAttrName(side)]
                  const sum = own + (typeof pad === 'number' ? pad : 0)
                  return { style: `padding-${side}: ${round2(sum)}px` }
                },
              },
            ]),
          ),
        },
      },
      {
        types: ['tableRow'],
        attributes: {
          // 行高：docx 的 w:trHeight 落这里（v0.97 起）。HTML 里 tr 的高度本就是下限语义，
          // 与 OOXML 的 atLeast 恰好同形；exact 的"超高裁内容"CSS 表达不了，导入按 atLeast 记
          rowHeight: {
            default: null as number | null,
            parseHTML: (el: HTMLElement) => {
              const h = Number.parseFloat(el.style.getPropertyValue('height'))
              return Number.isFinite(h) && h > 0 ? round2(h) : null
            },
            renderHTML: (attrs: Record<string, unknown>) => {
              const n = Number(attrs.rowHeight)
              return Number.isFinite(n) && n > 0 ? { style: `height: ${n}px` } : {}
            },
          },
        },
      },
      {
        types: ['table'],
        attributes: {
          /**
           * 命名表样式标签（v0.114）：表的 `w:tblStyle` 身份，data-tstyle 随导入 HTML 进出。
           * 同样只挂标签不摊格式——样式定义改一处，挂它的每张表屏幕即时变。
           */
          tStyle: {
            default: null as string | null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-tstyle'),
            renderHTML: (attrs: Record<string, unknown>) =>
              typeof attrs.tStyle === 'string' && attrs.tStyle ? { 'data-tstyle': attrs.tStyle } : {},
          },
          /**
           * 表格浮动（v0.145）：w:tblpPr 的 key=value 载荷（tblpX/tblpXSpec/tblpY/vertAnchor/
           * horzAnchor/四 FromText/overlap）。Word 的纸面浮动表，Web 没有页定位语义，
           * 屏上不兑现——只随 data-tblp 往返（framePr 同款纪律）
           */
          tblp: {
            default: null as string | null,
            parseHTML: (el: HTMLElement) => el.getAttribute(TBLP_ATTR) || null,
            renderHTML: (attrs: Record<string, unknown>) => {
              const raw = typeof attrs.tblp === 'string' ? attrs.tblp : ''
              return Object.keys(parseTblpPayload(raw)).length ? { [TBLP_ATTR]: raw } : {}
            },
          },
          /**
           * 条件层闸门（v0.147）：表**自己** `w:tblPr` 上那一枚 `w:tblLook` 的三属性——
           * `val`（Word 存的四位闸门原值）/ `noHBand` / `noVBand`。与样式里那一枚同名同义，
           * 区别在于归属：样式那一枚随样式走、表这一枚随这张表走（表上的压过样式上的）。
           * 屏上不兑现（门的开合只影响 Word 套条件格式的那一层），只随 data-tlook 往返
           */
          tlook: {
            default: null as string | null,
            parseHTML: (el: HTMLElement) => el.getAttribute(TLOOK_ATTR) || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              typeof attrs.tlook === 'string' && attrs.tlook ? { [TLOOK_ATTR]: attrs.tlook } : {},
          },
          /** Word 的 `w:tblInd`：整张表离版心左边距多远 */
          marginLeft: {
            default: null as number | null,
            parseHTML: (el: HTMLElement) => {
              const px = parseFloat(el.style.getPropertyValue('margin-left'))
              return Number.isFinite(px) && px > 0 ? round2(px) : null
            },
            renderHTML: (attrs: Record<string, unknown>) => {
              const n = Number(attrs.marginLeft)
              // 版式表宽是 100%，缩进必须同时收右边，否则整张表顶出页面
              if (!n) return {}
              return { style: `margin-left: ${n}px; width: calc(100% - ${n}px)` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    /**
     * 表头行是与普通格并列的一种节点，命令必须两型都试、谁在场就落谁身上。
     * 旧的 `updateAttributes('tableCell',…) && updateAttributes('tableHeader',…)` 实测（v0.88）
     * 在表头格上因为第一型返回 false 而短路 ⇒ 整条静默 no-op（边框/底纹/竖排对齐都写不进去），
     * 在普通格上又因为第二型返回 false 而把链上这一步记成失败。段落那一头早就用 `.some(Boolean)`。
     */
    const setCell =
      (attrs: CellPatch) =>
      ({ commands }: CommandProps): boolean =>
        [commands.updateAttributes('tableCell', attrs), commands.updateAttributes('tableHeader', attrs)].some(Boolean)

    return {
      setCellBackground: (color: string | null) => setCell({ background: color }),
      setCellVAlign: (align: string | null) => setCell({ vAlign: align }),
      setCellBorder: (edges: readonly CellEdge[], value: string | null) => setCell(edgeAttrs(edges, value)),
      setTableStyle: (id) => ({ commands }: CommandProps) => commands.updateAttributes('table', { tStyle: id }),
    }
  },
})

/**
 * 表格 NodeView：把 marginLeft 与整表的宽度账补回 DOM。
 * 可缩放模式下表格的 DOM 由 prosemirror-tables 建，它只调 `new View(node, cellMinWidth, view)`——
 * 少了 TipTap 自己那条路径的第 4 个参数（HTMLAttributes），于是 renderHTML 里的 margin-left
 * 只进了 JSON 没进页面（屏幕与导出 PDF 都看不见缩进）。这里按节点属性直接写元素样式，
 * 并在 update 时跟着属性刷新（改缩进、撤销重做都走这里）。
 * 另一件事住在这个视图里：给纸上建一份重复表头的 <thead> 克隆（见 syncReplica）。
 */
export class IndentTableView extends TableView {
  /** 纸上那一份重复表头：本视图自己建的 <thead>，模型里没有它 */
  private replica: HTMLTableSectionElement | null = null

  constructor(node: Node, cellMinWidth: number, view: EditorView) {
    super(node, cellMinWidth, view)
    this.applyIndent(node)
    this.scheduleReplica()
  }

  update(node: Node): boolean {
    const ok = super.update(node)
    if (ok) {
      this.applyIndent(node)
      this.scheduleReplica()
    }
    return ok
  }

  private applyIndent(node: Node): void {
    const ml = Number(node.attrs?.marginLeft)
    const has = Number.isFinite(ml) && ml > 0
    this.table.style.marginLeft = has ? `${ml}px` : ''
    // 整表每列都带账 ⇒ 表宽就是这份账本身，与 docx 的 w:tblW（网格和）同一形状；
    // 没账或部分账才退回版心比例，此时缩进必须同时收右边，否则整张表顶出页面
    const total = accountTotalPx(node)
    if (total) this.table.style.width = `${total}px`
    else this.table.style.width = has ? `calc(100% - ${ml}px)` : ''
  }

  /**
   * spec.update 跑在 PM 重画行之前，那一刻 DOM 还是上一份账 ⇒ 排到微任务，
   * 等这一趟渲染落地再按屏上那些行建克隆（不在 update 里同步做，否则纸上永远是过期的一份）。
   */
  private scheduleReplica(): void {
    queueMicrotask(() => this.syncReplica())
  }

  private syncReplica(): void {
    const rows = Array.from(this.contentDOM.children) as HTMLTableRowElement[]
    const isHeader = (tr: HTMLTableRowElement) => tr.querySelector(':scope > th') !== null
    const leading: HTMLTableRowElement[] = []
    for (const tr of rows) {
      if (!isHeader(tr)) break
      leading.push(tr)
    }
    this.replica?.remove()
    this.replica = null
    this.table.classList.remove('doc-th-rep')
    // 克隆集与藏集必须是同一批行：只克隆开头那几行、却要藏所有带 th 的行 ⇒ 中途那枚两头不讨好
    if (!leading.length || leading.length !== rows.filter(isHeader).length) return
    const thead = document.createElement('thead')
    thead.className = 'doc-th'
    for (const tr of leading) thead.appendChild(tr.cloneNode(true))
    this.table.insertBefore(thead, this.contentDOM)
    this.replica = thead
    this.table.classList.add('doc-th-rep')
  }
}
