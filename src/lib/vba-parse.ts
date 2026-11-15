// VBA 子集 · 第二层：语法（v0.131）
//
// 手写递归下降。产出 AST，交给 vba-emit.ts 生成 JS。
//
// 为什么不用正则逐行翻：VBA 的语句边界本来就不在行上（续行、`:` 分隔、
// 单行 If），表达式里还嵌着比较与连接两种完全不同的 `=` 和 `&`。
// 逐行替换在第 N 条宏上一定出错，而报出来的错还不是真错的地方。
//
// 这一层支持的东西（以及为什么不支持别的）：
//   支持  Sub / Function（含 Optional、ParamArray）、Dim / Const / Static、
//         赋值与 Set 赋值、If/ElseIf/Else（块与单行两种）、For/Next、
//         For Each/Next、Do/Loop（四种变体）、While/Wend、Select Case、
//         With、Exit、Call、ReDim/Erase、On Error Resume Next / GoTo 0
//   不支持  GoTo / GoSub / Return（标签跳转）、Type、Class/Module、
//         Property、Enum、Declare、二维以上数组、行号、日期字面量
//         ——这些要么要一座状态机，要么要一整套对象模型。撞上了就报带行号的错，
//         不猜、不静默跳过：猜出来的行为比报错更难查。

import { lexStatements, VbaError, type RawStmt, type Tok } from './vba-lex'

// ── AST ──────────────────────────────────────────────────────────────────────

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'name'; id: string }
  | { k: 'member'; obj: Expr | null; name: string }
  | { k: 'call'; callee: Expr; args: Expr[]; /** 与 args 平行的命名实参名（位置实参处为 undefined） */ names?: (string | undefined)[] }
  | { k: 'index'; obj: Expr; args: Expr[] }
  | { k: 'new'; type: string }
  | { k: 'nothing' }
  | { k: 'empty' }
  | { k: 'null' }
  | { k: 'un'; op: string; a: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr }

export type CaseTest =
  | { k: 'eq'; v: Expr }
  | { k: 'is'; op: string; v: Expr }
  | { k: 'range'; lo: Expr; hi: Expr }

export type Stmt =
  | { k: 'dim'; names: DimName[] }
  | { k: 'assign'; target: Expr; value: Expr; set: boolean }
  | { k: 'if'; cond: Expr; then: Stmt[]; elseifs: { cond: Expr; body: Stmt[] }[]; els: Stmt[] | null }
  | { k: 'for'; var: string; from: Expr; to: Expr; step: Expr | null; body: Stmt[] }
  | { k: 'foreach'; var: string; coll: Expr; body: Stmt[] }
  | { k: 'do'; pre: boolean; test: 'while' | 'until'; cond: Expr; body: Stmt[] }
  | { k: 'while'; cond: Expr; body: Stmt[] }
  | { k: 'select'; expr: Expr; cases: { tests: CaseTest[]; body: Stmt[] }[]; els: Stmt[] | null }
  | { k: 'with'; obj: Expr; body: Stmt[] }
  | { k: 'exit'; what: 'sub' | 'function' | 'for' | 'do' | 'while' }
  | { k: 'call'; call: Expr }
  | { k: 'redim'; name: string; lo: number; hi: number; preserve: boolean }
  | { k: 'erase'; name: string }
  | { k: 'onerror'; mode: 'resume' | 'off' }

export interface DimName {
  name: string
  /** 一维数组的 [下界, 上界]；undefined 表示不是数组 */
  bounds?: [number, number]
  /** As New Collection / Dictionary */
  newType?: string
  /** Const NAME = expr 带的初值 */
  init?: Expr
}

export interface Param {
  name: string
  isArray?: boolean
  /** Optional 形参：少传一个实参时用默认值补 */
  optional?: boolean
  /** Optional x = 5 的默认值 */
  init?: Expr
  /** ParamArray：收集剩下的实参 */
  rest?: boolean
}

export interface Proc {
  kind: 'sub' | 'function'
  name: string
  params: Param[]
  body: Stmt[]
}

export interface Module {
  procs: Proc[]
  /** 模块级 Dim 出来的变量 */
  globals: DimName[]
  /** Option Base 0|1：Dim a(n) 的隐含下界 */
  base: number
}

// ── 小工具 ───────────────────────────────────────────────────────────────────

const low = (t: Tok | undefined) => (t ? t.v.toLowerCase() : '')

/** 顶层（括号外）找一个运算符 token 的下标；找不到返回 -1 */
function findTop(toks: Tok[], from: number, pred: (t: Tok) => boolean): number {
  let depth = 0
  for (let i = from; i < toks.length; i++) {
    const t = toks[i]
    if (t.k === 'op') {
      if (t.v === '(') depth++
      else if (t.v === ')') depth = Math.max(0, depth - 1)
      else if (depth === 0 && pred(t)) return i
    }
  }
  return -1
}

// ── 表达式解析 ────────────────────────────────────────────────────────────────

