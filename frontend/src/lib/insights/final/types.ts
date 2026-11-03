/**
 * Final Canonical Performance Insights Types
 * 
 * This file defines the output contract for canonical Performance Insights.
 * This is the single source of truth for the UI contract.
 * 
 * No imports from computeV2PerformanceInsights.ts or old V2 systems.
 * No dependencies on piV2Manifest.ts, MVP_ALLOWLIST, or V2_PREVIEW_ROW_IDS.
 */

/**
 * The three CI/CD stages for Performance Insights
 */
export type CanonicalStage = 'plan-code' | 'review-merge' | 'deploy-operate';

/**
 * Confidence levels for insights based on data quality
 */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * Presentation type for how an insight should be rendered
 */
export type PresentationType = 'threshold' | 'synthesized' | 'evidence_only';

/**
 * CR5 P0.8: Presentation kind — the semantic shape of the insight.
 * This is SEPARATE from comparisonMode (statistical state) and
 * presentationType (threshold/synthesized/evidence_only).
 *
 * presentationKind determines which card template and title authority
 * the renderer uses. It is declared by the generator/registry and
 * carried unchanged through the entire pipeline.
 *
 * Allowed values:
 * - workflow_comparison: Cross-sectional comparison of workflows/tools
 * - cohort_comparison:   AI vs non-AI or multi-cohort intensity comparison
 * - temporal_trend:      Period-over-period longitudinal change
 * - org_summary:         Organization-level aggregate metric
 * - diagnostic:          Missing data/instrumentation, not actionable
 */
export type PresentationKind =
  | 'workflow_comparison'
  | 'cohort_comparison'
  | 'temporal_trend'
  | 'org_summary'
  | 'diagnostic'
  | 'unit_economics'
  | 'distribution_shape';

/**
 * CR-X FINAL: Semantic family for portfolio orchestration and dominance.
 *
 * Each finding maps to exactly one executive question family. The portfolio
 * layer uses these families to enforce Top Insights diversity and suppress
 * dominated variants of the same story.
 *
 * Families align to the questions an engineering leader asks:
 *   workflow-mix          — adoption/spread across workflows
 *   workflow-temporal      — what changed recently
 *   workflow-cross-comparison — operating difference between workflows
 *   repo-concentration    — where work is concentrated
 *   repo-cross-comparison  — how allocation differs across workflows
 *   within-workflow        — behavior within a single workflow
 *   economics              — cost efficiency / unit economics
 *   review-cycle           — merge cycle, review burden, throughput
 *   review-quality         — reopen, rework, PR size
 *   delivery-throughput    — PR throughput, merge rate
 *   deployment-reliability — failure rate, success distribution
 *   release-reliability    — release cadence
 *   diagnostic             — data/coverage gaps
 */
export type SemanticFamily =
  | 'workflow-mix'
  | 'workflow-temporal'
  | 'workflow-cross-comparison'
  | 'repo-concentration'
  | 'repo-cross-comparison'
  | 'within-workflow'
  | 'economics'
  | 'review-cycle'
  | 'review-quality'
  | 'delivery-throughput'
  | 'deployment-reliability'
  | 'release-reliability'
  | 'diagnostic';

/**
 * Comparison mode for metrics (how values are compared)
 */
export type ComparisonMode = 'threshold_vs_actual' | 'ai_vs_non_ai' | 'trend' | 'absolute';

/**
 * Comparison state for data truth validation
 * 
 * This field indicates whether the insight's data supports the rendered comparison language.
 * The view layer must check this state before rendering comparative titles.
 */
export type ComparisonState =
  | 'workflow_comparable'      // Can compare IDEs/workflows with measured values
  | 'ai_non_ai_comparable'     // Can compare AI vs Non-AI cohorts with measured values
  | 'org_level_only'           // No IDE attribution, org-level metric only
  | 'needs_more_data'          // Insufficient data for any comparison
  | 'instrumentation_gap'      // Missing required fields for comparison
  | 'emerging_sample';         // Low sample size, cannot claim leader/winner

