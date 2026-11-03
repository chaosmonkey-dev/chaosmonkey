/**
 * PI Engine Audit Utilities
 * 
 * Provides automated verification of final PI engine provenance.
 * No console dependency - all audit data available via window.__PI_AUDIT.
 */

import type { PerformanceInsight } from '../adapters/renderAdapter';
import { getCanonicalPIIds } from '../canonicalInsights';
import { piDebugLog } from './logging';

/**
 * Expected canonical PI IDs (14 total)
 */
const EXPECTED_CANONICAL_IDS = [
  'active-coding-time-by-ide',
  'delivery-rate-ai-vs-non-ai',
  'telemetry-ai-focus-imbalance',
  'session-conditioned-pr-cycle-time-ai-vs-non-ai',
  'executive-ai-yield-optimization',
  'reopen-pressure-spike',
  'reviewer-load-concentration',
  'revert-rate-by-ide',
  'executive-ai-reopen-pressure-risk',
  'executive-small-pr-workflow-optimization',
  'delivery-velocity-by-workflow',
  'change-failure-rate-spike-by-ide',
  'synthesized-deployment-cadence',
  'executive-stable-deployment-acceleration'
];

/**
 * Detailed PI tracking structure
 */
export interface PIAuditDetail {
  id: string;
  title: string;
  sourceEngine: 'FINAL_ENGINE_V1' | 'LEGACY_V2' | 'UNKNOWN';
  generatorSource?: string;
  stage?: string;
  rendered: boolean;
  filteredReason?: string;
  confidence?: string;
  isStub: boolean;
  hasData: boolean;
  suppressionReason?: string; // Specific data-based reason for suppression
  suppressionCategory?: 'insufficient_sample' | 'missing_field' | 'no_comparison_data' | 'degraded_confidence' | 'none';
}

/**
 * Audit result structure
 */
export interface PIAuditResult {
  pass: boolean;
  errors: string[];
  warnings: string[];
  engineBreakdown: {
    finalEngineCount: number;
    legacyEngineCount: number;
    idsByEngine: {
      finalEngine: string[];
      legacyEngine: string[];
    };
  };
  implementationBreakdown: {
    stubCount: number;
    realCount: number;
    stubIds: string[];
    realIds: string[];
  };
  canonicalCoverage: {
    expectedIds: string[];
    presentIds: string[];
    missingIds: string[];
    duplicateIds: string[];
  };
  stageCounts: {
    'plan-code': number;
    'review-merge': number;
    'deploy-operate': number;
  };
  featureFlagState: boolean;
  fallbackActivated: boolean;
  totalInsights: number;
  filteredOutCount: number;
  piDetails: PIAuditDetail[];
  suppressedIds: string[]; // IDs of suppressed insights
  suppressedReasons: Record<string, string>; // ID -> specific suppression reason
}

/**
 * Check if a PI is a stub implementation
 * 
 * A PI is considered a stub if:
 * - It has no data (hasData: false)
 * - It has placeholder values (current: 0, n: 0)
 * - It has TODO in description or recommendation
 */
function isStubPI(insight: PerformanceInsight): boolean {
  const hasNoData = !insight.hasData;
  const hasPlaceholderValues = insight.n === 0 && insight.current === 0;
  const hasTodoMarkers = 
    (insight.description?.toLowerCase().includes('todo')) ||
    (insight.recommendation?.toLowerCase().includes('todo')) ||
    (insight.executiveSummary?.toLowerCase().includes('todo'));
  
  return hasNoData || hasPlaceholderValues || hasTodoMarkers;
}

/**
 * Run final PI audit
 * 
 * Analyzes insights to verify:
 * - Expected canonical IDs are present
 * - No duplicate IDs exist
 * - Engine routing worked correctly
 * - Stage counts are correct
 * - Feature flag state matches engine counts
 * - Stub vs real implementation breakdown
 * - Suppression reasons are tracked
 * 
 * @param insights - Array of performance insights to audit
 * @param featureFlagEnabled - Whether FINAL_PI_ENGINE_ENABLED is set
 * @param suppressedInsights - Insights suppressed by realism pipeline (optional)
 * @returns Audit result object
 */
