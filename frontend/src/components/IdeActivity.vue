<template>
  <div class="ide-activity">
    
    <!-- Enhanced Unified Filters with IDE-specific options -->
    <UnifiedFilters 
      :initial-repo="selectedRepo"
      :repositories="repositories"
      :loading="githubStore.loading"
      :show-ide-filter="true"
      :selected-ide="selectedIDE"
      :supported-ides="supportedIDEs"
      @change="handleUnifiedFiltersChange"
      @refresh-repositories="refreshRepositories"
      @ide-change="handleIDEChange"
    />
    
    <!-- IDE Activity Dashboard -->
    <div class="card mb-4 shadow-sm">
      <div class="card-header bg-dark text-white">
        <h5 class="mb-0"><i class="bi bi-activity me-2"></i>IDE Activity Dashboard</h5>
        <small class="text-light">Real-time development metrics across all IDEs</small>
      </div>
      <div class="card-body">
        <!-- Metrics Cards -->
        <div class="row g-3 mb-4">
          <div v-for="metric in ideMetricCards" :key="metric.key" class="col-md-4 col-lg-3">
            <div class="card h-100 border-0 shadow-sm position-relative metric-card">
              <div class="card-body text-center">
                <!-- Performance indicator ribbon -->
                <div v-if="getComparisonData(metric.key)" class="performance-ribbon">
                  <div :class="`ribbon ${calculateTrend(metric.value, getComparisonData(metric.key), metric.key).severity}`">
                    <i :class="`bi ${getTrendIcon(calculateTrend(metric.value, getComparisonData(metric.key), metric.key))}`"></i>
                  </div>
                </div>
                
                <i :class="`bi ${metric.icon} display-4 mb-2 text-dark`"></i>
                <h6 class="card-title text-dark">{{ metric.label }}</h6>
                <h2 class="card-text text-dark">
                  <template v-if="metric.key === 'avgTimeToFirstCommitMinutes'">
                    {{ metric.value }}
                    <small class="text-muted">min</small>
                  </template>
                  <template v-else>
                    {{ isTimeMetric(metric.key) ? formatDuration(metric.value) : metric.value }}
                  </template>
                </h2>
                <p v-if="metric.key === 'avgTimeToFirstCommitMinutes'" class="text-muted small mb-0">
                  <span v-if="metric.value === '--'">
                    No commit data yet
                  </span>
                  <span v-else>
                    avg. minutes to first commit
                  </span>
                </p>
                
                <!-- Enhanced Trend Indicator -->
                <div v-if="getComparisonData(metric.key)" class="trend-indicator mt-2">
                  <div class="d-flex align-items-center justify-content-center">
                    <span 
                      :class="`badge ${getTrendBadgeClass(calculateTrend(metric.value, getComparisonData(metric.key), metric.key))}`"
                      :title="getTrendDescription(metric.key, calculateTrend(metric.value, getComparisonData(metric.key), metric.key))"
                      data-bs-toggle="tooltip"
                      data-bs-placement="top"
                      data-bs-html="true"
                      :data-bs-title="generateTooltipContent(metric.key, metric.value, calculateTrend(metric.value, getComparisonData(metric.key), metric.key))"
                    >
                      <i :class="`bi ${getTrendIcon(calculateTrend(metric.value, getComparisonData(metric.key), metric.key))}`"></i>
                      {{ calculateTrend(metric.value, getComparisonData(metric.key), metric.key).percentage }}%
                    </span>
                  </div>
                </div>
                <!-- No comparison data indicator -->
                <div v-else class="trend-indicator mt-2">
                  <span class="badge bg-secondary text-white" title="No comparison data available">
                    <i class="bi bi-dash"></i>
                    No data
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Productivity Chart -->
        <div class="card border-0 shadow-sm">
          <div class="card-header bg-light">
            <h6 class="mb-0"><i class="bi bi-graph-up me-2"></i>Productivity Trends</h6>
          </div>
          <div class="card-body">
            <div class="row">
              <div class="col-md-6">
                <canvas ref="productivityChart" width="400" height="200"></canvas>
              </div>
              <div class="col-md-6">
                <div class="table-responsive">
                  <table class="table table-sm">
                    <thead>
                      <tr>
                        <th>IDE</th>
                        <th>AI Acceptance Rate</th>
                        <th>Session Length</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="ide in supportedIDEs" :key="ide.id">
                        <td>{{ ide.name }}</td>
                        <td>{{ getMetricValue(ide.id, 'AI_acceptance_rate_percent') }}%</td>
                        <td>{{ getMetricValue(ide.id, 'average_session_length_minutes') }} min</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

  <div v-if="isTelemetryLive" class="mt-4 text-center">
    <button
      @click="sendTestTelemetry"
      :disabled="sending"
      class="btn btn-primary px-4 py-2"
    >
      {{ sending ? 'Sending...' : 'Send Test Telemetry' }}
    </button>
  </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useGitHubStore } from '../stores/github'
