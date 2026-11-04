import { afterAll, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AiSelector, killActiveSelections } from '../../src/ai/selector.js'

// config.ts 在导入时要求 PROJECT_ROOT
vi.hoisted(() => { process.env.PROJECT_ROOT ??= '/tmp' })

const dir = mkdtempSync(join(tmpdir(), 'agent-dashboard-selector-'))
const PLAN = '{"nodes":[{"id":"a","agentName":"planner","agentType":"omc","promptTemplate":"p"}],"edges":[],"explanation":"e"}'
const agents = [{ name: 'planner', type: 'omc' as const, description: 'plans', status: 'idle' as const }]

function script(name: string, body: string) {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('AiSelector', () => {
  it('does not block the event loop while claude is planning', async () => {
    const selector = new AiSelector({ claudeBin: script('slow.sh', `sleep 1\necho '${PLAN}'`), timeoutMs: 10_000 })
    const events: string[] = []
    const timer = new Promise<void>(resolve => setTimeout(() => { events.push('timer'); resolve() }, 50))

    const result = selector.selectAgents('build it', agents).then(plan => { events.push('selected'); return plan })
    await Promise.all([timer, result])

    expect(events).toEqual(['timer', 'selected'])
    expect((await result).nodes[0].agentName).toBe('planner')
  })

  it('fails with a clear reason when claude exceeds the timeout', async () => {
    const selector = new AiSelector({ claudeBin: script('hang.sh', 'sleep 5'), timeoutMs: 200 })
    const started = Date.now()

    await expect(selector.selectAgents('build it', agents)).rejects.toThrow('AI selection timed out after 0.2s (AI_SELECT_TIMEOUT_MS)')
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('killActiveSelections terminates in-flight planning processes on shutdown', async () => {
    const selector = new AiSelector({ claudeBin: script('long.sh', 'echo started\nsleep 5'), timeoutMs: 10_000 })
    const started = Date.now()
    const pending = selector.selectAgents('build it', agents)
    await new Promise(r => setTimeout(r, 200))

    killActiveSelections()

    await expect(pending).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('force-kills a planner that ignores SIGTERM after the timeout', async () => {
    const selector = new AiSelector({ claudeBin: script('stubborn.sh', "trap '' TERM\nsleep 5"), timeoutMs: 200, killGraceMs: 100 })
    const started = Date.now()

    await expect(selector.selectAgents('build it', agents)).rejects.toThrow('AI selection timed out')
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
