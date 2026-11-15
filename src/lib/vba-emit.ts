// VBA 子集 · 第三层：生成 JS（v0.131）
//
// AST → 一段 JS，跑在 macro.ts 的 `new Function` 里（同一个沙箱、同一份 api）。
// 这一层只做"翻译"，不做"执行"——所以它可以在 Node 里单测，不依赖编辑器。
//
// 几条转译上的规矩（都是为了不让生成出来的代码在边缘情况下意思变了）：
//
// 1. **所有标识符加 `$` 前缀**。VBA 的名字空间和 JS 不一样：`Function`、`New`、
//    `Delete`、`Class` 在 VBA 里是合法的变量名，在 JS 里是关键字。加前缀一刀切，
//    比维护一张"哪些 JS 关键字得躲"的表可靠。`$` 不是 VBA 标识符字符，不会撞。
//
// 2. **所有局部变量提升到函数顶部统一声明**。VBA 的过程体是顺序执行的，
//    `Dim` 出现在循环里意味着"这一轮重新初始化"；提升之后 `Dim` 就是一条普通赋值，
//    语义正好对上，也不会出现块级 `let` 遮住外层同名变量的事。
//
// 3. **运算符不直接映射，一律走运行时的辅助函数**。VBA 的 `&`、`=`、`And` 与 JS 的
//    同名符号意思不同（`&` 是字符串连接；`=` 是比较；`And` 不短路）。
//    直接照抄会得到"能跑但意思错了"的代码——那比报错糟得多。
//
// 4. **`On Error Resume Next` 展开成逐语句 try/catch**。VBA 的这个模式下错误
//    不中断流程，只有 `Err` 记得出过事。JS 里最近似的就是每条语句包一层。
//
// 5. **模块级变量放在同一个作用域里**，各过程闭包共享——和 VBA 的模块级 Dim 一致。

import type { CaseTest, DimName, Expr, Module, Param, Proc, Stmt } from './vba-parse'

export interface EmitResult {
  code: string
  /** 入口过程名（VBA 里没有"Main"概念，约定见 vba.ts） */
  entry: string
}

/** VBA 的全局对象：转译成 `__vba.X`。
 *  前七个是文档宿主的；后面一批（Workbooks/Worksheets/Cells/Range…）是表格宿主的
 *  全局寻址——Excel 里 `Range("A1")` 不带限定就是这么写的。在文档宿主里摸到它们，
 *  运行时给的是一句"这个宿主是文字文档"的错，比"没有名为 Range 的过程"明白 */
const GLOBALS = new Set([
  'activedocument', 'thisdocument', 'selection', 'documents', 'application', 'debug', 'err',
  'workbooks', 'thisworkbook', 'activeworkbook', 'worksheets', 'sheets', 'activesheet',
  'range', 'cells', 'rows', 'columns',
])

/** VBA 的全局常量：转译成 `__vba.C.X`。
 *  最后两组是 Excel 的：颜色常量（vbRed 是 255 不是 0xFF0000，颜色在 VBA 里是 BGR 长整型）
 *  与方向/匹配常量（End / Find / Replace 用） */
