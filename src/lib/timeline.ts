/**
 * Every agent turn as one commit, and every turn as a point to come back to.
 *
 * A turn writes files. Recording them in git as they land turns the transcript
 * into a real history: `git log` reads as a list of what the agent did and in
 * what order, and the rewind button becomes a checkout of that history instead
 * of a replay of stored file contents.
 *
 * Two decisions shape everything here.
 *
 * **A commit carries only the paths its turn wrote.** `git add -A` on its own
 * would sweep up whatever the user has half-finished in the same repository, and
 * a history that silently swallows someone's work is worse than no history. The
 * pathspec is why `commitTurnCommand` stages *and* commits by path: the pathspec
 * on `git commit` is what actually keeps their work out.
 *
 * **Coming back is `reset --keep`, never `--hard`.** `--hard` would discard
 * uncommitted work to make the rewind succeed; `--keep` refuses the rewind
 * instead, and the caller falls back to the snapshot plan. Losing a person's
 * unsaved edits to make a button work is the one outcome not allowed here.
 */

import { GIT_IDENTITY, shellQuote } from './git'
import type { ChatMessage } from './store'

/**
 * The prefix every commit this app writes carries.
 *
 * It is also the marker `rewindRangeCommand` checks to decide whether the
 * commits between the target and HEAD are all the agent's: a rewind that would
 * drop a commit the user made themselves is refused. Refusing is the safe
 * direction — the snapshot rewind still restores the files, only the branch
 * stays where it is.
 */
export const AGENT_SUBJECT = 'RBUILDER'

/** Longest subject line, and so how much room a user's request gets in one. */
export const MAX_SUBJECT = 60

/**
 * The exec route refuses commands over 400 characters, so a turn that writes a
 * dozen long paths cannot name them all twice over. Past this the commit covers
 * the whole tree instead — the same thing the Git panel's own «Зафиксировать»
 * does — rather than dropping the turn off the timeline.
 */
export const COMMIT_BUDGET = 380

/**
 * The subject of a turn's commit: the agent's marker, which turn it was, and
 * what was asked for.
 *
 * The request is a better summary than the model's own prose — it is what the
 * turn was *for*, and it is short. It falls back to the reply for a turn
 * started without words (the inspector's «спросить агента»).
 */
export function turnCommitSubject(request: string, prose: string, turn: number): string {
  const prefix = `${AGENT_SUBJECT}: ход ${turn} · `
  const text = safeSubject(firstLine(request) || firstLine(prose))
  const body = text ? truncate(text, MAX_SUBJECT - prefix.length) : ''
  if (body) return `${prefix}${body}`
  return prefix.trim().slice(0, MAX_SUBJECT)
}

/** True when a commit subject is one this app wrote. */
export function isAgentSubject(subject: string): boolean {
  return subject.startsWith(`${AGENT_SUBJECT}:`)
}

/**
 * One round trip that commits the turn and reports whether it did.
 *
 * The sha is printed only when a commit really happened, so a turn that rewrote
 * a file with the bytes it already had claims no point on the timeline.
 *
 * Returns null when the turn cannot be committed by path: no paths at all (an
 * empty pathspec stages the entire tree), or a path that cannot be quoted
 * safely. Both are refused rather than guessed at.
 */
export function commitTurnCommand(subject: string, paths: string[]): string | null {
  if (paths.length === 0) return null
  const quoted = paths.map((path) => shellQuote(path))
  // One unquotable path would commit a tree that silently omits a file the turn
  // wrote — a history that lies. Better to record no point than a false one.
  if (quoted.some((value) => value === null)) return null

  const message = commitArg(subject)
  // The leading `&&` is what makes the sha conditional: `git commit` exits
  // 1 when there is nothing to record, and a turn that changed no bytes on disk
  // must claim no point on the timeline.
  const record = `&& { echo RB_COMMITTED; git rev-parse --short HEAD; } || echo RB_NOTHING`
  const pathspec = quoted.join(' ')
  const exact =
    `git add -A -- ${pathspec}; ` +
    `git ${GIT_IDENTITY} commit -q -m ${message} -- ${pathspec} ` +
    record
  if (exact.length <= COMMIT_BUDGET) return exact

  // Too many paths to name them all. The whole tree goes in, as it would if the
  // user pressed «Зафиксировать» themselves — a turn stays on the timeline.
  return `git add -A; git ${GIT_IDENTITY} commit -q -m ${message} ${record}`
}

