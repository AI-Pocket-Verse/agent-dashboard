import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  Position,
  ReactFlow,
  type Connection,
  type FinalConnectionState,
  type Edge as FlowEdge,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ContextMenu from '../components/ContextMenu/index'
import DialogShell from '../components/DialogShell/index'
import WorkflowInspector from '../components/WorkflowInspector/index'
import { t } from '../lib/i18n'
import {
  WORKFLOW_EDGE_MARKER_COLOR as EDGE_MARKER_COLOR,
  WORKFLOW_EDGE_STROKE as EDGE_STROKE,
  WORKFLOW_EDGE_STROKE_ACTIVE as EDGE_STROKE_ACTIVE,
  buildWorkflowCanvasEdges as buildCanvasEdges,
  createWorkflowCanvasEdge as createCanvasEdge,
  workflowEdgeMarker as edgeMarker,
  workflowEdgeTypes as edgeTypes,
  workflowNodeStyle as nodeStyle,
  workflowNodeTypes as nodeTypes,
  type WorkflowCanvasNode,
  type WorkflowCanvasNodeData,
} from '../components/WorkflowCanvas/index'
import { api } from '../lib/api'
import { getAgentDisplayDescription } from '../lib/agentDescriptions'
import { BUILTIN_TEMPLATES } from '../lib/builtinTemplates'
import type { WorkflowTemplate } from '../types/index'
import { computeVerticalDagLayout } from '../lib/workflowLayout'
import axios from 'axios'

const AGENT_OPTIONS: Array<{ name: string; type: 'custom' | 'omc' }> = [
  { name: 'backend-dev', type: 'custom' },
  { name: 'frontend-dev', type: 'custom' },
  { name: 'flutter-dev', type: 'custom' },
  { name: 'planner', type: 'omc' },
  { name: 'test-engineer', type: 'omc' },
  { name: 'designer', type: 'omc' },
  { name: 'code-reviewer', type: 'omc' },
  { name: 'security-reviewer', type: 'omc' },
  { name: 'architect', type: 'omc' },
  { name: 'writer', type: 'omc' },
  { name: 'debugger', type: 'omc' },
]

const NODE_CARD_WIDTH = 184
const NODE_CARD_HEIGHT = 64

type AgentOption = (typeof AGENT_OPTIONS)[number]

type AgentNodeData = WorkflowCanvasNodeData

type AgentNode = WorkflowCanvasNode

type EditableNode = {
  id: string
  agentName: string
  agentType: 'custom' | 'omc'
  displayName?: string
  promptTemplate: string
}

type NodeEditorState = {
  nodeId: string
  mode: 'edit' | 'create'
  parentId?: string
  displayName: string
  agentName: string
  agentType: 'custom' | 'omc'
  promptTemplate: string
}

type EdgeEditorState = {
  edgeId: string
  source: string
  target: string
}

type TemplateFormDialogState = {
  mode: 'save' | 'rename'
  templateId?: string
  title: string
  descriptionText: string
  submitLabel: string
  name: string
  templateDescription: string
  error?: string
}

type DraftTemplateState = {
  sourceTemplateId?: string
  name: string
  description: string
}

type LocalWorkflowTemplate = WorkflowTemplate & {
  transient?: boolean
}

type DraftExitAction =
  | { type: 'load-template'; templateId: string }
  | { type: 'new-template' }
  | { type: 'duplicate-template'; templateId: string }

const pickDefaultAgent = (type: 'custom' | 'omc'): AgentOption =>
  AGENT_OPTIONS.find(option => option.type === type) ?? AGENT_OPTIONS[0]

const getEditableNodesFromCanvas = (nodes: AgentNode[]): EditableNode[] =>
  nodes.map(node => ({
    id: node.id,
    agentName: node.data.agentName,
    agentType: node.data.agentType,
    displayName: node.data.displayName,
    promptTemplate: node.data.promptTemplate,
  }))

const edgePairsFromCanvas = (edges: FlowEdge[]) =>
  edges.map(edge => ({ from: String(edge.source), to: String(edge.target) }))

const getDetachedNodePosition = (nodes: AgentNode[]) => {
  if (nodes.length === 0) {
    return { x: 220, y: 72 }
  }

  const averageX = nodes.reduce((total, node) => total + node.position.x, 0) / nodes.length
  const maxY = Math.max(...nodes.map(node => node.position.y))

  return {
    x: averageX,
    y: maxY + 152,
  }
}

const normalizeTemplateName = (value: string) => value.trim()

