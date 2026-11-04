import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DAGEngine, MAX_AUTO_FIX_ROUNDS, detectReviewIssues, extractAffectedPaths, getStartableNodes, getNodeDependencies, getNodeOutputTranscript, interpolatePrompt, isAllPrereqsDone, suggestFixAgentByRule } from '../../src/workflows/engine.js'
import type { NodeRun, Edge } from '@agent-dashboard/shared'

// 引擎会在工作区根下建 run 目录；用临时目录，避免在仓库里留下 server/runs 空目录
const WS_ROOT = mkdtempSync(join(tmpdir(), 'engine-test-ws-'))
afterAll(() => { rmSync(WS_ROOT, { recursive: true, force: true }) })

afterEach(() => {
  vi.useRealTimers()
})

function makeNode(id: string, status: NodeRun['status'] = 'pending'): NodeRun {
  return { id, agentName: 'test', agentType: 'custom', prompt: 'do it', codeContext: [], status, logs: [] }
}

describe('getStartableNodes', () => {
  it('returns nodes with no incoming edges', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')]
    const edges: Edge[] = [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }]
    expect(getStartableNodes(nodes, edges)).toEqual(['A'])
  })

  it('returns multiple roots when they exist', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')]
    const edges: Edge[] = [{ from: 'A', to: 'C' }, { from: 'B', to: 'C' }]
    const result = getStartableNodes(nodes, edges)
    expect(result.sort()).toEqual(['A', 'B'])
  })

  it('returns downstream nodes once prerequisites are completed', () => {
    const nodes = [makeNode('A', 'completed'), makeNode('B'), makeNode('C', 'running')]
    const edges: Edge[] = [{ from: 'A', to: 'B' }]
    expect(getStartableNodes(nodes, edges)).toEqual(['B'])
  })
})

describe('isAllPrereqsDone', () => {
  it('returns true when all prerequisite nodes are completed', () => {
    const nodes = [makeNode('A', 'completed'), makeNode('B', 'completed'), makeNode('C')]
    const edges: Edge[] = [{ from: 'A', to: 'C' }, { from: 'B', to: 'C' }]
    expect(isAllPrereqsDone('C', nodes, edges)).toBe(true)
  })

  it('returns false when any prerequisite is not done', () => {
    const nodes = [makeNode('A', 'completed'), makeNode('B', 'running'), makeNode('C')]
    const edges: Edge[] = [{ from: 'A', to: 'C' }, { from: 'B', to: 'C' }]
    expect(isAllPrereqsDone('C', nodes, edges)).toBe(false)
  })
})

describe('interpolatePrompt', () => {
  it('replaces {{nodes.id.output}} with node output', () => {
    const nodes = [{ ...makeNode('backend-dev', 'completed'), output: 'API is ready' }]
    const result = interpolatePrompt('Build UI for {{nodes.backend-dev.output}}', nodes)
    expect(result).toBe('Build UI for API is ready')
  })

  it('leaves unchanged when node not found', () => {
    const prompt = 'Build {{nodes.missing.output}}'
    expect(interpolatePrompt(prompt, [])).toBe(prompt)
  })
})

describe('getNodeOutputTranscript', () => {
  it('excludes dashboard system logs from confirmation summaries', () => {
    expect(getNodeOutputTranscript([
      'architecture summary',
      '[系统] legacy dashboard message',
    ])).toBe('architecture summary')
  })

  it('excludes new-format [system:<code>] lines as well as legacy [系统] lines', () => {
    expect(getNodeOutputTranscript([
      'architecture summary',
      '[system:run_timeout] Stopped after exceeding the 30 min limit. Adjust MAX_RUN_MINUTES to change it.',
      '[系统] 服务重启，执行已中断',
      '[system:user_note] User confirmation note: keep this out',
    ])).toBe('architecture summary')
  })
})

