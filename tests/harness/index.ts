/**
 * The component-test harness: one import for mounting a component and driving it.
 *
 * ```tsx
 * import { render, screen } from '../harness'
 *
 * render(<MessageList messages={messages} examples={[]} onExample={() => {}} />)
 * screen.click('.turn-rewind')
 * expect(screen.text('.confirm-question')).toContain('Вернуться')
 * ```
 *
 * This is the entry point component tests should import, and it is a module of
 * its own for one reason: the file layout behind it is an implementation detail.
 * `render.tsx` owns the mounting and the after-each cleanup, `screen.ts` owns
 * querying and pressing. A test that imports the entry keeps working if that
 * boundary moves.
 *
 * Both halves carry the same contract, and the self-tests in this folder are
 * what hold them to it:
 *
 *   - the harness resolves what a test asks for or throws — it never skips an
 *     interaction and never returns a plausible-looking wrong node;
 *   - it queries the whole document, so a portal or a sibling is reachable;
 *   - it cleans up after every test, so one test cannot leak a mounted tree, a
 *     timer or a listener into the next.
 *
 * See `README.md` in this folder for the full API.
 */

export { render } from './render'
export type { Rendered } from './render'
export { screen } from './screen'
export type { Target } from './screen'
