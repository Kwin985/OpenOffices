import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { message, open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import type { Tab } from '../store'
import { useApp } from '../store'
import { baseName, pickSaveFile, readBytes, readText, writeBytes, writeText } from '../lib/fs'
import {
  docxToCommentHtml,
  docxToDocMeta,
  docxToHtml,
  prosemirrorToDocxBytes,
  pageNumberParts,
  pageSetupOf,
  resolvePage,
  contentPxOf,
  MM_PX,
  PAGE_NUMBER_FORMATS,
  BUILTIN_STYLE_IDS,
  TABLE_COND_LABEL,
  TABLE_COND_TYPES,
  type DocComment,
  type DocMeta,
  type DocxStyleInfo,
  type PageNumberFormat,
  type PMNode,
  type TableCond,
  type TableCondType,
  openDocxZip,
} from '../lib/docx'
import { addCommentMark, findCommentAnchor, removeCommentMark } from '../lib/comment-extension'
import { acceptRevisions, deleteAsRevision, rejectRevisions, revModeOnState, toggleRevMode } from '../lib/revision-extension'
import {
  NOTE_LABEL,
  locateNote,
  noteOrdinalOf,
  notesOf,
  type NoteKind,
} from '../lib/note-extension'
import type { DocxImport } from '../lib/docx-fidelity'
import { nextStyleId, styleCssOf } from '../lib/doc-style-css'
import {
  loadSpellDict,
  onSpellDictChange,
  setSpellDeep,
  spellDeepOn,
  spellDictState,
  spellIgnored,
  spellPluginKey,
  spellUnignore,
  type SpellIssue,
} from '../lib/spell'
import { CollabSession, type CollabPeer, type CollabStatus } from '../lib/collab'
import { loadMacros, newMacro, runMacro, saveMacros, type Macro, type MacroRun } from '../lib/macro'
import { looksLikeVba, runVba, transpileVba, VBA_SAMPLE } from '../lib/vba'
import { authorColor, identityName, setIdentityName } from '../lib/identity'
import {
  BORDER_STYLES,
  BORDER_WIDTH_PT,
  CELL_EDGES,
  EDGE_LABEL,
  bdAttr,
  borderCss,
  borderParts,
  type CellEdge,
} from '../lib/cell-style'
import { ruleOf, type LineRule } from '../lib/paragraph-style'
import { docExtensions } from '../lib/doc-schema'
// v0.173：文档结构图与格式刷。形状住在 lib，组件只做接线与交互。
import { outlineOf, activeOutlinePos } from '../lib/outline'
import { captureFormat, clearableMarkNames, marksForSchema, paintableMarkNames, type PaintFormat } from '../lib/format-painter'
// v0.174：视图缩放与内容区右键菜单。刻度/条目表住在 lib，组件只做接线。
import { ZOOM_STEPS, clampZoom, fitZoom, nearestZoomStep, zoomByWheel, zoomPct, zoomStep, type FitMode } from '../lib/view-zoom'
import { contextItems } from '../lib/context-menu'
// v0.175：打印预览的状态与页数口径住在 lib，两处 UI 共用一份。
// v0.181：翻页定位的三枚纯函数也在那里（等距页距，非真分页）。
import { previewUi, estimatePages, pageScrollTop, pageOfScrollTop, clampPage } from '../lib/print-preview'
// v0.179：标尺的刻度/缩进换算住在 lib，组件只做接线与拖动交互
import { rulerTicks, rulerVerticalTicks, rulerIndentMarks, rulerIndentFromDrag, type RulerHandle } from '../lib/ruler'
import { caretColumn, tableTargetPx } from '../lib/table-width'
import { frPluginKey, activeIndexOf } from '../lib/find-replace'
import { docTemplate } from '../lib/templates'
import { odtToHtml, prosemirrorToOdtBytes } from '../lib/odt'
import { planFeed, runFeed, type FeedSource } from '../lib/doc-feed'
import { registerSaver, runExclusive } from '../lib/registry'
import { failDialog, failStatus } from '../lib/fail-msg'
// v0.180：可交互状态栏的条目表住在 lib；fail-msg / print-preview / view-zoom 的口径在那里转调
import { statusBarItems, type StatusBarAction } from '../lib/status-bar'
import { saveDoneTimer } from '../lib/save-status'
import { autoDelayMs, autoFailStatus, createAutoSaveLedger, onFocusBack, staleFailureClaim } from '../lib/auto-save'
import type { FailureClaim } from '../lib/auto-save'

interface Props {
  tab: Tab
}

const ODOC_HEADER = { app: 'openoffices', kind: 'doc', version: 1 }

const HL_COLORS = ['#fff59d', '#a5d6a7', '#90caf9', '#f48fb1']

/**
 * 表样式的六条边（v0.114）：外框四边（`w:tblBorders` 的 top/left/bottom/right）
 * 加内部横竖线（insideH/insideV）——表有别于单元格的一侧就在这里。
 */
const TABLE_BD_KEYS = ['bdTop', 'bdRight', 'bdBottom', 'bdLeft', 'bdInsideH', 'bdInsideV'] as const
type TableBdKey = (typeof TABLE_BD_KEYS)[number]
const TABLE_BD_LABEL: Record<TableBdKey, string> = {
  bdTop: '上边',
  bdRight: '右边',
  bdBottom: '下边',
  bdLeft: '左边',
  bdInsideH: '横线',
  bdInsideV: '竖线',
}

// 字体族候选（与 docx/odt 导出同一串名字，Word/LibreOffice 按本机字体回退）
const FONT_FAMILIES = [
  ['宋体', 'SimSun'],
  ['黑体', 'SimHei'],
  ['微软雅黑', 'Microsoft YaHei'],
  ['等线', 'DengXian'],
  ['楷体', 'KaiTi'],
  ['Arial', 'Arial'],
  ['Calibri', 'Calibri'],
  ['Times New Roman', 'Times New Roman'],
  ['Georgia', 'Georgia'],
  ['Courier New', 'Courier New'],
  ['Consolas', 'Consolas'],
]
// UI 以 pt 展示，内部存 px（CSS 习惯）；docx 导出换算回半点
const FONT_SIZES_PT = [9, 10, 11, 12, 14, 16, 18, 22, 24, 28, 36, 48]
const pt2px = (pt: number) => Math.round((pt * 96) / 72)
const px2pt = (px: number) => Math.round((px * 72) / 96)

// 字符间距档位（pt）：Word「字体→高级→间距」只有加宽/紧缩两档，这里给常用刻度。
// 0 这一档两侧语义不同：ODT 写得下（显式压掉样式层的间距），docx 写不下
// （库的门是 `if (options.characterSpacing)`，0 整枚不写），落到 docx 即「回到样式默认」。
const CHAR_SPACING_PT = [-2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4]
const spacingLabel = (pt: number) => (pt === 0 ? '标准' : pt > 0 ? `加宽 ${pt}pt` : `紧缩 ${-pt}pt`)
/** 模型存的是带单位串（"1.5pt"），UI 存数字；两边靠这个函数对齐 */
const spacingToModel = (pt: number) => `${pt}pt`
function spacingFromModel(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0
  const n = Number(String(raw).replace(/pt$/i, ''))
  return Number.isFinite(n) ? n : 0
}

// 常用符面：前六枚是 ODF/OOXML 双方都落得下的保守集，后几枚是装饰性的
const BULLET_CHARS = ['•', '○', '■', '□', '◆', '◇', '★', '☆', '▪', '▸', '–', '—', '✓', '✗', '✦', '❖']

// 状态栏字数/字符的最小刷新间隔：characterCount 每次都要遍历全文
const WORDS_THROTTLE_MS = 400

function DocEditor({ tab }: Props) {
  const renameTab = useApp((s) => s.renameTab)
  const markDirty = useApp((s) => s.markDirty)
  const markRecent = useApp((s) => s.markRecent)
  const [status, setStatus] = useState<string>(tab.path ? '正在加载…' : '')
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const [meta, setMeta] = useState<DocMeta>({})
  const [hfOpen, setHfOpen] = useState(false)
  // 样式表面板（v0.106）：清单在 meta.styles 上，编辑即回写——渲染层与导出共用这一份
  const [styleEdOpen, setStyleEdOpen] = useState(false)
  const [pgOpen, setPgOpen] = useState(false)
  const [docH, setDocH] = useState(0)
  const [cmOpen, setCmOpen] = useState(false)
  const [draft, setDraft] = useState<{ cid: number; text: string } | null>(null)
  const [noteDraft, setNoteDraft] = useState<{ kind: NoteKind; text: string } | null>(null)
  // 边框的待用档位（线型/磅/颜色）：点哪条边才把它写下去，所以这一份不进文档、只是工具条上的"笔"
  const [bdSel, setBdSel] = useState({ style: 'solid', pt: 0.5, hex: '#000000' })
  // 条件层面板（v0.116）：一次只放行一枚表样式，挑部位的下拉也算这一层的小状态
  const [condOpenId, setCondOpenId] = useState<string | null>(null)
  const [condType, setCondType] = useState<TableCondType>('firstRow')
  const [, setTick] = useState(0)
  const [frOpen, setFrOpen] = useState(false)
  const [frQ, setFrQ] = useState('')
  const [frCs, setFrCs] = useState(false)
  // 拼写检查：开关与"我的词典"的展示份。词典本身住在 spell.ts（localStorage），
  // 这里存一份只为面板上能列出并撤掉
  const [spellOn, setSpellOn] = useState(false)
  // —— 实时协同：会话对象、状态、面板开关。房间名默认跟着文件路径走，
  // 同一份文档的两个实例因此自动进同一间；也可以手改成别的（换名字就是换房间）
  const [collabOpen, setCollabOpen] = useState(false)
  const [collab, setCollab] = useState<CollabStatus>({
    state: 'off',
    room: '',
    port: 0,
    peers: [],
    error: '',
  })
  const [collabRoom, setCollabRoom] = useState('')
  const collabRef = useRef<CollabSession | null>(null)
  const defaultRoom = () => tab.path || tab.title || '未命名文档'
  const [myDict, setMyDict] = useState<string[]>(() => spellIgnored())
  // 全量词典那一档：词表 2.8MB，第一次按才下载，所以界面上得把"加载中/拉不到"说清楚
  const [dictState, setDictState] = useState(() => spellDictState())
  const [deep, setDeep] = useState(false)
  useEffect(() => onSpellDictChange(() => setDictState(spellDictState())), [])
  // 协同会话跟着这一页走：卸掉它就得把连接和我们起的中继一起收摊。
  // 标签是常驻挂载的，所以这一路主要在关标签/关窗口时跑——漏了它就是一个
  // 没人要的 WebSocket 和一个没人要的中继进程留在那儿
  useEffect(() => () => {
    collabRef.current?.dispose()
    collabRef.current = null
  }, [])
  // 宏：内置那几条每次都在（删不掉），自己写的那几条存 localStorage
  const [macros, setMacros] = useState<Macro[]>(() => loadMacros())
  const [macroOpen, setMacroOpen] = useState(false)
  const [macroSel, setMacroSel] = useState<string>('')
  const [macroCode, setMacroCode] = useState('')
  const [macroOut, setMacroOut] = useState<MacroRun | null>(null)
  // VBA 那一档：转译预览的开关。默认关着——大多数时候用户只想跑，不想看 JS
  const [vbaShow, setVbaShow] = useState(false)
  // 署名（协同的"我是谁"）：修订与批注都按它记作者
  const [who, setWho] = useState<string>(() => identityName())
  const [frRep, setFrRep] = useState('')
  const frInputRef = useRef<HTMLInputElement>(null)
  const [histOpen, setHistOpen] = useState(false)
  const [hist, setHist] = useState<{ t: number; note: string; json: string; metaJson: string }[]>([])
  // —— v0.173 文档结构图：只在打开时才遍历全文（关着时一次 doc.descendants 都不跑）
  const [navOpen, setNavOpen] = useState(false)
  // —— v0.173 格式刷：载荷与「待刷」状态分开。ref 是给 selectionUpdate / handleKeyDown
  // 这两个非 React 回调读的（effect 只订阅一次，不能把状态并进依赖里反复重挂）
  const [painter, setPainter] = useState<PaintFormat | null>(null)
  const [painterLocked, setPainterLocked] = useState(false)
  const painterRef = useRef<PaintFormat | null>(null)
  const painterLockedRef = useRef(false)
  const painterArmedRef = useRef<{ from: number; to: number } | null>(null)
  const paintingRef = useRef(false)
  // —— v0.174 视图缩放：只改屏上纸面，打印/导出 PDF 由 @media print 压回 100%
  const [zoom, setZoom] = useState(1)
  // —— v0.174 内容区右键菜单：位置是视口坐标，条目由 lib 的纯函数按选区/表格语境生成
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // —— v0.175 独立打印预览：同一棵 DOM 切到只读，不另画一份文档 ——
  const [previewOpen, setPreviewOpen] = useState(false)
  // v0.181：按等距页距翻页定位（非真分页）。targetRef 在程序化滚动期间挡住
  // onScroll 回写，免得 smooth scroll 的中间帧把页码一路改回起点
  const [previewPage, setPreviewPage] = useState(1)
  const previewTargetRef = useRef<number | null>(null)
  // —— v0.179 标尺：默认关（WPS 可开关），关着时一次刻度计算都不跑 ——
  const [rulerOn, setRulerOn] = useState(false)
  const rulerDragRef = useRef<RulerHandle | null>(null)
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null)
  // 收尾那句的时钟与表格头（v0.69）、PDF 头（v0.70）共用模块那一份：两份 1500/5000 就是两把尺子。
  // 进度门这一头不挂——v0.71 实测 .docx/.odt 原地保存整趟 30~92ms、write_file 自身 6~62ms，
  // 说出口就是一闪的噪音（同一枚 200ms 的门在表格大件那一路才有 366ms 的窗口可说）
  const doneRef = useRef<ReturnType<typeof saveDoneTimer> | null>(null)
  if (!doneRef.current) doneRef.current = saveDoneTimer(setStatus)
  const done = doneRef.current
  // 这一格上挂着的"这个文件没存上"那句：句子 + 它说的是哪个路径。
  // v0.73 只按身份比较撤"自己那一句"，于是手动 Ctrl+S 的失败句不归任何人撤——
  // v0.76 对照件（0.75 那支）实测：权限恢复后定时那一趟真的落盘了（● 也归 0），
  // 那句「保存失败: …」仍从 213961ms 挂到整窗末拍 470959ms（比落定晚 20,614ms）。
  // 规矩改成按路径认领：谁写的不要紧，只要它说的是**这个文件**没存上，而这个文件现在存上了，就该撤
  const saveFailRef = useRef<FailureClaim | null>(null)
  // 这一路的失败账与延迟吃模块那一份（两头同一套规矩，v0.75）：必须是**每枚标签一份**，
  // 做成模块级单例的话，A 件写坏了会把 B 件的时钟也推后——而标签是全部常驻挂载的（v0.68）
  const autoLedgerRef = useRef<ReturnType<typeof createAutoSaveLedger> | null>(null)
  if (!autoLedgerRef.current) autoLedgerRef.current = createAutoSaveLedger()
  const auto = autoLedgerRef.current
  // 「撤掉在途那枚时钟、按账重挂一枚」的通道，由下面那一路定时效果交出来（v0.75）。
  // 归零账只管下一枚延迟，而已经排上的那一枚最坏还要等 240 秒——用户刚按成一次 Ctrl+S，
  // 这时候把节奏拉回 30 秒才是他按下那一下的意思，所以手动成功那一路要连时钟一起重挂
  const autoRescheduleRef = useRef<(() => void) | null>(null)

  const editor = useEditor({
    // 扩展清单住在 lib/doc-schema.ts（v0.157）：组件与保真往返账共用同一份 schema，
    // 否则量具看到的是另一套 parseHTML 规则，账就成了假账
    extensions: docExtensions(),
    content: '<p></p>',
    onUpdate: () => markDirty(tab.id, true),
    editorProps: {
      attributes: { class: 'doc-content' },
      handleKeyDown: (view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !event.shiftKey) {
          event.preventDefault()
          setFrOpen(true)
          setTimeout(() => frInputRef.current?.focus(), 0)
          return true
        }
        // 修订模式下的删除键：转成删除线标记而不是真删（IME 组合中的退格不拦，那是输入法在改拼字）
        if (!event.isComposing && revModeOnState(view.state)) {
          const key = event.key
          const isBack = key === 'Backspace'
          const isDel = key === 'Delete'
          const isCut = (event.ctrlKey || event.metaKey) && key.toLowerCase() === 'x'
          if (isBack || isDel || isCut) {
            const { from, to, empty } = view.state.selection
            const range = !empty ? [from, to] : isBack && from > 0 ? [from - 1, from] : isDel ? [from, Math.min(from + 1, view.state.doc.content.size)] : null
            if (range) {
              const tr = deleteAsRevision(view.state, range[0], range[1])
              if (tr) {
                view.dispatch(tr)
                markDirty(tab.id, true)
                return true
              }
              // null：区间全是未定稿的插入（真删正好抵消）或纯段落缝（结构不追踪）——放行原生行为
            }
          }
        }
        return false
      },
      // 剪贴板里有图片文件（截图/文件管理器复制）时拦截为 base64 插图，压过 HTML 粘贴
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const it of items) {
          if (it.kind !== 'file' || !it.type.startsWith('image/')) continue
          const file = it.getAsFile()
          if (!file) continue
          event.preventDefault()
          const reader = new FileReader()
          reader.onload = () => {
            const type = view.state.schema.nodes.image
            if (!type) return
            view.dispatch(
              view.state.tr.replaceSelectionWith(type.create({ src: String(reader.result) })).scrollIntoView(),
            )
            markDirty(tab.id, true)
          }
          reader.readAsDataURL(file)
          return true
        }
        return false
      },
    },
  })
  if (import.meta.env.DEV && editor) {
    const w = window as unknown as Record<string, unknown>
    const map = (w.__oofDoc as Record<string, typeof editor> | undefined) ?? {}
    map[tab.id] = editor
    w.__oofDoc = map
    // 冒烟用：历史快照的推送/查看 + 页面设置直写与免对话框导出（箭头体在调用时才求值，避开 TDZ）
    const ctl = {
      push: (note: string) => pushHist(note),
      list: () => hist.map((h) => h.note),
      setMeta: (p: Partial<DocMeta>) => patchMeta(p),
      meta: () => meta,
      exportPdfTo: (path: string) => exportPdfTo(path),
      exportDocxTo: (path: string) => writeDocxTo(path, editor.getJSON() as PMNode),
      exportOdtTo: (path: string) => writeOdtTo(path, editor.getJSON() as PMNode),
      counts: () => counts,
      notes: () => notesOf(editor),
      insertNote: (kind: NoteKind, text: string) => editor.commands.insertNote(kind, text),
      // v0.87 分批喂那一路的三格可观测量：读全账、可编辑位、窗口内的程序化改动能不能活过批次
      whole: () => docIsWhole(),
      editable: () => editor.isEditable,
      dispatchEdit: () => editor.commands.insertContentAt(1, '探针'),
    }
    const byTab = (w.__oofDocCtlByTab as Record<string, typeof ctl> | undefined) ?? {}
    byTab[tab.id] = ctl
    w.__oofDocCtlByTab = byTab
    w.__oofDocCtl = ctl
  }

  // 生效页面设置：未显式设定走 A4 + 默认边距（与 converter 导出同一 resolve）
  const eff = resolvePage(meta.page)
  const pnPreview = pageNumberParts(meta.pageNumberFormat)
  const effPx = {
    w: eff.w * MM_PX,
    h: eff.h * MM_PX,
    top: eff.margin.top * MM_PX,
    bottom: eff.margin.bottom * MM_PX,
    left: eff.margin.left * MM_PX,
    right: eff.margin.right * MM_PX,
  }

  // 打印 @page 跟随页面设置；页眉/页脚/页码走 @page margin box，Chromium 会逐页重绘
  // （这份规则常驻 head：它既是本页打印的纸张声明，也是页眉页脚的宿主。代价是 PrintToPdf 真的会认
  //  CSS @page size（实测 WebView2 150），导过一次文档再导演示会得到文档那张竖版纸——
  //  所以覆盖层链路要自己把 @page 说全并复位 margin box，见 lib/pdfprint.ts 的 ownPageRule）
  useEffect(() => {
    let el = document.getElementById('oo-page-rule') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'oo-page-rule'
      document.head.appendChild(el)
    }
    const boxes: string[] = []
    const head = meta.headerText?.trim()
    if (head) boxes.push(`@top-center{content:${JSON.stringify(head)};font-size:9pt;color:#6b7280}`)
    const foot = meta.footerText?.trim()
    if (foot || meta.footerPageNumber) {
      // Blink 只吃空格串接的 content 片段，写成 "a" + counter(page) 会整条声明失效
      let expr = foot ? JSON.stringify(`${foot}${meta.footerPageNumber ? ' · ' : ''}`) : ''
      if (meta.footerPageNumber) {
        const pn = pageNumberParts(meta.pageNumberFormat)
        const seg: string[] = []
        if (pn.before) seg.push(JSON.stringify(pn.before))
        seg.push('counter(page)')
        if (pn.after) seg.push(JSON.stringify(pn.after))
        if (pn.total) seg.push('" / "', 'counter(pages)')
        expr += (expr ? ' ' : '') + seg.join(' ')
      }
      boxes.push(`@bottom-center{content:${expr};font-size:9pt;color:#6b7280}`)
    }
    // 首页另版那一层（b39 ODT 读侧）：只多立 `@page:first` 那一枝，缺的那一格回退基档而不复位
    // （实测 v0.54：`:first` 的排名高于基 `@page`，按框逐条比）。屏上那两条 .doc-hf 仍吃基档——
    // 屏幕是连续流，没有「首页」这一位，这一层只有纸能兑现。
    const firstBoxes: string[] = []
    const headFirst = meta.headerTextFirst?.trim()
    if (headFirst) firstBoxes.push(`@top-center{content:${JSON.stringify(headFirst)};font-size:9pt;color:#6b7280}`)
    const footFirst = meta.footerTextFirst?.trim()
    if (footFirst) firstBoxes.push(`@bottom-center{content:${JSON.stringify(footFirst)};font-size:9pt;color:#6b7280}`)
    el.textContent =
      `@media print { @page { size: ${eff.w}mm ${eff.h}mm; ` +
      `margin: ${eff.margin.top}mm ${eff.margin.right}mm ${eff.margin.bottom}mm ${eff.margin.left}mm;` +
      `${boxes.length ? ' ' + boxes.join(' ') : ''} } }` +
      (firstBoxes.length ? ` @media print { @page:first { ${firstBoxes.join(' ')} } }` : '')
  }, [
    eff.w,
    eff.h,
    eff.margin.top,
    eff.margin.right,
    eff.margin.bottom,
    eff.margin.left,
    meta.headerText,
    meta.footerText,
    meta.headerTextFirst,
    meta.footerTextFirst,
    meta.footerPageNumber,
    meta.pageNumberFormat,
  ])

  // 正文高度随事务/输入变化：分页参考线之"约 N 页"由它折算（观察包装 div，避开 view 未挂载期）
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setDocH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [editor])

  // 字数统计要遍历整篇文档：逐键重算在长文里会拖慢输入，改成节流刷新（首次立即、之后最小间隔）
  const [counts, setCounts] = useState({ words: 0, chars: 0 })
  useEffect(() => {
    if (!editor) return
    // v3 的 useEditor 是异步建实例的：effect 跑起来时 storage 里还没有 characterCount，
    // 直接取就抛（整棵 React 树被掀掉）。所以先订阅，再在 create 事件里补算一次。
    const run = () => {
      const cc = editor.storage.characterCount as
        | { words: () => number; characters: () => number }
        | undefined
      if (!cc) return
      setCounts({ words: cc.words(), chars: cc.characters() })
    }
    let timer = 0
    // 纯后缘节流：窗口内不重复遍历，窗口末尾一定补算一次，终值仍跟手
    const schedule = () => {
      if (timer) return
      timer = window.setTimeout(() => {
        timer = 0
        run()
      }, WORDS_THROTTLE_MS)
    }
    editor.on('update', schedule)
    editor.on('create', run)
    run()
    return () => {
      editor.off('update', schedule)
      editor.off('create', run)
      if (timer) clearTimeout(timer)
    }
  }, [editor])

  // 批注侧栏随文档变更刷新（锚点位置/孤儿判定）；查找面板计数/活动命中随选区刷新
  useEffect(() => {
    if (!editor) return
    const h = () => setTick((t) => t + 1)
    editor.on('update', h)
    editor.on('selectionUpdate', h)
    return () => {
      editor.off('update', h)
      editor.off('selectionUpdate', h)
    }
  }, [editor])

  // 格式刷（v0.173）：按下按钮记下源格式，之后用户拖选目标文字，松开即刷。
  // 双击按钮锁定连刷，Esc / 再点按钮退出。判据是「选区变了且非空」——捕获时那一枚
  // 选区不算目标，否则按按钮的同一刻就把源文字自己刷一遍。
  useEffect(() => {
    if (!editor) return
    const onSel = () => {
      const payload = painterRef.current
      if (!payload || paintingRef.current) return
      const { from, to, empty } = editor.state.selection
      if (empty) return
      const armed = painterArmedRef.current
      if (armed && from === armed.from && to === armed.to) return
      paintingRef.current = true
      try {
        const chain = editor.chain().focus()
        // 先清可刷的外观 mark 再重设：格式刷是「替换」不是「叠加」；身份型 mark
        // 不在清名单里，别人的批注/修订/书签不会被这一刷抹掉
        for (const name of paintableMarkNames(editor.state.schema)) chain.unsetMark(name)
        for (const m of marksForSchema(editor.state.schema, payload)) chain.setMark(m.type.name, m.attrs)
        if (payload.align) chain.setTextAlign(payload.align)
        chain.run()
        // 刚刷过的这一枚选区不再触发第二次（chain.focus 自己也会派发选区事件）
        painterArmedRef.current = { from, to }
        if (!painterLockedRef.current) {
          painterRef.current = null
          painterArmedRef.current = null
          setPainter(null)
        }
      } finally {
        paintingRef.current = false
      }
    }
    // Esc 收刷放在 window 上而不是 editorProps.handleKeyDown 里：待刷时焦点可能在
    // 工具条按钮上，编辑器的按键钩子接不到。只有这一处出口，不与别的 Esc 行为抢。
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !painterRef.current) return
      painterRef.current = null
      painterArmedRef.current = null
      painterLockedRef.current = false
      setPainter(null)
      setPainterLocked(false)
    }
    editor.on('selectionUpdate', onSel)
    window.addEventListener('keydown', onKey)
    return () => {
      editor.off('selectionUpdate', onSel)
      window.removeEventListener('keydown', onKey)
    }
  }, [editor])

  // 视图缩放（v0.174）：Ctrl+滚轮按档位走。监听挂在 .doc-scroll 而不是 window，
  // 免得别的标签/面板也跟着缩放；依赖 editor 是因为 useEditor 异步建实例，
  // 首次渲染时 ref 还没挂上 DOM，editor 到位后会重挂一次。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => zoomByWheel(z, e.deltaY))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [editor])

  // 右键菜单（v0.174）：点菜单外 / Esc 收起。菜单开着时才订阅，不常驻占事件
  useEffect(() => {
    if (!ctxMenu) return
    const off = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest('.doc-ctx-menu')) setCtxMenu(null)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null)
    }
    window.addEventListener('pointerdown', off)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', off)
      window.removeEventListener('keydown', key)
    }
  }, [ctxMenu])

  // 打印预览（v0.175）：切只读 + Esc 退出。标签常驻期间 previewOpen 回 false
  // 会自动恢复可编辑；组件卸载时 editor 实例一并销毁，不必手动复位。
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!previewOpen)
  }, [editor, previewOpen])

  useEffect(() => {
    if (!previewOpen) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewOpen(false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [previewOpen])

  // v0.181：打开预览时页码跟着当前滚动量走（文档可能已经被滚到中段）；
  // 退出时清掉程序化滚动的目标，别让残留影响下一次
  useEffect(() => {
    if (!previewOpen) {
      previewTargetRef.current = null
      return
    }
    const top = scrollRef.current?.scrollTop ?? 0
    setPreviewPage(clampPage(
      pageOfScrollTop(top, effPx.h, zoom, effPx.top),
      estimatePages(docH, effPx.h, effPx.top, effPx.bottom),
    ))
  }, [previewOpen])

  // —— 分批喂那一路的"读全"账（v0.87）——
  // 形状照 v0.81 那四条规矩：按**这一趟载入的身份**记而不是布尔、持有在 ref 里、失败不记账、全仓不销账。
  // 为什么这格必须是闸门：28029 块的件分批喂要吃 1097ms，其间屏上已经有半份文档，
  // 而 Ctrl+S / 导出 / 自动保存读的是 editor.getJSON() ⇒ 拿到的就是那半份，写出去直接覆盖盘上的全文
  // （改前不是没有这一格——改前是"一次跳到位"，所以没有中间态；引入分批就等于引入中间态，闸门是它的对价）。
  // 失败那一路同一条通道买的东西：载入失败的件今天也能按 Ctrl+S，把半份（其实是空份）写回原文件。
  interface LoadRun {
    started: number
  }
  const loadRunRef = useRef<LoadRun | null>(null)
  const loadReadRef = useRef<LoadRun | null>(null)
  // 谁把 editable 关掉的：只许由同一趟放开（被作废的旧趟不许把活着一趟的输入闸打开）
  const editableRunRef = useRef<LoadRun | null>(null)

  // 只有当前这趟载入被记过账才算读全；refs 都为 null（editor 还没建好）时判"没读全"，宁可拒也不抹
  const docIsWhole = () => loadRunRef.current !== null && loadReadRef.current === loadRunRef.current
  const refuseUnread = () => {
    if (docIsWhole()) return false
    setStatus('文档还没读全（正在读取或读取失败），现在存出去的是半份文档')
    return true
  }
  const releaseEditable = (run: LoadRun) => {
    if (editableRunRef.current === run) {
      editableRunRef.current = null
      editor?.setEditable(true, false)
    }
  }

  useEffect(() => {
    if (!editor) return
    let disposed = false
    const run: LoadRun = { started: Date.now() }
    loadRunRef.current = run
    // 一处出口决定两件事：这份内容够不够大要分批，以及分批时先把输入闸关上。
    // 单片那一路原样保留今天的形状（连 emitUpdate 的默认值都不动），闸门也就不碰它。
    const applyContent = async (src: FeedSource, hint?: number) => {
      const plan = planFeed(src, hint)
      if (!plan) {
        editor.commands.setContent(src.kind === 'html' ? src.html : src.doc, { emitUpdate: src.emitUpdate })
        return
      }
      // 认领按"最后走进分批的那一趟"算：被作废的旧趟不许在活着一趟还在喂的时候把闸放开
      editableRunRef.current = run
      editor.setEditable(false, false)
      await runFeed(editor, plan, src, () => disposed || loadRunRef.current !== run)
    }
    ;(async () => {
      if (!tab.path) {
        if (tab.template) {
          const t = docTemplate(tab.template)
          editor.commands.setContent(t.content)
          setMeta(t.meta)
          markDirty(tab.id, false)
        }
        loadReadRef.current = run
        setStatus('')
        return
      }
      try {
        let note = ''
        if (tab.path.toLowerCase().endsWith('.docx')) {
          const bytes = await readBytes(tab.path)
          // v0.180：meta 与保真读手共用一次解包、一份部件文本缓存
          const zipSession = await openDocxZip(bytes)
          const m = await docxToDocMeta(bytes, zipSession)
          // 保真导入器直接读 OOXML 的 pPr/rPr，样式还原度远高于 mammoth；
          // 但它覆盖面有限（认不出的构造会漏），所以抛错或一块都没拆出来时退回 mammoth。
          let fid: DocxImport | null = null
          try {
            // 只在真的打开 .docx 时才拉这个模块，别把它塞进编辑器 chunk 的常驻体积里
            const { docxToHtmlFidelity } = await import('../lib/docx-fidelity')
            const r = await docxToHtmlFidelity(bytes, 0, zipSession)
            if (r.blocks > 0) fid = r
          } catch (e) {
            console.warn('docx 保真导入失败，回退 mammoth', e)
          }
          if (!disposed) {
            if (fid) {
              await applyContent({ kind: 'html', html: fid.html, emitUpdate: true }, fid.blocks)
              // 样式清单随 meta 走（v0.102）：.odoc 的 metaJson 存它，导出 docx 也从 meta 拿
              setMeta({
                ...m,
                ...(fid.styles?.length ? { styles: fid.styles } : {}),
                // 潜在样式（v0.146）：Word 样式库门面账，只往返不屏现
                ...(fid.latentStyles ? { latentStyles: fid.latentStyles } : {}),
                // 编号定义账（v0.150）：nsid/tmpl/multiLevelType 与逐层三枚，只往返
                ...(fid.numbering ? { numbering: fid.numbering } : {}),
                // 节属性（v0.147）：读手走 attr 漏斗读的那一遍为准，覆盖 docxToDocMeta
                // 的正则读数（同一份数两处读迟早分叉，读手这一遍是保真账本认的那条）
                ...(fid.section ? { page: { ...m.page, ...pageSetupOf(fid.section) } } : {}),
                // 文档背景（v0.155）：整篇底色，随 meta 持久化、导出回到 document 根
                ...(fid.background ? { background: fid.background } : {}),
                ...(fid.comments.length ? { comments: fid.comments } : {}),
              })
              if (fid.comments.length) setCmOpen(true)
              if (fid.warnings.length)
                note = `保真导入：${fid.warnings.length} 项未保留（${fid.warnings[0]}${fid.warnings.length > 1 ? '…' : ''}）`
            } else {
              const baseHtml = await docxToHtml(bytes)
              const { html, comments } = await docxToCommentHtml(bytes, baseHtml)
              await applyContent({ kind: 'html', html, emitUpdate: true })
              setMeta(comments.length ? { ...m, comments } : m)
              if (comments.length) setCmOpen(true)
            }
          }
        } else if (tab.path.toLowerCase().endsWith('.odt')) {
          const bytes = await readBytes(tab.path)
          const { html, meta: m, warnings } = await odtToHtml(bytes)
          if (!disposed) await applyContent({ kind: 'html', html, emitUpdate: false })
          if (!disposed && Object.keys(m).length) setMeta(m)
          if (!disposed && m.comments?.length) setCmOpen(true)
          // 与 docx 那条同一套边界账：文字类构件（文本框、公式）展平时在这里说清楚，不静默
          if (warnings.length)
            note = `ODT 导入：${warnings.length} 项未保留（${warnings[0]}${warnings.length > 1 ? '…' : ''}）`
        } else {
          const text = await readText(tab.path)
          const parsed = JSON.parse(text) as { content?: PMNode; meta?: DocMeta }
          if (!disposed) {
            const doc = parsed.content ?? { type: 'doc', content: [] }
            await applyContent({ kind: 'json', doc, emitUpdate: true }, (doc.content ?? []).length)
            setMeta(parsed.meta ?? {})
            if (parsed.meta?.comments?.length) setCmOpen(true)
          }
        }
        // 记"读全"的账只发给当前这一趟：被作废的旧趟（StrictMode 双挂载 / 换件）不许替新趟开门，
        // 而失败那一趟根本走不到这里（catch 不记账）
        if (!disposed && loadRunRef.current === run) {
          setStatus(note)
          markDirty(tab.id, false)
          loadReadRef.current = run
        }
      } catch (e) {
        console.error(e)
        setStatus(failStatus(e, '加载失败'))
      } finally {
        releaseEditable(run)
      }
    })()
    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, tab.id])

  // 只负责"把这份内容写成那个文件"：不替界面决定说什么，也不替标签记账。
  // v0.71 之前这两句挂在写手身上，于是「导出 docx」那一路也说「已保存（docx）」，
  // 而 .docx 标签按 Ctrl+S 走同一个写手 ⇒ 文件真写进去了、标签的 ● 却还挂着（界面自相矛盾）
  const writeDocxTo = async (path: string, json: PMNode) => {
    const bytes = await prosemirrorToDocxBytes(json, meta)
    await writeBytes(path, bytes)
    markRecent(path, 'doc')
  }

  const writeOdtTo = async (path: string, json: PMNode) => {
    const bytes = await prosemirrorToOdtBytes(json, meta)
    await writeBytes(path, bytes)
    markRecent(path, 'doc')
  }

  const saveOdoc = async (asNew: boolean) => {
    if (!editor) return
    // 读全闸门（v0.87）：分批喂的中间态与载入失败那一路都还没有"这份文档是完整的"的账，
    // 而这一趟读的是 editor.getJSON() ⇒ 不拦就是拿半份（或空份）覆盖盘上的全文
    if (refuseUnread()) return
    const cur = tab.path
    // .odt / .docx 标签的 Ctrl+S 原地按各自格式导出，不能把 JSON 存档写进 Office 扩展名
    const inPlace = !asNew && cur && /\.(odt|docx)$/i.test(cur) ? cur : ''
    done.cancel()
    // 这一趟要写的到底是哪个文件——失败那句得按路径认领，所以它得活到 catch 里
    let target: string | undefined
    try {
      let path = inPlace || (asNew ? undefined : cur)
      if (!path) {
        const name = tab.path ? baseName(tab.path) : tab.title || '未命名文档'
        path = (await pickSaveFile(name.replace(/\.docx$/i, '') + '.odoc', ['odoc'])) ?? undefined
        if (!path) return
      }
      target = path
      const json = editor.getJSON() as PMNode
      if (inPlace) {
        await (/\.odt$/i.test(inPlace) ? writeOdtTo(inPlace, json) : writeDocxTo(inPlace, json))
      } else {
        await writeText(path, JSON.stringify({ ...ODOC_HEADER, content: json, meta }))
        markRecent(path, 'doc')
        pushHist('保存')
      }
      // 落盘成功才记这笔账：renameTab 里带 dirty:false，标签的 ● 从此与文件一致
      // （v0.63 起 .odoc 那一路就是这么记的，本轮把原地 Office 那两档并进来）
      renameTab(tab.id, baseName(path), path)
      // 用户自己按成功了 ⇒ 退避归零并撤掉在途的那一枚，定时那一路立刻回到 30 秒的节奏（v0.75）。
      // 这一趟不算进自动保存的次数账：那句「已自动保存」说的只能是真的自动保存过
      auto.clearBackoff()
      autoRescheduleRef.current?.()
      // 文件现在真的在盘上了 ⇒ 这一格上不再欠任何一句"没存上"（包括上一回定时留下的那句）
      saveFailRef.current = null
      done.show([])
    } catch (e) {
      // 失败那句顶掉上一句，原话留在悬停 title 里（v0.64 的规矩）；
      // 不再弹阻塞式原生模态：v0.71 实测那枚 #32770 要把 Tauri 主线程占到用户点 OK 为止。
      // 登记的这一句要带上它说的是哪个文件：只有"同一个文件后来存上了"才有谁去撤它的资格（v0.76）
      done.cancel()
      const msg = failStatus(e, '保存失败')
      saveFailRef.current = { msg, path: target ?? '' }
      setStatus(msg)
    }
  }

  const saveRef = useRef(saveOdoc)
  saveRef.current = saveOdoc
  useEffect(() => registerSaver(tab.id, (asNew) => saveRef.current(asNew)), [tab.id])

  // 「导出 docx / 导出 odt」是另拷一份出去，不替标签记「已保存」的账：
  // 所以这一路说「已导出 X」且不清 ● —— 与演示头的「已导出 pptx」同一个说法（v0.71 之前它说的是「已保存（docx）」）
  const exportAs = async (ext: 'docx' | 'odt') => {
    if (!editor) return
    if (refuseUnread()) return
    const path = await pickSaveFile(
      (tab.path ? baseName(tab.path).replace(/\.[^.]+$/, '') : '未命名文档') + `.${ext}`,
      [ext],
    )
    if (!path) return
    try {
      await (ext === 'docx' ? writeDocxTo(path, editor.getJSON() as PMNode) : writeOdtTo(path, editor.getJSON() as PMNode))
      done.show([], `已导出 ${ext}`)
    } catch (e) {
      await message(failDialog(e), { title: `导出 ${ext} 失败`, kind: 'error' })
    }
  }

  const exportDocx = () => exportAs('docx')
  const exportOdt = () => exportAs('odt')

  // WebView2 原生 PrintToPdf：主窗口按 @media print 样式矢量落盘，需当前文档标签处于激活态
  const exportPdfTo = async (path: string) => {
    setStatus('正在生成 PDF…')
    // 纸张与四边距两处同说：PrintSettings（本函数）+ CSS @page（上面那份常驻规则），值都从 eff 来
    const mm2in = (v: number) => v / 25.4
    await invoke('export_pdf', {
      filePath: path,
      page: [mm2in(eff.w), mm2in(eff.h)],
      margins: [mm2in(eff.margin.top), mm2in(eff.margin.right), mm2in(eff.margin.bottom), mm2in(eff.margin.left)],
    })
  }

  const exportPdf = async () => {
    if (refuseUnread()) return
    try {
      const path = await pickSaveFile(
        (tab.path ? baseName(tab.path).replace(/\.[^.]+$/, '') : '未命名文档') + '.pdf',
        ['pdf'],
      )
      if (!path) return
      await exportPdfTo(path)
      markRecent(path, 'pdf')
      setStatus('已导出 PDF')
      setTimeout(() => setStatus(''), 1500)
    } catch (e) {
      setStatus('')
      await message(failDialog(e), { title: '导出 PDF 失败', kind: 'error' })
    }
  }

  const addImage = async () => {
    if (!editor) return
    const selected = await open({
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }],
    })
    if (typeof selected !== 'string') return
    try {
      const bytes = await readBytes(selected)
      let bin = ''
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
      }
      const ext = baseName(selected).split('.').pop()?.toLowerCase() ?? 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
      editor.chain().focus().setImage({ src: `data:${mime};base64,${btoa(bin)}` }).run()
    } catch (e) {
      await message(failDialog(e), { title: '插入图片失败', kind: 'error' })
    }
  }

  const addLink = () => {
    if (!editor) return
    const prev = editor.getAttributes('link').href as string | undefined
    setLinkDraft(prev ?? 'https://')
  }

  const applyLink = (href: string) => {
    if (!editor) return
    if (href === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    setLinkDraft(null)
  }

  const patchMeta = (p: Partial<DocMeta>) => {
    setMeta((m) => ({ ...m, ...p }))
    markDirty(tab.id, true)
  }

  /** 文档带进来的命名样式（v0.102 读侧 / v0.106 渲染层）：套用只挂标签，呈现走样式表 */
  const styleList = meta.styles ?? []
  const applyDocStyle = (info: DocxStyleInfo | null) => {
    if (!editor) return
    if (!info) {
      // 清除只摘标签：标题节点不转回段落（节点类型的变更交给用户，这里不越权）
      // 三个维度一起摘：下拉显示的是"优先那一个"，只摘它会让用户点掉之后下拉还显示着原文
      editor.chain().focus().setPstyle(null).setRStyle(null).setTableStyle(null).run()
      return
    }
    // 表样式（v0.114）：套到光标所在那张表，同样只挂标签不摊格式
    if (info.kind === 'table') {
      if (!editor.isActive('table')) {
        setStatus('表样式要套到表上：把光标放进表格再选')
        return
      }
      editor.chain().focus().setTableStyle(info.id).run()
      return
    }
    // 字符级样式（v0.113）：套到选区文字上，同样只挂标签不摊格式
    if (info.kind === 'character') {
      editor.chain().focus().setRStyle(info.id).run()
      return
    }
    const ch = editor.chain().focus()
    // 标题级样式转节点类型：编辑器里标题是节点类型而非属性，pStyle 由导出的 heading 分支
    // 承担（style 与 heading 并存会被库写出两枚 w:pStyle），所以标签这里反而要清掉
    if (info.level && info.level <= 4) {
      ch.setNode('heading', { level: info.level }).setPstyle(null).run()
      return
    }
    // 只挂标签、不摊格式（v0.106）：段落的对齐/行距/字号由样式表按标签统一渲染，
    // 改样式定义全文跟着变。段落上已有的直接格式（inline style）天然压过样式层——
    // 正是 Word「直接格式覆盖样式」的语义，套用不清用户手调的格式也不越权
    ch.setPstyle(info.id).run()
  }

  /** 样式定义回写：渲染层（<style> 注入）与导出（styles.paragraphStyles）吃的是同一份 meta.styles */
  const patchStyle = (id: string, p: Partial<DocxStyleInfo>) => {
    patchMeta({ styles: styleList.map((s) => (s.id === id ? { ...s, ...p } : s)) })
  }

  const addDocStyle = () => {
    const id = nextStyleId(styleList)
    patchMeta({ styles: [...styleList, { id, name: `新样式 ${id.slice(3)}`, run: {}, para: {} }] })
  }

  const addCharStyle = () => {
    const id = nextStyleId(styleList)
    patchMeta({ styles: [...styleList, { id, name: `新字符样式 ${id.slice(3)}`, kind: 'character', run: {}, para: {} }] })
  }

  const addTableStyle = () => {
    const id = nextStyleId(styleList)
    patchMeta({
      styles: [...styleList, { id, name: `新表格样式 ${id.slice(3)}`, kind: 'table', run: {}, para: {}, table: {} }],
    })
  }

  const removeDocStyle = (id: string) => {
    if (!editor) return
    const removed = styleList.find((s) => s.id === id)
    if (removed?.kind === 'table') {
      // 摘掉全文引用：表节点上的 tStyle 属性，样式没了还指着就悬空
      let count = 0
      const tr = editor.state.tr
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'table' && node.attrs.tStyle === id) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, tStyle: null })
          count++
        }
        return true
      })
      if (count) editor.view.dispatch(tr)
      patchMeta({ styles: styleList.filter((s) => s.id !== id) })
      if (count) setStatus(`已删除表格样式并摘除 ${count} 处引用`)
      return
    }
    if (removed?.kind === 'character') {
      // 摘掉全文的 rStyle 引用：样式没了还挂着 mark，屏幕失去呈现、导出也是悬空 w:rStyle
      let count = 0
      const tr = editor.state.tr
      editor.state.doc.descendants((node, pos) => {
        const m = node.marks.find((x) => x.type.name === 'rStyle' && x.attrs.id === id)
        if (m) {
          tr.removeMark(pos, pos + node.nodeSize, m.type)
          count++
        }
        return true
      })
      editor.view.dispatch(tr)
      patchMeta({ styles: styleList.filter((s) => s.id !== id) })
      if (count) setStatus(`已删除字符样式并摘除 ${count} 处引用`)
      return
    }
    // 摘掉全文引用：样式没了还挂着标签，屏幕失去呈现、导出也是悬空 pStyle——一起清干净
    const positions: Array<{ from: number; to: number }> = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.attrs.pStyle === id) {
        positions.push({ from: pos, to: pos + node.content.size })
      }
      return true
    })
    let chain = editor.chain().focus()
    for (const r of positions) chain = chain.setTextSelection(r).setPstyle(null)
    chain.setTextSelection(editor.state.selection.from).run()
    patchMeta({ styles: styleList.filter((s) => s.id !== id) })
    if (positions.length) setStatus(`已删除样式并摘除 ${positions.length} 处引用`)
  }

  const pg = meta.page ?? {}
  const setPg = (p: Partial<typeof pg>) => patchMeta({ page: { ...pg, ...p } })

  // 图片宽度按版心百分比设定；height 用当前显示比例换算，docx/odt 导出才能保形
  const setImageWidth = (pct: number) => {
    if (!editor) return
    const contentW = effPx.w - effPx.left - effPx.right
    const width = Math.round((contentW * pct) / 100)
    const dom = editor.view.dom.querySelector('img.ProseMirror-selectednode')
    const ratio =
      dom instanceof HTMLImageElement && dom.naturalWidth ? dom.naturalHeight / dom.naturalWidth : null
    editor
      .chain()
      .focus()
      .updateAttributes('image', { width, ...(ratio ? { height: Math.round(width * ratio) } : {}) })
      .run()
    markDirty(tab.id, true)
  }

  const setImageAlign = (align: string | null) => {
    if (!editor) return
    editor.chain().focus().updateAttributes('image', { align }).run()
    markDirty(tab.id, true)
  }

  const resetImage = () => {
    if (!editor) return
    editor.chain().focus().updateAttributes('image', { width: null, height: null, align: null }).run()
    markDirty(tab.id, true)
  }

  // 查找面板：查询词变更即重算命中（不碰文档，不触发 dirty）
  const frSetQuery = (q: string, cs = frCs) => {
    setFrQ(q)
    editor?.commands.setFindQuery(q, cs)
  }
  const frToggleCase = () => {
    const cs = !frCs
    setFrCs(cs)
    editor?.commands.setFindQuery(frQ, cs)
  }
  const frClose = () => {
    setFrOpen(false)
    // 关面板即清空查询：重开时输入框状态与插件命中状态不脱节
    setFrQ('')
    editor?.commands.setFindQuery('')
  }

  // —— 拼写检查 ——
  // 开的时候顺手扫一遍（插件 state 的 on 与命中一起落），关的时候把命中清空
  const toggleSpell = () => {
    if (!editor) return
    const next = !spellOn
    setSpellOn(next)
    editor.commands.setSpellCheck(next)
  }
  // 插件 state 是唯一真源：命中随文档变，不能把列表复制进 React state 再同步
  const spellState = editor ? spellPluginKey.getState(editor.state) : undefined
  const spellIssues: SpellIssue[] = spellOn ? spellState?.issues ?? [] : []
  const spellTruncated = spellOn && (spellState?.truncated ?? false)

  /** 把光标挪到那一处：选中整段，用户下一步直接打字就替换掉了 */
  const spellFocus = (i: SpellIssue) => {
    editor?.chain().focus().setTextSelection({ from: i.from, to: i.to }).run()
  }
  /** 采纳建议：选中替换。改完插件自己重扫（docChanged 那一路） */
  const spellApply = (i: SpellIssue) => {
    if (!editor || !i.suggest) return
    editor
      .chain()
      .focus()
      .setTextSelection({ from: i.from, to: i.to })
      .insertContent(i.suggest)
      .run()
    markDirty(tab.id, true)
  }
  const spellIgnoreOne = (i: SpellIssue) => {
    editor?.commands.ignoreSpell(i.text)
    setMyDict(spellIgnored())
  }
  /** 全量词典档的开关。词表没拉到就停在关——这一档缺了词典等于没有，不该假装开着 */
  const toggleDeep = async () => {
    if (!editor) return
    if (spellDeepOn()) {
      setSpellDeep(false)
      setDeep(false)
      editor.commands.rescanSpell()
      return
    }
    const st = await loadSpellDict()
    setDictState(st)
    // 下载是异步的：这中间用户可能切了页签，编辑器已经销毁就不能再派事务
    if (st === 'ready' && !editor.isDestroyed) {
      setSpellDeep(true)
      setDeep(true)
      editor.commands.rescanSpell()
    }
  }
  // —— 实时协同 ——
  /**
   * 开/关一次协同会话。
   *
   * 三态而不是两态，因为中间那一态（starting）也得能退出：连中继、
   * 跑握手这几百毫秒里用户改主意，点第二下就该收摊，不能等它自己成败。
   * error 态同样算"没在协同里"——点一下先收掉残句，再点才是重开。
   */
  const toggleCollab = async () => {
    if (!editor) return
    const cur = collabRef.current
    if (cur && collab.state !== 'off') {
      cur.stop()
      // stop() 自己会回调置 off；这里再补一次是防它已经 dispose 过（不会再回调），
      // 那时按钮会永远停在"退出"上
      setCollab({ state: 'off', room: '', port: 0, peers: [], error: '' })
      return
    }
    const room = collabRoom.trim() || defaultRoom()
    setCollabRoom(room)
    const session = new CollabSession(editor, setCollab)
    collabRef.current = session
    await session.start(room)
  }
  const toggleCollabPanel = () => {
    const next = !collabOpen
    setCollabOpen(next)
    // 第一次打开时把房间名填上默认值（跟着文件路径走）：两个实例打开同一份文件
    // 就该自动进同一间，不该要求用户先知道"房间"这个词
    if (next && !collabRoom.trim()) setCollabRoom(defaultRoom())
  }
  /** 对端标签：匿名时补上 clientID 尾巴，不然几个"匿名"在面板上分不清是谁 */
  const peerTag = (p: CollabPeer) => (p.name === '匿名' ? `匿名#${p.id}` : p.name)
  // —— 宏 ——
  const macroCurrent = macros.find((m) => m.id === macroSel) ?? null
  const macroOpenOne = (id: string) => {
    const m = macros.find((x) => x.id === id)
    if (!m) return
    setMacroSel(id)
    setMacroCode(m.code)
    setMacroOut(null)
  }
  const macroAdd = () => {
    const m = newMacro()
    // 内置的可以照着改：新建时把选中那条的代码带过来当起点
    if (macroCurrent) m.code = macroCurrent.code
    const next = [...macros, m]
    setMacros(next)
    saveMacros(next)
    macroOpenOne(m.id)
  }
  const macroSave = () => {
    const next = macros.map((m) => (m.id === macroSel ? { ...m, code: macroCode } : m))
    setMacros(next)
    saveMacros(next)
  }
  const macroDrop = (id: string) => {
    const next = macros.filter((m) => m.id !== id)
    setMacros(next)
    saveMacros(next)
    if (macroSel === id) {
      setMacroSel('')
      setMacroCode('')
    }
  }
  const macroRun = () => {
    if (!editor || !macroCurrent) return
    // VBA 与 JS 走同一条沙箱、同一份 api：认得出 VBA 骨架就先转译再跑
    if (looksLikeVba(macroCode)) {
      const res = runVba(macroCode, editor, setStatus, tab.path)
      setMacroOut(res)
      // 宏改了文档就得标脏：不然这一趟的改动会在切标签时悄悄没了
      if (res.changed) markDirty(tab.id, true)
      if (!res.ok) setStatus(`VBA 出错：${res.error ?? '未知原因'}`)
      return
    }
    const res = runMacro(macroCode, editor, setStatus)
    setMacroOut(res)
    // 宏改了文档就得标脏：不然这一趟的改动会在切标签时悄悄没了
    if (res.changed) markDirty(tab.id, true)
    if (!res.ok) setStatus(`宏出错：${res.error ?? '未知原因'}`)
  }
  /** 转译预览：VBA → JS 的产物摊开给人看。转译失败时把错也摊开 */
  const macroIsVba = looksLikeVba(macroCode)
  const vbaPreview = macroIsVba && vbaShow ? transpileVba(macroCode) : null
  /** 一条能跑的 VBA 样例：存成一条真宏，既能直接跑也能照着改 */
  const macroSampleVba = () => {
    const m = newMacro('VBA 示例')
    m.code = VBA_SAMPLE
    const next = [...macros, m]
    setMacros(next)
    saveMacros(next)
    macroOpenOne(m.id)
    setMacroOut(null)
    setVbaShow(true)
  }

  const spellForget = (w: string) => {
    spellUnignore(w)
    setMyDict(spellIgnored())
    // 撤掉一个忽略词后要重扫，否则那一段的波浪线要等下一次输入才回来
    editor?.commands.setSpellCheck(true)
  }

  // —— 自动保存与版本历史（会话内）：内容有变化才入栈，最多 20 份 ——
  const pushHist = (note: string) => {
    if (!editor) return
    // 快照吃的是同一份 getJSON()：读全之前存进来的快照就是一张半份文档的照片，
    // 而历史面板会把它当"某一时刻的真件"供人恢复（v0.87；60 秒那一枚定时自动走这里）
    if (!docIsWhole()) return
    const json = JSON.stringify(editor.getJSON())
    const metaJson = JSON.stringify(meta)
    setHist((h) => {
      const top = h[h.length - 1]
      if (top && top.json === json && top.metaJson === metaJson) return h
      return [...h.slice(-19), { t: Date.now(), note, json, metaJson }]
    })
  }
  const pushHistRef = useRef(pushHist)
  pushHistRef.current = pushHist
  const metaRef = useRef(meta)
  metaRef.current = meta

  useEffect(() => {
    if (!editor) return
    const iv = setInterval(() => {
      if (useApp.getState().tabs.some((t) => t.id === tab.id && t.dirty)) pushHistRef.current('自动快照')
    }, 60_000)
    return () => clearInterval(iv)
  }, [editor, tab.id])

  // .odoc 已落盘路径的自动保存（新/ foreign 路径不抢对话，走手动保存）。
  // 这一路的句子说的是「最近一次自动保存的结果」，不是收尾句：所以它不挂进度门、也不共用模块那枚
  // saveDoneTimer——v0.73 实测这一路写自身 5~8ms，两枚时钟周期之间的 30 秒才是它的常态，
  // 而那句失败的话要一直挂到下一次结果出来为止，1500ms 的收尾反而会把它抹掉。
  // v0.74 新增的约束：走 registry 的 runExclusive，与手动 Ctrl+S 共用同一把在途锁。
  // v0.75 换掉的是"隔多久再来一枚"：setInterval 没有退避（实测只读件 4 分钟敲 8 次、每次注定失败），
  // 改成自续的 setTimeout，延迟由这一路的账给；跳过与失败分开记（锁忙那一趟根本没跑，不算失败）。
  // v0.77 加的是"什么时候可以不等那一枚"：窗口重新拿到焦点 ⇒ 探一次（同一份 attempt、同一把锁、同一套句子）。
  useEffect(() => {
    if (!editor) return
    const p = tab.path
    if (!p?.toLowerCase().endsWith('.odoc')) return
    let stopped = false
    let timer: number | undefined
    // 这一路真正敲一次门的动作：定时那一枚与焦点探写共用同一份，区别只在"什么时候被允许跑"
    const attempt = async () => {
      // 读全闸门（v0.87，静默版）：这一路没有用户按下那一下要回应，说句子只会变成噪音；
      // 而它读的同样是 getJSON()——载入失败/还在分批喂的中间态放行的话，每 30 秒就覆盖一次盘上的全文
      if (!docIsWhole()) return
      const s = useApp.getState()
      if (!s.tabs.some((t) => t.id === tab.id && t.dirty)) return
      // v0.74 实测（三趟全重现）：这一路改前直接调 writeText、绕过 registry 的在途锁，
      // 于是"定时那枚写刚出门 + 手动 Ctrl+S"会同一毫秒各发一枚 write_text_file，
      // 旧快照往往最后落地——屏上「已保存」说了，文件里那半句新打的字没落。
      // 锁忙 ⇒ 本趟跳过（手动那趟的快照本来就更新、它落完就是最新内容存了盘），而跳过不进退避的账。
      await runExclusive(tab.id, async () => {
        // 真出门了才算"敲过门"：焦点探写的节流下界读这一枚（不脏就 return 的那一趟没有敲门，锁忙被跳过的也没有）
        auto.noteAttempt()
        try {
          await writeText(p, JSON.stringify({ ...ODOC_HEADER, content: editor.getJSON(), meta: metaRef.current }))
          s.markDirty(tab.id, false)
          auto.noteSuccess()
          setAutoSavedAt(new Date())
          // 撤掉这一格上"关于这个文件没存上"的那句（v0.73 只撤自己写的，v0.76 把认领做成按路径）：
          // 手动那句说的就是同一个路径，而它现在过期了；别的文件/别的动作的句子仍然不许抹
          // （v0.65 那条「迟到那一趟不许抹活着一趟」在这里没被改宽，只是认领范围对了）
          const stale = staleFailureClaim(saveFailRef.current, p)
          if (stale) {
            saveFailRef.current = null
            setStatus((cur) => (cur === stale ? '' : cur))
          }
        } catch (e) {
          // 失败仍然重试，但重试不再是唯一的动作：v0.73 实测改前这里 `catch {}`，
          // 于是上一轮那句「已自动保存 16:11:20」会在只读的件上一直挂到窗口关掉（写请求每 30 秒出一次门、
          // 一次都没落盘，而屏上还在报一个已经不真的时间）。状态栏非空顺手把那条过期的成功宣称挤掉。
          auto.noteFailure()
          const msg = autoFailStatus(e, auto.fails, autoDelayMs(auto.fails))
          saveFailRef.current = { msg, path: p }
          setStatus(msg)
        }
      })
    }
    const schedule = () => {
      timer = window.setTimeout(async () => {
        await attempt()
        if (!stopped) schedule()
      }, autoDelayMs(auto.fails))
    }
    schedule()
    // 交给手动存盘那一路：撤掉在途的这一枚，按当前的账重挂一枚
    // （只归零账不重挂的话，用户按成一次 Ctrl+S 之后定时那一路仍要等已经在途的那枚 240 秒）
    autoRescheduleRef.current = () => {
      if (stopped) return
      if (timer !== undefined) window.clearTimeout(timer)
      schedule()
    }
    // v0.77：窗口重新拿到焦点 ⇒ 立刻探一次，不等下一枚退避时钟。
    // 量的就是那一格最贵的代价：退避涨到 240 秒封顶之后，用户把权限改回来、切走又切回，
    // 屏上仍挂着「保存失败」而下一枚自动写在 4 分钟之外（v0.76 记下那条没做的"重新聚焦立刻再试"，
    // 当时判的是"页面里没有可用信号"——v0.77 前置实测①推翻了它：Alt+Tab 切回之后 `tauri://focus` 在 533ms 到，
    // 比 200ms 一把的 `document.hasFocus()` 轮询（那一拍 15291ms 才读到 true）还早；
    // 而真机上这一路的写与那一枚 focus 同一毫秒出门（Δ0ms），落定之后 13ms 那句「已自动保存」就上屏了。
    // 探写不造第二枚时钟：跑完仍然走 autoRescheduleRef 那一刀（撤掉在途的、按当前的账重挂一枚），
    // 而它失败时 `fails` 已经涨过 ⇒ 重挂出来的那枚只会更远，不会变成"明知不行还一直敲"。
    // 下界 AUTO_BASE_MS 由账给（实测最快的手动闪动是 3535ms 一枚，见 lib/auto-save.ts 的 canProbe）。
    const offFocus = onFocusBack(() => {
      if (stopped || !auto.canProbe()) return
      void attempt().then(() => autoRescheduleRef.current?.())
    })
    return () => {
      stopped = true
      autoRescheduleRef.current = null
      offFocus()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [editor, tab.path, tab.id])

  const restoreHist = (h: { json: string; metaJson: string; note: string }) => {
    if (!editor) return
    // 快照恢复是整片 setContent：读全之前放行等于拿一份不知道缺了哪里的旧快照盖掉正在读的那份
    if (refuseUnread()) return
    pushHist('恢复前')
    editor.commands.setContent(JSON.parse(h.json), { emitUpdate: false })
    setMeta(JSON.parse(h.metaJson) as DocMeta)
    markDirty(tab.id, true)
  }

  // 已有目录则滚动定位，否则在光标处插入（目录内容按标题实时汇总）
  const tocAction = () => {
    if (!editor) return
    let pos = -1
    editor.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === 'toc') pos = p
    })
    if (pos >= 0) {
      ;(editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    editor.chain().focus().insertContent({ type: 'toc' }).run()
    markDirty(tab.id, true)
  }

  const comments = meta.comments ?? []
  const nextCid = () => comments.reduce((m, c) => Math.max(m, c.id), 0) + 1

  const startComment = () => {
    if (!editor) return
    if (editor.state.selection.empty) {
      setStatus('请先在正文中选中要批注的文字')
      setTimeout(() => setStatus(''), 1800)
      return
    }
    const cid = nextCid()
    if (!addCommentMark(editor, cid)) return
    setDraft({ cid, text: '' })
    setCmOpen(true)
    markDirty(tab.id, true)
  }

  // 修订裁决：接受/拒绝。空选区管全文，有选区只动选区里的——逐段定稿时用选区
  const runRevision = (verdict: 'accept' | 'reject') => {
    if (!editor) return
    const n = verdict === 'accept' ? acceptRevisions(editor) : rejectRevisions(editor)
    if (!n) {
      setStatus('没有待裁决的修订标记')
      setTimeout(() => setStatus(''), 1800)
      return
    }
    markDirty(tab.id, true)
    setStatus(`已${verdict === 'accept' ? '接受' : '拒绝'} ${n} 处修订`)
    setTimeout(() => setStatus(''), 2400)
  }
  // 修订模式开关的镜像：按钮高亮跟着 React 态走，真实开关在插件状态里
  const [revOn, setRevOn] = useState(false)

  const confirmDraft = () => {
    if (!editor || !draft) return
    const text = draft.text.trim()
    if (!text) {
      removeCommentMark(editor, draft.cid)
      setDraft(null)
      return
    }
    const c: DocComment = { id: draft.cid, date: new Date().toISOString(), text }
    patchMeta({ comments: [...(meta.comments ?? []), c] })
    setDraft(null)
  }

  const cancelDraft = () => {
    if (!editor || !draft) return
    removeCommentMark(editor, draft.cid)
    setDraft(null)
  }

  const deleteComment = (cid: number) => {
    if (!editor) return
    removeCommentMark(editor, cid)
    patchMeta({ comments: (meta.comments ?? []).filter((c) => c.id !== cid) })
    if (draft?.cid === cid) setDraft(null)
  }

  const toggleResolved = (cid: number) => {
    patchMeta({
      comments: (meta.comments ?? []).map((c) => (c.id === cid ? { ...c, resolved: !c.resolved } : c)),
    })
  }

  const locateComment = (cid: number) => {
    if (!editor) return
    const anchor = findCommentAnchor(editor, cid)
    if (!anchor) {
      setStatus('该批注的原文已被删除')
      setTimeout(() => setStatus(''), 1800)
      return
    }
    const dom = editor.view.domAtPos(anchor.pos).node
    const el = dom instanceof HTMLElement ? dom : dom.parentElement
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const startNote = (kind: NoteKind) => {
    if (!editor) return
    setNoteDraft({ kind, text: '' })
  }

  const confirmNote = () => {
    if (!editor || !noteDraft) return
    const text = noteDraft.text.trim()
    const kind = noteDraft.kind
    setNoteDraft(null)
    // 空正文当作取消：与批注一致，避免正文里长出一枚没有内容的圈号
    if (!text) return
    if (!editor.chain().focus().insertNote(kind, text).run()) {
      setStatus('当前光标位置不能插入脚注/尾注')
      setTimeout(() => setStatus(''), 1800)
    }
  }

  if (!editor) return null
  const notes = notesOf(editor)
  const fr = frPluginKey.getState(editor.state)
  const frActive = fr && fr.matches.length ? activeIndexOf(fr, editor.state.selection.from, editor.state.selection.to) : -1
  const btn = (label: string, onClick: () => void, active = false, title?: string) => (
    <button
      key={label + title}
      className={`tb-btn${active ? ' tb-active' : ''}`}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  )

  // —— v0.181 打印预览翻页：页数口径与状态栏/预览条同源，页距换算住在 lib ——
  const totalPreviewPages = estimatePages(docH, effPx.h, effPx.top, effPx.bottom)
  const goPreviewPage = (delta: number) => {
    const p = clampPage(previewPage + delta, totalPreviewPages)
    const top = pageScrollTop(p, effPx.h, zoom, effPx.top)
    setPreviewPage(p)
    previewTargetRef.current = top
    scrollRef.current?.scrollTo({ top, behavior: 'smooth' })
  }

  // —— v0.180 可交互状态栏：条目表来自 lib 纯函数，这里只把 action 接到既有入口 ——
  const statusItems = statusBarItems({
    status,
    savedAtText: autoSavedAt ? autoSavedAt.toLocaleTimeString() : '',
    words: counts.words,
    chars: counts.chars,
    docH,
    pageH: effPx.h,
    marginTop: effPx.top,
    marginBottom: effPx.bottom,
    zoom,
    revOn,
    spellOn,
    previewOpen,
    histOpen,
  })
  const runStatus = (a: StatusBarAction) => {
    switch (a) {
      case 'openHistory': setHistOpen(true); break
      case 'togglePreview': setPreviewOpen((v) => !v); break
      case 'toggleRevision': setRevOn(toggleRevMode(editor)); break
      case 'toggleSpell': toggleSpell(); break
      case 'zoomOut': setZoom((z) => zoomStep(z, -1)); break
      case 'zoomIn': setZoom((z) => zoomStep(z, 1)); break
      case 'zoomReset': setZoom(1); break
    }
  }

  // —— v0.173 文档结构图：关着时连一次 doc.descendants 都不跑 ——
  const outline = navOpen ? outlineOf(editor.state.doc) : []
  const activeOutline = navOpen ? activeOutlinePos(outline, editor.state.selection.from) : -1
  const jumpToHeading = (pos: number) => {
    const el = editor.view.nodeDOM(pos) as HTMLElement | null
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    try {
      editor.chain().focus().setTextSelection(pos + 1).run()
    } catch {
      /* 文档已变、pos 失效时只滚动 */
    }
  }

  // —— v0.173 格式刷：源格式取自当前光标/选区起点；应用发生在下一次拖选（见上面的 effect）
  const cancelPainter = () => {
    painterRef.current = null
    painterArmedRef.current = null
    painterLockedRef.current = false
    setPainter(null)
    setPainterLocked(false)
  }
  const armPainter = (locked: boolean) => {
    const { from, to } = editor.state.selection
    const payload = captureFormat(editor.state)
    painterRef.current = payload
    painterArmedRef.current = { from, to }
    painterLockedRef.current = locked
    setPainter(payload)
    setPainterLocked(locked)
  }
  const painterClick = () => {
    if (painterRef.current) cancelPainter()
    else armPainter(false)
  }

  // —— v0.174 右键菜单动作：只有这一处碰 editor；条目表在 lib 里是纯函数 ——
  const runCtx = async (id: string) => {
    setCtxMenu(null)
    if (!editor) return
    const chain = editor.chain().focus()
    switch (id) {
      case 'undo': chain.undo().run(); return
      case 'redo': chain.redo().run(); return
      case 'selectAll': chain.selectAll().run(); return
      case 'find':
        setFrOpen(true)
        setTimeout(() => frInputRef.current?.focus(), 0)
        return
      case 'painter': painterClick(); return
      // v0.183 清除格式：只摘字符外观 mark + 三个样式标签。身份型 mark 整列保留
      // （清掉批注/修订/书签/超链接是「删除标注」，不是「清除格式」），节点类型
      // 也不动（标题转段落交给用户）。名单与格式刷同源，抽在 lib 里可纯函数钉。
      case 'clearFormat': {
        for (const name of clearableMarkNames(editor.state.schema)) chain.unsetMark(name)
        chain.setPstyle(null).setRStyle(null).setTableStyle(null).run()
        return
      }
      case 'nav': setNavOpen((v) => !v); return
      case 'pageBreak': chain.insertPageBreak().run(); return
      case 'addRow': chain.addRowAfter().run(); return
      case 'deleteRow': chain.deleteRow().run(); return
      case 'cut':
      case 'copy': {
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, '\n')
        try {
          await navigator.clipboard.writeText(text)
          if (id === 'cut') editor.chain().focus().deleteSelection().run()
        } catch {
          setStatus('剪贴板不可用：请用系统快捷键 Ctrl+C / Ctrl+X')
          setTimeout(() => setStatus(''), 2400)
        }
        return
      }
      case 'paste': {
        try {
          const text = await navigator.clipboard.readText()
          // 走 text 节点而不是字符串：字符串会被当 HTML 解析，粘贴内容里的 '<' 会吞字
          editor.chain().focus().insertContent({ type: 'text', text }).run()
        } catch {
          setStatus('剪贴板不可用：请用系统快捷键 Ctrl+V')
          setTimeout(() => setStatus(''), 2400)
        }
        return
      }
      default:
        return
    }
  }

  // 缩放控件在工具条与打印预览条两处出现，定义一份，别让两串刻度走散
  // v0.187：自动缩放两档，与 PDF / Impress 共用 fitZoom。
  // 判断修正：v0.185 说「纸面固定版心，自动档没有新信息」偏保守——纸面宽确实固定，
  // 但**视口宽随侧栏开合与窗口大小变化**，适合页宽是有实际意义的一档。
  // Writer 是档位制下拉，落到最近一档，免得 select 里显示没有的百分比。
  const fitTo = (mode: FitMode) => {
    const host = scrollRef.current
    if (!host) return
    const z = fitZoom(effPx.w, effPx.h, host.clientWidth, host.clientHeight, mode)
    setZoom(nearestZoomStep(z))
  }

  const zoomControls = (
    <span className="doc-zoom" title="视图缩放：只改屏幕上的纸面，打印与导出 PDF 始终按 100% 出纸；也可在正文区按 Ctrl+滚轮">
      <button className="tb-btn" onClick={() => setZoom((z) => zoomStep(z, -1))} title="缩小一档">
        −
      </button>
      <select
        className="tb-select"
        value={String(zoom)}
        onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
      >
        {ZOOM_STEPS.map((s) => (
          <option key={s} value={s}>{zoomPct(s)}</option>
        ))}
      </select>
      <button className="tb-btn" onClick={() => setZoom((z) => zoomStep(z, 1))} title="放大一档">
        ＋
      </button>
      <button className="tb-btn" onClick={() => setZoom(1)} title="回到 100%">
        100%
      </button>
      <button className="tb-btn" onClick={() => fitTo('width')} title="适合页宽：按纸面宽铺满正文区">
        ↔
      </button>
      <button className="tb-btn" onClick={() => fitTo('page')} title="适合整页：纸面连高一起装下">
        ⤢
      </button>
    </span>
  )

  // —— v0.179 标尺：0 点在版心左边缘（不随纸面边距走），刻度与缩进换算都在 lib。
  // 关着时连一次刻度计算都不跑；打开时只读当前段落的三枚属性，不遍历全文。
  const rulerGeom = {
    contentWidthPx: Math.max(0, effPx.w - effPx.left - effPx.right),
    mmPx: MM_PX,
    maxIndentPx: 320, // 与 indent-extension 的 INDENT_MAX_PX 同源
  }
  const rulerTicksNow = rulerOn ? rulerTicks(rulerGeom) : []
  // 与「首行」按钮同一口径：paragraph 优先，heading 兜底（光标在标题里时前者为空）。
  // 不能用对象展开合并——heading 的空属性会把 paragraph 写过的值盖成 undefined
  const rulerPara = rulerOn ? editor.getAttributes('paragraph') : {}
  const rulerHead = rulerOn ? editor.getAttributes('heading') : {}
  const rulerMarks = rulerOn ? rulerIndentMarks({
    indentFirst: rulerPara.indentFirst ?? rulerHead.indentFirst ?? null,
    indentLeft: rulerPara.indentLeft ?? rulerHead.indentLeft ?? null,
    indentRight: rulerPara.indentRight ?? rulerHead.indentRight ?? null,
  }, rulerGeom) : null
  // 拖动换算：clientX 是缩放后的视口坐标，标尺刻度是未缩放的 CSS px，除以 zoom 折回去
  const rulerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const handle = rulerDragRef.current
    if (!handle || !rulerMarks) return
    const box = e.currentTarget.getBoundingClientRect()
    const atPx = (e.clientX - box.left) / zoom
    const next = rulerIndentFromDrag(handle, atPx, rulerMarks, rulerGeom)
    if (next) editor.chain().focus().setIndent(next).run()
  }
  const rulerHandle = (kind: RulerHandle, label: string, at: number) => (
    <span
      key={kind}
      className={`doc-ruler-handle doc-ruler-${kind}`}
      style={{ left: at }}
      title={label}
      onPointerDown={(e) => {
        e.preventDefault()
        rulerDragRef.current = kind
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerUp={() => { rulerDragRef.current = null }}
      onPointerCancel={() => { rulerDragRef.current = null }}
    />
  )

  const paraBorders = (edges: readonly CellEdge[], value: string | null) =>
    editor.chain().focus().setParaBorders(edges, value).run()
  const cellBorders = (edges: readonly CellEdge[], value: string | null) =>
    editor.chain().focus().setCellBorder(edges, value).run()

  /**
   * 边框那一行：先选线型/粗细/颜色，再点要加的边（点已着边的边＝取消这一边）。
   * 段落与单元格共用这一排，差别只在单元格多一枚「压掉」——表格自带一圈表级边框，
   * 要显式写成 'none'（导出 w:val="nil"）才盖得住，段落的边框在读侧已经摊进这一段名下。
   */
  const bdRow = (
    cur: (edge: CellEdge) => string | null,
    write: (edges: readonly CellEdge[], value: string | null) => void,
    suppress: boolean,
  ) => {
    const css = borderCss(bdSel.style, bdSel.pt, bdSel.hex)
    // 「着边」只看得到真线：'none' 是压掉，再点一次应当是把边框加上而不是清成未声明
    const on = (edge: CellEdge) => borderParts(cur(edge)) !== null
    const box = CELL_EDGES.every(on)
    return (
      <>
        <span className="tb-sep" />
        <select
          className="tb-select"
          value={bdSel.style}
          title="边框线型：先选它，再点要加的边"
          onChange={(e) => setBdSel({ ...bdSel, style: e.target.value })}
        >
          {BORDER_STYLES.map((o) => (
            <option key={o.css} value={o.css}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="tb-select"
          value={String(bdSel.pt)}
          title="边框粗细（磅，Word 边框对话框的那几档）"
          onChange={(e) => setBdSel({ ...bdSel, pt: Number(e.target.value) })}
        >
          {BORDER_WIDTH_PT.map((p) => (
            <option key={p} value={String(p)}>
              {p} 磅
            </option>
          ))}
        </select>
        <label className="tb-color" title="边框颜色">
          颜色
          <input type="color" value={bdSel.hex} onChange={(e) => setBdSel({ ...bdSel, hex: e.target.value })} />
        </label>
        {CELL_EDGES.map((edge) =>
          btn(
            EDGE_LABEL[edge],
            () => write([edge], on(edge) ? null : css),
            on(edge),
            `${on(edge) ? '取消' : '加上'}${EDGE_LABEL[edge]}的边框（线型/粗细/颜色按左边选的来）`,
          ),
        )}
        {btn(
          '四周',
          () => write(CELL_EDGES, box ? null : css),
          box,
          box ? '四条边的边框一次取消' : '四条边一起加上边框',
        )}
        {btn('清除', () => write(CELL_EDGES, null), false, '四条边都不再声明：段落回到无边，单元格落回表级边框或应用网格线')}
        {suppress &&
          btn('压掉', () => write(CELL_EDGES, 'none'), false, '四条边显式写「无」（导出 w:val="nil"）：盖掉表格自带的那圈边框')}
      </>
    )
  }

  return (
    <div className={`editor-pane${previewOpen ? ' is-preview' : ''}`}>
      {previewUi(previewOpen).showPreviewBar && (
        <div className="doc-preview-bar">
          <span className="doc-preview-title">打印预览 · 只读</span>
          {previewUi(previewOpen).showPager && (
            <span className="doc-preview-pager" title="按等距纸高翻页定位；表格/图片跨页等真分页行为由系统打印样式决定，屏幕不重排">
              <button className="tb-btn" disabled={previewPage <= 1} onClick={() => goPreviewPage(-1)} title="上一页">◀</button>
              <span className="doc-preview-pages">第 {previewPage} / {totalPreviewPages} 页（约）</span>
              <button className="tb-btn" disabled={previewPage >= totalPreviewPages} onClick={() => goPreviewPage(1)} title="下一页">▶</button>
            </span>
          )}
          <span className="tb-sep" />
          {zoomControls}
          <span className="tb-sep" />
          {btn('打印', () => window.print(), false, '调用系统打印：按 @media print 出纸，预览缩放不影响纸面')}
          {btn('导出 PDF', exportPdf, false, 'WebView2 原生 PrintToPdf：按打印样式矢量输出')}
          {btn('关闭预览', () => setPreviewOpen(false), false, 'Esc 也可退出，回到可编辑状态')}
        </div>
      )}
      <div className="editor-toolbar">
        {btn('保存', () => saveOdoc(false), false, 'Ctrl+S：原地写回当前文件（.docx/.odt 各按自己的格式，其余存 .odoc）')}
        {btn('另存为', () => saveOdoc(true))}
        {btn('导出 docx', exportDocx)}
        {btn('导出 odt', exportOdt, false, '导出 OpenDocument 文本（LibreOffice 系通用）')}
        {btn('目录', tocAction, false, '插入/定位目录：按标题实时汇总；导出为 Word 原生 TOC 域')}
        {btn('导航', () => setNavOpen((v) => !v), navOpen, '文档结构图：按标题 1-4 汇总，点击跳转，随编辑实时刷新')}
        {btn('分页符', () => editor.chain().focus().insertPageBreak().run(), false, 'Ctrl+Enter：打印与导出 PDF 时从此处另起一页（docx/odt 同步写分页）')}
        {btn('页眉页脚', () => setHfOpen((v) => !v), hfOpen || !!(meta.headerText || meta.footerText || meta.footerPageNumber), '设置页眉、页脚与页码')}
        {btn('页面设置', () => setPgOpen((v) => !v), pgOpen || !!meta.page, '纸张与页边距：同步应用到视图、打印与 docx/odt 导出')}
        {btn('批注', () => setCmOpen((v) => !v), cmOpen || comments.length > 0, '批注侧栏：选中文字后可添加批注，导出为 docx 原生批注')}
        {btn('新建批注', startComment, !!draft, '选中正文文字后点击，为其添加一条批注')}
        {btn('接受修订', () => runRevision('accept'), false, '接受修订（docx 修订/批注模式读入的 w:ins/w:del）：有选区只裁决选区内的，否则全文；插入文字转正、删除文字移除')}
        {btn('拒绝修订', () => runRevision('reject'), false, '拒绝修订：有选区只裁决选区内的，否则全文；插入文字移除、删除文字恢复')}
        {btn('修订模式', () => {
          if (!editor) return
          setRevOn(toggleRevMode(editor))
          setStatus(revModeOnState(editor.state) ? '修订模式已开：插入会标记为插入、删除变成删除线留原位' : '修订模式已关')
          setTimeout(() => setStatus(''), 2400)
        }, revOn, '本应用里改字留痕：开着时打字/粘贴标记为插入（w:ins），退格/删除/剪切变成删除线标记（w:del）；用上面的接受/拒绝定稿')}
        <label className="doc-who" title="署名：新打的修订与批注都用它标作者，往返 Word 后作者列显示它">
          署名
          <input
            className="tb-input doc-who-input"
            value={who}
            maxLength={40}
            placeholder="你的名字"
            onChange={(e) => setWho(e.target.value)}
            onBlur={() => {
              setIdentityName(who)
              setWho(identityName())
              setStatus(`署名已改为「${identityName()}」`)
              setTimeout(() => setStatus(''), 1800)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </label>
        {btn('脚注', () => startNote('footnote'), noteDraft?.kind === 'footnote', '在光标处插入脚注：正文写在文末脚注区，导出 docx/odt 为原生脚注')}
        {btn('尾注', () => startNote('endnote'), noteDraft?.kind === 'endnote', '在光标处插入尾注：编号与脚注各排各的')}
        {noteDraft && (
          <span className="tb-link-form" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              className="tb-input"
              style={{ width: 220 }}
              value={noteDraft.text}
              placeholder={`${NOTE_LABEL[noteDraft.kind]}正文，回车确定`}
              onChange={(e) => setNoteDraft({ ...noteDraft, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmNote()
                if (e.key === 'Escape') setNoteDraft(null)
              }}
            />
            <button className="tb-btn" onClick={confirmNote}>确定</button>
            <button className="tb-btn" onClick={() => setNoteDraft(null)}>取消</button>
          </span>
        )}
        {btn('查找替换', () => setFrOpen((v) => !v), frOpen, 'Ctrl+F 打开：查找、定位、替换')}
        {btn('历史版本', () => setHistOpen((v) => !v), histOpen, '会话内快照：每 60 秒自动留存，可一键恢复')}
        {btn('打印预览', () => setPreviewOpen((v) => !v), previewOpen, '独立打印预览：纸面转只读、可缩放、按等距页距翻页定位、可直接打印或导出 PDF；Esc 退出。屏幕不重排，真分页以打印样式为准')}
        {btn('打印 / PDF', () => window.print(), false, '调用系统打印，可选择另存为 PDF')}
        {btn('导出 PDF', exportPdf, false, 'WebView2 原生 PrintToPdf：按打印样式矢量输出，含高亮底色')}
      </div>
      <div className="doc-toolbar">
        <select
          value={
            editor.isActive('heading', { level: 1 }) ? 'h1'
              : editor.isActive('heading', { level: 2 }) ? 'h2'
              : editor.isActive('heading', { level: 3 }) ? 'h3'
              : editor.isActive('heading', { level: 4 }) ? 'h4'
              : 'p'
          }
          onChange={(e) => {
            const v = e.target.value
            editor.chain().focus().setParagraph().run()
            if (v !== 'p') editor.chain().focus().toggleHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 }).run()
          }}
          className="tb-select"
        >
          <option value="p">正文</option>
          <option value="h1">标题 1</option>
          <option value="h2">标题 2</option>
          <option value="h3">标题 3</option>
          <option value="h4">标题 4</option>
        </select>
        <select
          value={String(editor.getAttributes('textStyle').fontFamily ?? '')}
          onChange={(e) => {
            const v = e.target.value
            if (v) editor.chain().focus().setFontFamily(v).run()
            else editor.chain().focus().unsetFontFamily().run()
          }}
          className="tb-select"
          title="字体族（作用于选中文字）"
        >
          <option value="">默认字体</option>
          {FONT_FAMILIES.map(([label, css]) => (
            <option key={css} value={css}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={(() => {
            const raw = String(editor.getAttributes('textStyle').fontSize ?? '')
            const px = parseInt(raw, 10)
            if (!Number.isFinite(px) || raw === '') return ''
            const pt = px2pt(px)
            return FONT_SIZES_PT.includes(pt) ? String(pt) : ''
          })()}
          onChange={(e) => {
            const pt = Number(e.target.value)
            if (pt) editor.chain().focus().setFontSize(`${pt2px(pt)}px`).run()
            else editor.chain().focus().unsetFontSize().run()
          }}
          className="tb-select"
          title="字号 pt（作用于选中文字；导出 docx 按半点换算）"
        >
          <option value="">字号</option>
          {FONT_SIZES_PT.map((pt) => (
            <option key={pt} value={pt}>
              {pt}
            </option>
          ))}
        </select>
        <select
          value={String(spacingFromModel(editor.getAttributes('textStyle').letterSpacing))}
          onChange={(e) => {
            const pt = Number(e.target.value)
            // 0 也照样写串（"0pt"）：它是真值，ODT 那头靠它压掉样式层的间距；
            // 只有「未声明」才落 null
            editor.chain().focus().setMark('textStyle', { letterSpacing: spacingToModel(pt) }).run()
          }}
          className="tb-select"
          title="字符间距（Word「字体→高级→间距」）。写 docx 时按缇＝1/20 磅落 w:spacing；0 那一档 docx 写不下，等于回到样式默认"
        >
          <option value="">字距</option>
          {CHAR_SPACING_PT.map((pt) => (
            <option key={pt} value={pt}>
              {spacingLabel(pt)}
            </option>
          ))}
        </select>
        {btn('B', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), '加粗')}
        {btn('I', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), '斜体')}
        {btn('U', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), '下划线')}
        {btn('S', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'), '删除线')}
        {btn('X²', () => editor.chain().focus().toggleSuperscript().run(), editor.isActive('superscript'), '上标（Ctrl+.）')}
        {btn('X₂', () => editor.chain().focus().toggleSubscript().run(), editor.isActive('subscript'), '下标（Ctrl+,）')}
        <span className="tb-sep" />
        <label className="tb-color" title="字体颜色">
          字色
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(editor.getAttributes('color').color ?? '') ? editor.getAttributes('color').color : '#33383f'}
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
        </label>
        {btn('清色', () => editor.chain().focus().unsetColor().run())}
        {HL_COLORS.map((c) => (
          <button
            key={c}
            className={`tb-swatch${editor.getAttributes('highlight').color === c ? ' tb-active' : ''}`}
            style={{ background: c }}
            title="高亮"
            onClick={() =>
              editor.chain().focus().toggleHighlight({ color: c }).run()
            }
          />
        ))}
        {btn('清高亮', () => editor.chain().focus().unsetHighlight().run())}
        <span className="tb-sep" />
        {btn('左', () => editor.chain().focus().setTextAlign('left').run(), editor.isActive({ textAlign: 'left' }))}
        {btn('中', () => editor.chain().focus().setTextAlign('center').run(), editor.isActive({ textAlign: 'center' }))}
        {btn('右', () => editor.chain().focus().setTextAlign('right').run(), editor.isActive({ textAlign: 'right' }))}
        {btn('两', () => editor.chain().focus().setTextAlign('justify').run(), editor.isActive({ textAlign: 'justify' }))}
        {btn(
          '首行',
          () => {
            const cur = editor.getAttributes('paragraph').indentFirst ?? editor.getAttributes('heading').indentFirst
            editor.chain().focus().setIndent({ indentFirst: cur ? null : 32 }).run()
          },
          (editor.getAttributes('paragraph').indentFirst ?? editor.getAttributes('heading').indentFirst ?? 0) > 0,
          '首行缩进两个字符',
        )}
        {btn('缩进', () => editor.chain().focus().indent().run(), false, '整段增加缩进（Ctrl+]）')}
        {btn('退缩', () => editor.chain().focus().outdent().run(), false, '整段减少缩进（Ctrl+[）')}
        <span className="tb-sep" />
        {btn('• 列表', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
        {btn('1. 列表', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {btn('引用', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
        {btn('代码块', () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock'))}
        {btn('分隔线', () => editor.chain().focus().setHorizontalRule().run())}
        <span className="tb-sep" />
        {btn('插入图片', addImage)}
        {btn('链接', addLink, editor.isActive('link'))}
        {linkDraft !== null && (
          <span className="tb-link-form" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              className="tb-input"
              value={linkDraft}
              placeholder="https://…"
              onChange={(e) => setLinkDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyLink(linkDraft)
                if (e.key === 'Escape') setLinkDraft(null)
              }}
            />
            <button className="tb-btn" onClick={() => applyLink(linkDraft)}>确定</button>
            <button className="tb-btn" onClick={() => setLinkDraft(null)}>取消</button>
          </span>
        )}
        {btn('表格', () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
        {editor.isActive('table') && btn('删除表格', () => editor.chain().focus().deleteTable().run())}
        <span className="tb-sep" />
        {btn('撤销', () => editor.chain().focus().undo().run())}
        {btn('重做', () => editor.chain().focus().redo().run())}
        <span className="tb-sep" />
        <button
          key="format-painter"
          className={`tb-btn doc-painter-btn${painter ? ' tb-active' : ''}`}
          onClick={painterClick}
          onDoubleClick={() => armPainter(true)}
          title={'格式刷：先点一下取源格式，再拖选目标文字即刷上；双击可连续刷，Esc 或再点按钮退出。' +
            '只刷字符外观（粗斜、字色、高亮、字号等）与非默认对齐，不复制批注/书签/修订/超链接这些带身份的标记，也不搬缩进行距。'}
        >
          {painter ? (painterLocked ? '格式刷·连刷' : '格式刷·待刷') : '格式刷'}
        </button>
        {btn('清格式', () => void runCtx('clearFormat'), false,
          '清除格式：摘掉选区里的字符外观（粗斜、字色、高亮、字号等）与样式标签；' +
          '批注/书签/修订/超链接这类带身份的标记保留，标题节点也不转回段落。无选区时清的是后续输入格式')}
        {btn('拼写', toggleSpell, spellOn, '拼写检查：常见错拼、中文误用、重复字。开着会随输入重扫')}
        {btn('协同', toggleCollabPanel, collabOpen, '实时协同：同一房间名的多个实例一起改同一份文档，改动自动合并，不用互相锁')}
        {btn('宏', () => setMacroOpen((v) => !v), macroOpen, '脚本宏：一段 JS 操作这篇文档（只跑自己写的）')}
        {btn('标尺', () => setRulerOn((v) => !v), rulerOn, '水平/垂直标尺：0 点在版心左边缘，拖动三枚滑块改首行/左/右缩进；关着时不计算刻度')}
        <span className="tb-sep" />
        {zoomControls}
      </div>
      {editor.isActive('bulletList') && (
        <div className="doc-toolbar doc-bullet-bar">
          <span className="tb-label">符面</span>
          {BULLET_CHARS.map((c) => (
            <button
              key={c}
              className={`tb-btn tb-bullet${editor.getAttributes('bulletList').bulletChar === c ? ' tb-active' : ''}`}
              onClick={() => editor.chain().focus().updateAttributes('bulletList', { bulletChar: c }).run()}
              title={`用「${c}」当这一层的列表符（写 ODT 落 text:bullet-char）`}
            >
              {c}
            </button>
          ))}
          <input
            className="tb-input doc-num"
            placeholder="自定义"
            maxLength={4}
            value={String(editor.getAttributes('bulletList').bulletChar ?? '')}
            onChange={(e) => {
              const v = e.target.value.trim()
              editor.chain().focus().updateAttributes('bulletList', { bulletChar: v || null }).run()
            }}
            title="自定义符面（可多字符）。留空＝回到宿主默认圆点，不写进档里"
          />
          <span className="tb-sep" />
          <select
            value={String(editor.getAttributes('bulletList').bulletFont ?? '')}
            onChange={(e) =>
              editor.chain().focus().updateAttributes('bulletList', { bulletFont: e.target.value || null }).run()
            }
            className="tb-select"
            title="符面专用字体（ODF style:font-name / OOXML w:rFonts）。只记档里写的字体名，屏上仍照宿主默认画——这一层还没有 ::marker 出规则的地方"
          >
            <option value="">符面字体·默认</option>
            {FONT_FAMILIES.map(([label, css]) => (
              <option key={css} value={css}>
                {label}
              </option>
            ))}
          </select>
          {btn(
            '清符面',
            () =>
              editor
                .chain()
                .focus()
                .updateAttributes('bulletList', { bulletChar: null, bulletFont: null })
                .run(),
            false,
            '清掉自定义符面与符面字体，回到宿主默认',
          )}
        </div>
      )}
      {macroOpen && (
        <div className="doc-toolbar doc-macro-bar">
          <span className="tb-label">宏</span>
          <select
            className="tb-select"
            value={macroSel}
            onChange={(e) => macroOpenOne(e.target.value)}
            title="选一条宏。内置那几条删不掉，可以照着改出自己的"
          >
            <option value="">（选一条）</option>
            {macros.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.builtin ? '（内置）' : ''}
              </option>
            ))}
          </select>
          {btn('新建', macroAdd, false, '从选中的那条复制一份出来改')}
          {btn('VBA 样例', macroSampleVba, false, '填一条能跑的 VBA 宏当起点（Sub/With/Find/MsgBox 都在里面）')}
          {macroIsVba &&
            btn(vbaShow ? '藏起转译' : '看转译', () => setVbaShow((v) => !v), vbaShow, '把这段 VBA 转出来的 JS 摊开看')}
          {btn(
            macroIsVba ? '运行 VBA' : '运行',
            macroRun,
            false,
            macroIsVba
              ? '先转译成 JS 再跑（转译出错会连行号一起报出来）'
              : !macroCurrent
                ? '先选一条宏'
                : '跑一遍（跑的是文本框里那份代码）',
          )}
          {macroCurrent && (
            <>
              {btn('保存', macroSave, false, '把文本框里的代码存回这条宏')}
              {!macroCurrent.builtin &&
                btn('删除', () => macroDrop(macroCurrent.id), false, '删掉这条宏')}
            </>
          )}
          {macroSel && (
            <textarea
              className="doc-macro-code"
              spellCheck={false}
              value={macroCode}
              onChange={(e) => setMacroCode(e.target.value)}
              placeholder={
                macroIsVba
                  ? "' VBA 宏：Sub Main() … End Sub。可用的对象模型见「看转译」旁边的提示"
                  : '// 可用的东西都在 api 上：getText / insert / replaceAll / stats / log …'
              }
            />
          )}
          {macroIsVba && (
            <span className="tb-label doc-macro-vba">
              认出这是 VBA：会先转译成 JS 再跑。支持 Sub/Function、If/For/Do/Select/With、
              数组、字符串函数，以及 ActiveDocument / Selection / Range / Find 这一套对象模型；
              不支持 GoTo、类模块、二维数组——撞上了会报带行号的错
            </span>
          )}
          {vbaPreview && (
            <pre className={`doc-macro-pre${vbaPreview.ok ? '' : ' err'}`}>
              {vbaPreview.ok ? vbaPreview.code : `转译失败：${vbaPreview.error}`}
            </pre>
          )}
          {macroOut && (
            <div className={`doc-macro-out${macroOut.ok ? '' : ' err'}`}>
              {macroOut.log.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
              {!macroOut.ok && <div>出错：{macroOut.error}</div>}
              {macroOut.ok && !macroOut.log.length && <div>（跑完了，没输出）</div>}
            </div>
          )}
          <span className="tb-label doc-macro-warn">
            只跑自己写的宏：`new Function` 不是安全边界，来路不明的脚本能碰到这个页面上的东西
          </span>
        </div>
      )}
      {spellOn && (
        <div className="doc-toolbar doc-spell-bar">
          <span className="tb-label">
            {spellIssues.length ? `拼写 ${spellIssues.length} 处` : '拼写 没问题'}
          </span>
          {btn(
            dictState === 'loading' ? '词典…' : '全量词典',
            () => {
              void toggleDeep()
            },
            deep,
            dictState === 'failed'
              ? '词表没拉到（离线或资产缺失），全量词典这一档暂时用不了'
              : '英文全量词典（27.4 万词，第一次按才下载）：也会把人名、品牌、术语划上，误报点「忽略」加进我的词典',
          )}
          {spellTruncated && (
            <span className="tb-label" title="命中太多，只列前 1200 处；改完前面几处后面会补上">
              （只列了前 1200 处）
            </span>
          )}
          {!spellIssues.length && (
            <span className="tb-label">
              {deep
                ? '全量词典已开：英文查 27.4 万词，中文仍只有错写表与重复——中文的错字要分词加语言模型，这一版没有'
                : '这一版查的是常见错拼、中文误用与重复字，不是全词典检查——漏报是它的代价'}
            </span>
          )}
          <span className="doc-spell-list">
            {spellIssues.slice(0, 40).map((i) => (
              <span key={`${i.from}-${i.to}`} className="doc-spell-item">
                <button
                  className="doc-spell-word"
                  onClick={() => spellFocus(i)}
                  title={i.note}
                >
                  {i.text}
                </button>
                {i.suggest && (
                  <button
                    className="tb-btn tb-btn-mini"
                    onClick={() => spellApply(i)}
                    title={`改成「${i.suggest}」`}
                  >
                    →{i.suggest}
                  </button>
                )}
                <button
                  className="tb-btn tb-btn-mini"
                  onClick={() => spellIgnoreOne(i)}
                  title="加进我的词典，以后不划这一处"
                >
                  忽略
                </button>
              </span>
            ))}
          </span>
          {myDict.length > 0 && (
            <>
              <span className="tb-sep" />
              <span className="tb-label">我的词典</span>
              <span className="doc-spell-list">
                {myDict.slice(0, 20).map((w) => (
                  <button
                    key={w}
                    className="tb-btn tb-btn-mini"
                    onClick={() => spellForget(w)}
                    title="从我的词典里撤掉（× 一下就恢复检查）"
                  >
                    {w} ×
                  </button>
                ))}
              </span>
            </>
          )}
        </div>
      )}
      {collabOpen && (
        <div className="doc-toolbar doc-collab-bar">
          <span className="tb-label">房间</span>
          <input
            className="doc-collab-room"
            value={collabRoom}
            onChange={(e) => setCollabRoom(e.target.value)}
            // 连着的时候不许改名：换房间是另一场会话，改一半最让人误会
            disabled={collab.state !== 'off' && collab.state !== 'error'}
            placeholder="同名实例才会互见"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void toggleCollab()
              if (e.key === 'Escape') setCollabOpen(false)
            }}
          />
          {collab.state === 'on' || collab.state === 'starting' || collab.state === 'retrying'
            ? btn(
                collab.state === 'starting' ? '连接…' : collab.state === 'retrying' ? '重连…' : '退出',
                () => void toggleCollab(),
                collab.state === 'on',
                collab.state === 'retrying'
                  ? '连接断了，正在退避重连（间隔逐次翻倍，到 8 秒封顶）：这期间你的改动都还在本地，连上后会补齐给对面'
                  : '退出协同：摘掉协同插件、断开连接，文档回到单机编辑',
              )
            : btn(
                collab.state === 'error' ? '重试' : '开始',
                () => void toggleCollab(),
                false,
                '开始实时协同：本机没有中继时会自动起一个（仅监听 127.0.0.1）',
              )}
          {collab.state === 'retrying' && (
            <span className="doc-collab-note">连接断了，正在重连…（改动不会丢）</span>
          )}
          {collab.state === 'on' && (
            <>
              <span className="tb-sep" />
              <span className="tb-label" title="中继端口（127.0.0.1）：同一台机器上的实例自动互见，跨机器要改协议层">端口 {collab.port}</span>
              <span className="doc-collab-peers">
                <span className="doc-collab-me">
                  <i className="doc-collab-dot" style={{ background: authorColor(identityName()) }} />
                  {identityName()}（我）
                </span>
                {collab.peers.map((p) => (
                  <span key={p.id} className="doc-collab-peer" title={`clientID ${p.id}`}>
                    <i className="doc-collab-dot" style={{ background: p.color }} />
                    {peerTag(p)}
                  </span>
                ))}
              </span>
              <span className="tb-label">
                {collab.peers.length ? `房里 ${collab.peers.length + 1} 人` : '房里只有你'}
              </span>
            </>
          )}
          {collab.state === 'error' && collab.error && (
            <span className="doc-collab-err">{collab.error}</span>
          )}
          <span className="tb-label doc-collab-note">
            同步的是正文、段落字符属性、表格、图片与批注；页眉页脚等文档级状态不在内。
            撤销历史从开启那刻起算（之前的编辑不在协同的撤销栈里）
          </span>
        </div>
      )}
      {(editor.isActive('paragraph') || editor.isActive('heading')) && (
        <div className="doc-toolbar doc-para-bar">
          {(() => {
            // 光标所在段可能同时是标题，两种节点的属性各读一遍再合并（表格那条同理）
            const pa = { ...editor.getAttributes('paragraph'), ...editor.getAttributes('heading') }
            const lh = typeof pa.lineHeight === 'number' ? pa.lineHeight : 0
            const rule: '' | 'auto' | 'exact' | 'atLeast' = !lh ? '' : ruleOf(lh, String(pa.lineRule ?? '') as LineRule)
            // 界面上用「磅」，属性里存的是 CSS px（pt×4/3）：Word 的段落间距一向按磅给，别让用户换算
            const pt = (v: unknown) => (typeof v === 'number' ? Math.round(v * 0.75 * 10) / 10 : null)
            const toPx = (v: number) => Math.round(v * (4 / 3) * 100) / 100
            const sbPx = typeof pa.spaceBefore === 'number' ? pa.spaceBefore : null
            const saPx = typeof pa.spaceAfter === 'number' ? pa.spaceAfter : null
            const sides = (before: number | null, after: number | null) =>
              editor.chain().focus().setSpaceAround(before, after).run()
            const bg = /^#[0-9a-f]{6}$/i.test(String(pa.background ?? '')) ? String(pa.background) : '#fff2cc'
            const presets = ['', '1', '1.15', '1.5', '2']
            const off = rule === 'auto' && lh && !presets.includes(String(lh)) ? String(lh) : ''
            const sel = rule === 'exact' || rule === 'atLeast' ? rule : rule === 'auto' ? (off ? `x${lh}` : String(lh)) : ''
            // 当前段落的样式标签：heading 节点没挂 pStyle 时按层级映射显示（导出正是按 Heading N 写）
            const hl = editor.getAttributes('heading').level
            const curStyle =
              typeof pa.pStyle === 'string' && pa.pStyle
                ? pa.pStyle
                : editor.isActive('heading') && !pa.pStyle
                  ? `Heading${typeof hl === 'number' ? hl : 1}`
                  : ''
            const knownStyle = styleList.some((s) => s.id === curStyle)
            // 当前选区压着的字符样式：段落样式与字符样式是两个维度，字符优先展示
            const curRStyle = (editor.state.selection.$from.marks().find((m) => m.type.name === 'rStyle')?.attrs.id as string | undefined) ?? ''
            // 光标所在那张表的样式标签（v0.114）：三种身份是三个维度，展示优先级 字符 > 表格 > 段落
            const curTStyle = (String(editor.getAttributes('table').tStyle ?? '') || '') as string
            const paraStyles = styleList.filter((s) => s.kind !== 'character' && s.kind !== 'table')
            const charStyles = styleList.filter((s) => s.kind === 'character')
            const tableStyles = styleList.filter((s) => s.kind === 'table')
            return (
              <>
                {styleList.length > 0 && (
                  <>
                    <span className="editor-status">样式：</span>
                    <select
                      className="tb-select"
                      value={curRStyle || curTStyle || curStyle}
                      title="文档带进来的命名样式：套用只挂样式标签，呈现与导出由样式定义统一驱动（改定义全文跟着变）"
                      onChange={(e) => applyDocStyle(styleList.find((s) => s.id === e.target.value) ?? null)}
                    >
                      <option value="">（无样式）</option>
                      {/* heading 映射出来的 id 不在清单里时临时补一枚，别让下拉显示成空白 */}
                      {curStyle && !knownStyle && <option value={curStyle}>{curStyle}</option>}
                      <optgroup label="段落样式">
                        {paraStyles.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </optgroup>
                      {charStyles.length > 0 && (
                        <optgroup label="字符样式（套到选中文字）">
                          {charStyles.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {tableStyles.length > 0 && (
                        <optgroup label="表格样式（套到光标所在的表）">
                          {tableStyles.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </>
                )}
                <button
                  className="tb-btn"
                  title="样式表：查看/编辑文档的命名样式定义（字号、粗斜、颜色、对齐、行距、段距），改动全文即时生效并随存盘导出"
                  onClick={() => setStyleEdOpen(!styleEdOpen)}
                >
                  样式表{styleList.length ? ` (${styleList.length})` : ''}
                </button>
                <span className="editor-status">段落：</span>
                <select
                  className="tb-select"
                  value={sel}
                  title={`行距${lh ? ` ${rule === 'auto' ? `${lh} 倍` : `${pt(lh)} 磅`}` : '（默认）'}`}
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) editor.chain().focus().setParagraphStyle({ lineHeight: null, lineRule: null }).run()
                    // 固定值/最小值先给 18 磅（=24px），再用旁边的框调
                    else if (v === 'exact' || v === 'atLeast') editor.chain().focus().setLineSpacing(24, v).run()
                    else if (v.startsWith('x')) editor.chain().focus().setLineSpacing(Number(v.slice(1)), 'auto').run()
                    else editor.chain().focus().setLineSpacing(Number(v), 'auto').run()
                  }}
                >
                  <option value="">行距</option>
                  <option value="1">单倍</option>
                  <option value="1.15">1.15 倍</option>
                  <option value="1.5">1.5 倍</option>
                  <option value="2">2 倍</option>
                  {off && <option value={`x${lh}`}>{lh} 倍</option>}
                  <option value="exact">固定值…</option>
                  <option value="atLeast">最小值…</option>
                </select>
                {(rule === 'exact' || rule === 'atLeast') && (
                  <label className="doc-hf-field" title="绝对行距（磅）">
                    <input
                      className="tb-input doc-num"
                      type="number"
                      step="0.5"
                      min="1"
                      value={pt(lh) ?? ''}
                      onChange={(e) => {
                        const v = e.target.valueAsNumber
                        if (Number.isFinite(v) && v > 0) editor.chain().focus().setLineSpacing(toPx(v), rule).run()
                      }}
                    />
                    磅
                  </label>
                )}
                {[
                  { label: '段前', cur: sbPx, set: (v: number | null) => sides(v, saPx) },
                  { label: '段后', cur: saPx, set: (v: number | null) => sides(sbPx, v) },
                ].map(({ label, cur, set }) => (
                  <label key={label} className="doc-hf-field" title={`${label}间距（磅）；0 表示压掉样式里那段间距`}>
                    {label}
                    <input
                      className="tb-input doc-num"
                      type="number"
                      step="0.5"
                      min="0"
                      value={pt(cur) ?? ''}
                      onChange={(e) => {
                        const v = e.target.valueAsNumber
                        set(Number.isFinite(v) && v >= 0 ? toPx(v) : null)
                      }}
                    />
                    磅
                  </label>
                ))}
                {btn('无间距', () => sides(null, null), false, '清掉段前段后，回到样式默认')}
                {bdRow((edge) => (pa[bdAttr(edge)] as string | null) ?? null, paraBorders, false)}
                <span className="tb-sep" />
                <label className="tb-color" title="段落底纹（Word 的段落「字符底纹/底纹」，导出 docx/odt 带走）">
                  段落底纹
                  <input
                    type="color"
                    value={bg}
                    onChange={(e) => editor.chain().focus().setParaBackground(e.target.value).run()}
                  />
                </label>
                {btn('无底纹', () => editor.chain().focus().setParaBackground(null).run(), false, '清掉段落底纹')}
              </>
            )
          })()}
        </div>
      )}
      {editor.isActive('table') && (
        <div className="doc-toolbar doc-table-bar">
          {btn('↑行', () => editor.chain().focus().addRowBefore().run(), false, '在上方插入行')}
          {btn('↓行', () => editor.chain().focus().addRowAfter().run(), false, '在下方插入行')}
          {btn('←列', () => editor.chain().focus().addColumnBefore().run(), false, '在左侧插入列')}
          {btn('→列', () => editor.chain().focus().addColumnAfter().run(), false, '在右侧插入列')}
          {btn('删行', () => editor.chain().focus().deleteRow().run())}
          {btn('删列', () => editor.chain().focus().deleteColumn().run())}
          <span className="tb-sep" />
          {btn('合并', () => editor.chain().focus().mergeOrSplit().run(), false, '框选多格合并；点在已合并格上则拆分')}
          {btn('表头行', () => editor.chain().focus().toggleHeaderRow().run(), editor.isActive('tableHeader'))}
          <span className="tb-sep" />
          {(() => {
            // 光标所在那一列的精确宽度：可用宽 = 版心扣掉表级缩进（与 docx 写侧同一个数）
            const target = tableTargetPx(editor.state, contentPxOf(eff))
            const cur = target ? caretColumn(editor.state, target) : null
            if (!cur || !target) return null
            const commit = (raw: string) => {
              const px = Number.parseInt(raw, 10)
              if (!Number.isFinite(px) || px < 1) return
              editor.chain().focus().setGridColumnWidth(px, target).run()
            }
            return (
              <label
                className="doc-hf-field"
                key={`colw-${cur.col}-${cur.px}`}
                title={`这一列的宽度（px）：其余列按现有的账重排剩下的 ${target}px，导出 docx 就是这份网格`}
              >
                列宽
                <input
                  className="tb-input doc-num"
                  type="number"
                  min={1}
                  max={target}
                  defaultValue={cur.px}
                  onBlur={(e) => commit(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    commit((e.target as HTMLInputElement).value)
                    ;(e.target as HTMLInputElement).blur()
                  }}
                />
                px
              </label>
            )
          })()}
          <span className="tb-sep" />
          {(() => {
            // 光标所在格可能是 tableHeader（表头行），两种类型的属性都要读一遍
            const ca = { ...editor.getAttributes('tableCell'), ...editor.getAttributes('tableHeader') }
            const bg = /^#[0-9a-f]{6}$/i.test(String(ca.background ?? '')) ? String(ca.background) : '#f3f4f6'
            const va = String(ca.vAlign ?? '')
            return (
              <>
                <label className="tb-color" title="单元格底纹（Word 的「底纹」，导出 docx/odt 带走）">
                  底纹
                  <input
                    type="color"
                    value={bg}
                    onChange={(e) => editor.chain().focus().setCellBackground(e.target.value).run()}
                  />
                </label>
                {btn('无底纹', () => editor.chain().focus().setCellBackground(null).run())}
                {btn('顶端', () => editor.chain().focus().setCellVAlign(va === 'top' ? null : 'top').run(), va === 'top', '内容靠单元格上沿')}
                {btn('垂直居中', () => editor.chain().focus().setCellVAlign(va === 'middle' ? null : 'middle').run(), va === 'middle', '内容在单元格内垂直居中')}
                {btn('底部', () => editor.chain().focus().setCellVAlign(va === 'bottom' ? null : 'bottom').run(), va === 'bottom', '内容靠单元格下沿')}
                {bdRow((edge) => (ca[bdAttr(edge)] as string | null) ?? null, cellBorders, true)}
              </>
            )
          })()}
          <span className="tb-sep" />
          {btn('删除表格', () => editor.chain().focus().deleteTable().run())}
        </div>
      )}
      {editor.isActive('image') && (
        <div className="doc-toolbar doc-img-bar">
          <span className="editor-status">图片：</span>
          {[25, 50, 75, 100].map((p) =>
            btn(`${p}%`, () => setImageWidth(p), false, `宽度设为版心的 ${p}%（按选中型图片当前比例缩放）`),
          )}
          {btn('居中', () => setImageAlign('center'), editor.getAttributes('image').align === 'center')}
          {btn('恢复', resetImage, false, '清除宽高与对齐')}
        </div>
      )}
      {pgOpen && (
        <div className="doc-pg-panel">
          <label className="doc-hf-field">
            纸张
            <select
              className="tb-select"
              value={pg.size ?? 'A4'}
              onChange={(e) => {
                const v = e.target.value as 'A4' | 'Letter' | 'custom'
                if (v === 'custom') setPg({ size: 'custom', w: Math.round(eff.w * 10) / 10, h: Math.round(eff.h * 10) / 10 })
                else setPg({ size: v, w: undefined, h: undefined })
              }}
            >
              <option value="A4">A4（210×297mm）</option>
              <option value="Letter">Letter（216×279mm）</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          {(pg.size ?? 'A4') === 'custom' && (
            <>
              <label className="doc-hf-field">
                宽
                <input
                  className="tb-input doc-num"
                  type="number"
                  step="0.5"
                  value={Math.round(eff.w * 10) / 10}
                  onChange={(e) => Number.isFinite(e.target.valueAsNumber) && e.target.valueAsNumber > 0 && setPg({ w: e.target.valueAsNumber })}
                />
                mm
              </label>
              <label className="doc-hf-field">
                高
                <input
                  className="tb-input doc-num"
                  type="number"
                  step="0.5"
                  value={Math.round(eff.h * 10) / 10}
                  onChange={(e) => Number.isFinite(e.target.valueAsNumber) && e.target.valueAsNumber > 0 && setPg({ h: e.target.valueAsNumber })}
                />
                mm
              </label>
            </>
          )}
          <span className="tb-sep" />
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <label key={side} className="doc-hf-field">
              {{ top: '上', right: '右', bottom: '下', left: '左' }[side]}
              <input
                className="tb-input doc-num"
                type="number"
                step="0.5"
                value={Math.round(eff.margin[side] * 10) / 10}
                onChange={(e) =>
                  Number.isFinite(e.target.valueAsNumber) &&
                  e.target.valueAsNumber >= 0 &&
                  setPg({ margin: { ...eff.margin, [side]: e.target.valueAsNumber } })
                }
              />
            </label>
          ))}
          <span className="tb-sep" />
          <label className="doc-hf-field">
            分栏
            <select
              className="tb-select"
              value={String(eff.cols)}
              onChange={(e) => {
                const v = Number(e.target.value)
                setPg({ cols: v > 1 ? v : undefined, ...(v > 1 ? {} : { colGap: undefined }) })
              }}
            >
              <option value="1">不分栏</option>
              <option value="2">两栏</option>
              <option value="3">三栏</option>
            </select>
          </label>
          {eff.cols > 1 && (
            <label className="doc-hf-field">
              栏距
              <input
                className="tb-input doc-num"
                type="number"
                step="0.5"
                min="0"
                value={Math.round(eff.colGap * 10) / 10}
                onChange={(e) =>
                  Number.isFinite(e.target.valueAsNumber) &&
                  e.target.valueAsNumber >= 0 &&
                  setPg({ colGap: e.target.valueAsNumber })
                }
              />
              mm
            </label>
          )}
          {eff.cols > 1 && (
            <label
              className="doc-hf-field"
              title="Word 的不等宽分栏：逐栏宽按缇原值写回 w:col。屏上 CSS columns 只能等宽，这里只管 docx 往返"
            >
              不等宽
              <input
                type="checkbox"
                checked={!!eff.colsLayout?.widths?.length}
                onChange={(e) => {
                  if (!e.target.checked) {
                    setPg({ colsLayout: undefined })
                    return
                  }
                  const widths = eff.colsLayout?.widths?.length
                    ? eff.colsLayout.widths
                    : Array.from({ length: eff.cols }, () => ({
                        w: Math.round(((effPx.w - effPx.left - effPx.right) * 15) / eff.cols),
                      }))
                  setPg({ colsLayout: { equalWidth: false, widths } })
                }}
              />
            </label>
          )}
          {eff.cols > 1 && !!eff.colsLayout?.widths?.length && (
            <span className="doc-hf-field" title="缇原值，直接写回 w:col/@w:w；屏上仍按等宽显示">
              栏宽(缇)
              {eff.colsLayout!.widths!.map((c, i) => (
                <input
                  key={i}
                  className="tb-input doc-num"
                  type="number"
                  step="1"
                  min="1"
                  style={{ width: 72, marginRight: 4 }}
                  value={c.w}
                  onChange={(ev) => {
                    const v = ev.target.valueAsNumber
                    if (!Number.isFinite(v) || v <= 0) return
                    const widths = eff.colsLayout!.widths!.map((x, j) =>
                      j === i ? { ...x, w: Math.round(v) } : x,
                    )
                    setPg({ colsLayout: { ...eff.colsLayout, widths } })
                  }}
                />
              ))}
            </span>
          )}
          {meta.page && btn('重置', () => patchMeta({ page: undefined }), false, '恢复 A4 + 默认边距 + 不分栏')}
        </div>
      )}
      {frOpen && (
        <div className="doc-toolbar doc-fr-panel">
          <input
            ref={frInputRef}
            className="tb-input"
            placeholder="查找（回车下一个）"
            value={frQ}
            onChange={(e) => frSetQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.shiftKey ? editor.commands.findPrev() : editor.commands.findNext())
              if (e.key === 'Escape') frClose()
            }}
          />
          <span className="editor-status">
            {frQ
              ? fr && fr.matches.length
                ? `${frActive + 1}/${fr.matches.length}${fr.truncated ? '+' : ''}`
                : '无匹配'
              : ''}
          </span>
          {btn('Aa', frToggleCase, frCs, '区分大小写')}
          {btn('↑', () => editor.commands.findPrev())}
          {btn('↓', () => editor.commands.findNext())}
          <span className="tb-sep" />
          <input
            className="tb-input"
            placeholder="替换为"
            value={frRep}
            onChange={(e) => setFrRep(e.target.value)}
          />
          {btn('替换', () => editor.commands.replaceOne(frRep))}
          {btn('全部替换', () => editor.commands.replaceAll(frRep))}
          {btn('✕', frClose)}
        </div>
      )}
      {histOpen && (
        <div className="doc-toolbar doc-hist-panel">
          <span className="editor-hint">会话内快照（最多 20 份，恢复前会自动留当前状态）：</span>
          {hist.length === 0 && <span className="editor-status">暂无快照，编辑 60 秒后自动留存</span>}
          {[...hist].reverse().map((h, i) => (
            <button
              key={`${h.t}-${hist.length - i}`}
              className="tb-btn"
              title="恢复到此快照"
              onClick={() => restoreHist(h)}
            >
              {new Date(h.t).toLocaleTimeString()} · {h.note}
            </button>
          ))}
        </div>
      )}
      {hfOpen && (
        <div className="doc-hf-panel">
          <label className="doc-hf-field">
            页眉
            <input
              className="tb-input"
              value={meta.headerText ?? ''}
              placeholder="如：OpenOffices 内部资料（留空则无页眉）"
              onChange={(e) => patchMeta({ headerText: e.target.value || undefined })}
            />
          </label>
          <label className="doc-hf-field">
            页脚
            <input
              className="tb-input"
              value={meta.footerText ?? ''}
              placeholder="如：机密 · 仅供评审"
              onChange={(e) => patchMeta({ footerText: e.target.value || undefined })}
            />
          </label>
          <label className="doc-hf-check" title="导出为 Word PAGE 域，每页自动编号">
            <input
              type="checkbox"
              checked={!!meta.footerPageNumber}
              onChange={(e) => patchMeta({ footerPageNumber: e.target.checked || undefined })}
            />
            页码
          </label>
          {meta.footerPageNumber && (
            <label className="doc-hf-field">
              格式
              <select
                className="tb-select"
                value={meta.pageNumberFormat ?? 'cn'}
                onChange={(e) =>
                  patchMeta({ pageNumberFormat: (e.target.value as PageNumberFormat) || undefined })
                }
              >
                {PAGE_NUMBER_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(meta.headerText || meta.footerText || meta.footerPageNumber) && (
            <button className="tb-btn" onClick={() => patchMeta({ headerText: undefined, footerText: undefined, footerPageNumber: undefined, pageNumberFormat: undefined })}>
              清空
            </button>
          )}
        </div>
      )}
      {styleEdOpen && (
        <div className="doc-style-panel">
          <div className="doc-style-head">
            <span className="editor-hint">
              命名样式：定义一改，挂着该样式的段落/表格全文即时变；存盘导出写入 Word 样式表。
              段落/字符/表格三类各在自己的维度上，手调格式（行距、逐格边框等）永远优先于样式，套用不清手调。
            </span>
            <button className="tb-btn" onClick={addDocStyle} title="新建一枚本文档的段落样式（自动命名 ooS1…），编辑后可在「样式」下拉里套用">
              新建段落样式
            </button>
            <button className="tb-btn" onClick={addCharStyle} title="新建一枚字符样式（v0.113）：套到选中的文字上，只改字号/粗斜/颜色这类文字外观">
              新建字符样式
            </button>
            <button className="tb-btn" onClick={addTableStyle} title="新建一枚表格样式（v0.114）：套到整张表上，管表线型/默认格边距/格底纹与表内文字，逐格手调仍优先">
              新建表格样式
            </button>
          </div>
          {styleList.length === 0 && (
            <span className="editor-status">这份文档还没有命名样式——「新建样式」起一枚，或用带样式表的 docx 导入自动带进来</span>
          )}
          {styleList.map((s) => {
            const builtin = BUILTIN_STYLE_IDS.test(s.id)
            const num = (v: string) => (v === '' ? undefined : Number(v))
            const conds = s.kind === 'table' ? (s.table?.cond ?? {}) : {}
            const condKeys = TABLE_COND_TYPES.filter((t) => conds[t])
            /** 条件层改动（v0.116）：动某一块只动那一块，不动同级其它部位 */
            const patchCond = (type: TableCondType, p: Partial<TableCond> | null) =>
              patchStyle(s.id, {
                table: {
                  ...(s.table ?? {}),
                  cond: p === null ? { ...conds, [type]: undefined } : { ...conds, [type]: { ...(conds[type] ?? {}), ...p } },
                },
              })
            return (
              <>
              <div
                key={s.id}
                className="doc-style-row"
                title={builtin ? `${s.name}（${s.id}）：库内置样式，屏幕呈现与导出都走 Word 内置定义，这里只读` : `${s.id}${s.basedOn ? `，基于 ${s.basedOn}` : ''}`}
              >
                {builtin ? (
                  <span className="doc-style-name">
                    {s.name}
                    <i className="doc-style-tag">内置</i>
                  </span>
                ) : (
                  <>
                    <input
                      className="tb-input doc-style-name"
                      value={s.name}
                      onChange={(e) => patchStyle(s.id, { name: e.target.value.trim() || s.id })}
                    />
                    <label className="doc-style-field" title="字号（像素，1px=0.75pt）">
                      <input
                        className="tb-input doc-style-num"
                        type="number"
                        step="0.5"
                        min="5"
                        value={s.run.sizePx ?? ''}
                        placeholder="字号"
                        onChange={(e) => patchStyle(s.id, { run: { ...s.run, sizePx: num(e.target.value) } })}
                      />
                    </label>
                    <label className="doc-style-chk" title="粗体">
                      <input
                        type="checkbox"
                        checked={!!s.run.bold}
                        onChange={(e) => patchStyle(s.id, { run: { ...s.run, bold: e.target.checked || undefined } })}
                      />
                      粗
                    </label>
                    <label className="doc-style-chk" title="斜体">
                      <input
                        type="checkbox"
                        checked={!!s.run.italic}
                        onChange={(e) => patchStyle(s.id, { run: { ...s.run, italic: e.target.checked || undefined } })}
                      />
                      斜
                    </label>
                    <input
                      className="doc-style-color"
                      type="color"
                      title="文字颜色"
                      value={/^#[0-9a-f]{6}$/i.test(s.run.color ?? '') ? s.run.color! : '#000000'}
                      onChange={(e) => patchStyle(s.id, { run: { ...s.run, color: e.target.value } })}
                    />
                    {s.kind === 'character' ? (
                      <i className="doc-style-tag">字符</i>
                    ) : s.kind === 'table' ? (
                      <>
                        <i className="doc-style-tag">表格</i>
                        <span className="tb-sep" />
                        {(() => {
                          const t = s.table ?? {}
                          const patchT = (p: Partial<NonNullable<DocxStyleInfo['table']>>) =>
                            patchStyle(s.id, { table: { ...t, ...p } })
                          const css = borderCss(bdSel.style, bdSel.pt, bdSel.hex)
                          const on = (k: TableBdKey) => borderParts(t[k]) !== null
                          const toggle = (k: TableBdKey) => patchT({ [k]: on(k) ? undefined : css })
                          const padNum = (k: 'padTopPx' | 'padRightPx' | 'padBottomPx' | 'padLeftPx', v: string) => {
                            const n = Number(v)
                            patchT({ [k]: v === '' || !Number.isFinite(n) || n < 0 ? undefined : n })
                          }
                          return (
                            <>
                              <select
                                className="tb-select"
                                value={bdSel.style}
                                title="边框线型：先选它，再点要加的边"
                                onChange={(e) => setBdSel({ ...bdSel, style: e.target.value })}
                              >
                                {BORDER_STYLES.map((o) => (
                                  <option key={o.css} value={o.css}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                              <select
                                className="tb-select"
                                value={String(bdSel.pt)}
                                title="边框粗细（磅，Word 边框对话框的那几档）"
                                onChange={(e) => setBdSel({ ...bdSel, pt: Number(e.target.value) })}
                              >
                                {BORDER_WIDTH_PT.map((p) => (
                                  <option key={p} value={String(p)}>
                                    {p} 磅
                                  </option>
                                ))}
                              </select>
                              <label className="tb-color" title="边框颜色">
                                色
                                <input type="color" value={bdSel.hex} onChange={(e) => setBdSel({ ...bdSel, hex: e.target.value })} />
                              </label>
                              {TABLE_BD_KEYS.map((k) =>
                                btn(
                                  TABLE_BD_LABEL[k],
                                  () => toggle(k),
                                  on(k),
                                  `${on(k) ? '去掉' : '加上'}${TABLE_BD_LABEL[k]}（表级那一层，逐格手调的边框压得住它）`,
                                ),
                              )}
                              <select
                                className="tb-select"
                                value={t.align ?? ''}
                                title="整张表的水平位置（w:jc）"
                                onChange={(e) => patchT({ align: e.target.value || undefined })}
                              >
                                <option value="">表位置</option>
                                <option value="left">左</option>
                                <option value="center">居中</option>
                                <option value="right">右</option>
                              </select>
                              <label className="tb-color" title="默认格底纹（样式自己的 w:tcPr/w:shd，逐格底纹优先）">
                                格底
                                <input
                                  type="color"
                                  value={/^#[0-9a-f]{6}$/i.test(t.background ?? '') ? t.background! : '#ffffff'}
                                  onChange={(e) => patchT({ background: e.target.value })}
                                />
                              </label>
                              {btn('无底', () => patchT({ background: undefined }), false, '清掉默认格底纹')}
                              {(['上', '右', '下', '左'] as const).map((lab, i) => {
                                const key = (['padTopPx', 'padRightPx', 'padBottomPx', 'padLeftPx'] as const)[i]
                                return (
                                  <label key={key} className="doc-style-field" title={`格边距·${lab}（像素）`}>
                                    <input
                                      className="tb-input doc-style-num"
                                      type="number"
                                      step="1"
                                      min="0"
                                      value={t[key] ?? ''}
                                      placeholder={`边${lab}`}
                                      onChange={(e) => padNum(key, e.target.value)}
                                    />
                                  </label>
                                )
                              })}
                              {btn(
                                `条件 ${condKeys.length}`,
                                () => setCondOpenId(condOpenId === s.id ? null : s.id),
                                condOpenId === s.id,
                                '条件层（v0.116）：按部位再压一层——首行加粗、奇偶行底纹、四角这一类',
                              )}
                            </>
                          )
                        })()}
                      </>
                    ) : (
                      <>
                    <select
                      className="tb-select"
                      value={s.para.align ?? ''}
                      title="对齐"
                      onChange={(e) => patchStyle(s.id, { para: { ...s.para, align: e.target.value || undefined } })}
                    >
                      <option value="">对齐</option>
                      <option value="left">左</option>
                      <option value="center">中</option>
                      <option value="right">右</option>
                      <option value="justify">两端</option>
                    </select>
                    <input
                      className="tb-input doc-style-num"
                      type="number"
                      step="0.05"
                      min="0"
                      value={s.para.lineHeight ?? ''}
                      placeholder="行距"
                      title={s.para.lineRule === 'exact' || s.para.lineRule === 'atLeast' ? '绝对行距（像素）' : '行距倍数'}
                      onChange={(e) => patchStyle(s.id, { para: { ...s.para, lineHeight: num(e.target.value) } })}
                    />
                    <select
                      className="tb-select"
                      value={s.para.lineRule ?? 'auto'}
                      title="行距规则"
                      onChange={(e) => patchStyle(s.id, { para: { ...s.para, lineRule: (e.target.value || 'auto') as DocxStyleInfo['para']['lineRule'] } })}
                    >
                      <option value="auto">倍</option>
                      <option value="exact">固定</option>
                      <option value="atLeast">最小</option>
                    </select>
                    <input
                      className="tb-input doc-style-num"
                      type="number"
                      step="1"
                      min="0"
                      value={s.para.spaceBeforePx ?? ''}
                      placeholder="段前"
                      title="段前距（像素）"
                      onChange={(e) => patchStyle(s.id, { para: { ...s.para, spaceBeforePx: num(e.target.value) } })}
                    />
                    <input
                      className="tb-input doc-style-num"
                      type="number"
                      step="1"
                      min="0"
                      value={s.para.spaceAfterPx ?? ''}
                      placeholder="段后"
                      title="段后距（像素）"
                      onChange={(e) => patchStyle(s.id, { para: { ...s.para, spaceAfterPx: num(e.target.value) } })}
                    />
                      </>
                    )}
                    <button                       className="tb-btn doc-style-del" onClick={() => removeDocStyle(s.id)} title="删除此样式，并摘掉全文对它的引用">
                      删
                    </button>
                  </>
                )}
              </div>
              {!builtin && s.kind === 'table' && condOpenId === s.id && (
                <div className="doc-tblcond-panel">
                  <div className="doc-tblcond-row">
                    <select
                      className="tb-select"
                      value={condType}
                      title="要加哪个部位"
                      onChange={(e) => setCondType(e.target.value as TableCondType)}
                    >
                      {TABLE_COND_TYPES.filter((t) => !conds[t]).map((t) => (
                        <option key={t} value={t}>
                          {TABLE_COND_LABEL[t]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="tb-btn"
                      disabled={!condType || !!conds[condType]}
                      onClick={() => condType && patchCond(condType, {})}
                      title="加一块条件：Word 的「表样式」对话框里也是先勾部位再调样子"
                    >
                      加这个部位
                    </button>
                    <span className="editor-hint">
                      按部位压一层：位置由行列现算（奇数行就是第 1、3、5…行），手调的逐格格式永远在上面。
                      导出时连带给表写上 <code>w:tblLook</code> 这枚闸门：没有它，Word 认不出这些部位。
                    </span>
                  </div>
                  {condKeys.length === 0 && <span className="editor-status">还没有条件层；上面选一个部位加上</span>}
                  {condKeys.map((type) => {
                    const c = conds[type]!
                    const patchC = (p: Partial<TableCond>) => patchCond(type, p)
                    const padNumC = (k: keyof TableCond, v: string) => {
                      const n = Number(v)
                      patchC({ [k]: v === '' || !Number.isFinite(n) || n < 0 ? undefined : n })
                    }
                    return (
                      <div key={type} className="doc-tblcond-row">
                        <span className="doc-tblcond-name" title={`w:tblStylePr w:type="${type}"`}>
                          {TABLE_COND_LABEL[type]}
                        </span>
                        <label className="tb-color" title="这一部位的格底纹">
                          底
                          <input
                            type="color"
                            value={/^#[0-9a-f]{6}$/i.test(c.background ?? '') ? c.background! : '#ffffff'}
                            onChange={(e) => patchC({ background: e.target.value })}
                          />
                        </label>
                        <button className="tb-btn" onClick={() => patchC({ background: undefined })} title="不给底纹">
                          无底
                        </button>
                        <label className="doc-style-chk" title="这一部位的文字加粗">
                          <input type="checkbox" checked={!!c.bold} onChange={(e) => patchC({ bold: e.target.checked || undefined })} />
                          粗
                        </label>
                        {(['上', '右', '下', '左'] as const).map((lab, i) => {
                          const key = (['padTopPx', 'padRightPx', 'padBottomPx', 'padLeftPx'] as const)[i]
                          return (
                            <label key={key} className="doc-style-field" title={`格边距·${lab}（像素）`}>
                              <input
                                className="tb-input doc-style-num"
                                type="number"
                                step="1"
                                min="0"
                                value={c[key] ?? ''}
                                placeholder={`边${lab}`}
                                onChange={(e) => padNumC(key, e.target.value)}
                              />
                            </label>
                          )
                        })}
                        <span className="tb-sep" />
                        {CELL_EDGES.map((edge) => {
                          const on = borderParts(c.borders?.[edge] ?? '') !== null
                          const toggleBd = () => {
                            const css = borderCss(bdSel.style, bdSel.pt, bdSel.hex)
                            const next = { ...(c.borders ?? {}) }
                            if (on) delete next[edge]
                            else next[edge] = css
                            patchC({ borders: next })
                          }
                          return btn(
                            EDGE_LABEL[edge] ?? edge,
                            toggleBd,
                            on,
                            `${on ? '去掉' : '加上'}${EDGE_LABEL[edge] ?? edge}的边框（线型/粗细/颜色按上方「表格」那支笔来）`,
                          )
                        })}
                        <label className="doc-style-field" title="这一部位的行高（px，仅行型条件 firstRow/lastRow/奇数行/偶数行 在 Word 里生效）">
                          <input
                            className="tb-input doc-style-num"
                            type="number"
                            step="1"
                            min="0"
                            value={c.rowHeightPx ?? ''}
                            placeholder="行高"
                            onChange={(e) => {
                              const n = Number(e.target.value)
                              patchC({
                                rowHeightPx: e.target.value === '' || !Number.isFinite(n) || n < 0 ? undefined : n,
                              })
                            }}
                          />
                        </label>
                        <button className="tb-btn doc-style-del" onClick={() => patchCond(type, null)} title="去掉这一部位">
                          删
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              </>
            )
          })}
        </div>
      )}
      <div className="doc-body">
        {navOpen && (
          <aside className="doc-outline">
            <div className="doc-outline-head">
              <span>文档结构</span>
              <button className="tb-btn doc-outline-close" onClick={() => setNavOpen(false)} title="收起导航窗格">
                ✕
              </button>
            </div>
            <div className="doc-outline-list">
              {outline.length === 0 ? (
                <div className="doc-outline-empty">给段落设「标题 1–4」，这里就会列出结构并随编辑刷新。</div>
              ) : (
                outline.map((h) => (
                  <button
                    key={h.pos}
                    className={`doc-outline-item doc-outline-l${h.level}${h.pos === activeOutline ? ' doc-outline-active' : ''}`}
                    onClick={() => jumpToHeading(h.pos)}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                ))
              )}
            </div>
            <div className="doc-outline-foot">{outline.length} 个标题 · 点击跳转</div>
          </aside>
        )}
        <div
          className="doc-scroll"
          ref={scrollRef}
          onScroll={() => {
            // v0.181：只在预览态同步页码；程序化滚动（smooth）期间先不回写，
            // 等视口抵达目标再解除，否则中间帧会把页码一路改回起点
            if (!previewOpen) return
            const top = scrollRef.current?.scrollTop ?? 0
            const target = previewTargetRef.current
            if (target !== null) {
              if (Math.abs(top - target) < 2) previewTargetRef.current = null
              return
            }
            const p = clampPage(pageOfScrollTop(top, effPx.h, zoom, effPx.top), totalPreviewPages)
            setPreviewPage((cur) => (cur === p ? cur : p))
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            // 预览态只读，不弹编辑用的右键菜单（也不放行浏览器原生菜单）
            if (previewOpen) return
            setCtxMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          <div
            className="doc-page"
            style={{
              width: effPx.w,
              maxWidth: 'none',
              minHeight: effPx.h,
              padding: `${effPx.top}px ${effPx.right}px ${effPx.bottom}px ${effPx.left}px`,
              zoom,
            }}
          >
            <div className="doc-pg-lines" style={{ '--pgh': `${effPx.h}px` } as CSSProperties} />
            {rulerOn && (
              <>
                {/* v0.179：标尺挂在 doc-page 内，随内联 zoom 一起缩放；0 点对齐版心左边缘 */}
                <div
                  className="doc-ruler-h"
                  style={{ left: effPx.left, width: rulerGeom.contentWidthPx }}
                  onPointerMove={rulerDrag}
                  onPointerUp={() => { rulerDragRef.current = null }}
                >
                  {rulerTicksNow.map((t, i) => (
                    <span
                      key={i}
                      className={`doc-ruler-tick${t.major ? ' doc-ruler-major' : ''}`}
                      style={{ left: t.at }}
                    >
                      {t.label !== undefined && <i>{t.label}</i>}
                    </span>
                  ))}
                  <span className="doc-ruler-avail" style={{ left: rulerMarks?.firstLine ?? 0, width: Math.max(0, (rulerMarks?.right ?? rulerGeom.contentWidthPx) - (rulerMarks?.firstLine ?? 0)) }} />
                  {rulerHandle('first', '首行缩进：拖动改第一行的起点', rulerMarks?.firstLine ?? 0)}
                  {rulerHandle('left', '左缩进：拖动改整段左边界，首行跟着走', rulerMarks?.left ?? 0)}
                  {rulerHandle('right', '右缩进：拖动改整段右边界', rulerMarks?.right ?? rulerGeom.contentWidthPx)}
                </div>
                <div className="doc-ruler-v" style={{ top: effPx.top, height: Math.max(0, effPx.h - effPx.top - effPx.bottom) }}>
                  {rulerVerticalTicks(Math.max(0, effPx.h - effPx.top - effPx.bottom), MM_PX).map((t, i) => (
                    <span
                      key={i}
                      className={`doc-ruler-vtick${t.major ? ' doc-ruler-major' : ''}`}
                      style={{ top: t.at }}
                    />
                  ))}
                </div>
              </>
            )}
            {meta.headerText && <div className="doc-hf doc-hf-head">{meta.headerText}</div>}
            <div
              ref={wrapRef}
              className={eff.cols > 1 ? 'doc-cols' : undefined}
              style={
                eff.cols > 1
                  ? ({ columnCount: eff.cols, columnGap: eff.colGap * MM_PX } as CSSProperties)
                  : undefined
              }
            >
              {/* 命名样式渲染层（v0.106）：样式定义在这里编译成规则，挂着 data-pstyle 的段落全文跟着它走 */}
              <style>{styleCssOf(styleList)}</style>
              <EditorContent editor={editor} />
            </div>
            {notes.length > 0 && (
              // 我们做不出"每页页脚"那一版式，故脚注正文摊在正文末尾：屏幕上是可编辑的文本框，
              // 打印时换成静态块（同一份文字），随正文一起进 PDF / docx
              <div className="doc-notes">
                {(['footnote', 'endnote'] as NoteKind[]).map((kind) => {
                  const rows = notes.filter((r) => r.kind === kind)
                  if (!rows.length) return null
                  return (
                    <div key={kind} className="doc-notes-group">
                      <div className="doc-notes-title">
                        {NOTE_LABEL[kind]} {rows.length}
                      </div>
                      {rows.map((r) => (
                        <div key={r.index} className="doc-note-row">
                          <span className="doc-note-num">{noteOrdinalOf(notes, r)}</span>
                          <textarea
                            className="doc-note-input"
                            rows={1}
                            value={r.text}
                            placeholder="（正文为空）"
                            onChange={(e) => editor.commands.setNoteText(r.index, e.target.value)}
                          />
                          <div className="doc-note-static">{r.text}</div>
                          {btn('定位', () => locateNote(editor, r), false, '滚动到正文里的标记')}
                          {btn('删除', () => editor.commands.deleteNote(r.index), false, '删掉标记与正文')}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
            {(meta.footerText || meta.footerPageNumber) && (
              <div className="doc-hf doc-hf-foot">
                {meta.footerText}
                {meta.footerText && meta.footerPageNumber ? ' · ' : ''}
                {meta.footerPageNumber && (
                  <span className="doc-hf-page">
                    {pnPreview.before}[页码]{pnPreview.after}
                    {pnPreview.total ? ' / [总页数]' : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {cmOpen && (
          <aside className="doc-comments">
            <div className="doc-comments-head">
              <span>批注 {comments.length}</span>
              <button className="tb-btn" onClick={() => setCmOpen(false)}>收起</button>
            </div>
            {draft && (
              <div className="doc-comment-card doc-comment-draft">
                <textarea
                  autoFocus
                  className="doc-comment-input"
                  placeholder="批注内容，Ctrl+Enter 确定，Esc 取消"
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) confirmDraft()
                    if (e.key === 'Escape') cancelDraft()
                  }}
                />
                <div className="doc-comment-actions">
                  <button className="tb-btn" onClick={confirmDraft}>确定</button>
                  <button className="tb-btn" onClick={cancelDraft}>取消</button>
                </div>
              </div>
            )}
            {comments.length === 0 && !draft && (
              <div className="doc-comment-empty">选中正文文字后点「新建批注」</div>
            )}
            {[...comments]
              .sort(
                (a, b) =>
                  (findCommentAnchor(editor, a.id)?.pos ?? Number.MAX_SAFE_INTEGER) -
                  (findCommentAnchor(editor, b.id)?.pos ?? Number.MAX_SAFE_INTEGER),
              )
              .map((c) => {
                const anchor = findCommentAnchor(editor, c.id)
                return (
                  <div key={c.id} className={`doc-comment-card${c.resolved ? ' doc-comment-done' : ''}`}>
                    <div className="doc-comment-meta">
                      {c.author || '我'}
                      {c.date ? ` · ${c.date.slice(0, 10)}` : ''}
                    </div>
                    <div className="doc-comment-text">{c.text}</div>
                    {!anchor && <div className="doc-comment-orphan">原文已删除</div>}
                    <div className="doc-comment-actions">
                      <button className="tb-btn" onClick={() => locateComment(c.id)} disabled={!anchor}>
                        定位
                      </button>
                      <button className="tb-btn" onClick={() => toggleResolved(c.id)}>
                        {c.resolved ? '重新打开' : '解决'}
                      </button>
                      <button className="tb-btn" onClick={() => deleteComment(c.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                )
              })}
          </aside>
        )}
      </div>
      {/* v0.180：独立状态栏。预览态由 .is-preview 的通配规则藏掉，纸上由 @media print 藏掉 */}
      <div className="doc-status-bar">
        {statusItems.flatMap((it) => [
          ...(it.pushLeft ? [<span key="grow" className="doc-status-grow" />] : []),
          it.action ? (
            <button
              key={it.id}
              className={`doc-status-item${it.active ? ' is-active' : ''}`}
              title={it.title}
              onClick={() => { const a = it.action; if (a) runStatus(a) }}
            >
              {it.label}
            </button>
          ) : (
            <span key={it.id} className="doc-status-item is-static" title={it.title}>{it.label}</span>
          ),
        ])}
      </div>
      {ctxMenu && (
        <div
          className="doc-ctx-menu"
          style={{
            left: Math.min(ctxMenu.x, Math.max(8, window.innerWidth - 200)),
            top: Math.min(ctxMenu.y, Math.max(8, window.innerHeight - 380)),
          }}
        >
          {contextItems({
            hasSelection: !editor.state.selection.empty,
            inTable: editor.isActive('table'),
            navOpen,
            painterArmed: !!painter,
          }).map((it) =>
            it.separator ? (
              <div key={it.id} className="doc-ctx-sep" />
            ) : (
              <button
                key={it.id}
                className="doc-ctx-item"
                disabled={it.disabled}
                onClick={() => void runCtx(it.id)}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

export default memo(DocEditor)
