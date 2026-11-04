import { timingSafeEqual } from 'crypto'
import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { isLocalRequest } from './localGuard.js'

interface AuthOptions { secret: string }

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

const authPlugin: FastifyPluginAsync<AuthOptions> = async (fastify, opts) => {
  if (!opts.secret) {
    // open local mode: no password, but only this machine may call the API
    fastify.addHook('onRequest', async (request, reply) => {
      if (!isLocalRequest(request.raw)) {
        reply.code(403).send({ error: 'Forbidden: set DASHBOARD_SECRET to allow non-local access' })
      }
    })
    return
  }

  fastify.addHook('onRequest', async (request, reply) => {
    const auth = request.headers.authorization
    if (!auth || !safeEqual(auth, `Bearer ${opts.secret}`)) {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })
}

export default fp(authPlugin)
export { authPlugin }
