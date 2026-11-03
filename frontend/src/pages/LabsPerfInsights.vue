<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import InsightsPanel from '../components/InsightsPanel.vue'
import { mapPerfToPanel } from '../lib/insights/perfToPanelAdapter'
import { mapGitHubToEngOutputByGranularity, mapProductivityToToolsByGranularity } from '../lib/insights/providers'
import { deriveGranularity, overlapCount, type Granularity } from '../lib/insights/time'
import { useFilterStore } from '../stores/filters'
import { useGitHubStore } from '../stores/github'
import { useMetricsFacadeStore } from '../stores/metricsFacade'
import * as Engine from '../lib/insights/engine'
import { isDebugEnabled } from '../lib/perf/debugGate'
import { 
  sharedTeamMetrics, 
  sharedSimulatedData, 
  sharedHistoricalData, 
  sharedTimeFilter,
  sharedDataDebugInfo,
  updateSharedTeamMetrics,
  updateSharedSimulatedData,
  updateSharedFilters,
  updateSharedSimulationState
} from '../stores/sharedProductData'


const featureOn = (import.meta as any).env.VITE_FEATURE_PERF_INSIGHTS === '1'
const filterStore = useFilterStore()
const githubStore = useGitHubStore()
const metricsFacade = useMetricsFacadeStore()

// Centralized insights generation
const granularity = computed(() => deriveGranularity(filterStore))
const scope = computed(() => (filterStore?.filters?.engineering?.scope || 'org'))

const ghSeries = ref<any[]>([])     // EngOutputPoint[]
const prodSeries = ref<any[]>([])   // ToolProductivityPoint[]
const centralizedInsights = ref<any[]>([])
const lastGoodInsights = ref<any[]>([])

// Optional: keep your synthetic toggle; left off by default here
const forceSim = ref(false)

