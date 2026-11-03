/**
 * GitHub Metric Drilldown Feature Guard
 * 
 * Controls all GitHub metric card drilldown functionality.
 * Set to false to completely disable drilldown features.
 */

export const GITHUB_DRILLDOWN_ENABLED = import.meta.env.VITE_FEATURE_GITHUB_DRILLDOWN === '1'

/**
 * Supported GitHub metric keys for drilldown
 * These must match the backend endpoint's supported metrics
 */
export const SUPPORTED_GITHUB_METRICS = [
  'total_prs',
  'total_commits', 
  'merge_rate',
  'total_repositories',
  'review_count',
  'unique_reviewers',
  'pr_reopens',
  'pr_reopened_count',
  'rejected_prs',
  'latest_deployment',
  'failed_deployments',
  'success_deployments',
  'deployment_status',
  'deployment_environment',
  'rollback_detected',
  'commits_per_day',
  'first_review_at',
  'first_review',
  'time_to_merge',
  'deployment_date',
  'pr_review_cycles'
] as const

/**
 * Check if a metric key is supported for drilldown
 */
export function isSupportedGitHubMetric(metric: string): metric is typeof SUPPORTED_GITHUB_METRICS[number] {
  return SUPPORTED_GITHUB_METRICS.includes(metric as any)
}

/**
 * GitHub metric keys that currently have real data available
 */
export const IMPLEMENTED_METRICS = [
  'total_prs',
  'pr_reopens', 
  'rejected_prs',
  'failed_deployments'
] as const

/**
 * Check if a metric has been implemented with real data
 */
export function isImplementedMetric(metric: string): metric is typeof IMPLEMENTED_METRICS[number] {
  return IMPLEMENTED_METRICS.includes(metric as any)
}
