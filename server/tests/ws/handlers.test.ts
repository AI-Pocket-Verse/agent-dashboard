import { describe, it, expect } from 'vitest'
import { createMessageHandler } from '../../src/ws/handlers.js'

describe('createMessageHandler', () => {
  it('reports unknown message types instead of ignoring them', async () => {
    const handle = createMessageHandler({} as never, {} as never)
    await expect(handle({ type: 'task:unknown', payload: {} } as never, {} as never)).rejects.toThrow('Unknown message type: task:unknown')
  })
})
