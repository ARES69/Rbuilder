/**
 * Sync: one button, both directions.
 *
 * Push and pull as separate buttons make people choose a direction, which is
 * the wrong question when the question is "is this project up to date". Sync
 * does what a person does when they sit down at a machine with both a working
 * copy and a remote: commit what is here, bring in what is there, publish what
 * is left.
 *
 * The order matters and is the whole design. Committing first means the local
 * work is safe before the rebase can touch it. Rebasing rather than merging
 * means the shared branch stays a line, not a braid of merge commits. Pushing
 * last means nothing is published until it is known to fit.
 *
 * Every step reports separately, because "sync failed" is not something anyone
 * can act on — "GitHub refused the token" is.
 */

import {
  gitAuthArgs,
  isGitHubRemote,
} from './github'
import {
  gitCommitIfAnyCommand,
  gitInitCommand,
  gitLsRemoteCommand,
  gitPullRebaseCommand,
  gitPushBranchCommand,
  gitRemoteCommand,
  GIT_BRANCH_COMMAND,
  GIT_REMOTE_COMMAND,
  notifyGitChanged,
  readConflictPaths,
  runGit,
} from './git'

export type SyncStep = {
  /** Short label for the report line. */
  label: string
  ok: boolean
  detail: string
}

export type SyncReport = {
  ok: boolean
  steps: SyncStep[]
  /** One line for the panel: what happened, in the past tense. */
  summary: string
  /** Paths left unmerged by the rebase, for the conflict view to pick up. */
  conflicts: string[]
}

export type SyncInput = {
  files: { path: string; content: string }[]
  /** The bound folder: git runs here, never in the scratch copy. */
  folder: string
  token: string | null
  /** Commit message for this run; the default says what the button did. */
  message?: string
  /** Called as each step finishes, so the panel can fill in as it goes. */
  onStep?: (step: SyncStep, index: number) => void
}

const NOTHING = 'RB_NOTHING_TO_COMMIT'

/**
 * A `.gitignore` for a project folder that has none.
 *
 * Sync stages everything, and a folder where somebody ran `npm install` in the
 * terminal would otherwise stage a hundred thousand dependency files — to
 * GitHub, from one button press. An existing file is left alone: the project
 * may well have opinions of its own about what to ignore.
 */
export const GIT_IGNORE_COMMAND =
  "test -f .gitignore || printf 'node_modules/\\ndist/\\n.DS_Store\\n' > .gitignore"

/**
 * The line of git's own output worth showing.
 *
 * A failed command prints its reason, then a wall of `hint:` advice — and the
 * last line of that wall is the least useful part of it. Git's `error:` and
 * `fatal:` lines are the reason, so they win; the last line is only the
 * fallback for output that has neither.
 */
