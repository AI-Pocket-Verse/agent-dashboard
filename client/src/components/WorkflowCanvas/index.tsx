import { memo, useMemo } from 'react'
import {
  BaseEdge,
  Background,
  Controls,
  getSimpleBezierPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge as FlowEdge,
  type EdgeProps,
  type Node,
  type NodeProps,
  useStore,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { t } from '../../lib/i18n'

const EDGE_STROKE = 'rgba(68,68,74,0.36)'
const EDGE_MARKER_COLOR = 'rgba(52,52,58,0.48)'
const EDGE_SAFE_GAP = 20
const EDGE_DETOUR_GAP = 36

export type WorkflowCanvasAgentType = 'custom' | 'omc'

export type WorkflowCanvasNodeData = {
  agentName: string
  agentType: WorkflowCanvasAgentType
  displayName?: string
  description: string
  promptTemplate: string
  badgeLabel?: string
  badgeClassName?: string
  helperText?: string
}

export type WorkflowCanvasNode = Node<WorkflowCanvasNodeData, 'agentNode'>
export type WorkflowCanvasEdge = FlowEdge

type CanvasNodeRect = {
  id: string
  left: number
  right: number
  top: number
  bottom: number
}

type Point = {
  x: number
  y: number
}

export const WORKFLOW_EDGE_STROKE = EDGE_STROKE
export const WORKFLOW_EDGE_STROKE_ACTIVE = 'rgba(17,17,20,0.48)'
export const WORKFLOW_EDGE_MARKER_COLOR = EDGE_MARKER_COLOR

export const workflowNodeStyle = (type: WorkflowCanvasAgentType, isSelected = false) => ({
  border: `1px solid ${type === 'custom' ? 'rgba(0,113,227,0.22)' : 'rgba(120,120,128,0.2)'}`,
  background: type === 'custom' ? 'rgba(0,113,227,0.09)' : 'rgba(120,120,128,0.08)',
  borderRadius: 18,
  padding: '10px 12px',
  color: '#1d1d1f',
  fontSize: 12,
  minWidth: 184,
  boxShadow: isSelected ? '0 0 0 1px rgba(17,17,20,0.08), 0 0 0 4px rgba(17,17,20,0.05)' : undefined,
})

export const workflowEdgeMarker = (color: string = EDGE_MARKER_COLOR) => ({
  type: MarkerType.ArrowClosed,
  width: 13,
  height: 13,
  color,
  markerUnits: 'userSpaceOnUse',
  orient: 'auto',
  strokeWidth: 1.05,
})

export const createWorkflowCanvasEdge = (source: string, target: string, id?: string): WorkflowCanvasEdge => ({
  id: id ?? `edge-${source}-${target}-${crypto.randomUUID()}`,
  source,
  target,
  type: 'canvasbezier',
  reconnectable: true,
  interactionWidth: 44,
  markerEnd: workflowEdgeMarker(),
  style: {
    stroke: EDGE_STROKE,
    strokeWidth: 1.45,
  },
})

export const buildWorkflowCanvasEdges = (templateEdges: Array<{ from: string; to: string }>) =>
  templateEdges.map((edge, index) => createWorkflowCanvasEdge(edge.from, edge.to, `e${index}`))

const rangesOverlap = (startA: number, endA: number, startB: number, endB: number) =>
  Math.max(startA, startB) <= Math.min(endA, endB)

const getSimpleBezierControlPoints = (
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
) => {
  const midY = 0.5 * (sourceY + targetY)

  return {
    sourceControlX: sourceX,
    sourceControlY: midY,
    targetControlX: targetX,
    targetControlY: midY,
  }
}

const getCubicBezierPoint = (
  t: number,
  start: Point,
  controlA: Point,
  controlB: Point,
  end: Point
) => {
  const inverse = 1 - t
  const x = (
    inverse ** 3 * start.x
    + 3 * inverse ** 2 * t * controlA.x
    + 3 * inverse * t ** 2 * controlB.x
    + t ** 3 * end.x
  )
  const y = (
    inverse ** 3 * start.y
    + 3 * inverse ** 2 * t * controlA.y
    + 3 * inverse * t ** 2 * controlB.y
    + t ** 3 * end.y
  )
  return { x, y }
}

const doesSimpleBezierHitRect = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  rect,
}: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  rect: CanvasNodeRect
}) => {
  const { sourceControlX, sourceControlY, targetControlX, targetControlY } = getSimpleBezierControlPoints(sourceX, sourceY, targetX, targetY)

  for (let step = 1; step < 24; step += 1) {
    const point = getCubicBezierPoint(
      step / 24,
      { x: sourceX, y: sourceY },
      { x: sourceControlX, y: sourceControlY },
      { x: targetControlX, y: targetControlY },
      { x: targetX, y: targetY }
    )

    if (
      point.x >= rect.left - EDGE_SAFE_GAP
      && point.x <= rect.right + EDGE_SAFE_GAP
      && point.y >= rect.top - EDGE_SAFE_GAP
      && point.y <= rect.bottom + EDGE_SAFE_GAP
    ) {
      return true
    }
  }

  return false
}

