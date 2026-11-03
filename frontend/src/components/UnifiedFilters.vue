<template>
  <div class="unified-filters">
    <div class="cicd-section card mb-3 stage-filters" style="margin-bottom: 0.625rem;">
      <div class="card-body" style="padding: 0.75rem;">
        <!-- Section Header -->
        <div class="cicd-section-header d-flex align-items-center justify-content-between mb-2" style="padding-bottom: 0.25rem; margin-bottom: 0.5rem;">
          <div class="d-flex align-items-center">
            <div class="stage-icon-wrapper me-2 bg-dark" style="width: 40px; height: 40px; border-radius: 10px; font-size: 1.1rem;">
              <i class="bi bi-sliders text-white"></i>
            </div>
            <div>
              <h5 class="mb-0 fw-bold text-dark" style="font-size: 0.95rem; margin-bottom: 0.125rem; letter-spacing: -0.01em;">Dashboard Controls</h5>
              <small class="text-muted fw-medium" style="font-size: 0.7rem; letter-spacing: 0.01em;">Time periods, metrics, and filters</small>
            </div>
          </div>
          <!-- Advanced Settings Toggle -->
          <button 
            class="btn btn-outline-secondary btn-sm"
            @click="showAdvancedFilters = !showAdvancedFilters"
            style="font-size: 0.7rem; padding: 0.25rem 0.5rem; border-radius: 0.25rem;"
          >
            <i class="bi me-1" :class="showAdvancedFilters ? 'bi-chevron-up' : 'bi-chevron-down'" style="font-size: 0.7rem;"></i>
            {{ showAdvancedFilters ? 'Hide' : 'Show' }} Advanced
          </button>
        </div>
        
        <!-- Filter Controls -->
        <div class="filters-body">
        <div class="row g-2">
          <!-- Combined Time Range & Comparison Mode -->
          <div class="col-md-3">
            <label class="form-label fw-semibold text-dark mb-1" style="font-size: 0.7rem; margin-bottom: 0.25rem; letter-spacing: 0.05em;">
              <i class="bi bi-graph-up me-1 text-primary" style="font-size: 0.7rem;"></i>Time Period
            </label>
            <select 
              v-model="selectedTimeComparison" 
              class="form-select form-select-sm" 
              @change="handleChange"
              style="font-size: 0.75rem; padding: 0.375rem 0.5rem; border-radius: 0.25rem;"
            >
              <option value="wow">Week-over-Week</option>
              <option value="mom">Month-over-Month</option>
              <option value="qoq">Quarter-over-Quarter</option>
              <option value="dod">Day-over-Day</option>
              <option value="hoh">Hour-over-Hour</option>
              <option value="all">All Time</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          <!-- View Type Selection -->
          <div class="col-md-3" v-if="showViewTypeFilter">
            <label class="form-label fw-semibold text-dark mb-1" style="font-size: 0.7rem; margin-bottom: 0.25rem; letter-spacing: 0.05em;">
              <i class="bi bi-eye me-1 text-primary" style="font-size: 0.7rem;"></i>View Type
            </label>
            <select 
              v-model="selectedViewType" 
              class="form-select form-select-sm" 
              @change="handleChange"
              style="font-size: 0.75rem; padding: 0.375rem 0.5rem; border-radius: 0.25rem;"
            >
              <option value="cards">Performance Cards</option>
              <option value="linegraph">Time Series</option>
            </select>
          </div>

          <!-- Productivity Metric -->
          <div class="col-md-3" v-if="showProductivityMetricFilter">
            <label class="form-label fw-semibold text-dark mb-1" style="font-size: 0.7rem; margin-bottom: 0.25rem; letter-spacing: 0.05em;">
              <i class="bi bi-graph-down me-1 text-primary" style="font-size: 0.7rem;"></i>Metric
            </label>
            <select 
              v-model="selectedProductivityMetric" 
              class="form-select form-select-sm" 
              @change="handleChange"
              style="font-size: 0.75rem; padding: 0.375rem 0.5rem; border-radius: 0.25rem;"
            >
              <option value="all">All Metrics</option>
              <option value="AI_suggestions_accepted">AI Suggestions</option>
              <option value="files_edited_per_session">Files/Session</option>
              <option value="commits_per_session">Commits/Session</option>
              <option value="average_session_length_minutes">Session Length</option>
              <option value="time_to_first_commit_minutes">Time to First Commit</option>
              <option value="AI_usage_duration_minutes">AI Duration</option>
              <option value="active_coding_time_minutes">Active Coding</option>
              <option value="idle_time_minutes">Idle Time</option>
            </select>
          </div>

          <!-- IDE Filter -->
          <div class="col-md-3" v-if="showIdeFilter">
            <label class="form-label fw-semibold text-dark mb-1" style="font-size: 0.7rem; margin-bottom: 0.25rem; letter-spacing: 0.05em;">
              <i class="bi bi-code-square me-1 text-primary" style="font-size: 0.7rem;"></i>IDE
            </label>
            <select 
              v-model="selectedIde" 
              class="form-select form-select-sm" 
              @change="handleChange"
              style="font-size: 0.75rem; padding: 0.375rem 0.5rem; border-radius: 0.25rem;"
            >
              <option value="">All IDEs</option>
              <option v-for="ide in supportedIdes" :key="ide.id" :value="ide.id">
                {{ ide.name }}
              </option>
            </select>
          </div>

          <!-- Advanced Filters (Collapsible) -->
          <div class="row g-3 mt-2" v-if="showAdvancedFilters">
            <!-- Developer Filter -->
            <div class="col-md-3">
              <label class="form-label fw-semibold text-dark">
                <i class="bi bi-person-badge me-1"></i>Select Developer
              </label>
              <select 
                v-model="selectedDeveloper" 
                class="form-select" 
                :disabled="selectedTeam !== ''"
                @change="handleChange"
              >
                <option value="">All Developers</option>
                <option v-for="dev in supportedDevelopers" :key="dev.id" :value="dev.id">
                  {{ dev.name }}
                  <span v-if="dev.team"> ({{ dev.team }})</span>
                </option>
              </select>
              <div class="form-text text-muted">
                <i class="bi bi-info-circle me-1"></i>
                <span v-if="selectedTeam !== ''">
                  Developer filter disabled when team is selected
                </span>
                <span v-else>
                  Filter metrics by specific developer
                </span>
              </div>
            </div>

            <!-- Repository Filter -->
            <div class="col-md-3">
              <label class="form-label fw-semibold text-dark">
                <i class="bi bi-git me-1"></i>Repository
              </label>
              <select 
                v-model="selectedRepo" 
                class="form-select" 
                @change="handleChange"
                :disabled="loading"
              >
                <option value="">All Repositories</option>
                <option v-for="repo in repositories" :key="repo.name" :value="repo.name">
                  {{ repo.name }}
                  <span v-if="repo.language"> ({{ repo.language }})</span>
                </option>
              </select>
              <div class="form-text text-muted d-flex align-items-center">
                <i class="bi bi-info-circle me-1"></i>
                Filter metrics by repository
                <button 
                  v-if="repositories.length === 0"
                  @click="refreshRepositories" 
                  class="btn btn-outline-secondary btn-sm ms-2"
                  title="Refresh repository list"
                >
                  <i class="bi bi-arrow-clockwise"></i>
                </button>
              </div>
            </div>

            <!-- View Type Filter -->
            <div class="col-md-3" v-if="showViewTypeFilter">
              <label class="form-label fw-semibold text-dark">
                <i class="bi bi-layout-wtf me-1"></i>View Type
              </label>
              <select 
                v-model="selectedViewType" 
                class="form-select" 
                @change="handleChange"
              >
                <option value="cards">Cards View</option>
                <option value="line">Line Graph</option>
              </select>
              <div class="form-text text-muted">
                <i class="bi bi-info-circle me-1"></i>
                Choose display format
              </div>
            </div>

            <!-- Team Filter -->
            <div class="col-md-3">
              <label class="form-label fw-semibold text-dark">
                <i class="bi bi-people me-1"></i>Select Team
              </label>
              <select 
                v-model="selectedTeam" 
                class="form-select" 
                @change="handleChange"
              >
                <option value="">All Teams</option>
                <option v-for="team in supportedTeams" :key="team.id" :value="team.id">
                  {{ team.name }}
                  <span v-if="team.memberCount"> ({{ team.memberCount }} members)</span>
                </option>
              </select>
              <div class="form-text text-muted">
                <i class="bi bi-info-circle me-1"></i>
                Filter metrics by specific team
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Custom Date Range (shown when custom is selected) -->
    <div v-if="selectedTimeComparison === 'custom'" class="row mt-3">
      <div class="col-md-6">
        <div class="row g-2">
          <div class="col-6">
            <label class="form-label fw-semibold text-dark">Start Date</label>
            <input 
              type="date" 
              v-model="customStartDate" 
              class="form-control"
              @change="handleChange"
            >
          </div>
          <div class="col-6">
            <label class="form-label fw-semibold text-dark">End Date</label>
            <input 
              type="date" 
              v-model="customEndDate" 
              class="form-control"
              @change="handleChange"
            >
          </div>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { useFilterStore } from '../stores/filters'
