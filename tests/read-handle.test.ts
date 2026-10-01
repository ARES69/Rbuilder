import { describe, expect, it } from 'vitest'
import { readViaDirectoryHandle, type DirectoryHandle } from '../src/lib/desktop'

type FakeEntry =
  | { kind: 'file'; name: string; content: string }
  | { kind: 'directory'; name: string; children: FakeEntry[] }

/** A stand-in for a File System Access directory handle with a real values(). */
function fakeHandle(name: string, children: FakeEntry[]): DirectoryHandle & { values: () => AsyncIterable<unknown> } {
  const entries = children.map((child) => {
    if (child.kind === 'file') {
      return {
        kind: 'file',
        name: child.name,
        getFile: async () => ({ text: async () => child.content }),
      }
    }
    const nested = fakeHandle(child.name, child.children)
    return { kind: 'directory', ...nested }
  })

  return {
    name,
    getDirectoryHandle: async () => {
      throw new Error('not used by the re-read')
    },
    getFileHandle: async () => {
      throw new Error('not used by the re-read')
    },
    removeEntry: async () => {},
    async *values() {
      yield* entries
    },
  } as unknown as DirectoryHandle & { values: () => AsyncIterable<unknown> }
}

describe('readViaDirectoryHandle', () => {
  it('reads nested files with their contents', async () => {
    const folder = await readViaDirectoryHandle(
      fakeHandle('shop', [
        { kind: 'file', name: 'index.html', content: '<h1>hi</h1>' },
        {
          kind: 'directory',
          name: 'assets',
          children: [{ kind: 'file', name: 'app.js', content: 'console.log(1)' }],
        },
      ]),
    )

    expect(folder.name).toBe('shop')
    expect(folder.files).toEqual([
      { path: 'index.html', content: '<h1>hi</h1>' },
      { path: 'assets/app.js', content: 'console.log(1)' },
    ])
  })

  it('skips generated and vendored directories', async () => {
    const folder = await readViaDirectoryHandle(
      fakeHandle('shop', [
        { kind: 'file', name: 'index.html', content: '<h1>hi</h1>' },
        { kind: 'directory', name: 'node_modules', children: [{ kind: 'file', name: 'x.js', content: 'nope' }] },
        { kind: 'directory', name: '.git', children: [{ kind: 'file', name: 'HEAD', content: 'ref' }] },
      ]),
    )

    expect(folder.files.map((file) => file.path)).toEqual(['index.html'])
  })

  it('skips oversized files instead of flooding the project', async () => {
    const folder = await readViaDirectoryHandle(
      fakeHandle('shop', [
        { kind: 'file', name: 'big.txt', content: 'x'.repeat(600_001) },
        { kind: 'file', name: 'ok.txt', content: 'fine' },
      ]),
    )

    expect(folder.files.map((file) => file.path)).toEqual(['ok.txt'])
  })
})
