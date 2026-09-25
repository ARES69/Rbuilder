import { describe, expect, it } from 'vitest'
import {
  buildRequestHeaders,
  buildResponseHeaders,
  isPrivateAddress,
  parseProxyRequest,
} from '../server/api-proxy'

describe('private address guard', () => {
  it('refuses loopback, private and link-local ranges', () => {
    const blocked = [
      'localhost',
      'api.localhost',
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      'host.local',
      'service.internal',
      'box.lan',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]
    for (const host of blocked) {
      expect(isPrivateAddress(host), host).toBe(true)
    }
  })

  it('allows real public hosts, including Russian cloud services', () => {
    const allowed = [
      'company.bitrix24.ru',
      'api.telegram.org',
      'api.yandex.ru',
      'api.tinkoff.ru',
      '5.101.152.11',
      '8.8.8.8',
    ]
    for (const host of allowed) {
      expect(isPrivateAddress(host), host).toBe(false)
    }
  })

  it('refuses malformed IPv4 literals rather than guessing', () => {
    expect(isPrivateAddress('999.1.1.1')).toBe(true)
    expect(isPrivateAddress('1.2.3.4.5')).toBe(true)
    expect(isPrivateAddress('1.2.3')).toBe(true)
    expect(isPrivateAddress('a.b.c.d')).toBe(false) // Not an IP literal at all.
  })

  it('treats a bare hostname with no dot as local', () => {
    expect(isPrivateAddress('intranet')).toBe(true)
  })
})

describe('request headers', () => {
  it('strips hop-by-hop and identity headers', () => {
    const headers = buildRequestHeaders(
      {
        Host: 'evil.example',
        'Content-Length': '3',
        Authorization: 'Bearer key',
        Origin: 'null',
        'Accept-Encoding': 'gzip',
        'X-Custom': 'yes',
      },
      0,
    )

    expect(headers).toEqual({ authorization: 'Bearer key', 'x-custom': 'yes' })
  })

  it('defaults the content type for a body without one', () => {
    expect(buildRequestHeaders({}, 42)['content-type']).toBe('application/json')
    expect(buildRequestHeaders({ 'content-type': 'text/xml' }, 42)['content-type']).toBe('text/xml')
  })
})

describe('response headers', () => {
  it('drops framing headers and upstream CORS, keeps the useful ones', () => {
    const upstream = new Headers([
      ['content-type', 'application/json'],
      ['content-length', '999'],
      ['content-encoding', 'br'],
      ['access-control-allow-origin', 'https://elsewhere.example'],
      ['x-request-id', 'abc'],
      ['set-cookie', 'session=x'],
    ])

    expect(buildResponseHeaders(upstream)).toEqual({
      'content-type': 'application/json',
      'x-request-id': 'abc',
    })
  })
})

describe('envelope parsing', () => {
  it('parses a full envelope and normalizes the method', () => {
    const request = parseProxyRequest({
      url: 'https://company.bitrix24.ru/rest/crm.lead.add.json',
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: '{"fields":{"NAME":"Ivan"}}',
      timeoutMs: 5000,
    })

    expect(request.method).toBe('POST')
    expect(request.url.hostname).toBe('company.bitrix24.ru')
    expect(request.timeoutMs).toBe(5000)
    expect(request.body).toBe('{"fields":{"NAME":"Ivan"}}')
  })

  it('drops the body for GET and HEAD', () => {
    expect(parseProxyRequest({ url: 'https://api.example.com', method: 'GET', body: 'x' }).body).toBeUndefined()
    expect(parseProxyRequest({ url: 'https://api.example.com', method: 'HEAD', body: 'x' }).body).toBeUndefined()
  })

  it('rejects non-http protocols and junk', () => {
    expect(() => parseProxyRequest({ url: 'ftp://example.com' })).toThrow(/http/)
    expect(() => parseProxyRequest({ url: 'file:///etc/passwd' })).toThrow(/http/)
    expect(() => parseProxyRequest({ url: 'not a url' })).toThrow(/not a valid URL/)
    expect(() => parseProxyRequest({ url: 42 })).toThrow(/Expected/)
    expect(() => parseProxyRequest({ method: 'TRACE; HACK', url: 'https://x.example' })).toThrow(/valid HTTP method/)
  })
})
