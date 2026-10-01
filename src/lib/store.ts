/**
 * Application state: the chat transcript, the virtual project, the checklist and
 * the tool trace. The transcript, project, plan and mode persist to
 * localStorage; terminal output and check results are session-only.
 */

import { createStarterProject, upsertFiles, MAX_FILES, type Project, type ProjectFileInput } from './project'
import { truncateBytes, type AttachmentMeta } from './attachments'
import { MAX_PERSISTED_TEXT_BYTES } from './attachments'
import type { ChecksResult } from './checks'
import type { AgentMode, PlanItem, ToolCall } from './protocol'
import type { ToolOutcome } from './tools'
import { label } from './tools'

export type MessageStatus = 'streaming' | 'done' | 'error'

export type ToolTraceEntry = {
  id: string
  name: string
  label: string
  detail?: string
  status: 'running' | 'done' | 'failed'
  summary?: string
  output?: string
}

/** What a file looked like before one assistant turn touched it. */
export type TurnSnapshot = { path: string; before: string | null }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: AttachmentMeta[]
  /** Paths written by this assistant turn. */
  files?: string[]
  /** Pre-turn content of those paths, so the transcript can diff and undo. */
  snapshots?: TurnSnapshot[]
  /** Set once the user reverted this turn's writes. */
  undone?: boolean
  /** Tool calls made while producing this turn. */
  tools?: ToolTraceEntry[]
  status?: MessageStatus
  createdAt: number
}

export type TerminalLine = {
  id: string
  kind: 'input' | 'stdout' | 'stderr' | 'exit' | 'error'
  text: string
}

export type AppState = {
  messages: ChatMessage[]
  project: Project
  configured: boolean | null
  model?: string
  mode: AgentMode
  plan: PlanItem[]
  checks: ChecksResult | null
  terminal: TerminalLine[]
  terminalRunning: boolean
}

export type Action =
  | { type: 'user/send'; message: ChatMessage }
  | { type: 'assistant/start'; id: string }
  | { type: 'assistant/set'; id: string; content: string; files?: string[] }
  | { type: 'assistant/finish'; id: string; status: MessageStatus; content?: string; files?: string[]; snapshots?: TurnSnapshot[] }
  | { type: 'message/undo'; id: string }
  | { type: 'tool/start'; messageId: string; call: ToolCall; detail: string }
  | { type: 'tool/end'; messageId: string; call: ToolCall; outcome: ToolOutcome }
  | { type: 'plan/set'; items: PlanItem[] }
  | { type: 'mode/set'; mode: AgentMode }
  | { type: 'checks/set'; result: ChecksResult | null }
  | { type: 'terminal/append'; line: TerminalLine }
  | { type: 'terminal/clear' }
  | { type: 'terminal/running'; running: boolean }
  | { type: 'project/apply'; files: ProjectFileInput[] }
  | { type: 'project/set'; project: Project }
  | { type: 'project/write'; path: string; content: string }
  | { type: 'project/delete'; path: string }
  | { type: 'app/meta'; configured: boolean; model?: string }
  | { type: 'app/reset' }

export const STORAGE_KEY = 'freebuff-web:v1'

let counter = 0

