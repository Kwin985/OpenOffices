// 表格宏 API（v0.134）
//
// VBA 子集的工作簿侧（v0.131 只做了 Word 那一侧的对象模型）要踩的"这一本簿子"。
// 分两层，两层之间只隔一个接口：
//
//   1. **SheetMacroApi**（本文件）：一份**与 Univer 无关**的小接口——表名、当前表、
//      读格、写片、已用区域、选区、背景色。刻意不给公式求值、不给样式细节：
//      给得越宽，宏越容易写出让文件少东西的操作。
//   2. **sheetApiOf(univer)**：把上面的接口接到 Univer 的门面（FUniver/FWorksheet/
//      FRange）上。这是唯一知道 Univer 的一块，也是唯一需要真机才测得动的一块。
//
// 为什么要这个接口而不是让 VBA 运行时直接摸 Univer：vba-rt.ts 要在
// `vite-node scripts/test-vba-book.mjs` 里跑，那儿没有浏览器也没有 Univer。
// 接口一隔，假簿子（FakeBook）就能把对象模型整层测穿——与文档侧
// FakeDoc 测 vba-rt.ts 是同一套办法。
//
// 坐标一律 **0 基、闭区间**（`SheetRect` 的 r1/c1/r2/c2）。Univer 的门面本来就
// 是 0 基（`getRow()` 对 A1 返回 0，`getRange(row, column, …)` 收的是"起始行列号"），
// 所以这一层不做基制换算；VBA 那一侧（1 基）的换算在 vba-rt.ts 里做，只此一家。

import type { FUniver } from '@univerjs/presets'

export type CellValue = string | number | boolean | null

/** 0 基、闭区间的一片格子 */
export interface SheetRect {
  r1: number
  c1: number
  r2: number
  c2: number
}

/** 写进一格的东西：值、公式（`{ f: '=SUM(A1:A2)' }`）或 null（清空） */
export type CellWrite = CellValue | { f: string } | null

/** 一格读出来的东西：值 + 公式（没有公式是空串） */
export interface CellRead {
  v: CellValue
  f: string
}

export interface SheetMacroApi {
  /** 文件路径（ThisWorkbook.Name / FullName 用） */
  readonly path: string
  /** 簿内表名清单，按标签页顺序 */
  sheetNames(): string[]
  /** 当前表名（没有打开的工作簿时是空串） */
  activeSheet(): string
  /** 切到某张表；表不存在返回 false */
  setActiveSheet(name: string): boolean
  /** 读一格。行/列越界时返回空格子（VBA 里读空白格就是 Empty） */
  readCell(sheet: string, r: number, c: number): CellRead
  /** 读一片，返回值/公式的二维网格（与 rect 同形） */
  readRange(sheet: string, rect: SheetRect): CellRead[][]
  /** 写一片：grid 与 rect 同形，null 表示清空。返回写进的格数 */
  writeRange(sheet: string, r1: number, c1: number, grid: CellWrite[][]): number
  /** 已用区域的边界（有内容的格子围出来的最小矩形）；空表返回 null */
  usedRange(sheet: string): SheetRect | null
  /** 这一版开辟出来的行列数。**不是** Excel 的 1048576×16384——是这份簿子实际的容量 */
  sheetSize(sheet: string): { rows: number; cols: number }
  /** 当前选区（没有选区时 null） */
  selection(): (SheetRect & { sheet: string }) | null
  /** 把选区挪到某片并激活（VBA 的 Select/Activate） */
  selectRange(sheet: string, rect: SheetRect): void
  /** 撤一步/重做一步（VBA 的 Application.Undo）。没有可撤的返回 false */
  undo(): boolean
  redo(): boolean
  /** 一片格子首格的背景色（`#rrggbb`；没设是 null） */
  backgroundColor(sheet: string, rect: SheetRect): string | null
  /** 设一片格子的背景色（`#rrggbb`）。传 null 会报错——清除底色没实现（见适配层里的说明） */
  setBackgroundColor(sheet: string, rect: SheetRect, color: string | null): void
}

/** A1 记法 → 0 基矩形。认 `A1`、`B2:D4`、`$A$1`、整列 `B:D`、整行 `2:5`；
 *  整列/整行要靠 sheetSize 补边界，所以这里返回"待补"的形式 */
