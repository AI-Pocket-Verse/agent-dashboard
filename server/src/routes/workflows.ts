import type { FastifyPluginAsync } from 'fastify'
import type { PersistenceStore } from '../store/persistence.js'
import type { WorkflowTemplate } from '@agent-dashboard/shared'
import { v4 as uuid } from 'uuid'
import { BUILTIN_TEMPLATES } from '../workflows/templates.js'

interface WorkflowsRouteOptions { store: PersistenceStore }

const workflowsRoute: FastifyPluginAsync<WorkflowsRouteOptions> = async (fastify, opts) => {
  fastify.get('/api/templates', async () => {
    const custom = await opts.store.loadTemplates()
    return [...BUILTIN_TEMPLATES, ...custom]
  })

  fastify.post<{ Body: Omit<WorkflowTemplate, 'id' | 'createdAt'> }>('/api/templates', async (req, reply) => {
    const nextName = req.body.name.trim()
    const existingTemplates = [...BUILTIN_TEMPLATES, ...await opts.store.loadTemplates()]
    const duplicate = existingTemplates.some(template => template.name.trim() === nextName)
    if (duplicate) {
      return reply.status(409).send({ error: 'template name already exists' })
    }

    const template: WorkflowTemplate = { ...req.body, id: uuid(), createdAt: Date.now() }
    await opts.store.saveTemplate(template)
    return template
  })

  fastify.put<{ Params: { id: string }; Body: WorkflowTemplate }>('/api/templates/:id', async (req, reply) => {
    const nextName = req.body.name.trim()
    const existingTemplates = [...BUILTIN_TEMPLATES, ...await opts.store.loadTemplates()]
    const duplicate = existingTemplates.some(template => (
      template.id !== req.params.id
      && template.name.trim() === nextName
    ))
    if (duplicate) {
      return reply.status(409).send({ error: 'template name already exists' })
    }

    await opts.store.saveTemplate(req.body)
    return req.body
  })

  fastify.delete<{ Params: { id: string } }>('/api/templates/:id', async (req) => {
    await opts.store.deleteTemplate(req.params.id)
    return { ok: true }
  })
}

export default workflowsRoute
