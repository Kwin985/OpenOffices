// VBA 子集 · 表格侧的端到端验证（Node 侧，不依赖 Tauri / 真 Univer）
//
// 查四件事：
//   1. Excel 那一套对象模型（Workbooks / Worksheets / Cells / Range / Interior）踩在
//      SheetMacroApi 上是对的
//   2. `Value` 读写的形状与 Excel 对齐（单格标量、多格 1 基二维数组、标量铺满、
//      一维数组行优先铺）
//   3. 地址那一套（A1 记法、Address 的 $ 形式、End/Offset/Resize/EntireRow）没跑偏
//   4. 两个宿主不互通：表格里摸 ActiveDocument、文档里摸 Worksheets，都是一句明白的错
//
// 这里的"工作簿"是一个假的：只实现 SheetMacroApi 那十几个方法（见 src/lib/sheet-macro.ts）。
// 接口一隔，Univer 的门面就不必出现在这一层——与文档侧 FakeDoc 测 vba-rt.ts 同一套办法。
import { looksLikeVba, runVbaBook, transpileVba, VBA_BOOK_SAMPLE } from '../src/lib/vba.ts'
import { VBA_SAMPLE } from '../src/lib/vba.ts'

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}

// ── 假工作簿 ────────────────────────────────────────────────────────────────

/** 一格：值 + 公式（没有公式是空串）+ 底色（#rrggbb 或没有） */
class FakeBook {
  /**
   * @param sheets 表名 → 二维起手式（`[[v, v], [v, v]]`，第一行第一列是 A1）
   * @param active 当前表名
   */
  constructor(sheets = { Sheet1: [] }, active = 'Sheet1') {
    /** 表名 → Map<"r,c", { v, f, bg }>（0 基） */
    this.data = new Map()
    this.sizes = new Map()
    this.active = active
    for (const [name, grid] of Object.entries(sheets)) {
      const cells = new Map()
      grid.forEach((row, r) =>
        row.forEach((v, c) => {
          if (v !== null && v !== '') cells.set(`${r},${c}`, { v, f: '', bg: null })
        }),
      )
      this.data.set(name, cells)
      this.sizes.set(name, { rows: 100, cols: 20 })
    }
    this.sel = { sheet: active, r1: 0, c1: 0, r2: 0, c2: 0 }
    this.undoCalls = 0
  }

  cell(sheet, r, c) {
    return this.data.get(sheet)?.get(`${r},${c}`) ?? null
  }

  /** 摆一个数/串进某格（测试起手式） */
  put(sheet, r, c, v, f = '') {
    let cells = this.data.get(sheet)
    if (!cells) {
      cells = new Map()
      this.data.set(sheet, cells)
      this.sizes.set(sheet, { rows: 100, cols: 20 })
    }
    cells.set(`${r},${c}`, { v, f, bg: cells.get(`${r},${c}`)?.bg ?? null })
  }

  path = 'D:\\book\\销售表.xlsx'

  sheetNames() {
    return [...this.data.keys()]
  }

  activeSheet() {
    return this.active
  }

  setActiveSheet(name) {
    if (!this.data.has(name)) return false
    this.active = name
    return true
  }

  readCell(sheet, r, c) {
    const cell = this.cell(sheet, r, c)
    return { v: cell ? cell.v : null, f: cell ? cell.f : '' }
  }

  readRange(sheet, rect) {
    const out = []
    for (let r = rect.r1; r <= rect.r2; r++) {
      const row = []
      for (let c = rect.c1; c <= rect.c2; c++) row.push(this.readCell(sheet, r, c))
      out.push(row)
    }
    return out
  }

