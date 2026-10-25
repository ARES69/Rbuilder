/**
 * @vitest-environment jsdom
 *
 * Tests for the harness itself — the mounting half.
 *
 * A broken harness does not fail loudly: it fails open. If `act` is missing, or
 * the environment flag is not set, or the after-each cleanup stops running, the
 * component tests still go green — they just stop proving anything, and they
 * start passing for reasons nobody wrote down. Every component test in this
 * project sits on top of these few behaviours, so they are pinned here rather
 * than assumed.
 *
 * The alternative to these tests is trusting sixty lines of React glue to stay
 * correct forever. That is exactly the kind of trust that turns a suite into
 * decoration.
 */

import { useEffect, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from './index'

/** Something with state, so a rerender that remounts is visible. */
function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0)
  return (
    <div>
      <span className="label">{label}</span>
      <span className="count">{count}</span>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Плюс
      </button>
    </div>
  )
}

describe('Монтирование', () => {
  it('ставит компонент в документ и отдаёт его контейнер', () => {
    const { container } = render(<Counter label="раз" />)

    expect(document.body.contains(container)).toBe(true)
    expect(container.querySelector('.label')?.textContent).toBe('раз')
    expect(screen.text('.count')).toBe('0')
  })

  it('применяет эффекты к моменту возврата render', () => {
    // Without `act` the effect below would land after the assertion, and every
    // component test in the project would have to await before it could assert
    // anything at all.
    function Effect() {
      const [ready, setReady] = useState(false)
      useEffect(() => {
        setReady(true)
      }, [])
      return <span className="state">{ready ? 'готово' : 'ждём'}</span>
    }

    render(<Effect />)

    expect(screen.text('.state')).toBe('готово')
  })

  it('следующий тест начинается с пустой страницы', () => {
    // This runs directly after a test that mounted a component, and it is the
    // only test in the file that renders nothing. The after-each hook has to have
    // cleared the body in between: a mounted tree that survives its test leaks
    // its timers and listeners into the next one, and a selector then matches a
    // node the test never rendered. Order in this file is part of the assertion.
    expect(document.body.innerHTML).toBe('')
  })

  it('rerender меняет пропсы, не сбрасывая состояние', () => {
    const { rerender } = render(<Counter label="раз" />)
    screen.click(screen.button('Плюс'))
    expect(screen.text('.count')).toBe('1')

    rerender(<Counter label="два" />)

    // A remount would reset the counter to 0; a real rerender keeps it and
    // applies the new label.
    expect(screen.text('.count')).toBe('1')
    expect(screen.text('.label')).toBe('два')
  })

  it('unmount убирает контейнер из документа', () => {
    const { container, unmount } = render(<Counter label="раз" />)
    expect(document.body.contains(container)).toBe(true)

    unmount()

    expect(document.body.contains(container)).toBe(false)
  })

  it('объявляет среду тестирования, чтобы React не откладывал обновления', () => {
    expect((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT).toBe(
      true,
    )
  })

  it('подставляет scrollIntoView, которого нет в jsdom', () => {
    // jsdom has no layout and implements no scrolling, so a component that keeps
    // the newest message in view would crash on mount. The harness stands in for
    // the browser so a test does not have to know it is running headless.
    function Scrolls() {
      const ref = useRef<HTMLDivElement>(null)
      useEffect(() => {
        ref.current?.scrollIntoView()
      }, [])
      return <div ref={ref} className="scrolled" />
    }

    expect(() => render(<Scrolls />)).not.toThrow()
    expect(screen.find('.scrolled')).not.toBeNull()
    expect(typeof Element.prototype.scrollIntoView).toBe('function')
  })
})