describe('DAGEngine confirmation instructions', () => {
  it('rejects workflows with no agent nodes instead of completing immediately', async () => {
    const processManager = {
      materializeAttachments: () => [],
      spawn: () => {},
      kill: () => {},
    }
    const store = { saveRun: async () => undefined }
    const engine = new DAGEngine(processManager as never, store as never, () => undefined, WS_ROOT)

    await expect(engine.startWorkflow({
      name: 'empty workflow',
      projectName: 'empty-workflow',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: false,
      nodes: [],
      edges: [],
    })).rejects.toThrow('至少需要选择一个 Agent')
  })

  it('rejects duplicate agent names inside the same workflow run', async () => {
    const processManager = {
      materializeAttachments: () => [],
      spawn: () => {},
      kill: () => {},
    }
    const store = { saveRun: async () => undefined }
    const engine = new DAGEngine(processManager as never, store as never, () => undefined, WS_ROOT)

    await expect(engine.startWorkflow({
      name: 'duplicate agents',
      projectName: 'duplicate-agents',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: false,
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan one' },
        { id: 'B', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan two' },
      ],
      edges: [],
    })).rejects.toThrow('同一个任务中不能重复使用 Agent: planner')
  })

  it('rejects workflows whose edges form a cycle or reference missing nodes', async () => {
    const spawned: string[] = []
    const processManager = { materializeAttachments: () => [], spawn: (_r: string, nodeId: string) => { spawned.push(nodeId) }, kill: () => {} }
    const store = { saveRun: async () => undefined }
    const engine = new DAGEngine(processManager as never, store as never, () => undefined, WS_ROOT)
    const nodes = [
      { id: 'A', agentName: 'planner', agentType: 'omc' as const, promptTemplate: 'a' },
      { id: 'B', agentName: 'architect', agentType: 'omc' as const, promptTemplate: 'b' },
      { id: 'C', agentName: 'executor', agentType: 'omc' as const, promptTemplate: 'c' },
    ]
    const run = (edges: Array<{ from: string; to: string }>) => engine.startWorkflow({
      name: 'graph', globalPrompt: 'g', codeContext: [], attachments: [], requireConfirm: false, nodes, edges,
    })

    await expect(run([{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }])).rejects.toThrow('工作流连线成环')
    await expect(run([{ from: 'B', to: 'B' }])).rejects.toThrow('工作流连线成环')
    await expect(run([{ from: 'A', to: 'Z' }])).rejects.toThrow('连线引用了不存在的节点: Z')
    expect(spawned).toEqual([])
    // 菱形（A→B、A→C、B→C）不是环，应正常启动
    await expect(run([{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'B', to: 'C' }])).resolves.toMatchObject({ status: 'running' })
  })

  it('rejects a cyclic follow-up round without touching the existing run', async () => {
    const completedRun = {
      id: 'done-run', name: 'done', status: 'completed' as const, nodes: [], edges: [], requireConfirm: false, createdAt: 1,
    }
    const processManager = { materializeAttachments: () => [], spawn: () => {}, kill: () => {} }
    const store = { loadRun: async () => completedRun, saveRun: async () => undefined }
    const engine = new DAGEngine(processManager as never, store as never, () => undefined, WS_ROOT)

    await expect(engine.continueWorkflow('done-run', {
      name: 'next', globalPrompt: 'g', requireConfirm: false,
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'a' },
        { id: 'B', agentName: 'architect', agentType: 'omc', promptTemplate: 'b' },
      ],
      edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }],
    })).rejects.toThrow('工作流连线成环')
    expect(completedRun.status).toBe('completed')
  })

  it('allows different workflow runs to execute the same agent name independently', async () => {
    const spawned: Array<{ runId: string; nodeId: string; agentName: string }> = []
    const processManager = {
      materializeAttachments: () => [],
      spawn: (
        runId: string,
        nodeId: string,
        _agentType: string,
        agentName: string,
      ) => {
        spawned.push({ runId, nodeId, agentName })
      },
      kill: () => {},
    }
    const store = { saveRun: async () => undefined }
    const engine = new DAGEngine(processManager as never, store as never, () => undefined, WS_ROOT)

    const firstRun = await engine.startWorkflow({
      name: 'first flow',
      projectName: 'shared-name',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: false,
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan first' },
      ],
      edges: [],
    })
    const secondRun = await engine.startWorkflow({
      name: 'second flow',
      projectName: 'shared-name',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: false,
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan second' },
      ],
      edges: [],
    })

    expect(spawned).toEqual([
      { runId: firstRun.id, nodeId: 'A', agentName: 'planner' },
      { runId: secondRun.id, nodeId: 'A', agentName: 'planner' },
    ])
  })

  it('continues a completed run by appending a new round under the same run id and workspace', async () => {
    const spawned: Array<{ runId: string; nodeId: string; projectDir: string }> = []
    const savedRuns: Array<{ id: string; activeRoundId?: string; rounds?: Array<{ id: string; status: string }> }> = []
    const completedRun = {
      id: 'existing-run',
      name: 'Existing project',
      prompt: 'first request',
      workspacePath: 'runs/existing-run/repo',
      status: 'completed',
      nodes: [makeNode('old-node', 'completed')],
      edges: [],
      rounds: [{
        id: 'round-1',
        prompt: 'first request',
        status: 'completed',
        nodes: [makeNode('old-node', 'completed')],
        edges: [],
        createdAt: 1,
        completedAt: 2,
      }],
      activeRoundId: 'round-1',
      requireConfirm: false,
      createdAt: 1,
      completedAt: 2,
    }
    const processManager = {
      materializeAttachments: () => [],
      spawn: (
        runId: string,
        nodeId: string,
        _agentType: string,
        _agentName: string,
        _prompt: string,
        _codeContext: unknown,
        _attachments: unknown,
        projectDir: string,
      ) => {
        spawned.push({ runId, nodeId, projectDir })
      },
      kill: () => {},
    }
    const store = {
      loadRun: async (id: string) => id === completedRun.id ? completedRun : null,
      saveRun: async (run: typeof completedRun) => {
        savedRuns.push({
          id: run.id,
          activeRoundId: run.activeRoundId,
          rounds: run.rounds?.map(round => ({ id: round.id, status: round.status })),
        })
      },
    }
    const engine = new DAGEngine(processManager as never, store as never, () => undefined, WS_ROOT)

    const continuedRun = await engine.continueWorkflow('existing-run', {
      name: 'Existing project',
      globalPrompt: 'continue request',
      nodes: [{ id: 'new-node', agentName: 'developer', agentType: 'omc', promptTemplate: 'continue work' }],
      edges: [],
      requireConfirm: false,
    })

    expect(continuedRun.id).toBe('existing-run')
    expect(continuedRun.status).toBe('running')
    expect(continuedRun.activeRoundId).toBe('round-2')
    expect(continuedRun.rounds?.map(round => round.id)).toEqual(['round-1', 'round-2'])
    expect(continuedRun.nodes.map(node => node.id)).toEqual(['new-node'])
    expect(spawned).toEqual([{ runId: 'existing-run', nodeId: 'new-node', projectDir: 'runs/existing-run/repo' }])
    expect(savedRuns.at(-1)?.activeRoundId).toBe('round-2')
  })

  it('assigns a unique run workspace even when workflow project names match', async () => {
    const projectDirs: string[] = []
    const processManager = {
      materializeAttachments: (projectDir: string) => {
        projectDirs.push(projectDir)
        return []
      },
      spawn: (
        _runId: string,
        _nodeId: string,
        _agentType: string,
        _agentName: string,
        _prompt: string,
        _codeContext: unknown,
        _attachments: unknown,
        projectDir: string,
      ) => {
        projectDirs.push(projectDir)
      },
      kill: () => {},
    }
    const store = { saveRun: async () => undefined }
    const engine = new DAGEngine(processManager as never, store as never, () => undefined, WS_ROOT)

    const firstRun = await engine.startWorkflow({
      name: 'shared flow',
      projectName: 'shared-name',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: false,
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan first' },
      ],
      edges: [],
    })
    const secondRun = await engine.startWorkflow({
      name: 'shared flow',
      projectName: 'shared-name',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: false,
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan second' },
      ],
      edges: [],
    })

    expect(firstRun.workspacePath).toBe(`runs/${firstRun.id}/repo`)
    expect(secondRun.workspacePath).toBe(`runs/${secondRun.id}/repo`)
    expect(new Set(projectDirs)).toEqual(new Set([firstRun.workspacePath, secondRun.workspacePath]))
  })

  it('runs only one ready node at a time by default while preserving DAG dependencies', async () => {
    const spawned: string[] = []
    const completeByNode = new Map<string, (exitCode: number) => void>()
    const processManager = {
      materializeAttachments: () => [],
      spawn: (
        _runId: string,
        nodeId: string,
        _agentType: string,
        _agentName: string,
        _prompt: string,
        _codeContext: unknown,
        _attachments: unknown,
        _projectDir: string,
        onLog: (nodeId: string, line: string) => void,
        onComplete: (nodeId: string, exitCode: number) => void,
      ) => {
        spawned.push(nodeId)
        onLog(nodeId, `${nodeId} output`)
        completeByNode.set(nodeId, (exitCode: number) => onComplete(nodeId, exitCode))
      },
      kill: () => {},
    }
    const store = { saveRun: async () => undefined }
    const engine = new DAGEngine(processManager as never, store as never, () => undefined, WS_ROOT)

    await engine.startWorkflow({
      name: 'serial dag',
      projectName: 'serial-dag',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: false,
      nodes: [
        { id: 'planner', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan' },
        { id: 'backend', agentName: 'backend-dev', agentType: 'custom', promptTemplate: 'backend {{nodes.planner.output}}' },
        { id: 'designer', agentName: 'designer', agentType: 'omc', promptTemplate: 'design {{nodes.planner.output}}' },
        { id: 'frontend', agentName: 'frontend-dev', agentType: 'custom', promptTemplate: 'frontend {{nodes.backend.output}}' },
        { id: 'test', agentName: 'test-engineer', agentType: 'omc', promptTemplate: 'test {{nodes.frontend.output}} {{nodes.designer.output}}' },
      ],
      edges: [
        { from: 'planner', to: 'backend' },
        { from: 'planner', to: 'designer' },
        { from: 'backend', to: 'frontend' },
        { from: 'frontend', to: 'test' },
        { from: 'designer', to: 'test' },
      ],
    })

    expect(spawned).toEqual(['planner'])

    completeByNode.get('planner')?.(0)
    expect(spawned).toEqual(['planner', 'backend'])

    completeByNode.get('backend')?.(0)
    expect(spawned).toEqual(['planner', 'backend', 'designer'])

    completeByNode.get('designer')?.(0)
    expect(spawned).toEqual(['planner', 'backend', 'designer', 'frontend'])

    completeByNode.get('frontend')?.(0)
    expect(spawned).toEqual(['planner', 'backend', 'designer', 'frontend', 'test'])
  })

  it('persists log snapshots as a node is running', async () => {
    const savedRuns: Array<{ nodes: Array<{ id: string; logs: string[] }> }> = []
    const processManager = {
      materializeAttachments: () => [],
      spawn: (
        _runId: string,
        nodeId: string,
        _agentType: string,
        _agentName: string,
        _prompt: string,
        _codeContext: unknown,
        _attachments: unknown,
        _projectDir: string,
        onLog: (nodeId: string, line: string) => void,
      ) => {
        onLog(nodeId, 'first running line')
      },
      kill: () => {},
    }
    const store = {
      saveRun: async (run: unknown) => {
        savedRuns.push(JSON.parse(JSON.stringify(run)))
      },
    }
    const engine = new DAGEngine(processManager as never, store as never, () => undefined, WS_ROOT)

    vi.useFakeTimers()
    await engine.startWorkflow({
      name: 'snapshot flow',
      projectName: 'snapshot-flow',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: true,
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan' },
      ],
      edges: [],
    })
    vi.advanceTimersByTime(1000)

    expect(savedRuns.some(run => run.nodes[0]?.logs.includes('first running line'))).toBe(true)
  })

  it('throttles log persistence instead of rewriting the run for every line', async () => {
    const savedRuns: Array<{ nodes: Array<{ logs: string[] }> }> = []
    let emit!: (line: string) => void
    const processManager = {
      materializeAttachments: () => [],
      spawn: (
        _runId: string, nodeId: string, _agentType: string, _agentName: string, _prompt: string,
        _codeContext: unknown, _attachments: unknown, _projectDir: string,
        onLog: (nodeId: string, line: string) => void,
      ) => {
        emit = line => onLog(nodeId, line)
      },
      kill: () => {},
    }
    const store = { saveRun: async (run: unknown) => { savedRuns.push(JSON.parse(JSON.stringify(run))) } }
    const engine = new DAGEngine(processManager as never, store as never, () => undefined, WS_ROOT)

    vi.useFakeTimers()
    await engine.startWorkflow({
      name: 'chatty', globalPrompt: 'g', requireConfirm: false,
      nodes: [{ id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'p' }],
      edges: [],
    })
    const savesBeforeLogs = savedRuns.length
    for (let i = 0; i < 500; i++) emit(`line ${i}`)

    expect(savedRuns.length).toBe(savesBeforeLogs)
    vi.advanceTimersByTime(1000)
    expect(savedRuns.length).toBe(savesBeforeLogs + 1)
    expect(savedRuns.at(-1)?.nodes[0].logs).toHaveLength(500)
  })

  it('compacts duplicated adjacent output blocks before broadcasting the confirmation summary', async () => {
    const broadcasts: Array<{ type: string; payload: Record<string, unknown> }> = []
    let completeFirstNode: ((exitCode: number) => void) | null = null

    const processManager = {
      materializeAttachments: () => [],
      spawn: (
        _runId: string,
        nodeId: string,
        _agentType: string,
        _agentName: string,
        _prompt: string,
        _codeContext: unknown,
        _attachments: unknown,
        _projectDir: string,
        onLog: (nodeId: string, line: string) => void,
        onComplete: (nodeId: string, exitCode: number) => void,
      ) => {
        onLog(nodeId, '第一段需求分析')
        onLog(nodeId, '第二段系统现状')
        onLog(nodeId, '第一段需求分析')
        onLog(nodeId, '第二段系统现状')
        completeFirstNode = (exitCode: number) => onComplete(nodeId, exitCode)
      },
      kill: () => {},
    }
    const store = { saveRun: async () => undefined }
    const engine = new DAGEngine(processManager as never, store as never, msg => broadcasts.push(msg as never), WS_ROOT)

    await engine.startWorkflow({
      name: 'confirm flow',
      projectName: 'confirm-flow',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: true,
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan' },
      ],
      edges: [],
    })

    completeFirstNode?.(0)

    expect(broadcasts).toContainEqual({
      type: 'task:confirm_required',
      payload: {
        runId: expect.any(String),
        roundId: 'round-1',
        nodeId: 'A',
        summary: '第一段需求分析\n第二段系统现状',
        nextNodeIds: [],
      },
    })
  })

  it('uses the full compacted node transcript as the confirmation summary', async () => {
    const broadcasts: Array<{ type: string; payload: Record<string, unknown> }> = []
    let completeFirstNode: ((exitCode: number) => void) | null = null

    const processManager = {
      materializeAttachments: () => [],
      spawn: (
        _runId: string,
        nodeId: string,
        _agentType: string,
        _agentName: string,
        _prompt: string,
        _codeContext: unknown,
        _attachments: unknown,
        _projectDir: string,
        onLog: (nodeId: string, line: string) => void,
        onComplete: (nodeId: string, exitCode: number) => void,
      ) => {
        onLog(nodeId, '第一段需求分析')
        onLog(nodeId, '第一段需求分析')
        onLog(nodeId, '第二段系统现状')
        onLog(nodeId, '第三段方案')
        onLog(nodeId, '第四段问题')
        completeFirstNode = (exitCode: number) => onComplete(nodeId, exitCode)
      },
      kill: () => {},
    }
    const store = { saveRun: async () => undefined }
    const engine = new DAGEngine(processManager as never, store as never, msg => broadcasts.push(msg as never), WS_ROOT)

    await engine.startWorkflow({
      name: 'confirm flow',
      projectName: 'confirm-flow',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: true,
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan' },
      ],
      edges: [],
    })

    completeFirstNode?.(0)

    expect(broadcasts).toContainEqual({
      type: 'task:confirm_required',
      payload: {
        runId: expect.any(String),
        roundId: 'round-1',
        nodeId: 'A',
        summary: '第一段需求分析\n第二段系统现状\n第三段方案\n第四段问题',
        nextNodeIds: [],
      },
    })
  })

  it('appends manual confirmation instructions to downstream node prompts', async () => {
    const broadcasts: unknown[] = []
    const spawnedPrompts: string[] = []
    let completeFirstNode: ((exitCode: number) => void) | null = null

    const processManager = {
      materializeAttachments: () => [],
      spawn: (
        _runId: string,
        nodeId: string,
        _agentType: string,
        _agentName: string,
        prompt: string,
        _codeContext: unknown,
        _attachments: unknown,
        _projectDir: string,
        onLog: (nodeId: string, line: string) => void,
        onComplete: (nodeId: string, exitCode: number) => void,
      ) => {
        spawnedPrompts.push(prompt)
        if (nodeId === 'A') {
          onLog(nodeId, 'A output')
          completeFirstNode = (exitCode: number) => onComplete(nodeId, exitCode)
        }
      },
      kill: () => {},
    }
    const store = { saveRun: async () => undefined }
    const engine = new DAGEngine(processManager as never, store as never, msg => broadcasts.push(msg), WS_ROOT)

    const run = await engine.startWorkflow({
      name: 'confirm flow',
      projectName: 'confirm-flow',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: true,
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan' },
        { id: 'B', agentName: 'coder', agentType: 'custom', promptTemplate: 'code from {{nodes.A.output}}' },
      ],
      edges: [{ from: 'A', to: 'B' }],
    })

    completeFirstNode?.(0)
    engine.confirmNode(run.id, 'A', '后续步骤请优先修改 RunnerPage')

    expect(spawnedPrompts[1]).toContain('code from A output')
    expect(spawnedPrompts[1]).toContain('# 用户确认补充')
    expect(spawnedPrompts[1]).toContain('后续步骤请优先修改 RunnerPage')
    // 补充内容只经 instructionBlock 进入下游提示词一次；系统日志行不进入提示词
    expect(spawnedPrompts[1].split('后续步骤请优先修改 RunnerPage')).toHaveLength(2)
    expect(spawnedPrompts[1]).not.toContain('[system:')
    const nodeA = engine.getActiveRuns().find(r => r.id === run.id)?.nodes.find(n => n.id === 'A')
    expect(nodeA?.logs).toContain('[system:user_note] User confirmation note: 后续步骤请优先修改 RunnerPage')
    expect(broadcasts).toContainEqual({
      type: 'agent:log',
      payload: expect.objectContaining({ nodeId: 'A', line: '[system:user_note] User confirmation note: 后续步骤请优先修改 RunnerPage' }),
    })
  })
})


