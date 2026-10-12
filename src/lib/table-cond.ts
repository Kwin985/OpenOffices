// 表样式条件层的「位置 → 型别梯子」：纯函数、不碰 XML，供三条出口共用同一套算法。
//
// 为什么单独立一枚文件：条件层的尊卑是 Word 16.0 逐族实测出来的（外观族角压一切、边距族行>角>列），
// 不是一条通用梯子。docx 渲染（docx-fidelity）、CSS 层（doc-style-css）、ODT 出口（odt）都要按位置
// 裁决「这一格吃哪一型」，若三处各写一份，早晚跑偏——所以梯子只在这里定义一次。
//
// 统一约定：**所有梯子都从高到低排，取法是「先说话的赢」**（逐边先到先得、底纹取第一枚）。
// 边距族原先在 docx-fidelity 里是「从低到高、后赋值覆盖」，与这里的序恰好互为逆序，
// 两种写法对逐边合并等价（见 condLadderMargin 的注释推导），统一后只留一种。

import type { TableCondType, TableCond, DocxStyleInfo } from './docx'
import type { CellEdge } from './cell-style'

/** `w:tblLook` 上那四位闸门；条件层的落点全从这几位取闸（`w:val` 那位十六进制从不被 consult） */
export const LOOK_BITS = ['firstRow', 'lastRow', 'firstColumn', 'lastColumn'] as const
export type LookBits = Record<string, boolean>

/**
 * 由样式自己开了哪几型条件，反推那四位闸门（与 docx 出口 `tblLookOf` 同一条规则：
 * 凡是用到的部位显式开、没用到的显式关）。于是 odt 出口与 docx 出口对同一份样式读出的闸门一致——
 * 闸门不在模型里，只能这样两头各推一次，两边共用这一枚函数才不会推出两个结果。
 */
export function condLookBits(cond: Partial<Record<TableCondType, TableCond>> | undefined): LookBits {
  const has = (...ts: TableCondType[]) => ts.some((t) => cond?.[t])
  return {
    firstRow: has('firstRow', 'nwCell', 'neCell'),
    lastRow: has('lastRow', 'swCell', 'seCell'),
    firstColumn: has('firstColumn', 'nwCell', 'swCell'),
    lastColumn: has('lastColumn', 'neCell', 'seCell'),
  }
}

/**
 * 外观族梯子（底纹 `w:shd` / 条件边框 `w:tcBorders` / 粗体 `w:rPr`）：**角型压一切**。
 * Word 16.0 实测：四角是「一等型别」，落点就是那一角那一格，且它压得住行型与列型
 * （u2 把 nwCell 写在 lastRow/lastCol 之后，Word 仍在第 0 格落 nw 而把 firstRow 让到 #1/#2）。
 * 闸门要那一角的两枚位都开（u3 里只有 seCell 的末行+末列都开着，于是只有它落）。
 */
export function condLadderAppearance(
  look: LookBits,
  ri: number,
  isLastRow: boolean,
  gc: number,
  colspan: number,
  cols: number,
): TableCondType[] {
  const first = ri === 0
  const at0 = gc === 0
  const atEnd = gc + colspan >= cols
  const ladder: TableCondType[] = []
  if (first && at0 && look.firstRow && look.firstColumn) ladder.push('nwCell')
  if (first && atEnd && look.firstRow && look.lastColumn) ladder.push('neCell')
  if (isLastRow && at0 && look.lastRow && look.firstColumn) ladder.push('swCell')
  if (isLastRow && atEnd && look.lastRow && look.lastColumn) ladder.push('seCell')
  if (first && look.firstRow) ladder.push('firstRow')
  if (isLastRow && look.lastRow) ladder.push('lastRow')
  if (at0 && look.firstColumn) ladder.push('firstColumn')
  if (atEnd && look.lastColumn) ladder.push('lastColumn')
  return ladder
}

/**
 * 边距族梯子（格边距 `w:tcMar`）：**行型 > 角型 > 列型**，与外观族反着来。
 *
 * 这一族在 Word 里的形状本就不同：列型的 tcMar 落到**全表每一格**（g_firstCol 的 22px 九枚格分毫不差），
 * 角型也不按那一角落而按它所在那一整行落（sb_nw_all_on 的 left 落在第 0 行三枚格）。
 * 这里把原先「从低到高、后赋值覆盖」的写法倒过来成「从高到低、先到先得」：
 * 原序 [firstColumn, lastColumn, nw, ne, sw, se, lastRow, firstRow] 逆序后
 * 行型到最前（压角）、角在列前（压列），逐边先到先得与原来的后写覆盖逐边等价。
 */
export function condLadderMargin(look: LookBits, ri: number, isLastRow: boolean): TableCondType[] {
  const ladder: TableCondType[] = []
  if (ri === 0 && look.firstRow) ladder.push('firstRow')
  if (isLastRow && look.lastRow) ladder.push('lastRow')
  if (isLastRow && look.lastRow && look.lastColumn) ladder.push('seCell')
  if (isLastRow && look.lastRow && look.firstColumn) ladder.push('swCell')
  if (ri === 0 && look.firstRow && look.lastColumn) ladder.push('neCell')
  if (ri === 0 && look.firstRow && look.firstColumn) ladder.push('nwCell')
  if (look.lastColumn) ladder.push('lastColumn')
  if (look.firstColumn) ladder.push('firstColumn')
  return ladder
}

