import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMetricsFacadeStore } from '../stores/metricsFacade'
import { getDefaultTelemetryMode, resolveTelemetryMode } from '../services/metricsFacade'
import { isLivePilotMode } from '../lib/insights/runtimeMode'

vi.mock('../lib/insights/runtimeMode', () => ({
  isLivePilotMode: vi.fn(),
}))

/**
 * Contract for the new telemetry-mode default logic in metricsFacade.
 * - Non-localhost with no explicit live env flag must default to live.
 * - Localhost with no explicit live env flag must default to sim.
 * - metricsFacadeStore telemetryMode override must take precedence.
 * - VITE_CM_TELEMETRY_LIVE=true must still force live.
 */

describe('telemetry mode default contract', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('non-localhost + no live env flags → live', () => {
    isLivePilotMode.mockReturnValue(true)
    expect(getDefaultTelemetryMode({})).toBe('live')
  })

  it('localhost + no live env flags → sim', () => {
    isLivePilotMode.mockReturnValue(false)
    expect(getDefaultTelemetryMode({})).toBe('sim')
  })

  it('VITE_CM_TELEMETRY_LIVE=true stays live', () => {
    isLivePilotMode.mockReturnValue(false)
    expect(getDefaultTelemetryMode({ VITE_CM_TELEMETRY_LIVE: 'true' })).toBe('live')
  })

  it('metrics-facade store telemetryMode override takes precedence', () => {
    isLivePilotMode.mockReturnValue(true)

    // The store reads localStorage on creation; provide a minimal stub.
    globalThis.localStorage = { getItem: vi.fn(() => null) } as any
    setActivePinia(createPinia())

    const store = useMetricsFacadeStore()
    store.telemetryMode = 'sim'
    expect(resolveTelemetryMode()).toBe('sim')

    store.telemetryMode = 'live'
    expect(resolveTelemetryMode()).toBe('live')

    store.telemetryMode = null as any
    // Falls back to non-localhost default
    expect(resolveTelemetryMode()).toBe('live')
  })
})
