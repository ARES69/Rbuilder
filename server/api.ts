/**
 * The API surface of RBUILDER, independent of how it is hosted:
 *
 *   GET  /api/chat          — is a model configured, and which one
 *   POST /api/chat          — one provider step: streamed prose plus complete tool calls
 *   POST /api/provider-test — ask a provider for its model list
 *   POST /api/exec          — run a command in a scratch copy of the project
 *   POST /api/proxy         — guarded passthrough for external APIs
 *
 * `createApiHandlers` returns plain Node request handlers, so the same code backs
 * the Vite dev server (`server/chat-proxy.ts`), the standalone production server
 * (`pnpm start`) and the sidebar process in the desktop build.
 *
 * Tool calls are returned to the browser instead of being executed here: the
 * project lives in the browser and the preview is a sandboxed frame, so only the
 * page can inspect it. The browser executes the calls and starts the next step,
 * which keeps this proxy stateless.
 *
 * The API key stays on the server: the browser learns only whether one exists.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  accumulateToolCalls,
  buildSystemPrompt,
  finalizeToolCalls,
  toProviderMessages,
  TOOL_DEFINITIONS,
  type AgentMode,
  type ChatTurn,
  type ProviderToolCallDelta,
  type StreamEvent,
} from '../src/lib/protocol'
import { budgetNotice, WRAP_UP_PROMPT } from '../src/lib/budget'
import { materializeProject, refusalFor, runCommand, writeProjectInto, type CommandFile } from './workspace'
import { allowPrivateFor, handleProxy } from './api-proxy'
import { applyCors, isAbort, messageOf, readBody, sendJson, writeLine } from './http'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'
// A turn with a real time budget accumulates turns quickly — the loop pushes an
// assistant turn plus a tool result per step — and the hard step cap on the
// client is a runaway guard, so this must comfortably exceed the worst case.
const MAX_TURNS = 500
const MAX_TURN_CHARS = 200_000

export const UNCONFIGURED_MESSAGE =
  'No model is configured yet, so I cannot write the app. Add OPENAI_API_KEY to .env.local ' +
  '(and OPENAI_BASE_URL / OPENAI_MODEL if you are not using OpenAI), then restart `pnpm dev`. ' +
  'You can also point RBUILDER at a local model (Ollama, LM Studio) in Settings — those need no key. ' +
  'The preview keeps rendering the current project in the meantime.'

export type LlmConfig = {
  apiKey: string
  baseUrl: string
  model: string
  chatPath: string
  modelsPath: string
  authHeader: string
  extraHeaders: Record<string, string>
  maxTokens: number
}

/** Where command output and the scratch copy of the project live. */
export type ApiOptions = {
  /** Directory that holds `.freebuff-workspace/`. Defaults to RBUILDER_WORKSPACE_ROOT, then cwd. */
  root?: string
}

export type ApiHandlers = {
  chat: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  exec: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  providerTest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  proxy: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  /** Liveness probe: the desktop shell waits for this before loading the window. */
  health: (req: IncomingMessage, res: ServerResponse) => void
  /** Absolute workspace root these handlers were built with (useful for status output). */
  workspaceRoot: string
}

export function workspaceRootFor(
  env: Record<string, string | undefined>,
  options: ApiOptions = {},
): string {
  if (options.root) return options.root
  const fromEnv = env.RBUILDER_WORKSPACE_ROOT?.trim()
  return fromEnv ? fromEnv : process.cwd()
}

export function createApiHandlers(
  env: Record<string, string | undefined>,
  options: ApiOptions = {},
): ApiHandlers {
  const config = readLlmConfig(env)
  const root = workspaceRootFor(env, options)
  const allowPrivate = allowPrivateFor(env)

  return {
    chat: (req, res) => handleChat(req, res, config),
    exec: (req, res) => handleExec(req, res, root),
    providerTest: (req, res) => handleProviderTest(req, res),
    proxy: (req, res) => handleProxy(req, res, allowPrivate),
    health: (req, res) => {
      if (applyCors(req, res)) return

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { message: 'Use GET /api/health.' })
        return
      }
      sendJson(res, 200, {
        ok: true,
        service: 'rbuilder',
        model: config?.model ?? null,
        configured: Boolean(config),
        workspaceRoot: root,
      })
    },
    workspaceRoot: root,
  }
}

