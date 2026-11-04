import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { PersistenceStore } from '../../src/store/persistence.js'
import type { NodeRun, WorkflowRun, WorkflowTemplate } from '@agent-dashboard/shared'

const TEST_DIR = '/tmp/agent-dashboard-test-store'

describe('PersistenceStore', () => {
  let store: PersistenceStore

  beforeEach(() => { store = new PersistenceStore(TEST_DIR) })
  afterEach(() => {
    store?.close()
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  })

  it('saves and loads a run', async () => {
    const run: WorkflowRun = {
      id: 'run-1', name: 'test', prompt: 'original prompt', status: 'completed',
      nodes: [], edges: [], requireConfirm: false, executionMode: 'serial', createdAt: Date.now()
    }
    await store.saveRun(run)
    const runs = await store.loadRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].id).toBe('run-1')
    expect(runs[0].prompt).toBe('original prompt')
    expect(runs[0].executionMode).toBe('serial')
  })

  it('fails interrupted runs on startup, leaving finished runs untouched', async () => {
    const base = { nodes: [], edges: [], requireConfirm: false, createdAt: Date.now() }
    await store.saveRun({ id: 'r-running', name: 'a', status: 'running', ...base })
    await store.saveRun({ id: 'r-paused', name: 'b', status: 'paused', ...base })
    await store.saveRun({ id: 'r-done', name: 'c', status: 'completed', completedAt: Date.now(), ...base })

    const reaped = store.failInterruptedRuns()
    expect(reaped).toBe(2)

    const byId = new Map((await store.loadRuns()).map(run => [run.id, run.status]))
    expect(byId.get('r-running')).toBe('failed')
    expect(byId.get('r-paused')).toBe('failed')
    expect(byId.get('r-done')).toBe('completed')
  })

  it('fails the rounds and nodes of interrupted runs, not just the run status', async () => {
    const node = (id: string, status: NodeRun['status']): NodeRun => ({ id, agentName: id, agentType: 'omc', prompt: 'p', codeContext: [], status, logs: ['working'] })
    const round = (status: WorkflowRun['status'], nodes: NodeRun[]) => ({ id: 'round-1', prompt: 'p', status, nodes, edges: [], createdAt: 1 })
    const runningNodes = [node('done', 'completed'), node('busy', 'running'), node('todo', 'pending')]
    await store.saveRun({ id: 'r-running', name: 'a', status: 'running', nodes: runningNodes, edges: [], rounds: [round('running', runningNodes)], activeRoundId: 'round-1', requireConfirm: false, createdAt: 1 })
    const waitingNodes = [node('waiter', 'waiting')]
    await store.saveRun({ id: 'r-waiting', name: 'b', status: 'paused', nodes: waitingNodes, edges: [], rounds: [round('paused', waitingNodes)], activeRoundId: 'round-1', requireConfirm: true, createdAt: 1 })
    // 旧版本已经把 status 列改成 failed，但轮次和节点仍是 running 的存量数据
    const legacyNodes = [node('stale', 'running')]
    await store.saveRun({ id: 'r-legacy', name: 'c', status: 'failed', completedAt: 5, nodes: legacyNodes, edges: [], rounds: [round('running', legacyNodes)], activeRoundId: 'round-1', requireConfirm: false, createdAt: 1 })
    const doneNodes = [node('ok', 'completed')]
    await store.saveRun({ id: 'r-done', name: 'd', status: 'completed', completedAt: 5, nodes: doneNodes, edges: [], rounds: [round('completed', doneNodes)], activeRoundId: 'round-1', requireConfirm: false, createdAt: 1 })

    expect(store.failInterruptedRuns(100)).toBe(3)

    const running = await store.loadRun('r-running')
    expect(running?.status).toBe('failed')
    expect(running?.rounds?.[0].status).toBe('failed')
    expect(running?.nodes.map(n => n.status)).toEqual(['completed', 'failed', 'pending'])
    expect(running?.nodes[1].finishedAt).toBe(100)
    expect(running?.nodes[1].logs.at(-1)).toBe('[system:interrupted] Service restarted; execution interrupted.')

    const waiting = await store.loadRun('r-waiting')
    expect(waiting?.rounds?.[0].status).toBe('failed')
    expect(waiting?.nodes[0].status).toBe('failed')

    const legacy = await store.loadRun('r-legacy')
    expect(legacy?.rounds?.[0].status).toBe('failed')
    expect(legacy?.nodes[0].status).toBe('failed')
    expect(legacy?.completedAt).toBe(5)

    const done = await store.loadRun('r-done')
    expect(done?.nodes[0].logs).toEqual(['working'])
  })

  it('skips corrupt rows and counts only runs it actually changed', async () => {
    const base = { edges: [], requireConfirm: false, createdAt: 1 }
    await store.saveRun({ id: 'r-running', name: 'a', status: 'running', nodes: [], ...base })
    await store.saveRun({ id: 'r-corrupt', name: 'b', status: 'running', nodes: [], ...base })
    // 已结束的 run，但节点日志里恰好出现 "status":"running" 文本，LIKE 预筛会命中
    await store.saveRun({ id: 'r-done', name: 'c', status: 'completed', completedAt: 5, nodes: [], ...base })
    const raw = new Database(join(TEST_DIR, 'app.db'))
    raw.prepare("UPDATE runs SET nodes_json = '{not json' WHERE id = 'r-corrupt'").run()
    raw.prepare(`UPDATE runs SET nodes_json = '[{"id":"n","status":"completed","logs":[],"meta":{"status":"running"}}]' WHERE id = 'r-done'`).run()
    raw.close()

    expect(store.failInterruptedRuns(100)).toBe(2)
    expect((await store.loadRun('r-running'))?.status).toBe('failed')
    // 损坏行无法逐节点收尾，但运行状态必须落到 failed，否则界面永远显示运行中
    const check = new Database(join(TEST_DIR, 'app.db'))
    const corrupt = check.prepare("SELECT status, completed_at FROM runs WHERE id = 'r-corrupt'").get() as { status: string; completed_at: number }
    check.close()
    expect(corrupt).toEqual({ status: 'failed', completed_at: 100 })
  })

  it('loads a single saved run by id with the original prompt', async () => {
    const run: WorkflowRun = {
      id: 'run-detail',
      name: 'detail',
      prompt: '创建页原始需求',
      status: 'completed',
      nodes: [],
      edges: [],
      requireConfirm: false,
      createdAt: Date.now(),
      completedAt: Date.now(),
    }
    await store.saveRun(run)

    await expect(store.loadRun('run-detail')).resolves.toMatchObject({
      id: 'run-detail',
      prompt: '创建页原始需求',
    })
    await expect(store.loadRun('missing-run')).resolves.toBeNull()
  })

  it('saves and loads run rounds while preserving the active round', async () => {
    const run: WorkflowRun = {
      id: 'run-rounds',
      name: 'round project',
      prompt: 'first request',
      status: 'running',
      activeRoundId: 'round-2',
      nodes: [{
        id: 'node-2',
        agentName: 'developer',
        agentType: 'omc',
        prompt: 'continue',
        codeContext: [],
        status: 'running',
        logs: ['working'],
      }],
      edges: [],
      rounds: [
        {
          id: 'round-1',
          prompt: 'first request',
          status: 'completed',
          nodes: [{
            id: 'node-1',
            agentName: 'planner',
            agentType: 'omc',
            prompt: 'plan',
            codeContext: [],
            status: 'completed',
            logs: ['done'],
          }],
          edges: [],
          createdAt: 1,
          completedAt: 2,
        },
        {
          id: 'round-2',
          prompt: 'continue',
          status: 'running',
          nodes: [{
            id: 'node-2',
            agentName: 'developer',
            agentType: 'omc',
            prompt: 'continue',
            codeContext: [],
            status: 'running',
            logs: ['working'],
          }],
          edges: [],
          createdAt: 3,
        },
      ],
      requireConfirm: false,
      createdAt: 1,
    }

    await store.saveRun(run)

    await expect(store.loadRun('run-rounds')).resolves.toMatchObject({
      id: 'run-rounds',
      activeRoundId: 'round-2',
      rounds: [
        { id: 'round-1', status: 'completed' },
        { id: 'round-2', status: 'running' },
      ],
    })
  })

  it('saves and loads a template', async () => {
    const tmpl: WorkflowTemplate = {
      id: 'tmpl-1', name: 'My Template', nodes: [], edges: [], createdAt: Date.now()
    }
    await store.saveTemplate(tmpl)
    const tmpls = await store.loadTemplates()
    expect(tmpls).toHaveLength(1)
    expect(tmpls[0].id).toBe('tmpl-1')
  })

  it('updates existing run on save', async () => {
    const run: WorkflowRun = {
      id: 'run-1', name: 'test', status: 'running',
      nodes: [], edges: [], requireConfirm: false, createdAt: Date.now()
    }
    await store.saveRun(run)
    await store.saveRun({ ...run, status: 'completed' })
    const runs = await store.loadRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('completed')
  })

  it('deletes a template', async () => {
    const tmpl: WorkflowTemplate = {
      id: 'tmpl-1', name: 'My Template', nodes: [], edges: [], createdAt: Date.now()
    }
    await store.saveTemplate(tmpl)
    await store.deleteTemplate('tmpl-1')
    expect(await store.loadTemplates()).toHaveLength(0)
  })

  it('loads a bounded page of node logs from newest backwards', async () => {
    const run: WorkflowRun = {
      id: 'run-logs',
      name: 'Log Run',
      status: 'paused',
      nodes: [{
        id: 'node-1',
        agentName: 'planner',
        agentType: 'omc',
        prompt: 'plan',
        codeContext: [],
        status: 'waiting',
        logs: ['line 0', 'line 1', 'line 2', 'line 3', 'line 4'],
      }],
      edges: [],
      requireConfirm: true,
      createdAt: Date.now(),
    }

    await store.saveRun(run)

    await expect(store.loadRunNodeLogs('run-logs', 'node-1', { before: 5, limit: 2 })).resolves.toEqual({
      items: ['line 3', 'line 4'],
      start: 3,
      total: 5,
      nextBefore: 3,
    })
  })

  it('migrates legacy JSON data into sqlite on first boot', async () => {
    const template: WorkflowTemplate = {
      id: 'tmpl-legacy', name: 'Legacy Template', nodes: [], edges: [], createdAt: 1
    }
    const run: WorkflowRun = {
      id: 'run-legacy', name: 'Legacy Run', status: 'completed',
      nodes: [], edges: [], requireConfirm: false, createdAt: 2
    }

    writeFileSync(join(TEST_DIR, 'templates.json'), JSON.stringify([template], null, 2))
    writeFileSync(join(TEST_DIR, 'runs.json'), JSON.stringify([run], null, 2))

    store.close()
    store = new PersistenceStore(TEST_DIR)

    await expect(store.loadTemplates()).resolves.toEqual([template])
    const runs = await store.loadRuns()
    expect(runs[0]).toMatchObject({
      id: run.id,
      name: run.name,
      status: run.status,
      activeRoundId: 'round-1',
      rounds: [{ id: 'round-1', status: run.status }],
    })
  })
})

