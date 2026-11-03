/**
 * Phase C: Insight Classification Metadata System
 * 
 * Internal classification for Performance Insights without gating visibility.
 * Tracks which insights improve as seeded data arrives and identifies flagship candidates.
 */

export type InsightClassification = 
  | 'flagship_candidate'
  | 'needs_seed_data'
  | 'telemetry_gap'
  | 'workflow_intelligence'
  | 'operational_risk'
  | 'ai_roi_candidate'
  | 'review_pipeline'
  | 'deployment_pipeline'
  | 'weak_comparison'
  | 'mature_metric';

export type InsightDataRequirement = 
  | 'telemetry_sessions'
  | 'github_pr_analytics'
  | 'github_review_metrics'
  | 'github_deployment_metrics'
  | 'github_events_api'
  | 'git_diff_analysis'
  | 'cross_system_correlation';

export type InsightExecutiveReadiness = 
  | 'demo_ready'
  | 'narrative_strong'
  | 'needs_enhancement'
  | 'data_sparse'
  | 'broken_mapping';

export interface InsightMetadata {
  id: string;
  classifications: InsightClassification[];
  dataRequirements: InsightDataRequirement[];
  executiveReadiness: InsightExecutiveReadiness;
  flagshipPotential: number; // 0-100 score
  narrativeStrength: number; // 0-100 score
  dataSaturationPriority: 'high' | 'medium' | 'low';
  operationalImpact: 'strategic' | 'tactical' | 'diagnostic';
  aiRoiRelevance: boolean;
  workflowIntelligenceValue: boolean;
  deploymentStabilitySignal: boolean;
  reviewEfficiencySignal: boolean;
}

/**
 * Insight Classification Metadata
 * 
 * This map tracks internal classifications without affecting visibility.
 * All insights remain visible, but we track their evolution toward flagship status.
 */
