import { create } from 'zustand'

export type DocKind = 'doc' | 'sheet' | 'ppt' | 'pdf'

export interface Tab {
  id: string
  kind: DocKind
  title: string
  path?: string
  dirty: boolean
}

export interface RecentFile {
  path: string
  kind: DocKind
  openedAt: number
}

interface AppState {
  view: 'home' | 'workspace'
  tabs: Tab[]
  activeId?: string
  recents: RecentFile[]
  theme: 'light' | 'dark'
  openTab: (tab: Omit<Tab, 'id' | 'dirty'>) => void
  closeTab: (id: string) => void
  setActive: (id: string) => void
  goHome: () => void
  renameTab: (id: string, title: string, path?: string) => void
  markDirty: (id: string, dirty: boolean) => void
  markRecent: (path: string, kind: DocKind) => void
  mergeRecents: (incoming: RecentFile[]) => number
  clearRecents: () => void
  toggleTheme: () => void
}

const RECENTS_KEY = 'openoffices.recents'
const THEME_KEY = 'openoffices.theme'

function loadRecents(): RecentFile[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')
  } catch {
    return []
  }
}

let seq = 0

export const useApp = create<AppState>((set, get) => ({
  view: 'home',
  tabs: [],
  activeId: undefined,
  recents: loadRecents(),
  theme: localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light',
  openTab: (tab) => {
    const existing = get().tabs.find(
      (t) => tab.path ? t.path === tab.path : false,
    )
    if (existing) {
      set({ view: 'workspace', activeId: existing.id })
      return
    }
    const id = `tab-${Date.now()}-${seq++}`
    set((s) => ({
      view: 'workspace',
      tabs: [...s.tabs, { ...tab, id, dirty: false }],
      activeId: id,
    }))
  },
  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeId = s.activeId
      if (activeId === id) {
        activeId = tabs[tabs.length - 1]?.id
      }
      const view = tabs.length === 0 ? 'home' : s.view
      return { tabs, activeId, view }
    }),
  setActive: (id) => set({ activeId: id }),
  goHome: () => set({ view: 'home' }),
  renameTab: (id, title, path) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, title, path: path ?? t.path, dirty: false } : t,
      ),
    })),
  markDirty: (id, dirty) =>
    set((s) => {
      const t = s.tabs.find((x) => x.id === id)
      // Univer 每条命令都会回调 markDirty，状态没变就不触发订阅
      if (!t || t.dirty === dirty) return s
      return {
        tabs: s.tabs.map((x) => (x.id === id ? { ...x, dirty } : x)),
      }
    }),
  markRecent: (path, kind) =>
    set((s) => {
      const recents = [
        { path, kind, openedAt: Date.now() },
        ...s.recents.filter((r) => r.path !== path),
      ].slice(0, 30)
      localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
      return { recents }
    }),
  mergeRecents: (incoming) => {
    const { recents } = get()
    const known = new Set(recents.map((r) => r.path))
    const added = incoming.filter((r) => !known.has(r.path)).length
    const byPath = new Map<string, RecentFile>()
    for (const r of [...recents, ...incoming]) {
      const prev = byPath.get(r.path)
      if (!prev || r.openedAt > prev.openedAt) byPath.set(r.path, r)
    }
    const merged = [...byPath.values()]
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, 30)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(merged))
    set({ recents: merged })
    return added
  },
  clearRecents: () => {
    localStorage.removeItem(RECENTS_KEY)
    set({ recents: [] })
  },
  toggleTheme: () =>
    set((s) => {
      const theme = s.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, theme)
      return { theme }
    }),
}))
