import { describe, expect, it } from 'vitest'
import { lineDiff, totalDiff } from '../src/lib/diff'

describe('lineDiff', () => {
  it('counts added and removed lines', () => {
    const result = lineDiff('a\nb\nc', 'a\nc\nd')
    expect(result.added).toBe(1)
    expect(result.removed).toBe(1)
  })

  it('treats a created file as all additions', () => {
    expect(lineDiff(null, 'one\ntwo')).toEqual({ added: 2, removed: 0 })
  })

  it('ignores blank lines so formatting churn does not inflate the numbers', () => {
    expect(lineDiff('a', 'a\n\n')).toEqual({ added: 0, removed: 0 })
  })

  it('reports an unchanged file as zero', () => {
    expect(lineDiff('same\ntext', 'same\ntext')).toEqual({ added: 0, removed: 0 })
  })
})

describe('totalDiff', () => {
  it('sums per-file diffs', () => {
    expect(totalDiff([{ added: 2, removed: 1 }, { added: 3, removed: 4 }])).toEqual({ added: 5, removed: 5 })
  })
})
