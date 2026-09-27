/** 页面设置面板用的纯函数：把界面上的输入换成载荷，把载荷换成界面能显示的东西。
 *  「哪一条在我们导出的 PDF 上真的说话、哪一条只是写给别人的」也在这里说清，UI 只负责摆出来。
 *  零 DOM、Node 里直测——面板本身要真机才测得动，但换算与判定不能只有真机一条腿。 */
import type { RangeRect, SheetPrintPayload } from './fs'
import { PAPER_INCHES, columnLetter } from './sheet-print-setup'

/** 界面上用毫米（中文用户熟这个），文件里是英寸——两头各说各的，换算只走这两枚函数 */
export const MM_PER_INCH = 25.4

export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH
}

/** 显示到 0.1mm 就够（Excel 自己的边距框也是这个精度） */
export function inchToMm(inch: number): number {
  return Math.round(inch * MM_PER_INCH * 10) / 10
}

/** 纸张下拉：只列真用得上的档（code 是 OOXML paperSize，名字与 Excel 的纸张框同向） */
export const PAPER_OPTIONS: Array<{ code: number; label: string }> = [
  { code: 9, label: 'A4' },
  { code: 8, label: 'A3' },
  { code: 11, label: 'A5' },
  { code: 12, label: 'B4 (ISO)' },
  { code: 13, label: 'B5 (ISO)' },
  { code: 1, label: 'Letter' },
  { code: 5, label: 'Legal' },
  { code: 3, label: 'Tabloid' },
]

/** 公制那几档纸以毫米命名：面板上要说用户熟的那个名——A4 就是 210×297，不是 210.1×296.9。
 *  PAPER_INCHES 是导出用的几何（英寸，8.27 那类是这张表历史上的近似值），两边相差不到 0.1mm，
 *  结构测试按这个容差把它们对在一起，谁被改错都会报出来。 */
const PAPER_MM: Record<number, [number, number]> = {
  8: [297, 420], // A3
  9: [210, 297], // A4
  10: [210, 297], // A4 Small
  24: [210, 297], // A4（rotated）
  25: [210, 297], // A4 Small（rotated）
  11: [148, 210], // A5
  26: [148, 210],
  12: [250, 353], // B4 (ISO)
  27: [250, 353],
  13: [176, 250], // B5 (ISO)
  28: [176, 250],
}

/** 纸的毫米尺寸（纵版），认不出就 null——面板据此说「这档纸张我们量不出尺寸」而不是猜一个 */
export function paperMm(code: number | null | undefined): [number, number] | null {
  if (code == null) return null
  const named = PAPER_MM[code]
  if (named) return named
  const inch = PAPER_INCHES[code]
  if (!inch) return null
  // 英制那几档没有"毫米名"，照实换算（Letter 就是 215.9×279.4mm）
  return [inchToMm(inch[0]), inchToMm(inch[1])]
}

// —— 页眉页脚：三槽 <-> OOXML 的那一条串 ——

export interface HfSlots {
  left: string
  center: string
  right: string
}

export const EMPTY_HF: HfSlots = { left: '', center: '', right: '' }

/** 面板上的格式码按钮：插入的是 OOXML 字面，与 Excel 的页眉页脚对话框同一种写法 */
export const HF_CODES: Array<{ code: string; label: string }> = [
  { code: '&P', label: '页码' },
  { code: '&N', label: '总页数' },
  { code: '&A', label: '表名' },
  { code: '&D', label: '日期' },
  { code: '&F', label: '文件名' },
  { code: '&&', label: '字面 &' },
]

type SlotKey = keyof HfSlots

const SLOT_MARKS: Array<[string, SlotKey]> = [
  ['&L', 'left'],
  ['&C', 'center'],
  ['&R', 'right'],
]

function hasSlotText(s: HfSlots): boolean {
  return !!(s.left || s.center || s.right)
}

