/**
 * Parent side of the preview runtime. Holds the event log (console, errors,
 * failed requests), sends inspect/click/type/evaluate requests to the current
 * frame and matches replies by id + channel, so replies from a frame that has
 * already been replaced are dropped.
 */

import { MAX_EVENTS } from './previewRuntime'
import type { Project } from './project'

export type PreviewEvent = {
  id: number
  at: number
  kind: 'console' | 'error' | 'network'
  level?: string
  text: string
  detail?: string
}

export type PreviewSnapshot = {
  title: string
  size: { width: number; height: number }
  documentHeight: number
  bodyText: string
  outline: string[]
  console: string[]
  errors: string[]
  failedRequests: string[]
  eventCount: number
}

export type InteractResult = {
  ok?: boolean
  reason?: string
  matched?: { tag: string; text: string; selector: string } | null
  value?: string
  after?: {
    errors: string[]
    console: string[]
    failedRequests: string[]
    outline: string[]
    bodyText: string
  }
}

type Pending = {
  resolve: (value: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT = 2500
const REQUEST_BUDGET = 9000
const READY_TIMEOUT = 1200
const READY_POLL = 40

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Dev-only breadcrumb trail; see window.__freebuffTrace in the browser. */
function trace(event: string, detail: Record<string, unknown>): void {
  if (!import.meta.env?.DEV) return
  const scope = globalThis as unknown as { __freebuffTrace?: unknown[] }
  scope.__freebuffTrace ??= []
  scope.__freebuffTrace.push({ event, at: Date.now(), ...detail })
  if (scope.__freebuffTrace.length > 200) scope.__freebuffTrace.shift()
}

export class PreviewInspector {
  /**
   * Channel of the current document. A new channel is minted for every rebuild,
   * so replies from the frame that was just replaced are ignored instead of
   * being mistaken for the current preview.
   */
  private channel: string
  private frame: HTMLIFrameElement | null = null
  private pending = new Map<string, Pending>()
  private listeners = new Set<() => void>()
  private eventLog: PreviewEvent[] = []
  private counter = 0
  /** Attach count at which the current document announced itself as ready. */
  private readyAt = -1
  private attachCount = 0

  constructor(channel = '') {
    this.channel = channel
  }

  /**
   * Starts listening for messages from the preview. This belongs in an effect
   * rather than the constructor: React's development mode mounts, unmounts and
   * mounts again, so a listener registered once and torn down in that cycle left
   * the inspector deaf — it still posted requests and simply never heard the
   * answers, which looked exactly like a preview that had stopped responding.
   * Returns the unsubscribe function an effect should hand back.
   */
  connect(): () => void {
    window.addEventListener('message', this.onMessage)
    return () => window.removeEventListener('message', this.onMessage)
  }

  dispose(): void {
    window.removeEventListener('message', this.onMessage)
    this.pending.clear()
    this.listeners.clear()
    this.frame = null
  }

  /**
   * Declares which document the next request belongs to. Called when a rebuild
   * starts, before the new frame has mounted, so a request made during the swap
   * waits for the new document instead of reading the one it replaces.
   */
  expect(channel: string): void {
    if (this.channel === channel) return
    this.channel = channel
    this.readyAt = -1
  }

  /** Called whenever the preview rebuilds: the previous document is gone. */
  attach(frame: HTMLIFrameElement | null, channel?: string): void {
    this.frame = frame
    if (channel) this.channel = channel
    this.attachCount += 1
    this.eventLog = []
    this.emit()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get events(): PreviewEvent[] {
    return this.eventLog
  }

  get isReady(): boolean {
    return this.readyAt === this.attachCount
  }

  /**
   * Resolves once the current document's runtime is listening, or after the
   * timeout. Writing files rebuilds the preview, so anything that talks to the
   * frame has to wait for the new document rather than the one it replaced.
   */
  async waitUntilReady(timeout = READY_TIMEOUT): Promise<boolean> {
    const started = Date.now()
    const expected = this.attachCount

    while (Date.now() - started < timeout) {
      if (this.readyAt === expected) return true
      if (this.attachCount !== expected) return false
      await delay(READY_POLL)
    }

    return this.readyAt === this.attachCount
  }

  get problems(): PreviewEvent[] {
    return this.eventLog.filter((event) => event.kind === 'error' || event.kind === 'network')
  }

  clear(): void {
    this.eventLog = []
    this.emit()
    void this.request('reset').catch(() => undefined)
  }

  /** Formats the capture log for the panel and for "fix this" turns. */
  formatEventLog(limit = 20): string {
    if (this.eventLog.length === 0) return ''
    return this.eventLog
      .slice(-limit)
      .map((event) => {
        const label = event.kind === 'console' ? (event.level ?? 'log') : event.kind
        const detail = event.detail ? ` (${event.detail})` : ''
        return `[${label}] ${event.text}${detail}`
      })
      .join('\n')
  }

  async inspect(includeConsole = true, channel?: string): Promise<PreviewSnapshot> {
    return (await this.request('inspect', { includeConsole }, channel)) as PreviewSnapshot
  }

  async interact(
    action: 'click' | 'type' | 'press',
    payload: { target?: string; text?: string; key?: string; submit?: boolean },
    channel?: string,
  ): Promise<InteractResult> {
    return (await this.request(action, payload, channel)) as InteractResult
  }

  async evaluate(expression: string, channel?: string): Promise<string> {
    const result = (await this.request('evaluate', { expression }, channel)) as { result?: string }
    return result?.result ?? ''
  }

  /**
   * Sends a request to the frame that owns `channel` and retries until the
   * budget runs out. Writing files replaces the document, so a request can
   * legitimately land on a frame that is being torn down: replies from any other
   * document are ignored, and the retry reaches the new one as soon as it is up.
   */
  async request(
    action: string,
    payload: Record<string, unknown> = {},
    channel?: string,
  ): Promise<unknown> {
    if (channel) this.expect(channel)

    const deadline = Date.now() + REQUEST_BUDGET
    let attempt = 0
    let lastError: Error | undefined

    while (Date.now() < deadline) {
      attempt += 1
      const expected = this.attachCount

      // An advisory hint only: a missed "ready" must not block the request.
      if (!this.isReady && attempt === 1) await this.waitUntilReady(READY_TIMEOUT)
      if (this.attachCount !== expected) continue

      try {
        return await this.post(action, payload, Math.min(REQUEST_TIMEOUT, deadline - Date.now()))
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        // Learn from it: this document has not answered yet.
        this.readyAt = -1
        await delay(200)
      }
    }

    throw lastError ?? new Error(`The preview did not answer "${action}".`)
  }

  private post(
    action: string,
    payload: Record<string, unknown>,
    timeout = REQUEST_TIMEOUT,
  ): Promise<unknown> {
    const target = this.frame?.contentWindow
    if (!target) throw new Error('The preview is not running yet.')

    this.counter += 1
    const id = `req_${this.counter}_${Date.now().toString(36)}`

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`The preview did not answer "${action}" in time.`))
      }, Math.max(500, timeout))
      this.pending.set(id, { resolve, timer })
    })

    trace('post', { action, id, channel: this.channel, attachCount: this.attachCount })
    target.postMessage({ source: 'freebuff-parent', channel: this.channel, id, action, payload }, '*')
    return promise
  }

  private onMessage = (event: MessageEvent): void => {
    const data = event.data as Record<string, any> | null
    if (data?.source === 'freebuff') {
      trace('receive', {
        kind: data.kind,
        channel: data.channel,
        mine: data.channel === this.channel,
        attachCount: this.attachCount,
      })
    }
    if (!data || data.source !== 'freebuff' || data.channel !== this.channel) return

    if (data.kind === 'ready') {
      this.readyAt = this.attachCount
      this.emit()
      return
    }

    if (data.kind === 'event' && data.event) {
      this.eventLog.push(data.event as PreviewEvent)
      if (this.eventLog.length > MAX_EVENTS) {
        this.eventLog.splice(0, this.eventLog.length - MAX_EVENTS)
      }
      this.emit()
      return
    }

    if (data.kind === 'response' && typeof data.id === 'string') {
      const pending = this.pending.get(data.id)
      if (!pending) return
      this.pending.delete(data.id)
      clearTimeout(pending.timer)
      pending.resolve(data)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

/**
 * The channel is derived from the project, not random: the document that is on
 * screen carries exactly the channel of the project it was built from, so a
 * request aimed at a newer (or older) build is provably misdirected and its
 * reply is dropped instead of being mistaken for the current preview.
 */
export function channelFor(project: Project): string {
  let hash = 0x811c9dc5
  for (const file of project.files) {
    hash = step(hash, file.path)
    hash = step(hash, String(file.content.length))
    hash = step(hash, file.content)
  }
  return `ch_${(hash >>> 0).toString(36)}_${project.files.length}`
}

function step(hash: number, value: string): number {
  let next = hash
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index)
    next = Math.imul(next, 0x01000193)
  }
  return next
}
