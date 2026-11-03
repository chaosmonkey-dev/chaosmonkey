<template>
  <div class="distribution-bar" v-if="segments.length > 0">
    <div class="distribution-bar__track" role="img" :aria-label="ariaLabel">
      <div
        v-for="(seg, i) in segments"
        :key="i"
        class="distribution-bar__segment"
        :style="{
          width: seg.pct + '%',
          backgroundColor: seg.color,
        }"
        :title="`${seg.label}: ${seg.value} (${seg.pct.toFixed(1)}%)`"
      />
    </div>
    <div class="distribution-bar__legend">
      <div v-for="(seg, i) in segments" :key="i" class="distribution-bar__legend-item">
        <span class="distribution-bar__swatch" :style="{ backgroundColor: seg.color }" />
        <span class="distribution-bar__legend-label">{{ seg.label }}</span>
        <span class="distribution-bar__legend-value">{{ seg.value }} · {{ seg.pct.toFixed(1) }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface DistributionSegment {
  label: string
  value: number
  color?: string
}

const props = withDefaults(defineProps<{
  segments: DistributionSegment[]
  ariaLabel?: string
  successColor?: string
  failureColor?: string
  neutralColor?: string
}>(), {
  ariaLabel: 'Outcome distribution',
  successColor: '#16a34a',
  failureColor: '#dc2626',
  neutralColor: '#94a3b8',
})

function colorFor(label: string, fallback: string): string {
  const l = label.toLowerCase()
  if (l.includes('success')) return props.successColor
  if (l.includes('fail') || l.includes('rollback')) return props.failureColor
  return fallback
}

const segments = computed(() => {
  const total = props.segments.reduce((sum, s) => sum + (s.value || 0), 0)
  if (total <= 0) return []
  return props.segments.map((s) => ({
    label: s.label,
    value: s.value,
    pct: (s.value / total) * 100,
    color: s.color || colorFor(s.label, props.neutralColor),
  }))
})
</script>

<style scoped>
.distribution-bar {
  width: 100%;
}
.distribution-bar__track {
  display: flex;
  width: 100%;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  background: #e2e8f0;
}
.distribution-bar__segment {
  height: 100%;
  transition: width 0.25s ease;
}
.distribution-bar__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.9rem;
  margin-top: 0.35rem;
}
.distribution-bar__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.7rem;
  color: #475569;
  line-height: 1.1;
}
.distribution-bar__swatch {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  flex-shrink: 0;
}
.distribution-bar__legend-label {
  font-weight: 600;
}
.distribution-bar__legend-value {
  color: #64748b;
}
</style>
