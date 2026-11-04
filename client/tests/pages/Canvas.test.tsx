/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Canvas from '../../src/pages/Canvas'
import { api } from '../../src/lib/api'
import { BUILTIN_TEMPLATES } from '../../src/lib/builtinTemplates'
import { useAgentStore } from '../../src/store/agentStore'
import type { AgentInfo, WorkflowTemplate } from '../../src/types/index'

// 用 stub 替换 ReactFlow：只捕获最新 props，由测试按真实 ReactFlow 的调用方式触发回调
let rf: any
vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    ReactFlow: (props: any) => {
      rf = props
      return <div data-testid="rf" />
    },
    Controls: () => null,
    Background: () => null,
  }
})

vi.mock('../../src/lib/api', () => ({
  api: {
    getTemplates: vi.fn(),
    getAgents: vi.fn(),
    updateTemplate: vi.fn(),
    createTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    fsRoots: vi.fn(),
    fsBrowse: vi.fn(),
  },
}))

const agent = (name: string, type: 'custom' | 'omc'): AgentInfo => ({ name, type, description: '', status: 'idle' })
const STORE_AGENTS = [
  agent('other-agent', 'custom'),
  agent('my-agent', 'custom'),
  agent('planner', 'omc'),
  agent('writer', 'omc'),
]

const tplA: WorkflowTemplate = {
  id: 'tpl-a',
  name: '模板A',
  description: '',
  createdAt: 1,
  nodes: [
    { id: 'n1', agentName: 'planner', agentType: 'omc', promptTemplate: 'p1' },
    { id: 'n2', agentName: 'my-agent', agentType: 'custom', promptTemplate: '原提示词' },
    { id: 'n3', agentName: 'planner', agentType: 'omc', promptTemplate: 'p3' },
  ],
  edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
}
const tplB: WorkflowTemplate = {
  id: 'tpl-b',
  name: '模板B',
  description: '',
  createdAt: 2,
  nodes: [{ id: 'b1', agentName: 'writer', agentType: 'omc', promptTemplate: 'pb' }],
  edges: [],
}
const tplGhost: WorkflowTemplate = {
  id: 'tpl-ghost',
  name: '幽灵模板',
  description: '',
  createdAt: 3,
  nodes: [{ id: 'g1', agentName: 'ghost-agent', agentType: 'custom', promptTemplate: 'pg' }],
  edges: [],
}

const CYCLE_ERROR = '这条连线会形成环，工作流无法执行'
const DISCARD_TITLE = '放弃未保存草稿'

const setStoreAgents = (agents: AgentInfo[]) => {
  useAgentStore.setState({ agents })
  vi.mocked(api.getAgents).mockResolvedValue(agents)
}

const renderCanvas = () => render(<Canvas />)

const loadTemplate = async (name: RegExp) => {
  fireEvent.click(await screen.findByRole('button', { name }))
  await waitFor(() => expect(rf?.nodes?.length).toBeGreaterThan(0))
}

const fakeMouseEvent = { preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 10 }

const openNodeEditor = (nodeId: string) => {
  act(() => rf.onNodeContextMenu(fakeMouseEvent, rf.nodes.find((n: any) => n.id === nodeId)))
  fireEvent.click(screen.getByRole('button', { name: '编辑节点' }))
}

const openEdgeEditor = (edgeId: string) => {
  act(() => rf.onEdgeContextMenu(fakeMouseEvent, rf.edges.find((e: any) => e.id === edgeId)))
  fireEvent.click(screen.getByRole('button', { name: '编辑连线' }))
}

const connect = (source: string, target: string) =>
  act(() => rf.onConnect({ source, target, sourceHandle: null, targetHandle: null }))