export interface A1Ref {
  r1: number | null
  c1: number | null
  r2: number | null
  c2: number | null
}

const A1_RE = /^\$?([A-Za-z]+)?\$?(\d+)?(?::\$?([A-Za-z]+)?\$?(\d+)?)?$/

/** 列字母 → 0 基列号（A→0、Z→25、AA→26）。超 16384 列（Excel 上限）返回 null */
export function colIndexOf(letters: string): number | null {
  let n = 0
  for (const ch of letters.toUpperCase()) {
    const d = ch.charCodeAt(0) - 64
    if (d < 1 || d > 26) return null
    n = n * 26 + d
    if (n > 16383) return null
  }
  return n - 1
}

/** 0 基列号 → 列字母（0→A）。VBA 的 Address 与 Range("A1") 都要用 */
export function colLetter(c: number): string {
  let n = c + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 0 基矩形 → A1 记法。`abs` 为真时带 `$`（VBA 的 Address 默认是 `$A$1` 那种） */
export function rectToA1(rect: SheetRect, abs = false): string {
  const one = (r: number, c: number) =>
    `${abs ? '$' : ''}${colLetter(c)}${abs ? '$' : ''}${r + 1}`
  if (rect.r1 === rect.r2 && rect.c1 === rect.c2) return one(rect.r1, rect.c1)
  return `${one(rect.r1, rect.c1)}:${one(rect.r2, rect.c2)}`
}

/** 解析 A1 记法。认不出返回 null（调用方该报带原文的错，不猜） */
export function parseA1(s: string): A1Ref | null {
  const t = s.trim()
  if (!t) return null
  const m = A1_RE.exec(t)
  if (!m) return null
  const [, c1s, r1s, c2s, r2s] = m
  // 两边都空（比如只给了冒号）不算
  if (!c1s && !r1s && !c2s && !r2s) return null
  // 只有冒号一侧有内容时，Excel 的意思是"从有内容的那格到边界"：
  // `A:A` 两侧都是列、`2:2` 两侧都是行，其余按"起点:终点"读
  if (!c1s && !c2s && r1s && r2s) {
    // 整行：2:5
    return { r1: Number(r1s) - 1, c1: null, r2: Number(r2s) - 1, c2: null }
  }
  if (c1s && c2s && !r1s && !r2s) {
    // 整列：B:D
    return { r1: null, c1: colIndexOf(c1s), r2: null, c2: colIndexOf(c2s) }
  }
  if (!c1s || !r1s) return null // 半截（"A" 或 "3"）不认——那在 Excel 里是名字不是地址
  const r1 = Number(r1s) - 1
  const c1 = colIndexOf(c1s)
  if (c1 === null || r1 < 0) return null
  if (c2s === undefined && r2s === undefined) {
    // 单格：A1
    return { r1, c1, r2: r1, c2: c1 }
  }
  if (!c2s || !r2s) return null // A1:B 这种半截终点不认
  const r2 = Number(r2s) - 1
  const c2 = colIndexOf(c2s)
  if (c2 === null || r2 < 0) return null
  // 起点在终点之后（B4:A1）在 Excel 里也合法，规范化成左上到右下
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) }
}

/** 把 A1 解析结果补成完整矩形（整列/整行用簿子容量补边界）。补不出来返回 null */
export function a1ToRect(s: string, size: { rows: number; cols: number }): SheetRect | null {
  const ref = parseA1(s)
  if (!ref) return null
  const r1 = ref.r1 ?? 0
  const c1 = ref.c1 ?? 0
  const r2 = ref.r2 ?? Math.max(0, size.rows - 1)
  const c2 = ref.c2 ?? Math.max(0, size.cols - 1)
  if (r2 < r1 || c2 < c1) return null
  return { r1, c1, r2, c2 }
}

/** VBA 的颜色是一个 BGR 长整型（`RGB(255,0,0)` = 255 而不是 0xFF0000）。
 *  这里两件事都做掉：长整型 ↔ `#rrggbb`。 */
