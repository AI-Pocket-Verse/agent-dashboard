import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import RunnerPage from '../../src/pages/RunnerPage'
import { useWorkflowStore } from '../../src/store/workflowStore'
import { useWsStore } from '../../src/store/wsStore'
import type { WorkflowRun } from '../../src/types/index'

const apiMocks = vi.hoisted(() => ({
  getActiveRuns: vi.fn(),
  selectAgents: vi.fn(),
  getRun: vi.fn(),
  getRunWorkspaceFiles: vi.fn(),
  getRunWorkspaceFileContent: vi.fn(),
  getRunPreview: vi.fn(),
}))

vi.mock('../../src/hooks/useAgents', () => ({
  useAgents: () => undefined,
}))

vi.mock('../../src/lib/api', () => ({
  api: {
    getActiveRuns: () => apiMocks.getActiveRuns(),
    selectAgents: (...args: unknown[]) => apiMocks.selectAgents(...args),
    getRun: (...args: unknown[]) => apiMocks.getRun(...args),
    getRunWorkspaceFiles: (...args: unknown[]) => apiMocks.getRunWorkspaceFiles(...args),
    getRunWorkspaceFileContent: (...args: unknown[]) => apiMocks.getRunWorkspaceFileContent(...args),
    getRunPreview: (...args: unknown[]) => apiMocks.getRunPreview(...args),
  },
}))

