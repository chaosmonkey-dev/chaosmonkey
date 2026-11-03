<!-- 
  📋 ARCHITECTURE MAP: See /docs/DASHBOARD_METRICS_ARCHITECTURE_MAP.md
  This component displays GitHub/engineering metrics with:
  - Drag-to-reorder cards
  - Hide/show/remove controls (localStorage-based)
  - 11 metric cards (lines 239-583)
  - Data source badges (Real GitHub / Simulated)
-->
<template>
  <div
    class="eng-output-container"
    :class="{
      'eng-output-embedded': isEmbedded,
      'eng-output-standalone': !isEmbedded
    }"
  >
    

    <!-- Unified Filters (only show in standalone mode) -->
    <UnifiedFilters
      v-if="!props.useExternalFilters"
      :initial-repo="selectedRepo"
      :repositories="githubStore.repositories"
      :loading="githubStore.loading"
      :show-view-type-filter="false"
      :show-productivity-metric-filter="false"
      :show-ide-filter="false"
      @refresh-repositories="refreshRepositories"
    />

    
            
<!-- GitHub error handling - smart display based on data availability -->
    <div v-if="props.githubError" class="alert alert-danger mb-3">
      <i class="bi bi-exclamation-triangle me-2"></i>
      Error: {{ props.githubError }}
    </div>
    
    <!-- Softer warning if we have data but the last fetch errored (e.g., timeout on a later request) -->
    <div
      v-else-if="props.githubError && effectiveGithubMetrics"
      class="text-muted small d-flex align-items-center mb-2"
    >
      <i class="bi bi-info-circle me-2"></i>
      <span class="text-muted">
        Last fetch had issues, but showing saved data from {{ props.githubError }}
      </span>
    </div>
    
    <div class="alert alert-warning mb-3" v-if="!effectiveGithubMetrics && !props.githubLoading && !props.githubError">
      <i class="bi bi-info-circle me-2"></i>No metrics loaded yet. Props state: {{ { metrics: !!effectiveGithubMetrics, loading: props.githubLoading, error: props.githubError } }}
    </div>
    

   

        <!-- CI/CD Pipeline Sections -->
    <div v-for="stage in STAGES" :key="stage.id" class="cicd-section card mb-1" :class="`stage-${stage.id}`">
      <div class="card-body">
        <!-- Section Header -->
        <div class="cicd-section-header d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-2" style="padding-bottom: 0.25rem; margin-bottom: 0.25rem; border-bottom: 1px solid #e9ecef;">
          <div class="d-flex align-items-center gap-2">
            <div class="stage-icon-wrapper" :class="`bg-${getStageColor(stage.id)}`" style="width: 36px; height: 36px; border-radius: 8px; font-size: 1rem;">
              <i :class="[stage.icon, 'text-white']"></i>
            </div>
            <div>
              <h5 class="mb-0 fw-bold text-dark" style="font-size: 0.9rem; margin-bottom: 0.0625rem; letter-spacing: -0.01em;">{{ stage.label }}</h5>
              <small class="text-muted fw-medium" style="font-size: 0.675rem; letter-spacing: 0.01em;">{{ getStageDescription(stage.id) }}</small>
            </div>
          </div>
          <span class="badge badge-sm" :class="`bg-${getStageColor(stage.id)}-subtle text-${getStageColor(stage.id)}`" style="font-size: 0.575rem; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-weight: 600; letter-spacing: 0.05em;">
            {{ visibleByStage[stage.id].length }} metrics
          </span>
        </div>

        <!-- Layer 1: Performance Insights (max 2 per stage) -->
        <div class="cicd-layer mb-2" style="margin-bottom: 0.25rem;">
          <div class="cicd-layer-header d-flex align-items-center gap-2 mb-1" style="margin-bottom: 0.1875rem;">
            <i class="bi bi-lightbulb text-primary" style="font-size: 0.8rem;"></i>
            <small class="fw-semibold text-primary" style="font-size: 0.675rem; letter-spacing: 0.05em;">Performance Insights</small>
            <span class="badge bg-primary-subtle text-primary" style="font-size: 0.55rem; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-weight: 600; letter-spacing: 0.05em;">{{ sectionInsights(stage.id).length }}</span>
          </div>
          <div v-if="sectionInsights(stage.id).length > 0" class="cicd-insights-box" style="margin-bottom: 0.1875rem; padding: 0.375rem 0.5rem; background: linear-gradient(135deg, #fffbf0 0%, #fff8e6 100%); border: 1px solid #ffd60a; border-radius: 0.3125rem;">
            <div
              v-for="(insight, i) in sectionInsights(stage.id).slice(0, 2)"
              :key="insight.id"
              class="insight-item"
              :class="getInsightBorderClass(insight)"
              style="padding: 0.3125rem 0.375rem; border-radius: 0.25rem; background: white; border-left: 3px solid #dee2e6; margin-bottom: 0.125rem;"
            >
              <div class="d-flex align-items-start gap-2">
                <i :class="[getInsightIcon(insight), 'insight-severity-icon']"
                   :style="{ color: getSeverityColor(insight) }" style="font-size: 0.75rem; line-height: 1.2;"></i>
                <div class="flex-grow-1">
                  <div class="d-flex align-items-center gap-2 mb-1" style="margin-bottom: 0.0625rem;">
                    <span class="badge badge-sm" :class="getSeverityBadgeClass(insight)" style="font-size: 0.5rem; padding: 0.0625rem 0.25rem; border-radius: 0.1875rem; font-weight: 600; letter-spacing: 0.05em;">
                      {{ insight.severity || 'INFO' }}
                    </span>
                    <strong class="insight-title" style="font-size: 0.65rem; font-weight: 600; color: #212529; letter-spacing: -0.01em; line-height: 1.3;">{{ insight.title }}</strong>
                  </div>
                  <p class="mb-0 insight-description" style="font-size: 0.625rem; color: #495057; line-height: 1.3; margin-bottom: 0;">{{ insight.description }}</p>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="cicd-insights-placeholder" style="padding: 0.3125rem 0.375rem; background: #f8f9fa; border: 1px dashed #dee2e6; border-radius: 0.3125rem;">
            <div class="text-center py-1" style="padding: 0.25rem 0;">
              <small class="text-muted" style="font-size: 0.625rem;">No insights available for this stage</small>
            </div>
          </div>
        </div>

        <!-- Layer 2: Unified Metrics (Core + Supporting Signals) -->
        <div class="cicd-layer">
          <div class="cicd-layer-header d-flex align-items-center gap-2 mb-1" style="margin-bottom: 0.1875rem;">
            <i class="bi bi-graph-up text-primary" style="font-size: 0.8rem;"></i>
            <small class="fw-semibold text-primary" style="font-size: 0.675rem; letter-spacing: 0.05em;">Metrics</small>
            <span class="badge bg-primary-subtle text-primary" style="font-size: 0.55rem; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-weight: 600; letter-spacing: 0.05em;">{{ allStageMetrics[stage.id]?.length || 0 }}</span>
          </div>
          <div class="row g-2">
            <div 
              v-for="metric in allStageMetrics[stage.id] || []" 
              :key="metric.id"
              :class="`col-12 col-sm-6 col-lg-4`"
            >
              <div class="card h-100 metric-card"
                   :class="{
                     'supporting-signal-card': metric.dataSource === 'github',
                     'clickable-github-card': metric.dataSource === 'github' && GITHUB_DRILLDOWN_ENABLED && props.githubReady,
                     'disabled-github-card': metric.dataSource === 'github' && !props.githubReady
                   }"
                   @click="metric.dataSource === 'github' && props.githubReady ? handleGitHubMetricClick(metric.id, metric.title) : null"
                   :title="metric.dataSource === 'github' && GITHUB_DRILLDOWN_ENABLED && props.githubReady ? 'Click for detailed records' : (metric.dataSource === 'github' && !props.githubReady ? 'Loading GitHub data...' : '')"
                   :style="metric.dataSource === 'github' ? 'min-height: 80px; border-radius: 0.5rem; border: 1px solid #e9ecef; cursor: pointer;' : ''">
                <div class="card-body text-center" :style="metric.dataSource === 'github' ? 'padding: 0.25rem 0.3125rem; display: flex; flex-direction: column; justify-content: space-between;' : ''">
                  <div class="d-flex align-items-center justify-content-between" :style="metric.dataSource === 'github' ? 'margin-bottom: 0.0625rem;' : ''">
                    <div class="data-source-badge" :class="metric.dataSource" :style="metric.dataSource === 'github' ? 'font-size: 0.4rem; padding: 0.0625rem 0.125rem; border-radius: 0.125rem; font-weight: 600; letter-spacing: 0.05em;' : ''">{{ metric.dataSourceLabel }}</div>
                    <i :class="`bi ${metric.icon} ${metric.dataSource === 'github' ? 'text-muted' : 'text-primary'}`"
                       :style="`font-size: ${metric.dataSource === 'github' ? '0.5rem' : '1.75rem'};`"></i>
                  </div>
                  <h6 class="card-title" :class="{ 'small': metric.dataSource === 'github' }" :style="metric.dataSource === 'github' ? 'font-size: 0.5rem; font-weight: 600; margin-bottom: 0.0625rem; color: #212529;' : ''">{{ metric.title }}</h6>
                  <div class="metric-value-row" :style="metric.dataSource === 'github' ? 'display: flex; align-items: center; justify-content: center; gap: 0.1875rem; margin-bottom: 0.0625rem;' : ''">
                    <h3 :class="metric.dataSource === 'github' ? 'text-muted h4' : 'text-primary'" :style="metric.dataSource === 'github' ? 'font-size: 1.125rem; font-weight: 700; margin-bottom: 0; letter-spacing: -0.02em;' : ''">
                      {{ metric.value }}
                    </h3>
                  </div>
                  <p class="card-text small text-muted mb-0" :style="metric.dataSource === 'github' ? 'font-size: 0.45rem; color: #6c757d; letter-spacing: 0.05em;' : ''">{{ metric.description }}</p>
                  <div class="mt-1">
                    <button 
                      v-if="!metric.dataSource || metric.dataSource !== 'github'"
                      @click="toggleCardVisibility(metric.id)"
                      class="btn btn-sm btn-outline-secondary me-1"
                      title="Hide card"
                      style="font-size: 0.525rem; padding: 0.0625rem 0.25rem; opacity: 0.25;"
                    >
                      <i class="bi bi-eye-slash" style="font-size: 0.525rem;"></i>
                    </button>
                    <button 
                      @click="removeCard(metric.id)"
                      class="btn btn-sm btn-outline-danger"
                      title="Remove card permanently"
                      style="font-size: 0.525rem; padding: 0.0625rem 0.25rem; opacity: 0.25;"
                    >
                      <i class="bi bi-x"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 🔥 PHASE 4: GitHub metrics loading placeholder -->
        <div v-if="props.githubConnected && !props.githubReady" class="cicd-layer">
          <div class="alert alert-info mb-2 d-flex align-items-center" role="alert">
            <i class="bi bi-hourglass-split me-2"></i>
            <small>Loading GitHub metrics...</small>
          </div>
        </div>

        <!-- GitHub Connection Status for Review & Merge and Deploy & Operate stages - REMOVED -->
        <!-- We are already logged in via GitHub, this panel is redundant -->
        
        <div v-if="(stage.id === 'review' || stage.id === 'deploy-operate') && props.githubConnected && !hasGitHubDataForStage(stage.id)" class="cicd-layer">
          <div class="alert alert-info mb-2 d-flex align-items-center" role="alert">
            <i class="bi bi-info-circle me-2"></i>
            <small>{{ getGitHubEmptyMessage(stage.id) }}</small>
          </div>
        </div>
      </div>
    </div>

    <!-- Hidden Cards Section -->
    <div v-if="hiddenMetrics.length > 0" class="row mt-4">
      <div class="col-12">
        <div class="card border-dashed">
          <div class="card-header bg-light">
            <h6 class="mb-0">
              <i class="bi bi-eye-slash me-2"></i>Hidden Cards
              <small class="text-muted ms-2">({{ hiddenMetrics.length }} hidden)</small>
            </h6>
          </div>
          <div class="card-body">
            <div class="row g-2">
              <div 
                v-for="metric in hiddenMetrics" 
                :key="metric.id"
                class="col-12 col-sm-6 col-md-3"
              >
                <div class="card border-0 bg-light">
                  <div class="card-body text-center py-3">
                    <i :class="`bi ${metric.icon} text-muted mb-2`" style="font-size: 1.5rem;"></i>
                    <h6 class="card-title text-muted mb-2">{{ metric.title }}</h6>
                    <button 
                      @click="toggleCardVisibility(metric.id)"
                      class="btn btn-sm btn-outline-primary"
                      title="Show card"
                    >
                      <i class="bi bi-eye me-1"></i>Show
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Card Section -->
    <div class="row mt-4">
      <div class="col-12">
        <div class="card border-dashed add-cards-section">
          <div class="card-header bg-light d-flex justify-content-between align-items-center">
            <h6 class="mb-0 fw-semibold text-dark">
              <i class="bi bi-plus-circle me-2 text-primary"></i>Create Custom Insight
            </h6>
            <button 
              @click="resetAllCards"
              class="btn btn-sm btn-outline-secondary"
              title="Reset all cards to default state"
            >
              <i class="bi bi-arrow-clockwise me-1"></i>Reset
            </button>
          </div>
          <div class="card-body">
            <div class="row g-2">
              <div 
                v-for="metric in availableMetrics" 
                :key="metric.id"
                class="col-12 col-sm-6 col-md-3"
              >
                <div class="card border-0 bg-light">
                  <div class="card-body text-center py-3">
                    <i :class="`bi ${metric.icon} text-muted mb-2`" style="font-size: 1.5rem;"></i>
                    <h6 class="card-title text-muted mb-2">{{ metric.title }}</h6>
                    <button 
                      @click="addCard(metric.id)"
                      class="btn btn-sm btn-outline-success"
                      title="Add card to dashboard"
                    >
                      <i class="bi bi-plus me-1"></i>Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Hidden Cards Section -->
    <div v-if="hiddenMetrics.length > 0" class="row mt-4">
      <div class="col-12">
        <div class="card border-dashed">
          <div class="card-header bg-light">
            <h6 class="mb-0">
              <i class="bi bi-eye-slash me-2"></i>Hidden Cards
              <small class="text-muted ms-2">({{ hiddenMetrics.length }} hidden)</small>
            </h6>
          </div>
          <div class="card-body">
            <div class="row g-2">
              <div 
                v-for="metric in hiddenMetrics" 
                :key="metric.id"
                class="col-12 col-sm-6 col-md-3"
              >
                <div class="card border-0 bg-light">
                  <div class="card-body text-center py-3">
                    <i :class="`bi ${metric.icon} text-muted mb-2`" style="font-size: 1.5rem;"></i>
                    <h6 class="card-title text-muted mb-2">{{ metric.title }}</h6>
                    <button 
                      @click="toggleCardVisibility(metric.id)"
                      class="btn btn-sm btn-outline-success"
                      title="Add card to dashboard"
                    >
                      <i class="bi bi-plus me-1"></i>Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- GitHub Metric Drilldown Modal -->
  <GithubMetricDrilldownModal
    v-if="GITHUB_DRILLDOWN_ENABLED"
    :show="showDrilldownModal"
    :metric-key="selectedMetricForDrilldown"
    :time-filter="normalizeTimeFilter(externalTimeFilter)"
    @close="closeDrilldownModal"
  />
