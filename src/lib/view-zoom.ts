// Writer 视图缩放（v0.174）——只作用于屏幕上的纸面，不进文档、不进导出。
//
// 为什么单独一个模块：缩放值要在「Ctrl+滚轮 / 加减按钮 / 下拉 / 100% 复位」四个入口
// 之间保持一致，而打印与导出 PDF 必须永远按 100% 出纸（`@media print` 里 !important
// 把内联 zoom 压回去）。值域与档位定在这一处，UI 只做接线，Node 侧可纯函数钉。
//
// 档位制而不是任意百分比：下拉的 option 与滚轮的步进共用同一串刻度，
// 就不会出现「滚轮滚出 1.1 而 select 里没有这一项、显示空白」的错位。

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

export function clampZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))
}

/** 相邻档位步进；到顶/到底就停在自己的边界档。 */
export function zoomStep(z: number, dir: -1 | 1): number {
  const cur = clampZoom(z)
  if (dir > 0) {
    const next = ZOOM_STEPS.find((s) => s > cur + 0.001)
    return next ?? ZOOM_MAX
  }
  const lower = ZOOM_STEPS.filter((s) => s < cur - 0.001)
  return lower.length ? lower[lower.length - 1] : ZOOM_MIN
}

/** Ctrl+滚轮：上滚放大一档、下滚缩小一档。与加减按钮同一条刻度。 */
export function zoomByWheel(z: number, deltaY: number): number {
  return zoomStep(z, deltaY < 0 ? 1 : -1)
}

export function zoomPct(z: number): string {
  return `${Math.round(clampZoom(z) * 100)}%`
}
