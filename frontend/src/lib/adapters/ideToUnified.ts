/**
 * IDE to Unified Metrics Adapter
 * 
 * Pure adapter that maps IDE series data into UnifiedEvent format.
 * No side effects, no store imports, no network calls.
 */

import { UnifiedEvent, UnifiedMetricId, ToolId, Scope, metricKind } from '../../types/unified'

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * IDE series data structure
 */
export interface IdeSeries {
  toolId: ToolId
  metric: UnifiedMetricId        // 'ide.*'
  points: { t: string; v: number }[]
}

/**
 * Parameters for mapping IDE series to unified events
 */
export interface MapParams {
  series: IdeSeries[]
  scope: Scope
  orgId?: string
  teamId?: string
  developerId?: string
}

// ============================================================================
// MAPPING LOGIC
// ============================================================================

/**
 * Maps IDE series data to unified events
 */
export function mapIdeSeriesToUnified(params: MapParams): UnifiedEvent[] {
  const { series, scope, orgId, teamId, developerId } = params
  const events: UnifiedEvent[] = []

  // Runtime guard: ensure series is an array
  if (!Array.isArray(series)) {
    console.warn('mapIdeSeriesToUnified: series must be an array')
    return []
  }

  for (const serie of series) {
    // Runtime guard: ensure serie is an object
    if (!serie || typeof serie !== 'object') {
      console.warn('mapIdeSeriesToUnified: skipping invalid series', serie)
      continue
    }

    // Runtime guard: ensure toolId is valid
    if (!serie.toolId || typeof serie.toolId !== 'string') {
      console.warn('mapIdeSeriesToUnified: skipping series without valid toolId', serie)
      continue
    }

    // Runtime guard: ensure metric is valid IDE metric
    if (!serie.metric || !serie.metric.startsWith('ide.')) {
      console.warn('mapIdeSeriesToUnified: skipping series without valid IDE metric', serie)
      continue
    }

    // Runtime guard: ensure points is an array
    if (!Array.isArray(serie.points)) {
      console.warn('mapIdeSeriesToUnified: skipping series without valid points array', serie)
      continue
    }

    // Process each point in the series
    for (const point of serie.points) {
      // Runtime guard: ensure point is an object
      if (!point || typeof point !== 'object') {
        console.warn('mapIdeSeriesToUnified: skipping invalid point', point)
        continue
      }

      // Runtime guard: ensure timestamp exists
      if (!point.t || typeof point.t !== 'string') {
        console.warn('mapIdeSeriesToUnified: skipping point without valid timestamp', point)
        continue
      }

      // Runtime guard: ensure value is a number
      if (typeof point.v !== 'number' || isNaN(point.v)) {
        console.warn('mapIdeSeriesToUnified: skipping point with invalid value', point)
        continue
      }

      // Create the unified event
      const event: UnifiedEvent = {
        metric: serie.metric,
        kind: metricKind(serie.metric),
        value: point.v,
        timestamp: point.t,
        source: 'simulator',
        scope,
        orgId,
        teamId,
        developerId,
        toolId: serie.toolId
      }

      events.push(event)
    }
  }

  return events
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validates that a series has the minimum required fields
 */
export function isValidIdeSeries(series: unknown): series is IdeSeries {
  if (!series || typeof series !== 'object') {
    return false
  }

  const s = series as Record<string, unknown>
  
  return (
    typeof s.toolId === 'string' &&
    typeof s.metric === 'string' &&
    s.metric.startsWith('ide.') &&
    Array.isArray(s.points) &&
    s.points.every((point: unknown) => 
      point && 
      typeof point === 'object' && 
      typeof (point as Record<string, unknown>).t === 'string' &&
      typeof (point as Record<string, unknown>).v === 'number'
    )
  )
}

/**
 * Filters out invalid series from an array
 */
export function filterValidSeries(series: unknown[]): IdeSeries[] {
  return series.filter(isValidIdeSeries)
}

/**
 * Gets the count of events that would be generated from series
 */
export function getEventCount(series: IdeSeries[]): number {
  let count = 0
  
  for (const serie of series) {
    count += serie.points.length
  }
  
  return count
}

/**
 * Groups events by tool for analysis
 */
export function groupEventsByTool(events: UnifiedEvent[]): Record<ToolId, UnifiedEvent[]> {
  const grouped: Record<string, UnifiedEvent[]> = {}
  
  for (const event of events) {
    if (event.toolId) {
      if (!grouped[event.toolId]) {
        grouped[event.toolId] = []
      }
      grouped[event.toolId].push(event)
    }
  }
  
  return grouped as Record<ToolId, UnifiedEvent[]>
}

/**
 * Groups events by metric for analysis
 */
export function groupEventsByMetric(events: UnifiedEvent[]): Record<UnifiedMetricId, UnifiedEvent[]> {
  const grouped: Record<string, UnifiedEvent[]> = {}
  
  for (const event of events) {
    if (!grouped[event.metric]) {
      grouped[event.metric] = []
    }
    grouped[event.metric].push(event)
  }
  
  return grouped as Record<UnifiedMetricId, UnifiedEvent[]>
}

/**
 * Gets unique tools from events
 */
export function getUniqueTools(events: UnifiedEvent[]): ToolId[] {
  const tools = new Set<ToolId>()
  
  for (const event of events) {
    if (event.toolId) {
      tools.add(event.toolId)
    }
  }
  
  return Array.from(tools)
}

/**
 * Filters events by tool
 */
export function filterEventsByTool(events: UnifiedEvent[], toolId: ToolId): UnifiedEvent[] {
  return events.filter(event => event.toolId === toolId)
}

/**
 * Filters events by metric
 */
export function filterEventsByMetric(events: UnifiedEvent[], metric: UnifiedMetricId): UnifiedEvent[] {
  return events.filter(event => event.metric === metric)
}

/**
 * Gets the time range of events
 */
export function getEventTimeRange(events: UnifiedEvent[]): { min: string; max: string } | null {
  if (events.length === 0) {
    return null
  }

  const timestamps = events.map(event => event.timestamp).sort()
  return {
    min: timestamps[0],
    max: timestamps[timestamps.length - 1]
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Creates a mock IDE series for testing
 */
export function createMockIdeSeries(overrides: Partial<IdeSeries> = {}): IdeSeries {
  return {
    toolId: 'cursor',
    metric: 'ide.ai_suggestions_accepted',
    points: [
      { t: new Date().toISOString(), v: 10 },
      { t: new Date(Date.now() - 86400000).toISOString(), v: 8 }
    ],
    ...overrides
  }
}

/**
 * Creates mock map parameters for testing
 */
export function createMockMapParams(overrides: Partial<MapParams> = {}): MapParams {
  return {
    series: [createMockIdeSeries()],
    scope: 'org',
    orgId: 'test-org',
    teamId: 'test-team',
    developerId: 'test-dev',
    ...overrides
  }
}

/**
 * Creates a mock unified event for testing
 */
export function createMockUnifiedEvent(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return {
    metric: 'ide.ai_suggestions_accepted',
    kind: 'COUNT',
    value: 10,
    timestamp: new Date().toISOString(),
    source: 'simulator',
    scope: 'org',
    orgId: 'test-org',
    toolId: 'cursor',
    ...overrides
  }
}






