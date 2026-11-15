// 多夹具对照里的「已知口径假红」名单。
//
// 账本按「元素|属性名」逐对比对，换一种等价写法就会记成 lost，但语义并没丢。
// v0.199 诊断（见 docs/docx-fidelity-audit.md 的 v0.199 节）确认下面四枚是
// w:tblLook 位掩码的同义表示：w:val 是 ST_TblLook 的十六进制位掩码
// (0x0020 firstRow / 0x0040 lastRow / 0x0080 firstColumn / 0x0100 lastColumn)，
// 与六枚显式 ST_OnOff 属性是同一组开关的两种写法。读手 / 写手自 v0.147 起
// 刻意只保真 val/noHBand/noVBand；写出包只发 w:val 时，这四枚在两份合成件里
// 会稳定判成 lost，但不是真丢，更不该为了凑数字去补写（会写坏件）。
//
// 这里只放「已逐对诊断过、有明确依据」的项；不把 trHeight|val 之类的
// 「源件本就没有值」问题塞进来——那要逐份看源值，不能按名字一刀切。
// 名单只用于报告分档，不改变账本的任何数字。

const ENTRIES = new Map([
  [
    'tblLook|firstRow',
    'w:val 位掩码同义（0x0020）；写出包只发 w:val，语义未丢',
  ],
  [
    'tblLook|lastRow',
    'w:val 位掩码同义（0x0040）；写出包只发 w:val，语义未丢',
  ],
  [
    'tblLook|firstColumn',
    'w:val 位掩码同义（0x0080）；写出包只发 w:val，语义未丢',
  ],
  [
    'tblLook|lastColumn',
    'w:val 位掩码同义（0x0100）；写出包只发 w:val，语义未丢',
  ],
])

/** 命中已诊断的口径假红时返回说明文字，否则空串。 */
export function aliasNote(key) {
  return ENTRIES.get(key) ?? ''
}

export function isKnownAlias(key) {
  return ENTRIES.has(key)
}

export const aliasKeys = () => [...ENTRIES.keys()]
