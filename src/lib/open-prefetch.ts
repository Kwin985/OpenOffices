/**
 * 打开标签的那一刻就把首屏要读的那一次请求发出去，别等到编辑器挂载才发。
 *
 * 为什么（v0.67，发布包实测）：双击一件 20000×8 的 xlsx，从起进程到格子画出来 1654ms，其中
 * SheetEditor 那一块的 chunk 取（82ms）＋ 顶层求值（一个 142ms 的长任务）全排在
 * `read_xlsx` 出门**之前**（那次 IPC 的起点是起进程后 855ms）。读文件与 Univer 实例没有依赖关系，
 * 这一段本可以叠起来。
 *
 * 一条实测把话说死：IPC 确实会在主线程正忙的时候照样出门（同一次任务里发出 invoke 后立刻占住主线程
 * 200ms，那次请求在 Resource Timing 里的起点仍是发出那一刻），所以串行不是 WebView2 的脾气，
 * 是我们发得太晚。
 *
 * 服务表格与 PDF 两头，各自的账不同：
 * - 表格省的是排队的大头（那次读要 226ms，整段叠进 chunk 求值里，实测首开 1550 → 1300ms 一档）。
 * - PDF（v0.68 发布包 A/B，三枚夹具各 5 趟，基准=起进程时刻）省的是几十毫秒的窗口：改前那两次读
 *   （`file_len` 2~4ms ＋整本 `read_file` 9~40ms 或首块 `read_range` 3ms）十趟**全部**排在 PdfViewer
 *   的 chunk 备好之后 17~24ms 才出门，改后十趟全部提前到它之前 4~10ms；首画中位数
 *   632→579 / 778→708 / 992→966ms，而读本身没动（10→9 / 40→39 / 3→4ms）⇒ 省的仍是排队。
 *   分段那一头只省 26ms，因为首屏真的只读 64KB；`read_range` 枚数两头都是 92 ⇒ 这条通道不新增读，
 *   只是把已有的那几枚提前。
 *
 * 文档/演示不在这一路：它们的字节读得很快，慢的是随后的解析。
 */
import { readXlsx, type WorkbookPayload } from './fs'
import { preparePdfSource, type PdfSource } from './pdf-range'

/** Windows 的路径写法不止一种（argv 与文件对话框给的分隔符不同），按「正斜杠 + 忽略大小写」归一 */
function keyOf(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/**
 * 在途的一次读，取走即失效。
 * 为什么必须一次性：载荷是几 MB 的字节或对象图，留着就是第二份账——而编辑器只会要它一次。
 * 两条通道（表格 / PDF）各一张表，但三条规矩只写在这一处的 put/take/drop 里。
 */
const workbooks = new Map<string, Promise<WorkbookPayload>>()
const pdfs = new Map<string, Promise<PdfSource>>()

/** 发出去：已有在途就早退，不重复发；失败要有人接住，但不吞 */
function put<T>(slot: Map<string, Promise<T>>, path: string, make: () => Promise<T>): void {
  const k = keyOf(path)
  if (slot.has(k)) return
  const p = make()
  // 这一路要有人接住失败：文件被占用、后缀不是这个格式……都会在这里先 reject，
  // 而真正的读者还在 chunk 求值之后才出现。没人接就是控制台里一枚 unhandled rejection，
  // 接了也不吞——原样的 rejection 留给读者，由它按 v0.64 那一层说人话。
  p.catch(() => {})
  slot.set(k, p)
}

/** 取走：拿回已经在路上的那一份；没有就返回 null，调用方自己发（不假设外壳一定先跑） */
function take<T>(slot: Map<string, Promise<T>>, path: string): Promise<T> | null {
  const k = keyOf(path)
  const p = slot.get(k) ?? null
  if (p) slot.delete(k)
  return p
}

/** 标签被关掉而那一份还没人取：把在途的账撤掉，别让一叠没人要的字节挂在图上 */
function drop<T>(slot: Map<string, Promise<T>>, path: string | undefined): void {
  if (path) slot.delete(keyOf(path))
}

/** 外壳开表格标签时调用：那一刻已经知道路径，就那一刻发 */
export function prefetchWorkbook(path: string): void {
  put(workbooks, path, () => readXlsx(path))
}

/** 编辑器挂载时调用 */
export function takeWorkbook(path: string): Promise<WorkbookPayload> | null {
  return take(workbooks, path)
}

export function dropWorkbook(path: string | undefined): void {
  drop(workbooks, path)
}

/** 外壳开 PDF 标签时调用：预取的是「首屏该怎么读」那次决定，不是整叠字节（见 pdf-range） */
export function prefetchPdf(path: string): void {
  put(pdfs, path, () => preparePdfSource(path))
}

export function takePdf(path: string): Promise<PdfSource> | null {
  return take(pdfs, path)
}

export function dropPdf(path: string | undefined): void {
  drop(pdfs, path)
}
