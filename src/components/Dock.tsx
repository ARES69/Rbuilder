import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { summarizeChecks, type ChecksResult } from '../lib/checks'
import {
  changeLabel,
  gitCommitCommand,
  gitTone,
  GIT_INIT_COMMAND,
  notifyGitChanged,
  readGitState,
  runGit,
  type GitState,
} from '../lib/git'
import type { PreviewEvent, PreviewInspector } from '../lib/inspector'
import type { Project, ProjectFile } from '../lib/project'
import type { TerminalLine } from '../lib/store'

export type DockTab = 'files' | 'git' | 'console' | 'checks' | 'terminal'

export type DockProps = {
  project: Project
  baselineProject: Project
  tab: DockTab
  onTabChange: (tab: DockTab) => void
  inspector: PreviewInspector
  events: PreviewEvent[]
  problemCount: number
  checks: ChecksResult | null
  runningChecks: boolean
  onRunChecks: () => void
  terminal: TerminalLine[]
  terminalRunning: boolean
  onRunCommand: (command: string) => void
  onClearTerminal: () => void
  onWriteFile: (path: string, content: string) => void
  onDeleteFile: (path: string) => void
  onAskAgent: (prompt: string) => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function Dock(props: DockProps) {
  const { tab, onTabChange, collapsed, onToggleCollapsed, problemCount } = props

  const tabs: { id: DockTab; label: string; badge?: number }[] = [
    { id: 'files', label: 'Файлы', badge: props.project.files.length },
    { id: 'git', label: 'Git', badge: changedFiles(props.project, props.baselineProject).length || undefined },
    { id: 'console', label: 'Консоль', badge: problemCount > 0 ? problemCount : undefined },
    { id: 'checks', label: 'Проверки', badge: props.checks?.findings.length || undefined },
    { id: 'terminal', label: 'Терминал' },
  ]

  return (
    <div className={`dock${collapsed ? ' dock--collapsed' : ''}`}>
      <div className="dock-bar">
        <div className="tabs" role="tablist" aria-label="Инструменты проекта">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`tab${tab === entry.id && !collapsed ? ' tab--active' : ''}`}
              onClick={() => {
                if (collapsed) onToggleCollapsed()
                onTabChange(entry.id)
              }}
            >
              {entry.label}
              {entry.badge ? <span className="tab-badge">{entry.badge}</span> : null}
            </button>
          ))}
        </div>
        <button type="button" className="button button--quiet" onClick={onToggleCollapsed}>
          {collapsed ? 'Показать' : 'Скрыть'}
        </button>
      </div>

      {collapsed ? null : (
        <div className="dock-body">
          {tab === 'files' ? <FilesPanel {...props} /> : null}
          {tab === 'git' ? <GitPanel {...props} /> : null}
          {tab === 'console' ? <ConsolePanel {...props} /> : null}
          {tab === 'checks' ? <ChecksPanel {...props} /> : null}
          {tab === 'terminal' ? <TerminalPanel {...props} /> : null}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Files                                                              */
/* ------------------------------------------------------------------ */

function FilesPanel({ project, onWriteFile, onDeleteFile, onAskAgent }: DockProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const file: ProjectFile | undefined = useMemo(
    () => project.files.find((entry) => entry.path === selected) ?? project.files[0],
    [project.files, selected],
  )

  useEffect(() => {
    setDraft(file?.content ?? '')
  }, [file?.path, file?.content])

  if (project.files.length === 0) {
    return <p className="dock-note">Файлов пока нет. Попросите RBUILDER создать приложение — они появятся здесь.</p>
  }

  const dirty = Boolean(file && draft !== file.content)

  return (
    <div className="files">
      <ul className="file-list">
        {project.files.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className={`file-item${entry.path === file?.path ? ' file-item--active' : ''}`}
              onClick={() => setSelected(entry.path)}
            >
              {entry.path}
            </button>
          </li>
        ))}
      </ul>

      <div className="file-editor">
        <div className="file-editor-head">
          <span className="file-editor-path">{file?.path}</span>
          <div className="file-editor-actions">
            {dirty ? (
              <button type="button" className="button button--quiet" onClick={() => setDraft(file?.content ?? '')}>Отменить</button>
            ) : null}
            <button
              type="button"
              className="button button--quiet"
              disabled={!file || !dirty}
              onClick={() => file && onWriteFile(file.path, draft)}>Сохранить</button>
            <button
              type="button"
              className="button button--quiet"
              disabled={!file || project.files.length <= 1}
              onClick={() => {
                if (!file) return
                onDeleteFile(file.path)
                setSelected(null)
              }}>Удалить</button>
            <button
              type="button"
              className="button button--quiet"
              disabled={!file}
              onClick={() =>
                file &&
                onAskAgent(
                  `Here is ${file.path} as it stands now:\n\n\`\`\`file:${file.path}\n${file.content}\n\`\`\`\n\nChange it so that: `,
                )
              }>Спросить</button>
          </div>
        </div>

        <textarea
          className="file-editor-input"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    </div>
  )
}

