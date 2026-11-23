// 数据透视表（v0.231）：从选区网格算出一张结果表的纯函数。
//
// 为什么自研而不用 Univer 的 pivot preset：那个在 @univerjs-pro 下、要商业授权，
// 本项目是本地优先的开源四套件，不引入授权依赖。这里只做「建得起来」这一档——
// 行/列/值三个字段 + 五种汇总，结果写进新工作表，用户能读能改能导出 xlsx。
//
// 边界（诚实清单）：不做多值字段嵌套、不做切片器/日期分组、不写 OOXML 原生
// pivotCache 部件（Rust 侧 xlsx_preserve 只负责把**已有**透视表整份搬过保存链）。
// 本模块产出的是一张普通结果表——这是「建得起来」而不是「Excel 透视表全功能」。

export type PivotAgg = 'count' | 'sum' | 'avg' | 'min' | 'max'
export const PIVOT_AGGS: { value: PivotAgg; label: string }[] = [
  { value: 'count', label: '计数' },
  { value: 'sum', label: '求和' },
  { value: 'avg', label: '平均' },
  { value: 'min', label: '最小' },
  { value: 'max', label: '最大' },
]

export interface PivotSpec {
  /** 源网格（首行是字段名） */
  grid: (string | number | boolean | null)[][]
  /** 行字段名（可空：只有列维度） */
  rowField: string
  /** 列字段名（可空：只有行维度） */
  colField: string
  /** 值字段名 */
  valueField: string
  agg: PivotAgg
}

export interface PivotResult {
  /** 结果表：首行表头，其余为数据行；列字段值横向展开 */
  rows: (string | number)[][]
  /** 实际参与汇总的数据行数（丢掉空值行后的） */
  used: number
  /** 被跳过的原因计数（值字段空/非数），用于界面如实报数 */
  skipped: number
}

const cellText = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const numOf = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** 汇总一组数；count 数的是非空值，其余只吃数字 */
function aggregate(values: unknown[], agg: PivotAgg): number {
  if (agg === 'count') return values.filter((v) => v !== null && v !== undefined && v !== '').length
  const nums = values.map(numOf).filter((n): n is number => n !== null)
  if (!nums.length) return 0
  switch (agg) {
    case 'sum': return nums.reduce((a, b) => a + b, 0)
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
  }
}

/** 按字段名取列下标；找不到返回 -1（界面据此提示配置错误） */
export function fieldIndex(header: unknown[], field: string): number {
  if (!field) return -1
  return header.findIndex((h) => cellText(h) === field)
}

/**
 * 建透视表。行列都不给时退化为「全表一行汇总」；只给一维时只出单列表头。
 * 列字段的去重值按**首次出现序**排列（不排序）——源表顺序才是用户看到的顺序，
 * 排序会造出源里没有的语义。
 */
export function buildPivot(spec: PivotSpec): PivotResult {
  const grid = spec.grid
  if (!grid.length || !grid[0]) return { rows: [], used: 0, skipped: 0 }
  const header = grid[0]
  const ri = fieldIndex(header, spec.rowField)
  const ci = fieldIndex(header, spec.colField)
  const vi = fieldIndex(header, spec.valueField)
  if (vi < 0) return { rows: [], used: 0, skipped: 0 }

  const data = grid.slice(1).filter((r) => r.some((c) => c !== null && c !== ''))
  const colKeys: string[] = []
  for (const r of data) {
    if (ci < 0) break
    const k = cellText(r[ci])
    if (k && !colKeys.includes(k)) colKeys.push(k)
  }
  const rowKeys: string[] = []
  for (const r of data) {
    if (ri < 0) break
    const k = cellText(r[ri])
    if (k && !rowKeys.includes(k)) rowKeys.push(k)
  }

  // 分桶：map[行][列] = 值数组
  const buckets = new Map<string, Map<string, unknown[]>>()
  let used = 0
  let skipped = 0
  for (const r of data) {
    const rv = ri < 0 ? '' : cellText(r[ri])
    const cv = ci < 0 ? '' : cellText(r[ci])
    const value = r[vi]
    if (spec.agg !== 'count' && numOf(value) === null) skipped++
    if (!buckets.has(rv)) buckets.set(rv, new Map())
    const row = buckets.get(rv)!
    if (!row.has(cv)) row.set(cv, [])
    row.get(cv)!.push(value)
    used++
  }

  // 输出约定：有列维度 → 表头 [行字段, 各列值, 总计]；无列维度 → [行字段, 总计]。
  // 零维度（行列都不给）→ 单行 [总计, 全表汇总]。
  const head: (string | number)[] = [ri >= 0 ? spec.rowField : '总计']
  for (const c of colKeys) head.push(c)
  head.push('总计')
  const rows: (string | number)[][] = [head]

  const keys = ri >= 0 ? rowKeys : (buckets.has('') ? [''] : [])
  for (const rk of keys) {
    const row = buckets.get(rk) ?? new Map()
    const out: (string | number)[] = [ri >= 0 ? (rk || '(空白)') : '总计']
    for (const c of colKeys) out.push(aggregate(row.get(c) ?? [], spec.agg))
    out.push(aggregate([...row.values()].flat(), spec.agg))
    rows.push(out)
  }

  if (ri >= 0) {
    const total: (string | number)[] = ['总计']
    for (const c of colKeys) {
      const perCol: unknown[] = []
      for (const row of buckets.values()) perCol.push(...(row.get(c) ?? []))
      total.push(aggregate(perCol, spec.agg))
    }
    const all: unknown[] = []
    for (const row of buckets.values()) for (const v of row.values()) all.push(...v)
    total.push(aggregate(all, spec.agg))
    rows.push(total)
  }
  return { rows, used, skipped }
}
