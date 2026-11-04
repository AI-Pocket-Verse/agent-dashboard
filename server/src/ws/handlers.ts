import type { WebSocket } from 'ws'
import type { WsClientMessage } from '@agent-dashboard/shared'
import type { DAGEngine } from '../workflows/engine.js'
import type { WsManager } from './server.js'

export function createMessageHandler(
  engine: DAGEngine,
  wsManager: WsManager
) {
  return async (msg: WsClientMessage, ws: WebSocket): Promise<void> => {
    switch (msg.type) {
      case 'task:create': {
        const run = await engine.startSingleAgent(msg.payload)
        wsManager.send(ws, { type: 'state:snapshot', payload: { agents: [], activeRuns: [run] } })
        break
      }
      case 'workflow:run': {
        const run = await engine.startWorkflow(msg.payload)
        wsManager.send(ws, { type: 'state:snapshot', payload: { agents: [], activeRuns: [run] } })
        break
      }
      case 'workflow:continue': {
        const run = await engine.continueWorkflow(msg.payload.runId, msg.payload)
        wsManager.send(ws, { type: 'state:snapshot', payload: { agents: [], activeRuns: [run] } })
        break
      }
      case 'task:cancel': {
        engine.cancelRun(msg.payload.runId)
        break
      }
      case 'task:confirm': {
        engine.confirmNode(msg.payload.runId, msg.payload.nodeId, msg.payload.instruction)
        break
      }
      case 'task:auto_fix_decline': {
        engine.declineAutoFix(msg.payload.runId)
        break
      }
      default:
        throw new Error(`Unknown message type: ${(msg as { type: string }).type}`)
    }
  }
}
