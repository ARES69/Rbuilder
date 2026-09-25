import { useEffect, useRef } from 'react'
import { AttachmentChips } from './AttachmentChips'
import type { AttachmentMeta } from '../lib/attachments'
import { budgetUsed, describeBudget, formatDuration, msLeft, type Budget } from '../lib/budget'
import type { AgentMode } from '../lib/protocol'

type Props = {
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  /** Live budget for the running turn, or null when nothing is running. */
  budget: Budget | null
  /** True once the turn is landing: tools are withdrawn and it is writing up. */
  wrappingUp: boolean
  reading: boolean
  attachments: AttachmentMeta[]
  onAttach: (files: FileList | File[]) => void
  onRemoveAttachment: (id: string) => void
  configured: boolean | null
  mode: AgentMode
  onModeChange: (mode: AgentMode) => void
  onOpenSettings: () => void
}

const MAX_TEXTAREA_HEIGHT = 208

export function Composer({
  draft,
  onDraftChange,
  onSend,
  onStop,
  busy,
  budget,
  wrappingUp,
  reading,
  attachments,
  onAttach,
  onRemoveAttachment,
  configured,
  mode,
  onModeChange,
  onOpenSettings,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [draft])

  const canSend = !busy && !reading && (draft.trim().length > 0 || attachments.length > 0)

  return (
    <div className="composer">
      {configured === false ? (
        <p className="notice">
          Модель не настроена. Выберите Ollama, LM Studio или API-провайдера в <button type="button" className="inline-button" onClick={onOpenSettings}>настройках моделей</button>.
        </p>
      ) : null}

      <div className="composer-box">
        <AttachmentChips attachments={attachments} onRemove={onRemoveAttachment} />

        <label className="sr-only" htmlFor="composer-input">
          Опишите приложение, которое нужно создать
        </label>
        <textarea
          id="composer-input"
          ref={textareaRef}
          className="composer-input"
          value={draft}
          rows={1}
          placeholder="Опишите приложение, которое нужно создать…"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (canSend) onSend()
            }
          }}
        />

        <div className="composer-actions">
          <div className="composer-actions-left">
            <div className="segmented" role="group" aria-label="Режим работы">
              <button
                type="button"
                className={`segment${mode === 'build' ? ' segment--active' : ''}`}
                onClick={() => onModeChange('build')}
                title="Сразу писать код">Создать</button>
              <button
                type="button"
                className={`segment${mode === 'plan' ? ' segment--active' : ''}`}
                onClick={() => onModeChange('plan')}
                title="Сначала согласовать план, не изменяя код">План</button>
            </div>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => fileRef.current?.click()}>Прикрепить файлы</button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                if (event.target.files?.length) onAttach(event.target.files)
                event.target.value = ''
              }}
            />
            {busy && budget ? (
              <span
                className={`budget${wrappingUp ? ' budget--wrapping' : ''}`}
                title="Бюджет этого запуска. Модель получает те же числа и сама распределяет усилия."
              >
                <span className="budget-meter" aria-hidden="true">
                  <span
                    className="budget-meter-fill"
                    style={{ width: `${Math.round(budgetUsed(budget) * 100)}%` }}
                  />
                </span>
                <span className="budget-text">
                  {wrappingUp
                    ? `Завершение · осталось ${formatDuration(msLeft(budget))}`
                    : describeBudget(budget)}
                </span>
              </span>
            ) : (
              <span className="composer-hint">
                {reading
                  ? 'Читаю файлы…'
                  : mode === 'plan'
                    ? 'Режим плана · код не изменяется до подтверждения'
                    : 'Любой тип файла · перетащите его на панель'}
              </span>
            )}
          </div>

          {busy ? (
            <button
              type="button"
              className="button button--quiet"
              onClick={onStop}
              title="Остановить агента">Остановить</button>
          ) : (
            <button type="button" className="button" onClick={onSend} disabled={!canSend}>Отправить</button>
          )}
        </div>
      </div>
    </div>
  )
}
