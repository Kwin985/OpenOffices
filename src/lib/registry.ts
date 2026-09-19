type Saver = (asNew: boolean) => void | Promise<void>

const savers = new Map<string, Saver>()

export function registerSaver(tabId: string, saver: Saver): () => void {
  savers.set(tabId, saver)
  return () => {
    savers.delete(tabId)
  }
}

export function saveTab(tabId: string, asNew = false): boolean {
  const saver = savers.get(tabId)
  if (!saver) return false
  void saver(asNew)
  return true
}
