/**
 * PI V2 Preview Row Canonical IDs
 * 
 * This is the single source of truth for PI V2 preview rows.
 * Currently 7 rows (expanded from 6 to include AI rework burden).
 */

export const V2_PREVIEW_ROW_IDS = [
  // Plan & Code Stage (7 insights)
  'commits-per-session-by-ide',
  'active-coding-time-by-ide',
  'ai-suggestions-accepted-by-ide',
  'average-session-length-by-ide',
  'time-to-first-commit-by-ide',
  'delivery-rate-ai-vs-non-ai',
  'ai-rework-burden-ai-vs-non-ai',
  
  // Review & Merge Stage - Canonical (6 insights)
  'pr-review-cycles-by-ide',         // Review efficiency
  'review-latency-spike-by-ide',      // Review delay
  'reviewer-load-concentration',     // Reviewer scaling bottleneck
  'reopen-pressure-spike',           // Quality instability
  'large-pr-mix-risk',               // PR complexity burden
  'revert-rate-by-ide',              // Code stability
  
  // Deploy & Operate Stage (6 insights)
  'change-failure-rate-trend-by-ide',
  'change-failure-rate-spike-by-ide',
  'deployment-frequency-volatility-by-ide',
  'mttr-by-ide',
  'fast-but-unstable-by-ide',
  'stale-deployment-signal',
  
  // Additional MVP allowlisted PIs
  'pr-size-by-ide',
  'ai-yield-ratio-ai-vs-non-ai',
  'branch-stagnation-risk-ai-vs-non-ai',
  'commit-abandonment-rate-ai-vs-non-ai',
  'session-conditioned-change-risk-ai-vs-non-ai',
  'failed-deployment-pressure',
  'latest-deployment-unhealthy',
  // NEW: Narrative-driven Deploy & Operate PIs
  'deploy-throughput-narrative',
  'cfr-elevated-narrative',
  'deployment-cadence-narrative',
  'latest-deployment-narrative',
  'branches-per-session-by-ide',
  'code-churn-by-ide',
  'delivery-velocity-by-workflow',
  'ai-assisted-delivery-impact',
  'change-failure-rate-trend-org',
  'fast-but-unstable-org',
  'telemetry-ai-focus-imbalance',
  'telemetry-session-idle-time',
  
  // Legacy/Deprecated (marked for removal)
  // 'pr-cycle-time-by-ide',                    // DEPRECATED: folded into pr-review-cycles-by-ide
  // 'session-conditioned-pr-cycle-time-ai-vs-non-ai', // DEPRECATED: folded into pr-review-cycles-by-ide
  // 'pr-cycle-time-bottleneck-by-ide',         // DEPRECATED: folded into pr-review-cycles-by-ide
  // 'rework-rate-by-ide',                       // DEPRECATED: always 0.0% until real rework data
  // 'telemetry-session-quality-regression',     // DEPRECATED: duplicates focus messaging
  // 'telemetry-remote-workspace-drag',          // DEPRECATED: "12m vs 3m" chip
  // 'review-merge-git-context',                 // DEPRECATED: missing implementation
  // 'v2-first-review-latency',                  // DEPRECATED: missing implementation  
  // 'v2-release-risk-index'                     // DEPRECATED: missing implementation
] as const;

export type V2PreviewRowId = typeof V2_PREVIEW_ROW_IDS[number];

/**
 * Check if a row ID is in the canonical set
 */
export function isCanonicalV2PreviewRow(id: string | undefined): id is V2PreviewRowId {
  return id !== undefined && (V2_PREVIEW_ROW_IDS as readonly string[]).includes(id);
}

/**
 * Filter rows to only include canonical V2 preview rows
 */
export function filterToCanonicalV2Rows<T extends { id?: string }>(rows: T[]): T[] {
  return rows.filter(row => isCanonicalV2PreviewRow(row.id));
}