export function runFinalPIAudit(
  insights: PerformanceInsight[],
  featureFlagEnabled: boolean,
  suppressedInsights: PerformanceInsight[] = [],
  zeroEvidence: boolean = false
): PIAuditResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Get canonical IDs from registry (single source of truth)
  const canonicalIds = getCanonicalPIIds();

  // Count by engine
  const finalEngineIds: string[] = [];
  const legacyEngineIds: string[] = [];

  // Track stub vs real implementations
  const stubIds: string[] = [];
  const realIds: string[] = [];

  // Track suppression reasons
  const suppressedIds: string[] = suppressedInsights.map(i => i.id);
  const suppressedReasons: Record<string, string> = {};

  // Detailed PI tracking
  const piDetails: PIAuditDetail[] = [];

  for (const insight of insights) {
    const isStub = isStubPI(insight);
    
    if (isStub) {
      stubIds.push(insight.id);
    } else {
      realIds.push(insight.id);
    }

    const detail: PIAuditDetail = {
      id: insight.id,
      title: insight.title || 'Unknown',
      sourceEngine: insight.engineVersion || 'UNKNOWN',
      generatorSource: insight.generatorSource,
      stage: insight.cicdStage,
      rendered: true,
      confidence: insight.confidence,
      isStub,
      hasData: insight.hasData || false
    };

    if (insight.engineVersion === 'FINAL_ENGINE_V1') {
      finalEngineIds.push(insight.id);
    } else if (insight.engineVersion === 'LEGACY_V2') {
      legacyEngineIds.push(insight.id);
    } else {
      warnings.push(`Insight ${insight.id} has no engine version set`);
      detail.filteredReason = 'No engine version set';
    }

    piDetails.push(detail);
  }

  // Add suppressed insights to audit details with specific reasons
  for (const suppressed of suppressedInsights) {
    const reason = determineSuppressionReason(suppressed);
    suppressedReasons[suppressed.id] = reason;
    
    const detail: PIAuditDetail = {
      id: suppressed.id,
      title: suppressed.title || 'Unknown',
      sourceEngine: suppressed.engineVersion || 'UNKNOWN',
      generatorSource: suppressed.generatorSource,
      stage: suppressed.cicdStage,
      rendered: false,
      filteredReason: reason,
      confidence: suppressed.confidence,
      isStub: isStubPI(suppressed),
      hasData: suppressed.hasData || false,
      suppressionReason: reason,
      suppressionCategory: categorizeSuppressionReason(reason)
    };
    
    piDetails.push(detail);
  }

  const finalEngineCount = finalEngineIds.length;
  const legacyEngineCount = legacyEngineIds.length;

  // Check for duplicate IDs
  const allIds = insights.map(i => i.id);
  const idCounts = new Map<string, number>();
  const duplicateIds: string[] = [];

  for (const id of allIds) {
    const count = (idCounts.get(id) || 0) + 1;
    idCounts.set(id, count);
    if (count > 1) {
      duplicateIds.push(id);
    }
  }

  if (duplicateIds.length > 0) {
    errors.push(`Duplicate IDs found: ${duplicateIds.join(', ')}`);
  }

  // Check for missing canonical IDs
  const presentIds = new Set(allIds);
  const missingIds = Array.from(canonicalIds).filter(id => !presentIds.has(id));

  // Check if canonical IDs are present when feature flag is enabled.
  // zeroEvidence: a fresh pilot with zero telemetry/GitHub evidence
  // legitimately produces zero insights — that is truthful fail-closed
  // empty state, NOT an engine routing failure.
  if (featureFlagEnabled && finalEngineCount === 0 && !zeroEvidence) {
    errors.push('Feature flag enabled but final engine count is 0 - all canonical PIs missing');
  }

  // Check if feature flag disabled but final engine count > 0
  if (!featureFlagEnabled && finalEngineCount > 0) {
    errors.push('Feature flag disabled but final engine count > 0 - inconsistent state');
  }

  // Count by stage
  const stageCounts = {
    'plan-code': 0,
    'review-merge': 0,
    'deploy-operate': 0
  };

  for (const insight of insights) {
    if (insight.cicdStage && stageCounts[insight.cicdStage as keyof typeof stageCounts] !== undefined) {
      stageCounts[insight.cicdStage as keyof typeof stageCounts]++;
    }
  }

  // Determine if fallback activated. Zero-evidence runs produce an
  // intentional empty result, not a fallback.
  const fallbackActivated = featureFlagEnabled && finalEngineCount === 0 && !zeroEvidence;

  // Overall pass status
  const pass = errors.length === 0;

  return {
    pass,
    errors,
    warnings,
    engineBreakdown: {
      finalEngineCount,
      legacyEngineCount,
      idsByEngine: {
        finalEngine: finalEngineIds,
        legacyEngine: legacyEngineIds
      }
    },
    implementationBreakdown: {
      stubCount: stubIds.length,
      realCount: realIds.length,
      stubIds,
      realIds
    },
    canonicalCoverage: {
      expectedIds: Array.from(canonicalIds),
      presentIds: allIds,
      missingIds,
      duplicateIds
    },
    stageCounts,
    featureFlagState: featureFlagEnabled,
    fallbackActivated,
    totalInsights: insights.length,
    filteredOutCount: 0, // Will be populated by caller
    piDetails,
    suppressedIds,
    suppressedReasons
  };
}

