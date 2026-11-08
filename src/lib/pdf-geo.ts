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

/**
 * 角度 → 四种合法旋转之一。
 *
 * 规则不是"四舍五入到最近 90°"，而是**和渲染器（pdf.js）逐字对齐**：
 * 先归一到 [0,360)，再只认 0/90/180/270 四个精确值，其余一律按 0。
 * 实测（pdfjs-dist 4.10.38，往页字典捅原始 /Rotate 后读回）：
 *   45→0、135→0、360→0、450→90、-90→270、720→0。
 * 非和规 /Rotate 上"四舍五入"会让框按 90° 算而页面按 0° 渲染，屏幕上的
 * 框和盖底都会偏；和规件上两种规则等价，零风险。互证见
 * scripts/test-pdf-geo-cross.mjs 的"旋转归一轮换表"腿。
 */
export function normRot(deg: number): Rot {
  const r = ((deg % 360) + 360) % 360
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
 * 一个文字项的几何：pdf.js 的 TextItem 换算成两个空间各一份坐标。
 * 写回 PDF 用未旋转空间的基线起点，命中与画框用显示空间的包围盒。
 */
export interface TextItemGeom {
  /** 未旋转 PDF 空间基线起点 x（左）——写回 drawText 用 */
  x: number
  /** 未旋转 PDF 空间基线 y——写回 drawText 用 */
  y: number
  /** 字号 pt（transform 字身向量的长度；旋转不改变它，横竖排同一算法） */
  size: number
  /** 显示空间包围盒——命中与画虚线框用 */
  box: PdfRect
  str: string
}

/**
 * pdf.js TextItem → 双空间几何（纯函数，node 侧可测）。
 *
 * `transform` 是 pdf.js 的 `[a,b,c,d,e,f]`：e/f 落在**未旋转 PDF 空间**
 * （原点左下、y 向上），因为 ctm 从单位矩阵起只受内容流 `cm` 影响，页面的
 * /Rotate 不掺和（见 pdf-text-edit.ts 头注的坐标空间论证）。
 *
 * 前四元是**已按字号缩放的旋转矩阵**，方向语义经 pdf-lib `rotate` 造件 +
 * pdfjs 4.10.38 读回实证（scripts/test-pdf-geo-cross.mjs 的竖排腿同款探针）：
 *   - `(a,b)` 步进向量：文字阅读方向 × 字号
 *   - `(c,d)` 字身向量：上升方向 × 字号
 * 横排 `[s,0,0,s,e,f]`；竖排文字向下、字头朝右 `[0,-s,s,0,e,f]`；
 * 反向竖排 `[0,s,-s,0,e,f]`。`width` 是沿步进方向的步进 pt，与文字方向
 * 无关（同一串文字横排与竖排，pdf.js 报出的 width 相同）。
 *
 * 盒 = 字 run 的**真盒子**取轴对齐包围：从基线起点 (e,f) 沿步进方向走
 * `width`，沿字身方向铺开上升 0.85×size、下降 0.25×size（拉丁与 CJK 的
 * 典型占位）——宁可多盖一丝底色，也不能留一格原字形。横排时与旧的水平盒
 * 一致；竖排时盒跟着文字方向换轴（长边贴步进、字头朝向由 inset 体现）；
 * 斜排取旋转后真盒的包围——仍是近似，但贴着真墨迹而非按水平猜。
 *
 * 写回位置不受方向影响：x/y 就是 e/f，size 取字身向量长度。
 * 已知口子（下一档）：竖排文字的改字写回仍按横排画在起点（applyTextEdits
 * 不过 direction），要方向保持只需给 TextEdit 加一个 angle 字段转给
 * pdf-lib drawText 的 rotate。
 */
export function textItemBox(
  transform: number[] | undefined,
  width: number | undefined,
  str: string | undefined,
  rot: Rot,
  base: { w: number; h: number },
): TextItemGeom | null {
  if (!transform || !str) return null
  const size = Math.hypot(transform[2], transform[3])
  if (!(size > 0)) return null
  const advLen = Math.hypot(transform[0], transform[1])
  const w = Math.abs(width ?? 0)
  const x = transform[4]
  const y = transform[5]
  // 步进方向单位向量；矩阵退化（(a,b) 全零，只剩缩放）时按横排兜底
  const ux = advLen > 0 ? transform[0] / advLen : 1
  const uy = advLen > 0 ? transform[1] / advLen : 0
  // 字身方向单位向量（上升为正）
  const vx = transform[2] / size
  const vy = transform[3] / size
  // 真盒四角：起点与步进终点，各在字身方向铺开 [-0.25s, +0.85s]。
  // 横排（u=(1,0), v=(0,1)）时四角即 (x, y-0.25s)…(x+w, y+0.85s)，
  // 与旧的"水平盒"是同一个矩形
  const desc = -0.25 * size
  const asc = 0.85 * size
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const t of [0, w]) {
    const px = x + t * ux
    const py = y + t * uy
    for (const off of [desc, asc]) {
      const cx = px + off * vx
      const cy = py + off * vy
      if (cx < x0) x0 = cx
      if (cx > x1) x1 = cx
      if (cy < y0) y0 = cy
      if (cy > y1) y1 = cy
    }
  }
  const pdfBox: PdfRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  // PDF 左下原点 → 未旋转左上 → 显示空间
  const unrot: PdfRect = {
    x: pdfBox.x,
    y: base.h - (pdfBox.y + pdfBox.h),
    w: pdfBox.w,
    h: pdfBox.h,
  }
  return { x, y, size, box: toDisplayRect(unrot, rot, base), str }
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

/**
 * 页码钳制的单一事实源：直接转调 Writer 打印预览那份 `clampPage`
 * （`scripts/test-print-pager.mjs` 已钉住它的下界/上界/NaN/非正 total 边界）。
 * 不在 PDF 侧重写一遍 Math.max/Math.min——工具条里散落的三处手写钳制吃过这个亏。
 */
import { clampPage } from './print-preview'
export const clampPdfPage = clampPage

/** 页码导航四枚目标页 + 两端可用状态（v0.184，纯函数） */
export interface PageNav {
  first: number
  prev: number
  next: number
  last: number
  canPrev: boolean
  canNext: boolean
}

/**
 * 首页/上一页/下一页/末页一次算全。total 的归一也走 clampPage（取它夹出的上界），
 * 于是「没打开文档 / total=0 / NaN」这些边界与 Writer 预览逐字同口径。
 */
export function pageNav(cur: number, total: number): PageNav {
  const t = clampPage(Number.MAX_SAFE_INTEGER, total)
  const c = clampPage(cur, t)
  return {
    first: 1,
    prev: clampPage(c - 1, t),
    next: clampPage(c + 1, t),
    last: t,
    canPrev: c > 1,
    canNext: c < t,
  }
}
