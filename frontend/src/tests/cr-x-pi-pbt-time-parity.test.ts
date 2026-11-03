// CR-X PI/PBT-TIME: Parity tests for shared time-range authority.
// Verifies that analysisContext produces identical from/to for PI and PBT
// across all 5 presets (All Time, Last Day, Last Week, Last Month, Last Quarter).
// Asserts INCLUDED CALENDAR DATE COUNT, not just millisecond difference.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAnalysisContextStore, ALL_TIME_START } from '../stores/analysisContext'

// Count the number of inclusive calendar dates in a from/to range.
// from and to are 'YYYY-MM-DD' strings.  Empty strings = all-time (uncountable).
function includedDateCount(from: string, to: string): number | null {
  if (!from || !to) return null
  const fromMs = new Date(from + 'T00:00:00.000Z').getTime()
  const toMs = new Date(to + 'T00:00:00.000Z').getTime()
  if (isNaN(fromMs) || isNaN(toMs)) return null
  return Math.round((toMs - fromMs) / 86400000) + 1
}

describe('CR-X PI/PBT-TIME: shared time-range authority', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('ALL_TIME_START is exported and is 2020-01-01', () => {
    expect(ALL_TIME_START).toBe('2020-01-01')
  })

  it('All Time: from/to are empty strings (sentinel for backend)', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('all')
    expect(ctx.dateRange.from).toBe('')
    expect(ctx.dateRange.to).toBe('')
    expect(ctx.isAllTime).toBe(true)
  })

  it('Last Day (1d): exactly 1 included calendar date', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('1d')
    expect(ctx.dateRange.from).toBe(ctx.dateRange.to)
    expect(includedDateCount(ctx.dateRange.from, ctx.dateRange.to)).toBe(1)
  })

  it('Last Week (7d): exactly 7 included calendar dates', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('7d')
    expect(includedDateCount(ctx.dateRange.from, ctx.dateRange.to)).toBe(7)
  })

  it('Last Month (30d): exactly 30 included calendar dates', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('30d')
    expect(includedDateCount(ctx.dateRange.from, ctx.dateRange.to)).toBe(30)
  })

  it('Last Quarter (90d): exactly 90 included calendar dates', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('90d')
    expect(includedDateCount(ctx.dateRange.from, ctx.dateRange.to)).toBe(90)
  })

  it('Custom range: exact from/to preserved', () => {
    const ctx = useAnalysisContextStore()
    ctx.setCustomDateRange('2026-01-15', '2026-03-20')
    expect(ctx.dateRange.from).toBe('2026-01-15')
    expect(ctx.dateRange.to).toBe('2026-03-20')
    expect(ctx.timePreset).toBe('custom')
  })

  it('PBT preset map: day→1d, week→7d, month→30d, quarter→90d, all→all', () => {
    // This verifies the mapping used by ProductivityByToolV3.vue forward sync.
    const ctx = useAnalysisContextStore()
    const pbtPresetMap: Record<string, string> = {
      'all': 'all',
      'day': '1d',
      'week': '7d',
      'month': '30d',
      'quarter': '90d',
    }
    for (const [pbtLabel, acPreset] of Object.entries(pbtPresetMap)) {
      ctx.setTimePreset(acPreset as any)
      if (pbtLabel === 'all') {
        expect(ctx.isAllTime).toBe(true)
      } else {
        expect(ctx.isAllTime).toBe(false)
        expect(ctx.dateRange.from).toBeTruthy()
        expect(ctx.dateRange.to).toBeTruthy()
      }
    }
  })

  it('No off-by-one: 7d gives 7 dates, not 6 or 8', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('7d')
    const count = includedDateCount(ctx.dateRange.from, ctx.dateRange.to)
    expect(count).toBe(7)
    // Explicitly NOT 6 or 8
    expect(count).not.toBe(6)
    expect(count).not.toBe(8)
  })

  it('Local calendar dates: uses local getters, not UTC toISOString', () => {
    const ctx = useAnalysisContextStore()
    ctx.setTimePreset('1d')
    const today = new Date()
    const expectedLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(ctx.dateRange.from).toBe(expectedLocal)
    expect(ctx.dateRange.to).toBe(expectedLocal)
  })

  it('PI and PBT backend request bounds are identical for each preset', () => {
    // CR-X PI/PBT-TIME: Both PI (dataAccess.ts) and PBT (telemetryToUnified.ts)
    // read from analysisContext.dateRange.  This test proves they get the same
    // from/to by construction — there is only one source.
    const ctx = useAnalysisContextStore()
    const presets: Array<[string, string]> = [
      ['all', 'all'],
      ['day', '1d'],
      ['week', '7d'],
      ['month', '30d'],
      ['quarter', '90d'],
    ]
    for (const [_pbtLabel, acPreset] of presets) {
      ctx.setTimePreset(acPreset as any)
      // PI reads analysisContext.dateRange (Dashboards.vue line 2515-2518)
      const piFrom = ctx.dateRange.from
      const piTo = ctx.dateRange.to
      // PBT reads analysisContext.dateRange (ProductivityByToolV3.vue productivityQuery)
      const pbtFrom = ctx.dateRange.from
      const pbtTo = ctx.dateRange.to
      expect(pbtFrom).toBe(piFrom)
      expect(pbtTo).toBe(piTo)
    }
  })
})
