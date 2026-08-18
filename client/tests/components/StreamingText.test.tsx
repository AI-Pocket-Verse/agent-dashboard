import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StreamingText from '../../src/components/StreamingText/index'

describe('StreamingText', () => {
  it('renders full text immediately without a typing delay', () => {
    const { container } = render(<StreamingText text="Planner 输出完整内容" speedMs={10} chunkSize={4} />)

    expect(screen.getByText('Planner 输出完整内容')).toBeInTheDocument()
    expect(container.querySelector('span')?.textContent).toBe('Planner 输出完整内容')
  })

  it('renders appended text immediately and triggers progress once per text change', () => {
    const onProgress = vi.fn()
    const { container, rerender } = render(<StreamingText text="第一段" speedMs={10} chunkSize={3} />)

    expect(screen.getByText('第一段')).toBeInTheDocument()

    rerender(<StreamingText text={'第一段\n第二段'} speedMs={10} chunkSize={3} onProgress={onProgress} />)

    expect(container.querySelector('span')?.textContent).toBe('第一段\n第二段')
    expect(onProgress).toHaveBeenCalled()
  })
})
