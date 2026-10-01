import { failStatus } from './fail-msg'

/**
 * 定时自动保存那一路的账：连续失败几回、下一枚隔多久、那两句话怎么说，只写在这一处。
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
  }
}

/** 失败那句：中文归因 + 原话（v0.64 的两行规矩）之上再多一行"什么时候再试" */
export function autoFailStatus(err: unknown, fails: number, nextDelayMs: number): string {
  return `${failStatus(err, `自动保存失败（第 ${fails} 次）`)}\n${Math.round(nextDelayMs / 1000)} 秒后自动重试`
}

/**
 * 成功那句的悬停账。v0.73 实测那一格 `title` 是空的（那一路失败过几回屏上看不出来），
 * 而失败那句一旦被下一次成功撤掉，整段经历就在界面上消失了——这一行是给"撤掉之后"留的账。
 */
export function autoOkTip(l: AutoSaveLedger): string {
  return `本次会话自动保存：成功 ${l.okTotal} 次 · 失败 ${l.failTotal} 次 · ${Math.round(autoDelayMs(l.fails) / 1000)} 秒后再检查`
}
