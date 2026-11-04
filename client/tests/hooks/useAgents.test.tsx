import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OMC_AGENTS } from '@agent-dashboard/shared'
import { useAgents } from '../../src/hooks/useAgents'
import { api } from '../../src/lib/api'
import { useAgentStore } from '../../src/store/agentStore'
import type { AgentInfo } from '../../src/types/index'

vi.mock('../../src/lib/api', () => ({
  api: {
    getAgents: vi.fn(),
    fsRoots: vi.fn(),
    fsBrowse: vi.fn(),
  },
}))

const custom: AgentInfo = { name: 'my-agent', type: 'custom', description: '', status: 'idle' }

beforeEach(() => {
  vi.clearAllMocks()
  useAgentStore.getState().reset()
})

describe('useAgents', () => {
  it('loads agents from the server and clears any earlier failure', async () => {
    useAgentStore.setState({ loadError: 'HTTP 500' })
    vi.mocked(api.getAgents).mockResolvedValue([custom])

    renderHook(() => useAgents())

    await waitFor(() => expect(useAgentStore.getState().agents).toEqual([custom]))
    expect(useAgentStore.getState().loadError).toBeNull()
  })

  it('keeps the builtin OMC list and records the reason when /api/agents fails, without rescanning via fs', async () => {
    vi.mocked(api.getAgents).mockRejectedValue({ response: { status: 500 } })

    renderHook(() => useAgents())

    await waitFor(() => expect(useAgentStore.getState().loadError).toBe('HTTP 500'))
    expect(useAgentStore.getState().agents).toEqual(OMC_AGENTS)
    expect(api.fsRoots).not.toHaveBeenCalled()
    expect(api.fsBrowse).not.toHaveBeenCalled()
  })

  it('retry via loadAgents recovers after a failure', async () => {
    vi.mocked(api.getAgents).mockRejectedValueOnce(new Error('Network Error'))
    renderHook(() => useAgents())
    await waitFor(() => expect(useAgentStore.getState().loadError).toBe('Network Error'))

    vi.mocked(api.getAgents).mockResolvedValue([custom])
    await useAgentStore.getState().loadAgents()

    expect(useAgentStore.getState().loadError).toBeNull()
    expect(useAgentStore.getState().agents).toEqual([custom])
  })
})
