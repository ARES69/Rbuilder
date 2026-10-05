import { describe, expect, it } from 'vitest'
import { plural, pluralForm, withCount } from '../src/lib/plural'

const file = ['файл', 'файла', 'файлов'] as const

describe('pluralForm', () => {
  it('reads the last digit, not just the ones digit', () => {
    expect(pluralForm(1)).toBe('one')
    expect(pluralForm(21)).toBe('one')
    expect(pluralForm(101)).toBe('one')
  })

  it('treats the teens as many, however they end', () => {
    for (const count of [11, 12, 13, 14, 111, 112, 214]) {
      expect(pluralForm(count)).toBe('many')
    }
  })

  it('counts two to four as few', () => {
    for (const count of [2, 3, 4, 22, 23, 34, 102]) {
      expect(pluralForm(count)).toBe('few')
    }
  })

  it('sends everything else to many', () => {
    for (const count of [0, 5, 9, 10, 20, 100, 1000]) {
      expect(pluralForm(count)).toBe('many')
    }
  })

  it('reads a negative count by its value, not its sign', () => {
    expect(pluralForm(-1)).toBe('one')
    expect(pluralForm(-5)).toBe('many')
  })
})

describe('withCount', () => {
  it('agrees with the count', () => {
    expect(withCount(1, ...file)).toBe('1 файл')
    expect(withCount(2, ...file)).toBe('2 файла')
    expect(withCount(5, ...file)).toBe('5 файлов')
  })

  it('does not agree with the ones digit alone', () => {
    expect(withCount(11, ...file)).toBe('11 файлов')
    expect(withCount(21, ...file)).toBe('21 файл')
  })

  it('says nothing for no items, rather than «0 файла»', () => {
    expect(withCount(0, ...file)).toBe('0 файлов')
  })
})

describe('plural', () => {
  it('returns the word on its own', () => {
    expect(plural(1, ...file)).toBe('файл')
    expect(plural(3, ...file)).toBe('файла')
    expect(plural(7, ...file)).toBe('файлов')
  })
})