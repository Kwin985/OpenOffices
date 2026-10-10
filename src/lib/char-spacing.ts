import { Extension } from '@tiptap/core'

/**
 * 字符间距（Word 的「字符间距/间距」，OOXML 是 `w:rPr/w:spacing@w:val`，单位缇＝1/20 磅）。
 *
 * 为什么单开一个扩展：保真导入器早已把这一层读成 `letter-spacing: Npt` 上屏，
 * 但 schema 里没这一枚属性，`setContent` 时 style 上那一句会被当场剥掉——
 * 屏上看到过一次的字符间距，落到模型里就没了，更谈不上再写回 docx/odt。
 *
 * 存的形状跟着 fontSize 那一族走：**带单位的规范化字符串**（`"1.25pt"`），不是数字。
 * 两条写手通道（`markAttr` 与 ODT 的 `markKey`）都只认字符串，数字会在写侧被当成没声明。
 *
 * 0 是真值（Word 用 `w:spacing w:val="0"` 压掉样式层那段间距），所以这里保留 `"0pt"`
 * 而不是把它归 null；但 docx 那一头落不下 0——写手库的门是 `if (options.characterSpacing)`，
 * 数字 0 整枚不写，字符串绕门写出的 `w:val="00"` Word 另存时又整枚丢弃。
 */

/** 只收 pt 与 px 两档：读手发的是 pt，浏览器/px 是 96dpi 那一头，px→pt 乘 0.75 */
export function toLetterSpacingPt(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  const isPx = s.endsWith('px')
  if (!isPx && !s.endsWith('pt')) return null
  // pt 与 px 都是两字符单位，切 1 枚会让 `10pt` 变 `10p` 而整档被下面的判别式拒收
  const body = s.slice(0, s.length - 2)
  // 手写判别式：em / calc / 十六进制 / e 记数 / `12pt 3pt` 简写全部落不进来
  let digits = 0
  let dots = 0
  for (let i = 0; i < body.length; i++) {
    const c = body.charAt(i)
    if (c >= '0' && c <= '9') digits++
    else if (c === '.') dots++
    else if ((c === '-' || c === '+') && i === 0) continue
    else return null
  }
  if (digits === 0 || dots > 1) return null
  const num = Number(body)
  if (!Number.isFinite(num)) return null
  const pt = isPx ? num * 0.75 : num
  return String(Math.round(pt * 1000) / 1000) + 'pt'
}

/** 规范化串 → 缇（docx 的单位）；读不懂算未声明，与 0 区分开 */
export function letterSpacingToTwips(raw: string | null | undefined): number | null {
  const s = toLetterSpacingPt(raw)
  if (!s) return null
  return Math.round(Number(s.slice(0, -2)) * 20)
}

export const CharSpacing = Extension.create({
  name: 'charSpacing',

  addOptions() {
    return { types: ['textStyle'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          letterSpacing: {
            default: null,
            parseHTML: (el) => toLetterSpacingPt(el.style.letterSpacing),
            renderHTML: (attrs) => (attrs.letterSpacing ? { style: 'letter-spacing: ' + attrs.letterSpacing } : {}),
          },
        },
      },
    ]
  },
})
