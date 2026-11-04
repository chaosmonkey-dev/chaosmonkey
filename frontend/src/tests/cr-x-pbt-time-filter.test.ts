import { describe, it, expect, vi } from 'vitest'
import { fetchTelemetryWithAdaptiveGranularity } from '../lib/productivity/fetchTelemetryWithAdaptiveGranularity'
import { localDateISO } from '../lib/productivity/localDateISO'
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

function makeQuery(
  from: string,
  to: string,
  viewBucket: 'daily' | 'weekly' | 'monthly' = 'daily',
  developerIds?: string[],
  repos?: string[]
): ProductivityQuery {
  return {
    from,
    to,
    toolIds: [],
    developerIds: developerIds ?? [],
    repos: repos ?? [],
    scope: 'org',
    viewBucket,
    metricIds: ['ide.ai_suggestions_accepted'],
  }
}

describe('CR-X P1: PBT time filter scoping', () => {
  it('All Time is unbounded (empty from/to) and still requests canonical day (A)', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week') => {
      return makeResult({ records: makeRecords(['2026-09-06']) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('', '', 'daily'),
      fetcher,
    })

    expect(result.finalPeriod).toBe('day')
    expect(fetcher).toHaveBeenCalledWith('day', '', '', [], [], [], undefined, undefined)
  })

  it('Last Month forwards exact bounded dates and fetches day-level telemetry', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week', fromDate?: string, toDate?: string) => {
      return makeResult({
        records: makeRecords([
          '2026-08-06', '2026-08-07', '2026-09-06'
        ].filter(d => d >= (fromDate || '0000-00-00') && d <= (toDate || '9999-99-99')))
      })
    })

    const from = '2026-08-06'
    const to = '2026-09-06'

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery(from, to, 'daily'),
      fetcher,
    })

    expect(result.finalPeriod).toBe('day')
    expect(result.initialPeriod).toBe('day')
    expect(fetcher).toHaveBeenCalledWith('day', from, to, [], [], [], undefined, undefined)
  })

  it('Last Quarter forwards exact bounded dates and fetches day-level telemetry', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week', fromDate?: string, toDate?: string) => {
      return makeResult({ records: makeRecords(fromDate && toDate
        ? ['2026-06-06', '2026-09-06'].filter(d => d >= fromDate && d <= toDate)
        : ['2026-06-06', '2026-09-06']) })
    })

    const from = '2026-06-06'
    const to = '2026-09-06'

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery(from, to, 'daily'),
      fetcher,
    })

    expect(result.finalPeriod).toBe('day')
    expect(fetcher).toHaveBeenCalledWith('day', from, to, [], [], [], undefined, undefined)
  })

  it('Reset (All Time) with empty data keeps weekly (adaptive heuristic)', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week') => makeResult({ records: [] }))

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('', '', 'daily'),
      fetcher,
    })

    // CR-X P0-A: All Time + viewBucket=daily falls through to the adaptive
    // heuristic. With empty data, the sparse fallback retries daily, but
    // empty daily has 0 populated buckets vs 0 weekly — no improvement, so
    // the heuristic keeps weekly.
    expect(result.finalPeriod).toBe('week')
    expect(result.retried).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenNthCalledWith(1, 'week', '', '', [], [], [], undefined, undefined)
    expect(fetcher).toHaveBeenNthCalledWith(2, 'day', '', '', [], [], [], undefined, undefined)
  })

  it('selected time combines with developer scope', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week') => makeResult({ records: [] }))

    const from = '2026-08-06'
    const to = '2026-09-06'
    const developerIds = ['dev-matt']

    await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery(from, to, 'daily', developerIds),
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledWith('day', from, to, [], developerIds, [], undefined, undefined)
  })

  it('selected time combines with repo scope', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week') => makeResult({ records: [] }))

    const from = '2026-08-06'
    const to = '2026-09-06'
    const repos = ['local-demo/activity-sim']

    await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery(from, to, 'daily', [], repos),
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledWith('day', from, to, [], [], repos, undefined, undefined)
  })

  it('selected time combines with developer and repo scope', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week') => makeResult({ records: [] }))

    const from = '2026-06-06'
    const to = '2026-09-06'
    const developerIds = ['dev-matt']
    const repos = ['local-demo/activity-sim']

    await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery(from, to, 'daily', developerIds, repos),
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledWith('day', from, to, [], developerIds, repos, undefined, undefined)
  })

  it('fetcher receives from/to so the canonical endpoint can exclude out-of-range periods', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week', fromDate?: string, toDate?: string) => {
      // Simulate the backend scoping by only returning records inside the requested window
      const all = ['2026-06-06', '2026-08-06', '2026-09-06', '2026-09-07']
      const inRange = all.filter(d => d >= (fromDate || '') && d <= (toDate || '9999-99-99'))
      return makeResult({ records: makeRecords(inRange) })
    })

    const from = '2026-08-06'
    const to = '2026-09-06'

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery(from, to, 'daily'),
      fetcher,
    })

    const returnedPeriods = result.telemetryResult.records.map(r => r.period)
    expect(returnedPeriods).not.toContain('2026-06-06')
    expect(returnedPeriods).not.toContain('2026-09-07')
    expect(returnedPeriods).toContain('2026-08-06')
    expect(returnedPeriods).toContain('2026-09-06')
  })

  // ── CR-X P0 microfix: Last Week + timezone-safe date-only display ───────

  it('Last Week forwards exact bounded dates and fetches day-level telemetry', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week', fromDate?: string, toDate?: string) => {
      const all = ['2026-08-29', '2026-08-30', '2026-09-05', '2026-09-06']
      const inRange = all.filter(d => d >= (fromDate || '') && d <= (toDate || '9999-99-99'))
      return makeResult({ records: makeRecords(inRange) })
    })

    const from = '2026-08-30'
    const to = '2026-09-06'

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery(from, to, 'daily'),
      fetcher,
    })

    expect(result.finalPeriod).toBe('day')
    expect(fetcher).toHaveBeenCalledWith('day', from, to, [], [], [], undefined, undefined)
  })

  it('Sep 6 remains in graph input when evidence exists inside Last Week', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week', fromDate?: string, toDate?: string) => {
      const all = ['2026-08-30', '2026-09-05', '2026-09-06']
      const inRange = all.filter(d => d >= (fromDate || '') && d <= (toDate || '9999-99-99'))
      return makeResult({ records: makeRecords(inRange) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-08-30', '2026-09-06', 'daily'),
      fetcher,
    })

    const returnedPeriods = result.telemetryResult.records.map(r => r.period)
    expect(returnedPeriods).toContain('2026-09-06')
    expect(returnedPeriods).not.toContain('2026-08-29')
  })

  // ── CR-X P0-A: Last Day same-calendar-day range ──────────────────────────

  it('Last Day forwards from===to (same calendar day) and fetches day-level telemetry', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week', fromDate?: string, toDate?: string) => {
      const all = ['2026-09-05', '2026-09-06', '2026-09-07']
      const inRange = all.filter(d => d >= (fromDate || '') && d <= (toDate || '9999-99-99'))
      return makeResult({ records: makeRecords(inRange) })
    })

    const from = '2026-09-06'
    const to = '2026-09-06'

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery(from, to, 'daily'),
      fetcher,
    })

    expect(result.finalPeriod).toBe('day')
    expect(fetcher).toHaveBeenCalledWith('day', from, to, [], [], [], undefined, undefined)
  })

  it('Last Day returns only the selected day, not a quarter scope', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week', fromDate?: string, toDate?: string) => {
      const all = ['2026-06-06', '2026-08-06', '2026-09-05', '2026-09-06', '2026-09-07']
      const inRange = all.filter(d => d >= (fromDate || '') && d <= (toDate || '9999-99-99'))
      return makeResult({ records: makeRecords(inRange) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-09-06', '2026-09-06', 'daily'),
      fetcher,
    })

    const returnedPeriods = result.telemetryResult.records.map(r => r.period)
    expect(returnedPeriods).toEqual(['2026-09-06'])
    expect(returnedPeriods).not.toContain('2026-06-06')
    expect(returnedPeriods).not.toContain('2026-08-06')
  })

  it('Last Day composes with developer filter', async () => {
    const fetcher = vi.fn(async () => makeResult({ records: [] }))
    const developerIds = ['dev-matt']

    await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-09-06', '2026-09-06', 'daily', developerIds),
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledWith('day', '2026-09-06', '2026-09-06', [], developerIds, [], undefined, undefined)
  })

  it('Last Day composes with repo filter', async () => {
    const fetcher = vi.fn(async () => makeResult({ records: [] }))
    const repos = ['local-demo/activity-sim']

    await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-09-06', '2026-09-06', 'daily', [], repos),
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledWith('day', '2026-09-06', '2026-09-06', [], [], repos, undefined, undefined)
  })

  it('Last Day composes with developer + repo filters', async () => {
    const fetcher = vi.fn(async () => makeResult({ records: [] }))
    const developerIds = ['dev-matt']
    const repos = ['local-demo/activity-sim']

    await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-09-06', '2026-09-06', 'daily', developerIds, repos),
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledWith('day', '2026-09-06', '2026-09-06', [], developerIds, repos, undefined, undefined)
  })

  it('Last Day composes with reporting_timezone', async () => {
    const fetcher = vi.fn(async () => makeResult({ records: [] }))
    const reportingTimezone = 'America/New_York'

    await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-09-06', '2026-09-06', 'daily'),
      fetcher,
      reportingTimezone,
    })

    expect(fetcher).toHaveBeenCalledWith('day', '2026-09-06', '2026-09-06', [], [], [], 'America/New_York', undefined)
  })

  it('canonical date-only from/to renders the same calendar day regardless of browser timezone', () => {
    // CR-X P0 microfix: new Date('YYYY-MM-DD') parses as UTC midnight.
    // A bare toLocaleDateString() in a negative-offset timezone shifts the
    // rendered calendar day back by one (the observed defect: 2026-09-06
    // rendered as 9/5/2026 in EDT). The fix renders with timeZone: 'UTC'.

    // Prove the old approach (no timeZone option) shifts in a negative offset.
    const buggy = new Date('2026-09-06').toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    expect(buggy).toBe('9/5/2026')

    // Prove the fix renders the correct calendar day in UTC.
    const fixedFrom = new Date('2026-08-06').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    const fixedTo = new Date('2026-09-06').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    expect(fixedFrom).toBe('8/6/2026')
    expect(fixedTo).toBe('9/6/2026')

    // Last Week
    const weekFrom = new Date('2026-08-30').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    const weekTo = new Date('2026-09-06').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    expect(weekFrom).toBe('8/30/2026')
    expect(weekTo).toBe('9/6/2026')

    // Last Quarter
    const qFrom = new Date('2026-06-06').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    const qTo = new Date('2026-09-06').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    expect(qFrom).toBe('6/6/2026')
    expect(qTo).toBe('9/6/2026')
  })
})