export default function Canvas() {
  const [templates, setTemplates] = useState<LocalWorkflowTemplate[]>(BUILTIN_TEMPLATES)
  const [activeId, setActiveId] = useState<string | null>(null)
  const canvasViewportRef = useRef<HTMLDivElement | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'templates' | 'agents'>('templates')
  const [hoveredTemplateHint, setHoveredTemplateHint] = useState<{
    description: string
    left: number
    top: number
    placement: 'top' | 'bottom'
  } | null>(null)
  const [nodeEditor, setNodeEditor] = useState<NodeEditorState | null>(null)
  const [edgeEditor, setEdgeEditor] = useState<EdgeEditorState | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string
    left: number
    top: number
  } | null>(null)
  const [edgeContextMenu, setEdgeContextMenu] = useState<{
    edgeId: string
    left: number
    top: number
  } | null>(null)
  const [templateContextMenu, setTemplateContextMenu] = useState<{
    templateId: string
    left: number
    top: number
  } | null>(null)
  const [templateFormDialog, setTemplateFormDialog] = useState<TemplateFormDialogState | null>(null)
  const [templateDeleteDialog, setTemplateDeleteDialog] = useState<WorkflowTemplate | null>(null)
  const [draftTemplate, setDraftTemplate] = useState<DraftTemplateState | null>(null)
  const [draftExitAction, setDraftExitAction] = useState<DraftExitAction | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<AgentNode, FlowEdge> | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([])

  useEffect(() => {
    api.getTemplates().then(setTemplates).catch(console.error)
  }, [])

  const activeTemplate = useMemo(
    () => templates.find(template => template.id === activeId) ?? null,
    [templates, activeId]
  )
  const isBuiltinTemplate = Boolean(activeId?.startsWith('builtin-'))
  const canSaveCurrentTemplate = !isBuiltinTemplate
  const hasActiveWorkflow = Boolean(activeTemplate || draftTemplate)
  const hasWorkflowContent = nodes.length > 0 || edges.length > 0
  const headerTemplateName = t(activeTemplate?.name || draftTemplate?.name || '编排你的工作流')
  const headerTemplateDescription = t(activeTemplate?.description?.trim()
    || draftTemplate?.description?.trim()
    || '将节点按真实依赖关系从上到下组织，分支和汇合会自动展开。')
  const hasUnsavedDraft = Boolean(
    activeTemplate?.transient
    || (
      draftTemplate
      && (
        nodes.length > 0
        || draftTemplate.name.trim()
        || draftTemplate.description.trim()
      )
    )
  )

  useEffect(() => {
    if (isBuiltinTemplate) {
      setSidebarTab('templates')
    }
  }, [isBuiltinTemplate])

  const selectedNode = useMemo(
    () => nodes.find(node => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  )

  const arrowEdgeIds = useMemo(() => {
    const nodePositions = new Map(
      nodes.map(node => [node.id, node.position])
    )
    const incomingByTarget = new Map<string, FlowEdge[]>()

    edges.forEach(edge => {
      const targetId = String(edge.target)
      const bucket = incomingByTarget.get(targetId) ?? []
      bucket.push(edge)
      incomingByTarget.set(targetId, bucket)
    })

    const chosen = new Set<string>()

    incomingByTarget.forEach((incomingEdges, targetId) => {
      if (incomingEdges.length === 1) {
        chosen.add(incomingEdges[0].id)
        return
      }

      const targetPosition = nodePositions.get(targetId)
      if (!targetPosition) {
        chosen.add(incomingEdges[incomingEdges.length - 1].id)
        return
      }

      const bestEdge = incomingEdges.reduce((best, current) => {
        const bestSourcePosition = nodePositions.get(String(best.source))
        const currentSourcePosition = nodePositions.get(String(current.source))
        const bestDistance = Math.abs((bestSourcePosition?.x ?? targetPosition.x) - targetPosition.x)
        const currentDistance = Math.abs((currentSourcePosition?.x ?? targetPosition.x) - targetPosition.x)

        return currentDistance <= bestDistance ? current : best
      })

      chosen.add(bestEdge.id)
    })

    return chosen
  }, [edges, nodes])

  const parentNode = useMemo(
    () => nodeEditor?.parentId ? nodes.find(node => node.id === nodeEditor.parentId) ?? null : null,
    [nodeEditor?.parentId, nodes]
  )

  const editorAgentOptions = useMemo(
    () => AGENT_OPTIONS.filter(option => option.type === nodeEditor?.agentType),
    [nodeEditor?.agentType]
  )

  const edgeEditorError = useMemo(() => {
    if (!edgeEditor) return ''
    if (edgeEditor.source === edgeEditor.target) return t('连线起点和终点不能是同一个节点')
    const duplicate = edges.some(edge => (
      edge.id !== edgeEditor.edgeId
      && String(edge.source) === edgeEditor.source
      && String(edge.target) === edgeEditor.target
    ))
    if (duplicate) return t('相同的连线已经存在')
    return ''
  }, [edgeEditor, edges])

  const templateNameConflictError = useMemo(() => {
    if (!templateFormDialog?.name.trim()) return ''

    const normalizedName = normalizeTemplateName(templateFormDialog.name)
    const conflict = templates.some(template => (
      template.id !== templateFormDialog.templateId
      && normalizeTemplateName(template.name) === normalizedName
    ))

    return conflict ? t('模板名称必须唯一，已自动忽略首尾空格，请使用其他名称') : ''
  }, [templateFormDialog?.name, templateFormDialog?.templateId, templates])

  const buildAgentNodes = useCallback((
    templateNodes: WorkflowTemplate['nodes'],
    templateEdges: WorkflowTemplate['edges'],
    selectedId?: string | null
  ): AgentNode[] => {
    const positions = computeVerticalDagLayout(templateNodes, templateEdges, {
      rowGap: 152,
      columnGap: 248,
    })
    return templateNodes.map((node, index) => ({
      id: node.id,
      type: 'agentNode',
      position: positions.get(node.id) ?? { x: 220, y: 72 + index * 124 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      selected: selectedId === node.id,
      data: {
        agentName: node.agentName,
        agentType: node.agentType,
        displayName: node.displayName,
        description: getAgentDisplayDescription({ name: node.agentName, type: node.agentType, description: '' }),
        promptTemplate: node.promptTemplate,
      },
      style: nodeStyle(node.agentType, selectedId === node.id),
    }))
  }, [])

  const updateGraph = useCallback((
    nextNodes: EditableNode[],
    nextEdges: Array<{ from: string; to: string }>,
    nextSelectedId?: string | null
  ) => {
    setSelectedNodeId(nextSelectedId ?? null)
    setSelectedEdgeId(null)
    setContextMenu(null)
    setEdgeContextMenu(null)
    setTemplateContextMenu(null)
    setTemplateFormDialog(null)
    setTemplateDeleteDialog(null)
    setDraftExitAction(null)
    setNodes(buildAgentNodes(nextNodes, nextEdges, nextSelectedId ?? null))
    setEdges(buildCanvasEdges(nextEdges))
  }, [buildAgentNodes, setEdges, setNodes])

  const hasDuplicateEdge = useCallback((source: string, target: string, ignoreEdgeId?: string) => (
    edges.some(edge => edge.id !== ignoreEdgeId && String(edge.source) === source && String(edge.target) === target)
  ), [edges])

  const isValidConnection = useCallback((candidate: Connection | FlowEdge) => {
    const source = candidate.source
    const target = candidate.target
    if (!source || !target) return false
    if (source === target) return false
    return !hasDuplicateEdge(String(source), String(target), 'id' in candidate ? candidate.id : undefined)
  }, [hasDuplicateEdge])

  const applyTemplateToCanvas = useCallback((template: LocalWorkflowTemplate) => {
    setActiveId(template.id)
    setDraftTemplate(null)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setContextMenu(null)
    setEdgeContextMenu(null)
    setTemplateContextMenu(null)
    setTemplateFormDialog(null)
    setTemplateDeleteDialog(null)
    setNodeEditor(null)
    setEdgeEditor(null)
    setHoveredTemplateHint(null)
    setNodes(buildAgentNodes(template.nodes, template.edges, null))
    setEdges(buildCanvasEdges(template.edges))
  }, [buildAgentNodes, setEdges, setNodes])

  const clearCanvas = useCallback(() => {
    setActiveId(null)
    setDraftTemplate(null)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setContextMenu(null)
    setEdgeContextMenu(null)
    setTemplateContextMenu(null)
    setTemplateFormDialog(null)
    setTemplateDeleteDialog(null)
    setDraftExitAction(null)
    setNodeEditor(null)
    setEdgeEditor(null)
    setHoveredTemplateHint(null)
    setNodes([])
    setEdges([])
  }, [setEdges, setNodes])

  const createBlankDraft = useCallback(() => {
    const transientId = `draft-new-${crypto.randomUUID()}`
    const transientTemplate: LocalWorkflowTemplate = {
      id: transientId,
      name: t('未命名模板'),
      description: '',
      nodes: [],
      edges: [],
      createdAt: Date.now(),
      transient: true,
    }

    setTemplates(prev => [...prev, transientTemplate])
    clearCanvas()
    setActiveId(transientId)
    setSidebarTab('agents')
  }, [clearCanvas])

  const duplicateTemplateToDraft = useCallback((template: LocalWorkflowTemplate) => {
    const transientId = `draft-copy-${crypto.randomUUID()}`
    const transientTemplate: LocalWorkflowTemplate = {
      ...template,
      id: transientId,
      name: `${template.name} ${t('副本')}`,
      description: template.description?.trim() ?? '',
      nodes: template.nodes.map(node => ({ ...node })),
      edges: template.edges.map(edge => ({ ...edge })),
      createdAt: Date.now(),
      transient: true,
    }

    setTemplates(prev => {
      const sourceIndex = prev.findIndex(item => item.id === template.id)
      if (sourceIndex === -1) return [...prev, transientTemplate]

      const next = [...prev]
      next.splice(sourceIndex + 1, 0, transientTemplate)
      return next
    })
    setActiveId(transientId)
    setTemplateContextMenu(null)
    setDraftTemplate(null)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setContextMenu(null)
    setEdgeContextMenu(null)
    setTemplateFormDialog(null)
    setTemplateDeleteDialog(null)
    setDraftExitAction(null)
    setHoveredTemplateHint(null)
    setNodes(buildAgentNodes(template.nodes, template.edges, null))
    setEdges(buildCanvasEdges(template.edges))
  }, [buildAgentNodes, setEdges, setNodes])

  const discardUnsavedDraft = useCallback(() => {
    if (activeTemplate?.transient && activeId) {
      setTemplates(prev => prev.filter(template => template.id !== activeId))
      setActiveId(null)
    }

    setDraftTemplate(null)
  }, [activeId, activeTemplate?.transient])

  const executeDraftExitAction = useCallback((action: DraftExitAction) => {
    discardUnsavedDraft()

    if (action.type === 'new-template') {
      createBlankDraft()
      return
    }

    const target = templates.find(template => template.id === action.templateId)
    if (!target) return

    if (action.type === 'load-template') {
      applyTemplateToCanvas(target)
      return
    }

    duplicateTemplateToDraft(target)
  }, [applyTemplateToCanvas, createBlankDraft, discardUnsavedDraft, duplicateTemplateToDraft, templates])

  const requestDraftExitAction = useCallback((action: DraftExitAction) => {
    if (hasUnsavedDraft) {
      setTemplateContextMenu(null)
      setDraftExitAction(action)
      return
    }

    executeDraftExitAction(action)
  }, [executeDraftExitAction, hasUnsavedDraft])

  const addAgentNode = useCallback((agentName: string, type: 'custom' | 'omc') => {
    if (isBuiltinTemplate) return
    const id = crypto.randomUUID()
    const isFirstNode = nodes.length === 0
    const nextPosition = getDetachedNodePosition(nodes)

    setSelectedNodeId(id)
    setSelectedEdgeId(null)
    setContextMenu(null)
    setEdgeContextMenu(null)
    setTemplateContextMenu(null)
    setTemplateFormDialog(null)
    setTemplateDeleteDialog(null)
    setDraftExitAction(null)
    setNodes(prev => [
      ...prev.map(node => ({
        ...node,
        selected: false,
        style: nodeStyle(node.data.agentType, false),
      })),
      {
        id,
        type: 'agentNode',
        position: nextPosition,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        selected: true,
        data: {
          agentName,
          agentType: type,
          displayName: undefined,
          description: getAgentDisplayDescription({ name: agentName, type, description: '' }),
          promptTemplate: '{{globalPrompt}}',
        },
        style: nodeStyle(type, true),
      },
    ])

    if (isFirstNode && reactFlowInstance && canvasViewportRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const viewportWidth = canvasViewportRef.current?.clientWidth ?? 0
          const targetViewport = {
            x: viewportWidth / 2 - (nextPosition.x + NODE_CARD_WIDTH / 2),
            y: 28 - nextPosition.y,
            zoom: 1,
          }
          reactFlowInstance.setViewport(targetViewport, { duration: 180 })
        })
      })
    }
  }, [isBuiltinTemplate, nodes, reactFlowInstance, setNodes])

  const onConnect = useCallback((connection: Connection) => {
    if (isBuiltinTemplate) return
    if (!isValidConnection(connection) || !connection.source || !connection.target) return
    setEdges(prev => [...prev, createCanvasEdge(connection.source!, connection.target!)])
    setSelectedEdgeId(null)
    setContextMenu(null)
    setEdgeContextMenu(null)
  }, [isBuiltinTemplate, isValidConnection, setEdges])

  const onReconnect = useCallback((oldEdge: FlowEdge, connection: Connection) => {
    if (isBuiltinTemplate) return
    if (!connection.source || !connection.target) return
    if (connection.source === connection.target) return
    if (hasDuplicateEdge(connection.source, connection.target, oldEdge.id)) return

    setEdges(prev => prev.map(edge => (
      edge.id === oldEdge.id
        ? createCanvasEdge(connection.source!, connection.target!, edge.id)
        : edge
    )))
    setSelectedEdgeId(oldEdge.id)
    setContextMenu(null)
    setEdgeContextMenu(null)
  }, [hasDuplicateEdge, isBuiltinTemplate, setEdges])

  const onReconnectEnd = useCallback((
    _event: MouseEvent | TouchEvent,
    edge: FlowEdge,
    _handleType: 'source' | 'target',
    connectionState: FinalConnectionState
  ) => {
    if (isBuiltinTemplate) return
    if (connectionState.toNode) return
    setEdges(prev => prev.filter(item => item.id !== edge.id))
    setSelectedEdgeId(null)
    setContextMenu(null)
    setEdgeContextMenu(null)
  }, [isBuiltinTemplate, setEdges])

  const handleSaveTemplate = useCallback(async () => {
    if (isBuiltinTemplate) return

    if (activeTemplate && activeId) {
      if (activeTemplate.transient) {
        setTemplateFormDialog({
          mode: 'save',
          templateId: activeTemplate.id,
          title: t('保存模板'),
          descriptionText: t('填写模板名称和描述，保存当前编排结果。'),
          submitLabel: t('确认保存'),
          name: activeTemplate.name,
          templateDescription: activeTemplate.description ?? '',
        })
        return
      }

      const saved = await api.updateTemplate({
        ...activeTemplate,
        nodes: nodes.map(node => ({
          id: node.id,
          agentName: node.data.agentName,
          agentType: node.data.agentType,
          displayName: node.data.displayName?.trim() || undefined,
          promptTemplate: node.data.promptTemplate,
        })),
        edges: edgePairsFromCanvas(edges),
      })

      setTemplates(prev => prev.map(template => (
        template.id === saved.id ? saved : template
      )))
      setSidebarTab('templates')
      return
    }

    setTemplateFormDialog({
      mode: 'save',
      title: t('保存模板'),
      descriptionText: t('填写模板名称和描述，保存当前编排结果。'),
      submitLabel: t('确认保存'),
      name: draftTemplate?.name ?? '',
      templateDescription: draftTemplate?.description ?? '',
    })
  }, [activeId, activeTemplate, draftTemplate, edges, isBuiltinTemplate, nodes])

  const handleConfirmTemplateForm = useCallback(async () => {
    if (!templateFormDialog) return

    const nextName = normalizeTemplateName(templateFormDialog.name)
    if (!nextName) return
    if (templateNameConflictError) {
      setTemplateFormDialog(prev => prev ? { ...prev, error: templateNameConflictError } : prev)
      return
    }

    try {
      if (templateFormDialog.mode === 'rename') {
        const target = templates.find(template => template.id === templateFormDialog.templateId)
        if (!target) return

        if (target.transient) {
          setTemplates(prev => prev.map(template => (
            template.id === target.id
              ? {
                  ...template,
                  name: nextName,
                  description: templateFormDialog.templateDescription.trim(),
                }
              : template
          )))
          setTemplateFormDialog(null)
          return
        }

        const saved = await api.updateTemplate({
          ...target,
          name: nextName,
          description: templateFormDialog.templateDescription.trim(),
        })

        setTemplates(prev => prev.map(template => (
          template.id === saved.id ? saved : template
        )))
        setTemplateFormDialog(null)
        return
      }

      const template = {
        name: nextName,
        description: templateFormDialog.templateDescription.trim(),
        nodes: nodes.map(node => ({
          id: node.id,
          agentName: node.data.agentName,
          agentType: node.data.agentType,
          displayName: node.data.displayName?.trim() || undefined,
          promptTemplate: node.data.promptTemplate,
        })),
        edges: edgePairsFromCanvas(edges),
      }
      const saved = await api.createTemplate(template)

      setTemplates(prev => {
        if (templateFormDialog.templateId) {
          return prev.map(templateItem => (
            templateItem.id === templateFormDialog.templateId ? saved : templateItem
          ))
        }

        const index = prev.findIndex(templateItem => templateItem.id === saved.id)
        return index >= 0
          ? prev.map(templateItem => templateItem.id === saved.id ? saved : templateItem)
          : [...prev, saved]
      })
      setActiveId(saved.id)
      setDraftTemplate(null)
      setSidebarTab('templates')
      setTemplateFormDialog(null)
    } catch (error) {
      const message = axios.isAxiosError(error) && error.response?.status === 409
        ? t('模板名称必须唯一，已自动忽略首尾空格，请使用其他名称')
        : t('保存失败，请稍后重试')
      setTemplateFormDialog(prev => prev ? { ...prev, error: message } : prev)
    }
  }, [edges, nodes, templateFormDialog, templateNameConflictError, templates])

  const handleSelectNode = useCallback((nodeId: string) => {
    setContextMenu(null)
    setEdgeContextMenu(null)
    setTemplateContextMenu(null)
    setTemplateFormDialog(null)
    setTemplateDeleteDialog(null)
    setSelectedEdgeId(null)
    setSelectedNodeId(nodeId)
  }, [])

  const handleClearSelection = useCallback(() => {
    setContextMenu(null)
    setEdgeContextMenu(null)
    setTemplateContextMenu(null)
    setTemplateFormDialog(null)
    setTemplateDeleteDialog(null)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }, [])

  const openEditNodeEditor = useCallback((nodeId: string) => {
    if (isBuiltinTemplate) return
    const target = nodes.find(node => node.id === nodeId)
    if (!target) return

    setNodeEditor({
      nodeId,
      mode: 'edit',
      displayName: target.data.displayName ?? '',
      agentName: target.data.agentName,
      agentType: target.data.agentType,
      promptTemplate: target.data.promptTemplate,
    })
  }, [isBuiltinTemplate, nodes])

  const openEdgeEditor = useCallback((edgeId: string) => {
    const target = edges.find(edge => edge.id === edgeId)
    if (!target) return

    setEdgeEditor({
      edgeId,
      source: String(target.source),
      target: String(target.target),
    })
  }, [edges])

  const handleDuplicateNode = useCallback((nodeId: string) => {
    if (isBuiltinTemplate) return
    const target = nodes.find(node => node.id === nodeId)
    if (!target) return

    const newId = crypto.randomUUID()
    const nextNodes = [
      ...getEditableNodesFromCanvas(nodes),
      {
        id: newId,
        agentName: target.data.agentName,
        agentType: target.data.agentType,
        displayName: target.data.displayName ? `${target.data.displayName} ${t('副本')}` : undefined,
        promptTemplate: target.data.promptTemplate,
      },
    ]

    updateGraph(nextNodes, edgePairsFromCanvas(edges), newId)
  }, [edges, isBuiltinTemplate, nodes, updateGraph])

  const handleDeleteNode = useCallback((nodeId: string) => {
    if (isBuiltinTemplate) return
    const nextNodes = getEditableNodesFromCanvas(nodes).filter(node => node.id !== nodeId)
    const nextEdges = edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId)
    updateGraph(nextNodes, edgePairsFromCanvas(nextEdges), null)
  }, [edges, isBuiltinTemplate, nodes, updateGraph])

  const handleDeleteEdge = useCallback((edgeId: string) => {
    if (isBuiltinTemplate) return
    setEdges(prev => prev.filter(edge => edge.id !== edgeId))
    setSelectedEdgeId(null)
    setEdgeContextMenu(null)
  }, [isBuiltinTemplate, setEdges])

  const openCreateDownstreamEditor = useCallback((nodeId: string) => {
    if (isBuiltinTemplate) return
    const defaultAgent = pickDefaultAgent('custom')
    setNodeEditor({
      nodeId: crypto.randomUUID(),
      mode: 'create',
      parentId: nodeId,
      displayName: '',
      agentName: defaultAgent.name,
      agentType: defaultAgent.type,
      promptTemplate: '{{globalPrompt}}',
    })
  }, [isBuiltinTemplate])

  const updateNodeEditor = useCallback((patch: Partial<NodeEditorState>) => {
    setNodeEditor(prev => {
      if (!prev) return null

      const next = { ...prev, ...patch }
      const matchedAgent = AGENT_OPTIONS.find(option => option.name === next.agentName && option.type === next.agentType)

      if (!matchedAgent) {
        const fallbackAgent = pickDefaultAgent(next.agentType)
        next.agentName = fallbackAgent.name
        next.agentType = fallbackAgent.type
      }

      return next
    })
  }, [])

  const handleConfirmNodeEditor = useCallback(() => {
    if (isBuiltinTemplate) return
    if (!nodeEditor) return

    const nextNodes = getEditableNodesFromCanvas(nodes)
    const nextEdges = edgePairsFromCanvas(edges)

    if (nodeEditor.mode === 'edit') {
      updateGraph(
        nextNodes.map(node => node.id === nodeEditor.nodeId ? {
          ...node,
          agentName: nodeEditor.agentName,
          agentType: nodeEditor.agentType,
          displayName: nodeEditor.displayName.trim() || undefined,
          promptTemplate: nodeEditor.promptTemplate,
        } : node),
        nextEdges,
        nodeEditor.nodeId
      )
    } else {
      updateGraph(
        [
          ...nextNodes,
          {
            id: nodeEditor.nodeId,
            agentName: nodeEditor.agentName,
            agentType: nodeEditor.agentType,
            displayName: nodeEditor.displayName.trim() || undefined,
            promptTemplate: nodeEditor.promptTemplate,
          },
        ],
        [
          ...nextEdges,
          ...(nodeEditor.parentId ? [{ from: nodeEditor.parentId, to: nodeEditor.nodeId }] : []),
        ],
        nodeEditor.nodeId
      )
    }

    setNodeEditor(null)
  }, [edges, isBuiltinTemplate, nodeEditor, nodes, updateGraph])

  const handleConfirmEdgeEditor = useCallback(() => {
    if (isBuiltinTemplate) return
    if (!edgeEditor || edgeEditorError) return
    setEdges(prev => prev.map(edge => (
      edge.id === edgeEditor.edgeId
        ? createCanvasEdge(edgeEditor.source, edgeEditor.target, edge.id)
        : edge
    )))
    setSelectedEdgeId(edgeEditor.edgeId)
    setEdgeEditor(null)
    setEdgeContextMenu(null)
  }, [edgeEditor, edgeEditorError, isBuiltinTemplate, setEdges])

  const handleOpenNodeDetails = useCallback((nodeId: string) => {
    handleSelectNode(nodeId)
  }, [handleSelectNode])

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, nodeId: string) => {
    event.preventDefault()
    event.stopPropagation()
    handleSelectNode(nodeId)
    setEdgeContextMenu(null)
    setTemplateContextMenu(null)
    setTemplateDeleteDialog(null)
    setContextMenu({
      nodeId,
      left: Math.min(event.clientX, window.innerWidth - 220),
      top: Math.min(event.clientY, window.innerHeight - 260),
    })
  }, [handleSelectNode])

  const handleSelectEdge = useCallback((edgeId: string) => {
    setContextMenu(null)
    setSelectedNodeId(null)
    setTemplateContextMenu(null)
    setTemplateFormDialog(null)
    setTemplateDeleteDialog(null)
    setSelectedEdgeId(edgeId)
  }, [])

  const handleEdgeContextMenu = useCallback((event: React.MouseEvent, edge: FlowEdge) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu(null)
    setTemplateContextMenu(null)
    setTemplateFormDialog(null)
    setTemplateDeleteDialog(null)
    setSelectedNodeId(null)
    setSelectedEdgeId(edge.id)
    setEdgeContextMenu({
      edgeId: edge.id,
      left: Math.min(event.clientX, window.innerWidth - 220),
      top: Math.min(event.clientY, window.innerHeight - 220),
    })
  }, [])

  const handleTemplateContextMenu = useCallback((event: React.MouseEvent, template: WorkflowTemplate) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu(null)
    setEdgeContextMenu(null)
    setTemplateFormDialog(null)
    setTemplateDeleteDialog(null)
    setDraftExitAction(null)
    setTemplateContextMenu({
      templateId: template.id,
      left: Math.min(event.clientX, window.innerWidth - 220),
      top: Math.min(event.clientY, window.innerHeight - 180),
    })
  }, [])

  const handleRequestDeleteTemplate = useCallback((templateId: string) => {
    if (templateId.startsWith('builtin-')) return
    const target = templates.find(template => template.id === templateId)
    if (!target) return

    if (target.transient) {
      setTemplateContextMenu(null)
      setTemplates(prev => prev.filter(template => template.id !== templateId))
      if (activeId === templateId) {
        clearCanvas()
      }
      return
    }

    setTemplateContextMenu(null)
    setTemplateDeleteDialog(target)
  }, [activeId, clearCanvas, templates])

  const handleConfirmDeleteTemplate = useCallback(async () => {
    if (!templateDeleteDialog) return
    await api.deleteTemplate(templateDeleteDialog.id)
    setTemplates(prev => prev.filter(template => template.id !== templateDeleteDialog.id))
    setTemplateDeleteDialog(null)

    if (activeId === templateDeleteDialog.id) {
      clearCanvas()
    }
  }, [activeId, clearCanvas, templateDeleteDialog])

  const handleRenameTemplate = useCallback(async (templateId: string) => {
    if (templateId.startsWith('builtin-')) return
    const target = templates.find(template => template.id === templateId)
    if (!target) return

    setTemplateContextMenu(null)
    setTemplateFormDialog({
      mode: 'rename',
      templateId: target.id,
      title: t('重命名模板'),
      descriptionText: t('修改模板名称和描述，不影响当前编排内容。'),
      submitLabel: t('确认修改'),
      name: target.name,
      templateDescription: target.description ?? '',
    })
  }, [templates])

  const handleDuplicateTemplate = useCallback((templateId: string) => {
    requestDraftExitAction({ type: 'duplicate-template', templateId })
  }, [requestDraftExitAction])

  const showTemplateHint = (event: React.MouseEvent<HTMLButtonElement>, description: string) => {
    const trimmed = description.trim()
    if (!trimmed) return

    const rect = event.currentTarget.getBoundingClientRect()
    const tooltipWidth = 280
    const gap = 4
    const left = Math.min(Math.max(16, rect.left), window.innerWidth - tooltipWidth - 16)
    const shouldPlaceBelow = rect.top < 96
    const top = shouldPlaceBelow ? rect.bottom + gap : rect.top - gap

    setHoveredTemplateHint({
      description: trimmed,
      left,
      top,
      placement: shouldPlaceBelow ? 'bottom' : 'top',
    })
  }

  return (
    <div
      className="flex h-full min-h-0 overflow-hidden"
      onClick={() => {
        if (contextMenu) setContextMenu(null)
        if (edgeContextMenu) setEdgeContextMenu(null)
        if (templateContextMenu) setTemplateContextMenu(null)
        if (templateFormDialog) setTemplateFormDialog(null)
        if (templateDeleteDialog) setTemplateDeleteDialog(null)
        if (draftExitAction) setDraftExitAction(null)
      }}
      onContextMenu={event => event.preventDefault()}
    >
      <aside className="flex min-h-0 w-[308px] shrink-0 flex-col border-r border-black/[0.06] bg-[rgb(247,248,253)]">
        <div className="px-4 py-3.5 md:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.04em] text-black">{t('模板')}</h2>
            </div>
            <button onClick={() => requestDraftExitAction({ type: 'new-template' })} className="btn-secondary h-10 shrink-0 px-5 py-0 text-sm">
              {t('+ 新建')}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-3.5 pt-4 md:px-5">
          <div className="mb-3.5 grid grid-cols-2 gap-1 rounded-[18px] bg-slate-100/80 p-1">
            <button
              type="button"
              onClick={() => setSidebarTab('templates')}
              className={`rounded-[14px] px-3 py-2 text-[13px] font-medium transition ${
                sidebarTab === 'templates'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-slate-500 hover:text-black'
              }`}
            >
              {t('模板列表')}
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('agents')}
              disabled={isBuiltinTemplate}
              className={`rounded-[14px] px-3 py-2 text-[13px] font-medium transition ${
                sidebarTab === 'agents'
                  ? 'bg-white text-black shadow-sm'
                  : isBuiltinTemplate
                    ? 'cursor-not-allowed text-slate-300'
                    : 'text-slate-500 hover:text-black'
              }`}
            >
              {t('添加节点')}
            </button>
          </div>

          {sidebarTab === 'templates' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-black">{t('模板列表')}</div>
                <div className="rounded-full border border-black/10 bg-transparent px-2.5 py-1 text-[10px] font-semibold text-black">
                  {templates.length} {t('项')}
                </div>
              </div>
              <div
                className="min-h-0 space-y-2 overflow-y-auto pr-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                onScroll={() => setHoveredTemplateHint(null)}
              >
                {templates.map(template => (
                  (() => {
                    const isBuiltinItem = template.id.startsWith('builtin-')
                    const typeBadgeClass = template.transient
                      ? 'border-amber-200 bg-amber-50/80 text-amber-700'
                      : isBuiltinItem
                        ? 'border-sky-200 bg-sky-50/80 text-sky-700'
                        : 'border-emerald-200 bg-emerald-50/80 text-emerald-700'

                    const cardClass = activeId === template.id
                      ? 'border-black bg-transparent text-black'
                      : isBuiltinItem
                        ? 'border-sky-200/70 bg-sky-50/35 text-black hover:border-sky-300'
                        : 'border-emerald-200/80 bg-emerald-50/35 text-black hover:border-emerald-300'

                    return (
                      <button
                        key={template.id}
                        onClick={() => {
                          if (activeId === template.id) return
                          requestDraftExitAction({ type: 'load-template', templateId: template.id })
                        }}
                        onContextMenu={event => handleTemplateContextMenu(event, template)}
                        onMouseEnter={event => template.description?.trim() && showTemplateHint(event, template.description)}
                        onMouseLeave={() => setHoveredTemplateHint(null)}
                        className={`w-full rounded-[18px] border px-3.5 py-3 text-left transition ${cardClass}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className={`truncate text-[13px] ${activeId === template.id ? 'font-semibold' : 'font-medium'}`}>{t(template.name)}</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <div className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${typeBadgeClass}`}>
                              {template.transient ? t('未保存') : isBuiltinItem ? t('内置') : t('自定义')}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })()
                ))}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-black">{t('添加节点')}</div>
                <div className="rounded-full border border-black/10 bg-transparent px-2.5 py-1 text-[10px] font-semibold text-black">
                  {AGENT_OPTIONS.length} {t('项')}
                </div>
              </div>
              <div className="min-h-0 space-y-2 overflow-y-auto pr-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {AGENT_OPTIONS.map(agent => (
                  <button
                    key={agent.name}
                    onClick={() => addAgentNode(agent.name, agent.type)}
                    disabled={isBuiltinTemplate}
                    className="flex w-full items-center justify-between rounded-[18px] border border-black/10 bg-transparent px-3 py-2.5 text-left text-[13px] text-black transition hover:border-black/30 disabled:cursor-not-allowed disabled:border-black/8 disabled:text-slate-400"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="truncate">{agent.name}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {getAgentDisplayDescription({ ...agent, description: '' })}
                      </div>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold text-black ${
                      agent.type === 'custom' ? 'border-black/15' : 'border-black/10'
                    }`}>
                      {agent.type}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {hoveredTemplateHint && (
        <div
          className="pointer-events-none fixed z-50 w-[280px] rounded-[16px] border border-slate-200 bg-[rgb(247,248,253)] px-3 py-2 text-left text-xs leading-5 text-slate-500 shadow-[0_14px_32px_rgba(15,23,42,0.12)]"
          style={{
            left: hoveredTemplateHint.left,
            top: hoveredTemplateHint.top,
            transform: hoveredTemplateHint.placement === 'top' ? 'translateY(-100%)' : undefined,
          }}
        >
          {t(hoveredTemplateHint.description)}
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[rgb(247,248,253)]">
        {hasActiveWorkflow && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-transparent px-4 py-3.5 md:px-5">
            <div>
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.04em] text-black">
                {headerTemplateName}
              </h2>
              <p className="mt-0.5 text-[13px] text-slate-500">
                {headerTemplateDescription}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <div className="rounded-full border border-slate-200 bg-transparent px-3 py-2 text-[12px] font-medium text-slate-500">
                {nodes.length} {t('节点')} · {edges.length} {t('连接')}
              </div>
              <button
                onClick={() => void handleSaveTemplate()}
                disabled={!canSaveCurrentTemplate}
                className="btn-primary h-10 px-5 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t('保存模板')}
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex flex-1 overflow-hidden">
          {hasActiveWorkflow ? (
            <div
              ref={canvasViewportRef}
              className="h-full min-w-0 flex-1 bg-transparent"
              onContextMenu={event => event.preventDefault()}
            >
              <ReactFlow
                nodes={nodes.map(node => ({
                  ...node,
                  selected: node.id === selectedNodeId,
                  sourcePosition: Position.Bottom,
                  targetPosition: Position.Top,
                  style: nodeStyle(node.data.agentType, node.id === selectedNodeId),
                }))}
                edges={edges.map(edge => {
                  const isEdgeSelected = selectedEdgeId === edge.id || edgeContextMenu?.edgeId === edge.id
                  return {
                    ...edge,
                    selected: isEdgeSelected,
                    reconnectable: isEdgeSelected,
                    animated: isEdgeSelected,
                    style: {
                      ...edge.style,
                      stroke: isEdgeSelected ? EDGE_STROKE_ACTIVE : edge.style?.stroke,
                      strokeWidth: isEdgeSelected ? 2.05 : edge.style?.strokeWidth,
                      filter: isEdgeSelected ? 'drop-shadow(0 0 5px rgba(17,17,20,0.14))' : undefined,
                    },
                    markerEnd: arrowEdgeIds.has(edge.id)
                      ? edgeMarker(isEdgeSelected ? EDGE_STROKE_ACTIVE : EDGE_MARKER_COLOR)
                      : undefined,
                  }
                })}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onReconnect={onReconnect}
                onReconnectEnd={onReconnectEnd}
                isValidConnection={isValidConnection}
                onNodeClick={(_, node) => handleSelectNode(node.id)}
                onNodeContextMenu={(event, node) => handleNodeContextMenu(event, node.id)}
                onEdgeClick={(_, edge) => handleSelectEdge(edge.id)}
                onEdgeContextMenu={handleEdgeContextMenu}
                onPaneClick={handleClearSelection}
                onPaneContextMenu={event => event.preventDefault()}
                fitView
                fitViewOptions={{ padding: 0.18, minZoom: 0.5, maxZoom: 1 }}
                connectionMode={ConnectionMode.Strict}
                connectionLineType={ConnectionLineType.SimpleBezier}
                connectionLineStyle={{ stroke: 'rgba(17,17,20,0.28)', strokeWidth: 1.45 }}
                connectionRadius={42}
                nodesDraggable={!isBuiltinTemplate}
                edgesReconnectable={!isBuiltinTemplate}
                onInit={setReactFlowInstance}
              >
                <Background color="rgba(120,120,128,0.08)" gap={20} />
                <Controls />
              </ReactFlow>
            </div>
          ) : (
            <div className="flex h-32 min-w-0 flex-1 items-center justify-center text-sm text-slate-400">
              {t('暂无模板，请点击左上角新建')}
            </div>
          )}

          {selectedNode && hasWorkflowContent && (
            <WorkflowInspector
              title={selectedNode.data.displayName || selectedNode.data.agentName}
              subtitle={`${selectedNode.data.agentType === 'custom' ? t('自定义 Agent') : t('OMC 内置 Agent')} · ${selectedNode.id}`}
              description={selectedNode.data.description}
              statusLabel={selectedNode.data.agentType.toUpperCase()}
              fields={[
                { label: 'Agent', value: selectedNode.data.agentName },
                { label: 'Prompt Template', value: selectedNode.data.promptTemplate },
                { label: t('连接关系'), value: `${edges.filter(edge => edge.target === selectedNode.id).length} ${t('个上游')} · ${edges.filter(edge => edge.source === selectedNode.id).length} ${t('个下游')}` },
              ]}
              emptyHint={t('点击画布中的节点查看模板说明、Prompt 模板和连接关系')}
            />
          )}
        </div>
      </section>

      <ContextMenu
        open={Boolean(contextMenu)}
        left={contextMenu?.left ?? 0}
        top={contextMenu?.top ?? 0}
        onClose={() => setContextMenu(null)}
        items={contextMenu ? [
          { key: 'view', label: t('查看详情'), onSelect: () => handleOpenNodeDetails(contextMenu.nodeId) },
          { key: 'edit', label: t('编辑节点'), onSelect: () => openEditNodeEditor(contextMenu.nodeId), disabled: isBuiltinTemplate },
          { key: 'duplicate', label: t('复制节点'), onSelect: () => handleDuplicateNode(contextMenu.nodeId), disabled: isBuiltinTemplate },
          { key: 'create-downstream', label: t('新增下游节点'), onSelect: () => openCreateDownstreamEditor(contextMenu.nodeId), disabled: isBuiltinTemplate },
          { key: 'delete', label: t('删除节点'), onSelect: () => handleDeleteNode(contextMenu.nodeId), tone: 'danger', disabled: isBuiltinTemplate },
        ] : []}
      />

      <ContextMenu
        open={Boolean(templateContextMenu)}
        left={templateContextMenu?.left ?? 0}
        top={templateContextMenu?.top ?? 0}
        onClose={() => setTemplateContextMenu(null)}
        items={templateContextMenu ? (
          templateContextMenu.templateId.startsWith('builtin-')
            ? [
                { key: 'duplicate', label: t('复制模板'), onSelect: () => void handleDuplicateTemplate(templateContextMenu.templateId) },
                { key: 'builtin-hint', label: t('内置模板不可删除或重命名'), tone: 'muted', disabled: true },
              ]
            : [
                { key: 'duplicate', label: t('复制模板'), onSelect: () => void handleDuplicateTemplate(templateContextMenu.templateId) },
                { key: 'rename', label: t('重命名模板'), onSelect: () => void handleRenameTemplate(templateContextMenu.templateId) },
                { key: 'delete', label: t('删除模板'), onSelect: () => handleRequestDeleteTemplate(templateContextMenu.templateId), tone: 'danger' },
              ]
        ) : []}
      />

      <DialogShell
        open={Boolean(templateFormDialog)}
        onClose={() => setTemplateFormDialog(null)}
        maxWidthClassName="max-w-[460px]"
        title={templateFormDialog?.title}
        description={templateFormDialog?.descriptionText}
        footer={(
          <>
            <button type="button" onClick={() => setTemplateFormDialog(null)} className="btn-secondary h-10 px-4 py-0 text-sm">
              {t('取消')}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmTemplateForm()}
              disabled={!templateFormDialog?.name.trim() || Boolean(templateNameConflictError)}
              className="btn-primary h-10 px-5 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {templateFormDialog?.submitLabel ?? t('确认')}
            </button>
          </>
        )}
      >
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-slate-500">{t('模板名称')}</div>
          <input
            value={templateFormDialog?.name ?? ''}
            onChange={event => setTemplateFormDialog(prev => prev ? { ...prev, name: event.target.value, error: undefined } : prev)}
            onBlur={() => setTemplateFormDialog(prev => (
              prev ? { ...prev, name: normalizeTemplateName(prev.name) } : prev
            ))}
            className="field-input"
            placeholder={t('例如：全流程开发')}
            autoFocus
          />
          {(templateNameConflictError || templateFormDialog?.error) && (
            <div className="mt-1.5 text-[12px] text-rose-600">
              {templateNameConflictError || templateFormDialog?.error}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-[12px] font-medium text-slate-500">{t('模板描述')}</div>
          <textarea
            value={templateFormDialog?.templateDescription ?? ''}
            onChange={event => setTemplateFormDialog(prev => prev ? { ...prev, templateDescription: event.target.value, error: undefined } : prev)}
            className="field-input min-h-[120px] resize-none leading-6"
            placeholder={t('简要描述这个模板适合处理什么任务')}
          />
        </div>
      </DialogShell>

      <DialogShell
        open={Boolean(templateDeleteDialog)}
        onClose={() => setTemplateDeleteDialog(null)}
        maxWidthClassName="max-w-[420px]"
        title={t('删除模板')}
        description={templateDeleteDialog ? t('删除后无法恢复，模板“{name}”会从模板列表中移除。', { name: templateDeleteDialog.name }) : undefined}
        footer={(
          <>
            <button type="button" onClick={() => setTemplateDeleteDialog(null)} className="btn-secondary h-10 px-4 py-0 text-sm">
              {t('取消')}
            </button>
            <button type="button" onClick={() => void handleConfirmDeleteTemplate()} className="btn-primary h-10 bg-rose-600 px-5 py-0 text-sm text-white hover:bg-rose-700">
              {t('确认删除')}
            </button>
          </>
        )}
      >
        <div className="rounded-[20px] border border-rose-200 bg-rose-50/80 px-4 py-3 text-[13px] leading-6 text-rose-700">
          {t('这会删除模板定义，但不会影响已经保存的历史运行记录。')}
        </div>
      </DialogShell>

      <DialogShell
        open={Boolean(draftExitAction)}
        onClose={() => setDraftExitAction(null)}
        maxWidthClassName="max-w-[420px]"
        title={t('放弃未保存草稿')}
        description={t('当前草稿还没有保存，继续操作会丢失这些改动。')}
        footer={(
          <>
            <button type="button" onClick={() => setDraftExitAction(null)} className="btn-secondary h-10 px-4 py-0 text-sm">
              {t('继续编辑')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!draftExitAction) return
                executeDraftExitAction(draftExitAction)
                setDraftExitAction(null)
              }}
              className="btn-primary h-10 bg-rose-600 px-5 py-0 text-sm text-white hover:bg-rose-700"
            >
              {t('放弃草稿')}
            </button>
          </>
        )}
      >
        <div className="rounded-[20px] border border-amber-200 bg-amber-50/80 px-4 py-3 text-[13px] leading-6 text-amber-700">
          {t('建议先点击右上角“保存模板”，否则刷新页面或切换模板后，这份草稿都会消失。')}
        </div>
      </DialogShell>

      <ContextMenu
        open={Boolean(edgeContextMenu)}
        left={edgeContextMenu?.left ?? 0}
        top={edgeContextMenu?.top ?? 0}
        onClose={() => setEdgeContextMenu(null)}
        items={edgeContextMenu ? [
          { key: 'edit-edge', label: t('编辑连线'), onSelect: () => openEdgeEditor(edgeContextMenu.edgeId), disabled: isBuiltinTemplate },
          { key: 'delete-edge', label: t('删除连线'), onSelect: () => handleDeleteEdge(edgeContextMenu.edgeId), tone: 'danger', disabled: isBuiltinTemplate },
        ] : []}
      />

      <DialogShell
        open={Boolean(nodeEditor)}
        onClose={() => setNodeEditor(null)}
        maxWidthClassName="max-w-[560px]"
        title={nodeEditor?.mode === 'edit' ? t('编辑节点') : t('新增下游节点')}
        description={nodeEditor?.mode === 'edit'
          ? t('调整节点展示名称、Agent 类型和 Prompt。')
          : t('新节点会自动连接到 {name} 后面。', { name: parentNode?.data.displayName || parentNode?.data.agentName || t('当前节点') })}
        footer={(
          <>
            <button type="button" onClick={() => setNodeEditor(null)} className="btn-secondary h-10 px-4 py-0 text-sm">
              {t('取消')}
            </button>
            <button type="button" onClick={handleConfirmNodeEditor} className="btn-primary h-10 px-5 py-0 text-sm">
              {t('确认')}
            </button>
          </>
        )}
      >
        {nodeEditor && (
          <>
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-slate-500">{t('展示名称')}</div>
              <input
                value={nodeEditor.displayName}
                onChange={event => updateNodeEditor({ displayName: event.target.value })}
                className="field-input"
                placeholder={t('选填，用于替代默认 Agent 名称展示')}
              />
            </div>

            <div>
              <div className="mb-1.5 text-[12px] font-medium text-slate-500">{t('Agent 类型')}</div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'custom', label: t('自定义 Agent') },
                  { value: 'omc', label: 'OMC Agent' },
                ] as const).map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      const fallbackAgent = pickDefaultAgent(option.value)
                      updateNodeEditor({ agentType: option.value, agentName: fallbackAgent.name })
                    }}
                    className={`rounded-[16px] border px-3 py-2.5 text-sm font-medium transition ${
                      nodeEditor.agentType === option.value
                        ? 'border-black text-black'
                        : 'border-black/10 text-slate-500 hover:border-black/25 hover:text-black'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[12px] font-medium text-slate-500">Agent</div>
              <select
                value={nodeEditor.agentName}
                onChange={event => {
                  const selectedAgent = AGENT_OPTIONS.find(option => option.name === event.target.value)
                  if (!selectedAgent) return
                  updateNodeEditor({ agentName: selectedAgent.name, agentType: selectedAgent.type })
                }}
                className="field-input appearance-none"
              >
                {editorAgentOptions.map(option => (
                  <option key={option.name} value={option.name}>
                    {option.name}
                  </option>
                ))}
              </select>
              <div className="mt-1.5 text-[12px] text-slate-500">
                {getAgentDisplayDescription({ name: nodeEditor.agentName, type: nodeEditor.agentType, description: '' })}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[12px] font-medium text-slate-500">Prompt Template</div>
              <textarea
                value={nodeEditor.promptTemplate}
                onChange={event => updateNodeEditor({ promptTemplate: event.target.value })}
                className="field-input min-h-[144px] resize-none leading-6"
                placeholder={t('例如：基于 {{globalPrompt}} 继续完成这一部分')}
              />
            </div>
          </>
        )}
      </DialogShell>

      <DialogShell
        open={Boolean(edgeEditor)}
        onClose={() => setEdgeEditor(null)}
        maxWidthClassName="max-w-[480px]"
        title={t('编辑连线')}
        description={t('支持修改起点和终点，也可以直接拖动线头或线尾快速改线。')}
        footer={(
          <>
            <button type="button" onClick={() => setEdgeEditor(null)} className="btn-secondary h-10 px-4 py-0 text-sm">
              {t('取消')}
            </button>
            <button
              type="button"
              onClick={handleConfirmEdgeEditor}
              disabled={Boolean(edgeEditorError)}
              className="btn-primary h-10 px-5 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('确认')}
            </button>
          </>
        )}
      >
        {edgeEditor && (
          <>
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-slate-500">{t('起点节点')}</div>
              <select
                value={edgeEditor.source}
                onChange={event => setEdgeEditor(prev => prev ? { ...prev, source: event.target.value } : prev)}
                className="field-input appearance-none"
              >
                {nodes.map(node => (
                  <option key={node.id} value={node.id}>
                    {node.data.displayName || node.data.agentName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-1.5 text-[12px] font-medium text-slate-500">{t('终点节点')}</div>
              <select
                value={edgeEditor.target}
                onChange={event => setEdgeEditor(prev => prev ? { ...prev, target: event.target.value } : prev)}
                className="field-input appearance-none"
              >
                {nodes.map(node => (
                  <option key={node.id} value={node.id}>
                    {node.data.displayName || node.data.agentName}
                  </option>
                ))}
              </select>
            </div>

            {edgeEditorError && (
              <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {edgeEditorError}
              </div>
            )}
          </>
        )}
      </DialogShell>
    </div>
  )
}
