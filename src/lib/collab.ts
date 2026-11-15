// 实时协同（v0.130）
//
// 一句话：多个编辑器实例同时改一份文档，谁的改动都不会丢，也不需要谁锁着谁。
//
// 分层（这一层只管中间与下面那两层，不管界面）：
//   CRDT —— Yjs。两人同时在一个字后面各打一个字，合并后两个字都在。
//          这是"不需要锁"的全部根据：冲突在数据结构层面就不存在。
//   绑定 —— y-prosemirror。把 Yjs 的 Y.XmlFragment 与 ProseMirror 的 doc 对上，
//          ProseMirror 的每次事务转成 CRDT 操作，CRDT 的每次变更转回事务。
//   传输 —— 本项目自己的 WebSocket 中继（src-tauri/src/ws_relay.rs）。
//          它只认房间名、只转发帧，不懂文档。
//
// 三条实现上的关键取舍：
//
// 1. **插件是运行时注册的，不是建编辑器时就带上的。**
//    TipTap 的 registerPlugin/unregisterPlugin 能把 ProseMirror 插件挂进
//    现有 editor view。这使用户可以先正常编辑、想协作了再开，
//    开了之后原地变成协同编辑器——不用为了协同把文档关了重开。
//    代价是 undo 历史从开启那刻起算（之前的编辑不在 Yjs 的 undo 栈里），
//    这一点在界面上说清。
//
// 2. **第一个进房的人负责"播种"**：把当前编辑器内容写进 Y.Doc。
//    不这么做，两个各自有内容的编辑器互连会各说各话。判定"第一个"的办法是
//    连上后等一小会儿看有没有别人通过 awareness 打招呼——有就不播，
//    对方的同步协议会把内容推过来（Yjs 的 sync step1/step2）。
//    中继不缓存"入房之前"的帧，也是同一个道理：补上是同步协议的活，
//    中继为此背缓冲只会无限增长。
//
// 3. **协同只覆盖 ProseMirror doc 承载得下的东西**：正文、段落/字符属性、
//    表格结构、图片（base64 在节点属性里）、批注与脚注同样在节点属性里。
//    覆盖不了的是"没进 doc 的状态"——例如文档级的页眉页脚目前就不在 doc 里，
//    那些不会同步。往编辑器外面加状态时要记得这一点。

import * as Y from 'yjs'
import {
  prosemirrorJSONToYDoc,
  yCursorPlugin,
  ySyncPlugin,
  ySyncPluginKey,
  yUndoPlugin,
  yUndoPluginKey,
} from 'y-prosemirror'
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness'
import {
  messageYjsSyncStep2,
  readSyncMessage,
  writeSyncStep1,
  writeUpdate,
} from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { invoke } from '@tauri-apps/api/core'
import { authorColor, identityName } from './identity'
import type { Editor } from '@tiptap/core'

/** 与中继约定的四种消息：0 = Yjs 同步，1 = awareness（光标/在线状态），2 = ping，3 = pong */
const MSG_SYNC = 0
const MSG_AWARENESS = 1
const MSG_PING = 2
const MSG_PONG = 3
/** 等多久没见到别人才认定自己是第一个进房的（要负责播种） */
const SEED_WAIT_MS = 400

// ── 心跳（v0.136）──
//
// 为什么要有它：WebSocket 的 RFC 6455 有 ping/pong 帧，但**浏览器不给 JS 任何
// "收到了 ping"的事件**——服务端能用它探活，前端却探不了服务端。于是两端各付一份：
//   - 服务端（ws_relay.rs）：读超时后发协议层 ping 探活，几拍没回声就关门清房；
//   - 前端（这里）：定时发应用层 ping，收不到 pong 就认定连接已经废了，重连。
// 应用层这一对是中继**唯一**会看载荷内容的地方：ping 只回声给发它的人，不进房间广播。
//
// 为什么要重连：中继是本机的一个端口，但它会被别的窗口关掉（谁起的谁收摊）、
// 也会被用户手动停。断了不重连的话，界面只会红着一行字，协同再也回不来。
const PING_EVERY_MS = 15_000
/** 超过这么久没收到任何一帧就判定连接已废（够发三次 ping 并等回声） */
const SILENCE_DEADLINE_MS = 45_000
/** 重连退避：500ms 起，每次翻倍，到 8s 为止 */
const RETRY_MIN_MS = 500
const RETRY_MAX_MS = 8_000
/** 连着失败这么多次就放弃并报错：一直沉默地重试，用户会以为还在协同 */
const RETRY_GIVE_UP = 8

