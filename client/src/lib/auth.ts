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

export async function verifyToken(token: string): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { headers: { Authorization: `Bearer ${token}` } })
    return res.ok
  } catch {
    return false
  }
}
