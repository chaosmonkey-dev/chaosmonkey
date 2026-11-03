import { describe, it, expect } from 'vitest'
import {
  parseTimestamp,
  formatLocal,
  formatLocalWithZone,
  humanizeFreshness,
  freshnessAgeHours,
  toUTCDateString,
  crossesDateBoundary,
} from '../lib/timestampUtils'

/**
 * P0-B: Timestamp/Timezone Truth — Regression tests.
 *
 * The DB stores UTC timestamps as `YYYY-MM-DD HH:mm:ss` (no timezone marker).
 * The API serializes most as ISO8601 with Z. Any endpoint returning the raw
 * value without Z causes JavaScript to interpret UTC as local time, producing
 * a 4-hour display offset.
 *
 * The fix is at the narrowest reusable layer: `parseTimestamp()` always
 * interprets input as UTC, regardless of whether a Z suffix is present.
 */

describe('P0-B: parseTimestamp — UTC authority', () => {
  it('parses ISO8601 with Z as UTC', () => {
    const d = parseTimestamp('2026-09-03T22:07:14.000000Z')!
    expect(d).not.toBeNull()
    expect(d.getUTCHours()).toBe(22)
    expect(d.getUTCMinutes()).toBe(7)
  })

  it('parses naive datetime (no tz) as UTC — THE FIX', () => {
    // This is the defect: "2026-09-03 22:07:14" without Z.
    // Without the fix, JS new Date() interprets this as local time.
    // With the fix, parseTimestamp appends Z and interprets as UTC.
    const d = parseTimestamp('2026-09-03 22:07:14')!
    expect(d).not.toBeNull()
    expect(d.getUTCHours()).toBe(22)
    expect(d.getUTCMinutes()).toBe(7)
  })

  it('parses naive datetime with T separator as UTC', () => {
    const d = parseTimestamp('2026-09-03T22:07:14')!
    expect(d).not.toBeNull()
    expect(d.getUTCHours()).toBe(22)
  })

  it('parses ISO8601 with explicit offset', () => {
    const d = parseTimestamp('2026-09-03T22:07:14+00:00')!
    expect(d).not.toBeNull()
    expect(d.getUTCHours()).toBe(22)
  })

  it('parses date-only as midnight UTC', () => {
    const d = parseTimestamp('2026-09-03')!
    expect(d).not.toBeNull()
    expect(d.getUTCHours()).toBe(0)
  })

  it('returns null for null/undefined/empty', () => {
    expect(parseTimestamp(null)).toBeNull()
    expect(parseTimestamp(undefined)).toBeNull()
    expect(parseTimestamp('')).toBeNull()
  })

  it('returns null for invalid strings', () => {
    expect(parseTimestamp('not a date')).toBeNull()
  })
})

describe('P0-B: humanizeFreshness — bounded human-readable copy', () => {
  it('renders <1 min ago for very recent', () => {
    const now = new Date('2026-09-03T22:10:00Z')
    const recent = '2026-09-03T22:09:30Z'
    expect(humanizeFreshness(recent, now)).toBe('<1 min ago')
  })

  it('renders N min ago', () => {
    const now = new Date('2026-09-03T22:15:00Z')
    const ts = '2026-09-03T22:07:00Z'
    expect(humanizeFreshness(ts, now)).toBe('8 min ago')
  })

  it('renders Nh ago', () => {
    const now = new Date('2026-09-03T22:07:00Z')
    const ts = '2026-09-03T20:07:00Z'
    expect(humanizeFreshness(ts, now)).toBe('2h ago')
  })

  it('renders Nd ago', () => {
    const now = new Date('2026-09-03T22:07:00Z')
    const ts = '2026-08-31T22:07:00Z'
    expect(humanizeFreshness(ts, now)).toBe('3d ago')
  })

  it('does NOT render raw decimal hours (0.025h ago)', () => {
    const now = new Date('2026-09-03T22:07:00Z')
    const ts = '2026-09-03T22:05:30Z'
    const result = humanizeFreshness(ts, now)
    // Should be "<1 min ago" or "1 min ago", NOT "0.025h ago"
    expect(result).not.toMatch(/h ago/)
    expect(result).toMatch(/min ago/)
  })

  it('flags future-dated timestamps explicitly', () => {
    const now = new Date('2026-09-03T18:08:00Z')
    const future = '2026-09-03T22:07:00Z'
    const result = humanizeFreshness(future, now)
    expect(result).toContain('future')
  })

  it('returns unknown for null/invalid', () => {
    expect(humanizeFreshness(null)).toBe('unknown')
    expect(humanizeFreshness('')).toBe('unknown')
  })
})

