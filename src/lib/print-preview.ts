// Writer 独立打印预览（v0.175）——状态与页数口径的单一事实源。
//
// 为什么抽出来：预览是「同一棵 DOM 切到只读」而不是另画一份文档，
// 所以「哪些 UI 该藏、编辑器还可不可编辑」必须在一处定死；页数估算此前只活在
// 状态栏的那一行 `Math.ceil(docH / …)`，预览条要用就得同源，抄一份迟早走散。
//
// 诚实边界：这是**单张纸面的只读镜像 + 缩放**，不是逐页翻页的真预览。
// 纸面怎么分页由 Chromium 的 @media print 决定，屏幕上不重排、不切页。

export interface PreviewUi {
  editable: boolean
  showEditorBars: boolean
  showSidebars: boolean
  showPreviewBar: boolean
}

export function previewUi(open: boolean): PreviewUi {
  return open
    ? { editable: false, showEditorBars: false, showSidebars: false, showPreviewBar: true }
    : { editable: true, showEditorBars: true, showSidebars: true, showPreviewBar: false }
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
