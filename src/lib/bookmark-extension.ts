import { Mark, mergeAttributes } from '@tiptap/core'

// 书签标记（v0.146）：w:bookmarkStart/w:bookmarkEnd 的区间锚点，docx 往返用
// span[data-oo-bookmark] 承载。name 是锚点名（_Toc123 一类——目录域与交叉引用
// 指着它跳转）；w:id 只是文档内的配对令牌，写侧由 docx 库自动重排（Word 自己
// 复制书签时也重排），不进模型。
//
// 屏上不兑现：Word 里书签本来就不显示（它的管理在「插入→书签」面板），
// 这里同样不加任何可见样式——mark 只为存盘不丢。
// 已知边界（审计记账）：跨段书签在段界拆成每段一枚同名 span（mark 不能跨块）；
// 空书签（起终点相邻、不包内容）在 PM 里无处安放，往返丢失。
export const Bookmark = Mark.create({
  name: 'bookmark',
  // 不 inclusive：光标在书签末尾继续打字时，新字不该被圈进这个区间
  inclusive: false,

  addAttributes() {
    return {
      name: {
        default: null as string | null,
        parseHTML: (el) => (el.getAttribute('data-oo-bookmark') || null),
        renderHTML: (attrs) => (attrs.name ? { 'data-oo-bookmark': attrs.name } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-oo-bookmark]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})
