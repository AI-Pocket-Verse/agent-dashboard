import { useState, useRef, useEffect, useMemo, useCallback, type KeyboardEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Position } from '@xyflow/react'
import { useWorkflowStore, type AutoRunStatus, type RunnerSessionState } from '../store/workflowStore'
import { useWsStore } from '../store/wsStore'
import { useAgents } from '../hooks/useAgents'
import { useAgentStore } from '../store/agentStore'
import LogStream from '../components/LogStream/index'
import FileViewer from '../components/FileViewer/index'
import ConfirmCard from '../components/ConfirmCard/index'
import WorkflowInspector from '../components/WorkflowInspector/index'
import MarkdownText from '../components/MarkdownText/index'
import { t } from '../lib/i18n'
import { sendFailedMessage, sendOrNotify } from '../lib/wsSend'
import {
  WORKFLOW_EDGE_MARKER_COLOR,
  WORKFLOW_EDGE_STROKE,
  WORKFLOW_EDGE_STROKE_ACTIVE,
  WorkflowCanvasView,
  createWorkflowCanvasEdge,
  workflowEdgeMarker,
  workflowNodeStyle,
  type WorkflowCanvasEdge,
  type WorkflowCanvasNode,
} from '../components/WorkflowCanvas/index'
import { api, type RunWorkspaceEntry, type RunWorkspaceFileContent } from '../lib/api'
import { computeVerticalDagLayout } from '../lib/workflowLayout'
import { formatDateTime } from '../lib/dateFormat'
import { formatCountdown, formatResetTime, getPersistedRateLimitWait, type RateLimitWait } from '../lib/rateLimit'
import type { AutoFixOffer, WorkflowRun, WorkflowRound, NodeRun, NodeStatus, CodeContext, TaskAttachment, AiSelectResponse, ExecutionMode } from '../types/index'

interface RouteState {
  runId?: string
  historyRunId?: string
  prompt?: string
  projectName?: string
  agentNames?: string[]
  templateName?: string
  codeContext?: CodeContext[]
  attachments?: Array<{ name: string; mime: string }>
  autoRun?: {
    prompt: string
    projectName: string
    codeContext: CodeContext[]
    attachments: TaskAttachment[]
    requireConfirm: boolean
    executionMode?: ExecutionMode
  }
}

type AutoRunSessionPatch = Partial<Pick<RunnerSessionState, 'autoRunStatus' | 'autoRunError' | 'autoRunStarted'>>
type WakeLockSentinelLike = { released: boolean; release: () => Promise<void> }
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}
type ApiErrorLike = {
  response?: {
    data?: {
      error?: unknown
      message?: unknown
    }
  }
}

type Tab = '代码' | '任务' | '流程' | '预览'
const EMPTY_SET = new Set<string>()

const TABS: Tab[] = ['任务', '流程', '代码', '预览']

const RUN_NODE_STATUS_LABEL: Record<NodeStatus, string> = {
  completed: '已完成',
  running: '执行中',
  waiting: '等待确认',
  failed: '失败',
  pending: '等待中',
}

const RUN_NODE_BADGE_CLASS: Record<NodeStatus, string> = {
  completed: 'border-emerald-200 text-emerald-700',
  running: 'border-blue-200 text-blue-600',
  waiting: 'border-amber-200 text-amber-700',
  failed: 'border-rose-200 text-rose-600',
  pending: 'border-slate-200 text-slate-500',
}

function getRoundStatusLabel(status: WorkflowRun['status']) {
  return status === 'running' ? t('执行中')
    : status === 'paused' ? t('等待确认')
      : status === 'completed' ? t('已完成')
        : status === 'failed' ? t('失败')
          : t('等待中')
}

function formatElapsedDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const two = (value: number) => String(value).padStart(2, '0')

  return hours > 0
    ? `${two(hours)}:${two(minutes)}:${two(seconds)}`
    : `${two(minutes)}:${two(seconds)}`
}

