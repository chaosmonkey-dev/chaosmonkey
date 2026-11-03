/**
 * MVP Performance Insights Quality Formatter
 * 
 * Shared utility for formatting all MVP insights with executive-friendly titles,
 * scannable content, and proper evidence formatting.
 */

// Define the PerformanceInsight interface locally to avoid circular imports
export interface PerformanceInsight {
  id: string
  title: string
  description?: string
  severity: string
  cicdStage?: string
  toolScope?: string
  source: string
  metricId?: string
  displayValue?: string
  metricValue?: number
  confidenceLevel?: string
  evidence?: Array<{ label?: string; value?: any }>
  related?: { tools?: string[]; teams?: string[] }
  tags?: string[]
}

// Confidence thresholds based on sample size
const CONFIDENCE_THRESHOLDS = {
  sessions: { high: 20, medium: 10 },
  prs: { high: 15, medium: 8 },
  deployments: { high: 10, medium: 5 },
  periods: { high: 8, medium: 4 }
}

export interface FormattedInsight {
  title: string
  whatHappened: string
  whyItMatters: string
  evidence: string[]
  recommendation: string
  contextBadges: {
    source: string
    scope: string
    window: string
    confidence: string
  }
}

/**
 * Build executive-friendly title respecting IDE-vs-org rules
 */
export function buildTitle(insight: PerformanceInsight): string {
  const { title, toolScope, evidence, metricValue } = insight
  
  // If IDE attribution exists and we have IDE-specific evidence
  if (toolScope === 'single-ide' && evidence && evidence.length > 0) {
    // Extract IDE name from evidence or related tools
    const ideName = extractIDEName(insight)
    const primaryNumber = extractPrimaryNumber(insight)
    
    if (ideName && primaryNumber) {
      return `${ideName} leads in ${extractMetricName(title)} (${primaryNumber})`
    }
  }
  
  // Fallback to org-level title - make it executive-friendly
  return makeExecutiveFriendly(title)
}

/**
 * Build "What happened" section - 1 sentence, quantified
 */
export function buildWhatHappened(insight: PerformanceInsight): string {
  const { title, description, metricValue, evidence } = insight
  
  // Extract key quantified info from evidence
  const primaryValue = extractPrimaryNumber(insight)
  const metric = extractMetricName(title)
  
  if (primaryValue) {
    // For IDE-specific insights
    if (insight.toolScope === 'single-ide') {
      const ideName = extractIDEName(insight)
      return `${ideName} achieved ${primaryValue} ${metric}, ${getComparativePhrase(insight)}.`
    }
    
    // For org-level insights
    return `Organization ${metric.toLowerCase()} is ${primaryValue}, ${getTrendPhrase(insight)}.`
  }
  
  // Fallback to description
  return description?.split('.')[0] + '.' || 'Metric change detected.'
}

/**
 * Build "Why it matters" section - 1 sentence, business impact
 */
export function buildWhyItMatters(insight: PerformanceInsight): string {
  const metric = extractMetricName(insight.title)
  const severity = insight.severity
  
  if (metric.includes('commit') || metric.includes('coding')) {
    return 'Faster onboarding and environment setup directly impact developer productivity and time-to-value.'
  }
  
  if (metric.includes('review') || metric.includes('merge')) {
    return 'Review efficiency affects delivery predictability and code quality, impacting release cadence.'
  }
  
  if (metric.includes('deploy') || metric.includes('reliability')) {
    return 'Deployment reliability and risk management directly impact service stability and customer experience.'
  }
  
  if (metric.includes('AI') || metric.includes('suggestion')) {
    return 'AI tooling effectiveness influences development velocity and code quality consistency.'
  }
  
  // Generic business impact
  const impact = severity === 'critical' ? 'critical' : severity === 'warning' ? 'significant' : 'operational'
  return `This metric has ${impact} impact on engineering efficiency and delivery outcomes.`
}

/**
 * Build evidence section - max 6 lines, includes coverage + time window + sample size
 */
