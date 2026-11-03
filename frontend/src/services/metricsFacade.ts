/// <reference types="vite/client" />

import type { 
  ProductivityQuery, 
  TSResult, 
  SummaryResult, 
  DataSource,
  APIResponse,
  TimeSeries
} from '../types/metrics'
import { normalizeTrends, normalizeSummary } from '../lib/normalizers/productivity'
import { simulateProductivityTS } from '../lib/simulators/productivity'
import { log, warn, error as logError } from '../utils/logger'
import { fetchAndMapTelemetryToUnified, type UnifiedTelemetryResult } from '../lib/adapters/telemetryToUnified'
import { normalizeToCanonicalToolId, finiteNumberOrNull } from '../lib/workflowIdentity'
import { fetchTelemetryWithAdaptiveGranularity, type TelemetryFetcher } from '../lib/productivity/fetchTelemetryWithAdaptiveGranularity'
import { API_URL } from '../config/api'
import { useMetricsFacadeStore } from '../stores/metricsFacade'
import { isLivePilotMode } from '../lib/insights/runtimeMode'

// Dev-only debug flag for metricsFacade
const METRICS_DEBUG = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_METRICS_DEBUG === 'true'
const IS_DEVELOPMENT = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV === true
const PBT_DEBUG = (import.meta.env.VITE_PBT_DEBUG ?? 'false') === 'true'

/**
 * Deep clone utility to prevent mutation of simulation baseline
 * CRITICAL: This ensures Live mode telemetry merges never pollute Simulation mode data
 */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T
  }
  
  if (obj instanceof Map) {
    const clonedMap = new Map()
    obj.forEach((value, key) => {
      clonedMap.set(deepClone(key), deepClone(value))
    })
    return clonedMap as T
  }
  
  if (obj instanceof Set) {
    const clonedSet = new Set()
    obj.forEach(value => {
      clonedSet.add(deepClone(value))
    })
    return clonedSet as T
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item)) as T
  }
  
  // Plain object
  const clonedObj = {} as T
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      clonedObj[key] = deepClone(obj[key])
    }
  }
  
  return clonedObj
}

// API configuration - using centralized API config
// Default is live for production pilots (non-localhost), sim only in local lab
// mode unless explicitly overridden. This prevents an Ed/EC2 deployment from
// silently falling back to the simulator and showing stale data (e.g., cutting
// off at the last simulation bucket).
export function getDefaultTelemetryMode(env: Record<string, any> = import.meta.env): 'live' | 'sim' {
  if (env.VITE_CM_TELEMETRY_LIVE === 'true' || env.VITE_LIVE_PILOT_MODE === 'true') {
    return 'live'
  }
  return isLivePilotMode() ? 'live' : 'sim'
}

type TelemetryMetricField =
  | 'AI_suggestions_accepted'
  | 'AI_usage_duration_minutes'
  | 'idle_time_minutes'
  | 'active_coding_time_minutes'
  | 'average_session_length_minutes'
  | 'files_edited_per_session'
  | 'commits_per_session'
  | 'time_to_first_commit_minutes'
  | 'active_coding_ratio'
  | 'ai_usage_ratio'
  | 'idle_ratio'
  // CR-X Slice 1: Delivery metrics (from /api/delivery/timeseries)
  | 'merged_pr_count'
  | 'deployment_count'
  | 'deploy_success_rate'
  | 'median_merge_cycle_hours'
  | 'release_count'
  | 'review_count'
  | 'pr_review_cycles'
  | 'merge_rate'

const METRIC_ID_TO_TELEMETRY_FIELD: Record<string, TelemetryMetricField> = {
  'ide.AI_suggestions_accepted': 'AI_suggestions_accepted',
  'ide.ai_suggestions_accepted': 'AI_suggestions_accepted',
  'ide.files_edited_per_session': 'files_edited_per_session',
  'ide.commits_per_session': 'commits_per_session',
  'ide.average_session_length_minutes': 'average_session_length_minutes',
  'ide.time_to_first_commit_minutes': 'time_to_first_commit_minutes',
  'ide.AI_usage_duration_minutes': 'AI_usage_duration_minutes',
  'ide.ai_usage_duration_minutes': 'AI_usage_duration_minutes',
  'ide.idle_time_minutes': 'idle_time_minutes',
  'ide.active_coding_time_minutes': 'active_coding_time_minutes',
  'ide.active_coding_ratio': 'active_coding_ratio',
  'ide.ai_usage_ratio': 'ai_usage_ratio',
  'ide.idle_ratio': 'idle_ratio',
  // CR-X Slice 1: Delivery metrics
  'delivery.merged_pr_count': 'merged_pr_count',
  'delivery.deployment_count': 'deployment_count',
  'delivery.deploy_success_rate': 'deploy_success_rate',
  'delivery.median_merge_cycle_hours': 'median_merge_cycle_hours',
  'delivery.release_count': 'release_count',
  'delivery.review_count': 'review_count',
  'delivery.pr_review_cycles': 'pr_review_cycles',
  'delivery.merge_rate': 'merge_rate',
}

type UnifiedTelemetryRecord = {
  period: string
  tool: string
  developer?: string
  AI_suggestions_accepted: number
  AI_usage_duration_minutes: number
  idle_time_minutes: number
  active_coding_time_minutes: number
  average_session_length_minutes: number
  files_edited_per_session: number
  commits_per_session: number
  time_to_first_commit_minutes: number
  // Derived ratio metrics (computed from base metrics)
  active_coding_ratio: number
  ai_usage_ratio: number
  idle_ratio: number
  // New session metrics derived from real session events (segment_type: "session")
  activeCodingMs: number // Total active coding time in milliseconds from real sessions
  sessionCount: number // Count of real session events (not legacy intervals)
  // Time to First Commit (TTFC) metrics from real session events
  avgTimeToFirstCommitMs?: number | null
  avgTimeToFirstCommitMinutes?: number | null
  // Instrumentation era: 'session' (new session-model telemetry) or 'legacy' (older interval-based)
  instrumentation_era?: 'session' | 'legacy'
  source: 'telemetry'
}

export function resolveTelemetryMode(): 'live' | 'sim' {
  try {
    const store = useMetricsFacadeStore()
    if (store?.telemetryMode === 'live' || store?.telemetryMode === 'sim') {
      return store.telemetryMode
    }
  } catch (err) {
    // No active pinia instance; fall back to env default
  }
  return getDefaultTelemetryMode()
}

function mapViewBucketToPeriod(viewBucket: ProductivityQuery['viewBucket']): 'day' | 'week' {
  // PBT Time Series view bucket maps to canonical aggregated API period.
  // Daily view must request period=day; otherwise the backend returns weekly defaults.
  if (viewBucket === 'daily' || viewBucket === 'day') return 'day'
  return 'week'
}

function resolveTelemetryMetricField(metricId?: string): TelemetryMetricField {
  if (metricId && METRIC_ID_TO_TELEMETRY_FIELD[metricId]) {
    const field = METRIC_ID_TO_TELEMETRY_FIELD[metricId]
    if (METRICS_DEBUG) console.debug('[metricsFacade] resolveTelemetryMetricField', {
      metricId,
      resolvedField: field,
      mappingExists: true
    })
    return field
  }
  
  // Default fallback - log warning if metricId was provided but not found
  if (metricId) {
    if (METRICS_DEBUG) console.warn('[metricsFacade] resolveTelemetryMetricField: metricId not found in mapping', {
      metricId,
      availableMappings: Object.keys(METRIC_ID_TO_TELEMETRY_FIELD),
      defaultingTo: 'AI_suggestions_accepted'
    })
  }
  
  return 'AI_suggestions_accepted'
}

function resolveTelemetryMetricFieldFromIds(metricIds?: string[]): TelemetryMetricField {
  if (METRICS_DEBUG) console.info('[metricsFacade] resolveTelemetryMetricFieldFromIds INPUT:', { metricIds })

  if (metricIds && Array.isArray(metricIds) && metricIds.length > 0) {
    // Use the first metric ID from the array
    const firstMetricId = metricIds[0]
    if (METRIC_ID_TO_TELEMETRY_FIELD[firstMetricId]) {
      const field = METRIC_ID_TO_TELEMETRY_FIELD[firstMetricId]
      if (METRICS_DEBUG) console.info('[metricsFacade] resolveTelemetryMetricFieldFromIds RESOLVED:', {
        metricIds,
        selectedMetricId: firstMetricId,
        resolvedField: field,
        mappingExists: true
      })
      return field
    }
    
    if (METRICS_DEBUG) console.warn('[metricsFacade] resolveTelemetryMetricFieldFromIds: first metricId not found in mapping', {
      metricIds,
      selectedMetricId: firstMetricId,
      availableMappings: Object.keys(METRIC_ID_TO_TELEMETRY_FIELD),
      defaultingTo: 'AI_suggestions_accepted'
    })
  }
  
  return 'AI_suggestions_accepted'
}

