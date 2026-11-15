// VBA 子集 · 第四层：运行时（v0.131；工作簿对象模型 v0.134）
//
// 把 VBA 的对象模型与内置函数接到本项目的宏引擎上。转译出来的 JS 里所有
// `__vba.X` 都落到这里。
//
// 四条设计上的取舍，先说清楚，免得日后以为是漏做：
//
// 1. **只做一份文档。** VBA 的 `Documents` 是一个集合，这里 `Count` 恒为 1、
//    `Item(1)` 就是当前编辑器里这一篇。多文档协同不在这个子集的范围里。
//    `Documents.Open` 直接报"没实现"——打开文件要走另一整套流程。
//
// 2. **位置用 VBA 的字符下标（1 基、end 不含）**，内部换算成 ProseMirror 的位置。
//    换算表按编辑器当前的 doc 现建现用：VBA 的 `ActiveDocument.Content.Start`
//    一定是 1、`End` 是"最后一个字符后面那一格"，和 PM 的位置不是一回事。
//
// 3. **Empty / Nothing / Null 合成一个值 `undefined`/`null`。** VBA 里这三个
//    是不同的东西，本子集不区分：`IsEmpty`、`IsNothing`、`IsNull` 因此同义。
//    真正需要区分的是数据库那一路，而这个子集不碰数据库。
//
// 4. **两个宿主，两套对象模型，不互通**（v0.134 起）。文字宿主给的是
//    `Documents`/`ActiveDocument`/`Selection`/`Range`（字符区间）；表格宿主给的是
//    `Workbooks`/`Worksheets`/`Cells`/`Range`（格子）。摸错了得到的是一句
//    "这个宿主没有 …"的错，不是一个看起来能用的空对象——空对象比报错难查。
//    两边共用的是语言那一层（运算符、内置函数、数组、错误处理），
//    那一层一个宿主都猜不出来，只能老老实实实现一遍。

import type { Editor } from '@tiptap/core'
import type { MacroApi } from './macro'
import type { CellWrite, SheetMacroApi, SheetRect } from './sheet-macro'
import { a1ToRect, bgrToHex, hexToBgr, rectToA1 } from './sheet-macro'

/** VBA 的 Empty */
const EMPTY = undefined

export interface VbaCtx {
  api: MacroApi
  editor: Editor
  /** 输出面板的行 */
  out: string[]
  setStatus: (s: string) => void
  /** 这一趟有没有改到文档 */
  st: { changed: boolean }
  /** 文件路径（ActiveDocument.Name 用） */
  path: string
}

/** 表格宿主的上下文：没有编辑器、没有字符区间，只有一本活簿子 */
export interface VbaBookCtx {
  book: SheetMacroApi
  out: string[]
  setStatus: (s: string) => void
  st: { changed: boolean }
  /** 文件路径（ThisWorkbook.Name 用） */
  path: string
}

/** 运行时内部用的上下文：两个宿主的公共部分 + 文档宿主独有的那几样。
 *  `api`/`editor`/`map`/`doc` 在表格宿主里是 undefined/null——文档那一族的类
 *  只在文档宿主里构造，所以它们照旧按非空用（构造点见 createVbaRuntime） */
interface Ctx {
  out: string[]
  setStatus: (s: string) => void
  st: { changed: boolean }
  path: string
  /** 文字宿主：文档 API、编辑器、字符下标换算表、当前文档 */
  api?: MacroApi
  editor?: Editor
  map?: TextMap
  doc?: VbaDocument
  /** 表格宿主：活簿子 */
  book?: SheetMacroApi
  /** 剪贴板（VBA 的 DataObject 不在这个子集里，这里只是个字符串中转） */
  clip: string
}

/** 文档宿主专用视图：`api`/`editor`/`map`/`doc` 一定在。表格宿主不构造文档对象，
 *  所以文档那一族的类照旧按非空用（构造点见 createVbaRuntime） */
type DocCtx = Ctx & { api: MacroApi; editor: Editor; map: TextMap; doc: VbaDocument }

// ── 字符下标 ↔ ProseMirror 位置 ───────────────────────────────────────────────

interface Block {
  /** 这段内容在 PM 里的起始位置 */
  pos: number
  /** 这段的字符数（不含段间分隔符） */
  len: number
  /** 这段第一个字符在全文里的 0 基下标 */
  charStart: number
}

class TextMap {
  private cache: { doc: unknown; blocks: Block[] } | null = null

  constructor(private readonly editor: Editor) {}

  private blocks(): Block[] {
    const doc = this.editor.state.doc
    if (this.cache && this.cache.doc === doc) return this.cache.blocks
    const blocks: Block[] = []
    let charStart = 0
    doc.forEach((node, offset) => {
      const len = node.textContent.length
      blocks.push({ pos: offset + 1, len, charStart })
      charStart += len + 1 // +1 是 getText() 里那段间的 \n
    })
    this.cache = { doc, blocks }
    return blocks
  }

  /** 全文长度（按 VBA 的算法：段间分隔符算一个字符） */
  get length(): number {
    const bs = this.blocks()
    if (!bs.length) return 0
    const last = bs[bs.length - 1]
    return last.charStart + last.len
  }

  /** VBA 的 1 基字符下标 → PM 位置 */
  charToPos(c: number): number {
    const bs = this.blocks()
    if (!bs.length) return 1
    const i = c - 1
    if (i < 0) return bs[0].pos
    for (const b of bs) {
      if (i < b.charStart + b.len) return b.pos + (i - b.charStart)
      // 正好落在段间分隔符上：算到这一段末尾（PM 里那就是下一段的开头之前）
      if (i === b.charStart + b.len) return b.pos + b.len
    }
    const last = bs[bs.length - 1]
    return last.pos + last.len
  }

  /** PM 位置 → VBA 的 1 基字符下标 */
  posToChar(p: number): number {
    const bs = this.blocks()
    if (!bs.length) return 1
    for (const b of bs) {
      if (p <= b.pos + b.len) return b.charStart + Math.max(0, p - b.pos) + 1
    }
    const last = bs[bs.length - 1]
    return last.charStart + last.len + 1
  }
}

// ── 集合 ─────────────────────────────────────────────────────────────────────

/** VBA 的 Collection / Documents / Words / Paragraphs 之类：下标从 1 起 */
export class VbaColl<T> {
  constructor(readonly items: T[]) {}
  get Count(): number {
    return this.items.length
  }
  Item(i: number): T {
    const v = this.items[i - 1]
    if (v === undefined) throw new Error(`VBA：集合里没有第 ${i} 项（共 ${this.items.length} 项）`)
    return v
  }
}

/** Scripting.Dictionary 的替身：键值对，For Each 走键 */
export class VbaDict {
  private m = new Map<string, unknown>()
  get Count(): number {
    return this.m.size
  }
  Exists(key: unknown): boolean {
    return this.m.has(String(key))
  }
  Add(key: unknown, value: unknown): void {
    this.m.set(String(key), value)
  }
  Item(key: unknown): unknown {
    return this.m.get(String(key))
  }
  Remove(key: unknown): void {
    this.m.delete(String(key))
  }
  RemoveAll(): void {
    this.m.clear()
  }
  get Keys(): string[] {
    return [...this.m.keys()]
  }
  get Items(): unknown[] {
    return [...this.m.values()]
  }
}

/** VBA 的 `Dim c As New Collection`：可增可删，下标从 1 起 */
export class VbaCollection {
  private items: unknown[] = []
  get Count(): number {
    return this.items.length
  }
  /** Add value[, key[, before[, after]]] —— key 在这里只作记录，不参与查找 */
  Add(value: unknown, _key?: unknown): void {
    this.items.push(value)
  }
  Item(i: number): unknown {
    const v = this.items[i - 1]
    if (v === undefined) throw new Error(`VBA：集合里没有第 ${i} 项（共 ${this.items.length} 项）`)
    return v
  }
  Remove(i: number): void {
    const k = i - 1
    if (k < 0 || k >= this.items.length) throw new Error(`VBA：集合里没有第 ${i} 项`)
    this.items.splice(k, 1)
  }
  IndexOf(value: unknown): number {
    const i = this.items.indexOf(value)
    return i < 0 ? 0 : i + 1
  }
  /** 给运行时的 iter() 用 */
  get all(): unknown[] {
    return this.items
  }
}

// ── 对象模型 ─────────────────────────────────────────────────────────────────

class VbaRange {
  constructor(
    private readonly ctx: DocCtx,
    public start: number,
    public end: number,
  ) {}

  get Text(): string {
    return this.ctx.api.getText().slice(this.start - 1, this.end - 1)
  }
  set Text(v: string) {
    this.ctx.api.replaceRange(this.ctx.map.charToPos(this.start), this.ctx.map.charToPos(this.end), String(v))
    this.end = this.start + String(v).length
    this.ctx.st.changed = true
  }
  get Start(): number {
    return this.start
  }
  set Start(v: number) {
    this.start = Number(v)
  }
  get End(): number {
    return this.end
  }
  set End(v: number) {
    this.end = Number(v)
  }
  SetRange(s: number, e: number): void {
    this.start = Number(s)
    this.end = Number(e)
  }
  get StoryType(): number {
    return 1
  }
  InsertBefore(s: string): void {
    this.Text = String(s) + this.Text
  }
  InsertAfter(s: string): void {
    this.Text = this.Text + String(s)
  }
  Delete(): void {
    this.Text = ''
  }
  Copy(): void {
    this.ctx.clip = this.Text
  }
  Paste(): void {
    this.Text = this.ctx.clip
  }
  Collapse(): void {
    this.end = this.start
  }
  MoveStart(n: number): void {
    this.start += Number(n)
  }
  MoveEnd(n: number): void {
    this.end += Number(n)
  }
  get Words(): VbaColl<string> {
    return new VbaColl(this.Text.split(/[^\S]+/).filter(Boolean))
  }
  get Sentences(): VbaColl<string> {
    return new VbaColl(this.Text.split(/(?<=[.!?。！？])\s+/).filter(Boolean))
  }
  get Characters(): VbaColl<string> {
    return new VbaColl([...this.Text])
  }
  get Paragraphs(): VbaColl<string> {
    return new VbaColl(this.Text.split('\n'))
  }
  get Find(): VbaFind {
    return new VbaFind(this.ctx)
  }
}

class VbaFind {
  private text = ''
  private rep: string | null = null
  private all = false
  private matchCase = false

  constructor(private readonly ctx: DocCtx) {}

