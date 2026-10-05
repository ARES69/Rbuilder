import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  AGENT_SUBJECT,
  COMMIT_BUDGET,
  commitTurnCommand,
  isAgentSubject,
  parseCommitHead,
  parseRewindRange,
  parseRewindResult,
  rewindRangeCommand,
  rewindTargetCommit,
  rewindToCommitCommand,
  turnCommitSubject,
} from '../src/lib/timeline'
import type { ChatMessage } from '../src/lib/store'

/** The scratch folders this run made, so the temp directory is left as found. */
const scratch: string[] = []

afterAll(() => {
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

/** Runs a command string the way the app's exec route does: bash, cwd bound. */
function shell(cwd: string, command: string): string {
  return execFileSync('bash', ['-c', command], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function repo(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `rb-timeline-${tag}-`))
  scratch.push(dir)
  git(dir, 'init', '-q', '-b', 'main', '.')
  // Without this the scratch repos inherit the machine's autocrlf: a file
  // written with LF comes back as CRLF after a checkout, and re-committing
  // unchanged bytes looks like a change — which is what these tests are about.
  git(dir, 'config', 'core.autocrlf', 'false')
  return dir
}

function turn(id: string, commit?: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: 'сделал',
    files: ['app.js'],
    snapshots: [{ path: 'app.js', before: null }],
    commit,
    status: 'done',
    createdAt: 1,
  }
}

function user(id: string): ChatMessage {
  return { id, role: 'user', content: 'давай', status: 'done', createdAt: 1 }
}

describe('Тема коммита хода', () => {
  it('называет ход и берёт первую строку запроса', () => {
    const subject = turnCommitSubject('сделай тёмную тему\nи переведи на русский', '', 3)
    expect(subject).toBe(`${AGENT_SUBJECT}: ход 3 · сделай тёмную тему`)
  })

  it('схлопывает переводы строк — тема коммита однострочная', () => {
    expect(turnCommitSubject('  много   пробелов  ', '', 1)).toBe(
      `${AGENT_SUBJECT}: ход 1 · много пробелов`,
    )
  })

  it('берёт ответ агента, когда запроса не было', () => {
    expect(turnCommitSubject('', 'переписал компонент\nпояснил', 2)).toBe(
      `${AGENT_SUBJECT}: ход 2 · переписал компонент`,
    )
  })

  it('остаётся в пределах темы, даже если запрос огромный', () => {
    const subject = turnCommitSubject('я'.repeat(400), '', 12)
    expect(subject.length).toBeLessThanOrEqual(60)
    expect(subject.startsWith(`${AGENT_SUBJECT}: ход 12 ·`)).toBe(true)
  })

  it('не выбрасывает кавычки, которые сломали бы shell', () => {
    const subject = turnCommitSubject('почини `кнопку` и "тест"', '', 4)
    expect(subject).not.toMatch(/["'`]/)
  })

  it('узнаёт свои коммиты и чужие', () => {
    expect(isAgentSubject(`${AGENT_SUBJECT}: ход 1 · тест`)).toBe(true)
    expect(isAgentSubject('починил кнопку')).toBe(false)
  })
})

describe('Команда коммита', () => {
  it('берёт с собой и правку, и новый файл, и удаление', () => {
    const command = commitTurnCommand(`${AGENT_SUBJECT}: ход 1 · тест`, [
      'app.js',
      'new.js',
      'gone.js',
    ])
    expect(command).toContain("git add -A -- 'app.js' 'new.js' 'gone.js'")
    expect(command).toContain("commit -q -m")
    expect(command).toContain("RB_COMMITTED")
    expect(command!.length).toBeLessThanOrEqual(400)
  })

  it('не коммитит без путей — пустой pathspec собрал бы всё дерево', () => {
    expect(commitTurnCommand('тест', [])).toBeNull()
  })

  it('отказывается, если путь нельзя безопасно процитировать', () => {
    // A path with a quote would either break the shell or be silently rewritten,
    // and a commit that omits a file the turn wrote is a history that lies.
    expect(commitTurnCommand('тест', ["my'notes.md"])).toBeNull()
  })

  it('укладывается в лимит exec-маршрута, а длинный список снимается целиком', () => {
    const paths = Array.from({ length: 40 }, (_, i) => `src/components/Widget${i}.tsx`)
    const command = commitTurnCommand(`${AGENT_SUBJECT}: ход 1 · тест`, paths)
    expect(command).not.toBeNull()
    expect(command!.length).toBeLessThanOrEqual(400)
    // Too long to name every path twice, so it commits the tree instead —
    // the turn stays on the timeline rather than dropping off it.
    if (command!.length > COMMIT_BUDGET) expect(command).toContain('git add -A;')
  })
})

describe('Цель отката', () => {
  it('берёт коммит последнего хода выше точки отката', () => {
    const messages = [
      user('u1'),
      turn('a1', 'aaaaaaa'),
      user('u2'),
      turn('a2', 'bbbbbbb'),
      user('u3'),
      turn('a3', 'ccccccc'),
    ]

    // The target is the turn *above* the rewind point: landing on u3 leaves
    // a2's work in place, and landing on a3 drops a3 too.
    expect(rewindTargetCommit(messages, 4)).toBe('bbbbbbb')
    expect(rewindTargetCommit(messages, 5)).toBe('bbbbbbb')
    // Landing on a2 itself means the state before a2 — a1's commit.
    expect(rewindTargetCommit(messages, 3)).toBe('aaaaaaa')
  })

  it('не выдумывает цель там, где коммитов ещё не было', () => {
    expect(rewindTargetCommit([user('u1'), turn('a1')], 1)).toBeNull()
    expect(rewindTargetCommit([user('u1'), turn('a1', 'aaaaaaa')], 0)).toBeNull()
  })

  it('пропускает ходы без коммита — они не точка отката', () => {
    const messages = [user('u1'), turn('a1', 'aaaaaaa'), turn('a2'), turn('a3', 'ccccccc')]
    expect(rewindTargetCommit(messages, 3)).toBe('aaaaaaa')
  })
})

describe('Разбор вывода git', () => {
  it('читает sha, когда коммит прошёл', () => {
    expect(parseCommitHead('RB_COMMITTED\na1b2c3d\n')).toEqual({ after: 'a1b2c3d' })
  })

  it('не выдаёт sha, когда коммитить было нечего', () => {
    const output = 'On branch main\nnothing to commit, working tree clean\nRB_NOTHING\n'
    expect(parseCommitHead(output)).toEqual({ after: null })
  })

  it('не верит строке, которая не похожа на хеш', () => {
    expect(parseCommitHead('RB_COMMITTED\nnothing here\n')).toEqual({ after: null })
  })

  it('находит чужие коммиты в диапазоне отката', () => {
    const output = ['RB_RANGE', `${AGENT_SUBJECT}: ход 4 · тест`, 'моя правка руками', 'RB_RANGE_END'].join('\n')
    expect(parseRewindRange(output)).toEqual({ foreign: ['моя правка руками'] })
  })

  it('пустой список, когда между целью и HEAD ничего нет', () => {
    expect(parseRewindRange(`RB_RANGE\nRB_RANGE_END\n`)).toEqual({ foreign: [] })
    expect(parseRewindRange('RB_NO_TARGET\n')).toEqual({ foreign: [] })
  })

  it('читает результат перемотки ветки', () => {
    expect(parseRewindResult('RB_RESET\na1b2c3d\n')).toEqual({ moved: true, head: 'a1b2c3d' })
    expect(parseRewindResult('RB_RESET_FAILED\n')).toEqual({ moved: false, head: null })
  })
})

describe('Отказ на негодной цели', () => {
  it('не строит команду для значения, которое не хеш', () => {
    // The target comes out of localStorage, so it is not trusted to be one hash.
    expect(rewindRangeCommand('main; rm -rf /')).toBe('echo RB_NO_TARGET')
    expect(rewindToCommitCommand('HEAD~1 && echo hi')).toBe('echo RB_RESET_FAILED')
  })
})

/**
 * The commands, run for real.
 *
 * Every claim above is about what git does, not what the string looks like: a
 * pathspec that quietly stages the user's own work, a rewind that takes their
 * uncommitted edits with it, a commit that records nothing and claims a point on
 * the timeline anyway. All three look fine in a unit test and only show up here.
 */
describe('Против настоящего git', () => {
  it('коммитит только файлы хода, оставляя чужую работу в staged', () => {
    const dir = repo('paths')
    writeFileSync(path.join(dir, 'user-staged.js'), 'их работа\n')
    writeFileSync(path.join(dir, 'user-unstaged.js'), 'их черновик\n')
    git(dir, 'add', 'user-staged.js')
    git(dir, 'add', 'user-staged.js', 'user-unstaged.js')
    git(dir, 'commit', '-q', '-m', 'base', '--', 'user-staged.js', 'user-unstaged.js')
    writeFileSync(path.join(dir, 'app.js'), 'ход агента\n')

    const command = commitTurnCommand(`${AGENT_SUBJECT}: ход 1 · тест`, ['app.js'])!
    shell(dir, command)

    const shown = git(dir, 'show', '--name-only', '--pretty=format:', 'HEAD').trim()
    expect(shown).toBe('app.js')
    expect(git(dir, 'log', '-1', '--pretty=%s').trim()).toBe(`${AGENT_SUBJECT}: ход 1 · тест`)
    expect(git(dir, 'status', '--porcelain')).toBe('')
  })

  it('создаёт первый коммит в репозитории без коммитов', () => {
    const dir = repo('first')
    writeFileSync(path.join(dir, 'app.js'), 'v1\n')

    const output = shell(dir, commitTurnCommand(`${AGENT_SUBJECT}: ход 1 · первый`, ['app.js'])!)

    const head = git(dir, 'rev-parse', '--short', 'HEAD').trim()
    expect(parseCommitHead(output).after).toBe(head)
  })

  it('не заявляет точку на шкале, когда ход ничего не изменил', () => {
    const dir = repo('unchanged')
    writeFileSync(path.join(dir, 'app.js'), 'v1\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'base')

    const output = shell(dir, commitTurnCommand(`${AGENT_SUBJECT}: ход 2 · пусто`, ['app.js'])!)
    expect(parseCommitHead(output)).toEqual({ after: null })
    expect(git(dir, 'rev-list', '--count', 'HEAD').trim()).toBe('1')
  })

  it('удаляет файл, который ход стёр', () => {
    const dir = repo('delete')
    writeFileSync(path.join(dir, 'app.js'), 'v1\n')
    writeFileSync(path.join(dir, 'old.js'), 'был\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'base')
    rmSync(path.join(dir, 'old.js'))

    const output = shell(dir, commitTurnCommand(`${AGENT_SUBJECT}: ход 2 · убрал`, ['old.js'])!)

    expect(parseCommitHead(output).after).toBe(git(dir, 'rev-parse', '--short', 'HEAD').trim())
    expect(existsSync(path.join(dir, 'old.js'))).toBe(false)
  })

  it('откатывает ветку на коммит хода и убирает созданное после', () => {
    const dir = repo('rewind')
    writeFileSync(path.join(dir, 'app.js'), 'v1\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'base')
    const first = git(dir, 'rev-parse', '--short', 'HEAD').trim()

    writeFileSync(path.join(dir, 'app.js'), 'v2\n')
    writeFileSync(path.join(dir, 'added.js'), 'появился\n')
    const second = shell(
      dir,
      commitTurnCommand(`${AGENT_SUBJECT}: ход 2 · второй`, ['app.js', 'added.js'])!,
    )
    const head2 = parseCommitHead(second).after
    expect(head2).toBeTruthy()

    // What the app asks before it moves the branch: nothing of the user's.
    expect(parseRewindRange(shell(dir, rewindRangeCommand(first!))).foreign).toEqual([])

    const reset = shell(dir, rewindToCommitCommand(first!))
    expect(parseRewindResult(reset)).toEqual({ moved: true, head: first })

    expect(readFileSync(path.join(dir, 'app.js'), 'utf8')).toBe('v1\n')
    expect(existsSync(path.join(dir, 'added.js'))).toBe(false)
  })

  it('не трогает незакоммиченные правки пользователя', () => {
    const dir = repo('dirty')
    writeFileSync(path.join(dir, 'app.js'), 'v1\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'base')
    const first = git(dir, 'rev-parse', '--short', 'HEAD').trim()
    writeFileSync(path.join(dir, 'app.js'), 'v2\n')
    shell(dir, commitTurnCommand(`${AGENT_SUBJECT}: ход 2 · второй`, ['app.js'])!)

    // The user is mid-edit when they press «Вернуться сюда».
    writeFileSync(path.join(dir, 'app.js'), 'правка пользователя\n')
    const result = parseRewindResult(shell(dir, rewindToCommitCommand(first!)))

    expect(result.moved).toBe(false)
    expect(readFileSync(path.join(dir, 'app.js'), 'utf8')).toBe('правка пользователя\n')
  })

  it('не двигает ветку через коммит, сделанный пользователем', () => {
    const dir = repo('foreign')
    writeFileSync(path.join(dir, 'app.js'), 'v1\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'base')
    const first = git(dir, 'rev-parse', '--short', 'HEAD').trim()
    writeFileSync(path.join(dir, 'app.js'), 'v2\n')
    shell(dir, commitTurnCommand(`${AGENT_SUBJECT}: ход 2 · второй`, ['app.js'])!)
    writeFileSync(path.join(dir, 'note.md'), 'моя заметка\n')
    git(dir, 'add', 'note.md')
    git(dir, 'commit', '-q', '-m', 'моя заметка')

    // The range check names the commit that is not ours to drop.
    const range = parseRewindRange(shell(dir, rewindRangeCommand(first!)))
    expect(range.foreign).toEqual(['моя заметка'])
  })

  it('не строит команду для цели, которой git не знает', () => {
    const dir = repo('unknown')
    writeFileSync(path.join(dir, 'app.js'), 'v1\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'base')

    expect(shell(dir, rewindRangeCommand('deadbee')).trim()).toBe('RB_NO_TARGET')
  })
})