import { useMetricsFacadeStore } from '../stores/metricsFacade'
import { useFilterStore } from '../stores/filters'
import { useTimeSeries } from '../composables/useTimeSeries'
import UnifiedFilters from './UnifiedFilters.vue'

const githubStore = useGitHubStore()
const metricsFacadeStore = useMetricsFacadeStore()
const filters = useFilterStore()

// Productivity query for TTFC telemetry (same pattern as ProductivityOverTime.vue)
const productivityQueryForTTFC = computed(() => {
  const query = {
    from: filters.activeDateRange('productivity').from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    to: filters.activeDateRange('productivity').to || new Date().toISOString(),
    repos: filters.activeRepos('productivity') || githubStore.repositories?.map(r => r.name) || [],
    scope: filters.activeScope('productivity') || 'org',
    viewBucket: filters.activeViewBucket('productivity') || 'weekly',
    developerIds: filters.activeDeveloperIds('productivity'),
    teamIds: filters.activeTeamIds('productivity'),
    toolIds: filters.activeToolIds('productivity'),
    // CRITICAL: Use time_to_first_commit_minutes as the metric for TTFC telemetry
    metricId: 'ide.time_to_first_commit_minutes'
  }
  
  console.debug('[IdeActivity] productivityQueryForTTFC constructed:', query)
  return query
})

// Use time series composable for TTFC (same pattern as ProductivityOverTime.vue)
const { data: ttfcTimeSeriesData, isLoading: ttfcLoading } = useTimeSeries(productivityQueryForTTFC)

const telemetryMode = computed<'live' | 'sim'>({
  get: () => metricsFacadeStore.telemetryMode,
  set: (mode) => {
    if (mode === metricsFacadeStore.telemetryMode) {
      return
    }
    metricsFacadeStore.setTelemetryMode(mode)
    const label = mode === 'live' ? 'Live Telemetry' : 'Simulation'
    console.info(`[metricsFacade] Mode: ${label}`)
    void metricsFacadeStore.refreshMetrics(timeFilter.value || 'week')
  }
})

// Reactive data
const selectedIDE = ref('')
const selectedRepo = ref('')
const timeFilter = ref('week')
const comparisonMode = ref('week-over-week')
const simulationRunning = ref(false)
let simulationInterval = null
const sending = ref(false)
const isTelemetryLive = import.meta.env.VITE_CM_TELEMETRY_LIVE === 'true'

async function sendTestTelemetry() {
  if (!isTelemetryLive) return
  sending.value = true

  try {
    const testEvents = [
      { event_type: 'keystroke', count: 10, timestamp: new Date().toISOString() },
      { event_type: 'ai_accept', count: 2 }
    ]

    const { sendLiveTelemetryBatch } = await import('../lib/adapters/ideToUnified')
    if (typeof sendLiveTelemetryBatch !== 'function') {
      throw new Error('sendLiveTelemetryBatch helper is not available')
    }

    const result = await sendLiveTelemetryBatch(testEvents, {
      source: 'cursor',
      userId: 'ide-activity-demo'
    })

    console.info('[IdeActivity] Test telemetry result:', result)
    if (result?.sent) {
      alert('Telemetry sent successfully!')
    } else {
      alert('Telemetry not sent. Check console for details.')
    }
  } catch (error) {
    console.error('[IdeActivity] Failed to send test telemetry:', error)
    alert('Failed to send telemetry. Check console for details.')
  } finally {
    sending.value = false
  }
}

