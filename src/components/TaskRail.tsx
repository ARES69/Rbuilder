import type { ChecksResult } from '../lib/checks'
import { relativeTime } from '../lib/time'
import type { Workspace } from '../lib/workspace'

/** What the rail reports about the terminal workspace, straight from git. */
type GitSummary = { isRepo: boolean; branch: string | null; changes: number; lastCommit: string | null }

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
}: Props) {
  const checkLine = checks ? summarizeChecks(checks) : 'проверки не запускались'

  return (
    <aside className="task-rail" aria-label="Задачи">
      <div className="rail-top">
        <button type="button" className="rail-new" onClick={onNewTask} disabled={busy}>
          <span aria-hidden="true">✚</span> New Task
        </button>
        <button type="button" className="rail-action" onClick={onOpenWorkspace}>
          <span aria-hidden="true">▤</span> Open Workspace
        </button>
        <button type="button" className="rail-action" onClick={onOpenProjects}>
          <span aria-hidden="true">◈</span> Projects
        </button>
        <button type="button" className="rail-action" onClick={onImportFolder} disabled={importing}>
          <span aria-hidden="true">◇</span> {importing ? 'Импорт…' : 'Open Folder'}
        </button>
      </div>

      <div className="rail-group">
        <span className="rail-group-label">Tasks</span>
      </div>

      <div className="rail-list">
        {workspaces.length === 0 ? (
          <p className="rail-empty">Пока нет задач — опишите приложение в чате.</p>
        ) : (
          workspaces.map((entry) => (
            <RailItem
              key={entry.metadata.id}
              name={entry.metadata.name}
              age={relativeTime(entry.metadata.updatedAt)}
              active={entry.metadata.id === activeId}
              onClick={() => onSelect(entry.metadata.id)}
            />
          ))
        )}
      </div>

      <div className="rail-footer">
        <div
          className="rail-project"
          title={workspaces.find((entry) => entry.metadata.id === activeId)?.metadata.localPath ?? undefined}
          onClick={onOpenWorkspace}
          role="presentation"
        >
          <span className="rail-avatar" aria-hidden="true">R</span>
          <span className="rail-project-main">
            <strong>{workspaces.find((entry) => entry.metadata.id === activeId)?.metadata.name ?? 'Untitled'}</strong>
            <small>{git?.isRepo ? git.branch : checkLine}</small>
          </span>
        </div>
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
