import { useWsStore } from '../store/wsStore'
import { t } from './i18n'
import type { WsClientMessage } from '../types/index'

// 发送失败（连接已断开、正在重连）时的统一提示，由 App 的 toast 展示
export function sendFailedMessage() {
  return t('连接已断开，正在重连，请稍后重试')
}

// 发送一条 WS 消息：失败时登记提示并返回 false，调用方据此保留本地状态、不继续后续动作
export function sendOrNotify(msg: WsClientMessage): boolean {
  const { send, setLastError } = useWsStore.getState()
  if (send(msg)) return true
  setLastError({ message: sendFailedMessage(), at: Date.now() })
  return false
}
