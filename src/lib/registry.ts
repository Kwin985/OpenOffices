type Saver = (asNew: boolean) => void | Promise<void>

const savers = new Map<string, Saver>()

// 同一标签的存盘不并发：在途那一趟记在 running 里，期间再按的只留下一句「还要再存一次」
// （连同那一次是不是另存为），既不是排队多趟、也不是丢弃后一次——
// 丢弃就是替用户下结论（他很可能又改了东西才再按），而排队会把同一份内容存好几遍。
// 要这一层的理由是一条实测：两趟重叠时赢家接近对半（同路径并发 24 趟，A 10 / B 12），
// 也就是后按的那一趟（带更新的快照）不保证后落地 = 数据回退的形状，界面却报「已保存」
const running = new Set<string>()
const again = new Map<string, boolean>()

export function registerSaver(tabId: string, saver: Saver): () => void {
  savers.set(tabId, saver)
  return () => {
    savers.delete(tabId)
  }
}

export function saveTab(tabId: string, asNew = false): boolean {
  const saver = savers.get(tabId)
  if (!saver) return false
  if (running.has(tabId)) {
    again.set(tabId, asNew)
    return true
  }
  void drain(tabId, saver, asNew)
  return true
}

async function drain(tabId: string, saver: Saver, asNew: boolean): Promise<void> {
  running.add(tabId)
  let next = asNew
  // 循环到没有新的请求为止：补的那一趟走的是 saver 自己，快照在补趟时才取，
  // 所以「最后一次按键的那份内容一定最后落地」
  while (true) {
    try {
      await saver(next)
    } catch {
      // saver 自己把失败说给用户；这一层只管在途锁不许被一次抛错卡死
    }
    if (!again.has(tabId)) break
    next = again.get(tabId) as boolean
    again.delete(tabId)
  }
  running.delete(tabId)
}
