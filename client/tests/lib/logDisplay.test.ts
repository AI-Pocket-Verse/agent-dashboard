import { describe, expect, it } from 'vitest'
import { getRecentCompactLogs } from '../../src/lib/logDisplay'

describe('log display helpers', () => {
  it('compacts only the recent bounded log window before rendering restored snapshots', () => {
    const logs = [
      ...Array.from({ length: 1000 }, (_, index) => `old log ${index}`),
      'recent one',
      'recent two',
      'recent one',
      'recent two',
      'recent three',
    ]

    expect(getRecentCompactLogs(logs, 3)).toEqual([
      'recent one',
      'recent two',
      'recent three',
    ])
  })
})
