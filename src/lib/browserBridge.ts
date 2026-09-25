export type BrowserSessionProvider = 'qwen' | 'deepseek'
export type BrowserSessionState = 'disconnected' | 'connecting' | 'connected'

export type BrowserBridgeMessage =
  | { type: 'rbuilder:connect'; requestId: string; provider: BrowserSessionProvider }
  | { type: 'rbuilder:disconnect'; requestId: string }
  | { type: 'rbuilder:status'; requestId: string }
  | { type: 'rbuilder:prompt'; requestId: string; provider: BrowserSessionProvider; prompt: string }
  | { type: 'bridge:response'; requestId: string; ok: boolean; provider?: BrowserSessionProvider; message?: string; state?: BrowserSessionState }

const CHANNEL = 'rbuilder-browser-bridge:v1'
const TIMEOUT_MS = 2500

export class BrowserBridge {
  private channel: BroadcastChannel | null = null

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') this.channel = new BroadcastChannel(CHANNEL)
  }

  async connect(provider: BrowserSessionProvider): Promise<{ ok: boolean; message: string }> {
    return this.request({ type: 'rbuilder:connect', requestId: id(), provider })
  }

  async disconnect(): Promise<{ ok: boolean; message: string }> {
    return this.request({ type: 'rbuilder:disconnect', requestId: id() })
  }

  async status(): Promise<{ ok: boolean; message: string; state?: BrowserSessionState }> {
    return this.request({ type: 'rbuilder:status', requestId: id() })
  }

  async prompt(provider: BrowserSessionProvider, prompt: string): Promise<{ ok: boolean; message: string }> {
    return this.request({ type: 'rbuilder:prompt', requestId: id(), provider, prompt })
  }

  dispose(): void {
    this.channel?.close()
    this.channel = null
  }

  private request(message: BrowserBridgeMessage): Promise<{ ok: boolean; message: string; state?: BrowserSessionState }> {
    const channel = this.channel
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        resolve({ ok: false, message: 'No RBUILDER browser extension responded.' })
      }, TIMEOUT_MS)
      const listener = (event: MessageEvent<BrowserBridgeMessage>) => {
        const response = event.data
        if (response?.type !== 'bridge:response' || response.requestId !== message.requestId) return
        window.clearTimeout(timer)
        channel?.removeEventListener('message', listener)
        cleanup()
        resolve({ ok: response.ok, message: response.message ?? (response.ok ? 'Connected.' : 'Connection failed.'), state: response.state })
      }
      channel?.addEventListener('message', listener)
      const windowListener = (event: MessageEvent<BrowserBridgeMessage>) => listener(event)
      window.addEventListener('message', windowListener)
      const cleanup = () => window.removeEventListener('message', windowListener)
      channel?.postMessage(message)
      window.postMessage({ source: 'rbuilder-browser-bridge', payload: message }, '*')
    })
  }
}

function id(): string {
  return `bridge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}
