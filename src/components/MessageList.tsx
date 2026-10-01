import { useEffect, useMemo, useRef } from 'react'
import { AttachmentChips } from './AttachmentChips'
import { Markdown } from './Markdown'
import { lineDiff, totalDiff } from '../lib/diff'
import { fileGlyph, fileGlyphClass } from '../lib/fileIcons'
import type { ChatMessage, ToolTraceEntry } from '../lib/store'

type Props = {
  messages: ChatMessage[]
  examples: string[]
  onExample: (example: string) => void
  /** Current project files, so finished turns can show per-file diffs. */
  files?: { path: string; content: string }[]
  onOpenFile?: (path: string) => void
  /** Reverts the last turn's writes to their pre-turn content. */
  onUndo?: (message: ChatMessage) => void
}

type FileRow = { path: string; added: number | null; removed: number | null; isNew: boolean }

/** Per-file `+N −N` for a turn, from its own pre-turn snapshots. */
function turnFileRows(message: ChatMessage, files: Props['files']): FileRow[] {
  if (!message.files?.length) return []
  const byPath = new Map((files ?? []).map((file) => [file.path, file.content]))

  return message.files.map((path) => {
    const after = byPath.get(path)
    const snapshot = message.snapshots?.find((entry) => entry.path === path)
    if (after === undefined || !snapshot) {
      return { path, added: null, removed: null, isNew: snapshot ? snapshot.before === null : false }
    }
    const diff = lineDiff(snapshot.before, after)
    return { path, added: diff.added, removed: diff.removed, isNew: snapshot.before === null }
  })
}

function DiffCount({ added, removed }: { added: number | null; removed: number | null }) {
  if (added === null || removed === null) return null
  return (
    <span className="run-diff">
      <em className="diff-add">+{added}</em> <em className="diff-del">−{removed}</em>
    </span>
  )
}

/** Verb + glyph for one tool row, in the compact zcode way. */
function toolVerb(name: string): string {
  switch (name) {
    case 'inspect_preview':
      return 'Проверил превью'
    case 'interact_with_preview':
      return 'Кликнул в превью'
    case 'read_project_file':
      return 'Прочитал'
    case 'run_checks':
      return 'Прогнал проверки'
    default:
      return name
  }
}

function toolGlyph(name: string): string {
  switch (name) {
    case 'inspect_preview':
    case 'interact_with_preview':
      return '◱'
    case 'read_project_file':
      return '▤'
    case 'run_checks':
      return '✓'
    default:
      return '⌘'
  }
}

function ToolRow({ tool }: { tool: ToolTraceEntry }) {
  return (
    <li className={`run-row run-row--${tool.status}`}>
      <details>
        <summary className="run-summary">
          <span className="run-glyph" aria-hidden="true">{toolGlyph(tool.name)}</span>
          <span className="run-verb">{toolVerb(tool.name)}</span>
          {tool.summary ?? tool.detail ? <code className="run-detail">{tool.summary ?? tool.detail}</code> : null}
        </summary>
        <pre className="tool-output">{tool.output ?? 'Ожидание результата…'}</pre>
      </details>
    </li>
  )
}

