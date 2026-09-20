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
// 全文搜索：命中上限防大文档卡死；输入防抖
const SEARCH_MAX_HITS = 500
const SEARCH_DEBOUNCE_MS = 200

interface PageText {
  items: string[]
  full: string
  starts: number[]
}

interface Match {
  page: number
  bItem: number
  bOff: number
  eItem: number
  eOff: number
}

// 全局偏移 →（文本项下标, 项内偏移）
function locate(t: PageText, pos: number) {
  let i = 0
  while (i < t.items.length - 1 && pos >= t.starts[i] + t.items[i].length) i++
  return { item: i, off: pos - t.starts[i] }
}

function PdfViewer({ tab }: Props) {
  const [status, setStatus] = useState<string>(tab.path ? '正在加载…' : '未关联文件')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.25)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  docRef.current = doc
  const pageRef = useRef(page)
  pageRef.current = page
  const pageTexts = useRef(new Map<number, PageText>())
  const searchSeq = useRef(0)

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
    pageTexts.current.clear()
    setQuery('')
    setMatches([])
    setActiveIdx(-1)
    setSearchOpen(false)
  }, [doc])

  // —— 全文搜索：文本索引按页惰性缓存（getTextContent），命中定位到文字层 span 区间 ——
  const loadPageText = async (d: PDFDocumentProxy, n: number): Promise<PageText> => {
    const hit = pageTexts.current.get(n)
    if (hit) return hit
    const p = await d.getPage(n)
    const tc = await p.getTextContent()
    const items = (tc.items as { str?: string }[]).map((it) => it.str ?? '')
    const starts: number[] = []
    let acc = 0
    for (const s of items) {
      starts.push(acc)
      acc += s.length
    }
    const t: PageText = { items, full: items.join(''), starts }
    pageTexts.current.set(n, t)
    return t
  }

  const runSearch = async (raw: string, seq: number) => {
    const d = docRef.current
    const q = raw.trim().toLowerCase()
    if (!d || !q) {
      setMatches([])
      setActiveIdx(-1)
      return
    }
    const found: Match[] = []
    outer: for (let n = 1; n <= d.numPages; n++) {
      const t = await loadPageText(d, n)
      if (seq !== searchSeq.current) return
      const hay = t.full.toLowerCase()
      let pos = hay.indexOf(q)
      while (pos !== -1) {
        const b = locate(t, pos)
        const e = locate(t, pos + q.length - 1)
        found.push({ page: n, bItem: b.item, bOff: b.off, eItem: e.item, eOff: e.off + q.length })
        if (found.length >= SEARCH_MAX_HITS) break outer
        pos = hay.indexOf(q, pos + q.length)
      }
    }
    if (seq !== searchSeq.current) return
    setMatches(found)
    if (!found.length) {
      setActiveIdx(-1)
      return
    }
    // 从当前页起取第一个命中（循环回绕），并跳过去
    let idx = found.findIndex((m) => m.page >= pageRef.current)
    if (idx === -1) idx = 0
    setActiveIdx(idx)
    if (found[idx].page !== pageRef.current) setPage(found[idx].page)
  }

  // 文字层 span 与文本项按文档序一一对应（含空串项；带 marked-content 包裹时取叶子 span）
  const applyHighlights = () => {
    if (typeof Highlight === 'undefined' || !CSS.highlights) return
    CSS.highlights.delete('pdf-find')
    CSS.highlights.delete('pdf-find-active')
    const layerEl = textLayerRef.current
    const active = activeRef.current
    if (!layerEl || active < 0 || active >= matchesRef.current.length) return
    const spans: HTMLElement[] = []
    const walk = (el: Element) => {
      for (const c of el.children) {
        if (c.childElementCount === 0) spans.push(c as HTMLElement)
        else walk(c)
      }
    }
    walk(layerEl)
    const pageMatches = matchesRef.current
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.page === pageRef.current)
    const ranges: Range[] = []
    let activeRange: Range | null = null
    for (const { m, i } of pageMatches) {
      const s0 = spans[m.bItem]
      const s1 = spans[m.eItem]
      if (!s0 || !s1) continue
      const r = document.createRange()
      try {
        r.setStart(s0.firstChild ?? s0, Math.min(m.bOff, s0.textContent?.length ?? 0))
        r.setEnd(s1.firstChild ?? s1, Math.min(m.eOff, s1.textContent?.length ?? 0))
      } catch {
        continue
      }
      ranges.push(r)
      if (i === active) activeRange = r
    }
    if (ranges.length) CSS.highlights.set('pdf-find', new Highlight(...ranges))
    if (activeRange) {
      CSS.highlights.set('pdf-find-active', new Highlight(activeRange))
      const el = activeRange.startContainer.parentElement
      el?.scrollIntoView({ block: 'center' })
    }
  }
  const applyRef = useRef(applyHighlights)
  applyRef.current = applyHighlights
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  const activeRef = useRef(activeIdx)
  activeRef.current = activeIdx

  const gotoMatch = (delta: number) => {
    const n = matches.length
    if (!n) return
    const idx = (activeIdx + delta + n) % n
    setActiveIdx(idx)
    if (matches[idx].page !== page) setPage(matches[idx].page)
  }

  // 输入防抖触发搜索；seq 竞态守卫，旧结果不覆盖新查询
  useEffect(() => {
    if (!doc) return
    const seq = ++searchSeq.current
    const timer = setTimeout(() => void runSearch(query, seq), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, doc])

  // 同页内切换命中（不触发重渲染文字层）时直接刷高亮
  useEffect(() => {
    applyRef.current()
  }, [activeIdx, matches, searchOpen])

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
          // 翻页/缩放重建后补打搜索高亮
          applyRef.current()
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

  // Ctrl+F 打开搜索、Esc 关闭清空（组件仅在 PDF 标签激活时挂载，不劫持其它编辑器）
  const searchOpenRef = useRef(searchOpen)
  searchOpenRef.current = searchOpen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        searchInputRef.current?.focus()
      } else if (e.key === 'Escape' && searchOpenRef.current) {
        setSearchOpen(false)
        setQuery('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>
    w.__oofPdf = {
      page: () => page,
      scale: () => scale,
      numPages: () => doc?.numPages ?? 0,
      scrollEl: () => scrollRef.current,
      matchCount: () => matches.length,
      activeIdx: () => activeIdx,
      matchPages: () => matches.map((m) => m.page),
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
        <span className="editor-hint">PDF 只读 · 滚轮翻页 · 文字可选可复制 · Ctrl+滚轮缩放 · Ctrl+F 搜索</span>
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
        <span className="tb-sep" />
        {btn('🔍', () => {
          setSearchOpen((v) => !v)
          if (!searchOpen) searchInputRef.current?.focus()
        }, !doc, '搜索 (Ctrl+F)')}
        {searchOpen && (
          <span className="pdf-search">
            <input
              ref={searchInputRef}
              className="tb-input pdf-search-input"
              type="text"
              placeholder="搜索文字…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  gotoMatch(e.shiftKey ? -1 : 1)
                }
              }}
            />
            <span className="pdf-search-count">
              {matches.length ? `${activeIdx + 1}/${matches.length}` : query.trim() ? '无匹配' : ''}
            </span>
            {btn('▲', () => gotoMatch(-1), !matches.length, '上一个匹配 (Shift+Enter)')}
            {btn('▼', () => gotoMatch(1), !matches.length, '下一个匹配 (Enter)')}
            {btn('✕', () => {
              setSearchOpen(false)
              setQuery('')
            }, false, '关闭搜索 (Esc)')}
          </span>
        )}
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
