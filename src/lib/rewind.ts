/**
 * Rewinding a project to any earlier point in the conversation.
 *
 * Every assistant turn keeps the content each touched file had *before* it
 * (`turn.snapshots`). Reverting one turn is easy; reverting ten is not, because
 * the same path is snapshotted over and over and the naive order restores the
 * newest state instead of the oldest.
 *
 * So the plan is built by walking the turns forward and keeping only the first
 * snapshot seen for a path. That is the file as it stood before the first of
 * the reverted turns touched it, and applying each path exactly once makes the
 * order of the remaining writes irrelevant.
 */

import type { ChatMessage } from './store'

export type RewindPlan = {
  /** Pre-turn content to write back, one entry per path. */
  restore: { path: string; before: string }[]
  /** Paths that did not exist before the reverted turns and are deleted. */
  remove: string[]
  /** The assistant turns the rewind undoes, in transcript order. */
  turnIds: string[]
}

/** What a rewind to `index` would have to change, or nothing when it cannot. */
export function planRewind(messages: ChatMessage[], index: number): RewindPlan {
  const plan: RewindPlan = { restore: [], remove: [], turnIds: [] }
  const seen = new Set<string>()

  for (const message of messages.slice(Math.max(0, index))) {
    if (message.role === 'assistant' && message.snapshots?.length) plan.turnIds.push(message.id)

    for (const snapshot of message.snapshots ?? []) {
      if (seen.has(snapshot.path)) continue
      seen.add(snapshot.path)
      if (snapshot.before === null) plan.remove.push(snapshot.path)
      else plan.restore.push({ path: snapshot.path, before: snapshot.before })
    }
  }

  return plan
}

/** A rewind worth offering: something would change, and it is not the newest turn. */
export function canRewindTo(messages: ChatMessage[], index: number): boolean {
  // The newest turn is already covered by the per-turn «Отменить», which offers
  // the same button without the confirmation.
  if (index >= messages.length - 1) return false
  const plan = planRewind(messages, index)
  return plan.restore.length > 0 || plan.remove.length > 0
}

/** «Вернуть 3 файла и удалить 1», or null when there is nothing to do. */
export function rewindSummary(plan: RewindPlan): string | null {
  const parts: string[] = []
  if (plan.restore.length > 0) {
    const files = plan.restore.length
    parts.push(`вернуть ${files} ${files === 1 ? 'файл' : 'файла'}`)
  }
  if (plan.remove.length > 0) {
    const files = plan.remove.length
    parts.push(`удалить ${files} ${files === 1 ? 'файл' : 'файла'}`)
  }
  const turns = plan.turnIds.length
  if (turns > 0) parts.push(`отменить ${turns} ${turns === 1 ? 'ход' : 'хода'}`)
  return parts.length > 0 ? parts.join(', ') : null
}
