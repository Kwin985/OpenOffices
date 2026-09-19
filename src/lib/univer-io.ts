import { CellValueType, LocaleType } from '@univerjs/presets'
import type { IWorkbookData, IWorksheetData, IObjectMatrixPrimitiveType, ICellData } from '@univerjs/presets'
import type { CellStyle, MergeRange, WorkbookPayload } from './fs'

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

function styleKey(s: CellStyle): string {
  return JSON.stringify([!!s.bl, !!s.it, s.fs ?? 0, s.cl ?? '', s.bg ?? ''])
}

function toUniverStyle(s: CellStyle): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (s.bl) out.bl = 1
  if (s.it) out.it = 1
  if (s.fs != null) out.fs = s.fs
  if (s.cl) out.cl = { rgb: ensureHash(s.cl) }
  if (s.bg) out.bg = { rgb: ensureHash(s.bg) }
  return out
}

function flattenStyle(sd: Record<string, unknown> | undefined | null): CellStyle | null {
  if (!sd || typeof sd !== 'object') return null
  const out: CellStyle = {}
  if (sd.bl) out.bl = true
  if (sd.it) out.it = true
  const fs = sd.fs
  if (typeof fs === 'number' && fs > 0 && fs !== 11) out.fs = fs
  const cl = typeof sd.cl === 'string' ? sd.cl : (sd.cl as { rgb?: string } | undefined)?.rgb
  if (cl) out.cl = ensureHash(cl)
  const bg = typeof sd.bg === 'string' ? sd.bg : (sd.bg as { rgb?: string } | undefined)?.rgb
  if (bg) out.bg = ensureHash(bg)
  return Object.keys(out).length > 0 ? out : null
}

export function payloadToWorkbook(payload: WorkbookPayload, name: string): IWorkbookData {
  const sheets: Record<string, Partial<IWorksheetData>> = {}
  const sheetOrder: string[] = []
  const styles: Record<string, unknown> = {}
  const styleIds = new Map<string, string>()
  payload.sheets.forEach((sheet, i) => {
    const id = `sheet-${i}`
    const ws = emptySheet(id, sheet.name)
    const cellData: IObjectMatrixPrimitiveType<ICellData> = {}
    let maxR = 0
    let maxC = 0
    for (const cell of sheet.cells) {
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
      row[cell.c] = data
      if (cell.r > maxR) maxR = cell.r
      if (cell.c > maxC) maxC = cell.c
    }
    ws.cellData = cellData
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
    resources: [],
  } as unknown as IWorkbookData
}

export function workbookToPayload(data: IWorkbookData): WorkbookPayload {
  const sheets: WorkbookPayload['sheets'] = []
  const styleSource = (data.styles ?? {}) as Record<string, Record<string, unknown>>
  for (const sheetId of data.sheetOrder) {
    const sheet = data.sheets[sheetId]
    if (!sheet) continue
    const cells: WorkbookPayload['sheets'][number]['cells'] = []
    const matrix = (sheet.cellData ?? {}) as Record<string, Record<string, ICellData | undefined> | undefined>
    for (const [rStr, row] of Object.entries(matrix)) {
      if (!row) continue
      const r = Number(rStr)
      for (const [cStr, cell] of Object.entries(row)) {
        const c = Number(cStr)
        const value = cell?.v
        const formula = typeof cell?.f === 'string' && cell.f.length > 0 ? cell.f : null
        const raw = cell?.s
        const style =
          typeof raw === 'string'
            ? flattenStyle(styleSource[raw])
            : flattenStyle(raw as Record<string, unknown> | undefined)
        if ((value == null || value === '') && !formula && !style) continue
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
    sheets.push({ name: sheet.name ?? `Sheet${sheets.length + 1}`, cells, merges })
  }
  return { sheets }
}
