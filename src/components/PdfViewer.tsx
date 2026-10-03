import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Tab } from '../store'
import { useApp } from '../store'
import { readBytes, writeBytes, pickDirectory, pickPdfFiles, pickSaveFile, baseName } from '../lib/fs'
import { preparePdfSource } from '../lib/pdf-range'
import { takePdf } from '../lib/open-prefetch'
import { registerSaver } from '../lib/registry'
import { saveBusyTimer, saveDoneTimer } from '../lib/save-status'
import { failRaw, failStatus, statusText, statusTip } from '../lib/fail-msg'
import { PWD_MEMORY_NOTE, pwdCancelledText, pwdPromptText, pwdReason, type PwdReason } from '../lib/pdf-password'
import { findCountText, shouldPublish, type FindStatus } from '../lib/pdf-search'
import { PDF_OBJECTS_PER_TICK } from '../lib/pdf-ticks'
import {
  fromDisplayPoints,
  fromDisplayRect,
  normRot,
  parsePageSpec,
  toDisplayPoints,
  toDisplayRect,
} from '../lib/pdf-geo'
import {
  extractPages,
  mergePdfs,
  removePagesInPlace,
  rotatePagesInPlace,
  splitPdf,
} from '../lib/pdf-pages'

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
// 像素总量上限（约 8 张 A4@2x）：高倍缩放下单页就有几十 MB，只限页数会撑爆
const BITMAP_CACHE_PX = 32_000_000
// 侧栏缩略图固定宽度（CSS px）：与主视图缩放无关
const THUMB_W = 120
// 大纲条目上限：恶意/异常深文档防御
const OUTLINE_MAX = 1000

/**
 * 关标签时文档与 transport 被销毁，在途的 getPage/render 就抛 Transport destroyed。
 * 后台补齐（页尺寸、大纲、标注）据此把"拆除的声音"与"文件真的读不出"分开：前者是用户已经把这一页
 * 关掉了，不入账；后者要说，否则侧栏空着而用户不知道为什么空。
 */
const isTeardown = (e: unknown) => failRaw(e).toLowerCase().includes('transport destroyed')

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
  kind: 'highlight' | 'note' | 'rect' | 'ellipse' | 'line' | 'ink'
  page: number
  rects: AnnoRect[]
  // 形状几何：line=[[p1,p2]]、ink=多笔折线；rect/ellipse 只存 rects[0] 包围盒
  polys?: number[][][]
  color: string
  text?: string
  content?: string
}

const SHAPE_KINDS = new Set(['rect', 'ellipse', 'line', 'ink'])
const isShape = (a: PdfAnno) => SHAPE_KINDS.has(a.kind)
const SHAPE_LABEL: Record<string, string> = { rect: '▭ 矩形', ellipse: '◯ 椭圆', line: '↗ 直线', ink: '✏ 手绘' }