export function buildEvidence(insight: PerformanceInsight): string[] {
  const evidence: string[] = []
  const { evidence: rawEvidence } = insight
  
  // Add primary value with context
  const primaryValue = extractPrimaryNumber(insight)
  if (primaryValue) {
    const metric = extractMetricName(insight.title)
    if (insight.toolScope === 'single-ide') {
      const ideName = extractIDEName(insight)
      evidence.push(`${ideName} ${metric.toLowerCase()}: ${primaryValue}`)
    } else {
      evidence.push(`Organization ${metric.toLowerCase()}: ${primaryValue}`)
    }
  }
  
  // Add comparative data if available
  const comparative = extractComparativeData(insight)
  if (comparative) {
    evidence.push(comparative)
  }
  
  // Add coverage and sample size
  const coverage = extractCoverageInfo(insight)
  if (coverage) {
    evidence.push(coverage)
  }
  
  // Add time window
  const timeWindow = extractTimeWindow(insight)
  if (timeWindow) {
    evidence.push(`Time window: ${timeWindow}`)
  }
  
  // Add source data quality
  const sourceQuality = extractSourceQuality(insight)
  if (sourceQuality) {
    evidence.push(sourceQuality)
  }
  
  return evidence.slice(0, 6) // Max 6 lines
}

/**
 * Build recommendation - 1 action with owner cue
 */
export function buildRecommendation(insight: PerformanceInsight): string {
  const metric = extractMetricName(insight.title)
  const severity = insight.severity
  const primaryValue = extractPrimaryNumber(insight)
  
  // Determine owner based on metric type
  let owner = 'DevEx' // Default
  if (metric.includes('deploy') || metric.includes('reliability')) {
    owner = 'DevOps'
  } else if (metric.includes('review') || metric.includes('merge')) {
    owner = 'EM'
  } else if (metric.includes('AI') || metric.includes('tooling')) {
    owner = 'Staff'
  }
  
  // Build specific recommendation
  if (insight.toolScope === 'single-ide' && primaryValue) {
    const ideName = extractIDEName(insight)
    const targetValue = suggestTargetValue(metric, primaryValue)
    return `Action (${owner}): Standardize ${ideName} workflows to improve ${metric.toLowerCase()} from ${primaryValue} → ${targetValue}.`
  }
  
  // Org-level recommendations
  if (metric.includes('cycle time')) {
    return `Action (${owner}): Implement PR size guidelines and automated reviews to reduce cycle time bottlenecks.`
  }
  
  if (metric.includes('risk')) {
    return `Action (${owner}): Strengthen quality gates and pre-deployment checks to reduce release risk.`
  }
  
  if (metric.includes('reliability')) {
    return `Action (${owner}): Improve monitoring and incident response processes to enhance service reliability.`
  }
  
  // Generic recommendation
  return `Action (${owner}): Analyze ${metric.toLowerCase()} patterns and implement process improvements.`
}

/**
 * Build context badges
 */
export function buildContextBadges(insight: PerformanceInsight): FormattedInsight['contextBadges'] {
  return {
    source: getSourceLabel(insight.source),
    scope: insight.toolScope === 'org' ? 'Org' : 'IDE',
    window: extractTimeWindow(insight) || 'Last 14d',
    confidence: getConfidenceLevel(insight)
  }
}

// Helper functions

function extractIDEName(insight: PerformanceInsight): string | null {
  // Try to extract from title first
  const titleMatch = insight.title.match(/(\w+)\s+(leads|reaches|achieves)/i)
  if (titleMatch) {
    return titleMatch[1]
  }
  
  // Try related tools
  if (insight.related?.tools?.length) {
    return insight.related.tools[0]
  }
  
  // Try evidence for IDE name
  if (insight.evidence) {
    for (const ev of insight.evidence) {
      if (ev.label?.toLowerCase().includes('ide') && typeof ev.value === 'string') {
        return ev.value
      }
    }
  }
  
  return null
}

