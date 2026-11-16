/**
 * 实时协同 · 兼容桩（v0.196 整合轮）
 *
 * 远程主线 README 声称 v0.130 有 356 行 Yjs 协同会话（配 src-tauri/src/ws_relay.rs），
 * 中继 Rust 源文件确实提交了，但前端 collab.ts 从未提交。本桩保持 API 兼容：
 * 会话一启动就如实报 error 态并附原因，不假装连上了；面板的开关/收摊照常工作。
 *
 * 日后拿到真源码整文件覆盖即可，DocEditor 无需改动。
 */
import type { Editor } from '@tiptap/core'

export interface CollabPeer {
  id: number
  name: string
  color: string
}

export interface CollabStatus {
  state: 'off' | 'starting' | 'on' | 'retrying' | 'error'
  room: string
  port: number
  peers: CollabPeer[]
  error: string
}

const OFF: CollabStatus = { state: 'off', room: '', port: 0, peers: [], error: '' }

export class CollabSession {
  constructor(_editor: Editor, private emit: (s: CollabStatus) => void) {}

  async start(room: string): Promise<void> {
    this.emit({
      ...OFF,
      state: 'error',
      room,
      error: '实时协同前端源码未入库（远程主线从未提交 collab.ts），本次会话不可用',
    })
  }

  stop(): void {
    this.emit(OFF)
  }

  dispose(): void {
    /* 桩没有连接与中继进程要收摊 */
  }
}