export const INSIGHT_CLASSIFICATIONS: Record<string, InsightMetadata> = {
  // PLAN & CODE STAGE - Mature Metrics
  'commits-per-session-by-ide': {
    id: 'commits-per-session-by-ide',
    classifications: ['mature_metric', 'workflow_intelligence'],
    dataRequirements: ['telemetry_sessions', 'github_pr_analytics'],
    executiveReadiness: 'demo_ready',
    flagshipPotential: 85,
    narrativeStrength: 90,
    dataSaturationPriority: 'low',
    operationalImpact: 'tactical',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'active-coding-time-by-ide': {
    id: 'active-coding-time-by-ide',
    classifications: ['mature_metric', 'workflow_intelligence'],
    dataRequirements: ['telemetry_sessions'],
    executiveReadiness: 'demo_ready',
    flagshipPotential: 80,
    narrativeStrength: 85,
    dataSaturationPriority: 'low',
    operationalImpact: 'tactical',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'ai-suggestions-accepted-by-ide': {
    id: 'ai-suggestions-accepted-by-ide',
    classifications: ['flagship_candidate', 'ai_roi_candidate'],
    dataRequirements: ['telemetry_sessions'],
    executiveReadiness: 'demo_ready',
    flagshipPotential: 95,
    narrativeStrength: 95,
    dataSaturationPriority: 'low',
    operationalImpact: 'strategic',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'average-session-length-by-ide': {
    id: 'average-session-length-by-ide',
    classifications: ['mature_metric', 'workflow_intelligence'],
    dataRequirements: ['telemetry_sessions'],
    executiveReadiness: 'narrative_strong',
    flagshipPotential: 70,
    narrativeStrength: 75,
    dataSaturationPriority: 'low',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'time-to-first-commit-by-ide': {
    id: 'time-to-first-commit-by-ide',
    classifications: ['flagship_candidate', 'workflow_intelligence'],
    dataRequirements: ['telemetry_sessions', 'github_pr_analytics'],
    executiveReadiness: 'demo_ready',
    flagshipPotential: 90,
    narrativeStrength: 88,
    dataSaturationPriority: 'low',
    operationalImpact: 'tactical',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },

  // REVIEW & MERGE STAGE - Needs Seed Data
  'pr-cycle-time-by-ide': {
    id: 'pr-cycle-time-by-ide',
    classifications: ['flagship_candidate', 'review_pipeline', 'needs_seed_data'],
    dataRequirements: ['github_pr_analytics', 'github_review_metrics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 92,
    narrativeStrength: 85,
    dataSaturationPriority: 'high',
    operationalImpact: 'strategic',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: true,
  },
  
  'revert-rate-by-ide': {
    id: 'revert-rate-by-ide',
    classifications: ['operational_risk', 'review_pipeline', 'needs_seed_data'],
    dataRequirements: ['github_pr_analytics', 'github_events_api'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 88,
    narrativeStrength: 80,
    dataSaturationPriority: 'high',
    operationalImpact: 'strategic',
    aiRoiRelevance: true,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: true,
  },
  
  'pr-size-by-ide': {
    id: 'pr-size-by-ide',
    classifications: ['review_pipeline', 'workflow_intelligence', 'needs_seed_data'],
    dataRequirements: ['github_pr_analytics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 75,
    narrativeStrength: 70,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: true,
  },
  
  'pr-review-cycles-by-ide': {
    id: 'pr-review-cycles-by-ide',
    classifications: ['review_pipeline', 'needs_seed_data'],
    dataRequirements: ['github_pr_analytics', 'github_review_metrics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 82,
    narrativeStrength: 75,
    dataSaturationPriority: 'high',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: true,
  },
  
  'reviewer-load-concentration': {
    id: 'reviewer-load-concentration',
    classifications: ['flagship_candidate', 'review_pipeline', 'needs_seed_data'],
    dataRequirements: ['github_review_metrics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 90,
    narrativeStrength: 85,
    dataSaturationPriority: 'high',
    operationalImpact: 'strategic',
    aiRoiRelevance: false,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: true,
  },
  
  'reopen-pressure-spike': {
    id: 'reopen-pressure-spike',
    classifications: ['operational_risk', 'review_pipeline', 'needs_seed_data'],
    dataRequirements: ['github_pr_analytics', 'github_events_api'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 85,
    narrativeStrength: 80,
    dataSaturationPriority: 'high',
    operationalImpact: 'strategic',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: true,
  },
  
  'large-pr-mix-risk': {
    id: 'large-pr-mix-risk',
    classifications: ['operational_risk', 'review_pipeline', 'needs_seed_data'],
    dataRequirements: ['github_pr_analytics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 83,
    narrativeStrength: 78,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: true,
  },
  
  'v2-first-review-latency': {
    id: 'v2-first-review-latency',
    classifications: ['flagship_candidate', 'review_pipeline', 'needs_seed_data'],
    dataRequirements: ['github_review_metrics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 88,
    narrativeStrength: 82,
    dataSaturationPriority: 'high',
    operationalImpact: 'strategic',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: true,
  },

  // DEPLOY & OPERATE STAGE - Needs Seed Data
  'deployment-frequency-volatility-by-ide': {
    id: 'deployment-frequency-volatility-by-ide',
    classifications: ['deployment_pipeline', 'operational_risk', 'needs_seed_data'],
    dataRequirements: ['github_deployment_metrics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 80,
    narrativeStrength: 75,
    dataSaturationPriority: 'high',
    operationalImpact: 'strategic',
    aiRoiRelevance: false,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: false,
  },
  
  'change-failure-rate-trend-by-ide': {
    id: 'change-failure-rate-trend-by-ide',
    classifications: ['flagship_candidate', 'deployment_pipeline', 'operational_risk', 'needs_seed_data'],
    dataRequirements: ['github_deployment_metrics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 94,
    narrativeStrength: 90,
    dataSaturationPriority: 'high',
    operationalImpact: 'strategic',
    aiRoiRelevance: true,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: false,
  },
  
  'change-failure-rate-spike-by-ide': {
    id: 'change-failure-rate-spike-by-ide',
    classifications: ['operational_risk', 'deployment_pipeline', 'needs_seed_data'],
    dataRequirements: ['github_deployment_metrics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 78,
    narrativeStrength: 72,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: false,
  },
  
  'fast-but-unstable-by-ide': {
    id: 'fast-but-unstable-by-ide',
    classifications: ['flagship_candidate', 'deployment_pipeline', 'operational_risk', 'needs_seed_data'],
    dataRequirements: ['github_deployment_metrics', 'github_pr_analytics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 91,
    narrativeStrength: 87,
    dataSaturationPriority: 'high',
    operationalImpact: 'strategic',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: false,
  },
  
  'mttr-by-ide': {
    id: 'mttr-by-ide',
    classifications: ['deployment_pipeline', 'operational_risk', 'needs_seed_data'],
    dataRequirements: ['github_deployment_metrics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 84,
    narrativeStrength: 78,
    dataSaturationPriority: 'high',
    operationalImpact: 'strategic',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: false,
  },
  
  'stale-deployment-signal': {
    id: 'stale-deployment-signal',
    classifications: ['deployment_pipeline', 'operational_risk', 'needs_seed_data'],
    dataRequirements: ['github_deployment_metrics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 76,
    narrativeStrength: 70,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: false,
  },
  
  'failed-deployment-pressure': {
    id: 'failed-deployment-pressure',
    classifications: ['operational_risk', 'deployment_pipeline', 'needs_seed_data'],
    dataRequirements: ['github_deployment_metrics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 82,
    narrativeStrength: 76,
    dataSaturationPriority: 'high',
    operationalImpact: 'strategic',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: false,
  },
  
  'latest-deployment-unhealthy': {
    id: 'latest-deployment-unhealthy',
    classifications: ['deployment_pipeline', 'operational_risk', 'needs_seed_data'],
    dataRequirements: ['github_deployment_metrics'],
    executiveReadiness: 'data_sparse',
    flagshipPotential: 74,
    narrativeStrength: 68,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: false,
  },

  // AI ROI & WORKFLOW INTELLIGENCE
  'delivery-rate-ai-vs-non-ai': {
    id: 'delivery-rate-ai-vs-non-ai',
    classifications: ['flagship_candidate', 'ai_roi_candidate', 'workflow_intelligence'],
    dataRequirements: ['telemetry_sessions', 'github_pr_analytics'],
    executiveReadiness: 'demo_ready',
    flagshipPotential: 96,
    narrativeStrength: 94,
    dataSaturationPriority: 'low',
    operationalImpact: 'strategic',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'ai-rework-burden-ai-vs-non-ai': {
    id: 'ai-rework-burden-ai-vs-non-ai',
    classifications: ['flagship_candidate', 'ai_roi_candidate', 'operational_risk'],
    dataRequirements: ['telemetry_sessions', 'git_diff_analysis'],
    executiveReadiness: 'needs_enhancement',
    flagshipPotential: 89,
    narrativeStrength: 82,
    dataSaturationPriority: 'medium',
    operationalImpact: 'strategic',
    aiRoiRelevance: true,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'ai-yield-ratio-ai-vs-non-ai': {
    id: 'ai-yield-ratio-ai-vs-non-ai',
    classifications: ['ai_roi_candidate', 'workflow_intelligence'],
    dataRequirements: ['telemetry_sessions', 'github_pr_analytics'],
    executiveReadiness: 'narrative_strong',
    flagshipPotential: 77,
    narrativeStrength: 73,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'ai-assisted-delivery-impact': {
    id: 'ai-assisted-delivery-impact',
    classifications: ['flagship_candidate', 'ai_roi_candidate', 'workflow_intelligence'],
    dataRequirements: ['telemetry_sessions', 'github_pr_analytics'],
    executiveReadiness: 'demo_ready',
    flagshipPotential: 93,
    narrativeStrength: 91,
    dataSaturationPriority: 'low',
    operationalImpact: 'strategic',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },

  // WORKFLOW INTELLIGENCE
  'branch-stagnation-risk-ai-vs-non-ai': {
    id: 'branch-stagnation-risk-ai-vs-non-ai',
    classifications: ['workflow_intelligence', 'operational_risk'],
    dataRequirements: ['telemetry_sessions', 'github_pr_analytics'],
    executiveReadiness: 'narrative_strong',
    flagshipPotential: 72,
    narrativeStrength: 68,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'commit-abandonment-rate-ai-vs-non-ai': {
    id: 'commit-abandonment-rate-ai-vs-non-ai',
    classifications: ['workflow_intelligence', 'operational_risk'],
    dataRequirements: ['telemetry_sessions', 'github_pr_analytics'],
    executiveReadiness: 'narrative_strong',
    flagshipPotential: 74,
    narrativeStrength: 70,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'delivery-velocity-by-workflow': {
    id: 'delivery-velocity-by-workflow',
    classifications: ['workflow_intelligence'],
    dataRequirements: ['telemetry_sessions', 'github_pr_analytics'],
    executiveReadiness: 'narrative_strong',
    flagshipPotential: 78,
    narrativeStrength: 74,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },

  // TELEMETRY-SPECIFIC INSIGHTS
  'telemetry-ai-focus-imbalance': {
    id: 'telemetry-ai-focus-imbalance',
    classifications: ['workflow_intelligence', 'ai_roi_candidate'],
    dataRequirements: ['telemetry_sessions'],
    executiveReadiness: 'demo_ready',
    flagshipPotential: 81,
    narrativeStrength: 77,
    dataSaturationPriority: 'low',
    operationalImpact: 'tactical',
    aiRoiRelevance: true,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'telemetry-session-idle-time': {
    id: 'telemetry-session-idle-time',
    classifications: ['workflow_intelligence'],
    dataRequirements: ['telemetry_sessions'],
    executiveReadiness: 'narrative_strong',
    flagshipPotential: 69,
    narrativeStrength: 65,
    dataSaturationPriority: 'low',
    operationalImpact: 'diagnostic',
    aiRoiRelevance: false,
    workflowIntelligenceValue: true,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },

  // WEAK COMPARISONS (Need Enhancement)
  'session-conditioned-pr-cycle-time-ai-vs-non-ai': {
    id: 'session-conditioned-pr-cycle-time-ai-vs-non-ai',
    classifications: ['weak_comparison', 'needs_seed_data'],
    dataRequirements: ['telemetry_sessions', 'github_pr_analytics', 'github_review_metrics'],
    executiveReadiness: 'needs_enhancement',
    flagshipPotential: 65,
    narrativeStrength: 60,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: true,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: true,
  },
  
  'session-conditioned-change-risk-ai-vs-non-ai': {
    id: 'session-conditioned-change-risk-ai-vs-non-ai',
    classifications: ['weak_comparison', 'needs_seed_data'],
    dataRequirements: ['telemetry_sessions', 'github_pr_analytics', 'git_diff_analysis'],
    executiveReadiness: 'needs_enhancement',
    flagshipPotential: 63,
    narrativeStrength: 58,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: true,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'branches-per-session-by-ide': {
    id: 'branches-per-session-by-ide',
    classifications: ['weak_comparison'],
    dataRequirements: ['telemetry_sessions'],
    executiveReadiness: 'needs_enhancement',
    flagshipPotential: 60,
    narrativeStrength: 55,
    dataSaturationPriority: 'low',
    operationalImpact: 'diagnostic',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'code-churn-by-ide': {
    id: 'code-churn-by-ide',
    classifications: ['weak_comparison', 'needs_seed_data'],
    dataRequirements: ['telemetry_sessions', 'git_diff_analysis'],
    executiveReadiness: 'needs_enhancement',
    flagshipPotential: 62,
    narrativeStrength: 57,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: false,
  },
  
  'change-failure-rate-trend-org': {
    id: 'change-failure-rate-trend-org',
    classifications: ['weak_comparison', 'needs_seed_data'],
    dataRequirements: ['github_deployment_metrics'],
    executiveReadiness: 'needs_enhancement',
    flagshipPotential: 71,
    narrativeStrength: 66,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: false,
  },
  
  'fast-but-unstable-org': {
    id: 'fast-but-unstable-org',
    classifications: ['weak_comparison', 'needs_seed_data'],
    dataRequirements: ['github_deployment_metrics', 'github_pr_analytics'],
    executiveReadiness: 'needs_enhancement',
    flagshipPotential: 73,
    narrativeStrength: 68,
    dataSaturationPriority: 'medium',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: false,
  },
  
  'review-merge-git-context': {
    id: 'review-merge-git-context',
    classifications: ['telemetry_gap', 'needs_seed_data'],
    dataRequirements: ['github_pr_analytics', 'github_review_metrics'],
    executiveReadiness: 'broken_mapping',
    flagshipPotential: 67,
    narrativeStrength: 62,
    dataSaturationPriority: 'high',
    operationalImpact: 'tactical',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: false,
    reviewEfficiencySignal: true,
  },
  
  'v2-release-risk-index': {
    id: 'v2-release-risk-index',
    classifications: ['telemetry_gap', 'needs_seed_data'],
    dataRequirements: ['github_deployment_metrics', 'github_pr_analytics'],
    executiveReadiness: 'broken_mapping',
    flagshipPotential: 70,
    narrativeStrength: 64,
    dataSaturationPriority: 'high',
    operationalImpact: 'strategic',
    aiRoiRelevance: false,
    workflowIntelligenceValue: false,
    deploymentStabilitySignal: true,
    reviewEfficiencySignal: false,
  },
};

/**
 * Get insight metadata by ID
 */
export function getInsightMetadata(id: string): InsightMetadata | undefined {
  return INSIGHT_CLASSIFICATIONS[id];
}

/**
 * Get insights by classification
 */
export function getInsightsByClassification(classification: InsightClassification): InsightMetadata[] {
  return Object.values(INSIGHT_CLASSIFICATIONS).filter(metadata => 
    metadata.classifications.includes(classification)
  );
}

/**
 * Get flagship candidates (score >= 85)
 */
export function getFlagshipCandidates(): InsightMetadata[] {
  return Object.values(INSIGHT_CLASSIFICATIONS).filter(metadata => 
    metadata.flagshipPotential >= 85
  ).sort((a, b) => b.flagshipPotential - a.flagshipPotential);
}

/**
 * Get insights needing seed data
 */
export function getInsightsNeedingSeedData(): InsightMetadata[] {
  return Object.values(INSIGHT_CLASSIFICATIONS).filter(metadata => 
    metadata.classifications.includes('needs_seed_data')
  );
}

/**
 * Get insights with broken mappings
 */
export function getInsightsWithBrokenMappings(): InsightMetadata[] {
  return Object.values(INSIGHT_CLASSIFICATIONS).filter(metadata => 
    metadata.executiveReadiness === 'broken_mapping'
  );
}

/**
 * Get AI ROI relevant insights
 */
export function getAiRoiInsights(): InsightMetadata[] {
  return Object.values(INSIGHT_CLASSIFICATIONS).filter(metadata => 
    metadata.aiRoiRelevance
  ).sort((a, b) => b.flagshipPotential - a.flagshipPotential);
}

/**
 * Get workflow intelligence insights
 */
export function getWorkflowIntelligenceInsights(): InsightMetadata[] {
  return Object.values(INSIGHT_CLASSIFICATIONS).filter(metadata => 
    metadata.workflowIntelligenceValue
  ).sort((a, b) => b.narrativeStrength - a.narrativeStrength);
}

/**
 * Get operational risk insights
 */
export function getOperationalRiskInsights(): InsightMetadata[] {
  return Object.values(INSIGHT_CLASSIFICATIONS).filter(metadata => 
    metadata.classifications.includes('operational_risk')
  ).sort((_, b) => b.operationalImpact === 'strategic' ? 1 : -1);
}

/**
 * Get data saturation priority insights
 */
export function getDataSaturationPriority(priority: 'high' | 'medium' | 'low'): InsightMetadata[] {
  return Object.values(INSIGHT_CLASSIFICATIONS).filter(metadata => 
    metadata.dataSaturationPriority === priority
  );
}
