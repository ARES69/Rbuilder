/**
 * Git for the workspace the terminal runs in.
 *
 * There is no git library here on purpose: commands run through the same
 * `/api/exec` route the terminal uses, in the same scratch copy of the project,
 * so what the panel reports is what `git` actually says — not a simulation of the
 * virtual project in the browser.
 *
 * The scratch directory is `.freebuff-workspace/project` inside the application
 * folder, which is usually a git checkout itself. The panel therefore asks whether
 * that directory has its own repository instead of trusting `git rev-parse`, which
 * would happily answer for the enclosing project.
 */

import { execCommand, type ExecEvent } from './agent'

export type GitChange = { index: string; worktree: string; path: string }

export type GitState = {
  /** The scratch directory has its own `.git`. */
  isRepo: boolean
  branch: string | null
  changes: GitChange[]
  lastCommit: string | null
  error?: string
}

export const GIT_UNTRACKED = '??'

/**
 * One round trip instead of five, and everything sits inside the `if`: without a
 * `.git` of its own the queries would happily answer for the enclosing checkout
 * (the application source) instead of the terminal workspace.
 */
export const GIT_STATE_COMMAND = [
  'if [ -d .git ]; then',
  'echo RB_REPO;',
  // symbolic-ref answers for a repository without commits, where rev-parse says HEAD.
  'echo RB_BRANCH; git symbolic-ref --short -q HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null;',
  'echo RB_STATUS; git status --porcelain 2>/dev/null;',
  // A repository without commits makes `git log` exit 128; `true` keeps the
  // command successful so a read is never reported as a failure.
  'echo RB_LOG; git log -1 --pretty=format:"%h %s" 2>/dev/null || true;',
  'else echo RB_NO_REPO; fi',
].join(' ')

export const GIT_INIT_COMMAND =
  'git init -q -b main 2>/dev/null || git init -q'

/**
 * The rest of the panel's state in one round trip, behind the same `.git`
 * guard: branches, tags, the remote and the recent history. A repository
 * without commits makes most of these answer nothing, so each is guarded with
 * `|| true` to keep the whole command successful.
 */
export const GIT_EXTRA_COMMAND = [
  'if [ -d .git ]; then',
  'echo RB_BRANCHES; git branch --format="%(refname:short)" 2>/dev/null || true;',
  'echo RB_TAGS; git tag --list 2>/dev/null || true;',
  'echo RB_REMOTE; git remote get-url origin 2>/dev/null || true;',
  'echo RB_TRACKING; git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true;',
  'echo RB_LOG; git log -20 --pretty=format:"%h%x1f%an%x1f%ad%x1f%s" --date=short 2>/dev/null || true;',
  // Ahead/behind lives in `branch.ab +N -M`, not in a word like "ahead", so it
  // is read from that line rather than guessed.
  'echo RB_SYNC; git status --porcelain=v2 --branch 2>/dev/null | grep -m1 "^# branch.ab" || true;',
  'else echo RB_NO_REPO; fi',
].join(' ')

/**
 * Single-quotes a value for the shell.
 *
 * These values become part of a shell string, so they are quoted rather than
 * filtered: stripping disallowed characters would silently rewrite a legitimate
 * filename like `my notes.md` into `mynotes.md`. Only an embedded quote or a
 * newline can break out of the quotes, and both are refused outright.
 */
function shellQuote(value: string): string | null {
  if (!value.trim() || /['\n\r\0]/.test(value)) return null
  return `'${value}'`
}

/**
 * A working-tree diff for one path. The path comes from `git status`, so it is
 * quoted rather than trusted.
 */
export function gitDiffCommand(path: string): string {
  const safe = shellQuote(path)
  if (!safe) return 'true'
  return `git --no-pager diff --no-color -- ${safe}`
}

/** Switches to an existing branch, and creates it when there is none. */
export function gitCheckoutCommand(branch: string): string {
  const safe = shellQuote(branch)
  if (!safe) return 'true'
  return `git checkout -q -- ${safe} 2>/dev/null || git checkout -q -b -- ${safe}`
}

/** Tags the current commit; an empty or unquotable name is refused. */
export function gitTagCommand(name: string): string {
  const safe = shellQuote(name)
  if (!safe) return 'true'
  return `git tag -- ${safe}`
}

export const GIT_PUSH_COMMAND =
  'git push -u origin HEAD 2>&1 || git push 2>&1'

export const GIT_PULL_COMMAND = 'git pull --ff-only 2>&1'

/** Fired after a git action so the sidebar summary can catch up. */
export const GIT_CHANGED_EVENT = 'rbuilder:git-changed'

export function notifyGitChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(GIT_CHANGED_EVENT))
}

