/**
 * Canonical Telemetry Types
 *
 * TypeScript types for the canonical telemetry endpoint (/api/telemetry/canonical)
 * Based on validated backend response structures from Phase 1 implementation.
 *
 * See: docs/final/telemetry-canonical-design.md
 */

/**
 * Shared metadata fields returned by both sessions and aggregated formats.
 * These fields prove that both formats operate on the same canonical population.
 */
export interface CanonicalTelemetryMetadata {
  /** Total number of records in the canonical population */
  canonical_population_count: number;
  /** Session count breakdown by tool */
  session_count_by_tool: Record<string, number>;
  /** Time range for the query */
  time_range: {
    from: string; // ISO 8601 date
    to: string; // ISO 8601 date
  };
  /** List of tools present in the canonical population */
  tools_in_population: string[];
  /** Filters applied to the query */
  filters_applied: {
    user_id: string | null;
    developer_ids?: string | null;
    /** K1B: raw cohort_id param ('all' | 'unassigned' | '<id>' | null) */
    cohort_id?: string | null;
    /**
     * K1B: cohort scope proof — the exact scope that constrained the
     * population. null when no cohort filter is applied.
     */
    cohort?: {
      id?: number;
      name?: string;
      mode?: 'unassigned';
      member_count?: number;
      resolved_developer_count: number;
      membership_semantics: 'current';
    } | null;
    git_repo_url: string | null;
    repos?: string | null;
    git_branch: string | null;
    tools: string | null;
    has_ai: boolean | null;
  };
  /** Hash of the query for reproducibility */
  query_hash: string;
  /** Source table for the data */
  source_table: string;
  /** Timestamp when the response was generated */
  generated_at: string; // ISO 8601 datetime
}

/**
 * Metadata specific to sessions format (includes pagination)
 */
export interface CanonicalTelemetrySessionsMetadata extends CanonicalTelemetryMetadata {
  /** Current page number */
  page: number;
  /** Records per page */
  per_page: number;
  /** Total number of pages */
  total_pages: number;
  /** Response format */
  format: 'sessions';
}

/**
 * Metadata specific to aggregated format (includes aggregation info)
 */
export interface CanonicalTelemetryAggregatedMetadata extends CanonicalTelemetryMetadata {
  /** Number of tools returned in aggregated data */
  tools_returned: number;
  /** Number of periods returned in aggregated data */
  periods_returned: number;
  /** Aggregation period used */
  period: 'day' | 'week' | 'month';
  /** Response format */
  format: 'aggregated';
}

/**
 * Individual session record from canonical endpoint
 */
export interface CanonicalTelemetrySession {
  /** Session ID */
  session_id: number;
  /** Tool name (normalized) */
  tool: string;
  /** Session duration in milliseconds */
  duration_ms: number;
  /** Session timestamp */
  timestamp: string; // ISO 8601 datetime
  /** Number of AI bursts in session */
  ai_burst_count: number;
  /** Active coding duration in milliseconds */
  active_coding_duration_ms: number;
  /** Time to first commit in milliseconds */
  time_to_first_commit_ms: number;
  /** Total lines added */
  lines_added_total: number;
  /** Estimated total lines removed */
  lines_removed_total_est: number;
  /** Number of commits in session */
  commit_count: number;
  /** Number of files edited */
  files_edited: number;
  /** Git repository URL */
  git_repo_url: string | null;
  /** Git branch */
  git_branch: string | null;
  /** Raw metadata (null in canonical format) */
  metadata: null;
}

/**
 * Aggregated record from canonical endpoint
 */
export interface CanonicalTelemetryAggregatedRecord {
  /** Tool name (normalized) */
  tool: string;
  /** Period identifier (e.g., "2025-52" for week 52 of 2025) */
  period: string;
  /** Number of sessions in this period */
  session_count: number;
  /** Average session length in minutes */
  average_session_length_minutes: number;
  /** Total session minutes in this period */
  total_session_minutes: number;
  /** Active coding time in minutes */
  active_coding_time_minutes: number;
  /** AI usage duration in minutes */
  ai_usage_duration_minutes: number;
  /** Average time to first commit in minutes */
  time_to_first_commit_minutes: number;
  /** Average AI suggestions accepted */
  ai_suggestions_accepted: number;
  /** Average files edited per session */
  files_edited_per_session: number;
  /** Average commits per session */
  commits_per_session: number;
  /** Idle time in minutes */
  idle_time_minutes: number;
  /** Focus ratio (active_coding_time / total_time) */
  focus_ratio: number;
}

/**
 * Sessions format response from canonical endpoint
 */
export interface CanonicalTelemetrySessionsResponse {
  /** Array of session records */
  data: CanonicalTelemetrySession[];
  /** Response metadata */
  metadata: CanonicalTelemetrySessionsMetadata;
}

/**
 * Aggregated format response from canonical endpoint
 */
export interface CanonicalTelemetryAggregatedResponse {
  /** Array of aggregated records */
  data: CanonicalTelemetryAggregatedRecord[];
  /** Response metadata */
  metadata: CanonicalTelemetryAggregatedMetadata;
}

/**
 * Query parameters for canonical endpoint
 */
export interface CanonicalTelemetryQueryParams {
  /** Start date (ISO 8601) */
  from: string;
  /** End date (ISO 8601) */
  to: string;
  /** Response format */
  format: 'sessions' | 'aggregated';
  /** Aggregation period (required for aggregated format) */
  period?: 'day' | 'week' | 'month';
  /** Page number (for sessions format) */
  page?: number;
  /** Records per page (for sessions format, max 200) */
  per_page?: number;
  /** Filter by user ID */
  user_id?: string;
  /** Filter by developer cohort (K1B): '<id>' | 'all' | 'unassigned' */
  cohort_id?: string;
  /** Filter by git repository URL */
  git_repo_url?: string;
  /** Filter by git branch */
  git_branch?: string;
  /** Filter by tools (comma-separated) */
  tools?: string;
  /** Filter by AI presence */
  has_ai?: boolean;
  /** Include raw metadata in response */
  include_raw_metadata?: boolean;
}

/**
 * Tool names (normalized)
 */
export type ToolName = 'cursor' | 'windsurf' | 'vscode' | 'claude_code' | 'codex' | 'github_copilot' | 'unknown';

/**
 * Aggregation period
 */
export type AggregationPeriod = 'day' | 'week' | 'month';

/**
 * Response format
 */
export type ResponseFormat = 'sessions' | 'aggregated';
