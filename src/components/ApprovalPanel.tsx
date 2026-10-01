import { useMemo } from 'react'
import { lineDiff } from '../lib/diff'
import { fileGlyph, fileGlyphClass } from '../lib/fileIcons'
import type { ProjectFileInput } from '../lib/project'

export type Approval = {
  id: string
  files: ProjectFileInput[]
  status: 'pending' | 'approved' | 'rejected'
}

type Props = {
  approval: Approval | null
  /** Current project files: the baseline the proposed writes are diffed against. */
  files: { path: string; content: string }[]
  onApprove: () => void
  onReject: () => void
}

/**
 * The ask-mode gate: while the turn is running, each proposed batch waits here
 * until the user allows it. A rejected card stays visible as the record of
 * what was not applied.
 */
export function ApprovalPanel({ approval, files, onApprove, onReject }: Props) {
  const rows = useMemo(() => {
    if (!approval) return []
    const byPath = new Map(files.map((file) => [file.path, file.content]))
    return approval.files.map((file) => {
      const diff = lineDiff(byPath.get(file.path) ?? null, file.content)
      return { path: file.path, added: diff.added, removed: diff.removed, isNew: !byPath.has(file.path) }
    })
  }, [approval, files])

  if (!approval || approval.status === 'approved') return null

  if (approval.status === 'rejected') {
    return (
      <section className="approval approval--rejected" aria-label="Правки отклонены">
        <span className="approval-rejected-note">Правки отклонены — агент предложит другой подход.</span>
      </section>
    )
  }

  const added = rows.reduce((sum, row) => sum + row.added, 0)
  const removed = rows.reduce((sum, row) => sum + row.removed, 0)

  return (
    <section className="approval" aria-label="Требуется подтверждение">
      <div className="approval-head">
        <span className="approval-title">
          Предлагает изменения · {rows.length} {rows.length === 1 ? 'файл' : rows.length < 5 ? 'файла' : 'файлов'}
        </span>
        <span className="approval-totals">
          <em className="diff-add">+{added}</em> <em className="diff-del">−{removed}</em>
        </span>
      </div>
      <ul className="approval-list">
        {rows.map((row) => (
          <li key={row.path} className="approval-file">
            <span className={`file-glyph file-glyph--${fileGlyphClass(row.path)}`} aria-hidden="true">
              {fileGlyph(row.path)}
            </span>
            <span className="approval-path">{row.path}</span>
            <span className="approval-diff">
              <em className="diff-add">+{row.added}</em> <em className="diff-del">−{row.removed}</em>
            </span>
          </li>
        ))}
      </ul>
      <div className="approval-actions">
        <button type="button" className="approval-button approval-button--primary" onClick={onApprove}>
          Разрешить
        </button>
        <button type="button" className="approval-button" onClick={onReject}>
          Отклонить
        </button>
      </div>
    </section>
  )
}
