/**
 * PDF 原地改字 · 兼容桩（v0.196 整合轮）
 *
 * 远程主线声称 v0.129 有 296 行（README 另处记 302 行）PDF 真·原地改字，
 * 源码从未提交；README 自己从 v0.175 起一路挂着「等 pdf-text-edit.ts 入库」。
 * 本桩保持类型与调用签名：底色一律兜白，写回明确抛错（调用方有 try/catch
 * 会把错显示在界面上），不假装写进了文件。
 */
import type { PdfRect } from './pdf-geo'

export interface TextEdit {
  page: number
  x: number
  y: number
  size: number
  rot: number
  rect: PdfRect
  text: string
  bg: string
  from: string
}

export interface TextEditResult {
  applied: number
  skipped: number[]
  fontEmbedded: boolean
}

export function sampleBackdrop(
  _canvas: HTMLCanvasElement | null,
  _dpr: number,
  _scale: number,
  _rect: PdfRect,
): string {
  return '#ffffff'
}

export async function applyTextEdits(
  _pdoc: unknown,
  _edits: TextEdit[],
): Promise<TextEditResult> {
  throw new Error(
    'PDF 原地改字源码未入库（远程主线从未提交 pdf-text-edit.ts），本次未写回',
  )
}
