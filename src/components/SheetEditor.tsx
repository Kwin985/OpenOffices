import { memo, useEffect, useRef, useState } from 'react'
import { message } from '@tauri-apps/plugin-dialog'
import type { IWorkbookData } from '@univerjs/presets'
import type { FUniver } from '@univerjs/presets'
import type { Tab } from '../store'
import { useApp } from '../store'
import { createSheetApp } from '../lib/univer'
import { payloadToWorkbook, workbookToPayload } from '../lib/univer-io'
import { baseName, pickSaveFile, readXlsx, writeOds, writeXlsx } from '../lib/fs'
import type { ChartPayload, ChartRangeRef, ChartSeriesPayload, WorkbookPayload } from '../lib/fs'
import { renderChartPng } from '../lib/chart'
import { registerSaver } from '../lib/registry'

type FWorkbook = NonNullable<ReturnType<FUniver['getActiveWorkbook']>>
type FWorksheet = NonNullable<ReturnType<FWorkbook['getSheetByName']>>

interface Props {
  tab: Tab
}

interface ChartItem {
  sheetName: string
  payload: ChartPayload
}

const CHART_W = 480
const CHART_H = 320
const CHART_TYPES = [
  ['column', '柱形图'],
  ['bar', '条形图'],
  ['line', '折线图'],
  ['area', '面积图'],
  ['pie', '饼图'],
  ['doughnut', '环形图'],
] as const
const CARTESIAN = ['column', 'bar', 'line', 'area']

function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') return Number(v) || 0
  return 0
}

type CellValue = string | number | boolean | null

// 与 Rust 侧 cells_in 一致：单行按列取，否则按行取首列
function readRef(ws: FWorksheet, rf: ChartRangeRef): CellValue[] {
  const grid = ws
    .getRange(rf.r1, rf.c1, rf.r2 - rf.r1 + 1, rf.c2 - rf.c1 + 1)
    .getValues() as CellValue[][]
  if (rf.r1 === rf.r2) return grid[0] ?? []
  return grid.map((row) => row[0] ?? null)
}

function refWs(wb: FWorkbook, ref: ChartRangeRef, fallback: string): FWorksheet | null {
  return wb.getSheetByName(ref.sheet || fallback) ?? wb.getSheetByName(fallback)
}

// 从当前网格重算系列数值（图表 PNG 与写出 xlsx 都取最新数据）
function refreshPayloadValues(wb: FWorkbook, item: ChartItem): ChartPayload {
  const series = item.payload.series.map((s) => {
    const ws = refWs(wb, s.val, item.sheetName) ?? wb.getActiveSheet()
    const vals = readRef(ws, s.val).map(num)
    const catWs = s.cat ? refWs(wb, s.cat, item.sheetName) : null
    const cats = s.cat ? readRef(catWs ?? ws, s.cat) : []
    return { ...s, vals, cats }
  })
  return { ...item.payload, series }
}

interface AnchorHit {
  row: number
  col: number
  width: number
  height: number
}

function walkDrawings(node: unknown, found: Map<string, AnchorHit>) {
  if (Array.isArray(node)) {
    for (const n of node) walkDrawings(n, found)
    return
  }
  if (!node || typeof node !== 'object') return
  const o = node as Record<string, unknown>
  const st = o.sheetTransform as { from?: { row?: number; col?: number } } | undefined
  const id = typeof o.drawingId === 'string' ? o.drawingId : typeof o.id === 'string' ? o.id : null
  if (
    id &&
    typeof st?.from?.row === 'number' &&
    typeof st?.from?.col === 'number'
  ) {
    const tf = o.transform as { width?: number; height?: number } | undefined
    if (!found.has(id)) {
      found.set(id, {
        row: st.from.row,
        col: st.from.col,
        width: tf?.width ?? 0,
        height: tf?.height ?? 0,
      })
    }
  }
  for (const k of Object.keys(o)) walkDrawings(o[k], found)
}

// 从快照 resources 找浮动图片锚点（拖拽/缩放后同步位置，best-effort）
function drawingAnchors(snapshot: IWorkbookData): Map<string, AnchorHit> {
  const found = new Map<string, AnchorHit>()
  for (const res of snapshot.resources ?? []) {
    let data: unknown = res.data
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        continue
      }
    }
    walkDrawings(data, found)
  }
  return found
}

