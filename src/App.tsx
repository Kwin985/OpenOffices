import { Suspense, lazy, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message, confirm } from '@tauri-apps/plugin-dialog'
import { useApp } from './store'
import Home from './components/Home'
import { pickOpenFile } from './lib/fs'
import { openPath, requestCloseTab } from './lib/open'
import { saveTab } from './lib/registry'

const Workspace = lazy(() => import('./components/Workspace'))
const Presenter = lazy(() => import('./components/Presenter'))

const IS_PRESENTER =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('view') === 'presenter'

function cycleTab(dir: 1 | -1) {
  const { tabs, activeId, setActive } = useApp.getState()
  if (tabs.length < 2 || !activeId) return
  const i = tabs.findIndex((t) => t.id === activeId)
  const next = (i + dir + tabs.length) % tabs.length
  setActive(tabs[next].id)
}

export default function App() {
  if (!IS_PRESENTER) return <MainApp />
  return (
    <Suspense fallback={<div className="editor-loading">正在加载演讲者视图…</div>}>
      <Presenter />
    </Suspense>
  )
}

function MainApp() {
  const view = useApp((s) => s.view)
  const theme = useApp((s) => s.theme)
  const goHome = useApp((s) => s.goHome)
  const tabCount = useApp((s) => s.tabs.length)
  const toggleTheme = useApp((s) => s.toggleTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const { activeId, view: v, openTab } = useApp.getState()
      const k = e.key.toLowerCase()
      if (k === 's' && v === 'workspace' && activeId) {
        e.preventDefault()
        saveTab(activeId, e.shiftKey)
      } else if (k === 'o') {
        e.preventDefault()
        void pickOpenFile().then((p) => {
          if (p) openPath(p)
        })
      } else if (k === 'w' && activeId) {
        e.preventDefault()
        void requestCloseTab(activeId)
      } else if (k === 'n') {
        e.preventDefault()
        openTab({ kind: 'doc', title: '未命名文档' })
      } else if (k === 'tab') {
        e.preventDefault()
        cycleTab(e.shiftKey ? -1 : 1)
      } else if (e.key === 'PageDown') {
        e.preventDefault()
        cycleTab(1)
      } else if (e.key === 'PageUp') {
        e.preventDefault()
        cycleTab(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    void getCurrentWebview()
      .onDragDropEvent((ev) => {
        if (ev.payload.type === 'drop') {
          for (const p of ev.payload.paths) {
            if (!openPath(p)) void message(`暂不支持直接打开：${p}`, { title: '拖拽打开' })
          }
        }
      })
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  // 文件关联：启动 argv 里的路径一次性取走；后续双击由单实例插件转发过来
  useEffect(() => {
    void invoke<string[]>('take_startup_files')
      .then((paths) => {
        for (const p of paths) openPath(p)
      })
      .catch(() => {})
    let unlisten: (() => void) | undefined
    let disposed = false
    void listen<string[]>('oof://open-paths', (ev) => {
      for (const p of ev.payload) openPath(p)
    }).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    void getCurrentWindow()
      .onCloseRequested(async (ev) => {
        const { tabs } = useApp.getState()
        if (tabs.some((t) => t.dirty)) {
          const ok = await confirm('存在未保存的文件，退出将丢失改动。确定退出吗？', {
            title: '退出 OpenOffices',
            kind: 'warning',
          })
          if (!ok) ev.preventDefault()
        }
      })
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand" onClick={goHome}>
          <span className="brand-badge">O</span>
          <span className="brand-name">OpenOffices</span>
        </div>
        <nav className="topbar-nav">
          <button className={`nav-btn${view === 'home' ? ' nav-active' : ''}`} onClick={goHome}>
            首页
          </button>
          {tabCount > 0 && (
            <button className={`nav-btn${view === 'workspace' ? ' nav-active' : ''}`} onClick={() => useApp.setState({ view: 'workspace' })}>
              工作区 · {tabCount}
            </button>
          )}
        </nav>
        <span className="topbar-hint">
          Ctrl+O 打开 · Ctrl+S 保存 · Ctrl+N 新建 · Ctrl+W 关闭标签
        </span>
        <button className="nav-btn theme-btn" onClick={toggleTheme} title="切换深色/浅色主题">
          {theme === 'dark' ? '☀ 浅色' : '🌙 深色'}
        </button>
      </header>
      <main className="main">
        {view === 'home' ? (
          <Home />
        ) : (
          <Suspense fallback={<div className="editor-loading">正在加载编辑器…</div>}>
            <Workspace />
          </Suspense>
        )}
      </main>
    </div>
  )
}
