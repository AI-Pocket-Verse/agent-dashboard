import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskForm from '../../src/components/TaskForm/index'
import { api } from '../../src/lib/api'
import { useAgentStore } from '../../src/store/agentStore'
import type { AgentInfo } from '../../src/types/index'

vi.mock('../../src/lib/api', () => ({
  api: { getAgents: vi.fn() },
}))

const agents: AgentInfo[] = [{ name: 'planner', type: 'omc', description: '', status: 'idle' }]

beforeEach(() => {
  vi.clearAllMocks()
  useAgentStore.getState().reset()
})

describe('TaskForm agent modal load failure', () => {
  it('shows the failure reason with a retry button, and retry reloads the list', async () => {
    useAgentStore.setState({ loadError: 'HTTP 503' })
    vi.mocked(api.getAgents).mockResolvedValue(agents)
    render(<TaskForm agents={agents} templates={[]} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))

    expect(screen.getByText('Agent 列表加载失败')).toBeInTheDocument()
    expect(screen.getByText('HTTP 503')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(screen.queryByText('Agent 列表加载失败')).not.toBeInTheDocument())
    expect(api.getAgents).toHaveBeenCalledTimes(1)
  })

  it('shows nothing extra when the list loaded fine', () => {
    render(<TaskForm agents={agents} templates={[]} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))

    expect(screen.queryByText('Agent 列表加载失败')).not.toBeInTheDocument()
  })
})
