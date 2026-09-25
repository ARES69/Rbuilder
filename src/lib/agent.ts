/**
 * Browser side of the dev-server streams. Both routes answer with
 * newline-delimited JSON; this module turns those lines into callbacks.
 * Secrets never reach the browser: only the "is a model configured" flag does.
 */

import type { AgentMode, ChatTurn, StreamEvent, ToolCall } from './protocol'

export type ProviderProfile = {
  id: string
  name: string
  kind: 'openai' | 'ollama' | 'lmstudio' | 'custom'
  baseUrl: string
  apiKey: string
  model: string
  /** Custom OpenAI-compatible route and headers. */
  chatPath?: string
  modelsPath?: string
  authHeader?: string
  extraHeaders?: string
  maxTokens?: number
}

export type StepRequest = {
  turns: ChatTurn[]
  provider?: ProviderProfile
  mode: AgentMode
  /** Set false on the last step, when the budget is nearly spent. */
  tools?: boolean
  /** Asks the proxy to tell the model to land rather than open new work. */
  wrapUp?: boolean
  /** Handed to the model so it can pace itself. */
  budget?: { msLeft: number; tokensLeft: number; round: number }
}

export type AgentConfig = { configured: boolean; model?: string }

export const DEFAULT_PROVIDER_PROFILES: ProviderProfile[] = [
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
  { id: 'ollama', name: 'Ollama', kind: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'qwen2.5-coder:7b' },
  { id: 'lmstudio', name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://localhost:1234/v1', apiKey: 'lm-studio', model: 'local-model' },
  { id: 'custom', name: 'Custom API', kind: 'custom', baseUrl: 'https://api.example.com/v1', apiKey: '', model: '', chatPath: '/chat/completions', modelsPath: '/models', authHeader: 'Authorization: Bearer {{apiKey}}', extraHeaders: '' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'custom', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: 'openai/gpt-4o-mini', chatPath: '/chat/completions', modelsPath: '/models', authHeader: 'Authorization: Bearer {{apiKey}}', extraHeaders: '{"HTTP-Referer":"http://localhost:5185","X-Title":"RBUILDER"}', maxTokens: 8192 },
  { id: 'yandex', name: 'YandexGPT / Alice', kind: 'custom', baseUrl: 'https://rest-assistant.api.cloud.yandex.net/v1', apiKey: '', model: 'gpt://<folder-id>/yandexgpt/latest', chatPath: '/chat/completions', modelsPath: '/models', authHeader: 'Api-Key: {{apiKey}}', extraHeaders: '{"X-RBUILDER-Provider":"yandex"}' },
]

export async function testProvider(profile: ProviderProfile, signal?: AbortSignal): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const response = await fetch('/api/provider-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: profile }),
      signal,
    })
    const data = (await response.json()) as { models?: string[]; message?: string }
    if (!response.ok) return { ok: false, models: [], error: data.message ?? `Connection failed (${response.status}).` }
    return { ok: true, models: data.models ?? [] }
  } catch (error) {
    return { ok: false, models: [], error: error instanceof Error ? error.message : 'Connection failed.' }
  }
}

export type StepHandlers = {
  /** Raw text delta. The caller accumulates and parses it. */
  onDelta?: (delta: string) => void
  /** A complete tool call the model wants executed. */
  onToolCall?: (call: ToolCall) => void
  /** Exact token usage, when the provider reports it. */
  onUsage?: (totalTokens: number) => void
  /** The proxy replied, but no model is configured. */
  onUnconfigured?: (message: string) => void
  onMeta?: (config: AgentConfig) => void
}

export type StepResult = {
  ok: boolean
  configured: boolean
  error?: string
  toolCalls: ToolCall[]
}

export const UNCONFIGURED_HINT =
  'RBUILDER needs a model to write your app. Add OPENAI_API_KEY (and optionally ' +
  'OPENAI_BASE_URL / OPENAI_MODEL) to .env.local, then restart `pnpm dev`. ' +
  'The preview keeps rendering the project in the meantime.'

