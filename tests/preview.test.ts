/**
 * @vitest-environment jsdom
 *
 * The runtime runs inside the preview document, so each test gets its own DOM:
 * the script attaches listeners to its window and a shared window would let a
 * previous instance answer the current test's requests. The global jsdom window
 * is used for the inspector tests, which only need message plumbing.
 */

import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { PreviewInspector } from '../src/lib/inspector'
import { RUNTIME_SCRIPT } from '../src/lib/previewRuntime'

const CHANNEL = 'test-channel'

type Posted = Record<string, any>

type Booted = {
  window: JSDOM['window']
  posted: Posted[]
}

type BootOptions = {
  /** Where the desktop shell serves the API; unset in the browser. */
  apiBase?: string
  /** Replaces window.fetch before the runtime wraps it. */
  fetchImpl?: (input: unknown) => Promise<unknown>
}

function boot(
  body = '<h1>Timer</h1><button id="start">Start</button><input id="label" placeholder="Name" />',
  options: BootOptions = {},
): Booted {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    runScripts: 'outside-only',
  })
  const { window } = dom

  // jsdom has no layout: without this every element measures 0x0 and counts as hidden.
  window.Element.prototype.getBoundingClientRect = () =>
    ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 }) as DOMRect

  const posted: Posted[] = []
  window.addEventListener('message', (event) => posted.push((event as MessageEvent).data))

  const scope = window as unknown as Record<string, unknown>
  scope['__freebuffChannel'] = CHANNEL
  if (options.apiBase) scope['__freebuffApiBase'] = options.apiBase
  if (options.fetchImpl) scope['fetch'] = options.fetchImpl
  window.eval(RUNTIME_SCRIPT)

  return { window, posted }
}

/** jsdom delivers postMessage asynchronously, so events need a moment to arrive. */
async function waitFor(check: () => boolean, timeout = 1000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeout) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function ask(booted: Booted, action: string, payload: Record<string, unknown> = {}): Promise<Posted> {
  const { window } = booted
  const id = `req_${Math.random().toString(36).slice(2)}`

  return new Promise<Posted>((resolve) => {
    const listener = (event: Event) => {
      const data = (event as MessageEvent).data as Posted
      if (data?.kind === 'response' && data.id === id) {
        window.removeEventListener('message', listener)
        resolve(data)
      }
    }
    window.addEventListener('message', listener)

    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: { source: 'freebuff-parent', channel: CHANNEL, id, action, payload },
      }),
    )
  })
}

describe('preview runtime network', () => {
  it('keeps /api calls on the page origin in the browser', async () => {
    const seen: string[] = []
    const booted = boot('<h1>x</h1>', {
      fetchImpl: async (input) => {
        seen.push(String(input))
        return { ok: true, status: 200 }
      },
    })

    await (booted.window as unknown as { fetch: (input: string) => Promise<unknown> }).fetch('/api/proxy')
    expect(seen).toEqual(['/api/proxy'])
  })

  it('sends /api calls to the injected local server in the desktop build', async () => {
    const seen: string[] = []
    const booted = boot('<h1>x</h1>', {
      apiBase: 'http://127.0.0.1:5185/',
      fetchImpl: async (input) => {
        seen.push(String(input))
        return { ok: true, status: 200 }
      },
    })

    const call = (input: string): Promise<unknown> =>
      (booted.window as unknown as { fetch: (value: string) => Promise<unknown> }).fetch(input)

    await call('/api/proxy')
    await call('/assets/app.js')
    expect(seen).toEqual(['http://127.0.0.1:5185/api/proxy', '/assets/app.js'])
  })
})