  writeRange(sheet, r1, c1, grid) {
    let cells = this.data.get(sheet)
    if (!cells) {
      cells = new Map()
      this.data.set(sheet, cells)
      this.sizes.set(sheet, { rows: 100, cols: 20 })
    }
    grid.forEach((row, r) =>
      row.forEach((cell, c) => {
        const key = `${r1 + r},${c1 + c}`
        if (cell === null) cells.delete(key)
        else if (typeof cell === 'object' && 'f' in cell) {
          const old = cells.get(key)
          cells.set(key, { v: old?.v ?? null, f: cell.f, bg: old?.bg ?? null })
        } else {
          const old = cells.get(key)
          cells.set(key, { v: cell, f: '', bg: old?.bg ?? null })
        }
      }),
    )
    return grid.length * Math.max(0, ...grid.map((r) => r.length))
  }

  usedRange(sheet) {
    const cells = this.data.get(sheet)
    if (!cells || !cells.size) return null
    let r1 = Infinity
    let c1 = Infinity
    let r2 = -Infinity
    let c2 = -Infinity
    for (const key of cells.keys()) {
      const [r, c] = key.split(',').map(Number)
      r1 = Math.min(r1, r)
      c1 = Math.min(c1, c)
      r2 = Math.max(r2, r)
      c2 = Math.max(c2, c)
    }
    return { r1, c1, r2, c2 }
  }

  sheetSize(sheet) {
    return this.sizes.get(sheet) ?? { rows: 0, cols: 0 }
  }

  selection() {
    return { ...this.sel }
  }

  selectRange(sheet, rect) {
    this.sel = { sheet, ...rect }
  }

  backgroundColor(sheet, rect) {
    return this.cell(sheet, rect.r1, rect.c1)?.bg ?? null
  }

  setBackgroundColor(sheet, rect, color) {
    if (!color) throw new Error('清除背景色没有实现（假簿子照抄适配层的行为）')
    for (let r = rect.r1; r <= rect.r2; r++) {
      for (let c = rect.c1; c <= rect.c2; c++) {
        const cell = this.cell(sheet, r, c)
        if (cell) cell.bg = color
        else this.put(sheet, r, c, null)
        this.cell(sheet, r, c).bg = color
      }
    }
  }

  undo() {
    this.undoCalls++
    return true
  }

  redo() {
    return true
  }
}

/** 跑一段表格侧 VBA，返回 { ok, log, error, book } */
function run(src, book = new FakeBook({ Sheet1: [] })) {
  const res = runVbaBook(src, book, () => {}, book.path)
  return { ...res, book }
}

/** 起手式：A1:A6 = 1..6 */
function book123456() {
  const b = new FakeBook()
  for (let i = 0; i < 6; i++) b.put('Sheet1', i, 0, i + 1)
  return b
}

// ── 1. 认得出与转译 ─────────────────────────────────────────────────────────

check('认得出 VBA（表格侧同一把尺子）', looksLikeVba('Sub Main()\nEnd Sub') === true)
{
  const t = transpileVba(VBA_BOOK_SAMPLE)
  check('VBA_BOOK_SAMPLE 转得动', t.ok === true, t.error)
  check('VBA_BOOK_SAMPLE 入口是 Main', t.entry === 'Main')
}
{
  const t = transpileVba('Sub Main()\n  Set ws = Worksheets(1)\n  ws.Cells(1, 1).Value = 1\nEnd Sub')
  check('Set + Cells 链能转', t.ok === true, t.error)
}

// ── 2. 寻址：A1 记法、Cells、全局 Range ────────────────────────────────────

