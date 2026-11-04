import { vi } from 'vitest'

// 假 WebSocket：记录每个实例，close() 与真实浏览器一样会触发 onclose
export class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static reset() { FakeWebSocket.instances = [] }
  // 仍然存活（未被 close）的连接数
  static liveCount() { return FakeWebSocket.instances.filter(ws => !ws.closed).length }

  readyState = 0
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()

  constructor(public url: string, public protocols?: string | string[]) {
    FakeWebSocket.instances.push(this)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    this.onclose?.()
  }

  // 模拟连接建立
  open() {
    this.readyState = 1
    this.onopen?.()
  }

  // 模拟服务端断开（连接已不可用，客户端并未主动 close）
  drop() {
    this.closed = true
    this.readyState = 3
    this.onclose?.()
  }
}
