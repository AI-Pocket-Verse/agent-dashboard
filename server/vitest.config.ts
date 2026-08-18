import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@agent-dashboard/shared': resolve(__dirname, '../shared/types.ts'),
    },
  },
  test: {
    globals: true,
  },
})