function normalizePeriodToISO(period: string): string | null {
  if (!period) {
    return null
  }

  // Handle backend week format (e.g., "2026-35" = ISO year 2026, week 35).
  // The backend's sqliteWeekPeriodToIso() converts SQLite %W week numbers to
  // ISO 8601 week numbers before returning them.  We must interpret the
  // received value as an ISO week number, NOT a SQLite %W week number.
  // ISO 8601: week 1 is the week containing the first Thursday of the year.
  // ISO weeks start on Monday.
  const weekMatch = period.match(/^(\d{4})-(\d{2})$/)
  if (weekMatch) {
    const year = parseInt(weekMatch[1], 10)
    const week = parseInt(weekMatch[2], 10)

    if (week === 0) {
      // No ISO week 0; fall back to Jan 1 of the year
      return new Date(year, 0, 1).toISOString()
    }

    // ISO week 1 always contains Jan 4 (and the first Thursday of the year).
    // Find the Monday of ISO week 1:
    //   Jan 4 is always in ISO week 1.
    //   The Monday of that week is Jan 4 minus (Jan 4's weekday - 1) days,
    //   where Monday = 1 in JS getDay().
    const jan4 = new Date(year, 0, 4)
    const jan4Day = jan4.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
    // Convert to ISO weekday (Mon=1..Sun=7) then compute days back to Monday
    const isoWeekday = jan4Day === 0 ? 7 : jan4Day
    const mondayOfWeek1 = new Date(year, 0, 4 - (isoWeekday - 1))

    // Monday of the requested ISO week
    const weekStart = new Date(mondayOfWeek1)
    weekStart.setDate(weekStart.getDate() + (week - 1) * 7)
    weekStart.setHours(0, 0, 0, 0)

    if (!Number.isNaN(weekStart.getTime())) {
      return weekStart.toISOString()
    }
  }

  const direct = new Date(period)
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString()
  }

  const fallback = new Date(`${period}T00:00:00Z`)
  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString()
  }

  return null
}

/**
 * Build series from telemetry records only (no simulation scaffold)
 * Used in live mode to ensure only real operational data is displayed
 * Tools without telemetry will not appear in the result
 */
function buildSeriesFromTelemetryOnly(
  telemetryRecords: UnifiedTelemetryRecord[],
  query: ProductivityQuery,
  field: TelemetryMetricField,
  canonicalMetadata: any = null // 🔥 Add canonical metadata for session counts
): (TSResult & { telemetryUsed: boolean }) {
  if (PBT_DEBUG) console.info('[metricsFacade] buildSeriesFromTelemetryOnly INPUT:', {
    recordCount: telemetryRecords.length,
    field,
    sampleRecord: telemetryRecords[0],
    metricId: query.metricId,
    metricIds: query.metricIds
  })

  if (METRICS_DEBUG) console.info('[metricsFacade] 🔴 Building telemetry-only series (no simulation scaffold)')

  const seriesMap = new Map<string, { order: string[]; values: Map<string, number> }>()
  const toolOrder: string[] = []
  const toolsWithTelemetry = new Set<string>()
  const telemetrySessionCountsByTool = new Map<string, number>()
  const isDeveloperDimension = query.groupBy === 'developer'
  const seriesKeyForRecord = (record: UnifiedTelemetryRecord): string =>
    isDeveloperDimension ? (record.developer || '') : normalizeToCanonicalToolId(record.tool || 'unknown')
  const metadataSessionCounts = isDeveloperDimension
    ? canonicalMetadata?.session_count_by_group
    : canonicalMetadata?.session_count_by_tool

  // 🔥 FIX: Use canonical metadata for session counts when available
  // This is the authoritative source per the Productivity V3 data contract
  if (PBT_DEBUG) console.info('[metricsFacade] canonicalMetadata received:', {
    hasMetadata: !!canonicalMetadata,
    hasSessionCountByTool: !!(canonicalMetadata && canonicalMetadata.session_count_by_tool),
    canonicalPopulationCount: canonicalMetadata?.canonical_population_count,
    sessionCountByTool: canonicalMetadata?.session_count_by_tool
  })
  
  if (metadataSessionCounts) {
    if (PBT_DEBUG) console.info('[metricsFacade] Using canonical metadata for session counts:', metadataSessionCounts)
    Object.entries(metadataSessionCounts).forEach(([key, count]) => {
      if (key !== 'test-browser') {
        const seriesKey = isDeveloperDimension ? key : normalizeToCanonicalToolId(key)
        const existing = telemetrySessionCountsByTool.get(seriesKey) || 0
        telemetrySessionCountsByTool.set(seriesKey, existing + (count as number))
      }
    })
  } else {
    console.warn('[metricsFacade] canonicalMetadata or session_count_by_tool is null, falling back to record accumulation')
  }

  // 🔥 TWO-PASS CANONICAL STRUCTURE: Preserve all historical periods regardless of metric values
  
  // PASS 1: Collect all canonical periods from telemetry.records (regardless of metric value)
  const allCanonicalPeriods = new Set<string>()
  telemetryRecords.forEach(record => {
    const rawToolId = record.tool || 'unknown'
    if (rawToolId === 'test-browser') return
    
    const isoTimestamp = normalizePeriodToISO(record.period)
    if (isoTimestamp) {
      allCanonicalPeriods.add(isoTimestamp)
    }
  })

  // PASS 2: Collect all canonical workflow IDs from metadata + records
  // Normalize raw tool IDs to canonical form (e.g. windsurf → devin) before grouping
  const metadataWorkflows = isDeveloperDimension
    ? (Array.isArray(canonicalMetadata?.groups_in_population) ? canonicalMetadata.groups_in_population : [])
    : (Array.isArray(canonicalMetadata?.tools_in_population)
        ? (canonicalMetadata.tools_in_population as string[])
            .filter(t => t !== 'test-browser')
            .map(t => normalizeToCanonicalToolId(t))
        : [])
  const allWorkflowIds = new Set<string>(metadataWorkflows)

  telemetryRecords.forEach(record => {
    const seriesKey = seriesKeyForRecord(record)
    if (seriesKey && seriesKey !== 'test-browser' && seriesKey !== 'unknown') {
      allWorkflowIds.add(seriesKey)
    }
  })

  // No placeholder fallback: if canonical metadata returned no tools, the population is empty.
  // Never synthesize workflows from a hardcoded catalog.

  // PASS 3: Build ALL metric values map (workflow -> period -> all metric fields)
  // This enables instant dropdown switching without refetching
  const allMetricValuesByWorkflow = new Map<string, Map<string, Record<string, number>>>()
  
  telemetryRecords.forEach(record => {
    const rawToolId = record.tool || 'unknown'
    if (rawToolId === 'test-browser') return
    const toolId = seriesKeyForRecord(record)
    if (!toolId) return
    
    const isoTimestamp = normalizePeriodToISO(record.period)
    if (!isoTimestamp) return

    // Only accumulate session count from records if metadata is not available
    if (!metadataSessionCounts) {
      const sessionCount = record.sessionCount || 0
      if (!telemetrySessionCountsByTool.has(toolId)) {
        telemetrySessionCountsByTool.set(toolId, 0)
      }
      telemetrySessionCountsByTool.set(toolId, telemetrySessionCountsByTool.get(toolId)! + sessionCount)
    }

    // Store ALL metric fields for this tool+period
    if (!allMetricValuesByWorkflow.has(toolId)) {
      allMetricValuesByWorkflow.set(toolId, new Map())
    }
    
    const periodMetrics = allMetricValuesByWorkflow.get(toolId)!
    const sCount = record.sessionCount || 0
    const recordEra: 'session' | 'legacy' = (record.instrumentation_era) || ((sCount > 0 || (record.activeCodingMs && record.activeCodingMs > 0)) ? 'session' : 'legacy')
    const existing = periodMetrics.get(isoTimestamp)
    if (!existing) {
      periodMetrics.set(isoTimestamp, {
        _totalSessions: sCount,
        _instrumentationEra: recordEra === 'session' ? 1 : 0,
        AI_suggestions_accepted: finiteNumberOrNull(record.AI_suggestions_accepted),
        files_edited_per_session: finiteNumberOrNull(record.files_edited_per_session),
        commits_per_session: finiteNumberOrNull(record.commits_per_session),
        average_session_length_minutes: finiteNumberOrNull(record.average_session_length_minutes),
        time_to_first_commit_minutes: finiteNumberOrNull(record.time_to_first_commit_minutes),
        AI_usage_duration_minutes: finiteNumberOrNull(record.AI_usage_duration_minutes),
        idle_time_minutes: finiteNumberOrNull(record.idle_time_minutes),
        active_coding_time_minutes: finiteNumberOrNull(record.active_coding_time_minutes),
        active_coding_ratio: finiteNumberOrNull(record.active_coding_ratio),
        ai_usage_ratio: finiteNumberOrNull(record.ai_usage_ratio),
        idle_ratio: finiteNumberOrNull(record.idle_ratio)
      })
      toolsWithTelemetry.add(toolId)
    } else {
      const prevSessions = existing._totalSessions || 0
      const totalSessions = prevSessions + sCount
      if (totalSessions === 0) return
      const w1 = prevSessions / totalSessions
      const w2 = sCount / totalSessions
      const metricFields = ['AI_suggestions_accepted','files_edited_per_session','commits_per_session','average_session_length_minutes','time_to_first_commit_minutes','AI_usage_duration_minutes','idle_time_minutes','active_coding_time_minutes','active_coding_ratio','ai_usage_ratio','idle_ratio'] as const
      for (const f of metricFields) {
        const prevVal = typeof existing[f] === 'number' ? existing[f] as number : 0
        const newVal = finiteNumberOrNull(record[f])
        const nv = typeof newVal === 'number' ? newVal : 0
        existing[f] = prevVal * w1 + nv * w2
      }
      existing._totalSessions = totalSessions
      // Preserve era: if any record in this period is session-era, mark it as session
      if (recordEra === 'session') existing._instrumentationEra = 1
    }
  })

  // PASS 4: Emit one series per workflow with one point for every canonical period
  const sortedCanonicalPeriods = Array.from(allCanonicalPeriods).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  )

  const mergedSeries = Array.from(allWorkflowIds).map(toolId => {
    const allMetricsMap = allMetricValuesByWorkflow.get(toolId) || new Map()
    
    const points = sortedCanonicalPeriods.map(timestamp => {
      const allMetrics = allMetricsMap.get(timestamp)
      // Use the selected field for v to maintain backward compatibility
      const value = allMetrics ? finiteNumberOrNull(allMetrics[field]) : null
      return {
        t: timestamp,
        v: value,
        session_count: finiteNumberOrNull(allMetrics?._totalSessions),
        instrumentation_era: allMetrics?._instrumentationEra === 1 ? 'session' : 'legacy',
        // Preserve all metric fields for instant dropdown switching
        AI_suggestions_accepted: finiteNumberOrNull(allMetrics?.AI_suggestions_accepted),
        files_edited_per_session: finiteNumberOrNull(allMetrics?.files_edited_per_session),
        commits_per_session: finiteNumberOrNull(allMetrics?.commits_per_session),
        average_session_length_minutes: finiteNumberOrNull(allMetrics?.average_session_length_minutes),
        time_to_first_commit_minutes: finiteNumberOrNull(allMetrics?.time_to_first_commit_minutes),
        AI_usage_duration_minutes: finiteNumberOrNull(allMetrics?.AI_usage_duration_minutes),
        idle_time_minutes: finiteNumberOrNull(allMetrics?.idle_time_minutes),
        active_coding_time_minutes: finiteNumberOrNull(allMetrics?.active_coding_time_minutes),
        active_coding_ratio: finiteNumberOrNull(allMetrics?.active_coding_ratio),
        ai_usage_ratio: finiteNumberOrNull(allMetrics?.ai_usage_ratio),
        idle_ratio: finiteNumberOrNull(allMetrics?.idle_ratio)
      }
    })

    return {
      label: toolId,
      points,
      usesTelemetry: true,
      isLive: true,
      dataSource: 'Real' as const,
      telemetryPointCount: allMetricsMap.size,
      totalPointCount: points.length,
      sessionCount: telemetrySessionCountsByTool.get(toolId) || 0,
      metadata: canonicalMetadata,
      metricId: query.metricId // Track which metric this series was built for
    }
  })

  if (PBT_DEBUG) console.info('[metricsFacade] buildSeriesFromTelemetryOnly OUTPUT:', {
    seriesCount: mergedSeries.length,
    seriesLabels: mergedSeries.map(s => s.label),
    totalPoints: mergedSeries.reduce((sum, s) => sum + s.points.length, 0)
  })

  if (METRICS_DEBUG) console.info(`[metricsFacade] 🔴 Returning ${mergedSeries.length} telemetry-only series`)

  return {
    dataSource: 'Real' as DataSource,
    series: mergedSeries as unknown as TimeSeries,
    telemetryUsed: true,
    // CR-X R2: Pass latest_observed_at from canonical metadata so the
    // partial-period label uses the real latest observation timestamp
    // (e.g. "Sep 3") instead of falling back to the weekly bucket key.
    latest_observed_at: canonicalMetadata?.latest_observed_at ?? null,
    metadata: canonicalMetadata
  }
}

