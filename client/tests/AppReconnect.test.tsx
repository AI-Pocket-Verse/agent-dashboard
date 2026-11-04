import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { useWorkflowStore } from '../src/store/workflowStore'
import { useWsStore } from '../src/store/wsStore'
import type { WorkflowRun } from '../src/types/index'
import { FakeWebSocket } from './helpers/fakeWebSocket'

const apiMocks = vi.hoisted(() => ({
  getActiveRuns: vi.fn(),
  getRun: vi.fn(),
}))

vi.mock('../src/lib/api', () => ({
  api: {
    getActiveRuns: () => apiMocks.getActiveRuns(),
    getRun: (id: string) => apiMocks.getRun(id),
  },
}))

vi.mock('../src/pages/Dashboard', () => ({ default: () => <p>Dashboard page</p> }))
vi.mock('../src/pages/RunnerPage', () => ({ default: () => <p>Runner page</p> }))
vi.mock('../src/pages/Canvas', () => ({ default: () => <p>Canvas page</p> }))
vi.mock('../src/pages/History', () => ({ default: () => <p>History page</p> }))

function makeRun(id: string, status: WorkflowRun['status'], nodeStatus: WorkflowRun['nodes'][number]['status'] = 'running'): WorkflowRun {
  return {
    id,
    name: id,
    status,
    nodes: [{ id: 'n1', agentName: 'planner', agentType: 'omc', prompt: 'p', codeContext: [], status: nodeStatus, logs: [] }],
    edges: [],
    requireConfirm: true,
    createdAt: 1,
    ...(status === 'completed' || status === 'failed' ? { completedAt: 2 } : {}),
  }
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

function renderApp() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.reset()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  useWorkflowStore.getState().reset()
  useWsStore.setState({ lastError: null })
  apiMocks.getActiveRuns.mockReset()
  apiMocks.getActiveRuns.mockResolvedValue([])
  apiMocks.getRun.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('App WebSocket lifecycle', () => {
  it('stops reconnecting once App unmounts', async () => {
    const { unmount } = renderApp()
    act(() => FakeWebSocket.instances[0].open())
    await flush()

    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.liveCount()).toBe(0)
  })
})

describe('App reconnect reconciliation', () => {
  it('asks the server for active runs on first connect and on every reconnect', async () => {
    renderApp()
    act(() => FakeWebSocket.instances[0].open())
    await flush()
    expect(apiMocks.getActiveRuns).toHaveBeenCalledTimes(1)

    act(() => FakeWebSocket.instances[0].drop())
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    act(() => FakeWebSocket.instances[1].open())
    await flush()
    expect(apiMocks.getActiveRuns).toHaveBeenCalledTimes(2)
  })

  it('replaces local runs with the server list and pulls the final state of runs that vanished while offline', async () => {
    renderApp()
    act(() => FakeWebSocket.instances[0].open())
    await flush()

    // 断线前本地有两个运行中的任务，其中一个等待确认
    useWorkflowStore.getState().upsertRun(makeRun('run-alive', 'running'))
    useWorkflowStore.getState().upsertRun(makeRun('run-gone', 'paused', 'waiting'))
    expect(useWorkflowStore.getState().pendingConfirm?.runId).toBe('run-gone')

    // 断线期间 run-gone 已经完成，对应的 task:completed 事件丢了
    apiMocks.getActiveRuns.mockResolvedValue([makeRun('run-alive', 'running')])
    apiMocks.getRun.mockResolvedValue(makeRun('run-gone', 'completed', 'completed'))

    act(() => FakeWebSocket.instances[0].drop())
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    act(() => FakeWebSocket.instances[1].open())
    await flush()

    expect(apiMocks.getRun).toHaveBeenCalledWith('run-gone')
    expect(apiMocks.getRun).not.toHaveBeenCalledWith('run-alive')
    const state = useWorkflowStore.getState()
    expect(state.activeRuns.map(run => run.id)).toEqual(['run-alive'])
    expect(state.pendingConfirm).toBeNull()
  })

  it('drops a local run that the server no longer lists even if the final-state lookup fails', async () => {
    renderApp()
    act(() => FakeWebSocket.instances[0].open())
    await flush()
    useWorkflowStore.getState().upsertRun(makeRun('run-gone', 'running'))

    apiMocks.getActiveRuns.mockResolvedValue([])
    apiMocks.getRun.mockRejectedValue(new Error('network down'))

    act(() => FakeWebSocket.instances[0].drop())
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    act(() => FakeWebSocket.instances[1].open())
    await flush()

    // 终态查不到时不抛到界面，本地保持服务端权威列表（该 run 已不在活跃列表）
    expect(screen.getByText('Dashboard page')).toBeInTheDocument()
    expect(useWorkflowStore.getState().activeRuns).toEqual([])
  })

  it('does not surface an error when the active-runs request fails and retries on the next reconnect', async () => {
    renderApp()
    apiMocks.getActiveRuns.mockRejectedValueOnce(new Error('boom'))
    act(() => FakeWebSocket.instances[0].open())
    await flush()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    act(() => FakeWebSocket.instances[0].drop())
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    act(() => FakeWebSocket.instances[1].open())
    await flush()
    expect(apiMocks.getActiveRuns).toHaveBeenCalledTimes(2)
  })
})

describe('App connection notice', () => {
  it('shows the reconnecting hint as a toast when a send failure is reported', async () => {
    renderApp()
    await flush()

    act(() => {
      useWsStore.getState().setLastError({ message: '连接已断开，正在重连，请稍后重试', at: Date.now() })
    })

    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('连接已断开，正在重连，请稍后重试')
  })
})
