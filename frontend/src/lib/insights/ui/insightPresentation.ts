/**
 * UI Presentation Classifier for Performance Insights
 * 
 * Classifies insights by scope and intent to enable prioritization and grouping.
 * This is purely for UI presentation - does not modify insight generation.
 */
import type { PerformanceInsight } from '../types'
import { getToolLabel } from '../labels'

export interface InsightPresentation {
  scope: 'ide' | 'org'
  intent: 'diagnostic' | 'directional' | 'status' | 'opportunity' | 'unknown'
  priorityScore: number
  isContext: boolean // true if this should be demoted to context group
}

const IDE_NAMES = ['cursor', 'windsurf', 'vscode', 'vs code', 'jetbrains', 'sublime', 'vim', 'neovim']

const DIRECTIONAL_KEYWORDS = [
  'no strong',
  'directional',
  'baseline',
  'aligns with org average',
  'stable',
  'healthy',
  'no change',
  'consistent',
  'typical',
  'expected range'
]

const DIAGNOSTIC_KEYWORDS = [
  'spike',
  'regression',
  'long tail',
  'volatile',
  'bottleneck',
  'risk',
  'anomaly',
  'outlier',
  'concern',
  'issue'
]

/**
 * Check if insight is IDE-specific
 */
function isIDEScope(insight: PerformanceInsight): boolean {
  const titleLower = (insight.title || '').toLowerCase()
  
  // Check if title starts with IDE name
  for (const ideName of IDE_NAMES) {
    if (titleLower.startsWith(ideName.toLowerCase() + ' ') || 
        titleLower.startsWith(ideName.toLowerCase() + ':') ||
        titleLower.startsWith(ideName.toLowerCase() + '-')) {
      return true
    }
  }
  
  // Check if insight has explicit tool identifiers
  if (insight.related?.tools && insight.related.tools.length > 0) {
    // If single tool and toolScope indicates IDE-specific
    if (insight.toolScope === 'single-ide') {
      return true
    }
    // If tools array has specific IDE identifiers (not just generic)
    const hasSpecificTool = insight.related.tools.some(tool => {
      const toolLower = tool.toLowerCase()
      return IDE_NAMES.some(ide => toolLower.includes(ide))
    })
    if (hasSpecificTool) {
      return true
    }
  }
  
  return false
}

/**
 * Classify insight intent based on content
 */
function classifyIntent(insight: PerformanceInsight): InsightPresentation['intent'] {
  const titleLower = (insight.title || '').toLowerCase()
  const descLower = (insight.description || '').toLowerCase()
  const combined = `${titleLower} ${descLower}`
  
  // Check for diagnostic signals
  if (insight.severity === 'critical' || insight.severity === 'warning' || insight.severity === 'risk') {
    return 'diagnostic'
  }
  
  // Check for diagnostic keywords
  for (const keyword of DIAGNOSTIC_KEYWORDS) {
    if (combined.includes(keyword)) {
      return 'diagnostic'
    }
  }
  
  // Check for directional/baseline signals
  for (const keyword of DIRECTIONAL_KEYWORDS) {
    if (combined.includes(keyword)) {
      return 'directional'
    }
  }
  
  // Check for opportunity/highlight signals
  if (insight.severity === 'highlight' || insight.severity === 'opportunity') {
    return 'opportunity'
  }
  
  // Default to status if severity is info or lowlight
  if (insight.severity === 'info' || insight.severity === 'lowlight') {
    return 'status'
  }
  
  return 'unknown'
}

/**
 * Calculate priority score for presentation ordering
 */
function calculatePriorityScore(scope: 'ide' | 'org', intent: InsightPresentation['intent']): number {
  if (scope === 'ide') {
    switch (intent) {
      case 'diagnostic': return 100
      case 'opportunity': return 85
      case 'status': return 80
      case 'directional': return 75
      default: return 70
    }
  } else {
    // org scope
    switch (intent) {
      case 'diagnostic': return 70
      case 'opportunity': return 55
      case 'status': return 50
      case 'directional': return 25
      default: return 40
    }
  }
}

/**
 * Classify a single insight for presentation
 */
export function classifyInsightPresentation(insight: PerformanceInsight): InsightPresentation {
  const scope = isIDEScope(insight) ? 'ide' : 'org'
  const intent = classifyIntent(insight)
  const priorityScore = calculatePriorityScore(scope, intent)
  
  // Context insights are org+directional (or very low score) that should be demoted
  const isContext = scope === 'org' && (intent === 'directional' || priorityScore <= 30)
  
  return {
    scope,
    intent,
    priorityScore,
    isContext
  }
}

/**
 * Group insights into primary and context groups for a stage
 * 
 * @param insights - Array of insights for a stage
 * @returns Object with primaryInsights (sorted) and contextInsights
 */
export function groupInsightsForPresentation(insights: PerformanceInsight[]): {
  primaryInsights: PerformanceInsight[]
  contextInsights: PerformanceInsight[]
} {
  if (!insights || insights.length === 0) {
    return { primaryInsights: [], contextInsights: [] }
  }
  
  // Classify all insights
  const classified = insights.map(insight => ({
    insight,
    presentation: classifyInsightPresentation(insight)
  }))
  
  // Separate into context and primary candidates
  const contextCandidates = classified.filter(c => c.presentation.isContext)
  const primaryCandidates = classified.filter(c => !c.presentation.isContext)
  
  // Only demote to context if:
  // 1. There are context candidates
  // 2. There are IDE insights OR diagnostic insights in primary
  const hasIDEInsights = primaryCandidates.some(c => c.presentation.scope === 'ide')
  const hasDiagnosticInsights = primaryCandidates.some(c => c.presentation.intent === 'diagnostic')
  
  // If stage has ONLY org-directional insights, don't demote (avoid empty primaries)
  const shouldDemoteContext = contextCandidates.length > 0 && 
                              (hasIDEInsights || hasDiagnosticInsights) &&
                              primaryCandidates.length > 0
  
  if (!shouldDemoteContext) {
    // Return all insights as primary, sorted by priority
    const sorted = classified.sort((a, b) => b.presentation.priorityScore - a.presentation.priorityScore)
    return {
      primaryInsights: sorted.map(c => c.insight),
      contextInsights: []
    }
  }
  
  // Sort primary by priority score (descending)
  const sortedPrimary = primaryCandidates.sort((a, b) => 
    b.presentation.priorityScore - a.presentation.priorityScore
  )
  
  // Sort context by priority score (descending) - still ordered, just demoted
  const sortedContext = contextCandidates.sort((a, b) => 
    b.presentation.priorityScore - a.presentation.priorityScore
  )
  
  return {
    primaryInsights: sortedPrimary.map(c => c.insight),
    contextInsights: sortedContext.map(c => c.insight)
  }
}

/**
 * Check if an insight should show "Context" tag
 */
export function shouldShowContextTag(insight: PerformanceInsight, allStageInsights: PerformanceInsight[]): boolean {
  const presentation = classifyInsightPresentation(insight)
  
  // Only show context tag if this insight is in the context group
  if (!presentation.isContext) {
    return false
  }
  
  // Check if context group exists (would be demoted)
  const { contextInsights } = groupInsightsForPresentation(allStageInsights)
  return contextInsights.some(ctx => ctx.id === insight.id)
}
