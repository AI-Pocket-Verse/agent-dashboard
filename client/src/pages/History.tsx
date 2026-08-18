import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { WorkflowRun } from '../types/index'
import { useWorkflowStore } from '../store/workflowStore'
import { useWsStore } from '../store/wsStore'
import { formatDateTime } from '../lib/dateFormat'
import { formatCountdown, getPersistedRateLimitWait } from '../lib/rateLimit'
import { t } from '../lib/i18n'

const STATUS_BADGE: Record<string, string> = {
  completed: 'border border-[rgba(31,154,81,0.14)] bg-[rgba(31,154,81,0.08)] text-[#0f7a3a]',
  failed: 'border border-[rgba(217,48,37,0.14)] bg-[rgba(217,48,37,0.08)] text-[#b42318]',
  running: 'border border-[rgba(0,113,227,0.14)] bg-[rgba(0,113,227,0.08)] text-[#0058b0]',
  paused: 'border border-slate-200 bg-slate-100 text-slate-600',
  pending: 'border border-slate-200 bg-slate-50 text-slate-500',
}

const STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  failed: '失败/取消',
  running: '运行中',
  paused: '暂停',
  pending: '等待中',
}

const RESTORABLE_NODE_STATUSES = new Set(['pending', 'running', 'completed', 'failed', 'waiting'])
const RESTORABLE_RUN_STATUSES = new Set(['pending', 'running', 'paused', 'completed', 'failed'])
const INCOMPLETE_SNAPSHOT_MESSAGE = '运行快照数据不完整或已失效，暂时无法进入运行页'

function getRunNodes(run: WorkflowRun): WorkflowRun['nodes'] {
  return Array.isArray(run.nodes) ? run.nodes.filter(node => node && typeof node === 'object') : []
}

function getCancelInfo(run: WorkflowRun): { step: string; reason: string } | null {
  if (typeof run.name !== 'string' || !run.name.startsWith('[取消]')) return null
  const node = getRunNodes(run).find(n => n.id === 'cancelled')
  if (!node) return null
  const logs = Array.isArray(node.logs) ? node.logs : []
  const step = logs.find(l => l.startsWith('取消于：'))?.replace('取消于：', '') ?? ''
  const reason = logs.find(l => l.startsWith('取消原因：'))?.replace('取消原因：', '') ?? ''
  return { step, reason }
}

function isActiveRun(run: WorkflowRun) {
  return run.status === 'running' || run.status === 'paused'
}

function isLiveActiveRun(run: WorkflowRun, activeRuns: WorkflowRun[]) {
  return activeRuns.some(activeRun => activeRun.id === run.id && isActiveRun(activeRun))
}

function isStaleActiveRun(run: WorkflowRun, activeRuns: WorkflowRun[]) {
  return isActiveRun(run) && !isLiveActiveRun(run, activeRuns)
}

function hasCompleteRunSnapshot(run: WorkflowRun) {
  const nodes = getRunNodes(run)
  if (!run.id || !run.name || !RESTORABLE_RUN_STATUSES.has(run.status)) return false
  if (nodes.length === 0 || !Array.isArray(run.edges)) return false
  if ((run.status === 'completed' || run.status === 'failed') && typeof run.completedAt !== 'number') return false
  if (run.attachments && !Array.isArray(run.attachments)) return false
  if (run.attachments && !run.attachments.every(item => typeof item.name === 'string' && typeof item.mime === 'string')) return false

  const hasValidNodes = nodes.every(node =>
    typeof node.id === 'string'
    && typeof node.agentName === 'string'
    && typeof node.prompt === 'string'
    && RESTORABLE_NODE_STATUSES.has(node.status)
    && Array.isArray(node.logs)
    && node.logs.every(line => typeof line === 'string')
  )
  if (!hasValidNodes) return false

  const nodeIds = new Set(nodes.map(node => node.id).filter(Boolean))
  if (nodeIds.size !== nodes.length) return false

  const hasValidEdges = run.edges.every(edge =>
    typeof edge.from === 'string'
    && typeof edge.to === 'string'
    && nodeIds.has(edge.from)
    && nodeIds.has(edge.to)
  )
  if (!hasValidEdges) return false
  if ((run.status === 'completed' || run.status === 'failed') && nodes.some(node => node.status === 'running' || node.status === 'waiting')) return false

  return run.status !== 'paused' || nodes.some(node => node.status === 'waiting')
}

function getWaitingSummary(node: WorkflowRun['nodes'][number]) {
  return (node.output || node.logs.filter(line => line.trim()).slice(-120).join('\n'))
    .split('\n')
    .filter(line => line.trim())
    .slice(-120)
    .join('\n')
}

