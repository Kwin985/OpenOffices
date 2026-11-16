/**
 * 幻灯片图表 · 兼容桩（v0.196 整合轮）
 *
 * 远程主线声称有 slide-chart.ts（幻灯片图表的 CSV 编辑 + PNG 缓存），
 * 源码从未提交。本桩把不依赖远程源码的纯函数做实（CSV 收发照常，
 * 用户改的数据不会丢），PNG 预览返回 undefined —— 编辑台与静态放映
 * 会显示占位框，导出侧由 chart.ts 的 renderSlideChartPng 现渲。
 */
import type { SlideChartData, SlideShape } from './ppt'

export function chartToCsv(chart: SlideChartData): string {
  const rows: string[][] = [
    ['', ...chart.series.map((s) => s.name)],
    ...chart.cats.map((cat, i) => [cat, ...chart.series.map((s) => String(s.vals[i] ?? ''))]),
  ]
  return rows
    .map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(','))
    .join('\n')
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (c === ',' && !quoted) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur.trim())
  return out
}

export function parseChartCsv(csv: string): Pick<SlideChartData, 'cats' | 'series'> {
  const rows = csv
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map(parseCsvLine)
  if (rows.length < 2) return { cats: [], series: [] }
  const names = rows[0].slice(1)
  const cats = rows.slice(1).map((row) => row[0] ?? '')
  const series = names.map((name, si) => ({
    name,
    vals: rows.slice(1).map((row) => {
      const raw = (row[si + 1] ?? '').trim()
      // 空单元格要留 null（空值在图表里是「缺一个数」，不是 0）
      if (!raw) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }),
  }))
  return { cats, series }
}

/** 桩没有 PNG 缓存要清，空操作即可 */
export function dropSlideChart(_id: string): void {
  /* 无状态 */
}

/** 桩不产出预览图；编辑台与静态放映会走占位框分支 */
export function useSlideChartPng(_sh: SlideShape, _w: number, _h: number): string | undefined {
  return undefined
}
