/**
 * Performance Insights Registry - Phase 0-1
 * 
 * Canonical registry for PI identity, stage, and source mapping.
 * Provides single source of truth for ID management and visibility tracking.
 */

export type PIStage = 'plan_code' | 'review_merge' | 'deploy_operate';
export type PISource = 'v1' | 'v2';

export interface PIRegistryEntry {
  id: string;              // canonical id
  stage: PIStage;
  source: PISource;        // current source of truth
  v1?: { 
    ruleId: string; 
    metricId?: string; 
    computeFn: string;
  };
  v2?: { 
    rowId: string; 
    computeFn: string;
  };
  title?: string;
  dedupeKey?: string;
}

/**
 * MVP Curated PIs (15 total: 7/4/4 split) + TTFC + Delivery Rate
 * 
 * This is the minimal subset for Phase 0-1.
 * Expanded to full inventory in future phases.
 */
export const PI_REGISTRY: Record<string, PIRegistryEntry> = {
  // === PLAN & CODE (7 PIs) ===
  'commits-per-session-by-ide': {
    id: 'commits-per-session-by-ide',
    stage: 'plan_code',
    source: 'v2',
    v2: { rowId: 'commits-per-session-by-ide', computeFn: 'computeCommitsPerSessionByIDE' },
    title: 'Commits per Session by IDE',
    dedupeKey: 'commits_per_session'
  },
  'active-coding-time-by-ide': {
    id: 'active-coding-time-by-ide',
    stage: 'plan_code',
    source: 'v2',
    v2: { rowId: 'active-coding-time-by-ide', computeFn: 'computeActiveCodingTimeByIDE' },
    title: 'Active Coding Time by IDE',
    dedupeKey: 'active_coding_time'
  },
  'ai-suggestions-accepted-by-ide': {
    id: 'ai-suggestions-accepted-by-ide',
    stage: 'plan_code',
    source: 'v2',
    v2: { rowId: 'ai-suggestions-accepted-by-ide', computeFn: 'computeAISuggestionsAcceptedByIDE' },
    title: 'AI Suggestions Accepted by IDE',
    dedupeKey: 'ai_suggestions_accepted'
  },
  'average-session-length-by-ide': {
    id: 'average-session-length-by-ide',
    stage: 'plan_code',
    source: 'v2',
    v2: { rowId: 'average-session-length-by-ide', computeFn: 'computeAverageSessionLengthByIDE' },
    title: 'Average Session Length by IDE',
    dedupeKey: 'session_length'
  },
  'time-to-first-commit-by-ide': {
    id: 'time-to-first-commit-by-ide',
    stage: 'plan_code',
    source: 'v2',
    v2: { rowId: 'time-to-first-commit-by-ide', computeFn: 'computeTimeToFirstCommitByIDE' },
    title: 'Time to First Commit by IDE',
    dedupeKey: 'ttfc'
  },
  'rework-rate-by-ide': {
    id: 'rework-rate-by-ide',
    stage: 'plan_code',
    source: 'v2',
    v2: { rowId: 'rework-rate-by-ide', computeFn: 'computeReworkRateByIDE' },
    title: 'Rework Rate by IDE',
    dedupeKey: 'rework_rate'
  },
  'delivery-rate-ai-vs-non-ai': {
    id: 'delivery-rate-ai-vs-non-ai',
    stage: 'plan_code',
    source: 'v2',
    v2: { rowId: 'delivery-rate-ai-vs-non-ai', computeFn: 'computeDeliveryRateAIVsNonAI' },
    title: 'Delivery Rate: AI vs Non-AI',
    dedupeKey: 'delivery_rate'
  },

  // === NEW ADDITIVE PLAN & CODE PIs (3) ===
  'telemetry-session-quality-regression': {
    id: 'telemetry-session-quality-regression',
    stage: 'plan_code',
    source: 'v2',
    v2: { rowId: 'telemetry-session-quality-regression', computeFn: 'computeTelemetrySessionQualityRegression' },
    title: 'Session Quality Regression',
    dedupeKey: 'session_quality_regression'
  },
  'telemetry-ai-focus-imbalance': {
    id: 'telemetry-ai-focus-imbalance',
    stage: 'plan_code',
    source: 'v2',
    v2: { rowId: 'telemetry-ai-focus-imbalance', computeFn: 'computeTelemetryAIFocusImbalance' },
    title: 'AI Focus Imbalance',
    dedupeKey: 'ai_focus_imbalance'
  },
  'telemetry-remote-workspace-drag': {
    id: 'telemetry-remote-workspace-drag',
    stage: 'plan_code',
    source: 'v2',
    v2: { rowId: 'telemetry-remote-workspace-drag', computeFn: 'computeTelemetryRemoteWorkspaceDrag' },
    title: 'Remote Workspace Drag',
    dedupeKey: 'remote_workspace_drag'
  },

  // === REVIEW & MERGE (7 PIs) ===
  'session-conditioned-pr-cycle-time-ai-vs-non-ai': {
    id: 'session-conditioned-pr-cycle-time-ai-vs-non-ai',
    stage: 'review_merge',
    source: 'v2',
    v2: { rowId: 'session-conditioned-pr-cycle-time-ai-vs-non-ai', computeFn: 'computeSessionConditionedPRCycleTimeAIVsNonAI' },
    title: 'PR Cycle Time: AI vs Non-AI',
    dedupeKey: 'pr_cycle_time_ai'
  },
  'session-conditioned-change-risk-ai-vs-non-ai': {
    id: 'session-conditioned-change-risk-ai-vs-non-ai',
    stage: 'review_merge',
    source: 'v2',
    v2: { rowId: 'session-conditioned-change-risk-ai-vs-non-ai', computeFn: 'computeSessionConditionedChangeRiskAIVsNonAI' },
    title: 'Change Risk: AI vs Non-AI',
    dedupeKey: 'change_risk_ai'
  },
  'branch-stagnation-risk-ai-vs-non-ai': {
    id: 'branch-stagnation-risk-ai-vs-non-ai',
    stage: 'review_merge',
    source: 'v2',
    v2: { rowId: 'branch-stagnation-risk-ai-vs-non-ai', computeFn: 'computeBranchStagnationRiskAIVsNonAI' },
    title: 'Branch Stagnation Risk: AI vs Non-AI',
    dedupeKey: 'branch_stagnation_ai'
  },
  'revert-rate-by-ide': {
    id: 'revert-rate-by-ide',
    stage: 'review_merge',
    source: 'v2',
    v2: { rowId: 'revert-rate-by-ide', computeFn: 'computeRevertRateByIDE' },
    title: 'Revert Rate by IDE',
    dedupeKey: 'revert_rate'
  },
  'review-latency-spike-by-ide': {
    id: 'review-latency-spike-by-ide',
    stage: 'review_merge',
    source: 'v2',
    v2: { rowId: 'review-latency-spike-by-ide', computeFn: 'computeReviewLatencySpikeByIDE' },
    title: 'Review Latency Spike by IDE',
    dedupeKey: 'review_latency'
  },
  'pr-review-cycles-by-ide': {
    id: 'pr-review-cycles-by-ide',
    stage: 'review_merge',
    source: 'v2',
    v2: { rowId: 'pr-review-cycles-by-ide', computeFn: 'computePRReviewCyclesByIDE' },
    title: 'PR Review Cycles by IDE',
    dedupeKey: 'pr_review_cycles'
  },

  // === NEW ADDITIVE REVIEW & MERGE PIs (3) ===
  'reviewer-load-concentration': {
    id: 'reviewer-load-concentration',
    stage: 'review_merge',
    source: 'v2',
    v2: { rowId: 'reviewer-load-concentration', computeFn: 'computeReviewerLoadConcentration' },
    title: 'Reviewer Load Concentration',
    dedupeKey: 'reviewer_load'
  },
  'reopen-pressure-spike': {
    id: 'reopen-pressure-spike',
    stage: 'review_merge',
    source: 'v2',
    v2: { rowId: 'reopen-pressure-spike', computeFn: 'computeReopenPressureSpike' },
    title: 'Reopen Pressure Spike',
    dedupeKey: 'reopen_pressure'
  },
  'large-pr-mix-risk': {
    id: 'large-pr-mix-risk',
    stage: 'review_merge',
    source: 'v2',
    v2: { rowId: 'large-pr-mix-risk', computeFn: 'computeLargePRMixRisk' },
    title: 'Large PR Mix Risk',
    dedupeKey: 'large_pr_risk'
  },

  // === DEPLOY & OPERATE (7 PIs) ===
  'mttr-by-ide': {
    id: 'mttr-by-ide',
    stage: 'deploy_operate',
    source: 'v2',
    v2: { rowId: 'mttr-by-ide', computeFn: 'computeMTTRByIDE' },
    title: 'MTTR by IDE',
    dedupeKey: 'mttr'
  },
  'deployment-frequency-volatility-by-ide': {
    id: 'deployment-frequency-volatility-by-ide',
    stage: 'deploy_operate',
    source: 'v2',
    v2: { rowId: 'deployment-frequency-volatility-by-ide', computeFn: 'computeDeploymentFrequencyVolatilityByIDE' },
    title: 'Deployment Frequency Volatility by IDE',
    dedupeKey: 'deployment_volatility'
  },
  'change-failure-rate-spike-by-ide': {
    id: 'change-failure-rate-spike-by-ide',
    stage: 'deploy_operate',
    source: 'v2',
    v2: { rowId: 'change-failure-rate-spike-by-ide', computeFn: 'computeChangeFailureRateSpikeByIDE' },
    title: 'Change Failure Rate Spike by IDE',
    dedupeKey: 'change_failure_rate'
  },
  'delivery-velocity-by-workflow': {
    id: 'delivery-velocity-by-workflow',
    stage: 'deploy_operate',
    source: 'v2',
    v2: { rowId: 'delivery-velocity-by-workflow', computeFn: 'computeDeliveryVelocityByWorkflow' },
    title: 'Delivery Velocity by Workflow',
    dedupeKey: 'delivery_velocity'
  },
  'fast-but-unstable-org': {
    id: 'fast-but-unstable-org',
    stage: 'deploy_operate',
    source: 'v2',
    v2: { rowId: 'fast-but-unstable-org', computeFn: 'computeFastButUnstableOrg' },
    title: 'Fast But Unstable Org',
    dedupeKey: 'fast_unstable'
  },

  // === NEW ADDITIVE DEPLOY & OPERATE PIs (3) ===
  'stale-deployment-signal': {
    id: 'stale-deployment-signal',
    stage: 'deploy_operate',
    source: 'v2',
    v2: { rowId: 'stale-deployment-signal', computeFn: 'computeStaleDeploymentSignal' },
    title: 'Stale Deployment Signal',
    dedupeKey: 'stale_deployment'
  },
  'failed-deployment-pressure': {
    id: 'failed-deployment-pressure',
    stage: 'deploy_operate',
    source: 'v2',
    v2: { rowId: 'failed-deployment-pressure', computeFn: 'computeFailedDeploymentPressure' },
    title: 'Failed Deployment Pressure',
    dedupeKey: 'failed_deployment'
  },
  'latest-deployment-unhealthy': {
    id: 'latest-deployment-unhealthy',
    stage: 'deploy_operate',
    source: 'v2',
    v2: { rowId: 'latest-deployment-unhealthy', computeFn: 'computeLatestDeploymentUnhealthy' },
    title: 'Latest Deployment Unhealthy',
    dedupeKey: 'deployment_health'
  }
};

