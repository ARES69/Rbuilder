/**
 * The narrow-window contract, read straight from the stylesheet.
 *
 * A window too narrow for two work panes shows one of them at a time, and the
 * rail carries the switch that picks which. That lives in CSS rather than in a
 * reducer, so there is nothing in `src/lib` to unit test — but the two rules
 * below have each been broken in a way no type checker sees:
 *
 * - The switch did not exist, and the stylesheet hid the inspector outright, so
 *   files, the preview and the checks were unreachable below the breakpoint.
 * - `.app { flex-direction: column }` in source-ui.css was written for a sidebar
 *   this shell no longer has. It applied anyway, stacking the rail above the
 *   work pane and leaving a 150px chat under a 400px rail.
 *
 * So the rules are the contract, and this asserts they are still there.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles/shell-zcode.css', import.meta.url), 'utf8')

/** Everything inside one `@media` block, found by balancing its braces. */
function mediaBlock(query: string): string {
  const start = css.indexOf(`@media ${query} {`)
  expect(start, `нет блока @media ${query}`).toBeGreaterThan(-1)
  let depth = 0
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}' && --depth === 0) return css.slice(start, index)
  }
  throw new Error(`блок @media ${query} не закрыт`)
}

/** The first rule whose selector matches exactly, outside any @media. */
function baseRule(selector: string): string {
  const index = css.indexOf(`\n${selector} {`)
  expect(index, `нет правила ${selector}`).toBeGreaterThan(-1)
  return css.slice(index, css.indexOf('}', index))
}

const narrow = mediaBlock('(max-width: 980px)')

describe('Узкое окно', () => {
  it('не показывает переключатель, пока панели помещаются', () => {
    expect(baseRule('.shell-pane-switch')).toContain('display: none')
  })

  it('показывает переключатель только в узком окне', () => {
    expect(narrow).toMatch(/\.shell-pane-switch\s*\{[^}]*display:\s*flex/)
  })

  it('оставляет панель задач рядом с работой, а не над ней', () => {
    // Правило из source-ui.css складывало оболочку в колонку; десктопное
    // окно, ставшее узким, всё ещё десктопное.
    expect(narrow).toMatch(/\.app--zcode\s*\{[^}]*flex-direction:\s*row/)
  })

  it('прячет ровно одну рабочую панель — ту, которую не выбрали', () => {
    expect(narrow).toMatch(/\[data-pane='chat'\]\s*\.inspector-panel\s*\{[^}]*display:\s*none/)
    expect(narrow).toMatch(/\[data-pane='inspector'\]\s*\.zcode-chat\s*\{[^}]*display:\s*none/)
  })

  it('отдаёт инспектору всю ширину, когда он единственная панель', () => {
    expect(narrow).toMatch(
      /\[data-pane='inspector'\]\s*\.inspector-panel\s*\{[^}]*flex:\s*1[^}]*width:\s*auto/,
    )
  })

  it('не оставляет ручку инспектора, когда его не видно', () => {
    expect(narrow).toMatch(/\.column-resizer--end\s*\{[^}]*display:\s*none/)
  })
})
