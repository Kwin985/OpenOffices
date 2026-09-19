import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile, readFile, writeFile } from '@tauri-apps/plugin-fs'
import type { DocKind } from '../store'

export interface CellStyle {
  bl?: boolean
  it?: boolean
  fs?: number
  cl?: string
  bg?: string
}

export interface MergeRange {
  startRow: number
  startColumn: number
  endRow: number
  endColumn: number
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
}

export interface WorkbookPayload {
  sheets: SheetPayload[]
}

const SHEET_EXTS = ['xlsx', 'xls', 'ods', 'csv']
const DOC_EXTS = ['docx', 'odoc']
const PPT_EXTS = ['pptx', 'ppt', 'opd']

export function kindOfPath(path: string): DocKind | undefined {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (SHEET_EXTS.includes(ext)) return 'sheet'
  if (DOC_EXTS.includes(ext)) return 'doc'
  if (PPT_EXTS.includes(ext)) return 'ppt'
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
      { name: '所有支持格式', extensions: [...SHEET_EXTS, ...DOC_EXTS, ...PPT_EXTS] },
      { name: '表格', extensions: SHEET_EXTS },
      { name: '文档', extensions: DOC_EXTS },
      { name: '演示', extensions: PPT_EXTS },
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
