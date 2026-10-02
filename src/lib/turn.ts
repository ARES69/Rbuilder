/**
 * One conversational turn, which may take many provider steps: the model writes
 * prose and files, asks for tools, sees their results, and continues.
 *
 * How long it keeps going is bounded by a budget — wall-clock time and tokens —
 * rather than by a round cap, so a turn that needs eight inspections gets them
 * while one stuck in a loop does not burn twenty. The model is told what is left
 * at every step, the interface shows the same numbers, and the near-the-end step
 * arrives with tools withdrawn so the turn lands with a summary instead of
 * dying mid-thought.
 *
 * Files are applied as their blocks close, so the preview rebuilds during the
 * turn rather than at the end of it.
 */

import { streamStep, type ProviderProfile } from './agent'
import {
  createBudget,
  HARD_STEP_CAP,
  isExhausted,
  msLeft,
  noteRound,
  noteText,
  noteUsage,
  shouldWrapUp,
  tokensLeft,
  type Budget,
  type BudgetLimits,
} from './budget'
import { editSignature, type EditBlock, type EditFailure } from './edits'
import {
  extractFinal,
  extractReply,
  type AgentMode,
  type ChatTurn,
  type PlanItem,
  type ToolCall,
} from './protocol'
import type { ProjectFileInput } from './project'
import type { ToolOutcome } from './tools'

/** Tools whose every call the user must approve in ask mode before they run. */
export const GATED_TOOLS: ReadonlySet<string> = new Set(['run_command'])

export type TurnHooks = {
  /** Prose so far, with file and plan blocks removed. */
  onReply: (prose: string, filesWritten: string[]) => void
  /** Files whose blocks just closed. */
  onFiles: (files: ProjectFileInput[]) => void
  /** The current checklist (empty when there is none). */
  onPlan: (items: PlanItem[]) => void
  onToolStart: (call: ToolCall) => void
  onToolEnd: (call: ToolCall, outcome: ToolOutcome) => void
  /** Live budget after every step, so the interface can show it draining. */
  onBudget?: (budget: Budget, wrappingUp: boolean) => void
  onMeta?: (config: { configured: boolean; model?: string }) => void
  onUnconfigured?: (message: string) => void
  /**
   * Ask mode: the user must approve each batch of writes before it lands.
   * Resolves true to apply, false when rejected (the model is told).
   */
  requestApproval?: (files: ProjectFileInput[]) => Promise<boolean>
  /**
   * Ask mode: commands need the user's explicit yes before they run, like the
   * writes do. Resolves true to run, false when the user declined.
   */
  requestCommandApproval?: (command: string) => Promise<boolean>
  /**
   * Search-and-replace blocks are resolved against the project as it stands
   * when they are applied. `base` carries the whole-file writes that land first
   * in the same batch, so an edit in a file the same reply created still
   * matches. Returns whole new file contents plus the pairs that did not match.
   */
  resolveEdits?: (blocks: EditBlock[], base: ProjectFileInput[]) => {
    writes: ProjectFileInput[]
    failures: EditFailure[]
  }
  execute: (call: ToolCall) => Promise<ToolOutcome>
}

export type TurnResult = {
  ok: boolean
  configured: boolean
  error?: string
  prose: string
  files: string[]
  plan: PlanItem[]
  toolCalls: number
  /** Provider steps taken. */
  steps: number
  stopped: boolean
  /** True when the turn ended because the budget ran out, not because it was done. */
  spent: boolean
  budget: Budget
  /**
   * Input and output tokens across every step of this turn, when the provider
   * reported the split. The two are billed at different rates, so the caller
   * needs them apart to price the turn; without them it has to estimate.
   */
  usage: { input: number; output: number }
}