/**
 * Build series from telemetry records
 * In live mode: returns only telemetry-backed series (no simulation scaffold)
 * In simulation mode: merges telemetry onto simulation scaffold
 * CRITICAL: Deep clones simulation scaffold to prevent mutation pollution (when used)
 */
function buildSeriesFromTelemetryRecords(
  telemetryRecords: UnifiedTelemetryRecord[],
  query: ProductivityQuery,
  field: TelemetryMetricField,
  useSimulationScaffold: boolean = false,
  canonicalMetadata: any = null // 🔥 Add canonical metadata for session counts
): (TSResult & { telemetryUsed: boolean }) | null {
  if (!telemetryRecords.length) {
    return null
  }

  const telemetryMode = resolveTelemetryMode()
  const isLive = telemetryMode === 'live'

  if (METRICS_DEBUG) console.info(`[metricsFacade] 🔧 Building series for field: ${field}, mode: ${telemetryMode}, useScaffold: ${useSimulationScaffold}`)

  // LIVE MODE: Skip simulation scaffold entirely - return only telemetry-backed series
  if (isLive && !useSimulationScaffold) {
    if (METRICS_DEBUG) console.info('[metricsFacade] 🔴 LIVE MODE - building series from telemetry only (no simulation scaffold)')
    return buildSeriesFromTelemetryOnly(telemetryRecords, query, field, canonicalMetadata)
  }

  // SIMULATION MODE or HYBRID: Use simulation scaffold with telemetry overlay
  if (METRICS_DEBUG) console.info(`[metricsFacade] 🔧 Building series with telemetry overlay for field: ${field}`)

  // CRITICAL: Generate fresh simulation scaffold and DEEP CLONE it using JSON.parse(JSON.stringify())
  // This ensures complete isolation - simulation data is NEVER mutated
  const originalSimulation = simulateProductivityTS(query)
  const clonedSimulation = JSON.parse(JSON.stringify(originalSimulation)) as typeof originalSimulation

  if (METRICS_DEBUG) console.info(`[metricsFacade] ✅ Deep-cloned simulation scaffold with ${clonedSimulation.series.length} tool series`)
  
  // Debug: Log simulation scaffold timestamps
  if (clonedSimulation.series.length > 0) {
    const firstSeries = clonedSimulation.series[0]
    if (METRICS_DEBUG) console.debug('[metricsFacade] Simulation scaffold bucket keys:', {
      tool: firstSeries.label,
      bucketCount: firstSeries.points.length,
      buckets: firstSeries.points.map(p => p.t.slice(0, 10)), // Show dates only
      firstBucket: firstSeries.points[0]?.t,
      lastBucket: firstSeries.points[firstSeries.points.length - 1]?.t
    })
  }

  const seriesMap = new Map<
    string,
    { order: string[]; values: Map<string, number | null> }
  >()
  const toolOrder: string[] = []

  // 🔥 NEW: Build ALL metric values map from telemetry for instant switching
  const allMetricValuesByTool = new Map<string, Map<string, Record<string, number>>>()

  // Initialize with DEEP-CLONED simulation data as base for ALL tools
  // TTFC now follows the same pattern as other metrics: simulation baseline + telemetry overlay
  clonedSimulation.series.forEach(series => {
    const toolId = series.label
    const values = new Map<string, number | null>()
    const order: string[] = []
    
    // For ALL tools (including TTFC), use simulation baseline
    series.points.forEach(point => {
      order.push(point.t)
      values.set(point.t, point.v)  // Preserve exact simulation value
    })
    
    seriesMap.set(toolId, { order, values })
    toolOrder.push(toolId)
  })
  
  if (METRICS_DEBUG) console.info(`[metricsFacade] 📊 Initialized ${seriesMap.size} tools with simulation values (preserved exactly)`)

  let telemetryMergeCount = 0
  const toolsWithTelemetry = new Set<string>()
  const telemetryTimestampsByTool = new Map<string, Set<string>>()
  const telemetrySessionCountsByTool = new Map<string, number>()  // 🔥 FIX: Track actual session counts per tool

  // CRITICAL: Non-destructive merge - ONLY update the specific tool that has telemetry
  // All other tools keep their EXACT simulation values (no normalization, no adjustment)
  telemetryRecords.forEach(record => {
    // CR1 Patch E: Normalize tool ID to canonical form (e.g. windsurf → devin)
    // to prevent duplicate series for the same workflow
    const toolId = normalizeToCanonicalToolId(record.tool || 'unknown')
    const isoTimestamp = normalizePeriodToISO(record.period)
    if (!isoTimestamp) {
      return
    }

    // 🔥 NEW: Store ALL metric fields for instant switching
    if (!allMetricValuesByTool.has(toolId)) {
      allMetricValuesByTool.set(toolId, new Map())
    }
    
    const toolMetrics = allMetricValuesByTool.get(toolId)!
    if (!toolMetrics.has(isoTimestamp)) {
      const sCount = record.sessionCount || 0
      const recordEra: 'session' | 'legacy' = (record.instrumentation_era) || ((sCount > 0 || (record.activeCodingMs && record.activeCodingMs > 0)) ? 'session' : 'legacy')
      toolMetrics.set(isoTimestamp, {
        _sessionCount: sCount,
        _instrumentationEra: recordEra,
        AI_suggestions_accepted: record.AI_suggestions_accepted || 0,
        files_edited_per_session: record.files_edited_per_session || 0,
        commits_per_session: record.commits_per_session || 0,
        average_session_length_minutes: record.average_session_length_minutes || 0,
        time_to_first_commit_minutes: record.time_to_first_commit_minutes || 0,
        AI_usage_duration_minutes: record.AI_usage_duration_minutes || 0,
        idle_time_minutes: record.idle_time_minutes || 0,
        active_coding_time_minutes: record.active_coding_time_minutes || 0,
        active_coding_ratio: record.active_coding_ratio || 0,
        ai_usage_ratio: record.ai_usage_ratio || 0,
        idle_ratio: record.idle_ratio || 0
      })
    }

    // Special handling for TTFC: read from time_to_first_commit_minutes field
    // This field is populated by telemetryToUnified.ts from session event metadata
    let rawValue: number | null | undefined
    if (field === 'time_to_first_commit_minutes') {
      // Use time_to_first_commit_minutes field (populated by telemetryToUnified.ts)
      rawValue = record.time_to_first_commit_minutes ?? null

      if (METRICS_DEBUG) console.debug('[metricsFacade] Building TTFC series point', {
        tool: toolId,
        period: isoTimestamp,
        value: rawValue,
        hasTtfcField: record.time_to_first_commit_minutes != null,
        recordTool: record.tool,
        recordPeriod: record.period,
        timeToFirstCommitMinutes: record.time_to_first_commit_minutes,
      })
    } else {
      rawValue = (record as Record<TelemetryMetricField, number>)[field]
    }

    // Only use telemetry value if it's finite and greater than 0
    // NOTE: For TTFC, we allow very small values (e.g., 0.000033 minutes = 2ms)
    if (rawValue == null || !Number.isFinite(rawValue)) {
      return
    }

    // For TTFC, allow values >= 0 (including very small values like 0.000033 minutes)
    // For other metrics, require > 0
    if (field !== 'time_to_first_commit_minutes' && rawValue <= 0) {
      return
    }

    // CRITICAL: Only update THIS specific tool - never touch other tools
    if (METRICS_DEBUG) console.info(`[metricsFacade] 🔧 Merging telemetry for tool: ${toolId}, field: ${field}, value: ${rawValue}, timestamp: ${isoTimestamp}`)
    if (METRICS_DEBUG) console.info(`[metricsFacade] ⚠️ ONLY ${toolId} will be updated - all other tools keep simulation values unchanged`)

    if (!seriesMap.has(toolId)) {
      // If tool doesn't exist in simulation, create new entry (shouldn't happen normally)
      if (METRICS_DEBUG) console.warn(`[metricsFacade] ⚠️ Tool ${toolId} not found in simulation, creating new entry`)
      seriesMap.set(toolId, { order: [], values: new Map() })
      toolOrder.push(toolId)
    }

    const entry = seriesMap.get(toolId)!
    if (!entry.order.includes(isoTimestamp)) {
      entry.order.push(isoTimestamp)
    }

    // CRITICAL: Overlay telemetry value on top of simulation baseline
    // For TTFC and all other metrics, this replaces the simulation value with telemetry value
    entry.values.set(isoTimestamp, rawValue)
    toolsWithTelemetry.add(toolId)
    if (!telemetryTimestampsByTool.has(toolId)) {
      telemetryTimestampsByTool.set(toolId, new Set<string>())
    }
    telemetryTimestampsByTool.get(toolId)!.add(isoTimestamp)

    // 🔥 FIX: Accumulate session count from each period record
    // sessionCount field contains the number of sessions in that period
    const sessionCount = record.sessionCount || 0
    if (!telemetrySessionCountsByTool.has(toolId)) {
      telemetrySessionCountsByTool.set(toolId, 0)
    }
    telemetrySessionCountsByTool.set(toolId, telemetrySessionCountsByTool.get(toolId)! + sessionCount)

    telemetryMergeCount++
  })
  
  if (METRICS_DEBUG) console.info(`[metricsFacade] ✅ Merge complete: ${telemetryMergeCount} telemetry values merged for ${toolsWithTelemetry.size} tool(s): ${Array.from(toolsWithTelemetry).join(', ')}`)
  if (METRICS_DEBUG) console.info(`[metricsFacade] ✅ All other tools (${seriesMap.size - toolsWithTelemetry.size}) retain their exact simulation values`)

  if (METRICS_DEBUG) console.info(
    `[metricsFacade] Merged ${telemetryMergeCount} telemetry values into simulation scaffold for field: ${field}`
  )

  // Special logging for AI suggestions accepted
  if (field === 'AI_suggestions_accepted' && telemetryMergeCount > 0) {
    const totalAiAccepts = Array.from(seriesMap.values())
      .filter((entry): entry is NonNullable<typeof entry> => entry != null)
      .reduce((sum, entry) => {
        return sum + Array.from(entry.values.values()).reduce((s: number, v) => {
          const numValue = (v != null && typeof v === 'number' && Number.isFinite(v)) ? v : 0
          return s + numValue
        }, 0)
      }, 0)
    if (METRICS_DEBUG) console.info(
      `[metricsFacade] 🎯 AI Suggestions Accepted: merged ${telemetryMergeCount} data points, total count across all tools/periods: ${totalAiAccepts}`
    )
  }

  // Special logging for session length
  if (field === 'average_session_length_minutes' && telemetryMergeCount > 0) {
    const totalSessionMinutes = Array.from(seriesMap.values())
      .filter((entry): entry is NonNullable<typeof entry> => entry != null)
      .reduce((sum, entry) => {
        return sum + Array.from(entry.values.values()).reduce((s: number, v) => {
          const numValue = (v != null && typeof v === 'number' && Number.isFinite(v)) ? v : 0
          return s + numValue
        }, 0)
      }, 0)
    if (METRICS_DEBUG) console.info(
      `[metricsFacade] ⏱️ Session Length: merged ${telemetryMergeCount} data points, total minutes across all tools/periods: ${totalSessionMinutes.toFixed(2)}`
    )
  }
  
  // Debug logging for new session metrics (activeCodingMs and sessionCount)
  const totalActiveCodingMs = telemetryRecords.reduce((sum, r) => sum + (r.activeCodingMs || 0), 0)
  const totalSessionCount = telemetryRecords.reduce((sum, r) => sum + (r.sessionCount || 0), 0)
  const totalActiveCodingHours = (totalActiveCodingMs / 3600000).toFixed(2)
  
  if (totalSessionCount > 0 || totalActiveCodingMs > 0) {
    if (METRICS_DEBUG) console.debug(
      `[metricsFacade] 📊 Session metrics in series: ${totalSessionCount} real sessions, ${totalActiveCodingHours} hours active coding time (${totalActiveCodingMs}ms)`
    )
    if (METRICS_DEBUG) console.info(
      `[metricsFacade] ✅ Using new session model: ${totalSessionCount} sessions from segment_type='session' events (legacy intervals ignored)`
    )
  }

  // Special logging for commits
  if (field === 'commits_per_session' && telemetryMergeCount > 0) {
    const totalCommits = Array.from(seriesMap.values()).reduce((sum, entry) => {
      if (!entry) return sum
      return sum + Array.from(entry.values.values()).reduce((s: number, v) => {
        const numValue = (v != null && typeof v === 'number' && Number.isFinite(v)) ? v : 0
        return s + numValue
      }, 0)
    }, 0)
    if (METRICS_DEBUG) console.info(
      `[metricsFacade] 💾 Commits: merged ${telemetryMergeCount} data points, total commits across all tools/periods: ${totalCommits}`
    )
  }

  const uniqueToolOrder = Array.from(new Set(toolOrder))

  // Build final merged series - tools with telemetry get telemetry values, others keep simulation
  const mergedSeries = uniqueToolOrder.map(toolId => {
    const entry = seriesMap.get(toolId)
    if (!entry) {
      return null
    }

    const sortedTimestamps = Array.from(new Set(entry.order)).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    )

    const allMetricsMap = allMetricValuesByTool.get(toolId) || new Map()

    const points = sortedTimestamps.map(timestamp => {
      const value = entry.values.get(timestamp)
      const allMetrics = allMetricsMap.get(timestamp)
      
      // For all metrics (including TTFC), use simulation baseline with telemetry overlay
      // If telemetry value exists, use it; otherwise use simulation value (or 0 as fallback)
      return {
        t: timestamp,
        v: typeof value === 'number' && Number.isFinite(value) ? value : 0,
        session_count: allMetrics?._sessionCount || 0,
        instrumentation_era: allMetrics?._instrumentationEra === 1 ? 'session' : 'legacy',
        // Preserve all metric fields for instant dropdown switching
        AI_suggestions_accepted: allMetrics?.AI_suggestions_accepted || 0,
        files_edited_per_session: allMetrics?.files_edited_per_session || 0,
        commits_per_session: allMetrics?.commits_per_session || 0,
        average_session_length_minutes: allMetrics?.average_session_length_minutes || 0,
        time_to_first_commit_minutes: allMetrics?.time_to_first_commit_minutes || 0,
        AI_usage_duration_minutes: allMetrics?.AI_usage_duration_minutes || 0,
        idle_time_minutes: allMetrics?.idle_time_minutes || 0,
        active_coding_time_minutes: allMetrics?.active_coding_time_minutes || 0,
        active_coding_ratio: allMetrics?.active_coding_ratio || 0,
        ai_usage_ratio: allMetrics?.ai_usage_ratio || 0,
        idle_ratio: allMetrics?.idle_ratio || 0
      }
    })

    const hasTelemetry = toolsWithTelemetry.has(toolId)
    if (hasTelemetry) {
      if (METRICS_DEBUG) console.info(`[metricsFacade] 📊 Tool ${toolId}: Using TELEMETRY values`)
    } else {
      if (METRICS_DEBUG) console.info(`[metricsFacade] 📊 Tool ${toolId}: Using SIMULATION values (unchanged)`)
    }

    const telemetryTimestamps = telemetryTimestampsByTool.get(toolId) || new Set<string>()
    // 🔥 FIX: telemetryPointCount = number of chart points with telemetry, sessionCount = actual session count
    const telemetryPointCount = telemetryTimestamps.size
    const sessionCount = telemetrySessionCountsByTool.get(toolId) || 0
    const totalPointCount = points.length
    const perToolDataSource: 'Real' | 'Hybrid' | 'Simulated' =
      telemetryPointCount === 0
        ? 'Simulated'
        : (telemetryPointCount >= totalPointCount ? 'Real' : 'Hybrid')

    return {
      label: toolId,
      points,
      usesTelemetry: telemetryPointCount > 0,
      isLive: perToolDataSource === 'Real',
      dataSource: perToolDataSource,
      telemetryPointCount,
      totalPointCount,
      sessionCount,
      metricId: query.metricId // Track which metric this series was built for
    }
  }).filter((series) => series !== null) as any

  // CRITICAL: Deep clone the final merged result using JSON.parse(JSON.stringify())
  // This ensures no external mutations can affect the result
  const clonedMergedSeries = JSON.parse(JSON.stringify(mergedSeries))

  return {
    dataSource: 'Real',
    series: clonedMergedSeries as unknown as TimeSeries,
    telemetryUsed: telemetryMergeCount > 0,
    latest_observed_at: canonicalMetadata?.latest_observed_at ?? null
  }
}

