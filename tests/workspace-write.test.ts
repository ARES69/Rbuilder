import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeProjectInto } from '../server/workspace'

/**
 * These run against a real directory: both bugs were about what happens to
 * bytes and timestamps on disk, and a fake filesystem would not have caught
 * either one.
 */
let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rbuilder-write-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeProjectInto', () => {
  it('writes files that do not exist yet', async () => {
    await writeProjectInto(dir, [{ path: 'index.html', content: '<h1>hi</h1>' }])
    expect(await readFile(path.join(dir, 'index.html'), 'utf8')).toBe('<h1>hi</h1>')
  })

  it('creates a missing file even when others already exist', async () => {
    await writeProjectInto(dir, [{ path: 'kept.ts', content: 'kept' }])
    await writeProjectInto(dir, [{ path: 'new.ts', content: 'brand new' }])
    expect(await readFile(path.join(dir, 'new.ts'), 'utf8')).toBe('brand new')
    expect(await readFile(path.join(dir, 'kept.ts'), 'utf8')).toBe('kept')
  })

  it('leaves the mtime alone when the content is unchanged', async () => {
    await writeProjectInto(dir, [{ path: 'a.ts', content: 'same' }])
    const first = (await stat(path.join(dir, 'a.ts'))).mtimeMs

    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeProjectInto(dir, [{ path: 'a.ts', content: 'same' }])

    // A blind rewrite touched every file on every command, which kept the
    // folder watcher awake through the app's own traffic.
    expect((await stat(path.join(dir, 'a.ts'))).mtimeMs).toBe(first)
  })

  it('does not overwrite a file that exists and differs', async () => {
    // The client re-sends its whole project on every command, so this is the
    // normal shape of a request after the user edited a file in their editor.
    // Losing that edit is the bug this rule exists for.
    await writeFile(path.join(dir, 'a.ts'), 'edited by hand', 'utf8')

    await writeProjectInto(dir, [{ path: 'a.ts', content: 'stale in-memory copy' }])

    expect(await readFile(path.join(dir, 'a.ts'), 'utf8')).toBe('edited by hand')
  })

  it('keeps a file checked out from git that the app has not synced', async () => {
    await mkdir(path.join(dir, 'src'), { recursive: true })
    await writeFile(path.join(dir, 'src', 'old.ts'), 'from the repository', 'utf8')

    await writeProjectInto(dir, [{ path: 'src/old.ts', content: 'stale in-memory copy' }])

    expect(await readFile(path.join(dir, 'src', 'old.ts'), 'utf8')).toBe('from the repository')
  })

  it('overwrites once the caller confirms it re-read the folder', async () => {
    await writeFile(path.join(dir, 'a.ts'), 'external', 'utf8')

    await writeProjectInto(dir, [{ path: 'a.ts', content: 'v2-synced' }])
    expect(await readFile(path.join(dir, 'a.ts'), 'utf8')).toBe('external')

    await writeProjectInto(dir, [{ path: 'a.ts', content: 'v2-synced' }], { acceptExternal: true })
    expect(await readFile(path.join(dir, 'a.ts'), 'utf8')).toBe('v2-synced')
  })

  it('creates directories for nested paths', async () => {
    await writeProjectInto(dir, [{ path: 'src/lib/app.ts', content: 'export {}' }])
    expect(await readFile(path.join(dir, 'src', 'lib', 'app.ts'), 'utf8')).toBe('export {}')
  })

  it('refuses a path that escapes the folder', async () => {
    await writeProjectInto(dir, [{ path: '../escape.txt', content: 'nope' }])
    await expect(readFile(path.join(dir, '..', 'escape.txt'), 'utf8')).rejects.toThrow()
  })
})