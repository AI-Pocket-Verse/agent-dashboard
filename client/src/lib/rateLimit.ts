import { t } from './i18n'

export interface RateLimitWait {
  resetAt: number
  timeZone: string
  resetLabel: string
}

const RATE_LIMIT_MESSAGE_RE = /you['’]?ve hit your limit/i
const RESET_TIME_RE = /resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b(?:\s*\(([^)]+)\))?/i
const RATE_LIMIT_STORAGE_KEY = 'agent-dashboard:rate-limit-waits'

type StoredRateLimitWait = RateLimitWait & {
  signature: string
  savedAt: number
}

function getPartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const value = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getPartsInTimeZone(date, timeZone)
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return localAsUtc - date.getTime()
}

function zonedTimeToUtcMs(dateParts: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string) {
  const localAsUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, dateParts.hour, dateParts.minute)
  let utc = localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone)
  utc = localAsUtc - getTimeZoneOffsetMs(new Date(utc), timeZone)
  return utc
}

function parseHour(hourText: string, meridiem: string) {
  const hour = Number(hourText)
  const normalized = hour % 12
  return meridiem.toLowerCase() === 'pm' ? normalized + 12 : normalized
}

function getSignature(text: string) {
  const match = text.match(RESET_TIME_RE)
  return `${match?.[0] ?? ''}:${text.slice(-240)}`
}

function readStoredWait(key: string, signature: string): RateLimitWait | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(RATE_LIMIT_STORAGE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as Record<string, StoredRateLimitWait>
    const wait = stored[key]
    if (!wait || wait.signature !== signature || !Number.isFinite(wait.resetAt)) return null
    return {
      resetAt: wait.resetAt,
      timeZone: wait.timeZone,
      resetLabel: wait.resetLabel,
    }
  } catch {
    return null
  }
}

function writeStoredWait(key: string, signature: string, wait: RateLimitWait) {
  if (typeof window === 'undefined') return

  try {
    const raw = window.localStorage.getItem(RATE_LIMIT_STORAGE_KEY)
    const stored = raw ? JSON.parse(raw) as Record<string, StoredRateLimitWait> : {}
    stored[key] = { ...wait, signature, savedAt: Date.now() }
    window.localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Storage is an optimization for page close/reopen; parsing the log still works without it.
  }
}

export function extractRateLimitWait(text: string, now = Date.now(), defaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): RateLimitWait | null {
  if (!RATE_LIMIT_MESSAGE_RE.test(text)) return null

  const match = text.match(RESET_TIME_RE)
  if (!match) return null

  const [, hourText, minuteText = '0', meridiem, timeZoneText] = match
  const timeZone = timeZoneText?.trim() || defaultTimeZone || 'UTC'
  const resetLabel = `${hourText}:${minuteText.padStart(2, '0')}${meridiem.toLowerCase()}`
  try {
    const nowDate = new Date(now)
    const localNow = getPartsInTimeZone(nowDate, timeZone)
    const hour = parseHour(hourText, meridiem)
    const minute = Number(minuteText)

    let resetAt = zonedTimeToUtcMs({ ...localNow, hour, minute }, timeZone)
    if (resetAt <= now) {
      resetAt = zonedTimeToUtcMs({ ...localNow, day: localNow.day + 1, hour, minute }, timeZone)
    }

    return { resetAt, timeZone, resetLabel }
  } catch {
    return null
  }
}

export function getPersistedRateLimitWait(runId: string, nodeId: string, text: string, now = Date.now()): RateLimitWait | null {
  const signature = getSignature(text)
  const key = `${runId}:${nodeId}`
  const stored = readStoredWait(key, signature)
  if (stored) return stored

  const parsed = extractRateLimitWait(text, now)
  if (parsed) writeStoredWait(key, signature, parsed)
  return parsed
}

export function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  if (totalSeconds === 0) return t('可继续')

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const two = (value: number) => String(value).padStart(2, '0')

  return hours > 0
    ? `${two(hours)}:${two(minutes)}:${two(seconds)}`
    : `${two(minutes)}:${two(seconds)}`
}

export function formatResetTime(wait: RateLimitWait) {
  const parts = getPartsInTimeZone(new Date(wait.resetAt), wait.timeZone)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${two(parts.hour)}:${two(parts.minute)}`
}
