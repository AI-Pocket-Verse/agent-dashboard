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
  // 以真实路由创建一个 run，返回其工作区目录
  async function createRun(app: Awaited<ReturnType<typeof buildTestApp>>['app'], id: string, workspacePath: string) {
    const runDir = join(TEST_ROOT, 'workspace', workspacePath)
    mkdirSync(runDir, { recursive: true })
    const run: WorkflowRun = {
      id, name: id, prompt: 'p', projectName: 'demo', workspacePath, status: 'completed',
      nodes: [], edges: [], requireConfirm: false, createdAt: Date.now(),
    }
    await app.inject({ method: 'POST', url: '/api/runs', headers: { Authorization: 'Bearer test' }, payload: run })
    return runDir
  }

  it('treats names that merely start with ".." as inside the run workspace', async () => {
    const { app } = await buildTestApp()
    const headers = { Authorization: 'Bearer test' }
    const runDir = await createRun(app, 'run-dots', 'runs/run-dots/repo')
    mkdirSync(join(runDir, '..d'), { recursive: true })
    writeFileSync(join(runDir, '..foo'), 'dots')
    writeFileSync(join(runDir, '..d', 'x.txt'), 'inner')
    // 位于工作区外的文件，用 ../ 访问必须仍被拒绝
    writeFileSync(join(runDir, '..', 'secret.txt'), 'secret')

    const content = await app.inject({ method: 'GET', url: '/api/fs/runs/run-dots/files/content?path=..foo', headers })
    expect(content.statusCode).toBe(200)
    expect(JSON.parse(content.body).content).toBe('dots')

    const raw = await app.inject({ method: 'GET', url: '/api/fs/runs/run-dots/raw?path=..foo', headers })
    expect(raw.statusCode).toBe(200)

    const dir = await app.inject({ method: 'GET', url: '/api/fs/runs/run-dots/files?path=..d', headers })
    expect(dir.statusCode).toBe(200)

    for (const url of [
      '/api/fs/runs/run-dots/files/content?path=../secret.txt',
      '/api/fs/runs/run-dots/raw?path=../secret.txt',
      '/api/fs/runs/run-dots/files?path=..',
    ]) {
      expect((await app.inject({ method: 'GET', url, headers })).statusCode, url).toBe(404)
    }
    await app.close()
  })

  it('accepts a run workspacePath whose first segment starts with ".." and rejects real escapes', async () => {
    const { app } = await buildTestApp()
    const headers = { Authorization: 'Bearer test' }
    const dotted = await createRun(app, 'run-dotws', '..ws/repo')
    writeFileSync(join(dotted, 'a.txt'), 'a')
    const ok = await app.inject({ method: 'GET', url: '/api/fs/runs/run-dotws/files', headers })
    expect(ok.statusCode).toBe(200)

    // 逃逸到 workspaceRoot 之外
    const outside = join(TEST_ROOT, 'outside')
    mkdirSync(outside, { recursive: true })
    await createRun(app, 'run-escape', '../outside')
    const bad = await app.inject({ method: 'GET', url: '/api/fs/runs/run-escape/files', headers })
    expect(bad.statusCode).toBe(404)
    await app.close()
  })

  it('browse keeps rejecting paths that escape the allowed roots', async () => {
    const { app } = await buildTestApp()
    const headers = { Authorization: 'Bearer test' }
    const ok = await app.inject({ method: 'GET', url: `/api/fs/browse?path=${encodeURIComponent(TEST_ROOT)}`, headers })
    expect(ok.statusCode).toBe(200)
    const escape = await app.inject({ method: 'GET', url: `/api/fs/browse?path=${encodeURIComponent(join(TEST_ROOT, '../etc'))}`, headers })
    expect(escape.statusCode).toBe(403)
    await app.close()
  })
})
