import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
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
// 滚轮翻页：累计 deltaY 超过阈值才翻一页，翻页后短暂冷却，防高惯性滚动连翻
const WHEEL_PAGE_THRESHOLD = 140
const WHEEL_COOLDOWN_MS = 350

function PdfViewer({ tab }: Props) {
  const [status, setStatus] = useState<string>(tab.path ? '正在加载…' : '未关联文件')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.25)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  docRef.current = doc

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
    let textLayer: TextLayer | null = null
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
        // 文字层盖在 canvas 上：透明字形可选可复制（双击选词/Ctrl+C 走浏览器原生）
        const layerEl = textLayerRef.current
        if (layerEl && !cancelled) {
          layerEl.replaceChildren()
          // pdf.js 给层写的内联尺寸是 var(--scale-factor)*pageW px，变量须由宿主提供（同官方 viewer）
          layerEl.style.setProperty('--scale-factor', String(viewport.scale))
          textLayer = new TextLayer({
            textContentSource: p.streamTextContent(),
            container: layerEl,
            viewport,
          })
          await textLayer.render()
        }
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
      try {
        textLayer?.cancel()
      } catch {
        /* v4 在流未完成时 cancel 可能抛错，容器马上会被重建，忽略 */
      }
    }
  }, [doc, page, scale])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // React 的 onWheel 是 passive 监听，无法 preventDefault，故挂原生监听
    let acc = 0
    let lastTurn = 0
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        setScale((s) => {
          const next = e.deltaY < 0 ? s * 1.1 : s / 1.1
          return Math.min(SCALE_MAX, Math.max(SCALE_MIN, +next.toFixed(3)))
        })
        return
      }
      if (!docRef.current || e.deltaY === 0) return
      const now = performance.now()
      if (now - lastTurn < WHEEL_COOLDOWN_MS) {
        acc = 0
        return
      }
      if (acc > 0 !== e.deltaY > 0) acc = 0
      // 放大后页面在容器内可滚：先让原生滚，触到顶/底再翻（同浏览器 PDF 查看器习惯）
      const scrollable = el.scrollHeight - el.clientHeight > 2
      if (scrollable) {
        const atTop = el.scrollTop <= 0
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
        if (!((e.deltaY > 0 && atBottom) || (e.deltaY < 0 && atTop))) {
          acc = 0
          return
        }
      }
      e.preventDefault()
      acc += e.deltaY
      if (Math.abs(acc) >= WHEEL_PAGE_THRESHOLD) {
        const dir = acc > 0 ? 1 : -1
        acc = 0
        lastTurn = now
        setPage((p) => Math.min(docRef.current?.numPages ?? p, Math.max(1, p + dir)))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 翻页后视图回到页顶
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = 0
  }, [page])

  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>
    w.__oofPdf = {
      page: () => page,
      scale: () => scale,
      numPages: () => doc?.numPages ?? 0,
      scrollEl: () => scrollRef.current,
    }
  }

  const btn = (label: string, onClick: () => void, disabled = false, title?: string) => (
    <button key={label + title} className="tb-btn" onClick={onClick} disabled={disabled} title={title}>
      {label}
    </button>
  )

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <span className="editor-status">{status}</span>
        <span className="editor-hint">PDF 只读 · 滚轮翻页 · 文字可选可复制 · Ctrl+滚轮缩放</span>
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
      <div className="pdf-scroll" ref={scrollRef}>
        <div className="pdf-page">
          <canvas ref={canvasRef} className="pdf-canvas" />
          <div ref={textLayerRef} className="pdf-textlayer" />
        </div>
      </div>
    </div>
  )
}

export default PdfViewer
