import { execFileSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRbuilderServer } from '../server/server'
import { connectRemote, syncProject } from '../src/lib/sync'

/**
 * Sync, run for real.
 *
 * The command strings are the whole design here, and a command string can look
 * perfect and still not work: the rebase needs an identity the machine may not
 * have, `git remote add` needs a repository that may not exist yet, and a
 * failure prints the reason on one line and the advice on the next twenty. All
 * three of those were wrong before this test ran it against real repositories.
 *
 * So this drives the actual server, in real folders, against a real bare
 * repository — the thing GitHub is on the other end of.
 */

let server: ReturnType<typeof createRbuilderServer> | null = null
/** Every folder this run made, so the temp directory is left as it was found. */
const scratch: string[] = []

beforeAll(async () => {
  server = createRbuilderServer({ env: { ...process.env }, staticDir: undefined })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  // The one seam between the browser and the desktop shell: where the API is.
  ;(globalThis as Record<string, unknown>).window = {
    __RBUILDER_API_BASE__: `http://127.0.0.1:${port}`,
    dispatchEvent: () => true,
  }
})

afterAll(() => {
  server?.close()
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  })
}

function makeDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `rb-sync-${tag}-`))
  scratch.push(dir)
  return dir
}

describe('Sync against real repositories', () => {
  let remote = ''
  let folder = ''

  beforeAll(() => {
    remote = makeDir('remote')
    folder = makeDir('project')
    git(remote, 'init', '--bare', '-b', 'main', '.')
  })

  it('connects the folder and publishes the project', async () => {
    writeFileSync(path.join(folder, 'index.html'), '<h1>one</h1>')
    const files = [{ path: 'index.html', content: '<h1>one</h1>' }]

    const connected = await connectRemote(files, folder, remote)
    expect(connected.ok).toBe(true)
    // Connecting is the first thing a new project does, so it is also where the
    // repository has to appear — `git remote add` fails outside one.
    expect(existsSync(path.join(folder, '.git'))).toBe(true)

    const first = await syncProject({ files, folder, token: null })
    expect(first.steps.map((s) => [s.label, s.ok, s.detail])).toEqual([
      ['Коммит', true, 'изменения зафиксированы'],
      ['Получение', true, 'origin доступен, ветка main'],
      ['Слияние', true, 'ветки на GitHub ещё нет — нечего забирать'],
      ['Отправка', true, 'main опубликован в origin'],
    ])
    expect(existsSync(path.join(folder, '.gitignore'))).toBe(true)
    expect(git(remote, 'show', 'main:index.html')).toContain('one')
  })

  it('says nothing to commit on a second run with no changes', async () => {
    const files = [{ path: 'index.html', content: '<h1>one</h1>' }]
    const report = await syncProject({ files, folder, token: null })
    const commit = report.steps.find((step) => step.label === 'Коммит')
    expect(commit?.detail).toBe('изменений не было')
    expect(report.ok).toBe(true)
  })

  it('pulls what the remote has and publishes what is new', async () => {
    // Somebody else pushes to the same branch.
    const other = makeDir('other')
    git(other, 'clone', remote, '.')
    git(other, 'config', 'user.name', 'other')
    git(other, 'config', 'user.email', 'o@o')
    writeFileSync(path.join(other, 'index.html'), '<h1>two</h1>')
    writeFileSync(path.join(other, 'theirs.txt'), 'theirs')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'theirs')
    git(other, 'push', '-q', 'origin', 'main')

    const files = [
      { path: 'index.html', content: '<h1>one</h1>' },
      { path: 'mine.txt', content: 'mine' },
    ]
    writeFileSync(path.join(folder, 'mine.txt'), 'mine')
    const report = await syncProject({ files, folder, token: null })
    expect(report.ok).toBe(true)
    expect(git(remote, 'show', 'main:theirs.txt')).toContain('theirs')
    expect(git(remote, 'show', 'main:mine.txt')).toContain('mine')
  })

  it('reports the conflict instead of resolving it behind the user\u2019s back', async () => {
    const other = makeDir('other2')
    git(other, 'clone', remote, '.')
    git(other, 'config', 'user.name', 'other')
    git(other, 'config', 'user.email', 'o@o')
    writeFileSync(path.join(other, 'index.html'), '<h1>theirs changed the same line</h1>')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'theirs again')
    git(other, 'push', '-q', 'origin', 'main')

    // The same line is changed here, so the rebase cannot be automatic.
    const conflict = '<h1>mine changed the same line</h1>'
    writeFileSync(path.join(folder, 'index.html'), conflict)
    const report = await syncProject({
      files: [
        { path: 'index.html', content: conflict },
        { path: 'mine.txt', content: 'mine' },
        { path: 'theirs.txt', content: 'theirs' },
      ],
      folder,
      token: null,
    })
    expect(report.ok).toBe(false)
    expect(report.conflicts).toContain('index.html')
    expect(readFileSync(path.join(folder, 'index.html'), 'utf8')).toContain('<<<<<<<')
  })

  it('refuses to publish anything when no remote is configured', async () => {
    const loose = makeDir('loose')
    writeFileSync(path.join(loose, 'a.txt'), 'a')
    const report = await syncProject({
      files: [{ path: 'a.txt', content: 'a' }],
      folder: loose,
      token: null,
    })
    expect(report.ok).toBe(false)
    expect(report.summary).toContain('не подключён')
  })
})