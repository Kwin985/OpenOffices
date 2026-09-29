// 存盘这一趟的进度文案与"什么时候才开口"的判据，只写在这一处。
// 照 v0.66 lib/pdf-search.ts 的先例：组件只负责按门把话说出去，不负责发明句子。

/** 这一趟要说什么 */
export const SAVE_BUSY_TEXT = '正在保存…'

/** 太短的一段不值得界面开口：表格小件全程 18ms（v0.69 实测）、PDF 三档 11/143~161/1071~1161ms（v0.70 实测），
 *  前两档说出口就是一闪的噪音；而表格大件那 ~590ms 里前 115~131ms 是主线程同步块（取快照 + 交进 IPC），
 *  门要晚于它才说得出一句"还在进行"（PDF 那一头没有这种同步块——页内 longtask 观测器全程 0 条，
 *  所以门什么时候挂都来得及，代价是它也就没有"必须晚于同步块"这一条约束） */
export const SAVE_BUSY_MS = 200

/** 收尾那句停多久：不带说明的 1.5 秒够用，带账的那一句得给人读完的时间 */
const SAVE_DONE_MS = 1500
const SAVE_DONE_NOTED_MS = 5000

/** 存盘成功那句：格式本身装不下的账与写侧带回来的账拼成一句，一条都不说就是「已保存」 */
export function saveDoneText(notes: string[]): string {
  if (!notes.length) return '已保存'
  return `已保存（${notes[0]}${notes.length > 1 ? `，另有 ${notes.length - 1} 条说明` : ''}）`
}

/**
 * 「已保存」那句的收尾时钟（v0.69 把它写在表格头的 doneClearRef 里，本轮 PDF 头要用同一个形状 ⇒
 * 两份 1500/5000 就是两把尺子，挪到这里只留一份）。
 * cancel 是给"下一趟开跑"用的而不是给成功那一路用的：补的那一趟若不先撤，上一句的定时器会在
 * 「正在保存…」说话时把它抹成空白；而失败那一路更要撤，否则失败那句会被按掉。
 */
export function saveDoneTimer(setStatus: (text: string) => void) {
  let timer: number | undefined
  return {
    show(notes: string[]) {
      if (timer !== undefined) window.clearTimeout(timer)
      setStatus(saveDoneText(notes))
      timer = window.setTimeout(() => {
        timer = undefined
        setStatus('')
      }, notes.length ? SAVE_DONE_NOTED_MS : SAVE_DONE_MS)
    },
    cancel() {
      if (timer === undefined) return
      window.clearTimeout(timer)
      timer = undefined
    },
  }
}

/** 进度文案的时钟：反复 arm 只算一次（挂着的门不许被推后，否则一直按就永远不说），
 *  取消只撤当前挂着的那一次。另存为那一段是等用户挑路径、不是等我们写盘 ⇒ 挑路径期间撤掉，回来再挂 */
export function saveBusyTimer(setShow: (text: string) => void) {
  let timer: number | undefined
  return {
    arm() {
      if (timer !== undefined) return
      timer = window.setTimeout(() => {
        timer = undefined
        setShow(SAVE_BUSY_TEXT)
      }, SAVE_BUSY_MS)
    },
    cancel() {
      if (timer === undefined) return
      window.clearTimeout(timer)
      timer = undefined
    },
  }
}
