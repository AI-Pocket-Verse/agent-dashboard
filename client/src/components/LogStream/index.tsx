import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import StreamingText from '../StreamingText/index'
import { compactAdjacentLogBlocks } from '../../lib/logDisplay'
import { api } from '../../lib/api'
import { useWorkflowStore } from '../../store/workflowStore'

interface Props {
  runId?: string
  roundId?: string
  nodeId?: string
  logs: string[]
  logCount?: number
  agentName: string
  status: 'running' | 'completed' | 'failed' | 'pending' | 'waiting'
  isExpanded?: boolean
  fillContainer?: boolean
  onToggle?: () => void
}

const STATUS_COLORS = {
  running: 'border-[rgba(0,113,227,0.14)] bg-[rgba(0,113,227,0.08)] text-[#0058b0]',
  completed: 'border-[rgba(31,154,81,0.14)] bg-[rgba(31,154,81,0.08)] text-[#0f7a3a]',
  failed: 'border-[rgba(217,48,37,0.14)] bg-[rgba(217,48,37,0.08)] text-[#b42318]',
  pending: 'border-slate-200 bg-slate-50 text-slate-500',
  waiting: 'border-slate-200 bg-slate-100 text-slate-600',
}

const FOLLOW_TAIL_THRESHOLD_PX = 24

export default function LogStream({ runId, roundId, nodeId, logs, logCount, agentName, status, isExpanded = true, fillContainer = false, onToggle }: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isFollowingTailRef = useRef(false)
  const scrollKey = useMemo(() => `${runId ?? ''}:${roundId ?? ''}:${nodeId ?? ''}`, [runId, roundId, nodeId])
  const setLogScrollState = useWorkflowStore(s => s.setLogScrollState)

  const [loadedLogs, setLoadedLogs] = useState(logs)
  const [loadedStart, setLoadedStart] = useState(Math.max(0, (logCount ?? logs.length) - logs.length))
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const totalLogs = logCount ?? loadedLogs.length
  const canLoadOlder = Boolean(runId && nodeId && loadedStart > 0)

  useEffect(() => {
    const initialStart = Math.max(0, (logCount ?? logs.length) - logs.length)
    setLoadedLogs(prev => {
      if (prev.length <= logs.length) return logs
      // Preserve manually loaded history; replace only the trailing window
      return [...prev.slice(0, prev.length - logs.length), ...logs]
    })
    // Never advance loadedStart backward — keep whatever we already loaded
    setLoadedStart(prev => Math.min(prev, initialStart))
  }, [logCount, logs])

  const displayLogs = useMemo(
    () => compactAdjacentLogBlocks(
      loadedLogs.length > 2000 ? loadedLogs.slice(-2000) : loadedLogs
    ),
    [loadedLogs]
  )
  const logText = displayLogs.join('\n')
  const displayText = logText || (status === 'running' ? '执行中...' : '')

  useLayoutEffect(() => {
    if (!isExpanded) return
    const el = scrollContainerRef.current
    if (!el) return
    const saved = useWorkflowStore.getState().logScrollStates[scrollKey]
    if (saved) {
      el.scrollTop = saved.scrollTop
      isFollowingTailRef.current = saved.isFollowingTail
    } else {
      el.scrollTop = 0
      isFollowingTailRef.current = false
    }
  }, [scrollKey, isExpanded])

  useEffect(() => {
    if (!isExpanded) return
    if (!isFollowingTailRef.current) return
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [loadedLogs, isExpanded])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom <= FOLLOW_TAIL_THRESHOLD_PX
    isFollowingTailRef.current = atBottom
    setLogScrollState(scrollKey, { scrollTop: el.scrollTop, isFollowingTail: atBottom })
  }, [scrollKey, setLogScrollState])

  const handleStreamingProgress = useCallback(() => {
    if (!isFollowingTailRef.current) return
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  const loadOlderLogs = useCallback(async () => {
    if (!runId || !nodeId || isLoadingOlder || loadedStart <= 0) return
    setIsLoadingOlder(true)
    setLoadError(null)
    try {
      const page = await api.getRunNodeLogs(runId, nodeId, { before: loadedStart, limit: 200, roundId })
      setLoadedLogs(current => [...page.items, ...current])
      setLoadedStart(page.start)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '日志加载失败')
    } finally {
      setIsLoadingOlder(false)
    }
  }, [runId, nodeId, isLoadingOlder, loadedStart, roundId])

  useEffect(() => {
    if (isExpanded && canLoadOlder) loadOlderLogs()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, canLoadOlder])

  const headerInteractive = Boolean(onToggle)
  const HeaderTag = headerInteractive ? 'button' : 'div'

  return (
    <div className={`overflow-hidden rounded-[24px] border border-slate-200/80 bg-transparent shadow-none ${
      isExpanded ? `flex flex-col${fillContainer ? ' flex-1 min-h-0' : ''}` : ''
    }`}>
      <HeaderTag
        type={headerInteractive ? 'button' : undefined}
        onClick={onToggle}
        aria-expanded={headerInteractive ? isExpanded : undefined}
        className={`flex w-full shrink-0 items-center gap-2 border-b px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] transition ${STATUS_COLORS[status]} ${
          headerInteractive ? 'cursor-pointer hover:bg-black/[0.02]' : 'cursor-default'
        }`}
      >
        <span>{agentName}</span>
        {status === 'running' && <span className="animate-pulse">●</span>}
        {status === 'completed' && <span>✓</span>}
        {status === 'failed' && <span>×</span>}
        {totalLogs > loadedLogs.length && (
          <span className="ml-auto normal-case tracking-normal text-slate-400">
            已显示 {loadedLogs.length}/{totalLogs}
          </span>
        )}
        {headerInteractive && (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className={`shrink-0 transition-transform ${totalLogs > loadedLogs.length ? '' : 'ml-auto'} ${isExpanded ? '' : 'rotate-180'} h-3 w-3`}
            aria-hidden
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </HeaderTag>
      {isExpanded && (
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className={`${fillContainer ? 'flex-1 min-h-0' : 'max-h-[70vh]'} overflow-y-auto p-4 pr-5 font-mono text-xs leading-relaxed text-slate-500`}
        >
          {isLoadingOlder && (
            <div className="mb-3 text-[11px] text-slate-400">加载中...</div>
          )}
          {loadError && (
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">
              {loadError}
            </div>
          )}
          <StreamingText
            text={displayText}
            className="block break-words"
            renderMarkdown
            showCursor={status === 'running'}
            onProgress={handleStreamingProgress}
          />
        </div>
      )}
    </div>
  )
}
