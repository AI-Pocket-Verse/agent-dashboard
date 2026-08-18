import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { WsManager } from '../../src/ws/server.js'

const TEST_PORT = 39871
let manager: WsManager | null = null

afterEach(() => {
  manager?.close()
  manager = null
})

describe('WsManager auth', () => {
  it('closes connections without the correct secret with code 4401', async () => {
    manager = new WsManager(TEST_PORT, 'test-secret', () => {})

    const noSecret = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`)
    const noSecretCode = await new Promise<number>(resolve => noSecret.on('close', resolve))
    expect(noSecretCode).toBe(4401)

    const wrongSecret = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/?secret=wrong`)
    const wrongSecretCode = await new Promise<number>(resolve => wrongSecret.on('close', resolve))
    expect(wrongSecretCode).toBe(4401)
  })

  it('accepts secretless connections when no secret is configured (open local mode)', async () => {
    manager = new WsManager(TEST_PORT, '', () => {})
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`)
    await new Promise(resolve => ws.on('open', resolve))
    ws.close()
  })

  it('accepts connections with the correct secret and delivers messages', async () => {
    const received: unknown[] = []
    manager = new WsManager(TEST_PORT, 'test-secret', msg => { received.push(msg) })

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/?secret=test-secret`)
    await new Promise(resolve => ws.on('open', resolve))
    ws.send(JSON.stringify({ type: 'task:cancel', payload: { runId: 'r1' } }))
    await new Promise(resolve => setTimeout(resolve, 100))
    ws.close()

    expect(received).toEqual([{ type: 'task:cancel', payload: { runId: 'r1' } }])
  })
})
