import { useMemo } from 'react'
import type { ChecksResult } from '../lib/checks'
import { lineDiff, totalDiff } from '../lib/diff'
import { fileGlyph, fileGlyphClass } from '../lib/fileIcons'
import type { PreviewInspector } from '../lib/inspector'
import type { PageLink } from '../lib/pages'
import type { Project } from '../lib/project'
import type { PlanItem } from '../lib/protocol'
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
  /** Pages of a multi-page project, passed through to the preview. */
  pages: PageLink[]
  /** The bound project folder, passed through to the Git panel. */
  folder: string | null
  document: string
  /** A failed preview compile, shown above the preview frame. */
  bundleError?: string | null
  channel: string
  filePaths: string[]
  hasIndex: boolean
  inspector: PreviewInspector
  dockTab: 'files' | 'git' | 'console' | 'checks' | 'terminal'
  onDockTabChange: (tab: 'files' | 'git' | 'console' | 'checks' | 'terminal') => void
  checks: ChecksResult | null
  /** The agent's live checklist, when a turn produced one. */
  plan: PlanItem[]
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
  /** Opens a changed file in the code column, landing on its diff. */
  onOpenFile: (path: string) => void
  focusFile: string | null
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

  /** Per-file +N -N, the way the Git tools card shows them. */
  const fileDiffs = useMemo(
    () =>
      changed.map((file) => {
        const baseline = baselineProject.files.find((entry) => entry.path === file.path)
        const diff = lineDiff(baseline ? baseline.content : null, file.content)
        return { path: file.path, added: diff.added, removed: diff.removed, isNew: !baseline }
      }),
    [changed, baselineProject.files],
  )
  const totals = totalDiff(fileDiffs)

  const steps = useMemo(() => {
    if (props.plan.length > 0) return props.plan.map((item) => ({ text: item.text, done: item.done }))
    // No checklist yet: show the shape of the work instead of nothing.
    return [
      { text: 'Создать структуру проекта', done: changed.length > 0 },
      { text: 'Написать код приложения', done: project.files.length > 1 },
      { text: 'Проверить и исправить', done: false },
    ]
  }, [props.plan, changed.length, project.files.length])
  const doneCount = steps.filter((step) => step.done).length
  const complete = props.plan.length > 0 && doneCount === props.plan.length

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
            <em className="inspector-add">+{totals.added}</em> <em className="inspector-del">−{totals.removed}</em>
          </span>
        </button>
        {fileDiffs.length > 0 ? (
          <ul className="inspector-files">
            {fileDiffs.slice(0, 6).map((entry) => (
              <li key={entry.path}>
                <button type="button" className="inspector-file" onClick={() => props.onOpenFile(entry.path)}>
                  <span className={`inspector-file-icon file-glyph file-glyph--${fileGlyphClass(entry.path)}`} aria-hidden="true">{fileGlyph(entry.path)}</span>
                  <span className="inspector-file-path">{entry.path}</span>
                  <span className="inspector-file-diff">
                    <em className="inspector-add">+{entry.added}</em> <em className="inspector-del">−{entry.removed}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
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
          {complete ? <span className="inspector-badge">Complete</span> : null}
        </header>
        <div className="inspector-goal">
          <span className="inspector-goal-icon" aria-hidden="true">◎</span>
          <p>{describeGoal(project)}</p>
        </div>
        <div className="inspector-progress">
          <span className="inspector-progress-label">Progress</span>
          <span className="inspector-progress-value">
            {props.plan.length > 0
              ? `${doneCount}/${steps.length}${changed.length > 0 ? ` · ${changed.length} файлов` : ''}`
              : changed.length > 0
                ? `${changed.length} файлов изменено`
                : 'ожидание первой задачи'}
          </span>
        </div>
        <ul className="inspector-steps">
          {steps.map((step, index) => (
            <li key={`${index}-${step.text}`} className={step.done ? 'done' : ''}>{step.text}</li>
          ))}
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
            bundleError={props.bundleError}
            channel={props.channel}
            files={props.filePaths}
            project={project}
            baselineProject={props.baselineProject}
            folder={props.folder}
            hasIndex={props.hasIndex}
            pages={props.pages}
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
          <CodeWorkbench
            project={project}
            baseline={props.baselineProject}
            onWriteFile={props.onWriteFile}
            focusPath={props.focusFile}
          />
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