const CONSTS = new Set([
  'vbcrlf', 'vbcr', 'vblf', 'vbtab', 'vbnullchar', 'vbnullstring', 'vbempty', 'vbnull', 'vbtrue', 'vbfalse',
  'vbok', 'vbyes', 'vbno', 'vbcancel', 'vbabort', 'vbretry', 'vbignore', 'vbokonly', 'vbokcancel',
  'vbyesno', 'vbyesnocancel', 'vbretrycancel', 'vbquestion', 'vbexclamation', 'vbinformation', 'vbcritical',
  'vbdefaultbutton1', 'vbdefaultbutton2', 'vbdefaultbutton3', 'vbdefaultbutton4', 'vbsystemmodal',
  'vbobjecterror', 'vbbinarycompare', 'vbtextcompare', 'vbusedefault', 'vbgeneraldate', 'vblongdate',
  'vbshortdate', 'vblongtime', 'vbshorttime', 'vbsunday', 'vbmonday', 'vbtuesday', 'vbwednesday',
  'vbthursday', 'vbfriday', 'vbsaturday', 'vbfirstjan1', 'vbfirstfourdays', 'vbfirstfullweek',
  'vbmethod', 'vbget', 'vblet', 'vbset', 'vbunicode', 'vbfromunicode', 'vbstring', 'vbinteger',
  'vblong', 'vbsingle', 'vbdouble', 'vbcurrency', 'vbdate', 'vbvariant', 'vbdecimal', 'vbbyte',
  'vbboolean', 'vbobject', 'vberror', 'vbarray', 'vbdataobject',
  'wdreplaceall', 'wdreplaceone', 'wdreplacenone', 'wdfindcontinue', 'wdfindstop',
  'wdcollapsestart', 'wdcollapseend', 'wdcharacter', 'wdword', 'wdsentence', 'wdparagraph',
  'wdalignparagraphleft', 'wdalignparagraphcenter', 'wdalignparagraphright', 'wdalignparagraphjustify',
  'vbblack', 'vbred', 'vbgreen', 'vbyellow', 'vbblue', 'vbmagenta', 'vbcyan', 'vbwhite',
  'xlup', 'xldown', 'xltoleft', 'xltoright', 'xlwhole', 'xlpart', 'xlnone', 'xlautomatic', 'xlsolid',
])

/** 运行时内置函数名（小写）→ `__vba.X` */
const BUILTINS = new Set([
  'len', 'lenb', 'left', 'leftb', 'right', 'rightb', 'mid', 'midb', 'trim', 'ltrim', 'rtrim',
  'ucase', 'lcase', 'space', 'string', 'strreverse', 'instr', 'instrrev', 'replace', 'split', 'join',
  'chr', 'chrb', 'asc', 'ascb', 'abs', 'int', 'fix', 'round', 'sqr', 'rnd', 'sgn', 'exp', 'log',
  'sin', 'cos', 'tan', 'atn', 'cstr', 'cint', 'clng', 'cdbl', 'csng', 'cbool', 'cdate', 'ccur',
  'cdec', 'cvar', 'cbyte', 'isnumeric', 'isempty', 'isnull', 'isarray', 'isobject',
  'isdate', 'iserror', 'ismissing', 'ubound', 'lbound', 'array', 'msgbox', 'inputbox', 'format',
  'val', 'str', 'hex', 'oct', 'iif', 'choose', 'switch',
  'typename', 'vartype', 'createobject', 'environ', 'date', 'time', 'now', 'timer',
  'year', 'month', 'day', 'hour', 'minute', 'second', 'weekday', 'dateadd', 'datediff', 'datepart',
  'dateserial', 'datevalue', 'timevalue', 'monthname', 'weekdayname', 'partition',
  'getobject', 'getref', 'shell', 'dir', 'curdir', 'mkdir', 'rmdir', 'kill', 'name',
  'freefile', 'loc', 'eof', 'lof', 'filelen', 'fileattr', 'filecopy',
  'rgb',
])

/** 认得但不实现：报"没实现"而不是"不存在"——这两个错不是一回事 */
const NYI = new Set([
  'shell', 'dir', 'curdir', 'mkdir', 'rmdir', 'kill', 'name', 'freefile', 'loc', 'eof', 'lof',
  'filelen', 'fileattr', 'filecopy', 'getobject', 'getref', 'environ', 'partition', 'timer',
  'cdec', 'ccur', 'dateserial', 'datevalue', 'timevalue', 'dateadd', 'datediff',
  'datepart', 'monthname', 'weekdayname', 'choose', 'switch', 'exp', 'log',
  'sin', 'cos', 'tan', 'atn', 'val', 'str', 'hex', 'oct', 'inputbox', 'cdate',
])

