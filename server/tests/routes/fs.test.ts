import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { WorkflowRun } from '@agent-dashboard/shared'

const TEST_ROOT = '/tmp/agent-dashboard-test-fs'

async function buildTestApp() {
  process.env.DASHBOARD_SECRET = 'test'
  process.env.PROJECT_ROOT = TEST_ROOT
  process.env.WORKSPACE_ROOT = join(TEST_ROOT, 'workspace')
  process.env.CLAUDE_BIN = 'echo'
  process.env.NODE_ENV = 'test'
  const { buildApp } = await import('../../src/index.js')
  return buildApp()
}

describe('run workspace files routes', () => {
  beforeEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true })
    mkdirSync(TEST_ROOT, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  it('lists files from the saved run workspace and reads selected file content', async () => {
    const { app } = await buildTestApp()
    const workspacePath = 'runs/run-files/repo'
    const runDir = join(TEST_ROOT, 'workspace', workspacePath)
    mkdirSync(join(runDir, 'src'), { recursive: true })
    mkdirSync(join(runDir, '.dashboard-attachments'), { recursive: true })
    writeFileSync(join(runDir, 'src', 'app.ts'), 'export const answer = 42\n')
    writeFileSync(join(runDir, '.dashboard-attachments', 'note.txt'), 'hidden')

    const run: WorkflowRun = {
      id: 'run-files',
      name: 'Run files',
      prompt: 'modify code',
      projectName: 'demo',
      workspacePath,
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

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/fs/runs/run-files/files',
      headers: { Authorization: 'Bearer test' },
    })

    expect(listRes.statusCode).toBe(200)
    const listBody = JSON.parse(listRes.body)
    expect(listBody.root).toBe(runDir)
    expect(listBody.path).toBe('')
    expect(listBody.entries.map((entry: { path: string; type: string }) => `${entry.type}:${entry.path}`)).toEqual(['directory:src'])

    const subRes = await app.inject({
      method: 'GET',
      url: '/api/fs/runs/run-files/files?path=src',
      headers: { Authorization: 'Bearer test' },
    })

    expect(subRes.statusCode).toBe(200)
    const subBody = JSON.parse(subRes.body)
    expect(subBody.path).toBe('src')
    expect(subBody.entries.map((entry: { path: string; type: string }) => `${entry.type}:${entry.path}`)).toEqual(['file:src/app.ts'])

    const contentRes = await app.inject({
      method: 'GET',
      url: '/api/fs/runs/run-files/files/content?path=src%2Fapp.ts',
      headers: { Authorization: 'Bearer test' },
    })

    expect(contentRes.statusCode).toBe(200)
    const contentBody = JSON.parse(contentRes.body)
    expect(contentBody.path).toBe('src/app.ts')
    expect(contentBody.content).toBe('export const answer = 42\n')
    await app.close()
  })
})
