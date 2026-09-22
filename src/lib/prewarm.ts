import { useApp } from '../store'

// 首页空闲时就把编辑器 chunk 的 fetch+evaluate 做完：与 lazy() 共享同一模块 promise，
// 真正开标签只剩实例化成本。挂在 App 而不是 Workspace 上，是因为启动后停在首页时
// Workspace 尚未挂载——那时正是唯一免费的空闲时间。
//
// 试过更激进的预热（空闲期真建一个 Univer 实例 + 空表、pdf.js 空文档走一遍渲染管线），
// 发布包实测首开耗时一位数都没降：首次开标签比同会话内第二次慢的那 ~600ms 不是这些库的
// 代码编译，而是新 context 里 6MB chunk 的编译与堆增长，空闲期提前跑同样要付一遍。
// 所以这里只保留 chunk 预取——它确实把 chunk 请求从点击路径上挪走了（实测点击后只剩
// read_xlsx 与 worker 创建）。
let started = false

const LOADERS: [string, () => Promise<unknown>][] = [
  ['sheet', () => import('../components/SheetEditor')],
  ['pdf', () => import('../components/PdfViewer')],
  ['doc', () => import('../components/DocEditor')],
  ['ppt', () => import('../components/PptEditor')],
]

const KINDS = new Map(LOADERS)

// 预热顺序：标签外壳最前（每个首次开标签都要它，实测它曾挂在点击路径上），
// 其后按最近打开过的类型排（用户下一步最可能再开它），剩下的按 LOADERS 顺序补齐
function planned(): [string, () => Promise<unknown>][] {
  const head: [string, () => Promise<unknown>][] = [['shell', () => import('../components/Workspace')]]
  const seen = new Set<string>()
  for (const r of useApp.getState().recents) {
    const l = KINDS.get(r.kind)
    if (!l || seen.has(r.kind)) continue
    seen.add(r.kind)
    head.push([r.kind, l])
  }
  for (const [k, l] of LOADERS) if (!seen.has(k)) head.push([k, l])
  return head
}

const idle = (cb: () => void) => {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 4000 })
  else window.setTimeout(cb, 1200)
}

export function startEditorPrewarm(): void {
  if (started) return
  started = true
  const steps = planned()
  const done: string[] = []
  const run = (i: number) => {
    if (i >= steps.length) return
    idle(() => {
      void steps[i][1]()
        // 预热纯属锦上添花，失败不打扰用户；但 DEV 要留痕，否则整条链静默空转无从排查
        .catch((e) => {
          if (import.meta.env.DEV) console.warn(`预热步骤 ${steps[i][0]} 失败`, e)
        })
        .finally(() => {
          done.push(steps[i][0])
          if (import.meta.env.DEV) (window as unknown as Record<string, string[]>).__oofPrewarm = [...done]
          run(i + 1)
        })
    })
  }
  run(0)
}
