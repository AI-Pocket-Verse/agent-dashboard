import { v4 as uuid } from 'uuid'
import { resolve } from 'path'
import type { AutoFixOffer, NodeRun, Edge, WorkflowRun, WorkflowRound, WsServerMessage, RunWorkflowPayload, CreateTaskPayload, RunNodeLogsPage } from '@agent-dashboard/shared'
import type { ProcessManager } from '../processes/manager.js'
import type { PersistenceStore } from '../store/persistence.js'
import { getLogPage } from '../store/persistence.js'
import { FileWatcher } from './fileWatcher.js'

// ─── Auto-fix loop config ─────────────────────────────────────────────────────

export const MAX_AUTO_FIX_ROUNDS = 3
export const REVIEWER_AGENT_NAME = 'code-reviewer'

// Only strong signals: generic words like error/issue/问题 appear in almost every
// review transcript (including "no issues found") and caused false auto-fix offers.
const REVIEW_ISSUE_KEYWORDS = [
  'critical', 'must fix', 'blocker', 'vulnerab',
  '严重', '阻塞', '漏洞', '缺陷', '必须修复',
]

const FILE_PATH_REGEX = /(?:^|[\s`(\["])([\w./-]+\.(?:go|tsx?|jsx?|dart|sql|py|css|html?|md|ya?ml|json|toml))(?=[\s`)\]:,]|$)/gim

export function detectReviewIssues(text: string | undefined | null): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return REVIEW_ISSUE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))
}

export function extractAffectedPaths(text: string | undefined | null): string[] {
  if (!text) return []
  const found = new Set<string>()
  for (const match of text.matchAll(FILE_PATH_REGEX)) {
    const candidate = match[1].replace(/^[./]+/, '')
    if (candidate) found.add(candidate)
  }
  return Array.from(found)
}

