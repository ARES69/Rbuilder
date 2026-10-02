/**
 * The wire contract between the browser and the /api/chat proxy: turn shapes,
 * stream events, tool definitions, the system prompts and the parsers that turn
 * a streamed model reply into project files and a plan.
 *
 * The model writes plain prose followed by fenced blocks:
 *
 *   I built the timer.
 *
 *   ```plan
 *   - [x] Scaffold the page
 *   - [ ] Wire the countdown
 *   ```
 *
 *   ```file:index.html
 *   <!doctype html>
 *   ```
 *
 * Prose streams token by token; file and plan blocks are consumed as they close.
 * A JSON envelope is accepted as a fallback for models that ignore the protocol.
 */

import { z } from 'zod'
import { normalizePath, type ProjectFileInput } from './project'

/* ------------------------------------------------------------------ */
/* Turns                                                              */
/* ------------------------------------------------------------------ */

export type ToolCall = { id: string; name: string; arguments: string }

export type ChatTurn =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string }

export type AgentMode = 'plan' | 'ask' | 'build'

export type StreamEvent =
  | { type: 'meta'; configured: true; model: string }
  | { type: 'delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'usage'; totalTokens: number }
  | { type: 'unconfigured'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

/* ------------------------------------------------------------------ */
/* Tools                                                             */
/* ------------------------------------------------------------------ */

export type ToolName =
  | 'inspect_preview'
  | 'interact_with_preview'
  | 'read_project_file'
  | 'run_checks'
  | 'run_command'

export const TOOL_LABELS: Record<string, string> = {
  inspect_preview: 'Inspected the preview',
  interact_with_preview: 'Used the preview',
  read_project_file: 'Read a project file',
  run_checks: 'Ran the project checks',
  run_command: 'Ran a command',
}

/** OpenAI-style function definitions, shared by the proxy and the UI. */
export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'inspect_preview',
      description:
        'Read the running preview: page title, an outline of its headings, text and interactive elements, the console log, any runtime errors and failed network requests. Call this after writing files to verify the app actually works.',
      parameters: {
        type: 'object',
        properties: {
          include_console: {
            type: 'boolean',
            description: 'Include console output and errors (default true).',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'interact_with_preview',
      description:
        'Drive the running preview like a user: click an element, type into a field or press a key, then read what changed. Use it to verify interactions (clicking a start button, submitting a form). The preview reloads when you write new files, so interact after your edits.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['click', 'type', 'press'] },
          target: {
            type: 'string',
            description:
              'CSS selector, or exact visible text of the element. Required for click and type.',
          },
          text: { type: 'string', description: 'Text to type (for action "type").' },
          key: { type: 'string', description: 'Key name for action "press", e.g. Enter.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_project_file',
      description:
        'Read the full current contents of one file in the project. Use it to check what a file contains before changing it.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Project-relative path.' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_checks',
      description:
        'Run the project checks: JavaScript syntax, CSS and HTML structure, and references to files that do not exist. Call it after a round of edits so you can fix real problems instead of guessing.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_command',
      description:
        'Run one shell command in the project folder to verify real behaviour (node --check app.js, ls, git status, node script.js). The command must be a single line of at most 400 characters; there is a 20-second timeout and privileged or destructive commands (sudo, rm -rf /, git push, formatting disks) are refused. In ask mode every command needs the user\'s approval first, so batch your questions: ask for commands only when the built-in checks cannot answer.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The single shell command to run, at most 400 characters.' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
]

/* ------------------------------------------------------------------ */
/* Prompts                                                            */
/* ------------------------------------------------------------------ */

const PROTOCOL = `You are RBUILDER, an AI app builder. The user chats with you on the left while the app you are building renders live in a preview on the right.

You build a single-page web app from plain HTML, CSS and JavaScript: no build step, no frameworks, no package installs. The preview renders the project's index.html inside a sandboxed iframe.

How to reply:
1. Write a short plain-prose summary of what you did, 2-4 sentences. No headings, no bullet lists of files.
2. Then emit every file you created or changed as a fenced block using exactly this form:

\`\`\`file:index.html
<!doctype html>
<html>...</html>
\`\`\`

Rules:
- The info string is always "file:" followed by the project-relative path. Never use html, css or js as the info string.
- Emit the complete file content every time, even for tiny edits.
- index.html must always exist and stay valid. Reference other files relatively, for example <link rel="stylesheet" href="styles.css"> and <script src="app.js"></script>. You may put all CSS and JS inside index.html instead.
- Only emit files you actually changed. Never repeat files that did not change.
- Do not link third-party stylesheets. You may pull a library from a CDN only when the user asks for it.
- Never use triple backticks inside file content.
- Keep the interface clean, spacious and minimal unless the user asks for something else.
- Make the app work on its own: real content, no lorem ipsum placeholders.

The user can attach any file to a message. Text-like attachments arrive inline as:

\`\`\`attachment:notes.md
<file content, possibly truncated>
\`\`\`

Binary attachments arrive as a single line with the name, media type and size. Use attachments as context and say so when you relied on one.`

const TOOLS = `You can inspect your own work with tools. Available functions:

- inspect_preview(): read the running preview — outline, console output, runtime errors, failed requests. Call it after writing files, and never claim the app works without it when a check is cheap.
- interact_with_preview(action, target, text, key): click, type or press a key in the preview to verify an interaction end to end.
- read_project_file(path): read a file's full current contents.
- run_checks(): run the project checks (syntax, structure, missing files).
- run_command(command): run one shell command in the project folder (node --check app.js, ls, git status) and see its real output. In ask mode the user approves every command first, so prefer the built-in tools when they can answer and batch command needs into few calls.

Use them the way a careful engineer does: write the files, inspect, fix what is broken, inspect again. Keep tool use tight — usually one inspect after a change and one more interaction only when behaviour matters. Do not narrate the tool calls in prose; the interface shows them.`

const PLAN_PROTOCOL = `You also keep a visible checklist for anything that takes more than one step, as a fenced block:

\`\`\`plan
- [x] Scaffold index.html
- [ ] Wire the countdown
\`\`\`

Rules for the checklist:
- Re-emit the whole checklist whenever a step changes, with [x] on finished steps.
- Keep items short, 3-6 words, and at most 6 items.
- Emit it before the file blocks. Skip it entirely for a one-step change.`

const INTEGRATIONS = `The app can call external APIs — Bitrix24, amoCRM, Yandex, Tinkoff, 1C, Telegram, or any REST service — through the dev-server proxy at /api/proxy. The preview runs in a sandboxed frame, so calling a third-party host directly from the page fails CORS; always go through the proxy:\n\nconst response = await fetch('/api/proxy', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    url: 'https://company.bitrix24.ru/rest/1/xxxx/crm.lead.list.json',\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ filter: { NAME: 'Ivan' } }),\n  }),\n});\nif (!response.ok) throw new Error('API error ' + response.status);\nconst data = await response.json();\n\nThe envelope is { url, method?, headers?, body?, timeoutMs? }; the upstream response comes back verbatim with its original status.\n\nRules:\n- Never fetch a third-party host from the page directly; route it through /api/proxy.\n- Webhook-style services (Bitrix24 inbound webhooks, Telegram bots) put the key in the URL: use the whole webhook URL the user gives you, and ask for it when it is missing.\n- If the API is unfamiliar, ask the user to attach its documentation, then follow it exactly.\n- Show loading and error states; when a call fails, surface the message instead of inventing data.\n- Handle the response shape defensively (optional chaining, fallbacks) because real APIs vary.\n- Private and local network addresses are refused by the proxy.`

/** Builds the system prompt for the current mode. */
export function buildSystemPrompt(mode: AgentMode): string {
  if (mode === 'ask') {
    return `${PROTOCOL}

${TOOLS}

${INTEGRATIONS}

${PLAN_PROTOCOL}

You are in ASK MODE: every batch of file blocks you emit is shown to the user for approval before it is applied, and every command you ask run_command to run is approved the same way before it executes.

- Keep emitting complete file blocks exactly as usual; the interface collects them into one approval card.
- The user either approves the batch (it is applied, and you continue) or rejects it (you are told in the next message).
- When a batch is rejected, change your approach — do not repeat the same writes.
- Work in small steps: propose one coherent batch, then verify it once it lands.`
  }

  if (mode === 'plan') {
    return `${PROTOCOL}

${INTEGRATIONS}

You are in PLAN MODE. The user wants to agree on an approach before any code is written.

- Do not emit any file blocks. Nothing you write will be applied.
- Reply with a short plan: what the app will be, the structure of the files, and the key decisions (2-5 sentences of prose).
- Then emit the checklist in a fenced plan block, with every item unchecked:

\`\`\`plan
- [ ] First step
- [ ] Second step
\`\`\`

- Ask a question in prose if the request is genuinely ambiguous. Otherwise commit to a sensible plan.`
  }

  return `${PROTOCOL}

${TOOLS}

${INTEGRATIONS}

${PLAN_PROTOCOL}

Work in small steps: make the change, then verify it. If a check or the preview reports a problem, fix it in the same turn.`
}

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

export type ExtractResult = {
  /** Complete file blocks, in the order they appeared. */
  files: ProjectFileInput[]
  /** Prose to show in the chat. File blocks are removed; the chat lists them as chips. */
  display: string
  /** Files that started but whose opening fence has not closed yet. */
  pending: string[]
}

export type PlanItem = { text: string; done: boolean }
export type PlanResult = { items: PlanItem[]; display: string }

const fileFence = /^```file:(.+)$/
const planFence = /^```plan\s*$/
const planItem = /^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/

/** Pulls file blocks out of a (possibly partial) model reply. */
export function extractFilesFromText(text: string): ExtractResult {
  const lines = text.split('\n')
  const files: ProjectFileInput[] = []
  const pending: string[] = []
  const display: string[] = []

  let index = 0
  while (index < lines.length) {
    const match = fileFence.exec(lines[index]!.trim())

    if (!match) {
      display.push(lines[index]!)
      index += 1
      continue
    }

    const path = normalizePath(match[1]!.trim())
    const bodyStart = index + 1
    let closing = -1

    for (let scan = bodyStart; scan < lines.length; scan += 1) {
      if (lines[scan]!.trim() === '```') {
        closing = scan
        break
      }
    }

    if (!path) {
      display.push(lines[index]!)
      index = bodyStart
      continue
    }

    if (closing === -1) {
      pending.push(path)
      index = lines.length
      continue
    }

    files.push({ path, content: lines.slice(bodyStart, closing).join('\n') })
    // Nothing is added to the prose: the chat renders the written files as chips.
    display.push('')
    index = closing + 1
  }

  const cleaned = stripBlankRuns(display.join('\n'))

  if (files.length === 0) {
    const envelope = parseJsonEnvelope(cleaned)
    if (envelope) return envelope
  }

  return { files, display: cleaned, pending }
}

/**
 * The last complete plan block wins; the checklist is removed from the prose.
 * An unterminated block is ignored so a half-streamed plan never flickers.
 */
export function extractPlan(text: string): PlanResult {
  const lines = text.split('\n')
  const display: string[] = []
  let items: PlanItem[] | null = null

  let index = 0
  while (index < lines.length) {
    if (!planFence.test(lines[index]!.trim())) {
      display.push(lines[index]!)
      index += 1
      continue
    }

    let closing = -1
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      if (lines[scan]!.trim() === '```') {
        closing = scan
        break
      }
    }

    if (closing === -1) {
      index = lines.length
      continue
    }

    const found: PlanItem[] = []
    for (const line of lines.slice(index + 1, closing)) {
      const match = planItem.exec(line)
      if (match) found.push({ text: match[2]!, done: match[1]!.toLowerCase() === 'x' })
    }

    if (found.length > 0) items = found
    display.push('')
    index = closing + 1
  }

  return { items: items ?? [], display: stripBlankRuns(display.join('\n')) }
}

/** File blocks and the plan are both stripped; this is the prose that remains. */
export function extractReply(text: string): ExtractResult & { plan: PlanItem[] } {
  const files = extractFilesFromText(text)
  const plan = extractPlan(files.display)

  return { files: files.files, display: plan.display, pending: files.pending, plan: plan.items }
}

/** Same as extractReply, but an unterminated final file block is closed at the end. */
export function extractFinal(text: string): ExtractResult & { plan: PlanItem[] } {
  const files = extractFilesFromText(text)
  if (files.pending.length === 0) {
    const plan = extractPlan(files.display)
    return { files: files.files, display: plan.display, pending: [], plan: plan.items }
  }

  // Re-run with an implicit closing fence for the trailing block.
  const recovered = extractFilesFromText(`${text}\n\`\`\`\n`)
  const plan = extractPlan(recovered.display)
  return { files: recovered.files, display: plan.display, pending: [], plan: plan.items }
}

const envelopeSchema = z.object({
  reply: z.string().optional(),
  files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
})

/** Accepts a raw JSON object reply, e.g. {"reply": "...", "files": [...]}. */
function parseJsonEnvelope(text: string): ExtractResult | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }

  const result = envelopeSchema.safeParse(parsed)
  if (!result.success) return null
  const { reply, files } = result.data
  if (!reply && !files) return null

  return {
    files: (files ?? []).flatMap((file) => {
      const path = normalizePath(file.path)
      return path ? [{ path, content: file.content }] : []
    }),
    display: reply ?? '',
    pending: [],
  }
}

function stripBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/* ------------------------------------------------------------------ */
/* Provider plumbing (used by the proxy, unit-tested here)            */
/* ------------------------------------------------------------------ */

export type ProviderToolCallDelta = {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

export type ToolCallAccumulator = Map<number, { id: string; name: string; args: string }>

export function accumulateToolCalls(
  accumulator: ToolCallAccumulator,
  deltas: ProviderToolCallDelta[],
): void {
  for (const delta of deltas) {
    const index = delta.index ?? 0
    const entry = accumulator.get(index) ?? { id: '', name: '', args: '' }
    if (delta.id) entry.id = delta.id
    if (delta.function?.name) entry.name = delta.function.name
    if (delta.function?.arguments) entry.args += delta.function.arguments
    accumulator.set(index, entry)
  }
}

/** Completed calls in index order. Unnamed or empty fragments are dropped. */
export function finalizeToolCalls(accumulator: ToolCallAccumulator): ToolCall[] {
  return [...accumulator.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([index, entry]) => {
      if (!entry.name) return []
      const args = entry.args.trim() || '{}'
      return [{ id: entry.id || `call_${index}`, name: entry.name, arguments: args }]
    })
}

export type ProviderMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | {
      role: 'assistant'
      content: string
      tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
    }
  | { role: 'tool'; content: string; tool_call_id: string }

/** Maps our turns onto the OpenAI chat completions shape. */
export function toProviderMessages(turns: ChatTurn[]): ProviderMessage[] {
  return turns.map((turn) => {
    if (turn.role === 'tool') {
      return { role: 'tool' as const, content: turn.content, tool_call_id: turn.toolCallId }
    }

    if (turn.role === 'assistant' && 'toolCalls' in turn && turn.toolCalls.length > 0) {
      return {
        role: 'assistant' as const,
        content: turn.content,
        tool_calls: turn.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      }
    }

    return { role: turn.role, content: turn.content }
  })
}
