import { create } from 'zustand'
import type { WsClientMessage } from '../types/index'

// 服务端对某条请求回的 error；at 用来让页面只处理自己发出请求之后到达的错误
export interface WsRequestError {
  message: string
  requestType?: WsClientMessage['type']
  at: number
}

interface WsState {
  send: (msg: WsClientMessage) => void
  setSend: (fn: (msg: WsClientMessage) => void) => void
  lastError: WsRequestError | null
  setLastError: (error: WsRequestError | null) => void
}

export const useWsStore = create<WsState>((set) => ({
  send: () => { /* not connected yet */ },
  setSend: (fn) => set({ send: fn }),
  lastError: null,
  setLastError: (error) => set({ lastError: error }),
}))