class ExprParser {
  private p = 0
  /**
   * 语句级解析。两种差别都由 VBA 的语法决定：
   *   - 前导点（`.Name`）是 With 块里的引用，只在语句级合法
   *   - `Debug.Print .Name` 里那个带空格的 `.` 不是属性链的一环，
   *     而是实参的起点——语句级要把链在这儿掐断
   */
  constructor(
    private readonly toks: Tok[],
    private readonly line: number,
    /** 已知是数组的名字：`name(...)` 才算下标而不是调用 */
    private readonly arrays: Set<string>,
    private readonly stmt = false,
  ) {}

  /** 是否把整串吃光了（调用方据此判断要不要按"无括号实参表"接龙） */
  get done(): boolean {
    return this.p >= this.toks.length
  }

  /** 吃到哪儿了（报"表达式念不完"时要用） */
  get pos(): number {
    return this.p
  }

  private peek(): Tok | undefined {
    return this.toks[this.p]
  }
  private take(): Tok {
    const t = this.toks[this.p++]
    if (!t) throw new VbaError('表达式在这儿断了', this.line)
    return t
  }
  private isOp(v: string): boolean {
    const t = this.peek()
    return !!t && t.k === 'op' && t.v === v
  }
  private isKw(v: string): boolean {
    const t = this.peek()
    return !!t && t.k === 'id' && t.v.toLowerCase() === v
  }
  private eatOp(v: string): boolean {
    if (this.isOp(v)) {
      this.p++
      return true
    }
    return false
  }
  private expectOp(v: string): void {
    if (!this.eatOp(v)) throw new VbaError(`这儿应该是「${v}」`, this.line)
  }
  private expectId(): string {
    const t = this.peek()
    if (!t || t.k !== 'id') throw new VbaError('这儿应该是名字', this.line)
    this.p++
    return t.v
  }

  parse(): Expr {
    return this.eqv()
  }

  /**
   * 只念"后缀链"：名字 + `.属性`/`(下标)`/`!属性`，不碰任何二元运算符。
   * 语句级调用（`Debug.Print .Name`、`MsgBox "hi"`）要先用它探出头来，
   * 剩下的才按实参表接——否则 `-2 ^ 2` 会被当成减法念掉。
   */
  parsePostfix(): Expr {
    return this.postfix(this.primary())
  }

