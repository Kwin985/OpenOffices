import type { Editor } from '@tiptap/core'
import { DOMParser, Fragment, Node as PM } from '@tiptap/pm/model'
import type { PMNode } from './docx'

/**
 * 文档打开链路的分批喂（v0.87）。
 *
 * 为什么要有这一层：前置实测（release，2026-10-05，七枚件）量到打开一份文档时块数只有三个值——
 * 没有编辑器 → 一枚空种子段落 → 全量，一次跳到位；其间主线程被同步块占住，
 * 28029 块那枚件正文 1097ms 才出现、采样空档 964ms、单枚长任务 555ms。
 *
 * 为什么偏偏是"累加 Fragment + 每批整片换回"这一条通道：实测八种尾型（标题/段落/空段/无序表/
 * 有序表/表格/引用/代码块）里，**任何**"放到文档尾部"的追加都会在批次边界留下 PM 的尾部填充段
 * （同一趟里撤掉填充再追加也一样，六型不等），最终文档与整片喂法逐节点不同；
 * 只有在 JS 侧把 Fragment 累加起来、每批用 `tr.replaceWith(0, size, acc)` 整片换回，
 * 上一批尾部那枚填充段才会被下一批抹掉。四枚真件（docx/odt/odoc，5056~28029 块）逐节点相同。
 *
 * 代价也实测过：整趟总时长 1.19×~1.33×（每批整片重绘），换来的是单枚最长同步块
 * 从 854~869ms 拆成 ≤138~165ms 若干枚，首屏 17~41ms。所以阈值挡在"今天已经不冻结"的那一档之上。
 */

/**
 * 分批的阈值（顶层块数）。由 release 实测分档定在 5000：5000 块那枚正文 134ms 出现、空档 92ms，
 * 而 5056/5840 块起就是 188/220ms，24000/28029 块是 417/964ms。
 * 挡位以下的件今天就没有可感知的冻结，不该为它们引入"读全之前不许写"这道闸。
 */
export const FEED_THRESHOLD = 5000

/** 首屏那一批的块数（实测 12 块的首屏 11.9~50.7ms，薄到能立刻让出画面） */
export const FEED_FIRST = 12

/**
 * 首屏之后每批的块数。阶梯实测 400/1500/4000 三档：400 的首屏最好（11.9~50.7ms）但整趟 2.38×~3.24×，
 * 4000 的整趟代价最低（1.19×~1.33×）且单枚同步块仍 ≤138~165ms ⇒ 取 4000。
 */
export const FEED_BATCH = 4000

/** 一枚顶层块至少要 7 个字符（`<p></p>`）：串不够长就绝不可能过阈，小件因此不必为这一格决定多付一次 DOM 构建 */
const MIN_BLOCK_CHARS = 7

export type FeedSource =
  | { kind: 'html'; html: string; emitUpdate: boolean }
  /** .odoc 存的是整枚 doc 节点；分批只切它的 content */
  | { kind: 'json'; doc: PMNode; emitUpdate: boolean }

export interface FeedPlan {
  /** 每批喂多少块；长度必然大于 1（单片的情况一律交回调用方走今天那一句 setContent） */
  sizes: number[]
  items: string[] | PMNode[]
}

/**
 * 这份内容要不要分批、怎么分批。返回 null = 走今天的单片形状。
 * `hint` 是调用方已经白拿到的块数（保真导入自己报了 blocks，.odoc 有 content.length）：
 * 它只用来省掉一次 DOM 构建，猜错只会错过优化、不会切错内容——真要切还是得自己数。
 */
export function planFeed(src: FeedSource, hint?: number): FeedPlan | null {
  if (hint !== undefined && hint <= FEED_THRESHOLD) return null
  if (src.kind === 'html') {
    if (src.html.length < FEED_THRESHOLD * MIN_BLOCK_CHARS) return null
    const el = document.createElement('div')
    el.innerHTML = src.html
    const kids = Array.from(el.children) as HTMLElement[]
    if (kids.length <= FEED_THRESHOLD) return null
    // 顶层有裸文本就不切：parseSlice 会把裸文本变成段落，而按 outerHTML 切块会把它静默丢掉
    const covered = kids.map((k) => k.textContent ?? '').join('')
    if (textSig(el.textContent ?? '') !== textSig(covered)) return null
    return buildPlan(kids.map((k) => k.outerHTML))
  }
  const kids = src.doc.content ?? []
  if (kids.length <= FEED_THRESHOLD) return null
  return buildPlan(kids)
}

const textSig = (s: string) => s.replace(/\s+/g, '')

function buildPlan(items: string[] | PMNode[]): FeedPlan {
  const sizes = [FEED_FIRST]
  for (let rest = items.length - FEED_FIRST; rest > 0; ) {
    const n = Math.min(FEED_BATCH, rest)
    sizes.push(n)
    rest -= n
  }
  return { sizes, items }
}

/**
 * 按 plan 把内容一批批喂进编辑器。返回 aborted = 这一趟被作废了（标签关掉/换件），
 * 此时文档只有前半截，调用方**不许**记"读全"的账。
 *
 * `stopped` 每批开头查一次；让出主线程的形状与实测那把尺一致（首屏之后走两帧 rAF，批间走 setTimeout 0）。
 * 每批都是整片换回，且不进历史：72 批各占一格撤销的话，撤销会变成"退回半份文档"。
 * 'update' 只在最后一批发（与今天 setContent 一次一片同一笔账），其余批带 preventUpdate。
 */
export async function runFeed(
  editor: Editor,
  plan: FeedPlan,
  src: FeedSource,
  stopped: () => boolean,
): Promise<{ batches: number; aborted: boolean }> {
  const schema = editor.schema
  const parser = DOMParser.fromSchema(schema)
  const fragOf = (piece: string[] | PMNode[]): Fragment => {
    if (src.kind === 'html') {
      const el = document.createElement('div')
      el.innerHTML = (piece as string[]).join('')
      return parser.parseSlice(el).content
    }
    return Fragment.from((piece as PMNode[]).map((n) => PM.fromJSON(schema, n)))
  }
  const replaceAll = (frag: Fragment, emitUpdate: boolean) => {
    const size = editor.state.doc.content.size
    const tr = editor.state.tr.replaceWith(0, size, frag)
    tr.setMeta('addToHistory', false)
    if (!emitUpdate) tr.setMeta('preventUpdate', true)
    editor.view.dispatch(tr)
  }

  let acc = Fragment.empty
  let i = 0
  let batches = 0
  for (const size of plan.sizes) {
    if (stopped()) return { batches, aborted: true }
    const piece = plan.items.slice(i, i + size)
    acc = batches === 0 ? fragOf(piece) : acc.append(fragOf(piece))
    replaceAll(acc, batches === plan.sizes.length - 1 ? src.emitUpdate : false)
    i += size
    batches++
    if (batches === 1) await nextFrame()
    else if (batches < plan.sizes.length) await new Promise((res) => setTimeout(res, 0))
  }
  await nextFrame()
  return { batches, aborted: false }
}

const nextFrame = () =>
  new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())))
