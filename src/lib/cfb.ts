// 复合文档（CFB / "OLE 2 容器"，MS-C 规格）读侧：老版 Office 把嵌入的原生文件（.xls、.doc、图片、
// Visio 图）装在这层容器里，Word 的 word/embeddings/oleObjectN.bin 就是它。
// 零依赖、不碰 DOM，Node 侧的结构测试与应用内跑同一份代码。
// 只做读：这台机器上 PowerShell 连 IStorage 都取不到（ole32 的写侧入口在 PS 5.1 里没暴露），
// 而"嵌回去的东西我们自己的读侧还得认得"风险远大于收益，所以写回不在这条路上。

/** 每条目录项固定 128 字节 */
const DIR_ENTRY = 128
const ENDOFCHAIN = 0xfffffffe
const FREESECT = 0xffffffff
/** 单条流最多读到 256MB：真件里见过 74MB 的嵌入体，不设上限等于让一次导入吃掉整台机器的内存 */
const MAX_BYTES = 0x1000_0000

export type CfbKind = 'unknown' | 'storage' | 'stream' | 'root'

export interface CfbEntry {
  /** 全路径；根下的流就是名字本身（如 `\x01Ole10Native`） */
  path: string
  name: string
  kind: CfbKind
  size: number
}

export interface CfbFile {
  entries: CfbEntry[]
  /** 按名字取流字节（不区分大小写，也可写全路径）；没有这条流或超出可读范围返回 null */
  read(name: string): Uint8Array | null
}

export function isCfb(b: Uint8Array | null | undefined): b is Uint8Array {
  if (!b || b.length < 512) return false
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return false
  return true
}

/**
 * 打开一份复合文档。结构不合（版本/扇区大小不认识、目录链断裂、FAT 覆盖不到）返回 null，不抛错：
 * 调用方要的是"取不到就记一条边界"，不是把整次导入掀掉。
 */
