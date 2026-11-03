// Data Injection Script - Add this to the main product to expose data to insights
// This should be added to the main product (HelloWorld.vue) to expose data to the insights system

export function exposeDataToInsights() {
  // Expose the main product's data to the global scope for insights to access
  if (typeof window !== 'undefined') {
    // Get the main product's data
    const mainProductData = {
      // GitHub/Engineering data
      team_metrics: metrics.value?.team_metrics || null,
      
      // Productivity/IDE data  
      simulatedMetricsHistory: simulatedMetricsHistory.value || null,
      historicalSnapshots: historicalSnapshots.value || null,
      
      // Current filters
      timeFilter: timeFilter.value,
      selectedRepo: selectedRepo.value,
      selectedDeveloper: selectedDeveloper.value,
      selectedIDE: selectedIDE.value,
      
      // Simulation state
      simulationRunning: simulationRunning.value,
      
      // Timestamp for debugging
      lastUpdated: new Date().toISOString()
    }
    
    // Inject into global scope
    (window as any).mainProductData = mainProductData
    
    console.log('🔗 Data exposed to insights system:', mainProductData)
  }
}

// Call this function whenever the main product's data changes
// Add this to the main product's watch functions or data update handlers
export function updateInsightsData() {
  exposeDataToInsights()
}

// Auto-expose data on page load
if (typeof window !== 'undefined') {
  // Expose data immediately
  setTimeout(exposeDataToInsights, 1000) // Wait 1 second for main product to load
  
  // Re-expose data every 30 seconds to keep it fresh
  setInterval(exposeDataToInsights, 30000)
}




