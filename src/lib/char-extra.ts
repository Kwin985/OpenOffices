// 复杂文字与语言的十枚字符级槽（v0.138，iCs/bCs/smallCaps 三枚 v0.143 补，
// langBidi/scale 两枚 v0.146 补，caps/bdr 两枚 v0.152 补）
//
// docx 的 rPr 上有十样东西在 HTML/CSS 里没有现成对应物，但**文件往返不能丢**：
//   rFonts/@w:cs   复杂文字（阿拉伯/希伯来/泰文）的字族
//   rFonts/@w:hint 含混字符用哪族字体（屏上那一半在 docx-fidelity 的 emitRunText 里直接兑现，
//                   这一枚只为存盘时不丢）
//   w:szCs/@w:val  复杂文字的字号（半点）
//   w:lang/@w:val  这段文字的语言（w:eastAsia 另存一枚）
//   w:lang/@w:bidi 复杂文字的语言（v0.146）——只管 cs 字族那一口，CSS 无对应物
//   w:w/@w:val     字符缩放百分比（v0.146）——CSS inline 排版没有等价横向缩放
//   w:pos/@w:val   基线升降（半点）——屏上走 vertical-align，由本 mark 的 renderHTML 画
//   w:kern/@w:val  字偶距阈值（0 = 关）——屏上走 font-kerning，同上
//   w:iCs/@w:bCs   复杂文字的斜体/粗体（只管 cs 字族那一口，与 w:i/w:b 平级）
//   w:smallCaps    小型大写——屏上走 font-variant，由本 mark 画（v0.143）
//   w:caps/@w:val  全大写（v0.152）——屏上走 text-transform，同上
//   w:bdr 四属性   字符边框（v0.152）——屏上走 CSS border，同上；val 是线型、sz 是
//                  八分之一磅、space 是磅、color 是 hex，四枚一组缺一不可
// 读侧由 docx-fidelity 发成 span[data-cs|data-hint|data-szcs|data-lang|data-lang-ea|data-lang-bidi|
// data-scale|data-pos|data-kern|data-ics|data-bcs|data-smallcaps|data-caps|data-bdr|data-u|
// data-ctheme|data-sym]，
// 这个 mark 接住；写侧由 docx.ts 读回 mark 属性落回 rPr。
//
// **全都能落盘**，但路径分两种，值得记一笔：cs/hint/szCs/lang/pos/kern 在 docx 库的
// RunProperties 里都实现着（createRunFonts 的 attrs.hint、options.sizeComplexScript、
// options.language、options.position、options.kern 逐枚都在），只是 **TS 的类型面没暴露**
// 这几枚（IRunStylePropertiesOptions 里查不到）。所以 docx.ts 那一头是按库外槽传的——
// 哪天升级 docx 把类型补上，`withCharExtra` 里的 `as unknown as T` 那个断言可以拆掉。
// iCs/bCs/smallCaps 三枚同理（v0.143）：库里实现着（boldComplexScript / italicComplexScript /
// smallCaps，dist 产物里逐枚有），类型面同样没暴露，走同一个库外槽。
// caps/bdr 两枚（v0.152）反而是**类型面全暴露**的（IRunOptions.allCaps 与 IRunOptions.border，
// dist/index.d.ts:1660 与 :1674）——库里实现着、类型也写着，docx.ts 直接传，不用断言。
//
// 两枚「不在 rPr 上」的例外（v0.159）：
//   u    —— 下划线的线型/字面/主题六格。包只有 {type,color} 两枚槽，主题三枚走 run 级补丁位
//   sym  —— 符号的 char/font。包里有原生 SymbolRun（发 w:sym），缺的只是读手没带原值

import { Mark, mergeAttributes } from '@tiptap/core'
import { CSS_BORDER_STYLE, eighthsToPx } from './cell-style'

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const round2 = (n: number): number => Math.round(n * 100) / 100

/** w:u/@w:val 的线型 → CSS text-decoration-style（v0.156）。
 * 认不得的档按 solid——OOXML 有十八档线型，CSS 只有五档，多数档只能近似 */
