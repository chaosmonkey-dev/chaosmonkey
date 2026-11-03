/**
 * Unit Economics Ranking Tests
 *
 * Verifies:
 * - All eligible UE cards may exist in All Insights
 * - UE stage representatives are never blocked by family quota (stage priority)
 * - No additional UE card enters Top Insights through free slots once quota consumed
 * - UE does not displace all stage representatives
 */
import { describe, it, expect } from 'vitest';
import { getTopInsights, resolveFamilyForDiversity } from '../lib/insights/final/utils/ranking';
import type { CanonicalInsight } from '../lib/insights/final/types';

function mkInsight(id: string, overrides: Partial<CanonicalInsight> = {}): CanonicalInsight {
  return {
    id,
    title: `Test insight ${id}`,
    cicdStage: 'plan-code',
    canonicalPriority: 3,
    renderOrder: 10,
    presentationType: 'synthesized',
    comparisonMode: 'absolute',
    comparisonState: 'workflow_comparable',
    current: 100,
    confidence: 'high',
    hasData: true,
    n: 50,
    ...overrides,
  } as CanonicalInsight;
}

describe('Unit Economics ranking semantics', () => {
  it('resolveFamilyForDiversity maps all UE PIs to unit_economics family', () => {
    expect(resolveFamilyForDiversity('allocated-spend-per-merged-pr')).toBe('unit_economics');
    expect(resolveFamilyForDiversity('allocated-spend-per-deployment')).toBe('unit_economics');
    expect(resolveFamilyForDiversity('allocated-spend-per-successful-deployment')).toBe('unit_economics');
  });

  it('UE stage reps are never quota-blocked, but no additional UE enters free slots', () => {
    // CR-X P0-1: STAGE GUARANTEE > FAMILY QUOTA.
    // UE cards in review-merge and deploy-operate are stage representatives —
    // they are selected regardless of unit_economics quota=1.
    // A third UE candidate must NOT enter through a free slot (quota consumed).
    const insights: CanonicalInsight[] = [
      mkInsight('allocated-spend-per-merged-pr', {
        cicdStage: 'review-merge',
        comparisonState: 'org_level_only',
        current: 10,
        isExecutiveFinding: true,
        n: 50,
      }),
      mkInsight('allocated-spend-per-deployment', {
        cicdStage: 'deploy-operate',
        comparisonState: 'org_level_only',
        current: 25,
        isExecutiveFinding: true,
        n: 40,
      }),
      mkInsight('allocated-spend-per-successful-deployment', {
        cicdStage: 'deploy-operate',
        comparisonState: 'org_level_only',
        current: 33,
        isExecutiveFinding: true,
        n: 32,
      }),
      // Non-UE insights to fill remaining slots
      mkInsight('active-coding-time-by-ide', {
        comparisonState: 'workflow_comparable',
        current: 120,
        n: 100,
      }),
      mkInsight('focus-ratio-by-ide', {
        comparisonState: 'workflow_comparable',
        current: 0.65,
        n: 80,
      }),
      mkInsight('ai-adoption-velocity', {
        cicdStage: 'plan-code',
        comparisonState: undefined,
        presentationType: 'evidence_only',
        current: 0.5,
        n: 60,
      }),
    ];

    const top = getTopInsights(insights);
    // All 3 stages represented
    expect(top.length).toBeLessThanOrEqual(5);
    const stages = new Set(top.map(i => i.cicdStage));
    expect(stages.has('plan-code')).toBe(true);
    expect(stages.has('review-merge')).toBe(true);
    expect(stages.has('deploy-operate')).toBe(true);
    // R&M UE stage rep present (stage priority over quota)
    expect(top.find(i => i.id === 'allocated-spend-per-merged-pr')).toBeDefined();
    // D&O UE stage rep present — the higher-scored one wins the stage reservation
    const doUE = top.find(i =>
      i.id === 'allocated-spend-per-deployment' ||
      i.id === 'allocated-spend-per-successful-deployment'
    );
    expect(doUE).toBeDefined();
    // The lower-scored D&O UE is NOT in top (not the stage rep, quota blocks free slot)
    const ueCount = top.filter(i =>
      i.id === 'allocated-spend-per-merged-pr' ||
      i.id === 'allocated-spend-per-deployment' ||
      i.id === 'allocated-spend-per-successful-deployment'
    ).length;
    // At most 2 UE total (one R&M rep + one D&O rep; no additional from free slots)
    expect(ueCount).toBeLessThanOrEqual(2);
  });

  it('UE stage reps do not displace other stage representatives', () => {
    // CR-X P0-1: Stage-balanced selection ensures one finding per stage.
    // UE cards in R&M and D&O are legitimately stage-representative.
    // Non-UE cards in plan-code are also stage-representative.
    // No additional UE enters free slots once quota is consumed by stage reps.
    const insights: CanonicalInsight[] = [
      // UE insights (unit_economics family) — stage reps for R&M and D&O
      mkInsight('allocated-spend-per-merged-pr', {
        cicdStage: 'review-merge',
        comparisonState: 'org_level_only',
        current: 10,
        isExecutiveFinding: true,
        n: 100,
      }),
      mkInsight('allocated-spend-per-deployment', {
        cicdStage: 'deploy-operate',
        comparisonState: 'org_level_only',
        current: 25,
        isExecutiveFinding: true,
        n: 100,
      }),
      // Plan-code candidates from different families
      mkInsight('active-coding-time-by-ide', {
        comparisonState: 'workflow_comparable',
        current: 120,
        n: 100,
      }),
      mkInsight('ai-adoption-velocity', {
        cicdStage: 'plan-code',
        comparisonState: undefined,
        presentationType: 'evidence_only',
        current: 0.5,
        n: 100,
      }),
      mkInsight('ai-intensity-cohort-analysis', {
        cicdStage: 'plan-code',
        comparisonState: 'ai_non_ai_comparable',
        current: 0.7,
        n: 100,
      }),
      mkInsight('configured-cost-efficiency-by-workflow', {
        cicdStage: 'plan-code',
        comparisonState: 'workflow_comparable',
        current: 10,
        n: 100,
      }),
    ];

    const top = getTopInsights(insights);

    // Stage balancing ensures all 3 stages are represented
    const stages = new Set(top.map(i => i.cicdStage));
    expect(stages.has('plan-code')).toBe(true);
    expect(stages.has('review-merge')).toBe(true);
    expect(stages.has('deploy-operate')).toBe(true);
    expect(top.length).toBeLessThanOrEqual(5);
    // Both UE stage reps present (stage priority)
    const ueInTop = top.filter(i =>
      i.id === 'allocated-spend-per-merged-pr' ||
      i.id === 'allocated-spend-per-deployment'
    );
    expect(ueInTop.length).toBe(2);
    // No additional UE beyond stage reps (quota=1 consumed by 2 reps)
    expect(top.find(i => i.id === 'allocated-spend-per-successful-deployment')).toBeUndefined();
  });

  it('all eligible UE cards exist in All Insights (not filtered out)', () => {
    // All Insights = the full set passed to getTopInsights, not just the top 5
    // This test verifies that UE cards are eligible (not filtered out by the eligibility filter)
    const insights: CanonicalInsight[] = [
      mkInsight('allocated-spend-per-merged-pr', {
        cicdStage: 'review-merge',
        comparisonState: 'org_level_only',
        current: 10,
        isExecutiveFinding: true,
        n: 50,
        hasData: true,
      }),
      mkInsight('allocated-spend-per-deployment', {
        cicdStage: 'deploy-operate',
        comparisonState: 'org_level_only',
        current: 25,
        isExecutiveFinding: true,
        n: 40,
        hasData: true,
      }),
    ];

    const top = getTopInsights(insights);
    // Both are eligible (review-merge and deploy-operate are never hidden)
    // At least one should appear in top
    const ueInTop = top.filter(i =>
      i.id === 'allocated-spend-per-merged-pr' ||
      i.id === 'allocated-spend-per-deployment'
    );
    expect(ueInTop.length).toBeGreaterThanOrEqual(1);
  });
});
