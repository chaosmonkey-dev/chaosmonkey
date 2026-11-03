/**
 * Unified Metrics Schema - Single Source of Truth
 * 
 * This file defines the core types and interfaces for ChaosMonkey's unified metrics system.
 * It supports both real GitHub data and simulated IDE productivity metrics with a consistent schema.
 */

// ============================================================================
// CORE ENUMS & UNIONS
// ============================================================================

export type SourceType = 'github' | 'simulator'

export type Scope = 'org' | 'team' | 'dev'

export type ToolId = 'cursor' | 'vscode' | 'intellij' | 'webstorm' | 'windsurf' | 'vim' | 'neovim' | 'jetbrains'

export type MetricKind = 'COUNT' | 'DURATION' | 'RATIO'

// ============================================================================
// UNIFIED METRIC IDENTIFIERS
// ============================================================================

// GitHub Metrics
export type GitHubMetricId = 
  | 'gh.pr_opened'
  | 'gh.pr_merged' 
  | 'gh.pr_reopened'
  | 'gh.pr_rejected'
  | 'gh.time_to_merge_hours'
  | 'gh.comment_to_merge_ratio'
  | 'gh.deployments'
  | 'gh.mttr_hours'

// IDE Productivity Metrics
export type IDEMetricId = 
  | 'ide.ai_suggestions_accepted'
  | 'ide.files_per_session'
  | 'ide.commits_per_session'
  | 'ide.avg_session_length'
  | 'ide.time_to_first_commit'
  | 'ide.ai_usage_duration'
  | 'ide.idle_time'
  | 'ide.acceptance_rate'

// Unified Metric ID (covers both domains)
export type UnifiedMetricId = GitHubMetricId | IDEMetricId

// ============================================================================
// CORE INTERFACES
// ============================================================================

/**
 * Represents a single metrics event with all necessary context
 */
export interface UnifiedEvent {
  metric: UnifiedMetricId
  kind: MetricKind
  value: number            // single point value (already aggregated at event-level)
  timestamp: string        // ISO format
  source: SourceType
  scope: Scope
  orgId?: string
  teamId?: string
  developerId?: string
  repo?: string
  toolId?: ToolId          // for IDE metrics
}

/**
 * Single data point in a time series
 */
export interface UnifiedSeriesPoint {
  t: string  // timestamp
  v: number  // value
}

/**
 * Complete time series with metadata
 */
export interface UnifiedSeries {
  label: string
  points: UnifiedSeriesPoint[]
  meta?: Record<string, unknown>
}

/**
 * Query parameters for fetching unified metrics
 */
export interface UnifiedQuery {
  from: string
  to: string
  viewBucket: 'hourly' | 'daily' | 'weekly' | 'monthly'
  scope: Scope
  developerIds?: string[]
  teamIds?: string[]
  repoNames?: string[]
  toolIds?: ToolId[]
  metrics: UnifiedMetricId[]   // one or many
}

// ============================================================================
// METRIC METADATA MAPPINGS
// ============================================================================

/**
 * Maps metric IDs to their kind (COUNT, DURATION, RATIO)
 */
const METRIC_KIND_MAP: Record<UnifiedMetricId, MetricKind> = {
  // GitHub Metrics
  'gh.pr_opened': 'COUNT',
  'gh.pr_merged': 'COUNT',
  'gh.pr_reopened': 'COUNT',
  'gh.pr_rejected': 'COUNT',
  'gh.time_to_merge_hours': 'DURATION',
  'gh.comment_to_merge_ratio': 'RATIO',
  'gh.deployments': 'COUNT',
  'gh.mttr_hours': 'DURATION',
  
  // IDE Metrics
  'ide.ai_suggestions_accepted': 'COUNT',
  'ide.files_per_session': 'COUNT',
  'ide.commits_per_session': 'COUNT',
  'ide.avg_session_length': 'DURATION',
  'ide.time_to_first_commit': 'DURATION',
  'ide.ai_usage_duration': 'DURATION',
  'ide.idle_time': 'DURATION',
  'ide.acceptance_rate': 'RATIO'
} as const

/**
 * Maps metric IDs to human-readable labels
 */
