import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock window/localStorage for Node test env
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

if (typeof globalThis.localStorage === 'undefined') {
  ;(globalThis as any).localStorage = localStorageMock
}
if (typeof globalThis.window === 'undefined') {
  ;(globalThis as any).window = { location: { origin: '' } }
}

// We must import after localStorage is polyfilled
const { authenticatedFetch } = await import('../config/api')

describe('canonical telemetry auth regression', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    localStorageMock.clear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('1) aggregated canonical request sends authenticated dashboard header', async () => {
    localStorageMock.setItem('api_token', 'test-bearer-123')
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    globalThis.fetch = fetchSpy as any

    await authenticatedFetch('http://localhost:8010/api/telemetry/canonical?from=2000-01-01&to=2026-08-07&format=aggregated&period=week')

    const [, options] = fetchSpy.mock.calls[0]
    expect(options.headers['Authorization']).toBe('Bearer test-bearer-123')
  })

  it('2) developer-filtered canonical request preserves user_id AND auth', async () => {
    localStorageMock.setItem('api_token', 'test-bearer-456')
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    globalThis.fetch = fetchSpy as any

    const url = 'http://localhost:8010/api/telemetry/canonical?from=2000-01-01&to=2026-08-07&format=aggregated&period=week&user_id=invite%3A14'
    await authenticatedFetch(url)

    const [calledUrl, options] = fetchSpy.mock.calls[0]
    expect(calledUrl).toContain('user_id=invite%3A14')
    expect(options.headers['Authorization']).toBe('Bearer test-bearer-456')
  })

  it('3) sessions-format canonical request sends auth', async () => {
    localStorageMock.setItem('api_token', 'test-bearer-789')
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    globalThis.fetch = fetchSpy as any

    await authenticatedFetch('http://localhost:8010/api/telemetry/canonical?from=2020-01-01&to=2026-08-07&format=sessions&per_page=200')

    const [, options] = fetchSpy.mock.calls[0]
    expect(options.headers['Authorization']).toBe('Bearer test-bearer-789')
  })

  it('4) missing dashboard credential does not silently become public access', async () => {
    // No token set — Authorization header must be absent, not fabricated
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))
    globalThis.fetch = fetchSpy as any

    // P0-G: authenticatedFetch now throws AuthError on 401 instead of returning the response
    await expect(
      authenticatedFetch('http://localhost:8010/api/telemetry/canonical?format=aggregated')
    ).rejects.toThrow('API error 401')

    const [, options] = fetchSpy.mock.calls[0]
    expect(options.headers['Authorization']).toBeUndefined()
    // The 401 from the backend is the truthful behavior — now surfaced as AuthError
  })

  it('5) no token value is exposed to logging', async () => {
    localStorageMock.setItem('api_token', 'secret-do-not-log')
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    globalThis.fetch = fetchSpy as any

    await authenticatedFetch('http://localhost:8010/api/telemetry/canonical?format=aggregated')

    const allLogs = [
      ...consoleSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
      ...infoSpy.mock.calls.flat(),
      ...debugSpy.mock.calls.flat(),
    ]
    for (const log of allLogs) {
      expect(String(log)).not.toContain('secret-do-not-log')
    }
  })
})