  // 优先级从松到紧：Eqv/Imp → Xor → Or → And → Not → 比较 → & → +/- → */ \ Mod → ^ → 一元 → 后缀
  private eqv(): Expr {
    let l = this.xor()
    for (;;) {
      if (this.isKw('eqv') || this.isKw('imp')) {
        const op = this.take().v
        l = { k: 'bin', op, a: l, b: this.xor() }
      } else return l
    }
  }
  private xor(): Expr {
    let l = this.orL()
    while (this.isKw('xor')) {
      const op = this.take().v
      l = { k: 'bin', op, a: l, b: this.orL() }
    }
    return l
  }
  private orL(): Expr {
    let l = this.andL()
    while (this.isKw('or')) {
      const op = this.take().v
      l = { k: 'bin', op, a: l, b: this.andL() }
    }
    return l
  }
  private andL(): Expr {
    let l = this.notL()
    while (this.isKw('and')) {
      const op = this.take().v
      l = { k: 'bin', op, a: l, b: this.notL() }
    }
    return l
  }
  private notL(): Expr {
    // Not 比比较松：`Not a = b` 是 `Not (a = b)`
    if (this.isKw('not')) {
      this.take()
      return { k: 'un', op: 'Not', a: this.notL() }
    }
    return this.cmp()
  }
  private cmp(): Expr {
    let l = this.concat()
    for (;;) {
      if (this.isOp('=') || this.isOp('<>') || this.isOp('<') || this.isOp('<=') || this.isOp('>') || this.isOp('>=')) {
        const op = this.take().v
        l = { k: 'bin', op, a: l, b: this.concat() }
      } else if (this.isKw('like')) {
        this.take()
        l = { k: 'bin', op: 'Like', a: l, b: this.concat() }
      } else if (this.isKw('is')) {
        this.take()
        l = { k: 'bin', op: 'Is', a: l, b: this.concat() }
      } else return l
    }
  }
  private concat(): Expr {
    let l = this.add()
    while (this.isOp('&')) {
      this.take()
      l = { k: 'bin', op: '&', a: l, b: this.add() }
    }
    return l
  }
  private add(): Expr {
    let l = this.mul()
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.take().v
      l = { k: 'bin', op, a: l, b: this.mul() }
    }
    return l
  }
  private mul(): Expr {
    let l = this.unary()
    for (;;) {
      if (this.isOp('*') || this.isOp('/') || this.isOp('\\')) {
        const op = this.take().v
        l = { k: 'bin', op, a: l, b: this.unary() }
      } else if (this.isKw('mod')) {
        this.take()
        l = { k: 'bin', op: 'Mod', a: l, b: this.unary() }
      } else return l
    }
  }
  private unary(): Expr {
    if (this.isOp('-') || this.isOp('+')) {
      const op = this.take().v
      return { k: 'un', op, a: this.unary() }
    }
    return this.pow()
  }
  private pow(): Expr {
    const l = this.postfix(this.primary())
    // 右结合。一元负号比 ^ 紧（`-2^2` 按 `(-2)^2` 算，与 VB6 运行期一致；
    // MS 文档里的优先级表把 ^ 列在一元负号上面，那一栏在本子集的用例里几乎不出现）
    if (this.isOp('^')) {
      this.take()
      return { k: 'bin', op: '^', a: l, b: this.pow() }
    }
    return l
  }

  private primary(): Expr {
    const t = this.peek()
    if (!t) throw new VbaError('表达式不完整', this.line)
    // 前导点：With 块里的 `.Name`。只在语句级合法，别处给了也是清楚的错
    if (t.k === 'op' && t.v === '.') {
      this.take()
      const name = this.expectId()
      return { k: 'member', obj: null, name }
    }
    if (t.k === 'num') {
      this.take()
      return { k: 'num', v: t.n ?? Number(t.v) }
    }
    if (t.k === 'str') {
      this.take()
      return { k: 'str', v: t.v }
    }
    if (t.k === 'op' && t.v === '(') {
      this.take()
      const e = this.parse()
      this.expectOp(')')
      return e
    }
    if (t.k === 'id') {
      const w = t.v.toLowerCase()
      if (w === 'true' || w === 'false') {
        this.take()
        return { k: 'bool', v: w === 'true' }
      }
      if (w === 'nothing') {
        this.take()
        return { k: 'nothing' }
      }
      if (w === 'empty') {
        this.take()
        return { k: 'empty' }
      }
      if (w === 'null') {
        this.take()
        return { k: 'null' }
      }
      if (w === 'me') {
        this.take()
        return { k: 'name', id: 'ThisDocument' }
      }
      if (w === 'new') {
        this.take()
        const type = this.expectId()
        return { k: 'new', type }
      }
      this.take()
      return { k: 'name', id: t.v }
    }
    throw new VbaError(`表达式不该从「${t.v}」开始`, this.line)
  }

  private postfix(e: Expr): Expr {
    for (;;) {
      const t = this.peek()
      // 语句级：带空格的 `.` 不是属性链的一环。`Debug.Print .Name` 里的
      // `.Name` 是实参（With 引用），不是 Print 的属性
      if (t && t.k === 'op' && (t.v === '.' || t.v === '!') && this.stmt && t.sp) return e
      if (this.isOp('.') || this.isOp('!')) {
        this.take()
        const name = this.expectId()
        e = { k: 'member', obj: e, name }
        continue
      }
      if (this.isOp('(')) {
        const a = this.args()
        // 已知数组：`a(i)` 是下标。其余一律当调用——调用表达式出现在赋值
        // 左边时由语句层再翻成下标（`a(i) = v` 里的 a 也许是运行时才知道的数组）
        if (e.k === 'name' && this.arrays.has(e.id.toLowerCase())) e = { k: 'index', obj: e, args: a.values }
        else e = { k: 'call', callee: e, args: a.values, names: a.names }
        continue
      }
      return e
    }
  }

  /** 形参表：已吃掉左括号，这里吃到右括号为止。支持 `Name := expr` 命名实参 */
  args(): { values: Expr[]; names: (string | undefined)[] } {
    this.expectOp('(')
    const out: Expr[] = []
    const names: (string | undefined)[] = []
    if (this.isOp(')')) {
      this.take()
      return { values: out, names }
    }
    for (;;) {
      // 命名实参：名字 := 值。名字要留着——转译层据此生成一个选项对象，
      // 因为 `Execute Replace:=wdReplaceAll` 这种写法丢不得名字
      if (this.peek()?.k === 'id' && this.toks[this.p + 1]?.k === 'op' && this.toks[this.p + 1].v === ':=') {
        names.push(this.peek()!.v)
        this.p += 2
      } else {
        names.push(undefined)
      }
      out.push(this.parse())
      if (this.eatOp(',')) continue
      this.expectOp(')')
      return { values: out, names }
    }
  }

  /** 无括号实参表：`Selection.InsertBefore "x"` / `MsgBox "hi", vbOK` */
  bareArgs(): { values: Expr[]; names: (string | undefined)[] } {
    const out: Expr[] = []
    const names: (string | undefined)[] = []
    for (;;) {
      if (this.peek()?.k === 'id' && this.toks[this.p + 1]?.k === 'op' && this.toks[this.p + 1].v === ':=') {
        names.push(this.peek()!.v)
        this.p += 2
      } else {
        names.push(undefined)
      }
      out.push(this.parse())
      if (this.eatOp(',')) continue
      return { values: out, names }
    }
  }
}

// ── 语句/过程解析 ─────────────────────────────────────────────────────────────

/** 块结束子的认法：看一条语句的头两个 token */
function terminatorOf(st: RawStmt): string | null {
  const a = low(st.toks[0])
  const b = low(st.toks[1])
  if (a === 'end') {
    if (['if', 'sub', 'function', 'select', 'with', 'type', 'property', 'enum', 'module', 'class'].includes(b)) return `End ${b[0].toUpperCase()}${b.slice(1)}`
    return 'End'
  }
  if (a === 'elseif') return 'ElseIf'
  if (a === 'else') return 'Else'
  if (a === 'next') return 'Next'
  if (a === 'loop') return 'Loop'
  if (a === 'wend') return 'Wend'
  if (a === 'case') return b === 'else' ? 'Case Else' : 'Case'
  return null
}