/** 找出真正的分段标记位置：一路走到底按 `&&` 跳过转义，否则「A&&Link」里的第二个 & 会被当成 &L 把串拆错 */
function slotMarks(text: string): Array<{ i: number; key: SlotKey }> {
  const found: Array<{ i: number; key: SlotKey }> = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '&') continue
    if (text[i + 1] === '&') {
      i++
      continue
    }
    const hit = SLOT_MARKS.find(([mark]) => text.startsWith(mark, i))
    if (hit) {
      found.push({ i, key: hit[1] })
      i += 1
    }
  }
  return found
}

/** 三槽合成 OOXML 串。只填中档时**不带**分段标记——Excel 就是这么写的（读侧那条"整串落在
 *  CenterHeader"的实测正是这里写出去的形状）；一旦有左或右，就按段说话。 */
export function hfSlotsToText(s: HfSlots): string {
  if (!hasSlotText(s)) return ''
  if (!s.left && !s.right) return s.center
  let out = ''
  if (s.left) out += `&L${s.left}`
  if (s.center) out += `&C${s.center}`
  if (s.right) out += `&R${s.right}`
  return out
}

/** 串拆回三槽。没有分段标记的整串算中档（与 Excel 的读法一致）。 */
export function hfTextToSlots(text: string | null | undefined): HfSlots {
  const t = text ?? ''
  const slots: HfSlots = { ...EMPTY_HF }
  if (!t) return slots
  const marks = slotMarks(t)
  if (!marks.length) return { ...slots, center: t }
  marks.forEach((m, k) => {
    const to = k + 1 < marks.length ? marks[k + 1].i : t.length
    slots[m.key] = t.slice(m.i + 2, to)
  })
  return slots
}

/** 数「不像格式码的 &」：& 后面不是已知标记时 Excel 会自己吞掉一个字符，界面必须先说出口 */
export function hfStrayAmpersands(text: string | null | undefined): number {
  const t = text ?? ''
  const known = new Set([...SLOT_MARKS.map(([m]) => m), ...HF_CODES.map((c) => c.code), '&D', '&F', '&P', '&N', '&A', '&Z', '&T', '&Y', '&X', '&G', '&E', '&S', '&B', '&I', '&U'])
  let bad = 0
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '&') continue
    const two = t.slice(i, i + 2)
    if (known.has(two)) {
      i++
      continue
    }
    bad++
  }
  return bad
}

// —— 区域 <-> sqref（打印区域与重复标题行列共用一套读法） ——

const CELL_RE = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/

function colFromLetters(letters: string): number | null {
  let n = 0
  for (const ch of letters.toUpperCase()) {
    const d = ch.charCodeAt(0) - 64
    if (d < 1 || d > 26) return null
    n = n * 26 + d
  }
  return n - 1
}