/**
 * Build summary from telemetry records only — no simulation scaffold.
 * In live mode, totals start empty and are populated solely from telemetry.
 */
function buildSummaryFromTelemetryRecords(records: UnifiedTelemetryRecord[], query?: ProductivityQuery): SummaryResult & { telemetryUsed: boolean} {
  const fields: TelemetryMetricField[] = [
    'AI_suggestions_accepted',
    'files_edited_per_session',
    'commits_per_session',
    'average_session_length_minutes',
    'time_to_first_commit_minutes',
    'AI_usage_duration_minutes',
    'idle_time_minutes'
  ]

  if (METRICS_DEBUG) console.info(`[metricsFacade] 🔧 Building summary from telemetry only (no simulation scaffold)`)

  // Start with empty totals — no simulation scaffold in live mode
  let totals: Record<string, number> = {}

  let telemetryMergeCount = 0
  const toolsWithTelemetryInSummary = new Set<string>()

  // CRITICAL: Summary totals are per-tool (e.g., { cursor: 35, vscode: 25, ... })
  // Only update the specific tool that has telemetry - all other tools keep simulation values
  records.forEach(record => {
    // CR1 Patch E: Normalize tool ID to canonical form (e.g. windsurf → devin)
    const toolId = normalizeToCanonicalToolId(record.tool || 'unknown')
    
    // For summary, we use the last point value approach
    // Only update the tool that has telemetry for the relevant field
    fields.forEach(field => {
      const value = (record as Record<TelemetryMetricField, number>)[field]
      if (Number.isFinite(value) && value > 0) {
        // CRITICAL: Only update THIS tool's value - never touch other tools
        // Note: Summary is per-tool, so we update totals[toolId] not totals[field]
        // For now, we'll use the telemetry value for the tool that has it
        if (!totals[toolId]) {
          totals[toolId] = 0
        }
        // Use telemetry value for this tool (this is a simplified approach)
        // In a full implementation, we'd need to know which metric field we're summarizing
        totals[toolId] = value
        toolsWithTelemetryInSummary.add(toolId)
        telemetryMergeCount++
        if (METRICS_DEBUG) console.info(`[metricsFacade] 🔧 Summary: Updating tool ${toolId} with telemetry value ${value} for field ${field}`)
      }
    })
  })
  
  if (METRICS_DEBUG) console.info(`[metricsFacade] ✅ Summary merge: ${telemetryMergeCount} telemetry values for ${toolsWithTelemetryInSummary.size} tool(s)`)
  if (METRICS_DEBUG) console.info(`[metricsFacade] ✅ Summary: ${toolsWithTelemetryInSummary.size} tool(s) with telemetry, ${Object.keys(totals).length - toolsWithTelemetryInSummary.size} tools without (empty)`)

  if (METRICS_DEBUG) console.info(
    `[metricsFacade] Summary built from ${telemetryMergeCount} telemetry values (no simulation base)`
  )

  // Special logging for AI suggestions accepted in summary
  if (totals['AI_suggestions_accepted'] && totals['AI_suggestions_accepted'] > 0) {
    if (METRICS_DEBUG) console.info(
      `[metricsFacade] 🎯 AI Suggestions Accepted Summary: total = ${totals['AI_suggestions_accepted']}`
    )
  }

  // Special logging for session length in summary
  if (totals['average_session_length_minutes'] && totals['average_session_length_minutes'] > 0) {
    if (METRICS_DEBUG) console.info(
      `[metricsFacade] ⏱️ Session Length Summary: total minutes = ${totals['average_session_length_minutes'].toFixed(2)}`
    )
  }
  
  // Debug logging for new session metrics (activeCodingMs and sessionCount)
  const totalActiveCodingMs = records.reduce((sum, r) => sum + (r.activeCodingMs || 0), 0)
  const totalSessionCount = records.reduce((sum, r) => sum + (r.sessionCount || 0), 0)
  const totalActiveCodingHours = (totalActiveCodingMs / 3600000).toFixed(2)
  
  if (totalSessionCount > 0 || totalActiveCodingMs > 0) {
    if (METRICS_DEBUG) console.debug(
      `[metricsFacade] 📊 Session metrics in summary: ${totalSessionCount} real sessions, ${totalActiveCodingHours} hours active coding time (${totalActiveCodingMs}ms)`
    )
    if (METRICS_DEBUG) console.info(
      `[metricsFacade] ✅ Using new session model: ${totalSessionCount} sessions from segment_type='session' events (legacy intervals ignored)`
    )
  }

  // Special logging for commits in summary
  if (totals['commits_per_session'] && totals['commits_per_session'] > 0) {
    if (METRICS_DEBUG) console.info(
      `[metricsFacade] 💾 Commits Summary: total commits = ${totals['commits_per_session']}`
    )
  }

  // Calculate average Time to First Commit (TTFC) from unified records
  // Use time_to_first_commit_minutes field (populated by telemetryToUnified.ts)
  const ttfcValues = records
    .map(r => r.time_to_first_commit_minutes)
    .filter((v): v is number => v != null && typeof v === 'number' && !Number.isNaN(v) && v > 0)

  const avgTimeToFirstCommitMinutes =
    ttfcValues.length > 0
      ? ttfcValues.reduce((sum, v) => sum + v, 0) / ttfcValues.length
      : null

  // Debug logging for TTFC
  if (METRICS_DEBUG) console.log('[metricsFacade] Summary TTFC (minutes)', avgTimeToFirstCommitMinutes)

  // CRITICAL: Deep clone using JSON.parse(JSON.stringify()) to prevent any external mutations
  const clonedTotals = JSON.parse(JSON.stringify(totals))

  return {
    dataSource: 'Real',
    totals: clonedTotals,
    avgTimeToFirstCommitMinutes: avgTimeToFirstCommitMinutes,
    telemetryUsed: telemetryMergeCount > 0
  }
}

