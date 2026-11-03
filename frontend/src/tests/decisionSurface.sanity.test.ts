import { describe, it, expect } from 'vitest'
import {
  weekStartISO,
  isCurrentWeekPartial,
  extractWeeklyPoints,
  compareCompleteWeeks,
  buildWhatChangedSummary,
  buildScopeSummary,
} from '../lib/productivity/decisionSurface'

describe('decisionSurface sanity', () => {
  it('weekStartISO returns Monday for a Wednesday', () => {
    // 2026-08-12 is a Wednesday
    const wed = new Date('2026-08-12T15:00:00Z')
    expect(weekStartISO(wed)).toBe('2026-08-10')
  })

  it('isCurrentWeekPartial true for current week, false for prior', () => {
    const now = new Date('2026-08-12T15:00:00Z') // Wed
    expect(isCurrentWeekPartial('2026-08-10', now)).toBe(true) // this week
    expect(isCurrentWeekPartial('2026-08-03', now)).toBe(false) // last week
  })

  it('compareCompleteWeeks excludes current partial week', () => {
    const now = new Date('2026-08-12T15:00:00Z')
    const points = [
      { t: '2026-07-20', value: 10, sessionCount: 100 },
      { t: '2026-07-27', value: 12, sessionCount: 120 },
      { t: '2026-08-03', value: 18, sessionCount: 90 },
      { t: '2026-08-10', value: 5, sessionCount: 20 }, // current partial week
    ]
    const cmp = compareCompleteWeeks(points, now)
    // latest complete = 2026-08-03 (18), previous = 2026-07-27 (12)
    expect(cmp.latestValue).toBe(18)
    expect(cmp.previousValue).toBe(12)
    expect(cmp.latestSessions).toBe(90)
    expect(cmp.previousSessions).toBe(120)
    expect(cmp.absoluteDelta).toBe(6)
    expect(cmp.hasEnoughData).toBe(true)
  })

  it('compareCompleteWeeks returns hasEnoughData=false with one complete week', () => {
    const now = new Date('2026-08-12T15:00:00Z')
    const points = [
      { t: '2026-08-03', value: 18, sessionCount: 90 },
      { t: '2026-08-10', value: 5, sessionCount: 20 }, // partial
    ]
    const cmp = compareCompleteWeeks(points, now)
    expect(cmp.hasEnoughData).toBe(false)
  })

  it('buildWhatChangedSummary neutral language, no good/bad', () => {
    const now = new Date('2026-08-12T15:00:00Z')
    const points = [
      { t: '2026-07-27', value: 12, sessionCount: 120 },
      { t: '2026-08-03', value: 18, sessionCount: 90 },
      { t: '2026-08-10', value: 5, sessionCount: 20 },
    ]
    const cmp = compareCompleteWeeks(points, now)
    const s = buildWhatChangedSummary('Rework', cmp, v => `${v.toFixed(0)}%`)
    expect(s).toContain('increased')
    expect(s).not.toMatch(/good|bad|better|winner|leader/i)
    expect(s).toContain('90 sessions (latest)')
  })

  it('buildWhatChangedSummary insufficient data message', () => {
    const cmp = { hasEnoughData: false } as any
    const s = buildWhatChangedSummary('Rework', cmp, v => `${v}`)
    expect(s).toBe('Not enough complete-week data to calculate a trend.')
  })

  it('extractWeeklyPoints nulls non-finite values (never zero)', () => {
    const series = {
      points: [
        { t: '2026-08-03', session_count: 10, active_coding_time_minutes: 30 },
        { t: '2026-08-10', session_count: 5, active_coding_time_minutes: null },
      ],
    }
    const pts = extractWeeklyPoints(series as any, 'active_coding_time_minutes')
    expect(pts[0].value).toBe(30)
    expect(pts[1].value).toBeNull()
  })

  it('buildScopeSummary formats sessions with locale', () => {
    const s = buildScopeSummary({
      workflowLabel: 'VS Code',
      metricLabel: 'Rework',
      timeRangeLabel: 'Last 4 complete weeks',
      repoLabel: 'All repos',
      sessionCount: 1100,
    })
    expect(s).toBe('VS Code · Rework · Last 4 complete weeks · All repos · 1,100 sessions')
  })
})
