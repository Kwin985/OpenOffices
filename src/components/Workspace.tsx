import { lazy, Suspense, useEffect, useState } from 'react'
import { useApp, type DocKind } from '../store'
import { requestCloseTab } from '../lib/open'
import { saveTab } from '../lib/registry'

const SheetEditor = lazy(() => import('./SheetEditor'))
const DocEditor = lazy(() => import('./DocEditor'))
const PptEditor = lazy(() => import('./PptEditor'))

const KIND_ICON: Record<DocKind, string> = { doc: '文', sheet: '表', ppt: '演' }
const KIND_CLS: Record<DocKind, string> = { doc: 'kind-doc', sheet: 'kind-sheet', ppt: 'kind-ppt' }

export default function Workspace() {
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const setActive = useApp((s) => s.setActive)
  const openTab = useApp((s) => s.openTab)
  const [menuOpen, setMenuOpen] = useState(false)
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null)
  // 标签首次激活才挂载编辑器（Univer/TipTap 等重型实例按需创建）
  const [mounted, setMounted] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (activeId && !mounted.has(activeId)) {
      setMounted((prev) => new Set(prev).add(activeId))
    }
  }, [activeId, mounted])

  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [ctx])

  const active = tabs.find((t) => t.id === activeId)

  const newTab = (kind: DocKind) => {
    const titles: Record<DocKind, string> = { doc: '未命名文档', sheet: '未命名表格', ppt: '未命名演示' }
    openTab({ kind, title: titles[kind] })
    setMenuOpen(false)
  }

  const closeOthers = async (keepId: string) => {
    for (const t of useApp.getState().tabs) {
      if (t.id !== keepId) await requestCloseTab(t.id)
    }
  }

  return (
    <div className="workspace">
      <div className="tabbar">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab${t.id === activeId ? ' tab-active' : ''}`}
            onClick={() => setActive(t.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtx({ id: t.id, x: e.clientX, y: e.clientY })
            }}
          >
            <span className={`tab-icon ${KIND_CLS[t.kind]}`}>{KIND_ICON[t.kind]}</span>
            <span className="tab-title">{t.title}</span>
            {t.dirty && <span className="tab-dirty">●</span>}
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                void requestCloseTab(t.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div className="tab-new-wrap">
          <button className="tab-new" onClick={() => setMenuOpen((v) => !v)} title="新建">
            ＋
          </button>
          {menuOpen && (
            <div className="tab-menu">
              <button onClick={() => newTab('doc')}>新建文档</button>
              <button onClick={() => newTab('sheet')}>新建表格</button>
              <button onClick={() => newTab('ppt')}>新建演示</button>
            </div>
          )}
        </div>
      </div>
      {ctx && (
        <div className="tab-ctxmenu" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { saveTab(ctx.id); setCtx(null) }}>保存</button>
          <button onClick={() => { void requestCloseTab(ctx.id); setCtx(null) }}>关闭标签</button>
          <button onClick={() => { void closeOthers(ctx.id); setCtx(null) }}>关闭其他标签</button>
        </div>
      )}
      <div className="editor-area">
        {tabs.map((t) => {
          const visible = t.id === active?.id
          return (
            <div
              key={t.id}
              className="editor-slot"
              style={{ display: visible ? 'flex' : 'none' }}
            >
              {mounted.has(t.id) ? (
                <Suspense fallback={<div className="editor-loading">正在加载编辑器…</div>}>
                  {t.kind === 'sheet' && <SheetEditor tab={t} />}
                  {t.kind === 'doc' && <DocEditor tab={t} />}
                  {t.kind === 'ppt' && <PptEditor tab={t} />}
                </Suspense>
              ) : (
                <div className="editor-loading">编辑器待命 · 切换到该标签后初始化</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
