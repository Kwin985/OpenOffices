/**
 * 宏 · 兼容桩（v0.196 整合轮）
 *
 * 远程主线声称 v0.131/v0.134 有宏存储与 JS 沙箱运行时（macro.ts），
 * 源码从未提交。本桩保留 localStorage 里的宏数据（界面增删改照常、不丢用户内容），
 * 但执行一律如实返回失败，不假装跑过。
 */
export interface Macro {
  id: string
  name: string
  code: string
  builtin?: boolean
}

export interface MacroRun {
  ok: boolean
  changed: boolean
  error?: string
  log: string[]
}

const K_MACROS = 'oo.macros'

const BUILTIN: Macro[] = [
  {
    id: 'builtin-sample',
    name: '示例宏（运行时未入库）',
    code: '// 宏运行时源码未入库，此代码不会执行\n',
    builtin: true,
  },
]

function isMacro(v: unknown): v is Macro {
  if (!v || typeof v !== 'object') return false
  const m = v as Record<string, unknown>
  return typeof m.id === 'string' && typeof m.name === 'string' && typeof m.code === 'string'
}

export function loadMacros(): Macro[] {
  let custom: Macro[] = []
  try {
    const v: unknown = JSON.parse(localStorage.getItem(K_MACROS) || '[]')
    if (Array.isArray(v)) custom = v.filter(isMacro)
  } catch {
    /* 坏数据不炸界面 */
  }
  return [...BUILTIN, ...custom]
}

export function saveMacros(list: Macro[]): void {
  try {
    localStorage.setItem(K_MACROS, JSON.stringify(list.filter((m) => !m.builtin)))
  } catch {
    /* 隐私模式或配额满 */
  }
}

export function newMacro(name = '新宏'): Macro {
  return {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    code: '',
  }
}

export function runMacro(
  _code: string,
  _editor: unknown,
  _setStatus: (s: string) => void,
): MacroRun {
  return {
    ok: false,
    changed: false,
    error: '宏运行时源码未入库（远程主线从未提交 macro.ts），本次不执行',
    log: [],
  }
}
