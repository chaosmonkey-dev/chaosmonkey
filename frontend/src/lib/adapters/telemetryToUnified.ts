// 🔥 P1: Gate noisy PBT logs behind debug flag
const PBT_DEBUG = (import.meta.env.VITE_PBT_DEBUG ?? 'false') === 'true'

import { finiteNumberOrNull } from '../workflowIdentity'
import { authenticatedFetch } from '../../config/api'
import { resolveSurface, isMetricAvailable, type SurfaceCapability } from '../surfaceAgentContract'
import { ALL_TIME_START } from '../../stores/analysisContext'

type TelemetryEvent = {
  event_type: string
  count?: number
  duration_ms?: number
  timestamp?: string
  metadata?: Record<string, unknown>
  source?: string
  tool_id?: string
  tool?: string
  payload?: Record<string, unknown>
}

type UnifiedTelemetryRecord = {
  period: string
  tool: string
  developer?: string
  AI_suggestions_accepted: number | null
  AI_usage_duration_minutes: number | null
  idle_time_minutes: number | null
  active_coding_time_minutes: number | null
  average_session_length_minutes: number | null
  files_edited_per_session: number | null
  commits_per_session: number | null
  time_to_first_commit_minutes: number | null
  // Derived ratio metrics (computed from base metrics)
  active_coding_ratio: number | null
  ai_usage_ratio: number | null
  idle_ratio: number | null
  // New session metrics derived from real session events (segment_type: "session")
  activeCodingMs: number | null // Total active coding time in milliseconds from real sessions
  sessionCount: number // Count of real session events (not legacy intervals)
  // Time to First Commit (TTFC) metrics from real session events
  avgTimeToFirstCommitMs?: number | null // Average TTFC in milliseconds
  avgTimeToFirstCommitMinutes?: number | null // Average TTFC in minutes
  source: 'telemetry'
}

type CanonicalMetadata = {
  canonical_population_count: number
  session_count_by_tool: Record<string, number>
  tools_in_population: string[]
  periods_returned: number
  tools_returned: number
  format: string
  period: string
  latest_observed_at?: string | null
  group_by?: 'developer'
  groups_in_population?: string[]
  session_count_by_group?: Record<string, number>
  developer_attributed_sessions?: number
  developer_unattributed_sessions?: number
}

function normalizeCanonicalMetadata(metadata: any): CanonicalMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null

  const normalized: CanonicalMetadata = { ...metadata }
  if (Array.isArray(normalized.groups_in_population)) {
    normalized.groups_in_population = normalized.groups_in_population
      .map((group: unknown) => String(group ?? ''))
      .filter((group: string) => group !== '')
  }
  if (normalized.session_count_by_group && typeof normalized.session_count_by_group === 'object') {
    normalized.session_count_by_group = Object.fromEntries(
      Object.entries(normalized.session_count_by_group).map(([group, count]) => [String(group), count as number])
    )
  }
  return normalized
}

function normalizeDeveloperKey(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

export type UnifiedTelemetryResult = {
  records: UnifiedTelemetryRecord[]
  metadata: CanonicalMetadata | null
}

const TELEMETRY_ENDPOINT = '/api/telemetry'

function getToolId(evt: TelemetryEvent): string {
  // CRITICAL: Check for Devin indicators FIRST (before VS Code fallback)
  // Devin runs on VS Code, so editor_source may be 'vscode' but appName/uriScheme reveal true identity
  const appName = evt.metadata?.appName || evt.appName
  const uriScheme = evt.metadata?.uriScheme || evt.uriScheme
  const editorSource = evt.metadata?.editor_source || evt.editor_source
  
  // Priority 1: uriScheme (most reliable)
  if (uriScheme && String(uriScheme).toLowerCase().includes('devin')) {
    return 'devin'
  }
  
  // Priority 2: appName
  if (appName && String(appName).toLowerCase().includes('devin')) {
    return 'devin'
  }
  
  // Priority 3: Check extension path in metadata
  const extensionPath = evt.metadata?.extensionPath || evt.extensionPath
  if (extensionPath && String(extensionPath).includes('.devin')) {
    return 'devin'
  }
  
  // Priority 4: Standard tool fields (after Devin check)
  return (
    evt.tool ||
    evt.tool_id ||
    evt.metadata?.tool ||
    evt.metadata?.ide ||
    evt.metadata?.ide_id ||
    editorSource ||
    evt.source ||
    'unknown'
  ) as string
}

function getTimestamp(evt: TelemetryEvent): string | undefined {
  return (
    evt.timestamp ||
    (typeof evt.metadata?.timestamp === 'string' ? evt.metadata.timestamp : undefined)
  )
}

function bucketTimestamp(timestamp: string | undefined, period: 'day' | 'week'): string {
  if (!timestamp) return 'unknown'
  try {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) {
      throw new Error('Invalid timestamp')
    }
    if (period === 'week') {
      const day = date.getUTCDay()
      const diff = date.getUTCDate() - day
      const weekStart = new Date(date)
      weekStart.setUTCDate(diff)
      weekStart.setUTCHours(0, 0, 0, 0)
      return weekStart.toISOString().split('T')[0]
    }
    return date.toISOString().split('T')[0]
  } catch (error) {
    console.warn('[telemetryToUnified] Failed to bucket timestamp:', timestamp, error)
    return 'unknown'
  }
}

function safeNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : fallback
}

/**
 * Type guard: Check if an event is a real session event (segment_type: "session")
 * Only these events should be used for session metrics going forward.
 */
function isRealSessionEvent(e: TelemetryEvent): boolean {
  if (e.event_type !== 'session') return false
  const segmentType = e.metadata?.segment_type
  // We ONLY accept segment_type === "session" as a real session event.
  // Missing segment_type on old events is treated as legacy and ignored.
  return segmentType === 'session'
}

/**
 * Type guard: Check if an event is a legacy interval session event
 * These should be completely ignored in metrics calculations.
 */
