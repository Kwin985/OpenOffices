import { Node, mergeAttributes, type Editor } from '@tiptap/core'

/**
 * 脚注 / 尾注：一个带正文的行内原子节点。
 *
 * 为什么把正文放在属性上（而不是像批注那样另开一份 meta 列表）：脚注的正文与它的引用位置
 * 是一对一绑死的，分成两处存就会长出"孤儿脚注"和"同 id 两组区间"那一类bug（批注踩过）；
 * 记在节点属性上时，删掉标记正文就跟着走，`.odoc`/docx/odt 三条链路也共用同一份事实。
 *
 * 编号一律由文档顺序现算（CSS counter / Word 自动编号 / ODF footnote-citation 都是同一套规则），
 * 所以 schema 里没有编号字段——插入、删除、前后移动都自动重排，不需要跑 JS 去回写。
 */

export type NoteKind = 'footnote' | 'endnote'

export const NOTE_KINDS: NoteKind[] = ['footnote', 'endnote']

export const NOTE_LABEL: Record<NoteKind, string> = { footnote: '脚注', endnote: '尾注' }

export function noteKindOf(v: unknown): NoteKind {
  return v === 'endnote' ? 'endnote' : 'footnote'
}

/**
 * 正文进 data 属性要过一道编码：XML 与 HTML 的解析器都会把属性值里的换行**归一成空格**
 * （`&#10;` 也一样，规范规定先换行再归一），所以"脚注里有两段"这种文件重开一次就并成一行。
 * 两个阅读器（docx 保真导入、odt 导入）与这里的 parseHTML 共用这一对函数——编号在属性里活下来，
 * 靠的是它根本没以换行符的形式待在属性里。
 */
export function encodeNoteText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

export function decodeNoteText(s: string): string {
  if (!s.includes('\\')) return s
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\' || i + 1 >= s.length) {
      out += c
      continue
    }
    const n = s[++i]
    out += n === 'n' ? '\n' : n
  }
  return out
}

/** 面板与导出共用的"按文档顺序列出所有脚注/尾注"；pos 供定位用 */
export interface NoteRef {
  index: number
  kind: NoteKind
  text: string
  pos: number
}

export function notesOf(editor: Editor): NoteRef[] {
  const out: NoteRef[] = []
  if (!editor.state.schema.nodes.note) return out
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name !== 'note') return
    out.push({
      index: out.length,
      kind: noteKindOf(n.attrs.kind),
      text: typeof n.attrs.text === 'string' ? n.attrs.text : '',
      pos,
    })
  })
  return out
}

/** 每种类型内的序号（1 起）：屏幕上的圈号、面板标题与导出编号同一条规则 */
export function noteOrdinalOf(list: NoteRef[], ref: NoteRef): number {
  let n = 0
  for (const x of list) {
    if (x.index === ref.index) return n + 1
    if (x.kind === ref.kind) n++
  }
  return n + 1
}

export function locateNote(editor: Editor, ref: NoteRef): void {
  const dom = editor.view.domAtPos(Math.min(editor.state.doc.content.size, ref.pos + 1)).node
  const el = dom instanceof HTMLElement ? dom : dom.parentElement
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    note: {
      insertNote: (kind: NoteKind, text: string) => ReturnType
      setNoteText: (index: number, text: string) => ReturnType
      deleteNote: (index: number) => ReturnType
    }
  }
}

export const Note = Node.create({
  name: 'note',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      kind: {
        default: 'footnote',
        parseHTML: (el: HTMLElement) => noteKindOf(el.getAttribute('data-oo-note-kind')),
        renderHTML: (attrs: { kind?: string }) => ({ 'data-oo-note-kind': noteKindOf(attrs.kind) }),
      },
      text: {
        default: '',
        parseHTML: (el: HTMLElement) => decodeNoteText(el.getAttribute('data-oo-note-text') ?? ''),
        renderHTML: (attrs: { text?: string }) => ({
          'data-oo-note-text': encodeNoteText(typeof attrs.text === 'string' ? attrs.text : ''),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-oo-note-kind]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'doc-note' })]
  },

  addCommands() {
    return {
      insertNote:
        (kind, text) =>
        ({ state, dispatch, tr }) => {
          const type = state.schema.nodes.note
          if (!type) return false
          // 只填事务、不自己 dispatch：链式调用（.focus().insertNote()）最后由 TipTap 统一提交，
          // 命令里再 view.dispatch(tr) 一次会让它拿同一份 tr 提交第二遍 —— 抛
          // "Applying a mismatched transaction"（真机冒烟里点工具栏「脚注」那一步炸出来的）
          if (dispatch) dispatch(tr.replaceSelectionWith(type.create({ kind: noteKindOf(kind), text: text ?? '' })).scrollIntoView())
          return true
        },
      setNoteText:
        (index, text) =>
        ({ state, dispatch, editor }) => {
          const ref = notesOf(editor)[index]
          if (!ref || ref.text === text) return false
          if (dispatch) dispatch(state.tr.setNodeMarkup(ref.pos, undefined, { kind: ref.kind, text }))
          return true
        },
      deleteNote:
        (index) =>
        ({ state, dispatch, editor }) => {
          const ref = notesOf(editor)[index]
          if (!ref) return false
          const size = state.doc.nodeAt(ref.pos)?.nodeSize ?? 1
          if (dispatch) dispatch(state.tr.delete(ref.pos, ref.pos + size))
          return true
        },
    }
  },
})
