import type { IncomingMessage } from 'http'

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])
// Host 头只允许「本机名 + 可选端口」，不接受 userinfo、路径等畸形写法
const LOCAL_HOST_HEADER = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

function isLoopbackAddress(address = ''): boolean {
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

function hostnameOf(value: string): string {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname
  } catch {
    return ''
  }
}

// 免密模式只服务本机：对端必须是回环地址，Host 与 Origin（如有）必须是本机名。
// Host 校验挡 DNS rebinding，Origin 校验挡任意网页的跨站请求（WebSocket 不受 CORS 约束）。
export function isLocalRequest(req: Pick<IncomingMessage, 'headers' | 'socket'>): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  if (!LOCAL_HOST_HEADER.test(req.headers.host ?? '')) return false
  const origin = req.headers.origin
  return origin === undefined || LOCAL_HOSTNAMES.has(hostnameOf(origin))
}
