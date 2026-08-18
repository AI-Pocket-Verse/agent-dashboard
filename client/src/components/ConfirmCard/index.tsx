import { useEffect, useState } from 'react'
import { formatCountdown, formatResetTime, type RateLimitWait } from '../../lib/rateLimit'
import { t } from '../../lib/i18n'

interface Props {
  runId: string
  nodeId: string
  agentName: string
  summary: string
  nextNodeIds: string[]
  rateLimitWait?: RateLimitWait | null
  onConfirm: (runId: string, nodeId: string, instruction?: string) => void
  onCancel: (runId: string) => void
}

function useCountdownNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [enabled])

  return now
}

export default function ConfirmCard({ runId, nodeId, agentName, summary, nextNodeIds, rateLimitWait, onConfirm, onCancel }: Props) {
  const [instruction, setInstruction] = useState('')
  const trimmedInstruction = instruction.trim()
  const now = useCountdownNow(Boolean(rateLimitWait))
  const remainingMs = rateLimitWait ? Math.max(0, rateLimitWait.resetAt - now) : 0
  const isRateLimited = Boolean(rateLimitWait && remainingMs > 0)
  const countdown = rateLimitWait ? formatCountdown(remainingMs) : ''
  const continueLabel = rateLimitWait && isRateLimited
    ? `${t('确认')} (${countdown})`
    : t('确认')

  return (
    <div className="surface-panel-soft rounded-[26px] p-5">
      <div className="mb-4 text-sm font-semibold text-slate-900">{agentName} {t('已暂停，确认下一步')}</div>
      {nextNodeIds.length > 0 && (
        <p className="mb-4 whitespace-pre-wrap break-words text-sm text-slate-500">
          {t('下一步：')}<span className="font-medium text-slate-800">{nextNodeIds.join(', ')}</span>
        </p>
      )}
      {rateLimitWait && (
        <div className="mb-4 rounded-[18px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-6 text-amber-800">
          <div className="font-semibold">{t('检测到额度限制')}</div>
          <div className="mt-0.5 text-amber-700">
            {t('重置时间')} {formatResetTime(rateLimitWait)} ({rateLimitWait.timeZone})
          </div>
        </div>
      )}
      <textarea
        value={instruction}
        onChange={e => setInstruction(e.target.value)}
        placeholder={t('可选：补充给后续 Agent 的要求...')}
        rows={4}
        className="mb-4 block min-h-24 w-full resize-y rounded-[18px] border border-slate-300/80 bg-white/70 px-3.5 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:bg-white"
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onCancel(runId)} className="btn-danger flex-1 min-w-[120px]">
          {t('终止')}
        </button>
        <button
          onClick={() => onConfirm(runId, nodeId, trimmedInstruction || undefined)}
          disabled={isRateLimited}
          className="btn-primary flex-1 min-w-[120px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {continueLabel}
        </button>
      </div>
    </div>
  )
}