/**
 * Determine specific suppression reason for an insight
 */
function determineSuppressionReason(insight: PerformanceInsight): string {
  // Check for insufficient sample size
  if (insight.n !== undefined && insight.n < 10) {
    return `insufficient_sample_size (${insight.n} sessions < 10 minimum)`;
  }
  
  // Check for missing data
  if (!insight.hasData) {
    return 'missing_data (hasData: false)';
  }
  
  // Check for low confidence
  if (insight.confidence === 'low') {
    return 'degraded_confidence (confidence: low)';
  }
  
  // Check for missing breakdown data
  if (!insight.breakdownByTool || Object.keys(insight.breakdownByTool).length < 2) {
    return 'no_comparison_data (insufficient tool breakdown)';
  }
  
  // Check for missing GitHub/delivery fields
  const id = insight.id;
  if (id.includes('deployment') || id.includes('change-failure')) {
    if (!insight.evidence || insight.evidence.length === 0) {
      return 'missing_field (no deployment_metrics evidence)';
    }
  }
  
  if (id.includes('review') || id.includes('pr-')) {
    if (!insight.evidence || insight.evidence.length === 0) {
      return 'missing_field (no pr_review_metrics evidence)';
    }
  }
  
  // Default reason
  return 'suppressed_by_realism_pipeline';
}

/**
 * Categorize suppression reason
 */
function categorizeSuppressionReason(reason: string): 'insufficient_sample' | 'missing_field' | 'no_comparison_data' | 'degraded_confidence' | 'none' {
  if (reason.includes('insufficient_sample')) return 'insufficient_sample';
  if (reason.includes('missing_field') || reason.includes('missing_data')) return 'missing_field';
  if (reason.includes('no_comparison')) return 'no_comparison_data';
  if (reason.includes('degraded_confidence') || reason.includes('confidence')) return 'degraded_confidence';
  return 'none';
}

/**
 * Populate window.__PI_AUDIT with audit data
 * 
 * This makes audit data available to:
 * - PIEngineAuditPanel.vue component
 * - Windsurf/Cascade for automated verification
 * - Manual inspection without DevTools
 * 
 * @param insights - Array of performance insights to audit
 * @param featureFlagEnabled - Whether FINAL_PI_ENGINE_ENABLED is set
 * @param filteredOutCount - Number of insights filtered out (e.g., canonical IDs from legacy)
 * @param suppressedInsights - Insights suppressed by realism pipeline
 */
export function populateWindowPIAudit(
  insights: PerformanceInsight[],
  featureFlagEnabled: boolean,
  filteredOutCount: number = 0,
  suppressedInsights: PerformanceInsight[] = [],
  zeroEvidence: boolean = false
): void {
  const auditResult = runFinalPIAudit(insights, featureFlagEnabled, suppressedInsights, zeroEvidence);
  auditResult.filteredOutCount = filteredOutCount;

  (window as any).__PI_AUDIT = {
    featureFlagEnabled: auditResult.featureFlagState,
    finalEngineCount: auditResult.engineBreakdown.finalEngineCount,
    legacyEngineCount: auditResult.engineBreakdown.legacyEngineCount,
    idsByEngine: auditResult.engineBreakdown.idsByEngine,
    stubCount: auditResult.implementationBreakdown.stubCount,
    realCount: auditResult.implementationBreakdown.realCount,
    stubIds: auditResult.implementationBreakdown.stubIds,
    realIds: auditResult.implementationBreakdown.realIds,
    missingCanonicalIds: auditResult.canonicalCoverage.missingIds,
    duplicateIds: auditResult.canonicalCoverage.duplicateIds,
    stageCounts: auditResult.stageCounts,
    fallbackActivated: auditResult.fallbackActivated,
    totalInsights: auditResult.totalInsights,
    filteredOutCount: auditResult.filteredOutCount,
    suppressedIds: auditResult.suppressedIds,
    suppressedReasons: auditResult.suppressedReasons,
    errors: auditResult.errors,
    warnings: auditResult.warnings,
    pass: auditResult.pass,
    piDetails: auditResult.piDetails,
    timestamp: Date.now()
  };

  piDebugLog('[PI_AUDIT][WINDOW_POPULATED]', 'window.__PI_AUDIT populated', (window as any).__PI_AUDIT);
}
