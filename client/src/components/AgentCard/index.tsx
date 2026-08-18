import type { AgentInfo } from '../../types/index'
import { getAgentDisplayDescription } from '../../lib/agentDescriptions'

const STATUS_COLORS = {
  idle: 'border-slate-200 bg-white text-slate-700',
  running: 'border-[rgba(0,113,227,0.14)] bg-[rgba(0,113,227,0.08)] text-[#0058b0]',
  error: 'border-[rgba(217,48,37,0.14)] bg-[rgba(217,48,37,0.08)] text-[#b42318]',
}

const STATUS_BADGE = {
  idle: 'bg-slate-100 text-slate-500',
  running: 'bg-[rgba(0,113,227,0.1)] text-[#0058b0]',
  error: 'bg-[rgba(217,48,37,0.1)] text-[#b42318]',
}

interface Props {
  agent: AgentInfo
  lastLog?: string
}

export default function AgentCard({ agent, lastLog }: Props) {
  return (
    <div data-type={agent.type} className={`rounded-[22px] border p-4 shadow-sm ${STATUS_COLORS[agent.status]}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tracking-[-0.02em]">{agent.name}</span>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${STATUS_BADGE[agent.status]}`}>
          {agent.status === 'running' && <span aria-hidden="true">● </span>}
          {agent.status.toUpperCase()}
        </span>
      </div>
      <div className="truncate text-xs leading-5 text-slate-500">{getAgentDisplayDescription(agent)}</div>
      {lastLog && <div className="mt-2 truncate font-mono text-xs text-slate-400">{lastLog}</div>}
    </div>
  )
}
