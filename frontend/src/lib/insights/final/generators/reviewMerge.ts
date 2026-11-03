/**
 * Review & Merge Stage Generators for Final Canonical Performance Insights
 * 
 * This module contains generator functions for the 5 Review & Merge stage canonical PIs.
 * 
 * INTENDED FUTURE DATA FLOW:
 * 1. dataAccess.ts fetches GitHub PR analytics and review metrics
 * 2. Session primitives are computed from raw telemetry events
 * 3. Each generator receives CanonicalInsightInput with sessionRows, githubByPeriod, githubSnapshot
 * 4. Generators compute metrics and return CanonicalInsight or null
 * 5. synthesizeInsight.ts adds evidence, recommendations, executive summaries
 * 6. renderAdapter.ts adapts for UI
 * 
 * CURRENT STATUS: Placeholder stubs using canonical inventory
 * - Generators return placeholder CanonicalInsight objects
 * - No actual compute logic yet (to be migrated in Phase B2)
 * - Stubs validate the orchestration layer works correctly
 * 
 * No imports from old V2 systems (computeV2PerformanceInsights.ts, piV2Manifest.ts, V2_PREVIEW_ROW_IDS)
 */

import type { CanonicalInsightInput, CanonicalInsight, DataDomain, AttributionStatus } from '../types';
import { ConfidenceLevel } from '../types';
import { getCanonicalPIById } from '../canonicalInsights';
import { formatPct, formatDelta, formatHours, formatDays, formatFrequency, formatConcentration, formatFailureRate, formatDeploymentCadence, toPilotToolLabel } from '../utils/formatHelpers';
import { getCanonicalWorkflowIdentity } from '../../../../lib/workflowIdentity';
import { getAIModelById, getDiverseAIModels, WORKFLOW_MODEL_COMBINATIONS } from '../registry/aiModelRegistry';
import { generateWorkflowContexts, createNarrativeStructure, replaceHypeLanguage, getCausalLanguage } from '../helpers/workflowIntelligence';
import { generateAIModelFirstTitle, getIDEContextForModel } from '../helpers/aiModelFirstTitles';
import { softenOracleLanguage, generateMixedModelNarrative } from '../helpers/narrativeVariance';
import { piDebugLog } from '../utils/logging';
import { hasAuthoritativeGithubEvidence, getGithubProvenanceState } from '../dataAccess';
import { resolveDeliveryAttribution } from '../attribution/attributionIntegration';
import { getDeliveryAttribution } from '../helpers/engineCache';
import { generateAllocatedSpendPerMergedPR, generateAllocatedSpendPerReviewCycle } from './unitEconomics';
import { selectRecentCompleteMonths, buildPeriodStrip, type PeriodStripData } from '../helpers/periodStrip';
import { MIN_SAMPLES_FOR_COMPARISON } from '../helpers/comparisonState';

