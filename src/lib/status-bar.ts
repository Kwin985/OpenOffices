// Writer 可交互状态栏（v0.180）——条目表与数值口径的单一事实源。
//
// 与此前 `context-menu.ts` / `print-preview.ts` / `ruler.ts` 同一条纪律：UI 只做接线，
// 「显示什么、点了做什么」在 Node 侧可纯函数钉住。此前状态栏是工具条尾部三段纯文本
// span（消息 / 自动保存时间 / 字数页数），点不动、也没有独立的位置。
//
// 两条纪律：
// 1. **转调不复制**：状态首行走 fail-msg 的 statusText/statusTip，页数走 print-preview
//    的 estimatePages（预览条与状态栏同源），缩放百分比走 view-zoom 的 zoomPct。
// 2. **不碰运行时环境**：Date / Intl / toLocaleTimeString 一律由调用方算好传进来，
//    数字也不做千分位格式化（locale 不同输出就不同，纯函数就不能逐字断言）。

import { statusText, statusTip } from './fail-msg'
import { estimatePages } from './print-preview'
import { zoomPct } from './view-zoom'

export interface StatusBarState {
  status: string
  /** 调用方 `toLocaleTimeString()` 的结果；为空表示还没自动保存过 */
  savedAtText: string
  words: number
  chars: number
  docH: number
  pageH: number
  marginTop: number
  marginBottom: number
  zoom: number
  revOn: boolean
  spellOn: boolean
  previewOpen: boolean
  histOpen: boolean
}

/** 组件按 action 映射到既有入口（不发明新面板、不新开状态） */
export type StatusBarAction =
  | 'openHistory'
  | 'togglePreview'
  | 'toggleRevision'
  | 'toggleSpell'
  | 'zoomOut'
  | 'zoomIn'
  | 'zoomReset'

export type StatusBarKind = 'message' | 'counts' | 'pages' | 'toggle' | 'zoom'

export interface StatusBarItem {
  id: string
  label: string
  title: string
  kind: StatusBarKind
  /** 开态高亮（修订 / 拼写 / 历史 / 预览） */
  active?: boolean
  action?: StatusBarAction
  /** 这枚之后往右推：左侧消息与右侧信息之间留弹性空白 */
  pushLeft?: boolean
}

/** 数字口径：有限值取整、负数归零，绝不走 Intl */
function num(n: number): string {
  return String(Math.max(0, Math.round(Number.isFinite(n) ? n : 0)))
}

export function statusBarMessage(status: string): { text: string; tip: string } {
  return { text: statusText(status), tip: statusTip(status) }
}

export function formatCountsText(words: number, chars: number): string {
  return `字数 ${num(words)} · 字符 ${num(chars)}`
}

export function formatPagesText(pages: number): string {
  return `约 ${num(pages)} 页 · 预览`
}

/** 页数与预览条同源；状态栏只负责把版心几何传进去 */
export function statusBarPages(s: StatusBarState): number {
  return estimatePages(s.docH, s.pageH, s.marginTop, s.marginBottom)
}

export function statusBarZoomText(zoom: number): string {
  return zoomPct(zoom)
}

/**
 * 固定条目表。消息优先于自动保存时间（与此前 `!status && autoSavedAt` 的门一致），
 * 其余从左到右：统计 → 页数（预览）→ 开关三枚 → 缩放三枚。
 */
export function statusBarItems(s: StatusBarState): StatusBarItem[] {
  const msg = statusBarMessage(s.status)
  const out: StatusBarItem[] = []
  if (msg.text) {
    out.push({
      id: 'message', label: msg.text, title: msg.tip || '编辑器当前状态',
      kind: 'message',
    })
  } else if (s.savedAtText) {
    out.push({
      id: 'saved', label: `已自动保存 ${s.savedAtText}`,
      title: '点击查看会话内的历史版本快照', kind: 'message', action: 'openHistory',
    })
  }
  out.push({
    id: 'counts', label: formatCountsText(s.words, s.chars),
    title: '字数 / 字符数由编辑器统计，400ms 节流，不随每次按键全量重扫',
    kind: 'counts', pushLeft: true,
  })
  out.push({
    id: 'pages', label: formatPagesText(statusBarPages(s)),
    title: '按正文高度估算页数；点击打开独立打印预览（可按等距页距翻页定位，屏幕不重排，真分页以打印样式为准）',
    kind: 'pages', action: 'togglePreview', active: s.previewOpen,
  })
  out.push({
    id: 'revision', label: '修订', title: '开关修订模式：之后的插入/删除记账不落定稿',
    kind: 'toggle', action: 'toggleRevision', active: s.revOn,
  })
  out.push({
    id: 'spell', label: '拼写', title: '开关拼写检查（开着会随输入重扫可见文字）',
    kind: 'toggle', action: 'toggleSpell', active: s.spellOn,
  })
  out.push({
    id: 'history', label: '历史版本', title: '会话内快照，每 60 秒自动留存',
    kind: 'toggle', action: 'openHistory', active: s.histOpen,
  })
  out.push({
    id: 'zoomOut', label: '−', title: '缩小一档（只改屏幕纸面，打印始终 100%）',
    kind: 'zoom', action: 'zoomOut',
  })
  out.push({
    id: 'zoomValue', label: statusBarZoomText(s.zoom), title: '点击回到 100%',
    kind: 'zoom', action: 'zoomReset',
  })
  out.push({
    id: 'zoomIn', label: '＋', title: '放大一档（可与 Ctrl+滚轮配合）',
    kind: 'zoom', action: 'zoomIn',
  })
  return out
}
