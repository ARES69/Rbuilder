/**
 * Search-and-replace edits: the model changes a few lines of a file instead of
 * rewriting it whole. Rewriting a 400-line app to move one number costs more
 * output tokens than the whole conversation, and it invites the model to drift
 * in the parts it was not asked to touch — this is the cheapest large win in
 * the whole protocol.
 *
 * The wire format is a fenced block per file with one or more pairs:
 *
 *   ```edit:app.js
 *   <<<<<<< SEARCH
 *   const seconds = 60
 *   =======
 *   const seconds = 25
 *   >>>>>>> REPLACE
 *   ```
 *
 * A pair whose SEARCH text is not in the file is never applied: a silent
 * near-miss would write a file the model never intended, so the failure is
 * reported back to the model instead.
 */

export type FileEdit = { search: string; replace: string }

/** Everything one ```edit:path block asks to change in one file. */
export type EditBlock = { path: string; edits: FileEdit[] }

export type EditFailure = { path: string; reason: string }

export type EditResolution = {
  /** Whole new file contents, ready to apply like any write. */
  writes: { path: string; content: string }[]
  /** Pairs that did not match; the model is told which and why. */
  failures: EditFailure[]
}

export type EditApplication =
  | { ok: true; content: string; replacements: number }
  | { ok: false; reason: string }

const searchOpen = /^(?:<{7}|\={7})\s*SEARCH\s*$/i
const searchClose = /^(?:>{7}|\={7})\s*REPLACE\s*$/i
const separator = /^={7,}\s*$/

/**
 * Reads the pairs out of one edit block body. A pair is either marked
 * (`<<<<<<< SEARCH` … `=======` … `>>>>>>> REPLACE`) or bare, where the block
 * simply holds the old text, a `=======` line and the new text — the shape
 * models produce when they drop the markers.
 */
export function parseEditBody(body: string): FileEdit[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const edits: FileEdit[] = []

  // No markers at all: the block is one pair split by a bare `=======` line.
  // Models produce this shape when they drop the SEARCH/REPLACE words.
  if (!lines.some((line) => searchOpen.test(line.trim()))) {
    const cut = lines.findIndex((line) => separator.test(line.trim()))
    if (cut >= 0) {
      const pair = { search: join(lines.slice(0, cut)), replace: join(lines.slice(cut + 1)) }
      return pair.search.trim() ? [pair] : []
    }
  }

  let search: string[] | null = null
  let replace: string[] | null = null

  const close = () => {
    if (search && replace) edits.push({ search: join(search), replace: join(replace) })
    search = null
    replace = null
  }

  for (const line of lines) {
    if (searchOpen.test(line.trim())) {
      // A stray marker inside a pair means the previous one was never closed.
      if (search || replace) close()
      search = []
      continue
    }

    if (searchClose.test(line.trim())) {
      close()
      continue
    }

    if (separator.test(line.trim()) && search) {
      replace = []
      continue
    }

    if (replace) replace.push(line)
    else if (search) search.push(line)
  }

  close()

  return edits.filter((edit) => edit.search.trim().length > 0)
}

/** Applies every pair in order; stops at the first one that does not match. */
export function applyEdits(content: string, edits: FileEdit[]): EditApplication {
  const lines = normalize(content).split('\n')
  let replacements = 0

  for (const edit of edits) {
    const needle = normalize(edit.search).split('\n')
    const fresh = normalize(edit.replace).split('\n')

    if (needle.every((line) => line.trim() === '')) {
      return { ok: false, reason: 'the SEARCH fragment is empty' }
    }

    // Exact first, then a whitespace-tolerant pass: models re-indent snippets
    // constantly, and refusing a change because of two spaces is unhelpful.
    const hits = findAll(lines, needle, false)
    const matches = hits.length > 0 ? hits : findAll(lines, needle, true)

    if (matches.length === 0) {
      return {
        ok: false,
        reason: `the SEARCH fragment was not found: "${firstLine(normalize(edit.search))}"`,
      }
    }

    for (const start of matches.reverse()) {
      lines.splice(start, needle.length, ...fresh)
    }
    replacements += matches.length
  }

  return { ok: true, content: lines.join('\n'), replacements }
}

/** Stable signature of one edit block, so a repeated block is not applied twice. */
export function editSignature(block: EditBlock): string {
  return `${block.path}::${JSON.stringify(block.edits)}`
}

function findAll(haystack: string[], needle: string[], loose: boolean): number[] {
  const hits: number[] = []
  if (needle.length === 0 || haystack.length < needle.length) return hits

  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matches = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      const left = haystack[start + offset]!
      const right = needle[offset]!
      if (loose ? left.trim() !== right.trim() : left !== right) {
        matches = false
        break
      }
    }
    if (matches) hits.push(start)
  }

  return hits
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

/** Drops the blank lines a fenced block picks up at its edges. */
function join(lines: string[]): string {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]!.trim() === '') start += 1
  while (end > start && lines[end - 1]!.trim() === '') end -= 1
  return lines.slice(start, end).join('\n')
}

function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim() !== '') ?? text
  return line.trim().length > 80 ? `${line.trim().slice(0, 77)}…` : line.trim()
}