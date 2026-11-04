import { t } from '../../lib/i18n'
import { useAgentStore } from '../../store/agentStore'

// Agent 列表加载失败提示：显示原因并提供重试；加载正常时不渲染
export default function AgentLoadError({ className = '' }: { className?: string }) {
  const loadError = useAgentStore(s => s.loadError)
  const loadAgents = useAgentStore(s => s.loadAgents)

  if (loadError === null) return null

  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-3 rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 ${className}`}
    >
      <div className="min-w-0">
        <div className="font-semibold">{t('Agent 列表加载失败')}</div>
        <div className="truncate">{loadError || t('未知错误')}</div>
      </div>
      <button
        type="button"
        onClick={() => void loadAgents()}
        className="shrink-0 rounded-full border border-rose-200 bg-white px-3 py-1 font-medium text-rose-600 transition hover:border-rose-300"
      >
        {t('重试')}
      </button>
    </div>
  )
}
