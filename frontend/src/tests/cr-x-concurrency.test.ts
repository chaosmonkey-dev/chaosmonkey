import { describe, it, expect } from 'vitest'
import {
  computeConcurrency,
  sessionToInterval,
  unionIntervals,
  type IntervalSession,
} from '../lib/intervalUnion'

/**
 * CR-X 2026-08-30 — Concurrency computation tests.
 *
 * Verifies the sweep-line overlap algorithm and interval-union semantics:
 * - additive_agent_runtime = Σ(duration)
 * - unique_session_wall_clock_span = UNION(intervals)
 * - parallelism_factor = additive / unique (renamed "overlap factor" in UI)
 * - overlapping_session_count = number of overlapping PAIRS
 * - sessions_in_overlap = sessions participating in ≥1 overlap
 * - max_concurrent_sessions = peak concurrent count
 *
 * P0-2: Org-wide overlap is NOT same-developer parallel agent execution.
 * These tests verify the generic interval-union machinery only.
 */
describe('CR-X: Concurrency computation', () => {
  function mkSession(endIso: string, durationMs: number): IntervalSession {
    return { timestamp: endIso, duration_ms: durationMs, user_id: 'dev-1', developer_id: 'dev-1' }
  }

  it('single session: parallelism=1, no overlaps', () => {
    const sessions = [mkSession('2026-08-01T10:01:00.000Z', 60000)]
    const result = computeConcurrency(sessions)
    expect(result.additive_agent_runtime_ms).toBe(60000)
    expect(result.unique_session_wall_clock_span_ms).toBe(60000)
    expect(result.parallelism_factor).toBe(1.0)
    expect(result.overlapping_session_count).toBe(0)
    expect(result.sessions_in_overlap).toBe(0)
    expect(result.max_concurrent_sessions).toBe(1)
  })

  it('five fully overlapping 60s sessions: parallelism=5, max concurrent=5', () => {
    // All sessions end at 10:01:00 and last 60s → all cover [10:00:00, 10:01:00]
    const sessions = Array.from({ length: 5 }, () =>
      mkSession('2026-08-01T10:01:00.000Z', 60000)
    )
    const result = computeConcurrency(sessions)
    expect(result.additive_agent_runtime_ms).toBe(300000) // 5 × 60s
    expect(result.unique_session_wall_clock_span_ms).toBe(60000) // union = 60s
    expect(result.parallelism_factor).toBe(5.0)
    expect(result.overlapping_session_count).toBe(10) // C(5,2) = 10 pairs
    expect(result.sessions_in_overlap).toBe(5)
    expect(result.max_concurrent_sessions).toBe(5)
  })

  it('five non-overlapping sessions: parallelism=1, no overlaps', () => {
    // Sessions end 10:01, 10:02, 10:03, 10:04, 10:05 — each 60s, non-overlapping
    const sessions = [
      mkSession('2026-08-01T10:01:00.000Z', 60000),
      mkSession('2026-08-01T10:02:00.000Z', 60000),
      mkSession('2026-08-01T10:03:00.000Z', 60000),
      mkSession('2026-08-01T10:04:00.000Z', 60000),
      mkSession('2026-08-01T10:05:00.000Z', 60000),
    ]
    const result = computeConcurrency(sessions)
    expect(result.additive_agent_runtime_ms).toBe(300000)
    expect(result.unique_session_wall_clock_span_ms).toBe(300000)
    expect(result.parallelism_factor).toBe(1.0)
    expect(result.overlapping_session_count).toBe(0)
    expect(result.sessions_in_overlap).toBe(0)
    expect(result.max_concurrent_sessions).toBe(1)
  })

  it('three overlapping + two non-overlapping: correct counts', () => {
    // Three sessions overlap at [10:00, 10:01], two are sequential after
    const sessions = [
      mkSession('2026-08-01T10:01:00.000Z', 60000), // [10:00, 10:01]
      mkSession('2026-08-01T10:01:00.000Z', 60000), // [10:00, 10:01]
      mkSession('2026-08-01T10:01:00.000Z', 60000), // [10:00, 10:01]
      mkSession('2026-08-01T10:02:00.000Z', 60000), // [10:01, 10:02]
      mkSession('2026-08-01T10:03:00.000Z', 60000), // [10:02, 10:03]
    ]
    const result = computeConcurrency(sessions)
    expect(result.additive_agent_runtime_ms).toBe(300000)
    // Union: [10:00, 10:03] = 180s
    expect(result.unique_session_wall_clock_span_ms).toBe(180000)
    expect(result.parallelism_factor).toBeCloseTo(300000 / 180000, 5)
    expect(result.overlapping_session_count).toBe(3) // C(3,2) = 3 pairs
    expect(result.sessions_in_overlap).toBe(3)
    expect(result.max_concurrent_sessions).toBe(3)
  })

  it('skips sessions with invalid duration or timestamp', () => {
    const sessions = [
      mkSession('2026-08-01T10:01:00.000Z', 60000),
      { timestamp: 'invalid', duration_ms: 60000 } as IntervalSession,
      { timestamp: '2026-08-01T10:01:00.000Z', duration_ms: 0 } as IntervalSession,
      { timestamp: '2026-08-01T10:01:00.000Z', duration_ms: -100 } as IntervalSession,
    ]
    const result = computeConcurrency(sessions)
    expect(result.valid_interval_sessions).toBe(1)
    expect(result.additive_agent_runtime_ms).toBe(60000)
    expect(result.total_sessions).toBe(4)
  })

  it('empty input: all zeros', () => {
    const result = computeConcurrency([])
    expect(result.additive_agent_runtime_ms).toBe(0)
    expect(result.unique_session_wall_clock_span_ms).toBe(0)
    expect(result.parallelism_factor).toBe(0)
    expect(result.max_concurrent_sessions).toBe(0)
  })

  it('partial overlap: two sessions overlapping by 30s', () => {
    // Session 1: [10:00, 10:02] (120s, ends 10:02)
    // Session 2: [10:01, 10:03] (120s, ends 10:03)
    // Overlap: [10:01, 10:02] = 60s
    const sessions = [
      mkSession('2026-08-01T10:02:00.000Z', 120000),
      mkSession('2026-08-01T10:03:00.000Z', 120000),
    ]
    const result = computeConcurrency(sessions)
    expect(result.additive_agent_runtime_ms).toBe(240000)
    // Union: [10:00, 10:03] = 180s
    expect(result.unique_session_wall_clock_span_ms).toBe(180000)
    expect(result.parallelism_factor).toBeCloseTo(240000 / 180000, 5)
    expect(result.overlapping_session_count).toBe(1)
    expect(result.sessions_in_overlap).toBe(2)
    expect(result.max_concurrent_sessions).toBe(2)
  })
})