</template>

<script setup>
import { ref, onMounted, computed, watch, watchEffect, shallowRef } from 'vue'
import { useGitHubStore } from '../stores/github'
import { useFilterStore } from '../stores/filters'
import { generateInsights } from '../lib/insights/engine'
import UnifiedFilters from './UnifiedFilters.vue'
import { log, warn, error as logError } from '../utils/logger'
import { GITHUB_DRILLDOWN_ENABLED, isSupportedGitHubMetric } from '../config/githubDrilldown'
import { normalizeTimeFilter } from '../utils/timeFilter' // 🔥 PHASE 2: Use shared utility
import GithubMetricDrilldownModal from './GithubMetricDrilldownModal.vue'

/**
 * 🔥 PHASE 2: Using shared normalizeTimeFilter utility from utils/timeFilter.ts
 * This replaces the local normalizeExternalTimeFilter function
 */

// CI/CD Stage definitions
// CicdStage type: 'plan-code' | 'review' | 'deploy-operate'

const STAGES = [
  { id: 'plan-code', label: 'Plan & Code', icon: 'bi-pencil-square' },
  { id: 'review', label: 'Review & Merge', icon: 'bi-git' },
  { id: 'deploy-operate', label: 'Deploy & Operate', icon: 'bi-rocket' }
]

// Mapping from insights metricId to CI/CD stage
const METRIC_ID_TO_STAGE = {
  // Plan & Code stage
  'ide.coding_time': 'plan-code',
  'prod.ai_suggestions': 'plan-code',
  'prod.commits': 'plan-code',
  'prod.files_edited': 'plan-code',
  'prod.time_to_commit': 'plan-code',
  'prod.ai_usage': 'plan-code',
  
  // Review & Merge stage
  'eng.pr_opened': 'review',
  'eng.pr_merged': 'review',
  'eng.merge_rate': 'review',
  'eng.lead_time': 'review',
  'eng.pr_cycle_time': 'review',
  'eng.code_review_time': 'review',
  
  // Deploy & Operate stage
  'eng.deploy_frequency': 'deploy-operate',
  'eng.mean_time_to_recovery': 'deploy-operate',
  'eng.change_failure_rate': 'deploy-operate',
  'eng.mttr': 'deploy-operate'
}

// Props for external filter control
const props = defineProps({
  useExternalFilters: {
    type: Boolean,
    default: false
  },
  externalTimeFilter: {
    type: String,
    default: undefined
  },
  externalComparisonMode: {
    type: String,
    default: undefined
  },
  externalCustomStartDate: {
    type: String,
    default: undefined
  },
  externalCustomEndDate: {
    type: String,
    default: undefined
  },
  externalRepository: {
    type: String,
    default: undefined
  },
  insights: {
    type: Array,
    default: () => []
  },
  githubMetrics: {
    type: Object,
    default: () => ({})
  },
  githubLoading: {
    type: Boolean,
    default: false
  },
  githubError: {
    type: String,
    default: null
  },
  githubConnected: {
    type: Boolean,
    default: false
  },
  githubReady: {
    type: Boolean,
    default: false // 🔥 PHASE 4: GitHub data readiness guard
  },
})

const githubStore = useGitHubStore()
const filters = useFilterStore()

// DEV mode flag for template (fix build error)
const isDev = import.meta.env.DEV

