<template>
  <div class="insight-strip-row" data-pi-region="strip">
    <div class="insight-strip-row-collapsed d-flex align-items-center gap-2" @click="$emit('toggle')">
      <div class="insight-strip-severity" :class="severityClass">
        <i class="bi bi-gear-fill"></i>
      </div>

      <div class="insight-strip-title flex-grow-1 min-w-0">
        <div class="d-flex align-items-center gap-2 min-w-0">
          <span class="text-truncate">{{ metric.name }}</span>
        </div>
        <div class="text-muted" style="font-size: 0.75rem; line-height: 1.1;">{{ metric.note }}</div>
      </div>

      <div class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
        <span class="insight-strip-evidence-item">
          <span class="insight-strip-evidence-value">
            <template v-if="metric.missingState === 'awaiting_connection'">Awaiting data connection</template>
            <template v-else-if="metric.missingState === 'insufficient_history'">Insufficient historical data</template>
            <template v-else>{{ metric.value ?? '—' }}</template>
          </span>
        </span>
      </div>

      <span class="badge badge-sm" :class="confidenceClass">{{ metric.confidence || 'unknown' }}</span>

      <i class="bi insight-strip-chevron" :class="(expanded ? 'bi-chevron-up' : 'bi-chevron-down')" aria-hidden="true"></i>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ metric: any; expanded?: boolean }>()
const emit = defineEmits(['toggle'])

const severityClass = computed(() => {
  const c = (props.metric?.confidence || '').toLowerCase()
  if (c === 'high') return 'severity-highlight'
  if (c === 'medium') return 'severity-warning'
  if (c === 'low') return 'severity-risk'
  return 'severity-info'
})

const confidenceClass = computed(() => {
  const c = (props.metric?.confidence || '').toLowerCase()
  if (c === 'high') return 'bg-success-subtle text-success'
  if (c === 'medium') return 'bg-warning-subtle text-warning'
  if (c === 'low') return 'bg-danger-subtle text-danger'
  return 'bg-secondary-subtle text-secondary'
})
</script>

<style scoped>
.dora-strip-row { margin-bottom: 0.25rem }
.insight-strip-row-collapsed { border-radius: 0.375rem; transition: box-shadow 120ms ease; padding: 0.5rem 0.75rem; min-height: 2.5rem }
.insight-strip-row-collapsed:hover { box-shadow: 0 8px 22px rgba(2,6,23,0.06) }

.insight-strip-severity { width: 1.5rem; height: 1.5rem; display:flex; align-items:center; justify-content:center; border-radius:0.25rem; font-size:0.75rem }
.insight-strip-evidence { text-align: right; font-size: 0.8125rem }
.badge-sm { padding: 0.2rem 0.35rem; font-size: 0.65rem }

.insight-strip-chevron { color: rgba(0,0,0,0.35); font-size: 0.75rem }
</style>
