/**
 * 署名身份 · 兼容桩（v0.196 整合轮）
 *
 * 远程主线声称有 identity.ts（v0.128 起，协同/修订/批注的作者名与颜色），
 * 源码从未提交。本桩把名字落 localStorage（署名改动不丢），
 * 颜色用稳定的字符串散列生成，与「同一署名同一颜色」的语义一致。
 */
const K_NAME = 'oo.identity.name'

export function identityName(): string {
  try {
    return localStorage.getItem(K_NAME) || '匿名'
  } catch {
    return '匿名'
  }
}

export function setIdentityName(name: string): void {
  try {
    localStorage.setItem(K_NAME, name)
  } catch {
    /* 隐私模式：本会话内的名字由调用方 state 持有 */
  }
}

export function authorColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) | 0
  return `hsl(${Math.abs(h) % 360} 62% 44%)`
}
