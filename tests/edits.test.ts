import { describe, expect, it } from 'vitest'
import { applyEdits, editSignature, parseEditBody } from '../src/lib/edits'

const block = [
  '<<<<<<< SEARCH',
  'const seconds = 60',
  '=======',
  'const seconds = 25',
  '>>>>>>> REPLACE',
].join('\n')

describe('parseEditBody', () => {
  it('reads one marked pair', () => {
    expect(parseEditBody(block)).toEqual([
      { search: 'const seconds = 60', replace: 'const seconds = 25' },
    ])
  })

  it('reads several pairs from one block', () => {
    const body = [block, block.replace('60', '30').replace('25', '15')].join('\n\n')

    expect(parseEditBody(body)).toHaveLength(2)
    expect(parseEditBody(body)[1]).toEqual({ search: 'const seconds = 30', replace: 'const seconds = 15' })
  })

  it('reads a bare pair with only the separator', () => {
    expect(parseEditBody('old line\n=======\nnew line')).toEqual([
      { search: 'old line', replace: 'new line' },
    ])
  })

  it('keeps indentation and blank lines inside the fragments', () => {
    const body = [
      '<<<<<<< SEARCH',
      'function start() {',
      '  return 1',
      '}',
      '=======',
      'function start() {',
      '  return 2',
      '}',
      '>>>>>>> REPLACE',
    ].join('\n')

    expect(parseEditBody(body)).toEqual([
      {
        search: 'function start() {\n  return 1\n}',
        replace: 'function start() {\n  return 2\n}',
      },
    ])
  })

  it('ignores a pair with no SEARCH text', () => {
    expect(parseEditBody('<<<<<<< SEARCH\n\n=======\nsomething\n>>>>>>> REPLACE')).toEqual([])
  })

  it('closes a pair whose markers were never finished', () => {
    expect(parseEditBody('<<<<<<< SEARCH\nold\n=======\nnew')).toEqual([
      { search: 'old', replace: 'new' },
    ])
  })
})

describe('applyEdits', () => {
  const app = ['const seconds = 60', '', 'render()', ''].join('\n')

  it('changes only the matched fragment', () => {
    const result = applyEdits(app, [{ search: 'const seconds = 60', replace: 'const seconds = 25' }])

    expect(result).toEqual({
      ok: true,
      content: ['const seconds = 25', '', 'render()', ''].join('\n'),
      replacements: 1,
    })
  })

  it('applies pairs in order so a later pair sees the earlier result', () => {
    const result = applyEdits(app, [
      { search: 'const seconds = 60', replace: 'const seconds = 25' },
      { search: 'const seconds = 25', replace: 'const seconds = 10' },
    ])

    expect(result.ok).toBe(true)
    expect(result.ok && result.content).toContain('const seconds = 10')
  })

  it('matches past a difference in indentation and writes the new text as sent', () => {
    const indented = ['function start() {', '    return 1', '}'].join('\n')
    const result = applyEdits(indented, [
      { search: 'function start() {\n  return 1\n}', replace: 'function start() {\n  return 2\n}' },
    ])

    expect(result.ok).toBe(true)
    // A loose match only finds the region; the replacement is the model's own text.
    expect(result.ok && result.content).toBe(['function start() {', '  return 2', '}'].join('\n'))
  })

  it('replaces every occurrence of a repeated fragment', () => {
    const doubled = 'margin: 0;\nmargin: 0;\n'
    const result = applyEdits(doubled, [{ search: 'margin: 0;', replace: 'margin: 8px;' }])

    expect(result.ok && result.content).toBe('margin: 8px;\nmargin: 8px;\n')
    expect(result.ok && result.replacements).toBe(2)
  })

  it('refuses a fragment that is not in the file and says why', () => {
    const result = applyEdits(app, [{ search: 'const minutes = 5', replace: 'const minutes = 1' }])

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain('not found')
    expect(!result.ok && result.reason).toContain('const minutes = 5')
  })

  it('refuses an empty fragment instead of touching the file', () => {
    const result = applyEdits(app, [{ search: '   ', replace: 'anything' }])

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain('empty')
  })

  it('writes nothing when a later pair in the block fails', () => {
    const result = applyEdits(app, [
      { search: 'render()', replace: 'render(true)' },
      { search: 'missing line', replace: 'x' },
    ])

    expect(result.ok).toBe(false)
  })

  it('normalises CRLF so a file written on Windows still matches', () => {
    const windows = 'const seconds = 60\r\nrender()\r\n'
    const result = applyEdits(windows, [{ search: 'const seconds = 60', replace: 'const seconds = 25' }])

    expect(result.ok && result.content).toBe('const seconds = 25\nrender()\n')
  })

  it('refuses an edit against an empty file, where nothing can match', () => {
    const result = applyEdits('', [{ search: 'placeholder', replace: 'hello' }])

    expect(result.ok).toBe(false)
  })
})

describe('editSignature', () => {
  it('is the same for the same block and different for another', () => {
    const first = { path: 'app.js', edits: [{ search: 'a', replace: 'b' }] }
    const second = { path: 'app.js', edits: [{ search: 'a', replace: 'c' }] }

    expect(editSignature(first)).toBe(editSignature({ ...first }))
    expect(editSignature(first)).not.toBe(editSignature(second))
    expect(editSignature(first)).not.toBe(editSignature({ ...first, path: 'other.js' }))
  })
})