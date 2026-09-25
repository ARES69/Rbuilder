import { defineConfig } from 'vite'

/**
 * Builds the standalone server (`server/index.ts`) into `dist-server/index.js`,
 * bundled with every local import but leaving Node built-ins external.
 *
 * Two callers depend on it:
 *   - `pnpm start` runs the bundle with plain Node, no dev server involved;
 *   - the desktop build compiles the same bundle into the sidebar executable.
 */
export default defineConfig({
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: { entryFileNames: 'index.js' },
    },
  },
  ssr: {
    // Everything the server needs is either a Node built-in or local code.
    noExternal: true,
  },
})
