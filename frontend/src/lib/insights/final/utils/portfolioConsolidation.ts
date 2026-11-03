/**
 * CR5 WS2 — Portfolio Consolidation Pass
 *
 * Makes Performance Insights operate as an engineering-leader recommendation
 * engine, not a catalog of whatever generators happen to fire.
 *
 * CR5 WS2 P0-1 CORRECTION: Three distinct lifecycle states:
 *   visible finding     = supported + selected for portfolio
 *   diagnostic/data gap = genuinely missing/ineligible evidence
 *   portfolio-suppressed = supported evidence omitted because a stronger/
 *                          redundant candidate was selected
 *
 * Portfolio-suppressed candidates are NOT diagnostics. They retain their
 * original hasData/confidence/comparisonState. They are marked with
 * `portfolioSuppressed: true` and excluded from finalAdaptedInsights
 * (customer-visible output) by the pipeline in index.ts.
 *
 * User-visible copy must NEVER contain:
 *   - "suppressed:"
 *   - "strongest instance"
 *   - raw IDs containing __cursor, __devin, etc.
 */

import type { CanonicalInsight, SemanticFamily } from '../types';
import { piDebugLog } from '../utils/logging';
import { resolveSemanticFamily } from './ranking';

/**
 * Resolve a family ID from an instance ID (e.g., "within-workflow-ai-effect__cursor" → "within-workflow-ai-effect")
 */
function resolveFamily(id: string): string {
  const idx = id.indexOf('__');
  return idx >= 0 ? id.substring(0, idx) : id;
}

/**
 * Get the absolute effect size of an insight for ranking within a family.
 * Uses |delta| as the primary measure, falling back to |deltaPct|, then |current|.
 */
function getEffectSize(insight: CanonicalInsight): number {
  if (typeof insight.delta === 'number' && Math.abs(insight.delta) > 0) {
    return Math.abs(insight.delta);
  }
  if (typeof insight.deltaPct === 'number' && Math.abs(insight.deltaPct) > 0) {
    return Math.abs(insight.deltaPct);
  }
  if (typeof insight.current === 'number') {
    return Math.abs(insight.current);
  }
  return 0;
}

/**
 * CR5 WS2 P0-4: Confidence/sample-aware materiality score for family consolidation.
 *
 * score = effectSize × confidenceWeight × sampleWeight
 *   confidenceWeight: high=1.0, medium=0.8, low=0.5
 *   sampleWeight: min(1, n/100) — full weight at 100+ sessions
 */
function getMaterialityScore(insight: CanonicalInsight): number {
  const effectSize = getEffectSize(insight);
  const confidenceWeight = insight.confidence === 'high' ? 1.0
    : insight.confidence === 'medium' ? 0.8 : 0.5;
  const sampleWeight = Math.min(1, (insight.n || 0) / 100);
  return effectSize * confidenceWeight * sampleWeight;
}

/**
 * CR5 WS2 P0-1: Mark an insight as portfolio-suppressed (NOT diagnostic).
 * Preserves original hasData, confidence, and comparisonState.
 * The title is NOT modified — user-visible copy must never contain
 * "suppressed", "strongest instance", or internal workflow IDs.
 */
function markAsPortfolioSuppressed(insight: CanonicalInsight, reason: string): CanonicalInsight {
  return {
    ...insight,
    portfolioSuppressed: true,
    portfolioSuppressedReason: reason,
    // Do NOT set isDiagnostic — this is not a data gap
    // Do NOT set hasData: false — the evidence is measured
    // Do NOT modify the title — internal reason is for debug only
  };
}

/**
 * Duplicate PI pairs — two candidates that answer materially the SAME
 * engineering-leader decision question, where one is redundant after
 * considering materiality, confidence, sample size, and actionability.
 */
const DUPLICATE_PAIRS: Array<{ suppress: string; retain: string; reason: string }> = [
  {
    suppress: 'executive-ai-yield-optimization',
    retain: 'delivery-rate-ai-vs-non-ai',
    reason: 'both compare AI vs non-AI commits/session — delivery-rate is more specific and actionable',
  },
  {
    // Registry dedupeGroup: 'deployment-cadence' — both cards report the same
    // GitHub deployment-volume population (same N, same baseline). Retain the
    // canonicalPriority-1 card.
    suppress: 'synthesized-deployment-cadence',
    retain: 'delivery-velocity-by-workflow',
    reason: 'dedupeGroup deployment-cadence — same deployment volume population; delivery-velocity is canonicalPriority 1',
  },
];