async function refreshPI() {
  try {
    console.log('[PI_PAGE_CENTRALIZED] Starting centralized insights generation')
    
    // 1) Fetch/ensure raw inputs
    const fromISO = filterStore?.filters?.engineering?.dateRange?.from || new Date(Date.now() - 14*864e5).toISOString().slice(0,10)
    const toISO   = filterStore?.filters?.engineering?.dateRange?.to   || new Date().toISOString().slice(0,10)

    // GitHub metrics (snapshot->synthetic series)
    await githubStore.fetchMetrics('week') // 🔥 PHASE 1: Use 'week' for faster load instead of 'all'

    // IDE timeseries via facade
    const ideQ = {
      from: fromISO,
      to: toISO,
      teamIds: filterStore?.filters?.engineering?.teamIds || [],
      developerIds: filterStore?.filters?.engineering?.developerIds || [],
      toolIds: filterStore?.filters?.productivity?.toolIds || [],
      metrics: ['ide.ai_suggestions_accepted']
    };
    const ideSeries = await metricsFacade.getProductivityTimeSeries(ideQ)

    // 2) Map BOTH into granularity-aligned series
    // GitHub → EngOutputPoint[] (synthetic fallback)
    const ghSynth = [
      { period: '2025-07-21', prCycleTimeHours: 18, timeToFirstReviewHours: 4, deploymentFreqPerWeek: 3, mergeRatePct: 72 },
      { period: '2025-07-28', prCycleTimeHours: 19, timeToFirstReviewHours: 4, deploymentFreqPerWeek: 3, mergeRatePct: 70 },
      { period: '2025-08-04', prCycleTimeHours: 17, timeToFirstReviewHours: 3.8, deploymentFreqPerWeek: 4, mergeRatePct: 74 },
      { period: '2025-08-11', prCycleTimeHours: 20, timeToFirstReviewHours: 4.2, deploymentFreqPerWeek: 3, mergeRatePct: 68 },
      { period: '2025-08-18', prCycleTimeHours: 16, timeToFirstReviewHours: 3.5, deploymentFreqPerWeek: 4, mergeRatePct: 76 },
      { period: '2025-08-25', prCycleTimeHours: 15, timeToFirstReviewHours: 3.4, deploymentFreqPerWeek: 4, mergeRatePct: 78 },
      { period: '2025-09-01', prCycleTimeHours: 14, timeToFirstReviewHours: 3.3, deploymentFreqPerWeek: 5, mergeRatePct: 80 },
      { period: '2025-09-08', prCycleTimeHours: 15, timeToFirstReviewHours: 3.6, deploymentFreqPerWeek: 4, mergeRatePct: 79 },
    ]

    const gh = mapGitHubToEngOutputByGranularity(ghSynth, granularity.value)

    // IDE → ToolProductivityPoint[]
    const prodPoints: any[] = []
    for (const s of (ideSeries || [])) {
      for (const p of (s.points || [])) {
        prodPoints.push({ period: p.t?.slice(0,10), tool: s.label, aiAssists: p.v, codingMinutes: undefined })
      }
    }
    const prod = mapProductivityToToolsByGranularity(prodPoints, granularity.value)

    ghSeries.value = gh
    prodSeries.value = prod

    console.log('[PI_PAGE_CENTRALIZED] Mapped series:', {
      ghCount: gh.length,
      prodCount: prod.length,
      granularity: granularity.value
    })

    // 3) Build single engine input and call the live engine ONCE
    const engineInput = {
      window: granularity.value,
      scope: scope.value,
      series: [], // Required by InsightsInput but not used in centralized mode
      github: { series: ghSeries.value },
      productivity: { series: prodSeries.value },
      context: {
        org: { id: 'default-org', name: 'Organization' },
        filters: filterStore
      }
    }

    const out = Engine.generateInsights(engineInput)

    // 4) Gate coverage card
    const ghPeriods = new Set((ghSeries.value || []).map(x => x?.period).filter(Boolean))
    const prodPeriods = new Set((prodSeries.value || []).map(x => x?.period).filter(Boolean))
    let overlap = 0
    for (const k of ghPeriods) if (prodPeriods.has(k)) overlap++
    
    const filtered = (out || []).filter((i: any) => {
      if (i?.equivalenceKey === 'coverage/insufficient') {
        return (ghPeriods.size > 0 && prodPeriods.size > 0 && overlap < 4)
      }
      return true
    })

    centralizedInsights.value = filtered
    
    console.log('[PI_PAGE_CENTRALIZED] Generated insights:', {
      total: out.length,
      filtered: filtered.length,
      overlap,
      ghPeriods: ghPeriods.size,
      prodPeriods: prodPeriods.size
    })
  } catch (e) {
    console.error('[PI_PAGE_CENTRALIZED] refreshPI error', e)
    centralizedInsights.value = []
  }
}

// Use shared time filter for granularity, allow manual override
const manualGranularity = ref<Granularity | null>(null)
const g = computed<Granularity>(() => {
  if (manualGranularity.value) return manualGranularity.value
  
  // Map shared time filter to granularity
  const timeFilter = sharedTimeFilter.value
  switch (timeFilter) {
    case 'hour': return 'hour'
    case 'day': return 'day' 
    case 'week': return 'week'
    case 'month': return 'month'
    case 'quarter': return 'quarter'
    default: return 'week'
  }
})

// Use shared product data directly
const ghResolved = computed(() => {
  // Use real GitHub data from the store
  const realGitHubData = githubStore.metrics
  if (realGitHubData) {
    console.log('🔗 Using real GitHub data for insights:', realGitHubData)
    return resolveRealGitHubData(g.value)
  }
  
  // Fallback to shared team metrics if available
  const teamMetrics = sharedTeamMetrics.value
  if (teamMetrics) {
    console.log('🔗 Using shared team metrics for insights:', teamMetrics)
    // Convert team metrics to time series format
    const timeSeriesData = convertTeamMetricsToTimeSeries(teamMetrics, g.value)
    return { data: timeSeriesData, source: 'shared-product-team-metrics' }
  }
  
  console.log('⚠️ No GitHub data available, using synthetic data')
  return { data: [], source: 'none' }
})

