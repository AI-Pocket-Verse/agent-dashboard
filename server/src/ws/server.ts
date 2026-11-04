import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import type { WsServerMessage, WsClientMessage } from '@agent-dashboard/shared'
import { safeEqual } from '../auth.js'
import { isLocalRequest } from '../localGuard.js'

const DEFAULT_HEARTBEAT_MS = 30_000
// 浏览器 WebSocket 不能带自定义头，密码改走 Sec-WebSocket-Protocol：
// 客户端同时请求 'agent-dashboard' 与 'auth.<base64url(secret)>'，服务端只回 'agent-dashboard'，令牌不会被回显
const WS_PROTOCOL = 'agent-dashboard'
const AUTH_PROTOCOL_PREFIX = 'auth.'

function readSecretFromProtocols(req: IncomingMessage): string {
  const offered = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim())
  const token = offered.find(value => value.startsWith(AUTH_PROTOCOL_PREFIX))
  return token ? Buffer.from(token.slice(AUTH_PROTOCOL_PREFIX.length), 'base64url').toString('utf-8') : ''
}
// 这些消息必须带 runId；缺字段时直接拒绝，不让内部异常文案（Cannot read properties…）回给用户
const RUN_SCOPED_TYPES = new Set<string>(['task:cancel', 'task:confirm', 'task:auto_fix_decline'])

function hasValidPayload(msg: { type: string; payload?: unknown }): boolean {
  const { payload } = msg
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  return !RUN_SCOPED_TYPES.has(msg.type) || typeof (payload as { runId?: unknown }).runId === 'string'
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  return 'Request failed'
}

export class WsManager {
  private wss: WebSocketServer
  private clients = new Set<WebSocket>()
  private heartbeat: NodeJS.Timeout

  constructor(port: number, secret: string, onMessage: (msg: WsClientMessage, ws: WebSocket) => void | Promise<void>, options: { heartbeatMs?: number } = {}) {
    this.wss = new WebSocketServer({
      port,
      handleProtocols: protocols => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false),
    })

    // 心跳：定期发协议层 ping，既让反向代理看到流量不因空闲断开，也能清掉不再回 pong 的死连接
    const alive = new WeakMap<WebSocket, boolean>()
    this.heartbeat = setInterval(() => {
      this.clients.forEach(ws => {
        if (alive.get(ws) === false) {
          ws.terminate()
          this.clients.delete(ws)
          return
        }
        alive.set(ws, false)
        ws.ping()
      })
    }, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS)
    this.heartbeat.unref()
    this.wss.on('connection', ws => {
      alive.set(ws, true)
      ws.on('pong', () => alive.set(ws, true))
    })

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      if (secret) {
        if (!safeEqual(readSecretFromProtocols(req), secret)) {
          ws.close(4401, 'Unauthorized')
          return
        }
      } else if (!isLocalRequest(req)) {
        // open local mode: refuse other machines and cross-site pages
        ws.close(4403, 'Forbidden')
        return
      }

      this.clients.add(ws)

      ws.on('message', (raw) => {
        let msg: WsClientMessage
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          this.send(ws, { type: 'error', payload: { message: 'Invalid JSON' } })
          return
        }
        if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
          this.send(ws, { type: 'error', payload: { message: 'Invalid message' } })
          return
        }
        if (!hasValidPayload(msg)) {
          this.send(ws, { type: 'error', payload: { message: 'Invalid payload', requestType: msg.type } })
          return
        }
        // 处理器是 async 的：异常必须在这里接住并回给发送方，否则 unhandled rejection 会让整个进程退出
        Promise.resolve()
          .then(() => onMessage(msg, ws))
          .catch((err: unknown) => {
            console.error('[ws] message handler failed:', err)
            this.send(ws, { type: 'error', payload: { message: getErrorMessage(err), requestType: msg.type } })
          })
      })

      ws.on('close', () => this.clients.delete(ws))
      ws.on('error', () => this.clients.delete(ws))
    })
  }

  broadcast(msg: WsServerMessage): void {
    const data = JSON.stringify(msg)
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })
  }

  send(ws: WebSocket, msg: WsServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  close(): void {
    clearInterval(this.heartbeat)
    this.wss.close()
  }
}