const getCanvasNodeRect = (node: Node): CanvasNodeRect => {
  const width = node.measured?.width ?? node.width ?? 184
  const height = node.measured?.height ?? node.height ?? 64
  return {
    id: node.id,
    left: node.position.x,
    right: node.position.x + width,
    top: node.position.y,
    bottom: node.position.y + height,
  }
}

const buildDetourBezierPath = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  source,
  target,
  nodeRects,
}: Pick<EdgeProps<WorkflowCanvasEdge>, 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'source' | 'target'> & {
  nodeRects: CanvasNodeRect[]
}) => {
  const [defaultPath, defaultLabelX, defaultLabelY] = getSimpleBezierPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Bottom,
    targetX,
    targetY,
    targetPosition: Position.Top,
  })

  const minY = Math.min(sourceY, targetY)
  const maxY = Math.max(sourceY, targetY)
  const corridorLeft = Math.min(sourceX, targetX) - EDGE_SAFE_GAP
  const corridorRight = Math.max(sourceX, targetX) + EDGE_SAFE_GAP

  const spanNodes = nodeRects.filter(rect => (
    rect.id !== source
    && rect.id !== target
    && rect.bottom >= minY - EDGE_SAFE_GAP
    && rect.top <= maxY + EDGE_SAFE_GAP
    && rangesOverlap(rect.left - EDGE_SAFE_GAP, rect.right + EDGE_SAFE_GAP, corridorLeft, corridorRight)
  ))

  const blockers = spanNodes.filter(rect => doesSimpleBezierHitRect({
    sourceX,
    sourceY,
    targetX,
    targetY,
    rect,
  }))

  if (blockers.length === 0) {
    return [defaultPath, defaultLabelX, defaultLabelY] as const
  }

  const sourceRect = nodeRects.find(rect => rect.id === source)
  const targetRect = nodeRects.find(rect => rect.id === target)
  const laneNodes = [
    ...spanNodes,
    ...(sourceRect ? [sourceRect] : []),
    ...(targetRect ? [targetRect] : []),
  ]

  const leftLaneX = Math.min(...laneNodes.map(rect => rect.left)) - EDGE_DETOUR_GAP
  const rightLaneX = Math.max(...laneNodes.map(rect => rect.right)) + EDGE_DETOUR_GAP
  const leftCost = Math.abs(sourceX - leftLaneX) + Math.abs(targetX - leftLaneX)
  const rightCost = Math.abs(sourceX - rightLaneX) + Math.abs(targetX - rightLaneX)
  const laneX = leftCost <= rightCost ? leftLaneX : rightLaneX

  const direction = targetY >= sourceY ? 1 : -1
  const verticalGap = Math.abs(targetY - sourceY)
  const curveOffset = Math.max(18, Math.min(30, verticalGap * 0.18))
  const sourceLeadY = sourceY + direction * curveOffset
  const sourceLaneY = sourceY + direction * curveOffset * 1.9
  const targetLeadY = targetY - direction * curveOffset
  const targetLaneY = targetY - direction * curveOffset * 1.9
  const path = [
    `M ${sourceX},${sourceY}`,
    `C ${sourceX},${sourceLeadY} ${laneX},${sourceLeadY} ${laneX},${sourceLaneY}`,
    `L ${laneX},${targetLaneY}`,
    `C ${laneX},${targetLeadY} ${targetX},${targetLeadY} ${targetX},${targetY}`,
  ].join(' ')

  return [path, laneX, sourceLaneY + (targetLaneY - sourceLaneY) / 2] as const
}