export async function fetchAgentConfig(signal?: AbortSignal): Promise<AgentConfig> {
  try {
    const response = await fetch('/api/chat', { method: 'GET', signal })
    if (!response.ok) return { configured: false }
    const data = (await response.json()) as { configured?: boolean; model?: string }
    return { configured: Boolean(data.configured), model: data.model }
  } catch {
    return { configured: false }
  }
}

/** One provider step. Tool calls come back to the caller to execute. */
export async function streamStep(
  request: StepRequest,
  handlers: StepHandlers = {},
  signal?: AbortSignal,
): Promise<StepResult> {
  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        turns: request.turns,
        mode: request.mode,
        provider: request.provider,
        tools: request.tools ?? true,
        wrapUp: request.wrapUp ?? false,
        budget: request.budget,
      }),
      signal,
    })
  } catch (error) {
    if (isAbort(error)) return { ok: false, configured: true, error: 'stopped', toolCalls: [] }
    return { ok: false, configured: true, error: describeError(error), toolCalls: [] }
  }

  if (!response.ok || !response.body) {
    const detail = await safeReadError(response)
    return {
      ok: false,
      configured: response.status !== 501,
      error: detail || `The model request failed (${response.status}).`,
      toolCalls: [],
    }
  }

  const toolCalls: ToolCall[] = []
  let configured = true
  let failed: string | undefined

  try {
    await readNdjson(response, (event) => {
      switch (event.type) {
        case 'delta':
          handlers.onDelta?.(event.delta)
          break
        case 'tool_call': {
          const call: ToolCall = { id: event.id, name: event.name, arguments: event.arguments }
          toolCalls.push(call)
          handlers.onToolCall?.(call)
          break
        }
        case 'meta':
          handlers.onMeta?.({ configured: true, model: event.model })
          break
        case 'usage':
          handlers.onUsage?.(event.totalTokens)
          break
        case 'unconfigured':
          configured = false
          handlers.onUnconfigured?.(event.message)
          break
        case 'error':
          failed = event.message
          break
        default:
          break
      }
    })
  } catch (error) {
    if (isAbort(error)) return { ok: false, configured, error: 'stopped', toolCalls }
    return { ok: false, configured, error: describeError(error), toolCalls }
  }

  if (failed) return { ok: false, configured, error: failed, toolCalls }
  return { ok: true, configured, toolCalls }
}

/* ------------------------------------------------------------------ */
/* Terminal                                                           */
/* ------------------------------------------------------------------ */

export type ExecEvent =
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'exit'; code: number | null; timedOut: boolean }
  | { type: 'error'; message: string }

export async function execCommand(
  command: string,
  files: { path: string; content: string }[],
  onEvent: (event: ExecEvent) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  let response: Response
  try {
    response = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, files }),
      signal,
    })
  } catch (error) {
    return { ok: false, error: isAbort(error) ? 'stopped' : describeError(error) }
  }

  if (!response.ok || !response.body) {
    const detail = await safeReadError(response)
    return { ok: false, error: detail || `The command was rejected (${response.status}).` }
  }

  try {
    await readNdjson(response, (event) => onEvent(event as ExecEvent))
  } catch (error) {
    return { ok: false, error: isAbort(error) ? 'stopped' : describeError(error) }
  }

  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Shared                                                             */
/* ------------------------------------------------------------------ */

async function readNdjson(
  response: Response,
  onEvent: (event: StreamEvent & Record<string, any>) => void,
): Promise<void> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const flush = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      onEvent(JSON.parse(trimmed) as StreamEvent & Record<string, any>)
    } catch {
      /* ignore malformed lines */
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      flush(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }

  flush(buffer)
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException ? error.name === 'AbortError' : false
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong talking to the model.'
}

async function safeReadError(response: Response): Promise<string | undefined> {
  try {
    const data = (await response.json()) as { message?: string; error?: string }
    return data.message ?? data.error
  } catch {
    return undefined
  }
}
