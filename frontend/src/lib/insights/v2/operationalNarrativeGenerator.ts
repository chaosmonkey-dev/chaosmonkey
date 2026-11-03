/**
 * Operational Narrative Generator
 * 
 * Transforms metric-style tool breakdowns into Executive Findings-style
 * operational evidence narratives with directional interpretation, supporting
 * operational context, comparative language, and evidence density.
 * 
 * Example transformation:
 *   BEFORE: "Cursor: 145 min/session"
 *   AFTER:  "Cursor maintained the highest sustained coding focus with 145 active
 *            minutes/session and lower workflow fragmentation than peer IDEs."
 */

import { getToolLabel } from '../labels'
import { formatPIValue, inferMetricUnit } from './piValueFormatter'

export interface ToolBreakdownNarrative {
  tool: string
  value: string | number
  narrative: string
  impact: 'high' | 'medium' | 'low'
  comparison?: string
  operationalContext?: string
}

export interface OperationalNarrativeConfig {
  metricId: string
  higherIsBetter: boolean
  unit?: string
  contextType?: 'coding' | 'ai' | 'delivery' | 'quality' | 'velocity'
  workflowMode?: 'workflows' | 'ides' | 'models'
  trendDirection?: 'improving' | 'declining' | 'stable'
}

/**
 * Generate operational narrative for tool breakdowns
 * Transforms metric boxes into evidence-rich operational findings
 */
export function generateToolBreakdownNarratives(
  breakdownByTool: Record<string, number | string> | undefined,
  config: OperationalNarrativeConfig
): ToolBreakdownNarrative[] {
  if (!breakdownByTool || typeof breakdownByTool !== 'object') {
    return []
  }

  const entries = Object.entries(breakdownByTool).filter(([key]) => key !== 'org')
  if (entries.length === 0) {
    return []
  }

  // Convert to numeric for sorting and comparison
  const numericEntries = entries.map(([tool, value]) => {
    const numValue = typeof value === 'string'
      ? parseFloat(value.replace(/[^0-9.-]/g, '')) || 0
      : (typeof value === 'number' ? value : 0)
    return { tool, value, numValue }
  })

  // Sort based on config
  numericEntries.sort((a, b) => {
    return config.higherIsBetter ? b.numValue - a.numValue : a.numValue - b.numValue
  })

  const top = numericEntries[0]
  const bottom = numericEntries[numericEntries.length - 1]
  const avg = numericEntries.reduce((sum, e) => sum + e.numValue, 0) / numericEntries.length

  return numericEntries.map((entry, index) => {
    const toolLabel = getToolLabel(entry.tool)
    const isTop = index === 0
    const isBottom = index === numericEntries.length - 1
    const gapFromTop = isTop ? 0 : ((top.numValue - entry.numValue) / top.numValue) * 100
    const gapFromAvg = ((entry.numValue - avg) / avg) * 100

    // Infer unit from metric ID and format value
    const unit = inferMetricUnit(config.metricId, '')
    const formattedValue = formatPIValue(entry.numValue, unit)

    return {
      tool: entry.tool,
      value: formattedValue,
      narrative: buildOperationalNarrative(entry, {
        toolLabel,
        isTop,
        isBottom,
        gapFromTop,
        gapFromAvg,
        topTool: getToolLabel(top.tool),
        bottomTool: getToolLabel(bottom.tool),
        config,
        formattedValue
      }),
      impact: determineImpactLevel(entry, isTop, isBottom, gapFromTop, config),
      comparison: buildComparison(entry, { isTop, gapFromTop, gapFromAvg, config }),
      operationalContext: buildOperationalContext(entry, { config, isTop, isBottom })
    }
  })
}

/**
 * Build operational narrative for a single tool
 * Uses Executive Findings-style language: directional, operational, contextual
 * Removes hedged/sanitized language, adds operational clarity
 */
