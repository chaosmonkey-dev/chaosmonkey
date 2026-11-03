/**
 * CR-X P0-1: Stage-balanced Top Insights selection tests.
 *
 * Proves that getTopInsights reserves one highest-ranked eligible finding
 * per canonical lifecycle stage (plan-code, review-merge, deploy-operate),
 * fills remaining slots by global materiality ranking, and returns the
 * selected five in original global rank order.
 *
 * Contract:
 *   - When all 3 stages have eligible findings: >=1 each, exactly 5 total
 *   - Original global rank order preserved (stage balancing determines
 *     membership, not display order)
 *   - Missing stage: no synthetic fill, remaining slots fill normally
 *   - Diagnostics never satisfy a stage reservation
 *   - Ineligible/weak findings never get promoted
 *   - No duplicate insights in the result
 *   - MAX_TOP = 5 never exceeded
 *   - All Insights inventory unaffected (input array not mutated)
 */
import { describe, it, expect } from 'vitest';
import { getTopInsights } from '../lib/insights/final/utils/ranking';
import type { CanonicalInsight, CanonicalStage } from '../lib/insights/final/types';

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

describe('CR-X P0-1: Stage-balanced Top Insights', () => {
  // ─── 1. THREE-STAGE BALANCE ─────────────────────────────────────

  it('reserves at least one finding per stage when all 3 stages have eligible findings', () => {
    // Top-scoring findings are all plan-code, but R&M and D&O exist lower.
    const insights: CanonicalInsight[] = [
      mkInsight('pc-1', { cicdStage: 'plan-code', current: 200, n: 100 }),
      mkInsight('pc-2', { cicdStage: 'plan-code', current: 180, n: 100 }),
      mkInsight('pc-3', { cicdStage: 'plan-code', current: 160, n: 100 }),
      mkInsight('pc-4', { cicdStage: 'plan-code', current: 140, n: 100 }),
      mkInsight('rm-1', { cicdStage: 'review-merge', current: 50, n: 80 }),
      mkInsight('do-1', { cicdStage: 'deploy-operate', current: 30, n: 60 }),
    ];

    const top = getTopInsights(insights);

    expect(top.length).toBe(5);
    const stages = new Set(top.map(i => i.cicdStage));
    expect(stages.has('plan-code')).toBe(true);
    expect(stages.has('review-merge')).toBe(true);
    expect(stages.has('deploy-operate')).toBe(true);
  });

  // ─── 2. ORIGINAL RANK ORDER PRESERVED ───────────────────────────

  it('returns selected findings in original global rank order', () => {
    // Global ranking by score: pc-1 > pc-2 > pc-3 > rm-1 > do-1
    // Stage-balanced membership: pc-1, pc-2, pc-3, rm-1, do-1
    // Display order should follow global rank: pc-1, pc-2, pc-3, rm-1, do-1
    const insights: CanonicalInsight[] = [
      mkInsight('pc-1', { cicdStage: 'plan-code', current: 200, n: 100 }),
      mkInsight('pc-2', { cicdStage: 'plan-code', current: 180, n: 100 }),
      mkInsight('pc-3', { cicdStage: 'plan-code', current: 160, n: 100 }),
      mkInsight('rm-1', { cicdStage: 'review-merge', current: 50, n: 80 }),
      mkInsight('do-1', { cicdStage: 'deploy-operate', current: 30, n: 60 }),
    ];

    const top = getTopInsights(insights);

    // The R&M and D&O findings are lower-ranked than the P&C findings.
    // They should appear AFTER the P&C findings in the result, not first.
    const ids = top.map(i => i.id);
    const rmIdx = ids.indexOf('rm-1');
    const doIdx = ids.indexOf('do-1');
    const pc3Idx = ids.indexOf('pc-3');

    // R&M and D&O should be present
    expect(rmIdx).toBeGreaterThanOrEqual(0);
    expect(doIdx).toBeGreaterThanOrEqual(0);

    // R&M and D&O should appear after the top P&C findings (rank order preserved)
    expect(rmIdx).toBeGreaterThan(pc3Idx);
    expect(doIdx).toBeGreaterThan(pc3Idx);
  });

  // ─── 3. MISSING STAGE ───────────────────────────────────────────

  it('does not synthesize a missing stage and fills normally', () => {
    // No deploy-operate findings at all
    const insights: CanonicalInsight[] = [
      mkInsight('pc-1', { cicdStage: 'plan-code', current: 200, n: 100 }),
      mkInsight('pc-2', { cicdStage: 'plan-code', current: 180, n: 100 }),
      mkInsight('pc-3', { cicdStage: 'plan-code', current: 160, n: 100 }),
      mkInsight('pc-4', { cicdStage: 'plan-code', current: 140, n: 100 }),
      mkInsight('rm-1', { cicdStage: 'review-merge', current: 50, n: 80 }),
    ];

    const top = getTopInsights(insights);

    expect(top.length).toBe(5);
    const stages = new Set(top.map(i => i.cicdStage));
    expect(stages.has('deploy-operate')).toBe(false);
    expect(stages.has('plan-code')).toBe(true);
    expect(stages.has('review-merge')).toBe(true);
  });

  // ─── 4. DIAGNOSTIC DOES NOT SATISFY STAGE ───────────────────────

  it('does not pull a diagnostic into Top Insights to satisfy a stage', () => {
    // The only deploy-operate finding is a diagnostic — must NOT be selected
    const insights: CanonicalInsight[] = [
      mkInsight('pc-1', { cicdStage: 'plan-code', current: 200, n: 100 }),
      mkInsight('pc-2', { cicdStage: 'plan-code', current: 180, n: 100 }),
      mkInsight('pc-3', { cicdStage: 'plan-code', current: 160, n: 100 }),
      mkInsight('pc-4', { cicdStage: 'plan-code', current: 140, n: 100 }),
      mkInsight('pc-5', { cicdStage: 'plan-code', current: 120, n: 100 }),
      mkInsight('do-diag', {
        cicdStage: 'deploy-operate',
        current: 999,
        n: 100,
        isDiagnostic: true,
        hasData: false,
      }),
    ];

    const top = getTopInsights(insights);

    expect(top.length).toBeLessThanOrEqual(5);
    expect(top.find(i => i.id === 'do-diag')).toBeUndefined();
    // No deploy-operate in the result since the only D&O is a diagnostic
    const stages = new Set(top.map(i => i.cicdStage));
    expect(stages.has('deploy-operate')).toBe(false);
  });

  // ─── 5. INELIGIBLE/WEAK DOES NOT GET PROMOTED ────────────────────

  it('does not promote ineligible findings to satisfy a stage', () => {
    // The only deploy-operate finding has comparisonState=needs_more_data
    // and n=0, which makes it ineligible
    const insights: CanonicalInsight[] = [
      mkInsight('pc-1', { cicdStage: 'plan-code', current: 200, n: 100 }),
      mkInsight('pc-2', { cicdStage: 'plan-code', current: 180, n: 100 }),
      mkInsight('pc-3', { cicdStage: 'plan-code', current: 160, n: 100 }),
      mkInsight('pc-4', { cicdStage: 'plan-code', current: 140, n: 100 }),
      mkInsight('pc-5', { cicdStage: 'plan-code', current: 120, n: 100 }),
      mkInsight('do-ineligible', {
        cicdStage: 'deploy-operate',
        current: 999,
        n: 0,
        comparisonState: 'needs_more_data',
      }),
    ];

    const top = getTopInsights(insights);

    expect(top.find(i => i.id === 'do-ineligible')).toBeUndefined();
    const stages = new Set(top.map(i => i.cicdStage));
    expect(stages.has('deploy-operate')).toBe(false);
  });

  // ─── 6. NO DUPLICATES ───────────────────────────────────────────

  it('never renders a reserved stage representative twice', () => {
    const insights: CanonicalInsight[] = [
      mkInsight('pc-1', { cicdStage: 'plan-code', current: 200, n: 100 }),
      mkInsight('pc-2', { cicdStage: 'plan-code', current: 180, n: 100 }),
      mkInsight('rm-1', { cicdStage: 'review-merge', current: 50, n: 80 }),
      mkInsight('do-1', { cicdStage: 'deploy-operate', current: 30, n: 60 }),
    ];

    const top = getTopInsights(insights);

    const ids = top.map(i => i.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  // ─── 7. MAX_TOP = 5 ─────────────────────────────────────────────

  it('never exceeds 5 insights', () => {
    const insights: CanonicalInsight[] = [
      mkInsight('pc-1', { cicdStage: 'plan-code', current: 200, n: 100 }),
      mkInsight('pc-2', { cicdStage: 'plan-code', current: 180, n: 100 }),
      mkInsight('pc-3', { cicdStage: 'plan-code', current: 160, n: 100 }),
      mkInsight('pc-4', { cicdStage: 'plan-code', current: 140, n: 100 }),
      mkInsight('pc-5', { cicdStage: 'plan-code', current: 120, n: 100 }),
      mkInsight('pc-6', { cicdStage: 'plan-code', current: 100, n: 100 }),
      mkInsight('rm-1', { cicdStage: 'review-merge', current: 50, n: 80 }),
      mkInsight('rm-2', { cicdStage: 'review-merge', current: 40, n: 80 }),
      mkInsight('do-1', { cicdStage: 'deploy-operate', current: 30, n: 60 }),
      mkInsight('do-2', { cicdStage: 'deploy-operate', current: 20, n: 60 }),
    ];

    const top = getTopInsights(insights);
    expect(top.length).toBeLessThanOrEqual(5);
  });

  // ─── 8. ALL INSIGHTS UNAFFECTED ─────────────────────────────────

  it('does not mutate the input array', () => {
    const insights: CanonicalInsight[] = [
      mkInsight('pc-1', { cicdStage: 'plan-code', current: 200, n: 100 }),
      mkInsight('pc-2', { cicdStage: 'plan-code', current: 180, n: 100 }),
      mkInsight('rm-1', { cicdStage: 'review-merge', current: 50, n: 80 }),
      mkInsight('do-1', { cicdStage: 'deploy-operate', current: 30, n: 60 }),
    ];

    const originalLength = insights.length;
    const originalIds = insights.map(i => i.id);

    getTopInsights(insights);

    // Input array length and order unchanged
    expect(insights.length).toBe(originalLength);
    expect(insights.map(i => i.id)).toEqual(originalIds);
  });

  // ─── EDGE: only 1 stage available ───────────────────────────────

  it('fills all 5 from one stage when only one stage has eligible findings', () => {
    const insights: CanonicalInsight[] = [
      mkInsight('pc-1', { cicdStage: 'plan-code', current: 200, n: 100 }),
      mkInsight('pc-2', { cicdStage: 'plan-code', current: 180, n: 100 }),
      mkInsight('pc-3', { cicdStage: 'plan-code', current: 160, n: 100 }),
      mkInsight('pc-4', { cicdStage: 'plan-code', current: 140, n: 100 }),
      mkInsight('pc-5', { cicdStage: 'plan-code', current: 120, n: 100 }),
    ];

    const top = getTopInsights(insights);

    expect(top.length).toBe(5);
    expect(top.every(i => i.cicdStage === 'plan-code')).toBe(true);
  });

  // ─── EDGE: fewer than 5 eligible total ──────────────────────────

  it('shows all eligible findings when fewer than 5 exist', () => {
    const insights: CanonicalInsight[] = [
      mkInsight('pc-1', { cicdStage: 'plan-code', current: 200, n: 100 }),
      mkInsight('rm-1', { cicdStage: 'review-merge', current: 50, n: 80 }),
      mkInsight('do-1', { cicdStage: 'deploy-operate', current: 30, n: 60 }),
    ];

    const top = getTopInsights(insights);

    expect(top.length).toBe(3);
    const stages = new Set(top.map(i => i.cicdStage));
    expect(stages.has('plan-code')).toBe(true);
    expect(stages.has('review-merge')).toBe(true);
    expect(stages.has('deploy-operate')).toBe(true);
  });

  // ─── EDGE: 2 stages available ───────────────────────────────────

  it('represents both stages when only 2 are available', () => {
    const insights: CanonicalInsight[] = [
      mkInsight('pc-1', { cicdStage: 'plan-code', current: 200, n: 100 }),
      mkInsight('pc-2', { cicdStage: 'plan-code', current: 180, n: 100 }),
      mkInsight('pc-3', { cicdStage: 'plan-code', current: 160, n: 100 }),
      mkInsight('rm-1', { cicdStage: 'review-merge', current: 50, n: 80 }),
      mkInsight('rm-2', { cicdStage: 'review-merge', current: 40, n: 80 }),
    ];

    const top = getTopInsights(insights);

    expect(top.length).toBe(5);
    const stages = new Set(top.map(i => i.cicdStage));
    expect(stages.has('plan-code')).toBe(true);
    expect(stages.has('review-merge')).toBe(true);
    expect(stages.has('deploy-operate')).toBe(false);
  });

  // ─── 9. STAGE PRIORITY OVER FAMILY QUOTA ────────────────────────

  it('stage reservation is never blocked by family quota — 3 same-family stage reps', () => {
    // All 3 stages have unit_economics as their highest-ranked finding.
    // Stage guarantee has HARD priority over quota — all 3 must be selected.
    // A 4th unit_economics candidate must NOT enter through a free slot.
    const insights: CanonicalInsight[] = [
      mkInsight('workflow-delivery-efficiency', { cicdStage: 'plan-code', current: 300, n: 100 }),
      mkInsight('allocated-spend-per-merged-pr', { cicdStage: 'review-merge', current: 200, n: 100 }),
      mkInsight('allocated-spend-per-deployment', { cicdStage: 'deploy-operate', current: 150, n: 100 }),
      // 4th UE candidate competing for a free slot — must be blocked
      mkInsight('allocated-spend-per-successful-deployment', { cicdStage: 'plan-code', current: 90, n: 100 }),
      // Other-family candidates to fill remaining 2 free slots
      mkInsight('active-coding-time-by-ide', { cicdStage: 'plan-code', current: 80, n: 100 }),
      mkInsight('within-workflow-ai-effect__cursor', { cicdStage: 'plan-code', current: 70, n: 100 }),
    ];

    const top = getTopInsights(insights);

    expect(top.length).toBe(5);
    // All 3 UE stage reps present (stage priority > quota)
    expect(top.find(i => i.id === 'workflow-delivery-efficiency')).toBeDefined();
    expect(top.find(i => i.id === 'allocated-spend-per-merged-pr')).toBeDefined();
    expect(top.find(i => i.id === 'allocated-spend-per-deployment')).toBeDefined();
    // 4th UE candidate blocked from free slot (quota consumed by 3 reps)
    expect(top.find(i => i.id === 'allocated-spend-per-successful-deployment')).toBeUndefined();
  });

  // ─── 10. TWO-STAGE-SAME-FAMILY ───────────────────────────────────

  it('two stages with same family both get reps, third same-family blocked from free slot', () => {
    // R&M and D&O best are both unit_economics — both selected as stage reps.
    // A third strong UE candidate must NOT enter a free slot.
    const insights: CanonicalInsight[] = [
      mkInsight('active-coding-time-by-ide', { cicdStage: 'plan-code', current: 300, n: 100 }),
      mkInsight('allocated-spend-per-merged-pr', { cicdStage: 'review-merge', current: 200, n: 100 }),
      mkInsight('allocated-spend-per-deployment', { cicdStage: 'deploy-operate', current: 150, n: 100 }),
      // Strong 3rd UE candidate for free slot — must be blocked
      mkInsight('allocated-spend-per-successful-deployment', { cicdStage: 'plan-code', current: 140, n: 100 }),
      // Other-family candidates to fill free slots
      mkInsight('within-workflow-ai-effect__cursor', { cicdStage: 'plan-code', current: 80, n: 100 }),
      mkInsight('ai-intensity-cohort-analysis__devin', { cicdStage: 'plan-code', current: 70, n: 100 }),
    ];

    const top = getTopInsights(insights);

    expect(top.length).toBe(5);
    // Both UE stage reps present
    expect(top.find(i => i.id === 'allocated-spend-per-merged-pr')).toBeDefined();
    expect(top.find(i => i.id === 'allocated-spend-per-deployment')).toBeDefined();
    // Third UE blocked
    expect(top.find(i => i.id === 'allocated-spend-per-successful-deployment')).toBeUndefined();
  });

  // ─── 11. COST DOES NOT DOMINATE VIA FREE SLOTS ─────────────────

  it('cost family does not dominate — reserved rep consumes quota, no free-slot cost', () => {
    // Deploy-operate best is cost (reserved rep). Two more cost candidates
    // exist in plan-code but are NOT the plan-code stage rep. Cost quota=1
    // is consumed by the reserved rep, so no additional cost enters free slots.
    const insights: CanonicalInsight[] = [
      mkInsight('active-coding-time-by-ide', { cicdStage: 'plan-code', current: 300, n: 100 }),
      mkInsight('focus-ratio-by-ide', { cicdStage: 'review-merge', current: 200, n: 100 }),
      mkInsight('configured-cost-efficiency-by-workflow', { cicdStage: 'deploy-operate', current: 150, n: 100 }),
      // Two more cost candidates competing for free slots — must be blocked
      mkInsight('developer-workflow-cost-efficiency-frontier', { cicdStage: 'plan-code', current: 90, n: 100 }),
      mkInsight('workflow-cost-delivery-comparison', { cicdStage: 'plan-code', current: 85, n: 100 }),
      // Other-family candidates to fill free slots
      mkInsight('within-workflow-ai-effect__cursor', { cicdStage: 'plan-code', current: 80, n: 100 }),
    ];

    const top = getTopInsights(insights);

    const costCount = top.filter(i =>
      i.id === 'configured-cost-efficiency-by-workflow' ||
      i.id === 'developer-workflow-cost-efficiency-frontier' ||
      i.id === 'workflow-cost-delivery-comparison'
    ).length;
    // Only the reserved cost rep — no additional cost from free slots
    expect(costCount).toBe(1);
  });

  // ─── 12. LONGITUDINAL FREE-SLOT QUOTA ───────────────────────────

  it('longitudinal family does not dominate free slots — quota 1', () => {
    // Stage reps from all 3 stages (non-longitudinal). Multiple longitudinal
    // candidates compete for free slots but quota=1 allows only 1.
    const insights: CanonicalInsight[] = [
      mkInsight('active-coding-time-by-ide', { cicdStage: 'plan-code', current: 300, n: 100 }),
      mkInsight('focus-ratio-by-ide', { cicdStage: 'review-merge', current: 200, n: 100 }),
      mkInsight('change-failure-rate-spike-by-ide', { cicdStage: 'deploy-operate', current: 150, n: 100 }),
      // Multiple longitudinal candidates for free slots
      mkInsight('ai-adoption-velocity', { cicdStage: 'plan-code', current: 100, n: 100 }),
      mkInsight('monthly-workflow-share', { cicdStage: 'plan-code', current: 95, n: 100 }),
      mkInsight('commit-ttfc-longitudinal', { cicdStage: 'plan-code', current: 90, n: 100 }),
    ];

    const top = getTopInsights(insights);

    const longitudinalCount = top.filter(i =>
      i.id === 'ai-adoption-velocity' ||
      i.id === 'monthly-workflow-share' ||
      i.id === 'commit-ttfc-longitudinal'
    ).length;
    // Quota=1 — at most 1 longitudinal in free slots
    expect(longitudinalCount).toBeLessThanOrEqual(1);
  });

  // ─── 13. WITHIN-WORKFLOW FREE-SLOT QUOTA ────────────────────────

  it('within-workflow family does not dominate free slots — quota 2', () => {
    const insights: CanonicalInsight[] = [
      mkInsight('active-coding-time-by-ide', { cicdStage: 'plan-code', current: 300, n: 100 }),
      mkInsight('focus-ratio-by-ide', { cicdStage: 'review-merge', current: 200, n: 100 }),
      mkInsight('change-failure-rate-spike-by-ide', { cicdStage: 'deploy-operate', current: 150, n: 100 }),
      // 3 within-workflow candidates for free slots — quota=2
      mkInsight('within-workflow-ai-effect__cursor', { cicdStage: 'plan-code', current: 100, n: 100 }),
      mkInsight('ai-intensity-cohort-analysis__devin', { cicdStage: 'plan-code', current: 95, n: 100 }),
      mkInsight('workflow-session-distribution', { cicdStage: 'plan-code', current: 90, n: 100 }),
    ];

    const top = getTopInsights(insights);

    const wwCount = top.filter(i =>
      i.id.startsWith('within-workflow-ai-effect') ||
      i.id.startsWith('ai-intensity-cohort-analysis') ||
      i.id === 'workflow-session-distribution'
    ).length;
    // Quota=2 — at most 2 within-workflow in free slots
    expect(wwCount).toBeLessThanOrEqual(2);
  });

  // ─── 14. DECISION-FIRST FILL ───────────────────────────────────

  it('decision candidates fill free slots before contextual candidates', () => {
    // 3 stage reps (all decision). 2 free slots available.
    // 2 decision free candidates + 1 contextual free candidate.
    // Decision pool fills first — contextual excluded.
    const insights: CanonicalInsight[] = [
      mkInsight('active-coding-time-by-ide', { cicdStage: 'plan-code', current: 300, n: 100 }),
      mkInsight('focus-ratio-by-ide', { cicdStage: 'review-merge', current: 200, n: 100 }),
      mkInsight('change-failure-rate-spike-by-ide', { cicdStage: 'deploy-operate', current: 150, n: 100 }),
      // 2 decision free candidates
      mkInsight('within-workflow-ai-effect__cursor', { cicdStage: 'plan-code', current: 100, n: 100 }),
      mkInsight('ai-intensity-cohort-analysis__devin', { cicdStage: 'plan-code', current: 95, n: 100 }),
      // 1 contextual free candidate — must NOT displace a decision candidate
      mkInsight('ai-adoption-velocity', {
        cicdStage: 'plan-code', current: 200, n: 100,
        urgencyLabel: 'informational',
      }),
    ];

    const top = getTopInsights(insights);

    expect(top.length).toBe(5);
    // Both decision candidates present
    expect(top.find(i => i.id === 'within-workflow-ai-effect__cursor')).toBeDefined();
    expect(top.find(i => i.id === 'ai-intensity-cohort-analysis__devin')).toBeDefined();
    // Contextual candidate excluded (decision pool filled both free slots)
    expect(top.find(i => i.id === 'ai-adoption-velocity')).toBeUndefined();
  });
});
