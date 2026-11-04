import { create } from 'zustand'
import type { AutoFixOffer, WorkflowRun, NodeStatus, RunStatus, CodeContext, TaskAttachment, ExecutionMode } from '../types/index'

const CLIENT_NODE_LOG_WINDOW = 200

export type AutoRunStatus = 'idle' | 'selecting' | 'starting' | 'error' | 'started'

export interface RunnerAutoRunSession {
  prompt: string
  projectName: string
  codeContext: CodeContext[]
  attachments: TaskAttachment[]
  requireConfirm: boolean
  executionMode?: ExecutionMode
}

export interface RunnerSessionState {
  runId?: string
  historyRunId?: string
  prompt: string
  projectName: string
  agentNames: string[]
  templateName: string
  codeContext: CodeContext[]
  attachments: Array<{ name: string; mime: string }>
  autoRun?: RunnerAutoRunSession | null
  autoRunStatus?: AutoRunStatus
  autoRunError?: string | null
  autoRunStarted?: boolean
}

type PendingConfirmState = {
  runId: string
  roundId?: string
  nodeId: string
  summary: string
  nextNodeIds: string[]
}

export interface LogScrollState {
  scrollTop: number
  isFollowingTail: boolean
}

interface WorkflowState {
  activeRuns: WorkflowRun[]
  pendingConfirm: PendingConfirmState | null
  pendingAutoFix: AutoFixOffer | null
  runnerSession: RunnerSessionState | null
  logScrollStates: Record<string, LogScrollState>
  activeFiles: Record<string, Set<string>>
  setActiveRuns: (runs: WorkflowRun[]) => void
  upsertRun: (run: WorkflowRun) => void
  setRunStatus: (runId: string, status: RunStatus, roundId?: string) => void
  appendLog: (runId: string, nodeId: string, line: string, roundId?: string) => void
  setNodeStatus: (runId: string, nodeId: string, status: NodeStatus, timing?: { startedAt?: number; finishedAt?: number; roundId?: string }) => void
  completeRun: (runId: string) => void
  failRun: (runId: string, nodeId: string, exitCode: number) => void
  setPendingConfirm: (data: WorkflowState['pendingConfirm']) => void
  setPendingAutoFix: (data: WorkflowState['pendingAutoFix']) => void
  setRunnerSession: (session: RunnerSessionState | null) => void
  setLogScrollState: (key: string, state: LogScrollState) => void
  setFileActivity: (runId: string, path: string, active: boolean) => void
  clearActiveFiles: (runId: string) => void
  reset: () => void
}

function getPendingConfirmFromRun(run: WorkflowRun): PendingConfirmState | null {
  if (run.status !== 'paused' && run.status !== 'running') return null
  const nodes = Array.isArray(run.nodes) ? run.nodes : []
  const waitingNode = nodes.find(node => node.status === 'waiting')
  if (!waitingNode) return null
  const edges = Array.isArray(run.edges) ? run.edges : []
  const logs = Array.isArray(waitingNode.logs) ? waitingNode.logs : []
  const recentLogs = logs.filter(line => line.trim()).slice(-120)

  return {
    runId: run.id,
    roundId: run.activeRoundId,
    nodeId: waitingNode.id,
    summary: (waitingNode.output || recentLogs.join('\n')).split('\n').filter(line => line.trim()).slice(-120).join('\n'),
    nextNodeIds: edges.filter(edge => edge.from === waitingNode.id).map(edge => edge.to),
  }
}

