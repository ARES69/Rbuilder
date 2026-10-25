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
import type { EditBlock } from '../src/lib/edits'

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

describe('ask mode', () => {
  const proposal = (text: string, tool?: boolean): Event[] => [
    { type: 'delta', delta: `${text}\n\n\`\`\`file:index.html\n<h1>v2</h1>\n\`\`\`\n` },
    ...(tool ? [{ type: 'tool_call', id: 'c1', name: 'inspect_preview', arguments: '{}' }] : []),
  ]

  it('applies a batch only after approval', async () => {
    installProvider(() => proposal('Making the banner.'))
    const applied: string[] = []
    let asked = 0

    const result = await runAgentTurn({ turns: ASK, mode: 'ask' }, {
      ...recorder().hooks,
      onFiles: (written) => applied.push(...written.map((file) => file.path)),
      requestApproval: async (files) => {
        asked += 1
        expect(files.map((file) => file.path)).toEqual(['index.html'])
        return true
      },
    })

    expect(asked).toBe(1)
    expect(applied).toEqual(['index.html'])
    expect(result.files).toEqual(['index.html'])
  })

  it('tells the model when a batch is rejected and applies nothing', async () => {
    const bodies = installProvider((step) => (step === 1 ? proposal('Proposal.', true) : [{ type: 'delta', delta: 'Adjusted.' }]))
    const rec = recorder()
    const applied: string[] = []
    let decisions = 0

    const result = await runAgentTurn({ turns: ASK, mode: 'ask' }, {
      ...rec.hooks,
      onFiles: (written) => applied.push(...written.map((file) => file.path)),
      requestApproval: async () => {
        decisions += 1
        return decisions !== 1
      },
    })

    expect(decisions).toBe(1)
    expect(applied).toEqual([])
    expect(result.files).toEqual([])
    // The next provider call must carry the rejection, before the tool results.
    const turns = bodies[1]!.turns
    const rejectNote = turns.findIndex((turn) => turn.role === 'user' && turn.content.includes('rejected'))
    const toolResult = turns.findIndex((turn) => turn.role === 'tool')
    const assistant = turns.findIndex((turn) => turn.role === 'assistant' && 'toolCalls' in turn && turn.toolCalls.length > 0)
    expect(assistant).toBeGreaterThan(-1)
    expect(rejectNote).toBeGreaterThan(assistant)
    expect(toolResult).toBeGreaterThan(rejectNote)
    expect(rec.started).toEqual(['inspect_preview'])
  })

  it('replaces an earlier proposal of the same file instead of stacking copies', async () => {
    installProvider((step) =>
      step === 1
        ? [
            { type: 'delta', delta: '```file:index.html\n<h1>one</h1>\n```\n' },
            { type: 'tool_call', id: 'c1', name: 'inspect_preview', arguments: '{}' },
          ]
        : [{ type: 'delta', delta: '```file:index.html\n<h1>two</h1>\n```' }],
    )
    const approved: string[] = []
    const rec = recorder()

    await runAgentTurn({ turns: ASK, mode: 'ask' }, {
      ...rec.hooks,
      requestApproval: async (files) => {
        approved.push(files.map((file) => `${file.path}:${file.content}`)[0] ?? '')
        return false
      },
    })

    // Two gates, one per step; each carries the fresh content of that step.
    expect(approved).toEqual(['index.html:<h1>one</h1>', 'index.html:<h1>two</h1>'])
  })
})