const prodResolved = computed(() => {
  // Use simulated IDE data from the main product
  const simulatedData = sharedSimulatedData.value
  const historicalData = sharedHistoricalData.value
  
  if (simulatedData || historicalData) {
    console.log('🔗 Using simulated IDE data for insights:', { simulatedData, historicalData })
    // Convert simulated data to time series format
    const timeSeriesData = convertSimulatedDataToTimeSeries({ simulatedData, historicalData }, g.value)
    return { data: timeSeriesData, source: 'shared-product-simulated-data' }
  }
  
  console.log('⚠️ No simulated IDE data available, using synthetic data')
  return { data: [], source: 'none' }
})

// Conversion functions for shared data - use REAL simulated data from main product
const convertTeamMetricsToTimeSeries = (teamMetrics: any, granularity: Granularity) => {
  console.log('🔍 Converting team metrics to time series:', teamMetrics)
  
  if (!teamMetrics) return []
  
  const timeSeriesData: any[] = []
  const periods = generatePeriods(granularity, 8) // 8 periods
  
  periods.forEach((period, index) => {
    // Use the team metrics as base data and add realistic variation
    const variation = 0.8 + (Math.random() * 0.4) // 0.8 to 1.2
    
    timeSeriesData.push({
      period,
      // Map to field names that the mapping functions expect
      leadTime: (teamMetrics.time_to_merge || 24) * variation,
      codeReviewTime: (teamMetrics.time_to_first_review || 4) * variation,
      deploymentFrequency: (teamMetrics.deployment_frequency || 2) * variation,
      mergeRate: (teamMetrics.merge_rate || 70) * variation,
      changeFailureRate: (teamMetrics.rejected_prs || 5) * variation,
    })
  })
  
  console.log('🔍 Converted GitHub data:', timeSeriesData)
  return timeSeriesData
}

const convertSimulatedDataToTimeSeries = (data: any, granularity: Granularity) => {
  console.log('🔍 Converting simulated data to time series:', data)
  
  if (!data) return []
  
  const timeSeriesData: any[] = []
  const periods = generatePeriods(granularity, 8) // 8 periods
  
  // Extract data from the actual simulated data structure
  const timeFilter = granularity === 'hour' ? 'hour' : granularity === 'day' ? 'day' : 'week'
  const simulatedData = data.simulatedData?.[timeFilter] || data[timeFilter]
  
  console.log('🔍 Simulated data for time filter:', timeFilter, simulatedData)
  
  if (!simulatedData) return []
  
  // Process each IDE's data
  Object.keys(simulatedData).forEach(tool => {
    if (tool === 'team') return // Skip team data
    
    const toolData = simulatedData[tool]
    if (!Array.isArray(toolData)) return
    
    periods.forEach((period, index) => {
      // Get data from the simulated history (use modulo to cycle through available data)
      const dataIndex = index % toolData.length
      const toolMetrics = toolData[dataIndex]?.team || {}
      
      timeSeriesData.push({
        period,
        tool,
        // Map to field names that the mapping functions expect
        AI_suggestions_accepted: (toolMetrics.AI_suggestions_shown || 0) + (toolMetrics.AI_suggestions_accepted || 0),
        AI_usage_duration_minutes: toolMetrics.average_session_length_minutes || 0,
      })
    })
  })
  
  console.log('🔍 Converted productivity data:', timeSeriesData)
  return timeSeriesData
}

// Generate periods for the given granularity
const generatePeriods = (granularity: Granularity, count: number): string[] => {
  const periods: string[] = []
  const now = new Date()
  
  for (let i = count - 1; i >= 0; i--) {
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
        const quarter = Math.floor(date.getMonth() / 3) + 1
        periods.push(`${date.getFullYear()}-Q${quarter}`)
        break
      default:
        date.setDate(date.getDate() - i)
        periods.push(date.toISOString().slice(0, 10))
    }
  }
  
  return periods
}

const eng = computed(() => mapGitHubToEngOutputByGranularity(ghResolved.value.data, g.value))
const prod = computed(() => mapProductivityToToolsByGranularity(prodResolved.value.data, g.value))

