import axios from 'axios'
import type { AgentInfo, WorkflowRun, WorkflowTemplate, AiSelectResponse, RunNodeLogsPage } from '../types/index.js'
import { getToken, hasStoredToken, clearToken } from './auth.js'

const http = axios.create({ baseURL: '/api' })

http.interceptors.request.use(config => {
  config.headers.Authorization = `Bearer ${getToken()}`
  return config
})

http.interceptors.response.use(undefined, error => {
  // Stored token revoked/changed → drop it and let the login gate take over
  if (error?.response?.status === 401 && hasStoredToken()) {
    clearToken()
    window.location.reload()
  }
  return Promise.reject(error)
})

export const api = {
  getAgents: () => http.get<AgentInfo[]>('/agents').then(r => r.data),
  getRuns: () => http.get<WorkflowRun[]>('/runs').then(r => r.data),
  getRun: (id: string) => http.get<WorkflowRun>(`/runs/${id}`).then(r => r.data),
  getActiveRuns: () => http.get<WorkflowRun[]>('/runs/active').then(r => r.data),
  getRunNodeLogs: (runId: string, nodeId: string, params: { before?: number; limit?: number; roundId?: string } = {}) => {
    const { roundId, ...query } = params
    const url = roundId
      ? `/runs/${runId}/rounds/${roundId}/nodes/${nodeId}/logs`
      : `/runs/${runId}/nodes/${nodeId}/logs`
    return http.get<RunNodeLogsPage>(url, { params: query }).then(r => r.data)
  },
  cancelRun: (id: string) => http.delete(`/runs/${id}`),
  getTemplates: () => http.get<WorkflowTemplate[]>('/templates').then(r => r.data),
  createTemplate: (t: Omit<WorkflowTemplate, 'id' | 'createdAt'>) =>
    http.post<WorkflowTemplate>('/templates', t).then(r => r.data),
  updateTemplate: (t: WorkflowTemplate) =>
    http.put<WorkflowTemplate>(`/templates/${t.id}`, t).then(r => r.data),
  deleteTemplate: (id: string) => http.delete(`/templates/${id}`),
  selectAgents: (task: string, agents: AgentInfo[]) =>
    http.post<AiSelectResponse>('/ai/select', { task, agents }).then(r => r.data),
  saveRun: (run: WorkflowRun) =>
    http.post('/runs', run).then(r => r.data),
  fsBrowse: (path: string) =>
    http.get<{ path: string; parent: string; items: FsItem[]; isFile: boolean }>('/fs/browse', { params: { path } }).then(r => r.data),
  fsRoots: () =>
    http.get<{ projectRoot: string; home: string }>('/fs/roots').then(r => r.data),
  getRunWorkspaceFiles: (runId: string, path?: string) =>
    http.get<RunWorkspaceFilesResponse>(`/fs/runs/${runId}/files`, { params: path ? { path } : undefined }).then(r => r.data),
  getRunWorkspaceFileContent: (runId: string, path: string) =>
    http.get<RunWorkspaceFileContent>(`/fs/runs/${runId}/files/content`, { params: { path } }).then(r => r.data),
  // 原始文件走带 Authorization 的请求取 blob：<img src> 无法带请求头，密码也不能放进 URL
  getRunFileBlob: (runId: string, path: string) =>
    http.get<Blob>(`/fs/runs/${runId}/raw`, { params: { path }, responseType: 'blob' }).then(r => r.data),
  getRunPreview: (runId: string) =>
    http.get<RunPreviewResponse>(`/fs/runs/${runId}/preview`).then(r => r.data),
}

export interface FsItem {
  name: string
  type: 'file' | 'directory'
  path: string
}

export interface RunWorkspaceEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: number
}

export interface RunWorkspaceFilesResponse {
  root: string
  path: string
  entries: RunWorkspaceEntry[]
}

export interface RunWorkspaceFileContent {
  path: string
  size: number
  modifiedAt: number
  content: string
  isBinary: boolean
  truncated: boolean
}

export interface RunPreviewResponse {
  path: string
  content: string
  modifiedAt: number
}
