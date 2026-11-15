// 协同端到端验证（Node 侧）
//
// 起一个真的中继（src-tauri/examples/relay.rs），然后用两个独立的 Yjs 文档
// 走一遍完整的同步握手 + 双向同步 + awareness，证明：
//   1. 第一个客户端的"播种"能被第二个客户端收到
//   2. 之后任一边的改动都能到另一边
//   3. 并发改动不丢（CRDT 的本分）
//   4. awareness（谁在线）互见
//
// 帧格式与 src/lib/collab.ts 完全一致：[0]=同步，[1]=awareness，[2]=ping，[3]=pong，
// 载荷是 lib0 编出来的 Yjs 协议消息。这里不用 collab.ts 本身——它依赖
// ProseMirror 编辑器与 Tauri，Node 里跑不起来；但协议部分必须一模一样，
// 否则这个测试就白做了。
//
// v0.136 补的两组断言：
//   1. 应用层心跳——ping 只回声给发它的人，房里其他人一个字节都不该收到
//      （广播心跳会让 N 个客户端的心跳变成 N² 帧，是这套中继唯一能自我打垮的地方）
//   2. 空闲但健康的连接不会被服务端的探活误杀
//      （服务端超时后发 RFC 6455 ping，符合规范的客户端会自动回 pong）
// 第 2 组要用一个"读超时压到毫秒级"的中继实例：生产的 90 秒在测试里等不起。

import { spawn } from 'node:child_process'
import * as Y from 'yjs'
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync'
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const RELAY = process.env.RELAY_BIN
  ?? `src-tauri/target/debug/examples/relay${process.platform === 'win32' ? '.exe' : ''}`
const MSG_SYNC = 0
const MSG_AWARENESS = 1
const MSG_PING = 2
const MSG_PONG = 3

