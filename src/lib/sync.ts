import type { RecentFile } from '../store'

// 「最近项目」端到端加密同步：口令 PBKDF2 派生密钥 → AES-GCM 密封 recents JSON，
// 产物是可放进任意网盘/共享目录的 .oosync 文本文件；应用不存口令，只有持有者可解密。

const PBKDF2_ITERATIONS = 150_000
const SALT_LEN = 16
const IV_LEN = 12

interface SyncEnvelope {
  app: 'openoffices'
  kind: 'recents-sync'
  v: 1
  salt: string
  iv: string
  data: string
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptRecents(recents: RecentFile[], passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const key = await deriveKey(passphrase, salt)
  const plain = new TextEncoder().encode(
    JSON.stringify({ exportedAt: Date.now(), recents }),
  )
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  const env: SyncEnvelope = {
    app: 'openoffices',
    kind: 'recents-sync',
    v: 1,
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(data),
  }
  return JSON.stringify(env, null, 2)
}

function validateShape(v: unknown): RecentFile[] {
  const recents = (v as { recents?: unknown }).recents
  if (!Array.isArray(recents)) throw new Error('同步文件内容缺少 recents 列表')
  const out: RecentFile[] = []
  for (const r of recents) {
    const o = r as Partial<RecentFile>
    if (typeof o?.path !== 'string' || !o.path) continue
    if (o.kind !== 'doc' && o.kind !== 'sheet' && o.kind !== 'ppt' && o.kind !== 'pdf') continue
    if (typeof o.openedAt !== 'number') continue
    out.push({ path: o.path, kind: o.kind, openedAt: o.openedAt })
  }
  return out
}

export async function decryptRecents(text: string, passphrase: string): Promise<RecentFile[]> {
  let env: SyncEnvelope
  try {
    env = JSON.parse(text)
  } catch {
    throw new Error('不是有效的同步文件（JSON 解析失败）')
  }
  if (env?.app !== 'openoffices' || env?.kind !== 'recents-sync') {
    throw new Error('不是 OpenOffices 的同步文件')
  }
  if (env.v !== 1) throw new Error(`不支持的同步文件版本：${env.v}`)
  const key = await deriveKey(passphrase, fromB64(env.salt))
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(env.iv) },
      key,
      fromB64(env.data),
    )
  } catch {
    throw new Error('解密失败：口令错误或文件被篡改')
  }
  return validateShape(JSON.parse(new TextDecoder().decode(plain)))
}
