import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../src/App'

const storeActions = {
  setAgents: vi.fn(),
  setAgentStatus: vi.fn(),
  upsertRun: vi.fn(),
  appendLog: vi.fn(),
  setNodeStatus: vi.fn(),
  setRunStatus: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  setPendingConfirm: vi.fn(),
  setSend: vi.fn(),
  setLastError: vi.fn(),
}

const wsMock = vi.hoisted(() => ({ handler: null as null | ((msg: unknown) => void) }))

vi.mock('../src/hooks/useWebSocket', () => ({
  useWebSocket: (_url: string, _token: string, onMessage: (msg: unknown) => void) => {
    wsMock.handler = onMessage
    return { send: vi.fn() }
  },
}))

vi.mock('../src/store/agentStore', () => ({
  useAgentStore: () => ({
    setAgents: storeActions.setAgents,
    setAgentStatus: storeActions.setAgentStatus,
  }),
}))

vi.mock('../src/store/workflowStore', () => ({
  useWorkflowStore: () => ({
    upsertRun: storeActions.upsertRun,
    appendLog: storeActions.appendLog,
    setNodeStatus: storeActions.setNodeStatus,
    setRunStatus: storeActions.setRunStatus,
    completeRun: storeActions.completeRun,
    failRun: storeActions.failRun,
    setPendingConfirm: storeActions.setPendingConfirm,
  }),
}))

vi.mock('../src/store/wsStore', () => ({
  useWsStore: (selector: (state: { setSend: typeof storeActions.setSend; setLastError: typeof storeActions.setLastError }) => unknown) =>
    selector({ setSend: storeActions.setSend, setLastError: storeActions.setLastError }),
}))

vi.mock('../src/pages/Dashboard', () => ({ default: () => <p>Dashboard page</p> }))
vi.mock('../src/pages/RunnerPage', () => ({ default: () => <p>Runner page</p> }))
vi.mock('../src/pages/Canvas', () => ({ default: () => <p>Canvas page</p> }))
vi.mock('../src/pages/History', () => ({ default: () => <p>History page</p> }))

function AppRouter({ children }: PropsWithChildren) {
  return (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {children}
    </MemoryRouter>
  )
}

describe('App context menu', () => {
  const writeText = vi.fn(() => Promise.resolve())
  let originalClipboard: Clipboard | undefined
  let originalGetSelection: typeof window.getSelection

  beforeEach(() => {
    originalClipboard = navigator.clipboard
    originalGetSelection = window.getSelection
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    })
    window.getSelection = originalGetSelection
    writeText.mockClear()
  })

  test('shows an app copy action for selected text while blocking the browser context menu', async () => {
    window.getSelection = vi.fn(() => ({ toString: () => '  selected text  ' }) as Selection)
    render(<App />, { wrapper: AppRouter })

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 36,
    })

    act(() => {
      expect(document.dispatchEvent(event)).toBe(false)
    })
    expect(event.defaultPrevented).toBe(true)

    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('selected text'))
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('复制成功')
  })

  test('copies selected text from text fields', async () => {
    window.getSelection = vi.fn(() => ({ toString: () => '' }) as Selection)
    render(<App />, { wrapper: AppRouter })

    const textarea = document.createElement('textarea')
    textarea.value = 'copy this field value'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.setSelectionRange(5, 15)

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })

    act(() => {
      expect(textarea.dispatchEvent(event)).toBe(false)
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('this field'))
    textarea.remove()
  })

  test('keeps the browser context menu blocked without showing copy when no text is selected', () => {
    window.getSelection = vi.fn(() => ({ toString: () => '' }) as Selection)
    render(<App />, { wrapper: AppRouter })

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })

    act(() => {
      expect(document.dispatchEvent(event)).toBe(false)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
  })
})

describe('App server errors', () => {
  test('shows the reason when the server rejects a WebSocket request', async () => {
    render(<App />, { wrapper: AppRouter })

    act(() => {
      wsMock.handler?.({ type: 'error', payload: { message: 'Agent $& used twice', requestType: 'workflow:run' } })
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Agent $& used twice')
  })
})
