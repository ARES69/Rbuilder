import { describe, expect, it } from 'vitest'
import { planExternalSync } from '../src/lib/folderWatch'

const current = [
  { path: 'index.html', content: '<h1>one</h1>' },
  { path: 'src/app.ts', content: 'export const a = 1' },
]

describe('planExternalSync', () => {
  it('does nothing when the folder read matches what the app holds', () => {
    const plan = planExternalSync({
      current,
      incoming: [
        { path: 'index.html', content: '<h1>one</h1>' },
        { path: 'src/app.ts', content: 'export const a = 1' },
      ],
      folder: 'C:/work/site',
      busy: false,
    })
    expect(plan).toEqual({ kind: 'noop' })
  })

  it('waits while a turn is in flight so in-memory writes survive', () => {
    const plan = planExternalSync({
      current,
      incoming: [{ path: 'index.html', content: 'different' }],
      folder: 'C:/work/site',
      busy: true,
    })
    expect(plan).toEqual({ kind: 'skip', reason: 'busy' })
  })

  it('skips an unbound task instead of clearing the project', () => {
    const plan = planExternalSync({ current, incoming: [], folder: null, busy: false })
    expect(plan).toEqual({ kind: 'skip', reason: 'no-folder' })
  })

  it('treats an empty read as unreadable, not as "the user deleted everything"', () => {
    const plan = planExternalSync({
      current,
      incoming: [],
      folder: 'C:/work/site',
      busy: false,
    })
    expect(plan).toEqual({ kind: 'skip', reason: 'empty' })
  })

  it('ignores generated paths that the folder read should never carry', () => {
    const plan = planExternalSync({
      current,
      incoming: [
        ...current.map((file) => ({ ...file })),
        { path: 'node_modules/react/index.js', content: 'module.exports = {}' },
        { path: '.git/HEAD', content: 'ref: refs/heads/main' },
      ],
      folder: 'C:/work/site',
      busy: false,
    })
    expect(plan).toEqual({ kind: 'noop' })
  })

  it('applies an edit made outside the app and a new file at once', () => {
    const plan = planExternalSync({
      current,
      incoming: [
        { path: 'index.html', content: '<h1>two</h1>' },
        { path: 'src/app.ts', content: 'export const a = 1' },
        { path: 'src/new.ts', content: 'export const b = 2' },
      ],
      folder: 'C:/work/site',
      busy: false,
    })
    expect(plan).toEqual({
      kind: 'apply',
      changed: [
        { path: 'index.html', content: '<h1>two</h1>' },
        { path: 'src/new.ts', content: 'export const b = 2' },
      ],
      removed: [],
    })
  })

  it('removes files that disappeared from disk', () => {
    const plan = planExternalSync({
      current,
      incoming: [{ path: 'index.html', content: '<h1>one</h1>' }],
      folder: 'C:/work/site',
      busy: false,
    })
    expect(plan).toEqual({ kind: 'apply', changed: [], removed: ['src/app.ts'] })
  })
})