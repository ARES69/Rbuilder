/**
 * The standalone RBUILDER server: one `node:http` process that serves the built
 * front end from `dist/` and mounts the same API the dev server exposes.
 *
 * `pnpm start` runs it locally; the desktop build ships it as a sidebar process
 * started by the Tauri shell, which is why it must not depend on Vite or on
 * anything that is only available during a dev-server run.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { createApiHandlers, type ApiOptions } from './api'
import { sendJson } from './http'

export type RbuilderServerOptions = ApiOptions & {
  env: Record<string, string | undefined>
  /** Directory with the built front end (defaults to `dist` next to the workspace). */
  staticDir?: string
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
}

/** Paths served by routes rather than by the static handler. */
const API_ROUTES = ['/api/chat', '/api/exec', '/api/provider-test', '/api/proxy', '/api/health'] as const

export function createRbuilderServer(options: RbuilderServerOptions): Server {
  const handlers = createApiHandlers(options.env, options)
  const staticDir = path.resolve(options.staticDir ?? path.join(options.env.RBUILDER_WORKSPACE_ROOT?.trim() || process.cwd(), 'dist'))

  return createServer((req, res) => {
    void handle(req, res, { handlers, staticDir, root: handlers.workspaceRoot })
  })
}

type Handler = Awaited<ReturnType<typeof createApiHandlers>>

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  context: { handlers: Handler; staticDir: string; root: string },
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname.replace(/\/+$/, '') || '/'

  switch (pathname) {
    case '/api/chat':
      await context.handlers.chat(req, res)
      return
    case '/api/exec':
      await context.handlers.exec(req, res)
      return
    case '/api/provider-test':
      await context.handlers.providerTest(req, res)
      return
    case '/api/proxy':
      await context.handlers.proxy(req, res)
      return
    case '/api/health':
      context.handlers.health(req, res)
      return
    default:
      break
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { message: `Unknown API route ${pathname}. Known routes: ${API_ROUTES.join(', ')}.` })
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { message: 'Only GET and HEAD are served here.' })
    return
  }

  await serveStatic(req, res, context.staticDir, url.pathname)
}

/**
 * Serves the built front end. Unknown paths fall back to `index.html` when they
 * look like routes rather than missing files, because the app is a single page.
 */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string,
  rawPath: string,
): Promise<void> {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    sendJson(res, 400, { message: 'Malformed path.' })
    return
  }

  const relative = decoded.replace(/^\/+/, '')
  const candidate = path.resolve(staticDir, relative)
  const insideStatic = candidate === staticDir || candidate.startsWith(staticDir + path.sep)

  // `..` and absolute paths never leave the build directory.
  if (!insideStatic) {
    sendJson(res, 403, { message: 'That path is outside the built application.' })
    return
  }

  // A path without a dot is a route, not a file: the app is a single page, so it
  // falls back to index.html. Anything else must exist.
  const direct = await statFile(candidate)
  const file = direct ?? (decoded.includes('.') ? null : await statFile(path.join(staticDir, 'index.html')))
  if (!file) {
    sendJson(res, 404, { message: 'Not found. Run `pnpm build` to produce the front end in dist/.' })
    return
  }

  const extension = path.extname(file).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', MIME_TYPES[extension] ?? 'application/octet-stream')
  res.setHeader(
    'Cache-Control',
    file.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  )

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  const stream = createReadStream(file)
  stream.on('error', () => {
    if (!res.writableEnded) res.destroy()
  })
  stream.pipe(res)
}

async function statFile(candidate: string): Promise<string | null> {
  try {
    const info = await stat(candidate)
    return info.isFile() ? candidate : null
  } catch {
    return null
  }
}
