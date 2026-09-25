import { DEFAULT_LIMITS, formatTokens, HARD_STEP_CAP } from '../lib/budget'
import { TOOL_LABELS } from '../lib/protocol'
import type { AgentMode } from '../lib/protocol'
import type { ProviderProfile } from '../lib/agent'

type Props = {
  provider: ProviderProfile
  configured: boolean | null
  model: string | null
  mode: AgentMode
  onModeChange: (mode: AgentMode) => void
  onOpenWorkspace: () => void
  onOpenSettings: () => void
  onOpenBrowserSessions: () => void
}

/**
 * What the agent actually is: one loop over the selected provider, bounded by a
 * budget it paces itself, with four tools and two modes. The numbers come from
 * the same constants the turn uses.
 */
export function AgentsView({
  provider,
  configured,
  model,
  mode,
  onModeChange,
  onOpenWorkspace,
  onOpenSettings,
  onOpenBrowserSessions,
}: Props) {
  const local = provider.kind === 'ollama' || provider.kind === 'lmstudio'

  return (
    <main className="desktop-home">
      <header className="desktop-home-head">
        <div>
          <p className="desktop-kicker">Агент</p>
          <h1>Как он работает</h1>
          <p className="desktop-subtitle">
            Один агент, один проект, один бюджет на ход. Режим «План» ничего не меняет: он
            возвращает подход и чек-лист, и ждёт подтверждения.
          </p>
        </div>
        <div className="view-actions">
          <button type="button" className="button button--quiet" onClick={onOpenSettings}>
            Провайдеры
          </button>
          <button type="button" className="button" onClick={onOpenWorkspace}>
            В рабочую область
          </button>
        </div>
      </header>

      <section className="desktop-section">
        <div className="desktop-section-head">
          <div>
            <h2>Провайдер</h2>
            <p>Ключ остаётся на локальном сервере, браузер видит только «настроено» и имя модели.</p>
          </div>
        </div>
        <article className="workspace-card">
          <div className="workspace-card-icon" aria-hidden="true">{local ? '⌂' : '☁'}</div>
          <div className="workspace-card-main">
            <strong>{provider.name}</strong>
            <span>
              {provider.model || 'модель не выбрана'} · {provider.baseUrl}
            </span>
          </div>
          <span className={`workspace-branch workspace-branch--${configured ? 'ok' : 'idle'}`}>
            {configured ? 'готов' : 'не настроен'}
          </span>
        </article>
        {configured === false ? (
          <p className="desktop-tip-line">
            Настройте провайдера в разделе «Провайдеры»: Ollama и LM Studio запускаются на этом
            компьютере и не требуют ключа.
          </p>
        ) : null}
      </section>

      <section className="desktop-section">
        <div className="desktop-section-head">
          <div>
            <h2>Режим работы</h2>
            <p>Переключается в композере; в режиме плана файлы не применяются.</p>
          </div>
        </div>
        <div className="segmented" role="group" aria-label="Режим агента">
          <button
            type="button"
            className={`segment${mode === 'build' ? ' segment--active' : ''}`}
            onClick={() => onModeChange('build')}
          >
            Сборка
          </button>
          <button
            type="button"
            className={`segment${mode === 'plan' ? ' segment--active' : ''}`}
            onClick={() => onModeChange('plan')}
          >
            План
          </button>
        </div>
        <p className="desktop-tip-line">
          Сейчас: {mode === 'plan' ? 'план — только подход и чек-лист' : 'сборка — агент пишет файлы и проверяет результат'}
          {model ? ` · модель ${model}` : ''}
        </p>
      </section>

      <section className="desktop-section">
        <div className="desktop-section-head">
          <div>
            <h2>Бюджет хода</h2>
            <p>Агент видит остаток на каждом шаге и сам решает, когда завершать.</p>
          </div>
        </div>
        <div className="agent-grid">
          <article className="agent-card">
            <h3>{Math.round(DEFAULT_LIMITS.timeMs / 60_000)} минут</h3>
            <p>На один ход, включая время провайдера.</p>
            <span className="agent-model">лимит времени</span>
          </article>
          <article className="agent-card">
            <h3>{formatTokens(DEFAULT_LIMITS.tokens)}</h3>
            <p>Точный учёт, когда провайдер отдаёт usage.</p>
            <span className="agent-model">лимит токенов</span>
          </article>
          <article className="agent-card">
            <h3>{HARD_STEP_CAP}</h3>
            <p>Далеко за пределами реального бюджета: нужен только чтобы цикл гарантированно завершился.</p>
            <span className="agent-model">шагов, защита от цикла</span>
          </article>
        </div>
      </section>

      <section className="desktop-section">
        <div className="desktop-section-head">
          <div>
            <h2>Инструменты</h2>
            <p>Агент смотрит на живой предпросмотр и проект, а не догадывается.</p>
          </div>
        </div>
        <ul className="project-list">
          {Object.entries(TOOL_LABELS).map(([name, label]) => (
            <li key={name} className="project-row">
              <span className="workspace-card-icon" aria-hidden="true">⌘</span>
              <div className="project-row-main">
                <strong>{label}</strong>
                <span><code>{name}</code></span>
              </div>
            </li>
          ))}
        </ul>
        <p className="desktop-tip-line">
          Провайдер без поддержки tool calls тоже работает — вы просто теряете самопроверку.
        </p>
      </section>

      <section className="desktop-tip">
        <span className="desktop-tip-icon" aria-hidden="true">◎</span>
        <div>
          <strong>Сессии браузера — экспериментальная функция</strong>
          <p>Подключение к уже открытой вкладке Qwen или DeepSeek через расширение-компаньон. Cookies не читаются.</p>
        </div>
        <button type="button" className="button button--quiet" onClick={onOpenBrowserSessions}>
          Настроить
        </button>
      </section>
    </main>
  )
}
