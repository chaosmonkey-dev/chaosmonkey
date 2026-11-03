<template>
  <div class="mini-sparkline" :style="{ width: width + 'px', height: height + 'px' }">
    <svg
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      class="mini-sparkline__svg"
    >
      <!-- Area fill under the line -->
      <path
        v-if="areaPath && showArea"
        :d="areaPath"
        :fill="areaColor"
        class="mini-sparkline__area"
      />
      <!-- Main sparkline path -->
      <path
        v-if="linePath"
        :d="linePath"
        :stroke="lineColor"
        fill="none"
        :stroke-width="strokeWidth"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="mini-sparkline__line"
      />
      <!-- Start point -->
      <circle
        v-if="points.length > 0"
        :cx="scaledPoints[0]?.x"
        :cy="scaledPoints[0]?.y"
        :r="dotRadius"
        :fill="lineColor"
        class="mini-sparkline__dot mini-sparkline__dot--start"
      />
      <!-- End/latest point (emphasized) -->
      <circle
        v-if="points.length > 1"
        :cx="scaledPoints[scaledPoints.length - 1]?.x"
        :cy="scaledPoints[scaledPoints.length - 1]?.y"
        :r="dotRadius + 1"
        :fill="latestColor"
        class="mini-sparkline__dot mini-sparkline__dot--latest"
      />
      <!-- Partial-period indicator (dashed last segment) -->
      <line
        v-if="hasPartialPeriod && scaledPoints.length >= 2"
        :x1="scaledPoints[scaledPoints.length - 2]?.x"
        :y1="scaledPoints[scaledPoints.length - 2]?.y"
        :x2="scaledPoints[scaledPoints.length - 1]?.x"
        :y2="scaledPoints[scaledPoints.length - 1]?.y"
        :stroke="lineColor"
        :stroke-width="strokeWidth"
        stroke-dasharray="3,2"
        stroke-linecap="round"
        class="mini-sparkline__partial"
      />
    </svg>
    <!-- Optional label row beneath -->
    <div v-if="showLabels && points.length >= 2" class="mini-sparkline__labels">
      <span class="mini-sparkline__label mini-sparkline__label--start">{{ points[0]?.label }}</span>
      <span class="mini-sparkline__label mini-sparkline__label--latest">{{ points[points.length - 1]?.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface SparklinePoint {
  value: number
  label?: string
}

const props = withDefaults(defineProps<{
  points: SparklinePoint[]
  width?: number
  height?: number
  lineColor?: string
  latestColor?: string
  areaColor?: string
  strokeWidth?: number
  dotRadius?: number
  showArea?: boolean
  showLabels?: boolean
  hasPartialPeriod?: boolean
}>(), {
  width: 120,
  height: 32,
  lineColor: '#2563eb',
  latestColor: '#1d4ed8',
  areaColor: 'rgba(37, 99, 235, 0.08)',
  strokeWidth: 1.5,
  dotRadius: 2,
  showArea: true,
  showLabels: false,
  hasPartialPeriod: false,
})

const padding = 4

const scaledPoints = computed(() => {
  const pts = props.points
  if (pts.length === 0) return []

  const values = pts.map(p => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const plotW = props.width - padding * 2
  const plotH = props.height - padding * 2

  return pts.map((p, i) => ({
    x: padding + (pts.length > 1 ? (i / (pts.length - 1)) * plotW : plotW / 2),
    y: padding + plotH - ((p.value - min) / range) * plotH,
  }))
})

const linePath = computed(() => {
  const sp = scaledPoints.value
  if (sp.length < 2) return ''
  // If hasPartialPeriod, exclude the last segment from the solid path
  const end = props.hasPartialPeriod && sp.length >= 2 ? sp.length - 1 : sp.length
  return sp.slice(0, end).map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
})

const areaPath = computed(() => {
  const sp = scaledPoints.value
  if (sp.length < 2) return ''
  const bottom = props.height - padding
  const line = sp.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return `${line} L ${sp[sp.length - 1].x} ${bottom} L ${sp[0].x} ${bottom} Z`
})
</script>

<style scoped>
.mini-sparkline {
  display: inline-block;
  flex-shrink: 0;
}
.mini-sparkline__svg {
  display: block;
}
.mini-sparkline__line {
  transition: stroke 0.2s ease;
}
.mini-sparkline__area {
  transition: fill 0.2s ease;
}
.mini-sparkline__labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.6rem;
  color: #94a3b8;
  margin-top: 1px;
  line-height: 1;
}
.mini-sparkline__label--latest {
  font-weight: 600;
  color: #475569;
}
</style>
