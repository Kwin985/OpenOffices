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

function padAttrName(side: PadSide): 'padTop' | 'padRight' | 'padBottom' | 'padLeft' {
  return `pad${side[0].toUpperCase()}${side.slice(1)}` as 'padTop' | 'padRight' | 'padBottom' | 'padLeft'
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
                  return typeof v === 'number' && v >= 0 ? { style: `padding-${side}: ${v}px` } : {}
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
