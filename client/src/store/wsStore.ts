import { create } from 'zustand'
import type { WsClientMessage } from '../types/index'

interface WsState {
  send: (msg: WsClientMessage) => void
  setSend: (fn: (msg: WsClientMessage) => void) => void
}

export const useWsStore = create<WsState>((set) => ({
  send: () => { /* not connected yet */ },
  setSend: (fn) => set({ send: fn }),
}))
