import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from '../../src/pages/Dashboard'
import RunnerPage from '../../src/pages/RunnerPage'
import { useAgentStore } from '../../src/store/agentStore'
import { useWorkflowStore } from '../../src/store/workflowStore'
import { useWsStore } from '../../src/store/wsStore'
import type { WorkflowRun } from '../../src/types/index'

const apiMocks = vi.hoisted(() => ({
  getActiveRuns: vi.fn(),
  selectAgents: vi.fn(),
  getRun: vi.fn(),
  getTemplates: vi.fn(),
  getRunWorkspaceFiles: vi.fn(),
  getRunWorkspaceFileContent: vi.fn(),
  getRunPreview: vi.fn(),
}))

vi.mock('../../src/hooks/useAgents', () => ({ useAgents: () => undefined }))

vi.mock('../../src/lib/api', () => ({
  api: {
    getActiveRuns: () => apiMocks.getActiveRuns(),
    selectAgents: (...args: unknown[]) => apiMocks.selectAgents(...args),
    getRun: (...args: unknown[]) => apiMocks.getRun(...args),
    getTemplates: () => apiMocks.getTemplates(),
    getRunWorkspaceFiles: (...args: unknown[]) => apiMocks.getRunWorkspaceFiles(...args),
    getRunWorkspaceFileContent: (...args: unknown[]) => apiMocks.getRunWorkspaceFileContent(...args),
    getRunPreview: (...args: unknown[]) => apiMocks.getRunPreview(...args),
  },
}))

vi.mock('../../src/components/TaskForm/index', () => ({
  default: ({ onSubmit, agents }: { onSubmit: (params: unknown) => Promise<void>; agents: Array<{ name: string; type: string }> }) => (
    <button
      type="button"
      onClick={() => onSubmit({
        mode: 'manual',
        prompt: 'parallel task',
        projectName: '',
        codeContext: [],
        attachments: [],
        requireConfirm: false,
        executionMode: 'dag',
        selectedAgents: agents.slice(0, 2),
      })}
    >
      submit parallel workflow
    </button>
  ),
}))

const OFFLINE_HINT = '连接已断开，正在重连，请稍后重试'

function renderRunner(routeState: unknown = {}) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/runner', state: routeState }]}>
      <Routes>
        <Route path="/runner" element={<RunnerPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function makeRun(status: WorkflowRun['status'], nodeStatus: WorkflowRun['nodes'][number]['status'] = 'running'): WorkflowRun {
  return {
    id: 'run-1',
    name: 'test run',
    status,
    nodes: [
      { id: 'node-1', agentName: 'planner', agentType: 'omc', prompt: 'plan', codeContext: [], status: nodeStatus, logs: [] },
    ],
    edges: [],
    requireConfirm: true,
    createdAt: Date.now(),
  }
}

function seedPendingConfirm() {
  const run = makeRun('paused', 'waiting')
  useWorkflowStore.getState().upsertRun(run)
  useWorkflowStore.getState().setPendingConfirm({ runId: run.id, nodeId: 'node-1', summary: '等待用户确认', nextNodeIds: [] })
  return run
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  useWorkflowStore.getState().reset()
  useWsStore.setState({ lastError: null })
  useAgentStore.getState().setAgents([
    { name: 'planner', type: 'omc', description: '需求规划', status: 'idle' },
    { name: 'designer', type: 'omc', description: '界面设计', status: 'idle' },
  ])
  apiMocks.getActiveRuns.mockReset()
  apiMocks.getActiveRuns.mockResolvedValue([])
  apiMocks.getRun.mockReset()
  apiMocks.getRun.mockRejectedValue(new Error('not used'))
  apiMocks.selectAgents.mockReset()
  apiMocks.getTemplates.mockReset()
  apiMocks.getTemplates.mockResolvedValue([])
  apiMocks.getRunWorkspaceFiles.mockReset()
  apiMocks.getRunWorkspaceFiles.mockResolvedValue({ root: '/ws', path: '', entries: [] })
  apiMocks.getRunPreview.mockReset()
  apiMocks.getRunPreview.mockRejectedValue(new Error('no preview'))
  apiMocks.getRunWorkspaceFileContent.mockReset()
})

