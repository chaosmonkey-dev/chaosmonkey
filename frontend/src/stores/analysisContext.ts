// Analysis Context Store — shared analytical context for PI and PBT.
// AIOI remains org-level/40,000-foot and does NOT consume developer/repo drill-down from this store.
// PI and PBT share: timeRange, granularity, developerIds, repoIds, workflowIds.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DateRange } from '../types/filters'

export type TimePreset = '1d' | '7d' | '14d' | '30d' | '90d' | 'all' | 'custom'
export type Granularity = 'auto' | 'daily' | 'weekly' | 'monthly'

// CR-X PI/PBT-TIME: Single canonical all-time start sentinel.
// Both dataAccess.ts (PI) and telemetryToUnified.ts (PBT) must use this constant
// so that "All Time" produces identical backend request bounds.
export const ALL_TIME_START = '2020-01-01'

/**
 * K1B cohort scope: '' = all developers (no cohort filter — wire param
 * absent), 'unassigned' = invite-backed developers with no membership,
 * otherwise the numeric cohort id as a string.
 */
export type CohortSelection = '' | 'unassigned' | `${number}` | string

export interface AnalysisContext {
  timePreset: TimePreset
  dateRange: DateRange
  granularity: Granularity
  developerIds: string[]
  repoIds: string[]
  workflowIds: string[]
  cohortId: CohortSelection
}

function getAllTimeRange(): DateRange {
  return { from: '', to: '' }
}

// CR-X PI/PBT-TIME: Browser-local calendar date as 'YYYY-MM-DD'.
// Uses local getters (not toISOString) so the canonical date-only string
// matches the customer's wall clock in any timezone.  This must match
// localDateISO in lib/productivity/localDateISO.ts.
function localDateISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getPresetRange(preset: TimePreset): DateRange {
  if (preset === 'all') return { from: '', to: '' }
  if (preset === 'custom') return { from: '', to: '' } // custom must be set explicitly
  // CR-X PI/PBT-TIME: Inclusive calendar-date semantics.
  // Backend uses whereBetween(timestamp, [from, to]) which is INCLUSIVE on both ends.
  // Carbon::parse('YYYY-MM-DD') yields midnight at the START of that day.
  // Frontend (dataAccess.ts, telemetryToUnified.ts) appends T23:59:59.999Z to `to`
  // so the entire `to` day is included.
  // Therefore: for N calendar dates inclusive, `from` = today - (N-1) days, `to` = today.
  //   1d  → from=today,          to=today  → 1 date
  //   7d  → from=today-6,         to=today  → 7 dates
  //   30d → from=today-29,        to=today  → 30 dates
  //   90d → from=today-89,        to=today  → 90 dates
  const days = parseInt(preset)
  const to = new Date()
  const from = new Date(to.getTime() - (days - 1) * 86400000)
  return {
    from: localDateISO(from),
    to: localDateISO(to),
  }
}

function autoGranularity(range: DateRange): Granularity {
  if (!range.from || !range.to) return 'weekly' // all-time
  const fromMs = new Date(range.from).getTime()
  const toMs = new Date(range.to).getTime()
  const days = (toMs - fromMs) / 86400000
  if (days <= 14) return 'daily'
  if (days <= 90) return 'weekly'
  return 'monthly'
}

