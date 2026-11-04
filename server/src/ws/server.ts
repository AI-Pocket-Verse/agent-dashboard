import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import type { WsServerMessage, WsClientMessage } from '@agent-dashboard/shared'
import { safeEqual } from '../auth.js'
import { isLocalRequest } from '../localGuard.js'

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  return 'Request failed'
}

export class WsManager {
  private wss: WebSocketServer
  private clients = new Set<WebSocket>()

  constructor(port: number, secret: string, onMessage: (msg: WsClientMessage, ws: WebSocket) => void | Promise<void>) {
    this.wss = new WebSocketServer({ port })

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      if (secret) {
        const token = new URL(req.url ?? '/', 'ws://localhost').searchParams.get('secret') ?? ''
        if (!safeEqual(token, secret)) {
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
    this.wss.close()
  }
}
