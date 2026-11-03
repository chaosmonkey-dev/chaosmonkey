/**
 * Adaptive granularity orchestration for PBT Time Series.
 *
 * Resolution doctrine (Auto):
 *   - Observed window ≤ 90 days → daily
 *   - Observed window > 90 days → weekly
 *
 * For All-Time (from='' / to=''):
 *   1. Make an initial canonical request with period=week.
 *   2. Measure the observed window span from populated weekly buckets.
 *      Also count populated buckets as a fallback signal.
 *   3. If the observed span is ≤ 90 days (or there are very few weekly
 *      buckets), retry with period=day.
 *   4. Use daily only if it has at least as many populated buckets as
 *      weekly (never switch to a sparser resolution).
 *   5. Return the final selected telemetry result.
 *
 * For explicit ranges:
 *   - ≤ 90 days → day
 *   - > 90 days → week
 *
 * No interpolation: days with no evidence are never manufactured. Only
 * buckets returned by the canonical telemetry endpoint are rendered.
 *
 * Filter parameters (from, to, toolIds, developerIds, repos) are passed
 * unchanged to every fetcher call.
 */

import type { UnifiedTelemetryResult } from '../adapters/telemetryToUnified'
import type { ProductivityQuery } from '../../types/metrics'

export type TelemetryFetcher = (
  period: 'day' | 'week',
  fromDate?: string,
  toDate?: string,
  toolIds?: string[],
  developerIds?: string[],
  repos?: string[],
  reportingTimezone?: string,
  signal?: AbortSignal
) => Promise<UnifiedTelemetryResult>

export type AdaptiveGranularityResult = {
  telemetryResult: UnifiedTelemetryResult
  initialPeriod: 'day' | 'week'
  finalPeriod: 'day' | 'week'
  retried: boolean
  populatedBucketCount: number
  observedSpanDays: number | null
}

const EXCLUDED_WORKFLOWS = new Set(['unknown', 'test-browser'])
// Observed windows at or below this span default to daily resolution.
const DAILY_SPAN_THRESHOLD_DAYS = 90
// Fallback: if weekly produces very few populated buckets, try daily
// regardless of span (handles short or sparse all-time windows).
const ALL_TIME_SPARSE_BUCKET_THRESHOLD = 6

function isAllTime(from: string, to: string): boolean {
  return !from || !to
}

function explicitRangePeriod(from: string, to: string): 'day' | 'week' {
  try {
    const fromDate = new Date(from)
    const toDate = new Date(to)
    const daysDiff = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDiff <= DAILY_SPAN_THRESHOLD_DAYS) return 'day'
    return 'week'
  } catch {
    return 'week'
  }
}

/**
 * Collect the set of populated period strings from unified telemetry records.
 *
 * A bucket counts only when:
 *   - it has a valid period/timestamp;
 *   - it belongs to a real workflow (not unknown, not test-browser);
 *   - its real session population (sessionCount) is positive.
 */
function collectPopulatedPeriods(records: UnifiedTelemetryResult['records']): Set<string> {
  const populatedPeriods = new Set<string>()
  for (const record of records) {
    if (!record.period) continue
    if (EXCLUDED_WORKFLOWS.has(record.tool)) continue
    if ((record.sessionCount || 0) <= 0) continue
    populatedPeriods.add(record.period)
  }
  return populatedPeriods
}

function countPopulatedBuckets(records: UnifiedTelemetryResult['records']): number {
  return collectPopulatedPeriods(records).size
}

/**
 * Parse a period string to a timestamp (ms since epoch).
 *
 * Supports two backend period formats:
 *   - Daily:  `YYYY-MM-DD`  (e.g. "2026-08-30") — parseable by Date.parse
 *   - Weekly: `YYYY-Www`    (e.g. "2026-35")    — ISO 8601 week date, NOT
 *     parseable by Date.parse on most engines. Converted to the Monday of
 *     that ISO week.
 *
 * Returns NaN for unparseable strings.
 */
function periodToTimestamp(period: string): number {
  // Try direct parse first (handles YYYY-MM-DD).
  const direct = Date.parse(period)
  if (Number.isFinite(direct)) return direct

  // Try backend weekly format: YYYY-NN (e.g. "2026-35" = ISO year 2026, week 35).
  // The backend returns week numbers WITHOUT a "W" prefix — just "YYYY-NN".
  // This matches the same regex used by normalizePeriodToISO in metricsFacade.ts.
  // Daily format YYYY-MM-DD (10 chars) does not match this 7-char pattern.
  const weekMatch = period.match(/^(\d{4})-(\d{2})$/)
  if (weekMatch) {
    const year = parseInt(weekMatch[1], 10)
    const week = parseInt(weekMatch[2], 10)
    if (week < 1 || week > 53) return NaN

    // ISO week 1 contains the first Thursday of the year.
    // Jan 4th is always in week 1. Find the Monday of week 1.
    const jan4 = new Date(Date.UTC(year, 0, 4))
    const jan4Day = jan4.getUTCDay() // 0=Sun ... 6=Sat
    const week1MondayMs = jan4.getTime() - (jan4Day === 0 ? 6 : jan4Day - 1) * 86400000

    // Monday of the target week = week 1 Monday + (week-1)*7 days
    return week1MondayMs + (week - 1) * 7 * 86400000
  }

  return NaN
}

