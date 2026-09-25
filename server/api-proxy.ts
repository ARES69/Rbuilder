/**
 * POST /api/proxy — server-side passthrough for external APIs: Bitrix24,
 * amoCRM, Yandex, Tinkoff, or any other REST service.
 *
 * The preview runs on a sandboxed opaque origin, so a page cannot read a
 * cross-origin response: every third-party call would die on CORS. This route
 * performs the request from the dev server instead and answers with permissive
 * CORS headers, which turns "call any API" into a plain same-origin call for
 * the generated app.
 *
 * The envelope keeps the call explicit rather than a blanket redirect:
 *
 *   { url, method?, headers?, body?, timeoutMs? }
 *
 * The upstream body is returned verbatim with its original status, so the app
 * works with JSON APIs, XML, and webhook payloads alike. Requests to private
 * network addresses are refused unless PROXY_ALLOW_PRIVATE is set, so a
 * generated app cannot reach into the machine it is built on.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { lookup } from 'node:dns/promises'
import type { Plugin } from 'vite'
import { z } from 'zod'

const MAX_BODY_BYTES = 10 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 60_000

const proxyRequestSchema = z.object({
  url: z.string().min(1).max(4000),
  method: z.string().min(1).max(20).default('GET'),
  headers: z.record(z.string(), z.string().max(8000)).optional(),
  body: z.string().max(MAX_BODY_BYTES).optional(),
  timeoutMs: z.number().int().min(100).max(MAX_TIMEOUT_MS).optional(),
})

export type ProxyRequest = {
  url: URL
  method: string
  headers: Record<string, string>
  body?: string
  timeoutMs: number
}

/** Env keys that never belong on a proxied request. */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
  'expect',
  'origin',
  'referer',
  'accept-encoding',
])

/** Response headers that describe the upstream hop, not the content. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'set-cookie',
  'strict-transport-security',
])

/**
 * Hostnames that must never be proxied: loopback, the link-local range, and the
 * private ranges every generated app has no business touching. Also catches
 * suffix-style local names, since DNS for `.local` and friends resolves inside
 * the machine's own network.
 */
export function isPrivateAddress(address: string): boolean {
  const host = normalizeHost(address)

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true

  if (host.includes(':')) {
    // IPv6: loopback, link-local, unique-local, and IPv4-mapped forms.
    const bare = host.replace(/^\[|\]$/g, '')
    if (bare === '::1' || bare === '::') return true
    if (/^f[cd]/i.test(bare)) return true
    if (/^fe[89ab]/i.test(bare)) return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare)
    if (mapped) return isPrivateIpv4(mapped[1]!)
    return false
  }

  if (!host.includes('.')) return true
  // Only an all-numeric host is an IPv4 literal; a name like
  // company.bitrix24.ru is not a malformed address, it is a hostname.
  if (!/^[\d.]+$/.test(host)) return false
  return isPrivateIpv4(host)
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true // Malformed: refuse rather than guess.
  }
  const [a, b] = parts as [number, number, number, number]
  if (a === 127 || a === 10 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a >= 224) return true
  return false
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

/** Lowercases and filters the envelope's headers into what fetch may send. */
export function buildRequestHeaders(
  envelopeHeaders: Record<string, string> | undefined,
  bodyLength: number,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(envelopeHeaders ?? {})) {
    const name = key.trim().toLowerCase()
    if (!name || STRIPPED_REQUEST_HEADERS.has(name)) continue
    headers[name] = value
  }
  if (bodyLength > 0 && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  return headers
}

/** Copies only the response headers the browser should see. */
export function buildResponseHeaders(upstream: Headers): Record<string, string> {
  const headers: Record<string, string> = {}
  upstream.forEach((value, key) => {
    const name = key.toLowerCase()
    if (STRIPPED_RESPONSE_HEADERS.has(name)) return
    if (name === 'access-control-allow-origin' || name.startsWith('access-control-allow-')) return
    headers[name] = value
  })
  return headers
}

