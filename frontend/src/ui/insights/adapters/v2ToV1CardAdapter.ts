/**
 * V2 to V1 Card Adapter
 * 
 * Maps V2 PerformanceInsight objects to the shape expected by V1 card components.
 * Preserves all V2 hardening/formatter logic while adapting to V1 card UI.
 */

import type { PerformanceInsight } from '../../../lib/insights/types'
import type { Insight } from '../../../types/insights'

// V1 card expected interface (based on InsightCardContent.vue usage)
export interface V1CardInsight {
  // Core V1 fields
  id: string
  title: string
  description: string
  severity: string
  evidence: { label: string; value: string | number }[]
  recommendations: any[]
  tags: string[]
  source: any
  
  // V1 card specific (with safe defaults)
  entityId?: string
  summary?: string
  level?: 'risk' | 'lowlight' | 'opportunity' | 'highlight'
  coverage?: number
  
  // V2 fields we're mapping from
  whatsHappening?: string
  whyItMatters?: string
  displayValue?: string
  displayDelta?: string
  confidenceLabel?: string
  metricId?: string
  cicdStage?: string
  related?: any
  toolScope?: string
  dataSource?: 'Real' | 'Simulated' | 'Mixed'
  priorityScore?: number
  critical?: boolean
  normalizedSeverity?: string
  equivalenceKey?: string
  alsoObservedIn?: string[]
  tools?: string[]
}

/**
 * Maps a V2 PerformanceInsight to V1 card shape.
 * 
 * Mapping rules:
 * - Core fields: id, title, description, severity, evidence, recommendations
 * - V2 expanded content: whatsHappening, whyItMatters
 * - V2 display fields: displayValue, displayDelta, confidenceLabel
 * - V1 compatibility: entityId, summary, level, coverage (with safe defaults)
 */
export function adaptV2InsightToV1Card(insight: PerformanceInsight): V1CardInsight {
  // LOG 3: v2ToV1CardAdapter entry for deployment-frequency-volatility-by-ide
  if (insight.id === 'deployment-frequency-volatility-by-ide') {
    console.log('[CHAIN_3_V2_ADAPTER_ENTRY]', {
      id: insight.id,
      title: insight.title,
      subtitle: insight.subtitle,
      description: insight.description,
      summary: insight.whatsHappening,
      whyItMatters: insight.whyItMatters
    });
  }

  // Map severity to V1 level if available, otherwise use severity
  const level = insight.normalizedSeverity || mapSeverityToLevel(insight.severity)
  
  // Build V1 card insight
  const v1Card: V1CardInsight = {
    // Core V1 fields
    id: insight.id,
    title: insight.title,
    description: insight.description,
    severity: insight.severity,
    evidence: insight.evidence.map(ev => ({
      label: ev.label,
      value: ev.value ?? '--' // Handle undefined values
    })),
    recommendations: insight.recommendations,
    tags: insight.tags,
    source: insight.source,
    
    // V1 card specific (with safe defaults)
    entityId: insight.related?.repos?.[0] || insight.id,
    summary: insight.whatsHappening || insight.description,
    level,
    coverage: 0, // V2 doesn't have coverage concept, default to 0
    
    // V2 expanded content
    whatsHappening: insight.whatsHappening,
    whyItMatters: insight.whyItMatters,
    
    // V2 display fields
    displayValue: insight.displayValue,
    displayDelta: insight.displayDelta,
    confidenceLabel: (insight as any).confidenceLabel,
    
    // V2 metadata
    metricId: insight.metricId,
    cicdStage: insight.cicdStage,
    related: insight.related,
    toolScope: insight.toolScope,
    dataSource: mapDataSourceToV1(insight.dataSource),
    priorityScore: insight.priorityScore,
    critical: insight.critical,
    normalizedSeverity: insight.normalizedSeverity,
    equivalenceKey: insight.equivalenceKey,
    alsoObservedIn: insight.alsoObservedIn,
    tools: insight.tools,
  }
  
  // LOG 3: v2ToV1CardAdapter exit for deployment-frequency-volatility-by-ide
  if (insight.id === 'deployment-frequency-volatility-by-ide') {
    console.log('[CHAIN_3_V2_ADAPTER_EXIT]', {
      id: insight.id,
      title: insight.title,
      subtitle: insight.subtitle,
      description: insight.description,
      summary: insight.whatsHappening,
      whyItMatters: insight.whyItMatters,
      finalCardTitle: v1Card.title,
      finalCardDescription: v1Card.description,
      finalCardSummary: v1Card.summary
    });
  }

  // SURGICAL PROOF: Log final object before UI render
  if (insight.id === 'change-failure-rate-spike-by-ide' || 
      insight.id === 'deployment-frequency-volatility-by-ide' ||
      insight.id === 'stale-deployment-signal' ||
      insight.id === 'failed-deployment-pressure') {
    console.log('[FINAL_RENDER_PROOF]', {
      insightId: insight.id,
      rawTitle: insight.title,
      rawSubtitle: insight.subtitle,
      rawDescription: insight.description,
      rawSummary: insight.whatsHappening,
      rawWhyItMatters: insight.whyItMatters,
      executiveSummary: insight.executiveSummary,
      finalCardTitle: v1Card.title,
      finalCardDescription: v1Card.description,
      finalCardSummary: v1Card.summary,
      displayValue: v1Card.displayValue,
      rightMetric: v1Card.rightMetric
    });
  }
  
  return v1Card
}

/**
 * Maps V2 severity to V1 level format
 */
function mapSeverityToLevel(severity: string): 'risk' | 'lowlight' | 'opportunity' | 'highlight' {
  const severityLower = severity.toLowerCase()
  
  if (severityLower === 'critical' || severityLower === 'warning') {
    return 'risk'
  } else if (severityLower === 'info' || severityLower === 'low') {
    return 'lowlight'
  } else if (severityLower === 'opportunity') {
    return 'opportunity'
  } else {
    return 'highlight' // default fallback
  }
}

/**
 * Maps V2 dataSource to V1 format
 */
function mapDataSourceToV1(dataSource?: 'real' | 'mixed' | 'sim' | 'unknown'): 'Real' | 'Simulated' | 'Mixed' | undefined {
  if (!dataSource) return undefined
  
  switch (dataSource) {
    case 'real': return 'Real'
    case 'sim': return 'Simulated'
    case 'mixed': return 'Mixed'
    case 'unknown': return undefined
    default: return undefined
  }
}

/**
 * Adapts an array of V2 insights to V1 card format
 */
export function adaptV2InsightsToV1Cards(insights: PerformanceInsight[]): V1CardInsight[] {
  return insights.map(adaptV2InsightToV1Card)
}
