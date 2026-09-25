import { describe, expect, it } from 'vitest'
import { systemPromptFor, tokenTotal } from '../server/api'
import { WRAP_UP_PROMPT } from '../src/lib/budget'

describe('token usage from a provider', () => {
  it('prefers the provider total', () => {
    expect(tokenTotal({ total_tokens: 1234, prompt_tokens: 1000, completion_tokens: 200 })).toBe(1234)
  })

  it('adds up the parts when there is no total', () => {
    expect(tokenTotal({ prompt_tokens: 1000, completion_tokens: 234 })).toBe(1234)
  })

  it('reports nothing when the provider says nothing', () => {
    expect(tokenTotal(undefined)).toBeUndefined()
    expect(tokenTotal({})).toBeUndefined()
    expect(tokenTotal({ total_tokens: 0 })).toBeUndefined()
    expect(tokenTotal({ total_tokens: Number.NaN })).toBeUndefined()
  })
})

describe('system prompt', () => {
  const budget = { msLeft: 240_000, tokensLeft: 150_000, round: 3 }

  it('offers tools only while building', () => {
    const build = systemPromptFor('build', { tools: true, wrapUp: false })
    const plan = systemPromptFor('plan', { tools: true, wrapUp: false })

    expect(build).toContain('inspect_preview')
    expect(plan).toContain('PLAN MODE')
    expect(plan).not.toContain('inspect_preview')
  })

  it('tells the model what is left of its budget', () => {
    const prompt = systemPromptFor('build', { tools: true, wrapUp: false, budget })

    expect(prompt).toContain('about 4 minutes')
    expect(prompt).toContain('150k tokens')
    expect(prompt).toContain('step 4')
    // The whole point of the change: nothing here caps the number of tool calls.
    expect(prompt).not.toMatch(/at most \d+ (tool|round)/i)
  })

  it('asks for a landing only on the final step', () => {
    const normal = systemPromptFor('build', { tools: true, wrapUp: false, budget })
    const last = systemPromptFor('build', { tools: false, wrapUp: true, budget })

    expect(normal).not.toContain(WRAP_UP_PROMPT)
    expect(last).toContain(WRAP_UP_PROMPT)
  })

  it('works for providers called without a budget', () => {
    const prompt = systemPromptFor('build', { tools: true, wrapUp: false })

    expect(prompt).toContain('inspect_preview')
    expect(prompt).not.toContain('of tool time')
  })
})