export function parseVba(src: string): Module {
  const stmts = lexStatements(src)
  const p = new Parser(stmts)
  return p.module()
}

class Parser {
  private i = 0
  /** 本过程已登记的数组名（ Dim a(n) / ReDim / a = Array(...) ） */
  private arrays = new Set<string>()
  /** 模块级登记过的数组名，每个过程开头都继承一份 */
  private moduleArrays = new Set<string>()
  /** Option Base 0|1：Dim a(n) 的隐含下界 */
  private base = 0

  constructor(private readonly stmts: RawStmt[]) {}

  private peek(): RawStmt | undefined {
    return this.stmts[this.i]
  }
  private next(): RawStmt {
    const s = this.stmts[this.i++]
    if (!s) throw new VbaError('文件在块中间就结束了（少了闭合语句）', 0)
    return s
  }

  module(): Module {
    const procs: Proc[] = []
    const globals: DimName[] = []
    let explicit = false
    while (this.peek()) {
      const s = this.peek()!
      const a = low(s.toks[0])
      if (a === 'option') {
        const w = low(s.toks[1])
        if (w === 'base') {
          const n = s.toks[2]
          if (n?.k === 'num') this.base = n.n ?? 0
        } else if (w === 'explicit') explicit = true
        this.i++
        continue
      }
      if (a === 'sub' || a === 'function' || a === 'private' || a === 'public' || a === 'friend' || a === 'static') {
        const skip = a === 'private' || a === 'public' || a === 'friend' || a === 'static' ? 1 : 0
        const kw = low(s.toks[skip])
        if (kw !== 'sub' && kw !== 'function') throw new VbaError(`模块级只放得下 Sub / Function，不放「${s.toks[skip].v}」`, s.line)
        procs.push(this.proc(kw as 'sub' | 'function'))
        continue
      }
      if (a === 'dim' || a === 'const' || a === 'static') {
        const d = this.dim(s)
        globals.push(...d.names)
        for (const n of d.names) if (n.bounds) this.moduleArrays.add(n.name.toLowerCase())
        // 不吃掉这一条就永远停在这儿：while 会拿同一条 Dim 反复转，globals 也跟着无限长
        this.i++
        continue
      }
      if (a === 'end') throw new VbaError(`多出来的「End ${s.toks[1]?.v ?? ''}」`, s.line)
      if (a === 'rem') {
        this.i++
        continue
      }
      throw new VbaError('这一行在过程外面。VBA 的可执行语句必须写在 Sub / Function 里', s.line)
    }
    if (!procs.length) throw new VbaError('没找到任何 Sub / Function', 0)
    void explicit
    return { procs, globals, base: this.base }
  }

  private proc(kind: 'sub' | 'function'): Proc {
    const s = this.next()
    // 模块级登记过的数组在本过程里也认（模块级 Dim a(10) 之后过程里 a(i) 是下标）
    this.arrays = new Set<string>(this.moduleArrays)
    // 签名：Sub Name(Param As Type, ...) [As Type]
    let p = 1
    const name = s.toks[p]
    if (!name || name.k !== 'id') throw new VbaError('过程名缺失', s.line)
    p++
    const params: Param[] = []
    if (s.toks[p]?.k === 'op' && s.toks[p].v === '(') {
      p++
      while (p < s.toks.length && !(s.toks[p].k === 'op' && s.toks[p].v === ')')) {
        const pr = this.param(s.toks.slice(p), s.line)
        params.push(pr.param)
        p += pr.consumed
        if (s.toks[p]?.k === 'op' && s.toks[p].v === ',') p++
      }
      if (s.toks[p]?.k === 'op' && s.toks[p].v === ')') p++
    }
    // Function 的返回值类型在签名行尾，转译时用不上（JS 不声明类型）
    for (const pr of params) if (pr.isArray) this.arrays.add(pr.name.toLowerCase())
    const body = this.block(new Set([kind === 'sub' ? 'End Sub' : 'End Function']))
    // block() 只把结束子"看见"就返回，吃掉它是调用方的事——不吃掉的话
    // module() 会把它当成第二个过程的头，整份文件就散架了
    this.eatEnd(new Set([kind === 'sub' ? 'End Sub' : 'End Function']))
    return { kind, name: name.v, params, body }
  }

