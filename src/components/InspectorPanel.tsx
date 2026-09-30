import { useMemo } from 'react'
import type { ChecksResult } from '../lib/checks'
import type { PreviewInspector } from '../lib/inspector'
import type { Project } from '../lib/project'
import type { TerminalLine } from '../lib/store'
import { CodeWorkbench } from './CodeWorkbench'
import { PreviewPane } from './PreviewPane'

/** Mirrors the App-level git summary shape. */
type GitSummary = { isRepo: boolean; branch: string | null; changes: number; lastCommit: string | null }

export type InspectorTab = 'inspector' | 'preview' | 'code'

type Props = {
  tab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
  project: Project
  baselineProject: Project
  document: string
  channel: string
  filePaths: string[]
  hasIndex: boolean
  inspector: PreviewInspector
  dockTab: 'files' | 'git' | 'console' | 'checks' | 'terminal'
  onDockTabChange: (tab: 'files' | 'git' | 'console' | 'checks' | 'terminal') => void
  checks: ChecksResult | null
  runningChecks: boolean
  git: GitSummary | null
  onRunChecks: () => void
  terminal: TerminalLine[]
  terminalRunning: boolean
  onRunCommand: (command: string) => void
  onClearTerminal: () => void
  onWriteFile: (path: string, content: string) => void
  onDeleteFile: (path: string) => void
  onAskAgent: (prompt: string) => void
}

/**
 * The right-hand column of the zcode shell. Default tab is the compact
 * inspector card (Changes / branch / Checks); the preview and the code editor
 * expand to the full column when picked.
 */
export function InspectorPanel(props: Props) {
  const { tab, onTabChange, project, baselineProject, git, checks } = props

  const changed = useMemo(
    () =>
      project.files.filter((file) => {
        const baseline = baselineProject.files.find((entry) => entry.path === file.path)
        return !baseline || baseline.content !== file.content
      }),
    [project.files, baselineProject.files],
  )
  const addedCount = changed.filter((file) => !baselineProject.files.some((entry) => entry.path === file.path)).length
  const modifiedCount = changed.length - addedCount

  const inspectorCard = (
    <div className="inspector-card">
      <section className="inspector-block">
        <header className="inspector-block-head">
          <h3>Git tools</h3>
        </header>
        <button type="button" className="inspector-row" onClick={() => { onTabChange('code'); props.onDockTabChange('git') }}>
          <span className="inspector-row-icon" aria-hidden="true">▣</span>
          <span className="inspector-row-main">
            <strong>Changes</strong>
            <small>{changed.length === 0 ? 'нет изменений' : `${changed.length} файлов`}</small>
          </span>
          <span className="inspector-diff">
            <em className="inspector-add">+{addedCount}</em> <em className="inspector-del">-{modifiedCount}</em>
          </span>
        </button>
        <div className="inspector-row inspector-row--static">
          <span className="inspector-row-icon" aria-hidden="true">⑂</span>
          <span className="inspector-row-main">
            <strong>{git?.isRepo ? git.branch : 'main'}</strong>
            <small>{git?.isRepo ? `${git.changes} измен.` : 'нет репозитория'}</small>
          </span>
        </div>
        <div className="inspector-row inspector-row--static">
          <span className="inspector-row-icon" aria-hidden="true">✓</span>
          <span className="inspector-row-main">
            <strong>Checks</strong>
            <small>{checks ? `${checks.findings.length} замечаний` : 'не запускались'}</small>
          </span>
          <button type="button" className="inspector-run" onClick={props.onRunChecks} disabled={props.runningChecks}>
            {props.runningChecks ? '…' : 'Run'}
          </button>
        </div>
      </section>

      <section className="inspector-block">
        <header className="inspector-block-head">
          <h3>Goal</h3>
        </header>
        <div className="inspector-goal">
          <span className="inspector-goal-icon" aria-hidden="true">◎</span>
          <p>{describeGoal(project)}</p>
        </div>
        <div className="inspector-progress">
          <span className="inspector-progress-label">Progress</span>
          <span className="inspector-progress-value">{changed.length > 0 ? `${changed.length} файлов изменено` : 'ожидание первой задачи'}</span>
        </div>
        <ul className="inspector-steps">
          <li className={changed.length > 0 ? 'done' : ''}>Создать структуру проекта</li>
          <li className={project.files.length > 1 ? 'done' : ''}>Написать код приложения</li>
          <li>Проверить и исправить</li>
        </ul>
      </section>

      <div className="inspector-tabs-bottom">
        <button type="button" className={`inspector-tab${tab === 'preview' ? ' inspector-tab--active' : ''}`} onClick={() => onTabChange('preview')}>
          ◱ Превью
        </button>
        <button type="button" className={`inspector-tab${tab === 'code' ? ' inspector-tab--active' : ''}`} onClick={() => onTabChange('code')}>
          ⇥ Код
        </button>
      </div>
    </div>
  )

  return (
    <aside className="inspector-panel" aria-label="Инспектор проекта">
      <div className="inspector-switch">
        <button type="button" className={`inspector-switch-tab${tab === 'inspector' ? ' inspector-switch-tab--active' : ''}`} onClick={() => onTabChange('inspector')}>
          Инспектор
        </button>
        <button type="button" className={`inspector-switch-tab${tab === 'preview' ? ' inspector-switch-tab--active' : ''}`} onClick={() => onTabChange('preview')}>
          Превью
        </button>
        <button type="button" className={`inspector-switch-tab${tab === 'code' ? ' inspector-switch-tab--active' : ''}`} onClick={() => onTabChange('code')}>
          Код
        </button>
      </div>

      {tab === 'inspector' ? inspectorCard : null}
      {tab === 'preview' ? (
        <div className="inspector-full">
          <PreviewPane
            document={props.document}
            channel={props.channel}
            files={props.filePaths}
            project={project}
            baselineProject={props.baselineProject}
            hasIndex={props.hasIndex}
            inspector={props.inspector}
            tab={props.dockTab}
            onTabChange={props.onDockTabChange}
            checks={checks}
            runningChecks={props.runningChecks}
            onRunChecks={props.onRunChecks}
            terminal={props.terminal}
            terminalRunning={props.terminalRunning}
            onRunCommand={props.onRunCommand}
            onClearTerminal={props.onClearTerminal}
            onWriteFile={props.onWriteFile}
            onDeleteFile={props.onDeleteFile}
            onAskAgent={props.onAskAgent}
          />
        </div>
      ) : null}
      {tab === 'code' ? (
        <div className="inspector-full">
          <CodeWorkbench project={project} onWriteFile={props.onWriteFile} />
        </div>
      ) : null}
    </aside>
  )
}

function describeGoal(project: Project): string {
  if (project.files.length === 0) return 'Опишите приложение в чате — цель появится здесь.'
  const index = project.files.find((file) => file.path === 'index.html')
  if (index) {
    const title = index.content.match(/<title>([^<]*)<\/title>/i)?.[1]
    if (title) return title
  }
  return 'Собрать приложение из текущего чата'
}