const ok = []
const bad = []
const check = (name, cond, extra = '') => {
  ;(cond ? ok : bad).push(name + (extra ? ` — ${extra}` : ''))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 起中继 ──
function startRelay(args) {
  const p = spawn(RELAY, args, { cwd: process.cwd() })
  const port = new Promise((resolve, reject) => {
    let buf = ''
    p.stdout.on('data', (d) => {
      buf += d.toString()
      const line = buf.split('\n')[0].trim()
      if (/^\d+$/.test(line)) resolve(Number(line))
    })
    p.on('error', reject)
    setTimeout(() => reject(new Error('中继没起来')), 15000)
  })
  return { proc: p, port }
}
const relay = startRelay(['0'])
const port = await relay.port
console.log(`中继起了，端口 ${port}`)

// ── 一个最小的"客户端"：与 collab.ts 同一套编解码 ──
function makeClient(room, p = port) {
  const ydoc = new Y.Doc()
  const awareness = new Awareness(ydoc)
  awareness.setLocalStateField('user', {
    name: `用户-${Math.floor(Math.random() * 1000)}`,
    color: '#2c66d4',
  })
  const ws = new WebSocket(`ws://127.0.0.1:${p}`)
  const ready = new Promise((res, rej) => {
    ws.onopen = () => {
      ws.send(room)
      const enc = encoding.createEncoder()
      writeSyncStep1(enc, ydoc)
      ws.send(encoding.toUint8Array(enc))
      // 本地 awareness 状态（构造时就设好了）主动补发一次
      const u0 = encodeAwarenessUpdate(awareness, [ydoc.clientID])
      const o0 = new Uint8Array(u0.length + 1)
      o0[0] = MSG_AWARENESS
      o0.set(u0, 1)
      ws.send(o0)
      res()
    }
    ws.onerror = () => rej(new Error('连不上'))
  })
  // 收过的每一帧的 kind，按序。心跳那两条断言靠它：既能看"收到了什么"，
  // 也能看"在某个时间窗里**没有**收到什么"
  const seen = []
  ws.onmessage = (ev) => {
    ev.data.arrayBuffer().then((ab) => {
      const buf = new Uint8Array(ab)
      const kind = buf[0]
      seen.push(kind)
      // 心跳的两头都不往下走：pong 只是回声，ping 是给服务端的（也不会被转发过来）
      if (kind === MSG_PING || kind === MSG_PONG) return
      const payload = buf.subarray(1)
      if (kind === MSG_SYNC) {
        // 空 step2 没有信息量，Yjs 不接受零长度更新，精确跳过
        if (payload.length === 2 && payload[0] === 1 && payload[1] === 0) return
        const dec = decoding.createDecoder(payload)
        const enc = encoding.createEncoder()
        readSyncMessage(dec, enc, ydoc, 'remote')
        if (encoding.length(enc) > 0) {
          const out = new Uint8Array(encoding.length(enc) + 1)
          out[0] = MSG_SYNC
          out.set(encoding.toUint8Array(enc), 1)
          ws.send(out)
        }
      } else if (kind === MSG_AWARENESS) {
        applyAwarenessUpdate(awareness, payload, 'remote')
      }
    })
  }
  ydoc.on('update', (update, origin) => {
    if (origin === 'remote') return
    const enc = encoding.createEncoder()
    writeUpdate(enc, update)
    const out = new Uint8Array(encoding.length(enc) + 1)
    out[0] = MSG_SYNC
    out.set(encoding.toUint8Array(enc), 1)
    ws.send(out)
  })
  const knownPeers = new Set()
  awareness.on('update', ({ added, updated }) => {
    // 自己变了才广播自己；别人变了要走下面的"新对端"分支（不能在这里提前返回，
    // 否则收到对方的 awareness 后就再也不会重发同步请求与自我通告）
    if ([...added, ...updated].includes(ydoc.clientID)) {
      const u = encodeAwarenessUpdate(awareness, [ydoc.clientID])
      const out = new Uint8Array(u.length + 1)
      out[0] = MSG_AWARENESS
      out.set(u, 1)
      ws.send(out)
    }
    // 见到新对端：重发同步请求（中继不缓存入房前的帧，开场那次 step1 可能已被蒸发）
    const now = new Set(
      [...awareness.getStates()].filter(([id]) => id !== ydoc.clientID).map(([id]) => id),
    )
    const hasNew = [...now].some((id) => !knownPeers.has(id))
    knownPeers.clear()
    for (const id of now) knownPeers.add(id)
    if (hasNew) {
      const enc = encoding.createEncoder()
      writeSyncStep1(enc, ydoc)
      const o2 = new Uint8Array(encoding.length(enc) + 1)
      o2[0] = MSG_SYNC
      o2.set(encoding.toUint8Array(enc), 1)
      ws.send(o2)
      // 同时把自己重新通告一次
      const u2 = encodeAwarenessUpdate(awareness, [ydoc.clientID])
      const o3 = new Uint8Array(u2.length + 1)
      o3[0] = MSG_AWARENESS
      o3.set(u2, 1)
      ws.send(o3)
    }
  })
  return {
    ydoc,
    awareness,
    ready,
    seen,
    /** 应用层心跳：发一枚 ping，等对面回声 pong */
    ping: () => ws.send(new Uint8Array([MSG_PING])),
    /** 连接是不是已经被（服务端）关掉了 */
    gone: () => ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING,
    close: () => {
      try {
        ws.close()
      } catch {}
    },
  }
}

let relay2 = null
try {
  const room = `test-${Date.now()}`

  // A 先进房，往 Y.Doc 里播一段内容（相当于 collab.ts 的 seedFromEditor）
  const a = makeClient(room)
  await a.ready
  const seed = new Y.Doc()
  seed.getText('t').insert(0, '第一份内容')
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(seed), 'seed')
  await new Promise((r) => setTimeout(r, 150))

  // B 后进房：同步握手应把 A 的内容带过来
  const b = makeClient(room)
  await b.ready
  await new Promise((r) => setTimeout(r, 400))

  check(
    'B 通过同步拿到了 A 播种的内容',
    b.ydoc.getText('t').toString() === '第一份内容',
    `B 读到「${b.ydoc.getText('t').toString()}」`,
  )

  // B 改，A 应收到
  b.ydoc.getText('t').insert(0, 'B加的-')
  await new Promise((r) => setTimeout(r, 250))
  check(
    'B 的改动到了 A',
    a.ydoc.getText('t').toString() === 'B加的-第一份内容',
    `A 读到「${a.ydoc.getText('t').toString()}」`,
  )

  // A 改，B 应收到
  a.ydoc.getText('t').insert(0, 'A加的-')
  await new Promise((r) => setTimeout(r, 250))
  check(
    'A 的改动到了 B',
    b.ydoc.getText('t').toString() === 'A加的-B加的-第一份内容',
    `B 读到「${b.ydoc.getText('t').toString()}」`,
  )

  // 并发改同一个位置：CRDT 的本分，两边都不能丢
  a.ydoc.getText('t').insert(a.ydoc.getText('t').toString().length, '|A尾')
  b.ydoc.getText('t').insert(b.ydoc.getText('t').toString().length, '|B尾')
  await new Promise((r) => setTimeout(r, 350))
  const ta = a.ydoc.getText('t').toString()
  const tb = b.ydoc.getText('t').toString()
  check(
    '并发追加两边都没丢',
    ta.includes('|A尾') && ta.includes('|B尾'),
    `A: 「${ta}」`,
  )
  check('两边最终一致（CRDT 收敛）', ta === tb, `A:「${ta}」 B:「${tb}」`)

  // awareness：互见
  await new Promise((r) => setTimeout(r, 400))
  const peersOfA = [...a.awareness.getStates()].filter(([id]) => id !== a.ydoc.clientID)
  const peersOfB = [...b.awareness.getStates()].filter(([id]) => id !== b.ydoc.clientID)
  check('A 看得到 B 在线', peersOfA.length === 1, `A 看到 ${peersOfA.length} 人`)
  check('B 看得到 A 在线', peersOfB.length === 1, `B 看到 ${peersOfB.length} 人`)

  // 不同房间不该互通
  const c = makeClient(room + '-other')
  await c.ready
  c.ydoc.getText('t').insert(0, '别房的内容')
  await new Promise((r) => setTimeout(r, 300))
  check(
    '不同房间互不干扰',
    !a.ydoc.getText('t').toString().includes('别房的内容'),
    `A 的内容:「${a.ydoc.getText('t').toString()}」`,
  )

  // ── 应用层心跳 ──
  // ping 必须有回声（没有回声的话前端会判定连接已废而反复重连），
  // 且**不能**被转发：房里 N 个人各发各的心跳，广播会把它变成 N² 帧
  await sleep(200)
  const aSeen0 = a.seen.length
  const bSeen0 = b.seen.length
  a.ping()
  await sleep(400)
  check(
    'ping 收到 pong 回声',
    a.seen.slice(aSeen0).includes(MSG_PONG),
    `A 这 400ms 里收到 [${a.seen.slice(aSeen0)}]`,
  )
  check(
    '心跳没有广播给同屋的其他人',
    b.seen.length === bSeen0,
    `B 这 400ms 里多收到 [${b.seen.slice(bSeen0)}]`,
  )
  // 心跳不该挡住正事
  const aText0 = b.ydoc.getText('t').toString()
  a.ydoc.getText('t').insert(0, '心跳后-')
  await sleep(300)
  check(
    '发了心跳之后数据帧照旧通',
    b.ydoc.getText('t').toString() === '心跳后-' + aText0,
    `B 读到「${b.ydoc.getText('t').toString()}」`,
  )

  // ── 探活不该误杀空闲的健康连接 ──
  // 这一趟要用一个"读超时压到 100ms"的中继：生产是 30 秒一拍、三拍才清（90 秒），
  // 测试里等不起。服务端超时后发的是 RFC 6455 的 ping，符合规范的客户端自动回 pong
  relay2 = startRelay(['0', '100'])
  const port2 = await relay2.port
  const idle = makeClient('room-idle', port2)
  await idle.ready
  await sleep(1200) // 跨过十几拍：真被误杀的话这时候早关了
  check('空闲但健康的连接没被探活踢掉', !idle.gone())
  idle.close()

  a.close()
  b.close()
  c.close()
} finally {
  relay.proc.kill()
  relay.proc.unref()
  if (relay2) {
    relay2.proc.kill()
    relay2.proc.unref()
  }
}

console.log(`\n通过 ${ok.length} 项：`)
for (const s of ok) console.log('  ✓', s)
if (bad.length) {
  console.log(`\n失败 ${bad.length} 项：`)
  for (const s of bad) console.log('  ✗', s)
  process.exit(1)
}
console.log('\n全部通过')
// 中继是子进程：杀掉后 Node 仍会等它的 stdio 关掉，这里显式收尾
process.exit(bad.length ? 1 : 0)
