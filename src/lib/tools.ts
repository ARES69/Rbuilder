/**
 * Executes the tool calls the model asks for. Everything except run_checks runs
 * in the browser: the project lives in memory and the preview is a sandboxed
 * frame the parent can only reach over postMessage.
 *
 * A tool never throws at the caller: failures are returned as text so the model
 * can see what went wrong and try something else.
 */

import { formatChecks, runChecks } from './checks'
import { channelFor, type InteractResult, type PreviewInspector, type PreviewSnapshot } from './inspector'
import type { ToolCall } from './protocol'
import { TOOL_LABELS } from './protocol'
import type { Project } from './project'

export type ToolOutcome = {
  ok: boolean
  /** One line for the trace row in the chat. */
  summary: string
  /** Text handed back to the model as the tool result. */
  text: string
}

export type ToolContext = {
  inspector: PreviewInspector
  project: Project
}

const MAX_READ_CHARS = 20_000

export async function executeTool(call: ToolCall, context: ToolContext): Promise<ToolOutcome> {
  const args = parseArgs(call.arguments)

  try {
    switch (call.name) {
      case 'inspect_preview':
        return await inspectPreview(context, args)
      case 'interact_with_preview':
        return await interactWithPreview(context, args)
      case 'read_project_file':
        return readProjectFile(context, String(args.path ?? ''))
      case 'run_checks':
        return runProjectChecks(context)
      default:
        return {
          ok: false,
          summary: `Unknown tool ${call.name}`,
          text: `Unknown tool "${call.name}". Available tools: ${Object.keys(TOOL_LABELS).join(', ')}.`,
        }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      summary: `${label(call.name)} — failed`,
      text: `The tool failed: ${message}`,
    }
  }
}

async function inspectPreview(context: ToolContext, args: Record<string, unknown>): Promise<ToolOutcome> {
  const snapshot = await context.inspector.inspect(
    args.include_console !== false,
    channelFor(context.project),
  )
  const problems = snapshot.errors.length + snapshot.failedRequests.length

  return {
    ok: true,
    summary:
      problems === 0
        ? 'Preview inspected — no errors'
        : `Preview inspected — ${problems} problem${problems === 1 ? '' : 's'}`,
    text: formatSnapshot(snapshot),
  }
}

async function interactWithPreview(
  context: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const action = String(args.action ?? '')

  if (action !== 'click' && action !== 'type' && action !== 'press') {
    return {
      ok: false,
      summary: 'Preview interaction — bad action',
      text: `action must be one of click, type, press (received "${action}").`,
    }
  }

  const result = await context.inspector.interact(
    action,
    {
      target: args.target ? String(args.target) : undefined,
      text: args.text !== undefined ? String(args.text) : undefined,
      key: args.key ? String(args.key) : undefined,
    },
    channelFor(context.project),
  )

  if (result.ok === false) {
    return {
      ok: false,
      summary: `Preview interaction — nothing matched`,
      text: `${result.reason ?? 'The action failed.'}\n\nCurrent page outline:\n${(await safeOutline(context)).join('\n')}`,
    }
  }

  const what =
    action === 'click'
      ? `Clicked ${describeMatch(result)}`
      : action === 'type'
        ? `Typed into ${describeMatch(result)}`
        : `Pressed ${String(args.key ?? 'Enter')}`

  return { ok: true, summary: `Preview ${action} — done`, text: `${what}.\n\n${formatAfter(result)}` }
}

function readProjectFile(context: ToolContext, path: string): ToolOutcome {
  const wanted = path.trim().toLowerCase()
  const file =
    context.project.files.find((entry) => entry.path === path.trim()) ??
    context.project.files.find((entry) => entry.path.toLowerCase() === wanted)

  if (!file) {
    const available = context.project.files.map((entry) => entry.path).join(', ') || 'none'
    return {
      ok: false,
      summary: `Read ${path || 'file'} — not found`,
      text: `There is no file "${path}". Project files: ${available}.`,
    }
  }

  const content =
    file.content.length > MAX_READ_CHARS
      ? `${file.content.slice(0, MAX_READ_CHARS)}\n… truncated (${file.content.length} chars total)`
      : file.content

  return {
    ok: true,
    summary: `Read ${file.path}`,
    text: `Contents of ${file.path}:\n\n${content}`,
  }
}

function runProjectChecks(context: ToolContext): ToolOutcome {
  const result = runChecks(context.project)
  const errors = result.findings.filter((finding) => finding.level === 'error').length

  return {
    ok: true,
    summary:
      result.findings.length === 0
        ? 'Checks passed'
        : `Checks — ${errors} error${errors === 1 ? '' : 's'}, ${result.findings.length - errors} warning${result.findings.length - errors === 1 ? '' : 's'}`,
    text: formatChecks(result),
  }
}

async function safeOutline(context: ToolContext): Promise<string[]> {
  try {
    const snapshot = await context.inspector.inspect(false, channelFor(context.project))
    return snapshot.outline.slice(0, 40)
  } catch {
    return ['(the preview is not running)']
  }
}

function formatSnapshot(snapshot: PreviewSnapshot): string {
  const sections: string[] = [
    `Preview of "${snapshot.title || 'untitled'}" — viewport ${snapshot.size.width}x${snapshot.size.height}, page height ${snapshot.documentHeight}px.`,
    `Visible text: ${snapshot.bodyText || '(empty page)'}`,
  ]

  sections.push(
    snapshot.outline.length > 0
      ? `Outline (tag \"text\" → selector):\n${snapshot.outline.join('\n')}`
      : 'Outline: no visible elements.',
  )

  sections.push(
    snapshot.errors.length > 0
      ? `Runtime errors:\n${snapshot.errors.join('\n')}`
      : 'Runtime errors: none.',
  )

  sections.push(
    snapshot.failedRequests.length > 0
      ? `Failed requests:\n${snapshot.failedRequests.join('\n')}`
      : 'Failed requests: none.',
  )

  if (snapshot.console.length > 0) {
    sections.push(`Console (last ${snapshot.console.length}):\n${snapshot.console.join('\n')}`)
  }

  return sections.join('\n\n')
}

function formatAfter(result: InteractResult): string {
  const after = result.after
  if (!after) return 'The page did not report a change.'

  const lines = [
    after.errors.length > 0 ? `Errors now: ${after.errors.join('; ')}` : 'Errors now: none',
    after.console.length > 0 ? `Console: ${after.console.join(' | ')}` : null,
    after.failedRequests.length > 0 ? `Failed requests: ${after.failedRequests.join('; ')}` : null,
    after.bodyText ? `Visible text now: ${after.bodyText}` : null,
  ].filter(Boolean)

  return lines.join('\n')
}

function describeMatch(result: InteractResult): string {
  if (!result.matched) return 'an element'
  const { tag, text, selector } = result.matched
  return text ? `${tag} "${text}" (${selector})` : `${tag} (${selector})`
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function label(name: string): string {
  return TOOL_LABELS[name] ?? name
}

/** Short description of a call for the trace row, shown before it runs. */
export function describeCall(call: ToolCall): string {
  const args = parseArgs(call.arguments)

  switch (call.name) {
    case 'interact_with_preview':
      return `${String(args.action ?? 'act')}${args.target ? ` "${String(args.target)}"` : ''}`
    case 'read_project_file':
      return String(args.path ?? 'file')
    default:
      return label(call.name)
  }
}
