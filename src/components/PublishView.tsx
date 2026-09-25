import { useCallback, useState } from 'react'
import { summarizeChecks, type ChecksResult } from '../lib/checks'
import { saveTextFile } from '../lib/desktop'
import { projectFilePaths, type Project } from '../lib/project'

type Props = {
  project: Project
  /** The exact document the preview renders, with styles and scripts inlined. */
  document: string
  checks: ChecksResult | null
  runningChecks: boolean
  onRunChecks: () => void
  onOpenWorkspace: () => void
}

/**
 * RBUILDER builds one self-contained HTML document: the preview inlines every
 * stylesheet and `<script src>`, because a sandboxed frame cannot resolve relative
 * URLs. Publishing therefore means exporting that document — no bundler, no
 * server, and no pretending that a static page became a deployment.
 */
export function PublishView({ project, document, checks, runningChecks, onRunChecks, onOpenWorkspace }: Props) {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const files = projectFilePaths(project)
  const size = new Blob([document]).size
  const problems = checks?.findings.filter((finding) => finding.level === 'error').length ?? 0

  const exportDocument = useCallback(async () => {
    setBusy(true)
    try {
      const name = `${projectName(files)}.html`
      const result = await saveTextFile(name, document)
      setStatus(result.saved ? `Сохранено: ${result.path ?? name}` : 'Сохранение отменено.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось сохранить файл.')
    } finally {
      setBusy(false)
    }
  }, [document, files])

  return (
    <main className="desktop-home">
      <header className="desktop-home-head">
        <div>
          <p className="desktop-kicker">Публикация</p>
          <h1>Выгрузка проекта</h1>
          <p className="desktop-subtitle">
            Проект собирается в один самодостаточный HTML-документ: стили и скрипты встроены, внешних
            файлов нет. Его можно открыть с диска или отдать на любой статический хостинг.
          </p>
        </div>
        <div className="view-actions">
          <button type="button" className="button button--quiet" onClick={onOpenWorkspace}>
            К предпросмотру
          </button>
          <button type="button" className="button" onClick={() => void exportDocument()} disabled={busy}>
            {busy ? 'Сохранение…' : 'Сохранить HTML'}
          </button>
        </div>
      </header>

      <section className="desktop-section">
        <div className="desktop-section-head">
          <div>
            <h2>Что выгружается</h2>
            <p>{files.length} файлов · {(size / 1024).toFixed(1)} КБ в собранном виде</p>
          </div>
          <button type="button" className="button button--quiet" onClick={onRunChecks} disabled={runningChecks}>
            {runningChecks ? 'Проверки…' : 'Запустить проверки'}
          </button>
        </div>
        <ul className="project-list">
          {files.map((path) => (
            <li key={path} className="project-row">
              <span className="workspace-card-icon" aria-hidden="true">◇</span>
              <div className="project-row-main">
                <strong>{path}</strong>
                <span>встроен в документ при сборке</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="desktop-section">
        <div className="desktop-section-head">
          <div>
            <h2>Состояние</h2>
            <p>Проверки разбирают HTML, CSS и JavaScript, не выполняя код проекта.</p>
          </div>
        </div>
        <p className="desktop-tip-line">
          {checks ? summarizeChecks(checks) : 'Проверки ещё не запускались.'}
          {problems > 0 ? ' Есть ошибки — их стоит исправить до выгрузки.' : ''}
        </p>
        <p className="desktop-tip-line">
          Внешние API (Bitrix24, amoCRM, Telegram и другие) работают и в выгруженном файле — через
          локальный прокси <code>/api/proxy</code> на этой машине, если приложение остаётся запущенным.
        </p>
        {status ? <p className="desktop-tip-line">{status}</p> : null}
      </section>

      <section className="desktop-tip">
        <span className="desktop-tip-icon" aria-hidden="true">↑</span>
        <div>
          <strong>Хостинг</strong>
          <p>
            Файл открывается напрямую. Для публичного адреса положите его на Cloudflare Pages, Netlify
            или любой другой статический хостинг — сборка не нужна.
          </p>
        </div>
      </section>
    </main>
  )
}

function projectName(files: string[]): string {
  const index = files.find((path) => path.toLowerCase() === 'index.html')
  return index ? 'rbuilder-app' : 'rbuilder-project'
}