// 按真实 ReactFlow 的键盘删除流程模拟：先问 deletable / onBeforeDelete，放行后才发 remove changes
const keyboardDelete = async (nodeIds: string[], edgeIds: string[]) => {
  const flow = rf
  // deleteKeyCode 为 null 时 ReactFlow 不会响应删除键
  if (flow.deleteKeyCode === null) return
  const targetNodeIds = nodeIds
  const targetEdgeIds = edgeIds
  const nodes = flow.nodes.filter((n: any) => targetNodeIds.includes(n.id))
  const edges = flow.edges.filter((e: any) => (
    targetEdgeIds.includes(e.id) || targetNodeIds.includes(e.source) || targetNodeIds.includes(e.target)
  ))
  if (nodes.length === 0 && edges.length === 0) return

  await act(async () => {
    let proceed = true
    if (flow.onBeforeDelete) {
      proceed = (await flow.onBeforeDelete({ nodes, edges })) !== false
    }
    if (proceed) {
      flow.onEdgesChange(edges.map((e: any) => ({ type: 'remove', id: e.id })))
      flow.onNodesChange(nodes.map((n: any) => ({ type: 'remove', id: n.id })))
    }
  })
}

beforeEach(() => {
  rf = undefined
  vi.mocked(api.getTemplates).mockResolvedValue([...BUILTIN_TEMPLATES, tplA, tplB, tplGhost])
  vi.mocked(api.updateTemplate).mockImplementation(async template => template)
  setStoreAgents(STORE_AGENTS)
})

describe('Canvas cycle prevention', () => {
  it('isValidConnection refuses connections that would close a cycle', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)

    expect(rf.isValidConnection({ source: 'n3', target: 'n1' })).toBe(false) // n1→n2→n3→n1
    expect(rf.isValidConnection({ source: 'n2', target: 'n1' })).toBe(false) // n1⇄n2
    expect(rf.isValidConnection({ source: 'n1', target: 'n3' })).toBe(true) // 前向捷径
  })

  it('onConnect does not add an edge that would form a cycle', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)

    connect('n3', 'n1')
    expect(rf.edges).toHaveLength(2)

    connect('n1', 'n3')
    expect(rf.edges).toHaveLength(3)
  })

  it('onReconnect refuses a replacement edge that would form a cycle', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)
    const oldEdge = rf.edges.find((e: any) => e.source === 'n2' && e.target === 'n3')

    act(() => rf.onReconnect(oldEdge, { source: 'n2', target: 'n1', sourceHandle: null, targetHandle: null }))

    expect(rf.edges.map((e: any) => `${e.source}>${e.target}`).sort()).toEqual(['n1>n2', 'n2>n3'])
  })

  it('onReconnect still accepts a valid replacement edge', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)
    const oldEdge = rf.edges.find((e: any) => e.source === 'n1' && e.target === 'n2')

    act(() => rf.onReconnect(oldEdge, { source: 'n1', target: 'n3', sourceHandle: null, targetHandle: null }))

    expect(rf.edges.map((e: any) => `${e.source}>${e.target}`).sort()).toEqual(['n1>n3', 'n2>n3'])
  })

  it('edge editor shows an error and disables confirm for a cycle, ignoring the edge being replaced', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)
    openEdgeEditor('e0') // n1→n2

    const [sourceSelect, targetSelect] = screen.getAllByRole('combobox')
    fireEvent.change(sourceSelect, { target: { value: 'n3' } }) // n3→n2，而 n2→n3 已存在
    expect(screen.getByText(CYCLE_ERROR)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()

    fireEvent.change(targetSelect, { target: { value: 'n1' } }) // n3→n1：被替换的 n1→n2 不再计入，无环
    expect(screen.queryByText(CYCLE_ERROR)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled()
  })
})

describe('Canvas duplicate node labels', () => {
  it('numbers same-named nodes in the edge editor selects and keeps unique names plain', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)
    openEdgeEditor('e0')

    const [sourceSelect, targetSelect] = screen.getAllByRole('combobox')
    const labels = (select: HTMLElement) => within(select).getAllByRole('option').map(option => option.textContent)
    expect(labels(sourceSelect)).toEqual(['planner #1', 'my-agent', 'planner #2'])
    expect(labels(targetSelect)).toEqual(['planner #1', 'my-agent', 'planner #2'])
  })
})

