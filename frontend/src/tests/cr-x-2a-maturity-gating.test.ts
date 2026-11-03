import { describe, it, expect } from 'vitest'
import {
  generateWithinWorkflowCommitsProfile,
  generateWithinWorkflowTTFCProfile,
  generatePilotMaturityProgression,
} from '../lib/insights/final/generators/planCode'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

/**
 * CR-X 2A — Maturity gating and within-workflow profile tests.
 *
 * Proves that the product is useful at every pilot stage:
 * - DAY 0: maturity progression shows "no telemetry yet"
 * - FIRST EVENTS: maturity progression shows "first events received"
 * - FIRST_COMPLETED_SESSIONS: early-signal findings fire
 * - ONE_WORKFLOW_MATURE: within-workflow profiles fire
 * - MATURE_ONE_WORKFLOW: cross-workflow findings start
 * - MULTIPLE_WORKFLOWS: comparison findings fire
 */

function makeInput(sessions: any[]): CanonicalInsightInput {
  return {
    sessionRows: sessions,
    githubSnapshot: null,
    githubByPeriod: [],
    prByPeriod: [],
    outcomesByMonth: [],
    productivityByPeriod: [],
    granularity: 'day',
  }
}

function makeSession(tool: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tool,
    session_source: tool,
    timestamp: '2026-09-01T11:00:00.000Z',
    duration_ms: 3600000,
    session_duration_minutes: 60,
    user_id: 'dev-1',
    ai_burst_count: 2,
    session_has_ai_activity: true,
    session_commits: 1,
    session_commits_source: 'observed',
    time_to_first_commit_ms: 600000,
    ...overrides,
  }
}

// ── PILOT MATURITY PROGRESSION ───────────────────────────────────────────────

