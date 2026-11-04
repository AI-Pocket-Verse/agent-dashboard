import { describe, expect, it } from 'vitest'
import { labelDuplicateNodes, snapshotWorkflow, wouldCreateCycle } from '../../src/lib/workflowGraph'

describe('wouldCreateCycle', () => {
  const chain = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }]

  it('rejects self loops', () => {
    expect(wouldCreateCycle([], 'A', 'A')).toBe(true)
  })

  it('rejects an edge that closes a longer path (A→B→C→A)', () => {
    expect(wouldCreateCycle(chain, 'C', 'A')).toBe(true)
  })

  it('rejects a direct reverse edge (A⇄B)', () => {
    expect(wouldCreateCycle(chain, 'B', 'A')).toBe(true)
  })

  it('allows forward shortcuts and unrelated nodes', () => {
    expect(wouldCreateCycle(chain, 'A', 'C')).toBe(false)
    expect(wouldCreateCycle(chain, 'C', 'D')).toBe(false)
  })

  it('terminates on diamonds and pre-existing cycles', () => {
    const diamond = [
      { from: 'A', to: 'B' }, { from: 'A', to: 'C' },
      { from: 'B', to: 'D' }, { from: 'C', to: 'D' },
    ]
    expect(wouldCreateCycle(diamond, 'D', 'A')).toBe(true)
    expect(wouldCreateCycle(diamond, 'B', 'C')).toBe(false)
    expect(wouldCreateCycle([{ from: 'X', to: 'Y' }, { from: 'Y', to: 'X' }], 'A', 'X')).toBe(false)
  })
})

describe('snapshotWorkflow', () => {
  const node = (id: string, extra = {}) => ({
    id, agentName: 'planner', agentType: 'omc' as const, promptTemplate: '{{globalPrompt}}', ...extra,
  })

  it('is independent of node and edge order', () => {
    const a = snapshotWorkflow([node('1'), node('2')], [{ from: '1', to: '2' }, { from: '2', to: '3' }])
    const b = snapshotWorkflow([node('2'), node('1')], [{ from: '2', to: '3' }, { from: '1', to: '2' }])
    expect(a).toBe(b)
  })

  it('treats empty and blank displayName as the same', () => {
    expect(snapshotWorkflow([node('1', { displayName: '  ' })], []))
      .toBe(snapshotWorkflow([node('1')], []))
  })

  it('changes when any tracked field or edge changes', () => {
    const base = snapshotWorkflow([node('1')], [])
    expect(snapshotWorkflow([node('1', { promptTemplate: 'x' })], [])).not.toBe(base)
    expect(snapshotWorkflow([node('1', { agentName: 'writer' })], [])).not.toBe(base)
    expect(snapshotWorkflow([node('1', { agentType: 'custom' })], [])).not.toBe(base)
    expect(snapshotWorkflow([node('1', { displayName: 'n' })], [])).not.toBe(base)
    expect(snapshotWorkflow([node('1')], [{ from: '1', to: '2' }])).not.toBe(base)
  })
})

describe('labelDuplicateNodes', () => {
  it('keeps unique labels unchanged', () => {
    const labels = labelDuplicateNodes([
      { id: '1', agentName: 'planner' },
      { id: '2', agentName: 'writer', displayName: '文档' },
    ])
    expect(labels.get('1')).toBe('planner')
    expect(labels.get('2')).toBe('文档')
  })

  it('numbers duplicates in canvas order', () => {
    const labels = labelDuplicateNodes([
      { id: '1', agentName: 'backend-dev' },
      { id: '2', agentName: 'planner' },
      { id: '3', agentName: 'x', displayName: 'backend-dev' },
      { id: '4', agentName: 'backend-dev' },
    ])
    expect(labels.get('1')).toBe('backend-dev #1')
    expect(labels.get('3')).toBe('backend-dev #2')
    expect(labels.get('4')).toBe('backend-dev #3')
    expect(labels.get('2')).toBe('planner')
  })
})
