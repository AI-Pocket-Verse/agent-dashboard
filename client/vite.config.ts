import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 只转发，不注入鉴权：前端登录后自己带 token，开发与生产行为一致
      '/api': { target: 'http://localhost:3001' },
      '/ws': { target: 'ws://localhost:3002', ws: true },
    },
  },
  resolve: {
    alias: {
      '@agent-dashboard/shared': resolve(__dirname, '../shared/types.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    alias: {
      '@agent-dashboard/shared': resolve(__dirname, '../shared/types.ts'),
    },
  },
})