  get Text(): string {
    return this.text
  }
  set Text(v: string) {
    this.text = String(v)
  }
  get Replacement(): { get Text(): string; set Text(v: string) } {
    const self = this
    return {
      get Text() {
        return self.rep ?? ''
      },
      set Text(v: string) {
        self.rep = String(v)
      },
    }
  }
  get MatchCase(): boolean {
    return this.matchCase
  }
  set MatchCase(v: boolean) {
    this.matchCase = !!v
  }
  set Forward(_v: boolean) {
    /* 只在文内向前找，没有向后的概念 */
  }
  set Wrap(_v: number) {
    /* 查找到末尾后不回头 */
  }
  set MatchWholeWord(_v: boolean) {
    /* 整词匹配没有实现：按子串找 */
  }

  /**
   * 执行查找/替换。VBA 的两种写法都支持：
   *   Selection.Find.Execute FindText:="old", ReplaceWith:="new", Replace:=wdReplaceAll
   *   With ActiveDocument.Content.Find : .Text = "old" : .Replacement.Text = "new" : .Execute
   * 命名实参会由转译层收成一个选项对象传进来（见 vba-emit.ts 的 callArgs）
   */
  Execute(...raw: unknown[]): boolean {
    let named: Record<string, unknown> = {}
    const pos: unknown[] = []
    for (const x of raw) {
      if (x !== null && typeof x === 'object' && !Array.isArray(x)) Object.assign(named, x)
      else pos.push(x)
    }
    const pick = (k: string, i: number): unknown => (named[k] !== undefined ? named[k] : pos[i])
    const f = String(pick('FindText', 0) ?? this.text ?? '')
    const repRaw = pick('ReplaceWith', 1)
    const rep = repRaw === undefined || repRaw === null ? this.rep : String(repRaw)
    const repArg = pick('Replace', 2)
    const all = repArg !== undefined && repArg !== null ? Number(repArg) === 2 : this.all
    if (!f) return false
    if (rep !== null) {
      if (all) {
        const n = this.ctx.api.replaceAll(f, rep)
        if (n) this.ctx.st.changed = true
        return n > 0
      }
      if (this.ctx.api.findNth(f, 0)) {
        this.ctx.api.replaceSelection(rep)
        this.ctx.st.changed = true
        return true
      }
      return false
    }
    return this.ctx.api.findNth(f, 0)
  }
}

class VbaSelection {
  constructor(private readonly ctx: DocCtx) {}

  private get sel(): { from: number; to: number } {
    const s = this.ctx.editor.state.selection
    return { from: s.from, to: s.to }
  }
  private setSel(from: number, to: number): void {
    this.ctx.editor.chain().focus().setTextSelection({ from, to }).run()
  }

  get Text(): string {
    return this.ctx.api.getSelection()
  }
  set Text(v: string) {
    this.ctx.api.replaceSelection(String(v))
    this.ctx.st.changed = true
  }
  get Start(): number {
    return this.ctx.map.posToChar(this.sel.from)
  }
  set Start(v: number) {
    this.setSel(this.ctx.map.charToPos(Number(v)), this.sel.to)
  }
  get End(): number {
    return this.ctx.map.posToChar(this.sel.to)
  }
  set End(v: number) {
    this.setSel(this.sel.from, this.ctx.map.charToPos(Number(v)))
  }
  get Type(): number {
    return this.sel.from === this.sel.to ? 0 : 1
  }
  get Range(): VbaRange {
    return new VbaRange(this.ctx, this.Start, this.End)
  }
  SetRange(s: number, e: number): void {
    this.setSel(this.ctx.map.charToPos(Number(s)), this.ctx.map.charToPos(Number(e)))
  }
  InsertBefore(s: string): void {
    this.ctx.api.replaceRange(this.sel.from, this.sel.from, String(s))
    this.ctx.st.changed = true
  }
  InsertAfter(s: string): void {
    this.ctx.api.replaceRange(this.sel.to, this.sel.to, String(s))
    this.ctx.st.changed = true
  }
  Delete(): void {
    const { from, to } = this.sel
    if (to > from) {
      this.ctx.api.replaceRange(from, to, '')
      this.ctx.st.changed = true
    }
  }
  Copy(): void {
    this.ctx.clip = this.Text
  }
  Paste(): void {
    this.Text = this.ctx.clip
  }
  Collapse(): void {
    const { from } = this.sel
    this.setSel(from, from)
  }
  get Find(): VbaFind {
    return new VbaFind(this.ctx)
  }
  TypeText(s: string): void {
    this.ctx.api.insert(String(s))
    this.ctx.st.changed = true
  }
  TypeParagraph(): void {
    this.ctx.api.insert('\n')
    this.ctx.st.changed = true
  }
}

class VbaDocument {
  constructor(private readonly ctx: DocCtx) {}

  get Name(): string {
    const p = this.ctx.path
    return p ? p.replace(/^.*[\\/]/, '') : '未命名文档'
  }
  get Path(): string {
    return this.ctx.path
  }
  get FullName(): string {
    return this.ctx.path
  }
  get Content(): VbaRange {
    return new VbaRange(this.ctx, 1, this.ctx.map.length + 1)
  }
  Range(s?: number, e?: number): VbaRange {
    const start = s === undefined ? 1 : Number(s)
    const end = e === undefined ? this.ctx.map.length + 1 : Number(e)
    return new VbaRange(this.ctx, start, end)
  }
  get Characters(): VbaColl<string> {
    return new VbaColl([...this.ctx.api.getText()])
  }
  get Words(): VbaColl<string> {
    return new VbaColl(this.ctx.api.getText().split(/[^\S]+/).filter(Boolean))
  }
  get Sentences(): VbaColl<string> {
    return new VbaColl(this.ctx.api.getText().split(/(?<=[.!?。！？])\s+/).filter(Boolean))
  }
  get Paragraphs(): VbaColl<string> {
    return new VbaColl(this.ctx.api.getText().split('\n'))
  }
  /** 保存由应用自己负责（自动保存 + Ctrl+S）：这里只告诉用户一声 */
  Save(): void {
    this.ctx.out.push('保存由应用负责（自动保存 / Ctrl+S），VBA 的 Save 这里不落盘')
  }
  SaveAs(): void {
    this.Save()
  }
  Close(): void {
    this.ctx.out.push('Close 没有实现：关标签页请在界面上关')
  }
  get Find(): VbaFind {
    return new VbaFind(this.ctx)
  }
}

class VbaDocuments {
  constructor(private readonly ctx: DocCtx) {}
  get Count(): number {
    return 1
  }
  Item(_i?: number): VbaDocument {
    return this.ctx.doc
  }
  Add(): VbaDocument {
    throw new Error('VBA：Documents.Add 没有实现（一次只编辑一篇文档）')
  }
  Open(): VbaDocument {
    throw new Error('VBA：Documents.Open 没有实现——打开文件请走界面的打开流程')
  }
}

// ── 工作簿对象模型（v0.134） ─────────────────────────────────────────────────
//
// Excel 那一侧。宿主是表格编辑器时活在这里；文档宿主里这些名字一概不存在
// （摸到了是一句"这个宿主没有 …"的错，不是一个看起来能用的空对象）。
//
// 四个要说清楚的取舍：
//
// 1. **集合是"带着属性的函数"。** VBA 的 `Worksheets` 既是集合也能当下标调：
//    `Worksheets.Count`、`Worksheets(1)`、`Worksheets("表1")`、`Worksheets.Item(1)`
//    四样都要通。JS 里就是一个挂了 `Count`/`Item` 属性的函数——调用面给集合，
//    属性面也给集合。`Rows`/`Columns`/`Cells`/`Item` 同理。
// 2. **`Value` 读出来是什么，看这片有多大。** 单格给标量；多格给 1 基的二维数组
//    （VBA 就是这样：`Range("A1:B2").Value` 是 (1 To 2, 1 To 2) 的数组）。
//    写回去时标量铺满整片、一维数组按行优先铺、二维数组逐格——与 Excel 对齐。
// 3. **`Address` 既是属性又是带参方法。** `rng.Address` 与 `rng.Address(0, 0)`
//    在 VBA 里都合法。JS 里给函数挂个 `toString`：当属性用时所有出口都走
//    `String()`（tostr/amp/比较/MsgBox 全都走它），带参用时直接调。
// 4. **`End(xlDown)` 这类真要扫格子**，扫的是 SheetMacroApi 的读口，不是猜的。
//    规则照 Excel：起点非空就走到最后一个非空；起点空就跳到这个方向上第一个
//    非空，一个都没有就给到这一版开辟出来的边界。

/** 取簿子；宿主是文字时报一句明白话 */
function bookOf(c: Ctx): SheetMacroApi {
  if (!c.book) {
    throw new Error(
      'VBA：这个宿主是文字文档，没有工作簿对象（Workbooks / Worksheets / Cells / Range 那一套属于表格宿主）',
    )
  }
  return c.book
}

/** 当前表名；没有活簿子或没有活动表时报错 */
function activeSheetOf(c: Ctx): string {
  const name = bookOf(c).activeSheet()
  if (!name) throw new Error('VBA：这个簿子里没有一张活动的工作表')
  return name
}

/** VBA 集合的下标：数字（1 基）或表名 */
type VbaIdx = number | string

/** `coll(i)`、`coll.Item(i)`、`coll.Count` 三面一体的集合。
 *  形参收 `unknown`：VBA 那边传进来的可能是数也可能是串，宽收再在里面分流 */
interface VbaCollFn<T> {
  (i: unknown): T
  Item(i: unknown): T
  readonly Count: number
}

/** 造一个"带着属性的函数"当集合用。`all` 给 For Each 用（VBA 的 For Each 对集合成立） */
function collFn<T>(get: (i: VbaIdx) => T, count: () => number, all?: () => T[]): VbaCollFn<T> {
  const f = ((i: unknown) => get(i as VbaIdx)) as VbaCollFn<T>
  f.Item = (i: unknown) => get(i as VbaIdx)
  Object.defineProperty(f, 'Count', { get: count, enumerable: true })
  if (all) Object.defineProperty(f, '__items', { value: all, enumerable: false })
  return f
}

/** 1 基一维数组。`rt.arr` 与"从 Range 读出来的二维数组"共用一份造法 */
function vbaArray(lo: number, hi: number): unknown[] {
  const a: unknown[] = new Array(Math.max(0, hi - lo + 1)).fill(EMPTY)
  Object.defineProperty(a, '__lo', { value: lo, enumerable: false, configurable: true })
  return a
}

