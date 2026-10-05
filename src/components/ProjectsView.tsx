import { useEffect, useRef, useState } from 'react'
import { withCount } from '../lib/plural'
import type { Workspace } from '../lib/workspace'

type Props = {
  workspaces: Workspace[]
  activeId: string
  onOpen: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onCreate: () => void
  onImportFolder: () => void
  importing: boolean
}

/**
 * Every workspace the app has kept, with what it actually holds. The list is the
 * same one the sidebar switcher uses; nothing here is invented.
 */
/**
 * `1 сохранён`, but `2 сохранено` and `5 сохранено`: a short passive form agrees
 * with the thing counted, and only the single takes the masculine one.
 */
function saved(count: number): string {
  return count === 1 ? '1 сохранён' : `${count} сохранено`
}

/**
 * The name, edited in place.
 *
 * It used to be `window.prompt`, which is a dialog the app cannot style, that
 * opens behind the window on some systems, and that discards the name the moment
 * it is cancelled. Enter commits, Escape returns, blur commits — the same thing
 * a rename field does everywhere else.
 */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <input
      ref={inputRef}
      className="project-rename-input"
      value={value}
      aria-label="Название проекта"
      placeholder="Название проекта"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onDone(value.trim() ? value : null)
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onDone(null)
        }
      }}
      onBlur={() => onDone(value.trim() ? value : null)}
    />
  )
}

export function ProjectsView({
  workspaces,
  activeId,
  onOpen,
  onRename,
  onDelete,
  onCreate,
  onImportFolder,
  importing,
}: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)

  /** Commits the edited name, or leaves it alone when the edit was cancelled. */
  const finishRename = (id: string, name: string | null) => {
    setRenaming(null)
    if (name) onRename(id, name)
  }

  return (
    <main className="desktop-home">
      <header className="desktop-home-head">
        <div>
          <p className="desktop-kicker">Рабочие области</p>
          <h1>Проекты</h1>
          <p className="desktop-subtitle">
            Проекты хранятся локально: файлы, ветка и история лежат в этом браузере,
            а терминал работает с копией проекта на диске.
          </p>
        </div>
        <div className="view-actions">
          <button type="button" className="button button--quiet" onClick={onImportFolder} disabled={importing}>
            {importing ? 'Импорт…' : 'Открыть папку'}
          </button>
          <button type="button" className="button" onClick={onCreate}>
            Новый проект
          </button>
        </div>
      </header>

      <section className="desktop-section">
        <div className="desktop-section-head">
          <div>
            <h2>Все проекты</h2>
            <p>{workspaces.length > 0 ? saved(workspaces.length) : 'Пока ничего не сохранено'}</p>
          </div>
        </div>

        {workspaces.length === 0 ? (
          <p className="empty-lede">
            Создайте проект или откройте папку — RBUILDER покажет её файлы, соберёт предпросмотр и
            даст агенту контекст.
          </p>
        ) : (
          <ul className="project-list">
            {workspaces.map((entry) => {
              const isActive = entry.metadata.id === activeId
              return (
              <li key={entry.metadata.id} className={`project-row${isActive ? ' project-row--active' : ''}`}>
                <span className="workspace-card-icon" aria-hidden="true">⌘</span>
                <div className="project-row-main">
                  {renaming === entry.metadata.id ? (
                    <RenameField name={entry.metadata.name} onDone={(name) => finishRename(entry.metadata.id, name)} />
                  ) : (
                    <strong>{entry.metadata.name}</strong>
                  )}
                  <span title={entry.metadata.localPath ?? undefined}>
                    {withCount(entry.project.files.length, 'файл', 'файла', 'файлов')} · {new Date(entry.metadata.updatedAt).toLocaleString()}
                    {entry.metadata.localPath ? ` · ${entry.metadata.localPath}` : ''}
                  </span>
                </div>
                <span className="workspace-branch">{entry.metadata.activeBranch}</span>
                {isActive ? <span className="project-row-current">Текущий</span> : null}
                <div className="project-row-actions">
                  <button
                    type="button"
                    className="button button--quiet"
                    disabled={isActive}
                    onClick={() => onOpen(entry.metadata.id)}
                    title={isActive ? 'Этот проект уже открыт' : 'Открыть проект в рабочей области'}
                  >
                    Открыть
                  </button>
                  <button
                    type="button"
                    className="button button--quiet"
                    disabled={renaming === entry.metadata.id}
                    onClick={() => setRenaming(entry.metadata.id)}
                  >
                    Переименовать
                  </button>
                  <button
                    type="button"
                    className="button button--quiet"
                    disabled={workspaces.length <= 1}
                    onClick={() => onDelete(entry.metadata.id)}
                  >
                    Удалить
                  </button>
                </div>
              </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
