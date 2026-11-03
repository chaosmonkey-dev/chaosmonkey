import type { Granularity } from './time';
import { rollupEngToWeeks, rollupProdToWeeks } from './rollup';
import { CANONICAL_REAL_WORKFLOWS } from '../workflowIdentity';

type AnyObj = Record<string, any>;
const read = (obj: AnyObj, path: string): any =>
  path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);

const firstNonEmpty = (obj: AnyObj, candidates: string[]) => {
  for (const p of candidates) {
    const v = read(obj, p);
    if (Array.isArray(v) && v.length > 0) return { data: v, source: p };
  }
  return { data: [], source: '' };
};

// GitHub resolver - works with actual store structure
export function resolveGithubByGranularity(store: AnyObj, g: Granularity) {
  // Prefer real backend aggregation over snapshot synthesis
  if (store.metrics?.github_by_period && Array.isArray(store.metrics.github_by_period) && store.metrics.github_by_period.length > 0) {
    console.log('🔍 Resolver: Using real backend githubByPeriod aggregation:', store.metrics.github_by_period)
    
    const timeSeriesData = enrich_real_github_by_period(store.metrics.github_by_period, store.metrics)
    console.log('🔍 Resolver: Enriched GitHub time series:', timeSeriesData)
    
    return { data: timeSeriesData, source: 'github-backend-aggregation' };
  }
  
  // Fallback to snapshot synthesis only if no backend aggregation provided
  if (store.metrics) {
    console.log('🔍 Resolver: Backend githubByPeriod not available, falling back to snapshot synthesis')
    
    const timeSeriesData = convertGitHubSnapshotToTimeSeries(store.metrics, g)
    console.log('🔍 Resolver: Converted GitHub time series:', timeSeriesData)
    
    return { data: timeSeriesData, source: 'github-snapshot-fallback' };
  }
  
  return { data: [], source: 'none' };
}

// Enrich backend real aggregation with other metrics (PR cycle time, code review time, etc.)
function enrich_real_github_by_period(githubByPeriod: any[], metrics: any) {
  const deploymentFreqPerWeek = metrics.deployment_frequency ?? metrics.deployment_metrics?.deployment_frequency ?? 0
  
  return githubByPeriod.map((point) => ({
    period: point.period,
    // Real deployment metrics from backend aggregation
    deploymentFreqPerWeek: point.deploymentFreqPerWeek ?? deploymentFreqPerWeek,
    changeFailureRatePct: point.changeFailureRatePct ?? 0,
    // Fill in other metrics from snapshot if available
    prCycleTimeHours: metrics.leadTime || 24,
    codeReviewTime: metrics.codeReviewTime || 4,
    mergeRate: metrics.mergeRate || 0.7,
    rejectedPRs: metrics.rejectedPRs || 0,
    commentToMergeRatio: metrics.commentToMergeRatio || 2,
    source: 'github-backend-real'
  }))
}

// Convert GitHub snapshot data to time series format (FALLBACK ONLY)
function convertGitHubSnapshotToTimeSeries(metrics: any, granularity: Granularity) {
  if (!metrics) return []
  
  const deploymentFreqPerWeek = metrics.deployment_frequency ?? metrics.deployment_metrics?.deployment_frequency ?? metrics.stale_deployment_signal ?? metrics.deploymentFrequency ?? 0
  const changeFailureRateRaw = metrics.change_failure_rate ?? metrics.deployment_metrics?.change_failure_rate ?? metrics.changeFailureRate ?? 0
  const changeFailureRatePct = typeof changeFailureRateRaw === 'number' && changeFailureRateRaw > 0 && changeFailureRateRaw <= 1
    ? changeFailureRateRaw * 100
    : changeFailureRateRaw

  const periods = generatePeriods(granularity, 8)
  return periods.map((period, index) => ({
    period,
    prCycleTimeHours: metrics.leadTime || 24 + Math.random() * 48,
    codeReviewTime: metrics.codeReviewTime || 4 + Math.random() * 8,
    deploymentFreqPerWeek,
    changeFailureRatePct,
    mergeRate: metrics.mergeRate || 0.7 + Math.random() * 0.3,
    rejectedPRs: metrics.rejectedPRs || Math.floor(Math.random() * 3),
    commentToMergeRatio: metrics.commentToMergeRatio || 2 + Math.random() * 3,
    source: 'github-snapshot-fallback'
  }))
}