// Debug GitHub props (DEV only)
if (import.meta.env.DEV) {
  watchEffect(() => {
    console.log('[ENGOUTPUT] GitHub props:', {
      githubConnected: props.githubConnected,
      githubLoading: props.githubLoading,
      githubError: props.githubError,
      hasGithubMetrics: !!props.githubMetrics,
      githubMetricsKeys: props.githubMetrics ? Object.keys(props.githubMetrics) : null,
      githubMetricsIsObject: typeof props.githubMetrics === 'object' && props.githubMetrics !== null,
      // Specific metric values
      github_team_metrics: props.githubMetrics?.github_team_metrics,
      pr_review_metrics: props.githubMetrics?.pr_review_metrics,
      deployment_metrics: props.githubMetrics?.deployment_metrics,
      // Check specific values
      total_prs: props.githubMetrics?.github_team_metrics?.total_prs,
      review_count: props.githubMetrics?.pr_review_metrics?.review_count,
      deployment_status: props.githubMetrics?.deployment_metrics?.latest_deployment?.status
    })
  })
}

// STEP 2D: Verify prop delivery into EngOutput
if (import.meta.env.DEV) {
  watchEffect(() => {
    console.log("[GH_STEP2D] EngOutput props.githubMetrics", {
      team_total_prs: props.githubMetrics?.github_team_metrics?.total_prs,
      review_count: props.githubMetrics?.pr_review_metrics?.review_count,
      deploy_status: props.githubMetrics?.deployment_metrics?.latest_deployment?.status
    })
  })
}

// Development mode check for template
const timeRange = ref('all')

// 🔥 PHASE 1.1B: UI fallback for GitHub cards - ensure cards display from any available data
// Use props.githubMetrics if available, otherwise fall back to store data
const effectiveGithubMetrics = computed(() => {
  console.log('🔧 [ENG_OUTPUT] GitHub data flow debug:', {
    'props.githubMetrics': props.githubMetrics,
    'props.githubMetrics keys': props.githubMetrics ? Object.keys(props.githubMetrics) : null,
    'props.githubReady': props.githubReady,
    'props.githubConnected': props.githubConnected,
    'githubStore.connected': githubStore.connected,
    'githubStore.rawResponse': githubStore.rawResponse,
    'githubStore.rawResponse type': typeof githubStore.rawResponse,
    'githubStore.rawResponse keys': githubStore.rawResponse ? Object.keys(githubStore.rawResponse).slice(0, 10) : null,
    'GITHUB_DRILLDOWN_ENABLED': GITHUB_DRILLDOWN_ENABLED
  })
  
  // If props have data, use them
  if (props.githubMetrics && Object.keys(props.githubMetrics).length > 0) {
    console.log('[ENG_OUTPUT] Using props.githubMetrics:', props.githubMetrics)
    return props.githubMetrics
  }
  
  // Otherwise, fall back to store rawResponse
  if (githubStore.rawResponse) {
    const rawResponse = githubStore.rawResponse
    console.log('[ENG_OUTPUT] Using githubStore.rawResponse:', rawResponse)
    console.log('[ENG_OUTPUT] RawResponse data check:', {
      hasGithubTeamMetrics: !!rawResponse.github_team_metrics,
      hasTeamMetrics: !!rawResponse.team_metrics,
      githubTeamMetrics: rawResponse.github_team_metrics,
      teamMetrics: rawResponse.team_metrics,
      totalPrsFromGithubTeam: rawResponse.github_team_metrics?.total_prs,
      totalPrsFromTeam: rawResponse.team_metrics?.total_prs
    })
    
    // Try github_team_metrics first (preferred structure)
    if (rawResponse.github_team_metrics) {
      const result = {
        ...rawResponse,
        // Flatten for easier access in existing computed properties
        github_team_metrics: rawResponse.github_team_metrics,
        pr_review_metrics: rawResponse.pr_review_metrics || {},
        deployment_metrics: rawResponse.deployment_metrics || {}
      }
      console.log('[ENG_OUTPUT] Using github_team_metrics structure:', result)
      return result
    }
    
    // Fallback to team_metrics (alternative structure)
    if (rawResponse.team_metrics) {
      const result = {
        ...rawResponse,
        github_team_metrics: rawResponse.team_metrics,
        pr_review_metrics: rawResponse.pr_review_metrics || {},
        deployment_metrics: rawResponse.deployment_metrics || {}
      }
      console.log('[ENG_OUTPUT] Using team_metrics fallback structure:', result)
      return result
    }
  }
  
  console.log('[ENG_OUTPUT] No GitHub metrics available')
  return {}
})

// 🔥 PHASE 1.1B: Log effective metrics for debugging
console.log('[ENGOUTPUT_EFFECTIVE_GH]', { 
  hasProps: !!props.githubMetrics, 
  hasStoreRawResponse: !!githubStore.rawResponse,
  hasStoreMetrics: !!githubStore.metrics,
  storeRawResponseType: typeof githubStore.rawResponse,
  effectivePullRequests: effectiveGithubMetrics.value?.github_team_metrics?.total_prs,
  effectiveFailedDeployments: effectiveGithubMetrics.value?.deployment_metrics?.failed_deployment_count
});

// GitHub metrics computed properties - canonical getters from effective data
// CR-X Wave 3 Slice D: Provenance-aware source labeling.
// CR-X 3D.2B/3D.2C: Machine-semantic dataSource ('simulated' | 'github') is
// preserved for programmatic consumers (CSS classes, branching). Only the
// presentation label (dataSourceLabel) is normalized to customer-facing copy.
// Local cm_activity_sim evidence exercises the same pipeline as real customer
// evidence — the display label says "GitHub delivery", not "Simulated".
const githubDataSourceInfo = computed(() => {
  const provenance = effectiveGithubMetrics.value?.github_provenance
  const source = provenance?.source
  if (source === 'cm_activity_sim') {
    return { dataSource: 'simulated', dataSourceLabel: 'GitHub delivery' }
  }
  // Default: real GitHub evidence (db_sync or live API fetch)
  return { dataSource: 'github', dataSourceLabel: 'GitHub' }
})
const ghTeam = computed(() => {
  const teamData = effectiveGithubMetrics.value?.github_team_metrics ?? {}
  console.log('🔍 [ENG_OUTPUT] ghTeam computed:', {
    effectiveGithubMetrics: effectiveGithubMetrics.value,
    githubTeamMetrics: effectiveGithubMetrics.value?.github_team_metrics,
    teamData: teamData,
    total_prs: teamData.total_prs,
    merged_prs: teamData.merged_prs,
    keys: effectiveGithubMetrics.value ? Object.keys(effectiveGithubMetrics.value) : 'null',
    // Check if data is in root object instead
    rootData: effectiveGithubMetrics.value ? {
      total_prs: effectiveGithubMetrics.value.total_prs,
      merged_prs: effectiveGithubMetrics.value.merged_prs,
      merge_rate: effectiveGithubMetrics.value.merge_rate
    } : 'null'
  })
  // 🔥 FIX: Return the nested github_team_metrics object, not the root
  return teamData
})
const ghReview = computed(() => {
  // 🔥 FIX: Return the nested pr_review_metrics object
  return effectiveGithubMetrics.value?.pr_review_metrics ?? {}
})
const ghDeploy = computed(() => {
  // 🔥 FIX: Return the nested deployment_metrics object
  return effectiveGithubMetrics.value?.deployment_metrics ?? {}
})

// DEBUG: Check what canonical getters actually contain
if (import.meta.env.DEV) {
  watchEffect(() => {
    console.log('[ENGOUTPUT] Canonical getters:', {
      ghTeam: ghTeam.value,
      ghReview: ghReview.value,
      ghDeploy: ghDeploy.value,
      team_prs: ghTeam.value?.total_prs,
      review_count: ghReview.value?.review_count,
      deploy_status: ghDeploy.value?.latest_deployment?.status
    })
    console.log('[ENGOUTPUT] Raw props:', {
      githubMetrics: props.githubMetrics,
      githubConnected: props.githubConnected,
      githubLoading: props.githubLoading,
      githubError: props.githubError
    })
  })
}

// Memoized computed properties for stage metrics
const reviewStageMetrics = computed(() => {
  if (!props.githubConnected || props.githubLoading || props.githubError) {
    return []
  }
  
  const metrics = []
  
  if (ghReview.value.review_count != null) {
    metrics.push({
      id: 'github-review-count',
      title: 'Review Count',
      value: ghReview.value.review_count,
      description: 'Total reviews this period',
      icon: 'bi-eye',
      dataSource: githubDataSourceInfo.value.dataSource,
      dataSourceLabel: githubDataSourceInfo.value.dataSourceLabel
    })
  }

  if (ghReview.value.unique_reviewer_count != null) {
    metrics.push({
      id: 'github-unique-reviewers',
      title: 'Unique Reviewers',
      value: ghReview.value.unique_reviewer_count,
      description: 'Active reviewers this period',
      icon: 'bi-people',
      dataSource: githubDataSourceInfo.value.dataSource,
      dataSourceLabel: githubDataSourceInfo.value.dataSourceLabel
    })
  }

  if (ghReview.value.pr_reopened_count != null) {
    metrics.push({
      id: 'github-pr-reopens',
      title: 'PR Reopens',
      value: ghReview.value.pr_reopened_count,
      description: 'Reopened PRs this period',
      icon: 'bi-arrow-clockwise',
      dataSource: githubDataSourceInfo.value.dataSource,
      dataSourceLabel: githubDataSourceInfo.value.dataSourceLabel
    })
  }

  if (ghReview.value.first_review_at) {
    metrics.push({
      id: 'github-first-review',
      title: 'First Review',
      value: new Date(ghReview.value.first_review_at).toLocaleDateString(),
      description: 'First review this period',
      icon: 'bi-calendar-check',
      dataSource: githubDataSourceInfo.value.dataSource,
      dataSourceLabel: githubDataSourceInfo.value.dataSourceLabel
    })
  }
  
  return metrics
})

