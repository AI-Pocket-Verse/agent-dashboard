import { create } from 'zustand'
import type { AgentInfo, AgentStatus } from '../types/index'
import { BUILTIN_OMC_AGENTS } from '../lib/builtinTemplates'

interface AgentState {
  agents: AgentInfo[]
  setAgents: (agents: AgentInfo[]) => void
  setAgentStatus: (name: string, status: AgentStatus) => void
  reset: () => void
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: BUILTIN_OMC_AGENTS,
  setAgents: (agents) => set({ agents }),
  setAgentStatus: (name, status) =>
    set(s => ({
      agents: s.agents.map(a => a.name === name ? { ...a, status } : a)
    })),
  reset: () => set({ agents: BUILTIN_OMC_AGENTS }),
}))