{
  const b = new FakeBook({ Sheet1: [['x', 'y'], ['z', 'w']] })
  const r = run('Sub Main()\n  Debug.Print Range("A1").Value\n  Debug.Print Cells(2, 2).Value\nEnd Sub', b)
  check('A1 与 Cells 都读得到', r.ok && r.log.join('|') === 'x|w', `${r.error ?? r.log.join('|')}`)
}
{
  const b = new FakeBook({ Sheet1: [['x', 'y'], ['z', 'w']] })
  const r = run('Sub Main()\n  Cells(1, 2).Value = "改了"\nEnd Sub', b)
  check('Cells 写得到', r.ok && b.cell('Sheet1', 0, 1).v === '改了', `${r.error ?? JSON.stringify(b.cell('Sheet1', 0, 1))}`)
  check('写过就算改过（changed）', r.changed === true)
}
{
  const b = new FakeBook({ Sheet1: [['x', 'y'], ['z', 'w']] })
  const r = run('Sub Main()\n  Debug.Print Worksheets(1).Range("B2").Value\nEnd Sub', b)
  check('Worksheets(1).Range 读得到', r.ok && r.log[0] === 'w', `${r.error ?? r.log[0]}`)
}
{
  // `$` 与大小写在 A1 里都要认
  const b = new FakeBook({ Sheet1: [['x']] })
  const r = run('Sub Main()\n  Debug.Print Range("$a$1").Value\nEnd Sub', b)
  check('$A$1 大小写不敏感', r.ok && r.log[0] === 'x', `${r.error ?? r.log[0]}`)
}

// ── 3. Value 的形状 ────────────────────────────────────────────────────────