import { useIdentitiesStore } from '../stores/identities'
import { useMetricsFacadeStore } from '../stores/metricsFacade'
import { useAnalysisContextStore } from '../stores/analysisContext'

// Store instances
const filters = useFilterStore()
const identities = useIdentitiesStore()
const metricsFacadeStore = useMetricsFacadeStore()
const analysisContext = useAnalysisContextStore()

// Telemetry Mode
const telemetryMode = computed({
  get: () => metricsFacadeStore.telemetryMode,
  set: (val) => metricsFacadeStore.setTelemetryMode(val)
})

function handleTelemetryModeChange() {
  console.info(`[metricsFacade] Mode: ${telemetryMode.value === 'live' ? 'Live Telemetry' : 'Simulation'}`)
  metricsFacadeStore.refreshMetrics('week')
}

// Props
const props = defineProps({
  initialRepo: {
    type: String,
    default: ''
  },
  initialViewType: {
    type: String,
    default: 'cards'
  },
  initialProductivityMetric: {
    type: String,
    default: 'AI_suggestions_accepted'
  },
  initialIde: {
    type: String,
    default: 'all'
  },
  repositories: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  showIdeFilter: {
    type: Boolean,
    default: false
  },
  showViewTypeFilter: {
    type: Boolean,
    default: true
  },
  showProductivityMetricFilter: {
    type: Boolean,
    default: true
  },
  supportedIdes: {
    type: Array,
    default: () => []
  },
  supportedDevelopers: {
    type: Array,
    default: () => []
  },
  supportedTeams: {
    type: Array,
    default: () => []
  }
})