function getNodeElapsedLabel(node: NodeRun, now: number) {
  if (!node.startedAt) return null
  if (node.status === 'running') return `${t('已运行')} ${formatElapsedDuration(now - node.startedAt)}`
  if (node.finishedAt) return `${t('耗时')} ${formatElapsedDuration(node.finishedAt - node.startedAt)}`
  return null
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab === '代码') {
    return (
      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
        <path d="M5 5L2 8l3 3M11 5l3 3-3 3M9 4l-2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (tab === '任务') {
    return (
      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
        <path d="M3 4.5h10M3 8h10M3 11.5h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
  if (tab === '流程') {
    return (
      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
        <circle cx="3" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="13" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="13" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.8 7.4L10.2 4.7M4.8 8.6L10.2 11.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

// ─── Tab content sub-components ──────────────────────────────────────────────

function EmptyState({ hint }: { hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 py-16">
      <div className="text-[64px] opacity-60 select-none">🐱</div>
      <div className="space-y-2 text-center">
        <div className="flex items-center justify-center gap-1.5 text-[13px] text-slate-400">
          <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          {hint ?? t('复杂任务改不好，试试 Agent 模式')}
        </div>
        <div className="flex items-center justify-center gap-1.5 text-[13px] text-slate-400">
          <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
            <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5 7.5h6M5 10h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          {t('可以上传图片复刻')}
        </div>
      </div>
    </div>
  )
}

// 用户消息旁的头像：渐变圆形 + 内联人形图标（自绘 path，不依赖图标库）
function UserAvatar() {
  return (
    <div
      data-testid="user-avatar"
      className="flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-full bg-[radial-gradient(circle_at_30%_30%,#ffcff6_0%,#c5bcff_42%,#8e92ff_100%)] text-white select-none"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-4 w-4">
        <circle cx="8" cy="5.5" r="2.7" />
        <path d="M2.8 14c0-2.9 2.3-5 5.2-5s5.2 2.1 5.2 5c0 .4-.3.7-.7.7H3.5c-.4 0-.7-.3-.7-.7Z" />
      </svg>
    </div>
  )
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function CodeTab({ run, onPreviewFile }: { run: WorkflowRun | null; onPreviewFile?: (path: string) => void }) {
  const runId = run?.id ?? ''
  const [entries, setEntries] = useState<RunWorkspaceEntry[]>([])
  const [root, setRoot] = useState('')
  const [currentPath, setCurrentPath] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedContent, setSelectedContent] = useState<RunWorkspaceFileContent | null>(null)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeFilesMap = useWorkflowStore(s => s.activeFiles)
  const activeFiles = activeFilesMap[runId] ?? EMPTY_SET
  // 读取文件内容的请求序号：只接受最后一次点击的结果与 loading 状态
  const openSeqRef = useRef(0)

  const isEntryActive = (entry: RunWorkspaceEntry): boolean => {
    if (entry.type === 'file') return activeFiles.has(entry.path)
    const prefix = entry.path + '/'
    for (const p of activeFiles) {
      if (p.startsWith(prefix)) return true
    }
    return false
  }

  useEffect(() => {
    setCurrentPath('')
    setSelectedPath(null)
    setSelectedContent(null)
    // 切换任务后，旧任务还在路上的文件请求一律作废
    openSeqRef.current++
    setIsLoadingContent(false)
  }, [runId])

  useEffect(() => {
    if (!runId) return
    let cancelled = false
    setIsLoadingFiles(true)
    setError(null)

    api.getRunWorkspaceFiles(runId, currentPath || undefined)
      .then(res => {
        if (cancelled) return
        setEntries(res.entries)
        setRoot(res.root)
        if (res.entries.length === 0) {
          setError(currentPath ? t('此目录为空') : t('暂无 Agent 生成或修改的代码文件'))
        }
      })
      .catch(() => {
        if (cancelled) return
        setEntries([])
        setError(t('还没有找到这个任务的运行目录'))
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFiles(false)
      })

    return () => { cancelled = true }
  }, [runId, currentPath])

  useEffect(() => {
    if (!runId || activeFiles.size === 0) return
    const timer = setTimeout(() => {
      api.getRunWorkspaceFiles(runId, currentPath || undefined)
        .then(res => {
          setEntries(res.entries)
          setRoot(res.root)
          if (res.entries.length > 0) setError(null)
        })
        .catch(() => {/* silently ignore */})
    }, 600)
    return () => clearTimeout(timer)
  }, [runId, currentPath, activeFiles])

  const openFile = useCallback((file: RunWorkspaceEntry) => {
    if (!runId) return
    const seq = ++openSeqRef.current
    setSelectedPath(file.path)
    setSelectedContent(null)
    setIsLoadingContent(true)
    api.getRunWorkspaceFileContent(runId, file.path)
      .then(content => {
        if (seq === openSeqRef.current) setSelectedContent(content)
      })
      .catch(() => {
        if (seq !== openSeqRef.current) return
        setSelectedContent({
          path: file.path,
          size: file.size,
          modifiedAt: file.modifiedAt,
          content: t('无法读取该文件内容'),
          isBinary: false,
          truncated: false,
        })
      })
      .finally(() => {
        if (seq === openSeqRef.current) setIsLoadingContent(false)
      })
  }, [runId])

  const handleEntryClick = (entry: RunWorkspaceEntry) => {
    if (entry.type === 'directory') {
      setCurrentPath(entry.path)
    } else {
      openFile(entry)
    }
  }

  const breadcrumbs = useMemo(() => {
    const crumbs: Array<{ name: string; path: string }> = [{ name: t('根目录'), path: '' }]
    if (currentPath) {
      const parts = currentPath.split('/').filter(Boolean)
      let acc = ''
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part
        crumbs.push({ name: part, path: acc })
      }
    }
    return crumbs
  }, [currentPath])

  if (!run) return <EmptyState />

  return (
    <div className="grid h-full min-h-[620px] grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-col border-r border-black/[0.06]">
        <div className="border-b border-black/[0.06] px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">{t('代码文件')}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-slate-400" title={root}>
            {root || `workspace/runs/${runId}/repo`}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.path || 'root'} className="flex items-center gap-1">
                {index > 0 && <span className="text-slate-300">/</span>}
                <button
                  onClick={() => setCurrentPath(crumb.path)}
                  disabled={crumb.path === currentPath}
                  className={`rounded px-1 transition ${
                    crumb.path === currentPath
                      ? 'font-semibold text-slate-800'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                  }`}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {isLoadingFiles && (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">{t('加载中...')}</div>
          )}
          {!isLoadingFiles && entries.length === 0 && (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-400">
              {error ?? (currentPath ? t('此目录为空') : t('暂无文件'))}
            </div>
          )}
          {!isLoadingFiles && entries.map(entry => {
            const isDir = entry.type === 'directory'
            const isSelected = !isDir && selectedPath === entry.path
            return (
              <button
                key={entry.path}
                onClick={() => handleEntryClick(entry)}
                title={entry.path}
                className={`flex w-full min-w-0 items-center gap-2 rounded-[12px] px-3 py-2 text-left transition ${
                  isSelected ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white/70 hover:text-slate-950'
                }`}
              >
                <span className={`shrink-0 ${isSelected ? 'text-white/80' : isDir ? 'text-amber-500' : 'text-slate-400'}`}>
                  {isDir ? (
                    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
                      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.59a1.5 1.5 0 0 1 1.06.44l1 1A.5.5 0 0 0 8.5 4.5h4A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
                      <path d="M4 2.5A1.5 1.5 0 0 1 5.5 1h4l3 3v7.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 3.5 11.5v-9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                      <path d="M9.5 1v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block w-full truncate font-mono text-xs font-medium">{entry.name}</span>
                  {!isDir && (
                    <span className={`block text-[10px] ${isSelected ? 'text-white/60' : 'text-slate-400'}`}>
                      {formatFileSize(entry.size)}
                    </span>
                  )}
                </span>
                {isEntryActive(entry) && (
                  <svg className="ml-auto h-3 w-3 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col bg-transparent">
        <div className="flex min-h-[48px] items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-3">
          <div className="min-w-0">
            <div className="overflow-x-auto whitespace-nowrap font-mono text-xs font-semibold text-slate-800 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {selectedPath ?? t('选择左侧文件查看内容')}
            </div>
            {selectedContent && (
              <div className="mt-1 text-[11px] text-slate-400">{formatFileSize(selectedContent.size)}</div>
            )}
          </div>
          {selectedPath && /\.html?$/i.test(selectedPath) && onPreviewFile && (
            <button
              onClick={() => onPreviewFile(selectedPath)}
              className="shrink-0 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-[11px] font-medium text-slate-700 transition hover:border-slate-400 hover:bg-white hover:text-slate-900"
            >
              <span className="mr-1">▶</span>{t('预览')}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {!selectedPath && (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              {t('点击左侧文件查看详细内容')}
            </div>
          )}
          {selectedPath && isLoadingContent && (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">{t('正在读取文件内容...')}</div>
          )}
          {selectedContent && (
            <FileViewer
              runId={runId}
              path={selectedContent.path}
              content={selectedContent.content}
              isBinary={selectedContent.isBinary}
              truncated={selectedContent.truncated}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function TaskTab({ run }: { run: WorkflowRun | null }) {
  const runId = run?.id ?? ''
  const activeNodes = useMemo(
    () => run?.nodes.filter(n => n.status !== 'pending') ?? [],
    [run]
  )

  const [autoSlotId, setAutoSlotId] = useState<string | null>(null)
  const [manualIds, setManualIds] = useState<Set<string>>(() => new Set())
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const hasInitializedRef = useRef(false)
  const userCollapsedAutoRef = useRef<string | null>(null)
  const prevRunningIdRef = useRef<string | null>(null)

  // Reset state on run/round switch so prior expansions don't leak across runs.
  useEffect(() => {
    setAutoSlotId(null)
    setManualIds(new Set())
    hasInitializedRef.current = false
    userCollapsedAutoRef.current = null
    prevRunningIdRef.current = null
  }, [runId, run?.activeRoundId])

  // Pick the most recently entered running node (DAG-aware: prefer the latest in node order).
  const latestRunningId = useMemo(() => {
    for (let i = activeNodes.length - 1; i >= 0; i -= 1) {
      if (activeNodes[i].status === 'running') return activeNodes[i].id
    }
    return null
  }, [activeNodes])

  // Auto-expand the running node and scroll it to the top of the visible area.
  // Intentionally not depending on `autoSlotId` so that the user manually collapsing
  // the auto-slot does not immediately re-trigger expansion while the same node is
  // still running.
  useEffect(() => {
    if (latestRunningId) {
      hasInitializedRef.current = true
      const isNewRunningNode = latestRunningId !== prevRunningIdRef.current
      prevRunningIdRef.current = latestRunningId
      if (isNewRunningNode) {
        setManualIds(new Set())
        userCollapsedAutoRef.current = null
      }
      setAutoSlotId(prev => {
        if (prev === latestRunningId) return prev
        if (userCollapsedAutoRef.current === latestRunningId) return prev
        requestAnimationFrame(() => {
          cardRefs.current.get(latestRunningId)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        })
        return latestRunningId
      })
      return
    }
    // No running node: the very first time we see the run, default-expand the latest
    // non-pending node so the user has something open. Once initialised we stop
    // forcing a fallback so user choices stick.
    if (!hasInitializedRef.current && activeNodes.length > 0) {
      hasInitializedRef.current = true
      setAutoSlotId(activeNodes[activeNodes.length - 1].id)
    }
  }, [latestRunningId, activeNodes])

  const isCardExpanded = (id: string) => id === autoSlotId || manualIds.has(id)

  const handleToggle = (id: string) => {
    if (isCardExpanded(id)) {
      // Track if user is manually collapsing the auto-slot to prevent immediate re-expansion.
      if (autoSlotId === id) userCollapsedAutoRef.current = id
      setManualIds(prev => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setAutoSlotId(prev => (prev === id ? null : prev))
    } else {
      // Clear user-collapsed marker when manually expanding the same node again.
      if (userCollapsedAutoRef.current === id) userCollapsedAutoRef.current = null
      setManualIds(prev => {
        if (prev.has(id)) return prev
        const next = new Set(prev)
        next.add(id)
        return next
      })
    }
  }

  if (!run) return <EmptyState />
  if (activeNodes.length === 0) return <EmptyState hint={t('等待 Agent 开始执行...')} />

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 pr-5">
      {activeNodes.map(node => {
        const expanded = isCardExpanded(node.id)
        return (
          <div
            key={node.id}
            ref={el => {
              if (el) cardRefs.current.set(node.id, el)
              else cardRefs.current.delete(node.id)
            }}
            className={expanded ? 'flex flex-1 min-h-0 flex-col' : 'shrink-0'}
          >
            <LogStream
              runId={run.id}
              roundId={run.activeRoundId}
              nodeId={node.id}
              logs={node.logs}
              logCount={node.logCount}
              agentName={node.agentName}
              status={node.status as NodeStatus}
              isExpanded={expanded}
              fillContainer={expanded}
              onToggle={() => handleToggle(node.id)}
            />
          </div>
        )
      })}
    </div>
  )
}

function FlowTab({ run }: { run: WorkflowRun | null }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const selectedNode = useMemo(
    () => run?.nodes.find(node => node.id === selectedNodeId) ?? null,
    [run, selectedNodeId]
  )

  const flowPositions = useMemo(
    () => run ? computeVerticalDagLayout(run.nodes, run.edges, { rowGap: 152, columnGap: 248 }) : new Map<string, { x: number; y: number }>(),
    [run]
  )

  const flowNodes = useMemo<WorkflowCanvasNode[]>(() => {
    if (!run) return []
    return run.nodes.map((node, index) => ({
      id: node.id,
      type: 'agentNode',
      position: flowPositions.get(node.id) ?? { x: 220, y: 72 + index * 124 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      selected: selectedNodeId === node.id,
      data: {
        agentName: node.agentName,
        agentType: node.agentType,
        displayName: node.displayName,
        description: node.status === 'pending'
          ? t('等待执行该节点')
          : node.status === 'completed'
            ? (node.output?.trim() || t('已完成'))
            : (node.output?.trim() || node.logs.find(line => line.trim()) || (
                node.status === 'running' ? t('执行中...')
                  : node.status === 'failed' ? t('执行失败')
                    : t('等待确认')
              )),
        promptTemplate: node.prompt,
        badgeLabel: t(RUN_NODE_STATUS_LABEL[node.status]),
        badgeClassName: RUN_NODE_BADGE_CLASS[node.status],
        helperText: '',
      },
      style: workflowNodeStyle(node.agentType, selectedNodeId === node.id),
      className: node.status === 'running' ? 'workflow-node-running' : undefined,
    }))
  }, [flowPositions, run, selectedNodeId])

  const flowEdges = useMemo<WorkflowCanvasEdge[]>(() => {
    if (!run) return []
    return run.edges.map((edge, index) => {
      const sourceNode = run.nodes.find(node => node.id === edge.from)
      const isRunning = sourceNode?.status === 'running'
      const isSelected = Boolean(selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId))
      const stroke = isRunning
        ? 'rgba(0,113,227,0.76)'
        : isSelected
          ? WORKFLOW_EDGE_STROKE_ACTIVE
          : WORKFLOW_EDGE_STROKE
      const baseEdge = createWorkflowCanvasEdge(edge.from, edge.to, `e${index}`)

      return {
        ...baseEdge,
        animated: isRunning || isSelected,
        className: isRunning ? 'workflow-edge-running' : undefined,
        style: {
          ...baseEdge.style,
          stroke,
          strokeWidth: isRunning || isSelected ? 2.05 : 1.45,
          filter: isSelected ? 'drop-shadow(0 0 5px rgba(17,17,20,0.14))' : undefined,
        },
        markerEnd: workflowEdgeMarker(isRunning ? 'rgba(0,113,227,0.76)' : isSelected ? WORKFLOW_EDGE_STROKE_ACTIVE : WORKFLOW_EDGE_MARKER_COLOR),
      }
    })
  }, [run, selectedNodeId])

  if (!run) return <EmptyState />

  return (
    <div className="h-[calc(100vh-122px)] min-h-[620px] overflow-hidden rounded-[20px] bg-transparent shadow-none ring-1 ring-black/[0.05]">
      <div className="flex h-full min-h-0">
        <WorkflowCanvasView
          nodes={flowNodes}
          edges={flowEdges}
          selectedNodeId={selectedNode?.id ?? null}
          onSelectNode={node => setSelectedNodeId(node.id)}
          onClearSelection={() => setSelectedNodeId(null)}
        />

        {selectedNode && (
          <WorkflowInspector
            title={selectedNode.displayName || selectedNode.agentName}
            subtitle={`${selectedNode.agentType === 'custom' ? t('自定义 Agent') : t('OMC 内置 Agent')} · ${selectedNode.id}`}
            statusLabel={
              selectedNode.status === 'running' ? t('执行中') :
              selectedNode.status === 'completed' ? t('已完成') :
              selectedNode.status === 'failed' ? t('失败') :
              selectedNode.status === 'waiting' ? t('等待确认') : t('等待中')
            }
            statusTone={selectedNode.status}
            fields={[
              { label: 'Agent', value: selectedNode.agentName },
              { label: t('类型'), value: selectedNode.agentType === 'custom' ? t('自定义 Agent') : t('OMC 内置 Agent') },
              { label: t('时间'), value: selectedNode.startedAt ? `${formatDateTime(selectedNode.startedAt)}${selectedNode.finishedAt ? ` → ${formatDateTime(selectedNode.finishedAt)}` : ''}` : t('尚未开始执行') },
              { label: 'Prompt', value: selectedNode.prompt },
            ]}
            emptyHint={t('点击流程中的节点查看运行状态和 Prompt')}
          />
        )}
      </div>
    </div>
  )
}

function PreviewEmptyHint() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 py-16 text-center">
      <div className="text-[64px] opacity-60 select-none">🐱</div>
      <div className="space-y-2">
        <div className="text-[13px] font-semibold tracking-[-0.01em] text-slate-700">
          {t('暂无可预览的内容')}
        </div>
        <div className="space-y-1 text-[12px] leading-6 text-slate-400">
          <div>{t('· 等待 Agent 生成交付物（如 index.html、原型 HTML）')}</div>
          <div>{t('· 或在「代码」Tab 中打开任意 .html 文件，点击右上角「预览」')}</div>
        </div>
      </div>
    </div>
  )
}

function PreviewTab({
  run,
  overridePath,
  onClearOverride,
}: {
  run: WorkflowRun | null
  overridePath: string | null
  onClearOverride: () => void
}) {
  const runId = run?.id ?? ''
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isManuallyClosed, setIsManuallyClosed] = useState(false)

  // When we move to a different run or get a new override, reset the manual-close flag
  // so the next fetch can run.
  useEffect(() => {
    setIsManuallyClosed(false)
  }, [runId, overridePath])

  // Auto-detect / load the preview file. Intentionally NOT keyed on round/status so the
  // preview is stable across round switches and only re-fetches when the run or the
  // explicitly-chosen file changes.
  useEffect(() => {
    if (!runId || isManuallyClosed) {
      setPreviewPath(null)
      setPreviewContent(null)
      setError(null)
      return
    }
    let cancelled = false
    setIsLoading(true)
    setError(null)

    const fetchPromise = overridePath
      ? api.getRunWorkspaceFileContent(runId, overridePath).then(res => ({ path: overridePath, content: res.content }))
      : api.getRunPreview(runId)

    fetchPromise
      .then(res => {
        if (cancelled) return
        setPreviewPath(res.path)
        setPreviewContent(res.content)
      })
      .catch(() => {
        if (cancelled) return
        setPreviewPath(null)
        setPreviewContent(null)
        setError(overridePath ? t('无法读取该 HTML 文件') : null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [runId, overridePath, isManuallyClosed])

  const handleClose = () => {
    setIsManuallyClosed(true)
    setPreviewPath(null)
    setPreviewContent(null)
    setError(null)
    if (overridePath) onClearOverride()
  }

  if (!run) return <PreviewEmptyHint />
  if (isLoading) return <EmptyState hint={t('正在查找可预览的交付文件...')} />
  if (!previewContent) {
    if (error) return <EmptyState hint={error} />
    return <PreviewEmptyHint />
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[20px] ring-1 ring-black/[0.05]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] bg-white/35 px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            {overridePath ? t('代码预览') : t('交付预览')}
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-slate-700" title={previewPath ?? ''}>
            {previewPath}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {overridePath && (
            <button
              onClick={onClearOverride}
              className="rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-[11px] font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
            >
              {t('返回交付预览')}
            </button>
          )}
          <button
            onClick={handleClose}
            aria-label={t('关闭预览')}
            title={t('关闭预览')}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white/70 text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
          >
            <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <iframe
        srcDoc={previewContent}
        sandbox="allow-scripts allow-forms allow-popups"
        className="w-full flex-1 border-0 bg-white"
        title={t('预览')}
      />
    </div>
  )
}

function RoundTabs({
  rounds,
  selectedRoundId,
  onSelect,
}: {
  rounds: WorkflowRound[]
  selectedRoundId?: string | null
  onSelect: (roundId: string) => void
}) {
  if (rounds.length <= 1) return null

  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-black/[0.06] bg-transparent px-4 py-2">
      {rounds.map((round, index) => (
        <button
          key={round.id}
          onClick={() => onSelect(round.id)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
            selectedRoundId === round.id
              ? 'border-slate-800 bg-slate-900 text-white'
              : 'border-slate-200 bg-transparent text-slate-500 hover:border-slate-300'
          }`}
        >
          Round {index + 1} · {getRoundStatusLabel(round.status)}
        </button>
      ))}
    </div>
  )
}

function getAttachmentBadgeLabel(name: string, mime: string) {
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'PDF'
  if (mime.includes('spreadsheet') || /\.(xlsx|xls|csv)$/i.test(name)) return 'XLS'
  if (mime.includes('word') || /\.(docx|doc)$/i.test(name)) return 'DOC'
  if (mime.includes('presentation') || /\.(pptx|ppt)$/i.test(name)) return 'PPT'
  if (mime.startsWith('image/')) return 'IMG'
  if (mime.startsWith('text/') || /\.(md|txt)$/i.test(name)) return 'TXT'
  if (mime === 'application/json' || name.toLowerCase().endsWith('.json')) return 'JSON'
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return 'ZIP'

  const extension = name.split('.').pop()?.slice(0, 4).toUpperCase()
  return extension || 'FILE'
}

function getNodeRateLimitText(node: WorkflowRun['nodes'][number] | undefined, fallbackSummary?: string) {
  return [fallbackSummary, node?.output, ...(node?.logs ?? [])]
    .filter((line): line is string => Boolean(line?.trim()))
    .join('\n')
}

function getApiErrorMessage(error: unknown, fallback: string) {
  const data = (error as ApiErrorLike | undefined)?.response?.data
  if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim()
  if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim()
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
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

function AutoRunRateLimitCard({
  wait,
  onCancel,
  onContinue,
}: {
  wait: RateLimitWait
  onCancel: () => void
  onContinue: () => void
}) {
  const now = useCountdownNow(true)
  const remainingMs = Math.max(0, wait.resetAt - now)
  const isWaiting = remainingMs > 0
  const countdown = formatCountdown(remainingMs)

  return (
    <div className="max-w-[88%] rounded-2xl rounded-tl-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
      <div className="font-semibold">{t('检测到额度限制')}</div>
      <div className="mt-0.5 text-amber-700">
        {t('重置时间')} {formatResetTime(wait)} ({wait.timeZone})
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-rose-200 bg-white/70 px-3 py-1.5 text-[12px] font-medium text-rose-600 transition hover:border-rose-300"
        >
          {t('终止')}
        </button>
        <button
          type="button"
          disabled={isWaiting}
          onClick={onContinue}
          className="rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300 disabled:opacity-70"
        >
          {isWaiting ? `${t('确认')} (${countdown})` : t('确认')}
        </button>
      </div>
    </div>
  )
}

function hasRouteSessionState(state: RouteState) {
  return Boolean(
    state.runId
    || state.historyRunId
    || state.prompt
    || state.projectName
    || state.agentNames?.length
    || state.templateName
    || state.codeContext?.length
    || state.attachments?.length
  )
}

function normalizeProjectName(value?: string) {
  const words = (value ?? '')
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
  return (words.length > 0 ? words.join('-') : '').slice(0, 50)
}

function isRunForAutoRun(run: WorkflowRun, routeState: RouteState, autoRun: NonNullable<RouteState['autoRun']>) {
  const expectedName = routeState.projectName || autoRun.prompt.slice(0, 60)
  const expectedProjectName = normalizeProjectName(autoRun.projectName || autoRun.prompt || expectedName)

  return run.name === expectedName || Boolean(expectedProjectName && run.projectName === expectedProjectName)
}

function isLiveRun(run: WorkflowRun) {
  return run.status === 'running' || run.status === 'paused'
}

function selectCurrentRun(
  liveRuns: WorkflowRun[],
  routeState: RouteState,
  autoRun: RouteState['autoRun'] | null,
  selectedRunId: string | null
) {
  if (routeState.runId) {
    return liveRuns.find(run => run.id === routeState.runId) ?? null
  }

  if (selectedRunId) {
    return liveRuns.find(run => run.id === selectedRunId) ?? null
  }

  const newestRuns = liveRuns.slice().reverse()
  if (autoRun) {
    return newestRuns.find(run => isRunForAutoRun(run, routeState, autoRun)) ?? null
  }

  return liveRuns.length === 1 ? liveRuns[0] : null
}

function getRunRounds(run: WorkflowRun): WorkflowRound[] {
  if (Array.isArray(run.rounds) && run.rounds.length > 0) return run.rounds
  return [{
    id: run.activeRoundId ?? 'round-1',
    prompt: run.prompt ?? run.nodes[0]?.prompt ?? '',
    status: run.status,
    nodes: run.nodes,
    edges: run.edges,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  }]
}

function getSelectedRound(run: WorkflowRun | null, selectedRoundId: string | null) {
  if (!run) return null
  const rounds = getRunRounds(run)
  return rounds.find(round => round.id === selectedRoundId)
    ?? rounds.find(round => round.id === run.activeRoundId)
    ?? rounds.at(-1)
    ?? null
}

function createDisplayRun(run: WorkflowRun | null, round: WorkflowRound | null): WorkflowRun | null {
  if (!run || !round) return run
  return {
    ...run,
    status: round.status,
    nodes: round.nodes,
    edges: round.edges,
    activeRoundId: round.id,
    completedAt: round.completedAt,
  }
}

function buildContinuePrompt(sourceRun: WorkflowRun, sourceRound: WorkflowRound | null, userPrompt: string) {
  const sourceLogs = (sourceRound?.nodes ?? sourceRun.nodes)
    .map(node => {
      const text = node.output || node.logs.filter(line => line.trim()).slice(-40).join('\n')
      return text.trim() ? `## ${node.agentName}\n${text}` : ''
    })
    .filter(Boolean)
    .join('\n\n')

  return [
    '# 继续当前任务',
    '',
    '## 用户新需求',
    userPrompt,
    '',
    '## 来源任务',
    `任务名称：${sourceRun.name}`,
    `原始需求：${sourceRun.prompt || sourceRound?.prompt || sourceRun.name}`,
    '',
    '## 上一轮结果摘要',
    sourceLogs || '无可用摘要',
  ].join('\n')
}

function assertSelectedAgents(plan: AiSelectResponse): void {
  if (!Array.isArray(plan.nodes) || plan.nodes.length === 0) {
    throw new Error(t('AI 没有选择任何 Agent，请换一种描述后重试'))
  }
}

function buildAutoFixSelectorPrompt(offer: AutoFixOffer): string {
  return [
    '基于以下 code-reviewer 审查输出，挑选一个最合适的修复 Agent（不要选 code-reviewer）。',
    '只输出一个修复节点 + 一个 code-reviewer 复审节点。',
    '',
    '## 审查摘要',
    offer.summary,
    '',
    offer.affectedPaths.length > 0
      ? `## 涉及文件\n${offer.affectedPaths.map(p => `- ${p}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n')
}

function buildAutoFixPrompt(offer: AutoFixOffer, fixAgent: string): string {
  return [
    `# 自动修复任务（第 ${4 - offer.remainingBudget} 轮）`,
    `执行 Agent: ${fixAgent}`,
    '',
    '## 上一轮 code-reviewer 审查摘要',
    offer.summary,
    '',
    offer.affectedPaths.length > 0
      ? `## 重点修复文件\n${offer.affectedPaths.map(p => `- ${p}`).join('\n')}`
      : '',
    '',
    '请只针对上述问题做最小改动，避免引入新功能或重构无关代码。',
  ].filter(Boolean).join('\n')
}

function AutoFixCard({
  offer,
  isSubmitting,
  error,
  onAccept,
  onDecline,
}: {
  offer: AutoFixOffer
  isSubmitting: boolean
  error: string | null
  onAccept: () => void
  onDecline: () => void
}) {
  const usedRound = 3 - offer.remainingBudget + 1
  return (
    <div className="rounded-[26px] border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
        <span>{t('⚠️ Code-reviewer 发现问题')}</span>
        <span className="rounded-full border border-amber-300 bg-white/70 px-2 py-0.5 text-[10px] font-medium text-amber-700">
          {t('第 {used} / 3 轮 · 还可自动修复 {left} 次', { used: usedRound, left: offer.remainingBudget })}
        </span>
      </div>
      {offer.affectedPaths.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('涉及文件')}</div>
          <div className="flex flex-wrap gap-1.5">
            {offer.affectedPaths.slice(0, 8).map(path => (
              <span key={path} className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-0.5 font-mono text-[11px] text-slate-600">
                {path}
              </span>
            ))}
            {offer.affectedPaths.length > 8 && (
              <span className="text-[11px] text-slate-400">+{offer.affectedPaths.length - 8}</span>
            )}
          </div>
        </div>
      )}
      <div className="mb-4 rounded-[14px] bg-white/60 px-3 py-2 text-xs leading-5 text-slate-600">
        {offer.suggestedAgent ? (
          <>
            <span className="font-semibold text-slate-800">{t('规则建议：')}</span>
            {t('由')} <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-white">{offer.suggestedAgent}</span> {t('修复 + 重新 code-reviewer 复审')}
          </>
        ) : (
          <>
            <span className="font-semibold text-slate-800">{t('规则未匹配：')}</span>
            {t('将由 AI 根据问题描述选择合适的修复 Agent')}
          </>
        )}
      </div>
      {error && (
        <div className="mb-3 rounded-[14px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onDecline}
          disabled={isSubmitting}
          className="flex-1 min-w-[120px] rounded-full border border-slate-300 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-white disabled:opacity-50"
        >
          {t('接受问题，结束流程')}
        </button>
        <button
          onClick={onAccept}
          disabled={isSubmitting}
          className="flex-1 min-w-[120px] rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? t('启动中...') : t('立即自动修复')}
        </button>
      </div>
    </div>
  )
}

function LiveRunList({ runs, onSelect, onCreate }: { runs: WorkflowRun[]; onSelect: (runId: string) => void; onCreate: () => void }) {
  const orderedRuns = runs.slice().sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="flex h-full min-h-0 flex-col bg-[rgb(247,248,253)] px-6 py-5">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center">
        <div className="mb-6">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Live Runs</p>
          <h1 className="text-[2rem] font-semibold tracking-[-0.045em] text-slate-950">{t('选择运行中的任务')}</h1>
          <p className="mt-2 text-sm text-slate-500">{t('当前有多个任务正在执行，选择一个进入详细运行视图。')}</p>
        </div>

        <div className="grid gap-3">
          {orderedRuns.map(run => {
            const activeNode = run.nodes.find(node => node.status === 'running' || node.status === 'waiting')
              ?? run.nodes.find(node => node.status !== 'pending')
            return (
              <button
                key={run.id}
                onClick={() => onSelect(run.id)}
                className="group flex w-full items-center justify-between gap-4 rounded-[24px] border border-black/[0.06] bg-transparent px-5 py-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${run.status === 'running' ? 'animate-pulse bg-blue-500' : 'bg-amber-400'}`} />
                    <span className="truncate text-base font-semibold tracking-[-0.02em] text-slate-900">{run.name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>{run.status === 'running' ? t('执行中') : t('等待确认')}</span>
                    {activeNode && (
                      <>
                        <span>·</span>
                        <span>{activeNode.agentName}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{formatDateTime(run.createdAt)}</span>
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 transition group-hover:border-slate-400 group-hover:text-slate-800">
                  {t('进入')}
                </span>
              </button>
            )
          })}
        </div>

        <button
          onClick={onCreate}
          className="mt-6 w-fit rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          {t('创建新任务')}
        </button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

// 服务端对 workflow:run / workflow:continue 的拒绝是即时回复；超过这个间隔的同类错误不属于本次启动
const START_REJECTION_WINDOW_MS = 30_000

export default function RunnerPage() {
  useAgents()
  const location = useLocation()
  const navigate = useNavigate()
  // autoRun 只来自内存里的 runnerSession：浏览器历史里的旧 state 在刷新或后退后仍然存在，
  // 若从它启动会重复跑一次完整任务
  const locationState = useMemo(
    () => ({ ...(location.state ?? {}), autoRun: undefined }) as RouteState,
    [location.state],
  )
  const explicitHistoryRunId = locationState.historyRunId ?? new URLSearchParams(location.search).get('historyRunId') ?? undefined
  const runnerSession = useWorkflowStore(s => s.runnerSession)
  const setRunnerSession = useWorkflowStore(s => s.setRunnerSession)
  const routeState: RouteState = hasRouteSessionState(locationState)
    ? locationState
    : explicitHistoryRunId
      ? { historyRunId: explicitHistoryRunId }
    : {
        prompt: runnerSession?.prompt,
        runId: runnerSession?.runId,
        projectName: runnerSession?.projectName,
        agentNames: runnerSession?.agentNames,
        templateName: runnerSession?.templateName,
        codeContext: runnerSession?.codeContext,
        attachments: runnerSession?.attachments,
        autoRun: runnerSession?.autoRun ?? undefined,
      }
  const agents = useAgentStore(s => s.agents)

  const activeRuns    = useWorkflowStore(s => s.activeRuns)
  const upsertRun = useWorkflowStore(s => s.upsertRun)
  const pendingConfirm = useWorkflowStore(s => s.pendingConfirm)
  const setPendingConfirm = useWorkflowStore(s => s.setPendingConfirm)
  const pendingAutoFix = useWorkflowStore(s => s.pendingAutoFix)
  const setPendingAutoFix = useWorkflowStore(s => s.setPendingAutoFix)
  const [autoFixSubmitting, setAutoFixSubmitting] = useState(false)
  const [autoFixError, setAutoFixError] = useState<string | null>(null)
  const lastWsError = useWsStore(s => s.lastError)

  const startRequest = useWorkflowStore(s => s.startRequest)
  const setStartRequest = useWorkflowStore(s => s.setStartRequest)

  const initialPrompt    = routeState.prompt ?? ''
  const agentNames       = routeState.agentNames ?? []
  const templateName     = routeState.templateName ?? ''
  const attachmentItems  = routeState.attachments ?? []
  const autoRun          = routeState.autoRun ?? null

  const [activeTab, setActiveTab] = useState<Tab>('任务')
  const [previewOverridePath, setPreviewOverridePath] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isRestoringActiveRuns, setIsRestoringActiveRuns] = useState(false)
  const [autoRunStatus, setAutoRunStatus] = useState<AutoRunStatus>(runnerSession?.autoRunStatus ?? (autoRun ? 'selecting' : 'idle'))
  const [autoRunError, setAutoRunError] = useState<string | null>(runnerSession?.autoRunError ?? null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(routeState.runId ?? null)
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null)
  const [historyRun, setHistoryRun] = useState<WorkflowRun | null>(null)
  const [isLoadingHistoryRun, setIsLoadingHistoryRun] = useState(false)
  const [historyRunError, setHistoryRunError] = useState<string | null>(null)
  const [isContinuingHistoryRun, setIsContinuingHistoryRun] = useState(false)
  const [pendingContinueRunId, setPendingContinueRunId] = useState<string | null>(null)
  const [continueError, setContinueError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const chatEndRef = useRef<HTMLDivElement>(null)
  const autoRunStartedRef = useRef(runnerSession?.autoRunStarted ?? false)
  // 本页发出 workflow:run 的时刻；只处理在它之后到达的服务端错误
  const autoRunSentAtRef = useRef<number | null>(null)
  const hadLiveHistoryRunRef = useRef(false)
  // 本页发出 workflow:continue 的时刻；只处理在它之后到达的服务端错误
  const continueSentAtRef = useRef<number | null>(null)

  const updateAutoRunSession = useCallback((patch: AutoRunSessionPatch) => {
    const session = useWorkflowStore.getState().runnerSession
    if (!session?.autoRun) return
    setRunnerSession({ ...session, ...patch })
  }, [setRunnerSession])

  const setPersistedAutoRunState = useCallback((status: AutoRunStatus, error: string | null = null, started?: boolean) => {
    setAutoRunStatus(status)
    setAutoRunError(error)
    updateAutoRunSession({
      autoRunStatus: status,
      autoRunError: error,
      ...(started === undefined ? {} : { autoRunStarted: started }),
    })
  }, [updateAutoRunSession])

  useEffect(() => {
    if (!hasRouteSessionState(locationState)) return

    setRunnerSession({
      prompt: locationState.prompt ?? '',
      runId: locationState.runId,
      historyRunId: locationState.historyRunId,
      projectName: locationState.projectName ?? '',
      agentNames: locationState.agentNames ?? [],
      templateName: locationState.templateName ?? '',
      codeContext: locationState.codeContext ?? [],
      attachments: locationState.attachments ?? [],
      autoRun: null,
      autoRunStatus: 'idle',
      autoRunError: null,
      autoRunStarted: false,
    })
  }, [locationState, setRunnerSession])

  const liveRuns = useMemo(() => activeRuns.filter(isLiveRun), [activeRuns])
  const selectableLiveRuns = explicitHistoryRunId ? liveRuns.filter(run => run.id === explicitHistoryRunId) : liveRuns
  const currentRun = selectCurrentRun(selectableLiveRuns, routeState, autoRun, selectedRunId)
  // True when there's no specific runId to find, or the run is already in liveRuns.
  // Memoised as a boolean so the restoration effect doesn't re-fire on every log append.
  const hasTargetRun = useMemo(
    () => !routeState.runId || liveRuns.some(r => r.id === routeState.runId),
    [liveRuns, routeState.runId]
  )
  // Capture the last live runId so a session run that finishes can transition into the
  // history-snapshot view automatically instead of leaving the page blank.
  const [lastSeenRunId, setLastSeenRunId] = useState<string | null>(null)
  useEffect(() => {
    if (currentRun?.id) setLastSeenRunId(currentRun.id)
  }, [currentRun?.id])
  const historyRunId = explicitHistoryRunId ?? (!currentRun && lastSeenRunId ? lastSeenRunId : undefined)
  const sourceDisplayRun = currentRun ?? historyRun
  const rounds = sourceDisplayRun ? getRunRounds(sourceDisplayRun) : []
  const selectedRound = getSelectedRound(sourceDisplayRun, selectedRoundId)
  const latestRound = rounds.at(-1) ?? null
  const displayRun = createDisplayRun(sourceDisplayRun, selectedRound)
  const isHistoryDetail = Boolean(historyRun && !currentRun)
  const hasRunningRound = rounds.some(round => round.status === 'running' || round.status === 'paused')
  // 创建页刚发出的启动请求被服务端拒绝（且还没拿到 run）：显示原因，而不是空白页。
  // 由 store 里的 startRequest 与 lastError 派生，不另存状态
  const startRejection = startRequest && !displayRun && !explicitHistoryRunId
    && lastWsError && lastWsError.requestType === startRequest.message.type
    && lastWsError.at >= startRequest.at && lastWsError.at - startRequest.at <= START_REJECTION_WINDOW_MS
    ? lastWsError.message
    : null

  // run 已经出现，启动请求使命结束
  useEffect(() => {
    if (currentRun && startRequest) setStartRequest(null)
  }, [currentRun, startRequest, setStartRequest])

  useEffect(() => {
    if (routeState.runId) {
      setSelectedRunId(routeState.runId)
    }
  }, [routeState.runId])

  useEffect(() => {
    setPreviewOverridePath(null)
  }, [currentRun?.id, historyRunId])

  useEffect(() => {
    if (!selectedRunId) return
    if (liveRuns.some(run => run.id === selectedRunId)) return
    setSelectedRunId(null)
  }, [liveRuns, selectedRunId])

  useEffect(() => {
    if (!sourceDisplayRun) {
      setSelectedRoundId(null)
      return
    }
    const nextRound = getSelectedRound(sourceDisplayRun, selectedRoundId)
    if (nextRound && nextRound.id !== selectedRoundId) {
      setSelectedRoundId(nextRound.id)
    }
  }, [sourceDisplayRun, selectedRoundId])

  useEffect(() => {
    if (!historyRunId) {
      setHistoryRun(null)
      setHistoryRunError(null)
      setIsLoadingHistoryRun(false)
      return
    }

    let cancelled = false
    setHistoryRun(null)
    setHistoryRunError(null)
    setIsLoadingHistoryRun(true)
    api.getRun(historyRunId)
      .then(run => {
        if (!cancelled) setHistoryRun(run)
      })
      .catch(error => {
        if (!cancelled) setHistoryRunError(getApiErrorMessage(error, t('运行快照数据不完整或已失效')))
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistoryRun(false)
      })

    return () => {
      cancelled = true
    }
  }, [historyRunId])

  useEffect(() => {
    if (!currentRun || !runnerSession || runnerSession.runId === currentRun.id) return
    if (runnerSession.runId && runnerSession.runId !== currentRun.id) return

    setRunnerSession({
      ...runnerSession,
      runId: currentRun.id,
      projectName: runnerSession.projectName || currentRun.name,
    })
  }, [currentRun, runnerSession, setRunnerSession])

  useEffect(() => {
    const isActive = currentRun?.status === 'running' || currentRun?.status === 'paused'
    if (!isActive) {
      setNow(Date.now())
      return
    }

    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [currentRun?.id, currentRun?.status])

  const displayPrompt = sourceDisplayRun ? '' : initialPrompt
  const displayAgentNames = agentNames.length > 0
    ? agentNames
    : Array.from(new Set((rounds.length > 0 ? rounds.flatMap(round => round.nodes) : displayRun?.nodes ?? []).map(node => node.agentName)))
  const projectName = routeState.projectName || displayRun?.name || t('未命名项目')
  const agentName   = displayRun?.nodes[0]?.agentName ?? displayAgentNames[0] ?? 'Agent'
  const isTaskExecuting = currentRun?.status === 'running'
    || currentRun?.status === 'paused'
    || (isHistoryDetail && historyRun !== null && historyRun.status !== 'completed')
    || autoRunStatus === 'selecting'
    || autoRunStatus === 'starting'
  const isInputVisible = currentRun?.status === 'completed'
    || (isHistoryDetail && historyRun?.status === 'completed')
  const isContinueDisabled = isHistoryDetail && (isContinuingHistoryRun || Boolean(pendingContinueRunId) || hasRunningRound || agents.length === 0)
  const isSendDisabled = !inputValue.trim() || isTaskExecuting || isContinueDisabled
  const pendingConfirmNode = pendingConfirm && currentRun?.id === pendingConfirm.runId
    ? currentRun.nodes.find(n => n.id === pendingConfirm.nodeId)
    : undefined
  const pendingRateLimitWait = pendingConfirm && pendingConfirmNode
    ? getPersistedRateLimitWait(
        pendingConfirm.runId,
        pendingConfirm.nodeId,
        getNodeRateLimitText(pendingConfirmNode, pendingConfirm.summary),
        pendingConfirmNode.finishedAt ?? Date.now(),
      )
    : null
  const autoRunRateLimitWait = autoRun && autoRunError
    ? getPersistedRateLimitWait(
        'auto-run',
        normalizeProjectName(autoRun.projectName || routeState.projectName || autoRun.prompt) || 'default',
        autoRunError,
      )
    : null

  useEffect(() => {
    // Also restore when we have a runId from session but it hasn't appeared in liveRuns yet
    // (race: page rendered before WebSocket state:snapshot arrived)
    if (hasTargetRun && (historyRunId || currentRun || initialPrompt || autoRun || liveRuns.length > 0)) return

    let cancelled = false
    setIsRestoringActiveRuns(true)
    api.getActiveRuns()
      .then(runs => {
        if (cancelled) return
        runs.forEach(upsertRun)
      })
      .catch((err: unknown) => console.error('[RunnerPage] failed to restore active runs', err))
      .finally(() => {
        if (!cancelled) setIsRestoringActiveRuns(false)
      })

    return () => {
      cancelled = true
    }
  }, [autoRun, currentRun, hasTargetRun, historyRunId, initialPrompt, liveRuns.length, upsertRun])

  useEffect(() => {
    if (!historyRunId) {
      hadLiveHistoryRunRef.current = false
      return
    }
    if (currentRun) {
      hadLiveHistoryRunRef.current = true
      if (pendingContinueRunId === currentRun.id) {
        setPendingContinueRunId(null)
        setIsContinuingHistoryRun(false)
      }
      return
    }
    if (!hadLiveHistoryRunRef.current) return

    hadLiveHistoryRunRef.current = false
    let cancelled = false
    api.getRun(historyRunId)
      .then(run => {
        if (cancelled) return
        setHistoryRun(run)
        setSelectedRoundId(null)
      })
      .catch(error => {
        if (!cancelled) setHistoryRunError(getApiErrorMessage(error, t('运行快照数据刷新失败')))
      })
    return () => {
      cancelled = true
    }
  }, [currentRun, historyRunId, pendingContinueRunId])

  useEffect(() => {
    if (!pendingContinueRunId) return
    const timer = window.setTimeout(() => {
      const stillMissing = !useWorkflowStore.getState().activeRuns.some(run => run.id === pendingContinueRunId)
      if (!stillMissing) return
      setPendingContinueRunId(null)
      setIsContinuingHistoryRun(false)
      setContinueError(t('继续任务启动超时，请重试'))
    }, 15000)
    return () => window.clearTimeout(timer)
  }, [pendingContinueRunId])

  // 服务端拒绝了刚发出的 workflow:continue：立刻显示原因，不等 15 秒超时
  useEffect(() => {
    const sentAt = continueSentAtRef.current
    if (!lastWsError || sentAt === null || lastWsError.at < sentAt || !pendingContinueRunId) return
    if (lastWsError.requestType !== 'workflow:continue') return
    continueSentAtRef.current = null
    setPendingContinueRunId(null)
    setIsContinuingHistoryRun(false)
    setContinueError(lastWsError.message)
  }, [lastWsError, pendingContinueRunId])

  useEffect(() => {
    if (!currentRun || (currentRun.status !== 'running' && currentRun.status !== 'paused')) return

    const refreshActiveRuns = () => {
      api.getActiveRuns()
        .then(runs => runs.forEach(upsertRun))
        .catch((err: unknown) => console.error('[RunnerPage] failed to refresh active runs', err))
    }
    const timer = window.setInterval(refreshActiveRuns, 30000)

    return () => window.clearInterval(timer)
  }, [currentRun?.id, currentRun?.status, upsertRun])

  useEffect(() => {
    if (!currentRun || (currentRun.status !== 'running' && currentRun.status !== 'paused')) return

    let wakeLock: WakeLockSentinelLike | null = null
    let cancelled = false
    const nav = navigator as NavigatorWithWakeLock

    const requestWakeLock = async () => {
      if (!nav.wakeLock || document.visibilityState !== 'visible') return
      try {
        wakeLock = await nav.wakeLock.request('screen')
        if (cancelled) {
          await wakeLock.release()
          wakeLock = null
        }
      } catch {
        wakeLock = null
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && (!wakeLock || wakeLock.released)) {
        void requestWakeLock()
      }
    }

    void requestWakeLock()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void wakeLock?.release()
    }
  }, [currentRun?.id, currentRun?.status])

  const startAutoRun = useCallback(async () => {
    if (!autoRun || autoRunStartedRef.current || agents.length === 0) return
    autoRunStartedRef.current = true
    updateAutoRunSession({ autoRunStarted: true, autoRunStatus: 'selecting', autoRunError: null })

    setPersistedAutoRunState('selecting', null, true)
    try {
      const plan = await api.selectAgents(autoRun.prompt, agents)
      assertSelectedAgents(plan)
      setPersistedAutoRunState('starting', null, true)
      autoRunSentAtRef.current = Date.now()
      // 连接已断开时没发出去：落到下面的 catch 显示原因并允许重试，而不是假装已启动
      if (!sendOrNotify({
        type: 'workflow:run',
        payload: {
          name: routeState.projectName || autoRun.prompt.slice(0, 60),
          projectName: autoRun.projectName || undefined,
          nodes: plan.nodes,
          edges: plan.edges,
          globalPrompt: autoRun.prompt,
          codeContext: autoRun.codeContext,
          attachments: autoRun.attachments,
          requireConfirm: autoRun.requireConfirm,
          executionMode: autoRun.executionMode,
        },
      })) throw new Error(sendFailedMessage())
      setPersistedAutoRunState('started', null, true)
    } catch (error) {
      setPersistedAutoRunState(
        'error',
        getApiErrorMessage(error, t('AI 任务分配失败，请重试')),
        true,
      )
    }
  }, [agents, autoRun, routeState.projectName, setPersistedAutoRunState, updateAutoRunSession])

  useEffect(() => {
    void startAutoRun()
  }, [startAutoRun])

  // 服务端拒绝了刚发出的 workflow:run（如 AI 选了同名 agent）：回到失败状态，显示原因并允许重试
  useEffect(() => {
    const sentAt = autoRunSentAtRef.current
    if (!lastWsError || sentAt === null || lastWsError.at < sentAt) return
    if (lastWsError.requestType !== 'workflow:run' || autoRunStatus !== 'started' || currentRun) return
    autoRunSentAtRef.current = null
    setPersistedAutoRunState('error', lastWsError.message, true)
  }, [autoRunStatus, currentRun, lastWsError, setPersistedAutoRunState])

  const retryAutoRun = useCallback(() => {
    autoRunStartedRef.current = false
    void startAutoRun()
  }, [startAutoRun])

  const retryStart = () => {
    if (!startRequest) return
    // 新的发送时刻必须晚于上一条错误，否则旧错误会立刻把卡片再顶出来
    const at = Math.max(Date.now(), (lastWsError?.at ?? 0) + 1)
    if (!sendOrNotify(startRequest.message)) return
    setStartRequest({ at, message: startRequest.message })
  }

  const backToCreate = () => {
    setStartRequest(null)
    setRunnerSession(null)
    navigate('/')
  }

  const cancelAutoRun = useCallback(() => {
    autoRunStartedRef.current = false
    setPersistedAutoRunState('error', t('任务已终止'), false)
    setRunnerSession(null)
    navigate('/')
  }, [navigate, setPersistedAutoRunState, setRunnerSession])

  // Scroll chat to bottom as node list / pendingConfirm changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayRun?.nodes.length, pendingConfirm, autoRunStatus])

  const handleSend = async () => {
    if (isSendDisabled) return
    const message = inputValue.trim()
    if (!message) return

    if (isHistoryDetail && historyRun) {
      setIsContinuingHistoryRun(true)
      setContinueError(null)
      try {
        const globalPrompt = buildContinuePrompt(historyRun, latestRound, message)
        const plan = await api.selectAgents(globalPrompt, agents)
        assertSelectedAgents(plan)
        continueSentAtRef.current = Date.now()
        // 没发出去（连接已断开）：走 catch 显示原因，输入框内容保留
        if (!sendOrNotify({
          type: 'workflow:continue',
          payload: {
            runId: historyRun.id,
            name: historyRun.name,
            globalPrompt,
            nodes: plan.nodes,
            edges: plan.edges,
            requireConfirm: historyRun.requireConfirm,
          },
        })) throw new Error(sendFailedMessage())
        setPendingContinueRunId(historyRun.id)
        setSelectedRoundId(null)
        setInputValue('')
      } catch (error) {
        setContinueError(getApiErrorMessage(error, t('继续任务创建失败，请重试')))
        setIsContinuingHistoryRun(false)
      }
      return
    }

    setInputValue('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    }
  }

  // Show empty state when navigated directly with no active run
  if (!displayRun && !displayPrompt && isLoadingHistoryRun) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-slate-500">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500" />
        {t('正在加载历史快照...')}
      </div>
    )
  }

  if (!displayRun && !displayPrompt && historyRunError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="text-[56px] opacity-50 select-none">⚠️</div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-600">{historyRunError}</p>
          <p className="text-xs text-slate-400">{t('请返回历史记录重新选择一个任务')}</p>
        </div>
        <button
          onClick={() => navigate('/history')}
          className="mt-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          {t('返回历史')}
        </button>
      </div>
    )
  }

  if (!displayRun && !displayPrompt && isRestoringActiveRuns) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-slate-500">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500" />
        {t('正在恢复运行快照...')}
      </div>
    )
  }

  if (!displayRun && !displayPrompt && !autoRun && liveRuns.length > 1) {
    return (
      <LiveRunList
        runs={liveRuns}
        onSelect={setSelectedRunId}
        onCreate={() => navigate('/')}
      />
    )
  }

  if (!displayRun && !displayPrompt && !startRejection) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="text-[56px] opacity-50 select-none">📭</div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-600">{t('暂无运行中的任务')}</p>
          <p className="text-xs text-slate-400">{t('去创建页面发起一个新的协作流程')}</p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="mt-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          {t('去创建')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: Chat Panel ─────────────────────────────────────────── */}
      <div className="flex w-[460px] shrink-0 flex-col border-r border-black/[0.06] bg-[rgb(247,248,253)]">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => navigate('/')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label={t('返回')}
            >
              <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="truncate text-sm font-semibold text-slate-800">{projectName}</span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-5 pr-5 space-y-5">

          {/* Initial user message */}
          {displayPrompt && (
            <div className="flex flex-col items-end">
              <div className="flex items-end gap-2 max-w-[88%]">
                <div className="rounded-2xl rounded-br-md bg-transparent px-4 py-3 text-sm leading-6 text-slate-800 ring-1 ring-black/[0.05]">
                  <MarkdownText text={displayPrompt} />
                </div>
                <UserAvatar />
              </div>
            </div>
          )}

          {startRejection && (
            <div className="flex justify-start">
              <div role="alert" className="max-w-[88%] rounded-2xl rounded-tl-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-600">
                {startRejection}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={retryStart}
                    className="rounded-full border border-rose-300 bg-white px-3 py-1 text-xs font-medium text-rose-600 transition hover:border-rose-400"
                  >
                    {t('重试')}
                  </button>
                  <button
                    type="button"
                    onClick={backToCreate}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400"
                  >
                    {t('返回创建页')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {autoRun && !currentRun && (autoRunStatus === 'selecting' || autoRunStatus === 'starting') && (
            <div className="flex justify-start">
              <div className="flex max-w-[88%] items-center gap-2 rounded-2xl rounded-tl-md border border-slate-200 bg-transparent px-4 py-3 text-sm text-slate-500">
                <span className="inline-flex gap-1">
                  {[0, 150, 300].map(delay => (
                    <span
                      key={delay}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </span>
                {autoRunStatus === 'selecting' ? t('大模型正在选择合适的 Agent...') : t('正在启动工作流...')}
              </div>
            </div>
          )}

          {autoRunStatus === 'error' && autoRunRateLimitWait && (
            <div className="flex justify-start">
              <AutoRunRateLimitCard
                wait={autoRunRateLimitWait}
                onCancel={cancelAutoRun}
                onContinue={retryAutoRun}
              />
            </div>
          )}

          {autoRunStatus === 'error' && !autoRunRateLimitWait && (
            <div className="flex justify-start">
              <div className="max-w-[88%] rounded-2xl rounded-tl-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-600">
                {autoRunError ?? t('AI 任务分配失败，请重试')}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={retryAutoRun}
                    className="rounded-full border border-rose-300 bg-white px-3 py-1 text-xs font-medium text-rose-600 transition hover:border-rose-400"
                  >
                    {t('重试')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Round chat history */}
          {rounds.map((round, roundIndex) => (
            <div key={round.id} className="space-y-5">
              {rounds.length > 1 && (
                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-slate-200/80" />
                  <span className="rounded-full border border-slate-200 bg-white/40 px-3 py-1 text-[11px] font-medium text-slate-500">
                    {t('第 {n} 轮', { n: roundIndex + 1 })} · {getRoundStatusLabel(round.status)}
                  </span>
                  <div className="h-px flex-1 bg-slate-200/80" />
                </div>
              )}

              {round.prompt && (
                <div className="flex flex-col items-end">
                  <div className="flex max-w-[88%] items-end gap-2">
                    <div className="rounded-2xl rounded-br-md bg-transparent px-4 py-3 text-sm leading-6 text-slate-800 ring-1 ring-black/[0.05]">
                      <MarkdownText text={round.prompt} />
                    </div>
                    <UserAvatar />
                  </div>
                </div>
              )}

              {round.nodes.map(node => {
                if (node.status === 'pending') return null

                const isRunning   = node.status === 'running'
                const isCompleted = node.status === 'completed'
                const isError     = node.status === 'failed'
                const isWaiting   = node.status === 'waiting'

                const elapsedLabel = getNodeElapsedLabel(node, now)

                return (
                  <div key={`${round.id}-${node.id}`} className="flex flex-col gap-1.5">
                    {/* Agent label row */}
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1a1f2e] text-[9px] font-bold text-white">
                        {node.agentName?.[0]?.toUpperCase() ?? 'A'}
                      </div>
                      <span className="text-xs font-medium text-slate-400">
                        {node.agentName}
                        <span className="mx-1 text-slate-300">·</span>
                        {isRunning ? 'Auto' : isCompleted ? 'Completed' : isWaiting ? 'Waiting' : 'Error'}
                        {elapsedLabel && (
                          <>
                            <span className="mx-1 text-slate-300">·</span>
                            {elapsedLabel}
                          </>
                        )}
                      </span>
                    </div>

                    {/* Bubble */}
                    <div className="ml-8">
                      {isError ? (
                        <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-700">
                          <span>⊗</span>
                          <span>{t('执行失败，可在右侧任务栏查看完整日志')}</span>
                        </div>
                      ) : isWaiting ? (
                        <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs font-medium text-sky-700">
                          <span>⏸</span>
                          <span>{t('等待确认后继续执行')}</span>
                        </div>
                      ) : isRunning ? (
                        <div className="w-full max-w-[88%] overflow-hidden rounded-2xl rounded-tl-md border border-blue-100 bg-blue-50/60">
                          <div className="flex items-center gap-1.5 border-b border-blue-100/70 px-4 py-2.5">
                            <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-blue-500" />
                            <span className="text-xs font-medium text-blue-600">{t('执行中')}</span>
                          </div>
                          {node.logs.some(l => l.trim()) && (
                            <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-500">
                              {node.logs.filter(l => l.trim()).slice(-15).join('\n')}
                            </pre>
                          )}
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-700">
                          <span>✓</span>
                          <span>{t('已完成，详情请查看右侧任务栏')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

          {/* Confirm card inline */}
          {pendingConfirm && currentRun?.id === pendingConfirm.runId && (
            <div className="ml-8">
              <ConfirmCard
                runId={pendingConfirm.runId}
                nodeId={pendingConfirm.nodeId}
                agentName={pendingConfirmNode?.agentName ?? ''}
                summary={pendingConfirm.summary}
                nextNodeIds={pendingConfirm.nextNodeIds}
                rateLimitWait={pendingRateLimitWait}
                // 没发出去（连接已断开）就保留确认卡片，让用户重连后再点
                onConfirm={(runId, nodeId, instruction) => {
                  if (!sendOrNotify({ type: 'task:confirm', payload: { runId, roundId: pendingConfirm.roundId, nodeId, instruction } })) return
                  setPendingConfirm(null)
                }}
                onCancel={(runId) => {
                  if (!sendOrNotify({ type: 'task:cancel', payload: { runId } })) return
                  setPendingConfirm(null)
                }}
              />
            </div>
          )}

          {/* Auto-fix offer card */}
          {pendingAutoFix && currentRun?.id === pendingAutoFix.runId && (
            <div className="ml-8">
              <AutoFixCard
                offer={pendingAutoFix}
                isSubmitting={autoFixSubmitting}
                error={autoFixError}
                onAccept={async () => {
                  if (autoFixSubmitting) return
                  setAutoFixSubmitting(true)
                  setAutoFixError(null)
                  try {
                    let fixAgentName = pendingAutoFix.suggestedAgent
                    if (!fixAgentName) {
                      const planPrompt = buildAutoFixSelectorPrompt(pendingAutoFix)
                      const plan = await api.selectAgents(planPrompt, agents)
                      assertSelectedAgents(plan)
                      const candidate = plan.nodes.find(node => node.agentName !== 'code-reviewer')
                      fixAgentName = candidate?.agentName ?? plan.nodes[0]?.agentName ?? null
                    }
                    if (!fixAgentName) throw new Error(t('未能选出修复 agent'))

                    const fixPrompt = buildAutoFixPrompt(pendingAutoFix, fixAgentName)
                    if (!sendOrNotify({
                      type: 'workflow:continue',
                      payload: {
                        runId: pendingAutoFix.runId,
                        name: currentRun?.name ?? 'auto-fix',
                        globalPrompt: fixPrompt,
                        nodes: [
                          { id: 'auto-fix', agentName: fixAgentName, agentType: 'custom', promptTemplate: fixPrompt },
                          { id: 'auto-review', agentName: 'code-reviewer', agentType: 'omc', promptTemplate: '复审 auto-fix 节点的修改：{{nodes.auto-fix.output}}' },
                        ],
                        edges: [{ from: 'auto-fix', to: 'auto-review' }],
                        requireConfirm: currentRun?.requireConfirm ?? false,
                      },
                    })) throw new Error(sendFailedMessage())
                    setPendingAutoFix(null)
                  } catch (error) {
                    setAutoFixError(getApiErrorMessage(error, t('启动自动修复失败，请重试')))
                  } finally {
                    setAutoFixSubmitting(false)
                  }
                }}
                onDecline={() => {
                  if (!sendOrNotify({ type: 'task:auto_fix_decline', payload: { runId: pendingAutoFix.runId } })) return
                  setPendingAutoFix(null)
                  setAutoFixError(null)
                }}
              />
            </div>
          )}

          {/* Empty */}
          {!displayRun && !displayPrompt && (
            <div className="flex h-32 items-center justify-center text-sm text-slate-400">
              {t('暂无运行中的任务')}
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Area — only visible after the run is fully completed (live or history) */}
        {isInputVisible && (
        <div className="shrink-0 px-4 pb-4 pt-2">
          <div className="rounded-[36px] border-[0.5px] border-black/[0.08] bg-transparent px-4 pb-4 pt-4 shadow-none">
            {continueError && (
              <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                {continueError}
              </div>
            )}

            {/* Carried-over context chips */}
            {(templateName || attachmentItems.length > 0) && (
              <div className="mb-3 space-y-2">
                {templateName && (
                  <div className="overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex min-w-max items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-transparent px-3 py-1.5 text-[12px] font-medium text-amber-900">
                        <span className="mr-1.5">📦</span>{templateName}
                      </span>
                    </div>
                  </div>
                )}
                {attachmentItems.length > 0 && (
                  <div className="overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex min-w-max items-center gap-2">
                      {attachmentItems.map(item => (
                        <span key={`${item.name}-${item.mime}`} className="inline-flex items-center rounded-full border border-slate-200 bg-transparent px-3 py-1.5 text-[12px] font-medium text-slate-700">
                          <span className="mr-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-200 px-1 text-[9px] font-semibold leading-none text-slate-500">
                            {getAttachmentBadgeLabel(item.name, item.mime)}
                          </span>
                          <span className="max-w-[160px] truncate">{item.name}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Textarea */}
            <div className="px-1 py-0.5">
              <textarea
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isHistoryDetail ? t('基于此任务继续提需求...') : t('说说你的想法...')}
                rows={3}
                className="block h-[72px] w-full resize-none border-0 bg-transparent px-2 text-[0.95rem] leading-7 tracking-[-0.025em] text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>

            {/* Toolbar — identical layout to TaskForm */}
            <div className="mt-3 flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-2.5">
                {/* + attachment button */}
                <button className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-transparent text-[1.2rem] leading-none text-slate-500 transition hover:border-slate-300 hover:text-slate-900">
                  +
                </button>
              </div>

              {/* Submit button */}
              <button
                onClick={() => void handleSend()}
                disabled={isSendDisabled}
                aria-label={t('发送消息')}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-black bg-black text-[1.05rem] text-white shadow-none transition hover:scale-[1.02] hover:bg-neutral-900 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300 disabled:text-white disabled:opacity-70"
              >
                {isContinuingHistoryRun ? '…' : '↑'}
              </button>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* ── Right: Content Panel ──────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 overflow-hidden">

        {/* Main: tab bar + content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[rgb(247,248,253)]">

          {/* Tab bar */}
          <div className="flex shrink-0 items-center border-b border-black/[0.06] bg-transparent px-2">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative flex items-center gap-1.5 px-3.5 py-3 text-[13px] font-medium transition ${
                  activeTab === tab ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <span className={activeTab === tab ? 'text-slate-500' : 'text-slate-300'}>
                  <TabIcon tab={tab} />
                </span>
                {t(tab)}
                {activeTab === tab && (
                  <span className="absolute bottom-0 left-2.5 right-2.5 h-[2px] rounded-t-full bg-slate-800" />
                )}
              </button>
            ))}

            {/* Run status + cancel */}
            {displayRun && (
              <div className="ml-auto flex items-center gap-2 pr-3">
                <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  displayRun.status === 'running'   ? 'bg-blue-50 text-blue-600' :
                  displayRun.status === 'paused'    ? 'bg-amber-50 text-amber-700' :
                  displayRun.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                                                      'bg-rose-50 text-rose-600'
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    displayRun.status === 'running'   ? 'animate-pulse bg-blue-500' :
                    displayRun.status === 'paused'    ? 'bg-amber-400' :
                    displayRun.status === 'completed' ? 'bg-emerald-500' :
                                                        'bg-rose-500'
                  }`} />
                  {displayRun.status === 'running'   ? t('执行中') :
                   displayRun.status === 'paused'    ? t('等待确认') :
                   displayRun.status === 'completed' ? t('已完成') : t('失败')}
                </span>
                {currentRun && (currentRun.status === 'running' || currentRun.status === 'paused') && (
                  <button
                    onClick={() => { sendOrNotify({ type: 'task:cancel', payload: { runId: currentRun.id } }) }}
                    className="rounded-full border border-rose-200 bg-transparent px-2.5 py-0.5 text-[11px] font-medium text-rose-500 transition hover:border-rose-300"
                  >
                    {t('取消')}
                  </button>
                )}
              </div>
            )}
          </div>

          {(activeTab === '任务' || activeTab === '流程') && (
            <RoundTabs
              rounds={rounds}
              selectedRoundId={selectedRound?.id}
              onSelect={setSelectedRoundId}
            />
          )}

          {/* Tab content */}
          <div className={activeTab === '代码' || activeTab === '预览' || activeTab === '任务' ? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-4 pr-5'}>
            {activeTab === '代码' && (
              <CodeTab
                run={displayRun}
                onPreviewFile={path => {
                  setPreviewOverridePath(path)
                  setActiveTab('预览')
                }}
              />
            )}
            {activeTab === '任务' && <TaskTab run={displayRun} />}
            {activeTab === '流程' && <FlowTab run={displayRun} />}
            {activeTab === '预览' && (
              <PreviewTab
                run={displayRun}
                overridePath={previewOverridePath}
                onClearOverride={() => setPreviewOverridePath(null)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
