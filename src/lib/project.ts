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

/**
 * A fresh project starts empty: everything the model writes lands in the folder
 * the user picked for the task, so there are no placeholder files to delete.
 */
export function emptyProject(): Project {
  return { files: [] }
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
 * Code the host injects into the preview: the runtime, its channel id, where
 * the local API answers (only the desktop build needs the last one), and the
 * compiled entry scripts when the project needed a compiler pass.
 */
export type PreviewInjection = {
  channel: string
  script: string
  apiBase?: string
  /** Project path -> compiled code, inlined in place of the raw file. */
  bundles?: Record<string, string>
  /** A compile that failed: shown in the preview instead of failing silently. */
  bundleError?: { entry: string; error: string } | null
}

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
      // A compiled entry replaces the file's own source: same path, same place
      // in the document, but already runnable by the browser.
      const body = injection?.bundles?.[file.path] ?? file.content
      return `<script ${typeAttr} data-freebuff-path="${escapeAttribute(file.path)}">\n${escapeScriptBody(
        body,
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
${apiBase}<script>${injection.script}</script>${bundleNotice(injection)}`

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

/**
 * A failed compile leaves the project unbuilt, so the preview says so instead
 * of rendering a stale or half-translated app.
 */
function bundleNotice(injection: PreviewInjection): string {
  const failure = injection.bundleError
  if (!failure) return ''
  const text = escapeHtml(`${failure.entry} не собрался:\n${failure.error}`)
  return `<pre style="position:fixed;top:0;left:0;right:0;z-index:2147483647;margin:0;padding:12px 14px;background:#7f1d1d;color:#fee2e2;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap">${text}</pre>`
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