/**
 * Diagnostic reason for why a canonical PI is not actionable
 * 
 * Used for canonical coverage cards when generator returns null.
 */
export type DiagnosticReason =
  | 'NEEDS_MORE_TELEMETRY'              // Insufficient telemetry sessions
  | 'WAITING_FOR_GITHUB'                // GitHub data not available
  | 'NEEDS_SESSION_TO_PR_ATTRIBUTION'   // Session-to-PR correlation missing
  | 'NEEDS_OBSERVED_COMMIT_PROVENANCE'  // Commit events not directly observed (aggregated fallback)
  | 'INSTRUMENTATION_NOT_CAPTURED'      // Required telemetry fields not captured
  | 'ORG_LEVEL_ONLY_NO_IDE_ATTRIBUTION' // Only org-level data, no IDE breakdown
  | 'INSUFFICIENT_WORKFLOW_COMPARISON'  // Not enough workflow diversity
  | 'WAITING_FOR_GITHUB_DELIVERY_OUTCOMES' // GitHub delivery outcome fields not captured by sync
  | 'UNKNOWN_SUPPRESSION_REASON';       // Generator returned null for unknown reason

/**
 * Tool breakdown data for multi-tool insights
 */
export interface ToolBreakdown {
  [toolName: string]: {
    value: number;
    count: number;
    baseline?: number;
    delta?: number;
    formatted?: string; // Formatted display value with units
    label?: string; // Human-readable label for the tool metric
    source?: string; // Data source (e.g., 'live', 'seeded')
  };
}

/**
 * Evidence supporting an insight's conclusion
 */
export interface Evidence {
  metric: string;
  value: number | string;
  label?: string;
  comparison?: string;
  context?: string;
}

/**
 * A canonical Performance Insight
 * 
 * This is the final output contract used by the UI.
 * All canonical PIs must conform to this interface.
 */
export interface CanonicalInsight {
  // Identity
  id: string;
  title: string;
  cicdStage: CanonicalStage;
  
  // Priority and ordering
  canonicalPriority: number;
  renderOrder: number;
  
  // Presentation
  presentationType: PresentationType;
  presentationKind?: PresentationKind; // CR5 P0.8: Semantic card shape (workflow_comparison, cohort_comparison, temporal_trend, org_summary, diagnostic)
  comparisonMode?: ComparisonMode;
  comparisonState?: ComparisonState;
  
  // Core metrics
  current: number | null; // null for unavailable diagnostic evidence
  baseline?: number;
  delta?: number;
  deltaPct?: number;
  displayValue?: string; // Formatted display value with units
  displayDeltaPct?: string; // Formatted delta percentage
  rightMetric?: string;
  rightMetricLabel?: string;
  polarity?: 'higher_is_better' | 'lower_is_better' | 'neutral'; // Metric polarity for leader/laggard determination
  
  // Data quality
  confidence: ConfidenceLevel;
  coveragePct?: number;
  n?: number; // Sample size
  hasData: boolean;
  
  // Content
  description?: string;
  recommendation?: string;
  executiveSummary?: string;
  evidence?: Evidence[];
  
  // Tool breakdown (for multi-tool insights)
  breakdownByTool?: ToolBreakdown;
  
  // Executive finding flags
  isExecutiveFinding?: boolean;
  
  // Demo flags (for MVP mode)
  demoFlag?: 'demo_primary' | 'demo_secondary' | 'demo_hidden';
  demoNarrativePriority?: number; // Priority for demo narrative scoring (0-100)

  // Data source marking (for mixed data scenarios)
  dataSource?: 'live' | 'seeded' | 'mixed' | 'unavailable'; // Tracks whether insight uses live API data, seeded demo data, both, or is unavailable
  
