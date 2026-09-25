import type { Project } from '../lib/project'

type Props = {
  project: Project
  configured: boolean | null
  model: string | null
  onOpenWorkspace: () => void
  onNewProject: () => void
}

const agents = [
  { name: 'Builder', task: 'Готов к новой задаче', model: 'Основной агент', state: 'idle' },
  { name: 'Reviewer', task: 'Проверить изменения и запустить проверки', model: 'Агент проверки', state: 'idle' },
  { name: 'Researcher', task: 'Изучить документацию и API', model: 'Исследовательский агент', state: 'idle' },
]

export function DesktopHome({ project, configured, model, onOpenWorkspace, onNewProject }: Props) {
  return (
    <main className="desktop-home">
      <header className="desktop-home-head">
        <div>
          <p className="desktop-kicker">Локальные рабочие области</p>
          <h1>Добрый день</h1>
          <p className="desktop-subtitle">Запускайте параллельных агентов на компьютере, каждого в собственной рабочей области.</p>
        </div>
        <button type="button" className="button" onClick={onNewProject}>Новый проект</button>
      </header>

      <section className="desktop-section">
        <div className="desktop-section-head">
          <div>
            <h2>Агенты</h2>
            <p>Поручайте задачи, сохраняя контроль над проектом.</p>
          </div>
          <span className="desktop-muted">{configured ? model ?? 'Подключено' : 'Локальная настройка'}</span>
        </div>
        <div className="agent-grid">
          {agents.map((agent) => (
            <article className="agent-card" key={agent.name}>
              <div className="agent-card-top">
                <span className="agent-avatar">{agent.name.slice(0, 1)}</span>
                <span className="agent-status"><i /> {agent.state}</span>
              </div>
              <h3>{agent.name}</h3>
              <p>{agent.task}</p>
              <span className="agent-model">{agent.model}</span>
              <button type="button" className="agent-action" onClick={onOpenWorkspace}>Открыть рабочую область <span>→</span></button>
            </article>
          ))}
        </div>
      </section>

      <section className="desktop-section desktop-section--workspace">
        <div className="desktop-section-head">
          <div>
            <h2>Недавние рабочие области</h2>
            <p>Ваши локальные проекты и изолированные ветки агентов.</p>
          </div>
          <button type="button" className="button button--quiet" onClick={onOpenWorkspace}>Показать все</button>
        </div>
        <article className="workspace-card">
          <div className="workspace-card-icon">⌘</div>
          <div className="workspace-card-main">
            <strong>RBUILDER project</strong>
            <span>Текущий проект · {project.files.length} files</span>
          </div>
          <span className="workspace-branch">main</span>
          <button type="button" className="button button--quiet" onClick={onOpenWorkspace}>Открыть</button>
        </article>
      </section>

      <section className="desktop-tip">
        <span className="desktop-tip-icon">⌘</span>
        <div><strong>Каждый агент получает свою рабочую область</strong><p>Агенты могут параллельно редактировать, тестировать и проверять код, не мешая друг другу.</p></div>
        <button type="button" className="button button--quiet" onClick={onOpenWorkspace}>Подробнее</button>
      </section>
    </main>
  )
}
