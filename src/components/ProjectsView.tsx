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
            <p>{workspaces.length > 0 ? `${workspaces.length} сохранено` : 'Пока ничего не сохранено'}</p>
          </div>
        </div>

        {workspaces.length === 0 ? (
          <p className="empty-lede">
            Создайте проект или откройте папку — RBUILDER покажет её файлы, соберёт предпросмотр и
            даст агенту контекст.
          </p>
        ) : (
          <ul className="project-list">
            {workspaces.map((entry) => (
              <li key={entry.metadata.id} className={`project-row${entry.metadata.id === activeId ? ' project-row--active' : ''}`}>
                <span className="workspace-card-icon" aria-hidden="true">⌘</span>
                <div className="project-row-main">
                  <strong>{entry.metadata.name}</strong>
                  <span>
                    {entry.project.files.length} файлов · {new Date(entry.metadata.updatedAt).toLocaleString()}
                    {entry.metadata.localPath ? ` · ${entry.metadata.localPath}` : ''}
                  </span>
                </div>
                <span className="workspace-branch">{entry.metadata.activeBranch}</span>
                <div className="project-row-actions">
                  <button type="button" className="button button--quiet" onClick={() => onOpen(entry.metadata.id)}>
                    {entry.metadata.id === activeId ? 'Открыть' : 'Переключиться'}
                  </button>
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => {
                      const name = window.prompt('Название проекта', entry.metadata.name)
                      if (name && name.trim()) onRename(entry.metadata.id, name.trim())
                    }}
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
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
