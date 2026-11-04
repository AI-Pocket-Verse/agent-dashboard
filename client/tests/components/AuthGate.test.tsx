import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthGate from '../../src/components/AuthGate/index'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthGate', () => {
  it('explains open-mode access instead of asking for a password that does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))

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
})
