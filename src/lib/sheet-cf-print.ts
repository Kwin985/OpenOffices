// 条件格式求值（打印侧）：Univer 在画布上自己算，我们的 PDF 是自绘网格，
// 所以同一批判定要在载荷上再算一遍。分工照"算得出的绝不抄缓存、算不出的绝不假装"：
// 数值/文本/重复/排名/均值/色阶/数据条算得出就画，公式判定、日期区间、图标集算不出就记账。
import type { CondFormatPayload, CondFormatStyle, CondFormatStop, RangeRect, SheetPayload } from './fs'

type CellValue = string | number | boolean | null

/** 一格的条件格式结果：只带"要盖掉静态样式"的那几样 */
export interface CfPatch {
  bg?: string
  cl?: string
  bl?: boolean
  it?: boolean
  ul?: boolean
  st?: boolean
  /** 数据条的 CSS background-image（Excel 画在格内的那根条） */
  bar?: string
  /** showValue=false：条自己会说话，值不再打印 */
  hideValue?: boolean
}

export interface CfPrintResult {
  patches: Map<string, CfPatch>
  notes: string[]
}

/** 打印窗口上限：整列引用这类矩形要按它裁剪，否则一条规则循环 104 万格 */
export const PRINT_MAX_ROWS = 2000
export const PRINT_MAX_COLS = 120

const key = (r: number, c: number) => `${r},${c}`

/** 每格补丁；返回 null 表示这条规则在这一格没命中 */
type Patcher = (r: number, c: number, v: CellValue) => CfPatch | null

function cellsIn(rects: RangeRect[], maxRow: number, maxCol: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of rects) {
    const r2 = Math.min(x.endRow, maxRow)
    const c2 = Math.min(x.endColumn, maxCol)
    for (let r = Math.max(0, x.startRow); r <= r2; r++) {
      for (let c = Math.max(0, x.startColumn); c <= c2; c++) {
        const k = key(r, c)
        if (!seen.has(k)) {
          seen.add(k)
          out.push(k)
        }
      }
    }
  }
  return out
}

function asNumber(v: CellValue | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  return null
}

function asText(v: CellValue | undefined): string {
  return v === null || v === undefined ? '' : String(v)
}