  /** 解析一个形参；返回吃掉了几个 token（调用方负责推进游标） */
  private param(toks: Tok[], line: number): { param: Param; consumed: number } {
    let p = 0
    let optional = false
    if (low(toks[p]) === 'optional') {
      optional = true
      p++
    }
    if (low(toks[p]) === 'byval' || low(toks[p]) === 'byref') p++
    const name = toks[p]
    if (!name || name.k !== 'id') throw new VbaError('形参名缺失', line)
    p++
    let isArray = false
    if (toks[p]?.k === 'op' && toks[p].v === '(') {
      // ParamArray args() / ByVal a() —— 只支持无上下界的一维
      const close = toks.findIndex((t, i) => i > p && t.k === 'op' && t.v === ')')
      if (close < 0) throw new VbaError('形参的数组括号没有闭合', line)
      isArray = true
      p = close + 1
    }
    if (low(toks[p]) === 'as') {
      p++
      if (low(toks[p]) === 'new') p++
      p++ // 类型名本身用不上
    }
    // Optional x = 5
    let dflt: Expr | undefined
    if (toks[p]?.k === 'op' && toks[p].v === '=') {
      p++
      const ep = new ExprParser(toks.slice(p), line, new Set<string>())
      dflt = ep.parse()
      p = toks.length
      optional = true
    }
    const param: Param = {
      name: name.v,
      ...(isArray ? { isArray } : {}),
      ...(optional ? { optional: true } : {}),
      ...(dflt ? { init: dflt } : {}),
      // ParamArray 只能是最后一个形参，且必须是数组形参
      ...(isArray && low(toks[0]) === 'paramarray' ? { rest: true } : {}),
    }
    return { param, consumed: p }
  }

  /** 解析一个块：吃到 ends 里任一结束子为止（结束子不消费，交给上层） */
  private block(ends: Set<string>): Stmt[] {
    const body: Stmt[] = []
    for (;;) {
      const s = this.peek()
      if (!s) throw new VbaError(`块没有闭合——少了 ${[...ends].join(' / ')}`, 0)
      const t = terminatorOf(s)
      if (t && ends.has(t)) return body
      body.push(this.stmt(this.next()))
    }
  }

  /** 消费掉一条块结束语句（Next / Loop / Wend / End With） */
  private eatEnd(ends: Set<string>): void {
    const s = this.peek()
    if (!s) throw new VbaError(`块没有闭合——少了 ${[...ends].join(' / ')}`, 0)
    const t = terminatorOf(s)
    if (!t || !ends.has(t)) throw new VbaError(`这儿该是 ${[...ends].join(' / ')}，却是「${s.toks.map((x) => x.v).join(' ')}」`, s.line)
    this.i++
  }

  private stmt(s: RawStmt): Stmt {
    const a = low(s.toks[0])
    switch (a) {
      case 'if':
        return this.ifStmt(s)
      case 'for':
        return this.forStmt(s)
      case 'do':
        return this.doStmt(s)
      case 'while':
        return this.whileStmt(s)
      case 'select':
        return this.selectStmt(s)
      case 'with':
        return this.withStmt(s)
      case 'dim':
      case 'static':
        return this.dim(s)
      case 'const':
        return this.dim(s)
      case 'set':
        return this.assign(s, 1, true)
      case 'let':
        return this.assign(s, 1, false)
      case 'exit':
        return this.exitStmt(s)
      case 'call':
        return this.callStmt(s)
      case 'redim':
        return this.redim(s)
      case 'erase':
        return this.erase(s)
      case 'on':
        return this.onError(s)
      case 'goto':
      case 'gosub':
      case 'return':
      case 'resume':
        throw new VbaError(`「${s.toks[0].v}」这个子集不支持：标签跳转要一座状态机，宁可不跑也别跑错`, s.line)
      case 'type':
      case 'enum':
      case 'property':
      case 'declare':
      case 'class':
      case 'module':
      case 'implements':
      case 'withevents':
      case 'raiseevent':
        throw new VbaError(`「${s.toks[0].v}」属于类模块/类型定义那一套，这个子集只有过程`, s.line)
      case 'end':
        throw new VbaError(`多出来的「End ${s.toks[1]?.v ?? ''}」`, s.line)
      default:
        return this.assignOrCall(s)
    }
  }

  // —— If / ElseIf / Else ──
  private ifStmt(s: RawStmt): Stmt {
    const thenAt = s.toks.findIndex((t, i) => i > 0 && low(t) === 'then')
    if (thenAt < 0) throw new VbaError('If 少了 Then', s.line)
    const condToks = s.toks.slice(1, thenAt)
    if (!condToks.length) throw new VbaError('If 后面没有条件', s.line)
    const cond = this.expr(condToks, s.line)
    const rest = s.toks.slice(thenAt + 1)
    // 单行 If：Then 后面还有东西。可以再带一个 Else
    if (rest.length) {
      const elseAt = findTop(rest, 0, (t) => low(t) === 'else')
      const thenPart = elseAt < 0 ? rest : rest.slice(0, elseAt)
      const elsePart = elseAt < 0 ? null : rest.slice(elseAt + 1)
      const one = (toks: Tok[]): Stmt[] => [this.stmt({ toks, line: s.line, colon: false })]
      return {
        k: 'if',
        cond,
        then: one(thenPart),
        elseifs: [],
        els: elsePart && elsePart.length ? one(elsePart) : null,
      }
    }
    const body = this.block(new Set(['End If', 'ElseIf', 'Else']))
    const elseifs: { cond: Expr; body: Stmt[] }[] = []
    let els: Stmt[] | null = null
    for (;;) {
      const t = this.peek()
      if (!t) throw new VbaError('If 块没有闭合（少了 End If）', s.line)
      const kind = terminatorOf(t)
      if (kind === 'ElseIf') {
        this.i++
        const eThen = t.toks.findIndex((x) => low(x) === 'then')
        if (eThen < 0) throw new VbaError('ElseIf 少了 Then', t.line)
        const eCond = this.expr(t.toks.slice(1, eThen), t.line)
        elseifs.push({ cond: eCond, body: this.block(new Set(['End If', 'ElseIf', 'Else'])) })
        continue
      }
      if (kind === 'Else') {
        this.i++
        els = this.block(new Set(['End If']))
        continue
      }
      if (kind === 'End If') {
        this.i++
        break
      }
      throw new VbaError('If 块里出现了意外的结束子', t.line)
    }
    return { k: 'if', cond, then: body, elseifs, els }
  }

