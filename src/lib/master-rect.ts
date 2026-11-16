// 母版占位矩形（v0.186）——Impress 里可拖/可缩的标题框与正文框。
//
// `MasterStyle.titleRect/bodyRect` 是**归一化 0..1** 的比例：`pptx-export.ts` 的
// `rectOr` 用 `rect.x * W` 换算回英寸，舞台上的形状定位也用同一套比例。这份模块
// 只做「屏幕拖动 → 新矩形」的纯换算，DOM 事件与状态机留在 PptEditor，Node 侧可钉。
//
// 为什么单独一个模块：占位矩形不是 SlideShape，`patchShape` 那套按 id 更新的状态机
// 用不上，得有第二套（按 title/body 两枚键写回 `deck.master`）。把换算抽出来，
// 两套状态机才不会各写一遍「clientX / stage.width」而悄悄长出不同口径。

import type { MasterRect, MasterStyle } from './ppt'

export type PlaceholderKind = 'title' | 'body'
export type DragMode = 'move' | 'resize'

/** 与 `pptx-export.ts` 的 W / H 同源（LAYOUT_16x9），改那一侧要同步这一处 */
export const SLIDE_IN = { w: 10, h: 5.625 } as const

/**
 * 缺省矩形 = `addTitleBar` / `addBody` 里那两组英寸默认值折算成比例。
 * 没编辑过的母版按这两枚显示，编辑后写回 `master`，导出/放映/导入都跟着走。
 */
export const DEFAULT_TITLE_RECT: MasterRect = {
  x: 0.55 / SLIDE_IN.w,
  y: 0.35 / SLIDE_IN.h,
  w: (SLIDE_IN.w - 1.1) / SLIDE_IN.w,
  h: 0.85 / SLIDE_IN.h,
}
export const DEFAULT_BODY_RECT: MasterRect = {
  x: 0.65 / SLIDE_IN.w,
  y: 1.55 / SLIDE_IN.h,
  w: (SLIDE_IN.w - 1.3) / SLIDE_IN.w,
  h: (SLIDE_IN.h - 2.1) / SLIDE_IN.h,
}

export const RECT_KEY: Record<PlaceholderKind, 'titleRect' | 'bodyRect'> = {
  title: 'titleRect',
  body: 'bodyRect',
}

/** 取这一枚占位矩形：母版里写了就用它，没写用缺省值；返回副本，绝不把常量改脏 */
export function rectFor(master: MasterStyle | undefined, kind: PlaceholderKind): MasterRect {
  const own = master?.[RECT_KEY[kind]]
  return { ...(own ?? (kind === 'title' ? DEFAULT_TITLE_RECT : DEFAULT_BODY_RECT)) }
}

const MIN_W = 0.05
const MIN_H = 0.03
const round3 = (v: number) => Math.round(v * 1000) / 1000
const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, round3(v))) : lo

/**
 * dx / dy 是**相对舞台宽高的比例**（组件用 `(clientX - startX) / stage.width` 算好，
 * 这样 CSS zoom 下缩放过的 getBoundingClientRect 自动被抵消，与形状拖拽同款）。
 *
 * move 只平移、允许略微出界（-0.5..1.5，与 SlideShape 的边界一致）；
 * resize 只改宽高、锚点不动，且不小于 MIN_*——拖成 0 宽的框在屏上就再也点不到了。
 */
export function dragRect(rect: MasterRect, mode: DragMode, dx: number, dy: number): MasterRect {
  if (mode === 'resize') {
    return { ...rect, w: clamp(rect.w + dx, MIN_W, 1.5), h: clamp(rect.h + dy, MIN_H, 1.5) }
  }
  return { ...rect, x: clamp(rect.x + dx, -0.5, 1.5), y: clamp(rect.y + dy, -0.5, 1.5) }
}

/** 归一化 → 舞台上的百分比 CSS（字符串百分比，React style 直接吃） */
export function rectStyle(rect: MasterRect): { left: string; top: string; width: string; height: string } {
  const pct = (v: number) => `${round3(v * 100)}%`
  return { left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }
}