// Use real repositories from GitHub store instead of hardcoded data
const repositories = computed(() => githubStore.repositories || [])

const supportedIDEs = ref([
  { id: 'cursor', name: 'Cursor', icon: 'bi-cursor', color: 'dark', status: 'supported', ssoEnabled: true },
  { id: 'windsurf', name: 'Windsurf', icon: 'bi-wind', color: 'dark', status: 'supported', ssoEnabled: true },
  { id: 'vscode', name: 'VS Code', icon: 'bi-code-square', color: 'dark', status: 'supported', ssoEnabled: true },
  { id: 'jetbrains', name: 'JetBrains IDEs', icon: 'bi-journal-code', color: 'dark', status: 'supported', ssoEnabled: true },
  { id: 'sublime', name: 'Sublime Text', icon: 'bi-file-code', color: 'dark', status: 'supported', ssoEnabled: true },
  { id: 'vim', name: 'Vim/Neovim', icon: 'bi-terminal', color: 'dark', status: 'supported', ssoEnabled: true }
])

// Historical data for comparisons
const simulatedMetricsHistory = ref({
  hour: {},
  day: {},
  week: {},
  month: {}
})

const previousMetrics = ref({})
const historicalSnapshots = ref({
  hour: [],
  day: [],
  week: [],
  month: []
})

// Helper function to generate realistic IDE metrics based on time filter
const generateRealisticIDEMetrics = (timeFilter, ide) => {
  // Base performance characteristics for each IDE
  const performance = {
    cursor: { 
      base: 75, 
      variance: 0.4, 
      trend: 0.02,
      seasonal: 0.15,
      weekly: 0.25,
      daily: 0.3
    },
    windsurf: { 
      base: 65, 
      variance: 0.35, 
      trend: 0.015,
      seasonal: 0.12,
      weekly: 0.2,
      daily: 0.25
    },
    vscode: { 
      base: 55, 
      variance: 0.3, 
      trend: 0.01,
      seasonal: 0.1,
      weekly: 0.18,
      daily: 0.22
    },
    jetbrains: { 
      base: 45, 
      variance: 0.25, 
      trend: 0.008,
      seasonal: 0.08,
      weekly: 0.15,
      daily: 0.2
    },
    sublime: { 
      base: 35, 
      variance: 0.2, 
      trend: 0.005,
      seasonal: 0.06,
      weekly: 0.12,
      daily: 0.18
    },
    vim: { 
      base: 25, 
      variance: 0.15, 
      trend: 0.003,
      seasonal: 0.04,
      weekly: 0.1,
      daily: 0.15
    }
  }
  
  const basePerf = performance[ide] || { base: 50, variance: 0.2, trend: 0.01, seasonal: 0.1, weekly: 0.15, daily: 0.2 }
  
  // Generate a seed based on time filter and IDE for consistent but varied patterns
  const seed = timeFilter.charCodeAt(0) * 1000 + ide.charCodeAt(0) * 100 + ide.charCodeAt(1) * 10
  const seededRandom = (offset = 0) => {
    const x = Math.sin(seed + offset) * 10000
    return x - Math.floor(x)
  }
  
  // Time filter multipliers
  const timeMultipliers = {
    hour: 0.8, // Hourly data shows current activity
    day: 0.9,  // Daily data shows recent performance
    week: 1.0, // Weekly is baseline
    month: 1.1 // Monthly shows slightly better performance
  }
  
  const timeMultiplier = timeMultipliers[timeFilter] || 1.0
  
  // Generate realistic metrics with natural variation
  const generateMetricValue = (metricType, baseValue) => {
    const metricMultipliers = {
      'idle_time_minutes': 0.15,
      'average_session_length_minutes': 0.8,
      'files_edited_per_session': 0.12,
      'commits_per_session': 0.06,
      'time_to_first_commit_minutes': 0.15,
      'AI_suggestions_shown': 1.2,
      'AI_suggestions_accepted': 1.0,
      'AI_acceptance_rate_percent': 0.8,
      'AI_usage_duration_minutes': 0.65,
      'keystrokes_per_minute': 1.5
    }
    
    const multiplier = metricMultipliers[metricType] || 1.0
    const baseMetricValue = baseValue * multiplier * timeMultiplier
    
    // Add realistic variation
    const variation = 0.8 + (seededRandom(metricType.charCodeAt(0) * 100) * 0.4) // 0.8 to 1.2
    const trend = 1.0 + (basePerf.trend * seededRandom(metricType.charCodeAt(1) * 50))
    const seasonal = 1.0 + (basePerf.seasonal * Math.sin(seed * 0.001))
    
    let finalValue = baseMetricValue * variation * trend * seasonal
    
    // Ensure reasonable bounds based on metric type
    if (metricType === 'idle_time_minutes') {
      finalValue = Math.max(1, Math.min(45, finalValue))
    } else if (metricType === 'average_session_length_minutes') {
      finalValue = Math.max(10, Math.min(180, finalValue))
    } else if (metricType === 'files_edited_per_session') {
      finalValue = Math.max(0, Math.min(20, finalValue))
    } else if (metricType === 'commits_per_session') {
      finalValue = Math.max(0, Math.min(12, finalValue))
    } else if (metricType === 'time_to_first_commit_minutes') {
      finalValue = Math.max(2, Math.min(60, finalValue))
    } else if (metricType === 'AI_suggestions_shown') {
      finalValue = Math.max(5, Math.min(150, finalValue))
    } else if (metricType === 'AI_suggestions_accepted') {
      finalValue = Math.max(3, Math.min(120, finalValue))
    } else if (metricType === 'AI_acceptance_rate_percent') {
      finalValue = Math.max(50, Math.min(95, finalValue))
    } else if (metricType === 'AI_usage_duration_minutes') {
      finalValue = Math.max(2, Math.min(90, finalValue))
    } else if (metricType === 'keystrokes_per_minute') {
      finalValue = Math.max(30, Math.min(200, finalValue))
    }
    
    return Math.round(finalValue)
  }
  
  return {
    idle_time_minutes: generateMetricValue('idle_time_minutes', basePerf.base),
    average_session_length_minutes: generateMetricValue('average_session_length_minutes', basePerf.base),
    files_edited_per_session: generateMetricValue('files_edited_per_session', basePerf.base),
    commits_per_session: generateMetricValue('commits_per_session', basePerf.base),
    time_to_first_commit_minutes: generateMetricValue('time_to_first_commit_minutes', basePerf.base),
    AI_suggestions_shown: generateMetricValue('AI_suggestions_shown', basePerf.base),
    AI_suggestions_accepted: generateMetricValue('AI_suggestions_accepted', basePerf.base),
    AI_acceptance_rate_percent: generateMetricValue('AI_acceptance_rate_percent', basePerf.base),
    AI_usage_duration_minutes: generateMetricValue('AI_usage_duration_minutes', basePerf.base),
    keystrokes_per_minute: generateMetricValue('keystrokes_per_minute', basePerf.base)
  }
}