export const useAnalysisContextStore = defineStore('analysisContext', () => {
  const timePreset = ref<TimePreset>('all')
  const dateRange = ref<DateRange>(getAllTimeRange())
  const granularity = ref<Granularity>('auto')
  const developerIds = ref<string[]>([])
  const repoIds = ref<string[]>([])
  const workflowIds = ref<string[]>([])
  const cohortId = ref<CohortSelection>('')

  const effectiveGranularity = computed<Granularity>(() => {
    if (granularity.value !== 'auto') return granularity.value
    return autoGranularity(dateRange.value)
  })

  const isAllTime = computed(() => timePreset.value === 'all' || (!dateRange.value.from && !dateRange.value.to))

  const hasFilters = computed(() =>
    developerIds.value.length > 0 || repoIds.value.length > 0 || workflowIds.value.length > 0
      || (cohortId.value !== '' && cohortId.value !== 'all')
  )

  const populationLabel = computed(() => {
    const parts: string[] = []
    if (isAllTime.value) {
      parts.push('All Time')
    } else if (timePreset.value === 'custom') {
      parts.push(`${dateRange.value.from} to ${dateRange.value.to}`)
    } else {
      parts.push(`Last ${timePreset.value}`)
    }
    if (developerIds.value.length === 1) {
      parts.push(`Developer ${developerIds.value[0]}`)
    } else if (developerIds.value.length > 1) {
      parts.push(`${developerIds.value.length} developers`)
    }
    if (repoIds.value.length === 1) {
      parts.push(`Repo ${repoIds.value[0]}`)
    } else if (repoIds.value.length > 1) {
      parts.push(`${repoIds.value.length} repos`)
    }
    if (workflowIds.value.length > 0) {
      parts.push(workflowIds.value.length === 1 ? `Workflow ${workflowIds.value[0]}` : `${workflowIds.value.length} workflows`)
    }
    if (cohortId.value === 'unassigned') {
      parts.push('Unassigned developers')
    } else if (cohortId.value !== '' && cohortId.value !== 'all') {
      parts.push(`Cohort ${cohortId.value}`)
    }
    return parts.join(' · ')
  })

  // API query params derived from context
  const apiParams = computed(() => {
    const params: Record<string, string> = {}
    if (dateRange.value.from) params.from = dateRange.value.from
    if (dateRange.value.to) params.to = dateRange.value.to
    if (developerIds.value.length > 0) params.developer_ids = developerIds.value.join(',')
    if (repoIds.value.length > 0) params.repo_ids = repoIds.value.join(',')
    if (workflowIds.value.length > 0) params.tool_ids = workflowIds.value.join(',')
    if (cohortId.value !== '') params.cohort_id = cohortId.value
    return params
  })

  // GitHub time_filter derived from context
  const githubTimeFilter = computed(() => {
    if (isAllTime.value) return 'all'
    return `${dateRange.value.from},${dateRange.value.to}`
  })

  function setTimePreset(preset: TimePreset) {
    timePreset.value = preset
    if (preset !== 'custom') {
      dateRange.value = getPresetRange(preset)
    }
  }

  function setCustomDateRange(from: string, to: string) {
    timePreset.value = 'custom'
    dateRange.value = { from, to }
  }

  function setGranularity(g: Granularity) {
    granularity.value = g
  }

  function setDeveloperIds(ids: string[]) {
    developerIds.value = ids.filter(id => id.trim().length > 0)
  }

  function setRepoIds(ids: string[]) {
    repoIds.value = ids.filter(id => id.trim().length > 0)
  }

  function setWorkflowIds(ids: string[]) {
    workflowIds.value = ids.filter(id => id.trim().length > 0)
  }

  // K1B: cohort scope — '' clears to all developers.
  function setCohortId(id: CohortSelection) {
    cohortId.value = id === 'all' ? '' : id
  }

  function reset() {
    timePreset.value = 'all'
    dateRange.value = getAllTimeRange()
    granularity.value = 'auto'
    developerIds.value = []
    repoIds.value = []
    workflowIds.value = []
    cohortId.value = ''
  }

  return {
    // State
    timePreset,
    dateRange,
    granularity,
    developerIds,
    repoIds,
    workflowIds,
    cohortId,
    // Computed
    effectiveGranularity,
    isAllTime,
    hasFilters,
    populationLabel,
    apiParams,
    githubTimeFilter,
    // Actions
    setTimePreset,
    setCustomDateRange,
    setGranularity,
    setDeveloperIds,
    setRepoIds,
    setWorkflowIds,
    setCohortId,
    reset,
  }
})