function buildSimulatedSummary(series: Array<{ label: string; points: Array<{ t: string; v: number }> }>): SummaryResult {
  const totals: Record<string, number> = {}

  series.forEach(entry => {
    const lastPoint = entry.points[entry.points.length - 1]
    if (lastPoint && Number.isFinite(lastPoint.v)) {
      totals[entry.label] = lastPoint.v
    }
  })

  return {
    dataSource: 'Simulated',
    totals,
    avgTimeToFirstCommitMinutes: null // Simulation doesn't have TTFC data
  }
}

/**
 * Check if API response indicates unavailability
 * @param response - API response to check
 * @returns True if API is unavailable
 */
function isAPIUnavailable(response: Response | any): boolean {
  // Check HTTP status codes
  if (response instanceof Response) {
    return response.status === 404 || response.status >= 500
  }
  
  // Check response body status
  if (response && typeof response === 'object') {
    const status = response.status || response.body?.status
    return status === 'unavailable' || status === 'not_implemented' || status === 'error'
  }
  
  return false
}

/**
 * Build query parameters for API calls
 * @param query - Productivity query parameters
 * @returns URLSearchParams string
 */
function buildQueryParams(query: ProductivityQuery): string {
  const params = new URLSearchParams()
  
  // Required parameters
  params.append('from', query.from)
  params.append('to', query.to)
  params.append('viewBucket', query.viewBucket)
  params.append('scope', query.scope)
  
  // Optional parameters
  if (query.repos.length > 0) {
    params.append('repos', query.repos.join(','))
  }
  
  if (query.developerIds && query.developerIds.length > 0) {
    params.append('developerIds', query.developerIds.join(','))
  }
  
  if (query.teamIds && query.teamIds.length > 0) {
    params.append('teamIds', query.teamIds.join(','))
  }
  
  // New filter parameters
  if (query.toolIds && query.toolIds.length > 0) {
    params.append('toolIds', query.toolIds.join(','))
  }
  
  if (query.metricId) {
    params.append('metricId', query.metricId)
  }
  
  return params.toString()
}