// Complete metrics data structure - generated dynamically for realism
// Legacy ide_metrics removed - use telemetry endpoints instead
const metrics = computed(() => {
  // Note: ide_metrics from /api/metrics is legacy placeholder with no real telemetry correlation
  return {
    // Empty object - component should use telemetry data instead
  }
})

// Legacy filteredMetrics function removed - ide_metrics no longer used
// Note: This component should use telemetry data from /api/telemetry instead
const filteredMetrics = computed(() => {
  // Return empty metrics since ide_metrics is deprecated
  return {}
})

const ideMetricKeys = [
  { key: 'idle_time_minutes', label: 'Idle Time', icon: 'bi-moon', color: 'dark' },
  { key: 'average_session_length_minutes', label: 'Avg Session', icon: 'bi-clock-history', color: 'dark' },
  { key: 'files_edited_per_session', label: 'Files/Session', icon: 'bi-files', color: 'dark' },
  { key: 'commits_per_session', label: 'Commits/Session', icon: 'bi-git', color: 'dark' },
  { key: 'avgTimeToFirstCommitMinutes', label: 'Time to First Commit', icon: 'bi-hourglass-split', color: 'dark' },
  { key: 'AI_suggestions_shown', label: 'AI Suggestions Shown', icon: 'bi-lightbulb', color: 'dark' },
  { key: 'AI_suggestions_accepted', label: 'AI Suggestions Accepted', icon: 'bi-check-circle', color: 'dark' },
  { key: 'AI_acceptance_rate_percent', label: 'AI Acceptance Rate (%)', icon: 'bi-percent', color: 'dark' },
  { key: 'AI_usage_duration_minutes', label: 'AI Usage Duration', icon: 'bi-robot', color: 'dark' }
]

