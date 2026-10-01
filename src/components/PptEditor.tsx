import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { message } from '@tauri-apps/plugin-dialog'
import { emit, listen } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { Tab } from '../store'
import { useApp } from '../store'
import { readBytes, readText, writeBytes, writeText, pickSaveFile, baseName } from '../lib/fs'
import {
  emptyDeck,
  exitCount,
  newSlide,
  parseDeck,
  revealSteps,
  serializeDeck,
  themeOf,
  LAYOUT_NAMES,
  TRANSITION_NAMES,
  BULLET_ANIM_NAMES,
  ANIM_DIR_NAMES,
  BULLET_EXIT_NAMES,
  THEMES,
  type AnimDir,
  type BulletAnim,
  type BulletExit,
  type Deck,
  type Slide,
  type SlideLayout,
  type SlideTransition,
} from '../lib/ppt'
import { deckToPptxBytes } from '../lib/pptx-export'
import { pptxBytesToDeck } from '../lib/pptx-import'
import { exportPdfWithOverlay } from '../lib/pdfprint'
import { registerSaver, runExclusive } from '../lib/registry'
import { failDialog, failStatus, statusText, statusTip } from '../lib/fail-msg'
import { saveDoneTimer } from '../lib/save-status'
import { autoDelayMs, autoFailStatus, autoOkTip, createAutoSaveLedger, staleFailureClaim } from '../lib/auto-save'
import type { FailureClaim } from '../lib/auto-save'
import { pptTemplate } from '../lib/templates'
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
  const [deck, setDeck] = useState<Deck>(() => (tab.template ? pptTemplate(tab.template) : emptyDeck()))
  const [cur, setCur] = useState(0)
  const [present, setPresent] = useState(false)
  const [presentIdx, setPresentIdx] = useState(0)
  const [revealed, setRevealed] = useState(1) // 逐条揭示：当前页已显示的要点数
  const revealedRef = useRef(1)
  const [showNotes, setShowNotes] = useState(false)
  const [status, setStatus] = useState<string>(tab.path ? '正在加载…' : '')
  const [loaded, setLoaded] = useState(!tab.path)
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null)
  // 这一格上挂着的"这个文件没存上"那句：句子 + 它说的是哪个路径（与文档头同一条规矩，v0.76）
  const saveFailRef = useRef<FailureClaim | null>(null)
  // 定时那一路的失败账与延迟吃模块那一份（与文档头同一套规矩，v0.75），每枚标签一份：
  // 共享一份账会让一件的失败把另一件的时钟推后，而标签是全部常驻挂载的（v0.68）
  const autoLedgerRef = useRef<ReturnType<typeof createAutoSaveLedger> | null>(null)
  if (!autoLedgerRef.current) autoLedgerRef.current = createAutoSaveLedger()
  const auto = autoLedgerRef.current
  // 「撤掉在途那枚时钟、按账重挂一枚」的通道，由下面那一路定时效果交出来（与文档头同一条）
  const autoRescheduleRef = useRef<(() => void) | null>(null)
  const renameTab = useApp((s) => s.renameTab)
  const markDirty = useApp((s) => s.markDirty)
  const markRecent = useApp((s) => s.markRecent)
  const dirtyRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // 收尾那句的时钟吃模块那一份（表格头 v0.69、PDF 头 v0.70、文档头 v0.71 都是它）：
  // 这一头原先自持三枚裸 1500/2000/1500，隔 1 秒连按两次时第一趟的裸 1500 会把第二趟那句提前抹掉
  // （v0.72 实测 R3：第二句只活 481~491ms）。进度门这一头不挂——三档整趟实测 5/8~9/13~14ms、longtask 0 条
  const doneRef = useRef<ReturnType<typeof saveDoneTimer> | null>(null)
  if (!doneRef.current) doneRef.current = saveDoneTimer(setStatus)
  const done = doneRef.current
  const deckRef = useRef(deck)
  deckRef.current = deck

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
        setStatus(failStatus(e, '加载失败'))
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

  // 逐条揭示 / 翻页：anim 页先揭示下一条，揭示满后若有出场再逐条退去，步数用尽才换页
  const revealNext = () => {
    const s = snapRef.current.deck.slides[snapRef.current.idx]
    const stepMax = s ? revealSteps(s) : 0
    if (s?.anim && stepMax > 0 && revealedRef.current < stepMax) {
      revealedRef.current += 1
      setRevealed(revealedRef.current)
      return
    }
    if (snapRef.current.idx < snapRef.current.deck.slides.length - 1) {
      revealedRef.current = 1
      setRevealed(1)
      setPresentIdx(snapRef.current.idx + 1)
    }
  }
  const revealPrev = () => {
    revealedRef.current = 1
    setRevealed(1)
    setPresentIdx((i) => Math.max(i - 1, 0))
  }

  // 放映按键
  useEffect(() => {
    if (!present) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresent(false)
      else if (e.key === 'n' || e.key === 'N') setShowNotes((v) => !v)
      else if (e.key === 'p' || e.key === 'P') void togglePresenter()
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') revealNext()
      else if (e.key === 'ArrowLeft' || e.key === 'Backspace') revealPrev()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present, deck.slides.length])

  // 自动换页计时（advTm 同源字段）
  useEffect(() => {
    if (!present) return
    const s = deck.slides[presentIdx]
    if (!s?.autoAdvance || presentIdx >= deck.slides.length - 1) return
    const t = setTimeout(() => {
      revealedRef.current = 1
      setRevealed(1)
      setPresentIdx((i) => Math.min(i + 1, deck.slides.length - 1))
    }, s.autoAdvance * 1000)
    return () => clearTimeout(t)
  }, [present, presentIdx, deck])

  // 演讲者视图：第二窗口 + 事件同步
  const snapRef = useRef({ present, idx: presentIdx, deck, revealed })
  snapRef.current = { present, idx: presentIdx, deck, revealed }

  useEffect(() => {
    if (!present) {
      void emit('present:closed')
      return
    }
    void emit('present:sync', { deck, idx: presentIdx, revealed })
  }, [present, presentIdx, deck, revealed])

  useEffect(() => {
    const un: Array<() => void> = []
    void listen('presenter:ready', () => {
      const s = snapRef.current
      if (s.present) void emit('present:sync', { deck: s.deck, idx: s.idx, revealed: s.revealed })
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
    // 下一趟开跑先撤上一句的收尾时钟（否则它会在这一句说话说到一半时把屏抹成空白）
    done.cancel()
    // 这一趟要写的到底是哪个文件——失败那句要按路径认领，所以它得活到 catch 里（与文档头同一条，v0.76）
    let target: string | undefined
    try {
      let path = asNew ? undefined : tab.path
      if (!path || /\.pptx?$/i.test(path)) {
        path = (await pickSaveFile(`${deck.title || '演示'}.opd`, ['opd'])) ?? undefined
        if (!path) return
      }
      target = path
      await writeText(path, serializeDeck(deck))
      renameTab(tab.id, baseName(path), path)
      markRecent(path, 'ppt')
      // 用户自己按成功了 ⇒ 定时那一路的退避归零并重挂一枚（与文档头同一条规矩，v0.75），
      // 但不进自动保存的次数账
      auto.clearBackoff()
      autoRescheduleRef.current?.()
      // 文件现在真的在盘上了 ⇒ 这一格上不再欠任何一句"没存上"
      saveFailRef.current = null
      done.show([])
    } catch (e) {
      // 失败那句顶掉上一句，原话留在悬停 title 里（v0.64 的规矩）。
      // v0.72 之前这一路只弹阻塞式原生模态：实测只读件按 Ctrl+S 之后状态栏全程一句都没说
      // （文本拍只有 [null]），而那一枚 #32770 要把主线程占到用户点 OK 为止
      done.cancel()
      const msg = failStatus(e, '保存失败')
      saveFailRef.current = { msg, path: target ?? '' }
      setStatus(msg)
    }
  }

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => registerSaver(tab.id, (asNew) => saveRef.current(asNew)), [tab.id])

  // .opd 已落盘路径的自动保存（新片没挑过路径、.pptx 静默写盘会把保真丢了：这两档都走手动保存）。
  // 四条规矩照 v0.73 的 .odoc 那一路：跳过不脏、只在写成功之后 markDirty+setAutoSavedAt、
  // 只撤自己那句（手动存盘的「已保存」不归它管）、失败上状态栏顶掉过期时间且下次仍重试。
  // 这一头的句子说的仍是「最近一次自动保存的结果」，不挂进度门、也不共用模块那枚 saveDoneTimer——
  // v0.72 前置实测这一路整趟 5~14ms、longtask 0 条，30 秒才是常态；1500ms 收尾反而会把失败那句抹掉。
  // v0.74 新增：走 registry 的 runExclusive，与手动 Ctrl+S 共用同一把在途锁。
  // v0.75 新增：延迟由 lib/auto-save.ts 的账给（连续失败翻倍、240 秒封顶），定时器自续；
  // 与文档头共用同一套公式 ⇒ 两头说的话与节奏不会分叉（v0.74 的回归判据就是这一条同步）。
  useEffect(() => {
    if (!loaded) return
    const p = tab.path
    if (!p?.toLowerCase().endsWith('.opd')) return
    let stopped = false
    let timer: number | undefined
    const schedule = () => {
      timer = window.setTimeout(async () => {
        const s = useApp.getState()
        if (s.tabs.some((t) => t.id === tab.id && t.dirty)) {
          await runExclusive(tab.id, async () => {
            try {
              await writeText(p, serializeDeck(deckRef.current))
              s.markDirty(tab.id, false)
              dirtyRef.current = false
              auto.noteSuccess()
              setAutoSavedAt(new Date())
              // 撤掉这一格上"关于这个文件没存上"的那句（与文档头同一条规矩，v0.76）：
              // 手动那句说的就是同一个路径，而它现在过期了；别的文件/别的动作的句子仍然不许抹
              const stale = staleFailureClaim(saveFailRef.current, p)
              if (stale) {
                saveFailRef.current = null
                setStatus((cur) => (cur === stale ? '' : cur))
              }
            } catch (e) {
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
    // 交给手动存盘那一路：撤掉在途的这一枚，按当前的账重挂一枚（与文档头同一条规矩，v0.75）
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
  }, [loaded, tab.path, tab.id])

  const exportPptx = async () => {
    try {
      const path = await pickSaveFile(`${deck.title || '演示'}.pptx`, ['pptx'])
      if (!path) return
      await writeBytes(path, await deckToPptxBytes(deck))
      markRecent(path, 'ppt')
      // 导出是另拷一份出去，不替标签记「已保存」的账（不清 ●），但收尾那句吃同一个时钟：
      // base 由按下的那个动作给（v0.71 开的那个口子）。这一句的停留因此从自持的 2000 变成模块的 1500
      done.show([], '已导出 pptx')
    } catch (e) {
      await message(failDialog(e), { title: '导出失败', kind: 'error' })
    }
  }

  // 每张幻灯片一页（1280×720 = 338.7mm×190.5mm 零边距），StaticSlide 离屏挂载走打印覆盖层
  const exportPdfTo = async (path: string) => {
    const box = document.createElement('div')
    const slides = deck.slides
    const root = createRoot(box)
    root.render(
      slides.map((s) => (
        <div className="ppt-print-page" key={s.id}>
          <StaticSlide slide={s} themeId={deck.theme} master={deck.master} />
        </div>
      )),
    )
    try {
      await exportPdfWithOverlay(path, box, {
        // 全出血：边距 0 由 pdfprint 同时写进 CSS @page 与 PrintSettings，两通道同一组数
        marginsInches: 0,
        pageSizeInches: [13.335, 7.5], // 338.7×190.5mm，正好容纳 1280×720px 幻灯片
      })
      markRecent(path, 'pdf')
      done.show([], '已导出 PDF')
    } finally {
      root.unmount()
    }
  }
  const exportPdfToRef = useRef(exportPdfTo)
  exportPdfToRef.current = exportPdfTo

  const exportPdf = async () => {
    try {
      const path = await pickSaveFile(
        (tab.path ? baseName(tab.path).replace(/\.[^.]+$/, '') : deck.title || '演示') + '.pdf',
        ['pdf'],
      )
      if (!path) return
      setStatus('正在生成 PDF…')
      await exportPdfTo(path)
    } catch (e) {
      setStatus('')
      await message(failDialog(e), { title: '导出 PDF 失败', kind: 'error' })
    }
  }

  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>
    w.__oofPpt = { exportPdfTo: (p: string) => exportPdfToRef.current(p), setDeck, getDeck: () => deck }
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
          {status && (
            <span className="editor-status" title={statusTip(status)}>
              {statusText(status)}
            </span>
          )}
        </div>
        <div className="ppt-loading" title={status ? statusTip(status) : undefined}>
          {status ? statusText(status) : '正在加载…'}
        </div>
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
        <button className="tool-btn" onClick={() => void exportPdf()} title="每张幻灯片一页横向输出">导出 PDF</button>
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
        <select
          className="tool-select"
          value={slide.anim ?? ''}
          onChange={(e) =>
            editSlide(cur, (s) => {
              const v = (e.target.value || undefined) as BulletAnim | undefined
              if (v !== s.anim) {
                s.animDir = undefined
                s.exitAnim = undefined
              }
              if (v === 'fade' || !v) s.animDir = undefined
              s.anim = v
            })
          }
          title="本页要点逐条入场动画（放映时点击逐条揭示）"
        >
          <option value="">逐条 · 无</option>
          {(Object.entries(BULLET_ANIM_NAMES) as [BulletAnim, string][]).map(([k, n]) => (
            <option key={k} value={k}>逐条 · {n}</option>
          ))}
        </select>
        {slide.anim && slide.anim !== 'fade' && (
          <select
            className="tool-select"
            value={slide.animDir ?? 'bottom'}
            onChange={(e) =>
              editSlide(cur, (s) => {
                s.animDir = e.target.value as AnimDir
              })
            }
            title="逐条入场方向（导出映射 PowerPoint presetSubtype 与位移/擦除方向）"
          >
            {(Object.entries(ANIM_DIR_NAMES) as [AnimDir, string][]).map(([k, n]) => (
              <option key={k} value={k}>{n}</option>
            ))}
          </select>
        )}
        {slide.anim && (
          <select
            className="tool-select"
            value={slide.exitAnim ?? ''}
            onChange={(e) =>
              editSlide(cur, (s) => {
                s.exitAnim = (e.target.value || undefined) as BulletExit | undefined
              })
            }
            title="逐条出场：揭示满后每击退一条（导出为 PowerPoint exit clickEffect）"
          >
            <option value="">出场 · 无</option>
            {(Object.entries(BULLET_EXIT_NAMES) as [BulletExit, string][]).map(([k, n]) => (
              <option key={k} value={k}>出场 · {n}</option>
            ))}
          </select>
        )}
        <label className="tool-num" title="放映时到秒自动换页；随 pptx advTm 往返">
          换页
          <input
            className="tool-num-input"
            type="number"
            min={1}
            max={3600}
            value={slide.autoAdvance ?? ''}
            onChange={(e) =>
              editSlide(cur, (s) => {
                const v = Number(e.target.value)
                s.autoAdvance = Number.isFinite(v) && v > 0 ? Math.min(3600, Math.round(v)) : undefined
              })
            }
          />
          秒
        </label>
        <button
          className="tool-btn tool-btn-primary"
          onClick={() => {
            setPresentIdx(cur)
            setShowNotes(false)
            revealedRef.current = 1
            setRevealed(1)
            setPresent(true)
          }}
        >
          放映
        </button>
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
            <StaticSlide
              big
              slide={deck.slides[presentIdx]}
              themeId={deck.theme}
              master={deck.master}
              visibleLines={deck.slides[presentIdx]?.anim ? revealed : undefined}
              anim={deck.slides[presentIdx]?.anim}
              animDir={deck.slides[presentIdx]?.animDir}
              exitCount={deck.slides[presentIdx] ? exitCount(deck.slides[presentIdx]!, revealed) : 0}
              exitAnim={deck.slides[presentIdx]?.exitAnim}
            />
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