// Emits
const emit = defineEmits([
  'refresh-repositories',
  'update:productivity-metric',
  'update:view-type',
  'update:ide',
  'change',
  'ide-change'
])

// Reactive data
const selectedTimeComparison = ref('wow') // Changed from selectedRange and selectedComparison
const selectedRepo = ref(props.initialRepo || '')
const selectedViewType = ref(props.initialViewType || 'cards')
const selectedProductivityMetric = ref(props.initialProductivityMetric || 'AI_suggestions_accepted')
const selectedIde = ref('')
const selectedDeveloper = ref('')
const selectedTeam = ref('')

// Watch for changes and emit events
watch(selectedProductivityMetric, (newValue) => {
  emit('update:productivity-metric', newValue)
})

watch(selectedViewType, (newValue) => {
  emit('update:view-type', newValue)
})

watch(selectedIde, (newValue) => {
  emit('update:ide', newValue)
})
const customStartDate = ref('')
const customEndDate = ref('')
const showAdvancedFilters = ref(false) // Advanced settings toggle state

// Local storage keys
const STORAGE_KEYS = {
  TIME_COMPARISON: 'codesight_time_comparison',
  REPOSITORY: 'codesight_repository',
  VIEW_TYPE: 'codesight_view_type',
  PRODUCTIVITY_METRIC: 'codesight_productivity_metric',
  IDE: 'codesight_ide',
  DEVELOPER: 'codesight_developer',
  TEAM: 'codesight_team',
  CUSTOM_START: 'codesight_custom_start',
  CUSTOM_END: 'codesight_custom_end'
}

// Constants
const supportedIdes = [
  {id:'cursor',name:'Cursor'},
  {id:'windsurf',name:'Windsurf'},
  {id:'vscode',name:'VS Code'},
  {id:'jetbrains',name:'JetBrains IDEs'},
  {id:'sublime',name:'Sublime Text'},
  {id:'vim',name:'Vim/Neovim'}
]

