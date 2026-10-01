import { useEffect, useMemo, useRef, useState } from 'react'
import { diffLines, lineDiff, type DiffLine } from '../lib/diff'
import { fileGlyph, fileGlyphClass } from '../lib/fileIcons'
import type { Project, ProjectFile } from '../lib/project'

type Props = {
  project: Project
  /** Pre-agent snapshot of the project, so the diff has something to compare to. */
  baseline?: Project
  onWriteFile: (path: string, content: string) => void
  /** A file the transcript or the inspector asked to open. */
  focusPath?: string | null
}

type View = 'code' | 'diff'

export function CodeWorkbench({ project, baseline, onWriteFile, focusPath }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const file = useMemo<ProjectFile | undefined>(
    () => project.files.find((entry) => entry.path === selected) ?? project.files[0],
    [project.files, selected],
  )
  const [draft, setDraft] = useState(file?.content ?? '')
  const [view, setView] = useState<View>('code')

  useEffect(() => setDraft(file?.content ?? ''), [file?.path, file?.content])

  /** Per-file diff vs the baseline; only changed paths are in the map. */
  const changes = useMemo(() => {
    const map = new Map<string, { added: number; removed: number }>()
    if (!baseline) return map
    for (const entry of project.files) {
      const before = baseline.files.find((candidate) => candidate.path === entry.path)
      if (before && before.content === entry.content) continue
      map.set(entry.path, lineDiff(before ? before.content : null, entry.content))
    }
    return map
  }, [project.files, baseline])

  // Opening a changed file from the chat or the inspector lands on the diff —
  // once per request, so later writes do not yank the user back out of the code.
  const handledFocus = useRef<string | null>(null)
  useEffect(() => {
    if (!focusPath || handledFocus.current === focusPath) return
    if (!project.files.some((entry) => entry.path === focusPath)) return
    handledFocus.current = focusPath
    setSelected(focusPath)
    setView(changes.has(focusPath) ? 'diff' : 'code')
  }, [focusPath, project.files, changes])

  const change = file ? changes.get(file.path) : undefined
  const dirty = Boolean(file && file.content !== draft)

  const lines = useMemo<DiffLine[]>(
    () =>
      view === 'diff' && file
        ? diffLines(baseline?.files.find((entry) => entry.path === file.path)?.content ?? null, file.content)
        : [],
    [view, file, baseline],
  )

  return (
    <section className="code-workbench" aria-label="Редактор кода">
      <header className="ide-panel-head">
        <span>⌄ Проект</span>
        <span className="ide-head-meta">
          {project.files.length} файлов{changes.size > 0 ? ` · изменено ${changes.size}` : ''}
        </span>
      </header>
      <div className="code-workbench-body">
        <nav className="code-tree" aria-label="Дерево файлов">
          <div className="tree-root">⌄ <strong>rbuilder</strong></div>
          {project.files.map((entry) => {
            const diff = changes.get(entry.path)
            return (
              <button
                type="button"
                key={entry.path}
                className={`tree-file${entry.path === file?.path ? ' tree-file--active' : ''}`}
                onClick={() => setSelected(entry.path)}
              >
                <span className={`tree-glyph tree-glyph--${fileGlyphClass(entry.path)}`} aria-hidden="true">
                  {fileGlyph(entry.path)}
                </span>
                <span className="tree-path">{entry.path}</span>
                {diff ? (
                  <span className="tree-diff">
                    <em className="diff-add">+{diff.added}</em> <em className="diff-del">−{diff.removed}</em>
                  </span>
                ) : null}
              </button>
            )
          })}
        </nav>
        <div className="code-editor">
          <div className="editor-tabs">
            <span className="editor-tab editor-tab--active">{file?.path ?? 'Нет файла'}</span>
            <span className="editor-view-toggle" role="group" aria-label="Вид файла">
              <button
                type="button"
                className={`editor-view${view === 'code' ? ' editor-view--active' : ''}`}
                onClick={() => setView('code')}
              >
                Код
              </button>
              <button
                type="button"
                className={`editor-view${view === 'diff' ? ' editor-view--active' : ''}`}
                onClick={() => setView('diff')}
                disabled={!change}
                title={change ? 'Изменения относительно исходной версии' : 'Нет изменений'}
              >
                Diff{change ? ` +${change.added} −${change.removed}` : ''}
              </button>
            </span>
            <span className="editor-actions">{dirty ? '● Изменено' : '✓ Сохранено'}</span>
          </div>

          {view === 'diff' ? (
            <div className="diff-view" aria-label="Изменения файла">
              {lines.map((line, index) => (
                <DiffRow key={index} line={line} />
              ))}
            </div>
          ) : (
            <textarea
              className="code-editor-input"
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Содержимое файла"
            />
          )}

          <footer className="editor-footer">
            <span>TypeScript</span>
            <span>UTF-8 · LF</span>
            <button
              type="button"
              className="editor-save"
              disabled={!file || !dirty || view === 'diff'}
              onClick={() => file && onWriteFile(file.path, draft)}
            >
              Сохранить
            </button>
          </footer>
        </div>
      </div>
    </section>
  )
}

function DiffRow({ line }: { line: DiffLine }) {
  const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '
  return (
    <div className={`diff-line diff-line--${line.kind}`}>
      <span className="diff-sign" aria-hidden="true">{sign}</span>
      <span className="diff-text">{line.text || ' '}</span>
    </div>
  )
}
