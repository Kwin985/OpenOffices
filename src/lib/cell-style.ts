import { Extension } from '@tiptap/core'
import { TableView } from '@tiptap/extension-table'
import type { Node } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

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

/** 单元格上存的边属性名：bdTop / bdRight / bdBottom / bdLeft */
export function bdAttr(edge: CellEdge): string {
  return `bd${edge[0].toUpperCase()}${edge.slice(1)}`
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
      /** 给选中的单元格设竖排对齐（top/middle/bottom）；传 null 清除 */
      setCellVAlign: (align: string | null) => ReturnType
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
        },
      },
      {
        types: ['table'],
        attributes: {
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
    return {
      setCellBackground:
        (color: string | null) =>
        ({ commands }) =>
          commands.updateAttributes('tableCell', { background: color }) &&
          commands.updateAttributes('tableHeader', { background: color }),
      setCellVAlign:
        (align: string | null) =>
        ({ commands }) =>
          commands.updateAttributes('tableCell', { vAlign: align }) &&
          commands.updateAttributes('tableHeader', { vAlign: align }),
    }
  },
})

/**
 * 表格 NodeView：把 marginLeft 补回 DOM。
 * 可缩放模式下表格的 DOM 由 prosemirror-tables 建，它只调 `new View(node, cellMinWidth, view)`——
 * 少了 TipTap 自己那条路径的第 4 个参数（HTMLAttributes），于是 renderHTML 里的 margin-left
 * 只进了 JSON 没进页面（屏幕与导出 PDF 都看不见缩进）。这里按节点属性直接写元素样式，
 * 并在 update 时跟着属性刷新（改缩进、撤销重做都走这里）。
 */
export class IndentTableView extends TableView {
  constructor(node: Node, cellMinWidth: number, view: EditorView) {
    super(node, cellMinWidth, view)
    this.applyIndent(node)
  }

  update(node: Node): boolean {
    const ok = super.update(node)
    if (ok) this.applyIndent(node)
    return ok
  }

  private applyIndent(node: Node): void {
    const ml = Number(node.attrs?.marginLeft)
    const has = Number.isFinite(ml) && ml > 0
    this.table.style.marginLeft = has ? `${ml}px` : ''
    // 版心表宽是 100%，只加左缩进会把右半边顶出页面，故同步收右边（与 renderHTML 同一套算法）
    this.table.style.width = has ? `calc(100% - ${ml}px)` : ''
  }
}