export function suggestFixAgentByRule(paths: string[]): string | null {
  const has = (predicate: (p: string) => boolean) => paths.some(predicate)
  if (has(p => /(^|\/)client\//i.test(p) || /\.(tsx?|jsx?|css|html?)$/i.test(p))) return 'frontend-dev'
  if (has(p => /(^|\/)server\//i.test(p) || /\.(go|sql)$/i.test(p))) return 'backend-dev'
  if (has(p => /(^|\/)app\//i.test(p) || /\.dart$/i.test(p))) return 'flutter-dev'
  return null
}

function findLatestCompletedReviewerNode(round: WorkflowRound): NodeRun | null {
  for (let i = round.nodes.length - 1; i >= 0; i -= 1) {
    const node = round.nodes[i]
    if (node.status !== 'completed') continue
    if (node.agentName === REVIEWER_AGENT_NAME) return node
  }
  return null
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function getStartableNodes(nodes: NodeRun[], edges: Edge[]): string[] {
  return nodes
    .filter(n => n.status === 'pending' && isAllPrereqsDone(n.id, nodes, edges))
    .map(n => n.id)
}

export function getNodeDependencies(nodeId: string, edges: Edge[]): string[] {
  return edges.filter(e => e.to === nodeId).map(e => e.from)
}

export function isAllPrereqsDone(nodeId: string, nodes: NodeRun[], edges: Edge[]): boolean {
  const prereqs = getNodeDependencies(nodeId, edges)
  return prereqs.every(pid => nodes.find(n => n.id === pid)?.status === 'completed')
}

// globalPrompt：本轮用户需求，供模板里的 {{globalPrompt}} 占位符使用。
// 单次匹配两种占位符，避免替换进来的文本被再次解释。
export function interpolatePrompt(prompt: string, nodes: NodeRun[], globalPrompt = ''): string {
  return prompt.replace(/\{\{(?:globalPrompt|nodes\.([^.]+)\.output)\}\}/g, (match, nodeId?: string) => {
    if (nodeId === undefined) return globalPrompt
    const node = nodes.find(n => n.id === nodeId)
    return node?.output ?? match
  })
}

export function compactConsecutiveLogs(logs: string[]): string[] {
  return logs.filter((line, index) => index === 0 || line !== logs[index - 1])
}

export function compactAdjacentLogBlocks(logs: string[]): string[] {
  const compacted = compactConsecutiveLogs(logs)
  const result: string[] = []
  let index = 0

  while (index < compacted.length) {
    let skipped = false
    const maxBlockSize = Math.floor((compacted.length - index) / 2)

    for (let blockSize = maxBlockSize; blockSize >= 1; blockSize--) {
      const currentBlock = compacted.slice(index, index + blockSize)
      const nextBlock = compacted.slice(index + blockSize, index + blockSize * 2)
      if (currentBlock.length === nextBlock.length && currentBlock.every((line, offset) => line === nextBlock[offset])) {
        result.push(...currentBlock)
        index += blockSize * 2
        skipped = true
        break
      }
    }

    if (!skipped) {
      result.push(compacted[index])
      index++
    }
  }

  return result
}

export function getNodeOutputTranscript(logs: string[]): string {
  return compactAdjacentLogBlocks(logs)
    .filter(line => !line.trim().startsWith('[系统]'))
    .filter(line => line.trim())
    .slice(-120)
    .join('\n')
    .trim()
}

function assertUniqueAgentNamesInRun(nodes: Array<{ agentName: string }>): void {
  const seen = new Set<string>()
  for (const node of nodes) {
    const agentName = node.agentName.trim()
    if (!agentName) {
      throw new Error('Agent 名称不能为空')
    }
    if (seen.has(agentName)) {
      throw new Error(`同一个任务中不能重复使用 Agent: ${agentName}`)
    }
    seen.add(agentName)
  }
}

function assertWorkflowHasNodes(nodes: Array<{ agentName: string }>): void {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error('至少需要选择一个 Agent')
  }
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

function nextRoundId(run: WorkflowRun): string {
  return `round-${getRunRounds(run).length + 1}`
}

// ─── DAGEngine ────────────────────────────────────────────────────────────────

export class DAGEngine {
  private activeRuns = new Map<string, WorkflowRun>()
  private pendingAutoFix = new Map<string, AutoFixOffer>()
  private fileWatcher = new FileWatcher()

  constructor(
    private processManager: ProcessManager,
    private store: PersistenceStore,
    private broadcast: (msg: WsServerMessage) => void,
    private workspaceRoot: string = ''
  ) {}

  private persistSnapshot(run: WorkflowRun): void {
    void this.store.saveRun(run)
  }

  private getActiveRound(run: WorkflowRun): WorkflowRound {
    const rounds = getRunRounds(run)
    run.rounds = rounds
    const round = rounds.find(item => item.id === run.activeRoundId) ?? rounds[rounds.length - 1]
    run.activeRoundId = round.id
    run.nodes = round.nodes
    run.edges = round.edges
    return round
  }

  private setRunRoundStatus(run: WorkflowRun, status: WorkflowRun['status'], completedAt?: number): void {
    const round = this.getActiveRound(run)
    round.status = status
    if (completedAt !== undefined) round.completedAt = completedAt
    run.status = status
    if (completedAt !== undefined) run.completedAt = completedAt
  }

  private createRoundFromPayload(id: string, payload: RunWorkflowPayload, createdAt = Date.now()): WorkflowRound {
    return {
      id,
      prompt: payload.globalPrompt,
      status: 'running',
      nodes: payload.nodes.map(n => ({
        id: n.id,
        agentName: n.agentName,
        agentType: n.agentType,
        displayName: n.displayName,
        prompt: n.promptTemplate,
        codeContext: payload.codeContext ?? [],
        status: 'pending',
        logs: [],
      })),
      edges: payload.edges,
      createdAt,
    }
  }

  async startWorkflow(payload: RunWorkflowPayload): Promise<WorkflowRun> {
    assertWorkflowHasNodes(payload.nodes)
    assertUniqueAgentNamesInRun(payload.nodes)

    const runId = uuid()
    const workspacePath = `runs/${runId}/repo`
    const executionMode = payload.executionMode ?? 'serial'
    const attachments = this.processManager.materializeAttachments(workspacePath, payload.attachments ?? [])
    const round = this.createRoundFromPayload('round-1', payload)
    const run: WorkflowRun = {
      id: runId,
      // Display name: truncate so the History list stays legible; the full
      // request is preserved in `prompt` below.
      name: (payload.globalPrompt || payload.name).slice(0, 60),
      prompt: payload.globalPrompt,
      projectName: runId,
      workspacePath,
      status: 'running',
      nodes: round.nodes,
      edges: round.edges,
      rounds: [round],
      activeRoundId: round.id,
      attachments,
      requireConfirm: payload.requireConfirm ?? false,
      executionMode,
      createdAt: Date.now(),
    }

    this.activeRuns.set(run.id, run)
    await this.store.saveRun(run)
    this.advanceRun(run.id)
    return run
  }

  async continueWorkflow(runId: string, payload: RunWorkflowPayload): Promise<WorkflowRun> {
    assertWorkflowHasNodes(payload.nodes)
    assertUniqueAgentNamesInRun(payload.nodes)
    const existingRun = this.activeRuns.get(runId) ?? await this.store.loadRun(runId)
    if (!existingRun) {
      throw new Error('运行记录不存在')
    }
    const isAutoFixContinue = this.pendingAutoFix.has(runId)
    if (!isAutoFixContinue && (existingRun.status === 'running' || existingRun.status === 'paused')) {
      throw new Error('当前任务仍在运行中，不能开启新轮次')
    }

    const round = this.createRoundFromPayload(nextRoundId(existingRun), payload)
    const rounds = getRunRounds(existingRun)
    rounds.push(round)
    existingRun.rounds = rounds
    existingRun.activeRoundId = round.id
    existingRun.prompt = existingRun.prompt ?? payload.globalPrompt
    existingRun.status = 'running'
    existingRun.completedAt = undefined
    existingRun.nodes = round.nodes
    existingRun.edges = round.edges
    existingRun.requireConfirm = payload.requireConfirm ?? existingRun.requireConfirm
    existingRun.executionMode = payload.executionMode ?? existingRun.executionMode ?? 'serial'
    existingRun.attachments = existingRun.attachments ?? []

    if (isAutoFixContinue) {
      existingRun.autoFixRound = (existingRun.autoFixRound ?? 0) + 1
      this.pendingAutoFix.delete(runId)
    }

    this.activeRuns.set(existingRun.id, existingRun)
    await this.store.saveRun(existingRun)
    this.advanceRun(existingRun.id)
    return existingRun
  }

  declineAutoFix(runId: string): void {
    const offer = this.pendingAutoFix.get(runId)
    if (!offer) return
    this.pendingAutoFix.delete(runId)

    const run = this.activeRuns.get(runId)
    if (!run) return
    const roundId = this.getActiveRound(run).id
    this.setRunRoundStatus(run, 'completed', Date.now())
    this.activeRuns.delete(runId)
    this.broadcast({ type: 'workflow:status', payload: { runId, roundId, status: 'completed' } })
    this.broadcast({ type: 'task:completed', payload: { runId, roundId } })
    this.store.saveRun(run)
  }

  private maybeBuildAutoFixOffer(run: WorkflowRun, round: WorkflowRound): AutoFixOffer | null {
    const usedRounds = run.autoFixRound ?? 0
    if (usedRounds >= MAX_AUTO_FIX_ROUNDS) return null

    const reviewer = findLatestCompletedReviewerNode(round)
    if (!reviewer) return null
    if (!detectReviewIssues(reviewer.output)) return null

    const affectedPaths = extractAffectedPaths(reviewer.output).slice(0, 20)
    const ruleAgent = suggestFixAgentByRule(affectedPaths)
    return {
      runId: run.id,
      roundId: round.id,
      reviewerNodeId: reviewer.id,
      reviewerAgentName: reviewer.agentName,
      summary: reviewer.output ?? '',
      affectedPaths,
      suggestedAgent: ruleAgent,
      suggestionSource: ruleAgent ? 'rule' : 'ai-fallback',
      remainingBudget: MAX_AUTO_FIX_ROUNDS - usedRounds,
    }
  }

  async startSingleAgent(payload: CreateTaskPayload): Promise<WorkflowRun> {
    const nodeId = uuid()
    return this.startWorkflow({
      name: `${payload.agentName}: ${payload.prompt.slice(0, 50)}`,
      nodes: [{
        id: nodeId,
        agentName: payload.agentName,
        agentType: payload.agentType,
        promptTemplate: payload.prompt,
      }],
      edges: [],
      globalPrompt: payload.prompt,
      codeContext: payload.codeContext,
      attachments: payload.attachments,
      requireConfirm: payload.requireConfirm ?? false,
    })
  }

  confirmNode(runId: string, nodeId: string, instruction?: string): void {
    const run = this.activeRuns.get(runId)
    if (!run) return
    const roundId = this.getActiveRound(run).id
    const node = run.nodes.find(n => n.id === nodeId)
    if (node?.status === 'waiting') {
      const trimmedInstruction = instruction?.trim()
      if (trimmedInstruction) {
        const instructionBlock = `\n\n# 用户确认补充\n${trimmedInstruction}`
        const downstreamNodeIds = new Set(run.edges.filter(e => e.from === nodeId).map(e => e.to))
        run.nodes.forEach(nextNode => {
          if (downstreamNodeIds.has(nextNode.id) && nextNode.status === 'pending') {
            nextNode.prompt += instructionBlock
          }
        })
        node.logs.push(`用户确认补充：${trimmedInstruction}`)
        this.broadcast({ type: 'agent:log', payload: { runId, roundId, nodeId, line: `用户确认补充：${trimmedInstruction}` } })
      }
      node.status = 'completed'
      this.setRunRoundStatus(run, 'running')
      this.broadcast({ type: 'workflow:node_status', payload: { runId, roundId, nodeId, status: 'completed', finishedAt: node.finishedAt } })
      this.broadcast({ type: 'workflow:status', payload: { runId, roundId, status: 'running' } })
      this.persistSnapshot(run)
      this.advanceRun(runId)

      // 并行模式下可能有多个节点同时等待确认，而前端一次只显示一张确认卡：
      // 还有等待中的节点时保持 paused，并重新提示下一个
      const nextWaiting = run.nodes.find(n => n.status === 'waiting')
      if (nextWaiting && this.activeRuns.has(runId)) {
        this.setRunRoundStatus(run, 'paused')
        this.broadcast({ type: 'workflow:status', payload: { runId, roundId, status: 'paused' } })
        this.broadcastConfirmRequired(run, roundId, nextWaiting)
        this.persistSnapshot(run)
      }
    }
  }

  private broadcastConfirmRequired(run: WorkflowRun, roundId: string, node: NodeRun): void {
    const nextNodeIds = run.edges.filter(e => e.from === node.id).map(e => e.to)
    this.broadcast({
      type: 'task:confirm_required',
      payload: { runId: run.id, roundId, nodeId: node.id, summary: node.output ?? '', nextNodeIds },
    })
  }

  cancelRun(runId: string): void {
    const run = this.activeRuns.get(runId)
    if (!run) return
    const roundId = this.getActiveRound(run).id
    run.nodes
      .filter(n => n.status === 'running' || n.status === 'waiting')
      .forEach(n => {
        if (n.status === 'running') {
          this.processManager.kill(runId, n.id)
        }
        n.status = 'failed'
        n.finishedAt = Date.now()
        n.logs.push('流程已终止')
        this.broadcast({ type: 'agent:log', payload: { runId, roundId, nodeId: n.id, line: '流程已终止' } })
        this.broadcast({ type: 'workflow:node_status', payload: { runId, roundId, nodeId: n.id, status: 'failed', finishedAt: n.finishedAt } })
        this.persistSnapshot(run)
      })
    this.setRunRoundStatus(run, 'failed', Date.now())
    this.broadcast({ type: 'workflow:status', payload: { runId, roundId, status: 'failed' } })
    this.activeRuns.delete(runId)
    this.pendingAutoFix.delete(runId)
    this.fileWatcher.stop(runId)
    this.persistSnapshot(run)
  }

  private advanceRun(runId: string): void {
    const run = this.activeRuns.get(runId)
    if (!run) return
    const round = this.getActiveRound(run)
    const roundId = round.id

    const startableNodeIds = getStartableNodes(run.nodes, run.edges)
    if (startableNodeIds.length === 0 && run.nodes.every(n => n.status === 'completed')) {
      const autoFixOffer = this.maybeBuildAutoFixOffer(run, round)
      if (autoFixOffer) {
        this.pendingAutoFix.set(runId, autoFixOffer)
        this.setRunRoundStatus(run, 'paused')
        this.broadcast({ type: 'workflow:status', payload: { runId, roundId, status: 'paused' } })
        this.broadcast({ type: 'task:auto_fix_required', payload: autoFixOffer })
        this.persistSnapshot(run)
        return
      }

      this.setRunRoundStatus(run, 'completed', Date.now())
      this.activeRuns.delete(runId)
      this.pendingAutoFix.delete(runId)
      this.fileWatcher.stop(runId)
      this.store.saveRun(run)
      this.broadcast({ type: 'workflow:status', payload: { runId, roundId, status: 'completed' } })
      this.broadcast({ type: 'task:completed', payload: { runId, roundId } })
      return
    }

    const hasRunningNode = run.nodes.some(node => node.status === 'running')
    const toStart = (run.executionMode ?? 'serial') === 'dag' || !hasRunningNode
      ? (run.executionMode ?? 'serial') === 'dag' ? startableNodeIds : startableNodeIds.slice(0, 1)
      : []

    toStart.forEach(nodeId => {
      const node = run.nodes.find(n => n.id === nodeId)!
      node.status = 'running'
      node.startedAt = Date.now()
      const prompt = interpolatePrompt(node.prompt, run.nodes, round.prompt ?? run.prompt ?? '')

      this.broadcast({ type: 'workflow:node_status', payload: { runId, roundId, nodeId, status: 'running', startedAt: node.startedAt } })
      this.broadcast({ type: 'workflow:status', payload: { runId, roundId, status: 'running' } })
      this.persistSnapshot(run)

      const runDir = resolve(this.workspaceRoot, run.workspacePath ?? run.projectName ?? runId)
      this.fileWatcher.start(runId, runDir, (path, active) => {
        this.broadcast({ type: 'file:activity', payload: { runId, path, active } })
      })

      this.processManager.spawn(
        runId, nodeId, node.agentType, node.agentName, prompt, node.codeContext, run.attachments ?? [],
        run.workspacePath ?? run.projectName ?? runId,
        (nid, line) => this.handleLog(runId, roundId, nid, line),
        (nid, exitCode) => this.handleNodeComplete(runId, roundId, nid, exitCode)
      )
    })
  }

  private handleLog(runId: string, roundId: string, nodeId: string, line: string): void {
    const run = this.activeRuns.get(runId)
    if (!run || this.getActiveRound(run).id !== roundId) return
    const node = run.nodes.find(n => n.id === nodeId)
    if (node) {
      if (node.logs[node.logs.length - 1] === line) return
      node.logs.push(line)
      this.persistSnapshot(run)
    }
    this.broadcast({ type: 'agent:log', payload: { runId, roundId, nodeId, line } })
  }

  private async handleNodeComplete(runId: string, roundId: string, nodeId: string, exitCode: number): Promise<void> {
    const run = this.activeRuns.get(runId)
    if (!run || this.getActiveRound(run).id !== roundId) return
    const node = run.nodes.find(n => n.id === nodeId)
    if (!node) return

    node.finishedAt = Date.now()

    if (exitCode !== 0) {
      node.status = 'failed'
      this.setRunRoundStatus(run, 'failed', node.finishedAt)
      this.broadcast({ type: 'workflow:node_status', payload: { runId, roundId, nodeId, status: 'failed', finishedAt: node.finishedAt } })
      this.broadcast({ type: 'workflow:status', payload: { runId, roundId, status: 'failed' } })
      this.broadcast({
        type: 'task:error',
        payload: { runId, roundId, nodeId, exitCode, lastLines: node.logs.slice(-5) }
      })
      this.activeRuns.delete(runId)
      this.fileWatcher.stop(runId)
      await this.store.saveRun(run)
      return
    }

    node.output = getNodeOutputTranscript(node.logs)

    if (run.requireConfirm) {
      node.status = 'waiting'
      this.setRunRoundStatus(run, 'paused')
      this.broadcast({ type: 'workflow:node_status', payload: { runId, roundId, nodeId, status: 'waiting', finishedAt: node.finishedAt } })
      this.broadcast({ type: 'workflow:status', payload: { runId, roundId, status: 'paused' } })
      this.broadcastConfirmRequired(run, roundId, node)
    } else {
      node.status = 'completed'
      this.broadcast({ type: 'workflow:node_status', payload: { runId, roundId, nodeId, status: 'completed', finishedAt: node.finishedAt } })
      this.advanceRun(runId)
    }

    await this.store.saveRun(run)
  }

  getActiveRuns(): WorkflowRun[] {
    return Array.from(this.activeRuns.values())
  }

  getRunNodeLogs(runId: string, nodeId: string, options: { before?: number; limit?: number; roundId?: string } = {}): RunNodeLogsPage | null {
    const run = this.activeRuns.get(runId)
    if (!run) return null
    const round = options.roundId
      ? getRunRounds(run).find(item => item.id === options.roundId)
      : this.getActiveRound(run)
    const node = round?.nodes.find(item => item.id === nodeId)
    if (!node) return null
    return getLogPage(node.logs, options)
  }
}
