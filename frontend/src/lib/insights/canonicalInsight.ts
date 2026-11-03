/**
 * Canonical Insight Type for "One Pipeline" Performance Insights Rendering
 * 
 * This file defines the unified type that eliminates V1/V2 rendering complexity
 * by providing a single canonical format for all insights.
 */

export type CicdStage = 'plan_code' | 'review_merge' | 'deploy_operate' | 'unknown'

export type CanonicalInsight = {
  id: string                 // stable unique id for render key
  metricId?: string          // optional
  title: string
  subtitle?: string
  cicdStage: CicdStage
  scope?: 'org' | 'ide' | 'repo' | 'unknown'
  status?: 'live' | 'hybrid' | 'incomplete' | 'info' | 'warning'
  valueText?: string         // already formatted for UI
  // keep raw payload for expanded view + evidence
  raw: any
}

/**
 * Normalize stage string to canonical CicdStage enum
 */
export function normalizeStage(rawStage: any): CicdStage {
  if (!rawStage) return 'unknown'
  
  const normalized = String(rawStage).toLowerCase().trim()
  
  // Handle various stage string formats
  if (normalized.includes('plan') || normalized.includes('code')) return 'plan_code'
  if (normalized.includes('review') || normalized.includes('merge')) return 'review_merge'
  if (normalized.includes('deploy') || normalized.includes('operate')) return 'deploy_operate'
  
  return 'unknown'
}

/**
 * Stage override map for canonical IDs when incoming stage is missing/invalid
 */
const STAGE_BY_CANONICAL_ID: Record<string, CicdStage> = {
  'time-to-first-commit-by-ide': 'plan_code',
  'commits-per-session-by-ide': 'plan_code',
  'active-coding-time-by-ide': 'plan_code',
  'ai-suggestions-accepted-by-ide': 'plan_code',
  'average-session-length-by-ide': 'plan_code',
  'v2-first-review-latency': 'review_merge',
  'pr-review-cycles-by-ide': 'review_merge',
  'pr-cycle-time-by-ide': 'review_merge',
  'review-merge-git-context': 'review_merge',
  'change-failure-rate-trend-org': 'deploy_operate',
  'v2-release-risk-index': 'deploy_operate',
  'reliability-lag-risk-org': 'deploy_operate',
}

/**
 * Get canonical stage for an insight, with fallback to ID-based mapping
 */
export function getCanonicalStage(insight: any): CicdStage {
  const canonicalId = insight.id?.split('::')[0] || insight.metricId
  
  // First try normalizeStage on incoming stage
  const normalizedStage = normalizeStage(insight.cicdStage)
  if (normalizedStage !== 'unknown') {
    return normalizedStage
  }
  
  // Fallback to ID-based mapping
  if (canonicalId && STAGE_BY_CANONICAL_ID[canonicalId]) {
    return STAGE_BY_CANONICAL_ID[canonicalId]
  }
  
  return 'unknown'
}

/**
 * Generate stable key from insight for deduplication
 */
