// 服务端写入节点日志、面向用户展示的系统提示：统一为稳定的英文行 `[system:<code>] <English text>`。
// 前端按 code 渲染成当前语言（client/src/lib/logDisplay.ts），未知 code 原样显示英文。

import { SYSTEM_LOG_CODES, type SystemLogCode } from '@agent-dashboard/shared'

// 旧版本写入的中文前缀，历史数据里仍存在
const LEGACY_SYSTEM_PREFIX = '[系统]'
const KNOWN_SYSTEM_LINE = new RegExp(`^\\[system:(?:${SYSTEM_LOG_CODES.join('|')})\\] `)

export function systemLine(code: SystemLogCode, text: string): string {
  return `[system:${code}] ${text}`
}

// 系统行（白名单编码或旧中文前缀）不进入下游提示词；agent 输出里其他 `[system:...]` 行保留
export function isSystemLogLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith(LEGACY_SYSTEM_PREFIX) || KNOWN_SYSTEM_LINE.test(trimmed)
}
