import { api } from './api'
import { useWorkflowStore } from '../store/workflowStore'

// WS 每次连上（首次与重连）后对账：以服务端活跃列表为准替换本地，
// 并对「本地还在运行但服务端已不在活跃列表」的 run 补拉终态，补回断线期间错过的完成/失败事件。
// 任何请求失败都只静默放弃，下次重连再对。
// 只采用最近一次对账的结果：连续重连时，先发后到的旧响应直接作废
let latestReconcile = 0

export async function reconcileRuns(): Promise<void> {
  const reconcileId = ++latestReconcile
  const requestedAt = Date.now()
  let fetchedRuns
  try {
    fetchedRuns = await api.getActiveRuns()
  } catch {
    return
  }
  if (reconcileId !== latestReconcile) return

  // 响应到达时再取本地快照：请求期间新建的 run 若没被列表覆盖，会被下面的补拉救回来
  const store = useWorkflowStore.getState()
  // 请求发出后本地已经收到终态的 run，服务端快照里的「运行中」已过时，不能复活
  const serverRuns = fetchedRuns.filter(run => (store.endedRunAt[run.id] ?? 0) < requestedAt)
  const serverIds = new Set(serverRuns.map(run => run.id))
  const missingIds = store.activeRuns
    .filter(run => (run.status === 'running' || run.status === 'paused') && !serverIds.has(run.id))
    .map(run => run.id)
  if (store.pendingConfirm && !serverIds.has(store.pendingConfirm.runId) && !missingIds.includes(store.pendingConfirm.runId)) {
    missingIds.push(store.pendingConfirm.runId)
  }

  store.setActiveRuns(serverRuns)

  await Promise.all(missingIds.map(async id => {
    try {
      const finalRun = await api.getRun(id)
      if (reconcileId === latestReconcile) useWorkflowStore.getState().upsertRun(finalRun)
    } catch { /* 查不到终态：保持服务端权威列表，下次重连再对 */ }
  }))
}