/** 一个值要不要当公式写：VBA 里以 `=` 开头的串赋给 Value 就落成公式 */
function cellWriteOf(v: unknown): CellWrite {
  if (v === EMPTY || v === null) return null
  if (typeof v === 'string') return v.startsWith('=') ? { f: v } : v
  return v as string | number | boolean
}

/** VBA 的 `Address`：当属性用（`rng.Address`）与带参用（`rng.Address(0,0)`）都要通 */
interface VbaAddrFn {
  (rowAbsolute?: unknown, columnAbsolute?: unknown): string
  toString(): string
}

function addrFn(rect: () => SheetRect): VbaAddrFn {
  const f = ((rowAbsolute: unknown = true, columnAbsolute: unknown = true) =>
    rectToA1(rect(), truthy(rowAbsolute) && truthy(columnAbsolute))) as VbaAddrFn
  f.toString = () => rectToA1(rect(), true)
  return f
}

/** `Range.Cells` 那一个：`rng.Cells`、`rng.Cells(1)`、`rng.Cells(1,2)`、`rng.Cells.Count` */
interface VbaCellsFn {
  (row?: unknown, column?: unknown): VbaSheetRange
  Item(row?: unknown, column?: unknown): VbaSheetRange
  readonly Count: number
}

/**
 * 造一个 `Cells` 集合：调用面给下标，属性面给 Count/Item，
 * `__items` 给 For Each（`For Each c In rng.Cells` 在 Excel 里很常见）
 */
function cellsFn(at: (row?: unknown, column?: unknown) => VbaSheetRange, count: () => number, all?: () => VbaSheetRange[]): VbaCellsFn {
  const f = ((row?: unknown, column?: unknown) => at(row, column)) as VbaCellsFn
  f.Item = at
  Object.defineProperty(f, 'Count', { get: count, enumerable: true })
  if (all) Object.defineProperty(f, '__items', { value: all, enumerable: false })
  return f
}

/** Excel 的 Range：一张表上一片 0 基闭区间格子 */
class VbaSheetRange {
  constructor(
    private readonly c: Ctx,
    public readonly sheet: string,
    public readonly rect: SheetRect,
  ) {}

  private api(): SheetMacroApi {
    return bookOf(this.c)
  }

  private get rowCount(): number {
    return this.rect.r2 - this.rect.r1 + 1
  }

  private get colCount(): number {
    return this.rect.c2 - this.rect.c1 + 1
  }

  /** 这一版的边界（开辟出来的行列），整行整列与 End 的兜底都要用 */
  private bounds(): { rows: number; cols: number } {
    const s = this.api().sheetSize(this.sheet)
    return { rows: Math.max(1, s.rows), cols: Math.max(1, s.cols) }
  }

  /** 这一格里是不是"什么都没有"（VBA 的 Empty 格） */
  private isBlank(r: number, c: number): boolean {
    const v = this.api().readCell(this.sheet, r, c).v
    return v === null || v === ''
  }

  // —— 位置与形状 ——

  get Row(): number {
    return this.rect.r1 + 1
  }

  get Column(): number {
    return this.rect.c1 + 1
  }

  /** 格子数（Excel 的 `Range.Count`：A1:B2 是 4） */
  get Count(): number {
    return this.rowCount * this.colCount
  }

  get Address(): VbaAddrFn {
    return addrFn(() => this.rect)
  }

  /** 这一片在整张表里的行集合 */
  get Rows(): VbaCollFn<VbaSheetRange> {
    const self = this
    return collFn(
      (i) => self.rowAt(Number(i)),
      () => self.rowCount,
      () => Array.from({ length: self.rowCount }, (_, k) => self.rowAt(k + 1)),
    )
  }

  /** 这一片在整张表里的列集合 */
  get Columns(): VbaCollFn<VbaSheetRange> {
    const self = this
    return collFn(
      (i) => self.colAt(Number(i)),
      () => self.colCount,
      () => Array.from({ length: self.colCount }, (_, k) => self.colAt(k + 1)),
    )
  }

  /** 这一片里的格子集合：`rng.Cells(1,2)` 取这一片内的第 1 行第 2 列 */
  get Cells(): VbaCellsFn {
    const self = this
    const at = (row?: unknown, column?: unknown): VbaSheetRange => {
      const r = row === undefined ? 1 : Number(row)
      const cc = column === undefined ? 1 : Number(column)
      if (!Number.isFinite(r) || !Number.isFinite(cc) || r < 1 || cc < 1 || r > self.rowCount || cc > self.colCount) {
        throw new Error(`VBA：Cells(${row ?? ''}, ${column ?? ''}) 超出了这一片（${self.rowCount} 行 × ${self.colCount} 列）`)
      }
      return new VbaSheetRange(self.c, self.sheet, {
        r1: self.rect.r1 + r - 1,
        c1: self.rect.c1 + cc - 1,
        r2: self.rect.r1 + r - 1,
        c2: self.rect.c1 + cc - 1,
      })
    }
    return cellsFn(at, () => self.rowCount * self.colCount, () => [...self])
  }

  /** `rng.Item(1)` / `rng.Item(1, 2)`：这一片里的第几格（行优先） */
  Item(row?: unknown, column?: unknown): VbaSheetRange {
    if (column === undefined) {
      const n = Number(row)
      if (!Number.isFinite(n) || n < 1 || n > this.rowCount * this.colCount) {
        throw new Error(`VBA：Item(${row}) 超出了这一片（共 ${this.rowCount * this.colCount} 格）`)
      }
      const r = Math.floor((n - 1) / this.colCount)
      const cc = (n - 1) % this.colCount
      return new VbaSheetRange(this.c, this.sheet, {
        r1: this.rect.r1 + r,
        c1: this.rect.c1 + cc,
        r2: this.rect.r1 + r,
        c2: this.rect.c1 + cc,
      })
    }
    return this.Cells(row, column)
  }

  /** 整行（`rng.EntireRow`） */
  get EntireRow(): VbaSheetRange {
    const { cols } = this.bounds()
    return new VbaSheetRange(this.c, this.sheet, { r1: this.rect.r1, c1: 0, r2: this.rect.r1, c2: cols - 1 })
  }

  /** 整列（`rng.EntireColumn`） */
  get EntireColumn(): VbaSheetRange {
    const { rows } = this.bounds()
    return new VbaSheetRange(this.c, this.sheet, { r1: 0, c1: this.rect.c1, r2: rows - 1, c2: this.rect.c1 })
  }

  /** 挪几行几列（可为负）。挪出表外（第 0 行之前）按 Excel 的规矩报错 */
  Offset(rowOffset?: unknown, columnOffset?: unknown): VbaSheetRange {
    const dr = rowOffset === undefined ? 0 : Number(rowOffset)
    const dc = columnOffset === undefined ? 0 : Number(columnOffset)
    if (!Number.isFinite(dr) || !Number.isFinite(dc)) {
      throw new Error('VBA：Offset 的行距列距要是数')
    }
    const r1 = this.rect.r1 + dr
    const c1 = this.rect.c1 + dc
    if (r1 < 0 || c1 < 0) throw new Error(`VBA：Offset(${dr}, ${dc}) 挪出了表外（第 1 行/第 1 列之前）`)
    return new VbaSheetRange(this.c, this.sheet, {
      r1,
      c1,
      r2: r1 + this.rowCount - 1,
      c2: c1 + this.colCount - 1,
    })
  }

  /** 换成同样左上角的另一片大小 */
  Resize(rowSize?: unknown, columnSize?: unknown): VbaSheetRange {
    const rs = rowSize === undefined ? this.rowCount : Number(rowSize)
    const cs = columnSize === undefined ? this.colCount : Number(columnSize)
    if (!Number.isFinite(rs) || !Number.isFinite(cs) || rs < 1 || cs < 1) {
      throw new Error('VBA：Resize 的行数列数至少是 1')
    }
    return new VbaSheetRange(this.c, this.sheet, {
      r1: this.rect.r1,
      c1: this.rect.c1,
      r2: this.rect.r1 + rs - 1,
      c2: this.rect.c1 + cs - 1,
    })
  }

  /**
   * `End(xlDown)` 一族：从这一片的左上角朝一个方向找到数据块的尽头。
   * 规则照 Excel：起点非空就一路走到最后一个非空；起点是空的就跳到这个方向上
   * 第一个非空，一个都没有就给到这一版开辟出来的边界。
   */
  End(direction?: unknown): VbaSheetRange {
    const d = direction === undefined ? -4121 : Number(direction)
    const step: [number, number] =
      d === -4121 ? [1, 0] : d === -4162 ? [-1, 0] : d === -4161 ? [0, 1] : d === -4159 ? [0, -1] : [NaN, NaN]
    if (!Number.isFinite(step[0])) {
      throw new Error(`VBA：End 的方向认不出来（要 xlDown/xlUp/xlToLeft/xlToRight，给的是 ${direction}）`)
    }
    const { rows, cols } = this.bounds()
    const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols
    const cellAt = (r: number, c: number) => new VbaSheetRange(this.c, this.sheet, { r1: r, c1: c, r2: r, c2: c })
    // 一个非空都没有时，Excel 给的是这个方向上的最后一个格子
    const edge = (): VbaSheetRange => {
      const r = step[0] > 0 ? rows - 1 : step[0] < 0 ? 0 : this.rect.r1
      const c = step[1] > 0 ? cols - 1 : step[1] < 0 ? 0 : this.rect.c1
      return cellAt(r, c)
    }
    let r = this.rect.r1
    let c = this.rect.c1
    const startEmpty = this.isBlank(r, c)
    for (;;) {
      const nr = r + step[0]
      const nc = c + step[1]
      if (!inside(nr, nc)) return startEmpty ? edge() : cellAt(r, c)
      const blank = this.isBlank(nr, nc)
      if (startEmpty) {
        // 起点是空的：这个方向上第一个非空就是答案
        if (!blank) return cellAt(nr, nc)
      } else if (blank) {
        // 起点非空：撞上空格，上一个就是数据块的尽头
        return cellAt(r, c)
      }
      r = nr
      c = nc
    }
  }

  /** `CurrentRegion`：把这一片连着的非空块整个圈出来。没实现——扫法有歧义 */
  CurrentRegion(): VbaSheetRange {
    throw new Error('VBA：CurrentRegion 没有实现（连通块的边界在空行空列上怎么算有歧义，不猜）')
  }

  /** `SpecialCells`：按类型挑格子。没实现 */
  SpecialCells(): VbaSheetRange {
    throw new Error('VBA：SpecialCells 没有实现')
  }

