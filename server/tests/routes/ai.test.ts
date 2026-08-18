import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, rmSync, writeFileSync } from 'fs'

const TEST_BIN = '/tmp/agent-dashboard-ai-limit.sh'
const TEST_DATA_DIR = '/tmp/agent-dashboard-test-ai'

describe('POST /api/ai/select', () => {
  beforeEach(() => {
    process.env.DASHBOARD_SECRET = 'test'
    process.env.PROJECT_ROOT = '/tmp'
    process.env.WORKSPACE_ROOT = TEST_DATA_DIR
    process.env.CLAUDE_BIN = TEST_BIN
    process.env.NODE_ENV = 'test'
    writeFileSync(TEST_BIN, '#!/bin/sh\necho "You\'ve hit your limit · resets 1:10am (America/New_York)" >&2\nexit 1\n')
    chmodSync(TEST_BIN, 0o755)
  })

  afterEach(() => {
    if (existsSync(TEST_BIN)) rmSync(TEST_BIN)
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true })
  })

  it('returns the selector stderr so the client can detect rate limits', async () => {
    const { buildApp } = await import('../../src/index.js')
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/select',
      headers: { Authorization: 'Bearer test' },
      payload: {
        task: 'build it',
        agents: [{ name: 'planner', type: 'omc', description: 'plans', status: 'idle' }],
      },
    })

    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).error).toContain("You've hit your limit")
    await app.close()
  })

  it('returns selector stdout on non-zero exit so rate limits are not hidden behind a generic status error', async () => {
    writeFileSync(TEST_BIN, '#!/bin/sh\necho "You\'ve hit your limit · resets 1:10am (America/New_York)"\nexit 1\n')
    chmodSync(TEST_BIN, 0o755)
    const { buildApp } = await import('../../src/index.js')
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/select',
      headers: { Authorization: 'Bearer test' },
      payload: {
        task: 'build it',
        agents: [{ name: 'planner', type: 'omc', description: 'plans', status: 'idle' }],
      },
    })

    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).error).toContain("You've hit your limit")
    expect(JSON.parse(res.body).error).not.toContain('AI selector exited with status 1')
    await app.close()
  })

  it('rejects selector results that contain no agent nodes', async () => {
    writeFileSync(TEST_BIN, '#!/bin/sh\necho \'{ "nodes": [], "edges": [], "explanation": "none" }\'\n')
    chmodSync(TEST_BIN, 0o755)
    const { buildApp } = await import('../../src/index.js')
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/select',
      headers: { Authorization: 'Bearer test' },
      payload: {
        task: 'build it',
        agents: [{ name: 'planner', type: 'omc', description: 'plans', status: 'idle' }],
      },
    })

    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).error).toContain('至少需要选择一个 Agent')
    await app.close()
  })
})