function isLegacyIntervalSession(e: TelemetryEvent): boolean {
  return e.event_type === 'session' && e.metadata?.segment_type === 'interval'
}

function aggregateEvents(
  events: TelemetryEvent[],
  period: 'day' | 'week'
): UnifiedTelemetryRecord[] {
  // Debug: Count event types in payload
  const eventTypeCounts: Record<string, number> = {}
  for (const event of events) {
    const eventType = event.event_type || 'unknown'
    eventTypeCounts[eventType] = (eventTypeCounts[eventType] ?? 0) + 1
  }
  console.debug('[telemetryToUnified] Event type counts in payload:', eventTypeCounts)
  
  // CRITICAL: Log date bounds to verify current day is included
  if (events.length > 0) {
    const timestamps = events
      .map(evt => getTimestamp(evt))
      .filter((ts) => ts != null && ts !== undefined)
      .map(ts => new Date(ts).getTime())
      .filter(ts => !Number.isNaN(ts))
    
    if (timestamps.length > 0) {
      const minTimestamp = new Date(Math.min(...timestamps)).toISOString()
      const maxTimestamp = new Date(Math.max(...timestamps)).toISOString()
      
      // Collect all unique bucket keys for debugging
      const uniqueBuckets = new Set()
      events.forEach(evt => {
        const bucketKey = bucketTimestamp(getTimestamp(evt), period)
        if (bucketKey !== 'unknown') {
          uniqueBuckets.add(bucketKey)
        }
      })
      
      console.debug('[telemetryToUnified] Date bounds in payload:', {
        minTimestamp,
        maxTimestamp,
        eventCount: events.length,
        validTimestampCount: timestamps.length,
        bucketKeys: Array.from(uniqueBuckets).sort()
      })
    }
  }
  
  const buckets = new Map<string, UnifiedTelemetryRecord>()
  let fileEditCount = 0
  let aiAcceptCount = 0
  let sessionDurationMinutes = 0
  let sessionEventCount = 0
  let commitCount = 0
  
  // Track real vs legacy sessions for debug logging
  let realSessionEvents: TelemetryEvent[] = []
  let legacyIntervalSessions: TelemetryEvent[] = []
  // Track TTFC values per bucket (tool+period)
  const ttfcByBucket = new Map<string, number[]>()
  // Track AI usage duration values per bucket (tool+period)
  const aiUsageDurationByBucket = new Map<string, number[]>()
  // Track active coding duration values per bucket (tool+period)
  const activeCodingDurationByBucket = new Map<string, number[]>()
  // Track idle time values per bucket (tool+period)
  const idleTimeByBucket = new Map<string, number[]>()
  
  for (const evt of events) {
    const tool = getToolId(evt)
    const bucketKey = bucketTimestamp(getTimestamp(evt), period)
    const key = `${tool}::${bucketKey}`

    if (!buckets.has(key)) {
      buckets.set(key, {
        period: bucketKey,
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
        activeCodingMs: 0, // Total active coding time from real sessions
        sessionCount: 0, // Count of real session events
        avgTimeToFirstCommitMs: null, // Average TTFC in milliseconds
        avgTimeToFirstCommitMinutes: null, // Average TTFC in minutes
        source: 'telemetry'
      })
    }

    const record = buckets.get(key)!
    const eventType = evt.event_type || evt.metadata?.event_type
    const count = safeNumber(evt.count ?? evt.metadata?.count, 1)
    const durationMinutes = safeNumber(evt.duration_ms, 0) / 60000

    switch (eventType) {
      case 'ai_accept':
      case 'ai_suggestion.accepted':
        record.AI_suggestions_accepted += count
        aiAcceptCount += count
        break
      case 'ai_usage':
      case 'ai_usage_minutes':
        record.AI_usage_duration_minutes += durationMinutes || count
        break
      case 'idle':
        record.idle_time_minutes += durationMinutes || count
        break
      case 'session':
        // CRITICAL: Filter out legacy interval sessions completely
        if (isLegacyIntervalSession(evt)) {
          legacyIntervalSessions.push(evt)
          // Skip legacy interval segments - they are no longer used for metrics
          break
        }
        
        // Only process real session events (segment_type = 'session')
        if (isRealSessionEvent(evt)) {
          const durationMs = safeNumber(evt.duration_ms, 0)
          
          if (durationMs > 0) {
            realSessionEvents.push(evt)
            
            // For new model: each session event represents a complete session with duration_ms
            // Track active coding time in milliseconds
            record.activeCodingMs += durationMs
            record.sessionCount += 1
            
            // Also update average_session_length_minutes for backward compatibility
            record.average_session_length_minutes += durationMinutes
            sessionDurationMinutes += durationMinutes
            sessionEventCount++
            
            // Track TTFC value for this bucket if present
            const ttfcMs = evt.metadata?.time_to_first_commit_ms
            if (typeof ttfcMs === 'number' && !Number.isNaN(ttfcMs) && ttfcMs >= 0) {
              if (!ttfcByBucket.has(key)) {
                ttfcByBucket.set(key, [])
              }
              ttfcByBucket.get(key)!.push(ttfcMs)
            }
            
            // Track AI usage duration for this bucket if present
            const aiUsageMs = evt.metadata?.ai_usage_duration_ms
            if (typeof aiUsageMs === 'number' && !Number.isNaN(aiUsageMs) && aiUsageMs >= 0) {
              if (!aiUsageDurationByBucket.has(key)) {
                aiUsageDurationByBucket.set(key, [])
              }
              aiUsageDurationByBucket.get(key)!.push(aiUsageMs)
            }
            
            // Track active coding duration for this bucket if present
            // CR-X 1B.1: Suppress unavailable fields per surfaceAgentContract.
            // Even if the DB has a value (stale/seeded), the contract is authority.
            const surface = resolveSurface(tool)
            const activeCodingMs = evt.metadata?.active_coding_duration_ms
            if (typeof activeCodingMs === 'number' && !Number.isNaN(activeCodingMs) && activeCodingMs >= 0
                && isMetricAvailable(surface, 'active_coding_duration_ms')) {
              if (!activeCodingDurationByBucket.has(key)) {
                activeCodingDurationByBucket.set(key, [])
              }
              activeCodingDurationByBucket.get(key)!.push(activeCodingMs)
            }

            // Track idle time for this bucket if present
            // CR-X 1B.1: Suppress if unavailable per contract
            const idleMs = evt.metadata?.idle_time_ms
            if (typeof idleMs === 'number' && !Number.isNaN(idleMs) && idleMs >= 0
                && isMetricAvailable(surface, 'idle_time_ms')) {
              if (!idleTimeByBucket.has(key)) {
                idleTimeByBucket.set(key, [])
              }
              idleTimeByBucket.get(key)!.push(idleMs)
            }
          }
        } else {
          // Event has event_type='session' but segment_type is neither 'session' nor 'interval'
          // This might be legacy data without segment_type. Ignore it to be safe.
        }
        break
      case 'file_edit':
        // CR-X 1B.1: Suppress file_edit count for terminal surfaces (file_save_count unavailable)
        if (isMetricAvailable(resolveSurface(tool), 'file_save_count')) {
          record.files_edited_per_session += count
          fileEditCount += count
        }
        break
      case 'commit':
        record.commits_per_session += count
        commitCount += count
        break
      case 'time_to_first_commit':
        record.time_to_first_commit_minutes += durationMinutes || count
        break
      default:
        break
    }
  }

  if (fileEditCount > 0) {
    if (PBT_DEBUG) console.info(
      `[telemetryToUnified] Mapped ${fileEditCount} file_edit events → files_edited_per_session across ${buckets.size} tool+period buckets`
    )
  }

  if (aiAcceptCount > 0) {
    if (PBT_DEBUG) console.info(
      `[telemetryToUnified] Mapped ${aiAcceptCount} ai_accept events → AI_suggestions_accepted across ${buckets.size} tool+period buckets`
    )
  }

  // Debug logging for session metrics (guarded to avoid spam)
  if (realSessionEvents.length > 0 || legacyIntervalSessions.length > 0) {
    const totalActiveCodingMs = Array.from(buckets.values()).reduce((sum, r) => sum + r.activeCodingMs, 0)
    const totalSessionCount = Array.from(buckets.values()).reduce((sum, r) => sum + r.sessionCount, 0)
    const totalActiveCodingHours = (totalActiveCodingMs / 3600000).toFixed(2)
    
    if (PBT_DEBUG) console.info(
      `[telemetryToUnified] Session metrics: ${totalSessionCount} real sessions, ${totalActiveCodingHours} hours active coding time (${totalActiveCodingMs}ms)`
    )
  }
  
  if (sessionEventCount > 0) {
    const avgSessionMinutes = sessionEventCount > 0 ? sessionDurationMinutes / sessionEventCount : 0
    if (PBT_DEBUG) console.info(
      `[telemetryToUnified] Mapped ${sessionEventCount} real session events → average_session_length_minutes (total: ${sessionDurationMinutes.toFixed(2)} min, avg: ${avgSessionMinutes.toFixed(2)} min) across ${buckets.size} tool+period buckets`
    )
    if (PBT_DEBUG) console.info(
      `[telemetryToUnified] NOTE: Using new session model (segment_type='session') - each event represents a complete session with duration_ms`
    )
  }

  if (commitCount > 0) {
    if (PBT_DEBUG) console.info(
      `[telemetryToUnified] Mapped ${commitCount} commit events → commits_per_session across ${buckets.size} tool+period buckets`
    )
  }

  // Calculate Time to First Commit (TTFC) per bucket (tool+period combination)
  // Use the TTFC values we tracked during event processing
  buckets.forEach((record, bucketKey) => {
    const timeToFirstCommitValues = ttfcByBucket.get(bucketKey) || []

    // Calculate average TTFC for this bucket
    const avgTimeToFirstCommitMs =
      timeToFirstCommitValues.length > 0
        ? timeToFirstCommitValues.reduce((sum, v) => sum + v, 0) / timeToFirstCommitValues.length
        : null

    const avgTimeToFirstCommitMinutes =
      avgTimeToFirstCommitMs != null ? avgTimeToFirstCommitMs / 60000 : null

    // Assign to record
    record.avgTimeToFirstCommitMs = avgTimeToFirstCommitMs
    record.avgTimeToFirstCommitMinutes = avgTimeToFirstCommitMinutes
    
    // CRITICAL: Also assign to time_to_first_commit_minutes field for time series pipeline
    // This ensures TTFC flows through the same telemetry pipeline as other metrics
    if (avgTimeToFirstCommitMinutes != null) {
      record.time_to_first_commit_minutes = avgTimeToFirstCommitMinutes
    } else {
      // Set to 0 if no TTFC data (to match other numeric fields)
      record.time_to_first_commit_minutes = 0
    }

    // Calculate average AI usage duration for this bucket
    const aiUsageDurationValues = aiUsageDurationByBucket.get(bucketKey) || []

    if (aiUsageDurationValues.length > 0) {
      const avgAiUsageMs = aiUsageDurationValues.reduce((sum, v) => sum + v, 0) / aiUsageDurationValues.length
      const avgAiUsageMinutes = avgAiUsageMs / 60000

      // Assign to AI_usage_duration_minutes field for time series pipeline
      record.AI_usage_duration_minutes = avgAiUsageMinutes
    } else {
      // No AI usage data for this bucket - leave at 0 (initialized value)
      record.AI_usage_duration_minutes = 0
    }

    // Calculate average active coding time for this bucket
    const activeCodingValues = activeCodingDurationByBucket.get(bucketKey) || []

    if (activeCodingValues.length > 0) {
      const avgActiveCodingMs = activeCodingValues.reduce((sum, v) => sum + v, 0) / activeCodingValues.length
      const avgActiveCodingMinutes = avgActiveCodingMs / 60000

      // Assign to active_coding_time_minutes field for time series pipeline
      record.active_coding_time_minutes = avgActiveCodingMinutes
    } else {
      // No active coding data for this bucket - leave at 0
      record.active_coding_time_minutes = 0
    }

    // Calculate average idle time for this bucket
    const idleTimeValues = idleTimeByBucket.get(bucketKey) || []

    if (idleTimeValues.length > 0) {
      const avgIdleMs = idleTimeValues.reduce((sum, v) => sum + v, 0) / idleTimeValues.length
      const avgIdleMinutes = avgIdleMs / 60000

      // Assign to idle_time_minutes field for time series pipeline
      record.idle_time_minutes = avgIdleMinutes
    } else {
      // No idle time data for this bucket - leave at 0
      record.idle_time_minutes = 0
    }
  })

  // Overall TTFC summary logging
  const allTimeToFirstCommitValues = Array.from(ttfcByBucket.values()).flat()

  if (allTimeToFirstCommitValues.length > 0) {
    const overallAvgMs = allTimeToFirstCommitValues.reduce((sum, v) => sum + v, 0) / allTimeToFirstCommitValues.length
    if (PBT_DEBUG) console.log('[telemetryToUnified] TTFC (overall)', {
      count: allTimeToFirstCommitValues.length,
      avgMs: overallAvgMs,
      avgMinutes: overallAvgMs / 60000,
    })
  }
  
  // Calculate commits per session properly: normalize by session count for each tool+period
  buckets.forEach((record, bucketKey) => {
    // Normalize commits per session by session count for this tool+period
    if (record.sessionCount > 0 && record.commits_per_session > 0) {
      record.commits_per_session = record.commits_per_session / record.sessionCount;
    } else if (record.sessionCount === 0 && record.commits_per_session > 0) {
      // Edge case: commits but no sessions - keep as is but log warning
      console.warn('[telemetryToUnified] Commits present but no sessions', {
        tool: record.tool,
        period: bucketKey,
        commits: record.commits_per_session,
        sessionCount: record.sessionCount
      });
    }
  });

  // Calculate derived ratios with divide-by-zero guards
  buckets.forEach((record, bucketKey) => {
    const sessionLength = record.average_session_length_minutes;
    
    // Guard against divide-by-zero: return 0 if session length is 0 or invalid
    if (sessionLength > 0 && Number.isFinite(sessionLength)) {
      // Active Coding Ratio = active_coding_time_minutes / average_session_length_minutes
      record.active_coding_ratio = record.active_coding_time_minutes / sessionLength;
      
      // AI Usage Ratio = AI_usage_duration_minutes / average_session_length_minutes
      record.ai_usage_ratio = record.AI_usage_duration_minutes / sessionLength;
      
      // Idle Ratio = idle_time_minutes / average_session_length_minutes
      record.idle_ratio = record.idle_time_minutes / sessionLength;
    } else {
      // No valid session length, set ratios to 0
      record.active_coding_ratio = 0;
      record.ai_usage_ratio = 0;
      record.idle_ratio = 0;
    }
  });

  return Array.from(buckets.values())
}

