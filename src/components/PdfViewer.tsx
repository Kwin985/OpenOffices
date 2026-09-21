import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Tab } from '../store'
import { useApp } from '../store'
import { readBytes, writeBytes } from '../lib/fs'
import { registerSaver } from '../lib/registry'

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
// 侧栏缩略图固定宽度（CSS px）：与主视图缩放无关
const THUMB_W = 120
// 大纲条目上限：恶意/异常深文档防御
const OUTLINE_MAX = 1000

interface OutlineEntry {
  title: string
  page: number | null
  depth: number
}

interface ThumbSlot {
  rendering: boolean
  done: boolean
  task: RenderTask | null
}

// —— 标注：矩形以 PDF 点为单位、左上原点（渲染 ×scale，写回时翻转 y）——
const ANNO_COLORS = ['#fde047', '#86efac', '#93c5fd', '#fca5a5']

interface AnnoRect {
  x: number
  y: number
  w: number
  h: number
}

interface PdfAnno {
  id: string
  kind: 'highlight' | 'note'
  page: number
  rects: AnnoRect[]
  color: string
  text?: string
  content?: string
}

interface AnnoPop {
  x: number
  y: number
  page: number
  rects: AnnoRect[]
  text: string
  mode: 'menu' | 'note'
  content: string
}

let annoSeq = 0
const nid = () => `an${++annoSeq}`

