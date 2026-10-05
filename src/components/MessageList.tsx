import { useEffect, useMemo, useRef, useState } from 'react'
import { AttachmentChips } from './AttachmentChips'
import { Markdown } from './Markdown'
import { lineDiff, totalDiff } from '../lib/diff'
import { fileGlyph, fileGlyphClass } from '../lib/fileIcons'
import { canRewindTo, planRewind, rewindSummary } from '../lib/rewind'
import { rewindTargetCommit } from '../lib/timeline'
import type { ChatMessage, ToolTraceEntry } from '../lib/store'
import { collapseRepeats } from '../lib/transcript'

type Props = {
  messages: ChatMessage[]
  examples: string[]
  onExample: (example: string) => void
  /** Current project files, so finished turns can show per-file diffs. */
  files?: { path: string; content: string }[]
  onOpenFile?: (path: string) => void
  /** Reverts the last turn's writes to their pre-turn content. */
  onUndo?: (message: ChatMessage) => void
  /** Puts the project's files back the way they were before this turn. */
  onRewind?: (index: number) => void
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
    case 'run_command':
      return 'Запустил'
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
    case 'run_command':
      return '$'
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

export function MessageList({ messages, examples, onExample, files, onOpenFile, onUndo, onRewind }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  /** The turn whose rewind question is open, if any. */
  const [asking, setAsking] = useState<string | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  // The same sentence twice in a row is one answer repeated, not two.
  const rows = useMemo(() => collapseRepeats(messages), [messages])

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
            RBUILDER собирает приложение целиком: структуру проекта, страницы, логику и интеграции с
            внешними API. Файлы появляются в папке проекта сразу, а готовое приложение можно
            запустить, зафиксировать в git и отправить в репозиторий. К сообщению можно
            прикрепить заметки, таблицу или скриншот как контекст.
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
      {rows.map(({ message, repeats }) => {
        const fileRows = turnFileRows(message, files)
        const streamingFiles = message.role === 'assistant' && message.status === 'streaming' && fileRows.length > 0
        // Rows are collapsed repeats of real messages, so the index is looked up
        // rather than counted: a rewind needs the position in the transcript.
        const index = messages.indexOf(message)
        const rewindable = index >= 0 && canRewindTo(messages, index)
        // The commit a rewind here would land on: the turn just above this one.
        const target = rewindTargetCommit(messages, index)

        return (
          <article key={message.id} className={`turn turn--${message.role}`}>
            <div className="turn-meta">
              <span>{message.role === 'user' ? 'Вы' : 'RBUILDER'}</span>
              {repeats > 1 ? (
                <span className="turn-repeat" title="Одинаковых сообщений подряд">
                  повтор ×{repeats}
                </span>
              ) : null}
              {/* The turn's own commit: what the branch points at, and what
                  «Вернуться сюда» on a later turn lands on. Absent when the
                  project is not a repository or the turn changed nothing. */}
              {message.commit ? (
                <code className="turn-commit" title={`Коммит этого хода: ${message.commit}`}>
                  {message.commit}
                </code>
              ) : null}
              {/*
                Undo belongs to the newest turn, which gets it in the changes
                card. This is the other half: any earlier point, said out loud
                and confirmed, because it throws away everything after it.
              */}
              {rewindable ? (
                asking === message.id ? (
                  <span className="confirm-pair turn-rewind-confirm">
                    <span className="confirm-question">
                      {rewindSummary(planRewind(messages, index))}?
                      {target ? (
                        <>
                          {' Ветка вернётся на '}
                          <code className="turn-commit">{target}</code>
                        </>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => {
                        onRewind?.(index)
                        setAsking(null)
                      }}
                    >
                      Откатить
                    </button>
                    <button type="button" className="button button--quiet" onClick={() => setAsking(null)}>
                      Нет
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="turn-rewind"
                    onClick={() => setAsking(message.id)}
                    title="Вернуть файлы к состоянию до этого хода"
                  >
                    Вернуться сюда ↺
                  </button>
                )
              ) : null}
            </div>

            <div className="turn-body">
              {message.content ? <MessageContent content={message.content} compact={message.role === 'user'} /> : null}

              {message.role === 'assistant' && message.status === 'streaming' && !message.content ? (
                <p className="turn-working">Думаю…</p>
              ) : null}

              {streamingFiles ? (
                <p className="run-inline">
                  <span className="run-verb">Обновил</span>
                  {fileRows.map((row) => (
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

            {message.role === 'assistant' && message.status !== 'streaming' && fileRows.length > 0 ? (
              <ChangesCard
                message={message}
                rows={fileRows}
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
