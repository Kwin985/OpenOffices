import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { message } from '@tauri-apps/plugin-dialog'
import type { IWorkbookData } from '@univerjs/presets'
import type { FUniver } from '@univerjs/presets'
import type { Tab } from '../store'
import { useApp } from '../store'
import { createSheetApp } from '../lib/univer'
import { payloadToWorkbook, workbookToPayload } from '../lib/univer-io'
import { baseName, pickSaveFile, readXlsx, writeCsv, writeOds, writeXlsx } from '../lib/fs'
import type { ChartPayload, ChartRangeRef, ChartSeriesPayload, WorkbookPayload } from '../lib/fs'
import { renderChartPng } from '../lib/chart'
import { registerSaver } from '../lib/registry'
import { exportPdfWithOverlay } from '../lib/pdfprint'
import { sheetsToPrintHtml } from '../lib/sheet-print'
import { sheetTemplate } from '../lib/templates'

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

  const insertChartImage = async (api: FUniver, ws: FWorksheet, p: ChartPayload, png?: string) => {
    const url = png ?? (await renderChartPng(p))
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

  // 挂载用 layout effect 而不是普通 effect：被动效果排在「这一帧画完」之后，Univer 的建立
  // 因此要等一次真实绘制；layout effect 在提交阶段就跑，容器此刻已在 DOM 里，Univer 量得到
  // 的还是真实尺寸。
  // 账要记清：本轮在表格侧改 layout 时那 295ms 一跳没动（它其实是外壳 Suspense 的兜底节流，
  // 已单独删掉），同构建分离实测到 layout 收益的是 PDF 侧（heavy.pdf 首页 746 → 473ms）。
  useLayoutEffect(() => {
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
        // 读文件与建 Univer 实例互不依赖：先把 IPC 发出去，实例同时在造，两条时间线叠成一条
        const loading: Promise<WorkbookPayload> = tab.path
          ? readXlsx(tab.path)
          : tab.template
            ? Promise.resolve(sheetTemplate(tab.template))
            : Promise.resolve({ sheets: [] })
        const created = createSheetApp(container, worker)
        api = created.univerAPI
        apiRef.current = api
        const dump = await loading
        if (disposed) return
        const name = tab.path ? baseName(tab.path) : tab.title || '未命名表格'
        const snap = payloadToWorkbook(dump, name)
        const wb = api.createWorkbook(snap)
        // 还原已存图表：PNG 渲染并行（VChart 是纯计算），落格串行（同一 sheet 的命令队列）
        const items = dump.sheets.flatMap((s) =>
          (s.charts ?? []).map((chart) => ({ sheetName: s.name, chart })),
        )
        const pngs = await Promise.all(
          items.map((it) =>
            renderChartPng(it.chart).catch((e) => {
              console.error('图表渲染失败', e)
              return null
            }),
          ),
        )
        for (const [i, it] of items.entries()) {
          const png = pngs[i]
          const ws = wb.getSheetByName(it.sheetName)
          if (!png || !ws) continue
          try {
            const id = await insertChartImage(api, ws, it.chart, png)
            chartsRef.current.set(id, { sheetName: it.sheetName, payload: it.chart })
          } catch (e) {
            console.error('图表还原失败', e)
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
      // 传给 Univer 的 worker 不会被 Univer 销毁（它只在 _internalWorker 是自己建的时候才管），
      // 所以这里显式杀掉，不留悬着的线程
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
        path =
          (await pickSaveFile(`${snapshot.name || '工作簿'}.xlsx`, ['xlsx', 'ods', 'csv'])) ??
          undefined
        if (!path) return
      }
      // 按目标扩展名分流：格式不匹配会把 xlsx 字节写进 .ods/.csv 路径，打开方直接认不出文件
      const lower = path.toLowerCase()
      const isOds = lower.endsWith('.ods')
      const isCsv = lower.endsWith('.csv')
      if (isOds) {
        await writeOds(path, payload)
      } else if (isCsv) {
        await writeCsv(path, payload)
      } else {
        await writeXlsx(path, payload)
      }
      renameTab(tab.id, baseName(path), path)
      markRecent(path, 'sheet')
      const hasCharts = payload.sheets.some((s) => s.charts?.length)
      setStatus(
        isCsv
          ? '已保存（CSV 只含首个工作表，样式与图表不保留）'
          : isOds && hasCharts
            ? '已保存（ODS 暂不含图表）'
            : '已保存',
      )
      setTimeout(() => setStatus(''), 1500)
    } catch (e) {
      await message(String(e), { title: '保存失败', kind: 'error' })
    }
  }

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => registerSaver(tab.id, (asNew) => saveRef.current(asNew)), [tab.id])

  // Univer 是 canvas 渲染：PDF 走保存同源的工作簿载荷自绘 HTML 网格再打印
  const exportPdfTo = async (path: string) => {
    const wb = apiRef.current?.getActiveWorkbook()
    if (!wb) throw new Error('表格尚未就绪')
    const payload = workbookToPayload(wb.save() as IWorkbookData)
    const box = document.createElement('div')
    box.innerHTML = sheetsToPrintHtml(payload)
    try {
      await exportPdfWithOverlay(path, box, {
        // A4 横向（11.69×8.27 英寸），边距用 Rust 默认
        pageSizeInches: [11.69, 8.27],
      })
      markRecent(path, 'pdf')
      setStatus('已导出 PDF')
      setTimeout(() => setStatus(''), 1500)
    } finally {
      box.innerHTML = ''
    }
  }
  const exportPdfToRef = useRef(exportPdfTo)
  exportPdfToRef.current = exportPdfTo

  const exportPdf = async () => {
    try {
      const path = await pickSaveFile(
        (tab.path ? baseName(tab.path).replace(/\.[^.]+$/, '') : '工作簿') + '.pdf',
        ['pdf'],
      )
      if (!path) return
      setStatus('正在生成 PDF…')
      await exportPdfToRef.current(path)
    } catch (e) {
      setStatus('')
      await message(String(e), { title: '导出 PDF 失败', kind: 'error' })
    }
  }

  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>
    w.__oofSheet = { exportPdfTo: (p: string) => exportPdfToRef.current(p) }
  }

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <button className="tool-btn" onClick={() => save(false)}>保存</button>
        <button className="tool-btn" onClick={() => save(true)}>另存为…</button>
        <button className="tool-btn" onClick={() => setDialogOpen((v) => !v)}>插入图表</button>
        <button className="tool-btn" onClick={() => void exportPdf()} title="A4 横向自绘网格">导出 PDF</button>
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