async function fetchTelemetryEvents(
  period: 'day' | 'week',
  fromDate?: string,
  toDate?: string
): Promise<TelemetryEvent[]> {
  // CRITICAL: Use explicit from/to date range if provided (respects user-selected time filter)
  // This ensures Live mode uses ALL data within the selected time window, not just "fresh" events
  let url = `${TELEMETRY_ENDPOINT}?limit=500`
  
  // CRITICAL: Request all event types needed for productivity metrics, including session events
  // The backend filters by event_type if provided, so we need to explicitly request all types
  // Since the backend only accepts a single event_type parameter, we'll make multiple requests
  // OR we can omit event_type to get all events (backend returns all if event_type is not specified)
  // For now, we'll omit event_type to get all events, which should include session events
  
  if (fromDate && toDate) {
    // CRITICAL: Make toDate inclusive by appending end-of-day time
    // The backend uses <= for toDate, so we need to ensure events on the end date are included
    // Convert "2025-11-26" to "2025-11-26T23:59:59.999Z" to include all events on that day
    const toDateInclusive = toDate.includes('T') 
      ? toDate 
      : `${toDate}T23:59:59.999Z`
    
    // Ensure fromDate is start of day if it's just a date
    const fromDateStart = fromDate.includes('T')
      ? fromDate
      : `${fromDate}T00:00:00.000Z`
    
    url += `&from=${encodeURIComponent(fromDateStart)}&to=${encodeURIComponent(toDateInclusive)}`
    if (PBT_DEBUG) console.info(`[telemetryToUnified] Using explicit date range: from=${fromDateStart}, to=${toDateInclusive} (inclusive)`)
  } else {
    // Fallback to period-based 'since' parameter - use all historical data for MVP
    const sinceParam = period === 'day' ? '24h' : 'all' // Use all historical data for Plan & Code PIs
    url += `&since=${sinceParam}`
    if (PBT_DEBUG) console.info(`[telemetryToUnified] Using period-based since parameter: ${sinceParam} (all historical data)`)
  }

  // Note: We intentionally do NOT filter by event_type here, so the backend returns ALL events
  // including file_edit, ai_accept, commit, and session events
  if (PBT_DEBUG) console.info(`[telemetryToUnified] Fetching telemetry from: ${url} (all event types)`)
  if (PBT_DEBUG) console.info(`[telemetryToUnified] Full URL for testing: ${url}`)

  try {
    // Using public endpoint - no auth required for eng leader deployments
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      credentials: 'include'
    })

    if (PBT_DEBUG) console.info(`[telemetryToUnified] Response status: ${response.status}, ok: ${response.ok}`)

    if (!response.ok) {
      console.warn('[telemetryToUnified] Telemetry fetch failed:', response.status)
      return []
    }

    const data = await response.json()
    if (PBT_DEBUG) console.info(`[telemetryToUnified] Response data type: ${Array.isArray(data) ? 'array' : typeof data}, length/keys: ${Array.isArray(data) ? data.length : Object.keys(data || {}).length}`)

    if (Array.isArray(data)) {
      if (PBT_DEBUG) console.info(`[telemetryToUnified] Received ${data.length} events directly as array`)
      if (PBT_DEBUG) console.log(`[telemetryToUnified] Sample event:`, data[0])
      return data as TelemetryEvent[]
    }

    if (data && Array.isArray(data.events)) {
      if (PBT_DEBUG) console.info(`[telemetryToUnified] Received ${data.events.length} events from data.events property`)
      return data.events as TelemetryEvent[]
    }

    // Handle sessions API response structure: {data: [...], pagination: {...}}
    if (data && Array.isArray(data.data)) {
      if (PBT_DEBUG) console.info(`[telemetryToUnified] Received ${data.data.length} events from data.data property (sessions API)`)
      if (PBT_DEBUG) console.log(`[telemetryToUnified] Sample event:`, data.data[0])
      return data.data as TelemetryEvent[]
    }

    console.warn('[telemetryToUnified] Unexpected telemetry payload shape:', data)
    console.error('[telemetryToUnified] CRITICAL: No telemetry data available for Performance Insights!')
    return []
  } catch (error) {
    console.warn('[telemetryToUnified] Telemetry fetch error:', error)
    return []
  }
}

