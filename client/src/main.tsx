import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import AuthGate from './components/AuthGate'
import { createAppRouter, routerProviderFuture } from './router'
import './index.css'

const router = createAppRouter()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <RouterProvider router={router} future={routerProviderFuture} />
    </AuthGate>
  </React.StrictMode>
)
