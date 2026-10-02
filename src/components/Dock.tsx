import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { summarizeChecks, type ChecksResult } from '../lib/checks'
import {
  changeLabel,
  gitCheckoutCommand,
  gitCommitCommand,
  gitTagCommand,
  gitTone,
  gitInitCommand,
  isGitUsable,
  GIT_PULL_COMMAND,
  GIT_PUSH_COMMAND,
  notifyGitChanged,
  readGitDiff,
  readGitExtra,
  readGitState,
  runGit,
  type DiffLine,
  type GitExtra,
  type GitState,
} from '../lib/git'
import type { PreviewEvent, PreviewInspector } from '../lib/inspector'
import type { GitChange } from '../lib/git'
import type { Project, ProjectFile } from '../lib/project'
import type { TerminalLine } from '../lib/store'

export type DockTab = 'files' | 'git' | 'console' | 'checks' | 'terminal'

export type DockProps = {
  project: Project
  baselineProject: Project
  /**
   * The bound project folder, when there is one.
   *
   * The Git panel needs it because without a `cwd` the exec route materializes
   * the project into the scratch copy (`.freebuff-workspace/project`), so the
   * panel would report on a temporary tree while the sidebar reported on the
   * real folder. Two halves of one panel, two different repositories.
   */
  folder: string | null
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
function GitPanel({ project, baselineProject, folder }: DockProps) {
  const [state, setState] = useState<GitState | null>(null)
  const [extra, setExtra] = useState<GitExtra | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [tagName, setTagName] = useState('')
  const [branchName, setBranchName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  /** Which file's diff is open, if any. */
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffLine[] | null>(null)
  /** Keeps the async diff read from landing after the user picked another file. */
  const diffRequest = useRef(0)
  /** Read in callbacks so a refresh after an async command sees the newest folder. */
  const folderRef = useRef<string | null>(folder)
  folderRef.current = folder

  const files = useMemo(
    () => project.files.map((file) => ({ path: file.path, content: file.content })),
    [project.files],
  )
  const reference = useMemo(() => changedFiles(project, baselineProject), [project, baselineProject])

  const refresh = useCallback(async () => {
    setBusy(true)
    const cwd = folderRef.current ?? undefined
    const [next, extra] = await Promise.all([
      readGitState(files, undefined, cwd),
      readGitExtra(files, undefined, cwd),
    ])
    setState(next)
    setExtra(extra)
    setBusy(false)
    notifyGitChanged()
  }, [files, folder])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(
    async (command: string, successNote: string) => {
      setBusy(true)
      setNote(null)
      const cwd = folderRef.current ?? undefined
      const result = await runGit(command, files, undefined, cwd)
      // push and pull print their own diagnostics on stdout, and they are the
      // only useful part of the result, so a failure shows git's message.
      const detail = result.output.trim()
      setNote(
        result.ok
          ? successNote
          : detail || result.error || 'Не удалось выполнить git-команду.',
      )
      const [next, extra] = await Promise.all([
        readGitState(files, undefined, cwd),
        readGitExtra(files, undefined, cwd),
      ])
      setState(next)
      setExtra(extra)
      setBusy(false)
      notifyGitChanged()
    },
    [files, folder],
  )

  const tone = gitTone(state)
  const branch = state?.branch ?? null
  const changeCount = state?.changes.length ?? 0

  /**
   * Git only makes sense against the bound folder.
   *
   * Without one the commands run in a scratch copy that is rewritten on every
   * command, so a repository created there is thrown away with the next run, and
   * until then the panel reports a branch and a history belonging to nothing.
   * Offering the actions would let the user commit work into a directory that
   * does not exist by tomorrow, so the panel says what is missing instead.
   */
  if (!isGitUsable(folderRef.current)) {
    return (
      <div className="git-panel">
        <p className="dock-note">
          Задача не привязана к папке, поэтому git здесь не работает: терминал выполняется во
          временной копии проекта (<code>.freebuff-workspace/project</code>), которая
          перезаписывается при каждой команде. Репозиторий в такой папке исчезнет вместе с ней.
        </p>
        <p className="dock-note">
          Привяжите задачу к папке — и панель будет работать с вашим настоящим репозиторием:
          статус, diff, история, ветки и push.
        </p>
      </div>
    )
  }

  /**
   * Opens a file's diff. A deleted path has nothing left to diff against, so
   * the panel says so instead of showing an empty block that looks like a bug.
   */
  const openDiff = useCallback(
    async (entry: GitChange) => {
      if (entry.index === 'D' || entry.worktree === 'D') {
        setDiffPath(entry.path)
        setDiff([])
        return
      }
      const request = ++diffRequest.current
      setDiffPath(entry.path)
      setDiff(null)
      const lines = await readGitDiff(files, entry.path, undefined, folderRef.current ?? undefined)
      // A newer click already started; its result is the one that counts.
      if (request !== diffRequest.current) return
      setDiff(lines)
    },
    [files],
  )

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
            onClick={() => {
              const command = gitInitCommand(folderRef.current)
              if (command) void run(command, 'Репозиторий создан.')
            }}
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
            <button
              type="button"
              className="button button--quiet"
              disabled={busy || !extra?.remote}
              title={extra?.remote ? `Отправить в ${extra.remote}` : 'У репозитория нет remote origin'}
              onClick={() => void run(GIT_PUSH_COMMAND, 'Отправлено в origin.')}
            >
              Push
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy || !extra?.remote}
              title={extra?.remote ? 'Обновить из origin' : 'У репозитория нет remote origin'}
              onClick={() => void run(GIT_PULL_COMMAND, 'Получено из origin.')}
            >
              Pull
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
          {folder
            ? 'Папка проекта ещё не под git. Создайте репозиторий прямо в ней — терминал и панель будут работать с ним.'
            : 'Задача не привязана к папке: терминал работает в копии проекта (.freebuff-workspace/project). Привяжите папку, чтобы git работал с вашим настоящим репозиторием.'}
        </p>
      ) : null}

      {extra?.tracking ? (
        <p className="dock-note">
          Отслеживает <code>{extra.tracking}</code>
          {extra.outOfSync ? ' · расхождение с удалённой веткой' : ''}
        </p>
      ) : null}

      {extra?.branches.length ? (
        <div className="git-branches">
          <span className="git-section-label">Ветки</span>
          <div className="git-branch-row">
            {extra.branches.map((name) => (
              <button
                key={name}
                type="button"
                className={`git-branch${name === branch ? ' git-branch--current' : ''}`}
                disabled={busy || name === branch}
                title={name === branch ? 'Текущая ветка' : `Переключиться на ${name}`}
                onClick={() => void run(gitCheckoutCommand(name), `Переключено на ${name}.`)}
              >
                {name}
              </button>
            ))}
          </div>
          <input
            className="input git-message"
            value={branchName}
            placeholder="Имя новой ветки"
            onChange={(event) => setBranchName(event.target.value)}
          />
          <button
            type="button"
            className="button button--quiet"
            disabled={busy || !branchName.trim()}
            onClick={() => {
              const target = branchName.trim()
              void run(gitCheckoutCommand(target), `Создана ветка ${target}.`)
              setBranchName('')
            }}
          >
            Новая ветка
          </button>
        </div>
      ) : null}

      {changeCount > 0 ? (
        <ul className="git-list">
          {state?.changes.map((change) => (
            <li key={`${change.path}-${change.index}${change.worktree}`} className="git-item">
              <span className={`git-status git-status--${changeLabel(change)}`}>{changeLabel(change)}</span>
              <button
                type="button"
                className="git-file"
                onClick={() => void openDiff(change)}
                title="Показать изменения относительно HEAD"
              >
                {change.path}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {diffPath ? (
        <div className="git-diff">
          <div className="git-diff-head">
            <code>{diffPath}</code>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                // Bump the request so a pending read cannot reopen the closed file.
                diffRequest.current += 1
                setDiffPath(null)
                setDiff(null)
              }}
            >
              Закрыть
            </button>
          </div>
          {diff === null ? (
            <p className="dock-note">Читаем изменения…</p>
          ) : diff.length === 0 ? (
            <p className="dock-note">
              Нет изменений относительно HEAD{state?.branch ? '' : ' (коммитов ещё нет)'}.
            </p>
          ) : (
            <pre className="git-diff-body">
              {diff.map((line, index) => (
                <span key={index} className={`git-diff-line git-diff-line--${line.kind}`}>
                  {line.text}
                </span>
              ))}
            </pre>
          )}
        </div>
      ) : null}

      {extra?.commits.length ? (
        <div className="git-log">
          <span className="git-section-label">История</span>
          <ul className="git-list">
            {extra.commits.map((commit) => (
              <li key={commit.hash} className="git-item">
                <code className="git-hash">{commit.hash}</code>
                <span className="git-subject">{commit.subject}</span>
                <span className="git-author">
                  {commit.author} · {commit.date}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {extra?.tags.length ? (
        <div className="git-tags">
          <span className="git-section-label">Теги</span>
          <div className="git-branch-row">
            {extra.tags.map((name) => (
              <span key={name} className="git-branch">{name}</span>
            ))}
          </div>
          <input
            className="input git-message"
            value={tagName}
            placeholder="Имя тега"
            onChange={(event) => setTagName(event.target.value)}
          />
          <button
            type="button"
            className="button button--quiet"
            disabled={busy || !tagName.trim()}
            onClick={() => {
              const name = tagName.trim()
              void run(gitTagCommand(name), `Тег ${name} создан.`)
              setTagName('')
            }}
          >
            Создать тег
          </button>
        </div>
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
