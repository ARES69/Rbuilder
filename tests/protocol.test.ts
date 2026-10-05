import { describe, expect, it } from 'vitest'
import {
  accumulateToolCalls,
  buildSystemPrompt,
  extractFilesFromText,
  extractFinal,
  extractPlan,
  extractReply,
  finalizeToolCalls,
  toProviderMessages,
} from '../src/lib/protocol'

describe('extractFilesFromText', () => {
  it('pulls a complete file block out of a reply', () => {
    const reply = [
      'Added a landing page with a hero and pricing table.',
      '',
      '```file:index.html',
      '<!doctype html>',
      '<html><body>hi</body></html>',
      '```',
    ].join('\n')

    const result = extractFilesFromText(reply)

    expect(result.files).toEqual([
      { path: 'index.html', content: '<!doctype html>\n<html><body>hi</body></html>' },
    ])
    expect(result.display).toBe('Added a landing page with a hero and pricing table.')
    expect(result.pending).toEqual([])
  })

  it('handles several files in one reply', () => {
    const reply = [
      'Done.',
      '```file:index.html',
      '<html></html>',
      '```',
      '```file:styles.css',
      'body { color: red }',
      '```',
      '```file:app.js',
      'console.log(1)',
      '```',
    ].join('\n')

    const result = extractFilesFromText(reply)

    expect(result.files.map((file) => file.path)).toEqual(['index.html', 'styles.css', 'app.js'])
    expect(result.display).toBe('Done.')
  })

  it('renders no prose markers: written files are shown as chips in the chat', () => {
    const result = extractFilesFromText('```file:index.html\n<html></html>\n```')

    expect(result.files).toHaveLength(1)
    expect(result.display).toBe('')
  })

  it('reports an in-progress block as pending and hides the partial body', () => {
    const reply = [
      'Writing the page now.',
      '',
      '```file:index.html',
      '<!doctype html>',
      '<html><body>partial',
    ].join('\n')

    const result = extractFilesFromText(reply)

    expect(result.files).toEqual([])
    expect(result.pending).toEqual(['index.html'])
    expect(result.display).toBe('Writing the page now.')
  })

  it('turns a partial block into a file once the fence closes', () => {
    const partial = 'Here it is.\n```file:index.html\n<html>'
    expect(extractFilesFromText(partial).files).toHaveLength(0)

    const complete = `${partial}\n</html>\n\`\`\``
    const result = extractFilesFromText(complete)

    expect(result.files).toEqual([{ path: 'index.html', content: '<html>\n</html>' }])
    expect(result.pending).toEqual([])
  })

  it('keeps unusable paths visible instead of swallowing them', () => {
    const reply = '```file:../escape.js\nbad\n```'

    const result = extractFilesFromText(reply)

    expect(result.files).toEqual([])
    expect(result.display).toContain('../escape.js')
  })

  it('leaves plain code fences for the markdown renderer', () => {
    const reply = 'Try this:\n```html\n<span>hi</span>\n```'
    const result = extractFilesFromText(reply)

    expect(result.files).toEqual([])
    expect(result.display).toContain('<span>hi</span>')
  })

  it('accepts a JSON envelope as a fallback', () => {
    const reply = JSON.stringify({
      reply: 'Built a timer.',
      files: [{ path: 'index.html', content: '<html></html>' }],
    })

    const result = extractFilesFromText(reply)

    expect(result.files).toEqual([{ path: 'index.html', content: '<html></html>' }])
    expect(result.display).toBe('Built a timer.')
  })

  it('pulls an edit block out of a reply and keeps it out of the prose', () => {
    const reply = [
      'Lowered the default to 25 seconds.',
      '',
      '```edit:app.js',
      '<<<<<<< SEARCH',
      'const seconds = 60',
      '=======',
      'const seconds = 25',
      '>>>>>>> REPLACE',
      '```',
    ].join('\n')

    const result = extractFilesFromText(reply)

    expect(result.files).toEqual([])
    expect(result.edits).toEqual([
      {
        path: 'app.js',
        edits: [{ search: 'const seconds = 60', replace: 'const seconds = 25' }],
      },
    ])
    expect(result.display).toBe('Lowered the default to 25 seconds.')
  })

  it('reads a new file and an edit to another file in one reply', () => {
    const reply = [
      'Done.',
      '```file:index.html',
      '<html></html>',
      '```',
      '```edit:app.js',
      '<<<<<<< SEARCH',
      'render()',
      '=======',
      'render(1)',
      '>>>>>>> REPLACE',
      '```',
    ].join('\n')

    const result = extractFilesFromText(reply)

    expect(result.files.map((file) => file.path)).toEqual(['index.html'])
    expect(result.edits.map((block) => block.path)).toEqual(['app.js'])
  })

  it('keeps an edit block visible when it holds no usable pair', () => {
    const result = extractFilesFromText('```edit:app.js\nnot an edit\n```')

    expect(result.edits).toEqual([])
    expect(result.display).toContain('edit:app.js')
  })

  it('reports an unterminated edit block as pending', () => {
    const result = extractFilesFromText('Working.\n```edit:app.js\n<<<<<<< SEARCH\nold')

    expect(result.edits).toEqual([])
    expect(result.pending).toEqual(['app.js'])
  })

  it('closes a trailing edit block at the end of the stream', () => {
    const result = extractFinal('Done.\n```edit:app.js\n<<<<<<< SEARCH\nold\n=======\nnew')

    expect(result.edits).toEqual([{ path: 'app.js', edits: [{ search: 'old', replace: 'new' }] }])
    expect(result.pending).toEqual([])
  })
})

