/**
 * The turn loop used to stop after five tool rounds, which cut off real work.
 * It now runs against a time and token budget that it manages itself, so these
 * tests drive a stubbed provider and watch how many steps it is allowed and
 * what the model is told at each one.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS, HARD_STEP_CAP, type Budget } from '../src/lib/budget'
import type { ChatTurn } from '../src/lib/protocol'
import { runAgentTurn, type TurnHooks } from '../src/lib/turn'

type RequestBody = {
  turns: ChatTurn[]
  mode: string
  tools: boolean
  wrapUp: boolean
  budget?: { msLeft: number; tokensLeft: number; round: number }
}

type Event = Record<string, unknown>

const originalFetch = globalThis.fetch

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/** Answers every request from `script`, recording the bodies it was sent. */
function installProvider(script: (step: number, body: RequestBody) => Event[]): RequestBody[] {
  const bodies: RequestBody[] = []

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const body = JSON.parse(String(init?.body ?? '{}')) as RequestBody
    bodies.push(body)
    const text = script(bodies.length, body)
      .map((event) => `${JSON.stringify(event)}\n`)
      .join('')

    return new Response(streamOf(text), {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
  }) as typeof fetch

  return bodies
}

/** A provider that asks for a tool on its first `tools` steps, then finishes. */
function toolsThenDone(tools: number, usage?: number): (step: number) => Event[] {
  return (step) => {
    if (step > tools) return [{ type: 'delta', delta: 'All done.' }]
    return [
      { type: 'delta', delta: `Step ${step}.` },
      { type: 'tool_call', id: `call_${step}`, name: 'inspect_preview', arguments: '{}' },
      ...(usage ? [{ type: 'usage', totalTokens: usage }] : []),
    ]
  }
}

type Recorder = {
  hooks: TurnHooks
  started: string[]
  budgets: Budget[]
  wrapping: boolean[]
  files: string[]
}

function recorder(): Recorder {
  const started: string[] = []
  const budgets: Budget[] = []
  const wrapping: boolean[] = []
  const files: string[] = []

  return {
    started,
    budgets,
    wrapping,
    files,
    hooks: {
      onReply: () => {},
      onFiles: (written) => files.push(...written.map((file) => file.path)),
      onPlan: () => {},
      onToolStart: (call) => started.push(call.name),
      onToolEnd: () => {},
      onBudget: (budget, isWrappingUp) => {
        budgets.push(budget)
        wrapping.push(isWrappingUp)
      },
      execute: async (call) => ({ ok: true, summary: 'checked', text: `result of ${call.name}` }),
    },
  }
}

const ASK: ChatTurn[] = [{ role: 'user', content: 'Build a timer' }]

beforeEach(() => {
  globalThis.fetch = originalFetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('agent turn', () => {
  it('keeps working well past five tool rounds', async () => {
    installProvider(toolsThenDone(8))
    const rec = recorder()

    const result = await runAgentTurn({ turns: ASK, mode: 'build' }, rec.hooks)

    expect(result.toolCalls).toBe(8)
    expect(result.steps).toBe(9)
    expect(result.ok).toBe(true)
    expect(result.spent).toBe(false)
    expect(rec.started).toHaveLength(8)
  })

  it('tells the model what is left of its budget at every step', async () => {
    const bodies = installProvider(toolsThenDone(3))
    const rec = recorder()

    await runAgentTurn({ turns: ASK, mode: 'build' }, rec.hooks)

    expect(bodies).toHaveLength(4)
    expect(bodies[0]!.budget).toEqual({ msLeft: expect.any(Number), tokensLeft: DEFAULT_LIMITS.tokens, round: 0 })
    expect(bodies[1]!.budget!.round).toBe(1)
    // Each step spends something, so the numbers must actually move.
    const left = bodies.map((body) => body.budget!.tokensLeft)
    expect(left[0]!).toBeGreaterThan(left[left.length - 1]!)
    expect(bodies.every((body) => body.tools)).toBe(true)
    expect(bodies.every((body) => body.wrapUp === false)).toBe(true)
  })

  it('reports the budget to the interface as it drains', async () => {
    installProvider(toolsThenDone(2))
    const rec = recorder()

    const result = await runAgentTurn({ turns: ASK, mode: 'build' }, rec.hooks)

    expect(rec.budgets.length).toBeGreaterThan(1)
    expect(rec.budgets[0]!.rounds).toBe(0)
    expect(rec.budgets.at(-1)!.rounds).toBe(result.steps)
    expect(rec.budgets.at(-1)!.tokens).toBe(result.budget.tokens)
  })

  it('takes exact usage from the provider over its own estimate', async () => {
    installProvider(toolsThenDone(1, 42_000))
    const rec = recorder()

    const result = await runAgentTurn({ turns: ASK, mode: 'build' }, rec.hooks)

    expect(result.budget.exactTokens).toBe(true)
    expect(result.budget.tokens).toBe(42_000)
  })

  it('withdraws tools and asks the model to land when time is nearly up', async () => {
    const bodies = installProvider(toolsThenDone(50))
    const rec = recorder()

    const result = await runAgentTurn({ turns: ASK, mode: 'build', limits: { timeMs: 50 } }, rec.hooks)

    expect(bodies[0]!.tools).toBe(false)
    expect(bodies[0]!.wrapUp).toBe(true)
    expect(bodies.every((body) => body.tools === false)).toBe(true)
    expect(rec.wrapping.at(-1)).toBe(true)
    expect(result.spent).toBe(true)
    expect(result.prose).toContain('budget is spent')
  })

  it('stops a turn that never finishes and says so', async () => {
    installProvider(toolsThenDone(Number.MAX_SAFE_INTEGER))
    const rec = recorder()

    const result = await runAgentTurn({ turns: ASK, mode: 'build', limits: { timeMs: 60_000, tokens: 400 } }, rec.hooks)

    expect(result.steps).toBeLessThanOrEqual(HARD_STEP_CAP)
    expect(result.spent).toBe(true)
    // A real answer, not a truncated thought: the last step had no tools offered.
    expect(result.prose).toContain('Step')
  })

  it('stops the loop when the user aborts', async () => {
    installProvider(toolsThenDone(50))
    const rec = recorder()
    const controller = new AbortController()
    controller.abort()

    const result = await runAgentTurn({ turns: ASK, mode: 'build' }, rec.hooks, controller.signal)

    expect(result.stopped).toBe(true)
    expect(result.ok).toBe(false)
    expect(rec.started).toHaveLength(0)
  })
})
