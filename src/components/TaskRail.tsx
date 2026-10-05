import type { ChecksResult } from '../lib/checks'
import { relativeTimeRu } from '../lib/time'
import type { Workspace } from '../lib/workspace'

/** What the rail reports about the terminal workspace, straight from git. */
type GitSummary = { isRepo: boolean; branch: string | null; changes: number; lastCommit: string | null }

/** Which work pane a narrow window is showing: one at a time, the switch picks. */
export type ShellPane = 'chat' | 'inspector'

type Props = {
  workspaces: Workspace[]
  activeId: string
  busy: boolean
  git: GitSummary | null
  checks: ChecksResult | null
  theme: 'dark' | 'light'
  importing: boolean
  onToggleTheme: () => void
  onOpenSettings: () => void
  onSelect: (id: string) => void
  onNewTask: () => void
  onOpenWorkspace: () => void
  onImportFolder: () => void
  onOpenProjects: () => void
  /** Writes the open task to a .rbuilder.json file. */
  onExportProject: () => void
  /** Picks a .rbuilder.json and opens it as a new task. */
  onImportArchive: () => void
  /**
   * The pane a narrow window is showing. Left out on wide windows, where the
   * stylesheet shows both and the switch stays hidden.
   */
  pane?: ShellPane
  onPaneChange?: (pane: ShellPane) => void
}

/** One task row: active dot, clipped title, age on the right. */
function RailItem({
  name,
  age,
  active,
  onClick,
}: {
  name: string
  age: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={`rail-item${active ? ' rail-item--active' : ''}`} onClick={onClick} title={name}>
      <span className="rail-item-dot" aria-hidden="true" />
      <span className="rail-item-name">{name}</span>
      <span className="rail-item-time">{age}</span>
    </button>
  )
}

export function TaskRail({
  workspaces,
  activeId,
  busy,
  git,
  checks,
  theme,
  importing,
  onToggleTheme,
  onOpenSettings,
  onSelect,
  onNewTask,
  onOpenWorkspace,
  onImportFolder,
  onOpenProjects,
  onExportProject,
  onImportArchive,
  pane = 'chat',
  onPaneChange,
}: Props) {
  const hasFindings = Boolean(checks?.findings.length)
  const statusLine = git?.isRepo
    ? `${git.branch ?? 'main'} · ${git.changes} измен.`
    : checks
      ? summarizeChecks(checks)
      : 'Проверки не запускались'
  const statusTitle = git?.isRepo
    ? `Ветка ${git.branch ?? 'main'}, изменений: ${git.changes}`
    : 'Задача пока не под git — проверки проекта'

  return (
    <aside className="task-rail" aria-label="Задачи">
      <div className="rail-top">
        <button type="button" className="rail-new" onClick={onNewTask} disabled={busy}>
          <span className="rail-glyph" aria-hidden="true">✚</span>
          <span className="rail-label">Новая задача</span>
        </button>
        <button type="button" className="rail-action" onClick={onOpenWorkspace} title="К открытому проекту">
          <span className="rail-glyph" aria-hidden="true">▤</span>
          <span className="rail-label">Открыть проект</span>
        </button>
        <button type="button" className="rail-action" onClick={onOpenProjects}>
          <span className="rail-glyph" aria-hidden="true">◈</span>
          <span className="rail-label">Проекты</span>
        </button>
        <button type="button" className="rail-action" onClick={onImportFolder} disabled={importing}>
          <span className="rail-glyph" aria-hidden="true">◇</span>
          <span className="rail-label">{importing ? 'Открываю…' : 'Открыть папку'}</span>
        </button>
        <div className="rail-pair">
          <button
            type="button"
            className="rail-action rail-action--half"
            onClick={onExportProject}
            disabled={busy}
            title="Сохранить проект в файл .rbuilder.json"
          >
            <span className="rail-glyph" aria-hidden="true">⤓</span>
            <span className="rail-label">Экспорт</span>
          </button>
          <button
            type="button"
            className="rail-action rail-action--half"
            onClick={onImportArchive}
            disabled={busy || importing}
            title="Открыть проект из файла .rbuilder.json"
          >
            <span className="rail-glyph" aria-hidden="true">⤒</span>
            <span className="rail-label">Импорт</span>
          </button>
        </div>
      </div>

      <div className="rail-group">
        <span className="rail-group-label">Задачи</span>
      </div>

      <div className="rail-list">
        {workspaces.length === 0 ? (
          <p className="rail-empty">Пока нет задач — опишите приложение в чате.</p>
        ) : (
          workspaces.map((entry) => (
            <RailItem
              key={entry.metadata.id}
              name={entry.metadata.name}
              age={relativeTimeRu(entry.metadata.updatedAt)}
              active={entry.metadata.id === activeId}
              onClick={() => onSelect(entry.metadata.id)}
            />
          ))
        )}
      </div>

      <div className="rail-footer">
        {/*
          The task name used to be printed here for the third time — in the list
          above it, and again in the chat header — and the whole block was a div
          with a click handler, which the keyboard could not reach. What is left
          is the only thing it had that those two did not: where the project
          stands right now.
        */}
        {onPaneChange ? (
          <div className="shell-pane-switch" role="group" aria-label="Что показать в узком окне">
            <button
              type="button"
              className={`shell-pane${pane === 'chat' ? ' shell-pane--active' : ''}`}
              onClick={() => onPaneChange('chat')}
              aria-pressed={pane === 'chat'}
            >
              Чат
            </button>
            <button
              type="button"
              className={`shell-pane${pane === 'inspector' ? ' shell-pane--active' : ''}`}
              onClick={() => onPaneChange('inspector')}
              aria-pressed={pane === 'inspector'}
            >
              Инспектор
            </button>
          </div>
        ) : null}
        <p className={`rail-status${hasFindings ? ' rail-status--warn' : ''}`} title={statusTitle}>
          <span className="rail-status-dot" aria-hidden="true" />
          <span className="rail-status-text">{statusLine}</span>
        </p>
        <div className="rail-footer-actions">
          <button type="button" className="rail-theme" onClick={onToggleTheme} title="Переключить тему" aria-label="Переключить тему">
            {theme === 'dark' ? '☾' : '☀'}
          </button>
          <button type="button" className="rail-settings" onClick={onOpenSettings} title="Настройки провайдера" aria-label="Настройки">
            ⚙
          </button>
        </div>
      </div>
    </aside>
  )
}

function summarizeChecks(result: ChecksResult): string {
  const errors = result.findings.filter((finding) => finding.level === 'error').length
  if (errors > 0) return `${errors} ${errors === 1 ? 'ошибка' : 'ошибок'}`
  return 'проверки пройдены'
}
