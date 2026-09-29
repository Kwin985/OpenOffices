/**
 * 加密 PDF 的输密码文案：这一层的句子只写在这一处（先例 v0.54 纸上账目、v0.64 失败归因）。
 *
 * 三档判据都是本轮在真机上量出来的（探针见 tmp/x65，README 的 v0.65 一节列了读数）：
 * 1. pdf.js 的 onPassword 只交回两种 code——1「要密码」与 2「密码不对」，没有第三档；
 * 2. **pdf.js 自己不封顶**：错一次它就再问一次，可以一直问下去，所以重试的闸门只在界面上；
 * 3. 用户按取消与「压根没给密码」在错误内容上**分不出来**（我们那串 Error 的 name/message 到不了
 *    归因层），于是"是用户自己取消的"这件事只能由界面自己记着（见 PdfViewer 的 pwdCancelledRef）。
 */

/** 为什么问：pdf.js 交回的 code 只有这两档 */
export type PwdReason = 'need' | 'incorrect'

export function pwdReason(code: number): PwdReason {
  return code === 2 ? 'incorrect' : 'need'
}

/**
 * 问的那一句话。attempt 是「第几回问」（1 起）——第二回起把已经试过几次说出来，
 * 因为 pdf.js 那边不会说"你已经试了三回"，界面上不说的话用户就没有退出的依据。
 */
export function pwdPromptText(reason: PwdReason, attempt: number): string {
  if (reason === 'need') return '这份 PDF 设了打开密码，输入后即可查看。'
  const tried = Math.max(1, attempt - 1)
  return `密码不对，请再核对一次。（已经试过 ${tried} 次）`
}

/** 用户自己按取消：这一行不带"失败"前缀——没有失败，只是没往下走 */
export function pwdCancelledText(): string {
  return '已取消输入密码，这份 PDF 打不开（它设了打开密码）。'
}

/** 密码的去向：只在这次打开期间留在内存，不写盘、不进最近文件、重开还要再输一遍 */
export const PWD_MEMORY_NOTE = '密码只留在内存里，关掉标签就没了，也不会写进任何文件。'