export function bgrToHex(v: number): string {
  const r = v & 0xff
  const g = (v >> 8) & 0xff
  const b = (v >> 16) & 0xff
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

/** `#rrggbb`（或 `rgb(...)` 里的三段）→ VBA 的 BGR 长整型。认不出返回 null */
export function hexToBgr(color: string): number | null {
  const t = color.trim()
  const hex = /^#?([0-9a-f]{6})$/i.exec(t)
  if (hex) {
    const n = parseInt(hex[1], 16)
    const r = (n >> 16) & 0xff
    const g = (n >> 8) & 0xff
    const b = n & 0xff
    return r | (g << 8) | (b << 16)
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(t)
  if (rgb) return Number(rgb[1]) | (Number(rgb[2]) << 8) | (Number(rgb[3]) << 16)
  return null
}

/** Univer 的 ICellData 形状里我们用到的那两格。适配层用它把公式/清空包起来 */
interface ICellDataLike {
  v?: CellValue | null
  f?: string
}

/** Univer 的 CellValue 不含 null；我们这一层的含。写纯值时要把 null 排除掉 */
type PlainCell = Exclude<CellValue, null>

/** 整片都是纯值（没有公式格也没有要清空的格）？是就能直接喂 setValues */
function isPlainGrid(grid: CellWrite[][]): grid is PlainCell[][] {
  return grid.every((row) => row.every((cell) => cell !== null && typeof cell !== 'object'))
}

/**
 * 把接口接到活着的 Univer 门面上。
 *
 * 三个实现上的取舍，先说清楚：
 *
 * 1. **读走门面、已用区域走快照。** 单格/一片的值与公式用 `FRange.getValue(s)`/
 *    `getFormula(s)`，是活文档；而已用区域没有门面方法，只能从
 *    `getSnapshot()` 的 cellData 矩阵里扫——与写盘（univer-io.ts）同一份真相，
 *    两边不会"宏看见的已用区域"和"文件里有的格子"不一致。
 * 2. **写只有一条路：`setValues(grid)`。** VBA 的 `Range.Value = 5`（铺满一片）
 *    和 `Range.Value = 二维数组`（逐格）在运行时里都摊成 grid 再进来，
 *    适配层不必区分。公式格走 ICellData，与写盘同一条命令通道（可撤销）。
 * 3. **`getBackground()` 只报首格。** 一片格子的底色本来就不保证一致，
 *    VBA 的 `Interior.Color` 读的也是左上角那一格，两边正好对齐。
 */
export function sheetApiOf(univer: FUniver, path = ''): SheetMacroApi {
  const wb = () => univer.getActiveWorkbook()
  const wsOf = (name: string) => wb()?.getSheetByName(name) ?? null
  /** 表名 → sheetId（快照的键是 id 不是名） */
  const idOf = (name: string) => wsOf(name)?.getSheetId() ?? null

  return {
    path,

    sheetNames: () => wb()?.getSheets().map((s) => s.getSheetName()) ?? [],
    activeSheet: () => wb()?.getActiveSheet().getSheetName() ?? '',

    setActiveSheet: (name) => {
      const ws = wsOf(name)
      if (!ws) return false
      wb()?.setActiveSheet(ws)
      return true
    },

    readCell: (sheet, r, c) => {
      const range = wsOf(sheet)?.getRange(r, c)
      if (!range) return { v: null, f: '' }
      const v = range.getValue()
      const f = range.getFormula()
      return { v: (v ?? null) as CellValue, f: typeof f === 'string' ? f : '' }
    },

    readRange: (sheet, rect) => {
      const ws = wsOf(sheet)
      if (!ws) return []
      const range = ws.getRange(rect.r1, rect.c1, rect.r2 - rect.r1 + 1, rect.c2 - rect.c1 + 1)
      const vs = (range.getValues() ?? []) as CellValue[][]
      const fs = (range.getFormulas() ?? []) as string[][]
      const out: CellRead[][] = []
      for (let r = rect.r1; r <= rect.r2; r++) {
        const row: CellRead[] = []
        for (let c = rect.c1; c <= rect.c2; c++) {
          row.push({
            v: (vs[r - rect.r1]?.[c - rect.c1] ?? null) as CellValue,
            f: fs[r - rect.r1]?.[c - rect.c1] ?? '',
          })
        }
        out.push(row)
      }
      return out
    },

    writeRange: (sheet, r1, c1, grid) => {
      const ws = wsOf(sheet)
      if (!ws || !grid.length) return 0
      const rows = grid.length
      const cols = Math.max(...grid.map((row) => row.length))
      if (!cols) return 0
      const range = ws.getRange(r1, c1, rows, cols)
      // 两条路，看 grid 里有没有"不是纯值"的格：
      //   - 纯值（string/number/boolean）直接 setValues(grid)——最贴门面的用法；
      //   - 有公式或要清空的格，逐格包成 ICellData（`{ f: … }` / `{ v: null }`）。
      //     `{ v: null }` 这个形状不是猜的：univer-io.ts 自己就是这么喂 cellData 的。
      const mixed = !isPlainGrid(grid)
      if (!mixed) {
        range.setValues(grid)
        return rows * cols
      }
      const payload: ICellDataLike[][] = grid.map((row) =>
        row.map((cell) => {
          if (cell === null) return { v: null }
          if (typeof cell === 'object') return { f: cell.f }
          return { v: cell }
        }),
      )
      range.setValues(payload)
      return rows * cols
    },

    usedRange: (sheet) => {
      const id = idOf(sheet)
      const cellData = wb()?.getSnapshot().sheets[id ?? '']?.cellData as
        | Record<string, Record<string, unknown> | undefined>
        | undefined
      if (!cellData) return null
      let r1 = Infinity
      let c1 = Infinity
      let r2 = -Infinity
      let c2 = -Infinity
      for (const [rStr, row] of Object.entries(cellData)) {
        if (!row) continue
        const r = Number(rStr)
        if (!Number.isFinite(r)) continue
        let rowHas = false
        for (const cStr of Object.keys(row)) {
          const c = Number(cStr)
          if (!Number.isFinite(c)) continue
          rowHas = true
          if (c < c1) c1 = c
          if (c > c2) c2 = c
        }
        if (rowHas) {
          if (r < r1) r1 = r
          if (r > r2) r2 = r
        }
      }
      if (r2 < 0) return null
      return { r1, c1, r2, c2 }
    },

    sheetSize: (sheet) => {
      const id = idOf(sheet)
      const s = wb()?.getSnapshot().sheets[id ?? '']
      return { rows: s?.rowCount ?? 0, cols: s?.columnCount ?? 0 }
    },

    selection: () => {
      const ws = wb()?.getActiveSheet()
      const range = ws?.getSelection()?.getActiveRange()
      if (!ws || !range) return null
      return {
        sheet: ws.getSheetName(),
        r1: range.getRow(),
        c1: range.getColumn(),
        r2: range.getLastRow(),
        c2: range.getLastColumn(),
      }
    },

    selectRange: (sheet, rect) => {
      wsOf(sheet)?.getRange(rect.r1, rect.c1, rect.r2 - rect.r1 + 1, rect.c2 - rect.c1 + 1).activate()
    },

    // 撤/重做交给 Univer 的命令栈：宏改过的每一步都在栈里，与手改的一样能撤
    undo: () => {
      try {
        wb()?.undo()
        return true
      } catch {
        return false
      }
    },
    redo: () => {
      try {
        wb()?.redo()
        return true
      } catch {
        return false
      }
    },

    backgroundColor: (sheet, rect) => {
      const ws = wsOf(sheet)
      const bg = ws?.getRange(rect.r1, rect.c1, rect.r2 - rect.r1 + 1, rect.c2 - rect.c1 + 1).getBackground()
      return bg ? bg : null
    },

    setBackgroundColor: (sheet, rect, color) => {
      const ws = wsOf(sheet)
      if (!ws) return
      const range = ws.getRange(rect.r1, rect.c1, rect.r2 - rect.r1 + 1, rect.c2 - rect.c1 + 1)
      if (color) {
        range.setBackgroundColor(color)
        return
      }
      // 清除底色：Univer 的门面只有 setBackgroundColor(color)，没有"清除"入口。
      // 拿空串去设**可能**与未设同效，但这一条没在真机上验过——按这个项目的规矩，
      // 没验过的话就不猜，报出来让宏作者知道这一步没做成
      throw new Error('清除背景色没有实现：Univer 门面没有清除入口，空串是否等价未在真机上验过')
    },
  }
}
