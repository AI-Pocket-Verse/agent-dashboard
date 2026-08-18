import { useMemo } from 'react'
import { ReactFlow, Background, MarkerType, Position, type Node, type Edge as RFEdge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { NodeRun, Edge } from '../../types/index'
import { computeVerticalDagLayout } from '../../lib/workflowLayout'

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  completed: { border: '1px solid rgba(31,154,81,0.22)', background: 'rgba(31,154,81,0.08)' },
  running: { border: '1px solid rgba(0,113,227,0.26)', background: 'rgba(0,113,227,0.1)', boxShadow: '0 0 0 1px rgba(0,113,227,0.08)' },
  waiting: { border: '1px solid rgba(255,159,10,0.24)', background: 'rgba(255,159,10,0.08)' },
  failed: { border: '1px solid rgba(217,48,37,0.22)', background: 'rgba(217,48,37,0.08)' },
  pending: { border: '1px solid rgba(120,120,128,0.16)', background: 'rgba(255,255,255,0.7)', opacity: 0.74 },
}

const STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  running: '执行中',
  waiting: '等待确认',
  failed: '失败',
  pending: '等待中',
}

const STATUS_TONE: Record<string, string> = {
  completed: 'border-emerald-200 text-emerald-700',
  running: 'border-blue-200 text-blue-600',
  waiting: 'border-amber-200 text-amber-700',
  failed: 'border-rose-200 text-rose-600',
  pending: 'border-slate-200 text-slate-500',
}

interface Props {
  nodes: NodeRun[]
  edges: Edge[]
  selectedNodeId?: string | null
  onSelectNode?: (node: NodeRun) => void
  onClearSelection?: () => void
}

export default function WorkflowDAG({ nodes, edges, selectedNodeId, onSelectNode, onClearSelection }: Props) {
  const positions = useMemo(() => computeVerticalDagLayout(nodes, edges), [nodes, edges])

  const rfNodes: Node[] = useMemo(() =>
    nodes.map((n, i) => ({
      id: n.id,
      position: positions.get(n.id) ?? { x: 220, y: i * 124 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        label: (
          <div className="w-[188px] text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-[#111114]">{n.displayName || n.agentName}</div>
                <div className="mt-1 truncate text-[11px] text-slate-500">
                  {n.output?.trim() || n.logs.find(line => line.trim()) || '等待执行该节点'}
                </div>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[n.status] ?? STATUS_TONE.pending}`}>
                {STATUS_LABEL[n.status] ?? n.status}
              </span>
            </div>

            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
              <span className={`inline-flex h-2.5 w-2.5 rounded-full ${
                n.status === 'running'
                  ? 'animate-pulse bg-blue-500'
                  : n.status === 'completed'
                    ? 'bg-emerald-500'
                    : n.status === 'failed'
                      ? 'bg-rose-500'
                      : n.status === 'waiting'
                        ? 'bg-amber-400'
                        : 'bg-slate-300'
              }`} />
              <span>{n.agentType}</span>
              {n.status === 'running' && (
                <span className="inline-flex items-center gap-0.5 text-blue-500">
                  {[0, 120, 240].map(delay => (
                    <span
                      key={delay}
                      className="h-1 w-1 animate-bounce rounded-full bg-blue-500"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </span>
              )}
              {n.logs.length > 0 && <span>{n.logs.length} 条日志</span>}
            </div>
          </div>
        ),
      },
      style: {
        ...STATUS_STYLE[n.status],
        borderRadius: 18,
        padding: '12px 14px',
        color: '#1d1d1f',
        minWidth: 220,
        boxShadow: selectedNodeId === n.id
          ? '0 0 0 1px rgba(17,17,20,0.08), 0 0 0 4px rgba(17,17,20,0.05)'
          : STATUS_STYLE[n.status]?.boxShadow,
      },
      className: n.status === 'running' ? 'workflow-node-running' : undefined,
    })), [nodes, positions, selectedNodeId])

  const rfEdges: RFEdge[] = useMemo(() =>
    edges.map((e, i) => ({
      id: `e${i}`,
      source: e.from,
      target: e.to,
      type: 'smoothstep',
      style: {
        stroke: nodes.find(n => n.id === e.from)?.status === 'running'
          ? 'rgba(0,113,227,0.76)'
          : selectedNodeId && (e.from === selectedNodeId || e.to === selectedNodeId)
            ? 'rgba(17,17,20,0.42)'
            : 'rgba(120,120,128,0.42)',
        strokeWidth: nodes.find(n => n.id === e.from)?.status === 'running'
          ? 2.1
          : selectedNodeId && (e.from === selectedNodeId || e.to === selectedNodeId) ? 1.6 : 1.45,
      },
      markerEnd: {
        type: MarkerType.Arrow,
        width: 14,
        height: 14,
        color: nodes.find(n => n.id === e.from)?.status === 'running'
          ? 'rgba(0,113,227,0.76)'
          : selectedNodeId && (e.from === selectedNodeId || e.to === selectedNodeId)
            ? 'rgba(17,17,20,0.42)'
            : 'rgba(120,120,128,0.42)',
      },
      className: nodes.find(n => n.id === e.from)?.status === 'running' ? 'workflow-edge-running' : undefined,
      animated: nodes.find(n => n.id === e.from)?.status === 'running',
    })), [edges, nodes, selectedNodeId])

  return (
    <div
      className="h-full overflow-hidden rounded-[26px] border border-slate-200/80 bg-transparent"
      onContextMenu={event => event.preventDefault()}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodeClick={(_, node) => {
          const targetNode = nodes.find(item => item.id === node.id)
          if (targetNode) onSelectNode?.(targetNode)
        }}
        onNodeContextMenu={event => event.preventDefault()}
        onEdgeContextMenu={event => event.preventDefault()}
        onPaneClick={onClearSelection}
        onPaneContextMenu={event => event.preventDefault()}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.65, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background color="rgba(120,120,128,0.1)" gap={22} />
      </ReactFlow>
    </div>
  )
}