/** Validates the envelope; throws an Error with a user-facing message. */
export function parseProxyRequest(raw: unknown): ProxyRequest {
  const parsed = proxyRequestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error('Expected { url, method?, headers?, body?, timeoutMs? } as a JSON body.')
  }

  let url: URL
  try {
    url = new URL(parsed.data.url)
  } catch {
    throw new Error(`"${parsed.data.url}" is not a valid URL.`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http and https URLs can be proxied.')
  }

  const method = parsed.data.method.trim().toUpperCase()
  if (!/^[A-Z]+$/.test(method)) throw new Error(`"${method}" is not a valid HTTP method.`)

  const headers = buildRequestHeaders(parsed.data.headers, parsed.data.body?.length ?? 0)
  const body = method === 'GET' || method === 'HEAD' ? undefined : parsed.data.body

  return {
    url,
    method,
    headers,
    body,
    timeoutMs: parsed.data.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
}

export function apiProxy(env: Record<string, string | undefined>): Plugin {
  const allowPrivate = /^(1|true|yes)$/i.test(env.PROXY_ALLOW_PRIVATE?.trim() ?? '')

  return {
    name: 'freebuff-api-proxy',
    configureServer(server) {
      server.middlewares.use('/api/proxy', (req, res) => {
        void handleProxy(req, res, allowPrivate)
      })
    },
  }
}

/* ------------------------------------------------------------------ */
/* Route                                                              */
/* ------------------------------------------------------------------ */

export async function handleProxy(
  req: IncomingMessage,
  res: ServerResponse,
  allowPrivate: boolean,
): Promise<void> {
  applyCors(res, req)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { message: 'Use POST /api/proxy with a JSON envelope.' })
    return
  }

  let raw: unknown
  try {
    const body = await readBody(req)
    raw = JSON.parse(body || '{}')
  } catch (error) {
    const message = error instanceof Error && error.message.includes('too large')
      ? 'The proxy request is too large.'
      : 'Expected a JSON body.'
    sendJson(res, 413, { message })
    return
  }

  let request: ProxyRequest
  try {
    request = parseProxyRequest(raw)
  } catch (error) {
    sendJson(res, 400, { message: error instanceof Error ? error.message : 'Invalid request.' })
    return
  }

  if (!allowPrivate) {
    const blocked = await assertPublicHost(request.url)
    if (blocked) {
      sendJson(res, 403, {
        message: `Refusing to proxy "${request.url.hostname}": private and local network addresses are not allowed.`,
      })
      return
    }
  }

  let upstream: Response
  try {
    upstream = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow',
      signal: AbortSignal.timeout(request.timeoutMs),
    })
  } catch (error) {
    const timedOut = error instanceof Error && /timeout|abort/i.test(error.message)
    sendJson(res, 502, {
      message: timedOut
        ? `The upstream did not answer within ${Math.round(request.timeoutMs / 1000)}s.`
        : `The upstream could not be reached: ${error instanceof Error ? error.message : 'network error'}`,
    })
    return
  }

  const payload = Buffer.from(await upstream.arrayBuffer())
  if (payload.byteLength > MAX_BODY_BYTES) {
    sendJson(res, 502, { message: 'The upstream response is too large to proxy (limit 10 MB).' })
    return
  }

  res.statusCode = upstream.status
  for (const [name, value] of Object.entries(buildResponseHeaders(upstream.headers))) {
    res.setHeader(name, value)
  }
  res.setHeader('Content-Length', String(payload.byteLength))
  res.end(payload)
}

/**
 * Resolves the hostname and refuses anything that points into a private
 * network. This also closes the DNS-rebinding hole where a public-looking name
 * resolves to 127.0.0.1.
 */
async function assertPublicHost(url: URL): Promise<string | null> {
  const hostname = normalizeHost(url.hostname.replace(/^\[|\]$/g, ''))

  if (isPrivateAddress(hostname)) return hostname

  try {
    const addresses = await lookup(hostname, { all: true })
    for (const entry of addresses) {
      if (isPrivateAddress(entry.address)) return `${hostname} -> ${entry.address}`
    }
  } catch {
    return hostname // Unresolvable: let the fetch report the real failure.
  }

  return null
}

function applyCors(res: ServerResponse, req: IncomingMessage): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const requested = req.headers['access-control-request-headers']
  res.setHeader(
    'Access-Control-Allow-Headers',
    typeof requested === 'string' && requested ? requested : '*',
  )
  const requestedMethod = req.headers['access-control-request-method']
  res.setHeader(
    'Access-Control-Allow-Methods',
    typeof requestedMethod === 'string' && requestedMethod ? requestedMethod : 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  )
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('The request body is too large.'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
