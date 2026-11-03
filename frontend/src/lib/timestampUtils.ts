/**
 * Shared timestamp authority — the narrowest reusable layer for UTC/local
 * timestamp semantics across all surfaces (Pilot Health, PBT, PI, etc.).
 *
 * PROBLEM (P0-B):
 *   The DB stores timestamps as `YYYY-MM-DD HH:mm:ss` (naive datetime, no
 *   timezone marker). Laravel serializes most as ISO8601 with Z (correct),
 *   but any endpoint that returns the raw value without `toISOString()`
 *   produces a string like `2026-09-03 22:07:14` that JavaScript's
 *   `new Date()` interprets as LOCAL time — causing a 4-hour display offset
 *   (UTC value shown as local without conversion).
 *
 * FIX:
 *   - `parseTimestamp()` always interprets the input as UTC, regardless of
 *     whether the input has a Z suffix, a +offset, or no timezone marker.
 *   - `formatLocal()` converts to browser-local time for display.
 *   - `humanizeFreshness()` produces bounded human-readable copy.
 *   - `formatLocalWithZone()` includes the explicit timezone abbreviation.
 *   - No hardcoded timezones. No string-subtracted hours. No telemetry mutation.
 */

/**
 * Parse a timestamp string as UTC, returning a Date object.
 *
 * Handles:
 *   - ISO8601 with Z:  "2026-09-03T22:07:14.000000Z"
 *   - ISO8601 with offset: "2026-09-03T22:07:14+00:00"
 *   - Naive datetime (no tz): "2026-09-03 22:07:14" → assumed UTC
 *   - Date-only: "2026-09-03" → midnight UTC
 */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null

  const str = String(value).trim()

  // Already has explicit timezone (Z or +offset or -offset)
  if (/Z$|[+-]\d{2}:\d{2}$/.test(str)) {
    const d = new Date(str)
    return isNaN(d.getTime()) ? null : d
  }

  // Naive datetime: "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm:ss"
  // Assume UTC — append Z so JS parses correctly
  const normalized = str.includes('T') ? str : str.replace(' ', 'T')
  const d = new Date(normalized + 'Z')
  return isNaN(d.getTime()) ? null : d
}

/**
 * Format a timestamp as browser-local time for display.
 * Returns null if the input cannot be parsed.
 */
export function formatLocal(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
): string | null {
  const date = value instanceof Date ? value : parseTimestamp(value)
  if (!date) return null
  return date.toLocaleString(undefined, options)
}

/**
 * Format a timestamp as browser-local time with explicit timezone abbreviation.
 * Example: "Sep 3, 2026, 6:07 PM EDT"
 */
export function formatLocalWithZone(
  value: string | Date | null | undefined
): string | null {
  const date = value instanceof Date ? value : parseTimestamp(value)
  if (!date) return null

  const base = date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  // Get timezone abbreviation (e.g., "EDT", "PST", "UTC")
  const tzAbbr = getTimezoneAbbreviation(date)

  return `${base} ${tzAbbr}`
}

/**
 * Get the timezone abbreviation for the browser's local timezone.
 */
export function getTimezoneAbbreviation(date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(date)
    const tzPart = parts.find(p => p.type === 'timeZoneName')
    return tzPart?.value || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Humanize a freshness/age value as bounded human-readable copy.
 *
 *   <1 min ago
 *   8 min ago
 *   2h ago
 *   3d ago
 *
 * Keeps the exact timestamp available separately for tooltips/detail views.
 */
export function humanizeFreshness(
  value: string | Date | null | undefined,
  now: Date = new Date()
): string {
  const date = value instanceof Date ? value : parseTimestamp(value)
  if (!date) return 'unknown'

  const diffMs = now.getTime() - date.getTime()

  // Future-dated: show explicit warning
  if (diffMs < 0) {
    const absMs = Math.abs(diffMs)
    if (absMs < 60_000) return 'in the future (<1 min)'
    if (absMs < 3_600_000) return `in the future (${Math.round(absMs / 60_000)} min)`
    return `in the future (${Math.round(absMs / 3_600_000)}h)`
  }

  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return '<1 min ago'
  if (minutes < 60) return `${minutes} min ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

/**
 * Calculate the freshness age in hours (for internal/debug use).
 * Returns null if the input cannot be parsed.
 */
export function freshnessAgeHours(
  value: string | Date | null | undefined,
  now: Date = new Date()
): number | null {
  const date = value instanceof Date ? value : parseTimestamp(value)
  if (!date) return null
  return (now.getTime() - date.getTime()) / 3_600_000
}

/**
 * Format a date as "YYYY-MM-DD" in UTC (for period labels, API queries).
 */
export function toUTCDateString(value: string | Date | null | undefined): string | null {
  const date = value instanceof Date ? value : parseTimestamp(value)
  if (!date) return null
  return date.toISOString().split('T')[0]
}

/**
 * Date-boundary check: does the UTC timestamp fall on a different calendar
 * date than the same moment expressed in US Eastern time?
 *
 * This is the acceptance test for the UTC next-day vs US Eastern prior-day
 * boundary defect. Example: 2026-09-03 22:00 UTC is Sep 3 in UTC but
 * Sep 3 6:00 PM EDT (still Sep 3). But 2026-09-04 03:00 UTC is Sep 4 in
 * UTC but Sep 3 11:00 PM EDT (still Sep 3).
 */
export function crossesDateBoundary(
  value: string | Date | null | undefined,
  compareTimezone: string = 'America/New_York'
): { utcDate: string; localDate: string; crosses: boolean } | null {
  const date = value instanceof Date ? value : parseTimestamp(value)
  if (!date) return null

  const utcDate = date.toISOString().split('T')[0]

  try {
    const localStr = date.toLocaleString('en-CA', {
      timeZone: compareTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return {
      utcDate,
      localDate: localStr,
      crosses: utcDate !== localStr,
    }
  } catch {
    return { utcDate, localDate: utcDate, crosses: false }
  }
}
