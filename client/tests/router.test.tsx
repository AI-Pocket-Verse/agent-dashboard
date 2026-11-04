import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { appRoutes, routerFuture, routerProviderFuture } from '../src/router'
import './helpers/dataRouterEnv'

const ws = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))

// 统计 WS 外壳的挂载次数：路由切换不得重建 WS 连接
vi.mock('../src/hooks/useWebSocket', async () => {
  const React = await import('react')
  return {
    useWebSocket: () => {
      React.useEffect(() => {
        ws.mounts += 1
        return () => { ws.unmounts += 1 }
      }, [])
      return { send: vi.fn() }
    },
  }
})

vi.mock('../src/pages/Dashboard', () => ({ default: () => <p>Dashboard page</p> }))
vi.mock('../src/pages/RunnerPage', () => ({ default: () => <p>Runner page</p> }))
vi.mock('../src/pages/Canvas', () => ({ default: () => <p>Canvas page</p> }))
vi.mock('../src/pages/History', () => ({ default: () => <p>History page</p> }))

afterEach(() => {
  ws.mounts = 0
  ws.unmounts = 0
})

describe('app router', () => {
  test('renders every page path under a data router and keeps the shell mounted across navigation', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'], future: routerFuture })
    render(<RouterProvider router={router} future={routerProviderFuture} />)
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument()

    for (const [path, text] of [
      ['/runner', 'Runner page'],
      ['/canvas', 'Canvas page'],
      ['/history', 'History page'],
      ['/', 'Dashboard page'],
    ]) {
      await act(async () => { await router.navigate(path) })
      expect(await screen.findByText(text)).toBeInTheDocument()
    }

    expect(ws.mounts).toBe(1)
    expect(ws.unmounts).toBe(0)
  })
})