function payloadFromSelection(
  ws: FWorksheet,
  chartType: string,
  grouping: string,
  title: string,
): ChartPayload | null {
  const range = ws.getSelection()?.getActiveRange()
  if (!range) return null
  const r1 = range.getRow()
  const c1 = range.getColumn()
  const r2 = range.getLastRow()
  const c2 = range.getLastColumn()
  if (r2 - r1 < 1 || c2 - c1 < 1) return null
  const grid = ws
    .getRange(r1, c1, r2 - r1 + 1, c2 - c1 + 1)
    .getValues() as CellValue[][]
  const sheet = ws.getSheetName()
  const cats = grid.slice(1).map((row) => row[0])
  const series: ChartSeriesPayload[] = []
  for (let c = 1; c <= c2 - c1; c++) {
    series.push({
      name: String(grid[0][c] ?? `系列${c}`),
      cat: { sheet, r1: r1 + 1, c1, r2, c2: c1 },
      val: { sheet, r1: r1 + 1, c1: c1 + c, r2, c2: c1 + c },
      cats,
      vals: grid.slice(1).map((row) => num(row[c])),
    })
  }
  return {
    chartType,
    grouping,
    title,
    anchorRow: r1,
    anchorCol: c2 + 1,
    width: CHART_W,
    height: CHART_H,
    series,
  }
}

