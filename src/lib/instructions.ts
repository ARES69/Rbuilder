/**
 * Project instructions: the standing rules a project keeps for itself.
 *
 * Every turn is a fresh, stateless request, so the model has to be told these
 * rules every time — the same way it is told what the project currently
 * contains. They live in a real file in the project root rather than in a
 * setting, so they travel with the project: the export archive, the bound
 * folder, git and the file tree all carry them, and the user can edit them by
 * hand alongside everything else.
 */

import { truncateBytes } from './attachments'

/** The file, in the project root, that holds them. */
export const INSTRUCTIONS_FILE = 'RBUILDER.md'
/** How much of the file is handed to the model per turn. */
export const MAX_INSTRUCTIONS_BYTES = 8 * 1024

type InstructionFile = { path: string; content: string }

/** True for `RBUILDER.md` in the root, whatever the case or the `./` prefix. */
export function isInstructionsPath(path: string): boolean {
  const cleaned = path.trim().replace(/^\.\//, '')
  if (cleaned.includes('/') || cleaned.includes('\\')) return false
  return cleaned.toLowerCase() === INSTRUCTIONS_FILE.toLowerCase()
}

/** The instructions the project carries, or an empty string when it has none. */
export function readInstructions(files: InstructionFile[]): string {
  return files.find((file) => isInstructionsPath(file.path))?.content.trim() ?? ''
}

/**
 * The block appended to every user message. Empty when the project has no
 * instructions, so a project without them pays nothing for the feature.
 */
export function instructionsContext(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''

  const { text, truncated } = truncateBytes(trimmed, MAX_INSTRUCTIONS_BYTES)
  return [
    `The project keeps standing instructions in ${INSTRUCTIONS_FILE}. Follow them unless the user overrides them in this message.`,
    '```project-instructions',
    text,
    truncated ? `[${INSTRUCTIONS_FILE} continues and was cut here]` : '',
    '```',
  ]
    .filter(Boolean)
    .join('\n')
}

/** The first line, for a chip that says the project has instructions. */
export function instructionsSummary(content: string, maxLength = 80): string {
  const line = content.trim().split('\n').find((entry) => entry.trim().length > 0)?.trim() ?? ''
  return line.length > maxLength ? `${line.slice(0, maxLength - 1).trimEnd()}…` : line
}
