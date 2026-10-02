import { describe, expect, it } from 'vitest'
import {
  addSpend,
  costOf,
  DEFAULT_INPUT_SHARE,
  EMPTY_SPEND,
  formatCost,
  priceFor,
  splitTokens,
  type CostResult,
} from '../src/lib/pricing'

describe('priceFor', () => {
  it('prices the models the app offers by default', () => {
    expect(priceFor('gpt-4o-mini')).toEqual({ input: 0.15, output: 0.6 })
    expect(priceFor('gpt-4o')).toEqual({ input: 2.5, output: 10 })
  })

  it('prices a dated model id as its base model', () => {
    expect(priceFor('gpt-4o-2024-08-06')).toEqual({ input: 2.5, output: 10 })
  })

  it('does not read gpt-4o-mini as gpt-4o', () => {
    // The prefix lookup has to try the longest id first, or every mini model
    // would be billed at the much larger price.
    expect(priceFor('gpt-4o-mini')?.output).toBe(0.6)
    expect(priceFor('gpt-4o-mini')?.output).not.toBe(10)
  })

  it('prices provider-prefixed ids', () => {
    expect(priceFor('openai/gpt-4o-mini')).toEqual({ input: 0.15, output: 0.6 })
  })

  it('returns null rather than zero for a model it does not know', () => {
    expect(priceFor('some-new-model-2027')).toBeNull()
    expect(priceFor('')).toBeNull()
  })
})

describe('splitTokens', () => {
  it('splits a total into input and output', () => {
    expect(splitTokens(1000)).toEqual({ input: 850, output: 150 })
    expect(splitTokens(1000).input + splitTokens(1000).output).toBe(1000)
  })

  it('keeps the default assumption about input-heavy turns', () => {
    expect(DEFAULT_INPUT_SHARE).toBeGreaterThan(0.5)
  })

  it('never produces a negative count for junk input', () => {
    expect(splitTokens(-5)).toEqual({ input: 0, output: 0 })
    expect(splitTokens(Number.NaN)).toEqual({ input: 0, output: 0 })
  })
})

describe('costOf', () => {
  it('prices input and output at their own rates', () => {
    const result = costOf({ input: 1_000_000, output: 1_000_000 }, 'gpt-4o-mini')
    expect(result.kind).toBe('priced')
    if (result.kind !== 'priced') throw new Error('expected a priced result')
    // 1M in at $0.15 plus 1M out at $0.60.
    expect(result.cost).toBeCloseTo(0.75, 6)
  })

  it('is not zero for a model it cannot price', () => {
    // The whole point: an unknown model must not read as free.
    const result = costOf({ input: 10_000, output: 2_000 }, 'mystery-model')
    expect(result.kind).toBe('unpriced')
    expect(result).not.toHaveProperty('cost')
  })

  it('reports a local model as free rather than as a price', () => {
    const result = costOf({ input: 100_000, output: 10_000 }, 'qwen2.5-coder:7b', 'ollama')
    expect(result.kind).toBe('free')
    expect(result).not.toHaveProperty('cost')
  })

  it('does not call an empty turn priced', () => {
    const result = costOf({ input: 0, output: 0 }, 'gpt-4o-mini')
    expect(result.kind).toBe('unknown')
  })
})

describe('formatCost', () => {
  it('shows sub-cent amounts in cents rather than rounding them away', () => {
    // A turn that genuinely costs a fraction of a cent must not read as free.
    expect(formatCost(0.003)).toBe('$0.30¢')
    expect(formatCost(0)).toBe('$0.00')
  })

  it('uses more precision as the amount grows', () => {
    expect(formatCost(0.0423)).toBe('$0.042')
    expect(formatCost(1.5)).toBe('$1.50')
  })
})

describe('addSpend', () => {
  const priced = (cost: number): CostResult => ({
    kind: 'priced',
    cost,
    price: { input: 1, output: 2 },
    split: { input: 10, output: 2 },
  })

  it('accumulates priced turns', () => {
    let spend = addSpend(EMPTY_SPEND, priced(0.01))
    spend = addSpend(spend, priced(0.02))
    expect(spend.cost).toBeCloseTo(0.03, 6)
    expect(spend.turns).toBe(2)
    expect(spend.complete).toBe(true)
  })

  it('keeps the known total but marks it incomplete once a price is missing', () => {
    let spend = addSpend(EMPTY_SPEND, priced(0.01))
    spend = addSpend(spend, { kind: 'unpriced', split: { input: 5, output: 5 } })
    expect(spend.complete).toBe(false)
    expect(spend.cost).toBeCloseTo(0.01, 6)
    expect(spend.turns).toBe(2)
  })

  it('does not add anything for a local model', () => {
    const spend = addSpend(EMPTY_SPEND, { kind: 'free', reason: 'local', split: { input: 1, output: 1 } })
    expect(spend.cost).toBe(0)
    expect(spend.complete).toBe(true)
    expect(spend.turns).toBe(1)
  })
})