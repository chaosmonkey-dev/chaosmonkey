/**
 * CR-X PI/PBT-TIME P0 regression tests.
 *
 * Covers:
 *   - Latest-request-wins at the state application point
 *   - Stale prior-scope data is cleared during scope transition
 *   - Older request resolving after newer request does NOT overwrite state
 *   - Timeout/error does NOT become cached "real zero"
 *   - In-flight canonical request dedupe by normalized key
 *   - Claude Code AI Activity / Session AIOI/PBT parity
 *
 * These tests exercise the actual state-application path of useTimeSeries
 * and the in-flight dedupe map of telemetryToUnified.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

// Provide a minimal localStorage mock for stores that read saved metrics.
const localStorageMock: Record<string, string> = {}
;(globalThis as any).localStorage = {
  getItem: (key: string) => (key in localStorageMock ? localStorageMock[key] : null),
  setItem: (key: string, value: string) => { localStorageMock[key] = value },
  removeItem: (key: string) => { delete localStorageMock[key] },
  clear: () => { Object.keys(localStorageMock).forEach((k) => delete localStorageMock[k]) },
}

// Mock the metricsFacade service so useTimeSeries calls a controllable fetch.
vi.mock('../services/metricsFacade', () => ({
  getProductivityTimeSeries: vi.fn(),
  fetchDeliveryTimeSeries: vi.fn(),
  buildDeliverySeries: vi.fn(),
}))

// Mock authenticatedFetch to avoid localStorage dependency.
// The api module is at src/config/api.js (note: .js extension).
// telemetryToUnified imports it via '../../config/api', which resolves to
// src/config/api. From this test file (src/tests/), the same module is '../config/api'.
vi.mock('../config/api', () => ({
  authenticatedFetch: vi.fn(),
  API_URL: 'http://localhost:8010',
}))

import { useTimeSeries } from '../composables/useTimeSeries'
import { getProductivityTimeSeries, fetchDeliveryTimeSeries } from '../services/metricsFacade'
import { authenticatedFetch } from '../config/api'
import {
  fetchAndMapTelemetryToUnified,
  resetCanonicalTelemetryCache,
} from '../lib/adapters/telemetryToUnified'
import { isMetricInstrumentedForWorkflow, getMetricObservability } from '../lib/surfaceAgentContract'
import { isMetricInstrumentedForTool } from '../lib/productivityCards'

const baseQuery = {
  from: '2026-09-02',
  to: '2026-09-08',
  repos: [] as string[],
  scope: 'org' as const,
  viewBucket: 'daily' as const,
  developerIds: [] as string[],
  teamIds: [] as string[],
  toolIds: [] as string[],
  metricIds: ['ide.ai_suggestions_accepted'],
}

function makeResult(series: any[], dataSource: 'Real' | 'Simulated' = 'Real') {
  return {
    dataSource,
    series,
    latest_observed_at: '2026-09-08T00:00:00.000Z',
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeCanonicalResponse(records: any[] = []) {
  return new Response(
    JSON.stringify({
      data: records,
      metadata: {
        canonical_population_count: records.length,
        session_count_by_tool: {},
        tools_in_population: [],
        periods_returned: records.length,
        tools_returned: 0,
        format: 'aggregated',
        period: 'day',
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

describe('CR-X PI/PBT-TIME P0: useTimeSeries latest-request-wins', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // Reset mocks completely (clears queued mockResolvedValueOnce/rejectedValueOnce)
    vi.mocked(getProductivityTimeSeries).mockReset()
    vi.mocked(fetchDeliveryTimeSeries).mockReset()
    vi.mocked(fetchDeliveryTimeSeries).mockResolvedValue({
      series: [],
      meta: { attribution_authority: 'org', source: 'live' },
    } as any)
  })

  it('clears prior data when a new request starts (no stale data under new scope)', async () => {
    const queryRef = ref({ ...baseQuery })
    const { data, isLoading } = useTimeSeries(queryRef as any)

    // First request returns series with 7 points
    vi.mocked(getProductivityTimeSeries).mockResolvedValueOnce(
      makeResult([{ label: 'cursor', points: new Array(7).fill({ t: '2026-09-02', v: 1 }) }]) as any
    )

    // Trigger initial fetch
    await nextTick()
    await delay(50)
    expect(data.value).not.toBeNull()

    // Second request: slower, returns different data
    vi.mocked(getProductivityTimeSeries).mockImplementationOnce(async () => {
      await delay(100)
      return makeResult([{ label: 'cursor', points: new Array(30).fill({ t: '2026-08-10', v: 2 }) }]) as any
    })

    // Change query to trigger new request
    queryRef.value = { ...baseQuery, from: '2026-08-10', to: '2026-09-08' }
    await nextTick()

    // CR-X PI/PBT-TIME P0: Data should be cleared IMMEDIATELY when the query
    // changes, even during the debounce window. No stale data under new scope.
    expect(data.value).toBeNull()
    expect(isLoading.value).toBe(true)
  })

  it('older request resolving after newer request does NOT overwrite state', async () => {
    const queryRef = ref({ ...baseQuery })

    // First request is slow (simulates Last Week)
    const slowResolver = new Promise((resolve) => {
      setTimeout(() => {
        resolve(makeResult([{ label: 'cursor', points: [{ t: '2026-09-02', v: 1 }] }]))
      }, 150)
    })
    vi.mocked(getProductivityTimeSeries).mockReturnValueOnce(slowResolver as any)

    // Second request is fast (simulates Last Month)
    vi.mocked(getProductivityTimeSeries).mockResolvedValueOnce(
      makeResult([{ label: 'cursor', points: [{ t: '2026-08-10', v: 2 }] }]) as any
    )

    // Default fallback for any unexpected calls
    vi.mocked(getProductivityTimeSeries).mockResolvedValue(
      makeResult([{ label: 'cursor', points: [{ t: '2026-08-10', v: 2 }] }]) as any
    )

    const { data } = useTimeSeries(queryRef as any)

    await nextTick()
    await delay(10) // Let first request start

    // Change query to trigger second (faster) request
    queryRef.value = { ...baseQuery, from: '2026-08-10', to: '2026-09-08' }
    await nextTick()
    // Wait for debounce (350ms) + fast mock resolve + slow mock resolve
    await delay(550)

    // The fast (newer) request should win. The slow (older) request's data
    // must NOT have overwritten the newer request's state.
    expect(data.value).not.toBeNull()
    const series = data.value as any
    expect(series[0].points[0].t).toBe('2026-08-10')
    expect(series[0].points[0].v).toBe(2)
  })

  it('timeout/error does NOT become cached real zero (data cleared on error)', async () => {
    const queryRef = ref({ ...baseQuery })

    // Set the rejection BEFORE creating the composable so the initial
    // mount fetch (via nextTick) uses the rejected mock.
    vi.mocked(getProductivityTimeSeries).mockRejectedValueOnce(new Error('Request timeout'))

    const { data, error } = useTimeSeries(queryRef as any)

    await nextTick()
    await delay(50)

    // On error, data should be null (not stale prior data, not cached zero)
    expect(data.value).toBeNull()
    expect(error.value).toBe('Request timeout')
  })
})

describe('CR-X PI/PBT-TIME P0: in-flight canonical request dedupe', () => {
  beforeEach(() => {
    resetCanonicalTelemetryCache()
    vi.clearAllMocks()
  })

  it('dedupes identical in-flight canonical requests (single fetch shared)', async () => {
    let fetchCallCount = 0
    vi.mocked(authenticatedFetch).mockImplementation(async () => {
      fetchCallCount++
      await delay(50)
      return makeCanonicalResponse([
        { tool: 'cursor', period: '2026-09-02', ai_suggestions_accepted: 5, session_count: 10 },
      ]) as any
    })

    // Issue two identical requests concurrently
    const p1 = fetchAndMapTelemetryToUnified('day', '2026-09-02', '2026-09-08', undefined, undefined, undefined, 'America/New_York')
    const p2 = fetchAndMapTelemetryToUnified('day', '2026-09-02', '2026-09-08', undefined, undefined, undefined, 'America/New_York')

    const [r1, r2] = await Promise.all([p1, p2])

    // Both should return the same result
    expect(r1.records.length).toBe(1)
    expect(r2.records.length).toBe(1)
    // Only ONE fetch should have been issued
    expect(fetchCallCount).toBe(1)
  })

  it('does NOT dedupe different scopes (different date ranges)', async () => {
    let fetchCallCount = 0
    vi.mocked(authenticatedFetch).mockImplementation(async () => {
      fetchCallCount++
      await delay(20)
      return makeCanonicalResponse([]) as any
    })

    const p1 = fetchAndMapTelemetryToUnified('day', '2026-09-02', '2026-09-08', undefined, undefined, undefined, 'America/New_York')
    const p2 = fetchAndMapTelemetryToUnified('day', '2026-08-10', '2026-09-08', undefined, undefined, undefined, 'America/New_York')

    await Promise.all([p1, p2])

    // Two different scopes = two fetches
    expect(fetchCallCount).toBe(2)
  })
})

describe('CR-X PI/PBT-TIME P0: Claude Code AI Activity / Session AIOI/PBT parity', () => {
  it('surfaceAgentContract marks ai_suggestions_accepted as directly_observed for terminal', () => {
    expect(getMetricObservability('terminal', 'ai_suggestions_accepted')).toBe('directly_observed')
  })

  it('isMetricInstrumentedForWorkflow returns true for claude_code ai_suggestions_accepted', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'ai_suggestions_accepted')).toBe(true)
  })

  it('isMetricInstrumentedForTool (PBT) returns true for claude_code ai_suggestions_accepted', () => {
    expect(isMetricInstrumentedForTool('claude_code', 'ai_suggestions_accepted')).toBe(true)
  })

  it('genuinely unavailable terminal metrics remain gated', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'active_coding_duration_ms')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'focus_ratio')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'idle_time_ms')).toBe(false)
    expect(isMetricInstrumentedForTool('claude_code', 'active_coding_time_minutes')).toBe(false)
    expect(isMetricInstrumentedForTool('claude_code', 'idle_time_minutes')).toBe(false)
  })

  it('AIOI and PBT both agree claude_code ai_suggestions_accepted is instrumented', () => {
    const aioiInstrumented = isMetricInstrumentedForWorkflow('claude_code', 'ai_suggestions_accepted')
    const pbtInstrumented = isMetricInstrumentedForTool('claude_code', 'ai_suggestions_accepted')
    expect(aioiInstrumented).toBe(pbtInstrumented)
    expect(aioiInstrumented).toBe(true)
  })
})

describe('CR-X PBT P0: external signal propagation (single-threaded server fix)', () => {
  beforeEach(() => {
    resetCanonicalTelemetryCache()
    vi.mocked(authenticatedFetch).mockReset()
  })

  it('fetchAndMapTelemetryToUnified rejects the caller when an external AbortSignal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    vi.mocked(authenticatedFetch).mockImplementation(async (_url: string, _init?: any) => {
      return makeCanonicalResponse([])
    }) as any

    await expect(
      fetchAndMapTelemetryToUnified('day', '2026-09-01', '2026-09-06', [], [], [], undefined, controller.signal)
    ).rejects.toThrow('AbortError')

    // The canonical HTTP request must NOT be wired to the caller's signal;
    // in-flight sharing would let one consumer abort the request for others.
    expect(vi.mocked(authenticatedFetch)).toHaveBeenCalledTimes(1)
    const callInit = vi.mocked(authenticatedFetch).mock.calls[0]?.[1] as any
    expect(callInit?.signal).toBeUndefined()
  })

  it('fetchAndMapTelemetryToUnified does NOT create a default 10s timeout AbortController', async () => {
    // The prior default 10s timeout caused AbortError cascades on the
    // single-threaded PHP server. The canonical fetch now owns no timeout.
    vi.mocked(authenticatedFetch).mockImplementation(async (_url: string, init?: any) => {
      expect(init?.signal).toBeUndefined()
      return makeCanonicalResponse([])
    }) as any

    const result = await fetchAndMapTelemetryToUnified('day', '2026-09-01', '2026-09-06')
    expect(result.records).toEqual([])
    expect(vi.mocked(authenticatedFetch)).toHaveBeenCalledTimes(1)
  })

  it('adaptive granularity passes signal through to the fetcher', async () => {
    const { fetchTelemetryWithAdaptiveGranularity } = await import('../lib/productivity/fetchTelemetryWithAdaptiveGranularity')
    const controller = new AbortController()
    const receivedSignals: (AbortSignal | undefined)[] = []

    const fetcher = vi.fn(async (
      _period: 'day' | 'week',
      _from?: string,
      _to?: string,
      _toolIds?: string[],
      _developerIds?: string[],
      _repos?: string[],
      _tz?: string,
      signal?: AbortSignal
    ) => {
      receivedSignals.push(signal)
      return { records: [], metadata: null }
    })

    await fetchTelemetryWithAdaptiveGranularity({
      query: { from: '2026-09-01', to: '2026-09-06', viewBucket: 'daily', toolIds: [], developerIds: [], repos: [], scope: 'org', metricIds: ['ide.ai_suggestions_accepted'] } as any,
      fetcher,
      signal: controller.signal,
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(receivedSignals[0]).toBe(controller.signal)
  })
})
