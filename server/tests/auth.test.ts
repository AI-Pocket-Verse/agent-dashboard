import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { authPlugin } from '../src/auth.js'

async function buildApp(secret: string) {
  const app = Fastify()
  await app.register(authPlugin, { secret })
  app.get('/protected', async () => ({ ok: true }))
  return app
}

describe('authPlugin', () => {
  it('rejects requests without Authorization header', async () => {
    const app = await buildApp('test-secret')
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects wrong password', async () => {
    const app = await buildApp('test-secret')
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { Authorization: 'Bearer wrong' }
    })
    expect(res.statusCode).toBe(401)
  })

  it('allows correct password', async () => {
    const app = await buildApp('test-secret')
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { Authorization: 'Bearer test-secret' }
    })
    expect(res.statusCode).toBe(200)
  })
})
