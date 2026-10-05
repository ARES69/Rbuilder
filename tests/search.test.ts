import { describe, expect, it } from 'vitest'
import {
  MAX_LINE_CHARS,
  MAX_SEARCH_MATCHES,
  formatSearch,
  searchProject,
} from '../src/lib/search'
import { describeCall, executeTool, type ToolContext } from '../src/lib/tools'
import type { ToolCall } from '../src/lib/protocol'

const app = {
  path: 'src/app.js',
  content: [
    'import { render } from "./render.js";',      // 1
    '',                                          // 2
    'export function startTimer(seconds) {',     // 3
    '  const id = setInterval(tick, seconds)',   // 4
    '  return id',                               // 5
    '}',                                         // 6
    '// TODO: restart does not clear the old id',// 7
  ].join('\n'),
}

const page = { path: 'index.html', content: '<button onclick="startTimer(60)">Старт</button>' }
const style = { path: 'styles.css', content: '.timer { color: red }' }

const project = [app, page, style]

describe('Поиск по проекту', () => {
  it('находит строки с номерами в формате grep', () => {
    const result = searchProject(project, { pattern: 'startTimer' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.matches.map((match) => `${match.path}:${match.line}`)).toEqual([
      'src/app.js:3',
      'index.html:1',
    ])
    expect(result.files).toBe(2)
    expect(result.total).toBe(2)
    expect(result.scanned).toBe(3)
    expect(result.truncated).toBe(false)
  })

  it('ищет без учёта регистра, пока не попросят иначе', () => {
    const loose = searchProject(project, { pattern: 'starttimer' })
    const exact = searchProject(project, { pattern: 'starttimer', caseSensitive: true })

    expect(loose.ok && loose.total).toBe(2)
    expect(exact.ok && exact.total).toBe(0)
  })

  it('понимает регулярное выражение, когда его попросили', () => {
    const result = searchProject(project, { pattern: 'set(Interval|Timeout)', regex: true })

    expect(result.ok && result.total).toBe(1)
  })

  it('скобки в обычном шаблоне не ломают поиск', () => {
    // Регулярное выражение здесь бы скомпилировалось в группу и не нашло бы
    // ровно того, что написано.
    const result = searchProject(project, { pattern: 'setInterval(tick, seconds)' })

    expect(result.ok && result.total).toBe(1)
    expect(result.ok && result.matches[0]?.line).toBe(4)
  })

  it('битый регулярный выражение — это ответ, а не падение', () => {
    const result = searchProject(project, { pattern: 'setInterval(', regex: true })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('invalid')
    expect(result.reason).toContain('regex: false')
  })

  it('пустой шаблон и фильтр, которому ничего не отвечает', () => {
    const empty = searchProject(project, { pattern: '   ' })
    const noFiles = searchProject(project, { pattern: 'x', path: 'src/lib' })

    expect(empty.ok).toBe(false)
    expect(noFiles.ok).toBe(false)
    if (!noFiles.ok) expect(noFiles.reason).toContain('src/lib')
  })

  it('фильтр по пути сужает до нужных файлов', () => {
    const result = searchProject(project, { pattern: 'timer', path: 'SRC/' })

    expect(result.ok && result.scanned).toBe(1)
    expect(result.ok && result.matches.map((match) => match.path)).toEqual(['src/app.js'])
  })

  it('файл с CRLF не выдаёт carriage return в строке', () => {
    const crlf = [{ path: 'a.js', content: 'one\r\ntwo\r\nthree' }]
    const result = searchProject(crlf, { pattern: 'two' })

    expect(result.ok && result.matches[0]?.text).toBe('two')
  })

  it('обрезает длинную строку и помечает это', () => {
    const long = [{ path: 'a.js', content: 'x'.repeat(500) }]
    const result = searchProject(long, { pattern: 'x' })

    expect(result.ok && result.matches[0]?.text).toHaveLength(MAX_LINE_CHARS)
    expect(result.ok && result.matches[0]?.text.endsWith('…')).toBe(true)
  })

  it('больше MAX_SEARCH_MATCHES не возвращает, но честно говорит об обрезке', () => {
    const many = [{ path: 'a.js', content: Array.from({ length: 200 }, () => 'hit').join('\n') }]
    const result = searchProject(many, { pattern: 'hit' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.matches).toHaveLength(MAX_SEARCH_MATCHES)
    expect(result.total).toBe(200)
    expect(result.truncated).toBe(true)
  })

  it('считает файлы, даже когда совпадения обрезались лимитом', () => {
    const two = [
      { path: 'a.js', content: Array.from({ length: 100 }, () => 'hit').join('\n') },
      { path: 'b.js', content: 'hit once' },
    ]
    const result = searchProject(two, { pattern: 'hit' })

    // a.js alone would fill the cap; b.js must still be counted in the header.
    expect(result.ok && result.files).toBe(2)
  })
})

describe('Текст, который получает модель', () => {
  it('заголовок, строки и подсказка при обрезке', () => {
    const many = [{ path: 'a.js', content: Array.from({ length: 70 }, () => 'hit').join('\n') }]
    const result = searchProject(many, { pattern: 'hit' })
    const text = formatSearch(result, 'hit')

    expect(text.split('\n')[0]).toBe(`${70} matches in 1 of 1 file:`)
    expect(text).toContain('a.js:1: hit')
    expect(text).toContain('Narrow it down with the `path` argument')
  })

  it('пустой результат говорит, что искали и где', () => {
    const result = searchProject(project, { pattern: 'nope' })
    const text = formatSearch(result, 'nope')

    expect(text).toBe('No match for "nope" in 3 files.')
  })

  it('причина отказа доходит до модели как есть', () => {
    const result = searchProject(project, { pattern: '', regex: false })
    expect(formatSearch(result, '')).toContain('pattern is empty')
  })
})

describe('Инструмент search_project', () => {
  const context = { project: { files: project } } as ToolContext

  const call = (args: Record<string, unknown>): ToolCall => ({
    id: 'call_1',
    name: 'search_project',
    arguments: JSON.stringify(args),
  })

  it('возвращает совпадения с номерами строк', async () => {
    const outcome = await executeTool(call({ pattern: 'startTimer' }), context)

    expect(outcome.ok).toBe(true)
    expect(outcome.summary).toBe('Search — 2 matches in 2 files')
    expect(outcome.text).toContain('src/app.js:3: export function startTimer(seconds) {')
    expect(outcome.text).toContain('index.html:1:')
  })

  it('пустой результат — не ошибка инструмента', async () => {
    const outcome = await executeTool(call({ pattern: 'nope' }), context)

    expect(outcome.ok).toBe(true)
    expect(outcome.summary).toContain('no matches')
  })

  it('битый регулярный выражение — ошибка инструмента с подсказкой', async () => {
    const outcome = await executeTool(call({ pattern: 'setInterval(', regex: true }), context)

    expect(outcome.ok).toBe(false)
    expect(outcome.text).toContain('regex: false')
  })

  it('подпись в трейсе показывает, что именно искали', () => {
    expect(describeCall(call({ pattern: 'startTimer' }))).toBe('"startTimer"')
    expect(describeCall(call({ pattern: 'startTimer', path: 'src' }))).toBe('"startTimer" in src')
  })
})