// Legacy functions removed - Productivity V3 uses canonical endpoint only

// Cache for canonical telemetry to avoid duplicate fetches
let canonicalTelemetryCache: {
  result: UnifiedTelemetryResult | null
  timestamp: number
  key: string
} = {
  result: null,
  timestamp: 0,
  key: ''
}

const CACHE_TTL_MS = 60000 // 1 minute cache

// CR-X PI/PBT-TIME P0: In-flight dedupe map. When two callers request the
// same canonical telemetry within the same tick (e.g. initial mount + a
// watcher fire), both miss the cache and both issue duplicate HTTP
// requests. This map ensures the second caller awaits the first's
// promise instead of issuing a second request.
const inFlightCanonicalRequests = new Map<string, Promise<UnifiedTelemetryResult>>()

/** Reset the canonical telemetry cache (test-only helper). */
export function resetCanonicalTelemetryCache(): void {
  canonicalTelemetryCache = { result: null, timestamp: 0, key: '' }
  inFlightCanonicalRequests.clear()
}

/**
 * Returns a promise that rejects with AbortError when the supplied signal
 * is aborted. This lets a caller race against an in-flight shared fetch
 * without propagating its abort to other consumers of the same request.
 */
function makeSignalRejectionPromise(signal?: AbortSignal): Promise<never> | null {
  if (!signal) return null
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException(String(signal.reason ?? 'Aborted'), 'AbortError'))
      return
    }
    const onAbort = () => {
      reject(new DOMException(String(signal.reason ?? 'Aborted'), 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function fetchAndMapTelemetryToUnified(
  period: 'day' | 'week' = 'week',
  fromDate?: string,
  toDate?: string,
  toolIds?: string[],
  developerIds?: string[],
  repos?: string[],
  reportingTimezone?: string,
  signal?: AbortSignal,
  purpose: string = 'PBT_TELEMETRY',
  groupBy?: 'developer',
  cohortId?: string
): Promise<UnifiedTelemetryResult> {
  // CRITICAL: Use the canonical telemetry endpoint for consistency with AI Ops and PI
  // This ensures all three surfaces operate on the same telemetry universe
  if (PBT_DEBUG) console.info('[telemetryToUnified] Using canonical telemetry endpoint')
  if (PBT_DEBUG) console.info('[telemetryToUnified] INPUT PARAMS:', { period, fromDate, toDate, toolIds, developerIds, repos, reportingTimezone })
  
  // Build cache key from parameters.
  // CR-X P0 RUNTIME: Normalize undefined/empty-array/empty-string to a
  // single canonical form so that callers passing `repos: []` vs
  // `repos: undefined` (or `fromDate: ''` vs `fromDate: undefined`) hit
  // the same cache entry and in-flight dedupe map. Without this, the
  // dashboard's PBT time-series path (repos: []) and PBT summary path
  // (repos: undefined) produce different keys and both fire separate
  // canonical HTTP requests, amplifying load on the backend.
  const norm = (v: string[] | string | undefined): string | string[] =>
    (Array.isArray(v) && v.length === 0) || v === undefined || v === ''
      ? ''
      : (Array.isArray(v) ? [...v].sort() : v)
  const cacheKey = JSON.stringify({
    period,
    fromDate: norm(fromDate),
    toDate: norm(toDate),
    toolIds: norm(toolIds),
    developerIds: norm(developerIds),
    repos: norm(repos),
    reportingTimezone: norm(reportingTimezone),
    groupBy: norm(groupBy),
    cohortId: cohortId === 'all' ? '' : norm(cohortId),
  })
  const now = Date.now()
  
  // Return cached result if available and fresh
  if (canonicalTelemetryCache.result && 
      canonicalTelemetryCache.key === cacheKey && 
      (now - canonicalTelemetryCache.timestamp) < CACHE_TTL_MS) {
    if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] fetchAndMapTelemetryToUnified CACHE_HIT', { period, cacheKey, age: now - canonicalTelemetryCache.timestamp })
    if (PBT_DEBUG) console.info('[telemetryToUnified] Returning cached canonical telemetry result')
    return canonicalTelemetryCache.result
  }
  
  // CR-X PI/PBT-TIME P0: If an identical request is already in-flight,
  // return its promise instead of issuing a duplicate HTTP request.
  const inFlight = inFlightCanonicalRequests.get(cacheKey)
  if (inFlight) {
    if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] fetchAndMapTelemetryToUnified INFLIGHT_HIT', { period, cacheKey })
    if (PBT_DEBUG) console.info('[telemetryToUnified] Deduplicating in-flight canonical request')
    return inFlight
  }

  // Fetch fresh data
  if (import.meta.env.DEV) console.log('[CANONICAL_REQUEST] purpose=' + purpose, { period, fromDate, toDate, toolIds, developerIds, repos, reportingTimezone })
  if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] fetchAndMapTelemetryToUnified FETCH_START', { purpose, period, fromDate, toDate, toolIds, developerIds, repos, reportingTimezone, cacheKey })
  const _traceStart = performance.now()

  // CR-X P0 RUNTIME: The canonical HTTP request owns its own AbortController
  // lifetime. A caller's signal must NEVER abort a shared in-flight request
  // that other consumers are awaiting. Instead, each caller races its own
  // signal against the shared fetch promise; the underlying HTTP request
  // continues until it completes or the cache rules it unnecessary.
  const baseFetchPromise = fetchCanonicalTelemetry(period, fromDate, toDate, toolIds, developerIds, repos, reportingTimezone, groupBy, cohortId)
  const inFlightRequest = (async () => {
    try {
      return await baseFetchPromise
    } finally {
      // Clear only when the actual HTTP request settles, not when a caller's
      // signal causes the raced promise to reject.
      inFlightCanonicalRequests.delete(cacheKey)
    }
  })()
  inFlightCanonicalRequests.set(cacheKey, inFlightRequest)

  const signalRejection = makeSignalRejectionPromise(signal)
  const result = signalRejection
    ? await Promise.race([inFlightRequest, signalRejection])
    : await inFlightRequest

  if (import.meta.env.DEV) console.log('[CRX_P0_TRACE] fetchAndMapTelemetryToUnified FETCH_END', { period, cacheKey, durationMs: Math.round(performance.now() - _traceStart), recordCount: result.records.length })

  // Update cache
  canonicalTelemetryCache = {
    result,
    timestamp: now,
    key: cacheKey
  }

  if (PBT_DEBUG) console.info('[telemetryToUnified] OUTPUT:', {
    recordCount: result.records.length,
    tools: [...new Set(result.records.map(r => r.tool))],
    totalSessions: result.records.reduce((sum, r) => sum + (r.sessionCount || 0), 0),
    metadata: result.metadata
  })

  // 🔥 DATA RECONCILIATION AUDIT: Log telemetryToUnified output
  if (PBT_DEBUG) console.log('[AUDIT:TELEMETRY_TO_UNIFIED_OUTPUT]', {
    recordCount: result.records.length,
    tools: [...new Set(result.records.map(r => r.tool))],
    totalSessions: result.records.reduce((sum, r) => sum + (r.sessionCount || 0), 0),
    metadata: result.metadata,
    sampleRecords: result.records.slice(0, 3)
  })

  // Write to file for programmatic inspection
  try {
    const debugData = {
      stage: 'telemetryToUnified',
      timestamp: new Date().toISOString(),
      input: { period, fromDate, toDate, toolIds },
      output: {
        recordCount: result.records.length,
        tools: [...new Set(result.records.map(r => r.tool))],
        totalSessions: result.records.reduce((sum, r) => sum + (r.sessionCount || 0), 0),
        metadata: result.metadata
      }
    }
    if (PBT_DEBUG) console.log('[PIPELINE-LOG]', JSON.stringify(debugData))
  } catch (e) {
    // Ignore logging errors
  }

  return result
}

