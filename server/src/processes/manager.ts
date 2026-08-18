import { spawn, ChildProcess } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import type { CodeContext, SavedAttachment, TaskAttachment } from '@agent-dashboard/shared'

type LogCallback = (nodeId: string, line: string) => void
type CompleteCallback = (nodeId: string, exitCode: number) => void

interface ProcessEntry {
  proc: ChildProcess
  nodeId: string
  timers: NodeJS.Timeout[]
}

interface ProcessManagerOptions {
  maxRunMs?: number
}

const DEFAULT_MAX_RUN_MS = 600_000

export class ProcessManager {
  private processes = new Map<string, ProcessEntry>() // key: `${runId}:${nodeId}`
  private workspaceRoot: string
  private claudeBin: string
  private maxRunMs: number

  constructor(workspaceRoot: string, claudeBin = 'claude', options: ProcessManagerOptions = {}) {
    this.workspaceRoot = workspaceRoot
    this.claudeBin = claudeBin
    this.maxRunMs = options.maxRunMs ?? DEFAULT_MAX_RUN_MS
  }

  materializeAttachments(projectDir: string, attachments: TaskAttachment[]): SavedAttachment[] {
    if (attachments.length === 0) return []

    const attachmentDir = join(this.workspaceRoot, projectDir, '.dashboard-attachments')
    mkdirSync(attachmentDir, { recursive: true })

    return attachments.map((attachment, index) => {
      const safeName = basename(attachment.name).replace(/[^a-zA-Z0-9._-]+/g, '-')
      const fileName = `${String(index + 1).padStart(2, '0')}-${safeName || 'attachment'}`
      const filePath = join(attachmentDir, fileName)
      writeFileSync(filePath, Buffer.from(attachment.contentBase64, 'base64'))
      return {
        name: attachment.name,
        mime: attachment.mime,
        path: filePath,
      }
    })
  }

  spawn(
    runId: string,
    nodeId: string,
    agentType: string,
    agentName: string,
    prompt: string,
    codeContext: CodeContext[],
    attachments: SavedAttachment[],
    projectDir: string,      // workspace sub-directory (projectName or runId as fallback)
    onLog: LogCallback,
    onComplete: CompleteCallback
  ): void {
    const runDir = join(this.workspaceRoot, projectDir)
    mkdirSync(runDir, { recursive: true })

    const fullPrompt = this.buildPrompt(agentType, agentName, prompt, codeContext, attachments, runDir)
    const args = this.claudeBin === 'claude'
      ? this.buildArgs(agentType, agentName, fullPrompt)
      : [fullPrompt]  // test mode: pass prompt as first arg

    const proc = spawn(this.claudeBin, args, {
      cwd: runDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const key = `${runId}:${nodeId}`
    const timers: NodeJS.Timeout[] = []
    this.processes.set(key, { proc, nodeId, timers })

    if (this.maxRunMs > 0) {
      timers.push(setTimeout(() => {
        if (!this.processes.has(key)) return
        proc.kill('SIGTERM')
      }, this.maxRunMs))
    }

    const handleData = (data: Buffer) => {
      data.toString().split('\n').filter(Boolean).forEach(line => onLog(nodeId, line))
    }

    proc.stdout?.on('data', handleData)
    proc.stderr?.on('data', handleData)

    proc.on('close', (code) => {
      timers.forEach(timer => clearTimeout(timer))
      this.processes.delete(key)
      onComplete(nodeId, code ?? 1)
    })
  }

  kill(runId: string, nodeId: string): void {
    const entry = this.processes.get(`${runId}:${nodeId}`)
    if (entry) {
      entry.timers.forEach(timer => clearTimeout(timer))
      entry.proc.kill('SIGTERM')
    }
  }

  killAll(): void {
    this.processes.forEach(({ proc, timers }) => {
      timers.forEach(timer => clearTimeout(timer))
      proc.kill('SIGTERM')
    })
    this.processes.clear()
  }

  getRunningCount(): number {
    return this.processes.size
  }

  private buildArgs(agentType: string, agentName: string, prompt: string): string[] {
    const base = ['--permission-mode', 'auto', '-p', prompt]
    if (agentType === 'custom') {
      return ['--agent', agentName, ...base]
    }
    // omc agents: no --agent flag; OMC context is available via CLAUDE.md
    return base
  }

  private static readonly PROJECT_ROOT_SUBDIR = 'workspace/project'

  private getCustomAgentSubdir(agentName: string): string | null {
    switch (agentName) {
      case 'frontend-dev': return `${ProcessManager.PROJECT_ROOT_SUBDIR}/client`
      case 'backend-dev':  return `${ProcessManager.PROJECT_ROOT_SUBDIR}/server`
      case 'flutter-dev':  return `${ProcessManager.PROJECT_ROOT_SUBDIR}/app`
      default:             return null
    }
  }

  private buildPrompt(agentType: string, agentName: string, prompt: string, codeContext: CodeContext[], attachments: SavedAttachment[], runDir: string): string {
    const sections: string[] = []

    if (agentType === 'omc') {
      sections.push([
        '# Agent 角色',
        `当前节点 Agent: ${agentName}`,
        '请以该 Agent 的职责完成本节点任务；如果本地 OMC/CLAUDE.md 提供对应角色约束，请遵循该角色。',
      ].join('\n'))
    }

    if (agentType === 'custom') {
      const subdir = this.getCustomAgentSubdir(agentName) ?? `${ProcessManager.PROJECT_ROOT_SUBDIR}/${agentName}`
      const workDir = join(runDir, subdir)
      sections.push([
        '# 工作目录约束（必读，最高优先级）',
        `WORK_DIR = ${workDir}`,
        `WORK_DIR_NAME = ${subdir.split('/').pop()}`,
        '',
        `当前 shell 的 cwd 已经是 ${runDir}。`,
        '所有文件读写、shell 命令必须在 WORK_DIR 内执行。',
        '写入或创建任何文件前，必须先确认目标的绝对路径以 WORK_DIR 为前缀；',
        '严禁写入到家目录、根目录、/tmp 或 WORK_DIR 之外的任何位置（包括 ~ 和 / 起始的绝对路径）。',
        '若 WORK_DIR 不存在，先按 agent 模板里的 Initialization 步骤在 WORK_DIR 路径下创建项目骨架，再开始任务。',
        '本约束覆盖 agent 模板中的 {WORK_DIR} 占位符 —— 请将上面给出的 WORK_DIR 视为模板里所有 {WORK_DIR} 的实际值。',
      ].join('\n'))
    }

    if (codeContext.length > 0) {
      const ctx = codeContext
        .map(c => `- ${c.path}${c.type === 'directory' ? '/' : ''}\n  ${c.description}`)
        .join('\n')
      sections.push(`# 已有代码上下文\n${ctx}`)
    }

    if (attachments.length > 0) {
      const list = attachments
        .map(attachment => `- ${attachment.name} (${attachment.mime || 'application/octet-stream'})\n  本地路径: ${attachment.path}`)
        .join('\n')
      sections.push(`# 附件\n${list}`)
    }

    sections.push(`# 任务\n${prompt}`)
    return sections.join('\n\n')
  }
}
