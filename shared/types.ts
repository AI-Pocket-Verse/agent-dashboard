// ─── Agent ────────────────────────────────────────────────────────────────────

export type AgentType = 'custom' | 'omc'
export type AgentStatus = 'idle' | 'running' | 'error'

export interface AgentInfo {
  name: string
  type: AgentType
  description: string
  status: AgentStatus
  lastRunAt?: number
}

// ─── Workflow Template ────────────────────────────────────────────────────────

export interface TemplateNode {
  id: string
  agentName: string
  agentType: AgentType
  displayName?: string
  promptTemplate: string // supports {{nodes.<id>.output}} interpolation
}

export interface Edge {
  from: string // nodeId
  to: string   // nodeId
}

export interface WorkflowTemplate {
  id: string
  name: string
  description?: string
  nodes: TemplateNode[]
  edges: Edge[]
  createdAt: number
}

// ─── Code Context ─────────────────────────────────────────────────────────────

export interface CodeContext {
  path: string        // relative to PROJECT_ROOT
  description: string
  type: 'file' | 'directory'
}

export interface TaskAttachment {
  name: string
  mime: string
  contentBase64: string
}

export interface SavedAttachment {
  name: string
  mime: string
  path: string
}

// ─── Workflow Run ─────────────────────────────────────────────────────────────

export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed'
export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'waiting'
export type ExecutionMode = 'serial' | 'dag'

export interface NodeRun {
  id: string
  agentName: string
  agentType: AgentType
  displayName?: string
  prompt: string
  codeContext: CodeContext[]
  status: NodeStatus
  output?: string     // AI-extracted summary after completion
  logs: string[]
  logCount?: number   // total logs available for paged loading
  pid?: number
  startedAt?: number
  finishedAt?: number
}

export interface WorkflowRound {
  id: string
  prompt: string
  status: RunStatus
  nodes: NodeRun[]
  edges: Edge[]
  createdAt: number
  completedAt?: number
  workspaceSnapshotId?: string
}

export interface WorkflowRun {
  id: string
  name: string
  prompt?: string        // original user request used to create the run
  projectName?: string   // display slug generated from user/project prompt
  workspacePath?: string  // relative isolated execution directory under WORKSPACE_ROOT
  status: RunStatus
  nodes: NodeRun[]
  edges: Edge[]
  rounds?: WorkflowRound[]
  activeRoundId?: string
  attachments?: SavedAttachment[]
  requireConfirm: boolean
  executionMode?: ExecutionMode
  autoFixRound?: number   // # of auto-fix rounds appended after a code-reviewer found issues
  createdAt: number
  completedAt?: number
}

export interface AutoFixOffer {
  runId: string
  roundId: string
  reviewerNodeId: string
  reviewerAgentName: string
  summary: string
  affectedPaths: string[]
  suggestedAgent: string | null    // null => caller should fall back to AI selection
  suggestionSource: 'rule' | 'ai-fallback'
  remainingBudget: number
}

export interface RunNodeLogsPage {
  items: string[]
  start: number
  total: number
  nextBefore: number | null
}

// ─── WebSocket Messages ───────────────────────────────────────────────────────

export type WsClientMessage =
  | { type: 'task:create'; payload: CreateTaskPayload }
  | { type: 'workflow:run'; payload: RunWorkflowPayload }
  | { type: 'workflow:continue'; payload: ContinueWorkflowPayload }
  | { type: 'task:cancel'; payload: { runId: string } }
  | { type: 'task:confirm'; payload: { runId: string; roundId?: string; nodeId: string; instruction?: string } }
  | { type: 'task:auto_fix_decline'; payload: { runId: string } }

export type WsServerMessage =
  | { type: 'agent:status'; payload: { agentName: string; status: AgentStatus } }
  | { type: 'agent:log'; payload: { runId: string; roundId?: string; nodeId: string; line: string } }
  | { type: 'workflow:node_status'; payload: { runId: string; roundId?: string; nodeId: string; status: NodeStatus; startedAt?: number; finishedAt?: number } }
  | { type: 'workflow:status'; payload: { runId: string; roundId?: string; status: RunStatus } }
  | { type: 'workflow:dataflow'; payload: { runId: string; fromNodeId: string; toNodeId: string; data: string } }
  | { type: 'task:completed'; payload: { runId: string; roundId?: string } }
  | { type: 'task:error'; payload: { runId: string; roundId?: string; nodeId: string; exitCode: number; lastLines: string[] } }
  | { type: 'task:confirm_required'; payload: { runId: string; roundId?: string; nodeId: string; summary: string; nextNodeIds: string[] } }
  | { type: 'task:auto_fix_required'; payload: AutoFixOffer }
  | { type: 'file:activity'; payload: { runId: string; path: string; active: boolean } }
  | { type: 'state:snapshot'; payload: { agents: AgentInfo[]; activeRuns: WorkflowRun[] } }

// ─── API Payloads ─────────────────────────────────────────────────────────────

export interface CreateTaskPayload {
  agentName: string
  agentType: AgentType
  prompt: string
  projectName?: string       // workspace directory name; server auto-generates if omitted
  codeContext?: CodeContext[]
  attachments?: TaskAttachment[]
  requireConfirm?: boolean
}

export interface RunWorkflowPayload {
  templateId?: string        // use existing template
  name: string
  projectName?: string       // workspace directory name; server auto-generates if omitted
  nodes: TemplateNode[]
  edges: Edge[]
  globalPrompt: string       // injected into each node's prompt if not overridden
  codeContext?: CodeContext[]
  attachments?: TaskAttachment[]
  requireConfirm?: boolean
  executionMode?: ExecutionMode
}

export interface ContinueWorkflowPayload extends RunWorkflowPayload {
  runId: string
}

export interface AiSelectResponse {
  nodes: TemplateNode[]
  edges: Edge[]
  explanation: string
}