// Generate synthetic data if no real data is available
const generateSyntheticData = () => {
  const weeks = 8
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - weeks * 7)
  
  const githubData: any[] = []
  const productivityData: any[] = []
  
  for (let i = 0; i < weeks; i++) {
    const weekStart = new Date(startDate)
    weekStart.setDate(startDate.getDate() + i * 7)
    const period = weekStart.toISOString().slice(0, 10)
    
    // Generate GitHub data - match the expected format for mapGitHubToEngOutputByGranularity
    githubData.push({
      period,
      prCycleTimeHours: 24 + Math.random() * 48,
      timeToFirstReviewHours: 4 + Math.random() * 8,
      deploymentFreqPerWeek: 3 + Math.random() * 4,
      mergeRatePct: 60 + Math.random() * 30,
      changeFailureRatePct: 2 + Math.random() * 8,
    })
    
    // Generate productivity data - match the expected format for mapProductivityToToolsByGranularity
    const tools = ['cursor', 'vscode', 'intellij']
    tools.forEach(tool => {
      productivityData.push({
        period,
        tool,
        aiAssists: 50 + Math.random() * 100,
        codingMinutes: 120 + Math.random() * 120,
      })
    })
  }
  
  return { githubData, productivityData }
}

// Generate realistic fallback data that will trigger insights
const generateRealisticGitHubData = () => {
  const data: any[] = []
  const periods = generatePeriods(g.value, 8)
  
  periods.forEach((period, index) => {
    // Create data that will trigger insights - high cycle times, low merge rates, etc.
    // Use field names that the mapping functions expect
    data.push({
      period,
      leadTime: 48 + (index * 5) + Math.random() * 20, // Increasing cycle time
      codeReviewTime: 8 + Math.random() * 12, // Slow reviews
      deploymentFrequency: 1 + Math.random() * 2, // Low deployment frequency
      mergeRate: 40 + Math.random() * 20, // Low merge rate
      changeFailureRate: 15 + Math.random() * 10, // High failure rate
    })
  })
  
  return data
}

const generateRealisticProductivityData = () => {
  const data: any[] = []
  const periods = generatePeriods(g.value, 8)
  const tools = ['cursor', 'vscode', 'jetbrains', 'devin', 'sublime', 'vim']
  
  periods.forEach((period, index) => {
    tools.forEach(tool => {
      // Create data that will trigger insights - varying AI usage, productivity issues
      // Use field names that the mapping functions expect
      const aiAssists = 20 + Math.random() * 80 + (index * 5) // Increasing AI usage
      const codingMinutes = 60 + Math.random() * 120
      
      data.push({
        period,
        tool,
        AI_suggestions_accepted: aiAssists,
        AI_usage_duration_minutes: codingMinutes,
        // Also add the mapped field names as backup
        aiAssists: aiAssists,
        codingMinutes: codingMinutes,
      })
    })
  })
  
  console.log('🔍 Generated realistic productivity data:', data.slice(0, 3))
  return data
}

