import { Extension, Mark, mergeAttributes, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'

// 修订标记：docx 的 w:ins（插入）与 w:del（删除）读进来落在这两个 mark 上，
// 往返用 span[data-rev] 承载。不用原生 <ins>/<del> 标签——StarterKit 的删除线
// mark 已把 <del> 占了，同一段文字会被读成"既有修订又有删除线"两种含义。

export interface RevInfo {
  author: string
  date: string
}

function revMark(name: 'revIns' | 'revDel', kind: 'ins' | 'del') {
  return Mark.create({
    name,
    addAttributes() {
      return {
        author: {
          default: '',
          parseHTML: (el: HTMLElement) => el.getAttribute('data-rev-author') ?? '',
          renderHTML: (attrs: Record<string, unknown>) => ({ 'data-rev-author': attrs.author ?? '' }),
        },
        date: {
          default: '',
          parseHTML: (el: HTMLElement) => el.getAttribute('data-rev-date') ?? '',
          renderHTML: (attrs: Record<string, unknown>) => ({ 'data-rev-date': attrs.date ?? '' }),
        },
      }
    },
    parseHTML() {
      return [{ tag: `span[data-rev="${kind}"]` }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['span', mergeAttributes(HTMLAttributes, { 'data-rev': kind }), 0]
    },
  })
}

export const RevIns = revMark('revIns', 'ins')
export const RevDel = revMark('revDel', 'del')

// ---- 接受 / 拒绝：纯函数核（离线可测），命令包装只差一个 dispatch ----

export type RevKind = 'revIns' | 'revDel'
export interface RevRange {
  from: number
  to: number
}

/** 文档里带某类修订标记的文字区间；给了选区就只收与选区相交的 */
export function revisionRanges(doc: PMNode, kind: RevKind, sel?: { from: number; to: number }): RevRange[] {
  const out: RevRange[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.marks.some((m) => m.type.name === kind)) return
    const from = pos
    const to = pos + node.nodeSize
    if (sel && (to <= sel.from || from >= sel.to)) return
    out.push({ from, to })
  })
  return out
}

/**
 * 对修订做出裁决要做的两件事：
 * - accept ins / reject del：只摘标记，文字留着
 * - reject ins / accept del：连文字一起删（区间从后往前删，前面的位置不受影响）
 */
export function adjudicate(
  doc: PMNode,
  kind: RevKind,
  verdict: 'accept' | 'reject',
  sel?: { from: number; to: number },
): { markRanges: RevRange[]; deleteRanges: RevRange[] } {
  const ranges = revisionRanges(doc, kind, sel)
  // 擦文字的只有两种：拒绝插入（新加的不要了）、接受删除（旧字真删掉）；另两种只摘标记
  const erase = (verdict === 'reject') === (kind === 'revIns')
  if (!erase) return { markRanges: ranges, deleteRanges: [] }
  return { markRanges: [], deleteRanges: [...ranges].sort((a, b) => b.from - a.from) }
}

function apply(editor: Editor, kind: RevKind, verdict: 'accept' | 'reject'): number {
  const { markRanges, deleteRanges } = adjudicate(editor.state.doc, kind, verdict, editor.state.selection)
  const mark = editor.state.schema.marks[kind]
  const tr = editor.state.tr
  for (const r of deleteRanges) tr.delete(r.from, r.to)
  if (mark) for (const r of markRanges) tr.removeMark(r.from, r.to, mark)
  if (!tr.docChanged && !tr.steps.length) return 0
  editor.view.dispatch(tr)
  return markRanges.length + deleteRanges.length
}

/**
 * 接受修订：有选区只裁决选区内的，否则全文。返回处理了多少处。
 * accept = ins 文字转正 + del 文字删除；reject 相反（ins 删、del 转正）。
 */
export function acceptRevisions(editor: Editor): number {
  return apply(editor, 'revIns', 'accept') + apply(editor, 'revDel', 'accept')
}

export function rejectRevisions(editor: Editor): number {
  return apply(editor, 'revIns', 'reject') + apply(editor, 'revDel', 'reject')
}

/** 剩余修订处数（按文字段计）：工具栏提示与「还有没定稿完」的判断用 */
export function revisionCount(editor: Editor): number {
  return revisionRanges(editor.state.doc, 'revIns').length + revisionRanges(editor.state.doc, 'revDel').length
}

