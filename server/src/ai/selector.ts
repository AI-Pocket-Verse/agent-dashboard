import { spawn, type ChildProcess } from 'child_process'
import type { AiSelectResponse, AgentInfo } from '@agent-dashboard/shared'
import { config } from '../config.js'
import { killProcessGroup, processGroupSpawnOptions } from '../processes/processGroup.js'

interface ProcessResult {
  stdout: string
  stderr: string
  status: number | null
  timedOut: boolean
}

interface AiSelectorOptions {
  claudeBin?: string
  timeoutMs?: number
  killGraceMs?: number
}

function getProcessOutput(result: { stdout?: string | null; stderr?: string | null }) {
  return [result.stderr, result.stdout]
    .map(output => output?.trim())
    .filter((output): output is string => Boolean(output))
    .join('\n')
}

const activeChildren = new Set<ChildProcess>()

// 异步运行 claude：规划可能要几十秒到几分钟，不能阻塞事件循环（日志推送、HTTP、WS 都依赖它）
function runClaude(bin: string, args: string[], timeoutMs: number, killGraceMs: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...processGroupSpawnOptions })
    activeChildren.add(child)
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let forceKillTimer: NodeJS.Timeout | undefined
    const timer = setTimeout(() => {
      timedOut = true
      killProcessGroup(child)
      // 忽略 SIGTERM 时整组强杀，否则 close 不触发、请求永远挂起
      forceKillTimer = setTimeout(() => killProcessGroup(child, 'SIGKILL'), killGraceMs)
    }, timeoutMs)
    const clearTimers = () => {
      clearTimeout(timer)
      clearTimeout(forceKillTimer)
      activeChildren.delete(child)
    }

    child.stdout.setEncoding('utf-8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf-8').on('data', chunk => { stderr += chunk })
    child.on('error', err => {
      clearTimers()
      reject(err)
    })
    child.on('close', status => {
      clearTimers()
      resolve({ stdout, stderr, status, timedOut })
    })
  })
}

// 服务退出时结束仍在运行的规划进程（它们自成进程组，不会随服务一起收到信号）
export function killActiveSelections(): void {
  activeChildren.forEach(child => killProcessGroup(child))
  activeChildren.clear()
}

export class AiSelector {
  private claudeBin: string
  private timeoutMs: number
  private killGraceMs: number

  constructor(options: AiSelectorOptions = {}) {
    this.claudeBin = options.claudeBin ?? config.claudeBin
    this.timeoutMs = options.timeoutMs ?? config.aiSelectTimeoutMs
    this.killGraceMs = options.killGraceMs ?? 5_000
  }

  async selectAgents(task: string, availableAgents: AgentInfo[]): Promise<AiSelectResponse> {
    const agentList = availableAgents.map(a => `- ${a.name} (${a.type}): ${a.description}`).join('\n')

    const prompt = [
      'You are an AI team orchestrator.',
      'Given a task description and available agents, select appropriate agents and define execution order as a DAG.',
      'Return ONLY valid JSON, no markdown, no explanation outside JSON.',
      '',
      `Task: ${task}`,
      '',
      'Available agents:',
      agentList,
      '',
      'Return JSON format: { "nodes": [{"id": string, "agentName": string, "agentType": "custom"|"omc", "promptTemplate": string}], "edges": [{"from": string, "to": string}], "explanation": string }',
    ].join('\n')

    const result = await runClaude(this.claudeBin, ['-p', prompt], this.timeoutMs, this.killGraceMs)

    if (result.timedOut) {
      throw new Error(`AI selection timed out after ${this.timeoutMs / 1000}s (AI_SELECT_TIMEOUT_MS)`)
    }
    if (result.status !== 0) {
      throw new Error(getProcessOutput(result) || `AI selector exited with status ${result.status}`)
    }

    const output = result.stdout

    // Extract JSON from output (claude may add surrounding text)
    const match = output.match(/\{[\s\S]*\}/)
    if (!match) throw new Error(getProcessOutput(result) || 'No JSON found in claude output')
    const parsed = JSON.parse(match[0]) as AiSelectResponse
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
      throw new Error('至少需要选择一个 Agent')
    }
    if (!Array.isArray(parsed.edges)) {
      throw new Error('AI selector returned invalid edges')
    }
    return parsed
  }
}
