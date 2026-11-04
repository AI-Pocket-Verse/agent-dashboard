import type { FastifyPluginAsync } from 'fastify'
import type { PersistenceStore } from '../store/persistence.js'
import type { WorkflowTemplate } from '@agent-dashboard/shared'
import { v4 as uuid } from 'uuid'
import { BUILTIN_TEMPLATES } from '../workflows/templates.js'
import { assertValidDag } from '../workflows/graph.js'

interface WorkflowsRouteOptions { store: PersistenceStore }

// 返回图的校验错误；合法时返回 null
function graphError(template: Pick<WorkflowTemplate, 'nodes' | 'edges'>): string | null {
  try {
    assertValidDag(template.nodes, template.edges)
    return null
  } catch (err) {
    return (err as Error).message
  }
}

// 名称必须是去空格后非空的字符串，否则返回 null
function normalizeName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  return trimmed || null
}

const workflowsRoute: FastifyPluginAsync<WorkflowsRouteOptions> = async (fastify, opts) => {
  fastify.get('/api/templates', async () => {
    const custom = await opts.store.loadTemplates()
    return [...BUILTIN_TEMPLATES, ...custom]
  })

  fastify.post<{ Body: Omit<WorkflowTemplate, 'id' | 'createdAt'> }>('/api/templates', async (req, reply) => {
    const nextName = normalizeName(req.body?.name)
    if (!nextName) return reply.status(400).send({ error: 'template name is required' })
    const invalid = graphError(req.body)
    if (invalid) return reply.status(400).send({ error: invalid })
    const existingTemplates = [...BUILTIN_TEMPLATES, ...await opts.store.loadTemplates()]
    const duplicate = existingTemplates.some(template => template.name.trim() === nextName)
    if (duplicate) {
      return reply.status(409).send({ error: 'template name already exists' })
    }

    const template: WorkflowTemplate = { ...req.body, name: nextName, id: uuid(), createdAt: Date.now() }
    await opts.store.saveTemplate(template)
    return template
  })

  fastify.put<{ Params: { id: string }; Body: WorkflowTemplate }>('/api/templates/:id', async (req, reply) => {
    const id = req.params.id
    if (BUILTIN_TEMPLATES.some(template => template.id === id)) {
      return reply.status(403).send({ error: 'built-in templates cannot be modified' })
    }
    const customTemplates = await opts.store.loadTemplates()
    const current = customTemplates.find(template => template.id === id)
    if (!current) return reply.status(404).send({ error: 'template not found' })

    const nextName = normalizeName(req.body?.name)
    if (!nextName) return reply.status(400).send({ error: 'template name is required' })
    const invalid = graphError(req.body)
    if (invalid) return reply.status(400).send({ error: invalid })
    const duplicate = [...BUILTIN_TEMPLATES, ...customTemplates].some(template => (
      template.id !== id && template.name.trim() === nextName
    ))
    if (duplicate) {
      return reply.status(409).send({ error: 'template name already exists' })
    }

    // 以 URL 的 id 为准，保留原创建时间
    const template: WorkflowTemplate = { ...req.body, name: nextName, id, createdAt: current.createdAt }
    await opts.store.saveTemplate(template)
    return template
  })

  fastify.delete<{ Params: { id: string } }>('/api/templates/:id', async (req) => {
    await opts.store.deleteTemplate(req.params.id)
    return { ok: true }
  })
}

export default workflowsRoute