  // Enhanced narrative fields for decision-support system
  whatChanged?: string;
  whyItMatters?: string;
  evidenceAndContext?: string;
  operationalImpact?: string;
  primaryRisk?: string;
  cohort?: string;
  confidenceReasoning?: string;
  operationalRead?: string; // Operational interpretation of tool breakdown
  urgencyLabel?: 'action_required' | 'investigate' | 'monitor' | 'informational'; // Visual hierarchy: RED/AMBER/GREEN/BLUE (matches widget sorting)
  metricDefinition?: string; // Short operational definition of the primary metric (1 line max)
  operationalBreadcrumbs?: string[]; // Raw operational facts (e.g., "14 reverted PRs", "23 failed deployments")
  recommendationState?: 'action_required' | 'investigate' | 'monitor_only' | 'needs_validation' | 'policy_candidate' | 'no_action'; // Varied recommendation states to reduce template feel
  
  // Engine provenance fields (for automated verification)
  engineVersion?: 'FINAL_ENGINE_V1' | 'LEGACY_V2';
  generatorSource?: string;
  featureFlagState?: boolean;

  // Diagnostic coverage card fields (for canonical coverage when generator returns null)
  isDiagnostic?: boolean;
  diagnosticReason?: DiagnosticReason;
  diagnosticUnlockPath?: string; // Ed-friendly explanation of what unlocks this PI

  // CR5 WS2 P0-1: Portfolio suppression — distinct from diagnostic/data-gap.
  // A portfolio-suppressed insight has measured evidence but was omitted because
  // a stronger or redundant candidate was selected for the visible portfolio.
  // It must NOT flow through the diagnostic renderer or count as a data gap.
  portfolioSuppressed?: boolean;
  portfolioSuppressedReason?: string;

  // CR-X FINAL: Semantic family for portfolio orchestration and dominance.
  // Stamped after evidence qualification, before Top Insights selection.
  // Maps each finding to an executive question family so the portfolio
  // layer can enforce diversity and dominance without hardcoding PI IDs.
  semanticFamily?: SemanticFamily;

  /**
   * CR-X FINAL — Explicit story/dominance key for parent/child suppression.
   *
   * When a synthesis finding and its component mirror cards share the same
   * storyKey, the synthesis wins and the component cards are suppressed from
   * rendered findings (their numbers remain in the synthesis evidence).
   *
   * Example: workflow-mix:<window> — the synthesized org workflow-mix finding
   * and its component workflow-share findings share this key.
   *
   * This is NOT fuzzy family/subject heuristics. It is an explicit key
   * emitted by generators that know their parent/child relationship.
   *
   * Only set when there is a genuine parent/child story. Independent findings
   * in the same semantic family must NOT share a storyKey.
   */
  storyKey?: string;

  // CR-X 2026-08-30 — Lifecycle classification (A/B/C/D).
  // Explicit distinction between finding classes for ranking:
  //   'decision'   — measured pattern warranting a decision/action (Top-eligible, high rank)
  //   'contextual' — truthful observation, not actionable on its own (Top-eligible, lower rank)
  //   'diagnostic' — missing/ineligible evidence (never Top)
  //   'suppress'   — weak/noisy signal, monitor-only (never Top, never backfills)
  // When unset, classifyLifecycleClass() infers it from isDiagnostic/urgency/recommendationState.
  lifecycleClass?: 'decision' | 'contextual' | 'diagnostic' | 'suppress';

  // Generator-selected comparison pair — explicit contract for which workflows
  // control title, evidence, bars, gap, and interpretation. The adapter must
  // consume this instead of independently sorting breakdownByTool.
  selectedComparison?: {
    leaderKey: string;   // highest-value primary workflow key
    baselineKey: string; // lowest-value primary workflow key
  };
}

/**
 * Input data required to generate canonical insights
 */