/**
 * Measure the observed window span (in days) from populated period strings.
 *
 * Period strings may be `YYYY-MM-DD` (daily) or `YYYY-Www` (weekly ISO week).
 * Both are converted to timestamps via `periodToTimestamp`. Returns null when
 * no valid periods exist.
 */
function observedSpanDays(periods: Set<string>): number | null {
  let minMs = Infinity
  let maxMs = -Infinity
  for (const period of periods) {
    const t = periodToTimestamp(period)
    if (!Number.isFinite(t)) continue
    if (t < minMs) minMs = t
    if (t > maxMs) maxMs = t
  }
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return null
  return Math.round((maxMs - minMs) / (1000 * 60 * 60 * 24))
}

export async function fetchTelemetryWithAdaptiveGranularity(
  params: { query: ProductivityQuery; fetcher: TelemetryFetcher; reportingTimezone?: string; signal?: AbortSignal }
): Promise<AdaptiveGranularityResult> {
  const { query, fetcher, reportingTimezone, signal } = params
  const { from, to, viewBucket, toolIds, developerIds, repos } = query

  // CR-X P0-A: Time Series is explicit visualization intent, but an all-time
  // daily request across the entire historical corpus is pathological — it
  // generates hundreds of daily buckets and times out. When viewBucket=daily
  // is requested for an all-time range, fall through to the adaptive
  // heuristic below (start weekly, retry daily only if span ≤ 90 days).
  // For explicit short ranges with viewBucket=daily, keep period=day.
  if ((viewBucket === 'daily' || viewBucket === 'day') && !isAllTime(from, to)) {
    const finalPeriod: 'day' | 'week' = 'day'
    const result = await fetcher(finalPeriod, from, to, toolIds, developerIds, repos, reportingTimezone, signal)
    const resultPeriods = collectPopulatedPeriods(result.records)
    return {
      telemetryResult: result,
      initialPeriod: finalPeriod,
      finalPeriod,
      retried: false,
      populatedBucketCount: resultPeriods.size,
      observedSpanDays: observedSpanDays(resultPeriods),
    }
  }

  // Non-daily view buckets keep the existing adaptive heuristic so other
  // consumers (e.g. short-range cards) remain unchanged.

  if (isAllTime(from, to)) {
    const initialPeriod: 'day' | 'week' = 'week'
    const weeklyResult = await fetcher(initialPeriod, from, to, toolIds, developerIds, repos, reportingTimezone, signal)
    const weeklyPeriods = collectPopulatedPeriods(weeklyResult.records)
    const populatedBucketCount = weeklyPeriods.size
    const spanDays = observedSpanDays(weeklyPeriods)

    // Decide whether to retry with daily:
    //   - observed span ≤ 90 days (the primary daily-resolution trigger), OR
    //   - very few weekly buckets (sparse fallback for short/sparse windows).
    const spanFavorsDaily = spanDays !== null && spanDays <= DAILY_SPAN_THRESHOLD_DAYS
    const sparseFallback = populatedBucketCount < ALL_TIME_SPARSE_BUCKET_THRESHOLD

    if (spanFavorsDaily || sparseFallback) {
      const dailyResult = await fetcher('day', from, to, toolIds, developerIds, repos, reportingTimezone, signal)
      const dailyPopulatedCount = countPopulatedBuckets(dailyResult.records)

      // Switch to daily when it provides at least as much evidence as weekly.
      // When the observed span favors daily (≤ 90d), prefer the finer
      // resolution at equal bucket count. When only the sparse fallback
      // triggered (no usable span), require strictly more daily buckets so
      // an empty weekly result is not swapped for an equally empty daily one.
      const switchToDaily = spanFavorsDaily
        ? dailyPopulatedCount >= populatedBucketCount
        : dailyPopulatedCount > populatedBucketCount

      if (switchToDaily) {
        return {
          telemetryResult: dailyResult,
          initialPeriod: 'week',
          finalPeriod: 'day',
          retried: true,
          populatedBucketCount: dailyPopulatedCount,
          observedSpanDays: spanDays,
        }
      }

      // Weekly has more data — keep it
      return {
        telemetryResult: weeklyResult,
        initialPeriod: 'week',
        finalPeriod: 'week',
        retried: true,
        populatedBucketCount,
        observedSpanDays: spanDays,
      }
    }

    return {
      telemetryResult: weeklyResult,
      initialPeriod: 'week',
      finalPeriod: 'week',
      retried: false,
      populatedBucketCount,
      observedSpanDays: spanDays,
    }
  }

  const period = explicitRangePeriod(from, to)
  const result = await fetcher(period, from, to, toolIds, developerIds, repos, reportingTimezone, signal)
  const resultPeriods = collectPopulatedPeriods(result.records)
  return {
    telemetryResult: result,
    initialPeriod: period,
    finalPeriod: period,
    retried: false,
    populatedBucketCount: resultPeriods.size,
    observedSpanDays: observedSpanDays(resultPeriods),
  }
}