{
  const b = new FakeBook({ Sheet1: [[1, 2], [3, 4]] })
  const r = run('Sub Main()\n  Dim v\n  v = Range("A1:B2").Value\n  Debug.Print v(1, 1)\n  Debug.Print v(2, 2)\n  Debug.Print v(1, 2)\nEnd Sub', b)
  check('多格 Value 是 1 基二维数组', r.ok && r.log.join('|') === '1|4|2', `${r.error ?? r.log.join('|')}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Range("A1:B2").Value = 7\nEnd Sub', b)
  const all =
    b.cell('Sheet1', 0, 0)?.v === 7 &&
    b.cell('Sheet1', 0, 1)?.v === 7 &&
    b.cell('Sheet1', 1, 0)?.v === 7 &&
    b.cell('Sheet1', 1, 1)?.v === 7
  check('标量铺满整片（Excel 的规矩）', r.ok && all, `${r.error ?? JSON.stringify([...b.data.get('Sheet1').values()])}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Range("A1:A3").Value = Array(10, 20, 30)\nEnd Sub', b)
  check(
    '一维数组按行优先铺',
    r.ok && b.cell('Sheet1', 0, 0)?.v === 10 && b.cell('Sheet1', 1, 0)?.v === 20 && b.cell('Sheet1', 2, 0)?.v === 30,
    `${r.error ?? ''}`,
  )
}
{
  const b = new FakeBook({ Sheet1: [[1, 2], [3, 4]] })
  const r = run('Sub Main()\n  Dim v\n  v = Range("A1:B2").Value\n  Range("D1:E2").Value = v\nEnd Sub', b)
  check(
    '二维数组整体搬过去',
    r.ok && b.cell('Sheet1', 0, 3)?.v === 1 && b.cell('Sheet1', 0, 4)?.v === 2 && b.cell('Sheet1', 1, 3)?.v === 3 && b.cell('Sheet1', 1, 4)?.v === 4,
    `${r.error ?? JSON.stringify([...b.data.get('Sheet1').keys()])}`,
  )
}
{
  // 空格子读出来是 Empty，写回去是"清掉"
  const b = new FakeBook({ Sheet1: [[1]] })
  const r = run('Sub Main()\n  If IsEmpty(Range("B9").Value) Then Debug.Print "空的"\nEnd Sub', b)
  check('空格子读出来是 Empty', r.ok && r.log[0] === '空的', `${r.error ?? r.log[0]}`)
}

// ── 4. 公式 ────────────────────────────────────────────────────────────────

{
  const b = new FakeBook({ Sheet1: [[3]] })
  const r = run('Sub Main()\n  Range("B1").Formula = "=A1*2"\nEnd Sub', b)
  check('Formula 写进去', r.ok && b.cell('Sheet1', 0, 1)?.f === '=A1*2', `${r.error ?? JSON.stringify(b.cell('Sheet1', 0, 1))}`)
  const r2 = run('Sub Main()\n  Debug.Print Range("B1").Formula\nEnd Sub', b)
  check('Formula 读得回来', r2.ok && r2.log[0] === '=A1*2', `${r2.error ?? r2.log[0]}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Range("A1").Value = "=1+2"\nEnd Sub', b)
  check('以 = 开头的串当公式写', r.ok && b.cell('Sheet1', 0, 0)?.f === '=1+2', `${r.error ?? JSON.stringify(b.cell('Sheet1', 0, 0))}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Range("A1").Formula = "1+2"\nEnd Sub', b)
  check('公式不以 = 开头要报错（不猜）', !r.ok && /要以 = 开头/.test(r.error ?? ''), r.error)
}

// ── 5. 地址与形状 ──────────────────────────────────────────────────────────

{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Debug.Print Range("B2").Address\n  Debug.Print Range("B2:C3").Address\nEnd Sub', b)
  check('Address 默认带 $', r.ok && r.log.join('|') === '$B$2|$B$2:$C$3', `${r.error ?? r.log.join('|')}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Debug.Print Range("B2").Address(0, 0)\nEnd Sub', b)
  check('Address(0,0) 给相对形式', r.ok && r.log[0] === 'B2', `${r.error ?? r.log[0]}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Debug.Print Range("B2").Row\n  Debug.Print Range("B2").Column\n  Debug.Print Range("B2:D4").Count\nEnd Sub', b)
  check('Row/Column 是 1 基，Count 数格子', r.ok && r.log.join('|') === '2|2|9', `${r.error ?? r.log.join('|')}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Debug.Print Range("B2:D4").Rows.Count\n  Debug.Print Range("B2:D4").Columns.Count\n  Debug.Print Range("B2:D4").Rows(2).Address\nEnd Sub', b)
  // Rows(n) 是**片内**第 n 行：B2:D4 的第 2 行是 B3:D3，不是整行（整行是 Worksheet.Rows）
  check('Rows/Columns 集合三面都通', r.ok && r.log.join('|') === '3|3|$B$3:$D$3', `${r.error ?? r.log.join('|')}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Debug.Print Range("C3").Offset(1, -1).Address\n  Debug.Print Range("C3").Resize(2, 4).Address\n  Debug.Print Range("C3").EntireRow.Address\nEnd Sub', b)
  check('Offset/Resize/EntireRow', r.ok && r.log.join('|') === '$B$4|$C$3:$F$4|$A$3:$T$3', `${r.error ?? r.log.join('|')}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Debug.Print Range("B2:D4").Item(4).Address\n  Debug.Print Range("B2:D4").Cells(2, 3).Address\nEnd Sub', b)
  // Item(4) 行优先数第 4 格：B2、C2、D2、B3
  check('Item 与 Cells 在一片内寻址', r.ok && r.log.join('|') === '$B$3|$D$3', `${r.error ?? r.log.join('|')}`)
}

// ── 6. End 一族 ────────────────────────────────────────────────────────────

{
  // A1=1, A2=2, A3=3, A4 空
  const b = new FakeBook({ Sheet1: [[1], [2], [3]] })
  const r = run('Sub Main()\n  Debug.Print Range("A1").End(xlDown).Address\nEnd Sub', b)
  check('End(xlDown) 走到最后一个非空', r.ok && r.log[0] === '$A$3', `${r.error ?? r.log[0]}`)
}
{
  // 起点是空的：跳到下面第一个非空
  const b = new FakeBook({ Sheet1: [[], [], [5]] })
  const r = run('Sub Main()\n  Debug.Print Range("A1").End(xlDown).Address\nEnd Sub', b)
  check('空起点的 End(xlDown) 跳到第一个非空', r.ok && r.log[0] === '$A$3', `${r.error ?? r.log[0]}`)
}
{
  // 一个非空都没有：给到这一版的边界（第 100 行）
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Debug.Print Range("A1").End(xlDown).Address\nEnd Sub', b)
  check('整列空的 End(xlDown) 给边界', r.ok && r.log[0] === '$A$100', `${r.error ?? r.log[0]}`)
}
{
  const b = new FakeBook({ Sheet1: [[1, 2, 3]] })
  const r = run('Sub Main()\n  Debug.Print Range("C1").End(xlToLeft).Address\nEnd Sub', b)
  check('End(xlToLeft)', r.ok && r.log[0] === '$A$1', `${r.error ?? r.log[0]}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Dim x\n  x = Range("A1").End(12345)\nEnd Sub', b)
  check('End 的方向认不出要报错', !r.ok && /方向认不出来/.test(r.error ?? ''), r.error)
}

// ── 7. 集合：工作表 ────────────────────────────────────────────────────────

{
  const b = new FakeBook({ 表一: [], 表二: [] }, '表二')
  const r = run('Sub Main()\n  Debug.Print Worksheets.Count\n  Debug.Print Worksheets(1).Name\n  Debug.Print Worksheets("表二").Name\n  Debug.Print Sheets.Item(2).Name\n  Debug.Print ThisWorkbook.ActiveSheet.Name\n  Debug.Print ThisWorkbook.Name\nEnd Sub', b)
  check(
    'Worksheets/Sheets/ThisWorkbook 各面',
    r.ok && r.log.join('|') === '2|表一|表二|表二|表二|销售表.xlsx',
    `${r.error ?? r.log.join('|')}`,
  )
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Debug.Print Workbooks.Count\n  Set wb = Workbooks(1)\n  Debug.Print wb.Name\nEnd Sub', b)
  check('Workbooks 只有一本', r.ok && r.log.join('|') === '1|销售表.xlsx', `${r.error ?? r.log.join('|')}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Dim ws\n  For Each ws In Worksheets\n    Debug.Print ws.Name\n  Next ws\nEnd Sub', b)
  check('For Each 走工作表', r.ok && r.log[0] === 'Sheet1', `${r.error ?? r.log[0]}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Worksheets("没有这一张").Name = "x"\nEnd Sub', b)
  check('表名对不上报错并搭上现有表名', !r.ok && /没有名为「没有这一张」/.test(r.error ?? ''), r.error)
}

// ── 8. UsedRange 与选区 ────────────────────────────────────────────────────

{
  const b = new FakeBook({ Sheet1: [] })
  b.put('Sheet1', 1, 1, 'a')
  b.put('Sheet1', 3, 4, 'b')
  const r = run('Sub Main()\n  Debug.Print ActiveSheet.UsedRange.Address\nEnd Sub', b)
  check('UsedRange 围出最小矩形', r.ok && r.log[0] === '$B$2:$E$4', `${r.error ?? r.log[0]}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  If ActiveSheet.UsedRange Is Nothing Then Debug.Print "空表"\nEnd Sub', b)
  check('空表 UsedRange 是 Nothing', r.ok && r.log[0] === '空表', `${r.error ?? r.log[0]}`)
}
{
  const b = new FakeBook({ Sheet1: [[1, 2]] })
  b.sel = { sheet: 'Sheet1', r1: 0, c1: 1, r2: 0, c2: 1 }
  const r = run('Sub Main()\n  Debug.Print Selection.Address\n  Debug.Print Application.ActiveCell.Address\n  Debug.Print Selection.Value\nEnd Sub', b)
  check('Selection/ActiveCell 跟着选区', r.ok && r.log.join('|') === '$B$1|$B$1|2', `${r.error ?? r.log.join('|')}`)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Range("C5:D6").Select\n  Debug.Print Selection.Address\nEnd Sub', b)
  check('Select 把选区挪过去', r.ok && r.log[0] === '$C$5:$D$6', `${r.error ?? r.log[0]}`)
}

// ── 9. For Each 走格子 ─────────────────────────────────────────────────────

{
  const b = new FakeBook({ Sheet1: [[1, 2], [3, 4]] })
  const r = run('Sub Main()\n  Dim s\n  s = 0\n  Dim c\n  For Each c In Range("A1:B2")\n    s = s + c.Value\n  Next c\n  Debug.Print s\nEnd Sub', b)
  check('For Each 逐格（行优先）', r.ok && r.log[0] === '10', `${r.error ?? r.log[0]}`)
}
{
  const b = new FakeBook({ Sheet1: [[1, 2], [3, 4]] })
  const r = run('Sub Main()\n  Dim n\n  n = 0\n  For Each c In Range("A1:B2").Cells\n    n = n + 1\n  Next c\n  Debug.Print n\nEnd Sub', b)
  check('For Each 走 .Cells', r.ok && r.log[0] === '4', `${r.error ?? r.log[0]}`)
}

// ── 10. 底色 ───────────────────────────────────────────────────────────────

{
  const b = new FakeBook({ Sheet1: [[1]] })
  const r = run('Sub Main()\n  Range("A1").Interior.Color = vbRed\nEnd Sub', b)
  check('Interior.Color 写进去（BGR → #rrggbb）', r.ok && b.cell('Sheet1', 0, 0)?.bg === '#ff0000', `${r.error ?? b.cell('Sheet1', 0, 0)?.bg}`)
}
{
  const b = new FakeBook({ Sheet1: [[1]] })
  run('Sub Main()\n  Range("A1").Interior.Color = RGB(0, 128, 255)\nEnd Sub', b)
  check('RGB 换算', b.cell('Sheet1', 0, 0)?.bg === '#0080ff', b.cell('Sheet1', 0, 0)?.bg)
}
{
  const b = new FakeBook({ Sheet1: [[1]] })
  run('Sub Main()\n  Range("A1").Interior.Color = vbRed\nEnd Sub', b)
  const r = run('Sub Main()\n  Debug.Print Range("A1").Interior.Color\nEnd Sub', b)
  check('Interior.Color 读得回来（#rrggbb → BGR）', r.ok && r.log[0] === '255', `${r.error ?? r.log[0]}`)
}
{
  const b = new FakeBook({ Sheet1: [[1]] })
  const r = run('Sub Main()\n  Range("A1").Interior.Color = "红"\nEnd Sub', b)
  check('颜色给的不是数要报错', !r.ok && /要的是颜色值/.test(r.error ?? ''), r.error)
}

// ── 11. 清与替换 ───────────────────────────────────────────────────────────

{
  const b = new FakeBook({ Sheet1: [[1, 2], [3, 4]] })
  const r = run('Sub Main()\n  Range("A1:B2").ClearContents\nEnd Sub', b)
  check('ClearContents 清空', r.ok && b.data.get('Sheet1').size === 0, `${r.error ?? b.data.get('Sheet1').size}`)
}
{
  const b = new FakeBook({ Sheet1: [['a', 'b', 'a'], ['c', 'a', 'd']] })
  const r = run('Sub Main()\n  Dim n\n  n = Range("A1:C2").Replace("a", "X")\n  Debug.Print n\nEnd Sub', b)
  check(
    'Replace 按整格换并报数',
    r.ok && r.log[0] === '3' && b.cell('Sheet1', 0, 0)?.v === 'X' && b.cell('Sheet1', 1, 1)?.v === 'X' && b.cell('Sheet1', 0, 1)?.v === 'b',
    `${r.error ?? r.log[0]}`,
  )
}
{
  const b = new FakeBook({ Sheet1: [['甲', '乙']] })
  const r = run('Sub Main()\n  Set c = Range("A1:B1").Find("乙")\n  If Not c Is Nothing Then Debug.Print c.Address\nEnd Sub', b)
  check('Find 找到第一个', r.ok && r.log[0] === '$B$1', `${r.error ?? r.log[0]}`)
}
{
  const b = new FakeBook({ Sheet1: [['甲', '乙']] })
  const r = run('Sub Main()\n  Set c = Range("A1:B1").Find("丙")\n  If c Is Nothing Then Debug.Print "没有"\nEnd Sub', b)
  check('Find 找不到是 Nothing', r.ok && r.log[0] === '没有', `${r.error ?? r.log[0]}`)
}

// ── 12. 宿主隔离 ───────────────────────────────────────────────────────────

{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  ActiveDocument.Content.Text = "x"\nEnd Sub', b)
  check('表格里摸 ActiveDocument 是明白的错', !r.ok && /这个宿主是表格/.test(r.error ?? ''), r.error)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Worksheets(1).Name = "x"\nEnd Sub', b)
  check('工作表名只读（Set 才换得了）', !r.ok, r.error)
}

// ── 13. 错误路径 ───────────────────────────────────────────────────────────

{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Range("这不是地址").Value = 1\nEnd Sub', b)
  check('坏地址报错带原文', !r.ok && /认不出「这不是地址」/.test(r.error ?? ''), r.error)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Cells(1, 99).Value = 1\nEnd Sub', b)
  check('Cells 越界报错', !r.ok && /超出了这一张表/.test(r.error ?? ''), r.error)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Range("A1").Copy\nEnd Sub', b)
  check('没实现的方法报没实现', !r.ok && /没有实现/.test(r.error ?? ''), r.error)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Application.Calculate\nEnd Sub', b)
  check('Calculate 报没实现', !r.ok && /没有实现/.test(r.error ?? ''), r.error)
}
{
  const b = new FakeBook({ Sheet1: [] })
  const r = run('Sub Main()\n  Application.Undo\nEnd Sub', b)
  check('Application.Undo 走到簿子', r.ok && b.undoCalls === 1, `${r.error ?? b.undoCalls}`)
}

// ── 14. 面板上那条一键样例（端到端） ────────────────────────────────────────

{
  const b = book123456()
  const r = run(VBA_BOOK_SAMPLE, b)
  check('样例跑得动', r.ok === true, r.error)
  check('平均写进 A8', b.cell('Sheet1', 7, 0)?.v === 3.5, JSON.stringify(b.cell('Sheet1', 7, 0)))
  check('超过平均的三格标红', b.cell('Sheet1', 3, 0)?.bg === '#ff0000' && b.cell('Sheet1', 4, 0)?.bg === '#ff0000' && b.cell('Sheet1', 5, 0)?.bg === '#ff0000', '')
  check('没超过平均的不上色', b.cell('Sheet1', 2, 0)?.bg == null, String(b.cell('Sheet1', 2, 0)?.bg))
  check('样例有 MsgBox 输出', r.log.some((l) => l.includes('平均')), JSON.stringify(r.log))
}
{
  // 一条数都没有：早退，不写平均值
  const b = new FakeBook({ Sheet1: [['甲'], ['乙']] })
  const r = run(VBA_BOOK_SAMPLE, b)
  check('无数时样例早退', r.ok && b.cell('Sheet1', 7, 0) == null && r.log.some((l) => l.includes('一个数都没有')), `${r.error ?? ''}`)
}
{
  // 表格侧内置的第二条：给已用区域首行上底色
  const b = new FakeBook({ Sheet1: [['表头', '表头'], [1, 2]] })
  const src = [
    'Sub Main()',
    '    Dim ws As Worksheet',
    '    Set ws = ThisWorkbook.ActiveSheet',
    '    If ws.UsedRange Is Nothing Then',
    '        MsgBox "这一张表还是空的"',
    '        Exit Sub',
    '    End If',
    '    ws.UsedRange.Rows(1).Interior.Color = RGB(217, 217, 217)',
    '    MsgBox "已给 " & ws.UsedRange.Rows(1).Address & " 上了底色"',
    'End Sub',
  ].join('\n')
  const r = run(src, b)
  check(
    '内置第二条跑得动',
    r.ok && b.cell('Sheet1', 0, 0)?.bg === '#d9d9d9' && b.cell('Sheet1', 0, 1)?.bg === '#d9d9d9' && b.cell('Sheet1', 1, 0)?.bg == null,
    `${r.error ?? ''}`,
  )
}

// ── 汇总 ───────────────────────────────────────────────────────────────────

console.log(`通过 ${ok.length} / ${ok.length + bad.length}`)
if (bad.length) {
  console.log('\n失败的用例：')
  for (const b of bad) console.log('  × ' + b)
  process.exit(1)
}
