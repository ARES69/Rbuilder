/**
 * Project checks. The generated app has no build step, so "running the checks"
 * means parsing it: HTML structure and referenced files, CSS brace balance and
 * JavaScript syntax. JavaScript is compiled with the Function constructor, which
 * parses without executing anything.
 */

import { INDEX_PATH, type Project } from './project'

export type CheckLevel = 'error' | 'warning'

export type CheckFinding = {
  level: CheckLevel
  file: string
  line?: number
  message: string
}

export type ChecksResult = {
  files: number
  findings: CheckFinding[]
  ranAt: number
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source',
  'track', 'wbr',
])

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g

export function runChecks(project: Project): ChecksResult {
  const findings: CheckFinding[] = []
  const paths = new Set(project.files.map((file) => file.path))
  const lower = new Map(project.files.map((file) => [file.path.toLowerCase(), file]))

  if (![...paths].some((path) => path.toLowerCase() === INDEX_PATH)) {
    findings.push({
      level: 'error',
      file: INDEX_PATH,
      message: 'index.html is missing, so nothing can be previewed.',
    })
  }

  for (const file of project.files) {
    const name = file.path.toLowerCase()
    if (name.endsWith('.html') || name.endsWith('.htm')) {
      checkHtml(file.path, file.content, paths, lower, findings)
    } else if (name.endsWith('.css')) {
      checkCss(file.path, file.content, findings)
    } else if (name.endsWith('.js') || name.endsWith('.mjs')) {
      checkScript(file.path, file.content, findings)
    }
  }

  return { files: project.files.length, findings, ranAt: Date.now() }
}

function checkHtml(
  path: string,
  html: string,
  paths: Set<string>,
  lower: Map<string, { path: string }>,
  findings: CheckFinding[],
): void {
  const label = path.toLowerCase() === INDEX_PATH

  if (!/^\s*<!doctype html>/i.test(html)) {
    findings.push({
      level: label ? 'error' : 'warning',
      file: path,
      line: 1,
      message: 'Missing <!doctype html>.',
    })
  }

  if (label && !/<meta[^>]+name=["']viewport["']/i.test(html)) {
    findings.push({
      level: 'warning',
      file: path,
      message: 'No viewport meta tag, so the layout will not adapt on small screens.',
    })
  }

  if (label && !/<title[\s>]/i.test(html)) {
    findings.push({ level: 'warning', file: path, message: 'No <title> element.' })
  }

  // Tag balance, ignoring comments and the contents of script/style elements.
  const trimmed = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, '$1$3')
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, '$1$3')

  const stack: { tag: string; line: number }[] = []
  TAG.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = TAG.exec(trimmed)) !== null) {
    const [, closing, rawTag, , selfClosing] = match
    const tag = rawTag!.toLowerCase()
    const line = lineAt(trimmed, match.index)

    if (VOID_ELEMENTS.has(tag) || selfClosing === '/') continue

    if (closing === '/') {
      const open = stack.pop()
      if (!open) {
        findings.push({
          level: 'error',
          file: path,
          line,
          message: `</${tag}> closes nothing.`,
        })
      } else if (open.tag !== tag) {
        findings.push({
          level: 'error',
          file: path,
          line,
          message: `</${tag}> closes <${open.tag}> opened on line ${open.line}.`,
        })
      }
      continue
    }

    stack.push({ tag, line })
  }

  for (const open of stack) {
    findings.push({
      level: 'error',
      file: path,
      line: open.line,
      message: `<${open.tag}> is never closed.`,
    })
  }

  // Relative references must exist in the project.
  const references = [
    ...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi),
    ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi),
    ...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi),
  ].map((entry) => entry[1]!)

  for (const reference of new Set(references)) {
    if (/^(https?:)?\/\//i.test(reference) || reference.startsWith('data:') || reference.startsWith('#')) {
      continue
    }
    const clean = reference.replace(/^\.\//, '').split(/[?#]/)[0]!
    if (!paths.has(clean) && !lower.has(clean.toLowerCase())) {
      findings.push({
        level: 'warning',
        file: path,
        message: `References "${reference}", which does not exist in the project.`,
      })
    }
  }

  // Inline scripts get the same syntax treatment as .js files.
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = script[1] ?? ''
    if (/\bsrc=/i.test(attrs)) continue
    const body = script[2] ?? ''
    if (!body.trim()) continue
    checkScript(path, body, findings)
  }
}

function checkCss(path: string, css: string, findings: CheckFinding[]): void {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

  if (/\/\*/.test(stripped)) {
    findings.push({ level: 'warning', file: path, message: 'Unclosed comment.' })
  }

  let depth = 0
  let firstUnbalanced = -1
  for (let index = 0; index < stripped.length; index += 1) {
    const character = stripped[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth < 0 && firstUnbalanced === -1) firstUnbalanced = index
    }
  }

  if (depth !== 0 || firstUnbalanced !== -1) {
    findings.push({
      level: 'error',
      file: path,
      line: firstUnbalanced >= 0 ? lineAt(stripped, firstUnbalanced) : undefined,
      message:
        depth > 0
          ? `${depth} unclosed block${depth === 1 ? '' : 's'} — a "{" has no matching "}".`
          : 'Unbalanced braces.',
    })
  }
}

function checkScript(path: string, code: string, findings: CheckFinding[]): void {
  if (/^\s*(import|export)\s/m.test(code)) {
    // Module syntax cannot be compiled by the Function constructor; skip it.
    return
  }

  try {
    // Compiles only: nothing in the file is executed.
    new Function(code)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    findings.push({
      level: 'error',
      file: path,
      line: syntaxErrorLine(raw, code),
      message: `JavaScript syntax error: ${raw.replace(/^SyntaxError:\s*/, '').split('\n')[0]}`,
    })
  }
}

/**
 * V8 reports Function-constructor syntax errors without a position, so the only
 * honest inference is the end of input, which is always on the last code line.
 */
function syntaxErrorLine(message: string, code: string): number | undefined {
  const direct = /<anonymous>:(\d+)/.exec(message)
  if (direct) {
    // The constructor wraps the body in two lines of scaffolding.
    return Math.max(1, Number(direct[1]) - 2)
  }

  if (!/Unexpected end of input/i.test(message)) return undefined

  const lines = code.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]!.trim()) return index + 1
  }
  return lines.length
}

function lineAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1
  }
  return line
}

export function summarizeChecks(result: ChecksResult): string {
  if (result.findings.length === 0) {
    return `Checks passed: ${result.files} file${result.files === 1 ? '' : 's'}, no problems found.`
  }
  const errors = result.findings.filter((finding) => finding.level === 'error').length
  const warnings = result.findings.length - errors
  return `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`
}

/** Compact report handed to the model as a tool result. */
export function formatChecks(result: ChecksResult): string {
  if (result.findings.length === 0) {
    return `Checks passed (${result.files} files, no problems found).`
  }

  const lines = result.findings.map((finding) => {
    const where = finding.line ? `${finding.file}:${finding.line}` : finding.file
    return `${finding.level}: ${where}: ${finding.message}`
  })

  return `Checks found ${result.findings.length} problem${result.findings.length === 1 ? '' : 's'}:\n${lines.join('\n')}`
}
