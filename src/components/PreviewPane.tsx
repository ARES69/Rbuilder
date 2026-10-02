import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { Dock, type DockTab } from './Dock'
import type { ChecksResult } from '../lib/checks'
import type { PreviewInspector } from '../lib/inspector'
import type { Project } from '../lib/project'
import type { TerminalLine } from '../lib/store'

export type { DockTab }

type Props = {
  document: string
  /** A compile that failed, shown above the preview instead of inside it. */
  bundleError?: string | null
  /** Channel the injected runtime answers on; changes with every rebuild. */
  channel: string
  files: string[]
  project: Project
  baselineProject: Project
  /** The bound project folder, so the Git panel reads the real repository. */
  folder: string | null
  hasIndex: boolean
  inspector: PreviewInspector
  tab: DockTab
  onTabChange: (tab: DockTab) => void
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
}

export function PreviewPane(props: Props) {
  const { document, files, hasIndex, inspector, channel } = props
  const [version, setVersion] = useState(0)
  const [collapsed, setCollapsed] = useState(false)

  // Re-render when the inspector records an event, so badges stay live.
  const [, force] = useReducer((count: number) => count + 1, 0)

  // Every rebuild mounts a fresh document; a stable ref keeps the event log.
  useEffect(() => {
    setVersion((current) => current + 1)
  }, [document])

  useEffect(() => inspector.subscribe(force), [inspector])

  // Tells the inspector which document is current the moment a rebuild starts.
  useEffect(() => {
    inspector.expect(channel)
  }, [inspector, channel])

  const attachFrame = useCallback(
    (element: HTMLIFrameElement | null) => inspector.attach(element, props.channel),
    [inspector, props.channel],
  )

  const openInNewTab = useMemo(
    () => () => {
      const blob = new Blob([document], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
    [document],
  )

  const visibleFiles = files.slice(0, 2)
  const hiddenCount = files.length - visibleFiles.length
  const problems = inspector.problems.length

  return (
    <section className="pane preview-pane" aria-label="Предпросмотр">
      <header className="pane-header">
        <h2 className="pane-title">Предпросмотр</h2>
        <div className="pane-header-end">
          {problems > 0 ? (
            <span className="problem-badge" title="Ошибки или неудачные запросы в предпросмотре">
              {problems} {problems === 1 ? 'ошибка' : 'ошибок'}
            </span>
          ) : null}
          <ul className="chips chips--files" aria-label="Project files">
            {visibleFiles.map((path) => (
              <li key={path} className="chip chip--file">
                {path}
              </li>
            ))}
            {hiddenCount > 0 ? (
              <li className="chip chip--file chip--muted" title={files.join('\n')}>
                +{hiddenCount}
              </li>
            ) : null}
          </ul>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setVersion((current) => current + 1)}
            disabled={!hasIndex}>Обновить</button>
          <button
            type="button"
            className="button button--quiet"
            onClick={openInNewTab}
            disabled={!hasIndex}
            title="Открыть предпросмотр в новой вкладке">Открыть</button>
        </div>
      </header>

      {props.bundleError ? (
        <p className="preview-bundle-error" role="alert">
          Сборка не удалась: {props.bundleError}
        </p>
      ) : null}

      <div className="preview-frame">
        {hasIndex && document ? (
          <iframe
            key={version}
            ref={attachFrame}
            className="preview-iframe"
            title="App preview"
            srcDoc={document}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
          />
        ) : (
          <div className="preview-empty">
            {hasIndex ? (
              <>
                <p className="empty-eyebrow">Собираю превью</p>
                <p className="empty-lede">
                  Проект на TypeScript или JSX компилируется перед показом — это занимает секунду.
                </p>
              </>
            ) : (
              <>
                <p className="empty-eyebrow">Нет index.html</p>
                <p className="empty-lede">
                  Попросите RBUILDER создать веб-приложение — оно появится здесь. Предпросмотр
                  отображает текущее содержимое проекта.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <Dock
        project={props.project}
        baselineProject={props.baselineProject}
        folder={props.folder}
        tab={props.tab}
        onTabChange={props.onTabChange}
        inspector={inspector}
        events={inspector.events}
        problemCount={problems}
        checks={props.checks}
        runningChecks={props.runningChecks}
        onRunChecks={props.onRunChecks}
        terminal={props.terminal}
        terminalRunning={props.terminalRunning}
        onRunCommand={props.onRunCommand}
        onClearTerminal={props.onClearTerminal}
        onWriteFile={props.onWriteFile}
        onDeleteFile={props.onDeleteFile}
        onAskAgent={props.onAskAgent}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((current) => !current)}
      />
    </section>
  )
}
