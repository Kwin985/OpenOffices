import { confirm } from '@tauri-apps/plugin-dialog'
import { useApp } from '../store'
import { baseName, kindOfPath } from './fs'

export function openPath(path: string): boolean {
  const kind = kindOfPath(path)
  if (!kind) return false
  const { markRecent, openTab } = useApp.getState()
  markRecent(path, kind)
  openTab({ kind, title: baseName(path), path })
  return true
}

export async function requestCloseTab(id: string): Promise<void> {
  const { tabs, closeTab } = useApp.getState()
  const tab = tabs.find((t) => t.id === id)
  if (!tab) return
  if (tab.dirty) {
    const ok = await confirm(`「${tab.title}」尚未保存，关闭前会丢失改动。确定关闭吗？`, {
      title: '关闭标签',
      kind: 'warning',
    })
    if (!ok) return
  }
  closeTab(id)
}
