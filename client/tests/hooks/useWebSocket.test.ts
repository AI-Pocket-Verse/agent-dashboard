import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from '../../src/hooks/useWebSocket'

// Minimal WebSocket mock
class MockWS {
  static OPEN = 1
  readyState = MockWS.OPEN
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

let mockWs: MockWS
vi.stubGlobal('WebSocket', vi.fn(() => { mockWs = new MockWS(); return mockWs }))

describe('useWebSocket', () => {
  it('calls onMessage when server sends data', async () => {
    const onMessage = vi.fn()
    renderHook(() => useWebSocket('ws://localhost:3002', 'test-secret', onMessage))
    await act(async () => { mockWs.onopen?.() })
    act(() => { mockWs.emit({ type: 'agent:status', payload: { agentName: 'backend-dev', status: 'idle' } }) })
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:status' }))
  })

  it('exposes send function that sends JSON', async () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() => useWebSocket('ws://localhost:3002', 'test-secret', onMessage))
    await act(async () => { mockWs.onopen?.() })
    act(() => {
      result.current.send({ type: 'task:cancel', payload: { runId: 'run-1' } })
    })
    expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('task:cancel'))
  })
})