function renderRunner(routeState: unknown = {}) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/runner', state: routeState }]}>
      <Routes>
        <Route path="/runner" element={<RunnerPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function makeRun(status: WorkflowRun['status']): WorkflowRun {
  return {
    id: 'run-1',
    name: 'test run',
    status,
    nodes: [
      { id: 'node-1', agentName: 'planner', agentType: 'omc', prompt: 'plan', codeContext: [], status: 'running', logs: [] },
    ],
    edges: [],
    requireConfirm: true,
    createdAt: Date.now(),
  }
}

describe('RunnerPage input behavior', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  beforeEach(() => {
    useWorkflowStore.getState().reset()
    useWsStore.getState().setSend(() => undefined)
    apiMocks.getActiveRuns.mockReset()
    apiMocks.getActiveRuns.mockResolvedValue([])
    apiMocks.getRun.mockReset()
    apiMocks.getRun.mockRejectedValue(new Error('not used'))
    apiMocks.selectAgents.mockReset()
    apiMocks.getRunWorkspaceFiles.mockReset()
    apiMocks.getRunWorkspaceFiles.mockResolvedValue({ root: '/tmp/workspace/runs/run-1/repo', path: '', entries: [] })
    apiMocks.getRunPreview.mockReset()
    apiMocks.getRunPreview.mockRejectedValue(new Error('no preview'))
    apiMocks.getRunWorkspaceFileContent.mockReset()
    apiMocks.getRunWorkspaceFileContent.mockResolvedValue({
      path: 'src/App.tsx',
      size: 24,
      modifiedAt: 1,
      content: 'export const answer = 42\n',
      isBinary: false,
      truncated: false,
    })
  })
  afterEach(() => vi.useRealTimers())

  it('shows the create prompt as chat history without pre-filling the runner input', () => {
    renderRunner({ prompt: '创建页输入的需求' })

    expect(screen.getByText('创建页输入的需求')).toBeInTheDocument()
    // Input is intentionally hidden until the run completes; ensure no leaked textarea is pre-filled
    expect(screen.queryByDisplayValue('创建页输入的需求')).not.toBeInTheDocument()
  })

  it('orders right panel tabs as task, flow, code, preview', () => {
    const { container } = renderRunner({ prompt: '创建页输入的需求' })
    const rightPanel = container.firstElementChild?.lastElementChild as HTMLElement

    const tabLabels = within(rightPanel)
      .getAllByRole('button')
      .slice(0, 4)
      .map(button => button.textContent?.trim())

    expect(tabLabels).toEqual(['任务', '流程', '代码', '预览'])
  })

  it('shows a completed status badge in the left chat instead of raw logs', () => {
    const run = makeRun('running')
    run.nodes[0] = {
      ...run.nodes[0],
      status: 'completed',
      logs: ['第一段需求分析', '第二段系统现状', '第三段方案', '第四段问题'],
    }
    useWorkflowStore.getState().upsertRun(run)

    const { container } = renderRunner()
    const leftPanel = container.firstElementChild?.firstElementChild as HTMLElement

    expect(within(leftPanel).getByText('已完成，详情请查看右侧任务栏')).toBeInTheDocument()
    expect(within(leftPanel).queryByText('第一段需求分析')).not.toBeInTheDocument()
  })

  it('shows waiting status badge in the left chat and log content only in the confirm card summary', () => {
    const run = makeRun('paused')
    run.nodes[0] = {
      ...run.nodes[0],
      status: 'waiting',
      logs: ['需求分析完整内容', '需要用户确认下一步'],
    }
    useWorkflowStore.getState().upsertRun(run)
    useWorkflowStore.getState().setPendingConfirm({
      runId: 'run-1',
      nodeId: 'node-1',
      summary: '需求分析完整内容\n需要用户确认下一步',
      nextNodeIds: [],
    })

    const { container } = renderRunner()
    const leftPanel = container.firstElementChild?.firstElementChild as HTMLElement

    expect(within(leftPanel).getByText('等待确认后继续执行')).toBeInTheDocument()
    expect(within(leftPanel).queryByText('需求分析完整内容')).not.toBeInTheDocument()
    expect(within(leftPanel).getByRole('button', { name: '确认' })).toBeInTheDocument()
  })

  it('shows completed status badge in the left chat without rendering log markdown', () => {
    const run = makeRun('running')
    run.nodes[0] = {
      ...run.nodes[0],
      status: 'completed',
      logs: ['## 执行计划', '- 分析需求', '- 输出方案'],
    }
    useWorkflowStore.getState().upsertRun(run)

    const { container } = renderRunner()
    const leftPanel = container.firstElementChild?.firstElementChild as HTMLElement

    expect(within(leftPanel).getByText('已完成，详情请查看右侧任务栏')).toBeInTheDocument()
    expect(within(leftPanel).queryByRole('heading', { name: '执行计划', level: 2 })).not.toBeInTheDocument()
    expect(within(leftPanel).queryByText('## 执行计划')).not.toBeInTheDocument()
  })

  it('shows elapsed time for running and completed agents', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-28T12:02:05Z'))
    const run = makeRun('running')
    run.nodes = [
      {
        ...run.nodes[0],
        status: 'running',
        startedAt: new Date('2026-04-28T12:00:00Z').getTime(),
        logs: [],
      },
      {
        id: 'node-2',
        agentName: 'developer',
        agentType: 'custom',
        prompt: 'code',
        codeContext: [],
        status: 'completed',
        logs: ['done'],
        startedAt: new Date('2026-04-28T12:00:00Z').getTime(),
        finishedAt: new Date('2026-04-28T12:03:10Z').getTime(),
      },
    ]
    useWorkflowStore.getState().upsertRun(run)

    renderRunner()

    expect(screen.getAllByText((_content, element) => element?.textContent?.includes('已运行 02:05') ?? false).length).toBeGreaterThan(0)
    expect(screen.getAllByText((_content, element) => element?.textContent?.includes('耗时 03:10') ?? false).length).toBeGreaterThan(0)
  })

  it('does not show completed runs on the runner page after returning from another page', async () => {
    useWorkflowStore.getState().upsertRun({
      ...makeRun('completed'),
      name: '已经完成的任务',
      nodes: [
        { ...makeRun('completed').nodes[0], status: 'completed', logs: ['done'] },
      ],
    })

    renderRunner()

    expect(await screen.findByText('暂无运行中的任务')).toBeInTheDocument()
    expect(screen.queryByText('已经完成的任务')).not.toBeInTheDocument()
  })

  it('shows a live run list when multiple tasks are running and opens a selected run', () => {
    useWorkflowStore.getState().upsertRun({
      ...makeRun('running'),
      id: 'run-a',
      name: '运行任务 A',
      nodes: [
        { id: 'node-a', agentName: 'planner', agentType: 'omc', prompt: 'plan A', codeContext: [], status: 'running', logs: [] },
      ],
    })
    useWorkflowStore.getState().upsertRun({
      ...makeRun('paused'),
      id: 'run-b',
      name: '运行任务 B',
      nodes: [
        { id: 'node-b', agentName: 'designer', agentType: 'omc', prompt: 'design B', codeContext: [], status: 'waiting', logs: [] },
      ],
    })

    renderRunner()

    expect(screen.getByText('选择运行中的任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /运行任务 A/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /运行任务 B/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /运行任务 B/ }))

    expect(screen.getByText('运行任务 B')).toBeInTheDocument()
    expect(screen.getAllByText('designer').length).toBeGreaterThan(0)
  })

  it('shows all rounds in the left chat while switching rounds only on the right content panel', () => {
    const run: WorkflowRun = {
      id: 'multi-round-run',
      name: '多轮任务',
      status: 'running',
      activeRoundId: 'round-2',
      nodes: [
        { id: 'round-2-node', agentName: 'developer', agentType: 'omc', prompt: '第二轮需求', codeContext: [], status: 'running', logs: ['第二轮正在执行'] },
      ],
      edges: [],
      rounds: [
        {
          id: 'round-1',
          prompt: '第一轮需求',
          status: 'completed',
          nodes: [
            { id: 'round-1-node', agentName: 'planner', agentType: 'omc', prompt: '第一轮需求', codeContext: [], status: 'completed', logs: ['第一轮完成内容'] },
          ],
          edges: [],
          createdAt: 1,
          completedAt: 2,
        },
        {
          id: 'round-2',
          prompt: '第二轮需求',
          status: 'running',
          nodes: [
            { id: 'round-2-node', agentName: 'developer', agentType: 'omc', prompt: '第二轮需求', codeContext: [], status: 'running', logs: ['第二轮正在执行'] },
          ],
          edges: [],
          createdAt: 3,
        },
      ],
      requireConfirm: false,
      createdAt: 1,
    }
    useWorkflowStore.getState().upsertRun(run)

    const { container } = renderRunner()
    const leftPanel = container.firstElementChild?.firstElementChild as HTMLElement
    const rightPanel = container.firstElementChild?.lastElementChild as HTMLElement

    expect(within(leftPanel).getByText('第一轮需求')).toBeInTheDocument()
    expect(within(leftPanel).queryByText('第一轮完成内容')).not.toBeInTheDocument()
    expect(within(leftPanel).getAllByText('已完成，详情请查看右侧任务栏').length).toBeGreaterThan(0)
    expect(within(leftPanel).getByText('第二轮需求')).toBeInTheDocument()
    expect(within(leftPanel).getByText('第二轮正在执行')).toBeInTheDocument()
    expect(within(leftPanel).getByText('执行中')).toBeInTheDocument()
    expect(within(leftPanel).queryByRole('button', { name: /Round 1/ })).not.toBeInTheDocument()

    fireEvent.click(within(rightPanel).getByRole('button', { name: '任务' }))
    expect(within(rightPanel).getByText('developer')).toBeInTheDocument()
    expect(within(rightPanel).queryByText('planner')).not.toBeInTheDocument()

    fireEvent.click(within(rightPanel).getByRole('button', { name: /Round 1/ }))
    expect(within(rightPanel).getByText('planner')).toBeInTheDocument()
    expect(within(rightPanel).queryByText('developer')).not.toBeInTheDocument()
    expect(within(leftPanel).getByText('执行中')).toBeInTheDocument()
  })

  it('renders generated workspace files in the code tab and opens selected file content', async () => {
    const run = makeRun('running')
    run.nodes[0] = {
      ...run.nodes[0],
      status: 'running',
      logs: ['### 代码变更', '- `src/App.tsx` 已更新'],
    }
    apiMocks.getRunWorkspaceFiles.mockImplementation((_runId: string, path?: string) => {
      if (!path) {
        return Promise.resolve({
          root: '/tmp/workspace/runs/run-1/repo',
          path: '',
          entries: [{ name: 'src', path: 'src', type: 'directory', size: 0, modifiedAt: 0 }],
        })
      }
      return Promise.resolve({
        root: '/tmp/workspace/runs/run-1/repo',
        path,
        entries: [{ name: 'App.tsx', path: 'src/App.tsx', type: 'file', size: 24, modifiedAt: 1 }],
      })
    })
    useWorkflowStore.getState().upsertRun(run)

    const { container } = renderRunner()

    const rightPanel = container.firstElementChild?.lastElementChild as HTMLElement
    fireEvent.click(within(rightPanel).getByRole('button', { name: '代码' }))

    fireEvent.click(await within(rightPanel).findByRole('button', { name: /src/ }))

    fireEvent.click(await within(rightPanel).findByRole('button', { name: /App\.tsx/ }))

    await waitFor(() => expect(rightPanel.textContent).toContain('export const answer = 42'))
    expect(apiMocks.getRunWorkspaceFiles).toHaveBeenCalledWith('run-1', undefined)
    expect(apiMocks.getRunWorkspaceFiles).toHaveBeenCalledWith('run-1', 'src')
    expect(apiMocks.getRunWorkspaceFileContent).toHaveBeenCalledWith('run-1', 'src/App.tsx')
  })

  it('hides the entire input area while a run is executing', () => {
    const run = makeRun('running')
    useWorkflowStore.getState().upsertRun(run)

    renderRunner()

    expect(screen.queryByPlaceholderText('说说你的想法...')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('发送消息')).not.toBeInTheDocument()
  })

  it('hides the input area when entering a paused run from history', () => {
    const run = makeRun('paused')
    useWorkflowStore.getState().upsertRun(run)

    renderRunner()

    expect(screen.queryByPlaceholderText('说说你的想法...')).not.toBeInTheDocument()
  })

  it('hides the input area when entering a non-completed historical run snapshot', async () => {
    const failedRun: WorkflowRun = {
      id: 'failed-run',
      name: '失败任务',
      prompt: '失败的需求',
      status: 'failed',
      nodes: [{ id: 'failed-node', agentName: 'planner', agentType: 'omc', prompt: '失败', codeContext: [], status: 'failed', logs: [] }],
      edges: [],
      requireConfirm: false,
      createdAt: Date.now(),
      completedAt: Date.now(),
    }
    apiMocks.getRun.mockResolvedValue(failedRun)

    await act(async () => {
      renderRunner({ historyRunId: 'failed-run' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByPlaceholderText('基于此任务继续提需求...')).not.toBeInTheDocument()
  })

  it('keeps showing the run snapshot when the active run completes mid-session instead of going blank', async () => {
    const run = makeRun('running')
    useWorkflowStore.getState().upsertRun(run)
    apiMocks.getRun.mockResolvedValue({
      ...run,
      status: 'completed',
      completedAt: Date.now(),
      nodes: [{ ...run.nodes[0], status: 'completed' }],
    })

    renderRunner()

    // Sanity-check: live mode is showing (no blank "暂无运行中的任务")
    expect(screen.queryByText('暂无运行中的任务')).not.toBeInTheDocument()

    // Simulate task:completed → store removes from activeRuns
    await act(async () => {
      useWorkflowStore.getState().completeRun('run-1')
      await Promise.resolve()
      await Promise.resolve()
    })

    // Page must transition into history-snapshot view automatically
    expect(apiMocks.getRun).toHaveBeenCalledWith('run-1')
  })

  it('shows the input area when entering a completed historical run snapshot so users can continue', async () => {
    const completedRun: WorkflowRun = {
      id: 'completed-run',
      name: '已完成任务',
      prompt: '完成的需求',
      status: 'completed',
      nodes: [{ id: 'completed-node', agentName: 'planner', agentType: 'omc', prompt: '完成', codeContext: [], status: 'completed', logs: [] }],
      edges: [],
      requireConfirm: false,
      createdAt: Date.now(),
      completedAt: Date.now(),
    }
    apiMocks.getRun.mockResolvedValue(completedRun)

    await act(async () => {
      renderRunner({ historyRunId: 'completed-run' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByPlaceholderText('基于此任务继续提需求...')).toBeInTheDocument()
  })

  it('does not show code context controls or chips on the runner page', () => {
    renderRunner({
      prompt: '创建页输入的需求',
      codeContext: [{ path: 'workspace/project/src/main.ts', type: 'file', description: '入口文件' }],
    })

    expect(screen.queryByText('workspace/project/src/main.ts')).not.toBeInTheDocument()
  })

  it('uses a wider left chat panel on the runner page', () => {
    const { container } = renderRunner({ prompt: '创建页输入的需求' })

    expect(container.firstElementChild?.firstElementChild).toHaveClass('w-[460px]')
  })

  it('restores the runner session when returning without route state', () => {
    useWorkflowStore.getState().setRunnerSession({
      prompt: '创建后保留的需求',
      projectName: '保留项目',
      agentNames: ['planner'],
      templateName: '',
      codeContext: [],
      attachments: [],
    })

    renderRunner()

    expect(screen.getByText('保留项目')).toBeInTheDocument()
    expect(screen.getByText('创建后保留的需求')).toBeInTheDocument()
  })

  it('keeps showing the auto agent allocation card after returning to the runner tab', () => {
    useWorkflowStore.getState().setRunnerSession({
      prompt: '自动分配中的需求',
      projectName: '自动项目',
      agentNames: [],
      templateName: '',
      codeContext: [],
      attachments: [],
      autoRun: {
        prompt: '自动分配中的需求',
        projectName: 'auto-project',
        codeContext: [],
        attachments: [],
        requireConfirm: true,
      },
      autoRunStatus: 'selecting',
      autoRunStarted: true,
    })

    renderRunner()

    expect(screen.getByText('自动项目')).toBeInTheDocument()
    expect(screen.getByText('自动分配中的需求')).toBeInTheDocument()
    expect(screen.getByText('大模型正在选择合适的 Agent...')).toBeInTheDocument()
  })

  it('does not keep showing the auto allocation card after an auto run has already started', () => {
    useWorkflowStore.getState().setRunnerSession({
      prompt: '已经启动的需求',
      projectName: '自动项目',
      agentNames: [],
      templateName: '',
      codeContext: [],
      attachments: [],
      autoRun: {
        prompt: '已经启动的需求',
        projectName: 'auto-project',
        codeContext: [],
        attachments: [],
        requireConfirm: true,
      },
      autoRunStatus: 'started',
      autoRunStarted: true,
    })

    renderRunner()

    expect(screen.queryByText('大模型正在选择合适的 Agent...')).not.toBeInTheDocument()
    expect(screen.queryByText('正在启动工作流...')).not.toBeInTheDocument()
  })


  it('does not show a previous active run while a new auto run is being allocated', () => {
    apiMocks.selectAgents.mockReturnValue(new Promise(() => undefined))
    useWorkflowStore.getState().upsertRun({
      id: 'old-run',
      name: '旧项目',
      status: 'running',
      nodes: [
        { id: 'old-node', agentName: 'old-agent', agentType: 'omc', prompt: '旧任务', codeContext: [], status: 'running', logs: ['old log'] },
      ],
      edges: [],
      requireConfirm: true,
      createdAt: Date.now() - 1000,
    })

    renderRunner({
      prompt: '新的自动任务',
      projectName: '新项目',
      codeContext: [],
      attachments: [],
      autoRun: {
        prompt: '新的自动任务',
        projectName: 'new-project',
        codeContext: [],
        attachments: [],
        requireConfirm: true,
      },
    })

    expect(screen.getByText('新项目')).toBeInTheDocument()
    expect(screen.getByText('新的自动任务')).toBeInTheDocument()
    expect(screen.getByText('大模型正在选择合适的 Agent...')).toBeInTheDocument()
    expect(screen.queryByText('旧项目')).not.toBeInTheDocument()
    expect(screen.queryByText('old-agent')).not.toBeInTheDocument()
  })

  it('shows a retry countdown interaction when auto agent allocation hits a rate limit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-28T05:09:00.000Z'))
    const rateLimitError = Object.assign(new Error('Request failed with status code 500'), {
      response: {
        status: 500,
        data: { error: "You've hit your limit · resets 1:10am (America/New_York)" },
      },
    })
    apiMocks.selectAgents
      .mockRejectedValueOnce(rateLimitError)
      .mockReturnValueOnce(new Promise(() => undefined))

    renderRunner({
      prompt: '新的自动任务',
      projectName: '新项目',
      codeContext: [],
      attachments: [],
      autoRun: {
        prompt: '新的自动任务',
        projectName: 'new-project',
        codeContext: [],
        attachments: [],
        requireConfirm: true,
      },
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByText('Request failed with status code 500')).not.toBeInTheDocument()
    expect(screen.getByText(/额度限制/)).toBeInTheDocument()
    expect(screen.getByText('重置时间 01:10 (America/New_York)')).toBeInTheDocument()
    expect(screen.queryByText(/剩余/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认 (01:00)' })).toBeDisabled()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(apiMocks.selectAgents).toHaveBeenCalledTimes(2)
  })

  it('shows an error instead of starting an empty auto workflow when AI selects no agents', async () => {
    const send = vi.fn()
    useWsStore.getState().setSend(send)
    apiMocks.selectAgents.mockResolvedValue({
      nodes: [],
      edges: [],
      explanation: 'none',
    })

    renderRunner({
      prompt: '新的自动任务',
      projectName: '新项目',
      codeContext: [],
      attachments: [],
      autoRun: {
        prompt: '新的自动任务',
        projectName: 'new-project',
        codeContext: [],
        attachments: [],
        requireConfirm: true,
      },
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('AI 没有选择任何 Agent，请换一种描述后重试')).toBeInTheDocument()
    expect(screen.queryByText('大模型正在选择合适的 Agent...')).not.toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })

  it('loads an active paused run after refreshing the runner page and restores the confirmation card', async () => {
    apiMocks.getActiveRuns.mockResolvedValue([
      {
        id: 'refresh-paused-run',
        name: '刷新后等待确认项目',
        status: 'paused',
        nodes: [
          {
            id: 'waiting-node',
            agentName: 'planner',
            agentType: 'omc',
            prompt: '刷新前的任务',
            codeContext: [],
            status: 'waiting',
            logs: ['已完成分析，等待确认'],
            output: '已完成分析，等待确认',
          },
        ],
        edges: [],
        requireConfirm: true,
        createdAt: Date.now(),
      },
    ] satisfies WorkflowRun[])

    renderRunner()

    expect(await screen.findByText('刷新后等待确认项目')).toBeInTheDocument()
    expect(await screen.findByText('planner 已暂停，确认下一步')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument()
  })

  it('restores a rate-limit countdown on the confirmation card after refreshing the runner page', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-28T05:09:00.000Z'))
    let resolveActiveRuns: (runs: WorkflowRun[]) => void = () => undefined
    apiMocks.getActiveRuns.mockReturnValue(new Promise<WorkflowRun[]>(resolve => {
      resolveActiveRuns = resolve
    }))

    renderRunner()

    await act(async () => {
      resolveActiveRuns([
        {
          id: 'refresh-rate-limit-run',
          name: '刷新后额度等待项目',
          status: 'paused',
          nodes: [
            {
              id: 'waiting-node',
              agentName: 'planner',
              agentType: 'omc',
              prompt: '刷新前的任务',
              codeContext: [],
              status: 'waiting',
              logs: ["You've hit your limit · resets 1:10am (America/New_York)"],
              output: "You've hit your limit · resets 1:10am (America/New_York)",
            },
          ],
          edges: [],
          requireConfirm: true,
          createdAt: Date.now(),
        },
      ] satisfies WorkflowRun[])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('刷新后额度等待项目')).toBeInTheDocument()
    expect(screen.getByText(/额度限制/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认 (01:00)' })).toBeDisabled()
  })


  it('auto-expands only the running agent card in the task tab and collapses others', () => {
    const run: WorkflowRun = {
      id: 'run-multi',
      name: 'multi flow',
      status: 'running',
      nodes: [
        { id: 'n1', agentName: 'planner', agentType: 'omc', prompt: 'plan', codeContext: [], status: 'completed', logs: ['plan log'], output: 'plan log' },
        { id: 'n2', agentName: 'developer', agentType: 'custom', prompt: 'dev', codeContext: [], status: 'running', logs: ['dev log'] },
        { id: 'n3', agentName: 'reviewer', agentType: 'omc', prompt: 'rev', codeContext: [], status: 'pending', logs: [] },
      ],
      edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
      requireConfirm: false,
      createdAt: Date.now(),
    }
    useWorkflowStore.getState().upsertRun(run)

    const { container } = renderRunner()
    const rightPanel = container.firstElementChild?.lastElementChild as HTMLElement

    // pending node should not appear at all
    expect(within(rightPanel).queryByRole('button', { name: /reviewer/i })).not.toBeInTheDocument()

    const developerHeader = within(rightPanel).getByRole('button', { name: /developer/i })
    const plannerHeader = within(rightPanel).getByRole('button', { name: /planner/i })

    // running developer is expanded -> aria-expanded=true; completed planner collapsed.
    expect(developerHeader).toHaveAttribute('aria-expanded', 'true')
    expect(plannerHeader).toHaveAttribute('aria-expanded', 'false')
  })

  it('lets the user manually expand additional cards without affecting other cards', () => {
    const run: WorkflowRun = {
      id: 'run-manual',
      name: 'manual expansion flow',
      status: 'running',
      nodes: [
        { id: 'n1', agentName: 'planner', agentType: 'omc', prompt: 'plan', codeContext: [], status: 'completed', logs: ['plan log'], output: 'plan log' },
        { id: 'n2', agentName: 'developer', agentType: 'custom', prompt: 'dev', codeContext: [], status: 'running', logs: ['dev log'] },
      ],
      edges: [{ from: 'n1', to: 'n2' }],
      requireConfirm: false,
      createdAt: Date.now(),
    }
    useWorkflowStore.getState().upsertRun(run)

    const { container } = renderRunner()
    const rightPanel = container.firstElementChild?.lastElementChild as HTMLElement

    const plannerHeader = within(rightPanel).getByRole('button', { name: /planner/i })
    const developerHeader = within(rightPanel).getByRole('button', { name: /developer/i })

    expect(plannerHeader).toHaveAttribute('aria-expanded', 'false')
    expect(developerHeader).toHaveAttribute('aria-expanded', 'true')

    // Manually open planner — both should now be expanded
    fireEvent.click(plannerHeader)
    expect(plannerHeader).toHaveAttribute('aria-expanded', 'true')
    expect(developerHeader).toHaveAttribute('aria-expanded', 'true')

    // Manually close the developer (the auto-slot) — planner stays open, developer collapses
    fireEvent.click(developerHeader)
    expect(plannerHeader).toHaveAttribute('aria-expanded', 'true')
    expect(developerHeader).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps refreshing active runs while waiting for user confirmation', async () => {
    vi.useFakeTimers()
    const pausedRun: WorkflowRun = {
      id: 'keepalive-run',
      name: '保活等待确认项目',
      status: 'paused',
      nodes: [{
        id: 'waiting-node',
        agentName: 'planner',
        agentType: 'omc',
        prompt: '等待用户确认',
        codeContext: [],
        status: 'waiting',
        logs: ['等待确认'],
        output: '等待确认',
      }],
      edges: [],
      requireConfirm: true,
      createdAt: Date.now(),
    }
    useWorkflowStore.getState().upsertRun(pausedRun)
    apiMocks.getActiveRuns.mockResolvedValue([pausedRun])

    renderRunner()

    expect(screen.getByText('planner 已暂停，确认下一步')).toBeInTheDocument()
    expect(apiMocks.getActiveRuns).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(30000)
      await Promise.resolve()
    })

    expect(apiMocks.getActiveRuns).toHaveBeenCalledTimes(1)
    expect(screen.getByText('planner 已暂停，确认下一步')).toBeInTheDocument()
  })

  it('shows the rule-suggested fix agent in the auto-fix card and triggers a continue with it on accept', async () => {
    const send = vi.fn()
    useWsStore.getState().setSend(send)
    const run = makeRun('paused')
    useWorkflowStore.getState().upsertRun(run)
    useWorkflowStore.getState().setPendingAutoFix({
      runId: run.id,
      roundId: 'round-1',
      reviewerNodeId: 'reviewer-1',
      reviewerAgentName: 'code-reviewer',
      summary: 'Found 1 critical issue at workspace/project/server/handler.go',
      affectedPaths: ['workspace/project/server/handler.go'],
      suggestedAgent: 'backend-dev',
      suggestionSource: 'rule',
      remainingBudget: 3,
    })

    renderRunner()

    expect(screen.getByText(/Code-reviewer 发现问题/)).toBeInTheDocument()
    expect(screen.getByText('backend-dev')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /立即自动修复/ }))
      await Promise.resolve()
    })

    expect(send).toHaveBeenCalledTimes(1)
    const continueCall = send.mock.calls[0][0]
    expect(continueCall.type).toBe('workflow:continue')
    expect(continueCall.payload.runId).toBe(run.id)
    expect(continueCall.payload.nodes[0].agentName).toBe('backend-dev')
    expect(continueCall.payload.nodes[1].agentName).toBe('code-reviewer')
    expect(continueCall.payload.edges).toEqual([{ from: 'auto-fix', to: 'auto-review' }])
    expect(useWorkflowStore.getState().pendingAutoFix).toBeNull()
  })

  it('sends task:auto_fix_decline when the user declines the auto-fix offer', () => {
    const send = vi.fn()
    useWsStore.getState().setSend(send)
    const run = makeRun('paused')
    useWorkflowStore.getState().upsertRun(run)
    useWorkflowStore.getState().setPendingAutoFix({
      runId: run.id,
      roundId: 'round-1',
      reviewerNodeId: 'reviewer-1',
      reviewerAgentName: 'code-reviewer',
      summary: 'minor issue',
      affectedPaths: [],
      suggestedAgent: null,
      suggestionSource: 'ai-fallback',
      remainingBudget: 3,
    })

    renderRunner()

    fireEvent.click(screen.getByRole('button', { name: /接受问题，结束流程/ }))

    expect(send).toHaveBeenCalledWith({ type: 'task:auto_fix_decline', payload: { runId: run.id } })
    expect(useWorkflowStore.getState().pendingAutoFix).toBeNull()
  })
})
