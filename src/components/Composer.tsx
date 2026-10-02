import { useEffect, useRef } from 'react'
import { AttachmentChips } from './AttachmentChips'
import type { AttachmentMeta } from '../lib/attachments'
import { budgetUsed, describeBudget, formatDuration, msLeft, type Budget } from '../lib/budget'
import { describeCost, formatCost, type CostResult, type SessionSpend } from '../lib/pricing'
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
  /** What the last turn cost, or null before the first one. */
  lastCost: CostResult | null
  /** Running total for this session. */
  spend: SessionSpend
  reading: boolean
  attachments: AttachmentMeta[]
  onAttach: (files: FileList | File[]) => void
  onRemoveAttachment: (id: string) => void
  configured: boolean | null
  mode: AgentMode
  onModeChange: (mode: AgentMode) => void
  onOpenSettings: () => void
  /** Provider + model shown in the composer, switchable in place. */
  providerName: string
  model: string | null
  models: { id: string; name: string; models: string[] }[]
  activeProviderId: string
  onProviderChange: (id: string) => void
  onModelChange: (model: string) => void
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
  lastCost,
  spend,
  reading,
  attachments,
  onAttach,
  onRemoveAttachment,
  configured,
  mode,
  onModeChange,
  onOpenSettings,
  model,
  models,
  activeProviderId,
  onProviderChange,
  onModelChange,
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
                className={`segment${mode === 'ask' ? ' segment--active' : ''}`}
                onClick={() => onModeChange('ask')}
                title="Показывать правки на подтверждение перед записью">Спрашивать</button>
              <button
                type="button"
                className={`segment${mode === 'plan' ? ' segment--active' : ''}`}
                onClick={() => onModeChange('plan')}
                title="Сначала согласовать план, не изменяя код">План</button>
            </div>
            <button
              type="button"
              className="attach-button"
              onClick={() => fileRef.current?.click()}
              title="Прикрепить файлы"
              aria-label="Прикрепить файлы"
            >+</button>
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
                    : mode === 'ask'
                      ? 'Правки применяются только после вашего подтверждения'
                      : 'Любой тип файла · перетащите его на панель'}
              </span>
            )}
          </div>

          <div className="composer-actions-right">
            {/* Model chip + send button, the zcode composer way. */}
            <div className="model-chip-group">
              <select
                className="model-chip"
                value={activeProviderId}
                onChange={(event) => onProviderChange(event.target.value)}
                aria-label="Провайдер"
                title="Провайдер"
              >
                {models.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
              </select>
              {model ? (
                <select
                  className="model-chip model-chip--model"
                  value={model}
                  onChange={(event) => onModelChange(event.target.value)}
                  aria-label="Модель"
                  title="Модель"
                >
                  {(() => {
                    const current = models.find((entry) => entry.id === activeProviderId)
                    const list = current?.models?.length ? current.models : [model]
                    if (!list.includes(model)) list.unshift(model)
                    return list.map((entry) => <option key={entry} value={entry}>{entry}</option>)
                  })()}
                </select>
              ) : null}
              {lastCost ? (
                <span
                  className={`cost-chip cost-chip--${lastCost.kind}`}
                  title={`${describeCost(lastCost)}. Цены зафиксированы 2026-10-02 и могут измениться у провайдера.`}
                >
                  {lastCost.kind === 'priced' ? formatCost(lastCost.cost) : describeCost(lastCost)}
                  {spend.turns > 1 && spend.complete && lastCost.kind === 'priced'
                    ? ` · всего ${formatCost(spend.cost)}`
                    : ''}
                </span>
              ) : null}
            </div>
            {busy ? (
              <button
                type="button"
                className="send-button send-button--stop"
                onClick={onStop}
                title="Остановить агента"
                aria-label="Остановить"
              >■</button>
            ) : (
              <button
                type="button"
                className="send-button"
                onClick={onSend}
                disabled={!canSend}
                title="Отправить (Enter)"
                aria-label="Отправить"
              >↑</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