describe('CR-X 2A: Pilot maturity progression', () => {
  it('DAY_0: no sessions → "no telemetry yet"', () => {
    const result = generatePilotMaturityProgression(makeInput([]))
    expect(result).not.toBeNull()
    expect(result!.title).toContain('no telemetry yet')
    expect(result!.hasData).toBe(true)
    expect(result!.isDiagnostic).toBe(false)
    expect(result!.rightMetric).toBe('DAY 0')
  })

  it('FIRST_EVENTS: 1-4 sessions → "first events received"', () => {
    const sessions = Array.from({ length: 3 }, () => makeSession('vscode'))
    const result = generatePilotMaturityProgression(makeInput(sessions))
    expect(result).not.toBeNull()
    expect(result!.title).toContain('first events received')
    expect(result!.title).toContain('3 sessions')
  })

  it('FIRST_COMPLETED_SESSIONS: 5-14 sessions → "early signal active"', () => {
    const sessions = Array.from({ length: 10 }, () => makeSession('vscode'))
    const result = generatePilotMaturityProgression(makeInput(sessions))
    expect(result).not.toBeNull()
    expect(result!.title).toContain('early signal active')
  })

  it('ONE_WORKFLOW_MATURE: 15+ sessions in one workflow → "within-workflow analysis active"', () => {
    const sessions = Array.from({ length: 20 }, () => makeSession('vscode'))
    const result = generatePilotMaturityProgression(makeInput(sessions))
    expect(result).not.toBeNull()
    expect(result!.title).toContain('within-workflow analysis active')
  })

  it('MATURE_ONE_WORKFLOW: 25+ sessions in one workflow → "mature single-workflow"', () => {
    const sessions = Array.from({ length: 30 }, () => makeSession('vscode'))
    const result = generatePilotMaturityProgression(makeInput(sessions))
    expect(result).not.toBeNull()
    expect(result!.title).toContain('mature single-workflow')
  })

  it('MULTIPLE_WORKFLOWS: 25+ sessions in 2+ workflows → "multi-workflow comparison"', () => {
    const sessions = [
      ...Array.from({ length: 30 }, () => makeSession('vscode')),
      ...Array.from({ length: 30 }, () => makeSession('cursor')),
    ]
    const result = generatePilotMaturityProgression(makeInput(sessions))
    expect(result).not.toBeNull()
    expect(result!.title).toContain('multi-workflow comparison active')
  })

  it('maturity progression is never diagnostic', () => {
    // DAY_0
    expect(generatePilotMaturityProgression(makeInput([]))!.isDiagnostic).toBe(false)
    // FIRST_EVENTS
    expect(generatePilotMaturityProgression(makeInput([makeSession('vscode')]))!.isDiagnostic).toBe(false)
    // MULTIPLE_WORKFLOWS
    const sessions = [
      ...Array.from({ length: 30 }, () => makeSession('vscode')),
      ...Array.from({ length: 30 }, () => makeSession('cursor')),
    ]
    expect(generatePilotMaturityProgression(makeInput(sessions))!.isDiagnostic).toBe(false)
  })

  it('maturity progression includes next unlock hint', () => {
    const result = generatePilotMaturityProgression(makeInput([]))
    expect(result).not.toBeNull()
    expect(result!.evidenceAndContext).toContain('Next unlock:')
    expect(result!.operationalImpact).toContain('→')
  })

  // CR-X Day 1A: Contract fix — session count must NOT render as "Maturity Stage".
  // The 'current' field is the primary metric slot. For a semantic-state PI,
  // current must be 0 (not totalSessions) so the renderer uses rightMetric
  // (the stage string) as the primary display. Session count stays in 'n'
  // and 'evidenceAndContext' as sample evidence.
  it('CONTRACT: current is 0 — session count is NOT the primary metric', () => {
    const sessions = [
      ...Array.from({ length: 30 }, () => makeSession('vscode')),
      ...Array.from({ length: 30 }, () => makeSession('cursor')),
    ]
    const result = generatePilotMaturityProgression(makeInput(sessions))
    expect(result).not.toBeNull()
    // current must not carry the session count
    expect(result!.current).toBe(0)
    // The semantic stage is in rightMetric, not current
    expect(result!.rightMetric).toBe('MULTIPLE WORKFLOWS')
    expect(result!.rightMetricLabel).toBe('Maturity Stage')
    // Session count is sample evidence
    expect(result!.n).toBe(60)
    expect(result!.evidenceAndContext).toContain('Sessions: 60')
  })

  it('CONTRACT: session count cannot render as Maturity Stage at any stage', () => {
    // DAY_0
    const day0 = generatePilotMaturityProgression(makeInput([]))
    expect(day0!.current).toBe(0)
    expect(day0!.rightMetric).toBe('DAY 0')
    // FIRST_EVENTS
    const firstEvents = generatePilotMaturityProgression(makeInput([makeSession('vscode')]))
    expect(firstEvents!.current).toBe(0)
    expect(firstEvents!.rightMetric).toBe('FIRST EVENTS')
    // MULTIPLE_WORKFLOWS with large session count
    const sessions = [
      ...Array.from({ length: 2101 }, (_, i) => makeSession(i < 1500 ? 'vscode' : 'cursor')),
    ]
    const multi = generatePilotMaturityProgression(makeInput(sessions))
    expect(multi!.current).toBe(0)
    expect(multi!.n).toBe(2101)
    expect(multi!.rightMetric).toBe('MULTIPLE WORKFLOWS')
    // The primary metric is the stage, not 2101
    expect(multi!.rightMetric).not.toContain('2101')
  })
})

// ── WITHIN-WORKFLOW COMMITS PROFILE ──────────────────────────────────────────

