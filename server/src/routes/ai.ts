import type { FastifyPluginAsync } from 'fastify'
import type { AgentInfo } from '@agent-dashboard/shared'
import { AiSelector } from '../ai/selector.js'

interface SelectBody { task: string; agents: AgentInfo[] }

const selector = new AiSelector()

function getErrorMessage(err: unknown) {
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  return 'AI selection failed'
}

const aiRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: SelectBody }>('/api/ai/select', async (req, reply) => {
    const { task, agents } = req.body
    if (!task || !agents) {
      return reply.status(400).send({ error: 'task and agents are required' })
    }
    try {
      return await selector.selectAgents(task, agents)
    } catch (err) {
      req.log.error(err, 'AI agent selection failed')
      return reply.status(500).send({ error: getErrorMessage(err) })
    }
  })
}

export default aiRoute
