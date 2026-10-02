import { describe, expect, it } from 'vitest'
import { describeCall, executeTool, makeRunCommandHandler, type ToolContext } from '../src/lib/tools'
import type { ToolCall } from '../src/lib/protocol'

/** The preview inspector is only touched by the preview tools; commands stub it out. */
const baseContext = {} as ToolContext

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: 'call_1', name, arguments: JSON.stringify(args) }
}

describe('run_command tool', () => {
  it('reports that commands are unavailable without a handler', async () => {
    const outcome = await executeTool(call('run_command', { command: 'ls' }), baseContext)

    expect(outcome.ok).toBe(false)
    expect(outcome.text).toContain('not available')
  })

  it('refuses an empty command before reaching the terminal', async () => {
    const handler = makeRunCommandHandler({ files: [] })
    const outcome = await handler('   ')

    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toContain('пусто')
  })

  it('collects stdout and the exit code into the tool result', async () => {
    const seen: string[] = []
    const handler = makeRunCommandHandler({
      files: [{ path: 'app.js', content: 'console.log(1)' }],
      onEvent: (event) => {
        if (event.type === 'stdout' || event.type === 'stderr') seen.push(event.text)
      },
    })

    // Stub the network layer the handler posts to.
    const originalFetch = globalThis.fetch
    const ndjson = [
      { type: 'stdout', text: 'syntax ok' },
      { type: 'exit', code: 0, timedOut: false },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n')
      .concat('\n')
    globalThis.fetch = (async () => new Response(ndjson, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })) as typeof fetch

    try {
      const outcome = await handler('node --check app.js')
      expect(outcome.ok).toBe(true)
      expect(outcome.summary).toBe('node --check app.js')
      expect(outcome.text).toContain('stdout:')
      expect(outcome.text).toContain('syntax ok')
      expect(outcome.text).toContain('Exited with code 0')
      expect(seen).toEqual(['syntax ok'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('marks a failing exit code as not ok but still reports the output', async () => {
    const handler = makeRunCommandHandler({ files: [] })
    const originalFetch = globalThis.fetch
    const ndjson = [
      { type: 'stderr', text: 'SyntaxError' },
      { type: 'exit', code: 1, timedOut: false },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n')
      .concat('\n')
    globalThis.fetch = (async () => new Response(ndjson, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })) as typeof fetch

    try {
      const outcome = await handler('node --check broken.js')
      expect(outcome.ok).toBe(false)
      expect(outcome.text).toContain('stderr:')
      expect(outcome.text).toContain('Exited with code 1')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('passes the bound folder and the project files through to /api/exec', async () => {
    const bodies: Record<string, unknown>[] = []
    const handler = makeRunCommandHandler({
      files: [{ path: 'hello.txt', content: 'hi' }],
      cwd: 'C:/projects/demo',
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(`${JSON.stringify({ type: 'exit', code: 0, timedOut: false })}\\n`, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    }) as typeof fetch

    try {
      await handler('cat hello.txt')
      expect(bodies[0]).toMatchObject({
        command: 'cat hello.txt',
        files: [{ path: 'hello.txt', content: 'hi' }],
        cwd: 'C:/projects/demo',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('surfaces a server refusal as a failed outcome', async () => {
    const handler = makeRunCommandHandler({ files: [] })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'Blocked: privileged commands are not available here.' }), {
        status: 403,
      })) as typeof fetch

    try {
      const outcome = await handler('sudo rm -rf /')
      expect(outcome.ok).toBe(false)
      expect(outcome.text).toContain('rejected')
      expect(outcome.text).toContain('Blocked')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('describeCall shows the command itself', () => {
    const detail = describeCall(call('run_command', { command: 'node --check app.js' }))
    expect(detail).toBe('node --check app.js')
  })
})