function buildOperationalNarrative(
  _entry: { tool: string; value: string | number; numValue: number },
  context: {
    toolLabel: string
    isTop: boolean
    isBottom: boolean
    gapFromTop: number
    gapFromAvg: number
    topTool: string
    bottomTool: string
    config: OperationalNarrativeConfig
    formattedValue: string
  }
): string {
  const { toolLabel, isTop, isBottom, gapFromTop, gapFromAvg, topTool, bottomTool, config, formattedValue } = context
  const valueStr = formattedValue
  const { workflowMode, trendDirection } = config

  // Workflow-aware prefixes for operational specificity
  const workflowPrefix = workflowMode === 'workflows' ? 'This workflow ' : workflowMode === 'models' ? 'This model ' : ''
  const trendPrefix = trendDirection === 'improving' ? 'with improving trajectory' : trendDirection === 'declining' ? 'with declining trajectory' : ''

  // Context-specific narrative templates - direct, operational, no hedging
  if (isTop) {
    // Top performer - dominance narrative (direct language)
    if (config.contextType === 'coding') {
      return `${workflowPrefix}${toolLabel} dominates coding focus with ${valueStr} and minimal workflow fragmentation${trendPrefix ? ', ' + trendPrefix : ''}.`
    } else if (config.contextType === 'ai') {
      return `${workflowPrefix}${toolLabel} leads AI utilization at ${valueStr}, driving the most effective AI-assisted workflows${trendPrefix ? ', ' + trendPrefix : ''}.`
    } else if (config.contextType === 'delivery') {
      return `${workflowPrefix}${toolLabel} delivers fastest commit-to-deploy cadence at ${valueStr}${trendPrefix ? ', ' + trendPrefix : ''}.`
    } else if (config.contextType === 'quality') {
      return `${workflowPrefix}${toolLabel} achieves highest quality output at ${valueStr} through disciplined review practices${trendPrefix ? ', ' + trendPrefix : ''}.`
    } else if (config.contextType === 'velocity') {
      return `${workflowPrefix}${toolLabel} maintains fastest development velocity at ${valueStr}${trendPrefix ? ', ' + trendPrefix : ''}.`
    }
    return `${workflowPrefix}${toolLabel} leads with ${valueStr}, outperforming ${bottomTool} by ${Math.abs(gapFromTop).toFixed(0)}%${trendPrefix ? ', ' + trendPrefix : ''}.`
  }

  if (isBottom) {
    // Bottom performer - direct operational problem statement (no hedging)
    if (config.contextType === 'coding') {
      return `${workflowPrefix}${toolLabel} shows lowest coding intensity at ${valueStr} due to workflow drag or environmental friction${trendPrefix ? ', ' + trendPrefix : ''}.`
    } else if (config.contextType === 'ai') {
      return `${workflowPrefix}${toolLabel} underutilizes AI assistance at ${valueStr}, missing AI acceleration opportunities${trendPrefix ? ', ' + trendPrefix : ''}.`
    } else if (config.contextType === 'delivery') {
      return `${workflowPrefix}${toolLabel} bottlenecks delivery at ${valueStr}, slowing commit-to-deploy cadence${trendPrefix ? ', ' + trendPrefix : ''}.`
    } else if (config.contextType === 'quality') {
      return `${workflowPrefix}${toolLabel} incurs quality pressure at ${valueStr}, requiring stronger review discipline${trendPrefix ? ', ' + trendPrefix : ''}.`
    } else if (config.contextType === 'velocity') {
      return `${workflowPrefix}${toolLabel} slows development velocity at ${valueStr}, creating workflow inefficiencies${trendPrefix ? ', ' + trendPrefix : ''}.`
    }
    return `${workflowPrefix}${toolLabel} trails at ${valueStr}, ${Math.abs(gapFromTop).toFixed(0)}% behind ${topTool}${trendPrefix ? ', ' + trendPrefix : ''}.`
  }

  // Middle performers - comparative narrative (direct comparison)
  if (gapFromAvg > 10) {
    return `${workflowPrefix}${toolLabel} exceeds organizational mean at ${valueStr} (+${Math.abs(gapFromAvg).toFixed(0)}%)${trendPrefix ? ', ' + trendPrefix : ''}.`
  } else if (gapFromAvg < -10) {
    return `${workflowPrefix}${toolLabel} falls below organizational mean at ${valueStr} (${Math.abs(gapFromAvg).toFixed(0)}% below)${trendPrefix ? ', ' + trendPrefix : ''}.`
  }

  return `${workflowPrefix}${toolLabel} maintains baseline at ${valueStr}${trendPrefix ? ', ' + trendPrefix : ''}.`
}

/**
 * Build comparison string for tool breakdowns
 */
function buildComparison(
  _entry: { tool: string; value: string | number; numValue: number },
  context: { isTop: boolean; gapFromTop: number; gapFromAvg: number; config: OperationalNarrativeConfig }
): string | undefined {
  const { isTop, gapFromAvg } = context

  if (isTop) {
    return context.config.higherIsBetter ? 'Highest performer' : 'Lowest performer'
  }

  if (gapFromAvg > 20) {
    return `+${gapFromAvg.toFixed(0)}% vs avg`
  } else if (gapFromAvg < -20) {
    return `${gapFromAvg.toFixed(0)}% vs avg`
  }

  return undefined
}

/**
 * Build operational context for tool breakdowns
 */
function buildOperationalContext(
  _entry: { tool: string; value: string | number; numValue: number },
  context: { config: OperationalNarrativeConfig; isTop: boolean; isBottom: boolean }
): string | undefined {
  const { config, isTop, isBottom } = context

  if (config.contextType === 'coding' && isTop) {
    return 'Sustained focus, minimal fragmentation'
  }
  if (config.contextType === 'coding' && isBottom) {
    return 'Workflow drag, environmental friction'
  }
  if (config.contextType === 'ai' && isTop) {
    return 'Effective AI integration'
  }
  if (config.contextType === 'ai' && isBottom) {
    return 'Underutilized AI assistance'
  }
  if (config.contextType === 'delivery' && isTop) {
    return 'Efficient commit-to-deploy cadence'
  }
  if (config.contextType === 'delivery' && isBottom) {
    return 'Process bottlenecks, workflow inefficiencies'
  }
  if (config.contextType === 'quality' && isTop) {
    return 'Strong review discipline'
  }
  if (config.contextType === 'quality' && isBottom) {
    return 'Elevated quality pressure'
  }

  return undefined
}