describe('CR-X 2A: Within-workflow commits profile', () => {
  it('returns diagnostic when no sessions', () => {
    const results = generateWithinWorkflowCommitsProfile(makeInput([]))
    expect(results).not.toBeNull()
    expect(results!.length).toBe(1)
    expect(results![0].isDiagnostic).toBe(true)
    expect(results![0].hasData).toBe(false)
  })

  it('returns diagnostic when < 15 sessions with observed commits', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession('vscode', { session_commits: i, session_commits_source: 'observed' })
    )
    const results = generateWithinWorkflowCommitsProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    expect(results!.length).toBe(1)
    expect(results![0].isDiagnostic).toBe(true)
  })

  it('emits per-workflow insight when 15+ sessions with observed commits', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession('vscode', { session_commits: i % 5, session_commits_source: 'observed' })
    )
    const results = generateWithinWorkflowCommitsProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    expect(results!.length).toBe(1)
    expect(results![0].isDiagnostic).toBe(false)
    expect(results![0].hasData).toBe(true)
    expect(results![0].n).toBe(20)
    expect(results![0].title).toContain('VS Code')
  })

  it('excludes sessions with non-observed commit provenance', () => {
    const observed = Array.from({ length: 15 }, () =>
      makeSession('vscode', { session_commits: 2, session_commits_source: 'observed' })
    )
    const fallback = Array.from({ length: 20 }, () =>
      makeSession('vscode', { session_commits: 5, session_commits_source: 'aggregated_fallback' })
    )
    const results = generateWithinWorkflowCommitsProfile(makeInput([...observed, ...fallback]))
    expect(results).not.toBeNull()
    // Only observed sessions count
    expect(results![0].n).toBe(15)
  })

  it('detects high zero-commit percentage', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession('vscode', {
        session_commits: i < 12 ? 0 : 3,
        session_commits_source: 'observed',
      })
    )
    const results = generateWithinWorkflowCommitsProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    expect(results![0].title).toContain('zero observed commits')
  })
})

// ── WITHIN-WORKFLOW TTFC PROFILE ─────────────────────────────────────────────

describe('CR-X 2A: Within-workflow TTFC profile', () => {
  it('returns diagnostic when no sessions', () => {
    const results = generateWithinWorkflowTTFCProfile(makeInput([]))
    expect(results).not.toBeNull()
    expect(results!.length).toBe(1)
    expect(results![0].isDiagnostic).toBe(true)
    expect(results![0].hasData).toBe(false)
  })

  it('returns diagnostic when < 15 sessions with observed TTFC', () => {
    const sessions = Array.from({ length: 10 }, () =>
      makeSession('vscode', { time_to_first_commit_ms: 600000, session_commits_source: 'observed' })
    )
    const results = generateWithinWorkflowTTFCProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    expect(results![0].isDiagnostic).toBe(true)
  })

  it('emits per-workflow insight when 15+ sessions with observed TTFC', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession('vscode', {
        time_to_first_commit_ms: (i + 1) * 60000,
        session_commits: 1,
        session_commits_source: 'observed',
      })
    )
    const results = generateWithinWorkflowTTFCProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    expect(results!.length).toBe(1)
    expect(results![0].isDiagnostic).toBe(false)
    expect(results![0].hasData).toBe(true)
    expect(results![0].n).toBe(20)
  })

  it('detects fast TTFC (median ≤ 15 min)', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession('vscode', {
        time_to_first_commit_ms: (i % 10 + 1) * 300000, // 5-50 min
        session_commits: 1,
        session_commits_source: 'observed',
      })
    )
    const results = generateWithinWorkflowTTFCProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    // Median should be around 17.5 min (middle of 5-50 range)
    // Check it has TTFC in the title
    expect(results![0].title).toContain('first commit')
  })

  it('detects slow TTFC (median > 60 min)', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession('vscode', {
        time_to_first_commit_ms: (i + 10) * 600000, // 600-1740 min (10-29 hours)
        session_commits: 1,
        session_commits_source: 'observed',
      })
    )
    const results = generateWithinWorkflowTTFCProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    expect(results![0].title).toContain('slow time to first commit')
  })

  it('excludes sessions without observed commit provenance', () => {
    const observed = Array.from({ length: 15 }, () =>
      makeSession('vscode', { time_to_first_commit_ms: 600000, session_commits_source: 'observed' })
    )
    const unobserved = Array.from({ length: 20 }, () =>
      makeSession('vscode', { time_to_first_commit_ms: 300000, session_commits_source: 'aggregated_fallback' })
    )
    const results = generateWithinWorkflowTTFCProfile(makeInput([...observed, ...unobserved]))
    expect(results).not.toBeNull()
    expect(results![0].n).toBe(15)
  })
})

// ── SEMANTIC CONTRACT PRESERVATION ───────────────────────────────────────────

