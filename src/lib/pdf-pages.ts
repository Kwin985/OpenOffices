/**
 * PDF 页面级操作：旋转 / 删除 / 提取 / 合并 / 拆分
 *
 * 全部走 pdf-lib 覆盖写回（与标注写回同一库），做完由调用方重载文档，
 * 内存标注直接从新文件的 /Annots 重新导入，不必自己维护页序映射表。
 */
import { readBytes, writeBytes } from './fs'
import { PDF_OBJECTS_PER_TICK } from './pdf-ticks'

type Doc = import('pdf-lib').PDFDocument
type Lib = typeof import('pdf-lib')

async function loadDoc(path: string): Promise<{ doc: Doc; lib: Lib }> {
  const lib = await import('pdf-lib')
  const bytes = await readBytes(path)
  const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: PDF_OBJECTS_PER_TICK })
  return { doc, lib }
}

async function saveDoc(doc: Doc, path: string) {
  await writeBytes(path, await doc.save({ addDefaultPage: false, objectsPerTick: PDF_OBJECTS_PER_TICK }))
}

/** 1-based 页号 → 0-based 索引 */
const idx = (pages: number[]) => pages.map((p) => p - 1)

/**
 * 页序重排的纯函数（v0.189）：返回「新位置上应该放哪一枚**原页**（0-based）」。
 *
 * 选中页整体朝 delta 方向挪 |delta| 格，非选中页保持相对顺序；选中集合按原页
 * 身份跟随移动，所以连续选区整体平移、不连续选区各自让位。三处边界都不动：
 * 没选页 / delta=0 / 已经在边界（首上移、末下移、全选）。
 * 用冒泡交换而不是切片重排，是为了让「一次只挪一格」的语义可逐格验证。
 */
export function reorderPageOrder(total: number, selected: number[], delta: number): number[] {
  const order = Array.from({ length: total }, (_, i) => i)
  const sel = new Set(idx(selected).filter((i) => i >= 0 && i < total))
  if (!sel.size || !delta || total < 2) return order
  for (let step = 0; step < Math.abs(delta); step++) {
    if (delta < 0) {
      for (let i = 1; i < total; i++) {
        if (sel.has(order[i]) && !sel.has(order[i - 1])) {
          const t = order[i - 1]
          order[i - 1] = order[i]
          order[i] = t
        }
      }
    } else {
      for (let i = total - 2; i >= 0; i--) {
        if (sel.has(order[i]) && !sel.has(order[i + 1])) {
          const t = order[i + 1]
          order[i + 1] = order[i]
          order[i] = t
        }
      }
    }
  }
  return order
}

/** 按 90° 步进旋转指定页（delta 取 ±90） */
export async function rotatePagesInPlace(path: string, pages: number[], delta: number) {
  const { doc, lib } = await loadDoc(path)
  const all = doc.getPages()
  for (const i of idx(pages)) {
    const pg = all[i]
    if (!pg) continue
    const cur = ((pg.getRotation().angle % 360) + 360) % 360
    const next = (((cur + delta) % 360) + 360) % 360
    pg.setRotation(lib.degrees(next))
  }
  await saveDoc(doc, path)
  return pages.length
}

/**
 * 选中页整体上移 / 下移（v0.189）。页序由 `reorderPageOrder` 算，没动就不写盘
 * （避免一次无谓覆盖改掉文件时间戳）。pdf-lib 的 `removePage` 只从 /Pages 树
 * 摘节点，页面对象仍在文档上下文里，按新序 `insertPage` 插回去即可——不复制
 * 页面，标注 / 表单域 / 资源都跟着原对象走。
 */
export async function movePagesInPlace(path: string, pages: number[], delta: number) {
  const { doc } = await loadDoc(path)
  const total = doc.getPageCount()
  const order = reorderPageOrder(total, pages, delta)
  if (order.every((v, i) => v === i)) return { total, moved: 0 }
  const kept = doc.getPages()
  for (let i = total - 1; i >= 0; i--) doc.removePage(i)
  for (let i = 0; i < total; i++) doc.insertPage(i, kept[order[i]])
  await saveDoc(doc, path)
  return { total, moved: idx(pages).filter((i) => i >= 0 && i < total).length }
}

/**
 * 插入空白页 / 复制选中页的落点（v0.196）：选中页整体之后。
 * 参数是 1-based 页号，返回 0-based 插入位置（正好等于选中页里最大的页号）；
 * 越界页号过滤掉，一个都不合法就返回 -1 让调用方整笔不写盘。
 */
