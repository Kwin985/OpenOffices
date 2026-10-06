import { Extension } from '@tiptap/core'
import type { CommandProps } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

/**
 * 精确列宽的把手：把「这一列要几像素」这一个数摊成整表的一份完整宽度账。
 *
 * 两条实测形状决定了这里的写法（v0.91 前置实测，dev 真机、真按键、真事务）：
 * ① **一次写遍每一格**：只写行 0 的那一列会被抹回去——prosemirror-tables 的 tableEditing
 *    在同一次 dispatch 里按其余各行把行 0 的账覆盖掉（写 [90,null,null] 之后量到 [120,160,240]）。
 *    一次设宽走一枚事务，撤销也才是一步（实测 cells=6 / steps=6 而 undo(1) 回原状）。
 * ② **其余列要跟着重排**：只补平没账的列不够——键入 90 而其余列保持旧账时总和不等于可用宽，
 *    屏上会被浏览器按比例缩走（widths=[90,160,240] 量到 rect=[114.86,204.21,306.33]）；
 *    而 widths=[90,268,268]（和恰为 626 版心）量到 rect=[89.94,267.73,267.74]＝键入值 1:1 上屏。
 *    所以 Σ 必须恰等于可用宽，其余列按各自现有的账等比分享剩下的那一份。
 */

/** 一格的跨度：TipTap 的合并语义是 colspan/rowspan，缺省都按 1 算 */
function spanOf(cell: Node): { cs: number; rs: number } {
  const cs = Math.max(1, Math.round(Number(cell.attrs?.colspan ?? 1)) || 1)
  const rs = Math.max(1, Math.round(Number(cell.attrs?.rowspan ?? 1)) || 1)
  return { cs, rs }
}

/** 一格带着的宽度账 → 按 colspan 摊平成逐网格列；缺账记 null（0 与负数都不算账，与写侧同一档） */
function accountOf(cell: Node, cs: number): (number | null)[] {
  const out: (number | null)[] = new Array(cs).fill(null)
  const raw = cell.attrs?.colwidth
  if (!Array.isArray(raw)) return out
  for (let i = 0; i < cs; i++) {
    const px = Math.round(Number(raw[i]))
    if (px > 0) out[i] = px
  }
  return out
}

export type TableCellPos = { cell: Node; pos: number; row: number; col: number; cs: number; rs: number }

/**
 * 表的网格账：每格算出它**起始**的行列与绝对位置（setNodeMarkup 要用）。
 * 不借 prosemirror-tables 的 TableMap——它不是本项目的声明依赖，而 TipTap 也没把它转出来。
 * 跨列的格按起点记（实测：跨两列那一格里光标认到的是第 0 列，被盖住的后续列没有独立把手）。
 */
export function tableGrid(table: Node, tablePos: number): { cols: number; cells: TableCellPos[] } {
  const rows: Node[] = []
  table.forEach((row) => rows.push(row))
  const covered: (Node | null)[][] = rows.map(() => [])
  const cells: TableCellPos[] = []
  let cols = 0
  let rowPos = tablePos + 1
  rows.forEach((row, r) => {
    let c = 0
    let cellPos = rowPos + 1
    row.forEach((cell) => {
      const { cs, rs } = spanOf(cell)
      while ((covered[r]?.[c] ?? null) !== null) c++
      for (let i = 0; i < rs; i++) {
        if (!covered[r + i]) covered[r + i] = []
        for (let j = 0; j < cs; j++) covered[r + i][c + j] = cell
      }
      cells.push({ cell, pos: cellPos, row: r, col: c, cs, rs })
      c += cs
      cellPos += cell.nodeSize
    })
    if (c > cols) cols = c
    rowPos += row.nodeSize
  })
  return { cols, cells }
}

