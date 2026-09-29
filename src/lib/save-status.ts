// 存盘这一趟的进度文案与"什么时候才开口"的判据，只写在这一处。
// 照 v0.66 lib/pdf-search.ts 的先例：组件只负责按门把话说出去，不负责发明句子。

/** 这一趟要说什么 */
export const SAVE_BUSY_TEXT = '正在保存…'

/** 太短的一段不值得界面开口：小件全程 18ms（v0.69 release 实测），说出口就是一闪的噪音；
 *  大件那 ~590ms 里前 115~131ms 是主线程同步块，所以这枚门要晚于它，才说得出一句"还在进行" */
export const SAVE_BUSY_MS = 200

/** 存盘成功那句：格式本身装不下的账与写侧带回来的账拼成一句，一条都不说就是「已保存」 */
export function saveDoneText(notes: string[]): string {
  if (!notes.length) return '已保存'
  return `已保存（${notes[0]}${notes.length > 1 ? `，另有 ${notes.length - 1} 条说明` : ''}）`
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
