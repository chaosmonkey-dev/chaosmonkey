<!--
PerformanceInsightsCardsV2.vue
Renders V2 insights using V1 card design components.

Responsibilities:
- Receive V2 insights array (same array used by strip)
- Map each through adaptV2InsightToV1Card
- Render using the existing V1 card component(s)
- Preserve expand/collapse behavior consistent with V1
-->

<script setup lang="ts">
import { computed } from 'vue'
import InsightsPanel from './InsightsPanel.vue'
import { adaptV2InsightsToV1Cards, type V1CardInsight } from '../ui/insights/adapters/v2ToV1CardAdapter'
import type { PerformanceInsight } from '../lib/insights/types'

interface Props {
  insights: PerformanceInsight[]
  allStageInsights?: PerformanceInsight[]
}

const props = withDefaults(defineProps<Props>(), {
  allStageInsights: () => []
})

// Adapt V2 insights to V1 card format
const v1CardInsights = computed(() => {
  return adaptV2InsightsToV1Cards(props.insights)
})

const v1CardAllStageInsights = computed(() => {
  return adaptV2InsightsToV1Cards(props.allStageInsights)
})
</script>

<template>
  <div class="performance-insights-cards-v2">
    <!-- Render using existing V1 InsightsPanel component -->
    <InsightsPanel 
      :items="v1CardInsights as any" 
      :all-stage-insights="v1CardAllStageInsights as any"
      :demo-ux="false"
    />
  </div>
</template>