export function openCfb(bytes: Uint8Array): CfbFile | null {
  if (!isCfb(bytes)) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const major = dv.getUint16(26, true)
  const sec = 1 << dv.getUint16(30, true)
  // 实测（Word 16.0 写的 oleObject1.bin）：v3 / 扇区 512 / 迷你扇区 64；v4 扇区是 4096
  if (major !== 3 && major !== 4) return null
  if (sec !== 512 && sec !== 4096) return null
  if ((1 << dv.getUint16(32, true)) !== 64) return null

  const dirStart = dv.getUint32(48, true)
  const miniCutoff = dv.getUint32(56, true) || 4096
  const minifatStart = dv.getUint32(60, true)
  const difatStart = dv.getUint32(68, true)
  const difatCount = dv.getUint32(72, true)
  // 能整扇区读出来的最后一枚：扇区 N 占 [(N+1)*sec, (N+2)*sec)，故"文件长度/扇区 - 1"。
  // 截断的件（下载中断、zip 里只存了一半）最后一枚是残缺的，按整枚去读会撞到 DataView 边界
  const lastSec = Math.max(0, Math.floor(bytes.length / sec) - 1)

  // DIFAT：头里 109 个直槽，不够再沿 difatStart 链续；每一项指出一枚 FAT 扇区的编号
  const fatSects: number[] = []
  const pushFat = (id: number) => {
    if (id !== FREESECT && id !== ENDOFCHAIN && id < lastSec) fatSects.push(id)
  }
  for (let i = 0; i < 109; i++) pushFat(dv.getUint32(76 + i * 4, true))
  let nxt = difatStart
  const difatSeen = new Set<number>()
  while (nxt !== ENDOFCHAIN && nxt !== FREESECT && nxt < lastSec && !difatSeen.has(nxt)) {
    difatSeen.add(nxt)
    if (difatSeen.size > difatCount + 1) break
    const base = (nxt + 1) * sec
    const n = sec / 4
    for (let i = 0; i < n - 1; i++) pushFat(dv.getUint32(base + i * 4, true))
    nxt = dv.getUint32(base + (n - 1) * 4, true)
  }
  if (!fatSects.length) return null

  // FAT 是按扇区编号索引的数组，扇区编号 = 它在这条拼接出来的数组里的下标
  const fat = new Int32Array(fatSects.length * (sec / 4))
  fat.fill(-1)
  fatSects.forEach((s, k) => {
    const base = (s + 1) * sec
    for (let i = 0; i < sec / 4; i++) fat[k * (sec / 4) + i] = dv.getInt32(base + i * 4, true)
  })
  const maxSector = fat.length

  /** 沿 FAT 走一条链，拼出整扇区的字节；越界、成环或超过上限就截断 */
  const chain = (start: number): Uint8Array => {
    if (start === ENDOFCHAIN || start === FREESECT || start < 0 || start >= maxSector) return new Uint8Array(0)
    const ids: number[] = []
    const gone = new Set<number>()
    let s = start
    while (s !== ENDOFCHAIN && s !== FREESECT && s >= 0 && s < maxSector && !gone.has(s) && ids.length * sec <= MAX_BYTES) {
      gone.add(s)
      if (s < lastSec) ids.push(s)
      s = fat[s]
    }
    const out = new Uint8Array(ids.length * sec)
    ids.forEach((id, k) => {
      const base = (id + 1) * sec
      out.set(bytes.subarray(base, base + sec), k * sec)
    })
    return out
  }

  const dirRaw = chain(dirStart)
  if (dirRaw.length < DIR_ENTRY) return null
  const nd = new DataView(dirRaw.buffer, dirRaw.byteOffset, dirRaw.byteLength)
  const nEntries = Math.floor(dirRaw.length / DIR_ENTRY)
  const names: string[] = []
  const kinds: CfbKind[] = []
  const lefts: number[] = []
  const rights: number[] = []
  const childs: number[] = []
  const starts: number[] = []
  const sizes: number[] = []
  const big: boolean[] = []
  for (let i = 0; i < nEntries; i++) {
    const o = i * DIR_ENTRY
    const nameLen = nd.getUint16(o + 64, true)
    let s = ''
    for (let c = 0; c + 2 < Math.min(nameLen, 64); c += 2) s += String.fromCharCode(nd.getUint16(o + c, true))
    const t = dirRaw[o + 66]
    names.push(s)
    kinds.push(t === 5 ? 'root' : t === 1 ? 'storage' : t === 2 ? 'stream' : 'unknown')
    lefts.push(nd.getInt32(o + 68, true))
    rights.push(nd.getInt32(o + 72, true))
    childs.push(nd.getInt32(o + 76, true))
    starts.push(nd.getUint32(o + 116, true))
    sizes.push(nd.getUint32(o + 120, true))
    // v4 的长度是 8 字节；高 32 位非零说明这条流我们读不动，宁可只报名字也不去碰它
    big.push(nd.getUint32(o + 124, true) !== 0)
  }
  const rootIdx = kinds.indexOf('root')
  if (rootIdx < 0) return null

  // 迷你流：根存储那条链装的正是它；小于阈值（4096）的流按 64 字节迷你扇区住在里面
  const mini = sizes[rootIdx] > 0 ? chain(starts[rootIdx]).subarray(0, sizes[rootIdx]) : new Uint8Array(0)
  const mraw = minifatStart === ENDOFCHAIN ? new Uint8Array(0) : chain(minifatStart)
  const mfat = new Int32Array(Math.floor(mraw.length / 4))
  {
    const mv = new DataView(mraw.buffer, mraw.byteOffset, mraw.byteLength)
    for (let i = 0; i < mfat.length; i++) mfat[i] = mv.getInt32(i * 4, true)
  }
  const miniChain = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size)
    let s = start
    let o = 0
    const gone = new Set<number>()
    while (o < size && s !== ENDOFCHAIN && s !== FREESECT && s >= 0 && s < mfat.length && !gone.has(s)) {
      gone.add(s)
      const base = s * 64
      const n = Math.min(64, size - o)
      if (base + n > mini.length) break
      out.set(mini.subarray(base, base + n), o)
      o += n
      s = mfat[s]
    }
    return out.subarray(0, o)
  }

  const streamBytes = (i: number): Uint8Array | null => {
    if (kinds[i] !== 'stream' || big[i]) return null
    if (sizes[i] === 0) return new Uint8Array(0)
    return sizes[i] < miniCutoff ? miniChain(starts[i], sizes[i]) : chain(starts[i]).subarray(0, sizes[i])
  }

  // 同一存储下的条目排成红黑树（left/right 是树兄弟，child 指向其孩子的树根）；
  // assigned 兼作防环闸门：一个下标只可能属于一棵树，走第二次就是文件写坏了
  const paths = new Array<string>(nEntries).fill('')
  const assigned = new Set<number>()
  const walk = (idx: number, parent: string): void => {
    if (idx < 0 || idx >= nEntries || assigned.has(idx)) return
    assigned.add(idx)
    walk(lefts[idx], parent)
    paths[idx] = parent ? `${parent}/${names[idx]}` : names[idx]
    if (kinds[idx] === 'storage') walk(childs[idx], paths[idx])
    walk(rights[idx], parent)
  }
  walk(childs[rootIdx], '')
  paths[rootIdx] = ''
  const entries: CfbEntry[] = []
  for (let i = 0; i < nEntries; i++) {
    if (kinds[i] === 'unknown' || !names[i]) continue
    entries.push({ path: paths[i] || names[i], name: names[i], kind: kinds[i], size: sizes[i] })
  }
  return {
    entries,
    read(name: string) {
      const want = name.replace(/^\//, '').toLowerCase()
      for (let i = 0; i < nEntries; i++) {
        if (kinds[i] !== 'stream') continue
        if (names[i].toLowerCase() === want || paths[i].toLowerCase() === want) return streamBytes(i)
      }
      return null
    },
  }
}
