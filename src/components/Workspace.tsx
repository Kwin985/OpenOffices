import { useState } from 'react'
import { useApp, type DocKind } from '../store'
import SheetEditor from './SheetEditor'
import DocEditor from './DocEditor'
import PptEditor from './PptEditor'

const KIND_ICON: Record<DocKind, string> = { doc: '文', sheet: '表', ppt: '演' }
const KIND_CLS: Record<DocKind, string> = { doc: 'kind-doc', sheet: 'kind-sheet', ppt: 'kind-ppt' }

export default function Workspace() {
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const setActive = useApp((s) => s.setActive)
  const closeTab = useApp((s) => s.closeTab)
  const openTab = useApp((s) => s.openTab)
  const [menuOpen, setMenuOpen] = useState(false)

  const active = tabs.find((t) => t.id === activeId)

  const newTab = (kind: DocKind) => {
    const titles: Record<DocKind, string> = { doc: '未命名文档', sheet: '未命名表格', ppt: '未命名演示' }
    openTab({ kind, title: titles[kind] })
    setMenuOpen(false)
  }

  return (
    <div className="workspace">
      <div className="tabbar">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab${t.id === activeId ? ' tab-active' : ''}`}
            onClick={() => setActive(t.id)}
          >
            <span className={`tab-icon ${KIND_CLS[t.kind]}`}>{KIND_ICON[t.kind]}</span>
            <span className="tab-title">{t.title}</span>
            {t.dirty && <span className="tab-dirty">●</span>}
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
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
      <div className="editor-area">
        {tabs.map((t) => (
          <div key={t.id} className="editor-slot" style={{ display: t.id === active?.id ? 'flex' : 'none' }}>
            {t.kind === 'sheet' && <SheetEditor tab={t} />}
            {t.kind === 'doc' && <DocEditor tab={t} />}
            {t.kind === 'ppt' && <PptEditor tab={t} />}
          </div>
        ))}
      </div>
    </div>
  )
}