const METRIC_MAP = {
  AI_suggestions_accepted: 'ide.ai_suggestions_accepted',
  files_edited_per_session: 'ide.files_edited_per_session',
  commits_per_session: 'ide.commits_per_session',
  average_session_length_minutes: 'ide.average_session_length_minutes', // Fixed: was 'ide.avg_session_length'
  time_to_first_commit_minutes: 'ide.time_to_first_commit_minutes', // CRITICAL FIX: was missing '_minutes' suffix
  AI_usage_duration_minutes: 'ide.AI_usage_duration_minutes', // Fixed: was 'ide.ai_usage_duration'
  active_coding_time_minutes: 'ide.active_coding_time_minutes', // Active coding time metric
  idle_time_minutes: 'ide.idle_time_minutes' // Fixed: was 'ide.idle_time'
}

// Computed properties
const getSelectedRepoDetails = computed(() => {
  if (!selectedRepo.value) return null
  return props.repositories.find(repo => repo.name === selectedRepo.value)
})

const supportedDevelopers = computed(() => identities.devs)
const supportedTeams = computed(() => identities.teams)

// Load saved preferences from localStorage
function loadSavedPreferences() {
  try {
    const savedTimeComparison = localStorage.getItem(STORAGE_KEYS.TIME_COMPARISON)
    const savedRepo = localStorage.getItem(STORAGE_KEYS.REPOSITORY)
    const savedViewType = localStorage.getItem(STORAGE_KEYS.VIEW_TYPE)
    const savedProductivityMetric = localStorage.getItem(STORAGE_KEYS.PRODUCTIVITY_METRIC)
    const savedIde = localStorage.getItem(STORAGE_KEYS.IDE)
    const savedDeveloper = localStorage.getItem(STORAGE_KEYS.DEVELOPER)
    const savedTeam = localStorage.getItem(STORAGE_KEYS.TEAM)
    const savedStart = localStorage.getItem(STORAGE_KEYS.CUSTOM_START)
    const savedEnd = localStorage.getItem(STORAGE_KEYS.CUSTOM_END)
    
    if (savedTimeComparison) selectedTimeComparison.value = savedTimeComparison
    if (savedRepo) selectedRepo.value = savedRepo
    if (savedViewType) selectedViewType.value = savedViewType
    if (savedProductivityMetric) selectedProductivityMetric.value = savedProductivityMetric
    if (savedIde) selectedIde.value = savedIde
    else selectedIde.value = ''
    if (savedDeveloper) selectedDeveloper.value = savedDeveloper
    if (savedTeam) selectedTeam.value = savedTeam
    if (savedStart) customStartDate.value = savedStart
    if (savedEnd) customEndDate.value = savedEnd
  } catch (error) {
    console.warn('Failed to load filter preferences:', error)
  }
}

// Compute range and bucket based on time comparison
function computeRangeAndBucket(kind, customStart, customEnd) {
  const now = new Date()
  let from, to, bucket
  
  const DAY_MS = 24 * 60 * 60 * 1000
  
  if (kind === 'custom' && customStart && customEnd) {
    from = customStart
    to = customEnd
  } else {
    switch (kind) {
      case 'dod':
        // CR-X PI/PBT-TIME: "Last Day" = 1 calendar date inclusive (today).
        to = now.toISOString().split('T')[0]
        from = to // from = to = today → 1 date inclusive
        bucket = 'daily'
        break
      case 'hoh':
        to = now.toISOString().split('T')[0]
        from = to // same as dod — hourly granularity not separately bounded
        bucket = 'daily'
        break
      case 'wow':
        // CR-X PI/PBT-TIME: "Last Week" = 7 calendar dates inclusive.
        // from = today - 6 days → 7 dates inclusive (today-6 .. today).
        to = now.toISOString().split('T')[0]
        from = new Date(now.getTime() - 6 * DAY_MS).toISOString().split('T')[0]
        bucket = 'daily'
        break
      case 'mom':
        // CR-X PI/PBT-TIME: "Last Month" = 30 calendar dates inclusive.
        to = now.toISOString().split('T')[0]
        from = new Date(now.getTime() - 29 * DAY_MS).toISOString().split('T')[0]
        bucket = 'weekly'
        break
      case 'qoq':
        // CR-X PI/PBT-TIME: "Last Quarter" = 90 calendar dates inclusive.
        to = now.toISOString().split('T')[0]
        from = new Date(now.getTime() - 89 * DAY_MS).toISOString().split('T')[0]
        bucket = 'monthly'
        break
      case 'all':
        to = now.toISOString().split('T')[0]
        from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        bucket = 'monthly'
        break
      default:
        to = now.toISOString().split('T')[0]
        from = new Date(now.getTime() - 6 * DAY_MS).toISOString().split('T')[0] // 6 days ago for default week
        bucket = 'daily'
    }
  }
  
  // Determine bucket based on date range if not already set
  if (!bucket) {
    const daysDiff = Math.ceil((new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24))
    if (daysDiff <= 14) {
      bucket = 'daily'
    } else if (daysDiff <= 60) {
      bucket = 'weekly'
    } else {
      bucket = 'monthly'
    }
  }
  
  console.debug('[UnifiedFilters] computeRangeAndBucket', {
    kind,
    from,
    to,
    bucket,
    daysInRange: Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS) + 1
  })
  
  return { from, to, bucket }
}