describe('ask mode: commands', () => {
  const commandStep = (id: string): Event[] => [
    { type: 'delta', delta: 'Checking the file.' },
    { type: 'tool_call', id, name: 'run_command', arguments: JSON.stringify({ command: 'node --check app.js' }) },
  ]

  it('runs an approved command and hands its result to the model', async () => {
    installProvider((step) => (step === 1 ? commandStep('c1') : [{ type: 'delta', delta: 'It is fine.' }]))
    const rec = recorder()
    const asked: string[] = []
    const executed: string[] = []

    await runAgentTurn({ turns: ASK, mode: 'ask' }, {
      ...rec.hooks,
      execute: async (call) => {
        executed.push(call.name)
        return { ok: true, summary: 'node --check app.js', text: 'Exited with code 0.' }
      },
      requestCommandApproval: async (command) => {
        asked.push(command)
        return true
      },
    })

    expect(asked).toEqual(['node --check app.js'])
    expect(executed).toEqual(['run_command'])
    expect(rec.started).toEqual(['run_command'])
  })

  it('asks before every command even when the previous one was allowed', async () => {
    installProvider((step) => (step === 1 ? commandStep('c1') : step === 2 ? commandStep('c2') : [{ type: 'delta', delta: 'Done.' }]))
    const rec = recorder()
    const asked: string[] = []
    let executed = 0

    await runAgentTurn({ turns: ASK, mode: 'ask' }, {
      ...rec.hooks,
      execute: async () => {
        executed += 1
        return { ok: true, summary: 'ls', text: 'index.html' }
      },
      requestCommandApproval: async (command) => {
        asked.push(command)
        return true
      },
    })

    expect(asked).toEqual(['node --check app.js', 'node --check app.js'])
    expect(executed).toBe(2)
  })

  it('declines a rejected command without executing it and tells the model', async () => {
    const bodies = installProvider((step) => (step === 1 ? commandStep('c1') : [{ type: 'delta', delta: 'Understood.' }]))
    const rec = recorder()
    let executed = 0

    await runAgentTurn({ turns: ASK, mode: 'ask' }, {
      ...rec.hooks,
      execute: async () => {
        executed += 1
        return { ok: true, summary: 'never', text: 'must not run' }
      },
      requestCommandApproval: async () => false,
    })

    expect(executed).toBe(0)
    expect(rec.started).toEqual(['run_command'])
    // The rejection travels as the tool result of the same call.
    const toolResult = bodies[1]!.turns.find(
      (turn) => turn.role === 'tool' && 'toolCallId' in turn && turn.toolCallId === 'c1',
    )
    expect(toolResult?.content).toContain('declined')
  })

  it('leaves non-command tools ungated in ask mode', async () => {
    installProvider((step) =>
      step === 1
        ? [
            { type: 'delta', delta: 'Looking.' },
            { type: 'tool_call', id: 'c1', name: 'inspect_preview', arguments: '{}' },
          ]
        : [{ type: 'delta', delta: 'Seen.' }],
    )
    const rec = recorder()
    let asked = 0

    await runAgentTurn({ turns: ASK, mode: 'ask' }, {
      ...rec.hooks,
      requestCommandApproval: async () => {
        asked += 1
        return false
      },
    })

    expect(asked).toBe(0)
    expect(rec.started).toEqual(['inspect_preview'])
  })

  it('defaults to decline when no command hook is provided', async () => {
    installProvider((step) => (step === 1 ? commandStep('c1') : [{ type: 'delta', delta: 'Ok.' }]))
    const rec = recorder()
    let executed = 0

    await runAgentTurn({ turns: ASK, mode: 'ask' }, {
      ...rec.hooks,
      execute: async () => {
        executed += 1
        return { ok: true, summary: 'never', text: 'must not run' }
      },
    })

    expect(executed).toBe(0)
  })
})