function lastLine(output: string, error?: string): string {
  const lines = (output || error || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const reason = lines.find((line) => /^(fatal|error):/i.test(line))
  return reason ?? lines[lines.length - 1] ?? ''
}

/** Whether a git failure is really "your token is not accepted". */
function isAuthFailure(output: string): boolean {
  return /authentication failed|could not read Username|invalid username or password|403 Forbidden|401 Unauthorized/i.test(
    output,
  )
}

/**
 * Pushes and pulls in one gesture.
 *
 * The report is the product: every step that ran is listed with what it said,
 * so a failure is something the reader can act on rather than a red light.
 */
export async function syncProject(input: SyncInput): Promise<SyncReport> {
  const { files, folder, token } = input
  const steps: SyncStep[] = []
  const record = (label: string, ok: boolean, detail: string) => {
    const step: SyncStep = { label, ok, detail }
    steps.push(step)
    input.onStep?.(step, steps.length - 1)
    return step
  }

  // Sync only ever runs because somebody pressed Sync, so every command it
  // issues is a person asking — which is what lets the push past the server's
  // terminal guardrail.
  const run = (command: string) => runGit(command, files, undefined, folder, true)

  // 1. A folder the app created has no repository yet, and "Sync" is the first
  //    thing a person tries — so it makes one rather than refusing.
  const before = await run('test -d .git && echo yes || echo no')
  if (!before.output.includes('yes')) {
    const created = await run(gitInitCommand(folder) ?? 'true')
    if (!created.ok) {
      record('Репозиторий', false, lastLine(created.output, created.error) || 'git init не сработал')
      return { ok: false, steps, summary: 'Не удалось создать репозиторий.', conflicts: [] }
    }
    record('Репозиторий', true, 'создан')
  }

  const remoteResult = await run(GIT_REMOTE_COMMAND)
  const remote = remoteResult.output.trim()
  if (!remote) {
    record('Репозиторий на GitHub', false, 'remote origin не настроен')
    return {
      ok: false,
      steps,
      summary: 'Репозиторий не подключён. Создайте его на GitHub или подключите существующий — выше.',
      conflicts: [],
    }
  }

  // Only github.com gets the app's token; someone else's remote keeps using
  // whatever credentials the machine already has.
  const auth = token && isGitHubRemote(remote) ? `${gitAuthArgs(token)} ` : ''

  await run(GIT_IGNORE_COMMAND)

  const commit = await run(gitCommitIfAnyCommand(input.message ?? 'Синхронизация с GitHub'))
  if (!commit.ok) {
    record('Коммит', false, lastLine(commit.output, commit.error) || 'не удалось зафиксировать изменения')
    return { ok: false, steps, summary: 'Не удалось зафиксировать изменения.', conflicts: [] }
  }
  record(
    'Коммит',
    true,
    commit.output.includes(NOTHING) ? 'изменений не было' : 'изменения зафиксированы',
  )

  const branchResult = await run(GIT_BRANCH_COMMAND)
  const branch = branchResult.output.trim().split(/\r?\n/).pop() || 'main'

  const fetched = await run(`${auth}git fetch origin 2>&1`)
  if (!fetched.ok) {
    const detail = lastLine(fetched.output, fetched.error) || 'git fetch не сработал'
    record('Получение', false, detail)
    return {
      ok: false,
      steps,
      summary: isAuthFailure(fetched.output)
        ? 'GitHub не принял токен — войдите заново и повторите синхронизацию.'
        : 'Не удалось получить данные из удалённого репозитория.',
      conflicts: [],
    }
  }
  record('Получение', true, `origin доступен, ветка ${branch}`)

  // The remote branch only exists after the first push. Asking the remote beats
  // assuming: a first sync has nothing to pull.
  const listed = await run(`${auth}${gitLsRemoteCommand(branch)}`)
  const remoteHasBranch = listed.output.trim().length > 0

  let conflicts: string[] = []
  if (remoteHasBranch) {
    const pulled = await run(`${auth}${gitPullRebaseCommand(branch)}`)
    if (!pulled.ok) {
      conflicts = await readConflictPaths(files, undefined, folder)
      const detail = lastLine(pulled.output, pulled.error) || 'git pull не сработал'
      record(
        'Слияние',
        false,
        conflicts.length > 0 ? `конфликт в ${conflicts.length} файл(ах)` : detail,
      )
      return {
        ok: false,
        steps,
        summary: conflicts.length > 0
          ? 'Изменения не совпали. Разрешите конфликты ниже и нажмите Sync ещё раз.'
          : `Не удалось встроить изменения из origin: ${detail}`,
        conflicts,
      }
    }
    record('Слияние', true, 'изменения из origin встроены')
  } else {
    record('Слияние', true, 'ветки на GitHub ещё нет — нечего забирать')
  }

  const pushed = await run(`${auth}${gitPushBranchCommand(branch)}`)
  if (!pushed.ok) {
    const detail = lastLine(pushed.output, pushed.error) || 'git push не сработал'
    record('Отправка', false, detail)
    return {
      ok: false,
      steps,
      summary: isAuthFailure(pushed.output)
        ? 'GitHub не принял токен — войдите заново и повторите синхронизацию.'
        : `Не удалось отправить изменения: ${detail}`,
      conflicts,
    }
  }
  record('Отправка', true, `${branch} опубликован в origin`)

  notifyGitChanged()
  return {
    ok: true,
    steps,
    summary: remoteHasBranch
      ? `Синхронизировано с ${remote}: ветка ${branch} обновлена и отправлена.`
      : `Репозиторий создан на GitHub: ветка ${branch} отправлена.`,
    conflicts,
  }
}

/** The remote URL of a folder, or null — the same read Sync uses. */
export async function readRemote(
  files: { path: string; content: string }[],
  folder: string,
): Promise<string | null> {
  const result = await runGit(GIT_REMOTE_COMMAND, files, undefined, folder)
  return result.output.trim() || null
}

/**
 * Points the folder at a remote, creating `origin` or repointing it.
 *
 * The repository is created first when the folder has none: connecting is what
 * someone does with a project that has just been created, and `git remote add`
 * outside a repository fails — so without this the first connection would be
 * the one action that does not work.
 */
export async function connectRemote(
  files: { path: string; content: string }[],
  folder: string,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const hasRepo = await runGit('test -d .git && echo yes || echo no', files, undefined, folder, true)
  if (!hasRepo.output.includes('yes')) {
    const created = await runGit(gitInitCommand(folder) ?? 'true', files, undefined, folder, true)
    if (!created.ok) {
      return { ok: false, error: created.error ?? 'не удалось создать репозиторий' }
    }
  }

  const result = await runGit(gitRemoteCommand(url), files, undefined, folder, true)
  if (!result.ok) return { ok: false, error: result.error ?? result.output.trim() }
  notifyGitChanged()
  return { ok: true }
}