export function insertAfterIndex(total: number, selected: number[]): number {
  const valid = selected.filter((p) => Number.isInteger(p) && p >= 1 && p <= total)
  return valid.length ? Math.max(...valid) : -1
}

/**
 * 在选中页之后插入 count 枚空白页，尺寸取第 1 页（同一份文档里页面尺寸通常一致）。
 * 与移动/删除一样只改页树、不复制内容；返回插入后的总页数。
 */
export async function insertBlankPagesInPlace(path: string, pages: number[], count = 1) {
  const { doc } = await loadDoc(path)
  const total = doc.getPageCount()
  const at = insertAfterIndex(total, pages)
  const n = Math.max(0, Math.min(20, Math.floor(count)))
  if (at < 0 || !n) return total
  const { width, height } = doc.getPage(0).getSize()
  for (let i = 0; i < n; i++) doc.insertPage(at + i, [width, height])
  await saveDoc(doc, path)
  return doc.getPageCount()
}

/**
 * 复制选中页到选中页之后（按升序落位、相对顺序不变）。
 * `copyPages` 的源另从同一字节载一份，避免「自拷贝」时源与目标共享可变页树；
 * 标注 / 表单域 / 资源随页对象一起复制。返回复制枚数与新总页数。
 */
export async function duplicatePagesInPlace(path: string, pages: number[]) {
  const { doc, lib } = await loadDoc(path)
  const total = doc.getPageCount()
  const at = insertAfterIndex(total, pages)
  const chosen = idx(pages).filter((i) => i >= 0 && i < total).sort((a, b) => a - b)
  if (at < 0 || !chosen.length) return { total, copied: 0 }
  const src = await lib.PDFDocument.load(await readBytes(path), {
    updateMetadata: false,
    parseSpeed: PDF_OBJECTS_PER_TICK,
  })
  const copied = await doc.copyPages(src, chosen)
  for (let i = 0; i < copied.length; i++) doc.insertPage(at + i, copied[i])
  await saveDoc(doc, path)
  return { total: doc.getPageCount(), copied: copied.length }
}

/** 删除指定页，返回剩余页数；删空时拒写（PDF 至少要有一页） */
export async function removePagesInPlace(path: string, pages: number[]) {
  const { doc } = await loadDoc(path)
  const total = doc.getPageCount()
  const kill = new Set(idx(pages))
  if (kill.size >= total) throw new Error('至少要保留一页')
  // 倒序删：正序删会让后面的索引整体前移而错位
  for (let i = total - 1; i >= 0; i--) if (kill.has(i)) doc.removePage(i)
  await saveDoc(doc, path)
  return total - kill.size
}

/** 把指定页另存为新 PDF（页按升序落位），返回页数 */
export async function extractPages(path: string, outPath: string, pages: number[]) {
  const { doc, lib } = await loadDoc(path)
  const out = await lib.PDFDocument.create()
  const copied = await out.copyPages(doc, idx(pages).sort((a, b) => a - b))
  for (const pg of copied) out.addPage(pg)
  await writeBytes(outPath, await out.save({ objectsPerTick: PDF_OBJECTS_PER_TICK }))
  return copied.length
}

/** 把其他 PDF 的整本页面追加到当前文件末尾，返回合并后页数 */
export async function mergePdfs(path: string, extraPaths: string[]) {
  const { doc } = await loadDoc(path)
  for (const p of extraPaths) {
    if (p === path) throw new Error('不能把文件合并到自己')
    const { doc: src } = await loadDoc(p)
    const copied = await doc.copyPages(src, src.getPageIndices())
    for (const pg of copied) doc.addPage(pg)
  }
  await saveDoc(doc, path)
  return doc.getPageCount()
}

/** 每页单独成文件写到 dir 下，返回写出的文件名列表 */
export async function splitPdf(path: string, dir: string): Promise<string[]> {
  const { doc, lib } = await loadDoc(path)
  const stem = baseOf(path)
  const sep = /[\\/]$/.test(dir) ? '' : dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  const written: string[] = []
  for (let i = 0; i < doc.getPageCount(); i++) {
    const out = await lib.PDFDocument.create()
    const [pg] = await out.copyPages(doc, [i])
    out.addPage(pg)
    const name = `${stem}-${String(i + 1).padStart(3, '0')}.pdf`
    await writeBytes(`${dir}${sep}${name}`, await out.save({ objectsPerTick: PDF_OBJECTS_PER_TICK }))
    written.push(name)
  }
  return written
}

function baseOf(path: string) {
  const seg = path.split(/[\\/]/).pop() ?? 'page'
  return seg.replace(/\.pdf$/i, '') || 'page'
}
