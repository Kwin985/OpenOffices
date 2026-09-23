// Word 的"域"（field）：正文里看到的编号、页码、交叉引用其实是一条指令算出来的结果缓存。
// 本模块只负责两件事——把指令原文拆成可用的形状，以及把**能重算的那几类**（SEQ 题注号、
// 缺失结果的 REF 引用文本）按当前文档顺序现算出来。
//
// 为什么只重算 SEQ：它是纯顺序计数（同名 label 每遇到一次 +1），文件里的缓存值在
// 别的工具编辑过、或作者手工粘贴过题注之后就会与顺序不符（1、2、2、5 这种）。
// 而 PAGE/PAGEREF 依赖分页，本应用的版心与 Word 不同，重算出来的页码反而是错的，
// 所以那两类仍旧沿用文件里的缓存并记一条边界，不去假装有保真。

import { all, allDesc, attr, local, textOf, type XEl } from './ooxml'

/** 一条域指令：` SEQ 图 \* ARABIC ` → cmd=SEQ、arg=图、switches=['\\*ARABIC']（开关大小写原样留着） */
export interface Instr {
  cmd: string
  arg: string
  switches: string[]
  raw: string
}

/** 指令里带引号的整体（`REF "My Bookmark" \h`）要当一枚参数读，不能按空格切开 */
function tokens(src: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = ''
  for (const ch of src) {
    if (quote) {
      if (ch === quote) quote = ''
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

export function parseInstr(src: string): Instr {
  const ts = tokens(src.trim())
  const switches: string[] = []
  let cmd = ''
  let arg = ''
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]
    // `\* ARABIC` 是一枚开关：星号后面那半截跟着它，不能当参数
    // 大小写原样留着——Word 就按开关自身的大小写决定结果的大小写（见 seqText）
    if (t === '\\*') {
      const next = ts[++i]
      if (next) switches.push(`\\*${next}`)
      continue
    }
    if (t.startsWith('\\')) {
      switches.push(t)
      continue
    }
    if (!cmd) cmd = t.toUpperCase()
    else if (!arg) arg = t
  }
  return { cmd, arg, switches, raw: src.trim() }
}

function seqRoman(n: number): string {
  const table: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ]
  let s = ''
  for (const [v, t] of table) while (n >= v) { s += t; n -= v }
  return s
}

function seqLetters(n: number): string {
  // Excel 列名那套：1→a、26→z、27→aa（Word 的 \* ALPHABETIC 同规则）
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(97 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * 按开关把计数落成可见文本：罗马数字与字母两类由**开关自身的大小写**决定结果的大小写
 * （`\* ROMAN` 给 I、`\* roman` 给 i，Word 16.0 实机测得），其余按阿拉伯数字。
 */
export function seqText(n: number, switches: string[]): string {
  const find = (name: string) => switches.find((s) => s.toLowerCase() === `\\*${name}`)
  const caps = (t?: string) => !!t && /[A-Z]/.test(t)
  const roman = find('roman') ?? find('romanlc')
  if (roman) return caps(roman) ? seqRoman(n).toUpperCase() : seqRoman(n)
  const alpha = find('alphabetic') ?? find('alpha') ?? find('alphabetical')
  if (alpha) return caps(alpha) ? seqLetters(n).toUpperCase() : seqLetters(n)
  return String(n)
}

/**
 * 域的重算上下文。书签表要在渲染之前先扫一遍整篇文档——交叉引用可以指向后面的段落，
 * 渲染到那一行时才知道就晚了；SEQ 计数相反必须跟着渲染顺序走（被跳过的分支不该占号）。
 */
export class FieldEngine {
  /** 书签名 → 所在段落的可见文本（REF 没有缓存结果时的兜底） */
  private refs = new Map<string, string>()
  private seqs = new Map<string, number>()

  /** 扫 w:p：每个 bookmarkStart 的名字挂上它所在段落的文本 */
  static from(bodyRoot: XEl): FieldEngine {
    const e = new FieldEngine()
    for (const p of allDesc(bodyRoot, 'p')) {
      // 只排掉 Word 自己反复挪动的光标书签：题注与目录的自动书签就叫 _Ref…/_Toc…，
      // 按"下划线开头"整类过滤会把 REF 唯一能兜底的那张表清成空的
      const marks = all(p, 'w:bookmarkStart').filter((b) => {
        const n = attr(b, 'w:name')
        return !!n && n !== '_GoBack'
      })
      if (!marks.length) continue
      // 段落文本走 allDesc：书签可能落在超链接/内容控件里
      const text = paraText(p)
      if (!text) continue
      for (const b of marks) e.refs.set(attr(b, 'w:name') as string, text)
    }
    return e
  }

  /** 书签所在段落的文本；Word 的 REF 默认插入的就是引用对象那一行的可见文本 */
  refText(name: string): string | undefined {
    const t = this.refs.get(name)
    if (!t) return undefined
    // 整段抄进正文会显得像重复，兜底只取开头一句
    return t.length > 40 ? `${t.slice(0, 40)}…` : t
  }

  /** SEQ：按遇到顺序现算。同名 label 各自一条序列（题注"图"与"表"互不影响） */
  seqValue(label: string, switches: string[]): string {
    const n = (this.seqs.get(label) ?? 0) + 1
    this.seqs.set(label, n)
    return seqText(n, switches)
  }
}

/** 段落可见文本：只取 w:t（w:instrText 是域代码原文，不该混进引用文本） */
function paraText(p: XEl): string {
  let s = ''
  for (const c of descendText(p)) s += c
  return s.replace(/\s+/g, ' ').trim()
}

function descendText(el: XEl): string[] {
  const out: string[] = []
  for (const c of el.children) {
    if (typeof c === 'string') continue
    const t = local(c.name)
    if (t === 'instrText' || t === 'delText' || t === 'pPr') continue
    if (t === 't') out.push(textOf(c))
    else if (t === 'tab') out.push(' ')
    else if (t === 'br' || t === 'cr') out.push(' ')
    else out.push(...descendText(c))
  }
  return out
}

/** 供渲染层复用的判据：这条指令是不是我们真能重算的 */
export function recomputable(instr: Instr): boolean {
  return instr.cmd === 'SEQ' && !!instr.arg
}

/** 域类型的中文说法，只用在建告警文案上 */
export function fieldLabel(f: Pick<Instr, 'cmd' | 'arg'>): string {
  const cmd = f.cmd || '域'
  if (cmd === 'REF' || cmd === 'PAGEREF') return `${cmd}（${f.arg || '未命名书签'}）`
  if (cmd === 'SEQ') return `SEQ（${f.arg || '未命名序列'}）`
  return cmd
}
