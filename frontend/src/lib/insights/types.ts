export type Period = string;

// ============================================================================
// SESSION DATA TYPES (for TTFC and other session-based insights)
// ============================================================================

export interface SessionDataPoint {
  session_id: string;
  timestamp: string;
  duration_ms: number;
  user_id: string;
  git_repo_url: string | null;
  git_branch: string | null;
  
  // TTFC - Time to First Commit
  time_to_first_commit_ms: number | null;
  
  // AI activity
  ai_burst_count: number;
  ai_active_span_ms: number | null;
  ai_burst_chars_total: number;
  ai_chars_per_min: number | null;
  ai_intensity_band: 'none' | 'low' | 'medium' | 'high';
  
  // Rework
  rework_ratio_est: number;
  rework_band: 'low' | 'medium' | 'high' | null;
  
  // Flow
  focus_ratio: number;
  idle_ratio?: number;
  flow_profile: 'idle-heavy' | 'debug-heavy' | 'terminal-heavy' | 'coding-heavy' | 'mixed';
  
  // Git Context (for Review & Merge insights)
  git_context_attempts?: number;
  git_context_resolution_ms?: number;
  git_context_resolved_before_end?: boolean;
  
  // Activity metrics (for Review & Merge insights)
  active_coding_duration_ms?: number;
  chars_added_total?: number;
  terminal_ratio?: number;
  
  // Quality
  session_quality_score: number | null;
  session_quality_band: 'high' | 'medium' | 'low' | null;
  
  // Workspace
  is_remote_workspace: boolean;
  remote_name: string | null;
  
  // Extension info (for IDE attribution)
  extension_version: string | null;
  vscode_version: string | null;
  
  // IDE tool identity (from telemetry source)
  tool?: string;
}

export interface EngOutputPoint {
  period: Period;
  team?: string;
  repo?: string;
  prCycleTimeHours?: number;
  timeToFirstReviewHours?: number;
  deploymentFreqPerWeek?: number;
  mergeRatePct?: number;
  // forward-compat
  changeFailureRatePct?: number;
  defectsPerKLOC?: number;
  // MTTR (Mean Time To Recovery) - mapped from multiple aliases
  mttrHours?: number;
}

export interface ToolProductivityPoint {
  period: Period;
  team?: string;
  tool: string;
  aiAssists?: number;
  codingMinutes?: number;
  commits?: number;          // commits_per_session
  sessionMinutes?: number;   // average_session_length_minutes
  source?: 'sim' | 'live' | 'hybrid';  // Data source for filtering
  // forward-compat
  activeUsers?: number;
  sessions?: number;
  codeInsertions?: number;
  codeDeletions?: number;
  filesTouched?: number;
}

export interface InsightEvidence {
  label: string;
  metric?: string;  // Made optional to support simple evidence
  period?: Period;
  value?: number | string;
  delta?: number;
}

export type InsightSeverity = 'critical' | 'high' | 'moderate' | 'watchlist' | 'warning' | 'info' | 'risk' | 'highlight' | 'lowlight' | 'opportunity';
export type InsightSource = 'github' | 'simulated' | 'mixed' | 'combined' | 'productivity';

/**
 * Classification for insight selection:
 * - org_deterministic: Org-level insights using threshold/aggregation logic (no p-values, no tool association)
 * - tool_statistical: Tool-level correlation insights with p-values and r-values
 */
export type InsightClass = 'org_deterministic' | 'tool_statistical';

/**
 * Org insight kind (only relevant when insightClass === 'org_deterministic'):
 * - summary: Always-on section headers (AI usage, coding time, cycle time, reliability)
 * - diagnostic: Situational, limited insights (TTFC regression, productivity skew, etc.)
 */
export type OrgInsightKind = 'summary' | 'diagnostic';

/**
 * Insight tier for hierarchical presentation:
 * - posture: Always-on summaries showing current state (max 5)
 * - trend: Meaningful directional changes over time (max 4)
 * - anomaly: Action items requiring attention (max 4)
 * - drill-down: Supporting evidence, tool-level details (unlimited, collapsed by default)
 */
export type InsightTier = 'posture' | 'trend' | 'anomaly' | 'drill-down';

export interface InsightRecommendation {
  text: string;
  actionType?: 'review_policy' | 'tooling' | 'training' | 'process' | 'ownership' | 'observability';
  link?: string;
}

export interface PerformanceInsight {
  id: string;
  title: string;
  description: string;
  severity: InsightSeverity;
  insightClass?: InsightClass;    // Classification for selection pipeline (defaults to 'org_deterministic' if not set)
  orgKind?: OrgInsightKind;       // ONLY relevant when insightClass === 'org_deterministic'
  tags: string[];
  metricId?: string;              // metric identifier for diversity filtering
  cicdStage?: 'plan-code' | 'review-merge' | 'deploy-operate' | 'other'; // CI/CD pipeline stage
  related?: {
    repos?: string[];
    teams?: string[];
    tools?: string[];
    developers?: string[];
  };
  evidence: InsightEvidence[];
  recommendations: InsightRecommendation[];
  source: InsightSource;
  // V2 formatted display fields (used by formatV2CollapsedMetric)
  displayValue?: string;
  displayDelta?: string;
  // V2 expanded section content (matches Plan & Code patterns)
  whatsHappening?: string;
  whyItMatters?: string;
  // Optional fields for priority scoring and classification
  priorityScore?: number;       // 0..100 derived priority
  critical?: boolean;           // fast flag for CRITICAL RISKS
  normalizedSeverity?: 'risk' | 'lowlight' | 'opportunity' | 'highlight'; // after classifier
  // UI deduplication fields
  equivalenceKey?: string;      // key for deduplication
  alsoObservedIn?: string[];    // tools where this insight was also observed
  // Phase 1: Provenance metadata (foundation for future real vs sim distinction)
  dataSource?: 'real' | 'mixed' | 'sim' | 'unknown';
  toolScope?: 'single-ide' | 'cross-ide' | 'org' | 'unknown';
  tools?: string[];              // identifiers like ['vscode'], ['cursor','windsurf']
  // Summary strip eligibility (for Review & Merge org summary)
  summaryEligible?: boolean;     // true if this insight should appear in org summary strip
  // Display label for chip/badge (overrides metricId-based label)
  ruleLabel?: string;            // e.g., 'Deployment frequency', 'Change failure rate', 'MTTR'
  // Insight tier for hierarchical presentation
  tier?: InsightTier;            // If not set, will be inferred from other properties
  // Story key for de-duplication (groups related insights)
  storyKey?: string;              // e.g., 'reliability-story', 'merge-bottleneck-story'
  // Supporting context for merged insights
  supportingContext?: Array<{     // Secondary insights merged into this one
    id: string;
    title: string;
    metricId?: string;
    evidence: InsightEvidence[];
  }>;
  // Confidence badge for UI
  confidenceBadge?: 'Observed' | 'Mixed' | 'GitHub-only' | 'Estimated';
  // Drill-down marker
  isDrillDown?: boolean;
  // Review & Merge Performance Insights extensions
  metricValue?: number;              // Computed metric value
  comparisonBaseline?: number;       // Previous week value for comparison
  confidenceLevel?: 'HIGH' | 'MEDIUM' | 'LOW';  // Data confidence based on sample size
  reviewPhaseSessionCount?: number;  // Number of review-phase sessions analyzed
}
