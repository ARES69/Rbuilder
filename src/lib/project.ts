/**
 * The virtual project the agent edits: an in-memory file list plus the builder
 * that turns it into a single document the preview iframe can render.
 */

export type ProjectFile = { path: string; content: string }
export type Project = { files: ProjectFile[] }
export type ProjectFileInput = { path: string; content: string }

export const MAX_FILES = 40
export const MAX_FILE_BYTES = 512 * 1024
export const INDEX_PATH = 'index.html'

export const STARTER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Your app</title>
  </head>
  <body>
    <main>
      <p class="eyebrow">Live preview</p>
      <h1>Describe the app you want to build</h1>
      <p class="lede">
        RBUILDER writes the HTML, CSS and JavaScript for you. Every change lands here
        the moment it is written.
      </p>
    </main>
  </body>
</html>
`

export const STARTER_CSS = `:root {
  color-scheme: light;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #ffffff;
  color: #111111;
}

main {
  max-width: 34rem;
  padding: 3rem 2rem;
}

.eyebrow {
  margin: 0 0 1rem;
  font-size: 0.6875rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8a8a8a;
}

h1 {
  margin: 0 0 1.25rem;
  font-size: 1.75rem;
  font-weight: 500;
  line-height: 1.25;
  letter-spacing: -0.01em;
}

.lede {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.7;
  color: #515151;
}
`

export function createStarterProject(): Project {
  return {
    files: [
      { path: INDEX_PATH, content: STARTER_HTML },
      { path: 'styles.css', content: STARTER_CSS },
    ],
  }
}

/**
 * Normalizes an agent-provided path into a safe project-relative path.
 * Returns null for anything that would escape the project or is unusable.
 */
export function normalizePath(raw: string): string | null {
  let value = raw.trim().replace(/\\/g, '/')
  if (!value) return null

  value = value.split('#')[0]!.split('?')[0]!
  value = value.replace(/^\.\//, '').replace(/^\/+/, '')
  value = value.replace(/\/{2,}/g, '/')
  if (value.endsWith('/')) return null

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  if (/^[a-zA-Z]:/.test(value)) return null

  const segments = value.split('/')
  if (segments.some((segment) => segment === '..' || segment === '')) return null
  if (value.length > 200) return null

  return value
}

/**
 * Applies incoming files to the project: existing paths are replaced in place
 * (so the file order stays stable), new paths are appended.
 */
export function upsertFiles(project: Project, incoming: ProjectFileInput[]): Project {
  if (incoming.length === 0) return project

  const files = project.files.slice()
  let changed = false

  for (const entry of incoming) {
    const path = normalizePath(entry.path)
    if (!path) continue

    const content =
      entry.content.length > MAX_FILE_BYTES ? entry.content.slice(0, MAX_FILE_BYTES) : entry.content

    const index = files.findIndex((file) => file.path === path)
    if (index >= 0) {
      if (files[index]!.content !== content) {
        files[index] = { path, content }
        changed = true
      }
      continue
    }

    if (files.length >= MAX_FILES) continue
    files.push({ path, content })
    changed = true
  }

  return changed ? { files } : project
}

export function hasIndex(project: Project): boolean {
  return project.files.some((file) => file.path.toLowerCase() === INDEX_PATH)
}

export function projectFilePaths(project: Project): string[] {
  return project.files.map((file) => file.path)
}

/** Compact description of the project, handed to the model as context. */
export function projectContext(project: Project): string {
  if (project.files.length === 0) return 'The project is currently empty.'
  const lines = project.files.map(
    (file) => `- ${file.path} (${file.content.length} chars)`,
  )
  return `Current project files:\n${lines.join('\n')}`
}

function resolveReference(files: ProjectFile[], reference: string): ProjectFile | undefined {
  const cleaned = reference.trim().split('#')[0]!.split('?')[0]!.replace(/^\.\//, '')
  if (!cleaned) return undefined
  if (/^(https?:)?\/\//i.test(cleaned) || cleaned.startsWith('data:')) return undefined

  const path = normalizePath(cleaned)
  if (!path) return undefined

  return (
    files.find((file) => file.path === path) ??
    files.find((file) => file.path.toLowerCase() === path.toLowerCase())
  )
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeScriptBody(script: string): string {
  return script.replace(/<\/script/gi, '<\\/script')
}

/**
 * Code the host injects into the preview: the runtime, its channel id, and where
 * the local API answers (only the desktop build needs the last one).
 */
export type PreviewInjection = { channel: string; script: string; apiBase?: string }

/**
 * Builds the document rendered by the preview iframe. Stylesheets and scripts
 * that point at project files are inlined, because a `srcdoc` document cannot
 * resolve relative URLs. The optional runtime is injected first so it observes
 * every console call and error the app produces.
 */
export function buildPreviewDocument(project: Project, injection?: PreviewInjection): string {
  const files = project.files
  const index = files.find((file) => file.path.toLowerCase() === INDEX_PATH)
  if (!index) return fallbackDocument(files)

  // Some models write self-closing script tags; normalize so the regex below matches.
  let html = index.content.replace(/<script\b([^>]*?)\/>/gi, '<script$1></script>')

  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return tag
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
    if (!href) return tag
    const file = resolveReference(files, href)
    if (!file) return tag
    return `<style data-freebuff-path="${escapeAttribute(file.path)}">\n${file.content}\n</style>`
  })

  html = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (tag, attrs: string) => {
      const src = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]
      if (!src) return tag
      const file = resolveReference(files, src)
      if (!file) return tag
      const typeAttr = /\btype\s*=\s*["'][^"']*["']/i.exec(attrs)?.[0] ?? ''
      return `<script ${typeAttr} data-freebuff-path="${escapeAttribute(file.path)}">\n${escapeScriptBody(
        file.content,
      )}\n</script>`
    },
  )

  return injection ? injectRuntime(html, injection) : html
}

/** Puts the runtime at the top of the document so nothing escapes it. */
function injectRuntime(html: string, injection: PreviewInjection): string {
  const apiBase = injection.apiBase
    ? `<script>window.__freebuffApiBase=${JSON.stringify(injection.apiBase)};</script>\n`
    : ''
  const snippet = `<script>window.__freebuffChannel=${JSON.stringify(injection.channel)};</script>
