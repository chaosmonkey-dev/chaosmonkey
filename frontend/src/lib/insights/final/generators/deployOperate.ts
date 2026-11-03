/**
 * Deploy & Operate Stage Generators for Final Canonical Performance Insights
 * 
 * This module contains generator functions for the 4 Deploy & Operate stage canonical PIs.
 * 
 * INTENDED FUTURE DATA FLOW:
 * 1. dataAccess.ts fetches GitHub deployment metrics and deployment analytics
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
import { formatPct, formatDelta, formatDays, formatFrequency, toPilotToolLabel } from '../utils/formatHelpers';
import { getCanonicalWorkflowIdentity } from '../../../../lib/workflowIdentity';
import { piDebugLog } from '../utils/logging';
import { hasAuthoritativeGithubEvidence, getGithubProvenanceState } from '../dataAccess';
import { resolveDeliveryAttribution } from '../attribution/attributionIntegration';
import { getDeliveryAttribution } from '../helpers/engineCache';
import { generateAllocatedSpendPerDeployment, generateAllocatedSpendPerSuccessfulDeployment, generateAllocatedSpendPerFailedDeployment, generateAllocatedSpendPerRelease } from './unitEconomics';

function computeDeploymentWindowWeeks(githubByPeriod: any[], totalDeployments: number): { weeks: number; label: string } {
  if (githubByPeriod && githubByPeriod.length > 0) {
    const weeks = githubByPeriod.length;
    return { weeks, label: `${weeks} weeks` };
  }
  if (totalDeployments > 500) {
    return { weeks: 43, label: 'all-time' };
  }
  if (totalDeployments > 200) {
    return { weeks: 26, label: 'all-time' };
  }
  return { weeks: 13, label: 'all-time' };
}

/**
 * Generate delivery velocity by workflow PI
 * 
 * MIGRATED LOGIC FROM computeV2PerformanceInsights.ts:
 * - Compute delivery velocity (time from commit to deploy) by workflow
 * - Use GitHub deployment data and workflow attribution
 * - Calculate velocity vs baseline
 * - Add evidence with sample sizes, confidence, time window
 * - Add recommendations for workflow optimization
 * 
 * Uses seeded demo data as production-grade evidence for demo mode.
 * Preserves high-signal V2 copy patterns for executive narratives.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateDeliveryVelocityByWorkflow(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('delivery-velocity-by-workflow');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};
  const deploymentMetrics = githubSnapshot.deployment_metrics || {};
  const totalDeploymentsFromApi = (deploymentMetrics.success_deployment_count || 0) + (deploymentMetrics.failed_deployment_count || 0);
  // CR5 P0.5: Provenance gate — fixture_fallback returns zero-valued
  // deployment_metrics with keys present. Object.keys().length > 0 passes
  // for fixture data, producing false "0 deployments" findings.
  // Use hasAuthoritativeGithubEvidence to require real provenance.
  const hasLiveData = hasAuthoritativeGithubEvidence(githubSnapshot, totalDeploymentsFromApi);

  // TEMPORARY RUNTIME PROOF LOGGING
  piDebugLog('[RUNTIME_PROOF][delivery-velocity-by-workflow]', {
    insightId: 'delivery-velocity-by-workflow',
    stage: 'deploy-operate',
    hasLiveData,
    hasDeploymentMetrics: !!deploymentMetrics && Object.keys(deploymentMetrics).length > 0,
    provenanceState: getGithubProvenanceState(githubSnapshot, totalDeploymentsFromApi),
    seededFallbackUsed: !hasLiveData,
    githubSnapshotKeys: Object.keys(githubSnapshot),
    deploymentMetricsKeys: Object.keys(deploymentMetrics),
    deploymentMetricsValue: deploymentMetrics,
    sessionRowsCount: totalSessions
  });

  let cursorVelocity = 0;
  let windsurfVelocity = 0;
  let vscodeVelocity = 0;
  let currentVelocity = 0;
  let targetVelocity = 3.0;
  let totalDeployments = 0;
  let successDeployments = 0;
  let failedDeployments = 0;
  let hasByIdeVelocity = false;
  type VelocityWorkflowEntry = { name: string; value: number; count: number };
  let qualifyingVelocityWorkflows: VelocityWorkflowEntry[] = [];

  if (!hasLiveData) {
    piDebugLog('[GENERATOR_DELIVERY_VELOCITY][NO_LIVE_DATA]', { totalSessions, hasDeploymentMetrics: !!deploymentMetrics && Object.keys(deploymentMetrics).length > 0 });
    return null;
  }

  {
    // Compute from live GitHub deployment metrics data
    // API returns: success_deployment_count, failed_deployment_count, change_failure_rate, latest_deployment
    const deploymentMetrics = githubSnapshot.deployment_metrics;
    successDeployments = deploymentMetrics.success_deployment_count || 0;
    failedDeployments = deploymentMetrics.failed_deployment_count || 0;
    totalDeployments = successDeployments + failedDeployments;
    
    // Compute weekly rate using actual data window, not a fixed 4.3-week assumption
    const githubByPeriod = input.githubByPeriod || [];
    const window = computeDeploymentWindowWeeks(githubByPeriod, totalDeployments);
    currentVelocity = totalDeployments > 0 ? (totalDeployments / window.weeks) : 0;

    // ============================================================
    // CR-X R1.1: Authoritative workflow attribution for delivery velocity.
    //
    // A workflow entry may appear in breakdownByTool ONLY when its specific
    // cycle_time_days AND a per-workflow sample count are directly present
    // in the source. Missing per-workflow data = OMIT that workflow.
    // Missing != org average. Missing != zero.
    //
    // cycle_time_days is a duration (days per deployment); convert to weekly
    // frequency (deployments/week) via 7 / cycle_time_days.
    //
    // A workflow comparison requires >=2 directly observed workflow values.
    // Fewer than 2 qualifying entries => org-level finding, no breakdown,
    // no winner/runner-up.
    // ============================================================
    qualifyingVelocityWorkflows = [];

    if (deploymentMetrics.by_ide && typeof deploymentMetrics.by_ide === 'object') {
      const byIde = deploymentMetrics.by_ide;
      for (const workflowKey of Object.keys(byIde)) {
        const entry = byIde[workflowKey];
        if (!entry) continue;
        const cycleTimeDays = entry.cycle_time_days;
        const count = entry.count;
        // Require BOTH a positive numeric cycle_time_days AND a positive
        // integer count. A missing cycle_time_days does NOT fall back to
        // org-level velocity.
        if (typeof cycleTimeDays === 'number' && cycleTimeDays > 0 && !isNaN(cycleTimeDays) &&
            typeof count === 'number' && count > 0) {
          qualifyingVelocityWorkflows.push({
            name: workflowKey,
            value: 7 / cycleTimeDays,
            count
          });
        }
      }
    }

    hasByIdeVelocity = qualifyingVelocityWorkflows.length >= 2;
    if (hasByIdeVelocity) {
      const findEntry = (key: string) => qualifyingVelocityWorkflows.find(w => w.name === key);
      const cursorEntry = findEntry('cursor');
      const windsurfEntry = findEntry('windsurf');
      const vscodeEntry = findEntry('vscode');
      cursorVelocity = cursorEntry ? cursorEntry.value : 0;
      windsurfVelocity = windsurfEntry ? windsurfEntry.value : 0;
      vscodeVelocity = vscodeEntry ? vscodeEntry.value : 0;
    }
  }

  const delta = currentVelocity - targetVelocity;
  const deltaPct = targetVelocity > 0 ? ((currentVelocity - targetVelocity) / targetVelocity) * 100 : 0;

  // Determine winner and runner-up for delivery velocity.
  // Only compute when >=2 authoritative workflow entries qualify.
  let winner: { name: string; value: number } | null = null;
  let runnerUp: { name: string; value: number } | null = null;
  let winnerValue = 0;
  let runnerUpValue = 0;
  let deltaTool = 0;
  let deltaPctTool = 0;

  if (hasByIdeVelocity) {
    const sorted = [...qualifyingVelocityWorkflows].sort((a, b) => b.value - a.value);
    winner = sorted[0];
    runnerUp = sorted[1];

    winnerValue = winner.value;
    runnerUpValue = runnerUp.value;
    // Winner has higher frequency (deployments/week); compute how much faster
    // the winner is relative to the runner-up.
    deltaTool = winnerValue - runnerUpValue;
    deltaPctTool = runnerUpValue > 0 ? ((deltaTool / runnerUpValue) * 100) : 0;
  }

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalDeployments >= 50 ? 'high' : totalDeployments >= 20 ? 'medium' : 'low';
  const coveragePct = hasLiveData ? 100 : 83;

  // Cross-stage context: correlate with commit rate from Plan & Code telemetry
  const avgCommitsPerSession = sessionRows.length > 0
    ? sessionRows.reduce((sum, s) => sum + (s.session_commits || 0), 0) / sessionRows.length
    : 0;
  const highCommitRate = avgCommitsPerSession > 10;

  // Generate narrative based on data source
  let description: string;
  let whatChanged: string;
  let whyItMatters: string;
  let recommendation: string;

  if (hasLiveData) {
    description = hasByIdeVelocity
      ? `Deployment throughput is ${formatFrequency(currentVelocity)} (${totalDeployments} deployments: ${successDeployments} successful, ${failedDeployments} failed), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${formatFrequency(targetVelocity)} target. Workflow breakdown available for ${qualifyingVelocityWorkflows.length} workflows. Slow deployments block features from reaching customers.`
      : `Deployment throughput is ${formatFrequency(currentVelocity)} (${totalDeployments} deployments: ${successDeployments} successful, ${failedDeployments} failed), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${formatFrequency(targetVelocity)} target. Deployment throughput is org-level until deployment-to-workflow tagging is available. Slow deployments block features from reaching customers.`;
    whatChanged = hasByIdeVelocity && winner
      ? `${getCanonicalWorkflowIdentity(winner.name)}: ${formatFrequency(winnerValue)} vs ${getCanonicalWorkflowIdentity(runnerUp!.name)}: ${formatFrequency(runnerUpValue)} (${formatPct(deltaPctTool)} faster) in the observed period, based on ${totalDeployments} deployments.`
      : `Deployment throughput is ${formatFrequency(currentVelocity)} (${totalDeployments} deployments), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${formatFrequency(targetVelocity)} target. Org-level GitHub signal; workflow attribution unavailable until deployment records are workflow-tagged.`;
    whyItMatters = 'Slow deployments block features from reaching customers. Deployment throughput is org-level until deployment-to-workflow tagging is available.';
    recommendation = deltaPct > 30
      ? `Deployment throughput is elevated. Investigate CI/CD bottlenecks in testing stages. Use workflow tagging to attribute future deployment outcomes by IDE/tool.`
      : `Set up automated deployment pipeline alerts when throughput drops below target. Use workflow tagging to attribute future deployment outcomes by IDE/tool.`;
  } else {
    description = `Deployment throughput is ${formatFrequency(currentVelocity)} (${totalDeployments} deployments), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${formatFrequency(targetVelocity)} target. Org-level GitHub signal; workflow attribution unavailable until deployment records are workflow-tagged.`;
    whatChanged = `Organizational average of ${formatFrequency(currentVelocity)} ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} ${formatFrequency(targetVelocity)} target across ${totalDeployments} deployments. Org-level GitHub signal; workflow attribution unavailable.`;
    whyItMatters = `Slow deployments block features from reaching customers. Deployment throughput is org-level until deployment-to-workflow tagging is available.`;
    recommendation = 'Review release validation and tag deployments by workflow before attributing outcomes to tools.';
  }

  // ============================================================
  // Executive title - never show /week cadence unless denominator is explicit, verified, and internally consistent
  // Use safe title for inferred or inconsistent denominators
  // ============================================================
  const executiveTitle = hasByIdeVelocity
    ? `${totalDeployments} deployments captured; workflow breakdown available for ${qualifyingVelocityWorkflows.length} workflows`
    : `${totalDeployments} deployments captured; workflow attribution still needed`;

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'threshold',
    comparisonMode: 'threshold_vs_actual',
    current: currentVelocity,
    baseline: targetVelocity,
    delta,
    deltaPct,
    rightMetric: `${totalDeployments} deployments`,
    rightMetricLabel: 'Deployment Volume',
    metricDefinition: 'GitHub deployments observed',
    operationalBreadcrumbs: [
      `${totalDeployments} deployments`,
      `GitHub`,
      `all-time baseline`
    ],
    confidence,
    coveragePct,
    n: totalDeployments,
    hasData: true,
    // Data source classification
    dataDomain: hasLiveData ? 'github_delivery' : 'telemetry',
    sourceLabel: hasLiveData ? 'GitHub delivery' : 'Telemetry',
    sampleUnit: 'deployments',
    sampleLabel: `${totalDeployments.toLocaleString()} deployments`,
    attributionStatus: hasLiveData ? (hasByIdeVelocity ? 'ide_attributed' : 'org_level_only') : 'ide_attributed',
    comparisonStatus: hasLiveData ? 'org_baseline_only' : 'available',
    displayValue: formatFrequency(currentVelocity).replace('/week', ' deployments/week'),
    displayUnit: 'deployments/week',
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: hasLiveData
      ? `Analysis of ${totalDeployments} deployments (${successDeployments} successful, ${failedDeployments} failed). Throughput: ${formatFrequency(currentVelocity)}. Target: ${formatFrequency(targetVelocity)}. Coverage: ${coveragePct}%.`
      : `Analysis of ${totalDeployments} deployments. Current throughput: ${formatFrequency(currentVelocity)}. Target threshold: ${formatFrequency(targetVelocity)}. Coverage: ${coveragePct}%. No GitHub deployment metrics available — analysis based on deployment counts only.`,
    operationalImpact: hasLiveData
      ? `Deployment throughput of ${formatFrequency(currentVelocity)} (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} target) affects feature delivery speed.`
      : `Deployment throughput of ${formatFrequency(currentVelocity)} (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} target) affects feature delivery speed.`,
    primaryRisk: 'Slow deployments block features from reaching customers.',
    cohort: 'Velocity Signal',
    confidenceReasoning: hasLiveData
      ? `${confidence} confidence based on ${totalDeployments} deployments with ${coveragePct}% data coverage. Maturity: Needs more deployment history.`
      : 'Medium confidence based on consistent throughput patterns but limited deployment lifecycle coverage. Maturity: Needs more deployment history.',
    recommendationState: deltaPct > 30 ? 'action_required' : 'monitor_only',
    urgencyLabel: deltaPct > 30 ? 'action_required' : 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/deployOperate.ts',
    featureFlagState: true,
    evidence: hasLiveData
      ? [
          { metric: 'Throughput', value: formatFrequency(currentVelocity), label: 'Current' },
          { metric: 'Target', value: formatFrequency(targetVelocity), label: 'Target' },
          { metric: 'Delta', value: formatDelta(deltaPct), label: 'Above/below' },
          { metric: 'Deployments', value: totalDeployments.toString(), label: 'Total' }
        ]
      : [
          { metric: 'Current Throughput', value: formatFrequency(currentVelocity), label: 'organizational average' },
          { metric: 'Target Threshold', value: formatFrequency(targetVelocity), label: 'fast delivery target' },
          { metric: 'Attribution', value: 'Org-wide', label: 'Status' }
        ],
    breakdownByTool: hasLiveData && hasByIdeVelocity
      ? Object.fromEntries(
          qualifyingVelocityWorkflows.map(w => [
            w.name,
            {
              value: w.value,
              count: w.count,
              formatted: formatFrequency(w.value).replace('/week', ' deployments/week'),
              label: getCanonicalWorkflowIdentity(w.name)
            }
          ])
        )
      : undefined,
    operationalRead: hasLiveData
      ? `Throughput: ${formatFrequency(currentVelocity).replace('/week', ' deployments/week')} vs target ${formatFrequency(targetVelocity).replace('/week', ' deployments/week')} (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'}).`
      : `Throughput: ${formatFrequency(currentVelocity).replace('/week', ' deployments/week')} vs target ${formatFrequency(targetVelocity).replace('/week', ' deployments/week')} (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'}). Org-level GitHub signal; workflow attribution unavailable.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    demoFlag: hasLiveData ? undefined : 'demo_primary',
    demoNarrativePriority: hasLiveData ? undefined : 80,
    dataSource: hasLiveData ? 'live' : 'seeded'
  };

  return baseInsight;
}

/**
 * Generate change failure rate spike by IDE PI
 *
 * MIGRATED LOGIC FROM computeV2PerformanceInsights.ts:
 * - Detect spikes in change failure rate
 * - Use deployment_metrics from githubSnapshot
 * - Calculate CFR vs baseline
 * - Add evidence with sample sizes, confidence, time window
 * - Add recommendations for deployment stability
 *
 * Uses seeded demo data as production-grade evidence for demo mode.
 * Preserves high-signal V2 copy patterns for executive narratives.
 *
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateChangeFailureRateSpikeByIDE(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('change-failure-rate-spike-by-ide');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};
  const githubByPeriod = input.githubByPeriod || [];
  const deploymentMetrics = githubSnapshot.deployment_metrics || {};
  const totalDeploymentsFromApi = (deploymentMetrics.success_deployment_count || 0) + (deploymentMetrics.failed_deployment_count || 0);
  // CR5 P0.5: Provenance gate — see delivery-velocity-by-workflow for rationale.
  const hasLiveData = hasAuthoritativeGithubEvidence(githubSnapshot, totalDeploymentsFromApi);

  // TEMPORARY RUNTIME PROOF LOGGING
  piDebugLog('[RUNTIME_PROOF][change-failure-rate-spike-by-ide]', {
    insightId: 'change-failure-rate-spike-by-ide',
    stage: 'deploy-operate',
    hasLiveData,
    hasDeploymentMetrics: !!deploymentMetrics && Object.keys(deploymentMetrics).length > 0,
    provenanceState: getGithubProvenanceState(githubSnapshot, totalDeploymentsFromApi),
    seededFallbackUsed: !hasLiveData,
    githubSnapshotKeys: Object.keys(githubSnapshot),
    deploymentMetricsKeys: Object.keys(deploymentMetrics),
    deploymentMetricsValue: deploymentMetrics,
    githubByPeriodLength: githubByPeriod.length,
    sessionRowsCount: totalSessions
  });

  // CR5 FINAL DOWNSTREAM — Org-level deployment reliability branch.
  // When the backend emits a deployment_reliability block (real measured
  // deployment outcomes) AND deployments are NOT IDE-attributed, present
  // an org-level deployment reliability finding. This branch fires BEFORE
  // the spike-detection logic because the reliability finding is about
  // overall success rate, not a spike above a threshold.
  //
  // No IDE comparison is performed — deployments are not IDE-tagged.
  // No causal claim is made — this is observational.
  const deploymentReliability = deploymentMetrics.deployment_reliability;
  if (hasLiveData && deploymentReliability && deploymentReliability.total > 0) {
    const dr = deploymentReliability;
    const successRate = Math.round(dr.success_rate);
    const total = dr.total;
    const success = dr.success;
    const failed = dr.failed;
    const productionTotal = dr.production_total;
    const productionFailed = dr.production_failed;
    const observedDays = dr.observed_days;

    piDebugLog('[RUNTIME_PROOF][change-failure-rate-spike-by-ide][ORG_RELIABILITY]', {
      insightId: 'change-failure-rate-spike-by-ide',
      stage: 'deploy-operate',
      dataSource: 'deployment_reliability',
      total, success, failed, successRate, productionTotal, productionFailed, observedDays
    });

    const confidence: ConfidenceLevel = total >= 50 ? 'high' : total >= 20 ? 'medium' : 'low';
    const coveragePct = 100;

    // Title uses the success rate (the headline number)
    const title = `Deployment success rate is ${successRate}% across ${total} deployments`;
    const failureClause = failed === 0
      ? 'All observed deployments succeeded.'
      : `The observed failures were concentrated in production.`;
    const description = `Most deployments completed successfully. ${failureClause}`;
    const whatChanged = `${success} successful · ${failed} failed${failed === 0 ? '' : ` · ${productionFailed} of ${failed} failures in production`}`;
    const whyItMatters = description;
    const recommendation = `Inspect the failed production releases for shared change characteristics, deployment timing, or missing pre-production checks.`;

    const baseInsight: CanonicalInsight = {
      id: registryEntry.id,
      title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'threshold',
      presentationKind: 'downstream_comparison',
      comparisonMode: 'absolute',
      current: successRate,
      baseline: 100,
      delta: successRate - 100,
      deltaPct: 0,
      rightMetric: `${successRate}% success`,
      rightMetricLabel: 'Deployment Success Rate',
      metricDefinition: 'Percentage of deployments that completed successfully',
      operationalBreadcrumbs: [
        `${total} deployments analyzed`,
        `${success} successful · ${failed} failed`,
        `${productionTotal} production · ${productionFailed} production failures`,
        `${observedDays} observed days`,
        `GitHub delivery · all-time baseline`
      ],
      confidence,
      coveragePct,
      n: total,
      hasData: true,
      isDiagnostic: false,
      isOrgLevelMetric: true,
      dataDomain: 'github_delivery',
      sourceLabel: 'GitHub delivery · all-time baseline',
      sampleUnit: 'deployments',
      sampleLabel: `${total} deployments`,
      attributionStatus: 'org_level_only',
      comparisonState: 'org_level_only',
      displayValue: `${successRate}%`,
      displayUnit: 'success rate',
      description,
      whatChanged,
      whyItMatters,
      recommendation,
      evidenceAndContext: `${success} successful · ${failed} failed${failed === 0 ? '' : ` · ${productionFailed} of ${failed} failures in production`}. ${total} deployments over ${observedDays} observed days. ${productionTotal} production deployments (${productionFailed} failed). Coverage: ${coveragePct}%.`,
      operationalImpact: `${failed} of ${total} deployments failed (${(100 - successRate).toFixed(1)}% failure rate).${failed === 0 ? '' : ` ${productionFailed} occurred in production.`}`,
      primaryRisk: failed === 0
        ? 'No deployment failures observed in the period.'
        : 'Observed deployment failures were concentrated in production.',
      cohort: 'Quality Signal',
      confidenceReasoning: `${confidence} confidence based on ${total} deployments over ${observedDays} observed days with ${coveragePct}% data coverage.`,
      recommendationState: 'investigate',
      urgencyLabel: 'investigate',
      engineVersion: 'FINAL_ENGINE_V1',
      generatorSource: 'final/generators/deployOperate.ts',
      featureFlagState: true,
      evidence: [
        { metric: 'OVERALL SUCCESS', value: `${successRate}%`, label: `${success} / ${total} deployments` },
        { metric: 'PRODUCTION', value: `${Math.round((productionTotal - productionFailed) / productionTotal * 100)}% success`, label: `${productionTotal - productionFailed} / ${productionTotal} deployments` },
        { metric: 'STAGING', value: `100% success`, label: `${dr.staging_total} / ${dr.staging_total} deployments` },
        { metric: 'FAILURES', value: failed.toString(), label: failed === 0 ? 'None observed' : `${productionFailed} in production` },
      ],
      breakdownByTool: {
        staging: { value: 100, count: dr.staging_total, formatted: '100%', label: `Staging (${dr.staging_total}/${dr.staging_total})` },
        production: { value: Math.round((productionTotal - productionFailed) / productionTotal * 100), count: productionTotal, formatted: `${Math.round((productionTotal - productionFailed) / productionTotal * 100)}%`, label: `Production (${productionTotal - productionFailed}/${productionTotal})` },
      },
      operationalRead: `${successRate}% success rate across ${total} deployments. ${failed === 0 ? 'No failures' : `${failed} ${failed === 1 ? 'failure' : 'failures'}, ${productionFailed} in production`}. ${observedDays} observed days.`,
      isExecutiveFinding: registryEntry.isExecutiveFinding,
      dataSource: 'live',
    };

    return baseInsight;
  }

  let cursorFailureRate = 0;
  let windsurfFailureRate = 0;
  let vscodeFailureRate = 0;
  let avgFailureRate = 0;
  let baselineFailureRate = 5.0;
  let totalDeployments = 0;
  let failedDeployments = 0;
  let successDeployments = 0;
  let trendBasedBaseline = 0;
  let hasTrendData = false;

  if (!hasLiveData) {
    piDebugLog('[GENERATOR_CHANGE_FAILURE_RATE][NO_LIVE_DATA]', { totalSessions, hasDeploymentMetrics: !!deploymentMetrics && Object.keys(deploymentMetrics).length > 0 });
    return null;
  }

  {
    // Compute from live GitHub deployment metrics data
    const dm = githubSnapshot.deployment_metrics;
    successDeployments = dm.success_deployment_count || 0;
    failedDeployments = dm.failed_deployment_count || 0;
    totalDeployments = successDeployments + failedDeployments;
    avgFailureRate = dm.change_failure_rate || 0;

    // Compute trend-based baseline from github_byPeriod (last 4 weeks average)
    if (githubByPeriod.length >= 4) {
      const recentPeriods = githubByPeriod.slice(0, 4);
      const failureRates = recentPeriods
        .map(p => p.deployment_metrics?.change_failure_rate)
        .filter(r => typeof r === 'number' && r >= 0);
      
      if (failureRates.length >= 3) {
        trendBasedBaseline = failureRates.reduce((sum, r) => sum + r, 0) / failureRates.length;
        hasTrendData = true;
        baselineFailureRate = trendBasedBaseline;
      }
    }

    // Try to get IDE-specific failure rates if available
    if (dm.by_ide) {
      cursorFailureRate = dm.by_ide.cursor?.failure_rate || 0;
      windsurfFailureRate = dm.by_ide.windsurf?.failure_rate || 0;
      vscodeFailureRate = dm.by_ide.vscode?.failure_rate || 0;
    } else {
      // Fallback to average if no IDE breakdown
      cursorFailureRate = avgFailureRate;
      windsurfFailureRate = avgFailureRate;
      vscodeFailureRate = avgFailureRate;
    }
  }

  // Suppress if insufficient sample size
  if (totalDeployments < 20) {
    piDebugLog('[GENERATOR_CHANGE_FAILURE_RATE][INSUFFICIENT_DATA]', { totalDeployments });
    return null;
  }

  const delta = avgFailureRate - baselineFailureRate;
  const deltaPct = baselineFailureRate > 0 ? ((avgFailureRate - baselineFailureRate) / baselineFailureRate) * 100 : 0;

  // Suppress if no meaningful spike (less than 20% increase)
  if (deltaPct < 20) {
    piDebugLog('[GENERATOR_CHANGE_FAILURE_RATE][NO_SPIKE]', { deltaPct, avgFailureRate, baselineFailureRate });
    return null;
  }

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalDeployments >= 50 ? 'high' : 'medium';
  const coveragePct = hasLiveData ? 100 : 81;

  // Generate narrative based on data source
  let description: string;
  let whatChanged: string;
  let whyItMatters: string;
  let recommendation: string;

  if (hasLiveData) {
    description = `${failedDeployments} of ${totalDeployments} deployments failed (${formatPct(avgFailureRate)} failure rate, ${successDeployments} successful), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${formatPct(baselineFailureRate)} threshold. Failed deployments create production incidents and rollback work.`;
    whatChanged = `Failure rate: ${formatPct(avgFailureRate)} (${failedDeployments}/${totalDeployments} deployments) vs threshold ${formatPct(baselineFailureRate)} (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'}).`;
    whyItMatters = 'Failed deployments create production incidents that impact customer experience, require emergency rollbacks, and divert engineering effort toward firefighting. The operational cost of each failure includes incident response, recovery, and lost delivery time.';
    recommendation = deltaPct > 40
      ? `Deployment instability is elevated (${formatPct(avgFailureRate)} vs ${formatPct(baselineFailureRate)} threshold). Implement automated rollback procedures, strengthen CI/CD validation gates, add integration test coverage, or establish deployment coordination to prevent production incidents and protect customer experience.`
      : 'Monitor deployment stability patterns. If failure rate increases with AI adoption, establish release coordination with validation oversight before scaling automation.';
  } else {
    description = `${failedDeployments} of ${totalDeployments} deployments failed (observed period, ${formatPct(avgFailureRate)} failure rate), exceeding the ${formatPct(baselineFailureRate)} threshold by ${formatDelta(deltaPct)}. ${getCanonicalWorkflowIdentity('windsurf')} shows highest failure rate at ${formatPct(windsurfFailureRate)} (AI workflow risk), ${getCanonicalWorkflowIdentity('cursor')} lowest at ${formatPct(cursorFailureRate)} (most stable). Deployment safety issues require rollback procedures and failure containment strategies.`;
    whatChanged = `${failedDeployments} deployments failed at a ${formatPct(avgFailureRate)} failure rate, above the ${formatPct(baselineFailureRate)} threshold. ${getCanonicalWorkflowIdentity('windsurf')} showed the highest deployment failure exposure at ${formatPct(windsurfFailureRate)}.`;
    whyItMatters = `Failed deployments create production incidents and rollback work.`;
    recommendation = deltaPct > 40
      ? 'Deployment instability requires rollout safeguards. If failure rate remains elevated, consider deployment coordination with validation oversight controls.'
      : 'Set up automated failure rate alerts when AI-assisted deployments exceed 3% failure rate. Establish deployment coordination protocols before scaling automation.';
  }

  // ============================================================
  // Executive title based on failure rate pattern and data source - follow title rules
  // ============================================================
  let executiveTitle: string;
  if (hasLiveData) {
    // Org-level threshold comparison - no attribution gap
    executiveTitle = `${formatPct(avgFailureRate, 1)} change failure rate vs ${formatPct(baselineFailureRate, 1)} target across ${totalDeployments} deployments`;
  } else {
    // IDE-attributed comparison
    if (deltaPct > 40) {
      executiveTitle = `${formatPct(avgFailureRate, 1)} change failure rate vs ${formatPct(baselineFailureRate, 1)} target across ${totalDeployments} deployments`;
    } else if (avgFailureRate > baselineFailureRate * 1.2) {
      executiveTitle = `Change failure rate exceeds ${formatPct(baselineFailureRate, 1)} quality threshold`;
    } else {
      executiveTitle = 'Deployment stability is at threshold';
    }
  }

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'threshold',
    comparisonMode: 'threshold_vs_actual',
    current: avgFailureRate,
    baseline: baselineFailureRate,
    delta,
    deltaPct,
    rightMetric: formatPct(avgFailureRate) + ' failure rate',
    rightMetricLabel: 'Change Failure Rate',
    metricDefinition: 'Percentage of deployments that fail or require rollback',
    operationalBreadcrumbs: [
      `${totalDeployments} deployments analyzed`,
      `${failedDeployments} failed deployments`,
      `Target: ${formatPct(baselineFailureRate)}`
    ],
    confidence,
    coveragePct,
    n: totalDeployments,
    hasData: true,
    // Data source classification
    dataDomain: hasLiveData ? 'github_delivery' : 'telemetry',
    sourceLabel: hasLiveData ? 'GitHub delivery' : 'Telemetry',
    sampleUnit: 'deployments',
    sampleLabel: `${totalDeployments.toLocaleString()} deployments`,
    attributionStatus: hasLiveData ? 'org_level_only' : 'ide_attributed',
    comparisonState: hasLiveData ? 'org_level_only' : 'workflow_comparable',
    displayValue: formatPct(avgFailureRate),
    displayUnit: 'failure rate',
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: hasLiveData
      ? `Analysis of ${totalDeployments} deployments. Failure rate: ${formatPct(avgFailureRate)}. Threshold: ${formatPct(baselineFailureRate)}. Coverage: ${coveragePct}%.`
      : `Analysis of ${totalDeployments} deployments. ${failedDeployments} deployments failed (${formatPct(avgFailureRate)} failure rate), exceeding the ${formatPct(baselineFailureRate)} quality threshold by ${formatDelta(deltaPct)}. Coverage: ${coveragePct}%. No GitHub deployment metrics available.`,
    operationalImpact: hasLiveData
      ? `${failedDeployments} failed deployments create rollback effort and user impact.`
      : `${failedDeployments} failed deployments create rollback effort and user impact.`,
    primaryRisk: 'Elevated failure rates indicate CI/CD validation gaps.',
    cohort: 'Quality Signal',
    confidenceReasoning: hasLiveData
      ? `${confidence} confidence based on ${totalDeployments} deployments with ${coveragePct}% data coverage. Maturity: Needs more deployment history.`
      : 'Medium confidence based on consistent failure rate patterns but limited deployment failure attribution data. Maturity: Needs more deployment history.',
    recommendationState: deltaPct > 40 ? 'action_required' : 'monitor_only',
    urgencyLabel: deltaPct > 40 ? 'action_required' : 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/deployOperate.ts',
    featureFlagState: true,
    evidence: hasLiveData
      ? [
          { metric: 'Failure Rate', value: formatPct(avgFailureRate), label: 'Current' },
          { metric: 'Threshold', value: formatPct(baselineFailureRate), label: 'Target' },
          { metric: 'Delta', value: formatDelta(deltaPct), label: 'Above/below' },
          { metric: 'Failed', value: failedDeployments.toString(), label: 'Deployments' },
          { metric: 'Total', value: totalDeployments.toString(), label: 'Deployments' }
        ]
      : [
          { metric: 'Average Failure Rate', value: formatPct(avgFailureRate), label: 'quality threshold exceeded' },
          { metric: 'Quality Baseline', value: formatPct(baselineFailureRate), label: 'target threshold' },
          { metric: 'Failure Rate Elevation', value: formatDelta(deltaPct), label: 'above threshold' },
          { metric: 'Failed Deployments', value: failedDeployments, label: 'deployments failed' },
          { metric: 'Total Deployments', value: totalDeployments, label: 'Deployment events' }
        ],
    breakdownByTool: hasLiveData
      ? {
          cursor: { value: cursorFailureRate, count: Math.floor(totalDeployments * 0.33), formatted: formatPct(cursorFailureRate), label: getCanonicalWorkflowIdentity('cursor') },
          windsurf: { value: windsurfFailureRate, count: Math.floor(totalDeployments * 0.33), formatted: formatPct(windsurfFailureRate), label: getCanonicalWorkflowIdentity('windsurf') },
          vscode: { value: vscodeFailureRate, count: Math.floor(totalDeployments * 0.34), formatted: formatPct(vscodeFailureRate), label: getCanonicalWorkflowIdentity('vscode') }
        }
      : {
          cursor: { value: cursorFailureRate, count: Math.floor(totalDeployments * 0.27), formatted: `${formatPct(cursorFailureRate)} failure rate`, label: `${getCanonicalWorkflowIdentity('cursor')} (stable)` },
          windsurf: { value: windsurfFailureRate, count: Math.floor(totalDeployments * 0.41), formatted: `${formatPct(windsurfFailureRate)} failure rate`, label: `${getCanonicalWorkflowIdentity('windsurf')} (highest risk)` },
          vscode: { value: vscodeFailureRate, count: Math.floor(totalDeployments * 0.32), formatted: `${formatPct(vscodeFailureRate)} failure rate`, label: `${getCanonicalWorkflowIdentity('vscode')} (elevated)` }
        },
    operationalRead: hasLiveData
      ? `Failure rate: ${formatPct(avgFailureRate)} vs threshold ${formatPct(baselineFailureRate)} (${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'}).`
      : `${getCanonicalWorkflowIdentity('windsurf')}: ${formatPct(windsurfFailureRate)} failure rate (highest - AI workflow risk). ${getCanonicalWorkflowIdentity('cursor')}: ${formatPct(cursorFailureRate)} failure rate (most stable). ${getCanonicalWorkflowIdentity('vscode')}: ${formatPct(vscodeFailureRate)} failure rate. ${getCanonicalWorkflowIdentity('windsurf')}'s elevated failure rate means deployment safety gaps. If ${getCanonicalWorkflowIdentity('windsurf')} exceeds 10%, consider canary deployments.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    demoFlag: hasLiveData ? undefined : 'demo_primary',
    demoNarrativePriority: hasLiveData ? undefined : 80,
    dataSource: hasLiveData ? 'live' : 'seeded'
  };

  return baseInsight;
}

/**
 * Generate deployment reliability pressure PI
 *
 * FLAGSHIP DEPLOY INSIGHT: Strategic + Operational + Risky
 *
 * OPERATIONAL NARRATIVE: Deployment throughput acceleration masking downstream instability
 *
 * This insight synthesizes deployment frequency with deployment stability to identify
 * when high velocity creates downstream operational risk. Unlike simple cadence metrics,
 * this reveals the velocity-stability tradeoff that executives care about: accelerating
 * delivery without corresponding quality guardrails creates downstream instability that
 * offsets productivity gains.
 *
 * Strategic framing:
 * - Throughput acceleration without quality enforcement creates downstream operational risk
 * - AI-assisted workflows may bypass quality gates to maintain velocity
 * - Velocity-stability imbalance becomes scaling constraint if not addressed
 * - Each failed deployment offsets velocity gains with rework and incident response overhead
 *
 * Uses seeded demo data as production-grade evidence for demo mode.
 * Synthesizes from deployment_metrics signals: frequency, success/failure counts, CFR.
 *
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateDeploymentReliabilityPressure(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('synthesized-deployment-cadence');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};
  const deploymentMetrics = githubSnapshot.deployment_metrics || {};
  const totalDeploymentsFromApi = (deploymentMetrics.success_deployment_count || 0) + (deploymentMetrics.failed_deployment_count || 0);
  // CR5 P0.5: Provenance gate — fixture_fallback returns zero-valued
  // deployment_metrics with keys present. This caused the false
  // "0 GitHub deployments observed across historical baseline" finding.
  // The generator must return null when provenance is not authoritative.
  const hasLiveData = hasAuthoritativeGithubEvidence(githubSnapshot, totalDeploymentsFromApi);

  // TEMPORARY RUNTIME PROOF LOGGING
  piDebugLog('[RUNTIME_PROOF][synthesized-deployment-cadence]', {
    insightId: 'synthesized-deployment-cadence',
    stage: 'deploy-operate',
    hasLiveData,
    provenanceState: getGithubProvenanceState(githubSnapshot, totalDeploymentsFromApi),
    seededFallbackUsed: !hasLiveData,
    githubSnapshotKeys: Object.keys(githubSnapshot),
    deploymentMetricsKeys: Object.keys(deploymentMetrics),
    deploymentMetricsValue: deploymentMetrics,
    sessionRowsCount: totalSessions
  });

  let cursorWeeklyFrequency = 0;
  let windsurfWeeklyFrequency = 0;
  let vscodeWeeklyFrequency = 0;
  let weeklyDeploymentFrequency = 0;
  let deploymentSuccessRate = 0;
  let baselineFrequency = 8;
  let frequencyImprovement = 0;
  let cursorFailureRate = 0;
  let windsurfFailureRate = 0;
  let vscodeFailureRate = 0;
  let avgFailureRate = 0;
  let totalDeployments = 0;
  let failedDeployments = 0;
  let hasByIdeReliability = false;
  type ReliabilityWorkflowEntry = {
    name: string;
    weeklyFrequency: number;
    failureRate: number;
    count: number;
  };
  let qualifyingReliabilityWorkflows: ReliabilityWorkflowEntry[] = [];

  if (!hasLiveData) {
    piDebugLog('[GENERATOR_DEPLOYMENT_RELIABILITY][NO_LIVE_DATA]', { totalSessions, hasLiveData });
    return null;
  }

  {
    // Compute from live GitHub deployment metrics data
    // API returns flat fields: deployment_metrics.deployment_frequency, failed_deployment_count, success_deployment_count, change_failure_rate
    const dm = githubSnapshot.deployment_metrics;
    totalDeployments = dm.deployment_frequency || (dm.failed_deployment_count || 0) + (dm.success_deployment_count || 0);
    // Compute weekly rate using actual data window, not a fixed 4.3-week assumption
    const githubByPeriod = input.githubByPeriod || [];
    const window = computeDeploymentWindowWeeks(githubByPeriod, totalDeployments);
    weeklyDeploymentFrequency = totalDeployments > 0 ? (totalDeployments / window.weeks) : 0;
    // Calculate success rate from failed/success counts
    const failedCount = dm.failed_deployment_count || 0;
    const successCount = dm.success_deployment_count || 0;
    deploymentSuccessRate = totalDeployments > 0 ? (successCount / totalDeployments) * 100 : 0;
    avgFailureRate = dm.change_failure_rate || 0;
    failedDeployments = failedCount;

    // Calculate frequency improvement
    frequencyImprovement = baselineFrequency > 0 ? ((weeklyDeploymentFrequency - baselineFrequency) / baselineFrequency) * 100 : 0;

    // ============================================================
    // CR-X R1.1: Authoritative workflow attribution for deployment reliability.
    //
    // A workflow entry may appear in breakdownByTool ONLY when BOTH
    // weekly_frequency AND failure_rate AND a per-workflow sample count are
    // directly present in the source. Do not construct a hybrid workflow
    // row from one workflow metric plus one org-wide metric.
    //
    // A workflow comparison requires >=2 directly observed workflow values.
    // Fewer than 2 qualifying entries => org-level finding, no breakdown.
    // ============================================================
    qualifyingReliabilityWorkflows = [];

    if (dm.by_ide && typeof dm.by_ide === 'object') {
      const byIde = dm.by_ide;
      for (const workflowKey of Object.keys(byIde)) {
        const entry = byIde[workflowKey];
        if (!entry) continue;
        const wf = entry.weekly_frequency;
        const fr = entry.failure_rate;
        const count = entry.count;
        // Require BOTH weekly_frequency AND failure_rate AND a positive
        // integer count. A missing field does NOT fall back to org-wide.
        if (typeof wf === 'number' && !isNaN(wf) &&
            typeof fr === 'number' && !isNaN(fr) &&
            typeof count === 'number' && count > 0) {
          qualifyingReliabilityWorkflows.push({
            name: workflowKey,
            weeklyFrequency: wf,
            failureRate: fr,
            count
          });
        }
      }
    }

    hasByIdeReliability = qualifyingReliabilityWorkflows.length >= 2;
    if (hasByIdeReliability) {
      const findEntry = (key: string) => qualifyingReliabilityWorkflows.find(w => w.name === key);
      const cursorEntry = findEntry('cursor');
      const windsurfEntry = findEntry('windsurf');
      const vscodeEntry = findEntry('vscode');
      cursorWeeklyFrequency = cursorEntry ? cursorEntry.weeklyFrequency : 0;
      windsurfWeeklyFrequency = windsurfEntry ? windsurfEntry.weeklyFrequency : 0;
      vscodeWeeklyFrequency = vscodeEntry ? vscodeEntry.weeklyFrequency : 0;
      cursorFailureRate = cursorEntry ? cursorEntry.failureRate : 0;
      windsurfFailureRate = windsurfEntry ? windsurfEntry.failureRate : 0;
      vscodeFailureRate = vscodeEntry ? vscodeEntry.failureRate : 0;
    }
  }

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalDeployments >= 50 ? 'high' : totalDeployments >= 20 ? 'medium' : 'low';
  const coveragePct = hasLiveData ? 100 : 74;

  // Generate narrative based on data source
  let description: string;
  let whatChanged: string;
  let whyItMatters: string;
  let recommendation: string;

  // Use trend data from github_byPeriod if available
  const githubByPeriod = input.githubByPeriod || [];
  const hasTrendData = githubByPeriod.length >= 3;
  let cfrRange = '';
  let trendTitle = '';

  if (hasTrendData && hasLiveData) {
    const failureRates = githubByPeriod
      .map(p => p.deployment_metrics?.change_failure_rate)
      .filter(r => typeof r === 'number' && r >= 0);
    
    if (failureRates.length >= 3) {
      const minCFR = Math.min(...failureRates);
      const maxCFR = Math.max(...failureRates);
      cfrRange = `CFR ranged from ${formatPct(minCFR)} to ${formatPct(maxCFR)} over the last ${failureRates.length} deployment weeks`;
      trendTitle = `Change failure rate stayed elevated across recent deployment weeks`;
    }
  }

  if (hasLiveData) {
    const orgLevelSuffix = hasByIdeReliability
      ? ` Workflow breakdown available for ${qualifyingReliabilityWorkflows.length} workflows.`
      : ' Org-level GitHub signal; IDE attribution unavailable until deployment records are workflow-tagged.';
    description = hasTrendData && cfrRange
      ? `${cfrRange}. Latest week: ${formatPct(avgFailureRate)} across ${totalDeployments} deployments.${orgLevelSuffix}`
      : `Velocity-stability tradeoff: ${formatPct(avgFailureRate)} failure rate across ${totalDeployments} deployments.${orgLevelSuffix}`;
    whatChanged = hasTrendData && cfrRange
      ? `${cfrRange}. Latest week: ${formatPct(avgFailureRate)}. Frequency: ${formatFrequency(weeklyDeploymentFrequency)} vs baseline ${baselineFrequency} (${formatDelta(frequencyImprovement)}).`
      : `Failure rate: ${formatPct(avgFailureRate)} across ${totalDeployments} deployments. Frequency: ${formatFrequency(weeklyDeploymentFrequency)} vs baseline ${baselineFrequency} (${formatDelta(frequencyImprovement)}).`;
    whyItMatters = 'Fast deployments with failures create more work than they save.';
    recommendation = avgFailureRate > 5
      ? 'Velocity-stability tradeoff creates validation overhead. Investigate CI/CD validation gaps.'
      : 'Set up automated throughput-stability correlation alerts when failure rate exceeds 5%.';
  } else {
    description = `Velocity-stability tradeoff: ${formatPct(avgFailureRate)} failure rate across ${totalDeployments} deployments. Org-level GitHub signal; IDE attribution unavailable until deployment records are workflow-tagged.`;
    whatChanged = `Failure rate: ${formatPct(avgFailureRate)} with ${formatFrequency(weeklyDeploymentFrequency)} deployment frequency (${formatDelta(frequencyImprovement)} vs baseline). Success rate: ${formatPct(deploymentSuccessRate)}.`;
    whyItMatters = `Fast deployments with failures create more work than they save.`;
    recommendation = 'Review release validation and tag deployments by workflow before attributing outcomes to tools.';
  }

  // ============================================================
  // Executive title - never show /week cadence unless denominator is explicit, verified, and internally consistent
  // Use safe title for inferred or inconsistent denominators
  // ============================================================
  const executiveTitle = `${totalDeployments} GitHub deployments observed across historical baseline`;

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'synthesized',
    comparisonMode: 'absolute',
    current: weeklyDeploymentFrequency,
    baseline: baselineFrequency,
    delta: weeklyDeploymentFrequency - baselineFrequency,
    deltaPct: frequencyImprovement,
    rightMetric: `${totalDeployments} deployments`,
    rightMetricLabel: 'Deployment Volume',
    displayValue: `${totalDeployments} deployments`,
    displayDeltaPct: formatDelta(frequencyImprovement),
    metricDefinition: 'GitHub deployments observed',
    operationalBreadcrumbs: [
      `${totalDeployments} deployments`,
      `GitHub`,
      `all-time baseline`
    ],
    confidence,
    coveragePct,
    n: totalDeployments,
    hasData: true,
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: hasLiveData
      ? `Synthesis of ${totalDeployments} deployments. Frequency: ${formatFrequency(weeklyDeploymentFrequency).replace('/week', ' deployments/week')}. Failure rate: ${formatPct(avgFailureRate)}. Coverage: ${coveragePct}%.`
      : `Synthesis of ${totalDeployments} deployments. Weekly frequency: ${formatFrequency(weeklyDeploymentFrequency).replace('/week', ' deployments/week')} (baseline: ${baselineFrequency} deployments/week). Success rate: ${formatPct(deploymentSuccessRate)}. Failure rate: ${formatPct(avgFailureRate)}. Frequency improvement: ${formatDelta(frequencyImprovement)}. Coverage: ${coveragePct}%. No GitHub deployment metrics available.`,
    operationalImpact: hasLiveData
      ? `Throughput acceleration delivers features faster, but ${formatPct(avgFailureRate)} failure rate adds rollback effort.`
      : `Throughput acceleration delivers features faster, but ${formatPct(avgFailureRate)} failure rate adds rollback effort.`,
    primaryRisk: 'Velocity-stability tradeoff indicates quality gate compression.',
    cohort: 'Strategic Risk',
    confidenceReasoning: hasLiveData
      ? `${confidence} confidence based on ${totalDeployments} deployments with ${coveragePct}% data coverage. Maturity: Needs more deployment history.`
      : 'Low confidence based on synthesized throughput and failure patterns requiring validation with deployment lifecycle data. Maturity: Needs more deployment history.',
    recommendationState: avgFailureRate > 5 ? 'action_required' : 'monitor_only',
    urgencyLabel: avgFailureRate > 5 ? 'action_required' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/deployOperate.ts',
    featureFlagState: true,
    attributionStatus: hasLiveData ? (hasByIdeReliability ? 'ide_attributed' : 'org_level_only') : 'ide_attributed',
    evidence: hasLiveData
      ? [
          { metric: 'Frequency', value: formatFrequency(weeklyDeploymentFrequency).replace('/week', ' deployments/week'), label: 'Current' },
          { metric: 'Baseline', value: baselineFrequency + ' deployments/week', label: 'Target' },
          { metric: 'Improvement', value: formatDelta(frequencyImprovement), label: 'Above/below' },
          { metric: 'Failure Rate', value: formatPct(avgFailureRate), label: 'Quality' },
          { metric: 'Success Rate', value: formatPct(deploymentSuccessRate), label: 'Stability' }
        ]
      : [
          { metric: 'Weekly Frequency', value: formatFrequency(weeklyDeploymentFrequency).replace('/week', ' deployments/week'), label: 'current deployment rate' },
          { metric: 'Baseline Frequency', value: baselineFrequency + ' deployments/week', label: 'target baseline' },
          { metric: 'Throughput Acceleration', value: formatDelta(frequencyImprovement), label: 'above baseline' },
          { metric: 'Success Rate', value: formatPct(deploymentSuccessRate), label: 'deployment stability' },
          { metric: 'Failure Rate', value: formatPct(avgFailureRate), label: 'quality pressure' }
        ],
    breakdownByTool: hasLiveData && hasByIdeReliability
      ? Object.fromEntries(
          qualifyingReliabilityWorkflows.map(w => [
            w.name,
            {
              value: w.weeklyFrequency,
              count: w.count,
              formatted: formatFrequency(w.weeklyFrequency).replace('/week', ' deployments/week'),
              label: getCanonicalWorkflowIdentity(w.name)
            }
          ])
        )
      : undefined,
    operationalRead: hasLiveData
      ? `Frequency: ${formatFrequency(weeklyDeploymentFrequency).replace('/week', ' deployments/week')}, failure rate: ${formatPct(avgFailureRate)}.`
      : `Frequency: ${formatFrequency(weeklyDeploymentFrequency).replace('/week', ' deployments/week')}, failure rate: ${formatPct(avgFailureRate)}. Org-level GitHub signal; workflow attribution unavailable.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    demoFlag: hasLiveData ? undefined : 'demo_primary',
    demoNarrativePriority: hasLiveData ? undefined : 90,
    dataSource: hasLiveData ? 'live' : 'seeded'
  };

  return baseInsight;
}

/**
 * Generate release stability divergence PI
 *
 * OPERATIONAL NARRATIVE: Release stability divergence across workflows
 *
 * This insight identifies when different IDE workflows show significantly different
 * deployment reliability patterns, indicating workflow-specific coordination bottlenecks
 * or inconsistent quality gate enforcement across the engineering organization.
 *
 * Unlike the velocity-stability insight which focuses on throughput masking quality,
 * this insight focuses on workflow divergence as an organizational coordination issue.
 *
 * Uses seeded demo data as production-grade evidence for demo mode.
 * Synthesizes from deployment_metrics signals: success/failure by workflow attribution.
 *
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateExecutiveStableDeploymentAcceleration(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('executive-stable-deployment-acceleration');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};
  const hasLiveData = githubSnapshot.deployment_metrics && Object.keys(githubSnapshot.deployment_metrics).length > 0;

  // TEMPORARY RUNTIME PROOF LOGGING
  piDebugLog('[RUNTIME_PROOF][executive-stable-deployment-acceleration]', {
    insightId: 'executive-stable-deployment-acceleration',
    stage: 'deploy-operate',
    hasLiveData,
    seededFallbackUsed: !hasLiveData,
    githubSnapshotKeys: Object.keys(githubSnapshot),
    deploymentMetricsKeys: githubSnapshot.deployment_metrics ? Object.keys(githubSnapshot.deployment_metrics) : [],
    deploymentMetricsValue: githubSnapshot.deployment_metrics,
    sessionRowsCount: totalSessions
  });

  let cursorSuccessRate = 0;
  let windsurfSuccessRate = 0;
  let vscodeSuccessRate = 0;
  let avgSuccessRate = 0;
  let stabilityDivergence = 0;
  let totalDeployments = 0;

  if (!hasLiveData) {
    piDebugLog('[GENERATOR_STABLE_DEPLOYMENT][NO_LIVE_DATA]', { totalSessions, hasLiveData });
    return null;
  }

  {
    // Compute from live GitHub deployment metrics data
    // API returns flat fields: deployment_metrics.deployment_frequency, failed_deployment_count, success_deployment_count
    const deploymentMetrics = githubSnapshot.deployment_metrics;
    totalDeployments = deploymentMetrics.deployment_frequency || (deploymentMetrics.failed_deployment_count || 0) + (deploymentMetrics.success_deployment_count || 0);
    // Calculate success rate from failed/success counts
    const failedCount = deploymentMetrics.failed_deployment_count || 0;
    const successCount = deploymentMetrics.success_deployment_count || 0;
    avgSuccessRate = totalDeployments > 0 ? (successCount / totalDeployments) * 100 : 0;

    // Try to get IDE-specific success rates if available
    if (deploymentMetrics.by_ide) {
      cursorSuccessRate = deploymentMetrics.by_ide.cursor?.success_rate || avgSuccessRate;
      windsurfSuccessRate = deploymentMetrics.by_ide.windsurf?.success_rate || avgSuccessRate;
      vscodeSuccessRate = deploymentMetrics.by_ide.vscode?.success_rate || avgSuccessRate;
    } else {
      // Fallback to average if no IDE breakdown
      cursorSuccessRate = avgSuccessRate;
      windsurfSuccessRate = avgSuccessRate;
      vscodeSuccessRate = avgSuccessRate;
    }

    // Calculate stability divergence
    stabilityDivergence = Math.round(Math.max(cursorSuccessRate, windsurfSuccessRate, vscodeSuccessRate) - Math.min(cursorSuccessRate, windsurfSuccessRate, vscodeSuccessRate));
  }

  const baselineStability = 95;
  const delta = avgSuccessRate - baselineStability;
  const deltaPct = baselineStability > 0 ? ((avgSuccessRate - baselineStability) / baselineStability) * 100 : 0;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalDeployments >= 50 ? 'high' : totalDeployments >= 20 ? 'medium' : 'low';
  const coveragePct = hasLiveData ? 100 : 100;

  // Generate narrative based on data source
  let description: string;
  let whatChanged: string;
  let whyItMatters: string;
  let recommendation: string;

  if (hasLiveData) {
    description = `Release stability varies across workflows: ${formatPct(cursorSuccessRate)} (${getCanonicalWorkflowIdentity('cursor')}), ${formatPct(windsurfSuccessRate)} (${getCanonicalWorkflowIdentity('windsurf')}), ${formatPct(vscodeSuccessRate)} (${getCanonicalWorkflowIdentity('vscode')}). Stability divergence: ${stabilityDivergence}%. Inconsistent deployment quality creates operational chaos.`;
    whatChanged = `Stability divergence: ${stabilityDivergence}% between highest and lowest stability workflows. Average: ${formatPct(avgSuccessRate)}.`;
    whyItMatters = 'Inconsistent deployment quality creates operational chaos.';
    recommendation = stabilityDivergence > 5
      ? 'Stability divergence indicates organizational coordination variance. Standardize quality gate enforcement across workflows.'
      : 'Set up automated stability divergence alerts when AI workflow success rate drops below 95%.';
  } else {
    description = `Release stability varies significantly across workflows (observed period): ${getCanonicalWorkflowIdentity('cursor')} ${formatPct(cursorSuccessRate)} stable (highest), ${getCanonicalWorkflowIdentity('windsurf')} ${formatPct(windsurfSuccessRate)} stable (lowest), ${getCanonicalWorkflowIdentity('vscode')} ${formatPct(vscodeSuccessRate)} stable (baseline). This ${stabilityDivergence}% divergence between highest and lowest stability workflows indicates organizational coordination variance in quality gate enforcement across IDE/tool workflows. ${getCanonicalWorkflowIdentity('windsurf')}'s lower stability indicates AI workflows encounter different quality gate standards.`;
    whatChanged = `${getCanonicalWorkflowIdentity('cursor')} shows ${formatPct(cursorSuccessRate)} release stability while ${getCanonicalWorkflowIdentity('windsurf')} drops to ${formatPct(windsurfSuccessRate)} — a ${stabilityDivergence}% divergence. ${getCanonicalWorkflowIdentity('vscode')} maintains ${formatPct(vscodeSuccessRate)} as baseline. The gap indicates inconsistent quality gate enforcement across IDE/tool workflows, meaning ${getCanonicalWorkflowIdentity('windsurf')} AI-generated commits may encounter weaker pre-deployment validation than ${getCanonicalWorkflowIdentity('cursor')}.`;
    whyItMatters = `Inconsistent deployment quality creates operational chaos.`;
    recommendation = stabilityDivergence > 5
      ? `${getCanonicalWorkflowIdentity('windsurf')} stability divergence indicates organizational coordination variance. If ${getCanonicalWorkflowIdentity('windsurf')} stability remains below ${getCanonicalWorkflowIdentity('cursor')} workflows, standardize quality gate enforcement across all IDE/tool workflows to eliminate coordination gaps.`
      : `Configure automated alerts when ${getCanonicalWorkflowIdentity('windsurf')} stability drops below 95%. Implement cross-workflow quality gate standardization if divergence persists.`;
  }

  // ============================================================
  // NARRATIVE ENHANCEMENT: Workflow Stability Divergence
  // ============================================================
  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: registryEntry.title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'synthesized',
    comparisonMode: 'absolute',
    current: avgSuccessRate,
    baseline: baselineStability,
    delta,
    deltaPct,
    rightMetric: formatPct(avgSuccessRate) + ' release stability',
    rightMetricLabel: 'Release Stability',
    metricDefinition: 'Deployment success rate across workflows to identify stability divergence',
    polarity: 'higher_is_better' as const, // Higher stability is better (higher is better)
    operationalBreadcrumbs: [
      `${getCanonicalWorkflowIdentity('cursor')}: ${formatPct(cursorSuccessRate)}`,
      `${getCanonicalWorkflowIdentity('windsurf')}: ${formatPct(windsurfSuccessRate)}`,
      `${getCanonicalWorkflowIdentity('vscode')}: ${formatPct(vscodeSuccessRate)}`,
      `Divergence: ${stabilityDivergence}%`
    ],
    confidence,
    coveragePct,
    n: totalDeployments,
    hasData: true,
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: hasLiveData
      ? `Analysis of ${totalDeployments} deployments. Stability divergence: ${stabilityDivergence}%. Coverage: ${coveragePct}%.`
      : `Analysis of ${totalDeployments} deployments. ${getCanonicalWorkflowIdentity('cursor')}: ${formatPct(cursorSuccessRate)} success rate. ${getCanonicalWorkflowIdentity('windsurf')}: ${formatPct(windsurfSuccessRate)} success rate. ${getCanonicalWorkflowIdentity('vscode')}: ${formatPct(vscodeSuccessRate)} success rate. Stability divergence: ${stabilityDivergence}%. Coverage: ${coveragePct}%. No GitHub deployment metrics available.`,
    operationalImpact: hasLiveData
      ? `Stability divergence creates organizational coordination inconsistency.`
      : `Stability divergence of ${stabilityDivergence}% creates organizational coordination inconsistency.`,
    primaryRisk: 'Stability divergence indicates organizational coordination variance in quality gate enforcement.',
    cohort: 'Executive Finding',
    confidenceReasoning: hasLiveData
      ? `${confidence} confidence based on ${totalDeployments} deployments with ${coveragePct}% data coverage. Maturity: Needs more deployment history.`
      : 'Medium confidence based on synthesized divergence metric from workflow stability comparison. While directional signals are consistent, the stability divergence is an inferred composite rather than direct measurement. Maturity: Needs more deployment history.',
    recommendationState: stabilityDivergence > 5 ? 'action_required' : 'monitor_only',
    urgencyLabel: stabilityDivergence > 5 ? 'action_required' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/deployOperate.ts',
    featureFlagState: true,
    evidence: hasLiveData
      ? [
          { metric: getCanonicalWorkflowIdentity('cursor'), value: formatPct(cursorSuccessRate), label: 'Stability' },
          { metric: getCanonicalWorkflowIdentity('windsurf'), value: formatPct(windsurfSuccessRate), label: 'Stability' },
          { metric: getCanonicalWorkflowIdentity('vscode'), value: formatPct(vscodeSuccessRate), label: 'Stability' },
          { metric: 'Divergence', value: `${stabilityDivergence}%`, label: 'Variance' },
          { metric: 'Deployments', value: totalDeployments.toString(), label: 'Total' }
        ]
      : [
          { metric: `${getCanonicalWorkflowIdentity('cursor')} Stability`, value: formatPct(cursorSuccessRate), label: 'highest stability' },
          { metric: `${getCanonicalWorkflowIdentity('windsurf')} Stability`, value: formatPct(windsurfSuccessRate), label: 'lowest stability' },
          { metric: `${getCanonicalWorkflowIdentity('vscode')} Stability`, value: formatPct(vscodeSuccessRate), label: 'baseline stability' },
          { metric: 'Stability Divergence', value: `${stabilityDivergence}%`, label: 'workflow variance' },
          { metric: 'Deployments', value: totalDeployments, label: 'evidence base' }
        ],
    breakdownByTool: hasLiveData
      ? {
          cursor: { value: cursorSuccessRate, count: Math.floor(totalDeployments * 0.33), formatted: formatPct(cursorSuccessRate), label: getCanonicalWorkflowIdentity('cursor') },
          windsurf: { value: windsurfSuccessRate, count: Math.floor(totalDeployments * 0.33), formatted: formatPct(windsurfSuccessRate), label: getCanonicalWorkflowIdentity('windsurf') },
          vscode: { value: vscodeSuccessRate, count: Math.floor(totalDeployments * 0.34), formatted: formatPct(vscodeSuccessRate), label: getCanonicalWorkflowIdentity('vscode') }
        }
      : {
          cursor: { value: cursorSuccessRate, count: Math.floor(totalDeployments * 0.30), formatted: `${formatPct(cursorSuccessRate)} success rate`, label: `${getCanonicalWorkflowIdentity('cursor')} (stable)` },
          windsurf: { value: windsurfSuccessRate, count: Math.floor(totalDeployments * 0.25), formatted: `${formatPct(windsurfSuccessRate)} success rate`, label: `${getCanonicalWorkflowIdentity('windsurf')} (divergent)` },
          vscode: { value: vscodeSuccessRate, count: Math.floor(totalDeployments * 0.45), formatted: `${formatPct(vscodeSuccessRate)} success rate`, label: `${getCanonicalWorkflowIdentity('vscode')} (baseline)` }
        },
    operationalRead: hasLiveData
      ? `Stability divergence: ${stabilityDivergence}% between workflows.`
      : `${getCanonicalWorkflowIdentity('cursor')}: ${formatPct(cursorSuccessRate)} stable (highest - ${stabilityDivergence}% gap). ${getCanonicalWorkflowIdentity('windsurf')}: ${formatPct(windsurfSuccessRate)} stable (lowest - AI workflow divergence). ${getCanonicalWorkflowIdentity('vscode')}: ${formatPct(vscodeSuccessRate)} stable (baseline). Workflow divergence means inconsistent quality gate enforcement. Standardize across workflows.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    demoFlag: hasLiveData ? undefined : 'demo_primary',
    demoNarrativePriority: hasLiveData ? undefined : 90,
    dataSource: hasLiveData ? 'live' : 'seeded'
  };

  return baseInsight;
}

// ─── CR-X Track D: Deploy & Operate delivery outcomes ───────────
// Org-level delivery evidence until L1/L2 attribution is available.

/**
 * Deployment success and failure distribution.
 * Source: deployment_metrics + deployment_reliability (success/failed counts,
 * success_rate, production/staging split). Visual distribution, not just text.
 * Org-level only until L1/L2 attribution lands.
 */
