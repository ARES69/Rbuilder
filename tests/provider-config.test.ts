import { describe, expect, it } from 'vitest'
import { isProfileReady, resolveModelConfig, type AgentConfig, type ProviderProfile } from '../src/lib/agent'

/** A profile with everything filled in, which is what a saved provider looks like. */
const complete: ProviderProfile = {
  id: 'custom',
  name: 'Custom API',
  kind: 'custom',
  baseUrl: 'http://127.0.0.1:11434/v1',
  apiKey: 'sk-test',
  model: 'qwen2.5-coder:7b',
}

const local: ProviderProfile = { ...complete, id: 'ollama', kind: 'ollama', apiKey: '' }
const blank: ProviderProfile = { ...complete, id: 'custom', name: 'Custom API', apiKey: '', model: '' }
const serverOff: AgentConfig = { configured: false }
const serverOn: AgentConfig = { configured: true, model: 'gpt-4o-mini' }

describe('Готовность профиля', () => {
  it('профиль с адресом, моделью и ключом готов', () => {
    expect(isProfileReady(complete)).toBe(true)
  })

  it('локальному провайдеру ключ не нужен', () => {
    expect(isProfileReady(local)).toBe(true)
    expect(isProfileReady({ ...local, kind: 'lmstudio' })).toBe(true)
  })

  it('удалённому провайдеру без ключа не повезло', () => {
    expect(isProfileReady({ ...blank, model: 'gpt-4o-mini' })).toBe(false)
  })

  it('пустые строки и пробелы не считаются заполненными полями', () => {
    expect(isProfileReady({ ...complete, baseUrl: '   ' })).toBe(false)
    expect(isProfileReady({ ...complete, model: '  ' })).toBe(false)
    expect(isProfileReady({ ...complete, apiKey: '   ', kind: 'openai' })).toBe(false)
  })
})

describe('Что показывать о подключении', () => {
  /*
   * The regression: the server's env configuration says "no model here" while
   * the browser holds a complete profile, and the composer used to believe the
   * server — because its answer arrived after the profile effect had already
   * written the flag. The profile is what travels with the request, so it wins.
   */
  it('готовый профиль не перебивается «не настроено» от сервера', () => {
    expect(resolveModelConfig(complete, serverOff)).toEqual({ configured: true, model: 'qwen2.5-coder:7b' })
  })

  it('и когда ответ сервера ещё не пришёл', () => {
    expect(resolveModelConfig(complete, null)).toEqual({ configured: true, model: 'qwen2.5-coder:7b' })
  })

  it('готовый профиль важнее модели, названной сервером', () => {
    expect(resolveModelConfig(complete, serverOn)).toEqual({ configured: true, model: 'qwen2.5-coder:7b' })
  })

  it('без профиля подхватывается конфигурация сервера', () => {
    expect(resolveModelConfig(blank, serverOn)).toEqual({ configured: true, model: 'gpt-4o-mini' })
  })

  it('без профиля и без конфигурации сервера — честное «не настроено»', () => {
    expect(resolveModelConfig(blank, serverOff)).toEqual({ configured: false })
    expect(resolveModelConfig(blank, null)).toEqual({ configured: false })
  })

  it('ответ сервера умеет только включить подключение, а не выключить', () => {
    // Готовый профиль серверным ответом не перебивается.
    expect(resolveModelConfig(complete, serverOff)).toEqual({ configured: true, model: 'qwen2.5-coder:7b' })
    // А когда за профилем и за сервером ничего нет — флаг говорит об этом прямо.
    expect(resolveModelConfig({ ...blank, baseUrl: '' }, serverOff)).toEqual({ configured: false })
  })
})
