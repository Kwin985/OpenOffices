import { Extension, type CommandProps, type Editor } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      /** 绝对设定：导入与批量套用样式走这里 */
      setIndent: (attrs: { indentLeft?: number | null; indentFirst?: number | null }) => ReturnType
      /** Ctrl+]：整段向右一格；悬挂缩进时首行位置保持不动 */
      indent: () => ReturnType
      /** Ctrl+[: 整段向左一格，退到 0 时连负的首行缩进一并收掉 */
      outdent: () => ReturnType
    }
  }
}

/** 一格 32px ≈ 16px 字号下的两个汉字，与 Word「首行缩进 2 字符」的观感对齐 */
export const INDENT_STEP_PX = 32
/** 上限只是防手滑：缩到这条线以内正文就只剩一条缝了 */
export const INDENT_MAX_PX = 320

function px(v: string | null | undefined): number | undefined {
  if (!v) return undefined
  const s = v.trim()
  if (!s.endsWith('px')) return undefined
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) && n !== 0 ? n : undefined
}

function int(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : 0
}

/** 两个属性共用一条 style：分开各写一份 style 时，后写的那份会整条盖掉前一份 */
function styleOf(a: { indentLeft?: unknown; indentFirst?: unknown }): { style?: string } {
  const bits: string[] = []
  const left = int(a.indentLeft)
  const first = int(a.indentFirst)
  if (left) bits.push(`margin-left: ${left}px`)
  if (first) bits.push(`text-indent: ${first}px`)
  return bits.length ? { style: bits.join('; ') } : {}
}

// 段落/标题的缩进。TipTap 的 TextAlign 只管对齐，schema 里没有缩进这一层，
// 而 Word 中文文档最常见的排版动作恰恰是缩进（正文首行缩进两字符）——不补这个扩展，
// 保真导入产出的 margin-left/text-indent 会在 setContent 时被 schema 当场剥掉。
export const Indent = Extension.create({
  name: 'indent',

  addOptions() {
    return { types: ['paragraph', 'heading'], step: INDENT_STEP_PX, max: INDENT_MAX_PX }
  },

  addGlobalAttributes() {
    const max = this.options.max
    return [
      {
        types: this.options.types,
        attributes: {
          indentLeft: {
            default: null,
            parseHTML: (el) => {
              const n = px(el.style.marginLeft)
              return n === undefined ? undefined : Math.max(0, Math.min(max, n))
            },
            renderHTML: (a) => styleOf(a),
          },
          indentFirst: {
            default: null,
            parseHTML: (el) => {
              const n = px(el.style.textIndent)
              return n === undefined ? undefined : Math.max(-max, Math.min(max, n))
            },
            renderHTML: (a) => styleOf(a),
          },
        },
      },
    ]
  },

  addCommands() {
    /** 选区压到的段落/标题（含引用块与列表项里的），按位置去重 */
    const hits = (editor: Editor) => {
      const names = new Set<string>(this.options.types)
      const seen = new Set<number>()
      const out: { pos: number; left: number; first: number }[] = []
      const { from, to } = editor.state.selection
      editor.state.doc.nodesBetween(from, to, (node, pos) => {
        if (seen.has(pos)) return
        seen.add(pos)
        if (!names.has(node.type.name)) return
        out.push({ pos, left: int(node.attrs.indentLeft), first: int(node.attrs.indentFirst) })
      })
      return out
    }

    const shift =
      (dir: 1 | -1) =>
      ({ editor, tr, dispatch }: CommandProps): boolean => {
        const { step, max } = this.options
        const list = hits(editor)
        if (list.length === 0) return false
        const next = list.map((h) => {
          if (dir > 0) {
            const left = Math.min(max, h.left + step)
            // 悬挂缩进（负的首行）：整段右移一格时，首行的绝对位置要留在原处
            return { ...h, left, first: h.first < 0 ? h.first - step : h.first }
          }
          const left = Math.max(0, h.left - step)
          return { ...h, left, first: left === 0 ? Math.max(0, h.first) : h.first }
        })
        if (next.every((n, i) => n.left === list[i]!.left && n.first === list[i]!.first)) return false
        if (dispatch)
          for (const n of next) {
            tr.setNodeAttribute(n.pos, 'indentLeft', n.left || null)
            tr.setNodeAttribute(n.pos, 'indentFirst', n.first || null)
          }
        return true
      }

    return {
      setIndent:
        (attrs) =>
        ({ editor, commands }) => {
          if (hits(editor).length === 0) return false
          return this.options.types.map((type) => commands.updateAttributes(type, attrs)).some(Boolean)
        },
      indent: () => shift(1),
      outdent: () => shift(-1),
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-]': () => this.editor.commands.indent(),
      'Mod-[': () => this.editor.commands.outdent(),
    }
  },
})