export function generateDeploymentSuccessDistribution(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('deployment-success-distribution');
  if (!registryEntry) return null;

  const githubSnapshot = input.githubSnapshot || {};
  const deploymentMetrics = githubSnapshot.deployment_metrics || {};
  const reliability = deploymentMetrics.deployment_reliability || {};
  const totalFromApi = (deploymentMetrics.success_deployment_count || 0) + (deploymentMetrics.failed_deployment_count || 0);
  const hasLiveData = hasAuthoritativeGithubEvidence(githubSnapshot, totalFromApi);

  const success = reliability.success ?? deploymentMetrics.success_deployment_count ?? 0;
  const failed = reliability.failed ?? deploymentMetrics.failed_deployment_count ?? 0;
  const total = reliability.total ?? totalFromApi;

  if (!hasLiveData || total <= 0) {
    piDebugLog('[GENERATOR_DEPLOY_SUCCESS_DIST][NO_DATA]', { hasLiveData, total, success, failed });
    return null;
  }

  const attribution = getDeliveryAttribution(input.sessionRows || [], githubSnapshot, input._engineCache);
  const successRate = total > 0 ? (success / total) * 100 : 0;
  const failureRate = total > 0 ? (failed / total) * 100 : 0;
  const baseline = 90;
  const delta = successRate - baseline;
  const deltaPct = baseline > 0 ? ((successRate - baseline) / baseline) * 100 : 0;
  const confidence: ConfidenceLevel = total >= 50 ? 'high' : total >= 20 ? 'medium' : 'low';

  return {
    id: registryEntry.id,
    title: `${formatPct(successRate)} deployment success rate across ${total} deployments`,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'distribution',
    presentationKind: 'success_failure_distribution',
    comparisonMode: 'threshold_vs_actual',
    comparisonState: attribution.canAttributeToWorkflow ? 'workflow_attributed' : 'org_level_only',
    attributionStatus: attribution.status,
    current: successRate,
    baseline,
    delta,
    deltaPct,
    rightMetric: `${success} success / ${failed} failed`,
    rightMetricLabel: 'Deployment Outcomes',
    metricValue: successRate,
    displayValue: formatPct(successRate),
    displayUnit: '% success',
    metricDefinition: 'Percentage of deployments that succeeded (success / total) with success/failure distribution.',
    polarity: 'higher_is_better',
    operationalBreadcrumbs: [`${success} successful`, `${failed} failed`, `${total} total`, attribution.provenanceLabel],
    confidence,
    coveragePct: 100,
    n: total,
    hasData: true,
    dataDomain: 'github_delivery',
    sourceLabel: 'GitHub delivery',
    sampleUnit: 'deployments',
    sampleLabel: `${total} deployments`,
    description: `Deployment success rate is ${formatPct(successRate)} (${success} successful, ${failed} failed of ${total} deployments), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${formatPct(baseline)} baseline. ${attribution.provenanceLabel}`,
    whatChanged: `Success rate: ${formatPct(successRate)} vs ${formatPct(baseline)} baseline (${formatDelta(deltaPct)} ${deltaPct > 0 ? 'above' : 'below'}). ${failed} of ${total} deployments failed (${formatPct(failureRate)}).`,
    whyItMatters: 'Failed deployments disrupt delivery and can impact production stability.',
    recommendation: delta < -5
      ? 'Investigate failed deployments and deployment pipeline reliability. Concentrate on the highest-failure environments.'
      : 'Monitor deployment success rate alongside deployment frequency and failure concentration.',
    evidenceAndContext: `Analysis of ${total} deployments. ${success} succeeded (${formatPct(successRate)}), ${failed} failed (${formatPct(failureRate)}). Baseline: ${formatPct(baseline)}. ${attribution.provenanceLabel}`,
    operationalImpact: `Deployment success rate of ${formatPct(successRate)} affects delivery reliability.`,
    primaryRisk: 'Failed deployments disrupt delivery and production stability.',
    cohort: 'Reliability Signal',
    confidenceReasoning: `${confidence} confidence based on ${total} deployments. ${attribution.provenanceLabel}`,
    recommendationState: delta < -5 ? 'action_required' : 'monitor_only',
    urgencyLabel: delta < -5 ? 'action_required' : 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/deployOperate.ts',
    featureFlagState: true,
    evidence: [
      { metric: 'Success rate', value: formatPct(successRate), label: 'Current' },
      { metric: 'Success / failed', value: `${success} / ${failed}`, label: 'Distribution' },
      { metric: 'Total deployments', value: String(total), label: 'Sample' },
      { metric: 'Attribution', value: attribution.canAttributeToWorkflow ? attribution.maxLevel : 'Org-wide', label: 'Status' },
    ],
    outcomeComposition: {
      success,
      failed,
      total,
      successRate,
      failureRate,
      productionTotal: reliability.production_total ?? 0,
      productionFailed: reliability.production_failed ?? 0,
      stagingTotal: reliability.staging_total ?? 0,
      rollbackCount: reliability.rollback_count ?? 0,
    } as any,
    operationalRead: `Success rate: ${formatPct(successRate)} (${success}/${total}), failure rate: ${formatPct(failureRate)}.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
  };
}

/**
 * Release cadence — releases published per week over the observed window.
 * Source: release_metrics.releases_in_period over the githubByPeriod window.
 * Org-level only until L1/L2 attribution lands.
 */
export function generateReleaseCadence(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('release-cadence');
  if (!registryEntry) return null;

  const githubSnapshot = input.githubSnapshot || {};
  const releaseMetrics = githubSnapshot.release_metrics || {};
  const totalDeploymentsFromApi = (githubSnapshot.deployment_metrics?.success_deployment_count || 0) + (githubSnapshot.deployment_metrics?.failed_deployment_count || 0);
  const hasLiveData = hasAuthoritativeGithubEvidence(githubSnapshot, totalDeploymentsFromApi);

  const releasesInPeriod = releaseMetrics.releases_in_period ?? releaseMetrics.total_releases ?? 0;

  if (!hasLiveData || releasesInPeriod <= 0) {
    piDebugLog('[GENERATOR_RELEASE_CADENCE][NO_DATA]', { hasLiveData, releasesInPeriod });
    return null;
  }

  const attribution = getDeliveryAttribution(input.sessionRows || [], githubSnapshot, input._engineCache);
  const githubByPeriod = input.githubByPeriod || [];
  const weeks = githubByPeriod.length > 0 ? githubByPeriod.length : (releasesInPeriod > 20 ? 13 : 4);
  const cadence = releasesInPeriod / weeks;
  const baseline = 1;
  const delta = cadence - baseline;
  const deltaPct = baseline > 0 ? ((cadence - baseline) / baseline) * 100 : 0;
  const confidence: ConfidenceLevel = releasesInPeriod >= 10 ? 'high' : releasesInPeriod >= 5 ? 'medium' : 'low';

  const latest = releaseMetrics.latest_release;

  return {
    id: registryEntry.id,
    title: `${formatFrequency(cadence)} release cadence across ${releasesInPeriod} releases`,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'threshold',
    presentationKind: 'outcome_threshold',
    comparisonMode: 'threshold_vs_actual',
    comparisonState: attribution.canAttributeToWorkflow ? 'workflow_attributed' : 'org_level_only',
    attributionStatus: attribution.status,
    current: cadence,
    baseline,
    delta,
    deltaPct,
    rightMetric: `${releasesInPeriod} releases`,
    rightMetricLabel: 'Release Volume',
    metricValue: cadence,
    displayValue: formatFrequency(cadence),
    displayUnit: 'releases/week',
    metricDefinition: 'Number of releases published per week over the observed delivery window.',
    polarity: 'higher_is_better',
    operationalBreadcrumbs: [`${releasesInPeriod} releases`, `${weeks} weeks`, attribution.provenanceLabel],
    confidence,
    coveragePct: 100,
    n: releasesInPeriod,
    hasData: true,
    dataDomain: 'github_delivery',
    sourceLabel: 'GitHub delivery',
    sampleUnit: 'releases',
    sampleLabel: `${releasesInPeriod} releases over ${weeks} weeks`,
    description: `Release cadence is ${formatFrequency(cadence)} (${releasesInPeriod} releases over ${weeks} weeks), ${deltaPct > 0 ? formatDelta(deltaPct) + ' above' : formatDelta(Math.abs(deltaPct)) + ' below'} the ${formatFrequency(baseline)} baseline. ${attribution.provenanceLabel}`,
    whatChanged: `Release cadence: ${formatFrequency(cadence)} vs ${formatFrequency(baseline)} baseline (${formatDelta(deltaPct)} ${deltaPct > 0 ? 'above' : 'below'}).`,
    whyItMatters: 'Release cadence reflects how often completed work reaches users.',
    recommendation: 'Monitor release cadence alongside deployment frequency and merge cycle time.',
    evidenceAndContext: `Analysis of ${releasesInPeriod} releases over ${weeks} weeks. Cadence: ${formatFrequency(cadence)}. Baseline: ${formatFrequency(baseline)}. ${attribution.provenanceLabel}`,
    operationalImpact: `Release cadence of ${formatFrequency(cadence)} reflects delivery to users.`,
    primaryRisk: 'Low release cadence may indicate completed work not reaching users promptly.',
    cohort: 'Velocity Signal',
    confidenceReasoning: `${confidence} confidence based on ${releasesInPeriod} releases over ${weeks} weeks. ${attribution.provenanceLabel}`,
    recommendationState: 'monitor_only',
    urgencyLabel: 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/deployOperate.ts',
    featureFlagState: true,
    evidence: [
      { metric: 'Cadence', value: formatFrequency(cadence), label: 'Current' },
      { metric: 'Releases', value: String(releasesInPeriod), label: 'Sample' },
      { metric: 'Window', value: `${weeks} weeks`, label: 'Period' },
      ...(latest ? [{ metric: 'Latest release', value: latest.tag_name ?? '—', label: 'Latest' }] : []),
      { metric: 'Attribution', value: attribution.canAttributeToWorkflow ? attribution.maxLevel : 'Org-wide', label: 'Status' },
    ],
    operationalRead: `Release cadence: ${formatFrequency(cadence)} vs baseline ${formatFrequency(baseline)}.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
  };
}

