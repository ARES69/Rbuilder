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
