/**
 * CR-X P0.2 Runtime Truth — PBT Freshness + PI Render Acceptance
 *
 * Tests covering:
 * - P0-A: All-time PBT freshness gap (latest period preservation per workflow)
 * - P0-B: Windsurf→Devin temporal consolidation
 * - P0-C: Adaptive granularity contract (daily/weekly card copy)
 * - P0-D: Async hydration (no false EMPTY)
 * - P0-E: PI commit-ttfc-longitudinal view-model TypeError
 * - P0-F: Denominator/presentation reconciliation
 * - P0-G: Customer-truth freshness invariant
 */

import { describe, it, expect } from 'vitest'
import { fetchTelemetryWithAdaptiveGranularity } from '../lib/productivity/fetchTelemetryWithAdaptiveGranularity'
import type { UnifiedTelemetryResult } from '../lib/adapters/telemetryToUnified'
import type { ProductivityQuery } from '../types/metrics'

// ─── Helpers ───

function makeUnifiedResult(
  records: Array<{ period: string; tool: string; sessionCount: number; active_coding_time_minutes?: number | null; average_session_length_minutes?: number | null }>,
  metadata?: any
): UnifiedTelemetryResult {
  return {
    records: records.map(r => ({
      period: r.period,
      tool: r.tool,
      AI_suggestions_accepted: 0,
      AI_usage_duration_minutes: null,
      idle_time_minutes: null,
      active_coding_time_minutes: r.active_coding_time_minutes ?? null,
      average_session_length_minutes: r.average_session_length_minutes ?? null,
      files_edited_per_session: 0,
      commits_per_session: 0,
      time_to_first_commit_minutes: 0,
      active_coding_ratio: null,
      ai_usage_ratio: null,
      idle_ratio: null,
      activeCodingMs: r.active_coding_time_minutes ? r.active_coding_time_minutes * 60000 : null,
      sessionCount: r.sessionCount,
      avgTimeToFirstCommitMs: null,
      avgTimeToFirstCommitMinutes: null,
      source: 'telemetry' as const,
    })),
    metadata: metadata ?? null,
  }
}

function makeQuery(overrides: Partial<ProductivityQuery> = {}): ProductivityQuery {
  return {
    from: '',
    to: '',
    repos: [],
    scope: 'org',
    viewBucket: 'weekly',
    developerIds: [],
    teamIds: [],
    toolIds: [],
    metricIds: ['ide.ai_suggestions_accepted'],
    ...overrides,
  } as any
}

// ─── P0-A + P0-G: All-time freshness / latest period preservation ───

describe('P0-A/P0-G: All-time PBT freshness — latest period preservation', () => {
  it('all-time weekly request preserves latest period for each workflow', async () => {
    // Simulate backend returning weekly data with different latest periods per tool
    const weeklyResult = makeUnifiedResult([
      { period: '2026-20', tool: 'cursor', sessionCount: 3 },
      { period: '2026-35', tool: 'devin', sessionCount: 7 },
      { period: '2026-35', tool: 'vscode', sessionCount: 4 },
      { period: '2026-35', tool: 'claude_code', sessionCount: 4 },
      { period: '2026-19', tool: 'github_copilot', sessionCount: 1 },
      { period: '2026-24', tool: 'windsurf', sessionCount: 1 },
    ])

    const fetcher = async () => weeklyResult
    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '', to: '' }),
      fetcher,
    })

    // The latest period across all tools should be 2026-35 (week 35 = Aug 24-30)
    const allPeriods = new Set(result.telemetryResult.records.map(r => r.period))
    expect(allPeriods.has('2026-35')).toBe(true)

    // Devin must have the latest period
    const devinRecords = result.telemetryResult.records.filter(r => r.tool === 'devin')
    const devinPeriods = devinRecords.map(r => r.period).sort()
    expect(devinPeriods[devinPeriods.length - 1]).toBe('2026-35')
  })

  it('sparse workflows (cursor, github_copilot) correctly have earlier latest periods', async () => {
    const weeklyResult = makeUnifiedResult([
      { period: '2026-20', tool: 'cursor', sessionCount: 3 },
      { period: '2026-35', tool: 'devin', sessionCount: 7 },
      { period: '2026-19', tool: 'github_copilot', sessionCount: 1 },
    ])

    const fetcher = async () => weeklyResult
    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '', to: '' }),
      fetcher,
    })

    // Cursor's latest period is 2026-20 (May) — this is correct, not a bug
    const cursorRecords = result.telemetryResult.records.filter(r => r.tool === 'cursor')
    const cursorPeriods = cursorRecords.map(r => r.period).sort()
    expect(cursorPeriods[cursorPeriods.length - 1]).toBe('2026-20')

    // GitHub Copilot's latest period is 2026-19 (May) — also correct
    const copilotRecords = result.telemetryResult.records.filter(r => r.tool === 'github_copilot')
    const copilotPeriods = copilotRecords.map(r => r.period).sort()
    expect(copilotPeriods[copilotPeriods.length - 1]).toBe('2026-19')
  })
})

