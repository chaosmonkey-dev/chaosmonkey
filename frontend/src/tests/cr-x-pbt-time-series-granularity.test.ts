import { describe, it, expect, vi } from 'vitest'
import { fetchTelemetryWithAdaptiveGranularity } from '../lib/productivity/fetchTelemetryWithAdaptiveGranularity'
import type { UnifiedTelemetryResult } from '../lib/adapters/telemetryToUnified'
import type { ProductivityQuery } from '../types/metrics'

function makeResult(overrides: Partial<UnifiedTelemetryResult> = {}): UnifiedTelemetryResult {
  return {
    records: [],
    metadata: null,
    ...overrides,
  }
}

function makeRecords(periods: string[], tool = 'vscode', sessionCount = 1): UnifiedTelemetryResult['records'] {
  return periods.map((period) => ({
    period,
    tool,
    AI_suggestions_accepted: 0,
    AI_usage_duration_minutes: 0,
    idle_time_minutes: 0,
    active_coding_time_minutes: 0,
    average_session_length_minutes: 0,
    files_edited_per_session: 0,
    commits_per_session: 0,
    time_to_first_commit_minutes: 0,
    active_coding_ratio: 0,
    ai_usage_ratio: 0,
    idle_ratio: 0,
    activeCodingMs: 0,
    sessionCount,
    source: 'telemetry' as const,
  }))
}

function dailyIsoDates(startDate: string, count: number): string[] {
  const start = new Date(startDate + 'T00:00:00Z').getTime()
  const dayMs = 24 * 60 * 60 * 1000
  return Array.from({ length: count }, (_, i) => new Date(start + i * dayMs).toISOString().split('T')[0])
}

function makeQuery(
  from: string,
  to: string,
  viewBucket: 'daily' | 'weekly' | 'monthly' = 'daily',
  toolIds?: string[]
): ProductivityQuery {
  return {
    from,
    to,
    toolIds,
    developerIds: [],
    repos: [],
    scope: 'org',
    viewBucket,
    metricIds: ['ide.ai_suggestions_accepted'],
  }
}

describe('CR-X P0: Time Series canonical period contract', () => {
  it('All Time Time Series with viewBucket=daily uses adaptive heuristic (starts weekly, retries daily when span ≤ 90d)', async () => {
    const dailyPeriods = dailyIsoDates('2026-08-31', 7) // Aug 31 - Sep 6
    const fetcher = vi.fn(async (period: 'day' | 'week') => {
      // Both weekly and daily return the same daily periods (test fixture).
      // The adaptive heuristic starts weekly, sees span ≤ 90d, retries daily.
      return makeResult({ records: makeRecords(dailyPeriods) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('', '', 'daily'),
      fetcher,
    })

    // CR-X P0-A: All Time + viewBucket=daily does NOT directly request
    // period=day. It falls through to the adaptive heuristic (start weekly,
    // retry daily if span ≤ 90 days) because a direct daily request across
    // the entire historical corpus is pathological.
    expect(result.initialPeriod).toBe('week')
    expect(result.retried).toBe(true)
    expect(result.finalPeriod).toBe('day') // switched to daily because span ≤ 90d
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenNthCalledWith(1, 'week', '', '', undefined, [], [], undefined, undefined)
    expect(fetcher).toHaveBeenNthCalledWith(2, 'day', '', '', undefined, [], [], undefined, undefined)
  })

  it('explicit range with viewBucket=daily requests period=day regardless of span (A)', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week') => {
      return makeResult({ records: makeRecords(dailyIsoDates('2026-01-01', 2)) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-01-01', '2026-06-01', 'daily'),
      fetcher,
    })

    expect(result.finalPeriod).toBe('day')
    expect(result.initialPeriod).toBe('day')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenNthCalledWith(1, 'day', '2026-01-01', '2026-06-01', undefined, [], [], undefined, undefined)
  })

  it('viewBucket=daily includes current partial-week day through latest evidence (C)', async () => {
    const dailyPeriods = dailyIsoDates('2026-08-31', 7) // ends Sep 6
    const fetcher = vi.fn(async (_period: 'day' | 'week') => {
      return makeResult({ records: makeRecords(dailyPeriods) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('', '', 'daily'),
      fetcher,
    })

    expect(result.finalPeriod).toBe('day')
    expect(result.populatedBucketCount).toBe(7)
    const populated = new Set(result.telemetryResult.records.map(r => r.period))
    expect(populated.has('2026-09-06')).toBe(true)
    expect(populated.has('2026-08-31')).toBe(true)
  })

  it('non-daily viewBucket keeps adaptive behavior for other consumers', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week') => {
      return makeResult({ records: makeRecords(['2026-08-31']) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-08-31', '2026-09-06', 'weekly'),
      fetcher,
    })

    expect(result.finalPeriod).toBe('day') // keeps existing ≤90-day adaptive behavior
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