  // —— For / For Each ──
  private forStmt(s: RawStmt): Stmt {
    if (low(s.toks[1]) === 'each') {
      const varName = s.toks[2]
      if (!varName || varName.k !== 'id') throw new VbaError('For Each 后面应该是变量名', s.line)
      if (low(s.toks[3]) !== 'in') throw new VbaError('For Each 少了 In', s.line)
      const coll = this.expr(s.toks.slice(4), s.line)
      const body = this.block(new Set(['Next']))
      this.eatEnd(new Set(['Next']))
      return { k: 'foreach', var: varName.v, coll, body }
    }
    const varName = s.toks[1]
    if (!varName || varName.k !== 'id') throw new VbaError('For 后面应该是变量名', s.line)
    if (!(s.toks[2]?.k === 'op' && s.toks[2].v === '=')) throw new VbaError('For 少了 =', s.line)
    const toAt = s.toks.findIndex((t, i) => i > 2 && low(t) === 'to')
    if (toAt < 0) throw new VbaError('For 少了 To', s.line)
    const from = this.expr(s.toks.slice(3, toAt), s.line)
    const stepAt = s.toks.findIndex((t, i) => i > toAt && low(t) === 'step')
    const toToks = stepAt < 0 ? s.toks.slice(toAt + 1) : s.toks.slice(toAt + 1, stepAt)
    const to = this.expr(toToks, s.line)
    const step = stepAt < 0 ? null : this.expr(s.toks.slice(stepAt + 1), s.line)
    const body = this.block(new Set(['Next']))
    this.eatEnd(new Set(['Next']))
    return { k: 'for', var: varName.v, from, to, step, body }
  }

  // —— Do / Loop ──
  private doStmt(s: RawStmt): Stmt {
    let pre = false
    let test: 'while' | 'until' = 'while'
    let cond: Expr = { k: 'bool', v: true }
    const w = low(s.toks[1])
    if (w === 'while' || w === 'until') {
      pre = true
      test = w
      cond = this.expr(s.toks.slice(2), s.line)
    }
    const body = this.block(new Set(['Loop']))
    const lp = this.next()
    if (terminatorOf(lp) !== 'Loop') throw new VbaError('Do 块该以 Loop 收尾', lp.line)
    const w2 = low(lp.toks[1])
    if (w2 === 'while' || w2 === 'until') {
      test = w2
      cond = this.expr(lp.toks.slice(2), lp.line)
      pre = false
    } else if (lp.toks.length > 1) {
      throw new VbaError('Loop 后面只该是 While / Until', lp.line)
    }
    return { k: 'do', pre, test, cond, body }
  }

  private whileStmt(s: RawStmt): Stmt {
    const cond = this.expr(s.toks.slice(1), s.line)
    const body = this.block(new Set(['Wend']))
    this.eatEnd(new Set(['Wend']))
    return { k: 'while', cond, body }
  }

  // —— Select Case ──
  private selectStmt(s: RawStmt): Stmt {
    if (low(s.toks[1]) !== 'case') throw new VbaError('Select 后面应该是 Case', s.line)
    const expr = this.expr(s.toks.slice(2), s.line)
    const cases: { tests: CaseTest[]; body: Stmt[] }[] = []
    let els: Stmt[] | null = null
    for (;;) {
      const t = this.peek()
      if (!t) throw new VbaError('Select 块没有闭合（少了 End Select）', s.line)
      const kind = terminatorOf(t)
      if (kind === 'End Select') {
        this.i++
        break
      }
      if (kind !== 'Case' && kind !== 'Case Else') throw new VbaError('Select 块里只该出现 Case / End Select', t.line)
      this.i++
      if (kind === 'Case Else') {
        els = this.block(new Set(['Case', 'End Select']))
        continue
      }
      cases.push({ tests: this.caseTests(t), body: this.block(new Set(['Case', 'Case Else', 'End Select'])) })
    }
    return { k: 'select', expr, cases, els }
  }

