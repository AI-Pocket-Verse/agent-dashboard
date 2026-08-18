import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkflowStore } from '../../src/store/workflowStore'
import type { WorkflowRun } from '../../src/types/index'

function makeRun(): WorkflowRun {
  return {
    id: 'run-1',
    name: 'test run',
    status: 'paused',
    nodes: [
      { id: 'node-1', agentName: 'planner', agentType: 'omc', prompt: 'plan', codeContext: [], status: 'waiting', logs: [] },
    ],
    edges: [],
    requireConfirm: true,
    createdAt: Date.now(),
  }
}

describe('workflowStore cancellation state', () => {
  beforeEach(() => useWorkflowStore.getState().reset())

  it('ignores duplicate consecutive log lines from workflow events', () => {
    const store = useWorkflowStore.getState()
    store.upsertRun(makeRun())

    store.appendLog('run-1', 'node-1', "I've explored the project thoroughly. Here's what I found:")
    store.appendLog('run-1', 'node-1', "I've explored the project thoroughly. Here's what I found:")

    expect(useWorkflowStore.getState().activeRuns[0].nodes[0].logs).toEqual([
      "I've explored the project thoroughly. Here's what I found:",
    ])
  })


  it('keeps only a bounded recent log window while tracking total log count', () => {
    const store = useWorkflowStore.getState()
    store.upsertRun(makeRun())

    for (let index = 0; index < 250; index++) {
      store.appendLog('run-1', 'node-1', `log ${index}`)
    }

    const node = useWorkflowStore.getState().activeRuns[0].nodes[0]
    expect(node.logs).toHaveLength(200)
    expect(node.logs[0]).toBe('log 50')
    expect(node.logCount).toBe(250)
  })


  it('keeps an existing confirmation card when a transient active snapshot lacks waiting details', () => {
    const store = useWorkflowStore.getState()
    store.upsertRun(makeRun())
    store.setPendingConfirm({ runId: 'run-1', nodeId: 'node-1', summary: 'waiting', nextNodeIds: [] })

    store.upsertRun({
      ...makeRun(),
      status: 'running',
      nodes: [
        { id: 'node-1', agentName: 'planner', agentType: 'omc', prompt: 'plan', codeContext: [], status: 'running', logs: [] },
      ],
    })

    expect(useWorkflowStore.getState().pendingConfirm).toEqual({
      runId: 'run-1',
      nodeId: 'node-1',
      summary: 'waiting',
      nextNodeIds: [],
    })
  })

  it('clears pending confirmation when a run becomes failed', () => {
    const store = useWorkflowStore.getState()
    store.upsertRun(makeRun())
    store.setPendingConfirm({ runId: 'run-1', nodeId: 'node-1', summary: 'waiting', nextNodeIds: [] })

    useWorkflowStore.getState().setRunStatus('run-1', 'failed')

    expect(useWorkflowStore.getState().pendingConfirm).toBeNull()
  })

  it('updates the active round status when workflow status events include a round id', () => {
    const store = useWorkflowStore.getState()
    store.upsertRun({
      ...makeRun(),
      status: 'running',
      activeRoundId: 'round-2',
      rounds: [
        {
          id: 'round-1',
          prompt: 'first',
          status: 'completed',
          nodes: [],
          edges: [],
          createdAt: 1,
        },
        {
          id: 'round-2',
          prompt: 'second',
          status: 'running',
          nodes: makeRun().nodes,
          edges: [],
          createdAt: 2,
        },
      ],
    })

    useWorkflowStore.getState().setRunStatus('run-1', 'paused', 'round-2')

    const run = useWorkflowStore.getState().activeRuns[0]
    expect(run.status).toBe('paused')
    expect(run.rounds?.map(round => round.status)).toEqual(['completed', 'paused'])
  })

  it('clears the saved runner session when a run reaches a terminal status', () => {
    const store = useWorkflowStore.getState()
    store.upsertRun(makeRun())
    store.setRunnerSession({
      prompt: 'saved prompt',
      projectName: 'saved project',
      agentNames: ['planner'],
      templateName: '',
      codeContext: [],
      attachments: [],
    })

    useWorkflowStore.getState().setRunStatus('run-1', 'completed')

    expect(useWorkflowStore.getState().runnerSession).toBeNull()
  })

  it('does not clear another active run session when one of multiple runs finishes', () => {
    const store = useWorkflowStore.getState()
    store.upsertRun({ ...makeRun(), id: 'run-1' })
    store.upsertRun({ ...makeRun(), id: 'run-2' })
    store.setRunnerSession({
      runId: 'run-2',
      prompt: 'saved prompt',
      projectName: 'saved project',
      agentNames: ['planner'],
      templateName: '',
      codeContext: [],
      attachments: [],
    })

    useWorkflowStore.getState().setRunStatus('run-1', 'completed')

    expect(useWorkflowStore.getState().activeRuns.map(run => run.id)).toEqual(['run-2'])
    expect(useWorkflowStore.getState().runnerSession?.runId).toBe('run-2')
  })

  it('restores paused confirmation from a bounded recent log summary', () => {
    const store = useWorkflowStore.getState()
    store.upsertRun({
      ...makeRun(),
      nodes: [
        {
          id: 'node-1',
          agentName: 'planner',
          agentType: 'omc',
          prompt: 'plan',
          codeContext: [],
          status: 'waiting',
          logs: Array.from({ length: 150 }, (_, index) => `log ${index}`),
        },
      ],
    })

    const summaryLines = useWorkflowStore.getState().pendingConfirm?.summary.split('\n')

    expect(summaryLines).toHaveLength(120)
    expect(summaryLines?.[0]).toBe('log 30')
    expect(summaryLines?.[119]).toBe('log 149')
  })
})