/**
 * Make API call with timeout and error handling
 * @param url - API endpoint URL
 * @param timeout - Request timeout in milliseconds
 * @returns Promise with response or null if failed
 */
async function makeAPICall(url: string, timeout: number = 10000, signal?: AbortSignal): Promise<Response | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    // Combine external signal with timeout signal
    let combinedSignal: AbortSignal = controller.signal
    if (signal) {
      // If external signal is already aborted, abort immediately
      if (signal.aborted) {
        clearTimeout(timeoutId)
        throw new DOMException('Request aborted', 'AbortError')
      }
      // Listen to external signal and abort controller when it aborts
      signal.addEventListener('abort', () => {
        controller.abort()
        clearTimeout(timeoutId)
      })
      combinedSignal = controller.signal
    }
    
    const token = localStorage.getItem('api_token')
    
    if (!token) {
      // Skip auth warning for development - many endpoints work without auth
      if (import.meta.env.DEV) {
        if (METRICS_DEBUG) console.log('🔧 DEV MODE: No API token, proceeding without auth')
      } else {
        console.warn('No API token found — API calls will fail')
      }
    }
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      signal: combinedSignal
    })
    
    clearTimeout(timeoutId)
    return response
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      warn('API call timed out:', url)
    } else {
      logError('API call failed:', url, err)
    }
    return null
  }
}

/**
 * Get productivity time series data
 * Tries real API first, falls back to simulator on failure
 * @param query - Productivity query parameters
 * @returns Promise with time series result and data source flag
 */
export async function getProductivityTimeSeries(query: ProductivityQuery, signal?: AbortSignal): Promise<TSResult> {
  // PERF: Start timing
  const totalStart = performance.now()

  // CRITICAL: Debug log to see what metricKey/field is being requested
  const resolvedField = query.metricIds 
    ? resolveTelemetryMetricFieldFromIds(query.metricIds)
    : resolveTelemetryMetricField(query.metricId)
  if (METRICS_DEBUG) console.debug('[metricsFacade] getProductivityTimeSeries called', {
    metricId: query.metricId,
    metricIds: query.metricIds,
    resolvedField,
    query: {
      from: query.from,
      to: query.to,
      viewBucket: query.viewBucket,
      scope: query.scope,
    }
  })
  
  const telemetryMode = resolveTelemetryMode()
  const isLive = telemetryMode === 'live'

  // ============================================================================
  // SIMULATION MODE: Hard short-circuit - NO telemetry, NO API calls, NO merges
  // ============================================================================
  if (!isLive) {
    if (METRICS_DEBUG) console.info('[metricsFacade] 🎯 SIMULATION MODE — using ONLY simulator (no telemetry, no API calls)')
    
    // Reset telemetry usage flags
    try {
      const store = useMetricsFacadeStore()
      store.telemetryUsedInSeries = false
    } catch (e) {
      // Store not available, skip
    }
    
    // Generate and return PURE simulation data
    log('🔄 Using productivity simulator with query:', {
      from: query.from,
      to: query.to,
      repos: query.repos,
      scope: query.scope,
      viewBucket: query.viewBucket,
      developerIds: query.developerIds,
      teamIds: query.teamIds,
      toolIds: query.toolIds,
      metricId: query.metricId
    })
    
    const simulatedData = simulateProductivityTS(query)
    
    // CRITICAL: Deep clone using JSON.parse(JSON.stringify()) to prevent ANY external mutations
    // This ensures simulation data is completely isolated and never mutated
    const clonedSeries = JSON.parse(JSON.stringify(simulatedData.series))
    
    log('✅ Simulator returned data (deep-cloned):', {
      hasSeries: !!clonedSeries,
      seriesLength: clonedSeries?.length
    })
    if (METRICS_DEBUG) console.info(`[metricsFacade] 🔒 Simulation data deep-cloned - ${clonedSeries.length} tool series isolated`)
    
    return {
      dataSource: 'Simulated' as DataSource,
      series: clonedSeries as unknown as TimeSeries
    }
  }

  // ============================================================================
  // LIVE MODE: Build series from telemetry only (no simulation scaffold)
  // ============================================================================
  if (METRICS_DEBUG) console.info('[metricsFacade] 🔴 LIVE TELEMETRY MODE — building from telemetry only (no simulation scaffold)')

  if (isLive) {
    try {
      // CR-X P0 microfix: Send browser reporting timezone so the backend can
      // interpret from/to as local-calendar dates and bucket accordingly.
      const reportingTimezone = typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : undefined
      const fetcher: TelemetryFetcher = async (period, fromDate, toDate, toolIds, developerIds, repos, tz, sig) => {
        return fetchAndMapTelemetryToUnified(period, fromDate, toDate, toolIds, developerIds, repos, tz ?? reportingTimezone, sig ?? signal, 'PBT_TIMESERIES', query.groupBy, query.cohortId)
      }
      const adaptive = await fetchTelemetryWithAdaptiveGranularity({ query, fetcher, reportingTimezone, signal })
      const telemetryResult: UnifiedTelemetryResult = adaptive.telemetryResult
      const period = adaptive.finalPeriod
      const telemetryRecords = telemetryResult.records
      const telemetryMetadata = telemetryResult.metadata
      
      if (METRICS_DEBUG) console.info(
        `[metricsFacade] 🔴 LIVE MODE: Fetching telemetry for time range: ${query.from} to ${query.to} (period: ${period})`
      )
      
      if (METRICS_DEBUG) console.info('[metricsFacade] TELEMETRY RECORDS RECEIVED (getProductivityTimeSeries):', {
        recordCount: telemetryRecords.length,
        tools: [...new Set(telemetryRecords.map(r => r.tool))],
        totalSessions: telemetryRecords.reduce((sum, r) => sum + (r.sessionCount || 0), 0),
        metadata: telemetryMetadata,
        sampleRecord: telemetryRecords[0]
      })

      if (METRICS_DEBUG) console.info('[metricsFacade] 🔥 METADATA CHECK:', {
        hasMetadata: !!telemetryMetadata,
        hasSessionCountByTool: !!(telemetryMetadata && telemetryMetadata.session_count_by_tool),
        canonicalPopulationCount: telemetryMetadata?.canonical_population_count,
        sessionCountByTool: telemetryMetadata?.session_count_by_tool
      })

      // Write to console for programmatic inspection
      try {
        const debugData = {
          stage: 'metricsFacade-getProductivityTimeSeries-input',
          timestamp: new Date().toISOString(),
          input: { period, query },
          output: {
            recordCount: telemetryRecords.length,
            tools: [...new Set(telemetryRecords.map(r => r.tool))],
            totalSessions: telemetryRecords.reduce((sum, r) => sum + (r.sessionCount || 0), 0),
            metadata: telemetryMetadata
          }
        }
        // PIPELINE-LOG removed to reduce console spam
      } catch (e) {
        // Ignore logging errors
      }

      if (telemetryRecords.length) {
        // 🔥 FIX: Use first metricId from metricIds for field resolution
        // Since metricId is no longer in query (to prevent refetch), use metricIds[0]
        // Cards and graph will use the selected metric field from point data
        const field = resolveTelemetryMetricFieldFromIds(query.metricIds)
        const telemetryResult = buildSeriesFromTelemetryRecords(
          telemetryRecords,
          query,
          field,
          false, // useSimulationScaffold
          telemetryMetadata // Pass canonical metadata for session counts
        )

        if (PBT_DEBUG) console.info('[metricsFacade] TELEMETRY RESULT FROM buildSeriesFromTelemetryRecords:', {
          hasResult: !!telemetryResult,
          seriesCount: telemetryResult?.series?.length || 0,
          seriesLabels: telemetryResult?.series?.map(s => s.label) || [],
          totalPoints: telemetryResult?.series?.reduce((sum, s) => sum + (s.points?.length || 0), 0) || 0,
          dataSource: telemetryResult?.dataSource
        })

        // Write to console for programmatic inspection
        try {
          const debugData = {
            stage: 'metricsFacade-getProductivityTimeSeries-output',
            timestamp: new Date().toISOString(),
            output: {
              seriesCount: telemetryResult?.series?.length || 0,
              seriesLabels: telemetryResult?.series?.map(s => s.label) || [],
              totalPoints: telemetryResult?.series?.reduce((sum, s) => sum + (s.points?.length || 0), 0) || 0,
              dataSource: telemetryResult?.dataSource
            }
          }
          // PIPELINE-LOG removed to reduce console spam
        } catch (e) {
          // Ignore logging errors
        }

        if (telemetryResult) {
          if (METRICS_DEBUG) console.info(
            `[metricsFacade] ✅ LIVE MODE: Returning telemetry-only result with ${telemetryRecords.length} records`
          )
          // Update store flag if telemetry was actually used
          try {
            const store = useMetricsFacadeStore()
            store.telemetryUsedInSeries = telemetryResult.telemetryUsed
          } catch (e) {
            // Store not available, skip
          }
          return telemetryResult
        }
      } else if (telemetryMetadata && telemetryMetadata.canonical_population_count === 0) {
        // ✅ Empty canonical population is a valid live-pilot state, not an error.
        if (METRICS_DEBUG) console.info('[metricsFacade] Canonical population is 0 — returning empty Real time series')
        try {
          const store = useMetricsFacadeStore()
          store.telemetryUsedInSeries = false
        } catch (e) {
          // Store not available, skip
        }
        return {
          dataSource: 'Real' as DataSource,
          series: [] as TimeSeries,
          latest_observed_at: telemetryMetadata?.latest_observed_at ?? null,
          metadata: telemetryMetadata
        }
      } else {
        // Recent window is empty but canonical population exists (historical data).
        // This is a valid state — return empty Real time series for the recent window.
        // The all-time canonical baseline (fetched separately by Dashboards) remains populated.
        if (METRICS_DEBUG) console.info('[metricsFacade] Live telemetry returned 0 records for recent window — returning empty Real time series (all-time baseline remains populated)')
        try {
          const store = useMetricsFacadeStore()
          store.telemetryUsedInSeries = false
        } catch (e) {
          // Store not available, skip
        }
        return {
          dataSource: 'Real' as DataSource,
          series: [] as TimeSeries,
          latest_observed_at: telemetryMetadata?.latest_observed_at ?? null,
          metadata: telemetryMetadata
        }
      }
    } catch (telemetryError) {
      // P0-G Part F: Propagate AuthError instead of generic error
      if (telemetryError instanceof Error && telemetryError.name === 'AuthError') {
        throw telemetryError
      }
      // 🔥 FIX: Productivity V3 MUST NOT fall back to /api/productivity/trends
      console.error('[metricsFacade] CRITICAL: Canonical telemetry fetch failed - Productivity V3 requires canonical endpoint')
      console.error('[metricsFacade] No fallback to /api/productivity/trends for Productivity V3')
      throw new Error('Canonical telemetry fetch failed - Productivity V3 requires canonical endpoint')
    }
  }
  
  // 🔥 FIX: Productivity V3 - no simulator fallback in live mode
  // If we reach here, canonical telemetry failed - throw explicit error
  console.error('[metricsFacade] CRITICAL: Productivity V3 requires canonical telemetry - no simulator fallback')
  throw new Error('Productivity V3 requires canonical telemetry - no simulator fallback')
  
  // Reset telemetry flag when using simulation fallback
  try {
    const store = useMetricsFacadeStore()
    store.telemetryUsedInSeries = false
  } catch (e) {
    // Store not available, skip
  }
  
  log('🔄 Using productivity simulator with query:', {
    from: query.from,
    to: query.to,
    repos: query.repos,
    scope: query.scope,
    viewBucket: query.viewBucket,
    developerIds: query.developerIds,
    teamIds: query.teamIds,
    toolIds: query.toolIds,
    metricId: query.metricId
  })
  const simulatedData = simulateProductivityTS(query)
  
  // CRITICAL: Deep clone using JSON.parse(JSON.stringify()) to prevent ANY external mutations
  const clonedSeries = JSON.parse(JSON.stringify(simulatedData.series))
  
  log('✅ Simulator returned data (deep-cloned):', {
    hasSeries: !!clonedSeries,
    seriesLength: clonedSeries?.length
  })
  if (METRICS_DEBUG) console.info(`[metricsFacade] 🔒 Simulation data deep-cloned - ${clonedSeries.length} tool series isolated`)
  
  const totalEnd = performance.now()
  const totalDuration = totalEnd - totalStart
  console.log(`[PERF] getProductivityTimeSeries total duration: ${totalDuration.toFixed(2)}ms`)

  return {
    dataSource: 'Simulated' as DataSource,
    series: clonedSeries as unknown as TimeSeries
  }
}