describe('Canvas agent options come from the agent store', () => {
  it('lists a custom and an OMC agent that share a name without React key collisions', async () => {
    setStoreAgents([
      { name: 'planner', type: 'custom', description: '', status: 'idle' },
      { name: 'planner', type: 'omc', description: '', status: 'idle' },
    ])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderCanvas()
    await loadTemplate(/^模板A/)
    fireEvent.click(screen.getByRole('button', { name: '添加节点' }))
    expect(screen.getAllByRole('button', { name: /planner/ }).length).toBeGreaterThanOrEqual(2)

    const duplicateKeyWarnings = consoleError.mock.calls.filter(args => String(args[0]).includes('same key'))
    consoleError.mockRestore()
    expect(duplicateKeyWarnings).toEqual([])
  })

  it('keeps a custom agent unchanged when only the display name is edited', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)
    openNodeEditor('n2')

    fireEvent.change(screen.getByPlaceholderText('选填，用于替代默认 Agent 名称展示'), { target: { value: '改名' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    const node = rf.nodes.find((n: any) => n.id === 'n2')
    expect(node.data.agentName).toBe('my-agent')
    expect(node.data.agentType).toBe('custom')
    expect(node.data.displayName).toBe('改名')
  })

  it('keeps an agent that is not in the list as an extra option and saves it unchanged', async () => {
    renderCanvas()
    await loadTemplate(/^幽灵模板/)
    openNodeEditor('g1')

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('ghost-agent')
    expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual(['other-agent', 'my-agent', 'ghost-agent'])

    fireEvent.change(screen.getByPlaceholderText('例如：基于 {{globalPrompt}} 继续完成这一部分'), { target: { value: '新提示词' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    const node = rf.nodes.find((n: any) => n.id === 'g1')
    expect(node.data.agentName).toBe('ghost-agent')
    expect(node.data.promptTemplate).toBe('新提示词')
  })

  it('picks the first store agent of a type only when the user switches the type', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)
    openNodeEditor('n2')
    const select = () => screen.getByRole('combobox') as HTMLSelectElement
    expect(within(select()).getAllByRole('option').map(o => o.textContent)).toEqual(['other-agent', 'my-agent'])

    fireEvent.click(screen.getByRole('button', { name: 'OMC Agent' }))
    expect(select().value).toBe('planner')

    fireEvent.click(screen.getByRole('button', { name: '自定义 Agent' }))
    expect(select().value).toBe('other-agent')
  })

  it('lists store agents in the add-node sidebar instead of hardcoded ones', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)

    fireEvent.click(screen.getByRole('button', { name: '添加节点' }))

    expect(screen.queryByText('backend-dev')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^other-agent/ }))
    const added = rf.nodes[rf.nodes.length - 1]
    expect(added.data.agentName).toBe('other-agent')
    expect(added.data.agentType).toBe('custom')
  })

  it('shows an empty-state hint when the store has no custom agents', async () => {
    setStoreAgents([agent('planner', 'omc'), agent('writer', 'omc')])
    renderCanvas()
    await loadTemplate(/^模板A/)

    fireEvent.click(screen.getByRole('button', { name: '添加节点' }))
    expect(screen.getByText('暂无自定义 Agent')).toBeInTheDocument()
  })

  it('shows an empty-state hint in the node editor and blocks confirm when the chosen type has no agents', async () => {
    setStoreAgents([agent('planner', 'omc'), agent('writer', 'omc')])
    renderCanvas()
    await loadTemplate(/^模板A/)
    openNodeEditor('n1')

    fireEvent.click(screen.getByRole('button', { name: '自定义 Agent' }))

    expect(screen.getByText('暂无自定义 Agent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
  })
})