  // —— 值 ——

  /** 单格给标量，多格给 1 基二维数组（Excel 就是这样） */
  get Value(): unknown {
    const g = this.api().readRange(this.sheet, this.rect)
    if (this.rowCount === 1 && this.colCount === 1) {
      const v = g[0]?.[0]?.v
      return v === null || v === '' ? EMPTY : v
    }
    const rows = vbaArray(1, g.length)
    const width = Math.max(0, ...g.map((row) => row.length))
    for (let r = 0; r < g.length; r++) {
      const row = vbaArray(1, width)
      for (let c = 0; c < width; c++) {
        const v = g[r]?.[c]?.v
        row[c] = v === null || v === '' ? EMPTY : v
      }
      rows[r] = row
    }
    return rows
  }

  set Value(v: unknown) {
    this.put(v, false)
  }

  /** 公式：单格给串，多格给 1 基二维串数组 */
  get Formula(): unknown {
    const g = this.api().readRange(this.sheet, this.rect)
    if (this.rowCount === 1 && this.colCount === 1) return g[0]?.[0]?.f ?? ''
    const rows = vbaArray(1, g.length)
    const width = Math.max(0, ...g.map((row) => row.length))
    for (let r = 0; r < g.length; r++) {
      const row = vbaArray(1, width)
      for (let c = 0; c < width; c++) row[c] = g[r]?.[c]?.f ?? ''
      rows[r] = row
    }
    return rows
  }

  set Formula(v: unknown) {
    this.put(v, true)
  }

  /** 显示值。这一版没有数字格式，所以 `Text` 就是 `Value` 的串形 */
  get Text(): unknown {
    const v = this.Value
    if (Array.isArray(v)) return v
    return tostr(v)
  }

  /** 把一份值铺进这一片。`formula` 为真时串一律当公式（要以 = 开头） */
  private put(v: unknown, formula: boolean): void {
    const rows = this.rowCount
    const cols = this.colCount
    let grid: CellWrite[][]
    if (Array.isArray(v) && v.length > 0 && Array.isArray(v[0])) {
      const src = v as unknown[][]
      if (src.length !== rows || src.some((row) => row.length !== cols)) {
        throw new Error(`VBA：数组是 ${src.length}×${src[0]?.length ?? 0}，这一片是 ${rows}×${cols}，对不上`)
      }
      grid = src.map((row) => row.map((cell) => (formula ? formulaWriteOf(cell) : cellWriteOf(cell))))
    } else if (Array.isArray(v)) {
      // 一维数组：按行优先铺满（Excel 要求尺寸一致，这里放宽一档，铺不满的留空）
      grid = []
      let k = 0
      for (let r = 0; r < rows; r++) {
        const row: CellWrite[] = []
        for (let c = 0; c < cols; c++) {
          const cell = v[k++]
          row.push(formula ? formulaWriteOf(cell) : cellWriteOf(cell))
        }
        grid.push(row)
      }
    } else {
      // 标量：铺满整片（Excel 的 `Range("A1:B2").Value = 5` 就是四格都写 5）
      const cell = formula ? formulaWriteOf(v) : cellWriteOf(v)
      grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => cell))
    }
    this.api().writeRange(this.sheet, this.rect.r1, this.rect.c1, grid)
    this.c.st.changed = true
  }

  /** 底色。VBA 的颜色是 BGR 长整型，这里在边界上换算成 `#rrggbb` */
  get Interior(): {
    get Color(): unknown
    set Color(v: unknown)
    get ColorIndex(): unknown
    set ColorIndex(v: unknown)
  } {
    const self = this
    return {
      get Color(): unknown {
        const hex = self.api().backgroundColor(self.sheet, self.rect)
        if (!hex) return EMPTY
        const bgr = hexToBgr(hex)
        return bgr === null ? EMPTY : bgr
      },
      set Color(v: unknown) {
        const n = tonum(v)
        if (n === null) throw new Error('VBA：Interior.Color 要的是颜色值（RGB(r,g,b) 或颜色常量）')
        self.api().setBackgroundColor(self.sheet, self.rect, bgrToHex(n))
        self.c.st.changed = true
      },
      get ColorIndex(): unknown {
        throw new Error('VBA：Interior.ColorIndex 没有实现（要的是调色板序号，这一版没有调色板）')
      },
      set ColorIndex(_v: unknown) {
        throw new Error('VBA：Interior.ColorIndex 没有实现（要的是调色板序号，这一版没有调色板）')
      },
    }
  }

  // —— 操作 ——

  /** 选中并激活这一片 */
  Select(): void {
    this.api().selectRange(this.sheet, this.rect)
  }

  /** Excel 的 Range 没有 Activate（那是单元格的），但宏里常写：与 Select 同义 */
  Activate(): void {
    this.Select()
  }

  /** 清值（公式一起清）。样式清不清得了取决于写入口，没验过就不吹 */
  ClearContents(): void {
    const rows = this.rowCount
    const cols = this.colCount
    this.api().writeRange(
      this.sheet,
      this.rect.r1,
      this.rect.c1,
      Array.from({ length: rows }, () => Array.from({ length: cols }, () => null)),
    )
    this.c.st.changed = true
  }

  /** 清值连样式。这一版的写入口只有 setValues，清不了样式——明说 */
  Clear(): void {
    this.ClearContents()
    this.c.out.push('Clear 清了值；样式这一版清不了（写入口只有 setValues 一个）')
  }

  /** 找第一个等于 What 的格子，找不到返回 null（`Set c = …Find(…)` 之后判 Is Nothing） */
  Find(What?: unknown): VbaSheetRange | null {
    const needle = tostr(What ?? '')
    if (!needle) throw new Error('VBA：Find 要找点什么（What 不能空）')
    const { rows, cols } = this.bounds()
    for (let r = this.rect.r1; r <= Math.min(this.rect.r2, rows - 1); r++) {
      for (let c = this.rect.c1; c <= Math.min(this.rect.c2, cols - 1); c++) {
        const v = this.api().readCell(this.sheet, r, c).v
        if (v !== null && tostr(v) === needle) {
          return new VbaSheetRange(this.c, this.sheet, { r1: r, c1: c, r2: r, c2: c })
        }
      }
    }
    return null
  }

  /** `Replace`：把这一片里等于 What 的全换成 Replacement，返回换了几格 */
  Replace(What?: unknown, Replacement?: unknown, lookAt?: unknown): number {
    const needle = tostr(What ?? '')
    if (!needle) throw new Error('VBA：Replace 要找点什么（What 不能空）')
    // LookAt 只认整格（xlWhole，1）；按包含（xlPart，2）没实现
    if (lookAt !== undefined && Number(lookAt) === 2) {
      throw new Error('VBA：Replace 的 LookAt:=xlPart（按包含换）没有实现，只按整格换')
    }
    const rep = tostr(Replacement ?? '')
    const { rows, cols } = this.bounds()
    let n = 0
    const grid: CellWrite[][] = []
    for (let r = this.rect.r1; r <= Math.min(this.rect.r2, rows - 1); r++) {
      const row: CellWrite[] = []
      for (let c = this.rect.c1; c <= Math.min(this.rect.c2, cols - 1); c++) {
        const cell = this.api().readCell(this.sheet, r, c)
        if (cell.v !== null && tostr(cell.v) === needle) {
          row.push(cellWriteOf(rep))
          n++
        } else row.push(cell.v)
      }
      grid.push(row)
    }
    if (n) {
      this.api().writeRange(this.sheet, this.rect.r1, this.rect.c1, grid)
      this.c.st.changed = true
    }
    return n
  }

  Copy(): void {
    throw new Error('VBA：Range.Copy 没有实现（剪贴板那一套没接）')
  }

  Cut(): void {
    throw new Error('VBA：Range.Cut 没有实现（剪贴板那一套没接）')
  }

  PasteSpecial(): void {
    throw new Error('VBA：Range.PasteSpecial 没有实现（剪贴板那一套没接）')
  }

  Merge(): void {
    throw new Error('VBA：Range.Merge 没有实现')
  }

  UnMerge(): void {
    throw new Error('VBA：Range.UnMerge 没有实现')
  }

  get NumberFormat(): string {
    throw new Error('VBA：Range.NumberFormat 没有实现（这一版的样式不走数字格式那一套）')
  }

  set NumberFormat(_v: string) {
    throw new Error('VBA：Range.NumberFormat 没有实现（这一版的样式不走数字格式那一套）')
  }

  get Font(): unknown {
    throw new Error('VBA：Range.Font 没有实现（字体那一套在表格侧还没接）')
  }

  set Font(_v: unknown) {
    throw new Error('VBA：Range.Font 没有实现（字体那一套在表格侧还没接）')
  }

  get Borders(): unknown {
    throw new Error('VBA：Range.Borders 没有实现（边框那一套在表格侧还没接）')
  }

  /** For Each 走这一片：行优先逐格 */
  *[Symbol.iterator](): IterableIterator<VbaSheetRange> {
    for (let r = this.rect.r1; r <= this.rect.r2; r++) {
      for (let c = this.rect.c1; c <= this.rect.c2; c++) {
        yield new VbaSheetRange(this.c, this.sheet, { r1: r, c1: c, r2: r, c2: c })
      }
    }
  }

  /** 这一片里的第 i 行（1 基）。**片内相对**：`Range("B2:D4").Rows(2)` 是 B3:D3，
   *  不是整行——整行是 Worksheet.Rows(2) 与 EntireRow 的事 */
  private rowAt(i: number): VbaSheetRange {
    const r = this.rect.r1 + i - 1
    return new VbaSheetRange(this.c, this.sheet, { r1: r, c1: this.rect.c1, r2: r, c2: this.rect.c2 })
  }

  /** 这一片里的第 i 列（1 基），同上：片内相对 */
  private colAt(i: number): VbaSheetRange {
    const c = this.rect.c1 + i - 1
    return new VbaSheetRange(this.c, this.sheet, { r1: this.rect.r1, c1: c, r2: this.rect.r2, c2: c })
  }
}

/** 公式赋值：串要以 `=` 开头，否则按 Excel 的规矩报错（不猜是不是公式） */
function formulaWriteOf(v: unknown): CellWrite {
  if (v === EMPTY || v === null) return null
  const s = tostr(v)
  if (!s.startsWith('=')) throw new Error(`VBA：公式要以 = 开头（给的是「${s}」）`)
  return { f: s }
}

