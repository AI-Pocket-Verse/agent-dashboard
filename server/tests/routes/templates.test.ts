import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync } from 'fs'

const TEST_DATA_DIR = '/tmp/agent-dashboard-test-templates'

describe('template routes', () => {
  beforeEach(() => {
    process.env.DASHBOARD_SECRET = 'test'
    process.env.PROJECT_ROOT = '/tmp'
    process.env.CLAUDE_BIN = 'echo'
    process.env.NODE_ENV = 'test'
    process.env.DATA_DIR = TEST_DATA_DIR
  })

  afterEach(() => {
    delete process.env.DATA_DIR
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true })
  })

  const nodes = [
    { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'a' },
    { id: 'B', agentName: 'architect', agentType: 'omc', promptTemplate: 'b' },
  ]
  const cyclic = [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }]

  it('rejects saving a template whose edges form a cycle', async () => {
    const { buildApp } = await import('../../src/index.js')
    const { app } = await buildApp()
    const headers = { Authorization: 'Bearer test' }

    const created = await app.inject({ method: 'POST', url: '/api/templates', headers, payload: { name: 'cyclic', nodes, edges: cyclic } })
    expect(created.statusCode).toBe(400)
    expect(JSON.parse(created.body).error).toContain('工作流连线成环')

    const ok = await app.inject({ method: 'POST', url: '/api/templates', headers, payload: { name: 'linear', nodes, edges: [cyclic[0]] } })
    expect(ok.statusCode).toBe(200)
    const template = JSON.parse(ok.body)

    const updated = await app.inject({ method: 'PUT', url: `/api/templates/${template.id}`, headers, payload: { ...template, edges: cyclic } })
    expect(updated.statusCode).toBe(400)
    const list = JSON.parse((await app.inject({ method: 'GET', url: '/api/templates', headers })).body)
    expect(list.find((t: { id: string }) => t.id === template.id).edges).toEqual([cyclic[0]])
    await app.close()
  })

  it('ships only valid DAGs as built-in templates', async () => {
    const { BUILTIN_TEMPLATES } = await import('../../src/workflows/templates.js')
    const { assertValidDag } = await import('../../src/workflows/graph.js')
    for (const template of BUILTIN_TEMPLATES) {
      expect(() => assertValidDag(template.nodes, template.edges), template.name).not.toThrow()
    }
  })
})