function changedFiles(project: Project, baseline: Project): { path: string; status: 'A' | 'M' | 'D'; content?: string; before?: string }[] {
  const before = new Map(baseline.files.map((file) => [file.path, file.content]))
  const after = new Map(project.files.map((file) => [file.path, file.content]))
  const paths = new Set([...before.keys(), ...after.keys()])
  return [...paths].sort().flatMap((path) => {
    const oldValue = before.get(path)
    const newValue = after.get(path)
    if (oldValue === newValue) return []
    return [{ path, status: oldValue === undefined ? 'A' as const : newValue === undefined ? 'D' as const : 'M' as const, content: newValue, before: oldValue }]
  })
}

/**
 * The Git tab runs real `git` in the terminal workspace, so what it reports can
 * be verified outside the app. It also lists how the project differs from the
 * state it was imported in, which is useful before the repository exists.
 */
function GitPanel({ project, baselineProject }: DockProps) {
  const [state, setState] = useState<GitState | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const files = useMemo(
    () => project.files.map((file) => ({ path: file.path, content: file.content })),
    [project.files],
  )
  const reference = useMemo(() => changedFiles(project, baselineProject), [project, baselineProject])

  const refresh = useCallback(async () => {
    setBusy(true)
    const next = await readGitState(files)
    setState(next)
    setBusy(false)
    notifyGitChanged()
  }, [files])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(
    async (command: string, successNote: string) => {
      setBusy(true)
      setNote(null)
      const result = await runGit(command, files)
      setNote(result.ok ? successNote : result.error ?? 'Не удалось выполнить git-команду.')
      const next = await readGitState(files)
      setState(next)
      setBusy(false)
      notifyGitChanged()
    },
    [files],
  )

  const tone = gitTone(state)
  const branch = state?.branch ?? null
  const changeCount = state?.changes.length ?? 0

  return (
    <div className="git-panel">
      <div className="panel-actions">
        <span className="panel-status">
          {tone === 'missing'
            ? 'Рабочая папка терминала ещё не под git'
            : tone === 'clean'
              ? `Ветка ${branch ?? 'main'} · рабочее дерево чистое`
              : `Ветка ${branch ?? 'main'} · ${changeCount} изменений`}
        </span>
        <button type="button" className="button button--quiet" onClick={() => void refresh()} disabled={busy}>
          {busy ? 'Обновление…' : 'Обновить'}
        </button>
        {tone === 'missing' ? (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void run(GIT_INIT_COMMAND, 'Репозиторий создан.')}
          >
            Создать репозиторий
          </button>
        ) : (
          <>
            <input
              className="input git-message"
              value={message}
              placeholder="Сообщение коммита"
              onChange={(event) => setMessage(event.target.value)}
            />
            <button
              type="button"
              className="button"
              disabled={busy || changeCount === 0 || !message.trim()}
              onClick={() => void run(gitCommitCommand(message.trim()), 'Изменения зафиксированы.')}
            >
              Зафиксировать
            </button>
          </>
        )}
      </div>

      {note ? <p className="dock-note">{note}</p> : null}

      {state?.isRepo && state.lastCommit ? (
        <p className="dock-note">Последний коммит: <code>{state.lastCommit}</code></p>
      ) : null}

      {state?.error ? <p className="dock-note dock-note--error">{state.error}</p> : null}

      {tone === 'missing' ? (
        <p className="dock-note">
          Терминал работает в копии проекта (<code>.freebuff-workspace/project</code>). Создайте
          репозиторий, чтобы фиксировать контрольные точки этой копии — приложение при этом не трогает
          ваш собственный git-репозиторий.
        </p>
      ) : null}

      {changeCount > 0 ? (
        <ul className="git-list">
          {state?.changes.map((change) => (
            <li key={`${change.path}-${change.index}${change.worktree}`} className="git-item">
              <span className={`git-status git-status--${changeLabel(change)}`}>{changeLabel(change)}</span>
              <span>{change.path}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {changeCount === 0 && tone !== 'missing' ? (
        <p className="dock-note">Все изменения зафиксированы. Правки агента или редактора появятся здесь.</p>
      ) : null}

      {reference.length > 0 ? (
        <>
          <p className="dock-note">
            Отличий от исходного состояния проекта: {reference.length}
            {reference.length ? ` (${reference.map((entry) => entry.path).slice(0, 4).join(', ')}${reference.length > 4 ? '…' : ''})` : ''}
          </p>
        </>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Console                                                            */
/* ------------------------------------------------------------------ */

function ConsolePanel({ events, inspector, onAskAgent }: DockProps) {
  const [expression, setExpression] = useState('')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [events, results])

  const problems = events.filter((event) => event.kind === 'error' || event.kind === 'network')

  const evaluate = async () => {
    const code = expression.trim()
    if (!code) return
    setExpression('')
    try {
      const value = await inspector.evaluate(code)
      setResults((current) => [...current.slice(-20), `${code} → ${value}`])
      setError(null)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    }
  }

  return (
    <div className="console">
      <div className="panel-actions">
        <span className="panel-status">
          {events.length === 0
            ? 'Событий пока нет.'
            : `${events.length} событий${problems.length > 0 ? ` · ${problems.length} проблем` : ''}`}
        </span>
        <button type="button" className="button button--quiet" onClick={() => inspector.clear()}>
          Очистить
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={problems.length === 0}
          onClick={() =>
            onAskAgent(
              `The preview is reporting these problems:\n\n\`\`\`console\n${inspector.formatEventLog(15)}\n\`\`\`\n\nFind the cause and fix it.`,
            )
          }
        >
          Попросить RBUILDER исправить
        </button>
      </div>

      <div className="console-log">
        {events.length === 0 ? (
          <p className="dock-note">
            Здесь отображаются сообщения консоли, ошибки и неудачные запросы предпросмотра.
          </p>
        ) : (
          events.map((event) => (
            <div key={`${event.id}-${event.at}`} className={`log log--${event.kind}`}>
              <span className="log-tag">
                {event.kind === 'console' ? (event.level ?? 'log') : event.kind}
              </span>
              <span className="log-text">
                {event.text}
                {event.detail ? <span className="chip-dim"> ({event.detail})</span> : null}
              </span>
            </div>
          ))
        )}
        {results.map((line, index) => (
          <div key={`res-${index}`} className="log log--result">
            <span className="log-tag">eval</span>
            <span className="log-text">{line}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="console-input">
        <span className="prompt">&gt;</span>
        <input
          className="input"
          value={expression}
          placeholder="Выполнить JavaScript в предпросмотре"
          onChange={(event) => setExpression(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void evaluate()
            }
          }}
        />
      </div>
      {error ? <p className="dock-note dock-note--error">{error}</p> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Checks                                                             */
/* ------------------------------------------------------------------ */

function ChecksPanel({ checks, runningChecks, onRunChecks, onAskAgent }: DockProps) {
  return (
    <div className="checks">
      <div className="panel-actions">
        <span className="panel-status">
          {checks ? summarizeChecks(checks) : 'Ещё не запускалось.'}
        </span>
        <button type="button" className="button button--quiet" onClick={onRunChecks} disabled={runningChecks}>
          {runningChecks ? 'Выполняется…' : 'Запустить проверки'}
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={!checks || checks.findings.length === 0}
          onClick={() =>
            checks &&
            onAskAgent(
              `The project checks reported:\n\n\`\`\`checks\n${checks.findings
                .map((finding) => `${finding.level}: ${finding.file}${finding.line ? `:${finding.line}` : ''}: ${finding.message}`)
                .join('\n')}\n\`\`\`\n\nFix these.`,
            )
          }
        >
          Попросить RBUILDER исправить
        </button>
      </div>

      {checks && checks.findings.length > 0 ? (
        <ul className="finding-list">
          {checks.findings.map((finding, index) => (
            <li key={`${finding.file}-${index}`} className={`finding finding--${finding.level}`}>
              <span className="log-tag">{finding.level}</span>
              <span className="log-text">
                <span className="chip-dim">
                  {finding.file}
                  {finding.line ? `:${finding.line}` : ''}
                </span>{' '}
                {finding.message}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dock-note">
          Проверка структуры, синтаксиса и отсутствующих файлов — проект анализируется без отдельной сборки.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Terminal                                                           */
/* ------------------------------------------------------------------ */

function TerminalPanel({ terminal, terminalRunning, onRunCommand, onClearTerminal }: DockProps) {
  const [command, setCommand] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [terminal])

  return (
    <div className="terminal">
      <div className="panel-actions">
        <span className="panel-status">
          Запускается во временной копии проекта с вашими правами.
        </span>
        <button type="button" className="button button--quiet" onClick={onClearTerminal}>
          Очистить
        </button>
      </div>

      <div className="terminal-log">
        {terminal.length === 0 ? (
          <p className="dock-note">
            Попробуйте <code>ls</code> или <code>node -e "console.log(process.version)"</code>. Файлы записываются в <code>.freebuff-workspace/project</code> before each command.
          </p>
        ) : (
          <pre className="terminal-output">
            {terminal.map((line) => (
              <span key={line.id} className={`term-line term-line--${line.kind}`}>
                {line.text}
                {line.text.endsWith('\n') ? '' : '\n'}
              </span>
            ))}
          </pre>
        )}
        <div ref={endRef} />
      </div>

      <div className="console-input">
        <span className="prompt">$</span>
        <input
          className="input"
          value={command}
          placeholder={terminalRunning ? 'Выполняется…' : 'Команда'}
          disabled={terminalRunning}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !terminalRunning) {
              event.preventDefault()
              onRunCommand(command)
              setCommand('')
            }
          }}
        />
        <button
          type="button"
          className="button"
          disabled={terminalRunning || command.trim().length === 0}
          onClick={() => {
            onRunCommand(command)
            setCommand('')
          }}>Запустить</button>
      </div>
    </div>
  )
}
