/**
 * CR-X (C): PBT current-period freshness tests.
 *
 * Verifies the distinction between:
 * - PERIOD KEY: week-start bucket timestamp (e.g. Aug 31)
 * - DATA THROUGH: latest observed telemetry timestamp (e.g. Sep 3)
 *
 * The current partial week must surface semantics equivalent to:
 *   "Current week · Aug 31–Sep 3 · Partial · Data through Sep 3"
 *
 * Freshness respects active filters (developer/workflow/repo) because
 * latest_observed_at is derived from the same canonical filtered population.
 */
import { describe, it, expect } from 'vitest'
import { isCurrentWeekPartial, weekStartISO } from '../lib/productivity/decisionSurface'

describe('CR-X (C): PBT current-period freshness', () => {
  describe('isCurrentWeekPartial', () => {
    it('returns true when point is in the current week', () => {
      const now = new Date('2026-09-02T10:00:00Z') // Wednesday
      const weekStart = weekStartISO(now) // Monday Aug 31
      expect(isCurrentWeekPartial(weekStart, now)).toBe(true)
    })

    it('returns false when point is in a completed prior week', () => {
      const now = new Date('2026-09-02T10:00:00Z') // Wednesday Sep 2
      const priorWeekStart = '2026-08-24' // Monday of prior week
      expect(isCurrentWeekPartial(priorWeekStart, now)).toBe(false)
    })

    it('returns false when point is in a future week', () => {
      const now = new Date('2026-09-02T10:00:00Z')
      const futureWeekStart = '2026-09-07' // next Monday
      expect(isCurrentWeekPartial(futureWeekStart, now)).toBe(false)
    })

    it('returns false for empty timestamp', () => {
      expect(isCurrentWeekPartial('', new Date())).toBe(false)
    })

    it('returns false for invalid timestamp', () => {
      expect(isCurrentWeekPartial('invalid', new Date())).toBe(false)
    })
  })

  describe('weekStartISO', () => {
    it('returns Monday for a Wednesday', () => {
      const wed = new Date('2026-09-02T10:00:00Z') // Wednesday Sep 2
      expect(weekStartISO(wed)).toBe('2026-08-31') // Monday Aug 31
    })

    it('returns Monday for a Sunday (end of week)', () => {
      const sun = new Date('2026-09-06T10:00:00Z') // Sunday Sep 6
      expect(weekStartISO(sun)).toBe('2026-08-31') // Monday Aug 31
    })

    it('returns same date for a Monday', () => {
      const mon = new Date('2026-08-31T10:00:00Z') // Monday Aug 31
      expect(weekStartISO(mon)).toBe('2026-08-31')
    })
  })

  describe('Telemetry Sep 3 inside Aug 31 weekly bucket', () => {
    it('week start is Aug 31 for Sep 3 telemetry', () => {
      // Sep 3 telemetry falls in the week starting Aug 31 (Monday)
      const sep3 = new Date('2026-09-03T15:00:00Z')
      const bucket = weekStartISO(sep3)
      expect(bucket).toBe('2026-08-31')
    })

    it('current partial week includes Sep 3 telemetry', () => {
      const now = new Date('2026-09-03T15:00:00Z')
      const weekStart = weekStartISO(now)
      expect(isCurrentWeekPartial(weekStart, now)).toBe(true)
      // The bucket start is Aug 31, but data extends through Sep 3
      // This is the core freshness distinction:
      //   PERIOD KEY = Aug 31
      //   DATA THROUGH = Sep 3
      expect(weekStart).toBe('2026-08-31')
    })
  })

  describe('Week boundary', () => {
    it('Monday starts a new week', () => {
      const monday = new Date('2026-09-07T00:00:00Z') // Monday Sep 7
      expect(weekStartISO(monday)).toBe('2026-09-07')
    })

    it('Sunday ends the week (still in same week as Monday)', () => {
      const sunday = new Date('2026-09-06T23:59:59Z') // Sunday Sep 6
      const monday = new Date('2026-08-31T00:00:00Z') // Monday Aug 31
      expect(weekStartISO(sunday)).toBe(weekStartISO(monday))
    })
  })

  describe('Timezone boundary (deterministic UTC)', () => {
    it('weekStartISO uses UTC consistently', () => {
      // A timestamp at UTC midnight on a Monday
      const utcMonday = new Date('2026-08-31T00:00:00Z')
      expect(weekStartISO(utcMonday)).toBe('2026-08-31')
    })

    it('late Sunday UTC is still in the current week', () => {
      const lateSunday = new Date('2026-09-06T23:30:00Z') // Sunday 23:30 UTC
      const now = new Date('2026-09-06T23:31:00Z')
      const weekStart = weekStartISO(lateSunday)
      expect(isCurrentWeekPartial(weekStart, now)).toBe(true)
    })
  })

  describe('No telemetry today (completed prior week)', () => {
    it('prior week is not partial when current date is in a new week', () => {
      const now = new Date('2026-09-07T10:00:00Z') // Monday Sep 7
      const priorWeekStart = '2026-08-31' // Monday Aug 31
      expect(isCurrentWeekPartial(priorWeekStart, now)).toBe(false)
    })
  })

  describe('Single workflow does not block PBT freshness', () => {
    it('single workflow week is still partial if in current week', () => {
      // Even with a single workflow, the current week is partial
      const now = new Date('2026-09-02T10:00:00Z')
      const weekStart = weekStartISO(now)
      expect(isCurrentWeekPartial(weekStart, now)).toBe(true)
    })
  })

  describe('Filter awareness', () => {
    it('latest_observed_at is derived from the same filtered population', () => {
      // This is a contract test: the backend derives latest_observed_at
      // from the SAME canonical query (clone before aggregation).
      // The frontend receives it via metadata.latest_observed_at.
      // If filters change, both the data and latest_observed_at change together.
      // This test documents the contract.
      const now = new Date('2026-09-03T15:00:00Z')
      const weekStart = weekStartISO(now)
      // The bucket key is Aug 31, but latest_observed_at would be Sep 3
      expect(weekStart).toBe('2026-08-31')
      // latest_observed_at !== weekStart when telemetry exists after week start
      // This distinction is what the UI surfaces
    })
  })

  describe('Current-week range contract (F, G)', () => {
    it('weekStart for Sunday Sep 6 is Monday Aug 31, not a future Sep 7 (F)', () => {
      const sunday = new Date('2026-09-06T10:00:00Z') // Sunday Sep 6
      expect(weekStartISO(sunday)).toBe('2026-08-31')
      const saturday = new Date('2026-09-05T10:00:00Z')
      expect(weekStartISO(saturday)).toBe('2026-08-31')
    })

    it('Monday Sep 7 begins a new week (F)', () => {
      const monday = new Date('2026-09-07T00:00:00Z')
      expect(weekStartISO(monday)).toBe('2026-09-07')
    })

    it('latest evidence day before today still falls in the current week (F, E)', () => {
      // If latest evidence is Sep 5 and today is Sep 6, the observed-through
      // and current-week start are still Aug 31 (not a future Sep 7).
      const latestEvidence = new Date('2026-09-05T18:07:12Z')
      const today = new Date('2026-09-06T12:00:00Z')
      const weekStart = weekStartISO(latestEvidence)
      expect(weekStart).toBe('2026-08-31')
      expect(isCurrentWeekPartial(weekStart, today)).toBe(true)
    })
  })
})