export interface CollabPeer {
  /** Yjs/Awareness 的 clientID */
  id: number
  name: string
  color: string
}

/** retrying = 断线后正在退避重连。它是"没在协同里"，但不是"失败"——界面不该报红 */
export type CollabState = 'off' | 'starting' | 'on' | 'retrying' | 'error'

export interface CollabStatus {
  state: CollabState
  /** 房间名（同名实例才会互见） */
  room: string
  /** 中继端口；0 表示还没起来 */
  port: number
  /** 房里除我之外的人 */
  peers: CollabPeer[]
  /** 出错时给人看的那句话 */
  error: string
}

/**
 * 一次协同会话。
 *
 * 用法：`new CollabSession(editor)` → `await start(room)` → `stop()`。
 * 一个 editor 同时只该有一个会话；重复 start 会先 stop 旧的。
 */
export class CollabSession {
  readonly ydoc: Y.Doc
  private awareness: Awareness
  private undoManager: Y.UndoManager
  private ws: WebSocket | null = null
  private seedTimer: ReturnType<typeof setTimeout> | null = null
  /** 我们起的中继（而不是"起之前就已经在跑"的那个）——退出时要收摊 */
  private ownRelay = false
  private onStatus: (s: CollabStatus) => void
  private editor: Editor
  private disposed = false
  /** 主动停止中：此间的 onclose 是我们自己关的，不该触发重连 */
  private closing = false
  private room = ''
  /** 本机改动 → 广播 与 awareness → 广播 这两个监听器的引用。
   *  存下来是为了 `stop()` 能摘掉：不摘的话每开一次协同就多挂一份，
   *  第五次开始一次按键会往房里发五遍同样的帧 */
  private onDocUpdate: ((u: Uint8Array, o: unknown) => void) | null = null
  private onAwarenessUpdate: ((c: { added: number[]; updated: number[] }) => void) | null = null
  private knownPeers = new Set<number>()
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  /** 最后一次收到任何一帧的时刻：心跳判定"对面还活着"的全部依据 */
  private lastSeen = 0

  status: CollabStatus = { state: 'off', room: '', port: 0, peers: [], error: '' }

  constructor(editor: Editor, onStatus: (s: CollabStatus) => void) {
    this.editor = editor
    this.onStatus = onStatus
    this.ydoc = new Y.Doc()
    this.undoManager = new Y.UndoManager(this.ydoc)
    this.awareness = new Awareness(this.ydoc)
    const name = identityName()
    this.awareness.setLocalStateField('user', { name, color: authorColor(name) })
  }

  private set(patch: Partial<CollabStatus>) {
    this.status = { ...this.status, ...patch }
    if (!this.disposed) this.onStatus(this.status)
  }

  /** 房里除我之外的人 */
  peers(): CollabPeer[] {
    const out: CollabPeer[] = []
    const mine = this.ydoc.clientID
    for (const [id, st] of this.awareness.getStates()) {
      if (id === mine) continue
      const u = st?.user as { name?: string; color?: string } | undefined
      out.push({ id, name: u?.name ?? '匿名', color: u?.color ?? '#888' })
    }
    return out
  }

  async start(room: string): Promise<void> {
    if (this.status.state === 'on' || this.status.state === 'starting') this.stop()
    this.room = room
    this.retryAttempt = 0
    this.set({ state: 'starting', room, error: '' })
    try {
      // 1. 中继。起之前先问在不在跑：在跑的就不是这一趟起的，退出时不该由我们停
      const port = await this.ensureRelay()
      this.set({ port })

      // 2. 连上去并跑同步握手
      await this.connect(room, port)
      if (this.closing || this.disposed) {
        // stop 已经把状态置 off，这里只是别再往回改成 on
        this.set({ state: 'off', peers: [] })
        return
      }

      // 3. 挂插件——从这一刻起编辑器变成协同编辑器
      for (const p of [
        ySyncPlugin(this.ydoc.getXmlFragment('prosemirror')),
        yUndoPlugin({ undoManager: this.undoManager }),
        // 光标/选区用默认建造器（.ProseMirror-yjs-cursor / -selection 两个类名），
        // 颜色由 awareness 里的 user.color 决定，样式在 index.css 里收口
        yCursorPlugin(this.awareness),
      ]) {
        this.editor.registerPlugin(p)
      }

      // 4~5. 本机改动/光标 → 广播（只挂一次，stop 时摘掉）
      this.bindLocal()

      this.set({ state: 'on' })
      this.armPing()
      this.armSeed()
    } catch (e) {
      this.set({ state: 'error', error: e instanceof Error ? e.message : String(e) })
      this.stop()
    }
  }