export function stableKeyFromInsight(raw: any): string {
  if (!raw) return 'unknown-missing'
  
  // Prefer explicit id
  if (raw.id && typeof raw.id === 'string') return raw.id
  
  // Fallback to metricId + title combination
  const metricId = raw.metricId ? String(raw.metricId) : ''
  const title = raw.title ? String(raw.title).slice(0, 50) : ''
  
  if (metricId && title) return `${metricId}|${title}`
  if (title) return `title|${title}`
  if (metricId) return `metric|${metricId}`
  
  return `generated-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Convert legacy PerformanceInsight to CanonicalInsight
 */
export function toCanonicalFromLegacy(pi: any): CanonicalInsight {
  if (!pi) {
    return {
      id: `legacy-empty-${Date.now()}`,
      title: 'Empty Legacy Insight',
      cicdStage: 'unknown',
      raw: pi
    }
  }

  return {
    id: stableKeyFromInsight(pi),
    metricId: pi.metricId,
    title: pi.title || 'Untitled Legacy Insight',
    subtitle: pi.subtitle || pi.whatHappened,
    cicdStage: getCanonicalStage(pi),
    scope: pi.scope || 'unknown',
    status: pi.status || 'live',
    valueText: pi.valueText || pi.displayValue,
    raw: pi
  }
}

/**
 * Convert V2 preview row to CanonicalInsight
 */
export function toCanonicalFromPreviewRow(row: any): CanonicalInsight {
  if (!row) {
    return {
      id: `v2-empty-${Date.now()}`,
      title: 'Empty V2 Preview',
      cicdStage: 'unknown',
      raw: row
    }
  }

  return {
    id: stableKeyFromInsight(row),
    metricId: row.metricId,
    title: row.title || 'Untitled V2 Preview',
    subtitle: row.subtitle || row.details,
    cicdStage: getCanonicalStage(row),
    scope: row.scope || 'unknown',
    status: row.status || 'live',
    valueText: row.rightMetric || row.valueText,
    raw: row
  }
}

/**
 * Phase 4: Compatibility adapters - Convert CanonicalInsight back to legacy formats
 * These functions ensure existing components continue to work without modification
 */

/**
 * Convert CanonicalInsight back to PerformanceInsight format (for V1 components)
 */
export function fromCanonicalToLegacy(ci: CanonicalInsight): any {
  if (!ci) return null
  
  // If the raw payload is already a PerformanceInsight, return it
  if (ci.raw && typeof ci.raw === 'object' && ci.raw.title && ci.raw.cicdStage) {
    return ci.raw
  }
  
  // Otherwise, construct a PerformanceInsight-like object
  return {
    id: ci.id,
    metricId: ci.metricId,
    title: ci.title,
    subtitle: ci.subtitle,
    whatHappened: ci.subtitle,
    cicdStage: ci.cicdStage.replace('_', '-'), // Convert back to legacy format
    scope: ci.scope,
    status: ci.status,
    valueText: ci.valueText,
    displayValue: ci.valueText,
    priorityScore: 0, // Default value
    impactScore: 0, // Default value
    // Preserve critical fields for render/ranking logic
    polarity: ci.polarity,
    intendedStageQuotaBucket: (ci as any).intendedStageQuotaBucket,
    // Preserve any additional fields from raw
    ...(ci.raw || {})
  }
}

/**
 * Convert CanonicalInsight back to PreviewRow format (for V2 components)
 */
export function fromCanonicalToPreviewRow(ci: CanonicalInsight): any {
  if (!ci) return null
  
  // If the raw payload is already a PreviewRow, return it
  if (ci.raw && typeof ci.raw === 'object' && ci.raw.title && (ci.raw.rightMetric || ci.raw.details)) {
    return ci.raw
  }
  
  // Otherwise, construct a PreviewRow-like object
  return {
    id: ci.id,
    title: ci.title,
    subtitle: ci.subtitle,
    rightMetric: ci.valueText,
    details: ci.subtitle,
    badges: ['CANONICAL'],
    // Preserve critical fields for render/ranking logic
    polarity: ci.polarity,
    intendedStageQuotaBucket: (ci as any).intendedStageQuotaBucket,
    // Preserve any additional fields from raw
    ...(ci.raw || {})
  }
}

/**
 * Universal adapter - automatically detects target format and converts appropriately
 */
export function adaptCanonicalForComponent(ci: CanonicalInsight, componentType: 'legacy' | 'preview' = 'legacy'): any {
  if (componentType === 'preview') {
    return fromCanonicalToPreviewRow(ci)
  }
  return fromCanonicalToLegacy(ci)
}

/**
 * Helper utilities for hide rules matching
 */
export const norm = (s: any) => String(s ?? '').toLowerCase().trim()

export const matchSurface = (c: CanonicalInsight) =>
  `${norm(c.id)} | ${norm(c.metricId)} | ${norm(c.title)} | ${norm(c.cicdStage)}`