/**
 * Generate PR reopen pressure spike PI
 * 
 * MIGRATED LOGIC FROM computeV2PerformanceInsights.ts:
 * - Detect spikes in PR reopen events
 * - Use GitHub PR analytics and pr_analytics data
 * - Calculate reopen rate vs baseline
 * - Add evidence with sample sizes, confidence, time window
 * - Add recommendations for code review quality
 * 
 * Uses seeded demo data as production-grade evidence for demo mode.
 * Preserves high-signal V2 copy patterns for executive narratives.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateReopenPressureSpike(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('reopen-pressure-spike');
  if (!registryEntry) return null;

  const githubSnapshot = input.githubSnapshot || {};
  
  // Check for stress/demo mode
  const isStressMode = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('piStress') === '1' ||
    new URLSearchParams(window.location.search).get('demoMode') === '1'
  );

  // Structured diagnostic for suppression
  const suppressionDiagnostic = {
    insightId: 'reopen-pressure-spike',
    missingFields: [] as string[],
    sourceEndpoint: '/api/metrics?time_filter=all&use_all_data=1',
    requestedTimeFilter: 'all',
    githubDataFallback: false,
    dbPRCount: githubSnapshot.total_pull_requests || githubSnapshot.merged_pull_requests || 0,
    dbDeployCount: githubSnapshot.deployment_metrics?.total_deployments || 0,
    timestamp: new Date().toISOString()
  };

  // Priority order for reopen data sources:
  // 1. Backend pr_review_metrics.pr_reopened_count + pr_review_metrics.total_prs
  // 2. Top-level reopen_pressure_spike
  // 3. pr_analytics (legacy)
  let totalPRs = 0;
  let reopenedPRs = 0;
  let currentReopenRate = 0;
  let dataSource = 'none';
  const baselineReopenRate = 5.0;

  // Check pr_review_metrics first (preferred backend source).
  // pr_reopened_count must be a finite measured number — null means the
  // GitHub sync does not capture reopen events, NOT a measured zero.
  if (githubSnapshot.pr_review_metrics) {
    const prReviewMetrics = githubSnapshot.pr_review_metrics;
    if (typeof prReviewMetrics.pr_reopened_count === 'number' && Number.isFinite(prReviewMetrics.pr_reopened_count) &&
        typeof prReviewMetrics.total_prs === 'number' && prReviewMetrics.total_prs > 0) {
      totalPRs = prReviewMetrics.total_prs;
      reopenedPRs = prReviewMetrics.pr_reopened_count;
      currentReopenRate = (reopenedPRs / totalPRs) * 100;
      dataSource = 'pr_review_metrics';
    } else {
      suppressionDiagnostic.missingFields.push('pr_review_metrics.pr_reopened_count or pr_review_metrics.total_prs');
    }
  } else {
    suppressionDiagnostic.missingFields.push('pr_review_metrics');
  }

  // Fallback to top-level reopen_pressure_spike (must be a finite measured rate)
  if (dataSource === 'none' && typeof githubSnapshot.reopen_pressure_spike === 'number' && Number.isFinite(githubSnapshot.reopen_pressure_spike)) {
    totalPRs = githubSnapshot.total_pull_requests || githubSnapshot.merged_pull_requests || 0;
    if (totalPRs > 0) {
      currentReopenRate = githubSnapshot.reopen_pressure_spike;
      reopenedPRs = Math.round((currentReopenRate / 100) * totalPRs);
      dataSource = 'reopen_pressure_spike';
    } else {
      suppressionDiagnostic.missingFields.push('total_pull_requests or merged_pull_requests');
    }
  } else if (dataSource === 'none') {
    suppressionDiagnostic.missingFields.push('reopen_pressure_spike');
  }

  // Fallback to pr_analytics (legacy) — reopened_prs must be a finite measured number
  if (dataSource === 'none' && githubSnapshot.pr_analytics && Object.keys(githubSnapshot.pr_analytics).length > 0) {
    const prAnalytics = githubSnapshot.pr_analytics;
    if (prAnalytics.total_prs && prAnalytics.total_prs > 0 &&
        typeof prAnalytics.reopened_prs === 'number' && Number.isFinite(prAnalytics.reopened_prs)) {
      totalPRs = prAnalytics.total_prs;
      reopenedPRs = prAnalytics.reopened_prs;
      currentReopenRate = (reopenedPRs / totalPRs) * 100;
      dataSource = 'pr_analytics';
    } else {
      suppressionDiagnostic.missingFields.push('pr_analytics.total_prs or pr_analytics.reopened_prs');
    }
  } else if (dataSource === 'none') {
    suppressionDiagnostic.missingFields.push('pr_analytics');
  }

  // Log diagnostic
  piDebugLog('[REOPEN_PRESSURE_SPIKE_DIAGNOSTIC]', {
    dataSource,
    totalPRs,
    reopenedPRs,
    currentReopenRate,
    suppressionDiagnostic: dataSource === 'none' ? suppressionDiagnostic : null
  });

  // If no data source found, either emit a true data-gap diagnostic (when a
  // GitHub PR population is observed but reopen telemetry is not captured) or
  // suppress entirely (no GitHub context at all). No seeded fallbacks.
  if (dataSource === 'none') {
    piDebugLog('[PI_SUPPRESSION_DIAGNOSTIC]', JSON.stringify({
      ...suppressionDiagnostic,
      suppressionReason: 'No legitimate reopen data sources available',
      githubSnapshotKeys: Object.keys(githubSnapshot)
    }));

    const observedPRCount =
      githubSnapshot.pr_review_metrics?.total_prs ??
      githubSnapshot.total_pull_requests ??
      githubSnapshot.github_team_metrics?.total_prs ??
      0;
    const hasGithubContext = observedPRCount > 0 || githubSnapshot.github_connected === true;

    if (!hasGithubContext) {
      return null;
    }

    // TRUE DATA GAP: GitHub PRs are observed but reopen events are not
    // captured by the current sync. Missing instrumentation is reported as
    // a gap — never as a measured 0% rate.
    const diagnosticInsight: CanonicalInsight = {
      id: registryEntry.id,
      title: 'PR reopen rate is not yet measurable',
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      comparisonMode: 'threshold_vs_actual',
      current: 0,
      baseline: baselineReopenRate,
      delta: 0,
      deltaPct: 0,
      rightMetric: 'Not measured',
      rightMetricLabel: 'Reopen Rate',
      metricDefinition: 'Percentage of PRs reopened after initial review or merge',
      operationalBreadcrumbs: [
        `${observedPRCount} PRs observed`,
        'Reopen events not captured'
      ],
      confidence: 'low' as ConfidenceLevel,
      coveragePct: 0,
      n: observedPRCount,
      hasData: true,
      isDiagnostic: true,
      isTopInsightEligible: false,
      recommendationAllowed: false,
      diagnosticReason: 'WAITING_FOR_GITHUB_DELIVERY_OUTCOMES',
      diagnosticUnlockPath: 'Reopen events are not captured by the current GitHub sync — enable reopen tracking (PR timeline/issue events) to measure reopen rate.',
      sourceLabel: 'GitHub review',
      sampleUnit: 'PRs',
      sampleLabel: `${observedPRCount.toLocaleString()} PRs`,
      description: `${observedPRCount} PRs are observed, but PR reopen events are not captured by the current GitHub sync, so the reopen rate cannot be computed. Missing instrumentation is reported as a data gap, not as a 0% reopen rate.`,
      whatChanged: `Reopen telemetry unavailable for the observed GitHub PR population (${observedPRCount} PRs).`,
      whyItMatters: 'Reopen rate is a review-quality signal. Without reopen telemetry, the <10% reopen target cannot be evaluated.',
      recommendation: 'Enable reopen event capture in the GitHub sync (PR timeline/issue events) before reporting a reopen rate.',
      evidenceAndContext: `${observedPRCount} GitHub PRs observed. Reopen events are not captured, so no reopen rate is reported.`,
      operationalImpact: 'Reopen pressure cannot be assessed until reopen events are instrumented.',
      primaryRisk: 'Unmeasured reopen activity may hide review-quality issues.',
      cohort: 'Quality Signal',
      confidenceReasoning: 'Diagnostic — reopen telemetry is not captured, so no measured value exists.',
      recommendationState: 'monitor_only',
      urgencyLabel: 'monitor',
      engineVersion: 'FINAL_ENGINE_V1',
      generatorSource: 'final/generators/reviewMerge.ts',
      featureFlagState: true,
      evidence: [
        { metric: 'PRs observed', value: observedPRCount.toString(), label: 'GitHub all-time' },
        { metric: 'Reopen events', value: 'Not captured', label: 'Instrumentation' },
        { metric: 'Reopen rate', value: 'Not measurable', label: 'Status' }
      ],
      breakdownByTool: undefined,
      operationalRead: 'Reopen telemetry is not captured by the current GitHub sync.'
    };

    return diagnosticInsight;
  }

  let cursorReopenRate = 0;
  let windsurfReopenRate = 0;
  let vscodeReopenRate = 0;

  // ============================================================
  // CR-X R1.1: Authoritative workflow attribution for reopen rate.
  //
  // A workflow entry may appear in breakdownByTool ONLY when its specific
  // reopen_rate AND a per-workflow sample count are directly present in
  // the source. Missing per-workflow data = OMIT that workflow. Missing
  // != org average. Missing != zero.
  //
  // Source compatibility: the by_ide breakdown lives under pr_analytics.
  // The org-level reopen rate may come from pr_review_metrics,
  // reopen_pressure_spike, or pr_analytics. Only use pr_analytics.by_ide
  // when the org-level dataSource is also pr_analytics (same sample).
  // Do not combine a pr_review_metrics org-level sample with a
  // pr_analytics by_ide breakdown.
  //
  // A workflow comparison requires >=2 directly observed workflow values.
  // Fewer than 2 qualifying entries => org-level finding, no breakdown,
  // no winner/runner-up.
  // ============================================================
  type ReopenWorkflowEntry = { name: string; value: number; count: number };
  const qualifyingReopenWorkflows: ReopenWorkflowEntry[] = [];

  if (dataSource === 'pr_analytics' && githubSnapshot.pr_analytics?.by_ide) {
    const byIde = githubSnapshot.pr_analytics.by_ide;
    for (const workflowKey of Object.keys(byIde)) {
      const entry = byIde[workflowKey];
      if (!entry) continue;
      const reopenRate = entry.reopen_rate;
      const count = entry.count;
      // Require BOTH a numeric reopen_rate AND a positive integer count.
      if (typeof reopenRate === 'number' && !isNaN(reopenRate) &&
          typeof count === 'number' && count > 0) {
        qualifyingReopenWorkflows.push({ name: workflowKey, value: reopenRate, count });
      }
    }
  }

  const hasAuthoritativeReopenComparison = qualifyingReopenWorkflows.length >= 2;

  // Preserve legacy per-IDE variables for compatibility with downstream
  // code that may reference them, but only populate from qualifying entries.
  if (hasAuthoritativeReopenComparison) {
    const findEntry = (key: string) => qualifyingReopenWorkflows.find(w => w.name === key);
    const cursorEntry = findEntry('cursor');
    const windsurfEntry = findEntry('windsurf');
    const vscodeEntry = findEntry('vscode');
    cursorReopenRate = cursorEntry ? cursorEntry.value : 0;
    windsurfReopenRate = windsurfEntry ? windsurfEntry.value : 0;
    vscodeReopenRate = vscodeEntry ? vscodeEntry.value : 0;
  }

  const delta = currentReopenRate - baselineReopenRate;
  const deltaPct = baselineReopenRate > 0 ? ((currentReopenRate - baselineReopenRate) / baselineReopenRate) * 100 : 0;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalPRs >= 50 ? 'high' : totalPRs >= 20 ? 'medium' : 'low';
  const coveragePct = dataSource !== 'none' ? 100 : 89;

  // Use canonical workflow identities
  const windsurfIdentity = getCanonicalWorkflowIdentity('windsurf');
  const cursorIdentity = getCanonicalWorkflowIdentity('cursor');

  // Generate narrative based on data source
  let description: string;
  let whatChanged: string;
  let whyItMatters: string;
  let recommendation: string;

  // dataSource !== 'none' is guaranteed here — the 'none' case returned a
  // diagnostic or null above.
  description = currentReopenRate > 10.0
    ? `PRs are reopening above target, which points to review quality pressure.`
    : `Observed PR reopen rate is at or below the <10% target across ${totalPRs} PRs.`;
  whatChanged = hasAuthoritativeReopenComparison
    ? `Reopen rate is ${formatPct(currentReopenRate)} (${reopenedPRs}/${totalPRs} PRs), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} baseline. Data source: ${dataSource}. Workflow breakdown available for ${qualifyingReopenWorkflows.length} workflows.`
    : `Reopen rate is ${formatPct(currentReopenRate)} (${reopenedPRs}/${totalPRs} PRs), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} baseline. Data source: ${dataSource}. Org-level GitHub signal; workflow attribution unavailable.`;
  whyItMatters = 'Elevated reopen pressure indicates quality issues in the review process that can impact downstream stability.';
  // Recommendation must match the measured comparison: only push corrective
  // action when the observed reopen rate is actually above target.
  recommendation = currentReopenRate > 10.0
    ? 'Tighten test coverage gates and minimum review requirements before merge.'
    : 'Reopen rate is at or below the <10% target. Continue monitoring; no corrective action indicated by this signal.';

  // Determine winner and runner-up for reopen rate.
  // Only compute when >=2 authoritative workflow entries qualify.
  let winner: { name: string; value: number } | null = null;
  let runnerUp: { name: string; value: number } | null = null;
  let winnerValue = 0;
  let runnerUpValue = 0;
  let deltaTool = 0;
  let deltaPctTool = 0;

  if (hasAuthoritativeReopenComparison) {
    const sorted = [...qualifyingReopenWorkflows].sort((a, b) => b.value - a.value);
    winner = sorted[0];
    runnerUp = sorted[1];

    winnerValue = winner.value;
    runnerUpValue = runnerUp.value;
    deltaTool = winnerValue - runnerUpValue;
    deltaPctTool = runnerUpValue > 0 ? ((winnerValue - runnerUpValue) / runnerUpValue) * 100 : 0;
  }

  // ============================================================
  // Dynamic title based on actual reopen rate - outcome-first, caveat-second
  const dynamicTitle = `${formatPct(currentReopenRate, 1)} PR reopen rate vs <10% target across ${totalPRs} PRs`;

  // hasLiveData is true here because dataSource === 'none' returns null earlier (line 135)
  const hasLiveData = dataSource !== 'none';

  // NARRATIVE ENHANCEMENT
  // ============================================================
  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: dynamicTitle, // Use dynamic title instead of hardcoded registry title
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'threshold',
    comparisonMode: 'threshold_vs_actual',
    current: currentReopenRate,
    baseline: baselineReopenRate,
    delta,
    deltaPct,
    rightMetric: formatPct(currentReopenRate) + ' reopen rate',
    rightMetricLabel: 'Reopen Rate',
    metricValue: currentReopenRate,
    displayValue: formatPct(currentReopenRate),
    metricDefinition: 'Percentage of merged PRs that required reopening after initial merge',
    polarity: 'lower_is_better' as const, // Lower reopen rate is better (lower is better)
    operationalBreadcrumbs: [
      `${reopenedPRs} reopened PRs`,
      `${totalPRs} total PRs reviewed`,
      `Baseline: ${formatPct(baselineReopenRate)}`
    ],
    confidence,
    coveragePct,
    n: totalPRs,
    hasData: true,
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: hasLiveData
      ? `Analysis of ${totalPRs} PRs. ${reopenedPRs} PRs reopened (${formatPct(currentReopenRate)} reopen rate). Baseline: ${formatPct(baselineReopenRate)}. Coverage: ${coveragePct}%.`
      : `Analysis of ${totalPRs} PRs. ${reopenedPRs} PRs required reopening (${formatPct(currentReopenRate)} reopen rate), exceeding the ${formatPct(baselineReopenRate)} quality threshold by ${formatDelta(deltaPct)}. Coverage: ${coveragePct}%. No GitHub review metrics available — analysis based on PR reopen counts only.`,
    operationalImpact: hasLiveData
      ? `${reopenedPRs} reopened PRs added additional review cycles, extending delivery timelines.`
      : `${reopenedPRs} reopened PRs added additional review cycles, extending delivery timelines.`,
    primaryRisk: 'Elevated reopen pressure indicates quality issues that can impact downstream stability.',
    cohort: 'Quality Signal',
    confidenceReasoning: hasLiveData
      ? `${confidence} confidence based on ${totalPRs} PRs with ${coveragePct}% data coverage.`
      : `${confidence} confidence based on ${totalPRs} PRs with ${coveragePct}% data coverage. No GitHub review metrics available.`,
    recommendationState: deltaPct > 50 ? 'action_required' : 'monitor_only',
    urgencyLabel: deltaPct > 50 ? 'action_required' : 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/reviewMerge.ts',
    featureFlagState: true,
    evidence: hasLiveData
      ? [
          { metric: 'Reopened / total', value: `${reopenedPRs} / ${totalPRs}`, label: 'Reopened / total' },
          { metric: 'Actual reopen rate', value: formatPct(currentReopenRate), label: 'Actual reopen rate' },
          { metric: 'Target', value: '<10%', label: 'Target' },
          { metric: 'Basis', value: 'All-time GitHub sample', label: 'Time basis' },
          { metric: 'Attribution', value: 'Org-wide', label: 'Status' }
        ]
      : [
          { metric: 'Reopened / total', value: `${reopenedPRs} / ${totalPRs}`, label: 'Reopened / total' },
          { metric: 'Actual reopen rate', value: formatPct(currentReopenRate), label: 'Actual reopen rate' },
          { metric: 'Target', value: '<10%', label: 'Target' },
          { metric: 'Basis', value: 'All-time GitHub sample', label: 'Time basis' },
          { metric: 'Attribution', value: 'Org-wide', label: 'Status' }
        ],
    attributionStatus: hasAuthoritativeReopenComparison ? 'ide_attributed' : 'org_level_only',
    breakdownByTool: hasAuthoritativeReopenComparison
      ? Object.fromEntries(
          qualifyingReopenWorkflows.map(w => [
            w.name,
            {
              value: w.value,
              count: w.count,
              formatted: `${formatPct(w.value)} reopen rate`,
              label: getCanonicalWorkflowIdentity(w.name)
            }
          ])
        )
      : undefined,
    operationalRead: hasLiveData
      ? `Reopen rate: ${formatPct(currentReopenRate)} vs baseline ${formatPct(baselineReopenRate)} (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'}).`
      : `Reopen rate: ${formatPct(currentReopenRate)} vs baseline ${formatPct(baselineReopenRate)} (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'}). No GitHub review metrics available.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    demoFlag: hasLiveData ? undefined : 'demo_primary',
    demoNarrativePriority: hasLiveData ? undefined : 80
  };

  return baseInsight;
}

/**
 * Generate reviewer load concentration PI
 * 
 * MIGRATED LOGIC FROM computeV2PerformanceInsights.ts:
 * - Detect concentration of review load on few reviewers
 * - Use reviewer_load_concentration from githubSnapshot
 * - Calculate distribution of review assignments
 * - Add evidence with sample sizes, confidence, time window
 * - Add recommendations for reviewer scaling
 * 
 * Uses seeded demo data as production-grade evidence for demo mode.
 * Preserves high-signal V2 copy patterns for executive narratives.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateReviewerLoadConcentration(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('reviewer-load-concentration');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};
  
  // DEBUG: Log input state
  piDebugLog('[GENERATOR_REVIEWER_LOAD_CONCENTRATION][INPUT]', {
    hasGithubSnapshot: !!input.githubSnapshot,
    githubSnapshotKeys: input.githubSnapshot ? Object.keys(input.githubSnapshot) : [],
    reviewerLoadConcentration: githubSnapshot.reviewer_load_concentration,
    reviewerLoadType: typeof githubSnapshot.reviewer_load_concentration,
    prReviewMetrics: githubSnapshot.pr_review_metrics
  });

  // FIX: Use pr_review_metrics as primary data source for org-wide baseline
  const hasReviewMetrics = githubSnapshot.pr_review_metrics
    && githubSnapshot.pr_review_metrics.review_count > 0
    && githubSnapshot.pr_review_metrics.unique_reviewer_count != null;
  const hasConcentrationData = githubSnapshot.reviewer_load_concentration && (typeof githubSnapshot.reviewer_load_concentration === 'number' || Object.keys(githubSnapshot.reviewer_load_concentration).length > 0);
  const hasLiveData = hasReviewMetrics || hasConcentrationData;

  // If no data, return null (will be handled as org-wide baseline only)
  if (!hasLiveData) {
    piDebugLog('[GENERATOR_REVIEWER_LOAD_CONCENTRATION][NO_LIVE_DATA]', 'Review card requires GitHub data', {
      hasGithubSnapshot: !!input.githubSnapshot,
      hasReviewMetrics,
      hasConcentrationData,
      prReviewMetrics: githubSnapshot.pr_review_metrics
    });
    return null;
  }

  let cursorConcentration = 0;
  let windsurfConcentration = 0;
  let vscodeConcentration = 0;
  let concentrationScore = 0;
  let targetConcentration = 50;
  let totalReviews = 0;
  let topReviewerCount = 3;
  let uniqueReviewers = 0;
  let totalPRs = 0;

  // Use pr_review_metrics as primary source for org-wide baseline
  if (hasReviewMetrics) {
    const prReviewMetrics = githubSnapshot.pr_review_metrics;
    totalReviews = prReviewMetrics.review_count || 0;
    uniqueReviewers = prReviewMetrics.unique_reviewer_count || 0;
    totalPRs = prReviewMetrics.total_prs || 0;
    
    // Check if actual top-reviewer workload data exists
    // We need top_reviewer_counts or similar to calculate actual workload concentration
    // Without this data, we cannot credibly claim bottleneck
    const hasActualWorkloadData = prReviewMetrics.top_reviewer_counts !== undefined ||
                                   prReviewMetrics.top_reviewer_workload !== undefined;
    
    if (!hasActualWorkloadData) {
      // Actual reviewer workload distribution not available - make diagnostic
      piDebugLog('[GENERATOR_REVIEWER_LOAD_CONCENTRATION][NO_WORKLOAD_DATA]', 'Actual top-reviewer workload data not available, making diagnostic');
      
      const baseInsight: CanonicalInsight = {
        id: registryEntry.id,
        title: 'Reviewer load analysis needs actual workload distribution data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        current: 0,
        baseline: targetConcentration,
        delta: 0,
        deltaPct: 0,
        rightMetric: 'Not available',
        rightMetricLabel: 'Review Load Concentration',
        metricDefinition: 'Percentage of reviews handled by top reviewers, measuring reviewer distribution balance',
        operationalBreadcrumbs: [
          `${uniqueReviewers} unique reviewers`,
          `${totalReviews} total reviews`,
          `${totalPRs} total PRs`
        ],
        confidence: 'low' as ConfidenceLevel,
        coveragePct: 0,
        n: totalReviews || 0,
        hasData: true,
        sourceLabel: 'GitHub review',
        sampleUnit: 'reviews',
        sampleLabel: `${totalReviews.toLocaleString()} reviews`,
        description: 'Actual reviewer workload distribution data is not available. Without per-reviewer workload counts, we cannot credibly determine if reviewer load is concentrated or distributed.',
        whatChanged: `Analysis of ${totalReviews} reviews across ${totalPRs} PRs with ${uniqueReviewers} unique reviewers. Actual top-reviewer workload distribution not available.`,
        whyItMatters: 'Reviewer load concentration analysis requires actual per-reviewer workload data to identify bottlenecks. Without this data, we cannot determine if a small group of reviewers handles most reviews.',
        recommendation: 'Enable per-reviewer workload tracking to identify reviewer bottlenecks. Use workflow tagging to compare reviewer load by IDE/tool once attribution is available.',
        evidenceAndContext: `Analysis of ${totalReviews} reviews across ${totalPRs} PRs with ${uniqueReviewers} unique reviewers. Actual top-reviewer workload distribution not available.`,
        operationalImpact: 'Cannot assess reviewer load concentration without actual workload data.',
        primaryRisk: 'Unknown reviewer load distribution may create delivery bottlenecks.',
        cohort: 'Workflow Intelligence',
        confidenceReasoning: 'Low confidence - actual reviewer workload data not available.',
        recommendationState: 'monitor_only',
        urgencyLabel: 'monitor',
        engineVersion: 'FINAL_ENGINE_V1',
        generatorSource: 'final/generators/reviewMerge.ts',
        featureFlagState: true,
        isDiagnostic: true,
        isTopInsightEligible: false,
        recommendationAllowed: false,
        evidence: [
          { metric: 'Data gap', value: 'Actual reviewer workload not available', label: 'Status' },
          { metric: 'Unique reviewers', value: uniqueReviewers.toString(), label: 'Total' },
          { metric: 'Total reviews', value: totalReviews.toString(), label: 'Evidence base' },
          { metric: 'Attribution', value: 'Workflow attribution not yet available', label: 'Status' }
        ],
        breakdownByTool: undefined,
        operationalRead: 'Reviewer load analysis needs actual workload distribution data.'
      };
      
      return baseInsight;
    }
    
    // If actual workload data exists, calculate real concentration
    // For now, we don't have this data, so this branch is a placeholder
    // When backend provides top_reviewer_counts, implement:
    // const top3ReviewCount = prReviewMetrics.top_reviewer_counts;
    // const top3ReviewShare = (top3ReviewCount / totalReviews) * 100;
    
    // REMOVED: 3 / uniqueReviewers estimate - not credible without actual workload data
    // If we don't have actual top-reviewer workload counts, we cannot calculate concentration
    // Return diagnostic instead (handled in hasActualWorkloadData check above)
    
    // If we have reviewer_load_concentration, use it for IDE breakdown
    if (hasConcentrationData) {
      const reviewerLoad = githubSnapshot.reviewer_load_concentration;
      if (typeof reviewerLoad === 'number') {
        concentrationScore = reviewerLoad;
      } else if (reviewerLoad.concentration_score) {
        concentrationScore = reviewerLoad.concentration_score;
        if (reviewerLoad.by_ide) {
          cursorConcentration = reviewerLoad.by_ide.cursor?.concentration || concentrationScore;
          windsurfConcentration = reviewerLoad.by_ide.windsurf?.concentration || concentrationScore;
          vscodeConcentration = reviewerLoad.by_ide.vscode?.concentration || concentrationScore;
        }
      }
    } else {
      // No IDE breakdown - use same concentration for all
      cursorConcentration = concentrationScore;
      windsurfConcentration = concentrationScore;
      vscodeConcentration = concentrationScore;
    }
  } else if (hasConcentrationData) {
    // Fallback to reviewer_load_concentration only
    const reviewerLoad = githubSnapshot.reviewer_load_concentration;
    if (typeof reviewerLoad === 'number') {
      concentrationScore = reviewerLoad;
      // 18B.6: no observed review/reviewer counts in this branch — do not fabricate.
      totalReviews = 0;
      uniqueReviewers = 0;
    } else {
      concentrationScore = reviewerLoad.concentration_score || 0;
      totalReviews = reviewerLoad.total_reviews || 0;
      uniqueReviewers = reviewerLoad.unique_reviewers || 0;
      topReviewerCount = reviewerLoad.top_reviewer_count || 3;
      
      if (reviewerLoad.by_ide) {
        cursorConcentration = reviewerLoad.by_ide.cursor?.concentration || 0;
        windsurfConcentration = reviewerLoad.by_ide.windsurf?.concentration || 0;
        vscodeConcentration = reviewerLoad.by_ide.vscode?.concentration || 0;
      } else {
        cursorConcentration = concentrationScore;
        windsurfConcentration = concentrationScore;
        vscodeConcentration = concentrationScore;
      }
    }
  }

  const delta = concentrationScore - targetConcentration;
  const deltaPct = targetConcentration > 0 ? ((concentrationScore - targetConcentration) / targetConcentration) * 100 : 0;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalReviews >= 50 ? 'high' : totalReviews >= 20 ? 'medium' : 'low';
  const coveragePct = hasLiveData ? 100 : 85;

  // Generate narrative based on data source - use GitHub PR/review language
  let description: string;
  let whatChanged: string;
  let whyItMatters: string;
  let recommendation: string;
  let dataSourceLabel = 'GitHub review';

  // Cross-stage context: correlate with AI adoption from Plan & Code telemetry
  const aiAdoptionRate = sessionRows.length > 0
    ? (sessionRows.filter(s => s.session_has_ai_activity).length / sessionRows.length) * 100
    : 0;
  const highAIAdoption = aiAdoptionRate > 70;

  if (hasLiveData) {
    description = `Top ${topReviewerCount} reviewers handle ${formatConcentration(concentrationScore, 'reviewer', topReviewerCount)} of ${totalReviews} reviews across ${totalPRs} PRs, ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${targetConcentration}% balanced target${highAIAdoption ? `. High AI adoption (${Math.round(aiAdoptionRate)}%) may be accelerating PR volume faster than reviewer capacity scales` : ''}. This creates reviewer dependencies that can become delivery bottlenecks.`;
    whatChanged = `Top ${topReviewerCount} reviewers handle ${formatConcentration(concentrationScore, 'reviewer', topReviewerCount)} of ${totalReviews} reviews across ${totalPRs} PRs, ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} target${highAIAdoption ? `. AI adoption: ${Math.round(aiAdoptionRate)}%` : ''}.`;
    whyItMatters = 'When a few reviewers handle most PRs, delivery stops when they are unavailable. High AI adoption can accelerate PR volume faster than reviewer capacity scales.';
    recommendation = deltaPct > 30
      ? `Reviewer saturation creates delivery dependencies${highAIAdoption ? '. AI acceleration is outpacing reviewer capacity. Implement release batching and expand reviewer pool.' : '. Implement release coordination to reduce merge contention.'}`
      : `Track reviewer distribution${highAIAdoption ? ' and AI adoption trends. If PR volume accelerates with AI, proactively expand reviewer pool.' : '. If concentration increases, establish approval latency guidelines.'}`;
  } else {
    description = `Top ${topReviewerCount} reviewers handle ${formatConcentration(concentrationScore, 'reviewer', topReviewerCount)} of ${totalReviews} reviews across ${totalPRs} PRs, exceeding the ${targetConcentration}% balanced target by ${formatDelta(deltaPct)}. Org-wide GitHub signal · Add workflow tagging to compare reviewer load by IDE/tool.`;
    whatChanged = `Top ${topReviewerCount} reviewers handle ${formatConcentration(concentrationScore, 'reviewer', topReviewerCount)} of ${totalReviews} reviews across ${totalPRs} PRs, exceeding the ${targetConcentration}% balanced target by ${formatDelta(deltaPct)}.`;
    whyItMatters = `When a few reviewers handle most PRs, delivery stops when they're unavailable. Org-wide GitHub signal · Add workflow tagging to identify which IDEs or tools contribute most to reviewer load.`;
    recommendation = deltaPct > 30
      ? 'Reviewer saturation creates delivery dependencies. Implement release coordination to reduce merge contention. Use workflow tagging to identify bottlenecks by IDE.'
      : 'Track reviewer distribution. If concentration increases, establish approval latency guidelines. Use workflow tagging to compare reviewer load by IDE.';
  }

  // ============================================================
  // Dynamic title based on actual concentration level - use org-wide baseline language
  const dynamicTitle = concentrationScore > 60
    ? `Top reviewer load is ${formatConcentration(concentrationScore, 'reviewer', topReviewerCount)}%; workflow attribution is missing`
    : concentrationScore > 40
    ? `Reviewer load is measurable; IDE attribution is missing`
    : 'Reviewer load is measurable; workflow attribution is missing';

  // ============================================================
  // NARRATIVE ENHANCEMENT
  // ============================================================
  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: dynamicTitle, // Use dynamic title instead of hardcoded registry title
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'trend',
    current: concentrationScore,
    baseline: targetConcentration,
    delta,
    deltaPct,
    rightMetric: formatConcentration(concentrationScore, 'reviewer', topReviewerCount),
    rightMetricLabel: 'Review Load Concentration',
    metricDefinition: 'Percentage of reviews handled by top reviewers, measuring reviewer distribution balance',
    operationalBreadcrumbs: [
      `${uniqueReviewers} unique reviewers`,
      `Top ${topReviewerCount} handle ${formatConcentration(concentrationScore, 'reviewer', topReviewerCount)}`,
      `${totalReviews} total reviews`,
      `${totalPRs} total PRs`,
      `Target: ${targetConcentration}% balanced`
    ],
    confidence,
    coveragePct,
    n: totalReviews,
    hasData: true,
    // Data source classification
    dataDomain: hasLiveData ? 'github_review' : 'telemetry',
    sourceLabel: hasLiveData ? 'GitHub review' : 'Telemetry',
    sampleUnit: 'reviews',
    sampleLabel: `${totalReviews.toLocaleString()} reviews`,
    attributionStatus: hasLiveData ? 'org_level_only' : 'ide_attributed',
    comparisonStatus: hasLiveData ? 'org_baseline_only' : 'available',
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: hasLiveData
      ? `Analysis of ${totalReviews} reviews across ${totalPRs} PRs with ${uniqueReviewers} unique reviewers. Top ${topReviewerCount} handle ${formatConcentration(concentrationScore, 'reviewer', topReviewerCount)}. Data source: ${dataSourceLabel}. Coverage: ${coveragePct}%.`
      : `Analysis of ${totalReviews} reviews across ${totalPRs} PRs with ${uniqueReviewers} unique reviewers. Top ${topReviewerCount} reviewers handle ${Number(concentrationScore).toFixed(1)} of review load, exceeding the ${targetConcentration} balanced target by ${formatDelta(deltaPct)}. Coverage: ${coveragePct}%. No GitHub review metrics available.`,
    operationalImpact: hasLiveData
      ? `${Number(concentrationScore).toFixed(1)}% concentration creates reviewer dependencies that may slow delivery.`
      : `${Number(concentrationScore).toFixed(1)}% concentration creates reviewer dependencies that may slow delivery.`,
    primaryRisk: 'Reviewer concentration creates delivery bottlenecks when top reviewers are unavailable.',
    cohort: 'Workflow Intelligence',
    confidenceReasoning: hasLiveData
      ? `${confidence} confidence based on ${totalReviews} reviews with ${coveragePct}% data coverage. Maturity: Emerging downstream signal - needs more PR history.`
      : 'Low confidence based on limited reviewer attribution data and small sample size for concentration analysis. Maturity: Emerging downstream signal - needs more PR history.',
    recommendationState: deltaPct > 30 ? 'action_required' : 'monitor_only',
    urgencyLabel: deltaPct > 30 ? 'action_required' : 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/reviewMerge.ts',
    featureFlagState: true,
    evidence: hasLiveData
      ? [
          { metric: 'Top 3 Load', value: formatConcentration(concentrationScore, 'reviewer', topReviewerCount), label: 'Concentration' },
          { metric: 'Target', value: `${targetConcentration}%`, label: 'Balanced target' },
          { metric: 'Delta', value: formatDelta(deltaPct), label: 'Above/below' },
          { metric: 'Unique Reviewers', value: uniqueReviewers.toString(), label: 'Total' },
          { metric: 'Reviews', value: totalReviews.toString(), label: 'Evidence base' }
        ]
      : [
          { metric: 'Top 3 Load', value: formatConcentration(concentrationScore, 'reviewer', topReviewerCount), label: 'review load concentration' },
          { metric: 'Balanced Target', value: `${targetConcentration}% balanced`, label: 'healthy distribution' },
          { metric: 'Concentration Elevation', value: formatDelta(deltaPct), label: 'above balanced target' },
          { metric: 'Unique Reviewers', value: uniqueReviewers.toString(), label: 'total reviewer pool' },
          { metric: 'Reviews', value: totalReviews.toString(), label: 'Evidence base' }
        ],
    breakdownByTool: hasLiveData
      ? {
          cursor: { value: cursorConcentration, count: Math.floor(totalReviews * 0.33), formatted: `${cursorConcentration}%`, label: getCanonicalWorkflowIdentity('cursor') },
          windsurf: { value: windsurfConcentration, count: Math.floor(totalReviews * 0.33), formatted: `${windsurfConcentration}%`, label: getCanonicalWorkflowIdentity('windsurf') },
          vscode: { value: vscodeConcentration, count: Math.floor(totalReviews * 0.34), formatted: `${vscodeConcentration}%`, label: getCanonicalWorkflowIdentity('vscode') }
        }
      : {
          cursor: { value: cursorConcentration, count: Math.floor(totalReviews * 0.30), formatted: `${cursorConcentration}% review load`, label: `${getCanonicalWorkflowIdentity('cursor')} (lowest risk)` },
          windsurf: { value: windsurfConcentration, count: Math.floor(totalReviews * 0.25), formatted: `${windsurfConcentration}% review load`, label: `${getCanonicalWorkflowIdentity('windsurf')} (highest risk)` },
          vscode: { value: vscodeConcentration, count: Math.floor(totalReviews * 0.45), formatted: `${vscodeConcentration}% review load`, label: `${getCanonicalWorkflowIdentity('vscode')} (baseline)` }
        },
    operationalRead: hasLiveData
      ? `Concentration: ${formatConcentration(concentrationScore, 'reviewer', topReviewerCount)} vs target ${targetConcentration}% (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'}).`
      : `${getCanonicalWorkflowIdentity('windsurf')}: ${windsurfConcentration}% concentration (highest - bottleneck risk). ${getCanonicalWorkflowIdentity('cursor')}: ${cursorConcentration}% concentration (lowest risk). ${getCanonicalWorkflowIdentity('vscode')}: ${vscodeConcentration}% concentration. ${getCanonicalWorkflowIdentity('windsurf')}'s concentration creates reviewer dependencies. If top 3 exceed 75% load, implement rotation.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    demoFlag: hasLiveData ? undefined : 'demo_primary',
    demoNarrativePriority: hasLiveData ? undefined : 80
  };

  return baseInsight;
}

/**
 * Generate revert rate by IDE PI
 * 
 * MIGRATED LOGIC FROM computeV2PerformanceInsights.ts:
 * - Compute revert rate by IDE
 * - Use GitHub commit data and session IDE attribution
 * - Calculate revert rate vs baseline
 * - Add evidence with sample sizes, confidence, time window
 * - Add recommendations for code stability
 * 
 * Uses seeded demo data as production-grade evidence for demo mode.
 * Preserves high-signal V2 copy patterns for executive narratives.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateRevertRateByIDE(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('revert-rate-by-ide');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubByPeriod = input.githubByPeriod || {};
  const hasLiveData = githubByPeriod.revert_metrics && Object.keys(githubByPeriod.revert_metrics).length > 0;

  // TEMPORARY RUNTIME PROOF LOGGING
  piDebugLog('[RUNTIME_PROOF][revert-rate-by-ide]', {
    insightId: 'revert-rate-by-ide',
    stage: 'review-merge',
    hasLiveData,
    seededFallbackUsed: !hasLiveData,
    githubByPeriodKeys: Object.keys(githubByPeriod),
    revertMetricsKeys: githubByPeriod.revert_metrics ? Object.keys(githubByPeriod.revert_metrics) : [],
    revertMetricsValue: githubByPeriod.revert_metrics,
    sessionRowsCount: totalSessions
  });

  let cursorRevertRate = 0;
  let windsurfRevertRate = 0;
  let vscodeRevertRate = 0;
  let avgRevertRate = 0;
  let baselineRevertRate = 5.0;
  let totalCommits = 0;
  let revertedCommits = 0;

  if (hasLiveData) {
    // Compute from live GitHub revert metrics data
    const revertMetrics = githubByPeriod.revert_metrics;
    totalCommits = revertMetrics.total_commits || 0;
    revertedCommits = revertMetrics.reverted_commits || 0;
    avgRevertRate = totalCommits > 0 ? (revertedCommits / totalCommits) * 100 : 0;

    // Try to get IDE-specific revert rates if available
    if (revertMetrics.by_ide) {
      cursorRevertRate = revertMetrics.by_ide.cursor?.revert_rate || 0;
      windsurfRevertRate = revertMetrics.by_ide.windsurf?.revert_rate || 0;
      vscodeRevertRate = revertMetrics.by_ide.vscode?.revert_rate || 0;
    } else {
      // Fallback to average if no IDE breakdown
      cursorRevertRate = avgRevertRate;
      windsurfRevertRate = avgRevertRate;
      vscodeRevertRate = avgRevertRate;
    }
  } else {
    // Fallback to seeded demo values
    cursorRevertRate = 2.4;
    windsurfRevertRate = 4.5;
    vscodeRevertRate = 3.1;
    avgRevertRate = (cursorRevertRate + windsurfRevertRate + vscodeRevertRate) / 3;
    // 18B.6: dead path (generator disabled) — keep honest counts, no fabricated samples.
    totalCommits = 0;
    revertedCommits = 0;
  }

  const delta = baselineRevertRate - avgRevertRate; // Lower is better
  const deltaPct = baselineRevertRate > 0 ? ((baselineRevertRate - avgRevertRate) / baselineRevertRate) * 100 : 0;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalCommits >= 100 ? 'high' : totalCommits >= 50 ? 'medium' : 'low';
  const coveragePct = hasLiveData ? 100 : 82;

  // Generate narrative based on data source
  let description: string;
  let whatChanged: string;
  let whyItMatters: string;
  let recommendation: string;

  if (hasLiveData) {
    description = `Average revert rate of ${formatPct(avgRevertRate)} is ${deltaPct > 0 ? formatDelta(deltaPct) + ' below' : formatDelta(Math.abs(deltaPct)) + ' above'} the ${formatPct(baselineRevertRate)} threshold. ${revertedCommits} of ${totalCommits} commits were reverted. Reverts indicate production incidents and wasted engineering effort.`;
    whatChanged = `Revert rate is ${formatPct(avgRevertRate)} (${revertedCommits}/${totalCommits} commits), ${deltaPct > 0 ? formatDelta(deltaPct) + ' below' : formatDelta(Math.abs(deltaPct)) + ' above'} baseline.`;
    whyItMatters = 'Reverts indicate production incidents and wasted engineering effort.';
    recommendation = avgRevertRate > 4.0
      ? 'Revert rate is elevated. Investigate integration testing gaps and consider test coverage validation.'
      : 'Monitor revert rate correlation with AI adoption patterns.';
  } else {
    description = `${getCanonicalWorkflowIdentity('windsurf')}: ${formatPct(windsurfRevertRate)} revert rate (highest among models, observed period) vs ${getCanonicalWorkflowIdentity('cursor')}: ${formatPct(cursorRevertRate)} (${formatDelta(((windsurfRevertRate - cursorRevertRate) / cursorRevertRate) * 100)} difference, most stable). Average revert rate of ${formatPct(avgRevertRate)} is below the ${formatPct(baselineRevertRate)} threshold, but ${getCanonicalWorkflowIdentity('windsurf')} elevated rate indicates post-deployment operational strain requiring rollback after deployment.`;
    whatChanged = `${getCanonicalWorkflowIdentity('windsurf')}: ${formatPct(windsurfRevertRate)} revert rate (highest) vs ${getCanonicalWorkflowIdentity('cursor')}: ${formatPct(cursorRevertRate)} (${formatDelta(((windsurfRevertRate - cursorRevertRate) / cursorRevertRate) * 100)} difference). ${getCanonicalWorkflowIdentity('vscode')}: ${formatPct(vscodeRevertRate)}.`;
    whyItMatters = `Reverts indicate production incidents and wasted engineering effort.`;
    recommendation = windsurfRevertRate > 4.0
      ? `${getCanonicalWorkflowIdentity('windsurf')} revert rate indicates AI workflow issues. If revert rate remains elevated, investigate whether AI-generated code encounters integration testing gaps and consider test coverage validation.`
      : `Monitor ${getCanonicalWorkflowIdentity('windsurf')} revert rate correlation with AI adoption patterns. If revert rate increases as AI adoption grows, the correlation indicates AI integration testing gaps may warrant attention.`;
  }

  // ============================================================
  // NARRATIVE ENHANCEMENT
  // ============================================================
  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: registryEntry.title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'threshold',
    comparisonMode: 'threshold_vs_actual',
    current: avgRevertRate,
    baseline: baselineRevertRate,
    delta: -delta,
    deltaPct: -deltaPct,
    rightMetric: formatPct(avgRevertRate) + ' revert rate',
    rightMetricLabel: 'Revert Rate',
    metricDefinition: 'Percentage of commits that were reverted, measuring code stability',
    operationalBreadcrumbs: [
      `${revertedCommits} commits reverted`,
      `${totalCommits} total commits`,
      `Baseline: ${formatPct(baselineRevertRate)}`
    ],
    confidence,
    coveragePct,
    n: totalCommits,
    hasData: true,
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: hasLiveData
      ? `Analysis of ${totalCommits} commits with ${revertedCommits} reverts (${formatPct(avgRevertRate)} average revert rate). Coverage: ${coveragePct}%.`
      : `Analysis of ${totalCommits} commits with ${revertedCommits} reverts (${formatPct(avgRevertRate)} average revert rate). Coverage: ${coveragePct}%. No GitHub review metrics available.`,
    operationalImpact: hasLiveData
      ? `${revertedCommits} commits reverted represent wasted engineering effort and potential production incidents.`
      : `${revertedCommits} commits reverted represent wasted engineering effort and potential production incidents.`,
    primaryRisk: 'Elevated revert rates indicate production incidents and wasted engineering effort.',
    cohort: 'Quality Signal',
    confidenceReasoning: hasLiveData
      ? `${confidence} confidence based on ${totalCommits} commits with ${coveragePct}% data coverage.`
      : 'High confidence based on production-grade demo evidence with sufficient commit coverage and clear revert rate signal below threshold.',
    recommendationState: avgRevertRate > 4.0 ? 'action_required' : 'monitor_only',
    urgencyLabel: avgRevertRate > 4.0 ? 'action_required' : 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/reviewMerge.ts',
    featureFlagState: true,
    evidence: hasLiveData
      ? [
          { metric: 'Revert Rate', value: formatPct(avgRevertRate), label: 'Current' },
          { metric: 'Baseline', value: formatPct(baselineRevertRate), label: 'Target' },
          { metric: 'Delta', value: formatDelta(deltaPct), label: 'Above/below' },
          { metric: 'Reverted', value: revertedCommits.toString(), label: 'Commits' },
          { metric: 'Total', value: totalCommits.toString(), label: 'Commits' }
        ]
      : [
          { metric: 'Average Revert Rate', value: formatPct(avgRevertRate), label: 'overall stability' },
          { metric: getCanonicalWorkflowIdentity('cursor'), value: formatPct(cursorRevertRate), label: 'revert rate (stable)' },
          { metric: getCanonicalWorkflowIdentity('windsurf'), value: formatPct(windsurfRevertRate), label: 'revert rate (elevated)' },
          { metric: getCanonicalWorkflowIdentity('vscode'), value: formatPct(vscodeRevertRate), label: 'revert rate (baseline)' },
          { metric: 'Quality Baseline', value: formatPct(baselineRevertRate), label: 'target threshold' }
        ],
    breakdownByTool: hasLiveData
      ? {
          cursor: { value: cursorRevertRate, count: Math.floor(totalCommits * 0.33), formatted: formatPct(cursorRevertRate), label: getCanonicalWorkflowIdentity('cursor') },
          windsurf: { value: windsurfRevertRate, count: Math.floor(totalCommits * 0.33), formatted: formatPct(windsurfRevertRate), label: getCanonicalWorkflowIdentity('windsurf') },
          vscode: { value: vscodeRevertRate, count: Math.floor(totalCommits * 0.34), formatted: formatPct(vscodeRevertRate), label: getCanonicalWorkflowIdentity('vscode') }
        }
      : {
          cursor: { value: cursorRevertRate, count: Math.floor(totalCommits * 0.35), formatted: `${formatPct(cursorRevertRate)} revert rate`, label: `${getCanonicalWorkflowIdentity('cursor')} (stable)` },
          windsurf: { value: windsurfRevertRate, count: Math.floor(totalCommits * 0.25), formatted: `${formatPct(windsurfRevertRate)} revert rate`, label: `${getCanonicalWorkflowIdentity('windsurf')} (elevated)` },
          vscode: { value: vscodeRevertRate, count: Math.floor(totalCommits * 0.40), formatted: `${formatPct(vscodeRevertRate)} revert rate`, label: `${getCanonicalWorkflowIdentity('vscode')} (baseline)` }
        },
    operationalRead: hasLiveData
      ? `Revert rate: ${formatPct(avgRevertRate)} vs baseline ${formatPct(baselineRevertRate)} (${deltaPct > 0 ? formatDelta(deltaPct) + ' below' : formatDelta(Math.abs(deltaPct)) + ' above'}).`
      : `${getCanonicalWorkflowIdentity('windsurf')}: ${formatPct(windsurfRevertRate)} revert rate (highest - AI workflow strain). ${getCanonicalWorkflowIdentity('cursor')}: ${formatPct(cursorRevertRate)} revert rate (most stable). ${getCanonicalWorkflowIdentity('vscode')}: ${formatPct(vscodeRevertRate)} revert rate. ${getCanonicalWorkflowIdentity('windsurf')}'s elevated revert rate means AI workflows produce less stable code. Monitor integration testing.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    demoFlag: hasLiveData ? undefined : 'demo_primary',
    demoNarrativePriority: hasLiveData ? undefined : 80
  };

  return baseInsight;
}

/**
 * Generate executive AI reopen pressure risk PI
 * 
 * MIGRATED LOGIC FROM computeV2PerformanceInsights.ts:
 * - Executive finding for AI-related reopen pressure risk
 * - Synthesize from multiple Review & Merge PIs
 * - Calculate AI impact on code quality
 * - Add rich evidence with supporting metrics
 * - Add executive summary and actionable recommendations
 * 
 * Uses seeded demo data as production-grade evidence for demo mode.
 * Preserves high-signal V2 copy patterns for executive narratives.
 * This is the canonical executive narrative for reopen pressure risk family.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateExecutiveAIReopenPressureRisk(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('executive-ai-reopen-pressure-risk');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};
  const prAnalytics = githubSnapshot.pr_analytics || {};
  const totalPRsFromApi = prAnalytics.total_prs || 0;
  // CR5 P0.5: Provenance gate — fixture_fallback returns pr_analytics with
  // keys present but zero values.
  const hasLiveData = hasAuthoritativeGithubEvidence(githubSnapshot, totalPRsFromApi);

  // TEMPORARY RUNTIME PROOF LOGGING
  piDebugLog('[RUNTIME_PROOF][executive-ai-reopen-pressure-risk]', {
    insightId: 'executive-ai-reopen-pressure-risk',
    stage: 'review-merge',
    hasLiveData,
    provenanceState: getGithubProvenanceState(githubSnapshot, totalPRsFromApi),
    seededFallbackUsed: !hasLiveData,
    githubSnapshotKeys: Object.keys(githubSnapshot),
    prAnalyticsKeys: Object.keys(prAnalytics),
    prAnalyticsValue: prAnalytics,
    sessionRowsCount: totalSessions
  });

  let aiReopenRate = 0;
  let nonAiReopenRate = 0;
  let aiRevertRate = 0;
  let nonAiRevertRate = 0;
  let overallRiskScore = 0;
  let riskElevation = 0;
  let cursorAIRisk = 0;
  let windsurfAIRisk = 0;
  let vscodeAIRisk = 0;

  if (hasLiveData) {
    // Compute from live GitHub PR analytics data
    const prAnalytics = githubSnapshot.pr_analytics;
    aiReopenRate = prAnalytics.ai_reopen_rate || 0;
    nonAiReopenRate = prAnalytics.non_ai_reopen_rate || 0;
    aiRevertRate = prAnalytics.ai_revert_rate || 0;
    nonAiRevertRate = prAnalytics.non_ai_revert_rate || 0;

    // Calculate composite risk score
    riskElevation = nonAiReopenRate > 0 ? ((aiReopenRate - nonAiReopenRate) / nonAiReopenRate) * 100 : 0;
    overallRiskScore = 50 + (riskElevation * 0.5); // Base 50 + elevation factor

    // Try to get IDE-specific risk scores if available
    if (prAnalytics.ai_risk_by_ide) {
      cursorAIRisk = prAnalytics.ai_risk_by_ide.cursor || overallRiskScore;
      windsurfAIRisk = prAnalytics.ai_risk_by_ide.windsurf || overallRiskScore;
      vscodeAIRisk = prAnalytics.ai_risk_by_ide.vscode || overallRiskScore;
    } else {
      cursorAIRisk = overallRiskScore;
      windsurfAIRisk = overallRiskScore;
      vscodeAIRisk = overallRiskScore;
    }
  } else {
    // Fallback to seeded demo values
    aiReopenRate = 11.2;
    nonAiReopenRate = 6.8;
    aiRevertRate = 4.8;
    nonAiRevertRate = 2.9;
    overallRiskScore = 72;
    riskElevation = ((aiReopenRate - nonAiReopenRate) / nonAiReopenRate) * 100;
    cursorAIRisk = 68;
    windsurfAIRisk = 85;
    vscodeAIRisk = 72;
  }

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : totalSessions >= 20 ? 'medium' : 'low';
  const coveragePct = hasLiveData ? 100 : 100;

  // Generate narrative based on data source
  let description: string;
  let whatChanged: string;
  let whyItMatters: string;
  let recommendation: string;

  if (hasLiveData) {
    description = `AI-assisted workflows exhibit ${formatDelta(riskElevation)} higher reopen pressure than Non-AI-assisted workflows (${formatPct(aiReopenRate)} vs ${formatPct(nonAiReopenRate)}). AI revert rate of ${formatPct(aiRevertRate)} also exceeds non-AI baseline of ${formatPct(nonAiRevertRate)}. Overall quality risk score: ${overallRiskScore}/100.`;
    whatChanged = `AI reopen rate: ${formatPct(aiReopenRate)} vs Non-AI-assisted: ${formatPct(nonAiReopenRate)} (${formatDelta(riskElevation)}). AI revert rate: ${formatPct(aiRevertRate)} vs Non-AI-assisted: ${formatPct(nonAiRevertRate)}.`;
    whyItMatters = 'Fast AI workflows create more rework when they skip validation.';
    recommendation = riskElevation > 40
      ? 'AI reopen pressure correlates with reviewer time-in-code compression. Investigate whether AI PRs have lower reviewer time-in-code and consider review depth guidelines.'
      : 'Set up automated AI review depth alerts when reviewer time-in-code drops below 10 minutes per PR. Implement review depth guidelines for AI-generated code.';
  } else {
    description = `AI-assisted workflows exhibit ${formatDelta(riskElevation)} higher reopen pressure than Non-AI-assisted workflows, creating downstream rework costs that may offset velocity gains. ${getCanonicalWorkflowIdentity('windsurf')} workflows show highest risk exposure (${windsurfAIRisk}/100), indicating potential review depth compression in AI-generated code. Strategic concern: AI workflow net value could become negative if rework costs exceed productivity gains.`;
    whatChanged = `${getCanonicalWorkflowIdentity('cursor')} and ${getCanonicalWorkflowIdentity('windsurf')} PRs demonstrated ${formatPct(aiReopenRate)} reopen rate vs ${formatPct(nonAiReopenRate)} for ${getCanonicalWorkflowIdentity('vscode')} Non-AI-assisted PRs (${formatDelta(riskElevation)}). AI revert rate of ${formatPct(aiRevertRate)} also exceeded non-AI baseline of ${formatPct(nonAiRevertRate)}. ${getCanonicalWorkflowIdentity('windsurf')} AI workflows accumulated highest risk.`;
    whyItMatters = `Fast AI workflows create more rework when they skip validation.`;
    recommendation = riskElevation > 40
      ? 'AI reopen pressure correlates with reviewer time-in-code compression. If AI reopen pressure remains elevated, investigate whether AI PRs have lower reviewer time-in-code and consider review depth guidelines.'
      : 'Configure automated AI review depth alerts when reviewer time-in-code drops below 10 minutes per PR. Implement review depth guidelines if reopen pressure increases.';
  }

  // ============================================================
  // NARRATIVE ENHANCEMENT
  // ============================================================
  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: registryEntry.title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'synthesized',
    comparisonMode: 'absolute',
    current: overallRiskScore,
    baseline: 50,
    delta: overallRiskScore - 50,
    deltaPct: ((overallRiskScore - 50) / 50) * 100,
    rightMetric: formatPct(aiReopenRate) + ' reopen rate',
    rightMetricLabel: 'AI Reopen Rate',
    metricDefinition: 'Composite quality risk score from AI-assisted vs traditional workflow reopen and revert rates',
    operationalBreadcrumbs: [
      `AI reopen rate: ${formatPct(aiReopenRate)}`,
      `Traditional reopen rate: ${formatPct(nonAiReopenRate)}`,
      `Risk elevation: ${formatDelta(riskElevation)}`,
      `Overall risk score: ${overallRiskScore}/100`
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: hasLiveData
      ? `Synthesis of ${totalSessions} development sessions. AI reopen rate: ${formatPct(aiReopenRate)} vs traditional: ${formatPct(nonAiReopenRate)}. AI revert rate: ${formatPct(aiRevertRate)} vs traditional: ${formatPct(nonAiRevertRate)}. Overall risk score: ${overallRiskScore}/100. Coverage: ${coveragePct}%.`
      : `Synthesis of ${totalSessions} development sessions. AI-assisted workflows demonstrated ${formatPct(aiReopenRate)} reopen rate versus ${formatPct(nonAiReopenRate)} for traditional workflows, and ${formatPct(aiRevertRate)} revert rate versus ${formatPct(nonAiRevertRate)}. Overall quality risk score: ${overallRiskScore}/100. Coverage: ${coveragePct}%. No GitHub review metrics available.`,
    operationalImpact: hasLiveData
      ? `AI workflows create additional rework cycles that may offset velocity gains.`
      : `AI workflows create additional rework cycles that may offset velocity gains.`,
    primaryRisk: 'AI-assisted workflows may create downstream rework costs that offset velocity gains.',
    cohort: 'Executive Finding',
    confidenceReasoning: hasLiveData
      ? `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% data coverage.`
      : 'Medium confidence based on synthesized risk score combining reopen rate and revert rate metrics. While directional signals are consistent, the risk score is an inferred composite rather than direct measurement.',
    recommendationState: riskElevation > 40 ? 'action_required' : 'monitor_only',
    urgencyLabel: riskElevation > 40 ? 'action_required' : 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/reviewMerge.ts',
    featureFlagState: true,
    evidence: hasLiveData
      ? [
          { metric: 'AI Reopen Rate', value: formatPct(aiReopenRate), label: 'AI' },
          { metric: 'Traditional Reopen Rate', value: formatPct(nonAiReopenRate), label: 'Baseline' },
          { metric: 'Elevation', value: formatDelta(riskElevation), label: 'Gap' },
          { metric: 'AI Revert Rate', value: formatPct(aiRevertRate), label: 'AI' },
          { metric: 'Traditional Revert Rate', value: formatPct(nonAiRevertRate), label: 'Baseline' }
        ]
      : [
          { metric: 'AI Reopen Rate', value: formatPct(aiReopenRate), label: 'AI quality' },
          { metric: 'Traditional Reopen Rate', value: formatPct(nonAiReopenRate), label: 'baseline quality' },
          { metric: 'Reopen Elevation', value: formatDelta(riskElevation), label: 'AI quality gap' },
          { metric: 'AI Revert Rate', value: formatPct(aiRevertRate), label: 'AI stability' },
          { metric: 'Traditional Revert Rate', value: formatPct(nonAiRevertRate), label: 'baseline stability' }
        ],
    breakdownByTool: hasLiveData
      ? {
          cursor: { value: cursorAIRisk, count: 0, formatted: `${cursorAIRisk}/100`, label: getCanonicalWorkflowIdentity('cursor') },
          windsurf: { value: windsurfAIRisk, count: 0, formatted: `${windsurfAIRisk}/100`, label: getCanonicalWorkflowIdentity('windsurf') },
          vscode: { value: vscodeAIRisk, count: 0, formatted: `${vscodeAIRisk}/100`, label: getCanonicalWorkflowIdentity('vscode') }
        }
      : {
          cursor: { value: cursorAIRisk, count: 0, formatted: `${cursorAIRisk}/100 risk score`, label: `${getCanonicalWorkflowIdentity('cursor')} (stable)` },
          windsurf: { value: windsurfAIRisk, count: 0, formatted: `${windsurfAIRisk}/100 risk score`, label: `${getCanonicalWorkflowIdentity('windsurf')} (highest risk)` },
          vscode: { value: vscodeAIRisk, count: 0, formatted: `${vscodeAIRisk}/100 risk score`, label: `${getCanonicalWorkflowIdentity('vscode')} (baseline)` }
        },
    operationalRead: hasLiveData
      ? `AI reopen rate: ${formatPct(aiReopenRate)} vs traditional: ${formatPct(nonAiReopenRate)} (${formatDelta(riskElevation)} higher). Risk score: ${overallRiskScore}/100.`
      : `AI: ${formatPct(aiReopenRate)} reopen rate vs traditional: ${formatPct(nonAiReopenRate)} (${formatDelta(riskElevation)} higher). ${getCanonicalWorkflowIdentity('windsurf')} AI: ${windsurfAIRisk}/100 risk score (highest). ${getCanonicalWorkflowIdentity('cursor')} AI: ${cursorAIRisk}/100 (most stable). ${getCanonicalWorkflowIdentity('vscode')} AI: ${vscodeAIRisk}/100. AI review depth constraints observed.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    demoFlag: hasLiveData ? undefined : 'demo_primary',
    demoNarrativePriority: hasLiveData ? undefined : 90,
    dataSource: hasLiveData ? 'live' : 'seeded'
  };

  return baseInsight;
}

/**
 * Generate executive small PR workflow optimization PI
 * 
 * MIGRATED LOGIC FROM computeV2PerformanceInsights.ts:
 * - Executive finding for small PR workflow optimization
 * - Synthesize from multiple Review & Merge PIs
 * - Calculate impact of small PR workflow on velocity
 * - Add rich evidence with supporting metrics
 * - Add executive summary and actionable recommendations
 * 
 * Uses seeded demo data as production-grade evidence for demo mode.
 * Preserves high-signal V2 copy patterns for executive narratives.
 * This is the canonical executive narrative for small PR workflow family.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateExecutiveSmallPRWorkflowOptimization(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('executive-small-pr-workflow-optimization');
  if (!registryEntry) return null;

  const githubSnapshot = input.githubSnapshot || {};
  const prAnalytics = githubSnapshot.pr_analytics || {};
  const totalPRsFromApi = prAnalytics.total_prs || githubSnapshot.total_pull_requests || 0;
  // CR5 P0.5: Provenance gate — fixture_fallback returns pr_analytics with
  // keys present but zero values. Require authoritative provenance.
  const hasPRAnalytics = hasAuthoritativeGithubEvidence(githubSnapshot, totalPRsFromApi);
  const hasReviewMetrics = githubSnapshot.pr_review_metrics && githubSnapshot.pr_review_metrics.total_prs > 0;
  const hasLiveData = hasPRAnalytics || hasReviewMetrics;

  // Require live data - no seeded fallbacks for review cards
  if (!hasLiveData) {
    piDebugLog('[GENERATOR_EXECUTIVE_SMALL_PR_WORKFLOW][NO_LIVE_DATA]', 'Review card requires GitHub data');
    return null;
  }

  // CR5 FINAL DOWNSTREAM — PR size vs merge cycle finding.
  // Consumes the real pr_size_merge_cycle block from the backend (computed
  // from actual additions+deletions and created_at→merged_at on merged PRs).
  // Falls back to the legacy small-PR-rate logic only when the
  // pr_size_merge_cycle block is absent.
  const prSizeMergeCycle = prAnalytics.pr_size_merge_cycle;

  // CR-X 18B: The surviving pr_size_merge_cycle path must satisfy the shared
  // comparison-sample doctrine (MIN_SAMPLES_FOR_COMPARISON in each cohort).
  const hasAdequateCohorts = prSizeMergeCycle
    && prSizeMergeCycle.small_n >= MIN_SAMPLES_FOR_COMPARISON
    && prSizeMergeCycle.large_n >= MIN_SAMPLES_FOR_COMPARISON
    && prSizeMergeCycle.ratio;

  // If the new block is present and has both small and large samples, use it
  if (hasAdequateCohorts) {
    const smallN = prSizeMergeCycle.small_n;
    const largeN = prSizeMergeCycle.large_n;
    const smallMedian = prSizeMergeCycle.small_median_hours;
    const largeMedian = prSizeMergeCycle.large_median_hours;
    const ratio = prSizeMergeCycle.ratio;
    const mergedTotal = prSizeMergeCycle.merged_total;

    piDebugLog('[RUNTIME_PROOF][executive-small-pr-workflow-optimization]', {
      insightId: 'executive-small-pr-workflow-optimization',
      stage: 'review-merge',
      hasLiveData,
      dataSource: 'pr_size_merge_cycle',
      smallN, largeN, smallMedian, largeMedian, ratio, mergedTotal
    });

    // Format the ratio for the title (e.g. 5.67 -> "5.7×")
    const ratioFormatted = ratio >= 10 ? `${Math.round(ratio)}×` : `${ratio.toFixed(1)}×`;

    // Confidence based on merged sample size
    const confidence: ConfidenceLevel = mergedTotal >= 50 ? 'high' : mergedTotal >= 20 ? 'medium' : 'low';
    const coveragePct = 100;

    const title = `Large PRs take ${ratioFormatted} longer to merge`;
    const description = `Larger changes are associated with substantially longer merge cycles in this GitHub dataset. Review whether PR size, change complexity, or review coordination is driving the gap.`;
    const whatChanged = `${largeMedian}h vs ${smallMedian}h median merge cycle · ${mergedTotal} merged PRs`;
    const whyItMatters = `Larger changes are associated with substantially longer merge cycles in this GitHub dataset. Review whether PR size, change complexity, or review coordination is driving the gap.`;
    const recommendation = `Compare review depth and change complexity across large and small PRs. Consider smaller change sets where the work can be split without increasing coordination cost.`;

    const baseInsight: CanonicalInsight = {
      id: registryEntry.id,
      title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'comparison',
      presentationKind: 'downstream_comparison',
      comparisonMode: 'cohort_vs_cohort',
      comparisonState: 'org_level_only',
      current: largeMedian,
      baseline: smallMedian,
      delta: largeMedian - smallMedian,
      deltaPct: ((largeMedian - smallMedian) / smallMedian) * 100,
      rightMetric: `${ratioFormatted} longer`,
      rightMetricLabel: 'Merge Cycle Ratio',
      metricDefinition: 'Median merge cycle time for large PRs (≥200 changes) vs small PRs (<200 changes)',
      operationalBreadcrumbs: [
        `Small PRs (<200 changes): N=${smallN}, median ${smallMedian}h`,
        `Large PRs (≥200 changes): N=${largeN}, median ${largeMedian}h`,
        `${mergedTotal} merged PRs`,
        `GitHub delivery · all-time baseline`
      ],
      confidence,
      coveragePct,
      n: mergedTotal,
      hasData: true,
      isDiagnostic: false,
      isOrgLevelMetric: true,
      description,
      whatChanged,
      whyItMatters,
      recommendation,
      evidenceAndContext: `${largeMedian}h vs ${smallMedian}h median · ${mergedTotal} merged PRs. Small PRs (<200 changes): N=${smallN}. Large PRs (≥200 changes): N=${largeN}. Ratio: ${ratioFormatted}. Coverage: ${coveragePct}%.`,
      operationalImpact: `Large PRs (≥200 changes) take ${ratioFormatted} longer to merge than small PRs (<200 changes) in this GitHub dataset.`,
      primaryRisk: 'Larger changes are associated with longer merge cycles.',
      cohort: 'Executive Finding',
      confidenceReasoning: `${confidence} confidence based on ${mergedTotal} merged PRs (${smallN} small, ${largeN} large) with ${coveragePct}% data coverage.`,
      recommendationState: 'investigate',
      urgencyLabel: 'investigate',
      engineVersion: 'FINAL_ENGINE_V1',
      generatorSource: 'final/generators/reviewMerge.ts',
      featureFlagState: true,
      evidence: [
        { metric: 'LARGE PRS', value: `${largeMedian}h median`, label: `N=${largeN} · ≥200 changed lines` },
        { metric: 'SMALL PRS', value: `${smallMedian}h median`, label: `N=${smallN} · <200 changed lines` },
        { metric: 'DIFFERENCE', value: `${ratioFormatted} longer`, label: 'Large vs small' },
        { metric: 'SAMPLE', value: `${mergedTotal} merged PRs`, label: `${prAnalytics.total_prs || '—'} PRs observed` },
      ],
      breakdownByTool: {
        large: { value: largeMedian, count: largeN, formatted: `${largeMedian}h median`, label: `Large PRs (≥200 changed lines)` },
        small: { value: smallMedian, count: smallN, formatted: `${smallMedian}h median`, label: `Small PRs (<200 changed lines)` },
      },
      operationalRead: `Large PRs: ${largeMedian}h median vs small PRs: ${smallMedian}h median (${ratioFormatted} longer). ${mergedTotal} merged PRs.`,
      isExecutiveFinding: registryEntry.isExecutiveFinding,
      dataSource: 'live',
      dataDomain: 'github_delivery',
      sourceLabel: 'GitHub delivery · all-time baseline',
    };

    return baseInsight;
  }

  // CR-X 18B: The legacy small-PR fallback used hardcoded 14.2h/28.5h cycle
  // times and could promote an optimization finding from a single PR. Without
  // authoritative, sufficient pr_size_merge_cycle evidence, this generator now
  // suppresses the finding and lets the engine surface a data gap.
  piDebugLog('[GENERATOR_EXECUTIVE_SMALL_PR_WORKFLOW][INSUFFICIENT_DATA]', {
    reason: 'pr_size_merge_cycle requires both small and large merged samples',
    hasBlock: !!prSizeMergeCycle
  });
  return null;
}

// ─── CR-X Track C: Review & Merge delivery outcomes ─────────────
// Org-level delivery evidence until L1/L2 attribution is available.
// review_count + reopen_count is REVIEW BURDEN, never "review cycles".

// ─── Period Strip helpers for org-level delivery outcomes ──────
// Builds compact chronological strips from outcomes_by_month where
// the monthly data genuinely supports multi-period values.

interface OutcomeMonthRaw {
  month: string;
  merged_pr_count: number;
  total_pr_count: number;
  count_authority: string;
  [k: string]: any;
}

function getObservedOutcomeMonthsRaw(input: CanonicalInsightInput): OutcomeMonthRaw[] {
  const raw = input.outcomesByMonth || input.githubSnapshot?.outcomes_by_month || [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((e: any) => e && e.count_authority === 'observed_rows' && typeof e.month === 'string');
}

/**
 * Build a merge-rate period strip from outcomes_by_month.
 * merge rate = merged_pr_count / total_pr_count * 100 per month.
 * Returns undefined if fewer than 2 eligible months.
 */
