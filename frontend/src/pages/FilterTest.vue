<template>
  <div class="p-6 max-w-4xl mx-auto">
    <h1 class="text-2xl font-bold mb-6">Performance Insights Filters Test</h1>
    
    <!-- Filter Component -->
    <PerformanceInsightsFilters 
      v-model="filterState"
      @change="handleFilterChange"
    />
    
    <!-- Debug Output -->
    <div class="mt-6 p-4 bg-gray-100 rounded-lg">
      <h2 class="text-lg font-semibold mb-3">Current Filter State:</h2>
      <pre class="text-sm">{{ JSON.stringify(filterState, null, 2) }}</pre>
    </div>
    
    <!-- Simulated Insights -->
    <div class="mt-6">
      <h2 class="text-lg font-semibold mb-3">Simulated Insights ({{ filteredInsights.length }}):</h2>
      <div class="space-y-2">
        <div 
          v-for="insight in filteredInsights" 
          :key="insight.id"
          class="p-3 bg-white border rounded-lg"
        >
          <div class="font-medium">{{ insight.title }}</div>
          <div class="text-sm text-gray-600">{{ insight.description }}</div>
          <div class="text-xs text-gray-500 mt-1">
            Metric: {{ insight.metric }} | Tool: {{ insight.tool }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import PerformanceInsightsFilters from '../components/PerformanceInsightsFilters.vue'

// Filter state
const filterState = ref({
  granularity: 'auto',
  metrics: ['cycle-time', 'change-failure-rate', 'merge-rate', 'deployment-frequency', 'ai-efficiency'],
  tools: ['cursor', 'vscode', 'jetbrains', 'windsurf', 'sublime', 'vim'],
  useGlobal: true
})

// Sample insights data
const allInsights = ref([
  { id: 1, title: 'Cursor AI increases cycle time', description: 'AI usage correlates with longer PR cycles', metric: 'cycle-time', tool: 'cursor' },
  { id: 2, title: 'VS Code improves merge rate', description: 'Better code quality leads to faster merges', metric: 'merge-rate', tool: 'vscode' },
  { id: 3, title: 'JetBrains reduces failure rate', description: 'IDE features help catch issues early', metric: 'change-failure-rate', tool: 'jetbrains' },
  { id: 4, title: 'Windsurf boosts deployment frequency', description: 'AI assistance speeds up development', metric: 'deployment-frequency', tool: 'windsurf' },
  { id: 5, title: 'Sublime improves AI efficiency', description: 'Lightweight editor with good AI integration', metric: 'ai-efficiency', tool: 'sublime' },
  { id: 6, title: 'Vim enhances cycle time', description: 'Fast editing reduces development time', metric: 'cycle-time', tool: 'vim' },
  { id: 7, title: 'Cursor affects merge rate', description: 'AI suggestions impact code review process', metric: 'merge-rate', tool: 'cursor' },
  { id: 8, title: 'VS Code deployment issues', description: 'Some configurations slow down deployments', metric: 'deployment-frequency', tool: 'vscode' }
])

// Filter insights based on current filter state
const filteredInsights = computed(() => {
  let insights = [...allInsights.value]
  
  // Filter by metrics if not using global
  if (!filterState.value.useGlobal && filterState.value.metrics.length < 5) {
    insights = insights.filter(insight => 
      filterState.value.metrics.includes(insight.metric)
    )
  }
  
  // Filter by tools if not using global
  if (!filterState.value.useGlobal && filterState.value.tools.length < 6) {
    insights = insights.filter(insight => 
      filterState.value.tools.includes(insight.tool)
    )
  }
  
  return insights
})

// Handle filter changes
function handleFilterChange(newState: any) {
  console.log('Filter changed:', newState)
  // Here you would typically update your insights data or trigger a refresh
}
</script>

