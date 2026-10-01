import { describe, expect, it } from 'vitest'
import { diffLines, lineDiff, totalDiff } from '../src/lib/diff'

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

describe('diffLines', () => {
  it('marks a replaced middle as one removal and one insertion', () => {
    const result = diffLines('header\nold\nfooter', 'header\nnew\nfooter')
    expect(result).toEqual([
      { kind: 'same', text: 'header' },
      { kind: 'del', text: 'old' },
      { kind: 'add', text: 'new' },
      { kind: 'same', text: 'footer' },
    ])
  })

  it('renders a created file as all additions', () => {
    expect(diffLines(null, 'a\nb')).toEqual([
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'b' },
    ])
  })

  it('keeps an unchanged file empty of edits', () => {
    expect(diffLines('same', 'same').every((line) => line.kind === 'same')).toBe(true)
  })

  it('pairs interleaved edits in document order', () => {
    const result = diffLines('a\nb\nc', 'a\nX\nb\nY\nc')
    const kinds = result.map((line) => line.kind)
    expect(kinds).toEqual(['same', 'add', 'same', 'add', 'same'])
    expect(result.filter((line) => line.kind === 'add').map((line) => line.text)).toEqual(['X', 'Y'])
  })

  it('falls back to a plain replacement block when the churn is huge', () => {
    const big = Array.from({ length: 900 }, (_, index) => `old ${index}`).join('\n')
    const fresh = Array.from({ length: 900 }, (_, index) => `new ${index}`).join('\n')
    const result = diffLines(big, fresh)
    expect(result.filter((line) => line.kind === 'del')).toHaveLength(900)
    expect(result.filter((line) => line.kind === 'add')).toHaveLength(900)
    expect(result.every((line) => line.kind !== 'same')).toBe(true)
  })
})