/** The new sha of a turn's commit, or null when the turn committed nothing. */
export function parseCommitHead(output: string): { after: string | null } {
  const lines = output.split(/\r?\n/).map((line) => line.trim())
  const at = lines.indexOf('RB_COMMITTED')
  if (at < 0) return { after: null }
  const sha = lines[at + 1]
  return { after: isSha(sha) ? sha : null }
}

/**
 * The commit a rewind to `index` should land on, or null when there is none.
 *
 * That is the newest commit made before that point: a rewind to a user message
 * leaves the previous turn's work in place, and a rewind to an assistant message
 * drops that message too — so the target is always the turn strictly above it.
 */
export function rewindTargetCommit(messages: ChatMessage[], index: number): string | null {
  let target: string | null = null
  for (const message of messages.slice(0, Math.max(0, index))) {
    if (message.role === 'assistant' && message.commit) target = message.commit
  }
  return target
}

/**
 * The commits between the target and HEAD, so a rewind can check whose they are.
 *
 * One round trip that also answers the question a rewind must ask before moving
 * anything: is the target a commit git knows at all?
 */
export function rewindRangeCommand(target: string): string {
  if (!isSha(target)) return 'echo RB_NO_TARGET'
  return (
    `git rev-parse --verify -q ${target} >/dev/null 2>&1 && ` +
    `{ echo RB_RANGE; git log --format="%s" ${target}..HEAD 2>/dev/null; echo RB_RANGE_END; } ` +
    `|| echo RB_NO_TARGET`
  )
}

/**
 * Parses `rewindRangeCommand`.
 *
 * `foreign` is what a rewind would drop that the app did not write. Any entry
 * means the branch stays put and the snapshot rewind takes over: the user's own
 * commits are not ours to discard.
 */
export function parseRewindRange(output: string): { foreign: string[] } {
  const lines = output.split(/\r?\n/).map((line) => line.trim())
  const start = lines.indexOf('RB_RANGE')
  if (start < 0) return { foreign: [] }
  const end = lines.indexOf('RB_RANGE_END', start)
  const subjects = lines.slice(start + 1, end < 0 ? lines.length : end).filter(Boolean)
  return { foreign: subjects.filter((subject) => !isAgentSubject(subject)) }
}

/** Moves the branch to the turn's commit, leaving uncommitted work alone. */
export function rewindToCommitCommand(target: string): string {
  if (!isSha(target)) return 'echo RB_RESET_FAILED'
  return `git reset -q --keep ${target} && { echo RB_RESET; git rev-parse --short HEAD; } || echo RB_RESET_FAILED`
}

/** Parses `rewindToCommitCommand`: whether the branch moved, and to where. */
export function parseRewindResult(output: string): { moved: boolean; head: string | null } {
  const lines = output.split(/\r?\n/).map((line) => line.trim())
  const at = lines.indexOf('RB_RESET')
  if (at < 0) return { moved: false, head: null }
  return { moved: true, head: isSha(lines[at + 1]) ? lines[at + 1]! : null }
}

/** A hash as git prints it: hex, and long enough to mean something. */
function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/.test(value)
}

/**
 * Drops the characters a shell would act on.
 *
 * A request is the user's own text, so it arrives carrying quotes, backslashes
 * and redirection operators. They are dropped rather than escaped: a commit
 * subject is a summary, and mangling the summary to save a stray quote is the
 * wrong trade.
 */
function safeSubject(value: string): string {
  return value.replace(/["'\\`$<>|;&*?()[\]{}#~]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The first line of a request, as one line: a commit subject has no breaks. */
function firstLine(value: string): string {
  const line = value.split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? ''
  return line.replace(/\s+/g, ' ').trim()
}

/** Shortens to fit, marking that something was cut. */
function truncate(value: string, room: number): string {
  if (value.length <= room) return value
  if (room <= 1) return ''
  return `${value.slice(0, room - 1).trimEnd()}…`
}

/**
 * The subject as one shell argument.
 *
 * A request is the user's own text, so it arrives carrying quotes, backslashes
 * and whatever else a shell would act on. Those characters are dropped rather
 * than escaped: a commit subject is a summary, and mangling the summary to save
 * a stray quote is the wrong trade.
 */
function commitArg(subject: string): string {
  return `"${safeSubject(subject).slice(0, MAX_SUBJECT)}"`
}