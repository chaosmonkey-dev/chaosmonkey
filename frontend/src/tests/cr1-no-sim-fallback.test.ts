import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

if (typeof globalThis.window === 'undefined') {
  ;(globalThis as any).window = { location: { search: '', origin: 'http://127.0.0.1:5174', hostname: '127.0.0.1' } }
}

const { simulateSpy } = vi.hoisted(() => {
  const simulateSpy = vi.fn(() => ({
    series: [{ label: 'cursor', points: [{ t: '2026-01-01', v: 42 }] }],
    dataSource: 'Simulated' as const,
  }))
  return { simulateSpy }
})

vi.mock('../lib/simulators/productivity', () => ({
  simulateProductivityTS: simulateSpy,
  CANONICAL_REAL_WORKFLOWS: ['cursor', 'vscode', 'devin'],
}))

vi.mock('../utils/apiUrl', () => ({
  buildApiUrl: (path: string) => `http://127.0.0.1:8010/api/${path}`,
}))

vi.mock('../config/api', () => ({
  default: 'http://127.0.0.1:8010/api',
  API_URL: 'http://127.0.0.1:8010/api',
}))

vi.mock('pinia', () => ({
  defineStore: () => () => ({
    telemetryMode: 'live',
    telemetryUsedInSummary: false,
    telemetryUsedInSeries: false,
  }),
}))

import { getProductivitySummary, getProductivityTimeSeries } from '../services/metricsFacade'

const baseQuery: any = {
  from: '2026-07-01',
  to: '2026-07-15',
  repos: ['test-repo'],
  scope: 'team',
  viewBucket: 'weekly',
  toolIds: ['cursor', 'vscode'],
  developerIds: [],
  teamIds: [],
  metricId: 'ide.ai_suggestions_accepted',
  metricIds: ['ide.ai_suggestions_accepted'],
}

describe('CR1 Phase 1: No simulator fallback in live mode', () => {
  beforeEach(() => {
    simulateSpy.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getProductivitySummary does not call simulator when telemetry returns 0 records', async () => {
    const result = await getProductivitySummary(baseQuery)
    expect(simulateSpy).not.toHaveBeenCalled()
    expect(result.dataSource).toBe('Real')
    expect(Object.keys(result.totals).length).toBe(0)
  })

  it('getProductivityTimeSeries does not call simulator when telemetry returns 0 records', async () => {
    const result = await getProductivityTimeSeries(baseQuery)
    expect(simulateSpy).not.toHaveBeenCalled()
    expect(result.dataSource).toBe('Real')
    expect((result as any).series).toEqual([])
  })

  it('getProductivitySummary returns empty Real on fetch error (no simulator)', async () => {
    const result = await getProductivitySummary({
      ...baseQuery,
      from: 'invalid-date',
    })
    expect(simulateSpy).not.toHaveBeenCalled()
    expect(result.dataSource).toBe('Real')
  })
})
