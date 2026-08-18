import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import type { WsServerMessage, WsClientMessage } from '@agent-dashboard/shared'
import { safeEqual } from '../auth.js'

export class WsManager {
  private wss: WebSocketServer
  private clients = new Set<WebSocket>()

  constructor(port: number, secret: string, onMessage: (msg: WsClientMessage, ws: WebSocket) => void) {
    this.wss = new WebSocketServer({ port })

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const token = new URL(req.url ?? '/', 'ws://localhost').searchParams.get('secret') ?? ''
      if (secret && !safeEqual(token, secret)) {
        ws.close(4401, 'Unauthorized')
        return
      }

      this.clients.add(ws)

      ws.on('message', (raw) => {
        try {
          const msg: WsClientMessage = JSON.parse(raw.toString())
          onMessage(msg, ws)
        } catch {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid JSON' } }))
        }
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
