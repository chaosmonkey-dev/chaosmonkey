<template>
  <div v-if="insights && insights.length > 0" class="ide-diagnostics-section mb-3">
    <!-- Section Header -->
    <div class="cicd-section-header cicd-section-header--compact d-flex align-items-start justify-content-between gap-2 mb-2">
      <div class="d-flex align-items-start gap-2">
        <div class="stage-icon-wrapper bg-primary">
          <i class="bi bi-cpu text-white"></i>
        </div>
        <div class="d-flex flex-column">
          <div class="d-flex align-items-center gap-2">
            <h5 class="mb-0 fw-bold">IDE Diagnostics (Plan & Code)</h5>
            <span class="badge bg-primary-subtle text-primary">{{ insights.length }}</span>
          </div>
          <small class="text-muted">IDE-level performance signals from telemetry</small>
        </div>
      </div>
    </div>

    <!-- Grid of IDE Diagnostic Cards -->
    <div class="cm-grid-ide-comparison" style="display: grid; grid-template-columns: repeat(3, minmax(320px, 1fr)); gap: 16px; max-width: 1100px; margin: 0 auto;">
      <div v-for="insight in insights" :key="insight.id">
        <div class="card h-100 insight-card insight-card--dense insight-card--compact ide-diagnostic-card" 
             :class="getSeverityBorderClass(getMetricSpecificSeverity(insight))">
          <div class="card-body">
            <!-- Header: Icon + Title -->
            <div class="d-flex align-items-center gap-2 mb-2">
              <div class="severity-indicator ide-diagnostic-icon" :class="getSeverityClass(getMetricSpecificSeverity(insight))">
                <i :class="getSeverityIcon(getMetricSpecificSeverity(insight))"></i>
              </div>
              <h6 class="card-title mb-0 fw-bold ide-diagnostic-title">{{ insight.title }}</h6>
            </div>

            <!-- Description: 1-2 lines -->
            <p class="card-text text-muted small mb-2 ide-diagnostic-description">
              {{ insight.description }}
            </p>

            <!-- Evidence: 3-5 rows max -->
            <div v-if="insight.evidence && insight.evidence.length > 0" class="evidence-section-compact mb-2">
              <div class="evidence-grid-compact">
                <div v-for="(ev, index) in insight.evidence.slice(0, 5)" :key="index" class="evidence-item-compact">
                  <small class="evidence-label-compact">{{ ev.label }}</small>
                  <strong class="evidence-value-compact">{{ ev.value }}</strong>
                </div>
              </div>
            </div>

            <!-- Action: Single line, no truncation -->
            <div v-if="insight.recommendations && insight.recommendations.length > 0" class="action-section-compact">
              <div class="d-flex align-items-start gap-2">
                <i class="bi bi-arrow-right-circle action-icon-compact"></i>
                <div class="flex-grow-1 min-w-0">
                  <strong class="small action-label-compact">Action:</strong>
                  <div class="action-text-compact small">
                    {{ insight.recommendations[0].text }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Data source badge -->
            <div v-if="insight.dataSource" class="mt-2">
              <span 
                class="badge badge-sm" 
                :class="{
                  'bg-success-subtle text-success': insight.dataSource === 'real',
                  'bg-info-subtle text-info': insight.dataSource === 'mixed',
                  'bg-secondary-subtle text-secondary': insight.dataSource === 'sim'
                }"
              >
                {{ insight.dataSource === 'real' ? 'LIVE' : insight.dataSource.toUpperCase() }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PerformanceInsight, InsightSeverity } from '../lib/insights/types'

interface Props {
  insights: PerformanceInsight[]
}

const props = defineProps<Props>()

function getSeverityClass(severity: InsightSeverity): string {
  const classes: Record<InsightSeverity, string> = {
    'risk': 'severity-risk',
    'lowlight': 'severity-lowlight', 
    'opportunity': 'severity-opportunity',
    'highlight': 'severity-highlight',
    'info': 'severity-info',
    'warning': 'severity-warning',
    'critical': 'severity-critical'
  }
  return classes[severity] || ''
}

