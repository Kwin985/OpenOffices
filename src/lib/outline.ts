// 文档结构图（v0.173）——导航窗格与目录节点共用的唯一一份标题汇总。
//
// 为什么从 toc-extension.ts 抽出来：目录节点（NodeView）要「标题 + 位置」，导航窗格
// 也要同一份，且要多一条「光标现在落在哪一节」。两处各写一遍 doc.descendants 迟早会
// 走散（v0.162 两份名单必须同源那条教训），所以形状定在这一处，NodeView 只管画。
//
// 纯函数、只吃 ProseMirror Node：Node 侧的脚本不用起编辑器就能钉它。

import type { Node as PMNode } from '@tiptap/pm/model'

export interface OutlineEntry {
  /** 1–4；超出档位的字面按边界收，UI 只有四档缩进 */
  level: number
  text: string
  /** 节点在 doc 里的起始位置，供 scrollIntoView 与 setTextSelection 用 */
  pos: number
}

export function outlineOf(doc: PMNode): OutlineEntry[] {
  const out: OutlineEntry[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    const text = node.textContent
    if (!text.trim()) return
    const raw = Number(node.attrs?.level ?? 1)
    const level = Number.isFinite(raw) ? Math.min(4, Math.max(1, Math.trunc(raw))) : 1
    out.push({ level, text, pos })
  })
  return out
}

/** 光标所在那一节：最后一个起点不晚于选区的标题；在第一个标题之前返回 -1。 */
export function activeOutlinePos(entries: OutlineEntry[], selPos: number): number {
  let active = -1
  for (const e of entries) {
    if (e.pos > selPos) break
    active = e.pos
  }
  return active
}
