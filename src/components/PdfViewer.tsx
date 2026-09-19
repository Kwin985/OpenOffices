import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Tab } from '../store'
import { readBytes } from '../lib/fs'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  tab: Tab
}

const SCALE_MIN = 0.5
const SCALE_MAX = 3
const SCALE_STEP = 1.2

function PdfViewer({ tab }: Props) {
  const [status, setStatus] = useState<string>(tab.path ? '正在加载…' : '未关联文件')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.25)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!tab.path) return
    let disposed = false
    let openDoc: PDFDocumentProxy | null = null
    ;(async () => {
      try {
        const bytes = await readBytes(tab.path!)
        const task = pdfjsLib.getDocument({
          data: bytes,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
        })
        const d = await task.promise
        if (disposed) {
          void d.destroy()
          return
        }
        openDoc = d
        setDoc(d)
        setPage(1)
        setStatus('')
      } catch (e) {
        console.error(e)
        if (!disposed) setStatus(`加载失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
    return () => {
      disposed = true
      void openDoc?.destroy().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    let renderTask: RenderTask | null = null
    ;(async () => {
      try {
        const p = await doc.getPage(page)
        if (cancelled) return
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return
        const viewport = p.getViewport({ scale })
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        renderTask = p.render({
          canvasContext: ctx,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        })
        await renderTask.promise
      } catch (e) {
        // 翻页/缩放会主动 cancel 上一任务，不是错误
        const name = e instanceof Error ? e.name : ''
        if (!cancelled && name !== 'RenderingCancelledException' && !(e instanceof DOMException && e.name === 'AbortError')) {
          console.error(e)
          setStatus(`渲染失败: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    })()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [doc, page, scale])

  const btn = (label: string, onClick: () => void, disabled = false, title?: string) => (
    <button key={label + title} className="tb-btn" onClick={onClick} disabled={disabled} title={title}>
      {label}
    </button>
  )

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <span className="editor-status">{status}</span>
        <span className="editor-hint">PDF 为只读查看 · 由 pdf.js 渲染</span>
      </div>
      <div className="pdf-toolbar">
        {btn('◀', () => setPage((p) => Math.max(1, p - 1)), page <= 1, '上一页')}
        <span className="pdf-pageinfo">
          <input
            className="tb-input pdf-page-input"
            type="number"
            min={1}
            max={doc?.numPages ?? 1}
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (doc && n >= 1 && n <= doc.numPages) setPage(n)
            }}
          />
          / {doc?.numPages ?? '-'}
        </span>
        {btn('▶', () => setPage((p) => Math.min(doc?.numPages ?? p, p + 1)), !doc || page >= doc.numPages, '下一页')}
        <span className="tb-sep" />
        {btn('－', () => setScale((s) => Math.max(SCALE_MIN, +(s / SCALE_STEP).toFixed(3))), scale <= SCALE_MIN, '缩小')}
        <span className="pdf-zoom">{Math.round(scale * 100)}%</span>
        {btn('＋', () => setScale((s) => Math.min(SCALE_MAX, +(s * SCALE_STEP).toFixed(3))), scale >= SCALE_MAX, '放大')}
        {btn('100%', () => setScale(1))}
      </div>
      <div className="pdf-scroll">
        <canvas ref={canvasRef} className="pdf-canvas" />
      </div>
    </div>
  )
}

export default PdfViewer