class Emitter {
  private out: string[] = []
  private ind = 0
  /** 当前过程 + 模块级的局部名（小写） */
  private locals = new Set<string>()
  private moduleVars = new Set<string>()
  private procNames = new Set<string>()
  /** With 栈：栈顶是 `.Foo` 这种前导点表达式的归属 */
  private withStack: string[] = []
  private withN = 0
  /** On Error Resume Next 是否生效 */
  private resume = false

  constructor(private readonly m: Module) {
    for (const p of m.procs) this.procNames.add(p.name.toLowerCase())
    for (const g of m.globals) this.moduleVars.add(g.name.toLowerCase())
  }

  emit(): EmitResult {
    const entry = this.pickEntry()
    this.w('// —— 由 VBA 转译而来（src/lib/vba-emit.ts）——')
    this.w('// 这一份是生成物：改它不会改回 VBA，也不要在里面手写逻辑。')
    this.w('const __vba = vba')
    this.w('')
    // 模块级变量：各过程闭包共享
    const g = [...this.moduleVars].map((n) => `$${jsName(n)}`)
    if (g.length) this.w(`let ${g.join(', ')}`)
    if (g.length) this.w('')
    for (const p of this.m.procs) this.proc(p)
    this.w(`// 入口：${entry}`)
    this.w(`$${jsName(entry)}()`)
    return { code: this.out.join('\n'), entry }
  }

  /** VBA 没有"Main"概念：优先叫 Main 的 Sub，否则第一个 Sub */
  private pickEntry(): string {
    const main = this.m.procs.find((p) => p.kind === 'sub' && p.name.toLowerCase() === 'main')
    return (main ?? this.m.procs.find((p) => p.kind === 'sub') ?? this.m.procs[0]).name
  }

  private w(line: string): void {
    if (line === '') this.out.push('')
    else this.out.push('  '.repeat(this.ind) + line)
  }

  // ── 过程 ──
  private procName = ''

  private proc(p: Proc): void {
    this.procName = p.name
    // 模块级变量**不**进 locals：它们在模块作用域里已经 `let` 过了，
    // 过程里靠闭包引用。混进来的话每个过程顶部都会再 `let` 一遍，
    // 把模块那一份遮住——两个过程就再也看不到同一个变量了
    this.locals = new Set<string>()
    this.withStack = []
    this.resume = false
    const paramNames = new Set(p.params.map((pr) => pr.name.toLowerCase()))
    for (const pr of p.params) this.locals.add(pr.name.toLowerCase())
    this.collect(p.body)
    // 过程自己的名字不是变量：`Function F` 里的 `F = x` 是返回值
    this.locals.delete(p.name.toLowerCase())
    this.w(`function $${jsName(p.name)}(${this.params(p.params)}) {`)
    this.ind++
    // 形参已经是声明过的名字，不能再 `let` 一遍
    const ls = [...this.locals].filter((n) => !paramNames.has(n)).map((n) => `$${jsName(n)}`)
    if (ls.length) this.w(`let ${ls.join(', ')}`)
    this.body(p.body)
    // Function 没走到 `Name = value` 时返回 Empty
    if (p.kind === 'function') this.w('return __vba.empty')
    this.ind--
    this.w('}')
    this.w('')
  }

  private params(ps: Param[]): string {
    const out: string[] = []
    for (const p of ps) {
      if (p.rest) {
        out.push(`...$${jsName(p.name)}`)
        continue
      }
      // Optional：少传一个实参时用默认值（没有默认值就是 Empty）
      out.push(p.optional ? `$${jsName(p.name)} = ${p.init ? this.expr(p.init) : '__vba.empty'}` : `$${jsName(p.name)}`)
    }
    return out.join(', ')
  }

