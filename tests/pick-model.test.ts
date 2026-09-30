import { describe, expect, it } from 'vitest'
import { pickModel } from '../src/lib/agent'

/**
 * After the provider answers with its real model list, the field either keeps
 * the user's id or adopts the first real one. Placeholder ids like LM Studio's
 * `local-model` must never survive a successful refresh.
 */
describe('pickModel', () => {
  it('keeps the current id when the provider knows it', () => {
    expect(pickModel('qwen2.5-coder-3b', ['qwen2.5-coder-3b', 'prism-ml/bonsai-27b'])).toBeNull()
  })

  it('adopts the first real id when the current one is a placeholder', () => {
    expect(pickModel('local-model', ['qwen2.5-coder-3b-uncensored', 'prism-ml/bonsai-27b'])).toBe(
      'qwen2.5-coder-3b-uncensored',
    )
  })

  it('keeps the typed id when the provider reports no models', () => {
    expect(pickModel('my-fine-tune', [])).toBeNull()
  })

  it('prefers the real list over the id the user typed by hand', () => {
    expect(pickModel('gpt-4o-mini', ['a', 'b', 'c'])).toBe('a')
  })
})
