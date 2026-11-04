// 工作流画布的纯函数工具：环检测、规范化快照、同名节点标签

export interface GraphEdgePair {
  from: string
  to: string
}

export interface SnapshotNode {
  id: string
  agentName: string
  agentType: 'custom' | 'omc'
  displayName?: string
  promptTemplate: string
}

/** 新增 from→to 是否会成环：从 to 出发沿现有边能否到达 from（自连也算环）。 */
export function wouldCreateCycle(edges: GraphEdgePair[], from: string, to: string): boolean {
  if (from === to) return true

  const next = new Map<string, string[]>()
  for (const edge of edges) {
    const bucket = next.get(edge.from)
    if (bucket) bucket.push(edge.to)
    else next.set(edge.from, [edge.to])
  }

  const visited = new Set<string>([to])
  const stack = [to]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const neighbor of next.get(current) ?? []) {
      if (neighbor === from) return true
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        stack.push(neighbor)
      }
    }
  }
  return false
}

/** 规范化快照：节点按 id、边按 from/to 排序，空白展示名等同于未设置。 */
export function snapshotWorkflow(nodes: SnapshotNode[], edges: GraphEdgePair[]): string {
  const normalizedNodes = nodes
    .map(node => [
      node.id,
      node.agentName,
      node.agentType,
      node.displayName?.trim() || '',
      node.promptTemplate,
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const normalizedEdges = edges
    .map(edge => [edge.from, edge.to])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1)))
  return JSON.stringify([normalizedNodes, normalizedEdges])
}

/** 节点展示标签：displayName || agentName；名称重复的节点按画布顺序追加 #序号。 */
export function labelDuplicateNodes(
  nodes: Array<{ id: string; displayName?: string; agentName: string }>
): Map<string, string> {
  const base = nodes.map(node => ({ id: node.id, label: node.displayName || node.agentName }))
  const total = new Map<string, number>()
  base.forEach(item => total.set(item.label, (total.get(item.label) ?? 0) + 1))

  const seen = new Map<string, number>()
  const result = new Map<string, string>()
  base.forEach(item => {
    if ((total.get(item.label) ?? 0) <= 1) {
      result.set(item.id, item.label)
      return
    }
    const index = (seen.get(item.label) ?? 0) + 1
    seen.set(item.label, index)
    result.set(item.id, `${item.label} #${index}`)
  })
  return result
}
