/**
 * PDF 页面几何：旋转空间换算 + 页码表达式解析（纯函数，可在 node 侧直接测）
 *
 * 标注在内存里统一存"显示空间"坐标（左上原点、已按 /Rotate 旋转后的页面），
 * 因为屏幕交互（框选、拖移、缩放）天然发生在这个空间；
 * 而 PDF 文件里的 /Rect 是"未旋转 + 左下原点"，读写两侧都要换算。
 */

export interface PdfRect {
  x: number
  y: number
  w: number
  h: number
}

export type Rot = 0 | 90 | 180 | 270

export function normRot(deg: number): Rot {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360
  return (r === 270 || r === 180 || r === 90 ? r : 0) as Rot
}

/** 未旋转页尺寸 → 显示尺寸：90/270 宽高互换 */
export function displaySize(base: { w: number; h: number }, rot: Rot): { w: number; h: number } {
  return rot === 90 || rot === 270 ? { w: base.h, h: base.w } : base
}

function mapPoint(x: number, y: number, rot: Rot, base: { w: number; h: number }) {
  // 未旋转左上原点 → 顺时针旋转后的显示坐标
  switch (rot) {
    case 90:
      return [base.h - y, x]
    case 180:
      return [base.w - x, base.h - y]
    case 270:
      return [y, base.w - x]
    default:
      return [x, y]
  }
}

function unmapPoint(x: number, y: number, rot: Rot, base: { w: number; h: number }) {
  // mapPoint 的逆：显示坐标 → 未旋转坐标
  switch (rot) {
    case 90:
      return [y, base.h - x]
    case 180:
      return [base.w - x, base.h - y]
    case 270:
      return [base.w - y, x]
    default:
      return [x, y]
  }
}

function viaPoint(
  r: PdfRect,
  rot: Rot,
  base: { w: number; h: number },
  fn: (x: number, y: number, rot: Rot, base: { w: number; h: number }) => number[],
): PdfRect {
  // 矩形取两对角点变换后重新归一（旋转会让宽高互换）
  const [ax, ay] = fn(r.x, r.y, rot, base)
  const [bx, by] = fn(r.x + r.w, r.y + r.h, rot, base)
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  }
}

/** 未旋转左上原点 → 显示空间 */
export function toDisplayRect(r: PdfRect, rot: Rot, base: { w: number; h: number }): PdfRect {
  return viaPoint(r, rot, base, mapPoint)
}

/** 显示空间 → 未旋转左上原点 */
export function fromDisplayRect(r: PdfRect, rot: Rot, base: { w: number; h: number }): PdfRect {
  return viaPoint(r, rot, base, unmapPoint)
}

/** 点集（手绘/直线顶点）显示空间 → 未旋转左上原点 */
export function fromDisplayPoints(
  polys: number[][][],
  rot: Rot,
  base: { w: number; h: number },
): number[][][] {
  return polys.map((s) => s.map(([x, y]) => unmapPoint(x, y, rot, base)))
}

/** 未旋转左上原点 → 显示空间 */
export function toDisplayPoints(
  polys: number[][][],
  rot: Rot,
  base: { w: number; h: number },
): number[][][] {
  return polys.map((s) => s.map(([x, y]) => mapPoint(x, y, rot, base)))
}

/**
 * 页码表达式 → 升序去重的 1-based 页号：`1-3,5,8` → [1,2,3,5,8]
 * 空段、逆序区间（5-2 视为 2-5）、越界页都按宽松策略处理；全非法返回 null。
 */
export function parsePageSpec(spec: string, total: number): number[] | null {
  const out = new Set<number>()
  for (const rawPart of spec.split(/[,，;；\s]+/)) {
    const part = rawPart.trim()
    if (!part) continue
    const m = /^(\d+)\s*[-–—~～至]\s*(\d+)$/.exec(part)
    if (m) {
      let a = Number(m[1])
      let b = Number(m[2])
      if (a > b) [a, b] = [b, a]
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) out.add(i)
      continue
    }
    const n = Number(part)
    if (Number.isInteger(n) && n >= 1 && n <= total) out.add(n)
  }
  return out.size ? [...out].sort((x, y) => x - y) : null
}
