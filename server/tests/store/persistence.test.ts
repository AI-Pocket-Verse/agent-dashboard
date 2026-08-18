import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { PersistenceStore } from '../../src/store/persistence.js'
import type { WorkflowRun, WorkflowTemplate } from '@agent-dashboard/shared'

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
