# Component test harness

A small internal library for testing React components: it mounts one into a real
DOM (jsdom) and lets a test drive it the way a person would — press a button,
type into a field, read what the screen says.

```tsx
/** @vitest-environment jsdom */
import { render, screen } from '../harness'
import { ApprovalPanel } from '../../src/components/ApprovalPanel'

it('разрешает и отклоняет по нажатию', () => {
  const onApprove = vi.fn()
  render(<ApprovalPanel approval={approval} files={files} onApprove={onApprove} onReject={() => {}} />)

  screen.click(screen.button('Разрешить'))

  expect(onApprove).toHaveBeenCalledTimes(1)
})
```

## Why this and not a testing library

It is hand written on top of `react-dom/client`, `act` and `querySelector` — all
of which already ship as dependencies of the app and of the preview tests. So
nothing new is installed, nothing enters the lockfile, and nothing here can go
stale behind a version bump.

What it gives up is a matcher vocabulary. In exchange a test reads the same
selectors the interface renders:

```tsx
screen.click('.turn-rewind')
expect(screen.text('.confirm-question')).toContain('Вернуться')
```

A class name renamed in the component breaks the test, and that is the point: the
harness does not abstract away the thing the test is asserting about.

## Layout

| File | Owns |
| --- | --- |
| [index.ts](index.ts) | the entry point — import from `'../harness'`, not from the files below |
| [render.tsx](render.tsx) | mounting a component, the environment setup, the after-each cleanup |
| [screen.ts](screen.ts) | querying the document and pressing what it finds |
| [render.test.tsx](render.test.tsx), [screen.test.tsx](screen.test.tsx) | self-tests that hold the two halves to their contracts |

## `render(ui)`

Mounts a component into a fresh `<div>` appended to `document.body` and returns:

| Member | Meaning |
| --- | --- |
| `container` | the element the component was mounted into |
| `rerender(next)` | renders a new tree into the **same** container, keeping state |
| `unmount()` | unmounts the root and removes the container |

```tsx
const { rerender } = render(<Counter label="раз" />)
screen.click(screen.button('Плюс'))
rerender(<Counter label="два" />) // count stays at 1
```

## `screen`

Every query is **document-wide**, not scoped to the container — several
components in this app render a portal or a sibling, and a test asserts about
what a person can see and click.

| Call | Returns |
| --- | --- |
| `screen.all(selector)` | every match, in document order |
| `screen.find(selector)` | the first match, or `null` |
| `screen.need(selector)` | the first match; **throws**, naming the selector, when there is none |
| `screen.count(selector)` | how many match |
| `screen.text(selector)` | the trimmed text of the first match, or `null` |
| `screen.texts(selector)` | the trimmed text of every match |
| `screen.button(label)` | the button whose trimmed text is **exactly** `label`; throws when there is none |
| `screen.click(target)` | presses a selector, an element (`need`/`find`) or a node, inside `act` |
| `screen.type(target, value)` | sets an input's value the way a person would, then fires `input` |
| `screen.settle()` | `await`s until pending effects and microtasks have landed |

Types `Rendered` and `Target` are exported for helpers that pass these around.

## The contracts the tests rely on

These are the properties that make the rest of the suite trustworthy, and each is
pinned by a test in this folder:

1. **It resolves what you asked for, or it throws.** `need` and `button` never
   return `null` and never accept a near miss, so an interaction is never quietly
   skipped, and `button('Отклонить')` will not hand back a button labelled
   `Отклонить всё`. Answering the wrong question is the bug a consent test exists
   to catch.
2. **Assertions are safe immediately after `render`.** Effects have run by the
   time `render` returns, so a test does not have to `await` before checking
   anything. `await screen.settle()` is only for state that arrives over a
   promise.
3. **`type` reaches React's state, not just the DOM.** Assigning `element.value`
   directly is invisible to React and would leave a controlled input empty while
   the DOM read back correctly; going through the prototype setter is what makes
   the component actually update.
4. **Queries are document-wide.** A portal or a sibling outside the container is
   still reachable.
5. **Nothing leaks between tests.** After every test the harness unmounts
   whatever is still mounted and clears `document.body`, so one test cannot
   inherit a mounted tree, a timer or a listener from the previous one.
6. **jsdom's gaps are filled once.** `IS_REACT_ACT_ENVIRONMENT` is set (without
   it React defers updates) and `scrollIntoView` is stubbed (jsdom has no layout),
   so a component that scrolls does not crash on mount.

## Writing a new component test

1. Put the file in `tests/components/` as `<component>.test.tsx`.
2. Start it with the jsdom header — the shared config runs everything else in
   Node:

   ```tsx
   /** @vitest-environment jsdom */
   ```

3. Import the harness entry (`'../harness'`), the component, and `vi` as needed.
4. Assert about what a person sees and clicks — labels, class names the component
   renders, `aria-label`s. Prefer `screen.button('Разрешить')` over
   `container.querySelector(...)`: it fails when the label changes, which is the
   regression you want to hear about.
5. Build the props as small local fixtures at the top of the file, the way
   [approval-panel.test.tsx](../components/approval-panel.test.tsx) does.

Run it the usual way; the harness self-tests come along with `pnpm test`:

```bash
pnpm test                                  # everything, harness self-tests included
npx vitest run tests/components            # just the component tests
npx vitest run tests/harness               # just the harness self-tests
```

## When you change the harness

Add or update a self-test in this folder in the same change. These are the tests
that fail open: if the harness silently stops being strict, the component tests
keep passing while proving less, and nothing else in CI would notice.

The cheap check that a self-test is real is to break the harness on purpose and
confirm the test goes red — for example make `screen.button` match with
`includes` instead of equality, or make `screen.type` assign `element.value`
directly. Both should fail exactly one test. An assertion that passes either way
is decoration.
