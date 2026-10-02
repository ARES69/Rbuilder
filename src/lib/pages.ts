/**
 * Multi-page projects in the preview.
 *
 * A `srcdoc` document has no URL, so a link to `about.html` resolves against the
 * parent and either navigates the whole app or does nothing at all. Instead the
 * preview stays a single document and swaps its own contents: a click on an
 * in-project page is caught here, the new page is built, and the frame is
 * replaced. The URL fragment tracks the page, so the browser's back button and
 * a reload land in the same place.
 *
 * Everything here is pure. `buildPreviewDocument` calls it, and the tests call
 * it directly, which keeps the routing rules out of the iframe.
 */

/** The fragment that carries the page path, e.g. `#/pages/about.html`. */
export const PAGE_HASH_PREFIX = '#/'

export type PageLink = {
  /** Project path of the page. */
  path: string
  /** Short label for a page picker: `about.html` becomes `about`. */
  label: string
}

/**
 * Every HTML file in the project, `index.html` first.
 *
 * Only real pages are listed: a file under `node_modules` or a build directory
 * is not a page anyone means to open, and the picker would be full of them.
 */
export function previewPages(files: { path: string }[]): PageLink[] {
  const pages = files
    .filter((file) => isHtml(file.path) && !isIgnoredPage(file.path))
    .map((file) => ({ path: file.path, label: pageLabel(file.path) }))
    .sort((a, b) => {
      // The entry page leads the list: it is what the preview opens on.
      const aIndex = isIndexPath(a.path)
      const bIndex = isIndexPath(b.path)
      if (aIndex !== bIndex) return aIndex ? -1 : 1
      return a.path.localeCompare(b.path)
    })
  return pages
}

/** True when the project has more than one page worth offering. */
export function isMultiPage(files: { path: string }[]): boolean {
  return previewPages(files).length > 1
}

export function isHtml(path: string): boolean {
  return /\.html?$/i.test(path)
}

export function isIndexPath(path: string): boolean {
  return path.replace(/^\.\//, '').toLowerCase() === 'index.html'
}

/** `pages/about.html` -> `about`; `index.html` -> `index`. */
export function pageLabel(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.html?$/i, '')
}

/** Directories that never contain a page the user means to open. */
const IGNORED_SEGMENTS = ['node_modules', 'dist', 'build', 'out', '.git', 'coverage']

function isIgnoredPage(path: string): boolean {
  const segments = path.replace(/^\.\//, '').split('/')
  return segments.some((segment) => IGNORED_SEGMENTS.includes(segment))
}

/**
 * The page to open on.
 *
 * A fragment like `#/pages/about.html` wins so a reload or a shared link lands
 * where the user was. Otherwise it is `index.html` when it exists, and failing
 * that the first page found — a project with only `about.html` should still show
 * something rather than the empty state.
 */
export function resolveEntryPage(files: { path: string }[], hash = ''): string | null {
  const pages = previewPages(files)
  if (pages.length === 0) return null

  const fromHash = pageFromHash(hash)
  if (fromHash && pages.some((page) => page.path === fromHash)) return fromHash

  return pages.find((page) => isIndexPath(page.path))?.path ?? pages[0]!.path
}

/** `#/pages/about.html` -> `pages/about.html`. Empty when the hash is not one. */
export function pageFromHash(hash: string): string | null {
  const cleaned = hash.trim()
  if (!cleaned.startsWith(PAGE_HASH_PREFIX)) return null
  const path = cleaned.slice(PAGE_HASH_PREFIX.length).trim()
  return path || null
}

/** `pages/about.html` -> `#/pages/about.html`. */
export function hashForPage(path: string): string {
  return `${PAGE_HASH_PREFIX}${path.replace(/^\.?\//, '')}`
}

/**
 * The click interceptor injected into the preview document.
 *
 * It catches clicks on links that point at another page of the same project and
 * posts the target to the parent, which rebuilds the frame. Same-document
 * anchors (`#section`) and external links are left alone: an anchor must not
 * reload the app, and an external link is none of the preview's business.
 *
 * Declared at module scope and stringified, like the inspector runtime, rather
 * than written inline in a template literal: nesting a regex inside a template
 * string turns every escape into a parsing problem.
 *
 * Keep the body free of module-scope references — it is evaluated inside the
 * preview, where nothing outside the document exists.
 */
function previewPageRouter(): void {
  const scope = window as unknown as Record<string, unknown>
  const channel =
    typeof scope['__freebuffChannel'] === 'string' ? String(scope['__freebuffChannel']) : 'preview'
  const pages = Array.isArray(scope['__freebuffPreviewPages'])
    ? (scope['__freebuffPreviewPages'] as string[])
    : []
  const prefix = '#/'

  /** Resolves a link's href against the current page, as a browser would. */
  function toProjectPath(href: string, currentPage: string): string | null {
    if (!href || href.startsWith('#')) return null
    // Absolute and protocol URLs belong to the browser, not to us.
    if (/^(https?:)?\/\//i.test(href) || /^(mailto|tel|data|javascript):/i.test(href)) return null

    const withoutQuery = href.split('#')[0]!.split('?')[0]!
    if (!withoutQuery) return null

    if (withoutQuery.startsWith('/')) return withoutQuery.slice(1) || null

    const base = currentPage.includes('/')
      ? currentPage.slice(0, currentPage.lastIndexOf('/') + 1)
      : ''
    const stack: string[] = []
    for (const segment of (base + withoutQuery).split('/')) {
      if (segment === '' || segment === '.') continue
      if (segment === '..') stack.pop()
      else stack.push(segment)
    }
    return stack.join('/') || null
  }

  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      const target = event.target as Element | null
      const anchor = target && target.closest ? target.closest('a[href]') : null
      if (!anchor) return

      const href = anchor.getAttribute('href') ?? ''
      const path = toProjectPath(href, String(scope['__freebuffPreviewPage'] ?? ''))
      if (!path) return

      // A link to a page that exists in the project is ours to route; anything
      // else (a dead link, an asset) keeps the browser's default behaviour, so
      // the model sees the same broken link a user would.
      if (pages.indexOf(path) < 0) return

      event.preventDefault()
      // Through the location object, not a computed key on the window: writing
      // `scope['location.hash']` would create a property with that literal name
      // and the fragment would never change.
      const location = scope['location'] as { hash?: string } | undefined
      if (location) location.hash = prefix + path
      const parent = scope['parent'] as { postMessage?: (data: unknown, target: string) => void }
      parent?.postMessage?.({ source: 'freebuff', channel, type: 'page', path }, '*')
    },
    true,
  )
}

export function pageRouterScript(): string {
  return `(${previewPageRouter.toString()})()`
}