/**
 * Deployment failure concentration — where failures concentrate
 * (production vs staging, rollback share).
 * Source: deployment_reliability (production_failed, production_total,
 * staging_total, rollback_count). Org-level only until L1/L2 attribution lands.
 */
export function generateDeploymentFailureConcentration(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('deployment-failure-concentration');
  if (!registryEntry) return null;

  const githubSnapshot = input.githubSnapshot || {};
  const deploymentMetrics = githubSnapshot.deployment_metrics || {};
  const reliability = deploymentMetrics.deployment_reliability || {};
  const totalFromApi = (deploymentMetrics.success_deployment_count || 0) + (deploymentMetrics.failed_deployment_count || 0);
  const hasLiveData = hasAuthoritativeGithubEvidence(githubSnapshot, totalFromApi);

  const failed = reliability.failed ?? deploymentMetrics.failed_deployment_count ?? 0;
  const productionFailed = reliability.production_failed ?? 0;
  const productionTotal = reliability.production_total ?? 0;
  const rollbackCount = reliability.rollback_count ?? 0;

  if (!hasLiveData || failed <= 0) {
    piDebugLog('[GENERATOR_DEPLOY_FAIL_CONC][NO_DATA]', { hasLiveData, failed, productionFailed });
    return null;
  }

  const attribution = getDeliveryAttribution(input.sessionRows || [], githubSnapshot, input._engineCache);
  const prodFailureShare = failed > 0 ? (productionFailed / failed) * 100 : 0;
  const rollbackShare = failed > 0 ? (rollbackCount / failed) * 100 : 0;
  const prodFailureRate = productionTotal > 0 ? (productionFailed / productionTotal) * 100 : 0;
  const confidence: ConfidenceLevel = failed >= 20 ? 'high' : failed >= 10 ? 'medium' : 'low';

  const concentrationLevel = prodFailureShare >= 70 ? 'high' : prodFailureShare >= 40 ? 'moderate' : 'low';

  return {
    id: registryEntry.id,
    title: productionFailed === 0
      ? `${failed} observed deployment failure${failed === 1 ? '' : 's'} — none in production`
      : prodFailureShare >= 100
        ? `All ${productionFailed} observed deployment failures happened in production`
        : `${productionFailed} of ${failed} observed deployment failures happened in production`,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'distribution',
    presentationKind: 'failure_concentration',
    comparisonMode: 'absolute',
    comparisonState: attribution.canAttributeToWorkflow ? 'workflow_attributed' : 'org_level_only',
    attributionStatus: attribution.status,
    current: prodFailureShare,
    baseline: 50,
    delta: prodFailureShare - 50,
    deltaPct: 0,
    rightMetric: `${failed} failed deployments`,
    rightMetricLabel: 'Production failure share',
    metricValue: prodFailureShare,
    displayValue: formatPct(prodFailureShare),
    displayUnit: '% prod',
    metricDefinition: 'Share of failed deployments concentrated in production, plus rollback share. Environment concentration, not workflow attribution.',
    polarity: 'lower_is_better',
    operationalBreadcrumbs: [`${productionFailed} prod failures`, `${failed} total failures`, `${rollbackCount} rollbacks`, attribution.provenanceLabel],
    confidence,
    coveragePct: 100,
    n: failed,
    hasData: true,
    dataDomain: 'github_delivery',
    sourceLabel: 'GitHub delivery',
    sampleUnit: 'failed deployments',
    sampleLabel: `${failed} failed deployments`,
    description: `${formatPct(prodFailureShare)} of ${failed} failed deployments occurred in production (${productionFailed} of ${productionTotal} production deployments, ${formatPct(prodFailureRate)} production failure rate). ${rollbackCount} rollbacks detected (${formatPct(rollbackShare)} of failures). ${concentrationLevel} concentration. ${attribution.provenanceLabel}`,
    whatChanged: `Production failure share: ${formatPct(prodFailureShare)} of ${failed} failures. Production failure rate: ${formatPct(prodFailureRate)}. Rollbacks: ${rollbackCount} (${formatPct(rollbackShare)} of failures).`,
    whyItMatters: 'Failures concentrated in production have higher customer impact than staging failures.',
    recommendation: prodFailureShare >= 70
      ? 'High production failure concentration. Strengthen pre-production validation and staging fidelity before promoting changes.'
      : 'Monitor failure concentration by environment. Track rollback share as a stability signal.',
    evidenceAndContext: `Analysis of ${failed} failed deployments. ${productionFailed} in production (${formatPct(prodFailureShare)} of failures, ${formatPct(prodFailureRate)} production failure rate). ${rollbackCount} rollbacks (${formatPct(rollbackShare)} of failures). ${attribution.provenanceLabel}`,
    operationalImpact: `Production failure concentration of ${formatPct(prodFailureShare)} affects customer-facing stability.`,
    primaryRisk: 'Production-concentrated failures have direct customer impact.',
    cohort: 'Reliability Signal',
    confidenceReasoning: `${confidence} confidence based on ${failed} failed deployments. ${attribution.provenanceLabel}`,
    recommendationState: prodFailureShare >= 70 ? 'action_required' : 'monitor_only',
    urgencyLabel: prodFailureShare >= 70 ? 'action_required' : 'investigate',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/deployOperate.ts',
    featureFlagState: true,
    evidence: [
      { metric: 'Prod failure share', value: formatPct(prodFailureShare), label: 'Concentration' },
      { metric: 'Prod failures / total', value: `${productionFailed} / ${failed}`, label: 'Distribution' },
      { metric: 'Prod failure rate', value: formatPct(prodFailureRate), label: 'Rate' },
      { metric: 'Rollbacks', value: String(rollbackCount), label: 'Rollback count' },
      { metric: 'Attribution', value: attribution.canAttributeToWorkflow ? attribution.maxLevel : 'Org-wide', label: 'Status' },
    ],
    outcomeComposition: {
      failed,
      productionFailed,
      productionTotal,
      rollbackCount,
      prodFailureShare,
      rollbackShare,
      concentrationLevel,
    } as any,
    operationalRead: `Production failure share: ${formatPct(prodFailureShare)} of ${failed} failures. Rollbacks: ${rollbackCount}.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
  };
}

/**
 * Generate all Deploy & Operate stage canonical insights
 *
 * RESTORED: Return all 4 canonical deploy-operate PIs as defined in canonicalInsights.ts
 * - generateDeliveryVelocityByWorkflow: Delivery velocity by workflow
 * - generateChangeFailureRateSpikeByIDE: Change failure rate spike by IDE
 * - generateDeploymentReliabilityPressure: Deployment reliability pressure
 * - generateExecutiveStableDeploymentAcceleration: Executive stable deployment acceleration
 *
 * @param input - Canonical insight input data
 * @returns Array of canonical insights for Deploy & Operate stage
 */
export function generateDeployOperateInsights(input: CanonicalInsightInput): CanonicalInsight[] {
  piDebugLog('[FINAL_PI_TRACE][DEPLOY_OPERATE_START]', 'Generating Deploy & Operate insights');
  piDebugLog('[FINAL_PI_TRACE][INPUT_SESSIONS]', input.sessionRows?.length || 0);
  piDebugLog('[FINAL_PI_TRACE][INPUT_GITHUB]', !!input.githubSnapshot);

  const generators = [
    { id: 'deployment-success-distribution', fn: () => generateDeploymentSuccessDistribution(input) },
    { id: 'release-cadence', fn: () => generateReleaseCadence(input) },
    { id: 'deployment-failure-concentration', fn: () => generateDeploymentFailureConcentration(input) },
    { id: 'delivery-velocity-by-workflow', fn: () => generateDeliveryVelocityByWorkflow(input) },
    { id: 'change-failure-rate-spike-by-ide', fn: () => generateChangeFailureRateSpikeByIDE(input) },
    { id: 'synthesized-deployment-cadence', fn: () => generateDeploymentReliabilityPressure(input) },
    { id: 'allocated-spend-per-deployment', fn: () => generateAllocatedSpendPerDeployment(input, input.externalCostConfigs) },
    { id: 'allocated-spend-per-successful-deployment', fn: () => generateAllocatedSpendPerSuccessfulDeployment(input, input.externalCostConfigs) },
    { id: 'allocated-spend-per-failed-deployment', fn: () => generateAllocatedSpendPerFailedDeployment(input, input.externalCostConfigs) },
    { id: 'allocated-spend-per-release', fn: () => generateAllocatedSpendPerRelease(input, input.externalCostConfigs) }
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

  piDebugLog('[FINAL_PI_TRACE][DEPLOY_OPERATE_RESULTS]', {
    totalCalled: generators.length,
    nonNullCount: insights.length,
    insightIds: insights.map(i => i.id)
  });

  return insights.filter((insight): insight is CanonicalInsight => insight !== null);
}
