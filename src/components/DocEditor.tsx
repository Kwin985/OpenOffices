import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { TableKit } from '@tiptap/extension-table'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Superscript } from '@tiptap/extension-superscript'
import { Subscript } from '@tiptap/extension-subscript'
import Highlight from '@tiptap/extension-highlight'
import { CharacterCount } from '@tiptap/extensions'
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
  resolvePage,
  MM_PX,
  PAGE_NUMBER_FORMATS,
  type DocComment,
  type DocMeta,
  type PageNumberFormat,
  type PMNode,
} from '../lib/docx'
import { Comment, addCommentMark, findCommentAnchor, removeCommentMark } from '../lib/comment-extension'
import {
  Note,
  NOTE_LABEL,
  locateNote,
  noteOrdinalOf,
  notesOf,
  type NoteKind,
} from '../lib/note-extension'
import type { DocxImport } from '../lib/docx-fidelity'
import { Toc } from '../lib/toc-extension'
import { PageBreak } from '../lib/page-break-extension'
import { Indent } from '../lib/indent-extension'
import { CellStyle, IndentTableView } from '../lib/cell-style'
import { ParagraphStyle, ruleOf, type LineRule } from '../lib/paragraph-style'
import { FindReplace, frPluginKey, activeIndexOf } from '../lib/find-replace'
import { docTemplate } from '../lib/templates'
import { odtToHtml, prosemirrorToOdtBytes } from '../lib/odt'
import { registerSaver, runExclusive } from '../lib/registry'
import { failDialog, failStatus, statusText, statusTip } from '../lib/fail-msg'
import { saveDoneTimer } from '../lib/save-status'
import { autoDelayMs, autoFailStatus, autoOkTip, createAutoSaveLedger, staleFailureClaim } from '../lib/auto-save'
import type { FailureClaim } from '../lib/auto-save'

interface Props {
  tab: Tab
}

const ODOC_HEADER = { app: 'openoffices', kind: 'doc', version: 1 }

const HL_COLORS = ['#fff59d', '#a5d6a7', '#90caf9', '#f48fb1']

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