/** Excel 的 Worksheet */
class VbaWorksheet {
  constructor(
    private readonly c: Ctx,
    public readonly name: string,
  ) {}

  private api(): SheetMacroApi {
    return bookOf(this.c)
  }

  get Name(): string {
    return this.name
  }

  /** 簿内第几张（1 基） */
  get Index(): number {
    return this.api().sheetNames().indexOf(this.name) + 1
  }

  /** 这一张表开辟出来的行列数 */
  get Rows(): VbaCollFn<VbaSheetRange> {
    const self = this
    const { rows } = self.size()
    return collFn(
      (i) => {
        const r = Number(i) - 1
        if (!Number.isFinite(r) || r < 0 || r >= rows) throw new Error(`VBA：没有第 ${i} 行（这一张表有 ${rows} 行）`)
        return new VbaSheetRange(self.c, self.name, { r1: r, c1: 0, r2: r, c2: self.size().cols - 1 })
      },
      () => rows,
      () => Array.from({ length: rows }, (_, k) => new VbaSheetRange(self.c, self.name, { r1: k, c1: 0, r2: k, c2: self.size().cols - 1 })),
    )
  }

  get Columns(): VbaCollFn<VbaSheetRange> {
    const self = this
    const { cols } = self.size()
    return collFn(
      (i) => {
        const c = Number(i) - 1
        if (!Number.isFinite(c) || c < 0 || c >= cols) throw new Error(`VBA：没有第 ${i} 列（这一张表有 ${cols} 列）`)
        return new VbaSheetRange(self.c, self.name, { r1: 0, c1: c, r2: self.size().rows - 1, c2: c })
      },
      () => cols,
      () => Array.from({ length: cols }, (_, k) => new VbaSheetRange(self.c, self.name, { r1: 0, c1: k, r2: self.size().rows - 1, c2: k })),
    )
  }

  /** `ws.Cells(1,2)`、`ws.Cells`、`ws.Cells.Count` */
  get Cells(): VbaCellsFn {
    const self = this
    const size = self.size()
    const at = (row?: unknown, column?: unknown): VbaSheetRange => {
      const r = row === undefined ? 1 : Number(row)
      const cc = column === undefined ? 1 : Number(column)
      if (!Number.isFinite(r) || !Number.isFinite(cc) || r < 1 || cc < 1 || r > size.rows || cc > size.cols) {
        throw new Error(`VBA：Cells(${row ?? ''}, ${column ?? ''}) 超出了这一张表（${size.rows} 行 × ${size.cols} 列）`)
      }
      return new VbaSheetRange(self.c, self.name, { r1: r - 1, c1: cc - 1, r2: r - 1, c2: cc - 1 })
    }
    return cellsFn(at, () => size.rows * size.cols, () => {
      const out: VbaSheetRange[] = []
      for (let r = 0; r < size.rows; r++) {
        for (let c = 0; c < size.cols; c++) out.push(new VbaSheetRange(self.c, self.name, { r1: r, c1: c, r2: r, c2: c }))
      }
      return out
    })
  }

  /** `ws.Range("A1")` / `ws.Range("A1", "B2")` */
  Range(a1?: unknown, a2?: unknown): VbaSheetRange {
    const size = this.size()
    const first = tostr(a1 ?? 'A1')
    const r1 = a1ToRect(first, size)
    if (!r1) throw new Error(`VBA：Range 认不出「${first}」这个地址（要 A1 或 B2:D4 这种）`)
    if (a2 === undefined) return new VbaSheetRange(this.c, this.name, r1)
    // 两点式：第二个参数是另一个角，两点围出来的矩形
    const second = tostr(a2)
    const r2 = a1ToRect(second, size)
    if (!r2) throw new Error(`VBA：Range 认不出「${second}」这个地址`)
    return new VbaSheetRange(this.c, this.name, {
      r1: Math.min(r1.r1, r2.r1),
      c1: Math.min(r1.c1, r2.c1),
      r2: Math.max(r1.r1, r2.r1),
      c2: Math.max(r1.c1, r2.c1),
    })
  }

  /** 有内容的格子围出来的最小矩形；空表返回 null（VBA 那边是个 Error） */
  get UsedRange(): VbaSheetRange | null {
    const u = this.api().usedRange(this.name)
    return u ? new VbaSheetRange(this.c, this.name, u) : null
  }

  /** 切到这一张表 */
  Activate(): void {
    if (!this.api().setActiveSheet(this.name)) {
      throw new Error(`VBA：切不到「${this.name}」这一张表`)
    }
  }

  Select(): void {
    this.Activate()
  }

  Delete(): void {
    throw new Error('VBA：Worksheet.Delete 没有实现（删表请在界面上删）')
  }

  Copy(): void {
    throw new Error('VBA：Worksheet.Copy 没有实现（复制表请在界面上做）')
  }

  Move(): void {
    throw new Error('VBA：Worksheet.Move 没有实现（挪表请在界面上做）')
  }

  get Visible(): boolean {
    throw new Error('VBA：Worksheet.Visible 没有实现（隐藏表这一版没有界面入口，也没有账）')
  }

  private size(): { rows: number; cols: number } {
    const s = this.api().sheetSize(this.name)
    return { rows: Math.max(1, s.rows), cols: Math.max(1, s.cols) }
  }
}

/** Excel 的 Workbook（这一版只有一本：当前打开的这一本） */
class VbaWorkbook {
  constructor(private readonly c: Ctx) {}

  private api(): SheetMacroApi {
    return bookOf(this.c)
  }

  /** 文件名（带扩展名）；没存过盘就是「未命名簿子」 */
  get Name(): string {
    const p = this.c.path
    return p ? p.replace(/^.*[\\/]/, '') : '未命名簿子'
  }

  get FullName(): string {
    return this.c.path
  }

  get Worksheets(): VbaCollFn<VbaWorksheet> {
    return this.sheetsOf('工作表')
  }

  /** Excel 的 Sheets 还含图表表；这一版两者同义（没有图表表这种东西） */
  get Sheets(): VbaCollFn<VbaWorksheet> {
    return this.sheetsOf('工作表')
  }

  private sheetsOf(label: string): VbaCollFn<VbaWorksheet> {
    const c = this.c
    const names = (): string[] => {
      const n = this.api().sheetNames()
      if (!n.length) throw new Error('VBA：这个簿子里一张工作表也没有')
      return n
    }
    const at = (i: VbaIdx): VbaWorksheet => {
      const list = names()
      if (typeof i === 'string') {
        if (!list.includes(i)) throw new Error(`VBA：没有名为「${i}」的${label}（有：${list.join('、')}）`)
        return new VbaWorksheet(c, i)
      }
      const n = Number(i)
      if (!Number.isFinite(n) || n < 1 || n > list.length) {
        throw new Error(`VBA：没有第 ${i} 张${label}（共 ${list.length} 张）`)
      }
      return new VbaWorksheet(c, list[n - 1])
    }
    return collFn(at, () => names().length, () => names().map((n) => new VbaWorksheet(c, n)))
  }

  /** 当前表 */
  get ActiveSheet(): VbaWorksheet {
    return new VbaWorksheet(this.c, activeSheetOf(this.c))
  }

  Save(): void {
    this.c.out.push('保存由应用负责（自动保存 / Ctrl+S），VBA 的 Save 这里不落盘')
  }

  SaveAs(): void {
    this.Save()
  }

  Close(): void {
    this.c.out.push('Close 没有实现：关标签页请在界面上关')
  }
}

/** Excel 的 Workbooks 集合：这一版 Count 恒为 1（同一时刻只开着一本簿子）。
 *  集合是"带着属性的函数"，所以 `Workbooks(1)`、`Workbooks.Item(1)`、`Workbooks.Count`
 *  三样都通；`Add`/`Open` 是方法，照旧报没实现 */
interface VbaWorkbooksColl {
  (i?: unknown): VbaWorkbook
  Item(i?: unknown): VbaWorkbook
  readonly Count: number
  Add(): VbaWorkbook
  Open(): VbaWorkbook
}

function workbooksOf(c: Ctx): VbaWorkbooksColl {
  const one = (): VbaWorkbook => new VbaWorkbook(c)
  const f = ((_i?: unknown) => one()) as VbaWorkbooksColl
  f.Item = () => one()
  f.Add = () => {
    throw new Error('VBA：Workbooks.Add 没有实现（新建簿子请走界面的新建）')
  }
  f.Open = () => {
    throw new Error('VBA：Workbooks.Open 没有实现——打开文件请走界面的打开流程')
  }
  Object.defineProperty(f, 'Count', { get: () => 1, enumerable: true })
  return f
}

// ── 转换与运算符 ─────────────────────────────────────────────────────────────