  /** Case 后面的测试列表：`1`、`1 To 10`、`1, 2, 3`、`Is > 5`、`"a" To "z"` */
  private caseTests(s: RawStmt): CaseTest[] {
    const toks = s.toks.slice(1)
    const out: CaseTest[] = []
    let start = 0
    const cut = (to: number) => {
      const seg = toks.slice(start, to)
      start = to + 1
      if (!seg.length) throw new VbaError('Case 后面空着一项', s.line)
      if (low(seg[0]) === 'is') {
        const op = seg[1]
        if (!op || op.k !== 'op') throw new VbaError('Case Is 后面应该是比较符', s.line)
        out.push({ k: 'is', op: op.v, v: this.expr(seg.slice(2), s.line) })
        return
      }
      const toAt = seg.findIndex((t, i) => i > 0 && low(t) === 'to')
      if (toAt > 0) {
        out.push({ k: 'range', lo: this.expr(seg.slice(0, toAt), s.line), hi: this.expr(seg.slice(toAt + 1), s.line) })
        return
      }
      out.push({ k: 'eq', v: this.expr(seg, s.line) })
    }
    let depth = 0
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      if (t.k === 'op' && t.v === '(') depth++
      else if (t.k === 'op' && t.v === ')') depth = Math.max(0, depth - 1)
      else if (depth === 0 && t.k === 'op' && t.v === ',') cut(i)
    }
    cut(toks.length)
    return out
  }

  private withStmt(s: RawStmt): Stmt {
    const obj = this.expr(s.toks.slice(1), s.line)
    const body = this.block(new Set(['End With']))
    this.eatEnd(new Set(['End With']))
    return { k: 'with', obj, body }
  }

  private exitStmt(s: RawStmt): Stmt {
    const w = low(s.toks[1])
    if (w === 'sub' || w === 'function' || w === 'for' || w === 'do' || w === 'while') return { k: 'exit', what: w }
    throw new VbaError(`Exit ${s.toks[1]?.v ?? ''} 不认识`, s.line)
  }

  private callStmt(s: RawStmt): Stmt {
    // Call Name(a, b) —— 括号必须有
    const ep = new ExprParser(s.toks.slice(1), s.line, this.arrays)
    const callee = ep.parse()
    if (!ep.done) throw new VbaError('Call 后面应该是「过程名(实参)」', s.line)
    return { k: 'call', call: callee }
  }

  // —— Dim / Const / Static ──
  private dim(s: RawStmt): { k: 'dim'; names: DimName[] } {
    const isConst = low(s.toks[0]) === 'const'
    const names: DimName[] = []
    // 按顶层逗号切。注意 VBA 的老坑：`Dim a, b As Long` 里 As 只归最后一个
    const segs: Tok[][] = []
    let start = 1
    let depth = 0
    for (let i = 1; i < s.toks.length; i++) {
      const t = s.toks[i]
      if (t.k === 'op' && t.v === '(') depth++
      else if (t.k === 'op' && t.v === ')') depth = Math.max(0, depth - 1)
      else if (depth === 0 && t.k === 'op' && t.v === ',') {
        segs.push(s.toks.slice(start, i))
        start = i + 1
      }
    }
    segs.push(s.toks.slice(start))
    for (const seg of segs) {
      if (!seg.length) throw new VbaError('Dim 少了一个变量名', s.line)
      const nm = seg[0]
      if (nm.k !== 'id') throw new VbaError('Dim 后面应该是变量名', s.line)
      let p = 1
      let bounds: [number, number] | undefined
      let newType: string | undefined
      let init: Expr | undefined
      if (seg[p]?.k === 'op' && seg[p].v === '(') {
        const close = seg.findIndex((t, i) => i > p && t.k === 'op' && t.v === ')')
        if (close < 0) throw new VbaError('数组声明的括号没有闭合', s.line)
        const inner = seg.slice(p + 1, close)
        const toAt = inner.findIndex((t) => low(t) === 'to')
        if (inner.filter((t) => t.k === 'op' && t.v === ',').length) throw new VbaError('只支持一维数组（多维要一套下标换算，这个子集不做）', s.line)
        const loT = toAt < 0 ? [] : inner.slice(0, toAt)
        const hiT = toAt < 0 ? inner : inner.slice(toAt + 1)
        const lo = loT.length ? this.constNum(loT, s.line) : this.base
        const hi = this.constNum(hiT, s.line)
        if (hi < lo) throw new VbaError('数组上界比下界还小', s.line)
        bounds = [lo, hi]
        p = close + 1
        this.arrays.add(nm.v.toLowerCase())
      }
      if (low(seg[p]) === 'as') {
        p++
        if (low(seg[p]) === 'new') {
          p++
          newType = seg[p]?.v
          p++
        } else {
          p++ // 类型名本身用不上
        }
      }
      if (isConst) {
        if (!(seg[p]?.k === 'op' && seg[p].v === '=')) throw new VbaError('Const 后面应该是 = 初值', s.line)
        init = this.expr(seg.slice(p + 1), s.line)
      }
      names.push({ name: nm.v, ...(bounds ? { bounds } : {}), ...(newType ? { newType } : {}), ...(init ? { init } : {}) })
    }
    return { k: 'dim', names }
  }

  private constNum(toks: Tok[], line: number): number {
    const ep = new ExprParser(toks, line, new Set<string>())
    const e = ep.parse()
    if (e.k !== 'num') throw new VbaError('数组上下界必须是常数', line)
    return e.v
  }

  private redim(s: RawStmt): Stmt {
    let p = 1
    const preserve = low(s.toks[p]) === 'preserve'
    if (preserve) p++
    const nm = s.toks[p]
    if (!nm || nm.k !== 'id') throw new VbaError('ReDim 后面应该是数组名', s.line)
    p++
    if (!(s.toks[p]?.k === 'op' && s.toks[p].v === '(')) throw new VbaError('ReDim 少了 (上界)', s.line)
    const close = s.toks.findIndex((t, i) => i > p && t.k === 'op' && t.v === ')')
    if (close < 0) throw new VbaError('ReDim 的括号没有闭合', s.line)
    const inner = s.toks.slice(p + 1, close)
    const toAt = inner.findIndex((t) => low(t) === 'to')
    const lo = toAt < 0 ? this.base : this.constNum(inner.slice(0, toAt), s.line)
    const hi = this.constNum(toAt < 0 ? inner : inner.slice(toAt + 1), s.line)
    this.arrays.add(nm.v.toLowerCase())
    return { k: 'redim', name: nm.v, lo, hi, preserve }
  }

  private erase(s: RawStmt): Stmt {
    const nm = s.toks[1]
    if (!nm || nm.k !== 'id') throw new VbaError('Erase 后面应该是数组名', s.line)
    return { k: 'erase', name: nm.v }
  }

  private onError(s: RawStmt): Stmt {
    const w = low(s.toks[1])
    if (w !== 'error') throw new VbaError('On 后面只认 Error', s.line)
    const m = low(s.toks[2])
    if (m === 'resume' && low(s.toks[3]) === 'next') return { k: 'onerror', mode: 'resume' }
    if (m === 'goto' && s.toks[3]?.k === 'num' && s.toks[3].n === 0) return { k: 'onerror', mode: 'off' }
    if (m === 'goto' && s.toks[3]?.k === 'num' && s.toks[3].n !== 0) throw new VbaError('On Error GoTo 行号 不支持（那是老 Basic 的写法）', s.line)
    throw new VbaError('On Error 只支持 Resume Next 与 GoTo 0；GoTo 标签要一座状态机，这个子集不做', s.line)
  }

  // —— 赋值 / 调用 ──
  private assign(s: RawStmt, skip: number, set: boolean): Stmt {
    const eq = findTop(s.toks, skip, (t) => t.k === 'op' && t.v === '=')
    if (eq < 0) throw new VbaError(`${set ? 'Set' : '赋值'}语句少了 =`, s.line)
    const target = this.lvalue(s.toks.slice(skip, eq), s.line)
    const value = this.expr(s.toks.slice(eq + 1), s.line)
    return { k: 'assign', target, value, set }
  }

  /** 赋值左边：可能是名字、成员链、或 `a(i)` 这样的下标 */
  private lvalue(toks: Tok[], line: number): Expr {
    const ep = new ExprParser(toks, line, this.arrays, true)
    const e = ep.parsePostfix()
    if (!ep.done) throw new VbaError('赋值左边念不完', line)
    // `a(i) = v`：表达式层按调用念了，这里翻成下标，并把 a 登记成数组
    if (e.k === 'call' && e.callee.k === 'name') {
      this.arrays.add(e.callee.id.toLowerCase())
      return { k: 'index', obj: e.callee, args: e.args }
    }
    if (e.k === 'name' || e.k === 'member' || e.k === 'index') return e
    throw new VbaError('这儿不能赋值', line)
  }

  private assignOrCall(s: RawStmt): Stmt {
    const eq = findTop(s.toks, 0, (t) => t.k === 'op' && t.v === '=')
    if (eq > 0) {
      try {
        return this.assign(s, 0, false)
      } catch {
        // 左边不是个能赋值的东西：这大概是 `Debug.Print a = b` 那种
        // 把比较当实参传的写法。别把错漏出去，退回当调用语句念
      }
    }
    // 没有顶层 =：先只念后缀链探出头，剩下的按"无括号实参表"接上
    const ep = new ExprParser(s.toks, s.line, this.arrays, true)
    const head = ep.parsePostfix()
    if (ep.done) {
      if (head.k === 'name' || head.k === 'member') return { k: 'call', call: head }
      throw new VbaError('这一行只是个表达式，什么也没做', s.line)
    }
    if (head.k !== 'name' && head.k !== 'member') throw new VbaError('调用语句该是「过程名 实参」或「对象.方法 实参」', s.line)
    const a = ep.bareArgs()
    return { k: 'call', call: { k: 'call', callee: head, args: a.values, names: a.names } }
  }

  private expr(toks: Tok[], line: number): Expr {
    const ep = new ExprParser(toks, line, this.arrays)
    const e = ep.parse()
    if (!ep.done) throw new VbaError(`表达式念不完，剩下的「${toks.slice(ep.pos).map((t) => t.v).join(' ')}」不知道是什么`, line)
    return e
  }
}
