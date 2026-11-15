// VBA 子集 · 入口（v0.131；工作簿对象模型 v0.134）
//
// 一句话：把用户手里已有的小型 VBA 宏（Sub … End Sub）接到本项目已有的
// JS 宏引擎上跑。链路是四层——
//
//   vba-lex.ts    源码 → 语句（去注释、接续行、`:` 分隔）
//   vba-parse.ts  语句 → AST（递归下降）
//   vba-emit.ts   AST  → JS（跑在 macro.ts 的同一个 new Function 里）
//   vba-rt.ts     VBA 的对象模型/内置函数 → MacroApi / SheetMacroApi
//
// 为什么"子集"这两个字要一直挂在嘴边：VBA 是一整套语言加一座沙箱，
// 这里只做过程、语句、表达式、一小把内置函数和两套对象模型的表层
//（Word 那套：Documents/ActiveDocument/Selection/Range/Find；
//  Excel 那套：Workbooks/Worksheets/Cells/Range/Find/Interior）。
// 撞上不支持的东西时报带行号的错，不猜、不静默跳过——猜出来的行为比报错难查。
//
// 入口的约定：VBA 没有"Main"的概念（那是 VB.NET 的事），所以
//   1. 有叫 Main 的 Sub 就跑它；
//   2. 否则跑文件里第一个 Sub。
// 这条规则写在转译产物的注释里，用户能看见。
//
// 两个宿主，两个入口：
//   runVba        文字文档（DocEditor 的宏面板）
//   runVbaBook    工作簿（SheetEditor 的宏面板）
// 转译、沙箱、错误处理三条路完全一样，只有 createVbaRuntime 那一层换成簿子。

import type { Editor } from '@tiptap/core'
import { apiOf, type MacroRun } from './macro'
import type { SheetMacroApi } from './sheet-macro'
import { emitVba } from './vba-emit'
import { parseVba } from './vba-parse'
import { createVbaBookRuntime, createVbaRuntime, type VbaRuntime } from './vba-rt'

export { VbaError } from './vba-lex'
export type { Module } from './vba-parse'

export interface TranspileResult {
  ok: boolean
  /** 生成出来的 JS（转译失败时是空串） */
  code: string
  /** 入口过程名 */
  entry: string
  /** 失败时给人看的那句话（带行号） */
  error?: string
}

/**
 * 一条能跑的 VBA 样例（文档侧）。既是面板上一键填入的工具，
 * 也是"VBA 宏长什么样"的活样子：过程、Dim、With、Find、字符串函数、MsgBox 都在里面。
 */
export const VBA_SAMPLE = `' 把全篇的 "old" 换成 "new"，顺带报告换了几处
Sub Main()
    Dim n As Long
    With ActiveDocument.Content.Find
        .Text = "old"
        .Replacement.Text = "new"
        .Execute Replace:=wdReplaceAll
    End With
    n = ActiveDocument.Words.Count
    MsgBox "换完了，全文现在有 " & n & " 个词"
End Sub`

/**
 * 一条能跑的 VBA 样例（表格侧）。把 A 列前 6 行的平均写进 A8，
 * 超过平均的格子刷红：Set / With / Cells / Range / Value / For Each /
 * Interior.Color / IsNumeric 这一套都在里面。
 */
export const VBA_BOOK_SAMPLE = `' A1:A6 的平均写进 A8，超过平均的格子刷成红色
Sub Main()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.ActiveSheet
    Dim i As Long, n As Long
    Dim sum As Double
    n = 0
    sum = 0
    For i = 1 To 6
        If IsNumeric(ws.Cells(i, 1).Value) Then
            sum = sum + ws.Cells(i, 1).Value
            n = n + 1
        End If
    Next i
    If n = 0 Then
        MsgBox "A1:A6 里一个数都没有"
        Exit Sub
    End If
    ws.Range("A8").Value = sum / n
    Dim c As Range
    For Each c In ws.Range("A1:A6")
        If IsNumeric(c.Value) Then
            If c.Value > ws.Range("A8").Value Then c.Interior.Color = vbRed
        End If
    Next c
    MsgBox "平均 " & ws.Range("A8").Value & "，超过平均的已标红"
End Sub`

/**
 * 看着像不像 VBA。用于宏面板自动切档：有 Sub/Function 的过程骨架就算，
 * 不看内容——一段纯 JS 里出现 `function` 字样不会误判（大小写敏感地找 Sub）。
 */
export function looksLikeVba(code: string): boolean {
  if (!code) return false
  // 单行 If / With 之类也可能是 VBA，但判错一次的代价是"跑不了"，
  // 所以只认最硬的信号：过程骨架
  return /^\s*(public\s+|private\s+|friend\s+)?(sub|function)\s+\w+/im.test(code) || /^\s*end\s+(sub|function)\s*$/im.test(code)
}

/** VBA 源码 → JS。语法错误在这里就报出来，不等到跑 */
export function transpileVba(src: string): TranspileResult {
  try {
    const m = parseVba(src)
    const r = emitVba(m)
    return { ok: true, code: r.code, entry: r.entry }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, code: '', entry: '', error: msg }
  }
}

/**
 * 跑一段 VBA：先转译，再在 macro.ts 的沙箱里执行。
 * 与 runMacro 同一个沙箱、同一份 api、同一套"只跑自己写的"警告。
 */
export function runVba(src: string, editor: Editor, setStatus: (s: string) => void, path = ''): MacroRun {
  const t = transpileVba(src)
  if (!t.ok) return { ok: false, log: [], error: `VBA 转译失败：${t.error ?? '未知原因'}`, changed: false }
  const out: string[] = []
  const st = { changed: false }
  const api = apiOf(editor, out, setStatus, st)
  const vba = createVbaRuntime({ api, editor, out, setStatus, st, path })
  return runSandbox(t.code, vba, out, st)
}

/**
 * 跑一段表格侧的 VBA：同一条转译与沙箱，只有对象模型换成工作簿那一套
 *（Workbooks / Worksheets / Cells / Range / Interior）。文档宿主才有的东西
 *（ActiveDocument / Selection 那一套）在这里摸到会得到一句明白的错。
 */
export function runVbaBook(src: string, book: SheetMacroApi, setStatus: (s: string) => void, path = ''): MacroRun {
  const t = transpileVba(src)
  if (!t.ok) return { ok: false, log: [], error: `VBA 转译失败：${t.error ?? '未知原因'}`, changed: false }
  const out: string[] = []
  const st = { changed: false }
  const vba = createVbaBookRuntime({ book, out, setStatus, st, path })
  return runSandbox(t.code, vba, out, st)
}

/** 转译产物进沙箱。两个宿主共用这一段——沙箱该挡住的东西与宿主无关 */
function runSandbox(code: string, vba: VbaRuntime, out: string[], st: { changed: boolean }): MacroRun {
  try {
    // 与 runMacro 同一个沙箱。参数表里不能有 `eval`：严格模式下它是非法形参名，
    // 整段代码会 SyntaxError——严格模式的 eval 本来也泄漏不出绑定，挡它纯属摆设
    const fn = new Function(
      'vba',
      'window',
      'document',
      'fetch',
      'XMLHttpRequest',
      'globalThis',
      'Function',
      `"use strict";\n${code}`,
    )
    fn(vba, undefined, undefined, undefined, undefined, undefined, undefined)
    return { ok: true, log: out, changed: st.changed }
  } catch (e) {
    return { ok: false, log: out, error: e instanceof Error ? e.message : String(e), changed: st.changed }
  }
}