/**
 * Per-workflow families that should consolidate to the strongest instance.
 */
const CONSOLIDATE_FAMILIES = [
  'within-workflow-ai-effect',
  'ai-intensity-cohort-analysis',
];

/**
 * Apply portfolio consolidation to a set of canonical insights.
 *
 * Returns an object with:
 *   - visible: insights that should proceed to finalAdaptedInsights
 *   - suppressed: portfolio-suppressed insights (for debug/audit only)
 */
export function applyPortfolioConsolidation(insights: CanonicalInsight[]): {
  visible: CanonicalInsight[];
  suppressed: CanonicalInsight[];
} {
  piDebugLog('[WS2_CONSOLIDATION][START]', {
    inputCount: insights.length,
    inputIds: insights.map(i => i.id),
  });

  const insightMap = new Map<string, CanonicalInsight>();
  for (const insight of insights) {
    insightMap.set(insight.id, insight);
  }

  const suppressedIds = new Set<string>();

  // 1. Suppress duplicate pairs
  for (const pair of DUPLICATE_PAIRS) {
    const toSuppress = insightMap.get(pair.suppress);
    const retain = insightMap.get(pair.retain);

    if (toSuppress && retain) {
      // Only suppress if the retained insight has data
      if (retain.hasData !== false && !retain.isDiagnostic) {
        insightMap.set(pair.suppress, markAsPortfolioSuppressed(toSuppress, pair.reason));
        suppressedIds.add(pair.suppress);
        piDebugLog('[WS2_CONSOLIDATION][SUPPRESS_DUPLICATE]', {
          suppress: pair.suppress,
          retain: pair.retain,
          reason: pair.reason,
        });
      }
    }
  }

  // 2. Consolidate per-workflow families
  for (const family of CONSOLIDATE_FAMILIES) {
    const familyInstances = Array.from(insightMap.values()).filter(
      i => resolveFamily(i.id) === family && !i.isDiagnostic && i.hasData !== false && !i.portfolioSuppressed
    );

    if (familyInstances.length <= 1) continue;

    // Sort by confidence/sample-aware materiality score
    familyInstances.sort((a, b) => getMaterialityScore(b) - getMaterialityScore(a));

    const retained = familyInstances[0];
    piDebugLog('[WS2_CONSOLIDATION][FAMILY_RETAIN]', {
      family,
      retainedId: retained.id,
      materialityScore: getMaterialityScore(retained),
      effectSize: getEffectSize(retained),
      confidence: retained.confidence,
      n: retained.n,
      totalInstances: familyInstances.length,
    });

    // Suppress all other instances as portfolio-suppressed
    for (let i = 1; i < familyInstances.length; i++) {
      const instance = familyInstances[i];
      const reason = `consolidated into ${retained.id} (stronger materiality score)`;
      insightMap.set(instance.id, markAsPortfolioSuppressed(instance, reason));
      suppressedIds.add(instance.id);
      piDebugLog('[WS2_CONSOLIDATION][FAMILY_SUPPRESS]', {
        family,
        suppressedId: instance.id,
        retainedId: retained.id,
        materialityScore: getMaterialityScore(instance),
        effectSize: getEffectSize(instance),
        confidence: instance.confidence,
        n: instance.n,
      });
    }
  }

  // 3. CR5 WS2 P0-2: Portfolio competition — session-profile vs standalone active-coding/focus
  // The composite session-profile-by-ide should compete against active-coding-time-by-ide
  // and focus-ratio-by-ide for portfolio space. If the composite provides a materially
  // stronger combined story, retain it and suppress the standalones. If not, suppress
  // the composite. Based on evidence/materiality, not Local-specific IDs.
  const sessionProfile = insightMap.get('session-profile-by-ide');
  const activeCoding = insightMap.get('active-coding-time-by-ide');
  const focusRatio = insightMap.get('focus-ratio-by-ide');

  if (sessionProfile && !sessionProfile.isDiagnostic && !sessionProfile.portfolioSuppressed &&
      sessionProfile.hasData !== false) {

    const compositeScore = getMaterialityScore(sessionProfile);

    // Compare against the best standalone
    const standaloneCandidates = [activeCoding, focusRatio].filter(
      i => i && !i.isDiagnostic && !i.portfolioSuppressed && i.hasData !== false
    ) as CanonicalInsight[];

    if (standaloneCandidates.length > 0) {
      const bestStandaloneScore = Math.max(...standaloneCandidates.map(getMaterialityScore));

      // If the composite is materially stronger (1.2x or more), retain composite
      // and suppress the standalones as supporting evidence.
      // If the composite is NOT materially stronger, suppress the composite.
      if (compositeScore >= bestStandaloneScore * 1.2) {
        // Composite wins — suppress standalones
        for (const standalone of standaloneCandidates) {
          const reason = `session-profile-by-ide provides a materially stronger combined story`;
          insightMap.set(standalone.id, markAsPortfolioSuppressed(standalone, reason));
          suppressedIds.add(standalone.id);
          piDebugLog('[WS2_CONSOLIDATION][COMPOSITE_WINS]', {
            composite: 'session-profile-by-ide',
            compositeScore,
            suppressed: standalone.id,
            standaloneScore: getMaterialityScore(standalone),
          });
        }
      } else {
        // Standalones win — suppress composite
        const reason = `standalone active-coding/focus candidates provide stronger individual signals`;
        insightMap.set('session-profile-by-ide', markAsPortfolioSuppressed(sessionProfile, reason));
        suppressedIds.add('session-profile-by-ide');
        piDebugLog('[WS2_CONSOLIDATION][STANDALONES_WIN]', {
          composite: 'session-profile-by-ide',
          compositeScore,
          bestStandaloneScore,
        });
      }
    }
  }

  // CR-X P0-2: Skew-aware consolidation — when workflow-session-distribution
  // fires for a workflow, suppress session-profile-by-ide if it describes the
  // same duration phenomenon with a mean-only headline. The distribution-shape
  // PI captures skew and tail risk; the mean-only comparison is redundant.
  // Reuses sessionProfile from the composite competition block above.
  const distInsights = Array.from(insightMap.values()).filter(
    i => resolveFamily(i.id) === 'workflow-session-distribution' && !i.isDiagnostic && i.hasData !== false && !i.portfolioSuppressed
  );

  if (distInsights.length > 0 && sessionProfile && !sessionProfile.isDiagnostic && !sessionProfile.portfolioSuppressed && sessionProfile.hasData !== false) {
    // Suppress the mean-only session profile when distribution-shape PIs exist
    const reason = `workflow-session-distribution provides skew-aware duration shape; mean-only session-profile-by-ide is redundant`;
    insightMap.set('session-profile-by-ide', markAsPortfolioSuppressed(sessionProfile, reason));
    suppressedIds.add('session-profile-by-ide');
    piDebugLog('[WS2_CONSOLIDATION][SKEW_AWARE_SUPPRESS]', {
      suppressed: 'session-profile-by-ide',
      distributionCount: distInsights.length,
      distributionIds: distInsights.map(i => i.id),
    });
  }

  // CR-X 2026-08-30 — Cross-family synthesis: Claude bimodal/autonomous-runtime.
  // When ai-intensity-cohort-analysis fires for a workflow (it shows the
  // bimodal pattern: short zero-signal sessions vs long AI-active sessions),
  // suppress workflow-session-distribution for the SAME workflow because it
  // describes the same duration phenomenon with less context (no AI-signal
  // correlation). The intensity cohort is the stronger synthesized finding.
  // This is generic: applies to any agentic workflow where both fire.
  const cohortInsights = Array.from(insightMap.values()).filter(
    i => resolveFamily(i.id) === 'ai-intensity-cohort-analysis' && !i.isDiagnostic && i.hasData !== false && !i.portfolioSuppressed
  );
  for (const cohort of cohortInsights) {
    // Extract workflow suffix from cohort instance ID (e.g. "ai-intensity-cohort-analysis__claude_code")
    const wfSuffix = cohort.id.includes('__') ? cohort.id.split('__').slice(1).join('__') : null;
    if (!wfSuffix) continue;
    const distId = `workflow-session-distribution__${wfSuffix}`;
    const distInstance = insightMap.get(distId);
    if (distInstance && !distInstance.isDiagnostic && !distInstance.portfolioSuppressed && distInstance.hasData !== false) {
      const reason = `ai-intensity-cohort-analysis__${wfSuffix} provides the bimodal/autonomous-runtime synthesis (AI-signal × duration cohorts); session-distribution describes the same duration tail with less context`;
      insightMap.set(distId, markAsPortfolioSuppressed(distInstance, reason));
      suppressedIds.add(distId);
      piDebugLog('[WS2_CONSOLIDATION][BIMODAL_SYNTHESIS]', {
        suppressed: distId,
        retained: cohort.id,
        reason,
      });
    }
  }

  // CR-X FINAL: Semantic-family-aware dominance suppression.
  //
  // CR-X FINAL: Explicit story-key suppression.
  // When a synthesis finding and its component mirror cards share the same
  // storyKey, the synthesis wins and the component cards are suppressed from
  // rendered findings. This is NOT fuzzy heuristics — generators explicitly
  // emit storyKey only for genuine parent/child stories.
  const storyKeySuppressed = applyStoryKeySuppression(insightMap, suppressedIds);
  for (const id of storyKeySuppressed) {
    suppressedIds.add(id);
  }

  // CR-X FINAL: Semantic family dominance (conservative).
  // When multiple findings from the SAME semantic family describe the same
  // executive story (same workflow subject, same time window), only the
  // strongest materiality-scored finding should remain visible. Dominated
  // findings are portfolio-suppressed (not diagnostic) and retained for audit.
  //
  // This prevents repetitive findings from crowding out more decision-useful
  // findings from other families. Family quotas in getTopInsights provide a
  // second layer of diversity enforcement for Top-5 selection.
  //
  // Dominance is conservative: only suppress when the subject (workflow or
  // org) matches AND the dominated finding has materially lower score.
  // Different subjects in the same family are NOT suppressed (e.g., two
  // different workflows each having a within-workflow finding is fine).
  const dominanceSuppressed = applySemanticFamilyDominance(insightMap, suppressedIds);
  for (const id of dominanceSuppressed) {
    suppressedIds.add(id);
  }

  // CR-X P1 STORY-LEVEL CONSOLIDATION:
  // Deployment reliability overlap — when change-failure-rate-spike-by-ide and
  // deployment-success-distribution both describe the same deployment success
  // rate for the same population, suppress the weaker one. They answer the
  // same executive question.
  const cfrSpike = insightMap.get('change-failure-rate-spike-by-ide');
  const deploySuccess = insightMap.get('deployment-success-distribution');

  if (cfrSpike && deploySuccess &&
      !cfrSpike.isDiagnostic && !cfrSpike.portfolioSuppressed && cfrSpike.hasData !== false &&
      !deploySuccess.isDiagnostic && !deploySuccess.portfolioSuppressed && deploySuccess.hasData !== false) {
    // Both describe deployment success/failure for the same population.
    // Keep the one with more specific evidence (deployment-success-distribution
    // has success_failure_distribution presentationKind with distribution data).
    // Suppress the CFR spike finding as it's the less specific overlap.
    const reason = `deployment-success-distribution provides the same success-rate story with distribution evidence; CFR spike is redundant`;
    insightMap.set('change-failure-rate-spike-by-ide', markAsPortfolioSuppressed(cfrSpike, reason));
    suppressedIds.add('change-failure-rate-spike-by-ide');
    piDebugLog('[WS2_CONSOLIDATION][DEPLOYMENT_RELIABILITY_OVERLAP]', {
      suppressed: 'change-failure-rate-spike-by-ide',
      retained: 'deployment-success-distribution',
      reason,
    });
  }

  // CR-X P1 STORY-LEVEL CONSOLIDATION:
  // Unit-economics derivatives — when multiple allocated-spend-per-* findings
  // describe the same configured-spend/outcome relationship for the same period,
  // keep only the most decision-relevant one (per-merged-pr for review-merge,
  // per-deployment for deploy-operate) and suppress the rest as derivatives
  // of the same configured-spend story.
  const unitEconFindings = Array.from(insightMap.values()).filter(
    i => i.id.startsWith('allocated-spend-per-') && !i.isDiagnostic && i.hasData !== false && !i.portfolioSuppressed
  );

  if (unitEconFindings.length >= 3) {
    // Group by stage
    const byStage = new Map<string, CanonicalInsight[]>();
    for (const f of unitEconFindings) {
      const stage = f.cicdStage || 'unknown';
      const group = byStage.get(stage) ?? [];
      group.push(f);
      byStage.set(stage, group);
    }

    // For each stage with ≥2 findings, keep the most decision-relevant and suppress the rest
    const PRIORITY_ORDER: Record<string, number> = {
      'allocated-spend-per-merged-pr': 1,
      'allocated-spend-per-deployment': 1,
      'allocated-spend-per-review-cycle': 2,
      'allocated-spend-per-successful-deployment': 2,
      'allocated-spend-per-release': 3,
      'allocated-spend-per-failed-deployment': 3,
    };

    for (const [stage, group] of byStage) {
      if (group.length < 2) continue;

      // Sort by priority (lower = more decision-relevant)
      group.sort((a, b) => (PRIORITY_ORDER[a.id] ?? 99) - (PRIORITY_ORDER[b.id] ?? 99));
      const retained = group[0];

      for (let i = 1; i < group.length; i++) {
        const reason = `consolidated with ${retained.id} (same configured-spend/outcome story for ${stage})`;
        insightMap.set(group[i].id, markAsPortfolioSuppressed(group[i], reason));
        suppressedIds.add(group[i].id);
        piDebugLog('[WS2_CONSOLIDATION][UNIT_ECON_DERIVATIVE]', {
          suppressed: group[i].id,
          retained: retained.id,
          stage,
          reason,
        });
      }
    }
  }

  // Split into visible and suppressed
  const allResults = Array.from(insightMap.values());
  const visible = allResults.filter(i => !i.portfolioSuppressed);
  const suppressed = allResults.filter(i => i.portfolioSuppressed);

  piDebugLog('[WS2_CONSOLIDATION][COMPLETE]', {
    visibleCount: visible.length,
    suppressedCount: suppressed.length,
    suppressedIds: Array.from(suppressedIds),
    visibleIds: visible.map(i => i.id),
    suppressedDetails: suppressed.map(i => ({ id: i.id, reason: i.portfolioSuppressedReason })),
  });

  return { visible, suppressed };
}

