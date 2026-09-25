import { useEffect, useMemo, useState } from 'react'
import type { Project, ProjectFile } from '../lib/project'

type Props = { project: Project; onWriteFile: (path: string, content: string) => void }

export function CodeWorkbench({ project, onWriteFile }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const file = useMemo<ProjectFile | undefined>(() => project.files.find((entry) => entry.path === selected) ?? project.files[0], [project.files, selected])
  const [draft, setDraft] = useState(file?.content ?? '')

  useEffect(() => setDraft(file?.content ?? ''), [file?.path, file?.content])
  const dirty = Boolean(file && file.content !== draft)

  return <section className="code-workbench" aria-label="Редактор кода">
    <header className="ide-panel-head"><span>⌄ Проект</span><span className="ide-head-meta">{project.files.length} файлов</span></header>
    <div className="code-workbench-body">
      <nav className="code-tree" aria-label="Дерево файлов">
        <div className="tree-root">⌄ <strong>rbuilder</strong></div>
        {project.files.map((entry) => <button type="button" key={entry.path} className={`tree-file${entry.path === file?.path ? ' tree-file--active' : ''}`} onClick={() => setSelected(entry.path)}><span>{entry.path.includes('/') ? '◦' : '◇'}</span>{entry.path}</button>)}
      </nav>
      <div className="code-editor">
        <div className="editor-tabs"><span className="editor-tab editor-tab--active">{file?.path ?? 'Нет файла'}</span><span className="editor-actions">{dirty ? '● Изменено' : '✓ Сохранено'}</span></div>
        <textarea className="code-editor-input" value={draft} spellCheck={false} onChange={(event) => setDraft(event.target.value)} aria-label="Содержимое файла" />
        <footer className="editor-footer"><span>TypeScript</span><span>UTF-8 · LF</span><button type="button" className="editor-save" disabled={!file || !dirty} onClick={() => file && onWriteFile(file.path, draft)}>Сохранить</button></footer>
      </div>
    </div>
  </section>
}
