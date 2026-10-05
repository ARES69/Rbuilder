import { useEffect, useState } from 'react'
import { INSTRUCTIONS_FILE } from '../lib/instructions'

type Props = {
  /** The project's current instructions, or an empty string. */
  value: string
  /** Receives the new text; an empty text removes the file. */
  onSave: (value: string) => void
  onClose: () => void
}

/**
 * Editor for the project's standing rules.
 *
 * Deliberately the same shape as the settings dialog: one field, one save, no
 * clever editing. The file is the source of truth, so what this writes is
 * exactly what the model is told and exactly what the user can later open in
 * the file tree.
 */
export function InstructionsPanel({ value, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="settings-panel instructions-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="instructions-title"
      >
        <header className="settings-head">
          <div>
            <p className="desktop-kicker">Проект</p>
            <h2 id="instructions-title">Инструкции проекта</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть инструкции">
            ×
          </button>
        </header>

        <p className="settings-lede">
          Этот текст уходит модели перед каждым сообщением: стек, структура, имена, чего делать нельзя.
          Он лежит в файле <code>{INSTRUCTIONS_FILE}</code> в корне проекта — виден в дереве файлов,
          попадает в папку и в git, и его можно править руками.
        </p>

        <label className="settings-label">
          Правила проекта
          <textarea
            className="settings-input settings-textarea instructions-textarea"
            value={draft}
            spellCheck={false}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            placeholder={'- Только React и обычный CSS, без сборщика\n- Стили в styles.css, без CSS-in-JS\n- Тёмная тема по умолчанию'}
          />
        </label>
        {value.trim() ? (
          <p className="settings-hint">Пустой текст удалит {INSTRUCTIONS_FILE} из проекта.</p>
        ) : null}

        <footer className="settings-actions">
          <button type="button" className="button button--quiet" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="button" onClick={() => onSave(draft)}>
            Сохранить
          </button>
        </footer>
      </section>
    </div>
  )
}