/**
 * Determine impact level for tool breakdowns
 */
function determineImpactLevel(
  _entry: { tool: string; value: string | number; numValue: number },
  isTop: boolean,
  isBottom: boolean,
  gapFromTop: number,
  _config: OperationalNarrativeConfig
): 'high' | 'medium' | 'low' {
  if (isTop) return 'high'
  if (isBottom && gapFromTop > 30) return 'high'
  if (isBottom) return 'medium'
  if (gapFromTop < 10) return 'medium'
  return 'low'
}

/**
 * Generate Executive Findings-style evidence density metadata
 * Adds session counts, PR counts, deployment counts, merge rates, etc.
 */
export interface EvidenceDensity {
  sessionCount?: number
  prCount?: number
  deploymentCount?: number
  mergeRate?: number
  revertRate?: number
  aiIntensity?: string
  commitVelocity?: string
  reviewLoad?: string
  workflowMix?: string
  repoCoverage?: number
  developerCoverage?: number
  ideDistribution?: Record<string, number>
  confidence?: 'low' | 'medium' | 'high'
  timeWindow?: string
}

export function generateEvidenceDensity(
  sessionRows: any[],
  githubData?: any,
  timeWindow?: string
): EvidenceDensity {
  const sessionCount = sessionRows?.length || 0
  
  // Extract GitHub metrics if available
  const prCount = githubData?.total_prs || githubData?.prs?.length || 0
  const deploymentCount = githubData?.deployment_count || githubData?.deployments?.length || 0
  const mergeRate = githubData?.merge_rate || githubData?.merged_prs ? (githubData.merged_prs / githubData.total_prs * 100) : undefined
  const revertRate = githubData?.revert_rate || githubData?.reverts ? (githubData.reverts / sessionCount * 100) : undefined
  
  // AI intensity from telemetry
  const aiSessions = sessionRows?.filter((s: any) => s.ai_burst_count > 0)?.length || 0
  const aiIntensity = sessionCount > 0 ? `${((aiSessions / sessionCount) * 100).toFixed(0)}% sessions with AI` : undefined
  
  // Commit velocity
  const totalCommits = sessionRows?.reduce((sum: number, s: any) => sum + (s.commit_count || 0), 0) || 0
  const commitVelocity = sessionCount > 0 ? `${(totalCommits / sessionCount).toFixed(1)} commits/session` : undefined
  
  // IDE distribution
  const ideDistribution: Record<string, number> = {}
  sessionRows?.forEach((s: any) => {
    const tool = s.tool || 'unknown'
    ideDistribution[tool] = (ideDistribution[tool] || 0) + 1
  })
  
  // Confidence based on sample size
  const confidence = sessionCount >= 20 ? 'high' : sessionCount >= 10 ? 'medium' : 'low'
  
  return {
    sessionCount,
    prCount,
    deploymentCount,
    mergeRate,
    revertRate,
    aiIntensity,
    commitVelocity,
    ideDistribution,
    confidence,
    timeWindow: timeWindow || 'Last 4 weeks'
  }
}

/**
 * Format evidence density into Executive Findings-style compact string
 * Example: "184 sessions • 23 devs • 17 PRs"
 */
export function formatEvidenceDensityCompact(density: EvidenceDensity): string {
  const parts: string[] = []
  
  if (density.sessionCount) parts.push(`${density.sessionCount} sessions`)
  if (density.prCount) parts.push(`${density.prCount} PRs`)
  if (density.deploymentCount) parts.push(`${density.deploymentCount} deployments`)
  if (density.mergeRate) parts.push(`${density.mergeRate.toFixed(0)}% merge rate`)
  if (density.revertRate) parts.push(`${density.revertRate.toFixed(1)}% revert rate`)
  if (density.aiIntensity) parts.push(density.aiIntensity)
  if (density.commitVelocity) parts.push(density.commitVelocity)
  
  return parts.join(' • ')
}

/**
 * Generate Executive Findings-style confidence label with color coding
 */
export function formatConfidenceWithLabel(density: EvidenceDensity): {
  label: string
  class: string
} {
  const confidence = density.confidence || 'low'
  
  const labels: Record<string, string> = {
    high: 'High confidence',
    medium: 'Medium confidence',
    low: 'Low confidence'
  }
  
  const classes: Record<string, string> = {
    high: 'confidence-high',
    medium: 'confidence-medium',
    low: 'confidence-low'
  }
  
  return {
    label: labels[confidence],
    class: classes[confidence]
  }
}