/**
 * Fetch telemetry from canonical endpoint
 * This is the authoritative source of truth for all product surfaces
 */
async function fetchCanonicalTelemetry(
  period: 'day' | 'week' = 'week',
  fromDate?: string,
  toDate?: string,
  toolIds?: string[],
  developerIds?: string[],
  repos?: string[],
  reportingTimezone?: string,
  groupBy?: 'developer',
  cohortId?: string
): Promise<UnifiedTelemetryResult> {
  // CRITICAL FIX: Backend treats empty strings as falsy and defaults to 2020-01-01
  // So we need to send explicit all-time dates when frontend signals all-time with empty strings
  // Empty string '' from frontend = send explicit all-time range to backend
  const isAllTime = fromDate === '' || toDate === ''
  
  if (isAllTime || fromDate === undefined || fromDate === null) {
    // All-time: Use earliest possible date to capture ALL historical telemetry
    fromDate = ALL_TIME_START
  }
  if (isAllTime || toDate === undefined || toDate === null) {
    // All-time: Use today's date with end-of-day time so the backend's
    // Carbon::parse() includes events later in the day.  Sending a
    // date-only string (e.g. "2026-08-28") causes the backend to parse
    // it as midnight, silently excluding same-day events.
    const now = new Date()
    const datePart = now.toISOString().split('T')[0]
    toDate = `${datePart}T23:59:59.999Z`
  } else if (toDate && !toDate.includes('T')) {
    // Ensure explicit date-only "to" values are also end-of-day inclusive.
    // CR-X P0 microfix: When reporting_timezone is supplied, send date-only
    // strings as-is — the backend will interpret them in the reporting
    // timezone and convert to UTC internally.  Do NOT append T23:59:59.999Z
    // because that would force UTC interpretation.
    if (!reportingTimezone) {
      toDate = `${toDate}T23:59:59.999Z`
    }
  } else if (fromDate && !fromDate.includes('T')) {
    // Same logic for fromDate: when reporting_timezone is present, send
    // date-only; otherwise append T00:00:00.000Z for UTC interpretation.
    if (!reportingTimezone) {
      fromDate = `${fromDate}T00:00:00.000Z`
    }
  }

  const baseUrl = (import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : ''))
    .replace(/\/$/, '')
    .replace(/\/api$/, '')
  const url = new URL(`${baseUrl}/api/telemetry/canonical`)

  // Always set from/to params (backend requires them)
  url.searchParams.set('from', fromDate)
  url.searchParams.set('to', toDate)
  url.searchParams.set('format', 'aggregated')
  url.searchParams.set('period', period)
  if (groupBy) url.searchParams.set('group_by', groupBy)
  
  // CR-X P0 microfix: Send browser reporting timezone so the backend can
  // interpret from/to as local-calendar dates and bucket accordingly.
  // When absent, backend preserves existing UTC behavior.
  if (reportingTimezone) {
    url.searchParams.set('reporting_timezone', reportingTimezone)
  }

  // Use toolIds from filter store if provided, otherwise request all tools.
  // The absence of a filter must never mean "request every provider ChaosMonkey knows about."
  // The API returns only workflows that have actual telemetry data.
  const toolsParam = toolIds && toolIds.length > 0 ? toolIds.join(',') : 'all'
  url.searchParams.set('tools', toolsParam)
  
  // P0-H: Pass developer filter as developer_ids (comma-separated array).
  // The backend canonical endpoint accepts developer_ids for multi-developer
  // filtering. Falls back to user_id for backward compatibility.
  if (developerIds && developerIds.length > 0) {
    url.searchParams.set('developer_ids', developerIds.join(','))
  }

  // P0-H: Pass repo filter as repos (comma-separated array).
  // The backend canonical endpoint accepts repos for multi-repo filtering.
  // Falls back to git_repo_url for backward compatibility.
  if (repos && repos.length > 0) {
    url.searchParams.set('repos', repos.join(','))
  }

  // K1B: cohort scope ('<id>' | 'all' | 'unassigned'). Intersects with
  // developer_ids on the backend; an invalid/stale cohort returns
  // 422 INVALID_COHORT which surfaces as a fetch error — never silently
  // dropped, never widened to org-wide.
  if (cohortId && cohortId !== 'all') {
    url.searchParams.set('cohort_id', cohortId)
  }

  if (PBT_DEBUG) console.info(`[telemetryToUnified] Fetching canonical telemetry from: ${url.toString()}`)
  if (PBT_DEBUG) console.log('[PBT_RUNTIME_ENDPOINT]', {
    endpoint: '/api/telemetry/canonical',
    isAllTime,
    fromDate,
    toDate,
    fullUrl: url.toString()
  })

  // PERF: Start timing
  const apiStart = performance.now()

  try {
    // CR-X P0 RUNTIME: Do NOT attach a default 10s AbortController timeout.
    // The PHP built-in server is single-threaded, but a client-side timeout
    // only hides the real queueing; it creates AbortError cascades that kill
    // shared in-flight requests and break AIOI/PI/PBT. The browser will wait
    // for a healthy backend response; callers may still supply their own
    // AbortSignal by racing the returned promise.
    if (PBT_DEBUG) console.log('[telemetryToUnified] Starting fetch request...')

    // Transient transport resilience: a saturated PHP dev-server worker pool
    // can make the Vite proxy fail the request with ETIMEDOUT (surfaced to the
    // browser as a 500) before it ever reaches Laravel. The request is
    // idempotent — retry once, then fall through to the existing error
    // handling below. AbortError and persistent failures are never hidden.
    const doFetch = () => authenticatedFetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    })
    let response: Response
    try {
      response = await doFetch()
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
      await new Promise(resolve => setTimeout(resolve, 800))
      response = await doFetch()
    }
    if (response.status >= 500) {
      await new Promise(resolve => setTimeout(resolve, 800))
      response = await doFetch()
    }

    const apiEnd = performance.now()
    const apiDuration = apiEnd - apiStart
    // Compact performance log
    if (PBT_DEBUG) console.log(`[PERF] API Request | ${apiDuration.toFixed(2)}ms | 1 | canonical_aggregated`)

    if (!response.ok) {
      console.error('[telemetryToUnified] Canonical telemetry fetch failed:', response.status, response.statusText)
      // K1B: cohort scope failures must be VISIBLE errors, never silently
      // degraded to an empty or org-wide population. 422 INVALID_COHORT means
      // the selected cohort is stale/archived/cross-org — surface it so the
      // UI renders an explicit error state.
      if (response.status === 422) {
        let body: any = null
        try { body = await response.clone().json() } catch { /* body optional */ }
        const code = body?.error === 'INVALID_COHORT' ? 'INVALID_COHORT' : `HTTP_${response.status}`
        const message = code === 'INVALID_COHORT'
          ? (typeof body?.message === 'string' ? body.message : 'The selected cohort is no longer available')
          : `Canonical telemetry request rejected: ${response.status}`
        const err: any = new Error(message)
        err.code = code
        err.status = response.status
        throw err
      }
      // P0-G Part F: Propagate auth errors instead of returning empty records.
      // Downstream code MUST distinguish auth errors from genuine empty data.
      const { AuthError, classifyHttpStatus, AuthErrorType } = await import('../../config/api.js')
      const errorType = classifyHttpStatus(response.status)
      if (errorType) {
        throw new AuthError(errorType, response.status, `Canonical telemetry fetch failed: ${response.status}`)
      }
      // Non-auth error — return empty (but this is NOT an auth error)
      return { records: [], metadata: null }
    }

    const jsonStart = performance.now()
    const result = await response.json()
    const jsonEnd = performance.now()
    const jsonDuration = jsonEnd - jsonStart
    if (PBT_DEBUG) console.log(`[PERF] JSON Parse | ${jsonDuration.toFixed(2)}ms | 1 | canonical_aggregated`)

    // 🔥 DATA RECONCILIATION AUDIT: Log canonical response
    if (PBT_DEBUG) console.log('[AUDIT:CANONICAL_RESPONSE]', {
      url: url.toString(),
      status: response.status,
      metadata: result.metadata,
      dataCount: result.data?.length,
      sampleData: result.data?.slice(0, 3)
    })

    if (PBT_DEBUG) console.info('[telemetryToUnified] Canonical telemetry response:', {
      canonicalPopulationCount: result.metadata?.canonical_population_count,
      sessionCountByTool: result.metadata?.session_count_by_tool,
      toolsReturned: result.metadata?.tools_returned,
      periodsReturned: result.metadata?.periods_returned,
    })

    // Write to console for programmatic inspection
    try {
      const debugData = {
        stage: 'fetchCanonicalTelemetry',
        timestamp: new Date().toISOString(),
        input: { period, fromDate, toDate, toolIds, toolsParam },
        output: {
          canonicalPopulationCount: result.metadata?.canonical_population_count,
          sessionCountByTool: result.metadata?.session_count_by_tool,
          toolsReturned: result.metadata?.tools_returned,
          periodsReturned: result.metadata?.periods_returned,
          dataLength: result.data?.length
        }
      }
      if (PBT_DEBUG) console.log('[PIPELINE-LOG]', JSON.stringify(debugData))
    } catch (e) {
      // Ignore logging errors
    }

    if (!Array.isArray(result.data)) {
      console.warn('[telemetryToUnified] Unexpected canonical response shape:', result)
      return { records: [], metadata: null }
    }

    // PERF: Start transform timing
    const transformStart = performance.now()

    // Map canonical response to UnifiedTelemetryRecord format
    const canonicalMetadata = normalizeCanonicalMetadata(result.metadata)
    const unifiedRecords: UnifiedTelemetryRecord[] = result.data.map((item: any) => {
      const sessionLength = finiteNumberOrNull(item.average_session_length_minutes)
      const activeCodingTime = finiteNumberOrNull(item.active_coding_time_minutes)
      const aiUsageTime = finiteNumberOrNull(item.ai_usage_duration_minutes)
      const idleTime = finiteNumberOrNull(item.idle_time_minutes)

      // Compute derived ratios with divide-by-zero guards
      let activeCodingRatio: number | null = null
      let aiUsageRatio: number | null = null
      let idleRatio: number | null = null

      if (sessionLength !== null && sessionLength > 0 && Number.isFinite(sessionLength)) {
        activeCodingRatio = (activeCodingTime ?? 0) / sessionLength
        aiUsageRatio = (aiUsageTime ?? 0) / sessionLength
        idleRatio = (idleTime ?? 0) / sessionLength
      }

      return {
        period: item.period,
        tool: item.tool,
        developer: normalizeDeveloperKey(item.developer),
        AI_suggestions_accepted: finiteNumberOrNull(item.ai_suggestions_accepted),
        AI_usage_duration_minutes: aiUsageTime,
        idle_time_minutes: idleTime,
        active_coding_time_minutes: activeCodingTime,
        average_session_length_minutes: sessionLength,
        files_edited_per_session: finiteNumberOrNull(item.files_edited_per_session),
        commits_per_session: finiteNumberOrNull(item.commits_per_session),
        time_to_first_commit_minutes: finiteNumberOrNull(item.time_to_first_commit_minutes),
        active_coding_ratio: activeCodingRatio,
        ai_usage_ratio: aiUsageRatio,
        idle_ratio: idleRatio,
        activeCodingMs: activeCodingTime !== null ? activeCodingTime * 60000 : null,
        sessionCount: item.session_count || 0,
        avgTimeToFirstCommitMs: item.time_to_first_commit_minutes ? item.time_to_first_commit_minutes * 60000 : null,
        avgTimeToFirstCommitMinutes: finiteNumberOrNull(item.time_to_first_commit_minutes),
        source: 'telemetry' as const,
      }
    })

    const transformEnd = performance.now()
    const transformDuration = transformEnd - transformStart
    if (PBT_DEBUG) console.log(`[PERF] Transform | ${transformDuration.toFixed(2)}ms | 1 | canonical_aggregated`)

    if (PBT_DEBUG) console.info(`[telemetryToUnified] Mapped ${unifiedRecords.length} canonical records to unified format`)
    
    // 🔥 AUDIT: Log period counts after telemetryToUnified
    const periodsByTool = new Map<string, Set<string>>()
    unifiedRecords.forEach(record => {
      if (!periodsByTool.has(record.tool)) {
        periodsByTool.set(record.tool, new Set())
      }
      periodsByTool.get(record.tool)!.add(record.period)
    })
    if (PBT_DEBUG) console.log('[AUDIT:TELEMETRY_TO_UNIFIED_PERIODS]', {
      totalRecords: unifiedRecords.length,
      periodsByTool: Object.fromEntries(
        Array.from(periodsByTool.entries()).map(([tool, periods]) => [tool, periods.size])
      ),
      totalUniquePeriods: Array.from(periodsByTool.values()).reduce((sum, periods) => sum + periods.size, 0),
      metadataPeriodsReturned: result.metadata?.periods_returned
    })
    
    // Return both records and metadata for session count calculation
    return {
      records: unifiedRecords,
      metadata: canonicalMetadata
    }

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // CR-X PBT P0: Re-throw AbortError so callers can distinguish
      // "aborted" from "genuinely empty". The PI background fetch's
      // .catch handler ignores AbortError; PBT's useTimeSeries shows
      // an explicit error state instead of hiding the failure as empty data.
      throw error
    }
    // K1B: INVALID_COHORT must fail visibly — a stale/archived cohort is an
    // error, not an empty cohort. Never degrade it to a zero population.
    if ((error as any)?.code === 'INVALID_COHORT' || (error as any)?.status === 422) {
      throw error
    }
    console.error('[telemetryToUnified] Canonical telemetry fetch error:', error)
    // NO FALLBACK: Canonical is the authoritative source for Productivity V3
    console.error('[telemetryToUnified] CRITICAL: Productivity V3 requires canonical endpoint - no fallback')
    return { records: [], metadata: null }
  }
}