const deployOperateStageMetrics = computed(() => {
  if (!props.githubConnected || props.githubLoading || props.githubError) {
    return []
  }
  
  const metrics = []
  const latestDeployment = ghDeploy.value.latest_deployment
  
  if (latestDeployment?.status) {
    metrics.push({
      id: 'github-deployment-status',
      title: 'Deployment Status',
      value: latestDeployment.status,
      description: 'Latest deployment status this period',
      icon: 'bi-rocket-takeoff',
      dataSource: githubDataSourceInfo.value.dataSource,
      dataSourceLabel: githubDataSourceInfo.value.dataSourceLabel
    })
  }

  if (latestDeployment?.environment) {
    metrics.push({
      id: 'github-deployment-environment',
      title: 'Environment',
      value: latestDeployment.environment,
      description: 'Latest deployment environment',
      icon: 'bi-globe',
      dataSource: githubDataSourceInfo.value.dataSource,
      dataSourceLabel: githubDataSourceInfo.value.dataSourceLabel
    })
  }

  if (latestDeployment?.deployed_at) {
    metrics.push({
      id: 'github-deployment-date',
      title: 'Last Deployed',
      value: new Date(latestDeployment.deployed_at).toLocaleDateString(),
      description: 'Last deployment this period',
      icon: 'bi-calendar',
      dataSource: githubDataSourceInfo.value.dataSource,
      dataSourceLabel: githubDataSourceInfo.value.dataSourceLabel
    })
  }

  if (ghDeploy.value.failed_deployment_count != null) {
    metrics.push({
      id: 'github-failed-deployments',
      title: 'Failed Deployments',
      value: ghDeploy.value.failed_deployment_count,
      description: 'Failed deployments this period',
      icon: 'bi-exclamation-triangle',
      dataSource: githubDataSourceInfo.value.dataSource,
      dataSourceLabel: githubDataSourceInfo.value.dataSourceLabel
    })
  }

  if (ghDeploy.value.rollback_detected != null) {
    metrics.push({
      id: 'github-rollback-detected',
      title: 'Rollback Detected',
      value: ghDeploy.value.rollback_detected ? 'Yes' : 'No',
      description: 'Rollback detected this period',
      icon: 'bi-arrow-counterclockwise',
      dataSource: githubDataSourceInfo.value.dataSource,
      dataSourceLabel: githubDataSourceInfo.value.dataSourceLabel
    })
  }
  
  return metrics
})

// Computed flag for embedded mode
const isEmbedded = computed(() => props.useExternalFilters === true)

// Time range filtering variables - initialize from props if using external filters
const timeFilter = ref(
  props.useExternalFilters
    ? normalizeTimeFilter(props.externalTimeFilter)
    : 'week'
)

const comparisonMode = ref(
  props.useExternalFilters && props.externalComparisonMode
    ? props.externalComparisonMode
    : 'week-over-week'
) // 'previous', 'day-over-day', 'week-over-week', 'month-over-month', 'custom'

const customStartDate = ref(
  props.useExternalFilters && props.externalCustomStartDate
    ? props.externalCustomStartDate
    : ''
)

const customEndDate = ref(
  props.useExternalFilters && props.externalCustomEndDate
    ? props.externalCustomEndDate
    : ''
)

const selectedRepo = ref(
  props.useExternalFilters && props.externalRepository
    ? props.externalRepository
    : ''
)
// Remove the local repositories ref since we'll use the one from the store

// Sync external props to local refs when in external filter mode
watch(
  () => props.externalTimeFilter,
  (val) => {
    if (props.useExternalFilters) {
      timeFilter.value = normalizeTimeFilter(val)
    }
  }
)

watch(
  () => props.externalComparisonMode,
  (val) => {
    if (props.useExternalFilters && val) {
      comparisonMode.value = val
    }
  }
)

watch(
  () => props.externalCustomStartDate,
  (val) => {
    if (props.useExternalFilters && val) {
      customStartDate.value = val
    }
  }
)

watch(
  () => props.externalCustomEndDate,
  (val) => {
    if (props.useExternalFilters && val) {
      customEndDate.value = val
    }
  }
)

watch(
  () => props.externalRepository,
  (val) => {
    if (props.useExternalFilters) {
      selectedRepo.value = val || ''
    }
  }
)

// Debug logging for insights prop (dev only)
watch(
  () => props.insights,
  (newInsights) => {
    if (import.meta.env.DEV) {
      console.debug('[EngOutput] Insights prop updated:', {
        count: newInsights?.length || 0,
        sample: newInsights?.[0],
        metricIds: newInsights?.map(i => i.metricId).filter(Boolean),
        allTags: newInsights?.flatMap(i => i.tags || [])
      })
      
      // Debug routing for each stage
      STAGES.forEach(stage => {
        const matched = sectionInsights(stage.id)
        console.debug(`[EngOutput] "${stage.label}" insights:`, {
          count: matched.length,
          titles: matched.map(i => i.title)
        })
      })
    }
  },
  { immediate: true, deep: true }
)

const metrics = computed(() => githubStore.metrics)

// GitHub input for insights engine
const ghInput = computed(() => ({
  prMerged: githubStore.metrics?.mergedPRs ?? 0,
  prOpened: githubStore.metrics?.pullRequests ?? 0,
  prClosed: (githubStore.metrics?.pullRequests ?? 0) - (githubStore.metrics?.mergedPRs ?? 0), // Approximate closed as total - merged
  prReopened: githubStore.metrics?.reopenedPRs ?? 0,
  timeToMergeHoursAvg: githubStore.metrics?.leadTime ?? 0,
  commentsPerPRAvg: githubStore.metrics?.commentToMergeRatio ?? 0,
  deployments: githubStore.metrics?.deploymentFrequency ?? 0,
  mttrHours: githubStore.metrics?.meanTimeToRecovery ?? 0,
}))

// DISABLED: Engineering insights now generated centrally by LabsPerfInsights.vue
// This component should only render the GitHub stats/graph, not generate insights
const engInsights = computed(() => {
  console.log('[PI_PAGE_LIVE] EngOutput - insights generation DISABLED (centralized)');
  return [] // Return empty array - insights are now generated by the parent page
})

// Interactive card management
const draggedIndex = ref(null)
const cardPreferences = ref({})

// GitHub drilldown state
const selectedMetricForDrilldown = ref(null)
const showDrilldownModal = ref(false)
const lastClickTime = ref(0) // Debounce rapid clicks
const drilldownLoading = ref(false) // Loading state for drilldown modal
const drilldownError = ref(null) // Error state for drilldown modal

