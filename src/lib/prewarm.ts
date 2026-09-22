import { useApp } from '../store'
import { loadEditor, loadWorkspace } from './editors'

// 首页空闲时就把编辑器 chunk 的 fetch+evaluate 做完：与挂载点共用 lib/editors 那一份动态
// import，预热顺手把「已解析组件表」填上——首开时挂载点同步命中，不必等一次「加载完再渲染」。
// 挂在 App 而不是 Workspace 上，是因为启动后停在首页时 Workspace 尚未挂载——那时正是唯一
// 免费的空闲时间。
//
// 试过更激进的预热（空闲期真建一个 Univer 实例 + 空表、拿空白 PDF 走一遍渲染管线），
// 发布包实测首开耗时一位数都没降：那些库的编译在哪个 context 都要付一遍，提前跑不省。
// 所以这里只保留 chunk 预取——它确实把 chunk 请求从点击路径上挪走了。
//
// 公式 worker 也试过预热：它是**另一个线程的 context**，脚本 fetch+编译由线程自己付，主线程
// 只是等。为此还配了「卸载归还而非 terminate」的线程池把活线程留住——发布包实测冷开 911ms，
// 关掉预热与池子反而 877ms（热开 569/565 持平）。预热的 7.4MB 编译要和启动抢 CPU，
// 得不偿失，池子（lib/worker-pool.ts）已删，回到每个标签自己建、卸载即 terminate。
let started = false

const LOADERS: [string, () => Promise<unknown>][] = [
  ['sheet', () => loadEditor('sheet')],
  ['pdf', () => loadEditor('pdf')],
  ['doc', () => loadEditor('doc')],
  ['ppt', () => loadEditor('ppt')],
]

const KINDS = new Map(LOADERS)

// 预热顺序：标签外壳最前（每个首次开标签都要它，实测它曾挂在点击路径上），
// 其后按最近打开过的类型排（用户下一步最可能再开它），剩下的按 LOADERS 顺序补齐
function planned(): [string, () => Promise<unknown>][] {
  const head: [string, () => Promise<unknown>][] = [['shell', () => loadWorkspace()]]
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
