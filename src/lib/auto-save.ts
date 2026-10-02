import { getCurrentWindow } from '@tauri-apps/api/window'
import { failStatus } from './fail-msg'

/**
 * 定时自动保存那一路的账：连续失败几回、下一枚隔多久、焦点回来时能不能再探一次、那两句话怎么说，只写在这一处。
 *
 * 照 v0.54「纸上账目的文案只写一处」那一条先例（v0.64 失败归因 / v0.65 密码提示 / v0.66 搜索进度 /
 * v0.69~0.72 存盘的收尾时钟），两头（`.odoc` 与 `.opd`）共吃这一份，不各自抄延迟公式。
 *
 * 这一层与 lib/save-status.ts 的分工是 v0.73 定下的那一刀：**共用文案、不共用停留**。
 * 这一路的句子说的是「最近一次自动保存的结果」，要一直挂到下一次结果出来为止（实测失败那句活了
 * 239,986ms），所以它不接 1500ms 那枚收尾时钟、也不挂进度门。
 */

/** 基数：v0.69 起 `.odoc` 就是这一枚 30 秒，v0.74 给 `.opd` 上了同一枚 */
export const AUTO_BASE_MS = 30_000

/**
 * 退避的上限。这一枚数是 v0.75 前置实测（release，只读的 `.odoc` 挂着 4 分钟）定出来的：
 * 注定失败的 `write_text_file` 出门 **8 枚**，间隔逐枚 30.0s（30255/60251/90259/120258/150254/180255/
 * 210247/240244，漂移 ≤9ms），每枚自身只有 5~14ms ⇒ 挂着的不是慢，是"明知不行还一直敲"。
 * 翻倍到 240 秒封顶后同一个 4 分钟窗内只剩 3 枚（30/90/210 秒）。
 *
 * 代价要写明白：解开了权限也要等下一枚时钟才落盘。实测改后那一路恢复最坏要 240 秒（改前 30,052ms），
 * 所以手动存盘成功那一路做两件事：退避归零（clearBackoff）+ 撤掉在途的那一枚重挂（autoRescheduleRef），
 * 用户按一次 Ctrl+S 就把节奏拉回 30 秒——只归零账不重挂是不够的，账只管下一枚延迟，
 * 而已经在途的那枚最坏还要再等 240 秒。
 *
 * 手动那一趟**失败**时不做这两件事，v0.76 量清楚了为什么不该做：退避已经涨到封顶那一档的件上按一次
 * Ctrl+S（权限还没改回来），那一趟自己也是失败的，而它之后下一枚自动写**没有**被拉回 30 秒
 * （真机 E3b：手动那枚写 @213795 失败，下一枚自动写仍排在 236509ms 之后）。这看着像"没拉回来"的缺陷，
 * 但它恰恰是正确的：那一次失败就是"此刻仍然写不上"的**证据**，把它当成拉回基数的信号等于回到 v0.75
 * 要修的"明知不行还一直敲"。真正缺的不是"更早再敲一次"，而是**真的存上之后界面要承认**（见 staleFailureClaim）。
 *
 * 没有做成"连续失败 N 次就彻底停"：停掉之后用户把权限改回来也再也存不上，而 4 分钟一枚已经不打扰人。
 */
export const AUTO_MAX_MS = 240_000

/** 连续失败 k 次之后，下一枚时钟隔多久（k=0 就是常态的 30 秒） */
export function autoDelayMs(fails: number): number {
  return Math.min(AUTO_BASE_MS * 2 ** Math.max(0, fails), AUTO_MAX_MS)
}

/**
 * 一枚标签一份账：这个工厂必须由组件用 `useRef` 拿着，**不能做成模块级的单例**——
 * `Workspace` 把开过的标签全部常驻挂载（v0.68 那条），N 枚 `.odoc` 就有 N 枚时钟，
 * 共享一份账会让 A 件的失败把 B 件的时钟推后（那是"这一路挂着不动"之外新的一种串台）。
 */
export interface AutoSaveLedger {
  /** 连续失败次数：驱动下一枚延迟，也写进失败那句的「第 N 次」 */
  fails: number
  /** 本会话这一路累计失败/成功次数：只给成功那句的悬停看，不驱动任何东西 */
  failTotal: number
  okTotal: number
  /** 一次真的写失败了才算（锁忙跳过不算，v0.74 那一路的语义是"本趟没跑"而不是"跑坏了"） */
  noteFailure(): void
  noteSuccess(): void
  /** 手动存盘成功：退避归零（调用方还要撤掉在途那一枚重挂，否则下一次仍是长的那枚），
   *  但次数账不动——那一趟不是我这一路存上的 */
  clearBackoff(): void
  /**
   * 这一路最近一次真的把写请求发出门的时刻（页内毫秒时钟；0 = 还没敲过门）。
   * 手动 Ctrl+S 不登记这一枚（v0.76 那条"手动那一趟不是自动那一路的账"继续成立）：手动刚存成功之后
   * 标签本来就不脏，探写在那一步就返回了，不会真多发一枚写请求。
   */
  lastAttemptAt: number
  /** 真的发过一枚写请求才登记：锁忙跳过、不脏跳过都不算（它们没有敲过门）*/
  noteAttempt(): void
  /**
   * 窗口重新拿到焦点时这一路能不能立刻再探一次：两次真敲过门之间至少隔 AUTO_BASE_MS。
   *
   * 下界定在基数而不是"来一次焦点就探一次"，量的是 v0.77 前置实测②：连打 6 次 Alt+Tab 只到 3 枚
   * `tauri://focus`，时刻 [24562,28097,31709]、相邻间隔 [3535,3612]ms ⇒ 人手能造成的最快闪动已经
   * 比 30 秒慢一个数量级，而焦点探写的用途是"权限解开了"这一件事，不是保存每一次按键——
   * 一旦允许比基数更频繁，它就成了 v0.75 要修的那个"明知不行还一直敲"的新入口（而且是用户看不见的）。
   */
  canProbe(now?: number): boolean
}

