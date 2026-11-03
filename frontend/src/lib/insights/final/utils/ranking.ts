/**
 * Ranking Utilities for Final Canonical Performance Insights
 * 
 * This module provides deterministic sorting logic for canonical insights.
 * 
 * INTENDED FUTURE DATA FLOW:
 * 1. Generators produce CanonicalInsight objects
 * 2. Insights are filtered to canonical registry only (no other filters)
 * 3. Insights are sorted by stage (plan-code → review-merge → deploy-operate)
 * 4. Within each stage, insights are sorted by renderOrder from canonical registry
 * 5. No confidence/baseline/no-delta gates for canonical PIs
 * 6. No MVP allowlist filtering
 * 7. No deduping (canonical PIs are unique by definition)
 * 
 * No imports from old V2 systems (computeV2PerformanceInsights.ts, piV2Manifest.ts, V2_PREVIEW_ROW_IDS)
 */

import type { CanonicalInsight, CanonicalStage, SemanticFamily } from '../types';
import { getCanonicalPIById } from '../canonicalInsights';
import { piDebugLog } from './logging';
import { classifyLifecycleClass } from '../classifyLifecycleClass';

/**
 * CR-X FINAL: Semantic family resolver — maps PI IDs to executive question
 * families for portfolio orchestration, dominance, and Top Insights diversity.
 *
 * This is the SINGLE authority for semantic family assignment. It is used:
 * 1. By the pipeline to stamp semanticFamily on every insight after generation
 * 2. By the portfolio consolidation pass for dominance decisions
 * 3. By getTopInsights for diversity enforcement
 *
 * Runtime instance IDs (base__workflow) resolve to their base family.
 */
const SEMANTIC_FAMILY_MAP: Record<string, SemanticFamily> = {
  // ── Plan & Code: Workflow mix / adoption ──────────────────────
  'monthly-workflow-share': 'workflow-mix',
  'telemetry-ai-focus-imbalance': 'workflow-mix',
  'ai-adoption-rate-by-ide': 'workflow-mix',
  'ai-adoption-velocity': 'workflow-mix',
  'executive-workflow-mix-synthesis': 'workflow-mix',
  'early-signal-workflow-adoption': 'workflow-mix',

  // ── Plan & Code: Workflow temporal / recent change ────────────
  'recent-change': 'workflow-temporal',
  'commit-ttfc-longitudinal': 'workflow-temporal',
  'within-workflow-temporal-behavior': 'workflow-temporal',

  // ── Plan & Code: Workflow cross-comparison ────────────────────
  'active-coding-time-by-ide': 'workflow-cross-comparison',
  'focus-ratio-by-ide': 'workflow-cross-comparison',
  'files-edited-by-ide': 'workflow-cross-comparison',
  'session-profile-by-ide': 'workflow-cross-comparison',
  'commits-per-session-by-ide': 'workflow-cross-comparison',
  'multi-tool-day-effect': 'workflow-cross-comparison',
  'delivery-rate-ai-vs-non-ai': 'workflow-cross-comparison',
  'time-to-first-commit-by-ide': 'workflow-cross-comparison',

  // ── Plan & Code: Repo concentration ──────────────────────────
  'repository-concentration': 'repo-concentration',
  'workflow-repo-allocation': 'repo-concentration',
  'workflow-repo-allocation-shift': 'repo-concentration',

  // ── Plan & Code: Repo cross-comparison ────────────────────────
  'repository-distribution-by-workflow': 'repo-cross-comparison',
  'repo-conditioned-behavior': 'repo-cross-comparison',

  // ── Plan & Code: Within-workflow behavior ────────────────────
  'within-workflow-ai-effect': 'within-workflow',
  'ai-intensity-cohort-analysis': 'within-workflow',
  'workflow-session-distribution': 'within-workflow',
  'within-workflow-ai-signal-coverage': 'within-workflow',
  'within-workflow-session-duration-profile': 'within-workflow',
  'within-workflow-commits-profile': 'within-workflow',
  'within-workflow-ttfc-profile': 'within-workflow',
  'observed-session-overlap': 'within-workflow',
  'rework-rate-by-workflow': 'within-workflow',
  'active-coding-ratio-by-workflow': 'within-workflow',
  'rework-loop-detection': 'within-workflow',
  'context-switching-impact': 'within-workflow',
  'early-signal-developer-activity': 'within-workflow',
  'claude-code-runtime-cohort': 'within-workflow',

  // ── Plan & Code: Economics ───────────────────────────────────
  'configured-cost-efficiency-by-workflow': 'economics',
  'developer-workflow-cost-efficiency-frontier': 'economics',
  'workflow-cost-delivery-comparison': 'economics',
  'workflow-delivery-efficiency': 'economics',

  // ── Plan & Code: Diagnostics (data/coverage gaps) ─────────────
  'pilot-maturity-progression': 'diagnostic',
  'executive-ai-yield-optimization': 'diagnostic',
  'debug-time-by-ide': 'diagnostic',
  'terminal-time-by-ide': 'diagnostic',
  'workflow-quality-correlation': 'diagnostic',
  'session-quality-merge-success': 'diagnostic',
  'ai-intensity-delivery-velocity': 'diagnostic',
  'review-burden-by-ai-pattern': 'diagnostic',

  // ── Review & Merge: Review cycle ──────────────────────────────
  'reviewer-load-concentration': 'review-cycle',
  'merge-cycle-time': 'review-cycle',
  'review-burden': 'review-cycle',

  // ── Review & Merge: Review quality ────────────────────────────
  'executive-small-pr-workflow-optimization': 'review-quality',
  'reopen-pressure-spike': 'review-quality',

  // ── Review & Merge: Delivery throughput ──────────────────────
  'merge-rate': 'delivery-throughput',
  'pr-throughput': 'delivery-throughput',

  // ── Review & Merge: Economics ─────────────────────────────────
  'allocated-spend-per-merged-pr': 'economics',
  'allocated-spend-per-review-cycle': 'economics',

  // ── Review & Merge: Diagnostics ───────────────────────────────
  'session-conditioned-pr-cycle-time-ai-vs-non-ai': 'diagnostic',

  // ── Deploy & Operate: Deployment reliability ──────────────────
  'delivery-velocity-by-workflow': 'deployment-reliability',
  'change-failure-rate-spike-by-ide': 'deployment-reliability',
  'synthesized-deployment-cadence': 'deployment-reliability',
  'deployment-success-distribution': 'deployment-reliability',
  'deployment-failure-concentration': 'deployment-reliability',

  // ── Deploy & Operate: Release reliability ─────────────────────
  'release-cadence': 'release-reliability',

  // ── Deploy & Operate: Economics ───────────────────────────────
  'allocated-spend-per-deployment': 'economics',
  'allocated-spend-per-successful-deployment': 'economics',
  'allocated-spend-per-failed-deployment': 'economics',
  'allocated-spend-per-release': 'economics',
};