  /**
   * 确保有一个中继在跑，返回它的端口。
   *
   * 一律走 `ws_relay_start`——它在"已经在跑"时只是回报当前端口、不重起
   * （重起会把房里的人全踢掉）。所以这一趟唯一要判断的是**退出时该不该由我们收摊**：
   * 起之前就在跑的中继是别的窗口（或更早的会话）起的，停掉它等于把同进程里
   * 正在协同的其他窗口一起踢下线。
   */
  private async ensureRelay(): Promise<number> {
    let wasRunning = false
    try {
      wasRunning = await invoke<boolean>('ws_relay_running')
    } catch {
      wasRunning = false
    }
    const port = await invoke<number>('ws_relay_start', { port: 0 })
    if (!wasRunning) this.ownRelay = true
    return port
  }

  /** 挂上"本机 → 广播"的两个监听器。重连不重挂：挂 N 份就会广播 N 遍 */
  private bindLocal() {
    if (this.onDocUpdate) return
    // 本机改动 → 广播。origin 为 'remote' 的更新是刚应用进来的，不能回环
    this.onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return
      // writeUpdate 自带 messageYjsUpdate 那一字节，别在外面再写一次
      const enc = encoding.createEncoder()
      writeUpdate(enc, update)
      this.sendSync(encoding.toUint8Array(enc))
    }
    this.ydoc.on('update', this.onDocUpdate)

