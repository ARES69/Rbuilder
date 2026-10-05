import { describe, expect, it } from 'vitest'
import { relativeTime, relativeTimeRu } from '../src/lib/time'

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

describe('relativeTimeRu', () => {
  it('never shows zero for a fresh task', () => {
    expect(relativeTimeRu(NOW, NOW)).toBe('1 с')
  })

  it('says minutes, hours and days in Russian', () => {
    expect(relativeTimeRu(NOW - 2 * 60_000, NOW)).toBe('2 мин')
    expect(relativeTimeRu(NOW - 3 * 3_600_000, NOW)).toBe('3 ч')
    expect(relativeTimeRu(NOW - 5 * 86_400_000, NOW)).toBe('5 д')
  })

  it('rolls over to months and years', () => {
    expect(relativeTimeRu(NOW - 60 * 86_400_000, NOW)).toBe('2 мес')
    expect(relativeTimeRu(NOW - 400 * 86_400_000, NOW)).toBe('1 г')
  })

  it('stays short enough to sit next to the task name', () => {
    const ages = [NOW, NOW - 2 * 60_000, NOW - 5 * 86_400_000, NOW - 400 * 86_400_000].map((at) => relativeTimeRu(at, NOW))
    for (const age of ages) expect(age.length).toBeLessThanOrEqual(6)
  })
})
