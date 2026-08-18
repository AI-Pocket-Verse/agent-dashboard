import { timingSafeEqual } from 'crypto'
import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

interface AuthOptions { secret: string }

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

const authPlugin: FastifyPluginAsync<AuthOptions> = async (fastify, opts) => {
  if (!opts.secret) return // open local mode: no secret configured, skip auth

  fastify.addHook('onRequest', async (request, reply) => {
    const auth = request.headers.authorization
    if (!auth || !safeEqual(auth, `Bearer ${opts.secret}`)) {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })
}

export default fp(authPlugin)
export { authPlugin }
