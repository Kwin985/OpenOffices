// Writer 标尺（v0.179）——刻度与缩进滑块口径的单一事实源。
//
// 为什么抽出来：标尺的 0 点、缩进滑块位置、拖动后的属性换算三件事必须说同一套话，
// 分开算迟早走散（与 v0.175 的 estimatePages、v0.174 的 ZOOM_STEPS 同一条纪律）。
// 这里全是纯数值，不碰 DOM / React / TipTap，Node 侧能直接断言。
//
// 口径：标尺 0 点在**版心左边缘**（不是纸面左边缘，与 Word 一致），
// 长度是版心宽；刻度每 2mm 一小格、每 10mm 一大格并标厘米数。
// 缩进属性的单位是 px（indent-extension 的 INDENT_STEP_PX = 32），
// 标尺拖动吸附到 1mm 网格（mmPx），两个入口的步长不同但不冲突——
// setIndent 是绝对设定，拖完再按「缩进」按钮仍按 32px 步进。

export interface RulerGeom {
  /** 版心宽度（屏幕 CSS px，zoom 之前） */
  contentWidthPx: number
  /** mm → px（96dpi = 96/25.4） */
  mmPx: number
  /** 缩进上限，与 INDENT_MAX_PX 同源 */
  maxIndentPx: number
}

export interface RulerTick {
  /** 相对版心左边缘的 px */
  at: number
  major: boolean
  /** 大刻度上的厘米数；小刻度不带标签 */
  label?: string
}

const finite = (v: number): number => (Number.isFinite(v) ? v : 0)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** 刻度串：越界、非有限值、非法 mmPx 一律给空串，不产出 NaN 位置 */
export function rulerTicks(g: RulerGeom, majorMm = 10, minorMm = 2): RulerTick[] {
  const width = finite(g.contentWidthPx)
  const mmPx = finite(g.mmPx)
  if (width <= 0 || mmPx <= 0 || !Number.isFinite(majorMm) || !Number.isFinite(minorMm) || minorMm <= 0 || majorMm <= 0) return []
  const step = minorMm * mmPx
  const majorEvery = Math.max(1, Math.round(majorMm / minorMm))
  const out: RulerTick[] = []
  for (let i = 0; ; i++) {
    const at = i * step
    if (at > width + 0.001) break
    const major = i % majorEvery === 0
    out.push({
      at: Math.round(at * 100) / 100,
      major,
      ...(major ? { label: String(Math.round((i * minorMm) / 10)) } : {}),
    })
  }
  return out
}

export interface RulerIndentAttrs {
  indentFirst?: number | null
  indentLeft?: number | null
  indentRight?: number | null
}

export interface RulerMarks {
  /** 首行缩进标记（绝对位置） */
  firstLine: number
  /** 左缩进标记 */
  left: number
  /** 右缩进标记 */
  right: number
}

/** 当前段落的三枚缩进属性 → 标尺上的三个标记位置（都相对版心左边缘） */
export function rulerIndentMarks(attrs: RulerIndentAttrs, g: RulerGeom): RulerMarks {
  const width = Math.max(0, finite(g.contentWidthPx))
  const max = Math.max(0, finite(g.maxIndentPx))
  const left = clamp(finite(attrs.indentLeft ?? 0), 0, Math.min(max, width))
  const firstLine = left + clamp(finite(attrs.indentFirst ?? 0), 0, Math.max(0, width - left))
  const right = Math.max(left, width - clamp(finite(attrs.indentRight ?? 0), 0, Math.min(max, width)))
  return { firstLine, left, right }
}

export type RulerHandle = 'first' | 'left' | 'right'

/**
 * 拖动一枚标记到 `atPx` → 三枚缩进属性的新值（一次全给，避免 setIndent 连调互相覆盖）。
 * 吸附到 1mm 网格；拖「左」时首行标记跟着走，保持两者相对偏移（Word 的行为）。
 */
export function rulerIndentFromDrag(
  handle: RulerHandle,
  atPx: number,
  marks: RulerMarks,
  g: RulerGeom,
): { indentFirst: number | null; indentLeft: number | null; indentRight: number | null } | null {
  if (handle !== 'first' && handle !== 'left' && handle !== 'right') return null
  const width = finite(g.contentWidthPx)
  const mmPx = finite(g.mmPx)
  const max = Math.max(0, finite(g.maxIndentPx))
  if (width <= 0 || mmPx <= 0 || !Number.isFinite(atPx)) return null
  // 网格吸附：1mm。mmPx 非有限时上面已挡掉
  const snapped = Math.round(clamp(atPx, 0, width) / mmPx) * mmPx
  const curFirst = clamp(finite(marks.firstLine - marks.left), 0, max)
  const curLeft = clamp(finite(marks.left), 0, max)
  const curRight = clamp(width - finite(marks.right), 0, max)
  if (handle === 'first') {
    return { indentFirst: clamp(snapped - curLeft, 0, max), indentLeft: curLeft, indentRight: curRight }
  }
  if (handle === 'left') {
    return { indentFirst: curFirst, indentLeft: clamp(snapped, 0, max), indentRight: curRight }
  }
  return { indentFirst: curFirst, indentLeft: curLeft, indentRight: clamp(width - snapped, 0, max) }
}

/** 垂直标尺的刻度（纸面高度方向），与水平同一套刻度函数 */
export function rulerVerticalTicks(contentHeightPx: number, mmPx: number): RulerTick[] {
  return rulerTicks({ contentWidthPx: contentHeightPx, mmPx, maxIndentPx: 0 })
}