const METRIC_LABEL_MAP: Record<UnifiedMetricId, string> = {
  // GitHub Metrics
  'gh.pr_opened': 'Pull Requests Opened',
  'gh.pr_merged': 'Pull Requests Merged',
  'gh.pr_reopened': 'Pull Requests Reopened',
  'gh.pr_rejected': 'Pull Requests Rejected',
  'gh.time_to_merge_hours': 'Time to Merge (hours)',
  'gh.comment_to_merge_ratio': 'Comments per Merge',
  'gh.deployments': 'Deployments',
  'gh.mttr_hours': 'Mean Time to Recovery (hours)',
  
  // IDE Metrics
  'ide.ai_suggestions_accepted': 'AI Suggestions Accepted',
  'ide.files_per_session': 'Files per Session',
  'ide.commits_per_session': 'Commits per Session',
  'ide.avg_session_length': 'Average Session Length',
  'ide.time_to_first_commit': 'Time to First Commit',
  'ide.ai_usage_duration': 'AI Usage Duration',
  'ide.idle_time': 'Idle Time',
  'ide.acceptance_rate': 'AI Acceptance Rate'
} as const

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Determines if a metric is a COUNT type
 */
export function isCount(metric: UnifiedMetricId): boolean {
  return metricKind(metric) === 'COUNT'
}

/**
 * Gets the kind (COUNT, DURATION, RATIO) for a given metric
 */
export function metricKind(metric: UnifiedMetricId): MetricKind {
  const kind = METRIC_KIND_MAP[metric]
  if (!kind) {
    throw new Error(`Unknown metric: ${metric}`)
  }
  return kind
}

/**
 * Gets a human-readable label for a metric
 */
export function formatLabel(metric: UnifiedMetricId): string {
  const label = METRIC_LABEL_MAP[metric]
  if (!label) {
    throw new Error(`Unknown metric: ${metric}`)
  }
  return label
}

/**
 * Checks if a metric is a GitHub metric
 */
export function isGitHubMetric(metric: UnifiedMetricId): metric is GitHubMetricId {
  return metric.startsWith('gh.')
}

/**
 * Checks if a metric is an IDE metric
 */
export function isIDEMetric(metric: UnifiedMetricId): metric is IDEMetricId {
  return metric.startsWith('ide.')
}

/**
 * Gets the source type for a metric
 */
export function getSourceType(metric: UnifiedMetricId): SourceType {
  return isGitHubMetric(metric) ? 'github' : 'simulator'
}

/**
 * Validates that all required fields are present for a given scope
 */
export function validateEventForScope(event: UnifiedEvent): boolean {
  switch (event.scope) {
    case 'org':
      return !!(event.orgId)
    case 'team':
      return !!(event.orgId && event.teamId)
    case 'dev':
      return !!(event.orgId && event.teamId && event.developerId)
    default:
      return false
  }
}

/**
 * Gets the appropriate tool ID for IDE metrics, returns undefined for GitHub metrics
 */
export function getToolId(metric: UnifiedMetricId): ToolId | undefined {
  if (isIDEMetric(metric)) {
    // For IDE metrics, we need to determine tool from context
    // This would typically come from the event or query context
    return undefined // Will be set by the calling code
  }
  return undefined
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a string is a valid UnifiedMetricId
 */
export function isValidMetricId(value: string): value is UnifiedMetricId {
  return value in METRIC_KIND_MAP
}

/**
 * Type guard to check if a string is a valid ToolId
 */
export function isValidToolId(value: string): value is ToolId {
  const validToolIds: ToolId[] = ['cursor', 'vscode', 'intellij', 'webstorm', 'windsurf', 'vim', 'neovim', 'jetbrains']
  return validToolIds.includes(value as ToolId)
}

/**
 * Type guard to check if a string is a valid Scope
 */
export function isValidScope(value: string): value is Scope {
  const validScopes: Scope[] = ['org', 'team', 'dev']
  return validScopes.includes(value as Scope)
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * All available GitHub metrics
 */
export const GITHUB_METRICS: readonly GitHubMetricId[] = [
  'gh.pr_opened',
  'gh.pr_merged',
  'gh.pr_reopened',
  'gh.pr_rejected',
  'gh.time_to_merge_hours',
  'gh.comment_to_merge_ratio',
  'gh.deployments',
  'gh.mttr_hours'
] as const

/**
 * All available IDE metrics
 */
export const IDE_METRICS: readonly IDEMetricId[] = [
  'ide.ai_suggestions_accepted',
  'ide.files_per_session',
  'ide.commits_per_session',
  'ide.avg_session_length',
  'ide.time_to_first_commit',
  'ide.ai_usage_duration',
  'ide.idle_time',
  'ide.acceptance_rate'
] as const

/**
 * All available unified metrics
 */
export const ALL_METRICS: readonly UnifiedMetricId[] = [
  ...GITHUB_METRICS,
  ...IDE_METRICS
] as const

/**
 * All available tool IDs
 */
export const ALL_TOOLS: readonly ToolId[] = [
  'cursor',
  'vscode',
  'intellij',
  'webstorm',
  'windsurf',
  'vim',
  'neovim',
  'jetbrains'
] as const

/**
 * All available scopes
 */
export const ALL_SCOPES: readonly Scope[] = [
  'org',
  'team',
  'dev'
] as const