export async function runAgentTurn(
  input: { turns: ChatTurn[]; mode: AgentMode; provider?: ProviderProfile; limits?: Partial<BudgetLimits> },
  hooks: TurnHooks,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const isPlan = input.mode === 'plan'
  /** Ask mode holds writes the same way plan mode does, then gates on approval. */
  const isAsk = input.mode === 'ask'
  const stepTurns = input.turns.slice()
  const files: string[] = []
  /** In plan mode files are held back rather than written. */
  const prepared: string[] = []
  /** Ask mode holds the full writes (paths and content) until they are approved. */
  const preparedFiles: ProjectFileInput[] = []
  /** Ask mode holds the edit blocks of the same batch, resolved at the gate. */
  const preparedEdits: EditBlock[] = []
  /** A block the model repeats verbatim in a later step is not applied twice. */
  const appliedEdits = new Set<string>()
  /** Pairs that did not match, reported to the model on the next step. */
  let editFailures: EditFailure[] = []
  let budget = createBudget(input.limits)
  /**
   * Summed across steps, because a turn is many provider calls. Steps that only
   * report a total contribute nothing here, and the caller knows to fall back
   * to an estimate rather than billing a partial split as if it were complete.
   */
  let usage: { input: number; output: number } = { input: 0, output: 0 }
  let prose = ''
  let plan: PlanItem[] = []
  let configured = true
  let error: string | undefined
  let toolCallsRun = 0
  let stopped = false
  let spent = false

  hooks.onBudget?.(budget, false)

  for (;;) {
    const now = Date.now()

    if (budget.rounds >= HARD_STEP_CAP || isExhausted(budget, now)) {
      spent = true
      break
    }

    // One step means one trip to the model. Anything after it is another step.
    const wrappingUp = shouldWrapUp(budget, now)
    let raw = ''
    let appliedCount = 0
    let appliedEditCount = 0
    const calls: ToolCall[] = []

    /** Routes one freshly closed block to the mode it belongs to. */
    const takeEdits = (fresh: EditBlock[]) => {
      const unique = fresh.filter((block) => {
        const signature = editSignature(block)
        if (appliedEdits.has(signature)) return false
        appliedEdits.add(signature)
        return true
      })
      if (unique.length === 0) return

      if (isPlan) {
        for (const block of unique) if (!prepared.includes(block.path)) prepared.push(block.path)
        return
      }

      if (isAsk) {
        // One block per file in a batch: a later block for the same file wins.
        for (const block of unique) {
          const existing = preparedEdits.findIndex((entry) => entry.path === block.path)
          if (existing >= 0) preparedEdits[existing] = block
          else preparedEdits.push(block)
        }
        return
      }

      const resolved = resolveEditBlocks(unique, [])
      for (const write of resolved.writes) {
        if (!files.includes(write.path)) files.push(write.path)
      }
      if (resolved.writes.length > 0) hooks.onFiles(resolved.writes)
      editFailures.push(...resolved.failures)
    }

    /** Edits need the project as it is right now; the host owns it. */
    const resolveEditBlocks = (blocks: EditBlock[], base: ProjectFileInput[]) =>
      hooks.resolveEdits
        ? hooks.resolveEdits(blocks, base)
        : {
            writes: [] as ProjectFileInput[],
            failures: blocks.map((block) => ({ path: block.path, reason: 'editing is not available in this session' })),
          }

    const step = await streamStep(
      {
        turns: stepTurns,
        mode: input.mode,
        provider: input.provider,
        // Near the end tools are withdrawn: the model can only write up its work.
        tools: !wrappingUp,
        wrapUp: wrappingUp,
        budget: {
          msLeft: msLeft(budget, now),
          tokensLeft: tokensLeft(budget),
          round: budget.rounds,
        },
      },
      {
        onDelta: (delta) => {
          raw += delta
          const parsed = extractReply(raw)
          if (parsed.files.length > appliedCount) {
            const fresh = parsed.files.slice(appliedCount)
            appliedCount = parsed.files.length
            if (isPlan) {
              for (const file of fresh) if (!prepared.includes(file.path)) prepared.push(file.path)
            } else if (isAsk) {
              for (const file of fresh) {
                const existing = preparedFiles.findIndex((entry) => entry.path === file.path)
                if (existing >= 0) preparedFiles[existing] = file
                else preparedFiles.push(file)
              }
            } else {
              for (const file of fresh) if (!files.includes(file.path)) files.push(file.path)
              hooks.onFiles(fresh)
            }
          }
          if (parsed.edits.length > appliedEditCount) {
            const fresh = parsed.edits.slice(appliedEditCount)
            appliedEditCount = parsed.edits.length
            takeEdits(fresh)
          }
          if (parsed.plan.length > 0) {
            plan = parsed.plan
            hooks.onPlan(plan)
          }
          prose = parsed.display
          hooks.onReply(prose, files)
        },
        onToolCall: (call) => calls.push(call),
        onUsage: (totalTokens, split) => {
          budget = noteUsage(budget, totalTokens)
          if (split) usage = mergeUsage(usage, split)
          hooks.onBudget?.(budget, wrappingUp)
        },
        onMeta: (config) => hooks.onMeta?.(config),
        onUnconfigured: (message) => {
          configured = false
          raw = message
          hooks.onUnconfigured?.(message)
        },
      },
      signal,
    )

    // Providers that never report usage still get counted, roughly, from the
    // text they sent; exact numbers replace the estimate when they arrive.
    budget = noteText(budget, raw)
    budget = noteRound(budget)
    hooks.onBudget?.(budget, wrappingUp)

    if (step.error === 'stopped') stopped = true
    else if (step.error) error = step.error

    // Close anything left open at the end of the stream.
    const final = extractFinal(raw)
    if (final.files.length > appliedCount) {
      const fresh = final.files.slice(appliedCount)
      if (isPlan) {
        for (const file of fresh) if (!prepared.includes(file.path)) prepared.push(file.path)
      } else if (isAsk) {
        for (const file of fresh) {
          const existing = preparedFiles.findIndex((entry) => entry.path === file.path)
          if (existing >= 0) preparedFiles[existing] = file
          else preparedFiles.push(file)
        }
      } else {
        for (const file of fresh) if (!files.includes(file.path)) files.push(file.path)
        hooks.onFiles(fresh)
      }
    }
    if (final.edits.length > appliedEditCount) {
      const fresh = final.edits.slice(appliedEditCount)
      appliedEditCount = final.edits.length
      takeEdits(fresh)
    }
    if (final.plan.length > 0) {
      plan = final.plan
      hooks.onPlan(plan)
    }
    prose = final.display || prose
    hooks.onReply(prose, files)

    // Ask mode: the whole batch waits for the user before it lands. The gate
    // sits before the exit checks so the final batch of a turn is asked too.
    let rejectedPaths: string[] | null = null
    if (isAsk && (preparedFiles.length > 0 || preparedEdits.length > 0)) {
      const writes = preparedFiles.splice(0, preparedFiles.length)
      const blocks = preparedEdits.splice(0, preparedEdits.length)
      // Edits resolve against the writes of this same batch: a file created and
      // then changed in one reply is one card, and the edit must see the new text.
      const resolved = resolveEditBlocks(blocks, writes)
      const batch = [...writes, ...resolved.writes]
      editFailures.push(...resolved.failures)

      const approved = signal?.aborted
        ? false
        : await (hooks.requestApproval && batch.length > 0
            ? hooks.requestApproval(batch)
            : Promise.resolve(batch.length === 0))
      if (approved) {
        for (const file of batch) if (!files.includes(file.path)) files.push(file.path)
        if (batch.length > 0) {
          hooks.onFiles(batch)
          hooks.onReply(prose, files)
        }
      } else if (signal?.aborted) {
        stopped = true
        break
      } else {
        rejectedPaths = batch.map((file) => file.path)
      }
    }

    if (stopped || !step.ok || calls.length === 0) break

    // Record what the model asked for, then answer each call.
    stepTurns.push({
      role: 'assistant',
      content: [final.display, renderPlan(plan)].filter(Boolean).join('\n\n'),
      toolCalls: calls,
    })

    // A rejected batch reaches the model before its tool results do, so the
    // next step adjusts instead of repeating the same writes.
    if (rejectedPaths) {
      stepTurns.push({
        role: 'user',
        content: `The user rejected the proposed changes to ${rejectedPaths.join(', ')}. Nothing was applied. Change your approach — do not rewrite the same thing; adjust or ask what to change.`,
      })
    }

    // An edit whose SEARCH text was not in the file is the model's chance to
    // correct itself: it is told which file and which fragment, and nothing was
    // written for it.
    if (editFailures.length > 0) {
      const report = editFailures.map((failure) => `${failure.path} — ${failure.reason}`).join('; ')
      stepTurns.push({
        role: 'user',
        content: `Your edits were not applied: ${report}. Read the file again and repeat the edit with text that matches it exactly, or use a full file block if the file changed a lot.`,
      })
      editFailures = []
    }

    // Let React commit the rebuilt preview before a tool looks at the frame:
    // otherwise an inspection can read the document that is about to be replaced.
    await settle()

    for (const call of calls) {
      hooks.onToolStart(call)

      // Ask mode gates commands like writes: the user's yes comes first. A
      // declined command reaches the model as a tool result, so the next step
      // can pick a different way to verify.
      if (isAsk && GATED_TOOLS.has(call.name)) {
        const command = commandOf(call)
        if (command !== null) {
          const allowed = signal?.aborted
            ? false
            : await (hooks.requestCommandApproval
                ? hooks.requestCommandApproval(command)
                : Promise.resolve(false))
          if (!allowed) {
            toolCallsRun += 1
            const outcome: ToolOutcome = {
              ok: false,
              summary: command,
              text: `The user declined this command ("${command}"). Do not run it again; find another way to verify, or ask the user what to do.`,
            }
            hooks.onToolEnd(call, outcome)
            stepTurns.push({
              role: 'tool',
              content: outcome.text,
              toolCallId: call.id,
              name: call.name,
            })
            continue
          }
        }
      }

      const outcome = await hooks.execute(call)
      toolCallsRun += 1
      hooks.onToolEnd(call, outcome)
      stepTurns.push({
        role: 'tool',
        content: outcome.text,
        toolCallId: call.id,
        name: call.name,
      })
      // Tool results are the bulk of what a turn accumulates, so they count
      // against the budget too — otherwise the estimate drifts far too low.
      budget = noteText(budget, outcome.text)
    }
    hooks.onBudget?.(budget, wrappingUp)
  }

  return {
    ok: !error && !stopped,
    configured,
    error,
    prose: withNotes(prose, notesFor({ prepared, isPlan, spent, budget })),
    files,
    plan,
    toolCalls: toolCallsRun,
    steps: budget.rounds,
    stopped,
    spent,
    budget,
    usage,
  }
}

