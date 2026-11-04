import { describe, expect, it } from 'vitest'
import { getNodeOutputTranscript } from '../src/workflows/engine.js'
import { isSystemLogLine, systemLine } from '../src/systemLog.js'

describe('system log lines', () => {
  it('only treats known system codes and the legacy prefix as system lines', () => {
    expect(isSystemLogLine(systemLine('run_timeout', 'Stopped.'))).toBe(true)
    expect(isSystemLogLine('[系统] 服务重启，执行已中断')).toBe(true)
    // agent 自己的输出恰好以 [system: 开头时，不能被当成系统行
    expect(isSystemLogLine('[system:foo] agent output')).toBe(false)
    expect(isSystemLogLine('[system:__proto__] x')).toBe(false)
  })

  it('keeps agent output that merely looks like a system line in the downstream transcript', () => {
    const transcript = getNodeOutputTranscript([
      'real output',
      '[system:foo] agent says this',
      systemLine('run_terminated', 'Workflow terminated.'),
    ])
    expect(transcript).toContain('[system:foo] agent says this')
    expect(transcript).not.toContain('run_terminated')
  })
})
