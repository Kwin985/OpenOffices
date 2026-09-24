// 自动更新的**检测层**：问一次更新源，把结果说清楚，然后停在这里。
//
// 两条刻意的边界：
// ① 不下载、不安装。前端只拿到 `updater:allow-check` 这一条权限（见 capabilities/default.json），
//    插件的 download/install 命令根本调不到；更新源在哪还没定（README 路线图），装更没意义。
//    将来接应用内更新时要做三件事：加 `updater:allow-download` + `allow-install`、把端点换成正式源、
//    在装完之前别再暴露"检查更新"以外的按钮。
// ② 不做启动时后台轮询。首页写着"数据不出本机"，那联网就只能由用户点这一下发起。
//
// 错误文案不是装饰：插件对"404""清单坏了""没配端点"给的分别是一句英文，用户看到英文原始报错
// 与看到"什么都没变"一样没用；而"连上了但源上没有清单"和"你已经是最新版"必须分开说，
// 否则私有仓库/未上传这些真实状态会被"暂无更新"掩盖成"更新功能坏了也没人知道"。

import { getVersion } from '@tauri-apps/api/app'
import type { Update } from '@tauri-apps/plugin-updater'

export type UpdateInfo = {
  version: string
  /** 发布说明（清单里的 notes，可能是 markdown，这里按纯文本一行显示） */
  notes: string
  /** 发布日期的 YYYY-MM-DD；清单没给就是空串 */
  date: string
  /** 下载页地址：清单的自定义字段 download_page；没给就是空串 */
  page: string
}

export type CheckResult =
  | { state: 'latest'; current: string }
  | { state: 'available'; current: string; info: UpdateInfo }
  | { state: 'failed'; message: string }

/** 界面拿的是这个：检查结果之外还要能表达"正在问"（并入同一判别式联合，narrowing 才不会失效） */
export type UpdateState = CheckResult | { state: 'checking' }

/** 插件把 reqwest/serde 的报错当字符串抛回来，三种形状都要吃到 */
function errText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    for (const k of ['message', 'payload', 'toString']) {
      const v = o[k]
      if (k === 'toString' && typeof v === 'function') return String(v.call(o))
      if (typeof v === 'string' && v) return v
    }
  }
  return String(e)
}

const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/**
 * 把更新源的报错归成一句中文。归类只按插件实际会给出的字面（读 tauri-plugin-updater 的 error.rs
 * 与 updater.rs 得来），认不出的一律原样带出并标"更新源报错"——宁可给英文原文也不编一个原因。
 */
export function describeError(e: unknown): string {
  const s = errText(e)
  const l = s.toLowerCase()
  // 非 2xx（含私有仓库的 404）与"返回了但不是合法清单"在插件里都收敛到这一句
  if (l.includes('could not fetch a valid release json'))
    return '更新源没有返回发布清单：latest.json 还没上传、仓库不能匿名访问（私有仓库的 Release 对普通用户就是 404）、或清单字段不合规格，都会是这个结果'
  if (l.includes('does not have any endpoints')) return '还没配置更新源地址（tauri.conf.json 的 plugins.updater.endpoints 为空）'
  if (l.includes('secure protocol')) return '更新源地址不是 https，已按安全策略拒绝'
  if (l.includes('platforms')) return '清单里没有本平台（windows-x86_64）的更新包条目'
  if (l.includes('signed for version')) return '清单指向的更新包与签名里的版本不一致，已按防篡改策略拒绝'
  if (l.includes('could not be decoded')) return '清单里的签名不是合法 base64（应为 `.sig` 文件的原文）'
  if (l.includes('pub_date')) return '清单的 pub_date 不是 RFC3339 时间'
  if (l.includes('authentication')) return '更新源要求凭据，匿名访问被拒'
  if (l.includes('timed out') || l.includes('timeout')) return `检查更新超时：${oneLine(s, 120)}`
  // reqwest 的连接类失败字面很杂（DNS、拒连、代理…），共同点是"没到源"
  if (/(error sending request|failed to lookup|dns|connection refused|connection reset|network|maintenance|unreachable)/.test(l))
    return '连不上更新源：本机离线或该地址不可达'
  return `更新源报错：${oneLine(s, 160)}`
}

/** Update → 界面要的四项。notes 折成一行，日期只留到"日" */
export function infoOf(u: Pick<Update, 'version' | 'body' | 'date' | 'rawJson'>): UpdateInfo {
  const raw = u.rawJson as Record<string, unknown> | null | undefined
  const page = typeof raw?.download_page === 'string' ? raw.download_page : ''
  return {
    version: u.version,
    notes: oneLine(u.body ?? '', 160),
    date: (u.date ?? '').slice(0, 10),
    page: /^https?:\/\//i.test(page) ? page : '',
  }
}

/**
 * 走一次真实检查。任何失败都收敛成 `{state:'failed'}`，不往外抛：调用方只有一个状态条，
 * 抛出去的表现是"点了没反应"，那正是这条链路最不该有的失败模式。
 */
export async function checkForUpdate(timeoutMs = 15000): Promise<CheckResult> {
  try {
    // 只有插件本体留作动态导入（它带着 invoke 封装与类型，不该进首屏外壳）
    const { check } = await import('@tauri-apps/plugin-updater')
    const current = await getVersion()
    const u = await check({ timeout: timeoutMs })
    if (!u) return { state: 'latest', current }
    return { state: 'available', current, info: infoOf(u) }
  } catch (e) {
    return { state: 'failed', message: describeError(e) }
  }
}