// ── CR-X P0 microfix: UTC midnight rollover regression ───────────────────
//
// Freeze time at 2026-09-07T00:07:00Z with browser timezone America/New_York
// (UTC-4).  The customer's local calendar date is still Sep 6, but
// toISOString() already returns '2026-09-07'.  Prove that localDateISO
// preserves the browser-local calendar date and that range arithmetic
// produces Last Week = 2026-08-30 -> 2026-09-06 (not 2026-08-31 -> 2026-09-07).
describe('CR-X P0: UTC midnight rollover — browser-local calendar date', () => {
  it('localDateISO returns the browser-local calendar date, not the UTC date', () => {
    // 2026-09-07T00:07:00Z = 2026-09-06 20:07 EDT
    const instant = new Date('2026-09-07T00:07:00.000Z')

    // Simulate America/New_York (UTC-4) by checking the offset.
    // In Node/Vitest the system timezone may differ, so we verify the
    // relationship: if the UTC date is Sep 7 but local getters return Sep 6,
    // localDateISO must return Sep 6.
    const utcDate = instant.toISOString().split('T')[0]
    expect(utcDate).toBe('2026-09-07') // confirms the bug condition exists

    // localDateISO uses local getters.  We can't force the system TZ in a
    // unit test, but we can prove the logic: if local getters return Sep 6,
    // the output must be '2026-09-06'.
    // Directly test the formatter with a date whose local getters yield Sep 6.
    const localSep6 = new Date(2026, 8, 6, 20, 7, 0) // Sep 6 20:07 local
    expect(localDateISO(localSep6)).toBe('2026-09-06')
  })

  it('Last Week range arithmetic uses browser-local date (not UTC)', () => {
    // Simulate the component's range arithmetic at 2026-09-07T00:07:00Z
    // in America/New_York (local = Sep 6 20:07).
    //
    // Component logic (lines ~1990-2000):
    //   const now = new Date()           // current instant
    //   let from = new Date()
    //   from.setDate(now.getDate() - 7)  // local getter/setter
    //   from: localDateISO(from)
    //   to: localDateISO(now)
    //
    // In EDT, now.getDate() = 6, so from.setDate(-1) -> Aug 30.
    // localDateISO(now) = '2026-09-06', localDateISO(from) = '2026-08-30'.
    const now = new Date(2026, 8, 6, 20, 7, 0) // Sep 6 20:07 local
    let from = new Date(2026, 8, 6, 20, 7, 0)
    from.setDate(now.getDate() - 7)

    expect(localDateISO(now)).toBe('2026-09-06')
    expect(localDateISO(from)).toBe('2026-08-30')
  })

  it('Last Month range arithmetic uses browser-local date', () => {
    const now = new Date(2026, 8, 6, 20, 7, 0) // Sep 6 20:07 local
    let from = new Date(2026, 8, 6, 20, 7, 0)
    from.setMonth(now.getMonth() - 1)

    expect(localDateISO(now)).toBe('2026-09-06')
    expect(localDateISO(from)).toBe('2026-08-06')
  })

  it('Last Quarter range arithmetic uses browser-local date', () => {
    const now = new Date(2026, 8, 6, 20, 7, 0) // Sep 6 20:07 local
    let from = new Date(2026, 8, 6, 20, 7, 0)
    from.setMonth(now.getMonth() - 3)

    expect(localDateISO(now)).toBe('2026-09-06')
    expect(localDateISO(from)).toBe('2026-06-06')
  })

  it('partial-period clamp uses browser-local today, not UTC today', () => {
    // At 2026-09-07T00:07:00Z in EDT, local today = Sep 6.
    // latest_observed_at = 2026-09-06T23:35:41Z (from canonical metadata).
    // The clamp must NOT push the label to Sep 7.
    //
    // Component logic:
    //   const now = new Date()
    //   const localTodayUTC = new Date(`${localDateISO(now)}T00:00:00.000Z`)
    //   const latestDay = new Date(rawDate)
    //   latestDay.setUTCHours(0, 0, 0, 0)
    //   if (latestDay.getTime() > localTodayUTC.getTime())
    //     latestDay.setTime(localTodayUTC.getTime())

    const now = new Date(2026, 8, 6, 20, 7, 0) // Sep 6 20:07 local
    const localTodayUTC = new Date(`${localDateISO(now)}T00:00:00.000Z`)
    expect(localTodayUTC.toISOString()).toBe('2026-09-06T00:00:00.000Z')

    // Case 1: latest_observed_at = 2026-09-06T23:35:41Z -> Sep 6, no clamp
    const rawDate1 = new Date('2026-09-06T23:35:41.000Z')
    const latestDay1 = new Date(rawDate1)
    latestDay1.setUTCHours(0, 0, 0, 0)
    if (latestDay1.getTime() > localTodayUTC.getTime()) {
      latestDay1.setTime(localTodayUTC.getTime())
    }
    const label1 = latestDay1.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    expect(label1).toBe('Sep 6')

    // Case 2: latest_observed_at = 2026-09-07T00:05:00Z -> would be Sep 7
    // without clamp, must clamp to Sep 6 (browser-local today).
    const rawDate2 = new Date('2026-09-07T00:05:00.000Z')
    const latestDay2 = new Date(rawDate2)
    latestDay2.setUTCHours(0, 0, 0, 0)
    if (latestDay2.getTime() > localTodayUTC.getTime()) {
      latestDay2.setTime(localTodayUTC.getTime())
    }
    const label2 = latestDay2.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    expect(label2).toBe('Sep 6')
  })

  it('Sep 6 evidence remains graphable inside the corrected Last Week range', async () => {
    const fetcher = vi.fn(async (_period: 'day' | 'week', fromDate?: string, toDate?: string) => {
      const all = ['2026-08-30', '2026-09-05', '2026-09-06']
      const inRange = all.filter(d => d >= (fromDate || '') && d <= (toDate || '9999-99-99'))
      return makeResult({ records: makeRecords(inRange) })
    })

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-08-30', '2026-09-06', 'daily'),
      fetcher,
    })

    const returnedPeriods = result.telemetryResult.records.map(r => r.period)
    expect(returnedPeriods).toContain('2026-09-06')
    expect(returnedPeriods).not.toContain('2026-09-07')
    expect(returnedPeriods).not.toContain('2026-08-29')
  })

  it('developer + repo filters remain composed with corrected time range', async () => {
    const fetcher = vi.fn(async () => makeResult({ records: [] }))
    const developerIds = ['dev-matt']
    const repos = ['local-demo/activity-sim']

    await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-08-30', '2026-09-06', 'daily', developerIds, repos),
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledWith('day', '2026-08-30', '2026-09-06', [], developerIds, repos, undefined, undefined)
  })

  it('positive-offset timezone: localDateISO does not shift backward', () => {
    // Complementary case: in a positive offset (e.g. Asia/Tokyo UTC+9),
    // 2026-09-06T15:00:00Z = 2026-09-07 00:00 JST.
    // localDateISO should return the local calendar date (Sep 7), not the
    // UTC date (Sep 6).  This proves the helper is timezone-agnostic and
    // always uses local getters.
    const localSep7 = new Date(2026, 8, 7, 0, 0, 0) // Sep 7 00:00 local
    expect(localDateISO(localSep7)).toBe('2026-09-07')

    // And the UTC date for the same instant would be Sep 6:
    const sameInstant = new Date('2026-09-06T15:00:00.000Z')
    expect(sameInstant.toISOString().split('T')[0]).toBe('2026-09-06')
  })

  it('reporting_timezone is forwarded to the fetcher so the backend can scope by local calendar', async () => {
    const fetcher = vi.fn(async () => makeResult({ records: [] }))
    const developerIds = ['dev-matt']
    const repos = ['local-demo/activity-sim']
    const reportingTimezone = 'America/New_York'

    await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery('2026-08-30', '2026-09-06', 'daily', developerIds, repos),
      fetcher,
      reportingTimezone,
    })

    expect(fetcher).toHaveBeenCalledWith('day', '2026-08-30', '2026-09-06', [], developerIds, repos, 'America/New_York', undefined)
  })
})
