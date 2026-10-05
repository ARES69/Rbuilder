import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRbuilderServer } from '../server/server'
import {
  commitTurnCommand,
  parseCommitHead,
  parseRewindRange,
  parseRewindResult,
  rewindRangeCommand,
  rewindToCommitCommand,
} from '../src/lib/timeline'

/**
 * The turn commands, through the route the app actually uses.
 *
 * The unit tests run command strings in bash. This drives `/api/exec`, which is
 * three seams a bash test cannot see: the route's own 400-character guard, the
 * shell this machine really has, and the folder resolution that decides where
 * the command runs at all. A string that passes every unit test here can still
 * be refused by the route, or land in the scratch copy instead of the user's
 * folder — the difference between a history and a pretend one.
 */

let server: ReturnType<typeof createRbuilderServer> | null = null
let base = ''
const scratch: string[] = []

beforeAll(async () => {
  server = createRbuilderServer({ env: { ...process.env }, staticDir: undefined })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterAll(() => {
  server?.close()
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  })
}

function makeRepo(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `rb-exec-${tag}-`))
  scratch.push(dir)
  git(dir, 'init', '-q', '-b', 'main', '.')
  // The scratch folder would otherwise inherit this machine's autocrlf and a
  // re-commit of unchanged bytes would look like a real change.
  git(dir, 'config', 'core.autocrlf', 'false')
  return dir
}

/** Posts to the route and returns the status with the stream collapsed to text. */
async function execRoute(command: string, cwd: string): Promise<{ status: number; output: string }> {
  const response = await fetch(`${base}/api/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, files: [], cwd }),
  })
  if (!response.ok) {
    return { status: response.status, output: await response.text() }
  }
  let output = ''
  for (const raw of (await response.text()).split('\n')) {
    if (!raw.trim()) continue
    let event: { type: string; text?: string; message?: string }
    try {
      event = JSON.parse(raw)
    } catch {
      continue
    }
    if (event.type === 'stdout' || event.type === 'stderr') output += event.text ?? ''
    if (event.type === 'error') output += `\n${event.message ?? ''}\n`
  }
  return { status: 200, output }
}

/**
 * The command a turn would run, asserted buildable.
 *
 * A null here means the app declined to commit that turn by path, so the test
 * that asked for it is set up wrong — better to say so than to post a blank
 * command and read the route's rejection as a pass.
 */
function turnCommand(subject: string, paths: string[]): string {
  const command = commitTurnCommand(subject, paths)
  expect(command).toBeTruthy()
  return command!
}

describe('Коммит хода через /api/exec', () => {
  it('создаёт коммит в привязанной папке и отдаёт его sha', async () => {
    const folder = makeRepo('commit')
    writeFileSync(path.join(folder, 'app.js'), 'v1\n')
    git(folder, 'add', '-A')
    git(folder, 'commit', '-q', '-m', 'base')

    writeFileSync(path.join(folder, 'app.js'), 'v2\n')
    writeFileSync(path.join(folder, 'added.js'), 'новый\n')

    const result = await execRoute(
      turnCommand('RBUILDER: ход 1 · через маршрут', ['app.js', 'added.js']),
      folder,
    )
    const { after } = parseCommitHead(result.output)

    expect(result.status).toBe(200)
    expect(after).toBeTruthy()
    expect(after).toBe(git(folder, 'rev-parse', '--short', 'HEAD').trim())
    expect(git(folder, 'log', '-1', '--pretty=%s').trim()).toBe('RBUILDER: ход 1 · через маршрут')
    expect(git(folder, 'show', '--name-only', '--pretty=format:', 'HEAD').trim().split('\n').sort()).toEqual([
      'added.js',
      'app.js',
    ])
  })

  it('коммитит в папку, а не во временную копию проекта', async () => {
    // The scratch copy at .freebuff-workspace/project is rewritten on every
    // command, so a commit that landed there would be gone by the next turn.
    const folder = makeRepo('cwd')
    writeFileSync(path.join(folder, 'app.js'), 'v1\n')

    const result = await execRoute(turnCommand('RBUILDER: ход 1 · путь', ['app.js']), folder)

    expect(parseCommitHead(result.output).after).toBeTruthy()
    expect(git(folder, 'log', '--oneline')).toContain('RBUILDER: ход 1 · путь')
  })
})

describe('Откат через /api/exec', () => {
  it('возвращает ветку и файлы к коммиту хода', async () => {
    const folder = makeRepo('rewind')
    writeFileSync(path.join(folder, 'app.js'), 'v1\n')
    git(folder, 'add', '-A')
    git(folder, 'commit', '-q', '-m', 'base')
    const first = git(folder, 'rev-parse', '--short', 'HEAD').trim()

    writeFileSync(path.join(folder, 'app.js'), 'v2\n')
    writeFileSync(path.join(folder, 'added.js'), 'появился\n')
    const commit = await execRoute(
      turnCommand('RBUILDER: ход 2 · второй', ['app.js', 'added.js']),
      folder,
    )
    expect(parseCommitHead(commit.output).after).toBeTruthy()

    expect(parseRewindRange((await execRoute(rewindRangeCommand(first), folder)).output).foreign).toEqual([])

    const reset = await execRoute(rewindToCommitCommand(first), folder)
    expect(parseRewindResult(reset.output)).toEqual({ moved: true, head: first })
    expect(readFileSync(path.join(folder, 'app.js'), 'utf8').trim()).toBe('v1')
    expect(existsSync(path.join(folder, 'added.js'))).toBe(false)
  })

  it('не забирает незакоммиченные правки пользователя', async () => {
    const folder = makeRepo('dirty')
    writeFileSync(path.join(folder, 'app.js'), 'v1\n')
    git(folder, 'add', '-A')
    git(folder, 'commit', '-q', '-m', 'base')
    const first = git(folder, 'rev-parse', '--short', 'HEAD').trim()
    writeFileSync(path.join(folder, 'app.js'), 'v2\n')
    await execRoute(turnCommand('RBUILDER: ход 2 · второй', ['app.js']), folder)

    writeFileSync(path.join(folder, 'app.js'), 'правка пользователя\n')
    const reset = await execRoute(rewindToCommitCommand(first), folder)

    expect(parseRewindResult(reset.output).moved).toBe(false)
    expect(readFileSync(path.join(folder, 'app.js'), 'utf8').trim()).toBe('правка пользователя')
  })
})

describe('Границы маршрута', () => {
  it('команда хода помещается в лимит длины', async () => {
    const folder = makeRepo('budget')
    writeFileSync(path.join(folder, 'app.js'), 'v1\n')
    // The worst case the app can build: a turn that rewrote every file.
    const paths = Array.from({ length: 40 }, (_, i) => `src/components/Widget${i}.tsx`)
    const command = turnCommand('RBUILDER: ход 1 · длинный список', paths)

    const result = await execRoute(command, folder)

    expect(result.status).toBe(200)
    expect(parseCommitHead(result.output).after).toBeTruthy()
  })

  it('действительно отклоняет слишком длинную команду', async () => {
    // Guards the guard: if the route's limit grew, the budget above would stop
    // meaning anything and the fallback would never be exercised.
    const folder = makeRepo('limit')
    const over = await execRoute(`echo ${'x'.repeat(500)}`, folder)
    expect(over.status).toBe(400)
  })
})