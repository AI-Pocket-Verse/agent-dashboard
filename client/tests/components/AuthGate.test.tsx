import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthGate from '../../src/components/AuthGate/index'

afterEach(() => {
  vi.unstubAllGlobals()
})

const OPEN_MODE_REJECTION = 'Forbidden: set DASHBOARD_SECRET to allow non-local access'

describe('AuthGate', () => {
  it('explains open-mode access instead of asking for a password that does not exist', async () => {
    // 调整原因：403 判定改为看响应体是否含 DASHBOARD_SECRET，mock 需要提供 text()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => OPEN_MODE_REJECTION }))

    render(<AuthGate><p>app</p></AuthGate>)

    expect(await screen.findByText(/DASHBOARD_SECRET/)).toBeInTheDocument()
    expect(screen.getByText('此看板未设置访问密码，免密模式只允许在运行服务的电脑上访问。请在服务端设置 DASHBOARD_SECRET 后重启。')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('访问密码')).not.toBeInTheDocument()
  })

  it('asks for the password when the server answers 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    render(<AuthGate><p>app</p></AuthGate>)

    expect(await screen.findByPlaceholderText('访问密码')).toBeInTheDocument()
  })

  it('renders the app when the token is accepted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))

    render(<AuthGate><p>app</p></AuthGate>)

    expect(await screen.findByText('app')).toBeInTheDocument()
  })

  it('offers a refresh button on the forbidden page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => OPEN_MODE_REJECTION }))
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })

    render(<AuthGate><p>app</p></AuthGate>)
    fireEvent.click(await screen.findByRole('button', { name: '刷新' }))

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('treats a 403 that is not the open-mode rejection as a normal failure, not a dead end', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '<html>403 Forbidden from proxy</html>' }))

    render(<AuthGate><p>app</p></AuthGate>)

    expect(await screen.findByPlaceholderText('访问密码')).toBeInTheDocument()
    expect(screen.queryByText(/免密模式只允许/)).not.toBeInTheDocument()
  })

  it('does not treat an unreadable 403 body as the open-mode rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => { throw new Error('body used') } }))

    render(<AuthGate><p>app</p></AuthGate>)

    expect(await screen.findByPlaceholderText('访问密码')).toBeInTheDocument()
  })
})
