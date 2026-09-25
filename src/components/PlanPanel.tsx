import type { AgentMode, PlanItem } from '../lib/protocol'

type Props = {
  plan: PlanItem[]
  mode: AgentMode
  busy: boolean
  onApprove: () => void
}

/** The agent's checklist, shown above the composer while a task is in flight. */
export function PlanPanel({ plan, mode, busy, onApprove }: Props) {
  if (plan.length === 0 && mode !== 'plan') return null

  const done = plan.filter((item) => item.done).length

  return (
    <section className="plan" aria-label="План">
      <div className="plan-head">
        <span className="plan-title">
          {mode === 'plan' ? 'Режим плана' : 'План'}
          {plan.length > 0 ? (
            <span className="plan-progress">
              {' '}
              · {done}/{plan.length} готово
            </span>
          ) : null}
        </span>

        {mode === 'plan' ? (
          <button
            type="button"
            className="button"
            onClick={onApprove}
            disabled={busy || plan.length === 0}>Подтвердить и создать</button>
        ) : null}
      </div>

      {plan.length === 0 ? (
        <p className="plan-note">
          Опишите изменение — RBUILDER предложит подход и чек-лист до начала написания кода.
        </p>
      ) : (
        <ul className="plan-items">
          {plan.map((item, index) => (
            <li key={`${item.text}-${index}`} className={item.done ? 'plan-item plan-item--done' : 'plan-item'}>
              <span className="plan-check" aria-hidden="true">
                {item.done ? '✓' : ''}
              </span>
              <span className="plan-text">{item.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
