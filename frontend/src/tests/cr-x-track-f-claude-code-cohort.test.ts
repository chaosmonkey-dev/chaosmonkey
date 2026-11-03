/**
 * CR-X Track F: Claude Code runtime cohort intelligence generator.
 *
 * Proves:
 * - Returns null with fewer than 5 Claude Code sessions (no synthetic fallback)
 * - Produces a cohort finding with mode split + AI-signal cohorts
 * - null/undefined ai_burst_count → 'unknown' cohort, NOT 'zero'
 * - numeric 0 ai_burst_count → 'zero' cohort (measured data)
 * - Unknown count excluded from observed-AI denominator
 * - No "agent runtime" or "active-coding ratio" copy (bridge sends null)
 * - No bogus 0% active-runtime ratio emitted
 * - Never implies zero AI signals = non-AI (disclosure present)
 * - No causal language, no workflow attribution of delivery outcomes
 * - Populated cohort is NOT misclassified as diagnostic "Not yet measurable"
 *   through the comparisonState → renderAdapter pipeline
 */
import { describe, it, expect } from 'vitest'
import { generateClaudeCodeRuntimeCohort } from '../lib/insights/final/generators/earlySignal'
import { computeComparisonState } from '../lib/insights/final/helpers/comparisonState'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

function ccSession(overrides: any = {}) {
  return {
    tool: 'claude_code',
    duration_ms: 20 * 60 * 1000,
    ai_burst_count: 2,
    git_repo_url: 'org/repo-a',
    session_commits: 1,
    session_commits_source: 'observed',
    ...overrides,
  }
}

function input(sessions: any[]): CanonicalInsightInput {
  return {
    sessionRows: sessions,
    githubByPeriod: [],
    githubSnapshot: {},
    externalCostConfigs: [],
  }
}

