/**
 * 拼写检查 · 兼容桩（v0.196 整合轮）
 *
 * 远程主线 README 声称 v0.132 有 686 行全量拼写词典模块（word-list 27.4 万词），
 * 但源码从未提交进 git，本地也找不到。本文件保持 API 兼容的安全降级：
 * - 扫描结果恒为空（不划线、不误报，比假报更诚实）
 * - 个人词典仍落 localStorage，界面增删照常
 * - 全量词典档显式报 failed，UI 会如实提示「词表没拉到」
 *
 * 日后拿到真源码整文件覆盖即可，调用方一行不用改。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface SpellIssue {
  from: number
  to: number
  text: string
  suggest?: string
  /** 命中说明（规则名与档位），界面上做按钮的 title */
  note?: string
}

export interface SpellState {
  issues: SpellIssue[]
  truncated: boolean
}

export const spellPluginKey = new PluginKey<SpellState>('spellCheck')

const K_IGNORED = 'oo.spell.ignored'
const K_DEEP = 'oo.spell.deep'
const listeners = new Set<() => void>()

function readRaw(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 隐私模式或配额满：降级为内存态，本会话仍有效 */
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

export function spellIgnored(): string[] {
  try {
    const v: unknown = JSON.parse(readRaw(K_IGNORED) || '[]')
    return isStringArray(v) ? v : []
  } catch {
    return []
  }
}

function commitIgnored(words: string[]): void {
  writeRaw(K_IGNORED, JSON.stringify(words))
  listeners.forEach((f) => f())
}

export function spellUnignore(w: string): void {
  commitIgnored(spellIgnored().filter((x) => x !== w))
}

export function onSpellDictChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function spellDeepOn(): boolean {
  return readRaw(K_DEEP) === '1'
}

export function setSpellDeep(on: boolean): void {
  writeRaw(K_DEEP, on ? '1' : '0')
}

export type SpellDictState = 'idle' | 'loading' | 'ready' | 'failed'

export function spellDictState(): SpellDictState {
  return 'idle'
}

export async function loadSpellDict(): Promise<SpellDictState> {
  return 'failed'
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    spellCheck: {
      setSpellCheck: (on: boolean) => ReturnType
      ignoreSpell: (word: string) => ReturnType
      rescanSpell: () => ReturnType
    }
  }
}

export const SpellCheck = Extension.create({
  name: 'spellCheck',
  addCommands() {
    return {
      setSpellCheck: () => () => true,
      ignoreSpell: (word: string) => () => {
        const cur = spellIgnored()
        if (!cur.includes(word)) commitIgnored([...cur, word])
        return true
      },
      rescanSpell: () => () => true,
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<SpellState>({
        key: spellPluginKey,
        state: {
          init: () => ({ issues: [], truncated: false }),
          apply: (_tr, prev) => prev,
        },
      }),
    ]
  },
})
