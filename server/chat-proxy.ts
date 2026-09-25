/**
 * Vite dev-server plugin: mounts the RBUILDER API on the dev server so `pnpm dev`
 * behaves exactly like the packaged application.
 *
 * The routes themselves live in `server/api.ts` (shared with `pnpm start` and with
 * the desktop sidebar process); this file only wires them into the dev server.
 */

import type { Plugin } from 'vite'
import { createApiHandlers } from './api'

export function chatProxy(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'freebuff-chat-proxy',
    configureServer(server) {
      const handlers = createApiHandlers(env)

      server.middlewares.use('/api/chat', (req, res) => {
        void handlers.chat(req, res)
      })

      server.middlewares.use('/api/exec', (req, res) => {
        void handlers.exec(req, res)
      })

      server.middlewares.use('/api/provider-test', (req, res) => {
        void handlers.providerTest(req, res)
      })

      server.middlewares.use('/api/health', (req, res) => {
        handlers.health(req, res)
      })
    },
  }
}
