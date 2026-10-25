/**
 * Mounting a React component into a real DOM, and cleaning it up afterwards.
 *
 * The counterpart to `screen.ts`, and the reason this package exists: every
 * component test in this project runs through here rather than through a testing
 * library. It is a hand written layer over `react-dom/client`, `act` and
 * `querySelector` — all of which already ship as dependencies of the app and of
 * the preview tests. Nothing new is installed, nothing enters the lockfile, and
 * nothing can go stale behind a version bump.
 *
 * What it gives up is a testing library's matcher vocabulary. In exchange a test
 * reads the same selectors the interface renders — `.turn-rewind`,
 * `.changes-undo`, `[aria-label="Требуется подтверждение"]`. A class name renamed
 * in the component breaks the test, which is the point: the harness does not
 * abstract away the thing the test is asserting about.
 *
 * A test file must ask for the DOM with a `@vitest-environment jsdom` header at
 * the top, because the shared config runs everything else in Node.
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
