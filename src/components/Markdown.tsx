/**
 * A deliberately small markdown renderer: paragraphs, lists, headings, fenced
 * code and inline code/emphasis. No dependencies, no HTML injection — every
 * node is rendered by React, so model output can never become markup.
 */

import { Fragment, useMemo, type ReactNode } from 'react'

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; language: string; text: string }

export function Markdown({ text, compact = false }: { text: string; compact?: boolean }) {
  const blocks = useMemo(() => parseBlocks(text), [text])

  return (
    <div className="markdown">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const Tag = (block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4') as 'h2'
            return <Tag key={index}>{renderInline(block.text)}</Tag>
          }
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul'
            return (
              <Tag key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </Tag>
            )
          }
          case 'code':
            return compact ? (
              <details key={index} className="markdown-code-collapsible">
                <summary>{block.language.startsWith('file:') ? block.language : block.language || 'Code'}</summary>
                <pre className="markdown-code"><code>{block.text}</code></pre>
              </details>
            ) : (
              <pre key={index} className="markdown-code">
                <code>{block.text}</code>
              </pre>
            )
          default:
            return <p key={index}>{renderInline(block.text)}</p>
        }
      })}
    </div>
  )
}

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []

  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    // Any info string counts, including ```attachment:notes.md.
    const fence = /^```([^\s`]*)\s*$/.exec(trimmed)
    if (fence) {
      const body: string[] = []
      index += 1
      while (index < lines.length && lines[index]!.trim() !== '```') {
        body.push(lines[index]!)
        index += 1
      }
      index += 1
      blocks.push({ kind: 'code', language: fence[1] ?? '', text: body.join('\n') })
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() })
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index]!.trim())) {
        items.push(lines[index]!.trim().replace(/^[-*]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'list', ordered: false, items })
      continue
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index]!.trim())) {
        items.push(lines[index]!.trim().replace(/^\d+[.)]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'list', ordered: true, items })
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index]!.trim()
      if (!current || /^```/.test(current) || /^#{1,4}\s/.test(current) || /^[-*]\s+/.test(current)) break
      paragraph.push(current)
      index += 1
    }

    // Guarantee progress: never emit an empty paragraph without consuming input.
    if (paragraph.length === 0) {
      blocks.push({ kind: 'paragraph', text: trimmed })
      index += 1
      continue
    }

    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  INLINE.lastIndex = 0

  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))

    const token = match[0]
    const key = `${match.index}-${token.length}`

    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      nodes.push(
        link ? (
          <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>
        ) : (
          <Fragment key={key}>{token}</Fragment>
        ),
      )
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}