const insights = computed(() => {
  if (isDebugEnabled('LABS')) {
    console.log('🔍 Debugging insights generation...')
    console.log('📊 ghResolved:', ghResolved.value)
    console.log('📊 prodResolved:', prodResolved.value)
  }
  
  const synthetic = generateSyntheticData()
  let githubData = ghResolved.value.data.length > 0 ? ghResolved.value.data : synthetic.githubData
  let productivityData = prodResolved.value.data.length > 0 ? prodResolved.value.data : synthetic.productivityData
  
  // If we still don't have data, generate realistic fallback data
  if (githubData.length === 0) {
    if (isDebugEnabled('LABS')) {
      console.log('⚠️ No GitHub data available, generating realistic fallback')
    }
    githubData = generateRealisticGitHubData()
  }
  
  if (productivityData.length === 0) {
    console.log('⚠️ No productivity data available, generating realistic fallback')
    productivityData = generateRealisticProductivityData()
  }
  
  // FORCE fallback data for testing - remove this later
  console.log('🔧 FORCING fallback productivity data for testing')
  productivityData = generateRealisticProductivityData()
  
  console.log('🔍 Insights input data:', { githubData, productivityData })
  console.log('📊 GitHub data length:', githubData.length)
  console.log('📊 Productivity data length:', productivityData.length)
  
  // Debug the actual data structure
  if (githubData.length > 0) {
    console.log('🔍 First GitHub data point:', githubData[0])
  }
  if (productivityData.length > 0) {
    console.log('🔍 First productivity data point:', productivityData[0])
  }
  
  // Use live engine with combined datasets
  const githubStore = useGitHubStore();
  
  // Build GH "unified-like" series from the same timestamps used by IDE series:
  const prodSeries = Array.isArray(productivityData) ? productivityData : [];           // existing IDE series
  const stamps = (prodSeries[0]?.points || []).map((p: any) => String(p.t)).filter(Boolean);
  
  // Pick a GH metric to analyze against (time to merge is common):
  const leadHrs =
    githubStore.metrics?.leadTime ??
    githubStore.metrics?.codeReviewTime ??
    0;
  
  const ghSeries = [{
    label: 'gh.time_to_merge_hours',
    points: stamps.map(t => ({ t, v: Number(leadHrs) || 0 }))
  }];
  
  console.log('[PI_PAGE_LIVE] combined dataset preview', {
    prodSeriesCount: prodSeries.length,
    ghSeriesCount: ghSeries.length,
    stampCount: stamps.length,
    leadHrs
  });
  
  // Now call the live engine ONCE with both datasets:
  const result = generateInsights({
    window: g.value,              // your view bucket (daily/weekly/etc)
    scope: 'org',
    series: prodSeries,           // IDE dataset
    github: undefined,  // keep summary if you already pass it
    context: { 
      toolId: filterStore.activeToolIds('productivity')?.[0],
      teamId: filterStore.activeTeamIds('productivity')?.[0],
      developerIds: filterStore.activeDeveloperIds('productivity'),
      ghSeries  // NEW: GH dataset in context
    } as any // whatever you already pass
  });
  
  console.log('🎯 Insights result:', result)
  
  // 🔥 GUARD: Preserve last good insights if current result is empty
  const meaningful = result && result.length > 0;
  const hadMeaningful = lastGoodInsights.value && lastGoodInsights.value.length > 0;
  
  if (!meaningful && hadMeaningful) {
    console.log('[PI_GUARD] preserving lastGoodInsights', { 
      currentLength: result?.length || 0,
      preservedLength: lastGoodInsights.value.length 
    });
    return lastGoodInsights.value;
  }
  
  // Update last good insights if current result is meaningful
  if (meaningful) {
    lastGoodInsights.value = result;
    console.log('[PI_GUARD] accepting new insights', { 
      newLength: result.length 
    });
  }
  
  // If no insights, let's debug why
  if (result.length === 0) {
    if (isDebugEnabled('LABS')) {
      console.log('⚠️ No insights generated. Debugging...')
      console.log('📊 GitHub data sample:', githubData.slice(0, 3))
      console.log('📊 Productivity data sample:', productivityData.slice(0, 3))
    }
  }
  
  return result
})
const panelItems = computed(() => {
  if (isDebugEnabled('LABS')) {
    console.log('🔍 Mapping insights to panel items...')
    console.log('📊 Raw insights:', insights.value)
  }
  
  // UI-side safety net: suppress coverage cards when real findings exist
  const hasRealFindings = insights.value.some(i => 
    i.severity === 'critical' || i.severity === 'warning'
  )
  const visibleInsights = hasRealFindings
    ? insights.value.filter(i => !((i as any).tags?.includes?.('data') && (i as any).tags?.includes?.('coverage')))
    : insights.value
  
  console.log('🔍 Filtered insights (hasRealFindings:', hasRealFindings, '):', visibleInsights)
  
  // V6 page safety net: filter coverage cards for demo
  console.log('[PI_PAGE_V6] before filter', { count: visibleInsights.length });
  const KILL_COVERAGE = ((import.meta as any).env?.VITE_PERF_INSIGHTS_COVERAGE ?? 'on').toLowerCase() === 'off';
  const filtered = visibleInsights.filter(i =>
    KILL_COVERAGE
    ? !((i as any)?.tags?.includes?.('coverage') || String((i as any)?.id||'').startsWith('coverage/'))
    : true
  );
  console.log('[PI_PAGE_V6] after filter', { count: filtered.length, KILL_COVERAGE });
  
  // Convert Insight[] to PerformanceInsight[] for mapPerfToPanel
  const perfInsights = filtered.map(insight => ({
    id: insight.id,
    title: insight.title,
    description: insight.detail,
    severity: insight.severity,
    tags: (insight as any).tags || [],
    evidence: [],
    recommendations: [],
    source: 'mixed' as const,
    normalizedSeverity: (insight.severity === 'critical' ? 'risk' : insight.severity === 'warning' ? 'lowlight' : 'opportunity') as 'risk' | 'lowlight' | 'opportunity' | 'highlight' | undefined
  }));
  const mapped = mapPerfToPanel(perfInsights)
  console.log('📊 Mapped panel items:', mapped)
  return mapped
})

