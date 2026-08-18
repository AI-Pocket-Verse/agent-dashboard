import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TaskForm from '../../src/components/TaskForm/index'

describe('TaskForm keyboard submit', () => {
  it('submits when pressing Enter in the create prompt editor', async () => {
    const onSubmit = vi.fn()
    render(<TaskForm agents={[]} templates={[]} onSubmit={onSubmit} />)

    const editor = screen.getByRole('textbox')
    editor.textContent = '实现一个登录页面'
    fireEvent.input(editor)
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter' })

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      mode: 'ai',
      prompt: '实现一个登录页面',
      requireConfirm: true,
    })
  })
})
