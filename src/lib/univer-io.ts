import { CellValueType, LocaleType } from '@univerjs/presets'
import type { IWorkbookData, IWorksheetData, IObjectMatrixPrimitiveType, ICellData } from '@univerjs/presets'
import type {
  BorderLine,
  CellBorder,
  CellNotePayload,
  CellStyle,
  MergeRange,
  SheetPayload,
  WorkbookPayload,
} from './fs'
import { aggregateNotes, extractRules } from './sheet-rules'
import { extractCellSide, richTextBox, richTextOf, univerUrlOf, noteResourceOf } from './sheet-cell-side'

const MIN_ROWS = 100
const MIN_COLS = 26

function emptySheet(id: string, name: string): Partial<IWorksheetData> {
  return {
    id,
    name,
    rowCount: MIN_ROWS,
    columnCount: MIN_COLS,
    cellData: {},
    hidden: 0,
    freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
    showGridlines: 1,
    rowHeader: { width: 46, hidden: 0 },
    columnHeader: { height: 20, hidden: 0 },
  }
}

function ensureHash(rgb: string): string {
  return rgb.startsWith('#') ? rgb : `#${rgb}`
}

// 数值取自 @univerjs/core 的 BorderStyleTypes / HorizontalAlign / VerticalAlign / WrapStrategy 枚举
const BORDER_STYLE_NUM: Record<string, number> = {
  thin: 1, hair: 2, dotted: 3, dashed: 4, dashDot: 5, dashDotDot: 6, double: 7,
  medium: 8, mediumDashed: 9, mediumDashDot: 10, mediumDashDotDot: 11, slantDashDot: 12, thick: 13,
}
const BORDER_STYLE_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(BORDER_STYLE_NUM).map(([k, v]) => [v, k]),
)
const HO_NUM: Record<string, number> = { left: 1, center: 2, right: 3, justify: 4 }
const HO_NAME: Record<number, CellStyle['ho']> = { 1: 'left', 2: 'center', 3: 'right', 4: 'justify', 5: 'justify' }
const VO_NUM: Record<string, number> = { top: 1, middle: 2, bottom: 3 }
const VO_NAME: Record<number, CellStyle['vo']> = { 1: 'top', 2: 'middle', 3: 'bottom' }
// WrapStrategy.WRAP = 3
const WRAP = 3

function borderKey(b: CellBorder | undefined): string {
  if (!b) return ''
  const side = (x: BorderLine | null | undefined) => (x?.s ? `${x.s}:${x.c ?? ''}` : '')
  return [side(b.t), side(b.r), side(b.b), side(b.l)].join(',')
}

function styleKey(s: CellStyle): string {
  return JSON.stringify([
    !!s.bl, !!s.it, s.fs ?? 0, s.ff ?? '', s.cl ?? '', s.bg ?? '',
    s.ho ?? '', s.vo ?? '', !!s.wb, s.nf ?? '', borderKey(s.bd),
  ])
}

function toUniverStyle(s: CellStyle): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (s.bl) out.bl = 1
  if (s.it) out.it = 1
  if (s.fs != null) out.fs = s.fs
  if (s.ff) out.ff = s.ff
  if (s.cl) out.cl = { rgb: ensureHash(s.cl) }
  if (s.bg) out.bg = { rgb: ensureHash(s.bg) }
  if (s.bd) {
    const bd: Record<string, unknown> = {}
    for (const [key, line] of [['t', s.bd.t], ['r', s.bd.r], ['b', s.bd.b], ['l', s.bd.l]] as const) {
      if (line?.s) {
        const num = BORDER_STYLE_NUM[line.s]
        if (num) bd[key] = { s: num, cl: { rgb: ensureHash(line.c ?? '#000000') } }
      }    }
    if (Object.keys(bd).length) out.bd = bd
  }
  if (s.ho && HO_NUM[s.ho]) out.ht = HO_NUM[s.ho]
  if (s.vo && VO_NUM[s.vo]) out.vt = VO_NUM[s.vo]
  if (s.wb) out.tb = WRAP
  if (s.nf) out.n = { pattern: s.nf }
  return out
}

function readColor(v: unknown): string | undefined {
  if (typeof v === 'string') return v || undefined
  const rgb = (v as { rgb?: string } | null | undefined)?.rgb
  return rgb || undefined
}