// Computed properties
const ideMetricCards = computed(() => {
  // Filter metrics based on what's selected in the Metrics page
  const selectedMetricIds = metricsFacadeStore.selectedMetrics
  
  console.log('🔍 IdeActivity: Selected metrics from store:', selectedMetricIds)
  
  // Map selected metric IDs to IDE dashboard metric keys
  const metricMapping = {
    'AI_suggestions_accepted': ['AI_suggestions_accepted'],
    'files_edited_per_session': ['files_edited_per_session'],
    'commits_per_session': ['commits_per_session'],
    'average_session_length_minutes': ['average_session_length_minutes'],
    'time_to_first_commit_minutes': ['avgTimeToFirstCommitMinutes'],
    'avgTimeToFirstCommitMinutes': ['avgTimeToFirstCommitMinutes'],
    'AI_usage_duration_minutes': ['AI_usage_duration_minutes'],
    'idle_time_minutes': ['idle_time_minutes'],
    'AI_suggestions_shown': ['AI_suggestions_shown'],
    'AI_acceptance_rate_percent': ['AI_acceptance_rate_percent'],
    'active_coding_time': ['active_coding_time_minutes'], // Map to active coding time (not session length)
    'debugging_time': ['idle_time_minutes'], // Map to idle time for now
    'refactoring_time': ['files_edited_per_session'], // Map to files edited
    'testing_time': ['commits_per_session'], // Map to commits
    'extension_usage': ['AI_usage_duration_minutes'], // Map to AI usage
    'project_switches': ['time_to_first_commit_minutes'], // Map to time to commit
    'terminal_usage': ['idle_time_minutes'], // Map to idle time
    'git_operations': ['commits_per_session'] // Map to commits
  }
  
  // Get all IDE metric keys that should be shown
  const ideMetricsToShow = new Set()
  selectedMetricIds.forEach(selectedId => {
    if (metricMapping[selectedId]) {
      metricMapping[selectedId].forEach(ideKey => {
        ideMetricsToShow.add(ideKey)
      })
    }
  })
  
  console.log('🔍 IdeActivity: IDE metrics to show:', Array.from(ideMetricsToShow))
  console.log('🔍 IdeActivity: Available IDE metric keys:', ideMetricKeys.map(m => m.key))
  
  // Filter metrics based on what's selected in the Metrics page
  const filteredMetrics = ideMetricKeys.filter(metric => 
    ideMetricsToShow.has(metric.key)
  )
  
  console.log('🔍 IdeActivity: Final filtered IDE metrics:', filteredMetrics.map(m => m.key))
  
  return filteredMetrics.map(metric => ({
    ...metric,
    value: getMetricValueForCard(metric.key)
  }))
})

// Helper function to format minutes for TTFC
function formatMinutes(value) {
  if (value == null || isNaN(value)) return '--'
  if (value < 10) {
    return value.toFixed(1) // e.g. 3.5
  }
  return Math.round(value).toString() // e.g. 12
}

