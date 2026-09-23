import { Extension, type CommandProps, type Editor } from '@tiptap/core'
import { CELL_EDGES, bdAttr, inlineBorder, rgb2hex, type CellEdge } from './cell-style'

/**
 * 段落的排版属性：行距、段前段后、底纹与四边边框。
 *
 * 为什么单开一个扩展：TipTap 的 schema 里段落只有对齐（TextAlign）与缩进（Indent），
 * 而 Word 中文文档最伤观感的丢失恰恰是行距与段间距——`w:spacing` 整条不被还原时，
 * 一份 1.5 倍行距、段前段后各 0.5 行的公文打开来就挤成一坨，看着像内容少了半截。
 *
 * 取值三态与单元格边框同一套纪律：`null` 是原文件没声明（不写内联样式，落回应用默认），
 * **0 是有意义的真值**（Word 用 `w:after="0"` 压掉样式里那段间距），所以判空一律用 `!= null`
 * 而不是真值判断——用 `if (n)` 会把 0 静默变成"没声明"。
 *
 * lineHeight 的语义跟着 lineRule 走，这是 OOXML 自己的双关：
 * `w:lineRule="auto"` 时 `w:line` 是 1/240 行（240=单倍，即倍数×240），
 * `exact`/`atLeast` 时是二十分之一磅。这里存"倍数"或"CSS px"，两种含义不混存。
 */

export type LineRule = 'auto' | 'exact' | 'atLeast'

/** 倍数（auto）或像素（exact/atLeast）；null = 未声明 */
export interface ParaStyleAttrs {
  lineHeight: number | null
  lineRule: LineRule | null
  spaceBefore: number | null
  spaceAfter: number | null
  background: string | null
  bdTop: string | null
  bdRight: string | null
  bdBottom: string | null
  bdLeft: string | null
}

/** 行距上下限只是防手滑：负数与三位数倍数都不是用户想要的 */
const LINE_MIN = 0.2
const LINE_MAX_PX = 600

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function has(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** CSS line-height → 倍数（auto）或 px（absolute 两档）；`normal` 与读不懂的值都算未声明 */
function parseLineHeight(raw: string): number | undefined {
  const s = raw.trim().toLowerCase()
  if (!s || s === 'normal' || s === 'inherit') return undefined
  if (s.endsWith('%')) {
    const n = Number.parseFloat(s)
    return Number.isFinite(n) && n > 0 ? round2(n / 100) : undefined
  }
  const n = Number.parseFloat(s)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return round2(n)
}

/** 带 px 的行距是绝对值（exact/atLeast），纯数字/百分数是倍数 */
function inferRule(css: string, fallback: LineRule | undefined): LineRule | undefined {
  if (fallback) return fallback
  const s = css.trim().toLowerCase()
  if (!s || s === 'normal') return undefined
  return s.endsWith('px') ? 'exact' : 'auto'
}

/** OOXML 的 atLeast（最小值）在 CSS 里没有对应物，用自定义属性记在原处带回（浏览器会保留行内未知属性） */
const RULE_PROP = '--oof-lr'

/** CSS margin → px（0 照收，它是"压掉样式那段间距"的真值） */
function parseMargin(raw: string): number | undefined {
  const s = raw.trim()
  if (!s || !s.endsWith('px')) return undefined
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? round2(n) : undefined
}

/** 把这一组属性拼成一条 style：多条属性各写一份 style 时后写的会整条盖掉前一份 */
function styleOf(a: Record<string, unknown>): { style?: string } {
  const bits: string[] = []
  const lh = a.lineHeight
  const rule = (a.lineRule as LineRule | null) ?? 'auto'
  if (has(lh) && lh > 0) {
    if (rule === 'auto') bits.push(`line-height: ${Math.max(LINE_MIN, lh)}`)
    else bits.push(`line-height: ${Math.min(LINE_MAX_PX, Math.max(1, lh))}px`)
    // 「最小值」与「固定值」在 CSS 里都是绝对行高，只有 OOXML 分这两档，导出要分得回来
    if (rule === 'atLeast') bits.push(`${RULE_PROP}: atLeast`)
  }
  if (has(a.spaceBefore)) bits.push(`margin-top: ${a.spaceBefore}px`)
  if (has(a.spaceAfter)) bits.push(`margin-bottom: ${a.spaceAfter}px`)
  if (a.background) bits.push(`background-color: ${a.background}`)
  for (const edge of CELL_EDGES) {
    const v = a[bdAttr(edge)]
    // 'none' 是原文件显式去掉了这条边，必须真写进 CSS，否则落回默认无边看不出来
    if (typeof v === 'string' && v) bits.push(`border-${edge}: ${v}`)
  }
  return bits.length ? { style: bits.join('; ') } : {}
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphStyle: {
      /** 绝对设定：导入与批量套用走这里；传 null 清除该项回到未声明 */
      setParagraphStyle: (attrs: Partial<ParaStyleAttrs>) => ReturnType
      /** 段落底纹色；传 null 清除 */
      setParaBackground: (color: string | null) => ReturnType
      /** 行距：倍数（rule=auto）或像素（exact/atLeast）；传 null 清除 */
      setLineSpacing: (value: number | null, rule?: LineRule) => ReturnType
      /** 段前段后（CSS px）；传 null 清除 */
      setSpaceAround: (before: number | null, after: number | null) => ReturnType
    }
  }
}

