import Fastify from 'fastify'
import { config } from './config.js'
import { authPlugin } from './auth.js'
import { ProcessManager } from './processes/manager.js'
import { killActiveSelections } from './ai/selector.js'
import { PersistenceStore } from './store/persistence.js'
import { DAGEngine } from './workflows/engine.js'
import { WsManager } from './ws/server.js'
import { createMessageHandler } from './ws/handlers.js'
import agentsRoute from './routes/agents.js'
import tasksRoute from './routes/tasks.js'
import workflowsRoute from './routes/workflows.js'
import aiRoute from './routes/ai.js'
import fsRoute from './routes/fs.js'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR
  if (process.env.NODE_ENV === 'test') {
    return mkdtempSync(join(tmpdir(), 'agent-dashboard-test-data-'))
  }
  return join(__dirname, '..', 'data')
}

export async function buildApp() {
  const app = Fastify({ logger: true })
  await app.register(authPlugin, { secret: config.secret })

  const dataDir = resolveDataDir()
  const store = new PersistenceStore(dataDir)
  // Reap runs left "running"/"paused" by a previous process — their child
  // processes are gone, so without this they stay stuck in the UI forever.
  const reaped = store.failInterruptedRuns()
  if (reaped > 0) app.log.info(`Marked ${reaped} interrupted run(s) as failed`)
  const processManager = new ProcessManager(config.workspaceRoot, config.claudeBin, { maxRunMs: config.maxRunMs })

  let wsManager: WsManager | null = null
  const engine = new DAGEngine(processManager, store, msg => wsManager?.broadcast(msg), config.workspaceRoot)

  if (process.env.NODE_ENV !== 'test') {
    // Bind the handler lazily so WsManager and the handler can reference each other
    // without creating the server twice (re-binding the port races with async close).
    let handler: ReturnType<typeof createMessageHandler>
    wsManager = new WsManager(config.port + 1, config.secret, (msg, ws) => handler(msg, ws))
    handler = createMessageHandler(engine, wsManager)
  }

  await app.register(agentsRoute)
  await app.register(tasksRoute, { engine, store })
  await app.register(workflowsRoute, { store })
  await app.register(aiRoute)
  await app.register(fsRoute, { store })

  app.get('/api/health', async () => ({ ok: true }))

  return { app, wsManager, store, engine, processManager }
}

if (process.env.NODE_ENV !== 'test') {
  buildApp().then(({ app, processManager }) => {
    // agent 进程各自成组（不再随终端 Ctrl+C 一起收到信号），服务退出时主动结束它们
    process.on('exit', () => {
      processManager.killAll()
      killActiveSelections()
    })
    // 关闭终端（SIGHUP）也要走 exit 清理，否则 agent 进程组成为孤儿
    const SIGNAL_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const
    for (const [signal, code] of Object.entries(SIGNAL_EXIT_CODES)) {
      process.once(signal, () => process.exit(code))
    }
    app.listen({ port: config.port, host: '0.0.0.0' })
    app.log.info(`Server running on port ${config.port}`)
  })
}
