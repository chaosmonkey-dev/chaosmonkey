/**
 * Extract primary evidence (1-2 key numeric values) from insight for dense display
 */
import type { PerformanceInsight, InsightEvidence } from './types'

export function extractPrimaryEvidence(insight: PerformanceInsight): InsightEvidence[] {
  if (!insight.evidence || insight.evidence.length === 0) {
    return []
  }

  // Filter out tool context dumps - look for common tool context labels
  const toolContextKeywords = ['tool context', 'telemetry ides', 'coding minutes share', 'top ai/min']
  const filteredEvidence = insight.evidence.filter(ev => {
    const labelLower = (ev.label || '').toLowerCase()
    return !toolContextKeywords.some(keyword => labelLower.includes(keyword))
  })

  if (filteredEvidence.length === 0) {
    // Fallback to first evidence row even if it might be tool context
    return insight.evidence.slice(0, 1)
  }

  // Prefer numeric values - take first 1-2 that have numeric values
  const numericEvidence: InsightEvidence[] = []
  const textEvidence: InsightEvidence[] = []

  for (const ev of filteredEvidence) {
    if (ev.value !== undefined && ev.value !== null) {
      if (typeof ev.value === 'number' || (typeof ev.value === 'string' && !isNaN(Number(ev.value)))) {
        numericEvidence.push(ev)
      } else {
        textEvidence.push(ev)
      }
    }
  }

  // Return up to 2 numeric values, or fallback to first text value
  if (numericEvidence.length > 0) {
    return numericEvidence.slice(0, 2)
  }

  // Fallback to first evidence row (even if text)
  return filteredEvidence.slice(0, 1)
}