// Helper functions
function getMetricValueForCard(metricKey) {
  // CRITICAL: TTFC uses telemetry time series pipeline (same as ProductivityOverTime.vue)
  // This ensures TTFC reads from live telemetry instead of simulation
  if (metricKey === 'avgTimeToFirstCommitMinutes') {
    // Read TTFC from telemetry time series data
    if (ttfcTimeSeriesData.value && Array.isArray(ttfcTimeSeriesData.value)) {
      // Find the series for the selected IDE (or 'vscode' if 'all' is selected)
      const targetToolId = selectedIDE.value || 'vscode'
      const ttfcSeries = ttfcTimeSeriesData.value.find(s => s.label === targetToolId)
      
      if (ttfcSeries && ttfcSeries.points && ttfcSeries.points.length > 0) {
        // CRITICAL: For TTFC, use latest non-null telemetry value (not just latest point)
        // Get all non-null values from the series (which should be telemetry-only for tools with telemetry)
        const rawValues = ttfcSeries.points.map(p => p && typeof p.v === 'number' && p.v != null && !Number.isNaN(p.v) ? p.v : null)
        
        // Keep only actual telemetry values (non-null, non-NaN)
        const telemetryValues = rawValues.filter(v => v != null && !Number.isNaN(v))
        
        console.debug('[IdeActivity] TTFC card computation for tool', targetToolId, {
          rawValues,
          telemetryValues,
          pointCount: ttfcSeries.points.length,
          telemetryCount: telemetryValues.length
        })
        
        if (telemetryValues.length > 0) {
          // Use latest value in range (chronologically last)
          // Since series.points are already sorted chronologically, the last non-null value is the latest
          const finalValue = telemetryValues[telemetryValues.length - 1]
          
          console.debug('[IdeActivity] TTFC card final value for tool', targetToolId, {
            finalValue,
            allTelemetryValues: telemetryValues,
            usingLatest: true
          })
          
          return formatMinutes(finalValue)
        }
      }
      
      // If 'all' is selected, average across all tools
      if (!selectedIDE.value || selectedIDE.value === 'all') {
        const allTtfcValues = ttfcTimeSeriesData.value
          .filter(s => s.points && s.points.length > 0)
          .map(s => {
            // Get latest non-null telemetry value for each tool
            const rawValues = s.points.map(p => p && typeof p.v === 'number' && p.v != null && !Number.isNaN(p.v) ? p.v : null)
            const telemetryValues = rawValues.filter(v => v != null && !Number.isNaN(v))
            return telemetryValues.length > 0 ? telemetryValues[telemetryValues.length - 1] : null
          })
          .filter(v => v != null && Number.isFinite(v))
        
        if (allTtfcValues.length > 0) {
          const avgTtfc = allTtfcValues.reduce((sum, v) => sum + v, 0) / allTtfcValues.length
          console.debug('[IdeActivity] TTFC card value (averaged across all tools)', {
            toolId: 'all',
            valueFromSeries: avgTtfc,
            toolCount: allTtfcValues.length,
          })
          return formatMinutes(avgTtfc)
        }
      }
    }
    
    // Fallback to simulation if telemetry is not available
    console.debug('[IdeActivity] TTFC falling back to simulation (no telemetry data)')
    const simValue = selectedIDE.value 
      ? filteredMetrics.value.ide_metrics[selectedIDE.value]?.time_to_first_commit_minutes
      : null
    return formatMinutes(simValue)
  }
  
  if (!selectedIDE.value) {
    // All IDEs: average the values
    const values = Object.values(filteredMetrics.value.ide_metrics)
      .map(m => m?.[metricKey])
      .filter(v => typeof v === 'number')
    
    if (values.length === 0) return '-'
    
    if (metricKey.includes('rate') || metricKey.includes('average') || metricKey.includes('duration')) {
      return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
    }
    return values.reduce((a, b) => a + b, 0)
  } else {
    // Legacy ide_metrics access removed - use telemetry data instead
    return '-'
  }
}

// Legacy getMetricValue function removed - ide_metrics no longer used
// Note: This function accessed ide_metrics legacy placeholder data

