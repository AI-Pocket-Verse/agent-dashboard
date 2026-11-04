import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import App from './App'

// 外壳（侧栏、toast、WS 连接）只挂在这一条通配路由上，页面路由由 App 内部的 <Routes> 渲染，
// 路由切换不会重建外壳。必须使用 data router，页面才能用 useBlocker 拦截站内跳转。
export const appRoutes: RouteObject[] = [{ path: '*', element: <App /> }]

// 路由器与 RouterProvider 的 future flags（与原 BrowserRouter 保持一致）
export const routerFuture = { v7_relativeSplatPath: true } as const
export const routerProviderFuture = { v7_startTransition: true } as const

export const createAppRouter = () => createBrowserRouter(appRoutes, { future: routerFuture })
