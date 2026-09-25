/**
 * `pnpm start` — the production entry point.
 *
 * Serves the built front end from `dist/` and the API from the same process, so
 * the application works exactly as it does under `pnpm dev` without a dev server.
 * The desktop build runs the bundled output of this file as its sidebar process.
 *
 *   PORT                    port to listen on (default 5185)
 *   HOST                    interface to bind (default 127.0.0.1 — a local tool)
 *   RBUILDER_STATIC_DIR     directory with the built front end (default ./dist)
 *   RBUILDER_WORKSPACE_ROOT directory that holds the terminal scratch project
 *   RBUILDER_SHELL          shell used by the terminal (default: bash, then the platform shell)
 *   OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL   fallback provider
 *   PROXY_ALLOW_PRIVATE=1   let /api/proxy reach the local network
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRbuilderServer } from './server'

const cwd = process.cwd()
loadEnvFiles(cwd)

const port = Number(process.env.PORT ?? 5185)
const host = process.env.HOST?.trim() || '127.0.0.1'
const staticDir = path.resolve(cwd, process.env.RBUILDER_STATIC_DIR?.trim() || 'dist')

const server = createRbuilderServer({ env: process.env, staticDir })

server.listen(port, host, () => {
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  console.log(`RBUILDER is served on http://${host}:${actualPort}`)
  console.log(`  front end   ${staticDir}`)
  console.log(`  workspace   ${process.env.RBUILDER_WORKSPACE_ROOT?.trim() || cwd}`)
  console.log(
    process.env.OPENAI_API_KEY?.trim()
      ? '  provider    configured from the environment'
      : '  provider    not configured — pick one in Settings (Ollama and LM Studio need no key)',
  )
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    // A streamed chat turn can hold the socket open; do not wait for it forever.
    setTimeout(() => process.exit(0), 2_000).unref()
  })
}

/**
 * Minimal .env loader. Reading `vite`'s own loader would pull the whole bundler
 * into the packaged sidebar process, and the desktop shell passes these values
 * directly anyway.
 */
function loadEnvFiles(root: string): void {
  for (const name of ['.env.local', '.env']) {
    let raw: string
    try {
      raw = readFileSync(path.join(root, name), 'utf8')
    } catch {
      continue
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator <= 0) continue
      const key = trimmed.slice(0, separator).trim()
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
      if (key && process.env[key] === undefined) process.env[key] = value
    }
  }
}
