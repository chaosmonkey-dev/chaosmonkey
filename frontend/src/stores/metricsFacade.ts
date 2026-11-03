/// <reference types="vite/client" />

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getProductivityTimeSeries as getProductivityTimeSeriesService } from '../services/metricsFacade'
import { isLivePilotMode } from '../lib/insights/runtimeMode'

const MF_DEBUG = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true'
import { useFilterStore } from './filters'

// Types for strict TypeScript usage
export interface IDEMetricData {
  idle_time_minutes: number
  average_session_length_minutes: number
  files_edited_per_session: number
  commits_per_session: number
  time_to_first_commit_minutes: number
  AI_suggestions_shown: number
  AI_suggestions_accepted: number
  AI_acceptance_rate_percent: number
  AI_usage_duration_minutes: number
  keystrokes_per_minute: number
}

export interface TimeSeriesPoint {
  date: string
  value: number
}

export interface MetricsSnapshot {
  [ide: string]: IDEMetricData
}

export interface TimeSeriesData {
  [timeRange: string]: MetricsSnapshot[]
}

export const useMetricsFacadeStore = defineStore('metricsFacade', () => {
  const filtersStore = useFilterStore()
  
  // State with strict typing
  const ideMetrics = ref<MetricsSnapshot>({})
  const timeSeriesData = ref<TimeSeriesData>({})
  const loading = ref(false)
  const error = ref<string | null>(null)

  // CR-X P7: Non-localhost pilots must default to live telemetry. The env flag
  // can still force live or sim explicitly; otherwise the runtime host wins so a
  // production build cannot silently fall back to the simulator on Ed.
  const envTelemetryDefault =
    import.meta.env.VITE_CM_TELEMETRY_LIVE === 'true' ? 'live' :
    import.meta.env.VITE_CM_TELEMETRY_LIVE === 'false' ? 'sim' :
    (isLivePilotMode() ? 'live' : 'sim')

  // ── Bounded Local-only telemetry-mode migration ──────────────────
  // Problem: localStorage('telemetryMode') persists across builds.
  // If a prior build stored 'sim', it overrides the env default forever,
  // even after VITE_CM_TELEMETRY_LIVE is changed to 'true'.
  //
  // Solution: a versioned migration stamp. When the env authority version
  // changes, the stale persisted override is cleared and the env default
  // wins. This is bounded to Local Lab — it does NOT introduce a
  // "live customer pilot" semantic. It only ensures the env-configured
  // telemetry source (canonical API vs simulator) is respected.
  //
  // The migration stamp is derived from the env values themselves, so it
  // automatically invalidates when the env config changes.
  const TELEMETRY_MODE_MIGRATION_STAMP = `v1:${envTelemetryDefault}`
  const storedMigrationStamp = typeof window !== 'undefined'
    ? window.localStorage?.getItem('telemetryModeMigrationStamp')
    : null
  const storedTelemetryMode = typeof window !== 'undefined'
    ? window.localStorage?.getItem('telemetryMode')
    : null

  // If the migration stamp changed (or is new), the persisted telemetryMode
  // is stale relative to the current env config — discard it and let the
  // env default win.
  const effectiveStoredMode =
    storedMigrationStamp === TELEMETRY_MODE_MIGRATION_STAMP
      ? storedTelemetryMode
      : null

  const telemetryMode = ref<'live' | 'sim'>(
    effectiveStoredMode === 'live' || effectiveStoredMode === 'sim'
      ? (effectiveStoredMode as 'live' | 'sim')
      : envTelemetryDefault
  )
  const telemetryModeVersion = ref(0)

  // Persist the current migration stamp so future loads can detect changes
  if (typeof window !== 'undefined') {
    window.localStorage?.setItem('telemetryModeMigrationStamp', TELEMETRY_MODE_MIGRATION_STAMP)
  }
  
  // Track whether live telemetry was actually used in the last fetch
  const telemetryUsedInSeries = ref(false)
  const telemetryUsedInSummary = ref(false)

  // 🔥 HELPER: Check if telemetry payload contains meaningful data
  function isMeaningfulTelemetryPayload(result: any): boolean {
    if (!result || typeof result !== 'object') return false
    
    // Check for meaningful shape - arrays with expected structure
    if (Array.isArray(result)) {
      return result.length > 0 && result.some(item => 
        item && typeof item === 'object' && (
          typeof item.period === 'string' ||
          typeof item.tool === 'string' ||
          typeof item.AI_suggestions_accepted === 'number' ||
          typeof item.average_session_length_minutes === 'number' ||
          typeof item.commits_per_session === 'number'
        )
      )
    }
    
    // Check for object with meaningful keys
    return Object.keys(result).length > 0
  }

  // 🔥 HELPER: Check if store already has meaningful telemetry data
  function hasMeaningfulExistingTelemetry(): boolean {
    return (
      (ideMetrics.value && Object.keys(ideMetrics.value).length > 0) ||
      (timeSeriesData.value && Object.keys(timeSeriesData.value).length > 0)
    )
  }

  const setTelemetryMode = (mode: 'live' | 'sim') => {
    if (telemetryMode.value === mode) {
      return
    }
    telemetryMode.value = mode
    telemetryModeVersion.value += 1
    
    // CRITICAL: Clear cached metrics to prevent cross-contamination between modes
    // This ensures switching modes always starts with fresh data
    if (MF_DEBUG) console.info(`[metricsFacadeStore] 🔄 Telemetry mode changed to ${mode} — clearing cached metrics`)
    ideMetrics.value = {}
    timeSeriesData.value = {}
    
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('telemetryMode', mode)
    }
  }

  // Supported IDEs with strict typing
  const supportedIDEs = ref([
    { id: 'cursor', name: 'Cursor', icon: 'bi-cursor', color: 'dark', status: 'supported', ssoEnabled: true },
    { id: 'windsurf', name: 'Windsurf', icon: 'bi-wind', color: 'dark', status: 'supported', ssoEnabled: true },
    { id: 'vscode', name: 'VS Code', icon: 'bi-code-square', color: 'dark', status: 'supported', ssoEnabled: true },
    { id: 'jetbrains', name: 'JetBrains IDEs', icon: 'bi-journal-code', color: 'dark', status: 'supported', ssoEnabled: true },
    { id: 'sublime', name: 'Sublime Text', icon: 'bi-file-code', color: 'dark', status: 'supported', ssoEnabled: true },
    { id: 'vim', name: 'Vim/Neovim', icon: 'bi-terminal', color: 'dark', status: 'supported', ssoEnabled: true }
  ])

  // Available metrics for selection
  const availableMetrics = ref([
    // Productivity Metrics
    { id: 'AI_suggestions_accepted', label: 'AI Suggestions Accepted', description: 'AI-assisted code suggestions accepted', category: 'productivity' },
    { id: 'files_edited_per_session', label: 'Files per Session', description: 'Number of files edited per coding session', category: 'productivity' },
    { id: 'commits_per_session', label: 'Commits per Session', description: 'Git commits made per coding session', category: 'productivity' },
    { id: 'average_session_length_minutes', label: 'Average Session Length', description: 'Average coding session duration in minutes', category: 'productivity' },
    { id: 'time_to_first_commit_minutes', label: 'Time to First Commit', description: 'Minutes from session start to first commit', category: 'productivity' },
    { id: 'AI_usage_duration_minutes', label: 'AI Usage Duration', description: 'Total time spent using AI features in minutes', category: 'productivity' },
    { id: 'idle_time_minutes', label: 'Idle Time', description: 'Time spent idle during coding sessions', category: 'productivity' },
    { id: 'keystrokes_per_minute', label: 'Keystrokes per Minute', description: 'Typing speed during active coding', category: 'productivity' },
    { id: 'AI_suggestions_shown', label: 'AI Suggestions Shown', description: 'Total AI suggestions displayed to user', category: 'productivity' },
    { id: 'AI_acceptance_rate_percent', label: 'AI Acceptance Rate', description: 'Percentage of AI suggestions accepted', category: 'productivity' },
    
    // Engineering Metrics
    { id: 'pr_opened', label: 'Pull Requests Opened', description: 'Number of pull requests created', category: 'engineering' },
    { id: 'pr_merged', label: 'Pull Requests Merged', description: 'Number of pull requests successfully merged', category: 'engineering' },
    { id: 'pr_review_time_hours', label: 'PR Review Time', description: 'Average time for PR review in hours', category: 'engineering' },
    { id: 'deploy_frequency', label: 'Deploy Frequency', description: 'Number of deployments per time period', category: 'engineering' },
    { id: 'lead_time_hours', label: 'Lead Time', description: 'Time from commit to production deployment', category: 'engineering' },
    { id: 'change_failure_rate', label: 'Change Failure Rate', description: 'Percentage of deployments causing failures', category: 'engineering' },
    { id: 'mean_time_to_recovery', label: 'MTTR', description: 'Mean time to recover from failures', category: 'engineering' },
    { id: 'code_review_coverage', label: 'Code Review Coverage', description: 'Percentage of code reviewed before merge', category: 'engineering' },
    
    // IDE Activity Metrics
    { id: 'active_coding_time', label: 'Active Coding Time', description: 'Time spent actively writing code', category: 'ide' },
    { id: 'debugging_time', label: 'Debugging Time', description: 'Time spent debugging and troubleshooting', category: 'ide' },
    { id: 'refactoring_time', label: 'Refactoring Time', description: 'Time spent refactoring existing code', category: 'ide' },
    { id: 'testing_time', label: 'Testing Time', description: 'Time spent writing and running tests', category: 'ide' },
    { id: 'extension_usage', label: 'Extension Usage', description: 'Number of IDE extensions actively used', category: 'ide' },
    { id: 'project_switches', label: 'Project Switches', description: 'Number of times switching between projects', category: 'ide' },
    { id: 'terminal_usage', label: 'Terminal Usage', description: 'Time spent using integrated terminal', category: 'ide' },
    { id: 'git_operations', label: 'Git Operations', description: 'Number of Git operations performed', category: 'ide' },
    
    // Quality Metrics
    { id: 'test_coverage', label: 'Test Coverage', description: 'Percentage of code covered by tests', category: 'quality' },
    { id: 'bug_fixes', label: 'Bug Fixes', description: 'Number of bugs fixed per time period', category: 'quality' },
    { id: 'technical_debt', label: 'Technical Debt', description: 'Estimated technical debt in hours', category: 'quality' },
    { id: 'code_complexity', label: 'Code Complexity', description: 'Average cyclomatic complexity score', category: 'quality' },
    { id: 'documentation_updates', label: 'Documentation Updates', description: 'Number of documentation updates', category: 'quality' },
    
    // Collaboration Metrics
    { id: 'code_reviews_given', label: 'Code Reviews Given', description: 'Number of code reviews performed', category: 'collaboration' },
    { id: 'code_reviews_received', label: 'Code Reviews Received', description: 'Number of code reviews received', category: 'collaboration' },
    { id: 'pair_programming_time', label: 'Pair Programming', description: 'Time spent in pair programming sessions', category: 'collaboration' },
    { id: 'knowledge_sharing_sessions', label: 'Knowledge Sharing', description: 'Number of knowledge sharing sessions', category: 'collaboration' },
    
    // Performance Metrics
    { id: 'build_time_seconds', label: 'Build Time', description: 'Average time to build project in seconds', category: 'performance' },
    { id: 'test_execution_time', label: 'Test Execution Time', description: 'Time to run all tests in seconds', category: 'performance' },
    { id: 'deployment_time', label: 'Deployment Time', description: 'Time from merge to production in minutes', category: 'performance' },
    { id: 'page_load_time', label: 'Page Load Time', description: 'Average page load time in milliseconds', category: 'performance' }
  ])

  // Selected metrics (default to key metrics)
  const selectedMetrics = ref<string[]>([
    'AI_suggestions_accepted',
    'files_edited_per_session',
    'commits_per_session',
    'pr_merged',
    'lead_time_hours',
    'active_coding_time',
    'test_coverage',
    'code_reviews_given'
  ])

  // Generate realistic IDE metrics with runtime guards
  const generateRealisticIDEMetrics = (timeFilter: string, ide: string): IDEMetricData => {
    // Runtime guard: validate inputs
    if (!timeFilter || !ide) {
      console.error('Invalid parameters for generateRealisticIDEMetrics:', { timeFilter, ide })
      return getDefaultMetricData()
    }

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
    
    const basePerf = performance[ide as keyof typeof performance] || { 
      base: 50, 
      variance: 0.2, 
      trend: 0.01, 
      seasonal: 0.1, 
      weekly: 0.15, 
      daily: 0.2 
    }
    
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
    
    const timeMultiplier = timeMultipliers[timeFilter as keyof typeof timeMultipliers] || 1.0
    
    // Generate realistic metrics with natural variation
    const generateMetricValue = (metricType: string, baseValue: number): number => {
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
      
      const multiplier = metricMultipliers[metricType as keyof typeof metricMultipliers] || 1.0
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

  // Get default metric data for fallback
  const getDefaultMetricData = (): IDEMetricData => ({
    idle_time_minutes: 15,
    average_session_length_minutes: 60,
    files_edited_per_session: 5,
    commits_per_session: 2,
    time_to_first_commit_minutes: 30,
    AI_suggestions_shown: 20,
    AI_suggestions_accepted: 15,
    AI_acceptance_rate_percent: 75,
    AI_usage_duration_minutes: 25,
    keystrokes_per_minute: 100
  })

  // Generate time series data with runtime guards
  const generateTimeSeriesData = (timeRange: string, ide: string, metric: string): TimeSeriesPoint[] => {
    // Runtime guard: validate inputs
    if (!timeRange || !ide || !metric) {
      console.error('Invalid parameters for generateTimeSeriesData:', { timeRange, ide, metric })
      return []
    }

    const baseValue = ideMetrics.value[ide]?.[metric as keyof IDEMetricData] || 0
    const timeLabels = getTimeLabels(timeRange)
    
    return timeLabels.map((label, index) => ({
      date: label,
      value: Math.round(baseValue * (0.8 + 0.05 * index + 0.02 * ide.charCodeAt(0)))
    }))
  }

  // Get time labels based on time range
  const getTimeLabels = (timeRange: string): string[] => {
    switch (timeRange) {
      case 'week':
        return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      case 'month':
        return Array.from({ length: 4 }, (_, i) => `Week ${i + 1}`)
      case 'quarter':
        return ['Jan', 'Feb', 'Mar']
      case 'day':
        return Array.from({ length: 24 }, (_, i) => `${i}:00`)
      case 'hour':
        return Array.from({ length: 60 }, (_, i) => `${i}m`)
      default:
        return Array.from({ length: 7 }, (_, i) => `Day ${i + 1}`)
    }
  }

  // Computed properties for reactive access
  const currentMetrics = computed(() => {
    const currentTimeRange = filtersStore.productivityFilters.dateRange.from ? 'day' : 'week'
    return ideMetrics.value || {}
  })

  const currentTimeSeries = computed(() => {
    const currentTimeRange = filtersStore.productivityFilters.dateRange.from ? 'day' : 'week'
    const currentMetric = filtersStore.productivityFilters.productivityMetricId || 'AI_suggestions_accepted'
    const currentIDE = filtersStore.productivityFilters.toolIds?.[0] || 'cursor'
    
    if (currentIDE && currentIDE !== 'all') {
      return generateTimeSeriesData(currentTimeRange, currentIDE, currentMetric)
    }
    
    // Generate for all IDEs
    return supportedIDEs.value.map(ide => ({
      ide: ide.id,
      data: generateTimeSeriesData(currentTimeRange, ide.id, currentMetric)
    }))
  })

  // Actions
  const refreshMetrics = async (timeRange: string) => {
    loading.value = true
    error.value = null
    
    try {
      // Runtime guard: validate time range
      if (!timeRange) {
        throw new Error('Invalid time range')
      }

      // Generate fresh metrics for all IDEs
      const newMetrics: MetricsSnapshot = {}
      supportedIDEs.value.forEach(ide => {
        newMetrics[ide.id] = generateRealisticIDEMetrics(timeRange, ide.id)
      })
      
      ideMetrics.value = newMetrics
      
      // Generate time series data
      timeSeriesData.value[timeRange] = [newMetrics]
      
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to refresh metrics'
      console.error('Failed to refresh metrics:', err)
    } finally {
      loading.value = false
    }
  }

  const getMetricValue = (ideId: string, metricKey: string): number => {
    // Runtime guard: validate inputs
    if (!ideId || !metricKey) {
      console.error('Invalid parameters for getMetricValue:', { ideId, metricKey })
      return 0
    }
    
    const metricsData = ideMetrics.value[ideId]
    if (metricsData && metricsData[metricKey as keyof IDEMetricData] !== undefined) {
      return metricsData[metricKey as keyof IDEMetricData]
    }
    return 0
  }

  const getMetricLabel = (metricKey: string): string => {
    const labels: Record<string, string> = {
      'AI_suggestions_accepted': 'suggestions accepted',
      'files_edited_per_session': 'files per session',
      'commits_per_session': 'commits per session',
      'average_session_length_minutes': 'minutes per session',
      'time_to_first_commit_minutes': 'minutes to commit',
      'AI_usage_duration_minutes': 'minutes of AI usage',
      'idle_time_minutes': 'minutes idle'
    }
    return labels[metricKey] || 'value'
  }

  // Metrics selection management
  const updateSelectedMetrics = (metrics: string[]) => {
    selectedMetrics.value = metrics
    // Save to localStorage for persistence
    localStorage.setItem('selectedMetrics', JSON.stringify(metrics))
  }

  const loadSelectedMetrics = () => {
    const saved = localStorage.getItem('selectedMetrics')
    if (saved) {
      try {
        selectedMetrics.value = JSON.parse(saved)
      } catch (error) {
        console.error('Failed to parse saved metrics:', error)
        // Fall back to default
        selectedMetrics.value = [
          'AI_suggestions_accepted',
          'files_edited_per_session',
          'commits_per_session'
        ]
      }
    }
  }

  const resetToDefaultMetrics = () => {
    selectedMetrics.value = [
      'AI_suggestions_accepted',
      'files_edited_per_session',
      'commits_per_session'
    ]
    localStorage.setItem('selectedMetrics', JSON.stringify(selectedMetrics.value))
  }

  // Initialize selected metrics on store creation
  loadSelectedMetrics()

  // --- Map unified IDE metric ids → this store's keys ---
  const UNIFIED_TO_FACADE_KEY: Record<string, keyof IDEMetricData> = {
    'ide.ai_suggestions_accepted': 'AI_suggestions_accepted',
    'ide.files_per_session': 'files_edited_per_session',
    'ide.commits_per_session': 'commits_per_session',
    'ide.avg_session_length': 'average_session_length_minutes',
    'ide.time_to_first_commit': 'time_to_first_commit_minutes',
    'ide.ai_usage_duration': 'AI_usage_duration_minutes',
    'ide.idle_time': 'idle_time_minutes',
    'ide.acceptance_rate': 'AI_acceptance_rate_percent',
  };

  // Choose a generator range from date span
  function deriveRangeForGenerator(fromISO: string, toISO: string): 'hour'|'day'|'week'|'month' {
    const from = new Date(fromISO), to = new Date(toISO);
    const days = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    if (days <= 2/24) return 'hour';
    if (days <= 2)    return 'day';
    if (days <= 21)   return 'week';
    return 'month';
  }

  // Build bucket stamps between from/to
  function buildBuckets(fromISO: string, toISO: string): { step: 'hour'|'day'|'week'|'month', stamps: string[] } {
    const step = deriveRangeForGenerator(fromISO, toISO);
    const stamps: string[] = [];
    const start = new Date(fromISO);
    const end = new Date(toISO);
    const d = new Date(start);

    const push = (dt: Date) => stamps.push(new Date(dt).toISOString());

    if (step === 'hour') {
      d.setMinutes(0,0,0);
      while (d <= end) { push(d); d.setHours(d.getHours() + 1); }
    } else if (step === 'day') {
      d.setHours(0,0,0,0);
      while (d <= end) { push(d); d.setDate(d.getDate() + 1); }
    } else if (step === 'week') {
      d.setHours(0,0,0,0);
      const mondayOffset = (d.getDay() + 6) % 7; // Mon=0
      d.setDate(d.getDate() - mondayOffset);
      while (d <= end) { push(d); d.setDate(d.getDate() + 7); }
    } else { // month
      d.setDate(1); d.setHours(0,0,0,0);
      while (d <= end) { push(d); d.setMonth(d.getMonth() + 1); }
    }

    return { step, stamps };
  }

  // --- API used by unified.ts ---
  type ToolSeries = {
    label: string;
    points: { t: string; v: number }[];
    usesTelemetry?: boolean;
    isLive?: boolean;
    dataSource?: string;
  }

  async function getProductivityTimeSeries(q: {
    from: string;
    to: string;
    teamIds?: string[];
    developerIds?: string[];
    toolIds?: string[];
    metrics: string[]; // 'ide.*'
  }, signal?: AbortSignal): Promise<ToolSeries[]> {
    try {
      if (!q?.from || !q?.to || !Array.isArray(q.metrics) || q.metrics.length === 0) {
        console.error('getProductivityTimeSeries: invalid query', q);
        return [];
      }

      // If telemetry mode is live, delegate to the telemetry-aware metricsFacade service.
      // This preserves the store API surface while enabling real telemetry overlay.
      if (telemetryMode.value === 'live') {
        const unifiedMetric = q.metrics[0]
        const viewBucket = deriveRangeForGenerator(q.from, q.to) === 'month'
          ? 'monthly'
          : (deriveRangeForGenerator(q.from, q.to) === 'week' ? 'weekly' : 'daily')

        const svcResult = await getProductivityTimeSeriesService({
          from: q.from,
          to: q.to,
          repos: [],
          scope: 'org',
          viewBucket,
          developerIds: q.developerIds,
          teamIds: q.teamIds,
          toolIds: q.toolIds,
          metricId: unifiedMetric,
        }, signal)

        const svcSeries = (svcResult as any)?.series
        const list: Array<any> = Array.isArray(svcSeries) ? svcSeries : []

        // Mark series as live/telemetry-aware so callers can classify prodPoints.source.
        const annotated = list.map((s: any) => ({
          ...s,
          usesTelemetry: true,
          isLive: svcResult?.dataSource === 'Real',
          dataSource: svcResult?.dataSource,
        }))

        telemetryUsedInSeries.value = svcResult?.dataSource === 'Real'
        return annotated as Array<{ label: string; points: { t: string; v: number }[] }>
      }

      // pick the first metric (unified.ts will duplicate per metric)
      const unifiedMetric = q.metrics[0];
      const facadeKey = UNIFIED_TO_FACADE_KEY[unifiedMetric] ?? 'AI_suggestions_accepted';

      const tools = (q.toolIds && q.toolIds.length > 0)
        ? q.toolIds
        : supportedIDEs.value.map(t => t.id);

      const { step, stamps } = buildBuckets(q.from, q.to);
      const genRange = step; // 'hour' | 'day' | 'week' | 'month'

      const series: Array<{ label: string; points: { t: string; v: number }[]; usesTelemetry?: boolean; isLive?: boolean; dataSource?: string }> = [];

      for (const tool of tools) {
        // ensure baseline exists
        if (!ideMetrics.value[tool]) {
          ideMetrics.value[tool] = generateRealisticIDEMetrics(genRange, tool);
        }
        const baseline = (ideMetrics.value[tool]?.[facadeKey] ?? 0) as number;

        const points = stamps.map((iso, idx) => {
          // deterministic wiggle: ~0.9..1.1
          const wiggle = 0.9 + (Math.sin((idx + tool.charCodeAt(0)) * 0.7) + 1) * 0.1 / 2;
          const v = Math.max(0, Math.round(baseline * wiggle));
          return { t: iso, v };
        });

        series.push({ label: tool, points, usesTelemetry: false, isLive: false, dataSource: 'Simulated' });
      }

      return series;
    } catch (e) {
      console.error('getProductivityTimeSeries error:', e);
      
      // 🔥 GUARD: Preserve existing telemetry data on transient failures
      const hadMeaningful = hasMeaningfulExistingTelemetry();
      
      if (hadMeaningful) {
        if (MF_DEBUG) console.warn('[METRICS_FACADE] Empty response, preserving existing telemetry');
        // Return existing data instead of empty array
        return Object.entries(ideMetrics.value).map(([tool, metrics]) => ({
          label: tool,
          points: [], // Empty points but preserve tool presence
          usesTelemetry: telemetryUsedInSeries.value,
          isLive: telemetryMode.value === 'live',
          dataSource: 'Preserved'
        }));
      }
      
      return [];
    }
  }

  return {
    // State
    ideMetrics,
    timeSeriesData,
    loading,
    error,
    supportedIDEs,
    telemetryMode,
    telemetryModeVersion,
    telemetryUsedInSeries,
    telemetryUsedInSummary,
    availableMetrics,
    selectedMetrics,
    
    // Computed
    currentMetrics,
    currentTimeSeries,
    
    // Actions
    refreshMetrics,
    getMetricValue,
    getMetricLabel,
    updateSelectedMetrics,
    loadSelectedMetrics,
    resetToDefaultMetrics,
    setTelemetryMode,
    
    // Utilities
    generateRealisticIDEMetrics,
    generateTimeSeriesData,
    getTimeLabels,
    
    // API for unified.ts
    getProductivityTimeSeries
  }
})