describe('preview runtime', () => {
  it('announces itself with a ready message', async () => {
    const { posted } = boot()
    await waitFor(() => posted.length > 0)

    expect(posted[0]).toMatchObject({ source: 'freebuff', channel: CHANNEL, kind: 'ready' })
  })

  it('captures console output and errors as events', async () => {
    const booted = boot()

    booted.window.console.log('hello from the app')
    booted.window.dispatchEvent(
      new booted.window.ErrorEvent('error', { message: 'boom', lineno: 3, colno: 1 }),
    )

    const events = () =>
      booted.posted.filter((entry) => entry.kind === 'event').map((entry) => entry.event)

    await waitFor(() => events().length >= 2)

    expect(events().some((event) => event.kind === 'console' && event.text === 'hello from the app')).toBe(true)
    expect(events().some((event) => event.kind === 'error' && event.text === 'boom')).toBe(true)
  })

  it('answers inspect with the page outline, console and errors', async () => {
    const booted = boot()
    booted.window.console.warn('careful')

    const response = await ask(booted, 'inspect')
    const outline = response.outline.join('\n')

    expect(response.title).toBeDefined()
    expect(outline).toContain('Start')
    expect(outline).toContain('#start')
    expect(outline).toContain('placeholder="Name"')
    expect(response.console.join('\n')).toContain('[warn] careful')
    expect(response.errors).toEqual([])
  })

  it('clicks an element by its visible text and reports what changed', async () => {
    const booted = boot()
    const button = booted.window.document.querySelector('#start')!
    let clicks = 0
    button.addEventListener('click', () => {
      clicks += 1
      booted.window.console.log('started')
    })

    const response = await ask(booted, 'click', { target: 'Start' })

    expect(clicks).toBe(1)
    expect(response.ok).toBe(true)
    expect(response.matched).toMatchObject({ tag: 'button', text: 'Start' })
    expect(response.after.console.join('\n')).toContain('started')
  })

  it('types into a field', async () => {
    const booted = boot()

    const response = await ask(booted, 'type', { target: '#label', text: 'Pomodoro' })

    expect(response.ok).toBe(true)
    expect(response.value).toBe('Pomodoro')
    expect(booted.window.document.querySelector<HTMLInputElement>('#label')!.value).toBe('Pomodoro')
  })

  it('reports a clear reason when nothing matches', async () => {
    const booted = boot()

    const response = await ask(booted, 'click', { target: 'Nope' })

    expect(response.ok).toBe(false)
    expect(response.reason).toContain('Nothing matched')
  })

  it('evaluates an expression in the page', async () => {
    const booted = boot()

    const response = await ask(booted, 'evaluate', { expression: '1 + 1' })

    expect(response.result).toBe('2')
  })

  it('ignores requests addressed to another channel', () => {
    const booted = boot()

    booted.window.dispatchEvent(
      new booted.window.MessageEvent('message', {
        data: { source: 'freebuff-parent', channel: 'someone-else', id: 'x', action: 'inspect' },
      }),
    )

    expect(booted.posted.filter((entry) => entry.kind === 'response')).toEqual([])
  })
})

describe('PreviewInspector', () => {
  function inspectorWith(echo: (data: Posted) => Posted | null): PreviewInspector {
    const inspector = new PreviewInspector(CHANNEL)
    const frame = {
      contentWindow: {
        postMessage: (data: Posted) => {
          const reply = echo(data)
          if (reply) window.dispatchEvent(new MessageEvent('message', { data: reply }))
        },
      },
    } as unknown as HTMLIFrameElement

    inspector.attach(frame)
    // An effect in App calls connect(); without it no reply would ever arrive,
    // which is exactly the failure this test suite exists to prevent.
    inspector.connect()
    return inspector
  }

  it('matches replies to the request that asked for them', async () => {
    const inspector = inspectorWith((data) => ({
      source: 'freebuff',
      channel: CHANNEL,
      kind: 'response',
      id: data.id,
      title: 'Pomodoro',
    }))

    const snapshot = await inspector.inspect()
    expect(snapshot.title).toBe('Pomodoro')
    inspector.dispose()
  })

  it('answers again after a mount, unmount and mount cycle', async () => {
    const inspector = new PreviewInspector(CHANNEL)
    const frame = {
      contentWindow: {
        postMessage: (data: Posted) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { source: 'freebuff', channel: CHANNEL, kind: 'response', id: data.id, title: 'Timer' },
            }),
          )
        },
      },
    } as unknown as HTMLIFrameElement

    inspector.attach(frame)
    // React's development mode runs every effect, cleans it up, and runs it
    // again. The inspector must be listening after the second run.
    const stop = inspector.connect()
    stop()
    inspector.connect()

    const snapshot = await inspector.inspect()
    expect(snapshot.title).toBe('Timer')
    inspector.dispose()
  })

  it('records events and counts problems', () => {
    const inspector = inspectorWith(() => null)

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          source: 'freebuff',
          channel: CHANNEL,
          kind: 'event',
          event: { id: 1, at: Date.now(), kind: 'error', text: 'Boom' },
        },
      }),
    )

    expect(inspector.events).toHaveLength(1)
    expect(inspector.problems).toHaveLength(1)
    expect(inspector.formatEventLog()).toContain('[error] Boom')

    inspector.dispose()
  })

  it('ignores events from a frame that has already been replaced', () => {
    const inspector = inspectorWith(() => null)

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          source: 'freebuff',
          channel: 'stale',
          kind: 'event',
          event: { id: 1, at: Date.now(), kind: 'console', text: 'old' },
        },
      }),
    )

    expect(inspector.events).toHaveLength(0)
    inspector.dispose()
  })
})
