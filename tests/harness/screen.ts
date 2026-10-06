/**
 * Querying and interacting with whatever the harness has mounted.
 *
 * The counterpart to `render.tsx`: that module puts a component on the page,
 * this one finds things on it and presses them. It is split out so the two jobs
 * stay legible — mounting owns React, querying owns the DOM — and so a test that
 * only needs `screen` does not read through the mounting code to find it.
 *
 * Everything here is document-wide rather than container-scoped. That is a
 * deliberate choice, not an oversight: a component test asserts about what a
 * person can see and click, and several components in this app render a portal
 * or a sibling outside their own subtree. Querying `document` also means a
 * selector copied out of the component's own markup finds the same node the
 * browser would.
 */

import { act } from 'react'

/** A node to act on: something already found, or a selector that finds it. */
export type Target = string | HTMLElement | null

/**
 * Resolves a `Target` to an element, refusing loudly when there is nothing.
 *
 * A test that clicks nothing and passes is worse than one that fails, so an
 * unresolved target throws rather than silently skipping the interaction.
 */
function node(target: Target): HTMLElement {
  if (target instanceof HTMLElement) return target
  if (typeof target === 'string') {
    const found = document.querySelector<HTMLElement>(target)
    if (!found) throw new Error(`Нет элемента по селектору: ${target}`)
    return found
  }
  throw new Error('Нечего нажимать: элемент не найден')
}

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
   * The comparison is exact on the trimmed text, so «Отклонить» does not quietly
   * match a button that says «Отклонить всё» — answering the wrong question is
   * exactly the mistake a consent test exists to catch.
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
