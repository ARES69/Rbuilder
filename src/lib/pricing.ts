/**
 * What a turn actually costs.
 *
 * The budget already counts tokens, which bounds a runaway turn but says nothing
 * about money: 200k tokens means very different amounts on a local model and on
 * a frontier one. This turns the usage the provider reports into a cost, and —
 * just as important — says so honestly when it cannot.
 *
 * Two rules shape the whole module:
 *
 * - **Input and output are priced separately.** They differ by up to 40× on
 *   some models, and an agent turn is input-heavy: every tool result goes back
 *   in. Billing a turn by its average price would be wrong by a lot.
 * - **An unknown model costs an unknown amount, not zero.** Reporting `$0.00`
 *   for a model whose price is not listed here would be the most damaging thing
 *   this module could do, because that reads as "free". Unknown is its own
 *   state, and the interface shows it.
 *
 * Prices are a snapshot, per million tokens, and dated. They go stale; the date
 * is part of the data rather than a comment so the interface can say so.
 */

/** US dollars per million tokens. */
export type ModelPrice = {
  input: number
  output: number
}

export type PricingEntry = ModelPrice & {
  /** The model id as the provider spells it. */
  id: string
  /** Prefix this entry covers, for models whose ids carry a date suffix. */
  matches?: RegExp
}

export const PRICING_SNAPSHOT = '2026-10-02'

/**
 * The models this app actually offers by default. A model missing here is
 * reported as unpriced rather than silently counted as free.
 */
export const MODEL_PRICES: PricingEntry[] = [
  { id: 'gpt-4o-mini', input: 0.15, output: 0.6 },
  { id: 'gpt-4o', input: 2.5, output: 10 },
  { id: 'gpt-4.1-mini', input: 0.4, output: 1.6 },
  { id: 'gpt-4.1', input: 2, output: 8 },
  { id: 'o4-mini', input: 1.1, output: 4.4 },
  // Provider-prefixed ids, as OpenRouter and friends spell them.
  { id: 'openai/gpt-4o-mini', input: 0.15, output: 0.6 },
  { id: 'openai/gpt-4o', input: 2.5, output: 10 },
]

/** Providers that run on the user's own machine: no per-token billing. */
const LOCAL_PROVIDER_KINDS = new Set(['ollama', 'lmstudio'])

export type TokenSplit = {
  input: number
  output: number
}

export type CostResult =
  | { kind: 'free'; reason: 'local'; split: TokenSplit }
  | { kind: 'priced'; cost: number; price: ModelPrice; split: TokenSplit }
  /** The provider bills, but this model is not in the table. */
  | { kind: 'unpriced'; split: TokenSplit }
  /** Nothing to bill yet: a provider that reports no usage. */
  | { kind: 'unknown'; split: TokenSplit }

/**
 * Splits a reported total into input and output.
 *
 * The stream gives a total, not a split, and an agent turn's tokens are mostly
 * input (the conversation and every tool result). Charging the whole total at
 * the input rate would overstate the cost, and at the output rate would
 * overstate it far more, so `inputShare` is an explicit, documented assumption
 * rather than a hidden one. A provider that does report the split overrides it.
 */
export const DEFAULT_INPUT_SHARE = 0.85

export function splitTokens(totalTokens: number, inputShare = DEFAULT_INPUT_SHARE): TokenSplit {
  const safe = Number.isFinite(totalTokens) && totalTokens > 0 ? totalTokens : 0
  const input = Math.round(safe * inputShare)
  return { input, output: safe - input }
}

/** Looks up a model by id, allowing a date or provider suffix. */
export function priceFor(model: string): ModelPrice | null {
  const id = model.trim().toLowerCase()
  if (!id) return null
  for (const entry of MODEL_PRICES) {
    if (entry.id.toLowerCase() === id) return { input: entry.input, output: entry.output }
    if (entry.matches?.test(id)) return { input: entry.input, output: entry.output }
  }
  // `gpt-4o-2024-08-06` should still price as `gpt-4o`. Longest prefix first, so
  // `gpt-4o-mini` is never read as `gpt-4o`.
  const candidates = MODEL_PRICES.map((entry) => entry.id).sort((a, b) => b.length - a.length)
  for (const prefix of candidates) {
    if (id.startsWith(prefix)) return priceFor(prefix)
  }
  return null
}

/** The cost of one turn, in dollars. */
export function costOf(
  usage: TokenSplit,
  model: string,
  providerKind?: string,
): CostResult {
  if (providerKind && LOCAL_PROVIDER_KINDS.has(providerKind)) {
    return { kind: 'free', reason: 'local', split: usage }
  }
  const price = priceFor(model)
  if (!price) return { kind: 'unpriced', split: usage }
  if (usage.input === 0 && usage.output === 0) return { kind: 'unknown', split: usage }
  const cost = (usage.input / 1_000_000) * price.input + (usage.output / 1_000_000) * price.output
  return { kind: 'priced', cost, price, split: usage }
}

/**
 * Money, for the interface.
 *
 * Sub-cent amounts are shown in cents rather than rounded to `$0.00`: a turn
 * that genuinely costs $0.003 must not read as free.
 */
export function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return '$0.00'
  if (cost < 0.01) return `$${(cost * 100).toFixed(2)}¢`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

/** One line for the interface: "$0.042 · 6.2k tokens", or the honest unknown. */
export function describeCost(result: CostResult): string {
  const total = result.split.input + result.split.output
  switch (result.kind) {
    case 'free':
      return 'локальная модель · без оплаты'
    case 'priced':
      return `${formatCost(result.cost)} · ${total} токенов`
    case 'unpriced':
      // The number of tokens is still worth showing even when the money is not
      // known; only the price is missing.
      return `цена неизвестна · ${total} токенов`
    case 'unknown':
      return 'провайдер не сообщил расход'
  }
}

/**
 * The cost as far as it fits next to the model picker.
 *
 * `describeCost` is a sentence with a token count in it, and a sentence in the
 * composer row either gets clipped mid-word or pushes the send button off the
 * line. What is left is a badge; the sentence stays in the tooltip.
 */
export function shortCost(result: CostResult): string {
  switch (result.kind) {
    case 'free':
      return 'локально'
    case 'priced':
      return formatCost(result.cost)
    case 'unpriced':
      return 'цена ?'
    case 'unknown':
      return 'нет данных'
  }
}

/** Running total for a session, kept in one place so the arithmetic agrees. */
export type SessionSpend = {
  cost: number
  /** True while every turn so far had a known price. */
  complete: boolean
  turns: number
}

export const EMPTY_SPEND: SessionSpend = { cost: 0, complete: true, turns: 0 }

/** Adds a turn to the running total. An unpriced turn makes it incomplete. */
export function addSpend(current: SessionSpend, result: CostResult): SessionSpend {
  if (result.kind === 'free' || result.kind === 'unknown') {
    return { ...current, turns: current.turns + 1 }
  }
  if (result.kind === 'unpriced') {
    return { cost: current.cost, complete: false, turns: current.turns + 1 }
  }
  return { cost: current.cost + result.cost, complete: current.complete, turns: current.turns + 1 }
}