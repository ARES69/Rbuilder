import { useMemo, useState } from 'react'
import { testProvider, type ProviderProfile } from '../lib/agent'

type Props = {
  profiles: ProviderProfile[]
  activeId: string
  onActiveChange: (id: string) => void
  onSave: (profile: ProviderProfile) => void
  onClose: () => void
}

export function SettingsPanel({ profiles, activeId, onActiveChange, onSave, onClose }: Props) {
  const selected = useMemo(() => profiles.find((profile) => profile.id === activeId) ?? profiles[0], [activeId, profiles])
  const [draft, setDraft] = useState(selected)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  if (!selected) return null

  const update = (patch: Partial<ProviderProfile>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setStatus(null)
  }

  const choose = (id: string) => {
    onActiveChange(id)
    const next = profiles.find((profile) => profile.id === id)
    if (next) setDraft(next)
    setStatus(null)
  }

  const test = async () => {
    setTesting(true)
    const result = await testProvider(draft)
    setTesting(false)
    if (result.ok) {
      if (result.models.length && !result.models.includes(draft.model)) {
        setDraft((current) => ({ ...current, model: result.models[0] }))
      }
      setStatus({ ok: true, text: result.models.length ? `Connected · ${result.models.length} моделей найдено` : 'Подключено' })
    } else {
      setStatus({ ok: false, text: result.error ?? 'Не удалось подключиться' })
    }
  }

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-head">
          <div><p className="desktop-kicker">Настройки</p><h2 id="settings-title">Провайдеры моделей</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть настройки">×</button>
        </header>
        <p className="settings-lede">Подключите любого OpenAI-совместимого провайдера. Ключи хранятся в локальном профиле браузера и отправляются только на локальный сервер разработки.</p>

        <label className="settings-label">Провайдер<select className="settings-input" value={draft.id} onChange={(event) => choose(event.target.value)}>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
        <div className="settings-grid">
          <label className="settings-label">Отображаемое имя<input className="settings-input" value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label>
          <label className="settings-label">Модель<input className="settings-input" value={draft.model} onChange={(event) => update({ model: event.target.value })} placeholder="qwen2.5-coder:7b" /></label>
        </div>
        <label className="settings-label">Базовый URL<input className="settings-input" value={draft.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="http://localhost:11434/v1" /></label>
        <label className="settings-label">API-ключ <span className="settings-optional">не нужен для локальных провайдеров</span><input className="settings-input" type="password" value={draft.apiKey} onChange={(event) => update({ apiKey: event.target.value })} placeholder="sk-…" /></label>

        {draft.kind === 'custom' ? (
          <div className="custom-api-fields">
            <p className="settings-subhead">Адаптер пользовательского API</p>
            <div className="settings-grid">
              <label className="settings-label">Путь чата<input className="settings-input" value={draft.chatPath ?? '/chat/completions'} onChange={(event) => update({ chatPath: event.target.value })} /></label>
              <label className="settings-label">Путь списка моделей<input className="settings-input" value={draft.modelsPath ?? '/models'} onChange={(event) => update({ modelsPath: event.target.value })} /></label>
            </div>
            <label className="settings-label">Заголовок авторизации <span className="settings-optional">use {'{{apiKey}}'} as a placeholder</span><input className="settings-input" value={draft.authHeader ?? 'Authorization: Bearer {{apiKey}}'} onChange={(event) => update({ authHeader: event.target.value })} /></label>
            <label className="settings-label">Дополнительные заголовки <span className="settings-optional">JSON object</span><textarea className="settings-input settings-textarea" value={draft.extraHeaders ?? ''} onChange={(event) => update({ extraHeaders: event.target.value })} placeholder={'{"X-API-Key":"{{apiKey}}"}'} /></label>
          </div>
        ) : null}

        {status ? <p className={`settings-status${status.ok ? ' settings-status--ok' : ''}`}>{status.text}</p> : null}
        <div className="settings-presets"><span>Быстрая настройка</span><button type="button" onClick={() => update({ kind: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'qwen2.5-coder:7b', name: 'Ollama' })}>Ollama</button><button type="button" onClick={() => update({ kind: 'lmstudio', baseUrl: 'http://localhost:1234/v1', apiKey: 'lm-studio', model: 'local-model', name: 'LM Studio' })}>LM Studio</button><button type="button" onClick={() => update({ kind: 'custom', name: 'Custom API', baseUrl: 'https://api.example.com/v1', apiKey: '', model: '', chatPath: '/chat/completions', modelsPath: '/models', authHeader: 'Authorization: Bearer {{apiKey}}', extraHeaders: '' })}>Custom API</button><button type="button" onClick={() => update({ kind: 'custom', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: 'openai/gpt-4o-mini', chatPath: '/chat/completions', modelsPath: '/models', authHeader: 'Authorization: Bearer {{apiKey}}', extraHeaders: '{"HTTP-Referer":"http://localhost:5185","X-Title":"RBUILDER"}' })}>OpenRouter</button><button type="button" onClick={() => update({ kind: 'custom', name: 'YandexGPT / Alice', baseUrl: 'https://rest-assistant.api.cloud.yandex.net/v1', apiKey: '', model: 'gpt://<folder-id>/yandexgpt/latest', chatPath: '/chat/completions', modelsPath: '/models', authHeader: 'Api-Key: {{apiKey}}', extraHeaders: '{"X-RBUILDER-Provider":"yandex"}' })}>Yandex / Alice</button></div>
        <footer className="settings-actions"><button type="button" className="button button--quiet" onClick={onClose}>Отмена</button><button type="button" className="button button--quiet" onClick={() => void test()} disabled={testing}>{testing ? 'Проверка…' : 'Проверить соединение'}</button><button type="button" className="button" onClick={() => { onSave(draft); onClose() }}>Сохранить провайдера</button></footer>
      </section>
    </div>
  )
}
