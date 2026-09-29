/**
 * 打开标签的那一刻就把表格的读件请求发出去，别等到编辑器挂载才发。
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
 * 只服务表格这一头：PDF 那一头读字节之后还要按区间补读（>4MB 走分段），先把整叠字节取回来正好
 * 与那条闸门相反；文档/演示的字节读得很快，慢的是随后的解析。
 */
import { readXlsx, type WorkbookPayload } from './fs'

/** Windows 的路径写法不止一种（argv 与文件对话框给的分隔符不同），按「正斜杠 + 忽略大小写」归一 */
function keyOf(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/**
 * 在途的读件请求，取走即失效。
 * 为什么必须一次性：载荷是好几 MB 的对象图，留着就是第二份账——而编辑器只会要它一次。
 */
const inFlight = new Map<string, Promise<WorkbookPayload>>()

/** 外壳开标签时调用：那一刻已经知道路径，就那一刻发 */
export function prefetchWorkbook(path: string): void {
  const k = keyOf(path)
  if (inFlight.has(k)) return
  const p = readXlsx(path)
  // 这一路要有人接住失败：文件被占用、后缀不是表格……都会在这里先 reject，
  // 而真正的读者还在 chunk 求值之后才出现。没人接就是控制台里一枚 unhandled rejection，
  // 接了也不吞——原样的 rejection 留给读者，由它按 v0.64 那一层说人话。
  p.catch(() => {})
  inFlight.set(k, p)
}

/** 编辑器挂载时调用：拿回已经在路上的那一份；没拿到就自己发（不阻塞、不假设外壳一定先跑） */
export function takeWorkbook(path: string): Promise<WorkbookPayload> | null {
  const k = keyOf(path)
  const p = inFlight.get(k) ?? null
  if (p) inFlight.delete(k)
  return p
}

/** 标签被关掉而那份还没人取：把在途的账撤掉，别让一叠没人要的字节挂在图上 */
export function dropWorkbook(path: string | undefined): void {
  if (path) inFlight.delete(keyOf(path))
}
