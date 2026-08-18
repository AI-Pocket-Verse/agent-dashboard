import type { FastifyPluginAsync } from 'fastify'
import type { WorkflowRun } from '@agent-dashboard/shared'
import type { DAGEngine } from '../workflows/engine.js'
import type { PersistenceStore } from '../store/persistence.js'

interface TasksRouteOptions { engine: DAGEngine; store: PersistenceStore }

const RUN_SUMMARY_LOG_LIMIT = 40

function withLogSummaries(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    nodes: run.nodes.map(node => ({
      ...node,
      logs: node.logs.slice(-RUN_SUMMARY_LOG_LIMIT),
      logCount: node.logs.length,
    })),
  }
}

const tasksRoute: FastifyPluginAsync<TasksRouteOptions> = async (fastify, opts) => {
  fastify.get('/api/runs', async () => (await opts.store.loadRuns()).map(withLogSummaries))
  fastify.get('/api/runs/active', async () => opts.engine.getActiveRuns().map(withLogSummaries))
  fastify.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const activeRun = opts.engine.getActiveRuns().find(run => run.id === req.params.id)
    const run = activeRun ?? await opts.store.loadRun(req.params.id)
    if (!run) {
      reply.code(404)
      return { error: 'Run not found' }
    }
    return run
  })

  fastify.get<{
    Params: { id: string; nodeId: string }
    Querystring: { before?: string; limit?: string }
  }>('/api/runs/:id/nodes/:nodeId/logs', async (req, reply) => {
    const before = req.query.before === undefined ? undefined : Number(req.query.before)
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit)
    const page =
      opts.engine.getRunNodeLogs(req.params.id, req.params.nodeId, { before, limit }) ??
      await opts.store.loadRunNodeLogs(req.params.id, req.params.nodeId, { before, limit })

    if (!page) {
      reply.code(404)
      return { items: [], start: 0, total: 0, nextBefore: null }
    }

    return page
  })

  fastify.get<{
    Params: { id: string; roundId: string; nodeId: string }
    Querystring: { before?: string; limit?: string }
  }>('/api/runs/:id/rounds/:roundId/nodes/:nodeId/logs', async (req, reply) => {
    const before = req.query.before === undefined ? undefined : Number(req.query.before)
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit)
    const page =
      opts.engine.getRunNodeLogs(req.params.id, req.params.nodeId, { before, limit, roundId: req.params.roundId }) ??
      await opts.store.loadRunNodeLogs(req.params.id, req.params.nodeId, { before, limit, roundId: req.params.roundId })

    if (!page) {
      reply.code(404)
      return { items: [], start: 0, total: 0, nextBefore: null }
    }

    return page
  })

  // Save a client-generated run (e.g. cancelled before execution)
  fastify.post('/api/runs', async (req) => {
    const run = req.body as WorkflowRun
    await opts.store.saveRun(run)
    return { ok: true }
  })

  fastify.delete<{ Params: { id: string } }>('/api/runs/:id', async (req) => {
    opts.engine.cancelRun(req.params.id)
    return { ok: true }
  })
}

export default tasksRoute