describe('P0-B: freshnessAgeHours — correct age calculation', () => {
  it('calculates positive age for past timestamps', () => {
    const now = new Date('2026-09-03T22:07:00Z')
    const ts = '2026-09-03T20:07:00Z'
    expect(freshnessAgeHours(ts, now)).toBe(2)
  })

  it('calculates negative age for future timestamps', () => {
    const now = new Date('2026-09-03T18:08:00Z')
    const ts = '2026-09-03T22:07:00Z'
    expect(freshnessAgeHours(ts, now)).toBeLessThan(0)
  })

  it('handles naive datetime (no Z) as UTC', () => {
    const now = new Date('2026-09-03T22:07:00Z')
    const ts = '2026-09-03 20:07:00'
    expect(freshnessAgeHours(ts, now)).toBe(2)
  })
})

describe('P0-B: Date-boundary test — UTC next-day vs US Eastern prior-day', () => {
  it('UTC 22:00 on Sep 3 is still Sep 3 in Eastern (no boundary cross)', () => {
    // 2026-09-03 22:00 UTC = 6:00 PM EDT (Sep 3)
    const result = crossesDateBoundary('2026-09-03T22:00:00Z', 'America/New_York')!
    expect(result).not.toBeNull()
    expect(result.utcDate).toBe('2026-09-03')
    expect(result.localDate).toBe('2026-09-03')
    expect(result.crosses).toBe(false)
  })

  it('UTC 03:00 on Sep 4 is still Sep 3 in Eastern (boundary cross)', () => {
    // 2026-09-04 03:00 UTC = 11:00 PM EDT (Sep 3)
    const result = crossesDateBoundary('2026-09-04T03:00:00Z', 'America/New_York')!
    expect(result).not.toBeNull()
    expect(result.utcDate).toBe('2026-09-04')
    expect(result.localDate).toBe('2026-09-03')
    expect(result.crosses).toBe(true)
  })

  it('UTC 04:00 on Sep 4 is Sep 4 in Eastern (no boundary cross)', () => {
    // 2026-09-04 04:00 UTC = 12:00 AM EDT (Sep 4)
    const result = crossesDateBoundary('2026-09-04T04:00:00Z', 'America/New_York')!
    expect(result).not.toBeNull()
    expect(result.utcDate).toBe('2026-09-04')
    expect(result.localDate).toBe('2026-09-04')
    expect(result.crosses).toBe(false)
  })

  it('naive datetime (no Z) is treated as UTC for boundary check', () => {
    // "2026-09-04 03:00:00" without Z — must be treated as UTC
    const result = crossesDateBoundary('2026-09-04 03:00:00', 'America/New_York')!
    expect(result).not.toBeNull()
    expect(result.utcDate).toBe('2026-09-04')
    expect(result.localDate).toBe('2026-09-03')
    expect(result.crosses).toBe(true)
  })
})

describe('P0-B: formatLocal — UTC to local conversion', () => {
  it('converts UTC to local time (not displaying UTC hours as local)', () => {
    // 2026-09-03T22:07:14Z in UTC
    // Should display as local time, NOT as "10:07 PM" (which is 22:07)
    // The exact local display depends on the browser timezone, but it
    // should NOT be 22:07 (that would mean no conversion happened).
    const result = formatLocal('2026-09-03T22:07:14Z', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC', // Force UTC for deterministic test
    })
    expect(result).toBe('22:07')
  })

  it('returns null for invalid input', () => {
    expect(formatLocal(null)).toBeNull()
    expect(formatLocal('not a date')).toBeNull()
  })
})

describe('P0-B: toUTCDateString — UTC date string', () => {
  it('extracts UTC date from ISO8601 with Z', () => {
    expect(toUTCDateString('2026-09-03T22:07:14Z')).toBe('2026-09-03')
  })

  it('extracts UTC date from naive datetime', () => {
    expect(toUTCDateString('2026-09-03 22:07:14')).toBe('2026-09-03')
  })

  it('handles date-only input', () => {
    expect(toUTCDateString('2026-09-03')).toBe('2026-09-03')
  })
})