/** Identity is passed per command: the workspace must not depend on global config. */
export function gitCommitCommand(message: string): string {
  const safe = message.replace(/"/g, "'").slice(0, 200)
  return `git -c user.name=RBUILDER -c user.email=rbuilder@local add -A && git -c user.name=RBUILDER -c user.email=rbuilder@local commit -q -m "${safe}"`
}

/** Parses the marked output of GIT_STATE_COMMAND. */
export function parseGitState(output: string): GitState {
  const lines = output.split(/\r?\n/)
  const state: GitState = { isRepo: false, branch: null, changes: [], lastCommit: null }
  let section = ''

  for (const line of lines) {
    if (line === 'RB_REPO') {
      state.isRepo = true
      continue
    }
    if (line === 'RB_NO_REPO') {
      state.isRepo = false
      continue
    }
    if (line === 'RB_BRANCH' || line === 'RB_STATUS' || line === 'RB_LOG') {
      section = line
      continue
    }
    if (!line.trim()) continue

    if (section === 'RB_BRANCH') {
      state.branch = line.trim()
      continue
    }
    if (section === 'RB_STATUS') {
      const change = parseStatusLine(line)
      if (change) state.changes.push(change)
      continue
    }
    if (section === 'RB_LOG') {
      state.lastCommit = line.trim()
    }
  }

  return state
}

/** `XY path` — the two status columns are kept so renames stay readable. */
function parseStatusLine(line: string): GitChange | null {
  if (line.length < 4) return null
  const index = line.slice(0, 1)
  const worktree = line.slice(1, 2)
  const path = line.slice(3).trim()
  if (!path) return null
  return { index, worktree, path }
}

export function changeLabel(change: GitChange): string {
  if (change.index === GIT_UNTRACKED[0] && change.worktree === GIT_UNTRACKED[1]) return 'A'
  if (change.index === 'D' || change.worktree === 'D') return 'D'
  if (change.index === 'A') return 'A'
  if (change.index === 'R') return 'R'
  if (change.index === 'U' || change.worktree === 'U' || change.index === 'C') return 'C'
  return 'M'
}

/** One line of `git log`. */
export type GitCommit = {
  hash: string
  author: string
  date: string
  subject: string
}

export type GitExtra = {
  branches: string[]
  tags: string[]
  /** The `origin` URL, when there is one. */
  remote: string | null
  /** The upstream branch (`origin/main`), when the branch tracks one. */
  tracking: string | null
  /** True when the branch is ahead, behind, or both. */
  outOfSync: boolean
  commits: GitCommit[]
}

/** The ASCII unit separator the log format uses between fields. */
const FIELD = '\x1f'

/**
 * Parses the marked output of GIT_EXTRA_COMMAND.
 *
 * Everything here is best-effort: a repository with no commits answers with
 * empty sections, and that is a normal state (just `git init`), not an error.
 */
export function parseGitExtra(output: string): GitExtra {
  const extra: GitExtra = {
    branches: [],
    tags: [],
    remote: null,
    tracking: null,
    outOfSync: false,
    commits: [],
  }
  let section = ''

  for (const line of output.split(/\r?\n/)) {
    if (line === 'RB_BRANCHES' || line === 'RB_TAGS' || line === 'RB_REMOTE' ||
        line === 'RB_TRACKING' || line === 'RB_LOG' || line === 'RB_SYNC') {
      section = line
      continue
    }
    if (!line.trim()) continue

    if (section === 'RB_BRANCHES') {
      extra.branches.push(line.trim())
    } else if (section === 'RB_TAGS') {
      extra.tags.push(line.trim())
    } else if (section === 'RB_REMOTE') {
      // A remote path can contain spaces, so the value is kept whole.
      extra.remote = line.trim()
    } else if (section === 'RB_TRACKING') {
      extra.tracking = line.trim()
    } else if (section === 'RB_SYNC') {
      extra.outOfSync = isAheadBehind(line)
    } else if (section === 'RB_LOG') {
      const commit = parseLogLine(line)
      if (commit) extra.commits.push(commit)
    }
  }

  return extra
}

/** `# branch.ab +N -M` — anything but `+0 -0` means the branch has diverged. */
function isAheadBehind(line: string): boolean {
  const match = line.match(/\+(\d+)\s+-(\d+)/)
  if (!match) return false
  return match[1] !== '0' || match[2] !== '0'
}

/** `hash␟author␟date␟subject` — a line missing any field is skipped, not guessed. */
function parseLogLine(line: string): GitCommit | null {
  const [hash, author, date, ...rest] = line.split(FIELD)
  if (!hash || !author || !date) return null
  return { hash, author, date, subject: rest.join(FIELD) }
}

/** One line of a unified diff, tagged for rendering. */
export type DiffLine = { kind: 'context' | 'add' | 'remove' | 'meta'; text: string }

/**
 * Turns a unified diff into renderable lines.
 *
 * `git diff` exits 0 with no output when nothing differs, so an empty result is
 * the normal "no changes" case. Only the hunk bodies are tagged; the
 * `diff --git`/`@@` preamble is kept as meta so the reader still sees which
 * file and which range the hunk covers.
 */
export function parseUnifiedDiff(output: string): DiffLine[] {
  const lines: DiffLine[] = []
  for (const raw of output.split(/\r?\n/)) {
    if (!raw) continue
    if (raw.startsWith('+++') || raw.startsWith('---')) {
      lines.push({ kind: 'meta', text: raw })
    } else if (raw.startsWith('@@')) {
      lines.push({ kind: 'meta', text: raw })
    } else if (raw.startsWith('diff ') || raw.startsWith('index ') ||
               raw.startsWith('old mode') || raw.startsWith('new mode') ||
               raw.startsWith('Binary files') || raw.startsWith('\\')) {
      lines.push({ kind: 'meta', text: raw })
    } else if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw })
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'remove', text: raw })
    } else {
      lines.push({ kind: 'context', text: raw })
    }
  }
  return lines
}

