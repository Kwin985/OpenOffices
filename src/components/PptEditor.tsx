import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { message } from '@tauri-apps/plugin-dialog'
import { emit, listen } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { Tab } from '../store'
import { useApp } from '../store'
import { readBytes, readText, writeBytes, writeText, pickSaveFile, baseName } from '../lib/fs'
import {
  emptyDeck,
  newSlide,
  parseDeck,
  serializeDeck,
  themeOf,
  LAYOUT_NAMES,
  TRANSITION_NAMES,
  THEMES,
  type Deck,
  type Slide,
  type SlideLayout,
  type SlideTransition,
} from '../lib/ppt'
import { deckToPptxBytes } from '../lib/pptx-export'
import { pptxBytesToDeck } from '../lib/pptx-import'
import { registerSaver } from '../lib/registry'
import StaticSlide from './StaticSlide'

interface Props {
  tab: Tab
}

async function fileToDataUri(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk))
  }
  return `data:${file.type || 'image/png'};base64,${btoa(bin)}`
}

function PptEditor({ tab }: Props) {
  const [deck, setDeck] = useState<Deck>(() => emptyDeck())
  const [cur, setCur] = useState(0)
  const [present, setPresent] = useState(false)
  const [presentIdx, setPresentIdx] = useState(0)
  const [showNotes, setShowNotes] = useState(false)
  const [status, setStatus] = useState<string>(tab.path ? '正在加载…' : '')
  const [loaded, setLoaded] = useState(!tab.path)
  const renameTab = useApp((s) => s.renameTab)
  const markDirty = useApp((s) => s.markDirty)
  const markRecent = useApp((s) => s.markRecent)
  const dirtyRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!tab.path) return
    ;(async () => {
      try {
        if (/\.opd$/i.test(tab.path!)) {
          setDeck(parseDeck(await readText(tab.path!)))
        } else {
          setDeck(await pptxBytesToDeck(await readBytes(tab.path!)))
        }
        setCur(0)
        setLoaded(true)
        setStatus('')
      } catch (e) {
        console.error(e)
        setStatus(`加载失败: ${e instanceof Error ? e.message : String(e)}`)
        setLoaded(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  const edit = (fn: (deck: Deck) => void) => {
    setDeck((d) => {
      const next: Deck = { ...d, slides: d.slides.map((s) => ({ ...s })) }
      fn(next)
      if (!dirtyRef.current) {
        dirtyRef.current = true
        markDirty(tab.id, true)
      }
      return next
    })
  }

  const editSlide = (i: number, fn: (s: Slide) => void) =>
    edit((d) => {
      const s = d.slides[i]
      if (s) fn(s)
    })

  const slide = deck.slides[cur]

  // 放映按键
  useEffect(() => {
    if (!present) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresent(false)
      else if (e.key === 'n' || e.key === 'N') setShowNotes((v) => !v)
      else if (e.key === 'p' || e.key === 'P') void togglePresenter()
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter')
        setPresentIdx((i) => Math.min(i + 1, deck.slides.length - 1))
      else if (e.key === 'ArrowLeft' || e.key === 'Backspace')
        setPresentIdx((i) => Math.max(i - 1, 0))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present, deck.slides.length])

  // 演讲者视图：第二窗口 + 事件同步
  const snapRef = useRef({ present, idx: presentIdx, deck })
  snapRef.current = { present, idx: presentIdx, deck }

  useEffect(() => {
    if (!present) {
      void emit('present:closed')
      return
    }
    void emit('present:sync', { deck, idx: presentIdx })
  }, [present, presentIdx, deck])

  useEffect(() => {
    const un: Array<() => void> = []
    void listen('presenter:ready', () => {
      const s = snapRef.current
      if (s.present) void emit('present:sync', { deck: s.deck, idx: s.idx })
    }).then((fn) => un.push(fn))
    void listen('present:quit', () => setPresent(false)).then((fn) => un.push(fn))
    return () => un.forEach((f) => f())
  }, [])

  const togglePresenter = async () => {
    const existing = await WebviewWindow.getByLabel('presenter')
    if (existing) {
      await existing.close()
      return
    }
    const u = new URL(window.location.href)
    u.searchParams.set('view', 'presenter')
    new WebviewWindow('presenter', {
      url: u.toString(),
      title: '演讲者视图',
      width: 1040,
      height: 700,
      visible: false,
    })
      .once('tauri://error', () => void message('无法创建演讲者窗口（检查权限）', { title: '演讲者视图' }))
      .then(() => {})
  }

  const save = async (asNew: boolean) => {
    try {
      let path = asNew ? undefined : tab.path
      if (!path || /\.pptx?$/i.test(path)) {
        path = (await pickSaveFile(`${deck.title || '演示'}.opd`, ['opd'])) ?? undefined
        if (!path) return
      }
      await writeText(path, serializeDeck(deck))
      renameTab(tab.id, baseName(path), path)
      markRecent(path, 'ppt')
      setStatus('已保存')
      setTimeout(() => setStatus(''), 1500)
    } catch (e) {
      await message(String(e), { title: '保存失败', kind: 'error' })
    }
  }

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => registerSaver(tab.id, (asNew) => saveRef.current(asNew)), [tab.id])

  const exportPptx = async () => {
    try {
      const path = await pickSaveFile(`${deck.title || '演示'}.pptx`, ['pptx'])
      if (!path) return
      await writeBytes(path, await deckToPptxBytes(deck))
      markRecent(path, 'ppt')
      setStatus('已导出 pptx')
      setTimeout(() => setStatus(''), 2000)
    } catch (e) {
      await message(String(e), { title: '导出失败', kind: 'error' })
    }
  }

  const addSlide = (layout: SlideLayout) => {
    edit((d) => {
      d.slides.splice(cur + 1, 0, newSlide(layout))
    })
    setCur(cur + 1)
  }

  const removeSlide = () => {
    if (deck.slides.length <= 1) return
    edit((d) => {
      d.slides.splice(cur, 1)
    })
    setCur(Math.max(0, cur - 1))
  }

  const moveSlide = (dir: -1 | 1) => {
    const to = cur + dir
    if (to < 0 || to >= deck.slides.length) return
    edit((d) => {
      const [s] = d.slides.splice(cur, 1)
      d.slides.splice(to, 0, s)
    })
    setCur(to)
  }

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    try {
      const uri = await fileToDataUri(file)
      editSlide(cur, (s) => {
        s.image = uri
      })
    } catch (e) {
      console.error(e)
    }
  }

  if (!loaded) {
    return (
      <div className="editor-pane">
        <div className="editor-toolbar">
          {status && <span className="editor-status">{status}</span>}
        </div>
        <div className="ppt-loading">{status || '正在加载…'}</div>
      </div>
    )
  }

  const t = themeOf(deck.theme)
  const m = deck.master
  const fgColor = m?.bodyColor ?? t.fg
  const accentColor = m?.titleColor ?? t.accent
  const stageStyle: CSSProperties = m?.bgImage
    ? {
        backgroundImage: `url(${m.bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        color: fgColor,
      }
    : { background: slide.bg ?? m?.bg ?? t.bg, color: fgColor }

  return (
    <div className="editor-pane">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          void pickImage(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <div className="editor-toolbar">
        <button className="tool-btn" onClick={() => save(false)}>保存</button>
        <button className="tool-btn" onClick={() => save(true)}>另存为…</button>
        <button className="tool-btn" onClick={() => void exportPptx()}>导出 pptx…</button>
        <span className="tool-sep" />
        <select
          className="tool-select"
          value=""
          onChange={(e) => {
            if (e.target.value) addSlide(e.target.value as SlideLayout)
          }}
        >
          <option value="">＋ 新增幻灯片</option>
          <option value="title">标题页</option>
          <option value="bullets">内容页</option>
          <option value="image">图片页</option>
          <option value="blank">空白页</option>
        </select>
        <button className="tool-btn" onClick={() => moveSlide(-1)} title="上移">↑</button>
        <button className="tool-btn" onClick={() => moveSlide(1)} title="下移">↓</button>
        <button className="tool-btn" onClick={removeSlide} title="删除本页">删页</button>
        <span className="tool-sep" />
        <select
          className="tool-select"
          value={deck.theme}
          onChange={(e) => edit((d) => (d.theme = e.target.value))}
        >
          {THEMES.map((th) => (
            <option key={th.id} value={th.id}>主题 · {th.name}</option>
          ))}
        </select>
        <select
          className="tool-select"
          value={slide.transition ?? ''}
          onChange={(e) =>
            editSlide(cur, (s) => {
              s.transition = (e.target.value || undefined) as SlideTransition | undefined
            })
          }
          title="本页切页动画"
        >
          <option value="">切换 · 无</option>
          {(Object.entries(TRANSITION_NAMES) as [SlideTransition, string][]).map(([k, n]) => (
            <option key={k} value={k}>切换 · {n}</option>
          ))}
        </select>
        <button
          className="tool-btn tool-btn-primary"
          onClick={() => {
            setPresentIdx(cur)
            setShowNotes(false)
            setPresent(true)
          }}
        >
          放映
        </button>
        {status && <span className="editor-status">{status}</span>}
        <span className="editor-hint">存档 .opd · 导入/导出 pptx (ECMA-376) · 生成: pptxgenjs (MIT)</span>
      </div>

      <div className="ppt-body">
        <div className="ppt-sidebar">
          {deck.slides.map((s, i) => (
            <div
              key={s.id}
              className={`ppt-thumb${i === cur ? ' ppt-thumb-active' : ''}`}
              onClick={() => setCur(i)}
            >
              <span className="ppt-thumb-no">{i + 1}</span>
              <div className="ppt-thumb-mini">
                <StaticSlide slide={s} themeId={deck.theme} master={deck.master} />
              </div>
            </div>
          ))}
        </div>

        <div className="ppt-stage-wrap">
          <div className="ppt-stage" style={stageStyle}>
            {slide.layout === 'title' ? (
              <div className="ppt-edit-title-wrap">
                <textarea
                  className="ppt-edit-title"
                  style={{ color: accentColor }}
                  value={slide.title}
                  placeholder="演示文稿标题"
                  rows={2}
                  onChange={(e) => editSlide(cur, (s) => (s.title = e.target.value))}
                />
                <textarea
                  className="ppt-edit-sub"
                  style={{ color: fgColor }}
                  value={slide.body}
                  placeholder="副标题 / 日期 / 作者"
                  rows={2}
                  onChange={(e) => editSlide(cur, (s) => (s.body = e.target.value))}
                />
              </div>
            ) : (
              <>
                <textarea
                  className="ppt-edit-head"
                  style={{ color: accentColor, borderColor: accentColor }}
                  value={slide.title}
                  placeholder={LAYOUT_NAMES[slide.layout] === '空白页' ? '（空白页标题，可留空）' : '本页标题'}
                  rows={1}
                  onChange={(e) => editSlide(cur, (s) => (s.title = e.target.value))}
                />
                <div className="ppt-edit-content">
                  {slide.layout === 'image' && (
                    <div className="ppt-edit-img-col">
                      {slide.image ? (
                        <img className="ppt-edit-img" src={slide.image} alt="" />
                      ) : (
                        <button className="ppt-img-add" onClick={() => fileRef.current?.click()}>
                          ＋ 插入图片
                        </button>
                      )}
                      {slide.image && (
                        <div className="ppt-img-actions">
                          <button className="tool-btn tool-btn-mini" onClick={() => fileRef.current?.click()}>换图</button>
                          <button
                            className="tool-btn tool-btn-mini"
                            onClick={() => editSlide(cur, (s) => (s.image = undefined))}
                          >
                            移除
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <textarea
                    className="ppt-edit-body"
                    style={{ color: fgColor }}
                    value={slide.body}
                    placeholder={slide.layout === 'blank' ? '（备注性文字，导出/放映仅显示标题）' : '每行一条要点，回车分行…'}
                    onChange={(e) => editSlide(cur, (s) => (s.body = e.target.value))}
                  />
                </div>
              </>
            )}
            <span className="ppt-stage-no">{cur + 1} / {deck.slides.length}</span>
          </div>
        </div>
      </div>

      <div className="ppt-notes-wrap">
        <span className="ppt-notes-label">演讲者备注</span>
        <textarea
          className="ppt-notes"
          placeholder="本页备注：随 .opd / pptx 保存与还原，放映时按 N 浮现…"
          value={slide.notes ?? ''}
          onChange={(e) => editSlide(cur, (s) => (s.notes = e.target.value))}
        />
      </div>

      {present && (
        <div className="ppt-present" onClick={() => setPresent(false)}>
          <div
            className={`ppt-present-stage${
              deck.slides[presentIdx]?.transition ? ` ppt-tr-${deck.slides[presentIdx]!.transition}` : ''
            }`}
            key={presentIdx}
          >
            <StaticSlide big slide={deck.slides[presentIdx]} themeId={deck.theme} master={deck.master} />
          </div>
          {showNotes && deck.slides[presentIdx]?.notes && (
            <div className="ppt-present-notes" onClick={(e) => e.stopPropagation()}>
              {deck.slides[presentIdx]?.notes}
            </div>
          )}
          <div className="ppt-present-bar" onClick={(e) => e.stopPropagation()}>
            <span>
              {presentIdx + 1} / {deck.slides.length} · ←/→ 翻页 · N 备注 · P 演讲者视图 · Esc 退出
            </span>
            <button className="tool-btn" onClick={() => void togglePresenter()}>
              演讲者视图
            </button>
            <button className="tool-btn" onClick={() => setPresent(false)}>退出放映</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(PptEditor)