// === PHASE 0.4: Runtime Inventory Proof ===
export function logRegistryProof(): void {
  const entries = Object.values(PI_REGISTRY);
  const total = entries.length;
  
  const stageCounts = entries.reduce((acc, entry) => {
    acc[entry.stage] = (acc[entry.stage] || 0) + 1;
    return acc;
  }, {} as Record<PIStage, number>);
  
  const missingMappings = entries.filter(entry => {
    if (entry.source === 'v1' && !entry.v1) return true;
    if (entry.source === 'v2' && !entry.v2) return true;
    return false;
  });
  
  const dedupeKeyCounts = entries.reduce((acc, entry) => {
    if (entry.dedupeKey) {
      acc[entry.dedupeKey] = (acc[entry.dedupeKey] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);
  
  const duplicateDedupeKeys = Object.entries(dedupeKeyCounts)
    .filter(([_, count]) => count > 1)
    .map(([key]) => key);
  
  console.info('[PI_REGISTRY_PROOF]', {
    total,
    stages: stageCounts,
    missingMappings: missingMappings.map(e => e.id),
    duplicateDedupeKeys,
    sources: {
      v1: entries.filter(e => e.source === 'v1').length,
      v2: entries.filter(e => e.source === 'v2').length
    }
  });
}

// === PHASE 1.1: Registry Helper Functions ===
export function getRegistryEntry(id: string): PIRegistryEntry | null {
  return PI_REGISTRY[id] || null;
}

export function listRegistryByStage(stage: PIStage): PIRegistryEntry[] {
  return Object.values(PI_REGISTRY).filter(entry => entry.stage === stage);
}

export function getMVPAllowlist(): string[] {
  return Object.values(PI_REGISTRY).map(entry => entry.id);
}