describe('DAGEngine cancellation', () => {
  it('marks waiting nodes failed and broadcasts the cancellation state', async () => {
    const broadcasts: Array<{ type: string; payload: Record<string, unknown> }> = []
    let completeFirstNode: ((exitCode: number) => void) | null = null

    const processManager = {
      materializeAttachments: () => [],
      spawn: (
        _runId: string,
        nodeId: string,
        _agentType: string,
        _agentName: string,
        _prompt: string,
        _codeContext: unknown,
        _attachments: unknown,
        _projectDir: string,
        onLog: (nodeId: string, line: string) => void,
        onComplete: (nodeId: string, exitCode: number) => void,
      ) => {
        if (nodeId === 'A') {
          onLog(nodeId, 'A output')
          completeFirstNode = (exitCode: number) => onComplete(nodeId, exitCode)
        }
      },
      kill: () => {},
    }
    const savedRuns: unknown[] = []
    const store = { saveRun: async (run: unknown) => { savedRuns.push(run) } }
    const engine = new DAGEngine(processManager as never, store as never, msg => broadcasts.push(msg as never), WS_ROOT)

    const run = await engine.startWorkflow({
      name: 'cancel flow',
      projectName: 'cancel-flow',
      globalPrompt: 'global',
      codeContext: [],
      attachments: [],
      requireConfirm: true,
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'plan' },
        { id: 'B', agentName: 'coder', agentType: 'custom', promptTemplate: 'code from {{nodes.A.output}}' },
      ],
      edges: [{ from: 'A', to: 'B' }],
    })

    completeFirstNode?.(0)
    engine.cancelRun(run.id)

    expect((savedRuns.at(-1) as { nodes: Array<{ id: string; logs: string[] }> }).nodes.find(node => node.id === 'A')?.logs.at(-1)).toBe('[system:run_terminated] Workflow terminated.')
    expect(broadcasts).toContainEqual({
      type: 'agent:log',
      payload: expect.objectContaining({ nodeId: 'A', line: '[system:run_terminated] Workflow terminated.' }),
    })
    expect(broadcasts).toContainEqual({
      type: 'workflow:node_status',
      payload: expect.objectContaining({ runId: run.id, nodeId: 'A', status: 'failed' }),
    })
    expect(broadcasts).toContainEqual({ type: 'workflow:status', payload: { runId: run.id, roundId: 'round-1', status: 'failed' } })
    expect((savedRuns.at(-1) as { nodes: Array<{ id: string; status: string }> }).nodes.find(node => node.id === 'A')?.status).toBe('failed')
  })
})

