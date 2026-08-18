import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { getToken, setToken, verifyToken } from '../../lib/auth'

type GateState = 'checking' | 'login' | 'ready'

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('checking')
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    verifyToken(getToken()).then(ok => setState(ok ? 'ready' : 'login'))
  }, [])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!input.trim() || submitting) return
    setSubmitting(true)
    const ok = await verifyToken(input.trim())
    setSubmitting(false)
    if (ok) {
      setToken(input.trim())
      setState('ready')
    } else {
      setError(true)
    }
  }

  if (state === 'ready') return <>{children}</>
  if (state === 'checking') return null

  return (
    <div className="flex h-screen items-center justify-center bg-[rgb(247,248,253)]">
      <form
        onSubmit={handleSubmit}
        className="flex w-[320px] flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
      >
        <div>
          <h1 className="text-lg font-semibold text-[rgb(25,29,38)]">Agent Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">输入访问密码（服务端 DASHBOARD_SECRET）</p>
        </div>
        <input
          type="password"
          autoFocus
          value={input}
          onChange={e => { setInput(e.target.value); setError(false) }}
          placeholder="访问密码"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        {error ? <p className="text-sm text-red-500">密码错误，请重试</p> : null}
        <button
          type="submit"
          disabled={submitting || !input.trim()}
          className="rounded-lg bg-[rgb(25,29,38)] py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? '验证中…' : '进入'}
        </button>
      </form>
    </div>
  )
}