/** `A1:E18` / `$A$1:$E$18` → 0 基含端点；认不出给 null（面板据此报错而不是硬凑一个区域） */
export function sqrefToRect(s: string | null | undefined): RangeRect | null {
  const parts = (s ?? '').trim().replace(/^'/, '').split(':')
  if (parts.length !== 2) return null
  const a = CELL_RE.exec(parts[0].trim())
  const b = CELL_RE.exec(parts[1].trim())
  if (!a || !b) return null
  const c1 = colFromLetters(a[1])
  const c2 = colFromLetters(b[1])
  if (c1 == null || c2 == null) return null
  const r1 = Number(a[2]) - 1
  const r2 = Number(b[2]) - 1
  if (r1 < 0 || r2 < r1 || c2 < c1) return null
  return { startRow: r1, startColumn: c1, endRow: r2, endColumn: c2 }
}

export function rectToSqref(r: RangeRect | null | undefined): string {
  if (!r) return ''
  return `$${columnLetter(r.startColumn)}$${r.startRow + 1}:$${columnLetter(r.endColumn)}$${r.endRow + 1}`
}

/** 整行区域 `$1:$2` <-> [起, 止]（0 基含端点） */
export function spanToSqref(kind: 'rows' | 'cols', span: [number, number] | null | undefined): string {
  if (!span) return ''
  const one = (i: number) => (kind === 'rows' ? `$${i + 1}` : `$${columnLetter(i)}`)
  return `${one(span[0])}:${one(span[1])}`
}

/** `$1:$2` / `1:2` / `$A:$B` / `A:B` 都认；带格子的写法（`$A$1:$A$2`）不认——那是区域不是整行/整列 */
export function sqrefToSpan(s: string | null | undefined, kind: 'rows' | 'cols'): [number, number] | null {
  const parts = (s ?? '').trim().split(':')
  if (parts.length !== 2) return null
  const one = (raw: string): number | null => {
    const t = raw.trim()
    if (kind === 'rows') {
      if (!/^\$?\d{1,7}$/.test(t)) return null
      return Number(t.replace(/\$/g, '')) - 1
    }
    if (!/^\$?[A-Za-z]{1,3}$/.test(t)) return null
    return colFromLetters(t.replace(/\$/g, ''))
  }
  const a = one(parts[0])
  const b = one(parts[1])
  if (a == null || b == null || b < a || a < 0) return null
  return [a, b]
}

// —— 手动分页符：面板上的增删 ——

/** `at` 是「自己开始新的一页」那一行/列的下标（0 基，实测语义）；第 0 行/列自己不可能是第二页的开头 */
export function addBreak(
  list: number[] | undefined,
  at: number,
  max: number,
): { list: number[]; note?: string } {
  const cur = [...(list ?? [])]
  if (at < 1) return { list: cur, note: '第一行/列就是首页的开头，这里插断点没有意义' }
  if (at >= max) return { list: cur, note: `位置超出这张表的范围（只有 ${max} 行/列）` }
  if (cur.includes(at)) return { list: cur, note: '这一行/列已经是断点了' }
  cur.push(at)
  cur.sort((x, y) => x - y)
  return { list: cur }
}

export function removeBreak(list: number[] | undefined, at: number): number[] {
  return (list ?? []).filter((x) => x !== at)
}

// —— 草稿：载荷 <-> 面板态，以及「这样填我们兑现不了」的判定 ——

/** 把载荷铺成面板能显示的草稿：文件里没写的字段落到我们打印链路实际使用的那档默认值上
 *  （见 sheet-print-setup 的 SHEET_DEFAULT_PAGE 与 planSheetPrint）。
 *  「这张表到底有没有页面设置」不由这里说，由调用方看侧通道里有没有这一项。 */
export function draftOf(p: SheetPrintPayload | null | undefined): SheetPrintPayload {
  return {
    orientation: p?.orientation ?? 'portrait',
    paperSize: p?.paperSize ?? 9,
    scale: p?.scale ?? 100,
    fitToPage: p?.fitToPage ?? false,
    fitToWidth: p?.fitToWidth ?? 1,
    fitToHeight: p?.fitToHeight ?? 1,
    pageOrder: p?.pageOrder ?? 'downThenOver',
    margins: {
      top: p?.margins?.top ?? 0.4,
      right: p?.margins?.right ?? 0.6,
      bottom: p?.margins?.bottom ?? 0.6,
      left: p?.margins?.left ?? 0.5,
      header: p?.margins?.header ?? 0.2,
      footer: p?.margins?.footer ?? 0.25,
    },
    hCentered: p?.hCentered ?? false,
    vCentered: p?.vCentered ?? false,
    gridLines: p?.gridLines ?? true,
    headings: p?.headings ?? false,
    firstPageNumber: p?.firstPageNumber ?? null,
    oddEven: p?.oddEven ?? false,
    firstDiffers: p?.firstDiffers ?? false,
    header: p?.header ?? null,
    footer: p?.footer ?? null,
    printArea: p?.printArea ?? null,
    titleRows: p?.titleRows ?? null,
    titleCols: p?.titleCols ?? null,
    rowBreaks: p?.rowBreaks ?? [],
    colBreaks: p?.colBreaks ?? [],
  }
}

/** 面板确定前必须过的账：这些值兑现不了就是**拦住并说清**，而不是写进去赌别人怎么看 */
export function validateDraft(d: SheetPrintPayload, ctx: { maxRows: number; maxCols: number }): string[] {
  const errs: string[] = []
  const scale = d.scale
  if (scale != null && d.fitToPage !== true) {
    if (!Number.isFinite(scale) || scale < 10 || scale > 400) errs.push('缩放只能是 10%~400% 之间的整数')
  }
  if (d.fitToPage === true) {
    const w = d.fitToWidth
    // 0 在 OOXML 里是「不限」，原样收；越界才是填错了
    if (w != null && (!Number.isInteger(w) || w < 0 || w > 99)) errs.push('「缩放到 N 页宽」的 N 只能是 0（不限）到 99 之间的整数')
  }
  const m = d.margins ?? {}
  for (const [key, label] of [
    ['top', '上'],
    ['bottom', '下'],
    ['left', '左'],
    ['right', '右'],
    ['header', '页眉区'],
    ['footer', '页脚区'],
  ] as const) {
    const v = m[key]
    if (v == null) continue
    if (!Number.isFinite(v)) errs.push(`${label}边距要么填数字、要么留空（留空＝这一条不写进文件）`)
    else if (v < 0) errs.push(`${label}边距不能是负数`)
  }
  const paper = paperMm(d.paperSize)
  if (paper) {
    const across = ((m.left ?? 0) + (m.right ?? 0)) * MM_PER_INCH
    if (across >= paper[0]) errs.push(`左右边距加起来（${Math.round(across)}mm）比纸宽（${paper[0]}mm）还大，纸上一列都放不下`)
  } else if (d.paperSize != null && !PAPER_INCHES[d.paperSize]) {
    errs.push(`纸张代码 ${d.paperSize} 我们量不出尺寸，请选一档列出来的纸`)
  }
  if (d.printArea) {
    const a = d.printArea
    if (a.endRow >= ctx.maxRows || a.endColumn >= ctx.maxCols) errs.push('打印区域超出这张表的范围')
    if (a.endRow < a.startRow || a.endColumn < a.startColumn) errs.push('打印区域的右下角必须在左上角之后')
  }
  for (const [span, label, max] of [
    [d.titleRows, '重复标题行', ctx.maxRows],
    [d.titleCols, '重复标题列', ctx.maxCols],
  ] as const) {
    if (span && span[1] >= max) errs.push(`${label}超出这张表的范围（只有 ${max} ${label.includes('行') ? '行' : '列'}）`)
  }
  for (const [slot, label] of [
    [d.header, '页眉'],
    [d.footer, '页脚'],
  ] as const) {
    for (const text of [slot?.odd, slot?.even, slot?.first]) {
      const bad = hfStrayAmpersands(text)
      if (bad) errs.push(`${label}里有 ${bad} 枚「&」后面不接格式码——Excel 会吃掉紧随的那个字符，字面的 & 请打 &&`)
    }
  }
  if (d.firstPageNumber != null && (!Number.isInteger(d.firstPageNumber) || d.firstPageNumber < 1)) {
    errs.push('起始页码必须是 1 或更大的整数')
  }
  return errs
}

/** 这几条我们会老老实实写进文件（别人在 Excel 里打印时生效），但我们自己导出的 PDF 兑现不了：
 *  面板把它们单独列出来，而不是让用户以为勾上就印得出。
 *  文案与 sheet-print-setup 的 planSheetPrint 逐字对齐——同一笔账在面板上与在导出时说的是同一句话 */
export function draftPaperNotes(d: SheetPrintPayload): string[] {
  const notes: string[] = []
  if (d.firstPageNumber != null && d.firstPageNumber !== 1)
    notes.push(`起始页码设的是 ${d.firstPageNumber}，纸上的页码从 1 开始数`)
  if (d.oddEven && (d.header?.even || d.footer?.even))
    notes.push('页眉页脚分了奇偶两版，纸上没有按奇偶换内容的通道，偶数页印的是奇数那一版')
  const h = d.fitToHeight ?? 0
  if (d.fitToPage && h > 0) notes.push(`「缩放到 ${h} 页高」要预先行高总量，纸上的行数由分页自己定，这条没落`)
  if (d.pageOrder === 'overThenDown')
    notes.push('页面顺序是「先横后竖」，但行带落在哪一页由分页决定，纸上按「先竖后横」排')
  if (d.vCentered) notes.push('「上下居中打印」没有对应通道，纸上按顶端排')
  return notes
}