    // 本机光标/在线状态变化 → 广播；见到新对端 → 重发一次同步请求
    this.onAwarenessUpdate = ({ added, updated }: { added: number[]; updated: number[] }) => {
      if ([...added, ...updated].includes(this.ydoc.clientID)) {
        this.sendAwareness(encodeAwarenessUpdate(this.awareness, [this.ydoc.clientID]))
      }
      const now = new Set(this.peers().map((p) => p.id))
      const hasNew = [...now].some((id) => !this.knownPeers.has(id))
      this.knownPeers = now
      this.set({ peers: this.peers() })
      // 中继不缓存"入房之前"的帧：本机开场发的那一次 step1 可能在对方还没进房时
      // 就被蒸发了，对方因此永远不知道本机有内容。见到新对端就重问一次，
      // 对方回 step2（全量差异）——这是这套"不缓冲"设计下唯一的收敛手段
      if (hasNew) {
        const enc = encoding.createEncoder()
        writeSyncStep1(enc, this.ydoc)
        this.sendSync(encoding.toUint8Array(enc))
        // 顺便把自己重新通告一次：开场那次 awareness 也可能被蒸发，
        // 不补发对方就永远不知道这儿有第二个人
        this.sendAwareness(encodeAwarenessUpdate(this.awareness, [this.ydoc.clientID]))
      }
    }
    this.awareness.on('update', this.onAwarenessUpdate)
  }

  private unbindLocal() {
    if (this.onDocUpdate) {
      this.ydoc.off('update', this.onDocUpdate)
      this.onDocUpdate = null
    }
    if (this.onAwarenessUpdate) {
      this.awareness.off('update', this.onAwarenessUpdate)
      this.onAwarenessUpdate = null
    }
    this.knownPeers = new Set()
  }

  /** 连中继并跑 Yjs 的同步握手 */
  private connect(room: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      this.ws = ws
      this.closing = false
      this.lastSeen = Date.now()
      const fail = (msg: string) => {
        if (this.ws === ws) this.ws = null
        try {
          ws.close()
        } catch {
          /* 已经关了 */
        }
        reject(new Error(msg))
      }
      ws.onopen = () => {
        // 首帧：房间名（文本帧）。中继只认这一帧，之后全是二进制
        ws.send(room)
        this.greet()
        resolve()
      }
      ws.onerror = () => fail('连不上协同中继')
      ws.onclose = () => {
        // 已经被换掉或主动关的：不是"断线"，别重连
        if (this.ws !== ws || this.closing || this.disposed) return
        // 走到这儿是意外断开（中继被别的窗口收摊了、进程没了……）
        this.dropAndRetry('协同连接断了')
      }
      ws.onmessage = (ev) => this.onFrame(ev.data)
    })
  }

  /**
   * 进房后的"打招呼"：状态向量 + 自我通告（+ 重连时的全量差异）。
   *
   * 重连那一路上还要多发一份全量 update，理由是 y-protocols 的不对称：收到
   * step1 的一方只回 step2（"你缺的"），**不会**回头发自己的 step1。于是
   * "我多出来的"只有自己推过去，对方才会知道——而断线那几分钟里我改的东西
   * 正是"我多出来的"。不补这一份，重连后本机改动就永远到不了对面。
   */
  private greet(fullState = false) {
    // writeSyncStep1 自己会写消息类型那一字节，这里别再套一层
    const enc = encoding.createEncoder()
    writeSyncStep1(enc, this.ydoc)
    this.sendSync(encoding.toUint8Array(enc))
    if (fullState) {
      const snap = Y.encodeStateAsUpdate(this.ydoc)
      // 空文档的快照是两字节的空更新，发出去没意义：跳过它，别让每次重连都发一份空帧
      if (snap.length > 2) {
        const e2 = encoding.createEncoder()
        writeUpdate(e2, snap)
        this.sendSync(encoding.toUint8Array(e2))
      }
    }
    // 本机的 awareness 状态（名字/颜色）也得主动发一次：它是在构造函数里就设好的，
    // 那会儿还没有监听器，不补发对方永远不知道"这儿有个人"
    this.sendAwareness(encodeAwarenessUpdate(this.awareness, [this.ydoc.clientID]))
  }

  // ── 心跳 ──

  private armPing() {
    this.clearPing()
    this.lastSeen = Date.now()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return
      this.sendRaw(new Uint8Array([MSG_PING]))
      // 发了三次 ping 都没等到任何一帧：这连接已经废了（对端进程没了、
      // 或者中继把它清出去了），再等下去界面只是一直"在线"却谁也收不到谁
      if (Date.now() - this.lastSeen > SILENCE_DEADLINE_MS) {
        this.dropAndRetry('协同连接没了响应')
      }
    }, PING_EVERY_MS)
  }

  private clearPing() {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  // ── 断线重连 ──

  /** 认定当前连接已废：摘掉它，然后排一次重连 */
  private dropAndRetry(reason: string) {
    const ws = this.ws
    this.ws = null
    if (ws) {
      // 先解绑再关：否则我们自己关出来的 onclose 会被当成又一次"意外断开"
      ws.onclose = null
      ws.onmessage = null
      try {
        ws.close()
      } catch {
        /* 已经关了 */
      }
    }
    this.clearPing()
    this.set({ peers: [] })
    if (this.disposed || this.closing) return
    this.scheduleRetry(reason)
  }

  private scheduleRetry(reason: string) {
    if (this.retryTimer !== null) return // 已经在排了
    if (this.retryAttempt >= RETRY_GIVE_UP) {
      this.set({ state: 'error', error: `${reason}：重试 ${RETRY_GIVE_UP} 次仍未连上` })
      return
    }
    // 退避：500ms、1s、2s…8s 封顶。不封顶的话，中继长时间不在（比如用户刚手动停了）
    // 会攒出一个小时后才触发的重连，而用户早就自己去点了"开始"
    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** this.retryAttempt)
    this.retryAttempt += 1
    this.set({ state: 'retrying' })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.rejoin(reason)
    }, delay)
  }

  /** 重连一次：中继可能也没了，先确保有一个，再重新进房 */
  private async rejoin(reason: string) {
    if (this.disposed || this.closing) return
    try {
      const port = await this.ensureRelay()
      this.set({ port })
      await this.connect(this.room, port)
      // 等这一路的工夫里用户可能已经点了"退出"：那时再往回设 'on' 会让他退不出去
      if (this.closing || this.disposed) return
      // 断线期间的改动与"我多出来的"都要补过去，所以这次带全量状态
      this.greet(true)
      this.retryAttempt = 0
      this.set({ state: 'on', error: '' })
      this.armPing()
    } catch {
      this.scheduleRetry(reason)
    }
  }

  /** 收一帧：按消息类型分派 */
  private onFrame(data: unknown) {
    const buf =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data instanceof Uint8Array
          ? data
          : null
    if (!buf || buf.length < 1) return
    // 任何一帧都证明对面还活着：心跳的账按"收到帧"算，不只是按 pong 算
    this.lastSeen = Date.now()
    const kind = buf[0]
    // 心跳的两头都不用往下走：pong 只是回声，ping 是给服务端的（并且不会被转发过来）
    if (kind === MSG_PONG || kind === MSG_PING) return
    const payload = buf.subarray(1)
    if (kind === MSG_SYNC) {
      // 载荷就是 Yjs 同步消息本体：[子类型 varUint][数据]。
      // 这里**不能**再套一层 messageSync 前缀——传输层的 kind 字节已经占了那个位置，
      // 套了两层 readSyncMessage 就会把前缀当成子类型读，整条协议错位
      // 空 step2：对方还没有任何内容时，对我们的 step1 只能回一份"空差异"。
      // Yjs 不接受零长度更新，y-protocols 会抛错并往 console 打一条——这一帧没有
      // 信息量，精确跳过它，别让用户每次开协同都看到一条红色错误
      if (payload.length === 2 && payload[0] === messageYjsSyncStep2 && payload[1] === 0) {
        return
      }
      const dec = decoding.createDecoder(payload)
      const enc = encoding.createEncoder()
      readSyncMessage(dec, enc, this.ydoc, 'remote')
      // enc 非空说明有要回的内容（对方问 step1）；纯 update/step2 那一类回空
      if (encoding.length(enc) > 0) {
        this.sendSync(encoding.toUint8Array(enc))
      }
    } else if (kind === MSG_AWARENESS) {
      applyAwarenessUpdate(this.awareness, payload, 'remote')
      this.set({ peers: this.peers() })
    }
  }

  /** 等一会儿没见到别人，就认定自己是第一个，负责把编辑器内容播种进 Y.Doc */
  armSeed() {
    if (this.seedTimer !== null) clearTimeout(this.seedTimer)
    this.seedTimer = setTimeout(() => this.seedFromEditor(), SEED_WAIT_MS)
  }

  seedFromEditor() {
    if (this.seedTimer !== null) {
      clearTimeout(this.seedTimer)
      this.seedTimer = null
    }
    if (this.status.state !== 'on') return
    // 房里已经有人了：不播，对方的同步协议会把内容推过来
    if (this.peers().length) return
    // 只有一份空文档时不播：播个空没意义，还可能盖掉对方正要推来的东西
    const json = this.editor.getJSON()
    const isEmpty = json.content?.length === 1 && !json.content[0].content
    if (isEmpty) return
    // 借 prosemirrorJSONToYDoc 造一份带内容的 Y.Doc，再把它的状态整体应用进来。
    // 走这条而不是自己往 fragment 里塞节点：节点/标记的画像必须与绑定那边完全一致，
    // 而那个函数用的就是同一套转换，同步不会错
    const seedDoc = prosemirrorJSONToYDoc(this.editor.schema, json)
    Y.applyUpdate(this.ydoc, Y.encodeStateAsUpdate(seedDoc), 'seed')
    seedDoc.destroy()
  }

  /** 发一条同步消息（Yjs 的 update/step1/step2） */
  private sendSync(payload: Uint8Array) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const out = new Uint8Array(payload.length + 1)
    out[0] = MSG_SYNC
    out.set(payload, 1)
    this.ws.send(out)
  }

  private sendAwareness(payload: Uint8Array) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const out = new Uint8Array(payload.length + 1)
    out[0] = MSG_AWARENESS
    out.set(payload, 1)
    this.ws.send(out)
  }

  /** 发一整帧。心跳用它：那一帧只有一个 kind 字节，没有"kind + 载荷"这个结构 */
  private sendRaw(frame: Uint8Array<ArrayBuffer>) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(frame)
  }

  /**
   * 退出协同：摘插件、关连接、收摊（我们起的中继也要停）。
   *
   * 这里的关键是"**主动**关"要能被认出来：浏览器 `close()` 是异步的，onclose 会在
   * 之后才到，那时要是不认得是自己关的，就会把它当成断线而去重连——用户点"退出"
   * 之后协同自己又连上了。
   */
  stop() {
    this.closing = true
    if (this.seedTimer !== null) clearTimeout(this.seedTimer)
    this.seedTimer = null
    this.clearPing()
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.unbindLocal()
    for (const key of [ySyncPluginKey, yUndoPluginKey]) {
      try {
        this.editor.unregisterPlugin(key)
      } catch {
        // 编辑器已经销毁：没有可摘的
      }
    }
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onclose = null
      ws.onmessage = null
      try {
        ws.close()
      } catch {
        /* 已经关了 */
      }
    }
    if (this.ownRelay) {
      void invoke('ws_relay_stop').catch(() => {})
      this.ownRelay = false
    }
    this.set({ state: 'off', peers: [], error: '' })
  }

  /** 彻底废弃（组件卸载时）：stop 之后不再回调界面 */
  dispose() {
    this.stop()
    this.disposed = true
    this.awareness.destroy()
    this.undoManager.destroy()
    this.ydoc.destroy()
  }
}