// Trend calculation functions
function calculateTrend(currentValue, previousValue, metricKey) {
  if (!currentValue || !previousValue || currentValue === '-' || previousValue === '-' || currentValue === null || previousValue === null) {
    return { 
      direction: 'neutral', 
      percentage: 0, 
      description: 'No previous data',
      severity: 'none',
      icon: 'bi-dash',
      color: 'secondary'
    }
  }

  const current = parseFloat(currentValue)
  const previous = parseFloat(previousValue)

  if (isNaN(current) || isNaN(previous) || previous === 0) {
    return { 
      direction: 'neutral', 
      percentage: 0, 
      description: 'Insufficient data',
      severity: 'none',
      icon: 'bi-dash',
      color: 'secondary'
    }
  }

  const percentageChange = ((current - previous) / previous) * 100
  const absChange = Math.abs(percentageChange)
  
  // Determine if change is good or bad based on metric type
  const isPositiveMetric = [
    'AI_acceptance_rate_percent',
    'keystrokes_per_minute',
    'commits_per_session',
    'files_edited_per_session',
    'AI_suggestions_accepted'
  ].includes(metricKey)
  
  const isNegativeMetric = [
    'idle_time_minutes',
    'time_to_first_commit_minutes'
  ].includes(metricKey)
  
  let direction, description, severity, icon, color
  
  if (absChange < 5) {
    direction = 'neutral'
    description = 'Stable'
    severity = 'none'
    icon = 'bi-dash'
    color = 'secondary'
  } else if (percentageChange > 0) {
    if (isPositiveMetric) {
      direction = 'up'
      description = 'Improving'
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low'
      icon = 'bi-arrow-up'
      color = 'success'
    } else if (isNegativeMetric) {
      direction = 'down'
      description = 'Improving'
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low'
      icon = 'bi-arrow-down'
      color = 'success'
    } else {
      direction = 'up'
      description = 'Increasing'
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low'
      icon = 'bi-arrow-up'
      color = 'info'
    }
  } else {
    if (isPositiveMetric) {
      direction = 'down'
      description = 'Declining'
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low'
      icon = 'bi-arrow-down'
      color = 'danger'
    } else if (isNegativeMetric) {
      direction = 'up'
      description = 'Improving'
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low'
      icon = 'bi-arrow-up'
      color = 'success'
    } else {
      direction = 'down'
      description = 'Decreasing'
      severity = absChange > 20 ? 'high' : absChange > 10 ? 'medium' : 'low'
      icon = 'bi-arrow-down'
      color = 'warning'
    }
  }
  
  return {
    direction,
    percentage: Math.round(absChange),
    description,
    severity,
    icon,
    color
  }
}

function getTrendIcon(trend) {
  return trend.icon
}

function getTrendBadgeClass(trend) {
  return `bg-${trend.color}`
}

function getTrendDescription(metricKey, trend) {
  return `${trend.description}: ${trend.percentage}% ${trend.direction === 'up' ? 'increase' : trend.direction === 'down' ? 'decrease' : 'change'}`
}

function generateTooltipContent(metricKey, currentValue, trend) {
  return `
    <div class="text-start">
      <strong>${metricKey.replace(/_/g, ' ').toUpperCase()}</strong><br>
      Current: ${currentValue}<br>
      ${trend.description}: ${trend.percentage}%<br>
      <small class="text-muted">Click for details</small>
    </div>
  `
}

function isTimeMetric(metricKey) {
  const timeMetrics = ['idle_time_minutes', 'average_session_length_minutes', 'time_to_first_commit_minutes', 'avgTimeToFirstCommitMinutes', 'AI_usage_duration_minutes']
  return timeMetrics.includes(metricKey)
}

