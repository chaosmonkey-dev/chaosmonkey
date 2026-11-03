export type PrimitiveLevel = 'session' | 'repo' | 'tool' | 'period' | 'org';

export type PrimitiveMissingReasonCode =
  | 'NO_SESSIONS'
  | 'MISSING_FIELD'
  | 'INVALID_VALUE'
  | 'INSUFFICIENT_SAMPLES'
  | 'NO_REPO_KEY'
  | 'NO_TOOL_KEY'
  | 'NO_PERIOD_KEY';

export type PrimitiveSpec = {
  name: string;
  level: PrimitiveLevel;

  // Exact fields required (strings are dot-paths for documentation/debug; not used for access).
  requiredFields: string[];

  // Whether primitive can be computed with partial data (fallback behavior described in nullabilityRules).
  nullabilityRules: string;

  // Minimum sample sizes used when primitive is an aggregate (percentiles/correlation/etc.).
  minSampleSizeRules?: string;
};

export type PrimitiveCoverageRow = {
  primitive: string;
  level: PrimitiveLevel;
  totalRows: number;
  computableRows: number;
  coveragePct: number;
};

export type PrimitiveMissingReasons = Record<string, Record<PrimitiveMissingReasonCode | string, number>>;

export type V2PrimitiveRegistry = {
  specs: PrimitiveSpec[];
  specByName: Record<string, PrimitiveSpec>;
};

export type V2SessionPrimitiveRow = {
  session_id: string;
  timestamp: string;
  user_id?: string;
  tool: string;
  repoKey: string | null;
  periodKey: string;

  // Base numeric facts (nullable)
  session_duration_minutes: number | null;
  session_ttfc_minutes: number | null;
  session_ai_burst_count: number | null;
  session_ai_active_span_minutes: number | null;
  session_ai_chars_per_min: number | null;
  session_ai_burst_chars_total: number | null;
  session_ai_first_burst_minutes: number | null;
  session_ai_first_burst_at_ms?: number | null;
  session_ai_last_burst_ratio: number | null;
  session_ai_span_ratio: number | null;

  session_start_timestamp_is_derived?: boolean;

  session_focus_ratio: number | null;
  session_idle_ratio: number | null;
  session_rework_ratio_est: number | null;
  session_flow_profile: string | null;
  session_active_coding_duration_minutes: number | null;
  lines_added_total: number | null;
  lines_removed_total_est: number | null;
  chars_added_total?: number | null;
  chars_removed_total_est?: number | null;

  // Newly restored fields from API (keep ms units)
  git_branch?: string | null;
  time_to_first_commit_ms?: number | null;
  git_context_status?: string | null;
  git_context_reason?: string | null;
  git_context_resolution_ms?: number | null;

  // Derived flags
  session_has_ttfc: boolean;
  session_has_ai_activity: boolean;
  // v2-only: indicates we observed a commit signal field (e.g. ttfc field present or commit_count present)
  session_commit_signal_present?: boolean;
};

export type ToolFingerprintSummary = {
  tool: string;
  sessions: number;
  flowProfileShares: Record<string, number>;
  focusRatioP50: number | null;
  durationMinutesP50: number | null;
  aiCharsPerMinP50: number | null;
};

export type V2PreviewRow = {
  id: string;
  title: string;
  subtitle: string;
  rightMetric: string;
  secondaryRightMetric?: string;
  confidence?: 'high' | 'medium' | 'low';
  details: string;
  coveragePct: number;
  n: number;
  insufficientSignal: boolean;
  // Quality gate fields
  recommendation?: string; // Actionable recommendation (required for quality gate)
  breakdownByTool?: Record<string, number | string>; // Tool breakdown (optional, but one of breakdownByTool OR breakdownByPeriod required)
  breakdownByPeriod?: Record<string, number | string>; // Period breakdown (optional, but one of breakdownByTool OR breakdownByPeriod required)
  evidence?: string[]; // Evidence samples (optional)
  definition?: string; // Definition/explanation of the metric (optional)
  computableRows?: number; // Number of rows used in computation (defaults to n)
  totalRows?: number; // Total rows available (defaults to n / (coveragePct/100))
  // 3-state insight model fields
  signalCoveragePct?: number; // Sessions or periods used / total eligible (for expanded view)
  primarySignalsUsed?: string[]; // Signals used in computation (e.g. ['commits', 'sessions', 'PR periods'])
  dataMaturityLabel?: 'Measured' | 'Observed but flat' | 'Early Signal'; // Data maturity indicator
  // Demo classification fields
  demoFlag?: 'demo_primary' | 'demo_secondary' | 'demo_hidden'; // Demo visibility classification
  contributingUnitsCount?: number; // Number of sessions, periods, or PRs contributing to computation
  contributingUnitType?: 'sessions' | 'periods' | 'prs' | 'deployments' | 'reviews'; // Type of contributing units
  // Urgency label (V1-style)
  urgencyLabel?: 'action_required' | 'investigate' | 'monitor' | 'informational'; // Urgency/importance indicator
  // Owner field (V1-style actionability)
  owner?: string | string[]; // Team, role, or system responsible for action
  // Content quality fields (PART B)
  whatsHappening?: string; // One sentence: metric + topTool + comparison
  whyItMatters?: string; // One sentence: business outcome, no naked numbers
  // Deduplication field (PART D)
  conceptKey?: string; // For deduplication (e.g., "change-failure-rate")
  // Structured display fields (Plan & Code MVP)
  displayValue?: string; // Pre-formatted primary value (e.g., "26.7 assists/week")
  displayUnit?: string; // Semantic unit (e.g., "assists/week", "min/week")
  displayWinnerLabel?: string; // Winner tool name (e.g., "Cursor")
  displayDelta?: string; // Delta vs runner-up (e.g., "+134% vs VSCode")
  displayDeltaPct?: number; // Delta percentage (e.g., 134.5)
  confidenceLabel?: string; // Low-data indicator (e.g., "Low confidence (4 sessions)")
  displayTimeWindow?: string; // Time window description (e.g., "per week", "per selected time window")
  // Stage and core metadata (explicit, no pattern matching)
  cicdStage?: 'plan-code' | 'review-merge' | 'deploy-operate'; // Lifecycle stage assignment
  isCore?: boolean; // Whether this PI is core (cards + always prioritized) or supporting (strip, often gated)
  visibilityHint?: 'core' | 'supporting'; // Optional hint for visibility classification
};

