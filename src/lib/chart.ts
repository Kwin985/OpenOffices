// 图表 PNG 渲染：ChartPayload → VChart spec → 离屏画布 → dataURL（VChart 按需动态加载，独立 chunk）
import type { ISpec } from '@visactor/vchart'
import type { ChartAxisPayload, ChartPayload } from './fs'

/** 散点图 X 轴是数值轴：cats 存的是 xVal 取出的数，取不到就让 VChart 判为无效（NaN） */
function numOf(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : Number.NaN
  }
  return Number.NaN
}

type Records = Record<string, string | number>[]

/** 显示单位：Excel 内置十档在中文界面上写的短名；自定义档（custUnit）就是数字串，原样显示 */
const UNIT_TEXT: Record<string, string> = {
  hundreds: '百',
  thousands: '千',
  tenThousands: '万',
  hundredThousands: '十万',
  millions: '百万',
  tenMillions: '千万',
  hundredMillions: '亿',
  billions: '十亿',
  trillions: '万亿',
}

/** 轴标题/刻度/显示单位等 → VChart 轴片段。只填"说了话"的项，没说的留给 VChart 默认 */
function axisExtras(a: ChartAxisPayload | undefined, numeric: boolean): Record<string, unknown> {
  if (!a) return {}
  const out: Record<string, unknown> = {}
  if (a.title) out.title = { visible: true, text: a.title }
  // 刻度范围与对数只对数值轴有意义：类目轴是 band，给它 min/max 会把标签切掉
  if (numeric) {
    if (typeof a.min === 'number') out.min = a.min
    if (typeof a.max === 'number') out.max = a.max
    if (typeof a.logBase === 'number' && a.logBase >= 2) {
      out.type = 'log'
      out.base = a.logBase
    }
    if (typeof a.majorUnit === 'number' && a.majorUnit > 0) {
      out.tick = { tickStep: a.majorUnit }
    }
    if (a.displayUnit) {
      out.unit = { visible: true, text: UNIT_TEXT[a.displayUnit] ?? a.displayUnit }
    }
  }
  if (a.reverse) out.inverse = true
  if (a.hidden) out.visible = false
  return out
}

