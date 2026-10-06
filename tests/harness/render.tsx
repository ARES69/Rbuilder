/**
 * @vitest-environment jsdom
 *
 * A DOM harness for React components.
 *
 * Every component test in this project runs here, and the reason it is a hand
 * written harness rather than a testing library is that the whole thing is
 * sixty lines of `react-dom/client`, `act` and `querySelector`. That code is
 * already in the tree — React and jsdom are dependencies of the app and of the
 * preview tests — so a test harness built from what ships costs no install and
 * no lockfile churn, and has nothing to go stale behind a version bump.
 *
 * What it gives up is a testing library's matcher vocabulary. In exchange a test
 * reads the same selectors the interface renders: `.turn-rewind`,
 * `.changes-undo`, `[aria-label="Требуется подтверждение"]`. A class name
 * renamed in the component breaks the test, which is the point — the harness
 * does not abstract away the thing the test is asserting about.
 *
 * Usage:
 *
 * ```tsx
 * import { render, screen } from '../harness/render'
 *
 * render(<MessageList messages={messages} examples={[]} />)
 * screen.click('.turn-rewind')
 * expect(screen.text('.confirm-question')).toContain('Откатить')
 * ```
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach } from 'vitest'
import type { ReactNode } from 'react'

/**
 * React only flushes effects synchronously inside `act` when the environment
 * declares itself a testing one. Without this flag React warns and defers the
 * update, so an assertion runs against a tree the component has not finished
 * rendering.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * jsdom has no layout, so it implements no scrolling.
 *
 * Any component that keeps the newest message in view reaches for
 * `scrollIntoView` and crashes on it — a fact about the environment, not about
 * the component. Standing in for the browser is the harness's job, so it is done
 * once here rather than in every test that happens to mount something which
 * scrolls.
 */
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}

/** The roots this harness is holding, unmounted after every test. */
const mounted: Root[] = []

export type Rendered = {
  /** The element the component was mounted into. */
  container: HTMLElement
  /** Renders a new tree into the same container, keeping the component's state. */
  rerender: (next: ReactNode) => void
  unmount: () => void
}

/** Mounts a component and returns its container. */
export function render(ui: ReactNode): Rendered {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push(root)
  act(() => {
    root.render(ui)
  })
  return {
    container,
    rerender: (next) => {
      act(() => {
        root.render(next)
      })
    },
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/**
 * Unmounts after every test.
 *
 * Registered here rather than asked of each test: a component left mounted holds
 * its timers and listeners, and the next test would inherit a page that is
 * already dirty. A test that unmounts by hand is still correct — this is the
 * safety net, not the contract.
 */
afterEach(() => {
  for (const root of mounted.splice(0)) {
    act(() => root.unmount())
  }
  document.body.innerHTML = ''
})

/** A node to act on: something already found, or a selector that finds it. */
type Target = string | HTMLElement | null

function node(target: Target): HTMLElement {
  if (target instanceof HTMLElement) return target
  if (typeof target === 'string') {
    const found = document.querySelector<HTMLElement>(target)
    if (!found) throw new Error(`Нет элемента по селектору: ${target}`)
    return found
  }
  throw new Error('Нечего нажимать: элемент не найден')
}

/**
 * Queries and events over the whole document.
 *
 * Document-wide rather than container-scoped: a component test asserts about
 * what a person can see and click, and several of them render a portal or a
 * sibling. Querying `document` also means a selector copied out of the
 * component's own markup finds the same node the browser would.
 */
export const screen = {
  /** Every match, in document order. */
  all(selector: string): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(selector)]
  },

  /** The first match, or null. */
  find(selector: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(selector)
  },

  /** The first match; throws when there is none, naming the selector. */
  need(selector: string): HTMLElement {
    return node(selector)
  },

  /** How many elements match. */
  count(selector: string): number {
    return document.querySelectorAll(selector).length
  },

  /** The trimmed text of the first match, or null when nothing matches. */
  text(selector: string): string | null {
    return document.querySelector(selector)?.textContent?.trim() ?? null
  },

  /** The trimmed text of every match. */
  texts(selector: string): string[] {
    return this.all(selector).map((element) => element.textContent?.trim() ?? '')
  },

  /**
   * The button with exactly this label.
   *
   * Matching on the label rather than a class keeps tests tied to what the
   * button says, which is what the user reads, instead of to how it is styled.
   */
  button(label: string): HTMLElement {
    const match = this.all('button').find(
      (element) => element.textContent?.trim() === label,
    )
    if (!match) throw new Error(`Нет кнопки «${label}»`)
    return match
  },

  /** Presses a button, a node or a selector, letting React see the update. */
  click(target: Target): void {
    act(() => {
      node(target).click()
    })
  },

  /**
   * Sets the value of an input the way a person would, then fires `input`.
   *
   * Assigning `element.value` directly is invisible to React: it tracks the
   * value on the DOM node and compares against the last render, so a plain
   * assignment looks like no change and the controlled input never fires. Going
   * through the prototype's setter is what makes React's own bookkeeping see a
   * new value.
   */
  type(target: Target, value: string): void {
    const element = node(target)
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
      throw new Error(`Элемент ${element.tagName} не принимает текст`)
    }
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(element),
        'value',
      )?.set
      setter?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  },

  /**
   * Lets pending effects and microtasks run inside `act`.
   *
   * For a component that settles over a promise — a spinner that disappears, a
   * result that arrives from a fetch. Assert after `await`, never during.
   */
  async settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve()
    })
  },
}