/**
 * CR-X FINAL — Explicit story-key suppression.
 *
 * When a synthesis finding and its component mirror cards share the same
 * storyKey, the synthesis wins and the component cards are suppressed from
 * rendered findings. Their numbers remain present in the synthesis evidence.
 *
 * This is NOT fuzzy family/subject heuristics. Generators explicitly emit
 * storyKey only for genuine parent/child stories where the synthesis
 * subsumes the component cards.
 *
 * Rules:
 * - Only insights with a non-empty storyKey participate.
 * - If a synthesis (parent) finding with that storyKey passes evidence gates
 *   (hasData, not diagnostic, not already suppressed), all OTHER insights
 *   with the same storyKey are portfolio-suppressed.
 * - If no synthesis finding passes gates, component cards remain visible.
 * - Suppressed cards keep hasData=true, isDiagnostic=false — they are
 *   portfolio-suppressed, not diagnostics.
 */
function applyStoryKeySuppression(
  insightMap: Map<string, CanonicalInsight>,
  alreadySuppressed: Set<string>,
): string[] {
  const newlySuppressed: string[] = [];

  // Group insights by storyKey
  const storyGroups = new Map<string, CanonicalInsight[]>();
  for (const insight of insightMap.values()) {
    if (!insight.storyKey) continue;
    if (insight.isDiagnostic) continue;
    if (insight.hasData === false) continue;
    if (alreadySuppressed.has(insight.id)) continue;

    const group = storyGroups.get(insight.storyKey) ?? [];
    group.push(insight);
    storyGroups.set(insight.storyKey, group);
  }

  // For each story group, check if a synthesis (parent) finding exists.
  for (const [storyKey, members] of storyGroups) {
    if (members.length < 2) continue; // No parent/child relationship

    // Find the synthesis (parent) finding — it has presentationKind
    // 'executive_synthesis' or id containing 'synthesis'.
    const synthesis = members.find(m =>
      m.presentationKind === 'executive_synthesis' ||
      m.id.includes('synthesis')
    );

    if (!synthesis) continue; // No parent — all components remain visible

    // Suppress all non-synthesis members
    for (const m of members) {
      if (m.id === synthesis.id) continue;
      if (alreadySuppressed.has(m.id)) continue;
      if (m.portfolioSuppressed) continue;

      m.portfolioSuppressed = true;
      m.portfolioSuppressedReason = `story-key-suppressed: parent synthesis ${synthesis.id} subsumes this component card`;
      m.lifecycleClass = 'suppress';
      newlySuppressed.push(m.id);

      piDebugLog('[WS2_CONSOLIDATION][STORY_KEY_SUPPRESS]', {
        storyKey,
        suppressedId: m.id,
        retainedId: synthesis.id,
      });
    }
  }

  return newlySuppressed;
}