describe('auto-fix helpers', () => {
  it('detectReviewIssues finds keyword hits in zh and en', () => {
    expect(detectReviewIssues('All good, looks great')).toBe(false)
    expect(detectReviewIssues('Fixed all issues, no errors remain')).toBe(false)
    expect(detectReviewIssues('没有发现问题，修复完成')).toBe(false)
    expect(detectReviewIssues('Found 1 critical issue at server/handler.go')).toBe(true)
    expect(detectReviewIssues('发现严重问题：缺少错误处理')).toBe(true)
    expect(detectReviewIssues('')).toBe(false)
    expect(detectReviewIssues(undefined)).toBe(false)
  })

  it('extractAffectedPaths picks up code-like paths from review text', () => {
    const text = 'In `workspace/project/server/handler.go` and src/components/Button.tsx the validator misses null checks.'
    const paths = extractAffectedPaths(text)
    expect(paths).toContain('workspace/project/server/handler.go')
    expect(paths).toContain('src/components/Button.tsx')
  })

  it('suggestFixAgentByRule maps paths to backend / frontend / flutter dev agents', () => {
    expect(suggestFixAgentByRule(['workspace/project/server/main.go'])).toBe('backend-dev')
    expect(suggestFixAgentByRule(['workspace/project/client/App.tsx'])).toBe('frontend-dev')
    expect(suggestFixAgentByRule(['workspace/project/app/main.dart'])).toBe('flutter-dev')
    expect(suggestFixAgentByRule(['docs/README.md'])).toBeNull()
  })
})

