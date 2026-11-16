import { Mark, mergeAttributes } from '@tiptap/core'

// 书签标记（v0.146）：w:bookmarkStart/w:bookmarkEnd 的区间锚点，docx 往返用
// span[data-oo-bookmark] 承载。name 属性是锚点名（_Toc123 一类——目录域与交叉
// 引用指着它跳转）；v0.186 起这格是「锚点名;源件 w:id」两格的整串（字符串槽，
// 零 schema 改动）：w:id 只往返、不上屏——原先指望 docx 库自动重排，实测它把
// 每枚书签的 w:id 恒写成 1，Word 里几枚书签同号就分不开，得按名回填源值。
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
