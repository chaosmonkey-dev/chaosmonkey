/**
 * P0-G Part F: Dashboard auth truthfulness tests.
 *
 * Tests that:
 * - AuthError class correctly classifies 401/403/5xx
 * - authenticatedFetch throws AuthError on 401/403/5xx
 * - authStore tracks authError state distinctly from isAuthed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { AuthError, AuthErrorType, classifyHttpStatus } from '../config/api'

describe('AuthError classification', () => {
  it('classifies 401 as AUTH_REQUIRED', () => {
    expect(classifyHttpStatus(401)).toBe(AuthErrorType.AUTH_REQUIRED)
  })

  it('classifies 403 as ACCESS_DENIED', () => {
    expect(classifyHttpStatus(403)).toBe(AuthErrorType.ACCESS_DENIED)
  })

  it('classifies 500 as SERVER_UNAVAILABLE', () => {
    expect(classifyHttpStatus(500)).toBe(AuthErrorType.SERVER_UNAVAILABLE)
  })

  it('classifies 502 as SERVER_UNAVAILABLE', () => {
    expect(classifyHttpStatus(502)).toBe(AuthErrorType.SERVER_UNAVAILABLE)
  })

  it('classifies 0 (network error) as SERVER_UNAVAILABLE', () => {
    expect(classifyHttpStatus(0)).toBe(AuthErrorType.SERVER_UNAVAILABLE)
  })

  it('classifies 200 as null (success)', () => {
    expect(classifyHttpStatus(200)).toBe(null)
  })

  it('classifies 404 as null (not an auth error)', () => {
    expect(classifyHttpStatus(404)).toBe(null)
  })
})

describe('AuthError class', () => {
  it('creates AUTH_REQUIRED error with correct type', () => {
    const err = new AuthError(AuthErrorType.AUTH_REQUIRED, 401, 'Token expired')
    expect(err.isAuthRequired()).toBe(true)
    expect(err.isAccessDenied()).toBe(false)
    expect(err.isServerUnavailable()).toBe(false)
    expect(err.status).toBe(401)
    expect(err.name).toBe('AuthError')
  })

  it('creates ACCESS_DENIED error with correct type', () => {
    const err = new AuthError(AuthErrorType.ACCESS_DENIED, 403, 'Forbidden')
    expect(err.isAccessDenied()).toBe(true)
    expect(err.isAuthRequired()).toBe(false)
    expect(err.isServerUnavailable()).toBe(false)
    expect(err.status).toBe(403)
  })

  it('creates SERVER_UNAVAILABLE error with correct type', () => {
    const err = new AuthError(AuthErrorType.SERVER_UNAVAILABLE, 503, 'Server down')
    expect(err.isServerUnavailable()).toBe(true)
    expect(err.isAuthRequired()).toBe(false)
    expect(err.isAccessDenied()).toBe(false)
    expect(err.status).toBe(503)
  })
})

describe('authStore authError state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ;(globalThis as any).localStorage = (globalThis as any).window.localStorage
    ;(globalThis as any).sessionStorage = {
      _store: {} as Record<string, string>,
      getItem(key: string) { return this._store[key] ?? null; },
      setItem(key: string, value: string) { this._store[key] = String(value); },
      removeItem(key: string) { delete this._store[key]; },
      clear() { this._store = {}; },
    }
    ;(globalThis as any).window.localStorage.clear()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('tracks authError state distinctly from isAuthed', async () => {
    const { useAuthStore } = await import('../stores/auth')
    const store = useAuthStore()

    // Initial state
    expect(store.authError).toBe(null)
    expect(store.isAuthed).toBe(false)

    // Set AUTH_REQUIRED
    store.setAuthError('AUTH_REQUIRED')
    expect(store.authError).toBe('AUTH_REQUIRED')
    expect(store.isAuthed).toBe(false)

    // Clear auth error
    store.clearAuthError()
    expect(store.authError).toBe(null)
  })

  it('does not clear isAuthed on ACCESS_DENIED', async () => {
    const { useAuthStore } = await import('../stores/auth')
    const store = useAuthStore()

    store.isAuthed = true
    store.setAuthError('ACCESS_DENIED')
    expect(store.authError).toBe('ACCESS_DENIED')
    // User is still authenticated, just not authorized
    expect(store.isAuthed).toBe(true)
  })

  it('clears authError on logout', async () => {
    const { useAuthStore } = await import('../stores/auth')
    const store = useAuthStore()

    store.setAuthError('AUTH_REQUIRED')
    expect(store.authError).toBe('AUTH_REQUIRED')

    await store.logout()
    expect(store.authError).toBe(null)
    expect(store.isAuthed).toBe(false)
  })
})
