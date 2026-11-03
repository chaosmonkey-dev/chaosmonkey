/**
 * Final Canonical Performance Insights - Public API
 * 
 * This is the main entry point for the new canonical PI engine.
 * 
 * DATA FLOW:
 * 1. Dashboards.vue calls generateFinalCanonicalInsights(input)
 * 2. dataAccess.ts fetches data from APIs (telemetry, GitHub, metrics)
 * 3. Session primitives are computed from raw telemetry events
 * 4. Generators compute insights from data (by stage)
 * 5. Validation ensures output conforms to schema
 * 6. Ranking sorts insights by stage and renderOrder
 * 7. RenderAdapter adapts for UI contract
 * 8. PerformanceInsightsWidget.vue receives and renders insights
 * 
 * No imports from old V2 systems (computeV2PerformanceInsights.ts, piV2Manifest.ts, V2_PREVIEW_ROW_IDS)
 */

import type { CanonicalInsightInput, CanonicalInsight, DiagnosticReason } from './types';
import type { PerformanceInsight } from './adapters/renderAdapter';
import { fetchCanonicalInsightInput, determineDataMode, addDerivedSessionFields, isGithubEvidenceEligible, isGithubEvidenceEligibleCombined, INELIGIBLE_GITHUB_PROVENANCE_SOURCES } from './dataAccess';
import { normalizeToCanonicalToolId } from '../../workflowIdentity';

// Debug logging (gated behind VITE_PI_DEBUG)
import { piDebugLog } from './utils/logging';

const PI_DEBUG_ENABLED = typeof import.meta !== 'undefined' && import.meta.env?.VITE_PI_DEBUG === 'true';

// Generators
import { generatePlanCodeInsights } from './generators/planCode';
import { generateReviewMergeInsights } from './generators/reviewMerge';
import { generateDeployOperateInsights } from './generators/deployOperate';
// CR-X Pass 3: Early-signal + efficiency frontier generators (additive)
import { generateEarlySignalWorkflowAdoption, generateEarlySignalDeveloperActivity, generateDeveloperWorkflowCostEfficiencyFrontier, generateWorkflowCostDeliveryComparison, generateWorkflowDeliveryEfficiency, generateClaudeCodeRuntimeCohort } from './generators/earlySignal';
// CR-X P1B.2 Wave 1: Adaptive temporal intelligence
import { generateRecentChangeInsights } from './generators/recentChange';
// CR-X Wave 1B: Multi-dimensional analysis families
import { generateMultiDimensionalInsights } from './generators/multiDimensional';
// CR-X PI Product-Strength Wave: Executive temporal synthesis
import { generateExecutiveTemporalSynthesis } from './generators/executiveSynthesis';

// Canonical registry
import { getCanonicalPIIds, assertFinalCanonicalInventory, getCanonicalPIById, CANONICAL_PI_REGISTRY, isCanonicalInsightId, resolveCanonicalFamilyId } from './canonicalInsights';

// Global suppression tracking
let globalSuppressionDiagnostics: any[] = [];

export function getSuppressionDiagnostics(): any[] {
  return globalSuppressionDiagnostics;
}

export function clearSuppressionDiagnostics(): void {
  globalSuppressionDiagnostics = [];
}

export function addSuppressionDiagnostic(diagnostic: any): void {
  globalSuppressionDiagnostics.push(diagnostic);
}

// Coverage tracking
import { createDemoCoverageMatrix, logDemoCoverage, validateDemoCoverage } from './utils/demoCoverageMatrix';

// Validation
import { validateCanonicalInsights } from './utils/validation';

// Audit
import { populateWindowPIAudit } from './utils/audit';

// Ranking
import { sortCanonicalInsights, countInsightsByStage, getTopInsights, resolveFamilyForDiversity, stampSemanticFamilies } from './utils/ranking';

// WS2: Portfolio consolidation — suppress duplicates, consolidate per-workflow families
import { applyPortfolioConsolidation } from './utils/portfolioConsolidation';

// Render adapter
import { adaptCanonicalInsightsToUI, validateAdaptedInsights } from './adapters/renderAdapter';

// Diagnostic reason mapping for canonical coverage cards
const DIAGNOSTIC_REASON_MAPPING: Record<string, DiagnosticReason> = {
  'executive-ai-yield-optimization': 'NEEDS_OBSERVED_COMMIT_PROVENANCE',
  'ai-adoption-rate-by-ide': 'NEEDS_MORE_TELEMETRY',
  'debug-time-by-ide': 'INSTRUMENTATION_NOT_CAPTURED',
  'terminal-time-by-ide': 'INSTRUMENTATION_NOT_CAPTURED',
  'ai-intensity-delivery-velocity': 'NEEDS_SESSION_TO_PR_ATTRIBUTION',
  'review-burden-by-ai-pattern': 'NEEDS_SESSION_TO_PR_ATTRIBUTION',
  'reviewer-load-concentration': 'NEEDS_SESSION_TO_PR_ATTRIBUTION',
  'executive-small-pr-workflow-optimization': 'NEEDS_SESSION_TO_PR_ATTRIBUTION',
  'session-conditioned-pr-cycle-time-ai-vs-non-ai': 'NEEDS_SESSION_TO_PR_ATTRIBUTION',
  'delivery-rate-ai-vs-non-ai': 'NEEDS_OBSERVED_COMMIT_PROVENANCE',
  'time-to-first-commit-by-ide': 'NEEDS_OBSERVED_COMMIT_PROVENANCE',
  'within-workflow-ai-effect': 'NEEDS_MORE_TELEMETRY',
  'ai-intensity-cohort-analysis': 'NEEDS_MORE_TELEMETRY',
  'repository-concentration': 'NEEDS_MORE_TELEMETRY',
  'recent-change': 'NEEDS_MORE_TELEMETRY'
};

const DIAGNOSTIC_TITLE_MAPPING: Record<string, string> = {
  'executive-ai-yield-optimization': 'AI yield optimization needs observed commit provenance',
  'ai-adoption-rate-by-ide': 'AI adoption by IDE needs more workflow-attributed sessions',
  'debug-time-by-ide': 'Debug time instrumentation is not captured yet',
  'terminal-time-by-ide': 'Terminal time instrumentation is not captured yet',
  'ai-intensity-delivery-velocity': 'AI intensity impact needs session-to-PR attribution',
  'review-burden-by-ai-pattern': 'Review burden by AI pattern needs session-to-PR attribution',
  'reviewer-load-concentration': 'Reviewer load analysis needs reviewer workload data',
  'executive-small-pr-workflow-optimization': 'Small PR workflow analysis needs PR-size attribution',
  'session-conditioned-pr-cycle-time-ai-vs-non-ai': 'AI vs non-AI PR cycle time needs session-to-PR attribution',
  'delivery-rate-ai-vs-non-ai': 'Delivery rate comparison needs observed commit provenance',
  'time-to-first-commit-by-ide': 'Time to first commit needs observed commit-event attribution',
  'within-workflow-ai-effect': 'Within-workflow AI effect needs more AI-active and non-AI sessions',
  'ai-intensity-cohort-analysis': 'AI intensity cohort analysis needs more AI intensity variation',
  'repository-concentration': 'Repository concentration needs more sessions with repo attribution',
  'recent-change': 'Recent change analysis needs more observed history'
};

const DIAGNOSTIC_UNLOCK_PATH: Record<string, string> = {
  'NEEDS_MORE_TELEMETRY': 'Requires more telemetry sessions across workflows to establish reliable baseline',
  'WAITING_FOR_GITHUB': 'Requires GitHub connection to access PR, review, and deployment data',
  'NEEDS_SESSION_TO_PR_ATTRIBUTION': 'Requires session-to-PR correlation to link telemetry to GitHub outcomes',
  'NEEDS_OBSERVED_COMMIT_PROVENANCE': 'Requires directly observed commit events (not aggregated fallback) to produce actionable commit/TTFC insights',
  'INSTRUMENTATION_NOT_CAPTURED': 'Requires IDE instrumentation to capture debug/terminal activity',
  'ORG_LEVEL_ONLY_NO_IDE_ATTRIBUTION': 'Requires IDE attribution to compare workflows',
  'INSUFFICIENT_WORKFLOW_COMPARISON': 'Requires more developer/workflow diversity for comparison',
  'WAITING_FOR_GITHUB_DELIVERY_OUTCOMES': 'Requires GitHub delivery outcome fields (e.g. reopen events) not captured by the current sync',
  'UNKNOWN_SUPPRESSION_REASON': 'Data not available - check data sources'
};

/**
 * Create a diagnostic coverage card for a canonical PI that returned null
 * 
 * This ensures All Insights shows all canonical PIs, even if some are not yet actionable.
 */