function flattenStyle(sd: Record<string, unknown> | undefined | null): CellStyle | null {
  if (!sd || typeof sd !== 'object') return null
  const out: CellStyle = {}
  if (sd.bl) out.bl = true
  if (sd.it) out.it = true
  const fs = sd.fs
  if (typeof fs === 'number' && fs > 0 && fs !== 11) out.fs = fs
  if (typeof sd.ff === 'string' && sd.ff && sd.ff !== 'Calibri' && sd.ff !== '等线') out.ff = sd.ff
  const cl = readColor(sd.cl)
  if (cl) out.cl = ensureHash(cl)
  const bg = readColor(sd.bg)
  if (bg) out.bg = ensureHash(bg)
  const bd = sd.bd as Record<string, { s?: number; cl?: unknown } | null | undefined> | undefined
  if (bd) {
    const cellBd: CellBorder = {}
    for (const key of ['t', 'r', 'b', 'l'] as const) {
      const line = bd[key]
      if (!line || line.s == null) continue
      const name = BORDER_STYLE_NAME[line.s]
      if (name) {
        const c = readColor(line.cl)
        cellBd[key] = c ? { s: name, c: ensureHash(c) } : { s: name }
      }
    }
    if (cellBd.t || cellBd.r || cellBd.b || cellBd.l) out.bd = cellBd
  }
  if (typeof sd.ht === 'number' && HO_NAME[sd.ht]) out.ho = HO_NAME[sd.ht]
  if (typeof sd.vt === 'number' && VO_NAME[sd.vt]) out.vo = VO_NAME[sd.vt]
  if (sd.tb === WRAP) out.wb = true
  const n = sd.n as { pattern?: string } | undefined
  if (n?.pattern) out.nf = n.pattern
  return Object.keys(out).length > 0 ? out : null
}

