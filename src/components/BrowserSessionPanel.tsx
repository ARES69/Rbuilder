import { useEffect, useMemo, useState } from 'react'
import { BrowserBridge, type BrowserSessionProvider, type BrowserSessionState } from '../lib/browserBridge'

type Props = { onClose: () => void }

export function BrowserSessionPanel({ onClose }: Props) {
  const bridge = useMemo(() => new BrowserBridge(), [])
  const [provider, setProvider] = useState<BrowserSessionProvider>('qwen')
  const [state, setState] = useState<BrowserSessionState>('disconnected')
  const [message, setMessage] = useState('Расширение браузера не подключено.')
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState('Say hello from RBUILDER in one sentence.')

  useEffect(() => () => bridge.dispose(), [bridge])

  const connect = async () => {
    setBusy(true)
    setState('connecting')
    const result = await bridge.connect(provider)
    setBusy(false)
    setState(result.ok ? 'connected' : 'disconnected')
    setMessage(result.message)
  }

  const sendPrompt = async () => {
    setBusy(true)
    const result = await bridge.prompt(provider, prompt)
    setBusy(false)
    setMessage(result.message)
  }

  const disconnect = async () => {
    setBusy(true)
    const result = await bridge.disconnect()
    setBusy(false)
    setState('disconnected')
    setMessage(result.message)
  }

  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="settings-panel browser-session-panel" role="dialog" aria-modal="true" aria-labelledby="browser-session-title">
      <header className="settings-head"><div><p className="desktop-kicker">Экспериментальная функция</p><h2 id="browser-session-title">Сессии браузера</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">×</button></header>
      <p className="settings-lede">Подключите дополнительное расширение RBUILDER к уже открытой вкладке. RBUILDER не читает и не экспортирует cookies, пароли или токены сессии.</p>
      <label className="settings-label">Сервис<select className="settings-input" value={provider} onChange={(event) => setProvider(event.target.value as BrowserSessionProvider)}><option value="qwen">Qwen</option><option value="deepseek">DeepSeek</option></select></label>
      <div className={`browser-session-status browser-session-status--${state}`}><span className="status-dot" /> <span><strong>{state === 'connected' ? `Подключено к ${provider}` : state === 'connecting' ? 'Ожидание расширения' : 'Отключено'}</strong><small>{message}</small></span></div>
      <ol className="browser-session-steps"><li>Установите расширение-компаньон RBUILDER.</li><li>Откройте и войдите в {provider === 'qwen' ? 'Qwen' : 'DeepSeek'} yourself.</li><li>Нажмите кнопку расширения на этой вкладке, затем подключитесь ниже.</li></ol>
      {state === 'connected' ? <label className="settings-label">Тестовый запрос<textarea className="settings-input settings-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label> : null}
      <footer className="settings-actions"><button type="button" className="button button--quiet" onClick={onClose}>Cancel</button>{state === 'connected' ? <><button type="button" className="button button--quiet" onClick={() => void sendPrompt()} disabled={busy || !prompt.trim()}>{busy ? 'Отправка…' : 'Отправить тестовый запрос'}</button><button type="button" className="button button--quiet" onClick={() => void disconnect()} disabled={busy}>Отключить</button></> : <button type="button" className="button" onClick={() => void connect()} disabled={busy}>{busy ? 'Подключение…' : 'Подключить текущую вкладку'}</button>}</footer>
    </section>
  </div>
}
