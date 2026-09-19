// 图表 PNG 渲染：ChartPayload → VChart spec → 离屏画布 → dataURL（VChart 按需动态加载，独立 chunk）
import type { ISpec } from '@visactor/vchart'
import type { ChartPayload } from './fs'

type Records = Record<string, string | number>[]

export function buildVChartSpec(payload: ChartPayload, scale = 2): Record<string, unknown> {
  const { chartType, grouping, title } = payload
  const base: Record<string, unknown> = {
    width: payload.width * scale,
    height: payload.height * scale,
    background: 'transparent',
    animation: false,
    title: title ? { text: title, visible: true } : { visible: false },
  }
  if (chartType === 'pie' || chartType === 'doughnut') {
    const s = payload.series[0]
    const values = (s?.vals ?? []).map((v, i) => ({
      name: String(s.cats[i] ?? `#${i + 1}`),
      value: v,
    }))
    return {
      ...base,
      type: 'pie',
      categoryField: 'name',
      valueField: 'value',
      data: [{ id: 'd0', values }],
      ...(chartType === 'doughnut' ? { innerRadius: 0.5, radius: 0.9 } : { radius: 0.9 }),
      label: { visible: true },
      legends: { visible: true },
    }
  }
  const isPct = grouping === 'percentStacked'
  const n = Math.max(...payload.series.map((s) => s.vals.length), 0)
  const records: Records = []
  for (let i = 0; i < n; i++) {
    payload.series.forEach((s, si) => {
      records.push({
        cat: String(s.cats[i] ?? payload.series[0]?.cats[i] ?? `#${i + 1}`),
        series: s.name || `系列${si + 1}`,
        val: s.vals[i] ?? 0,
      })
    })
  }
  const spec: Record<string, unknown> = {
    ...base,
    type: chartType === 'column' ? 'bar' : chartType,
    data: [{ id: 'd0', values: records }],
    xField: 'cat',
    yField: 'val',
    seriesField: 'series',
    // VChart 有 seriesField 时默认堆叠（base-series-transformer），standard 必须显式关闭
    stack: grouping === 'stacked' || isPct,
    ...(isPct ? { percent: true } : {}),
    legends: { visible: true },
  }
  if (chartType === 'bar') spec.direction = 'left'
  return spec
}

let vchartPromise: Promise<typeof import('@visactor/vchart').default> | null = null

function loadVChart() {
  if (!vchartPromise) {
    vchartPromise = import('@visactor/vchart').then((m) => m.default)
  }
  return vchartPromise
}

export async function renderChartPng(payload: ChartPayload, scale = 2): Promise<string> {
  const VChart = await loadVChart()
  const width = payload.width * scale
  const height = payload.height * scale
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;`
  document.body.appendChild(host)
  try {
    const chart = new VChart(buildVChartSpec(payload, scale) as unknown as ISpec, { dom: host })
    await chart.renderAsync()
    const canvas = host.querySelector('canvas')
    if (!canvas) throw new Error('VChart 未产出 canvas')
    const url = canvas.toDataURL('image/png')
    chart.release()
    return url
  } finally {
    host.remove()
  }
}
