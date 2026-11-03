/**
 * Payload Sanitizer for Performance Insights
 * 
 * Prevents badState payloads by ensuring all displayed insights have safe fallback fields.
 * No undefined, NaN, Infinity, or hasBadState: true logs by default.
 */

import type { CanonicalInsight } from '../types';

/**
 * Sanitize a numeric value to prevent badState
 */
export function sanitizeNumber(value: any, fallback: number = 0): number {
  if (typeof value === 'number' && isFinite(value)) {
    return value;
  }
  return fallback;
}

/**
 * Sanitize a string value to prevent badState
 */
export function sanitizeString(value: any, fallback: string = ''): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

/**
 * Sanitize a percentage value (0-100)
 */
export function sanitizePercentage(value: any): number {
  const sanitized = sanitizeNumber(value, 0);
  return Math.max(0, Math.min(100, sanitized));
}

/**
 * Create safe fallback values for insight fields
 */
export function createSafeFallbacks(id: string): Partial<CanonicalInsight> {
  return {
    id: sanitizeString(id, 'unknown-insight'),
    title: sanitizeString(`Insight ${id}`, 'Performance Insight'),
    description: 'Data temporarily unavailable',
    recommendation: 'Monitor for data availability',
    current: 0,
    baseline: 0,
    delta: 0,
    deltaPct: 0,
    rightMetric: '—',
    rightMetricLabel: 'Metric',
    confidence: 'low',
    coveragePct: 0,
    n: 0,
    hasData: false,
    presentationType: 'evidence_only',
    presentationKind: 'diagnostic',
    comparisonMode: 'absolute'
  };
}

/**
 * Sanitize a canonical insight to prevent badState payloads
 */
export function sanitizeInsight(insight: CanonicalInsight): CanonicalInsight {
  const fallbacks = createSafeFallbacks(insight.id);
  
  return {
    ...insight,
    // Core fields with safe fallbacks
    title: sanitizeString(insight.title, fallbacks.title),
    description: sanitizeString(insight.description, fallbacks.description),
    recommendation: sanitizeString(insight.recommendation, fallbacks.recommendation),
    
    // Numeric fields with safe fallbacks
    current: sanitizeNumber(insight.current, 0),
    baseline: sanitizeNumber(insight.baseline, 0),
    delta: sanitizeNumber(insight.delta, 0),
    // PILOT OPS 14-D: deltaPct is a relative-change value ((recent-prior)/prior*100),
    // NOT a 0-100 proportion. It can exceed 100% (e.g. 3x = 200%) and can be
    // negative (a decrease). Capping it at 100 produced the "100% gap" lie next
    // to a truthful ratio. Use sanitizeNumber (no clamp) instead of
    // sanitizePercentage. coveragePct remains a true 0-100 proportion.
    deltaPct: sanitizeNumber(insight.deltaPct, 0),
    coveragePct: sanitizePercentage(insight.coveragePct),
    n: Math.max(0, sanitizeNumber(insight.n, 0)),
    
    // Metric fields
    rightMetric: sanitizeString(insight.rightMetric, '—'),
    rightMetricLabel: sanitizeString(insight.rightMetricLabel, 'Metric'),
    
    // Confidence and data quality
    confidence: ['high', 'medium', 'low'].includes(insight.confidence) ? insight.confidence : 'low',
    hasData: Boolean(insight.hasData && insight.n > 0),
    
    // Ensure required fields exist
    cicdStage: insight.cicdStage || 'plan-code',
    canonicalPriority: sanitizeNumber(insight.canonicalPriority, 999),
    renderOrder: sanitizeNumber(insight.renderOrder, 999),
    presentationType: insight.presentationType || 'evidence_only',
    // CR5 P0.8: Carry presentationKind through sanitizer
    presentationKind: (insight as any).presentationKind,
    comparisonMode: insight.comparisonMode || 'absolute'
  };
}

/**
 * Batch sanitize multiple insights
 */
export function sanitizeInsights(insights: CanonicalInsight[]): CanonicalInsight[] {
  return insights.map(sanitizeInsight);
}
