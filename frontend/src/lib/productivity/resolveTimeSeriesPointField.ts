/**
 * Single source of truth for mapping PBT metric IDs to unified-record point field names.
 *
 * The unified record contract uses these exact field names (case-sensitive):
 *   AI_suggestions_accepted   (uppercase A and I)
 *   AI_usage_duration_minutes (uppercase A and I)
 *   files_edited_per_session  (all lowercase)
 *   commits_per_session       (all lowercase)
 *   ... etc.
 *
 * Any new consumer of time-series point data must use this resolver instead of
 * duplicating the mapping locally.
 */

const METRIC_ID_TO_POINT_FIELD: Record<string, string> = {
  'ide.ai_suggestions_accepted': 'AI_suggestions_accepted',
  'ide.AI_suggestions_accepted': 'AI_suggestions_accepted',

  'ide.files_edited_per_session': 'files_edited_per_session',
  'ide.commits_per_session': 'commits_per_session',
  'ide.average_session_length_minutes': 'average_session_length_minutes',
  'ide.time_to_first_commit_minutes': 'time_to_first_commit_minutes',

  'ide.ai_usage_duration_minutes': 'AI_usage_duration_minutes',
  'ide.AI_usage_duration_minutes': 'AI_usage_duration_minutes',

  'ide.idle_time_minutes': 'idle_time_minutes',
  'ide.active_coding_time_minutes': 'active_coding_time_minutes',
  'ide.active_coding_ratio': 'active_coding_ratio',
  'ide.ai_usage_ratio': 'ai_usage_ratio',
  'ide.idle_ratio': 'idle_ratio',

  // CR-X Slice 1: Delivery metrics (from /api/delivery/timeseries)
  'delivery.merged_pr_count': 'merged_pr_count',
  'delivery.deployment_count': 'deployment_count',
  'delivery.deploy_success_rate': 'deploy_success_rate',
  'delivery.median_merge_cycle_hours': 'median_merge_cycle_hours',
  'delivery.release_count': 'release_count',
  'delivery.review_count': 'review_count',
  'delivery.pr_review_cycles': 'pr_review_cycles',
  'delivery.merge_rate': 'merge_rate',
}

/**
 * Resolve a metric ID (with or without the `ide.` prefix, any casing of
 * `AI_suggestions_accepted` / `AI_usage_duration_minutes`) to the exact
 * field name used in unified-record point objects.
 *
 * Normalization: if the exact input is not found and it does not begin with
 * `ide.`, the function retries with `ide.${input}`. This lets callers pass
 * either `commits_per_session` or `ide.commits_per_session` and get the same
 * result without manually duplicating every bare mapping.
 *
 * Returns `null` for unknown metrics — callers must handle this explicitly
 * and must not silently fall back to AI activity.
 */
export function resolveTimeSeriesPointField(metricId: string): string | null {
  if (!metricId) return null
  const exact = METRIC_ID_TO_POINT_FIELD[metricId]
  if (exact) return exact
  // Try ide. prefix for telemetry metrics
  if (!metricId.startsWith('ide.')) {
    const prefixed = METRIC_ID_TO_POINT_FIELD[`ide.${metricId}`]
    if (prefixed) return prefixed
  }
  // Try delivery. prefix for delivery metrics
  if (!metricId.startsWith('delivery.')) {
    const deliveryPrefixed = METRIC_ID_TO_POINT_FIELD[`delivery.${metricId}`]
    if (deliveryPrefixed) return deliveryPrefixed
  }
  return null
}