export const ParagraphStyle = Extension.create({
  name: 'paragraphStyle',

  addOptions() {
    return { types: ['paragraph', 'heading'] }
  },

  addGlobalAttributes() {
    const borderAttr = (edge: CellEdge) => ({
      default: null as string | null,
      parseHTML: (el: HTMLElement) => inlineBorder(el, edge),
      renderHTML: (attrs: Record<string, unknown>) => styleOf(attrs),
    })
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null as number | null,
            parseHTML: (el: HTMLElement) => parseLineHeight(el.style.getPropertyValue('line-height')),
            renderHTML: (attrs: Record<string, unknown>) => styleOf(attrs),
          },
          lineRule: {
            default: null as LineRule | null,
            // 规则跟着 line-height 的写法走：带 px 的是绝对行距，纯数字/百分数是倍数；
            // atLeast 无处可推断，读回来自定义属性
            parseHTML: (el: HTMLElement) => {
              const css = el.style.getPropertyValue('line-height')
              const mark = el.style.getPropertyValue(RULE_PROP).trim().toLowerCase()
              const known: LineRule | undefined =
                mark === 'atleast' ? 'atLeast' : mark === 'exact' ? 'exact' : mark === 'auto' ? 'auto' : undefined
              return inferRule(css, known)
            },
            renderHTML: (attrs: Record<string, unknown>) => styleOf(attrs),
          },
          spaceBefore: {
            default: null as number | null,
            parseHTML: (el: HTMLElement) => parseMargin(el.style.getPropertyValue('margin-top')),
            renderHTML: (attrs: Record<string, unknown>) => styleOf(attrs),
          },
          spaceAfter: {
            default: null as number | null,
            parseHTML: (el: HTMLElement) => parseMargin(el.style.getPropertyValue('margin-bottom')),
            renderHTML: (attrs: Record<string, unknown>) => styleOf(attrs),
          },
          background: {
            default: null as string | null,
            parseHTML: (el: HTMLElement) => rgb2hex(el.style.getPropertyValue('background-color')),
            renderHTML: (attrs: Record<string, unknown>) => styleOf(attrs),
          },
          ...Object.fromEntries(CELL_EDGES.map((edge) => [bdAttr(edge), borderAttr(edge)])),
        },
      },
    ]
  },

  addCommands() {
    /** 选区压到的段落/标题（含引用块与列表项里的），与 Indent 的判定同一套 */
    const hits = (editor: Editor) => {
      const names = new Set<string>(this.options.types)
      let any = false
      editor.state.doc.nodesBetween(editor.state.selection.from, editor.state.selection.to, (node) => {
        if (!any && names.has(node.type.name)) any = true
      })
      return any
    }

    const set =
      (attrs: Partial<ParaStyleAttrs>) =>
      ({ editor, commands }: CommandProps): boolean => {
        if (!hits(editor)) return false
        return this.options.types.map((type: string) => commands.updateAttributes(type, attrs)).some(Boolean)
      }

    return {
      setParagraphStyle: (attrs) => set(attrs),
      setParaBackground: (color) => set({ background: color }),
      setLineSpacing: (value, rule) =>
        set({ lineHeight: value, lineRule: value === null ? null : (rule ?? 'auto') }),
      setSpaceAround: (before, after) => set({ spaceBefore: before, spaceAfter: after }),
    }
  },
})

/**
 * OOXML `w:spacing` 的 `w:line` 与 `w:lineRule` → [lineHeight, lineRule]。
 * auto 时 w:line 是 1/240 行；exact/atLeast 时是二十分之一磅（这里收 px 由调用方换算）。
 */
export function ooxmlLine(line: number | undefined, rule: string | undefined, twip2px: (n: number) => number): [number, LineRule] | [] {
  if (line === undefined || !Number.isFinite(line) || line <= 0) return []
  if (!rule || rule === 'auto' || rule === 'default') return [round2(line / 240), 'auto']
  const px = round2(twip2px(line))
  return [px, rule === 'atLeast' ? 'atLeast' : 'exact']
}

/**
 * 属性上没记 lineRule 时按量级猜档：没有哪份文档是 20 倍行距，所以 >6 只可能是像素绝对值。
 * 猜错的代价是把 19px 写成 4560% 的行高，两种格式写出前都过这一道。
 */
export function ruleOf(value: number, rule: LineRule | null | undefined): LineRule {
  if (rule === 'exact' || rule === 'atLeast') return rule
  if (rule === 'auto') return 'auto'
  return value > 6 ? 'exact' : 'auto'
}

/** [lineHeight, lineRule] → OOXML 的 w:line 与 w:lineRule */
export function lineToOoxml(value: number | null, rule: LineRule | null, px2twip: (n: number) => number): { line: number; lineRule: LineRule } | undefined {
  if (!has(value) || value <= 0) return undefined
  const r = ruleOf(value, rule)
  if (r === 'auto') return { line: Math.round(value * 240), lineRule: 'auto' }
  return { line: Math.round(px2twip(value)), lineRule: r }
}
