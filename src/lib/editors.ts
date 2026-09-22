import type { ComponentType } from 'react'
import type { DocKind, Tab } from '../store'

export type EditorComp = ComponentType<{ tab: Tab }>

// 四类编辑器：动态 import 由这里独占，空闲预热与挂载点共用同一份模块 promise。
const LOADERS: Record<DocKind, () => Promise<{ default: EditorComp }>> = {
  sheet: () => import('../components/SheetEditor'),
  doc: () => import('../components/DocEditor'),
  ppt: () => import('../components/PptEditor'),
  pdf: () => import('../components/PdfViewer'),
}

// 已解析组件表：谁先到谁填（预热先到就预热填）。填过的 kind 之后是**同步**命中。
const resolved = new Map<DocKind, EditorComp>()

/** 同步取已解析的编辑器；没解析过返回 undefined（调用方走 loadEditor 等一次） */
export function peekEditor(kind: DocKind): EditorComp | undefined {
  return resolved.get(kind)
}
export async function loadEditor(kind: DocKind): Promise<EditorComp> {
  const hit = resolved.get(kind)
  if (hit) return hit
  const m = await LOADERS[kind]()
  const comp = m.default
  resolved.set(kind, comp)
  return comp
}

// 工作区外壳同理，而且更值：App 原先用 React.lazy + Suspense 包 Workspace，React 对
// 「兜底→内容」有一条兜底可见性节流，发布包打点实测——Workspace 79ms 就渲染完了，
// 内容却到 349ms 才提交进 DOM，首屏白等约 270ms。自己持有已解析组件就不受这条规则管。
let workspace: ComponentType | null = null
let workspaceTask: Promise<ComponentType> | null = null

/** 同步取已解析的工作区；没解析过返回 null（调用方走 loadWorkspace 等一次） */
export function peekWorkspace(): ComponentType | null {
  return workspace
}

export function loadWorkspace(): Promise<ComponentType> {
  if (workspace) return Promise.resolve(workspace)
  workspaceTask ??= import('../components/Workspace').then((m) => {
    workspace = m.default
    return workspace
  })
  return workspaceTask
}
