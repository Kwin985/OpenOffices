// 作者身份（v0.128）
//
// 协同的第一块砖不是传输，是**"我是谁"**：修订与批注都要署名，
// 否则两个人改完一份文档，Word 打开只看得到一串"我"。
//
// 这一层只做两件事：记下本机这位作者叫什么，以及把任意一个作者名稳定地映成一枚颜色。
// 颜色走名字的哈希而不是发号：同一个人在这台机器和在别人机器上看到的是同一色，
// 且不需要给作者们排号（排号要有一份共享的作者表，那是服务端的事）。

const KEY = 'openoffices.identity'

export interface Identity {
  name: string
}

const DEFAULT_NAME = '我'

// 八色轮：相邻两色在深浅上都拉开了，缩略图那么小也能分出是谁
const AUTHOR_COLORS = [
  '#c0392b',
  '#2874a6',
  '#1e8449',
  '#b9770e',
  '#7d3c98',
  '#117864',
  '#a04000',
  '#4a5568',
]

export function identityName(): string {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_NAME
    const v = JSON.parse(raw)
    return typeof v?.name === 'string' && v.name.trim() ? v.name.trim() : DEFAULT_NAME
  } catch {
    return DEFAULT_NAME
  }
}

export function setIdentityName(name: string): void {
  const clean = name.trim().slice(0, 40) || DEFAULT_NAME
  try {
    localStorage.setItem(KEY, JSON.stringify({ name: clean }))
  } catch {
    // 存不下就只在本次会话里换名——名字不落盘不该让署名崩掉
  }
}

/** 名字 → 稳定色。改一个字颜色就跳，所以只按整串做一次哈希 */
export function authorColor(name: string): string {
  let h = 5381
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0
  return AUTHOR_COLORS[Math.abs(h) % AUTHOR_COLORS.length]
}