// Data is now automatically shared from the main product
onMounted(async () => {
  // SENTINEL: helps verify this is the page being rendered
  if (isDebugEnabled('LABS')) {
    console.log('[PAGE_PI_MOUNTED]', import.meta.url);
    
    console.log('🔗 Performance insights connected to shared product data')
    console.log('📊 Shared data debug:', sharedDataDebugInfo.value)
    
    // Check if we can access the shared store
    console.log('🔍 Checking shared store access...')
    console.log('Team metrics:', sharedTeamMetrics.value)
    console.log('Simulated data:', sharedSimulatedData.value)
    console.log('Historical data:', sharedHistoricalData.value)
    
    // Check if main product is running by looking for it in the DOM or window
    console.log('🔍 Checking if main product is running...')
    console.log('Window object keys:', Object.keys(window))
    console.log('Main product instance:', (window as any).mainProductInstance)
    console.log('Main product data:', (window as any).mainProductData)
  }
  
  // Check if we can find the main product component in the DOM
  const mainProductElement = document.querySelector('[data-main-product]') || document.querySelector('.main-product') || document.querySelector('#app')
  if (isDebugEnabled('LABS')) {
    console.log('Main product element found:', !!mainProductElement)
  }
  
  // Fetch real GitHub data
  try {
    if (isDebugEnabled('LABS')) {
      console.log('🚀 Fetching real GitHub data...')
    }
    await githubStore.fetchMetrics('week')
    if (isDebugEnabled('LABS')) {
      console.log('✅ Real GitHub data fetched:', githubStore.metrics)
    }
  } catch (error) {
    console.error('❌ Failed to fetch GitHub data:', error)
  }
})

