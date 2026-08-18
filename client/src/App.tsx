import { Routes, Route, NavLink } from 'react-router-dom'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { getToken } from './lib/auth'
import { t, useLocaleStore, type LocaleSetting } from './lib/i18n'
import { useAgentStore } from './store/agentStore'
import { useWorkflowStore } from './store/workflowStore'
import { useWsStore } from './store/wsStore'
import type { WsServerMessage } from './types/index'
import Dashboard from './pages/Dashboard'
import RunnerPage from './pages/RunnerPage'
import Canvas from './pages/Canvas'
import History from './pages/History'
import ContextMenu from './components/ContextMenu'

// Default: same-origin /ws (proxied by vite in dev, nginx in production)
const WS_URL = import.meta.env.VITE_WS_URL
  ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`

type CopyMenuState = {
  left: number
  top: number
  text: string
}

function getSelectedText(target: EventTarget | null) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd, value } = target
    if (selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd) {
      return value.slice(Math.min(selectionStart, selectionEnd), Math.max(selectionStart, selectionEnd)).trim()
    }
  }

  return window.getSelection()?.toString().trim() ?? ''
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)

  try {
    textarea.select()
    document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

function NavIcon({
  active = false,
  outline,
  solid,
  solidScaleClass = '',
}: {
  active?: boolean
  outline: ReactNode
  solid: ReactNode
  solidScaleClass?: string
}) {
  return (
    <span className="relative block h-[28px] w-[28px]">
      <span className={`absolute inset-0 transition-opacity duration-150 ease-out ${active ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'}`}>
        {outline}
      </span>
      <span className={`absolute inset-0 transition-all duration-150 ease-out ${solidScaleClass} ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {solid}
      </span>
    </span>
  )
}

function DashboardIcon({ active = false }: { active?: boolean }) {
  return (
    <NavIcon
      active={active}
      solidScaleClass="scale-[1.08]"
      outline={(
        <svg viewBox="0 0 24 24" fill="none" className="h-[28px] w-[28px] text-current">
          <path
            d="M7.2 7.8h9.6a2.3 2.3 0 0 1 2.3 2.3v5.4a2.3 2.3 0 0 1-2.3 2.3h-5l-3.9 2.7v-2.7H7.2a2.3 2.3 0 0 1-2.3-2.3v-5.4a2.3 2.3 0 0 1 2.3-2.3Z"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path d="M12 10.3v5.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <path d="M9.4 12.9h5.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )}
      solid={(
        <svg viewBox="0 0 24 24" fill="none" className="h-[28px] w-[28px] text-current">
          <path
            fill="currentColor"
            fillRule="evenodd"
            clipRule="evenodd"
            d="M7.2 7.8h9.6a2.3 2.3 0 0 1 2.3 2.3v5.4a2.3 2.3 0 0 1-2.3 2.3h-5l-3.9 2.7v-2.7H7.2a2.3 2.3 0 0 1-2.3-2.3v-5.4a2.3 2.3 0 0 1 2.3-2.3Zm3.85 2.5c0-.52.42-.95.95-.95s.95.43.95.95v1.65h1.65c.52 0 .95.42.95.95s-.43.95-.95.95h-1.65v1.65c0 .52-.42.95-.95.95s-.95-.43-.95-.95v-1.65H9.4a.95.95 0 0 1 0-1.9h1.65v-1.65Z"
          />
        </svg>
      )}
    />
  )
}

function RunnerIcon({ active = false }: { active?: boolean }) {
  return (
    <NavIcon
      active={active}
      solidScaleClass="scale-[1.08]"
      outline={(
        <svg viewBox="0 0 24 24" fill="none" className="h-[28px] w-[28px] text-current">
          <path
            d="M7.4 8.4h9.2l-.8 8.2a2 2 0 0 1-2 1.8h-3.6a2 2 0 0 1-2-1.8l-.8-8.2Z"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path d="M9.2 8.4V7.5a2.8 2.8 0 1 1 5.6 0v.9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )}
      solid={(
        <svg viewBox="0 0 24 24" fill="none" className="h-[28px] w-[28px] text-current">
          <path
            fill="currentColor"
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 4.7c-1.55 0-2.8 1.26-2.8 2.8v.9H7.4l.8 8.2a2 2 0 0 0 2 1.8h3.6a2 2 0 0 0 2-1.8l.8-8.2h-1.8v-.9c0-1.54-1.25-2.8-2.8-2.8Zm0 1.9c.5 0 .9.4.9.9v.9h-1.8v-.9c0-.5.4-.9.9-.9Z"
          />
        </svg>
      )}
    />
  )
}

function CanvasIcon({ active = false }: { active?: boolean }) {
  return (
    <NavIcon
      active={active}
      outline={(
        <svg viewBox="0 0 24 24" fill="none" className="h-[28px] w-[28px] text-current">
          <rect x="4" y="5" width="16" height="6" rx="2" stroke="currentColor" strokeWidth="1.9" />
          <rect x="4" y="14" width="7" height="6" rx="2" stroke="currentColor" strokeWidth="1.9" />
          <rect x="13" y="14" width="7" height="6" rx="2" stroke="currentColor" strokeWidth="1.9" />
        </svg>
      )}
      solid={(
        <svg viewBox="0 0 24 24" fill="none" className="h-[28px] w-[28px] text-current">
          <rect x="4" y="5" width="16" height="6" rx="2" fill="currentColor" />
          <rect x="4" y="14" width="7" height="6" rx="2" fill="currentColor" />
          <rect x="13" y="14" width="7" height="6" rx="2" fill="currentColor" />
        </svg>
      )}
    />
  )
}

function HistoryIcon({ active = false }: { active?: boolean }) {
  return (
    <NavIcon
      active={active}
      outline={(
        <svg viewBox="0 0 24 24" fill="none" className="h-[28px] w-[28px] text-current">
          <circle cx="12" cy="12" r="7.9" stroke="currentColor" strokeWidth="1.9" />
          <path d="M12 8.1v4.4l2.9 1.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      solid={(
        <svg viewBox="0 0 24 24" fill="none" className="h-[28px] w-[28px] text-current">
          <path
            fill="currentColor"
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 4.1a7.9 7.9 0 1 1 0 15.8 7.9 7.9 0 0 1 0-15.8Zm-.95 3.95c0-.52.42-.95.95-.95s.95.43.95.95v3.87l2.54 1.58a.95.95 0 0 1-.99 1.62l-3-1.85a.95.95 0 0 1-.45-.8V8.05Z"
          />
        </svg>
      )}
    />
  )
}

const NAV_ITEMS = [
  { to: '/', label: '创建', Icon: DashboardIcon },
  { to: '/runner', label: '运行', Icon: RunnerIcon },
  { to: '/canvas', label: '模板', Icon: CanvasIcon },
  { to: '/history', label: '历史', Icon: HistoryIcon },
]

const LOCALE_OPTIONS: Array<{ value: LocaleSetting; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
]

function LanguageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px] text-current">
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.8 12h16.4M12 3.8c-2.3 2.4-3.4 5.2-3.4 8.2s1.1 5.8 3.4 8.2c2.3-2.4 3.4-5.2 3.4-8.2s-1.1-5.8-3.4-8.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

export default function App() {
  const [copyMenu, setCopyMenu] = useState<CopyMenuState | null>(null)
  const [copyToastVisible, setCopyToastVisible] = useState(false)
  const [langMenu, setLangMenu] = useState<{ left: number; top: number } | null>(null)
  // Subscribing here re-renders the whole tree on language change, so plain t() stays fresh everywhere.
  const localeSetting = useLocaleStore(s => s.setting)
  useLocaleStore(s => s.locale)
  const setLocaleSetting = useLocaleStore(s => s.setSetting)
  const { setAgents, setAgentStatus } = useAgentStore()
  const { upsertRun, appendLog, setNodeStatus, setRunStatus, completeRun, failRun, setPendingConfirm, setPendingAutoFix, setFileActivity, clearActiveFiles } = useWorkflowStore()
  const setSend = useWsStore(s => s.setSend)

  const handleMessage = useCallback((msg: WsServerMessage) => {
    switch (msg.type) {
      case 'state:snapshot':
        setAgents(msg.payload.agents)
        msg.payload.activeRuns.forEach(upsertRun)
        break
      case 'agent:status':
        setAgentStatus(msg.payload.agentName, msg.payload.status)
        break
      case 'agent:log':
        appendLog(msg.payload.runId, msg.payload.nodeId, msg.payload.line, msg.payload.roundId)
        break
      case 'workflow:node_status':
        setNodeStatus(msg.payload.runId, msg.payload.nodeId, msg.payload.status, {
          startedAt: msg.payload.startedAt,
          finishedAt: msg.payload.finishedAt,
          roundId: msg.payload.roundId,
        })
        break
      case 'workflow:status':
        setRunStatus(msg.payload.runId, msg.payload.status, msg.payload.roundId)
        break
      case 'task:completed':
        completeRun(msg.payload.runId)
        clearActiveFiles(msg.payload.runId)
        break
      case 'task:error':
        failRun(msg.payload.runId, msg.payload.nodeId, msg.payload.exitCode)
        clearActiveFiles(msg.payload.runId)
        break
      case 'task:confirm_required':
        setPendingConfirm(msg.payload)
        break
      case 'task:auto_fix_required':
        setPendingAutoFix(msg.payload)
        break
      case 'file:activity':
        setFileActivity(msg.payload.runId, msg.payload.path, msg.payload.active)
        break
    }
  }, [setAgents, setAgentStatus, upsertRun, appendLog, setNodeStatus, setRunStatus, completeRun, failRun, setPendingConfirm, setPendingAutoFix, setFileActivity, clearActiveFiles])

  const { send } = useWebSocket(WS_URL, getToken(), handleMessage)

  useEffect(() => {
    setSend(send)
  }, [send, setSend])

  useEffect(() => {
    const root = document.documentElement
    let hideTimer: number | null = null

    const showScrollbars = () => {
      root.classList.add('scrollbars-active')
      if (hideTimer !== null) window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => {
        root.classList.remove('scrollbars-active')
        hideTimer = null
      }, 2000)
    }

    const listenerOptions: AddEventListenerOptions = { passive: true, capture: true }
    document.addEventListener('scroll', showScrollbars, listenerOptions)
    window.addEventListener('wheel', showScrollbars, { passive: true })
    window.addEventListener('touchmove', showScrollbars, { passive: true })

    return () => {
      document.removeEventListener('scroll', showScrollbars, listenerOptions)
      window.removeEventListener('wheel', showScrollbars)
      window.removeEventListener('touchmove', showScrollbars)
      if (hideTimer !== null) window.clearTimeout(hideTimer)
      root.classList.remove('scrollbars-active')
    }
  }, [])

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()

      const selectedText = getSelectedText(event.target)
      if (!selectedText) {
        setCopyMenu(null)
        return
      }

      setCopyMenu({
        left: event.clientX,
        top: event.clientY,
        text: selectedText,
      })
    }

    document.addEventListener('contextmenu', handleContextMenu, { capture: true })

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, { capture: true })
    }
  }, [])

  useEffect(() => {
    if (!copyMenu) return

    const closeCopyMenu = () => setCopyMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCopyMenu()
    }

    document.addEventListener('click', closeCopyMenu)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('scroll', closeCopyMenu, true)

    return () => {
      document.removeEventListener('click', closeCopyMenu)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', closeCopyMenu, true)
    }
  }, [copyMenu])

  useEffect(() => {
    if (!copyToastVisible) return

    const hideTimer = window.setTimeout(() => setCopyToastVisible(false), 1800)
    return () => window.clearTimeout(hideTimer)
  }, [copyToastVisible])

  const handleCopySelection = useCallback(() => {
    if (!copyMenu) return

    void copyTextToClipboard(copyMenu.text)
      .then(() => setCopyToastVisible(true))
      .catch(() => undefined)
      .finally(() => setCopyMenu(null))
  }, [copyMenu])

  return (
    <div className="h-screen overflow-hidden bg-[rgb(247,248,253)]">
      <div className="flex h-full">
        <aside className="flex w-[60px] shrink-0 flex-col items-center bg-[rgb(247,248,253)] px-1 py-4 md:w-[60px] md:py-6">
          <nav className="flex w-full flex-col items-center gap-4 pt-1 md:gap-[18px] md:pt-2">
            {NAV_ITEMS.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className="group flex w-full flex-col items-center gap-0.5 rounded-[18px] py-0 text-center"
              >
                {({ isActive }) => (
                  <>
                    <span
                      className="flex h-[36px] w-[36px] items-center justify-center text-[rgb(25,29,38)]"
                    >
                      <Icon active={isActive} />
                    </span>
                    <span className="text-[10px] font-medium leading-none tracking-[-0.02em] text-[rgb(25,29,38)]">
                      {t(label)}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            aria-label={t('语言')}
            title={t('语言')}
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect()
              // Open upward: the button sits at the bottom of the sidebar
              setLangMenu({ left: rect.right + 6, top: Math.max(16, rect.bottom - 132) })
            }}
            className="mt-auto flex h-[36px] w-[36px] items-center justify-center rounded-[12px] text-[rgb(25,29,38)] opacity-60 transition hover:bg-white hover:opacity-100"
          >
            <LanguageIcon />
          </button>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/runner" element={<RunnerPage />} />
            <Route path="/canvas" element={<Canvas />} />
            <Route path="/history" element={<History />} />
          </Routes>
        </main>
      </div>
      <ContextMenu
        open={langMenu !== null}
        left={langMenu?.left ?? 0}
        top={langMenu?.top ?? 0}
        widthClassName="w-[140px]"
        onClose={() => setLangMenu(null)}
        items={LOCALE_OPTIONS.map(option => ({
          key: option.value,
          label: `${localeSetting === option.value ? '✓ ' : ''}${t(option.label)}`,
          onSelect: () => {
            setLocaleSetting(option.value)
            setLangMenu(null)
          },
        }))}
      />
      <ContextMenu
        open={copyMenu !== null}
        left={copyMenu?.left ?? 0}
        top={copyMenu?.top ?? 0}
        widthClassName="w-[120px]"
        onClose={() => setCopyMenu(null)}
        items={[
          {
            key: 'copy',
            label: 'Copy',
            onSelect: handleCopySelection,
          },
        ]}
      />
      {copyToastVisible ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-emerald-200 bg-white/95 px-4 py-2 text-sm font-medium text-emerald-700 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur"
        >
          {t('复制成功')}
        </div>
      ) : null}
    </div>
  )
}