describe('DAGEngine auto-fix loop', () => {
  function makeEngine() {
    const broadcasts: Array<Record<string, unknown>> = []
    const completeByNode = new Map<string, (exitCode: number) => void>()
    const logByNode = new Map<string, (line: string) => void>()
    const processManager = {
      materializeAttachments: () => [],
      spawn: (
        _runId: string,
        nodeId: string,
        _agentType: string,
        _agentName: string,
        _prompt: string,
        _codeContext: unknown,
        _attachments: unknown,
        _projectDir: string,
        onLog: (nodeId: string, line: string) => void,
        onComplete: (nodeId: string, exitCode: number) => void,
      ) => {
        logByNode.set(nodeId, line => onLog(nodeId, line))
        completeByNode.set(nodeId, exitCode => onComplete(nodeId, exitCode))
      },
      kill: () => {},
    }
    const store = { saveRun: async () => undefined, loadRun: async () => null }
    const engine = new DAGEngine(processManager as never, store as never, msg => { broadcasts.push(msg as never) }, WS_ROOT)
    return { engine, broadcasts, completeByNode, logByNode }
  }

  it('emits task:auto_fix_required with rule-based agent suggestion when reviewer flags issues', async () => {
    const { engine, broadcasts, completeByNode, logByNode } = makeEngine()

    const run = await engine.startWorkflow({
      name: 'review flow',
      globalPrompt: 'do work',
      requireConfirm: false,
      nodes: [
        { id: 'dev', agentName: 'backend-dev', agentType: 'custom', promptTemplate: 'build api' },
        { id: 'review', agentName: 'code-reviewer', agentType: 'omc', promptTemplate: 'review' },
      ],
      edges: [{ from: 'dev', to: 'review' }],
    })

    completeByNode.get('dev')?.(0)
    logByNode.get('review')?.('Found 1 critical issue in workspace/project/server/handler.go: missing null check')
    completeByNode.get('review')?.(0)

    const offerEvent = broadcasts.find(msg => msg.type === 'task:auto_fix_required')
    expect(offerEvent).toBeTruthy()
    const payload = (offerEvent as { payload: { suggestedAgent: string | null; suggestionSource: string; remainingBudget: number; affectedPaths: string[] } }).payload
    expect(payload.suggestedAgent).toBe('backend-dev')
    expect(payload.suggestionSource).toBe('rule')
    expect(payload.remainingBudget).toBe(MAX_AUTO_FIX_ROUNDS)
    expect(payload.affectedPaths).toContain('workspace/project/server/handler.go')
    expect(broadcasts.find(msg => msg.type === 'task:completed')).toBeFalsy()
    expect(run.status).toBe('paused')
  })

  it('falls back to ai-fallback when rule cannot match the affected files', async () => {
    const { engine, broadcasts, completeByNode, logByNode } = makeEngine()

    await engine.startWorkflow({
      name: 'misc flow',
      globalPrompt: 'do work',
      requireConfirm: false,
      nodes: [
        { id: 'dev', agentName: 'data-pipeline', agentType: 'custom', promptTemplate: 'build pipeline' },
        { id: 'review', agentName: 'code-reviewer', agentType: 'omc', promptTemplate: 'review' },
      ],
      edges: [{ from: 'dev', to: 'review' }],
    })

    completeByNode.get('dev')?.(0)
    logByNode.get('review')?.('Found a critical bug in pipelines/extract.py — crashes on empty input')
    completeByNode.get('review')?.(0)

    const offerEvent = broadcasts.find(msg => msg.type === 'task:auto_fix_required') as { payload: { suggestedAgent: string | null; suggestionSource: string } }
    expect(offerEvent.payload.suggestedAgent).toBeNull()
    expect(offerEvent.payload.suggestionSource).toBe('ai-fallback')
  })

  it('completes the workflow normally when reviewer reports no issues', async () => {
    const { engine, broadcasts, completeByNode, logByNode } = makeEngine()

    await engine.startWorkflow({
      name: 'happy flow',
      globalPrompt: 'do work',
      requireConfirm: false,
      nodes: [
        { id: 'dev', agentName: 'backend-dev', agentType: 'custom', promptTemplate: 'build api' },
        { id: 'review', agentName: 'code-reviewer', agentType: 'omc', promptTemplate: 'review' },
      ],
      edges: [{ from: 'dev', to: 'review' }],
    })

    completeByNode.get('dev')?.(0)
    logByNode.get('review')?.('Looks good, no concerns')
    completeByNode.get('review')?.(0)

    expect(broadcasts.find(msg => msg.type === 'task:auto_fix_required')).toBeFalsy()
    expect(broadcasts.find(msg => msg.type === 'task:completed')).toBeTruthy()
  })

  it('declineAutoFix marks the run completed without spawning another round', async () => {
    const { engine, broadcasts, completeByNode, logByNode } = makeEngine()

    const run = await engine.startWorkflow({
      name: 'decline flow',
      globalPrompt: 'do work',
      requireConfirm: false,
      nodes: [
        { id: 'dev', agentName: 'backend-dev', agentType: 'custom', promptTemplate: 'build api' },
        { id: 'review', agentName: 'code-reviewer', agentType: 'omc', promptTemplate: 'review' },
      ],
      edges: [{ from: 'dev', to: 'review' }],
    })

    completeByNode.get('dev')?.(0)
    logByNode.get('review')?.('critical bug: server/handler.go panics on nil')
    completeByNode.get('review')?.(0)

    engine.declineAutoFix(run.id)

    const completed = broadcasts.filter(msg => msg.type === 'task:completed')
    expect(completed.length).toBe(1)
    expect(broadcasts.findIndex(msg => msg.type === 'task:auto_fix_required'))
      .toBeLessThan(broadcasts.findIndex(msg => msg.type === 'task:completed'))
  })

  it('continueWorkflow after an auto-fix offer increments autoFixRound', async () => {
    const { engine, broadcasts, completeByNode, logByNode } = makeEngine()

    const run = await engine.startWorkflow({
      name: 'loop flow',
      globalPrompt: 'do work',
      requireConfirm: false,
      nodes: [
        { id: 'dev', agentName: 'backend-dev', agentType: 'custom', promptTemplate: 'build api' },
        { id: 'review', agentName: 'code-reviewer', agentType: 'omc', promptTemplate: 'review' },
      ],
      edges: [{ from: 'dev', to: 'review' }],
    })

    completeByNode.get('dev')?.(0)
    logByNode.get('review')?.('critical bug in workspace/project/server/handler.go')
    completeByNode.get('review')?.(0)
    expect(broadcasts.find(msg => msg.type === 'task:auto_fix_required')).toBeTruthy()

    const continued = await engine.continueWorkflow(run.id, {
      name: run.name,
      globalPrompt: 'fix the issues',
      nodes: [
        { id: 'fix', agentName: 'backend-dev', agentType: 'custom', promptTemplate: 'fix' },
        { id: 'review-2', agentName: 'code-reviewer', agentType: 'omc', promptTemplate: 'review again' },
      ],
      edges: [{ from: 'fix', to: 'review-2' }],
      requireConfirm: false,
    })

    expect(continued.autoFixRound).toBe(1)
    expect(continued.activeRoundId).toBe('round-2')
  })
})

