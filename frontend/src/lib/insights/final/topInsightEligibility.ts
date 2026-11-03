/**
 * Pure production Top Insight eligibility filter.
 * Consumed by PerformanceRecommendationsView.vue and production tests.
 *
 * An insight is Top-eligible when:
 * 1. It has data (hasData === true)
 * 2. It is not diagnostic (isDiagnostic !== true)
 * 3. It is Top-eligible per adapter (isTopInsightEligible === true)
 * 4. Its title does not contain "not yet measurable", "needs more data", or "instrumentation"
 */

export interface TopInsightCandidate {
  id: string
  hasData?: boolean
  isDiagnostic?: boolean
  isTopInsightEligible?: boolean
  title?: string
  presentationType?: string
  recommendationAllowed?: boolean
}

const NOT_MEASURABLE_PATTERNS = [
  'not yet measurable',
  'needs more data',
  'instrumentation',
]

/**
 * Returns true if the insight passes all Top Insights rail eligibility checks.
 */
export function isTopInsight(insight: TopInsightCandidate): boolean {
  const hasData = insight.hasData === true
  const isDiagnostic = insight.isDiagnostic === true
  const isTopEligible = insight.isTopInsightEligible === true
  const title = (insight.title || '').toLowerCase()
  const isNotMeasurable = NOT_MEASURABLE_PATTERNS.some(p => title.includes(p))
  return hasData && !isDiagnostic && isTopEligible && !isNotMeasurable
}

/**
 * Filter an array of insights to only Top-eligible ones.
 */
export function filterTopInsights<T extends TopInsightCandidate>(insights: T[]): T[] {
  return insights.filter(isTopInsight)
}
