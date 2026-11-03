/**
 * Vitest global setup — runs BEFORE any test module imports execute.
 *
 * Reason: `src/config/api.js` reads `window.location.origin` at module
 * top-level (import time). Tests that transitively import dataAccess.ts
 * (which imports config/api.js) fail with `ReferenceError: window is not
 * defined` unless a window global exists before those imports evaluate.
 *
 * This setup file is registered via vitest.config.ts `test.setupFiles` and
 * executes prior to test-file module evaluation, so the window mock is in
 * place before config/api.js runs.
 *
 * No jsdom dependency. Minimal mock: only what config/api.js and the PI
 * audit/stress paths touch (location.origin, location.search, localStorage).
 *
 * CR-X: Also stubs VITE_FINAL_PI_ENGINE_ENABLED=true so the Final Engine
 * feature flag is enabled in the test environment (matches .env.development).
 */
import { vi } from 'vitest';

// Enable the Final PI Engine in tests (matches .env.development)
vi.stubEnv('VITE_FINAL_PI_ENGINE_ENABLED', 'true');
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = {
    location: {
      origin: 'http://localhost:5174',
      hostname: 'localhost',
      search: '',
      href: 'http://localhost:5174/',
    },
    localStorage: {
      _store: {} as Record<string, string>,
      getItem(key: string) { return this._store[key] ?? null; },
      setItem(key: string, value: string) { this._store[key] = String(value); },
      removeItem(key: string) { delete this._store[key]; },
      clear() { this._store = {}; },
    },
  } as any;
} else {
  const w = (globalThis as any).window;
  if (!w.location) {
    w.location = { origin: 'http://localhost:5174', hostname: 'localhost', search: '', href: 'http://localhost:5174/' };
  } else if (!w.location.origin) {
    w.location.origin = w.location.origin || 'http://localhost:5174';
  }
  if (!w.localStorage) {
    w.localStorage = {
      _store: {} as Record<string, string>,
      getItem(key: string) { return this._store[key] ?? null; },
      setItem(key: string, value: string) { this._store[key] = String(value); },
      removeItem(key: string) { delete this._store[key]; },
      clear() { this._store = {}; },
    };
  }
}
