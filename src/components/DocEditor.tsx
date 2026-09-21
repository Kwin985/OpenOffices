import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { TableKit } from '@tiptap/extension-table'
import Color from '@tiptap/extension-color'
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
  resolvePage,
  MM_PX,
  type DocComment,
  type DocMeta,
  type PMNode,
} from '../lib/docx'
import { Comment, addCommentMark, findCommentAnchor, removeCommentMark } from '../lib/comment-extension'
import { Toc } from '../lib/toc-extension'
import { odtToHtml, prosemirrorToOdtBytes } from '../lib/odt'
import { registerSaver } from '../lib/registry'

interface Props {
  tab: Tab
}

const ODOC_HEADER = { app: 'openoffices', kind: 'doc', version: 1 }

const HL_COLORS = ['#fff59d', '#a5d6a7', '#90caf9', '#f48fb1']

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
  const [, setTick] = useState(0)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      ImgExt.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: '开始输入内容…' }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: true } }),
      Color,
      Highlight.configure({ multicolor: true }),
      CharacterCount,
      Toc,
      Comment,
    ],
    content: '<p></p>',
    onUpdate: () => markDirty(tab.id, true),
    editorProps: {
      attributes: { class: 'doc-content' },
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
  }

  // 生效页面设置：未显式设定走 A4 + 默认边距（与 converter 导出同一 resolve）
  const eff = resolvePage(meta.page)
  const effPx = {
    w: eff.w * MM_PX,
    h: eff.h * MM_PX,
    top: eff.margin.top * MM_PX,
    bottom: eff.margin.bottom * MM_PX,
    left: eff.margin.left * MM_PX,
    right: eff.margin.right * MM_PX,
  }

  // 打印 @page 跟随页面设置（PrintToPdf/系统打印均读它）
  useEffect(() => {
    let el = document.getElementById('oo-page-rule') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'oo-page-rule'
      document.head.appendChild(el)
    }
    el.textContent = `@media print { @page { size: ${eff.w}mm ${eff.h}mm; margin: ${eff.margin.top}mm ${eff.margin.right}mm ${eff.margin.bottom}mm ${eff.margin.left}mm; } }`
  }, [eff.w, eff.h, eff.margin.top, eff.margin.right, eff.margin.bottom, eff.margin.left])

  // 正文高度随事务/输入变化：分页参考线之"约 N 页"由它折算（观察包装 div，避开 view 未挂载期）
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setDocH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [editor])

  // 批注侧栏随文档变更刷新（锚点位置/孤儿判定）
  useEffect(() => {
    if (!editor) return
    const h = () => setTick((t) => t + 1)
    editor.on('update', h)
    return () => {
      editor.off('update', h)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    let disposed = false
    ;(async () => {
      if (!tab.path) {
        setStatus('')
        return
      }
      try {
        if (tab.path.toLowerCase().endsWith('.docx')) {
          const bytes = await readBytes(tab.path)
          const baseHtml = await docxToHtml(bytes)
          const m = await docxToDocMeta(bytes)
          const { html, comments } = await docxToCommentHtml(bytes, baseHtml)
          if (!disposed) {
            editor.commands.setContent(html)
            setMeta(comments.length ? { ...m, comments } : m)
            if (comments.length) setCmOpen(true)
          }
        } else if (tab.path.toLowerCase().endsWith('.odt')) {
          const bytes = await readBytes(tab.path)
          const { html, meta: m } = await odtToHtml(bytes)
          if (!disposed) editor.commands.setContent(html, { emitUpdate: false })
          if (!disposed && Object.keys(m).length) setMeta(m)
        } else {
          const text = await readText(tab.path)
          const parsed = JSON.parse(text) as { content?: PMNode; meta?: DocMeta }
          if (!disposed) {
            editor.commands.setContent(parsed.content ?? { type: 'doc', content: [] })
            setMeta(parsed.meta ?? {})
            if (parsed.meta?.comments?.length) setCmOpen(true)
          }
        }
        if (!disposed) setStatus('')
        markDirty(tab.id, false)
      } catch (e) {
        console.error(e)
        setStatus(`加载失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, tab.id])

  const saveOdoc = async (asNew: boolean) => {
    if (!editor) return
    // .odt 标签的 Ctrl+S 直接原地导出 ODT，不能把 JSON 写进 odt 路径
    const cur = tab.path
    if (!asNew && cur?.toLowerCase().endsWith('.odt')) {
      await exportOdtTo(cur)
      return
    }
    try {
      let path = asNew ? undefined : tab.path
      const name = tab.path ? baseName(tab.path) : '未命名文档'
      if (!path || asNew) {
        path = (await pickSaveFile(name.replace(/\.docx$/i, '') + '.odoc', ['odoc'])) ?? undefined
        if (!path) return
      }
      const content = JSON.stringify({ ...ODOC_HEADER, content: editor.getJSON(), meta })
      await writeText(path, content)
      renameTab(tab.id, baseName(path), path)
      markRecent(path, 'doc')
      setStatus('已保存')
      setTimeout(() => setStatus(''), 1500)
    } catch (e) {
      await message(String(e), { title: '保存失败', kind: 'error' })
    }
  }

  const exportOdtTo = async (path: string) => {
    if (!editor) return
    try {
      const bytes = await prosemirrorToOdtBytes(editor.getJSON() as PMNode, meta)
      await writeBytes(path, bytes)
      markRecent(path, 'doc')
      setStatus('已保存（odt）')
      setTimeout(() => setStatus(''), 1500)
    } catch (e) {
      await message(String(e), { title: '导出 odt 失败', kind: 'error' })
    }
  }

  const saveRef = useRef(saveOdoc)
  saveRef.current = saveOdoc
  useEffect(() => registerSaver(tab.id, (asNew) => saveRef.current(asNew)), [tab.id])

  const exportDocx = async () => {
    if (!editor) return
    try {
      const path = await pickSaveFile(
        (tab.path ? baseName(tab.path).replace(/\.[^.]+$/, '') : '未命名文档') + '.docx',
        ['docx'],
      )
      if (!path) return
      const bytes = await prosemirrorToDocxBytes(editor.getJSON() as PMNode, meta)
      await writeBytes(path, bytes)
      markRecent(path, 'doc')
      setStatus('已导出 docx')
      setTimeout(() => setStatus(''), 1500)
    } catch (e) {
      await message(String(e), { title: '导出失败', kind: 'error' })
    }
  }

  const exportOdt = async () => {
    if (!editor) return
    const path = await pickSaveFile(
      (tab.path ? baseName(tab.path).replace(/\.[^.]+$/, '') : '未命名文档') + '.odt',
      ['odt'],
    )
    if (!path) return
    await exportOdtTo(path)
  }

  // WebView2 原生 PrintToPdf：主窗口按 @media print 样式矢量落盘，需当前文档标签处于激活态
  const exportPdf = async () => {
    try {
      const path = await pickSaveFile(
        (tab.path ? baseName(tab.path).replace(/\.[^.]+$/, '') : '未命名文档') + '.pdf',
        ['pdf'],
      )
      if (!path) return
      setStatus('正在生成 PDF…')
      await invoke('export_pdf', { filePath: path })
      markRecent(path, 'pdf')
      setStatus('已导出 PDF')
      setTimeout(() => setStatus(''), 1500)
    } catch (e) {
      setStatus('')
      await message(String(e), { title: '导出 PDF 失败', kind: 'error' })
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
      await message(String(e), { title: '插入图片失败', kind: 'error' })
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

  if (!editor) return null
  const cc = editor.storage.characterCount as { words: () => number; characters: () => number }
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
        {btn('保存', () => saveOdoc(false), false, '保存为 .odoc')}
        {btn('另存为', () => saveOdoc(true))}
        {btn('导出 docx', exportDocx)}
        {btn('导出 odt', exportOdt, false, '导出 OpenDocument 文本（LibreOffice 系通用）')}
        {btn('目录', tocAction, false, '插入/定位目录：按标题实时汇总；导出为 Word 原生 TOC 域')}
        {btn('页眉页脚', () => setHfOpen((v) => !v), hfOpen || !!(meta.headerText || meta.footerText || meta.footerPageNumber), '设置页眉、页脚与页码')}
        {btn('页面设置', () => setPgOpen((v) => !v), pgOpen || !!meta.page, '纸张与页边距：同步应用到视图、打印与 docx/odt 导出')}
        {btn('批注', () => setCmOpen((v) => !v), cmOpen || comments.length > 0, '批注侧栏：选中文字后可添加批注，导出为 docx 原生批注')}
        {btn('新建批注', startComment, !!draft, '选中正文文字后点击，为其添加一条批注')}
        {btn('打印 / PDF', () => window.print(), false, '调用系统打印，可选择另存为 PDF')}
        {btn('导出 PDF', exportPdf, false, 'WebView2 原生 PrintToPdf：按打印样式矢量输出，含高亮底色')}
        {status && <span className="editor-status">{status}</span>}
        <span className="editor-hint">
          字数 {cc.words()} · 字符 {cc.characters()} · 约{' '}
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
        {btn('B', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), '加粗')}
        {btn('I', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), '斜体')}
        {btn('U', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), '下划线')}
        {btn('S', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'), '删除线')}
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
          {meta.page && btn('重置', () => patchMeta({ page: undefined }), false, '恢复 A4 + 默认边距')}
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
          {(meta.headerText || meta.footerText || meta.footerPageNumber) && (
            <button className="tb-btn" onClick={() => patchMeta({ headerText: undefined, footerText: undefined, footerPageNumber: undefined })}>
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
            <div ref={wrapRef}>
              <EditorContent editor={editor} />
            </div>
            {(meta.footerText || meta.footerPageNumber) && (
              <div className="doc-hf doc-hf-foot">
                {meta.footerText}
                {meta.footerText && meta.footerPageNumber ? ' · ' : ''}
                {meta.footerPageNumber && <span className="doc-hf-page">第 [页码] 页</span>}
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
