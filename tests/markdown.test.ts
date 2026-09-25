import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown, parseBlocks } from '../src/components/Markdown'

function render(text: string, compact = false): string {
  return renderToStaticMarkup(createElement(Markdown, { text, compact }))
}

describe('parseBlocks', () => {
  it('always makes progress on attachment fences', () => {
    // Regression: a fence whose info string is not a bare word (```attachment:x)
    // used to break out of the paragraph loop without consuming a line.
    const text = ['Here is what I used:', '', '```attachment:notes.md', '# Launch notes', '```'].join(
      '\n',
    )

    const blocks = parseBlocks(text)

    expect(blocks[0]).toEqual({ kind: 'paragraph', text: 'Here is what I used:' })
    expect(blocks.some((block) => block.kind === 'code')).toBe(true)
  })

  it('parses headings, lists and code fences', () => {
    const blocks = parseBlocks('## Plan\n\n- one\n- two\n\n```js\nconst a = 1\n```')

    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'list', 'code'])
  })

  it('treats an unknown line as a paragraph instead of looping', () => {
    const blocks = parseBlocks('```\n\n# heading')
    expect(blocks.length).toBeGreaterThan(0)
  })
})

describe('Markdown', () => {
  it('renders file markers as inline code', () => {
    const html = render('Done.\n`index.html`')

    expect(html).toContain('<code>index.html</code>')
  })

  it('renders attachment fences as code blocks', () => {
    const html = render('```attachment:notes.md\n# Launch notes\n```')

    expect(html).toContain('<pre')
    expect(html).toContain('# Launch notes')
  })

  it('can collapse file blocks in user messages', () => {
    const html = render('```file:index.html\n<html></html>\n```', true)

    expect(html).toContain('<details')
    expect(html).toContain('<summary>file:index.html</summary>')
  })

  it('never emits raw markup from model text', () => {
    const html = render('<img src=x onerror="alert(1)">')

    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})