/** accounts：放侧的边界账（链接摆不进界面这类），由调用方接去状态栏 */
export function payloadToWorkbook(
  payload: WorkbookPayload,
  name: string,
  accounts: string[] = [],
): IWorkbookData {
  const sheets: Record<string, Partial<IWorksheetData>> = {}
  const sheetOrder: string[] = []
  const styles: Record<string, unknown> = {}
  const styleIds = new Map<string, string>()
  // 载荷里的链接认表名，Univer 的 #gid= 认表 id，先建一张对照表
  const nameToId = new Map(payload.sheets.map((s, i) => [s.name, `sheet-${i}`]))
  const noteSheets: Array<{ id: string; notes?: CellNotePayload[] }> = []
  payload.sheets.forEach((sheet, i) => {
    const id = `sheet-${i}`
    const ws = emptySheet(id, sheet.name)
    const cellData: IObjectMatrixPrimitiveType<ICellData> = {}
    let maxR = 0
    let maxC = 0
    // 链接要写成富文本格（Univer 显示这一格吃的是 p 而不是 v），公式格上那枚先记账不硬放
    const linkAt = new Map<string, string>()
    for (const l of sheet.links ?? []) {
      const url = univerUrlOf(l, nameToId)
      if (!url) {
        accounts.push(
          `第 ${l.r + 1} 行第 ${l.c + 1} 列的链接（${l.location ?? l.url ?? '没有目标'}）界面上放不出这么一枚`,
        )
        continue
      }
      linkAt.set(`${l.r},${l.c}`, url)
    }
    const placed = new Set<string>()
    const putLink = (r: number, c: number, data: ICellData, text: string) => {
      const url = linkAt.get(`${r},${c}`)
      if (!url) return
      // 与门面建出来的形状保持一致：这一格在会话里就是文本（实测数字挂链接也是先转文本）
      data.v = text
      data.t = CellValueType.STRING
      data.p = richTextBox(url, text, `oo-${id}-${r}-${c}`) as unknown as ICellData['p']
    }
    for (const cell of sheet.cells) {
      const key = `${cell.r},${cell.c}`
      const row = (cellData[cell.r] ??= {})
      const data: ICellData = {
        v: cell.v ?? null,
        t:
          typeof cell.v === 'number'
            ? CellValueType.NUMBER
            : typeof cell.v === 'boolean'
              ? CellValueType.BOOLEAN
              : cell.v != null
                ? CellValueType.STRING
                : CellValueType.FORCE_STRING,
        ...(cell.f ? { f: cell.f } : {}),
      }
      if (cell.s) {
        const key = styleKey(cell.s)
        let sid = styleIds.get(key)
        if (!sid) {
          sid = `oo${styleIds.size + 1}`
          styleIds.set(key, sid)
          styles[sid] = toUniverStyle(cell.s)
        }
        data.s = sid as ICellData['s']
      }
      if (linkAt.has(key)) {
        if (cell.f) {
          accounts.push(`第 ${cell.r + 1} 行第 ${cell.c + 1} 列是公式格又挂了链接，链接未放进界面`)
        } else {
          putLink(cell.r, cell.c, data, cell.v == null ? '' : String(cell.v))
        }
      }
      placed.add(key)
      row[cell.c] = data
      if (cell.r > maxR) maxR = cell.r
      if (cell.c > maxC) maxC = cell.c
    }
    // 只有链接、格子里没内容的：也要占一格，否则这枚链接在会话里没有落脚的地方
    for (const [key, url] of linkAt) {
      if (placed.has(key)) continue
      const [r, c] = key.split(',').map(Number)
      const row = (cellData[r] ??= {})
      const data: ICellData = { v: '', t: CellValueType.STRING }
      data.p = richTextBox(url, '', `oo-${id}-${r}-${c}`) as unknown as ICellData['p']
      row[c] = data
      if (r > maxR) maxR = r
      if (c > maxC) maxC = c
    }
    ws.cellData = cellData
    noteSheets.push({ id, ...(sheet.notes?.length ? { notes: sheet.notes } : {}) })
    // 列宽/行高/隐藏：载荷像素与 Univer columnData.w / rowData.h 同单位；hd=1 即隐藏
    type ColDatum = { w?: number; hd?: number }
    type RowDatum = { h?: number; hd?: number }
    const columnData: Record<string, ColDatum> = {}
    for (const [k, px] of Object.entries(sheet.colWidths ?? {})) {
      const c = Number(k)
      if (!Number.isInteger(c) || c < 0 || !(px > 0)) continue
      columnData[k] = { w: Math.round(px) }
      if (c > maxC) maxC = c
    }
    for (const c of sheet.hiddenCols ?? []) {
      if (!Number.isInteger(c) || c < 0) continue
      columnData[String(c)] = { ...columnData[String(c)], hd: 1 }
      if (c > maxC) maxC = c
    }
    const rowData: Record<string, RowDatum> = {}
    for (const [k, px] of Object.entries(sheet.rowHeights ?? {})) {
      const r = Number(k)
      if (!Number.isInteger(r) || r < 0 || !(px > 0)) continue
      rowData[k] = { h: Math.round(px) }
      if (r > maxR) maxR = r
    }
    for (const r of sheet.hiddenRows ?? []) {
      if (!Number.isInteger(r) || r < 0) continue
      rowData[String(r)] = { ...rowData[String(r)], hd: 1 }
      if (r > maxR) maxR = r
    }
    if (Object.keys(columnData).length) ws.columnData = columnData
    if (Object.keys(rowData).length) ws.rowData = rowData
    // 冻结窗格：xSplit/ySplit 是冻结带列/行数，startRow/startColumn 是可视区起点
    const fz = sheet.freeze
    if (fz && (fz.rows > 0 || fz.cols > 0)) {
      ws.freeze = { xSplit: fz.cols, ySplit: fz.rows, startRow: fz.rows, startColumn: fz.cols }
    }
    ws.rowCount = Math.max(MIN_ROWS, maxR + 20)
    ws.columnCount = Math.max(MIN_COLS, maxC + 5)
    const merges = (sheet.merges ?? []).filter(
      (m) => m.endRow > m.startRow || m.endColumn > m.startColumn,
    )
    if (merges.length > 0) ws.mergeData = merges as IWorksheetData['mergeData']
    sheets[id] = ws
    sheetOrder.push(id)
  })
  if (sheetOrder.length === 0) {
    sheets['sheet-0'] = emptySheet('sheet-0', 'Sheet1')
    sheetOrder.push('sheet-0')
  }
  return {
    id: `wb-${Date.now()}`,
    name,
    appVersion: '',
    locale: LocaleType.ZH_CN,
    styles,
    sheetOrder,
    sheets,
    // 批注只有这一条通道：实测裸写 resources 与走门面建出来的产物一模一样
    resources: [noteResourceOf(noteSheets)].filter((r): r is { name: string; data: string } => !!r),
  } as unknown as IWorkbookData
}