describe('RunnerPage keeps state when the WebSocket send fails', () => {
  beforeEach(() => {
    useWsStore.getState().setSend(() => false)
  })

  it('keeps the confirm card and shows the reconnect hint when confirm cannot be sent', () => {
    seedPendingConfirm()
    renderRunner()

    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    expect(useWorkflowStore.getState().pendingConfirm).not.toBeNull()
    expect(screen.getByText('planner 已暂停，确认下一步')).toBeInTheDocument()
    expect(useWsStore.getState().lastError?.message).toBe(OFFLINE_HINT)
  })

  it('keeps the confirm card when terminate cannot be sent', () => {
    seedPendingConfirm()
    renderRunner()

    fireEvent.click(screen.getByRole('button', { name: '终止' }))

    expect(useWorkflowStore.getState().pendingConfirm).not.toBeNull()
    expect(useWsStore.getState().lastError?.message).toBe(OFFLINE_HINT)
  })

  it('clears the confirm card only when the send succeeds', () => {
    seedPendingConfirm()
    useWsStore.getState().setSend(() => true)
    renderRunner()

    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    expect(useWorkflowStore.getState().pendingConfirm).toBeNull()
    expect(useWsStore.getState().lastError).toBeNull()
  })

  it('keeps the auto-fix offer when accept or decline cannot be sent', async () => {
    const run = makeRun('paused')
    useWorkflowStore.getState().upsertRun(run)
    useWorkflowStore.getState().setPendingAutoFix({
      runId: run.id,
      roundId: 'round-1',
      reviewerNodeId: 'reviewer-1',
      reviewerAgentName: 'code-reviewer',
      summary: 'issue',
      affectedPaths: [],
      suggestedAgent: 'planner',
      suggestionSource: 'rule',
      remainingBudget: 3,
    })
    renderRunner()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /立即自动修复/ }))
      await Promise.resolve()
    })
    expect(useWorkflowStore.getState().pendingAutoFix).not.toBeNull()
    expect(useWsStore.getState().lastError?.message).toBe(OFFLINE_HINT)

    useWsStore.setState({ lastError: null })
    fireEvent.click(screen.getByRole('button', { name: /接受问题，结束流程/ }))
    expect(useWorkflowStore.getState().pendingAutoFix).not.toBeNull()
    expect(useWsStore.getState().lastError?.message).toBe(OFFLINE_HINT)
  })

  it('reports the failure when the header cancel button cannot be sent', () => {
    useWorkflowStore.getState().upsertRun(makeRun('running'))
    renderRunner()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(useWsStore.getState().lastError?.message).toBe(OFFLINE_HINT)
  })

  it('shows a retryable error instead of "started" when the AI run cannot be sent', async () => {
    apiMocks.selectAgents.mockResolvedValue({
      nodes: [{ id: 'a', agentName: 'planner', agentType: 'omc', promptTemplate: 'p' }],
      edges: [],
      explanation: '',
    })
    useWorkflowStore.getState().setRunnerSession({
      prompt: '自动任务',
      projectName: '项目',
      agentNames: [],
      templateName: '',
      codeContext: [],
      attachments: [],
      autoRun: { prompt: '自动任务', projectName: 'p', codeContext: [], attachments: [], requireConfirm: true },
      autoRunStatus: 'selecting',
      autoRunError: null,
      autoRunStarted: false,
    })
    renderRunner()

    expect(await screen.findByText(OFFLINE_HINT)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})

describe('RunnerPage history continue', () => {
  const completedRun: WorkflowRun = {
    id: 'completed-run',
    name: '已完成任务',
    prompt: '完成的需求',
    status: 'completed',
    nodes: [{ id: 'n', agentName: 'planner', agentType: 'omc', prompt: '完成', codeContext: [], status: 'completed', logs: [] }],
    edges: [],
    requireConfirm: false,
    createdAt: 1,
    completedAt: 2,
  }

  async function openContinueInput() {
    apiMocks.getRun.mockResolvedValue(completedRun)
    apiMocks.selectAgents.mockResolvedValue({
      nodes: [{ id: 'a', agentName: 'planner', agentType: 'omc', promptTemplate: 'p' }],
      edges: [],
      explanation: '',
    })
    await act(async () => {
      renderRunner({ historyRunId: 'completed-run' })
      await Promise.resolve()
      await Promise.resolve()
    })
    const input = screen.getByPlaceholderText('基于此任务继续提需求...')
    fireEvent.change(input, { target: { value: '再改一下' } })
    return input
  }

  it('keeps the typed message and shows the reconnect hint when continue cannot be sent', async () => {
    useWsStore.getState().setSend(() => false)
    const input = await openContinueInput()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText(OFFLINE_HINT)).toBeInTheDocument()
    expect(input).toHaveValue('再改一下')
  })

  it('shows the server rejection of workflow:continue instead of waiting for the timeout', async () => {
    useWsStore.getState().setSend(() => true)
    await openContinueInput()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => {
      useWsStore.getState().setLastError({ message: '该任务仍在运行', requestType: 'workflow:continue', at: Date.now() })
    })

    expect(await screen.findByText('该任务仍在运行')).toBeInTheDocument()
  })
})

