/**
 * The visual suite runs in its own config, separate from `pnpm test`.
 *
 * It needs a real Chromium and takes seconds per shot, so folding it into the
 * unit run would slow the loop everyone actually uses. The unit config below
 * therefore does not include `tests/visual`.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/visual/**/*.visual.ts'],
    // One worker: the fixtures share a single browser page, and screenshots of
    // the same page taken in parallel would race each other.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})