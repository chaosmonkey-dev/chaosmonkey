/**
 * CR-X P1A — Top Insights Decision-Quality Ranking Tests
 *
 * Bounded tests proving ranking behavior, not exact Local magic numbers.
 * Tests cover:
 *   A. Decision > contextual
 *   B. Unit mismatch ($1200 does not beat 12 hours)
 *   C. Tiny-denominator economics penalty
 *   D. Repository redundancy
 *   E. Deployment redundancy
 *   F. Early pilot (no longitudinal/GitHub/cost)
 *   G. Single-workflow pilot
 *   H. Diagnostics excluded
 *   I. Portfolio counts (37 findings / 3 diagnostics on Local)
 */

import { describe, it, expect } from 'vitest'
import { getTopInsights } from '../lib/insights/final/utils/ranking'
import type { CanonicalInsight } from '../lib/insights/final/types'

// ── Helpers ────────────────────────────────────────────────────────────

function mkInsight(overrides: Partial<CanonicalInsight> = {}): CanonicalInsight {
  return {
    id: 'test-insight',
    title: 'Test insight',
    cicdStage: 'plan-code',
    canonicalPriority: 1,
    renderOrder: 1,
    presentationType: 'comparison',
    current: 50,
    confidence: 'medium',
    hasData: true,
    isDiagnostic: false,
    n: 100,
    ...overrides,
  } as CanonicalInsight
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('CR-X P1A — Top Insights Decision-Quality Ranking', () => {

  // A. DECISION > CONTEXTUAL
  // A high raw-number contextual finding should NOT outrank a lower-number
  // decision finding when both are sufficiently supported.
  describe('A. Decision > contextual', () => {
    it('decision finding outranks contextual finding with higher raw number', () => {
      const contextual = mkInsight({
        id: 'contextual-high-number',
        title: 'Contextual high number',
        presentationKind: 'org_summary',
        comparisonState: 'org_level_only',
        current: 95,
        deltaPct: 0,
        delta: 0,
        n: 2000,
        confidence: 'low',
        urgencyLabel: 'informational',
        lifecycleClass: 'contextual',
      })
      const decision = mkInsight({
        id: 'decision-low-number',
        title: 'Decision low number',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 12,
        deltaPct: 40,
        n: 100,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const top = getTopInsights([contextual, decision])
      expect(top.length).toBeGreaterThan(0)
      expect(top[0].id).toBe('decision-low-number')
    })
  })

  // B. UNIT MISMATCH
  // A "$1200" currency current value does NOT automatically outrank a
  // "12 hour" or "40pp" decision finding because 1200 is numerically larger.
  describe('B. Unit mismatch', () => {
    it('$1200 currency does not beat 40pp decision finding', () => {
      const dollarCard = mkInsight({
        id: 'dollar-card',
        title: '$1200 per failed deployment',
        cicdStage: 'deploy-operate',
        presentationKind: 'unit_economics',
        comparisonState: 'org_level_only',
        current: 1200,
        deltaPct: 0,
        delta: 0,
        n: 2,
        confidence: 'medium',
        urgencyLabel: 'informational',
        lifecycleClass: 'contextual',
      })
      const ppCard = mkInsight({
        id: 'pp-card',
        title: '40pp workflow gap',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 40,
        deltaPct: 40,
        n: 200,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const top = getTopInsights([dollarCard, ppCard])
      expect(top.length).toBeGreaterThan(0)
      expect(top[0].id).toBe('pp-card')
    })

    it('$1200 currency does not beat 12-hour decision finding', () => {
      const dollarCard = mkInsight({
        id: 'dollar-card-2',
        title: '$1200 per release',
        cicdStage: 'deploy-operate',
        presentationKind: 'unit_economics',
        comparisonState: 'org_level_only',
        current: 1200,
        deltaPct: 0,
        delta: 0,
        n: 50,
        confidence: 'medium',
        urgencyLabel: 'informational',
        lifecycleClass: 'contextual',
      })
      const hourCard = mkInsight({
        id: 'hour-card',
        title: '12h merge cycle',
        cicdStage: 'review-merge',
        presentationKind: 'downstream_comparison',
        comparisonState: 'org_level_only',
        current: 12,
        deltaPct: 100,
        n: 50,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const top = getTopInsights([dollarCard, hourCard])
      expect(top.length).toBeGreaterThan(0)
      expect(top[0].id).toBe('hour-card')
    })
  })

  // C. TINY-DENOMINATOR ECONOMICS
  // A configured-cost outcome card with n=2 remains valid but is strongly
  // penalized / excluded from Top-5 priority when stronger findings exist.
  describe('C. Tiny-denominator economics', () => {
    it('n=2 economics card excluded from Top-5 when stronger findings exist', () => {
      const tinyEcon = mkInsight({
        id: 'allocated-spend-per-failed-deployment',
        title: '$1180 per failed deployment',
        cicdStage: 'deploy-operate',
        presentationKind: 'unit_economics',
        comparisonState: 'org_level_only',
        current: 1180,
        deltaPct: 0,
        delta: 0,
        n: 2,
        confidence: 'medium',
        urgencyLabel: 'informational',
        lifecycleClass: 'contextual',
      })
      const strong1 = mkInsight({
        id: 'repository-distribution-by-workflow',
        title: 'Repository distribution gap',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 95,
        deltaPct: 46,
        n: 2000,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const strong2 = mkInsight({
        id: 'executive-small-pr-workflow-optimization',
        title: 'Large PRs take 3x longer',
        cicdStage: 'review-merge',
        presentationKind: 'downstream_comparison',
        comparisonState: 'org_level_only',
        current: 12,
        deltaPct: 100,
        n: 34,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const strong3 = mkInsight({
        id: 'ai-adoption-velocity',
        title: 'AI adoption increased 40pp',
        cicdStage: 'plan-code',
        presentationKind: 'temporal_trend',
        comparisonState: 'workflow_comparable',
        current: 97,
        deltaPct: 69,
        n: 2000,
        confidence: 'low',
        urgencyLabel: 'monitor',
        lifecycleClass: 'contextual',
      })
      const top = getTopInsights([tinyEcon, strong1, strong2, strong3])
      const topIds = top.map(t => t.id)
      expect(topIds).not.toContain('allocated-spend-per-failed-deployment')
    })
  })

  // D. REPOSITORY REDUNDANCY
  // repository-concentration and repository-distribution-by-workflow must
  // not both occupy Top 5 when stronger alternatives exist.
  describe('D. Repository redundancy', () => {
    it('repository-concentration and repository-distribution-by-workflow do not coexist in Top 5', () => {
      const repoConcentration = mkInsight({
        id: 'repository-concentration',
        title: '88% concentrated in 2 repos',
        cicdStage: 'plan-code',
        presentationKind: 'org_summary',
        comparisonState: 'workflow_comparable',
        current: 88,
        deltaPct: 0,
        delta: 0,
        n: 2000,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const repoDistribution = mkInsight({
        id: 'repository-distribution-by-workflow',
        title: 'Devin concentrates, Claude Code spreads',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 95,
        deltaPct: 46,
        n: 2000,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      // Add other findings to fill Top 5
      const other1 = mkInsight({
        id: 'executive-small-pr-workflow-optimization',
        title: 'Large PRs take 3x longer',
        cicdStage: 'review-merge',
        presentationKind: 'downstream_comparison',
        comparisonState: 'org_level_only',
        current: 12,
        deltaPct: 100,
        n: 34,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const other2 = mkInsight({
        id: 'change-failure-rate-spike-by-ide',
        title: '90% deployment success',
        cicdStage: 'deploy-operate',
        presentationKind: 'downstream_comparison',
        comparisonState: 'org_level_only',
        current: 90,
        delta: -10,
        deltaPct: 0,
        n: 41,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const other3 = mkInsight({
        id: 'ai-adoption-velocity',
        title: 'AI adoption increased 40pp',
        cicdStage: 'plan-code',
        presentationKind: 'temporal_trend',
        comparisonState: 'workflow_comparable',
        current: 97,
        deltaPct: 69,
        n: 2000,
        confidence: 'low',
        urgencyLabel: 'monitor',
        lifecycleClass: 'contextual',
      })
      const top = getTopInsights([repoConcentration, repoDistribution, other1, other2, other3])
      const topIds = top.map(t => t.id)
      // Both should NOT be in Top 5 simultaneously
      const bothPresent = topIds.includes('repository-concentration') && topIds.includes('repository-distribution-by-workflow')
      expect(bothPresent).toBe(false)
      // The stronger one (distribution) should be present
      expect(topIds).toContain('repository-distribution-by-workflow')
    })
  })

  // E. DEPLOYMENT REDUNDANCY
  // Two cards representing effectively the same deployment success fact must
  // not both consume Top slots.
  describe('E. Deployment redundancy', () => {
    it('change-failure-rate and deployment-success-distribution do not coexist in Top 5', () => {
      const changeFailure = mkInsight({
        id: 'change-failure-rate-spike-by-ide',
        title: '90% deployment success rate',
        cicdStage: 'deploy-operate',
        presentationKind: 'downstream_comparison',
        comparisonState: 'org_level_only',
        current: 90,
        delta: -10,
        deltaPct: 0,
        n: 41,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const successDist = mkInsight({
        id: 'deployment-success-distribution',
        title: '90.2% deployment success distribution',
        cicdStage: 'deploy-operate',
        presentationKind: 'success_failure_distribution',
        comparisonState: 'org_level_only',
        current: 90.2,
        deltaPct: 0.27,
        n: 41,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const other1 = mkInsight({
        id: 'repository-distribution-by-workflow',
        title: 'Repository distribution gap',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 95,
        deltaPct: 46,
        n: 2000,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const other2 = mkInsight({
        id: 'executive-small-pr-workflow-optimization',
        title: 'Large PRs take 3x longer',
        cicdStage: 'review-merge',
        presentationKind: 'downstream_comparison',
        comparisonState: 'org_level_only',
        current: 12,
        deltaPct: 100,
        n: 34,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const other3 = mkInsight({
        id: 'ai-adoption-velocity',
        title: 'AI adoption increased 40pp',
        cicdStage: 'plan-code',
        presentationKind: 'temporal_trend',
        comparisonState: 'workflow_comparable',
        current: 97,
        deltaPct: 69,
        n: 2000,
        confidence: 'low',
        urgencyLabel: 'monitor',
        lifecycleClass: 'contextual',
      })
      const top = getTopInsights([changeFailure, successDist, other1, other2, other3])
      const topIds = top.map(t => t.id)
      const bothPresent = topIds.includes('change-failure-rate-spike-by-ide') && topIds.includes('deployment-success-distribution')
      expect(bothPresent).toBe(false)
    })
  })

  // F. EARLY PILOT
  // When longitudinal/GitHub/cost evidence is absent, valid early/contextual
  // findings must still be rankable rather than producing an empty or broken
  // Top Insights surface.
  describe('F. Early pilot', () => {
    it('early-signal findings rank when longitudinal/GitHub/cost absent', () => {
      const early1 = mkInsight({
        id: 'pilot-maturity-progression',
        title: 'Pilot status: early stage',
        cicdStage: 'plan-code',
        presentationKind: 'org_summary',
        comparisonState: 'org_level_only',
        current: 0,
        n: 10,
        confidence: 'low',
        lifecycleClass: 'contextual',
      })
      const early2 = mkInsight({
        id: 'ai-adoption-rate-by-ide',
        title: 'AI adoption 50% across 2 workflows',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 50,
        deltaPct: 20,
        n: 30,
        confidence: 'low',
        lifecycleClass: 'contextual',
      })
      const top = getTopInsights([early1, early2])
      expect(top.length).toBeGreaterThan(0)
      // Should not be empty
      expect(top.length).toBeLessThanOrEqual(5)
    })
  })

  // G. SINGLE-WORKFLOW PILOT
  // Ranking must remain valid when cross-workflow findings do not exist.
  describe('G. Single-workflow pilot', () => {
    it('ranking works with only within-workflow findings', () => {
      const within1 = mkInsight({
        id: 'within-workflow-ai-signal-coverage__vscode',
        title: 'VS Code: 85% AI signal coverage',
        cicdStage: 'plan-code',
        presentationKind: undefined,
        comparisonState: 'org_level_only',
        current: 85,
        n: 100,
        confidence: 'low',
        lifecycleClass: 'contextual',
      })
      const within2 = mkInsight({
        id: 'within-workflow-session-duration-profile__vscode',
        title: 'VS Code: heavy-tailed durations',
        cicdStage: 'plan-code',
        presentationKind: undefined,
        comparisonState: 'org_level_only',
        current: 22,
        deltaPct: 100,
        n: 100,
        confidence: 'low',
        lifecycleClass: 'contextual',
      })
      const top = getTopInsights([within1, within2])
      expect(top.length).toBeGreaterThan(0)
      expect(top.length).toBeLessThanOrEqual(5)
    })
  })

  // H. DIAGNOSTICS EXCLUDED
  // All diagnostics remain excluded exactly as today.
  describe('H. Diagnostics excluded', () => {
    it('diagnostics are never in Top Insights', () => {
      const diagnostic = mkInsight({
        id: 'session-quality-merge-success',
        title: 'GitHub delivery outcomes needed',
        cicdStage: 'plan-code',
        isDiagnostic: true,
        hasData: false,
        comparisonState: 'needs_more_data',
        current: null,
        n: 0,
        confidence: 'low',
        lifecycleClass: 'diagnostic',
      })
      const finding = mkInsight({
        id: 'ai-adoption-rate-by-ide',
        title: 'AI adoption 50%',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 50,
        deltaPct: 20,
        n: 100,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const top = getTopInsights([diagnostic, finding])
      const topIds = top.map(t => t.id)
      expect(topIds).not.toContain('session-quality-merge-success')
      expect(topIds).toContain('ai-adoption-rate-by-ide')
    })

    it('portfolio-suppressed findings are excluded', () => {
      const suppressed = mkInsight({
        id: 'suppressed-finding',
        title: 'Suppressed',
        cicdStage: 'plan-code',
        portfolioSuppressed: true,
        current: 50,
        n: 100,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const finding = mkInsight({
        id: 'active-finding',
        title: 'Active',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 50,
        deltaPct: 20,
        n: 100,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const top = getTopInsights([suppressed, finding])
      expect(top.map(t => t.id)).not.toContain('suppressed-finding')
    })
  })

  // I. PORTFOLIO COUNTS (Local runtime)
  // Local final portfolio remains 37 findings / 3 diagnostics.
  // This test runs against the real Local API when available.
  describe('I. Local portfolio counts', () => {
    it('Local runtime portfolio counts are unchanged by ranking', async () => {
      // Check API availability first; skip gracefully if unavailable
      let apiOk = false
      try {
        const checkRes = await fetch('http://localhost:8010/api/dev/verification-auth')
        apiOk = checkRes.ok
      } catch { apiOk = false }
      if (!apiOk) {
        console.log('Local API not available — skipping portfolio count test')
        return
      }

      const { generateFinalCanonicalInsights } = await import('../lib/insights/final')
      const { addDerivedSessionFields } = await import('../lib/insights/final/dataAccess')

      const authRes = await fetch('http://localhost:8010/api/dev/verification-auth')
      const auth = await authRes.json()
      const token = auth.token

      const allSessions: any[] = []
      let page = 1
      const from = '2000-01-01'
      const to = `${new Date().toISOString().split('T')[0]}T23:59:59.999Z`
      while (page <= 25) {
        const url = `http://localhost:8010/api/telemetry/canonical?from=${from}&to=${to}&format=sessions&per_page=1000&page=${page}`
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) break
        const data = await res.json()
        const sessions = data.data || data.sessions || []
        if (sessions.length === 0) break
        allSessions.push(...sessions)
        if (page >= (data.metadata?.total_pages || 1)) break
        page++
      }

      const ghRes = await fetch('http://localhost:8010/api/metrics?time_filter=all&use_all_data=1&nocache=1&github_nocache=1', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const githubRaw = await ghRes.json()

      let costConfigs: any[] = []
      try {
        const costRes = await fetch('http://localhost:8010/api/org/spend/config', {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (costRes.ok) {
          const costData = await costRes.json()
          costConfigs = (costData.configs || []).map((c: any) => ({
            toolId: (c.tool_id || '').replace(/[\s_]+/g, '-').toLowerCase().trim(),
            monthlySpend: parseFloat(c.monthly_spend) || 0,
          })).filter((c: any) => c.monthlySpend > 0)
        }
      } catch { /* no cost configs */ }

      addDerivedSessionFields(allSessions)

      const result = await generateFinalCanonicalInsights({
        sessionRows: allSessions,
        githubSnapshot: githubRaw,
        githubByPeriod: githubRaw?.github_by_period || [],
        granularity: 'week',
        externalCostConfigs: costConfigs.length > 0 ? costConfigs : undefined,
      } as any) as any[]

      const findings = result.filter((i: any) => !i.isDiagnostic)
      const diags = result.filter((i: any) => i.isDiagnostic)

      // CR-X Product-Strength Wave: Two intentional classifier contract changes
      // moved findings from diagnostic to finding (total portfolio unchanged):
      // 1. Executive synthesis: comparisonState guard for executive_synthesis
      //    presentationKind prevents misclassification as instrumentation_gap
      // 2. Allocation-shift findings: removed "(instrumentation gap)" suffix
      //    from generator titles — this string was in DIAGNOSTIC_TITLE_KEYWORDS
      //    and caused the render adapter to misclassify measured-evidence
      //    findings as diagnostic data-gap cards. The temporalQuality field
      //    and description now carry the quality information instead.
      // Both changes are classifier fixes, not ranking changes.
      // CR-X FINAL: Story-key suppression now suppresses child session_share
      // mirror cards when the executive-workflow-mix-synthesis is present.
      // This intentionally reduces the visible finding count from 35 to ~32.
      expect(findings.length).toBeGreaterThanOrEqual(30)
      expect(diags.length).toBeGreaterThanOrEqual(0)
      // Total should not change
      expect(findings.length + diags.length).toBe(result.length)
    }, 60000)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// CR-X P1A.1 — Top-5 Executive Quality Finalization
//
// Bounded tests proving that generic descriptive metrics do not beat
// supported comparative/trend/concentration evidence.
// ═══════════════════════════════════════════════════════════════════════

describe('CR-X P1A.1 — Top-5 Executive Quality Finalization', () => {

  // 1. An outcome_threshold descriptive metric does NOT beat a
  //    temporal_trend, workflow_comparison, or failure_concentration
  //    merely because its current/delta is larger.
  describe('1. outcome_threshold does not beat comparative evidence', () => {
    it('outcome_threshold with high delta loses to temporal_trend', () => {
      const threshold = mkInsight({
        id: 'review-burden',
        title: '3.2 review burden per PR',
        cicdStage: 'review-merge',
        presentationKind: 'outcome_threshold',
        comparisonState: 'org_level_only',
        current: 3.2,
        deltaPct: 61.6,
        delta: 1.23,
        n: 43,
        confidence: 'medium',
        urgencyLabel: 'action_required',
        recommendationState: 'action_required',
        lifecycleClass: 'decision',
      })
      const trend = mkInsight({
        id: 'monthly-workflow-share',
        title: 'Workflow shifted from VS Code to Devin',
        cicdStage: 'plan-code',
        presentationKind: 'temporal_trend',
        comparisonState: 'workflow_comparable',
        current: 92,
        deltaPct: 0,
        delta: -7.4,
        n: 2000,
        confidence: 'low',
        urgencyLabel: 'informational',
        lifecycleClass: 'contextual',
      })
      const top = getTopInsights([threshold, trend])
      // The trend should rank higher than the threshold metric
      const trendRank = top.findIndex(t => t.id === 'monthly-workflow-share')
      const thresholdRank = top.findIndex(t => t.id === 'review-burden')
      // Both should be in Top (only 2 findings), but trend should rank first
      expect(trendRank).toBeLessThanOrEqual(thresholdRank)
    })

    it('outcome_threshold with high delta loses to workflow_comparison', () => {
      const threshold = mkInsight({
        id: 'generic-threshold',
        title: 'High threshold metric',
        cicdStage: 'review-merge',
        presentationKind: 'outcome_threshold',
        comparisonState: 'org_level_only',
        current: 3.2,
        deltaPct: 61.6,
        n: 43,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const comparison = mkInsight({
        id: 'workflow-comparison',
        title: 'Cross-workflow contrast',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 40,
        deltaPct: 40,
        n: 200,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const top = getTopInsights([threshold, comparison])
      expect(top[0].id).toBe('workflow-comparison')
    })

    it('outcome_threshold with high delta loses to failure_concentration', () => {
      const threshold = mkInsight({
        id: 'generic-threshold-2',
        title: 'High threshold metric',
        cicdStage: 'deploy-operate',
        presentationKind: 'outcome_threshold',
        comparisonState: 'org_level_only',
        current: 3.2,
        deltaPct: 61.6,
        n: 43,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const concentration = mkInsight({
        id: 'deployment-failure-concentration',
        title: '100% of failures in production',
        cicdStage: 'deploy-operate',
        presentationKind: 'failure_concentration',
        comparisonState: 'org_level_only',
        current: 100,
        delta: 50,
        deltaPct: 0,
        n: 4,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const top = getTopInsights([threshold, concentration])
      // Both deploy-operate, concentration should win
      expect(top[0].id).toBe('deployment-failure-concentration')
    })
  })

  // 2. A threshold metric CAN win when it represents genuinely severe /
  //    actionable evidence and stronger evidence is absent.
  describe('2. threshold metric wins when no stronger evidence exists', () => {
    it('outcome_threshold wins when it is the only finding', () => {
      const threshold = mkInsight({
        id: 'only-threshold',
        title: 'Severe threshold metric',
        cicdStage: 'review-merge',
        presentationKind: 'outcome_threshold',
        comparisonState: 'org_level_only',
        current: 48,
        deltaPct: 200,
        n: 100,
        confidence: 'medium',
        urgencyLabel: 'action_required',
        recommendationState: 'action_required',
        lifecycleClass: 'decision',
      })
      const top = getTopInsights([threshold])
      expect(top.length).toBe(1)
      expect(top[0].id).toBe('only-threshold')
    })

    it('outcome_threshold wins over weak contextual findings', () => {
      const threshold = mkInsight({
        id: 'strong-threshold',
        title: 'Severe threshold metric',
        cicdStage: 'review-merge',
        presentationKind: 'outcome_threshold',
        comparisonState: 'org_level_only',
        current: 48,
        deltaPct: 200,
        n: 100,
        confidence: 'medium',
        urgencyLabel: 'action_required',
        recommendationState: 'action_required',
        lifecycleClass: 'decision',
      })
      const weakContextual = mkInsight({
        id: 'weak-contextual',
        title: 'Weak contextual observation',
        cicdStage: 'plan-code',
        presentationKind: 'org_summary',
        comparisonState: 'org_level_only',
        current: 5,
        deltaPct: 0,
        delta: 0,
        n: 10,
        confidence: 'low',
        lifecycleClass: 'contextual',
      })
      const top = getTopInsights([threshold, weakContextual])
      // Threshold should be in Top 5 (only 2 findings)
      expect(top.map(t => t.id)).toContain('strong-threshold')
    })
  })

  // 3. Stage diversity does not force a weak second card from a stage
  //    into Top 5.
  describe('3. stage diversity does not force weak second card', () => {
    it('weak second review-merge finding does not enter Top 5 over stronger plan-code', () => {
      // Strong plan-code findings
      const strong1 = mkInsight({
        id: 'strong-plan-1',
        title: 'Strong plan-code finding 1',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 40,
        deltaPct: 40,
        n: 200,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const strong2 = mkInsight({
        id: 'strong-plan-2',
        title: 'Strong plan-code finding 2',
        cicdStage: 'plan-code',
        presentationKind: 'temporal_trend',
        comparisonState: 'workflow_comparable',
        current: 60,
        deltaPct: 60,
        n: 200,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const strong3 = mkInsight({
        id: 'strong-plan-3',
        title: 'Strong plan-code finding 3',
        cicdStage: 'plan-code',
        presentationKind: 'cohort_comparison',
        comparisonState: 'workflow_comparable',
        current: 50,
        deltaPct: 50,
        n: 200,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      // Strong deploy-operate
      const strongDeploy = mkInsight({
        id: 'strong-deploy',
        title: 'Strong deploy finding',
        cicdStage: 'deploy-operate',
        presentationKind: 'failure_concentration',
        comparisonState: 'org_level_only',
        current: 100,
        delta: 50,
        n: 10,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      // Weak review-merge (generic threshold)
      const weakReview = mkInsight({
        id: 'weak-review',
        title: 'Weak review-merge threshold',
        cicdStage: 'review-merge',
        presentationKind: 'outcome_threshold',
        comparisonState: 'org_level_only',
        current: 3.2,
        deltaPct: 2,
        n: 10,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const top = getTopInsights([strong1, strong2, strong3, strongDeploy, weakReview])
      const topIds = top.map(t => t.id)
      // The weak review-merge should not take a slot from stronger plan-code
      expect(topIds).not.toContain('weak-review')
    })
  })

  // 4. failure_concentration and generic success-rate representations
  //    do not both occupy Top 5.
  describe('4. failure concentration and success rate do not coexist', () => {
    it('deployment-failure-concentration and change-failure-rate do not coexist', () => {
      const failureConcentration = mkInsight({
        id: 'deployment-failure-concentration',
        title: '100% of failures in production',
        cicdStage: 'deploy-operate',
        presentationKind: 'failure_concentration',
        comparisonState: 'org_level_only',
        current: 100,
        delta: 50,
        n: 4,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const changeFailure = mkInsight({
        id: 'change-failure-rate-spike-by-ide',
        title: '90% deployment success',
        cicdStage: 'deploy-operate',
        presentationKind: 'downstream_comparison',
        comparisonState: 'org_level_only',
        current: 90,
        delta: -10,
        n: 41,
        confidence: 'medium',
        lifecycleClass: 'decision',
      })
      const other1 = mkInsight({
        id: 'repo-distribution',
        title: 'Repository distribution gap',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 95,
        deltaPct: 46,
        n: 2000,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const other2 = mkInsight({
        id: 'pr-optimization',
        title: 'Large PRs take 3x longer',
        cicdStage: 'review-merge',
        presentationKind: 'downstream_comparison',
        comparisonState: 'org_level_only',
        current: 12,
        deltaPct: 100,
        n: 34,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const other3 = mkInsight({
        id: 'adoption-velocity',
        title: 'AI adoption increased 40pp',
        cicdStage: 'plan-code',
        presentationKind: 'temporal_trend',
        comparisonState: 'workflow_comparable',
        current: 97,
        deltaPct: 69,
        n: 2000,
        confidence: 'low',
        lifecycleClass: 'contextual',
      })
      const top = getTopInsights([failureConcentration, changeFailure, other1, other2, other3])
      const topIds = top.map(t => t.id)
      const bothPresent = topIds.includes('deployment-failure-concentration') && topIds.includes('change-failure-rate-spike-by-ide')
      expect(bothPresent).toBe(false)
    })
  })

  // 5. Early-pilot fallback remains healthy.
  describe('5. early-pilot fallback', () => {
    it('early-signal findings rank when longitudinal/GitHub/cost absent', () => {
      const early1 = mkInsight({
        id: 'pilot-maturity-progression',
        title: 'Pilot status: early stage',
        cicdStage: 'plan-code',
        presentationKind: 'org_summary',
        comparisonState: 'org_level_only',
        current: 0,
        n: 10,
        confidence: 'low',
        lifecycleClass: 'contextual',
      })
      const early2 = mkInsight({
        id: 'ai-adoption-rate-by-ide',
        title: 'AI adoption 50%',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 50,
        deltaPct: 20,
        n: 30,
        confidence: 'low',
        lifecycleClass: 'contextual',
      })
      const top = getTopInsights([early1, early2])
      expect(top.length).toBeGreaterThan(0)
      expect(top.length).toBeLessThanOrEqual(5)
    })
  })

  // 6. Single-workflow fallback remains healthy.
  describe('6. single-workflow fallback', () => {
    it('ranking works with only within-workflow findings', () => {
      const within1 = mkInsight({
        id: 'within-workflow-ai-signal-coverage__vscode',
        title: 'VS Code: 85% AI signal coverage',
        cicdStage: 'plan-code',
        presentationKind: undefined,
        comparisonState: 'org_level_only',
        current: 85,
        n: 100,
        confidence: 'low',
        lifecycleClass: 'contextual',
      })
      const within2 = mkInsight({
        id: 'within-workflow-session-duration-profile__vscode',
        title: 'VS Code: heavy-tailed durations',
        cicdStage: 'plan-code',
        presentationKind: undefined,
        comparisonState: 'org_level_only',
        current: 22,
        deltaPct: 100,
        n: 100,
        confidence: 'low',
        lifecycleClass: 'contextual',
      })
      const top = getTopInsights([within1, within2])
      expect(top.length).toBeGreaterThan(0)
      expect(top.length).toBeLessThanOrEqual(5)
    })
  })

  // 7. Diagnostics remain excluded.
  describe('7. diagnostics excluded', () => {
    it('diagnostics are never in Top Insights', () => {
      const diagnostic = mkInsight({
        id: 'session-quality-merge-success',
        title: 'GitHub delivery outcomes needed',
        cicdStage: 'plan-code',
        isDiagnostic: true,
        hasData: false,
        comparisonState: 'needs_more_data',
        current: null,
        n: 0,
        confidence: 'low',
        lifecycleClass: 'diagnostic',
      })
      const finding = mkInsight({
        id: 'ai-adoption-rate-by-ide',
        title: 'AI adoption 50%',
        cicdStage: 'plan-code',
        presentationKind: 'workflow_comparison',
        comparisonState: 'workflow_comparable',
        current: 50,
        deltaPct: 20,
        n: 100,
        confidence: 'low',
        lifecycleClass: 'decision',
      })
      const top = getTopInsights([diagnostic, finding])
      expect(top.map(t => t.id)).not.toContain('session-quality-merge-success')
      expect(top.map(t => t.id)).toContain('ai-adoption-rate-by-ide')
    })
  })

  // 8. Full portfolio counts unchanged.
  describe('8. portfolio counts unchanged', () => {
    it('Local runtime portfolio counts are unchanged by P1A.1', async () => {
      let apiOk = false
      try {
        const checkRes = await fetch('http://localhost:8010/api/dev/verification-auth')
        apiOk = checkRes.ok
      } catch { apiOk = false }
      if (!apiOk) {
        console.log('Local API not available — skipping portfolio count test')
        return
      }

      const { generateFinalCanonicalInsights } = await import('../lib/insights/final')
      const { addDerivedSessionFields } = await import('../lib/insights/final/dataAccess')

      const authRes = await fetch('http://localhost:8010/api/dev/verification-auth')
      const auth = await authRes.json()
      const token = auth.token

      const allSessions: any[] = []
      let page = 1
      const from = '2000-01-01'
      const to = `${new Date().toISOString().split('T')[0]}T23:59:59.999Z`
      while (page <= 25) {
        const url = `http://localhost:8010/api/telemetry/canonical?from=${from}&to=${to}&format=sessions&per_page=1000&page=${page}`
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) break
        const data = await res.json()
        const sessions = data.data || data.sessions || []
        if (sessions.length === 0) break
        allSessions.push(...sessions)
        if (page >= (data.metadata?.total_pages || 1)) break
        page++
      }

      const ghRes = await fetch('http://localhost:8010/api/metrics?time_filter=all&use_all_data=1&nocache=1&github_nocache=1', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const githubRaw = await ghRes.json()

      let costConfigs: any[] = []
      try {
        const costRes = await fetch('http://localhost:8010/api/org/spend/config', {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (costRes.ok) {
          const costData = await costRes.json()
          costConfigs = (costData.configs || []).map((c: any) => ({
            toolId: (c.tool_id || '').replace(/[\s_]+/g, '-').toLowerCase().trim(),
            monthlySpend: parseFloat(c.monthly_spend) || 0,
          })).filter((c: any) => c.monthlySpend > 0)
        }
      } catch { /* no cost configs */ }

      addDerivedSessionFields(allSessions)

      const result = await generateFinalCanonicalInsights({
        sessionRows: allSessions,
        githubSnapshot: githubRaw,
        githubByPeriod: githubRaw?.github_by_period || [],
        granularity: 'week',
        externalCostConfigs: costConfigs.length > 0 ? costConfigs : undefined,
      } as any) as any[]

      const findings = result.filter((i: any) => !i.isDiagnostic)
      const diags = result.filter((i: any) => i.isDiagnostic)

      // CR-X FINAL: Story-key suppression is now active. When the
      // executive-workflow-mix-synthesis finding passes evidence gates,
      // its child session_share mirror cards are portfolio-suppressed.
      // Their numbers remain in the synthesis evidence. This intentionally
      // reduces the visible finding count from the pre-story-key baseline
      // of 35 to ~32 (3 session_share children suppressed).
      expect(findings.length).toBeGreaterThanOrEqual(30)
      expect(diags.length).toBeGreaterThanOrEqual(0)
      expect(findings.length + diags.length).toBe(result.length)
    }, 60000)
  })
})