describe('DAGEngine prompt interpolation', () => {
  function makeEngine(prompts: string[]) {
    const processManager = {
      materializeAttachments: () => [],
      spawn: (_runId: string, _nodeId: string, _agentType: string, _agentName: string, prompt: string) => {
        prompts.push(prompt)
      },
      kill: () => {},
    }
    const saved = new Map<string, unknown>()
    const store = {
      saveRun: async (run: { id: string }) => { saved.set(run.id, run) },
      loadRun: async (id: string) => saved.get(id) ?? null,
    }
    return new DAGEngine(processManager as never, store as never, () => undefined, WS_ROOT)
  }

  it('replaces {{globalPrompt}} with the user request when a template runs', async () => {
    const prompts: string[] = []
    const engine = makeEngine(prompts)

    await engine.startWorkflow({
      name: 'template run',
      globalPrompt: 'build a login page',
      requireConfirm: false,
      nodes: [{ id: 'n1', agentName: 'backend-dev', agentType: 'custom', promptTemplate: '{{globalPrompt}} — 实现后端 API' }],
      edges: [],
    })

    expect(prompts).toEqual(['build a login page — 实现后端 API'])
  })

  it('uses the new round request for {{globalPrompt}} when a run continues', async () => {
    const prompts: string[] = []
    const engine = makeEngine(prompts)
    const run = await engine.startWorkflow({
      name: 'first',
      globalPrompt: 'first request',
      requireConfirm: false,
      nodes: [{ id: 'n1', agentName: 'planner', agentType: 'omc', promptTemplate: '{{globalPrompt}}' }],
      edges: [],
    })
    engine.cancelRun(run.id)

    await engine.continueWorkflow(run.id, {
      name: 'second',
      globalPrompt: 'follow-up request',
      requireConfirm: false,
      nodes: [{ id: 'n2', agentName: 'designer', agentType: 'omc', promptTemplate: 'Design: {{globalPrompt}}' }],
      edges: [],
    })

    expect(prompts).toEqual(['first request', 'Design: follow-up request'])
  })
})

