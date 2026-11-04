import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { WsManager } from '../../src/ws/server.js'

const TEST_PORT = 39871
// 密码走 Sec-WebSocket-Protocol 子协议（base64url），不出现在 URL 里，代理访问日志不会记录
const authProtocols = (secret: string) => ['agent-dashboard', `auth.${Buffer.from(secret).toString('base64url')}`]
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

    const wrongSecret = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`, authProtocols('wrong'))
    const wrongSecretCode = await new Promise<number>(resolve => wrongSecret.on('close', resolve))
    expect(wrongSecretCode).toBe(4401)
  })

  it('no longer accepts the secret in the query string', async () => {
    manager = new WsManager(TEST_PORT, 'test-secret', () => {})
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/?secret=test-secret`, ['agent-dashboard'])
    const code = await new Promise<number>(resolve => ws.on('close', resolve))
    expect(code).toBe(4401)
  })

  it('accepts the secret in the subprotocol and only echoes the plain protocol name', async () => {
    manager = new WsManager(TEST_PORT, 'pässwörd/with+chars', () => {})
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`, authProtocols('pässwörd/with+chars'))
    let closeCode: number | null = null
    ws.on('close', code => { closeCode = code })
    await new Promise(resolve => ws.on('open', resolve))
    // 握手完成不代表通过鉴权：服务端会在 connection 回调里以 4401 关闭，所以要再等一会儿确认仍然连着
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(closeCode).toBeNull()
    expect(ws.protocol).toBe('agent-dashboard')
    ws.close()
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

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`, authProtocols('test-secret'))
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

  it('rejects messages whose payload is missing or lacks a runId, without reaching the handler', async () => {
    const received: unknown[] = []
    manager = new WsManager(TEST_PORT, '', msg => { received.push(msg) })
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`)
    await new Promise(resolve => ws.on('open', resolve))

    const replies: unknown[] = []
    ws.on('message', data => replies.push(JSON.parse(String(data))))
    ws.send(JSON.stringify({ type: 'task:cancel' }))
    ws.send(JSON.stringify({ type: 'task:confirm', payload: { nodeId: 'n1' } }))
    ws.send(JSON.stringify({ type: 'workflow:run', payload: [] }))
    await new Promise(resolve => setTimeout(resolve, 100))
    ws.close()

    expect(replies).toEqual([
      { type: 'error', payload: { message: 'Invalid payload', requestType: 'task:cancel' } },
      { type: 'error', payload: { message: 'Invalid payload', requestType: 'task:confirm' } },
      { type: 'error', payload: { message: 'Invalid payload', requestType: 'workflow:run' } },
    ])
    expect(received).toEqual([])
  })
})

describe('WsManager heartbeat', () => {
  it('pings clients and drops ones that stop answering', async () => {
    manager = new WsManager(TEST_PORT, '', () => {}, { heartbeatMs: 50 })
    const alive = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`)
    // autoPong:false 模拟已经断网、不再回 pong 的客户端
    const dead = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`, { autoPong: false })
    let pings = 0
    alive.on('ping', () => { pings++ })
    const deadClosed = new Promise<void>(resolve => dead.on('close', () => resolve()))
    await Promise.all([alive, dead].map(ws => new Promise(resolve => ws.on('open', resolve))))

    await Promise.race([deadClosed, new Promise((_, reject) => setTimeout(() => reject(new Error('dead client was not dropped')), 1000))])
    expect(pings).toBeGreaterThanOrEqual(2)
    expect(alive.readyState).toBe(WebSocket.OPEN)
    alive.close()
  })
})
