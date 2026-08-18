import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import History from '../../src/pages/History'
import RunnerPage from '../../src/pages/RunnerPage'
import { useAgentStore } from '../../src/store/agentStore'
import { useWorkflowStore } from '../../src/store/workflowStore'
import type { WorkflowRun } from '../../src/types/index'

const send = vi.fn()
const getRuns = vi.fn()
const getRun = vi.fn()
const getActiveRuns = vi.fn()
const selectAgents = vi.fn()
const getRunWorkspaceFiles = vi.fn()
const getRunWorkspaceFileContent = vi.fn()

vi.mock('../../src/lib/api', () => ({
  api: {
    getRuns: () => getRuns(),
    getRun: (id: string) => getRun(id),
    getActiveRuns: () => getActiveRuns(),
    selectAgents: (...args: unknown[]) => selectAgents(...args),
    getRunWorkspaceFiles: (...args: unknown[]) => getRunWorkspaceFiles(...args),
    getRunWorkspaceFileContent: (...args: unknown[]) => getRunWorkspaceFileContent(...args),
  },
}))

vi.mock('../../src/store/wsStore', () => ({
  useWsStore: (selector: (state: { send: typeof send }) => unknown) => selector({ send }),
}))

vi.mock('../../src/hooks/useAgents', () => ({
  useAgents: () => undefined,
}))

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    name: 'Active project',
    status: 'paused',
    nodes: [
      { id: 'node-1', agentName: 'planner', agentType: 'omc', prompt: 'build it', codeContext: [], status: 'completed', logs: ['done'] },
      { id: 'node-2', agentName: 'writer', agentType: 'omc', prompt: 'write it', codeContext: [], status: 'waiting', logs: ['waiting'] },
    ],
    edges: [{ from: 'node-1', to: 'node-2' }],
    requireConfirm: true,
    createdAt: 1700000000000,
    ...overrides,
  }
}

function renderHistory() {
  return render(
    <MemoryRouter initialEntries={['/history']}>
      <Routes>
        <Route path="/history" element={<History />} />
        <Route path="/runner" element={<div>Runner route</div>} />
      </Routes>
    </MemoryRouter>
  )
}

function renderHistoryWithRunner() {
  return render(
    <MemoryRouter initialEntries={['/history']}>
      <Routes>
        <Route path="/history" element={<History />} />
        <Route path="/runner" element={<RunnerPage />} />
        <Route path="/" element={<div>Create route</div>} />
      </Routes>
    </MemoryRouter>
  )
}

function getStatCard(label: string) {
  return screen.getAllByText(label).find(element => element.className.includes('uppercase'))?.parentElement as HTMLElement
}