// Define all available metrics using GitHub supporting signals only
const allMetrics = ref([
  // GitHub Supporting Signals - Review & Merge
  {
    id: 'github-review-count',
    title: 'Review Count',
    icon: 'bi-eye',
    category: 'Collaboration',
    stage: 'review',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    priority: 'high',
    value: computed(() => {
      const prm = effectiveGithubMetrics.value?.pr_review_metrics
      return prm?.review_count != null ? prm.review_count : '--'
    }),
    description: computed(() => {
      const prm = effectiveGithubMetrics.value?.pr_review_metrics
      return prm?.review_count != null && prm.review_count > 0 ? 'Total PR reviews' : 'Review throughput'
    })
  },
  {
    id: 'github-unique-reviewers',
    title: 'Unique Reviewers',
    icon: 'bi-people',
    category: 'Team',
    stage: 'review',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    priority: 'medium',
    value: computed(() => {
      const prm = effectiveGithubMetrics.value?.pr_review_metrics
      return prm?.unique_reviewer_count != null ? prm.unique_reviewer_count : '--'
    }),
    description: computed(() => {
      const prm = effectiveGithubMetrics.value?.pr_review_metrics
      return prm?.unique_reviewer_count != null && prm.unique_reviewer_count > 0 ? 'Distinct reviewers' : 'Reviewer coverage'
    })
  },
  {
    id: 'github-pr-reopened-count',
    title: 'PR Reopens',
    icon: 'bi-arrow-clockwise',
    category: 'Quality',
    stage: 'review',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const prm = effectiveGithubMetrics.value?.pr_review_metrics
      if (prm?.pr_reopened_count != null) {
        return prm.pr_reopened_count
      }
      return '—'
    }),
    description: computed(() => {
      const prm = effectiveGithubMetrics.value?.pr_review_metrics
      if (prm?.pr_reopened_count != null && prm.pr_reopened_count > 0) {
        return `${prm.pr_reopened_count} reopened PRs this period`
      }
      return 'No reopen data available'
    })
  },
  {
    id: 'github-first-review-at',
    title: 'First Review',
    icon: 'bi-clock-history',
    category: 'Efficiency',
    stage: 'review',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const prm = props.githubMetrics?.pr_review_metrics
      if (prm?.first_review_at != null) {
        return new Date(prm.first_review_at).toLocaleDateString()
      }
      return '—'
    }),
    description: computed(() => {
      const timestamp = ghReview.value.first_review_at
      return timestamp != null ? 'First review date' : 'No first review data'
    })
  },
  // GitHub Supporting Signals - Deploy & Operate
  {
    id: 'github-latest-deployment',
    title: 'Latest Deployment',
    icon: 'bi-rocket-takeoff',
    category: 'DevOps',
    stage: 'deploy-operate',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const dm = effectiveGithubMetrics.value?.deployment_metrics
      const ld = dm?.latest_deployment
      if (ld?.deployed_at != null) {
        return new Date(ld.deployed_at).toLocaleDateString()
      }
      return '—'
    }),
    description: computed(() => {
      const deployment = ghDeploy.value.latest_deployment
      return deployment != null ? 'Most recent deploy' : 'No deployment data'
    })
  },
  {
    id: 'github-failed-deployments',
    title: 'Failed Deployments',
    icon: 'bi-x-octagon',
    category: 'Quality',
    stage: 'deploy-operate',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const dm = effectiveGithubMetrics.value?.deployment_metrics
      if (dm?.failed_deployment_count != null) {
        return dm.failed_deployment_count
      }
      return '—'
    }),
    description: computed(() => {
      const dm = effectiveGithubMetrics.value?.deployment_metrics
      if (dm?.failed_deployment_count != null && dm.failed_deployment_count > 0) {
        return `Failed deployments: ${dm.failed_deployment_count}`
      }
      return 'No failed deployment data'
    })
  },
  {
    id: 'github-deployment-status',
    title: 'Deployment Status',
    icon: 'bi-check-circle',
    category: 'DevOps',
    stage: 'deploy-operate',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const dm = effectiveGithubMetrics.value?.deployment_metrics
      const ld = dm?.latest_deployment
      if (ld?.status != null) {
        return ld.status
      }
      return '—'
    }),
    description: computed(() => {
      const status = ghDeploy.value.latest_deployment?.status
      return status != null ? 'Latest deployment status' : 'No deployment status data'
    })
  },
  {
    id: 'github-deployment-environment',
    title: 'Deployment Environment',
    icon: 'bi-globe',
    category: 'DevOps',
    stage: 'deploy-operate',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const dm = effectiveGithubMetrics.value?.deployment_metrics
      const ld = dm?.latest_deployment
      if (ld?.environment != null) {
        return ld.environment
      }
      return '—'
    }),
    description: computed(() => {
      const environment = ghDeploy.value.latest_deployment?.environment
      return environment != null ? 'Deployment environment' : 'No environment data'
    })
  },
  {
    id: 'github-rollback-detected',
    title: 'Rollback Detected',
    icon: 'bi-arrow-counterclockwise',
    category: 'Quality',
    stage: 'deploy-operate',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const dm = effectiveGithubMetrics.value?.deployment_metrics
      if (dm?.rollback_detected != null) {
        return dm.rollback_detected ? 'Yes' : 'No'
      }
      return '—'
    }),
    description: computed(() => {
      const rollback = ghDeploy.value.rollback_detected
      return rollback != null ? 'Rollback detected' : 'No rollback data'
    })
  },
  // CR-X B4: Release metrics from backend release_metrics
  {
    id: 'github-total-releases',
    title: 'Total Releases',
    icon: 'bi-tag',
    category: 'DevOps',
    stage: 'deploy-operate',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const rm = effectiveGithubMetrics.value?.release_metrics
      if (rm?.total_releases != null) {
        return rm.total_releases
      }
      return '—'
    }),
    description: computed(() => {
      const rm = effectiveGithubMetrics.value?.release_metrics
      if (rm?.unavailable) {
        return 'Not available under current GitHub permissions'
      }
      if (rm?.total_releases != null && rm.total_releases > 0) {
        return `${rm.releases_in_period ?? rm.total_releases} releases in period`
      }
      return 'No releases in period'
    })
  },
  {
    id: 'github-latest-release',
    title: 'Latest Release',
    icon: 'bi-lightbulb',
    category: 'DevOps',
    stage: 'deploy-operate',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const rm = effectiveGithubMetrics.value?.release_metrics
      const lr = rm?.latest_release
      if (lr?.published_at != null) {
        return new Date(lr.published_at).toLocaleDateString()
      }
      if (lr?.tag_name != null) {
        return lr.tag_name
      }
      return '—'
    }),
    description: computed(() => {
      const rm = effectiveGithubMetrics.value?.release_metrics
      const lr = rm?.latest_release
      if (lr?.name != null) {
        return lr.name
      }
      if (lr?.tag_name != null) {
        return `Tag: ${lr.tag_name}`
      }
      return 'No releases published'
    })
  },
  // GitHub team metrics - Plan & Code stage
  {
    id: 'github-total-prs',
    title: 'Total PRs',
    icon: 'bi-git',
    category: 'Activity',
    stage: 'plan-code',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const total = ghTeam.value?.total_prs
      if (total != null) {
        return total
      }
      return '—'
    }),
    description: computed(() => {
      const total = ghTeam.value?.total_prs
      return total != null && total > 0 ? 'Total pull requests' : 'No PR data available'
    })
  },
  {
    id: 'github-total-commits',
    title: 'Total Commits',
    icon: 'bi-code-slash',
    category: 'Activity',
    stage: 'plan-code',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const count = ghTeam.value?.total_commits
      return count != null ? count : '--'
    }),
    description: computed(() => {
      const count = ghTeam.value?.total_commits
      return count != null && count > 0 ? 'Total commits' : 'Commit velocity'
    })
  },
  {
    id: 'github-merge-rate',
    title: 'Merge Rate',
    icon: 'bi-percent',
    category: 'Quality',
    stage: 'plan-code',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const rate = ghTeam.value?.merge_rate
      return rate != null ? `${rate}%` : '--'
    }),
    description: computed(() => {
      const rate = ghTeam.value?.merge_rate
      return rate != null ? 'PR merge rate' : 'Merge efficiency'
    })
  },
  {
    id: 'github-time-to-merge',
    title: 'Time to Merge',
    icon: 'bi-clock',
    category: 'Efficiency',
    stage: 'review',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const hours = ghTeam.value.time_to_merge
      return hours != null ? `${hours}h` : '--'
    }),
    description: computed(() => {
      const hours = ghTeam.value.time_to_merge
      return hours != null ? 'Average time to merge' : 'Merge latency'
    })
  },
  {
    id: 'github-pr-reopens',
    title: 'PR Reopens',
    icon: 'bi-arrow-repeat',
    category: 'Quality',
    stage: 'review',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const count = ghTeam.value.reopened_prs
      if (count != null) {
        return count
      }
      return '—'
    }),
    description: computed(() => {
      const count = ghTeam.value.reopened_prs
      return count != null && count > 0 ? 'Reopened pull requests' : 'No reopen data available'
    })
  },
  {
    id: 'github-rejected-prs',
    title: 'Rejected PRs',
    icon: 'bi-x-circle',
    category: 'Quality',
    stage: 'review',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const count = ghTeam.value.rejected_prs
      if (count != null) {
        return count
      }
      return '—'
    }),
    description: computed(() => {
      const count = ghTeam.value.rejected_prs
      return count != null && count > 0 ? 'Rejected pull requests' : 'No rejection data available'
    })
  },
  {
    id: 'github-commits-per-day',
    title: 'Commits per Day',
    icon: 'bi-calendar-check',
    category: 'Activity',
    stage: 'plan-code',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const rate = ghTeam.value.commits_per_day
      if (rate != null) {
        return rate.toFixed(1)
      }
      return '—'
    }),
    description: computed(() => {
      const rate = ghTeam.value.commits_per_day
      return rate != null ? 'Daily commit average' : 'No commit rate data'
    })
  },
  {
    id: 'github-total-repositories',
    title: 'Total Repositories',
    icon: 'bi-folder',
    category: 'Scope',
    stage: 'plan-code',
    dataSource: 'github',
    dataSourceLabel: 'GitHub',
    value: computed(() => {
      const count = ghTeam.value?.total_repositories
      if (count != null) {
        return count
      }
      return '—'
    }),
    description: computed(() => {
      const count = ghTeam.value?.total_repositories
      return count != null && count > 0 ? 'Total repositories' : 'No repository data'
    })
  }
  ])

// Load card preferences from localStorage
function loadCardPreferences() {
  try {
    const saved = localStorage.getItem('codesight_card_preferences')
    if (saved) {
      cardPreferences.value = JSON.parse(saved)
    }
  } catch (error) {
    warn('Failed to load card preferences:', error)
  }
}

// Save card preferences to localStorage
function saveCardPreferences() {
  try {
    localStorage.setItem('codesight_card_preferences', JSON.stringify(cardPreferences.value))
  } catch (error) {
    warn('Failed to save card preferences:', error)
  }
}

// Simple stable implementation to avoid infinite re-renders
const visibleMetrics = ref([])
const hiddenMetrics = ref([])
const availableMetrics = ref([])
const visibleByStage = ref({ 'plan-code': [], 'review': [], 'deploy-operate': [] })

// Initialize metrics on mount
onMounted(() => {
  // Dev-only diagnostics - log per-stage metric keys and counts once on mount
  if (import.meta.env.DEV) {
    console.log('🔍 [DEV] Stage Metrics Diagnostics:')
    const stages = ['plan-code', 'review', 'deploy-operate']
    stages.forEach(stageId => {
      const stageMetrics = allStageMetrics.value[stageId] || []
      console.log(`  ${stageId}: ${stageMetrics.length} metrics`)
      console.log(`    Keys: [${stageMetrics.map(m => m.id).join(', ')}]`)
    })
  }
  
  // Load card preferences
  loadCardPreferences()
  
  // Initialize visible metrics from allMetrics
  const metricsByStage = {
    'plan-code': [],
    'review': [],
    'deploy-operate': []
  }
  
  allMetrics.value.forEach(metric => {
    if (metricsByStage[metric.stage]) {
      metricsByStage[metric.stage].push(metric)
    }
  })
  
  visibleByStage.value = metricsByStage
})