export function createAutoSaveLedger(): AutoSaveLedger {
  return {
    fails: 0,
    failTotal: 0,
    okTotal: 0,
    noteFailure() {
      this.fails += 1
      this.failTotal += 1
    },
    noteSuccess() {
      this.fails = 0
      this.okTotal += 1
    },
    clearBackoff() {
      this.fails = 0
    },
    lastAttemptAt: 0,
    noteAttempt() {
      this.lastAttemptAt = Date.now()
    },
    canProbe(now = Date.now()) {
      return now - this.lastAttemptAt >= AUTO_BASE_MS
    },
  }
}

/**
 * 窗口重新拿到焦点时叫一次回调（焦点探写的入口，两头共用）。
 *
 * 为什么走这一层而不是各头自己写监听：原始事件对象是 `{"event":"tauri://focus","payload":null,"id":6}`
 * ——**没有窗口标签**，用 `{kind:'Any'}` 监听分不开主窗与演讲者窗（v0.77 前置实测①量出来的），
 * 而 `getCurrentWindow().onFocusChanged()` 的监听目标是 `{kind:'Window', label}`，只报"这一扇窗"的焦点。
 * 监听侧的权限 `core:default` 本来就给了（capabilities 不用改）；`is_focused` 不能替代事件——实测外部
 * 把前台偷走再还给应用时 `is_focused` 仍是 false，事件只在真正翻转的那一刻到。
 *
 * `then` 之后才发现"这一趟已经被换掉了"（StrictMode 双挂载），所以要补一次取消而不是丢掉它。
 */
export function onFocusBack(fn: () => void): () => void {
  let stopped = false
  let un: (() => void) | null = null
  getCurrentWindow()
    .onFocusChanged((e) => {
      if (!stopped && e.payload) fn()
    })
    .then((u) => {
      if (stopped) u()
      else un = u
    })
  return () => {
    stopped = true
    if (un) un()
  }
}

/**
 * 失败那句：中文归因 + 原话（v0.64 的两行规矩）之上再多一行"什么时候再试"。
 *
 * 记一条量出来的边界：状态栏只把**第一行**摆在屏上（`statusText`），换行之后的全部进悬停
 * （`statusTip`），所以「X 秒后自动重试」这一行用户不悬停就看不见——v0.76 实测那一格的
 * title 是 `failed to open file at path: … (os error 5)\n240 秒后自动重试`，而可见行只有
 * 「自动保存失败（第 3 次）: 这个位置不让写：…」。没有把倒计时挪到可见行：那一行已经长到会被人截断，
 * 而"该改什么"（归因）比"什么时候再敲"更需要站在那里。
 */
export function autoFailStatus(err: unknown, fails: number, nextDelayMs: number): string {
  return `${failStatus(err, `自动保存失败（第 ${fails} 次）`)}\n${Math.round(nextDelayMs / 1000)} 秒后自动重试`
}

/** 一次写失败写在状态栏那一格上的句子，以及它说的是哪个文件 */
export interface FailureClaim {
  msg: string
  path: string
}

/**
 * 定时那一趟真的存上之后，这一格上还挂着"关于这个路径没存上"的过期话吗？有就把那句交回去。
 *
 * v0.73 的"只撤自己那句"用的是身份比较（`cur === 定时这一路自己写上去的那串`）：它挡住了"迟到一趟
 * 抹掉活着一趟"，却漏掉了反方向的那一格——手动 Ctrl+S 的失败句不是定时那一路写的，于是定时那一趟
 * 后来**真的存上了**，屏上还挂着那句过期话。v0.76 的 A/B 对照件（0.75 那支，release，只读 `.odoc`）
 * 把这一格量成实测：手动失败句 213961ms 上屏 → 权限恢复、此后不再按键 → 下一枚自动写 @450335+10
 * 真的落盘（字面读回文件=true）、● 在 450363 归 0，而那句「保存失败: …」仍**一直挂到整窗末拍 470959ms**
 * （比落定晚 20,614ms），同一窗里「已自动保存」一次都没上过屏（那一格挂在 `!status` 之后，被那句堵死）。
 * 界面说"没存上"而账已经是"存上了"——与 v0.71 那条"文件真写进去了、● 却还挂着"是同一枚矛盾的反方向。
 *
 * 按路径而不是无条件清：另存为失败说的是**另一个**文件、加载失败根本没有路径，那两句都还是活话
 * （v0.65「迟到那一趟不许抹活着一趟」在这一头的形状）。
 */
export function staleFailureClaim(claim: FailureClaim | null, path: string): string {
  return claim && claim.path === path ? claim.msg : ''
}

/**
 * 成功那句的悬停账。v0.73 实测那一格 `title` 是空的（那一路失败过几回屏上看不出来），
 * 而失败那句一旦被下一次成功撤掉，整段经历就在界面上消失了——这一行是给"撤掉之后"留的账。
 */
export function autoOkTip(l: AutoSaveLedger): string {
  return `本次会话自动保存：成功 ${l.okTotal} 次 · 失败 ${l.failTotal} 次 · ${Math.round(autoDelayMs(l.fails) / 1000)} 秒后再检查`
}