export function readLlmConfig(env: Record<string, string | undefined>): LlmConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim()
  if (!apiKey) return null

  const baseUrl = (env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = env.OPENAI_MODEL?.trim() || DEFAULT_MODEL

  return {
    apiKey,
    baseUrl,
    model,
    chatPath: '/chat/completions',
    modelsPath: '/models',
    authHeader: 'Authorization: Bearer {{apiKey}}',
    extraHeaders: {},
    maxTokens: 8192,
  }
}

function readProviderConfig(provider: z.infer<typeof providerSchema>): LlmConfig | null {
  const apiKey = provider.apiKey.trim()
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, '')
  const model = provider.model.trim()
  const localProvider = provider.kind === 'ollama' || provider.kind === 'lmstudio'
  if (!baseUrl || !model || (!apiKey && !localProvider)) return null
  let extraHeaders: Record<string, string> = {}
  if (provider.extraHeaders?.trim()) {
    try {
      const parsed = JSON.parse(provider.extraHeaders) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      extraHeaders = Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    } catch {
      return null
    }
  }
  return {
    apiKey,
    baseUrl,
    model,
    chatPath: provider.chatPath?.trim() || '/chat/completions',
    modelsPath: provider.modelsPath?.trim() || '/models',
    authHeader: provider.authHeader?.trim() || 'Authorization: Bearer {{apiKey}}',
    extraHeaders,
    maxTokens: provider.maxTokens ?? 8192,
  }
}

const toolCallSchema = z.object({
  id: z.string().max(200),
  name: z.string().max(100),
  arguments: z.string().max(MAX_TURN_CHARS),
})

const turnSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string().max(MAX_TURN_CHARS),
  toolCalls: z.array(toolCallSchema).max(20).optional(),
  toolCallId: z.string().max(200).optional(),
})

const budgetSchema = z.object({
  msLeft: z.number().min(0).max(24 * 60 * 60 * 1000),
  tokensLeft: z.number().min(0),
  round: z.number().min(0).max(1000),
})

const providerSchema = z.object({
  id: z.string().max(80),
  name: z.string().max(80),
  kind: z.enum(['openai', 'ollama', 'lmstudio', 'custom']),
  baseUrl: z.string().url().max(500),
  apiKey: z.string().max(500),
  model: z.string().max(200),
  chatPath: z.string().max(300).optional(),
  modelsPath: z.string().max(300).optional(),
  authHeader: z.string().max(300).optional(),
  extraHeaders: z.string().max(10_000).optional(),
  maxTokens: z.number().int().min(256).max(64_000).optional(),
})

const chatRequestSchema = z.object({
  turns: z.array(turnSchema).min(1).max(MAX_TURNS),
  provider: providerSchema.optional(),
  mode: z.enum(['plan', 'ask', 'build']).default('build'),
  // The browser turns tools off for the final step of a nearly spent budget.
  tools: z.boolean().default(true),
  wrapUp: z.boolean().default(false),
  budget: budgetSchema.optional(),
})

const execRequestSchema = z.object({
  command: z.string().max(400),
  files: z.array(z.object({ path: z.string().max(300), content: z.string().max(600_000) })).max(60),
  /** When set, the command runs in this bound project folder instead of the scratch copy. */
  cwd: z.string().max(500).optional(),
})

type RawTurn = z.infer<typeof turnSchema>

