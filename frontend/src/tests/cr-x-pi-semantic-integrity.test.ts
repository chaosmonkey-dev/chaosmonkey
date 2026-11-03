/**
 * CR-X PI Semantic Integrity regression tests.
 *
 * Proves:
 * 1. Same-workflow "shift" is never emitted (VS Code to VS Code)
 * 2. TTFC interpretation direction matches the signed delta
 * 3. Cohort labels use "Observed AI signals" / "Zero observed AI signals" (not Non-AI/AI-assisted)
 * 4. Commits/session findings do not use "delivery rate" terminology
 * 5. Pilot Health cost copy does not say "localStorage only"
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { buildCommitTtfcInterpretation } from '../lib/insights/final/helpers/commitTtfcInterpretation'
import { generateWithinWorkflowAISignalCoverage } from '../lib/insights/final/generators/planCode'
import { sanitizeInsight } from '../lib/insights/final/utils/payloadSanitizer'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

const planCodePath = resolve(__dirname, '../lib/insights/final/generators/planCode.ts')
const planCodeSource = readFileSync(planCodePath, 'utf-8')
const renderAdapterPath = resolve(__dirname, '../lib/insights/final/adapters/renderAdapter.ts')
const renderAdapterSource = readFileSync(renderAdapterPath, 'utf-8')
const pbtViewPath = resolve(__dirname, '../components/PerformanceRecommendationsView.vue')
const pbtViewSource = readFileSync(pbtViewPath, 'utf-8')
const pilotHealthControllerPath = resolve(__dirname, '../../../backend/app/Http/Controllers/PilotHealthController.php')
const pilotHealthSource = readFileSync(pilotHealthControllerPath, 'utf-8')

describe('P0.1: Same-workflow shift finding', () => {
  it('planCode checks sameDominantWorkflow before emitting a shift title', () => {
    expect(planCodeSource).toContain('sameDominantWorkflow')
  })

  it('planCode suppresses finding when same workflow and trivial delta', () => {
    expect(planCodeSource).toContain('SAME_WORKFLOW_TRIVIAL_DELTA')
  })

  it('planCode has retained-dominance title for same workflow', () => {
    expect(planCodeSource).toContain('remained the dominant workflow')
  })

  it('planCode does NOT unconditionally emit "shifted from X to Y"', () => {
    // The old code always said "shifted from ... to ..." — now it's conditional
    // The unconditional template string should not exist as a direct title assignment
    const unconditionalMatch = planCodeSource.match(/title:\s*`Dominant workflow shifted from/)
    expect(unconditionalMatch).toBeNull()
  })
})

describe('P0.2: TTFC direction interpretation', () => {
  it('decreased TTFC (negative delta) says "decreased"', () => {
    const interp = buildCommitTtfcInterpretation({
      id: 'commit-ttfc-longitudinal',
      firstTtfcMinutes: 45.0,
      lastTtfcMinutes: 43.0,
      firstCommitsPerSession: 1.0,
      lastCommitsPerSession: 1.0,
      observedPeriodCount: 3,
    })
    expect(interp).toContain('decreased')
    expect(interp).not.toContain('increased from 45.0 min to 43.0 min')
  })

  it('increased TTFC (positive delta) says "increased"', () => {
    const interp = buildCommitTtfcInterpretation({
      id: 'commit-ttfc-longitudinal',
      firstTtfcMinutes: 43.0,
      lastTtfcMinutes: 45.0,
      firstCommitsPerSession: 1.0,
      lastCommitsPerSession: 1.0,
      observedPeriodCount: 3,
    })
    expect(interp).toContain('increased')
    expect(interp).toContain('from 43.0 min to 45.0 min')
  })

  it('zero TTFC delta says "remained stable"', () => {
    const interp = buildCommitTtfcInterpretation({
      id: 'commit-ttfc-longitudinal',
      firstTtfcMinutes: 45.0,
      lastTtfcMinutes: 45.0,
      firstCommitsPerSession: 1.0,
      lastCommitsPerSession: 1.0,
      observedPeriodCount: 3,
    })
    expect(interp).toContain('remained stable')
    expect(interp).not.toContain('increased')
    expect(interp).not.toContain('decreased')
  })

  it('decreased commits/session says "decreased"', () => {
    const interp = buildCommitTtfcInterpretation({
      id: 'commit-ttfc-longitudinal',
      firstTtfcMinutes: 45.0,
      lastTtfcMinutes: 43.0,
      firstCommitsPerSession: 1.5,
      lastCommitsPerSession: 1.0,
      observedPeriodCount: 3,
    })
    expect(interp).toContain('commits/session decreased')
  })

  it('increased commits/session says "increased"', () => {
    const interp = buildCommitTtfcInterpretation({
      id: 'commit-ttfc-longitudinal',
      firstTtfcMinutes: 45.0,
      lastTtfcMinutes: 43.0,
      firstCommitsPerSession: 1.0,
      lastCommitsPerSession: 1.5,
      observedPeriodCount: 3,
    })
    expect(interp).toContain('commits/session increased')
  })
})

describe('P0.3: Cohort labels use observed-signal language', () => {
  it('renderAdapter uses "Observed AI signals" not "AI-assisted" for cohort label', () => {
    expect(renderAdapterSource).toContain("'Observed AI signals'")
    expect(renderAdapterSource).not.toContain("label: 'AI-assisted'")
  })

  it('renderAdapter uses "Zero observed AI signals" not "Non-AI" for cohort label', () => {
    expect(renderAdapterSource).toContain("'Zero observed AI signals'")
    expect(renderAdapterSource).not.toContain("label: 'Non-AI'")
  })

  it('PerformanceRecommendationsView uses "Observed AI signals" for AI cohort', () => {
    expect(pbtViewSource).toContain("'Observed AI signals'")
    // The old AI-assisted cohort label should not appear as a return value
    // for the ai/non_ai normalization
    const normalizeSection = pbtViewSource.match(/normalized === 'ai'[\s\S]*?return 'Observed AI signals'/)
    expect(normalizeSection).toBeTruthy()
  })

  it('PerformanceRecommendationsView uses "Zero observed AI signals" for non-AI cohort', () => {
    expect(pbtViewSource).toContain("'Zero observed AI signals'")
    const normalizeSection = pbtViewSource.match(/normalized === 'non_ai'[\s\S]*?return 'Zero observed AI signals'/)
    expect(normalizeSection).toBeTruthy()
  })

  it('chartLegendLabel1 returns "Observed AI signals" for ai_vs_non_ai', () => {
    expect(pbtViewSource).toContain("return 'Observed AI signals'")
  })

  it('chartLegendLabel2 returns "Zero observed AI signals" for ai_vs_non_ai', () => {
    expect(pbtViewSource).toContain("return 'Zero observed AI signals'")
  })
})

describe('P0.4: Commits/session not called "delivery rate"', () => {
  it('planCode does not use "Delivery rate is similar" for commits/session finding', () => {
    expect(planCodeSource).not.toContain('Delivery rate is similar')
  })

  it('planCode uses "Commits/session is similar" for the similar-cohort finding', () => {
    expect(planCodeSource).toContain('Commits/session is similar')
  })
})

describe('P1: Pilot Health cost copy', () => {
  it('PilotHealthController does not say "localStorage only" for cost', () => {
    expect(pilotHealthSource).not.toContain('localStorage only')
  })

  it('PilotHealthController says "persisted for the organization"', () => {
    expect(pilotHealthSource).toContain('persisted for the organization')
  })

  it('PilotHealthController references backend spend configuration API', () => {
    expect(pilotHealthSource).toContain('backend spend configuration API')
  })
})

describe('P1.5: AI signal coverage title/description consistency', () => {
  it('planCode uses withAiSignals === total for hasFullCoverage (not zeroAiSignals === 0)', () => {
    expect(planCodeSource).toContain('wc.withAiSignals === wc.total')
    expect(planCodeSource).not.toContain('wc.zeroAiSignals === 0')
  })

  it('partial coverage title uses percentage, not "all sessions"', () => {
    const partialBlock = planCodeSource.match(/else \{[\s\S]*?\$\{wfLabel\}: \$\{coverageRounded\}% of sessions have observed AI signals/)
    expect(partialBlock).toBeTruthy()
  })

  it('"all sessions" title only appears in the hasFullCoverage branch', () => {
    // The "all sessions" string should only appear in the full-coverage title
    const allSessionsLines = planCodeSource.split('\n').filter(l => l.includes('all sessions show observed AI signals'))
    expect(allSessionsLines.length).toBe(1)
  })
})

describe('P1.6: AI signal coverage generator behavior', () => {
  // These tests exercise the generator directly with synthetic inputs
  // to prove partial / 100% / zero coverage produce correct titles.
  function makeSession(tool: string, aiBurstCount: number | null): any {
    return { tool, ai_burst_count: aiBurstCount, timestamp: '2026-09-01T00:00:00Z', duration_ms: 60000 }
  }

  function runCoverage(sessions: any[]) {
    const input: CanonicalInsightInput = {
      sessionRows: sessions,
      githubSnapshot: undefined,
      githubByPeriod: [],
      productivityByPeriod: [],
      granularity: 'monthly',
    } as any
    return generateWithinWorkflowAISignalCoverage(input)
  }

  it('partial coverage (some AI, some zero, some missing) does not say "all sessions"', () => {
    const sessions = [
      ...Array(20).fill(null).map(() => makeSession('vscode', 5)),   // 20 with AI
      ...Array(10).fill(null).map(() => makeSession('vscode', 0)),   // 10 zero
      ...Array(5).fill(null).map(() => makeSession('vscode', null)),  // 5 missing
    ]
    const insights = runCoverage(sessions)
    expect(insights).toBeTruthy()
    expect(insights!.length).toBeGreaterThan(0)
    const title = insights![0].title
    expect(title).not.toContain('all sessions show observed AI signals')
    expect(title).toMatch(/% of sessions have observed AI signals/)
  })

  it('100% coverage (all sessions have AI signals) says "all sessions"', () => {
    const sessions = Array(30).fill(null).map(() => makeSession('vscode', 5))
    const insights = runCoverage(sessions)
    expect(insights).toBeTruthy()
    const title = insights![0].title
    expect(title).toContain('all sessions show observed AI signals')
  })

  it('zero coverage (no sessions have AI signals) says "zero observed AI signals"', () => {
    const sessions = Array(30).fill(null).map(() => makeSession('vscode', 0))
    const insights = runCoverage(sessions)
    expect(insights).toBeTruthy()
    const title = insights![0].title
    expect(title).toContain('zero observed AI signals')
  })

  it('all-AI-but-missing-sessions does not say "all sessions" (the Ed bug)', () => {
    // This is the exact Ed scenario: all MEASURED sessions have AI signals,
    // but many sessions have MISSING ai_burst_count. Previously triggered
    // "all sessions" falsely because zeroAiSignals === 0.
    const sessions = [
      ...Array(20).fill(null).map(() => makeSession('vscode', 5)),   // 20 with AI
      ...Array(15).fill(null).map(() => makeSession('vscode', null)),  // 15 missing
    ]
    const insights = runCoverage(sessions)
    expect(insights).toBeTruthy()
    const title = insights![0].title
    expect(title).not.toContain('all sessions show observed AI signals')
    expect(title).toMatch(/% of sessions have observed AI signals/)
  })
})

describe('P2: PILOT OPS 14-D — deltaPct must not be capped at 100%', () => {
  it('sanitizeInsight preserves deltaPct > 100 (e.g. 3x ratio = 200%)', () => {
    const sanitized = sanitizeInsight({
      id: 'test-deltaPct-uncapped',
      title: 'Test',
      description: 'Test',
      recommendation: 'Test',
      current: 30,
      baseline: 10,
      delta: 20,
      deltaPct: 200, // 3x ratio = 200%, must NOT be capped to 100
      confidence: 'high',
      hasData: true,
      n: 50,
      cicdStage: 'plan-code',
      canonicalPriority: 1,
      renderOrder: 1,
      presentationType: 'evidence_only',
      comparisonMode: 'absolute',
    } as any)
    expect(sanitized.deltaPct).toBe(200)
    expect(sanitized.deltaPct).not.toBe(100)
  })

  it('sanitizeInsight preserves negative deltaPct (a decrease)', () => {
    const sanitized = sanitizeInsight({
      id: 'test-deltaPct-negative',
      title: 'Test',
      description: 'Test',
      recommendation: 'Test',
      current: 5,
      baseline: 20,
      delta: -15,
      deltaPct: -75, // a 75% decrease, must NOT be floored to 0
      confidence: 'high',
      hasData: true,
      n: 50,
      cicdStage: 'plan-code',
      canonicalPriority: 1,
      renderOrder: 1,
      presentationType: 'evidence_only',
      comparisonMode: 'absolute',
    } as any)
    expect(sanitized.deltaPct).toBe(-75)
  })

  it('sanitizeInsight still clamps coveragePct to 0-100 (true proportion)', () => {
    const sanitized = sanitizeInsight({
      id: 'test-coveragePct-clamped',
      title: 'Test',
      description: 'Test',
      recommendation: 'Test',
      current: 0,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      coveragePct: 150, // a true 0-100 proportion, must be clamped
      confidence: 'high',
      hasData: true,
      n: 50,
      cicdStage: 'plan-code',
      canonicalPriority: 1,
      renderOrder: 1,
      presentationType: 'evidence_only',
      comparisonMode: 'absolute',
    } as any)
    expect(sanitized.coveragePct).toBe(100)
  })
})

describe('P2: PILOT OPS 14-D — allocation-shift synthesis flag survives render adapter', () => {
  it('renderAdapter source carries allocationShiftSynthesis through the boundary', () => {
    expect(renderAdapterSource).toContain('allocationShiftSynthesis')
  })

  it('PerformanceRecommendationsView looks up allocation-shift evidence by metric name, not index', () => {
    // The pairwise renderer must use evidence.find(metric === ...) instead
    // of evidence[N] to avoid mapping the comparison window to the Max shift cell.
    const allocShiftSection = pbtViewSource.match(/else \{[\s\S]*?const recentReposEv = evidence\.find/)
    expect(allocShiftSection).toBeTruthy()
    expect(pbtViewSource).toContain("evidence.find((e: any) => e.metric === 'max share shift')")
    expect(pbtViewSource).toContain("evidence.find((e: any) => e.metric === 'comparison window')")
  })
})
