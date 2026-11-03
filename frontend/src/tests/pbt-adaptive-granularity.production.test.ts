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

// Generate N weekly ISO week dates (YYYY-Www format) — matches backend format.
function weeklyIsoWeekLabels(startDate: string, count: number): string[] {
  const start = new Date(startDate + 'T00:00:00Z')
  const labels: string[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getTime() + i * 7 * 86400000)
    // ISO week number calculation
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    const dayNum = (tmp.getUTCDay() + 6) % 7
    tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3)
    const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4))
    const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3)
    const weekNum = 1 + Math.round((tmp.getTime() - firstThursday.getTime()) / (7 * 86400000))
    const year = tmp.getUTCFullYear()
    labels.push(`${year}-${String(weekNum).padStart(2, '0')}`)
  }
  return labels
}

// Generate N daily ISO dates beginning at `startDate`, 1 day apart.
function dailyIsoDates(startDate: string, count: number): string[] {
  const start = new Date(startDate + 'T00:00:00Z').getTime()
  const dayMs = 24 * 60 * 60 * 1000
  return Array.from({ length: count }, (_, i) => new Date(start + i * dayMs).toISOString().split('T')[0])
}

describe('PBT adaptive telemetry granularity', () => {
  const makeQuery = (from: string, to: string, toolIds?: string[]): ProductivityQuery =>
    ({
      from,
      to,
      toolIds,
      developerIds: [],
      repos: [],
      scope: 'org',
      viewBucket: 'auto',
      metricIds: ['ide.ai_suggestions_accepted'],
    } as ProductivityQuery)

  it('all-time with sparse data falls back from weekly to daily', async () => {
    const weeklyPeriods = weeklyIsoWeekLabels('2026-01-05', 3) // 3 weekly buckets, ~14d span
    const dailyPeriods = dailyIsoDates('2026-01-05', 21) // 21 daily buckets
    const fetcher = vi.fn(async (period: 'day' | 'week') => {
      return makeResult({
        records: period === 'week' ? makeRecords(weeklyPeriods) : makeRecords(dailyPeriods),
      })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('', ''),
      fetcher,
    })

    expect(result.initialPeriod).toBe('week')
    expect(result.retried).toBe(true)
    expect(result.finalPeriod).toBe('day')
    expect(result.populatedBucketCount).toBe(21)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenNthCalledWith(1, 'week', '', '', undefined, [], [], undefined, undefined)
    expect(fetcher).toHaveBeenNthCalledWith(2, 'day', '', '', undefined, [], [], undefined, undefined)
  })

  it('all-time observed window ≤ 90 days switches to daily (Ed 60-day case)', async () => {
    // ~9 weekly buckets over ~60 days — the exact Ed scenario that was stuck on weekly.
    const weeklyPeriods = weeklyIsoWeekLabels('2026-06-30', 9) // 9 weekly buckets, ~56d span
    const dailyPeriods = dailyIsoDates('2026-06-30', 57) // ~57 daily buckets
    const fetcher = vi.fn(async (period: 'day' | 'week') => {
      return makeResult({
        records: period === 'week' ? makeRecords(weeklyPeriods) : makeRecords(dailyPeriods),
      })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('', ''),
      fetcher,
    })

    expect(result.initialPeriod).toBe('week')
    expect(result.retried).toBe(true)
    expect(result.finalPeriod).toBe('day')
    expect(result.populatedBucketCount).toBe(57)
    expect(result.observedSpanDays).toBeLessThanOrEqual(90)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('all-time observed window > 90 days stays on weekly', async () => {
    // 16 weekly buckets over ~105 days — exceeds the 90-day daily threshold.
    const weeklyPeriods = weeklyIsoWeekLabels('2026-01-05', 16) // ~105d span
    const fetcher = vi.fn(async (_period: 'day' | 'week') => {
      return makeResult({ records: makeRecords(weeklyPeriods) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('', ''),
      fetcher,
    })

    expect(result.initialPeriod).toBe('week')
    expect(result.retried).toBe(false)
    expect(result.finalPeriod).toBe('week')
    expect(result.populatedBucketCount).toBe(16)
    expect(result.observedSpanDays).toBeGreaterThan(90)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('explicit range ≤ 90 days uses daily granularity', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week') => {
      return makeResult({ records: makeRecords(dailyIsoDates('2026-01-01', 2)) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-01-01', '2026-01-15'),
      fetcher,
    })

    expect(result.initialPeriod).toBe('day')
    expect(result.retried).toBe(false)
    expect(result.finalPeriod).toBe('day')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenNthCalledWith(1, 'day', '2026-01-01', '2026-01-15', undefined, [], [], undefined, undefined)
  })

  it('explicit range of exactly 90 days uses daily granularity', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week') => {
      return makeResult({ records: makeRecords(dailyIsoDates('2026-01-01', 2)) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-01-01', '2026-04-01'), // 90 days
      fetcher,
    })

    expect(result.finalPeriod).toBe('day')
    expect(fetcher).toHaveBeenNthCalledWith(1, 'day', '2026-01-01', '2026-04-01', undefined, [], [], undefined, undefined)
  })

  it('explicit range > 90 days uses weekly granularity', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week') => {
      return makeResult({ records: makeRecords(weeklyIsoWeekLabels('2026-01-05', 2)) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-01-01', '2026-05-15'), // ~134 days
      fetcher,
    })

    expect(result.initialPeriod).toBe('week')
    expect(result.retried).toBe(false)
    expect(result.finalPeriod).toBe('week')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenNthCalledWith(1, 'week', '2026-01-01', '2026-05-15', undefined, [], [], undefined, undefined)
  })

  it('successful empty response returns empty telemetry without fallback to simulation', async () => {
    const fetcher = vi.fn().mockResolvedValue(makeResult({ records: [] }))

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('', ''),
      fetcher,
    })

    expect(result.telemetryResult.records).toEqual([])
    expect(result.retried).toBe(true)
    expect(result.finalPeriod).toBe('week')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not catch fetcher errors; caller handles API failure instead of simulating', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network failure'))

    await expect(
      fetchTelemetryWithAdaptiveGranularity({
        query: makeQuery('', ''),
        fetcher,
      })
    ).rejects.toThrow('network failure')

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('excludes unknown and test-browser from populated bucket counts', async () => {
    const records = [
      ...makeRecords(['2026-W02'], 'unknown', 1),
      ...makeRecords(['2026-W03'], 'test-browser', 1),
      ...makeRecords(weeklyIsoWeekLabels('2026-01-05', 2), 'vscode', 1),
      // A real tool with a zero/negative session count should not count
      { ...makeRecords(weeklyIsoWeekLabels('2026-01-19', 1), 'claude_code', 0)[0], sessionCount: 0 },
    ]

    const fetcher = vi.fn().mockResolvedValue(makeResult({ records }))

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('', ''),
      fetcher,
    })

    // 2 real vscode weekly buckets over ~7 days → span ≤ 90 → retries daily.
    // Daily fetch returns the same records (mock), 2 populated buckets.
    expect(result.retried).toBe(true)
    expect(result.populatedBucketCount).toBe(2)
  })
})
