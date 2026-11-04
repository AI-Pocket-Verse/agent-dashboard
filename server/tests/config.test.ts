import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => { process.env.PROJECT_ROOT ??= '/tmp' })

import { readDurationMs } from '../src/config.js'

const MAX_TIMER_MS = 2 ** 31 - 1

describe('readDurationMs', () => {
  it('falls back to the default for missing, blank, negative or non-numeric values', () => {
    for (const raw of [undefined, '', '  ', '-1', 'abc']) {
      expect(readDurationMs(raw, { unitMs: 1, fallbackMs: 5000, allowZero: true })).toBe(5000)
    }
  })

  it('treats 0 as "no limit" only where allowed', () => {
    expect(readDurationMs('0', { unitMs: 60_000, fallbackMs: 1800_000, allowZero: true })).toBe(0)
    expect(readDurationMs('0', { unitMs: 1, fallbackMs: 180_000, allowZero: false })).toBe(180_000)
  })

  it('caps values that would overflow setTimeout', () => {
    expect(readDurationMs('100000', { unitMs: 60_000, fallbackMs: 1, allowZero: true })).toBe(MAX_TIMER_MS)
    expect(readDurationMs('99999999999', { unitMs: 1, fallbackMs: 1, allowZero: false })).toBe(MAX_TIMER_MS)
  })

  it('converts units', () => {
    expect(readDurationMs('0.5', { unitMs: 60_000, fallbackMs: 1, allowZero: true })).toBe(30_000)
  })
})
