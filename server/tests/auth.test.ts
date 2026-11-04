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

  it('allows all requests when secret is empty (open local mode)', async () => {
    const app = await buildApp('')
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(200)
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

describe('authPlugin open local mode guard', () => {
  it('rejects cross-site browser requests when no secret is configured', async () => {
    const app = await buildApp('')
    const res = await app.inject({ method: 'GET', url: '/protected', headers: { origin: 'https://evil.example' } })
    expect(res.statusCode).toBe(403)
  })

  it('rejects DNS-rebinding style requests whose Host is not local', async () => {
    const app = await buildApp('')
    const res = await app.inject({ method: 'GET', url: '/protected', headers: { host: 'evil.example:3001' } })
    expect(res.statusCode).toBe(403)
  })

  it('rejects requests from non-loopback peers when no secret is configured', async () => {
    const app = await buildApp('')
    const res = await app.inject({ method: 'GET', url: '/protected', remoteAddress: '192.168.1.20' })
    expect(res.statusCode).toBe(403)
  })

  it('allows the local dev UI origin when no secret is configured', async () => {
    const app = await buildApp('')
    const res = await app.inject({ method: 'GET', url: '/protected', headers: { origin: 'http://localhost:5173', host: 'localhost:5173' } })
    expect(res.statusCode).toBe(200)
  })

  it('does not restrict origins once a secret is configured', async () => {
    const app = await buildApp('test-secret')
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      remoteAddress: '192.168.1.20',
      headers: { Authorization: 'Bearer test-secret', origin: 'https://dashboard.example.com', host: 'dashboard.example.com' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('authPlugin open mode Host matching', () => {
  it.each(['evil@localhost', 'localhost/evil', 'localhost.evil.example'])('rejects the malformed Host %s', async host => {
    const app = await buildApp('')
    const res = await app.inject({ method: 'GET', url: '/protected', headers: { host } })
    expect(res.statusCode).toBe(403)
  })

  it.each(['localhost:3001', 'LOCALHOST:5173', '127.0.0.1', '[::1]:3001'])('accepts the local Host %s', async host => {
    const app = await buildApp('')
    const res = await app.inject({ method: 'GET', url: '/protected', headers: { host } })
    expect(res.statusCode).toBe(200)
  })
})
