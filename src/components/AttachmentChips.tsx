import { formatBytes, type AttachmentMeta } from '../lib/attachments'

type Props = {
  attachments: AttachmentMeta[]
  onRemove?: (id: string) => void
}

function attachmentKindLabel(attachment: AttachmentMeta): string {
  return attachment.kind === 'text' ? 'text read as context' : 'binary, contents not read'
}

/** The files attached to the message being written, or to a sent message. */
export function AttachmentChips({ attachments, onRemove }: Props) {
  if (attachments.length === 0) return null

  return (
    <ul className="chips" aria-label="Attached files">
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className="chip"
          title={[
            attachment.name,
            attachment.type || 'unknown type',
            attachmentKindLabel(attachment),
          ].join(' · ')}
        >
          <span className="chip-label">
            {attachment.name}
            <span className="chip-dim"> · {formatBytes(attachment.size)}</span>
            {attachment.truncated ? <span className="chip-dim"> · truncated</span> : null}
          </span>
          {onRemove ? (
            <button
              type="button"
              className="chip-remove"
              onClick={() => onRemove(attachment.id)}
              aria-label={`Remove ${attachment.name}`}
            >
              ×
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
