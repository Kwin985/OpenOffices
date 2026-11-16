/**
 * VBA 子集 · 兼容桩（v0.196 整合轮）
 *
 * 远程主线声称 v0.131/v0.134 有 vba-lex/parse/emit/rt 合计约 3,000 行，
 * 源码从未提交。本桩保留 VBA 骨架识别（面板能照常切到 VBA 那一档），
 * 转译与执行一律如实失败，不返回假的成功结果。
 */
import type { MacroRun } from './macro'

export const VBA_SAMPLE = `' VBA 示例（转译器源码未入库，仅作展示）
Sub Hello()
    MsgBox "Hello"
End Sub
`

export interface VbaPreview {
  ok: boolean
  code: string
  error?: string
}

/** 只认最外层骨架；桩不做词法/语法分析 */
export function looksLikeVba(code: string): boolean {
  return /^\s*(?:Attribute\s+VB_|(?:Public\s+|Private\s+)?(?:Sub|Function)\s)/im.test(code)
}

export function transpileVba(_code: string): VbaPreview {
  return { ok: false, code: '', error: 'VBA 转译器源码未入库（远程主线从未提交 vba-*.ts）' }
}

export function runVba(
  _code: string,
  _editor: unknown,
  _setStatus: (s: string) => void,
  _path?: string,
): MacroRun {
  return {
    ok: false,
    changed: false,
    error: 'VBA 运行时源码未入库（远程主线从未提交 vba-rt.ts），本次不执行',
    log: [],
  }
}
