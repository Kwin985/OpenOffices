import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { message } from '@tauri-apps/plugin-dialog'
import type { IWorkbookData } from '@univerjs/presets'
import type { FUniver } from '@univerjs/presets'
import type { Tab } from '../store'
import { useApp } from '../store'
import { createSheetApp } from '../lib/univer'
import { payloadToWorkbook, workbookToPayload } from '../lib/univer-io'
import { aggregateNotes, applySheetRules } from '../lib/sheet-rules'
import type { SheetRules } from '../lib/sheet-rules'
import { restampCellSide } from '../lib/sheet-cell-side'
import type { CellSide } from '../lib/sheet-cell-side'
import { baseName, pickSaveFile, readXlsx, writeCsv, writeOds, writeXlsx } from '../lib/fs'
import type {
  ChartPayload,
  ChartRangeRef,
  ChartSeriesPayload,
  DefaultFont,
  PrintHfPayload,
  PrintMarginsPayload,
  SheetFormat,
  SheetPrintPayload,
  WorkbookPayload,
} from '../lib/fs'
import { renderChartPng } from '../lib/chart'
import { registerSaver } from '../lib/registry'
import { exportPdfWithOverlay, measurePrintLayout } from '../lib/pdfprint'
import { sheetsToPrintHtml } from '../lib/sheet-print'
import { applyVerticalPads, measureSheetPrint } from '../lib/sheet-print-measure'
import { evalSheetCondFormats } from '../lib/sheet-cf-print'
import { columnLetter, planSheetFit } from '../lib/sheet-print-setup'
import type { SheetFit } from '../lib/sheet-print-setup'
import {
  EMPTY_HF,
  HF_CODES,
  PAPER_OPTIONS,
  addBreak,
  draftOf,
  draftPaperNotes,
  hfSlotsToText,
  hfTextToSlots,
  inchToMm,
  mmToInch,
  paperMm,
  rectToSqref,
  removeBreak,
  spanToSqref,
  sqrefToRect,
  sqrefToSpan,
  validateDraft,
} from '../lib/sheet-print-ui'
import type { HfSlots } from '../lib/sheet-print-ui'
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

const RENAME_CMD = 'sheet.command.set-worksheet-name'
const RENAME_MUTATION = 'sheet.mutation.set-worksheet-name'

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

// —— 页面设置面板用的形状 ——
type HfSec = 'header' | 'footer'
type HfVariant = 'odd' | 'even' | 'first'
type HfSlot = keyof typeof EMPTY_HF

const MARGIN_FIELDS: Array<[keyof PrintMarginsPayload, string]> = [
  ['top', '上'],
  ['bottom', '下'],
  ['left', '左'],
  ['right', '右'],
  ['header', '页眉区'],
  ['footer', '页脚区'],
]

/** 按表名存东西的那几份侧通道（只声明用到的三个方法，Map<string, 各自的值> 都能递进来） */
type NameKeyed = {
  get(key: string): unknown
  set(key: string, value: unknown): unknown
  delete(key: string): boolean
}

/** 表名是四份侧通道（页面设置 / 批注作者与提示 / 图表 / 工作表缺省行高）的钥匙：改名后旧钥匙再也开不出东西，
 *  等价于"改个表名，纸面设置、图表和这一层文件字节全没了"，所以改名这件事必须搬钥匙而不是重新数一遍 */
function migrateSheetName(maps: NameKeyed[], from: string, to: string) {
  if (!from || from === to) return
  for (const m of maps) {
    const v = m.get(from)
    if (v === undefined) continue
    m.delete(from)
    m.set(to, v)
  }
}

function numVal(raw: string): number | null {
  return raw === '' ? null : Number(raw)
}

