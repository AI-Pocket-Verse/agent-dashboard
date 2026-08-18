import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import LogStream from '../../src/components/LogStream/index'

const apiMocks = vi.hoisted(() => ({
  getRunNodeLogs: vi.fn(),
}))

vi.mock('../../src/lib/api', () => ({
  api: {
    getRunNodeLogs: (...args: unknown[]) => apiMocks.getRunNodeLogs(...args),
  },
}))

describe('LogStream', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    apiMocks.getRunNodeLogs.mockReset()
  })

  it('compacts duplicate consecutive log lines and keeps the content scrollable', () => {
    const { container } = render(
      <LogStream
        agentName="planner"
        status="completed"
        logs={[
          "I've explored the project thoroughly. Here's what I found:",
          "I've explored the project thoroughly. Here's what I found:",
          'Existing system',
        ]}
      />
    )

    const logText = container.querySelector('.font-mono')?.textContent ?? ''

    expect(logText.match(/I've explored the project thoroughly\. Here's what I found:/g)).toHaveLength(1)
    expect(logText).toContain('Existing system')
    expect(container.querySelector('.font-mono')).toHaveClass('overflow-y-auto', 'max-h-[70vh]')
  })


  it('auto-loads older log pages on mount for large restored snapshots', async () => {
    apiMocks.getRunNodeLogs.mockResolvedValue({
      items: ['line 0', 'line 1'],
      start: 0,
      total: 4,
      nextBefore: null,
    })

    const { container } = render(
      <LogStream
        runId="run-1"
        nodeId="node-1"
        agentName="planner"
        status="completed"
        logs={['line 2', 'line 3']}
        logCount={4}
      />
    )

    await waitFor(() => expect(apiMocks.getRunNodeLogs).toHaveBeenCalledWith('run-1', 'node-1', { before: 2, limit: 200 }))
    await waitFor(() => expect(container.querySelector('.font-mono')?.textContent).toContain('line 0'))
  })

  it('compacts duplicate adjacent log blocks in the right-side log panel', () => {
    const { container } = render(
      <LogStream
        agentName="planner"
        status="completed"
        logs={[
          '第一段需求分析',
          '第二段系统现状',
          '第一段需求分析',
          '第二段系统现状',
        ]}
      />
    )

    const logText = container.querySelector('.font-mono')?.textContent ?? ''

    expect(logText).toBe('第一段需求分析\n第二段系统现状')
  })
})