/** 按 kind 与次序把轴载荷分派到"类目/主值/次值"三个槽上 */
function pickAxes(payload: ChartPayload) {
  const axes = payload.axes ?? []
  const vals = axes.filter((a) => a.kind === 'val')
  // 散点图两根都是值轴：靠 axPos 分 X（b）与 Y（l），认不出来才退回出现次序
  if (payload.chartType === 'scatter') {
    const byPos = (p: string) => vals.find((a) => a.pos === p)
    return { cat: byPos('b') ?? vals[0], main: byPos('l') ?? vals[1], sec: undefined as ChartAxisPayload | undefined }
  }
  return {
    cat: axes.find((a) => a.kind === 'cat'),
    main: vals[0],
    sec: vals[1],
  }
}

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
  // VChart 没有股价图类型：stock 的 OHLC 语义退化成「共享类别轴上的多条折线」（写侧仍按原生 stock 回写）
  const kind = chartType === 'stock' ? 'line' : chartType
  const n = Math.max(...payload.series.map((s) => s.vals.length), 0)
  const records: Records = []
  for (let i = 0; i < n; i++) {
    payload.series.forEach((s, si) => {
      const raw = s.cats[i] ?? payload.series[0]?.cats[i] ?? `#${i + 1}`
      // 散点图两轴都是数值：X 走 numOf（Excel 无 X 值时按 1,2,3… 序号，这里同样退回到序号）
      const x = numOf(s.cats[i] ?? payload.series[0]?.cats[i])
      records.push({
        cat: chartType === 'scatter' ? (Number.isFinite(x) ? x : i + 1) : String(raw),
        series: s.name || `系列${si + 1}`,
        val: s.vals[i] ?? 0,
      })
    })
  }
  // 组合图：任一系列自带图型 ⇒ 走 VChart 的 common（每条系列各自声明 type）
  // 只接「竖轴笛卡尔」那一族（column/line/area/stock）：凑进横向 bar 会让类别轴该在左还是在下说不清，
  // 那类组合退回单一图型分支（画得不对但至少不炸），挂账待办
  // 次轴也走这一支：同型但分轴的图（双轴柱形）VChart 的单一图型分支不接 axes，只有 common 能分开画
  const secIdx = new Set<number>()
  payload.series.forEach((s, si) => {
    if (s.secondaryAxis) secIdx.add(si)
  })
  const hasSec = secIdx.size > 0
  const combo =
    payload.series.some((s) => s.chartType && s.chartType !== chartType) || hasSec
  const VERTICAL = new Set(['column', 'line', 'area', 'stock'])
  if (combo && payload.series.every((s) => VERTICAL.has(s.chartType ?? chartType))) {
    const vType = (t: string) => (t === 'column' ? 'bar' : t === 'stock' ? 'line' : t)
    // 分轴时系列要带 id：VChart 的轴靠 seriesId 认领系列（base-chart-transformer），没 id 就配不上
    const idOf = (si: number) => `s${si}`
    const mainIds = payload.series.map((_, si) => idOf(si)).filter((_, si) => !secIdx.has(si))
    const secIds = payload.series.map((_, si) => idOf(si)).filter((_, si) => secIdx.has(si))
    const ax = pickAxes(payload)
    const valueAxes: Record<string, unknown>[] = hasSec
      ? [
          {
            orient: 'left',
            type: 'linear',
            field: 'val',
            // 主轴也圈定系列：否则它会连次轴那几条一起画，两根轴挤在同一侧的值上
            ...(mainIds.length ? { seriesId: mainIds } : {}),
            ...axisExtras(ax.main, true),
          },
          {
            orient: 'right',
            type: 'linear',
            field: 'val',
            seriesId: secIds,
            ...axisExtras(ax.sec, true),
          },
        ]
      : [{ orient: 'left', type: 'linear', field: 'val', ...axisExtras(ax.main, true) }]
    const catAxisSpec: Record<string, unknown> = {
      orient: 'bottom',
      type: 'band',
      field: 'cat',
      ...axisExtras(ax.cat, false),
    }
    return {
      ...base,
      type: 'common',
      // 一条系列一份数据：common 图靠 dataId 认领，不能像单一图型那样挤在一张表里
      data: payload.series.map((s, si) => ({
        id: `d${si}`,
        values: Array.from({ length: n }, (_, i) => ({
          cat: String(s.cats[i] ?? payload.series[0]?.cats[i] ?? `#${i + 1}`),
          val: s.vals[i] ?? 0,
        })),
      })),
      series: payload.series.map((s, si) => ({
        type: vType(s.chartType ?? chartType),
        xField: 'cat',
        yField: 'val',
        dataId: `d${si}`,
        ...(hasSec ? { id: idOf(si) } : {}),
        name: s.name || `系列${si + 1}`,
        stack: grouping === 'stacked' || isPct,
        ...(isPct ? { percent: true } : {}),
      })),
      axes: [catAxisSpec, ...valueAxes],
      legends: { visible: true },
    }
  }
  if (chartType === 'radar') {
    // Excel 三种雷达样式：standard 仅线 / marker 线+点 / filled 线+面
    const style = payload.radarStyle ?? 'standard'
    return {
      ...base,
      type: 'radar',
      data: [{ id: 'd0', values: records }],
      categoryField: 'cat',
      valueField: 'val',
      seriesField: 'series',
      point: { visible: style === 'marker' },
      area: { visible: style === 'filled' },
      legends: { visible: true },
    }
  }
  if (chartType === 'scatter') {
    // Excel 五种散点样式：marker 仅标记 / line 仅直线 / lineMarker 直线+标记 / smooth / smoothMarker
    // VChart 的 scatter 系列只有 point 标记、没有 line 标记 ⇒ 连线型一律退化为「只画点」，写侧仍保真回写原生样式
    const style = payload.scatterStyle ?? 'marker'
    const ax = pickAxes(payload)
    return {
      ...base,
      type: 'scatter',
      data: [{ id: 'd0', values: records }],
      xField: 'cat',
      yField: 'val',
      seriesField: 'series',
      point: { visible: style !== 'line' && style !== 'smooth', size: 8 },
      // 散点两根都是数值轴（载荷里 kind 都是 val），X/Y 的刻度与标题各回各的轴
      ...(payload.axes?.length
        ? {
            axes: [
              {
                orient: 'bottom',
                type: 'linear',
                field: 'cat',
                ...axisExtras(ax.cat, true),
              },
              { orient: 'left', type: 'linear', field: 'val', ...axisExtras(ax.main, true) },
            ],
          }
        : {}),
      legends: { visible: true },
    }
  }
  const spec: Record<string, unknown> = {
    ...base,
    type: kind === 'column' ? 'bar' : kind,
    data: [{ id: 'd0', values: records }],
    xField: 'cat',
    yField: 'val',
    seriesField: 'series',
    // VChart 有 seriesField 时默认堆叠（base-series-transformer），standard 必须显式关闭
    stack: grouping === 'stacked' || isPct,
    ...(isPct ? { percent: true } : {}),
    legends: { visible: true },
  }
  if (kind === 'bar') spec.direction = 'left'
  // 有轴信息且是竖轴笛卡尔才接：横条（bar）两轴掉个儿、雷达是极坐标，轴的语义不是 bottom/left 那一套（挂账）
  if (payload.axes?.length && kind !== 'bar') {
    const ax = pickAxes(payload)
    spec.axes = [
      { orient: 'bottom', type: 'band', field: 'cat', ...axisExtras(ax.cat, false) },
      { orient: 'left', type: 'linear', field: 'val', ...axisExtras(ax.main, true) },
    ]
  }
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
