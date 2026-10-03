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