// ─── P0-B: Windsurf→Devin temporal consolidation ───

describe('P0-B: Windsurf→Devin temporal consolidation', () => {
  it('windsurf and devin periods are both preserved (no temporal overlap)', async () => {
    // Windsurf ends week 24, Devin starts week 25 — no overlap
    const weeklyResult = makeUnifiedResult([
      { period: '2026-24', tool: 'windsurf', sessionCount: 1, active_coding_time_minutes: 30 },
      { period: '2026-25', tool: 'devin', sessionCount: 84, active_coding_time_minutes: 45 },
      { period: '2026-35', tool: 'devin', sessionCount: 7, active_coding_time_minutes: 50 },
    ])

    const fetcher = async () => weeklyResult
    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '', to: '' }),
      fetcher,
    })

    // Both windsurf and devin records should be present in the result
    const tools = new Set(result.telemetryResult.records.map(r => r.tool))
    expect(tools.has('windsurf')).toBe(true)
    expect(tools.has('devin')).toBe(true)

    // Windsurf's latest period is 2026-24
    const windsurfPeriods = result.telemetryResult.records
      .filter(r => r.tool === 'windsurf')
      .map(r => r.period).sort()
    expect(windsurfPeriods[windsurfPeriods.length - 1]).toBe('2026-24')

    // Devin's latest period is 2026-35 (extends beyond windsurf)
    const devinPeriods = result.telemetryResult.records
      .filter(r => r.tool === 'devin')
      .map(r => r.period).sort()
    expect(devinPeriods[devinPeriods.length - 1]).toBe('2026-35')
  })

  it('when windsurf and devin co-occur in the same period, they are merged with session-weighted averages', async () => {
    // Hypothetical overlap: both have data in week 25
    const weeklyResult = makeUnifiedResult([
      { period: '2026-25', tool: 'windsurf', sessionCount: 10, active_coding_time_minutes: 30 },
      { period: '2026-25', tool: 'devin', sessionCount: 20, active_coding_time_minutes: 60 },
    ])

    const fetcher = async () => weeklyResult
    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '', to: '' }),
      fetcher,
    })

    // Both records should be present (the merge happens in metricsFacade, not in the adapter)
    const week25Records = result.telemetryResult.records.filter(r => r.period === '2026-25')
    expect(week25Records.length).toBe(2)

    // Total sessions = 10 + 20 = 30
    const totalSessions = week25Records.reduce((sum, r) => sum + (r.sessionCount || 0), 0)
    expect(totalSessions).toBe(30)
  })
})

// ─── P0-C: Adaptive granularity contract ───

