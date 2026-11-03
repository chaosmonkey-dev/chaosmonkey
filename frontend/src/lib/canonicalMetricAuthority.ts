/**
 * Canonical Metric Authority
 *
 * Single production helper for computing weighted metric values from
 * canonical aggregated telemetry rows. Used by both AIOI and PBT to
 * guarantee identical output for the same metric.
 *
 * Contract:
 * - Weighted average uses session_count as weight
 * - Rows with non-finite metric values are excluded (never dilute denominator)
 * - Returns null when no eligible rows exist
 * - Provenance tracks source and eligibility
 */

import { normalizeToCanonicalToolId } from './workflowIdentity'

export interface CanonicalRow {
  tool?: string
  session_count?: number
  average_session_length_minutes?: number
  total_session_minutes?: number
  active_coding_time_minutes?: number
  ai_usage_duration_minutes?: number
  time_to_first_commit_minutes?: number
  ai_suggestions_accepted?: number
  commits_per_session?: number
  idle_time_minutes?: number
  focus_ratio?: number
  [key: string]: unknown
}

export type MetricField =
  | 'active_coding_time_minutes'
  | 'average_session_length_minutes'
  | 'ai_usage_duration_minutes'
  | 'time_to_first_commit_minutes'
  | 'ai_suggestions_accepted'
  | 'commits_per_session'
  | 'idle_time_minutes'
  | 'focus_ratio'
  | 'total_session_minutes'

export interface MetricResult {
  /** Session-weighted average value, or null if no eligible rows */
  weightedValue: number | null
  /** Sum of metric across all eligible rows */
  totalValue: number | null
  /** Count of rows with finite values for this metric */
  eligibleSamples: number
  /** Count of rows excluded (non-finite or missing) */
  excludedSamples: number
  /** Total session_count across eligible rows */
  eligibleSessions: number
  /** Total session_count across all rows for this tool */
  totalSessions: number
  /** Coverage ratio: eligibleSessions / totalSessions (0-1) */
  coverage: number
  /** Data provenance */
  provenance: 'canonical_aggregated'
  /** Tool ID after canonical normalization */
  toolId: string
}

const EXCLUDED_TOOL_IDS = new Set([
  'unknown',
  'extension',
  'test_browser',
  'test-browser',
  'testbrowser',
])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Compute a session-weighted metric for a single tool from canonical rows.
 *
 * @param rows All canonical aggregated rows (all periods, all tools)
 * @param toolId Raw or canonical tool ID to filter by
 * @param field Metric field to compute
 * @returns MetricResult with weighted value, samples, coverage, provenance
 */
export function computeWeightedMetric(
  rows: CanonicalRow[] | undefined | null,
  toolId: string,
  field: MetricField
): MetricResult {
  const canonicalToolId = normalizeToCanonicalToolId(toolId)
  const toolRows = (Array.isArray(rows) ? rows : []).filter(
    (row) => normalizeToCanonicalToolId(String(row?.tool ?? '')) === canonicalToolId
  )

  let numerator = 0
  let denominator = 0
  let totalValue = 0
  let eligibleSamples = 0
  let excludedSamples = 0
  let eligibleSessions = 0
  let totalSessions = 0

  for (const row of toolRows) {
    const sessionCount = Number(row?.session_count)
    const weight = isFiniteNumber(sessionCount) && sessionCount > 0 ? sessionCount : 0
    totalSessions += weight

    const rawValue = (row as Record<string, unknown>)?.[field]
    if (isFiniteNumber(rawValue)) {
      numerator += rawValue * weight
      denominator += weight
      totalValue += rawValue
      eligibleSamples++
      eligibleSessions += weight
    } else {
      excludedSamples++
    }
  }

  return {
    weightedValue: denominator > 0 ? numerator / denominator : null,
    totalValue: eligibleSamples > 0 ? totalValue : null,
    eligibleSamples,
    excludedSamples,
    eligibleSessions,
    totalSessions,
    coverage: totalSessions > 0 ? eligibleSessions / totalSessions : 0,
    provenance: 'canonical_aggregated',
    toolId: canonicalToolId,
  }
}

/**
 * Compute session-weighted metrics for all tools in one pass.
 *
 * @param rows All canonical aggregated rows
 * @param field Metric field to compute
 * @returns Map of canonical tool ID → MetricResult
 */
export function computeWeightedMetricByTool(
  rows: CanonicalRow[] | undefined | null,
  field: MetricField
): Map<string, MetricResult> {
  const results = new Map<string, MetricResult>()
  const safeRows = Array.isArray(rows) ? rows : []

  const toolIds = new Set<string>()
  for (const row of safeRows) {
    const id = normalizeToCanonicalToolId(String(row?.tool ?? ''))
    if (id && !EXCLUDED_TOOL_IDS.has(id)) toolIds.add(id)
  }

  for (const toolId of toolIds) {
    results.set(toolId, computeWeightedMetric(safeRows, toolId, field))
  }

  return results
}

/**
 * Compute a derived ratio metric (e.g., aiUsageRatio = ai_usage_duration / total_session)
 * using session-weighted averages of the numerator and denominator.
 *
 * This avoids the pitfall of averaging per-period ratios directly.
 */
export function computeDerivedRatioMetric(
  rows: CanonicalRow[] | undefined | null,
  toolId: string,
  numeratorField: MetricField,
  denominatorField: MetricField
): MetricResult {
  const canonicalToolId = normalizeToCanonicalToolId(toolId)
  const toolRows = (Array.isArray(rows) ? rows : []).filter(
    (row) => normalizeToCanonicalToolId(String(row?.tool ?? '')) === canonicalToolId
  )

  let weightedNumerator = 0
  let weightedDenominator = 0
  let eligibleSamples = 0
  let excludedSamples = 0
  let eligibleSessions = 0
  let totalSessions = 0

  for (const row of toolRows) {
    const sessionCount = Number(row?.session_count)
    const weight = isFiniteNumber(sessionCount) && sessionCount > 0 ? sessionCount : 0
    totalSessions += weight

    const num = (row as Record<string, unknown>)?.[numeratorField]
    const den = (row as Record<string, unknown>)?.[denominatorField]

    if (isFiniteNumber(num) && isFiniteNumber(den) && den > 0) {
      weightedNumerator += num * weight
      weightedDenominator += den * weight
      eligibleSamples++
      eligibleSessions += weight
    } else {
      excludedSamples++
    }
  }

  return {
    weightedValue: weightedDenominator > 0 ? weightedNumerator / weightedDenominator : null,
    totalValue: null,
    eligibleSamples,
    excludedSamples,
    eligibleSessions,
    totalSessions,
    coverage: totalSessions > 0 ? eligibleSessions / totalSessions : 0,
    provenance: 'canonical_aggregated',
    toolId: canonicalToolId,
  }
}