/** 逐网格列的账：取行 0（与 docx 写侧同一份权威——写侧认的就是行 0 摊平出来的那一排） */
export function gridAccount(g: { cols: number; cells: TableCellPos[] }): (number | null)[] {
  const laid: (number | null)[] = new Array(g.cols).fill(null)
  for (const item of g.cells) {
    if (item.row !== 0) continue
    accountOf(item.cell, item.cs).forEach((px, i) => {
      if (item.col + i < laid.length) laid[item.col + i] = px
    })
  }
  return laid
}

/**
 * 整表的一份齐账换算出来的表宽（px）：行 0 摊平出来的每一枚网格列都带账才返回它们的和，
 * 缺任何一枚（部分账）或压根没账 ⇒ null。
 *
 * 屏上吃这一枚、docx 写侧的 `w:tblW` 也吃这一枚（= 网格和），Word 那头逐格磅同样是这份账，
 * 于是「这一列 90px」键进去之后三头说的是一样的话。超出版心时这里只如实报数、不夹取——
 * Word 16.0 实测对 900px 那份账解出 225 磅 ×3（和 675 磅 > 版心 470.6）也不缩表。
 */
export function accountTotalPx(table: Node): number | null {
  const g = tableGrid(table, 0)
  if (g.cols < 1) return null
  let total = 0
  for (const px of gridAccount(g)) {
    if (px == null || px < 1) return null
    total += px
  }
  return total
}

/**
 * 没带账的列按剩下的可用宽等分——与 docx 写侧的 fill 同一算法，屏上也是这一档
 * （实测 [248,null,null] 渲染成 248/188.7/188.7，而 (626−248)/2 = 189）。
 * 已有账的列合计超出版心时等分退化成 1px 保底，不在这儿替用户作主缩表。
 */
export function baseWidths(current: (number | null)[], targetPx: number): number[] {
  const known = current.filter((x): x is number => x != null)
  const rest = current.length - known.length
  const sum = known.reduce((s, x) => s + x, 0)
  const fill = Math.max(1, rest > 0 ? Math.floor((targetPx - sum) / rest) : 0)
  return current.map((px) => px ?? fill)
}

/**
 * 键入一列之后的整表账：这一列取键入值，其余列按各自现有的账**等比**分享剩下的可用宽，
 * Σ 恰等于 targetPx（键入值 1:1 上屏的条件）。舍入用最大余项法配平，每列至少 1px。
 */
export function redistribute(
  current: (number | null)[],
  typedCol: number,
  typedPx: number,
  targetPx: number,
): number[] | null {
  const cols = current.length
  if (cols === 0) return null
  if (typedCol < 0 || typedCol >= cols) return null
  if (!Number.isFinite(targetPx) || targetPx < cols) return null
  const want = Math.round(typedPx)
  if (!Number.isFinite(want) || want < 1) return null
  // 键入列至少给其余每列留 1px，否则「Σ 恰等于可用宽」这一条落不下去
  const width = Math.min(want, targetPx - (cols - 1))
  if (width < 1) return null
  const base = baseWidths(current, targetPx)
  const out = base.slice()
  out[typedCol] = width
  if (cols === 1) return out
  const rest = targetPx - width
  const idx = base.map((_, i) => i).filter((i) => i !== typedCol)
  const sum = idx.reduce((s, i) => s + base[i], 0)
  const share = idx.map((i) => (base[i] * rest) / sum)
  const given = share.map((v) => Math.max(1, Math.floor(v)))
  let delta = rest - given.reduce((s, v) => s + v, 0)
  const order = share.map((v, k) => ({ k, frac: v - Math.floor(v) }))
  if (delta > 0) {
    order.sort((a, b) => b.frac - a.frac || a.k - b.k)
    for (let n = 0; delta > 0; n = (n + 1) % order.length) {
      given[order[n].k] += 1
      delta -= 1
    }
  } else if (delta < 0) {
    // 先削掉本来就不该进位的那些；targetPx ≥ 列数保证削到 1px 一定配得平
    order.sort((a, b) => a.frac - b.frac || b.k - a.k)
    for (const o of order) {
      while (given[o.k] > 1 && delta < 0) {
        given[o.k] -= 1
        delta += 1
      }
      if (delta === 0) break
    }
  }
  idx.forEach((col, k) => {
    out[col] = given[k]
  })
  return out
}

