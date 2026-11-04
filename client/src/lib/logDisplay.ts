import type { SystemLogCode } from '@agent-dashboard/shared'
import { t } from './i18n'

// 服务端系统行格式：`[system:<code>] <English text>`（见 server/src/systemLog.ts）。
// 每个 code 对应一条英文行的解析规则和中文文案 key（EN 词典里即为服务端的英文原文）。
const SYSTEM_LINE = /^\[system:([a-z_]+)\] ([\s\S]*)$/

// 键必须覆盖 shared 的 SYSTEM_LOG_CODES（类型强制），只按自有键查找，避免 __proto__ 等原型键
const SYSTEM_RENDERERS: Record<SystemLogCode, (text: string) => string | null> = {
  run_timeout: text => {
    const m = /^Stopped after exceeding the ([\d.]+) (min|s) limit\. Adjust MAX_RUN_MINUTES to change it\.$/.exec(text)
    if (!m) return null
    const duration = m[2] === 'min' ? t('{n} 分钟', { n: m[1] }) : t('{n} 秒', { n: m[1] })
    return t('运行时间超过上限（{duration}），已终止。可通过 MAX_RUN_MINUTES 调整。', { duration })
  },
  spawn_failed: text => {
    const m = /^Cannot start claude \((.+?)\): ([\s\S]+)\. Check CLAUDE_BIN or PATH\.$/.exec(text)
    return m ? t('无法启动 claude（{code}）：{bin}，请检查 CLAUDE_BIN 或 PATH。', { code: m[1], bin: m[2] }) : null
  },
  interrupted: text => text === 'Service restarted; execution interrupted.' ? t('服务重启，执行已中断') : null,
  user_note: text => {
    const m = /^User confirmation note: ([\s\S]*)$/.exec(text)
    return m ? t('用户确认补充：{text}', { text: m[1] }) : null
  },
  run_terminated: text => text === 'Workflow terminated.' ? t('流程已终止') : null,
}

// 把系统行渲染成当前语言；未知 code、无法解析的行和普通输出（含老数据的 `[系统]` 中文行）原样返回
export function localizeSystemLine(line: string): string {
  const m = SYSTEM_LINE.exec(line)
  if (!m) return line
  const code = m[1]
  if (!Object.hasOwn(SYSTEM_RENDERERS, code)) return line
  const body = SYSTEM_RENDERERS[code as SystemLogCode](m[2])
  return body === null || body === undefined ? line : `${t('[系统]')} ${body}`
}

export function compactConsecutiveLogs(logs: string[]) {
  return logs.filter((line, index) => index === 0 || line !== logs[index - 1])
}

export function compactAdjacentLogBlocks(logs: string[]) {
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

  // 展示时再本地化系统行（压缩按原始行比较，不受语言影响）
  return result.map(localizeSystemLine)
}

export function getRecentCompactLogs(logs: string[], limit = 120) {
  const safeLimit = Math.max(1, limit)
  const scanWindowSize = Math.min(logs.length, safeLimit * 4)
  return compactAdjacentLogBlocks(logs.slice(-scanWindowSize)).slice(-safeLimit)
}
