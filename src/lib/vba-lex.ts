// VBA 子集 · 第一层：词法（v0.131）
//
// 这一层把 VBA 源码切成"语句"——每条语句是一串 token。比单纯切词麻烦的地方在于
// VBA 的语句边界：一条语句可以横跨多行（行尾 `_` 续行），一行里也可以有多条
// （`:` 分隔），而 `:` 只在没有嵌进括号/字符串里时才算分隔符。
//
// 顺手处理掉的几件 VBA 特有的小事：
//   - 注释：`'` 起头到行尾；以及行首的 `Rem `
//   - 续行：行尾一个**独立的** `_`。`a_b` 是一个标识符不是续行，
//     判据是 `_` 前面得有空白（VBA 手册也是这么规定的）
//   - 十六进制 / 八进制：`&H1F` `&O17`，可带类型尾巴（`&H1F&`）
//   - 数字类型尾巴：`1#` `2!` `3%` `4&` `5@`——只影响类型，值照读
//   - 标签行：`Label:`。GoTo 这个子集不支持，但标签行本身要认得出并跳过，
//     否则它会被当成"调用一个名叫 Label 的过程"
//
// 没有"关键字"这一种 token：所有单词都是 id，由上层按值（忽略大小写）判断身份。
// 少一层分类就少一类错——`Print`、`Error`、`Type` 这些在 VBA 里是保留字，
// 但出现在 `Debug.Print`、`On Error` 里时身份完全不同，交给上下文去认更稳。

export type TKind = 'num' | 'str' | 'id' | 'op' | 'nl'

export interface Tok {
  k: TKind
  v: string
  /** 数值字面量的值（仅 k === 'num'） */
  n?: number
  /** 源码行号（1 基），出错时指给人看 */
  line: number
  /**
   * 前面有没有空白。VBA 用它区分 `Debug.Print .Name`（带空格的点是实参起点）
   * 与 `Debug.Print.Name`（属性链）——词法上这是唯一可用的判据
   */
  sp?: boolean
}

/** 一条语句：token 串 + 它起在源码第几行 */
export interface RawStmt {
  toks: Tok[]
  line: number
  /** 这条语句是被 `:` 收尾的（识别标签行用） */
  colon: boolean
}

/** 带行号的语法/词法错误。上层把它原样递给用户，别吞 */
export class VbaError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(line > 0 ? `第 ${line} 行：${message}` : message)
    this.name = 'VbaError'
  }
}

/** 顶层入口：源码 → 语句数组 */
export function lexStatements(src: string): RawStmt[] {
  const toks = tokenize(preprocess(src))
  const out: RawStmt[] = []
  let cur: Tok[] = []
  let colon = false
  let depth = 0
  const flush = () => {
    if (cur.length) {
      out.push({ toks: cur, line: cur[0].line, colon })
      cur = []
      colon = false
    }
  }
  for (const t of toks) {
    if (t.k === 'nl') {
      flush()
      continue
    }
    if (t.k === 'op') {
      if (t.v === '(') depth++
      else if (t.v === ')') depth = depth > 0 ? depth - 1 : 0
      else if (t.v === ':' && depth === 0) {
        // 冒号收尾：先记住"是冒号收的"（标签行的判据），再结算当前语句
        colon = true
        flush()
        continue
      }
    }
    cur.push(t)
  }
  flush()
  return out.filter((s) => {
    // Rem 注释语句：整条丢掉
    if (s.toks[0].k === 'id' && s.toks[0].v.toLowerCase() === 'rem') return false
    // 标签行：单个标识符 + 冒号收尾
    if (s.colon && s.toks.length === 1 && s.toks[0].k === 'id') return false
    return true
  })
}

/** 去注释、接续行、统一换行 */
function preprocess(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let carry = ''
  for (const raw of lines) {
    let line = raw
    // 去 `'` 注释：字符串里的单引号不是注释，得先认字符串
    let inStr = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inStr) {
        if (c === '"') {
          if (line[i + 1] === '"') i++ // "" 是转义的引号，不是字符串结束
          else inStr = false
        }
        continue
      }
      if (c === '"') inStr = true
      else if (c === "'") {
        line = line.slice(0, i)
        break
      }
    }
    line = stripRem(line)
    // 续行：` _` 或光秃秃一个 `_`。前面那个正则会漏掉后者，单独补
    const m = /^(.*?)[ \t]_[ \t]*$/.exec(line)
    if (m) {
      carry += m[1] + ' '
      continue
    }
    if (/^_[ \t]*$/.test(line)) {
      carry += ' '
      continue
    }
    out.push(carry + line)
    carry = ''
  }
  if (carry) out.push(carry)
  return out.join('\n')
}

/**
 * 去 `Rem` 注释。它只在语句开头算注释（行首，或 `:` 之后），
 * 所以 `Rem = 5` 之外的写法不会被误伤——但 `Rem` 后面必须跟空白或行尾，
 * `Remark`、`Remote` 这种名字不动。
 */
