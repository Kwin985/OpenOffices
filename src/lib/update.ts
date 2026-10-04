// 自动更新的**检测层 + 下载安装层**：问一次更新源，把结果说清楚，再由用户决定下不下载、装不装。
//
// 两条刻意的边界：
// ① 下载与安装分开两拍，而闸只立在「装」之前（v0.82 起）。
//    为什么下载前面不立闸：`download()` 只把字节取进 Rust 侧内存并按清单验签，一个字都不往盘上写、
//    也不改应用（实测：下载前后 %TEMP% 零枚新落点，宿主工作集涨约一个包体的量、close 之后回到原值）；
//    而 `install()` 在 Windows 上以 `std::process::exit(0)` 收尾，那一步之后界面说什么都没人听见——
//    所以「还有未保存改动就不许装」这句话必须排在调用之前，而不是排在错误处理里。
//    前端权限相应从 `updater:allow-check` 扩到 `+allow-download +allow-install`（capabilities/default.json）。
//    v0.45 那一版写的是「不下载、不安装，只给 allow-check」，这条边界在 v0.82 收窄为「装之前必闸」。
// ② 不做启动时后台轮询。首页写着"数据不出本机"，那联网就只能由用户点这一下发起。
//
// 错误文案不是装饰：插件对"404""清单坏了""没配端点"给的分别是一句英文，用户看到英文原始报错
// 与看到"什么都没变"一样没用；而"连上了但源上没有清单"和"你已经是最新版"必须分开说，
// 否则私有仓库/未上传这些真实状态会被"暂无更新"掩盖成"更新功能坏了也没人知道"。

import { getVersion } from '@tauri-apps/api/app'
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'

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
  | { state: 'available'; current: string; info: UpdateInfo; update: Update }
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
  // 下面四条来自下载与安装这两拍（v0.82 实测字面），不是更新源的错，是我们自己走错了步骤或被拒
  if (l.includes('signature verification failed'))
    return '更新包签名校验未通过：包体与清单里的签名不匹配（被动过、或不是发布那把私钥签的），已在写盘之前拒绝'
  if (l.includes('not allowed. permissions associated'))
    return '这一步没有权限：capabilities 里缺 `updater:allow-download` 或 `updater:allow-install`'
  if (l.includes('download request failed')) return `更新源没有返回更新包：${oneLine(s, 140)}`
  if (l.includes('called before')) return '操作顺序错误：还没下载就发起安装，已拒绝'
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
    return { state: 'available', current, info: infoOf(u), update: u }
  } catch (e) {
    return { state: 'failed', message: describeError(e) }
  }
}

/**
 * 一句进度。百分比是这一路的节流单位：同一条原样返回，界面据此决定要不要 setState。
 * 单位取整数的原因不是好看——实测一趟 32~39 枚 Progress 事件（两次同尺寸同源的包枚数就不同），
 * 而"每枚事件刷一次界面"既没有信息也没有必要。
 */
export function progressLine(received: number, total: number | null): string {
  if (!total) return `已下载 ${(received / 1048576).toFixed(1)} MiB（更新源未给出包体大小）`
  return `下载中 ${Math.min(100, Math.floor((received / total) * 100))}%`
}

export type DownloadResult =
  | { state: 'downloaded'; bytes: number }
  | { state: 'failed'; message: string }

/**
 * 下载那一拍：字节进 Rust 侧内存、验签也在那里做，一个字节都不往盘上写（实测 %TEMP% 零枚新落点），
 * 所以这一路前面没有闸。累计字节由 Progress 逐枚累加，包体大小只在 Started 给一次；
 * Finished 的 payload 是 null（实测：读它的 data 会当场抛，所以这里根本不碰它）。
 */
export async function downloadUpdate(
  update: Update,
  onProgress?: (line: string, received: number, total: number | null) => void,
  timeoutMs = 120000
): Promise<DownloadResult> {
  let received = 0
  let total: number | null = null
  try {
    await update.download(
      (e: DownloadEvent) => {
        if (e.event === 'Started' && typeof e.data.contentLength === 'number') total = e.data.contentLength
        if (e.event === 'Progress') received += e.data.chunkLength
        onProgress?.(progressLine(received, total), received, total)
      },
      { timeout: timeoutMs }
    )
    return { state: 'downloaded', bytes: received }
  } catch (e) {
    return { state: 'failed', message: describeError(e) }
  }
}

/**
 * 「装」前面那道闸的唯一一句话：返回 null 才许往下走。
 * 它是纯函数而不是内联 if——这句话必须排在 `install()` **之前**，因为 Windows 那一拍以
 * `std::process::exit(0)` 收尾，进了里面再报错就没有人能听见了。
 */
export function installBlock(dirtyCount: number): string | null {
  if (dirtyCount > 0) return `还有 ${dirtyCount} 处未保存改动，先保存再装（装上会立刻退出应用）`
  return null
}

export type InstallResult = { state: 'launched' } | { state: 'failed'; message: string }

/**
 * 装那一拍。成功在 Windows 上不会返回（装完直接 exit），所以 `{state:'launched'}` 这一支
 * 记录的是"命令发出去了"，而不是"界面还在"。restartAfterInstall 显式写出：它是插件默认值，
 * 而这一路要的正是"装完就重启"，写出来也让它成为可被变异的一格。
 */
export async function installUpdate(update: Update): Promise<InstallResult> {
  try {
    await update.install({ restartAfterInstall: true })
    return { state: 'launched' }
  } catch (e) {
    return { state: 'failed', message: describeError(e) }
  }
}

/** 重新检查之前释放上一份下载：实测宿主工作集 68→78→68 MiB，close() 就是那把放回去的手 */
export async function closeUpdate(update: Update): Promise<void> {
  try {
    await update.close()
  } catch {
    // 连点两次检查时上一份可能已经关过：这句话没有需要告诉用户的事，但它不能变成一记未处理的 rejection
  }
}
