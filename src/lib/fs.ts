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

/** 单元格区：0 基、含端点（与 Univer IRange 同形，去掉 unitId/sheetId 这类运行时标识） */
export interface RangeRect {
  startRow: number
  startColumn: number
  endRow: number
  endColumn: number
}

/** 列筛选条件：勾选值（list）与表达式（custom）二选一，正对 OOXML <filterColumn> 的两种子元素 */
export interface FilterColumnPayload {
  /** 绝对列号（与 Univer 的存法一致）；OOXML 的 filterColumn colId 是相对筛选区首列的，换算在写侧 */
  col: number
  /** 是否把空值也算作命中项 */
  blank?: boolean
  list?: string[]
  custom?: { and?: boolean; items: { op?: string; v: string }[] }
}

export interface SheetFilterPayload {
  ref: RangeRect
  columns: FilterColumnPayload[]
  /** 当前被筛掉的行号（绝对行）。Univer 按条件现算，只喂打印——OOXML/ODF 里没有这个字段的位置 */
  filteredOut?: number[]
}

/** 数据验证：type/op 直接采用 OOXML 字面（whole/decimal/list/date/textLength/custom + between/equal/…） */
export interface DataValidationPayload {
  ranges: RangeRect[]
  type: string
  op?: string
  /** OOXML formula1：list 存 `"甲,乙,丙"` 或区域引用，custom 存表达式 */
  f1?: string
  f2?: string
  blank?: boolean
  /** list 的下拉箭头；OOXML 的 showDropDown="1" 反而是"没有箭头"，换算在写侧 */
  dropdown?: boolean
  errStyle?: 'stop' | 'warning' | 'information'
  errTitle?: string
  err?: string
  promptTitle?: string
  prompt?: string
}

/** 条件格式的着色部分，对应 OOXML <dxf>（只带表格条件格式真会用到的几样） */
export interface CondFormatStyle {
  bg?: string
  cl?: string
  bl?: boolean
  it?: boolean
  ul?: boolean
  st?: boolean
}

/** 色阶的一档：t=min|max|num|percent|percentile|formula|auto */
export interface CondFormatStop {
  color: string
  t: string
  v?: number | string | null
}

/** 数据条的端点：数值条不需要颜色 */
export interface CondFormatBarStop {
  t: string
  v?: number | string | null
}

/** 图标集的一档：op 用 OOXML 字面（greaterThan/greaterThanOrEqual），t/v 同档位端点 */
export interface CondFormatIconLevel {
  op: string
  t: string
  v?: number | string | null
}

/** 条件格式一条规则。kind 对齐 OOXML cfRule@type 的四大类；sub 是 highlight 的判定子类 */
export interface CondFormatPayload {
  ranges: RangeRect[]
  kind: 'cell' | 'colorScale' | 'dataBar' | 'iconSet'
  /** kind=cell：number/text/timePeriod/rank/average/uniqueValues/duplicateValues/formula（读第三方件时由 cellIs/containsText/top10/aboveAverage/… 归一到这几个） */
  sub?: string
  op?: string
  v1?: string | number | null
  v2?: string | number | null
  fmt?: CondFormatStyle
  /** 色阶档位（2 或 3 档，低→高） */
  scale?: CondFormatStop[]
  bar?: { min: CondFormatBarStop; max: CondFormatBarStop; pos: string; neg?: string; grad?: boolean }
  /** 图标集样式名（OOXML iconSet@val，如 3TrafficLights1） */
  iconStyle?: string
  /** 图标集档位，按"高→低"排（与 Univer 的 config 同向） */
  icons?: CondFormatIconLevel[]
  /** 图标集/数据条是否照常显示单元格里的值 */
  showValue?: boolean
  /** 命中即停（OOXML cfRule@stopIfTrue） */
  stop?: boolean
}

export interface CellPayload {
  r: number
  c: number
  v?: string | number | boolean | null
  f?: string | null
  s?: CellStyle | null
}

/**
 * 单元格批注。Univer 的批注模型只有正文与气泡尺寸（ISheetNote 里没有作者这一项），
 * 所以 author 是"打开时从文件里读到、存盘时按格子回贴"的元数据。
 */
