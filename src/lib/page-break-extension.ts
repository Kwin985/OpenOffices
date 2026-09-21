import { mergeAttributes, Node } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      insertPageBreak: () => ReturnType
    }
  }
}

// 原子块级节点：屏幕上是一条"分页符"占位条，打印/导出 PDF 时另起一页，
// docx 映射为空段落里的 <w:br w:type="page"/>（PageBreak run），odt 映射为 fo:break-before="page" 段落。
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-oo-pagebreak]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-oo-pagebreak': '', class: 'doc-page-break' })]
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent({ type: 'pageBreak' }).run(),
    }
  },

  addKeyboardShortcuts() {
    return {
      'Ctrl-Enter': () => this.editor.commands.insertPageBreak(),
    }
  },
})