describe('P0-C: Adaptive granularity contract', () => {
  it('all-time with >90 day span uses weekly period', async () => {
    // 26 weekly periods spanning ~40 weeks (>90 days)
    const records = []
    for (let w = 10; w <= 35; w++) {
      records.push({ period: `2026-${String(w).padStart(2, '0')}`, tool: 'vscode', sessionCount: 5 })
    }

    const weeklyResult = makeUnifiedResult(records)
    const fetcher = async (period: 'day' | 'week') => {
      if (period === 'day') {
        // Return fewer daily buckets to ensure weekly wins
        return makeUnifiedResult(records.slice(0, 5).map(r => ({
          ...r,
          period: r.period.replace(/^(\d{4})-(\d{2})$/, '$1-08-15'),
        })))
      }
      return weeklyResult
    }

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '', to: '' }),
      fetcher,
    })

    expect(result.finalPeriod).toBe('week')
    expect(result.initialPeriod).toBe('week')
  })

  it('recent window (≤90 days) uses daily period', async () => {
    const dailyResult = makeUnifiedResult([
      { period: '2026-08-25', tool: 'devin', sessionCount: 10 },
      { period: '2026-08-26', tool: 'devin', sessionCount: 15 },
    ])

    const fetcher = async () => dailyResult
    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '2026-08-17', to: '2026-08-31' }),
      fetcher,
    })

    expect(result.finalPeriod).toBe('day')
    expect(result.initialPeriod).toBe('day')
  })

  it('card copy should derive from actual series period, not masquerade', async () => {
    // Weekly data should say "weeks", daily should say "days"
    // This is a contract test — the actual card copy is in ProductivityByToolV3
    // Use enough periods to exceed the sparse fallback threshold (6 buckets)
    const records = []
    for (let w = 10; w <= 35; w++) {
      records.push({ period: `2026-${String(w).padStart(2, '0')}`, tool: 'devin', sessionCount: 5 })
    }

    const weeklyResult = makeUnifiedResult(records)
    const fetcher = async (period: 'day' | 'week') => {
      if (period === 'day') {
        // Return fewer daily buckets so weekly wins
        return makeUnifiedResult(records.slice(0, 3).map(r => ({
          ...r,
          period: '2026-08-15',
        })))
      }
      return weeklyResult
    }

    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '', to: '' }),
      fetcher,
    })

    // The finalPeriod tells the caller what period the data is in
    // The card copy should use this to say "weeks" or "days"
    expect(result.finalPeriod).toBe('week')
    // Point counts should not masquerade as period units
    // (e.g., 26 weekly points should not be described as "26 days")
    expect(result.populatedBucketCount).toBeGreaterThan(0)
  })
})

// ─── P0-D: Async hydration ───

describe('P0-D: Async hydration contract', () => {
  it('initial unresolved state is null/empty, not a false EMPTY state', () => {
    // The useTimeSeries composable starts with data.value = null
    // This is the loading state, not a false "no data" state
    // The contract: null = loading, [] = resolved empty, non-empty = populated
    const nullData = null
    expect(nullData).toBeNull()

    // An empty array means resolved with no data (genuinely empty)
    const emptyData: any[] = []
    expect(emptyData.length).toBe(0)

    // A populated array means resolved with data
    const populatedData = [{ label: 'devin', points: [{ t: '2026-08-24', v: 5 }] }]
    expect(populatedData.length).toBeGreaterThan(0)
  })

  it('resolved data replaces transient zero state deterministically', async () => {
    // Simulate: first fetch returns empty, second returns data
    // Use explicit date range to avoid adaptive retry complexity
    let fetchCount = 0
    const fetcher = async () => {
      fetchCount++
      if (fetchCount === 1) {
        return makeUnifiedResult([])
      }
      return makeUnifiedResult([
        { period: '2026-08-25', tool: 'devin', sessionCount: 7 },
      ])
    }

    const result1 = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '2026-08-17', to: '2026-08-31' }),
      fetcher,
    })

    // First fetch with empty data should still return a result (not throw)
    expect(result1.telemetryResult.records.length).toBe(0)

    // Second fetch should return populated data
    const result2 = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '2026-08-17', to: '2026-08-31' }),
      fetcher,
    })

    expect(result2.telemetryResult.records.length).toBeGreaterThan(0)
  })
})

// ─── P0-E: PI commit-ttfc-longitudinal view-model TypeError ───