// Save preferences to localStorage
function savePreferences() {
  try {
    localStorage.setItem(STORAGE_KEYS.TIME_COMPARISON, selectedTimeComparison.value)
    localStorage.setItem(STORAGE_KEYS.REPOSITORY, selectedRepo.value)
    localStorage.setItem(STORAGE_KEYS.VIEW_TYPE, selectedViewType.value)
    localStorage.setItem(STORAGE_KEYS.PRODUCTIVITY_METRIC, selectedProductivityMetric.value)
    localStorage.setItem(STORAGE_KEYS.IDE, selectedIde.value)
    localStorage.setItem(STORAGE_KEYS.DEVELOPER, selectedDeveloper.value)
    localStorage.setItem(STORAGE_KEYS.TEAM, selectedTeam.value)
    localStorage.setItem(STORAGE_KEYS.CUSTOM_START, customStartDate.value)
    localStorage.setItem(STORAGE_KEYS.CUSTOM_END, customEndDate.value)
  } catch (error) {
    console.warn('Failed to save filter preferences:', error)
  }
}

// Handle any filter change
function handleChange() {
  const {from, to, bucket} = computeRangeAndBucket(selectedTimeComparison.value, customStartDate.value, customEndDate.value)
  
  // Handle team-developer relationship logic
  let finalTeamIds = []
  let finalDeveloperIds = []
  
  if (selectedTeam.value && selectedDeveloper.value) {
    // If both team and developer are selected, prioritize developer (more specific)
    finalDeveloperIds = [selectedDeveloper.value]
    finalTeamIds = []
    // Clear team selection to avoid conflicts
    selectedTeam.value = ''
  } else if (selectedTeam.value) {
    // If only team is selected, get all developers in that team
    finalTeamIds = [selectedTeam.value]
    const teamDevs = identities.devs.filter(dev => dev.teamId === selectedTeam.value)
    finalDeveloperIds = teamDevs.map(dev => dev.id)
    // Clear developer selection when team is selected
    selectedDeveloper.value = ''
  } else if (selectedDeveloper.value) {
    // If only developer is selected, get their team
    finalDeveloperIds = [selectedDeveloper.value]
    const dev = identities.devs.find(d => d.id === selectedDeveloper.value)
    if (dev) {
      finalTeamIds = [dev.teamId]
    }
  }
  
  // Update filters store
  filters.setDateRange('productivity', {from, to})
  filters.setViewBucket('productivity', bucket === 'daily' || bucket === 'weekly' || bucket === 'monthly' ? bucket : 'daily')
  filters.setRepos('productivity', selectedRepo.value ? [selectedRepo.value] : [])
  filters.setDeveloperIds('productivity', finalDeveloperIds)
  filters.setTeamIds('productivity', finalTeamIds)
  filters.setViewType('productivity', selectedViewType.value)

  // 🔥 PHASE 1A: UnifiedFilters owns timeComparison persistence
  filters.setTimeComparison('productivity', selectedTimeComparison.value)

  // CR-X Track A: Update shared analysis context for PI+PBT convergence.
  // CR-X PI/PBT-TIME: Use exact computed from/to via setCustomDateRange
  // so PI and PBT get identical date bounds.  Previously this collapsed
  // dod/wow/mom/qoq into coarse 7d/30d/90d presets that did NOT match the
  // computed from/to written to filterStore, causing PI/PBT divergence.
  if (selectedTimeComparison.value === 'custom' && customStartDate.value && customEndDate.value) {
    analysisContext.setCustomDateRange(customStartDate.value, customEndDate.value)
  } else if (selectedTimeComparison.value === 'all') {
    analysisContext.setTimePreset('all')
  } else {
    // For dod/wow/mom/qoq: write the exact computed from/to as a custom range
    // so PI and PBT receive identical bounds (no coarse-preset mismatch).
    analysisContext.setCustomDateRange(from, to)
  }
  // Map granularity
  const granularityMap = { 'daily': 'daily', 'weekly': 'weekly', 'monthly': 'monthly' }
  analysisContext.setGranularity(granularityMap[bucket] || 'auto')
  // Sync developer/repo/workflow to analysis context
  analysisContext.setDeveloperIds(finalDeveloperIds)
  analysisContext.setRepoIds(selectedRepo.value ? [selectedRepo.value] : [])
  analysisContext.setWorkflowIds(selectedIde.value ? [selectedIde.value] : [])
  
  const toolIds = selectedIde.value ? [selectedIde.value] : supportedIdes.map(x => x.id)
  
  // Handle "all" metrics selection - set all available productivity metrics
  if (selectedProductivityMetric.value === 'all') {
    // Set all available productivity metric IDs in the filter store
    const allMetricIds = Object.keys(METRIC_MAP).map(key => METRIC_MAP[key])
    filters.updateFilters('productivity', { 
      toolIds, 
      metricIds: allMetricIds  // Use plural for multiple metrics
    })
  } else {
    // Single metric selection - existing behavior
    filters.updateFilters('productivity', { 
      toolIds, 
      metricId: METRIC_MAP[selectedProductivityMetric.value] || 'ide.ai_suggestions_accepted' 
    })
  }
  
  savePreferences()
  emitChange()
  
  // Emit IDE change event separately if IDE filter is enabled
  if (props.showIdeFilter) {
    emit('ide-change', selectedIde.value)
  }
}

