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
// 全文搜索：命中上限防大文档卡死；输入防抖
const SEARCH_MAX_HITS = 500
const SEARCH_DEBOUNCE_MS = 200
// 视口外预渲染余量：约一屏，滚动方向上的下一页/层提前就绪
const PRERENDER_MARGIN_PX = 800
// 已渲染页位图缓存（LRU）：回视口只 drawImage 免重栅格化；scale/dpr 不一致即视为未命中
const BITMAP_CACHE_MAX = 8

interface PageBitmap {
  canvas: HTMLCanvasElement
  scale: number
  dpr: number
}

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

interface PageSlot {
  cancelled: boolean
  rendering: boolean
  done: boolean
  task: RenderTask | null
  layer: TextLayer | null
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
  const [scale, setScale] = useState(1.25)
  const [sizes, setSizes] = useState<Record<number, { w: number; h: number }>>({})
  const [curPage, setCurPage] = useState(1)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  docRef.current = doc
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  // 视口调度：每页一个槽位记录渲染任务/文字层/取消标记
  const slots = useRef(new Map<number, PageSlot>())
  // 位图缓存按插入序做 LRU（get 命中后 delete+set 提到队尾）
  const bmpCache = useRef(new Map<number, PageBitmap>())
  const putBitmap = (n: number, bmp: PageBitmap) => {
    const c = bmpCache.current
    c.delete(n)
    c.set(n, bmp)
    while (c.size > BITMAP_CACHE_MAX) c.delete(c.keys().next().value as number)
  }
  const renderStats = useRef({ full: 0, hit: 0 })
  const curPageRef = useRef(1)
  curPageRef.current = curPage

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
        slots.current.clear()
        setSizes({})
        setCurPage(1)
        setDoc(d)
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