function getRunRateLimitWait(run: WorkflowRun, now: number) {
  const waitingNode = getRunNodes(run).find(node => node.status === 'waiting')
  if (!waitingNode) return null

  const text = [waitingNode.output, ...waitingNode.logs]
    .filter((line): line is string => Boolean(line?.trim()))
    .join('\n')
  return getPersistedRateLimitWait(run.id, waitingNode.id, text, waitingNode.finishedAt ?? now)
}

export default function History() {
  const navigate = useNavigate()
  const send = useWsStore(s => s.send)
  const upsertRun = useWorkflowStore(s => s.upsertRun)
  const setPendingConfirm = useWorkflowStore(s => s.setPendingConfirm)
  const setRunnerSession = useWorkflowStore(s => s.setRunnerSession)
  const setRunStatus = useWorkflowStore(s => s.setRunStatus)
  const activeRuns = useWorkflowStore(s => s.activeRuns)
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [snapshotToast, setSnapshotToast] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    Promise.all([
      api.getRuns(),
      api.getActiveRuns().catch(() => [] as WorkflowRun[]),
    ])
      .then(([savedRuns, liveRuns]) => {
        const liveById = new Map(liveRuns.map(run => [run.id, run]))
        setRuns(savedRuns.map(run => liveById.get(run.id) ?? run))
        liveRuns.forEach(upsertRun)
      })
      .catch(console.error)
  }, [upsertRun])

  useEffect(() => {
    if (!snapshotToast) return

    const timer = window.setTimeout(() => setSnapshotToast(null), 2200)
    return () => window.clearTimeout(timer)
  }, [snapshotToast])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const sortedRuns = useMemo(() => runs.slice().reverse(), [runs])
  const stats = useMemo(() => ({
    total: runs.length,
    completed: runs.filter(run => run.status === 'completed').length,
    active: runs.filter(run => isActiveRun(run) && isLiveActiveRun(run, activeRuns)).length,
    failed: runs.filter(run => run.status === 'failed' || isStaleActiveRun(run, activeRuns)).length,
  }), [activeRuns, runs])

  const enterRun = (run: WorkflowRun) => {
    const liveRun = isActiveRun(run) ? activeRuns.find(activeRun => activeRun.id === run.id && isActiveRun(activeRun)) : run
    if (!liveRun || !hasCompleteRunSnapshot(liveRun)) {
      setSnapshotToast(t(INCOMPLETE_SNAPSHOT_MESSAGE))
      return
    }

    const nodes = getRunNodes(liveRun)
    if (!isActiveRun(liveRun)) {
      setPendingConfirm(null)
      setRunnerSession(null)
      navigate(`/runner?historyRunId=${encodeURIComponent(liveRun.id)}`)
      return
    }

    upsertRun(liveRun)
    setRunnerSession({
      runId: liveRun.id,
      prompt: liveRun.prompt ?? nodes[0]?.prompt ?? liveRun.name,
      projectName: liveRun.name,
      agentNames: nodes.map(node => node.agentName),
      templateName: '',
      codeContext: nodes[0]?.codeContext ?? [],
      attachments: liveRun.attachments?.map(({ name, mime }) => ({ name, mime })) ?? [],
    })

    const waitingNode = nodes.find(node => node.status === 'waiting')
    if (isActiveRun(liveRun) && waitingNode) {
      setPendingConfirm({
        runId: liveRun.id,
        nodeId: waitingNode.id,
        summary: getWaitingSummary(waitingNode),
        nextNodeIds: liveRun.edges.filter(edge => edge.from === waitingNode.id).map(edge => edge.to),
      })
    } else {
      setPendingConfirm(null)
    }

    navigate('/runner')
  }

  const terminateRun = (run: WorkflowRun) => {
    send({ type: 'task:cancel', payload: { runId: run.id } })
    setRunStatus(run.id, 'failed')
    setRuns(current => current.map(item => item.id === run.id ? { ...item, status: 'failed', completedAt: Date.now() } : item))
  }

  if (runs.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-[rgb(247,248,253)] px-8 text-center text-sm text-slate-500">
        {t('暂无历史记录')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside className="flex w-[308px] shrink-0 min-h-0 flex-col border-r border-black/[0.06] bg-[rgb(247,248,253)]">
        <div className="px-4 py-3.5 md:px-5">
          <h2 className="text-[1.2rem] font-semibold tracking-[-0.04em] text-black">{t('历史记录')}</h2>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-3.5 pt-4 md:px-5">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-[18px] border border-slate-200/80 bg-transparent px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t('总数')}</div>
              <div className="mt-2 text-[1.45rem] font-semibold text-black">{stats.total}</div>
            </div>
            <div className="rounded-[18px] border border-slate-200/80 bg-transparent px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t('完成')}</div>
              <div className="mt-2 text-[1.45rem] font-semibold text-emerald-600">{stats.completed}</div>
            </div>
            <div className="rounded-[18px] border border-slate-200/80 bg-transparent px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t('运行中')}</div>
              <div className="mt-2 text-[1.45rem] font-semibold text-blue-600">{stats.active}</div>
            </div>
            <div className="rounded-[18px] border border-slate-200/80 bg-transparent px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t('异常')}</div>
              <div className="mt-2 text-[1.45rem] font-semibold text-rose-600">{stats.failed}</div>
            </div>
          </div>

          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-black">{t('最近项目')}</div>
              <div className="rounded-full border border-black/10 bg-transparent px-2.5 py-1 text-[10px] font-semibold text-black">
                {Math.min(sortedRuns.length, 8)} {t('项')}
              </div>
            </div>
            <div className="min-h-0 space-y-2 overflow-y-auto pr-3">
              {sortedRuns.slice(0, 8).map(run => (
                <div key={run.id} className="rounded-[18px] border border-black/10 bg-transparent px-3.5 py-3">
                  <div className="truncate text-[13px] font-medium text-black">{run.name}</div>
                  <div className="mt-1 truncate text-[11px] text-slate-500">{formatDateTime(run.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[rgb(247,248,253)]">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3.5 md:px-5">
          <div>
            <h2 className="text-[1.2rem] font-semibold tracking-[-0.04em] text-black">{t('全部运行记录')}</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">{t('按时间查看协作历史，快速回顾每次运行的节点、状态和取消原因。')}</p>
          </div>
          <div className="rounded-full border border-slate-200 bg-transparent px-3 py-2 text-[12px] font-medium text-slate-500">
            {t('最近更新：')}{formatDateTime(sortedRuns[0].createdAt)}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4 pr-5 md:px-5">
          {sortedRuns.map(run => {
            const cancelInfo = getCancelInfo(run)
            const nodes = getRunNodes(run)
            const isLiveRun = isLiveActiveRun(run, activeRuns)
            const isStaleRun = isStaleActiveRun(run, activeRuns)
            const rateLimitWait = getRunRateLimitWait(run, now)
            const rateLimitRemaining = rateLimitWait ? Math.max(0, rateLimitWait.resetAt - now) : 0
            return (
              <div
                key={run.id}
                data-run-card
                data-testid={`run-card-${run.id}`}
                onClick={() => enterRun(run)}
                className="cursor-pointer rounded-[22px] border border-slate-200/80 bg-transparent px-5 py-5 transition hover:border-slate-300 hover:bg-white/40"
              >
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">{run.name}</div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {isStaleRun ? (
                        <span className={`status-pill shrink-0 ${STATUS_BADGE.failed}`}>
                          {t('异常')}
                        </span>
                      ) : run.status !== 'paused' && (
                        <span className={`status-pill shrink-0 ${STATUS_BADGE[run.status] ?? 'border border-slate-200 bg-slate-50 text-slate-500'}`}>
                          {t(STATUS_LABEL[run.status] ?? run.status)}
                        </span>
                      )}
                      {rateLimitWait && (
                        <span className="status-pill shrink-0 border border-amber-200 bg-amber-50 text-amber-700">
                          {rateLimitRemaining > 0 ? `${t('继续倒计时')} ${formatCountdown(rateLimitRemaining)}` : t('可继续')}
                        </span>
                      )}
                      {isActiveRun(run) && isLiveRun && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            terminateRun(run)
                          }}
                          className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[12px] font-medium text-rose-600 transition hover:border-rose-300"
                        >
                          {t('终止运行')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {nodes.length} {t('个节点')} · {formatDateTime(run.createdAt)}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {nodes.map((node, index) => (
                    <span
                      key={node.id}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-transparent px-3 py-1.5 text-[12px] text-slate-600"
                    >
                      <span className="text-slate-400">#{index + 1}</span>
                      <span className="font-medium text-slate-700">{node.agentName}</span>
                    </span>
                  ))}
                </div>

                {cancelInfo && (
                  <div className="mt-4 rounded-[20px] border border-[rgba(217,48,37,0.12)] bg-[rgba(217,48,37,0.06)] px-4 py-3 text-sm">
                    <div className="font-medium text-[#b42318]">{t('取消于：')}{cancelInfo.step}</div>
                    <div className="mt-1 text-slate-500">{t('原因：')}{cancelInfo.reason}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
      {snapshotToast ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-amber-200 bg-white/95 px-4 py-2 text-sm font-medium text-amber-700 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur"
        >
          {snapshotToast}
        </div>
      ) : null}
    </div>
  )
}
