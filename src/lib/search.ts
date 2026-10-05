/**
 * Project search — the grep the model reaches for instead of reading files one
 * by one.
 *
 * The alternative was `read_project_file` in a loop: on a project of forty
 * files, finding the one handler that touched a name meant pulling tens of
 * thousands of characters into the transcript to read a single line out of
 * them. This is deliberately the other shape: a pattern goes in, matching
 * lines come out with their line numbers, in the format grep already uses, and
 * everything is capped so a search over a big project cannot flood the turn.
 *
 * Literal text is the default, not a regular expression. A model writing
 * `useEffect(() => {` should not have to escape it, and a broken pattern
 * should come back as an answer the model can act on rather than a crash.
 */

export type SearchMatch = {
  path: string
  /** 1-based, the way an editor and a compiler count. */
  line: number
  text: string
}

export type SearchResult =
  | {
      ok: true
      matches: SearchMatch[]
      /** How many files held at least one match. */
      files: number
      /** Matches found before the cap, which can be larger than `matches`. */
      total: number
      /** True when `total` exceeds what was returned. */
      truncated: boolean
      /** Files looked at, matched or not. */
      scanned: number
    }
  | { ok: false; reason: string }

export type SearchOptions = {
  pattern: string
  /** Treat the pattern as a regular expression instead of literal text. */
  regex?: boolean
  /** Match case exactly. Off by default, the way most editors search. */
  caseSensitive?: boolean
  /** Only look at files whose path contains this text. */
  path?: string
}

/** How many matching lines one search may hand back. */
export const MAX_SEARCH_MATCHES = 60
/** How much of one long line to keep. */
export const MAX_LINE_CHARS = 200

export function searchProject(
  files: { path: string; content: string }[],
  options: SearchOptions,
): SearchResult {
  // A hand-written pattern carries incidental whitespace, and searching for
  // spaces in a JavaScript project would match every indented line and burn
  // the whole cap. Trim once, so the emptiness check and the search agree.
  const pattern = options.pattern.trim()
  if (!pattern) return { ok: false, reason: 'The pattern is empty. Pass the text to look for as `pattern`.' }

  const pathFilter = options.path?.trim().toLowerCase()
  const candidates = pathFilter
    ? files.filter((file) => file.path.toLowerCase().includes(pathFilter))
    : files

  if (pathFilter && candidates.length === 0) {
    return { ok: false, reason: `No project file has "${options.path}" in its path.` }
  }

  let matchesLine: (line: string) => boolean
  if (options.regex) {
    let expression: RegExp
    try {
      expression = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi')
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        reason:
          `The regular expression is invalid (${why}). ` +
          'Fix it, or search for the text as it is with regex: false.',
      }
    }
    matchesLine = (line) => {
      // A fresh lastIndex per line, so a /g expression cannot skip matches.
      expression.lastIndex = 0
      return expression.test(line)
    }
  } else {
    const needle = options.caseSensitive ? pattern : pattern.toLowerCase()
    matchesLine = (line) => (options.caseSensitive ? line : line.toLowerCase()).includes(needle)
  }

  const matches: SearchMatch[] = []
  let total = 0
  const hitPaths = new Set<string>()

  for (const file of candidates) {
    const lines = file.content.split('\n')
    let fileHit = false

    for (let index = 0; index < lines.length; index += 1) {
      // A file written with CRLF should not report a trailing carriage return.
      const line = lines[index]!.replace(/\r$/, '')
      if (!matchesLine(line)) continue

      total += 1
      fileHit = true
      if (matches.length >= MAX_SEARCH_MATCHES) continue
      matches.push({ path: file.path, line: index + 1, text: clip(line) })
    }

    // Counted whether or not the match made it past the cap, so the header
    // still says how many files were involved.
    if (fileHit) hitPaths.add(file.path)
  }

  return {
    ok: true,
    matches,
    files: hitPaths.size,
    total,
    truncated: total > matches.length,
    scanned: candidates.length,
  }
}

function clip(line: string): string {
  const trimmed = line.trim()
  return trimmed.length > MAX_LINE_CHARS ? `${trimmed.slice(0, MAX_LINE_CHARS - 1)}…` : trimmed
}

/** The text handed back to the model, in grep's own shape. */
export function formatSearch(result: SearchResult, pattern: string): string {
  if (!result.ok) return result.reason

  if (result.matches.length === 0) {
    return `No match for ${JSON.stringify(pattern)} in ${result.scanned} file${plural(result.scanned)}.`
  }

  const lines = result.matches.map((match) => `${match.path}:${match.line}: ${match.text}`)
  // "match" pluralises with -es, so it does not go through the same helper as
  // "file" and reads "matchs" if it does.
  const header =
    `${result.total} match${result.total === 1 ? '' : 'es'} in ${result.files} of ` +
    `${result.scanned} file${plural(result.scanned)}:`

  const notes: string[] = []
  if (result.truncated) {
    notes.push(
      `Stopped at ${result.matches.length} matches. Narrow it down with the \`path\` argument ` +
        'or a more specific pattern, then read the file you landed on.',
    )
  }

  return [header, ...lines, ...notes].join('\n')
}

function plural(count: number): string {
  return count === 1 ? '' : 's'
}
