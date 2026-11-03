/**
 * 🔍 DEV-ONLY Performance Instrumentation
 * 
 * Lightweight performance measurement utility for development.
 * Tree-shakeable and disabled in production builds.
 * 
 * Usage:
 *   import { mark, measure, timeAsync, count } from '../lib/perf/devPerf'
 *   mark('dashboards_mount_start')
 *   measure('dashboards_mount', 'dashboards_mount_start', 'dashboards_mount_end')
 *   const result = await timeAsync('github_fetch', () => fetchGitHubMetrics())
 *   count('component_render')
 */

// DEV-only guard - entire module tree-shakes out in production
const DEV_ENABLED = (import.meta as any).env?.DEV || import.meta.env.DEV
// Console output gate — quiet unless explicitly enabled
const PERF_LOG_ENABLED = DEV_ENABLED && ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true'

// Performance API wrapper with DEV guard
const perf = DEV_ENABLED ? performance : {
  mark: () => {},
  measure: () => {},
  now: () => 0,
  getEntriesByName: () => [],
  clearMarks: () => {},
  clearMeasures: () => {}
} as unknown as Performance

// Throttled logging utility
class ThrottledLogger {
  private lastLog = new Map<string, number>()
  private readonly THROTTLE_MS = 5000

  log(key: string, message: string) {
    if (!DEV_ENABLED) return

    const now = Date.now()
    const last = this.lastLog.get(key) || 0
    
    if (now - last > this.THROTTLE_MS) {
      if (PERF_LOG_ENABLED) console.log(`[CM_PERF] ${message}`)
      this.lastLog.set(key, now)
    }
  }
}

const throttledLogger = new ThrottledLogger()

// Counter storage
const counters = new Map<string, number>()

/**
 * Create a performance mark
 */
export function mark(name: string): void {
  if (!DEV_ENABLED) return
  perf.mark(name)
}

/**
 * Measure time between two marks
 */
export function measure(name: string, startMark: string, endMark?: string): void {
  if (!DEV_ENABLED) return
  
  try {
    perf.measure(name, startMark, endMark)
    const entries = perf.getEntriesByName(name, 'measure')
    if (entries.length > 0) {
      const duration = entries[entries.length - 1].duration
      if (PERF_LOG_ENABLED) console.log(`[CM_PERF] ${name}: ${duration.toFixed(2)}ms`)
    }
  } catch (error) {
    console.warn(`[CM_PERF] Failed to measure ${name}:`, error)
  }
}

/**
 * Time an async function and log duration
 */
export async function timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!DEV_ENABLED) return fn()

  const startMark = `${name}_start`
  const endMark = `${name}_end`
  
  mark(startMark)
  
  try {
    const result = await fn()
    mark(endMark)
    measure(name, startMark, endMark)
    return result
  } catch (error) {
    mark(endMark)
    measure(name, startMark, endMark)
    throw error
  }
}

/**
 * Increment and log a counter (throttled)
 */
export function count(name: string): void {
  if (!DEV_ENABLED) return

  const current = counters.get(name) || 0
  const next = current + 1
  counters.set(name, next)
  
  throttledLogger.log(name, `${name}: ${next}`)
}

/**
 * Get current counter value
 */
export function getCount(name: string): number {
  return counters.get(name) || 0
}

/**
 * Log a performance summary
 */
export function logSummary(metrics: Record<string, any>): void {
  if (!DEV_ENABLED) return
  
  if (!PERF_LOG_ENABLED) return

  console.log(`[CM_PERF] === PERFORMANCE SUMMARY ===`)
  Object.entries(metrics).forEach(([key, value]) => {
    console.log(`[CM_PERF] ${key}: ${value}`)
  })
  console.log(`[CM_PERF] === END SUMMARY ===`)
}

/**
 * Clear all marks and measures
 */
export function clear(): void {
  if (!DEV_ENABLED) return
  
  try {
    perf.clearMarks()
    perf.clearMeasures()
    counters.clear()
  } catch (error) {
    // Ignore cleanup errors
  }
}
