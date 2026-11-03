import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

function makeLocalStorage(getItemImpl = () => null) {
  return { getItem: vi.fn(getItemImpl as any), setItem: vi.fn() }
}

// Runtime host must drive the default so a production build (non-localhost)
// cannot silently fall back to the simulator when VITE_CM_TELEMETRY_LIVE is not set.
vi.mock('../lib/insights/runtimeMode', () => ({
  isLivePilotMode: vi.fn(),
}))

// The store imports the productivity service at the top level; it should not
// issue any HTTP calls during module initialization, but guard fetch if it ever does.
vi.mock('../config/api', () => ({
  authenticatedFetch: vi.fn(),
}))

let isLivePilotMode: ReturnType<typeof vi.fn>

/**
 * Re-import the store with a fresh module cache so the top-level
 * envTelemetryDefault is re-evaluated for each test case.
 */
async function loadStore() {
  vi.resetModules()
  const { useMetricsFacadeStore } = await import('../stores/metricsFacade')
  setActivePinia(createPinia())
  return useMetricsFacadeStore()
}

describe('PBT telemetry mode default', () => {
  beforeEach(async () => {
    const mod = await import('../lib/insights/runtimeMode')
    isLivePilotMode = mod.isLivePilotMode as any
    const storage = makeLocalStorage()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', {
      localStorage: storage,
      location: { hostname: 'prioritydispatch.chaosmonkey.dev' },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('defaults to live on non-localhost when no env flag is set', async () => {
    isLivePilotMode.mockReturnValue(true)
    const store = await loadStore()
    expect(store.telemetryMode).toBe('live')
  })

  it('defaults to sim on localhost when no env flag is set', async () => {
    isLivePilotMode.mockReturnValue(false)
    const store = await loadStore()
    expect(store.telemetryMode).toBe('sim')
  })

  it('invalidates a stale localStorage sim override when the build default flips to live', async () => {
    isLivePilotMode.mockReturnValue(true)
    const getItem = (key: string) => {
      if (key === 'telemetryModeMigrationStamp') return 'v1:sim'
      if (key === 'telemetryMode') return 'sim'
      return null
    }
    const storage = makeLocalStorage(getItem)
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { localStorage: storage })
    const store = await loadStore()
    expect(store.telemetryMode).toBe('live')
  })
})