// Generate time periods for the given granularity
function generatePeriods(granularity: Granularity, count: number) {
  const periods = []
  const now = new Date()
  
  for (let i = 0; i < count; i++) {
    const date = new Date(now)
    switch (granularity) {
      case 'hour':
        date.setHours(date.getHours() - i)
        periods.push(date.toISOString().slice(0, 13) + ':00:00')
        break
      case 'day':
        date.setDate(date.getDate() - i)
        periods.push(date.toISOString().slice(0, 10))
        break
      case 'week':
        date.setDate(date.getDate() - (i * 7))
        periods.push(date.toISOString().slice(0, 10))
        break
      case 'month':
        date.setMonth(date.getMonth() - i)
        periods.push(date.toISOString().slice(0, 7))
        break
      case 'quarter':
        date.setMonth(date.getMonth() - (i * 3))
        periods.push(date.toISOString().slice(0, 7))
        break
      default:
        periods.push(`period-${i}`)
    }
  }
  
  return periods.reverse()
}

// Productivity resolver - works with actual store structure  
export function resolveProductivityByGranularity(store: AnyObj, g: Granularity) {
  // The metrics store has productivityTrends with time series data
  // Map granularity to the correct time series key
  const granularityMap: Record<Granularity, string> = {
    'hour': 'daily', // Use daily as closest to hourly
    'day': 'daily',
    'week': 'weekly', 
    'month': 'monthly',
    'quarter': 'monthly', // Use monthly as closest to quarterly
    'custom': 'weekly' // Default to weekly for custom ranges
  };
  
  const timeSeriesKey = granularityMap[g] || 'weekly';
  console.log('🔍 Resolver: Looking for productivityTrends.' + timeSeriesKey)
  
  const timeSeriesData = read(store, `productivityTrends.${timeSeriesKey}`);
  console.log('🔍 Resolver: Productivity time series data:', timeSeriesData)
  
  if (Array.isArray(timeSeriesData) && timeSeriesData.length > 0) {
    return { data: timeSeriesData, source: `productivityTrends.${timeSeriesKey}` };
  }
  
  // If no time series data, generate fallback data
  console.log('🔍 Resolver: No productivity time series data, generating fallback')
  const fallbackData = generateProductivityFallbackData(g)
  return { data: fallbackData, source: 'fallback-generated' };
}

// Generate fallback productivity data
function generateProductivityFallbackData(granularity: Granularity) {
  const periods = generatePeriods(granularity, 8)
  // 🔥 P0: Use canonical workflow universe constant
  const tools = [...CANONICAL_REAL_WORKFLOWS]

  return periods.flatMap(period =>
    tools.map(tool => ({
      period,
      tool,
      AI_suggestions_accepted: 20 + Math.random() * 80,
      AI_usage_duration_minutes: 60 + Math.random() * 120,
      aiAssists: 20 + Math.random() * 80,
      codingMinutes: 60 + Math.random() * 120,
      source: 'fallback'
    }))
  )
}

// Wrap existing resolvers with rollup capability
export function resolveGithubByGranularityWithRollup(store: any, g: Granularity) {
  const base = resolveGithubByGranularity(store, g) // your existing
  if (g === 'week' && (!base.data || base.data.length === 0)) {
    // Try rolling from daily if present
    const daily = resolveGithubByGranularity(store, 'day')
    if (Array.isArray(daily.data) && daily.data.length) {
      const rolled = rollupEngToWeeks(daily.data)
      if (import.meta.env.VITE_FEATURE_PERF_INSIGHTS === '1') {
        console.info('[perf-insights][resolver] GH rolled-up from daily → week:', rolled.length)
      }
      return { data: rolled, source: 'rolled-up-daily' }
    }
  }
  return base
}

export function resolveProductivityByGranularityWithRollup(store: any, g: Granularity) {
  const base = resolveProductivityByGranularity(store, g) // your existing
  if (g === 'week' && (!base.data || base.data.length === 0)) {
    const daily = resolveProductivityByGranularity(store, 'day')
    if (Array.isArray(daily.data) && daily.data.length) {
      const rolled = rollupProdToWeeks(daily.data)
      if (import.meta.env.VITE_FEATURE_PERF_INSIGHTS === '1') {
        console.info('[perf-insights][resolver] PROD rolled-up from daily → week:', rolled.length)
      }
      return { data: rolled, source: 'rolled-up-daily' }
    }
  }
  return base
}
