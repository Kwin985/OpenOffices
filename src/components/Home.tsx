import { useApp, type DocKind } from '../store'
import { pickOpenFile } from '../lib/fs'
import { openPath } from '../lib/open'

const KIND_META: Record<DocKind, { label: string; icon: string; cls: string; desc: string; sample: string }> = {
  doc: { label: '文档', icon: '文', cls: 'kind-doc', desc: '富文本写作 · docx 导入导出', sample: '未命名文档' },
  sheet: { label: '表格', icon: '表', cls: 'kind-sheet', desc: '类 Excel 编辑 · xlsx 读写', sample: '未命名表格' },
  ppt: { label: '演示', icon: '演', cls: 'kind-ppt', desc: '幻灯片编辑 · pptx 导入导出', sample: '未命名演示' },
  pdf: { label: 'PDF', icon: 'P', cls: 'kind-pdf', desc: 'PDF 查看 · pdf.js 渲染', sample: '' },
}

// pdf 只读不可新建，不进首页卡片
const CREATABLE_KINDS = (Object.keys(KIND_META) as DocKind[]).filter((k) => k !== 'pdf')

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export default function Home() {
  const openTab = useApp((s) => s.openTab)
  const recents = useApp((s) => s.recents)
  const markRecent = useApp((s) => s.markRecent)
  const clearRecents = useApp((s) => s.clearRecents)

  const createNew = (kind: DocKind) => {
    openTab({ kind, title: KIND_META[kind].sample })
  }

  const openFile = async () => {
    const path = await pickOpenFile()
    if (path) openPath(path)
  }

  const openRecent = (path: string, kind: DocKind) => {
    markRecent(path, kind)
    openTab({ kind, title: path.split(/[\\/]/).pop() ?? path, path })
  }

  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-logo">O</div>
        <div>
          <h1>OpenOffices</h1>
          <p>开源驱动的本地办公套件 · 数据不出本机</p>
        </div>
      </div>

      <div className="home-actions">
        <button className="action-btn primary" onClick={openFile}>打开文件</button>
        <button className="action-btn" onClick={() => createNew('doc')}>新建文档</button>
        <button className="action-btn" onClick={() => createNew('sheet')}>新建表格</button>
        <button className="action-btn" onClick={() => createNew('ppt')}>新建演示</button>
      </div>

      <div className="home-cards">
        {CREATABLE_KINDS.map((kind) => {
          const meta = KIND_META[kind]
          return (
            <div key={kind} className={`home-card ${meta.cls}`}>
              <div className="card-icon">{meta.icon}</div>
              <div className="card-body">
                <h3>{meta.label}</h3>
                <p>{meta.desc}</p>
              </div>
              <button className="card-new" onClick={() => createNew(kind)}>新建</button>
            </div>
          )
        })}
      </div>

      <div className="home-recents">
        <div className="recents-header">
          <h3>最近打开</h3>
          {recents.length > 0 && (
            <button className="link-btn" onClick={clearRecents}>清空记录</button>
          )}
        </div>
        {recents.length === 0 ? (
          <p className="recents-empty">暂无记录，打开或新建文件后会显示在这里</p>
        ) : (
          <ul className="recents-list">
            {recents.map((r) => (
              <li key={r.path} className="recent-item" onClick={() => openRecent(r.path, r.kind)}>
                <span className={`recent-icon ${KIND_META[r.kind].cls}`}>{KIND_META[r.kind].icon}</span>
                <div className="recent-meta">
                  <span className="recent-name">{r.path.split(/[\\/]/).pop()}</span>
                  <span className="recent-path">{r.path}</span>
                </div>
                <span className="recent-time">{timeAgo(r.openedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