export interface CanonicalInsightInput {
  sessionRows: any[]; // V2SessionPrimitiveRow[] (avoid import for now)
  githubByPeriod?: any[]; // EngOutputPoint[] (avoid import for now)
  prByPeriod?: any[]; // PR period entries with merged_pr_count (Unit Economics V1)
  outcomesByMonth?: any[]; // Monthly observed outcome counts (Unit Economics V1 exact-count authority)
  githubSnapshot?: any;
  productivityByPeriod?: any[];
  granularity: 'day' | 'week' | 'month' | 'quarter';
  /**
   * CR-X Track P2: Externally-resolved cost configs from backend API.
   * When provided, PI generators use these as primary cost authority
   * instead of reading localStorage directly. This ensures PI and PBT
   * consume the same resolved ToolCostConfig[].
   * Backend configs do NOT have isConfigured — positive monthlySpend is authority.
   */
  externalCostConfigs?: Array<{ toolId: string; monthlySpend: number }>;
  /**
   * CR-X Track A: Population context label for PI subtitles.
   * Describes the scoped population (time range, developer, repo, workflow)
   * so PI output can state its population explicitly.
   * Example: "Last 30d · Developer dev1 · Repo owner/repo1"
   */
  populationContextLabel?: string;
  /**
   * CR-X Track A: Population scope for PI labeling.
   * 'org_level' = full canonical population (default, AIOI-style)
   * 'scoped' = filtered by time/developer/repo/workflow via analysis context
   */
  populationScope?: 'org_level' | 'scoped';
  /**
   * CR-X 1B.1: Time semantics computed from interval-union.
   * Exposed as an explicit property so PI generators can distinguish:
   * - agent_compute_time_ms: Σ(duration_ms) — additive agent runtime
   * - developer_elapsed_time_ms: UNION of session intervals — wall-clock span
   * - overlap_time_ms: time where ≥2 sessions overlap
   * - concurrency_ratio: additive / unique
   * - max_concurrent_sessions: peak simultaneous sessions
   * - developer_count: distinct developer_ids
   *
   * This is the canonical time-semantics authority for PI generators.
   * Previously attached as non-enumerable _timeSemantics on sessionRows (debug-only).
   */
  timeSemantics?: TimeSemanticsData;
  /**
   * CR-X FINAL: Shared engine cache — pre-computed aggregates computed once
   * per engine run and reused across generators to avoid repeated full
   * scans of sessionRows. Does NOT change evidence semantics; only avoids
   * redundant computation of identical results.
   */
  _engineCache?: SharedEngineCache;
}

/**
 * CR-X FINAL: Shared engine cache — pre-computed aggregates.
 * Computed once in index.ts and passed through to generators.
 */
export interface SharedEngineCache {
  /** Sessions grouped by canonical workflow ID (computed once) */
  sessionsByWorkflow: Record<string, any[]>;
  /** Sessions grouped by normalized repo URL (computed once) */
  sessionsByRepo: Record<string, any[]>;
  /** Temporal comparison windows (computed once) */
  temporalWindows: any;
  /** Recent-window session rows (computed once) */
  recentRows: any[];
  /** Prior-window session rows (computed once) */
  priorRows: any[];
  /** Delivery attribution cache (computed once per githubSnapshot) */
  deliveryAttribution?: any;
}

/**
 * CR-X 1B.1: Time semantics data exposed to PI generators.
 */
export interface TimeSemanticsData {
  agent_compute_time_ms: number;
  developer_elapsed_time_ms: number;
  overlap_time_ms: number;
  concurrency_ratio: number;
  max_concurrent_sessions: number;
  developer_count: number;
  total_sessions: number;
  valid_sessions: number;
}

/**
 * Generator function signature for canonical insights
 */
export type CanonicalInsightGenerator = (
  input: CanonicalInsightInput
) => CanonicalInsight | null;

/**
 * Registry entry for a canonical PI
 */
export interface CanonicalPIEntry {
  id: string;
  title: string;
  stage: CanonicalStage;
  canonicalPriority: number;
  renderOrder: number;
  generatorKey: string;
  isExecutiveFinding?: boolean;
  isFallbackAllowed?: boolean;
  dedupeGroup?: string;
  minimumConfidence?: ConfidenceLevel;
  demoRequired?: boolean;
  suppressIfWeak?: boolean;
  suppressIfBaseline?: boolean;
  suppressIfNoDelta?: boolean;
  intendedStageQuotaBucket?: number;
  maturity?: 'pilot-ready' | 'pilot-validated' | 'production-ready' | 'experimental';
}
