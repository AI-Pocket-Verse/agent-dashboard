import { useEffect } from 'react'
import { useAgentStore } from '../store/agentStore'

// 进入页面时向服务端拉取 agent 列表；失败原因记录在 agentStore.loadError，列表保留内置 OMC 项
export function useAgents() {
  const loadAgents = useAgentStore(s => s.loadAgents)

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])
}
