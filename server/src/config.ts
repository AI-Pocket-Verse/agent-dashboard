import 'dotenv/config'
import { join } from 'path'

function required(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

interface DurationOptions { unitMs: number; fallbackMs: number; allowZero: boolean }

// setTimeout 的上限；超过会被 Node 当成 1ms 立即触发
const MAX_TIMER_MS = 2 ** 31 - 1

// 读时长类环境变量：缺省、非法、负数回退默认值；0 仅在 allowZero 时表示「不限」，否则也回退默认值
export function readDurationMs(raw: string | undefined, { unitMs, fallbackMs, allowZero }: DurationOptions): number {
  if (raw === undefined || raw.trim() === '') return fallbackMs
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return fallbackMs
  if (value === 0) return allowZero ? 0 : fallbackMs
  return Math.min(value * unitMs, MAX_TIMER_MS)
}

const projectRoot = required('PROJECT_ROOT')

export const config = {
  // Empty secret = open local mode: HTTP/WS auth disabled, no login gate.
  // Any non-localhost deployment must set DASHBOARD_SECRET.
  secret: process.env.DASHBOARD_SECRET ?? '',
  projectRoot,
  workspaceRoot: process.env.WORKSPACE_ROOT ?? join(projectRoot, 'workspace'),
  claudeBin: process.env.CLAUDE_BIN ?? 'claude',
  port: parseInt(process.env.PORT ?? '3001', 10),
  // AI 选型 / 续轮规划调用 claude -p 的上限；冷启动慢的环境（插件、MCP 多）需要更长
  aiSelectTimeoutMs: readDurationMs(process.env.AI_SELECT_TIMEOUT_MS, { unitMs: 1, fallbackMs: 180_000, allowZero: false }),
  // 单个 agent 节点的最长运行时间，0 = 不限
  maxRunMs: readDurationMs(process.env.MAX_RUN_MINUTES, { unitMs: 60_000, fallbackMs: 30 * 60_000, allowZero: true }),
}