/** Adds one step's reported split to the turn's running total. */
function mergeUsage(
  current: { input: number; output: number },
  step: { input: number; output: number },
): { input: number; output: number } {
  return {
    input: current.input + Math.max(0, step.input),
    output: current.output + Math.max(0, step.output),
  }
}

/** The command a run_command call asks for, or null when there is none. */
function commandOf(call: ToolCall): string | null {
  if (call.name !== 'run_command') return null
  try {
    const parsed = JSON.parse(call.arguments || '{}') as { command?: unknown }
    if (typeof parsed.command === 'string' && parsed.command.trim()) return parsed.command.trim()
  } catch {
    /* malformed arguments fall through to null */
  }
  return null
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}

/**
 * Plan mode never writes, and a spent budget is reported rather than silently
 * truncating the work: both are things the model cannot say for itself.
 */
function notesFor(input: {
  prepared: string[]
  isPlan: boolean
  spent: boolean
  budget: Budget
}): string[] {
  const notes: string[] = []

  if (input.isPlan && input.prepared.length > 0) {
    const list = input.prepared.join(', ')
    notes.push(`Nothing was written: approve the plan and RBUILDER will write ${list}.`)
  }
  if (input.spent) {
    notes.push(
      `This turn's budget is spent (${input.budget.rounds} steps). Say what to do next and RBUILDER will pick up from here.`,
    )
  }

  return notes
}

function withNotes(prose: string, notes: string[]): string {
  if (notes.length === 0) return prose
  return [prose.trim(), ...notes].filter(Boolean).join('\n\n')
}

/** Keeps the checklist in the model's context across steps of one turn. */
function renderPlan(items: PlanItem[]): string {
  if (items.length === 0) return ''
  const lines = items.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`)
  return `\`\`\`plan\n${lines.join('\n')}\n\`\`\``
}