describe('search-and-replace edits', () => {
  const editStep = (id: string, tool = false): Event[] => [
    { type: 'delta', delta: '```edit:app.js\n<<<<<<< SEARCH\nconst seconds = 60\n=======\nconst seconds = 25\n>>>>>>> REPLACE\n```\n' },
    ...(tool ? [{ type: 'tool_call', id, name: 'inspect_preview', arguments: '{}' }] : []),
  ]

  /** Stands in for App.tsx: resolves a pair against a fixed project. */
  const resolver = (project: Record<string, string>, failures: string[] = []) => ({
    resolveEdits: (blocks: EditBlock[]) => ({
      writes: blocks.flatMap((block) => {
        const current = project[block.path]
        if (!current) {
          failures.push(block.path)
          return []
        }
        return [{ path: block.path, content: `${current} :: edited` }]
      }),
      failures: failures
        .filter((path) => !project[path])
        .map((path) => ({ path, reason: 'the file does not exist yet' })),
    }),
  })

  it('applies an edit block as a whole-file write', async () => {
    installProvider((step) => (step === 1 ? editStep('c1') : [{ type: 'delta', delta: 'Done.' }]))
    const rec = recorder()
    const written: { path: string; content: string }[] = []

    const result = await runAgentTurn({ turns: ASK, mode: 'build' }, {
      ...rec.hooks,
      onFiles: (fresh) => written.push(...fresh),
      ...resolver({ 'app.js': 'const seconds = 60' }),
    })

    expect(written).toEqual([{ path: 'app.js', content: 'const seconds = 60 :: edited' }])
    expect(result.files).toEqual(['app.js'])
  })

  it('reports an edit that matched nothing and applies nothing for it', async () => {
    const bodies = installProvider((step) =>
      step === 1
        ? [
            { type: 'delta', delta: '```edit:ghost.js\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE\n```\n' },
            { type: 'tool_call', id: 'c1', name: 'inspect_preview', arguments: '{}' },
          ]
        : [{ type: 'delta', delta: 'Retrying.' }],
    )
    const rec = recorder()
    const written: string[] = []
    const missing: string[] = []

    await runAgentTurn({ turns: ASK, mode: 'build' }, {
      ...rec.hooks,
      onFiles: (fresh) => written.push(...fresh.map((file) => file.path)),
      ...resolver({}, missing),
    })

    expect(written).toEqual([])
    expect(missing).toEqual(['ghost.js'])
    // The next step must know the edit failed, before the tool results.
    const note = bodies[1]!.turns.find(
      (turn) => turn.role === 'user' && turn.content.includes('not applied'),
    )
    expect(note?.content).toContain('ghost.js')
  })

  it('applies the same edit block once even when the model repeats it', async () => {
    installProvider((step) => (step <= 2 ? editStep(`c${step}`, step === 1) : [{ type: 'delta', delta: 'Done.' }]))
    const rec = recorder()
    const written: string[] = []

    await runAgentTurn({ turns: ASK, mode: 'build' }, {
      ...rec.hooks,
      onFiles: (fresh) => written.push(...fresh.map((file) => file.path)),
      ...resolver({ 'app.js': 'const seconds = 60' }),
    })

    expect(written).toEqual(['app.js'])
  })

  it('waits for approval in ask mode and lands the resolved file', async () => {
    installProvider((step) => (step === 1 ? editStep('c1', true) : [{ type: 'delta', delta: 'Approved.' }]))
    const rec = recorder()
    const approved: string[] = []

    const result = await runAgentTurn({ turns: ASK, mode: 'ask' }, {
      ...rec.hooks,
      ...resolver({ 'app.js': 'const seconds = 60' }),
      requestApproval: async (batch) => {
        approved.push(...batch.map((file) => `${file.path}:${file.content}`))
        return true
      },
    })

    expect(approved).toEqual(['app.js:const seconds = 60 :: edited'])
    expect(result.files).toEqual(['app.js'])
  })

  it('tells the model when an edit batch is rejected', async () => {
    const bodies = installProvider((step) => (step === 1 ? editStep('c1', true) : [{ type: 'delta', delta: 'Understood.' }]))
    const rec = recorder()

    await runAgentTurn({ turns: ASK, mode: 'ask' }, {
      ...rec.hooks,
      ...resolver({ 'app.js': 'const seconds = 60' }),
      requestApproval: async () => false,
    })

    const note = bodies[1]!.turns.find((turn) => turn.role === 'user' && turn.content.includes('rejected'))
    expect(note?.content).toContain('app.js')
    expect(rec.files).toEqual([])
  })

  it('resolves an edit against a file created in the same batch', async () => {
    installProvider((step) =>
      step === 1
        ? [
            {
              type: 'delta',
              delta: '```file:new.html\n<h1>hi</h1>\n```\n```edit:new.html\n<<<<<<< SEARCH\nhi\n=======\nhello\n>>>>>>> REPLACE\n```\n',
            },
          ]
        : [{ type: 'delta', delta: 'Done.' }],
    )
    const rec = recorder()
    let base: { path: string; content: string }[] = []

    await runAgentTurn({ turns: ASK, mode: 'ask' }, {
      ...rec.hooks,
      resolveEdits: (blocks, incoming) => {
        base = incoming
        return {
          writes: blocks.map((block) => ({ path: block.path, content: 'hello' })),
          failures: [],
        }
      },
      requestApproval: async () => true,
    })

    expect(base.map((file) => file.path)).toEqual(['new.html'])
  })

  it('holds edit blocks in plan mode and never resolves them', async () => {
    installProvider((step) => (step === 1 ? editStep('c1') : [{ type: 'delta', delta: 'Planned.' }]))
    const rec = recorder()
    let resolved = 0

    const result = await runAgentTurn({ turns: ASK, mode: 'plan' }, {
      ...rec.hooks,
      resolveEdits: () => {
        resolved += 1
        return { writes: [], failures: [] }
      },
    })

    expect(resolved).toBe(0)
    expect(result.files).toEqual([])
    expect(result.prose).toContain('app.js')
  })

  it('runs the tool calls of one step one after another, in the order they arrived', async () => {
    // A provider may ask for several tools in a single answer. They are run one
    // at a time: a slow first call must finish before the second one starts, and
    // both results must reach the model in the order it asked for them.
    const bodies = installProvider((step) =>
      step > 1
        ? [{ type: 'delta', delta: 'All done.' }]
        : [
            { type: 'delta', delta: 'Checking two things.' },
            { type: 'tool_call', id: 'a', name: 'inspect_preview', arguments: '{}' },
            { type: 'tool_call', id: 'b', name: 'run_checks', arguments: '{}' },
          ],
    )
    const rec = recorder()
    const log: string[] = []

    const result = await runAgentTurn(
      { turns: ASK, mode: 'build' },
      {
        ...rec.hooks,
        onToolStart: (call) => log.push(`start:${call.id}`),
        onToolEnd: (call) => log.push(`end:${call.id}`),
        execute: async (call) => {
          // A slow first call would appear after `start:b` if the two overlapped.
          await new Promise((resolve) => setTimeout(resolve, call.id === 'a' ? 50 : 1))
          return { ok: true, summary: 'checked', text: `result of ${call.name}` }
        },
      },
    )

    expect(result.toolCalls).toBe(2)
    expect(log).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
    expect(bodies[1]!.turns.flatMap((turn) => (turn.role === 'tool' ? [turn.toolCallId] : []))).toEqual(['a', 'b'])
  })
})
