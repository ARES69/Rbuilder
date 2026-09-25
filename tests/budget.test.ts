import { describe, expect, it } from 'vitest'
import {
  budgetUsed,
  createBudget,
  DEFAULT_LIMITS,
  describeBudget,
  formatDuration,
  formatTokens,
  HARD_STEP_CAP,
  isExhausted,
  msLeft,
  noteRound,
  noteText,
  noteUsage,
  shouldWrapUp,
  tokensLeft,
  WRAP_UP_MS,
} from '../src/lib/budget'

const NOW = 1_000_000

describe('budget', () => {
  it('starts with the default limits and nothing spent', () => {
    const budget = createBudget({}, NOW)

    expect(budget.limits).toEqual(DEFAULT_LIMITS)
    expect(budget.rounds).toBe(0)
    expect(budget.tokens).toBe(0)
    expect(msLeft(budget, NOW)).toBe(DEFAULT_LIMITS.timeMs)
    expect(tokensLeft(budget)).toBe(DEFAULT_LIMITS.tokens)
  })

  it('accepts narrower limits, which is how tests and short turns run', () => {
    const budget = createBudget({ timeMs: 1000, tokens: 500 }, NOW)

    expect(budget.limits).toEqual({ timeMs: 1000, tokens: 500 })
  })

  it('counts steps and text', () => {
    let budget = createBudget({}, NOW)
    budget = noteRound(noteRound(budget))
    budget = noteText(budget, 'x'.repeat(400))

    expect(budget.rounds).toBe(2)
    expect(budget.tokens).toBe(100)
    expect(describeBudget(budget, NOW)).toContain('2 steps')
  })

  it('prefers exact usage over the estimate it replaces', () => {
    let budget = createBudget({}, NOW)
    budget = noteText(budget, 'x'.repeat(400))
    budget = noteUsage(budget, 12_345)
    // Further text is ignored: the provider's numbers are the real ones now.
    budget = noteText(budget, 'x'.repeat(4000))

    expect(budget.tokens).toBe(12_345)
    expect(budget.exactTokens).toBe(true)
    expect(describeBudget(budget, NOW)).not.toContain('≈')
  })

  it('ignores nonsense usage reports rather than corrupting the count', () => {
    const budget = noteUsage(noteText(createBudget({}, NOW), 'abcd'), Number.NaN)

    expect(budget.tokens).toBe(1)
    expect(budget.exactTokens).toBe(false)
  })

  it('runs out when either resource does', () => {
    const fresh = createBudget({ timeMs: 60_000, tokens: 1000 }, NOW)
    expect(isExhausted(fresh, NOW)).toBe(false)

    expect(isExhausted(fresh, NOW + 60_000)).toBe(true)
    expect(isExhausted(noteText(fresh, 'x'.repeat(4000)), NOW)).toBe(true)
  })

  it('does not tell a spent budget to wrap up', () => {
    const spent = createBudget({ timeMs: 60_000 }, NOW)
    expect(shouldWrapUp(spent, NOW + 60_000)).toBe(false)
  })

  it('asks to wrap up in the last seconds but not before', () => {
    const budget = createBudget({ timeMs: 120_000 }, NOW)

    expect(shouldWrapUp(budget, NOW)).toBe(false)
    expect(shouldWrapUp(budget, NOW + (120_000 - WRAP_UP_MS))).toBe(true)
  })

  it('asks to wrap up when 95% of the tokens are gone', () => {
    const budget = createBudget({ tokens: 1000 }, NOW)

    expect(shouldWrapUp(noteText(budget, 'x'.repeat(2000)), NOW)).toBe(false)
    expect(shouldWrapUp(noteText(budget, 'x'.repeat(3800)), NOW)).toBe(true)
  })

  it('reports progress as the larger of time and tokens spent', () => {
    const fresh = createBudget({ timeMs: 100_000, tokens: 1000 }, NOW)
    expect(budgetUsed(fresh, NOW)).toBe(0)

    expect(budgetUsed(fresh, NOW + 50_000)).toBeCloseTo(0.5, 5)
    expect(budgetUsed(noteText(fresh, 'x'.repeat(3600)), NOW)).toBeCloseTo(0.9, 5)
    expect(budgetUsed(fresh, NOW + 500_000)).toBe(1)
  })

  it('formats time and tokens the way the interface shows them', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(-10)).toBe('0:00')
    expect(formatTokens(900)).toBe('900')
    expect(formatTokens(9400)).toBe('9.4k')
    expect(formatTokens(38_400)).toBe('38k')
    expect(formatTokens(200_000)).toBe('200k')
  })

  it('keeps the runaway guard far above any real budget', () => {
    // The point of the change: nothing stops a turn at five steps any more, so
    // this cap must never be the reason a turn ends.
    expect(HARD_STEP_CAP).toBeGreaterThan(100)
  })
})