describe('interpolatePrompt with globalPrompt', () => {
  it('does not re-interpret placeholders that appear inside substituted text', () => {
    const nodes = [{ ...makeNode('A', 'completed'), output: 'see {{globalPrompt}}' }]
    expect(interpolatePrompt('{{globalPrompt}} / {{nodes.A.output}}', nodes, 'use $& and {{nodes.A.output}}'))
      .toBe('use $& and {{nodes.A.output}} / see {{globalPrompt}}')
  })

  it('replaces {{globalPrompt}} with an empty string when there is no request', () => {
    expect(interpolatePrompt('Task: {{globalPrompt}}', [])).toBe('Task: ')
  })
})

describe('DAGEngine parallel runs with step confirmation', () => {
  it('asks to confirm every parallel branch and finishes once all are confirmed', async () => {
    const broadcasts: Array<{ type: string; payload: Record<string, unknown> }> = []
    const complete = new Map<string, (exitCode: number) => void>()
    const processManager = {
      materializeAttachments: () => [],
      spawn: (
        _runId: string, nodeId: string, _agentType: string, _agentName: string, _prompt: string,
        _codeContext: unknown, _attachments: unknown, _projectDir: string,
        _onLog: unknown, onComplete: (nodeId: string, exitCode: number) => void,
      ) => {
        complete.set(nodeId, exitCode => onComplete(nodeId, exitCode))
      },
      kill: () => {},
    }
    const store = { saveRun: async () => undefined }
    const engine = new DAGEngine(processManager as never, store as never, msg => broadcasts.push(msg as never), WS_ROOT)

    const run = await engine.startWorkflow({
      name: 'parallel confirm',
      globalPrompt: 'g',
      requireConfirm: true,
      executionMode: 'dag',
      nodes: [
        { id: 'A', agentName: 'planner', agentType: 'omc', promptTemplate: 'a' },
        { id: 'B', agentName: 'designer', agentType: 'omc', promptTemplate: 'b' },
      ],
      edges: [],
    })
    expect([...complete.keys()].sort()).toEqual(['A', 'B'])

    await complete.get('A')!(0)
    await complete.get('B')!(0)
    const confirmsFor = (nodeId: string) =>
      broadcasts.filter(msg => msg.type === 'task:confirm_required' && msg.payload.nodeId === nodeId).length

    // 前端只显示一张确认卡（最后到达的 B）；确认 B 后必须重新提示 A，而不是丢掉它
    const beforeConfirmA = confirmsFor('A')
    engine.confirmNode(run.id, 'B')
    expect(confirmsFor('A')).toBe(beforeConfirmA + 1)
    expect(engine.getActiveRuns().find(r => r.id === run.id)?.status).toBe('paused')

    engine.confirmNode(run.id, 'A')
    expect(engine.getActiveRuns().some(r => r.id === run.id)).toBe(false)
    expect(broadcasts).toContainEqual({ type: 'task:completed', payload: { runId: run.id, roundId: 'round-1' } })
  })
})
