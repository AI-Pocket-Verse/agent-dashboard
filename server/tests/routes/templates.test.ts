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

  it('PUT uses the URL id, rejects built-ins, missing templates and bad names', async () => {
    const { buildApp } = await import('../../src/index.js')
    const { BUILTIN_TEMPLATES } = await import('../../src/workflows/templates.js')
    const { app } = await buildApp()
    const headers = { Authorization: 'Bearer test' }
    const edges = [cyclic[0]]

    const created = JSON.parse((await app.inject({ method: 'POST', url: '/api/templates', headers, payload: { name: 'put-target', nodes, edges } })).body)

    // body.id 与 URL 不一致：以 URL 为准，不得新建/覆盖其他 id
    const renamed = await app.inject({ method: 'PUT', url: `/api/templates/${created.id}`, headers, payload: { ...created, id: 'other-id', name: 'put-renamed' } })
    expect(renamed.statusCode).toBe(200)
    expect(JSON.parse(renamed.body).id).toBe(created.id)
    const list = JSON.parse((await app.inject({ method: 'GET', url: '/api/templates', headers })).body)
    expect(list.some((t: { id: string }) => t.id === 'other-id')).toBe(false)
    expect(list.find((t: { id: string }) => t.id === created.id).name).toBe('put-renamed')

    // 缺 name / 非字符串 / 空白：400
    for (const name of [undefined, 123, '   ']) {
      const res = await app.inject({ method: 'PUT', url: `/api/templates/${created.id}`, headers, payload: { nodes, edges, name } })
      expect(res.statusCode, String(name)).toBe(400)
    }
    const postBad = await app.inject({ method: 'POST', url: '/api/templates', headers, payload: { nodes, edges } })
    expect(postBad.statusCode).toBe(400)

    // 内置模板不可改
    const builtin = BUILTIN_TEMPLATES[0]
    const forbidden = await app.inject({ method: 'PUT', url: `/api/templates/${builtin.id}`, headers, payload: { ...builtin, name: 'hacked-builtin' } })
    expect(forbidden.statusCode).toBe(403)
    expect(JSON.parse(forbidden.body).error).toContain('built-in')

    // 不存在：404
    const missing = await app.inject({ method: 'PUT', url: '/api/templates/no-such-id', headers, payload: { name: 'ghost', nodes, edges } })
    expect(missing.statusCode).toBe(404)
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
