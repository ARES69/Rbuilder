import { describe, expect, it } from 'vitest'
import { collapseRepeats } from '../src/lib/transcript'
import type { ChatMessage } from '../src/lib/store'

function message(overrides: Partial<ChatMessage> & { id: string; content: string }): ChatMessage {
  return {
    role: 'assistant',
    status: 'done',
    createdAt: 0,
    ...overrides,
  }
}

const BLOCKED = 'No model is configured yet, so I cannot write the app.'

describe('collapseRepeats', () => {
  it('leaves a transcript of different messages alone', () => {
    const messages = [
      message({ id: '1', role: 'user', content: 'сделай таймер' }),
      message({ id: '2', content: 'Сделаю.' }),
      message({ id: '3', role: 'user', content: 'а ещё кнопку' }),
    ]
    expect(collapseRepeats(messages).map((row) => row.repeats)).toEqual([1, 1, 1])
  })

  it('collapses identical messages that follow each other', () => {
    const messages = [
      message({ id: '1', role: 'user', content: 'почини' }),
      message({ id: '2', content: BLOCKED }),
      message({ id: '3', content: BLOCKED }),
      message({ id: '4', content: BLOCKED }),
    ]
    const rows = collapseRepeats(messages)
    expect(rows).toHaveLength(2)
    expect(rows[1].message.id).toBe('2')
    expect(rows[1].repeats).toBe(3)
  })

  it('keeps the same words apart when a user message sits between them', () => {
    const messages = [
      message({ id: '1', content: BLOCKED }),
      message({ id: '2', role: 'user', content: 'ещё раз' }),
      message({ id: '3', content: BLOCKED }),
    ]
    expect(collapseRepeats(messages).map((row) => row.repeats)).toEqual([1, 1, 1])
  })

  it('never collapses a turn that did something', () => {
    const messages = [
      message({ id: '1', content: BLOCKED, files: ['index.html'] }),
      message({ id: '2', content: BLOCKED, files: ['index.html'] }),
      message({ id: '3', content: BLOCKED, tools: [{ id: 't', name: 'run_checks', label: 'checks', status: 'done' }] }),
      message({ id: '4', content: BLOCKED }),
    ]
    expect(collapseRepeats(messages).map((row) => row.repeats)).toEqual([1, 1, 1, 1])
  })

  it('ignores whitespace differences between copies', () => {
    const messages = [
      message({ id: '1', content: BLOCKED }),
      message({ id: '2', content: `${BLOCKED}\n` }),
    ]
    expect(collapseRepeats(messages)[0].repeats).toBe(2)
  })

  it('leaves a streaming message on its own, however it reads', () => {
    const messages = [
      message({ id: '1', content: BLOCKED, status: 'streaming' }),
      message({ id: '2', content: BLOCKED, status: 'streaming' }),
    ]
    expect(collapseRepeats(messages).map((row) => row.repeats)).toEqual([1, 1])
  })
})