/** 取数值；取不到返回 null（"这不是个数"） */
function tonum(v: unknown): number | null {
  if (v === EMPTY || v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? -1 : 0 // VBA：True 转数是 -1
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return null
    const n = Number(t)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function tostr(v: unknown): string {
  if (v === EMPTY || v === null) return ''
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return String(v)
  return String(v)
}

/** VBA 的真假：0/''/null 假，其余真。字符串按"非空"算（VBA 在这儿会报类型错，
 *  放宽一档是为了不让 `If s <> "" Then` 之外的老写法直接炸） */
function truthy(v: unknown): boolean {
  if (v === EMPTY || v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0
  return true
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

/** VBA 的比较：两边都能转成数就按数比，否则按串比（大小写敏感，对应 Option Compare Binary） */
function pair(a: unknown, b: unknown): [number, number] | [string, string] {
  const an = tonum(a)
  const bn = tonum(b)
  if (an !== null && bn !== null) return [an, bn]
  return [tostr(a), tostr(b)]
}

function cmp(a: unknown, b: unknown): number {
  const p = pair(a, b)
  if (typeof p[0] === 'number') {
    const [x, y] = p as [number, number]
    return x < y ? -1 : x > y ? 1 : 0
  }
  const [x, y] = p as [string, string]
  return x < y ? -1 : x > y ? 1 : 0
}

/** VBA 的 Round 是四舍六入五成双（banker's rounding），不是 JS 的半入 */
function vbaRound(n: number, digits = 0): number {
  const f = Math.pow(10, digits)
  const x = n * f
  const r = Math.round(x)
  const d = x - Math.trunc(x)
  // 正好在中间：取邻近的偶数
  if (Math.abs(d) === 0.5) {
    const lo = Math.floor(x)
    const hi = Math.ceil(x)
    const pick = lo % 2 === 0 ? lo : hi
    return pick / f
  }
  return r / f
}

function need(v: unknown, what: string): number {
  const n = tonum(v)
  if (n === null) throw new Error(`VBA：${what}要求一个数，得到的却是「${tostr(v)}」`)
  return n
}

// ── 运行时总装 ───────────────────────────────────────────────────────────────

export interface VbaRuntime {
  C: Record<string, unknown>
  errMode: 'off' | 'resume'
  err: unknown
  /** 文档宿主的那几个；表格宿主里摸到它们是一句"这个宿主是表格"的错 */
  get ActiveDocument(): VbaDocument
  get ThisDocument(): VbaDocument
  /** 文档宿主是 Selection 对象，表格宿主是当前选区那片格子 */
  get Selection(): VbaSelection | VbaSheetRange
  get Documents(): VbaDocuments
  Application: Record<string, unknown>
  /** 表格宿主的那几个；文档宿主里摸到它们是一句"这个宿主是文字文档"的错 */
  get Workbooks(): VbaWorkbooksColl
  get ThisWorkbook(): VbaWorkbook
  get ActiveWorkbook(): VbaWorkbook
  get Worksheets(): VbaCollFn<VbaWorksheet>
  get Sheets(): VbaCollFn<VbaWorksheet>
  get ActiveSheet(): VbaWorksheet
  /** 表格宿主的全局寻址（Excel 里 `Range("A1")` 不带限定就是这么用的） */
  Range(a1?: unknown, a2?: unknown): VbaSheetRange
  Cells(row?: unknown, column?: unknown): VbaSheetRange
  Rows(i?: unknown): VbaSheetRange
  Columns(i?: unknown): VbaSheetRange
  Debug: { Print(...a: unknown[]): void }
  Err: { get Number(): number; get Description(): string; Clear(): void }
  /** `Dim c As New Collection` / `Dim d As New Dictionary` 用的构造器 */
  Collection: typeof VbaCollection
  Dictionary: typeof VbaDict
  // 转换
  num(v: unknown): number
  str(v: unknown): string
  b(v: unknown): boolean
  // 运算符
  add(a: unknown, b: unknown): number
  sub(a: unknown, b: unknown): number
  mul(a: unknown, b: unknown): number
  div(a: unknown, b: unknown): number
  idiv(a: unknown, b: unknown): number
  mod(a: unknown, b: unknown): number
  pow(a: unknown, b: unknown): number
  neg(v: unknown): number
  pos(v: unknown): number
  not(v: unknown): boolean
  and(a: unknown, b: unknown): unknown
  or(a: unknown, b: unknown): unknown
  xor(a: unknown, b: unknown): unknown
  eqv(a: unknown, b: unknown): boolean
  imp(a: unknown, b: unknown): boolean
  eq(a: unknown, b: unknown): boolean
  ne(a: unknown, b: unknown): boolean
  lt(a: unknown, b: unknown): boolean
  le(a: unknown, b: unknown): boolean
  gt(a: unknown, b: unknown): boolean
  ge(a: unknown, b: unknown): boolean
  cmp(a: unknown, b: unknown): number
  amp(a: unknown, b: unknown): string
  like(a: unknown, b: unknown): boolean
  isNothing(v: unknown): boolean
  isSame(a: unknown, b: unknown): boolean
  // 数组
  arr(lo: number, hi: number): unknown[]
  idx(a: unknown, ...i: number[]): unknown
  setIdx(a: unknown, i: number, v: unknown): void
  redim(a: unknown, lo: number, hi: number, preserve: boolean): unknown[]
  erase(a: unknown): void
  ubound(a: unknown, dim?: number): number
  lbound(a: unknown, dim?: number): number
  array(...v: unknown[]): unknown[]
  iter(c: unknown): unknown[]
  // 报错
  u(name: string): never
  miss(name: string, args: unknown[]): never
  nyi(name: string, ...args: unknown[]): never
  [k: string]: unknown
}

/** 造一份绑在当前编辑器上的 VBA 全局环境（**文档宿主**） */
export function createVbaRuntime(ctx: VbaCtx): VbaRuntime {
  const map = new TextMap(ctx.editor)
  // doc 要先有 c 才建得起来，c 又要拿着 doc 才能被各处引用：先占个位
  const c: Ctx = { ...ctx, map, clip: '', doc: undefined }
  const doc = new VbaDocument(c as DocCtx)
  c.doc = doc
  const selection = new VbaSelection(c as DocCtx)
  const documents = new VbaDocuments(c as DocCtx)
  return buildRuntime(c, { doc, selection, documents })
}

/** 造一份绑在当前工作簿上的 VBA 全局环境（**表格宿主**）。
 *  与文档宿主共用语言那一层，对象模型换成 Excel 那一套 */
export function createVbaBookRuntime(ctx: VbaBookCtx): VbaRuntime {
  const c: Ctx = {
    out: ctx.out,
    setStatus: ctx.setStatus,
    st: ctx.st,
    path: ctx.path,
    book: ctx.book,
    clip: '',
  }
  return buildRuntime(c, null)
}

/** 文档宿主那一侧的对象（表格宿主传 null） */
interface DocSide {
  doc: VbaDocument
  selection: VbaSelection
  documents: VbaDocuments
}

/** 两个宿主共用的内核：常量、运算符、内置函数、错误处理都一样，
 *  只有对象模型那一层按宿主分流 */
function buildRuntime(c: Ctx, docSide: DocSide | null): VbaRuntime {
  /** 摸文档对象而宿主是表格：一句明白话，不是空对象 */
  const needDoc = (): DocSide => {
    if (!docSide) {
      throw new Error('VBA：这个宿主是表格，没有文档对象（Documents / ActiveDocument / Selection 那一套属于文字宿主）')
    }
    return docSide
  }
  /** 摸工作簿对象而宿主是文字：同上 */
  const needBook = (): SheetMacroApi => {
    if (!c.book) {
      throw new Error(
        'VBA：这个宿主是文字文档，没有工作簿对象（Workbooks / Worksheets / Cells / Range 那一套属于表格宿主）',
      )
    }
    return c.book
  }
  /** 表格宿主的当前表（VBA 的 ActiveSheet） */
  const activeWs = (): VbaWorksheet => new VbaWorksheet(c, activeSheetOf(c))
  /** 表格宿主的当前选区（VBA 的 Selection / ActiveCell） */
  const sheetSel = (): VbaSheetRange => {
    const sel = c.book?.selection()
    const sheet = sel?.sheet ?? activeSheetOf(c)
    const rect = sel ?? { r1: 0, c1: 0, r2: 0, c2: 0 }
    return new VbaSheetRange(c, sheet, rect)
  }

  const rt: VbaRuntime = {
    C: {
      vbCrLf: '\r\n',
      vbCr: '\r',
      vbLf: '\n',
      vbTab: '\t',
      vbNullChar: '\0',
      vbNullString: '',
      vbEmpty: EMPTY,
      vbNull: null,
      vbTrue: true,
      vbFalse: false,
      vbOK: 1,
      vbYes: 6,
      vbNo: 7,
      vbCancel: 2,
      vbAbort: 3,
      vbRetry: 4,
      vbIgnore: 5,
      vbOKOnly: 0,
      vbOKCancel: 1,
      vbYesNo: 4,
      vbYesNoCancel: 3,
      vbRetryCancel: 5,
      vbQuestion: 32,
      vbExclamation: 48,
      vbInformation: 64,
      vbCritical: 16,
      vbDefaultButton1: 0,
      vbDefaultButton2: 256,
      vbDefaultButton3: 512,
      vbDefaultButton4: 768,
      vbSystemModal: 4096,
      vbObjectError: -2147221504,
      vbBinaryCompare: 0,
      vbTextCompare: 1,
      vbUseDefault: -2,
      vbSunday: 1,
      vbMonday: 2,
      vbTuesday: 3,
      vbWednesday: 4,
      vbThursday: 5,
      vbFriday: 6,
      vbSaturday: 7,
      vbFirstJan1: 1,
      vbFirstFourDays: 2,
      vbFirstFullWeek: 3,
      vbInteger: 2,
      vbLong: 3,
      vbSingle: 4,
      vbDouble: 5,
      vbCurrency: 6,
      vbDate: 7,
      vbString: 8,
      vbObject: 9,
      vbError: 10,
      vbBoolean: 11,
      vbVariant: 12,
      vbArray: 8192,
      wdReplaceNone: 0,
      wdReplaceOne: 1,
      wdReplaceAll: 2,
      wdFindContinue: 1,
      wdFindStop: 2,
      wdCollapseStart: 1,
      wdCollapseEnd: 0,
      wdCharacter: 1,
      wdWord: 2,
      wdSentence: 3,
      wdParagraph: 4,
      wdAlignParagraphLeft: 0,
      wdAlignParagraphCenter: 1,
      wdAlignParagraphRight: 2,
      wdAlignParagraphJustify: 3,
      // —— 颜色（VBA 的颜色是 BGR 长整型：vbRed 是 255 不是 0xFF0000）——
      vbBlack: 0,
      vbRed: 255,
      vbGreen: 65280,
      vbYellow: 65535,
      vbBlue: 16711680,
      vbMagenta: 16711935,
      vbCyan: 16776960,
      vbWhite: 16777215,
      // —— Excel 的方向与匹配常量（End / Find / Replace 用）——
      xlUp: -4162,
      xlDown: -4121,
      xlToLeft: -4159,
      xlToRight: -4161,
      xlWhole: 1,
      xlPart: 2,
      xlNone: -4142,
      xlAutomatic: -4105,
      xlSolid: 1,
    },
    errMode: 'off',
    err: null,
    get ActiveDocument(): VbaDocument {
      return needDoc().doc
    },
    get ThisDocument(): VbaDocument {
      return needDoc().doc
    },
    /** 表格宿主是当前选区那片格子；文档宿主是 Selection 对象 */
    get Selection(): VbaSelection | VbaSheetRange {
      return c.book ? sheetSel() : needDoc().selection
    },
    get Documents(): VbaDocuments {
      return needDoc().documents
    },
    // —— 表格宿主的全局对象（文档宿主摸到是一句"这个宿主是文字文档"）——
    get Workbooks(): VbaWorkbooksColl {
      needBook()
      return workbooksOf(c)
    },
    get ThisWorkbook(): VbaWorkbook {
      needBook()
      return new VbaWorkbook(c)
    },
    get ActiveWorkbook(): VbaWorkbook {
      needBook()
      return new VbaWorkbook(c)
    },
    get Worksheets(): VbaCollFn<VbaWorksheet> {
      needBook()
      return new VbaWorkbook(c).Worksheets
    },
    get Sheets(): VbaCollFn<VbaWorksheet> {
      needBook()
      return new VbaWorkbook(c).Sheets
    },
    get ActiveSheet(): VbaWorksheet {
      needBook()
      return activeWs()
    },
    Range(a1?: unknown, a2?: unknown): VbaSheetRange {
      needBook()
      return activeWs().Range(a1, a2)
    },
    Cells(row?: unknown, column?: unknown): VbaSheetRange {
      needBook()
      return activeWs().Cells(row, column)
    },
    Rows(i?: unknown): VbaSheetRange {
      needBook()
      return activeWs().Rows(i)
    },
    Columns(i?: unknown): VbaSheetRange {
      needBook()
      return activeWs().Columns(i)
    },
    Application: {
      get ActiveDocument(): VbaDocument {
        return needDoc().doc
      },
      get Selection(): unknown {
        return c.book ? sheetSel() : needDoc().selection
      },
      get Documents(): VbaDocuments {
        return needDoc().documents
      },
      get Workbooks(): VbaWorkbooksColl {
        needBook()
        return workbooksOf(c)
      },
      get ThisWorkbook(): VbaWorkbook {
        needBook()
        return new VbaWorkbook(c)
      },
      get ActiveWorkbook(): VbaWorkbook {
        needBook()
        return new VbaWorkbook(c)
      },
      get Worksheets(): VbaCollFn<VbaWorksheet> {
        needBook()
        return new VbaWorkbook(c).Worksheets
      },
      get Sheets(): VbaCollFn<VbaWorksheet> {
        needBook()
        return new VbaWorkbook(c).Sheets
      },
      get ActiveSheet(): VbaWorksheet {
        needBook()
        return activeWs()
      },
      get ActiveCell(): VbaSheetRange {
        needBook()
        const s = sheetSel()
        return new VbaSheetRange(c, s.sheet, { r1: s.rect.r1, c1: s.rect.c1, r2: s.rect.r1, c2: s.rect.c1 })
      },
      Range(a1?: unknown, a2?: unknown): VbaSheetRange {
        needBook()
        return activeWs().Range(a1, a2)
      },
      Cells(row?: unknown, column?: unknown): VbaSheetRange {
        needBook()
        return activeWs().Cells(row, column)
      },
      Rows(i?: unknown): VbaSheetRange {
        needBook()
        return activeWs().Rows(i)
      },
      Columns(i?: unknown): VbaSheetRange {
        needBook()
        return activeWs().Columns(i)
      },
      get CutCopyMode(): unknown {
        throw new Error('VBA：Application.CutCopyMode 没有实现（剪贴板那一套没接）')
      },
      Undo(): void {
        needBook().undo()
      },
      Redo(): void {
        needBook().redo()
      },
      Calculate(): void {
        throw new Error('VBA：Application.Calculate 没有实现（重算由公式引擎自己做）')
      },
      Name: 'OpenOffices',
      get Version(): string {
        return '0.134'
      },
    },
    Debug: {
      Print(...a: unknown[]): void {
        c.out.push(a.map((x) => (typeof x === 'string' ? x : tostr(x))).join('\t'))
      },
    },
    Collection: VbaCollection,
    Dictionary: VbaDict,
    Err: {
      get Number(): number {
        const e = rt.err as { number?: unknown } | null
        if (!e) return 0
        if (typeof e === 'object' && typeof (e as { number?: unknown }).number === 'number') return (e as { number: number }).number
        return -2147221504 // vbObjectError 之外的统一给个"出过事"的数
      },
      get Description(): string {
        return rt.err instanceof Error ? rt.err.message : String(rt.err ?? '')
      },
      Clear(): void {
        rt.err = null
      },
    },

    // —— 转换 ——
    num: (v) => need(v, '数值运算'),
    str: tostr,
    b: truthy,

    // —— 运算符 ——
    add: (a, x) => need(a, '+') + need(x, '+'),
    sub: (a, x) => need(a, '-') - need(x, '-'),
    mul: (a, x) => need(a, '*') * need(x, '*'),
    div: (a, x) => {
      const d = need(x, '/')
      if (d === 0) throw new Error('VBA：除以零')
      return need(a, '/') / d
    },
    idiv: (a, x) => {
      const d = need(x, '\\')
      if (d === 0) throw new Error('VBA：整数除以零')
      return Math.trunc(need(a, '\\') / d)
    },
    mod: (a, x) => {
      const d = need(x, 'Mod')
      if (d === 0) throw new Error('VBA：Mod 零')
      // VBA 的 Mod 取被除数的符号，与 JS 的 % 一致
      return need(a, 'Mod') % d
    },
    pow: (a, x) => Math.pow(need(a, '^'), need(x, '^')),
    neg: (v) => -need(v, '负号'),
    pos: (v) => need(v, '正号'),
    not: (v) => !truthy(v),
    and: (a, x) => (isInt(a) && isInt(x) ? (a as number) & (x as number) : truthy(a) && truthy(x)),
    or: (a, x) => (isInt(a) && isInt(x) ? (a as number) | (x as number) : truthy(a) || truthy(x)),
    xor: (a, x) => (isInt(a) && isInt(x) ? (a as number) ^ (x as number) : truthy(a) !== truthy(x)),
    eqv: (a, x) => truthy(a) === truthy(x),
    imp: (a, x) => !truthy(a) || truthy(x),
    eq: (a, x) => cmp(a, x) === 0,
    ne: (a, x) => cmp(a, x) !== 0,
    lt: (a, x) => cmp(a, x) < 0,
    le: (a, x) => cmp(a, x) <= 0,
    gt: (a, x) => cmp(a, x) > 0,
    ge: (a, x) => cmp(a, x) >= 0,
    cmp,
    // `&` 遇 Null（这里是 undefined/null）按空串算，不传播
    amp: (a, x) => tostr(a) + tostr(x),
    like: (a, x) => likeMatch(tostr(a), tostr(x)),
    isNothing: (v) => v === null || v === EMPTY,
    isSame: (a, x) => a === x,

    // —— 数组 ——
    arr: (lo, hi) => {
      const a: unknown[] = new Array(Math.max(0, hi - lo + 1)).fill(EMPTY)
      Object.defineProperty(a, '__lo', { value: lo, enumerable: false, configurable: true })
      return a
    },
    idx: (a, ...i) => {
      if (!Array.isArray(a)) {
        if (a === null || a === EMPTY) return EMPTY
        // 带默认属性的对象：`d("键")`（Dictionary）、`c(1)`（Collection）、
        // `rng(1, 1)`（Range 的第几格）。VBA 里这些写法都走默认成员，
        // 所以"能被下标"不等于"是数组"
        const item = (a as { Item?: unknown }).Item
        if (typeof item === 'function') return (item as (...x: unknown[]) => unknown).call(a, ...i)
        throw new Error('VBA：下标用在了不是数组的值上')
      }
      const lo = (a as unknown as { __lo?: number }).__lo ?? 0
      // 二维（`v(1, 2)`）：Range.Value 读出来的多格数组就是这形状。
      // 只认第一个下标的写法在 v0.134 之前会静默给错答案（把行当元素返回），
      // 所以这里按下标个数分流：一个下标当一维，两个当下标二维
      if (i.length >= 2) {
        const r = i[0] - lo
        const row = a[r]
        if (!Array.isArray(row)) throw new Error(`VBA：下标 ${i[0]},${i[1]} 用在了不是二维数组的值上`)
        const c = i[1] - lo
        if (c < 0 || c >= row.length) throw new Error(`VBA：下标 ${i[1]} 越界（${lo} 到 ${lo + row.length - 1}）`)
        return row[c]
      }
      const k = i[0] - lo
      if (k < 0 || k >= a.length) throw new Error(`VBA：下标 ${i[0]} 越界（${lo} 到 ${lo + a.length - 1}）`)
      return a[k]
    },
    setIdx: (a, i, v, j?: number) => {
      if (!Array.isArray(a)) throw new Error('VBA：下标赋值用在了不是数组的值上')
      const lo = (a as unknown as { __lo?: number }).__lo ?? 0
      if (j !== undefined) {
        const row = a[i - lo]
        if (!Array.isArray(row)) throw new Error(`VBA：下标 ${i},${j} 用在了不是二维数组的值上`)
        row[j - lo] = v
        return
      }
      a[i - lo] = v
    },
    redim: (a, lo, hi, preserve) => {
      if (!Array.isArray(a)) throw new Error('VBA：ReDim 用在了不是数组的值上')
      const old = preserve ? [...a] : []
      const oldLo = (a as unknown as { __lo?: number }).__lo ?? lo
      const next: unknown[] = new Array(Math.max(0, hi - lo + 1)).fill(EMPTY)
      for (let i = 0; i < next.length; i++) {
        const from = oldLo + i
        const j = from - oldLo
        if (preserve && j >= 0 && j < old.length) next[i] = old[j]
      }
      Object.defineProperty(next, '__lo', { value: lo, enumerable: false, configurable: true })
      return next
    },
    erase: (a) => {
      if (!Array.isArray(a)) throw new Error('VBA：Erase 用在了不是数组的值上')
      a.fill(EMPTY)
    },
    ubound: (a) => {
      if (!Array.isArray(a)) throw new Error('VBA：UBound 用在了不是数组的值上')
      const lo = (a as unknown as { __lo?: number }).__lo ?? 0
      return lo + a.length - 1
    },
    lbound: (a) => {
      if (!Array.isArray(a)) throw new Error('VBA：LBound 用在了不是数组的值上')
      return (a as unknown as { __lo?: number }).__lo ?? 0
    },
    array: (...v) => {
      const a: unknown[] = v.slice()
      Object.defineProperty(a, '__lo', { value: 0, enumerable: false, configurable: true })
      return a
    },
    iter: (x) => {
      if (x instanceof VbaColl) return x.items
      if (x instanceof VbaCollection) return x.all
      if (x instanceof VbaDict) return x.Keys
      // `For Each c In Range("A1:B2")`：行优先逐格
      if (x instanceof VbaSheetRange) return [...x]
      // `For Each ws In Worksheets`：集合是"带着属性的函数"，__items 里放着逐项
      if (typeof x === 'function') {
        const items = (x as { __items?: () => unknown[] }).__items
        if (items) return items()
      }
      if (Array.isArray(x)) return x
      if (typeof x === 'string') return [...x]
      throw new Error('VBA：For Each 用在了不能逐项走的值上')
    },

    // —— 报错 ——
    u: (name) => {
      throw new Error(`VBA：变量「${name}」没有声明过（VBA 无 Option Explicit 时会当空变量，这个子集要求先 Dim）`)
    },
    miss: (name) => {
      throw new Error(`VBA：没有名为「${name}」的过程或函数——这个子集没有实现它，或者与某处声明拼得不一致`)
    },
    nyi: (name) => {
      throw new Error(`VBA：函数「${name}」这个子集还没有实现`)
    },
  }

  // 字符串/数学/类型判断这批内置函数：直接摊到 rt 上
  Object.assign(rt, stringFns(rt, c), mathFns(), typeFns(), miscFns(c))
  return rt
}

// ── 内置函数 ─────────────────────────────────────────────────────────────────

function stringFns(rt: VbaRuntime, c: Ctx): Record<string, unknown> {
  const S = (v: unknown) => tostr(v)
  const N = (v: unknown) => need(v, '参数')
  return {
    len: (v: unknown) => S(v).length,
    left: (v: unknown, n: unknown) => S(v).slice(0, Math.max(0, N(n))),
    right: (v: unknown, n: unknown) => {
      const k = Math.max(0, N(n))
      return k === 0 ? '' : S(v).slice(-k)
    },
    mid: (v: unknown, start: unknown, len?: unknown) => {
      const s = S(v)
      const i = Math.max(1, N(start))
      return len === undefined ? s.slice(i - 1) : s.slice(i - 1, i - 1 + Math.max(0, N(len)))
    },
    trim: (v: unknown) => S(v).replace(/^ +| +$/g, ''),
    ltrim: (v: unknown) => S(v).replace(/^ +/, ''),
    rtrim: (v: unknown) => S(v).replace(/ +$/, ''),
    ucase: (v: unknown) => S(v).toUpperCase(),
    lcase: (v: unknown) => S(v).toLowerCase(),
    space: (n: unknown) => ' '.repeat(Math.max(0, N(n))),
    string: (n: unknown, ch: unknown) => {
      const k = Math.max(0, N(n))
      if (typeof ch === 'number') return String.fromCharCode(ch).repeat(k)
      const s = S(ch)
      return (s[0] ?? ' ').repeat(k)
    },
    strreverse: (v: unknown) => [...S(v)].reverse().join(''),
    // InStr 有两种形态：InStr(s1, s2) 与 InStr(start, s1, s2)
    instr: (...a: unknown[]) => {
      if (a.length >= 3) {
        const start = Math.max(1, N(a[0]))
        const at = S(a[1]).slice(start - 1).indexOf(S(a[2]))
        return at === -1 ? 0 : at + start
      }
      return S(a[0]).indexOf(S(a[1])) + 1
    },
    instrrev: (...a: unknown[]) => {
      const s1 = S(a[0])
      const s2 = S(a[1])
      return s1.lastIndexOf(s2) + 1
    },
    replace: (v: unknown, find: unknown, rep: unknown) => S(v).split(S(find)).join(S(rep)),
    split: (v: unknown, delim?: unknown) => {
      const d = delim === undefined ? ' ' : S(delim)
      const parts = S(v).split(d)
      return rt.array(...parts)
    },
    join: (a: unknown, delim?: unknown) => {
      const items = rt.iter(a)
      const d = delim === undefined ? ' ' : S(delim)
      return items.map((x) => S(x)).join(d)
    },
    chr: (n: unknown) => String.fromCharCode(N(n)),
    asc: (v: unknown) => {
      const s = S(v)
      if (!s) throw new Error('VBA：Asc 要求一个非空字符串')
      return s.charCodeAt(0)
    },
    hex: (v: unknown) => Math.trunc(N(v)).toString(16).toUpperCase(),
    oct: (v: unknown) => Math.trunc(N(v)).toString(8),
    val: (v: unknown) => {
      const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)/.exec(S(v))
      return m ? Number(m[0]) : 0
    },
    str: (v: unknown) => {
      const n = N(v)
      return (n >= 0 ? ' ' : '') + String(n) // VBA 的 Str 给正数留一个前导空格
    },
    // Format 只做最常见的几种格式串：0.00 / 0 / #,##0 / 0.0%，其余原样返回
    format: (v: unknown, f?: unknown) => {
      if (f === undefined || f === null) return S(v)
      const p = S(f)
      const n = N(v)
      if (/^0\.0+$/.test(p)) return n.toFixed(p.length - 2)
      if (/^0+$/.test(p)) return String(Math.trunc(n))
      if (/^#,##0(\.0+)?$/.test(p)) {
        const dec = /\.(\d+)/.exec(p)?.[1].length ?? 0
        return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
      }
      if (/^0(\.0+)?%$/.test(p)) {
        const dec = /\.(\d+)/.exec(p)?.[1].length ?? 0
        return `${(n * 100).toFixed(dec)}%`
      }
      return S(v)
    },
    msgbox: (prompt: unknown, _buttons?: unknown, _title?: unknown) => {
      c.out.push(`MsgBox：${S(prompt)}`)
      c.setStatus(`MsgBox：${S(prompt)}`)
      return 1
    },
    iif: (cond: unknown, t: unknown, f: unknown) => (truthy(cond) ? t : f),
    typename: (v: unknown) => {
      if (v === EMPTY) return 'Empty'
      if (v === null) return 'Nothing'
      if (Array.isArray(v)) return 'Variant()'
      if (v instanceof VbaColl || v instanceof VbaCollection) return 'Collection'
      if (v instanceof VbaDict) return 'Dictionary'
      if (v instanceof VbaRange) return 'Range'
      if (v instanceof VbaDocument) return 'Document'
      if (v instanceof VbaSelection) return 'Selection'
      switch (typeof v) {
        case 'string':
          return 'String'
        case 'number':
          return Number.isInteger(v) ? 'Long' : 'Double'
        case 'boolean':
          return 'Boolean'
        default:
          return 'Object'
      }
    },
    vartype: (v: unknown) => {
      const n = (rt.typename as (x: unknown) => string)(v)
      const cst = rt.C as Record<string, number>
      return cst[`vb${n.replace(/\(\)/, 'Array')}`] ?? 0
    },
    createobject: (name: unknown) => {
      const n = S(name).toLowerCase()
      if (n === 'scripting.dictionary') return new VbaDict()
      throw new Error(`VBA：CreateObject("${S(name)}") 没有实现`)
    },
    rnd: () => Math.random(),
  }
}

function mathFns(): Record<string, unknown> {
  const N = (v: unknown) => need(v, '参数')
  return {
    abs: (v: unknown) => Math.abs(N(v)),
    int: (v: unknown) => Math.floor(N(v)),
    fix: (v: unknown) => Math.trunc(N(v)),
    round: (v: unknown, d?: unknown) => vbaRound(N(v), d === undefined ? 0 : N(d)),
    sqr: (v: unknown) => {
      const n = N(v)
      if (n < 0) throw new Error('VBA：Sqr 不接受负数')
      return Math.sqrt(n)
    },
    sgn: (v: unknown) => Math.sign(N(v)),
  }
}

function typeFns(): Record<string, unknown> {
  const N = (v: unknown) => need(v, '参数')
  return {
    // 空白格在运行时里是 null / EMPTY（未初始化 variant）——这两样 `IsNumeric` 必须
    // 是 false，否则 `For i = 1 To N: If IsNumeric(Cells(i,1).Value)` 会把全空尾行
    // 全算成数。注意这与 `tonum(null)=0`（用于求和时不掉链子）是两回事。
    isnumeric: (v: unknown) => v !== null && v !== EMPTY && v !== '' && tonum(v) !== null,
    isempty: (v: unknown) => v === EMPTY,
    isnull: (v: unknown) => v === null || v === EMPTY,
    isarray: (v: unknown) => Array.isArray(v),
    isobject: (v: unknown) => typeof v === 'object' && v !== null,
    isdate: (v: unknown) => !Number.isNaN(Date.parse(tostr(v))),
    iserror: (v: unknown) => v instanceof Error,
    ismissing: () => false,
    date: () => new Date().toDateString(),
    time: () => new Date().toTimeString(),
    now: () => new Date(),
    year: (v: unknown) => new Date(N(v)).getFullYear(),
    month: (v: unknown) => new Date(N(v)).getMonth() + 1,
    day: (v: unknown) => new Date(N(v)).getDate(),
    hour: (v: unknown) => new Date(N(v)).getHours(),
    minute: (v: unknown) => new Date(N(v)).getMinutes(),
    second: (v: unknown) => new Date(N(v)).getSeconds(),
    weekday: (v: unknown) => new Date(N(v)).getDay() + 1,
  }
}

function miscFns(c: Ctx): Record<string, unknown> {
  const N = (v: unknown) => need(v, '参数')
  return {
    cstr: (v: unknown) => tostr(v),
    cint: (v: unknown) => vbaRound(N(v)),
    clng: (v: unknown) => Math.trunc(N(v)),
    cdbl: (v: unknown) => N(v),
    csng: (v: unknown) => N(v),
    cbool: (v: unknown) => truthy(v),
    cbyte: (v: unknown) => Math.trunc(N(v)) & 0xff,
    cdate: (v: unknown) => {
      const d = new Date(tostr(v))
      if (Number.isNaN(d.getTime())) throw new Error(`VBA：CDate 认不出「${tostr(v)}」这个日期`)
      return d
    },
    environ: () => '',
    inputbox: (prompt: unknown) => {
      c.out.push(`InputBox：${tostr(prompt)}（这个子集没有输入框，返回空）`)
      return ''
    },
    // VBA 的颜色是 BGR 长整型：RGB(255,0,0) 是 255 而不是 0xFF0000。
    // 这一版表格侧的 Interior.Color 就吃这个数（适配层再换算成 #rrggbb）
    rgb: (r: unknown, g: unknown, b: unknown) => {
      const R = Math.trunc(N(r)) & 0xff
      const G = Math.trunc(N(g)) & 0xff
      const B = Math.trunc(N(b)) & 0xff
      return R | (G << 8) | (B << 16)
    },
  }
}

/** VBA 的 Like：`*` 任意串、`?` 任意单字符、`#` 任意数字，其余按字面 */
function likeMatch(s: string, pat: string): boolean {
  let re = ''
  for (const ch of pat) {
    if (ch === '*') re += '[\\s\\S]*'
    else if (ch === '?') re += '[\\s\\S]'
    else if (ch === '#') re += '[0-9]'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`).test(s)
}
