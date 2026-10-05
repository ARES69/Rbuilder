import { describe, expect, it } from 'vitest'
import {
  INSTRUCTIONS_FILE,
  MAX_INSTRUCTIONS_BYTES,
  instructionsContext,
  instructionsSummary,
  isInstructionsPath,
  readInstructions,
} from '../src/lib/instructions'

const files = (...entries: [string, string][]) => entries.map(([path, content]) => ({ path, content }))

describe('Путь к инструкциям', () => {
  it('узнаёт файл в корне в любом регистре', () => {
    expect(isInstructionsPath(INSTRUCTIONS_FILE)).toBe(true)
    expect(isInstructionsPath('rbuilder.md')).toBe(true)
    expect(isInstructionsPath('./RBUILDER.md')).toBe(true)
    expect(isInstructionsPath('  RBUILDER.md  ')).toBe(true)
  })

  it('не путает инструкции с обычным файлом', () => {
    expect(isInstructionsPath('README.md')).toBe(false)
    expect(isInstructionsPath('docs/RBUILDER.md')).toBe(false)
    expect(isInstructionsPath('src\\RBUILDER.md')).toBe(false)
    expect(isInstructionsPath('RBUILDER.md.txt')).toBe(false)
    expect(isInstructionsPath('')).toBe(false)
  })
})

describe('Чтение инструкций', () => {
  it('возвращает текст файла проекта', () => {
    expect(readInstructions(files(['index.html', '<html>'], [INSTRUCTIONS_FILE, '  Только Tailwind.  ']))).toBe(
      'Только Tailwind.',
    )
  })

  it('пусто, когда файла нет', () => {
    expect(readInstructions(files(['index.html', '<html>']))).toBe('')
    expect(readInstructions([])).toBe('')
  })
})

describe('Блок инструкций для модели', () => {
  it('пуст без инструкций, чтобы проект без них ничего не платил', () => {
    expect(instructionsContext('')).toBe('')
    expect(instructionsContext('   \n  ')).toBe('')
  })

  it('оборачивает правила в именованный блок и называет файл', () => {
    const block = instructionsContext('- Только React\n- Без CSS-in-JS')
    expect(block).toContain(`standing instructions in ${INSTRUCTIONS_FILE}`)
    expect(block).toContain('```project-instructions')
    expect(block).toContain('- Только React\n- Без CSS-in-JS')
    expect(block.endsWith('```')).toBe(true)
  })

  it('обрезает слишком длинные правила и говорит об этом', () => {
    const block = instructionsContext('я'.repeat(MAX_INSTRUCTIONS_BYTES * 2))
    expect(block).toContain('was cut here')
    expect(block.length).toBeLessThan(MAX_INSTRUCTIONS_BYTES * 2)
  })
})

describe('Короткое содержание инструкций', () => {
  it('берёт первую непустую строку', () => {
    expect(instructionsSummary('\n\n  Только Tailwind  \nи без сборщика')).toBe('Только Tailwind')
    expect(instructionsSummary('')).toBe('')
  })

  it('обрезает длинную строку', () => {
    const summary = instructionsSummary('я'.repeat(200), 20)
    expect(summary).toHaveLength(20)
    expect(summary.endsWith('…')).toBe(true)
  })
})