/**
 * Resolve a PI ID (including runtime instance IDs) to its semantic family.
 * Falls back to 'diagnostic' for unmapped IDs.
 */
export function resolveSemanticFamily(id: string): SemanticFamily {
  const baseId = id.indexOf('__') >= 0 ? id.substring(0, id.indexOf('__')) : id;
  return SEMANTIC_FAMILY_MAP[baseId] || 'diagnostic';
}

/**
 * Stamp semanticFamily on every insight in a list.
 * Called after evidence qualification, before portfolio consolidation.
 */
export function stampSemanticFamilies(insights: CanonicalInsight[]): CanonicalInsight[] {
  return insights.map(insight => ({
    ...insight,
    semanticFamily: insight.semanticFamily || resolveSemanticFamily(insight.id),
  }));
}

/**
 * Stage order for sorting insights
 * 
 * Order: plan-code → review-merge → deploy-operate
 */
const STAGE_ORDER: CanonicalStage[] = ['plan-code', 'review-merge', 'deploy-operate'];

/**
 * Get stage order index for sorting
 * 
 * @param stage - The canonical stage
 * @returns Numeric index for sorting (0 = plan-code, 1 = review-merge, 2 = deploy-operate)
 */
function getStageOrderIndex(stage: CanonicalStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * Sort canonical insights deterministically
 * 
 * Sorting logic:
 * 1. Primary sort: Diagnostics last (real insights first, diagnostics last)
 * 2. Within real insights: Stage order (plan-code → review-merge → deploy-operate)
 * 3. Within real insights: renderOrder from canonical registry (ascending)
 * 4. Within diagnostics: Stage order (plan-code → review-merge → deploy-operate)
 * 5. Within diagnostics: renderOrder from canonical registry (ascending)
 * 
 * @param insights - Array of canonical insights to sort
 * @returns Sorted array of canonical insights
 */
export function sortCanonicalInsights(insights: CanonicalInsight[]): CanonicalInsight[] {
  // CR-X FINAL: Pre-compute renderOrder for each insight to avoid repeated
  // getCanonicalPIById calls inside the sort comparator (O(n log n) comparisons).
  const renderOrderCache = new Map<string, number>();
  for (const ins of insights) {
    const entry = getCanonicalPIById(ins.id);
    renderOrderCache.set(ins.id, entry?.renderOrder ?? 999);
  }

  return [...insights].sort((a, b) => {
    // Primary sort: diagnostics last
    const isDiagnosticA = a.isDiagnostic === true;
    const isDiagnosticB = b.isDiagnostic === true;
    
    if (isDiagnosticA !== isDiagnosticB) {
      return isDiagnosticA ? 1 : -1; // Diagnostics go last
    }

    // Secondary sort: stage order
    const stageOrderA = getStageOrderIndex(a.cicdStage);
    const stageOrderB = getStageOrderIndex(b.cicdStage);
    
    if (stageOrderA !== stageOrderB) {
      return stageOrderA - stageOrderB;
    }

    // Tertiary sort: renderOrder from canonical registry (cached)
    const renderOrderA = renderOrderCache.get(a.id) ?? 999;
    const renderOrderB = renderOrderCache.get(b.id) ?? 999;
    
    return renderOrderA - renderOrderB;
  });
}

/**
 * Group insights by stage
 * 
 * @param insights - Array of canonical insights to group
 * @returns Object with insights grouped by stage
 */
export function groupInsightsByStage(insights: CanonicalInsight[]): Record<CanonicalStage, CanonicalInsight[]> {
  const grouped: Record<CanonicalStage, CanonicalInsight[]> = {
    'plan-code': [],
    'review-merge': [],
    'deploy-operate': []
  };

  for (const insight of insights) {
    grouped[insight.cicdStage].push(insight);
  }

  return grouped;
}

/**
 * Count insights by stage
 * 
 * @param insights - Array of canonical insights to count
 * @returns Object with insight counts by stage
 */
export function countInsightsByStage(insights: CanonicalInsight[]): Record<CanonicalStage, number> {
  const grouped = groupInsightsByStage(insights);
  
  return {
    'plan-code': grouped['plan-code'].length,
    'review-merge': grouped['review-merge'].length,
    'deploy-operate': grouped['deploy-operate'].length
  };
}

/**
 * Sort insights within a specific stage by renderOrder
 * 
 * @param insights - Array of canonical insights in a single stage
 * @returns Sorted array of canonical insights
 */
export function sortInsightsByRenderOrder(insights: CanonicalInsight[]): CanonicalInsight[] {
  return [...insights].sort((a, b) => {
    const entryA = getCanonicalPIById(a.id);
    const entryB = getCanonicalPIById(b.id);
    
    const renderOrderA = entryA?.renderOrder ?? 999;
    const renderOrderB = entryB?.renderOrder ?? 999;
    
    return renderOrderA - renderOrderB;
  });
}

/**
 * Get insights for a specific stage
 * 
 * @param insights - Array of canonical insights
 * @param stage - The stage to filter by
 * @returns Array of insights for the specified stage
 */
export function getInsightsByStage(insights: CanonicalInsight[], stage: CanonicalStage): CanonicalInsight[] {
  return insights.filter(insight => insight.cicdStage === stage);
}

/**
 * Get executive findings from insights
 * 
 * @param insights - Array of canonical insights
 * @returns Array of executive findings
 */
export function getExecutiveFindings(insights: CanonicalInsight[]): CanonicalInsight[] {
  return insights.filter(insight => insight.isExecutiveFinding === true);
}

/**
 * Get Top Insights — composition-first selection from the post-lifecycle
 * validated canonical finding population.
 *
 * CR5 WS2 #13 P0: Composition-first product contract.
 * Selection order (hardcodes decision families, NOT PI IDs):
 *   1. Strongest eligible cross_tool_behavior
 *   2. Strongest eligible longitudinal
 *   3. Strongest eligible within_workflow_ai
 *   4. Strongest eligible cost (when configured)
 *   5. Fill remaining slots by materiality, respecting family quotas
 *
 * If cost is unavailable, that slot is filled from the strongest remaining
 * eligible family.
 *
 * If fewer than five eligible decision questions exist, returns fewer than
 * five cards. No fixed count.
 *
 * @param insights - Post-lifecycle validated canonical insights (sortedInsights)
 * @returns Array of up to 5 insights suitable for Top Insights curation
 */
/**
 * CR-X FINAL (binding edit 6): Tier disposition multiplier for Top-5
 * competition. TIER 3 descriptive baseline / no-difference cards get a
 * penalty so they don't outrank material findings. They remain visible
 * in All Insights.
 *
 * TIER 3 examples:
 * - repository-concentration with "no material concentration" (no-difference)
 * - workflow-session-distribution generic baseline (no anomaly)
 * - claude-code-runtime-cohort generic "primarily short/long" baseline
 * - within-workflow-ai-signal-coverage generic baseline
 * - pilot-maturity-progression generic status
 */
function getTierMultiplier(insight: CanonicalInsight): number {
  const baseId = normalizeToBaseId(insight.id);
  const title = (insight.title || '').toLowerCase();

  // No-material-concentration: "no material concentration" = no-difference card
  if (baseId === 'repository-concentration' && title.includes('no material concentration')) {
    return 0.3;
  }

  // Generic runtime-distribution baseline: workflow-session-distribution
  // without an anomaly/difference signal. These describe the long-tail
  // shape but don't surface a decision-relevant difference.
  if (baseId === 'workflow-session-distribution') {
    // Keep if title indicates a material difference/anomaly; penalize generic
    if (!title.includes('differ') && !title.includes('anomal') && !title.includes('longer') && !title.includes('shorter')) {
      return 0.5;
    }
  }

  // claude-code-runtime-cohort generic "primarily short/long delegated runs"
  // — descriptive baseline, not a decision-relevant anomaly.
  if (baseId === 'claude-code-runtime-cohort') {
    // Penalize generic baseline; keep if it surfaces a material difference
    if (title.includes('primarily') || title.includes('mostly') || title.includes('tend to')) {
      return 0.5;
    }
  }

  // within-workflow-ai-signal-coverage generic baseline
  if (baseId === 'within-workflow-ai-signal-coverage') {
    return 0.5;
  }

  // pilot-maturity-progression generic status
  if (baseId === 'pilot-maturity-progression') {
    return 0.5;
  }

  return 1.0;
}

export function getTopInsights(insights: CanonicalInsight[]): CanonicalInsight[] {
  // CR-X 2026-08-30 — Classify lifecycle classes before filtering.
  // Ensures every insight has a lifecycleClass for ranking decisions.
  for (const ins of insights) {
    if (!ins.lifecycleClass) ins.lifecycleClass = classifyLifecycleClass(ins);
  }

  // Filter to eligible findings only — diagnostics, portfolio-suppressed,
  // suppress/monitor, and non-comparable states are excluded.
  // CR-X 2026-08-30: lifecycleClass is now the primary eligibility gate.
  const eligible = insights.filter(insight => {
    const comparisonState = insight.comparisonState;
    const cicdStage = insight.cicdStage;

    // CR-X: lifecycleClass gate — diagnostics and suppress never enter Top
    const lc = insight.lifecycleClass || classifyLifecycleClass(insight);
    if (lc === 'diagnostic' || lc === 'suppress') return false;

    // Exclude diagnostics and portfolio-suppressed candidates
    if (insight.isDiagnostic === true) return false;
    if (insight.portfolioSuppressed === true) return false;
    if (insight.hasData === false) return false;
    if (comparisonState === 'suppressed_duplicate' || comparisonState === 'consolidated') return false;

    // GitHub/delivery cards (review-merge, deploy-operate) are NEVER hidden
    if (cicdStage === 'review-merge' || cicdStage === 'deploy-operate') {
      if (comparisonState === 'needs_more_data' && insight.n === 0) return false;
      return true;
    }

    // For Plan & Code cards, exclude genuine lifecycle non-comparable states.
    // CR5 WS2 #14 P0-1: Eligibility is based on evidence/lifecycle, not
    // renderer metadata. presentationType=evidence_only is NOT an exclusion.
    // A valid temporal finding may have comparisonState === undefined.
    if (comparisonState === 'needs_more_data' ||
        comparisonState === 'instrumentation_gap' ||
        comparisonState === 'emerging_sample') {
      return false;
    }

    // Real evidence with visible lifecycle is eligible regardless of
    // presentationType or whether comparisonState is set.
    return true;
  });

  // De-duplicate deployment cards
  const hasChangeFailureRate = eligible.some(i => i.id === 'change-failure-rate-spike-by-ide');
  let candidates = eligible;
  if (hasChangeFailureRate) {
    candidates = candidates.filter(i =>
      i.id !== 'synthesized-deployment-cadence' && i.id !== 'delivery-velocity-by-workflow'
    );
  }

  // Remove narrow-gap rework unless fewer than 5 other actionable
  const reworkInsight = candidates.find(i => i.id === 'rework-rate-by-workflow');
  if (reworkInsight && reworkInsight.title.includes('similar across primary workflows')) {
    const otherActionable = candidates.filter(i => i.id !== 'rework-rate-by-workflow');
    if (otherActionable.length >= 5) candidates = otherActionable;
  }

  // CR-X P1A: Decision-quality ranking.
  //
  // The prior scoring used raw |deltaPct| / |delta| / |current| as the
  // primary materiality signal.  This caused unit-mismatch distortion: a
  // $1180 currency current value could outrank a 12-hour or 40pp decision
  // finding simply because 1180 > 12.
  //
  // P1A replaces raw magnitude with a bounded materiality transform and adds
  // a semantic-quality multiplier that rewards comparative/longitudinal/
  // delivery-bottleneck findings over standalone measurements.
  //
  // The double-penalty on monitor findings (urgencyPenalty 0.7 × lifecycleBoost
  // 0.7 = 0.49×) is removed.  Monitor findings are already classified
  // contextual by classifyLifecycleClass; the extra urgencyPenalty was
  // burying the most decision-relevant longitudinal/trend findings.
  //
  // Hardcoded semantic boosts for two specific IDs are removed — semantic
  // quality is now derived from presentationKind, not from hardcoded IDs.
  //
  // A tiny-denominator economics penalty prevents unit-economics cards with
  // n < 5 from dominating Top Insights merely because the currency number is
  // large.
  const scored = candidates.map(i => {
    const boundedMateriality = getBoundedMateriality(i);
    const semanticQuality = getSemanticQuality(i);
    const confidenceWeight = i.confidence === 'high' ? 1.0 : i.confidence === 'medium' ? 0.8 : 0.5;
    const executiveBoost = i.isExecutiveFinding ? 1.3 : 1.0;
    // CR-X P1A.1: Concentration findings use a gentler sampleWeight formula
    // (n/(n+20)) because n represents the COMPLETE POPULATION of events, not
    // a statistical sample.  4 failures all in production is a complete
    // census, not a small-sample weakness.
    const n = i.n || 0;
    const sampleWeight = n > 0
      ? (i.presentationKind === 'failure_concentration' ? n / (n + 20) : n / (n + 100))
      : 0;
    const economicsRobustness = getEconomicsRobustness(i);
    const lc = i.lifecycleClass || classifyLifecycleClass(i);
    const lifecycleBoost = lc === 'decision' ? 1.5 : lc === 'contextual' ? 0.7 : 1.0;
    // CR-X FINAL (binding edit 6): Tier disposition. TIER 3 descriptive
    // baseline / no-difference cards (no-material-concentration, generic
    // runtime-distribution, generic AI-signal-coverage) get a penalty
    // multiplier so they don't compete equally with material findings
    // for Top 5. They remain visible in All Insights.
    const tierMultiplier = getTierMultiplier(i);
    return {
      insight: i,
      score: boundedMateriality * semanticQuality * confidenceWeight * executiveBoost
        * sampleWeight * economicsRobustness * lifecycleBoost * tierMultiplier
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // CR-X P1A: Redundancy control — when two or more findings in the same
  // redundancy group are eligible, only the highest-scoring member competes
  // for Top Insights.  The others remain valid All Insights cards.
  const redundancyExcluded = new Set<string>();
  for (const group of REDUNDANCY_GROUPS) {
    const present = scored.filter(s => group.includes(normalizeToBaseId(s.insight.id)));
    if (present.length >= 2) {
      // Keep the highest-scoring member; exclude the rest from Top-5
      const keeper = present[0]; // scored is already sorted desc
      for (const s of present) {
        if (s.insight.id !== keeper.insight.id) {
          redundancyExcluded.add(s.insight.id);
        }
      }
    }
  }
  const scoredForSelection = scored.filter(s => !redundancyExcluded.has(s.insight.id));

  // CR-X P1B.2 Production-Value: Near-duplicate suppression for recent-change
  // findings on the same workflow. When multiple recent-change findings exist
  // for the same workflow (e.g., session_share + active_coding for vscode),
  // only the highest-scoring one competes for Top Insights. Different
  // workflows can still each contribute a temporal finding (subject to
  // the temporal family quota of 2).
  const recentChangeByWorkflow = new Map<string, typeof scoredForSelection[number]>();
  for (const s of scoredForSelection) {
    if (!s.insight.id.startsWith('recent-change__')) continue;
    const parts = s.insight.id.split('__');
    const workflow = parts[2] || 'org';
    if (!recentChangeByWorkflow.has(workflow) || s.score > recentChangeByWorkflow.get(workflow)!.score) {
      recentChangeByWorkflow.set(workflow, s);
    }
  }
  const recentChangeKeepers = new Set<string>();
  for (const s of recentChangeByWorkflow.values()) recentChangeKeepers.add(s.insight.id);
  const nearDupExcluded = new Set<string>();
  for (const s of scoredForSelection) {
    if (s.insight.id.startsWith('recent-change__') && !recentChangeKeepers.has(s.insight.id)) {
      nearDupExcluded.add(s.insight.id);
    }
  }
  const scoredForSelectionFinal = scoredForSelection.filter(s => !nearDupExcluded.has(s.insight.id));

  // CR-X Product-Strength Wave: When an executive synthesis finding exists
  // and is eligible for Top Insights, suppress sibling recent-change
  // session_share fragments from Top Insights competition. The synthesis
  // tells the story better than the individual fragments. Component
  // findings remain available in All Insights.
  const hasExecSynthesis = scoredForSelectionFinal.some(s =>
    s.insight.id === 'executive-workflow-mix-synthesis'
  );
  const synthesisSuppressed = new Set<string>();
  if (hasExecSynthesis) {
    for (const s of scoredForSelectionFinal) {
      if (s.insight.id.startsWith('recent-change__session_share__')) {
        synthesisSuppressed.add(s.insight.id);
      }
    }
  }
  const scoredForTopInsights = hasExecSynthesis
    ? scoredForSelectionFinal.filter(s => !synthesisSuppressed.has(s.insight.id))
    : scoredForSelectionFinal;

  // P3: Temporal sample / instrumentation quality gate
  // Suppress temporal allocation-shift findings with low_sample or
  // instrumentation_gap quality from Top Insights. These remain in All
  // Insights with cautious language but must not become executive conclusions.
  // Week-one pilot noise must not become executive conclusions.
  const temporalQualitySuppressed = new Set<string>();
  for (const s of scoredForTopInsights) {
    if (s.insight.id.startsWith('workflow-repo-allocation-shift__')) {
      const tq = (s.insight as any).temporalQuality;
      if (tq === 'low_sample' || tq === 'instrumentation_gap') {
        temporalQualitySuppressed.add(s.insight.id);
      }
    }
  }
  const scoredForTopInsightsFinal = temporalQualitySuppressed.size > 0
    ? scoredForTopInsights.filter(s => !temporalQualitySuppressed.has(s.insight.id))
    : scoredForTopInsights;

  // CR-X P0-1: Stage-balanced Top Insights selection.
  //
  // Combine lifecycle-stage representation with family/decision diversity
  // doctrine for the remaining free slots.
  //
  // HARD PRIORITY: STAGE GUARANTEE > FAMILY QUOTA.
  //   - Stage reservations are NEVER blocked by family quota.
  //   - Each reserved rep increments familyCounts (consumes quota).
  //   - Free slots respect FAMILY_QUOTAS using those updated counts.
  //   - If stage reservations already meet/exceed a quota, that family
  //     gets no additional free-slot candidates.
  //
  // No REQUIRED_FAMILIES reservation pass (superseded by stage reservation).
  // No separate downstream_delivery reservation (superseded by stage
  //   reservation for R&M and D&O).
  // No longitudinal materiality-floor exclusion (superseded by removal of
  //   REQUIRED_FAMILIES — longitudinal now competes normally by score;
  //   FAMILY_QUOTAS.longitudinal prevents concentration in free slots).
  const MAX_TOP = 5;
  const STAGES: CanonicalStage[] = ['plan-code', 'review-merge', 'deploy-operate'];

  const selected: CanonicalInsight[] = [];
  const selectedIds = new Set<string>();
  const familyCounts: Record<string, number> = {};
  // CR-X FINAL: Track executive-domain counts for MAX_PER_DOMAIN cap.
  const domainCounts: Record<string, number> = {};

  // STEP A+B: Reserve one highest-ranked eligible finding per stage.
  // Stage reservation has HARD PRIORITY over family quota — it is never
  // blocked by quota.  But each reserved rep DOES increment familyCounts
  // so free slots respect the resulting counts.
  //
  // CR-X P1A: Stage guarantee floor — a stage slot is only reserved if the
  // best finding for that stage has a score ≥ 5% of the maximum score among
  // all eligible candidates.  This prevents forcing a weak card into Top 5
  // merely because a stage exists (e.g. tiny-denominator economics with n=2
  // as the only deploy-operate finding).  If no finding meets the floor,
  // the slot is filled by the best available finding from any stage.
  const maxScore = scoredForTopInsightsFinal.length > 0 ? scoredForTopInsightsFinal[0].score : 0;
  // CR-X FINAL: Lower floor to 2% for high-SQ decision findings so material
  // cross-repo behavior / workflow-behavior findings with smaller samples
  // can compete against high-n allocation findings. 5% was too aggressive
  // when the max-score finding has 60x sample weight.
  const stageGuaranteeFloor = maxScore * 0.05;
  const stageGuaranteeFloorHighSQ = maxScore * 0.02;
  for (const stage of STAGES) {
    if (selected.length >= MAX_TOP) break;
    const best = scoredForTopInsightsFinal.find(s =>
      !selectedIds.has(s.insight.id) && s.insight.cicdStage === stage
    );
    // Only reserve if the best finding meets the stage guarantee floor
    if (best && best.score >= stageGuaranteeFloor) {
      selected.push(best.insight);
      selectedIds.add(best.insight.id);
      const fam = best.insight.semanticFamily || resolveFamilyForDiversity(best.insight.id);
      familyCounts[fam] = (familyCounts[fam] || 0) + 1;
      const dom = resolveExecutiveDomain(best.insight.id);
      domainCounts[dom] = (domainCounts[dom] || 0) + 1;
    }
  }

  // STEP C: Fill remaining slots by global ranking, respecting FAMILY_QUOTAS
  // and decision-first ordering.  Contextual findings fill only after
  // decision candidates are exhausted.
  //
  // CR-X P1A: A minimum score threshold (5% of max score) applies to all
  // fill candidates.  This prevents weak findings from consuming Top-5
  // slots merely because stronger findings in the same pool have been
  // selected or quota-blocked.
  function fillFromPool(pool: typeof scoredForTopInsightsFinal, enforceDomainCapInPass3 = false) {
    // CR-X FINAL: Three-pass fill to maximize executive-story diversity.
    // Pass 1: Skip candidates that are adjacent to an already-selected
    //         finding OR that would exceed MAX_PER_DOMAIN. This gives
    //         different stories maximum priority.
    // Pass 2: Allow adjacent but still skip domain-saturated candidates.
    // Pass 3: If slots remain, sort by domain count (ascending) then
    //         score (descending). If enforceDomainCapInPass3, still
    //         skip domain-saturated candidates (leave for next pool).
    //         Otherwise fill remaining slots (no slot left empty).
    const selectedFamilies = selected.map(s => resolveFamilyForDiversity(s.id));

    for (const pass of [1, 2, 3]) {
      const passPool = pass === 3
        ? [...pool].sort((a, b) => {
            const domA = resolveExecutiveDomain(a.insight.id);
            const domB = resolveExecutiveDomain(b.insight.id);
            const dA = domainCounts[domA] || 0;
            const dB = domainCounts[domB] || 0;
            if (dA !== dB) return dA - dB;
            return b.score - a.score;
          })
        : pool;
      for (const s of passPool) {
        if (selected.length >= MAX_TOP) break;
        if (selectedIds.has(s.insight.id)) continue;
        const sq = getSemanticQuality(s.insight);
        const lc = s.insight.lifecycleClass || classifyLifecycleClass(s.insight);
        const floor = (lc === 'decision' && sq >= 0.80) ? stageGuaranteeFloorHighSQ : stageGuaranteeFloor;
        if (s.score < floor) continue;
        const family = s.insight.semanticFamily || resolveFamilyForDiversity(s.insight.id);
        const quota = FAMILY_QUOTAS[family] ?? 2;
        if ((familyCounts[family] || 0) >= quota) continue;
        if (pass === 1) {
          const adjacency = getAdjacencyConflict(family, selectedFamilies);
          if (adjacency) continue;
          const domain = resolveExecutiveDomain(s.insight.id);
          if ((domainCounts[domain] || 0) >= MAX_PER_DOMAIN) continue;
        }
        if (pass === 2) {
          const domain = resolveExecutiveDomain(s.insight.id);
          if ((domainCounts[domain] || 0) >= MAX_PER_DOMAIN) continue;
        }
        if (pass === 3 && enforceDomainCapInPass3) {
          const domain = resolveExecutiveDomain(s.insight.id);
          if ((domainCounts[domain] || 0) >= MAX_PER_DOMAIN) continue;
        }
        selected.push(s.insight);
        selectedIds.add(s.insight.id);
        familyCounts[family] = (familyCounts[family] || 0) + 1;
        selectedFamilies.push(family);
        const dom = resolveExecutiveDomain(s.insight.id);
        domainCounts[dom] = (domainCounts[dom] || 0) + 1;
      }
      if (selected.length >= MAX_TOP) break;
    }
  }

  // CR-X P1A.1: Semantic quality gate for the decision pass.
  //
  // A "decision" lifecycle classification means the finding is actionable,
  // but it does NOT mean it has comparative value for Top Insights.  A
  // generic standalone metric (outcome_threshold, org_summary) classified
  // as decision should NOT get decision-pass priority over higher-scoring
  // comparative/trend/concentration findings.
  //
  // Findings with SQ >= 0.50 compete in the decision pass (comparative,
  // trend, concentration, cohort, unit-economics findings).
  // Findings with SQ < 0.50 compete in the contextual pass (generic
  // standalone metrics).  They can still win when no stronger evidence
  // exists — the contextual pass fills remaining slots.
  const DECISION_SQ_GATE = 0.50;

  // Pass 1: decision findings with sufficient semantic quality
  const decisionPool = scoredForTopInsightsFinal.filter(s => {
    const lc = s.insight.lifecycleClass || classifyLifecycleClass(s.insight);
    if (lc !== 'decision') return false;
    return getSemanticQuality(s.insight) >= DECISION_SQ_GATE;
  });
  // CR-X FINAL: Enforce domain cap in decision pool pass 3 so a 3rd
  // repo_allocation card doesn't fill a slot before the contextual
  // pool gets a chance to offer a different-domain candidate.
  fillFromPool(decisionPool, true);

  // Pass 2: contextual findings + low-SQ decision findings
  if (selected.length < MAX_TOP) {
    const contextualPool = scoredForTopInsightsFinal.filter(s => {
      const lc = s.insight.lifecycleClass || classifyLifecycleClass(s.insight);
      if (lc === 'decision') return getSemanticQuality(s.insight) < DECISION_SQ_GATE;
      return lc === 'contextual';
    });
    fillFromPool(contextualPool, true);
  }

  // CR-X FINAL: Pass 3 — final fill with NO domain cap. If slots remain
  // after both pools enforced domain caps, fill with anything (sorted by
  // domain count ascending so underrepresented domains still get priority).
  if (selected.length < MAX_TOP) {
    fillFromPool(scoredForTopInsightsFinal, false);
  }

  // STEP D: Return in original global rank order.
  const rankMap = new Map<string, number>();
  scored.forEach((s, idx) => rankMap.set(s.insight.id, idx));
  selected.sort((a, b) => (rankMap.get(a.id) ?? 999) - (rankMap.get(b.id) ?? 999));

  return selected;
}

/**
 * Compute a materiality score for ranking.
 * Uses |deltaPct| as primary, |delta| as fallback, |current| as last resort.
 */
function getMaterialityScore(insight: CanonicalInsight): number {
  if (typeof insight.deltaPct === 'number' && Math.abs(insight.deltaPct) > 0) {
    return Math.abs(insight.deltaPct);
  }
  if (typeof insight.delta === 'number' && Math.abs(insight.delta) > 0) {
    return Math.abs(insight.delta);
  }
  if (typeof insight.current === 'number') {
    return Math.abs(insight.current);
  }
  return 0;
}

/**
 * CR-X P1A: Bounded materiality — maps raw effect size to [0, 1) using a
 * saturating transform.  This prevents unit-mismatch distortion where a
 * $1180 currency value outranks a 12-hour or 40pp decision finding simply
 * because 1180 > 12.
 *
 * Raw effect size is CAPPED at 100 before the transform.  This prevents
 * extreme relative deltas (e.g. deltaPct=3200 from a 2pp→66pp shift) from
 * dominating merely because the baseline was tiny.  A 100% relative
 * change is already a doubling; beyond that, decision relevance does not
 * scale linearly with the number.
 *
 * Transform: min(raw, 100) / (min(raw, 100) + K) where K = 30.
 *   30pp delta  → 0.50
 *   60pp delta  → 0.67
 *   100pp delta → 0.77 (cap)
 *   $1180       → 0.77 (capped, cannot dominate)
 *   12 hours    → 0.29
 */
function getBoundedMateriality(insight: CanonicalInsight): number {
  const raw = getMaterialityScore(insight);
  if (raw <= 0) return 0;
  const capped = Math.min(raw, 100);
  const K = 30;
  return capped / (capped + K);
}

/**
 * CR-X P1A: Semantic quality multiplier — rewards comparative, longitudinal,
 * and delivery-bottleneck findings over standalone measurements.
 *
 * This is a general, pilot-shape-agnostic quality signal derived from
 * presentationKind and comparisonState, not from hardcoded PI IDs.
 */
function getSemanticQuality(insight: CanonicalInsight): number {
  const pk = insight.presentationKind;
  const cs = insight.comparisonState;

  // Base quality from presentationKind
  let quality = 0.50;
  switch (pk) {
    case 'workflow_comparison':     quality = 0.90; break; // cross-workflow contrast
    case 'temporal_trend':           quality = 0.85; break; // longitudinal change
    case 'downstream_comparison':    quality = 0.85; break; // delivery bottleneck
    case 'failure_concentration':     quality = 0.80; break; // risk concentration
    case 'cohort_comparison':         quality = 0.75; break; // AI vs non-AI / cohort
    case 'unit_economics':            quality = 0.55; break; // cost per outcome
    case 'success_failure_distribution': quality = 0.55; break; // distribution
    case 'outcome_threshold':         quality = 0.30; break; // standalone threshold (generic)
    case 'org_summary':               quality = 0.40; break; // standalone measurement
    case 'distribution_shape':        quality = 0.35; break; // shape description
    case 'executive_synthesis':       quality = 0.95; break; // synthesized executive conclusion
    case 'repo_conditioned_behavior': quality = 0.85; break; // cross-repo behavior contrast
    case 'workflow_repo_allocation':  quality = 0.80; break; // allocation pattern
    case 'within_workflow_temporal':  quality = 0.85; break; // within-workflow temporal change
    case 'workflow_repo_allocation_shift': quality = 0.80; break; // allocation shift over time
    default:                          quality = 0.50; break;
  }

  // Boost for comparison state (cross-workflow comparison available)
  if (cs === 'workflow_comparable') quality += 0.10;
  else if (cs === 'ai_non_ai_comparable') quality += 0.05;
  else if (cs === 'org_level_only') quality -= 0.05;

  return Math.max(0.10, Math.min(1.0, quality));
}

/**
 * CR-X P1A: Economics robustness penalty — unit-economics findings with
 * tiny outcome denominators must not dominate Top Insights merely because
 * the currency number is large.
 *
 * n < 5:   strong penalty (0.3)  — e.g. $1180/failed-deployment with n=2
 * n < 10:  moderate penalty (0.6)
 * n >= 10: no penalty (1.0)
 *
 * Non-unit-economics findings are unaffected (return 1.0).
 */
function getEconomicsRobustness(insight: CanonicalInsight): number {
  if (insight.presentationKind !== 'unit_economics') return 1.0;
  const n = insight.n || 0;
  if (n < 5) return 0.3;
  if (n < 10) return 0.6;
  return 1.0;
}

/**
 * CR-X P1A: Redundancy groups — when two or more findings in the same group
 * are eligible for Top Insights, only the highest-scoring member competes.
 * The others remain valid All Insights cards.
 *
 * Each group contains canonical base IDs (pre-instance-suffix).
 */
const REDUNDANCY_GROUPS: string[][] = [
  // Repository concentration vs per-workflow distribution
  ['repository-concentration', 'repository-distribution-by-workflow'],
  // CR-X FINAL (binding edit 2): REMOVED redundancy group
  // ['repository-distribution-by-workflow', 'repo-conditioned-behavior'].
  // These are DIFFERENT executive stories: distribution = WHERE sessions
  // concentrate (repo_allocation), conditioned behavior = HOW a workflow
  // behaves differently across repos (workflow_behavior_mode). Both can
  // appear in Top 5 (subject to domain caps).
  // Deployment reliability — success rate, failure rate, and failure
  // concentration are competing representations of the same delivery
  // evidence.  Only the highest-scoring representation competes for Top 5.
  ['change-failure-rate-spike-by-ide', 'deployment-success-distribution', 'deployment-failure-concentration'],
  // Configured spend per delivery outcome — one insight, four cards
  [
    'allocated-spend-per-deployment',
    'allocated-spend-per-successful-deployment',
    'allocated-spend-per-failed-deployment',
    'allocated-spend-per-release',
  ],
];

/**
 * CR5 WS2 #13 P0-2: Normalize runtime instance ID to canonical base ID,
 * THEN pass through the family map.
 *
 * Example:
 *   within-workflow-ai-effect__cursor → within-workflow-ai-effect → within_workflow_ai
 *   ai-intensity-cohort-analysis__cursor → ai-intensity-cohort-analysis → within_workflow_ai
 *
 * Both resolve to the same decision family so they cannot both occupy
 * the single within-workflow Top slot.
 */
function normalizeToBaseId(id: string): string {
  const idx = id.indexOf('__');
  return idx >= 0 ? id.substring(0, idx) : id;
}

/**
 * Resolve a family ID for diversity enforcement.
 * First normalizes runtime instance IDs to canonical base IDs,
 * then maps through the family map.
 */
export function resolveFamilyForDiversity(id: string): string {
  const baseId = normalizeToBaseId(id);

  const familyMap: Record<string, string> = {
    'active-coding-time-by-ide': 'cross_tool_behavior',
    'focus-ratio-by-ide': 'cross_tool_behavior',
    'files-edited-by-ide': 'cross_tool_behavior',
    'session-profile-by-ide': 'cross_tool_behavior',
    'ai-adoption-rate-by-ide': 'cross_tool_behavior',
    'time-to-first-commit-by-ide': 'cross_tool_commit',
    'delivery-rate-ai-vs-non-ai': 'cross_tool_commit',
    'executive-ai-yield-optimization': 'cross_tool_commit',
    'session-conditioned-pr-cycle-time-ai-vs-non-ai': 'cross_tool_commit',
    'within-workflow-ai-effect': 'within_workflow_ai',
    'ai-intensity-cohort-analysis': 'within_workflow_ai',
    'workflow-session-distribution': 'within_workflow_ai',
    'review-burden-by-ai-pattern': 'within_workflow_ai',
    'ai-adoption-velocity': 'longitudinal',
    'monthly-workflow-share': 'longitudinal',
    'commit-ttfc-longitudinal': 'longitudinal',
    'configured-cost-efficiency-by-workflow': 'cost',
    // CR-X Pass 2: Efficiency frontier PIs — wired into cost / unit_economics families
    'developer-workflow-cost-efficiency-frontier': 'cost',
    'workflow-cost-delivery-comparison': 'cost',
    'workflow-delivery-efficiency': 'unit_economics',
    'repository-concentration': 'concentration',
    // CR-X FINAL (binding edit 2): repository-distribution-by-workflow
    // is a repo-allocation story (how work is spread across repos by
    // workflow), distinct from repo-conditioned-behavior (how a
    // workflow behaves differently across repos).
    'repository-distribution-by-workflow': 'concentration',
    'debug-time-by-ide': 'operational',
    'terminal-time-by-ide': 'operational',
    // CR5 FINAL DOWNSTREAM — R&M and D&O lifecycle PIs
    'executive-small-pr-workflow-optimization': 'downstream_delivery',
    'change-failure-rate-spike-by-ide': 'downstream_delivery',
    // Unit Economics V1 — allocated configured spend per outcome
    'allocated-spend-per-merged-pr': 'unit_economics',
    'allocated-spend-per-deployment': 'unit_economics',
    'allocated-spend-per-successful-deployment': 'unit_economics',
    // CR-X P1B.2 Wave 1: recent-change temporal findings
    'recent-change': 'temporal',
    // CR-X Wave 1B: multi-dimensional families
    // CR-X FINAL (binding edit 2): repo-conditioned-behavior is a
    // workflow-behavior/work-context story (e.g. "Claude runs 5h31m in
    // repo A vs 20m in repo B"), NOT a repo-allocation story. It must
    // not be collapsed into the repo_allocation adjacency group.
    'repo-conditioned-behavior': 'workflow_behavior_mode',
    'workflow-repo-allocation': 'workflow_allocation',
    'within-workflow-temporal-behavior': 'within_workflow_temporal',
    'workflow-repo-allocation-shift': 'workflow_allocation_shift',
    // CR-X Product-Strength Wave: executive synthesis
    'executive-workflow-mix-synthesis': 'executive_synthesis',
    'claude-code-runtime-cohort': 'workflow_behavior_mode',
    // CR-X FINAL: within-workflow profile PIs share the within_workflow
    // diversity family so distinct per-workflow instances don't crowd Top 5.
    'within-workflow-ai-signal-coverage': 'within_workflow',
    'within-workflow-session-duration-profile': 'within_workflow',
    'within-workflow-commits-profile': 'within_workflow',
    'within-workflow-ttfc-profile': 'within_workflow',
    // CR-X FINAL: remaining within-workflow behavior PIs
    'rework-rate-by-workflow': 'within_workflow',
    'active-coding-ratio-by-workflow': 'within_workflow',
    'rework-loop-detection': 'within_workflow',
    'context-switching-impact': 'within_workflow',
    'early-signal-developer-activity': 'within_workflow',
    'observed-session-overlap': 'within_workflow',
    // Pilot maturity progression is a contextual status card, grouped with
    // diagnostic for diversity so it does not crowd actionable findings.
    'pilot-maturity-progression': 'diagnostic',
  };

  return familyMap[baseId] || baseId;
}

// CR-X P0-1: Family quotas for FREE-SLOT selection.
// Stage reservations have HARD PRIORITY over quota and are never blocked,
// but reserved reps DO increment familyCounts.  Free slots respect these
// quotas using those updated counts to prevent family concentration.
// If stage reservations already meet/exceed a quota, that family gets no
// additional free-slot candidates.
// CR-X FINAL: Semantic adjacency groups for Top-5 diversity.
// Findings in the same adjacency group are closely related stories
// (e.g., repo/allocation). When two findings in the same group would
// both appear in Top 5, the second is deferred in favor of a materially
// different qualified candidate. If no different candidate is available,
// the adjacent finding is still selected (no slot is left empty).
//
// This is NOT a category quota — it does not force one card per category.
// It only avoids two closely adjacent stories when a different story exists.
const SEMANTIC_ADJACENCY_GROUPS: Record<string, string[]> = {
  // CR-X FINAL (binding edit 2): repo/allocation stories — how work is
  // distributed across repos/workflows. repo-conditioned-behavior is
  // NOT here (it is a workflow-behavior/work-context story).
  'repo_allocation': [
    'workflow_allocation',
    'workflow_allocation_shift',
    'concentration',
  ],
};

// Build a reverse lookup: family → adjacency group
const FAMILY_TO_ADJACENCY_GROUP: Record<string, string> = {};
for (const [group, families] of Object.entries(SEMANTIC_ADJACENCY_GROUPS)) {
  for (const fam of families) {
    FAMILY_TO_ADJACENCY_GROUP[fam] = group;
  }
}

/**
 * Check if a candidate is semantically adjacent to any already-selected
 * finding. Returns the adjacency group name if adjacent, null otherwise.
 */
function getAdjacencyConflict(
  candidateFamily: string,
  selectedFamilies: string[]
): string | null {
  const candidateGroup = FAMILY_TO_ADJACENCY_GROUP[candidateFamily];
  if (!candidateGroup) return null;
  for (const selFam of selectedFamilies) {
    if (FAMILY_TO_ADJACENCY_GROUP[selFam] === candidateGroup) {
      return candidateGroup;
    }
  }
  return null;
}

// CR-X FINAL (binding edit 2): Executive-story domains for Top-5
// diversity. These are coarser than semantic families and enforce
// that no single executive-story domain dominates Top 5 when
// material candidates from other domains exist.
//
// Domains:
//   adoption_workflow_mix — workflow adoption, mix shifts, synthesis
//   workflow_behavior_mode — within/across-workflow behavior, mode, runtime
//   repo_allocation — repository concentration, distribution, allocation
//   temporal_change — recent-change findings
//   economics — configured cost, unit economics
//   review_merge — review-merge stage findings
//   deploy_reliability — deploy-operate stage findings
//   developer_cohort — developer/cohort findings (only when authoritative)
//   evidence_gap — diagnostic
const FAMILY_TO_EXECUTIVE_DOMAIN: Record<string, string> = {
  'cross_tool_behavior': 'adoption_workflow_mix',
  'cross_tool_commit': 'adoption_workflow_mix',
  'executive_synthesis': 'adoption_workflow_mix',
  'longitudinal': 'adoption_workflow_mix',
  'within_workflow': 'workflow_behavior_mode',
  'within_workflow_ai': 'workflow_behavior_mode',
  'workflow_behavior_mode': 'workflow_behavior_mode',
  'within_workflow_temporal': 'workflow_behavior_mode',
  'operational': 'workflow_behavior_mode',
  'concentration': 'repo_allocation',
  'workflow_allocation': 'repo_allocation',
  'workflow_allocation_shift': 'repo_allocation',
  'temporal': 'temporal_change',
  'cost': 'economics',
  'unit_economics': 'economics',
  'downstream_delivery': 'review_merge',
  'concurrency': 'workflow_behavior_mode',
};

/**
 * Resolve the executive-story domain for a finding ID.
 * Falls back to the semantic family if no domain mapping exists.
 */
function resolveExecutiveDomain(id: string): string {
  const family = resolveFamilyForDiversity(id);
  return FAMILY_TO_EXECUTIVE_DOMAIN[family] || family;
}

// CR-X FINAL: Max cards per executive-story domain in Top 5.
// When material candidates from other domains exist, no more than
// MAX_PER_DOMAIN cards from one domain. Pass 2 (no empty slots) still
// fills same-domain if no different candidate remains.
const MAX_PER_DOMAIN = 2;

const FAMILY_QUOTAS: Record<string, number> = {
  'cross_tool_behavior': 2,
  'cross_tool_commit': 1,
  'within_workflow_ai': 2,
  'longitudinal': 1,
  'concentration': 1,
  'concurrency': 1,
  'cost': 1,
  'operational': 1,
  'downstream_delivery': 1,
  'unit_economics': 1,
  // CR-X P1B.2 Wave 1: temporal findings — max 2 in Top Insights
  'temporal': 2,
  // CR-X Wave 1B: multi-dimensional families — max 1 each in Top Insights
  'workflow_behavior_mode': 1,
  'workflow_allocation': 1,
  'within_workflow_temporal': 1,
  'workflow_allocation_shift': 1,
  // CR-X Product-Strength Wave: executive synthesis — max 1, high priority
  'executive_synthesis': 1,
  // CR-X FINAL: within-workflow profile PIs share a common family cap
  'within_workflow': 2,
  // Pilot maturity progression is a contextual status card; cap at 1
  'diagnostic': 1,
};
