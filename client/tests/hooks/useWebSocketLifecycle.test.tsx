import { StrictMode } from 'react'
import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWebSocket } from '../../src/hooks/useWebSocket'
import { FakeWebSocket } from '../helpers/fakeWebSocket'

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.reset()
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const msg = { type: 'task:cancel', payload: { runId: 'run-1' } } as const

describe('useWebSocket authentication', () => {
  it('sends the secret in the subprotocol, never in the URL', () => {
    renderHook(() => useWebSocket('ws://x/ws', 'pässwörd/with+chars', vi.fn()))
    const ws = FakeWebSocket.instances[0]

    expect(ws.url).toBe('ws://x/ws')
    // 与服务端约定：auth.<base64url(UTF-8 密码)>，只用 token 合法字符
    expect(ws.protocols).toEqual(['agent-dashboard', 'auth.cMOkc3N3w7ZyZC93aXRoK2NoYXJz'])
  })

  it('offers only the plain protocol in open mode', () => {
    renderHook(() => useWebSocket('ws://x/ws', '', vi.fn()))

    expect(FakeWebSocket.instances[0].protocols).toEqual(['agent-dashboard'])
  })
})

describe('useWebSocket send result', () => {
  it('returns false while the socket is not open and true once it is', () => {
    const { result } = renderHook(() => useWebSocket('ws://x/ws', 's', vi.fn()))
    const ws = FakeWebSocket.instances[0]

    expect(result.current.send(msg)).toBe(false)
    expect(ws.send).not.toHaveBeenCalled()

    act(() => ws.open())
    expect(result.current.send(msg)).toBe(true)
    expect(ws.send).toHaveBeenCalledTimes(1)
  })

  it('returns false again after the server drops the connection', () => {
    const { result } = renderHook(() => useWebSocket('ws://x/ws', 's', vi.fn()))
    const ws = FakeWebSocket.instances[0]
    act(() => ws.open())
    act(() => ws.drop())

    expect(result.current.send(msg)).toBe(false)
  })
})

describe('useWebSocket lifecycle', () => {
  it('does not reconnect after the component unmounts', () => {
    const { unmount } = renderHook(() => useWebSocket('ws://x/ws', 's', vi.fn()))
    act(() => FakeWebSocket.instances[0].open())

    unmount()
    act(() => { vi.advanceTimersByTime(60_000) })

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.liveCount()).toBe(0)
  })

  it('cancels a reconnect that is already scheduled when the component unmounts', () => {
    const { unmount } = renderHook(() => useWebSocket('ws://x/ws', 's', vi.fn()))
    act(() => FakeWebSocket.instances[0].drop())
    // 服务端断开后已排下重连定时器，此时卸载

    unmount()
    act(() => { vi.advanceTimersByTime(60_000) })

    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('keeps exactly one live connection under StrictMode double effects', () => {
    function Probe() {
      useWebSocket('ws://x/ws', 's', vi.fn())
      return null
    }
    render(<StrictMode><Probe /></StrictMode>)
    // 确认 StrictMode 确实触发了「挂载 - 卸载 - 再挂载」，否则本用例没有意义
    expect(FakeWebSocket.instances).toHaveLength(2)
    act(() => { vi.advanceTimersByTime(60_000) })

    expect(FakeWebSocket.liveCount()).toBe(1)
  })

  it('still reconnects with backoff when the server drops a mounted connection', () => {
    renderHook(() => useWebSocket('ws://x/ws', 's', vi.fn()))
    act(() => FakeWebSocket.instances[0].drop())
    act(() => { vi.advanceTimersByTime(1000) })

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.liveCount()).toBe(1)
  })

  it('calls onOpen for the first connection and every reconnect', () => {
    const onOpen = vi.fn()
    renderHook(() => useWebSocket('ws://x/ws', 's', vi.fn(), onOpen))

    act(() => FakeWebSocket.instances[0].open())
    expect(onOpen).toHaveBeenCalledTimes(1)

    act(() => FakeWebSocket.instances[0].drop())
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => FakeWebSocket.instances[1].open())
    expect(onOpen).toHaveBeenCalledTimes(2)
  })
})
