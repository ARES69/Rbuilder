import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  hashForPage,
  isMultiPage,
  pageFromHash,
  pageLabel,
  previewPages,
  resolveEntryPage,
  pageRouterScript,
} from '../src/lib/pages'
import { buildPreviewDocument } from '../src/lib/project'

const html = (path: string) => ({ path, content: `<!doctype html><title>${path}</title>` })
/** `previewPages` only reads paths, but the literal is checked against it. */
const bare = (path: string) => ({ path })

describe('previewPages', () => {
  it('lists index.html first and labels the rest', () => {
    const pages = previewPages([
      html('about.html'),
      html('index.html'),
      { path: 'styles.css', content: '' },
    ])
    expect(pages.map((page) => page.path)).toEqual(['index.html', 'about.html'])
    expect(pages.map((page) => page.label)).toEqual(['index', 'about'])
  })

  it('ignores generated directories that are full of html files', () => {
    const pages = previewPages([
      bare('index.html'),
      bare('node_modules/lib/readme.html'),
      bare('dist/index.html'),
    ])
    expect(pages.map((page) => page.path)).toEqual(['index.html'])
  })

  it('knows a project is multi-page only when it really is', () => {
    expect(isMultiPage([bare('index.html')])).toBe(false)
    expect(isMultiPage([bare('index.html'), bare('about.html')])).toBe(true)
  })

  it('shortens a nested page to its file name', () => {
    expect(pageLabel('pages/about.html')).toBe('about')
  })
})

describe('resolveEntryPage', () => {
  const files = [html('about.html'), html('index.html')]

  it('opens index.html by default', () => {
    expect(resolveEntryPage(files)).toBe('index.html')
  })

  it('honours a hash so a reload or a shared link lands in the same place', () => {
    expect(resolveEntryPage(files, '#/about.html')).toBe('about.html')
  })

  it('ignores a hash for a page that no longer exists', () => {
    // The agent renamed it: falling back beats rendering nothing.
    expect(resolveEntryPage(files, '#/gone.html')).toBe('index.html')
  })

  it('opens the only page when there is no index.html', () => {
    expect(resolveEntryPage([html('about.html')])).toBe('about.html')
  })

  it('has no entry page when there is no html at all', () => {
    expect(resolveEntryPage([bare('styles.css')])).toBeNull()
  })
})

describe('page hash round-trip', () => {
  it('comes back to the path it encodes', () => {
    expect(pageFromHash(hashForPage('pages/about.html'))).toBe('pages/about.html')
  })

  it('reads an empty or unrelated fragment as no page', () => {
    expect(pageFromHash('')).toBeNull()
    expect(pageFromHash('#section')).toBeNull()
    expect(pageFromHash('#/')).toBeNull()
  })
})

describe('buildPreviewDocument with pages', () => {
  const project = {
    files: [
      html('index.html'),
      html('about.html'),
      { path: 'styles.css', content: 'body { margin: 0 }' },
    ],
  }
  const injection = { channel: 'c', script: '', pages: ['index.html', 'about.html'] }

  it('renders the page it was asked for, not always the index', () => {
    const doc = buildPreviewDocument(project, { ...injection, page: 'about.html' })
    expect(doc).toContain('about.html')
    expect(doc).not.toContain('<title>index.html</title>')
  })

  it('injects the router only when there is somewhere to navigate', () => {
    const multi = buildPreviewDocument(project, { ...injection, page: 'about.html' })
    expect(multi).toContain('__freebuffPreviewPages')

    const single = buildPreviewDocument(
      { files: [html('index.html'), { path: 'styles.css', content: '' }] },
      { channel: 'c', script: '', pages: ['index.html'] },
    )
    // A router that can navigate nowhere would only be able to break a preview
    // that works.
    expect(single).not.toContain('__freebuffPreviewPages')
  })

  it('falls back to index.html when the requested page is gone', () => {
    const doc = buildPreviewDocument(project, { ...injection, page: 'deleted.html' })
    expect(doc).toContain('<title>index.html</title>')
  })
})

describe('preview page router', () => {
  /** Boots the injected router inside a document, as the preview frame does. */
  function boot(currentPage: string, pages: string[], markup: string) {
    const dom = new JSDOM(`<!doctype html><body>${markup}`, { runScripts: 'outside-only' })
    const win = dom.window as unknown as Record<string, unknown>
    win['__freebuffChannel'] = 'test-channel'
    win['__freebuffPreviewPages'] = pages
    win['__freebuffPreviewPage'] = currentPage
    // The router posts to the parent; record what it tried to navigate to.
    const sent: Record<string, unknown>[] = []
    win['parent'] = { postMessage: (data: unknown) => sent.push(data as Record<string, unknown>) }
    // The router is injected as source text, exactly as the preview does it.
    const evaluate = win['eval'] as (code: string) => unknown
    evaluate(pageRouterScript())

    /** Clicks a link the way a user would, and returns what the router posted. */
    const click = (id: string) => {
      const before = sent.length
      const MouseEventCtor = win['MouseEvent'] as typeof MouseEvent
      dom.window.document
        .getElementById(id)!
        .dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true }))
      return sent.slice(before)
    }
    const hash = () => dom.window.location.hash

    return { win, click, hash }
  }

  it('routes a link to another page in the project', () => {
    const { click, hash } = boot(
      'index.html',
      ['index.html', 'about.html'],
      '<a id="l" href="about.html">About</a>',
    )
    const sent = click('l')

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      source: 'freebuff',
      channel: 'test-channel',
      type: 'page',
      path: 'about.html',
    })
    // The fragment tracks the page so a reload lands in the same place.
    expect(hash()).toBe('#/about.html')
  })

  it('resolves a link relative to the current page, as a browser would', () => {
    const { click } = boot('pages/one.html', ['pages/one.html', 'pages/two.html'], '<a id="l" href="two.html">Two</a>')
    expect(click('l')[0]).toMatchObject({ path: 'pages/two.html' })
  })

  it('resolves ../ in a link', () => {
    const { click } = boot(
      'pages/deep/one.html',
      ['pages/deep/one.html', 'pages/two.html'],
      '<a id="l" href="../two.html">Up</a>',
    )
    expect(click('l')[0]).toMatchObject({ path: 'pages/two.html' })
  })

  it('leaves a same-document anchor to the browser', () => {
    // An anchor must not reload the app.
    const { click } = boot('index.html', ['index.html', 'about.html'], '<a id="l" href="#section">Jump</a>')
    expect(click('l')).toHaveLength(0)
  })

  it('leaves an external link alone', () => {
    const { click } = boot('index.html', ['index.html', 'about.html'], '<a id="l" href="https://example.com">Out</a>')
    expect(click('l')).toHaveLength(0)
  })

  it('leaves a dead link to the browser so the model sees it is broken', () => {
    const { click } = boot('index.html', ['index.html', 'about.html'], '<a id="l" href="gone.html">Gone</a>')
    expect(click('l')).toHaveLength(0)
  })
})