function num(v: string | number | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function hex(c: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 两色按 t（0→a，1→b）插值；认不出的色不硬凑，直接交回起点色 */
function mix(a: string, b: string, t: number): string {
  const x = hex(a)
  const y = hex(b)
  if (!x || !y) return a
  const p = Math.max(0, Math.min(1, t))
  return `#${x
    .map((v, i) => Math.round(v + (y[i] - v) * p))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`
}

/** 规则区里的数字值：文本不参与端点计算 */
function rangeNumbers(rule: CondFormatPayload, grid: Map<string, CellValue>): number[] {
  const out: number[] = []
  for (const k of cellsIn(rule.ranges, PRINT_MAX_ROWS - 1, PRINT_MAX_COLS - 1)) {
    const n = asNumber(grid.get(k))
    if (n != null) out.push(n)
  }
  return out
}

/** 档位端点换成一个数：min/max/num/percent/percentile 算得出，formula/auto 交 null */
function stopValue(stop: CondFormatStop, values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const lo = sorted[0]
  const hi = sorted[sorted.length - 1]
  switch (stop.t) {
    case 'min':
      return lo
    case 'max':
      return hi
    case 'num':
      return stop.v == null ? null : num(stop.v)
    case 'percent':
      return lo + ((hi - lo) * num(stop.v)) / 100
    case 'percentile': {
      // Excel 的分位数是在排序列上线性插值出来的，不是"取第 n 个"
      const idx = (num(stop.v) / 100) * (sorted.length - 1)
      const i = Math.floor(idx)
      const next = sorted[Math.min(i + 1, sorted.length - 1)]
      return sorted[i] + (next - sorted[i]) * (idx - i)
    }
    default:
      return null
  }
}

function judgeNumber(op: string, a: number, b: number, x: number): boolean {
  switch (op) {
    case 'lessThan':
      return x < a
    case 'lessThanOrEqual':
      return x <= a
    case 'equal':
      return x === a
    case 'notEqual':
      return x !== a
    case 'greaterThan':
      return x > a
    case 'greaterThanOrEqual':
      return x >= a
    case 'between':
      return x >= Math.min(a, b) && x <= Math.max(a, b)
    case 'notBetween':
      return !(x >= Math.min(a, b) && x <= Math.max(a, b))
    default:
      return false
  }
}

/** 空条件串在界面里是"格为空"那一项，不是"包含空串"（后者会命中区域里所有格） */
function judgeText(op: string, want: string, got: string): boolean {
  switch (op) {
    case 'containsText':
      return want === '' ? got === '' : got.includes(want)
    case 'notContains':
      return !got.includes(want)
    case 'beginsWith':
      return got.startsWith(want)
    case 'endsWith':
      return got.endsWith(want)
    case 'equal':
      return got === want
    case 'notEqual':
      return got !== want
    default:
      return false
  }
}

function fmtPatch(fmt: CondFormatStyle): CfPatch {
  return {
    ...(fmt.bg ? { bg: fmt.bg } : {}),
    ...(fmt.cl ? { cl: fmt.cl } : {}),
    ...(fmt.bl ? { bl: true } : {}),
    ...(fmt.it ? { it: true } : {}),
    ...(fmt.ul ? { ul: true } : {}),
    ...(fmt.st ? { st: true } : {}),
  }
}

/** 判定用的文本：数字 1 与文本 "1" 归一成一个键——Excel 那套比较（COUNTIF 语义）不分类型，
 *  且文本判定本就不分大小写，两类判定共用这一个写法 */
function textOf(v: CellValue | undefined): string {
  const n = asNumber(v)
  return (n == null ? asText(v) : String(n)).toLowerCase()
}

function scalePatcher(
  rule: CondFormatPayload,
  grid: Map<string, CellValue>,
  notes: string[],
): Patcher | null {
  const stops = rule.scale ?? []
  if (stops.length < 2) {
    notes.push('有条色阶档位不足两档，打印里没画')
    return null
  }
  const vals = rangeNumbers(rule, grid)
  if (vals.length < 2) return null
  const ends = stops.map((s) => stopValue(s, vals))
  if (ends.some((e) => e == null)) {
    notes.push('有条色阶的档位端点算不出（公式或自动），打印里没画')
    return null
  }
  return (_r, _c, v) => {
    const x = asNumber(v)
    if (x == null) return null
    for (let i = 0; i < ends.length - 1; i++) {
      const a = ends[i] as number
      const b = ends[i + 1] as number
      if (x >= Math.min(a, b) && x <= Math.max(a, b)) {
        return { bg: mix(stops[i].color, stops[i + 1].color, a === b ? 0 : (x - a) / (b - a)) }
      }
    }
    // 自定义端点可能把数据夹在中间：越界按 Excel 的做法截到最近一档的颜色
    return { bg: x < (ends[0] as number) ? stops[0].color : stops[stops.length - 1].color }
  }
}

function barPatcher(
  rule: CondFormatPayload,
  grid: Map<string, CellValue>,
  notes: string[],
): Patcher | null {
  const bar = rule.bar
  if (!bar) return null
  const vals = rangeNumbers(rule, grid)
  if (vals.length < 2) return null
  const lo = stopValue({ color: bar.pos, t: bar.min.t, v: bar.min.v }, vals)
  const hi = stopValue({ color: bar.pos, t: bar.max.t, v: bar.max.v }, vals)
  if (lo == null || hi == null || hi === lo) {
    notes.push('有条数据条的端点算不出（公式、自动或区间为零），打印里没画')
    return null
  }
  const pct = (y: number) => ((Math.max(lo, Math.min(hi, y)) - lo) / (hi - lo)) * 100
  // 有负有正时 Excel 把条的起点放在 0 轴上，负值往左长
  const axis = lo < 0 && hi > 0 ? pct(0) : 0
  return (_r, _c, v) => {
    const x = asNumber(v)
    if (x == null) return null
    const at = pct(x)
    const from = Math.min(axis, at)
    const to = Math.max(axis, at)
    if (to - from <= 0) return null
    const color = x < 0 ? (bar.neg ?? bar.pos) : bar.pos
    // Excel 的渐变条靠轴那端浅、尖端深；实色条两端同色
    const start = bar.grad === false ? color : mix(color, '#ffffff', 0.45)
    const left = x < 0 ? color : start
    const right = x < 0 ? start : color
    const f = from.toFixed(2)
    const t = to.toFixed(2)
    const patch: CfPatch = {
      bar: `linear-gradient(to right, rgba(0,0,0,0) 0 ${f}%, ${left} ${f}%, ${right} ${t}%, rgba(0,0,0,0) ${t}% 100%)`,
    }
    if (rule.showValue === false) patch.hideValue = true
    return patch
  }
}

/** 一条规则 → 每格补丁；打印里没有画法或算不出时返回 null，并把话说在 notes 里 */
function patcherFor(
  rule: CondFormatPayload,
  grid: Map<string, CellValue>,
  notes: string[],
): Patcher | null {
  if (rule.kind === 'colorScale') return scalePatcher(rule, grid, notes)
  if (rule.kind === 'dataBar') return barPatcher(rule, grid, notes)
  if (rule.kind === 'iconSet') {
    notes.push('有条条件格式是图标集，打印里没有那套图标，未表现')
    return null
  }
  if (rule.kind !== 'cell') {
    notes.push(`有条条件格式是我们没画法的 ${rule.kind} 型，未表现`)
    return null
  }
  const sub = rule.sub ?? 'number'
  const op = rule.op ?? ''
  if (sub === 'formula') {
    notes.push('有条条件格式按公式判定，打印里没有公式引擎，未表现')
    return null
  }
  if (sub === 'timePeriod') {
    notes.push('有条条件格式按日期区间判定，值可能是序列号也可能是串，认不准就不画')
    return null
  }
  if (!rule.fmt) {
    notes.push('有条条件格式没带任何样式，打印里无处落笔，未表现')
    return null
  }
  const patch = fmtPatch(rule.fmt)
  if (sub === 'number') {
    const a = num(rule.v1)
    const b = num(rule.v2)
    return (_r, _c, v) => {
      const x = asNumber(v)
      return x != null && judgeNumber(op, a, b, x) ? patch : null
    }
  }
  if (sub === 'text') {
    const want = textOf(rule.v1)
    return (_r, _c, v) => (judgeText(op, want, textOf(v)) ? patch : null)
  }
  if (sub === 'duplicateValues' || sub === 'uniqueValues') {
    const count = new Map<string, number>()
    for (const k of cellsIn(rule.ranges, PRINT_MAX_ROWS - 1, PRINT_MAX_COLS - 1)) {
      const t = textOf(grid.get(k))
      count.set(t, (count.get(t) ?? 0) + 1)
    }
    const wantDup = sub === 'duplicateValues'
    return (_r, _c, v) => {
      const at = count.get(textOf(v)) ?? 0
      if (at === 0) return null
      return (wantDup ? at > 1 : at === 1) ? patch : null
    }
  }
  const vals = rangeNumbers(rule, grid)
  if (!vals.length) return null
  if (sub === 'rank') {
    const sorted = [...vals].sort((a, b) => a - b)
    const bottom = op === 'bottom' || op === 'bottomPercent'
    const percent = op === 'topPercent' || op === 'bottomPercent'
    const n = Math.max(1, Math.round(percent ? (num(rule.v1) / 100) * sorted.length : num(rule.v1)))
    // "前 N 项"含并列：以第 N 大的那个值为界，同值的整片都算进去（Excel 就是这么画的）
    const cutoff = bottom ? sorted[Math.min(n - 1, sorted.length - 1)] : sorted[sorted.length - n]
    if (cutoff == null) return null
    return (_r, _c, v) => {
      const x = asNumber(v)
      if (x == null) return null
      return (bottom ? x <= cutoff : x >= cutoff) ? patch : null
    }
  }
  if (sub === 'average') {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    return (_r, _c, v) => {
      const x = asNumber(v)
      return x != null && judgeNumber(op, mean, mean, x) ? patch : null
    }
  }
  notes.push(`有条条件格式（${sub}）的判定打印里算不出来，未表现`)
  return null
}

const PATCH_KEYS = ['bg', 'cl', 'bl', 'it', 'ul', 'st', 'bar', 'hideValue'] as const

/** 按优先级顺序吃规则：同一属性先命中的说话，stopIfTrue 之后的规则不再碰这一格 */
export function evalSheetCondFormats(sheet: SheetPayload): CfPrintResult {
  const notes: string[] = []
  const patches = new Map<string, CfPatch>()
  const rules = sheet.condFormats ?? []
  if (!rules.length) return { patches, notes }
  const grid = new Map<string, CellValue>()
  for (const c of sheet.cells) {
    if (c.r < PRINT_MAX_ROWS && c.c < PRINT_MAX_COLS) grid.set(key(c.r, c.c), c.v ?? null)
  }
  const stopped = new Set<string>()
  for (const rule of rules) {
    const patcher = patcherFor(rule, grid, notes)
    if (!patcher) continue
    for (const k of cellsIn(rule.ranges, PRINT_MAX_ROWS - 1, PRINT_MAX_COLS - 1)) {
      if (stopped.has(k)) continue
      const [r, c] = k.split(',').map(Number)
      const src = patcher(r, c, grid.get(k) ?? null)
      if (!src) continue
      const cur: CfPatch = patches.get(k) ?? {}
      let touched = false
      for (const p of PATCH_KEYS) {
        if (src[p] != null && cur[p] == null) {
          Object.assign(cur, { [p]: src[p] })
          touched = true
        }
      }
      if (touched) patches.set(k, cur)
      if (rule.stop) stopped.add(k)
    }
  }
  return { patches, notes }
}