export type V2OrgFallbackFacts = {
  toolSessionFingerprints: ToolFingerprintSummary[];
  orgTtfcP90P50Ratio: number | null;
  orgAiIntensityByTool: Array<{ tool: string; p50: number | null; p90: number | null; n: number }>;
  orgReworkDistribution: { p50: number | null; p90: number | null; n: number };
  orgAiKickoffTiming: { p50: number | null; n: number; coveragePct: number } | null;
  orgAiSpanCoverage: { p50: number | null; n: number; coveragePct: number } | null;
  orgLateAiUsageShare: { share: number; n: number; coveragePct: number } | null;
  previewRows: V2PreviewRow[];
};

export type V2ShadowOutput = {
  enabled: boolean;
  primitiveRegistry: V2PrimitiveRegistry;
  primitiveCoverage: PrimitiveCoverageRow[];
  reasonsMissing: PrimitiveMissingReasons;
  fallbackFacts: V2OrgFallbackFacts | null;

  debug?: {
    rawRowCount: number;
    filteredRowCount: number;
    normalizedSessionCount: number;
    computedPrimitiveRowCount: number;
    fallbackFactsComputed: boolean;
    error: { message: string; stack?: string; stage?: string } | null;
    sampleKeysTopLevel: string[];
    sampleKeysMetadata: string[];
    sampleKeysNormalized: string[];
    sampleRowTopLevel?: Record<string, any>;
    sampleRowMetadata?: Record<string, any>;
    sampleRowNormalized?: Record<string, any>;

    sampleRowRawTopLevel?: Record<string, any>;
    sampleRowRawMetadataType?: 'object' | 'string' | 'null' | 'array' | 'other' | string;
    sampleRowRawMetadataKeys?: string[];

    toolSourceFieldsAudit?: Record<string, { nonEmpty: number; empty: number; missing: number }>;
    toolSourceFieldsAuditCandidates?: string[];

    toolDistribution?: Record<string, number>;
    normalizedToolHistogram?: Record<string, number>;
    normalizedSessionCountUsedForToolDist?: number;

    toolRawCounts?: Record<string, number>;
    toolCanonicalCounts?: Record<string, number>;
    toolDroppedCount?: number;
    toolChosenPathCounts?: Record<string, number>;
    burstTimingCoverage?: {
      total: number;
      ai_first_burst_at_ms: { present: number; missing: number; numberCount: number; stringCount: number };
      ai_last_burst_at_ms: { present: number; missing: number; numberCount: number; stringCount: number };
      ai_active_span_ms: { present: number; missing: number; numberCount: number; stringCount: number };
    };
    exampleNormalizedSession?: {
      session_id: string;
      tool: string;
      duration_ms: number | null;
      ai_first_burst_at_ms: number | null;
      ai_last_burst_at_ms: number | null;
      ai_active_span_ms: number | null;
      focus_ratio: number | null;
      idle_ratio: number | null;
      flow_profile: string | null | undefined;

      tool_chosen_path?: string | null;
      tool_raw_value?: any;
      raw_tool_fields?: {
        tool?: any;
        tool_raw?: any;
        source?: any;
        editor_source?: any;
        ide?: any;
        client_source?: any;
        session_source?: any;
      };
    };

    exampleSessionChosenReason?: string;
  // New v2-only debug fields for tracking sessions input provenance
  sessionsInputSource?: string;
  sessionsInputCount?: number;
  sessionsInputFirstKeys?: string[];
  // V2 readiness/status
  status?: 'ok' | 'loading' | 'empty';
  isLoaded?: boolean;
  };

  // For debugging only; not consumed by v1 UI.
  topCandidateSignals: Array<{ key: string; value: any }>;
};