// Emit change event with current values
function emitChange() {
  emit('change', {
    timeComparison: selectedTimeComparison.value,
    repository: selectedRepo.value,
    viewType: selectedViewType.value,
    productivityMetric: selectedProductivityMetric.value,
    ide: selectedIde.value,
    developer: selectedDeveloper.value,
    team: selectedTeam.value,
    customStartDate: customStartDate.value,
    customEndDate: customEndDate.value
  })
}

// Clear all filters
function clearFilters() {
  selectedRepo.value = ''
  selectedViewType.value = props.initialViewType || 'cards'
  selectedProductivityMetric.value = props.initialProductivityMetric || 'AI_suggestions_accepted'
  selectedIde.value = ''
  selectedDeveloper.value = ''
  selectedTeam.value = ''
  customStartDate.value = ''
  customEndDate.value = ''
  savePreferences()
  emitChange()
  
  // Emit IDE change event
  if (props.showIdeFilter) {
    emit('ide-change', '')
  }
}

// Reset to default values
function resetToDefaults() {
  selectedTimeComparison.value = 'wow' // Changed from selectedRange.value
  selectedRepo.value = props.initialRepo || ''
  selectedViewType.value = props.initialViewType || 'cards'
  selectedProductivityMetric.value = props.initialProductivityMetric || 'AI_suggestions_accepted'
  selectedIde.value = ''
  customStartDate.value = ''
  customEndDate.value = ''
  savePreferences()
  emitChange()
  
  // Emit IDE change event
  if (props.showIdeFilter) {
    emit('ide-change', '')
  }
}

// Refresh repositories
function refreshRepositories() {
  emit('refresh-repositories')
}

// Get range description
function getTimeComparisonDescription(comparison) {
  const descriptions = {
    wow: 'Compare with previous week (Last 7 days)',
    mom: 'Compare with previous month (Last 30 days)',
    qoq: 'Compare with previous quarter (Last 90 days)',
    dod: 'Compare with previous day (Last 24 hours)',
    hoh: 'Compare with previous hour (Last 60 minutes)',
    all: 'No comparison data',
    custom: 'Custom date range'
  }
  return descriptions[comparison] || ''
}

// Get IDE name by ID
function getIdeName(id) {
  const ide = props.supportedIdes.find(item => item.id === id)
  return ide ? ide.name : id
}

// Get Developer name by ID
function getDeveloperName(id) {
  if (!id) return 'All Developers'
  const developer = props.supportedDevelopers.find(item => item.id === id)
  return developer ? developer.name : id
}

// Get Team name by ID
function getTeamName(id) {
  if (!id) return 'All Teams'
  const team = props.supportedTeams.find(item => item.id === id)
  return team ? team.name : id
}