export function workbookToPayload(data: IWorkbookData): WorkbookPayload {
  const sheets: WorkbookPayload['sheets'] = []
  const bySheetId = new Map<string, SheetPayload>()
  const styleSource = (data.styles ?? {}) as Record<string, Record<string, unknown>>
  // 批注在 resources、超链接在每格的富文本区间里，两处都不走门面（实测裸写就能被门面读回）
  const sideArgs: Array<{ id: string; name: string; cellData: unknown }> = []
  for (const id of data.sheetOrder) {
    const s = data.sheets[id]
    if (s) sideArgs.push({ id, name: s.name ?? id, cellData: s.cellData })
  }
  const cellSide = extractCellSide((data as unknown as { resources?: unknown }).resources, sideArgs)
  for (const sheetId of data.sheetOrder) {
    const sheet = data.sheets[sheetId]
    if (!sheet) continue
    const side = cellSide.side.get(sheetId)
    // 挂链接的格子只有 p 没有 v（门面建链接时不写 v），所以按"这格有没有链接"决定要不要留
    const linkKeys = new Set((side?.links ?? []).map((l) => `${l.r},${l.c}`))
    const cells: WorkbookPayload['sheets'][number]['cells'] = []
    const matrix = (sheet.cellData ?? {}) as Record<string, Record<string, ICellData | undefined> | undefined>
    for (const [rStr, row] of Object.entries(matrix)) {
      if (!row) continue
      const r = Number(rStr)
      for (const [cStr, cell] of Object.entries(row)) {
        const c = Number(cStr)
        // 富文本优先：实测挂了链接又改了显示文本的格子，v 留的是旧值而 dataStream 才是看到的
        const value = richTextOf(cell) ?? cell?.v
        const formula = typeof cell?.f === 'string' && cell.f.length > 0 ? cell.f : null
        const raw = cell?.s
        const style =
          typeof raw === 'string'
            ? flattenStyle(styleSource[raw])
            : flattenStyle(raw as Record<string, unknown> | undefined)
        if ((value == null || value === '') && !formula && !style && !linkKeys.has(`${r},${c}`)) continue
        cells.push({
          r,
          c,
          v:
            typeof value === 'object' && value !== null
              ? String(value)
              : (value as string | number | boolean | null),
          f: formula,
          ...(style ? { s: style } : {}),
        })
      }
    }
    const merges: MergeRange[] = ((sheet.mergeData ?? []) as unknown as MergeRange[]).map((m) => ({
      startRow: m.startRow,
      startColumn: m.startColumn,
      endRow: m.endRow,
      endColumn: m.endColumn,
    }))
    const colWidths: Record<string, number> = {}
    const hiddenCols: number[] = []
    for (const [k, v] of Object.entries(
      (sheet.columnData ?? {}) as Record<string, { w?: number; hd?: number } | null | undefined>,
    )) {
      if (typeof v?.w === 'number' && v.w > 0) colWidths[k] = v.w
      if (v?.hd === 1) {
        const c = Number(k)
        if (Number.isInteger(c) && c >= 0) hiddenCols.push(c)
      }
    }
    hiddenCols.sort((a, b) => a - b)
    const rowHeights: Record<string, number> = {}
    const hiddenRows: number[] = []
    for (const [k, v] of Object.entries(
      (sheet.rowData ?? {}) as Record<string, { h?: number; ah?: number; ia?: number; hd?: number } | null | undefined>,
    )) {
      // ia=1 表示行高自适应内容，实际渲染高度记在 ah
      const px = v?.ia ? v.ah : v?.h
      if (typeof px === 'number' && px > 0) rowHeights[k] = px
      if (v?.hd === 1) {
        const r = Number(k)
        if (Number.isInteger(r) && r >= 0) hiddenRows.push(r)
      }
    }
    hiddenRows.sort((a, b) => a - b)
    // 冻结窗格：xSplit=冻结列数、ySplit=冻结行数（startRow/startColumn 是可视区起点，不用）
    const fr = (sheet.freeze ?? {}) as { xSplit?: number; ySplit?: number }
    const rows = typeof fr.ySplit === 'number' ? fr.ySplit : 0
    const cols = typeof fr.xSplit === 'number' ? fr.xSplit : 0
    const freeze = rows > 0 || cols > 0 ? { rows, cols } : undefined
    const out: SheetPayload = {
      name: sheet.name ?? `Sheet${sheets.length + 1}`,
      cells,
      merges,
      ...(Object.keys(colWidths).length ? { colWidths } : {}),
      ...(Object.keys(rowHeights).length ? { rowHeights } : {}),
      ...(hiddenCols.length ? { hiddenCols } : {}),
      ...(hiddenRows.length ? { hiddenRows } : {}),
      ...(freeze ? { freeze } : {}),
      ...(side?.notes?.length ? { notes: side.notes } : {}),
      ...(side?.links?.length ? { links: side.links } : {}),
    }
    sheets.push(out)
    bySheetId.set(sheetId, out)
  }
  // 规则侧通道：筛选/数据验证/条件格式住在 resources 里（Univer 各插件自己序列化的一份），
  // 快照的 sheet 对象上根本没有它们，所以取完单元格再按 sheetId 对回每张表
  const { rules, notes } = extractRules((data as unknown as { resources?: unknown }).resources)
  for (const [sheetId, rule] of rules) {
    const payload = bySheetId.get(sheetId)
    if (!payload) continue
    if (rule.filter) payload.filter = rule.filter
    if (rule.dataValidations) payload.dataValidations = rule.dataValidations
    if (rule.condFormats) payload.condFormats = rule.condFormats
  }
  const warnings = aggregateNotes([...notes, ...cellSide.notes])
  return { sheets, ...(warnings.length ? { warnings } : {}) }
}
