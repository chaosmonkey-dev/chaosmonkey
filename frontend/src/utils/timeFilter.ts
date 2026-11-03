/**
 * Time Filter Normalization Utility
 * 
 * Provides consistent time filter mapping across the application
 * Reused from EngOutput.vue normalizeExternalTimeFilter
 */

export type TimeFilter = 'week' | 'month' | 'quarter' | 'all'

/**
 * Normalize external time filter to GitHub-compatible values
 * Maps Productivity filter values to GitHub API time_filter parameter
 */
export function normalizeTimeFilter(raw: any): TimeFilter {
  const v = (raw || '').toLowerCase()

  // Map ProductivityOverTime values → GitHub API-friendly values
  if (v === 'week' || v === 'wow') return 'week'
  if (v === 'month' || v === 'mom') return 'month'
  if (v === 'quarter' || v === 'qoq') return 'quarter'
  if (v === 'all') return 'all'

  // Map "hour", "day", "custom", etc. to something safe
  if (v === 'hour' || v === 'hoh' || v === 'day' || v === 'dod' || v === 'custom') {
    return 'week'
  }

  // Fallback
  return 'all'
}

/**
 * Derive GitHub time filter from dashboard time comparison mode
 */
export function deriveGitHubTimeFilter(timeComparison: string): TimeFilter {
  const normalized = normalizeTimeFilter(timeComparison)
  
  console.log(`[TIME_FILTER] Derived GitHub filter: ${normalized} from comparison: ${timeComparison}`)
  
  return normalized
}
