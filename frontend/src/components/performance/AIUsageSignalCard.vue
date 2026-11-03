<template>
  <div class="insight-strip-row" data-pi-region="strip">
    <div class="insight-strip-row-collapsed d-flex align-items-center gap-2" @click="$emit('toggle')">
      <!-- Severity Badge -->
      <div class="insight-strip-severity severity-info">
        <i class="bi bi-robot"></i>
      </div>

      <!-- Title (with optional badges) -->
      <div class="insight-strip-title flex-grow-1 min-w-0">
        <div class="d-flex align-items-center gap-2 min-w-0">
          <span class="text-truncate">{{ title }}</span>
          <template v-if="trustBadges && trustBadges.length">
            <span
              v-for="(b, i) in trustBadges"
              :key="i"
              class="badge badge-sm bg-info-subtle text-info"
              :title="b.tooltip || ''"
              style="font-size: 0.62rem;"
            >
              {{ b.label }}
            </span>
          </template>
        </div>
        <div class="text-muted" style="font-size: 0.75rem; line-height: 1.1;">{{ subtext }}</div>
      </div>

      <!-- Right metric / evidence area -->
      <div class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
        <span class="insight-strip-evidence-item">
          <span class="insight-strip-evidence-value">
            <template v-if="metric.insufficientSignal">—</template>
            <template v-else-if="!metric.hasCoverage">Telemetry coverage insufficient</template>
            <template v-else-if="metric.value !== null && metric.value !== undefined">{{ formattedValue }}</template>
            <template v-else>--</template>
          </span>
        </span>
      </div>

      <!-- Scope pill and source dot -->
      <span class="badge badge-sm insight-strip-scope-pill">{{ scopeLabel }}</span>
      <span v-if="sourceBadge" class="badge badge-sm insight-strip-source-dot">{{ sourceBadge }}</span>

      <!-- Chevron for parity with collapsed rows -->
      <i class="bi insight-strip-chevron" :class="expanded ? 'bi-chevron-up' : 'bi-chevron-down'" aria-hidden="true"></i>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  metric: { type: Object as () => any, required: true },
  title: { type: String, required: true },
  subtext: { type: String, required: true },
  expanded: { type: Boolean, default: false }
})

const emit = defineEmits(['toggle'])

const scopeLabel = computed(() => props.metric.scope || 'Org')
const sourceBadge = computed(() => props.metric.source || 'IDE telemetry')
const trustBadges = computed(() => props.metric._formatted?.trustBadges || props.metric.trustBadges || [])

const formattedValue = computed(() => {
  // Prefer pre-formatted canonical value if parent provides one
  if (props.metric.formattedValue) return props.metric.formattedValue
  const v = props.metric.value
  if (v === null || v === undefined) return '--'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1)
  return String(v)
})
</script>

<style scoped>
/* follow shared InsightStrip collapsed-row styles for parity */
.insight-strip-row { margin-bottom: 0.25rem }
.insight-strip-row-collapsed {
  background: linear-gradient(180deg, rgba(250,250,252,1), rgba(245,247,250,1));
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
  align-items: center;
  transition: box-shadow 120ms ease, transform 120ms ease;
  min-height: 2.5rem;
  max-width: 100%;
  overflow: hidden;
}
.insight-strip-row-collapsed:hover { box-shadow: 0 6px 18px rgba(16,24,40,0.06); transform: translateY(-1px) }

.insight-strip-severity { width: 1.5rem; height: 1.5rem; display:flex; align-items:center; justify-content:center; border-radius:0.25rem; flex-shrink:0; font-size:0.75rem }
.insight-strip-severity i { font-size: 0.9rem }

.insight-strip-title { padding-right: 0.5rem; font-weight:500; font-size:0.875rem; min-width: 0; flex: 1; overflow: hidden }
.insight-strip-title .badge { margin-left: 0.35rem; opacity: 0.95; }

.insight-strip-evidence { text-align: right; padding-left: 0.5rem; font-size: 0.8125rem; min-width: 0; flex-shrink: 0; overflow: hidden }
.insight-strip-evidence-value { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }

.insight-strip-scope-pill { margin-left: 0.5rem; font-size: 0.65rem }
.insight-strip-source-dot { margin-left: 0.4rem; font-size: 0.6rem }

.insight-strip-chevron { color: rgba(0,0,0,0.35); font-size: 0.75rem; flex-shrink: 0 }

/* responsive tweaks to match shared UI */
@media (max-width: 720px) {
  .insight-strip-evidence { min-width: 80px }
  .insight-strip-severity { width: 1.25rem; height: 1.25rem }
}
/* ROI Analysis Button */
.roi-analysis-button {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  border: none;
 
  align-items: center;
  justify-content: center;
  margin-top: auto;
}
</style>