function SheetEditor({ tab }: Props) {  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<FUniver | null>(null)
  const chartsRef = useRef(new Map<string, ChartItem>())
  // 打开时读到的批注作者与链接提示：Univer 的模型装不下它们（外来 resource 也活不过
  // createWorkbook，实测），所以自己按表名留一份，存盘前按格子回贴
  const cellSideRef = useRef(new Map<string, CellSide>())
  // 打印设置（纸张/边距/页眉页脚/分页符/打印区域/重复标题行列）也是 Univer 装不下的东西：
  // 界面上一版没有页面设置面板，读回来的那份就按表名留着，存盘与导出 PDF 都照它说话
  const printRef = useRef(new Map<string, SheetPrintPayload>())
  // 工作簿默认字体是**簿级**的一档（Univer 的 IWorkbookData.defaultStyle 是死槽，core 里零读取，
  // 画布对无样式格回落 engine-render 硬编码的 Arial 11），所以这里自己留一份：
  // 存盘回贴保住字节，导出时给页眉当底数
  const defaultFontRef = useRef<DefaultFont | null>(null)
  // `sheetFormatPr` 那一层（工作表缺省行高）同样装不下，但方向相反：Univer 的
  // IWorksheetData.defaultRowHeight 是**活口**（喂进去界面就真按它排），而实测 Excel 自己并不用它排版。
  // 所以这一层只留一份原样字节给存盘回贴，不喂界面——喂了就是让界面去听一个文件里说了但纸面不认的数
  const sheetFormatRef = useRef(new Map<string, SheetFormat>())
  const [status, setStatus] = useState<string>(tab.path ? '正在加载…' : '')
  const [chartCount, setChartCount] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [chartType, setChartType] = useState('column')
  const [grouping, setGrouping] = useState('standard')
  const [chartTitle, setChartTitle] = useState('')
  // 页面设置面板：草稿活在 React 态里，「确定」才写侧通道——取消就是什么都没发生
  const [printOpen, setPrintOpen] = useState(false)
  const [draft, setDraft] = useState<SheetPrintPayload>(() => draftOf(null))
  const [draftSheet, setDraftSheet] = useState('')
  const [hadSetup, setHadSetup] = useState(false)
  const [areaText, setAreaText] = useState('')
  const [titleRowsText, setTitleRowsText] = useState('')
  const [titleColsText, setTitleColsText] = useState('')
  const [breakRow, setBreakRow] = useState('')
  const [breakCol, setBreakCol] = useState('')
  const [hfVariant, setHfVariant] = useState<HfVariant>('odd')
  const [hfFocus, setHfFocus] = useState<HfSlot>('center')
  // sheetId -> 表名，停在"上一次命令之前"的样子：改名那一条要靠它认出旧钥匙是谁
  const sheetNamesRef = useRef(new Map<string, string>())
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
    cellSideRef.current = new Map()
    printRef.current = new Map()
    defaultFontRef.current = null
    sheetFormatRef.current = new Map()
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
        // 放侧的账（链接摆不进界面这类）与读侧的账一起进状态栏
        const putNotes: string[] = []
        const snap = payloadToWorkbook(dump, name, putNotes)
        const wb = api.createWorkbook(snap)
        // 作者与提示文字是 Univer 模型装不下的东西，这里按表名留一份，存盘前回贴
        cellSideRef.current = new Map(
          dump.sheets
            .filter((s) => s.notes?.length || s.links?.length)
            .map((s) => [s.name, { notes: s.notes, links: s.links } as CellSide]),
        )
        printRef.current = new Map(
          dump.sheets
            .filter((s) => s.print)
            .map((s) => [s.name, s.print as SheetPrintPayload]),
        )
        // 工作簿默认字体是簿级的一档，Univer 的 defaultStyle 是死槽装不下 ⇒ 原样留一份
        defaultFontRef.current = dump.defaultFont ?? null
        // 缺省行高是**表级**的一档，同上原样留一份：这一层不喂界面（Univer 那边是活口，喂了界面就听一个纸面不认的数）
        sheetFormatRef.current = new Map(
          dump.sheets
            .filter((s) => s.sheetFormat)
            .map((s) => [s.name, s.sheetFormat as SheetFormat]),
        )
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
        // 规则（筛选/数据验证/条件格式）只能由门面放回界面：快照里的 resources 是我们自己
        // 读出来记账的，Univer 建工作簿时并不会照它还原
        // Rust 读侧的边界账先接上：文件里有、模型装不下的东西，打开这一趟就要说得出
        const notes: string[] = [...putNotes, ...(dump.warnings ?? [])]
        if (wb) {
          for (const s of dump.sheets) {
            const rules: SheetRules = {
              filter: s.filter,
              dataValidations: s.dataValidations,
              condFormats: s.condFormats,
            }
            if (!rules.filter && !rules.dataValidations?.length && !rules.condFormats?.length)
              continue
            try {
              notes.push(...applySheetRules(api, wb, s.name, rules))
            } catch (e) {
              console.error('规则还原失败', e)
              notes.push(`有条规则没能还原（${e instanceof Error ? e.message : String(e)}）`)
            }
          }
        }
        // 同类文案收成"文案 ×N"，还有别的类就点名条数：状态栏一行装得下，也不让人觉得只有这一条
        const shown = aggregateNotes(notes)
        if (shown.length) {
          setStatus(shown.length > 1 ? `${shown[0]}（另有 ${shown.length - 1} 条说明）` : shown[0])
          setTimeout(() => setStatus(''), 5000)
        } else setStatus('')
        // 表名是四份侧通道的钥匙，而 Univer 的改名只改它自己的模型：不搬钥匙就是
        // "改个表名，纸面设置/批注署名/图表/缺省行高全没了"。
        // 搬法是按 id 对表（前后两份 id→表名 快照一比就知道谁改了名），而不是读命令参数：
        // 改名的命令与变异各来一趟，参数里带不带 subUnitId 两条路不一样，跟着模型对账最省事
        const migrateByDiff = () => {
          const prev = sheetNamesRef.current
          const next = new Map<string, string>()
          for (const s of wb?.getSheets() ?? []) next.set(s.getSheetId(), s.getSheetName())
          for (const [id, was] of prev) {
            const now = next.get(id)
            if (!now || now === was) continue
            migrateSheetName([printRef.current, cellSideRef.current, sheetFormatRef.current], was, now)
            for (const item of chartsRef.current.values()) {
              if (item.sheetName === was) item.sheetName = now
            }
          }
          sheetNamesRef.current = next
        }
        migrateByDiff()
        api.onCommandExecuted((info) => {
          if (info.id === RENAME_CMD || info.id === RENAME_MUTATION) migrateByDiff()
          if (ready) markDirty(tab.id, true)
        })
        setTimeout(() => {
          ready = true
        }, 800)
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

  // —— 页面设置面板：只改草稿，「确定」才落到侧通道 printRef（保存与导出 PDF 共吃它） ——
  const activeWs = (): FWorksheet | null =>
    apiRef.current?.getActiveWorkbook()?.getActiveSheet() ?? null

  const patchDraft = (p: Partial<SheetPrintPayload>) => setDraft((d) => ({ ...d, ...p }))

  const openPrintPanel = () => {
    if (printOpen) {
      setPrintOpen(false)
      return
    }
    const ws = activeWs()
    if (!ws) {
      flash('表格尚未就绪')
      return
    }
    const name = ws.getSheetName()
    const p = printRef.current.get(name)
    setDraft(draftOf(p))
    setDraftSheet(name)
    setHadSetup(!!p)
    setAreaText(rectToSqref(p?.printArea ?? null))
    setTitleRowsText(spanToSqref('rows', p?.titleRows ?? null))
    setTitleColsText(spanToSqref('cols', p?.titleCols ?? null))
    setHfVariant('odd')
    setHfFocus('center')
    setPrintOpen(true)
  }

  const areaChanged = (raw: string) => {
    setAreaText(raw)
    patchDraft({ printArea: raw.trim() ? sqrefToRect(raw) : null })
  }

  const titleRowsChanged = (raw: string) => {
    setTitleRowsText(raw)
    patchDraft({ titleRows: raw.trim() ? sqrefToSpan(raw, 'rows') : null })
  }

  const titleColsChanged = (raw: string) => {
    setTitleColsText(raw)
    patchDraft({ titleCols: raw.trim() ? sqrefToSpan(raw, 'cols') : null })
  }

  /** 用当前选区填一处：打印区域吃整个选区，重复标题行/列只吃选区的首行/首列 */
  const useSelection = (what: 'area' | 'titleRows' | 'titleCols') => {
    const ws = activeWs()
    const range = ws?.getSelection()?.getActiveRange()
    if (!ws || !range) {
      flash('先在表里选一块区域')
      return
    }
    const r1 = range.getRow()
    const c1 = range.getColumn()
    const r2 = range.getLastRow()
    const c2 = range.getLastColumn()
    if (what === 'area') {
      const text = rectToSqref({ startRow: r1, startColumn: c1, endRow: r2, endColumn: c2 })
      setAreaText(text)
      patchDraft({ printArea: sqrefToRect(text) })
    } else if (what === 'titleRows') {
      const text = spanToSqref('rows', [r1, r1])
      setTitleRowsText(text)
      patchDraft({ titleRows: [r1, r1] })
    } else {
      const text = spanToSqref('cols', [c1, c1])
      setTitleColsText(text)
      patchDraft({ titleCols: [c1, c1] })
    }
  }

  const addBreakAt = (kind: 'rows' | 'cols') => {
    const ws = activeWs()
    if (!ws) return
    const raw = kind === 'rows' ? breakRow : breakCol
    const at = Number(raw) - 1
    if (raw.trim() === '' || !Number.isInteger(at)) {
      flash(kind === 'rows' ? '行号要填整数' : '列号要填整数（B 就是 2）')
      return
    }
    const max = kind === 'rows' ? ws.getMaxRows() : ws.getMaxColumns()
    const cur = kind === 'rows' ? draft.rowBreaks : draft.colBreaks
    const res = addBreak(cur, at, max)
    if (res.note) {
      flash(res.note)
      return
    }
    patchDraft(kind === 'rows' ? { rowBreaks: res.list } : { colBreaks: res.list })
    if (kind === 'rows') setBreakRow('')
    else setBreakCol('')
  }

  const patchHf = (sec: HfSec, slot: HfSlot, text: string) =>
    setDraft((d) => {
      const box: PrintHfPayload = { ...(d[sec] ?? {}) }
      const slots = hfTextToSlots(box[hfVariant])
      slots[slot] = text
      box[hfVariant] = hfSlotsToText(slots)
      return { ...d, [sec]: box }
    })

  // 插入要在新状态上算，不能拿渲染期那份 draft 闭包：连着按两枚格式码（同一批更新里）
  // 若各自从旧 draft 起算，后一枚会把前一枚顶掉——冒烟阶段一次插两码就是测这个
  const insertHfCode = (sec: HfSec, code: string) =>
    setDraft((d) => {
      const box: PrintHfPayload = { ...(d[sec] ?? {}) }
      const slots = hfTextToSlots(box[hfVariant])
      slots[hfFocus] = slots[hfFocus] + code
      box[hfVariant] = hfSlotsToText(slots)
      return { ...d, [sec]: box }
    })

  /** 边距两头各说各的话：界面是毫米，文件是英寸，来回只走这两枚函数 */
  const mmVal = (inch: number | null | undefined) =>
    inch == null || !Number.isFinite(inch) ? '' : String(inchToMm(inch))

  const patchMargin = (key: keyof PrintMarginsPayload, raw: string) => {
    const v = numVal(raw)
    patchDraft({ margins: { ...(draft.margins ?? {}), [key]: v == null ? null : mmToInch(v) } })
  }

  const printErrors = (ctx: { maxRows: number; maxCols: number }) => {
    const errs: string[] = []
    if (areaText.trim() && !draft.printArea) errs.push('打印区域要写成 A1:E18 这样（$ 可省），留空＝不设打印区域')
    if (titleRowsText.trim() && !draft.titleRows) errs.push('重复标题行要写成 1:2 这样（整行的区间，不是格子）')
    if (titleColsText.trim() && !draft.titleCols) errs.push('重复标题列要写成 A:B 这样（整列的区间）')
    return [...errs, ...validateDraft(draft, ctx)]
  }

  const confirmPrint = () => {
    const ws = apiRef.current?.getActiveWorkbook()?.getSheetByName(draftSheet)
    if (!ws) {
      flash(`「${draftSheet}」这张表已经不在了，页面设置没有地方可写`)
      return
    }
    const errs = printErrors({ maxRows: ws.getMaxRows(), maxCols: ws.getMaxColumns() })
    if (errs.length) {
      flash(errs[0])
      return
    }
    printRef.current.set(draftSheet, draft)
    markDirty(tab.id, true)
    setPrintOpen(false)
    flash(`页面设置已设到「${draftSheet}」，保存后随 xlsx 一起出去`)
  }

  const clearPrint = () => {
    printRef.current.delete(draftSheet)
    markDirty(tab.id, true)
    setPrintOpen(false)
    flash(`已清除「${draftSheet}」的页面设置（存盘后文件里不再声明纸面）`)
  }

  // 图表侧通道：Univer 只把图表当一张浮动图片，载荷里的图表靠这份账本附着。
  // 保存与导出 PDF 吃的是同一份产物，否则"文件里有图、打印里没图"又会各说一次话
  const payloadWithCharts = (wb: FWorkbook, snapshot: IWorkbookData): WorkbookPayload => {
    const payload = workbookToPayload(snapshot)
    // 回贴作者与悬停提示：这两样 Univer 的模型装不下，不回贴就是"存一次盘，全都没了"
    for (const sheet of payload.sheets) {
      restampCellSide(sheet, cellSideRef.current.get(sheet.name))
    }
    // 打印设置同理：Univer 的快照根本没有这一层，界面改的与文件读来的都存在 printRef 里，
    // 不回帖就是"存一次盘，纸面设置没了"
    for (const sheet of payload.sheets) {
      const p = printRef.current.get(sheet.name)
      if (p && !sheet.print) sheet.print = p
    }
    // 工作簿默认字体也是 Univer 快照装不下的东西（它的 defaultStyle 是死槽），从侧通道回贴；
    // 快照里读不出这一层，所以这一笔就是存盘与导出共吃的唯一来源
    payload.defaultFont = defaultFontRef.current
    // 缺省行高同理按表名回贴：快照里那一层是 Univer 自己的排版数值，不是文件那一层的字节
    for (const sheet of payload.sheets) {
      const f = sheetFormatRef.current.get(sheet.name)
      if (f && !sheet.sheetFormat) sheet.sheetFormat = f
    }
    // 调和删除 → 同步锚点 → 取最新数值 → 按工作表附着
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
        sheet.charts = list.sort((a, b) => a.anchorRow - b.anchorRow || a.anchorCol - b.anchorCol)
      }
    }
    setChartCount(chartsRef.current.size)
    return payload
  }

  const save = async (asNew: boolean) => {
    const api = apiRef.current
    const wb = api?.getActiveWorkbook()
    if (!api || !wb) return
    try {
      const snapshot = wb.save() as IWorkbookData
      const payload = payloadWithCharts(wb, snapshot)
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
      const writeNotes: string[] = []
      if (isOds) {
        writeNotes.push(...(await writeOds(path, payload)))
      } else if (isCsv) {
        await writeCsv(path, payload)
      } else {
        writeNotes.push(...(await writeXlsx(path, payload)))
      }
      renameTab(tab.id, baseName(path), path)
      markRecent(path, 'sheet')
      const hasCharts = payload.sheets.some((s) => s.charts?.length)
      const hasRules = payload.sheets.some(
        (s) => s.filter || s.dataValidations?.length || s.condFormats?.length,
      )
      // 页面设置是"这份纸该怎么摆"的那份设置：ODS/CSV 这一版都写不出，说清楚比静默丢强
      const hasPrint = payload.sheets.some((s) => s.print)
      // 格式本身装不下的东西先说，接着一句接写侧带回来的账（规则摆不进 OOXML、批注落在被盖住的格上这类）
      const lost: string[] = []
      if (isCsv)
        lost.push(
          'CSV 只含首个工作表，公式、样式、合并、图表、批注/链接、筛选/数据验证/条件格式与页面设置都不保留',
        )
      if (isOds) {
        if (hasCharts) lost.push('ODS 暂不含图表')
        if (hasRules) lost.push('ODS 暂不含筛选、数据验证与条件格式')
        if (hasPrint) lost.push('ODS 暂不含页面设置（纸张/边距/页眉页脚/分页符），导出的 PDF 仍照它排')
      }
      const notes = [...lost, ...writeNotes]
      setStatus(
        notes.length
          ? `已保存（${notes[0]}${notes.length > 1 ? `，另有 ${notes.length - 1} 条说明` : ''}）`
          : '已保存',
      )
      setTimeout(() => setStatus(''), notes.length ? 5000 : 1500)
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
    const payload = payloadWithCharts(wb, wb.save() as IWorkbookData)
    // 图表住在浮动图片里，画布上的东西 PrintToPdf 抓不到：按 VChart 现渲染的位图贴回网格
    const chartImages: (string | undefined)[][] = []
    for (const s of payload.sheets) {
      const list: (string | undefined)[] = []
      for (const c of s.charts ?? []) {
        try {
          list.push(await renderChartPng(c))
        } catch {
          list.push(undefined)
        }
      }
      chartImages.push(list)
    }
    const printCtx = {
      dateText: new Date().toLocaleDateString(),
      fileName: tab.path ? baseName(tab.path) : undefined,
    }
    let res = sheetsToPrintHtml(payload, chartImages, printCtx)
    let box = document.createElement('div')
    box.innerHTML = res.html
    // 「缩放到 N 页高」与「上下居中」要按**实测的行高**说话，而实测只能在挂起来之后拿到，
    // 于是来回几趟：按计划缩放建一次 → 量 → 压出页高档重建 → 量稳了才把居中留白写回同一份 DOM。
    // 每一趟都**重新量**才落笔（留白只认最终缩放那一份实测），所以压完还得再量一趟；
    // 不需要这一层的表（没勾这两样）一趟就过，导出仍旧一次建、一次量都没有
    let fitNotes: string[] = []
    if (res.plans.some((p) => p.fitToHeightPages || p.vCentered)) {
      const zooms: (number | null)[] = res.plans.map(() => null)
      // 页高档那句要说在**压它的那一趟**：压完再量的那一趟只会说"这档已经够了"，账就丢了。
      // 每张表占一格、后面的趟覆盖前面的（同一张只会缩到更低一档，留最后一档才是实话）；
      // 居中的账反过来，只在最终缩放定下之后量出来的那一份才算数
      const squeezeNotes: (string[] | null)[] = res.plans.map(() => null)
      let centerNotes: string[] = []
      let settled = false
      for (let pass = 0; pass < 5 && !settled; pass++) {
        const measures = await measurePrintLayout(box, measureSheetPrint)
        const fits: (SheetFit | null)[] = measures.map((m, i) => {
          const plan = res.plans[i]
          if (!m || !plan) return null
          return planSheetFit(m, plan, {
            capacityHeightPx: res.job.capacityHeightPx,
            measuredZoom: zooms[i] ?? plan.zoom,
          })
        })
        fits.forEach((f, i) => {
          const tall = (f?.notes ?? []).filter((n) => n.includes('页高'))
          if (tall.length) squeezeNotes[i] = tall
        })
        centerNotes = fits.flatMap((f) => (f?.notes ?? []).filter((n) => !n.includes('页高')))
        if (!fits.some((f) => f?.zoom != null)) {
          applyVerticalPads(box, fits)
          settled = true
          break
        }
        fits.forEach((f, i) => {
          if (f?.zoom != null) zooms[i] = f.zoom
        })
        res = sheetsToPrintHtml(payload, chartImages, printCtx, { zooms })
        box = document.createElement('div')
        box.innerHTML = res.html
      }
      if (!settled) {
        squeezeNotes.push(['压了五趟还没把行数压进目标页数，纸上按最后一趟的缩放排、不按上下居中排'])
      }
      fitNotes = [...squeezeNotes.flatMap((n) => n ?? []), ...centerNotes]
    }
    const notes = [...res.notes, ...fitNotes]
    const job = res.job
    try {
      await exportPdfWithOverlay(path, box, {
        // 纸面、四边距、页眉页脚都由打印计划说话（文件里声明过就照它，没声明沿用表格历史的 A4 横向）
        pageSizeInches: job.pageSizeInches,
        marginsSides: job.margins,
        pageStyle: job.pageStyle,
      })
      markRecent(path, 'pdf')
      setStatus(
        notes.length
          ? `已导出 PDF（${notes[0]}${notes.length > 1 ? `，另有 ${notes.length - 1} 条说明` : ''}）`
          : '已导出 PDF',
      )
      setTimeout(() => setStatus(''), notes.length ? 5000 : 1500)
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
    // 按标签取实例：多标签时全局别名会被最后一次渲染改走（v0.41 冒烟踩过）
    const byTab = (w.__oofSheetByTab ??= {}) as Record<
      string,
      {
        save: (asNew: boolean) => Promise<void>
        exportPdfTo: (p: string) => Promise<void>
        printPlan: () => unknown
        printHtml: (zooms?: (number | null)[]) => string
        printSetup: () => Array<[string, SheetPrintPayload]>
        printSet: (name: string, p: SheetPrintPayload | null) => boolean
        selectRange: (r: number, c: number, rows: number, cols: number) => boolean
      }
    >
    byTab[tab.id] = {
      save: (asNew: boolean) => saveRef.current(asNew),
      exportPdfTo: (p: string) => exportPdfToRef.current(p),
      // 侧通道现在是什么：面板改完没点确定应当与点了确定完全不同，冒烟靠这条分辨
      printSetup: () => [...printRef.current].map(([n, p]) => [n, structuredClone(p)] as [string, SheetPrintPayload]),
      // 冒烟用：把页面设置直接写进侧通道——落笔处与面板「确定」是同一行，省掉一串点击后
      // 仍能核对打印几何（面板本身的接线是 v0.52 冒烟量的）；传 null 走「清除这张表的设置」那一路
      printSet: (name, p) => {
        if (p) printRef.current.set(name, structuredClone(p))
        else printRef.current.delete(name)
        markDirty(tab.id, true)
        return printRef.current.has(name)
      },
      // 冒烟用：门面现设选区，让「用当前选区」那几条按钮有确定的输入
      selectRange: (r, c, rows, cols) => {
        const ws = apiRef.current?.getActiveWorkbook()?.getActiveSheet()
        if (!ws) return false
        ws.getRange(r, c, rows, cols).activate()
        return true
      },
      // 探针用：把**将要上纸的那一份 HTML**交出去，让脚本自己挂起来量。
      // 为什么要这一枚：分页的账是模拟算的，纸上真落几行是浏览器排的，两者对不上时
      // 只靠自家函数永远自证清白——量真实布局的推进量得从同一份 DOM 起
      printHtml: (zooms?: (number | null)[]) => {
        const wb = apiRef.current?.getActiveWorkbook()
        if (!wb) return ''
        const payload = payloadWithCharts(wb, wb.save() as IWorkbookData)
        return sheetsToPrintHtml(payload, undefined, {
          dateText: '2026-01-01',
          fileName: tab.path ? baseName(tab.path) : undefined,
        }, { zooms }).html
      },
      // 冒烟用：打印这一页"打算怎么画、哪些没画"的账面，不经渲染就能核对
      printPlan: () => {
        const wb = apiRef.current?.getActiveWorkbook()
        if (!wb) return null
        const payload = payloadWithCharts(wb, wb.save() as IWorkbookData)
        const { html, notes, plans, job } = sheetsToPrintHtml(payload, undefined, {
          dateText: '2026-01-01',
          fileName: tab.path ? baseName(tab.path) : undefined,
        })
        const count = (re: RegExp) => (html.match(re) ?? []).length
        return {
          // 侧通道里那一层（工作簿默认字体）：正文与页眉的底数都从它起，冒烟据此分辨"文件说的"与"我们兜的"
          defaultFont: payload.defaultFont ?? null,
          // 按表回贴的那一层缺省行高：这一枚只走保真往返（不上纸），冒烟核的是"侧通道 → 载荷"这一段通没通
          sheetFormats: payload.sheets.map((s) => s.sheetFormat ?? null),
          rules: payload.sheets.map((s) => s.condFormats?.length ?? 0),
          cfNotes: payload.sheets.flatMap((s) => evalSheetCondFormats(s).notes),
          charts: payload.sheets.map((s) =>
            (s.charts ?? []).map((c) => ({ w: c.width, h: c.height, ar: c.anchorRow, ac: c.anchorCol })),
          ),
          // 这一趟的纸面：PrintToPdf 真正吃的那三个数，与页眉页脚那份 @page
          job: {
            page: job.pageSizeInches,
            margins: job.margins,
            capacityPx: job.capacityPx,
            capacityHeightPx: job.capacityHeightPx,
            hf: job.pageStyle,
          },
          // 每张表自己想要的纸（各表不一致时账在 job 的 notes 里）
          plans: plans.map((p, i) => ({
            name: payload.sheets[i]?.name ?? '',
            page: p.pageSizeInches,
            margins: p.margins,
            basePx: p.defaultFontPx,
            zoom: p.zoom,
            gridLines: p.gridLines,
            headings: p.headings,
            hCentered: p.hCentered,
            vCentered: p.vCentered,
            fitToWidthPages: p.fitToWidthPages,
            fitToHeightPages: p.fitToHeightPages,
            firstPageNumber: p.firstPageNumber,
            printArea: p.printArea,
            titleRows: p.titleRows,
            titleCols: p.titleCols,
            pageBreakRows: p.pageBreakRows,
            colBreaks: p.colBreaks,
            notes: p.notes,
          })),
          // 结构计数：打印将要吃的 HTML 里各类节点各几枚，纸上有没有真东西就看这些
          tables: count(/<table /g),
          // 正文底数落在 <section> 上的那几枚自定义属性（含值），冒烟按张核
          baseVars: html.match(/--oof-print-base-size:[0-9.]+px/g) ?? [],
          bands: count(/class="sheet-print-band/g),
          bandBreaks: count(/class="sheet-print-band sheet-print-break"/g),
          thead: count(/<thead>/g),
          rowBreaks: count(/<tr class="sheet-print-break"/g),
          headingCells: count(/<th class="sheet-print-heading"/g),
          gridClass: count(/class="sheet-print-table sheet-print-grid"/g),
          zoomAttr: count(/style="zoom:/g),
          centered: count(/margin-left:auto/g),
          onPaperNotes: count(/class="sheet-print-note"/g),
          notes,
        }
      },
    }
  }

  // 面板开着才算账：表可能已经不在（改名/删表），那时按"无从校验"说，而不是"哪都不对"
  const panelWs = printOpen
    ? (apiRef.current?.getActiveWorkbook()?.getSheetByName(draftSheet) ?? null)
    : null
  const draftErrs = printOpen
    ? printErrors({
        maxRows: panelWs?.getMaxRows() ?? Number.MAX_SAFE_INTEGER,
        maxCols: panelWs?.getMaxColumns() ?? Number.MAX_SAFE_INTEGER,
      })
    : []
  const paperNow = paperMm(draft.paperSize)
  const paperNotes = printOpen ? draftPaperNotes(draft) : []
  const hfSlots: Record<HfSec, HfSlots> = {
    header: hfTextToSlots(draft.header?.[hfVariant]),
    footer: hfTextToSlots(draft.footer?.[hfVariant]),
  }

  const hfRow = (sec: HfSec, label: string) => (
    <div className="print-hf-row">
      <span className="print-hf-label">{label}</span>
      {(['left', 'center', 'right'] as HfSlot[]).map((slot) => (
        <input
          key={slot}
          className={`print-hf print-hf-${slot}`}
          placeholder={slot === 'left' ? '左' : slot === 'center' ? '中' : '右'}
          value={hfSlots[sec][slot]}
          onFocus={() => setHfFocus(slot)}
          onChange={(e) => patchHf(sec, slot, e.target.value)}
        />
      ))}
      <span className="print-hf-codes">
        {HF_CODES.map((c) => (
          <button
            key={c.code}
            className="tool-btn"
            title={`往当前框里插入 ${c.code}（${c.label}）`}
            onClick={() => insertHfCode(sec, c.code)}
          >
            {c.label}
          </button>
        ))}
      </span>
    </div>
  )

  const breakChips = (list: number[] | undefined, kind: 'rows' | 'cols') =>
    (list ?? []).map((i) => (
      <span key={`${kind}${i}`} className="print-chip">
        {kind === 'rows' ? `第 ${i + 1} 行开始新页` : `${columnLetter(i)} 列开始新页`}
        <button
          className="print-chip-x"
          title="删掉这个分页符"
          onClick={() =>
            patchDraft(
              kind === 'rows'
                ? { rowBreaks: removeBreak(list, i) }
                : { colBreaks: removeBreak(list, i) },
            )
          }
        >
          ×
        </button>
      </span>
    ))

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <button className="tool-btn" onClick={() => save(false)}>保存</button>
        <button className="tool-btn" onClick={() => save(true)}>另存为…</button>
        <button className="tool-btn" onClick={() => setDialogOpen((v) => !v)}>插入图表</button>
        <button className="tool-btn" onClick={() => void exportPdf()} title="自绘网格，纸面照文件的页面设置">导出 PDF</button>
        <button className="tool-btn" onClick={openPrintPanel} title="这一张表该怎么摆到纸上：纸张/边距/页眉页脚/分页">页面设置</button>
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
        {printOpen && (
          <div className="print-pop">
            <div className="print-pop-title">
              页面设置 · {draftSheet}
              <span className="print-pop-sub">
                {hadSetup ? '文件里带着纸面设置' : '这张表还没声明纸面设置，下面是我们打印用的默认纸'}
              </span>
            </div>
            <div className="print-pop-grid">
              <fieldset className="print-sec">
                <legend>纸张</legend>
                <label>
                  方向
                  <select
                    value={draft.orientation ?? 'portrait'}
                    onChange={(e) => patchDraft({ orientation: e.target.value })}
                  >
                    <option value="portrait">竖版</option>
                    <option value="landscape">横版</option>
                  </select>
                </label>
                <label>
                  纸张
                  <select
                    value={String(draft.paperSize ?? 9)}
                    onChange={(e) => patchDraft({ paperSize: Number(e.target.value) })}
                  >
                    {PAPER_OPTIONS.map((o) => (
                      <option key={o.code} value={String(o.code)}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <div className="print-pop-hint">
                  {paperNow
                    ? `竖版 ${paperNow[0]} × ${paperNow[1]} mm · 纸号 ${draft.paperSize}`
                    : `纸号 ${draft.paperSize} 我们量不出尺寸，纸上按默认纸排`}
                </div>
              </fieldset>
              <fieldset className="print-sec">
                <legend>缩放</legend>
                <label className="print-inline">
                  <input
                    type="radio"
                    name="print-scale-mode"
                    checked={!draft.fitToPage}
                    onChange={() => patchDraft({ fitToPage: false })}
                  />
                  调整为
                  <input
                    className="print-num"
                    type="number"
                    min={10}
                    max={400}
                    disabled={!!draft.fitToPage}
                    value={draft.scale ?? ''}
                    onChange={(e) => patchDraft({ scale: numVal(e.target.value) })}
                  />
                  %
                </label>
                <label className="print-inline">
                  <input
                    type="radio"
                    name="print-scale-mode"
                    checked={!!draft.fitToPage}
                    onChange={() => patchDraft({ fitToPage: true })}
                  />
                  缩放到
                  <input
                    className="print-num"
                    type="number"
                    min={0}
                    max={99}
                    disabled={!draft.fitToPage}
                    value={draft.fitToWidth ?? ''}
                    onChange={(e) => patchDraft({ fitToWidth: numVal(e.target.value) })}
                  />
                  页宽 ×
                  <input
                    className="print-num"
                    type="number"
                    min={0}
                    max={99}
                    disabled={!draft.fitToPage}
                    value={draft.fitToHeight ?? ''}
                    onChange={(e) => patchDraft({ fitToHeight: numVal(e.target.value) })}
                  />
                  页高
                </label>
                <label>
                  页面顺序
                  <select
                    value={draft.pageOrder ?? 'downThenOver'}
                    onChange={(e) => patchDraft({ pageOrder: e.target.value })}
                  >
                    <option value="downThenOver">先向下再向右</option>
                    <option value="overThenDown">先向右再向下</option>
                  </select>
                </label>
              </fieldset>
              <fieldset className="print-sec">
                <legend>边距（毫米）</legend>
                <div className="print-margin-grid">
                  {MARGIN_FIELDS.map(([key, label]) => (
                    <label key={key} className="print-margin">
                      {label}
                      <input
                        type="number"
                        step="0.1"
                        value={mmVal(draft.margins?.[key])}
                        onChange={(e) => patchMargin(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="print-sec">
                <legend>这张纸上还要什么</legend>
                <div className="print-checks">
                  <label>
                    <input type="checkbox" checked={!!draft.gridLines} onChange={(e) => patchDraft({ gridLines: e.target.checked })} />
                    打印网格线
                  </label>
                  <label>
                    <input type="checkbox" checked={!!draft.headings} onChange={(e) => patchDraft({ headings: e.target.checked })} />
                    打印行列标题
                  </label>
                  <label>
                    <input type="checkbox" checked={!!draft.hCentered} onChange={(e) => patchDraft({ hCentered: e.target.checked })} />
                    水平居中
                  </label>
                  <label>
                    <input type="checkbox" checked={!!draft.vCentered} onChange={(e) => patchDraft({ vCentered: e.target.checked })} />
                    垂直居中
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!draft.oddEven}
                      onChange={(e) => {
                        patchDraft({ oddEven: e.target.checked })
                        // 取消勾选后偶数页那版就没地方看了，把视线拉回奇数页，别让下拉停在一档灰上
                        if (!e.target.checked) setHfVariant('odd')
                      }}
                    />
                    奇偶页另版
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!draft.firstDiffers}
                      onChange={(e) => {
                        patchDraft({ firstDiffers: e.target.checked })
                        if (!e.target.checked) setHfVariant('odd')
                      }}
                    />
                    首页另版
                  </label>
                </div>
                <label className="print-inline">
                  起始页码
                  <input
                    className="print-num"
                    type="number"
                    min={1}
                    value={draft.firstPageNumber ?? ''}
                    onChange={(e) => patchDraft({ firstPageNumber: numVal(e.target.value) })}
                  />
                  <span className="print-pop-hint">留空＝自动</span>
                </label>
              </fieldset>
              <fieldset className="print-sec">
                <legend>打印区域与重复标题</legend>
                <label className="print-inline">
                  打印区域
                  <input value={areaText} placeholder="$A$1:$E$18（留空＝整张表）" onChange={(e) => areaChanged(e.target.value)} />
                  <button className="tool-btn" onClick={() => useSelection('area')}>用当前选区</button>
                </label>
                <label className="print-inline">
                  重复标题行
                  <input className="print-short" value={titleRowsText} placeholder="1:2" onChange={(e) => titleRowsChanged(e.target.value)} />
                  <button className="tool-btn" onClick={() => useSelection('titleRows')}>用选区首行</button>
                </label>
                <label className="print-inline">
                  重复标题列
                  <input className="print-short" value={titleColsText} placeholder="A:B" onChange={(e) => titleColsChanged(e.target.value)} />
                  <button className="tool-btn" onClick={() => useSelection('titleCols')}>用选区首列</button>
                </label>
              </fieldset>
              <fieldset className="print-sec">
                <legend>手动分页符</legend>
                <div className="print-chips">
                  {breakChips(draft.rowBreaks, 'rows')}
                  {breakChips(draft.colBreaks, 'cols')}
                  {!(draft.rowBreaks?.length || draft.colBreaks?.length) && (
                    <span className="print-pop-hint">还没有：这一张纸由分页自己定</span>
                  )}
                </div>
                <label className="print-inline">
                  在第 N 行上方
                  <input className="print-num" type="number" min={2} value={breakRow} onChange={(e) => setBreakRow(e.target.value)} />
                  <button className="tool-btn" onClick={() => addBreakAt('rows')}>分页</button>
                </label>
                <label className="print-inline">
                  在第 N 列左侧
                  <input className="print-num" type="number" min={2} value={breakCol} onChange={(e) => setBreakCol(e.target.value)} />
                  <button className="tool-btn" onClick={() => addBreakAt('cols')}>分页</button>
                </label>
                <div className="print-pop-hint">N 是「这一行/列自己开始新的一页」，与 Excel 写在文件里的 brk@id 同一个说法</div>
              </fieldset>
            </div>
            <fieldset className="print-sec print-sec-wide">
              <legend>页眉页脚</legend>
              <label className="print-inline">
                看哪一版
                <select value={hfVariant} onChange={(e) => setHfVariant(e.target.value as HfVariant)}>
                  <option value="odd">奇数页</option>
                  <option value="even" disabled={!draft.oddEven}>偶数页</option>
                  <option value="first" disabled={!draft.firstDiffers}>首页</option>
                </select>
                <span className="print-pop-hint">先在框里点一下定位，再按格式码按钮往里插</span>
              </label>
              {hfRow('header', '页眉')}
              {hfRow('footer', '页脚')}
              <div className="print-checks">
                <label>
                  <input
                    type="checkbox"
                    checked={draft.scaleWithDoc !== false}
                    onChange={(e) => patchDraft({ scaleWithDoc: e.target.checked ? null : false })}
                  />
                  页眉页脚随文档缩放
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.alignWithMargins !== false}
                    onChange={(e) => patchDraft({ alignWithMargins: e.target.checked ? null : false })}
                  />
                  与页边距对齐
                </label>
              </div>
              <div className="print-pop-hint">
                两枚都是 Excel 的默认勾：勾着＝不往文件里写。缩放那一档我们照 Excel 把页眉字号一起乘；
                取消「与页边距对齐」后我们铺到纸张边缘，Excel 铺到的是打印机的可打印区（窄一圈）
              </div>
            </fieldset>
            {draftErrs.length > 0 && (
              <ul className="print-pop-errs">
                {draftErrs.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            {paperNotes.length > 0 && (
              <div className="print-pop-notes">
                <div className="print-pop-notes-title">这几条会写进文件（别人在 Excel 里打印生效），我们的 PDF 上照下面说的兑现：</div>
                <ul>
                  {paperNotes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="chart-pop-actions">
              <button
                className="tool-btn tool-btn-primary"
                disabled={draftErrs.length > 0 || !panelWs}
                onClick={confirmPrint}
              >
                确定
              </button>
              {hadSetup && (
                <button className="tool-btn" onClick={clearPrint}>清除这张表的设置</button>
              )}
              <button className="tool-btn" onClick={() => setPrintOpen(false)}>取消</button>
            </div>
            {!panelWs && <div className="print-pop-errs">「{draftSheet}」这张表已经不在了，先关掉这个面板</div>}
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
