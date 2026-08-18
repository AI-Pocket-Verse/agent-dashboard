import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from '../../src/pages/Dashboard'
import { useAgentStore } from '../../src/store/agentStore'
import { useWorkflowStore } from '../../src/store/workflowStore'
import { useWsStore } from '../../src/store/wsStore'
import type { WorkflowRun } from '../../src/types/index'

vi.mock('../../src/hooks/useAgents', () => ({
  useAgents: () => undefined,
}))

vi.mock('../../src/lib/api', () => ({
  api: {
    getTemplates: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../../src/components/TaskForm/index', () => ({
  default: ({ onSubmit, agents }: { onSubmit: (params: unknown) => Promise<void>; agents: Array<{ name: string; type: string }> }) => (
    <button
      type="button"
      onClick={() => onSubmit({
        mode: 'manual',
        prompt: 'new task',
        projectName: '',
        codeContext: [],
        attachments: [],
        requireConfirm: true,
        selectedAgents: [agents[0]],
      })}
    >
      submit task
    </button>
  ),
}))

function makeActiveRun(): WorkflowRun {
  return {
    id: 'run-active',
    name: 'active run',
    status: 'running',
    nodes: [
      { id: 'node-1', agentName: 'planner', agentType: 'omc', prompt: 'plan', codeContext: [], status: 'running', logs: [] },
    ],
    edges: [],
    requireConfirm: true,
    createdAt: Date.now(),
  }
}

describe('Dashboard task creation', () => {
  const send = vi.fn()

  beforeEach(() => {
    send.mockReset()
    useWorkflowStore.getState().reset()
    useAgentStore.getState().setAgents([
      { name: 'planner', type: 'omc', description: '需求规划', status: 'idle' },
    ])
    useWsStore.getState().setSend(send)
  })

  it('allows creating another task while an existing task is active', async () => {
    useWorkflowStore.getState().upsertRun(makeActiveRun())

    render(<Dashboard />, { wrapper: MemoryRouter })
    fireEvent.click(screen.getByRole('button', { name: 'submit task' }))

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith({
        type: 'task:create',
        payload: {
          agentName: 'planner',
          agentType: 'omc',
          prompt: 'new task',
          projectName: undefined,
          codeContext: [],
          attachments: [],
          requireConfirm: true,
        },
      })
    })
    expect(screen.queryByText('已有任务在运行，不能重复提交新任务')).not.toBeInTheDocument()
  })
})
