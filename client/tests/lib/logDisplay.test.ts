import { afterEach, describe, expect, it } from 'vitest'
import { compactAdjacentLogBlocks, getRecentCompactLogs, localizeSystemLine } from '../../src/lib/logDisplay'
import { useLocaleStore } from '../../src/lib/i18n'

describe('log display helpers', () => {
  it('leaves lines with prototype-like or unknown codes untouched instead of crashing', () => {
    expect(() => localizeSystemLine('[system:__proto__] x')).not.toThrow()
    expect(localizeSystemLine('[system:__proto__] x')).toBe('[system:__proto__] x')
    expect(localizeSystemLine('[system:constructor] x')).toBe('[system:constructor] x')
    expect(localizeSystemLine('[system:toString] x')).toBe('[system:toString] x')
  })

  it('compacts only the recent bounded log window before rendering restored snapshots', () => {
    const logs = [
      ...Array.from({ length: 1000 }, (_, index) => `old log ${index}`),
      'recent one',
      'recent two',
      'recent one',
      'recent two',
      'recent three',
    ]

    expect(getRecentCompactLogs(logs, 3)).toEqual([
      'recent one',
      'recent two',
      'recent three',
    ])
  })
})

describe('system log localization', () => {
  const timeout = '[system:run_timeout] Stopped after exceeding the 30 min limit. Adjust MAX_RUN_MINUTES to change it.'
  const spawnFailed = '[system:spawn_failed] Cannot start claude (ENOENT): /opt/bin/claude. Check CLAUDE_BIN or PATH.'
  const interrupted = '[system:interrupted] Service restarted; execution interrupted.'
  const note = '[system:user_note] User confirmation note: focus on RunnerPage'
  const terminated = '[system:run_terminated] Workflow terminated.'

  afterEach(() => useLocaleStore.setState({ locale: 'zh' }))

  it('renders known codes in Chinese with parsed parameters', () => {
    useLocaleStore.setState({ locale: 'zh' })
    expect(localizeSystemLine(timeout)).toBe('[系统] 运行时间超过上限（30 分钟），已终止。可通过 MAX_RUN_MINUTES 调整。')
    expect(localizeSystemLine('[system:run_timeout] Stopped after exceeding the 0.05 s limit. Adjust MAX_RUN_MINUTES to change it.'))
      .toBe('[系统] 运行时间超过上限（0.05 秒），已终止。可通过 MAX_RUN_MINUTES 调整。')
    expect(localizeSystemLine(spawnFailed)).toBe('[系统] 无法启动 claude（ENOENT）：/opt/bin/claude，请检查 CLAUDE_BIN 或 PATH。')
    expect(localizeSystemLine(interrupted)).toBe('[系统] 服务重启，执行已中断')
    expect(localizeSystemLine(note)).toBe('[系统] 用户确认补充：focus on RunnerPage')
    expect(localizeSystemLine(terminated)).toBe('[系统] 流程已终止')
  })

  it('renders known codes in English as the original server text', () => {
    useLocaleStore.setState({ locale: 'en' })
    expect(localizeSystemLine(timeout)).toBe('[system] Stopped after exceeding the 30 min limit. Adjust MAX_RUN_MINUTES to change it.')
    expect(localizeSystemLine(spawnFailed)).toBe('[system] Cannot start claude (ENOENT): /opt/bin/claude. Check CLAUDE_BIN or PATH.')
    expect(localizeSystemLine(interrupted)).toBe('[system] Service restarted; execution interrupted.')
    expect(localizeSystemLine(note)).toBe('[system] User confirmation note: focus on RunnerPage')
    expect(localizeSystemLine(terminated)).toBe('[system] Workflow terminated.')
  })

  it('leaves unknown codes, unparsable lines, legacy Chinese lines and normal output untouched', () => {
    useLocaleStore.setState({ locale: 'zh' })
    expect(localizeSystemLine('[system:brand_new] Something happened')).toBe('[system:brand_new] Something happened')
    expect(localizeSystemLine('[system:run_timeout] garbled')).toBe('[system:run_timeout] garbled')
    expect(localizeSystemLine('[系统] 服务重启，执行已中断')).toBe('[系统] 服务重启，执行已中断')
    expect(localizeSystemLine('plain agent output')).toBe('plain agent output')
  })

  it('localizes system lines when compacting logs for display', () => {
    useLocaleStore.setState({ locale: 'zh' })
    expect(compactAdjacentLogBlocks(['hello', terminated])).toEqual(['hello', '[系统] 流程已终止'])
  })
})