// Map insights to a specific CI/CD stage (max 2 per stage)
// CURRENT DATA SOURCE: props.insights (PerformanceInsight[] from runPerfInsightsHarness in Dashboards.vue)
// SELECTION LOGIC: Filter by cicdStage field, sorted by severity priority
function sectionInsights(stage) {
  if (!props.insights?.length) {
    if (import.meta.env.DEV) {
      console.debug(`[EngOutput] sectionInsights(${stage}): No insights received`)
    }
    return []
  }
  
  // Map EngOutput stage IDs to PerformanceInsight cicdStage values
  // EngOutput uses: 'plan-code', 'review', 'deploy-operate'
  // PerformanceInsight uses: 'plan-code', 'review-merge', 'deploy-operate', 'other'
  const stageMapping = {
    'plan-code': ['plan-code'],
    'review': ['review-merge'],  // Map 'review' to 'review-merge'
    'deploy-operate': ['deploy-operate']
  }
  
  const targetStages = stageMapping[stage] || []
  
  // Step 1: Filter by cicdStage field (primary filter)
  const candidates = props.insights.filter((insight) => {
    // Primary: Match by cicdStage
    if (insight.cicdStage && targetStages.includes(insight.cicdStage)) {
      return true
    }
    
    // Fallback: For 'plan-code', also accept insights without cicdStage that mention planning/coding
    // (only if no stage-specific insights exist, to avoid showing wrong stage insights)
    if (stage === 'plan-code' && !insight.cicdStage) {
      const title = (insight.title || '').toLowerCase()
      const desc = (insight.description || '').toLowerCase()
      const tags = (insight.tags || []).join(' ').toLowerCase()
      if (tags.includes('plan-code') || tags.includes('productivity') || 
          (title.includes('coding') && !title.includes('review') && !title.includes('deploy'))) {
        return true
      }
    }
    
    return false
  })
  
  // Step 2: Sort by severity priority (critical > risk > warning > highlight > opportunity > lowlight > info)
  // Then by dataSource (real > mixed > sim > unknown)
  // Then by id for determinism
  const severityPriority = {
    'critical': 6,
    'risk': 5,
    'warning': 4,
    'highlight': 3,
    'opportunity': 2,
    'lowlight': 1,
    'info': 0
  }
  
  const dataSourcePriority = {
    'real': 4,
    'mixed': 3,
    'sim': 2,
    'unknown': 1
  }
  
  const sorted = [...candidates].sort((a, b) => {
    // Primary: severity (check both severity and normalizedSeverity)
    const severityA = severityPriority[(a.severity || a.normalizedSeverity || 'info').toLowerCase()] || 0
    const severityB = severityPriority[(b.severity || b.normalizedSeverity || 'info').toLowerCase()] || 0
    if (severityB !== severityA) {
      return severityB - severityA
    }
    
    // Secondary: dataSource
    const dataSourceA = dataSourcePriority[(a.dataSource || 'unknown').toLowerCase()] || 0
    const dataSourceB = dataSourcePriority[(b.dataSource || 'unknown').toLowerCase()] || 0
    if (dataSourceB !== dataSourceA) {
      return dataSourceB - dataSourceA
    }
    
    // Tertiary: id for determinism
    return (a.id || '').localeCompare(b.id || '')
  })
  
  // Step 3: Return at most 2 insights per section
  const result = sorted.slice(0, 2)
  
  // Dev logging
  if (import.meta.env.DEV) {
    console.debug(`[EngOutput] sectionInsights(${stage}):`, {
      totalInsights: props.insights.length,
      candidates: candidates.length,
      final: result.length,
      examples: result.map((i) => ({
        title: i.title,
        cicdStage: i.cicdStage,
        severity: i.severity,
        normalizedSeverity: i.normalizedSeverity,
        dataSource: i.dataSource
      }))
    })
  }
  
  return result
}

// Styling helper functions for CI/CD sections
function getStageColor(stageId) {
  const colors = {
    'plan-code': 'info',
    'review': 'primary',
    'deploy-operate': 'success'
  }
  return colors[stageId] || 'secondary'
}

function getStageDescription(stageId) {
  const descriptions = {
    'plan-code': 'Development & Planning Phase',
    'review': 'Code Review & Merge Process',
    'deploy-operate': 'Deployment & Operations'
  }
  return descriptions[stageId] || ''
}

// Real GitHub metrics implementation - stable to avoid infinite loop
const allStageMetrics = computed(() => {
  const result = {
    'plan-code': [],
    'review': [],
    'deploy-operate': []
  }
  
  // Filter allMetrics by stage - include all metrics regardless of value
  allMetrics.value.forEach(metric => {
    if (result[metric.stage]) {
      result[metric.stage].push(metric)
    }
  })
  
  return result
})

// Helper function to check if GitHub data exists for a stage
// DEPRECATED: Now only checks GitHub connection state, not metric presence
function hasGitHubDataForStage(stageId) {
  // Return true if GitHub is connected, regardless of metric values
  // Metric absence is NOT a reason to hide a stage
  return props.githubConnected === true
}

// Helper function to get appropriate empty message for a stage
function getGitHubEmptyMessage(stageId) {
  if (stageId === 'review') {
    return 'No PR review data found in selected window'
  }
  
  if (stageId === 'deploy-operate') {
    return 'No GitHub deployment events detected (Deployments API)'
  }
  
  return 'No GitHub data available for this stage'
}


function getSeverityBadgeClass(insight) {
  const severity = (insight.severity || insight.normalizedSeverity || 'info').toLowerCase()
  
  const severityMap = {
    'critical': 'bg-danger text-white',
    'high': 'bg-warning text-dark',
    'moderate': 'bg-info text-white',
    'watchlist': 'bg-secondary text-white',
    'risk': 'bg-danger text-white',
    'warning': 'bg-warning text-dark',
    'info': 'bg-info text-white',
    'opportunity': 'bg-success text-white',
    'highlight': 'bg-primary text-white',
    'lowlight': 'bg-secondary text-white'
  }
  
    
  return severityMap[severity] || 'bg-secondary text-white'
}

function getInsightIcon(insight) {
  const severity = (insight.severity || insight.normalizedSeverity || 'info').toLowerCase()
  const iconMap = {
    'critical': 'bi-exclamation-triangle-fill',
    'risk': 'bi-exclamation-circle-fill',
    'warning': 'bi-exclamation-diamond-fill',
    'info': 'bi-info-circle-fill',
    'opportunity': 'bi-arrow-up-circle-fill',
    'highlight': 'bi-star-fill',
    'lowlight': 'bi-dash-circle-fill'
  }
  return iconMap[severity] || 'bi-lightbulb-fill'
}

function getInsightBorderClass(insight) {
  const severity = (insight.severity || insight.normalizedSeverity || 'info').toLowerCase()
  return `insight-${severity}`
}

function getSeverityColor(insight) {
  const severity = (insight.severity || insight.normalizedSeverity || 'info').toLowerCase()
  const colorMap = {
    'critical': '#dc3545',
    'risk': '#dc3545',
    'warning': '#ffc107',
    'info': '#0dcaf0',
    'opportunity': '#198754',
    'highlight': '#0d6efd',
    'lowlight': '#6c757d'
  }
  return colorMap[severity] || '#6c757d'
}

// Toggle card visibility
function toggleCardVisibility(metricId) {
  if (!cardPreferences.value[metricId]) {
    cardPreferences.value[metricId] = {}
  }
  cardPreferences.value[metricId].hidden = !cardPreferences.value[metricId].hidden
  saveCardPreferences()
}

// Remove card permanently
function removeCard(metricId) {
  if (!cardPreferences.value[metricId]) {
    cardPreferences.value[metricId] = {}
  }
  cardPreferences.value[metricId].removed = true
  cardPreferences.value[metricId].hidden = false
  saveCardPreferences()
}

// Add card to dashboard
function addCard(metricId) {
  if (!cardPreferences.value[metricId]) {
    cardPreferences.value[metricId] = {}
  }
  cardPreferences.value[metricId].removed = false
  cardPreferences.value[metricId].hidden = false
  cardPreferences.value[metricId].added = true
  saveCardPreferences()
}

// Reset all cards to default state
function resetAllCards() {
  if (confirm('Are you sure you want to reset all cards to their default state? This will show all cards and reset their order.')) {
    cardPreferences.value = {}
    saveCardPreferences()
  }
}

// GitHub drilldown click handler
function handleGitHubMetricClick(metricId, metricTitle) {
  const now = Date.now()
  
  // Debounce rapid clicks (prevent multiple calls within 500ms)
  if (now - lastClickTime.value < 500) {
    return
  }
  lastClickTime.value = now
  
  // 🔥 PHASE 4: Guard against clicks when GitHub data is not ready
  if (!props.githubReady) {
    return
  }
  
  // Feature guard - do nothing if disabled
  if (!GITHUB_DRILLDOWN_ENABLED) {
    return
  }

  // Extract the metric key from the metric ID (remove prefix and convert hyphens to underscores)
  let metricKey = metricId
  if (metricId.startsWith('github-')) {
    metricKey = metricId.replace('github-', '').replace(/-/g, '_')
  }
  
  // Validate metric is supported for drilldown
  if (!isSupportedGitHubMetric(metricKey)) {
    return
  }

  // Set loading state with timeout protection
  drilldownLoading.value = true
  drilldownError.value = null
  
  // Set timeout to prevent infinite loading (5 seconds)
  const loadingTimeout = setTimeout(() => {
    if (drilldownLoading.value) {
      drilldownLoading.value = false
      drilldownError.value = 'Data loading timed out. Please try again.'
    }
  }, 5000)

  // Set selected metric and show modal
  selectedMetricForDrilldown.value = metricKey
  showDrilldownModal.value = true
  
  // Clear loading state immediately (data should be available from props)
  clearTimeout(loadingTimeout)
  drilldownLoading.value = false
}

// Close drilldown modal
function closeDrilldownModal() {
  showDrilldownModal.value = false
  selectedMetricForDrilldown.value = null
  drilldownLoading.value = false
  drilldownError.value = null
}

// Drag and drop functionality
function handleDragStart(event, index) {
  draggedIndex.value = index
  event.dataTransfer.effectAllowed = 'move'
}

function handleDragEnter(event, index) {
  if (draggedIndex.value !== null && draggedIndex.value !== index) {
    event.currentTarget.classList.add('drag-over')
  }
}

