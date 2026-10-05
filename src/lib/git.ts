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

/**
 * The command that creates a repository, or `null` when there is nowhere to
 * create one.
 *
 * A task with no bound folder runs its commands in the scratch copy at
 * `.freebuff-workspace/project`, which is rewritten from scratch on every
 * command. A repository created there is thrown away with the next run — and
 * until then it makes the panel report a branch and a history that belong to
 * nothing, which is exactly the state this returns null to prevent.
 */
export function gitInitCommand(folder: string | null): string | null {
  if (!folder) return null
  return 'git init -q -b main 2>/dev/null || git init -q'
}

/** True when git actions are worth offering at all: only against a real folder. */
export function isGitUsable(folder: string | null): boolean {
  return Boolean(folder)
}

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
export function shellQuote(value: string): string | null {
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

/**
 * Identity for every command that may write a commit.
 *
 * The machine may have no global git identity at all — which is the usual case
 * on a fresh Windows install — and a rebase replays commits, so it needs one
 * too. Passing it per command keeps the project folder free of a local config
 * the user did not ask for.
 */
export const GIT_IDENTITY = '-c user.name=RBUILDER -c user.email=rbuilder@local'
export function gitTagCommand(name: string): string {
  const safe = shellQuote(name)
  if (!safe) return 'true'
  return `git tag -- ${safe}`
}

/* ------------------------------------------------------------------ */
/* Merge conflicts                                                     */
/* ------------------------------------------------------------------ */

/**
 * Which side of a conflict a block came from.
 *
 * `ours` is the branch you are on — the one you started from — and `theirs` is
 * the branch being merged into it. That naming is git's own, and it is worth
 * keeping the words rather than inventing friendlier ones: the labels would then
 * be the only place in the app where "ours" means something else.
 */
export type ConflictSide = 'ours' | 'theirs'

/** One region of a conflicted file. */
export type ConflictChunk = {
  kind: 'conflict' | 'text'
  /** The marker line that opens a region; for text, the text itself. */
  header?: string
  /** The two sides, in file order. `base` is the common ancestor (diff3 only). */
  ours?: string[]
  base?: string[]
  theirs?: string[]
}

/** True when the content still carries unresolved conflict markers. */
export function hasConflictMarkers(content: string): boolean {
  return /^<{7}( |$)/m.test(content) && /^={7}$/m.test(content) && /^>{7}( |$)/m.test(content)
}

/**
 * Splits a conflicted file into its conflict regions and the plain text between
 * them, so the panel can show both sides of the disagreement instead of a wall of
 * markers.
 *
 * Content with no markers parses to a single `text` chunk, which is what a file
 * that was already resolved looks like: the panel shows it as clean rather than
 * inventing an empty conflict.
 */
export function parseConflictChunks(content: string): ConflictChunk[] {
  const lines = content.split(/\r?\n/)
  const chunks: ConflictChunk[] = []
  let plain: string[] = []

  const flushPlain = () => {
    if (plain.length === 0) return
    const text = plain.join('\n')
    plain = []
    // An empty or all-blank file has no text worth a chunk of its own.
    if (text.trim() === '') return
    chunks.push({ kind: 'text', header: text })
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!

    if (!isStartMarker(line)) {
      plain.push(line)
      continue
    }

    // Collect the blocks up to the next marker. Everything after the end marker
    // is plain text, and a file that was never closed is treated as plain rather
    // than silently dropping the rest.
    const cursor = { at: i + 1 }
    const collect = (until: (line: string) => boolean): string[] => {
      const block: string[] = []
      while (cursor.at < lines.length && !until(lines[cursor.at]!)) {
        block.push(lines[cursor.at]!)
        cursor.at += 1
      }
      return block
    }

    // A plain merge has two blocks. `diff3` inserts the common ancestor between
    // them behind a `|||||||` marker, and the panel shows it because most real
    // conflicts are both sides editing the same line — the ancestor is what tells
    // the two edits apart.
    const ours = collect((line) => isSeparatorMarker(line) || isBaseMarker(line))
    let base: string[] = []
    if (isBaseMarker(lines[cursor.at] ?? '')) {
      cursor.at += 1
      base = collect(isSeparatorMarker)
    }
    if (isSeparatorMarker(lines[cursor.at] ?? '')) cursor.at += 1
    const theirs = collect(isEndMarker)

    if (!isEndMarker(lines[cursor.at] ?? '')) {
      // Unterminated: the region never happened, so the lines stay plain text and
      // the walk continues from the opening marker, which is itself just text.
      plain.push(line)
      continue
    }
    cursor.at += 1

    flushPlain()
    // The marker line names the sides, which the panel shows as the heading.
    chunks.push({ kind: 'conflict', header: line, ours, base, theirs })
    i = cursor.at - 1
  }

  flushPlain()
  return chunks
}

function isStartMarker(line: string): boolean {
  return /^<{7}( .*)?$/.test(line)
}

function isSeparatorMarker(line: string): boolean {
  return /^={7}$/.test(line)
}

/** diff3 and combined diffs label the common ancestor with `|||||||`. */
function isBaseMarker(line: string): boolean {
  return /^\|{7}( .*)?$/.test(line)
}

function isEndMarker(line: string): boolean {
  return /^>{7}( .*)?$/.test(line)
}

/**
 * Resolves one conflict by taking a side wholesale.
 *
 * `git checkout --ours` then `git add` is the whole operation: git writes the
 * chosen side into the working tree and stages it, which is what clears the
 * unmerged state. Anything cleverer — a real three-way merge — is git's job, not
 * ours, and a merge this panel invented would be worse than the conflict.
 *
 * The `||` fallback covers `git checkout --ours` failing on a path git does not
 * consider unmerged; the command then reports nothing and the panel re-reads,
 * which is the honest outcome.
 */
export function gitResolveCommand(path: string, side: ConflictSide): string {
  const safe = shellQuote(path)
  if (!safe) return 'true'
  return `git checkout --${side} -- ${safe} && git add -- ${safe}`
}

/** The paths git reports as unmerged, behind the same `.git` guard as the rest. */
export const GIT_CONFLICT_COMMAND = [
  'if [ -d .git ]; then',
  // NUL first: a path containing a newline would otherwise arrive as two paths.
  'git --no-pager diff --name-only --diff-filter=U -z 2>/dev/null | tr "\\0" "\\n" || true;',
  'fi',
].join(' ')

/**
 * Parses the output of GIT_CONFLICT_COMMAND.
 *
 * The command separates with NUL first, so a path containing a space or a quote
 * survives — a newline-separated listing would split one path into two.
 */
export function parseConflictPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export const GIT_PUSH_COMMAND =
  'git push -u origin HEAD 2>&1 || git push 2>&1'

export const GIT_PULL_COMMAND = 'git pull --ff-only 2>&1'

/**
 * The remote URL, or an empty string when there is no `origin`.
 *
 * `--exit-code` is deliberately not used here: it would turn "no such remote"
 * into a failed command, and having no remote is an ordinary state the panel
 * has to be able to talk about.
 */
export const GIT_REMOTE_COMMAND = 'git remote get-url origin 2>/dev/null || true'

/** Points `origin` at a URL, creating or repointing it as needed. */
export function gitRemoteCommand(url: string): string {
  const safe = shellQuote(url)
  if (!safe) return 'true'
  return `git remote add origin ${safe} 2>/dev/null || git remote set-url origin ${safe}`
}

/** The branch that is checked out; `main` when HEAD cannot say (no commits). */
export const GIT_BRANCH_COMMAND =
  'git symbolic-ref --short -q HEAD 2>/dev/null || echo main'

/** Whether the remote has this branch, answered by asking the remote itself. */
export function gitLsRemoteCommand(branch: string): string {
  const safe = shellQuote(branch)
  if (!safe) return 'echo'
  return `git ls-remote --heads origin ${safe} 2>/dev/null || true`
}

/**
 * Rebases onto the remote branch, which is what keeps a shared line linear.
 *
 * The identity is passed here too: a rebase re-commits what it replays, and a
 * machine with no global git identity would stop the sync with "unable to
 * auto-detect email address".
 */
export function gitPullRebaseCommand(branch: string): string {
  const safe = shellQuote(branch)
  if (!safe) return 'true'
  return `git ${GIT_IDENTITY} pull --rebase origin ${safe} 2>&1`
}

/** Publishes the current branch and starts tracking the remote one. */
export function gitPushBranchCommand(branch: string): string {
  const safe = shellQuote(branch)
  if (!safe) return 'true'
  return `git push -u origin HEAD:${safe} 2>&1`
}

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

/**
 * Stage everything and commit — but say nothing when there is nothing staged.
 *
 * `git commit` with a clean index exits 1, which a sync would report as a
 * failure for the most ordinary outcome there is: the project simply has no
 * new changes.
 */
export function gitCommitIfAnyCommand(message: string): string {
  const safe = message.replace(/"/g, "'").slice(0, 200)
  return `git add -A && if git diff --cached --quiet; then echo RB_NOTHING_TO_COMMIT; else git ${GIT_IDENTITY} commit -q -m "${safe}"; fi`
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
  /**
   * True when a person asked for this command by pressing a button. The server
   * refuses `git push` unless it is told a person did — the agent's terminal
   * never sets it, so a prompt cannot talk the model into publishing.
   */
  allowGitPush = false,
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
    false,
    allowGitPush,
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

/** The paths git reports as unmerged, for the panel's conflict list. */
export async function readConflictPaths(
  files: { path: string; content: string }[],
  signal?: AbortSignal,
  cwd?: string,
): Promise<string[]> {
  const result = await runGit(GIT_CONFLICT_COMMAND, files, signal, cwd)
  return parseConflictPaths(result.output)
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