// 点集 → 左上原点包围盒
function bboxOf(pts: number[][][]): AnnoRect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of pts)
    for (const [x, y] of s) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  return { x: x0, y: y0, w: Math.max(x1 - x0, 1), h: Math.max(y1 - y0, 1) }
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
  // 搜索这一趟走到哪儿了：扫完之前界面只报"扫到第几页"，绝不报"无匹配"
  const [findStatus, setFindStatus] = useState<FindStatus>({ scanning: null, capped: false })
  // 组件卸载后循环还挂在 await 上：seq 只分辨"换词了"，不分辨"人不在了"，所以写界面之前先看这一位。
  // setup 里也要置回来——开发模式的 StrictMode 会跑挂→清→再挂，只在 cleanup 里置 false 就把第二次挂载也关了
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  const [sideOpen, setSideOpen] = useState(false)
  const [sideTab, setSideTab] = useState<'thumbs' | 'outline' | 'annos' | 'pages'>('thumbs')
  // 页面管理：勾选的页号（1-based）+ 忙标志 + 重载计数（页面写盘后重新读文件）
  const [pageSel, setPageSel] = useState<Set<number>>(new Set())
  const [pageSpec, setPageSpec] = useState('')
  const [pageBusy, setPageBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // 重载后仍停在操作前那一页（否则每次页面操作都跳回第 1 页）
  const keepPageRef = useRef(0)
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  const [annos, setAnnos] = useState<PdfAnno[]>([])
  const [pop, setPop] = useState<AnnoPop | null>(null)
  const [noteOpen, setNoteOpen] = useState('')
  const [tool, setTool] = useState<'text' | 'anno'>('text')
  type DrawKind = 'rect' | 'ellipse' | 'line' | 'ink'
  const [drawTool, setDrawTool] = useState<DrawKind | null>(null)
  const [draft, setDraft] = useState<{ kind: DrawKind; page: number; polys: number[][][] } | null>(null)
  const drawToolRef = useRef(drawTool)
  drawToolRef.current = drawTool
  const draftRef = useRef<{ kind: DrawKind; page: number; sx: number; sy: number; polys: number[][][] } | null>(null)
  const [selAnno, setSelAnno] = useState<string | null>(null)
  const annosRef = useRef(annos)
  annosRef.current = annos
  // 读侧的就绪账：内存里那份列表只有在这个 doc 上「整片读完并-publish 过」才是文件的视图；
  // 之前（正在加载…、逐页扫描中、读到一半失败、reload 换出新 doc 之后）它只是用户在窗口里的增量。
  // 记的是「哪一份 doc 已经读完」而不是「哪一份还在读」——初值为空，所以挂载后第一件事就是没读全。
  // 它是**状态**而不是直接写 ref：那句 setAnnosRead 与合并那一句在同一批更新里 ⇒ 开门的那一刻内存里已经是整片，
  // 而不会出现「账认了这份 doc、写回那一路读到的还是空片」的中间拍（实测差一枚 rAF ≈ 36ms）
  const [annosRead, setAnnosRead] = useState<PDFDocumentProxy | null>(null)
  const annosReadRef = useRef(annosRead)
  annosReadRef.current = annosRead
  const toolRef = useRef(tool)
  toolRef.current = tool
  const selRef = useRef(selAnno)
  selRef.current = selAnno
  // 拖移中的注解：起点屏幕坐标 + 原始矩形/折线（增量换算 px→PDF pt）
  const dragRef = useRef<
    | { id: string; sx: number; sy: number; orig: AnnoRect[]; origPolys?: number[][][]; moved: boolean }
    | null
  >(null)
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
  const bmpPx = (bmp: PageBitmap) => bmp.canvas.width * bmp.canvas.height
  const putBitmap = (n: number, bmp: PageBitmap) => {
    const c = bmpCache.current
    // 缩放档位或像素比一变，旧位图就永远命中不了，先清干净再存新的
    for (const [k, v] of c) if (v.scale !== bmp.scale || v.dpr !== bmp.dpr) c.delete(k)
    c.delete(n)
    c.set(n, bmp)
    let px = 0
    for (const v of c.values()) px += bmpPx(v)
    // A4 在 3× 缩放 + dpr 2 下单页位图就几十 MB，所以既限页数也限像素总量
    while (c.size > 1 && (c.size > BITMAP_CACHE_MAX || px > BITMAP_CACHE_PX)) {
      const k = c.keys().next().value as number
      px -= bmpPx(c.get(k) as PageBitmap)
      c.delete(k)
    }
  }
  const renderStats = useRef({ full: 0, hit: 0 })
  // 缩略图槽位：独立于主视图调度，侧栏收起/切走时整体清空重挂
  const thumbSlots = useRef(new Map<number, ThumbSlot>())
  const curPageRef = useRef(1)
  curPageRef.current = curPage

  // 本次打开是否走分段读取（冒烟断言用，不参与渲染）
  const rangeModeRef = useRef(false)

  // 加密 PDF 的密码闸门：pdf.js 错一次就再问一次、自己不会封顶，所以重试的次数由这道面板管着
  const [pwdAsk, setPwdAsk] = useState<{ reason: PwdReason; attempt: number } | null>(null)
  const [pwdInput, setPwdInput] = useState('')
  // 已交出去一个密码、等 pdf.js 的下一次反应（再问 / 打开 / 拒绝）——期间按钮全 disable，防连点重复投
  const [pwdBusy, setPwdBusy] = useState(false)
  const pwdUpdateRef = useRef<((v: string | Error) => void) | null>(null)
  const pwdAttemptRef = useRef(0)
  // 取消只能靠界面自己记：交回的错误串到不了归因层（实测 Name=PasswordException / code=1，与我们那句无关）
  const pwdCancelledRef = useRef(false)
  const pwdInputRef = useRef<HTMLInputElement>(null)

  // layout effect：被动效果排在「这一帧画完」之后，取文档要等一次真实绘制。这条 effect
  // 不量 DOM，提前跑只是把异步任务早发出去——同构建实测 heavy.pdf 首页 746 → 473ms。
  // （更早这里记的「~317ms」后来查明主要是外壳 Suspense 的兜底节流，不是被动效果排队；
  // 表格侧改 layout 时那一跳没动，因为卡的是外壳不是这条排队。两处账分开记。）
  useLayoutEffect(() => {
    if (!tab.path) return
    let disposed = false
    let openTask: PDFDocumentLoadingTask | null = null
    // 每轮打开从零计：上一轮的取消标记与试错次数不许带过来（重载与换标签都算新一轮）
    pwdCancelledRef.current = false
    pwdAttemptRef.current = 0
    pwdUpdateRef.current = null
    setPwdAsk(null)
    setPwdBusy(false)
    setPwdInput('')
    ;(async () => {
      try {
        const path = tab.path!
        const opts = {
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
        }
        // 首屏那次读（过 4MB 闸门的只喂文件头、没过的整本读一次）已由外壳在开标签那一刻发出去；
        // 取不到就自己发，不假设外壳一定先跑。闸门的判断只在 preparePdfSource 那一处，这里不重复判。
        const src = (await takePdf(path)) ?? (await preparePdfSource(path))
        if (disposed) return
        rangeModeRef.current = src.mode === 'range'
        openTask =
          src.mode === 'range'
            ? pdfjsLib.getDocument({ ...opts, range: src.transport })
            : pdfjsLib.getDocument({ ...opts, data: src.bytes })
        // 闸门必须挂在 await 之前（实测：晚一步 pdf.js 就直接按"没给密码"拒掉，面板永远不出现）。
        // 这里只把"下一次该怎么回话"存下来并亮出面板——绝不自动投密码，因为实测 pdf.js 错一次问一次、
        // 自己不封顶，整条重试链路的节奏只在界面上。
        openTask.onPassword = (updatePassword: (v: string | Error) => void, code: number) => {
          if (disposed) {
            updatePassword(new Error('已关闭'))
            return
          }
          pwdUpdateRef.current = updatePassword
          setPwdBusy(false)
          setPwdInput('')
          setPwdAsk({ reason: pwdReason(code), attempt: ++pwdAttemptRef.current })
        }
        const d = await openTask.promise
        if (disposed) {
          void d.destroy()
          return
        }
        pwdUpdateRef.current = null
        setPwdAsk(null)
        slots.current.clear()
        setSizes({})
        setCurPage(keepPageRef.current || 1)
        setDoc(d)
        setStatus('')
      } catch (e) {
        // 被换掉的那一趟（开发模式下的双挂载、换标签、重新打开都会）自己按过 Error 下去，
        // 这里的拒绝是**我们**按下去的结果，不是这一趟的真实结局。它绝不能再动状态：
        // 晚一步落地的话，它会把还活着的那一趟刚亮起来的密码面板抹掉（setPwdAsk(null)），
        // pdf.js 从此等不到回话——界面就卡在「正在加载…」上，看着像产品没接线。
        if (disposed) return
        console.error(e)
        setPwdAsk(null)
        pwdUpdateRef.current = null
        // 用户自己取消的那一句不带"失败"前缀，也不带原始信息（那是我们按下去的，不是它报的）
        setStatus(pwdCancelledRef.current ? pwdCancelledText() : failStatus(e, '加载失败'))
      }
    })()
    return () => {
      disposed = true
      // destroy 任务连带销毁文档与 transport（未完成的区间请求据此作废）
      void openTask?.destroy().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, reloadKey])

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
    })().catch((e) => {
      // 扫尺寸是尽力而为：只在"不是因为关标签而销毁"时占状态栏，否则用户看到的是凭空冒出的失败
      if (!cancelled) {
        console.error(e)
        if (!isTeardown(e)) setStatus(failStatus(e, '页尺寸读取失败'))
      }
      cancelled = true
    })
    return () => {
      cancelled = true
    }
  }, [doc])

  useEffect(() => {
    slots.current.clear()
    bmpCache.current.clear()
    // 全文索引只按页号缓存，换文档不清会把上一本的文本当这一本命中
    pageTexts.current.clear()
    renderStats.current = { full: 0, hit: 0 }
    thumbSlots.current.clear()
    setQuery('')
    setMatches([])
    setActiveIdx(-1)
    setFindStatus({ scanning: null, capped: false })
    setSearchOpen(false)
    setOutline([])
    // "页面"是工作区而不是内容视图：页面操作后重载要留在原页签
    setSideTab((t) => (t === 'pages' ? t : 'thumbs'))
    setAnnos([])
    setPop(null)
    setNoteOpen('')
    setTool('text')
    setSelAnno(null)
  }, [doc])

  // 页面操作写盘后回到操作前的那一页（占位 DOM 由上一行 setDoc 触发渲染，等一帧再滚）
  useEffect(() => {
    if (!doc) return
    const n = keepPageRef.current
    if (!n) return
    keepPageRef.current = 0
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-page="${Math.min(n, doc.numPages)}"]`)?.scrollIntoView({ block: 'start' })
    })
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
        if (!cancelled && !isTeardown(e)) setStatus(failStatus(e, '大纲读取失败'))
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
        // /Rect 是"未旋转 + 左下原点"，内存统一存"显示空间（已旋转 + 左上原点）"，先按 rotation:0 拿基准尺寸
        const rot = normRot(p.rotate ?? 0)
        const vp0 = p.getViewport({ scale: 1, rotation: 0 })
        const base = { w: vp0.width, h: vp0.height }
        // 注解点集：PDF 左下原点 → 未旋转左上 → 显示空间
        const dispPts = (pts: number[][]) =>
          toDisplayPoints([pts.map(([x, y]) => [x, base.h - y])], rot, base)[0]
        const list = (await p.getAnnotations({ intent: 'display' })) as {
          subtype?: string
          rect?: number[]
          color?: number[]
          contentsObj?: { str?: string }
          lineCoordinates?: number[]
          inkLists?: ArrayLike<ArrayLike<number>>
        }[]
        for (const a of list) {
          if (!Array.isArray(a.rect) || a.rect.length < 4) continue
          const [x1, y1, x2, y2] = a.rect
          const tl = { x: x1, y: base.h - y2, w: x2 - x1, h: y2 - y1 }
          const r = toDisplayRect(tl, rot, base)
          const txt = a.contentsObj?.str ?? ''
          if (a.subtype === 'Highlight') {
            out.push({ id: nid(), kind: 'highlight', page: n, rects: [r], color: rgbHex(a.color), text: txt })
          } else if (a.subtype === 'Text') {
            out.push({ id: nid(), kind: 'note', page: n, rects: [r], color: rgbHex(a.color), content: txt })
          } else if (a.subtype === 'Square' || a.subtype === 'Circle') {
            out.push({
              id: nid(),
              kind: a.subtype === 'Square' ? 'rect' : 'ellipse',
              page: n,
              rects: [r],
              color: rgbHex(a.color),
            })
          } else if (a.subtype === 'Line') {
            // pdf.js 把 L 解析成 lineCoordinates=[x1,y1,x2,y2]（左下原点，实测非对象）；缺字段时按包围盒对角线兜底
            const lc = a.lineCoordinates
            const l = Array.isArray(lc) && lc.length >= 4 ? lc : [x1, y1, x2, y2]
            const pts = [dispPts([
              [l[0], l[1]],
              [l[2], l[3]],
            ])]
            out.push({ id: nid(), kind: 'line', page: n, rects: [bboxOf(pts)], polys: pts, color: rgbHex(a.color) })
          } else if (a.subtype === 'Ink') {
            if (!Array.isArray(a.inkLists) || !a.inkLists.length) continue
            const pts = a.inkLists.map((flat) => {
              const s: number[][] = []
              for (let i = 0; i + 1 < flat.length; i += 2) s.push([flat[i], flat[i + 1]])
              return dispPts(s)
            })
            out.push({ id: nid(), kind: 'ink', page: n, rects: [bboxOf(pts)], polys: pts, color: rgbHex(a.color) })
          }
        }
      }
      if (!cancelled) {
        // 收尾是「并」不是「替」：窗口内用户新画的那几枚已经在内存里，整片替换就把它们抹掉了
        setAnnos((cur) => [...out, ...cur])
        // 从这一刻起这本账才认这一份 doc（写回那一处比的就是这个对象）；与上面那一句同批提交 ⇒ 账开的时候内存已经是整片
        setAnnosRead(doc)
      }
    })().catch((e) => {
      // 标注导入是后台补做：拆除时的抛话不入账，其余要说——侧栏空着而不说为什么空，用户只能猜
      if (!cancelled) {
        console.error(e)
        if (!isTeardown(e)) setStatus(failStatus(e, '标注读取失败'))
      }
      // 读到一半就失败 ⇒ 这本账**故意不记这一份 doc**（读到的不是整片）：写回继续被拒，直到重新打开这份文件
      cancelled = true
    })
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
        setStatus(failStatus(e, '渲染失败'))
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
      setFindStatus({ scanning: null, capped: false })
      return
    }
    const total = d.numPages
    const found: Match[] = []
    // 边扫边说话：700 页的件从零扫一遍实测 1.9~2.4s（并行到 16 路也只省到 1.9s，瓶颈在 pdf.js 逐页
    // getTextContent 的往返上，每页那串 toLowerCase+indexOf 全场只花 5ms），
    // 所以本轮不动"扫得快"，动的是"等的时候界面说的是什么"
    let lastAt = performance.now()
    let sinceHits = 0
    let sincePages = 0
    let capped = false
    // 只把第一条命中滚进视野一次：往后每次交进度都重定向一次就是抢用户的滚动
    let focused = false
    const focusFirst = () => {
      let idx = found.findIndex((m) => m.page >= curPageRef.current)
      if (idx === -1) idx = 0
      scrollToMatch(found, idx)
    }
    outer: for (let n = 1; n <= total; n++) {
      const t = await loadPageText(d, n)
      // 「这一趟已经作废」那道门打在写任何共享状态之前（v0.65 的规矩）：换词会另起一趟，
      // 组件卸载后这一趟也还在 await 上，晚到的那趟不许把界面抹回旧样子
      if (seq !== searchSeq.current || !aliveRef.current) return
      const hay = t.full.toLowerCase()
      let pos = hay.indexOf(q)
      while (pos !== -1) {
        const b = locate(t, pos)
        const e = locate(t, pos + q.length - 1)
        found.push({ page: n, bItem: b.item, bOff: b.off, eItem: e.item, eOff: e.off + q.length })
        sinceHits++
        if (found.length >= SEARCH_MAX_HITS) {
          capped = true
          break outer
        }
        pos = hay.indexOf(q, pos + q.length)
      }
      sincePages++
      if (shouldPublish(performance.now(), lastAt, sinceHits, sincePages)) {
        lastAt = performance.now()
        sinceHits = 0
        sincePages = 0
        setMatches([...found])
        setFindStatus({ scanning: { scanned: n, total }, capped })
        if (!focused && found.length) {
          focused = true
          focusFirst()
        }
      }
    }
    if (seq !== searchSeq.current || !aliveRef.current) return
    setMatches(found)
    setFindStatus({ scanning: null, capped })
    if (!found.length) {
      setActiveIdx(-1)
      return
    }
    // 命中一直等到扫完才出现（或中途只发过没命中的进度）时，这一趟的最后一次定位仍要说得出
    if (!focused) focusFirst()
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
    // 打字的那一刻起这一格就该说"正在搜索"：防抖的 200ms 里旧形状的界面写的是「无匹配」，
    // 而那一刻连一页都没扫过——那不是"没有"，那是"还没开始"。上一词的命中数也一起清掉，
    // 否则界面会把"上一个词的第 3 条"挂在"这一个词"的格子里。
    setMatches([])
    setActiveIdx(-1)
    setFindStatus(
      query.trim() ? { scanning: { scanned: 0, total: doc.numPages }, capped: false } : { scanning: null, capped: false }
    )
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
      } else if (e.key === 'Escape' && drawToolRef.current) {
        setDrawTool(null)
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
    if (tool !== 'anno' || e.button !== 0 || drawTool) return
    const a = annos.find((x) => x.id === id)
    if (!a) return
    e.stopPropagation()
    setSelAnno(id)
    setPop(null)
    dragRef.current = {
      id,
      sx: e.clientX,
      sy: e.clientY,
      orig: a.rects.map((r) => ({ ...r })),
      origPolys: a.polys?.map((s) => s.map((p) => [...p])),
      moved: false,
    }
  }

  // 形状绘制：在页面上按下起点，拖到终点抬手成一条标注（ink 逐点采样）
  const drawPointerDown = (e: React.PointerEvent) => {
    const kind = drawToolRef.current
    if (!kind || tool !== 'anno' || e.button !== 0) return
    const pe = (e.target as HTMLElement).closest('[data-page]') as HTMLElement | null
    if (!pe) return
    const n = Number(pe.dataset.page)
    const pr = pe.getBoundingClientRect()
    const sc = scaleRef.current
    const pt = [(e.clientX - pr.left) / sc, (e.clientY - pr.top) / sc]
    draftRef.current = { kind, page: n, sx: pt[0], sy: pt[1], polys: [[[...pt]]] }
    setDraft({ kind, page: n, polys: [[[...pt]]] })
    setPop(null)
    setSelAnno(null)
  }

  const drawPointerMove = (e: React.PointerEvent) => {
    const d = draftRef.current
    if (!d) return
    const pe = pageEl(d.page)
    if (!pe) return
    const pr = pe.getBoundingClientRect()
    const sc = scaleRef.current
    const x = +((e.clientX - pr.left) / sc).toFixed(1)
    const y = +((e.clientY - pr.top) / sc).toFixed(1)
    const stroke = d.polys[0]
    if (d.kind === 'ink') {
      const last = stroke[stroke.length - 1]
      if (Math.hypot(x - last[0], y - last[1]) < 1.5) return
      stroke.push([x, y])
    } else {
      stroke.length = 1
      stroke.push([x, y])
    }
    setDraft({ kind: d.kind, page: d.page, polys: d.polys.map((s) => s.map((p) => [...p])) })
  }

  const drawPointerUp = () => {
    const d = draftRef.current
    draftRef.current = null
    if (!d) return
    const stroke = d.polys[0]
    const min = d.kind === 'ink' ? 2 : 4
    if (stroke.length < 2 || Math.max(
      Math.abs(stroke[stroke.length - 1][0] - stroke[0][0]),
      Math.abs(stroke[stroke.length - 1][1] - stroke[0][1]),
    ) < min) {
      setDraft(null)
      return
    }
    const polys = d.polys.map((s) => s.map((p) => [...p]))
    setAnnos((list) => [...list, { id: nid(), kind: d.kind, page: d.page, rects: [bboxOf(polys)], polys, color: ANNO_COLORS[0] }])
    markDirty(tab.id, true)
    setDraft(null)
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
                polys: d.origPolys?.map((s) =>
                  s.map((p) => [+(p[0] + dx / sc).toFixed(2), +(p[1] + dy / sc).toFixed(2)]),
                ),
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

  // —— 标注写回：pdf-lib 删旧自有注解（Highlight/Text/Square/…，留链接等）→ 按模型重加 → 覆盖原文件 ——
  // 页面操作（旋转/删除/合并）写盘前也要先把内存标注落进去，所以抽成函数给两处共用
  const writeAnnosTo = async (path: string) => {
      // 就绪账记的是「哪一份 doc 已经整片读完」：doc 还没来、正在逐页扫、读到一半失败、reload 换出新 doc——
      // 这几种在内存里都不是文件的视图，而这一趟是「整片清旧注解 + 按内存重加」，此刻写就是在覆盖文件
      // 两条写通道（Ctrl+S 那一路与工具条的页面操作）都只认这一处：抛出去，各自现成的 catch 会说这一句
      const d = docRef.current
      if (!d || annosReadRef.current !== d) throw new Error('标注还没读全，这一趟没写文件（现在存会抹掉还没读进来的标注），等读全再存')
      const list = annosRef.current
      // pdf-lib 1.17 无高层标注 API：用 context 手建 /Annot 字典（Highlight/Text 标准注解，其他阅读器可见）
      const { PDFDocument, PDFName, PDFDict, PDFHexString } = await import('pdf-lib')
      const bytes = await readBytes(path)
      const pdoc = await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: PDF_OBJECTS_PER_TICK })
      const pages = pdoc.getPages()
      for (const pg of pages) {
        const arr = pg.node.Annots()
        if (!arr) continue
        for (let i = arr.size() - 1; i >= 0; i--) {
          const obj = pdoc.context.lookup(arr.get(i))
          if (!(obj instanceof PDFDict)) continue
          const st = obj.get(PDFName.of('Subtype'))
          const owned = ['Highlight', 'Text', 'Square', 'Circle', 'Line', 'Ink']
          if (owned.some((s) => st === PDFName.of(s))) arr.remove(i)
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
        // 内存存显示空间坐标，/Annot 要写回"未旋转 + 左下原点"：先按该页 /Rotate 反变换
        const sz = pg.getSize()
        const base = { w: sz.width, h: sz.height }
        const rot = normRot(pg.getRotation().angle)
        const height = base.h
        const rects = a.rects.map((r) => fromDisplayRect(r, rot, base))
        const polys = a.polys ? fromDisplayPoints(a.polys, rot, base) : undefined
        let arr = pg.node.Annots()
        if (!arr) {
          arr = pdoc.context.obj([])
          pg.node.set(PDFName.of('Annots'), arr)
        }
        if (a.kind === 'highlight') {
          const x0 = Math.min(...rects.map((r) => r.x))
          const y0 = Math.min(...rects.map((r) => r.y))
          const x1 = Math.max(...rects.map((r) => r.x + r.w))
          const y1 = Math.max(...rects.map((r) => r.y + r.h))
          const quads: number[] = []
          for (const r of rects) {
            const yt = height - r.y
            const yb = height - r.y - r.h
            quads.push(r.x, yt, r.x + r.w, yt, r.x, yb, r.x + r.w, yb)
          }
          arr.push(
            pdoc.context.register(
              pdoc.context.obj({
                Type: PDFName.of('Annot'),
                Subtype: PDFName.of('Highlight'),
                Rect: [x0, height - y1, x1, height - y0],
                QuadPoints: quads,
                C: colorArr(a.color),
                Contents: PDFHexString.fromText(a.text || ' '),
              }),
            ),
          )
        } else if (a.kind === 'note') {
          const r0 = rects[0]
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
        } else if (a.kind === 'rect' || a.kind === 'ellipse') {
          const r = rects[0]
          arr.push(
            pdoc.context.register(
              pdoc.context.obj({
                Type: PDFName.of('Annot'),
                Subtype: PDFName.of(a.kind === 'rect' ? 'Square' : 'Circle'),
                Rect: [r.x, height - r.y - r.h, r.x + r.w, height - r.y],
                C: colorArr(a.color),
                Border: { S: PDFName.of('S'), W: 1.5 },
              }),
            ),
          )
        } else if (a.kind === 'line' || a.kind === 'ink') {
          const r = rects[0]
          const flip = (p: number[]) => [p[0], height - p[1]]
          const s0 = polys?.[0]
          if (a.kind === 'line' && s0 && s0.length >= 2) {
            arr.push(
              pdoc.context.register(
                pdoc.context.obj({
                  Type: PDFName.of('Annot'),
                  Subtype: PDFName.of('Line'),
                  Rect: [r.x, height - r.y - r.h, r.x + r.w, height - r.y],
                  L: [...flip(s0[0]), ...flip(s0[s0.length - 1])],
                  Head: PDFName.of('OpenA'),
                  Tail: PDFName.of('None'),
                  C: colorArr(a.color),
                  Border: { S: PDFName.of('S'), W: 2 },
                }),
              ),
            )
          } else if (a.kind === 'ink' && polys?.length) {
            arr.push(
              pdoc.context.register(
                pdoc.context.obj({
                  Type: PDFName.of('Annot'),
                  Subtype: PDFName.of('Ink'),
                  Rect: [r.x, height - r.y - r.h, r.x + r.w, height - r.y],
                  InkList: polys.map((s) => s.flatMap((p) => flip(p))),
                  C: colorArr(a.color),
                  Border: { S: PDFName.of('S'), W: 2 },
                }),
              ),
            )
          }
        }
      }
      const out = await pdoc.save({ addDefaultPage: false, objectsPerTick: PDF_OBJECTS_PER_TICK })
      await writeBytes(path, out)
      markDirty(tab.id, false)
  }
  const writeAnnosRef = useRef(writeAnnosTo)
  writeAnnosRef.current = writeAnnosTo

  // 「已保存」那句的收尾时钟（与表格头共用 lib/save-status.ts 那一份）
  const doneRef = useRef<ReturnType<typeof saveDoneTimer> | null>(null)
  if (!doneRef.current) doneRef.current = saveDoneTimer(setStatus)

  // 三句话挂在 saver 这一层，不挂进 writeAnnosTo：工具条的页面操作（pageOp）自己有「旋转…」那一句，
  // 装进共用的函数里就成了两头发话
  useEffect(() => {
    if (!tab.path) return
    const path = tab.path
    const done = doneRef.current!
    return registerSaver(tab.id, async () => {
      // 实测（v0.70 release）：12/300/2300 页三档的全程是 11 / 143~161 / 1071~1161ms，
      // 而这一路页内 longtask 观测器一条都没收到（门槛 50ms）⇒ 那 1.1 秒不是把一个长同步块摊在主线程上，
      // 门到点真说得出口：大件那句有 ~940ms 可看，前两档由同一枚门拦着不闪
      done.cancel()
      const busy = saveBusyTimer(setStatus)
      busy.arm()
      try {
        await writeAnnosRef.current(path)
        busy.cancel()
        done.show([])
      } catch (e) {
        // 失败那句必须顶掉「正在保存…」：这一趟已经停了，留着就是界面在说没在做的事。
        // 这一路原本连这句都没有——writeAnnosTo 不 catch，而 registry 的在途锁把抛错咽了下去
        busy.cancel()
        setStatus(failStatus(e, '保存失败'))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.path])

  // —— 页面级操作：先把内存标注写进文件（页序一变旧坐标就失去意义），改完重载，标注由 /Annots 重新导入 ——
  const pageOp = async (
    label: string,
    run: (path: string, pages: number[]) => Promise<string>,
  ) => {
    const path = tab.path
    if (!path || !doc || pageBusy) return
    const pages = [...pageSel]
      .filter((n) => n >= 1 && n <= doc.numPages)
      .sort((a, b) => a - b)
    const targets = pages.length ? pages : [Math.min(curPage, doc.numPages)]
    setPageBusy(true)
    setStatus(`${label}…`)
    try {
      await writeAnnosRef.current(path)
      keepPageRef.current = curPage
      const msg = await run(path, targets)
      setPageSel(new Set())
      reloadDoc()
      setStatus(msg)
      setTimeout(() => setStatus(''), 3000)
    } catch (e) {
      // 失败的那一句不定时清除：三秒后抹掉就等于让用户读不完，也悬停不到原话
      setStatus(failStatus(e, `${label}失败`))
    } finally {
      setPageBusy(false)
    }
  }

  const reloadDoc = () => {
    setPop(null)
    setSelAnno(null)
    setNoteOpen('')
    setDrawTool(null)
    setReloadKey((k) => k + 1)
  }

  // 交出一个密码。空串不当密码用（喂进去只换来一次重新提问，白耗一轮）
  const submitPwd = (v?: string) => {
    const up = pwdUpdateRef.current
    if (!up || !pwdAsk || pwdBusy) return
    const val = v ?? pwdInput
    if (!val) return
    setPwdBusy(true)
    up(val)
  }

  // 取消：先记下这件事（错误串分不出用户取消与没给密码），再把闸门按下去
  const cancelPwd = () => {
    const up = pwdUpdateRef.current
    pwdCancelledRef.current = true
    pwdUpdateRef.current = null
    setPwdAsk(null)
    setPwdInput('')
    setStatus(pwdCancelledText())
    up?.(new Error('用户取消了密码输入'))
  }

  const opRotate = (delta: number) =>
    pageOp('旋转', async (path, pages) => {
      await rotatePagesInPlace(path, pages, delta)
      return `已旋转 ${pages.length} 页 ${delta > 0 ? '顺时针' : '逆时针'} 90°`
    })

  const opRemove = () =>
    pageOp('删除页面', async (path, pages) => {
      const left = await removePagesInPlace(path, pages)
      return `已删除 ${pages.length} 页，剩 ${left} 页`
    })

  const opExtract = async () => {
    if (!tab.path) return
    const stem = baseName(tab.path).replace(/\.pdf$/i, '')
    const out = await pickSaveFile(`${stem}-提取.pdf`, ['pdf'])
    if (!out) return
    await pageOp('提取页面', async (path, pages) => {
      const n = await extractPages(path, out, pages)
      return `已提取 ${n} 页到 ${baseName(out)}`
    })
  }

  const opMerge = async () => {
    if (!tab.path) return
    const files = await pickPdfFiles(true)
    if (!files.length) return
    await pageOp('合并 PDF', async (path) => {
      const total = await mergePdfs(path, files)
      return `已合并 ${files.length} 个文件，共 ${total} 页`
    })
  }

  const opSplit = async () => {
    if (!tab.path) return
    const dir = await pickDirectory()
    if (!dir) return
    await pageOp('拆分页面', async (path) => {
      const names = await splitPdf(path, dir)
      return `已拆成 ${names.length} 个单页文件（${baseName(path).replace(/\.pdf$/i, '')}-001.pdf 起）`
    })
  }

  const togglePage = (n: number) => {
    setPageSel((s) => {
      const next = new Set(s)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  // "1-3,5" 这类表达式一次性换成勾选集合；全空即清空选择
  const applySpec = () => {
    const pages = parsePageSpec(pageSpec, doc?.numPages ?? 0)
    setPageSel(new Set(pages ?? []))
    if (!pages && pageSpec.trim()) setStatus('页码写法无效，例：1-3,5')
  }

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
      // 搜索扫过几页的文本：真机腿判"扫完全程"的唯一硬判据（与 renderedPages 同一类缓存观测量）
      textPages: () => pageTexts.current.size,
      perf: () => ({ ...renderStats.current, cached: [...bmpCache.current.keys()] }),
      rangeMode: () => rangeModeRef.current,
      // 写回闸门那一句的取反：真机腿判「这一按该不该被拒」就吃这一枚（null doc 也算不许写）
      annosWritable: () => docRef.current !== null && annosReadRef.current === docRef.current,
      annos: () =>
        annos.map((a) => ({
          kind: a.kind,
          page: a.page,
          color: a.color,
          rects: a.rects.length,
          polys: a.polys?.map((s) => s.length),
          box: a.polys ? a.rects[0] : undefined,
          content: (a.content ?? a.text ?? '').slice(0, 60),
        })),
      shapes: () => annos.filter(isShape).map((a) => ({ kind: a.kind, page: a.page, color: a.color, box: a.rects[0] })),
      // 冒烟用：这一页的图元与文字（表格打印保真要核"图真的进去了、藏起来的值真的没进去"）
      // 图片对象要等解码完才量得到尺寸，所以拿到 objectId 后再等它落地
      pageProbe: async (n: number) => {
        const p = await doc?.getPage(n)
        if (!p) return null
        const [ops, txt] = await Promise.all([p.getOperatorList(), p.getTextContent()])
        let imageOps = 0
        const names = new Set<string>()
        for (let i = 0; i < ops.argsArray.length; i++) {
          const a = ops.argsArray[i] as unknown[]
          if (typeof a?.[0] === 'string' && a[0].startsWith('img_')) {
            imageOps++
            names.add(a[0])
          }
        }
        const holder = p as unknown as { objs?: { get?: (k: string) => unknown } }
        const images: { name: string; w: number; h: number }[] = []
        for (const name of names) {
          let box: { width?: number; height?: number } | undefined
          for (let i = 0; i < 12; i++) {
            // pdf.js 的 objs.get 对还没解码完的对象是直接抛异常的，不是返回 undefined
            try {
              box = holder.objs?.get?.(name) as { width?: number; height?: number } | undefined
            } catch {
              box = undefined
            }
            if (box?.width) break
            await new Promise((r) => setTimeout(r, 150))
          }
          images.push({ name, w: box?.width ?? 0, h: box?.height ?? 0 })
        }
        return {
          imageOps,
          uniqueImages: names.size,
          images,
          text: txt.items.map((t) => ('str' in t ? t.str : '')).join(' '),
        }
      },
      // 冒烟用：标注的显示空间几何原值（验证旋转/删页后几何是否跟着走对）
      geo: () => annos.map((a) => ({ kind: a.kind, page: a.page, r: a.rects[0], polys: a.polys })),
      drawTool: () => drawTool,
      draftPolys: () => draft?.polys.map((s) => s.length),
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
    // 冒烟钩子：页面操作绕过对话框直接给路径/页号
    w.__oofPdfPages = {
      sel: () => [...pageSel].sort((a, b) => a - b),
      setSel: (xs: number[]) => setPageSel(new Set(xs)),
      rotate: (pages: number[], delta: number) => rotatePagesInPlace(tab.path!, pages, delta),
      remove: (pages: number[]) => removePagesInPlace(tab.path!, pages),
      extract: (out: string, pages: number[]) => extractPages(tab.path!, out, pages),
      merge: (files: string[]) => mergePdfs(tab.path!, files),
      split: (dir: string) => splitPdf(tab.path!, dir),
      reload: () => reloadDoc(),
      saveAnnos: () => writeAnnosRef.current(tab.path!),
      runOp: (pages: number[], kind: 'rotate' | 'remove') => {
        setPageSel(new Set(pages))
        return kind === 'rotate' ? opRotate(90) : opRemove()
      },
    }
    // 冒烟钩子：加密 PDF 的密码闸门。feed 直接交密码（绕开 React 状态时序），dom 读真渲染那几行
    w.__oofPdfPwd = {
      path: () => tab.path ?? '',
      ask: () => pwdAsk,
      busy: () => pwdBusy,
      cancelled: () => pwdCancelledRef.current,
      rangeMode: () => rangeModeRef.current,
      status: () => status,
      numPages: () => doc?.numPages ?? 0,
      feed: (s: string) => submitPwd(s),
      cancel: () => cancelPwd(),
      dom: () => {
        const card = document.querySelector('.pdf-pwd-card')
        if (!card) return null
        const ok = card.querySelector<HTMLButtonElement>('.pdf-pwd-ok')
        const cancel = card.querySelector<HTMLButtonElement>('.pdf-pwd-cancel')
        return {
          ask: card.querySelector('.pdf-pwd-ask')?.textContent ?? '',
          note: card.querySelector('.pdf-pwd-note')?.textContent ?? '',
          type: (card.querySelector('.pdf-pwd-input') as HTMLInputElement | null)?.type ?? '',
          okDisabled: ok?.disabled ?? null,
          cancelDisabled: cancel?.disabled ?? null,
        }
      },
    }
  }

  // 形状标注 → SVG 元素（坐标 ×scale，与 rects 同一 PDF pt 左上原点约定）
  const shapeNode = (a: PdfAnno) => {
    const S = scale
    const box = a.rects[0]
    const linePts = a.polys?.[0]
    const common = { stroke: a.color, fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const }
    const el =
      a.kind === 'rect' ? (
        <rect x={box.x * S} y={box.y * S} width={box.w * S} height={box.h * S} {...common} />
      ) : a.kind === 'ellipse' ? (
        <ellipse
          cx={(box.x + box.w / 2) * S}
          cy={(box.y + box.h / 2) * S}
          rx={(box.w / 2) * S}
          ry={(box.h / 2) * S}
          {...common}
        />
      ) : (
        <>
          {(a.polys ?? []).map((s, i) =>
            a.kind === 'line' && s.length >= 2 ? (
              <line key={i} x1={s[0][0] * S} y1={s[0][1] * S} x2={s[s.length - 1][0] * S} y2={s[s.length - 1][1] * S} {...common} />
            ) : (
              <polyline key={i} points={s.map((p) => `${p[0] * S},${p[1] * S}`).join(' ')} {...common} />
            ),
          )}
          {a.kind === 'line' && linePts && linePts.length >= 2 && (() => {
            const s = linePts
            const [x, y] = s[s.length - 1].map((v) => v * S)
            const [px, py] = s[s.length - 2].map((v) => v * S)
            const ang = Math.atan2(y - py, x - px)
            const L = 9
            return (
              <polygon
                points={`${x},${y} ${x - L * Math.cos(ang - 0.45)},${y - L * Math.sin(ang - 0.45)} ${x - L * Math.cos(ang + 0.45)},${y - L * Math.sin(ang + 0.45)}`}
                fill={a.color}
              />
            )
          })()}
        </>
      )
    return (
      <g key={a.id} data-anno={a.id} onPointerDown={(e) => startAnnoDrag(e, a.id)} onClick={(e) => e.stopPropagation()}>
        <g stroke="transparent" strokeWidth={14} fill="none">
          {el}
        </g>
        {el}
        {selAnno === a.id && (
          <rect
            className="pdf-anno-selbox"
            x={(box.x - 3) * S}
            y={(box.y - 3) * S}
            width={(box.w + 6) * S}
            height={(box.h + 6) * S}
          />
        )}
      </g>
    )
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
        <span className="editor-status" title={statusTip(status)}>
          {statusText(status)}
        </span>
        <span className="editor-hint">PDF · 选文字加高亮/便签（Ctrl+S 存回文件） · ✎ 标注工具：点选/拖移/改色/删除，▭◯↗✏ 拖拽绘制形状 · Ctrl+滚轮缩放 · Ctrl+F 搜索 · ☰ 侧栏</span>
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
        {/* 没打开成功（含刚取消密码）时唯一的出路入口：按同一轮路径重来一遍 */}
        {!doc && tab.path && btn('↻', () => reloadDoc(), false, '重新打开这份 PDF（设了密码的会再问一次）')}
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
              setDrawTool(null)
              setSelAnno(null)
            }}
          >
            T
          </button>
          <button
            className={`pdf-tool${tool === 'anno' ? ' on' : ''}`}
            title="标注编辑工具（点选/拖移/改色/删除）"
            onClick={() => {
              setTool('anno')
              setDrawTool(null)
            }}
          >
            ✎
          </button>
          {tool === 'anno' &&
            (['rect', 'ellipse', 'line', 'ink'] as const).map((k) => (
              <button
                key={k}
                className={`pdf-tool${drawTool === k ? ' on' : ''}`}
                title={`${SHAPE_LABEL[k]}（在页面拖拽绘制，Esc 退出）`}
                onClick={() => setDrawTool(drawTool === k ? null : k)}
              >
                {k === 'rect' ? '▭' : k === 'ellipse' ? '◯' : k === 'line' ? '↗' : '✏'}
              </button>
            ))}
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
              {findCountText(
                {
                  scanning: findStatus.scanning,
                  hits: matches.length,
                  active: activeIdx,
                  capped: findStatus.capped,
                },
                query.trim() !== ''
              )}
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
              <button
                className={`side-tab${sideTab === 'pages' ? ' on' : ''}`}
                onClick={() => setSideTab('pages')}
              >
                页面
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
            ) : sideTab === 'pages' ? (
              <div className="pdf-pages">
                <div className="pdf-pages-spec">
                  <input
                    className="tb-input pdf-spec-input"
                    type="text"
                    placeholder="按页码选中，如 1-3,5"
                    value={pageSpec}
                    onChange={(e) => setPageSpec(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applySpec()
                    }}
                  />
                  {btn('选中', applySpec)}
                  {btn('清空', () => setPageSel(new Set()))}
                </div>
                <div className="pdf-pages-list">
                  {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => {
                    const sz = sizes[n] ?? est
                    return (
                      <div
                        key={n}
                        className={`pdf-page-row${n === curPage ? ' active' : ''}${pageSel.has(n) ? ' sel' : ''}`}
                        onClick={() => togglePage(n)}
                      >
                        <input type="checkbox" checked={pageSel.has(n)} readOnly />
                        <button
                          className="pdf-page-jump"
                          title="滚到此页"
                          onClick={(e) => {
                            e.stopPropagation()
                            gotoPage(n)
                          }}
                        >
                          第 {n} 页
                        </button>
                        <span className="pdf-page-dim">
                          {Math.round(sz.w)}×{Math.round(sz.h)}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="pdf-pages-acts">
                  {btn('⟲ 左转', () => opRotate(-90), pageBusy, '逆时针 90°（未选中时对当前页）')}
                  {btn('⟳ 右转', () => opRotate(90), pageBusy, '顺时针 90°（未选中时对当前页）')}
                  {btn('删除页', opRemove, pageBusy)}
                  {btn('提取为新 PDF', opExtract, pageBusy)}
                  {btn('合并其他 PDF', opMerge, pageBusy)}
                  {btn('拆分为单页', opSplit, pageBusy)}
                </div>
                <div className="pdf-pages-hint">
                  {pageSel.size ? `已选 ${pageSel.size} 页` : '未选中页时对当前页生效'} ·
                  操作直接覆盖原文件，页面上的标注跟随所在页
                </div>
              </div>
            ) : sideTab === 'annos' ? (
              annos.length ? (
                <div className="pdf-annos">
                  {annos.map((a) => (
                    <div key={a.id} className={`pdf-anno-item${selAnno === a.id ? ' sel' : ''}`}>
                      <span className="pdf-anno-dot" style={{ background: a.color }} />
                      <button
                        className="pdf-anno-jump"
                        title={isShape(a) ? SHAPE_LABEL[a.kind] : a.kind === 'note' ? (a.content ?? '') : (a.text ?? '')}
                        onClick={() => {
                          setTool('anno')
                          setDrawTool(null)
                          setSelAnno(a.id)
                          gotoPage(a.page)
                        }}
                      >
                        <span className="pdf-anno-page">P{a.page}</span>
                        <span className="pdf-anno-sum">{isShape(a) ? SHAPE_LABEL[a.kind] : a.kind === 'note' ? a.content : a.text || '(高亮)'}</span>
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
          onPointerDown={drawPointerDown}
          onPointerMove={drawPointerMove}
          onPointerUp={drawPointerUp}
          onPointerCancel={drawPointerUp}
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
                    ) : a.kind === 'note' ? (
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
                    ) : null,
                  )}
                  {(pageAnnos.some(isShape) || (draft && draft.page === n)) && (
                    <svg
                      className={`pdf-anno-svg${drawTool ? ' drawing' : ''}`}
                      width={Math.floor(sz.w * scale)}
                      height={Math.floor(sz.h * scale)}
                    >
                      {pageAnnos.filter(isShape).map(shapeNode)}
                      {draft && draft.page === n && (
                        <g opacity={0.65}>
                          {draft.kind === 'rect' && (() => {
                            const b = bboxOf(draft.polys)
                            return (
                              <rect
                                x={b.x * scale}
                                y={b.y * scale}
                                width={b.w * scale}
                                height={b.h * scale}
                                stroke={ANNO_COLORS[0]}
                                fill="none"
                                strokeWidth={2}
                              />
                            )
                          })()}
                          {draft.kind === 'ellipse' && (() => {
                            const b = bboxOf(draft.polys)
                            return (
                              <ellipse
                                cx={(b.x + b.w / 2) * scale}
                                cy={(b.y + b.h / 2) * scale}
                                rx={(b.w / 2) * scale}
                                ry={(b.h / 2) * scale}
                                stroke={ANNO_COLORS[0]}
                                fill="none"
                                strokeWidth={2}
                              />
                            )
                          })()}
                          {(draft.kind === 'line' || draft.kind === 'ink') && (
                            <polyline
                              points={draft.polys[0].map((p) => `${p[0] * scale},${p[1] * scale}`).join(' ')}
                              stroke={ANNO_COLORS[0]}
                              fill="none"
                              strokeWidth={2}
                            />
                          )}
                        </g>
                      )}
                    </svg>
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
      {pwdAsk && (
        <div className="pdf-pwd-mask" role="dialog" aria-modal="true" aria-label="输入 PDF 密码">
          <div className="pdf-pwd-card">
            <div className="pdf-pwd-title">{baseName(tab.path ?? '') || '这份 PDF'}</div>
            <div className="pdf-pwd-ask">{pwdPromptText(pwdAsk.reason, pwdAsk.attempt)}</div>
            <div className="pdf-pwd-row">
              <input
                ref={pwdInputRef}
                className="tb-input pdf-pwd-input"
                type="password"
                placeholder="打开密码"
                value={pwdInput}
                disabled={pwdBusy}
                onChange={(e) => setPwdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitPwd()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelPwd()
                  }
                }}
                autoFocus
              />
              <button className="tb-btn pdf-pwd-ok" disabled={pwdBusy || !pwdInput} onClick={() => submitPwd()}>
                打开
              </button>
              <button className="tb-btn pdf-pwd-cancel" disabled={pwdBusy} onClick={cancelPwd}>
                取消
              </button>
            </div>
            <div className="pdf-pwd-note">{PWD_MEMORY_NOTE}</div>
          </div>
        </div>
      )}
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
