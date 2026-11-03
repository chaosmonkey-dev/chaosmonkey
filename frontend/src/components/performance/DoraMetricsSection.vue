<template>
  <div class="dora-section">
    <div class="d-flex align-items-start">
      <div class="stage-icon-wrapper me-2 bg-info"><i class="bi bi-speedometer2 text-white"></i></div>
      <div>
        <h5 class="mb-0 fw-bold">DORA Metrics</h5>
        <small class="text-muted">DORA Metrics reflect delivery outcomes derived from GitHub and CI signals. These metrics do not measure AI effectiveness.</small>
      </div>
    </div>

    <div class="mt-3 d-flex gap-3 flex-wrap">
      <DoraMetricCard v-for="m in metrics" :key="m.name" :metric="m" />
    </div>

    <div class="mt-3 small text-muted">
      Operational signal: Release risk driven primarily by inferred Change Failure Rate (Medium confidence).
    </div>

    <div class="mt-2 small text-muted">
      DORA metrics provide context for evaluating delivery health. They do not establish causation with AI usage.
    </div>
  </div>
</template>

<script setup lang="ts">
import DoraMetricCard from './DoraMetricCard.vue'
const props = defineProps<{ metrics: any[] }>()
</script>

<style scoped>
.dora-section .stage-icon-wrapper { width: 36px; height: 36px; display:flex; align-items:center; justify-content:center; border-radius:6px }
</style>