/** The `3 files changed +734 −7 / Undo` card at the end of a finished turn. */
function ChangesCard({
  message,
  rows,
  canUndo,
  onOpenFile,
  onUndo,
}: {
  message: ChatMessage
  rows: FileRow[]
  canUndo: boolean
  onOpenFile?: (path: string) => void
  onUndo?: (message: ChatMessage) => void
}) {
  const totals = totalDiff(
    rows.filter((row): row is FileRow & { added: number; removed: number } => row.added !== null && row.removed !== null),
  )

  return (
    <div className="changes-card">
      <div className="changes-head">
        <span className="changes-title">
          {rows.length} {rows.length === 1 ? 'файл изменён' : rows.length < 5 ? 'файла изменено' : 'файлов изменено'}
        </span>
        <DiffCount added={totals.added} removed={totals.removed} />
        {message.undone ? (
          <span className="changes-undone">отменено</span>
        ) : canUndo ? (
          <button type="button" className="changes-undo" onClick={() => onUndo?.(message)}>
            Отменить ↺
          </button>
        ) : null}
      </div>
      <ul className="changes-list">
        {rows.map((row) => (
          <li key={row.path}>
            <button type="button" className="changes-file" onClick={() => onOpenFile?.(row.path)}>
              <span className={`file-glyph file-glyph--${fileGlyphClass(row.path)}`} aria-hidden="true">
                {fileGlyph(row.path)}
              </span>
              <span className="changes-path">{row.path}</span>
              <DiffCount added={row.added} removed={row.removed} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MessageContent({ content, compact }: { content: string; compact: boolean }) {
  if (!compact) return <Markdown text={content} />

  const fence = content.indexOf('```')
  if (fence < 0) return <Markdown text={content} compact />

  const prose = content.slice(0, fence).trim()
  return (
    <>
      {prose ? <Markdown text={prose} compact /> : null}
      <details className="message-context">
        <summary>Контекст прикреплённого файла</summary>
        <Markdown text={content.slice(fence)} compact />
      </details>
    </>
  )
}

export function MessageList({ messages, examples, onExample, files, onOpenFile, onUndo }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  // Undo belongs to the newest turn that wrote something: older snapshots would
  // clobber whatever later turns did to the same files.
  const lastTurnId = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant' && message.files?.length)?.id,
    [messages],
  )

  if (messages.length === 0) {
    return (
      <div className="transcript transcript--empty">
        <div className="empty-state">
          <p className="empty-eyebrow">Версия 1 · предпросмотр</p>
          <h2>Опишите веб-приложение и наблюдайте за сборкой справа.</h2>
          <p className="empty-lede">
            Прикрепите любой файл для контекста — заметки, таблицу или скриншот. RBUILDER создаёт
            HTML, CSS и JavaScript, а предпросмотр обновляется по ходу работы.
          </p>
          <ul className="examples">
            {examples.map((example) => (
              <li key={example}>
                <button type="button" className="example" onClick={() => onExample(example)}>
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  return (
    <div className="transcript">
      {messages.map((message) => {
        const rows = turnFileRows(message, files)
        const streamingFiles = message.role === 'assistant' && message.status === 'streaming' && rows.length > 0

        return (
          <article key={message.id} className={`turn turn--${message.role}`}>
            <div className="turn-meta">{message.role === 'user' ? 'Вы' : 'RBUILDER'}</div>

            <div className="turn-body">
              {message.content ? <MessageContent content={message.content} compact={message.role === 'user'} /> : null}

              {message.role === 'assistant' && message.status === 'streaming' && !message.content ? (
                <p className="turn-working">Думаю…</p>
              ) : null}

              {streamingFiles ? (
                <p className="run-inline">
                  <span className="run-verb">Обновил</span>
                  {rows.map((row) => (
                    <span key={row.path} className="run-inline-file">
                      <span className={`file-glyph file-glyph--${fileGlyphClass(row.path)}`} aria-hidden="true">
                        {fileGlyph(row.path)}
                      </span>
                      <code className="run-inline-name">{row.path}</code>
                      <DiffCount added={row.added} removed={row.removed} />
                    </span>
                  ))}
                </p>
              ) : null}
            </div>

            {message.tools?.length ? (
              <ul className="tool-trace" aria-label="Вызовы инструментов">
                {message.tools.map((tool) => (
                  <ToolRow key={tool.id} tool={tool} />
                ))}
              </ul>
            ) : null}

            {message.attachments?.length ? <AttachmentChips attachments={message.attachments} /> : null}

            {message.role === 'assistant' && message.status !== 'streaming' && rows.length > 0 ? (
              <ChangesCard
                message={message}
                rows={rows}
                canUndo={message.id === lastTurnId && !message.undone}
                onOpenFile={onOpenFile}
                onUndo={onUndo}
              />
            ) : null}

            {message.status === 'error' ? <p className="turn-error">Выполнение завершилось с ошибкой.</p> : null}
          </article>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}
