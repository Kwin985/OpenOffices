// 格式刷（v0.173）——只刷「字符长相」，不刷「指向别处的身份」。
//
// WPS / Word 的格式刷看起来是「把这一处的格式搬到那一处」，但有几枚 mark 搬过去会
// 造出假的身份：批注锚（comment/@id）、书签（bookmark/@name）、修订（revIns/revDel
// 带作者与时间）、超链接（link/@href）。复制它们等于在目标文字上再造一枚同 id 的锚，
// 或把别人的修订署名搬到新位置。所以这一族整列排除，只留纯外观：
// bold / italic / underline / strike / textStyle / color / highlight / charSpacing /
// charExtra / rStyle / superscript / subscript …
//
// 另一条诚实边界：段落属性只带 textAlign，且只在源段不是默认左对齐时带。缩进、行距、
// 段前段后、段落边框都是数值型且与页面上下文绑定，照搬会把一篇文档的版心搬歪；
// 这一版不刷，按钮的 tooltip 里写明。
//
// 纯函数，只吃 EditorState / Schema：Node 侧结构测试不用起 UI 就能钉「捕到什么、
// 漏掉什么、还原成什么」。

import type { Mark, Schema } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

/** 身份型 mark：带 id / 作者 / 外部目标，格式刷一律不复制 */
export const PAINT_EXCLUDE = new Set(['comment', 'bookmark', 'revIns', 'revDel', 'link'])

export interface PaintMark {
  type: string
  attrs: Record<string, unknown>
}

export interface PaintFormat {
  marks: PaintMark[]
  /** 源段非默认的对齐档；null = 不动目标的对齐 */
  align: string | null
}

/** 从当前光标/选区起点取一份可复制的格式。选区跨多种格式时取起点那一处，与 WPS 同口径。 */
export function captureFormat(state: EditorState): PaintFormat {
  const source = state.storedMarks ?? state.selection.$from.marks()
  const seen = new Set<string>()
  const marks: PaintMark[] = []
  for (const m of source) {
    if (PAINT_EXCLUDE.has(m.type.name) || seen.has(m.type.name)) continue
    seen.add(m.type.name)
    marks.push({ type: m.type.name, attrs: { ...m.attrs } })
  }
  const raw = state.selection.$from.parent.attrs?.textAlign
  const align = typeof raw === 'string' && raw && raw !== 'left' ? raw : null
  return { marks, align }
}

/** 目标选区上要清掉再重设的 mark 名单（排除身份型，避免误删别人的批注/修订/书签）。 */
export function paintableMarkNames(schema: Schema): string[] {
  return Object.keys(schema.marks).filter((name) => !PAINT_EXCLUDE.has(name))
}

/** 载荷还原成 PM Mark 实例；schema 里没有的类型、属性不合法的一枚跳过，不整笔作废。 */
export function marksForSchema(schema: Schema, payload: PaintFormat): Mark[] {
  const out: Mark[] = []
  for (const m of payload.marks) {
    if (PAINT_EXCLUDE.has(m.type)) continue
    const type = schema.marks[m.type]
    if (!type) continue
    try {
      out.push(type.create(m.attrs ?? {}))
    } catch {
      /* 属性形状与当前 schema 不合：跳过这一枚，其余照刷 */
    }
  }
  return out
}
