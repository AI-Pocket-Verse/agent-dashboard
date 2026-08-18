import { describe, it, expect, vi, afterEach } from 'vitest'
import { chmodSync, existsSync, rmSync, writeFileSync } from 'fs'
import { ProcessManager } from '../../src/processes/manager.js'

const SLEEP_SCRIPT = '/tmp/agent-dashboard-process-sleep.sh'

function writeSleepScript() {
  writeFileSync(SLEEP_SCRIPT, '#!/bin/sh\nsleep 10\n')
  chmodSync(SLEEP_SCRIPT, 0o755)
  return SLEEP_SCRIPT
}

describe('ProcessManager', () => {
  let manager: ProcessManager

  afterEach(() => {
    manager?.killAll()
    if (existsSync(SLEEP_SCRIPT)) rmSync(SLEEP_SCRIPT)
  })

  it('tracks running process by nodeId', async () => {
    manager = new ProcessManager('/tmp', 'echo')
    const onLog = vi.fn()
    const onComplete = vi.fn()
    manager.spawn('run-1', 'node-1', 'custom', 'test-agent', 'hello world', [], [], 'test-project', onLog, onComplete)
    await new Promise(r => setTimeout(r, 200))
    expect(onLog).toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalledWith('node-1', 0)
  })

  it('can kill a running process', async () => {
    manager = new ProcessManager('/tmp', 'sleep')
    const onComplete = vi.fn()
    manager.spawn('run-1', 'node-1', 'custom', 'test-agent', '10', [], [], 'test-project', vi.fn(), onComplete)
    await new Promise(r => setTimeout(r, 50))
    manager.kill('run-1', 'node-1')
    await new Promise(r => setTimeout(r, 200))
    expect(onComplete).toHaveBeenCalledWith('node-1', expect.any(Number))
  })

  it('killAll stops all processes', async () => {
    manager = new ProcessManager('/tmp', 'sleep')
    manager.spawn('run-1', 'node-1', 'custom', 'test-agent', '10', [], [], 'test-project', vi.fn(), vi.fn())
    manager.spawn('run-1', 'node-2', 'custom', 'test-agent', '10', [], [], 'test-project', vi.fn(), vi.fn())
    expect(manager.getRunningCount()).toBe(2)
    manager.killAll()
    await new Promise(r => setTimeout(r, 200))
    expect(manager.getRunningCount()).toBe(0)
  })

  it('includes attachment paths in the prompt after materializing files', async () => {
    manager = new ProcessManager('/tmp', 'echo')
    const onLog = vi.fn()
    const attachments = manager.materializeAttachments('attachment-test', [{
      name: 'spec.txt',
      mime: 'text/plain',
      contentBase64: Buffer.from('hello attachment').toString('base64'),
    }])

    manager.spawn('run-1', 'node-1', 'custom', 'test-agent', 'review attachment', [], attachments, 'attachment-test', onLog, vi.fn())
    await new Promise(r => setTimeout(r, 200))

    const combinedLog = onLog.mock.calls.map(([, line]) => line).join('\n')
    expect(combinedLog).toContain('# 附件')
    expect(combinedLog).toContain('spec.txt')
    expect(combinedLog).toContain(attachments[0].path)
  })

  it('does not emit dashboard system progress logs', async () => {
    manager = new ProcessManager('/tmp', writeSleepScript(), { maxRunMs: 0 })
    const onLog = vi.fn()

    manager.spawn('run-1', 'node-1', 'omc', 'architect', '10', [], [], 'test-project', onLog, vi.fn())
    await new Promise(r => setTimeout(r, 50))

    const combinedLog = onLog.mock.calls.map(([, line]) => line).join('\n')
    expect(combinedLog).not.toContain('[系统]')
    expect(combinedLog).not.toContain('等待模型输出')
  })

  it('does not warn when a running process has no model output', async () => {
    manager = new ProcessManager('/tmp', writeSleepScript(), { maxRunMs: 0 })
    const onLog = vi.fn()

    manager.spawn('run-1', 'node-1', 'omc', 'architect', '10', [], [], 'test-project', onLog, vi.fn())
    await new Promise(r => setTimeout(r, 80))

    const combinedLog = onLog.mock.calls.map(([, line]) => line).join('\n')
    expect(combinedLog).not.toContain('[系统]')
    expect(combinedLog).not.toContain(['已运行', '超过'].join(''))
  })

  it('terminates a process that exceeds the configured max runtime', async () => {
    manager = new ProcessManager('/tmp', writeSleepScript(), { maxRunMs: 50 })
    const onLog = vi.fn()
    const onComplete = vi.fn()

    manager.spawn('run-1', 'node-1', 'omc', 'architect', '10', [], [], 'test-project', onLog, onComplete)
    await new Promise(r => setTimeout(r, 180))

    const combinedLog = onLog.mock.calls.map(([, line]) => line).join('\n')
    expect(combinedLog).not.toContain('[系统]')
    expect(combinedLog).not.toContain('执行超过最大时长')
    expect(onComplete).toHaveBeenCalledWith('node-1', expect.any(Number))
    expect(manager.getRunningCount()).toBe(0)
  })

  it('adds the OMC agent role to the prompt when no CLI agent flag is used', async () => {
    manager = new ProcessManager('/tmp', 'echo')
    const onLog = vi.fn()

    manager.spawn('run-1', 'node-1', 'omc', 'architect', 'design api', [], [], 'test-project', onLog, vi.fn())
    await new Promise(r => setTimeout(r, 200))

    const combinedLog = onLog.mock.calls.map(([, line]) => line).join('\n')
    expect(combinedLog).toContain('# Agent 角色')
    expect(combinedLog).toContain('当前节点 Agent: architect')
  })

  it('injects an absolute WORK_DIR scoped to the run for custom dev agents', async () => {
    manager = new ProcessManager('/tmp', 'echo')
    const onLog = vi.fn()

    manager.spawn('run-1', 'node-1', 'custom', 'frontend-dev', 'build login UI', [], [], 'runs/run-1/repo', onLog, vi.fn())
    await new Promise(r => setTimeout(r, 200))

    const combinedLog = onLog.mock.calls.map(([, line]) => line).join('\n')
    expect(combinedLog).toContain('# 工作目录约束')
    expect(combinedLog).toContain('WORK_DIR = /tmp/runs/run-1/repo/workspace/project/client')
    expect(combinedLog).toContain('WORK_DIR_NAME = client')
  })

  it('uses agent-specific subdirs for each custom dev agent', async () => {
    manager = new ProcessManager('/tmp', 'echo')

    const cases: Array<[string, string]> = [
      ['frontend-dev', 'workspace/project/client'],
      ['backend-dev',  'workspace/project/server'],
      ['flutter-dev',  'workspace/project/app'],
    ]

    for (const [agent, expectedSubdir] of cases) {
      const onLog = vi.fn()
      manager.spawn('run-1', `node-${agent}`, 'custom', agent, 'task', [], [], 'runs/run-1/repo', onLog, vi.fn())
      await new Promise(r => setTimeout(r, 150))
      const combinedLog = onLog.mock.calls.map(([, line]) => line).join('\n')
      expect(combinedLog).toContain(`WORK_DIR = /tmp/runs/run-1/repo/${expectedSubdir}`)
    }
  })

  it('falls back to workspace/project/<agentName> for unrecognised custom agents', async () => {
    manager = new ProcessManager('/tmp', 'echo')
    const onLog = vi.fn()

    manager.spawn('run-1', 'node-1', 'custom', 'code-reviewer', 'task', [], [], 'runs/run-1/repo', onLog, vi.fn())
    await new Promise(r => setTimeout(r, 200))

    const combinedLog = onLog.mock.calls.map(([, line]) => line).join('\n')
    expect(combinedLog).toContain('WORK_DIR = /tmp/runs/run-1/repo/workspace/project/code-reviewer')
    expect(combinedLog).toContain('WORK_DIR_NAME = code-reviewer')
  })
})