/**
 * Get productivity summary data
 * Tries real API first, falls back to simulator on failure
 * @param query - Productivity query parameters
 * @returns Promise with summary result and data source flag
 */
export async function getProductivitySummary(query: ProductivityQuery, purpose: string = 'PBT_TELEMETRY'): Promise<SummaryResult> {
  const telemetryMode = resolveTelemetryMode()
  const isLive = telemetryMode === 'live'

  // ============================================================================
  // SIMULATION MODE: Hard short-circuit - NO telemetry, NO API calls, NO merges
  // ============================================================================
  if (!isLive) {
    if (METRICS_DEBUG) console.info('[metricsFacade] 🎯 SIMULATION MODE — using ONLY simulator (no telemetry, no API calls)')
    
    // Reset telemetry usage flags
    try {
      const store = useMetricsFacadeStore()
      store.telemetryUsedInSummary = false
    } catch (e) {
      // Store not available, skip
    }
    
    // Generate and return PURE simulation summary
    log('🔄 Using productivity simulator for summary')
    const simulatedData = simulateProductivityTS(query)
    const summary = buildSimulatedSummary(simulatedData.series)
    // CRITICAL: Deep clone using JSON.parse(JSON.stringify()) to prevent external mutations
    return {
      dataSource: summary.dataSource,
      totals: JSON.parse(JSON.stringify(summary.totals))
    }
  }

  // ============================================================================
  // LIVE MODE: Build summary from telemetry only — no simulation scaffold
  // ============================================================================
  if (METRICS_DEBUG) console.info('[metricsFacade] 🔴 LIVE TELEMETRY MODE — building summary from telemetry only')

  if (isLive) {
    try {
      const period = mapViewBucketToPeriod(query.viewBucket)
      // CR-X P0 microfix: Send browser reporting timezone for local-calendar scoping.
      const reportingTimezone = typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : undefined
      const telemetryResult: UnifiedTelemetryResult = await fetchAndMapTelemetryToUnified(period, query.from, query.to, query.toolIds, query.developerIds, query.repos, reportingTimezone, undefined, purpose, undefined, query.cohortId)
      const telemetryRecords = telemetryResult.records
      const telemetryMetadata = telemetryResult.metadata
      
      if (METRICS_DEBUG) console.info(
        `[metricsFacade] 🔴 LIVE MODE: Fetching telemetry for time range: ${query.from} to ${query.to} (period: ${period})`
      )
      
      if (METRICS_DEBUG) console.info('[metricsFacade] TELEMETRY RECORDS RECEIVED (getProductivitySummary):', {
        recordCount: telemetryRecords.length,
        tools: [...new Set(telemetryRecords.map(r => r.tool))],
        totalSessions: telemetryRecords.reduce((sum, r) => sum + (r.sessionCount || 0), 0),
        metadata: telemetryMetadata,
        sampleRecord: telemetryRecords[0]
      })

      if (telemetryRecords.length) {
        const summary = buildSummaryFromTelemetryRecords(telemetryRecords as UnifiedTelemetryRecord[], query)
        if (METRICS_DEBUG) console.info(
          `[metricsFacade] Live telemetry summary built from ${telemetryRecords.length} records`
        )
        try {
          const store = useMetricsFacadeStore()
          store.telemetryUsedInSummary = summary.telemetryUsed
        } catch (e) {
          // Store not available, skip
        }
        return summary
      } else {
        // Recent window is empty — return honest empty Real data.
        // Do NOT fall back to legacy API or simulator.
        // The all-time canonical baseline (fetched separately) remains populated.
        if (METRICS_DEBUG) console.info('[metricsFacade] Live telemetry returned 0 records for recent window — returning empty Real summary')
        try {
          const store = useMetricsFacadeStore()
          store.telemetryUsedInSummary = false
        } catch (e) {
          // Store not available, skip
        }
        return {
          dataSource: 'Real' as DataSource,
          totals: {} as Record<string, number>,
          avgTimeToFirstCommitMinutes: null
        }
      }
    } catch (telemetryError) {
      // P0-G Part F: Propagate AuthError instead of returning empty Real
      if (telemetryError instanceof Error && telemetryError.name === 'AuthError') {
        throw telemetryError
      }
      console.error('[metricsFacade] Live telemetry summary fetch failed — returning empty Real (no simulator fallback):', telemetryError)
      try {
        const store = useMetricsFacadeStore()
        store.telemetryUsedInSummary = false
      } catch (e) {
        // Store not available, skip
      }
      return {
        dataSource: 'Real' as DataSource,
        totals: {} as Record<string, number>,
        avgTimeToFirstCommitMinutes: null
      }
    }
  }
  
  // CR1 Patch C: Live mode must fail closed — NO simulator fallback.
  // This code is now unreachable in live mode (the live block above returns
  // in all paths), but kept as a safety net.
  if (isLive) {
    if (METRICS_DEBUG) console.info('[metricsFacade] ⚠️ Live mode fallback — returning empty Real (no simulator)')
    try {
      const store = useMetricsFacadeStore()
      store.telemetryUsedInSummary = false
    } catch (e) {
      // Store not available, skip
    }
    return {
      dataSource: 'Real' as DataSource,
      totals: {} as Record<string, number>,
      avgTimeToFirstCommitMinutes: null
    }
  }

  // Simulation mode: use simulator as expected
  log('🔄 Using productivity simulator for summary')
  const simulatedData = simulateProductivityTS(query)
  const summary = buildSimulatedSummary(simulatedData.series)
  // CRITICAL: Deep clone using JSON.parse(JSON.stringify()) to prevent external mutations
  return {
    dataSource: summary.dataSource,
    totals: JSON.parse(JSON.stringify(summary.totals)),
    avgTimeToFirstCommitMinutes: summary.avgTimeToFirstCommitMinutes
  }
}

