import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAgents } from '../hooks/useAgents'
import { useAgentStore } from '../store/agentStore'
import { useWsStore } from '../store/wsStore'
import { useWorkflowStore } from '../store/workflowStore'
import TaskForm from '../components/TaskForm/index'
import { api } from '../lib/api'
import { BUILTIN_TEMPLATES } from '../lib/builtinTemplates'
import type { WorkflowTemplate } from '../types/index'
import type { TaskMode } from '../components/TaskForm/ModeSelector'
import type { AgentInfo, CodeContext, ExecutionMode, TaskAttachment } from '../types/index'
import { t } from '../lib/i18n'

interface SubmitParams {
  mode: TaskMode
  prompt: string
  projectName: string
  codeContext: CodeContext[]
  attachments: TaskAttachment[]
  requireConfirm: boolean
  executionMode: ExecutionMode
  selectedAgents?: AgentInfo[]
  templateId?: string
}

function getRouteAttachments(attachments: TaskAttachment[]) {
  return attachments.map(({ name, mime }) => ({ name, mime }))
}

export default function Dashboard() {
  useAgents()
  const agents = useAgentStore(s => s.agents)
  const send = useWsStore(s => s.send)
  const setRunnerSession = useWorkflowStore(s => s.setRunnerSession)
  const [templates, setTemplates] = useState<WorkflowTemplate[]>(BUILTIN_TEMPLATES)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.getTemplates().then(setTemplates).catch(console.error)
  }, [])

  const handleSubmit = useCallback(async (params: SubmitParams) => {
    const { mode, prompt, projectName, codeContext, attachments, requireConfirm, executionMode, selectedAgents, templateId } = params
    setError(null)

    if (mode === 'ai') {
      const displayName = projectName || prompt.slice(0, 60)
      setRunnerSession({
        prompt,
        projectName: displayName,
        agentNames: [],
        templateName: '',
        codeContext,
        attachments: getRouteAttachments(attachments),
        autoRun: {
          prompt,
          projectName,
          codeContext,
          attachments,
          requireConfirm,
          executionMode,
        },
        autoRunStatus: 'selecting',
        autoRunError: null,
        autoRunStarted: false,
      })
      // 会话（含附件内容）只放内存 store，不写进浏览器历史，刷新或后退都不会重新启动
      navigate('/runner')
      return
    }

    setSubmitting(true)
    try {
      const displayName    = projectName || prompt.slice(0, 60)
      const routeAgents  = selectedAgents?.map(a => a.name) ?? []
      const routeTemplate = mode === 'template' ? templates.find(t => t.id === templateId)?.name ?? '' : ''
      if (mode === 'manual') {
        const chosen = selectedAgents ?? []
        if (chosen.length === 0) {
          setError(t('请至少选择一个 Agent'))
          return
        }
        if (chosen.length === 1) {
          send({
            type: 'task:create',
            payload: {
              agentName: chosen[0].name,
              agentType: chosen[0].type,
              prompt,
              projectName: projectName || undefined,
              codeContext,
              attachments,
              requireConfirm,
            },
          })
        } else {
          const nodes = chosen.map((a, i) => ({
            id: `node-${i}`,
            agentName: a.name,
            agentType: a.type,
            promptTemplate: prompt,
          }))
          const edges = chosen.slice(0, -1).map((_, i) => ({
            from: `node-${i}`,
            to: `node-${i + 1}`,
          }))
          send({
            type: 'workflow:run',
            payload: {
              name: displayName,
              projectName: projectName || undefined,
              nodes,
              edges,
              globalPrompt: prompt,
              codeContext,
              attachments,
              requireConfirm,
              executionMode,
            },
          })
        }
      } else if (mode === 'template') {
        const template = templates.find(t => t.id === templateId)
        if (!template) {
          setError(t('请选择一个模板'))
          return
        }
        send({
          type: 'workflow:run',
          payload: {
            templateId,
            name: projectName || template.name,
            projectName: projectName || undefined,
            nodes: template.nodes,
            edges: template.edges,
            globalPrompt: prompt,
            codeContext,
            attachments,
            requireConfirm,
            executionMode,
          },
        })
      }
      const routeAttachments = getRouteAttachments(attachments)
      setRunnerSession({
        prompt,
        projectName: displayName,
        agentNames: routeAgents,
        templateName: routeTemplate,
        codeContext,
        attachments: routeAttachments,
      })
      navigate('/runner', {
        state: {
          prompt,
          projectName: displayName,
          agentNames: routeAgents,
          templateName: routeTemplate,
          codeContext,
          attachments: routeAttachments,
        },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('发布失败，请重试'))
    } finally {
      setSubmitting(false)
    }
  }, [agents, templates, send, navigate, setRunnerSession])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[rgb(247,248,253)] px-4 py-8 md:px-8">
      <div className="flex w-full max-w-[1180px] -translate-y-[100px] flex-col items-center justify-center">
        <div className="mb-10 text-center">
          <div className="mb-3 inline-flex items-center rounded-full border border-black/[0.06] px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Multi-Agent Studio
          </div>
          <h1 className="flex items-end justify-center gap-5 tracking-[-0.045em] text-black">
            <span className="text-[clamp(3rem,6.4vw,6rem)] font-semibold leading-[0.92]">AI</span>
            <span
              className="translate-y-[0.01em] text-[clamp(3rem,6.6vw,6.2rem)] font-semibold leading-[0.9] text-transparent"
              style={{ WebkitTextStroke: '1.1px rgba(17,17,20,0.72)' }}
            >
              Team
            </span>
          </h1>
        </div>

        <div className="flex w-full justify-center md:-translate-x-4 lg:-translate-x-5">
          <TaskForm
            agents={agents}
            templates={templates}
            onSubmit={handleSubmit}
            submitting={submitting}
            errorMessage={error}
          />
        </div>
      </div>
    </div>
  )
}
