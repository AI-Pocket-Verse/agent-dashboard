import { useEffect } from 'react'
import { api } from '../lib/api'
import { useAgentStore } from '../store/agentStore'
import { BUILTIN_OMC_AGENTS } from '../lib/builtinTemplates'
import type { AgentInfo } from '../types/index'

async function discoverCustomAgents(): Promise<AgentInfo[]> {
  const { projectRoot, home } = await api.fsRoots()
  const dirs = [
    `${projectRoot}/.claude/agents`,
    `${home}/.claude/agents`,
  ]
  const seen = new Set<string>()
  const agents: AgentInfo[] = []
  for (const dir of dirs) {
    try {
      const { items } = await api.fsBrowse(dir)
      for (const item of items) {
        if (item.type === 'file' && item.name.endsWith('.md')) {
          const name = item.name.replace(/\.md$/, '')
          if (!seen.has(name)) {
            seen.add(name)
            agents.push({ name, type: 'custom', description: '', status: 'idle' })
          }
        }
      }
    } catch {
      // directory may not exist — skip silently
    }
  }
  return agents
}

export function useAgents() {
  const { setAgents } = useAgentStore()

  useEffect(() => {
    api.getAgents()
      .then(setAgents)
      .catch(async () => {
        // Fallback: scan agent directories directly via fsBrowse
        try {
          const customAgents = await discoverCustomAgents()
          setAgents([...customAgents, ...BUILTIN_OMC_AGENTS])
        } catch {
          // store already has BUILTIN_OMC_AGENTS as initial state
        }
      })
  }, [setAgents])
}