${apiBase}<script>${injection.script}</script>`

  const head = /<head[^>]*>/i.exec(html)
  if (head) {
    const at = head.index + head[0].length
    return `${html.slice(0, at)}\n${snippet}${html.slice(at)}`
  }

  const body = /<body[^>]*>/i.exec(html)
  if (body) {
    const at = body.index + body[0].length
    return `${html.slice(0, at)}\n${snippet}${html.slice(at)}`
  }

  return `${snippet}\n${html}`
}

/** Shown when the project has no index.html yet (or the agent removed it). */
function fallbackDocument(files: ProjectFile[]): string {
  const listing =
    files.length === 0
      ? '<li>No files yet.</li>'
      : files.map((file) => `<li><code>${escapeHtml(file.path)}</code></li>`).join('')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>No preview</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #ffffff; color: #111111;
      }
      main { max-width: 30rem; padding: 3rem 2rem; }
      h1 { font-size: 1.125rem; font-weight: 500; margin: 0 0 0.75rem; }
      p { font-size: 0.875rem; line-height: 1.7; color: #515151; margin: 0 0 1.25rem; }
      ul { font-size: 0.8125rem; line-height: 1.9; color: #515151; padding-left: 1.1rem; margin: 0; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    </style>
  </head>
  <body>
    <main>
      <h1>Nothing to preview yet</h1>
      <p>Ask RBUILDER for a web app and an <code>index.html</code> will appear here.</p>
      <ul>${listing}</ul>
    </main>
  </body>
</html>
`
}
