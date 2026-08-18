import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import type { WorkflowRun } from '@agent-dashboard/shared'

const TEST_DATA_DIR = '/tmp/agent-dashboard-test-routes'
const __dirname = dirname(fileURLToPath(import.meta.url))
const REAL_DATA_DIR = join(__dirname, '../../data')
const REAL_DB_PATH = join(REAL_DATA_DIR, 'app.db')

describe('GET /api/runs', () => {
  beforeEach(() => {
    process.env.DASHBOARD_SECRET = 'test'
    process.env.PROJECT_ROOT = '/tmp'
    process.env.CLAUDE_BIN = 'echo'
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true })
  })

  it('returns empty array initially', async () => {
    const { buildApp } = await import('../../src/index.js')
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs',
      headers: { Authorization: 'Bearer test' }
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
    await app.close()
  })

  it('returns 401 without auth', async () => {
    const { buildApp } = await import('../../src/index.js')
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/runs' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns a single saved run with full history details', async () => {
    const { buildApp } = await import('../../src/index.js')
    const { app } = await buildApp()
    const run: WorkflowRun = {
      id: 'run-detail',
      name: 'History detail',
      prompt: '创建页原始需求',
      status: 'completed',
      nodes: [{
        id: 'node-1',
        agentName: 'planner',
        agentType: 'omc',
        prompt: 'agent prompt',
        codeContext: [],
        status: 'completed',
        logs: Array.from({ length: 60 }, (_, index) => `line ${index}`),
      }],
      edges: [],
      requireConfirm: false,
      createdAt: Date.now(),
      completedAt: Date.now(),
    }

    await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { Authorization: 'Bearer test' },
      payload: run,
    })
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs/run-detail',
      headers: { Authorization: 'Bearer test' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.prompt).toBe('创建页原始需求')
    expect(body.nodes[0].logs).toHaveLength(60)
    await app.close()
  })

  it('does not write test runs into the real local dashboard database', async () => {
    const markerId = `test-isolation-${Date.now()}`
    const before = readRealRunCount(markerId)
    const { buildApp } = await import('../../src/index.js')
    const { app } = await buildApp()
    const run: WorkflowRun = {
      id: markerId,
      name: 'Test isolation marker',
      prompt: 'should stay out of real data',
      status: 'completed',
      nodes: [],
      edges: [],
      requireConfirm: false,
      createdAt: Date.now(),
    }

    await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { Authorization: 'Bearer test' },
      payload: run,
    })
    await app.close()

    expect(readRealRunCount(markerId)).toBe(before)
  })
})

function readRealRunCount(id: string) {
  if (!existsSync(REAL_DB_PATH)) return 0
  const db = new Database(REAL_DB_PATH, { readonly: true })
  try {
    return db.prepare('select count(*) as count from runs where id = ?').get(id).count as number
  } finally {
    db.close()
  }
}
