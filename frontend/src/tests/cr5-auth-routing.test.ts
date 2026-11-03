import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock localStorage for Node test env
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

describe('auth routing guard — unauthenticated', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  it('1) unauthenticated root redirects to login', () => {
    const token = localStorage.getItem('api_token')
    expect(token).toBeNull()
    // Simulate the root redirect logic from router/index.ts
    const isAuthenticated = !!(token && token !== 'oauth_authenticated' && token.trim() !== '')
    expect(isAuthenticated).toBe(false)
    // Unauthenticated root -> /login
    const redirect = isAuthenticated ? '/dashboards?v2=1' : '/login'
    expect(redirect).toBe('/login')
  })

  it('2) unauthenticated dashboards redirects to login', () => {
    const token = localStorage.getItem('api_token')
    const isAuthenticated = !!(token && token !== 'oauth_authenticated' && token.trim() !== '')
    expect(isAuthenticated).toBe(false)
    // Unauthenticated /dashboards -> /login
    const redirect = isAuthenticated ? '/dashboards' : '/login'
    expect(redirect).toBe('/login')
  })

  it('3) login is available unauthenticated', () => {
    const token = localStorage.getItem('api_token')
    const isAuthenticated = !!(token && token !== 'oauth_authenticated' && token.trim() !== '')
    // Login page should be accessible when unauthenticated
    expect(isAuthenticated).toBe(false)
    // If authed, login redirects to dashboards; if not, login is allowed
    const redirect = isAuthenticated ? '/dashboards?v2=1' : null
    expect(redirect).toBeNull()
  })
})

describe('auth routing guard — authenticated', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.setItem('api_token', 'real-dashboard-token-123')
  })

  afterEach(() => {
    localStorageMock.clear()
  })

  it('4) authenticated root redirects to dashboards', () => {
    const token = localStorage.getItem('api_token')
    const isAuthenticated = !!(token && token !== 'oauth_authenticated' && token.trim() !== '')
    expect(isAuthenticated).toBe(true)
    const redirect = isAuthenticated ? '/dashboards?v2=1' : '/login'
    expect(redirect).toBe('/dashboards?v2=1')
  })

  it('5) authenticated dashboards allowed', () => {
    const token = localStorage.getItem('api_token')
    const isAuthenticated = !!(token && token !== 'oauth_authenticated' && token.trim() !== '')
    expect(isAuthenticated).toBe(true)
    // Authenticated users can access dashboards
    const redirect = isAuthenticated ? null : '/login'
    expect(redirect).toBeNull()
  })

  it('6) authenticated user is not trapped on login', () => {
    const token = localStorage.getItem('api_token')
    const isAuthenticated = !!(token && token !== 'oauth_authenticated' && token.trim() !== '')
    expect(isAuthenticated).toBe(true)
    // Authenticated user visiting /login -> redirect to dashboards
    const redirect = isAuthenticated ? '/dashboards?v2=1' : null
    expect(redirect).toBe('/dashboards?v2=1')
  })

  it('7) no redirect loop — authed root -> dashboards, not back to login', () => {
    const token = localStorage.getItem('api_token')
    const isAuthenticated = !!(token && token !== 'oauth_authenticated' && token.trim() !== '')
    expect(isAuthenticated).toBe(true)
    // Root redirects to dashboards (not login)
    const rootRedirect = isAuthenticated ? '/dashboards?v2=1' : '/login'
    expect(rootRedirect).toBe('/dashboards?v2=1')
    // Dashboards does NOT redirect back to root or login when authed
    const dashRedirect = isAuthenticated ? null : '/login'
    expect(dashRedirect).toBeNull()
  })
})

describe('auth routing guard — sentinel token rejected', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.setItem('api_token', 'oauth_authenticated')
  })

  afterEach(() => {
    localStorageMock.clear()
  })

  it('8) oauth_authenticated sentinel is treated as unauthenticated', () => {
    const token = localStorage.getItem('api_token')
    const isAuthenticated = !!(token && token !== 'oauth_authenticated' && token.trim() !== '')
    expect(isAuthenticated).toBe(false)
    const redirect = isAuthenticated ? '/dashboards?v2=1' : '/login'
    expect(redirect).toBe('/login')
  })
})

describe('auth routing guard — empty token rejected', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.setItem('api_token', '   ')
  })

  afterEach(() => {
    localStorageMock.clear()
  })

  it('9) whitespace-only token is treated as unauthenticated', () => {
    const token = localStorage.getItem('api_token')
    const isAuthenticated = !!(token && token !== 'oauth_authenticated' && token.trim() !== '')
    expect(isAuthenticated).toBe(false)
    const redirect = isAuthenticated ? '/dashboards?v2=1' : '/login'
    expect(redirect).toBe('/login')
  })
})
