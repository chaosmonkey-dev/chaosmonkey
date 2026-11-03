<template>
  <div class="org-summary-row">
    <div class="org-summary-row__left">
      <div class="org-summary-row__pill">
        {{ badgeLabel }}
      </div>
    </div>

    <div class="org-summary-row__main">
      <div class="org-summary-row__title">
        {{ insight.title }}
      </div>
      <div
        v-if="insight.description"
        class="org-summary-row__description"
      >
        {{ insight.description }}
      </div>
    </div>

    <div class="org-summary-row__metrics" v-if="evidence.length">
      <span
        v-for="item in evidence"
        :key="item.label"
        class="org-summary-row__metric"
      >
        <span class="org-summary-row__metric-label">{{ item.label }}</span>
        <span class="org-summary-row__metric-value">{{ item.value }}</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PerformanceInsight } from '@/lib/insights/types'

interface Props {
  insight: PerformanceInsight
}

const props = defineProps<Props>()

// Show at most first 3 evidence items
const evidence = computed(() => (props.insight.evidence || []).slice(0, 3))

// Infer badge label from tags/metricId
const badgeLabel = computed(() => {
  const tags = props.insight.tags || []
  const metricId = (props.insight as any).metricId as string | undefined

  // Plan & Code badges
  if (tags.includes('ai-usage') || metricId?.includes('ai_usage') || metricId?.includes('ai_suggestions')) return 'AI USAGE'
  if (tags.includes('coding-time') || metricId?.includes('coding_time') || metricId?.includes('active_coding')) return 'CODING TIME'
  if (tags.includes('team-throughput') || tags.includes('throughput')) return 'TEAM OUTPUT'
  
  // Review & Merge badges
  if (tags.includes('ai-impact') && tags.includes('cycle-time')) return 'THROUGHPUT'
  if (tags.includes('ai-impact') && tags.includes('quality')) return 'QUALITY'
  if (tags.includes('optimal-band') || metricId?.includes('optimal_band')) return 'AI USAGE'
  
  // Deploy & Operate badges
  if (tags.includes('reliability') || metricId?.includes('deploy_reliability')) return 'DEPLOY RELIABILITY'
  if (tags.includes('quality') && tags.includes('deploy')) return 'QUALITY SIGNAL'
  if (tags.includes('ai-impact') && tags.includes('stability') || metricId?.includes('ai_deploy_stability')) return 'AI IMPACT'
  if (tags.includes('recovery') || metricId?.includes('recovery_posture')) return 'RECOVERY'

  return 'SUMMARY'
})
</script>

<style scoped>
.org-summary-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.55rem 0.9rem;
  border-radius: 12px;          /* match card radius */
  background-color: #ffffff;    /* same as cards */
  border: 1px solid #e9ecef;    /* same neutral border as cards */
  margin-bottom: 0.5rem;
}

/* Horizontal layout on tablet+ screens (when parent has --horizontal class) */
@media (min-width: 768px) {
  .org-summary-row {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.6rem;
    border-radius: 8px;
    margin-bottom: 0;
  }
  
  .org-summary-row__main {
    flex: 0 1 auto;
    min-width: 0;
  }
  
  .org-summary-row__title {
    font-size: 0.8rem;
    margin-bottom: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  
  .org-summary-row__description {
    display: none; /* Hide description in horizontal layout */
  }
  
  .org-summary-row__metrics {
    gap: 0.35rem;
    font-size: 0.7rem;
    flex-wrap: wrap;
  }
  
  .org-summary-row__pill {
    padding: 0.1rem 0.4rem;
    font-size: 0.6rem;
    flex-shrink: 0;
  }
}

.org-summary-row__left {
  display: flex;
  align-items: center;
}

.org-summary-row__pill {
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background-color: #f3f4f6;    /* light gray, not blue */
  color: #4b5563;               /* same as small labels on cards */
  border: 1px solid #e5e7eb;
}

.org-summary-row__main {
  min-width: 0;
}

.org-summary-row__title {
  font-weight: 600;
  font-size: 0.85rem;        /* slightly smaller than card titles */
  color: #111827;            /* same as card title color */
  margin-bottom: 0.05rem;
}

.org-summary-row__description {
  font-size: 0.78rem;        /* same as card body / slightly smaller */
  color: #4b5563;            /* same body text color as cards */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.org-summary-row__metrics {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  font-size: 0.75rem;
}

.org-summary-row__metric-label {
  color: #6b7280;            /* same muted label color as cards */
  margin-right: 0.2rem;
}

.org-summary-row__metric-value {
  font-weight: 500;
  color: #111827;
}

/* Mobile: stack rows (< 768px) */
@media (max-width: 767.98px) {
  .org-summary-row {
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    align-items: flex-start;
  }

  .org-summary-row__metrics {
    grid-column: 1 / -1;
    justify-content: flex-start;
    margin-top: 0.25rem;
    flex-wrap: wrap;
  }

  .org-summary-row__description {
    white-space: normal;
    display: block; /* Show description on mobile */
    -webkit-line-clamp: 2;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  
  .org-summary-row__title {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    -webkit-line-clamp: 1;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
}
</style>
