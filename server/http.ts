/**
 * Shared HTTP plumbing for the API routes.
 *
 * Both entry points use these helpers — the Vite dev-server plugin and the
 * standalone server in `server/index.ts` — so a route cannot behave differently
 * in `pnpm dev` and in the packaged application.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Bodies are small by design: chat turns, command files, one request envelope. */
export const JSON_BODY_LIMIT = 8 * 1024 * 1024

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/** One newline-delimited JSON event, the framing both /api/chat and /api/exec use. */
export function writeLine(res: ServerResponse, payload: unknown): void {
  if (res.writableEnded) return
  res.write(`${JSON.stringify(payload)}\n`)
}

export function readBody(req: IncomingMessage, limit = JSON_BODY_LIMIT): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('The request body is too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (error) => reject(error))
  })
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * CORS for the API routes.
 *
 * The desktop front end is served from a custom origin (`http://tauri.localhost`
 * and friends) while the API listens on `127.0.0.1:<random port>` — a cross-origin
 * pair, so the WebView demands CORS headers and a preflight before POSTing JSON.
 * The browser build is same-origin and simply never notices them. No credentials
 * are involved (the API key travels in the body), so `*` is safe.
 *
 * Returns true when the request was an answered preflight and is done.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method !== 'OPTIONS') return false

  const requested = req.headers['access-control-request-headers']
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    typeof requested === 'string' && requested ? requested : 'Content-Type',
  )
  res.setHeader('Access-Control-Max-Age', '600')
  res.statusCode = 204
  res.end()
  return true
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