// pdf.js 注解颜色 [0-255×3] → #rrggbb
function rgbHex(c: number[] | Uint8Array | undefined): string {
  if (!c || c.length < 3) return ANNO_COLORS[0]
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`
}

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
  const [sideOpen, setSideOpen] = useState(false)
  const [sideTab, setSideTab] = useState<'thumbs' | 'outline' | 'annos'>('thumbs')
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  const [annos, setAnnos] = useState<PdfAnno[]>([])
  const [pop, setPop] = useState<AnnoPop | null>(null)
  const [noteOpen, setNoteOpen] = useState('')
  const [tool, setTool] = useState<'text' | 'anno'>('text')
  const [selAnno, setSelAnno] = useState<string | null>(null)
  const annosRef = useRef(annos)
  annosRef.current = annos
  const toolRef = useRef(tool)
  toolRef.current = tool
  const selRef = useRef(selAnno)
  selRef.current = selAnno
  // 拖移中的注解：起点屏幕坐标 + 原始矩形（增量换算 px→PDF pt）
  const dragRef = useRef<null | { id: string; sx: number; sy: number; orig: AnnoRect[]; moved: boolean }>(null)
  const suppressClick = useRef('')
  const markDirty = useApp((s) => s.markDirty)
  const scrollRef = useRef<HTMLDivElement>(null)
  const thumbsRef = useRef<HTMLDivElement>(null)
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
  // 缩略图槽位：独立于主视图调度，侧栏收起/切走时整体清空重挂
  const thumbSlots = useRef(new Map<number, ThumbSlot>())
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
    thumbSlots.current.clear()
    setQuery('')
    setMatches([])
    setActiveIdx(-1)
    setSearchOpen(false)
    setOutline([])
    setSideTab('thumbs')
    setAnnos([])
    setPop(null)
    setNoteOpen('')
    setTool('text')
    setSelAnno(null)
  }, [doc])

  // 大纲：pdfjs getOutline 树递归拍平；目标页经 getDestination/getPageIndex 解析
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    ;(async () => {
      try {
        const raw = await doc.getOutline()
        const flat: OutlineEntry[] = []
        const resolvePage = async (dest: unknown): Promise<number | null> => {
          try {
            const target = typeof dest === 'string' ? await doc.getDestination(dest) : dest
            if (!Array.isArray(target) || !target[0]) return null
            const idx = await doc.getPageIndex(target[0] as Parameters<PDFDocumentProxy['getPageIndex']>[0])
            return idx + 1
          } catch {
            return null
          }
        }
        const walk = async (items: { title?: string; dest?: unknown; items?: unknown[] }[], depth: number) => {
          for (const it of items) {
            if (cancelled || flat.length >= OUTLINE_MAX) return
            const page = await resolvePage(it.dest)
            flat.push({ title: it.title ?? '(未命名)', page, depth })
            if (Array.isArray(it.items)) await walk(it.items as typeof items, depth + 1)
          }
        }
        await walk(raw ?? [], 0)
        if (!cancelled) setOutline(flat)
      } catch (e) {
        console.error(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc])

  // —— 标注读侧：导入既有 Highlight/Text 注解（PDF 左下原点 rect → 左上原点存储）——
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    ;(async () => {
      const out: PdfAnno[] = []
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const p = await doc.getPage(n)
        if (cancelled) return
        const ph = p.getViewport({ scale: 1 }).height
        const list = (await p.getAnnotations({ intent: 'display' })) as {
          subtype?: string
          rect?: number[]
          color?: number[]
          contentsObj?: { str?: string }
        }[]
        for (const a of list) {
          if (!Array.isArray(a.rect) || a.rect.length < 4) continue
          const [x1, y1, x2, y2] = a.rect
          const r = { x: x1, y: ph - y2, w: x2 - x1, h: y2 - y1 }
          const txt = a.contentsObj?.str ?? ''
          if (a.subtype === 'Highlight') {
            out.push({ id: nid(), kind: 'highlight', page: n, rects: [r], color: rgbHex(a.color), text: txt })
          } else if (a.subtype === 'Text') {
            out.push({ id: nid(), kind: 'note', page: n, rects: [r], color: rgbHex(a.color), content: txt })
          }
        }
      }
      if (!cancelled) setAnnos(out)
    })()
    return () => {
      cancelled = true
    }
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
        // annotationMode 0：pdf.js 不画标注，显示完全交给自绘覆盖层（避免双绘+保缓存语义）
        me.task = p.render({
          canvasContext: ctx,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
          annotationMode: 0,
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

  // —— 缩略图：固定小宽独立渲染，进视口即画、离开即释放（量小不上位图缓存）——
  const thumbEl = (n: number) =>
    thumbsRef.current?.querySelector<HTMLElement>(`[data-thumb="${n}"]`) ?? null

  const renderThumb = async (n: number) => {
    const d = docRef.current
    const el = thumbEl(n)
    if (!d || !el) return
    let slot = thumbSlots.current.get(n)
    if (slot && (slot.rendering || slot.done)) return
    slot = { rendering: true, done: false, task: null }
    thumbSlots.current.set(n, slot)
    const me = slot
    try {
      const p = await d.getPage(n)
      if (thumbSlots.current.get(n) !== me) return
      const viewport = p.getViewport({ scale: THUMB_W / p.getViewport({ scale: 1 }).width })
      const canvas = el.querySelector('canvas')
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      me.task = p.render({
        canvasContext: ctx,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      })
      await me.task.promise
      if (thumbSlots.current.get(n) !== me) return
      me.done = true
      me.task = null
    } catch (e) {
      const name = e instanceof Error ? e.name : ''
      if (name !== 'RenderingCancelledException' && !(e instanceof DOMException && e.name === 'AbortError')) {
        console.error(e)
      }
      if (thumbSlots.current.get(n) === me) thumbSlots.current.delete(n)
    } finally {
      me.rendering = false
    }
  }

  const freeThumb = (n: number) => {
    const slot = thumbSlots.current.get(n)
    if (!slot) return
    slot.task?.cancel()
    thumbSlots.current.delete(n)
    const el = thumbEl(n)
    const canvas = el?.querySelector('canvas')
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }

  // 侧栏可见性/页签切换：缩略图 DOM 随之挂载或移除，观察器整体重建
  useEffect(() => {
    if (!doc || !sideOpen || sideTab !== 'thumbs' || !thumbsRef.current) return
    thumbSlots.current.clear()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.thumb)
          if (!n) continue
          if (e.isIntersecting) void renderThumb(n)
          else freeThumb(n)
        }
      },
      { root: thumbsRef.current, rootMargin: '400px 0px' },
    )
    thumbsRef.current.querySelectorAll<HTMLElement>('[data-thumb]').forEach((el) => io.observe(el))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, sideOpen, sideTab, doc?.numPages])

  // 当前页缩略图跟随视口（active 样式由渲染侧 className 给出）
  useEffect(() => {
    if (!sideOpen || sideTab !== 'thumbs') return
    thumbEl(curPage)?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curPage, sideOpen, sideTab, doc])

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
      } else if (e.key === 'Escape' && selRef.current) {
        setSelAnno(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // —— 标注重叠层：固定于页内，PDF pt × scale 换算，缩放天然跟随 ——

  // 选区 → 弹层：仅支持单页选区；行矩形按 rect.top 聚并
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onUp = () => {
      if (toolRef.current !== 'text') return
      setTimeout(() => {
        const sel = document.getSelection()
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
          return
        }
        const range = sel.getRangeAt(0)
        const sp = (range.startContainer.parentElement ?? (range.startContainer as Element))?.closest?.('[data-page]')
        const ep = (range.endContainer.parentElement ?? (range.endContainer as Element))?.closest?.('[data-page]')
        if (!sp || sp !== ep) {
          setPop(null)
          return
        }
        const pe = sp as HTMLElement
        const n = Number(pe.dataset.page)
        const pr = pe.getBoundingClientRect()
        const sc = scaleRef.current
        const lines = new Map<number, { l: number; r: number; t: number; b: number }>()
        for (const r of Array.from(range.getClientRects())) {
          if (r.width < 0.5 || r.height < 0.5) continue
          const key = Math.round(r.top)
          const g = lines.get(key)
          if (g) {
            g.l = Math.min(g.l, r.left)
            g.r = Math.max(g.r, r.right)
          } else {
            lines.set(key, { l: r.left, r: r.right, t: r.top, b: r.bottom })
          }
        }
        const gs = [...lines.values()].sort((a, b) => a.t - b.t)
        if (!gs.length) return
        const rects: AnnoRect[] = gs.map((g) => ({
          x: (g.l - pr.left) / sc,
          y: (g.t - pr.top) / sc,
          w: (g.r - g.l) / sc,
          h: (g.b - g.t) / sc,
        }))
        setPop({ x: gs[0].l, y: gs[0].t, page: n, rects, text: sel.toString().trim().slice(0, 160), mode: 'menu', content: '' })
      }, 0)
    }
    const onHide = () => setPop(null)
    el.addEventListener('mouseup', onUp)
    el.addEventListener('scroll', onHide, { passive: true })
    return () => {
      el.removeEventListener('mouseup', onUp)
      el.removeEventListener('scroll', onHide)
    }
  }, [])

  const addHighlight = (color: string) => {
    if (!pop) return
    setAnnos((a) => [...a, { id: nid(), kind: 'highlight', page: pop.page, rects: pop.rects, color, text: pop.text }])
    markDirty(tab.id, true)
    document.getSelection()?.removeAllRanges()
    setPop(null)
  }

  const addNote = () => {
    if (!pop || !pop.content.trim()) {
      setPop(null)
      return
    }
    const last = pop.rects[pop.rects.length - 1]
    const r = { x: last.x + last.w + 2, y: last.y, w: 16, h: 16 }
    setAnnos((a) => [
      ...a,
      { id: nid(), kind: 'note', page: pop.page, rects: [r], color: ANNO_COLORS[0], text: pop.text, content: pop.content.trim() },
    ])
    markDirty(tab.id, true)
    document.getSelection()?.removeAllRanges()
    setPop(null)
  }

  const removeAnno = (id: string) => {
    setAnnos((a) => a.filter((x) => x.id !== id))
    markDirty(tab.id, true)
    setNoteOpen('')
    if (selRef.current === id) setSelAnno(null)
  }

  const updateNote = (id: string, content: string) => {
    setAnnos((a) => a.map((x) => (x.id === id ? { ...x, content } : x)))
    markDirty(tab.id, true)
  }

  const recolorAnno = (id: string, color: string) => {
    setAnnos((a) => a.map((x) => (x.id === id ? { ...x, color } : x)))
    markDirty(tab.id, true)
  }

  // 标注工具：pointerdown 即选中并预备拖移；位移超阈值才算拖（否则视作点击）
  const startAnnoDrag = (e: React.PointerEvent, id: string) => {
    if (tool !== 'anno' || e.button !== 0) return
    const a = annos.find((x) => x.id === id)
    if (!a) return
    e.stopPropagation()
    setSelAnno(id)
    setPop(null)
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, orig: a.rects.map((r) => ({ ...r })), moved: false }
  }

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.sx
      const dy = e.clientY - d.sy
      if (!d.moved && Math.hypot(dx, dy) < 3) return
      d.moved = true
      const sc = scaleRef.current
      setAnnos((list) =>
        list.map((a) =>
          a.id === d.id
            ? {
                ...a,
                rects: d.orig.map((r) => ({ ...r, x: +(r.x + dx / sc).toFixed(2), y: +(r.y + dy / sc).toFixed(2) })),
              }
            : a,
        ),
      )
      markDirty(tab.id, true)
    }
    const onUp = () => {
      const d = dragRef.current
      if (!d) return
      if (d.moved) suppressClick.current = d.id
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Delete/Backspace 删除选中注解（输入框内除外）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const id = selRef.current
      if (!id) return
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
      e.preventDefault()
      removeAnno(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // —— 标注写回：pdf-lib 删旧 Highlight/Text（留链接等）→ 按模型重加 → 覆盖原文件 ——
  useEffect(() => {
    if (!tab.path) return
    const path = tab.path
    return registerSaver(tab.id, async () => {
      const list = annosRef.current
      // pdf-lib 1.17 无高层标注 API：用 context 手建 /Annot 字典（Highlight/Text 标准注解，其他阅读器可见）
      const { PDFDocument, PDFName, PDFDict, PDFHexString } = await import('pdf-lib')
      const bytes = await readBytes(path)
      const pdoc = await PDFDocument.load(bytes, { updateMetadata: false })
      const pages = pdoc.getPages()
      for (const pg of pages) {
        const arr = pg.node.Annots()
        if (!arr) continue
        for (let i = arr.size() - 1; i >= 0; i--) {
          const obj = pdoc.context.lookup(arr.get(i))
          if (!(obj instanceof PDFDict)) continue
          const st = obj.get(PDFName.of('Subtype'))
          if (st === PDFName.of('Highlight') || st === PDFName.of('Text')) arr.remove(i)
        }
      }
      const colorArr = (h: string) => [
        parseInt(h.slice(1, 3), 16) / 255,
        parseInt(h.slice(3, 5), 16) / 255,
        parseInt(h.slice(5, 7), 16) / 255,
      ]
      for (const a of list) {
        const pg = pages[a.page - 1]
        if (!pg) continue
        const { height } = pg.getSize()
        let arr = pg.node.Annots()
        if (!arr) {
          arr = pdoc.context.obj([])
          pg.node.set(PDFName.of('Annots'), arr)
        }
        if (a.kind === 'highlight') {
          const x0 = Math.min(...a.rects.map((r) => r.x))
          const y0 = Math.min(...a.rects.map((r) => r.y))
          const x1 = Math.max(...a.rects.map((r) => r.x + r.w))
          const y1 = Math.max(...a.rects.map((r) => r.y + r.h))
          const quads: number[] = []
          for (const r of a.rects) {
            const yt = height - r.y
            const yb = height - r.y - r.h
            quads.push(r.x, yt, r.x + r.w, yt, r.x, yb, r.x + r.w, yb)
          }
          arr.push(
            pdoc.context.register(
              pdoc.context.obj({
                Type: PDFName.of('Annot'),
                Subtype: PDFName.of('Highlight'),
                Rect: [x0, height - y1, x1 - x0, y1 - y0],
                QuadPoints: quads,
                C: colorArr(a.color),
                Contents: PDFHexString.fromText(a.text || ' '),
              }),
            ),
          )
        } else {
          const r0 = a.rects[0]
          const yb = height - r0.y - r0.h
          arr.push(
            pdoc.context.register(
              pdoc.context.obj({
                Type: PDFName.of('Annot'),
                Subtype: PDFName.of('Text'),
                Rect: [r0.x, yb, r0.x + r0.w, yb + r0.h],
                C: colorArr(a.color),
                Name: PDFName.of('Comment'),
                Contents: PDFHexString.fromText(a.content || ' '),
              }),
            ),
          )
        }
      }
      const out = await pdoc.save({ addDefaultPage: false })
      await writeBytes(path, out)
      markDirty(tab.id, false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.path])

  const selA = selAnno ? (annos.find((a) => a.id === selAnno) ?? null) : null

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
      annos: () =>
        annos.map((a) => ({
          kind: a.kind,
          page: a.page,
          color: a.color,
          rects: a.rects.length,
          content: (a.content ?? a.text ?? '').slice(0, 60),
        })),
      pop: () => (pop ? { mode: pop.mode, page: pop.page, rects: pop.rects.length } : null),
      tool: () => tool,
      sel: () =>
        selA
          ? { id: selA.id, kind: selA.kind, color: selA.color, page: selA.page, x: +selA.rects[0].x.toFixed(1), y: +selA.rects[0].y.toFixed(1) }
          : null,
      sideInfo: () => ({
        open: sideOpen,
        tab: sideTab,
        outline: outline.length,
        outlinePages: outline.map((o) => o.page),
        thumbs: [...thumbSlots.current.keys()].sort((a, b) => a - b),
      }),
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
        <span className="editor-hint">PDF · 选文字加高亮/便签（Ctrl+S 存回文件） · ✎ 标注工具：点选/拖移/改色/删除 · Ctrl+滚轮缩放 · Ctrl+F 搜索 · ☰ 侧栏</span>
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
        <span className="pdf-tools">
          <button
            className={`pdf-tool${tool === 'text' ? ' on' : ''}`}
            title="文字选择工具"
            onClick={() => {
              setTool('text')
              setSelAnno(null)
            }}
          >
            T
          </button>
          <button
            className={`pdf-tool${tool === 'anno' ? ' on' : ''}`}
            title="标注编辑工具（点选/拖移/改色/删除）"
            onClick={() => setTool('anno')}
          >
            ✎
          </button>
        </span>
        <span className="tb-sep" />
        {btn('🔍', () => {
          setSearchOpen((v) => !v)
          if (!searchOpen) searchInputRef.current?.focus()
        }, !doc, '搜索 (Ctrl+F)')}
        {btn('☰', () => setSideOpen((v) => !v), !doc, '侧栏 (缩略图/大纲/标注)')}
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
      <div className="pdf-body">
        {sideOpen && (
          <div className="pdf-sidebar">
            <div className="pdf-side-tabs">
              <button
                className={`side-tab${sideTab === 'thumbs' ? ' on' : ''}`}
                onClick={() => setSideTab('thumbs')}
              >
                缩略图
              </button>
              <button
                className={`side-tab${sideTab === 'outline' ? ' on' : ''}`}
                onClick={() => setSideTab('outline')}
              >
                大纲
              </button>
              <button
                className={`side-tab${sideTab === 'annos' ? ' on' : ''}`}
                onClick={() => setSideTab('annos')}
              >
                标注{annos.length ? ` ${annos.length}` : ''}
              </button>
            </div>
            {sideTab === 'thumbs' ? (
              <div className="pdf-thumbs" ref={thumbsRef}>
                {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => {
                  const sz = sizes[n] ?? est
                  return (
                    <div
                      key={n}
                      data-thumb={n}
                      className={`pdf-thumb${n === curPage ? ' active' : ''}`}
                      style={{ height: Math.floor((THUMB_W * sz.h) / sz.w) }}
                      onClick={() => gotoPage(n)}
                    >
                      <canvas />
                      <span className="pdf-thumb-no">{n}</span>
                    </div>
                  )
                })}
              </div>
            ) : sideTab === 'annos' ? (
              annos.length ? (
                <div className="pdf-annos">
                  {annos.map((a) => (
                    <div key={a.id} className={`pdf-anno-item${selAnno === a.id ? ' sel' : ''}`}>
                      <span className="pdf-anno-dot" style={{ background: a.color }} />
                      <button
                        className="pdf-anno-jump"
                        title={a.kind === 'note' ? a.content ?? '' : a.text ?? ''}
                        onClick={() => {
                          setTool('anno')
                          setSelAnno(a.id)
                          gotoPage(a.page)
                        }}
                      >
                        <span className="pdf-anno-page">P{a.page}</span>
                        <span className="pdf-anno-sum">{a.kind === 'note' ? a.content : a.text || '(高亮)'}</span>
                      </button>
                      <button className="pdf-anno-del" title="删除标注" onClick={() => removeAnno(a.id)}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pdf-outline-empty">选中文字后可加高亮或便签</div>
              )
            ) : outline.length ? (
              <div className="pdf-outline">
                {outline.map((o, i) => (
                  <button
                    key={i}
                    className={`pdf-outline-item${o.page === curPage ? ' active' : ''}`}
                    style={{ paddingLeft: 8 + o.depth * 14 }}
                    disabled={o.page === null}
                    title={o.page === null ? '无跳转目标' : `第 ${o.page} 页`}
                    onClick={() => {
                      if (o.page !== null) gotoPage(o.page)
                    }}
                  >
                    {o.title}
                  </button>
                ))}
              </div>
            ) : (
              <div className="pdf-outline-empty">此 PDF 无大纲</div>
            )}
          </div>
        )}
        <div
          className="pdf-scroll"
          ref={scrollRef}
          onClick={(e) => {
            if (tool !== 'anno') return
            const t = e.target as HTMLElement
            if (!t.closest('[data-anno]') && !t.closest('.pdf-anno-edit')) setSelAnno(null)
          }}
        >
          {doc &&
            Array.from({ length: numPages }, (_, i) => i + 1).map((n) => {
              const sz = sizes[n] ?? est
              const pageAnnos = annos.filter((a) => a.page === n)
              return (
                <div
                  key={n}
                  data-page={n}
                  className={`pdf-page${tool === 'anno' ? ' anno-mode' : ''}`}
                  style={{ width: Math.floor(sz.w * scale), height: Math.floor(sz.h * scale) }}
                >
                  <canvas className="pdf-canvas" />
                  <div className="pdf-textlayer" />
                  {pageAnnos.map((a) =>
                    a.kind === 'highlight' ? (
                      a.rects.map((r, i) => (
                        <div
                          key={a.id + '-' + i}
                          className={`pdf-anno-hl${selAnno === a.id ? ' sel' : ''}`}
                          data-anno={a.id}
                          onPointerDown={(e) => startAnnoDrag(e, a.id)}
                          style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale, background: a.color }}
                        />
                      ))
                    ) : (
                      <div
                        key={a.id}
                        data-anno={a.id}
                        className={`pdf-anno-note${selAnno === a.id ? ' sel' : ''}`}
                        style={{ left: a.rects[0].x * scale, top: a.rects[0].y * scale }}
                        title={a.content}
                        onPointerDown={(e) => startAnnoDrag(e, a.id)}
                        onClick={() => {
                          if (suppressClick.current === a.id) {
                            suppressClick.current = ''
                            return
                          }
                          if (tool === 'anno') setSelAnno(a.id)
                          else setNoteOpen(noteOpen === a.id ? '' : a.id)
                        }}
                      >
                        🗒
                        {noteOpen === a.id && (
                          <div className="pdf-note-pop" onMouseDown={(e) => e.stopPropagation()}>
                            <textarea
                              className="pdf-note-ta"
                              value={a.content ?? ''}
                              placeholder="便签内容…"
                              onChange={(e) => updateNote(a.id, e.target.value)}
                            />
                            <div className="pdf-note-acts">
                              {btn('删除', () => removeAnno(a.id))}
                              {btn('完成', () => setNoteOpen(''))}
                            </div>
                          </div>
                        )}
                      </div>
                    ),
                  )}
                  {tool === 'anno' && selA && selA.page === n && (
                    <div
                      className="pdf-anno-pop pdf-anno-edit"
                      style={{
                        left: (selA.rects[selA.rects.length - 1].x + selA.rects[selA.rects.length - 1].w / 2) * scale,
                        top: Math.max(4, selA.rects[0].y * scale - 44),
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {ANNO_COLORS.map((c) => (
                        <button
                          key={c}
                          className={`pdf-anno-swatch${c === selA.color ? ' on' : ''}`}
                          style={{ background: c }}
                          title="改为该颜色"
                          onClick={() => recolorAnno(selA.id, c)}
                        />
                      ))}
                      {selA.kind === 'note' && (
                        <button
                          className="tb-btn"
                          title="查看/编辑便签内容"
                          onClick={() => setNoteOpen(noteOpen === selA.id ? '' : selA.id)}
                        >
                          🗒
                        </button>
                      )}
                      <button
                        className="tb-btn"
                        title="删除标注 (Del)"
                        onClick={() => {
                          removeAnno(selA.id)
                          setSelAnno(null)
                        }}
                      >
                        🗑
                      </button>
                      <button className="tb-btn" title="取消选中 (Esc)" onClick={() => setSelAnno(null)}>
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      </div>
      {pop && (
        <div className="pdf-anno-pop" style={{ left: pop.x, top: Math.max(8, pop.y - 46) }} onMouseDown={(e) => e.preventDefault()}>
          {pop.mode === 'menu' ? (
            <>
              {ANNO_COLORS.map((c) => (
                <button key={c} className="pdf-anno-swatch" style={{ background: c }} title="高亮" onClick={() => addHighlight(c)} />
              ))}
              <button className="tb-btn" title="添加便签" onClick={() => setPop({ ...pop, mode: 'note' })}>
                📝
              </button>
              <button className="tb-btn" title="忽略" onClick={() => setPop(null)}>
                ✕
              </button>
            </>
          ) : (
            <>
              <input
                className="tb-input pdf-note-input"
                placeholder="便签内容…"
                value={pop.content}
                onChange={(e) => setPop({ ...pop, content: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addNote()
                  }
                }}
                autoFocus
              />
              <button className="tb-btn" onClick={addNote}>
                加
              </button>
              <button className="tb-btn" onClick={() => setPop({ ...pop, mode: 'menu' })}>
                ←
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default PdfViewer