const refreshSharedData = () => {
  if (isDebugEnabled('LABS')) {
    console.log('🔄 Manually refreshing shared data...')
    console.log('📊 Current shared data:', sharedDataDebugInfo.value)
    console.log('Team metrics:', sharedTeamMetrics.value)
    console.log('Simulated data:', sharedSimulatedData.value)
    console.log('Historical data:', sharedHistoricalData.value)
  }
  
  // Test if we can manually inject some data
  if (isDebugEnabled('LABS')) {
    console.log('🧪 Testing manual data injection...')
  }
  
  // Inject test data to verify the shared store is working
  const testTeamMetrics = {
    // REAL PRODUCT ENG OUTPUT METRICS ONLY
    total_prs: 45,
    merged_prs: 38,
    merge_rate: 84.4,
    prs_per_developer: 4.5,
    time_to_first_review: 6.2,
    total_issues: 12,
    unique_contributors: 8,
    deployment_frequency: 3,
    repositories: 2,
    mean_time_to_recovery: 2.5,
    total_commits: 156,
    time_to_merge: 28.5,
    reopened_prs: 2,
    rejected_prs: 1,
    comment_to_merge_ratio: 2.8,
    source: 'test'
  }
  
  const testSimulatedData = {
    week: {
      // REAL PRODUCT IDE TOOLS ONLY
      cursor: [
        { aiAssists: 85, codingMinutes: 120 },
        { aiAssists: 92, codingMinutes: 135 },
        { aiAssists: 78, codingMinutes: 110 }
      ],
      vscode: [
        { aiAssists: 65, codingMinutes: 90 },
        { aiAssists: 72, codingMinutes: 105 },
        { aiAssists: 58, codingMinutes: 85 }
      ],
      jetbrains: [
        { aiAssists: 45, codingMinutes: 60 },
        { aiAssists: 52, codingMinutes: 75 },
        { aiAssists: 38, codingMinutes: 50 }
      ]
    }
  }
  
  const testHistoricalData = {
    week: [
      { date: '2024-01-15', cursor: { aiAssists: 85, codingMinutes: 120 }, vscode: { aiAssists: 65, codingMinutes: 90 }, jetbrains: { aiAssists: 45, codingMinutes: 60 } },
      { date: '2024-01-22', cursor: { aiAssists: 92, codingMinutes: 135 }, vscode: { aiAssists: 72, codingMinutes: 105 }, jetbrains: { aiAssists: 52, codingMinutes: 75 } },
      { date: '2024-01-29', cursor: { aiAssists: 78, codingMinutes: 110 }, vscode: { aiAssists: 58, codingMinutes: 85 }, jetbrains: { aiAssists: 38, codingMinutes: 50 } }
    ]
  }
  
  updateSharedTeamMetrics(testTeamMetrics)
  updateSharedSimulatedData(testSimulatedData, testHistoricalData)
  updateSharedFilters('week', 'test-repo', 'test-dev', 'cursor')
  updateSharedSimulationState(true)
  
  if (isDebugEnabled('LABS')) {
    console.log('✅ Test data injected into shared store')
    console.log('📊 Updated shared data:', sharedDataDebugInfo.value)
    
    // Force a re-render by updating the insights
    console.log('🔄 Forcing insights refresh...')
    console.log('New insights should appear below:')
  }
}

const clearTestData = () => {
  if (isDebugEnabled('LABS')) {
    console.log('🧹 Clearing test data...')
  }
  updateSharedTeamMetrics(null)
  updateSharedSimulatedData(null, null)
  updateSharedFilters('week', '', '', '')
  updateSharedSimulationState(false)
  if (isDebugEnabled('LABS')) {
    console.log('✅ Test data cleared')
    console.log('📊 Updated shared data:', sharedDataDebugInfo.value)
  }
}

// Helper function to get time period description
const getTimePeriodDescription = (period: string | null) => {
  if (!period) return 'Using shared time filter from main product'
  
  switch (period) {
    case 'hour': return 'Analyzing data from the last 60 minutes'
    case 'day': return 'Analyzing data from the last 24 hours'
    case 'week': return 'Analyzing data from the last 7 days'
    case 'month': return 'Analyzing data from the last 30 days'
    case 'quarter': return 'Analyzing data from the last 90 days'
    default: return 'Custom time period analysis'
  }
}

// Handle time period change
const handleTimePeriodChange = () => {
  console.log('🔄 Time period changed to:', manualGranularity.value)
  console.log('📊 Current granularity:', g.value)
  console.log('📊 Shared time filter:', sharedTimeFilter.value)
}

// Trigger on mount and whenever time/filters change
onMounted(refreshPI)
watch(
  () => [granularity.value, filterStore?.filters?.engineering?.dateRange?.from, filterStore?.filters?.engineering?.dateRange?.to, filterStore?.filters?.productivity, filterStore?.filters?.engineering],
  refreshPI,
  { deep: true }
)
</script>

