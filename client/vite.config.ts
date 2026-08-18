import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, join } from 'path'
import { readdirSync, existsSync, readFileSync } from 'fs'
import { OMC_AGENTS } from '../shared/types'

function scanAgentDir(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
  } catch {
    return []
  }
}

function readAgentDescription(filePath: string): string {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)
    const description = frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
    return description?.replace(/^['"]|['"]$/g, '') ?? ''
  } catch {
    return ''
  }
}

/**
 * Vite plugin: serve GET /api/agents directly from the local filesystem.
 * Intercepts the request before the proxy, so it works even when the
 * backend server (port 3001) is not running.
 */
function localAgentsPlugin(): Plugin {
  return {
    name: 'local-agents',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' || req.url !== '/api/agents') {
          next()
          return
        }

        // PROJECT_ROOT env var (set by start.sh) or infer from config file location
        // vite.config.ts lives at agent-dashboard/client/, so ../../ = project root
        const projectRoot = process.env.PROJECT_ROOT ?? resolve(__dirname, '../..')
        const home = process.env.HOME ?? ''

        const projectDir = join(projectRoot, '.claude', 'agents')
        const globalDir = join(home, '.claude', 'agents')
        const projectNames = scanAgentDir(projectDir)
        const globalNames = scanAgentDir(globalDir)
        const seen = new Set(projectNames)
        const customAgents = [...projectNames, ...globalNames.filter(n => !seen.has(n))].map(name => {
          const filePath = projectNames.includes(name)
            ? join(projectDir, `${name}.md`)
            : join(globalDir, `${name}.md`)

          return {
            name,
            type: 'custom',
            description: readAgentDescription(filePath),
            status: 'idle',
          }
        })

        const payload = JSON.stringify([...customAgents, ...OMC_AGENTS])
        res.setHeader('Content-Type', 'application/json')
        res.statusCode = 200
        res.end(payload)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localAgentsPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        configure: (proxy) => {
          // Inject auth header at proxy level so all backend calls are authenticated
          // regardless of whether VITE_DASHBOARD_SECRET is set in the client env
          proxy.on('proxyReq', (proxyReq) => {
            const secret = process.env.DASHBOARD_SECRET ?? ''
            if (secret) proxyReq.setHeader('Authorization', `Bearer ${secret}`)
          })
        },
      },
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
