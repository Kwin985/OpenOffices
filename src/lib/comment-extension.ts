import { Mark, mergeAttributes, type Editor } from '@tiptap/core'

// 批注锚点标记：cid 关联 DocMeta.comments 里的批注条目，docx 往返用 span[data-oo-comment] 承载
export const Comment = Mark.create({
  name: 'comment',
  addAttributes() {
    return {
      cid: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-oo-comment') ?? 0),
        renderHTML: (attrs) => ({ 'data-oo-comment': attrs.cid }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-oo-comment]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})

export function addCommentMark(editor: Editor, cid: number): boolean {
  if (editor.state.selection.empty) return false
  return editor.chain().setMark('comment', { cid }).run()
}

export function removeCommentMark(editor: Editor, cid: number): boolean {
  const mark = editor.state.schema.marks.comment?.create({ cid })
  if (!mark) return false
  const tr = editor.state.tr
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((m) => m.type.name === 'comment' && Number(m.attrs.cid) === cid)) {
      tr.removeMark(pos, pos + node.nodeSize, mark)
    }
  })
  if (!tr.docChanged) return false
  editor.view.dispatch(tr)
  return true
}

export interface CommentAnchor {
  pos: number
  end: number
  text: string
}

export function findCommentAnchor(editor: Editor, cid: number): CommentAnchor | null {
  let found: CommentAnchor | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found) return false
    if (node.isText && node.marks.some((m) => m.type.name === 'comment' && Number(m.attrs.cid) === cid)) {
      found = { pos, end: pos + node.nodeSize, text: node.text ?? '' }
      return false
    }
    return true
  })
  return found
}

export function usedCommentCids(editor: Editor): Set<number> {
  const used = new Set<number>()
  editor.state.doc.descendants((node) => {
    for (const m of node.marks) {
      if (m.type.name === 'comment') used.add(Number(m.attrs.cid))
    }
  })
  return used
}