/**
 * Get both time series and summary data in a single call
 * @param query - Productivity query parameters
 * @returns Promise with both results
 */
export async function getProductivityMetrics(query: ProductivityQuery): Promise<{
  timeSeries: TSResult;
  summary: SummaryResult;
}> {
  const telemetryMode = resolveTelemetryMode()
  const isLive = telemetryMode === 'live'
  
  if (!isLive) {
    if (METRICS_DEBUG) console.info('[metricsFacade] 🎯 SIMULATION MODE (combined) — delegating to pure simulator')
  } else {
    if (METRICS_DEBUG) console.info('[metricsFacade] 🔴 LIVE TELEMETRY MODE (combined) — delegating to telemetry-only results')
  }

  // Run both calls in parallel for efficiency
  // Each call handles its own mode logic and cloning
  const [timeSeries, summary] = await Promise.all([
    getProductivityTimeSeries(query),
    getProductivitySummary(query)
  ])
  
  return { timeSeries, summary }
}

// ============================================================================
// CR-X Slice 1: Delivery Time Series (PRs merged, deployments, merge cycle)
// ============================================================================

export type DeliveryAttributionAuthority = 'org' | 'repo'

export type DeliveryTimeSeriesRow = {
  period: string
  merged_pr_count: number
  total_pr_count: number
  deployment_count: number
  successful_deployment_count: number
  failed_deployment_count: number
  deploy_success_rate: number | null
  median_merge_cycle_hours: number | null
  release_count: number
  review_count: number
  pr_reopened_count: number
  pr_review_cycles: number
  merge_rate: number | null
  count_authority: string
}

export type DeliveryTimeSeriesResult = {
  series: DeliveryTimeSeriesRow[]
  meta: {
    from: string | null
    to: string | null
    repo: string | null
    period: string
    total_weeks: number
    source: string
    attribution_authority: DeliveryAttributionAuthority
  }
}

/**
 * Fetch delivery time series from /api/delivery/timeseries.
 * Returns observed-only weekly PR merge + deployment data.
 *
 * CR-X PBT-CLEANUP-4: ERROR != EMPTY != LOADING.
 * On HTTP failure or network rejection, this function THROWS so the caller
 * can distinguish "fetch failed" from "fetch succeeded with zero rows".
 * A successful 200 with zero rows returns { series: [], meta: { source: ... } }
 * normally — that is a genuine authoritative empty state.
 */
export async function fetchDeliveryTimeSeries(
  from?: string,
  to?: string,
  repo?: string
): Promise<DeliveryTimeSeriesResult> {
  const { authenticatedFetch } = await import('../config/api')
  const { buildApiUrl } = await import('../utils/apiUrl')

  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (repo) params.set('repo', repo)

  const qs = params.toString()
  const url = buildApiUrl(`delivery/timeseries${qs ? '?' + qs : ''}`)
  const response = await authenticatedFetch(url)

  if (!response.ok) {
    if (METRICS_DEBUG) console.warn('[metricsFacade] delivery/timeseries returned', response.status)
    throw new Error(`delivery/timeseries HTTP ${response.status}`)
  }

  const data = await response.json()

  // CR-X PBT-CLEANUP-4: Validate minimum response shape at the fetch boundary.
  // A malformed payload must fail closed — no fabricated [] or zero.
  if (!data || typeof data !== 'object') {
    throw new Error('delivery/timeseries: response is not an object')
  }
  if (!Array.isArray(data.series)) {
    throw new Error('delivery/timeseries: response.series is not an array')
  }
  if (!data.meta || typeof data.meta !== 'object') {
    data.meta = {}
  }
  // Ensure attribution_authority is populated; derive from repo presence
  if (!data.meta.attribution_authority) {
    data.meta.attribution_authority = data.meta.repo ? 'repo' : 'org'
  }
  return data as DeliveryTimeSeriesResult
}

/**
 * Build a standalone delivery series from delivery time series data.
 * Delivery data is org-level (or repo-level if repo-scoped), NOT per-workflow.
 * This function creates a single labeled series — it does NOT duplicate
 * org-level values into per-workflow series.
 *
 * The series label reflects the attribution authority:
 * - "Org delivery" when attribution_authority === 'org'
 * - "<repo> delivery" when attribution_authority === 'repo'
 */
export function buildDeliverySeries(
  delivery: DeliveryTimeSeriesRow[],
  attributionAuthority: DeliveryAttributionAuthority,
  repo?: string | null
): TimeSeries[number] | null {
  if (!delivery || delivery.length === 0) return null

  const label = attributionAuthority === 'repo' && repo
    ? `${repo} delivery`
    : 'Org delivery'

  const points = delivery.map(row => ({
    t: row.period,
    merged_pr_count: row.merged_pr_count,
    deployment_count: row.deployment_count,
    deploy_success_rate: row.deploy_success_rate,
    median_merge_cycle_hours: row.median_merge_cycle_hours,
    release_count: row.release_count ?? 0,
    review_count: row.review_count ?? 0,
    pr_review_cycles: row.pr_review_cycles ?? 0,
    merge_rate: row.merge_rate ?? null,
  }))

  return {
    label,
    points,
    telemetryPointCount: points.length,
    totalPointCount: points.length,
    sessionCount: 0, // delivery is not session-based
  } as any
}

/**
 * Merge delivery time series data into existing telemetry-based series points.
 *
 * DEPRECATED: This function duplicates org-level delivery values into every
 * workflow's points, which visually implies per-workflow delivery attribution
 * that does not exist. Use buildDeliverySeries() instead to create a single
 * org-level delivery series.
 *
 * Retained only for backward compatibility — not called by useTimeSeries
 * after the CR-X R2 delivery attribution repair.
 */
export function mergeDeliveryIntoSeries(
  series: TimeSeries,
  delivery: DeliveryTimeSeriesRow[]
): TimeSeries {
  if (!delivery || delivery.length === 0) return series

  // Build lookup: "YYYY-MM-DD" -> delivery row
  const deliveryByPeriod = new Map<string, DeliveryTimeSeriesRow>()
  for (const row of delivery) {
    deliveryByPeriod.set(row.period, row)
  }

  // Merge into every tool series
  for (const toolSeries of series) {
    for (const point of toolSeries.points) {
      // Normalize point timestamp to date-only for matching
      const dateKey = typeof point.t === 'string' ? point.t.slice(0, 10) : ''
      const deliveryRow = deliveryByPeriod.get(dateKey)
      if (deliveryRow) {
        ;(point as any).merged_pr_count = deliveryRow.merged_pr_count
        ;(point as any).deployment_count = deliveryRow.deployment_count
        ;(point as any).deploy_success_rate = deliveryRow.deploy_success_rate
        ;(point as any).median_merge_cycle_hours = deliveryRow.median_merge_cycle_hours
      } else {
        // No delivery data for this period — set to null (not zero)
        ;(point as any).merged_pr_count = null
        ;(point as any).deployment_count = null
        ;(point as any).deploy_success_rate = null
        ;(point as any).median_merge_cycle_hours = null
      }
    }
  }

  return series
}

/**
 * Check if real API is available
 * @returns Promise with availability status
 */
export async function checkAPIAvailability(): Promise<boolean> {
  try {
    const response = await makeAPICall(`${API_URL}/productivity/trends?from=2024-01-01&to=2024-01-02&viewBucket=daily&scope=org`, 5000)
    return response !== null && response.ok
  } catch {
    return false
  }
}