/* ------------------------------------------------------------------ */
/* Chat                                                               */
/* ------------------------------------------------------------------ */

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  config: LlmConfig | null,
): Promise<void> {
  if (applyCors(req, res)) return

  if (req.method === 'GET') {
    sendJson(res, 200, { configured: Boolean(config), model: config?.model })
    return
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { message: 'Use POST /api/chat.' })
    return
  }

  let body: string
  try {
    body = await readBody(req)
  } catch (error) {
    sendJson(res, 413, { message: messageOf(error) })
    return
  }

  let parsed: z.infer<typeof chatRequestSchema>
  try {
    parsed = chatRequestSchema.parse(JSON.parse(body || '{}'))
  } catch {
    sendJson(res, 400, { message: 'Expected a JSON body with a non-empty "turns" array.' })
    return
  }

  const turns = normalizeTurns(parsed.turns).filter((turn) => turn.content.trim() || hasToolCalls(turn))
  if (turns.length === 0) {
    sendJson(res, 400, { message: 'No usable turns were sent.' })
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const requestConfig = parsed.provider ? readProviderConfig(parsed.provider) : config

  if (!requestConfig) {
    writeEvent(res, { type: 'unconfigured', message: UNCONFIGURED_MESSAGE })
    writeEvent(res, { type: 'done' })
    res.end()
    return
  }

  writeEvent(res, { type: 'meta', configured: true, model: requestConfig.model })

  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  try {
    await forwardProvider(
      requestConfig,
      turns,
      parsed.mode,
      { tools: parsed.tools, wrapUp: parsed.wrapUp, budget: parsed.budget },
      res,
      controller.signal,
    )
  } catch (error) {
    if (!isAbort(error)) {
      writeEvent(res, { type: 'error', message: messageOf(error) })
    }
  }

  writeEvent(res, { type: 'done' })
  res.end()
}

export function systemPromptFor(
  mode: AgentMode,
  options: { tools: boolean; wrapUp: boolean; budget?: { msLeft: number; tokensLeft: number; round: number } },
): string {
  const sections = [buildSystemPrompt(mode)]

  if (options.budget) {
    sections.push(budgetNotice(options.budget.msLeft, options.budget.tokensLeft, options.budget.round))
  }
  if (options.wrapUp) sections.push(WRAP_UP_PROMPT)

  return sections.join('\n\n')
}

function hasToolCalls(turn: ChatTurn): boolean {
  return turn.role === 'assistant' && 'toolCalls' in turn && turn.toolCalls.length > 0
}

export function normalizeTurns(raw: RawTurn[]): ChatTurn[] {
  return raw.flatMap((turn): ChatTurn[] => {
    if (turn.role === 'tool') {
      if (!turn.toolCallId) return []
      return [{ role: 'tool' as const, content: turn.content, toolCallId: turn.toolCallId, name: 'tool' }]
    }

    if (turn.role === 'assistant' && turn.toolCalls?.length) {
      return [{ role: 'assistant' as const, content: turn.content, toolCalls: turn.toolCalls }]
    }

    return [{ role: turn.role as 'user' | 'assistant', content: turn.content }]
  })
}