describe('Canvas unsaved-change protection', () => {
  const heading = (name: string) => screen.getByRole('heading', { level: 2, name })

  it('switches templates without a prompt when nothing changed', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)

    fireEvent.click(screen.getByRole('button', { name: /^模板B/ }))

    expect(screen.queryByText(DISCARD_TITLE)).not.toBeInTheDocument()
    expect(heading('模板B')).toBeInTheDocument()
  })

  it('asks before leaving a saved template whose edges were changed, and discards on confirm', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)
    connect('n1', 'n3')

    fireEvent.click(screen.getByRole('button', { name: /^模板B/ }))

    expect(screen.getByText(DISCARD_TITLE)).toBeInTheDocument()
    expect(heading('模板A')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }))
    expect(heading('模板B')).toBeInTheDocument()
  })

  it('asks before leaving a saved template whose node was edited', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)
    openNodeEditor('n2')
    fireEvent.change(screen.getByPlaceholderText('选填，用于替代默认 Agent 名称展示'), { target: { value: '改名' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    fireEvent.click(screen.getByRole('button', { name: /^模板B/ }))

    expect(screen.getByText(DISCARD_TITLE)).toBeInTheDocument()
  })

  it('does not ask for an untouched blank draft', async () => {
    renderCanvas()
    await screen.findByRole('button', { name: /^模板A/ })
    fireEvent.click(screen.getByRole('button', { name: '+ 新建' }))
    // 新建草稿会自动切到「添加节点」页签，回到模板列表再切换
    fireEvent.click(screen.getByRole('button', { name: '模板列表' }))

    fireEvent.click(screen.getByRole('button', { name: /^模板A/ }))

    expect(screen.queryByText(DISCARD_TITLE)).not.toBeInTheDocument()
    expect(heading('模板A')).toBeInTheDocument()
  })

  it('treats a saved template as clean again after saving', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)
    connect('n1', 'n3')

    fireEvent.click(screen.getByRole('button', { name: '保存模板' }))
    await waitFor(() => expect(api.updateTemplate).toHaveBeenCalledTimes(1))
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: /^模板B/ }))
    expect(screen.queryByText(DISCARD_TITLE)).not.toBeInTheDocument()
    expect(heading('模板B')).toBeInTheDocument()
  })

  it('blocks page unload only while there are unsaved changes, and removes the listener on unmount', async () => {
    const { unmount } = renderCanvas()
    await loadTemplate(/^模板A/)

    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    connect('n1', 'n3')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)

    unmount()
    const afterUnmount = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterUnmount)
    expect(afterUnmount.defaultPrevented).toBe(false)
  })
})

describe('Canvas keyboard delete', () => {
  it('does nothing on a read-only builtin template', async () => {
    renderCanvas()
    await loadTemplate(new RegExp(`^${BUILTIN_TEMPLATES[0].name}`))
    const nodeCount = rf.nodes.length
    const edgeCount = rf.edges.length

    await keyboardDelete(['n1'], [rf.edges[0].id])

    expect(rf.nodes).toHaveLength(nodeCount)
    expect(rf.edges).toHaveLength(edgeCount)
    expect(rf.deleteKeyCode).toBeNull()
  })

  it('deletes a node and its edges on an editable template and counts as an unsaved change', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)

    await keyboardDelete(['n2'], [])

    expect(rf.nodes.map((n: any) => n.id)).toEqual(['n1', 'n3'])
    expect(rf.edges).toHaveLength(0)
    expect(screen.getByText('2 节点 · 0 连接')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^模板B/ }))
    expect(screen.getByText(DISCARD_TITLE)).toBeInTheDocument()
  })

  it('deletes a selected edge on an editable template and counts as an unsaved change', async () => {
    renderCanvas()
    await loadTemplate(/^模板A/)

    await keyboardDelete([], ['e0'])

    expect(rf.edges.map((e: any) => e.id)).toEqual(['e1'])
    fireEvent.click(screen.getByRole('button', { name: /^模板B/ }))
    expect(screen.getByText(DISCARD_TITLE)).toBeInTheDocument()
  })
})

describe('Canvas dialogs and backdrop', () => {
  it('keeps the save dialog open when a text selection drag ends on the backdrop', async () => {
    renderCanvas()
    await screen.findByRole('button', { name: /^模板A/ })
    fireEvent.click(screen.getByRole('button', { name: '+ 新建' }))
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }))

    const input = screen.getByPlaceholderText('例如：全流程开发')
    const overlay = input.closest('.fixed') as HTMLElement
    fireEvent.mouseDown(input)
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)

    expect(screen.getByPlaceholderText('例如：全流程开发')).toBeInTheDocument()
  })

  it('still closes the save dialog on a real backdrop click', async () => {
    renderCanvas()
    await screen.findByRole('button', { name: /^模板A/ })
    fireEvent.click(screen.getByRole('button', { name: '+ 新建' }))
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }))

    const overlay = screen.getByPlaceholderText('例如：全流程开发').closest('.fixed') as HTMLElement
    fireEvent.mouseDown(overlay)
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)

    expect(screen.queryByPlaceholderText('例如：全流程开发')).not.toBeInTheDocument()
  })
})