function SheetEditor({ tab }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<FUniver | null>(null)
  const chartsRef = useRef(new Map<string, ChartItem>())
  const [status, setStatus] = useState<string>(tab.path ? '正在加载…' : '')
  const [chartCount, setChartCount] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [chartType, setChartType] = useState('column')
  const [grouping, setGrouping] = useState('standard')
  const [chartTitle, setChartTitle] = useState('')
  const renameTab = useApp((s) => s.renameTab)
  const markDirty = useApp((s) => s.markDirty)
  const markRecent = useApp((s) => s.markRecent)

  const flash = (msg: string) => {
    setStatus(msg)
    setTimeout(() => setStatus(''), 1800)
  }

  const insertChartImage = async (api: FUniver, ws: FWorksheet, p: ChartPayload) => {
    const url = await renderChartPng(p)
    const image = await ws
      .newOverGridImage()
      .setSource(url, api.Enum.ImageSourceType.URL)
      .setColumn(p.anchorCol)
      .setRow(p.anchorRow)
      .setWidth(p.width)
      .setHeight(p.height)
      .setAnchorType(api.Enum.SheetDrawingAnchorType.Position)
      .buildAsync()
    ws.insertImages([image])
    return image.drawingId
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let ready = false
    let api: FUniver | null = null
    chartsRef.current = new Map()
    setChartCount(0)
    const worker = new Worker(new URL('../univer-worker.ts', import.meta.url), {
      type: 'module',
    })
    ;(async () => {
      try {
        let data: IWorkbookData
        let dump: WorkbookPayload
        if (tab.path) {
          dump = await readXlsx(tab.path)
          data = payloadToWorkbook(dump, baseName(tab.path))
        } else {
          dump = { sheets: [] }
          data = payloadToWorkbook({ sheets: [] }, '未命名表格')
        }
        if (disposed) return
        const created = createSheetApp(container, worker)
        api = created.univerAPI
        apiRef.current = api
        const wb = api.createWorkbook(data)
        // 还原已存图表：渲染 PNG → 浮动图片
        for (const sheet of dump.sheets) {
          if (!sheet.charts?.length) continue
          const ws = wb.getSheetByName(sheet.name)
          if (!ws) continue
          for (const chart of sheet.charts) {
            try {
              const id = await insertChartImage(api, ws, chart)
              chartsRef.current.set(id, { sheetName: sheet.name, payload: chart })
            } catch (e) {
              console.error('图表还原失败', e)
            }
          }
        }
        setChartCount(chartsRef.current.size)
        api.onCommandExecuted(() => {
          if (ready) markDirty(tab.id, true)
        })
        setTimeout(() => {
          ready = true
        }, 800)
        setStatus('')
      } catch (e) {
        console.error(e)
        setStatus(`加载失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
    return () => {
      disposed = true
      apiRef.current = null
      api?.dispose()
      worker.terminate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  const confirmInsert = async () => {
    const api = apiRef.current
    const ws = api?.getActiveWorkbook()?.getActiveSheet()
    if (!api || !ws) return
    try {
      const payload = payloadFromSelection(ws, chartType, grouping, chartTitle.trim())
      if (!payload) {
        flash('请先选择 ≥2行×2列 的数据区（首行为系列名，首列为类别）')
        return
      }
      const id = await insertChartImage(api, ws, payload)
      chartsRef.current.set(id, { sheetName: ws.getSheetName(), payload })
      setChartCount(chartsRef.current.size)
      setDialogOpen(false)
      markDirty(tab.id, true)
      flash('已插入图表')
    } catch (e) {
      await message(String(e), { title: '插入图表失败', kind: 'error' })
    }
  }

  const refreshCharts = async () => {
    const api = apiRef.current
    const wb = api?.getActiveWorkbook()
    if (!api || !wb || chartsRef.current.size === 0) return
    let updated = 0
    for (const [id, item] of chartsRef.current) {
      const ws = wb.getSheetByName(item.sheetName)
      const image = ws?.getImageById(id)
      if (!ws || !image) continue
      try {
        item.payload = refreshPayloadValues(wb, item)
        if (image.setSource(await renderChartPng(item.payload), api.Enum.ImageSourceType.URL)) {
          updated++
        }
      } catch (e) {
        console.error('图表刷新失败', e)
      }
    }
    flash(updated > 0 ? `已刷新 ${updated} 个图表` : '无需刷新或图表已被删除')
  }

  const save = async (asNew: boolean) => {
    const api = apiRef.current
    const wb = api?.getActiveWorkbook()
    if (!api || !wb) return
    try {
      const snapshot = wb.save() as IWorkbookData
      const payload = workbookToPayload(snapshot)
      // 图表侧通道：调和删除 → 同步锚点 → 取最新数值 → 按工作表附着
      for (const [id, item] of [...chartsRef.current]) {
        const ws = wb.getSheetByName(item.sheetName)
        if (!ws || !ws.getImages().some((im) => im.getId() === id)) {
          chartsRef.current.delete(id)
        }
      }
      const anchors = drawingAnchors(snapshot)
      const bySheet = new Map<string, ChartPayload[]>()
      for (const [id, item] of chartsRef.current) {
        let p = refreshPayloadValues(wb, item)
        const a = anchors.get(id)
        if (a) {
          p = {
            ...p,
            anchorRow: a.row,
            anchorCol: a.col,
            width: a.width || p.width,
            height: a.height || p.height,
          }
        }
        item.payload = p
        const list = bySheet.get(item.sheetName) ?? []
        list.push(p)
        bySheet.set(item.sheetName, list)
      }
      for (const sheet of payload.sheets) {
        const list = bySheet.get(sheet.name)
        if (list?.length) {
          sheet.charts = list.sort(
            (a, b) => a.anchorRow - b.anchorRow || a.anchorCol - b.anchorCol,
          )
        }
      }
      setChartCount(chartsRef.current.size)
      let path = asNew ? undefined : tab.path
      if (!path) {
        path = (await pickSaveFile(`${snapshot.name || '工作簿'}.xlsx`, ['xlsx', 'ods'])) ?? undefined
        if (!path) return
      }
      // 按目标扩展名分流：.ods 走 ODF 写出，避免把 xlsx 字节写进 ods 路径
      const isOds = path.toLowerCase().endsWith('.ods')
      if (isOds) {
        await writeOds(path, payload)
      } else {
        await writeXlsx(path, payload)
      }
      renameTab(tab.id, baseName(path), path)
      markRecent(path, 'sheet')
      const hasCharts = payload.sheets.some((s) => s.charts?.length)
      setStatus(isOds && hasCharts ? '已保存（ODS 暂不含图表）' : '已保存')
      setTimeout(() => setStatus(''), 1500)
    } catch (e) {
      await message(String(e), { title: '保存失败', kind: 'error' })
    }
  }

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => registerSaver(tab.id, (asNew) => saveRef.current(asNew)), [tab.id])

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <button className="tool-btn" onClick={() => save(false)}>保存</button>
        <button className="tool-btn" onClick={() => save(true)}>另存为…</button>
        <button className="tool-btn" onClick={() => setDialogOpen((v) => !v)}>插入图表</button>
        {chartCount > 0 && (
          <button className="tool-btn" onClick={refreshCharts}>刷新图表 ({chartCount})</button>
        )}
        {dialogOpen && (
          <div className="chart-pop">
            <label>
              类型
              <select value={chartType} onChange={(e) => setChartType(e.target.value)}>
                {CHART_TYPES.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </label>
            {CARTESIAN.includes(chartType) && (
              <label>
                分组
                <select value={grouping} onChange={(e) => setGrouping(e.target.value)}>
                  <option value="standard">标准</option>
                  <option value="stacked">堆叠</option>
                  <option value="percentStacked">百分比堆叠</option>
                </select>
              </label>
            )}
            <label>
              标题
              <input
                value={chartTitle}
                placeholder="（可留空）"
                onChange={(e) => setChartTitle(e.target.value)}
              />
            </label>
            <div className="chart-pop-actions">
              <button className="tool-btn tool-btn-primary" onClick={confirmInsert}>插入</button>
              <button className="tool-btn" onClick={() => setDialogOpen(false)}>取消</button>
            </div>
          </div>
        )}
        {status && <span className="editor-status">{status}</span>}
        <span className="editor-hint">内核: Univer (Apache-2.0) · xlsx 读写: calamine / rust_xlsxwriter · 图表渲染: VChart (MIT)</span>
      </div>
      <div className="sheet-container" ref={containerRef} />
    </div>
  )
}

export default memo(SheetEditor)
