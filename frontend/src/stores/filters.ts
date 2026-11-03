import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const FILTERS_DEBUG = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true'

import type {
  Filters, 
  DashboardFilters, 
  ViewBucket, 
  Scope, 
  DateRange,
  FilterUpdate,
  FilterChangeEvent 
} from '../types/filters'
import { error as logError } from '../utils/logger'

export const useFilterStore = defineStore('filters', () => {
  // State with strict typing
  const filters = ref<DashboardFilters>({
    engineering: {
      dateRange: getDefaultDateRange(),
      repos: [],
      viewBucket: 'daily',
      scope: 'org',
      developerIds: [],
      teamIds: [],
      timeComparison: 'wow' // Default to week-over-week
    },
    ideActivity: {
      dateRange: getDefaultDateRange(),
      repos: [],
      viewBucket: 'daily',
      scope: 'org',
      developerIds: [],
      teamIds: [],
      timeComparison: 'wow' // Default to week-over-week
    },
    productivity: {
      dateRange: getAllTimeDateRange(), // Use full historical for consistency with AI Ops and PI
      repos: [],
      viewBucket: 'weekly',
      scope: 'org',
      developerIds: [],
      teamIds: [],
      toolIds: [], // No filter by default — request all tools from API
      metricId: 'ide.ai_suggestions_accepted',
      metricIds: undefined,
      productivityMetricId: 'ide.ai_suggestions_accepted',
      productivityMetricIds: [
        'ide.ai_suggestions_accepted',
        'ide.files_edited_per_session',
        'ide.commits_per_session',
        'ide.average_session_length_minutes',
        'ide.time_to_first_commit_minutes',
        'ide.AI_usage_duration_minutes',
        'ide.idle_time_minutes',
        'ide.active_coding_time_minutes'
      ],
      viewType: 'cards',
      timeComparison: 'wow' // Default to week-over-week
    }
  })

  const resetAll = () => {
    filters.value = {
      engineering: {
        dateRange: getDefaultDateRange(),
        repos: [],
        viewBucket: 'daily',
        scope: 'org',
        developerIds: [],
        teamIds: [],
        timeComparison: 'wow'
      },
      ideActivity: {
        dateRange: getDefaultDateRange(),
        repos: [],
        viewBucket: 'daily',
        scope: 'org',
        developerIds: [],
        teamIds: [],
        timeComparison: 'wow'
      },
      productivity: {
        dateRange: getAllTimeDateRange(), // Use full historical for consistency with AI Ops and PI
        repos: [],
        viewBucket: 'weekly', // CRITICAL: Must be 'weekly' for canonical telemetry to return data
        scope: 'org',
        developerIds: [],
        teamIds: [],
        toolIds: [], // No filter by default — request all tools from API
        metricId: 'ide.ai_suggestions_accepted',
        metricIds: undefined,
        productivityMetricId: 'ide.ai_suggestions_accepted',
        productivityMetricIds: [
          'ide.ai_suggestions_accepted',
          'ide.files_edited_per_session',
          'ide.commits_per_session',
          'ide.average_session_length_minutes',
          'ide.time_to_first_commit_minutes',
          'ide.AI_usage_duration_minutes',
          'ide.idle_time_minutes',
          'ide.active_coding_time_minutes',
          'ide.active_coding_ratio',
          'ide.ai_usage_ratio',
          'ide.idle_ratio'
        ],
        viewType: 'cards',
        timeComparison: 'wow'
      }
    }
  }

  // Computed properties for reactive access
  const engineeringFilters = computed(() => filters.value.engineering)
  const ideActivityFilters = computed(() => filters.value.ideActivity)
  const productivityFilters = computed(() => filters.value.productivity)

  // Actions with runtime guards
  const setDateRange = (dashboard: keyof DashboardFilters, dateRange: Partial<DateRange>) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Runtime guard: validate date strings (allow empty strings for all-time sentinel)
    if (dateRange.from !== undefined && dateRange.from !== '' && !isValidDateString(dateRange.from)) {
      logError(`Invalid from date: ${dateRange.from}`)
      return
    }
    if (dateRange.to !== undefined && dateRange.to !== '' && !isValidDateString(dateRange.to)) {
      logError(`Invalid to date: ${dateRange.to}`)
      return
    }

    // Runtime guard: ensure from date is not after to date (skip for all-time empty strings).
    // CR-X P0-A: Allow from === to for same-day ranges (e.g. Last Day).
    if (dateRange.from && dateRange.to && dateRange.from !== '' && dateRange.to !== '' && dateRange.from > dateRange.to) {
      logError('From date must not be after to date')
      return
    }

    if (dateRange.from !== undefined) {
      filters.value[dashboard].dateRange.from = dateRange.from
    }
    if (dateRange.to !== undefined) {
      filters.value[dashboard].dateRange.to = dateRange.to
    }
    
    // Debug logging to trace date range updates
    if (FILTERS_DEBUG) console.debug('[FilterStore] setDateRange called', {
      dashboard,
      newRange: dateRange,
      currentRange: filters.value[dashboard].dateRange,
      isAllTime: dateRange.from === '' && dateRange.to === ''
    })
  }

  const setRepos = (dashboard: keyof DashboardFilters, repos: string[]) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Runtime guard: validate repos array
    if (!Array.isArray(repos)) {
      logError('Repos must be an array')
      return
    }

    // Runtime guard: validate each repo string
    const validRepos = repos.filter(repo => typeof repo === 'string' && repo.trim().length > 0)
    filters.value[dashboard].repos = validRepos
  }

  const setViewBucket = (dashboard: keyof DashboardFilters, viewBucket: string) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Runtime guard: validate viewBucket value
    if (!isValidViewBucket(viewBucket)) {
      logError(`Invalid viewBucket: ${viewBucket}. Must be one of: daily, weekly, monthly`)
      return
    }

    filters.value[dashboard].viewBucket = viewBucket
  }

  const setScope = (dashboard: keyof DashboardFilters, scope: string) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Runtime guard: validate scope value
    if (!isValidScope(scope)) {
      logError(`Invalid scope: ${scope}. Must be one of: org, team, dev`)
      return
    }

    filters.value[dashboard].scope = scope
  }

  const setDeveloperIds = (dashboard: keyof DashboardFilters, developerIds: string[]) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Runtime guard: validate developerIds array
    if (!Array.isArray(developerIds)) {
      logError('Developer IDs must be an array')
      return
    }

    // Runtime guard: validate each developer ID string.
    // Coerce numeric IDs to string — the backend may return integer IDs
    // (e.g. 90001) which would be silently dropped by the string filter.
    const validDeveloperIds = developerIds
      .map(id => String(id))
      .filter(id => id.trim().length > 0)
    filters.value[dashboard].developerIds = validDeveloperIds
  }

  const setTeamIds = (dashboard: keyof DashboardFilters, teamIds: string[]) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Runtime guard: validate teamIds array
    if (!Array.isArray(teamIds)) {
      logError('Team IDs must be an array')
      return
    }

    // Runtime guard: validate each team ID string
    const validTeamIds = teamIds.filter(id => typeof id === 'string' && id.trim().length > 0)
    filters.value[dashboard].teamIds = validTeamIds
  }

  const setToolIds = (dashboard: keyof DashboardFilters, toolIds: string[]) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Runtime guard: validate toolIds array
    if (!Array.isArray(toolIds)) {
      logError('Tool IDs must be an array')
      return
    }

    // Runtime guard: validate each tool ID string
    const validToolIds = toolIds.filter(id => typeof id === 'string' && id.trim().length > 0)
    filters.value[dashboard].toolIds = validToolIds
  }

  const setMetricId = (dashboard: keyof DashboardFilters, metricId: string) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Runtime guard: validate metricId string
    if (typeof metricId !== 'string' || metricId.trim().length === 0) {
      logError(`Invalid metricId: ${metricId}`)
      return
    }

    filters.value[dashboard].metricId = metricId
  }

  const setMetricIds = (dashboard: keyof DashboardFilters, metricIds: string[]) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Runtime guard: validate metricIds array
    if (!Array.isArray(metricIds)) {
      logError('Metric IDs must be an array')
      return
    }

    // Runtime guard: validate each metric ID string
    const validMetricIds = metricIds.filter(id => typeof id === 'string' && id.trim().length > 0)
    filters.value[dashboard].metricIds = validMetricIds
    // Clear metricId when setting multiple metrics
    filters.value[dashboard].metricId = undefined
  }

  const setProductivityMetricId = (dashboard: keyof DashboardFilters, metricId: string | 'all') => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Runtime guard: validate metricId
    if (typeof metricId !== 'string' || metricId.trim().length === 0) {
      logError('Productivity Metric ID must be a non-empty string or "all"')
      return
    }

    filters.value[dashboard].productivityMetricId = metricId.trim() as string | 'all'
    
    // If setting to 'all', ensure productivityMetricIds is populated
    if (metricId === 'all') {
      const allMetrics = [
        'ide.ai_suggestions_accepted',
        'ide.files_edited_per_session',
        'ide.commits_per_session',
        'ide.average_session_length_minutes',
        'ide.time_to_first_commit_minutes',
        'ide.AI_usage_duration_minutes',
        'ide.idle_time_minutes'
      ]
      filters.value[dashboard].productivityMetricIds = allMetrics
    } else {
      // Clear productivityMetricIds when setting single metric
      filters.value[dashboard].productivityMetricIds = undefined
    }
  }

  const setTimeComparison = (dashboard: keyof DashboardFilters, timeComparison: 'wow' | 'mom' | 'qoq' | 'dod' | 'hoh' | 'all' | 'custom') => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    filters.value[dashboard].timeComparison = timeComparison
  }

  const setAllProductivityMetrics = (dashboard: keyof DashboardFilters, metricIds: string[]) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Runtime guard: validate metricIds array
    if (!Array.isArray(metricIds)) {
      logError('Productivity Metric IDs must be an array')
      return
    }

    // Runtime guard: validate each metric ID string
    const validMetricIds = metricIds.filter(id => typeof id === 'string' && id.trim().length > 0)
    filters.value[dashboard].productivityMetricIds = validMetricIds
    // Set productivityMetricId to 'all' when setting multiple metrics
    filters.value[dashboard].productivityMetricId = 'all'
  }

  const setViewType = (dashboard: keyof DashboardFilters, viewType: 'cards' | 'linegraph') => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    filters.value[dashboard].viewType = viewType
  }

  const updateFilters = (dashboard: keyof DashboardFilters, filterUpdate: FilterUpdate) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    // Apply each filter update with validation
    if (filterUpdate.dateRange) {
      setDateRange(dashboard, filterUpdate.dateRange)
    }
    if (filterUpdate.repos !== undefined) {
      setRepos(dashboard, filterUpdate.repos)
    }
    if (filterUpdate.viewBucket !== undefined) {
      setViewBucket(dashboard, filterUpdate.viewBucket)
    }
    if (filterUpdate.scope !== undefined) {
      setScope(dashboard, filterUpdate.scope)
    }
    if (filterUpdate.developerIds !== undefined) {
      setDeveloperIds(dashboard, filterUpdate.developerIds)
    }
    if (filterUpdate.teamIds !== undefined) {
      setTeamIds(dashboard, filterUpdate.teamIds)
    }
    if (filterUpdate.toolIds !== undefined) {
      setToolIds(dashboard, filterUpdate.toolIds)
    }
    if (filterUpdate.metricId !== undefined) {
      setMetricId(dashboard, filterUpdate.metricId)
    }
    if (filterUpdate.metricIds !== undefined) {
      setMetricIds(dashboard, filterUpdate.metricIds)
    }
    if (filterUpdate.productivityMetricId !== undefined) {
      setProductivityMetricId(dashboard, filterUpdate.productivityMetricId)
    }
    if (filterUpdate.productivityMetricIds !== undefined) {
      setAllProductivityMetrics(dashboard, filterUpdate.productivityMetricIds)
    }
    if (filterUpdate.viewType !== undefined) {
      setViewType(dashboard, filterUpdate.viewType)
    }
  }

  const reset = (dashboard: keyof DashboardFilters) => {
    if (!filters.value[dashboard]) {
      logError(`Invalid dashboard: ${dashboard}`)
      return
    }

    filters.value[dashboard] = {
      dateRange: getDefaultDateRange(),
      repos: [],
      viewBucket: 'daily',
      scope: 'org',
      developerIds: [],
      teamIds: [],
      toolIds: undefined,
      metricId: undefined,
      metricIds: undefined,
      productivityMetricId: 'ide.ai_suggestions_accepted',
      productivityMetricIds: undefined,
      timeComparison: 'wow' // Add required timeComparison field
    }
  }

  // Getters
  const activeDateRange = computed(() => (dashboard: keyof DashboardFilters) => {
    const dateRange = filters.value[dashboard]?.dateRange
    
    // If dateRange is undefined or null, return all-time (empty strings)
    // If dateRange has empty strings, keep them (all-time)
    // If dateRange has values, use them (bounded range)
    const result = dateRange || getDefaultDateRange()
    
    // Debug logging to trace what date range is being returned
    if (FILTERS_DEBUG) console.debug('[FilterStore] activeDateRange called', {
      dashboard,
      dateRange: result,
      isDefault: !dateRange,
      isAllTime: result.from === '' && result.to === ''
    })
    
    return result
  })

  const activeRepos = computed(() => (dashboard: keyof DashboardFilters) => {
    return filters.value[dashboard]?.repos || []
  })

  const activeViewBucket = computed(() => (dashboard: keyof DashboardFilters) => {
    return filters.value[dashboard]?.viewBucket || 'daily'
  })

  const activeScope = computed(() => (dashboard: keyof DashboardFilters) => {
    return filters.value[dashboard]?.scope || 'org'
  })

  const activeDeveloperIds = computed(() => (dashboard: keyof DashboardFilters) => {
    return filters.value[dashboard]?.developerIds || []
  })

  const activeTeamIds = computed(() => (dashboard: keyof DashboardFilters) => {
    return filters.value[dashboard]?.teamIds || []
  })

  const activeToolIds = computed(() => (dashboard: keyof DashboardFilters) => {
    // No filter by default — empty array means "request all tools from API"
    return filters.value[dashboard]?.toolIds || []
  })

  const activeMetricId = computed(() => (dashboard: keyof DashboardFilters) => {
    return filters.value[dashboard]?.metricId || 'ide.ai_suggestions_accepted'
  })

  const activeMetricIds = computed(() => (dashboard: keyof DashboardFilters) => {
    return filters.value[dashboard]?.metricIds || ['ide.ai_suggestions_accepted']
  })

  const activeProductivityMetrics = computed(() => (dashboard: keyof DashboardFilters) => {
    const filter = filters.value[dashboard]
    if (!filter) return ['ide.ai_suggestions_accepted']
    
    if (filter.productivityMetricId === 'all') {
      return filter.productivityMetricIds || [
        'ide.ai_suggestions_accepted',
        'ide.files_edited_per_session',
        'ide.commits_per_session',
        'ide.average_session_length_minutes',
        'ide.time_to_first_commit_minutes',
        'ide.AI_usage_duration_minutes',
        'ide.idle_time_minutes'
      ]
    }
    
    return [filter.productivityMetricId || 'ide.ai_suggestions_accepted'].filter(Boolean)
  })

  // Utility functions
  function getDefaultDateRange(): DateRange {
    // Use full historical telemetry by default for consistency across all surfaces
    // AI Ops, Performance Insights, and Productivity V3 all default to historical data
    return getAllTimeDateRange()
  }

  // All-time date range for historical telemetry views (matches AI Ops)
  // Returns empty strings to signal backend to return ALL historical data without bounds
  function getAllTimeDateRange(): DateRange {
    if (FILTERS_DEBUG) console.log('[PBT_ALL_TIME_STATE] getAllTimeDateRange called, returning empty strings')
    return { from: '', to: '' }
  }

  function isValidDateString(dateString: string): boolean {
    const date = new Date(dateString)
    return date instanceof Date && !isNaN(date.getTime())
  }

  function isValidViewBucket(value: string): value is ViewBucket {
    return ['daily', 'weekly', 'monthly'].includes(value)
  }

  function isValidScope(value: string): value is Scope {
    return ['org', 'team', 'dev'].includes(value)
  }

  // Export store interface
  return {
    // State
    filters,
    
    // Computed
    engineeringFilters,
    ideActivityFilters,
    productivityFilters,
    
    // Actions
    setDateRange,
    setRepos,
    setViewBucket,
    setScope,
    setDeveloperIds,
    setTeamIds,
    setToolIds,
    setMetricId,
    setMetricIds,
    setProductivityMetricId,
    setAllProductivityMetrics,
    setTimeComparison,
    setViewType,
    updateFilters,
    reset,
    resetAll,
    
    // Getters
    activeDateRange,
    activeRepos,
    activeViewBucket,
    activeScope,
    activeDeveloperIds,
    activeTeamIds,
    activeToolIds,
    activeMetricId,
    activeMetricIds,
    activeProductivityMetrics,
    
    // Utilities
    getDefaultDateRange,
    getAllTimeDateRange,
    isValidDateString,
    isValidViewBucket,
    isValidScope
  }
})
