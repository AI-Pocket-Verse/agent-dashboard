import { useEffect, useRef, useCallback } from 'react'
import type { WsServerMessage, WsClientMessage } from '../types/index'

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]

export function useWebSocket(
  url: string,
  secret: string,
  onMessage: (msg: WsServerMessage) => void
) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttempt = useRef(0)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    const ws = new WebSocket(`${url}?secret=${encodeURIComponent(secret)}`)
    wsRef.current = ws

    ws.onopen = () => { reconnectAttempt.current = 0 }

    ws.onmessage = (event) => {
      try {
        const msg: WsServerMessage = JSON.parse(event.data)
        onMessageRef.current(msg)
      } catch { /* ignore malformed */ }
    }

    ws.onclose = () => {
      const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt.current, RECONNECT_DELAYS.length - 1)]
      reconnectAttempt.current++
      setTimeout(connect, delay)
    }

    ws.onerror = () => ws.close()
  }, [url, secret])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((msg: WsClientMessage) => {
    if (wsRef.current?.readyState === 1 /* WebSocket.OPEN */) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { send }
}
