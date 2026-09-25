/**
 * Attachment handling: any file type can be attached to a message. Text-like
 * files are read and handed to the model as context; everything else is passed
 * as metadata so the model still knows what the user provided.
 */

export type AttachmentKind = 'text' | 'binary'

export type AttachmentMeta = {
  id: string
  name: string
  size: number
  type: string
  kind: AttachmentKind
  /** Text content, truncated to MAX_TEXT_BYTES. Only present for text-like files. */
  text?: string
  /** True when the file was larger than MAX_TEXT_BYTES and got cut short. */
  truncated?: boolean
}

/** How much of a text file is handed to the model. */
export const MAX_TEXT_BYTES = 64 * 1024
/** How much attachment text is kept when persisting the chat to localStorage. */
export const MAX_PERSISTED_TEXT_BYTES = 16 * 1024

const TEXT_EXTENSIONS = new Set([
  'c', 'cfg', 'conf', 'cpp', 'cs', 'css', 'csv', 'env', 'go', 'h', 'hpp', 'htm', 'html',
  'ini', 'java', 'js', 'json', 'jsx', 'kt', 'less', 'log', 'lua', 'md', 'mdx', 'mjs',
  'php', 'pl', 'properties', 'py', 'rb', 'rs', 'rst', 'sass', 'scss', 'sh', 'sql', 'svg',
  'swift', 'toml', 'ts', 'tsx', 'tsv', 'txt', 'vue', 'xml', 'yaml', 'yml', 'zsh',
])

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/x-httpd-php',
  'application/x-ndjson',
  'application/x-sh',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'application/sql',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'image/svg+xml',
])

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function isTextLike(name: string, mime: string): boolean {
  const type = (mime || '').toLowerCase()
  if (TEXT_MIME_TYPES.has(type)) return true
  if (type.startsWith('text/')) return true
  if (type.endsWith('+json') || type.endsWith('+xml')) return true
  if (type && type !== 'application/octet-stream' && !type.startsWith('application/')) return false
  return TEXT_EXTENSIONS.has(fileExtension(name))
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** Truncates to a byte budget without splitting a character badly. */
export function truncateBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const encoder = new TextEncoder()
  const encoded = encoder.encode(text)
  if (encoded.length <= maxBytes) return { text, truncated: false }

  const decoder = new TextDecoder('utf-8', { fatal: false })
  // A cut mid-character leaves a replacement char at the end; drop it.
  const decoded = decoder.decode(encoded.subarray(0, maxBytes)).replace(/\uFFFD+$/, '')
  return { text: decoded, truncated: true }
}

let attachmentCounter = 0

export function nextAttachmentId(): string {
  attachmentCounter += 1
  return `att_${Date.now().toString(36)}_${attachmentCounter}`
}

/** Reads a browser File into an AttachmentMeta. Never throws for binary files. */
export async function readAttachment(file: File): Promise<AttachmentMeta> {
  const base = {
    id: nextAttachmentId(),
    name: file.name || 'file',
    size: file.size,
    type: file.type || '',
  }

  if (!isTextLike(file.name, file.type)) {
    return { ...base, kind: 'binary' }
  }

  try {
    const raw = await file.text()
    const { text, truncated } = truncateBytes(raw, MAX_TEXT_BYTES)
    return { ...base, kind: 'text', text, truncated }
  } catch {
    return { ...base, kind: 'binary' }
  }
}

export async function readAttachments(files: FileList | File[]): Promise<AttachmentMeta[]> {
  const list = Array.from(files)
  const results: AttachmentMeta[] = []
  for (const file of list) {
    results.push(await readAttachment(file))
  }
  return results
}

/** Formats the attachments of one message as the context block sent to the model. */
export function attachmentsToContext(attachments: AttachmentMeta[]): string {
  return attachments
    .map((attachment) => {
      const meta = [
        attachment.type || 'unknown type',
        formatBytes(attachment.size),
        attachment.kind === 'binary' ? 'binary' : null,
        attachment.truncated ? 'truncated' : null,
      ]
        .filter(Boolean)
        .join(', ')

      if (attachment.kind === 'text' && attachment.text !== undefined) {
        return `\`\`\`attachment:${attachment.name}\n${attachment.text}\n\`\`\``
      }

      return `attachment: ${attachment.name} (${meta}) — contents not included`
    })
    .join('\n\n')
}

