// src/ui/insights/insightQualityGate.ts
/**
 * Insight Quality Gate: Suppression and Deduplication
 * 
 * Removes low-value/redundant insights and prevents duplicates
 * without changing rule logic.
 */

import type { PerformanceInsight } from '@/lib/insights/types'

// TTFC Debug flag
const TTFC_DEBUG = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TTFC_DEBUG === 'true'

/**
 * Severity hierarchy for deduplication (higher = more important)
 */
const SEVERITY_RANK: Record<string, number> = {
  'critical': 7,
  'risk': 6,
  'warning': 5,
  'opportunity': 4,
  'highlight': 3,
  'info': 2,
  'lowlight': 1
}

/**
 * Suppress low-value insights based on title and action patterns
 * 
 * @param insights - Array of insights to filter
 * @returns Filtered array with low-value insights removed
 */
export function filterLowValueInsights(insights: PerformanceInsight[]): PerformanceInsight[] {
  // TTFC_DEBUG: Track TTFC insight through filter
  const ttfcBefore = insights.filter(i => i.metricId === 'org.time_to_first_commit')
  if (TTFC_DEBUG && ttfcBefore.length > 0) {
    console.warn('[TTFC_DEBUG][QualityGate] filterLowValueInsights ENTER', {
      totalInsights: insights.length,
      ttfcInsightsCount: ttfcBefore.length,
      ttfcInsights: ttfcBefore.map(i => ({ id: i.id, title: i.title }))
    })
  }
  
  const filtered = insights.filter(insight => {
    const title = (insight.title || '').toLowerCase()
    const action = (insight.recommendations?.[0]?.text || '').toLowerCase()
    
    // Suppress "distinct work pattern" insights
    if (title.includes('distinct work pattern')) {
      if (TTFC_DEBUG && insight.metricId === 'org.time_to_first_commit') {
        console.warn('[TTFC_DEBUG][QualityGate] TTFC insight FILTERED: distinct work pattern', { title: insight.title })
      }
      return false
    }
    
    // Suppress generic actions
    if (action.includes('use ide for its observed strengths') || 
        action.includes('keep comparisons clean')) {
      if (TTFC_DEBUG && insight.metricId === 'org.time_to_first_commit') {
        console.warn('[TTFC_DEBUG][QualityGate] TTFC insight FILTERED: generic action', { title: insight.title, action })
      }
      return false
    }
    
    return true
  })
  
  // TTFC_DEBUG: Track TTFC insight after filter
  const ttfcAfter = filtered.filter(i => i.metricId === 'org.time_to_first_commit')
  if (TTFC_DEBUG && ttfcBefore.length > 0) {
    console.warn('[TTFC_DEBUG][QualityGate] filterLowValueInsights EXIT', {
      totalBefore: insights.length,
      totalAfter: filtered.length,
      ttfcBefore: ttfcBefore.length,
      ttfcAfter: ttfcAfter.length,
      ttfcFiltered: ttfcBefore.length - ttfcAfter.length > 0 ? 'YES' : 'NO'
    })
  }
  
  return filtered
}

/**
 * Normalize title for deduplication key
 */