describe('RunnerPage CodeTab file switching', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(res => { resolve = res })
    return { promise, resolve }
  }

  const entry = (name: string) => ({ name, path: name, type: 'file' as const, size: 5, modifiedAt: 1 })
  const content = (path: string, text: string) => ({ path, size: 5, modifiedAt: 1, content: text, isBinary: false, truncated: false })

  it('shows the last clicked file when the earlier request resolves after the later one', async () => {
    useWorkflowStore.getState().upsertRun(makeRun('running'))
    apiMocks.getRunWorkspaceFiles.mockResolvedValue({ root: '/ws', path: '', entries: [entry('a.txt'), entry('b.txt')] })
    const a = deferred<ReturnType<typeof content>>()
    const b = deferred<ReturnType<typeof content>>()
    apiMocks.getRunWorkspaceFileContent.mockImplementation((_runId: string, path: string) => (path === 'a.txt' ? a.promise : b.promise))

    renderRunner()
    fireEvent.click(screen.getByRole('button', { name: '代码' }))
    const fileA = await screen.findByTitle('a.txt')
    fireEvent.click(fileA)
    fireEvent.click(screen.getByTitle('b.txt'))

    await act(async () => { b.resolve(content('b.txt', 'CONTENT-B')) })
    expect(await screen.findByText('CONTENT-B')).toBeInTheDocument()

    // 先点的文件最后才返回：不得覆盖当前选中的文件内容
    await act(async () => { a.resolve(content('a.txt', 'CONTENT-A')) })
    expect(screen.getByText('CONTENT-B')).toBeInTheDocument()
    expect(screen.queryByText('CONTENT-A')).not.toBeInTheDocument()
  })

  it('does not let a stale failure replace the content or loading state of the latest file', async () => {
    useWorkflowStore.getState().upsertRun(makeRun('running'))
    apiMocks.getRunWorkspaceFiles.mockResolvedValue({ root: '/ws', path: '', entries: [entry('a.txt'), entry('b.txt')] })
    let rejectA!: (reason: unknown) => void
    const a = new Promise((_resolve, reject) => { rejectA = reject })
    const b = deferred<ReturnType<typeof content>>()
    apiMocks.getRunWorkspaceFileContent.mockImplementation((_runId: string, path: string) => (path === 'a.txt' ? a : b.promise))

    renderRunner()
    fireEvent.click(screen.getByRole('button', { name: '代码' }))
    fireEvent.click(await screen.findByTitle('a.txt'))
    fireEvent.click(screen.getByTitle('b.txt'))

    await act(async () => { rejectA(new Error('boom')) })

    // b 仍在加载：旧请求失败不能把加载态关掉，也不能写入「无法读取」
    expect(screen.getByText('正在读取文件内容...')).toBeInTheDocument()
    expect(screen.queryByText('无法读取该文件内容')).not.toBeInTheDocument()
  })
})

