/**
 * CR-X PBT-CLEANUP-4: useTimeSeries delivery state-transition behavioral test.
 *
 * Exercises the REAL useTimeSeries composable (not a simulation) to prove:
 *
 * 1. First delivery fetch succeeds with non-empty data =>
 *    deliverySeries has data, deliveryError === null, deliverySource is set
 *
 * 2. Subsequent refresh: telemetry succeeds, delivery fetch rejects =>
 *    prior deliverySeries is STILL PRESENT (not cleared)
 *    deliveryError is non-null
 *    deliverySource === 'error'
 *    telemetry data remains available
 *
 * 3. After error recovery, next delivery fetch succeeds with zero rows =>
 *    deliverySeries becomes null (authoritative EMPTY supersedes last-good)
 *    deliveryError === null
 *    deliverySource is the successful source, NOT 'error'
 *
 * This proves: ERROR preserves last-good, but authoritative EMPTY supersedes last-good.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

// Mock metricsFacade — control both telemetry and delivery paths
const mockGetProductivityTimeSeries = vi.fn()
const mockFetchDeliveryTimeSeries = vi.fn()
const mockBuildDeliverySeries = vi.fn()

vi.mock('../services/metricsFacade', () => ({
  getProductivityTimeSeries: (...args: any[]) => mockGetProductivityTimeSeries(...args),
  fetchDeliveryTimeSeries: (...args: any[]) => mockFetchDeliveryTimeSeries(...args),
  buildDeliverySeries: (...args: any[]) => mockBuildDeliverySeries(...args),
}))

// Mock logger to avoid noise
vi.mock('../utils/logger', () => ({
  log: () => {},
  warn: () => {},
  error: () => {},
}))

// Mock the metrics facade store — useTimeSeries reads telemetryModeVersion from it
vi.mock('../stores/metricsFacade', () => ({
  useMetricsFacadeStore: () => ({
    telemetryModeVersion: ref(0),
  }),
}))

import { useTimeSeries } from '../composables/useTimeSeries'
import type { ProductivityQuery } from '../types/metrics'

// Valid query that passes useTimeSeries validation
const validQuery: ProductivityQuery = {
  from: '2026-01-01',
  to: '2026-01-08',
  repos: [],
  scope: 'org',
  viewBucket: 'weekly',
}

// Helper: create a computed ref wrapping a static query (useTimeSeries expects ComputedRef)
function makeQueryRef(q: ProductivityQuery) {
  return computed(() => q)
}

// Helper: simulate a successful telemetry response
function telemetrySuccess(series: any[] = [{ label: 'cursor', points: [{ t: '2026-01-01', sessions: 10 }] }]) {
  return {
    series,
    dataSource: 'Real' as const,
    latest_observed_at: '2026-01-08T00:00:00Z',
  }
}

// Helper: simulate a successful delivery response with observations
function deliverySuccessWithRows() {
  return {
    series: [{
      period: '2026-W01',
      merged_pr_count: 5,
      total_pr_count: 10,
      deployment_count: 3,
      successful_deployment_count: 2,
      failed_deployment_count: 1,
      deploy_success_rate: 0.67,
      median_merge_cycle_hours: 24,
      release_count: 1,
      review_count: 8,
      pr_reopened_count: 0,
      pr_review_cycles: 4,
      merge_rate: 0.5,
      count_authority: 'github',
    }],
    meta: {
      from: '2026-01-01',
      to: '2026-01-08',
      repo: null,
      period: 'week',
      total_weeks: 1,
      source: 'live',
      attribution_authority: 'org' as const,
    },
  }
}

// Helper: simulate a successful delivery response with zero rows
function deliverySuccessEmpty() {
  return {
    series: [],
    meta: {
      from: '2026-01-01',
      to: '2026-01-08',
      repo: null,
      period: 'week',
      total_weeks: 0,
      source: 'live',
      attribution_authority: 'org' as const,
    },
  }
}

// buildDeliverySeries mock: produce a non-null series when given rows
function mockDeliverySeriesBuilt() {
  return {
    label: 'Org delivery',
    points: [{ t: '2026-01-01', merged_pr_count: 5 }],
  }
}

// Helper: flush all pending microtasks/timers so async fetches complete
async function flush() {
  await nextTick()
  await new Promise(r => setTimeout(r, 10))
}

describe('CR-X PBT-CLEANUP-4: useTimeSeries delivery state transitions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockGetProductivityTimeSeries.mockReset()
    mockFetchDeliveryTimeSeries.mockReset()
    mockBuildDeliverySeries.mockReset()
  })

  it('1. first fetch succeeds with delivery data => deliverySeries populated, no error', async () => {
    mockGetProductivityTimeSeries.mockResolvedValue(telemetrySuccess())
    mockFetchDeliveryTimeSeries.mockResolvedValue(deliverySuccessWithRows())
    mockBuildDeliverySeries.mockReturnValue(mockDeliverySeriesBuilt())

    const queryRef = makeQueryRef(validQuery)
    const ts = useTimeSeries(queryRef)

    // Let the initial nextTick fetch start and complete
    await flush()

    expect(ts.deliverySeries.value).not.toBeNull()
    expect(ts.deliverySeries.value?.label).toBe('Org delivery')
    expect(ts.deliveryError.value).toBeNull()
    expect(ts.deliverySource.value).toBe('live')
    expect(ts.data.value).not.toBeNull()
    expect(ts.data.value!.length).toBeGreaterThan(0)
  })

  it('2. refresh failure preserves prior delivery data + sets deliveryError + telemetry healthy', async () => {
    // Phase 1: successful delivery fetch
    mockGetProductivityTimeSeries.mockResolvedValue(telemetrySuccess())
    mockFetchDeliveryTimeSeries.mockResolvedValue(deliverySuccessWithRows())
    mockBuildDeliverySeries.mockReturnValue(mockDeliverySeriesBuilt())

    const queryRef = makeQueryRef(validQuery)
    const ts = useTimeSeries(queryRef)

    await flush()

    // Verify good state
    expect(ts.deliverySeries.value).not.toBeNull()
    expect(ts.deliveryError.value).toBeNull()
    expect(ts.deliverySource.value).toBe('live')
    const goodDeliverySeries = ts.deliverySeries.value

    // Phase 2: refresh — telemetry succeeds, delivery REJECTS
    mockFetchDeliveryTimeSeries.mockRejectedValue(new Error('Delivery network error'))

    await ts.refreshImmediate()
    await flush()

    // Prior delivery data is STILL PRESENT (not cleared)
    expect(ts.deliverySeries.value).not.toBeNull()
    expect(ts.deliverySeries.value).toBe(goodDeliverySeries) // same reference — not overwritten
    // deliveryError is set
    expect(ts.deliveryError.value).not.toBeNull()
    expect(ts.deliveryError.value).toContain('Delivery')
    // deliverySource is 'error'
    expect(ts.deliverySource.value).toBe('error')
    // Telemetry data remains healthy
    expect(ts.data.value).not.toBeNull()
    expect(ts.data.value!.length).toBeGreaterThan(0)
    // The failure did NOT convert delivery evidence to [] — deliverySeries still has the good data
    expect(ts.deliverySeries.value?.points?.length).toBeGreaterThan(0)
  })

  it('3. after error, authoritative EMPTY supersedes last-good delivery data', async () => {
    // Phase 1: successful delivery with rows
    mockGetProductivityTimeSeries.mockResolvedValue(telemetrySuccess())
    mockFetchDeliveryTimeSeries.mockResolvedValue(deliverySuccessWithRows())
    mockBuildDeliverySeries.mockReturnValue(mockDeliverySeriesBuilt())

    const queryRef = makeQueryRef(validQuery)
    const ts = useTimeSeries(queryRef)

    await flush()
    expect(ts.deliverySeries.value).not.toBeNull()

    // Phase 2: delivery error
    mockFetchDeliveryTimeSeries.mockRejectedValue(new Error('Network error'))
    await ts.refreshImmediate()
    await flush()
    expect(ts.deliveryError.value).not.toBeNull()
    expect(ts.deliverySeries.value).not.toBeNull() // prior good preserved

    // Phase 3: delivery succeeds with zero rows (authoritative EMPTY)
    mockFetchDeliveryTimeSeries.mockResolvedValue(deliverySuccessEmpty())
    await ts.refreshImmediate()
    await flush()

    // deliverySeries becomes null — authoritative EMPTY supersedes last-good
    expect(ts.deliverySeries.value).toBeNull()
    // deliveryError is cleared
    expect(ts.deliveryError.value).toBeNull()
    // deliverySource is the successful source, NOT 'error'
    expect(ts.deliverySource.value).toBe('live')
  })

  it('4. delivery failure does not corrupt telemetry data (scoped error)', async () => {
    mockGetProductivityTimeSeries.mockResolvedValue(telemetrySuccess([
      { label: 'cursor', points: [{ t: '2026-01-01', sessions: 10 }] },
      { label: 'vscode', points: [{ t: '2026-01-01', sessions: 20 }] },
    ]))
    mockFetchDeliveryTimeSeries.mockRejectedValue(new Error('Delivery 500'))

    const queryRef = makeQueryRef(validQuery)
    const ts = useTimeSeries(queryRef)

    await flush()

    // Telemetry is fully available with both workflows
    expect(ts.data.value).not.toBeNull()
    expect(ts.data.value!.length).toBe(2)
    expect(ts.data.value!.find(s => s.label === 'cursor')).toBeDefined()
    expect(ts.data.value!.find(s => s.label === 'vscode')).toBeDefined()
    // Delivery error is scoped — does not affect telemetry
    expect(ts.deliveryError.value).not.toBeNull()
    expect(ts.error.value).toBeNull() // main telemetry error is NOT set
  })
})