  // 后台补齐每页尺寸（元数据级 getPage，快）：滚动条长度与占位高度尽早精确。
  // 攒批刷新：逐页 setSizes 会让全页占位随每页重渲染一次，批内合并为一次
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    ;(async () => {
      let batch: Record<number, { w: number; h: number }> = {}
      let pending = 0
      const flush = () => {
        if (!pending) return
        const b = batch
        batch = {}
        pending = 0
        setSizes((s) => {
          const next = { ...s }
          for (const k in b) if (!next[k]) next[k] = b[k]
          return next
        })
      }
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const p = await doc.getPage(n)
        if (cancelled) return
        const v = p.getViewport({ scale: 1 })
        batch[n] = { w: v.width, h: v.height }
        if (++pending >= 8) flush()
      }
      flush()
    })()
    return () => {
      cancelled = true
    }
  }, [doc])

  useEffect(() => {
    slots.current.clear()
    bmpCache.current.clear()
    renderStats.current = { full: 0, hit: 0 }
    setQuery('')
    setMatches([])
    setActiveIdx(-1)
    setSearchOpen(false)
  }, [doc])

  const pageEl = (n: number) =>
    scrollRef.current?.querySelector<HTMLElement>(`[data-page="${n}"]`) ?? null

  // —— 单页渲染：canvas + 文字层（--scale-factor 必须宿主提供，否则层塌 0×0）——
  const renderPage = async (n: number) => {
    const d = docRef.current
    const el = pageEl(n)
    if (!d || !el) return
    let slot = slots.current.get(n)
    if (slot && (slot.rendering || slot.done)) return
    slot = { cancelled: false, rendering: true, done: false, task: null, layer: null }
    slots.current.set(n, slot)
    const me = slot
    try {
      const p = await d.getPage(n)
      if (me.cancelled) return
      const viewport = p.getViewport({ scale: scaleRef.current })
      const canvas = el.querySelector('canvas')
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      const hit = bmpCache.current.get(n)
      if (hit && hit.scale === viewport.scale && hit.dpr === dpr) {
        // 位图命中：回栅格化，直接贴回画布（文字层绑定 DOM，仍需重建）
        bmpCache.current.delete(n)
        bmpCache.current.set(n, hit)
        renderStats.current.hit++
        ctx.drawImage(hit.canvas, 0, 0)
      } else {
        renderStats.current.full++
        me.task = p.render({
          canvasContext: ctx,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        })
        await me.task.promise
        if (me.cancelled) return
        const snap = document.createElement('canvas')
        snap.width = canvas.width
        snap.height = canvas.height
        snap.getContext('2d')?.drawImage(canvas, 0, 0)
        putBitmap(n, { canvas: snap, scale: viewport.scale, dpr })
      }
      const layerEl = el.querySelector<HTMLElement>('.pdf-textlayer')
      if (layerEl) {
        layerEl.replaceChildren()
        layerEl.style.setProperty('--scale-factor', String(viewport.scale))
        me.layer = new TextLayer({
          textContentSource: p.streamTextContent(),
          container: layerEl,
          viewport,
        })
        await me.layer.render()
      }
      me.done = true
      applyRef.current()
    } catch (e) {
      const name = e instanceof Error ? e.name : ''
      if (!me.cancelled && name !== 'RenderingCancelledException' && !(e instanceof DOMException && e.name === 'AbortError')) {
        console.error(e)
        setStatus(`渲染失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    } finally {
      me.rendering = false
      me.task = null
    }
  }

  // 远处页释放：取消任务与文字层、清画布，槽位移除，回视即重渲染
  const freePage = (n: number) => {
    const slot = slots.current.get(n)
    if (!slot) return
    slot.cancelled = true
    slot.task?.cancel()
    try {
      slot.layer?.cancel()
    } catch {
      /* 流未完成时 cancel 可能抛错，容器马上会被清空，忽略 */
    }
    slot.layer = null
    slots.current.delete(n)
    const el = pageEl(n)
    const canvas = el?.querySelector('canvas')
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
      canvas.style.width = '0px'
      canvas.style.height = '0px'
    }
    el?.querySelector('.pdf-textlayer')?.replaceChildren()
  }

  // —— 视口调度：进入（含预渲染余量）即渲染，离开即释放 ——
  useEffect(() => {
    if (!doc || !scrollRef.current) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page)
          if (!n) continue
          if (e.isIntersecting) void renderPage(n)
          else freePage(n)
        }
      },
      { root: scrollRef.current, rootMargin: `${PRERENDER_MARGIN_PX}px 0px` },
    )
    scrollRef.current.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => io.observe(el))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  // 缩放变化：占位尺寸由 style 重算；可见页释放后按新 scale 重画（done 槽位不重入，需先 free）
  useEffect(() => {
    if (!doc || !scrollRef.current) return
    const sr = scrollRef.current.getBoundingClientRect()
    const visible = [...scrollRef.current.querySelectorAll<HTMLElement>('[data-page]')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.bottom > sr.top - PRERENDER_MARGIN_PX && r.top < sr.bottom + PRERENDER_MARGIN_PX
      })
      .map((el) => Number(el.dataset.page))
    visible.forEach((n) => freePage(n))
    queueMicrotask(() => visible.forEach((n) => void renderPage(n)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, doc])

  // 当前页展示：顶边进入视口的最后一页
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !doc) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top + 2
        let cur = 1
        for (const p of el.querySelectorAll<HTMLElement>('[data-page]')) {
          if (p.getBoundingClientRect().top <= top) cur = Number(p.dataset.page)
          else break
        }
        setCurPage(cur)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
    }
  }, [doc])

  // —— 全文搜索：文本索引按页惰性缓存，命中定位到页内文字层 span 区间 ——
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
  const pageTexts = useRef(new Map<number, PageText>())
  const searchSeq = useRef(0)

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
    let idx = found.findIndex((m) => m.page >= curPageRef.current)
    if (idx === -1) idx = 0
    scrollToMatch(found, idx)
  }

  const gotoMatch = (delta: number) => {
    const n = matches.length
    if (!n) return
    scrollToMatch(matches, (activeIdx + delta + n) % n)
  }

  // 激活命中：改状态 + 滚到目标页；页文字层渲染完后 applyRef 补挂并居中
  const scrollToMatch = (list: Match[], idx: number) => {
    const m = list[idx]
    setActiveIdx(idx)
    pendingFocus.current = idx
    const el = pageEl(m.page)
    if (el) el.scrollIntoView({ block: 'start' })
    else void renderPage(m.page)
  }
  const pendingFocus = useRef(-1)

  // 命中项↔span 映射：文字层每文本项一个叶子 span（marked-content 包裹时取文档序叶子）
  const applyHighlights = () => {
    if (typeof Highlight === 'undefined' || !CSS.highlights) return
    CSS.highlights.delete('pdf-find')
    CSS.highlights.delete('pdf-find-active')
    const ms = matchesRef.current
    const act = activeRef.current
    if (!ms.length) return
    // 每页叶子 span 只走一遍（同页多命中复用）
    const spanCache = new Map<number, HTMLElement[]>()
    const spansFor = (n: number): HTMLElement[] => {
      let sp = spanCache.get(n)
      if (sp) return sp
      sp = []
      const layerEl = pageEl(n)?.querySelector<HTMLElement>('.pdf-textlayer')
      const walk = (el: Element) => {
        for (const c of el.children) {
          if (c.childElementCount === 0) sp!.push(c as HTMLElement)
          else walk(c)
        }
      }
      if (layerEl) walk(layerEl)
      spanCache.set(n, sp)
      return sp
    }
    const ranges: Range[] = []
    let activeRange: Range | null = null
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]
      if (!slots.current.has(m.page)) continue
      const spans = spansFor(m.page)
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
      if (i === act) activeRange = r
    }
    if (ranges.length) CSS.highlights.set('pdf-find', new Highlight(...ranges))
    if (activeRange) {
      CSS.highlights.set('pdf-find-active', new Highlight(activeRange))
      if (pendingFocus.current === act) {
        pendingFocus.current = -1
        activeRange.startContainer.parentElement?.scrollIntoView({ block: 'center' })
      }
    }
  }
  const applyRef = useRef(applyHighlights)
  applyRef.current = applyHighlights
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  const activeRef = useRef(activeIdx)
  activeRef.current = activeIdx

  useEffect(() => {
    if (!doc) return
    const seq = ++searchSeq.current
    const timer = setTimeout(() => void runSearch(query, seq), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, doc])

  useEffect(() => {
    applyRef.current()
  }, [activeIdx, matches, searchOpen])

  // Ctrl+滚轮缩放（React onWheel 是 passive 不能 preventDefault，挂原生非被动监听）；
  // 多页连续滚动下普通滚轮交还原生行为，不再劫持翻页
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setScale((s) => {
        const next = e.deltaY < 0 ? s * 1.1 : s / 1.1
        return Math.min(SCALE_MAX, Math.max(SCALE_MIN, +next.toFixed(3)))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

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
      page: () => curPage,
      scale: () => scale,
      numPages: () => doc?.numPages ?? 0,
      scrollEl: () => scrollRef.current,
      matchCount: () => matches.length,
      activeIdx: () => activeIdx,
      matchPages: () => matches.map((m) => m.page),
      renderedPages: () => [...slots.current.keys()].sort((a, b) => a - b),
      perf: () => ({ ...renderStats.current, cached: [...bmpCache.current.keys()] }),
    }
  }

  const btn = (label: string, onClick: () => void, disabled = false, title?: string) => (
    <button key={label + title} className="tb-btn" onClick={onClick} disabled={disabled} title={title}>
      {label}
    </button>
  )

  const gotoPage = (n: number) => {
    const el = pageEl(n)
    el?.scrollIntoView({ block: 'start' })
  }

  const est = sizes[1] ?? { w: 595, h: 842 }
  const numPages = doc?.numPages ?? 0

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <span className="editor-status">{status}</span>
        <span className="editor-hint">PDF 只读 · 连续滚动 · 文字可选可复制 · Ctrl+滚轮缩放 · Ctrl+F 搜索</span>
      </div>
      <div className="pdf-toolbar">
        {btn('◀', () => gotoPage(Math.max(1, curPage - 1)), curPage <= 1, '上一页')}
        <span className="pdf-pageinfo">
          <input
            className="tb-input pdf-page-input"
            type="number"
            min={1}
            max={numPages || 1}
            value={curPage}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (doc && n >= 1 && n <= doc.numPages) gotoPage(n)
            }}
          />
          / {numPages || '-'}
        </span>
        {btn('▶', () => gotoPage(Math.min(numPages, curPage + 1)), !doc || curPage >= numPages, '下一页')}
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
        {doc &&
          Array.from({ length: numPages }, (_, i) => i + 1).map((n) => {
            const sz = sizes[n] ?? est
            return (
              <div
                key={n}
                data-page={n}
                className="pdf-page"
                style={{ width: Math.floor(sz.w * scale), height: Math.floor(sz.h * scale) }}
              >
                <canvas className="pdf-canvas" />
                <div className="pdf-textlayer" />
              </div>
            )
          })}
      </div>
    </div>
  )
}

export default PdfViewer
