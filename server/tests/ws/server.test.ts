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

describe('WsManager open local mode guard', () => {
  it('rejects cross-site origins with 4403 and never delivers their messages', async () => {
    const received: unknown[] = []
    manager = new WsManager(TEST_PORT, '', msg => { received.push(msg) })

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`, { headers: { Origin: 'https://evil.example' } })
    ws.on('open', () => ws.send(JSON.stringify({ type: 'task:cancel', payload: { runId: 'r1' } })))
    const code = await new Promise<number>(resolve => ws.on('close', resolve))

    expect(code).toBe(4403)
    expect(received).toEqual([])
  })

  it('accepts the local dev UI origin', async () => {
    manager = new WsManager(TEST_PORT, '', () => {})
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`, { headers: { Origin: 'http://localhost:5173' } })
    await new Promise(resolve => ws.on('open', resolve))
    ws.close()
  })
})

describe('WsManager handler errors', () => {
  it('reports handler failures to the sender instead of crashing the process', async () => {
    let calls = 0
    manager = new WsManager(TEST_PORT, '', async () => {
      calls += 1
      if (calls === 1) throw new Error('同一个任务中不能重复使用 Agent: x')
    })

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`)
    await new Promise(resolve => ws.on('open', resolve))
    const reply = new Promise<unknown>(resolve => ws.once('message', data => resolve(JSON.parse(String(data)))))
    ws.send(JSON.stringify({ type: 'workflow:run', payload: {} }))

    expect(await reply).toEqual({
      type: 'error',
      payload: { message: '同一个任务中不能重复使用 Agent: x', requestType: 'workflow:run' },
    })

    ws.send(JSON.stringify({ type: 'task:cancel', payload: { runId: 'r1' } }))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(calls).toBe(2)
    ws.close()
  })
})

describe('WsManager message validation', () => {
  it('rejects messages that are not objects with a type', async () => {
    const received: unknown[] = []
    manager = new WsManager(TEST_PORT, '', msg => { received.push(msg) })
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`)
    await new Promise(resolve => ws.on('open', resolve))

    const reply = new Promise<unknown>(resolve => ws.once('message', data => resolve(JSON.parse(String(data)))))
    ws.send('null')

    expect(await reply).toEqual({ type: 'error', payload: { message: 'Invalid message' } })
    expect(received).toEqual([])
    ws.close()
  })
})
