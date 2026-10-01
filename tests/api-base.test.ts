import { afterEach, describe, expect, it } from 'vitest'
import { apiBase, apiUrl, isDesktop, serverLabel } from '../src/lib/apiBase'
import { buildPreviewDocument } from '../src/lib/project'

/**
 * The desktop build serves the front end from its own scheme and the API from a
 * local process, so the injected base is the only thing that keeps the front end
 * talking to the right place. These tests pin that behaviour.
 */

const scope = globalThis as unknown as { window?: unknown }

function setWindow(value: Record<string, unknown>): void {
  scope.window = value
}

afterEach(() => {
  delete scope.window
})

describe('api base', () => {
  it('stays relative in the browser', () => {
    setWindow({})
    expect(apiBase()).toBe('')
    expect(apiUrl('/api/chat')).toBe('/api/chat')
    expect(isDesktop()).toBe(false)
  })

  it('uses the address the desktop shell injects', () => {
    setWindow({ __RBUILDER_API_BASE__: 'http://127.0.0.1:5185/' })
    expect(apiBase()).toBe('http://127.0.0.1:5185')
    expect(apiUrl('api/chat')).toBe('http://127.0.0.1:5185/api/chat')
    expect(serverLabel()).toBe('http://127.0.0.1:5185')
  })

  it('recognises the desktop shell', () => {
    setWindow({ __TAURI__: { core: {} } })
    expect(isDesktop()).toBe(true)
  })
})

describe('preview injection', () => {
  const project = {
    files: [
      { path: 'index.html', content: '<!doctype html><html><body>hi</body></html>' },
      { path: 'styles.css', content: 'body { margin: 0 }' },
    ],
  }

  it('tells the preview where the API is in the desktop build', () => {
    const document = buildPreviewDocument(project, {
      channel: 'chan',
      script: 'console.log("runtime")',
      apiBase: 'http://127.0.0.1:5185',
    })
    expect(document).toContain('window.__freebuffApiBase="http://127.0.0.1:5185"')
    expect(document).toContain('window.__freebuffChannel="chan"')
  })

  it('leaves the browser document without an API base', () => {
    const document = buildPreviewDocument(project, { channel: 'chan', script: 'console.log("runtime")' })
    expect(document).not.toContain('__freebuffApiBase')
  })
})
