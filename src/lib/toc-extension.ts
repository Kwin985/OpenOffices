import { mergeAttributes, Node, type Editor } from '@tiptap/core'
// v0.173：标题汇总搬到 lib/outline.ts，目录节点与导航窗格共用一份形状与同一段遍历。
import { outlineOf, type OutlineEntry } from './outline'

export type TocEntry = OutlineEntry

// 遍历当前文档收集标题（1-4 级）及其位置，供目录节点渲染与跳转
export function collectHeadings(editor: Editor): TocEntry[] {
  return outlineOf(editor.state.doc)
}

// 原子块节点：内容不落在 doc 里，放映时按标题实时汇总；导出 docx 由转换器映射为原生 TOC 字段
export const Toc = Node.create({
  name: 'toc',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-toc]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '' })]
  },

  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('div')
      dom.className = 'doc-toc'
      const render = () => {
        dom.replaceChildren()
        const title = document.createElement('div')
        title.className = 'doc-toc-title'
        title.textContent = '目录'
        dom.appendChild(title)
        const list = collectHeadings(editor)
        if (!list.length) {
          const hint = document.createElement('div')
          hint.className = 'doc-toc-empty'
          hint.textContent = '（正文中使用标题 1-4，目录自动汇总于此）'
          dom.appendChild(hint)
        }
        for (const h of list) {
          const item = document.createElement('button')
          item.type = 'button'
          item.className = `doc-toc-item doc-toc-l${Math.min(4, h.level)}`
          item.textContent = h.text
          item.addEventListener('click', () => {
            const el = editor.view.nodeDOM(h.pos) as HTMLElement | null
            el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
            try {
              editor.chain().focus().setTextSelection(h.pos + 1).run()
            } catch {
              /* 文档已变化导致 pos 失效时仅滚动 */
            }
          })
          dom.appendChild(item)
        }
      }
      render()
      const onUpdate = () => render()
      editor.on('update', onUpdate)
      return {
        dom,
        ignoreMutation: () => true,
        // 目录项上的鼠标事件交给按钮自己处理，ProseMirror 不劫持
        stopEvent: (e) => !!(e.target as HTMLElement | null)?.closest('.doc-toc-item'),
        destroy() {
          editor.off('update', onUpdate)
        },
      }
    }
  },
})