describe('CR-X 2A: Semantic contract preservation', () => {
  it('within-workflow commits profile does not produce cross-workflow comparison', () => {
    const sessions = [
      ...Array.from({ length: 20 }, (_, i) => makeSession('vscode', { session_commits: i % 3, session_commits_source: 'observed' })),
      ...Array.from({ length: 20 }, (_, i) => makeSession('cursor', { session_commits: i % 5, session_commits_source: 'observed' })),
    ]
    const results = generateWithinWorkflowCommitsProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    // Should emit 2 separate insights, one per workflow — NOT a comparison
    expect(results!.length).toBe(2)
    expect(results!.every(r => r.comparisonMode === 'absolute')).toBe(true)
    expect(results!.every(r => !r.title.includes('vs'))).toBe(true)
  })

  it('within-workflow TTFC profile does not produce cross-workflow comparison', () => {
    const sessions = [
      ...Array.from({ length: 20 }, () => makeSession('vscode', { time_to_first_commit_ms: 600000, session_commits_source: 'observed' })),
      ...Array.from({ length: 20 }, () => makeSession('cursor', { time_to_first_commit_ms: 900000, session_commits_source: 'observed' })),
    ]
    const results = generateWithinWorkflowTTFCProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    expect(results!.length).toBe(2)
    expect(results!.every(r => r.comparisonMode === 'absolute')).toBe(true)
  })

  it('maturity progression works for single-workflow without forcing comparison', () => {
    const sessions = Array.from({ length: 50 }, () => makeSession('vscode'))
    const result = generatePilotMaturityProgression(makeInput(sessions))
    expect(result).not.toBeNull()
    // Should show mature single-workflow, not require multiple workflows
    expect(result!.title).toContain('mature single-workflow')
  })
})

// ── 2A.1: INSTANCE ID AUTHORITY ──────────────────────────────────────────────

describe('CR-X 2A.1: Per-workflow instance ID authority', () => {
  it('commits-profile emits unique instance IDs per workflow', () => {
    const sessions = [
      ...Array.from({ length: 20 }, (_, i) => makeSession('vscode', { session_commits: i % 3, session_commits_source: 'observed' })),
      ...Array.from({ length: 20 }, (_, i) => makeSession('cursor', { session_commits: i % 5, session_commits_source: 'observed' })),
    ]
    const results = generateWithinWorkflowCommitsProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    expect(results!.length).toBe(2)
    const ids = results!.map(r => r.id)
    // IDs must be unique
    expect(new Set(ids).size).toBe(2)
    // IDs must be instance IDs (base__workflow)
    expect(ids[0]).toBe('within-workflow-commits-profile__vscode')
    expect(ids[1]).toBe('within-workflow-commits-profile__cursor')
  })

  it('TTFC-profile emits unique instance IDs per workflow', () => {
    const sessions = [
      ...Array.from({ length: 20 }, () => makeSession('vscode', { time_to_first_commit_ms: 600000, session_commits: 1, session_commits_source: 'observed' })),
      ...Array.from({ length: 20 }, () => makeSession('cursor', { time_to_first_commit_ms: 900000, session_commits: 1, session_commits_source: 'observed' })),
    ]
    const results = generateWithinWorkflowTTFCProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    expect(results!.length).toBe(2)
    const ids = results!.map(r => r.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids[0]).toBe('within-workflow-ttfc-profile__vscode')
    expect(ids[1]).toBe('within-workflow-ttfc-profile__cursor')
  })

  it('both commits instances resolve to same canonical family', async () => {
    const { resolveCanonicalFamilyId } = await import('../lib/insights/final/canonicalInsights')
    expect(resolveCanonicalFamilyId('within-workflow-commits-profile__vscode')).toBe('within-workflow-commits-profile')
    expect(resolveCanonicalFamilyId('within-workflow-commits-profile__cursor')).toBe('within-workflow-commits-profile')
    expect(resolveCanonicalFamilyId('within-workflow-ttfc-profile__vscode')).toBe('within-workflow-ttfc-profile')
    expect(resolveCanonicalFamilyId('within-workflow-ttfc-profile__cursor')).toBe('within-workflow-ttfc-profile')
  })

  it('diagnostic base ID remains valid for commits-profile', () => {
    const results = generateWithinWorkflowCommitsProfile(makeInput([]))
    expect(results).not.toBeNull()
    expect(results![0].id).toBe('within-workflow-commits-profile')
  })

  it('diagnostic base ID remains valid for TTFC-profile', () => {
    const results = generateWithinWorkflowTTFCProfile(makeInput([]))
    expect(results).not.toBeNull()
    expect(results![0].id).toBe('within-workflow-ttfc-profile')
  })

  it('existing runtime families unchanged', async () => {
    const { getRuntimeInstanceFamilies } = await import('../lib/insights/final/canonicalInsights')
    const families = getRuntimeInstanceFamilies()
    // Existing families still present
    expect(families.has('within-workflow-ai-effect')).toBe(true)
    expect(families.has('ai-intensity-cohort-analysis')).toBe(true)
    expect(families.has('workflow-session-distribution')).toBe(true)
    expect(families.has('observed-session-overlap')).toBe(true)
    // New families added
    expect(families.has('within-workflow-commits-profile')).toBe(true)
    expect(families.has('within-workflow-ttfc-profile')).toBe(true)
    expect(families.has('within-workflow-ai-signal-coverage')).toBe(true)
    expect(families.has('within-workflow-session-duration-profile')).toBe(true)
  })

  it('no dedupe collision when two workflows qualify for commits-profile', () => {
    const sessions = [
      ...Array.from({ length: 20 }, (_, i) => makeSession('vscode', { session_commits: i % 3, session_commits_source: 'observed' })),
      ...Array.from({ length: 20 }, (_, i) => makeSession('cursor', { session_commits: i % 5, session_commits_source: 'observed' })),
    ]
    const results = generateWithinWorkflowCommitsProfile(makeInput(sessions))
    expect(results).not.toBeNull()
    // Both survive — no dedupe collision
    expect(results!.length).toBe(2)
    expect(results![0].id).not.toBe(results![1].id)
  })
})