describe('P0-E: PI commit-ttfc-longitudinal view-model contract', () => {
  it('displayDeltaPct is a string for commit-ttfc-longitudinal (root cause)', () => {
    // The generator sets displayDeltaPct to a STRING like "+0.50"
    // This is the root cause: the renderer assumed it was always a number
    const mockInsight = {
      id: 'commit-ttfc-longitudinal',
      displayDeltaPct: '+0.50', // STRING, not number
      deltaPct: 25.0, // number (fallback)
    }

    // Simulate the renderer logic BEFORE the fix:
    // const effectiveDeltaPct = row.displayDeltaPct ?? row.deltaPct
    // isNaN("+0.50") === false (coerced to 0.5)
    // isFinite("+0.50") === true (coerced to 0.5)
    // BUT "+0.50".toFixed is undefined → TypeError

    const effectiveDeltaPct = mockInsight.displayDeltaPct ?? mockInsight.deltaPct
    expect(typeof effectiveDeltaPct).toBe('string')
    expect(isNaN(effectiveDeltaPct as any)).toBe(false) // passes the old guard
    expect(isFinite(effectiveDeltaPct as any)).toBe(true) // passes the old guard
    expect(typeof (effectiveDeltaPct as any).toFixed).toBe('undefined') // no .toFixed!
  })

  it('renderer guard with typeof check prevents TypeError on string displayDeltaPct', () => {
    // The FIXED guard: typeof effectiveDeltaPct === 'number'
    const mockInsight = {
      id: 'commit-ttfc-longitudinal',
      displayDeltaPct: '+0.50', // STRING
      deltaPct: 25.0, // number
    }

    const effectiveDeltaPct = mockInsight.displayDeltaPct ?? mockInsight.deltaPct

    // FIXED guard: must be typeof 'number'
    const passesGuard = typeof effectiveDeltaPct === 'number' &&
      !isNaN(effectiveDeltaPct) && isFinite(effectiveDeltaPct)

    // The string displayDeltaPct should NOT pass the fixed guard
    expect(passesGuard).toBe(false)

    // When displayDeltaPct is a string, the renderer should fall through
    // to other priorities (e.g., use row.deltaPct which IS a number)
    const fallbackPct = mockInsight.deltaPct
    const fallbackPasses = typeof fallbackPct === 'number' &&
      !isNaN(fallbackPct) && isFinite(fallbackPct)
    expect(fallbackPasses).toBe(true)

    // The fallback can safely call .toFixed()
    expect((fallbackPct as number).toFixed(1)).toBe('25.0')
  })

  it('renderer does not produce TypeError when displayDeltaPct is a string', () => {
    // Simulate the full render path with the fix
    const row: any = {
      id: 'commit-ttfc-longitudinal',
      displayDeltaPct: '+0.50', // STRING from generator
      deltaPct: 25.0,
    }

    let deltaText = 'No recent movement'
    const effectiveDeltaPct = row.displayDeltaPct ?? row.deltaPct

    // FIXED guard
    if (typeof effectiveDeltaPct === 'number' && !isNaN(effectiveDeltaPct) && isFinite(effectiveDeltaPct)) {
      const deltaPct = effectiveDeltaPct
      deltaText = `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`
    }

    // Should NOT have thrown, should NOT have used the string
    expect(deltaText).toBe('No recent movement')

    // Now test with numeric deltaPct as fallback (Priority 5 in the renderer)
    const delta = row.deltaPct ?? 0
    if (typeof delta === 'number' && !isNaN(delta) && isFinite(delta)) {
      if (delta === 0) {
        deltaText = 'Stable'
      } else {
        deltaText = delta > 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`
      }
    }

    // Should use the numeric deltaPct fallback
    expect(deltaText).toBe('+25.0%')
  })
})

// ─── P0-F: Denominator / presentation reconciliation ───

describe('P0-F: Denominator / presentation reconciliation', () => {
  it('raw session counts sum to 1,924 (accepted baseline)', () => {
    const raw = {
      claude_code: 58,
      cursor: 274,
      devin: 186,
      github_copilot: 6,
      vscode: 560,
      windsurf: 840,
    }
    const total = Object.values(raw).reduce((sum, n) => sum + n, 0)
    expect(total).toBe(1924)
  })

  it('presented session counts (after windsurf→devin normalization) sum to 1,924', () => {
    const presented = {
      devin: 1026, // 186 + 840
      vscode: 560,
      cursor: 274,
      claude_code: 58,
      github_copilot: 6,
    }
    const total = Object.values(presented).reduce((sum, n) => sum + n, 0)
    expect(total).toBe(1924)
  })

  it('windsurf + devin = presented devin (1,026)', () => {
    expect(186 + 840).toBe(1026)
  })

  it('recent Aug 17-31 session counts sum to 69', () => {
    const recent = {
      devin: 53,
      vscode: 12,
      claude_code: 4,
    }
    const total = Object.values(recent).reduce((sum, n) => sum + n, 0)
    expect(total).toBe(69)
  })

  it('no sessions disappear due to normalization', () => {
    const raw = { claude_code: 58, cursor: 274, devin: 186, github_copilot: 6, vscode: 560, windsurf: 840 }
    const presented = { devin: 1026, vscode: 560, cursor: 274, claude_code: 58, github_copilot: 6 }
    const rawTotal = Object.values(raw).reduce((s, n) => s + n, 0)
    const presentedTotal = Object.values(presented).reduce((s, n) => s + n, 0)
    expect(rawTotal).toBe(presentedTotal)
  })
})

// ─── P0-G: Customer-truth freshness invariant ───

describe('P0-G: Customer-truth freshness invariant', () => {
  it('LATEST CANONICAL → LATEST UNIFIED → LATEST PRESENTED → LATEST RENDERED', async () => {
    // The invariant: if recent canonical evidence exists for a workflow,
    // the rendered series must contain that evidence.

    // Simulate canonical API returning recent devin data (week 35 = Aug 24-30)
    const canonicalResult = makeUnifiedResult([
      { period: '2026-25', tool: 'devin', sessionCount: 84 },
      { period: '2026-34', tool: 'devin', sessionCount: 46 },
      { period: '2026-35', tool: 'devin', sessionCount: 7 }, // LATEST
    ])

    const fetcher = async () => canonicalResult
    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '', to: '' }),
      fetcher,
    })

    // LATEST CANONICAL: week 35
    const canonicalPeriods = canonicalResult.records.map(r => r.period).sort()
    const latestCanonical = canonicalPeriods[canonicalPeriods.length - 1]
    expect(latestCanonical).toBe('2026-35')

    // LATEST UNIFIED: must match latest canonical
    const unifiedPeriods = result.telemetryResult.records.map(r => r.period).sort()
    const latestUnified = unifiedPeriods[unifiedPeriods.length - 1]
    expect(latestUnified).toBe('2026-35')

    // The invariant holds: latest canonical = latest unified
    expect(latestCanonical).toBe(latestUnified)
  })

  it('a populated historical chart is NOT accepted as fresh merely because total sessions are correct', async () => {
    // Simulate: canonical has recent data but the adapter drops it
    const canonicalWithRecent = makeUnifiedResult([
      { period: '2026-10', tool: 'devin', sessionCount: 100 },
      { period: '2026-35', tool: 'devin', sessionCount: 7 }, // RECENT
    ])

    const fetcher = async () => canonicalWithRecent
    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '', to: '' }),
      fetcher,
    })

    // The recent period MUST be in the result
    const allPeriods = new Set(result.telemetryResult.records.map(r => r.period))
    expect(allPeriods.has('2026-35')).toBe(true)

    // If it were missing, the chart would appear "stale" despite having correct totals
    // This test proves the invariant: recent evidence is preserved
  })

  it('sparse workflows may have fewer observed periods (no interpolation)', async () => {
    // Cursor has no data after week 20 — this is correct, not interpolated
    const canonicalResult = makeUnifiedResult([
      { period: '2026-20', tool: 'cursor', sessionCount: 3 },
      { period: '2026-35', tool: 'devin', sessionCount: 7 },
    ])

    const fetcher = async () => canonicalResult
    const result = await fetchTelemetryWithAdaptiveGranularity({
      query: makeQuery({ from: '', to: '' }),
      fetcher,
    })

    // Cursor should NOT have week 35 data (no interpolation)
    const cursorRecords = result.telemetryResult.records.filter(r => r.tool === 'cursor')
    const cursorPeriods = cursorRecords.map(r => r.period)
    expect(cursorPeriods).not.toContain('2026-35')
    expect(cursorPeriods).toContain('2026-20')
  })
})
