/**
 * PDF 全文搜索的状态文案与"什么时候把进度交出去"——两条判据只写在这一处。
 *
 * 为什么要有这一层（v0.66）：实测 700 页的件从零扫一遍要 1.9~2.2s（同一趟两次数），而这一段里界面只说话一次
 * （扫完才 setMatches），于是这一两秒内计数写的是「无匹配」——那不是"没有"，那是"还没扫到"，
 * 用户照这句话换一个词再等 2.2s。本轮把"扫到哪"变成界面自己持续说得出的一件事，
 * 而说哪几句、什么时候肯说，全部收在这一个模块里（先例：v0.54 纸上账目、v0.65 密码提示）。
 */

/**
 * 界面自己记着的那一位（组件里就存这两味）：
 * scanning=null ⇒ 这一趟已经扫完（或压根没在扫）；capped=命中数撞到上限、剩下的没再扫。
 * 命中条数与激活下标跟着 matches/activeIdx 走，不在这里重复存，文案函数按参数收。
 */
export interface FindStatus {
  scanning: { scanned: number; total: number } | null
  capped: boolean
}

/** 计数那一格要吃的全部输入：界面记着的那一位 + 命中数与当前下标 */
export type FindState = FindStatus & {
  /** 目前为止的命中条数 */
  hits: number
  /** 当前激活的命中下标，-1=还没有 */
  active: number
}

/** 进度交出去的最小间隔（每页一次 setState 会把主线程点着，按时间窗收） */
export const SEARCH_PROGRESS_MS = 120
/** 攒够这么多新命中就立刻交一次，不等时间窗 */
export const SEARCH_PUBLISH_HITS = 20

/**
 * 计数那一格的文案，四档按顺序判：
 * 1. 还在扫 → 先说扫到第几页；此时哪怕一条都没撞上，也绝不说"无匹配"
 *    （刚打字那一刻 scanned=0，页号还没得说，只说"正在搜索"）
 * 2. 有命中 → 「第几条/共几条」，撞到上限时后面挂一个加号（剩下的没再扫，这话不能说满）
 * 3. 扫完没命中 → 无匹配（这一句只有扫完全程才配说出口）
 * 4. 查询串是空的 → 空（不给"无匹配"这种凭空的否定）
 */
export function findCountText(st: FindState, hasQuery: boolean): string {
  if (st.scanning) {
    const { scanned, total } = st.scanning
    if (!scanned) return '正在搜索…'
    return st.hits > 0
      ? `${st.active + 1}/${st.hits} · 已扫 ${scanned}/${total} 页`
      : `正在搜索 ${scanned}/${total} 页…`
  }
  if (st.hits > 0) return `${st.active + 1}/${st.hits}${st.capped ? '+' : ''}`
  return hasQuery ? '无匹配' : ''
}

/**
 * 节流判据：距上次交出去过了多久 + 这段时间里新攒了几条命中、扫了几页。
 * 命中一到就报（用户等的是这个），没命中也按时间窗报进度（界面要说得出还在干活）。
 * 返回 true 时调用方负责把三个计数一起清零——只在模块外做，这里保持纯。
 */
export function shouldPublish(now: number, lastAt: number, sinceHits: number, sincePages: number) {
  if (sincePages === 0) return false
  return sinceHits >= SEARCH_PUBLISH_HITS || now - lastAt >= SEARCH_PROGRESS_MS
}
