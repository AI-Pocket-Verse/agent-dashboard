import { describe, expect, it } from 'vitest'
import { formatDateTime } from '../../src/lib/dateFormat'

describe('formatDateTime', () => {
  it('formats time with a 24-hour clock without AM or PM', () => {
    const formatted = formatDateTime(new Date(2023, 0, 1, 13, 5, 9))

    expect(formatted).toContain('13')
    expect(formatted).not.toMatch(/\b(?:AM|PM)\b/i)
  })
})