describe('PersistenceStore legacy JSON migration', () => {
  const LEGACY_DIR = '/tmp/agent-dashboard-test-store-legacy'
  afterEach(() => { if (existsSync(LEGACY_DIR)) rmSync(LEGACY_DIR, { recursive: true }) })

  it('imports runs from an old runs.json, including autoFixRound', async () => {
    mkdirSync(LEGACY_DIR, { recursive: true })
    const legacy: WorkflowRun[] = [
      { id: 'old-1', name: 'old', prompt: 'p', status: 'completed', nodes: [], edges: [], requireConfirm: true, autoFixRound: 2, createdAt: 1, completedAt: 2 },
      { id: 'old-2', name: 'old2', status: 'failed', nodes: [], edges: [], requireConfirm: false, createdAt: 3 },
    ]
    writeFileSync(join(LEGACY_DIR, 'runs.json'), JSON.stringify(legacy))
    const store = new PersistenceStore(LEGACY_DIR)
    const runs = await store.loadRuns()
    store.close()
    expect(runs.map(r => r.id).sort()).toEqual(['old-1', 'old-2'])
    expect(runs.find(r => r.id === 'old-1')?.autoFixRound).toBe(2)
    expect(runs.find(r => r.id === 'old-1')?.requireConfirm).toBe(true)
    expect(runs.find(r => r.id === 'old-2')?.autoFixRound).toBeUndefined()
  })
})