/**
 * 条件行高的梯子：**照搬 docx-fidelity 的现有实现**，序是「band > 末行 > 首行」。
 *
 * ⚠ 注意它与 docx-fidelity 里那条注释（"firstRow > lastRow > band"）**是相反的**：
 * 代码按 ladder 从头取第一枚有值的，而 ladder 把 band 排在最前，于是实际是 band 赢。
 * 本轮不做实测、不擅自翻序（改了就是改 docx 渲染行为），只把现状照搬过来并在此记账——
 * 两处共用同一枚函数后，将来哪天实测出结论，只改这里一处即可。
 */
export function condLadderRowHeight(look: LookBits, ri: number, isLastRow: boolean): TableCondType[] {
  const ladder: TableCondType[] = []
  if (ri % 2 === 0) ladder.push('band1Horz')
  else ladder.push('band2Horz')
  if (isLastRow && look.lastRow) ladder.push('lastRow')
  if (ri === 0 && look.firstRow) ladder.push('firstRow')
  return ladder
}

/**
 * 表级那六条边（`w:tblBorders`）→ 这一格的四条边。
 *
 * Word 的六槽里外框四边只画外圈、insideH/insideV 只画内部：首行吃 bdTop、其余行吃 bdInsideH，
 * 末行吃 bdBottom、非末行吃 bdInsideH（竖线同理）。逐格展开后每格只写自己那四条边，
 * 相邻格共享的那条边各写各的、值同源，所以拼起来就是 Word 那张网格。
 * gc+colspan>=cols 判末列而不是 gc===cols-1：跨列的格只要右缘抵到右边界就吃 bdRight（q16 同款判据）。
 */
export function tableEdgeFor(
  t: NonNullable<DocxStyleInfo['table']>,
  ri: number,
  isLastRow: boolean,
  gc: number,
  colspan: number,
  cols: number,
): Partial<Record<CellEdge, string>> {
  const out: Partial<Record<CellEdge, string>> = {}
  if (ri === 0) {
    if (t.bdTop) out.top = t.bdTop
  } else if (t.bdInsideH) out.top = t.bdInsideH
  if (isLastRow) {
    if (t.bdBottom) out.bottom = t.bdBottom
  } else if (t.bdInsideH) out.bottom = t.bdInsideH
  if (gc === 0) {
    if (t.bdLeft) out.left = t.bdLeft
  } else if (t.bdInsideV) out.left = t.bdInsideV
  if (gc + colspan >= cols) {
    if (t.bdRight) out.right = t.bdRight
  } else if (t.bdInsideV) out.right = t.bdInsideV
  return out
}

/**
 * 沿 `basedOn` 上溯取样式链：从最远的祖先排到自身（后者覆盖前者）。
 * 回环（A basedOn B、B basedOn A）按见过的 id 断掉，不让它把这一趟拖死。
 */
export function tableStyleChain(styles: DocxStyleInfo[] | undefined, id: string | undefined): DocxStyleInfo[] {
  if (!styles?.length || !id) return []
  const byId = new Map(styles.map((s) => [s.id, s]))
  const out: DocxStyleInfo[] = []
  const seen = new Set<string>()
  let cur = byId.get(id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.push(cur)
    cur = cur.basedOn ? byId.get(cur.basedOn) : undefined
  }
  return out.reverse()
}

/**
 * 样式链上所有表属性合并成一枚（祖先 → 自身，后者胜）。
 * `cond` 按**型别整块替换**：同一型别被后代重写时整块换掉，不是逐键并——
 * 与 OOXML 里一个 `w:type` 只出现一块（后出现的整块覆盖先出现的）是同一条账。
 */
export function mergedTableOf(
  styles: DocxStyleInfo[] | undefined,
  id: string | undefined,
): NonNullable<DocxStyleInfo['table']> {
  const out: NonNullable<DocxStyleInfo['table']> = {}
  let cond: Partial<Record<TableCondType, TableCond>> = {}
  for (const s of tableStyleChain(styles, id)) {
    const t = s.table
    if (!t) continue
    if (t.bdTop !== undefined) out.bdTop = t.bdTop
    if (t.bdRight !== undefined) out.bdRight = t.bdRight
    if (t.bdBottom !== undefined) out.bdBottom = t.bdBottom
    if (t.bdLeft !== undefined) out.bdLeft = t.bdLeft
    if (t.bdInsideH !== undefined) out.bdInsideH = t.bdInsideH
    if (t.bdInsideV !== undefined) out.bdInsideV = t.bdInsideV
    if (t.padTopPx !== undefined) out.padTopPx = t.padTopPx
    if (t.padRightPx !== undefined) out.padRightPx = t.padRightPx
    if (t.padBottomPx !== undefined) out.padBottomPx = t.padBottomPx
    if (t.padLeftPx !== undefined) out.padLeftPx = t.padLeftPx
    if (t.align !== undefined) out.align = t.align
    if (t.background !== undefined) out.background = t.background
    if (t.cond) cond = { ...cond, ...t.cond }
  }
  if (Object.keys(cond).length) out.cond = cond
  return out
}
