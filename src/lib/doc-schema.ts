// 文档编辑器的扩展清单（v0.157）——**单一事实源**。
//
// 为什么从 DocEditor.tsx 里搬出来：保真往返账（scripts/fidelity-roundtrip.mjs）要过
// 「读手 HTML → PM 模型 → 写手 docx」这一跳，而 HTML 进模型这一步是 **TipTap 按
// schema 的 parseHTML 规则** 做的——换一份 schema 就换一套答案。此前这份清单只活在
// React 组件里，node 侧的脚本拿不到，只能另抄一份；抄的那份一旦与组件漂移，账就成了
// 假账（读手发的数据在真模型里根本接不住，抄的那份却说接住了）。
//
// 所以：清单独占一个模块，组件与量具都从这里取。改清单只改这一处。
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { TableKit } from '@tiptap/extension-table'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Superscript } from '@tiptap/extension-superscript'
import { Subscript } from '@tiptap/extension-subscript'
import Highlight from '@tiptap/extension-highlight'
import { CharacterCount } from '@tiptap/extensions'
import type { Extensions } from '@tiptap/core'
import { Comment } from './comment-extension'
import { Bookmark } from './bookmark-extension'
import { RevDel, RevIns, RevMode } from './revision-extension'
import { Note } from './note-extension'
import { Toc } from './toc-extension'
import { PageBreak } from './page-break-extension'
import { Indent } from './indent-extension'
import { CharSpacing } from './char-spacing'
import { BulletChar } from './bullet-char'
import { SpellCheck } from './spell'
import { CellStyle, IndentTableView } from './cell-style'
import { ParagraphStyle, RStyleMark } from './paragraph-style'
import { CharExtra } from './char-extra'
import { TableWidth } from './table-width'
import { FindReplace } from './find-replace'

// 图片节点：自带 width/height（像素数字），补 align=center——渲染成块级 + 双侧 auto 边距。
// 这枚 extend 原住在 DocEditor.tsx，随清单一起搬过来：它参与 schema 形状，留在组件里
// 就等于让量具与产品拿两份 schema
export const DocImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // 图片容器壳（v0.148）：wp:inline/wp:anchor 的避让与锚点、effectExtent 四边、
      // 两处对象序号与对象名、两枚 locks、prstGeom 档位、xfrm 的 off/ext。屏上一条都不
      // 兑现，只随 data-img 载荷往返（与 data-ppr/data-tlook 同一套纪律）
      img: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-img') || null,
        renderHTML: (attrs: { img?: string | null }) =>
          typeof attrs.img === 'string' && attrs.img ? { 'data-img': attrs.img } : {},
      },
      align: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          el.style.display === 'block' && el.style.marginLeft === 'auto' ? 'center' : null,
        renderHTML: (attrs: { align?: string | null }) =>
          attrs.align === 'center' ? { style: 'display:block;margin-left:auto;margin-right:auto' } : {},
      },
    }
  },
})

export function docExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
    }),
    // 列表符面（ODT 的 text:bullet-char 走 ul 的行内 list-style-type）：给 bulletList 挂一枚节点属性
    BulletChar,
    DocImage.configure({ allowBase64: true }),
    Placeholder.configure({ placeholder: '开始输入内容…' }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Indent.configure({ types: ['heading', 'paragraph'] }),
    TableKit.configure({ table: { resizable: true, View: IndentTableView } }),
    // textStyle mark + 字色/字体族/字号。lineHeight 必须关掉：那是 TextStyleKit 给段落挂的同名属性，
    // 与本编辑器记 OOXML 行距的 lineHeight（ParagraphStyle）撞名字，两边只能留一个
    TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
    // 字符间距挂同一枚 textStyle（保真导入发的 letter-spacing: Npt 靠它才进得了模型）
    CharSpacing,
    // 拼写检查：默认关。开着时每次文档变更全量重扫，长文档上是一笔输入延迟，
    // 所以做成"要查才开"而不是常驻——与 Word 那个开关同一条理由
    SpellCheck,
    // 上下标不在 TextStyleKit 里（它们是独立 mark，渲染成 <sup>/<sub>）
    Superscript,
    Subscript,
    // 表格/单元格的边框、底纹、竖排对齐与表格缩进：保真导入落在这些属性上
    CellStyle,
    // 精确列宽那一枚命令（setGridColumnWidth）：一次写遍整表，账由 redistribute 算
    TableWidth,
    // 段落行距/段前后/底纹/四边：docx 的 w:spacing、w:shd、w:pBdr 读进来就靠这一层接住
    ParagraphStyle,
    // 字符级命名样式标签（v0.113）：w:rStyle 读进来落 span[data-rstyle]，导出写回 w:rStyle
    RStyleMark,
    // 复杂文字与语言四槽（v0.138）：cs/szCs/lang/hint 读进来落 data-*，导出按库的选项面能写多少写多少
    CharExtra,
    // 书签区间（v0.146）：w:bookmarkStart/End 读进来落 span[data-oo-bookmark]，导出包回 Bookmark
    Bookmark,
    Highlight.configure({ multicolor: true }),
    CharacterCount,
    Toc,
    PageBreak,
    Comment,
    // 修订标记（v0.100）：docx 的 w:ins/w:del 读进来落在这里，接受/拒绝在工具栏
    RevIns,
    RevDel,
    // 修订模式（v0.101）：本应用里改字留痕，插入自动挂 revIns、删除转 revDel
    RevMode,
    // 脚注/尾注：行内原子节点，正文存在节点属性上（三条保存链路都从这一份事实出发）
    Note,
    FindReplace,
  ]
}
