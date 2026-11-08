// 视图缩放（v0.174 Writer / v0.178 Impress）——只作用于屏幕上的纸面/舞台，
// 不进文档、不进导出。
//
// 为什么单独一个模块：缩放值要在「Ctrl+滚轮 / 加减按钮 / 下拉 / 100% 复位」四个入口
// 之间保持一致，而打印与导出 PDF 必须永远按 100% 出纸（`@media print` 里 !important
// 把内联 zoom 压回去）。值域与档位定在这一处，UI 只做接线，Node 侧可纯函数钉。
// v0.178 起 Writer 的纸面与 Impress 的舞台共用这一串刻度，两处观感一致。
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

/**
 * Impress 舞台缩放（v0.178）：只产出**屏幕上**那一枚 CSS 值。
 *
 * 为什么不复用 Writer 的「把值直接塞进 style」：舞台的导出与放映走的是
 * 离屏 `.ppt-print-page` / `StaticSlide`，与 `.ppt-stage` 这棵 DOM 无关。
 * 把「缩放值从哪来」收在这一处，结构测试就能钉住「只有舞台读它」——
 * 不会出现哪天导出 PDF 顺手把屏幕缩放也带进去的静默回归。
 * 打印另有 `@media print` 把内联 zoom 压回 1，纸上永远按 100% 出。
 */
export function stageZoomStyle(z: number): { zoom: number } {
  return { zoom: clampZoom(z) }
}

/**
 * 自动缩放档（v0.185）：`width` 让一页正好铺满可用宽度，`page` 让整页连高一起装下。
 *
 * 三个口径都定在这一处，UI 只负责把「页面原始尺寸」与「容器可用尺寸」量进来：
 *   ① 页面尺寸必须是**未缩放**的（PDF 用 getViewport({scale:1})，Impress 用
 *      getBoundingClientRect()/当前 zoom），拿已缩放的尺寸去算会自我锁死；
 *   ② 容器要扣掉内边距，否则算出 100% 时页面仍贴着边；
 *   ③ 结果保留三位小数，不在这里夹档位——PDF 的 scale 是连续值，Impress 是档位制
 *      下拉，各自再走自己的 clamp / nearestZoomStep，避免一处替另一处做决定。
 *
 * 退化口径：页面或容器尺寸非法（0 / NaN / 负）一律回 1，不产生 Infinity 或 0 缩放。
 */
export type FitMode = 'width' | 'page'
export const FIT_PADDING = 24

export function fitZoom(
  pageW: number,
  pageH: number,
  viewW: number,
  viewH: number,
  mode: FitMode,
  padding = FIT_PADDING,
): number {
  const nums = [pageW, pageH, viewW, viewH, padding]
  if (!nums.every((v) => Number.isFinite(v) && v >= 0)) return 1
  if (pageW <= 0 || pageH <= 0) return 1
  const availW = viewW - padding * 2
  const availH = viewH - padding * 2
  if (availW <= 0 || availH <= 0) return 1
  const byW = availW / pageW
  const byH = availH / pageH
  const raw = mode === 'page' ? Math.min(byW, byH) : byW
  return Math.round(raw * 1000) / 1000
}

/** 档位制 UI（Impress 的下拉没有任意百分比这一项）把自动值落到最近一档 */
export function nearestZoomStep(z: number): number {
  if (!Number.isFinite(z)) return 1
  let best: number = ZOOM_STEPS[0]
  for (const s of ZOOM_STEPS) if (Math.abs(s - z) < Math.abs(best - z)) best = s
  return best
}
