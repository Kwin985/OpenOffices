import { useEffect, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Deck } from '../lib/ppt'
import StaticSlide from './StaticSlide'

interface Snap {
  deck: Deck
  idx: number
}

const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

export default function Presenter() {
  const [snap, setSnap] = useState<Snap | null>(null)
  const [secs, setSecs] = useState(0)
  const [startAt, setStartAt] = useState<number | null>(null)

  useEffect(() => {
    const un: Array<() => void> = []
    void listen<Snap>('present:sync', (e) => {
      setSnap(e.payload)
      setStartAt((prev) => prev ?? Date.now())
    }).then((fn) => un.push(fn))
    void listen('present:closed', () => void getCurrentWindow().close()).then((fn) => un.push(fn))
    void emit('presenter:ready')
    void getCurrentWindow().show()
    return () => un.forEach((f) => f())
  }, [])

  useEffect(() => {
    if (!startAt) return
    const t = setInterval(() => setSecs(Math.floor((Date.now() - startAt) / 1000)), 1000)
    return () => clearInterval(t)
  }, [startAt])

  if (!snap) {
    return (
      <div className="presenter">
        <div className="presenter-wait">等待放映数据…（在主窗口按 P 或点「演讲者视图」开始）</div>
      </div>
    )
  }
  const { deck, idx } = snap
  const cur = deck.slides[idx]
  const next = deck.slides[idx + 1]
  return (
    <div className="presenter">
      <header className="presenter-head">
        <span className="presenter-title">{deck.title} · 演讲者视图</span>
        <span className="presenter-clock">⏱ {fmt(secs)}</span>
        <span className="presenter-count">
          {idx + 1} / {deck.slides.length}
        </span>
      </header>
      <div className="presenter-main">
        <div className="presenter-cur">
          <StaticSlide big slide={cur} themeId={deck.theme} master={deck.master} />
        </div>
        <div className="presenter-side">
          <div className="presenter-next-wrap">
            <span className="presenter-label">下一页{next ? ` · ${next.title || '(无标题)'}` : ' · 结束'}</span>
            <div className="presenter-next">
              {next && <StaticSlide slide={next} themeId={deck.theme} master={deck.master} />}
            </div>
          </div>
          <div className="presenter-notes-wrap">
            <span className="presenter-label">演讲者备注</span>
            <div className="presenter-notes">{cur.notes || '（本页无备注）'}</div>
          </div>
        </div>
      </div>
      <footer className="presenter-foot">
        <span className="presenter-hint">主窗口 ←/→ 翻页 · 关闭本窗口或放映自动同步</span>
        <button className="tool-btn" onClick={() => void emit('present:quit')}>
          结束放映
        </button>
      </footer>
    </div>
  )
}