/** The panel's states, so the class names stay in one place. */
export type GitTone = 'clean' | 'dirty' | 'missing'

export function gitTone(state: GitState | null): GitTone {
  if (!state || !state.isRepo) return 'missing'
  return state.changes.length > 0 ? 'dirty' : 'clean'
}

/** Collects the NDJSON events of one git command into a single string. */
export async function runGit(
  command: string,
  files: { path: string; content: string }[],
  signal?: AbortSignal,
  /** The bound project folder: git answers for the real repository. */
  cwd?: string,
): Promise<{ ok: boolean; output: string; error?: string }> {
  const parts: string[] = []
  let error: string | undefined

  const result = await execCommand(
    command,
    files,
    (event: ExecEvent) => {
      if (event.type === 'stdout' || event.type === 'stderr') parts.push(event.text)
      else if (event.type === 'error') error = event.message
      else if (event.type === 'exit' && event.code !== 0 && !error) {
        error = `git exited with code ${event.code ?? 'unknown'}`
      }
    },
    signal,
    cwd,
  )

  return { ok: result.ok && !error, output: parts.join(''), error: result.error ?? error }
}

export async function readGitState(
  files: { path: string; content: string }[],
  signal?: AbortSignal,
  cwd?: string,
): Promise<GitState> {
  const result = await runGit(GIT_STATE_COMMAND, files, signal, cwd)
  const state = parseGitState(result.output)
  // A failed read still answers with what git managed to print; the panel shows
  // the error next to it rather than pretending the tree is clean.
  if (!result.ok && result.error && !state.isRepo) state.error = result.error
  return state
}

/** Branches, tags, the remote and the recent history for the same workspace. */
export async function readGitExtra(
  files: { path: string; content: string }[],
  signal?: AbortSignal,
  cwd?: string,
): Promise<GitExtra> {
  const result = await runGit(GIT_EXTRA_COMMAND, files, signal, cwd)
  return parseGitExtra(result.output)
}

/**
 * The diff for one path. A repository without commits has nothing to diff
 * against, so the command reports that instead of returning an empty string
 * that would read as "no changes".
 */
export async function readGitDiff(
  files: { path: string; content: string }[],
  path: string,
  signal?: AbortSignal,
  cwd?: string,
): Promise<DiffLine[]> {
  const result = await runGit(gitDiffCommand(path), files, signal, cwd)
  return parseUnifiedDiff(result.output)
}
