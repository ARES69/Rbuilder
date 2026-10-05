/**
 * The contract between the three places a tool has to appear.
 *
 * A tool that is implemented but not declared is invisible to the model, one
 * that is declared but not implemented answers «Unknown tool», and one that is
 * mentioned in the prompt but not declared is a lie the model will act on. None
 * of that fails a type check, and none of it showed up as a bug until there
 * were enough tools to drift.
 */

import { describe, expect, it } from 'vitest'
import { TOOL_DEFINITIONS, TOOL_LABELS, buildSystemPrompt } from '../src/lib/protocol'
import { executeTool, type ToolContext } from '../src/lib/tools'
import type { ToolCall } from '../src/lib/protocol'

const declared = TOOL_DEFINITIONS.map((entry) => entry.function.name)

/** Tool lines in the prompt look like `- read_project_file(path): …`. */
function toolsNamedInPrompt(): string[] {
  const prompt = buildSystemPrompt('build')
  const names = new Set<string>()
  for (const match of prompt.matchAll(/^- ([a-z_]+)\(/gm)) names.add(match[1]!)
  return [...names]
}

describe('Объявленные инструменты', () => {
  it('у каждого определения есть подпись для трейса', () => {
    for (const name of declared) {
      expect(TOOL_LABELS[name], name).toBeTypeOf('string')
    }
  })

  it('каждая подпись соответствует объявленному инструменту', () => {
    for (const name of Object.keys(TOOL_LABELS)) {
      expect(declared, name).toContain(name)
    }
  })

  it('все инструменты, названные в промпте, действительно объявлены', () => {
    for (const name of toolsNamedInPrompt()) {
      expect(declared, `промпт упоминает ${name}, но определения нет`).toContain(name)
    }
  })

  it('каждый объявленный инструмент назван в промпте', () => {
    const named = toolsNamedInPrompt()
    // Если разбор промпта перестанет что-то находить, проверка ниже станет
    // пустой и будет проходить на пустом множестве.
    expect(named.length, 'в промпте не нашлось ни одного инструмента').toBeGreaterThan(0)
    for (const name of declared) {
      expect(named, name).toContain(name)
    }
  })

  it('объявленный инструмент не отвечает «Unknown tool»', async () => {
    // Инспектор нужен только инструментам превью, которые падают тут и так.
    const context = {} as ToolContext

    for (const name of declared) {
      const call: ToolCall = { id: 'c1', name, arguments: '{}' }
      const outcome = await executeTool(call, context)
      expect(outcome.text, name).not.toContain('Unknown tool')
    }
  })
})

describe('search_project', () => {
  const definition = TOOL_DEFINITIONS.find((entry) => entry.function.name === 'search_project')

  it('объявлен модели с обязательным шаблоном', () => {
    expect(definition).toBeDefined()
    const parameters = definition!.function.parameters
    expect(parameters.required).toEqual(['pattern'])
    expect(parameters.additionalProperties).toBe(false)
    expect(Object.keys(parameters.properties)).toContain('regex')
  })

  it('назван в системном промпте вместе с остальными', () => {
    expect(toolsNamedInPrompt()).toContain('search_project')
  })
})
