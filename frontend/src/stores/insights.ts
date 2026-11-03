/**
 * Insights Store - Pinia store for performance insights
 * 
 * Computes actionable insights from existing GitHub and productivity data
 * by integrating with filter store, GitHub store, and productivity metrics.
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Insight, InsightSeverity } from '../types/insights'
import { runPerfInsightsHarness } from '../lib/insights/harness'
import { resolveGithubByGranularityWithRollup, resolveProductivityByGranularityWithRollup } from '../lib/insights/resolvers'
import { pickBestGranularity, deriveGranularity, overlapCount } from '../lib/insights/time'
import { useMetricsFacadeStore } from './metricsFacade'
import { windowLabel } from '../lib/insights/labels'
import { useFilterStore } from './filters'
import { useGitHubStore } from './github'
import { useTimeSeries } from '../composables/useTimeSeries'
import { log, error as logError } from '../utils/logger'

export const useInsightsStore = defineStore('insights', () => {
  // State
  const items = ref<Insight[]>([])
  const loading = ref<boolean>(false)
  const error = ref<string | null>(null)
  
  // Store references
  const filtersStore = useFilterStore()
  const githubStore = useGitHubStore()
  const metricsFacadeStore = useMetricsFacadeStore()
  
  // Debounce timer
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  
  /**
   * Generate previous window snapshot by shifting time range backward
   */
  function generatePreviousSnapshot(currentMetrics: any, timeRange: string): any {
    // Simple heuristic: use 80% of current values as baseline
    // In a real implementation, you'd fetch actual historical data
    const baselineMultiplier = 0.8
    
    return {
      totalPRs: Math.round((currentMetrics.totalPRs || 0) * baselineMultiplier),
      mergedPRs: Math.round((currentMetrics.mergedPRs || 0) * baselineMultiplier),
      rejectedPRs: Math.round((currentMetrics.rejectedPRs || 0) * baselineMultiplier),
      reopenedPRs: Math.round((currentMetrics.reopenedPRs || 0) * baselineMultiplier),
      avgTimeToMergeHours: currentMetrics.avgTimeToMergeHours ? 
        currentMetrics.avgTimeToMergeHours * baselineMultiplier : undefined,
      commentToMergeRatio: currentMetrics.commentToMergeRatio ? 
        currentMetrics.commentToMergeRatio * baselineMultiplier : undefined,
      deployments: Math.round((currentMetrics.deployments || 0) * baselineMultiplier),
      meanTimeToRecoveryHours: currentMetrics.meanTimeToRecoveryHours
    }
  }
  
  /**
   * Map GitHub store metrics to insights context format
   */
  function mapGitHubMetrics(githubMetrics: any): any {
    if (!githubMetrics) {
      return {
        totalPRs: 0,
        mergedPRs: 0,
        rejectedPRs: 0,
        reopenedPRs: 0,
        avgTimeToMergeHours: null,
        commentToMergeRatio: null,
        deployments: 0,
        meanTimeToRecoveryHours: null
      }
    }
    
    // Map available fields from GitHubMetrics interface
    const totalPRs = githubMetrics.pullRequests || 0
    const mergedPRs = githubMetrics.mergedPRs || 0
    const reopenedPRs = githubMetrics.reopenedPRs || 0
    
    // Calculate rejected PRs: total - merged - open (if open exists)
    // For now, estimate as 10% of total if not tracked
    const rejectedPRs = githubMetrics.rejectedPRs || Math.round(totalPRs * 0.1)
    
    // Derive average time to merge from codeReviewTime if available
    const avgTimeToMergeHours = githubMetrics.codeReviewTime ? 
      githubMetrics.codeReviewTime / 24 : null // Convert days to hours
    
    // Use commentToMergeRatio if available
    const commentToMergeRatio = githubMetrics.commentToMergeRatio || null
    
    // Use deploymentFrequency if available, otherwise 0
    const deployments = githubMetrics.deploymentFrequency || 0
    
    // Use meanTimeToRecovery if available
    const meanTimeToRecoveryHours = githubMetrics.meanTimeToRecovery || null
    
    return {
      totalPRs,
      mergedPRs,
      rejectedPRs,
      reopenedPRs,
      avgTimeToMergeHours,
      commentToMergeRatio,
      deployments,
      meanTimeToRecoveryHours
    }
  }
  
  /**
   * Get productivity data from time series composable
   */
  function getProductivityData(): any {
    // For now, return empty data structure
    // In a real implementation, this would integrate with the actual time series data
    // that feeds the ProductivityOverTime component
    return {
      series: [],
      summary: {},
      dataSource: 'Simulated' as const
    }
  }
  
  /**
   * Build insights context from current store state
   */
  function buildInsightsContext(): InsightsInput | null {
    try {
      // Get current filters
      const productivityFilters = filtersStore.productivityFilters
      const activeDateRange = filtersStore.activeDateRange('productivity')
      const activeTeamIds = filtersStore.activeTeamIds('productivity')
      const activeDeveloperIds = filtersStore.activeDeveloperIds('productivity')
      const activeToolIds = filtersStore.activeToolIds('productivity')
      const activeMetricIds = filtersStore.activeMetricIds('productivity')
      
      // Determine scope
      let scope: 'org' | 'team' | 'dev' | 'tool' = 'org'
      if (activeTeamIds.length > 0) scope = 'team'
      else if (activeDeveloperIds.length > 0) scope = 'dev'
      else if (activeToolIds.length > 0) scope = 'tool'
      
      // Get GitHub metrics
      const githubMetrics = githubStore.metrics
      if (!githubMetrics) {
        logError('No GitHub metrics available for insights')
        return null
      }
      
      // Map GitHub metrics to insights context format
      const mappedGitHubMetrics = mapGitHubMetrics(githubMetrics)
      
      // Generate previous snapshot
      const prevSnapshot = generatePreviousSnapshot(mappedGitHubMetrics, 'week')
      
      // Build productivity query for time series
      const productivityQuery = {
        from: activeDateRange.from,
        to: activeDateRange.to,
        repos: filtersStore.activeRepos('productivity'),
        scope: filtersStore.activeScope('productivity'),
        viewBucket: filtersStore.activeViewBucket('productivity'),
        developerIds: activeDeveloperIds,
        teamIds: activeTeamIds,
        toolIds: activeToolIds,
        // Use first metric for now (we'll enhance this later)
        metricId: activeMetricIds[0] || 'ide.ai_suggestions_accepted'
      }
      
      // Get productivity data
      const productivityData = getProductivityData()
      
      // Generate time range label
      const timeRangeLabel = windowLabel(
        activeDateRange.from,
        activeDateRange.to,
        'wow' // Default to week-over-week comparison
      )
      
      const context: InsightsInput = {
        // Filters
        scope,
        teamIds: activeTeamIds,
        developerIds: activeDeveloperIds,
        toolIds: activeToolIds,
        from: activeDateRange.from,
        to: activeDateRange.to,
        viewBucket: filtersStore.activeViewBucket('productivity'),
        comparison: 'wow',
        timeRangeLabel,
        
        // GitHub data
        github: {
          ...mappedGitHubMetrics,
          prev: prevSnapshot
        },
        
        // Productivity data
        productivity: productivityData,
        
        // Identities (optional)
        identities: {
          teams: [], // Would be populated from actual team data
          devs: [],   // Would be populated from actual developer data
          tools: activeToolIds.map(id => ({ id, name: id }))
        }
      }
      
      return context
    } catch (err) {
      logError('Error building insights context:', err)
      return null
    }
  }
  
  /**
   * Refresh insights by evaluating current data using the new performance insights system
   */
  const refresh = async (): Promise<void> => {
    loading.value = true
    error.value = null
    
    try {
      log('🔄 Refreshing insights using new performance insights system...')
      
      // Use the same granularity logic as our other components
      const preferred = deriveGranularity({ activeViewBucket: () => filtersStore.activeViewBucket('productivity') || 'week' })
      
      const chosen = pickBestGranularity(
        (g) => resolveGithubByGranularityWithRollup(githubStore, g),
        (g) => resolveProductivityByGranularityWithRollup(metricsFacadeStore, g),
        preferred,
        4
      )
      
      log('🔍 Insights store - chosen granularity:', chosen.granularity)
      log('🔍 Insights store - gh data length:', chosen.gh.data.length)
      log('🔍 Insights store - prod data length:', chosen.prod.data.length)
      
      // Debug overlap to verify period alignment
      const ghPeriods = [...new Set(chosen.gh.data.map(x => x.period))].slice(0, 6)
      const prodPeriods = [...new Set(chosen.prod.data.map(x => x.period))].slice(0, 6)
      const overlap = overlapCount(chosen.gh.data, chosen.prod.data)
      console.log(`🧩 Overlap(${chosen.granularity}):`, overlap, { ghPeriods, prodPeriods })
      console.log(`Granularity: ${chosen.granularity} · GH(${chosen.granularity}): ${chosen.gh.data.length} [${chosen.gh.source}] · Prod(${chosen.granularity}): ${chosen.prod.data.length} [${chosen.prod.source}] · Overlap: ${overlap}`)
      
      const githubSnapshot = (githubStore as any)?.rawResponse
      
      const insights = runPerfInsightsHarness({
        githubWeekly: chosen.gh.data,
        productivityWeekly: chosen.prod.data,
        granularity: chosen.granularity,
        githubSnapshot: githubSnapshot,
      })
      
      items.value = insights
      
      log(`✅ Generated ${insights.length} insights using new system`)
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh insights'
      error.value = errorMessage
      logError('Error refreshing insights:', err)
      items.value = []
    } finally {
      loading.value = false
    }
  }
  
  /**
   * Debounced refresh function
   */
  const debouncedRefresh = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    
    debounceTimer = setTimeout(() => {
      refresh()
    }, 400)
  }
  
  /**
   * Bind to filter changes for automatic refresh
   */
  const bindToFilters = (): void => {
    log('🔗 Binding insights to filter changes')
    
    // Watch productivity filters for changes
    watch(
      () => filtersStore.productivityFilters,
      () => {
        log('🔄 Productivity filters changed, refreshing insights')
        debouncedRefresh()
      },
      { deep: true }
    )
    
    // Watch GitHub metrics for changes
    watch(
      () => githubStore.metrics,
      () => {
        log('🔄 GitHub metrics changed, refreshing insights')
        debouncedRefresh()
      },
      { deep: true }
    )
  }
  
  // Getters
  const bySeverity = computed((): Record<InsightSeverity, Insight[]> => {
    const result: Record<InsightSeverity, Insight[]> = {
      'risk': [],
      'lowlight': [],
      'opportunity': [],
      'highlight': []
    }
    
    items.value.forEach(insight => {
      result[insight.severity].push(insight)
    })
    
    return result
  })
  
  const top = computed(() => (n: number = 6): Insight[] => {
    // Sort by severity priority: risk > lowlight > opportunity > highlight
    const severityOrder = { 'risk': 0, 'lowlight': 1, 'opportunity': 2, 'highlight': 3 }
    
    const sorted = [...items.value].sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity]
      if (severityDiff !== 0) return severityDiff
      
      // Then by absolute deltaPct descending
      const aDelta = Math.abs(a.deltaPct || 0)
      const bDelta = Math.abs(b.deltaPct || 0)
      
      if (a.deltaPct === null && b.deltaPct === null) return 0
      if (a.deltaPct === null) return 1
      if (b.deltaPct === null) return -1
      
      return bDelta - aDelta
    })
    
    return sorted.slice(0, n)
  })
  
  // Initialize with first refresh
  refresh()
  
  return {
    // State
    items,
    loading,
    error,
    
    // Actions
    refresh,
    bindToFilters,
    
    // Getters
    bySeverity,
    top
  }
})
