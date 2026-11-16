// Writer 独立打印预览（v0.175）——状态与页数口径的单一事实源。
//
// 为什么抽出来：预览是「同一棵 DOM 切到只读」而不是另画一份文档，
// 所以「哪些 UI 该藏、编辑器还可不可编辑」必须在一处定死；页数估算此前只活在
// 状态栏的那一行 `Math.ceil(docH / …)`，预览条要用就得同源，抄一份迟早走散。
//
// v0.181 补了**按等距页距翻页定位**：复用屏幕上的分页参考线（--pgh）与
// estimatePages 的同一份页高，把「第 n 页」翻成滚动量。诚实边界仍在：
// 纸面怎么分页由 Chromium 的 @media print 决定，屏幕上不重排、不切页；
// 表格/图片跨页、孤行控制这些真分页行为，等距跳转一概不模拟。

export interface PreviewUi {
  editable: boolean
  showEditorBars: boolean
  showSidebars: boolean
  showPreviewBar: boolean
  /** v0.181：预览条里的翻页控件只在预览态出现 */
  showPager: boolean
}

export function previewUi(open: boolean): PreviewUi {
  return open
    ? { editable: false, showEditorBars: false, showSidebars: false, showPreviewBar: true, showPager: true }
    : { editable: true, showEditorBars: true, showSidebars: true, showPreviewBar: false, showPager: false }
}

/**
 * 按「正文高度 ÷ 版心高度」估算页数。与状态栏、预览条共用；
 * 版心非正、内容为空、参数非有限值一律至少 1 页（Word 里空文档也是一页）。
 */
export function estimatePages(contentH: number, pageH: number, marginTop: number, marginBottom: number): number {
  const inner = pageH - marginTop - marginBottom
  if (!Number.isFinite(inner) || inner <= 0 || !Number.isFinite(contentH)) return 1
  return Math.max(1, Math.ceil(Math.max(0, contentH) / inner))
}

/**
 * v0.181：第 n 页顶部对应的 scrollTop。
 *
 * 页距取屏幕上分页参考线的 `--pgh`（就是 effPx.h，整张纸高，不是版心高），
 * 与 estimatePages 同源；`.doc-page` 内联的 zoom 会把参考线一起缩放，所以页距
 * 也要乘 zoom。padTopPx 是纸面上边距——参考线从纸面 top:0 起，正文从上边距
 * 之后开始，翻到某一页时把视口对到该页的正文起点更顺眼。
 *
 * 这不是真分页：只按等距纸高定位，Chromium 打印时的断页位置可能不同。
 */
export function pageScrollTop(page: number, pageH: number, zoom = 1, padTopPx = 0): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const step = Math.max(1, pageH) * z
  const p = Math.max(1, Math.round(Number.isFinite(page) ? page : 1))
  return (p - 1) * step + Math.max(0, padTopPx) * z
}

/** pageScrollTop 的逆：当前滚动量落在第几页（供滚动时回写页码） */
export function pageOfScrollTop(scrollTop: number, pageH: number, zoom = 1, padTopPx = 0): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const step = Math.max(1, pageH) * z
  const y = Math.max(0, (Number.isFinite(scrollTop) ? scrollTop : 0) - Math.max(0, padTopPx) * z)
  return Math.max(1, Math.floor(y / step + 1e-6) + 1)
}

/** 页码夹在 [1, total]；total 非法时按一页处理 */
export function clampPage(page: number, total: number): number {
  const t = Math.max(1, Math.round(Number.isFinite(total) ? total : 1))
  const p = Math.max(1, Math.round(Number.isFinite(page) ? page : 1))
  return Math.min(t, p)
}
