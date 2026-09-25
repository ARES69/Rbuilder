import { describe, expect, it } from 'vitest'
import { formatChecks, runChecks, summarizeChecks } from '../src/lib/checks'
import type { Project } from '../src/lib/project'

function project(files: Record<string, string>): Project {
  return { files: Object.entries(files).map(([path, content]) => ({ path, content })) }
}

const goodHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Timer</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <h1>Timer</h1>
    <button id="start">Start</button>
    <script src="app.js"></script>
  </body>
</html>
`

describe('runChecks', () => {
  it('passes a well-formed project', () => {
    const result = runChecks(
      project({ 'index.html': goodHtml, 'styles.css': 'h1 { color: red }', 'app.js': 'const a = 1' }),
    )

    expect(result.findings).toEqual([])
    expect(result.files).toBe(3)
    expect(summarizeChecks(result)).toContain('no problems found')
  })

  it('reports a missing index.html', () => {
    const result = runChecks(project({ 'styles.css': 'body {}' }))

    expect(result.findings[0]).toMatchObject({ level: 'error', file: 'index.html' })
  })

  it('reports a mismatched closing tag against the line that opened it', () => {
    const result = runChecks(
      project({ 'index.html': '<!doctype html>\n<html>\n<body>\n<div>\n</body>\n</html>' }),
    )

    const mismatch = result.findings.find((finding) => finding.message.includes('closes <div>'))
    expect(mismatch).toMatchObject({ level: 'error', line: 5 })
    expect(mismatch?.message).toContain('line 4')
  })

  it('reports elements that are never closed', () => {
    const result = runChecks(
      project({ 'index.html': '<!doctype html>\n<html>\n<body>\n<div>\n</div>' }),
    )

    const unclosed = result.findings.find((finding) => finding.message.includes('never closed'))
    expect(unclosed).toMatchObject({ level: 'error', file: 'index.html' })
    expect(result.findings.map((finding) => finding.message)).toContain('<body> is never closed.')
  })

  it('reports a stray closing tag', () => {
    const result = runChecks(
      project({ 'index.html': '<!doctype html>\n<html><body>\n</section>\n</body></html>' }),
    )

    expect(result.findings.some((finding) => finding.message.includes('closes nothing'))).toBe(true)
  })

  it('reports a JavaScript syntax error with a line number', () => {
    const result = runChecks(
      project({
        'index.html': goodHtml,
        'styles.css': 'body {}',
        'app.js': 'const a = 1\nfunction broken( {\n',
      }),
    )

    const syntax = result.findings.find((finding) => finding.message.includes('syntax error'))
    expect(syntax).toMatchObject({ file: 'app.js', level: 'error' })
    // "Unexpected end of input" can only be on the last line of code.
    expect(syntax?.line).toBe(2)
  })

  it('checks inline scripts too', () => {
    const result = runChecks(
      project({
        'index.html': '<!doctype html>\n<html><body>\n<script>\nconst = broken\n</script>\n</body></html>',
      }),
    )

    expect(result.findings.some((finding) => finding.message.includes('syntax error'))).toBe(true)
  })

  it('reports unbalanced CSS braces', () => {
    const result = runChecks(project({ 'index.html': goodHtml, 'styles.css': 'h1 { color: red' }))

    expect(result.findings.some((finding) => finding.file === 'styles.css')).toBe(true)
  })

  it('reports references to files that do not exist', () => {
    const result = runChecks(
      project({ 'index.html': goodHtml.replace('app.js', 'missing.js'), 'styles.css': 'body {}' }),
    )

    expect(
      result.findings.some(
        (finding) => finding.level === 'warning' && finding.message.includes('missing.js'),
      ),
    ).toBe(true)
  })

  it('formats findings for the model', () => {
    const result = runChecks(project({ 'index.html': '<html><body></body></html>' }))
    const text = formatChecks(result)

    expect(text).toContain('Checks found')
    expect(text).toMatch(/error: index\.html/)
  })
})
