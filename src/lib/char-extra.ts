// 复杂文字与语言的八枚字符级槽（v0.138，iCs/bCs/smallCaps 三枚 v0.143 补）
//
// docx 的 rPr 上有八样东西在 HTML/CSS 里没有现成对应物，但**文件往返不能丢**：
//   rFonts/@w:cs   复杂文字（阿拉伯/希伯来/泰文）的字族
//   rFonts/@w:hint 含混字符用哪族字体（屏上那一半在 docx-fidelity 的 emitRunText 里直接兑现，
//                   这一枚只为存盘时不丢）
//   w:szCs/@w:val  复杂文字的字号（半点）
//   w:lang/@w:val  这段文字的语言（w:eastAsia 另存一枚）
//   w:pos/@w:val   基线升降（半点）——屏上走 vertical-align，由本 mark 的 renderHTML 画
//   w:kern/@w:val  字偶距阈值（0 = 关）——屏上走 font-kerning，同上
//   w:iCs/@w:bCs   复杂文字的斜体/粗体（只管 cs 字族那一口，与 w:i/w:b 平级）
//   w:smallCaps    小型大写——屏上走 font-variant，由本 mark 画（v0.143）
// 读侧由 docx-fidelity 发成 span[data-cs|data-hint|data-szcs|data-lang|data-lang-ea|data-pos|data-kern|
// data-ics|data-bcs|data-smallcaps]，这个 mark 接住；写侧由 docx.ts 读回 mark 属性落回 rPr。
//
// **全都能落盘**，但路径分两种，值得记一笔：cs/hint/szCs/lang/pos/kern 在 docx 库的
// RunProperties 里都实现着（createRunFonts 的 attrs.hint、options.sizeComplexScript、
// options.language、options.position、options.kern 逐枚都在），只是 **TS 的类型面没暴露**
// 这几枚（IRunStylePropertiesOptions 里查不到）。所以 docx.ts 那一头是按库外槽传的——
// 哪天升级 docx 把类型补上，`withCharExtra` 里的 `as unknown as T` 那个断言可以拆掉。
// iCs/bCs/smallCaps 三枚同理（v0.143）：库里实现着（boldComplexScript / italicComplexScript /
// smallCaps，dist 产物里逐枚有），类型面同样没暴露，走同一个库外槽。

import { Mark, mergeAttributes } from '@tiptap/core'

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

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
    }
  },

  parseHTML() {
    return [
      { tag: 'span[data-cs]' },
      { tag: 'span[data-hint]' },
      { tag: 'span[data-szcs]' },
      { tag: 'span[data-lang]' },
      { tag: 'span[data-lang-ea]' },
      { tag: 'span[data-pos]' },
      { tag: 'span[data-kern]' },
      { tag: 'span[data-ics]' },
      { tag: 'span[data-bcs]' },
      { tag: 'span[data-smallcaps]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})
