import type { Edge } from '../types/index'

interface LayoutNode {
  id: string
}

interface LayoutOptions {
  centerX?: number
  startY?: number
  rowGap?: number
  columnGap?: number
}

export function computeVerticalDagLayout<T extends LayoutNode>(
  nodes: T[],
  edges: Edge[],
  options: LayoutOptions = {}
): Map<string, { x: number; y: number }> {
  const centerX = options.centerX ?? 220
  const startY = options.startY ?? 72
  const rowGap = options.rowGap ?? 132
  const columnGap = options.columnGap ?? 220

  const order = new Map(nodes.map((node, index) => [node.id, index]))
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  const depth = new Map<string, number>()

  nodes.forEach(node => {
    incoming.set(node.id, [])
    outgoing.set(node.id, [])
    indegree.set(node.id, 0)
    depth.set(node.id, 0)
  })

  edges.forEach(edge => {
    if (!incoming.has(edge.to) || !outgoing.has(edge.from)) return
    incoming.get(edge.to)?.push(edge.from)
    outgoing.get(edge.from)?.push(edge.to)
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  })

  const queue = nodes
    .filter(node => (indegree.get(node.id) ?? 0) === 0)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map(node => node.id)

  const processed: string[] = []

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    processed.push(nodeId)

    for (const nextId of outgoing.get(nodeId) ?? []) {
      depth.set(nextId, Math.max(depth.get(nextId) ?? 0, (depth.get(nodeId) ?? 0) + 1))
      indegree.set(nextId, (indegree.get(nextId) ?? 0) - 1)
      if ((indegree.get(nextId) ?? 0) === 0) queue.push(nextId)
    }

    queue.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  }

  const remaining = nodes
    .map(node => node.id)
    .filter(nodeId => !processed.includes(nodeId))

  remaining.forEach((nodeId, index) => {
    depth.set(nodeId, (depth.get(nodeId) ?? 0) + index)
  })

  const layers = new Map<number, string[]>()
  nodes.forEach(node => {
    const layer = depth.get(node.id) ?? 0
    const bucket = layers.get(layer) ?? []
    bucket.push(node.id)
    layers.set(layer, bucket)
  })

  const sortedLayers = Array.from(layers.entries()).sort((a, b) => a[0] - b[0])
  const layerOrder = new Map<string, number>()

  sortedLayers.forEach(([layerIndex, nodeIds]) => {
    if (layerIndex === 0) {
      nodeIds.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    } else {
      nodeIds.sort((a, b) => {
        const baryA = averageParentOrder(a, incoming, layerOrder, order)
        const baryB = averageParentOrder(b, incoming, layerOrder, order)
        return baryA - baryB || (order.get(a) ?? 0) - (order.get(b) ?? 0)
      })
    }

    nodeIds.forEach((nodeId, index) => layerOrder.set(nodeId, index))
  })

  const positions = new Map<string, { x: number; y: number }>()

  sortedLayers.forEach(([layerIndex, nodeIds]) => {
    const layerWidth = (nodeIds.length - 1) * columnGap
    nodeIds.forEach((nodeId, index) => {
      positions.set(nodeId, {
        x: centerX + index * columnGap - layerWidth / 2,
        y: startY + layerIndex * rowGap,
      })
    })
  })

  return positions
}

function averageParentOrder(
  nodeId: string,
  incoming: Map<string, string[]>,
  layerOrder: Map<string, number>,
  fallbackOrder: Map<string, number>
) {
  const parents = incoming.get(nodeId) ?? []
  if (parents.length === 0) return fallbackOrder.get(nodeId) ?? 0

  const sum = parents.reduce((total, parentId) => total + (layerOrder.get(parentId) ?? fallbackOrder.get(parentId) ?? 0), 0)
  return sum / parents.length
}
