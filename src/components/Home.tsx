import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getVersion } from '@tauri-apps/api/app'
import { useApp, type DocKind } from '../store'
import { pickOpenFile, pickSaveFile, readText, writeText } from '../lib/fs'
import { encryptRecents, decryptRecents } from '../lib/sync'
import { openPath } from '../lib/open'
import { failText } from '../lib/fail-msg'
import { TEMPLATES } from '../lib/templates'
import { checkForUpdate, type UpdateState } from '../lib/update'

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
  const mergeRecents = useApp((s) => s.mergeRecents)
  const [pass, setPass] = useState('')
  const [syncStatus, setSyncStatus] = useState('')
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateState | null>(null)

  useEffect(() => {
    // 版本号取自安装包本身（不是构建时常量）：用户要确认的是"我装的这一个"新不新
    getVersion()
      .then(setVersion)
      .catch(() => setVersion('未知'))
  }, [])

  const runUpdateCheck = async () => {
    setUpdate({ state: 'checking' })
    setUpdate(await checkForUpdate())
  }

  const exportSync = async () => {
    if (!pass) {
      setSyncStatus('请先输入同步口令')
      return
    }
    const path = await pickSaveFile('recents.oosync', ['oosync'])
    if (!path) return
    try {
      const { recents } = useApp.getState()
      await writeText(path, await encryptRecents(recents, pass))
      setSyncStatus(`已导出加密副本：${path.split(/[\\/]/).pop()}（${recents.length} 条）`)
    } catch (e) {
      setSyncStatus(`导出失败：${failText(e)}`)
    }
  }

  const importSync = async () => {
    if (!pass) {
      setSyncStatus('请先输入同步口令')
      return
    }
    const selected = await open({ multiple: false, filters: [{ name: '同步文件', extensions: ['oosync'] }] })
    if (typeof selected !== 'string') return
    try {
      const incoming = await decryptRecents(await readText(selected), pass)
      const added = mergeRecents(incoming)
      setSyncStatus(`合并完成：导入 ${incoming.length} 条，新增 ${added} 条`)
    } catch (e) {
      setSyncStatus(`导入失败：${failText(e)}`)
    }
  }

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
          <div className="home-update">
            <span className="update-version">版本 {version || '…'}</span>
            <button className="link-btn" onClick={() => void runUpdateCheck()} disabled={update?.state === 'checking'}>
              {update?.state === 'checking' ? '检查中…' : '检查更新'}
            </button>
            {update?.state === 'latest' && <span className="update-status">已是最新版本</span>}
            {update?.state === 'failed' && (
              <span className="update-status error" title={update.message}>
                {update.message}
              </span>
            )}
            {update?.state === 'available' && (
              <>
                <span className="update-status">
                  发现新版本 {update.info.version}
                  {update.info.date ? `（${update.info.date}）` : ''}
                </span>
                {update.info.notes && (
                  <span className="update-notes" title={update.info.notes}>
                    {update.info.notes}
                  </span>
                )}
                {update.info.page ? (
                  <button className="link-btn" onClick={() => void openUrl(update.info.page)}>
                    前往下载页
                  </button>
                ) : (
                  // 清单没写 download_page 时不猜地址：宁可不给按钮，也不给一个拼出来的 URL
                  <span className="update-status">该版本未提供下载页地址</span>
                )}
              </>
            )}
          </div>
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

      <div className="home-templates">
        <h3>从模板新建</h3>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => {
            const meta = KIND_META[t.kind]
            return (
              <button key={t.id} className="tpl-card" onClick={() => openTab({ kind: t.kind, title: t.name, template: t.id })}>
                <span className={`tpl-icon ${meta.cls}`}>{meta.icon}</span>
                <span className="tpl-info">
                  <span className="tpl-name">{t.name}</span>
                  <span className="tpl-desc">{t.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="home-recents">
        <div className="recents-header">
          <h3>最近打开</h3>
          {recents.length > 0 && (
            <button className="link-btn" onClick={clearRecents}>清空记录</button>
          )}
        </div>
        <div className="recents-sync">
          <input
            type="password"
            className="sync-pass"
            placeholder="同步口令（端到端加密）"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <button className="link-btn" onClick={() => void exportSync()}>导出加密副本</button>
          <button className="link-btn" onClick={() => void importSync()}>从加密副本合并</button>
          {syncStatus && <span className="sync-status">{syncStatus}</span>}
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