function stripRem(line: string): string {
  let out = ''
  let i = 0
  let inStr = false
  // 行首就是一个语句开头
  let atStmtStart = true
  while (i < line.length) {
    const c = line[i]
    if (inStr) {
      out += c
      if (c === '"') {
        if (line[i + 1] === '"') {
          out += line[i + 1]
          i += 2
          continue
        }
        inStr = false
      }
      i++
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      i++
      atStmtStart = false
      continue
    }
    if (c === ':') {
      out += c
      i++
      atStmtStart = true
      continue
    }
    if (c === ' ' || c === '\t') {
      out += c
      i++
      continue
    }
    if (atStmtStart && /^Rem([ \t]|$)/i.test(line.slice(i))) return out
    atStmtStart = false
    out += c
    i++
  }
  return out
}

const OPS3: string[] = []
const OPS2 = ['<=', '>=', '<>', ':=']
const OPS1 = ['=', '<', '>', '+', '-', '*', '/', '\\', '^', '&', '(', ')', ',', '.', ':', '!']

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  let line = 1
  const at = (n: number) => src[i + n] ?? ''
  let space = false
  const push = (k: TKind, v: string, n?: number) => {
    toks.push({ k, v, line, n, ...(space ? { sp: true } : {}) })
    space = false
  }
  const fail = (msg: string): never => {
    throw new VbaError(msg, line)
  }

  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      // 连续空行压成一个换行标记：语句切分只认"有没有"，不认几个
      if (toks.length && toks[toks.length - 1].k !== 'nl') push('nl', '\n')
      i++
      line++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++
      space = true
      continue
    }
    // 字符串
    if (c === '"') {
      let j = i + 1
      let s = ''
      for (;;) {
        if (j >= src.length) fail('字符串没有闭合的引号')
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"'
            j += 2
            continue
          }
          j++
          break
        }
        if (src[j] === '\n') fail('字符串不能跨行（用 " & vbCrLf & " 接）')
        s += src[j]
        j++
      }
      push('str', s)
      i = j
      continue
    }
    // 数字
    if (isDigit(c) || (c === '.' && isDigit(at(1)))) {
      let j = i
      while (j < src.length && isDigit(src[j])) j++
      if (src[j] === '.') {
        j++
        while (j < src.length && isDigit(src[j])) j++
      }
      if ((src[j] === 'e' || src[j] === 'E') && (isDigit(src[j + 1]) || ((src[j + 1] === '+' || src[j + 1] === '-') && isDigit(src[j + 2])))) {
        j += src[j + 1] === '+' || src[j + 1] === '-' ? 2 : 1
        while (j < src.length && isDigit(src[j])) j++
      }
      const txt = src.slice(i, j)
      // 类型尾巴：# ! % & @ —— 只影响类型，值照读
      if ('#!%&@'.includes(src[j] ?? '')) j++
      push('num', txt, Number(txt))
      i = j
      continue
    }
    // 十六进制 / 八进制：&H.. &O..（可再带一个 & 当类型尾巴）
    if (c === '&' && (at(1) === 'H' || at(1) === 'h' || at(1) === 'O' || at(1) === 'o') && /[0-9a-fA-F]/.test(at(2))) {
      const hex = at(1).toLowerCase() === 'h'
      let j = i + 2
      while (j < src.length && /[0-9a-fA-F]/.test(src[j])) j++
      const digits = src.slice(i + 2, j)
      if (!hex && /[89a-fA-F]/.test(digits)) fail(`八进制字面量 &O${digits} 里有非八进制数字`)
      if (src[j] === '&') j++
      push('num', src.slice(i, j), hex ? parseInt(digits, 16) : parseInt(digits, 8))
      i = j
      continue
    }
    // 标识符
    if (isIdentStart(c)) {
      let j = i + 1
      while (j < src.length && isIdentPart(src[j])) j++
      push('id', src.slice(i, j))
      i = j
      continue
    }
    // 方括号：那是 Excel 的 [A1] 简写，不是这个子集的东西
    if (c === '[' || c === ']') fail('方括号 [ ] 不支持（VBA 里那是 Excel 的简写）')
    // 日期/时间字面量 #10:30#
    if (c === '#') fail('日期字面量 # ... # 不支持（先用字符串，再让运行时认）')
    // 运算符
    const two = c + at(1)
    if (OPS2.includes(two)) {
      push('op', two)
      i += 2
      continue
    }
    if (OPS1.includes(c)) {
      push('op', c)
      i++
      continue
    }
    void OPS3
    fail(`不认识的字符「${c}」`)
  }
  if (toks.length && toks[toks.length - 1].k !== 'nl') push('nl', '\n')
  return toks
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}
function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
}
function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c)
}
