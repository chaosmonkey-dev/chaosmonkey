import { describe, it, expect } from 'vitest'
import { applyPortfolioConsolidation } from '../lib/insights/final/utils/portfolioConsolidation'
import type { CanonicalInsight } from '../lib/insights/final/types'

/**
 * CR-X 2026-08-30 — Bimodal/autonomous-runtime synthesis tests.
 *
 * Proves that when ai-intensity-cohort-analysis fires for a workflow,
 * workflow-session-distribution for the SAME workflow is portfolio-suppressed
 * (not diagnostic). The intensity cohort is the stronger synthesized finding
 * because it has AI-signal × duration correlation; the distribution-only
 * finding describes the same tail with less context.
 */
describe('CR-X: Bimodal/autonomous-runtime synthesis', () => {
  it('suppresses workflow-session-distribution when intensity-cohort exists for same workflow', () => {
    const insights: CanonicalInsight[] = [
      {
        id: 'ai-intensity-cohort-analysis__claude_code',
        title: 'Claude Code shows bimodal agent runtime: 89 min median for high-signal vs 4 min for zero observed AI signals (23x)',
        cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 1,
        presentationType: 'comparison', comparisonMode: 'absolute',
        current: 89, baseline: 4, delta: 85, deltaPct: 2125,
        confidence: 'high', hasData: true, n: 339,
        lifecycleClass: 'decision',
      } as CanonicalInsight,
      {
        id: 'workflow-session-distribution__claude_code',
        title: 'Claude Code session distribution is materially skewed (p90/p50 = 35x)',
        cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 2,
        presentationType: 'evidence_only', comparisonMode: 'absolute',
        current: 621, baseline: 17.6, delta: 603, deltaPct: 3426,
        confidence: 'high', hasData: true, n: 339,
      } as CanonicalInsight,
    ]

    const result = applyPortfolioConsolidation(insights)
    expect(result.visible.length).toBe(1)
    expect(result.visible[0].id).toBe('ai-intensity-cohort-analysis__claude_code')
    expect(result.suppressed.length).toBe(1)
    expect(result.suppressed[0].id).toBe('workflow-session-distribution__claude_code')
    expect(result.suppressed[0].portfolioSuppressed).toBe(true)
    expect(result.suppressed[0].isDiagnostic).not.toBe(true)
  })

  it('does not suppress distribution for a different workflow', () => {
    const insights: CanonicalInsight[] = [
      {
        id: 'ai-intensity-cohort-analysis__claude_code',
        title: 'Claude bimodal', cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 1,
        presentationType: 'comparison', comparisonMode: 'absolute',
        current: 89, confidence: 'high', hasData: true, n: 339,
        lifecycleClass: 'decision',
      } as CanonicalInsight,
      {
        id: 'workflow-session-distribution__vscode',
        title: 'VS Code distribution', cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 2,
        presentationType: 'evidence_only', comparisonMode: 'absolute',
        current: 27, confidence: 'high', hasData: true, n: 2025,
      } as CanonicalInsight,
    ]

    const result = applyPortfolioConsolidation(insights)
    // Both should be visible — different workflows, no redundancy
    expect(result.visible.length).toBe(2)
    expect(result.suppressed.length).toBe(0)
  })

  it('does not suppress when intensity-cohort is diagnostic', () => {
    const insights: CanonicalInsight[] = [
      {
        id: 'ai-intensity-cohort-analysis__claude_code',
        title: 'Needs more data', cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 1,
        presentationType: 'evidence_only', comparisonMode: 'absolute',
        current: 0, confidence: 'low', hasData: false, isDiagnostic: true,
      } as CanonicalInsight,
      {
        id: 'workflow-session-distribution__claude_code',
        title: 'Claude distribution', cicdStage: 'plan-code', canonicalPriority: 1, renderOrder: 2,
        presentationType: 'evidence_only', comparisonMode: 'absolute',
        current: 621, confidence: 'high', hasData: true, n: 339,
      } as CanonicalInsight,
    ]

    const result = applyPortfolioConsolidation(insights)
    // Distribution should remain visible since cohort is diagnostic
    const distVisible = result.visible.find(i => i.id === 'workflow-session-distribution__claude_code')
    expect(distVisible).toBeDefined()
  })
})
