import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConfirmCard from '../../src/components/ConfirmCard/index'

describe('ConfirmCard', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows only cancel and confirm actions with an optional instruction input', () => {
    const { container } = render(
      <ConfirmCard
        runId="run-1"
        nodeId="node-1"
        agentName="planner"
        summary={'第一行\n第二行'}
        nextNodeIds={['coder']}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: '终止' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '修改任务' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('可选：补充给后续 Agent 的要求...')).toBeInTheDocument()
  })

  it('passes manual instructions when confirming', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmCard
        runId="run-1"
        nodeId="node-1"
        agentName="planner"
        summary="已完成当前步骤"
        nextNodeIds={[]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('可选：补充给后续 Agent 的要求...'), {
      target: { value: '后续步骤请优先修改 RunnerPage' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    expect(onConfirm).toHaveBeenCalledWith('run-1', 'node-1', '后续步骤请优先修改 RunnerPage')
  })

  it('disables continuing until a rate-limit reset countdown finishes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-28T05:09:00.000Z'))
    const onConfirm = vi.fn()

    render(
      <ConfirmCard
        runId="run-1"
        nodeId="node-1"
        agentName="planner"
        summary="You've hit your limit · resets 1:10am (America/New_York)"
        nextNodeIds={[]}
        rateLimitWait={{
          resetAt: new Date('2026-04-28T05:10:00.000Z').getTime(),
          timeZone: 'America/New_York',
          resetLabel: '1:10am',
        }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText(/额度限制/)).toBeInTheDocument()
    expect(screen.getByText('重置时间 01:10 (America/New_York)')).toBeInTheDocument()
    expect(screen.queryByText(/剩余/)).not.toBeInTheDocument()
    const continueButton = screen.getByRole('button', { name: '确认 (01:00)' })
    expect(continueButton).toBeDisabled()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onConfirm).toHaveBeenCalledWith('run-1', 'node-1', undefined)
  })
})