/**
 * CR-X FINAL: Semantic-family-aware dominance suppression.
 *
 * When multiple findings from the SAME semantic family describe the same
 * executive story (same workflow subject, same time window), only the
 * strongest materiality-scored finding should remain visible. Dominated
 * findings are portfolio-suppressed (not diagnostic) and retained for audit.
 *
 * This prevents repetitive findings from crowding out more decision-useful
 * findings from other families. Family quotas in getTopInsights provide a
 * second layer of diversity enforcement for Top-5 selection.
 *
 * CONSERVATIVE: Only suppress when findings share the same semantic family,
 * the same subject (workflow), AND the same presentationKind (same metric
 * shape). Different metric shapes in the same family coexist — e.g., a
 * within-workflow AI-effect finding and a within-workflow session-distribution
 * finding are different stories and both remain visible.
 *
 * The dominated finding must also have materially lower score (< 50% of the
 * strongest) to be suppressed.
 */
function applySemanticFamilyDominance(
  insightMap: Map<string, CanonicalInsight>,
  alreadySuppressed: Set<string>,
): string[] {
  const newlySuppressed: string[] = [];

  // Group eligible (non-diagnostic, has-data, not-already-suppressed) insights
  // by semantic family + subject + presentationKind.
  const familySubjectKindGroups = new Map<string, CanonicalInsight[]>();

  for (const insight of insightMap.values()) {
    if (insight.isDiagnostic) continue;
    if (insight.hasData === false) continue;
    if (insight.portfolioSuppressed) continue;

    const family = insight.semanticFamily || resolveSemanticFamily(insight.id);
    if (family === 'diagnostic') continue;

    // Extract subject: the workflow suffix from instance IDs, or 'org' for
    // org-level findings.
    const idParts = insight.id.split('__');
    const subject = idParts.length > 1 ? idParts.slice(1).join('__') : 'org';

    const pk = insight.presentationKind || 'unknown';

    // Skip generic standalone shapes — two outcome_threshold or org_summary
    // findings in the same family are NOT necessarily the same story.
    // Only apply dominance to specific comparative shapes where same family +
    // same subject + same kind truly means same executive story.
    if (pk === 'outcome_threshold' || pk === 'org_summary' || pk === 'unknown' || pk === 'diagnostic') {
      continue;
    }

    const groupKey = `${family}::${subject}::${pk}`;
    if (!familySubjectKindGroups.has(groupKey)) {
      familySubjectKindGroups.set(groupKey, []);
    }
    familySubjectKindGroups.get(groupKey)!.push(insight);
  }

  // Within each group, suppress dominated findings that have < 50% of the
  // strongest member's materiality score.
  const DOMINANCE_RATIO = 0.50;
  for (const [groupKey, members] of familySubjectKindGroups) {
    if (members.length <= 1) continue;

    members.sort((a, b) => getMaterialityScore(b) - getMaterialityScore(a));
    const strongest = members[0];
    const strongestScore = getMaterialityScore(strongest);
    if (strongestScore <= 0) continue;

    for (let i = 1; i < members.length; i++) {
      const candidate = members[i];
      const candidateScore = getMaterialityScore(candidate);
      if (candidateScore >= strongestScore * DOMINANCE_RATIO) continue;

      const reason = `dominated by ${strongest.id} in semantic family (same subject+kind, <50% materiality)`;
      insightMap.set(candidate.id, markAsPortfolioSuppressed(candidate, reason));
      newlySuppressed.push(candidate.id);
      piDebugLog('[WS2_CONSOLIDATION][DOMINANCE_SUPPRESS]', {
        groupKey,
        suppressedId: candidate.id,
        retainedId: strongest.id,
        dominatedScore: candidateScore,
        retainedScore: strongestScore,
        ratio: candidateScore / strongestScore,
      });
    }
  }

  return newlySuppressed;
}