/**
 * CR-X P0-B: Concurrency insight must FAIL CLOSED.
 *
 * Until developer identity + workflow attribution + concurrency semantics
 * are authoritative, the observed-session-overlap insight must:
 * - be classified as diagnostic (isDiagnostic: true)
 * - NOT enter Top Insights (isTopInsightEligible: false)
 * - NOT claim "same-developer" concurrency
 * - NOT claim a named workflow in the title
 * - NOT infer concurrent agents from overlapping org-level sessions
 */
describe('CR-X P0-B: Concurrency insight fails closed', () => {
  it('generateObservedSessionOverlap always produces diagnostic insights', async () => {
    const { generateObservedSessionOverlap } = await import('../lib/insights/final/generators/planCode')
    const { vi } = await import('vitest')

    vi.stubEnv('VITE_FINAL_PI_ENGINE_ENABLED', 'true')

    // 50 cursor sessions with stable user_id (10 users × 5 sessions each)
    // All overlapping at the same time window
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      session_id: `s-${i}`,
      tool: 'cursor',
      user_id: `dev-${i % 10}`,
      timestamp: '2026-08-01T10:01:00.000Z',
      duration_ms: 60000,
      session_source: 'cursor',
    }))

    const result = generateObservedSessionOverlap({
      sessionRows: sessions,
      githubSnapshot: {},
      metricsData: {},
    } as any)

    expect(result).not.toBeNull()
    const insights = Array.isArray(result) ? result : [result]

    // Every instance must be diagnostic
    for (const ins of insights) {
      expect(ins.isDiagnostic).toBe(true)
      expect(ins.isTopInsightEligible).toBe(false)
      expect(ins.recommendationState).toBe('monitor_only')
      expect(ins.lifecycleClass).toBe('contextual')
    }
  })

  it('title never contains "same-developer" even with stable identity', async () => {
    const { generateObservedSessionOverlap } = await import('../lib/insights/final/generators/planCode')
    const { vi } = await import('vitest')

    vi.stubEnv('VITE_FINAL_PI_ENGINE_ENABLED', 'true')

    // Sessions with very stable user_id (1 user, 50 sessions)
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      session_id: `s-${i}`,
      tool: 'cursor',
      user_id: 'single-developer',
      timestamp: '2026-08-01T10:01:00.000Z',
      duration_ms: 60000,
      session_source: 'cursor',
    }))

    const result = generateObservedSessionOverlap({
      sessionRows: sessions,
      githubSnapshot: {},
      metricsData: {},
    } as any)

    const insights = Array.isArray(result) ? result : [result]
    for (const ins of insights) {
      expect(ins.title.toLowerCase()).not.toContain('same-developer')
      expect(ins.title.toLowerCase()).not.toContain('same developer')
      // Title must not name a specific workflow (e.g. "Cursor shows...")
      expect(ins.title.toLowerCase()).not.toContain('cursor')
      expect(ins.title.toLowerCase()).not.toContain('vscode')
      expect(ins.title.toLowerCase()).not.toContain('windsurf')
      expect(ins.title.toLowerCase()).not.toContain('devin')
    }
  })

  it('description never claims same-developer concurrency', async () => {
    const { generateObservedSessionOverlap } = await import('../lib/insights/final/generators/planCode')
    const { vi } = await import('vitest')

    vi.stubEnv('VITE_FINAL_PI_ENGINE_ENABLED', 'true')

    const sessions = Array.from({ length: 50 }, (_, i) => ({
      session_id: `s-${i}`,
      tool: 'cursor',
      user_id: `dev-${i % 5}`,
      timestamp: '2026-08-01T10:01:00.000Z',
      duration_ms: 60000,
      session_source: 'cursor',
    }))

    const result = generateObservedSessionOverlap({
      sessionRows: sessions,
      githubSnapshot: {},
      metricsData: {},
    } as any)

    const insights = Array.isArray(result) ? result : [result]
    for (const ins of insights) {
      const desc = (ins.description || '').toLowerCase()
      const rec = (ins.recommendation || '').toLowerCase()
      // Must NOT claim same-developer concurrency as a finding
      expect(desc).not.toContain('same-developer overlap:')
      expect(desc).not.toContain('this is evidence of a single developer')
      expect(rec).not.toContain('same-developer concurrent sessions')
      expect(rec).not.toContain('single developer operating multiple')
    }
  })

  it('diagnostic insights are excluded from Top Insights by ranking', async () => {
    const { getTopInsights } = await import('../lib/insights/final/utils/ranking')
    const { vi } = await import('vitest')

    vi.stubEnv('VITE_FINAL_PI_ENGINE_ENABLED', 'true')

    // Simulate a diagnostic concurrency insight alongside a normal finding
    const diagnosticInsight = {
      id: 'observed-session-overlap__cursor',
      cicdStage: 'plan-code',
      isDiagnostic: true,
      isTopInsightEligible: false,
      hasData: true,
      lifecycleClass: 'contextual',
      comparisonState: 'workflow_comparable',
      portfolioSuppressed: false,
      canonicalPriority: 1,
      renderOrder: 1,
    }
    const normalFinding = {
      id: 'files-edited-by-ide',
      cicdStage: 'plan-code',
      isDiagnostic: false,
      isTopInsightEligible: true,
      hasData: true,
      lifecycleClass: 'decision',
      comparisonState: 'workflow_comparable',
      portfolioSuppressed: false,
      canonicalPriority: 1,
      renderOrder: 1,
    }

    const top = getTopInsights([diagnosticInsight as any, normalFinding as any])
    const topIds = top.map(i => i.id)
    expect(topIds).not.toContain('observed-session-overlap__cursor')
    expect(topIds).toContain('files-edited-by-ide')
  })
})