function formatDuration(minutes) {
  if (!minutes || minutes === 0) return '0m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = Math.round(minutes % 60)
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`
}

function getComparisonData(metricKey) {
  // For now, return mock comparison data
  // In a real implementation, this would compare with historical data
  const currentValue = getMetricValueForCard(metricKey)
  if (currentValue === '-') return null
  
  // Simulate 10-20% improvement
  const improvement = 0.1 + (Math.random() * 0.1)
  return currentValue * (1 - improvement)
}

// Handle unified filters change
function handleUnifiedFiltersChange(filters) {
  console.log('🔄 IDE Activity unified filters changed:', filters)
  
  // Map the new combined timeComparison filter to existing filter values
  if (filters.timeComparison === 'wow') {
    timeFilter.value = 'week'
    comparisonMode.value = 'week-over-week'
  } else if (filters.timeComparison === 'mom') {
    timeFilter.value = 'month'
    comparisonMode.value = 'month-over-month'
  } else if (filters.timeComparison === 'qoq') {
    timeFilter.value = 'week' // Map quarter to week for now
    comparisonMode.value = 'quarter-over-quarter'
  } else if (filters.timeComparison === 'dod') {
    timeFilter.value = 'day'
    comparisonMode.value = 'day-over-day'
  } else if (filters.timeComparison === 'hoh') {
    timeFilter.value = 'hour'
    comparisonMode.value = 'hour-over-hour'
  } else if (filters.timeComparison === 'all') {
    timeFilter.value = 'week' // Map all to week for now
    comparisonMode.value = 'none'
  } else if (filters.timeComparison === 'custom') {
    timeFilter.value = 'custom'
    comparisonMode.value = 'custom'
  }
  
  // Update repository filter
  selectedRepo.value = filters.repository
  
  // TTFC is now fetched via useTimeSeries composable (productivityQueryForTTFC)
  // No need to call fetchProductivitySummary() anymore
  
  // In a real implementation, this would refresh IDE metrics data
  console.log('🔄 IDE Activity metrics would be refreshed with new time settings and repository:', selectedRepo.value)
}

// Handle IDE change in UnifiedFilters
function handleIDEChange(selectedIde) {
  selectedIDE.value = selectedIde
  console.log('🔄 IDE Activity selected IDE changed:', selectedIDE.value)
  
  // In a real implementation, this would refresh IDE metrics data for the selected IDE
  console.log('🔄 IDE Activity metrics would be refreshed for IDE:', selectedIDE.value)
}

// Refresh repositories list
async function refreshRepositories() {
  try {
    console.log('🔄 Refreshing repositories for IDE Activity...')
    await githubStore.fetchRepositories()
    console.log('✅ Repositories refreshed successfully from GitHub store')
  } catch (error) {
    console.error('❌ Failed to refresh repositories:', error)
  }
}

// DEPRECATED: fetchProductivitySummary() is no longer used for TTFC
// TTFC now uses the same telemetry pipeline as other metrics via useTimeSeries(productivityQueryForTTFC)
// This function is kept for reference but should not be called
// async function fetchProductivitySummary() {
//   // Old implementation removed - TTFC now uses useTimeSeries composable
// }

// Lifecycle
onMounted(async () => {
  console.log('IDE Activity component mounted')
  
  try {
    // Fetch repositories if not already loaded
    if (!githubStore.repositories || githubStore.repositories.length === 0) {
      console.log('🔄 Fetching repositories for IDE Activity...')
      await githubStore.fetchRepositories()
      console.log('✅ Repositories loaded:', githubStore.repositories.length)
      }
      
      // TTFC is now fetched via useTimeSeries composable (productivityQueryForTTFC)
      // No need to call fetchProductivitySummary() anymore
    } catch (error) {
    console.error('❌ Failed to load repositories:', error)
  }
})

// Watch for filter changes to refetch summary
watch(
  () => [filters.activeDateRange('productivity'), filters.activeViewBucket('productivity'), githubStore.repositories],
  async () => {
    await fetchProductivitySummary()
  },
  { deep: true }
)

// Watch for changes in selected metrics from the store
watch(() => metricsFacadeStore.selectedMetrics, (newMetrics) => {
  console.log('🔄 IDE Activity: Selected metrics changed:', newMetrics)
  // Force a refresh of computed properties that depend on selected metrics
}, { deep: true })
</script>

<style scoped>
.ide-activity {
  padding: 1.5rem;
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  min-height: 100vh;
}

.card {
  border-radius: 1rem;
  border: 1px solid #e9ecef;
  transition: all 0.3s ease-in-out;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.12);
}

.card-header {
  border-radius: 1rem 1rem 0 0;
  background: linear-gradient(135deg, #343a40 0%, #495057 100%);
  color: white;
  border-bottom: none;
}

/* Performance ribbon styles */
.performance-ribbon {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 10;
}

.ribbon {
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 0 20px 20px 0;
  border-color: transparent;
}

.ribbon.high {
  border-right-color: #dc3545;
}

.ribbon.medium {
  border-right-color: #ffc107;
}

.ribbon.low {
  border-right-color: #28a745;
}

.ribbon.none {
  border-right-color: #6c757d;
}

.ribbon i {
  position: absolute;
  top: 2px;
  right: -18px;
  color: white;
  font-size: 0.75rem;
}

/* Trend indicator styles */
.trend-indicator {
  position: absolute;
  top: 10px;
  right: 10px;
}

.trend-indicator .badge {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.telemetry-toggle select {
  min-width: 140px;
}

/* Metric card enhancements */
.metric-card {
  transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
}

.metric-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
}

.card-body {
  padding: 1.5rem;
}

.table th {
  border-top: none;
  font-weight: 600;
  color: #6c757d;
}

.table td {
  vertical-align: middle;
}
</style>
