import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore } from '../../src/store/agentStore'
import type { AgentInfo } from '../../src/types/index'

describe('agentStore', () => {
  beforeEach(() => useAgentStore.getState().reset())

  it('sets agents', () => {
    const agents: AgentInfo[] = [
      { name: 'backend-dev', type: 'custom', description: 'Go', status: 'idle' }
    ]
    useAgentStore.getState().setAgents(agents)
    expect(useAgentStore.getState().agents).toHaveLength(1)
  })

  it('updates agent status', () => {
    const agents: AgentInfo[] = [
      { name: 'backend-dev', type: 'custom', description: 'Go', status: 'idle' }
    ]
    useAgentStore.getState().setAgents(agents)
    useAgentStore.getState().setAgentStatus('backend-dev', 'running')
    expect(useAgentStore.getState().agents[0].status).toBe('running')
  })
})
