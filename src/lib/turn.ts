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
}

export async function runAgentTurn(
  input: { turns: ChatTurn[]; mode: AgentMode; provider?: ProviderProfile; limits?: Partial<BudgetLimits> },
  hooks: TurnHooks,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const isPlan = input.mode === 'plan'
  const stepTurns = input.turns.slice()
  const files: string[] = []
  /** In plan mode files are held back rather than written. */
  const prepared: string[] = []
  let budget = createBudget(input.limits)
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
    const calls: ToolCall[] = []

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
            } else {
              for (const file of fresh) if (!files.includes(file.path)) files.push(file.path)
              hooks.onFiles(fresh)
            }
          }
          if (parsed.plan.length > 0) {
            plan = parsed.plan
            hooks.onPlan(plan)
          }
          prose = parsed.display
          hooks.onReply(prose, files)
        },
        onToolCall: (call) => calls.push(call),
        onUsage: (totalTokens) => {
          budget = noteUsage(budget, totalTokens)
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
      } else {
        for (const file of fresh) if (!files.includes(file.path)) files.push(file.path)
        hooks.onFiles(fresh)
      }
    }
    if (final.plan.length > 0) {
      plan = final.plan
      hooks.onPlan(plan)
    }
    prose = final.display || prose
    hooks.onReply(prose, files)

    if (stopped || !step.ok || calls.length === 0) break

    // Record what the model asked for, then answer each call.
    stepTurns.push({
      role: 'assistant',
      content: [final.display, renderPlan(plan)].filter(Boolean).join('\n\n'),
      toolCalls: calls,
    })

    // Let React commit the rebuilt preview before a tool looks at the frame:
    // otherwise an inspection can read the document that is about to be replaced.
    await settle()

    for (const call of calls) {
      hooks.onToolStart(call)
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
  }
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