  /** 预扫：把所有会被赋值的名字登记成局部变量（提升声明用） */
  private collect(body: Stmt[]): void {
    for (const s of body) {
      switch (s.k) {
        case 'dim':
          for (const n of s.names) this.locals.add(n.name.toLowerCase())
          break
        case 'assign':
          // 模块级变量不进 locals：它们在模块作用域里声明，靠闭包引用。
          // 收进来的话过程顶部会再 let 一遍，把模块那份遮住
          if (s.target.k === 'name' && !this.moduleVars.has(s.target.id.toLowerCase())) {
            this.locals.add(s.target.id.toLowerCase())
          }
          break
        case 'for':
          this.locals.add(s.var.toLowerCase())
          this.collect(s.body)
          break
        case 'foreach':
          this.locals.add(s.var.toLowerCase())
          this.collect(s.body)
          break
        case 'redim':
          this.locals.add(s.name.toLowerCase())
          break
        case 'if':
          this.collect(s.then)
          for (const e of s.elseifs) this.collect(e.body)
          if (s.els) this.collect(s.els)
          break
        case 'do':
        case 'while':
          this.collect(s.body)
          break
        case 'select':
          for (const c of s.cases) this.collect(c.body)
          if (s.els) this.collect(s.els)
          break
        case 'with':
          this.collect(s.body)
          break
        default:
          break
      }
    }
  }

  private body(body: Stmt[]): void {
    for (const s of body) this.stmt(s)
  }

  // ── 语句 ──
  private stmt(s: Stmt): void {
    // On Error Resume Next 生效期间，每条语句包一层 try/catch：
    // 错误不中断流程，只记进 __vba.err（对应 VBA 的 Err 对象）
    const one = (): void => {
      switch (s.k) {
        case 'dim':
          return this.dim(s.names)
        case 'assign':
          return this.assign(s.target, s.value, s.set)
        case 'if':
          return this.ifStmt(s)
        case 'for':
          return this.forStmt(s)
        case 'foreach':
          return this.foreachStmt(s)
        case 'do':
          return this.doStmt(s)
        case 'while':
          return this.whileStmt(s)
        case 'select':
          return this.selectStmt(s)
        case 'with':
          return this.withStmt(s)
        case 'exit':
          return this.exitStmt(s)
        case 'call':
          return this.w(this.callStmt(s.call))
        case 'redim':
          return this.w(`$${jsName(s.name)} = __vba.redim($${jsName(s.name)}, ${s.lo}, ${s.hi}, ${s.preserve})`)
        case 'erase':
          return this.w(`__vba.erase($${jsName(s.name)})`)
        case 'onerror':
          this.resume = s.mode === 'resume'
          return this.w(`__vba.errMode = ${s.mode === 'resume' ? "'resume'" : "'off'"}`)
      }
    }
    if (this.resume && s.k !== 'onerror') {
      this.w('try {')
      this.ind++
      one()
      this.ind--
      this.w('} catch (e) { __vba.err = e }')
      return
    }
    one()
  }

  private dim(names: DimName[]): void {
    for (const n of names) {
      // 变量已在函数顶部声明过：Dim 只是一次赋值（VBA 里循环中的 Dim 就是重新初始化）
      const init = n.init
        ? this.expr(n.init)
        : n.newType
          ? `new __vba.${n.newType === 'Dictionary' ? 'Dictionary' : 'Collection'}()`
          : n.bounds
            ? `__vba.arr(${n.bounds[0]}, ${n.bounds[1]})`
            : '__vba.empty'
      this.w(`$${jsName(n.name)} = ${init}`)
    }
  }

  private assign(target: Expr, value: Expr, set: boolean): void {
    const v = this.expr(value)
    if (target.k === 'index') {
      this.w(`__vba.setIdx(${this.expr(target.obj)}, ${target.args.map((a) => this.expr(a)).join(', ')}, ${v})`)
      return
    }
    // `Function F(...)` 里的 `F = x` 是给返回值赋值，不是给变量赋值
    if (target.k === 'name' && target.id.toLowerCase() === this.procName.toLowerCase()) {
      this.w(`return ${v}`)
      return
    }
    // Set 与 Let 在 JS 里没有区别（都只换引用）；留着 set 只为语义清楚
    void set
    this.w(`${this.expr(target)} = ${v}`)
  }