// ---- 修订模式：本应用里改字也留痕（v0.101） ----
//
// 开着时：打字/粘贴的插入内容自动挂 revIns（接受=转正、拒绝=删除，按钮复用上一排）；
// Backspace/Delete/Cut 不真删，改成把区间挂 revDel（红删除线留在原位）。
// 段落结构（回车、段合并）不追踪——模型里没有段落标记的修订位，与读侧同一账本。

interface RevModeState {
  on: boolean
  author: string
}

export const revModeKey = new PluginKey<RevModeState>('revMode')

/** 本应用署名沿用批注的「我」：往返到 Word 后作者列显示它，谁改的一眼可辨 */
const LOCAL_AUTHOR = '我'

export function createRevModePlugin(): Plugin<RevModeState> {
  return new Plugin<RevModeState>({
    key: revModeKey,
    state: {
      init: () => ({ on: false, author: LOCAL_AUTHOR }),
      apply(tr, cur) {
        const m = tr.getMeta(revModeKey) as Partial<RevModeState> | undefined
        return m ? { on: m.on ?? cur.on, author: m.author ?? cur.author } : cur
      },
    },
    appendTransaction(trs, _oldState, newState) {
      const mode = revModeKey.getState(newState)
      if (!mode?.on) return null
      const markType = newState.schema.marks.revIns
      if (!markType) return null
      const insMark = markType.create({ author: mode.author, date: new Date().toISOString() })
      const tr = newState.tr
      trs.forEach((t, k) => {
        // 开关本身与自己的打标事务不再打标（防套娃）
        if (t.getMeta(revModeKey) !== undefined || t.getMeta('ooRevMarked')) return
        t.steps.forEach((step, i) => {
          if (!(step instanceof ReplaceStep)) return
          // 纯内容插入才追踪：slice 带开口/含块节点（回车切分、整段粘贴）说明结构在变，模型装不下
          if (!step.slice.size || step.slice.openStart || step.slice.openEnd) return
          let structural = false
          step.slice.content.forEach((n) => {
            if (!n.isInline) structural = true
          })
          if (structural) return
          // 步内坐标 → 本事务末 → 后续事务末，一路映射到最终文档
          let from = t.mapping.slice(i).map(step.from, -1)
          for (let j = k + 1; j < trs.length; j++) from = trs[j].mapping.map(from, -1)
          tr.addMark(from, from + step.slice.size, insMark)
        })
      })
      if (!tr.docChanged && !tr.steps.length) return null
      tr.setMeta('ooRevMarked', true)
      return tr
    },
  })
}

export const RevMode = Extension.create({
  name: 'revMode',
  addProseMirrorPlugins() {
    return [createRevModePlugin()]
  },
})

export function revModeOn(editor: Editor): boolean {
  return !!revModeKey.getState(editor.state)?.on
}

/** 同上，直接吃 ProseMirror 状态（editorProps 的键盘钩子里没有 Editor 实例） */
export function revModeOnState(state: EditorState): boolean {
  return !!revModeKey.getState(state)?.on
}

/** 开/关修订模式，返回切换后的状态 */
export function toggleRevMode(editor: Editor): boolean {
  const cur = revModeKey.getState(editor.state) ?? { on: false, author: LOCAL_AUTHOR }
  editor.view.dispatch(editor.state.tr.setMeta(revModeKey, { on: !cur.on }))
  return !cur.on
}

/**
 * 删除键的修订化（Backspace/Delete/Ctrl+X 共用）：区间全是未定稿的插入（revIns）或压根
 * 没有文字（段落缝）时返回 null——前者让真删除通过（接受语义正好抵消），后者结构不追踪；
 * 其余返回「把区间挂 revDel、不删字」的事务。纯函数，离线可测。
 */
export function deleteAsRevision(state: EditorState, from: number, to: number): Transaction | null {
  const mode = revModeKey.getState(state)
  if (!mode?.on) return null
  if (to <= from) return null
  const delType = state.schema.marks.revDel
  const insType = state.schema.marks.revIns
  if (!delType) return null
  let hasText = false
  let allIns = true
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true
    hasText = true
    if (!node.marks.some((m) => m.type === insType)) allIns = false
    return false
  })
  if (!hasText || allIns) return null
  const tr = state.tr
  tr.addMark(from, to, delType.create({ author: mode.author, date: new Date().toISOString() }))
  return tr
}
