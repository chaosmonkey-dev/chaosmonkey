<template>
  <div class="performance-insights-chips">
    <template v-for="stage in stages" :key="stage.id">
      <div>
        {{ stage.title }}
      </div>
    </template>
    
    <div v-if="totalInsightsCount === 0" class="empty-state">
      No insights available
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const stages = [
  { id: 'plan-code', title: 'Plan & Code' },
  { id: 'review-merge', title: 'Review & Merge' },
  { id: 'deploy-operate', title: 'Deploy & Operate' }
]

const totalInsightsCount = ref(0)
</script>