  private ifStmt(s: Extract<Stmt, { k: 'if' }>): void {
    this.w(`if (__vba.b(${this.expr(s.cond)})) {`)
    this.ind++
    this.body(s.then)
    this.ind--
    for (const e of s.elseifs) {
      this.w(`} else if (__vba.b(${this.expr(e.cond)})) {`)
      this.ind++
      this.body(e.body)
      this.ind--
    }
    if (s.els) {
      this.w('} else {')
      this.ind++
      this.body(s.els)
      this.ind--
    }
    this.w('}')
  }

  private forStmt(s: Extract<Stmt, { k: 'for' }>): void {
    const id = `$${jsName(s.var)}`
    // 步长可能为负：方向不同，比较符也得跟着换。用 while 而不是两套 for，
    // 免得循环体在生成代码里出现两遍（大循环体会让文件翻一倍）
    this.w('{')
    this.ind++
    this.w(`const $to = ${this.expr(s.to)}, $step = ${s.step ? this.expr(s.step) : '1'}`)
    this.w(`${id} = ${this.expr(s.from)}`)
    this.w(`while ($step >= 0 ? __vba.le(${id}, $to) : __vba.ge(${id}, $to)) {`)
    this.ind++
    this.body(s.body)
    this.w(`${id} = __vba.add(${id}, $step)`)
    this.ind--
    this.w('}')
    this.ind--
    this.w('}')
  }

  private foreachStmt(s: Extract<Stmt, { k: 'foreach' }>): void {
    const id = `$${jsName(s.var)}`
    this.w('{')
    this.ind++
    this.w(`const $items = __vba.iter(${this.expr(s.coll)})`)
    this.w(`${id} = __vba.empty`)
    this.w(`for (let $k = 0; $k < $items.length; $k++) {`)
    this.ind++
    this.w(`${id} = $items[$k]`)
    this.body(s.body)
    this.ind--
    this.w('}')
    this.ind--
    this.w('}')
  }

  private doStmt(s: Extract<Stmt, { k: 'do' }>): void {
    const cond = `__vba.b(${this.expr(s.cond)})`
    const test = s.test === 'while' ? cond : `!${cond}`
    this.w(s.pre ? `while (${test}) {` : 'do {')
    this.ind++
    this.body(s.body)
    this.ind--
    this.w(s.pre ? '}' : `} while (${test})`)
  }

  private whileStmt(s: Extract<Stmt, { k: 'while' }>): void {
    this.w(`while (__vba.b(${this.expr(s.cond)})) {`)
    this.ind++
    this.body(s.body)
    this.ind--
    this.w('}')
  }

  private selectStmt(s: Extract<Stmt, { k: 'select' }>): void {
    this.w('{')
    this.ind++
    this.w(`const $t = ${this.expr(s.expr)}`)
    let first = true
    for (const c of s.cases) {
      const tests = c.tests.map((t) => this.caseTest('$t', t)).join(' || ')
      this.w(`${first ? 'if' : '} else if'} (${tests}) {`)
      this.ind++
      this.body(c.body)
      this.ind--
      first = false
    }
    if (s.els) {
      this.w(first ? 'if (true) {' : '} else {')
      this.ind++
      this.body(s.els)
      this.ind--
    }
    this.w('}')
    this.ind--
    this.w('}')
  }

  private caseTest(t: string, c: CaseTest): string {
    if (c.k === 'is') return `__vba.cmp(${t}, ${this.expr(c.v)}) ${c.op} 0`
    if (c.k === 'range') return `(__vba.ge(${t}, ${this.expr(c.lo)}) && __vba.le(${t}, ${this.expr(c.hi)}))`
    return `__vba.eq(${t}, ${this.expr(c.v)})`
  }