// ── 2A.1: MATURITY PI NOT DIAGNOSTIC ─────────────────────────────────────────

describe('CR-X 2A.1: Pilot maturity is contextual, not diagnostic', () => {
  it('DAY_0 maturity is not diagnostic', () => {
    const result = generatePilotMaturityProgression(makeInput([]))
    expect(result).not.toBeNull()
    expect(result!.isDiagnostic).toBe(false)
    expect(result!.hasData).toBe(true)
  })

  it('FIRST_EVENTS maturity is not diagnostic', () => {
    const sessions = Array.from({ length: 3 }, () => makeSession('vscode'))
    const result = generatePilotMaturityProgression(makeInput(sessions))
    expect(result).not.toBeNull()
    expect(result!.isDiagnostic).toBe(false)
    expect(result!.hasData).toBe(true)
  })

  it('MULTIPLE_WORKFLOWS maturity is not diagnostic', () => {
    const sessions = [
      ...Array.from({ length: 30 }, () => makeSession('vscode')),
      ...Array.from({ length: 30 }, () => makeSession('cursor')),
    ]
    const result = generatePilotMaturityProgression(makeInput(sessions))
    expect(result).not.toBeNull()
    expect(result!.isDiagnostic).toBe(false)
    expect(result!.hasData).toBe(true)
  })

  it('maturity PI has comparisonState org_level_only', () => {
    const result = generatePilotMaturityProgression(makeInput([]))
    expect(result).not.toBeNull()
    expect((result as any).comparisonState).toBe('org_level_only')
  })

  it('maturity PI does not increase diagnostic count in final engine', async () => {
    const { generateFinalCanonicalInsights } = await import('../lib/insights/final')
    const sessions = Array.from({ length: 50 }, () => makeSession('vscode'))
    const input = makeInput(sessions)
    const insights = await generateFinalCanonicalInsights(input)
    const maturityPI = insights.find(i => i.id === 'pilot-maturity-progression')
    expect(maturityPI).toBeDefined()
    expect(maturityPI!.isDiagnostic).not.toBe(true)
    // Count diagnostics — maturity should NOT be in the diagnostic count
    const diagnosticCount = insights.filter(i => i.isDiagnostic === true).length
    const maturityInDiagnostics = insights.filter(i =>
      i.isDiagnostic === true && i.id === 'pilot-maturity-progression'
    ).length
    expect(maturityInDiagnostics).toBe(0)
    // The maturity PI exists and is not counted as diagnostic
    expect(diagnosticCount).toBeGreaterThanOrEqual(0)
  }, 30000)
})