async function forwardProvider(
  config: LlmConfig,
  turns: ChatTurn[],
  mode: AgentMode,
  options: { tools: boolean; wrapUp: boolean; budget?: z.infer<typeof budgetSchema> },
  res: ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  const messages = [
    { role: 'system' as const, content: systemPromptFor(mode, options) },
    ...toProviderMessages(turns),
  ]

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  for (const [key, value] of Object.entries(config.extraHeaders)) headers[key] = value.replaceAll('{{apiKey}}', config.apiKey)
  const auth = config.authHeader.replaceAll('{{apiKey}}', config.apiKey)
  const separator = auth.indexOf(':')
  if (separator > 0) headers[auth.slice(0, separator).trim()] = auth.slice(separator + 1).trim()

  const upstream = await fetch(`${config.baseUrl}${config.chatPath.startsWith('/') ? config.chatPath : `/${config.chatPath}`}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      stream: true,
      // Providers that honour this report exact token usage in the last chunk;
      // the ones that ignore it leave the browser's own estimate in place.
      stream_options: { include_usage: true },
      messages,
      max_tokens: config.maxTokens,
      // Tools are only offered while building, and not on the final step of a
      // spent budget: plan mode must not touch files either.
      ...(mode === 'build' && options.tools
        ? { tools: TOOL_DEFINITIONS, tool_choice: 'auto' }
        : {}),
    }),
    signal,
  })

  if (!upstream.ok) {
    writeEvent(res, { type: 'error', message: await providerError(upstream) })
    return
  }

  const contentType = upstream.headers.get('content-type') ?? ''

  // Some OpenAI-compatible servers ignore `stream` and answer with plain JSON.
  if (!contentType.includes('text/event-stream') || !upstream.body) {
    const data = (await upstream.json().catch(() => null)) as ProviderResponse | null
    const message = data?.choices?.[0]?.message
    if (typeof message?.content === 'string' && message.content.trim()) {
      writeEvent(res, { type: 'delta', delta: message.content })
    }
    for (const call of message?.tool_calls ?? []) {
      if (call.function?.name) {
        writeEvent(res, {
          type: 'tool_call',
          id: call.id || `call_${call.function.name}`,
          name: call.function.name,
          arguments: call.function.arguments || '{}',
        })
      }
    }
    const total = tokenTotal(data?.usage)
    if (total !== undefined) writeEvent(res, { type: 'usage', totalTokens: total })
    if (!message?.content?.trim() && !(message?.tool_calls?.length)) {
      writeEvent(res, { type: 'error', message: 'The model returned an empty response.' })
    }
    return
  }

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  const toolCalls = new Map<number, { id: string; name: string; args: string }>()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim()
        if (payload && payload !== '[DONE]') {
          const chunk = parseChunk(payload)
          if (chunk.delta) writeEvent(res, { type: 'delta', delta: chunk.delta })
          if (chunk.toolCalls.length > 0) accumulateToolCalls(toolCalls, chunk.toolCalls)
          if (chunk.totalTokens !== undefined) {
            writeEvent(res, { type: 'usage', totalTokens: chunk.totalTokens })
          }
        }
      }
      newline = buffer.indexOf('\n')
    }
  }

  // Tool calls are only handed over once the text stream has finished: the
  // browser executes them and asks for the next step.
  for (const call of finalizeToolCalls(toolCalls)) {
    writeEvent(res, {
      type: 'tool_call',
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    })
  }
}

type ProviderUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

/**
 * Exact tokens for a response, however the provider breaks them down. Undefined
 * when it reports nothing, so the caller's estimate is left alone.
 */
export function tokenTotal(usage?: ProviderUsage): number | undefined {
  if (!usage) return undefined
  const total = usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)
  return Number.isFinite(total) && total > 0 ? Math.round(total) : undefined
}

type ProviderResponse = {
  usage?: ProviderUsage
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: ProviderToolCallDelta[] }
    message?: {
      content?: string | null
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
    }
  }>
}

function parseChunk(payload: string): {
  delta: string
  toolCalls: ProviderToolCallDelta[]
  totalTokens?: number
} {
  try {
    const parsed = JSON.parse(payload) as ProviderResponse
    const choice = parsed.choices?.[0]
    return {
      delta: choice?.delta?.content ?? '',
      toolCalls: choice?.delta?.tool_calls ?? [],
      // The usage chunk arrives with an empty choices array. Keep listening.
      totalTokens: tokenTotal(parsed.usage),
    }
  } catch {
    return { delta: '', toolCalls: [] }
  }
}

/* ------------------------------------------------------------------ */
/* Provider setup                                                     */
/* ------------------------------------------------------------------ */

async function handleProviderTest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (applyCors(req, res)) return

  if (req.method !== 'POST') {
    sendJson(res, 405, { message: 'Use POST /api/provider-test.' })
    return
  }

  try {
    const parsed = z.object({ provider: providerSchema }).parse(JSON.parse(await readBody(req)))
    const config = readProviderConfig(parsed.provider)
    if (!config) {
      sendJson(res, 400, { message: 'A Base URL and model are required.' })
      return
    }

    const response = await fetch(`${config.baseUrl}${config.modelsPath.startsWith('/') ? config.modelsPath : `/${config.modelsPath}`}`, {
      headers: (() => {
        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(config.extraHeaders)) headers[key] = value.replaceAll('{{apiKey}}', config.apiKey)
        const auth = config.authHeader.replaceAll('{{apiKey}}', config.apiKey)
        const separator = auth.indexOf(':')
        if (separator > 0) headers[auth.slice(0, separator).trim()] = auth.slice(separator + 1).trim()
        return headers
      })(),
      signal: AbortSignal.timeout(10_000),
    })
    const raw = await response.text()
    if (!response.ok) {
      sendJson(res, response.status, { message: `Provider rejected the connection (${response.status}).` })
      return
    }

    let models: string[] = []
    try {
      const data = JSON.parse(raw) as { data?: Array<{ id?: string }> }
      models = (data.data ?? []).map((entry) => entry.id).filter((id): id is string => Boolean(id)).slice(0, 100)
    } catch {
      /* Some local servers return an empty or non-standard models response. */
    }
    sendJson(res, 200, { ok: true, models })
  } catch (error) {
    sendJson(res, 502, { message: `Could not connect to the provider: ${messageOf(error)}` })
  }
}

/* ------------------------------------------------------------------ */
/* Terminal                                                           */
/* ------------------------------------------------------------------ */

async function handleExec(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  if (applyCors(req, res)) return

  if (req.method !== 'POST') {
    sendJson(res, 405, { message: 'Use POST /api/exec.' })
    return
  }

  let parsed: z.infer<typeof execRequestSchema>
  try {
    const body = await readBody(req)
    parsed = execRequestSchema.parse(JSON.parse(body || '{}'))
  } catch (error) {
    sendJson(res, 400, { message: messageOf(error) })
    return
  }

  const refusal = refusalFor(parsed.command)
  if (refusal) {
    sendJson(res, 400, { message: refusal })
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.flushHeaders?.()

  let cwd: string
  try {
    cwd = parsed.cwd
      ? await resolveBoundFolder(parsed.cwd, parsed.files as CommandFile[])
      : await materializeProject(root, parsed.files as CommandFile[])
  } catch (error) {
    writeLine(res, { type: 'error', message: `Could not prepare the workspace: ${messageOf(error)}` })
    writeLine(res, { type: 'exit', code: null, timedOut: false })
    res.end()
    return
  }

  await runCommand(parsed.command, cwd, (event) => writeLine(res, event))
  res.end()
}

/**
 * A bound project folder: absolute, existing, and it receives the current
 * project files, so the command sees the same tree the preview does.
 */
async function resolveBoundFolder(candidate: string, files: CommandFile[]): Promise<string> {
  const dir = path.resolve(candidate)
  if (!path.isAbsolute(dir)) {
    throw new Error('the project folder must be an absolute path')
  }
  const info = await stat(dir).catch(() => null)
  if (!info?.isDirectory()) {
    throw new Error('the project folder does not exist')
  }
  return writeProjectInto(dir, files)
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

async function providerError(response: Response): Promise<string> {
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
  const raw = await response.text().catch(() => '')

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string }
    const detail = parsed.error?.message ?? parsed.message
    if (detail) return `The provider rejected the request (${status}): ${detail}`
  } catch {
    /* fall through to the generic message */
  }

  return `The provider rejected the request (${status}). Check the provider settings, its base URL and the model id.`
}

function writeEvent(res: ServerResponse, event: StreamEvent): void {
  writeLine(res, event)
}
