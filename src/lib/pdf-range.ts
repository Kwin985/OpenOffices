//! 大 PDF 分段读取：首屏只喂文件头，正文按 pdf.js 的区间请求从磁盘切片取。
//! 动机：17 MB 的扫描件整本进 JS 堆既慢（读盘+IPC ~200ms）又占内存，而首屏只需要几十 KB。

import { invoke } from '@tauri-apps/api/core'
import { PDFDataRangeTransport } from 'pdfjs-dist'

// 小于这个大小整本读更划算：一次 IPC 完事，省掉后续几十次区间往返
export const RANGE_MIN_BYTES = 4 * 1024 * 1024
// 初始块：够 pdf.js 认出 %PDF 头并起手解析，尾部 xref 由区间请求补齐
const HEAD_BYTES = 64 * 1024

async function readRange(path: string, start: number, len: number): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer | number[]>('read_range', { path, start, len })
  return buf instanceof ArrayBuffer ? new Uint8Array(buf) : Uint8Array.from(buf)
}

/** 文件字节数；拿不到（异常路径/权限）返回 0，调用方按整本读兜底 */
export async function fileSize(path: string): Promise<number> {
  try {
    return await invoke<number>('file_len', { path })
  } catch {
    return 0
  }
}

class TauriRangeTransport extends PDFDataRangeTransport {
  private readonly path: string
  // 同一 begin 理论上可被请求两次（不同 reader），计数而非布尔，避免第二个永远等不到块
  private readonly pending = new Map<number, number>()
  private dead = false

  constructor(path: string, length: number, head: Uint8Array) {
    super(length, head)
    this.path = path
  }

  override requestDataRange(begin: number, end: number): void {
    if (this.dead) return
    this.pending.set(begin, (this.pending.get(begin) ?? 0) + 1)
    void readRange(this.path, begin, end - begin)
      .then((chunk) => {
        const left = this.pending.get(begin) ?? 0
        if (this.dead || left === 0) return
        if (left === 1) this.pending.delete(begin)
        else this.pending.set(begin, left - 1)
        // chunk 的所有权交给 pdf.js（会 transfer 给 worker）
        this.onDataRange(begin, chunk)
      })
      .catch((e) => {
        console.error('PDF 分段读取失败', e)
      })
  }

  override abort(): void {
    this.dead = true
    this.pending.clear()
  }
}

/** 超过阈值的文件返回 range transport，小的返回 null（走原来的整本读） */
export async function createRangeTransport(path: string): Promise<PDFDataRangeTransport | null> {
  const size = await fileSize(path)
  if (size < RANGE_MIN_BYTES) return null
  const head = await readRange(path, 0, Math.min(HEAD_BYTES, size)).catch(() => null)
  if (!head) return null
  return new TauriRangeTransport(path, size, head)
}
