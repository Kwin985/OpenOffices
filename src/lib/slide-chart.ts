// 演示图表 PNG 的运行时缓存（v0.127）
//
// 图表形状只把**数据**存进 .opd，图本身不入库——一张 PNG base64 动辄几百 KB，
// 存进文件是拿体积换一次「打开就有图」。于是这里做一层进程内缓存：
// 数据没变就不重渲，渲好了通知订阅者重画，没渲好调用方先画占位框。
// 代价是关掉应用图就没了，下次开要重渲——图表渲染是几十毫秒的事，这个账划算。

import { useEffect, useReducer } from 'react'
import { renderSlideChartPng } from './chart'
import type { SlideChartData, SlideShape } from './ppt'

interface Entry {
  key: string
  png: string
}

const cache = new Map<string, Entry>()
const inflight = new Set<string>()
const subs = new Set<() => void>()

/** 缓存键只认「画出来会变」的那几项：位置与盒子的大小变了不必重渲 */
function keyOf(d: SlideChartData, w: number, h: number): string {
  return JSON.stringify([
    d.chartType,
    d.title ?? '',
    !!d.stacked,
    d.cats,
    d.series,
    Math.round(w),
    Math.round(h),
  ])
}

function notify(): void {
  for (const f of subs) f()
}

/** 订阅「某张图渲好了」。返回退订函数，直接交给 useEffect 的清理 */
export function subscribeSlideChart(fn: () => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

/** 同步取：渲好了给 dataURL，没好给 undefined（调用方画占位） */
export function slideChartPng(sh: SlideShape): string | undefined {
  return cache.get(sh.id)?.png
}

/**
 * 起一次渲染。幂等：同键已在飞就不重复起，缓存命中且键未变则什么都不做。
 * 失败不抛——图表渲不出来最多是没图，不该把整页幻灯片拖成错误态。
 */
export function ensureSlideChartPng(sh: SlideShape, w: number, h: number): void {
  const d = sh.chart
  if (!d) return
  const cw = Math.max(64, Math.min(w, 4096))
  const ch = Math.max(64, Math.min(h, 4096))
  const key = keyOf(d, cw, ch)
  const hit = cache.get(sh.id)
  if (hit && hit.key === key) return
  const token = `${sh.id}|${key}`
  if (inflight.has(token)) return
  inflight.add(token)
  renderSlideChartPng(d, cw, ch)
    .then((png) => {
      cache.set(sh.id, { key, png })
    })
    .catch(() => {
      // 渲不出来就让它没图：调用方的占位框会说明「这里本该有一张图」
    })
    .finally(() => {
      inflight.delete(token)
      notify()
    })
}

/**
 * 取图表 PNG 并在需要时起渲染。必须在**组件顶层**调用（不能在 map 里循环调），
 * 所以形状那一层要为图表单独抽一个子组件，而不是在 StaticSlide 里就地用。
 */
export function useSlideChartPng(
  sh: SlideShape | undefined,
  w: number,
  h: number,
): string | undefined {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeSlideChart(force), [])
  useEffect(() => {
    if (sh) ensureSlideChartPng(sh, w, h)
  }, [sh, w, h])
  return sh ? slideChartPng(sh) : undefined
}


// ---- 图表的 CSV 编辑通道 ----
//
// 演示里那枚形状的编辑面板放不下「逐个格子填」的网格，于是走 CSV：
// 第一行是系列名（首格空），其后每行「类目,值,值…」。够简陋，但一个 textarea
// 就能改完一张图的所有数，且人看得懂、也贴得进 Excel。

/** 逗号分隔：不处理引号转义——演示图表的数据里带逗号是极少数，不值得为它引入一个解析器 */
function splitCsv(line: string): string[] {
  return line.split(',').map((c) => c.trim())
}

export function chartToCsv(d: SlideChartData): string {
  const head = ['', ...d.series.map((s) => s.name)].join(',')
  const n = Math.max(d.cats.length, ...d.series.map((s) => s.vals.length), 0)
  const rows = Array.from({ length: n }, (_, i) =>
    [d.cats[i] ?? '', ...d.series.map((s) => (s.vals[i] == null ? '' : String(s.vals[i])))].join(','),
  )
  return [head, ...rows].join('\n')
}

/**
 * CSV → 图表数据。认不出来就当「没说」而不是报错：
 * 值栏空或非数字落 null（VChart 画成断口，好过悄悄填 0 造出一根假柱子）；
 * 一行系列都没有时返回空数据，调用方据此不落形状。
 */
export function parseChartCsv(text: string): Pick<SlideChartData, 'cats' | 'series'> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (!lines.length) return { cats: [], series: [] }
  const names = splitCsv(lines[0]).slice(1)
  const cats: string[] = []
  const cols: (number | null)[][] = names.map(() => [])
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line)
    cats.push(cells[0] ?? '')
    names.forEach((_, i) => {
      const raw = cells[i + 1]
      if (raw === undefined || raw === '') {
        cols[i].push(null)
        return
      }
      const n = Number(raw)
      cols[i].push(Number.isFinite(n) ? n : null)
    })
  }
  return { cats, series: names.map((name, i) => ({ name, vals: cols[i] })) }
}

/** 形状挪走/删掉之后清掉它的缓存条目，免得 id 复用时串出上一张图 */
export function dropSlideChart(id: string): void {
  cache.delete(id)
}