export interface CellNotePayload {
  r: number
  c: number
  text: string
  author?: string
  /** 气泡宽/高（像素，缺省用写侧的默认值） */
  width?: number
  height?: number
  /** 打开文件时是否把气泡摊开 */
  show?: boolean
}

/** 单元格超链接。url（外部地址）与 location（表内跳转）二选一 */
export interface CellLinkPayload {
  r: number
  c: number
  /** 外部地址，含 mailto: 这类带方案的链接 */
  url?: string
  /** 表内跳转目标，形状照 OOXML hyperlink@location：Sheet2!A1 / 'Sales Data'!A1:G5 */
  location?: string
  /** 悬停提示（OOXML hyperlink@tooltip）。Univer 装不下，与 author 同路回贴 */
  tip?: string
}

/** 页眉/页脚的一条：OOXML 就存一条串，里头用 &L/&C/&R 分左中右三段，
 *  &A 表名、&P/&N 页码/总页、&D 日期、&F 文件名。字段名与 OOXML 的 odd/even/first 三档同向 */
export interface PrintHfPayload {
  odd?: string | null
  even?: string | null
  first?: string | null
}

/** 页面边距（英寸浮点，与 OOXML <pageMargins> 同单位；Excel 写出的值常带 0.449999… 这种噪点，原样收） */
export interface PrintMarginsPayload {
  top?: number | null
  right?: number | null
  bottom?: number | null
  left?: number | null
  /** 页眉自身基线到纸边的距离（英寸）。CSS 的 @page 边距里没有这一档，只用于边距够不够放页眉 */
  header?: number | null
  footer?: number | null
}

/** 一张表的打印设置：页面/纸张/边距/页眉页脚/手动分页符/打印区域/重复标题行。
 *  全字段来自 OOXML 字面（枚举收字面、边距收英寸、区域收 0 基含端点、分页符收「这一行/列自己开始新的一页」的下标），
 *  Univer 的模型里根本没有这一层，所以它只活在我们自己的侧通道里（见 sheet-print-setup.ts） */
export interface SheetPrintPayload {
  /** landscape / portrait */
  orientation?: string | null
  /** OOXML paperSize 数字（9 = A4） */
  paperSize?: number | null
  /** 缩放百分比（10~400），与 fitToPage 二选一 */
  scale?: number | null
  /** sheetPr/pageSetUpPr@fitToPage：勾了「缩放到 N×M 页」 */
  fitToPage?: boolean
  /** 0 在 OOXML 里是「无限」，原样收（不换算） */
  fitToWidth?: number | null
  fitToHeight?: number | null
  /** downThenOver / overThenDown */
  pageOrder?: string | null
  margins?: PrintMarginsPayload | null
  hCentered?: boolean | null
  vCentered?: boolean | null
  /** 打印网格线（printOptions@gridLines） */
  gridLines?: boolean | null
  /** 打印行列标题（printOptions@headings）：纸上是我们的网格自己画行列号，文件里这一枚管别人打开时 Excel 印不印 */
  headings?: boolean | null
  firstPageNumber?: number | null
  oddEven?: boolean
  firstDiffers?: boolean
  /** headerFooter/@scaleWithDoc：页眉页脚字号随不随文档缩放。**缺省就是开着**（Excel 的默认勾），
   *  所以这里只在"文件里明确关了"时才是 false，其余一律不声明 */
  scaleWithDoc?: boolean | null
  /** headerFooter/@alignWithMargins：页眉页脚按页边距还是按纸张边缘对齐。同样缺省开着 */
  alignWithMargins?: boolean | null
  header?: PrintHfPayload | null
  footer?: PrintHfPayload | null
  printArea?: RangeRect | null
  /** 重复标题行 [起, 止]（0 基含端点） */
  titleRows?: [number, number] | null
  titleCols?: [number, number] | null
  /** 手动分页符：直接收 <brk id> 的值——这些行/列**自己**开始新的一页（0 基）。
   *  实测两处对上：Excel 在 A11 之前插断点写出 id=10；我们写 id=3 时 Excel 报 Location.Row=4（1 基） */
  rowBreaks?: number[]
  colBreaks?: number[]
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
  /** 隐藏列索引（0 基） */
  hiddenCols?: number[]
  /** 隐藏行索引（0 基） */
  hiddenRows?: number[]
  /** 冻结窗格：顶部 rows 行 + 左侧 cols 列 */
  freeze?: { rows: number; cols: number }
  /** 自动筛选（一张表最多一个，同 OOXML） */
  filter?: SheetFilterPayload
  dataValidations?: DataValidationPayload[]
  condFormats?: CondFormatPayload[]
  notes?: CellNotePayload[]
  links?: CellLinkPayload[]
  /** 打印设置：纸张/边距/页眉页脚/分页符/打印区域/重复标题行。Univer 装不下，读回来由侧通道留住 */
  print?: SheetPrintPayload | null
  /** 工作表格式那一层（`sheetFormatPr`）：实测 Excel 不用它排版、但自己存盘会重写，
   *  所以它只走保真往返，不喂界面也不上纸（喂了就是让界面听一个纸面不认的数） */
  sheetFormat?: SheetFormat | null
}