describe('History active run actions', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  beforeEach(() => {
    send.mockClear()
    getRuns.mockReset()
    getRun.mockReset()
    getActiveRuns.mockReset()
    selectAgents.mockReset()
    getRunWorkspaceFiles.mockReset()
    getRunWorkspaceFiles.mockResolvedValue({ root: '/tmp/workspace/runs/run-1/repo', path: '', entries: [] })
    getRunWorkspaceFileContent.mockReset()
    getRunWorkspaceFileContent.mockResolvedValue({
      path: 'src/App.tsx',
      size: 0,
      modifiedAt: 0,
      content: '',
      isBinary: false,
      truncated: false,
    })
    getActiveRuns.mockResolvedValue([])
    getRun.mockImplementation((id: string) => Promise.reject(new Error(`Unexpected getRun(${id})`)))
    useWorkflowStore.getState().reset()
    useAgentStore.getState().reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('can enter and terminate paused runs from history', async () => {
    const run = makeRun()
    getRuns.mockResolvedValue([run])
    useWorkflowStore.getState().upsertRun(run)

    renderHistory()

    await screen.findAllByText('Active project')
    const card = screen.getByTestId('run-card-run-1')

    expect(within(card).queryByRole('button', { name: '进入运行页' })).not.toBeInTheDocument()
    expect(within(card).queryByText('暂停')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '恢复运行' })).not.toBeInTheDocument()
    const titleRow = within(card).getByText('Active project').parentElement
    expect(titleRow).toHaveClass('items-center')
    expect(titleRow).toContainElement(within(card).getByRole('button', { name: '终止运行' }))

    fireEvent.click(card)

    await waitFor(() => expect(screen.getByText('Runner route')).toBeInTheDocument())
    expect(useWorkflowStore.getState().activeRuns.map(run => run.id)).toContain('run-1')
    expect(useWorkflowStore.getState().runnerSession?.projectName).toBe('Active project')

    renderHistory()
    await screen.findAllByText('Active project')
    const reloadedCard = screen.getByTestId('run-card-run-1')

    fireEvent.click(within(reloadedCard).getByRole('button', { name: '终止运行' }))
    expect(send).toHaveBeenCalledWith({ type: 'task:cancel', payload: { runId: 'run-1' } })
  })

  it('restores the clicked paused run snapshot when another active run already exists', async () => {
    const staleRun = makeRun({
      id: 'stale-run',
      name: 'Stale project',
      nodes: [
        { id: 'stale-node', agentName: 'stale-agent', agentType: 'omc', prompt: 'stale prompt', codeContext: [], status: 'waiting', logs: ['stale summary'], output: 'stale summary' },
      ],
      edges: [],
    })
    const clickedRun = makeRun({
      id: 'clicked-run',
      name: 'Clicked project',
      nodes: [
        { id: 'clicked-node', agentName: 'clicked-agent', agentType: 'omc', prompt: 'clicked prompt', codeContext: [], status: 'waiting', logs: ['clicked summary'], output: 'clicked summary' },
      ],
      edges: [],
    })
    useWorkflowStore.getState().upsertRun(staleRun)
    useWorkflowStore.getState().upsertRun(clickedRun)
    getRuns.mockResolvedValue([clickedRun])

    renderHistoryWithRunner()

    fireEvent.click(await screen.findByTestId('run-card-clicked-run'))

    await screen.findByText('Clicked project')
    expect(screen.getByText('clicked prompt')).toBeInTheDocument()
    expect(screen.getByText('clicked-agent 已暂停，确认下一步')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument()
    expect(screen.queryByText('stale-agent 已暂停，确认下一步')).not.toBeInTheDocument()
  })

  it('shows a toast and stays on history when the run snapshot is incomplete', async () => {
    getRuns.mockResolvedValue([
      makeRun({
        id: 'broken-run',
        name: 'Broken project',
        edges: undefined as unknown as WorkflowRun['edges'],
      }),
    ])

    renderHistoryWithRunner()

    fireEvent.click(await screen.findByTestId('run-card-broken-run'))

    expect(await screen.findByRole('status')).toHaveTextContent('运行快照数据不完整或已失效，暂时无法进入运行页')
    expect(screen.getByText('全部运行记录')).toBeInTheDocument()
    expect(screen.queryByText('说说你的想法...')).not.toBeInTheDocument()
    expect(useWorkflowStore.getState().runnerSession).toBeNull()
  })

  it('blocks stale paused history runs that are no longer active after refresh', async () => {
    getRuns.mockResolvedValue([
      makeRun({
        id: 'stale-paused-run',
        name: 'Stale paused project',
      }),
    ])

    renderHistoryWithRunner()

    fireEvent.click(await screen.findByTestId('run-card-stale-paused-run'))
    const card = screen.getByTestId('run-card-stale-paused-run')
    const runningStat = getStatCard('运行中')
    const abnormalStat = getStatCard('异常')

    expect(within(card).getByText('异常')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '终止运行' })).not.toBeInTheDocument()
    expect(within(runningStat as HTMLElement).getByText('0')).toBeInTheDocument()
    expect(within(abnormalStat as HTMLElement).getByText('1')).toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('运行快照数据不完整或已失效，暂时无法进入运行页')
    expect(screen.getByText('全部运行记录')).toBeInTheDocument()
    expect(screen.queryByText('说说你的想法...')).not.toBeInTheDocument()
    expect(useWorkflowStore.getState().runnerSession).toBeNull()
  })

  it('counts all stale running history records as abnormal instead of running', async () => {
    getRuns.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => makeRun({
        id: `stale-run-${index}`,
        name: `Stale project ${index + 1}`,
        status: index % 2 === 0 ? 'running' : 'paused',
      }))
    )

    renderHistory()

    await screen.findByTestId('run-card-stale-run-0')
    const runningStat = getStatCard('运行中')
    const abnormalStat = getStatCard('异常')

    expect(within(runningStat as HTMLElement).getByText('0')).toBeInTheDocument()
    expect(within(abnormalStat as HTMLElement).getByText('6')).toBeInTheDocument()
    expect(screen.getAllByText('异常')).toHaveLength(7)
  })

  it('uses the server active snapshot after a browser refresh', async () => {
    const savedRun = makeRun({
      id: 'live-after-refresh',
      name: 'Saved stale project',
      nodes: [
        { id: 'node-1', agentName: 'planner', agentType: 'omc', prompt: 'old prompt', codeContext: [], status: 'waiting', logs: ['old summary'], output: 'old summary' },
      ],
      edges: [],
    })
    const liveRun = makeRun({
      id: 'live-after-refresh',
      name: 'Live project',
      nodes: [
        { id: 'node-1', agentName: 'planner', agentType: 'omc', prompt: 'live prompt', codeContext: [], status: 'waiting', logs: ['live summary'], output: 'live summary' },
      ],
      edges: [],
    })
    getRuns.mockResolvedValue([savedRun])
    getActiveRuns.mockResolvedValue([liveRun])

    renderHistoryWithRunner()

    fireEvent.click(await screen.findByTestId('run-card-live-after-refresh'))

    await screen.findByText('Live project')
    expect(screen.getByText('live prompt')).toBeInTheDocument()
    expect(useWorkflowStore.getState().runnerSession?.projectName).toBe('Live project')
  })

  it('continues completed history records by creating a new round under the same run id', async () => {
    const completedRun = makeRun({
      id: 'completed-history-run',
      name: 'Completed history project',
      prompt: '创建页原始需求',
      status: 'completed',
      nodes: [
        {
          id: 'node-1',
          agentName: 'planner',
          agentType: 'omc',
          prompt: 'agent 内部执行 prompt',
          codeContext: [],
          status: 'completed',
          logs: ['## 方案结果', '- 已完成实现'],
        },
      ],
      edges: [],
      completedAt: 1700000005000,
    })
    getRuns.mockResolvedValue([completedRun])
    getRun.mockResolvedValue(completedRun)
    selectAgents.mockResolvedValue({
      nodes: [{ id: 'continue-node', agentName: 'developer', agentType: 'omc', promptTemplate: '继续实现' }],
      edges: [],
      explanation: 'use developer',
    })
    useAgentStore.getState().setAgents([
      { name: 'developer', type: 'omc', description: '开发', status: 'idle' },
    ])

    renderHistoryWithRunner()

    fireEvent.click(await screen.findByTestId('run-card-completed-history-run'))

    expect(await screen.findByText('Completed history project')).toBeInTheDocument()
    expect(screen.getByText('创建页原始需求')).toBeInTheDocument()
    expect(screen.queryByText('agent 内部执行 prompt')).not.toBeInTheDocument()
    expect(screen.getAllByText('已完成，详情请查看右侧任务栏').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '任务' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '流程' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
    expect(useWorkflowStore.getState().activeRuns).toEqual([])

    fireEvent.change(screen.getByPlaceholderText('基于此任务继续提需求...'), { target: { value: '继续优化交互' } })
    fireEvent.click(screen.getByLabelText('发送消息'))

    await waitFor(() => expect(send).toHaveBeenCalledWith({
      type: 'workflow:continue',
      payload: {
        runId: 'completed-history-run',
        name: 'Completed history project',
        globalPrompt: expect.stringContaining('继续优化交互'),
        nodes: [{ id: 'continue-node', agentName: 'developer', agentType: 'omc', promptTemplate: '继续实现' }],
        edges: [],
        requireConfirm: completedRun.requireConfirm,
      },
    }))
  })

  it('shows a rate-limit countdown on active history records', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-28T05:09:00.000Z'))
    const run = makeRun({
      id: 'rate-limit-run',
      name: 'Rate limited project',
      nodes: [
        {
          id: 'node-1',
          agentName: 'planner',
          agentType: 'omc',
          prompt: 'plan',
          codeContext: [],
          status: 'waiting',
          logs: ["You've hit your limit · resets 1:10am (America/New_York)"],
          output: "You've hit your limit · resets 1:10am (America/New_York)",
        },
      ],
      edges: [],
    })
    getRuns.mockResolvedValue([run])
    getActiveRuns.mockResolvedValue([run])

    renderHistory()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const card = screen.getByTestId('run-card-rate-limit-run')
    expect(within(card).getByText('继续倒计时 01:00')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(within(card).getByText('可继续')).toBeInTheDocument()
  })
})
