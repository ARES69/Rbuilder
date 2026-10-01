import { describe, expect, it } from 'vitest'
import { relativeTime } from '../src/lib/time'

const NOW = 1_700_000_000_000

describe('relativeTime', () => {
  it('never shows zero for a fresh task', () => {
    expect(relativeTime(NOW, NOW)).toBe('1s')
  })

  it('prints minutes, hours and days', () => {
    expect(relativeTime(NOW - 2 * 60_000, NOW)).toBe('2m')
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h')
    expect(relativeTime(NOW - 5 * 86_400_000, NOW)).toBe('5d')
  })

  it('rolls over to months and years', () => {
    expect(relativeTime(NOW - 60 * 86_400_000, NOW)).toBe('2mo')
    expect(relativeTime(NOW - 400 * 86_400_000, NOW)).toBe('1y')
  })
})