  private withStmt(s: Extract<Stmt, { k: 'with' }>): void {
    const name = `$w${this.withN++}`
    this.w('{')
    this.ind++
    this.w(`const ${name} = ${this.expr(s.obj)}`)
    this.withStack.push(name)
    this.body(s.body)
    this.withStack.pop()
    this.ind--
    this.w('}')
  }

  private exitStmt(s: Extract<Stmt, { k: 'exit' }>): void {
    // Exit For/Do/While 在 JS 里都是 break；Exit Sub/Function 是 return
    this.w(s.what === 'sub' || s.what === 'function' ? 'return' : 'break')
  }

  // ── 表达式 ──
  private expr(e: Expr): string {
    switch (e.k) {
      case 'num':
        return numLit(e.v)
      case 'str':
        return JSON.stringify(e.v)
      case 'bool':
        return e.v ? 'true' : 'false'
      case 'nothing':
        return 'null'
      case 'empty':
        return '__vba.empty'
      case 'null':
        return 'null'
      case 'name':
        return this.name(e.id)
      case 'member': {
        const obj = e.obj === null ? this.withTarget() : this.expr(e.obj)
        return `${obj}.${e.name}`
      }
      case 'index':
        return `__vba.idx(${this.expr(e.obj)}, ${e.args.map((a) => this.expr(a)).join(', ')})`
      case 'call':
        return this.call(e.callee, e.args, e.names)
      case 'new':
        return `new __vba.${e.type === 'Dictionary' ? 'Dictionary' : 'Collection'}()`
      case 'un': {
        const a = this.expr(e.a)
        if (e.op === '-') return `__vba.neg(${a})`
        if (e.op === '+') return `__vba.pos(${a})`
        return `__vba.not(${a})`
      }
      case 'bin':
        return this.bin(e)
    }
    throw new Error(`表达式节点「${(e as Expr).k}」没有对应的生成规则`)
  }

  private bin(e: Extract<Expr, { k: 'bin' }>): string {
    const a = this.expr(e.a)
    const b = this.expr(e.b)
    switch (e.op) {
      case '+':
        return `__vba.add(${a}, ${b})`
      case '-':
        return `__vba.sub(${a}, ${b})`
      case '*':
        return `__vba.mul(${a}, ${b})`
      case '/':
        return `__vba.div(${a}, ${b})`
      case '\\':
        return `__vba.idiv(${a}, ${b})`
      case '^':
        return `__vba.pow(${a}, ${b})`
      case 'Mod':
        return `__vba.mod(${a}, ${b})`
      case '&':
        return `__vba.amp(${a}, ${b})`
      case '=':
        return `__vba.eq(${a}, ${b})`
      case '<>':
        return `__vba.ne(${a}, ${b})`
      case '<':
        return `__vba.lt(${a}, ${b})`
      case '<=':
        return `__vba.le(${a}, ${b})`
      case '>':
        return `__vba.gt(${a}, ${b})`
      case '>=':
        return `__vba.ge(${a}, ${b})`
      case 'And':
        return `__vba.and(${a}, ${b})`
      case 'Or':
        return `__vba.or(${a}, ${b})`
      case 'Xor':
        return `__vba.xor(${a}, ${b})`
      case 'Eqv':
        return `__vba.eqv(${a}, ${b})`
      case 'Imp':
        return `__vba.imp(${a}, ${b})`
      case 'Like':
        return `__vba.like(${a}, ${b})`
      case 'Is':
        // `x Is Nothing` 是最常见的形态；对象之间用恒等
        return e.b.k === 'nothing' ? `__vba.isNothing(${a})` : `__vba.isSame(${a}, ${b})`
    }
    throw new Error(`运算符「${e.op}」没有对应的生成规则`)
  }