function createDiagnosticCoverageCard(
  canonicalEntry: any,
  reason: DiagnosticReason
): CanonicalInsight {
  const unlockPath = DIAGNOSTIC_UNLOCK_PATH[reason] || 'Data not available';
  
  // Safe fallback: generate neutral diagnostic title for unmapped IDs
  // Avoid words like "reveals", "indicates", "opportunity", "trapped", "creates", "correlates"
  let diagnosticTitle = DIAGNOSTIC_TITLE_MAPPING[canonicalEntry.id];
  if (!diagnosticTitle) {
    // Generate neutral fallback from canonical title
    const canonicalTitle = canonicalEntry.title || '';
    // If canonical title already has diagnostic wording (needs, waiting, not captured), use it as-is
    if (canonicalTitle.includes('needs') || canonicalTitle.includes('waiting') || canonicalTitle.includes('not captured')) {
      diagnosticTitle = canonicalTitle;
    } else {
      // Remove directional/interpretive words and add neutral diagnostic suffix
      const neutralBase = canonicalTitle
        .replace(/reveals|indicates|opportunity|trapped|creates|correlates|patterns|shows|leads|beats/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (neutralBase.length > 0) {
        diagnosticTitle = `${neutralBase} not yet measurable`;
      } else {
        diagnosticTitle = canonicalTitle; // Fallback to original if neutralization fails
      }
    }
  }
  
  return {
    id: canonicalEntry.id,
    title: diagnosticTitle,
    cicdStage: canonicalEntry.stage,
    canonicalPriority: canonicalEntry.canonicalPriority,
    renderOrder: canonicalEntry.renderOrder,
    presentationType: 'evidence_only',
    presentationKind: 'diagnostic',
    comparisonMode: 'absolute',
    comparisonState: 'needs_more_data',
    
    // Core metrics — null for unavailable diagnostic evidence, never a false zero
    current: null,
    baseline: undefined,
    delta: undefined,
    deltaPct: undefined,
    displayValue: '—',
    displayDeltaPct: undefined,
    rightMetric: undefined,
    rightMetricLabel: undefined,
    
    // Data quality
    confidence: 'low',
    coveragePct: 0,
    n: 0,
    hasData: false,
    
    // Content (diagnostic explanation)
    description: unlockPath,
    recommendation: undefined,
    executiveSummary: `This insight requires additional data to become actionable`,
    evidence: [],
    
    // Tool breakdown (none for diagnostic cards)
    breakdownByTool: undefined,
    
    // Executive finding flags
    isExecutiveFinding: canonicalEntry.isExecutiveFinding || false,
    
    // Demo flags
    demoFlag: undefined,
    demoNarrativePriority: undefined,
    
    // Data source — unavailable for diagnostic coverage cards
    dataSource: 'unavailable',
    
    // Enhanced narrative fields
    whatChanged: undefined,
    whyItMatters: unlockPath,
    evidenceAndContext: unlockPath,
    operationalImpact: undefined,
    primaryRisk: undefined,
    cohort: undefined,
    confidenceReasoning: 'Insufficient data for insight generation',
    operationalRead: undefined,
    urgencyLabel: 'informational',
    metricDefinition: undefined,
    operationalBreadcrumbs: [],
    recommendationState: 'needs_validation',
    
    // Engine provenance
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: canonicalEntry.generatorKey,
    featureFlagState: true,
    
    // Diagnostic coverage card fields
    isDiagnostic: true,
    diagnosticReason: reason,
    diagnosticUnlockPath: unlockPath
  };
}

// Realism pipeline
import { applyRealismPipeline } from './helpers/realismPipeline';

// CR-X FINAL: Shared engine cache
import { buildEngineCache } from './helpers/engineCache';

// Stress test fixture (dev only)
import { isStressModeEnabled, generateStressTestInput } from './devStressFixture';


/**
 * Feature flag to enable the final canonical PI engine
 * 
 * When enabled, the new engine generates canonical insights.
 * When disabled, returns empty array and legacy system handles all PIs.
 * 
 * Phase B2: Only active-coding-time-by-ide is migrated to new engine.
 * All other PIs continue using legacy rendering.
 */
// CR-X P0-A FIX: The Final Engine is the canonical PI authority (per AGENTS.md).
// The legacy harness is disabled ("PILOT LOCKDOWN"). The feature flag was a
// migration guard that is no longer needed. Default to ENABLED unless
// explicitly disabled with VITE_FINAL_PI_ENGINE_ENABLED=false.
// This prevents worktree/env-file gaps from silently disabling all PIs.
const FINAL_PI_ENGINE_ENABLED =
  typeof import.meta !== 'undefined' &&
  import.meta.env?.VITE_FINAL_PI_ENGINE_ENABLED !== 'false';

/**
 * Generate final canonical Performance Insights
 * 
 * This is the main orchestration function for the new canonical PI engine.
 * 
 * ORCHESTRATION FLOW:
 * 1. Check feature flag (FINAL_PI_ENGINE_ENABLED)
 * 2. If disabled, return empty array (legacy system handles all PIs)
 * 3. If enabled, fetch live data from APIs (if input not provided)
 * 4. Generate insights from all stage generators
 * 5. Filter to canonical registry only (NO OTHER FILTERS)
 * 6. Validate insights conform to schema
 * 7. Sort insights by stage and renderOrder
 * 8. Adapt insights to UI contract
 * 9. Return final insights for rendering
 * 
 * KEY PRINCIPLES:
 * - Only canonical registry filter applies (no MVP allowlist, no confidence gates, etc.)
 * - All 14 canonical PIs render if generated
 * - No silent fallbacks to placeholder data
 * - Deterministic sorting by stage and renderOrder
 * - Executive findings included in canonical set
 * - Feature flag controls whether new engine is used
 * 
 * @param input - Optional canonical insight input data (if not provided, will fetch from APIs)
 * @returns Array of performance insights in UI contract shape
 */
export async function generateFinalCanonicalInsights(input?: CanonicalInsightInput): Promise<PerformanceInsight[]> {
  piDebugLog('[PI_TRACE][FINAL_ARRAY_START]', 'generateFinalCanonicalInsights called');
  piDebugLog('[PI_TRACE][FEATURE_FLAG]', { enabled: FINAL_PI_ENGINE_ENABLED });
  piDebugLog('[PI_TRACE][STRESS_MODE]', { enabled: isStressModeEnabled() });
  piDebugLog('[PI_TRACE][ENGINE_ENTRY]', 'Final engine entry point reached');
  
  // Clear suppression diagnostics for fresh run
  clearSuppressionDiagnostics();
  piDebugLog('[PI_TRACE][ENTRY_SESSION_COUNT]', {
    hasInput: !!input,
    sessionRowsCount: input?.sessionRows?.length || 0,
    inputSource: input ? 'PROVIDED_BY_CALLER' : 'WILL_FETCH_VIA_DATA_ACCESS'
  });
  
  // Runtime proof for mode/engine entry point (DISABLED for MVP2 patch)

  // ============================================================
  // FEATURE FLAG CHECK
  // ============================================================
  if (!FINAL_PI_ENGINE_ENABLED) {
    piDebugLog('[FINAL_PI_ENGINE][FLAG_DISABLED]', 'Returning empty array, legacy system will handle all PIs');
    return [];
  }

  piDebugLog('[FINAL_PI_ENGINE][FLAG_ENABLED]', 'Using new final canonical PI engine');

  // ============================================================
  // STRESS MODE HANDLING (DEV ONLY)
  // ============================================================
  const stressModeEnabled = isStressModeEnabled();
  let stressDataInsights: PerformanceInsight[] = [];
  
  if (stressModeEnabled) {
    piDebugLog('[FINAL_PI_STRESS][ACTIVE_UI_MODE] Stress fixture is driving Performance Insights UI');
    
    // Generate insights with stress test data ONLY - do not call real API
    const stressInput = generateStressTestInput();
    stressDataInsights = await generateInsightsFromInput(stressInput);
    
    // Runtime proof globals DISABLED for MVP2 patch
    
    // Add demo mode trace
    piDebugLog('[DEMO_MODE_PI_TRACE]', {
      demoModeActive: stressModeEnabled,
      realBridgeCalled: false, // We bypass real data bridge in demo mode
      fixtureInputSessionCount: stressInput.sessionRows?.length || 0,
      generatedInsightCount: stressDataInsights.length,
      adaptedInsightCount: stressDataInsights.length, // Adapted count same as generated for now
      widgetInputCount: stressDataInsights.length,
      visibleInsightCount: stressDataInsights.length,
      firstFiveIds: stressDataInsights.slice(0, 5).map(i => i.id)
    });
    
    piDebugLog('[FINAL_PI_STRESS][RESULTS]', {
      stressDataCount: stressDataInsights.length,
      stressInputSessionCount: stressInput.sessionRows?.length || 0,
      stressInputGithubSnapshot: stressInput.githubSnapshot ? 'present' : 'absent'
    });
    
    // Return stress data insights for visualization
    return stressDataInsights;
  } else {
    piDebugLog('[FINAL_PI_STRESS][NORMAL_UI_MODE] Real org runtime data is driving Performance Insights UI');
  }

  // ============================================================
  // FETCH LIVE DATA IF INPUT NOT PROVIDED (NORMAL MODE ONLY)
  // ============================================================
  let canonicalInput = input;
  if (!stressModeEnabled) {
    if (!canonicalInput) {
      piDebugLog('[FINAL_PI_ENGINE][FETCHING_DATA]', 'No input provided, fetching from APIs');
      canonicalInput = await fetchCanonicalInsightInput(); // Use default all-time behavior
    } else {
      // Even when input is provided, we need to add derived fields (unit conversions)
      addDerivedSessionFields(canonicalInput.sessionRows);
      piDebugLog('[FINAL_PI_ENGINE][DERIVED_FIELDS_ADDED]', 'Added derived fields to provided input');
    }
    
    return await generateInsightsFromInput(canonicalInput);
  }
  
  // This should never be reached, but TypeScript needs it
  return [];
}

/**
 * Internal helper: Generate insights from a specific input
 */
async function generateInsightsFromInput(canonicalInput: CanonicalInsightInput): Promise<PerformanceInsight[]> {
  const _t0_engine = performance.now();
  const dataMode = determineDataMode(canonicalInput);
  piDebugLog('[FINAL_PI_ENGINE][DATA_MODE]', dataMode);

  // CR1 Mission 1 / CR4 P0-7: GitHub Evidence Authority — this is the single
  // choke point through which ALL callers pass canonicalInput before generators.
  // CR4 P0-7 FIX: Use isGithubEvidenceEligibleCombined() (mode-aware) instead of
  // strict isGithubEvidenceEligible(). In Local Lab mode, seeded GitHub evidence
  // is eligible for generator development. In live/customer mode, the strict
  // gate applies — no seeded fallback.
  const githubEligible = isGithubEvidenceEligibleCombined(canonicalInput.githubSnapshot);
  const githubEligibleStrict = isGithubEvidenceEligible(canonicalInput.githubSnapshot);
  const githubProv = canonicalInput.githubSnapshot?.github_provenance;
  let githubIneligibilityReason: string | undefined;
  if (canonicalInput.githubSnapshot && !githubEligible) {
    githubIneligibilityReason = !githubProv
      ? 'no github_provenance object present'
      : githubProv.source && INELIGIBLE_GITHUB_PROVENANCE_SOURCES.has(githubProv.source)
        ? `provenance source '${githubProv.source}' is seeded/simulated`
        : githubProv.generated_fallback_used === true
          ? 'generated_fallback_used is true'
          : githubProv.historical_data_available !== true
            ? 'historical_data_available is not true'
            : 'ineligible db_pr_data_sources';
    console.warn('[FINAL_PI_ENGINE][GITHUB_EVIDENCE_INELIGIBLE]', {
      reason: githubIneligibilityReason,
      provenance: githubProv
    });
    canonicalInput = {
      ...canonicalInput,
      githubSnapshot: undefined,
      githubByPeriod: []
    };
  }
  // Log when lab-mode eligibility allows seeded evidence through
  if (githubEligible && !githubEligibleStrict) {
    piDebugLog('[FINAL_PI_ENGINE][GITHUB_LAB_EVIDENCE_ACTIVE]', {
      reason: 'Local Lab mode — seeded GitHub evidence eligible for development',
      provenance: githubProv
    });
  }

  // ============================================================
  // STRUCTURED RUNTIME PROOF — single source of truth for baseline identity
  // ============================================================
  const baselineSource = canonicalInput.sessionRows?.length > 0
    ? 'all_time_canonical_telemetry'
    : 'empty';
  const runtimeProof = {
    baselineSource,
    baselineTelemetryRecords: canonicalInput.sessionRows?.length || 0,
    baselineSessionCount: canonicalInput.sessionRows?.reduce((sum: number, s: any) => sum + (s.sessionCount || 1), 0) || 0,
    trendTelemetryRecords: canonicalInput.productivityByPeriod?.length || 0,
    productivityByPeriodCount: canonicalInput.productivityByPeriod?.length || 0,
    githubHistoricalEligible: githubEligible,
    githubTrendEligible: githubEligible && (canonicalInput.githubByPeriod?.length || 0) > 0,
    githubIneligibilityReason
  };
  piDebugLog('[FINAL_PI_ENGINE][RUNTIME_PROOF]', runtimeProof);
  if (typeof window !== 'undefined') {
    if (!(window as any).__CM_DEBUG__) (window as any).__CM_DEBUG__ = {};
    (window as any).__CM_DEBUG__.runtimeProof = runtimeProof;
  }

  // ============================================================
  // DEBUG INITIALIZATION: Ensure __CM_DEBUG__ exists before use
  // ============================================================
  if (typeof window !== 'undefined') {
    if (!(window as any).__CM_DEBUG__) {
      (window as any).__CM_DEBUG__ = {};
    }
  }

  // ============================================================
  // OBSERVABILITY: window.__CM_DEBUG__ payload summaries
  // ============================================================
  if (typeof window !== 'undefined' && (window as any).__CM_DEBUG__) {
    (window as any).__CM_FINAL_INPUTS__ = {
      sessionRowsCount: canonicalInput.sessionRows?.length || 0,
      githubByPeriodCount: canonicalInput.githubByPeriod?.length || 0,
      hasGithubSnapshot: !!canonicalInput.githubSnapshot,
      productivityByPeriodCount: canonicalInput.productivityByPeriod?.length || 0,
      granularity: canonicalInput.granularity,
      dataMode,
      timestamp: Date.now()
    };
    piDebugLog('[CM_DEBUG][FINAL_INPUTS]', (window as any).__CM_FINAL_INPUTS__);
    // CR5 P0-8: Trace exact GitHub snapshot fields reaching generators
    const gs = canonicalInput.githubSnapshot;
    piDebugLog('[CR5_GITHUB_SNAPSHOT_TRACE]', JSON.stringify({
      hasSnapshot: !!gs,
      snapshotKeys: gs ? Object.keys(gs).slice(0, 20) : [],
      pr_analytics: gs?.pr_analytics ? {
        total_prs: gs.pr_analytics.total_prs,
        merged_prs: gs.pr_analytics.merged_prs,
        github_db_pr_count: gs.pr_analytics.github_db_pr_count,
        github_db_deploy_count: gs.pr_analytics.github_db_deploy_count
      } : 'MISSING',
      deployment_metrics: gs?.deployment_metrics ? {
        success_deployment_count: gs.deployment_metrics.success_deployment_count,
        failed_deployment_count: gs.deployment_metrics.failed_deployment_count,
        keys: Object.keys(gs.deployment_metrics).slice(0, 10)
      } : 'MISSING',
      pr_review_metrics: gs?.pr_review_metrics ? {
        review_count: gs.pr_review_metrics.review_count,
        unique_reviewer_count: gs.pr_review_metrics.unique_reviewer_count,
        pr_reopened_count: gs.pr_review_metrics.pr_reopened_count,
        total_prs: gs.pr_review_metrics.total_prs
      } : 'MISSING',
      github_by_period_length: gs?.github_by_period?.length || 0,
      github_provenance: gs?.github_provenance
    }, null, 2));
  }

  // ============================================================
  // STEP 0: Registry count
  // ============================================================
  const registryIds = getCanonicalPIIds();
  piDebugLog('[PI_TRACE][REGISTRY]', `count=${registryIds.size}`);

  // ============================================================
  // STEP 1: Validate canonical inventory (development only)
  // ============================================================
  try {
    assertFinalCanonicalInventory();
  } catch (err) {
    console.error('[FINAL_PI_ENGINE][ERROR]', 'Canonical inventory validation failed', err);
    throw err;
  }

  // ============================================================
  // STEP 1: Generate insights from all stage generators
  // ============================================================
  piDebugLog('[FINAL_PI_ENGINE][STEP_1]', 'Generating insights from generators');
  piDebugLog('[FINAL_PI_ENGINE][GENERATOR_INPUT_SESSION_COUNT]', {
    sessionRowsCount: canonicalInput.sessionRows?.length || 0
  });

  // ============================================================
  // CR5 WS2 #14 P0-1: DEV-only Final Engine population proof.
  // Emits exact normalized workflow counts + provenance-qualified
  // commit/TTFC denominators from the exact object passed into
  // generateFinalCanonicalInsights(). This is the authority for
  // census reconciliation — not a SQLite reconstruction.
  // ============================================================
  {
    const rows = canonicalInput.sessionRows || [];
    const wfCounts: Record<string, number> = {};
    for (const s of rows) {
      const tool = normalizeToCanonicalToolId(s.tool ?? s.session_source ?? '');
      wfCounts[tool] = (wfCounts[tool] || 0) + 1;
    }
    const observedCommit = rows.filter((s: any) => s.session_commits_source === 'observed').length;
    const observedTtfc = rows.filter((s: any) => s.ttfc_source === 'observed').length;
    const observedCommitAi = rows.filter((s: any) => s.session_commits_source === 'observed' && s.session_has_ai_activity === true).length;
    const observedCommitNonAi = rows.filter((s: any) => s.session_commits_source === 'observed' && s.session_has_ai_activity === false).length;
    const observedTtfcAi = rows.filter((s: any) => s.ttfc_source === 'observed' && s.session_has_ai_activity === true).length;
    const observedTtfcNonAi = rows.filter((s: any) => s.ttfc_source === 'observed' && s.session_has_ai_activity === false).length;
    const simulatedCount = rows.filter((s: any) => s.simulated === true).length;

    const populationProof = {
      totalRows: rows.length,
      normalizedWorkflowCounts: wfCounts,
      provenanceQualified: {
        observedCommit,
        observedCommitAi,
        observedCommitNonAi,
        observedTtfc,
        observedTtfcAi,
        observedTtfcNonAi,
        simulated: simulatedCount,
      },
    };
    piDebugLog('[FINAL_ENGINE_POPULATION_PROOF]', JSON.stringify(populationProof, null, 2));
    if (typeof window !== 'undefined') {
      if (!(window as any).__CM_DEBUG__) (window as any).__CM_DEBUG__ = {};
      (window as any).__CM_DEBUG__.finalEnginePopulationProof = populationProof;
    }
  }

  // CR-X FINAL: Build shared engine cache — pre-compute workflow grouping,
  // repo grouping, and temporal windows ONCE so generators don't repeatedly
  // scan sessionRows. This does NOT change evidence semantics.
  const _t0_cache = performance.now();
  const _engineCache = buildEngineCache(canonicalInput.sessionRows || []);
  const _t1_cache = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'engineCache', ms: Math.round(_t1_cache - _t0_cache) });
  canonicalInput = { ...canonicalInput, _engineCache };

  piDebugLog('[FINAL_PI_TRACE][PLAN_CODE_START]', 'Calling generatePlanCodeInsights');
  const _t0_planCode = performance.now();
  const planCodeInsights = generatePlanCodeInsights(canonicalInput);
  const _t1_planCode = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'planCode', ms: Math.round(_t1_planCode - _t0_planCode), count: planCodeInsights.length });
  piDebugLog('[FINAL_PI_TRACE][PLAN_CODE_COMPLETE]', {
    returnedCount: planCodeInsights.length,
    ids: planCodeInsights.map(i => i.id),
    titles: planCodeInsights.map(i => i.title)
  });

  piDebugLog('[FINAL_PI_TRACE][REVIEW_MERGE_START]', 'Calling generateReviewMergeInsights');
  const reviewMergeInputDebug = {
    hasGithubSnapshot: !!canonicalInput.githubSnapshot,
    githubSnapshotKeys: canonicalInput.githubSnapshot ? Object.keys(canonicalInput.githubSnapshot) : [],
    reviewer_load_concentration: canonicalInput.githubSnapshot?.reviewer_load_concentration,
    pr_review_metrics: canonicalInput.githubSnapshot?.pr_review_metrics
  };
  piDebugLog('[FINAL_PI_TRACE][CANONICAL_INPUT]', reviewMergeInputDebug);
  const _t0_reviewMerge = performance.now();
  const reviewMergeInsights = generateReviewMergeInsights(canonicalInput);
  const _t1_reviewMerge = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'reviewMerge', ms: Math.round(_t1_reviewMerge - _t0_reviewMerge), count: reviewMergeInsights.length });
  piDebugLog('[FINAL_PI_TRACE][REVIEW_MERGE_COMPLETE]', {
    returnedCount: reviewMergeInsights.length,
    ids: reviewMergeInsights.map(i => i.id),
    titles: reviewMergeInsights.map(i => i.title)
  });

  piDebugLog('[FINAL_PI_TRACE][DEPLOY_OPERATE_START]', 'Calling generateDeployOperateInsights');
  const _t0_deployOperate = performance.now();
  const deployOperateInsights = generateDeployOperateInsights(canonicalInput);
  const _t1_deployOperate = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'deployOperate', ms: Math.round(_t1_deployOperate - _t0_deployOperate), count: deployOperateInsights.length });
  piDebugLog('[FINAL_PI_TRACE][DEPLOY_OPERATE_COMPLETE]', {
    returnedCount: deployOperateInsights.length,
    ids: deployOperateInsights.map(i => i.id),
    titles: deployOperateInsights.map(i => i.title)
  });

  // CR-X Pass 3: Early-signal + efficiency frontier generators (additive)
  piDebugLog('[FINAL_PI_TRACE][EARLY_SIGNAL_START]', 'Calling early-signal generators');
  const _t0_earlySignal = performance.now();
  const earlySignalInsights: CanonicalInsight[] = [
    generateEarlySignalWorkflowAdoption(canonicalInput),
    generateEarlySignalDeveloperActivity(canonicalInput),
    generateDeveloperWorkflowCostEfficiencyFrontier(canonicalInput),
    generateWorkflowCostDeliveryComparison(canonicalInput),
    generateWorkflowDeliveryEfficiency(canonicalInput),
    generateClaudeCodeRuntimeCohort(canonicalInput),
  ].filter((i): i is CanonicalInsight => i !== null);
  const _t1_earlySignal = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'earlySignal', ms: Math.round(_t1_earlySignal - _t0_earlySignal), count: earlySignalInsights.length });
  piDebugLog('[FINAL_PI_TRACE][EARLY_SIGNAL_COMPLETE]', {
    returnedCount: earlySignalInsights.length,
    ids: earlySignalInsights.map(i => i.id),
  });

  // CR-X P1B.2 Wave 1: Recent-change temporal intelligence
  piDebugLog('[FINAL_PI_TRACE][RECENT_CHANGE_START]', 'Calling generateRecentChangeInsights');
  const _t0_recentChange = performance.now();
  const recentChangeInsights = generateRecentChangeInsights(canonicalInput);
  const _t1_recentChange = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'recentChange', ms: Math.round(_t1_recentChange - _t0_recentChange), count: recentChangeInsights.length });
  piDebugLog('[FINAL_PI_TRACE][RECENT_CHANGE_COMPLETE]', {
    returnedCount: recentChangeInsights.length,
    ids: recentChangeInsights.map(i => i.id),
    titles: recentChangeInsights.map(i => i.title),
  });

  // CR-X Wave 1B: Multi-dimensional analysis families
  // (repo-conditioned behavior, workflow×repo allocation, within-workflow
  // temporal behavior, workflow×repo allocation shift)
  piDebugLog('[FINAL_PI_TRACE][MULTI_DIMENSIONAL_START]', 'Calling generateMultiDimensionalInsights');
  const _t0_multiDim = performance.now();
  const multiDimensionalInsights = generateMultiDimensionalInsights(canonicalInput);
  const _t1_multiDim = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'multiDimensional', ms: Math.round(_t1_multiDim - _t0_multiDim), count: multiDimensionalInsights.length });
  piDebugLog('[FINAL_PI_TRACE][MULTI_DIMENSIONAL_COMPLETE]', {
    returnedCount: multiDimensionalInsights.length,
    ids: multiDimensionalInsights.map(i => i.id),
    titles: multiDimensionalInsights.map(i => i.title),
  });

  // CR-X PI Product-Strength Wave: Executive temporal synthesis
  // Combines sibling recent-change findings into one executive finding
  // when multiple workflow-mix changes describe the same window.
  piDebugLog('[FINAL_PI_TRACE][EXEC_SYNTHESIS_START]', 'Calling generateExecutiveTemporalSynthesis');
  const _t0_execSynth = performance.now();
  const execSynthesisInsights = generateExecutiveTemporalSynthesis(canonicalInput);
  const _t1_execSynth = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'execSynthesis', ms: Math.round(_t1_execSynth - _t0_execSynth), count: execSynthesisInsights.length });
  piDebugLog('[FINAL_PI_TRACE][EXEC_SYNTHESIS_COMPLETE]', {
    returnedCount: execSynthesisInsights.length,
    ids: execSynthesisInsights.map(i => i.id),
    titles: execSynthesisInsights.map(i => i.title),
  });

  // Combine all generated insights (Executive Findings are now in their respective stage files)
  // Dedupe by ID — if two generators produce the same ID, keep the first occurrence
  const _allGeneratedRaw: CanonicalInsight[] = [
    ...planCodeInsights,
    ...reviewMergeInsights,
    ...deployOperateInsights,
    ...earlySignalInsights,
    ...recentChangeInsights,
    ...multiDimensionalInsights,
    ...execSynthesisInsights,
  ];
  const _seenIds = new Set<string>();
  let _dedupedGenerated: CanonicalInsight[] = _allGeneratedRaw.filter(insight => {
    if (_seenIds.has(insight.id)) {
      piDebugLog('[FINAL_PI_ENGINE][DEDUP_DUPLICATE]', { id: insight.id, title: insight.title });
      return false;
    }
    _seenIds.add(insight.id);
    return true;
  });

  // CR-X Track A: Stamp population context onto all generated insights
  // so the render adapter can label PIs with their scoped population.
  _dedupedGenerated = _dedupedGenerated.map(insight => ({
    ...insight,
    ...(canonicalInput.populationContextLabel ? { populationContextLabel: canonicalInput.populationContextLabel } : {}),
    populationScope: canonicalInput.populationScope || 'org_level',
  } as any));

  // CR-X FINAL: Stamp semantic family on every insight after evidence
  // qualification and before portfolio consolidation. This is the single
  // authority for semantic family assignment — used by the portfolio layer
  // for dominance decisions and by getTopInsights for diversity enforcement.
  _dedupedGenerated = stampSemanticFamilies(_dedupedGenerated);
  piDebugLog('[FINAL_PI_ENGINE][SEMANTIC_FAMILY_STAMPED]', {
    count: _dedupedGenerated.length,
    familyDistribution: _dedupedGenerated.reduce((acc: Record<string, number>, i: any) => {
      const fam = i.semanticFamily || 'unmapped';
      acc[fam] = (acc[fam] || 0) + 1;
      return acc;
    }, {}),
  });

  // CR5 FINAL DOWNSTREAM P0-6 — Suppress redundant downstream diagnostics
  // when qualified real downstream findings exist.
  //
  // When the real PR-size/merge-cycle finding (executive-small-pr-workflow-
  // optimization) and/or the real deployment reliability finding (change-
  // failure-rate-spike-by-ide) are present as non-diagnostic findings,
  // suppress these redundant diagnostic/weak cards that duplicate the
  // "needs more data" story for the same downstream systems:
  //   - reopen-pressure-spike
  //   - delivery-velocity-by-workflow
  //   - synthesized-deployment-cadence
  //   - reviewer-load-concentration
  //
  // This is capability-aware: if no qualified downstream finding exists,
  // these cards are NOT suppressed (current behavior preserved).
  const REDUNDANT_DOWNSTREAM_IDS = new Set([
    'reopen-pressure-spike',
    'delivery-velocity-by-workflow',
    'synthesized-deployment-cadence',
    'reviewer-load-concentration',
  ]);
  const hasQualifiedDownstreamFinding = _dedupedGenerated.some(i =>
    (i.id === 'executive-small-pr-workflow-optimization' || i.id === 'change-failure-rate-spike-by-ide') &&
    i.isDiagnostic !== true &&
    i.hasData === true
  );
  if (hasQualifiedDownstreamFinding) {
    const beforeCount = _dedupedGenerated.length;
    _dedupedGenerated = _dedupedGenerated.filter(i => {
      if (REDUNDANT_DOWNSTREAM_IDS.has(i.id)) {
        piDebugLog('[FINAL_PI_ENGINE][REDUNDANT_DOWNSTREAM_SUPPRESS]', { id: i.id, reason: 'qualified downstream finding present' });
        return false;
      }
      return true;
    });
    piDebugLog('[FINAL_PI_ENGINE][REDUNDANT_DOWNSTREAM_SUPPRESS_COMPLETE]', {
      beforeCount,
      afterCount: _dedupedGenerated.length,
      suppressedCount: beforeCount - _dedupedGenerated.length,
    });
  }

  piDebugLog('[FINAL_GENERATOR_COUNT]', {
    totalGenerated: _dedupedGenerated.length,
    planCode: planCodeInsights.length,
    reviewMerge: reviewMergeInsights.length,
    deployOperate: deployOperateInsights.length,
    planCodeIds: planCodeInsights.map(i => i.id),
    reviewMergeIds: reviewMergeInsights.map(i => i.id),
    deployOperateIds: deployOperateInsights.map(i => i.id)
  });

  // ============================================================
  // STEP 1.6 (WS2): Portfolio Consolidation
  //
  // CR5 WS2 P0-1: Three lifecycle states:
  //   visible finding      = supported + selected for portfolio
  //   diagnostic/data gap  = genuinely missing/ineligible evidence
  //   portfolio-suppressed = supported evidence omitted because a stronger/
  //                          redundant candidate was selected
  //
  // Portfolio-suppressed candidates are NOT diagnostics. They are excluded
  // from finalAdaptedInsights (customer-visible output) but retained in
  // an internal debug collection for audit.
  //
  // Pipeline sequence (unambiguous, no variable shadowing):
  //   _allGeneratedRaw       → raw generator output (pre-dedupe)
  //   _dedupedGenerated      → after ID dedupe
  //   portfolioResult        → { visible, suppressed } after WS2 consolidation
  //   allGeneratedInsights   → visible insights used by downstream steps
  // ============================================================
  piDebugLog('[FINAL_PI_ENGINE][STEP_1.6]', 'Applying WS2 portfolio consolidation');
  const _t0_portfolio = performance.now();
  const portfolioResult = applyPortfolioConsolidation(_dedupedGenerated);
  const _t1_portfolio = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'portfolioConsolidation', ms: Math.round(_t1_portfolio - _t0_portfolio), visible: portfolioResult.visible.length, suppressed: portfolioResult.suppressed.length });
  piDebugLog('[FINAL_PI_ENGINE][STEP_1.6_COMPLETE]', {
    beforeCount: _dedupedGenerated.length,
    visibleCount: portfolioResult.visible.length,
    suppressedCount: portfolioResult.suppressed.length,
    suppressedIds: portfolioResult.suppressed.map(i => i.id),
  });

  // Use visible (non-suppressed) insights for the rest of the pipeline
  const allGeneratedInsights: CanonicalInsight[] = portfolioResult.visible;
  // Store suppressed for audit/debug
  const portfolioSuppressedInsights: CanonicalInsight[] = portfolioResult.suppressed;
  piDebugLog('[PLAN_CODE_COUNT]', planCodeInsights.length);
  piDebugLog('[REVIEW_MERGE_COUNT]', reviewMergeInsights.length);
  piDebugLog('[DEPLOY_OPERATE_COUNT]', deployOperateInsights.length);

  // ============================================================
  // STEP 1.5 (CR5 P0.5): REMOVED fixed-inventory diagnostic backfill.
  //
  // The canonical registry is a CAPABILITY CATALOG, not a forced render
  // inventory. Step 1.5 previously manufactured one diagnostic card per
  // missing registry ID to force output to 28 objects. This violated the
  // principle that counts are outputs, not inputs.
  //
  // New contract:
  //   engine findings   = generator-produced real findings
  //   engine diagnostics = generator-produced diagnostics (isDiagnostic: true)
  //   registry coverage  = separate capability/audit accounting (not PI cards)
  //   SUPPRESSED/NOT IMPLEMENTED = not runtime PI cards
  //
  // Registry IDs with no active generator (focus-ratio-by-ide,
  // rework-rate-by-workflow, active-coding-ratio-by-workflow,
  // rework-loop-detection) no longer produce synthetic diagnostics.
  // Generators that return null no longer get a Step 1.5 replacement.
  // ============================================================
  // CR5 P1.2: Coverage audit counts FAMILIES, not instance keys.
  // A runtime instance (base__workflow) means the family IS represented.
  const generatedFamilyIds = new Set(allGeneratedInsights.map(i => resolveCanonicalFamilyId(i.id) ?? i.id));
  const allCanonicalIdsSet = getCanonicalPIIds();
  const missingCanonicalIds = Array.from(allCanonicalIdsSet).filter(id => !generatedFamilyIds.has(id));

  piDebugLog('[CANONICAL_COVERAGE][AUDIT_ONLY]', {
    registryFamilyCount: allCanonicalIdsSet.size,
    representedFamilyCount: generatedFamilyIds.size,
    runtimeInstanceCount: allGeneratedInsights.length,
    missingFamilyCount: missingCanonicalIds.length,
    missingFamilyIds: missingCanonicalIds,
    note: 'Coverage counts canonical families. Instance keys (base__workflow) resolve to their family.'
  });

  // Engine output = generator output only (no backfill)
  const allCanonicalInsights: CanonicalInsight[] = [...allGeneratedInsights];

  piDebugLog('[FINAL_PI_ENGINE][STEP_1.5_REMOVED]', {
    realInsightsCount: allGeneratedInsights.length,
    totalCanonicalInsights: allCanonicalInsights.length,
    registryCatalogCount: allCanonicalIdsSet.size,
    missingFromRuntime: missingCanonicalIds.length
  });

  // ============================================================
  // STEP 2: Filter to canonical registry ONLY (no other filters)
  // ============================================================
  piDebugLog('[FINAL_PI_ENGINE][STEP_2]', 'Filtering to canonical registry');

  // Use allCanonicalIdsSet from STEP 1.5
  // CR5 P1.2: Use resolveCanonicalFamilyId as the SINGLE authority for
  // canonical membership. Instance IDs (base__workflow) are valid when
  // their base family is registered and supports runtime instances.
  const canonicalInsights = allCanonicalInsights.filter(insight =>
    isCanonicalInsightId(insight.id)
  );

  const nonCanonicalIds = allCanonicalInsights
    .filter(insight => !isCanonicalInsightId(insight.id))
    .map(insight => insight.id);

  piDebugLog('[FINAL_PI_ENGINE][STEP_2_COMPLETE]', {
    totalCanonical: canonicalInsights.length,
    filteredNonCanonical: nonCanonicalIds.length,
    nonCanonicalIds
  });

  // ============================================================
  // STEP 3: Apply realism pipeline for VP Engineering believability
  // ============================================================
  piDebugLog('[FINAL_PI_ENGINE][STEP_3]', 'Applying realism pipeline');

  const _t0_realism = performance.now();
  const realismResult = applyRealismPipeline(canonicalInsights, {
    enableTitleHardening: false, // DISABLED: Preserve canonical title authority
    enableBannedPhraseCleanup: true,
    enableTerminologyNormalization: true,
    enableNarrativeDiversity: true,
    enableNumericFormatting: true,
    enableConfidenceRealism: true,
    enableChangeStateRealism: true,
    enableOverwriteReduction: true,
    enableFinalValidation: true,
    strictMode: false // Degrade confidence instead of suppressing insights
  });
  const _t1_realism = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'realismPipeline', ms: Math.round(_t1_realism - _t0_realism), processed: realismResult.processedInsights.length });

  piDebugLog('[FINAL_PI_ENGINE][STEP_3_COMPLETE]', {
    processedInsights: realismResult.processedInsights.length,
    suppressedInsights: realismResult.suppressedInsights.length,
    degradedInsights: realismResult.degradedInsights.length,
    averageCredibilityScore: realismResult.pipelineSummary.averageCredibilityScore,
    topIssues: realismResult.pipelineSummary.topIssues
  });

  // ============================================================
  // STEP 4: Validate insights conform to schema
  // ============================================================
  piDebugLog('[FINAL_PI_ENGINE][STEP_4]', 'Validating insights');

  piDebugLog('[FINAL_INSIGHTS_TYPE]', typeof realismResult.processedInsights, Array.isArray(realismResult.processedInsights), realismResult.processedInsights);
  piDebugLog('[PLAN_CODE_IDS]', realismResult.processedInsights.filter(i => i.cicdStage === 'plan-code').map(i => i.id));

  const _t0_validation = performance.now();
  const validation = validateCanonicalInsights(realismResult.processedInsights);
  const _t1_validation = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'validation', ms: Math.round(_t1_validation - _t0_validation) });

  // CR1 P0 Mission 6: Fail closed. When validation fails, log errors but
  // suppress invalid insights. Do not render cards that fail validation.
  let validatedInsights = realismResult.processedInsights;
  if (!validation.valid) {
    // CR5 P0-1: Emit ONE uncollapsed JSON log for exact validation errors
    console.error('[CR5_VALIDATION_ERRORS_JSON]', JSON.stringify(validation, null, 2));
    console.error('[FINAL_PI_ENGINE][VALIDATION_FAILED]', {
      allErrors: validation.allErrors,
      uniqueIds: validation.results.uniqueIds,
      stageDistributionErrors: validation.results.stageDistribution.errors,
      stageCounts: validation.results.stageDistribution.stageCounts,
      renderOrderDuplicates: validation.results.uniqueRenderOrder.duplicates,
      unregisteredIds: validation.results.canonicalRegistry.unregisteredIds,
      missingRequiredFields: validation.results.requiredFields.missingFields,
      insightIds: realismResult.processedInsights.map(i => ({ id: i.id, stage: i.cicdStage, renderOrder: i.renderOrder })),
      insightCount: realismResult.processedInsights.length
    });
    // CR1 Mission 2: Suppress only insights addressable to a specific candidate ID.
    // The real validation.results shape does NOT have a uniform `.results` array;
    // each category has its own shape:
    //   - canonicalRegistry.unregisteredIds: string[]
    //   - requiredFields.missingFields: Array<{ id, missing }>
    //   - uniqueRenderOrder.duplicates: Array<{ stage, renderOrder, count }>
    //   - stageDistribution/uniqueIds: aggregate-only, not addressable to a single id
    const invalidIds = new Set<string>();

    for (const id of validation.results.canonicalRegistry.unregisteredIds) {
      invalidIds.add(id);
    }

    for (const entry of validation.results.requiredFields.missingFields) {
      invalidIds.add(entry.id);
    }

    for (const dup of validation.results.uniqueRenderOrder.duplicates) {
      for (const insight of realismResult.processedInsights) {
        if (insight.cicdStage === dup.stage && insight.renderOrder === dup.renderOrder) {
          invalidIds.add(insight.id);
        }
      }
    }

    if (invalidIds.size > 0) {
      validatedInsights = realismResult.processedInsights.filter(i => !invalidIds.has(i.id));
      console.warn('[FINAL_PI_ENGINE][VALIDATION_SUPPRESSED]', {
        suppressedIds: Array.from(invalidIds),
        remainingCount: validatedInsights.length
      });
    } else {
      console.warn('[FINAL_PI_ENGINE][VALIDATION_FAILED_NO_ADDRESSABLE_CANDIDATES]', {
        note: 'Validation failed at aggregate level only (stageDistribution/uniqueIds); no individual candidate suppressed.',
        stageDistributionErrors: validation.results.stageDistribution.errors
      });
    }
  } else {
    piDebugLog('[FINAL_PI_ENGINE][VALIDATION_PASSED]', {
      insightCount: validatedInsights.length,
      stageCounts: validation.results.stageDistribution.stageCounts
    });
  }

  // ============================================================
  // STEP 4: Sort insights by stage and renderOrder
  // ============================================================
  piDebugLog('[FINAL_PI_ENGINE][STEP_4]', 'Sorting insights by stage and renderOrder');

  const _t0_sort = performance.now();
  const sortedInsights = sortCanonicalInsights(validatedInsights);
  const _t1_sort = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'sorting', ms: Math.round(_t1_sort - _t0_sort) });
  const stageCounts = countInsightsByStage(sortedInsights);

  piDebugLog('[FINAL_PI_ENGINE][STEP_4_COMPLETE]', {
    stageCounts,
    sortedIds: sortedInsights.map(i => i.id)
  });

  // ============================================================
  // STEP 5: Adapt insights to UI contract
  // ============================================================
  piDebugLog('[FINAL_PI_ENGINE][STEP_5]', 'Adapting insights to UI contract');

  const _t0_adapter = performance.now();
  const adaptedInsights = adaptCanonicalInsightsToUI(sortedInsights);
  const _t1_adapter = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'renderAdapter', ms: Math.round(_t1_adapter - _t0_adapter) });

  // === RUNTIME TRACE 2: Immediately after renderAdapter ===
  piDebugLog('[RUNTIME_TRACE][STAGE_2_AFTER_RENDER_ADAPTER]', {
    count: adaptedInsights.length,
    ids: adaptedInsights.map(i => i.id),
    titles: adaptedInsights.map(i => i.title)
  });

  // ============================================================
  // PIPELINE DEBUG: Capture counts at each stage for audit
  // ============================================================
  if (typeof window !== 'undefined') {
    if (!(window as any).__CM_DEBUG__) {
      (window as any).__CM_DEBUG__ = {};
    }
    (window as any).__CM_DEBUG__.__CM_PI_PIPELINE_DEBUG__ = {
      // CR-X FINAL: Pre-suppression candidates (before portfolio consolidation)
      preSuppression: {
        total: _dedupedGenerated.length,
        ids: _dedupedGenerated.map(i => i.id)
      },
      generated: {
        total: allGeneratedInsights.length,
        planCode: planCodeInsights.length,
        reviewMerge: reviewMergeInsights.length,
        deployOperate: deployOperateInsights.length,
        ids: allGeneratedInsights.map(i => i.id)
      },
      portfolioSuppressed: {
        total: portfolioSuppressedInsights.length,
        ids: portfolioSuppressedInsights.map(i => ({ id: i.id, reason: i.portfolioSuppressedReason })),
      },
      reviewMergeInputDebug,
      canonicalFiltered: {
        total: canonicalInsights.length,
        nonCanonicalFiltered: nonCanonicalIds.length,
        nonCanonicalIds,
        ids: canonicalInsights.map(i => i.id)
      },
      realismProcessed: {
        total: realismResult.processedInsights.length,
        suppressed: realismResult.suppressedInsights.length,
        degraded: realismResult.degradedInsights.length,
        suppressedIds: realismResult.suppressedInsights.map(i => i.id),
        ids: realismResult.processedInsights.map(i => i.id)
      },
      validated: {
        total: realismResult.processedInsights.length,
        valid: validation.valid,
        errors: validation.allErrors,
        ids: realismResult.processedInsights.map(i => i.id)
      },
      sorted: {
        total: sortedInsights.length,
        stageCounts,
        ids: sortedInsights.map(i => i.id)
      },
      adapted: {
        total: adaptedInsights.length,
        ids: adaptedInsights.map(i => i.id)
      },
      timestamp: Date.now()
    };
    piDebugLog('[PI_PIPELINE_DEBUG]', (window as any).__CM_DEBUG__.__CM_PI_PIPELINE_DEBUG__);
  }

  // === END RUNTIME TRACE ===

  const adapterValidation = validateAdaptedInsights(adaptedInsights);

  let finalAdaptedInsights = adaptedInsights;
  if (!adapterValidation.valid) {
    console.error('[FINAL_PI_ENGINE][ADAPTER_VALIDATION_FAILED]', {
      errors: adapterValidation.errors,
      missingFields: adapterValidation.missingFields
    });
    // Fail closed: suppress adapted insights that fail validation
    const invalidAdaptedIds = new Set(adapterValidation.missingFields.map(f => f.id));
    if (invalidAdaptedIds.size > 0) {
      finalAdaptedInsights = adaptedInsights.filter(i => !invalidAdaptedIds.has(i.id));
      console.warn('[FINAL_PI_ENGINE][ADAPTER_VALIDATION_SUPPRESSED]', {
        suppressedIds: Array.from(invalidAdaptedIds),
        remainingCount: finalAdaptedInsights.length
      });
    }
  } else {
    piDebugLog('[FINAL_PI_ENGINE][STEP_5_COMPLETE]', 'Adapter validation passed');
  }

  // ============================================================
  // CR5 WS2 #13 P0-1 / CR-X P0-1: Shared Top Insights authority.
  //
  // Top ranking runs against the CUSTOMER-VISIBLE canonical finding
  // population — the subset of sortedInsights whose IDs survive adapter
  // validation AND are not reclassified as diagnostic by the adapter.
  //
  // The adapter recomputes isDiagnostic with a broader title-keyword rule
  // than classifyLifecycleClass, and validateAdaptedInsights may suppress
  // adapted insights missing required fields.  Selecting against
  // sortedInsights (pre-adapter) could choose an insight that the adapter
  // suppresses or marks diagnostic, producing a rank that cannot be
  // stamped onto finalAdaptedInsights — a "hole" that drops Top Insights
  // from 5 to 4.
  //
  // By filtering sortedInsights to IDs present in the customer-visible,
  // non-diagnostic adapted output, every selected ID is guaranteed
  // stampable.  Ranking authority stays canonical (CanonicalInsight[]),
  // not adapted (PerformanceInsight[]).
  // ============================================================
  const stampableIds = new Set(
    finalAdaptedInsights
      .filter(i => i.isDiagnostic !== true)
      .map(i => i.id)
  );
  const customerVisibleCanonical = sortedInsights.filter(i => stampableIds.has(i.id));

  const _t0_topInsights = performance.now();
  const topInsightsResult = getTopInsights(customerVisibleCanonical);
  const _t1_topInsights = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'topInsights', ms: Math.round(_t1_topInsights - _t0_topInsights) });
  const topInsightIds = new Set(topInsightsResult.map(i => i.id));
  const topInsightRankMap = new Map<string, number>();
  topInsightsResult.forEach((insight, idx) => {
    topInsightRankMap.set(insight.id, idx + 1);
  });
  piDebugLog('[FINAL_PI_ENGINE][TOP_INSIGHTS_RANKED]', {
    inputPopulation: customerVisibleCanonical.length,
    inputIds: customerVisibleCanonical.map(i => i.id),
    topInsightIds: topInsightsResult.map(i => i.id),
    topInsightRanks: Array.from(topInsightRankMap.entries()).map(([id, rank]) => ({ id, rank })),
  });

  // Stamp topInsightRank on adapted insights
  // CR5 lifecycle authority: diagnostic cards must NOT be topInsightEligible,
  // even if they appear in the rank map. The lifecycle resolver
  // (resolveInsightLifecycle) already set isTopInsightEligible=false for
  // diagnostic/monitor_only/not_significant cards. We preserve that guard
  // here by only stamping isTopInsightEligible=true for non-diagnostic cards.
  finalAdaptedInsights = finalAdaptedInsights.map(i => {
    const rank = topInsightRankMap.get(i.id);
    if (rank !== undefined && i.isDiagnostic !== true) {
      return { ...i, isTopInsightEligible: true, topInsightRank: rank };
    }
    return { ...i, isTopInsightEligible: false, topInsightRank: undefined };
  });

  // ============================================================
  // STEP 6: Populate audit data for UI verification
  // ============================================================
  piDebugLog('[FINAL_PI_ENGINE][STEP_6]', 'Populating audit data for UI verification');
  // Fresh-pilot zero-state: when the canonical input carries no evidence
  // (no sessions, no eligible GitHub snapshot, no period series), an empty
  // result is truthful fail-closed behavior — the audit must not classify
  // it as an engine routing failure.
  const zeroEvidenceInput =
    (canonicalInput.sessionRows?.length || 0) === 0 &&
    !canonicalInput.githubSnapshot &&
    (canonicalInput.githubByPeriod?.length || 0) === 0 &&
    (canonicalInput.prByPeriod?.length || 0) === 0 &&
    (canonicalInput.outcomesByMonth?.length || 0) === 0 &&
    (canonicalInput.productivityByPeriod?.length || 0) === 0;
  populateWindowPIAudit(finalAdaptedInsights, FINAL_PI_ENGINE_ENABLED, 0, realismResult.suppressedInsights, zeroEvidenceInput);

  // ============================================================
  // STEP 7: Return final insights
  // ============================================================
  piDebugLog('[FINAL_PI_ENGINE][COMPLETE]', {
    totalInsights: finalAdaptedInsights.length,
    stageCounts,
    ids: finalAdaptedInsights.map(i => i.id)
  });

  // CR-X FINAL: Expose finalAdaptedInsights IDs for browser/harness reconciliation
  if (typeof window !== 'undefined') {
    if (!(window as any).__CM_DEBUG__) (window as any).__CM_DEBUG__ = {};
    (window as any).__CM_DEBUG__.__CM_PI_PIPELINE_DEBUG__ = {
      ...((window as any).__CM_DEBUG__.__CM_PI_PIPELINE_DEBUG__ || {}),
      finalAdaptedInsights: {
        total: finalAdaptedInsights.length,
        findingCount: finalAdaptedInsights.filter(i => i.isDiagnostic !== true).length,
        diagnosticCount: finalAdaptedInsights.filter(i => i.isDiagnostic === true).length,
        ids: finalAdaptedInsights.map(i => i.id),
        findingIds: finalAdaptedInsights.filter(i => i.isDiagnostic !== true).map(i => i.id),
        diagnosticIds: finalAdaptedInsights.filter(i => i.isDiagnostic === true).map(i => i.id),
      },
    };
  }

  // ============================================================
  // RUNTIME PROOF TABLE
  // ============================================================
  const canonicalRegistry = getCanonicalPIIds();
  const generatedIdsForProof = new Set(allGeneratedInsights.map(i => i.id));
  const adaptedIds = new Set(adaptedInsights.map(i => i.id));
  const diagnosticCount = adaptedInsights.filter(i => i.isDiagnostic === true).length;
  const recommendationEligibleCount = adaptedInsights.filter(i => i.recommendationAllowed === true).length;
  const topInsightEligibleCount = adaptedInsights.filter(i => i.isTopInsightEligible === true).length;

  // CR5 P1.2: Missing-family audit uses family resolution, not raw instance IDs.
  const adaptedFamilyIds = new Set(finalAdaptedInsights.map(i => resolveCanonicalFamilyId(i.id) ?? i.id));
  const missingIds = Array.from(canonicalRegistry).filter(id => !adaptedFamilyIds.has(id));
  const lossStagePerMissing = missingIds.map(id => {
    const generatedFamilyIds = new Set(allGeneratedInsights.map(i => resolveCanonicalFamilyId(i.id) ?? i.id));
    if (!generatedFamilyIds.has(id)) return 'generator';
    return 'adapter/filter';
  });

  const isStress = isStressModeEnabled();
  // CR5 P1: Report findings, diagnostics, and suppressed candidates separately.
  // "Generated N PIs" must never conflate findings with diagnostics.
  // CR5 WS2 P0-1: portfolioSuppressed is a distinct count from diagnosticCount.
  const findingCount = finalAdaptedInsights.filter(i => i.isDiagnostic !== true).length;
  const proofObject = {
    registeredCanonicalCount: registryIds.size,
    activeCanonicalCount: canonicalRegistry.size,
    findingCount: isStress ? 0 : findingCount,
    diagnosticCount: isStress ? 0 : finalAdaptedInsights.filter(i => i.isDiagnostic === true).length,
    portfolioSuppressedCount: isStress ? 0 : portfolioSuppressedInsights.length,
    suppressedCandidateCount: missingIds.length,
    normalRenderedCount: isStress ? 0 : finalAdaptedInsights.length,
    normalActionableCount: isStress ? 0 : finalAdaptedInsights.filter(i => i.recommendationAllowed === true).length,
    normalDiagnosticCount: isStress ? 0 : finalAdaptedInsights.filter(i => i.isDiagnostic === true).length,
    demoRenderedCount: isStress ? finalAdaptedInsights.length : 0,
    topInsightCount: finalAdaptedInsights.filter(i => i.isTopInsightEligible === true).length,
    contractFailure: !validation.valid ? {
      errors: validation.allErrors,
      stageDistributionErrors: validation.results.stageDistribution.errors
    } : null
  };
  piDebugLog('[RUNTIME_PROOF_TABLE]', proofObject);
  if (typeof window !== 'undefined') {
    if (!(window as any).__CM_DEBUG__) (window as any).__CM_DEBUG__ = {};
    // Merge proof fields into existing runtimeProof, preserving baselineSource etc.
    const existing = (window as any).__CM_DEBUG__.runtimeProof || {};
    (window as any).__CM_DEBUG__.runtimeProof = { ...existing, ...proofObject };
  }
  piDebugLog('[RUNTIME_PROOF_TABLE]', {
    ...proofObject,
    generatedFinalComputeCount: allGeneratedInsights.length,
    missingPIIds: missingIds,
    lossStagePerMissingPI: lossStagePerMissing,
    diagnosticTitles: finalAdaptedInsights.filter(i => i.isDiagnostic === true).map(i => ({ id: i.id, title: i.title, reason: i.diagnosticReason })),
    recommendationEligibleTitles: finalAdaptedInsights.filter(i => i.recommendationAllowed === true).map(i => ({ id: i.id, title: i.title })),
    topInsightEligibleTitles: finalAdaptedInsights.filter(i => i.isTopInsightEligible === true).map(i => ({ id: i.id, title: i.title, rank: i.topInsightRank })),
    comparisonStateDistribution: {
      workflow_comparable: adaptedInsights.filter(i => i.comparisonState === 'workflow_comparable').length,
      ai_non_ai_comparable: adaptedInsights.filter(i => i.comparisonState === 'ai_non_ai_comparable').length,
      org_level_only: adaptedInsights.filter(i => i.comparisonState === 'org_level_only').length,
      needs_more_data: adaptedInsights.filter(i => i.comparisonState === 'needs_more_data').length,
      instrumentation_gap: adaptedInsights.filter(i => i.comparisonState === 'instrumentation_gap').length,
      emerging_sample: adaptedInsights.filter(i => i.comparisonState === 'emerging_sample').length
    }
  });

  // ============================================================
  // CR5 WS2 P0-2: Survivor trace for files-edited-by-ide and session-profile-by-ide
  // Two-row table showing each ID at every pipeline stage.
  // ============================================================
  const WS2_TRACE_IDS = ['files-edited-by-ide', 'session-profile-by-ide'];
  const ws2SurvivorTrace = WS2_TRACE_IDS.map(traceId => {
    const generated = _allGeneratedRaw.find(i => i.id === traceId);
    const deduped = _dedupedGenerated.find(i => i.id === traceId);
    const portfolioVisible = portfolioResult.visible.find(i => i.id === traceId);
    const portfolioSuppressed = portfolioResult.suppressed.find(i => i.id === traceId);
    const canonicalFiltered = canonicalInsights.find(i => i.id === traceId);
    const realismProcessed = realismResult.processedInsights.find(i => i.id === traceId);
    const realismSuppressed = realismResult.suppressedInsights.find(i => i.id === traceId);
    const validated = validatedInsights.find(i => i.id === traceId);
    const sorted = sortedInsights.find(i => i.id === traceId);
    const adapted = adaptedInsights.find(i => i.id === traceId);
    const finalAdapted = finalAdaptedInsights.find(i => i.id === traceId);

    const stages = {
      generator: generated ? 'INSIGHT' : 'NOT_GENERATED',
      dedupe: deduped ? 'SURVIVED' : 'LOST',
      portfolioConsolidation: portfolioVisible ? 'VISIBLE' : portfolioSuppressed ? `SUPPRESSED(${portfolioSuppressed.portfolioSuppressedReason})` : 'LOST',
      canonicalFilter: canonicalFiltered ? 'SURVIVED' : 'LOST',
      realism: realismProcessed ? 'SURVIVED' : realismSuppressed ? 'SUPPRESSED' : 'LOST',
      validation: validated ? 'SURVIVED' : 'LOST',
      renderAdapter: adapted ? 'SURVIVED' : 'LOST',
      finalAdaptedInsights: finalAdapted ? 'RENDERED' : 'NOT_RENDERED',
    };

    // Find the first loss stage
    const lossStage = Object.entries(stages).find(([, status]) =>
      status === 'LOST' || status === 'NOT_RENDERED' || status.startsWith('SUPPRESSED')
    );

    return {
      id: traceId,
      stages,
      lossStage: lossStage ? `${lossStage[0]}: ${lossStage[1]}` : 'FULL_SURVIVAL',
    };
  });

  piDebugLog('[WS2_SURVIVOR_TRACE]', JSON.stringify(ws2SurvivorTrace, null, 2));
  if (typeof window !== 'undefined') {
    if (!(window as any).__CM_DEBUG__) (window as any).__CM_DEBUG__ = {};
    (window as any).__CM_DEBUG__.ws2SurvivorTrace = ws2SurvivorTrace;
  }

  // ============================================================
  // CR5 WS2 #13 P0-4: Top Insights ranking trace
  // Generated from the exact post-lifecycle population used by Top.
  // Shows: ID, normalized base ID, resolved decision family, lifecycle
  // state, effect/materiality, confidence, N, selection type, and
  // final rank or exact exclusion reason.
  // ============================================================

  // Build trace from ALL sortedInsights (the ranking input population)
  const topRankingTrace = sortedInsights.map(insight => {
    const baseId = (() => {
      const idx = insight.id.indexOf('__');
      return idx >= 0 ? insight.id.substring(0, idx) : insight.id;
    })();
    const family = resolveCanonicalFamilyId(insight.id) ?? baseId;
    const isEligible = topInsightIds.has(insight.id);
    const rank = topInsightRankMap.get(insight.id);

    // Determine lifecycle state
    let lifecycleState = 'visible';
    if (insight.isDiagnostic === true) lifecycleState = 'diagnostic';
    else if (insight.portfolioSuppressed === true) lifecycleState = 'portfolio_suppressed';
    else if (insight.hasData === false) lifecycleState = 'no_data';
    else if (insight.comparisonState === 'needs_more_data') lifecycleState = 'needs_more_data';
    else if (insight.comparisonState === 'instrumentation_gap') lifecycleState = 'instrumentation_gap';
    else if (insight.comparisonState === 'emerging_sample') lifecycleState = 'emerging_sample';

    const effectSize = typeof insight.deltaPct === 'number' ? Math.abs(insight.deltaPct) :
      typeof insight.delta === 'number' ? Math.abs(insight.delta) : 0;
    const confidenceWeight = insight.confidence === 'high' ? 1.0 : insight.confidence === 'medium' ? 0.8 : 0.5;
    const sampleWeight = Math.min(1, (insight.n || 0) / 100);
    const executiveBoost = insight.isExecutiveFinding ? 1.3 : 1.0;
    const score = effectSize * confidenceWeight * executiveBoost * sampleWeight;

    // Determine selection type from the ACTUAL family and selection phase,
    // NOT from the rank number. CR5 WS2 #14 P0-1b: With no cost configuration,
    // rank 4 must never say "required: cost"; a replacement candidate is
    // fill_slot. The selectionType records the actual selection pass/family.
    let selectionType = 'not_selected';
    if (isEligible) {
      const traceFamily = resolveFamilyForDiversity(insight.id);
      // Check which required family slot this was selected for (slots 1-4)
      // vs fill slot (slot 5+). The REQUIRED_FAMILIES order is:
      // cross_tool_behavior, longitudinal, within_workflow_ai, cost.
      // If the family matches a required family AND the insight was selected
      // in the required-family pass (rank <= 4), record it as required.
      // Otherwise it's a fill_slot.
      if (rank <= 4 && traceFamily === 'cross_tool_behavior') {
        selectionType = 'required: cross_tool_behavior';
      } else if (rank <= 4 && traceFamily === 'longitudinal') {
        selectionType = 'required: longitudinal';
      } else if (rank <= 4 && traceFamily === 'within_workflow_ai') {
        selectionType = 'required: within_workflow_ai';
      } else if (rank <= 4 && traceFamily === 'cost') {
        selectionType = 'required: cost';
      } else {
        selectionType = 'fill_slot';
      }
    }

    // Determine exclusion reason
    let exclusionReason = '';
    if (!isEligible) {
      if (lifecycleState !== 'visible') {
        exclusionReason = `excluded: lifecycle state=${lifecycleState}`;
      } else if (insight.comparisonState === 'needs_more_data' ||
                 insight.comparisonState === 'instrumentation_gap' ||
                 insight.comparisonState === 'emerging_sample') {
        exclusionReason = `excluded: comparisonState=${insight.comparisonState}`;
      } else {
        exclusionReason = 'excluded: family quota filled or lower materiality';
      }
    }

    return {
      id: insight.id,
      normalizedBaseId: baseId,
      resolvedFamily: family,
      lifecycleState,
      effectSize,
      confidence: insight.confidence,
      n: insight.n,
      score: score.toFixed(2),
      selectionType: isEligible ? selectionType : 'not_selected',
      finalRankOrExclusion: isEligible ? `rank ${rank}` : exclusionReason,
    };
  });

  piDebugLog('[TOP_RANKING_TRACE]', JSON.stringify(topRankingTrace, null, 2));
  if (typeof window !== 'undefined') {
    if (!(window as any).__CM_DEBUG__) (window as any).__CM_DEBUG__ = {};
    (window as any).__CM_DEBUG__.topRankingTrace = topRankingTrace;
  }

  // ============================================================
  // COUNT TRACE FOR STRESS MODE DEBUGGING
  // ============================================================
  const countTrace = {
    registeredCount: registryIds.size,
    generatedCount: allGeneratedInsights.length,
    validationPassedCount: realismResult.processedInsights.length,
    filteredCount: realismResult.processedInsights.length,
    adaptedCount: adaptedInsights.length,
    widgetInputCount: adaptedInsights.length, // This is what goes to the widget
    renderedSidebarCount: adaptedInsights.length // This is what sidebar should display
  };
  
  piDebugLog('[FINAL_PI_STRESS][COUNT_TRACE]', countTrace);

  // ============================================================
  // RUNTIME SURVIVOR TABLE — every PI object at every gate
  // ============================================================
  const generatedById = new Map(allGeneratedInsights.map(i => [i.id, i]));
  const canonicalById = new Map(canonicalInsights.map(i => [i.id, i]));
  const realismById = new Map(realismResult.processedInsights.map(i => [i.id, i]));
  const validatedById = new Map(validatedInsights.map(i => [i.id, i]));
  const sortedById = new Map(sortedInsights.map(i => [i.id, i]));
  const adaptedById = new Map(adaptedInsights.map(i => [i.id, i]));
  const finalById = new Map(finalAdaptedInsights.map(i => [i.id, i]));
  const suppressedIdsSet = new Set(realismResult.suppressedInsights.map(i => i.id));
  const invalidIdsSet = new Set<string>();
  for (const id of validation.results.canonicalRegistry.unregisteredIds) invalidIdsSet.add(id);
  for (const entry of validation.results.requiredFields.missingFields) invalidIdsSet.add(entry.id);
  for (const dup of validation.results.uniqueRenderOrder.duplicates) {
    for (const insight of realismResult.processedInsights) {
      if (insight.cicdStage === dup.stage && insight.renderOrder === dup.renderOrder) {
        invalidIdsSet.add(insight.id);
      }
    }
  }

  // CR5 P1.2: Build survivor table for ALL runtime IDs, including
  // per-workflow instance keys. Family IDs without instances are also
  // included so the audit shows which families produced no instances.
  const familyIds = Array.from(getCanonicalPIIds());
  const instanceIds = allGeneratedInsights
    .map(i => i.id)
    .filter(id => !familyIds.includes(id));
  const allIdsForTable = [...familyIds, ...instanceIds];
  const survivorTable = allIdsForTable.map(id => {
    const gen = generatedById.get(id);
    const can = canonicalById.get(id);
    const rea = realismById.get(id);
    const val = validatedById.get(id);
    const sor = sortedById.get(id);
    const adp = adaptedById.get(id);
    const fin = finalById.get(id);

    // Generator output classification
    let genOutput = 'null';
    if (gen) {
      genOutput = (gen as any).isDiagnostic === true ? 'diagnostic' : 'finding';
    }

    // Find suppression reason
    let suppressionReason = '';
    if (!gen) {
      suppressionReason = 'generator returned null (missing evidence)';
    } else if (suppressedIdsSet.has(id)) {
      suppressionReason = 'realism pipeline suppressed';
    } else if (invalidIdsSet.has(id)) {
      suppressionReason = 'validation failed';
    } else if (!can) {
      suppressionReason = 'canonical registry filter removed';
    }

    // Final classification
    const isDiagnostic = fin ? (fin as any).isDiagnostic === true : true;
    const isVisible = !!fin;
    const finalClass = isVisible && !isDiagnostic ? 'real finding' : 'diagnostic';

    return {
      id,
      genOutput,
      hasData: gen ? (gen as any).hasData : undefined,
      presentationType: gen ? (gen as any).presentationType : undefined,
      comparisonMode: gen ? (gen as any).comparisonMode : undefined,
      comparisonState: adp ? (adp as any).comparisonState : undefined,
      isExecutiveFinding: gen ? (gen as any).isExecutiveFinding : undefined,
      title: fin ? fin.title : (gen ? (gen as any).title : '(not generated)'),
      registryMatch: getCanonicalPIIds().has(id),
      realismResult: rea ? 'processed' : (suppressedIdsSet.has(id) ? 'suppressed' : 'n/a'),
      validationResult: val ? 'passed' : (invalidIdsSet.has(id) ? 'failed' : 'n/a'),
      suppressionReason,
      topEligible: adp ? (adp as any).isTopInsightEligible === true : false,
      finalClass,
      visible: isVisible ? 'yes' : 'no'
    };
  });

  piDebugLog('[RUNTIME_SURVIVOR_TABLE]', {
    totalRows: survivorTable.length,
    realFindings: survivorTable.filter(r => r.finalClass === 'real finding').length,
    diagnostics: survivorTable.filter(r => r.finalClass === 'diagnostic').length,
    table: survivorTable
  });

  if (typeof window !== 'undefined') {
    if (!(window as any).__CM_DEBUG__) (window as any).__CM_DEBUG__ = {};
    (window as any).__CM_DEBUG__.__CM_SURVIVOR_TABLE__ = survivorTable;
  }

  // ============================================================
  // UI INPUT LOGGING FOR STRESS MODE PROOF
  // ============================================================
  piDebugLog('[FINAL_PI_STRESS][UI_INPUT]', {
    stressModeActive: isStressModeEnabled(),
    insightCount: adaptedInsights.length,
    ids: adaptedInsights.map(i => i.id)
  });

  // ============================================================
  // OBSERVABILITY: window.__CM_DEBUG__ output summaries
  // ============================================================
  if (typeof window !== 'undefined' && (window as any).__CM_DEBUG__) {
    (window as any).__CM_FINAL_OUTPUTS__ = {
      totalInsights: finalAdaptedInsights.length,
      stageCounts,
      insightIds: finalAdaptedInsights.map(i => i.id),
      suppressedCount: 0,
      fallbackCount: 0,
      timestamp: Date.now()
    };
    piDebugLog('[CM_DEBUG][FINAL_OUTPUTS]', (window as any).__CM_FINAL_OUTPUTS__);
  }

  // ============================================================
  // MIGRATION VALIDATION: Always populate window.__CM_MIGRATION_DATA
  // ============================================================
  if (typeof window !== 'undefined') {
    (window as any).__CM_MIGRATION_DATA__ = {
      endpoint: 'canonical', // Hardcoded for migration validation
      totalInsights: finalAdaptedInsights.length,
      stageCounts,
      insights: finalAdaptedInsights.map(i => ({
        id: i.id,
        title: i.title,
        rightMetric: i.rightMetric,
        details: i.details,
        recommendation: i.recommendation,
        comparisonState: i.comparisonState, // Data truth validation state
        comparisonMode: i.comparisonMode,
        hasData: i.hasData,
        n: i.n,
        breakdownByTool: i.breakdownByTool // Structured breakdown data for QA
      })),
      timestamp: Date.now()
    };
    piDebugLog('[MIGRATION_VALIDATION]', (window as any).__CM_MIGRATION_DATA__);
  }

  // ============================================================
  // COMPARISON STATE DEBUG: Populate window.__CM_COMPARISON_STATE
  // ============================================================
  if (typeof window !== 'undefined') {
    (window as any).__CM_COMPARISON_STATE__ = {
      totalInsights: finalAdaptedInsights.length,
      comparisonStateDistribution: {
        workflow_comparable: finalAdaptedInsights.filter(i => i.comparisonState === 'workflow_comparable').length,
        ai_non_ai_comparable: finalAdaptedInsights.filter(i => i.comparisonState === 'ai_non_ai_comparable').length,
        org_level_only: finalAdaptedInsights.filter(i => i.comparisonState === 'org_level_only').length,
        needs_more_data: finalAdaptedInsights.filter(i => i.comparisonState === 'needs_more_data').length,
        instrumentation_gap: finalAdaptedInsights.filter(i => i.comparisonState === 'instrumentation_gap').length,
        emerging_sample: finalAdaptedInsights.filter(i => i.comparisonState === 'emerging_sample').length
      },
      insightsByComparisonState: finalAdaptedInsights.reduce((acc, i) => {
        const state = i.comparisonState || 'unknown';
        if (!acc[state]) acc[state] = [];
        acc[state].push({
          id: i.id,
          title: i.title,
          comparisonMode: i.comparisonMode,
          hasData: i.hasData,
          n: i.n,
          breakdownCount: i.breakdownByTool ? Object.keys(i.breakdownByTool).length : 0
        });
        return acc;
      }, {} as Record<string, any[]>),
      timestamp: Date.now()
    };
    // COMPARISON_STATE_DEBUG runtime proof DISABLED for MVP2 patch
  }

  if (PI_DEBUG_ENABLED) {
    piDebugLog('[PI_TRACE][FINAL]', `count=${adaptedInsights.length}`);
    piDebugLog('[PI_TRACE][FINAL_IDS]', adaptedInsights.map(i => i.id));
  }
  
  // ============================================================
  // DEMO MODE COVERAGE MATRIX TRACKING
  // ============================================================
  if (isStressModeEnabled()) {
    // Get actual rendered insights from widget if available
    let actualRenderedInsights = finalAdaptedInsights;
    
    // Check if widget has processed these insights (for accurate tracking)
    if (typeof window !== 'undefined' && (window as any).__CM_WIDGET_RENDERED_INSIGHTS) {
      actualRenderedInsights = (window as any).__CM_WIDGET_RENDERED_INSIGHTS;
    }
    
    const coverage = createDemoCoverageMatrix(
      realismResult.processedInsights,
      adaptedInsights,
      actualRenderedInsights
    );
    
    logDemoCoverage(coverage);
    
    const validation = validateDemoCoverage(coverage);
    if (!validation.isComplete) {
      console.warn('[DEMO_COVERAGE_INCOMPLETE]', validation.issues);
    }
    
    // Log actual pipeline counts for debugging
    piDebugLog('[DEMO_PI_COVERAGE_ACTUAL]', {
      registeredCount: coverage.registeredCount,
      disabledCount: coverage.registeredCount - coverage.activeCanonicalCount,
      activeCanonicalCount: coverage.activeCanonicalCount,
      emittedCount: coverage.generatorEmittedCount,
      validatedCount: coverage.validationPassedCount,
      adaptedCount: coverage.adapterPassedCount,
      widgetInputCount: finalAdaptedInsights.length,
      sidebarRenderedCount: coverage.sidebarRenderedCount,
      visibleCount: actualRenderedInsights.length,
      missingIds: coverage.missingIds,
      dropLayerById: 'widget-filtering'
    });
  }
  
  // CR-X FINAL: Total engine timing summary
  const _t1_engine = performance.now();
  piDebugLog('[CRX_PI_TIMING]', { stage: 'TOTAL_ENGINE', ms: Math.round(_t1_engine - _t0_engine), insightCount: finalAdaptedInsights.length });
  if (typeof window !== 'undefined') {
    if (!(window as any).__CM_DEBUG__) (window as any).__CM_DEBUG__ = {};
    (window as any).__CM_DEBUG__.piEngineTotalMs = Math.round(_t1_engine - _t0_engine);
  }

  return finalAdaptedInsights;
}