function handleDragLeave(event, index) {
  event.currentTarget.classList.remove('drag-over')
}

function handleDrop(event, dropIndex) {
  event.preventDefault()
  event.currentTarget.classList.remove('drag-over')
  
  if (draggedIndex.value === null || draggedIndex.value === dropIndex) {
    draggedIndex.value = null
    return
  }
  
  // Reorder metrics
  const draggedMetric = visibleMetrics.value[draggedIndex.value]
  const dropMetric = visibleMetrics.value[dropIndex]
  
  // Update order in preferences
  if (!cardPreferences.value[draggedMetric.id]) {
    cardPreferences.value[draggedMetric.id] = {}
  }
  if (!cardPreferences.value[dropMetric.id]) {
    cardPreferences.value[dropMetric.id] = {}
  }
  
  cardPreferences.value[draggedMetric.id].order = dropIndex
  cardPreferences.value[dropMetric.id].order = draggedIndex.value
  
  saveCardPreferences()
  draggedIndex.value = null
}

// Compute the actual time range being displayed based on backend response
const actualTimeRange = computed(() => {
  if (!metrics.value) return 'Loading...'
  
  // Check if we have real data and what time range it represents
  if (metrics.value?.pullRequests > 0) {
    // Since we're getting real GitHub data, this represents "all time" 
    // but limited to recent repositories for performance
    return 'All time (limited to recent repos for performance)'
  }
  
  return 'No data available'
})

// Format time to merge properly - convert hours to appropriate units
const formatTimeToMerge = (hours) => {
  if (!hours || hours === 0) return '--'
  
  if (hours < 1) {
    return `${Math.round(hours * 60)}m` // Show in minutes if less than 1 hour
  } else if (hours < 24) {
    return `${hours}h` // Show in hours if less than 1 day
  } else {
    const days = Math.round(hours / 24 * 10) / 10 // Round to 1 decimal place
    return `${days}d` // Show in days
  }
}

// 🔥 PHASE 1B: Child components read from store, don't write
// Watch filter store changes instead of handling events
watch(() => filters.filters?.productivity?.timeComparison, (newTimeComparison) => {
  if (newTimeComparison) {
    log('🔄 EngOutput timeComparison changed in store:', newTimeComparison)
    
    // Map the new combined timeComparison filter to existing filter values
    if (newTimeComparison === 'wow') {
      timeFilter.value = 'week'
      comparisonMode.value = 'week-over-week'
    } else if (newTimeComparison === 'mom') {
      timeFilter.value = 'month'
      comparisonMode.value = 'month-over-month'
    } else if (newTimeComparison === 'qoq') {
      timeFilter.value = 'custom'
      comparisonMode.value = 'quarter-over-quarter'
      // Set custom dates for quarter (90 days)
      const today = new Date()
      const quarterAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
      customStartDate.value = quarterAgo.toISOString().split('T')[0]
      customEndDate.value = today.toISOString().split('T')[0]
    } else if (newTimeComparison === 'dod') {
      timeFilter.value = 'day'
      comparisonMode.value = 'day-over-day'
    } else if (newTimeComparison === 'hoh') {
      timeFilter.value = 'hour'
      comparisonMode.value = 'hour-over-hour'
    } else if (newTimeComparison === 'all') {
      timeFilter.value = 'all'
      comparisonMode.value = 'none'
    } else if (newTimeComparison === 'custom') {
      timeFilter.value = 'custom'
      comparisonMode.value = 'custom'
      customStartDate.value = filters.customStartDate || ''
      customEndDate.value = filters.customEndDate || ''
    }
    
    // Update repository filter
    selectedRepo.value = filters.repository || ''
    
    // Refresh metrics with new settings
    refreshMetrics()
  }
})

// Handle time controls change (legacy - keeping for compatibility)
const handleTimeControlsChange = (controls) => {
  log('🔄 Time controls changed:', controls)
  
  // Map the new controls to existing filter values
  if (controls.range === 'week') {
    timeFilter.value = 'week'
  } else if (controls.range === 'month') {
    timeFilter.value = 'month'
  } else if (controls.range === 'quarter') {
    timeFilter.value = 'custom'
    // Set custom dates for quarter (90 days)
    const today = new Date()
    const quarterAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
    customStartDate.value = quarterAgo.toISOString().split('T')[0]
    customEndDate.value = today.toISOString().split('T')[0]
  } else if (controls.range === 'all') {
    timeFilter.value = 'all'
  }
  
  // Map comparison modes
  if (controls.comparison === 'wow') {
    comparisonMode.value = 'week-over-week'
  } else if (controls.range === 'mom') {
    comparisonMode.value = 'month-over-month'
  } else if (controls.comparison === 'qoq') {
    comparisonMode.value = 'previous'
  } else if (controls.comparison === 'none') {
    comparisonMode.value = 'previous'
  }
  
  // Refresh metrics with new settings
  refreshMetrics()
}

// Refresh metrics with current filters
const refreshMetrics = async () => {
  log('🔄 Refreshing metrics with filters:', {
    timeFilter: timeFilter.value,
    comparisonMode: comparisonMode.value,
    customStartDate: customStartDate.value,
    customEndDate: customEndDate.value,
    selectedRepo: selectedRepo.value
  })
  
  // 🔥 SAFETY FIX: Only fetch if we have no existing GitHub data to prevent overwriting 'all' payload
  const githubStore = useGitHubStore()
  
  // 🔥 PHASE 1.1A: EngOutput fetch attempt logging
  console.log('[ENGOUTPUT_ATTEMPT_FETCH]', {
    timeFilter: timeFilter.value,
    hasStoreRawResponse: !!githubStore.rawResponse,
    hasStoreRawGitHubKeys: !!(githubStore.rawResponse?.github_team_metrics || githubStore.rawResponse?.team_metrics || githubStore.rawResponse?.github_connected),
    inFlightAllFetch: githubStore.isFetchingMetrics // Check if 'all' fetch is in progress
  });
  
  if (githubStore.rawResponse) {
    log('🔄 Skipping GitHub fetch - using existing data from Dashboards')
    return
  }
  
  try {
    await githubStore.fetchMetrics(timeFilter.value, {
      comparisonMode: comparisonMode.value,
      customStartDate: customStartDate.value,
      customEndDate: customEndDate.value,
      repository: selectedRepo.value,
      source: 'EngOutput'
    })
  } catch (err) {
    logError('❌ Failed to refresh metrics:', err)
  }
}

// Watchers for automatic synchronization
watch(comparisonMode, (newComparisonMode) => {
  log('🔄 Comparison mode changed to:', newComparisonMode)
  
  // Auto-sync time filter with comparison mode
  if (newComparisonMode === 'day-over-day') {
    timeFilter.value = 'day'
  } else if (newComparisonMode === 'week-over-week') {
    timeFilter.value = 'week'
  } else if (newComparisonMode === 'month-over-month') {
    timeFilter.value = 'month'
  }
})

watch(timeFilter, async (newTimeFilter) => {
  log('🔄 Time filter changed to:', newTimeFilter)
  
  // Auto-sync comparison mode with time filter
  if (comparisonMode.value === 'day-over-day' && newTimeFilter !== 'day') {
    comparisonMode.value = 'previous'
  } else if (comparisonMode.value === 'week-over-week' && newTimeFilter !== 'week') {
    comparisonMode.value = 'previous'
  } else if (comparisonMode.value === 'month-over-month' && newTimeFilter !== 'month') {
    comparisonMode.value = 'previous'
  }
  
  // Fetch new metrics with the updated time filter
  try {
    await githubStore.fetchMetrics(newTimeFilter)
    log('✅ Refreshed GitHub metrics for time filter:', newTimeFilter)
  } catch (error) {
    logError('❌ Failed to refresh GitHub metrics:', error)
  }
})

// Initialize custom dates
onMounted(() => {
  const today = new Date()
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  
  customStartDate.value = lastWeek.toISOString().split('T')[0]
  customEndDate.value = today.toISOString().split('T')[0]
})

// Apply time filters to metrics data
const applyTimeFilter = (metricsData) => {
  if (!metricsData) return metricsData
  
  const filteredData = { ...metricsData }
  
  // Apply time-based filtering logic here
  // This would typically involve filtering the raw data based on timeFilter.value
  // For now, we'll just return the data as-is since the backend should handle filtering
  
  log('🔍 Applying time filter:', timeFilter.value, 'to metrics data')
  return filteredData
}

// Get filtered metrics
const filteredMetrics = computed(() => {
  return applyTimeFilter(metrics.value)
})



// Refresh repositories list
const refreshRepositories = async () => {
  try {
    log('🔄 Manually refreshing repositories...')
    await githubStore.fetchRepositories()
    log('✅ Repositories refreshed successfully')
  } catch (err) {
    logError('❌ Failed to refresh repositories:', err)
  }
}





onMounted(async () => {
  log('🔍 EngOutput component mounted')
  
  // 🔥 PHASE 0 EVIDENCE: EngOutput prop tracing on mount
  console.log('[ENGOUTPUT_GH_PROP]', {
    hasGithubMetrics: !!props.githubMetrics,
    keys: props.githubMetrics ? Object.keys(props.githubMetrics).slice(0,20) : null,
    totalPRs: props.githubMetrics?.github_team_metrics?.total_prs
  })
  
  // Load card preferences
  loadCardPreferences()
  
  log('Initial store state:', {
    metrics: githubStore.metrics,
    loading: githubStore.loading,
    error: githubStore.error,
    repositories: githubStore.repositories
  })
  
  try {
    log('🔄 Fetching repositories...')
    const repos = await githubStore.fetchRepositories()
    log('✅ Repositories fetched successfully:', repos)
    log('✅ Store repositories state after fetch:', githubStore.repositories)
    log('✅ Repositories length:', githubStore.repositories.length)
    
    log('🔄 Fetching metrics...')
    await refreshMetrics()
    log('✅ Metrics fetched successfully:', githubStore.metrics)
  } catch (err) {
    logError('❌ Failed to fetch data:', err)
  }
})
</script>