/** `xl/worksheets/sheetN.xml` 的 `<sheetFormatPr @defaultRowHeight @customHeight>`，磅照文件原样收。
 *  与 `DefaultFont` 同一族：Univer 那一枚 `IWorksheetData.defaultRowHeight` 是**活口**（喂进去界面真按它排），
 *  而实测 Excel 16.0 对它只做排版回退（五种变体含 `customHeight="1"` 都报同一个由字体现算的行高），
 *  于是这一层只按侧通道原样存回去，既不进界面也不进纸 */
export interface SheetFormat {
  defaultRowHeight: number
  customHeight?: boolean
}

/** 工作簿默认字体：`xl/styles.xml` 里 `cellXfs[0]@fontId` 指到的那一条 `fonts[n]`。
 *  OOXML 没有"默认字体"这个元素，它就是 Normal 样式那条字体——未设样式的格子与 Excel 的页眉字号都吃它。
 *  Univer 侧没有能接的槽（`IWorkbookData.defaultStyle` 是死槽，core 里零读取；画布对无样式格
 *  回落 engine-render 硬编码的 Arial 11），所以它由侧通道留住，只喂打印那一层 */
export interface DefaultFont {
  /** 字体族名，照文件原样收（这一层不归一化：把"等线"归掉，写侧就会按 crate 的 Calibri 落笔） */
  ff?: string | null
  /** 字号（pt） */
  fs?: number | null
}

export interface WorkbookPayload {
  sheets: SheetPayload[]
  /** 读侧的边界账：格式里认出来但界面/模型装不下的东西，打开时要说得出 */
  warnings?: string[]
  defaultFont?: DefaultFont | null
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

/** 选 PDF 文件（合并入口），multiple 时返回多选 */
export async function pickPdfFiles(multiple: boolean): Promise<string[]> {
  const selected = await open({
    multiple,
    filters: [{ name: 'PDF', extensions: PDF_EXTS }],
  })
  if (Array.isArray(selected)) return selected
  return selected ? [selected] : []
}

/** 选目录（页面拆分输出） */
export async function pickDirectory(): Promise<string | null> {
  const selected = await open({ directory: true })
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

/** 存 xlsx，带回写侧的边界账：摆不进 OOXML 的规则要说得出来，不能静默少给 */
export async function writeXlsx(path: string, workbook: WorkbookPayload): Promise<string[]> {
  return invoke<string[]>('write_xlsx', { path, workbook })
}

/** 存 ods，同样带回写侧的边界账：ODF 装不下的批注与链接（被合并区盖住的那几格）要说得出来 */
export async function writeOds(path: string, workbook: WorkbookPayload): Promise<string[]> {
  return invoke<string[]>('write_ods', { path, workbook })
}

/** 只导出第一个工作表：CSV 没有多表概念，数值/日期按显示文本落盘 */
export async function writeCsv(path: string, workbook: WorkbookPayload): Promise<void> {
  await invoke('write_csv', { path, workbook })
}