function normalizeTitle(title: string): string {
  return (title || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Build stable deduplication key from insight
 */
function buildDedupKey(insight: PerformanceInsight): string {
  const parts: string[] = []
  
  // ⚠️ CRITICAL: Include cicdStage to prevent cross-stage deduplication!
  const stage = insight.cicdStage || 'other'
  parts.push(stage)
  
  // toolScope (org/team/dev/single-ide/cross-ide)
  const toolScope = insight.toolScope || 'unknown'
  parts.push(toolScope)
  
  // toolId (first tool from related.tools or tools array)
  const toolId = insight.related?.tools?.[0] || insight.tools?.[0] || 'unknown'
  parts.push(toolId)
  
  // metricKey
  const metricKey = insight.metricId || 'unknown'
  parts.push(metricKey)
  
  // normalized title
  const normalizedTitle = normalizeTitle(insight.title || '')
  parts.push(normalizedTitle)
  
  return parts.join('|')
}

/**
 * Get severity rank for comparison
 */
function getSeverityRank(insight: PerformanceInsight): number {
  const severity = insight.normalizedSeverity || insight.severity || 'info'
  return SEVERITY_RANK[severity] || SEVERITY_RANK['info']
}

/**
 * Get confidence value from evidence (if present)
 */
function getConfidence(insight: PerformanceInsight): number {
  const confidenceEvidence = insight.evidence?.find(e => 
    e.label?.toLowerCase().includes('confidence')
  )
  if (!confidenceEvidence) return 0
  
  const value = String(confidenceEvidence.value || '').toLowerCase()
  if (value.includes('strong')) return 2
  if (value.includes('directional')) return 1
  return 0
}

/**
 * Get absolute impact score (priorityScore or derived from evidence)
 */
function getAbsoluteImpact(insight: PerformanceInsight): number {
  // Use priorityScore if available
  if (typeof insight.priorityScore === 'number') {
    return Math.abs(insight.priorityScore)
  }
  
  // Try to extract from evidence (look for impact-related values)
  // This is a fallback - most insights should have priorityScore
  const impactEvidence = insight.evidence?.find(e => 
    e.label?.toLowerCase().includes('impact') ||
    e.label?.toLowerCase().includes('delta')
  )
  if (impactEvidence && typeof impactEvidence.value === 'number') {
    return Math.abs(impactEvidence.value)
  }
  
  return 0
}

/**
 * Compare two insights to determine which is "better" (keep this one)
 * Returns: -1 if a is better, 1 if b is better, 0 if equal
 */
function compareInsights(a: PerformanceInsight, b: PerformanceInsight): number {
  // 1. Higher severity wins
  const severityA = getSeverityRank(a)
  const severityB = getSeverityRank(b)
  if (severityA !== severityB) {
    return severityB - severityA // Higher rank is better
  }
  
  // 2. Higher confidence wins (if present)
  const confidenceA = getConfidence(a)
  const confidenceB = getConfidence(b)
  if (confidenceA !== confidenceB) {
    return confidenceB - confidenceA
  }
  
  // 3. Larger absolute impact wins
  const impactA = getAbsoluteImpact(a)
  const impactB = getAbsoluteImpact(b)
  if (impactA !== impactB) {
    return impactB - impactA
  }
  
  // 4. If all equal, prefer the one with more evidence
  const evidenceA = a.evidence?.length || 0
  const evidenceB = b.evidence?.length || 0
  if (evidenceA !== evidenceB) {
    return evidenceB - evidenceA
  }
  
  // 5. If still equal, keep first one (stable sort)
  return 0
}

/**
 * Deduplicate insights by stable key, keeping the best one
 * 
 * @param insights - Array of insights to deduplicate
 * @returns Deduplicated array with best insights kept
 */
export function dedupeInsights(insights: PerformanceInsight[]): PerformanceInsight[] {
  // TTFC_DEBUG: Track TTFC insight through dedupe
  const ttfcBefore = insights.filter(i => i.metricId === 'org.time_to_first_commit')
  if (TTFC_DEBUG && ttfcBefore.length > 0) {
    console.warn('[TTFC_DEBUG][QualityGate] dedupeInsights ENTER', {
      totalInsights: insights.length,
      ttfcInsightsCount: ttfcBefore.length,
      ttfcDedupKeys: ttfcBefore.map(i => buildDedupKey(i))
    })
  }
  
  // Check if standalone CFR card is present by ID first, fallback to title pattern
  // Standalone CFR: includes "change failure rate" AND "target" AND NOT "with"
  const hasStandaloneCFRCard = insights.some(i => {
    const id = (i.id || '').toLowerCase()
    const title = (i.title || '').toLowerCase()
    return id.includes('change-failure-rate') || 
           id.includes('change-failure-rate-spike') ||
           (title.includes('change failure rate') && 
            title.includes('target') && 
            !title.includes('with'))
  })
  
  const keyMap = new Map<string, PerformanceInsight[]>()
  
  // Group insights by deduplication key
  for (const insight of insights) {
    const key = buildDedupKey(insight)
    if (!keyMap.has(key)) {
      keyMap.set(key, [])
    }
    keyMap.get(key)!.push(insight)
  }
  
  // For each key, keep the best insight
  const result: PerformanceInsight[] = []
  for (const [key, group] of keyMap.entries()) {
    if (group.length === 1) {
      // No duplicates, keep it
      result.push(group[0])
    } else {
      // Multiple insights with same key - keep the best one
      // Sort by comparison function and take the first
      const sorted = [...group].sort(compareInsights)
      result.push(sorted[0])
      
      // TTFC_DEBUG: Log if TTFC insight was deduplicated
      if (TTFC_DEBUG && group.some(i => i.metricId === 'org.time_to_first_commit')) {
        console.warn('[TTFC_DEBUG][QualityGate] TTFC insight DEDUPED', {
          key,
          groupSize: group.length,
          kept: sorted[0].id,
          dropped: sorted.slice(1).map(i => i.id)
        })
      }
    }
  }
  
  // CR5 P0-9: DISABLED legacy CFR nuclear filter.
  // The final engine's validation/lifecycle system is the authority for what
  // renders. The widget must not silently remove canonical output based on
  // title-keyword inference. This was causing the 24→22 unexplained drop.
  // if (hasStandaloneCFRCard) { ... } — REMOVED
  
  // TTFC_DEBUG: Track TTFC insight after dedupe
  const ttfcAfter = result.filter(i => i.metricId === 'org.time_to_first_commit')
  if (TTFC_DEBUG && ttfcBefore.length > 0) {
    console.warn('[TTFC_DEBUG][QualityGate] dedupeInsights EXIT', {
      totalBefore: insights.length,
      totalAfter: result.length,
      ttfcBefore: ttfcBefore.length,
      ttfcAfter: ttfcAfter.length
    })
  }
  
  return result
}

/**
 * Apply both quality gate filters (suppression + deduplication)
 * 
 * @param insights - Array of insights to process
 * @returns Filtered and deduplicated insights
 */
export function applyQualityGate(insights: PerformanceInsight[]): PerformanceInsight[] {
  const afterSuppression = filterLowValueInsights(insights)
  const afterDedup = dedupeInsights(afterSuppression)
  return afterDedup
}