<style scoped>
/* Container layout modes */
.eng-output-container {
  position: relative;  /* default/standalone layout */
}

.eng-output-standalone {
  padding: 1.5rem;
}

.eng-output-embedded {
  padding: 0;           /* Let parent card handle padding */
  margin-top: 0.5rem;   /* Small spacing from Productivity section header */
  background: transparent;
}

/* Make EngOutput cards visually consistent with ProductivityOverTime cards */

/* GitHub metric drilldown styles */
.clickable-github-card {
  cursor: pointer;
  transition: all 0.2s ease;
  border: 2px solid transparent;
}

.clickable-github-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-color: #0d6efd;
  background-color: #f8f9ff;
}

.clickable-github-card:active {
  transform: translateY(0);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}
.eng-output-embedded .card {
  border-radius: 1rem;
  border: 1px solid #e9ecef;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transition: all 0.2s ease-in-out;
}

.eng-output-embedded .card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}

/* Legacy selector support */
.eng-output-container .card {
  transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
  position: relative;
}

.eng-output-container .card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

/* Interactive card styles */
.metric-card-wrapper {
  transition: transform 0.2s ease-in-out;
}

.metric-card-wrapper.dragging {
  opacity: 0.5;
  transform: rotate(5deg);
}

.metric-card-wrapper.drag-over {
  transform: scale(1.02);
  box-shadow: 0 0 20px rgba(13, 110, 253, 0.3);
}

.metric-card {
  cursor: grab;
  transition: all 0.2s ease-in-out;
}

.metric-card:active {
  cursor: grabbing;
}

.metric-card .card-header {
  background-color: #f8f9fa;
  border-bottom: 1px solid #dee2e6;
}

.metric-card .card-controls {
  opacity: 0.7;
  transition: opacity 0.2s ease-in-out;
}

.metric-card:hover .card-controls {
  opacity: 1;
}

.drag-handle {
  transition: color 0.2s ease-in-out;
}

.drag-handle:hover {
  color: #495057 !important;
}

/* Border dashed for add/remove sections */
.border-dashed {
  border: 2px dashed #dee2e6;
  background-color: #f8f9fa;
  transition: all 0.3s ease-in-out;
}

.border-dashed:hover {
  border-color: #0d6efd;
  background-color: #f0f8ff;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(13, 110, 253, 0.1);
}

.border-dashed .card-header {
  background-color: #e9ecef;
  border-bottom: 1px solid #dee2e6;
}

/* Enhanced metric cards */
.metric-card {
  border-radius: 1rem;
  transition: all 0.3s ease-in-out;
  border: 1px solid #e9ecef;
}

.metric-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
  border-color: #0d6efd;
}

.metric-card .card-header {
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  border-radius: 1rem 1rem 0 0;
  border-bottom: 1px solid #dee2e6;
}

.metric-card .card-body {
  padding: 1rem;
}

/* Enhanced data source badges */
.data-source-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  font-size: 0.7rem;
  padding: 4px 8px;
  border-radius: 12px;
  font-weight: bold;
  color: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.data-source-badge.real {
  background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
}

.data-source-badge.simulated {
  background: linear-gradient(135deg, #ffc107 0%, #fd7e14 100%);
  color: #212529;
}

.data-source-badge.github {
  background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
  color: white;
}

/* Enhanced buttons */
.enhanced-button {
  border-radius: 0.5rem;
  font-weight: 500;
  transition: all 0.2s ease-in-out;
  border-width: 1.5px;
  padding: 0.375rem 0.75rem;
}

.enhanced-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.btn-outline-secondary:hover,
.btn-outline-primary:hover,
.btn-outline-success:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

/* Card controls positioning */
.metric-card {
  position: relative;
}

.metric-card .card-controls {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  gap: 0.5rem;
  opacity: 0;
  transition: opacity 0.2s ease-in-out;
  z-index: 10;
}

.metric-card:hover .card-controls {
  opacity: 1;
}

.metric-card .card-controls .enhanced-button {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  line-height: 1;
  min-width: auto;
}

/* Loading and error states */
.alert {
  border-radius: 0.75rem;
  border: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.alert-info {
  background: linear-gradient(135deg, #d1ecf1 0%, #bee5eb 100%);
  color: #0c5460;
}

.alert-danger {
  background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
  color: #721c24;
}

.alert-warning {
  background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
  color: #856404;
}

.eng-output .card-body {
  padding: 1rem;
}

.eng-output .bi {
  display: block;
}

.data-source-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 12px;
  font-weight: bold;
  color: white;
}

.data-source-badge.real {
  background-color: #28a745;
}

.data-source-badge.simulated {
  background-color: #ffc107;
  color: #212529;
}

.data-source-badge.small {
  font-size: 0.6rem;
  padding: 1px 4px;
  top: 5px;
  right: 5px;
}





.eng-output .card-header {
  border-bottom: 1px solid rgba(0, 0, 0, 0.125);
}

.eng-output .form-text {
  font-size: 0.875rem;
  color: #6c757d !important;
}

/* ====== CI/CD Section Styles ====== */

/* Section card container */
.cicd-section {
  border-radius: 1rem;
  border-left: 4px solid transparent;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  animation: fadeInUp 0.5s ease-out;
}

.cicd-section:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

/* Stage-specific border colors */
.cicd-section.stage-plan-code {
  border-left-color: #0dcaf0; /* info */
}

.cicd-section.stage-review {
  border-left-color: #0d6efd; /* primary */
}

.cicd-section.stage-deploy-operate {
  border-left-color: #198754; /* success */
}

/* Section header */
.cicd-section-header {
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #f0f0f0;
}

/* Stage icon wrapper */
.stage-icon-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  font-size: 1.25rem;
}

/* Insights box */
.cicd-insights-box {
  background: linear-gradient(135deg, #fffbf0 0%, #fff8e6 100%);
  border: 1px solid #ffd60a;
  border-radius: 0.75rem;
  padding: 0.75rem 1rem;
}

.insight-item {
  padding: 0.5rem;
  border-radius: 0.5rem;
  background: white;
  border-left: 3px solid #dee2e6;
  margin-bottom: 0.25rem;
  transition: all 0.2s ease;
}

.insight-item:last-child {
  margin-bottom: 0;
}

.insight-item:hover {
  transform: translateX(4px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.insight-item.insight-critical,
.insight-item.insight-risk {
  border-left-color: #dc3545;
  background: #fff5f5;
}

.insight-item.insight-warning {
  border-left-color: #ffc107;
  background: #fffbf0;
}

.insight-item.insight-info {
  border-left-color: #0dcaf0;
  background: #f0f9ff;
}

.insight-item.insight-opportunity {
  border-left-color: #198754;
  background: #f0fdf4;
}

.insight-severity-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
  margin-top: 0.125rem;
}

/* Insights placeholder (empty state) */
.cicd-insights-placeholder {
  background: #f8f9fa;
  border: 1px dashed #dee2e6;
  border-radius: 0.75rem;
}

/* Badge utilities */
.badge-sm {
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.bg-info-subtle {
  background-color: rgba(13, 202, 240, 0.1) !important;
  color: #0dcaf0 !important;
}

.bg-primary-subtle {
  background-color: rgba(13, 110, 253, 0.1) !important;
  color: #0d6efd !important;
}

.bg-success-subtle {
  background-color: rgba(25, 135, 84, 0.1) !important;
  color: #198754 !important;
}

.text-info {
  color: #0dcaf0 !important;
}

.text-primary {
  color: #0d6efd !important;
}

.text-success {
  color: #198754 !important;
}

/* Metric cards enhancement within sections */
.cicd-section .metric-card {
  border: 1px solid #e9ecef;
  transition: all 0.2s ease;
}

.cicd-section .metric-card:hover {
  border-color: #0d6efd;
  box-shadow: 0 4px 12px rgba(13, 110, 253, 0.1);
}

/* Fade-in animation */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.cicd-section:nth-child(1) {
  animation-delay: 0.1s;
}

.cicd-section:nth-child(2) {
  animation-delay: 0.2s;
}

.cicd-section:nth-child(3) {
  animation-delay: 0.3s;
}

/* 3-Layer Layout Styles */
.cicd-layer {
  border-left: 3px solid #e9ecef;
  padding-left: 0.75rem;
  margin-bottom: 1rem;
}

.cicd-layer-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid #e9ecef;
}

.core-metric-card {
  border-left: 4px solid #198754;
  background: linear-gradient(135deg, #f8fff9 0%, #e6f7ff 100%);
}

.supporting-signal-card {
  border-left: 3px solid #6c757d;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 0.5rem;
  min-height: 110px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.supporting-signal-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.supporting-signal-card .card-body {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.supporting-signal-card h6 {
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.supporting-signal-card h4 {
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 0;
}

.supporting-signal-card .data-source-badge {
  font-size: 0.575rem;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-weight: 600;
  letter-spacing: 0.05em;
}

/* 🔥 PHASE 4: GitHub card states for gating */
.clickable-github-card {
  cursor: pointer;
  transition: all 0.2s ease;
}

.clickable-github-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.disabled-github-card {
  cursor: not-allowed;
  opacity: 0.6;
  pointer-events: none;
}

.disabled-github-card:hover {
  transform: none;
  box-shadow: none;
}
</style>
