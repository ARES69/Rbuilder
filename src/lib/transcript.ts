/**
 * How the transcript is grouped for display.
 *
 * A model that cannot finish a turn tends to answer the next attempt with the
 * very same sentence. Printed as separate turns, four identical paragraphs bury
 * everything else and read as four different results. What the chat needs to
 * say about them is one answer, and how many times it came back.
 */

import type { ChatMessage } from './store'

/** One row of the transcript: the message shown, and how many copies of it there were. */
export type TranscriptRow = { message: ChatMessage; repeats: number }

/** Whether a message is plain enough that an identical neighbour says nothing new. */
function isPlain(message: ChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    message.status !== 'streaming' &&
    message.content.trim().length > 0 &&
    !message.tools?.length &&
    !message.files?.length &&
    !message.attachments?.length
  )
}

/**
 * Collapses consecutive identical assistant messages into one row per run.
 *
 * Only runs of plain messages collapse. Anything that ran a tool, wrote a file
 * or carried an attachment is a turn of its own, however alike the words are,
 * so a plain copy never merges into such a turn.
 */
export function collapseRepeats(messages: ChatMessage[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  for (const message of messages) {
    const previous = rows[rows.length - 1]
    const same =
      isPlain(message) &&
      previous !== undefined &&
      isPlain(previous.message) &&
      previous.message.role === message.role &&
      previous.message.content.trim() === message.content.trim()
    if (same && previous) {
      previous.repeats += 1
      continue
    }
    rows.push({ message, repeats: 1 })
  }
  return rows
}