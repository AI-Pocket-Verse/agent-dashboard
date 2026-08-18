import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractRateLimitWait, formatCountdown, getPersistedRateLimitWait } from '../../src/lib/rateLimit'

describe('rate limit helpers', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.useRealTimers()
  })

  it('extracts an absolute reset time from a limit message with a timezone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-28T04:00:00.000Z'))

    const wait = extractRateLimitWait("You've hit your limit · resets 2:10am (America/New_York)")

    expect(wait).toEqual({
      resetAt: new Date('2026-04-28T06:10:00.000Z').getTime(),
      timeZone: 'America/New_York',
      resetLabel: '2:10am',
    })

  })

  it('formats the remaining countdown and reports when continuing is available', () => {
    expect(formatCountdown(65_000)).toBe('01:05')
    expect(formatCountdown(3_661_000)).toBe('01:01:01')
    expect(formatCountdown(0)).toBe('可继续')
  })

  it('keeps the original reset time from storage after reopening past the reset label', () => {
    vi.useFakeTimers()
    const message = "You've hit your limit · resets 1:10am (America/New_York)"
    vi.setSystemTime(new Date('2026-04-28T05:09:00.000Z'))

    const firstWait = getPersistedRateLimitWait('run-1', 'node-1', message)

    vi.setSystemTime(new Date('2026-04-28T05:11:00.000Z'))
    const reopenedWait = getPersistedRateLimitWait('run-1', 'node-1', message)

    expect(reopenedWait?.resetAt).toBe(firstWait?.resetAt)
    expect(reopenedWait?.resetAt).toBe(new Date('2026-04-28T05:10:00.000Z').getTime())
  })
})
