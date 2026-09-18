import { useApp } from './store'
import Home from './components/Home'
import Workspace from './components/Workspace'

export default function App() {
  const view = useApp((s) => s.view)
  const goHome = useApp((s) => s.goHome)
  const tabCount = useApp((s) => s.tabs.length)

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
        <span className="topbar-hint">Rust + Tauri 2 · 全开源内核</span>
      </header>
      <main className="main">{view === 'home' ? <Home /> : <Workspace />}</main>
    </div>
  )
}
