import { Extension, Mark, mergeAttributes, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { authorColor, identityName } from './identity'

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
      const who = String(HTMLAttributes['data-rev-author'] ?? '')
      const extra: Record<string, string> = { 'data-rev': kind }
      if (who) extra.style = `color:${authorColor(who)}`
      return ['span', mergeAttributes(HTMLAttributes, extra), 0]
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

/** 本应用署名的兜底值：真正用的是 identityName()（用户可在工具栏改名） */
const LOCAL_AUTHOR = '我'

export function createRevModePlugin(): Plugin<RevModeState> {
  return new Plugin<RevModeState>({
    key: revModeKey,
    state: {
      init: () => ({ on: false, author: identityName() || LOCAL_AUTHOR }),
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
      // 留痕那一刻才读身份：改了名之后的修订署新名，之前那些不动
      const insMark = markType.create({
        author: identityName() || mode.author || LOCAL_AUTHOR,
        date: new Date().toISOString(),
      })
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

// ── 文档比较（v0.234）───────────────────────────────────────────────────────
// 两份文本 → 一份带修订 mark 的 HTML（删除挂 data-rev="del"、插入挂 data-rev="ins"）。
// 应用后用户能逐条接受/拒绝（复用上面的 acceptRevisions/rejectRevisions），
// 写手会把带 mark 的文字段写成 w:ins/w:del（docx.ts 的修订壳分支）。
//
// 粒度：先按段落对齐（空行也算一段），段内按「词」做 LCS——中文按单字、英文按单词，
// 这样「把 3 改成 5」只标一个字符，而不是整段闪红。LCS 用 DP，输入上限由调用方守。

export interface CompareOptions {
  author?: string
  date?: string
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 段落切法：换行分段，保留空段（空行被删也是一处修改） */
export function splitParagraphs(s: string): string[] {
  return s.replace(/\r\n?/g, '\n').split('\n')
}

/** 段内 token：英文/数字连成一词，中日韩逐字，空白单独成 token（保住空格改动） */
export function tokenize(s: string): string[] {
  const out: string[] = []
  const re = /[A-Za-z0-9_]+|[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|\s+|./gu
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[0])
  return out
}

interface Op {
  kind: 'eq' | 'del' | 'ins'
  text: string
}

/** 标准 LCS → 增删操作序列（同词连续合并，减少 mark 碎片） */
function diffTokens(a: string[], b: string[], sep = ''): Op[] {
  const n = a.length, m = b.length
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const raw: Op[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { raw.push({ kind: 'eq', text: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { raw.push({ kind: 'del', text: a[i] }); i++ }
    else { raw.push({ kind: 'ins', text: b[j] }); j++ }
  }
  while (i < n) raw.push({ kind: 'del', text: a[i++] })
  while (j < m) raw.push({ kind: 'ins', text: b[j++] })
  const merged: Op[] = []
  for (const op of raw) {
    const last = merged[merged.length - 1]
    if (last && last.kind === op.kind) last.text += sep + op.text
    else merged.push({ ...op })
  }
  return merged
}

/** 一段的 diff HTML；无差异返回原文（转义后） */
function diffParagraphHTML(oldText: string, newText: string, opts: Required<CompareOptions>): string {
  if (oldText === newText) return esc(oldText)
  const ops = diffTokens(tokenize(oldText), tokenize(newText))
  return ops.map((op) => {
    if (op.kind === 'eq') return esc(op.text)
    const kind = op.kind === 'del' ? 'del' : 'ins'
    return `<span data-rev="${kind}" data-rev-author="${esc(opts.author)}" data-rev-date="${esc(opts.date)}">${esc(op.text)}</span>`
  }).join('')
}

/**
 * 文档比较主入口：原文本 → 新文本，产出可直接塞进编辑器的段落 HTML 串。
 * 段落对齐也走 LCS；相邻的一删一插若段落数相同就配对做段内词级 diff，
 * 于是「把 3 改成 5」只标一个字符，而不是整段闪红。
 */
export function compareTextToHtml(
  oldText: string,
  newText: string,
  opts: CompareOptions = {},
): { html: string; changed: number } {
  const o = { author: opts.author || '文档比较', date: opts.date || new Date().toISOString() }
  const a = splitParagraphs(oldText)
  const b = splitParagraphs(newText)
  const ops = diffTokens(a, b, '\n')
  const paras: string[] = []
  let changed = 0

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    if (op.kind === 'eq') {
      for (const para of op.text.split('\n')) paras.push(`<p>${esc(para)}</p>`)
      continue
    }
    // 相邻的 del + ins 且段数相同 → 逐段做词级 diff（最常见的「改几个字」形状）
    const next = ops[k + 1]
    if (op.kind === 'del' && next?.kind === 'ins' && op.text.split('\n').length === next.text.split('\n').length) {
      const oldPs = op.text.split('\n'), newPs = next.text.split('\n')
      for (let i = 0; i < oldPs.length; i++) paras.push(`<p>${diffParagraphHTML(oldPs[i], newPs[i], o)}</p>`)
      changed += oldPs.length
      k++
      continue
    }
    changed++
    const kind = op.kind === 'del' ? 'del' : 'ins'
    for (const para of op.text.split('\n')) {
      paras.push(`<p><span data-rev="${kind}" data-rev-author="${esc(o.author)}" data-rev-date="${esc(o.date)}">${esc(para)}</span></p>`)
    }
  }
  return { html: paras.join(''), changed }
}

/** 段内细粒度比较（用于「整段替换但大部分相同」的场景，保留未改的字） */
export function compareParagraphsToHtml(
  oldText: string,
  newText: string,
  opts: CompareOptions = {},
): string {
  const o = { author: opts.author || '文档比较', date: opts.date || new Date().toISOString() }
  return splitParagraphs(oldText).map((_, i) => {
    const a = splitParagraphs(oldText)[i] ?? ''
    const b = splitParagraphs(newText)[i] ?? ''
    return `<p>${diffParagraphHTML(a, b, o)}</p>`
  }).join('')
}
