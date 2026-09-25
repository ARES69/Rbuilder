import { summarizeChecks, type ChecksResult } from '../lib/checks'
import type { AgentMode } from '../lib/protocol'
import type { Project } from '../lib/project'
import type { ProviderProfile } from '../lib/agent'
import type { Workspace } from '../lib/workspace'

type Props = {
  project: Project
  workspace: Workspace
  workspaces: Workspace[]
  configured: boolean | null
  model: string | null
  provider: ProviderProfile
  mode: AgentMode
  checks: ChecksResult | null
  onOpenWorkspace: () => void
  onOpenWorkspaceById: (id: string) => void
  onOpenProjects: () => void
  onOpenAgents: () => void
  onOpenSettings: () => void
  onImportFolder: () => void
  importing: boolean
  onNewProject: () => void
}

/**
 * The start screen. Everything it shows comes from the current workspace, the
 * saved workspaces and the provider actually selected — no sample data.
 */
export function DesktopHome({
  project,
  workspace,
  workspaces,
  configured,
  model,
  provider,
  mode,
  checks,
  onOpenWorkspace,
  onOpenWorkspaceById,
  onOpenProjects,
  onOpenAgents,
  onOpenSettings,
  onImportFolder,
  importing,
  onNewProject,
}: Props) {
  const recent = workspaces.filter((entry) => entry.metadata.id !== workspace.metadata.id).slice(0, 3)
  const local = provider.kind === 'ollama' || provider.kind === 'lmstudio'

  return (
    <main className="desktop-home">
      <header className="desktop-home-head">
        <div>
          <p className="desktop-kicker">Локальная рабочая область</p>
          <h1>Добрый день</h1>
          <p className="desktop-subtitle">
            Опишите приложение — агент напишет файлы, а предпросмотр соберётся сразу. Проверки и
            живая страница доступны агенту, поэтому он видит результат, а не догадывается.
          </p>
        </div>
        <div className="view-actions">
          <button type="button" className="button button--quiet" onClick={onImportFolder} disabled={importing}>
            {importing ? 'Импорт…' : 'Открыть папку'}
          </button>
          <button type="button" className="button" onClick={onNewProject}>
            Новый проект
          </button>
        </div>
      </header>

      <section className="desktop-section desktop-section--workspace">
        <div className="desktop-section-head">
          <div>
            <h2>Текущий проект</h2>
            <p>{project.files.length} файлов · ветка {workspace.metadata.activeBranch}</p>
          </div>
          <button type="button" className="button button--quiet" onClick={onOpenWorkspace}>
            Открыть рабочую область
          </button>
        </div>
        <article className="workspace-card">
          <div className="workspace-card-icon" aria-hidden="true">⌘</div>
          <div className="workspace-card-main">
            <strong>{workspace.metadata.name}</strong>
            <span>{workspace.metadata.localPath ?? 'Локальный workspace'}</span>
          </div>
          <span className={`workspace-branch workspace-branch--${checks && checks.findings.length === 0 ? 'ok' : 'idle'}`}>
            {checks ? summarizeChecks(checks) : 'проверки не запускались'}
          </span>
        </article>
      </section>

      <section className="desktop-section">
        <div className="desktop-section-head">
          <div>
            <h2>Что умеет агент</h2>
            <p>Три режима работы одного и того же цикла.</p>
          </div>
          <button type="button" className="button button--quiet" onClick={onOpenAgents}>
            Подробнее
          </button>
        </div>
        <div className="agent-grid">
          <article className="agent-card">
            <div className="agent-card-top">
              <span className="agent-avatar" aria-hidden="true">С</span>
              <span className="agent-status"><i /> {mode === 'build' ? 'активен' : 'готов'}</span>
            </div>
            <h3>Сборка</h3>
            <p>Пишет файлы проекта и сам проверяет результат в предпросмотре.</p>
            <span className="agent-model">{model ?? (local ? provider.model : 'модель не выбрана')}</span>
            <button type="button" className="agent-action" onClick={onOpenWorkspace}>
              Открыть рабочую область <span aria-hidden="true">→</span>
            </button>
          </article>

          <article className="agent-card">
            <div className="agent-card-top">
              <span className="agent-avatar" aria-hidden="true">П</span>
              <span className="agent-status"><i /> {mode === 'plan' ? 'активен' : 'готов'}</span>
            </div>
            <h3>План</h3>
            <p>Возвращает подход и чек-лист, не меняя файлы, и ждёт подтверждения.</p>
            <span className="agent-model">без изменений в проекте</span>
            <button type="button" className="agent-action" onClick={onOpenWorkspace}>
              Спланировать <span aria-hidden="true">→</span>
            </button>
          </article>

          <article className="agent-card">
            <div className="agent-card-top">
              <span className="agent-avatar" aria-hidden="true">П</span>
              <span className="agent-status"><i /> {checks ? 'запускались' : 'не запускались'}</span>
            </div>
            <h3>Проверки</h3>
            <p>Структура HTML, ссылки на файлы, баланс CSS и синтаксис JavaScript — без выполнения кода.</p>
            <span className="agent-model">{checks ? summarizeChecks(checks) : 'нет данных'}</span>
            <button type="button" className="agent-action" onClick={onOpenWorkspace}>
              Запустить <span aria-hidden="true">→</span>
            </button>
          </article>
        </div>
      </section>

      <section className="desktop-section">
        <div className="desktop-section-head">
          <div>
            <h2>Провайдер</h2>
            <p>Ключ остаётся на локальном сервере; браузер видит только имя модели.</p>
          </div>
          <button type="button" className="button button--quiet" onClick={onOpenSettings}>
            Настроить
          </button>
        </div>
        <article className="workspace-card">
          <div className="workspace-card-icon" aria-hidden="true">{local ? '⌂' : '☁'}</div>
          <div className="workspace-card-main">
            <strong>{provider.name}</strong>
            <span>{provider.model || 'модель не выбрана'} · {provider.baseUrl}</span>
          </div>
          <span className={`workspace-branch workspace-branch--${configured ? 'ok' : 'idle'}`}>
            {configured ? 'готов' : 'не настроен'}
          </span>
        </article>
        {configured === false ? (
          <p className="desktop-tip-line">
            Без провайдера чат объяснит настройку, а предпросмотр продолжит показывать текущий проект.
            Ollama и LM Studio работают локально и не требуют ключа.
          </p>
        ) : null}
      </section>

      <section className="desktop-section">
        <div className="desktop-section-head">
          <div>
            <h2>Недавние проекты</h2>
            <p>{workspaces.length} сохранено на этом компьютере.</p>
          </div>
          <button type="button" className="button button--quiet" onClick={onOpenProjects}>
            Все проекты
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="desktop-tip-line">Других проектов пока нет — текущий станет первым в списке.</p>
        ) : (
          <ul className="project-list">
            {recent.map((entry) => (
              <li key={entry.metadata.id} className="project-row">
                <span className="workspace-card-icon" aria-hidden="true">⌘</span>
                <div className="project-row-main">
                  <strong>{entry.metadata.name}</strong>
                  <span>{entry.project.files.length} файлов · {new Date(entry.metadata.updatedAt).toLocaleDateString()}</span>
                </div>
                <span className="workspace-branch">{entry.metadata.activeBranch}</span>
                <button type="button" className="button button--quiet" onClick={() => onOpenWorkspaceById(entry.metadata.id)}>
                  Открыть
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
