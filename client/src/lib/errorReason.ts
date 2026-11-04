// 把请求失败压成一句可展示的原因：优先 HTTP 状态码，其次 message
export function errorReason(error: unknown): string {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status
  if (typeof status === 'number') return `HTTP ${status}`
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return ''
}
