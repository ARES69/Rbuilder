import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRbuilderServer } from '../server/server'
import { shellCandidates } from '../server/workspace'

/**
 * The production server is what the packaged application actually runs, so it is
 * exercised end to end here: static files, the SPA fallback, the traversal guard
 * and each API route.
 */

let server: Server
let base: string
let fixture: string

beforeAll(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), 'rbuilder-server-'))
  await mkdir(path.join(fixture, 'assets'), { recursive: true })
  await writeFile(path.join(fixture, 'index.html'), '<!doctype html><title>RBUILDER</title>', 'utf8')
  await writeFile(path.join(fixture, 'assets', 'app-abc123.js'), 'console.log("built")', 'utf8')

  server = createRbuilderServer({
    env: {},
    root: path.join(fixture, 'workspace'),
    staticDir: fixture,
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(fixture, { recursive: true, force: true })
})

describe('production server', () => {
  it('answers the health probe the desktop shell waits for', async () => {
    const response = await fetch(`${base}/api/health`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; service: string; workspaceRoot: string }
    expect(body.ok).toBe(true)
    expect(body.service).toBe('rbuilder')
    expect(body.workspaceRoot).toBe(path.join(fixture, 'workspace'))
  })

  it('reports an unconfigured model without failing', async () => {
    const response = await fetch(`${base}/api/chat`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ configured: false })
  })

  it('answers CORS preflights for every API route', async () => {
    for (const route of ['/api/chat', '/api/provider-test', '/api/exec', '/api/proxy', '/api/health']) {
      const response = await fetch(`${base}${route}`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://tauri.localhost',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      })
      expect(response.status, route).toBe(204)
      expect(response.headers.get('access-control-allow-origin'), route).toBe('*')
      expect(response.headers.get('access-control-allow-headers'), route).toContain('content-type')
    }
  })

  it('stamps API responses with the CORS origin header', async () => {
    const response = await fetch(`${base}/api/health`, { headers: { Origin: 'http://tauri.localhost' } })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('serves the built front end and falls back to index.html for routes', async () => {
    const root = await fetch(`${base}/`)
    expect(root.status).toBe(200)
    expect(root.headers.get('content-type')).toContain('text/html')
    expect(await root.text()).toContain('RBUILDER')

    const route = await fetch(`${base}/projects/42`)
    expect(route.status).toBe(200)
    expect(await route.text()).toContain('RBUILDER')
  })

  it('caches hashed assets aggressively and misses honestly', async () => {
    const asset = await fetch(`${base}/assets/app-abc123.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toContain('immutable')

    const missing = await fetch(`${base}/assets/gone.js`)
    expect(missing.status).toBe(404)
  })

  it('refuses to read outside the build directory', async () => {
    // %2f survives URL normalisation, so the decoded path really does climb out.
    const response = await fetch(`${base}/..%2f..%2fpackage.json`)
    expect(response.status).toBe(403)
  })

  it('names the known routes when an API path does not exist', async () => {
    const response = await fetch(`${base}/api/nope`)
    expect(response.status).toBe(404)
    const body = (await response.json()) as { message: string }
    expect(body.message).toContain('/api/chat')
  })

  it('rejects a chat turn with no usable messages', async () => {
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turns: [] }),
    })
    expect(response.status).toBe(400)
  })

  it('runs a terminal command in the scratch workspace', async () => {
    const response = await fetch(`${base}/api/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo rbuilder-terminal-ok', files: [] }),
    })
    expect(response.status).toBe(200)
    const events = (await response.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; text?: string })
    const stdout = events.filter((event) => event.type === 'stdout').map((event) => event.text).join('')
    expect(stdout).toContain('rbuilder-terminal-ok')
    expect(events.at(-1)?.type).toBe('exit')
  })
})

describe('terminal shells', () => {
  it('prefers a POSIX shell and keeps a Windows fallback', () => {
    const candidates = shellCandidates('echo hi')
    expect(candidates[0]).toEqual({ file: 'bash', args: ['-c', 'echo hi'] })

    if (process.platform === 'win32') {
      expect(candidates.length).toBeGreaterThan(1)
      expect(candidates.some((entry) => /cmd\.exe$/i.test(entry.file))).toBe(true)
    } else {
      expect(candidates).toHaveLength(1)
    }
  })

  it('honours an explicit shell override', () => {
    process.env.RBUILDER_SHELL = 'C:/Program Files/Git/bin/bash.exe'
    try {
      expect(shellCandidates('echo hi')[0]?.file).toBe('C:/Program Files/Git/bin/bash.exe')
    } finally {
      delete process.env.RBUILDER_SHELL
    }
  })
})