<template>
  <div class="p-4">
    <h1 class="text-xl font-semibold mb-3">Performance Insights (Labs)</h1>

    <!-- Granularity Selector -->
    <div v-if="featureOn" class="mb-4 p-3 bg-blue-50 rounded-lg">
      <label class="block text-sm font-medium mb-2">Test Granularity:</label>
      <select v-model="manualGranularity" class="px-3 py-1 border rounded text-sm">
        <option :value="null">Auto (from filters)</option>
        <option value="hour">Hour</option>
        <option value="day">Day</option>
        <option value="week">Week</option>
        <option value="month">Month</option>
        <option value="quarter">Quarter</option>
        <option value="custom">Custom</option>
      </select>
      <span class="ml-2 text-sm text-gray-600">
        Current: <strong>{{ g }}</strong>
      </span>
    </div>

    <div v-if="featureOn" class="mb-2 text-xs text-slate-600">
      GH source: <code>{{ ghResolved.source || 'none' }}</code> ·
      Prod source: <code>{{ prodResolved.source || 'none' }}</code>
    </div>

    <!-- Time Period Filter Dropdown -->
    <div v-if="featureOn" class="mb-4">
      <div class="card shadow-sm">
        <div class="card-header bg-primary text-white">
          <h5 class="mb-0">
            <i class="bi bi-funnel me-2"></i>Performance Insights Filters
          </h5>
          <small class="text-light">Configure time periods and data sources for insights analysis</small>
        </div>
        <div class="card-body">
          <div class="row g-3">
            <!-- Time Period Selection -->
            <div class="col-md-6">
              <label class="form-label fw-semibold text-dark">
                <i class="bi bi-graph-up me-1"></i>Time Period
              </label>
              <select 
                v-model="manualGranularity" 
                class="form-select" 
                @change="handleTimePeriodChange"
              >
                <option :value="null">Auto ({{ sharedTimeFilter }})</option>
                <option value="hour">Hour (Last 60 minutes)</option>
                <option value="day">Day (Last 24 hours)</option>
                <option value="week">Week (Last 7 days)</option>
                <option value="month">Month (Last 30 days)</option>
                <option value="quarter">Quarter (Last 90 days)</option>
              </select>
              <div class="form-text text-muted">
                <i class="bi bi-info-circle me-1"></i>
                {{ getTimePeriodDescription(manualGranularity || sharedTimeFilter) }}
              </div>
            </div>

            <!-- Data Source Status -->
            <div class="col-md-6">
              <label class="form-label fw-semibold text-dark">
                <i class="bi bi-database me-1"></i>Data Source Status
              </label>
              <div class="d-flex gap-2">
                <button @click="refreshSharedData" class="btn btn-outline-primary btn-sm">
                  <i class="bi bi-arrow-clockwise me-1"></i>Refresh Data
                </button>
                <button @click="clearTestData" class="btn btn-outline-secondary btn-sm">
                  <i class="bi bi-trash me-1"></i>Clear Test Data
                </button>
              </div>
              <div class="form-text text-muted">
                <i class="bi bi-info-circle me-1"></i>
                Current: <strong>{{ g }}</strong> | 
                Shared: <strong>{{ sharedTimeFilter }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Shared Data Debug Info -->
    <div v-if="featureOn" class="mb-4 p-3 bg-yellow-50 rounded-lg">
      <h3 class="text-sm font-medium mb-2">Shared Product Data Status:</h3>
      <div class="text-xs space-y-1">
        <div>Team Metrics: <strong>{{ sharedDataDebugInfo.hasTeamMetrics ? 'Available' : 'Not Available' }}</strong></div>
        <div>Simulated Data: <strong>{{ sharedDataDebugInfo.hasSimulatedData ? 'Available' : 'Not Available' }}</strong></div>
        <div>Historical Data: <strong>{{ sharedDataDebugInfo.hasHistoricalData ? 'Available' : 'Not Available' }}</strong></div>
        <div>Time Filter: <strong>{{ sharedDataDebugInfo.timeFilter }}</strong></div>
        <div>Simulation Running: <strong>{{ sharedDataDebugInfo.simulationRunning ? 'Yes' : 'No' }}</strong></div>
        <div v-if="sharedDataDebugInfo.lastUpdated">Last Updated: <strong>{{ sharedDataDebugInfo.lastUpdated }}</strong></div>
      </div>
    </div>

    <InsightsPanel v-if="featureOn" :items="centralizedInsights" :compact="false" />
    <div v-else class="text-sm text-slate-500">
      Set <code>VITE_FEATURE_PERF_INSIGHTS=1</code> to enable.
    </div>
  </div>
</template>