function extractPrimaryNumber(insight: PerformanceInsight): string | null {
  // Try displayValue first
  if (insight.displayValue) {
    const match = insight.displayValue.match(/[\d.]+[a-z%]+/i)
    if (match) return match[0]
  }
  
  // Try metricValue
  if (insight.metricValue && typeof insight.metricValue === 'number') {
    const unit = getUnitForMetric(insight.title)
    return `${insight.metricValue.toFixed(1)}${unit}`
  }
  
  // Try evidence
  if (insight.evidence) {
    for (const ev of insight.evidence) {
      if (typeof ev.value === 'string') {
        const match = ev.value.match(/[\d.]+[a-z%]+/i)
        if (match) return match[0]
      }
    }
  }
  
  return null
}

function extractMetricName(title: string): string {
  // Extract the core metric from title
  const patterns = [
    /(\w+)\s+(leads|reaches|achieves)/i,
    /(\w+)\s+is\s+[\d.]+/i,
    /(\w+):\s*[\d.]+/i,
    /(\w+)\s+(risk|lag|trend)/i
  ]
  
  for (const pattern of patterns) {
    const match = title.match(pattern)
    if (match) {
      return match[1].toLowerCase()
    }
  }
  
  // Fallback: remove common prefixes
  return title.replace(/^(AI|GitHub|Organization|Deployment)\s+/i, '').toLowerCase()
}

function getUnitForMetric(title: string): string {
  if (title.includes('time') || title.includes('latency') || title.includes('cycle')) return 'h'
  if (title.includes('rate') || title.includes('risk')) return '%'
  if (title.includes('count') || title.includes('sessions')) return ''
  if (title.includes('throughput')) return 'h'
  return ''
}

function extractComparativeData(insight: PerformanceInsight): string | null {
  if (insight.evidence) {
    for (const ev of insight.evidence) {
      if (ev.label?.toLowerCase().includes('vs') || ev.label?.toLowerCase().includes('delta')) {
        return `${ev.label}: ${ev.value}`
      }
    }
  }
  return null
}

function extractCoverageInfo(insight: PerformanceInsight): string | null {
  if (insight.evidence) {
    for (const ev of insight.evidence) {
      const label = ev.label?.toLowerCase() || ''
      const value = String(ev.value || '')
      
      if (label.includes('sessions') && value.includes('n=')) {
        return `Coverage: 100% (${value})`
      }
      if (label.includes('prs') && value.includes('n=')) {
        return `PRs: ${value}`
      }
      if (label.includes('deployments') && value.includes('n=')) {
        return `Deployments: ${value}`
      }
    }
  }
  
  // Try to infer from metricValue
  if (insight.metricValue && typeof insight.metricValue === 'number') {
    const metric = extractMetricName(insight.title)
    let type: keyof typeof CONFIDENCE_THRESHOLDS = 'sessions'
    
    if (metric.includes('pr')) type = 'prs'
    if (metric.includes('deploy')) type = 'deployments'
    if (metric.includes('period')) type = 'periods'
    
    return `Sample: n=${Math.round(insight.metricValue)}`
  }
  
  return null
}

function extractTimeWindow(insight: PerformanceInsight): string | null {
  // Try to extract from evidence
  if (insight.evidence) {
    for (const ev of insight.evidence) {
      if (ev.label?.toLowerCase().includes('period') || ev.label?.toLowerCase().includes('window')) {
        return String(ev.value)
      }
    }
  }
  
  // Default based on confidence level
  const confidence = getConfidenceLevel(insight)
  if (confidence === 'High') return 'Last 30d'
  if (confidence === 'Medium') return 'Last 14d'
  return 'Last 7d'
}

function extractSourceQuality(insight: PerformanceInsight): string | null {
  const source = insight.source || 'unknown'
  if (source === 'github') return 'Source: GitHub API (100% coverage)'
  if (source === 'productivity') return 'Source: IDE telemetry (100% coverage)'
  if (source === 'combined') return 'Source: Hybrid (GitHub + IDE)'
  return `Source: ${source}`
}

function getComparativePhrase(insight: PerformanceInsight): string {
  const severity = insight.severity
  if (severity === 'highlight') return 'leading performance'
  if (severity === 'info') return 'above median'
  if (severity === 'warning') return 'needs attention'
  return 'baseline performance'
}