  /** 名字 → JS 标识符 / 全局引用 */
  private name(id: string): string {
    const l = id.toLowerCase()
    if (this.locals.has(l) || this.moduleVars.has(l)) return `$${jsName(id)}`
    if (GLOBALS.has(l)) return `__vba.${proper(id)}`
    if (CONSTS.has(l)) return `__vba.C.${id}`
    // 没有声明的名字：VBA（无 Option Explicit 时）把它当 Empty 变量，
    // 这里给一个会报清楚错的东西——静默按空算下去，出错的地方就再也找不回来了
    return `__vba.u(${JSON.stringify(id)})`
  }

  /**
   * 调用语句。没有实参时（`Selection.Delete`、`SetIt`）解析层给的是
   * 裸的名字/成员表达式，这里必须补上括号——不然生成的是属性读取，
   * 什么也不会发生（而且是静默的）
   */
  private callStmt(call: Expr): string {
    if (call.k === 'call') return this.expr(call)
    if (call.k === 'name' || call.k === 'member') return this.call(call, [])
    return this.expr(call)
  }

  private call(callee: Expr, args: Expr[], names?: (string | undefined)[]): string {
    const as = this.callArgs(args, names)
    if (callee.k === 'name') {
      const l = callee.id.toLowerCase()
      if (this.procNames.has(l)) return `$${jsName(callee.id)}(${as})`
      // 声明过的名字（形参 / Dim / 赋值目标 / 循环变量）**不是过程**：VBA 里变量
      // 不能被"调用"，所以 `v(1, 2)` 是下标——一维/二维数组的下标，或者
      // Range/Dictionary/Collection 那一类带默认属性的对象的下标。
      // 这一条放在 BUILTINS/GLOBALS 之前：局部名遮住全局名，与 VBA 的作用域一致
      if (this.locals.has(l) || this.moduleVars.has(l)) {
        return `__vba.idx($${jsName(callee.id)}${as ? `, ${as}` : ''})`
      }
      if (BUILTINS.has(l)) {
        return NYI.has(l) ? `__vba.nyi(${JSON.stringify(callee.id)}${as ? `, ${as}` : ''})` : `__vba.${l}(${as})`
      }
      if (GLOBALS.has(l)) return `__vba.${proper(callee.id)}(${as})`
      return `__vba.miss(${JSON.stringify(callee.id)},[${as}])`
    }
    if (callee.k === 'member') {
      const obj = callee.obj === null ? this.withTarget() : this.expr(callee.obj)
      return `${obj}.${callee.name}(${as})`
    }
    return `${this.expr(callee)}(${as})`
  }

  /**
   * 实参表。有命名实参时（`Execute Replace:=wdReplaceAll`）把命名那些收成一个
   * 选项对象跟在位置实参后面——名字丢不得：Replace 是 Execute 的第三个形参，
   * 光给一个 wdReplaceAll 会被当成第一个实参 FindText
   */
  private callArgs(args: Expr[], names?: (string | undefined)[]): string {
    if (!names || !names.some((n) => n !== undefined)) return args.map((a) => this.expr(a)).join(', ')
    const pos: string[] = []
    const named: string[] = []
    args.forEach((a, i) => {
      if (names[i]) named.push(`${jsName(names[i]!)}: ${this.expr(a)}`)
      else pos.push(this.expr(a))
    })
    return [...pos, `{${named.join(', ')}}`].join(', ')
  }

  private withTarget(): string {
    const t = this.withStack[this.withStack.length - 1]
    if (!t) throw new Error('前导点表达式出现在 With 块外面')
    return t
  }
}

/** VBA 标识符 → JS 标识符。`$` 前缀避开所有 JS 关键字 */
function jsName(id: string): string {
  return id.replace(/[^A-Za-z0-9_$]/g, '_')
}

/** 全局对象用的名字：ActiveDocument / ThisDocument / Selection … */
function proper(id: string): string {
  return id[0].toUpperCase() + id.slice(1)
}

/** 数字字面量：整数不带小数点，其余原样 */
function numLit(v: number): string {
  return String(v)
}

export function emitVba(m: Module): EmitResult {
  return new Emitter(m).emit()
}