// 图片扩展自带 width/height（像素数字），补 align=center：渲染成块级 + 双侧 auto 边距
const ImgExt = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          el.style.display === 'block' && el.style.marginLeft === 'auto' ? 'center' : null,
        renderHTML: (attrs: { align?: string | null }) =>
          attrs.align === 'center' ? { style: 'display:block;margin-left:auto;margin-right:auto' } : {},
      },
    }
  },
})

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
  const [pgOpen, setPgOpen] = useState(false)
  const [docH, setDocH] = useState(0)
  const [cmOpen, setCmOpen] = useState(false)
  const [draft, setDraft] = useState<{ cid: number; text: string } | null>(null)
  const [noteDraft, setNoteDraft] = useState<{ kind: NoteKind; text: string } | null>(null)
  const [, setTick] = useState(0)
  const [frOpen, setFrOpen] = useState(false)
  const [frQ, setFrQ] = useState('')
  const [frCs, setFrCs] = useState(false)
  const [frRep, setFrRep] = useState('')
  const frInputRef = useRef<HTMLInputElement>(null)
  const [histOpen, setHistOpen] = useState(false)
  const [hist, setHist] = useState<{ t: number; note: string; json: string; metaJson: string }[]>([])
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
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      ImgExt.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: '开始输入内容…' }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Indent.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: true, View: IndentTableView } }),
      // textStyle mark + 字色/字体族/字号。lineHeight 必须关掉：那是 TextStyleKit 给段落挂的同名属性，
      // 与本编辑器记 OOXML 行距的 lineHeight（ParagraphStyle）撞名字，两边只能留一个
      TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
      // 上下标不在 TextStyleKit 里（它们是独立 mark，渲染成 <sup>/<sub>）
      Superscript,
      Subscript,
      // 表格/单元格的边框、底纹、竖排对齐与表格缩进：保真导入落在这些属性上
      CellStyle,
      // 段落行距/段前后/底纹/四边：docx 的 w:spacing、w:shd、w:pBdr 读进来就靠这一层接住
      ParagraphStyle,
      Highlight.configure({ multicolor: true }),
      CharacterCount,
      Toc,
      PageBreak,
      Comment,
      // 脚注/尾注：行内原子节点，正文存在节点属性上（三条保存链路都从这一份事实出发）
      Note,
      FindReplace,
    ],
    content: '<p></p>',
    onUpdate: () => markDirty(tab.id, true),
    editorProps: {
      attributes: { class: 'doc-content' },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !event.shiftKey) {
          event.preventDefault()
          setFrOpen(true)
          setTimeout(() => frInputRef.current?.focus(), 0)
          return true
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
    el.textContent =
      `@media print { @page { size: ${eff.w}mm ${eff.h}mm; ` +
      `margin: ${eff.margin.top}mm ${eff.margin.right}mm ${eff.margin.bottom}mm ${eff.margin.left}mm;` +
      `${boxes.length ? ' ' + boxes.join(' ') : ''} } }`
  }, [
    eff.w,
    eff.h,
    eff.margin.top,
    eff.margin.right,
    eff.margin.bottom,
    eff.margin.left,
    meta.headerText,
    meta.footerText,
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

  useEffect(() => {
    if (!editor) return
    let disposed = false
    ;(async () => {
      if (!tab.path) {
        if (tab.template) {
          const t = docTemplate(tab.template)
          editor.commands.setContent(t.content)
          setMeta(t.meta)
          markDirty(tab.id, false)
        }
        setStatus('')
        return
      }
      try {
        let note = ''
        if (tab.path.toLowerCase().endsWith('.docx')) {
          const bytes = await readBytes(tab.path)
          const m = await docxToDocMeta(bytes)
          // 保真导入器直接读 OOXML 的 pPr/rPr，样式还原度远高于 mammoth；
          // 但它覆盖面有限（认不出的构造会漏），所以抛错或一块都没拆出来时退回 mammoth。
          let fid: DocxImport | null = null
          try {
            // 只在真的打开 .docx 时才拉这个模块，别把它塞进编辑器 chunk 的常驻体积里
            const { docxToHtmlFidelity } = await import('../lib/docx-fidelity')
            const r = await docxToHtmlFidelity(bytes)
            if (r.blocks > 0) fid = r
          } catch (e) {
            console.warn('docx 保真导入失败，回退 mammoth', e)
          }
          if (!disposed) {
            if (fid) {
              editor.commands.setContent(fid.html)
              setMeta(fid.comments.length ? { ...m, comments: fid.comments } : m)
              if (fid.comments.length) setCmOpen(true)
              if (fid.warnings.length)
                note = `保真导入：${fid.warnings.length} 项未保留（${fid.warnings[0]}${fid.warnings.length > 1 ? '…' : ''}）`
            } else {
              const baseHtml = await docxToHtml(bytes)
              const { html, comments } = await docxToCommentHtml(bytes, baseHtml)
              editor.commands.setContent(html)
              setMeta(comments.length ? { ...m, comments } : m)
              if (comments.length) setCmOpen(true)
            }
          }
        } else if (tab.path.toLowerCase().endsWith('.odt')) {
          const bytes = await readBytes(tab.path)
          const { html, meta: m, warnings } = await odtToHtml(bytes)
          if (!disposed) editor.commands.setContent(html, { emitUpdate: false })
          if (!disposed && Object.keys(m).length) setMeta(m)
          // 与 docx 那条同一套边界账：文字类构件（文本框、公式）展平时在这里说清楚，不静默
          if (warnings.length)
            note = `ODT 导入：${warnings.length} 项未保留（${warnings[0]}${warnings.length > 1 ? '…' : ''}）`
        } else {
          const text = await readText(tab.path)
          const parsed = JSON.parse(text) as { content?: PMNode; meta?: DocMeta }
          if (!disposed) {
            editor.commands.setContent(parsed.content ?? { type: 'doc', content: [] })
            setMeta(parsed.meta ?? {})
            if (parsed.meta?.comments?.length) setCmOpen(true)
          }
        }
        if (!disposed) setStatus(note)
        markDirty(tab.id, false)
      } catch (e) {
        console.error(e)
        setStatus(failStatus(e, '加载失败'))
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

  // —— 自动保存与版本历史（会话内）：内容有变化才入栈，最多 20 份 ——
  const pushHist = (note: string) => {
    if (!editor) return
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
  useEffect(() => {
    if (!editor) return
    const p = tab.path
    if (!p?.toLowerCase().endsWith('.odoc')) return
    let stopped = false
    let timer: number | undefined
    const schedule = () => {
      timer = window.setTimeout(async () => {
        const s = useApp.getState()
        if (s.tabs.some((t) => t.id === tab.id && t.dirty)) {
          // v0.74 实测（三趟全重现）：这一路改前直接调 writeText、绕过 registry 的在途锁，
          // 于是"定时那枚写刚出门 + 手动 Ctrl+S"会同一毫秒各发一枚 write_text_file，
          // 旧快照往往最后落地——屏上「已保存」说了，文件里那半句新打的字没落。
          // 锁忙 ⇒ 本趟跳过（手动那趟的快照本来就更新、它落完就是最新内容存了盘），而跳过不进退避的账。
          await runExclusive(tab.id, async () => {
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
    return () => {
      stopped = true
      autoRescheduleRef.current = null
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [editor, tab.path, tab.id])

  const restoreHist = (h: { json: string; metaJson: string; note: string }) => {
    if (!editor) return
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

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        {btn('保存', () => saveOdoc(false), false, 'Ctrl+S：原地写回当前文件（.docx/.odt 各按自己的格式，其余存 .odoc）')}
        {btn('另存为', () => saveOdoc(true))}
        {btn('导出 docx', exportDocx)}
        {btn('导出 odt', exportOdt, false, '导出 OpenDocument 文本（LibreOffice 系通用）')}
        {btn('目录', tocAction, false, '插入/定位目录：按标题实时汇总；导出为 Word 原生 TOC 域')}
        {btn('分页符', () => editor.chain().focus().insertPageBreak().run(), false, 'Ctrl+Enter：打印与导出 PDF 时从此处另起一页（docx/odt 同步写分页）')}
        {btn('页眉页脚', () => setHfOpen((v) => !v), hfOpen || !!(meta.headerText || meta.footerText || meta.footerPageNumber), '设置页眉、页脚与页码')}
        {btn('页面设置', () => setPgOpen((v) => !v), pgOpen || !!meta.page, '纸张与页边距：同步应用到视图、打印与 docx/odt 导出')}
        {btn('批注', () => setCmOpen((v) => !v), cmOpen || comments.length > 0, '批注侧栏：选中文字后可添加批注，导出为 docx 原生批注')}
        {btn('新建批注', startComment, !!draft, '选中正文文字后点击，为其添加一条批注')}
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
        {btn('打印 / PDF', () => window.print(), false, '调用系统打印，可选择另存为 PDF')}
        {btn('导出 PDF', exportPdf, false, 'WebView2 原生 PrintToPdf：按打印样式矢量输出，含高亮底色')}
        {status && (
          <span className="editor-status" title={statusTip(status)}>
            {statusText(status)}
          </span>
        )}
        {!status && autoSavedAt && (
          <span className="editor-status" title={autoOkTip(auto)}>
            已自动保存 {autoSavedAt.toLocaleTimeString()}
          </span>
        )}
        <span className="editor-hint">
          字数 {counts.words} · 字符 {counts.chars} · 约{' '}
          {Math.max(1, Math.ceil(docH / Math.max(1, effPx.h - effPx.top - effPx.bottom)))} 页
        </span>
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
      </div>
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
            return (
              <>
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
      <div className="doc-body">
        <div className="doc-scroll">
          <div
            className="doc-page"
            style={{
              width: effPx.w,
              maxWidth: 'none',
              minHeight: effPx.h,
              padding: `${effPx.top}px ${effPx.right}px ${effPx.bottom}px ${effPx.left}px`,
            }}
          >
            <div className="doc-pg-lines" style={{ '--pgh': `${effPx.h}px` } as CSSProperties} />
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
    </div>
  )
}

export default memo(DocEditor)