function buildMergeRatePeriodStrip(input: CanonicalInsightInput): PeriodStripData | undefined {
  const months = getObservedOutcomeMonthsRaw(input);
  if (months.length < 2) return undefined;

  const selected = selectRecentCompleteMonths(months, 'total_pr_count', 6);
  if (selected.length < 2) return undefined;

  const monthlyValues = selected.map(m => ({
    monthKey: m.month,
    value: (m.total_pr_count as number) > 0
      ? ((m.merged_pr_count as number) / (m.total_pr_count as number)) * 100
      : 0,
  }));

  return buildPeriodStrip(
    monthlyValues,
    (v) => `${v.toFixed(0)}%`,
    (diff) => diff > 0 ? `+${diff.toFixed(0)}pp` : `${diff.toFixed(0)}pp`,
    'Merge rate by month'
  );
}

/**
 * Build a PR-throughput period strip from outcomes_by_month.
 * throughput = total_pr_count per month (monthly volume, not weekly rate).
 * Returns undefined if fewer than 2 eligible months.
 */
function buildPrThroughputPeriodStrip(input: CanonicalInsightInput): PeriodStripData | undefined {
  const months = getObservedOutcomeMonthsRaw(input);
  if (months.length < 2) return undefined;

  const selected = selectRecentCompleteMonths(months, 'total_pr_count', 6);
  if (selected.length < 2) return undefined;

  const monthlyValues = selected.map(m => ({
    monthKey: m.month,
    value: m.total_pr_count as number,
  }));

  return buildPeriodStrip(
    monthlyValues,
    (v) => `${v}`,
    (diff) => diff > 0 ? `+${diff}` : `${diff}`,
    'PR volume by month'
  );
}

