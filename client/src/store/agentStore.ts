import { create } from 'zustand'
import type { AgentInfo, AgentStatus } from '../types/index'
import { BUILTIN_OMC_AGENTS } from '../lib/builtinTemplates'
import { api } from '../lib/api'
import { errorReason } from '../lib/errorReason'

interface AgentState {
  agents: AgentInfo[]
  // 最近一次 /api/agents 加载失败的原因（可能为空串）；null 表示没有失败。失败时 agents 保留内置 OMC 列表
  loadError: string | null
  setAgents: (agents: AgentInfo[]) => void
  setAgentStatus: (name: string, status: AgentStatus) => void
  // 从服务端拉取 agent 列表；useAgents 首次加载与「重试」按钮共用
  loadAgents: () => Promise<void>
  reset: () => void
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: BUILTIN_OMC_AGENTS,
  loadError: null,
  setAgents: (agents) => set({ agents }),
  setAgentStatus: (name, status) =>
    set(s => ({
      agents: s.agents.map(a => a.name === name ? { ...a, status } : a)
    })),
  loadAgents: async () => {
    try {
      const agents = await api.getAgents()
      set({ agents, loadError: null })
    } catch (error) {
      set({ loadError: errorReason(error) })
    }
  },
  reset: () => set({ agents: BUILTIN_OMC_AGENTS, loadError: null }),
}))