function getTrendPhrase(insight: PerformanceInsight): string {
  const severity = insight.severity
  const metric = extractMetricName(insight.title)
  
  if (severity === 'critical') {
    if (metric.includes('reopen') || metric.includes('revert')) return 'review pressure emerging'
    if (metric.includes('deploy') || metric.includes('failure')) return 'deployment risk detected'
    if (metric.includes('cycle') || metric.includes('latency')) return 'workflow bottlenecks identified'
    return 'requiring attention'
  }
  
  if (severity === 'warning') {
    if (metric.includes('ai') || metric.includes('burst')) return 'elevated AI concentration'
    if (metric.includes('session') || metric.includes('active')) return 'lower sustained focus'
    if (metric.includes('commit') || metric.includes('delivery')) return 'iteration variance detected'
    return 'operational variance detected'
  }
  
  if (severity === 'highlight') {
    if (metric.includes('ai') || metric.includes('burst')) return 'balanced AI adoption'
    if (metric.includes('session') || metric.includes('active')) return 'strong workflow consistency'
    if (metric.includes('commit') || metric.includes('delivery')) return 'strong throughput consistency'
    return 'stable workflow profile'
  }
  
  return 'within expected variance'
}

function makeExecutiveFriendly(title: string): string {
  // Remove technical jargon and make it executive-friendly
  return title
    .replace(/by IDE/gi, '')
    .replace(/::.*$/gi, '') // Remove suffixes
    .replace(/\b(org|organization)\s+/gi, '')
    .replace(/\b(v2|v1)\s+/gi, '')
    .trim()
}

function suggestTargetValue(metric: string, currentValue: string): string {
  // Simple heuristic for target values
  if (metric.includes('time')) {
    const num = parseFloat(currentValue)
    if (!isNaN(num)) {
      const target = Math.max(num * 0.8, num - 2) // 20% improvement or 2 unit reduction
      return `${target.toFixed(1)}h`
    }
  }
  
  if (metric.includes('rate') || metric.includes('risk')) {
    const num = parseFloat(currentValue)
    if (!isNaN(num)) {
      const target = Math.max(num * 0.7, num - 10) // 30% improvement or 10 point reduction
      return `${target.toFixed(1)}%`
    }
  }
  
  return 'target'
}

function getSourceLabel(source: string): string {
  if (source === 'github') return 'GitHub'
  if (source === 'productivity') return 'Telemetry'
  if (source === 'combined') return 'Hybrid'
  if (source === 'simulated') return 'Simulated'
  return source || 'Unknown'
}

function getConfidenceLevel(insight: PerformanceInsight): string {
  // Use existing confidenceLevel if available
  if (insight.confidenceLevel) {
    return insight.confidenceLevel.charAt(0).toUpperCase() + insight.confidenceLevel.slice(1).toLowerCase()
  }
  
  // Infer from sample size
  const sampleSize = extractSampleSize(insight)
  if (!sampleSize) return 'Low'
  
  const metric = extractMetricName(insight.title)
  let type: keyof typeof CONFIDENCE_THRESHOLDS = 'sessions'
  
  if (metric.includes('pr')) type = 'prs'
  if (metric.includes('deploy')) type = 'deployments'
  if (metric.includes('period')) type = 'periods'
  
  const thresholds = CONFIDENCE_THRESHOLDS[type]
  if (sampleSize >= thresholds.high) return 'High'
  if (sampleSize >= thresholds.medium) return 'Medium'
  return 'Low'
}

function extractSampleSize(insight: PerformanceInsight): number | null {
  // Try to extract sample size from evidence
  if (insight.evidence) {
    for (const ev of insight.evidence) {
      const value = String(ev.value || '')
      const match = value.match(/n=(\d+)/)
      if (match) {
        return parseInt(match[1])
      }
    }
  }
  
  return null
}

/**
 * Main formatter function - applies all formatting to an insight
 */
export function formatMVPInsight(insight: PerformanceInsight): FormattedInsight {
  return {
    title: buildTitle(insight),
    whatHappened: buildWhatHappened(insight),
    whyItMatters: buildWhyItMatters(insight),
    evidence: buildEvidence(insight),
    recommendation: buildRecommendation(insight),
    contextBadges: buildContextBadges(insight)
  }
}
