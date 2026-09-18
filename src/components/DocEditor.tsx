import { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { TableKit } from '@tiptap/extension-table'
import { message, open } from '@tauri-apps/plugin-dialog'
import type { Tab } from '../store'
import { useApp } from '../store'
import { baseName, pickSaveFile, readBytes, readText, writeBytes, writeText } from '../lib/fs'
import { docxToHtml, prosemirrorToDocxBytes, type PMNode } from '../lib/docx'

interface Props {
  tab: Tab
}

const ODOC_HEADER = { app: 'openoffices', kind: 'doc', version: 1 }

export default function DocEditor({ tab }: Props) {
  const renameTab = useApp((s) => s.renameTab)
  const markDirty = useApp((s) => s.markDirty)
  const markRecent = useApp((s) => s.markRecent)
  const [status, setStatus] = useState<string>(tab.path ? '正在加载…' : '')
  const [linkDraft, setLinkDraft] = useState<string | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: '开始输入内容…' }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: true } }),
    ],
    content: '<p></p>',
    onUpdate: () => markDirty(tab.id, true),
    editorProps: { attributes: { class: 'doc-content' } },
  })

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
          const html = await docxToHtml(bytes)
          if (!disposed) editor.commands.setContent(html)
        } else {
          const text = await readText(tab.path)
          const parsed = JSON.parse(text) as { content?: PMNode }
          if (!disposed) editor.commands.setContent(parsed.content ?? { type: 'doc', content: [] })
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
    try {
      let path = asNew ? undefined : tab.path
      const name = tab.path ? baseName(tab.path) : '未命名文档'
      if (!path || asNew) {
        path = (await pickSaveFile(name.replace(/\.docx$/i, '') + '.odoc', ['odoc'])) ?? undefined
        if (!path) return
      }
      const content = JSON.stringify({ ...ODOC_HEADER, content: editor.getJSON() })
      await writeText(path, content)
      renameTab(tab.id, baseName(path), path)
      markRecent(path, 'doc')
      setStatus('已保存')
      setTimeout(() => setStatus(''), 1500)
    } catch (e) {
      await message(String(e), { title: '保存失败', kind: 'error' })
    }
  }

  const exportDocx = async () => {
    if (!editor) return
    try {
      const path = await pickSaveFile(
        (tab.path ? baseName(tab.path).replace(/\.[^.]+$/, '') : '未命名文档') + '.docx',
        ['docx'],
      )
      if (!path) return
      const bytes = await prosemirrorToDocxBytes(editor.getJSON() as PMNode)
      await writeBytes(path, bytes)
      markRecent(path, 'doc')
      setStatus('已导出 docx')
      setTimeout(() => setStatus(''), 1500)
    } catch (e) {
      await message(String(e), { title: '导出失败', kind: 'error' })
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

  if (!editor) return null
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
        {status && <span className="editor-status">{status}</span>}
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
      <div className="doc-scroll">
        <div className="doc-page">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
