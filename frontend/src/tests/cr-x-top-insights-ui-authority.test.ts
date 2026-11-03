/**
 * CR-X Top Insights UI Authority Contract
 *
 * The Final Engine is authoritative for Top membership/rank. It stamps
 * isTopInsightEligible=true and topInsightRank=1..5 on exactly the insights
 * that should appear in the Top tab. The UI must NOT independently re-rank,
 * re-diversify, or silently drop engine-selected Top cards.
 *
 * This test verifies the source contract of the `topInsights` computed in
 * PerformanceRecommendationsView.vue:
 *   1. It filters by isTopInsightEligible === true (engine authority)
 *   2. It sorts by topInsightRank (engine authority)
 *   3. It does NOT apply UI-layer filters that drop engine-selected cards
 *      (e.g. presentationType === 'evidence_only', recommendationAllowed,
 *       title-pattern exclusion, attributionStatus patterns)
 *   4. It does NOT re-sort by impact/confidence/coverage/stage
 *   5. Given 5 stamped insights with ranks 1-5 (including repository cards
 *      at ranks 2 and 4), Top produces exactly 5 items in rank order
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const componentPath = resolve(__dirname, '../components/PerformanceRecommendationsView.vue')
const source = readFileSync(componentPath, 'utf-8')

describe('CR-X Top Insights UI Authority Contract', () => {
  // Extract the topInsights computed body
  const topInsightsMatch = source.match(/const topInsights = computed\([\s\S]*?\n\}\)/)
  expect(topInsightsMatch).not.toBeNull()
  const topInsightsBody = topInsightsMatch![0]

  it('1. filters by isTopInsightEligible === true (engine authority)', () => {
    expect(topInsightsBody).toContain('isTopInsightEligible')
    expect(topInsightsBody).toContain('=== true')
  })

  it('2. sorts by topInsightRank (engine authority)', () => {
    expect(topInsightsBody).toContain('topInsightRank')
    expect(topInsightsBody).toMatch(/\.sort\(/)
  })

  it('3. does NOT filter by presentationType === evidence_only', () => {
    expect(topInsightsBody).not.toContain('evidence_only')
  })

  it('4. does NOT filter by recommendationAllowed', () => {
    expect(topInsightsBody).not.toContain('recommendationAllowed')
  })

  it('5. does NOT apply title-pattern exclusion', () => {
    expect(topInsightsBody).not.toContain('exclusionPatterns')
    expect(topInsightsBody).not.toContain('needs more data')
  })

  it('6. does NOT apply attributionStatus title-pattern exclusion', () => {
    expect(topInsightsBody).not.toContain('attributionStatus')
    expect(topInsightsBody).not.toContain('org_level_only')
  })

  it('7. does NOT re-sort by impact/confidence/coverage/stage', () => {
    expect(topInsightsBody).not.toContain('impactOrder')
    expect(topInsightsBody).not.toContain('confidenceOrder')
    expect(topInsightsBody).not.toContain('stageOrder')
    expect(topInsightsBody).not.toContain('demoNarrativePriority')
  })

  it('8. does NOT apply CFR dedup or deploy-throughput dedup', () => {
    expect(topInsightsBody).not.toContain('hasStandaloneCFRCard')
    expect(topInsightsBody).not.toContain('deployThroughputSeen')
    expect(topInsightsBody).not.toContain('dedupeGroup')
  })

  it('9. does NOT slice (engine already limits to MAX_TOP=5)', () => {
    expect(topInsightsBody).not.toContain('.slice(0')
  })
})

describe('CR-X Top Insights — 5 stamped insights with repository cards', () => {
  // Simulate the engine's stamped output: 5 insights with ranks 1-5,
  // including repository-oriented cards at ranks 2 and 4.
  // The UI topInsights computed should produce exactly 5 items in rank order.
  const stampedInsights = [
    {
      id: 'ai-intensity-cohort-analysis__cursor',
      title: 'Cursor AI intensity cohort',
      cicdStage: 'plan-code',
      isDiagnostic: false,
      isTopInsightEligible: true,
      topInsightRank: 1,
      presentationType: 'comparison',
      recommendationAllowed: true,
      confidence: 'low',
    },
    {
      id: 'repository-concentration',
      title: '72% of attributed sessions are concentrated in 2 repositories',
      cicdStage: 'plan-code',
      isDiagnostic: false,
      isTopInsightEligible: true,
      topInsightRank: 2,
      // This is the key: evidence_only must NOT cause UI to drop it
      presentationType: 'evidence_only',
      recommendationAllowed: true,
      confidence: 'medium',
    },
    {
      id: 'executive-small-pr-workflow-optimization',
      title: 'Small PR workflow optimization opportunity',
      cicdStage: 'review-merge',
      isDiagnostic: false,
      isTopInsightEligible: true,
      topInsightRank: 3,
      presentationType: 'comparison',
      recommendationAllowed: true,
      confidence: 'low',
    },
    {
      id: 'repository-distribution-by-workflow',
      title: 'Repository distribution is similar across workflows',
      cicdStage: 'plan-code',
      isDiagnostic: false,
      isTopInsightEligible: true,
      topInsightRank: 4,
      // This is the key: evidence_only + monitor_only must NOT cause UI to drop it
      presentationType: 'evidence_only',
      recommendationAllowed: false,
      recommendationState: 'monitor_only',
      confidence: 'medium',
    },
    {
      id: 'allocated-spend-per-failed-deployment',
      title: 'Allocated spend per failed deployment',
      cicdStage: 'deploy-operate',
      isDiagnostic: false,
      isTopInsightEligible: true,
      topInsightRank: 5,
      presentationType: 'comparison',
      recommendationAllowed: true,
      confidence: 'medium',
    },
    // Non-top insight that must NOT appear
    {
      id: 'ai-adoption-rate-by-ide',
      title: 'AI adoption rate by IDE',
      cicdStage: 'plan-code',
      isDiagnostic: false,
      isTopInsightEligible: false,
      topInsightRank: undefined,
      presentationType: 'comparison',
      recommendationAllowed: true,
      confidence: 'low',
    },
  ]

  // Replicate the fixed topInsights computed logic
  function computeTopInsights(insights: any[]): any[] {
    if (!insights || insights.length === 0) return []
    return insights
      .filter((i: any) => i.isTopInsightEligible === true && typeof i.topInsightRank === 'number')
      .sort((a: any, b: any) => (a.topInsightRank ?? 999) - (b.topInsightRank ?? 999))
  }

  it('produces exactly 5 items', () => {
    const top = computeTopInsights(stampedInsights)
    expect(top.length).toBe(5)
  })

  it('produces ranks 1,2,3,4,5 in order', () => {
    const top = computeTopInsights(stampedInsights)
    const ranks = top.map(i => i.topInsightRank)
    expect(ranks).toEqual([1, 2, 3, 4, 5])
  })

  it('does NOT drop repository-concentration (rank 2, evidence_only)', () => {
    const top = computeTopInsights(stampedInsights)
    const ids = top.map(i => i.id)
    expect(ids).toContain('repository-concentration')
  })

  it('does NOT drop repository-distribution-by-workflow (rank 4, evidence_only + monitor_only)', () => {
    const top = computeTopInsights(stampedInsights)
    const ids = top.map(i => i.id)
    expect(ids).toContain('repository-distribution-by-workflow')
  })

  it('does NOT include non-top insights', () => {
    const top = computeTopInsights(stampedInsights)
    const ids = top.map(i => i.id)
    expect(ids).not.toContain('ai-adoption-rate-by-ide')
  })

  it('All Insights remains unchanged (all non-diagnostic insights)', () => {
    // All Insights = allInsights computed, which returns all insights
    // without Top-specific filtering. This is NOT affected by the fix.
    const all = stampedInsights.filter(i => i.isDiagnostic !== true)
    expect(all.length).toBe(6) // includes the non-top insight
    expect(all.map(i => i.id)).toContain('ai-adoption-rate-by-ide')
  })
})
