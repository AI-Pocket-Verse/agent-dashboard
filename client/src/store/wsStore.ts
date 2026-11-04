import { create } from 'zustand'
import type { WsClientMessage } from '../types/index'

// 服务端对某条请求回的 error；at 用来让页面只处理自己发出请求之后到达的错误
// 本地发送失败（连接已断开）也走这里：不带 requestType
export interface WsRequestError {
  message: string
  requestType?: WsClientMessage['type']
  at: number
}

interface WsState {
  // 返回是否真正发出；连接未就绪时为 false
  send: (msg: WsClientMessage) => boolean
  setSend: (fn: (msg: WsClientMessage) => boolean) => void
  lastError: WsRequestError | null
  setLastError: (error: WsRequestError | null) => void
}

export const useWsStore = create<WsState>((set) => ({
  send: () => false, // not connected yet
  setSend: (fn) => set({ send: fn }),
  lastError: null,
  setLastError: (error) => set({ lastError: error }),
}))