describe('extractFinal', () => {
  it('closes an unterminated block at the end of the stream', () => {
    const reply = 'Here is the app.\n```file:index.html\n<!doctype html>\n<html><body>done</body></html>'

    const result = extractFinal(reply)

    expect(result.files).toEqual([
      { path: 'index.html', content: '<!doctype html>\n<html><body>done</body></html>' },
    ])
    expect(result.display).toBe('Here is the app.')
    expect(result.pending).toEqual([])
  })

  it('is a no-op for a normal finished reply', () => {
    const reply = 'Done.\n```file:index.html\n<html></html>\n```'
    const result = extractFinal(reply)

    expect(result.files).toEqual([{ path: 'index.html', content: '<html></html>' }])
    expect(result.display).toBe('Done.')
  })

  it('recovers a file block that never closed', () => {
    const result = extractFinal('Done.\n```file:index.html\n<html>\n<body>hi')

    expect(result.files).toEqual([{ path: 'index.html', content: '<html>\n<body>hi' }])
  })
})

describe('extractPlan', () => {
  it('reads a checklist and removes it from the prose', () => {
    const reply = [
      'I will build a timer in two steps.',
      '',
      '```plan',
      '- [x] Scaffold the page',
      '- [ ] Wire the countdown',
      '```',
    ].join('\n')

    const result = extractPlan(reply)

    expect(result.items).toEqual([
      { text: 'Scaffold the page', done: true },
      { text: 'Wire the countdown', done: false },
    ])
    expect(result.display).toBe('I will build a timer in two steps.')
  })

  it('keeps the last complete checklist', () => {
    const reply = [
      '```plan',
      '- [ ] one',
      '```',
      'Progress.',
      '```plan',
      '- [x] one',
      '- [ ] two',
      '```',
    ].join('\n')

    expect(extractPlan(reply).items).toEqual([
      { text: 'one', done: true },
      { text: 'two', done: false },
    ])
  })

  it('ignores a checklist that is still streaming', () => {
    const reply = '```plan\n- [ ] first'

    expect(extractPlan(reply).items).toEqual([])
  })
})

describe('extractReply', () => {
  it('separates prose, checklist and files in one reply', () => {
    const reply = [
      'Built the timer.',
      '```plan',
      '- [x] Scaffold',
      '```',
      '```file:index.html',
      '<html></html>',
      '```',
    ].join('\n')

    const result = extractReply(reply)

    expect(result.display).toBe('Built the timer.')
    expect(result.plan).toEqual([{ text: 'Scaffold', done: true }])
    expect(result.files).toEqual([{ path: 'index.html', content: '<html></html>' }])
  })
})