// ============================================================
// PUBLIC API EXPORTS
// ============================================================

/**
 * Main export: generateFinalCanonicalInsights
 * 
 * This is the only public function that should be called from outside this module.
 * Note: Already exported at function definition (export function)
 */

/**
 * Type exports for external use
 */
export type {
  CanonicalInsightInput,
  CanonicalInsight,
  PerformanceInsight
};

/**
 * Canonical registry exports (for validation and testing)
 */
export {
  CANONICAL_PI_REGISTRY,
  getCanonicalPIById,
  getCanonicalPIsByStage,
  getExecutiveFindings,
  getCanonicalPIIds,
  assertFinalCanonicalInventory
} from './canonicalInsights';

/**
 * Validation exports (for testing)
 */
export {
  validateCanonicalInsights,
  validateUniqueIds,
  validateStageDistribution,
  validateUniqueRenderOrder,
  validateCanonicalRegistry,
  validateRequiredFields
} from './utils/validation';

/**
 * Ranking exports (for testing)
 */
export {
  sortCanonicalInsights,
  groupInsightsByStage,
  countInsightsByStage,
  sortInsightsByRenderOrder,
  getInsightsByStage,
  getExecutiveFindings as getExecutiveFindingsFromInsights,
  getTopInsights
} from './utils/ranking';

/**
 * Generator exports (for testing)
 */
export { generatePlanCodeInsights } from './generators/planCode';
export { generateReviewMergeInsights } from './generators/reviewMerge';
export { generateDeployOperateInsights } from './generators/deployOperate';

/**
 * Adapter exports (for testing)
 */
export {
  adaptCanonicalToUI,
  adaptCanonicalInsightsToUI,
  validateAdaptedInsights
} from './adapters/renderAdapter';