// Get label for the combined time period and comparison
function getTimeComparisonLabel(comparison) {
  const labels = {
    wow: 'Week-over-Week',
    mom: 'Month-over-Month',
    qoq: 'Quarter-over-Quarter',
    dod: 'Day-over-Day',
    hoh: 'Hour-over-Hour',
    all: 'All Time',
    custom: 'Custom Range'
  }
  return labels[comparison] || comparison
}

// Get label for the productivity metric
function getProductivityMetricLabel(metric) {
  const labels = {
    all: 'All Productivity Metrics',
    AI_suggestions_accepted: 'AI Suggestions Accepted',
    files_edited_per_session: 'Files per Session',
    commits_per_session: 'Commits per Session',
    average_session_length_minutes: 'Average Session Length',
    time_to_first_commit_minutes: 'Time to First Commit',
    AI_usage_duration_minutes: 'AI Usage Duration',
    active_coding_time_minutes: 'Active Coding Time',
    idle_time_minutes: 'Idle Time'
  }
  return labels[metric] || metric
}

// Watch for prop changes and update local state
watch(() => props.initialRepo, (newRepo) => {
  if (newRepo !== selectedRepo.value) {
    selectedRepo.value = newRepo
    savePreferences()
  }
})

watch(() => props.showIdeFilter, (newShow) => {
  if (newShow !== props.showIdeFilter) {
    // If showIdeFilter becomes true, ensure selectedIde is empty or default
    if (newShow && !selectedIde.value) {
      selectedIde.value = ''
    }
  }
})

watch(() => props.supportedIdes, (newIdes) => {
  if (newIdes && newIdes.length > 0) {
    // If supportedIdes changes, ensure selectedIde is one of the new options
    if (!selectedIde.value || !newIdes.some(ide => ide.id === selectedIde.value)) {
      selectedIde.value = newIdes[0]?.id || ''
    }
  }
})

// Lifecycle
onMounted(() => {
  loadSavedPreferences()
  // CRITICAL: Call handleChange() to compute correct date range for selected time comparison
  // This ensures the filter store gets the correct from/to dates based on selectedTimeComparison
  // (e.g., for 'wow', computes from = today - 6 days, to = today)
  // Without this, the filter store keeps the stale default 14-day range
  handleChange()
})
</script>

<style scoped>
.unified-filters .form-select,
.unified-filters .form-control {
  border: 1px solid #dee2e6;
  border-radius: 0.75rem;
  transition: all 0.3s ease-in-out;
  background: white;
}

.unified-filters .form-select:focus,
.unified-filters .form-control:focus {
  border-color: #0d6efd;
  box-shadow: 0 0 0 0.25rem rgba(13, 110, 253, 0.15);
  transform: translateY(-1px);
}

.unified-filters .form-label {
  color: #495057;
  font-weight: 600;
}

.unified-filters .form-text {
  font-size: 0.875rem;
  color: #6c757d !important;
}

.unified-filters .alert {
  background-color: #f8f9fa;
  border-color: #dee2e6;
}

.unified-filters .badge {
  font-size: 0.875rem;
  padding: 0.5rem 0.75rem;
}

.unified-filters .btn-outline-secondary:hover {
  background-color: #6c757d;
  border-color: #6c757d;
  color: white;
}

.unified-filters .btn-outline-primary:hover {
  background-color: #0d6efd;
  border-color: #0d6efd;
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(13, 110, 253, 0.3);
}

/* Enhanced card styling */
.unified-filters .card {
  border-radius: 1rem;
  border: 1px solid #e9ecef;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease-in-out;
}

.unified-filters .card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.12);
}

.unified-filters .card-header {
  background: linear-gradient(135deg, #0d6efd 0%, #0b5ed7 100%);
  border-radius: 1rem 1rem 0 0;
  border-bottom: none;
}

/* Enhanced alert styling */
.unified-filters .alert {
  border-radius: 0.75rem;
  border: none;
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* ====== CI/CD Section Styles (matching ProductivityOverTime) ====== */

/* Section card container */
.cicd-section {
  border-radius: 1rem;
  border-left: 4px solid transparent;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  animation: fadeInUp 0.5s ease-out;
}

.cicd-section:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

/* Filters section styling */
.cicd-section.stage-filters {
  border-left-color: #6c757d; /* dark/secondary for filters */
}

/* Section header */
.cicd-section-header {
  padding-bottom: 1rem;
  border-bottom: 2px solid #f0f0f0;
}

/* Stage icon wrapper */
.stage-icon-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  font-size: 1.25rem;
}

/* Fade-in animation */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
