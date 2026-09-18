import { CellValueType, LocaleType } from '@univerjs/presets'
import type { IWorkbookData, IWorksheetData, IObjectMatrixPrimitiveType, ICellData } from '@univerjs/presets'
import type { WorkbookPayload } from './fs'

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

export function payloadToWorkbook(payload: WorkbookPayload, name: string): IWorkbookData {
  const sheets: Record<string, Partial<IWorksheetData>> = {}
  const sheetOrder: string[] = []
  payload.sheets.forEach((sheet, i) => {
    const id = `sheet-${i}`
    const ws = emptySheet(id, sheet.name)
    const cellData: IObjectMatrixPrimitiveType<ICellData> = {}
    let maxR = 0
    let maxC = 0
    for (const cell of sheet.cells) {
      const row = (cellData[cell.r] ??= {})
      row[cell.c] = {
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
      if (cell.r > maxR) maxR = cell.r
      if (cell.c > maxC) maxC = cell.c
    }
    ws.cellData = cellData
    ws.rowCount = Math.max(MIN_ROWS, maxR + 20)
    ws.columnCount = Math.max(MIN_COLS, maxC + 5)
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
    styles: {},
    sheetOrder,
    sheets,
    resources: [],
  } as unknown as IWorkbookData
}

export function workbookToPayload(data: IWorkbookData): WorkbookPayload {
  const sheets: WorkbookPayload['sheets'] = []
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
        if ((value == null || value === '') && !formula) continue
        cells.push({
          r,
          c,
          v:
            typeof value === 'object' && value !== null
              ? String(value)
              : (value as string | number | boolean | null),
          f: formula,
        })
      }
    }
    sheets.push({ name: sheet.name ?? `Sheet${sheets.length + 1}`, cells })
  }
  return { sheets }
}
