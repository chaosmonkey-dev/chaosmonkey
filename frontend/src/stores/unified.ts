/**
 * Unified Metrics Store
 * 
 * Pinia store that combines GitHub and IDE data into unified time series.
 * Consumes existing stores and adapters to provide a single unified API.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { 
  UnifiedQuery, 
  UnifiedSeries, 
  UnifiedEvent, 
  UnifiedMetricId, 
  UnifiedSeriesPoint,
  Scope,
  ToolId
} from '../types/unified'
import { 
  metricKind, 
  formatLabel, 
  isCount, 
  isValidMetricId,
  isValidToolId,
  isValidScope
} from '../types/unified'
import { mapGithubSnapshotToUnified } from '../lib/adapters/githubToUnified'
import { mapIdeSeriesToUnified } from '../lib/adapters/ideToUnified'
import { useGitHubStore } from './github'
import { useMetricsFacadeStore } from './metricsFacade'
import { useFilterStore } from './filters'

// ============================================================================
// STORE DEFINITION
// ============================================================================

export const useUnifiedStore = defineStore('unified', () => {
  // State
  const events = ref<UnifiedEvent[]>([])      // append-only cache for current session
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Store dependencies
  const githubStore = useGitHubStore()
  const metricsFacadeStore = useMetricsFacadeStore()
  const filterStore = useFilterStore()

  // ============================================================================
  // MAIN API FUNCTIONS
  // ============================================================================

  /**
   * Refreshes unified events by fetching from GitHub and IDE sources
   */
  async function refresh(query: UnifiedQuery): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      // Validate query
      if (!isValidQuery(query)) {
        throw new Error('Invalid query parameters')
      }

      const allEvents: UnifiedEvent[] = []

      // Fetch GitHub data if any GitHub metrics are requested
      const githubMetrics = query.metrics.filter(metric => metric.startsWith('gh.'))
      if (githubMetrics.length > 0) {
        const githubEvents = await fetchGitHubEvents(query)
        allEvents.push(...githubEvents)
      }

      // Fetch IDE data if any IDE metrics are requested
      const ideMetrics = query.metrics.filter(metric => metric.startsWith('ide.'))
      if (ideMetrics.length > 0) {
        const ideEvents = await fetchIDEEvents(query)
        allEvents.push(...ideEvents)
      }

      // Replace events with new data
      events.value = allEvents

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      error.value = errorMessage
      console.error('Unified store refresh error:', err)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Clears all events and resets error state
   */
  function clear(): void {
    events.value = []
    error.value = null
  }

  /**
   * Gets unified time series from cached events based on query
   */
  function getSeries(query: UnifiedQuery): UnifiedSeries[] {
    if (!isValidQuery(query)) {
      console.warn('Invalid query provided to getSeries')
      return []
    }

    // Filter events by query parameters
    const filteredEvents = filterEventsByQuery(events.value, query)
    
    // Group events by metric
    const eventsByMetric = groupEventsByMetric(filteredEvents)
    
    // Convert to series
    const series: UnifiedSeries[] = []
    
    for (const metric of query.metrics) {
      const metricEvents = eventsByMetric[metric] || []
      
      if (metricEvents.length === 0) {
        // Return empty series for metrics with no data
        series.push({
          label: formatLabel(metric),
          points: [],
          meta: { metric, kind: metricKind(metric) }
        })
        continue
      }

      // Bucket events by time
      const bucketedPoints = bucketEventsByTime(metricEvents, query.viewBucket)
      
      // Aggregate points within each bucket
      const aggregatedPoints = aggregatePointsInBuckets(bucketedPoints, metric)
      
      series.push({
        label: formatLabel(metric),
        points: aggregatedPoints,
        meta: { 
          metric, 
          kind: metricKind(metric),
          source: metricEvents[0]?.source,
          toolId: metricEvents[0]?.toolId
        }
      })
    }

    return series
  }

  // ============================================================================
  // PRIVATE HELPER FUNCTIONS
  // ============================================================================

  /**
   * Validates query parameters
   */
  function isValidQuery(query: UnifiedQuery): boolean {
    return (
      !!query.from && 
      !!query.to && 
      isValidScope(query.scope) &&
      Array.isArray(query.metrics) &&
      query.metrics.every(isValidMetricId) &&
      ['hourly', 'daily', 'weekly', 'monthly'].includes(query.viewBucket)
    )
  }

  /**
   * Fetches GitHub events using existing GitHub store
   */
  async function fetchGitHubEvents(query: UnifiedQuery): Promise<UnifiedEvent[]> {
    try {
      // Use existing GitHub store to get data
      // Convert query time range to appropriate format for GitHub store
      const timeRange = getTimeRangeFromQuery(query)
      
      // Fetch metrics from GitHub store
      await githubStore.fetchMetrics(timeRange)
      
      if (!githubStore.metrics) {
        return []
      }

      // Convert GitHub store data to snapshots
      const snapshots = convertGitHubMetricsToSnapshots(githubStore.metrics, query)
      
      // Map to unified events
      return mapGithubSnapshotToUnified({
        snapshots,
        scope: query.scope,
        orgId: 'default-org', // TODO: Get from auth context
        teamId: query.teamIds?.[0],
        developerId: query.developerIds?.[0],
        repo: query.repoNames?.[0]
      })
    } catch (err) {
      console.error('Error fetching GitHub events:', err)
      return []
    }
  }

  /**
   * Fetches IDE events using existing metrics facade
   */
  async function fetchIDEEvents(query: UnifiedQuery): Promise<UnifiedEvent[]> {
    try {
      // Use existing metrics facade to get IDE data
      const ideMetrics = query.metrics.filter(metric => metric.startsWith('ide.'))
      
      if (ideMetrics.length === 0) {
        return []
      }

      // Convert unified query to productivity query format
      const productivityQuery = convertToProductivityQuery(query)
      
      // Get time series data from metrics facade
      const timeSeriesData = await metricsFacadeStore.getProductivityTimeSeries(productivityQuery)
      
      if (!timeSeriesData || !Array.isArray(timeSeriesData)) {
        return []
      }

      // Convert time series data to IDE series format
      const ideSeries = convertTimeSeriesToIdeSeries(timeSeriesData, ideMetrics)
      
      // Map to unified events
      return mapIdeSeriesToUnified({
        series: ideSeries,
        scope: query.scope,
        orgId: 'default-org', // TODO: Get from auth context
        teamId: query.teamIds?.[0],
        developerId: query.developerIds?.[0]
      })
    } catch (err) {
      console.error('Error fetching IDE events:', err)
      return []
    }
  }

  /**
   * Filters events based on query parameters
   */
  function filterEventsByQuery(events: UnifiedEvent[], query: UnifiedQuery): UnifiedEvent[] {
    return events.filter(event => {
      // Filter by metrics
      if (!query.metrics.includes(event.metric)) {
        return false
      }

      // Filter by time range
      if (event.timestamp < query.from || event.timestamp > query.to) {
        return false
      }

      // Filter by scope
      if (event.scope !== query.scope) {
        return false
      }

      // Filter by team IDs
      if (query.teamIds && query.teamIds.length > 0) {
        if (!event.teamId || !query.teamIds.includes(event.teamId)) {
          return false
        }
      }

      // Filter by developer IDs
      if (query.developerIds && query.developerIds.length > 0) {
        if (!event.developerId || !query.developerIds.includes(event.developerId)) {
          return false
        }
      }

      // Filter by repository names
      if (query.repoNames && query.repoNames.length > 0) {
        if (!event.repo || !query.repoNames.includes(event.repo)) {
          return false
        }
      }

      // Filter by tool IDs
      if (query.toolIds && query.toolIds.length > 0) {
        if (!event.toolId || !query.toolIds.includes(event.toolId)) {
          return false
        }
      }

      return true
    })
  }

  /**
   * Groups events by metric
   */
  function groupEventsByMetric(events: UnifiedEvent[]): Record<UnifiedMetricId, UnifiedEvent[]> {
    const grouped: Record<string, UnifiedEvent[]> = {}
    
    for (const event of events) {
      if (!grouped[event.metric]) {
        grouped[event.metric] = []
      }
      grouped[event.metric].push(event)
    }
    
    return grouped as Record<UnifiedMetricId, UnifiedEvent[]>
  }

  /**
   * Buckets events by time based on viewBucket
   */
  function bucketEventsByTime(events: UnifiedEvent[], viewBucket: string): Record<string, UnifiedEvent[]> {
    const buckets: Record<string, UnifiedEvent[]> = {}
    
    for (const event of events) {
      const bucketKey = getBucketKey(event.timestamp, viewBucket)
      
      if (!buckets[bucketKey]) {
        buckets[bucketKey] = []
      }
      buckets[bucketKey].push(event)
    }
    
    return buckets
  }

  /**
   * Gets bucket key for a timestamp based on viewBucket
   */
  function getBucketKey(timestamp: string, viewBucket: string): string {
    const date = new Date(timestamp)
    
    switch (viewBucket) {
      case 'hourly':
        return date.toISOString().slice(0, 13) + ':00:00.000Z'
      case 'daily':
        return date.toISOString().slice(0, 10) + 'T00:00:00.000Z'
      case 'weekly':
        // Get start of week (Monday)
        const weekStart = new Date(date)
        weekStart.setDate(date.getDate() - date.getDay() + 1)
        return weekStart.toISOString().slice(0, 10) + 'T00:00:00.000Z'
      case 'monthly':
        return date.toISOString().slice(0, 7) + '-01T00:00:00.000Z'
      default:
        return timestamp
    }
  }

  /**
   * Aggregates points within buckets based on metric kind
   */
  function aggregatePointsInBuckets(buckets: Record<string, UnifiedEvent[]>, metric: UnifiedMetricId): UnifiedSeriesPoint[] {
    const points: UnifiedSeriesPoint[] = []
    const kind = metricKind(metric)
    
    for (const [bucketTime, bucketEvents] of Object.entries(buckets)) {
      let aggregatedValue: number
      
      switch (kind) {
        case 'COUNT':
          // SUM for count metrics
          aggregatedValue = bucketEvents.reduce((sum, event) => sum + event.value, 0)
          break
        case 'DURATION':
        case 'RATIO':
          // AVG for duration and ratio metrics
          aggregatedValue = bucketEvents.reduce((sum, event) => sum + event.value, 0) / bucketEvents.length
          break
        default:
          aggregatedValue = 0
      }
      
      points.push({
        t: bucketTime,
        v: aggregatedValue
      })
    }
    
    // Sort by timestamp ascending
    return points.sort((a, b) => a.t.localeCompare(b.t))
  }

  // ============================================================================
  // CONVERSION HELPERS
  // ============================================================================

  /**
   * Converts query time range to GitHub store format
   */
  function getTimeRangeFromQuery(query: UnifiedQuery): 'all' | 'week' | 'month' | 'quarter' {
    const fromDate = new Date(query.from)
    const toDate = new Date(query.to)
    const daysDiff = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysDiff <= 7) return 'week'
    if (daysDiff <= 30) return 'month'
    if (daysDiff <= 90) return 'quarter'
    return 'all'
  }

  /**
   * Converts GitHub store metrics to snapshot format
   */
  function convertGitHubMetricsToSnapshots(metrics: any, query: UnifiedQuery): any[] {
    return [{
      // accept both backend-style and store-style names
      total_pull_requests:      metrics.total_pull_requests ?? metrics.pullRequests ?? 0,
      merged_pull_requests:     metrics.merged_pull_requests ?? metrics.mergedPRs ?? 0,
      reopened_pull_requests:   metrics.reopened_pull_requests ?? metrics.reopenedPRs ?? metrics.reopened_prs ?? 0,
      rejected_pull_requests:   metrics.rejected_pull_requests ?? metrics.rejectedPRs ?? metrics.rejected_prs ?? 0,
      avg_time_to_merge_hours:  metrics.avg_time_to_merge_hours ?? metrics.leadTime ?? metrics.time_to_merge ?? 0,
      comment_to_merge_ratio:   metrics.comment_to_merge_ratio ?? metrics.commentToMergeRatio ?? 0,
      deployments:              metrics.deployments ?? metrics.deploymentFrequency ?? 0,
      mttr_hours:               metrics.mttr_hours ?? metrics.meanTimeToRecovery ?? metrics.mttrHours ?? 0,
      ts: new Date().toISOString(),
      repo: query.repoNames?.[0]
    }]
  }

  /**
   * Converts unified query to productivity query format
   */
  function convertToProductivityQuery(query: UnifiedQuery): any {
    return {
      from: query.from,
      to: query.to,
      teamIds: query.teamIds,
      developerIds: query.developerIds,
      toolIds: query.toolIds,
      metrics: query.metrics.filter(metric => metric.startsWith('ide.'))
    }
  }

  /**
   * Converts time series data to IDE series format
   */
  function convertTimeSeriesToIdeSeries(timeSeriesData: any[], metrics: UnifiedMetricId[]): any[] {
    const series: any[] = []
    
    for (const data of timeSeriesData) {
      if (data.label && data.points) {
        // Map tool names to tool IDs
        const toolId = mapToolNameToId(data.label)
        
        for (const metric of metrics) {
          series.push({
            toolId,
            metric,
            points: data.points
          })
        }
      }
    }
    
    return series
  }

  /**
   * Maps tool names to tool IDs
   */
  function mapToolNameToId(toolName: string): ToolId {
    const mapping: Record<string, ToolId> = {
      'cursor': 'cursor',
      'Cursor': 'cursor',
      'vscode': 'vscode',
      'VS Code': 'vscode',
      'windsurf': 'windsurf',
      'Windsurf': 'windsurf',
      'jetbrains': 'jetbrains',
      'JetBrains': 'jetbrains',
      'intellij': 'intellij',
      'IntelliJ': 'intellij',
      'webstorm': 'webstorm',
      'WebStorm': 'webstorm',
      'vim': 'vim',
      'Vim': 'vim',
      'neovim': 'neovim',
      'Neovim': 'neovim',
      'sublime': 'vim', // Map sublime to vim for now
      'Sublime': 'vim'
    }
    
    return mapping[toolName.toLowerCase()] || 'cursor'
  }

  // ============================================================================
  // COMPUTED PROPERTIES
  // ============================================================================

  const eventCount = computed(() => events.value.length)
  
  const hasData = computed(() => events.value.length > 0)
  
  const uniqueMetrics = computed(() => {
    const metrics = new Set<UnifiedMetricId>()
    events.value.forEach(event => metrics.add(event.metric))
    return Array.from(metrics)
  })
  
  const uniqueTools = computed(() => {
    const tools = new Set<ToolId>()
    events.value.forEach(event => {
      if (event.toolId) tools.add(event.toolId)
    })
    return Array.from(tools)
  })

  // ============================================================================
  // RETURN STORE API
  // ============================================================================

  return {
    // State
    events,
    isLoading,
    error,
    
    // Main API
    refresh,
    clear,
    getSeries,
    
    // Computed
    eventCount,
    hasData,
    uniqueMetrics,
    uniqueTools
  }
})