describe('CR-X Track F: Claude Code runtime cohort', () => {
  it('returns null with fewer than 5 Claude Code sessions', () => {
    expect(generateClaudeCodeRuntimeCohort(input([ccSession(), ccSession()]))).toBeNull()
  })

  it('ignores non-Claude-Code sessions', () => {
    const sessions = [
      ccSession(), ccSession(), ccSession(), ccSession(),
      { ...ccSession(), tool: 'cursor' },
    ]
    expect(generateClaudeCodeRuntimeCohort(input(sessions))).toBeNull()
  })

  it('produces a cohort finding with mode split and AI cohorts', () => {
    const sessions = [
      ccSession({ duration_ms: 10 * 60 * 1000, ai_burst_count: 0 }),   // short, zero
      ccSession({ duration_ms: 15 * 60 * 1000, ai_burst_count: 2 }),    // short, low
      ccSession({ duration_ms: 90 * 60 * 1000, ai_burst_count: 8 }),    // long, medium
      ccSession({ duration_ms: 120 * 60 * 1000, ai_burst_count: 20 }),  // long, high
      ccSession({ duration_ms: 12 * 60 * 1000, ai_burst_count: 1 }),    // short, low
    ]
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out).not.toBeNull()
    expect(out!.id).toBe('claude-code-runtime-cohort')
    expect(out!.n).toBe(5)
    const comp = (out as any).outcomeComposition
    expect(comp.shortMode).toBe(3)
    expect(comp.longMode).toBe(2)
    expect(comp.cohorts.zero).toBe(1)
    expect(comp.cohorts.high).toBe(1)
    expect(comp.cohorts.unknown).toBe(0)
  })

  // ─── Missing != Zero ──────────────────────────────────────────

  it('null ai_burst_count does NOT increment zero cohort', () => {
    const sessions = Array.from({ length: 6 }, () =>
      ccSession({ ai_burst_count: null }),
    )
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out).not.toBeNull()
    const comp = (out as any).outcomeComposition
    expect(comp.cohorts.zero).toBe(0)
    expect(comp.cohorts.unknown).toBe(6)
  })

  it('undefined ai_burst_count does NOT increment zero cohort', () => {
    const sessions = Array.from({ length: 6 }, () =>
      ccSession({ ai_burst_count: undefined }),
    )
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out).not.toBeNull()
    const comp = (out as any).outcomeComposition
    expect(comp.cohorts.zero).toBe(0)
    expect(comp.cohorts.unknown).toBe(6)
  })

  it('numeric 0 DOES increment zero-observed cohort', () => {
    const sessions = Array.from({ length: 6 }, () =>
      ccSession({ ai_burst_count: 0 }),
    )
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out).not.toBeNull()
    const comp = (out as any).outcomeComposition
    expect(comp.cohorts.zero).toBe(6)
    expect(comp.cohorts.unknown).toBe(0)
  })

  it('unknown count is excluded from observed-AI denominator', () => {
    const sessions = [
      ccSession({ ai_burst_count: 0 }),      // zero (observed)
      ccSession({ ai_burst_count: 2 }),       // low (observed)
      ccSession({ ai_burst_count: null }),    // unknown
      ccSession({ ai_burst_count: undefined }), // unknown
      ccSession({ ai_burst_count: 8 }),       // medium (observed)
      ccSession({ ai_burst_count: 20 }),      // high (observed)
    ]
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out).not.toBeNull()
    const comp = (out as any).outcomeComposition
    expect(comp.cohorts.unknown).toBe(2)
    expect(comp.observedAiDenominator).toBe(4) // 6 total - 2 unknown
    expect(comp.cohorts.zero).toBe(1)
    expect(comp.cohorts.low).toBe(1)
    expect(comp.cohorts.medium).toBe(1)
    expect(comp.cohorts.high).toBe(1)
  })

  it('discloses that zero AI signals are measured data, not non-AI', () => {
    const sessions = Array.from({ length: 6 }, () => ccSession({ ai_burst_count: 0 }))
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out).not.toBeNull()
    const json = JSON.stringify(out!)
    expect(json).toMatch(/zero.*measured data.*not non-AI|measured data, not non-AI/i)
  })

  // ─── No false agent-runtime semantics ──────────────────────────

  it('does NOT emit "agent runtime" copy', () => {
    const sessions = Array.from({ length: 6 }, () => ccSession())
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out).not.toBeNull()
    const json = JSON.stringify(out!)
    expect(json).not.toMatch(/agent runtime/i)
    expect(json).not.toMatch(/active-coding ratio/i)
  })

  it('does NOT emit a bogus 0% active-runtime ratio', () => {
    const sessions = Array.from({ length: 6 }, () => ccSession())
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out).not.toBeNull()
    const comp = (out as any).outcomeComposition
    expect(comp).not.toHaveProperty('activeRatio')
    const json = JSON.stringify(out!)
    // No "active-coding ratio" phrase or "agent runtime share" label
    expect(json).not.toMatch(/active-coding ratio/i)
    expect(json).not.toMatch(/agent runtime share/i)
    expect(json).not.toMatch(/active-coding/i)
  })

  // ─── Existing behavior preserved ───────────────────────────────

  it('preserves wall-clock duration semantics', () => {
    const sessions = Array.from({ length: 6 }, () =>
      ccSession({ duration_ms: 60 * 60 * 1000 }),
    )
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    const comp = (out as any).outcomeComposition
    expect(comp.avgWallClockMin).toBeCloseTo(60, 0)
  })

  it('preserves short/long mode split behavior', () => {
    const sessions = [
      ccSession({ duration_ms: 10 * 60 * 1000 }),  // short
      ccSession({ duration_ms: 15 * 60 * 1000 }),  // short
      ccSession({ duration_ms: 90 * 60 * 1000 }),  // long
      ccSession({ duration_ms: 120 * 60 * 1000 }), // long
      ccSession({ duration_ms: 12 * 60 * 1000 }),  // short
      ccSession({ duration_ms: 45 * 60 * 1000 }),  // long
    ]
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    const comp = (out as any).outcomeComposition
    expect(comp.shortMode).toBe(3)
    expect(comp.longMode).toBe(3)
  })

  it('preserves observed commit behavior', () => {
    const sessions = [
      ccSession({ session_commits: 3, session_commits_source: 'observed' }),
      ccSession({ session_commits: 2, session_commits_source: 'observed' }),
      ccSession({ session_commits: 0, session_commits_source: 'observed' }),
      ccSession({ session_commits: 5, session_commits_source: 'observed' }),
      ccSession({ session_commits: 1, session_commits_source: 'observed' }),
      ccSession({ session_commits: 4, session_commits_source: 'observed' }),
    ]
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    const comp = (out as any).outcomeComposition
    expect(comp.observedCommitSessions).toBe(6)
    expect(comp.totalObservedCommits).toBe(15)
  })

  it('preserves repo concentration behavior', () => {
    const sessions = [
      ccSession({ git_repo_url: 'org/repo-a' }),
      ccSession({ git_repo_url: 'org/repo-a' }),
      ccSession({ git_repo_url: 'org/repo-a' }),
      ccSession({ git_repo_url: 'org/repo-a' }),
      ccSession({ git_repo_url: 'org/repo-b' }),
      ccSession({ git_repo_url: 'org/repo-b' }),
    ]
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    const comp = (out as any).outcomeComposition
    expect(comp.topRepo).toBe('org/repo-a')
    expect(comp.repoConcentrationPct).toBeCloseTo(66.67, 0)
  })

  it('stays org-level / cohort-only, never workflow attribution of delivery', () => {
    const sessions = Array.from({ length: 6 }, () => ccSession())
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out!.attributionStatus).toBe('org_level_only')
    const json = JSON.stringify(out!)
    expect(json).not.toMatch(/causes|caused by|drives delivery|proves that/i)
    expect(json).toMatch(/not workflow attribution/i)
  })

  it('confidence is always low (observational cohort PI)', () => {
    const sessions = Array.from({ length: 100 }, () => ccSession())
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out!.confidence).toBe('low')
  })

  // ─── Wave 1B: Diagnostic misclassification regression ──────────

  it('computeComparisonState returns org_level_only, NOT instrumentation_gap', () => {
    // Regression: Track F sets presentationKind='cohort_comparison' with
    // comparisonState='org_level_only' and no breakdownByTool. Without the
    // cohort_comparison guard in computeComparisonState, this falls through to
    // the instrumentation_gap fallback, which causes the render adapter to
    // misclassify a populated 67-session cohort as a diagnostic
    // "Not yet measurable / Data not available" card.
    const sessions = Array.from({ length: 67 }, () => ccSession())
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out).not.toBeNull()
    const cs = computeComparisonState(out!)
    expect(cs).toBe('org_level_only')
    expect(cs).not.toBe('instrumentation_gap')
    expect(cs).not.toBe('needs_more_data')
    expect(cs).not.toBe('emerging_sample')
  })

  it('populated cohort is NOT a diagnostic data-gap card', () => {
    // End-to-end: a populated cohort with 67 sessions and hasData=true
    // must not be classified as diagnostic by the render adapter's
    // isDiagnostic rule. The render adapter checks:
    //   isDiagnostic = isDiagnostic===true || diagnosticReason!==undefined ||
    //     hasData===false || comparisonState in (needs_more_data,
    //     instrumentation_gap, emerging_sample) || hasDiagnosticTitle
    // With the fix, comparisonState='org_level_only' so the diagnostic
    // condition is false.
    const sessions = Array.from({ length: 67 }, () => ccSession())
    const out = generateClaudeCodeRuntimeCohort(input(sessions))
    expect(out).not.toBeNull()
    expect(out!.hasData).toBe(true)
    expect(out!.isDiagnostic).not.toBe(true)
    const cs = computeComparisonState(out!)
    // The four diagnostic-triggering comparison states
    expect(['needs_more_data', 'instrumentation_gap', 'emerging_sample']).not.toContain(cs)
    // Render adapter isDiagnostic rule (mirrored here for regression)
    const isDiagnostic =
      out!.isDiagnostic === true ||
      (out as any).diagnosticReason !== undefined ||
      out!.hasData === false ||
      ['needs_more_data', 'instrumentation_gap', 'emerging_sample'].includes(cs)
    expect(isDiagnostic).toBe(false)
  })
})
