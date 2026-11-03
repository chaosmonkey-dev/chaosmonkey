/**
 * Performance Insights System Types
 * 
 * Defines strict TypeScript types for the insights engine that provides
 * actionable recommendations to engineering leaders based on real GitHub
 * data and simulated productivity metrics.
 */

export type InsightSeverity = 'highlight' | 'lowlight' | 'risk' | 'opportunity' | 'info' | 'warning' | 'critical'

export type InsightScope = 'org' | 'team' | 'dev' | 'tool'

export type InsightMetricKind = 'github' | 'productivity'

export type ComparisonWindow = 'dod' | 'wow' | 'mom' | 'qoq' | 'all'

/**
 * Core insight interface representing a single actionable recommendation
 * for engineering leaders based on data analysis.
 */
export interface Insight {
  /** Stable, deterministic identifier for the insight */
  id: string
  
  /** Clear, concise title describing the insight */
  title: string
  
  /** 1-2 sentence summary of what the data shows */
  summary: string
  
  /** Severity level indicating urgency/importance */
  severity: InsightSeverity
  
  /** Scope level this insight applies to */
  scope: InsightScope
  
  /** Specific entity ID when scope is not 'org' (teamId/devId/toolId) */
  entityId?: string
  
  /** Metric identifier (e.g. 'time_to_merge_hours', 'AI_acceptance_rate_percent') */
  metricId: string
  
  /** Type of metric data source */
  metricKind: InsightMetricKind
  
  /** Current metric value */
  value: number | null
  
  /** Previous period value for comparison */
  baseline?: number | null
  
  /** Percentage change from baseline: (value - baseline)/baseline */
  deltaPct?: number | null
  
  /** Supporting evidence data points */
  evidence: Array<{ label: string; value: string | number }>
  
  /** Prescriptive action recommendation (one-liner) */
  recommendedAction?: string
  
  /** Suggested owners for taking action */
  recommendedOwners?: string[]
  
  /** Categorization tags for filtering/grouping */
  tags: string[]
  
  /** Data source reliability indicator */
  dataSource: 'Real' | 'Simulated' | 'Mixed'
  
  /** Tools where this insight was also observed (for deduplication) */
  alsoObservedIn?: string[]
  
  /** Human-readable time range description */
  timeRangeLabel: string
  
  /** Confidence badge: Observed/Mixed/GitHub-only/Estimated */
  confidenceBadge?: 'Observed' | 'Mixed' | 'GitHub-only' | 'Estimated'
  
  /** Supporting context for merged insights */
  supportingContext?: Array<{
    id: string
    title: string
    metricId?: string
    evidence: Array<{ label: string; value?: number | string }>
  }>
  
  /** Rule label for display */
  ruleLabel?: string
}
