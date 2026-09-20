import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile, readFile, writeFile } from '@tauri-apps/plugin-fs'
import type { DocKind } from '../store'

// s=OOXML 边框样式名（thin/medium/dashed/dotted/double/hair/thick/…），c=#rrggbb
export interface BorderLine {
  s?: string
  c?: string
}

export interface CellBorder {
  t?: BorderLine | null
  r?: BorderLine | null
  b?: BorderLine | null
  l?: BorderLine | null
}

export interface CellStyle {
  bl?: boolean
  it?: boolean
  fs?: number
  cl?: string
  bg?: string
  bd?: CellBorder
  ho?: 'left' | 'center' | 'right' | 'justify'
  vo?: 'top' | 'middle' | 'bottom'
  wb?: boolean
  /** 数字格式模式串，如 #,##0.00 / 0.00% / @ */
  nf?: string
  /** 字体族名（默认 Calibri/等线 不写入） */
  ff?: string
}

export interface MergeRange {
  startRow: number
  startColumn: number
  endRow: number
  endColumn: number
}

export interface ChartRangeRef {
  sheet: string
  r1: number
  c1: number
  r2: number
  c2: number
}

export interface ChartSeriesPayload {
  name: string
  cat: ChartRangeRef | null
  val: ChartRangeRef
  cats: (string | number | boolean | null)[]
  vals: number[]
}

// 图表载荷：column|bar|line|pie|doughnut|area；grouping 为 standard|stacked|percentStacked
export interface ChartPayload {
  chartType: string
  grouping: string
  title: string
  anchorRow: number
  anchorCol: number
  width: number
  height: number
  series: ChartSeriesPayload[]
}

export interface CellPayload {
  r: number
  c: number
  v?: string | number | boolean | null
  f?: string | null
  s?: CellStyle | null
}

export interface SheetPayload {
  name: string
  cells: CellPayload[]
  merges?: MergeRange[]
  charts?: ChartPayload[]
  /** 列号 → 宽度像素（与 Univer 快照同单位；HashMap 序列化为字符串键） */
  colWidths?: Record<string, number>
  /** 行号 → 高度像素 */
  rowHeights?: Record<string, number>
}

export interface WorkbookPayload {
  sheets: SheetPayload[]
}

const SHEET_EXTS = ['xlsx', 'xls', 'ods', 'csv']
const DOC_EXTS = ['docx', 'odoc', 'odt']
const PPT_EXTS = ['pptx', 'ppt', 'opd']
const PDF_EXTS = ['pdf']

export function kindOfPath(path: string): DocKind | undefined {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (SHEET_EXTS.includes(ext)) return 'sheet'
  if (DOC_EXTS.includes(ext)) return 'doc'
  if (PPT_EXTS.includes(ext)) return 'ppt'
  if (PDF_EXTS.includes(ext)) return 'pdf'
  return undefined
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export async function pickOpenFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [
      { name: '所有支持格式', extensions: [...SHEET_EXTS, ...DOC_EXTS, ...PPT_EXTS, ...PDF_EXTS] },
      { name: '表格', extensions: SHEET_EXTS },
      { name: '文档', extensions: DOC_EXTS },
      { name: '演示', extensions: PPT_EXTS },
      { name: 'PDF', extensions: PDF_EXTS },
    ],
  })
  return typeof selected === 'string' ? selected : null
}

export async function pickSaveFile(defaultName: string, extensions: string[]): Promise<string | null> {
  let path = await save({ defaultPath: defaultName, filters: [{ name: '文件', extensions }] })
  if (!path) return null
  if (!extensions.some((e) => path!.toLowerCase().endsWith(`.${e}`))) {
    path = `${path}.${extensions[0]}`
  }
  return path
}

export async function readText(path: string): Promise<string> {
  return readTextFile(path)
}

export async function writeText(path: string, content: string): Promise<void> {
  await writeTextFile(path, content)
}

export async function readBytes(path: string): Promise<Uint8Array> {
  return readFile(path)
}

export async function writeBytes(path: string, data: Uint8Array): Promise<void> {
  await writeFile(path, data)
}

export async function readXlsx(path: string): Promise<WorkbookPayload> {
  return invoke<WorkbookPayload>('read_xlsx', { path })
}

export async function writeXlsx(path: string, workbook: WorkbookPayload): Promise<void> {
  await invoke('write_xlsx', { path, workbook })
}

export async function writeOds(path: string, workbook: WorkbookPayload): Promise<void> {
  await invoke('write_ods', { path, workbook })
}