const CanvasBezierEdge = memo(function CanvasBezierEdge(props: EdgeProps<WorkflowCanvasEdge>) {
  const canvasNodeRects = useStore(state => state.nodes.map(node => getCanvasNodeRect(node)))
  const [path, labelX, labelY] = useMemo(() => buildDetourBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    source: props.source,
    target: props.target,
    nodeRects: canvasNodeRects,
  }), [canvasNodeRects, props.sourceX, props.sourceY, props.targetX, props.targetY, props.source, props.target])

  return (
    <BaseEdge
      path={path}
      labelX={labelX}
      labelY={labelY}
      markerStart={props.markerStart}
      markerEnd={props.markerEnd}
      interactionWidth={props.interactionWidth}
      style={props.style}
    />
  )
})

const AgentCanvasNode = memo(function AgentCanvasNode({
  data,
  selected,
  isConnectable,
  sourcePosition = Position.Bottom,
  targetPosition = Position.Top,
}: NodeProps<WorkflowCanvasNode>) {
  const badgeLabel = data.badgeLabel ?? data.agentType
  const badgeClassName = data.badgeClassName ?? (
    data.agentType === 'custom'
      ? 'border-blue-200 text-blue-600'
      : 'border-slate-200 text-slate-500'
  )

  return (
    <div className="group relative w-[158px] overflow-visible text-left">
      <Handle
        type="target"
        position={targetPosition}
        isConnectable={isConnectable}
        isConnectableStart={false}
        isConnectableEnd
        className={`workflow-node-handle workflow-node-handle-target ${selected ? 'workflow-node-handle-selected' : ''}`}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[#111114]">{data.displayName || data.agentName}</div>
          <div className="mt-1 truncate text-[11px] text-slate-500">{data.description}</div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badgeClassName}`}>
          {badgeLabel}
        </span>
      </div>

      <Handle
        type="source"
        position={sourcePosition}
        isConnectable={isConnectable}
        isConnectableStart
        isConnectableEnd={false}
        className={`workflow-node-handle workflow-node-handle-source ${selected ? 'workflow-node-handle-selected' : ''}`}
      />

      {(data.helperText ?? t('从下方圆点拖动连线')) !== '' && (
        <div className={`pointer-events-none absolute left-1/2 top-[calc(100%+18px)] -translate-x-1/2 rounded-full border border-black/10 bg-white/95 px-2.5 py-1 text-[10px] font-medium text-slate-500 shadow-sm transition ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}>
          {data.helperText ?? t('从下方圆点拖动连线')}
        </div>
      )}
    </div>
  )
})

export const workflowNodeTypes = {
  agentNode: AgentCanvasNode,
}

export const workflowEdgeTypes = {
  canvasbezier: CanvasBezierEdge,
}

interface WorkflowCanvasViewProps {
  nodes: WorkflowCanvasNode[]
  edges: WorkflowCanvasEdge[]
  selectedNodeId?: string | null
  onSelectNode?: (node: WorkflowCanvasNode) => void
  onClearSelection?: () => void
  className?: string
  showControls?: boolean
}

export function WorkflowCanvasView({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
  className = 'h-full min-w-0 flex-1 bg-transparent',
  showControls = true,
}: WorkflowCanvasViewProps) {
  return (
    <div className={className} onContextMenu={event => event.preventDefault()}>
      <ReactFlow
        nodes={nodes.map(node => ({ ...node, selected: node.id === selectedNodeId }))}
        edges={edges}
        nodeTypes={workflowNodeTypes}
        edgeTypes={workflowEdgeTypes}
        onNodeClick={(_, node) => onSelectNode?.(node as WorkflowCanvasNode)}
        onNodeContextMenu={event => event.preventDefault()}
        onEdgeContextMenu={event => event.preventDefault()}
        onPaneClick={onClearSelection}
        onPaneContextMenu={event => event.preventDefault()}
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.5, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background color="rgba(120,120,128,0.08)" gap={20} />
        {showControls && <Controls />}
      </ReactFlow>
    </div>
  )
}
