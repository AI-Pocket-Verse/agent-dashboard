import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRun } from '../../src/types/index'

const pending: Array<(runs: WorkflowRun[]) => void> = []
vi.mock('../../src/lib/api', () => ({
  api: {
    getActiveRuns: vi.fn(() => new Promise<WorkflowRun[]>(resolve => { pending.push(resolve) })),
    getRun: vi.fn(async (id: string) => ({ ...run(id), status: 'completed' })),
  },
}))

import { reconcileRuns } from '../../src/lib/reconcileRuns'
import { useWorkflowStore } from '../../src/store/workflowStore'

function run(id: string, status: WorkflowRun['status'] = 'running'): WorkflowRun {
  return { id, name: id, status, nodes: [], edges: [], requireConfirm: false, createdAt: 1 }
}
const activeIds = () => useWorkflowStore.getState().activeRuns.map(r => r.id)

beforeEach(() => {
  pending.length = 0
  useWorkflowStore.getState().reset()
})

describe('reconcileRuns', () => {
  it('does not revive a run that completed while the active list was in flight', async () => {
    useWorkflowStore.getState().upsertRun(run('r1'))
    const done = reconcileRuns()
    useWorkflowStore.getState().completeRun('r1')

    pending[0]([run('r1')])
    await done

    expect(activeIds()).toEqual([])
  })

  it('does not revive a run whose terminal status arrived while the active list was in flight', async () => {
    useWorkflowStore.getState().upsertRun(run('r1'))
    const done = reconcileRuns()
    useWorkflowStore.getState().setRunStatus('r1', 'failed')

    pending[0]([run('r1')])
    await done

    expect(activeIds()).toEqual([])
  })

  it('keeps the newest reconcile result when an older request answers last', async () => {
    const first = reconcileRuns()
    const second = reconcileRuns()

    pending[1]([run('fresh')])
    await second
    pending[0]([run('stale')])
    await first

    expect(activeIds()).toEqual(['fresh'])
  })

  it('still adopts runs the client did not know about', async () => {
    const done = reconcileRuns()
    pending[0]([run('other-tab')])
    await done

    expect(activeIds()).toEqual(['other-tab'])
  })
})
