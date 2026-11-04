import { describe, expect, it } from 'vitest'
import { assertValidDag } from '../../src/workflows/graph.js'

const FORMAT_ERROR = '工作流节点或连线格式不正确'

describe('assertValidDag', () => {
  it('rejects malformed nodes and edges with a readable message', () => {
    expect(() => assertValidDag([null] as never, [])).toThrow(FORMAT_ERROR)
    expect(() => assertValidDag([{}] as never, [])).toThrow(FORMAT_ERROR)
    expect(() => assertValidDag([{ id: 'A' }], [null] as never)).toThrow(FORMAT_ERROR)
    expect(() => assertValidDag([{ id: 'A' }], [{ from: 'A' }] as never)).toThrow(FORMAT_ERROR)
  })

  it('accepts diamonds and duplicate edges, rejects cycles and dangling edges', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]
    expect(() => assertValidDag(nodes, [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'B', to: 'C' }, { from: 'B', to: 'C' }])).not.toThrow()
    expect(() => assertValidDag(nodes, [{ from: 'A', to: 'A' }])).toThrow('工作流连线成环')
    expect(() => assertValidDag(nodes, [{ from: 'A', to: 'X' }])).toThrow('连线引用了不存在的节点: X')
    expect(() => assertValidDag([{ id: 'A' }, { id: 'A' }], [])).toThrow('节点 id 重复: A')
  })
})
