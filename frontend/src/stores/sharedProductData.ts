// Shared Product Data Store - Connects insights to main product data
import { ref, computed } from 'vue'

// Shared reactive data that both main product and insights can access
export const sharedProductData = ref({
  // GitHub/Engineering data
  teamMetrics: null,
  
  // Productivity/IDE data
  simulatedMetricsHistory: null,
  historicalSnapshots: null,
  
  // Current filters
  timeFilter: 'week',
  selectedRepo: '',
  selectedDeveloper: '',
  selectedIDE: '',
  
  // Simulation state
  simulationRunning: false,
  
  // Timestamp
  lastUpdated: null
})

// Functions to update the shared data (called by main product)
export function updateSharedTeamMetrics(teamMetrics: any) {
  sharedProductData.value.teamMetrics = teamMetrics
  sharedProductData.value.lastUpdated = new Date().toISOString()
}

export function updateSharedSimulatedData(simulatedData: any, historicalData: any) {
  sharedProductData.value.simulatedMetricsHistory = simulatedData
  sharedProductData.value.historicalSnapshots = historicalData
  sharedProductData.value.lastUpdated = new Date().toISOString()
}

export function updateSharedFilters(timeFilter: string, selectedRepo: string, selectedDeveloper: string, selectedIDE: string) {
  sharedProductData.value.timeFilter = timeFilter
  sharedProductData.value.selectedRepo = selectedRepo
  sharedProductData.value.selectedDeveloper = selectedDeveloper
  sharedProductData.value.selectedIDE = selectedIDE
  sharedProductData.value.lastUpdated = new Date().toISOString()
}

export function updateSharedSimulationState(simulationRunning: boolean) {
  sharedProductData.value.simulationRunning = simulationRunning
  sharedProductData.value.lastUpdated = new Date().toISOString()
}

// Computed properties for insights to use
export const sharedTeamMetrics = computed(() => sharedProductData.value.teamMetrics)
export const sharedSimulatedData = computed(() => sharedProductData.value.simulatedMetricsHistory)
export const sharedHistoricalData = computed(() => sharedProductData.value.historicalSnapshots)
export const sharedTimeFilter = computed(() => sharedProductData.value.timeFilter)
export const sharedSelectedRepo = computed(() => sharedProductData.value.selectedRepo)
export const sharedSelectedDeveloper = computed(() => sharedProductData.value.selectedDeveloper)
export const sharedSelectedIDE = computed(() => sharedProductData.value.selectedIDE)
export const sharedSimulationRunning = computed(() => sharedProductData.value.simulationRunning)
export const sharedLastUpdated = computed(() => sharedProductData.value.lastUpdated)

// Debug info
export const sharedDataDebugInfo = computed(() => ({
  hasTeamMetrics: !!sharedProductData.value.teamMetrics,
  hasSimulatedData: !!sharedProductData.value.simulatedMetricsHistory,
  hasHistoricalData: !!sharedProductData.value.historicalSnapshots,
  timeFilter: sharedProductData.value.timeFilter,
  selectedRepo: sharedProductData.value.selectedRepo,
  selectedDeveloper: sharedProductData.value.selectedDeveloper,
  selectedIDE: sharedProductData.value.selectedIDE,
  simulationRunning: sharedProductData.value.simulationRunning,
  lastUpdated: sharedProductData.value.lastUpdated
}))