// Override severity for Plan & Code insights to provide visual variety
function getMetricSpecificSeverity(insight: PerformanceInsight): InsightSeverity {
  const metricId = insight.metricId || '';
  
  // Risk/warning metrics (negative indicators)
  if (metricId.includes('rework-rate')) return 'warning';
  if (metricId.includes('time-to-first-commit') && metricId.includes('by-ide')) return 'lowlight';
  
  // Positive metrics (good outcomes)
  if (metricId.includes('commits-per-session')) return 'highlight';
  if (metricId.includes('active-coding-time')) return 'highlight';
  if (metricId.includes('ai-suggestions-accepted')) return 'opportunity';
  if (metricId.includes('average-session-length')) return 'opportunity';
  
  // Productivity metrics (informational)
  if (metricId.includes('branches-per-session')) return 'info';
  if (metricId.includes('code-churn')) return 'info';
  if (metricId.includes('pr-review-cycles')) return 'info';
  
  // Default fallback
  return insight.severity || 'info';
}

function getSeverityIcon(severity: InsightSeverity): string {
  const icons: Record<InsightSeverity, string> = {
    'risk': 'bi-exclamation-triangle-fill',
    'lowlight': 'bi-exclamation-circle-fill',
    'opportunity': 'bi-lightbulb-fill',
    'highlight': 'bi-check-circle-fill',
    'info': 'bi-info-circle-fill',
    'warning': 'bi-exclamation-triangle-fill',
    'critical': 'bi-exclamation-octagon-fill'
  }
  return icons[severity] || 'bi-info-circle-fill'
}

function getSeverityBorderClass(severity: InsightSeverity): string {
  const classes: Record<InsightSeverity, string> = {
    'risk': 'border-danger border-start border-3',
    'lowlight': 'border-warning border-start border-3',
    'opportunity': 'border-primary border-start border-3',
    'highlight': 'border-success border-start border-3',
    'info': 'border-info border-start border-3',
    'warning': 'border-warning border-start border-3',
    'critical': 'border-danger border-start border-4'
  }
  return classes[severity] || ''
}
</script>

<style scoped>
/* Reuse existing insight card styles, but make more compact */
.ide-diagnostic-card {
  font-size: 0.9rem;
}

.ide-diagnostic-icon {
  width: 24px;
  height: 24px;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.ide-diagnostic-title {
  font-size: 0.9rem;
  line-height: 1.3;
  flex: 1;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.ide-diagnostic-description {
  font-size: 0.8rem;
  line-height: 1.4;
  margin-bottom: 0.5rem;
}

/* Reuse evidence and action styles from InsightCardContent */
.evidence-section-compact {
  background: #f8f9fa;
  border-radius: 0.4rem;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
}

.evidence-grid-compact {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.35rem;
}

.evidence-item-compact {
  display: grid;
  grid-template-columns: minmax(110px, 38%) minmax(0, 62%);
  align-items: start;
  gap: 0.5rem;
  padding: 0.2rem 0.25rem;
}

.evidence-label-compact {
  display: block;
  font-size: 0.65rem;
  color: #6c757d;
  margin-bottom: 0.15rem;
  line-height: 1.2;
  text-align: left;
}

.evidence-value-compact {
  display: block;
  font-size: 0.85rem;
  color: #212529;
  font-weight: 600;
  line-height: 1.2;
  text-align: left;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.action-section-compact {
  background: #e3f2fd;
  border-left: 3px solid #0d6efd;
  border-radius: 0.4rem;
  padding: 0.5rem;
}

.action-icon-compact {
  color: #0d6efd;
  font-size: 0.9rem;
  margin-top: 0.1rem;
  flex-shrink: 0;
}

.action-label-compact {
  color: #0d6efd;
  font-weight: 600;
  font-size: 0.8rem;
  flex-shrink: 0;
}

.action-text-compact {
  color: #495057;
  font-size: 0.85rem;
  line-height: 1.4;
  margin-top: 0.25rem;
}

.severity-indicator {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.severity-indicator.severity-risk,
.severity-indicator.severity-critical {
  background: #dc3545;
  color: white;
}

.severity-indicator.severity-lowlight,
.severity-indicator.severity-warning {
  background: #ffc107;
  color: #212529;
}

.severity-indicator.severity-opportunity {
  background: #0d6efd;
  color: white;
}

.severity-indicator.severity-info {
  background: #0dcaf0;
  color: #212529;
}

.severity-indicator.severity-highlight {
  background: #198754;
  color: white;
}

.border-danger { border-left-color: #dc3545 !important; }
.border-warning { border-left-color: #ffc107 !important; }
.border-primary { border-left-color: #0d6efd !important; }
.border-info { border-left-color: #0dcaf0 !important; }
.border-success { border-left-color: #198754 !important; }
</style>
