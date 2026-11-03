import { describe, it, expect } from 'vitest'
import { validateOverwritingReduction, analyzeOverwriting } from '../lib/insights/final/helpers/overwritingReduction'
import { validateInsightCredibility } from '../lib/insights/final/helpers/credibilityValidation'
import type { CanonicalInsight } from '../lib/insights/final/types'

// ============================================================
// CR5 V1 FINAL P0-3 — Realism Pipeline NaN Fix
//
// Proves:
// 1. validateOverwritingReduction returns finite improvement when densityScore=0
// 2. validateInsightCredibility returns finite overallScore for clean text
// 3. No NaN / Infinity in any dimension score
// ============================================================

describe('P0-3 — Realism Pipeline NaN fix', () => {
  it('analyzeOverwriting returns densityScore=0 for clean text', () => {
    const metrics = analyzeOverwriting('Session length is 30 minutes across 5 workflows.')
    expect(metrics.densityScore).toBe(0)
  })

  it('validateOverwritingReduction returns finite improvement when densityScore=0', () => {
    const text = 'Session length is 30 minutes across 5 workflows.'
    const result = validateOverwritingReduction(text, text)
    expect(Number.isFinite(result.improvement)).toBe(true)
    expect(result.improvement).toBe(0) // No improvement needed when already clean
  })

  it('validateInsightCredibility returns finite overallScore for clean insight', () => {
    const insight: CanonicalInsight = {
      id: 'test-clean-insight',
      title: 'Session length is 30 minutes across 5 workflows',
      cicdStage: 'plan-code',
      canonicalPriority: 1,
      renderOrder: 1,
      presentationType: 'evidence_only',
      comparisonMode: 'workflow_comparable',
      current: 30,
      baseline: 25,
      delta: 5,
      deltaPct: 20,
      rightMetric: '30 min',
      rightMetricLabel: 'Session Length',
      confidence: 'medium',
      coveragePct: 80,
      n: 100,
      hasData: true,
      description: 'Session length is 30 minutes across 5 workflows. Observational comparison.',
      whatChanged: 'Session length varies by workflow.',
      whyItMatters: 'Session length differences may reflect task mix.',
      recommendation: 'Monitor session length patterns.',
      evidenceAndContext: 'Analysis of 100 sessions. Coverage: 80%.',
      evidence: [],
      breakdownByTool: {},
      isExecutiveFinding: false,
      dataSource: 'live',
    }
    const result = validateInsightCredibility(insight)
    expect(Number.isFinite(result.overallScore)).toBe(true)
    expect(result.overallScore).toBeGreaterThanOrEqual(0)
    expect(result.overallScore).toBeLessThanOrEqual(100)

    // Check all dimension scores are finite
    const scores = Object.values(result.dimensionScores)
    scores.forEach(score => {
      expect(Number.isFinite(score)).toBe(true)
    })
  })

  it('validateInsightCredibility does NOT return NaN for any insight', () => {
    // Test with empty strings — edge case that would trigger NaN before fix
    const insight: CanonicalInsight = {
      id: 'test-empty',
      title: '',
      cicdStage: 'plan-code',
      canonicalPriority: 1,
      renderOrder: 1,
      presentationType: 'evidence_only',
      comparisonMode: 'workflow_comparable',
      current: 0,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      rightMetric: '',
      rightMetricLabel: '',
      confidence: 'low',
      coveragePct: 0,
      n: 0,
      hasData: false,
      description: '',
      whatChanged: '',
      whyItMatters: '',
      recommendation: '',
      evidenceAndContext: '',
      evidence: [],
      breakdownByTool: {},
      isExecutiveFinding: false,
      dataSource: 'live',
    }
    const result = validateInsightCredibility(insight)
    expect(Number.isFinite(result.overallScore)).toBe(true)
    expect(Number.isNaN(result.overallScore)).toBe(false)
  })
})