describe('tool call assembly', () => {
  it('rebuilds arguments that arrive in fragments', () => {
    const accumulator = new Map()

    accumulateToolCalls(accumulator, [
      { index: 0, id: 'call_1', function: { name: 'interact_with_preview', arguments: '{"act' } },
    ])
    accumulateToolCalls(accumulator, [{ index: 0, function: { arguments: 'ion":"click","target":' } }])
    accumulateToolCalls(accumulator, [{ index: 0, function: { arguments: '"Start"}' } }])

    const calls = finalizeToolCalls(accumulator)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      id: 'call_1',
      name: 'interact_with_preview',
      arguments: '{"action":"click","target":"Start"}',
    })
  })

  it('keeps parallel calls in index order and defaults empty arguments', () => {
    const accumulator = new Map()

    accumulateToolCalls(accumulator, [{ index: 1, id: 'b', function: { name: 'run_checks' } }])
    accumulateToolCalls(accumulator, [{ index: 0, id: 'a', function: { name: 'inspect_preview' } }])

    expect(finalizeToolCalls(accumulator).map((call) => [call.id, call.arguments])).toEqual([
      ['a', '{}'],
      ['b', '{}'],
    ])
  })

  it('drops fragments with no function name', () => {
    const accumulator = new Map()
    accumulateToolCalls(accumulator, [{ index: 0, function: { arguments: '{}' } }])

    expect(finalizeToolCalls(accumulator)).toEqual([])
  })
})

describe('toProviderMessages', () => {
  it('maps assistant tool calls and tool results', () => {
    const messages = toProviderMessages([
      { role: 'user', content: 'build it' },
      {
        role: 'assistant',
        content: 'Checking.',
        toolCalls: [{ id: 'call_1', name: 'run_checks', arguments: '{}' }],
      },
      { role: 'tool', content: 'all good', toolCallId: 'call_1', name: 'run_checks' },
    ])

    expect(messages[1]).toEqual({
      role: 'assistant',
      content: 'Checking.',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'run_checks', arguments: '{}' } }],
    })
    expect(messages[2]).toEqual({ role: 'tool', content: 'all good', tool_call_id: 'call_1' })
  })

  it('keeps plain turns plain', () => {
    expect(toProviderMessages([{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'user', content: 'hi' },
    ])
  })
})

describe('buildSystemPrompt', () => {
  it('plan mode forbids file blocks and asks for a checklist', () => {
    const prompt = buildSystemPrompt('plan')

    expect(prompt).toContain('PLAN MODE')
    expect(prompt).toContain('Do not emit any file or edit blocks')
    expect(prompt).not.toContain('inspect_preview()')
  })

  it('build mode documents the tools and the checklist', () => {
    const prompt = buildSystemPrompt('build')

    expect(prompt).toContain('inspect_preview()')
    expect(prompt).toContain('run_checks()')
    expect(prompt).toContain('```plan')
  })

  it('every writing mode teaches the edit format', () => {
    for (const mode of ['build', 'ask', 'plan'] as const) {
      const prompt = buildSystemPrompt(mode)

      expect(prompt, mode).toContain('edit:app.js')
      expect(prompt, mode).toContain('SEARCH')
      expect(prompt, mode).toContain('REPLACE')
    }
  })

  it('plan mode refuses edit blocks as well as file blocks', () => {
    expect(buildSystemPrompt('plan')).toContain('Do not emit any file or edit blocks')
  })

  it('every mode teaches the project instructions convention', () => {
    for (const mode of ['build', 'ask', 'plan'] as const) {
      const prompt = buildSystemPrompt(mode)

      expect(prompt, mode).toContain('RBUILDER.md')
      expect(prompt, mode).toContain('```project-instructions')
      expect(prompt, mode).toContain('Never rewrite RBUILDER.md')
    }
  })
})
