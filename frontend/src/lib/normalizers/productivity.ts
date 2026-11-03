import type { TimeSeries, ToolSeries } from '../../types/metrics'

/**
 * Normalize raw productivity trends data into a consistent TimeSeries format
 * @param raw - Raw data from API or other sources
 * @returns Normalized TimeSeries sorted by timestamp ascending
 */
export function normalizeTrends(raw: any): TimeSeries {
  // Runtime guard: validate input
  if (!raw || typeof raw !== 'object') {
    console.warn('normalizeTrends: Invalid input, returning empty series')
    return []
  }

  try {
    // If API already returns tool series (label + points), passthrough with minimal validation.
    if (Array.isArray(raw) && raw.length > 0 && raw.every((x: any) => x && typeof x === 'object' && 'label' in x && 'points' in x)) {
      return raw as TimeSeries
    }

    // Legacy: normalize into a single "org" tool series of {t,v} points.
    const points: Array<{ t: string; v: number }> = []
    
    // Handle different possible data structures
    const ingest = (arr: any[]) => {
      arr.forEach((point, index) => {
        if (point && typeof point === 'object') {
          const normalized = normalizeDataPoint(point, index)
          if (normalized) {
            points.push({ t: normalized.ts, v: normalized.value })
          }
        }
      })
    }

    if (Array.isArray(raw)) ingest(raw)
    else if (raw.data && Array.isArray(raw.data)) ingest(raw.data)
    else if (raw.series && Array.isArray(raw.series)) ingest(raw.series)
    else if (raw.trends && Array.isArray(raw.trends)) ingest(raw.trends)

    const sorted = points.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
    const toolSeries: ToolSeries = { label: 'org', points: sorted }
    return [toolSeries]
  } catch (error) {
    console.error('normalizeTrends: Error during normalization:', error)
    return []
  }
}

/**
 * Normalize raw productivity summary data into consistent totals format
 * @param raw - Raw data from API or other sources
 * @returns Normalized totals object
 */
export function normalizeSummary(raw: any): { totals: Record<string, number> } {
  // Runtime guard: validate input
  if (!raw || typeof raw !== 'object') {
    console.warn('normalizeSummary: Invalid input, returning empty totals')
    return { totals: {} }
  }

  try {
    const totals: Record<string, number> = {}
    
    // Handle different possible data structures
    if (raw.totals && typeof raw.totals === 'object') {
      // Direct totals structure
      Object.entries(raw.totals).forEach(([key, value]) => {
        if (typeof value === 'number' && !isNaN(value)) {
          totals[key] = value
        }
      })
    } else if (raw.summary && typeof raw.summary === 'object') {
      // Summary structure
      Object.entries(raw.summary).forEach(([key, value]) => {
        if (typeof value === 'number' && !isNaN(value)) {
          totals[key] = value
        }
      })
    } else if (raw.metrics && typeof raw.metrics === 'object') {
      // Metrics structure
      Object.entries(raw.metrics).forEach(([key, value]) => {
        if (typeof value === 'number' && !isNaN(value)) {
          totals[key] = value
        }
      })
    } else {
      // Try to extract numeric values from root level
      Object.entries(raw).forEach(([key, value]) => {
        if (typeof value === 'number' && !isNaN(value)) {
          totals[key] = value
        }
      })
    }

    return { totals }
  } catch (error) {
    console.error('normalizeSummary: Error during normalization:', error)
    return { totals: {} }
  }
}

/**
 * Normalize a single data point with defensive programming
 * @param point - Raw data point
 * @param index - Index for fallback timestamp
 * @returns Normalized SeriesPoint or null if invalid
 */
function normalizeDataPoint(point: any, index: number): { ts: string; value: number } | null {
  try {
    // Extract timestamp with multiple fallback strategies
    let ts = ''
    
    if (point.ts && isValidTimestamp(point.ts)) {
      ts = point.ts
    } else if (point.timestamp && isValidTimestamp(point.timestamp)) {
      ts = point.timestamp
    } else if (point.date && isValidTimestamp(point.date)) {
      ts = point.date
    } else if (point.time && isValidTimestamp(point.time)) {
      ts = point.time
    } else {
      // Fallback to current date + index offset
      const fallbackDate = new Date()
      fallbackDate.setDate(fallbackDate.getDate() + index)
      ts = fallbackDate.toISOString()
    }

    // Extract value with validation
    let value = 0
    
    if (typeof point.value === 'number' && !isNaN(point.value)) {
      value = point.value
    } else if (typeof point.count === 'number' && !isNaN(point.count)) {
      value = point.count
    } else if (typeof point.amount === 'number' && !isNaN(point.amount)) {
      value = point.amount
    } else if (typeof point.total === 'number' && !isNaN(point.total)) {
      value = point.total
    } else if (typeof point.metric === 'number' && !isNaN(point.metric)) {
      value = point.metric
    }

    return { ts, value }
  } catch (error) {
    console.warn('normalizeDataPoint: Error normalizing point:', error, point)
    return null
  }
}

/**
 * Validate if a timestamp string is valid
 * @param timestamp - Timestamp string to validate
 * @returns True if valid timestamp
 */
function isValidTimestamp(timestamp: any): boolean {
  if (typeof timestamp !== 'string') return false
  
  try {
    const date = new Date(timestamp)
    return date instanceof Date && !isNaN(date.getTime())
  } catch {
    return false
  }
}
