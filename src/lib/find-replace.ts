// 查找/替换：整文档按文本块匹配（段内跨 mark 可命中，跨段不命中），命中集存插件 state；
// "当前项"由选区派生（findNext/findPrev 就是把选区挪到命中区间），装饰高亮，替换走 insertText 保 marks。
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export interface FrMatch {
  from: number
  to: number
}

interface FrResult {
  query: string
  caseSensitive: boolean
  matches: FrMatch[]
}

export const frPluginKey = new PluginKey<FrResult>('findReplace')

function matchBlock(block: PMNode, blockPos: number, needle: string, caseSensitive: boolean, out: FrMatch[]) {
  const runs: { start: number; end: number; docFrom: number }[] = []
  let full = ''
  block.descendants((c, cpos) => {
    if (!c.isText) return false
    const len = c.text?.length ?? 0
    runs.push({ start: full.length, end: full.length + len, docFrom: blockPos + 1 + cpos })
    full += c.text ?? ''
    return false
  })
  if (!runs.length) return
  const hay = caseSensitive ? full : full.toLowerCase()
  let i = hay.indexOf(needle)
  while (i >= 0) {
    const j = i + needle.length
    let from = -1
    let to = -1
    for (const r of runs) {
      if (from < 0 && i >= r.start && i < r.end) from = r.docFrom + (i - r.start)
      if (from >= 0 && j > r.start && j <= r.end) {
        to = r.docFrom + (j - r.start)
        break
      }
    }
    if (from >= 0 && to > from) out.push({ from, to })
    i = hay.indexOf(needle, j)
  }
}

export function collectMatches(doc: PMNode, query: string, caseSensitive: boolean): FrMatch[] {
  const out: FrMatch[] = []
  if (!query) return out
  const needle = caseSensitive ? query : query.toLowerCase()
  doc.descendants((node, pos) => {
    if (node.isTextblock) matchBlock(node, pos, needle, caseSensitive, out)
    return true
  })
  return out
}

// 与选区重叠的命中即"当前项"；没有重叠则取选区起点后的首个（替换后光标停在原地也能接上）
export function activeIndexOf(r: FrResult, selFrom: number, selTo: number): number {
  const i = r.matches.findIndex((m) => m.from < selTo && m.to > selFrom)
  if (i >= 0) return i
  return r.matches.findIndex((m) => m.from >= selFrom)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      setFindQuery: (query: string, caseSensitive?: boolean) => ReturnType
      findNext: () => ReturnType
      findPrev: () => ReturnType
      replaceOne: (text: string) => ReturnType
      replaceAll: (text: string) => ReturnType
    }
  }
}

export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<FrResult>({
        key: frPluginKey,
        state: {
          init: () => ({ query: '', caseSensitive: false, matches: [] }),
          apply: (tr, prev) => {
            const meta = tr.getMeta(frPluginKey) as { query: string; caseSensitive: boolean } | undefined
            if (meta) return { ...meta, matches: collectMatches(tr.doc, meta.query, meta.caseSensitive) }
            if (tr.docChanged && prev.query)
              return { ...prev, matches: collectMatches(tr.doc, prev.query, prev.caseSensitive) }
            return prev
          },
        },
        props: {
          decorations(state: EditorState) {
            const r = frPluginKey.getState(state)
            if (!r || !r.matches.length) return DecorationSet.create(state.doc, [])
            const { from, to } = state.selection
            const active = activeIndexOf(r, from, to)
            return DecorationSet.create(
              state.doc,
              r.matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === active ? 'fr-hit fr-active' : 'fr-hit',
                }),
              ),
            )
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      setFindQuery:
        (query, caseSensitive) =>
        ({ editor, tr }) => {
          const prev = frPluginKey.getState(editor.state)
          const cs = caseSensitive ?? prev?.caseSensitive ?? false
          tr.setMeta(frPluginKey, { query, caseSensitive: cs })
          const matches = collectMatches(tr.doc, query, cs)
          if (matches.length) {
            const sel = TextSelection.between(tr.doc.resolve(matches[0].from), tr.doc.resolve(matches[0].to))
            tr.setSelection(sel).scrollIntoView()
          }
          return true
        },
      findNext:
        () =>
        ({ state, tr }) => {
          const r = frPluginKey.getState(state)
          if (!r || !r.matches.length) return false
          const after = r.matches.find((m) => m.from >= state.selection.to) ?? r.matches[0]
          tr.setSelection(TextSelection.between(state.doc.resolve(after.from), state.doc.resolve(after.to))).scrollIntoView()
          return true
        },
      findPrev:
        () =>
        ({ state, tr }) => {
          const r = frPluginKey.getState(state)
          if (!r || !r.matches.length) return false
          const before = [...r.matches].reverse().find((m) => m.to <= state.selection.from) ?? r.matches[r.matches.length - 1]
          tr.setSelection(TextSelection.between(state.doc.resolve(before.from), state.doc.resolve(before.to))).scrollIntoView()
          return true
        },
      replaceOne:
        (text) =>
        ({ state, tr }) => {
          const r = frPluginKey.getState(state)
          if (!r || !r.matches.length) return false
          const i = activeIndexOf(r, state.selection.from, state.selection.to)
          if (i < 0) return false
          const m = r.matches[i]
          tr.insertText(text, m.from, m.to).scrollIntoView()
          return true
        },
      replaceAll:
        (text) =>
        ({ state, tr }) => {
          const r = frPluginKey.getState(state)
          if (!r || !r.matches.length) return false
          // 自后向前替换避免位置漂移；query 不变，插件按新 doc 重算命中
          for (let i = r.matches.length - 1; i >= 0; i--) {
            const m = r.matches[i]
            tr.insertText(text, m.from, m.to)
          }
          return true
        },
    }
  },
})