describe('RunnerPage rejected start', () => {
  function renderFlow() {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/runner" element={<RunnerPage />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('does not navigate to the runner page when the start request cannot be sent', async () => {
    useWsStore.getState().setSend(() => false)
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'submit parallel workflow' }))

    await waitFor(() => expect(useWsStore.getState().lastError?.message).toBe(OFFLINE_HINT))
    expect(screen.getByRole('button', { name: 'submit parallel workflow' })).toBeInTheDocument()
    expect(screen.queryByText('暂无运行中的任务')).not.toBeInTheDocument()
  })

  it('shows the rejection reason with back and retry actions instead of a blank runner page', async () => {
    const send = vi.fn(() => true)
    useWsStore.getState().setSend(send)
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'submit parallel workflow' }))
    expect((await screen.findAllByText('parallel task')).length).toBeGreaterThan(0)

    act(() => {
      useWsStore.getState().setLastError({ message: '同一个任务中不能重复使用 Agent: planner', requestType: 'workflow:run', at: Date.now() })
    })

    expect(await screen.findByText('同一个任务中不能重复使用 Agent: planner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回创建页' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
    expect(screen.queryByText('同一个任务中不能重复使用 Agent: planner')).not.toBeInTheDocument()
  })

  it('ignores an unrelated error that arrives long after the start request', async () => {
    useWsStore.getState().setSend(() => true)
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'submit parallel workflow' }))
    expect((await screen.findAllByText('parallel task')).length).toBeGreaterThan(0)
    const sentAt = useWorkflowStore.getState().startRequest!.at

    // 服务端拒绝是即时回复；一分钟后才到的同类错误属于别的请求，不能冒充本次启动被拒
    act(() => {
      useWsStore.getState().setLastError({ message: '很久之后的其它错误', requestType: 'workflow:run', at: sentAt + 60_000 })
    })

    expect(screen.queryByText('很久之后的其它错误')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '返回创建页' })).not.toBeInTheDocument()
  })

  it('goes back to the create page from the error card', async () => {
    useWsStore.getState().setSend(() => true)
    renderFlow()
    fireEvent.click(screen.getByRole('button', { name: 'submit parallel workflow' }))
    await screen.findAllByText('parallel task')
    act(() => {
      useWsStore.getState().setLastError({ message: '被拒绝', requestType: 'workflow:run', at: Date.now() })
    })

    fireEvent.click(await screen.findByRole('button', { name: '返回创建页' }))

    expect(await screen.findByRole('button', { name: 'submit parallel workflow' })).toBeInTheDocument()
  })

  it('ignores a server error that arrived before the start request was sent', async () => {
    useWsStore.getState().setSend(() => true)
    useWsStore.getState().setLastError({ message: '旧错误', requestType: 'workflow:run', at: Date.now() - 60_000 })
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'submit parallel workflow' }))
    await screen.findAllByText('parallel task')

    expect(screen.queryByText('旧错误')).not.toBeInTheDocument()
  })

  it('does not show the error card once the run has appeared', async () => {
    useWsStore.getState().setSend(() => true)
    renderFlow()
    fireEvent.click(screen.getByRole('button', { name: 'submit parallel workflow' }))
    await screen.findAllByText('parallel task')

    act(() => {
      useWorkflowStore.getState().upsertRun(makeRun('running'))
      useWsStore.getState().setLastError({ message: '无关的错误', requestType: 'workflow:run', at: Date.now() })
    })

    expect(screen.queryByText('无关的错误')).not.toBeInTheDocument()
  })
})

describe('RunnerPage user avatar', () => {
  function expectIconAvatars(container: HTMLElement) {
    expect(screen.queryByText('VE')).not.toBeInTheDocument()
    const avatars = container.querySelectorAll('[data-testid="user-avatar"]')
    expect(avatars.length).toBeGreaterThan(0)
    avatars.forEach(avatar => {
      expect(avatar.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    })
  }

  it('draws an icon instead of hard-coded initials next to the initial prompt', () => {
    const { container } = renderRunner({ prompt: '创建页需求' })

    expect(screen.getByText('创建页需求')).toBeInTheDocument()
    expectIconAvatars(container)
  })

  it('draws the same icon next to per-round prompts', () => {
    const run = makeRun('running')
    run.rounds = [{ id: 'round-1', prompt: '轮次需求', status: 'running', nodes: run.nodes, edges: [], createdAt: 1 }]
    useWorkflowStore.getState().upsertRun(run)
    const { container } = renderRunner()

    expect(screen.getByText('轮次需求')).toBeInTheDocument()
    expectIconAvatars(container)
  })
})
