/**
 * How long an agent turn may keep working. A fixed round cap is arbitrary: a
 * turn that needs eight inspections and one that needs two both stop at five,
 * while a turn stuck in a loop gets five chances to burn time. A budget binds
 * the resources that actually run out — wall-clock time and tokens — and the
 * agent is told what is left so it can pace itself and land cleanly.
 *
 * Time is measured exactly. Token counts are exact when the provider reports
 * usage and estimated from text volume otherwise, so they are always labelled
 * as approximate in the interface.
 */

export type BudgetLimits = {
  timeMs: number
  tokens: number
}

export type Budget = {
  limits: BudgetLimits
  startedAt: number
  /** Provider steps taken in this turn. */
  rounds: number
  /** Exact or estimated tokens used. */
  tokens: number
  /** True once the provider reported real usage for a step. */
  exactTokens: boolean
}

export const DEFAULT_LIMITS: BudgetLimits = {
  timeMs: 5 * 60_000,
  tokens: 200_000,
}

/** Below this the agent is told to stop calling tools and finish. */
export const WRAP_UP_MS = 30_000

/**
 * A runaway guard, not a working limit: far beyond any real budget, so the
 * loop always terminates even if the provider never stops asking for tools.
 */
export const HARD_STEP_CAP = 200

/** Rough but stable: four characters per token is close for code and prose. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function createBudget(limits: Partial<BudgetLimits> = {}, now = Date.now()): Budget {
  return {
    limits: { ...DEFAULT_LIMITS, ...limits },
    startedAt: now,
    rounds: 0,
    tokens: 0,
    exactTokens: false,
  }
}

export function noteRound(budget: Budget): Budget {
  return { ...budget, rounds: budget.rounds + 1 }
}

export function noteText(budget: Budget, text: string): Budget {
  if (budget.exactTokens) return budget
  return { ...budget, tokens: budget.tokens + estimateTokens(text) }
}

/** Exact usage from the provider, when it reports one. */
export function noteUsage(budget: Budget, totalTokens: number): Budget {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return budget
  return { ...budget, tokens: Math.max(budget.tokens, Math.round(totalTokens)), exactTokens: true }
}

export function msLeft(budget: Budget, now = Date.now()): number {
  return Math.max(0, budget.limits.timeMs - (now - budget.startedAt))
}

export function tokensLeft(budget: Budget): number {
  return Math.max(0, budget.limits.tokens - budget.tokens)
}

/** Fraction of the budget already spent, 0…1 (the larger of the two). */
export function budgetUsed(budget: Budget, now = Date.now()): number {
  const time = (now - budget.startedAt) / budget.limits.timeMs
  const tokens = budget.limits.tokens === 0 ? 0 : budget.tokens / budget.limits.tokens
  return Math.min(1, Math.max(time, tokens))
}

export function isExhausted(budget: Budget, now = Date.now()): boolean {
  return msLeft(budget, now) <= 0 || tokensLeft(budget) <= 0
}

/** Time to stop opening new work and write up what was done. */
export function shouldWrapUp(budget: Budget, now = Date.now()): boolean {
  if (isExhausted(budget, now)) return false
  return msLeft(budget, now) <= WRAP_UP_MS || tokensLeft(budget) <= budget.limits.tokens * 0.05
}

export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 10_000) return `${(tokens / 1000).toFixed(1)}k`
  return `${Math.round(tokens / 1000)}k`
}

/** One line for the interface: "3:41 left · ≈38k of 200k tokens · 4 steps". */
export function describeBudget(budget: Budget, now = Date.now()): string {
  const parts = [`${formatDuration(msLeft(budget, now))} left`]
  parts.push(
    `${budget.exactTokens ? '' : '≈'}${formatTokens(budget.tokens)} of ${formatTokens(budget.limits.tokens)} tokens`,
  )
  if (budget.rounds > 0) parts.push(`${budget.rounds} ${budget.rounds === 1 ? 'step' : 'steps'}`)
  return parts.join(' · ')
}

/**
 * What the model is told about its own budget, in the system prompt. Formatted
 * on the server from the numbers the browser sends, so both sides agree.
 */
export function budgetNotice(
  remainingMs: number,
  remainingTokens: number,
  round: number,
): string {
  const seconds = Math.max(0, Math.round(remainingMs / 1000))
  const minutes = Math.floor(seconds / 60)
  const left = minutes > 0 ? `about ${minutes} minute${minutes === 1 ? '' : 's'}` : `about ${seconds} seconds`

  return `You have ${left} of tool time and roughly ${formatTokens(remainingTokens)} tokens left in this turn (step ${round + 1}). There is no fixed limit on how many tools you may call: keep working while it is useful, and stop when the work is done.`
}

/** Added to the last step when the budget is nearly spent. */
export const WRAP_UP_PROMPT =
  'Your tool budget is nearly used up. Do not call any more tools: finish this turn with a short summary of what you changed and anything still outstanding.'
