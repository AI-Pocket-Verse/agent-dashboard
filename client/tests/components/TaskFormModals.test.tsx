import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TaskForm from '../../src/components/TaskForm/index'
import type { AgentInfo, WorkflowTemplate } from '../../src/types/index'

// 文件浏览器依赖后端接口，这里用最小替身：点击即选中一个文件
vi.mock('../../src/components/FileBrowserDialog/index', () => ({
  default: ({ onSelect }: { onSelect: (item: { name: string; type: 'file'; path: string }) => void }) => (
    <button type="button" onClick={() => onSelect({ name: 'a.ts', type: 'file', path: '/p/a.ts' })}>
      pick-file
    </button>
  ),
}))

const templates: WorkflowTemplate[] = [
  { id: 't1', name: '模板甲', description: '', nodes: [], edges: [], createdAt: 1 },
]
const agents: AgentInfo[] = [
  { name: 'my-agent', type: 'custom', description: '', status: 'idle' },
  { name: 'planner', type: 'omc', description: '', status: 'idle' },
]

// 弹窗面板：最大高度不超过视口，列表区独立滚动，底部按钮不在滚动区内
const expectBoundedPanel = (heading: string, listItem: HTMLElement, footerButton: HTMLElement) => {
  const panel = screen.getByRole('heading', { name: heading }).closest('[class*="max-w-[760px]"]') as HTMLElement
  expect(panel.className).toContain('max-h-[calc(100dvh-2rem)]')
  expect(panel.className).toContain('flex-col')
  // 遮罩必须挂在 body 下：宿主页面的 transform 祖先会让 position:fixed 相对它定位，弹窗被裁出视口
  expect(panel.parentElement?.parentElement).toBe(document.body)

  const scroller = listItem.closest('.min-h-0.overflow-y-auto') as HTMLElement | null
  expect(scroller).not.toBeNull()
  expect(panel.contains(scroller)).toBe(true)
  expect(scroller!.contains(footerButton)).toBe(false)
}

describe('TaskForm modals stay inside the viewport', () => {
  it('template modal: list scrolls, confirm button stays outside the scroller', () => {
    render(<TaskForm agents={agents} templates={templates} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '模板' }))

    expectBoundedPanel('模板选择', screen.getByText('模板甲'), screen.getByRole('button', { name: '确认' }))
  })

  it('agent modal: lists scroll, confirm button stays outside the scroller', () => {
    render(<TaskForm agents={agents} templates={templates} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))

    expectBoundedPanel('Agent 选择', screen.getByText('my-agent'), screen.getByRole('button', { name: '确认' }))
  })

  it('code modal: list scrolls, done button stays outside the scroller', () => {
    render(<TaskForm agents={agents} templates={templates} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^代码/ }))

    const emptyHints = screen.getAllByText('还没有添加代码路径')
    expectBoundedPanel('代码选择', emptyHints[emptyHints.length - 1], screen.getByRole('button', { name: '完成' }))
  })
})

describe('TaskForm code path note input', () => {
  const openPendingContext = () => {
    render(<TaskForm agents={agents} templates={templates} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^代码/ }))
    fireEvent.click(screen.getByRole('button', { name: '+ 添加路径' }))
    fireEvent.click(screen.getByRole('button', { name: 'pick-file' }))
    return screen.getByPlaceholderText('补充说明（可选）...')
  }

  it('ignores Enter while an IME composition is active', () => {
    const input = openPendingContext()

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(screen.getByPlaceholderText('补充说明（可选）...')).toBeInTheDocument()
  })

  it('adds the path on a normal Enter', () => {
    const input = openPendingContext()

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.queryByPlaceholderText('补充说明（可选）...')).not.toBeInTheDocument()
  })
})
