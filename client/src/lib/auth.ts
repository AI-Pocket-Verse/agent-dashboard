const STORAGE_KEY = 'dashboard_token'

// Runtime token: entered once via the login gate and kept in localStorage.
// VITE_DASHBOARD_SECRET remains as a dev convenience (start.sh) — production
// builds must not set it, otherwise the secret is baked into the JS bundle.
export function getToken(): string {
  return localStorage.getItem(STORAGE_KEY) ?? import.meta.env.VITE_DASHBOARD_SECRET ?? ''
}

export function hasStoredToken(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null
}

export function setToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// ok：可以进入；forbidden：服务端处于免密模式但拒绝了非本机访问（403 且响应体含 DASHBOARD_SECRET），输入密码也没用；
// denied：需要密码、密码错误，或其他失败（含反向代理等返回的普通 403）
export type TokenCheck = 'ok' | 'forbidden' | 'denied'

export async function verifyToken(token: string): Promise<TokenCheck> {
  try {
    const res = await fetch('/api/health', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) return 'ok'
    if (res.status === 403 && (await readBody(res)).includes('DASHBOARD_SECRET')) return 'forbidden'
    return 'denied'
  } catch {
    return 'denied'
  }
}

async function readBody(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
