import { describe, expect, it } from 'vitest'
import {
  attachmentsToContext,
  formatBytes,
  isTextLike,
  MAX_TEXT_BYTES,
  readAttachment,
  truncateBytes,
} from '../src/lib/attachments'

function makeFile(name: string, content: string | BlobPart[], type = ''): File {
  return new File(Array.isArray(content) ? content : [content], name, { type })
}

describe('isTextLike', () => {
  it('detects by media type and by extension', () => {
    expect(isTextLike('notes.md', '')).toBe(true)
    expect(isTextLike('data.csv', '')).toBe(true)
    expect(isTextLike('report', 'text/plain')).toBe(true)
    expect(isTextLike('config', 'application/json')).toBe(true)
    expect(isTextLike('bundle', 'application/octet-stream')).toBe(false)
    expect(isTextLike('photo.png', 'image/png')).toBe(false)
    expect(isTextLike('archive.zip', 'application/zip')).toBe(false)
  })
})

describe('formatBytes', () => {
  it('formats across magnitudes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('readAttachment', () => {
  it('reads text files and keeps the content', async () => {
    const attachment = await readAttachment(makeFile('notes.md', '# hello', 'text/markdown'))

    expect(attachment.kind).toBe('text')
    expect(attachment.text).toBe('# hello')
    expect(attachment.truncated).toBe(false)
  })

  it('marks binary files and does not read them', async () => {
    const attachment = await readAttachment(makeFile('logo.png', ['binary'], 'image/png'))

    expect(attachment.kind).toBe('binary')
    expect(attachment.text).toBeUndefined()
  })

  it('truncates very large text files', async () => {
    const attachment = await readAttachment(makeFile('big.txt', 'a'.repeat(MAX_TEXT_BYTES + 5000), 'text/plain'))

    expect(attachment.kind).toBe('text')
    expect(attachment.truncated).toBe(true)
    expect(attachment.text!.length).toBeLessThanOrEqual(MAX_TEXT_BYTES + 2)
  })
})

describe('truncateBytes', () => {
  it('does not split multi-byte characters', () => {
    const { text, truncated } = truncateBytes('é'.repeat(10), 5)

    expect(truncated).toBe(true)
    // 5 bytes is 2.5 characters; the decoder keeps two whole characters.
    expect(text).toBe('éé')
  })

  it('returns the original string when it fits', () => {
    expect(truncateBytes('short', 100)).toEqual({ text: 'short', truncated: false })
  })
})

describe('attachmentsToContext', () => {
  it('inlines text files and describes binary ones', () => {
    const context = attachmentsToContext([
      { id: 'a', name: 'notes.md', size: 12, type: 'text/markdown', kind: 'text', text: '# hello' },
      { id: 'b', name: 'logo.png', size: 2048, type: 'image/png', kind: 'binary' },
    ])

    expect(context).toContain('```attachment:notes.md\n# hello\n```')
    expect(context).toContain('attachment: logo.png (image/png, 2.0 KB, binary) — contents not included')
  })
})