function getRunRounds(run: WorkflowRun) {
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

function updateRunNodes(
  run: WorkflowRun,
  roundId: string | undefined,
  updateNode: (node: WorkflowRun['nodes'][number]) => WorkflowRun['nodes'][number]
) {
  const rounds = getRunRounds(run)
  const activeRoundId = run.activeRoundId ?? rounds.at(-1)?.id
  const targetRoundId = roundId ?? activeRoundId
  const nextRounds = rounds.map(round =>
    round.id !== targetRoundId ? round : {
      ...round,
      nodes: round.nodes.map(updateNode),
    }
  )
  const activeRound = nextRounds.find(round => round.id === activeRoundId) ?? nextRounds.at(-1)
  return {
    ...run,
    rounds: nextRounds,
    activeRoundId,
    nodes: activeRound?.nodes ?? run.nodes.map(updateNode),
    edges: activeRound?.edges ?? run.edges,
  }
}

function updateRunRoundStatus(run: WorkflowRun, status: RunStatus, roundId?: string) {
  const rounds = getRunRounds(run)
  const activeRoundId = run.activeRoundId ?? rounds.at(-1)?.id
  const targetRoundId = roundId ?? activeRoundId
  const nextRounds = rounds.map(round =>
    round.id !== targetRoundId ? round : { ...round, status }
  )
  const activeRound = nextRounds.find(round => round.id === activeRoundId) ?? nextRounds.at(-1)
  return {
    ...run,
    status: activeRound?.status ?? status,
    rounds: nextRounds,
    activeRoundId,
  }
}

function hasWaitingConfirm(run: WorkflowRun, pendingConfirm: PendingConfirmState | null) {
  return Boolean(
    pendingConfirm
    && run.id === pendingConfirm.runId
    && (run.status === 'paused' || run.status === 'running')
    && Array.isArray(run.nodes)
    && run.nodes.some(node => node.id === pendingConfirm.nodeId && node.status === 'waiting')
  )
}

function isLiveRunStatus(status: RunStatus) {
  return status === 'running' || status === 'paused'
}

function clearRunSessionState(s: WorkflowState, runId: string) {
  const shouldClearRunnerSession =
    s.runnerSession?.runId === runId
    || (!s.runnerSession?.runId && s.activeRuns.length <= 1 && s.activeRuns.some(run => run.id === runId))

  return {
    pendingConfirm: s.pendingConfirm?.runId === runId ? null : s.pendingConfirm,
    pendingAutoFix: s.pendingAutoFix?.runId === runId ? null : s.pendingAutoFix,
    runnerSession: shouldClearRunnerSession ? null : s.runnerSession,
  }
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  activeRuns: [],
  pendingConfirm: null,
  pendingAutoFix: null,
  runnerSession: null,
  logScrollStates: {},
  activeFiles: {},

  setActiveRuns: (runs) => set(s => {
    const liveRuns = runs.filter(run => isLiveRunStatus(run.status))
    const restoredPendingConfirm = liveRuns.map(getPendingConfirmFromRun).find(Boolean) ?? null
    const keepExistingPendingConfirm = liveRuns.some(run => hasWaitingConfirm(run, s.pendingConfirm))
    return {
      activeRuns: liveRuns,
      pendingConfirm: keepExistingPendingConfirm ? s.pendingConfirm : restoredPendingConfirm,
    }
  }),

  upsertRun: (run) => set(s => {
    if (!isLiveRunStatus(run.status)) {
      return {
        activeRuns: s.activeRuns.filter(r => r.id !== run.id),
        ...clearRunSessionState(s, run.id),
      }
    }

    const idx = s.activeRuns.findIndex(r => r.id === run.id)
    const restoredPendingConfirm = getPendingConfirmFromRun(run)
    if (idx >= 0) {
      const next = [...s.activeRuns]
      next[idx] = run
      return {
        activeRuns: next,
        pendingConfirm: restoredPendingConfirm ?? s.pendingConfirm,
      }
    }
    return {
      activeRuns: [...s.activeRuns, run],
      pendingConfirm: restoredPendingConfirm ?? s.pendingConfirm,
    }
  }),

  setRunStatus: (runId, status, roundId) => set(s => {
    if (!isLiveRunStatus(status)) {
      return {
        activeRuns: s.activeRuns.filter(r => r.id !== runId),
        ...clearRunSessionState(s, runId),
      }
    }

    return {
      activeRuns: s.activeRuns.map(r => r.id !== runId ? r : updateRunRoundStatus(r, status, roundId)),
      pendingConfirm: s.pendingConfirm,
      runnerSession: s.runnerSession,
    }
  }),

  appendLog: (runId, nodeId, line, roundId) => set(s => ({
    activeRuns: s.activeRuns.map(r =>
      r.id !== runId ? r : updateRunNodes(r, roundId, n =>
          n.id !== nodeId || n.logs[n.logs.length - 1] === line ? n : (() => {
            const nextLogs = [...n.logs, line]
            return {
              ...n,
              logs: nextLogs.slice(-CLIENT_NODE_LOG_WINDOW),
              logCount: (n.logCount ?? n.logs.length) + 1,
            }
          })()
        )
    )
  })),

  setNodeStatus: (runId, nodeId, status, timing) => set(s => ({
    activeRuns: s.activeRuns.map(r =>
      r.id !== runId ? r : updateRunNodes(r, timing?.roundId, n => {
          if (n.id !== nodeId) return n
          const now = Date.now()
          return {
            ...n,
            status,
            startedAt: timing?.startedAt ?? n.startedAt ?? (status === 'running' ? now : undefined),
            finishedAt: timing?.finishedAt ?? n.finishedAt ?? (status === 'completed' || status === 'failed' || status === 'waiting' ? now : undefined),
          }
        })
    )
  })),

  completeRun: (runId) => set(s => ({
    activeRuns: s.activeRuns.filter(r => r.id !== runId),
    ...clearRunSessionState(s, runId),
  })),

  failRun: (runId, _nodeId, _exitCode) => set(s => ({
    activeRuns: s.activeRuns.filter(r => r.id !== runId),
    ...clearRunSessionState(s, runId),
  })),

  setPendingConfirm: (data) => set({ pendingConfirm: data }),
  setPendingAutoFix: (data) => set({ pendingAutoFix: data }),
  setRunnerSession: (session) => set({ runnerSession: session }),
  setLogScrollState: (key, state) => set(s => ({
    logScrollStates: { ...s.logScrollStates, [key]: state },
  })),

  setFileActivity: (runId, path, active) => set(state => {
    const prev = state.activeFiles[runId] ?? new Set<string>()
    const next = new Set(prev)
    if (active) next.add(path)
    else next.delete(path)
    return { activeFiles: { ...state.activeFiles, [runId]: next } }
  }),

  clearActiveFiles: (runId) => set(state => {
    const next = { ...state.activeFiles }
    delete next[runId]
    return { activeFiles: next }
  }),

  reset: () => set({ activeRuns: [], pendingConfirm: null, pendingAutoFix: null, runnerSession: null, logScrollStates: {}, activeFiles: {} }),
}))
