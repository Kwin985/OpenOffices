import { useEffect, useRef, useState } from 'react'
import { useApp, type DocKind, type Tab } from '../store'
import { requestCloseTab } from '../lib/open'
import { saveTab } from '../lib/registry'
import { loadEditor, peekEditor, type EditorComp } from '../lib/editors'

// 编辑器不经 React.lazy + Suspense：自己持有已解析的组件（见 lib/editors）。
// React 对 Suspense 边界有一条「兜底至少可见 ~300ms」的节流，同一次构建的 A/B 实测：
// 每标签一个 Suspense 边界时表格冷开 875ms，换成自解析组件 588ms（差的那 287ms 就是节流）。
// 空闲预热（lib/prewarm.ts）通常已把组件备好，`peekEditor` 同步命中，标签出现的那一次渲染
// 就把编辑器挂上；没命中才走 `loadEditor` 等一次。另外每标签各自一条加载线，也不再共用一个
// 边界（新增文档标签不会把已在显示的表格闪成兜底）。
function EditorMount({ tab }: { tab: Tab }) {
  const [Comp, setComp] = useState<EditorComp | undefined>(() => peekEditor(tab.kind))
  useEffect(() => {
    if (Comp) return
    let alive = true
    loadEditor(tab.kind).then((c) => {
      // 组件本身是函数，必须包一层才不被当成 updater
      if (alive) setComp(() => c)
    })
    return () => {
      alive = false
    }
  }, [tab.kind, Comp])
  if (Comp) return <Comp tab={tab} />
  return <div className="editor-loading">正在加载编辑器…</div>
}

const KIND_ICON: Record<DocKind, string> = { doc: '文', sheet: '表', ppt: '演', pdf: 'P' }
const KIND_CLS: Record<DocKind, string> = { doc: 'kind-doc', sheet: 'kind-sheet', ppt: 'kind-ppt', pdf: 'kind-pdf' }

export default function Workspace() {
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const setActive = useApp((s) => s.setActive)
  const openTab = useApp((s) => s.openTab)
  const [menuOpen, setMenuOpen] = useState(false)
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null)
  // 标签首次激活才挂载编辑器（Univer/TipTap 等重型实例按需创建）。
  // 判定落在渲染期：effect 里记 mounted 再 setState 会多要一整轮渲染，冷开时白等一跳。
  // 登记放进渲染里做（幂等的 Set.add），标签出现的那一次渲染就把编辑器挂上。
  // 注：早先这里写过「那一跳固定花 ~300ms」，归因错了——300ms 是外壳 App 的 Suspense 兜底
  // 节流（App 的 WorkspaceSlot 已改成自解析组件），不是这轮 effect；节流已删，此处只省下一次空转渲染。
  const liveRef = useRef<Set<string>>(new Set())

  // 空闲预热已提到 App（首页也要预热），见 lib/prewarm.ts

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
    const titles: Record<DocKind, string> = { doc: '未命名文档', sheet: '未命名表格', ppt: '未命名演示', pdf: 'PDF 查看' }
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
          const live = visible || liveRef.current.has(t.id)
          if (live) liveRef.current.add(t.id)
          return (
            <div
              key={t.id}
              className="editor-slot"
              style={{ display: visible ? 'flex' : 'none' }}
            >
              {live ? (
                <EditorMount tab={t} />
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