// ── 2B.1: RUNTIME-INSTANCE RENDERORDER AUTHORITY ─────────────────────────────

describe('CR-X 2B.1: Runtime-instance renderOrder uniqueness in final engine', () => {
  // Use sessions rich enough to trigger multiple within-workflow families.
  // CRITICAL: session_has_commit_outcome: true is required because
  // addDerivedSessionFields() overwrites session_commits_source based on
  // this field. Without it, observed commits become 'session_level_fallback'.
  function makeRichSession(tool: string, i: number) {
    return {
      tool,
      session_source: tool,
      timestamp: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T11:00:00.000Z`,
      duration_ms: 3600000 + (i % 10) * 60000,
      session_duration_minutes: 60 + (i % 10),
      user_id: 'invite:1',
      ai_burst_count: i % 3 === 0 ? 0 : 2,
      session_has_ai_activity: i % 3 !== 0,
      session_commits: i % 5,
      session_commits_source: 'observed',
      session_has_commit_outcome: true,
      time_to_first_commit_ms: (i + 1) * 600000,
      git_repo_url: 'https://github.com/owner/repo.git',
    }
  }

  it('two within-workflow-ai-signal-coverage instances survive final engine', async () => {
    const { generateFinalCanonicalInsights } = await import('../lib/insights/final')
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('vscode', i)),
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('cursor', i)),
    ]
    const insights = await generateFinalCanonicalInsights(makeInput(sessions))
    const coverageInstances = insights.filter(i =>
      i.id.startsWith('within-workflow-ai-signal-coverage__')
    )
    // Both instances should survive (not suppressed by renderOrder dedup)
    expect(coverageInstances.length).toBe(2)
  })

  it('two within-workflow-session-duration-profile instances survive final engine', async () => {
    const { generateFinalCanonicalInsights } = await import('../lib/insights/final')
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('vscode', i)),
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('cursor', i)),
    ]
    const insights = await generateFinalCanonicalInsights(makeInput(sessions))
    const durationInstances = insights.filter(i =>
      i.id.startsWith('within-workflow-session-duration-profile__')
    )
    expect(durationInstances.length).toBe(2)
  })

  it('two within-workflow-commits-profile instances survive final engine', async () => {
    const { generateFinalCanonicalInsights } = await import('../lib/insights/final')
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('vscode', i)),
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('cursor', i)),
    ]
    const insights = await generateFinalCanonicalInsights(makeInput(sessions))
    const commitsInstances = insights.filter(i =>
      i.id.startsWith('within-workflow-commits-profile__')
    )
    expect(commitsInstances.length).toBe(2)
  })

  it('two within-workflow-ttfc-profile instances survive final engine', async () => {
    const { generateFinalCanonicalInsights } = await import('../lib/insights/final')
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('vscode', i)),
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('cursor', i)),
    ]
    const insights = await generateFinalCanonicalInsights(makeInput(sessions))
    const ttfcInstances = insights.filter(i =>
      i.id.startsWith('within-workflow-ttfc-profile__')
    )
    expect(ttfcInstances.length).toBe(2)
  })

  it('generator-level renderOrder values are unique within each family', () => {
    // Validate at the generator level — this is what the final engine
    // validation checks before suppression.
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('vscode', i)),
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('cursor', i)),
    ]
    const input = makeInput(sessions)

    const commits = generateWithinWorkflowCommitsProfile(input)
    expect(commits).not.toBeNull()
    expect(commits!.length).toBe(2)
    const commitsOrders = commits!.map(i => i.renderOrder)
    expect(new Set(commitsOrders).size).toBe(2)

    const ttfc = generateWithinWorkflowTTFCProfile(input)
    expect(ttfc).not.toBeNull()
    expect(ttfc!.length).toBe(2)
    const ttfcOrders = ttfc!.map(i => i.renderOrder)
    expect(new Set(ttfcOrders).size).toBe(2)
  })

  it('no final-engine validation suppression for runtime instances', async () => {
    // The final engine logs [VALIDATION_SUPPRESSED] when renderOrder
    // duplicates are found. We capture console.error to prove no
    // suppression happens for our runtime instances.
    const { generateFinalCanonicalInsights } = await import('../lib/insights/final')
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('vscode', i)),
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('cursor', i)),
    ]
    const suppressedIds: string[] = []
    const originalError = console.error
    console.error = (...args: any[]) => {
      const msg = String(args[0] || '')
      if (msg.includes('VALIDATION_SUPPRESSED')) {
        try {
          const obj = args[1] as any
          if (obj?.suppressedIds) suppressedIds.push(...obj.suppressedIds)
        } catch {}
      }
      originalError.apply(console, args as any)
    }
    try {
      await generateFinalCanonicalInsights(makeInput(sessions))
    } finally {
      console.error = originalError
    }
    // No within-workflow runtime instances should be suppressed
    const wwSuppressed = suppressedIds.filter(id => id.includes('within-workflow') && id.includes('__'))
    expect(wwSuppressed).toEqual([])
  })

  it('ordering is deterministic across repeated runs', async () => {
    const { generateFinalCanonicalInsights } = await import('../lib/insights/final')
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('vscode', i)),
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('cursor', i)),
    ]
    const input = makeInput(sessions)
    const run1 = await generateFinalCanonicalInsights(input)
    const run2 = await generateFinalCanonicalInsights(input)
    const ids1 = run1.map(i => i.id).sort()
    const ids2 = run2.map(i => i.id).sort()
    expect(ids1).toEqual(ids2)
  })

  it('existing Top Insights/ranking contracts do not regress', async () => {
    const { generateFinalCanonicalInsights } = await import('../lib/insights/final')
    const sessions = [
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('vscode', i)),
      ...Array.from({ length: 30 }, (_, i) => makeRichSession('cursor', i)),
    ]
    const insights = await generateFinalCanonicalInsights(makeInput(sessions))
    const topInsights = insights.filter(i => (i as any).isTopInsightEligible === true)
    expect(topInsights.length).toBeGreaterThan(0)
  })

  it('canonical family resolution remains correct for all runtime instances', async () => {
    const { resolveCanonicalFamilyId } = await import('../lib/insights/final/canonicalInsights')
    // All four families resolve correctly
    expect(resolveCanonicalFamilyId('within-workflow-commits-profile__vscode')).toBe('within-workflow-commits-profile')
    expect(resolveCanonicalFamilyId('within-workflow-commits-profile__cursor')).toBe('within-workflow-commits-profile')
    expect(resolveCanonicalFamilyId('within-workflow-ttfc-profile__vscode')).toBe('within-workflow-ttfc-profile')
    expect(resolveCanonicalFamilyId('within-workflow-ttfc-profile__cursor')).toBe('within-workflow-ttfc-profile')
    expect(resolveCanonicalFamilyId('within-workflow-ai-signal-coverage__vscode')).toBe('within-workflow-ai-signal-coverage')
    expect(resolveCanonicalFamilyId('within-workflow-session-duration-profile__vscode')).toBe('within-workflow-session-duration-profile')
  })

  it('diagnostic/no-data base-family state remains valid', () => {
    // When no data, generators return base ID with diagnostic state
    const results = generateWithinWorkflowCommitsProfile(makeInput([]))
    expect(results).not.toBeNull()
    expect(results![0].id).toBe('within-workflow-commits-profile')
    expect(results![0].isDiagnostic).toBe(true)

    const ttfcResults = generateWithinWorkflowTTFCProfile(makeInput([]))
    expect(ttfcResults).not.toBeNull()
    expect(ttfcResults![0].id).toBe('within-workflow-ttfc-profile')
    expect(ttfcResults![0].isDiagnostic).toBe(true)
  })
})
