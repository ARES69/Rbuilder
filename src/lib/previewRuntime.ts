/**
 * The script injected into the preview document. It is the app's half of the
 * "look at the running page" loop that a coding agent needs:
 *
 *   - it records console output, runtime errors, rejected promises and failed
 *     network requests into a ring buffer;
 *   - it answers requests from the parent (inspect, click, type, press,
 *     evaluate) over postMessage.
 *
 * The iframe is sandboxed without allow-same-origin, so the parent cannot touch
 * its DOM: postMessage is the only channel, and every reply echoes the channel
 * id so replies from a replaced frame are ignored.
 *
 * Keep the body free of TypeScript-only syntax: it is stringified with
 * Function.prototype.toString and evaluated inside the preview.
 */

export const CHANNEL_GLOBAL = '__freebuffChannel'
export const MAX_EVENTS = 200

declare global {
  interface Window {
    __freebuffChannel?: string
  }
}

function previewRuntime(): void {
  // Values are inlined on purpose: this function is stringified and evaluated
  // inside the preview, where module-scope identifiers do not exist.
  const scope = window as unknown as Record<string, any>
  const channel = typeof scope['__freebuffChannel'] === 'string' ? scope['__freebuffChannel'] : 'preview'

  const events: Array<Record<string, unknown>> = []
  let sequence = 0

  function push(event: Record<string, unknown>): void {
    sequence += 1
    events.push({ id: sequence, at: Date.now(), ...event })
    if (events.length > 200) events.splice(0, events.length - 200)
    post({ kind: 'event', event: events[events.length - 1] })
  }

  function post(message: Record<string, unknown>): void {
    try {
      parent.postMessage({ source: 'freebuff', channel, ...message }, '*')
    } catch {
      /* the frame is being torn down */
    }
  }

  function describe(value: unknown): string {
    try {
      if (typeof value === 'string') return value
      if (value instanceof Error) return `${value.name}: ${value.message}`
      if (typeof value === 'object' && value !== null) {
        const seen = new Set<unknown>()
        return JSON.stringify(value, (_key, item) => {
          if (typeof item === 'object' && item !== null) {
            if (seen.has(item)) return '[circular]'
            seen.add(item)
          }
          if (typeof item === 'function') return '[function]'
          return item
        })
      }
      return String(value)
    } catch {
      return '[unserializable]'
    }
  }

  /* ---------------- recording ---------------- */

  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const
  for (const level of levels) {
    const original = scope.console?.[level]
    if (typeof original !== 'function') continue
    scope.console[level] = function (...args: unknown[]) {
      original.apply(scope.console, args)
      push({ kind: 'console', level, text: args.map(describe).join(' ').slice(0, 4000) })
    }
  }

  window.addEventListener('error', (event) => {
    push({
      kind: 'error',
      level: 'error',
      text: event.message || 'Error',
      detail: `${event.filename || 'inline'}:${event.lineno || 0}:${event.colno || 0}`,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    push({ kind: 'error', level: 'error', text: `Unhandled rejection: ${describe(event.reason)}` })
  })

  if (typeof scope.fetch === 'function') {
    const originalFetch = scope.fetch
    scope.fetch = async function (input: unknown, init?: unknown) {
      const url = typeof input === 'string' ? input : describe((input as { url?: string })?.url)
      try {
        const response = await originalFetch.call(this, input, init)
        if (!response.ok) {
          push({ kind: 'network', level: 'error', text: `${response.status} ${url}` })
        }
        return response
      } catch (error) {
        push({ kind: 'network', level: 'error', text: `failed ${url}`, detail: describe(error) })
        throw error
      }
    }
  }

  if (typeof scope.XMLHttpRequest === 'function') {
    const Original = scope.XMLHttpRequest
    const open = Original.prototype.open
    const send = Original.prototype.send
    Original.prototype.open = function (method: string, url: string, ...rest: unknown[]) {
      this.__freebuffUrl = url
      return open.call(this, method, url, ...rest)
    }
    Original.prototype.send = function (...args: unknown[]) {
      this.addEventListener('error', () => {
        push({ kind: 'network', level: 'error', text: `failed ${this.__freebuffUrl || ''}` })
      })
      this.addEventListener('load', () => {
        if (this.status >= 400) {
          push({
            kind: 'network',
            level: 'error',
            text: `${this.status} ${this.__freebuffUrl || ''}`,
          })
        }
      })
      return send.apply(this, args)
    }
  }

  function reset(): void {
    events.length = 0
  }

  /* ---------------- reading the page ---------------- */

  function isVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    const style = getComputedStyle(element)
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
  }

  function textOf(element: Element): string {
    const raw = (element as HTMLElement).innerText || element.textContent || ''
    return raw.replace(/\s+/g, ' ').trim().slice(0, 120)
  }

  function selectorFor(element: Element): string {
    if (element.id) return `#${element.id}`
    const testId = element.getAttribute('data-testid')
    if (testId) return `[data-testid="${testId}"]`

    const parts: string[] = []
    let node: Element | null = element
    let depth = 0
    while (node && node.nodeType === 1 && node !== document.body && depth < 4) {
      const tag = node.tagName.toLowerCase()
      const parentNode: Element | null = node.parentElement
      let index = 1
      if (parentNode) {
        const siblings = parentNode.children
        for (let i = 0; i < siblings.length; i += 1) {
          if (siblings[i] === node) {
            index = i + 1
            break
          }
        }
      }
      parts.unshift(`${tag}:nth-child(${index})`)
      node = parentNode
      depth += 1
    }
    return parts.join(' > ')
  }

  function outline(): string[] {
    const selector =
      'h1,h2,h3,h4,h5,h6,p,li,button,a[href],input,select,textarea,img,[role],[data-testid]'
    const nodes = document.querySelectorAll(selector)
    const lines: string[] = []

    for (let i = 0; i < nodes.length && lines.length < 80; i += 1) {
      const element = nodes[i] as Element
      if (!isVisible(element)) continue

      const tag = element.tagName.toLowerCase()
      const role = element.getAttribute('role') || (tag === 'a' ? 'link' : '')
      const label = textOf(element) || element.getAttribute('aria-label') || ''
      const extra: string[] = []

      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        const type = element.getAttribute('type')
        if (type) extra.push(`type=${type}`)
        const placeholder = element.getAttribute('placeholder')
        if (placeholder) extra.push(`placeholder="${placeholder}"`)
        const value = (element as HTMLInputElement).value
        if (value) extra.push(`value="${String(value).slice(0, 40)}"`)
      }
      if (tag === 'img') extra.push(`alt="${element.getAttribute('alt') || ''}"`)
      if (tag === 'a') extra.push(`href="${(element.getAttribute('href') || '').slice(0, 60)}"`)
      if (role && role !== tag) extra.push(`role=${role}`)

      const suffix = extra.length > 0 ? ` (${extra.join(', ')})` : ''
      const shown = label ? ` "${label}"` : ''
      lines.push(`${tag}${shown}${suffix}  → ${selectorFor(element)}`)
    }

    return lines
  }

  function snapshot(includeConsole: boolean): Record<string, unknown> {
    const errors = events.filter((event) => event.kind === 'error')
    const failed = events.filter((event) => event.kind === 'network')
    const logs = includeConsole
      ? events.filter((event) => event.kind === 'console').map((event) => `[${event.level}] ${event.text}`)
      : []

    return {
      title: document.title,
      size: { width: window.innerWidth, height: window.innerHeight },
      documentHeight: document.documentElement?.scrollHeight ?? 0,
      bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600),
      outline: outline(),
      console: logs.slice(-30),
      errors: errors.map((event) => `${event.text}${event.detail ? ` (${event.detail})` : ''}`).slice(-15),
      failedRequests: failed.map((event) => event.text).slice(-15),
      eventCount: events.length,
    }
  }

  /* ---------------- acting on the page ---------------- */

  function findByText(text: string): Element | null {
    const needle = text.trim().toLowerCase()
    if (!needle) return null
    const candidates = document.querySelectorAll('button,a,li,[role="button"],input,label,summary')
    for (let i = 0; i < candidates.length; i += 1) {
      const element = candidates[i] as Element
      if (!isVisible(element)) continue
      const label = (textOf(element) || element.getAttribute('value') || '').toLowerCase()
      if (label === needle) return element
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const element = candidates[i] as Element
      if (!isVisible(element)) continue
      const label = (textOf(element) || element.getAttribute('value') || '').toLowerCase()
      if (label.includes(needle)) return element
    }
    return null
  }

  function find(target: string | undefined): Element | null {
    if (!target) return null
    try {
      const bySelector = document.querySelector(target)
      if (bySelector) return bySelector
    } catch {
      /* not a valid selector, fall through to text matching */
    }
    return findByText(target)
  }

  function clickElement(element: Element): void {
    ;(element as HTMLElement).focus?.()
    ;(element as HTMLElement).click()
  }

  function typeInto(element: Element, text: string): void {
    const field = element as HTMLInputElement
    field.focus?.()
    const prototype =
      element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (setter) setter.call(field, text)
    else field.value = text

    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function describeElement(element: Element | null): Record<string, unknown> | null {
    if (!element) return null
    return {
      tag: element.tagName.toLowerCase(),
      text: textOf(element).slice(0, 80),
      selector: selectorFor(element),
    }
  }

  function handle(request: Record<string, any>): Record<string, unknown> {
    const payload = request.payload || {}

    if (request.action === 'inspect') {
      return snapshot(payload.includeConsole !== false)
    }

    if (request.action === 'events') {
      return { events }
    }

    if (request.action === 'reset') {
      reset()
      return { ok: true }
    }

    if (request.action === 'evaluate') {
      const value = scope.eval(String(payload.expression ?? ''))
      return { result: describe(value) }
    }

    if (request.action === 'click' || request.action === 'type' || request.action === 'press') {
      const before = events.length

      if (request.action === 'click') {
        const element = find(payload.target)
        if (!element) return { ok: false, reason: `Nothing matched "${payload.target}".` }
        clickElement(element)
        return { ok: true, matched: describeElement(element), after: after(before) }
      }

      if (request.action === 'type') {
        const element = find(payload.target)
        if (!element) return { ok: false, reason: `Nothing matched "${payload.target}".` }
        typeInto(element, String(payload.text ?? ''))
        if (payload.submit) {
          element.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
          )
          const form = (element as HTMLInputElement).form
          if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        }
        return {
          ok: true,
          matched: describeElement(element),
          value: String((element as HTMLInputElement).value ?? ''),
          after: after(before),
        }
      }

      const key = String(payload.key || 'Enter')
      const active = document.activeElement || document.body
      active?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      active?.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
      return { ok: true, matched: describeElement(active), after: after(before) }
    }

    return { ok: false, reason: `Unknown action "${request.action}".` }
  }

  function after(from: number): Record<string, unknown> {
    const fresh = events.slice(from)
    return {
      errors: fresh.filter((event) => event.kind === 'error').map((event) => String(event.text)),
      console: fresh
        .filter((event) => event.kind === 'console')
        .map((event) => `[${event.level}] ${event.text}`)
        .slice(-12),
      failedRequests: fresh
        .filter((event) => event.kind === 'network')
        .map((event) => String(event.text))
        .slice(-12),
      outline: outline().slice(0, 60),
      bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as Record<string, any> | null
    if (!data || data.source !== 'freebuff-parent' || data.channel !== channel) return

    let response: Record<string, unknown>
    try {
      response = handle(data)
    } catch (error) {
      response = { ok: false, reason: describe(error) }
    }

    post({ kind: 'response', id: data.id, ...response })
  })

  post({ kind: 'ready', title: document.title })
}

export const RUNTIME_SCRIPT = `(${previewRuntime.toString()})();`