/**
 * Merge cycle time — average hours from PR creation to merge.
 * Source: github_team_metrics.time_to_merge (avg hours across merged PRs
 * with both created_at and merged_at). Lower is better.
 * Org-level only until L1/L2 attribution lands.
 */
export function generateMergeCycleTime(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('merge-cycle-time');
  if (!registryEntry) return null;

  const githubSnapshot = input.githubSnapshot || {};
  const teamMetrics = githubSnapshot.github_team_metrics || {};
  const totalDeploymentsFromApi = (githubSnapshot.deployment_metrics?.success_deployment_count || 0) + (githubSnapshot.deployment_metrics?.failed_deployment_count || 0);
  const hasLiveData = hasAuthoritativeGithubEvidence(githubSnapshot, totalDeploymentsFromApi);

  const timeToMerge = teamMetrics.time_to_merge;
  const mergedPrs = teamMetrics.merged_prs ?? githubSnapshot.merged_pull_requests ?? 0;

  if (!hasLiveData || typeof timeToMerge !== 'number' || timeToMerge <= 0 || mergedPrs <= 0) {
    piDebugLog('[GENERATOR_MERGE_CYCLE_TIME][NO_DATA]', { hasLiveData, timeToMerge, mergedPrs });
    return null;
  }

  const attribution = getDeliveryAttribution(input.sessionRows || [], githubSnapshot, input._engineCache);
  const baselineHours = 24;
  const delta = timeToMerge - baselineHours;
  const deltaPct = baselineHours > 0 ? ((timeToMerge - baselineHours) / baselineHours) * 100 : 0;
  const confidence: ConfidenceLevel = mergedPrs >= 50 ? 'high' : mergedPrs >= 20 ? 'medium' : 'low';

  const displayValue = timeToMerge >= 24
    ? formatDays(timeToMerge / 24)
    : formatHours(timeToMerge);

  return {
    id: registryEntry.id,
    title: `${displayValue} average merge cycle time across ${mergedPrs} merged PRs`,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'threshold',
    presentationKind: 'outcome_threshold',
    comparisonMode: 'threshold_vs_actual',
    comparisonState: attribution.canAttributeToWorkflow ? 'workflow_attributed' : 'org_level_only',
    attributionStatus: attribution.status,
    current: timeToMerge,
    baseline: baselineHours,
    delta,
    deltaPct,
    rightMetric: displayValue,
    rightMetricLabel: 'Avg merge cycle time',
    metricValue: timeToMerge,
    displayValue,
    displayUnit: timeToMerge >= 24 ? 'days' : 'hours',
    metricDefinition: 'Average elapsed time from PR creation to merge, in hours, across merged PRs with both timestamps.',
    polarity: 'lower_is_better',
    operationalBreadcrumbs: [`${mergedPrs} merged PRs`, `Baseline: ${formatHours(baselineHours)}`, attribution.provenanceLabel],
    confidence,
    coveragePct: 100,
    n: mergedPrs,
    hasData: true,
    dataDomain: 'github_delivery',
    sourceLabel: 'GitHub delivery',
    sampleUnit: 'merged PRs',
    sampleLabel: `${mergedPrs} merged PRs`,
    description: `Average merge cycle time is ${displayValue} across ${mergedPrs} merged PRs, ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${formatHours(baselineHours)} baseline. ${attribution.provenanceLabel}`,
    whatChanged: `Merge cycle time: ${displayValue} vs ${formatHours(baselineHours)} baseline (${formatDelta(deltaPct)} ${deltaPct > 0 ? 'above' : 'below'}).`,
    whyItMatters: 'Longer merge cycles delay feature delivery and increase the risk of integration conflicts.',
    recommendation: deltaPct > 30
      ? 'Investigate review bottlenecks and PR size. Smaller PRs and faster first reviews reduce cycle time.'
      : 'Monitor merge cycle time alongside review burden and PR throughput.',
    evidenceAndContext: `Analysis of ${mergedPrs} merged PRs. Average creation-to-merge: ${displayValue}. Baseline: ${formatHours(baselineHours)}. ${attribution.provenanceLabel}`,
    operationalImpact: `Merge cycle time of ${displayValue} affects feature delivery speed.`,
    primaryRisk: 'Long merge cycles delay delivery and increase integration conflict risk.',
    cohort: 'Velocity Signal',
    confidenceReasoning: `${confidence} confidence based on ${mergedPrs} merged PRs. ${attribution.provenanceLabel}`,
    recommendationState: deltaPct > 30 ? 'action_required' : 'monitor_only',
    urgencyLabel: deltaPct > 30 ? 'action_required' : 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/reviewMerge.ts',
    featureFlagState: true,
    evidence: [
      { metric: 'Avg merge cycle time', value: displayValue, label: 'Current' },
      { metric: 'Merged PRs', value: String(mergedPrs), label: 'Sample' },
      { metric: 'Baseline', value: formatHours(baselineHours), label: 'Target' },
      { metric: 'Attribution', value: attribution.canAttributeToWorkflow ? attribution.maxLevel : 'Org-wide', label: 'Status' },
    ],
    operationalRead: `Merge cycle time: ${displayValue} vs baseline ${formatHours(baselineHours)} (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'}).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
  };
}

/**
 * Merge rate — percentage of PRs that reach merge.
 * Source: github_team_metrics.merge_rate (or merged_prs / total_prs).
 * Higher is generally better (indicates PRs are landing).
 * Org-level only until L1/L2 attribution lands.
 */
export function generateMergeRate(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('merge-rate');
  if (!registryEntry) return null;

  const githubSnapshot = input.githubSnapshot || {};
  const teamMetrics = githubSnapshot.github_team_metrics || {};
  const totalDeploymentsFromApi = (githubSnapshot.deployment_metrics?.success_deployment_count || 0) + (githubSnapshot.deployment_metrics?.failed_deployment_count || 0);
  const hasLiveData = hasAuthoritativeGithubEvidence(githubSnapshot, totalDeploymentsFromApi);

  const totalPRs = teamMetrics.total_prs ?? githubSnapshot.total_pull_requests ?? 0;
  const mergedPRs = teamMetrics.merged_prs ?? githubSnapshot.merged_pull_requests ?? 0;

  if (!hasLiveData || totalPRs <= 0 || mergedPRs < 0) {
    piDebugLog('[GENERATOR_MERGE_RATE][NO_DATA]', { hasLiveData, totalPRs, mergedPRs });
    return null;
  }

  const attribution = getDeliveryAttribution(input.sessionRows || [], githubSnapshot, input._engineCache);
  const mergeRate = (mergedPRs / totalPRs) * 100;
  const baseline = 70;
  const delta = mergeRate - baseline;
  const deltaPct = baseline > 0 ? ((mergeRate - baseline) / baseline) * 100 : 0;
  const confidence: ConfidenceLevel = totalPRs >= 50 ? 'high' : totalPRs >= 20 ? 'medium' : 'low';

  const insight: CanonicalInsight = {
    id: registryEntry.id,
    title: `${formatPct(mergeRate)} merge rate across ${totalPRs} PRs`,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'threshold',
    presentationKind: 'outcome_threshold',
    comparisonMode: 'threshold_vs_actual',
    comparisonState: attribution.canAttributeToWorkflow ? 'workflow_attributed' : 'org_level_only',
    attributionStatus: attribution.status,
    current: mergeRate,
    baseline,
    delta,
    deltaPct,
    rightMetric: formatPct(mergeRate),
    rightMetricLabel: 'Merge rate',
    metricValue: mergeRate,
    displayValue: formatPct(mergeRate),
    displayUnit: '%',
    metricDefinition: 'Percentage of opened PRs that reach merge (merged PRs / total PRs).',
    polarity: 'higher_is_better',
    operationalBreadcrumbs: [`${mergedPRs} merged / ${totalPRs} total`, `Baseline: ${formatPct(baseline)}`, attribution.provenanceLabel],
    confidence,
    coveragePct: 100,
    n: totalPRs,
    hasData: true,
    dataDomain: 'github_delivery',
    sourceLabel: 'GitHub delivery',
    sampleUnit: 'PRs',
    sampleLabel: `${totalPRs} PRs`,
    description: `Merge rate is ${formatPct(mergeRate)} (${mergedPRs} merged of ${totalPRs} PRs), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${formatPct(baseline)} baseline. ${attribution.provenanceLabel}`,
    whatChanged: `Merge rate: ${formatPct(mergeRate)} vs ${formatPct(baseline)} baseline (${formatDelta(deltaPct)} ${deltaPct > 0 ? 'above' : 'below'}).`,
    whyItMatters: 'A low merge rate can indicate PRs stalled in review or rejected, reducing delivered throughput.',
    recommendation: delta < -10
      ? 'Review stalled PRs and reduce review burden. Track PRs open beyond a target age.'
      : 'Monitor merge rate alongside PR throughput and review burden.',
    evidenceAndContext: `Analysis of ${totalPRs} PRs. ${mergedPRs} merged (${formatPct(mergeRate)}). Baseline: ${formatPct(baseline)}. ${attribution.provenanceLabel}`,
    operationalImpact: `Merge rate of ${formatPct(mergeRate)} affects delivered throughput.`,
    primaryRisk: 'Low merge rate indicates stalled or rejected PRs, reducing delivery throughput.',
    cohort: 'Throughput Signal',
    confidenceReasoning: `${confidence} confidence based on ${totalPRs} PRs. ${attribution.provenanceLabel}`,
    recommendationState: delta < -10 ? 'action_required' : 'monitor_only',
    urgencyLabel: delta < -10 ? 'action_required' : 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/reviewMerge.ts',
    featureFlagState: true,
    evidence: [
      { metric: 'Merge rate', value: formatPct(mergeRate), label: 'Current' },
      { metric: 'Merged / total', value: `${mergedPRs} / ${totalPRs}`, label: 'Sample' },
      { metric: 'Baseline', value: formatPct(baseline), label: 'Target' },
      { metric: 'Attribution', value: attribution.canAttributeToWorkflow ? attribution.maxLevel : 'Org-wide', label: 'Status' },
    ],
    operationalRead: `Merge rate: ${formatPct(mergeRate)} vs baseline ${formatPct(baseline)} (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'}).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
  };

  (insight as any).periodStrip = buildMergeRatePeriodStrip(input);
  return insight;
}

/**
 * PR throughput — PRs opened per week over the observed window.
 * Source: github_team_metrics.total_prs over the githubByPeriod window.
 * Org-level only until L1/L2 attribution lands.
 */
export function generatePrThroughput(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('pr-throughput');
  if (!registryEntry) return null;

  const githubSnapshot = input.githubSnapshot || {};
  const teamMetrics = githubSnapshot.github_team_metrics || {};
  const totalDeploymentsFromApi = (githubSnapshot.deployment_metrics?.success_deployment_count || 0) + (githubSnapshot.deployment_metrics?.failed_deployment_count || 0);
  const hasLiveData = hasAuthoritativeGithubEvidence(githubSnapshot, totalDeploymentsFromApi);

  const totalPRs = teamMetrics.total_prs ?? githubSnapshot.total_pull_requests ?? 0;

  if (!hasLiveData || totalPRs <= 0) {
    piDebugLog('[GENERATOR_PR_THROUGHPUT][NO_DATA]', { hasLiveData, totalPRs });
    return null;
  }

  const attribution = getDeliveryAttribution(input.sessionRows || [], githubSnapshot, input._engineCache);
  const githubByPeriod = input.githubByPeriod || [];
  const weeks = githubByPeriod.length > 0 ? githubByPeriod.length : (totalPRs > 100 ? 13 : 4);
  const throughput = totalPRs / weeks;
  const baseline = 5;
  const delta = throughput - baseline;
  const deltaPct = baseline > 0 ? ((throughput - baseline) / baseline) * 100 : 0;
  const confidence: ConfidenceLevel = totalPRs >= 50 ? 'high' : totalPRs >= 20 ? 'medium' : 'low';

  const insight: CanonicalInsight = {
    id: registryEntry.id,
    title: `${formatFrequency(throughput)} PR throughput across ${totalPRs} PRs`,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'threshold',
    presentationKind: 'outcome_threshold',
    comparisonMode: 'threshold_vs_actual',
    comparisonState: attribution.canAttributeToWorkflow ? 'workflow_attributed' : 'org_level_only',
    attributionStatus: attribution.status,
    current: throughput,
    baseline,
    delta,
    deltaPct,
    rightMetric: `${totalPRs} PRs`,
    rightMetricLabel: 'PR Volume',
    metricValue: throughput,
    displayValue: formatFrequency(throughput),
    displayUnit: 'PRs/week',
    metricDefinition: 'Number of PRs opened per week over the observed delivery window.',
    polarity: 'higher_is_better',
    operationalBreadcrumbs: [`${totalPRs} PRs`, `${weeks} weeks`, attribution.provenanceLabel],
    confidence,
    coveragePct: 100,
    n: totalPRs,
    hasData: true,
    dataDomain: 'github_delivery',
    sourceLabel: 'GitHub delivery',
    sampleUnit: 'PRs',
    sampleLabel: `${totalPRs} PRs over ${weeks} weeks`,
    description: `PR throughput is ${formatFrequency(throughput)} (${totalPRs} PRs over ${weeks} weeks), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${formatFrequency(baseline)} baseline. ${attribution.provenanceLabel}`,
    whatChanged: `PR throughput: ${formatFrequency(throughput)} vs ${formatFrequency(baseline)} baseline (${formatDelta(deltaPct)} ${deltaPct > 0 ? 'above' : 'below'}).`,
    whyItMatters: 'PR throughput reflects the volume of change entering the review pipeline. Do not equate PR count with productivity — throughput is a pipeline-load signal, not a value measure.',
    recommendation: 'Inspect whether throughput aligns with planned delivery volume. Compare alongside merge rate, review burden, and change size to assess pipeline health. Do not equate PR count with productivity.',
    evidenceAndContext: `Analysis of ${totalPRs} PRs over ${weeks} weeks. Throughput: ${formatFrequency(throughput)}. Baseline: ${formatFrequency(baseline)}. ${attribution.provenanceLabel}`,
    operationalImpact: `PR throughput of ${formatFrequency(throughput)} reflects review pipeline load.`,
    primaryRisk: 'Low PR throughput may indicate stalled contribution; high throughput without merge rate can indicate review backlog.',
    cohort: 'Throughput Signal',
    confidenceReasoning: `${confidence} confidence based on ${totalPRs} PRs over ${weeks} weeks. ${attribution.provenanceLabel}`,
    recommendationState: 'monitor_only',
    urgencyLabel: 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/reviewMerge.ts',
    featureFlagState: true,
    evidence: [
      { metric: 'Throughput', value: formatFrequency(throughput), label: 'Current' },
      { metric: 'Total PRs', value: String(totalPRs), label: 'Sample' },
      { metric: 'Window', value: `${weeks} weeks`, label: 'Period' },
      { metric: 'Attribution', value: attribution.canAttributeToWorkflow ? attribution.maxLevel : 'Org-wide', label: 'Status' },
    ],
    operationalRead: `PR throughput: ${formatFrequency(throughput)} vs baseline ${formatFrequency(baseline)}.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
  };

  (insight as any).periodStrip = buildPrThroughputPeriodStrip(input);
  return insight;
}

/**
 * Review burden — aggregate review_count + pr_reopened_count per PR.
 * This is REVIEW BURDEN, NOT true review cycles/rounds. True review cycles
 * require timeline evidence (review state transitions) which is not available
 * from aggregate counts. Org-level only until L1/L2 attribution lands.
 */
export function generateReviewBurden(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('review-burden');
  if (!registryEntry) return null;

  const githubSnapshot = input.githubSnapshot || {};
  const prReviewMetrics = githubSnapshot.pr_review_metrics || {};
  const totalDeploymentsFromApi = (githubSnapshot.deployment_metrics?.success_deployment_count || 0) + (githubSnapshot.deployment_metrics?.failed_deployment_count || 0);
  const hasLiveData = hasAuthoritativeGithubEvidence(githubSnapshot, totalDeploymentsFromApi);

  const totalPRs = prReviewMetrics.total_prs ?? 0;
  const reviewCount = prReviewMetrics.review_count ?? 0;
  const reopenedCount = prReviewMetrics.pr_reopened_count ?? 0;

  if (!hasLiveData || totalPRs <= 0) {
    piDebugLog('[GENERATOR_REVIEW_BURDEN][NO_DATA]', { hasLiveData, totalPRs, reviewCount, reopenedCount });
    return null;
  }

  const attribution = getDeliveryAttribution(input.sessionRows || [], githubSnapshot, input._engineCache);
  const totalBurden = reviewCount + reopenedCount;
  const burdenPerPr = totalPRs > 0 ? totalBurden / totalPRs : 0;
  const baseline = 2;
  const delta = burdenPerPr - baseline;
  const deltaPct = baseline > 0 ? ((burdenPerPr - baseline) / baseline) * 100 : 0;
  const confidence: ConfidenceLevel = totalPRs >= 50 ? 'high' : totalPRs >= 20 ? 'medium' : 'low';

  return {
    id: registryEntry.id,
    title: `${burdenPerPr.toFixed(1)} review burden per PR across ${totalPRs} PRs`,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'threshold',
    presentationKind: 'outcome_threshold',
    comparisonMode: 'threshold_vs_actual',
    comparisonState: attribution.canAttributeToWorkflow ? 'workflow_attributed' : 'org_level_only',
    attributionStatus: attribution.status,
    current: burdenPerPr,
    baseline,
    delta,
    deltaPct,
    rightMetric: `${totalBurden} review events`,
    rightMetricLabel: 'Review Burden',
    metricValue: burdenPerPr,
    displayValue: burdenPerPr.toFixed(1),
    displayUnit: 'events/PR',
    metricDefinition: 'Aggregate review burden = (review_count + pr_reopened_count) / total PRs. This is a burden proxy, NOT true review cycles — true cycles require review state timeline evidence.',
    polarity: 'lower_is_better',
    operationalBreadcrumbs: [`${reviewCount} reviews`, `${reopenedCount} reopens`, `${totalPRs} PRs`, attribution.provenanceLabel],
    confidence,
    coveragePct: 100,
    n: totalPRs,
    hasData: true,
    dataDomain: 'github_delivery',
    sourceLabel: 'GitHub delivery',
    sampleUnit: 'PRs',
    sampleLabel: `${totalPRs} PRs`,
    description: `Review burden is ${burdenPerPr.toFixed(1)} events per PR (${reviewCount} reviews + ${reopenedCount} reopens across ${totalPRs} PRs), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${baseline} baseline. This is a burden proxy, not true review cycles. ${attribution.provenanceLabel}`,
    whatChanged: `Review burden: ${burdenPerPr.toFixed(1)} events/PR vs ${baseline} baseline (${formatDelta(deltaPct)} ${deltaPct > 0 ? 'above' : 'below'}).`,
    whyItMatters: 'Higher review burden indicates more review and reopen activity per PR, which extends delivery timelines.',
    recommendation: deltaPct > 30
      ? 'Reduce review burden via smaller PRs, clearer descriptions, and pre-review self-checks. True review cycles require timeline evidence not available here.'
      : 'Monitor review burden alongside merge cycle time. Note: aggregate counts do not prove true review cycles.',
    evidenceAndContext: `Analysis of ${totalPRs} PRs. Review burden: ${reviewCount} reviews + ${reopenedCount} reopens = ${totalBurden} events (${burdenPerPr.toFixed(1)}/PR). Baseline: ${baseline}. Burden proxy, not true review cycles. ${attribution.provenanceLabel}`,
    operationalImpact: `Review burden of ${burdenPerPr.toFixed(1)} events/PR affects delivery timelines.`,
    primaryRisk: 'High review burden extends delivery timelines. Aggregate counts do not prove true review cycles.',
    cohort: 'Quality Signal',
    confidenceReasoning: `${confidence} confidence based on ${totalPRs} PRs. Burden proxy, not true review cycles. ${attribution.provenanceLabel}`,
    recommendationState: deltaPct > 30 ? 'action_required' : 'monitor_only',
    urgencyLabel: deltaPct > 30 ? 'action_required' : 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/reviewMerge.ts',
    featureFlagState: true,
    evidence: [
      { metric: 'Review burden / PR', value: burdenPerPr.toFixed(1), label: 'Current' },
      { metric: 'Reviews + reopens', value: `${reviewCount} + ${reopenedCount}`, label: 'Components' },
      { metric: 'Total PRs', value: String(totalPRs), label: 'Sample' },
      { metric: 'Attribution', value: attribution.canAttributeToWorkflow ? attribution.maxLevel : 'Org-wide', label: 'Status' },
    ],
    operationalRead: `Review burden: ${burdenPerPr.toFixed(1)} events/PR vs baseline ${baseline} (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'}). Burden proxy, not true review cycles.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
  };
}

/**
 * Generate all Review & Merge stage canonical insights
 *
 * @param input - Canonical insight input data
 * @returns Array of canonical insights for Review & Merge stage
 */
export function generateReviewMergeInsights(input: CanonicalInsightInput): CanonicalInsight[] {
  piDebugLog('[FINAL_PI_TRACE][REVIEW_MERGE_START]', 'Generating Review & Merge insights');
  piDebugLog('[FINAL_PI_TRACE][INPUT_SESSIONS]', input.sessionRows?.length || 0);
  piDebugLog('[FINAL_PI_TRACE][INPUT_GITHUB]', !!input.githubSnapshot);

  const generators = [
    { id: 'merge-cycle-time', fn: () => generateMergeCycleTime(input) },
    { id: 'merge-rate', fn: () => generateMergeRate(input) },
    { id: 'pr-throughput', fn: () => generatePrThroughput(input) },
    { id: 'review-burden', fn: () => generateReviewBurden(input) },
    { id: 'reviewer-load-concentration', fn: () => generateReviewerLoadConcentration(input) },
    { id: 'executive-small-pr-workflow-optimization', fn: () => generateExecutiveSmallPRWorkflowOptimization(input) },
    { id: 'reopen-pressure-spike', fn: () => generateReopenPressureSpike(input) },
    { id: 'allocated-spend-per-merged-pr', fn: () => generateAllocatedSpendPerMergedPR(input, input.externalCostConfigs) },
    { id: 'allocated-spend-per-review-cycle', fn: () => generateAllocatedSpendPerReviewCycle(input, input.externalCostConfigs) }
  ];

  const insights: (CanonicalInsight | null)[] = [];
  
  for (const generator of generators) {
    piDebugLog(`[PI_TRACE][GENERATOR_START]`, `id=${generator.id}`);
    
    try {
      const result = generator.fn();
      
      if (result === null) {
        piDebugLog(`[PI_TRACE][GENERATOR_RESULT]`, `id=${generator.id}`, `result=NULL`);
        piDebugLog(`[PI_TRACE][VALIDATION]`, `id=${generator.id}`, `result=FAIL`, `reason=Generator returned null`);
        piDebugLog(`[PI_TRACE][FINAL]`, `id=${generator.id}`, `result=FILTERED`);
        
        // Structured suppression diagnostic
        const suppressionDiagnostic = {
          insightId: generator.id,
          suppressionReason: 'Generator returned null',
          inputData: {
            sessionRowsCount: input.sessionRows?.length || 0,
            githubByPeriodCount: input.githubByPeriod?.length || 0,
            hasGithubSnapshot: !!input.githubSnapshot
          },
          timestamp: new Date().toISOString()
        };
        
        piDebugLog(`[PI_SUPPRESSION_DIAGNOSTIC]`, JSON.stringify(suppressionDiagnostic));
      } else {
        insights.push(result);
        piDebugLog(`[PI_TRACE][GENERATOR_RESULT]`, `id=${generator.id}`, `result=INSIGHT`);
        piDebugLog(`[PI_TRACE][VALIDATION]`, `id=${generator.id}`, `result=PASS`);
        piDebugLog(`[PI_TRACE][FINAL]`, `id=${generator.id}`, `result=RENDERED`);
      }
    } catch (error) {
      piDebugLog(`[PI_TRACE][GENERATOR_RESULT]`, `id=${generator.id}`, `result=NULL`);
      piDebugLog(`[PI_TRACE][VALIDATION]`, `id=${generator.id}`, `result=FAIL`, `reason=${error instanceof Error ? error.message : String(error)}`);
      piDebugLog(`[PI_TRACE][FINAL]`, `id=${generator.id}`, `result=FILTERED`);
      
      // Structured suppression diagnostic for errors
      const suppressionDiagnostic = {
        insightId: generator.id,
        suppressionReason: 'Generator threw error',
        error: error instanceof Error ? error.message : String(error),
        inputData: {
          sessionRowsCount: input.sessionRows?.length || 0,
          githubByPeriodCount: input.githubByPeriod?.length || 0,
          hasGithubSnapshot: !!input.githubSnapshot
        },
        timestamp: new Date().toISOString()
      };
      
      piDebugLog(`[PI_SUPPRESSION_DIAGNOSTIC]`, JSON.stringify(suppressionDiagnostic));
    }
  }

  piDebugLog('[FINAL_PI_TRACE][REVIEW_MERGE_RESULTS]', {
    totalCalled: generators.length,
    nonNullCount: insights.length,
    insightIds: insights.map(i => i.id)
  });

  return insights.filter((insight): insight is CanonicalInsight => insight !== null);
}
