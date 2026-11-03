// Main Product Data Exposure - Add this to HelloWorld.vue
// This exposes the main product's reactive data to the insights system

// Add this to the script setup section of HelloWorld.vue:
/*
// Expose main product data to insights system
onMounted(() => {
  // Expose the main product instance to global scope
  (window as any).mainProductInstance = {
    metrics: metrics,
    simulatedMetricsHistory: simulatedMetricsHistory,
    historicalSnapshots: historicalSnapshots,
    timeFilter: timeFilter,
    selectedRepo: selectedRepo,
    selectedDeveloper: selectedDeveloper,
    selectedIDE: selectedIDE,
    simulationRunning: simulationRunning
  }
  
  console.log('🔗 Main product data exposed to insights system')
})

// Update the exposed data whenever it changes
watch([metrics, simulatedMetricsHistory, historicalSnapshots], () => {
  if ((window as any).mainProductInstance) {
    (window as any).mainProductInstance.metrics = metrics
    ;(window as any).mainProductInstance.simulatedMetricsHistory = simulatedMetricsHistory
    ;(window as any).mainProductInstance.historicalSnapshots = historicalSnapshots
  }
}, { deep: true })
*/

// Alternative: Simple data injection function
export function exposeMainProductData(mainProductRefs: any) {
  if (typeof window !== 'undefined') {
    (window as any).mainProductInstance = mainProductRefs
    console.log('🔗 Main product data exposed to insights system:', mainProductRefs)
  }
}

// Call this from the main product whenever data changes
export function updateMainProductData(mainProductRefs: any) {
  if (typeof window !== 'undefined') {
    (window as any).mainProductInstance = mainProductRefs
  }
}