const U_LINE: Record<string, string> = {
  single: 'solid',
  words: 'solid',
  double: 'double',
  thick: 'solid',
  dotted: 'dotted',
  dotteddheavy: 'dotted',
  dottedheavy: 'dotted',
  dash: 'dashed',
  dashlong: 'dashed',
  dashdotheavy: 'dashed',
  dotdash: 'dashed',
  dotdotdash: 'dashed',
  wave: 'wavy',
  wavyheavy: 'wavy',
  wavydouble: 'wavy',
  none: 'none',
}
/** w:em/@w:val → CSS text-emphasis（v0.156）。与 docx-fidelity 的 EMPHASIS 表同一套值 */
const EMPHASIS_CSS: Record<string, { style: string; under?: boolean }> = {
  dot: { style: 'dot' },
  circle: { style: 'circle' },
  comma: { style: 'sesame' },
  underdot: { style: 'dot', under: true },
}

export const CharExtra = Mark.create({
  name: 'charExtra',
  // 不 inclusive：光标在一段文字末尾继续打字时，新字不该继承上一段文字的 cs/lang——
  // 那是上一段 run 的属性，不是"从此以后的默认"
  inclusive: false,

  addAttributes() {
    return {
      cs: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-cs')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.cs) ? { 'data-cs': str(attrs.cs) } : {}),
      },
      hint: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-hint')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.hint) ? { 'data-hint': str(attrs.hint) } : {}),
      },
      szcs: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => {
          const v = Number(el.getAttribute('data-szcs'))
          return Number.isFinite(v) && v > 0 ? v : null
        },
        renderHTML: (attrs: Record<string, unknown>) => (num(attrs.szcs) ? { 'data-szcs': String(num(attrs.szcs)) } : {}),
      },
      lang: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-lang')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.lang) ? { 'data-lang': str(attrs.lang) } : {}),
      },
      langEa: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-lang-ea')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.langEa) ? { 'data-lang-ea': str(attrs.langEa) } : {}),
      },
      // langBidi（v0.146）：w:lang/@w:bidi，复杂文字的语言。与 lang/langEa 同住 w:lang，
      // 但只管 cs 字族那一口，CSS 没有对应物——只往返
      langBidi: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-lang-bidi')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.langBidi) ? { 'data-lang-bidi': str(attrs.langBidi) } : {}),
      },
      // scale（v0.146）：w:w/@w:val，字符缩放百分比（Word 的「字符缩放」）。
      // CSS 的 inline 排版没有等价物（transform:scaleX 会破坏行盒），屏上不兑现——只往返
      scale: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => {
          const v = Number(el.getAttribute('data-scale'))
          return Number.isFinite(v) && v > 0 ? v : null
        },
        renderHTML: (attrs: Record<string, unknown>) => (num(attrs.scale) ? { 'data-scale': String(num(attrs.scale)) } : {}),
      },
      // pos/kern 的屏上那一半由这里画：导入 HTML 上那枚 inline style 过不了 TipParse
      // （textStyle 只认自己那几个属性），所以升降与字偶距必须由 mark 自己发 CSS。
      // px 换算与导入侧同一把尺（半点 → 磅 × 4/3，两位小数），否则同一枚属性两条路上两个高度
      pos: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => {
          const v = Number(el.getAttribute('data-pos'))
          return Number.isFinite(v) && v !== 0 ? v : null
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const p = num(attrs.pos)
          if (!p) return {}
          const px = Math.round((p / 2) * (4 / 3) * 100) / 100
          return { 'data-pos': String(p), style: `vertical-align: ${px}px` }
        },
      },
      kern: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => {
          const v = Number(el.getAttribute('data-kern'))
          return Number.isFinite(v) && v >= 0 ? v : null
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          num(attrs.kern) === 0 ? { 'data-kern': '0', style: 'font-kerning: none' } : {},
      },
      // iCs/bCs（v0.143）：复杂文字的斜体/粗体。CSS 没有「只对 cs 字族生效」这一族开关，
      // 屏上不兑现——只随 data-* 进模型再走往返（与 cs/szCs 同纪律）。
      // 载荷是 '1'（开）或 null（没声明）：OOXML 的 onOff 语义，w:iCs w:val="0" 也是「关」，
      // 而「关」与「没写」在往返里同结果，不必存 false
      ics: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-ics')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.ics) ? { 'data-ics': '1' } : {}),
      },
      bcs: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-bcs')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.bcs) ? { 'data-bcs': '1' } : {}),
      },
      // smallCaps（v0.143）：小型大写。CSS 的 font-variant-caps 正好是这一个，
      // 屏上直接兑现（pos/kern 同款：mark 自己发 CSS）
      smallcaps: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-smallcaps')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.smallcaps) ? { 'data-smallcaps': '1', style: 'font-variant-caps: small-caps' } : {}),
      },
      // caps（v0.152）：全大写。CSS 的 text-transform: uppercase 正好是这一个，
      // 屏上直接兑现（smallCaps 同款）。载荷 '1'（开）或 null——与 iCs/bCs 同纪律
      caps: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-caps')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.caps) ? { 'data-caps': '1', style: 'text-transform: uppercase' } : {}),
      },
      // bdr（v0.152）：字符边框四枚一组（val;sz;space;color，空槽 = 那枚没写）。
      // 屏上走 CSS border——sz 是八分之一磅、space 是磅，两枚要换算；val 经
      // cell-style 的 CSS_BORDER_STYLE 映射（那张表是线型的单一真源）。
      // 导入侧同 pos/kern 的规矩：inline style 过不了 TipParse，CSS 由 mark 自己发
      bdr: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-bdr')),
        renderHTML: (attrs: Record<string, unknown>) => {
          const raw = str(attrs.bdr)
          if (!raw) return {}
          const [val = '', sz = '', space = '', color = ''] = raw.split(';')
          const style = CSS_BORDER_STYLE[(val || 'single').toLowerCase()] ?? 'solid'
          const w = /^\d+$/.test(sz) && Number(sz) > 0 ? eighthsToPx(Number(sz)) : eighthsToPx(1)
          const c = color && color.toLowerCase() !== 'auto' ? `#${color.replace(/^#/, '').toLowerCase()}` : 'currentColor'
          // space 是「边框与文字的距离」（磅）——CSS inline 上只有水平内衬接得住，
          // 给了才垫（Word 少写这一枚时不垫，与它的默认同结果）
          const pad = /^\d+$/.test(space) && Number(space) > 0 ? `padding: 0 ${round2(Number(space) * (4 / 3))}px; ` : ''
          return { 'data-bdr': raw, style: `${pad}border: ${w}px ${style} ${c}` }
        },
      },
      // vanish（v0.154）：隐藏文字。CSS 用 visibility: hidden 而不是 display:none
      // ——Word 的隐藏文字不显示但**仍占版面**（行高、分页照算），display:none 会把它
      // 从布局里抹掉，等于改变了周围的排版。载荷 '1'（隐藏）或 null（与 iCs/bCs 同纪律）
      vanish: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-vanish')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.vanish) ? { 'data-vanish': '1', style: 'visibility: hidden' } : {}),
      },
      // u（v0.156）：下划线**线型 + 颜色**一组。载荷六格
      // `线型;屏上色;字面色;themeColor;themeTint;themeShade`（空槽 = 那枚没写）。
      // 为什么要这一枚：<u> 标签只带得动「有下划线」这一比特，线型与颜色都挂在这个标签的
      // inline style 上，而 inline style 过不了 TipParse（underline mark 只认标签名）——
      // 屏上那半由本 mark 自己发 CSS（与 pos/kern 同纪律），存盘那半由 docx.ts 落回
      // w:u 的 w:val 与 w:color（docx 的 underline.type / underline.color 两枚都是原生槽）。
      // 主题三枚（v0.159）包外无槽：写手另走 run 级补丁位补回 word/document.xml
      u: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-u')),
        renderHTML: (attrs: Record<string, unknown>) => {
          const raw = str(attrs.u)
          if (!raw) return {}
          // 第二格是屏上色（解析主题之后的颜色）；第三格起是存盘用的原值，屏上不用
          const [val = 'single', color = ''] = raw.split(';')
          const line = U_LINE[val.toLowerCase()] ?? 'underline'
          const c = color && color.toLowerCase() !== 'auto' ? `text-decoration-color: #${color.replace(/^#/, '').toLowerCase()}; ` : ''
          return { 'data-u': raw, style: `${c}text-decoration-line: underline; text-decoration-style: ${line}` }
        },
      },
      // ctheme（v0.160）：**文字色** `w:color` 上的主题引用三枚。载荷 `ref;tint;shade`
      // ——与 u 那三格同形状，但槽在另一个元素上（w:color 而不是 w:u）。
      // 屏上那一半已经由 textStyle 的 color 兑现（读手把主题解析成 hex 再发 CSS），
      // 这一格只为存盘：包发 w:color 时只写 w:val，主题三枚包外无槽，走 run 级补丁位。
      // 为什么不并进 u 那一格：两者是**不同元素上的不同属性**，并一格就得在载荷里再
      // 记一次「这枚属于谁」，补丁位的对位也会跟着耦合（u 的枚数闸门与 color 的不同）
      ctheme: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-ctheme')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.ctheme) ? { 'data-ctheme': str(attrs.ctheme) } : {}),
      },
      // sym（v0.159）：符号（w:sym）。载荷 `char;font`——char 是**原始的十六进制串**
      // （原样保留，不做大小写与补零的规整），font 是符号字体名。
      // 屏上那一半点：读手已经把字符本身发在 span 里（`&#xF0FC;` 这样的私有区码点）并
      // 挂了 font-family，本 mark 不再画；这里只为存盘时发回真的 `<w:sym w:char w:font>`
      // ——docx 包有原生 SymbolRun，不需要补丁位
      sym: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-sym')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.sym) ? { 'data-sym': str(attrs.sym) } : {}),
      },
      // em（v0.156）：着重号型别（dot 圈点 / circle 空心圈 / comma 逗号 / underDot 点在下）。
      // 屏上走 text-emphasis——与 docx-fidelity 的 EMPHASIS 表同一套映射（两处必须一致，
      // 否则同一枚属性在「导入后立刻导出」与「编辑器里再渲染」两条路上长两个样）
      em: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-em')),
        renderHTML: (attrs: Record<string, unknown>) => {
          const v = str(attrs.em)
          if (!v) return {}
          const e = EMPHASIS_CSS[v.toLowerCase()]
          if (!e) return { 'data-em': v }
          return { 'data-em': v, style: `text-emphasis: ${e.style}${e.under ? '; text-emphasis-position: under right' : ''}` }
        },
      },
      // emboss/imprint（v0.156）：浮雕与阴文。CSS 只有半吊子近似（text-shadow 模拟浮雕），
      // 做了会画出与 Word 不像的样子——屏上不兑现，只随 data-* 走往返（与 iCs/bCs 同纪律）。
      // 写侧两枚在 docx 包里都是原生槽（IRunOptions.emboss / imprint），直接传
      emboss: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-emboss')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.emboss) ? { 'data-emboss': '1' } : {}),
      },
      imprint: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => str(el.getAttribute('data-imprint')),
        renderHTML: (attrs: Record<string, unknown>) => (str(attrs.imprint) ? { 'data-imprint': '1' } : {}),
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'span[data-cs]' },
      { tag: 'span[data-hint]' },
      { tag: 'span[data-szcs]' },
      { tag: 'span[data-lang]' },
      { tag: 'span[data-lang-ea]' },
      { tag: 'span[data-lang-bidi]' },
      { tag: 'span[data-scale]' },
      { tag: 'span[data-pos]' },
      { tag: 'span[data-kern]' },
      { tag: 'span[data-ics]' },
      { tag: 'span[data-bcs]' },
      { tag: 'span[data-smallcaps]' },
      { tag: 'span[data-caps]' },
      { tag: 'span[data-bdr]' },
      { tag: 'span[data-vanish]' },
      { tag: 'span[data-u]' },
      { tag: 'span[data-ctheme]' },
      { tag: 'span[data-sym]' },
      { tag: 'span[data-em]' },
      { tag: 'span[data-emboss]' },
      { tag: 'span[data-imprint]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})