/** 光标（或框选锚点）落在哪一格；不在表里给 null */
function selectionCell(state: EditorState, g: { cells: TableCellPos[] }): TableCellPos | null {
  const $from = state.selection.$from
  for (let d = $from.depth; d >= 1; d--) {
    const n: Node = $from.node(d)
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
      return g.cells.find((x) => x.cell === n) ?? null
    }
  }
  return null
}

/** 光标所在那枚表的节点与它的绝对起点 */
function tableAt(state: EditorState): { node: Node; pos: number } | null {
  const $from = state.selection.$from
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'table') return { node: $from.node(d), pos: $from.before(d) }
  }
  return null
}

/**
 * 这张表实际能用的宽度（px）：版心再让出表级缩进——marginLeft 在屏上写的是
 * `width: calc(100% - Npx)`，不扣它的话键入值会被浏览器缩走（与 docx 那头的 w:tblInd 同一条账）。
 */
export function tableTargetPx(state: EditorState, contentPx: number): number | null {
  const t = tableAt(state)
  if (!t) return null
  const ml = Math.max(0, Math.round(Number(t.node.attrs?.marginLeft) || 0))
  return Math.max(1, contentPx - ml)
}

/** 界面用：光标所在那一列的格子数与当前显示值（没带账的列显示等分那一份，与屏上一致） */
export function caretColumn(
  state: EditorState,
  targetPx: number,
): { col: number; cols: number; px: number } | null {
  const t = tableAt(state)
  if (!t) return null
  const g = tableGrid(t.node, t.pos)
  const cell = selectionCell(state, g)
  if (!cell || g.cols < 1) return null
  const px = baseWidths(gridAccount(g), targetPx)[cell.col]
  return { col: cell.col, cols: g.cols, px: px ?? 1 }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableWidth: {
      /**
       * 把光标所在那一列设成 px 像素，其余列按现有账等比重排到剩下的 targetPx
       * （targetPx 由调用方从页面设置算出来：contentPxOf(resolvePage(meta.page)) 扣表级缩进）。
       * 账已经就是这一份时不推事务——重打同一个数字不该多一枚撤销步。
       */
      setGridColumnWidth: (px: number, targetPx: number) => ReturnType
    }
  }
}

export const TableWidth = Extension.create({
  name: 'tableWidth',

  addCommands() {
    return {
      setGridColumnWidth:
        (px: number, targetPx: number) =>
        ({ state, tr, dispatch }: CommandProps): boolean => {
          const t = tableAt(state)
          if (!t) return false
          const g = tableGrid(t.node, t.pos)
          const cell = selectionCell(state, g)
          if (!cell) return false
          const widths = redistribute(gridAccount(g), cell.col, px, targetPx)
          if (!widths) return false
          // 一格一片，先验齐再落：数组长度必须等于该格的 colspan（写侧认账的第一道门），
          // 对不上就整表拒绝，不写半份账进去
          const patches = g.cells.map((item) => {
            const colwidth = widths.slice(item.col, item.col + item.cs)
            return colwidth.length === item.cs ? { item, colwidth } : null
          })
          if (patches.some((p) => p === null)) return false
          let steps = 0
          for (const p of patches) {
            if (!p) continue
            const raw = p.item.cell.attrs?.colwidth
            // 账本来就是这一份的格子跳过：PM 的 setNodeMarkup 即便属性相同也推进一步，
            // 于是「重打同一个数字」会凭空多一枚撤销步
            const same =
              Array.isArray(raw) &&
              raw.length === p.colwidth.length &&
              raw.every((v: unknown, i: number) => Math.round(Number(v)) === p.colwidth[i])
            if (same) continue
            tr.setNodeMarkup(p.item.pos, undefined, { ...p.item.cell.attrs, colwidth: p.colwidth })
            steps++
          }
          if (steps === 0) return false
          if (!dispatch) return true
          dispatch(tr)
          return true
        },
    }
  },
})
