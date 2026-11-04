import { useEffect, useRef, useCallback } from 'react'
import type { WsServerMessage, WsClientMessage } from '../types/index'

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]
const WS_PROTOCOL = 'agent-dashboard'

// 浏览器 WebSocket 不能带自定义头，密码放进子协议 auth.<base64url(UTF-8)>，不进 URL，
// 因而不会出现在任何反向代理的访问日志里；服务端只回显 'agent-dashboard'
function authProtocols(secret: string): string[] {
  if (!secret) return [WS_PROTOCOL]
  const binary = String.fromCharCode(...new TextEncoder().encode(secret))
  const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return [WS_PROTOCOL, `auth.${token}`]
}

export function useWebSocket(
  url: string,
  secret: string,
  onMessage: (msg: WsServerMessage) => void,
  // 每次连接成功（首次与重连）后调用，用于对账断线期间错过的事件
  onOpen?: () => void
) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    // disposed 与定时器都属于本次 effect：卸载（含 StrictMode 的模拟卸载）后不得再重连
    let disposed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0

    const connect = () => {
      const ws = new WebSocket(url, authProtocols(secret))
      wsRef.current = ws

      ws.onopen = () => {
        if (disposed) return
        reconnectAttempt = 0
        onOpenRef.current?.()
      }

      ws.onmessage = (event) => {
        if (disposed) return
        try {
          const msg: WsServerMessage = JSON.parse(event.data)
          onMessageRef.current(msg)
        } catch { /* ignore malformed */ }
      }

      ws.onclose = () => {
        if (disposed) return
        const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)]
        reconnectAttempt++
        reconnectTimer = setTimeout(connect, delay)
      }

      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [url, secret])

  // 返回是否真正发出：连接未就绪（断线重连中）时为 false，调用方据此保留状态并提示
  const send = useCallback((msg: WsClientMessage): boolean => {
    const ws = wsRef.current
    if (ws?.readyState !== 1 /* WebSocket.OPEN */) return false
    try {
      ws.send(JSON.stringify(msg))
      return true
    } catch {
      return false
    }
  }, [])

  return { send }
}