export function uid(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter}`
}

export function createInitialState(): AppState {
  return {
    messages: [],
    project: createStarterProject(),
    configured: null,
    mode: 'build',
    plan: [],
    checks: null,
    terminal: [],
    terminalRunning: false,
  }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'user/send':
      return { ...state, messages: [...state.messages, action.message] }

    case 'assistant/start':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.id,
            role: 'assistant',
            content: '',
            status: 'streaming',
            tools: [],
            createdAt: Date.now(),
          },
        ],
      }

    case 'assistant/set':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id
            ? { ...message, content: action.content, files: action.files ?? message.files }
            : message,
        ),
      }

    case 'assistant/finish':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id
            ? {
                ...message,
                status: action.status,
                content: action.content ?? message.content,
                files: action.files ?? message.files,
                snapshots: action.snapshots ?? message.snapshots,
              }
            : message,
        ),
      }

    case 'message/undo':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id ? { ...message, undone: true } : message,
        ),
      }

    case 'tool/start':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.messageId
            ? {
                ...message,
                tools: [
                  ...(message.tools ?? []),
                  {
                    id: action.call.id,
                    name: action.call.name,
                    label: label(action.call.name),
                    detail: action.detail,
                    status: 'running' as const,
                  },
                ],
              }
            : message,
        ),
      }

    case 'tool/end':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.messageId
            ? {
                ...message,
                tools: (message.tools ?? []).map((entry) =>
                  entry.id === action.call.id
                    ? {
                        ...entry,
                        status: action.outcome.ok ? ('done' as const) : ('failed' as const),
                        summary: action.outcome.summary,
                        output: action.outcome.text,
                      }
                    : entry,
                ),
              }
            : message,
        ),
      }

    case 'plan/set':
      return { ...state, plan: action.items }

    case 'mode/set':
      return { ...state, mode: action.mode }

    case 'checks/set':
      return { ...state, checks: action.result }

    case 'terminal/append': {
      const terminal = [...state.terminal, action.line]
      return { ...state, terminal: terminal.length > 400 ? terminal.slice(-400) : terminal }
    }

    case 'terminal/clear':
      return { ...state, terminal: [] }

    case 'terminal/running':
      return { ...state, terminalRunning: action.running }

    case 'project/apply':
      return { ...state, project: upsertFiles(state.project, action.files) }

    case 'project/set':
      return { ...state, project: action.project }

    case 'project/write': {
      const files = state.project.files.slice()
      const index = files.findIndex((file) => file.path === action.path)
      if (index >= 0) files[index] = { path: action.path, content: action.content }
      else if (files.length < MAX_FILES) files.push({ path: action.path, content: action.content })
      return { ...state, project: { files } }
    }

    case 'project/delete':
      return {
        ...state,
        project: { files: state.project.files.filter((file) => file.path !== action.path) },
      }

    case 'app/meta':
      return { ...state, configured: action.configured, model: action.model ?? state.model }

    case 'app/reset':
      return createInitialState()

    default:
      return state
  }
}

/* ------------------------------------------------------------------ */
/* Persistence                                                        */
/* ------------------------------------------------------------------ */

type PersistedState = {
  version: 1
  messages: ChatMessage[]
  project: Project
  mode: AgentMode
  plan: PlanItem[]
}

/** Tool output is verbose and reproducible; keep only its summary on disk. */
function trimMessages(messages: ChatMessage[], heavy: boolean): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    tools: message.tools?.map((entry) => ({ ...entry, output: heavy ? entry.output : undefined })),
    attachments: message.attachments?.map((attachment) =>
      attachment.text && !heavy
        ? { ...attachment, text: truncateBytes(attachment.text, MAX_PERSISTED_TEXT_BYTES).text }
        : attachment,
    ),
  }))
}

function serialize(state: AppState, heavy: boolean): string {
  return JSON.stringify({
    version: 1,
    messages: trimMessages(state.messages, heavy),
    project: state.project,
    mode: state.mode,
    plan: state.plan,
  } satisfies PersistedState)
}

export function saveState(state: AppState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, serialize(state, true))
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, serialize(state, false))
    } catch {
      /* storage is full or unavailable; the app keeps working in memory */
    }
  }
}

export function loadState(): AppState {
  const initial = createInitialState()
  if (typeof localStorage === 'undefined') return initial

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initial

    const parsed = JSON.parse(raw) as Partial<PersistedState>
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter(isMessage)
          .map((message) =>
            message.status === 'streaming' ? { ...message, status: 'done' as MessageStatus } : message,
          )
          // A turn that produced neither prose nor files carries no information.
          .filter((message) => message.content.trim().length > 0)
      : []

    const project =
      parsed.project && Array.isArray(parsed.project.files)
        ? { files: parsed.project.files.filter(isFile) }
        : createStarterProject()

    return {
      ...initial,
      messages,
      project: project.files.length > 0 ? project : createStarterProject(),
      mode: parsed.mode === 'plan' || parsed.mode === 'ask' ? parsed.mode : 'build',
      plan: Array.isArray(parsed.plan) ? parsed.plan.filter(isPlanItem) : [],
    }
  } catch {
    return initial
  }
}

function isMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ChatMessage>
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string'
  )
}

function isFile(value: unknown): value is { path: string; content: string } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { path?: unknown; content?: unknown }
  return typeof candidate.path === 'string' && typeof candidate.content === 'string'
}

function isPlanItem(value: unknown): value is PlanItem {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<PlanItem>
  return typeof candidate.text === 'string' && typeof candidate.done === 'boolean'
}
