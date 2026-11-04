import type { Edge } from '@agent-dashboard/shared'

// 校验工作流图：边只能引用已有节点、节点 id 不重复、不能成环（成环的节点永远等不到前置完成，运行会卡死）
export function assertValidDag(nodes: Array<{ id: string }>, edges: Edge[]): void {
  const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''
  if (
    !Array.isArray(nodes) || !Array.isArray(edges)
    || !nodes.every(node => isText(node?.id))
    || !edges.every(edge => isText(edge?.from) && isText(edge?.to))
  ) {
    throw new Error('工作流节点或连线格式不正确')
  }
  const ids = new Set<string>()
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error(`节点 id 重复: ${node.id}`)
    ids.add(node.id)
  }
  const indegree = new Map([...ids].map(id => [id, 0]))
  for (const edge of edges) {
    for (const end of [edge.from, edge.to]) {
      if (!ids.has(end)) throw new Error(`连线引用了不存在的节点: ${end}`)
    }
    indegree.set(edge.to, indegree.get(edge.to)! + 1)
  }

  // Kahn 拓扑排序：剩下入度不为 0 的节点就在环上或环的下游
  const queue = [...ids].filter(id => indegree.get(id) === 0)
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    indegree.delete(id)
    for (const edge of edges) {
      if (edge.from !== id) continue
      const next = indegree.get(edge.to)! - 1
      indegree.set(edge.to, next)
      if (next === 0) queue.push(edge.to)
    }
  }
  if (indegree.size > 0) {
    throw new Error(`工作流连线成环，无法执行（涉及节点：${[...indegree.keys()].join(', ')}）`)
  }
}
