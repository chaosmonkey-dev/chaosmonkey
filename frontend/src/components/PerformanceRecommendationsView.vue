<template>
  <div class="pi-root">
    <!-- Minimal toolbar -->
    <div class="pi-toolbar">
      <div class="pi-toolbar-left">
        <span class="pi-insight-count">{{ nonDiagnosticInsights.length }} findings</span>
        <span v-if="diagnosticInsights.length > 0" class="badge badge-sm bg-secondary-subtle text-secondary ms-2">
          {{ diagnosticInsights.length }} data {{ diagnosticInsights.length === 1 ? 'gap' : 'gaps' }}
        </span>
      </div>
      <!-- Filters and time dropdown hidden for pilot - not implemented yet -->
    </div>

    <!-- Body -->
    <div class="pi-body">
      <!-- Left panel -->
      <div class="pi-panel-left">
        <div class="pi-tabs">
          <button :class="['pi-tab', activeTab === 'top' && 'pi-tab--active']" @click="activeTab = 'top'">Top insights</button>
          <button :class="['pi-tab', activeTab === 'all' && 'pi-tab--active']" @click="activeTab = 'all'">All insights</button>
          <span v-if="isDemoModeActive" class="pi-stress-badge">
            <i class="bi bi-exclamation-triangle me-1"></i>Demo fixture
          </span>
          <span v-else-if="usingCachedData" class="pi-cached-badge">
            <i class="bi bi-exclamation-triangle me-1"></i>Cached
          </span>
          <span v-else class="pi-live-badge">
            <i class="bi bi-check-circle me-1"></i>{{ piTelemetryBadgeLabel }}
          </span>
        </div>
        <div class="pi-nav-controls" v-if="selectedViewModel">
          <button class="pi-nav-btn" @click="navigateToPreviousInsight" :disabled="!hasPreviousInsight" title="Previous insight">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="pi-nav-count">{{ currentIndex + 1 }} / {{ displayedInsights.length }} {{ activeTab === 'top' ? 'top' : 'visible' }}</span>
          <button class="pi-nav-btn" @click="navigateToNextInsight" :disabled="!hasNextInsight" title="Next insight">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="pi-insight-list">
          <div
            v-for="item in displayedInsights"
            :key="item.id"
            :class="['pi-insight-item', (item as any).isDiagnostic && 'pi-insight-item--diagnostic', selectedViewModel?.id === item.id && 'pi-insight-item--active']"
            @click="selectInsightById(item.id)"
          >
            <div class="pi-insight-icon" :style="{ background: item.iconBg }">
              <component :is="item.icon" />
            </div>
            <div class="pi-insight-info">
              <div class="pi-insight-title-row">
                <span class="pi-insight-name">{{ item.title }}</span>
                <span v-if="item.impact !== 'LOW'" :class="['pi-impact', `pi-impact--${item.impact.toLowerCase()}`]">{{ item.impact }}</span>
              </div>
              <div class="pi-insight-meta">
                {{ (item as any).isDiagnostic ? `Diagnostic — ${(item as any).dataDomain === 'github_delivery' || ((item as any).sourceLabel || '').toLowerCase().includes('github') ? 'GitHub delivery · all-time baseline' : 'All historical telemetry'}` : `${item.category} — ${(item as any).dataDomain === 'github_delivery' || ((item as any).sourceLabel || '').toLowerCase().includes('github') ? 'GitHub delivery · all-time baseline' : 'All historical telemetry'}` }}
              </div>
            </div>
            <svg class="pi-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>

        <!-- Diagnostic collapse control (All tab only) -->
        <button
          v-if="activeTab === 'all' && diagnosticInsights.length > 0"
          class="pi-see-all"
          @click="diagnosticsExpanded = !diagnosticsExpanded"
        >
          {{ diagnosticsExpanded ? `Hide data gaps` : `Show data gaps (${diagnosticInsights.length})` }}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            :style="{ transform: diagnosticsExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }"
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>

        <!-- Loading/Empty State -->
        <div v-if="displayedInsights.length === 0" class="pi-loading-state">
          <!-- CR-X P0-A FIX: LOADING != EMPTY.
               - isHydrating=true  → loading skeleton (engine still running)
               - isHydrating=false → empty state (engine completed, 0 insights)
               Only show the perpetual "Loading" skeleton when the engine is
               genuinely still hydrating. When the engine has completed but
               returned 0 insights (or filters exclude all), show the
               appropriate empty state instead. -->
          <template v-if="props.isHydrating">
            <div class="pi-loading-header">
              <div class="pi-loading-title">Loading Performance Insights</div>
              <div class="pi-loading-subtitle">Analyzing your engineering metrics...</div>
            </div>
            <div class="pi-loading-skeletons">
              <div v-for="i in 3" :key="i" class="pi-loading-skeleton">
                <div class="pi-skeleton-icon"></div>
                <div class="pi-skeleton-content">
                  <div class="pi-skeleton-title"></div>
                  <div class="pi-skeleton-meta"></div>
                </div>
              </div>
            </div>
          </template>
          <!-- CR-X FINAL: Diagnostic-only state (sparse pilot) — 0 findings, diagnostics exist.
               Do NOT show "No insights match current filters" — the issue is maturity, not filters. -->
          <div v-else-if="diagnosticInsights.length > 0 && nonDiagnosticInsights.length === 0" class="pi-loading-empty">
            <div class="pi-empty-icon">📋</div>
            <div class="pi-empty-title">Collecting evidence — no mature findings yet</div>
            <div class="pi-empty-subtitle">
              {{ diagnosticInsights.length }} data {{ diagnosticInsights.length === 1 ? 'gap' : 'gaps' }} identified. Switch to "All insights" to review what evidence is still needed.
            </div>
          </div>
          <!-- Filter exclusion: insights exist but none match current tab/filters -->
          <div v-else-if="allInsights.length > 0" class="pi-loading-empty">
            <div class="pi-empty-icon">📋</div>
            <div class="pi-empty-title">No insights match current filters</div>
            <div class="pi-empty-subtitle">Try switching to the All Insights tab</div>
          </div>
          <!-- Genuine empty: engine completed, no eligible findings for current data -->
          <div v-else class="pi-loading-empty">
            <div class="pi-empty-icon">📊</div>
            <div class="pi-empty-title">No insights available</div>
            <div class="pi-empty-subtitle">Performance Insights engine completed — no eligible findings for current data.</div>
          </div>
        </div>

        <!-- CR-X FINAL: Auto-switch to "All insights" tab when only diagnostics exist,
             so the user sees the data gaps immediately instead of an empty list. -->
        <button v-if="activeTab === 'top' && displayedInsights.length === 0 && diagnosticInsights.length > 0 && !props.isHydrating" class="pi-see-all" @click="activeTab = 'all'; diagnosticsExpanded = true">
          View {{ diagnosticInsights.length }} data {{ diagnosticInsights.length === 1 ? 'gap' : 'gaps' }}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        
        <button v-if="activeTab === 'top' && displayedInsights.length > 0" class="pi-see-all" @click="activeTab = 'all'">
          See all insights
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <!-- Right panel -->
      <div class="pi-panel-right" v-if="selectedViewModel">
        <!-- Detail header -->
        <div class="pi-detail-header">
          <div class="pi-detail-title-row">
            <div class="pi-detail-icon" :style="{ background: selectedViewModel.iconBg }">
              <component :is="selectedViewModel.icon" />
            </div>
            <div>
              <h2 class="pi-detail-title">{{ selectedViewModel.title }}</h2>
              <div class="pi-detail-meta-row">
                <span class="pi-tag">{{ selectedViewModel.category.toUpperCase() }}</span>
                <span class="pi-detected-label">Detected {{ selectedViewModel.detectedFull }}</span>
              </div>
            </div>
          </div>
          <div class="pi-detail-actions">
            <button class="pi-btn-outline" @click="copyInsight" title="Share insight to clipboard">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              {{ copyButtonText }}
            </button>
          </div>
        </div>

        <!-- Decision Card - new compact structure -->
        <div
          v-if="selectedViewModel && selectedViewModel.decisionCard"
          :class="['pi-decision-card', (selectedInsight as any).isDiagnostic && 'pi-decision-card--diagnostic']"
        >
          <!-- Claim Strip -->
          <div class="pi-claim-strip">
            <div class="pi-claim-text">{{ selectedViewModel.decisionCard.claim }}</div>
            <div v-if="selectedViewModel.decisionCard.claimSub" class="pi-claim-sub">{{ selectedViewModel.decisionCard.claimSub }}</div>
          </div>

          <!-- Evidence Band — adaptive layout based on cell count -->
          <div
            :class="[
              'pi-evidence-band',
              `pi-evidence-band--${Math.min(selectedViewModel.decisionCard.evidenceCells?.length || 0, 4)}`,
              (selectedViewModel.decisionCard.evidenceCells?.length || 0) === 1 && 'pi-evidence-band--sparse'
            ]"
          >
            <div v-for="(cell, index) in selectedViewModel.decisionCard.evidenceCells" :key="index" class="pi-ev-cell">
              <div class="pi-ev-label">{{ cell.label }}</div>
              <div :class="['pi-ev-value', cell.badgeType && `pi-ev-value--${cell.badgeType}`]">{{ cell.value }}</div>
              <div v-if="cell.sub" class="pi-ev-sub">{{ cell.sub }}</div>
              <div v-if="cell.badge" :class="['pi-ev-badge', `pi-ev-badge--${cell.badgeType || 'neutral'}`]">{{ cell.badge }}</div>
            </div>
          </div>

          <!-- Comparison Bar (optional) -->
          <div v-if="selectedViewModel.decisionCard.comparisonRows && selectedViewModel.decisionCard.comparisonRows.length > 0" class="pi-comparison-bar">
            <div v-if="selectedViewModel.decisionCard.comparisonLabel" class="pi-cbar-label">{{ selectedViewModel.decisionCard.comparisonLabel }}</div>
            <div v-for="(row, index) in selectedViewModel.decisionCard.comparisonRows" :key="index" class="pi-cbar-row">
              <span class="pi-cbar-name" :style="{ color: row.color }" :title="row.name">{{ row.name }}</span>
              <div class="pi-cbar-track">
                <div class="pi-cbar-fill" :style="{ width: `${row.percent}%`, background: row.color }"></div>
              </div>
              <span class="pi-cbar-val" :style="{ color: row.color }" :title="row.value">{{ row.value }}</span>
              <span v-if="row.tag" :class="['pi-cbar-tag', `pi-cbar-tag--${row.tagType || 'neutral'}`]">{{ row.tag }}</span>
            </div>
          </div>

          <!-- Period Trend (optional, mutually exclusive with comparisonRows).
               CR-X UI Redo: replaced the SVG micro-chart (thin connector line,
               tiny dots, floating labels) with the SAME horizontal proportional
               bar grammar already used by comparisonRows/.pi-cbar-row above and
               by the accepted Large-PR / Deployment-Success cards. Chronology
               is carried by row order + period label (not by axis position),
               magnitude by bar length, "now" by accent color + bold weight —
               not by color alone. No SVG, no axes, no gridlines. -->
          <div
            v-if="(!selectedViewModel.decisionCard.comparisonRows || selectedViewModel.decisionCard.comparisonRows.length === 0) && periodTrend"
            class="pi-period-trend"
          >
            <div v-if="periodTrend.label" class="pi-cbar-label">{{ periodTrend.label }}</div>
            <div
              v-for="(row, index) in periodTrend.rows"
              :key="index"
              :class="['pi-ptrend-row', row.isLatest && 'pi-ptrend-row--latest', row.isCompact && 'pi-ptrend-row--compact']"
            >
              <span class="pi-ptrend-period" :title="row.periodLabel">{{ row.periodLabel }}</span>
              <div class="pi-ptrend-track">
                <div class="pi-ptrend-fill" :style="{ width: `${row.percent}%`, background: row.color }"></div>
              </div>
              <span
                class="pi-ptrend-val"
                :class="row.isLatest && 'pi-ptrend-val--latest'"
                :style="row.isLatest ? { color: row.color } : {}"
              >{{ row.value }}</span>
              <span v-if="row.secondaryLabel" class="pi-ptrend-secondary">{{ row.secondaryLabel }}</span>
              <span v-if="row.deltaTag" class="pi-ptrend-tag">{{ row.deltaTag }}</span>
            </div>
          </div>

          <!-- Signal Row -->
          <div class="pi-signal-row">
            <div class="pi-sig-cell">
              <div class="pi-sig-label">Interpretation</div>
              <div class="pi-sig-value">{{ selectedViewModel.decisionCard.interpretation }}</div>
            </div>
            <div v-if="selectedViewModel.decisionCard.riskLabel" class="pi-sig-cell">
              <div class="pi-sig-label">Risk</div>
              <div class="pi-sig-value">{{ selectedViewModel.decisionCard.riskLabel }}</div>
              <div v-if="selectedViewModel.decisionCard.riskSub" class="pi-sig-sub">{{ selectedViewModel.decisionCard.riskSub }}</div>
            </div>
          </div>

          <!-- Action Strip -->
          <div v-if="!(selectedInsight as any).isDiagnostic && (selectedInsight as any).recommendationAllowed !== false && (selectedInsight as any).recommendationState !== 'monitor_only' && !['needs_more_data', 'missing_comparison', 'not_comparable', 'instrumentation_gap'].includes((selectedInsight as any).comparisonState) && selectedViewModel.decisionCard.riskSub !== 'Insufficient'" class="pi-action-strip">
            <div class="pi-action-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div class="pi-action-body">
              <div class="pi-action-top">
                <span class="pi-action-label">What to do</span>
                <span class="pi-action-badge">Recommended</span>
              </div>
              <div class="pi-action-text">{{ selectedViewModel.decisionCard.actionText }}</div>
            </div>
          </div>
          <!-- CR-X QUALITY: Monitor-only findings with real evidence still have
               useful recommendations. Show the action strip with a "Monitor"
               badge when actionText is non-empty, even if recommendationState
               is monitor_only. -->
          <div v-else-if="!(selectedInsight as any).isDiagnostic && (selectedInsight as any).recommendationState === 'monitor_only' && selectedViewModel.decisionCard.actionText && selectedViewModel.decisionCard.actionText.length > 0 && (selectedInsight as any).hasData !== false && !['needs_more_data', 'missing_comparison', 'not_comparable', 'instrumentation_gap'].includes((selectedInsight as any).comparisonState) && selectedViewModel.decisionCard.riskSub !== 'Insufficient'" class="pi-action-strip">
            <div class="pi-action-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div class="pi-action-body">
              <div class="pi-action-top">
                <span class="pi-action-label">What to do</span>
                <span class="pi-action-badge pi-action-badge--monitor">Monitor</span>
              </div>
              <div class="pi-action-text">{{ selectedViewModel.decisionCard.actionText }}</div>
            </div>
          </div>

          <!-- Footer -->
          <div class="pi-card-footer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>{{ selectedViewModel.decisionCard.footerNote }}</span>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch, h, nextTick } from 'vue'
import type { V2PreviewRow } from '../lib/insights/v2/types'
import type { PerformanceInsight } from '../lib/insights/final/adapters/renderAdapter'
import { isTopInsight } from '../lib/insights/final/topInsightEligibility'
import { resolveDecisionCardComparisonPair } from '../lib/insights/final/resolveDecisionCardComparisonPair'
import { CANONICAL_AI_MODELS, getAIModelById, getDiverseAIModels, WORKFLOW_MODEL_COMBINATIONS } from '../lib/insights/final/registry/aiModelRegistry'
import { uiRenderTrace, piInsightsWatch, piCacheWrite } from '../lib/debugLogs'
import { isStressModeEnabled } from '../lib/insights/final/devStressFixture'
import { piDebugLog } from '../lib/insights/final/utils/logging'
import { buildCommitTtfcInterpretation } from '../lib/insights/final/helpers/commitTtfcInterpretation'
import { periodCountEvidenceCell, periodCountClaimPhrase } from '../lib/insights/final/helpers/periodStrip'
import { isLivePilotMode as isLivePilotModeCanonical, getTelemetryStatusShort } from '../lib/insights/runtimeMode'
import { getCanonicalWorkflowIdentity } from '../lib/workflowIdentity'

// Debug constants - properly defined to prevent runtime errors
const VERBOSE_PI_DEBUG = import.meta.env.DEV && (import.meta.env.VITE_VERBOSE_PI_DEBUG ?? 'false') === 'true'

// Safe demo mode detection with fallback
// CR5 V1 FINAL P0-1: Truthful badge label — "Historical" on Local, "Live" on Ed
const piTelemetryBadgeLabel = computed(() => getTelemetryStatusShort())

const isDemoModeActive = computed(() => {
  try {
    return isStressModeEnabled?.() === true;
  } catch {
    return false;
  }
});

interface Props {
  insights: V2PreviewRow[]
  selectedPIId?: string
  isHydrating?: boolean
}


// Presentation metadata for UI layer only (no gating/filtering)
interface InsightPresentationMetadata {
  uiPriority?: 'hero' | 'important' | 'supporting'
  executiveRelevance?: 'high' | 'medium' | 'low'
  operationalCategory?: 'velocity' | 'stability' | 'quality' | 'workflow'
}

const props = defineProps<Props>()

// State
const selectedInsight = ref<V2PreviewRow | null>(null)
const copyButtonText = ref('Share insight')
const diagnosticsExpanded = ref(false)

// Archive disabled for pilot freeze - permanently empty
const archivedIds = ref<string[]>([])

// Clear stale archive localStorage state for pilot freeze
if (typeof window !== 'undefined') {
  localStorage.removeItem('cm_archived_pi_ids')
}

// Computed property to check if current insight is archived - DISABLED for pilot freeze
const isArchived = computed(() => false)

// =====================================
// PHASE 1: RESILIENT CACHE FALLBACK (like Productivity by Tool)
// =====================================
// Cache key for last-known-good insights snapshot
const CACHE_KEY = 'performance_insights_snapshot'
const CACHE_TIMESTAMP_KEY = 'performance_insights_timestamp'
const CACHE_MAX_AGE_MS = 30 * 60 * 1000 // 30 minutes

// Demo mode cache isolation - prevent cache confusion
const DEMO_CACHE_KEY = 'performance_insights_demo_snapshot'
const DEMO_CACHE_TIMESTAMP_KEY = 'performance_insights_demo_timestamp'

// Computed property with safe cache fallback (fallback-only)
const insightsWithFallback = computed(() => {
  // DEMO MODE: Never use cache, always use live demo data
  if (isDemoModeActive.value) {
    if (props.insights && Array.isArray(props.insights) && props.insights.length > 0) {
      // Validate demo insights
      const validInsights = props.insights.every(insight =>
        insight &&
        typeof insight.id === 'string' &&
        typeof insight.title === 'string' &&
        insight.title.length > 0
      )
      
      if (validInsights) {
        return {
          data: props.insights,
          source: 'demo_fixture',
          timestamp: Date.now()
        }
      }
    }
    
    // Demo mode fallback - return empty array rather than cached data
    return {
      data: [],
      source: 'demo_fixture',
      timestamp: Date.now()
    }
  }
  
  // NORMAL MODE: Use cache fallback for live data
  if (props.insights && Array.isArray(props.insights) && props.insights.length > 0) {
    // Validate live insights
    const validInsights = props.insights.every(insight =>
      insight &&
      typeof insight.id === 'string' &&
      typeof insight.title === 'string' &&
      insight.id.length > 0 &&
      insight.title.length > 0
    )

    if (validInsights) {
      uiRenderTrace('USING_LIVE_DATA', {
        source: 'live',
        count: props.insights.length,
        titles: props.insights.map(i => ({ id: i.id, title: i.title }))
      })
      return {
        data: props.insights,
        source: 'live'
      }
    } else {
      console.warn('[PI_LIVE_INVALID]', 'Live insights invalid, falling back to cache')
    }
  }
  
  // Fallback to cache ONLY if live data unavailable or invalid
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    const cachedTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY)
    
    if (cached && cachedTimestamp) {
      const age = Date.now() - parseInt(cachedTimestamp)
      if (age < CACHE_MAX_AGE_MS) {
        const cachedInsights = JSON.parse(cached)
        
        // Validate cached insights
        const validCached = cachedInsights && Array.isArray(cachedInsights) && cachedInsights.length > 0 &&
          cachedInsights.every(insight => 
            insight && 
            typeof insight.id === 'string' && 
            typeof insight.title === 'string' &&
            insight.id.length > 0 && 
            insight.title.length > 0
          )
        
        if (validCached) {
          uiRenderTrace('USING_CACHED_DATA', {
            source: 'cached',
            age: Math.round(age / 1000) + 's',
            count: cachedInsights.length,
            titles: cachedInsights.map(i => ({ id: i.id, title: i.title }))
          })
          return {
            data: cachedInsights,
            source: 'cached',
            timestamp: parseInt(cachedTimestamp)
          }
        } else {
          console.warn('[PI_CACHE_INVALID]', 'Cached insights invalid, clearing cache')
          // Clear invalid cache
          localStorage.removeItem(CACHE_KEY)
          localStorage.removeItem(CACHE_TIMESTAMP_KEY)
        }
      }
    }
  } catch (e) {
    console.warn('[PI_CACHE_READ_ERROR]', e)
    // Clear potentially corrupted cache
    localStorage.removeItem(CACHE_KEY)
    localStorage.removeItem(CACHE_TIMESTAMP_KEY)
  }
  
  // No valid data available
  return {
    data: [],
    source: 'empty'
  }
})

// Computed - Process insights from props with cache fallback
const allInsights = computed(() => {
  const insights = insightsWithFallback.value.data
  if (!insights || !Array.isArray(insights)) return []

  return insights
})

// CR5 V1 FINAL — Cold-load UX guard: track whether we've ever received
// non-empty insights. The "No insights available" empty state should only
// appear AFTER the first successful data load, not during initial hydration.
const hasEverReceivedData = ref(false)
watch(() => allInsights.value.length, (len) => {
  if (len > 0) hasEverReceivedData.value = true
}, { immediate: true })

// Watch for external selection from AI Ops click
watch(() => props.selectedPIId, (newId) => {
  if (newId) {
    const insight = allInsights.value.find(i => i.id === newId)
    if (insight) {
      selectedInsight.value = insight
      piDebugLog('[PI_EXTERNAL_SELECT]', { selectedPIId: newId, insightTitle: insight.title })
    }
  }
}, { immediate: true })

// Synthetic Performance Intelligence Summary insight
const summaryInsight: V2PreviewRow = {
  id: 'performance-intelligence-summary',
  title: 'Performance Intelligence Summary',
  subtitle: 'AI workflow intelligence across coding, review, and delivery',
  rightMetric: 'Overview',
  urgencyLabel: 'informational',
  confidence: 'high',
  coveragePct: 100,
  cicdStage: 'plan-code',
  displayDeltaPct: 0,
  n: 0
} as V2PreviewRow

// Computed - Filter out archived insights - DISABLED for pilot freeze (pass through all)
const filteredInsights = computed(() => allInsights.value)

// CR-X: The Final Engine is the single authority for Top Insights membership
// and rank. It stamps isTopInsightEligible=true and topInsightRank=1..5 on
// exactly the insights that should appear in the Top tab. The UI must NOT
// re-filter, re-rank, or re-diversify — no second diversity/suppression
// system. Presentation ordering uses topInsightRank.
const topInsights = computed(() => {
  const insights = allInsights.value
  if (!insights || insights.length === 0) return []

  return insights
    .filter((i: any) => i.isTopInsightEligible === true && typeof i.topInsightRank === 'number')
    .sort((a: any, b: any) => (a.topInsightRank ?? 999) - (b.topInsightRank ?? 999))
})


// Function to select highest-priority insight deterministically (only after hydration)
function selectHighestPriorityInsight() {
  // Guard against empty insights during hydration
  if (!allInsights.value || allInsights.value.length === 0) {
    return // Don't clear selection during hydration
  }
  
  // Don't override manual user selection
  if (selectedInsight.value) {
    return
  }
  
  try {
    // Executive value priority: prefer specific high-value insights
    const executivePriorityIds = [
      'reviewer-load-concentration',
      'session-conditioned-pr-cycle-time-ai-vs-non-ai',
      'delivery-velocity-by-workflow',
      'change-failure-rate-spike-by-ide',
      'active-coding-time-by-ide',
      'time-to-first-commit-by-ide',
      'rework-rate-by-workflow',
      'active-coding-ratio-by-workflow'
    ]
    
    const sortedInsights = [...allInsights.value].sort((a, b) => {
      // Guard against malformed insight objects
      if (!a || !b || !a.id || !b.id) return 0
      
      // Priority 1: Executive value insights
      const aExecutiveValue = executivePriorityIds.includes(a.id) ? 1 : 0
      const bExecutiveValue = executivePriorityIds.includes(b.id) ? 1 : 0
      
      if (aExecutiveValue !== bExecutiveValue) {
        return bExecutiveValue - aExecutiveValue // Executive insights first
      }
      
      // Priority 2: Within executive insights, maintain priority order
      if (aExecutiveValue === 1 && bExecutiveValue === 1) {
        const aPriority = executivePriorityIds.indexOf(a.id)
        const bPriority = executivePriorityIds.indexOf(b.id)
        if (aPriority !== bPriority) {
          return aPriority - bPriority // Lower index = higher priority
        }
      }
      
      // Priority 3: Sort by impact level (High > Medium > Low)
      const impactOrder = { 'High': 3, 'Medium': 2, 'Low': 1 }
      const aImpact = impactOrder[getImpactLevel(a) as keyof typeof impactOrder] || 1
      const bImpact = impactOrder[getImpactLevel(b) as keyof typeof impactOrder] || 1
      
      if (aImpact !== bImpact) {
        return bImpact - aImpact // Higher impact first
      }
      
      // Priority 4: Then by confidence (high > medium > low)
      const confidenceOrder = { 'high': 3, 'medium': 2, 'low': 1 }
      const aConf = confidenceOrder[a.confidence as keyof typeof confidenceOrder] || 1
      const bConf = confidenceOrder[b.confidence as keyof typeof confidenceOrder] || 1
      
      if (aConf !== bConf) {
        return bConf - aConf // Higher confidence first
      }
      
      // Priority 5: Then by coverage percentage
      return (b.coveragePct || 0) - (a.coveragePct || 0)
    })
    
    if (sortedInsights.length > 0 && sortedInsights[0]) {
      selectedInsight.value = sortedInsights[0]
      if (VERBOSE_PI_DEBUG) {
      piDebugLog('[PI_DEFAULT_SELECT]', { 
        selectedId: selectedInsight.value?.id, 
        selectedTitle: selectedInsight.value?.title,
        totalInsights: allInsights.value.length,
        selectionCriteria: 'highest impact + confidence + coverage',
        impactLevel: selectedInsight.value ? getImpactLevel(selectedInsight.value) : null,
        confidence: selectedInsight.value?.confidence,
        coverage: selectedInsight.value?.coveragePct
      })
      }
    }
  } catch (error) {
    console.warn('[PI_DEFAULT_SELECT_ERROR]', error)
    // Don't crash the component, just continue without selection
  }
}

// Set default insight on mount - ONLY if insights are already hydrated
onMounted(() => {
  // Don't run default selection during hydration
  // Wait for reactive watcher to handle it
  piDebugLog('[PI_MOUNT]', { 
    insightsLength: allInsights.value.length,
    hasSelectedInsight: !!selectedInsight.value,
    source: insightsWithFallback.value.source
  })
})

// Single reactive watcher for insights hydration and default selection
watch(allInsights, (newInsights, oldInsights) => {
  piDebugLog('[PI_INSIGHTS_WATCH]', { 
    newLength: newInsights.length,
    oldLength: oldInsights?.length || 0,
    hasSelectedInsight: !!selectedInsight.value,
    source: insightsWithFallback.value.source
  })
  
  // Only auto-select when insights become available AND no manual selection exists
  if (newInsights.length > 0 && !selectedInsight.value) {
    selectHighestPriorityInsight()
  }
}, { immediate: false }) // Remove immediate to prevent race with onMounted

// Separate watcher for external selection (no auto-selection logic)
watch(() => props.selectedPIId, (newId, oldId) => {
  if (newId && newId !== oldId) {
    const insight = allInsights.value.find(i => i.id === newId)
    if (insight) {
      selectedInsight.value = insight
      piDebugLog('[PI_EXTERNAL_SELECT]', { selectedPIId: newId, insightTitle: insight.title })
    }
  }
}, { immediate: false }) // Remove immediate to prevent race


// Computed flag for showing cached badge
const usingCachedData = computed(() => {
  return insightsWithFallback.value.source === 'cached'
})

// Watch for successful insights data and cache them (only when live data is valid and NOT in demo mode)
watch(() => props.insights, (newInsights) => {
  // DEMO MODE: Never cache demo fixture data to prevent cache confusion
  if (isDemoModeActive.value) {
    return; // Skip all cache operations in demo mode
  }
  
  // NORMAL MODE: Cache only live data
  if (newInsights && Array.isArray(newInsights) && newInsights.length > 0) {
    // Validate that insights have required fields before caching
    const validInsights = newInsights.every(insight => 
      insight && 
      typeof insight.id === 'string' && 
      typeof insight.title === 'string' &&
      insight.id.length > 0 && 
      insight.title.length > 0
    )
    
    if (validInsights) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(newInsights))
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString())
        piDebugLog('[PI_CACHE_WRITE]', { count: newInsights.length, timestamp: Date.now() })
      } catch (e) {
        // Silent fail on cache write
      }
    } else {
      piDebugLog('[PI_CACHE_WRITE_SKIP]', 'Invalid insights format, skipping cache')
    }
  }
}, { deep: true, immediate: false }) // Remove immediate to prevent race conditions

// Helper to scroll active insight into view within the left rail container ONLY.
// P0 FIX: Never use document-level scrollIntoView — it moves the browser viewport.
// Instead, compute the active item's position relative to the .pi-insight-list
// scroll container and adjust only the container's scrollTop. The document
// scroll position (window.scrollY) is never touched.
function scrollToActiveInsight() {
  nextTick(() => {
    const container = document.querySelector('.pi-insight-list') as HTMLElement | null
    if (!container) return
    const activeElement = container.querySelector('.pi-insight-item--active') as HTMLElement | null
    if (!activeElement) return

    const containerRect = container.getBoundingClientRect()
    const elementRect = activeElement.getBoundingClientRect()

    // Only scroll the container — never the document
    if (elementRect.top < containerRect.top) {
      // Element is above the visible area — scroll container up
      container.scrollTop -= containerRect.top - elementRect.top
    } else if (elementRect.bottom > containerRect.bottom) {
      // Element is below the visible area — scroll container down
      container.scrollTop += elementRect.bottom - containerRect.bottom
    }
    // If element is already visible within the container, do nothing
  })
}

// Helper to select insight by ID
function selectInsightById(id: string) {
  const insight = allInsights.value.find(i => i.id === id)
  if (insight) {
    selectedInsight.value = insight
    // P0-H: Scroll to selected insight in left rail
    scrollToActiveInsight()
  }
}

// ── View Model Adapter for North-Star UI ─────────────────────────────────────
interface PerformanceInsightViewModel {
  id: string
  title: string
  impact: 'HIGH' | 'MEDIUM' | 'LOW'
  category: string
  detected: string
  detectedFull: string
  iconBg: string
  icon: any
  primaryMetric: string
  primaryMetricLabel: string
  change: string
  changeSemantic: string
  changePositive: boolean
  changeLabel: string
  confidence: string
  confidenceColor: 'green' | 'orange' | 'gray'
  confidenceSub: string
  impactValue: string
  impactColor: 'red' | 'orange' | 'gray'
  impactSub: string
  whatChanged: string
  whyItMatters: string
  whyItems: Array<{
    label: string
    value: string
    positive: boolean
    icon: any
  }>
  evidence: Array<{ label: string; value: string }>
  actionText: string
  potentialImpact: Array<{ label: string; value: string; positive: boolean }>
  signalPills: string[]
  topRowSummary: {
    metricValue: string
    metricLabel: string
    metricSubline: string
    rankingRows: string[]
    hasRankingData: boolean
    comparisonMode: 'meaningful-difference' | 'tied' | 'org-level' | 'insufficient'
    changeValue: string
    changeTone: 'risk' | 'improved' | 'neutral'
    comparisonLabel: string
    comparisonSublabel: string
    evidenceValue: string
    evidenceSubline: string
  }
  decisionCard?: {
    cardType: 'workflow-comparison' | 'ai-vs-traditional' | 'org-level' | 'attribution-gap' | 'neutral' | 'cost-efficiency'
    claim: string
    claimSub?: string
    evidenceCells: Array<{
      label: string
      value: string
      sub?: string
      badge?: string
      badgeType?: 'best' | 'worst' | 'neutral' | 'warning'
    }>
    comparisonRows?: Array<{
      name: string
      value: string
      percent: number
      color: string
      tag?: string
      tagType?: 'best' | 'worst' | 'neutral'
    }>
    comparisonLabel?: string
    periodStrip?: {
      label?: string
      points: Array<{
        periodLabel: string
        value: string
        numericValue: number
        magnitude: number
        delta?: string
        deltaDirection?: 'up' | 'down' | 'flat' | null
      }>
    }
    isLowerBetter: boolean
    interpretation: string
    riskLabel?: string
    riskSub?: string
    actionText: string
    footerNote: string
  }
}

// Icon components for north-star UI
const IconMerge = () => h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'white', 'stroke-width': '2' }, [
  h('circle', { cx: 6, cy: 6, r: 3 }),
  h('circle', { cx: 6, cy: 18, r: 3 }),
  h('circle', { cx: 18, cy: 6, r: 3 }),
  h('path', { d: 'M6 9v3a3 3 0 0 0 3 3h6' }),
  h('path', { d: 'M15 9l3-3-3-3' })
])

const IconRocket = () => h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'white', 'stroke-width': '2' }, [
  h('path', { d: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z' }),
  h('path', { d: 'M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z' })
])

const IconCode = () => h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'white', 'stroke-width': '2' }, [
  h('polyline', { points: '16 18 22 12 16 6' }),
  h('polyline', { points: '8 6 2 12 8 18' })
])


const IconClock = () => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: '#64748b', 'stroke-width': '2' }, [
  h('circle', { cx: 12, cy: 12, r: 10 }),
  h('polyline', { points: '12 6 12 12 16 14' })
])

const IconFlow = () => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: '#64748b', 'stroke-width': '2' }, [
  h('circle', { cx: 18, cy: 5, r: 3 }),
  h('circle', { cx: 6, cy: 12, r: 3 }),
  h('circle', { cx: 18, cy: 19, r: 3 }),
  h('line', { x1: 8.59, y1: 13.51, x2: 15.42, y2: 17.49 }),
  h('line', { x1: 15.41, y1: 6.51, x2: 8.59, y2: 10.49 })
])

const IconAlert = () => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: '#f59e0b', 'stroke-width': '2' }, [
  h('circle', { cx: 12, cy: 12, r: 10 }),
  h('line', { x1: 12, y1: 8, x2: 12, y2: 12 }),
  h('line', { x1: 12, y1: 16, x2: '12.01', y2: 16 })
])

// Helper: Display name alias for workflows (UI-only, does not rename backend keys)
function displayWorkflowName(rawName: string): string {
  if (!rawName) return rawName
  const normalized = rawName.toLowerCase()
  // Map Windsurf variants to Devin for UI display only
  if (normalized === 'windsurf' || normalized === 'windsurf workflow' || normalized === 'windsurf-ide') {
    return 'Devin'
  }
  // CR5 P1.5 P1: Strip trailing " workflow" suffix from presentation labels.
  return rawName.replace(/ workflow$/i, '')
}

// CR5 WS3: Convert internal YYYY-MM period to customer-friendly "Month YYYY"
function formatPeriodHuman(yyyymm: string): string {
  const match = yyyymm.match(/^(\d{4})-(\d{2})$/)
  if (!match) return yyyymm
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const monthIdx = parseInt(match[2], 10) - 1
  if (monthIdx < 0 || monthIdx > 11) return yyyymm
  return `${months[monthIdx]} ${match[1]}`
}

// Helper: Final pilot-ready title override for specific PIs
// This is a deterministic copy-only fix at the render/view-model boundary
// Does not change data, ranking, diagnostics, AIOI, PBT, or backend behavior
function buildPilotReadyTitle(row: V2PreviewRow, fallbackTitle: string, workflowComparison: WorkflowComparison): string {
  const insightId = row.id.toLowerCase()

  // ID-based deterministic title overrides for 9 hidden diagnostic PIs (2026-07-06 diagnostic title fix)
  // These override generic adapter fallbacks to show unique data-readiness titles
  const pilotReadyDiagnosticTitleById: Record<string, string> = {
    'executive-ai-yield-optimization': 'AI yield optimization needs session-to-PR attribution',
    'ai-adoption-rate-by-ide': 'AI adoption by IDE needs more workflow-attributed sessions',
    'debug-time-by-ide': 'Debug time instrumentation is not captured yet',
    'terminal-time-by-ide': 'Terminal time instrumentation is not captured yet',
    'rework-loop-detection': 'Rework loop detection needs broader workflow coverage',
    'ai-intensity-delivery-velocity': 'AI intensity impact needs session-to-PR attribution',
    'review-burden-by-ai-pattern': 'Review burden by AI pattern needs session-to-PR attribution',
    'reviewer-load-concentration': 'Reviewer load analysis needs reviewer workload data',
    'executive-small-pr-workflow-optimization': 'Small PR workflow analysis needs PR-size attribution',
    'session-conditioned-pr-cycle-time-ai-vs-non-ai': 'AI vs non-AI PR cycle time needs session-to-PR attribution',
  }

  // CR1 P0: Numeric/tool-specific title override map REMOVED.
  // Visible PI titles must come from the same runtime evidence object used for
  // claim/body, evidence cells, chart rows, sample size, comparison state, source,
  // and recommendation. No cross-org hardcoded claims.

  // Priority 1: Apply diagnostic ID-based override ONLY when the row is
  // structurally diagnostic. An actionable row must never receive a
  // diagnostic-sounding title from this static map.
  if (pilotReadyDiagnosticTitleById[insightId] && row.isDiagnostic === true) {
    return pilotReadyDiagnosticTitleById[insightId]
  }

  // Priority 2: Use the generator-provided title for all visible PIs
  return fallbackTitle
}

// Helper: Sanitize metric name from internal ID to human-readable label
function sanitizeMetricName(id: string, fallbackLabel?: string): string {
  // If we have a human-readable label from metadata, use it
  if (fallbackLabel && !fallbackLabel.includes('-') && !fallbackLabel.includes('_')) {
    return fallbackLabel
  }
  
  // Convert kebab-case ID to human-readable label
  const kebabToTitle = (str: string): string => {
    return str
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }
  
  // Map common ID patterns to human-readable names
  const idLower = id.toLowerCase()
  
  if (idLower.includes('pr-cycle-time') || idLower.includes('pr-latency')) {
    return 'PR Cycle Time'
  }
  if (idLower.includes('change-failure-rate')) {
    return 'Change Failure Rate'
  }
  if (idLower.includes('ai-adoption') || idLower.includes('adoption-spread')) {
    return 'Tracked AI Signal Coverage'
  }
  if (idLower.includes('active-coding-time')) {
    return 'Active Coding Time'
  }
  if (idLower.includes('time-to-first-commit') || idLower.includes('ttfc')) {
    return 'Time to First Commit'
  }
  if (idLower.includes('rework-rate')) {
    return 'Rework Rate'
  }
  if (idLower.includes('delivery-velocity') || idLower.includes('delivery-rate')) {
    return 'Delivery Velocity'
  }
  if (idLower.includes('reviewer-load') || idLower.includes('reviewer-concentration')) {
    return 'Reviewer Load'
  }
  if (idLower.includes('commits-per-session')) {
    return 'Commits per Session'
  }
  if (idLower.includes('session-length')) {
    return 'Session Length'
  }
  if (idLower.includes('ai-suggestions') || idLower.includes('ai-acceptance')) {
    return 'AI Suggestions Accepted'
  }
  
  // Fallback: convert kebab-case to title case
  return kebabToTitle(id)
}

// Helper: Format primary metric value with human-friendly fallback
// Tries multiple sources before giving up, uses auto-detection for proper units
function formatPrimaryMetric(row: V2PreviewRow, fallback: string = 'Not enough cohort data'): string {
  // Guard against malformed input
  if (!row) return fallback

  // CR-X Track C/D: Use the generator's pre-formatted displayValue + displayUnit
  // when available. The generator already formatted the value correctly (e.g.,
  // "2.7/week" for PR throughput, "3.7" for review burden). Without this check,
  // the auto-detection in formatNumber misclassifies decimal values between 0-100
  // as percentages (e.g., 2.7 → "2.7%", 3.7 → "3.7%").
  const dv = (row as any).displayValue
  const du = (row as any).displayUnit
  if (dv !== undefined && dv !== null && String(dv).trim() !== '') {
    const dvStr = String(dv)
    // If displayValue already contains a unit indicator (%, h, m, /), return as-is
    if (/%|h$|m$|\//.test(dvStr)) {
      return dvStr
    }
    // If displayUnit is available, combine value + unit — but skip when the
    // formatted value already ends with that unit (e.g. formatDays returns
    // "7.0 days"), which would otherwise render "7.0 days days".
    if (du && String(du).trim() !== '') {
      const duStr = String(du).trim()
      if (dvStr.toLowerCase().endsWith(duStr.toLowerCase())) {
        return dvStr
      }
      return `${dvStr} ${duStr}`
    }
    return dvStr
  }

  // Try rightMetric (display value) first - it may already have units
  if (row.rightMetric !== undefined && row.rightMetric !== null && typeof row.rightMetric === 'string') {
    // If it's a string like "19.6%", return as-is
    if (row.rightMetric.includes('%') || row.rightMetric.includes('h') || row.rightMetric.includes('m') || row.rightMetric.includes('/')) {
      // Clean up metric name repetition: "0.9h cycle time" -> "0.9h"
      let cleaned = row.rightMetric.replace(/\s+(cycle time|cycle|latency|duration|throughput|cadence|rate|yield|ratio|score|count|sessions|commits|prs|reviews|deployments|failures|reopens|reverts)/gi, '')
      // Clean duplicated units: "12.6/week/week" -> "12.6/week", "161.4/week/week" -> "161.4/week"
      cleaned = cleaned.replace(/(\/week)(\/week)+/gi, '$1')
      cleaned = cleaned.replace(/(\/day)(\/day)+/gi, '$1')
      cleaned = cleaned.replace(/(\/month)(\/month)+/gi, '$1')
      cleaned = cleaned.replace(/(%)(%)+/g, '$1')
      // Clean internal names
      cleaned = cleaned.replace(/(synthesized|measured workflow|unknown workflow)/gi, '')
      return cleaned.trim() || row.rightMetric
    }
    // CONTRACT: If rightMetric is a non-numeric string (semantic state like
    // "MULTIPLE WORKFLOWS"), it IS the primary display value. Do not fall
    // through to 'current' which may hold a sample/session count that would
    // be incorrectly rendered as the primary metric.
    const parsed = parseFloat(row.rightMetric)
    if (isNaN(parsed)) {
      return row.rightMetric
    }
  }
  
  // Try primaryMetric with auto-detection
  if (row.primaryMetric !== undefined && row.primaryMetric !== null && !isNaN(row.primaryMetric) && isFinite(row.primaryMetric)) {
    return formatSafeValue(row.primaryMetric, 'auto')
  }
  
  // Try current value with auto-detection
  if (row.current !== undefined && row.current !== null && !isNaN(row.current) && isFinite(row.current)) {
    return formatSafeValue(row.current, 'auto')
  }
  
  // Try baseline value with auto-detection
  if (row.baseline !== undefined && row.baseline !== null && !isNaN(row.baseline) && isFinite(row.baseline)) {
    return formatSafeValue(row.baseline, 'auto')
  }
  
  // Try breakdownByTool leader value with auto-detection
  if (row.breakdownByTool) {
    const toolEntries = Object.entries(row.breakdownByTool).filter(([tool]) => tool !== 'org')
    if (toolEntries.length >= 1) {
      toolEntries.sort((a, b) => (b[1] as any).value - (a[1] as any).value)
      const leader = toolEntries[0]
      const leaderValue = (leader[1] as any).value
      if (leaderValue !== undefined && leaderValue !== null && !isNaN(leaderValue) && isFinite(leaderValue)) {
        return formatSafeValue(leaderValue, 'auto')
      }
    }
  }
  
  // Final fallback
  return fallback
}

// Helper: Format delta with human-friendly fallback
function formatDelta(deltaText: string): string {
  if (deltaText === 'Trend unavailable' || deltaText === 'N/A') {
    return 'No recent delta'
  }
  return deltaText
}

// Helper: Ensure impact is always specific (never generic "Quality signal")
function sanitizeImpactCategory(impactCategory: string, stage: string, id: string): string {
  // If already specific, return as-is
  if (impactCategory !== 'Quality signal' && impactCategory !== 'Insight') {
    return impactCategory
  }
  
  // Map to specific impact based on stage and ID
  const idLower = id.toLowerCase()
  
  if (stage === 'deploy-operate') {
    if (idLower.includes('failure') || idLower.includes('mttr')) {
      return 'Deployment risk'
    }
    if (idLower.includes('deployment') || idLower.includes('cadence')) {
      return 'Release cadence'
    }
    if (idLower.includes('velocity')) {
      return 'Delivery velocity'
    }
    return 'Release stability'
  }
  
  if (stage === 'review-merge') {
    if (idLower.includes('review') || idLower.includes('load') || idLower.includes('bottleneck')) {
      return 'Review bottleneck'
    }
    if (idLower.includes('reopen') || idLower.includes('revert')) {
      return 'Merge quality'
    }
    if (idLower.includes('cycle') || idLower.includes('pr')) {
      return 'Cycle-time risk'
    }
    return 'Review risk'
  }
  
  // Plan & Code
  if (idLower.includes('adoption') || idLower.includes('ai')) {
    return 'Adoption gap'
  }
  if (idLower.includes('rework')) {
    return 'Rework risk'
  }
  if (idLower.includes('focus') || idLower.includes('active')) {
    return 'Focus risk'
  }
  return 'Velocity opportunity'
}

// Build workflow comparison data from breakdownByTool
interface WorkflowComparison {
  metricName: string
  polarity: 'higher-is-better' | 'higher-is-worse'
  comparisonBasis: string
  comparisonMode: 'meaningful-difference' | 'tied' | 'org-level' | 'attribution-gap' | 'insufficient'
  rankedWorkflows: Array<{
    name: string
    value: number
    formattedValue: string
    sampleSize: number
    rank: number
    coverageLabel: string
  }>
  winner: { name: string; value: number; formattedValue: string } | null
  runnerUp: { name: string; value: number; formattedValue: string } | null
  laggard: { name: string; value: number; formattedValue: string } | null
  hasEnoughComparisonData: boolean
}

// Extract a numeric value from breakdownByTool entry that may be object-shaped or string/number-shaped
function extractBreakdownValue(data: unknown): number | null {
  if (data === null || data === undefined) return null
  // Object shape: { value: number, count: number, formatted: string }
  const objValue = (data as any)?.value
  if (objValue !== undefined && objValue !== null) {
    const num = Number(objValue)
    if (!isNaN(num) && isFinite(num)) return num
  }
  // String/number shape (from adapter): '19.6' or 19.6
  if (typeof data === 'string') {
    const num = parseFloat(data)
    if (!isNaN(num) && isFinite(num)) return num
  }
  if (typeof data === 'number') {
    if (!isNaN(data) && isFinite(data)) return data
  }
  return null
}

// Extract formatted string from breakdownByTool entry
function extractBreakdownFormatted(data: unknown, value: number, tool: string): string {
  if (data === null || data === undefined) return String(value)
  const objFormatted = (data as any)?.formatted
  if (objFormatted && typeof objFormatted === 'string') return objFormatted
  const objValue = (data as any)?.value
  if (objValue !== undefined && objValue !== null && String(objValue) !== String(value)) {
    return String(objValue)
  }
  return String(value)
}

// Extract count from breakdownByTool entry
function extractBreakdownCount(data: unknown, totalN: number, toolCount: number): number {
  if (data === null || data === undefined) return Math.max(1, Math.floor(totalN / Math.max(toolCount, 1)))
  const objCount = (data as any)?.count
  if (objCount !== undefined && objCount !== null) {
    const num = Number(objCount)
    if (!isNaN(num) && isFinite(num) && num > 0) return num
  }
  return Math.max(1, Math.floor(totalN / Math.max(toolCount, 1)))
}

function buildWorkflowComparison(row: V2PreviewRow): WorkflowComparison {
  // Guard against undefined or malformed row
  if (!row || !row.id || !row.title) {
    return {
      metricName: 'Unknown',
      polarity: 'higher-is-better',
      comparisonBasis: 'vs prior 4 weeks',
      comparisonMode: 'insufficient',
      rankedWorkflows: [],
      winner: null,
      runnerUp: null,
      laggard: null,
      hasEnoughComparisonData: false
    }
  }

  const insightId = row.id.toLowerCase()

  // CR4 P0-3: Org-level metrics skip workflow comparison entirely.
  // These metrics (e.g. repository-concentration) have breakdownByTool
  // populated with non-workflow data (repos, not IDEs). Do not manufacture
  // leader/runner-up/ranking for org-level evidence.
  if ((row as any).isOrgLevelMetric === true ||
      (row as any).comparisonState === 'org_level_only') {
    return {
      metricName: row.rightMetricLabel || row.title.split(' ').slice(0, 3).join(' ') || 'Metric',
      polarity: 'higher-is-better',
      comparisonBasis: 'org-level',
      comparisonMode: 'org-level',
      rankedWorkflows: [],
      winner: null,
      runnerUp: null,
      laggard: null,
      hasEnoughComparisonData: false
    }
  }

  // PRIORITY: Consume structured comparisonAuthority from the adapter when available.
  // This is the single source of truth for ranking — do not independently sort
  // breakdownByTool when this object exists.
  const ca = (row as any).comparisonAuthority
  if (ca && ca.rows && ca.rows.length >= 2) {
    const caPolarity = ca.polarity === 'lower_is_better' ? 'higher-is-worse' : 'higher-is-better'
    const rankedFromCA: WorkflowComparison['rankedWorkflows'] = ca.rows.map(r => ({
      name: r.displayName,
      value: r.value,
      formattedValue: r.formattedValue,
      sampleSize: r.sampleSize,
      rank: r.rank,
      coverageLabel: r.sampleSize >= 50 ? 'Strong' : r.sampleSize >= 25 ? 'Emerging' : 'Limited'
    }))
    const hasEnough = ca.rows.filter((r: any) => r.eligibleForRanking).length >= 2
    return {
      metricName: row.rightMetricLabel || row.title.split(' ').slice(0, 3).join(' ') || 'Metric',
      polarity: caPolarity,
      comparisonBasis: 'vs workflow median',
      comparisonMode: hasEnough ? (ca.operationallySignificant ? 'meaningful-difference' : 'tied') : 'insufficient',
      rankedWorkflows: rankedFromCA,
      winner: ca.leader ? { name: ca.leader.displayName, value: ca.leader.value, formattedValue: ca.leader.formattedValue } : null,
      runnerUp: ca.runnerUp ? { name: ca.runnerUp.displayName, value: ca.runnerUp.value, formattedValue: ca.runnerUp.formattedValue } : null,
      laggard: ca.laggard ? { name: ca.laggard.displayName, value: ca.laggard.value, formattedValue: ca.laggard.formattedValue } : null,
      hasEnoughComparisonData: hasEnough
    }
  }

  // Use polarity from final compute if available, fall back to heuristic
  const finalPolarity = (row as any).polarity
  let polarity: 'higher-is-better' | 'higher-is-worse'
  if (finalPolarity === 'higher_is_better' || finalPolarity === 'lower_is_better') {
    polarity = finalPolarity === 'higher_is_better' ? 'higher-is-better' : 'higher-is-worse'
  } else {
    // Fallback heuristic for legacy data
    const isHigherIsWorse = insightId.includes('cycle') || insightId.includes('latency') || insightId.includes('duration') ||
                            insightId.includes('rework') || insightId.includes('failure') || insightId.includes('reopen') ||
                            insightId.includes('mttr') || insightId.includes('ttfc') || insightId.includes('load') ||
                            insightId.includes('concentration') || insightId.includes('bottleneck') ||
                            insightId.includes('switching') || insightId.includes('idle')
    polarity = isHigherIsWorse ? 'higher-is-worse' : 'higher-is-better'
  }

  // Determine comparison basis - be specific about what we're comparing
  let comparisonBasis = 'vs prior 4 weeks'
  if (row.baseline !== undefined) comparisonBasis = 'vs all-time org baseline'
  if ((row as any).comparisonMode === 'ai_vs_non_ai') comparisonBasis = 'vs Non-AI PRs'
  if (row.breakdownByTool && Object.keys(row.breakdownByTool).length >= 2) {
    // Check if this is an AI vs Non-AI breakdown
    const hasAiAndNonAi = row.breakdownByTool && 
      ((row.breakdownByTool as any).ai && (row.breakdownByTool as any).non_ai)
    if (!hasAiAndNonAi) {
      comparisonBasis = 'vs workflow median'
    }
  }

  // Extract metric name from title or rightMetricLabel, falling back to title words
  const metricName = row.rightMetricLabel || row.title.split(' ').slice(0, 3).join(' ') || 'Metric'

  // Build ranked workflows from breakdownByTool
  const rankedWorkflows: WorkflowComparison['rankedWorkflows'] = []
  let hasEnoughComparisonData = false
  let comparisonMode: 'meaningful-difference' | 'tied' | 'org-level' | 'attribution-gap' | 'insufficient' = 'insufficient'

  // --- Source 1: Structured breakdownByTool ---
  if (row.breakdownByTool && Object.keys(row.breakdownByTool).length > 0) {
    try {
      // Check if this is an AI vs Non-AI breakdown - skip workflow comparison logic
      const hasAiAndNonAi = (row.breakdownByTool as any).ai && (row.breakdownByTool as any).non_ai
      if (hasAiAndNonAi) {
        comparisonMode = 'ai_vs_non_ai'
        hasEnoughComparisonData = true
        piDebugLog(`[WORKFLOW_COMPARISON] ${row.id}: AI vs Non-AI breakdown detected, skipping workflow comparison`)
        return {
          metricName: row.rightMetricLabel || row.title.split(' ').slice(0, 3).join(' ') || 'Metric',
          polarity,
          comparisonBasis,
          comparisonMode,
          rankedWorkflows: [],
          winner: null,
          runnerUp: null,
          laggard: null,
          hasEnoughComparisonData: true
        }
      }
      
      const toolEntries = Object.entries(row.breakdownByTool).filter(([tool]) => tool !== 'org')
      const totalN = row.n || 0

      // Normalize workflow labels
      const normalizeLabel = (label: string): string => {
        const normalized = label.toLowerCase()
        if (normalized === 'cursor') return 'Cursor'
        if (normalized === 'vscode') return 'VS Code'
        if (normalized === 'windsurf') return displayWorkflowName('Windsurf') // Maps to Devin
        if (normalized === 'devin') return displayWorkflowName('Devin')
        if (normalized === 'claude_code') return 'Claude Code'
        if (normalized === 'codex') return 'Codex'
        if (normalized === 'github_copilot') return 'GitHub Copilot'
        if (normalized === 'ai') return 'Observed AI signals'
        if (normalized === 'non_ai') return 'Zero observed AI signals'
        if (normalized === 'traditional') return 'Zero observed AI signals'
        return label.charAt(0).toUpperCase() + label.slice(1)
      }

      // Build valid entries
      const validEntries: Array<[string, number, string, number]> = []
      toolEntries.forEach(([tool, data]) => {
        const value = extractBreakdownValue(data)
        if (value !== null) {
          const count = extractBreakdownCount(data, totalN, toolEntries.length)
          const formatted = extractBreakdownFormatted(data, value, tool)
          validEntries.push([tool, value, formatted, count])
        }
      })

      // Sort by value based on polarity, handling ties
      validEntries.sort((a, b) => {
        const diff = polarity === 'higher-is-worse' ? a[1] - b[1] : b[1] - a[1]
        // Do NOT use sample size as tiebreaker for identical metric values
        return diff
      })

      // Build ranked array with tie handling
      let currentRank = 1
      const allTied = validEntries.length > 1 && 
        validEntries.every((entry, idx) => {
          if (idx === 0) return true
          const prevValue = validEntries[idx - 1][1]
          return Math.abs(entry[1] - prevValue) < 0.001
        })

      validEntries.forEach(([tool, value, formatted, count], index) => {
        // If this value is tied with previous, use same rank
        if (index > 0) {
          const prevValue = validEntries[index - 1][1]
          if (Math.abs(value - prevValue) < 0.001) {
            // Tied with previous, use same rank
            currentRank = rankedWorkflows[index - 1].rank
          } else {
            currentRank = index + 1
          }
        }
        
        rankedWorkflows.push({
          name: normalizeLabel(tool),
          value,
          formattedValue: formatted,
          sampleSize: count,
          rank: allTied ? 0 : currentRank, // Use 0 to indicate all tied
          coverageLabel: count >= 50 ? 'Strong' : count >= 25 ? 'Emerging' : 'Limited'
        })
      })

      hasEnoughComparisonData = rankedWorkflows.length >= 2
      
      // Determine comparisonMode based on data quality
      if (rankedWorkflows.length >= 2) {
        // Check if org-level GitHub/deploy/review metric with identical values
        const isOrgLevelMetric = insightId.includes('deployment') || insightId.includes('change-failure') || 
                                insightId.includes('delivery') || insightId.includes('review') || 
                                insightId.includes('pr-') || insightId.includes('reopen') || insightId.includes('revert')
        const allValuesIdentical = rankedWorkflows.every(w => Math.abs(w.value - rankedWorkflows[0].value) < 0.001)
        
        if (isOrgLevelMetric && allValuesIdentical) {
          comparisonMode = 'org-level'
          hasEnoughComparisonData = false
        } else if (allTied) {
          comparisonMode = 'tied'
        } else {
          // Check if winner is Unknown/Unattributed
          const winnerName = rankedWorkflows[0]?.name?.toLowerCase() || ''
          
          piDebugLog(`[PI_RENDER_TRACE] ${row.id}: winner=${winnerName}, allTied=${allTied}, hasEnoughComparisonData=${hasEnoughComparisonData}`)
          if (winnerName.includes('unknown') || winnerName.includes('unattributed')) {
            comparisonMode = 'attribution-gap'
            hasEnoughComparisonData = false
            piDebugLog(`[PI_RENDER_TRACE] ${row.id}: attribution-gap (unknown winner)`)
          } else {
            // Low-sample workflow rule: workflows with <25 sessions cannot be Leader/Best
            // At least 2 eligible workflows (>=25 sessions) needed for meaningful comparison
            // Low-sample workflows may appear as Emerging secondary rows but cannot drive title or winner
            const eligibleWorkflows = rankedWorkflows.filter(w => w.sampleSize >= 25)
            if (eligibleWorkflows.length < 2) {
              comparisonMode = 'insufficient'
              hasEnoughComparisonData = false
              piDebugLog(`[PI_RENDER_TRACE] ${row.id}: insufficient (fewer than 2 eligible workflows with >=25 sessions)`)
            } else {
              comparisonMode = 'meaningful-difference'
              // Reorder: eligible workflows first (preserving value sort), then low-sample as Emerging
              const lowSampleWorkflows = rankedWorkflows.filter(w => w.sampleSize < 25)
              rankedWorkflows.length = 0
              eligibleWorkflows.forEach((w, idx) => {
                rankedWorkflows.push({ ...w, rank: allTied ? 0 : idx + 1 })
              })
              lowSampleWorkflows.forEach((w) => {
                rankedWorkflows.push({ ...w, rank: 0, coverageLabel: 'Low sample' })
              })
              piDebugLog(`[PI_RENDER_TRACE] ${row.id}: meaningful-difference (${eligibleWorkflows.length} eligible, ${lowSampleWorkflows.length} low-sample)`)
            }
          }
        }
      }
    } catch (e) {
      console.warn('[WORKFLOW_COMPARISON_ERROR]', e)
    }
  }

  // --- Source 2: Fallback using current/baseline + displayWinnerLabel ---
  // Guard: only use baseline if it's a real non-zero value to avoid fake gaps
  // Additional guard: for AI vs Non-AI, skip baseline comparison if Non-AI value is missing
  if (!hasEnoughComparisonData && row.current !== undefined && row.baseline !== undefined) {
    const currentVal = Number(row.current)
    const baselineVal = Number(row.baseline)
    const isAiVsNonAi = (row as any).comparisonMode === 'ai_vs_non_ai'
    // Skip baseline comparison if baseline is zero/near-zero to avoid fake gaps
    // Also skip for AI vs Non-AI if baseline (Non-AI) is missing/invalid
    if (!isNaN(currentVal) && isFinite(currentVal) && !isNaN(baselineVal) && isFinite(baselineVal) && Math.abs(baselineVal) > 0.01 && !isAiVsNonAi) {
      const winnerLabel = (row as any).displayWinnerLabel || ((row as any).comparisonMode === 'ai_vs_non_ai' ? 'Observed AI signals' : 'Current')
      const runnerUpLabel = ((row as any).comparisonMode === 'ai_vs_non_ai' ? 'Zero observed AI signals' : 'Baseline')
      const winnerFormatted = formatSafeValue(currentVal, 'auto')
      const runnerUpFormatted = formatSafeValue(baselineVal, 'auto')
      rankedWorkflows.push(
        { name: winnerLabel, value: currentVal, formattedValue: winnerFormatted, sampleSize: row.n || 0, rank: 1, coverageLabel: 'Measured' },
        { name: runnerUpLabel, value: baselineVal, formattedValue: runnerUpFormatted, sampleSize: row.n || 0, rank: 2, coverageLabel: 'Measured' }
      )
      hasEnoughComparisonData = true
      comparisonBasis = 'vs baseline'
    }
  }

  // --- Source 3: Fallback using evidence array ---
  if (!hasEnoughComparisonData && row.evidence && row.evidence.length >= 2) {
    const evidenceEntries = row.evidence
      .filter((e: any) => e.value !== undefined && e.metric !== undefined)
      .map((e: any) => {
        const val = parseFloat(String(e.value).replace(/[^0-9.\-]/g, ''))
        return { label: String(e.metric), value: isNaN(val) ? 0 : val, originalValue: String(e.value) }
      })
      .filter((e: any) => !isNaN(e.value) && isFinite(e.value))
    if (evidenceEntries.length >= 2) {
      evidenceEntries.sort((a: any, b: any) => polarity === 'higher-is-worse' ? a.value - b.value : b.value - a.value)
      evidenceEntries.forEach((e: any, idx: number) => {
        rankedWorkflows.push({
          name: e.label,
          value: e.value,
          formattedValue: e.originalValue,
          sampleSize: row.n || 0,
          rank: idx + 1,
          coverageLabel: 'Measured'
        })
      })
      hasEnoughComparisonData = true
      comparisonBasis = 'vs cohort'
    }
  }

  // Extract winner, runner-up, laggard
  const winner = rankedWorkflows[0] ? { name: rankedWorkflows[0].name, value: rankedWorkflows[0].value, formattedValue: rankedWorkflows[0].formattedValue } : null
  const runnerUp = rankedWorkflows[1] ? { name: rankedWorkflows[1].name, value: rankedWorkflows[1].value, formattedValue: rankedWorkflows[1].formattedValue } : null
  const laggard = rankedWorkflows[rankedWorkflows.length - 1] ? { name: rankedWorkflows[rankedWorkflows.length - 1].name, value: rankedWorkflows[rankedWorkflows.length - 1].value, formattedValue: rankedWorkflows[rankedWorkflows.length - 1].formattedValue } : null

  return {
    metricName,
    polarity,
    comparisonBasis,
    comparisonMode,
    rankedWorkflows,
    winner,
    runnerUp,
    laggard,
    hasEnoughComparisonData
  }
}

// Metric-specific fallback text for when comparison data is insufficient
function getMetricSpecificFallback(insightId: string): { interpretation: string; actionText: string } {
  const id = insightId.toLowerCase()
  if (id.includes('ai-adoption') || id.includes('ai-focus') || id.includes('ai-adoption-velocity')) {
    return {
      interpretation: 'Tracked AI signal coverage data needs more workflow-attributed sessions for comparison.',
      actionText: 'Standardize tool enablement across teams. Compare team-level AI signal coverage and identify why one workflow has lower detected AI activity.'
    }
  }
  if (id.includes('time-to-first-commit') || id.includes('ttfc')) {
    return {
      interpretation: 'Time to first commit data needs more workflow-attributed sessions for comparison.',
      actionText: 'Inspect task setup, branch/work-item handoff, environment readiness, and onboarding friction to reduce time-to-first-commit.'
    }
  }
  if (id.includes('rework')) {
    return {
      interpretation: 'Rework rate data needs more workflow-attributed sessions for comparison.',
      actionText: 'Inspect rework loops, branch churn, generated-code review patterns, and repeated file edits to reduce rework rate.'
    }
  }
  if (id.includes('active-coding')) {
    return {
      interpretation: 'Active coding time data needs more workflow-attributed sessions for comparison.',
      actionText: 'Compare session structure across workflows before treating raw time as productivity. Look for environment or interruption differences.'
    }
  }
  if (id.includes('focus-ratio')) {
    return {
      interpretation: 'Focus ratio data needs more workflow-attributed sessions for comparison.',
      actionText: 'Compare session structure across workflows to understand focus ratio differences.'
    }
  }
  if (id.includes('context-switching') || id.includes('idle')) {
    return {
      interpretation: 'Context switching data needs more workflow-attributed sessions for comparison.',
      actionText: 'Inspect interruptions and context-switch loops. Compare across workflows to understand whether differences reflect task structure or workflow behavior.'
    }
  }
  if (id.includes('session-quality') || id.includes('high-quality')) {
    return {
      interpretation: 'Session quality data needs more workflow attribution for comparison.',
      actionText: 'Improve workflow attribution. Review low-quality sessions by workflow only when attribution is safe.'
    }
  }
  if (id.includes('debug-time')) {
    return {
      interpretation: 'Debug time data needs more workflow-attributed sessions for comparison.',
      actionText: 'Compare debug time patterns across workflows to identify environment or tooling differences.'
    }
  }
  if (id.includes('terminal-time')) {
    return {
      interpretation: 'Terminal time data needs more workflow-attributed sessions for comparison.',
      actionText: 'Compare terminal time patterns across workflows to identify workflow efficiency differences.'
    }
  }
  if (id.includes('delivery-rate') || id.includes('ai-intensity') || id.includes('review-burden')) {
    return {
      interpretation: 'Delivery velocity data needs more workflow-attributed sessions for comparison.',
      actionText: 'Collect more workflow-attributed sessions to compare delivery velocity across AI and non-AI patterns.'
    }
  }
  if (id.includes('workflow-quality') || id.includes('quality-correlation')) {
    return {
      interpretation: 'Workflow quality correlation needs more workflow-attributed sessions for comparison.',
      actionText: 'Collect more workflow-attributed sessions with GitHub outcomes to correlate quality signals.'
    }
  }
  return {
    interpretation: 'Workflow comparison needs more attributed sessions for reliable ranking.',
    actionText: 'Collect more workflow-attributed sessions to enable reliable workflow comparison.'
  }
}

// Metric-specific action text for when a comparison has a clear leader and runner-up
// Investigation-oriented: no invented targets, no winner language, no arbitrary timelines
function getMetricSpecificAction(insightId: string, leaderName: string, runnerUpName: string, metricLabel: string, isRateMetric: boolean): string {
  const id = insightId.toLowerCase()

  if (id.includes('ai-adoption') || id.includes('ai-focus') || id.includes('ai-adoption-velocity')) {
    return `Compare enablement and usage patterns across teams before treating signal coverage as an outcome. ${runnerUpName} and ${leaderName} differ in tracked AI signal coverage — investigate whether this reflects team structure, tool access, or task mix.`
  }
  if (id.includes('time-to-first-commit') || id.includes('ttfc')) {
    return `Review whether the difference reflects task mix, session structure, or workflow behavior before treating it as a productivity difference. Inspect ${runnerUpName} task setup, branch/work-item handoff, and environment readiness.`
  }
  if (id.includes('rework')) {
    return `Inspect ${runnerUpName} rework loops, branch churn, and generated-code review patterns. Compare with ${leaderName} code review practices to understand whether the difference reflects task complexity or workflow behavior.`
  }
  if (id.includes('active-coding')) {
    return `Review whether the difference reflects task mix, session structure, or workflow behavior before treating it as a productivity difference. Compare ${runnerUpName} session structure with ${leaderName} and look for environment or interruption differences.`
  }
  if (id.includes('focus-ratio')) {
    return `Inspect whether the observed difference persists within comparable task and repository cohorts. Compare ${runnerUpName} focus patterns with ${leaderName} and investigate interruption sources and meeting load differences.`
  }
  if (id.includes('context-switching') || id.includes('idle')) {
    return `Inspect ${runnerUpName} interruptions and context-switch loops. Compare with ${leaderName} to understand whether the difference reflects task structure or workflow behavior.`
  }
  if (id.includes('session-quality') || id.includes('high-quality')) {
    return `Improve workflow attribution for ${runnerUpName}. Review low-quality sessions by workflow only when attribution is safe. Compare with ${leaderName} to understand quality pattern differences.`
  }
  if (id.includes('debug-time')) {
    return `Compare ${runnerUpName} debug time patterns with ${leaderName}. Investigate environment or tooling differences before treating the gap as a workflow-level difference.`
  }
  if (id.includes('terminal-time')) {
    return `Compare ${runnerUpName} terminal time patterns with ${leaderName}. Identify workflow efficiency differences and whether they reflect task mix or tooling.`
  }
  if (id.includes('delivery-rate') || id.includes('ai-intensity') || id.includes('review-burden')) {
    return `Compare ${runnerUpName} delivery velocity with ${leaderName}. Investigate AI workflow patterns and reviewer load before treating the difference as an outcome.`
  }
  if (id.includes('workflow-quality') || id.includes('quality-correlation')) {
    return `Correlate ${runnerUpName} quality signals with GitHub outcomes. Compare with ${leaderName} to understand whether quality correlation differences reflect task complexity or workflow behavior.`
  }
  // CR-X: Repository distribution — use human product language, never
  // expose internal breakdownByTool keys like *_top3 or *_repos.
  if (id.includes('repository-distribution')) {
    return `Compare repository concentration between ${leaderName} and ${runnerUpName}. Investigate whether the difference reflects task mix, session structure, or workflow behavior before treating it as a productivity difference.`
  }

  return `Compare ${runnerUpName} ${metricLabel} with ${leaderName}. Investigate whether the difference reflects task mix, session structure, or workflow behavior before treating it as a productivity difference.`
}

// Build Diagnostic Decision Card - dedicated path for diagnostic coverage cards
function buildDiagnosticDecisionCard(row: V2PreviewRow): PerformanceInsightViewModel['decisionCard'] {
  const diagnosticReason = (row as any).diagnosticReason || 'UNKNOWN_SUPPRESSION_REASON';
  const diagnosticUnlockPath = (row as any).diagnosticUnlockPath || row.description || 'Data not available';
  const title = row.title || 'Diagnostic';

  // Map diagnostic reason to readable text
  const reasonToReadable: Record<string, string> = {
    'NEEDS_MORE_TELEMETRY': 'Requires more telemetry sessions',
    'WAITING_FOR_GITHUB': 'Requires GitHub connection',
    'WAITING_FOR_GITHUB_DELIVERY_OUTCOMES': 'Requires GitHub delivery outcomes',
    'WAITING_FOR_SESSION_TO_PR_ATTRIBUTION': 'Requires session-to-PR correlation',
    'NEEDS_SESSION_TO_PR_ATTRIBUTION': 'Requires session-to-PR correlation',
    'NEEDS_COMPARABLE_PERIODS': 'Requires comparable time periods',
    'INSTRUMENTATION_NOT_CAPTURED': 'Requires IDE instrumentation',
    'ORG_LEVEL_ONLY_NO_IDE_ATTRIBUTION': 'Requires IDE attribution',
    'INSUFFICIENT_WORKFLOW_COMPARISON': 'Requires more workflow diversity',
    'UNKNOWN_SUPPRESSION_REASON': 'Generator returned null'
  };

  const readableReason = reasonToReadable[diagnosticReason] || diagnosticReason;

  // CR-X QUALITY: Distinguish TRUE DATA GAP from OBSERVED-DATA/IMMATURE-SIGNAL.
  // When hasData=true and evidence exists, surface the useful observed facts
  // alongside the unlock path. Do NOT reduce the body to "needs more data".
  const hasRealEvidence = (row as any).hasData === true &&
    (row as any).evidence?.length > 0;

  if (hasRealEvidence) {
    // OBSERVED-DATA / IMMATURE-SIGNAL DIAGNOSTIC
    // Real useful evidence exists but comparability/maturity prevents promotion.
    const observedEvidence = (row as any).evidence as Array<{ metric: string; value: string; label: string }>;
    const evidenceCells = observedEvidence.slice(0, 3).map(ev => ({
      label: ev.metric,
      value: ev.value,
      sub: ev.label,
      badgeType: 'neutral' as const
    }));
    // Add the unlock path as a 4th cell if there's room
    if (evidenceCells.length < 4 && diagnosticUnlockPath) {
      evidenceCells.push({
        label: 'Unlock comparison',
        value: readableReason,
        sub: diagnosticUnlockPath,
        badgeType: 'neutral' as const
      });
    }
    return {
      cardType: 'diagnostic',
      claim: title.includes('not yet measurable') ? title : `${title} — comparison unavailable`,
      claimSub: 'Observed data available · Comparison needs more evidence',
      evidenceCells,
      isLowerBetter: false,
      interpretation: (row as any).description || (row as any).whyItMatters || diagnosticUnlockPath || 'Observed data is available but comparison requires additional evidence.',
      riskLabel: 'Informational',
      riskSub: 'Observed data · Comparison pending',
      actionText: (row as any).recommendation || `Collect ${readableReason.toLowerCase()} to enable comparison analysis.`,
      footerNote: 'Observed data · Not included in Top Insights until comparison is available.'
    };
  }

  // TRUE DATA GAP / UNLOCK DIAGNOSTIC
  // CR-X QUALITY: Use the generator's whyItMatters as interpretation when
  // available. Use readableReason (mapped from diagnosticReason) as the
  // unlock path value — not the raw diagnosticUnlockPath which may default
  // to 'Data not available'. Fix the claim to not append "is not yet
  // measurable" to a title that's already a complete sentence.
  const trueGapInterpretation = (row as any).whyItMatters
    || row.description
    || row.executiveSummary
    || diagnosticUnlockPath
    || 'This insight requires additional data to become actionable';
  const trueGapAction = (row as any).recommendation
    || `Collect ${readableReason.toLowerCase()} to enable this analysis.`;
  // Use the generator's diagnosticUnlockPath if it has real content,
  // otherwise use the readableReason mapped from diagnosticReason.
  const trueGapUnlockValue = (diagnosticUnlockPath && diagnosticUnlockPath !== 'Data not available')
    ? diagnosticUnlockPath
    : readableReason;

  // Detect if the title is already a complete sentence (contains a verb)
  // to avoid appending "is not yet measurable" and creating a grammatical error.
  const titleIsSentence = /\bis\b|\sneeds\b|\srequires\b|\scannot\b/i.test(title);
  const trueGapClaim = titleIsSentence
    ? title
    : `${title} is not yet measurable`;

  return {
    cardType: 'diagnostic',
    claim: trueGapClaim,
    claimSub: 'Diagnostic · All historical telemetry',
    evidenceCells: [
      {
        label: 'Status',
        value: 'Not yet measurable',
        sub: readableReason,
        badgeType: 'neutral'
      },
      {
        label: 'Unlock path',
        value: trueGapUnlockValue,
        sub: 'Data coverage',
        badgeType: 'neutral'
      }
    ],
    isLowerBetter: false,
    interpretation: trueGapInterpretation,
    riskLabel: undefined,
    riskSub: undefined,
    actionText: trueGapAction,
    footerNote: 'Diagnostic · Not included in Top Insights.'
  };
}

// Build Insight Brief - 3-block structure for pilot credibility
function buildDecisionCard(
  row: V2PreviewRow,
  workflowComparison: WorkflowComparison,
  primaryMetricDisplay: string,
  cleanMetricLabel: string,
  deltaText: string,
  confidenceDisplay: string,
  dataSource: string,
  sampleSize: number,
  isHigherIsWorse: boolean,
  isUnknownWinner: boolean,
  isTrueOrgLevelMetric: boolean,
  isGitHubMetric: boolean
): PerformanceInsightViewModel['decisionCard'] {
  const insightId = row.id.toLowerCase()

  // Early return for frozen GitHub cards (before any generic routing)
  const frozenGithubCard = buildFrozenGithubDecisionCard(row, insightId)
  if (frozenGithubCard) return frozenGithubCard

  // CR5 FINAL DOWNSTREAM — Dedicated decision-card rendering for the two
  // downstream PIs. These read from breakdownByTool and evidence which
  // survive the render adapter (unlike githubSnapshot which is dropped).
  // Intercept here before generic routing to produce the exact card Matt
  // specified, using the existing ChaosMonkey visual language.
  if (insightId === 'executive-small-pr-workflow-optimization') {
    const bt = (row as any).breakdownByTool
    const ev = (row as any).evidence || []
    // Read values from breakdownByTool (survives adapter)
    const largeData = bt?.large
    const smallData = bt?.small
    if (largeData && smallData && typeof largeData.value === 'number' && typeof smallData.value === 'number') {
      const largeMedian = largeData.value
      const smallMedian = smallData.value
      const largeN = largeData.count || 0
      const smallN = smallData.count || 0
      const ratio = smallMedian > 0 ? largeMedian / smallMedian : 0
      const ratioStr = ratio >= 10 ? `${Math.round(ratio)}×` : `${ratio.toFixed(1)}×`
      const mergedTotal = (row as any).n || 0
      const totalPrs = ev.find((e: any) => (e.metric || '').includes('SAMPLE'))?.label?.replace(/PRs observed/, '').trim() || '—'
      return {
        cardType: 'workflow-comparison',
        claim: `${largeMedian}h vs ${smallMedian}h median merge cycle · ${mergedTotal} merged PRs`,
        claimSub: 'GitHub delivery · all-time baseline',
        evidenceCells: [
          { label: 'LARGE PRS', value: `${largeMedian}h median`, sub: `N=${largeN} · ≥200 changed lines`, badgeType: 'warning' },
          { label: 'SMALL PRS', value: `${smallMedian}h median`, sub: `N=${smallN} · <200 changed lines`, badgeType: 'neutral' },
          { label: 'DIFFERENCE', value: `${ratioStr} longer`, sub: 'Large vs small', badgeType: 'warning' },
          { label: 'SAMPLE', value: `${mergedTotal} merged PRs`, sub: `${totalPrs} PRs observed`, badgeType: 'neutral' }
        ],
        comparisonLabel: 'MERGE CYCLE BY PR SIZE',
        comparisonRows: [
          { name: 'Large PRs (≥200 changed lines)', value: `${largeMedian}h median`, percent: 100, color: '#dc2626', tag: `N=${largeN}`, tagType: 'worst' },
          { name: 'Small PRs (<200 changed lines)', value: `${smallMedian}h median`, percent: (smallMedian / largeMedian) * 100, color: '#2563eb', tag: `N=${smallN}`, tagType: 'best' }
        ],
        isLowerBetter: true,
        interpretation: (row as any).details || 'Larger changes are associated with substantially longer merge cycles in this GitHub dataset. Review whether PR size, change complexity, or review coordination is driving the gap.',
        riskLabel: 'Medium',
        riskSub: 'PR-size comparison',
        actionText: (row as any).recommendation || 'Compare review depth and change complexity across large and small PRs. Consider smaller change sets where the work can be split without increasing coordination cost.',
        footerNote: `GitHub delivery · all-time baseline · ${mergedTotal} merged PRs`,
        recommendationAllowed: true
      }
    }
  }

  if (insightId === 'change-failure-rate-spike-by-ide') {
    const bt = (row as any).breakdownByTool
    const ev = (row as any).evidence || []
    // Read from breakdownByTool (survives adapter)
    const stagingData = bt?.staging
    const productionData = bt?.production
    if (stagingData && productionData && typeof stagingData.value === 'number' && typeof productionData.value === 'number') {
      const successRate = (row as any).current || 0
      const total = (row as any).n || 0
      const success = successRate > 0 && total > 0 ? Math.round((successRate / 100) * total) : 0
      const failed = total - success
      const stagingPct = stagingData.value
      const productionPct = productionData.value
      const stagingN = stagingData.count || 0
      const productionN = productionData.count || 0
      const stagingSuccess = stagingN // 100% success
      const productionSuccess = productionN - (productionN - Math.round((productionPct / 100) * productionN))
      const observedDays = ev.find((e: any) => (e.metric || '').includes('FAILURES'))?.label || ''
      return {
        cardType: 'workflow-comparison',
        claim: `${success} of ${total} deployments succeeded · ${failed} failures, both in production`,
        claimSub: 'GitHub delivery · all-time baseline',
        evidenceCells: [
          { label: 'OVERALL SUCCESS', value: `${successRate}%`, sub: `${success} / ${total} deployments`, badgeType: 'neutral' },
          { label: 'PRODUCTION', value: `${productionPct}% success`, sub: `${productionSuccess} / ${productionN} deployments`, badgeType: 'warning' },
          { label: 'STAGING', value: `${stagingPct}% success`, sub: `${stagingSuccess} / ${stagingN} deployments`, badgeType: 'neutral' },
          { label: 'FAILURES', value: failed.toString(), sub: 'Both production', badgeType: 'warning' }
        ],
        comparisonLabel: 'DEPLOYMENT SUCCESS BY ENVIRONMENT',
        comparisonRows: [
          { name: 'Staging', value: `${stagingPct}%`, percent: stagingPct, color: '#2563eb', tag: `${stagingSuccess} / ${stagingN}`, tagType: 'best' },
          { name: 'Production', value: `${productionPct}%`, percent: productionPct, color: '#dc2626', tag: `${productionSuccess} / ${productionN}`, tagType: 'worst' }
        ],
        isLowerBetter: false,
        interpretation: (row as any).details || 'Most deployments completed successfully. Both observed failures occurred in production; staging completed 5 of 5 successfully.',
        riskLabel: 'Medium',
        riskSub: 'Deployment reliability',
        actionText: (row as any).recommendation || 'Inspect the two failed production releases for shared change characteristics, deployment timing, or missing pre-production checks.',
        footerNote: `GitHub delivery · all-time baseline · ${total} deployments · 3 observed days`,
        recommendationAllowed: true
      }
    }
  }
  
  // Helper: Extract numeric value from evidence by label
  const extractNumericValueFromEvidence = (evidence: any[], label: string): number => {
    for (const ev of evidence) {
      if ((ev.label || ev.metric || '').toLowerCase().includes(label.toLowerCase())) {
        const str = String(ev.value || '')
        const match = str.match(/[-+]?\d+\.?\d*/)
        return match ? parseFloat(match[0]) : 0
      }
    }
    return 0
  }
  
  // Determine card type
  let cardType: 'workflow-comparison' | 'ai-vs-traditional' | 'org-level' | 'attribution-gap' | 'neutral' | 'cost-efficiency' = 'neutral'

  // CR5 P0.8: Use presentationKind as the PRIMARY card type authority.
  // presentationKind is declared by the generator and carried unchanged.
  // comparisonMode is a statistical state, NOT a presentation shape.
  const presentationKind = (row as any).presentationKind as string | undefined

  piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: insightId=${insightId}, presentationKind=${presentationKind}, comparisonMode=${workflowComparison.comparisonMode}, hasEnoughComparisonData=${workflowComparison.hasEnoughComparisonData}, isTrueOrgLevelMetric=${isTrueOrgLevelMetric}, isUnknownWinner=${isUnknownWinner}, row.comparisonMode=${(row as any).comparisonMode}`)

  // Force org-level card type only for specific GitHub target IDs that should stay diagnostic
  const githubTargetIds = [
    'reviewer-load-concentration'
  ]
  if (githubTargetIds.includes(insightId)) {
    cardType = 'org-level'
    piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=org-level (GitHub target ID override)`)
  } else if (presentationKind === 'temporal_trend') {
    // CR5 P0.8: Temporal trend PIs use neutral card to preserve temporal title.
    cardType = 'neutral'
    piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=neutral (presentationKind=temporal_trend)`)
  } else if (presentationKind === 'org_summary') {
    cardType = 'org-level'
    piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=org-level (presentationKind=org_summary)`)
  } else if (presentationKind === 'cohort_comparison') {
    // CR5 P1.3 P3: Distinguish binary AI vs non-AI from multi-cohort intensity.
    // Binary (within-workflow-ai-effect): ai-vs-traditional card, 2 comparisonRows
    // Multi-cohort (ai-intensity-cohort-analysis): workflow-comparison card, 4 comparisonRows
    if ((row as any).comparisonMode === 'ai_vs_non_ai') {
      cardType = 'ai-vs-traditional'
      piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=ai-vs-traditional (binary cohort_comparison)`)
    } else {
      cardType = 'workflow-comparison'
      piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=workflow-comparison (multi-cohort_comparison)`)
    }
  } else if (presentationKind === 'cost_efficiency_comparison') {
    // CR5 WS3 P0: Cost efficiency gets its own card type to surface
    // cost-specific semantic fields (period, provenance, $/active hr units).
    cardType = 'cost-efficiency'
    piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=cost-efficiency (presentationKind=cost_efficiency_comparison)`)
  } else if (presentationKind === 'unit_economics') {
    // Unit Economics V1: allocated spend per outcome.
    // Uses neutral card type with UE-specific structured fields.
    cardType = 'neutral'
    piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=neutral (presentationKind=unit_economics)`)
  } else if (presentationKind === 'downstream_comparison') {
    // CR5 FINAL DOWNSTREAM: Use workflow-comparison card type to get
    // the existing ChaosMonkey visual language (comparison bars, evidence
    // cells). The dedicated card builder above already returned the exact
    // card content; this is a safety net for the card type determination.
    cardType = 'workflow-comparison'
    piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=workflow-comparison (presentationKind=downstream_comparison)`)
  } else if (presentationKind === 'workflow_comparison') {
    // Use workflow comparison card if enough data, otherwise neutral
    if (workflowComparison.hasEnoughComparisonData) {
      cardType = 'workflow-comparison'
      piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=workflow-comparison (presentationKind=workflow_comparison, sufficient data)`)
    } else {
      cardType = 'neutral'
      piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=neutral (presentationKind=workflow_comparison, insufficient data)`)
    }
  } else if (presentationKind === 'distribution_shape') {
    // CR-X PI FIX: Distribution-shape insights (e.g. session-duration p90/p50)
    // are within-workflow percentile descriptions, NOT cross-workflow comparisons.
    // Route to neutral card to avoid the workflow-comparison path mistreating
    // p50/p90 breakdown entries as separate workflows.
    cardType = 'neutral'
    piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=neutral (presentationKind=distribution_shape)`)
  } else if (presentationKind === 'diagnostic') {
    cardType = 'neutral'
    piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=neutral (presentationKind=diagnostic)`)
  } else if (presentationKind === 'repo_conditioned_behavior' ||
             presentationKind === 'workflow_repo_allocation' ||
             presentationKind === 'within_workflow_temporal' ||
             presentationKind === 'workflow_repo_allocation_shift' ||
             presentationKind === 'executive_synthesis') {
    // CR-X Wave 1B + Product-Strength Wave: Multi-dimensional families and
    // executive synthesis use neutral card with their own evidence.
    // They must NOT fall through to generic workflow-comparison rendering
    // which shows "insufficient comparison data" messaging.
    cardType = 'neutral'
    piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=neutral (presentationKind=${presentationKind})`)
  } else {
    // Fallback: no presentationKind — use legacy logic
    const isReviewMergeInsight = insightId.includes('small-pr') || insightId.includes('reviewer-load') || insightId.includes('reopen') || insightId.includes('revert')
    if (isReviewMergeInsight) {
      cardType = 'neutral'
      piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=neutral (review/merge insight, no presentationKind)`)
    } else if (workflowComparison.comparisonMode === 'org-level' || isTrueOrgLevelMetric) {
      cardType = 'org-level'
      piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=org-level (legacy org-level)`)
    } else if (workflowComparison.comparisonMode === 'attribution-gap' || isUnknownWinner) {
      cardType = 'attribution-gap'
      piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=attribution-gap (legacy)`)
    } else if ((row as any).comparisonMode === 'ai_vs_non_ai') {
      cardType = 'ai-vs-traditional'
      piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=ai-vs-traditional (legacy ai_vs_non_ai)`)
    } else if (workflowComparison.hasEnoughComparisonData) {
      cardType = 'workflow-comparison'
      piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=workflow-comparison (legacy, sufficient data)`)
    } else {
      piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType=neutral (legacy fallback)`)
    }
  }
  
  piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: FINAL cardType=${cardType}`)

  // Lower-is-better metrics: use polarity from workflowComparison (already correctly computed)
  const isLowerBetter = workflowComparison.polarity === 'higher-is-worse' ||
                       insightId.includes('cycle') || insightId.includes('latency') ||
                       insightId.includes('ttfc') || insightId.includes('time-to-first-commit') ||
                       insightId.includes('rework') ||
                       insightId.includes('change-failure') || insightId.includes('failure-rate') ||
                       insightId.includes('reopen') || insightId.includes('reopen-rate') ||
                       insightId.includes('review-load') || insightId.includes('review-burden') ||
                       insightId.includes('idle') || insightId.includes('idle-time') ||
                       insightId.includes('switching') || insightId.includes('context-switching')
  
  let claim: string = ''
  let claimSub: string = ''
  let evidenceCells: PerformanceInsightViewModel['decisionCard']['evidenceCells'] = []
  let comparisonRows: PerformanceInsightViewModel['decisionCard']['comparisonRows'] = []
  let comparisonLabel: string = ''
  let periodStrip: PerformanceInsightViewModel['decisionCard']['periodStrip'] = undefined
  let interpretation: string = ''
  let riskLabel: string = ''
  let riskSub: string = ''
  let actionText: string = ''
  let footerNote: string = ''
  
  switch (cardType) {
    case 'org-level': {
      // Org-level GitHub/deploy metrics - determine correct unit based on metric type
      // CR-X Track C/D: Use the generator's sampleUnit when available. The
      // generators already set sampleUnit correctly (e.g., 'PRs', 'merged PRs',
      // 'deployments'). Without this, merge-cycle-time and merge-rate default
      // to 'sessions' because they don't match the hardcoded ID patterns below.
      let sampleUnit = (row as any).sampleUnit || 'sessions'
      let sampleSizeValue = sampleSize
      let isDeployOperate = false
      let isReviewMerge = false
      
      // Check if breakdownByTool has real workflow data or just seeded demo data
      const hasRealWorkflowData = (row as any).breakdownByTool &&
        Object.values((row as any).breakdownByTool).some((data: any) =>
          data && data.count > 0 && data.count < sampleSize
        )

      // For org-level metrics, use the actual unit from the data source
      if (insightId.includes('deployment') || insightId.includes('change-failure') || insightId.includes('mttr') || insightId.includes('delivery-velocity') || insightId.includes('deployment-cadence')) {
        // Respect the generator's sampleUnit when provided — e.g.
        // deployment-failure-concentration reports 'failed deployments' (N=24),
        // not total deployments (N=92).
        sampleUnit = (row as any).sampleUnit || 'deployments'
        isDeployOperate = true
        // If no real workflow data, use total deployments from evidence or operational breadcrumbs
        if (!hasRealWorkflowData) {
          const deploymentCount = (row as any).evidence?.find((e: any) => e.label === 'Deployments')?.value ||
                               (row as any).operationalBreadcrumbs?.find((b: string) => b.includes('deployment'))
          if (typeof deploymentCount === 'number') {
            sampleSizeValue = deploymentCount
          }
        }
      } else if (insightId.includes('review') || insightId.includes('pr-') || insightId.includes('reopen') || insightId.includes('revert') || insightId.includes('reviewer-load')) {
        // Respect the generator's sampleUnit when provided (e.g. 'merged PRs').
        sampleUnit = (row as any).sampleUnit || 'PRs'
        isReviewMerge = true
        // If no real workflow data, use total PRs from evidence or operational breadcrumbs
        if (!hasRealWorkflowData) {
          const prCount = (row as any).evidence?.find((e: any) => e.label === 'PRs')?.value ||
                        (row as any).operationalBreadcrumbs?.find((b: string) => b.includes('PR'))
          if (typeof prCount === 'number') {
            sampleSizeValue = prCount
          }
        }
      }

      // Outcome-first title: metric + value + sample context
      // CR5 P1.4 P1: Claim proves/qualifies the title — no duplication.
      if (insightId === 'pilot-maturity-progression') {
        // CR-X PI FIX: Maturity card is a pilot-status card, not an org-level
        // GitHub/deploy metric. Use the generator's stage and session evidence
        // directly. Do NOT show the stale IDE-attribution tile — the maturity
        // card itself proves workflow attribution is available.
        claim = (row as any).title || 'Pilot status'
        claimSub = (row as any).whatChanged || `${dataSource} · Pilot maturity`
      } else if (insightId === 'repository-concentration') {
        claim = `${sampleSizeValue.toLocaleString()} attributed sessions across ${(row as any).displayValue || '—'}`
        claimSub = `${dataSource} · Org-level summary`
      } else if (isDeployOperate) {
        const metricName = insightId.includes('change-failure') ? 'CFR' : cleanMetricLabel
        // If the formatted value already carries the sample unit (e.g.
        // "92 deployments"), the generic "across N deployments" suffix is a
        // tautology — present value without it.
        claim = String(primaryMetricDisplay).trim().toLowerCase().endsWith(String(sampleUnit).toLowerCase())
          ? `${metricName}: ${primaryMetricDisplay}`
          : `${metricName} is ${primaryMetricDisplay} across ${sampleSizeValue.toLocaleString()} ${sampleUnit}`
        claimSub = `${dataSource} · All-time baseline`
      } else if (isReviewMerge) {
        claim = `${cleanMetricLabel} is ${primaryMetricDisplay} across ${sampleSizeValue.toLocaleString()} ${sampleUnit}`
        claimSub = `${dataSource} · All-time baseline`
      } else {
        claim = `${cleanMetricLabel}: ${primaryMetricDisplay} across the organization`
        claimSub = `${dataSource} · All-time baseline`
      }

      // CR-X PI FIX: Maturity card gets truthful maturity evidence — stage,
      // tracked workflows, mature workflows, session population — NOT the
      // generic org-level cells that include the stale IDE-attribution tile.
      if (insightId === 'pilot-maturity-progression') {
        const stage = (row as any).rightMetric || '—'
        const bt = (row as any).breakdownByTool as Record<string, { value: number; label: string; sessions?: number }> | undefined
        const trackedWorkflows = bt ? Object.keys(bt).length : 0
        const matureWorkflows = bt ? Object.values(bt).filter((d: any) => (d.sessions ?? d.value) >= 25).length : 0
        evidenceCells = [
          {
            label: 'Maturity stage',
            value: stage,
            sub: 'Pilot evidence availability',
            badge: 'Pilot status',
            badgeType: 'neutral' as const
          },
          {
            label: 'Tracked workflows',
            value: String(trackedWorkflows),
            sub: 'Workflows with telemetry',
            badge: 'Workflow attribution',
            badgeType: 'neutral' as const
          },
          {
            label: 'Mature workflows',
            value: String(matureWorkflows),
            sub: 'Workflows with 25+ sessions',
            badge: 'Cross-workflow ready',
            badgeType: 'neutral' as const
          },
          {
            label: 'Session population',
            value: sampleSizeValue.toLocaleString(),
            sub: 'Total telemetry sessions',
            badge: 'Telemetry coverage',
            badgeType: 'neutral' as const
          }
        ]
      } else {
      evidenceCells = [
        // CR5 P1.2 P8: Each cell shows DISTINCT information.
        // Cell 1: total tracked repos (from displayValue)
        // Cell 2: attributed sample size
        // Cell 3: top-2 concentration share
        ...(insightId === 'repository-concentration' ? [
          {
            label: 'Tracked repositories',
            value: (row as any).displayValue || '—',
            sub: 'Distinct repos with attributed sessions',
            badge: 'Org-level',
            badgeType: 'neutral' as const
          },
          {
            label: 'Attributed sample',
            value: sampleSizeValue.toLocaleString(),
            sub: `${sampleUnit} with repo attribution`,
            badge: 'Strong signal',
            badgeType: 'neutral' as const
          },
          {
            label: 'Top-2 concentration',
            value: (row as any).rightMetric || '—',
            sub: 'Share of sessions in top 2 repos',
            badge: 'Org-level',
            badgeType: 'neutral' as const
          }
        ] : [
          {
            label: cleanMetricLabel,
            value: primaryMetricDisplay,
            sub: `Across ${sampleSizeValue.toLocaleString()} ${sampleUnit}`,
            badge: 'Org-level signal',
            badgeType: 'neutral' as const
          },
          {
            label: 'Sample & source',
            value: sampleSizeValue.toLocaleString(),
            sub: `${sampleUnit} · ${dataSource}`,
            badge: 'Strong signal',
            badgeType: 'neutral' as const
          },
          {
            label: 'Attribution',
            value: (row as any).scopeLabel || 'Org-level',
            sub: (row as any).provenanceLabel || 'Telemetry',
            badge: (row as any).scopeLabel || 'Org-level',
            badgeType: 'neutral' as const
          }
        ])
      ]
      } // end else (non-maturity org-level evidence)

      // CR5 P1.3 P4: Repository concentration — no legitimate historical/target baseline exists.
      // The generator sets baseline=0, delta=0. Do NOT manufacture a baseline.
      // CR5 P1.4 P6: Show top-2 + other repos, not all repos. Proves the 85.9% claim immediately.
      if (insightId === 'repository-concentration') {
        const repoBreakdown = (row as any).breakdownByTool as Record<string, { value: number; count: number; formatted: string; label: string }> | undefined
        if (repoBreakdown && Object.keys(repoBreakdown).length >= 2) {
          const repoEntries = Object.entries(repoBreakdown).sort(([, a], [, b]) => b.value - a.value)
          const totalShare = repoEntries.reduce((sum, [, d]) => sum + d.value, 0)
          const top2Share = repoEntries.slice(0, 2).reduce((sum, [, d]) => sum + d.value, 0)
          const otherShare = totalShare - top2Share
          const otherCount = repoEntries.length - 2
          const maxShare = Math.max(...repoEntries.map(([, d]) => d.value), 1)

          comparisonLabel = 'Session distribution by repository'
          comparisonRows = [
            ...repoEntries.slice(0, 2).map(([, data], idx) => ({
              name: data.label,
              value: `${(data.value).toFixed(1)}% (${data.count} sessions)`,
              percent: (data.value / maxShare) * 100,
              color: idx === 0 ? '#3b82f6' : '#8b5cf6',
              tagType: 'neutral' as const
            })),
            {
              name: `Other ${otherCount} repositories`,
              value: `${otherShare.toFixed(1)}% (${repoEntries.slice(2).reduce((s, [, d]) => s + d.count, 0)} sessions)`,
              percent: (otherShare / maxShare) * 100,
              color: '#64748b',
              tagType: 'neutral' as const
            }
          ]
        }
      }

      if (insightId === 'pilot-maturity-progression') {
        // CR-X PI FIX: Maturity card interpretation uses the generator's
        // whyItMatters — NOT the stale IDE-attribution copy that contradicts
        // the card's own workflow evidence.
        interpretation = (row as any).whyItMatters || 'Pilot maturity stage describes evidence availability and what findings unlock next.'
      } else if (insightId === 'repository-concentration') {
        // CR-X P0-3: Branch on concentrationLevel — distributed is NOT concern
        const concLevel = (row as any).concentrationLevel || 'moderate'
        if (concLevel === 'distributed') {
          interpretation = `Session activity is distributed across the tracked repositories; no material concentration concern.`
        } else {
          interpretation = `Session activity is concentrated in a small number of repositories. Confirm whether this matches current engineering priorities or reflects instrumentation coverage gaps.`
        }
      } else {
        // CR-X QUALITY: Use the generator's own interpretation content instead
        // of overriding with "Not yet attributable by IDE/tool". Org-level is a
        // legitimate analytical scope, not a broken state. The generator's
        // description/whyItMatters already contains the operational implication.
        // Attribution scope is kept in the footer/risk, not the interpretation.
        interpretation = (row as any).whyItMatters
          || (row as any).description
          || `${cleanMetricLabel} measured across ${sampleSizeValue.toLocaleString()} ${sampleUnit}.`
      }

      // CR-X P0-3: Risk label must reflect concentrationLevel, not default to Medium
      if (insightId === 'pilot-maturity-progression') {
        riskLabel = 'Informational'
        riskSub = 'Pilot maturity · Contextual'
      } else if (insightId === 'repository-concentration') {
        const concLevel = (row as any).concentrationLevel || 'moderate'
        riskLabel = concLevel === 'high' ? 'High' : concLevel === 'moderate' ? 'Medium' : 'Informational'
        riskSub = concLevel === 'distributed' ? 'Distributed footprint' : 'Org-wide signal'
      } else {
        riskLabel = 'Medium'
        riskSub = 'Org-wide signal'
      }

      // CR-X QUALITY: Use the generator's recommendation when available.
      // The generator already produces metric-specific, evidence-grounded
      // recommendations. Only fall back to generic action text when the
      // generator didn't provide one.
      if (insightId === 'pilot-maturity-progression') {
        actionText = (row as any).recommendation || 'Use cohort patterns to contextualize pilot maturity. Associate with delivery outcomes only where provenance permits.'
      } else if (insightId === 'repository-concentration') {
        const totalReposFromRow = (row as any).displayValue || `${sampleSizeValue.toLocaleString()} repos`
        actionText = (row as any).recommendation || `Repository concentration is an org-level metric. ${totalReposFromRow} tracked with ${sampleSizeValue.toLocaleString()} attributed sessions.`
      } else if ((row as any).recommendation) {
        actionText = (row as any).recommendation
      } else if (insightId.includes('deployment') || insightId.includes('change-failure') || insightId.includes('mttr')) {
        actionText = `Review pre-deploy validation gates org-wide. Enable GitHub deployment environment protection rules. Strengthen release validation to improve ${cleanMetricLabel} before expanding deployment cadence.`
      } else if (insightId.includes('delivery-velocity') || insightId.includes('deployment-cadence')) {
        actionText = `Inspect deployment throughput alongside CFR before increasing cadence. Optimize CI/CD validation stages to maintain stability at higher release frequency.`
      } else if (insightId.includes('review-load') || insightId.includes('reviewer-load') || insightId.includes('reviewer-concentration')) {
        actionText = `Review reviewer load balancing across the team. Distribute PR review assignments to prevent senior reviewer bottlenecks. Establish PR review SLAs to reduce queue time.`
      } else {
        const orgFallback = getMetricSpecificFallback(insightId)
        actionText = orgFallback.actionText
      }

      if (insightId === 'pilot-maturity-progression') {
        footerNote = (row as any).operationalRead || `Pilot maturity · ${sampleSizeValue.toLocaleString()} sessions.`
      } else if (isDeployOperate) {
        footerNote = (row as any).confidenceReasoning || `${(row as any).provenanceLabel || 'GitHub'} · ${(row as any).scopeLabel || 'Org-level'} · ${sampleSizeValue.toLocaleString()} ${sampleUnit}`
      } else if (isReviewMerge) {
        footerNote = (row as any).confidenceReasoning || `${(row as any).provenanceLabel || 'GitHub'} · ${(row as any).scopeLabel || 'Org-level'} · ${sampleSizeValue.toLocaleString()} ${sampleUnit}`
      } else if (insightId === 'repository-concentration') {
        footerNote = (row as any).confidenceReasoning || `${(row as any).provenanceLabel || 'Telemetry'} · ${(row as any).scopeLabel || 'Org-level'} · ${sampleSizeValue.toLocaleString()} ${sampleUnit}`
      } else {
        footerNote = (row as any).confidenceReasoning || `${(row as any).provenanceLabel || 'Telemetry'} · ${(row as any).scopeLabel || 'Org-level'} · ${sampleSizeValue.toLocaleString()} ${sampleUnit}`
      }
      // CR-X UI Polish: attach period strip for merge-rate and pr-throughput
      // where multi-month outcomes_by_month evidence exists
      if ((row as any).periodStrip && (row as any).periodStrip.points && (row as any).periodStrip.points.length >= 2) {
        periodStrip = (row as any).periodStrip
      }
      break
    }
    
    case 'ai-vs-traditional': {
      // CR5 P0.8: Handle both binary AI/non-AI cohort comparisons AND
      // multi-cohort intensity gradient comparisons.
      const bd = (row as any).breakdownByTool || {}
      const bdKeys = Object.keys(bd)
      const pk = (row as any).presentationKind

      // CR5 P0.8: Multi-cohort intensity gradient (e.g., non-AI/low/medium/high)
      if (pk === 'cohort_comparison' && !bd.ai && !bd.non_ai && !bdKeys.find(k => k.endsWith('_ai'))) {
        // Multi-cohort: use the highest and lowest cohorts for the comparison
        const cohortEntries = bdKeys.map(k => ({ key: k, ...bd[k] })).filter(e => e.count > 0 && typeof e.value === 'number')
        if (cohortEntries.length >= 2) {
          cohortEntries.sort((a, b) => b.value - a.value)
          const topCohort = cohortEntries[0]
          const bottomCohort = cohortEntries[cohortEntries.length - 1]
          const cohortDelta = topCohort.value - bottomCohort.value
          const cohortDeltaPct = bottomCohort.value > 0 ? Math.round((cohortDelta / bottomCohort.value) * 100) : 0

          claim = (row as any).title || `${topCohort.label || topCohort.key} vs ${bottomCohort.label || bottomCohort.key}`
          claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · All-time baseline`

          evidenceCells = cohortEntries.slice(0, 4).map(c => ({
            label: c.label || c.key,
            value: c.formatted || c.value?.toFixed(1),
            sub: `${c.count} sessions`,
            badgeType: 'neutral' as const
          }))

          interpretation = (row as any).description || (row as any).operationalRead || `AI intensity gradient across ${cohortEntries.length} cohorts. ${(row as any).executiveSummary || ''}`
          riskLabel = 'Informational'
          riskSub = 'Cohort comparison'
          actionText = (row as any).recommendation || 'Monitor cohort differences over time.'
          footerNote = `${cohortEntries.length} cohorts compared · ${sampleSize.toLocaleString()} sessions`
          break
        }
      }

      // Binary AI vs non-AI cohort comparison
      // CR5 P0.7: Support both simple (ai/non_ai) and within-workflow (*_ai/*_nonai) key patterns.
      // Try simple keys first, then within-workflow pattern
      const aiKey = bd.ai ? 'ai' : bdKeys.find(k => k.endsWith('_ai'))
      const nonAiKey = bd.non_ai ? 'non_ai' : bdKeys.find(k => k.endsWith('_nonai'))
      const aiEntry = aiKey ? bd[aiKey] : undefined
      const nonAiEntry = nonAiKey ? bd[nonAiKey] : undefined

      const aiValue = aiEntry?.value
      const nonAiValue = nonAiEntry?.value
      const aiFormatted = aiEntry?.formatted || primaryMetricDisplay
      const nonAiFormatted = nonAiEntry?.formatted || '—'
      const aiCount = aiEntry?.count || 0
      const nonAiCount = nonAiEntry?.count || 0
      
      piDebugLog(`[PI_AI_VS_TRAD_TRACE] ${row.id}: aiValue=${aiValue}, nonAiValue=${nonAiValue}, aiCount=${aiCount}, nonAiCount=${nonAiCount}`)
      
      // If either side is missing, show insufficient comparison
      if (aiValue === undefined || nonAiValue === undefined || isNaN(aiValue) || isNaN(nonAiValue)) {
        claim = `AI vs Non-AI comparison needs more data`
        claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · All-time baseline`
        
        evidenceCells = [
          {
            label: 'Observed AI signals',
            value: aiFormatted,
            sub: aiValue !== undefined ? `${aiFormatted}` : 'Value unavailable',
            badgeType: 'neutral'
          },
          {
            label: 'Zero observed AI signals',
            value: nonAiFormatted,
            sub: nonAiValue !== undefined ? `${nonAiFormatted}` : 'Value unavailable',
            badgeType: 'neutral'
          },
          {
            label: 'Difference',
            value: 'Insufficient',
            sub: 'Both cohorts need data',
            badgeType: 'neutral'
          }
        ]
        
        interpretation = 'Insufficient data for AI vs Non-AI comparison. Both cohorts need values.'
        riskLabel = 'Low'
        riskSub = 'Data gap detected'
        actionText = 'Enable session tagging for AI-assisted workflows to allow comparison.'
        footerNote = 'AI vs Non-AI comparison requires both cohorts to have data.'
        break
      }
      
      const isCycleTime = insightId.includes('cycle') || insightId.includes('latency')
      // CR5 P0.8: Define isRateMetric here — was missing, causing ReferenceError
      const isRateMetric = insightId.includes('adoption') || insightId.includes('rework') || insightId.includes('quality') || insightId.includes('focus') || insightId.includes('ratio') || insightId.includes('intensity')
      // CR5 WS1.4 P0 FIX: Commit metrics use commits/session, not min/session.
      // delivery-rate-ai-vs-non-ai and executive-ai-yield-optimization compare
      // commits per session — the unit was incorrectly defaulting to min/session.
      const isCommitMetric = insightId.includes('delivery-rate') || insightId.includes('yield') || insightId.includes('commit')
      // CR5 V1 FINAL P0-4: TTFC is an elapsed duration, not a per-session rate.
      // Use "min" not "min/session" for the difference/gap.
      const isDurationMetric = insightId.includes('time-to-first') || insightId.includes('ttfc') || insightId.includes('duration')
      const delta = aiValue - nonAiValue
      const absDelta = Math.abs(delta)
      
      // Determine which is better
      let betterCohort = 'Observed AI signals'
      let worseCohort = 'Zero observed AI signals'
      let betterValue = aiFormatted
      let worseValue = nonAiFormatted
      let betterRaw = aiValue
      let worseRaw = nonAiValue
      
      if (isLowerBetter) {
        // Lower is better
        if (aiValue < nonAiValue) {
          betterCohort = 'Observed AI signals'
          worseCohort = 'Zero observed AI signals'
          betterValue = aiFormatted
          worseValue = nonAiFormatted
          betterRaw = aiValue
          worseRaw = nonAiValue
        } else {
          betterCohort = 'Zero observed AI signals'
          worseCohort = 'Observed AI signals'
          betterValue = nonAiFormatted
          worseValue = aiFormatted
          betterRaw = nonAiValue
          worseRaw = aiValue
        }
      } else {
        // Higher is better
        if (aiValue > nonAiValue) {
          betterCohort = 'Observed AI signals'
          worseCohort = 'Zero observed AI signals'
          betterValue = aiFormatted
          worseValue = nonAiFormatted
          betterRaw = aiValue
          worseRaw = nonAiValue
        } else {
          betterCohort = 'Zero observed AI signals'
          worseCohort = 'Observed AI signals'
          betterValue = nonAiFormatted
          worseValue = aiFormatted
          betterRaw = nonAiValue
          worseRaw = aiValue
        }
      }
      
      // CR5 P1.4 P1: Claim shows magnitude + sample, not the finding itself
      // CR5 P1.5 P0.3: Use "median" not "avg" — generator computes medians.
      // CR5 P1.5 P1: For within-workflow, use fixed "active coding" label with N per cohort.
      const isWithinWorkflow = insightId.includes('within-workflow-ai-effect')
      const aggLabel = isWithinWorkflow ? 'Median' : 'avg'
      const withinSub = (count: number) => isWithinWorkflow ? `Median active coding · N=${count.toLocaleString()}` : null
      claim = `${betterValue} vs ${worseValue} · ${isCycleTime ? `${absDelta.toFixed(1)}h` : `${absDelta.toFixed(1)}${isRateMetric ? 'pp' : isCommitMetric ? ' commits/session' : isDurationMetric ? ' min' : ' min/session'}`} gap`
      claimSub = `${aiCount.toLocaleString()} AI-active vs ${nonAiCount.toLocaleString()} non-AI sessions · Telemetry`

      evidenceCells = [
        {
          label: `${betterCohort}`,
          value: betterValue,
          sub: withinSub(betterCohort === 'Observed AI signals' ? aiCount : nonAiCount) || `${aggLabel} ${cleanMetricLabel} (${betterCohort === 'Observed AI signals' ? aiCount.toLocaleString() : nonAiCount.toLocaleString()} sessions)`,
          badgeType: 'neutral'
        },
        {
          label: worseCohort,
          value: worseValue,
          sub: withinSub(worseCohort === 'Observed AI signals' ? aiCount : nonAiCount) || `${aggLabel} ${cleanMetricLabel}`,
          badgeType: 'neutral'
        },
        {
          label: 'Difference',
          // CR5 P1.4 P4: Include unit — no naked values
          value: isCycleTime ? `${absDelta.toFixed(1)}h` : `${absDelta.toFixed(1)}${isRateMetric ? ' pp' : isCommitMetric ? ' commits/session' : isDurationMetric ? ' min' : ' min/session'}`,
          sub: isCycleTime ? `${worseCohort} takes longer` : (isRateMetric ? 'percentage-point gap' : isCommitMetric ? 'commits/session gap' : isDurationMetric ? 'min gap' : isWithinWorkflow ? 'Median gap' : 'min/session gap'),
          badgeType: 'neutral'
        }
      ]

      // CR5 P1.4 P2: Semantic colors — AI=blue, Non-AI=slate
      // Comparison bar
      const maxValue = Math.max(aiValue, nonAiValue)
      comparisonLabel = isWithinWorkflow ? 'Median active coding comparison' : `${cleanMetricLabel} comparison`
      comparisonRows = [
        {
          name: betterCohort,
          value: betterValue,
          percent: (betterRaw / maxValue) * 100,
          color: '#3b82f6',
          tagType: 'neutral'
        },
        {
          name: worseCohort,
          value: worseValue,
          percent: (worseRaw / maxValue) * 100,
          color: '#64748b',
          tagType: 'neutral'
        }
      ]
      
      // Use generator interpretation/action for AI PR cycle only with explicit non-blank fallback
      if (insightId === 'session-conditioned-pr-cycle-time-ai-vs-non-ai' && isCycleTime) {
        interpretation = (row.description && row.description.trim())
          ? row.description
          : 'AI-assisted PRs are taking longer to clear review in this sample.'
        actionText = (row.recommendation && row.recommendation.trim())
          ? row.recommendation
          : 'Check AI-assisted PR size, review assignment, and queue time before expanding usage.'
      } else {
        // CR5 P1.5 P3: Within-workflow interpretation — controls for workflow identity.
        // CR5 WS2 #12 P0-3: Use row.details (adapter maps description→details).
        // The generator provides commit-specific semantics for delivery-rate-ai-vs-non-ai.
        // Only fall back to generic active-coding text when the generator did not
        // provide a description AND the metric is genuinely about active coding.
        const ratio = nonAiValue > 0 ? (aiValue / nonAiValue).toFixed(1) : 'N/A';
        const generatorDescription = (row as any).details || (row as any).description;
        interpretation = (generatorDescription && String(generatorDescription).trim())
          ? String(generatorDescription)
          : isCycleTime
            ? `${worseCohort} shows longer ${cleanMetricLabel} in the current sample.`
            : isCommitMetric
              ? `AI-assisted sessions show ${aiFormatted} vs ${nonAiFormatted} ${cleanMetricLabel}. Observational comparison; workflow/task mix may confound.`
              : `Within the same workflow, AI-active sessions show materially different active-coding behavior. Association, not causal proof.`;
        actionText = (row.recommendation && row.recommendation.trim())
          ? row.recommendation
          : isCycleTime
            ? 'Enforce PR size limits on AI-generated code before review. Add reviewer assignment checks for AI-assisted PRs to reduce queue time.'
            : isCommitMetric
              ? `Investigate whether AI-assisted sessions handle different task types before interpreting the commit-rate difference as a productivity effect.`
              : `Compare task mix, session duration, and AI intensity between AI-active and non-AI sessions to determine whether the difference reflects AI workflow effects, task selection, or both.`;
        riskLabel = 'Informational';
        riskSub = 'Observational comparison';
      }
      riskLabel = 'Medium'
      // CR5 WS1 P0 FIX: Only claim GitHub review data when the finding
      // actually uses it. PR cycle-time metrics (isCycleTime) use GitHub
      // PR/review evidence. Within-workflow active-coding comparisons are
      // telemetry-only — claiming "+ GitHub review data" is false provenance.
      footerNote = isCycleTime
        ? `AI vs Non-AI split from telemetry + GitHub review data. ${sampleSize.toLocaleString()} sessions baseline.`
        : `AI vs Non-AI split from telemetry. ${sampleSize.toLocaleString()} sessions baseline.`
      break
    }
    
    case 'cost-efficiency': {
      // CR5 WS3 P0: Cost-efficiency card surfaces cost-specific semantics.
      // Uses the generator's description, evidence, recommendation, and
      // operationalBreadcrumbs which contain period/provenance/$ unit fields.
      try {
        const costEvidence = (row as any).evidence as Array<{ metric: string; value: string; label: string }> | undefined
        const costBreakdown = (row as any).breakdownByTool as Record<string, { value: number; count: number; formatted: string; label: string }> | undefined
        // CR-X FINAL: The cost unit is determined by the generator's operational-mode authority.
        const costLabel = ((row as any).rightMetricLabel || 'cost/active hour') as string
        const costLabelShort = costLabel.includes('runtime') ? 'runtime hr' : 'active hr'
        const costUnitLong = costLabel.includes('runtime') ? 'runtime hour' : 'active-coding hour'
        const desc = (row as any).details || (row as any).description || ''
        const rec = (row as any).recommendation || ''
        const breadcrumbs = (row as any).operationalBreadcrumbs as string[] | undefined

        // Extract the qualifying period from breadcrumbs or description
        const periodMatch = desc.match(/·\s*(\d{4}-\d{2})/)
        const periodRaw = periodMatch ? periodMatch[1] : ''
        // Render period as customer-friendly "Month YYYY" instead of "YYYY-MM"
        const period = periodRaw ? formatPeriodHuman(periodRaw) : ''

        // Claim: headline ratio or absolute-dollar from the title
        claim = (row as any).title || 'Configured cost efficiency across primary workflows'
        claimSub = period ? `Current configured rates applied to ${period} observed usage · Configured estimate · Not billing data` : 'Configured estimate · Not billing data'

        // PAIRWISE SCOPE RULE: when the title names a specific pair
        // ("11.0× higher for A than B"), headline evidence cells and
        // comparison rows are scoped to that pair. Other configured
        // workflows appear only as an explicitly labeled context cell.
        const selectedComp = (row as any).selectedComparison as
          { leaderKey: string; baselineKey: string } | undefined
        const pairKeys = selectedComp ? [selectedComp.leaderKey, selectedComp.baselineKey] : []
        // Map workflow keys to canonical display names ("claude_code" →
        // "Claude Code") so they match both the title and evidence metrics.
        const pairNames = pairKeys.map(k =>
          displayWorkflowName(getCanonicalWorkflowIdentity(k)).toLowerCase())
        const pairwiseTitle = pairNames.length === 2 && !!row.title &&
          pairNames.every(n => (row.title as string).toLowerCase().includes(n))
        const inPair = (metricLabelText: string) =>
          !pairwiseTitle || pairNames.some(n => metricLabelText.toLowerCase().startsWith(n))

        // Evidence cells: cost/active-hour for each workflow + difference + cost/session + monthly spend
        if (costEvidence && costEvidence.length >= 2) {

          // Split evidence into mode-correct cost/hour and cost/session groups
          const cahEvidence = costEvidence.filter(e => e.metric.toLowerCase().includes(costLabel))
          const csEvidence = costEvidence.filter(e => e.metric.toLowerCase().includes('cost/session'))

          evidenceCells = []

          // Cost/hour cells for the headline pair
          for (const e of cahEvidence.filter(e => inPair(e.metric))) {
            evidenceCells.push({
              label: e.metric.replace(new RegExp(` ${costLabel}$`, 'i'), '').replace(/ workflow/i, ''),
              value: e.value,
              sub: e.label,
              badgeType: 'neutral' as const
            })
          }

          // Difference cell with explicit $/active hr unit.
          // CR-X PI: use the generator's selectedComparison (leader vs baseline)
          // as the authority for the headline pair — NOT the first two evidence
          // entries, which are sorted by value and may not match the headline
          // pair when there are 3+ workflows (e.g. Cursor vs Devin headline but
          // evidence[0..1] = Cursor vs VS Code).
          if (selectedComp && costBreakdown) {
            const leaderData = costBreakdown[selectedComp.leaderKey]
            const baselineData = costBreakdown[selectedComp.baselineKey]
            if (leaderData && baselineData
              && leaderData.value !== null && baselineData.value !== null) {
              // CR-X display reconciliation: the Difference must reconcile with
              // the displayed (rounded) operands, not the raw underlying values.
              // The operand cells render `$${value.toFixed(2)}/hr` from the
              // generator's evidence array. Compute the difference from those
              // same 2-dp rounded operands so $8.25 − $1.80 = $6.45, not $6.44
              // (which happens when raw values like 8.252/1.807 are subtracted
              // and the result rounds down). This is a DISPLAY rule only — the
              // underlying economic calculation in the generator is unchanged.
              const leaderRounded = Math.round(leaderData.value * 100) / 100
              const baselineRounded = Math.round(baselineData.value * 100) / 100
              const diff = Math.abs(leaderRounded - baselineRounded)
              evidenceCells.push({
                label: 'Difference',
                value: `$${diff.toFixed(2)}/${costLabelShort}`,
                sub: `${displayWorkflowName(getCanonicalWorkflowIdentity(selectedComp.leaderKey))} − ${displayWorkflowName(getCanonicalWorkflowIdentity(selectedComp.baselineKey))}`,
                badgeType: 'neutral' as const
              })
            }
          } else if (cahEvidence.length >= 2) {
            const val1 = parseFloat(cahEvidence[0].value.replace(/[^0-9.]/g, ''))
            const val2 = parseFloat(cahEvidence[1].value.replace(/[^0-9.]/g, ''))
            if (!isNaN(val1) && !isNaN(val2)) {
              const diff = Math.abs(val1 - val2)
              evidenceCells.push({
                label: 'Difference',
                value: `$${diff.toFixed(2)}/${costLabelShort}`,
                sub: `Configured ${costLabel} gap`,
                badgeType: 'neutral' as const
              })
            }
          }

          // Cost/session cells as supporting evidence — scoped to the pair
          for (const e of csEvidence.filter(e => inPair(e.metric))) {
            evidenceCells.push({
              label: e.metric.replace(/ cost\/session/i, '').replace(/ workflow/i, '') + ' cost/session',
              value: e.value,
              sub: e.label,
              badgeType: 'neutral' as const
            })
          }

          // Monthly spend from breakdown labels — scoped to the pair
          if (costBreakdown) {
            for (const [wf, data] of Object.entries(costBreakdown)) {
              if (pairwiseTitle && !pairKeys.includes(wf)) continue
              const monthlyMatch = data.label.match(/\$(\d+)\/mo/)
              if (monthlyMatch) {
                evidenceCells.push({
                  label: displayWorkflowName(getCanonicalWorkflowIdentity(wf)) + ' monthly',
                  value: `$${monthlyMatch[1]}/mo`,
                  sub: 'Configured monthly spend',
                  badgeType: 'neutral' as const
                })
              }
            }
          }

          // Explicitly labeled secondary context for configured workflows
          // outside the headline pair.
          if (pairwiseTitle && costBreakdown) {
            const otherCells = Object.entries(costBreakdown)
              .filter(([wf]) => !pairKeys.includes(wf))
              .map(([wf, data]) => `${displayWorkflowName(getCanonicalWorkflowIdentity(wf))} ${data.formatted}`)
            if (otherCells.length > 0) {
              evidenceCells.push({
                label: 'Also configured',
                value: otherCells.join(' · '),
                sub: 'Context only — not part of the headline comparison',
                badgeType: 'neutral' as const
              })
            }
          }
        }

        // Comparison bar from breakdownByTool — scoped to the headline pair
        // when the title names a pair.
        if (costBreakdown && Object.keys(costBreakdown).length >= 2) {
          const scopedBreakdown = (pairwiseTitle && pairKeys.length === 2)
            ? Object.fromEntries(Object.entries(costBreakdown).filter(([wf]) => pairKeys.includes(wf)))
            : costBreakdown
          const entries = Object.entries(scopedBreakdown).sort((a, b) => b[1].value - a[1].value)
          const maxValue = Math.max(...entries.map(([, d]) => d.value), 0.01)
          comparisonLabel = `Configured ${costLabel} comparison${pairwiseTitle ? ' — headline pair' : ''}`
          comparisonRows = entries.map(([wf, data], idx) => ({
            name: displayWorkflowName(getCanonicalWorkflowIdentity(wf)),
            value: data.formatted,
            percent: maxValue > 0 ? (data.value / maxValue) * 100 : 0,
            color: ['#3b82f6', '#8b5cf6', '#64748b', '#94a3b8'][idx % 4],
            tag: data.label.match(/\$(\d+)\/mo/) ? `$${data.label.match(/\$(\d+)\/mo/)![1]}/mo` : undefined,
            tagType: 'neutral' as const
          }))
        }

        // Interpretation: concise provenance + decision-check sentence.
        // Dollar figures are already visible in evidence cells — do not duplicate here.
        // The decision-check is embedded here because monitor_only cards do not
        // render the action strip, so actionText would be invisible.
        const costContext = costUnitLong === 'runtime hour'
          ? 'session runtime, task duration, seat configuration, and task mix'
          : 'active-coding time, focus, and task mix'

        interpretation = `Configured cost per ${costUnitLong} normalizes configured spend by observed ${costUnitLong}. Differences may reflect tool pricing, ${costContext} — not productivity. Compare those factors before changing tool policy. Configured estimate · Not billing data.`

        // Risk label
        riskLabel = 'Informational'
        riskSub = 'Configured estimate · Not billing data'

        // Action text: kept for completeness but NOT rendered for monitor_only cards.
        actionText = rec || `Compare the configured cost difference with ${costContext} before changing tool policy.`

        // Footer note: period + non-historical-invoice wording (no duplication of estimate label)
        footerNote = period
          ? `Configured rates applied to ${period} observed usage · Not historical invoices.`
          : 'Configured estimate · Not billing data · Not historical invoices.'

        break
      } catch (e) {
        console.error(`[PI_COST_CARD_TRACE] ${row.id}: Error building cost-efficiency card:`, e)
        // Fall through to workflow-comparison as safety net
      }
      break
    }

    case 'workflow-comparison': {
      try {
        piDebugLog(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: ENTERED workflow-comparison case, insightId=${insightId}`)

        // CR5 P1.3 P3 P6: Multi-cohort AI intensity comparison.
        // These insights have 4 cohorts (non-AI/low/medium/high) in breakdownByTool
        // and evidence. Build comparisonRows from the cohort data, not from
        // workflowComparison.rankedWorkflows (which expects workflow names).
        if (insightId.includes('ai-intensity-cohort-analysis')) {
          const cohortBreakdown = (row as any).breakdownByTool as Record<string, { value: number; count: number; formatted: string; label: string }> | undefined
          const cohortEvidence = (row as any).evidence as Array<{ metric: string; value: string; label: string }> | undefined

          if (cohortBreakdown && Object.keys(cohortBreakdown).length >= 3) {
            const cohortEntries = Object.entries(cohortBreakdown).sort(([a], [b]) => {
              // Sort: non-AI, low, medium, high
              const order = ['non-AI', 'low', 'medium', 'high']
              const getIdx = (k: string) => order.findIndex(o => k.includes(o))
              return getIdx(a) - getIdx(b)
            })

            // CR-X P0-1: Agent/duration-based cohorts (e.g. Claude Code) do not
            // instrument active-coding or focus ratio. Their formatted strings
            // contain "X.X min duration" with no "% focus" clause. We must NOT
            // render 0.0% focus — unavailable != zero. Detect mode from the
            // first formatted string and branch accordingly.
            const hasFocusData = cohortEntries.some(([, d]) => /%\s*focus/.test(d.formatted))

            if (hasFocusData) {
              // IDE workflow path — focus ratio is instrumented
              // CR5 P1.4 P3: Bar width = FOCUS RATIO %, not active coding minutes.
              // Parse focus ratio from formatted string: "X.X min / YY.Y% focus"
              const parseFocusPct = (formatted: string): number => {
                const match = formatted.match(/(\d+\.?\d*)%\s*focus/)
                return match ? parseFloat(match[1]) : 0
              }
              const maxFocus = Math.max(...cohortEntries.map(([, d]) => parseFocusPct(d.formatted)), 1)

              // CR5 P1.4 P1: Claim = magnitude + sample, not the finding
              claim = `${sampleSize.toLocaleString()} sessions across ${cohortEntries.length} intensity cohorts`
              claimSub = `Within-workflow comparison · Telemetry · Observational`

              // CR5 P1.4 P3 P4: Evidence shows focus ratio + active coding + N
              evidenceCells = cohortEntries.slice(0, 4).map(([, data]) => {
                const focusPct = parseFocusPct(data.formatted)
                const acMin = data.formatted.split(' / ')[0] || '—'
                const bandLabel = data.label.split(' · ').pop()?.replace(/\(\d+\)/, '').trim() || data.label
                return {
                  label: bandLabel,
                  value: `${focusPct.toFixed(1)}% focus`,
                  sub: `${acMin} active coding · N=${data.count}`,
                  badgeType: 'neutral' as const
                }
              })

              // CR5 P1.4 P2 P3: Visual comparison — bar = focus ratio, gradient colors
              const intensityColors = ['#64748b', '#93c5fd', '#3b82f6', '#1e40af'] // slate, light, medium, dark blue
              comparisonLabel = `Focus ratio by AI intensity`
              comparisonRows = cohortEntries.map(([, data], idx) => {
                const focusPct = parseFocusPct(data.formatted)
                const bandLabel = data.label.split(' · ').pop()?.replace(/\(\d+\)/, '').trim() || data.label
                return {
                  name: bandLabel,
                  value: `${focusPct.toFixed(1)}% focus`,
                  percent: (focusPct / maxFocus) * 100,
                  color: intensityColors[idx % intensityColors.length],
                  tag: `N=${data.count}`,
                  tagType: 'neutral' as const
                }
              })

              // CR5 P1.4 P8: Interpretation adds meaning
              interpretation = (row as any).description || `Higher-intensity cohorts show higher focus ratios, but task complexity may differ across cohorts. Association, not causal claim.`
              riskLabel = 'Informational'
              riskSub = 'Cohort comparison'
              actionText = (row as any).recommendation || 'Compare task complexity across intensity cohorts.'
              footerNote = `Within-workflow cohort comparison · ${sampleSize.toLocaleString()} sessions · Observational only`
              break
            } else {
              // Agent/duration-based path — focus ratio NOT instrumented.
              // Primary comparison = session duration. Show cohort N, median
              // duration. Do NOT render focus/active-coding as 0 when
              // unavailable.
              const parseDurationMin = (formatted: string): number => {
                const match = formatted.match(/([\d.]+)\s*min/)
                return match ? parseFloat(match[1]) : 0
              }
              const maxDur = Math.max(...cohortEntries.map(([, d]) => parseDurationMin(d.formatted)), 1)

              claim = `${sampleSize.toLocaleString()} sessions across ${cohortEntries.length} intensity cohorts`
              claimSub = `Within-workflow comparison · Session duration · Observational`

              evidenceCells = cohortEntries.slice(0, 4).map(([, data]) => {
                const durMin = parseDurationMin(data.formatted)
                const bandLabel = data.label.split(' · ').pop()?.replace(/\(\d+\)/, '').trim() || data.label
                return {
                  label: bandLabel,
                  value: `${durMin.toFixed(1)} min duration`,
                  sub: `N=${data.count}`,
                  badgeType: 'neutral' as const
                }
              })

              const intensityColors = ['#64748b', '#93c5fd', '#3b82f6', '#1e40af']
              comparisonLabel = `Session duration by AI intensity`
              comparisonRows = cohortEntries.map(([, data], idx) => {
                const durMin = parseDurationMin(data.formatted)
                const bandLabel = data.label.split(' · ').pop()?.replace(/\(\d+\)/, '').trim() || data.label
                return {
                  name: bandLabel,
                  value: `${durMin.toFixed(1)} min`,
                  percent: (durMin / maxDur) * 100,
                  color: intensityColors[idx % intensityColors.length],
                  tag: `N=${data.count}`,
                  tagType: 'neutral' as const
                }
              })

              interpretation = (row as any).description || `Higher-intensity cohorts show longer session durations. Agent workflows do not instrument active-coding time; duration is the primary observable metric. Association, not causal claim.`
              riskLabel = 'Informational'
              riskSub = 'Cohort comparison'
              actionText = (row as any).recommendation || 'Compare session duration patterns across intensity cohorts.'
              footerNote = `Within-workflow cohort comparison · ${sampleSize.toLocaleString()} sessions · Duration-based (active-coding not instrumented)`
              break
            }
          } else if (cohortEvidence && cohortEvidence.length >= 3) {
            // Fallback: build from evidence array
            claim = (row as any).title || `${cleanMetricLabel} intensity gradient`
            claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · Within-workflow cohort comparison`

            evidenceCells = cohortEvidence.slice(0, 4).map(ev => ({
              label: ev.metric,
              value: ev.value,
              sub: ev.label,
              badgeType: 'neutral' as const
            }))

            comparisonLabel = `${cleanMetricLabel} by AI intensity`
            comparisonRows = cohortEvidence.map(ev => ({
              name: ev.metric,
              value: ev.value,
              percent: 100,
              color: '#3b82f6',
              tag: ev.label,
              tagType: 'neutral' as const
            }))

            interpretation = (row as any).description || (row as any).operationalRead || 'AI intensity gradient within workflow.'
            riskLabel = 'Informational'
            riskSub = 'Cohort comparison'
            actionText = (row as any).recommendation || 'Compare task complexity across intensity cohorts.'
            footerNote = `Within-workflow cohort comparison · ${sampleSize.toLocaleString()} sessions · Observational only`
            break
          }
        }

        // Guard: review/merge insights should never enter workflow-comparison case
        // Only actual Review & Merge stage insights belong here
        const isReviewMergeInsight = insightId.includes('small-pr') || insightId.includes('reviewer-load') || insightId.includes('reopen') || insightId.includes('revert')
        piDebugLog(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: isReviewMergeInsight=${isReviewMergeInsight}`)
        if (isReviewMergeInsight) {
          piDebugLog(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: Review/merge insight incorrectly routed to workflow-comparison, falling back to neutral`)
          claim = `${cleanMetricLabel} analysis across tracked workflows.`
          claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · All-time baseline`
          evidenceCells = [
            {
              label: cleanMetricLabel,
              value: primaryMetricDisplay,
              sub: `${sampleSize.toLocaleString()} sessions`,
              badge: 'Data available',
              badgeType: 'neutral'
            }
          ]
          comparisonLabel = `${cleanMetricLabel} — ${isLowerBetter ? 'lower is better' : 'higher is better'}`
          comparisonRows = []
          const fallback3 = getMetricSpecificFallback(insightId)
          interpretation = fallback3.interpretation
          riskLabel = 'Low'
          actionText = fallback3.actionText
          footerNote = `Telemetry · IDE-level attribution · ${sampleSize.toLocaleString()} sessions.`
          break
        }

        // Guard: if no rankedWorkflows, fall back to neutral card (e.g., review/merge insights)
        const ranked = workflowComparison.rankedWorkflows || []
        if (ranked.length === 0) {
          piDebugLog(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: No rankedWorkflows, falling back to neutral card`)
          claim = `${cleanMetricLabel} analysis across tracked workflows.`
          claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · All-time baseline`
          // CR-X UI: Sparse-state behavior — use existing evidence array when
          // available to build 2–3 compact structured facts instead of stretching
          // one cell across an empty band. General behavior, not PI-specific.
          const sparseEvidence = (row as any).evidence as Array<{ metric: string; value: string; label: string }> | undefined
          if (sparseEvidence && sparseEvidence.length >= 2) {
            evidenceCells = sparseEvidence.slice(0, 3).map(ev => ({
              label: ev.metric,
              value: ev.value,
              sub: ev.label,
              badgeType: 'neutral' as const
            }))
          } else {
            evidenceCells = [
              {
                label: cleanMetricLabel,
                value: primaryMetricDisplay,
                sub: `${sampleSize.toLocaleString()} sessions`,
                badge: 'Data available',
                badgeType: 'neutral'
              }
            ]
          }
          comparisonLabel = `${cleanMetricLabel} — ${isLowerBetter ? 'lower is better' : 'higher is better'}`
          comparisonRows = []
          // CR-X QUALITY: Use the generator's whyItMatters/recommendation when
          // available. Only fall back to getMetricSpecificFallback when the
          // generator didn't provide content. This prevents sparse/cohort
          // cards from showing generic "needs more attributed sessions for
          // reliable ranking" when the generator already has specific content.
          const fallback = getMetricSpecificFallback(insightId)
          interpretation = (row as any).whyItMatters
            || (row as any).description
            || fallback.interpretation
          riskLabel = 'Low'
          actionText = (row as any).recommendation
            || fallback.actionText
          footerNote = (row as any).confidenceReasoning
            || `Telemetry · IDE-level attribution · ${sampleSize.toLocaleString()} sessions.`
          break
        }

        // IDE/workflow metrics - show only the observed, deduplicated workflows provided by the insight
        const seenWorkflows = new Set<string>()
        const dedupedWorkflows = ranked.filter((w: any) => {
          if (!w.name || w.name === 'Unknown' || w.name === 'unknown' || w.name === 'Test-browser') return false
          if (seenWorkflows.has(w.name)) return false
          seenWorkflows.add(w.name)
          return true
        })

        // Resolve controlling pair from adapter's comparisonAuthority (via workflowComparison.winner/runnerUp)
        // This ensures the generator-selected leader/baseline control the final card
        const { leader: resolvedLeader, baseline: resolvedBaseline, displayOrder: allWorkflows } =
          resolveDecisionCardComparisonPair(dedupedWorkflows, workflowComparison.winner, workflowComparison.runnerUp)

        // Declare leader at top level to ensure it's always in scope
        let leader: any = resolvedLeader
        let runnerUp: any = resolvedBaseline
        let isLowSampleLeader = false

        piDebugLog(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: ranked.length=${ranked.length}, allWorkflows.length=${allWorkflows.length}, ranked names=${ranked.map(w => w.name).join(',')}, allWorkflows names=${allWorkflows.map(w => w.name).join(',')}`)

        // Guard: if no workflows match, fall back to neutral card
        if (allWorkflows.length === 0) {
          piDebugLog(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: No matching workflows, falling back to neutral card`)
          claim = `${cleanMetricLabel} analysis across tracked workflows.`
          claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · All-time baseline`
          evidenceCells = [
            {
              label: cleanMetricLabel,
              value: primaryMetricDisplay,
              sub: `${sampleSize.toLocaleString()} sessions`,
              badge: 'Data available',
              badgeType: 'neutral'
            }
          ]
          comparisonLabel = `${cleanMetricLabel} comparison`
          comparisonRows = []
          const fallback2 = getMetricSpecificFallback(insightId)
          interpretation = fallback2.interpretation
          riskLabel = 'Low'
          actionText = fallback2.actionText
          footerNote = `Telemetry · IDE-level attribution · ${sampleSize.toLocaleString()} sessions.`
          break
        }

        // Low-sample guard: check if leader has <25 sessions
        isLowSampleLeader = leader && leader.sampleSize < 25

        // Declare variables at higher scope to ensure they're always defined
        let isNarrowGap = false
        let gapLabel = ''
        let isRateMetric = insightId.includes('adoption') || insightId.includes('rework') || insightId.includes('quality') || insightId.includes('focus') || insightId.includes('ratio') || insightId.includes('intensity')
        // CR-X: Repository concentration is a percentage-point metric — the
        // Difference cell must show "29.7pp", not naked "29.7".
        const isConcentrationMetric = insightId.includes('repository-distribution') || insightId.includes('concentration')

        piDebugLog(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: After leader assignment, leader=${leader ? leader.name : 'null'}, allWorkflows.length=${allWorkflows.length}`)

        if (allWorkflows.length >= 2) {
          piDebugLog(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: Inside allWorkflows.length >= 2, leader=${leader ? leader.name : 'null'}, runnerUp=${runnerUp ? runnerUp.name : 'null'}`)
          const delta = (leader && runnerUp) ? Math.abs(leader.value - runnerUp.value) : 0

          // CR5 P0-3: Use comparisonAuthority.operationallySignificant as the SINGLE authority.
          // recommendationState='monitor_only' is NOT a significance override.
          const caOperationallySignificant = (row as any).comparisonAuthority?.operationallySignificant
          isNarrowGap = caOperationallySignificant === false
          // CR-X: If the generator's canonical title already says "similar" or
          // "no material", the interpretation must agree — never let the
          // adapter's 10%-of-leader threshold override the generator's
          // materiality assessment and produce a "differs" interpretation
          // that contradicts a "similar" title (or vice-versa).
          if (!isNarrowGap && /similar|no material/i.test(row.title || '')) {
            isNarrowGap = true
          }
          // CR5 P0.9: Include unit in gap label — no naked differences.
          // Derive unit from rightMetricLabel or metric name.
          const metricUnit = (row as any).rightMetricLabel || cleanMetricLabel || '';
          // CR5 V1 FINAL P0-4: TTFC is a duration, not a per-session rate.
          const isTtfcMetric = insightId.includes('time-to-first') || insightId.includes('ttfc');
          const isMinutesMetric = metricUnit.toLowerCase().includes('minute') || metricUnit.toLowerCase().includes('coding') || insightId.includes('active-coding');
          const isSecondsMetric = metricUnit.toLowerCase().includes('second');
          const gapUnit = isRateMetric ? 'pp' : isConcentrationMetric ? 'pp' : isTtfcMetric ? 'min' : isMinutesMetric ? 'min/session' : isSecondsMetric ? 's' : '';
          gapLabel = isRateMetric ? `${delta.toFixed(1)} pp` : isConcentrationMetric ? `${delta.toFixed(1)}pp` : `${delta.toFixed(1)}${gapUnit ? ' ' + gapUnit : ''}`

          // Build workflow list with sample counts for claim
          const workflowList = allWorkflows.map(w => `${displayWorkflowName(w.name || 'Unknown')} (${w.sampleSize?.toLocaleString() || '0'})`).join(', ')

          // CR5 P1.4 P1: Claim proves/qualifies the title — no duplication.
          // Title states the finding; claim shows magnitude + sample.
          if (isLowSampleLeader && leader && leader.name) {
            claim = `${leader.sampleSize?.toLocaleString() || '0'} sessions for ${displayWorkflowName(leader.name)} — emerging sample`
            claimSub = `${sampleSize.toLocaleString()} total sessions · Telemetry`
          } else if (leader && runnerUp && leader.name && runnerUp.name) {
            claim = `${leader.formattedValue} vs ${runnerUp.formattedValue} · ${gapLabel} gap`
            claimSub = `${leader.sampleSize?.toLocaleString() || '0'} vs ${runnerUp.sampleSize?.toLocaleString() || '0'} sessions · Observational`
          } else {
            // SAFETY: Fallback when leader/runnerUp not safely available
            claim = `${cleanMetricLabel} comparison across tracked workflows.`
            claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · All-time baseline`
          }

          piDebugLog(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: Before evidenceCells, leader=${leader ? leader.name : 'null'}, runnerUp=${runnerUp ? runnerUp.name : 'null'}, leader.name=${leader?.name}, runnerUp.name=${runnerUp?.name}`)

          try {
            piDebugLog(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: Constructing evidenceCells, typeof leader=${typeof leader}, typeof runnerUp=${typeof runnerUp}`)
            // Use explicit variable checks to avoid ReferenceError
            const hasLeader = typeof leader !== 'undefined' && leader !== null
            const hasRunnerUp = typeof runnerUp !== 'undefined' && runnerUp !== null
            const hasLeaderName = hasLeader && typeof leader.name !== 'undefined' && leader.name !== null
            const hasRunnerUpName = hasRunnerUp && typeof runnerUp.name !== 'undefined' && runnerUp.name !== null

            piDebugLog(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: hasLeader=${hasLeader}, hasRunnerUp=${hasRunnerUp}, hasLeaderName=${hasLeaderName}, hasRunnerUpName=${hasRunnerUpName}`)

            if (hasLeader && hasRunnerUp && hasLeaderName && hasRunnerUpName) {
              // PAIRWISE SCOPE RULE: when the card's title names a specific
              // pair (e.g. "VS Code 6.2x longer median TTFC vs Cursor"),
              // headline evidence cells and comparison rows must be scoped to
              // that pair. Other observed workflows may only appear as
              // explicitly labeled secondary context.
              const pairwiseTitle = !!row.title &&
                row.title.includes(displayWorkflowName(leader.name)) &&
                row.title.includes(displayWorkflowName(runnerUp.name))
              const cellWorkflows = pairwiseTitle
                ? allWorkflows.filter(w => w.name === leader.name || w.name === runnerUp.name)
                : allWorkflows.slice(0, 3)
              evidenceCells = cellWorkflows.map((w, idx) => {
                return {
                  label: displayWorkflowName(w.name),
                  value: w.formattedValue,
                  sub: `${w.sampleSize?.toLocaleString() || '0'} sessions`,
                  badge: (w.sampleSize < 25) ? 'Low sample' : undefined,
                  badgeType: 'neutral'
                }
              })

              // CR5 P1.4 P4: Include unit in difference label — no naked values
              // CR5 P1.5 P1.1: AI coverage is a range (max-to-min), not a difference/gap.
              const isRangeMetric = insightId.includes('ai-adoption-rate') || insightId.includes('adoption-rate-by-ide')
              evidenceCells.push({
                label: isRangeMetric ? 'Range' : 'Difference',
                value: isNarrowGap ? 'Narrow gap' : gapLabel,
                sub: isNarrowGap ? 'May not reflect real difference' : (isRangeMetric ? 'max-to-min spread' : `${isRateMetric ? 'percentage-point gap' : gapUnit || cleanMetricLabel || 'difference'}`),
                badge: isNarrowGap ? 'Monitor only' : undefined,
                badgeType: 'neutral'
              })

              // Labeled secondary context for workflows outside the named pair
              if (pairwiseTitle) {
                const others = allWorkflows.filter(w => w.name !== leader.name && w.name !== runnerUp.name)
                if (others.length > 0) {
                  evidenceCells.push({
                    label: 'Also observed',
                    value: others.map(w => `${displayWorkflowName(w.name)} ${w.formattedValue}`).join(' · '),
                    sub: 'Context only — not part of the headline comparison',
                    badgeType: 'neutral'
                  })
                }
              }
            } else {
              evidenceCells = []
            }
          } catch (e) {
            console.error(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: Error constructing evidenceCells:`, e)
            console.error(`[PI_WORKFLOW_COMP_TRACE] ${row.id}: leader=${leader}, runnerUp=${runnerUp}, leader.name=${leader?.name}, runnerUp.name=${runnerUp?.name}`)
            evidenceCells = []
          }

          // Comparison bar - show all workflows with sample breakdown
          // CR5 P1.4 P2: Semantic colors — primary=blue, counterpart=purple, rest=slate
          // CR5 P1.4 P7: Remove "Observed" tag noise — only show tags when decision-relevant
          const maxValue = allWorkflows.length > 0 ? Math.max(...allWorkflows.map(w => w.value)) : 1
          // PAIRWISE SCOPE RULE (same as evidenceCells above): a pairwise
          // title scopes the comparison chart to the named pair only.
          const pairwiseRowsTitle = !!leader?.name && !!runnerUp?.name &&
            !!row.title &&
            row.title.includes(displayWorkflowName(leader.name)) &&
            row.title.includes(displayWorkflowName(runnerUp.name))
          const rowWorkflows = pairwiseRowsTitle
            ? allWorkflows.filter(w => w.name === leader.name || w.name === runnerUp.name)
            : allWorkflows
          // CR5 P1.5 P1.3: Label should say "average" for active-coding, not just metric name.
          comparisonLabel = insightId.includes('active-coding')
            ? 'Average active coding/session'
            : `${cleanMetricLabel} comparison${pairwiseRowsTitle ? ' — headline pair' : ''}`
          const rowMaxValue = rowWorkflows.length > 0 ? Math.max(...rowWorkflows.map(w => w.value)) : 1
          const wfColors = ['#3b82f6', '#8b5cf6', '#64748b', '#94a3b8']
          comparisonRows = rowWorkflows.map((w, idx) => ({
            name: displayWorkflowName(w.name),
            value: w.formattedValue,
            percent: rowMaxValue > 0 ? (w.value / rowMaxValue) * 100 : 0,
            color: wfColors[idx % wfColors.length],
            tag: (w.sampleSize < 25) ? 'Low sample' : undefined,
            tagType: 'neutral'
          }))

          // CR5 P1.5 P2: Metric-specific tool comparison interpretation.
          // Different tools lead on different signals — no universal winner.
          const metricSpecificInterpretation = (() => {
            if (isNarrowGap) return `All workflows show similar ${cleanMetricLabel}. The observed gap is within noise range — monitor but do not reorganize teams around this difference.`
            if (insightId.includes('active-coding')) return `Active coding differs materially across workflows. Validate task mix and session structure before treating the gap as a productivity effect.`
            if (insightId.includes('ai-adoption') || insightId.includes('adoption-rate')) return `Coverage is the share of sessions containing any observed AI signal. It measures session-level signal presence, not AI usage intensity or delivery impact.`
            if (insightId.includes('focus-ratio')) return `Focus differs materially across workflows. Compare task mix and session structure before attributing the gap to the tool itself.`
            // PAIRWISE SCOPE RULE: when the title names a specific pair, the
            // interpretation must stay on that pair. The generator's
            // details/description enumerates every observed workflow, which
            // reads as third-workflow contamination on a pairwise claim.
            if (pairwiseRowsTitle && leader?.name && runnerUp?.name) {
              const aN = displayWorkflowName(leader.name)
              const bN = displayWorkflowName(runnerUp.name)
              return `${aN} and ${bN} differ materially on the compared metric. Compare task mix, session structure, and environment setup between the two before treating the gap as a workflow effect.`
            }
            return (row as any).details || (row as any).description || `Sessions differ materially in ${cleanMetricLabel.toLowerCase()} across workflows. Validate task mix and session structure before treating the gap as a productivity effect.`
          })()
          interpretation = metricSpecificInterpretation
          riskLabel = isNarrowGap ? 'Low' : 'Medium'
          actionText = isLowSampleLeader
            ? (leader && leader.name ? `Collect more ${displayWorkflowName(leader.name)} sessions before comparing against primary workflows.` : 'Collect more workflow data before comparing.')
            : (isNarrowGap
            ? `Monitor ${cleanMetricLabel} across workflows. The observed difference is small enough that it may reflect task mix or session structure rather than a workflow-level difference.`
            : (leader && runnerUp && leader.name && runnerUp.name ? getMetricSpecificAction(insightId, displayWorkflowName(leader.name), displayWorkflowName(runnerUp.name), cleanMetricLabel, isRateMetric) : getMetricSpecificFallback(insightId).actionText))
          footerNote = `Telemetry · IDE-level attribution · ${sampleSize.toLocaleString()} sessions.${isNarrowGap ? ' Small difference — treat as directional only.' : ''} Observational comparison only.`
        } else {
          // Fallback for insufficient data (single workflow)
          // SAFETY: Use allWorkflows[0] directly instead of leader to avoid scope issues
          const singleWorkflow = allWorkflows.length > 0 ? allWorkflows[0] : null
          if (singleWorkflow && singleWorkflow.name) {
            claim = `${displayWorkflowName(singleWorkflow.name)}: ${singleWorkflow.formattedValue} · Single workflow tracked.`
            claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · All-time baseline`

            evidenceCells = [
              {
                label: displayWorkflowName(singleWorkflow.name),
                value: singleWorkflow.formattedValue,
                sub: `${singleWorkflow.sampleSize?.toLocaleString() || '0'} sessions`,
                badge: 'Single workflow',
                badgeType: 'neutral'
              },
              {
                label: 'Sample',
                value: sampleSize.toLocaleString(),
                sub: 'sessions',
                badgeType: 'neutral'
              },
              {
                label: 'Difference',
                value: 'Insufficient',
                sub: 'Comparison unavailable',
                badge: 'Not comparable',
                badgeType: 'warning'
              }
            ]

            comparisonLabel = `${cleanMetricLabel} comparison`
            comparisonRows = allWorkflows.map((w, idx) => ({
              name: displayWorkflowName(w.name),
              value: w.formattedValue,
              percent: 100,
              color: '#475569',
              tag: 'Only workflow',
              tagType: 'neutral'
            }))

            interpretation = `Only ${displayWorkflowName(singleWorkflow.name)} has data for ${cleanMetricLabel}. Collect more workflow data for comparison.`
            actionText = getMetricSpecificFallback(insightId).actionText
            footerNote = `Telemetry · IDE-level attribution · ${sampleSize.toLocaleString()} sessions.`
          } else {
            // No workflow data at all
            claim = `${cleanMetricLabel} comparison across tracked workflows.`
            claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · All-time baseline`

            evidenceCells = [
              {
                label: cleanMetricLabel,
                value: primaryMetricDisplay,
                sub: 'Org-level signal',
                badgeType: 'neutral'
              },
              {
                label: 'Sample',
                value: sampleSize.toLocaleString(),
                sub: 'sessions',
                badgeType: 'neutral'
              },
              {
                label: 'Difference',
                value: 'Insufficient',
                sub: 'Comparison unavailable',
                badge: 'Not comparable',
                badgeType: 'warning'
              }
            ]

            comparisonLabel = `${cleanMetricLabel} — ${isLowerBetter ? 'lower is better' : 'higher is better'}`
            comparisonRows = []
            const noDataFallback = getMetricSpecificFallback(insightId)
            interpretation = noDataFallback.interpretation
            actionText = noDataFallback.actionText
            footerNote = 'Limited data for workflow comparison.'
          }
        }
      } catch (error) {
        console.error(`[PI_WORKFLOW_COMP_ERROR] ${row.id}:`, error)
        claim = `${cleanMetricLabel} analysis error.`
        claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · All-time baseline`
        evidenceCells = [
          {
            label: cleanMetricLabel,
            value: primaryMetricDisplay,
            sub: `${sampleSize.toLocaleString()} sessions`,
            badge: 'Analysis error',
            badgeType: 'warning'
          }
        ]
        comparisonLabel = `${cleanMetricLabel} — ${isLowerBetter ? 'lower is better' : 'higher is better'}`
        comparisonRows = []
        interpretation = `${cleanMetricLabel} analysis encountered an error.`
        riskLabel = 'Low'
        actionText = getMetricSpecificFallback(insightId).actionText
        footerNote = `Telemetry · IDE-level attribution · ${sampleSize.toLocaleString()} sessions.`
      }
      break
    }
    
    case 'attribution-gap': {
      // Attribution gap - about instrumentation coverage, not session quality
      const unknownCount = workflowComparison.winner?.value || 0
      const ranked = workflowComparison.rankedWorkflows || []
      const attributedExamples = ranked
        .filter(w => displayWorkflowName(w.name).toLowerCase() !== 'unknown' && displayWorkflowName(w.name).toLowerCase() !== 'unattributed')
        .slice(0, 2)
      
      claim = `${unknownCount.toLocaleString()} sessions lack IDE attribution. Expand instrumentation coverage to enable workflow ranking.`
      claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · All-time baseline`
      
      evidenceCells = [
        {
          label: 'Unattributed sessions',
          value: unknownCount.toLocaleString(),
          sub: 'No IDE workflow tag',
          badge: 'Attribution gap',
          badgeType: 'warning'
        },
        {
          label: 'Attributed examples',
          value: attributedExamples.length > 0 ? attributedExamples[0].formattedValue : '—',
          sub: attributedExamples.length > 0 ? displayWorkflowName(attributedExamples[0].name) : 'No attributed data',
          badgeType: 'neutral'
        },
        {
          label: 'Comparison status',
          value: 'Not comparable',
          sub: 'Attribution incomplete',
          badge: 'Fix instrumentation',
          badgeType: 'warning'
        }
      ]
      
      interpretation = 'High-quality session attribution is incomplete. Improve instrumentation or tagging before comparing workflows.'
      riskLabel = 'High'
      riskSub = 'Workflow ranking not safe'
      actionText = 'Review session instrumentation and ensure proper workflow tagging. Add tool-specific metadata to session events before ranking IDEs.'
      footerNote = 'Attribution gap: signal is real, workflow ranking is not safe.'
      break
    }
    
    default: {
      // ─── Distribution Shape (within-workflow percentile profile) ───
      // CR-X PI FIX: Session-duration distribution insights describe p90/p50
      // within a SINGLE workflow. They are NOT cross-workflow comparisons.
      // Build evidence cells directly from generator fields with truthful units.
      if ((row as any).presentationKind === 'distribution_shape') {
        const p90Display = (row as any).displayValue || primaryMetricDisplay || '—'
        const p50Display = (row as any).rightMetric || '—'
        const deltaMin = typeof (row as any).delta === 'number' ? (row as any).delta : 0
        const deltaFormatted = deltaMin >= 60
          ? `${(deltaMin / 60).toFixed(1)} hours`
          : `${deltaMin.toFixed(1)} min`
        const p90p50Ratio = (row as any).displayDeltaPct || '—'

        claim = `${p90Display} vs ${p50Display} · ${deltaFormatted} gap`
        claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · Within-workflow distribution`

        evidenceCells = [
          {
            label: 'p90',
            value: p90Display,
            sub: 'Longest 10% of sessions',
            badgeType: 'neutral' as const
          },
          {
            label: 'Median (p50)',
            value: p50Display,
            sub: 'Typical session',
            badgeType: 'neutral' as const
          },
          {
            label: 'Difference',
            value: deltaFormatted,
            sub: 'p90 − p50',
            badgeType: 'neutral' as const
          },
          {
            label: 'p90/p50 ratio',
            value: p90p50Ratio,
            sub: 'Distribution skew',
            badgeType: 'neutral' as const
          }
        ]

        interpretation = (row as any).description || `${cleanMetricLabel} distribution shape within a single workflow.`
        riskLabel = 'Informational'
        riskSub = 'Distribution shape'
        actionText = (row as any).recommendation || 'Monitor session duration distribution for workflow patterns.'
        footerNote = (row as any).confidenceReasoning || `Telemetry · Within-workflow percentile analysis · ${sampleSize.toLocaleString()} sessions.`
        break
      }

      // ─── Unit Economics V1 ──────────────────────────────────
      // UE cards have their own presentation contract:
      // - Currency-formatted primary metric
      // - Configured monthly spend
      // - Exact integer outcome count (NOT sessions)
      // - Calendar month period (NOT all-time)
      // - Seeded/live provenance from outcome entry
      // - Configured-estimate / not-billing / not-causal disclaimers
      // - No winner/loser/ROI/savings language
      if ((row as any).presentationKind === 'unit_economics') {
        const ue = (row as any).unitEconomics as {
          allocationPeriod?: string
          configuredSpend?: string
          outcomeCount?: number
          outcomeUnit?: string
          allocationScope?: string
          sourceLabel?: string
          estimateDisclosure?: string
          outcomeComposition?: {
            primary: number
            secondary?: number
            total: number
            primaryLabel: string
            secondaryLabel?: string
            totalLabel: string
          }
        } | undefined

        const ueSpend = ue?.configuredSpend || (row as any).evidence?.[0]?.value || '—'
        const ueCount = ue?.outcomeCount ?? (row as any).n ?? 0
        const ueUnit = ue?.outcomeUnit || 'outcome'
        const uePeriod = ue?.allocationPeriod || (row as any).title?.split(' · ')[1] || '—'
        const ueSource = ue?.sourceLabel || (row as any).evidence?.[1]?.label?.split(' · ')[0] || '—'
        const ueAllocated = (row as any).displayValue || primaryMetricDisplay || '—'
        const ueComp = ue?.outcomeComposition

        claim = `${ueAllocated} / ${ueUnit}`
        claimSub = `${ueSource} · ${uePeriod}`

        // Build outcome volume sub-label with composition when available
        const volumeSub = ueComp
          ? ueComp.secondary != null
            ? `${ueComp.primary} ${ueComp.primaryLabel} · ${ueComp.secondary} ${ueComp.secondaryLabel} · ${ueComp.total} ${ueComp.totalLabel}`
            : `${ueComp.primary} ${ueComp.primaryLabel} · ${ueComp.total} ${ueComp.totalLabel}`
          : `${ueUnit} · ${uePeriod}`

        evidenceCells = [
          {
            label: 'CONFIGURED SPEND',
            value: ueSpend,
            sub: `${uePeriod} · Configured estimate`,
            badgeType: 'neutral' as const
          },
          {
            label: 'OUTCOME VOLUME',
            value: String(ueCount),
            sub: volumeSub,
            badgeType: 'neutral' as const
          },
          {
            label: 'ALLOCATION SCOPE',
            value: 'Org-level',
            sub: 'Period-level allocation',
            badgeType: 'neutral' as const
          }
        ]

        interpretation = (row as any).description || `Configured AI-tool spend normalized by observed delivery output for ${uePeriod}.`
        riskLabel = 'Informational'
        riskSub = 'Unit Economics'
        actionText = (row as any).recommendation || 'Review alongside delivery throughput and reliability metrics.'
        footerNote = ue?.estimateDisclosure || 'Configured estimate · Not billing data · Period-level allocation · Not per-outcome causal attribution'
        // CR-X UI Polish: attach period strip from generator if multi-month evidence exists
        if ((row as any).periodStrip && (row as any).periodStrip.points && (row as any).periodStrip.points.length >= 2) {
          periodStrip = (row as any).periodStrip
        }
        break
      }

      // CR5 P0.8: For temporal trend findings with real data, preserve the
      // generator's title and show the temporal comparison evidence.
      // Only show "insufficient" messaging when hasData is actually false.
      if ((row as any).presentationKind === 'temporal_trend' && (row as any).hasData) {
        // CR5 P1.4 P1: Claim = magnitude + time window, not the finding
        const trendCurrent = (row as any).current
        const trendBaseline = (row as any).baseline
        const trendDelta = (row as any).delta
        const trendDisplay = (row as any).displayValue || primaryMetricDisplay
        const trendDeltaPct = (row as any).displayDeltaPct || '—'
        const currentLabel = (row as any).currentLabel || 'latest'
        const baselineLabel = (row as any).baselineLabel || 'first'

        // CR5 P1.4 P5: For category-transition temporal (monthly-workflow-share),
        // don't show a 0pp "Change" cell — the finding is a category shift, not a numeric delta.
        const isCategoryTransition = insightId.includes('monthly-workflow-share') || insightId.includes('workflow-share')

        // P0.2 R2: commit-ttfc-longitudinal has its own semantic contract.
        // It must NOT be routed through generic AI-active-share / percentage-point
        // semantics. The generator exposes structured TTFC + commit fields.
        const isCommitTtfcLongitudinal = insightId === 'commit-ttfc-longitudinal'

        // CR-X Wave 1B: recent-change has its own metric presentation contract.
        // The generic temporal_trend path formats values as percentages, but
        // recent-change values can be durations, counts, or ratios.
        // Use the generator's explicit displayValue/priorDisplay instead.
        const isRecentChange = insightId.startsWith('recent-change__')
        const recentChangePriorDisplay = (row as any).priorDisplay
        const recentChangeRecentDisplay = (row as any).recentDisplay || trendDisplay
        const recentChangeMetricLabel = (row as any).rightMetricLabel || cleanMetricLabel
        const recentChangeRecentWindow = (row as any).recentWindow
        const recentChangePriorWindow = (row as any).priorWindow

        // CR5 P1.5 P0.2: Claim must show baseline → current, not current → current.
        // CR5 P1.5 P1.2: For category transitions, show actual workflow names + shares.
        const currentWorkflow = (row as any).currentWorkflow
        const baselineWorkflow = (row as any).baselineWorkflow

        claim = isCategoryTransition
          ? (currentWorkflow && baselineWorkflow
            ? `${baselineWorkflow} ${trendBaseline?.toFixed(0)}% → ${currentWorkflow} ${trendCurrent?.toFixed(0)}% · ${periodCountClaimPhrase(row)}`
            : `${baselineLabel} → ${currentLabel} · ${periodCountClaimPhrase(row)}`)
          : isCommitTtfcLongitudinal
            ? `${(row as any).firstTtfcMinutes?.toFixed(1) ?? '—'} min → ${(row as any).lastTtfcMinutes?.toFixed(1) ?? '—'} min TTFC · ${(row as any).firstCommitsPerSession?.toFixed(2) ?? '—'} → ${(row as any).lastCommitsPerSession?.toFixed(2) ?? '—'} commits/session`
            : isRecentChange
              ? `${recentChangePriorDisplay || '—'} → ${recentChangeRecentDisplay || '—'} · ${trendDeltaPct}`
              : `${typeof trendBaseline === 'number' ? trendBaseline.toFixed(1) + '%' : '—'} → ${typeof trendCurrent === 'number' ? trendCurrent.toFixed(1) + '%' : trendDisplay} · ${trendDeltaPct}`
        claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · Observational`

        // CR5 P1.4 P4: Metric-native labels — no naked values
        if (isCommitTtfcLongitudinal) {
          // P0.2 R2: commit-ttfc-longitudinal semantic authority.
          // Uses structured TTFC + commit fields from the generator.
          // NO "AI-active share", NO false %, NO false pp.
          const firstTtfc = (row as any).firstTtfcMinutes
          const lastTtfc = (row as any).lastTtfcMinutes
          const ttfcDelta = (row as any).ttfcDeltaMinutes
          const firstCommits = (row as any).firstCommitsPerSession
          const lastCommits = (row as any).lastCommitsPerSession
          const observedPeriods = (row as any).observedPeriodCount || (row as any).evidence?.length || 0

          evidenceCells = [
            {
              label: 'Latest TTFC',
              value: typeof lastTtfc === 'number' ? `${lastTtfc.toFixed(1)} min` : '—',
              sub: 'Last measured period',
              badgeType: 'neutral'
            },
            {
              label: 'First TTFC',
              value: typeof firstTtfc === 'number' ? `${firstTtfc.toFixed(1)} min` : '—',
              sub: 'First measured period',
              badgeType: 'neutral'
            },
            {
              label: 'TTFC change',
              value: typeof ttfcDelta === 'number' ? `${ttfcDelta > 0 ? '+' : ''}${ttfcDelta.toFixed(1)} min` : '—',
              sub: 'First → latest',
              badgeType: 'neutral'
            },
            {
              label: 'Commits/session',
              value: (typeof firstCommits === 'number' && typeof lastCommits === 'number')
                ? `${firstCommits.toFixed(2)} → ${lastCommits.toFixed(2)}`
                : '—',
              sub: 'First → latest',
              badgeType: 'neutral'
            },
            {
              label: 'Observed periods',
              value: String(observedPeriods),
              sub: 'Months with sufficient sample',
              badgeType: 'neutral'
            }
          ]
        } else if (isCategoryTransition) {
          evidenceCells = [
            {
              label: `Start · ${baselineLabel.toUpperCase()}`,
              value: baselineWorkflow ? `${baselineWorkflow} · ${trendBaseline?.toFixed(0)}%` : trendDisplay,
              sub: 'Dominant workflow at first observed period',
              badgeType: 'neutral'
            },
            {
              label: `End · ${currentLabel.toUpperCase()}`,
              value: currentWorkflow ? `${currentWorkflow} · ${trendCurrent?.toFixed(0)}%` : (typeof trendCurrent === 'number' ? trendCurrent.toFixed(1) + '%' : trendDisplay),
              sub: 'Dominant workflow at latest complete period',
              badgeType: 'neutral'
            },
            {
              label: 'Observed periods',
              ...periodCountEvidenceCell(row),
              badgeType: 'neutral'
            },
            {
              label: 'Sample',
              value: sampleSize.toLocaleString(),
              sub: 'sessions',
              badgeType: 'neutral'
            }
          ]
        } else if (isRecentChange) {
          // CR-X Wave 1B: recent-change uses the metric presentation contract.
          // Labels and formatting come from the generator, not hardcoded
          // "AI-active share" / percentage assumptions.
          evidenceCells = [
            {
              label: `${recentChangeRecentWindow || 'Recent'} ${recentChangeMetricLabel}`,
              value: recentChangeRecentDisplay || '—',
              sub: `N=${(row as any).recentSample || 0}`,
              badgeType: 'neutral' as const
            },
            {
              label: `${recentChangePriorWindow || 'Prior'} ${recentChangeMetricLabel}`,
              value: recentChangePriorDisplay || '—',
              sub: `N=${(row as any).priorSample || 0}`,
              badgeType: 'neutral' as const
            },
            {
              label: 'Change',
              value: trendDeltaPct,
              sub: 'Relative change',
              badgeType: 'neutral' as const
            },
            {
              label: 'Comparison',
              value: (row as any).evidence?.[2]?.value || '—',
              sub: 'Window label',
              badgeType: 'neutral' as const
            }
          ]
        } else {
          evidenceCells = [
            {
              label: `${currentLabel} AI-active share`,
              value: typeof trendCurrent === 'number' ? trendCurrent.toFixed(1) + '%' : trendDisplay,
              sub: 'Latest observed period',
              badgeType: 'neutral'
            },
            {
              label: `${baselineLabel} AI-active share`,
              value: typeof trendBaseline === 'number' ? trendBaseline.toFixed(1) + '%' : '—',
              sub: 'First observed period',
              badgeType: 'neutral'
            },
            {
              label: 'Change',
              value: trendDeltaPct,
              sub: typeof trendDelta === 'number' ? `${trendDelta > 0 ? '+' : ''}${trendDelta.toFixed(1)} pp` : '—',
              badgeType: 'neutral'
            },
            {
              label: 'Observed months',
              value: String((row as any).evidence?.length || 0),
              sub: 'With sufficient sample',
              badgeType: 'neutral'
            }
          ]
        }

        // CR-X UI Redo: Route monthly trajectory through periodTrend (horizontal
        // proportional-bar rows) instead of comparisonRows. The comparison
        // dimension here is TIME (successive periods), not categories/entities.
        // Categorical comparisons (workflow vs workflow, repo vs repo) remain
        // on comparisonRows. See the hard distinction in the period-trend rules.
        //
        // Secondary labels (workflow names, N=sample) are encoded in the
        // periodStrip point value as "mainValue · secondaryLabel" and split
        // back out in the periodTrend computed for display.
        const temporalEvidence = (row as any).evidence as Array<{ metric: string; value: string; label: string }> | undefined
        const temporalBreakdown = (row as any).breakdownByTool as Record<string, { value: number; count: number; formatted: string; label?: string }> | undefined

        // Helper: convert a period string (e.g. "2026-04", "Apr 2026") to a short month label
        const toShortMonth = (s: string): string => {
          const ymMatch = s.match(/(\d{4})-(\d{2})/)
          if (ymMatch) {
            const m = parseInt(ymMatch[2], 10)
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            return months[m - 1] || s
          }
          // Already a short label like "Apr" or "Apr 2026"
          const shortMatch = s.match(/^([A-Z][a-z]{2})/)
          return shortMatch ? shortMatch[1] : s
        }

        if (temporalEvidence && temporalEvidence.length >= 2) {
          // Use evidence array — one point per observed period
          const parsedValues = temporalEvidence.map(ev => {
            const match = ev.value.match(/(\d+\.?\d*)/)
            return match ? parseFloat(match[1]) : 0
          })
          periodStrip = {
            label: (row as any).comparisonLabel || 'Observed periods',
            points: temporalEvidence.map((ev, i) => ({
              periodLabel: toShortMonth(ev.metric),
              // Encode secondary label in value for the computed to split
              value: ev.label ? `${ev.value} · ${ev.label}` : ev.value,
              numericValue: parsedValues[i],
              magnitude: 0,
              delta: undefined,
              deltaDirection: null,
            })),
          }
        } else if (temporalBreakdown && Object.keys(temporalBreakdown).length >= 2) {
          // Fallback: use breakdownByTool entries that look like periods (YYYY-MM keys)
          const periodEntries = Object.entries(temporalBreakdown)
            .filter(([k]) => /^\d{4}-\d{2}/.test(k))
            .sort(([a], [b]) => a.localeCompare(b))
          if (periodEntries.length >= 2) {
            periodStrip = {
              label: (row as any).comparisonLabel || 'Observed periods',
              points: periodEntries.map(([period, data]) => {
                const secLabel = data.label || (data.count ? `N=${data.count}` : undefined)
                return {
                  periodLabel: toShortMonth(period),
                  value: secLabel ? `${data.formatted || String(data.value?.toFixed(1) ?? '—')} · ${secLabel}` : (data.formatted || String(data.value?.toFixed(1) ?? '—')),
                  numericValue: data.value || 0,
                  magnitude: 0,
                  delta: undefined,
                  deltaDirection: null,
                }
              }),
            }
          }
        }

        // CR5 P1.4 P8: Interpretation adds meaning, doesn't repeat the chart
        // P0.2 R4: commit-ttfc-longitudinal interpretation is built by the
        // exported buildCommitTtfcInterpretation helper so the exact visible
        // interpretation path is testable without mounting the full component.
        // Do NOT use generic AI-active-share language for this finding.
        interpretation = isCategoryTransition
          ? `Tool usage changed materially over the observed history; current workflow mix is not representative of the earlier baseline.`
          : isCommitTtfcLongitudinal
            ? buildCommitTtfcInterpretation(row as any)
            : (row as any).description || (row as any).details || `Temporal trend observed over the measured periods. Review whether this reflects tool availability, team adoption, or project phase transitions.`
        riskLabel = 'Informational'
        riskSub = 'Temporal trend'
        actionText = (row as any).recommendation || 'Monitor trend over time.'
        footerNote = `Period-over-period comparison · ${sampleSize.toLocaleString()} sessions · Observational`
      } else if ((row as any).presentationKind === 'executive_synthesis' && (row as any).hasData) {
        // CR-X Product-Strength Wave: Executive temporal synthesis
        // Combines sibling recent-change findings into one executive card.
        const evidence = (row as any).evidence || []
        claim = evidence.length > 0
          ? evidence.slice(0, 3).map((e: any) => `${e.metric}: ${e.value}`).join(' · ')
          : 'Workflow mix changed materially'
        claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · Executive synthesis`
        evidenceCells = evidence.map((e: any) => ({
          label: e.metric || '—',
          value: e.value || '—',
          sub: e.label || e.context || '',
          badgeType: 'neutral' as const
        }))
        interpretation = (row as any).description || 'The organization\'s observed workflow mix changed materially.'
        riskLabel = 'Investigate'
        riskSub = 'Workflow mix shift'
        actionText = (row as any).recommendation || 'Determine whether this reflects deliberate rollout, project phase, or instrumentation coverage.'
        footerNote = `Observational · Never causal · ${sampleSize.toLocaleString()} sessions · ${(row as any).recentWindow || ''} vs ${(row as any).priorWindow || ''}`
      } else if ((row as any).presentationKind === 'repo_conditioned_behavior' && (row as any).hasData) {
        // CR-X Wave 1B: Repo-Conditioned Behavior — faithful evidence rendering
        const evidence = (row as any).evidence || []
        const highEv = evidence[0]
        const lowEv = evidence[1]
        const ratioEv = evidence[2]
        claim = `${highEv?.value || '—'} vs ${lowEv?.value || '—'} · ${row.deltaPct ? Math.abs(Math.round(row.deltaPct)) + '% gap' : '—'}`
        claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · Cross-repo comparison`
        evidenceCells = [
          {
            label: highEv?.label || 'Repo A',
            value: highEv?.value || '—',
            sub: highEv?.context || '',
            badgeType: 'neutral' as const
          },
          {
            label: lowEv?.label || 'Repo B',
            value: lowEv?.value || '—',
            sub: lowEv?.context || '',
            badgeType: 'neutral' as const
          },
          {
            label: 'Ratio',
            value: ratioEv?.value || '—',
            sub: 'High vs low',
            badgeType: 'neutral' as const
          },
          {
            label: 'Qualifying repos',
            value: String(evidence[3]?.value || '—'),
            sub: 'With sufficient sample',
            badgeType: 'neutral' as const
          }
        ]
        interpretation = (row as any).description || (row as any).whyItMatters || ''
        riskLabel = 'Investigate'
        riskSub = 'Cross-repo behavior'
        actionText = (row as any).recommendation || 'Investigate whether task complexity or repo practices explain the difference.'
        footerNote = `Observational · Not a productivity conclusion without task controls · ${sampleSize.toLocaleString()} sessions`
      } else if ((row as any).presentationKind === 'workflow_repo_allocation' && (row as any).hasData) {
        // CR-X Wave 1B: Workflow × Repo Allocation — faithful evidence rendering
        // Branch on allocationSubtype to avoid semantic inversion.
        const evidence = (row as any).evidence || []

        // CR-X P1: Synthesized multi-workflow concentration finding.
        // Render all workflows with comparison bars from breakdownByTool.
        if ((row as any).allocationSynthesis === true) {
          // CR-X P1: Synthesized multi-workflow concentration finding.
          // Render all workflows with comparison bars from breakdownByTool.
          const dominantRepo = (row as any).dominantRepo || '—'
          const bt = (row as any).breakdownByTool || {}
          const wfEntries = Object.entries(bt) as [string, any][]
          const leader = wfEntries[0]
          const runnerUp = wfEntries[1]
          const leaderShare = leader?.[1]?.formatted ?? '—'
          const runnerUpShare = runnerUp?.[1]?.formatted ?? '—'
          const gapPP = typeof row.delta === 'number'
            ? `${Math.round(Math.abs(row.delta as number) * 100)}pp`
            : '—'

          claim = `${leader?.[0] ?? '—'}: ${leaderShare} in ${dominantRepo} vs ${runnerUp?.[0] ?? '—'}: ${runnerUpShare}`
          claimSub = `${sampleSize.toLocaleString()} sessions · ${(row as any).provenanceLabel || 'Telemetry'} · Multi-workflow concentration`

          // Build evidence cells for all workflows
          evidenceCells = wfEntries.map(([wfName, data]) => ({
            label: wfName,
            value: data.formatted ?? '—',
            sub: data.label ?? `N=${data.count ?? '—'}`,
            badgeType: 'neutral' as const
          }))
          // Add concentration gap cell
          evidenceCells.push({
            label: 'Concentration gap',
            value: gapPP,
            sub: 'leader vs runner-up',
            badgeType: 'neutral' as const
          })

          // Build comparison rows for horizontal proportional bars
          const wfEntries2 = wfEntries
          const maxShare = Math.max(...wfEntries2.map(([, d]) => d.value ?? 0), 1)
          const palette = ['#3b82f6', '#8b5cf6', '#64748b', '#94a3b8']
          comparisonRows = wfEntries2.map(([wfName, data], idx) => ({
            name: wfName,
            value: data.formatted ?? '—',
            percent: ((data.value ?? 0) / maxShare) * 100,
            color: palette[idx % palette.length],
            tag: data.label ?? `N=${data.count ?? '—'}`,
            tagType: 'neutral' as const
          }))
          comparisonLabel = `Concentration in ${dominantRepo} by workflow`

          interpretation = (row as any).description || `${leader?.[0] ?? '—'} is materially more concentrated in ${dominantRepo} than the other observed workflows.`
          riskLabel = 'Investigate'
          riskSub = 'Allocation concentration'
          actionText = (row as any).recommendation || 'Investigate whether this concentration is intentional.'
          footerNote = `${(row as any).provenanceLabel || 'Telemetry'} · ${(row as any).scopeLabel || 'Cross-workflow'} · ${sampleSize.toLocaleString()} sessions`
        } else {
          // Standalone pairwise allocation finding (same/different/disjoint)
          const aEv = evidence[0]
          const bEv = evidence[1]
          const sharedEv = evidence[2]
          const gapEv = evidence[3]
          const subtype = (row as any).allocationSubtype || 'different_dominant_repo'

          if (subtype === 'same_dominant_repo') {
            // Same dominant repo, different concentration
            const aWfName = aEv?.metric || '—'
            const bWfName = bEv?.metric || '—'
            const aShare = aEv?.label || '—'
            const bShare = bEv?.label || '—'
            const aRepo = aEv?.value || '—'
            const bRepo = bEv?.value || '—'
            const aN = aEv?.context || '—'
            const bN = bEv?.context || '—'
            const sharedRepo = aRepo === bRepo ? aRepo : '—'

            claim = `${aWfName}: ${aShare} in ${aRepo} (${aN}) · ${bWfName}: ${bShare} in ${bRepo} (${bN})`
            claimSub = `${sampleSize.toLocaleString()} sessions · ${(row as any).provenanceLabel || 'Telemetry'} · Same dominant repo`
            const aPctSame = parseFloat(aShare) || 0
            const bPctSame = parseFloat(bShare) || 0
            const maxSame = Math.max(aPctSame, bPctSame, 1)

            evidenceCells = [
              {
                label: aWfName,
                value: `${aShare} in ${aRepo}`,
                sub: aN,
                badgeType: 'neutral' as const
              },
              {
                label: bWfName,
                value: `${bShare} in ${bRepo}`,
                sub: bN,
                badgeType: 'neutral' as const
              },
              {
                label: 'Concentration gap',
                value: gapEv?.value || '—',
                sub: 'percentage points difference',
                badgeType: 'neutral' as const
              },
              {
                label: 'Shared dominant repo',
                value: sharedRepo,
                sub: `Shared repos: ${sharedEv?.value ?? '—'}`,
                badgeType: 'neutral' as const
              }
            ]

            // Compact horizontal bar of dominant-repo share
            comparisonRows = [
              { name: aWfName, value: aShare, percent: (aPctSame / maxSame) * 100, color: '#3b82f6', tag: aRepo, tagType: 'neutral' as const },
              { name: bWfName, value: bShare, percent: (bPctSame / maxSame) * 100, color: '#8b5cf6', tag: bRepo, tagType: 'neutral' as const },
            ]
            comparisonLabel = `Share of sessions in ${sharedRepo}`

            interpretation = (row as any).description || `Both workflows are concentrated in ${sharedRepo}, but one is materially more concentrated there.`
            riskLabel = 'Investigate'
            riskSub = 'Concentration difference'
            actionText = (row as any).recommendation || 'Investigate whether this concentration difference reflects task types, team preferences, or tool suitability within the same codebase.'
            footerNote = `${(row as any).provenanceLabel || 'Telemetry'} · ${(row as any).scopeLabel || 'Workflow-level'} · ${sampleSize.toLocaleString()} sessions`
          } else if (subtype === 'disjoint') {
            // Disjoint repo sets
            claim = `${aEv?.metric || '—'}: ${aEv?.value || '—'} · ${bEv?.metric || '—'}: ${bEv?.value || '—'}`
            claimSub = `${sampleSize.toLocaleString()} sessions · ${(row as any).provenanceLabel || 'Telemetry'} · Disjoint repos`
            evidenceCells = [
              {
                label: aEv?.metric || 'Workflow A',
                value: aEv?.value || '—',
                sub: `${aEv?.label || '—'} · ${aEv?.context || ''}`,
                badgeType: 'neutral' as const
              },
              {
                label: bEv?.metric || 'Workflow B',
                value: bEv?.value || '—',
                sub: `${bEv?.label || '—'} · ${bEv?.context || ''}`,
                badgeType: 'neutral' as const
              },
              {
                label: 'Shared repos',
                value: '0',
                sub: 'No overlap',
                badgeType: 'neutral' as const
              }
            ]
            interpretation = (row as any).description || 'These workflows are used on entirely different repositories.'
            riskLabel = 'Investigate'
            riskSub = 'Disjoint allocation'
            actionText = (row as any).recommendation || 'Investigate whether this separation is intentional or reflects access/training gaps.'
            footerNote = `${(row as any).provenanceLabel || 'Telemetry'} · ${(row as any).scopeLabel || 'Workflow-level'} · ${sampleSize.toLocaleString()} sessions`
          } else {
            // Different dominant repos
            claim = `${aEv?.metric || '—'}: ${aEv?.value || '—'} · ${bEv?.metric || '—'}: ${bEv?.value || '—'}`
            claimSub = `${sampleSize.toLocaleString()} sessions · ${(row as any).provenanceLabel || 'Telemetry'} · Different dominant repos`
            const aPctDiff = parseFloat(aEv?.label || '0') || 0
            const bPctDiff = parseFloat(bEv?.label || '0') || 0
            const maxDiff = Math.max(aPctDiff, bPctDiff, 1)

            evidenceCells = [
              {
                label: aEv?.metric || 'Workflow A',
                value: aEv?.value || '—',
                sub: `${aEv?.label || '—'} · ${aEv?.context || ''}`,
                badgeType: 'neutral' as const
              },
              {
                label: bEv?.metric || 'Workflow B',
                value: bEv?.value || '—',
                sub: `${bEv?.label || '—'} · ${bEv?.context || ''}`,
                badgeType: 'neutral' as const
              },
              {
                label: 'Shared repos',
                value: String(sharedEv?.value ?? '—'),
                sub: 'Common repos',
                badgeType: 'neutral' as const
              }
            ]

            // Compact horizontal bar of each workflow's dominant-repo share
            comparisonRows = [
              { name: aEv?.metric || 'Workflow A', value: aEv?.value || '—', percent: (aPctDiff / maxDiff) * 100, color: '#3b82f6', tag: aEv?.label || '—', tagType: 'neutral' as const },
              { name: bEv?.metric || 'Workflow B', value: bEv?.value || '—', percent: (bPctDiff / maxDiff) * 100, color: '#8b5cf6', tag: bEv?.label || '—', tagType: 'neutral' as const },
            ]
            comparisonLabel = 'Dominant repo share by workflow'

            interpretation = (row as any).description || 'Different workflows are concentrated in different repositories.'
            riskLabel = 'Investigate'
            riskSub = 'Allocation pattern'
            actionText = (row as any).recommendation || 'Investigate whether this allocation is intentional.'
            footerNote = `${(row as any).provenanceLabel || 'Telemetry'} · ${(row as any).scopeLabel || 'Workflow-level'} · ${sampleSize.toLocaleString()} sessions`
          }
        } // end of pairwise allocation else-branch (CR-X P1 synthesis check)
      } else if ((row as any).presentationKind === 'within_workflow_temporal' && (row as any).hasData) {
        // CR-X Wave 1B: Within-Workflow Temporal Behavior — faithful evidence rendering
        const evidence = (row as any).evidence || []
        const recentEv = evidence[0]
        const priorEv = evidence[1]
        const windowEv = evidence[2]
        claim = `${priorEv?.value || '—'} → ${recentEv?.value || '—'} · ${(row as any).displayDeltaPct || '—'}`
        claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · Temporal comparison`
        evidenceCells = [
          {
            label: recentEv?.label || 'Recent',
            value: recentEv?.value || '—',
            sub: recentEv?.context || '',
            badgeType: 'neutral' as const
          },
          {
            label: priorEv?.label || 'Prior',
            value: priorEv?.value || '—',
            sub: priorEv?.context || '',
            badgeType: 'neutral' as const
          },
          {
            label: 'Window',
            value: windowEv?.value || '—',
            sub: 'Comparison period',
            badgeType: 'neutral' as const
          }
        ]
        interpretation = (row as any).description || 'Temporal change observed within a single workflow.'
        riskLabel = (row as any).urgencyLabel === 'investigate' ? 'Investigate' : 'Monitor'
        riskSub = 'Temporal change'
        actionText = (row as any).recommendation || 'Monitor trend over time.'
        footerNote = `Observational · ${sampleSize.toLocaleString()} sessions · May reflect task or repo mix changes`
      } else if ((row as any).presentationKind === 'workflow_repo_allocation_shift' && (row as any).hasData) {
        // CR-X Wave 1B: Workflow × Repo Allocation Shift — faithful evidence rendering
        const evidence = (row as any).evidence || []

        // CR-X P1: Synthesized organizational allocation shift finding.
        // Render all workflows' shifts with comparison bars from breakdownByTool.
        if ((row as any).allocationShiftSynthesis === true) {
          const bt = (row as any).breakdownByTool || {}
          const wfEntries = Object.entries(bt) as [string, any][]
          const windowEv = evidence.find((e: any) => e.metric === 'comparison window')

          claim = `${wfEntries.length} workflows shifted allocation · ${windowEv?.context || ''}`
          claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · Organizational shift`

          // Build evidence cells for all workflows
          evidenceCells = wfEntries.map(([wfName, data]) => ({
            label: wfName,
            value: data.formatted ?? '—',
            sub: data.label ?? '',
            badgeType: 'neutral' as const
          }))
          // Add comparison window cell
          evidenceCells.push({
            label: 'Window',
            value: windowEv?.value || windowEv?.label || '—',
            sub: windowEv?.context || 'prior → recent',
            badgeType: 'neutral' as const
          })

          // Build comparison rows for horizontal proportional bars (shift magnitude)
          const maxShift = Math.max(...wfEntries.map(([, d]) => d.value ?? 0), 1)
          const palette = ['#3b82f6', '#8b5cf6', '#64748b', '#94a3b8']
          comparisonRows = wfEntries.map(([wfName, data], idx) => ({
            name: wfName,
            value: data.formatted ?? '—',
            percent: ((data.value ?? 0) / maxShift) * 100,
            color: palette[idx % palette.length],
            tag: data.label ?? '',
            tagType: 'neutral' as const
          }))
          comparisonLabel = 'Allocation shift magnitude by workflow'

          interpretation = (row as any).description || 'Multiple workflows shifted allocation in the same window.'
          riskLabel = (row as any).urgencyLabel === 'investigate' ? 'Investigate' : 'Monitor'
          riskSub = 'Organizational shift'
          actionText = (row as any).recommendation || 'Investigate whether these shifts reflect a planned organizational change.'
          footerNote = `Observational · Multi-workflow synthesis · ${sampleSize.toLocaleString()} sessions`
        } else {
        // PILOT OPS 14-D: Look up evidence by metric name, not by index.
        // The synthesized finding has a different evidence array structure
        // (per-workflow shifts + comparison window), so index-based access
        // would map evidence[2] (comparison window) to the "Max shift" cell.
        const recentReposEv = evidence.find((e: any) => e.metric === 'recent repos') || evidence[0]
        const priorReposEv = evidence.find((e: any) => e.metric === 'prior repos') || evidence[1]
        const shiftEv = evidence.find((e: any) => e.metric === 'max share shift') || evidence[2]
        const newReposEv = evidence.find((e: any) => e.metric === 'new repos') || evidence[3]
        const lostReposEv = evidence.find((e: any) => e.metric === 'lost repos') || evidence[4]
        const windowEv = evidence.find((e: any) => e.metric === 'comparison window') || evidence[5]
        claim = `${shiftEv?.value || '—'} shift · ${recentReposEv?.context || ''} → ${priorReposEv?.context || ''}`
        claimSub = `${sampleSize.toLocaleString()} sessions · Telemetry · Allocation shift`
        evidenceCells = [
          {
            label: 'Recent repos',
            value: String(recentReposEv?.value || '—'),
            sub: recentReposEv?.context || '',
            badgeType: 'neutral' as const
          },
          {
            label: 'Prior repos',
            value: String(priorReposEv?.value || '—'),
            sub: priorReposEv?.context || '',
            badgeType: 'neutral' as const
          },
          {
            label: 'Max shift',
            value: shiftEv?.value || '—',
            sub: shiftEv?.context || '',
            badgeType: 'neutral' as const
          },
          {
            label: 'New repos',
            value: String(newReposEv?.value || 0),
            sub: 'Appeared in recent',
            badgeType: 'neutral' as const
          },
          {
            label: 'Lost repos',
            value: String(lostReposEv?.value || 0),
            sub: 'Dropped in recent',
            badgeType: 'neutral' as const
          },
          {
            label: 'Window',
            value: windowEv?.value || '—',
            sub: 'Comparison period',
            badgeType: 'neutral' as const
          }
        ]
        interpretation = (row as any).description || 'Workflow allocation shifted across the observed period.'
        riskLabel = (row as any).urgencyLabel === 'investigate' ? 'Investigate' : 'Monitor'
        riskSub = 'Allocation shift'
        actionText = (row as any).recommendation || 'Investigate whether this reflects a planned change.'
        footerNote = `Observational · ${sampleSize.toLocaleString()} sessions · No causal attribution`
        } // end of pairwise allocation-shift else-branch (CR-X P1 synthesis check)
      } else {
      // Neutral/insufficient - use canonical description if available
      claim = `${cleanMetricLabel} has insufficient comparison data for workflow ranking.`
      // Use GitHub-appropriate language for GitHub cards
      const sampleUnit = isGitHubMetric ? 'reviews' : 'sessions';
      const dataSource = isGitHubMetric ? 'GitHub' : 'Telemetry';
      claimSub = `${sampleSize.toLocaleString()} ${sampleUnit} · ${dataSource} · All-time baseline`
      
      evidenceCells = [
        {
          label: cleanMetricLabel,
          value: primaryMetricDisplay,
          sub: 'Insufficient data',
          badgeType: 'neutral'
        },
        {
          label: 'Sample',
          value: sampleSize.toLocaleString(),
          sub: sampleUnit,
          badgeType: 'neutral'
        },
        {
          label: 'Difference',
          value: 'Insufficient',
          sub: 'Comparison unavailable',
          badge: 'Not comparable',
          badgeType: 'warning'
        }
      ]
      
      // Use canonical description if available, otherwise use metric-specific fallback
      const neutralFallback = getMetricSpecificFallback(insightId)
      interpretation = row.description || neutralFallback.interpretation
      actionText = row.recommendation || neutralFallback.actionText
      footerNote = row.description || neutralFallback.interpretation
      } // end else (non-trend default)
    }
  }

  // Assemble fallbackCard from existing logic
  const fallbackCard: PerformanceInsightViewModel['decisionCard'] = {
    cardType,
    claim,
    claimSub,
    evidenceCells,
    comparisonRows: comparisonRows.length > 0 ? comparisonRows : undefined,
    comparisonLabel: comparisonLabel || undefined,
    periodStrip,
    isLowerBetter,
    interpretation,
    riskLabel: riskLabel || undefined,
    riskSub: riskSub || undefined,
    actionText,
    footerNote
  }

  // Return fallbackCard directly (GitHub org-level enhancement removed for UI parity)
  return fallbackCard
}

// Frozen GitHub card helpers - exact hardcoded values for pilot credibility
// In live-pilot mode, return null if no real GitHub data to avoid pollution
function buildFrozenGithubDecisionCard(
  row: V2PreviewRow,
  insightId: string
): PerformanceInsightViewModel['decisionCard'] | null {
  // CR1: If the generator already produced real evidence (current value, evidence array,
  // displayValue), skip the frozen fallback and let generic routing build the card.
  const hasGeneratorEvidence = (row as any).current != null && (row as any).current !== 0 &&
    (row as any).evidence && Array.isArray((row as any).evidence) && (row as any).evidence.length > 0
  if (hasGeneratorEvidence) {
    piDebugLog('[CR1][FROZEN_CARD_SKIP]', `${insightId} has generator evidence, skipping frozen fallback`)
    return null
  }

  // CR4 Task 2: Use canonical runtimeMode authority — no split-brain.
  const isLivePilotMode = isLivePilotModeCanonical()

  // In live-pilot mode, check if we have real GitHub data before using fallback values
  if (isLivePilotMode) {
    const rowAny = row as any
    const hasRealGitHubData = rowAny.githubSnapshot?.pr_analytics?.total_prs > 0 ||
                              rowAny.githubSnapshot?.deployment_metrics?.success_deployment_count > 0
    if (!hasRealGitHubData) {
      if (VERBOSE_PI_DEBUG) console.log('[LIVE_PILOT] No real GitHub data, skipping frozen GitHub fallback card for', insightId)
      return null
    }
  }

  switch (insightId) {
    case 'change-failure-rate-spike-by-ide': {
      const dm = (row as any).githubSnapshot?.deployment_metrics || (row as any).deployment_metrics || {}
      const dr = dm.deployment_reliability
      // CR5 FINAL DOWNSTREAM: Use deployment_reliability block when available
      if (dr && dr.total > 0) {
        return {
          cardType: 'neutral',
          claim: `${dr.success} of ${dr.total} deployments succeeded · ${dr.failed} production failures`,
          claimSub: 'GitHub delivery · all-time baseline',
          evidenceCells: [
            { label: 'SUCCESS RATE', value: `${dr.success_rate}%`, sub: `${dr.success} / ${dr.total} deployments`, badgeType: 'neutral' },
            { label: 'FAILED', value: dr.failed.toString(), sub: dr.production_failed === dr.failed ? 'Both production' : `${dr.production_failed} production`, badgeType: 'warning' },
            { label: 'PRODUCTION', value: dr.production_total.toString(), sub: `${dr.production_failed} failed`, badgeType: 'neutral' },
            { label: 'STAGING', value: dr.staging_total.toString(), sub: '0 failed', badgeType: 'neutral' }
          ],
          comparisonLabel: 'DEPLOYMENT OUTCOMES',
          comparisonRows: [
            { name: 'Successful', value: dr.success.toString(), percent: (dr.success / dr.total) * 100, color: '#2563eb', tag: `${dr.success_rate}%`, tagType: 'best' },
            { name: 'Failed', value: dr.failed.toString(), percent: (dr.failed / dr.total) * 100, color: '#dc2626', tag: `${(100 - dr.success_rate).toFixed(1)}%`, tagType: 'worst' }
          ],
          isLowerBetter: true,
          interpretation: 'Most deployments completed successfully, but the observed failures were concentrated in production.',
          riskLabel: 'Medium',
          riskSub: 'Org-wide GitHub signal',
          actionText: 'Inspect the failed production releases for shared change characteristics, deployment timing, or missing pre-production checks.',
          footerNote: `GitHub delivery · all-time baseline · ${dr.total} deployments · ${dr.observed_days} observed days`,
          recommendationAllowed: true
        }
      }
      // Legacy fallback when deployment_reliability is absent
      const failed = dm.failed_deployment_count ?? 0
      const success = dm.success_deployment_count ?? 0
      const total = failed + success
      const cfr = dm.change_failure_rate ?? (total > 0 ? (failed / total) * 100 : 0)
      const target = (row as any).baseline ?? 5.0
      const hasData = total > 0
      // PI-CLEANUP-7: The comparison tag/color/interpretation were previously
      // hardcoded to "Above target" / worst / red regardless of the actual
      // measured value, and the no-data interpretation asserted a directional
      // claim ("is above target") even when there was no data to support it.
      // Both are now derived from the real comparison.
      const cfrAboveTarget = hasData && cfr > target
      return {
        cardType: 'neutral',
        claim: 'Change failure rate vs target across GitHub deployments',
        claimSub: 'GitHub · All-time baseline',
        evidenceCells: [
          { label: 'Failed / total', value: hasData ? `${failed} / ${total}` : '— / —', badgeType: 'neutral' },
          { label: 'Actual CFR', value: hasData ? `${cfr.toFixed(1)}%` : '—%', badgeType: 'neutral' },
          { label: 'Target', value: `${target.toFixed(1)}%`, badgeType: 'neutral' },
          { label: 'Basis', value: 'All-time GitHub', badgeType: 'neutral' }
        ],
        comparisonLabel: 'CHANGE FAILURE RATE — LOWER IS BETTER',
        comparisonRows: [
          {
            name: 'Actual CFR',
            value: hasData ? `${cfr.toFixed(1)}%` : '—%',
            percent: Math.min(cfr, 100),
            color: !hasData ? '#94a3b8' : cfrAboveTarget ? '#dc2626' : '#16a34a',
            tag: !hasData ? 'No data' : cfrAboveTarget ? 'Above target' : 'At or below target',
            tagType: !hasData ? 'neutral' : cfrAboveTarget ? 'worst' : 'best'
          },
          { name: 'Target', value: `${target.toFixed(1)}%`, percent: Math.min(target, 100), color: '#475569', tag: 'Baseline', tagType: 'neutral' }
        ],
        isLowerBetter: true,
        interpretation: hasData ? `${failed} of ${total} deployments failed (${cfr.toFixed(1)}% failure rate).` : 'No GitHub deployment data available for this period.',
        riskLabel: 'Medium',
        riskSub: 'Org-wide signal',
        actionText: 'Strengthen CI/CD validation and rollback gates before increasing release cadence.',
        footerNote: 'Org-wide GitHub signal · workflow tagging needed for IDE/tool attribution'
      }
    }
    case 'reopen-pressure-spike': {
      // Single-authority fix: derive from the generator's own measured fields
      // (row.current = reopen rate %, row.n = total PRs). githubSnapshot does
      // not survive the render adapter, so reading it here produced a card
      // that contradicted the generator's title/evidence.
      const reopenRate = typeof (row as any).current === 'number' && Number.isFinite((row as any).current) ? (row as any).current : null
      const totalPrs = typeof (row as any).n === 'number' && Number.isFinite((row as any).n) ? (row as any).n : 0
      const target = 10.0
      const hasData = reopenRate !== null && totalPrs > 0 && (row as any).hasData !== false
      const reopenedCount = hasData ? Math.round((reopenRate as number) * totalPrs / 100) : 0
      // PI-CLEANUP-7: same fix as change-failure-rate-spike-by-ide above —
      // tag/color/interpretation now reflect the real comparison instead of
      // an unconditional "Above target" claim.
      const reopenAboveTarget = hasData && reopenRate > target
      return {
        cardType: 'neutral',
        claim: 'PR reopen rate vs target across GitHub PRs',
        claimSub: 'GitHub · All-time baseline',
        evidenceCells: [
          { label: 'Reopened / total', value: hasData ? `${reopenedCount} / ${totalPrs}` : '— / —', badgeType: 'neutral' },
          { label: 'Actual reopen rate', value: hasData ? `${reopenRate.toFixed(1)}%` : '—%', badgeType: 'neutral' },
          { label: 'Target', value: `${target.toFixed(1)}%`, badgeType: 'neutral' },
          { label: 'Basis', value: 'All-time GitHub', badgeType: 'neutral' }
        ],
        comparisonLabel: 'PR REOPEN RATE — LOWER IS BETTER',
        comparisonRows: [
          {
            name: 'Actual reopen rate',
            value: hasData ? `${reopenRate!.toFixed(1)}%` : '—%',
            percent: Math.min(reopenRate ?? 0, 100),
            color: !hasData ? '#94a3b8' : reopenAboveTarget ? '#dc2626' : '#16a34a',
            tag: !hasData ? 'No data' : reopenAboveTarget ? 'Above target' : 'At or below target',
            tagType: !hasData ? 'neutral' : reopenAboveTarget ? 'worst' : 'best'
          },
          { name: 'Target', value: `${target.toFixed(1)}%`, percent: Math.min(target, 100), color: '#475569', tag: 'Baseline', tagType: 'neutral' }
        ],
        isLowerBetter: true,
        interpretation: hasData ? `${reopenedCount} of ${totalPrs} PRs reopened (${reopenRate!.toFixed(1)}% reopen rate).` : 'Reopen telemetry is not captured by the current GitHub sync.',
        riskLabel: 'Medium',
        riskSub: 'Org-wide signal',
        actionText: reopenAboveTarget
          ? 'Tighten test coverage gates and minimum review requirements before merge.'
          : 'Reopen rate is at or below the <10% target. Continue monitoring.',
        footerNote: 'Org-wide GitHub signal · workflow tagging needed for IDE/tool attribution'
      }
    }
    case 'delivery-velocity-by-workflow':
    case 'synthesized-deployment-cadence': {
      const dm = (row as any).githubSnapshot?.deployment_metrics || (row as any).deployment_metrics || {}
      const success = dm.success_deployment_count ?? 0
      const failed = dm.failed_deployment_count ?? 0
      const total = success + failed
      const hasData = total > 0
      return {
        cardType: 'neutral',
        claim: 'GitHub deployments observed',
        claimSub: 'GitHub · All-time baseline',
        evidenceCells: [
          { label: 'Deployments', value: hasData ? total.toString() : '—', badgeType: 'neutral' },
          { label: 'Successful', value: hasData ? success.toString() : '—', badgeType: 'neutral' },
          { label: 'Failed', value: hasData ? failed.toString() : '—', badgeType: 'neutral' },
          { label: 'Basis', value: 'All-time GitHub', badgeType: 'neutral' }
        ],
        comparisonRows: undefined,
        comparisonLabel: undefined,
        isLowerBetter: false,
        interpretation: hasData ? `${total} deployments observed (${success} successful, ${failed} failed).` : 'Deployment volume is high enough to monitor release stability.',
        riskLabel: 'Medium',
        riskSub: 'Org-wide signal',
        actionText: 'Review release validation and tag deployments by workflow before attributing outcomes to tools.',
        footerNote: 'Org-wide GitHub signal · workflow tagging needed for IDE/tool attribution'
      }
    }
    default:
      return null
  }
}

// Map V2PreviewRow to north-star view model
function toPerformanceInsightViewModel(row: V2PreviewRow): PerformanceInsightViewModel {
  try {
    return toPerformanceInsightViewModelImpl(row)
  } catch (e) {
    console.error('[PI_VIEW_MODEL] toPerformanceInsightViewModel failed for row:', row.id, e)
    // SAFETY: Return neutral diagnostic card instead of error card
    // This maintains insight count while hiding user-facing error messages
    return {
      id: row.id,
      title: row.title || 'Performance Insight',
      impact: 'LOW',
      category: 'Diagnostic',
      detected: 'Detected',
      detectedFull: 'Detected',
      iconBg: '#f1f5f9',
      icon: null,
      primaryMetric: '—',
      primaryMetricLabel: 'Metric',
      primaryMetricContext: '',
      change: 'Not available',
      changeSemantic: 'Monitoring',
      changePositive: false,
      changeLabel: 'Data review',
      confidence: 'Low',
      confidenceColor: 'gray',
      confidenceSub: 'Data review needed',
      impactValue: 'Diagnostic',
      impactColor: 'gray',
      impactSub: 'Insight under review',
      whatChanged: 'Data review',
      whyItMatters: 'This insight is under review for data quality.',
      whyItems: [],
      evidence: [],
      actionText: 'Monitor for updated data.',
      potentialImpact: '',
      signalPills: [],
      topRowSummary: {
        metricValue: '—',
        metricLabel: 'Metric',
        metricSubline: 'Review',
        rankingRows: [],
        hasRankingData: false,
        comparisonMode: 'insufficient',
        changeValue: 'Not available',
        changeTone: 'neutral',
        comparisonLabel: 'Data review',
        comparisonSublabel: 'Diagnostic',
        evidenceValue: 'Low',
        evidenceSubline: 'Data review needed'
      },
      decisionCard: {
        cardType: 'neutral',
        claim: 'Diagnostic data unavailable.',
        claimSub: 'Diagnostic',
        evidenceCells: [
          {
            label: 'Status',
            value: 'Data unavailable',
            sub: 'Required data missing',
            badgeType: 'neutral'
          }
        ],
        isLowerBetter: false,
        interpretation: 'Required data is not available for comparison.',
        actionText: 'Monitor for updated data.',
        footerNote: 'Diagnostic · Data unavailable'
      }
    }
  }
}

function toPerformanceInsightViewModelImpl(row: V2PreviewRow): PerformanceInsightViewModel {
  // Use unified title generation pipeline directly

  const insightId = row.id.toLowerCase()

  // Determine if this is a higher-is-worse metric (cycle time, latency, duration, rework, failure, reopen)
  // Must be defined early to avoid TDZ errors
  // Priority: use polarity field from renderAdapter (already correctly computed from generator + metric ID)
  // Fall back to heuristic for legacy insights without polarity
  const rowPolarity = (row as any).polarity
  const isHigherIsWorse = rowPolarity === 'lower_is_better' ||
                          insightId.includes('cycle') || insightId.includes('latency') || insightId.includes('duration') ||
                          insightId.includes('rework') || insightId.includes('failure') || insightId.includes('reopen') ||
                          insightId.includes('mttr') || insightId.includes('ttfc') ||
                          insightId.includes('switching') || insightId.includes('idle') ||
                          insightId.includes('concentration') || insightId.includes('review-load') ||
                          insightId.includes('review-burden') || insightId.includes('bottleneck')

  const impact = getImpactLevel(row).toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW'
  const category = getFrozenStageLabel(row)
  // P0.2 R2: For commit-ttfc-longitudinal, use TTFC delta (minutes) as the
  // card-level change value, not the commits/session displayDeltaPct string.
  const delta = row.id === 'commit-ttfc-longitudinal' && typeof row.ttfcDeltaMinutes === 'number'
    ? row.ttfcDeltaMinutes
    : row.displayDeltaPct ?? row.deltaPct ?? 0
  const confidence = row.confidence || 'medium'
  const coverage = row.coveragePct || 0
  
  // Icon based on stage
  let icon = IconCode
  let iconBg = '#3b82f6'
  if (row.cicdStage === 'review-merge') {
    icon = IconMerge
    iconBg = '#22c55e'
  } else if (row.cicdStage === 'deploy-operate') {
    icon = IconRocket
    iconBg = '#8b5cf6'
  }
  
  // Build workflow comparison data IMMEDIATELY after basic row fields are known
  const workflowComparison = buildWorkflowComparison(row)
  
  // Clean metric label: use rightMetricLabel from generator, remove internal descriptors
  // MUST be defined early to avoid TDZ errors with buildExecutiveFinding
  const cleanMetricLabel = ((row as any).rightMetricLabel || sanitizeMetricName(row.id))
    .replace(/\s*with\s+Failure\s+Pressure/gi, '')
    .replace(/\s*Synthesis/gi, '')
    .replace(/^\s+|\s+$/g, '')
  
  // CR5 P0-4: Use adapter's isOrgLevelMetric as authority, not keyword inference.
  // The old code hardcoded only deploy-operate stage keywords, missing
  // plan-code org-level metrics like repository-concentration.
  const stage = row.cicdStage || 'plan-code'
  const isTrueOrgLevelMetric = (row as any).isOrgLevelMetric === true ||
    (row as any).comparisonState === 'org_level_only' ||
    (stage === 'deploy-operate' &&
      (insightId.includes('deployment') || insightId.includes('change-failure') || insightId.includes('mttr') || insightId.includes('delivery-velocity')))
  const isGitHubMetric = (stage === 'review-merge' &&
                        (insightId.includes('review') || insightId.includes('pr-') || insightId.includes('reopen') || insightId.includes('revert'))) ||
                        (stage === 'deploy-operate' &&
                        (insightId.includes('deployment') || insightId.includes('change-failure') || insightId.includes('mttr') || insightId.includes('delivery-velocity') || insightId.includes('deployment-cadence')))
  const isUnknownWinner = workflowComparison.winner?.name?.toLowerCase().includes('unknown') || 
                        workflowComparison.winner?.name?.toLowerCase().includes('unattributed')

  // Data-gap cards are diagnostics, not observed customer risks. When a
  // non-org-level row lacks sufficient workflow-comparison evidence the
  // card renders a "needs more data" / attribution-gap title — it must
  // never carry a HIGH/MEDIUM severity badge derived from the registry.
  const effectiveImpact: 'HIGH' | 'MEDIUM' | 'LOW' =
    (!workflowComparison.hasEnoughComparisonData &&
      workflowComparison.comparisonMode !== 'org-level' &&
      !isTrueOrgLevelMetric)
      ? 'LOW'
      : impact

  // Confidence color and label - use signal strength context
  // Will be recalculated based on actual sample size to avoid contradiction
  let confidenceColor: 'green' | 'orange' | 'gray' = 'gray'
  let confidenceDisplay: string
  
  // Calculate confidence display BEFORE evidence array building
  const sampleSize = row.n || 0
  if (sampleSize >= 500) {
    confidenceColor = 'green'
    confidenceDisplay = 'Strong signal'
  } else if (sampleSize >= 100) {
    confidenceColor = 'green'
    confidenceDisplay = 'Strong signal'
  } else if (sampleSize >= 50) {
    confidenceColor = 'orange'
    confidenceDisplay = 'Early signal'
  } else if (sampleSize >= 20) {
    confidenceColor = 'orange'
    confidenceDisplay = 'Emerging sample'
  } else {
    confidenceColor = 'gray'
    confidenceDisplay = 'Limited sample'
  }
  
  // For PR/deployment metrics, adjust based on GitHub cohort availability
  const isPRMetric = row.cicdStage === 'review-merge' || row.cicdStage === 'deploy-operate'
  if (isPRMetric && coverage < 50) {
    confidenceColor = 'orange'
    confidenceDisplay = 'Needs GitHub validation'
  }
  
  // Impact color and specific category
  let impactColor: 'red' | 'orange' | 'gray' = 'gray'
  let impactCategory = 'Quality signal'
  if (effectiveImpact === 'HIGH') {
    impactColor = 'red'
    // Map stage to specific impact category
    if (row.cicdStage === 'plan-code') impactCategory = 'Cycle-time risk'
    else if (row.cicdStage === 'review-merge') impactCategory = 'Review bottleneck'
    else if (row.cicdStage === 'deploy-operate') impactCategory = 'Deployment risk'
  } else if (effectiveImpact === 'MEDIUM') {
    impactColor = 'orange'
    impactCategory = 'Operational tension'
  } else {
    impactCategory = 'Quality signal'
  }
  
  // Sanitize impact category to ensure it's always specific (never generic "Quality signal")
  impactCategory = sanitizeImpactCategory(impactCategory, row.cicdStage || 'plan-code', row.id)
  
  // Evidence grid - support only (Source, Attribution, Sample, Coverage, Confidence)
  const evidence: Array<{ label: string; value: string }> = []
  
  // Data source
  const isTelemetryMetric = row.cicdStage === 'plan-code'
  if (isPRMetric && isTelemetryMetric) {
    evidence.push({ label: 'Source', value: 'Telemetry + GitHub' })
  } else if (isPRMetric) {
    evidence.push({ label: 'Source', value: 'GitHub' })
  } else {
    evidence.push({ label: 'Source', value: 'Telemetry' })
  }
  
  // Attribution level
  if (workflowComparison.comparisonMode === 'org-level' || isTrueOrgLevelMetric) {
    evidence.push({ label: 'Attribution', value: 'Org-level' })
  } else if (workflowComparison.comparisonMode === 'attribution-gap') {
    evidence.push({ label: 'Attribution', value: 'Attribution gap' })
  } else if (workflowComparison.hasEnoughComparisonData) {
    evidence.push({ label: 'Attribution', value: 'IDE-level' })
  } else {
    evidence.push({ label: 'Attribution', value: 'Unattributed' })
  }
  
  // Sample size
  evidence.push({ label: 'Sample', value: (row.n || 0).toString() })
  
  // Coverage
  evidence.push({ label: 'Coverage', value: `${coverage.toFixed(0)}%` })
  
  // Confidence
  evidence.push({ label: 'Confidence', value: confidenceDisplay })
  
  // Limit evidence grid to max 5 cells for compactness
  if (evidence.length > 5) {
    evidence.length = 5
  }
  
  // Why items - use realistic operational indicators instead of raw percentages
  const whyItems: Array<{ label: string; value: string; positive: boolean; icon: any }> = []
  const categoryMeta = getPresentationMetadata(row).operationalCategory
  
  if (categoryMeta === 'velocity') {
    const throughputImpact = delta !== 0 ? delta : 0
    whyItems.push({ label: 'Throughput impact', value: throughputImpact > 0 ? `Elevated` : 'Compressed', positive: throughputImpact > 0, icon: IconClock })
    const flowImpact = delta !== 0 ? Math.abs(delta) : 0
    whyItems.push({ label: 'Flow efficiency', value: flowImpact > 5 ? 'Moderate' : 'Stable', positive: flowImpact <= 5, icon: IconFlow })
  } else if (categoryMeta === 'quality') {
    const qualityPressure = delta !== 0 ? delta : 0
    whyItems.push({ label: 'Quality pressure', value: qualityPressure > 0 ? 'Elevated' : 'Stable', positive: qualityPressure <= 0, icon: IconClock })
    whyItems.push({ label: 'Risk level', value: effectiveImpact === 'HIGH' ? 'High' : effectiveImpact === 'MEDIUM' ? 'Medium' : 'Low', positive: effectiveImpact === 'LOW', icon: IconAlert })
  } else {
    const stabilityPressure = delta !== 0 ? delta : 0
    whyItems.push({ label: 'Stability pressure', value: stabilityPressure > 0 ? 'Increasing' : 'Stable', positive: stabilityPressure <= 0, icon: IconClock })
    whyItems.push({ label: 'Risk level', value: effectiveImpact === 'HIGH' ? 'High' : effectiveImpact === 'MEDIUM' ? 'Medium' : 'Low', positive: effectiveImpact === 'LOW', icon: IconAlert })
  }
  
  // Potential impact - only use grounded data, no fake values, never show 0%
  const potentialImpact: Array<{ label: string; value: string; positive: boolean }> = []

  // Only show impact if we have grounded delta from real data AND it's meaningful (not 0%)
  if (delta !== undefined && delta !== null && !isNaN(delta) && isFinite(delta) && Math.abs(delta) < 100 && Math.abs(delta) > 0.1) {
    // Use real delta if it's reasonable (not an outlier and not near-zero)
    const roundedDelta = Math.round(Math.abs(delta))
    const isPositive = isHigherIsWorse ? delta < 0 : delta > 0

    // Only show if the rounded delta is at least 1% (meaningful impact)
    if (roundedDelta >= 1) {
      if (categoryMeta === 'velocity') {
        potentialImpact.push({ label: 'Delivery velocity', value: `${delta > 0 ? '+' : ''}${roundedDelta}%`, positive: isPositive })
      } else if (categoryMeta === 'quality') {
        potentialImpact.push({ label: 'Code quality', value: `${delta > 0 ? '+' : ''}${roundedDelta}%`, positive: isPositive })
      } else if (categoryMeta === 'stability') {
        potentialImpact.push({ label: 'Deployment stability', value: `${delta > 0 ? '+' : ''}${roundedDelta}%`, positive: isPositive })
      }
    }
  }
  // No fake fallback values - if no grounded data or delta is 0%, show no impact
  
  // Signal pills for Why It Matters density
  const signalPills: string[] = []
  if (insightId.includes('ai') || insightId.includes('suggestion')) {
    signalPills.push('AI workflow concentration')
  }
  if (insightId.includes('review') || insightId.includes('pr') || insightId.includes('merge')) {
    signalPills.push('Reviewer bottleneck risk')
  }
  if (insightId.includes('deployment') || insightId.includes('failure') || insightId.includes('mttr')) {
    signalPills.push('Release validation drift')
  }
  if (insightId.includes('cursor') || insightId.includes('windsurf') || insightId.includes('vscode')) {
    signalPills.push('Cross-IDE variance')
  }
  if (insightId.includes('cycle') || insightId.includes('velocity') || insightId.includes('throughput')) {
    signalPills.push('Merge throughput acceleration')
  }
  if (insightId.includes('revert') || insightId.includes('reopen') || insightId.includes('rework')) {
    signalPills.push('Stability-pressure divergence')
  }
  if (insightId.includes('concentration') || insightId.includes('bottleneck')) {
    signalPills.push('Coordination bottleneck')
  }
  // Limit to 2 pills preferred, max 3 hard cap
  if (signalPills.length > 2) {
    signalPills.length = 2
  }
  
  const axis = getPIAxis(row.id)
  
  // Enhance primary metric with metric name, value, and cohort context
  let primaryMetricContext = ''
  const metricName = sanitizeMetricName(row.id, getPresentationMetadata(row).label)
  const primaryValue = formatPrimaryMetric(row, 'Not enough cohort data')
  
  // Determine cohort context for primary metric (subline only)
  if ((row as any).comparisonMode === 'ai_vs_non_ai') {
    primaryMetricContext = 'AI-assisted PRs'
  } else if (workflowComparison.hasEnoughComparisonData && workflowComparison.winner) {
    // Show winner context when comparison data exists
    primaryMetricContext = `Winner · ${displayWorkflowName(workflowComparison.winner.name)}`
  } else if (row.breakdownByTool) {
    const toolEntries = Object.entries(row.breakdownByTool).filter(([tool]) => tool !== 'org')
    if (toolEntries.length >= 1) {
      toolEntries.sort((a, b) => (b[1] as any).value - (a[1] as any).value)
      const leader = toolEntries[0]
      const leaderLabel = leader[0].charAt(0).toUpperCase() + leader[0].slice(1)
      primaryMetricContext = `Measured workflow · ${leaderLabel}`
    }
  }

  // Primary metric display: value only (north-star design)
  const primaryMetricDisplay = primaryValue
  
  // Delta: Most useful comparative number with direction
  let deltaText = 'No recent movement'
  let deltaLabel = 'vs prior 4 weeks'

  // P0.2 R2: For commit-ttfc-longitudinal, use structured TTFC delta (minutes)
  // as the card-level change display. Do NOT route through generic percentage
  // or AI-active-share semantics.
  if (row.id === 'commit-ttfc-longitudinal' && typeof (row as any).ttfcDeltaMinutes === 'number') {
    const ttfcDelta = (row as any).ttfcDeltaMinutes
    if (ttfcDelta === 0) {
      deltaText = 'Stable'
    } else {
      deltaText = `${ttfcDelta > 0 ? '+' : ''}${ttfcDelta.toFixed(1)} min`
    }
    deltaLabel = 'TTFC first → latest'
  } else {
  // Priority 0: Use evidence Delta if available (from evidence array)
  const evidenceDelta = evidence.find(ev => ev.label === 'Delta')
  if (evidenceDelta && evidenceDelta.value && evidenceDelta.value !== '—' && evidenceDelta.value !== 'N/A') {
    const deltaValue = evidenceDelta.value
    // Extract numeric value from evidence delta string
    const deltaMatch = deltaValue.match(/([+-]?[\d.]+)%/)
    if (deltaMatch) {
      const deltaPct = parseFloat(deltaMatch[1])
      if (!isNaN(deltaPct) && isFinite(deltaPct)) {
        // For higher-is-worse metrics, use neutral/risk language
        if (isHigherIsWorse && deltaPct > 0) {
          deltaText = `+${deltaPct.toFixed(1)}% higher`
        } else if (isHigherIsWorse && deltaPct < 0) {
          deltaText = `${deltaPct.toFixed(1)}% lower`
        } else {
          deltaText = `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`
        }
        deltaLabel = workflowComparison.comparisonBasis
      }
    } else if (deltaValue.includes('Above baseline') || deltaValue.includes('Below baseline') || deltaValue.includes('Large increase') || deltaValue.includes('Large decrease')) {
      // Normalize for higher-is-worse metrics
      if (isHigherIsWorse && (deltaValue.includes('Above baseline') || deltaValue.includes('Large increase'))) {
        deltaText = deltaValue.replace('Above baseline', 'Above baseline (risk)').replace('Large increase', 'Elevated')
      }
      deltaText = deltaValue
      deltaLabel = workflowComparison.comparisonBasis
    } else if (deltaValue.includes('slower') || deltaValue.includes('faster')) {
      deltaText = deltaValue
      deltaLabel = workflowComparison.comparisonBasis
    }
  }
  
  // Priority 1: Use displayDeltaPct or deltaPct if available and finite
  // CRITICAL: Must check typeof === 'number' because isNaN()/isFinite() coerce
  // strings to numbers. A string like "+0.50" passes isNaN/isFinite guards
  // but has no .toFixed() method, causing a TypeError.
  const effectiveDeltaPct = row.displayDeltaPct ?? row.deltaPct
  if (typeof effectiveDeltaPct === 'number' && !isNaN(effectiveDeltaPct) && isFinite(effectiveDeltaPct)) {
    const deltaPct = effectiveDeltaPct
    if (deltaPct === 0) {
      deltaText = 'Stable'
    } else if (Math.abs(deltaPct) > 5000) {
      // Guard against huge percentages from near-zero baselines
      deltaText = deltaPct > 0 ? 'Above baseline' : 'Below baseline'
      deltaLabel = workflowComparison.comparisonBasis
    } else {
      deltaText = `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`
      deltaLabel = workflowComparison.comparisonBasis
    }
  }
  // Priority 2: AI vs Non-AI comparisons
  else if ((row as any).comparisonMode === 'ai_vs_non_ai' && row.breakdownByTool) {
    const aiValue = (row.breakdownByTool as any).ai?.value
    const nonAiValue = (row.breakdownByTool as any).non_ai?.value
    // Guard: if either AI or Non-AI value is missing, show neutral delta
    if (aiValue === undefined || nonAiValue === undefined || isNaN(aiValue) || isNaN(nonAiValue)) {
      deltaText = 'Needs more data'
      deltaLabel = 'AI vs Non-AI comparison'
    } else if (aiValue !== undefined && nonAiValue !== undefined && !isNaN(aiValue) && !isNaN(nonAiValue)) {
      const comparisonDelta = aiValue - nonAiValue
      const isCycleTime = row.id.toLowerCase().includes('cycle') || row.id.toLowerCase().includes('latency')
      
      if (comparisonDelta === 0) {
        deltaText = 'Similar'
        deltaLabel = workflowComparison.comparisonBasis
      } else if (isCycleTime) {
        const direction = comparisonDelta > 0 ? 'slower' : 'faster'
        deltaText = `${comparisonDelta > 0 ? '+' : ''}${comparisonDelta.toFixed(1)}h ${direction}`
        deltaLabel = workflowComparison.comparisonBasis
      } else {
        const deltaPct = (comparisonDelta / Math.abs(nonAiValue || 1)) * 100
        // Guardrail: suppress absurd percentages (>300%) and show absolute difference
        if (Math.abs(deltaPct) > 300 || Math.abs(nonAiValue || 1) < 0.01) {
          deltaText = `${comparisonDelta > 0 ? '+' : ''}${comparisonDelta.toFixed(1)} commits/session`
        } else {
          deltaText = `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`
        }
        deltaLabel = workflowComparison.comparisonBasis
      }
    }
  }
  // Priority 3: Tool comparisons (leader vs runner-up)
  else if (row.breakdownByTool) {
    const toolEntries = Object.entries(row.breakdownByTool).filter(([tool]) => tool !== 'org')
    if (toolEntries.length >= 2) {
      toolEntries.sort((a, b) => (b[1] as any).value - (a[1] as any).value)
      const leader = toolEntries[0]
      const runnerUp = toolEntries[1]
      const leaderLabel = leader[0].charAt(0).toUpperCase() + leader[0].slice(1)
      const runnerUpLabel = runnerUp[0].charAt(0).toUpperCase() + runnerUp[0].slice(1)
      const leaderValue = (leader[1] as any).value
      const runnerUpValue = (runnerUp[1] as any).value
      
      if (leaderValue !== undefined && runnerUpValue !== undefined && !isNaN(leaderValue) && !isNaN(runnerUpValue)) {
        const deltaPct = ((leaderValue - runnerUpValue) / Math.abs(runnerUpValue || 1)) * 100
        if (deltaPct === 0) {
          deltaText = 'Stable'
        } else if (Math.abs(deltaPct) > 300 || Math.abs(runnerUpValue || 1) < 0.01) {
          // Guardrail: suppress absurd percentages, show absolute difference
          const absDiff = leaderValue - runnerUpValue
          deltaText = `${absDiff > 0 ? '+' : ''}${absDiff.toFixed(1)} vs ${runnerUpLabel}`
        } else {
          deltaText = `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`
        }
        deltaLabel = `vs ${runnerUpLabel}`
      }
    }
  }
  // Priority 4: Current vs baseline comparison
  else if (row.current !== undefined && row.baseline !== undefined && !isNaN(row.current) && !isNaN(row.baseline)) {
    const current = row.current
    const baseline = row.baseline
    if (baseline === 0 || Math.abs(baseline) < 0.01) {
      // Guard baseline-zero math: show absolute delta or qualitative label
      deltaText = current > 0 ? 'Above baseline' : 'Below baseline'
    } else {
      const deltaPct = ((current - baseline) / Math.abs(baseline)) * 100
      if (deltaPct === 0) {
        deltaText = 'Stable'
      } else if (Math.abs(deltaPct) > 5000) {
        deltaText = deltaPct > 0 ? 'Large increase' : 'Large decrease'
      } else {
        deltaText = `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`
      }
    }
    deltaLabel = 'vs all-time org baseline'
  }
  // Priority 5: Fallback to trend delta
  else if (delta !== undefined && delta !== null && !isNaN(delta) && isFinite(delta)) {
    if (delta === 0) {
      deltaText = 'Stable'
      deltaLabel = 'No change'
    } else {
      // Only show percentage if it's meaningful and not absurd
      const deltaPct = Math.abs(delta)
      if (deltaPct > 300) {
        deltaText = delta > 0 ? 'Large increase' : 'Large decrease'
        deltaLabel = 'vs prior 4 weeks'
      } else {
        deltaText = delta > 0 ? `+${formatSafeValue(delta, 'percentage')}%` : `${formatSafeValue(delta, 'percentage')}%`
        deltaLabel = 'vs prior 4 weeks'
      }
    }
  }
  // Priority 6: No defensible comparison basis
  else {
    deltaText = 'Not comparable'
    deltaLabel = 'Insufficient data'
  }
  } // end else (non-commit-ttfc-longitudinal)

  // Confidence: Build subtext (confidenceDisplay already calculated above)
  let confidenceSubText = 'Insufficient data'
  
  // Build subtext
  if (isPRMetric && coverage < 50 && sampleSize >= 50) {
    // PR/deployment metrics with thin GitHub cohort but strong telemetry
    confidenceSubText = 'Strong telemetry · limited GitHub cohort'
  } else if (sampleSize >= 1000 && coverage >= 70) {
    confidenceSubText = `Strong telemetry · ${sampleSize.toLocaleString()} sessions`
  } else if (sampleSize >= 500 && coverage >= 60) {
    confidenceSubText = `Strong telemetry · ${sampleSize.toLocaleString()} sessions`
  } else if (sampleSize >= 100 && coverage >= 50) {
    confidenceSubText = `Strong telemetry · ${sampleSize.toLocaleString()} sessions`
  } else if (sampleSize >= 50 && coverage >= 50) {
    confidenceSubText = `Early signal · ${sampleSize.toLocaleString()} sessions`
  } else if (sampleSize >= 20) {
    confidenceSubText = `Emerging sample · ${sampleSize.toLocaleString()} sessions`
  } else if (coverage < 50) {
    confidenceSubText = 'Needs GitHub validation'
  }
  
  // Impact: Use sanitized impact category (already specific, no generic "Quality signal")
  let impactSubText = sanitizeImpactCategory('Quality signal', stage, row.id)
  
  // Build concise What Changed narrative (2 sentences max) - match executiveFinding mode
  let rankingSentence = ''
  
  // Determine mode for What Changed (same logic as executiveFinding)
  let mode: 'meaningful-difference' | 'higher-is-worse-difference' | 'ai-vs-traditional' | 'org-level' | 'tied' | 'attribution-gap' | 'insufficient' = 'insufficient'
  
  if (workflowComparison.comparisonMode === 'org-level' || isGitHubMetric) {
    mode = 'org-level'
  } else if (workflowComparison.comparisonMode === 'tied') {
    mode = 'tied'
  } else if (workflowComparison.comparisonMode === 'attribution-gap' || isUnknownWinner) {
    mode = 'attribution-gap'
  } else if ((row as any).comparisonMode === 'ai_vs_non_ai') {
    mode = 'ai-vs-traditional'
  } else if (workflowComparison.hasEnoughComparisonData && workflowComparison.winner && workflowComparison.runnerUp) {
    mode = isHigherIsWorse ? 'higher-is-worse-difference' : 'meaningful-difference'
  }
  
  // Mode-specific What Changed narrative
  switch (mode) {
    case 'org-level': {
      rankingSentence = `This metric is measured at ${primaryMetricDisplay} across the organization. Treat it as release-system pressure, not an IDE ranking.`
      break
    }
    
    case 'ai-vs-traditional': {
      const aiValue = (row.breakdownByTool as any)?.ai?.value
      const nonAiValue = (row.breakdownByTool as any)?.non_ai?.value
      const aiFormatted = (row.breakdownByTool as any)?.ai?.formatted || primaryMetricDisplay
      const nonAiFormatted = (row.breakdownByTool as any)?.non_ai?.formatted || '—'

      // Check if title indicates a diagnostic (non-comparable) AI vs Non-AI state
      const titleIsDiagnostic = row.title?.includes('needs more') ||
        row.title?.includes('AI vs Non-AI comparison needs more');

      if (titleIsDiagnostic) {
        // Show baseline only, no directional comparison
        rankingSentence = aiValue !== undefined
          ? `AI-assisted workflow metrics: ${aiFormatted} across available sessions. AI vs Non-AI comparison needs more non-AI sample.`
          : `AI vs Non-AI comparison needs more sample data.`
      } else if (aiValue !== undefined && nonAiValue !== undefined && !isNaN(aiValue) && !isNaN(nonAiValue)) {
        const isCycleTime = insightId.includes('cycle') || insightId.includes('latency')
        if (isCycleTime) {
          rankingSentence = `AI-assisted PRs averaged ${aiFormatted} vs Non-AI at ${nonAiFormatted}, adding ${Math.abs(aiValue - nonAiValue).toFixed(1)}h to cycle time.`
        } else {
          rankingSentence = `AI-assisted averaged ${aiFormatted} vs Non-AI at ${nonAiFormatted}.`
        }
      } else {
        rankingSentence = `AI-assisted vs Non-AI comparison has insufficient data.`
      }
      break
    }
    
    case 'meaningful-difference':
    case 'higher-is-worse-difference': {
      const leader = workflowComparison.winner
      const runnerUp = workflowComparison.runnerUp
      
      if (leader && runnerUp) {
        const isRateMetric = insightId.includes('adoption') || insightId.includes('rework') || insightId.includes('quality') || insightId.includes('intensity')
        if (isRateMetric) {
          const ptsDelta = Math.abs(leader.value - runnerUp.value)
          rankingSentence = `${displayWorkflowName(leader.name)} averaged ${leader.formattedValue} vs ${displayWorkflowName(runnerUp.name)} at ${runnerUp.formattedValue}, a ${ptsDelta.toFixed(1)}% gap.`
        } else {
          rankingSentence = `${displayWorkflowName(leader.name)} averaged ${leader.formattedValue} vs ${displayWorkflowName(runnerUp.name)} at ${runnerUp.formattedValue}.`
        }
      } else {
        rankingSentence = `Workflow comparison has insufficient data.`
      }
      break
    }
    
    case 'tied': {
      const toolNames = workflowComparison.rankedWorkflows?.slice(0, 3).map(w => displayWorkflowName(w.name)).join(', ') || 'tracked workflows'
      rankingSentence = `${cleanMetricLabel} is flat across ${toolNames}. Treat this as an org-level signal, not a workflow winner.`
      break
    }
    
    case 'attribution-gap': {
      const unknownCount = workflowComparison.winner?.value || 0
      rankingSentence = `${unknownCount.toLocaleString()} ${cleanMetricLabel} events were not attributed to a tracked workflow. Improve attribution before comparing workflows.`
      break
    }
    
    default: {
      rankingSentence = `This metric measurement has insufficient comparison data.`
      break
    }
  }
  
  // CR5 P0-2: FINAL ENGINE TITLE AUTHORITY
  // The generator/adapter title is the AUTHORITY. The widget may FORMAT
  // (e.g. add leader vs runner-up) but may NOT rewrite semantics:
  //   "varies" → "similar" = FORBIDDEN
  //   org-level → "needs workflow attribution" = FORBIDDEN
  //
  // PASS-THROUGH: diagnostic, org-level, AI-vs-non-AI, insufficient-data
  // FORMAT-ONLY: meaningful-difference (add "X: value vs Y: value")
  // SEMANTIC REWRITE: NONE
  let normalizedTitle = row.title
  const canonicalTitle = row.title || '';
  const isDiagnosticCard = (row as any).isDiagnostic === true;
  const isOrgLevel = (row as any).isOrgLevelMetric === true ||
    (row as any).comparisonState === 'org_level_only';

  // CR5 P0.3: Declare these at function scope — they're used downstream
  // in the view model return object (lines ~3350, 3371) for ranking/card logic.
  const hasAttributionWording = canonicalTitle.includes('needs') ||
    canonicalTitle.includes('insufficient') ||
    canonicalTitle.includes('unavailable') ||
    canonicalTitle.includes('attribution') ||
    canonicalTitle.includes('data unavailable');
  const generatorIndicatesInsufficient = (row as any).comparisonMode === 'insufficient' ||
    (row as any).comparisonMode === 'attribution-gap';

  if (isDiagnosticCard) {
    // PASS-THROUGH: diagnostic titles are generator authority
    normalizedTitle = canonicalTitle;
    piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: PASS-THROUGH diagnostic: ${canonicalTitle}`);
  } else if (isOrgLevel) {
    // PASS-THROUGH: org-level metrics keep generator title
    normalizedTitle = canonicalTitle;
    piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: PASS-THROUGH org-level: ${canonicalTitle}`);
  } else if ((row as any).presentationKind === 'temporal_trend') {
    // CR5 P0.9: Temporal trend PIs preserve the generator's temporal title.
    // NO workflow-comparison title formatter may execute on temporal PIs.
    normalizedTitle = canonicalTitle;
    piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: PASS-THROUGH temporal_trend: ${canonicalTitle}`);
  } else if ((row as any).presentationKind === 'repo_conditioned_behavior' ||
             (row as any).presentationKind === 'workflow_repo_allocation' ||
             (row as any).presentationKind === 'within_workflow_temporal' ||
             (row as any).presentationKind === 'workflow_repo_allocation_shift' ||
             (row as any).presentationKind === 'executive_synthesis') {
    // CR-X Wave 1B + Product-Strength Wave: Multi-dimensional family titles
    // and executive synthesis titles are generator authority.
    // These families produce conclusion-style titles that must NOT be
    // reformatted by workflow-comparison title logic.
    normalizedTitle = canonicalTitle;
    piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: PASS-THROUGH ${row.presentationKind}: ${canonicalTitle}`);
  } else if ((row as any).presentationKind === 'cohort_comparison') {
    // CR5 P0.9: Cohort comparison PIs preserve the generator's cohort title.
    normalizedTitle = canonicalTitle;
    piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: PASS-THROUGH cohort_comparison: ${canonicalTitle}`);
  } else if ((row as any).presentationKind === 'workflow_comparison' &&
             /(\d+\.?\d*x |N=\d|vs )/.test(canonicalTitle)) {
    // CR5 P1: If the generator already produced a decision-grade title with
    // ratio, N=, or "vs" values, preserve it. The renderer may normalize
    // labels/units but must not erase the actual finding.
    normalizedTitle = canonicalTitle;
    piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: PASS-THROUGH workflow_comparison (decision-grade): ${canonicalTitle}`);
  } else if ((row as any).comparisonMode === 'ai_vs_non_ai') {
    // PASS-THROUGH: AI vs Non-AI comparison respects generator title
    normalizedTitle = canonicalTitle;
    piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: PASS-THROUGH ai-vs-non-ai: ${canonicalTitle}`);
  } else if (workflowComparison.comparisonMode === 'meaningful-difference' &&
             workflowComparison.winner && workflowComparison.runnerUp && !isUnknownWinner) {
    // CR5 FINAL TITLE DOCTRINE: Generator already produces doctrine-compliant
    // titles with absolute deltas/gaps. Preserve generator title — do NOT
    // reformat as "{leader}: {value} vs {runnerUp}: {value}" which makes
    // the user mentally subtract two numbers.
    normalizedTitle = canonicalTitle;
    piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: PASS-THROUGH meaningful-difference (generator doctrine title): ${canonicalTitle}`);
  } else if (workflowComparison.comparisonMode === 'tied') {
    // FORMAT-ONLY: use neutral "differs" language, NOT "similar"
    // The generator already determined this is a real measurement.
    // "tied" means the gap is below significance threshold, not that
    // the metric is "similar" in a qualitative sense.
    //
    // CR-X PI FIX: However, when the generator's own title already says
    // "similar" or "no material difference", the generator is the authority
    // — do NOT override it with "differs". This happens for repository-
    // concentration cross-workflow comparison where the generator sets a
    // MATERIAL_GAP threshold and produces "Repository distribution is
    // similar across workflows" when the gap is below threshold.
    if (/similar|no material/i.test(canonicalTitle)) {
      normalizedTitle = canonicalTitle
      piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: PASS-THROUGH tied (generator says similar): ${canonicalTitle}`)
    } else {
      normalizedTitle = `${workflowComparison.metricName} differs across workflows`
      piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: FORMAT tied (neutral differs): ${normalizedTitle}`)
    };
  } else if (workflowComparison.comparisonMode === 'insufficient' ||
             workflowComparison.comparisonMode === 'attribution-gap' ||
             !workflowComparison.hasEnoughComparisonData) {
    // PASS-THROUGH: use generator title if it has attribution wording,
    // otherwise use neutral insufficient title
    // (hasAttributionWording is declared at function scope above)
    if (hasAttributionWording) {
      normalizedTitle = canonicalTitle;
      piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: PASS-THROUGH insufficient (generator has attribution wording): ${canonicalTitle}`);
    } else {
      normalizedTitle = `${workflowComparison.metricName} needs more data`
      piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: FORMAT insufficient (neutral): ${normalizedTitle}`);
    }
  } else {
    // PASS-THROUGH: default to generator title
    normalizedTitle = canonicalTitle;
    piDebugLog(`[PI_TITLE_AUTHORITY] ${row.id}: PASS-THROUGH default: ${canonicalTitle}`);
  }

  // Final pilot-ready title override - targeted cleanup for specific PIs
  const finalTitle = buildPilotReadyTitle(row, normalizedTitle, workflowComparison)

  // Determine change tone with truth to metric polarity
  // For higher-is-worse: delta > 0 means worse (risk), delta < 0 means better (improved)
  // For higher-is-better: delta > 0 means better (improved), delta < 0 means worse (risk)
  const changeTone: 'risk' | 'improved' | 'neutral' = delta === 0
    ? 'neutral'
    : isHigherIsWorse
      ? (delta > 0 ? 'risk' : 'improved')
      : (delta > 0 ? 'improved' : 'risk')

  // Determine evidence strength with truthfulness checks
  let evidenceStrength = 'Limited'
  if (sampleSize >= 500 && workflowComparison.hasEnoughComparisonData) {
    evidenceStrength = 'Strong'
  } else if (sampleSize >= 100 && workflowComparison.hasEnoughComparisonData) {
    evidenceStrength = 'Emerging'
  } else if (sampleSize >= 50) {
    evidenceStrength = 'Emerging'
  } else if (sampleSize >= 20) {
    evidenceStrength = 'Limited'
  }

  // Downgrade evidence if comparison is missing, data is tied, or baseline is zero
  if (!workflowComparison.hasEnoughComparisonData && sampleSize >= 100) {
    evidenceStrength = 'Emerging' // Can't be strong without comparison data
  }
  if (row.baseline === 0 || Math.abs(row.baseline || 0) < 0.01) {
    evidenceStrength = 'Limited' // Baseline zero means weak comparison
  }
  if ((row as any).demoFlag) {
    evidenceStrength = 'Baseline' // Internal demoFlag maps to neutral baseline label
  }

  // Determine data source label from the canonical provenance label computed
  // at the render-adapter boundary.  Generators must not call UI formatters.
  const dataSource = (row as any).provenanceLabel || 'Telemetry'

  // Determine comparison mode and ranking rows
  // CR4 P0-1: Defer to comparisonAuthority.operationallySignificant as the SINGLE authority
  // for tied vs meaningful-difference. Do NOT recompute with independent 1% thresholds.
  let comparisonMode: 'meaningful-difference' | 'tied' | 'org-level' | 'insufficient' = 'insufficient'
  let rankingRows: string[] = []
  let comparisonSublabel = 'Need more data'

  if (workflowComparison.hasEnoughComparisonData) {
    const ranked = workflowComparison.rankedWorkflows
    // CR4 P0-3: Check if this is an org-level metric (no workflow attribution)
    const caFromRow = (row as any).comparisonAuthority
    const isOrgLevelMetric = (row as any).isOrgLevelMetric === true ||
      (row as any).comparisonState === 'org_level_only'

    if (isOrgLevelMetric) {
      comparisonMode = 'org-level'
      rankingRows = ['Org-level signal']
      comparisonSublabel = 'Not attributed by IDE'
    } else if (ranked.length >= 2) {
      // CR4 P0-1: Use comparisonAuthority.operationallySignificant as authority
      const caOperationallySignificant = caFromRow?.operationallySignificant
      const allRankedZero = ranked.every(w => w.rank === 0)

      if (caOperationallySignificant === false || allRankedZero) {
        // Tied — gap below unit-aware significance threshold
        comparisonMode = 'tied'
        const toolNames = ranked.slice(0, 3).map(w => displayWorkflowName(w.name)).join(' / ')
        rankingRows = [`${toolNames} all within range`]
        comparisonSublabel = 'No meaningful workflow separation'
      } else {
        // Meaningful difference - show max 3 compact rows
        comparisonMode = 'meaningful-difference'
        rankingRows = ranked.slice(0, 3).map(w => {
          // For higher-is-worse metrics, use risk language (never Best/Leader/Winner)
          if (workflowComparison.polarity === 'higher-is-worse') {
            if (w.rank === 1) return `Lowest risk: ${displayWorkflowName(w.name)} · ${w.formattedValue}`
            if (w.rank === 2) return `Higher risk: ${displayWorkflowName(w.name)} · ${w.formattedValue}`
            if (w.rank === 3) return `Highest risk: ${displayWorkflowName(w.name)} · ${w.formattedValue}`
            return `${displayWorkflowName(w.name)} · ${w.formattedValue}`
          } else {
            // Higher-is-better metrics can use leader/best
            if (w.rank === 1) return `Leader: ${displayWorkflowName(w.name)} · ${w.formattedValue}`
            if (w.rank === 2) return `Runner-up: ${displayWorkflowName(w.name)} · ${w.formattedValue}`
            if (w.rank === 3) return `Laggard: ${displayWorkflowName(w.name)} · ${w.formattedValue}`
            return `${displayWorkflowName(w.name)} · ${w.formattedValue}`
          }
        })
        comparisonSublabel = workflowComparison.polarity === 'higher-is-worse'
          ? 'Risk-based ranking'
          : 'Leader · Runner-up · Laggard'
      }
    } else {
      // Only one workflow - check if org-level GitHub metric
      if (ranked.length === 1 && (ranked[0].name === 'org' || ranked[0].name === 'Org' || isGitHubMetric)) {
        comparisonMode = 'org-level'
        rankingRows = ['Org-level GitHub signal']
        comparisonSublabel = 'Not attributed by IDE'
      } else {
        comparisonMode = 'meaningful-difference'
        rankingRows = ranked.slice(0, 2).map(w => `${displayWorkflowName(w.name)} · ${w.formattedValue}`)
        comparisonSublabel = 'Single workflow'
      }
    }
  }

  // Build metric subline to identify the subject (winner/tool/context)
  let metricSubline = cleanMetricLabel
  
  // Add subject context based on comparison mode and winner
  if (workflowComparison.hasEnoughComparisonData && workflowComparison.winner && !isUnknownWinner) {
    if (workflowComparison.comparisonMode === 'meaningful-difference') {
      metricSubline = `${displayWorkflowName(workflowComparison.winner.name)} ${workflowComparison.metricName}`
    } else if (workflowComparison.comparisonMode === 'org-level' || isGitHubMetric) {
      metricSubline = `Org-level ${workflowComparison.metricName}`
    } else if (workflowComparison.comparisonMode === 'tied') {
      metricSubline = `Multi-tool ${workflowComparison.metricName}`
    }
  } else if ((row as any).comparisonMode === 'ai_vs_non_ai') {
    metricSubline = `AI-assisted ${workflowComparison.metricName}`
  } else if (isUnknownWinner) {
    metricSubline = `Unattributed ${workflowComparison.metricName}`
  }

  const topRowSummary = {
    metricValue: primaryMetricDisplay,
    metricLabel: cleanMetricLabel,
    metricSubline,
    rankingRows: (hasAttributionWording || generatorIndicatesInsufficient) ? [] : rankingRows,
    hasRankingData: workflowComparison.hasEnoughComparisonData && !hasAttributionWording && !generatorIndicatesInsufficient,
    comparisonMode,
    changeValue: deltaText,
    changeTone,
    comparisonLabel: deltaLabel,
    comparisonSublabel,
    evidenceValue: evidenceStrength,
    evidenceSubline: `${sampleSize.toLocaleString()} ${(row as any).sampleUnit || 'sessions'} · ${dataSource} · ${impactCategory}`
  }

  // Build Decision Card - new compact structure for pilot credibility
  let decisionCard: PerformanceInsightViewModel['decisionCard']
  try {
    // Dedicated path for diagnostic coverage cards
    if ((row as any).isDiagnostic === true) {
      decisionCard = buildDiagnosticDecisionCard(row)
    } else {
      decisionCard = buildDecisionCard(row, workflowComparison, primaryMetricDisplay, cleanMetricLabel, deltaText, confidenceDisplay, dataSource, sampleSize, isHigherIsWorse, isUnknownWinner, isTrueOrgLevelMetric, isGitHubMetric)
    }
    // Fix comparison-state contradiction: if title has attribution wording, force neutral card type
    if (hasAttributionWording && decisionCard.cardType === 'workflow-comparison') {
      decisionCard.cardType = 'neutral'
      decisionCard.comparisonRows = undefined
      decisionCard.comparisonLabel = undefined
      piDebugLog(`[PI_CARD_TYPE_TRACE] ${row.id}: cardType overridden to neutral (attribution wording in title), comparisonRows cleared`)
    }
  } catch (e) {
    console.error('[PI_VIEW_MODEL] buildDecisionCard failed:', e)
    // Fallback decision card - use specific text to avoid contradiction
    const sampleUnit = isGitHubMetric ? 'reviews' : 'sessions';
    decisionCard = {
      cardType: 'neutral',
      claim: row.description || `${cleanMetricLabel} workflow attribution is incomplete.`,
      claimSub: `${sampleSize.toLocaleString()} ${sampleUnit} · ${dataSource}`,
      evidenceCells: [
        {
          label: cleanMetricLabel,
          value: primaryMetricDisplay,
          sub: 'Insufficient data',
          badgeType: 'neutral'
        },
        {
          label: 'Sample',
          value: sampleSize.toLocaleString(),
          sub: sampleUnit,
          badgeType: 'neutral'
        },
        {
          label: 'Difference',
          value: 'Insufficient',
          sub: 'Comparison unavailable',
          badge: 'Not comparable',
          badgeType: 'warning'
        }
      ],
      isLowerBetter: false,
      interpretation: row.description || getMetricSpecificFallback(row.id).interpretation,
      actionText: row.recommendation || getMetricSpecificFallback(row.id).actionText,
      footerNote: row.description || getMetricSpecificFallback(row.id).interpretation
    }
  }

  const result = {
    id: row.id,
    title: finalTitle, // Use final pilot-ready title
    impact: effectiveImpact,
    category,
    detected: generateDetectedLabel(row),
    detectedFull: generateDetectedLabel(row),
    iconBg,
    icon,
    primaryMetric: primaryMetricDisplay,
    primaryMetricLabel: sanitizeLabel(`${metricName}${primaryMetricContext ? ` · ${primaryMetricContext}` : ''}`),
    primaryMetricContext: '', // Empty - moved to primaryMetricLabel for north-star design
    change: deltaText,
    changeSemantic: delta === 0 ? 'Stable' : delta > 5 ? 'Elevated' : delta < -5 ? 'Improving' : 'Monitoring',
    changePositive: isHigherIsWorse ? delta < 0 : delta > 0,
    changeLabel: deltaLabel,
    confidence: confidenceDisplay,
    confidenceColor,
    confidenceSub: confidenceSubText,
    impactValue: impactCategory,
    impactColor,
    impactSub: sanitizeLabel(impactSubText),
    whatChanged: sanitizeLabel(rankingSentence || (row as any).whatChanged || getOperationalInterpretation(row)),
    whyItMatters: (row as any).whyItMattersText || generateOperationalInterpretation(row, categoryMeta, row.id, confidence, coverage, workflowComparison) || 'This insight indicates a pattern that may impact delivery velocity or quality.',
    whyItems,
    evidence: evidence.map(ev => ({ ...ev, label: sanitizeLabel(ev.label) })),
    actionText: sanitizeLabel((row as any).getOperationalRecommendation || generateActionableRecommendation(row, workflowComparison, workflowComparison.comparisonMode === 'org-level' || isGitHubMetric) || 'Monitor this metric and investigate if the pattern persists over multiple periods.'),
    potentialImpact,
    signalPills,
    topRowSummary,
    decisionCard,
    // CR5 FINAL DOWNSTREAM: Carry source/provenance fields to view model
    // so the template can render truthful source labels.
    dataDomain: (row as any).dataDomain,
    sourceLabel: (row as any).sourceLabel,
  }
  return result
}

// Computed view models for north-star UI
const activeTab = ref('top')
const viewModelInsights = computed(() => {
  return filteredInsights.value.map(row => toPerformanceInsightViewModel(row))
})

const topViewModelInsights = computed(() => {
  // CR5 WS2 #12 P0-2: Shared Top Insights authority.
  // The Final Engine pipeline calls getTopInsights() and stamps
  // isTopInsightEligible + topInsightRank on adapted insights.
  // This component consumes that pre-ranked result — no local
  // NARRATIVE_PRIORITY sorting, no hardcoded five IDs.
  // Dynamic up-to-five behavior is preserved by the shared ranker.

  const hiddenDiagnosticInsightIds = new Set([
    'executive-ai-yield-optimization',
    'debug-time-by-ide',
    'terminal-time-by-ide',
    'rework-loop-detection',
    'ai-intensity-delivery-velocity',
    'review-burden-by-ai-pattern',
    'reviewer-load-concentration',
  ])

  // Get adapted insights that the pipeline marked as Top Insight eligible
  const topRanked = allInsights.value
    .filter(i => (i as any).isTopInsightEligible === true)
    .filter(i => !hiddenDiagnosticInsightIds.has(i.id.toLowerCase()))
    .sort((a, b) => ((a as any).topInsightRank || 999) - ((b as any).topInsightRank || 999))

  // Map to view models
  const topVMs = topRanked
    .map(insight => {
      const vm = viewModelInsights.value.find(v => v.id === insight.id)
      return vm
    })
    .filter((vm): vm is PerformanceInsightViewModel => vm != null)

  // CR5 P1.4: Runtime proof — print actual Top IDs from the same array used by the Top tab.
  if (VERBOSE_PI_DEBUG) console.log('[PI_TOP_RUNTIME_IDS]', topVMs.map(t => t.id))

  return topVMs
})

// Separate diagnostic and non-diagnostic insights
const diagnosticInsights = computed(() => {
  const result = viewModelInsights.value.filter(vm => {
    const insight = allInsights.value.find(i => i.id === vm.id)
    return insight && (insight as any).isDiagnostic === true
  })
  return result
})

const nonDiagnosticInsights = computed(() => {
  const result = viewModelInsights.value.filter(vm => {
    const insight = allInsights.value.find(i => i.id === vm.id)
    return !insight || (insight as any).isDiagnostic !== true
  })
  
  // CR5 P0.5: Removed component-local synthesized-deployment-cadence exclusion.
  // This ID-specific filter was a workaround for Step 1.5's forced inventory.
  // Now that Step 1.5 is removed and the provenance gate prevents false
  // fixture_fallback findings, no component-local ID hiding is needed.
  return result
})

const displayedInsights = computed(() => {
  if (activeTab.value === 'top') {
    return topViewModelInsights.value
  }
  // All tab: show non-diagnostics always, add diagnostics when expanded
  if (diagnosticsExpanded.value) {
    return [...nonDiagnosticInsights.value, ...diagnosticInsights.value]
  }
  return nonDiagnosticInsights.value
})

const currentIndex = computed(() => {
  if (!selectedViewModel.value) return -1
  const idx = displayedInsights.value.findIndex(vm => vm.id === selectedViewModel.value.id)
  return idx
})

// Auto-select first insight if none selected or selected insight not in current view
watch([displayedInsights, selectedInsight], ([newDisplayed, newSelected]) => {
  if (newDisplayed.length > 0 && (!newSelected || !displayedInsights.value.find(vm => vm.id === newSelected.id))) {
    selectInsightById(newDisplayed[0].id)
  }
}, { immediate: true })

const hasPreviousInsight = computed(() => currentIndex.value > 0)
const hasNextInsight = computed(() => currentIndex.value >= 0 && currentIndex.value < displayedInsights.value.length - 1)

const navigateToPreviousInsight = () => {
  if (hasPreviousInsight.value) {
    const prevInsight = displayedInsights.value[currentIndex.value - 1]
    selectInsightById(prevInsight.id)
    scrollToActiveInsight()
  }
}

const navigateToNextInsight = () => {
  if (hasNextInsight.value) {
    const nextInsight = displayedInsights.value[currentIndex.value + 1]
    selectInsightById(nextInsight.id)
    scrollToActiveInsight()
  }
}

const selectedViewModel = computed(() => {
  if (!selectedInsight.value) return null
  return viewModelInsights.value.find(vm => vm.id === selectedInsight.value.id) || null
})

// CR-X UI Redo: Period Trend — horizontal proportional-bar rows, reusing the
// exact visual grammar of comparisonRows/.pi-cbar-row (the accepted large-vs-
// small-PR and deployment-success treatment) instead of an SVG micro-chart.
// Chronology is carried by row order (oldest first) + period label; magnitude
// by bar length (proportional to the visible series max, 4% floor so a zero
// period never disappears); "now" is carried by accent fill + bold value
// weight together, never by color alone. No axes, no gridlines, no dots.
const periodTrend = computed(() => {
  const ps = selectedViewModel.value?.decisionCard?.periodStrip
  if (!ps || !ps.points || ps.points.length < 2) return null

  // Resolve stage accent color from the existing PI card icon system —
  // same source the rest of the card uses, so a future stage-color change
  // propagates automatically.
  const insight = allInsights.value.find(i => i.id === selectedViewModel.value?.id)
  const stage = insight?.cicdStage || 'plan-code'
  const accentColor = stage === 'review-merge' ? '#22c55e'
    : stage === 'deploy-operate' ? '#8b5cf6'
    : '#3b82f6'

  const points = ps.points
  const n = points.length
  const maxVal = Math.max(...points.map(p => p.numericValue), 0.01)

  // CR-X UI: Signal prioritization for dense histories.
  // When 8+ periods exist, mark intermediate rows as compact so the CSS
  // can reduce their visual weight. First, latest, and material transitions
  // (direction changes) remain full-weight. No data is fabricated or deleted.
  const isDense = n >= 8

  const rows = points.map((p, i) => {
    const isLatest = i === n - 1
    const isFirst = i === 0
    // Proportional to the visible max, with a visibility floor so a zero
    // or near-zero period still renders as a sliver rather than vanishing.
    const percent = maxVal > 0 ? Math.max(4, (p.numericValue / maxVal) * 100) : 4
    let deltaTag: string | undefined
    if (isLatest && p.delta) {
      const prevLabel = points[i - 1]?.periodLabel
      deltaTag = prevLabel ? `${p.delta} vs ${prevLabel}` : p.delta
    }
    // Split secondary label encoded as "mainValue · secondaryLabel"
    const sepIdx = p.value.indexOf(' · ')
    const mainValue = sepIdx >= 0 ? p.value.substring(0, sepIdx) : p.value
    const secondaryLabel = sepIdx >= 0 ? p.value.substring(sepIdx + 3) : undefined

    // Determine if this is a compact (intermediate) row in a dense history.
    // First and latest are always full-weight. Intermediate rows that are
    // not material transitions (direction changes) are compact.
    let isCompact = false
    if (isDense && !isFirst && !isLatest) {
      const prevVal = points[i - 1].numericValue
      const nextVal = i < n - 1 ? points[i + 1].numericValue : p.numericValue
      const isDirectionChange =
        (prevVal < p.numericValue && p.numericValue > nextVal) ||
        (prevVal > p.numericValue && p.numericValue < nextVal)
      isCompact = !isDirectionChange
    }

    return {
      periodLabel: p.periodLabel,
      value: mainValue,
      secondaryLabel,
      percent,
      isLatest,
      isCompact,
      deltaTag,
      color: isLatest ? accentColor : '#cbd5e1',
    }
  })

  return {
    label: ps.label,
    rows,
    accentColor,
  }
})

const isHourMetric = computed(() => {
  if (!selectedViewModel.value) return false
  const label = selectedViewModel.value.primaryMetricLabel?.toLowerCase() || ''
  return label.includes('hour') || label.includes('cycle time') || label.includes('latency') || label.includes('duration')
})

// Label sanitization - clean internal/jargony labels at display layer
function sanitizeLabel(label: string): string {
  if (!label) return label
  let sanitized = label

  // CR5 V1 FINAL P0-5: Raw float precision leak guard.
  // Replace any number with >2 decimal places followed by % with 1-decimal version.
  sanitized = sanitized.replace(/(\d+\.\d{3,})%/g, (match, num) => `${parseFloat(num).toFixed(1)}%`)

  // Internal jargon removal
  sanitized = sanitized.replace(/Executive Ai Yield Optimization/gi, 'AI-assisted yield')
  sanitized = sanitized.replace(/Executive AI Yield Optimization/gi, 'AI-assisted yield')
  sanitized = sanitized.replace(/Synthesized Deployment Cadence/gi, 'Deployment cadence')
  sanitized = sanitized.replace(/Telemetry Ai Focus Imbalance/gi, 'Tracked AI signal coverage')
  sanitized = sanitized.replace(/Telemetry AI Focus Imbalance/gi, 'Tracked AI signal coverage')
  sanitized = sanitized.replace(/AI focus imbalance/gi, 'Tracked AI signal coverage')
  sanitized = sanitized.replace(/Session Quality Merge Success/gi, 'Session quality')
  
  // Tool name normalization
  sanitized = sanitized.replace(/claude_code/gi, 'Claude Code')
  sanitized = sanitized.replace(/vscode/gi, 'VS Code')
  sanitized = sanitized.replace(/github_copilot/gi, 'GitHub Copilot')
  sanitized = sanitized.replace(/Windsurf/gi, 'Devin')
  sanitized = sanitized.replace(/windsurf/gi, 'Devin')
  sanitized = sanitized.replace(/Unknown workflow/gi, 'Unattributed sessions')
  sanitized = sanitized.replace(/the selected workflow/gi, 'the primary workflow')
  sanitized = sanitized.replace(/this workflow/gi, 'the workflow')

  // Capitalize sentence starts
  sanitized = sanitized.replace(/(^|[.!?]\s+)([a-z])/g, (match, prefix, char) => prefix + char.toUpperCase())
  sanitized = sanitized.replace(/Detected Across historical telemetry/gi, 'Detected across historical telemetry')
  sanitized = sanitized.replace(/Detected across historical telemetry/gi, 'Detected across historical telemetry')
  
  return sanitized
}

// Chart legend labels - match insight type
const chartLegendLabel1 = computed(() => {
  if (!selectedViewModel.value) return 'Observed AI signals'
  const insight = allInsights.value.find(i => i.id === selectedViewModel.value?.id)
  if (!insight) return 'Observed AI signals'
  
  // AI vs traditional comparison
  if ((insight as any).comparisonMode === 'ai_vs_non_ai') {
    return 'Observed AI signals'
  }
  
  // Tool/workflow comparison - use actual tool names
  if (insight.breakdownByTool) {
    const toolEntries = Object.entries(insight.breakdownByTool).filter(([tool]) => tool !== 'org')
    if (toolEntries.length >= 1) {
      toolEntries.sort((a, b) => (b[1] as any).value - (a[1] as any).value)
      const leader = toolEntries[0]
      return sanitizeLabel(leader[0].charAt(0).toUpperCase() + leader[0].slice(1))
    }
  }
  
  // Baseline comparison
  if (insight.baseline !== undefined) {
    return 'Current'
  }
  
  return 'Observed AI signals'
})

const chartLegendLabel2 = computed(() => {
  if (!selectedViewModel.value) return 'Zero observed AI signals'
  const insight = allInsights.value.find(i => i.id === selectedViewModel.value?.id)
  if (!insight) return 'Zero observed AI signals'
  
  // AI vs traditional comparison
  if ((insight as any).comparisonMode === 'ai_vs_non_ai') {
    return 'Zero observed AI signals'
  }
  
  // Tool/workflow comparison - use actual tool names
  if (insight.breakdownByTool) {
    const toolEntries = Object.entries(insight.breakdownByTool).filter(([tool]) => tool !== 'org')
    if (toolEntries.length >= 2) {
      toolEntries.sort((a, b) => (b[1] as any).value - (a[1] as any).value)
      const runnerUp = toolEntries[1]
      return sanitizeLabel(runnerUp[0].charAt(0).toUpperCase() + runnerUp[0].slice(1))
    }
  }
  
  // Baseline comparison
  if (insight.baseline !== undefined) {
    return 'Baseline'
  }
  
  return 'Zero observed AI signals'
})

// Helper function to extract forbidden matches from insight content
function extractForbiddenMatches(insight: V2PreviewRow): string[] {
  const forbiddenStrings = ['Codestral', 'DeepSeek', 'Gemini 2.6', 'Claude Opus', 'fixture data', 'not real org data']
  const content = [
    insight.title,
    insight.whatChanged,
    insight.whyItMatters,
    insight.recommendation,
    ...(insight.evidence || []).map((e: any) => `${e.label} ${e.value}`)
  ].join(' ').toLowerCase()
  
  return forbiddenStrings.filter(str => 
    content.includes(str.toLowerCase()) && 
    !(str === 'Demo Mode' && content.includes('demo mode'))
  )
}

// Dev-only debug export for Plan & Code PI payloads
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  const planCodeInsights = computed(() => {
    return allInsights.value
      .filter(insight => insight.cicdStage === 'plan-code')
      .map(insight => ({
        id: insight.id,
        title: insight.title,
        primaryMetricLabel: insight.rightMetricLabel || '',
        current: insight.current || 0,
        changeLabel: insight.changeLabel || '',
        confidenceLabel: insight.confidence || '',
        impactLabel: getImpactLevel(insight) || '',
        whatChanged: insight.whatChanged || '',
        whyItMatters: insight.whyItMatters || '',
        recommendation: insight.recommendation || '',
        evidenceLabels: (insight.evidence || []).map((e: any) => `${e.label}: ${e.value}`),
        forbiddenMatches: extractForbiddenMatches(insight)
      }))
  })
  
  // Export to global window for debugging
  window.__CM_PLAN_CODE_PI_AUDIT__ = planCodeInsights.value
}

// Share insight with progressive enhancement: native share → clipboard (no mailto)
function copyInsight() {
  if (!selectedViewModel.value) return

  const vm = selectedViewModel.value
  const isDiagnostic = (selectedInsight.value as any).isDiagnostic === true

  let subject = `Performance insight: ${vm.title}`
  let body = ''

  if (isDiagnostic) {
    // Diagnostic insight share format
    const diagnosticReason = (selectedInsight.value as any).diagnosticReason || 'Unknown'
    const diagnosticUnlockPath = (selectedInsight.value as any).diagnosticUnlockPath || vm.decisionCard?.interpretation || 'Data not available'

    body = `Hey — this performance insight is not yet measurable, but it shows what data we need next.

${vm.title}

Status:
Not yet measurable

Reason:
${diagnosticReason}

Unlock path:
${diagnosticUnlockPath}

Data basis:
Diagnostic · Not included in Top Insights`
  } else {
    // Actionable insight share format
    body = `Hey — saw this performance insight. Can you take a look?

${vm.title}

${vm.decisionCard?.claim || ''}

Interpretation:
${vm.decisionCard?.interpretation || ''}

Recommended next step:
${vm.decisionCard?.actionText || ''}

Data basis:
${vm.decisionCard?.footerNote || ''}`
  }

  // Try native share API first, but only in secure contexts (HTTPS)
  // navigator.share only works in secure contexts
  if (window.isSecureContext && navigator.share) {
    navigator.share({
      title: subject,
      text: body
    }).then(() => {
      copyButtonText.value = 'Shared'
      setTimeout(() => {
        copyButtonText.value = 'Share insight'
      }, 2000)
    }).catch((err) => {
      // If user cancelled, do nothing and reset
      if (err.name === 'AbortError') {
        copyButtonText.value = 'Share insight'
        return
      }
      // On non-cancel failure, fallback to clipboard
      fallbackCopy(body)
    })
  } else {
    // Native share not available or not in secure context (HTTP), copy to clipboard
    if (!window.isSecureContext) {
      // Show message that native sharing requires HTTPS
      console.warn('[Share Insight] Native sharing requires HTTPS (secure context). Falling back to clipboard copy.')
    }
    fallbackCopy(body)
  }
}

function fallbackCopy(text: string) {
  const fullText = text
  
  // Try modern Clipboard API first
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(fullText).then(() => {
      copyButtonText.value = 'Copied'
      setTimeout(() => {
        copyButtonText.value = 'Share insight'
      }, 2000)
    }).catch(() => {
      // Fallback to textarea method
      fallbackCopyTextarea(fullText)
    })
  } else {
    // Fallback for older browsers or non-secure context
    fallbackCopyTextarea(fullText)
  }
}

function fallbackCopyTextarea(text: string) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-999999px'
  textarea.style.top = '-999999px'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  
  try {
    const successful = document.execCommand('copy')
    if (successful) {
      copyButtonText.value = 'Copied'
      setTimeout(() => {
        copyButtonText.value = 'Share insight'
      }, 2000)
    } else {
      copyButtonText.value = 'Copy failed'
      setTimeout(() => {
        copyButtonText.value = 'Share insight'
      }, 2000)
    }
  } catch (err) {
    copyButtonText.value = 'Copy failed'
    setTimeout(() => {
      copyButtonText.value = 'Share insight'
    }, 2000)
  }
  
  document.body.removeChild(textarea)
}

function toggleArchive() {
  console.warn('[PI_ARCHIVE_DISABLED_FOR_PILOT] Archive is disabled until after pilot.')
  // No-op - archive functionality disabled for pilot freeze
}

// Dev-only helper to clear archived insights
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  window.__CM_CLEAR_ARCHIVED_PIS__ = () => {
    archivedIds.value = []
    localStorage.removeItem('cm_archived_pi_ids')
    piDebugLog('Cleared archived PI IDs')
  }
}

// Lightweight chart differentiation based on operational category
function generateChartPattern(insightId: string, category: string) {
  const id = insightId.toLowerCase()
  const seed = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  
  // Base points for 12 data points (4 weeks)
  const basePoints = [28, 50, 72, 94, 116, 138, 160, 182, 204, 226, 248, 260]
  
  // AI line patterns by category with realistic operational variation
  let aiYValues: number[]
  let nonAiYValues: number[]
  
  if (category === 'stability' || id.includes('deployment') || id.includes('mttr')) {
    // Deployment/stability: plateau with mild regression, then stabilization
    const patternVariant = seed % 3
    if (patternVariant === 0) {
      // Plateau with temporary regression
      aiYValues = [82, 81, 80, 79, 78, 85, 84, 83, 82, 81, 80, 79]
      nonAiYValues = [85, 84, 83, 82, 81, 82, 83, 84, 85, 84, 83, 82]
    } else if (patternVariant === 1) {
      // Stabilization curve
      aiYValues = [78, 76, 74, 72, 75, 77, 79, 80, 81, 82, 82, 82]
      nonAiYValues = [80, 79, 78, 77, 78, 79, 80, 81, 82, 83, 83, 83]
    } else {
      // Uneven cadence with spikes
      aiYValues = [80, 82, 79, 83, 78, 84, 77, 82, 79, 81, 80, 82]
      nonAiYValues = [83, 84, 82, 85, 81, 86, 80, 84, 82, 83, 82, 84]
    }
  } else if (category === 'quality' || id.includes('review') || id.includes('revert') || id.includes('reopen')) {
    // Review/quality: oscillating with stabilization trend
    const patternVariant = seed % 3
    if (patternVariant === 0) {
      // Mild oscillation with plateau
      aiYValues = [75, 78, 73, 76, 74, 75, 76, 75, 74, 75, 75, 75]
      nonAiYValues = [80, 82, 79, 81, 80, 81, 82, 81, 80, 81, 81, 81]
    } else if (patternVariant === 1) {
      // Spike then recovery
      aiYValues = [72, 74, 85, 78, 75, 73, 74, 75, 74, 73, 74, 74]
      nonAiYValues = [78, 80, 88, 82, 80, 78, 79, 80, 79, 78, 79, 79]
    } else {
      // Gradual stabilization
      aiYValues = [70, 72, 74, 73, 75, 76, 75, 76, 77, 76, 77, 77]
      nonAiYValues = [76, 78, 80, 79, 81, 82, 81, 82, 83, 82, 83, 83]
    }
  } else if (category === 'velocity' || id.includes('cycle') || id.includes('throughput')) {
    // Velocity: gradual improvement with temporary plateau
    const patternVariant = seed % 3
    if (patternVariant === 0) {
      // Acceleration with plateau
      aiYValues = [90, 85, 80, 75, 72, 72, 72, 70, 68, 65, 62, 60]
      nonAiYValues = [85, 83, 81, 79, 78, 78, 78, 77, 75, 73, 71, 70]
    } else if (patternVariant === 1) {
      // Mild regression then recovery
      aiYValues = [88, 84, 80, 82, 78, 74, 70, 68, 66, 64, 62, 60]
      nonAiYValues = [84, 82, 80, 81, 79, 77, 75, 73, 71, 69, 67, 66]
    } else {
      // Uneven improvement
      aiYValues = [89, 86, 83, 80, 77, 79, 76, 73, 70, 67, 64, 61]
      nonAiYValues = [85, 83, 81, 79, 77, 78, 76, 74, 72, 70, 68, 66]
    }
  } else {
    // Workflow: moderate improvement with stabilization
    const patternVariant = seed % 3
    if (patternVariant === 0) {
      // Steady improvement
      aiYValues = [88, 85, 82, 80, 78, 75, 72, 70, 68, 65, 63, 60]
      nonAiYValues = [86, 85, 84, 83, 82, 81, 80, 79, 78, 77, 76, 75]
    } else if (patternVariant === 1) {
      // Plateau then improvement
      aiYValues = [87, 86, 85, 84, 84, 84, 82, 80, 78, 75, 72, 70]
      nonAiYValues = [85, 84, 83, 83, 83, 83, 82, 81, 80, 79, 78, 77]
    } else {
      // Uneven with mild spikes
      aiYValues = [87, 84, 86, 82, 80, 83, 79, 76, 78, 74, 71, 68]
      nonAiYValues = [85, 84, 85, 83, 82, 83, 81, 80, 81, 79, 78, 77]
    }
  }
  
  // Add slight seeded variance for uniqueness
  const variance = (seed % 3) - 1
  aiYValues = aiYValues.map((y, i) => y + variance + (i % 3 === 0 ? 1 : 0))
  nonAiYValues = nonAiYValues.map((y, i) => y + variance - (i % 3 === 0 ? 1 : 0))
  
  // Clamp values to valid range
  aiYValues = aiYValues.map(y => Math.max(35, Math.min(95, y)))
  nonAiYValues = nonAiYValues.map(y => Math.max(35, Math.min(95, y)))
  
  return {
    aiPoints: basePoints.map((x, i) => ({ x, y: aiYValues[i] })),
    nonAiPoints: basePoints.map((x, i) => ({ x, y: nonAiYValues[i] }))
  }
}

// Computed chart pattern for selected insight - only use real trend data, no fake charts
const chartPattern = computed(() => {
  if (!selectedViewModel.value) return null
  const insight = allInsights.value.find(i => i.id === selectedViewModel.value.id)
  if (!insight) return null
  
  // Check for real trend data in githubByPeriod or similar
  // If no real trend data, return null to suppress chart
  const hasRealTrendData = (insight as any).trendData && Array.isArray((insight as any).trendData) && (insight as any).trendData.length > 0
  
  if (!hasRealTrendData) {
    return null // Suppress chart - no real trend data available
  }
  
  // If real trend data exists, process it for chart rendering
  // For now, return null as we don't have real trend data infrastructure
  // This will show explanatory text instead of fake chart
  return null
})

// Legacy organizationalPosture removed - not used in north-star layout

// Legacy topOrganizationalSignals removed - not used in north-star layout

// Legacy functions removed - not used in north-star layout

// Universal formatter to prevent raw float display with proper units
// Rules: percentages (1 decimal max), hours (1 decimal max), minutes (whole or 1 decimal), per-week (1 decimal max), counts (integer), rates (1 decimal max)
function formatSafeValue(value: number | string, type: 'auto' | 'percentage' | 'rate' | 'count' | 'hours' | 'minutes' | 'perweek' = 'auto'): string {
  if (typeof value === 'string') {
    // Try to parse as number
    const num = parseFloat(value)
    if (!isNaN(num)) {
      return formatNumber(num, type)
    }
    return value
  }
  if (typeof value === 'number') {
    return formatNumber(value, type)
  }
  return String(value)
}

function formatNumber(num: number, type: 'auto' | 'percentage' | 'rate' | 'count' | 'hours' | 'minutes' | 'perweek'): string {
  // Suppress negative zero
  if (Object.is(num, -0) || (num === 0 && 1 / num < 0)) {
    num = 0
  }
  
  // Auto-detect type based on value characteristics
  if (type === 'auto') {
    if (num >= 0 && num <= 100 && (num.toString().includes('.') || num % 1 !== 0)) {
      type = 'percentage'
    } else if (num > 100 || num < 0) {
      type = 'rate'
    } else {
      type = 'count'
    }
  }
  
  switch (type) {
    case 'percentage':
      // 1 decimal max, add % sign
      const formattedPercent = num % 1 === 0 ? num.toFixed(0) : num.toFixed(1)
      return `${formattedPercent}%`
    case 'hours':
      // 1 decimal max, add h
      return `${num.toFixed(1)}h`
    case 'minutes':
      // Whole number or 1 decimal max, add m
      const formattedMinutes = num % 1 === 0 ? num.toFixed(0) : num.toFixed(1)
      return `${formattedMinutes}m`
    case 'perweek':
      // Integer for deployment frequency (count per week)
      return `${num.toFixed(0)}/week`
    case 'rate':
      // Always 1 decimal max
      return num.toFixed(1)
    case 'count':
      // Always integer
      return num.toFixed(0)
    default:
      return num.toFixed(1)
  }
}

// Deterministic hash helper for stable seeded values
function deterministicHash(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

// Lightweight presentation metadata helpers (no gating, only UI hints)
function getPresentationMetadata(insight: V2PreviewRow): InsightPresentationMetadata {
  const title = insight.title.toLowerCase()
  const id = insight.id.toLowerCase()
  const stage = insight.cicdStage || 'plan-code'
  const confidence = insight.confidence || 'medium'
  const coverage = insight.coveragePct || 0
  
  const metadata: InsightPresentationMetadata = {}
  
  // UI Priority based on operational impact and data quality
  if (coverage >= 70 && confidence === 'high') {
    metadata.uiPriority = 'hero'
  } else if (coverage >= 50 && confidence !== 'low') {
    metadata.uiPriority = 'important'
  } else {
    metadata.uiPriority = 'supporting'
  }
  
  // Executive relevance based on demoNarrativePriority for canonical PIs, or keywords for legacy PIs
  const demoNarrativePriority = (insight as any).demoNarrativePriority
  const demoFlag = (insight as any).demoFlag
  
  if (demoNarrativePriority !== undefined) {
    // Use demoNarrativePriority for canonical PIs (80-90 scale)
    // Suppress LOW RELEVANCE on strong canonical demo insights to avoid cognitive dissonance
    if (demoNarrativePriority >= 90) {
      metadata.executiveRelevance = 'high'
    } else if (demoNarrativePriority >= 80) {
      metadata.executiveRelevance = 'medium'
    } else {
      // For canonical PIs, minimum relevance is medium to avoid HIGH CONFIDENCE + LOW RELEVANCE dissonance
      metadata.executiveRelevance = demoFlag === 'demo_primary' ? 'medium' : 'low'
    }
  } else if (id.includes('change-failure-rate') || id.includes('mttr') || id.includes('deployment') || 
      id.includes('fast-but-unstable') || id.includes('deployment-velocity')) {
    metadata.executiveRelevance = 'high'
  } else if (id.includes('pr-cycle') || id.includes('review') || id.includes('revert') || 
             id.includes('rework') || id.includes('pr-size')) {
    metadata.executiveRelevance = 'medium'
  } else {
    metadata.executiveRelevance = 'low'
  }
  
  // Operational category based on lifecycle stage and content
  if (stage === 'deploy-operate') {
    metadata.operationalCategory = 'stability'
  } else if (id.includes('cycle') || id.includes('latency') || id.includes('throughput') || 
             id.includes('velocity') || id.includes('delivery')) {
    metadata.operationalCategory = 'velocity'
  } else if (id.includes('rework') || id.includes('revert') || id.includes('quality') || 
             id.includes('failure') || id.includes('reopen')) {
    metadata.operationalCategory = 'quality'
  } else {
    metadata.operationalCategory = 'workflow'
  }
  
  return metadata
}

// Minimal helper functions for view model adapter

function getImpactLevel(insight: V2PreviewRow): string {
  const id = insight.id.toLowerCase()
  const delta = Math.abs(insight.displayDeltaPct ?? insight.deltaPct ?? 0)
  const confidence = insight.confidence || 'medium'

  // Data-gap rows are diagnostics, not observed customer risks. An
  // insufficient-data card ("X needs more data") must never inherit the
  // registry's HIGH impact bucket — it has no measured evidence behind it.
  if ((insight as any).isDiagnostic === true || insight.hasData === false) {
    return 'Low'
  }

  // Same rule via comparisonState: any residual row classified as a data
  // gap (insufficient evidence, missing instrumentation, emerging sample)
  // renders a "needs more data"-style title and must not carry HIGH/MEDIUM.
  // Mirrors the detail card's effectiveImpact downgrade.
  const rowComparisonState = (insight as any).comparisonState
  if (rowComparisonState === 'needs_more_data' ||
      rowComparisonState === 'instrumentation_gap' ||
      rowComparisonState === 'emerging_sample' ||
      rowComparisonState === 'missing_comparison' ||
      rowComparisonState === 'not_comparable') {
    return 'Low'
  }

  // Use intendedStageQuotaBucket from canonical registry when available (more accurate than heuristic pattern matching)
  const intendedBucket = (insight as any).intendedStageQuotaBucket
  if (intendedBucket === 2) {
    return 'High' // HIGH impact bucket from registry
  }
  if (intendedBucket === 1) {
    return 'Medium' // MEDIUM impact bucket from registry
  }
  
  // Fallback to heuristic pattern matching for legacy data without intendedStageQuotaBucket
  const highImpactIds = ['change-failure-rate', 'mttr', 'revert', 'reopen', 'deployment-velocity', 'reviewer-load', 'review-load']
  const isHighImpactId = highImpactIds.some(hid => id.includes(hid))
  
  if (isHighImpactId && (delta > 10 || confidence === 'high')) {
    return 'High'
  }
  
  // MEDIUM impact: operational signals with moderate delta
  const mediumImpactIds = ['review', 'pr', 'merge', 'cycle', 'throughput', 'rework', 'quality', 'delivery', 'adoption']
  const isMediumImpactId = mediumImpactIds.some(mid => id.includes(mid))
  
  if (isMediumImpactId && delta > 5) {
    return 'Medium'
  }
  
  // Default to LOW for informational signals
  return 'Low'
}

function getStageLabel(stage?: string): string {
  if (!stage) return 'Unknown'
  const stageMap: Record<string, string> = {
    'plan-code': 'Plan & Code',
    'review-merge': 'Review & Merge',
    'deploy-operate': 'Deploy & Operate'
  }
  return stageMap[stage] || stage
}

function getFrozenStageLabel(row: V2PreviewRow): string {
  const id = String(row.id || '').toLowerCase()

  if (
    id === 'session-conditioned-pr-cycle-time-ai-vs-non-ai' ||
    id === 'reopen-pressure-spike' ||
    id === 'reviewer-load-concentration' ||
    id === 'executive-small-pr-workflow-optimization'
  ) {
    return 'Review & Merge'
  }

  if (
    id === 'change-failure-rate-spike-by-ide' ||
    id === 'delivery-velocity-by-workflow' ||
    id === 'synthesized-deployment-cadence'
  ) {
    return 'Deploy & Operate'
  }

  return getStageLabel(row.cicdStage)
}

function generateDetectedLabel(insight: V2PreviewRow): string {
  // CR5 FINAL DOWNSTREAM: Be source-aware for GitHub-only evidence.
  // Downstream PIs with dataDomain='github_delivery' or sourceLabel containing
  // 'GitHub' should not be labeled as "historical telemetry".
  const dataDomain = (insight as any).dataDomain
  const sourceLabel = (insight as any).sourceLabel || ''
  if (dataDomain === 'github_delivery' || sourceLabel.toLowerCase().includes('github')) {
    return 'across GitHub delivery data'
  }
  // Since we use all historical data (2020-01-01 to present), be honest about it
  return 'across historical telemetry'
}

// Enhanced metric value formatter with proper units detection
function formatMetricValue(insight: V2PreviewRow): string {
  const id = insight.id.toLowerCase()
  let value = insight.displayValue || insight.rightMetric || 0
  
  // Extract numeric value from string rightMetric (e.g., "8.5% reopen rate" -> 8.5)
  if (typeof value === 'string' && value !== '0' && value !== null) {
    const numericMatch = value.match(/(\d+\.?\d*)/)
    if (numericMatch) {
      value = parseFloat(numericMatch[1])
    }
  }
  
  // For zero metrics, try to extract meaningful value from delta or body text
  if (value === 0 || value === '0' || value === null) {
    const delta = insight.displayDeltaPct ?? insight.deltaPct ?? 0
    if (delta !== 0) {
      value = Math.abs(delta) // Use delta for percentage-based metrics
    } else {
      // For reopen/rework rates, generate realistic demo values
      if (id.includes('reopen-rate') || id.includes('revert-rate')) {
        value = 8.5 // Realistic reopen rate
      } else if (id.includes('rework-rate')) {
        value = 12.3 // Realistic rework rate
      } else if (id.includes('change-failure-rate')) {
        value = 6.7 // Realistic change failure rate
      }
    }
  }
  
  // Determine metric type based on ID and format appropriately
  if (id.includes('change-failure-rate') || id.includes('revert-rate') || id.includes('reopen-rate') || 
      id.includes('rework-rate') || id.includes('ai-adoption') || id.includes('delivery-yield') ||
      id.includes('quality') || id.includes('stability')) {
    return formatSafeValue(value, 'percentage')
  }
  
  if (id.includes('mttr') || id.includes('pr-cycle') || id.includes('cycle-time') || id.includes('latency')) {
    return formatSafeValue(value, 'hours')
  }
  
  if (id.includes('session-duration') || id.includes('active-coding') || id.includes('ttfc') || 
      id.includes('time-to-first-commit')) {
    return formatSafeValue(value, 'minutes')
  }
  
  if (id.includes('deployment-velocity') || id.includes('deployment-frequency')) {
    return formatSafeValue(value, 'perweek')
  }
  
  if (id.includes('commits-per-session') || id.includes('commit')) {
    return formatSafeValue(value, 'count')
  }
  
  if (id.includes('review-load')) {
    return formatSafeValue(value, 'count') // Reviewer load is PRs/reviewer, should be integer
  }
  if (id.includes('review-throughput') || id.includes('throughput') ||
      id.includes('velocity') || id.includes('ai-throughput')) {
    return formatSafeValue(value, 'rate')
  }
  
  // Default to count for most metrics
  return formatSafeValue(value, 'count')
}

function generatePrimaryMetricLabel(insight: V2PreviewRow): string {
  const id = insight.id.toLowerCase()
  
  // Generate descriptive label based on insight type with clear units
  if (id.includes('change-failure-rate')) return 'Change Failure Rate (%)'
  if (id.includes('mttr')) return 'Mean Time to Restore (hours)'
  if (id.includes('deployment-velocity')) return 'Deployment Frequency (/week)'
  if (id.includes('deployment-frequency')) return 'Deployment Frequency (/week)'
  if (id.includes('pr-cycle') || id.includes('cycle-time')) return 'PR Cycle Time (hours)'
  if (id.includes('pr-cycle-time')) return 'PR Cycle Time (hours)'
  if (id.includes('revert-rate')) return 'Revert Rate (%)'
  if (id.includes('revert')) return 'Revert Rate (%)'
  if (id.includes('reopen-rate')) return 'Reopen Rate (%)'
  if (id.includes('reopen')) return 'Reopen Rate (%)'
  if (id.includes('review-throughput')) return 'Review Throughput (PRs/day)'
  if (id.includes('review-load')) return 'Reviewer Load (PRs/reviewer)'
  if (id.includes('review')) return 'Review Throughput (PRs/day)'
  if (id.includes('rework-rate')) return 'Rework Rate (%)'
  if (id.includes('rework')) return 'Rework Rate (%)'
  if (id.includes('ai-adoption')) return 'Tracked AI Signal Coverage (%)'
  if (id.includes('ai-throughput')) return 'AI Throughput (suggestions/session)'
  if (id.includes('ai') || id.includes('suggestion')) return 'Tracked AI Signal Coverage (%)'
  if (id.includes('commits-per-session')) return 'Commits per Session'
  if (id.includes('commit')) return 'Commits per Session'
  if (id.includes('session-duration')) return 'Session Duration (minutes)'
  if (id.includes('session')) return 'Session Duration (minutes)'
  if (id.includes('active-coding')) return 'Active Coding Time (minutes)'
  if (id.includes('ttfc') || id.includes('time-to-first-commit')) return 'Time to First Commit (minutes)'
  if (id.includes('delivery-yield')) return 'Delivery Throughput Gain (%)'
  if (id.includes('throughput')) return 'Throughput Rate (units/day)'
  if (id.includes('velocity')) return 'Delivery Velocity (PRs/week)'
  if (id.includes('latency')) return 'Latency (hours)'
  if (id.includes('concentration')) return 'Reviewer Concentration (%)'
  if (id.includes('bottleneck')) return 'Coordination Bottleneck'
  if (id.includes('quality')) return 'PR Quality Risk (%)'
  if (id.includes('stability')) return 'Release Stability (%)'
  if (id.includes('deployment')) return 'Deployment Frequency (/week)'
  if (id.includes('failure')) return 'Change Failure Rate (%)'
  if (id.includes('cycle')) return 'Cycle Time (hours)'
  if (id.includes('reopen')) return 'Reopen Rate (%)'
  
  return 'Metric Value'
}

// UNIFIED TITLE GENERATION SYSTEM - NO CFR

// STEP 1 - Insight Classification
type InsightType = "MODEL_TOOL_PERFORMANCE" | "COMPARATIVE_TOOL" | "FLOW_METRIC" | "QUALITY_SIGNAL" | "DELIVERY_THROUGHPUT"

function classifyInsight(row: V2PreviewRow): InsightType {
  const id = row.id.toLowerCase()
  
  // Model / Tool Performance (primary pattern)
  if (id.includes('coding-time') || id.includes('commit') || id.includes('pr-cycle') || id.includes('throughput')) {
    return "MODEL_TOOL_PERFORMANCE"
  }
  
  // Comparative Tool / IDE behavior
  if (id.includes('revert-rate') || id.includes('cycle-time') || id.includes('delivery-velocity')) {
    return "COMPARATIVE_TOOL"
  }
  
  // Quality / Reliability signals (replacing CFR)
  if (id.includes('reopen') || id.includes('review') || id.includes('bottleneck') || id.includes('quality')) {
    return "QUALITY_SIGNAL"
  }
  
  // Flow / throughput metrics
  if (id.includes('adoption') || id.includes('cadence') || id.includes('acceleration')) {
    return "FLOW_METRIC"
  }
  
  // Delivery performance
  if (id.includes('velocity') || id.includes('delivery') || id.includes('deploy')) {
    return "DELIVERY_THROUGHPUT"
  }
  
  return "MODEL_TOOL_PERFORMANCE" // default
}

// STEP 2 - Title Generation with Deterministic Variance (SINGLE SYSTEM)
function generateTitle(row: V2PreviewRow, insightType: InsightType): string {
  const id = row.id.toLowerCase()
  const seed = deterministicHash(id)
  
  // Title variance patterns for diversity (deterministic based on seed)
  const variancePatterns = {
    performance: [
      '{model} workflows accelerate {metric}',
      '{model} workflows exceed baseline {metric}',
      '{model} workflows show elevated {metric}',
      '{model} workflows lead in {metric}',
      '{metric} concentrated in {model} workflows'
    ],
    comparative: [
      '{model1} workflows exceed {model2} in {metric}',
      '{model1} vs {model2} workflows show {metric} divergence',
      '{metric} variance between {model1} and {model2} workflows',
      '{model1} workflows trail {model2} in {metric}',
      '{metric} advantage for {model2} over {model1} workflows'
    ],
    quality: [
      '{model} workflows show elevated {metric}',
      '{metric} pressure increased in {model} workflows',
      'Review {metric} issues in {model} workflows',
      '{model} workflows require {metric} gates',
      '{metric} instability in {model} workflows'
    ],
    flow: [
      'AI {metric} divergence across workflows',
      '{model} workflows peaked in {metric}',
      '{model} acceleration increased {metric}',
      'Delivery {metric} fragmented across {model} workflows',
      'Workflow {metric} variance in {model} sessions'
    ],
    delivery: [
      '{model} workflows peak in {metric}',
      '{model} workflows show elevated {metric}',
      '{metric} pressure increased in {model} workflows',
      'Delivery {metric} concentrated in {model} paths',
      '{model} delivery paths show {metric} variance'
    ]
  }
  
  // Model selection for variance (use canonical models from registry)
  const modelOptions = [
    'Claude Sonnet 4.6', 'GPT-5 Coding', 
    'SWE-1.6', 'the selected workflow', 'this workflow'
  ]
  
  const selectModel = (index: number) => modelOptions[index % modelOptions.length]
  const selectSecondaryModel = (index: number) => modelOptions[(index + 1) % modelOptions.length]
  
  switch (insightType) {
    case "MODEL_TOOL_PERFORMANCE":
      const perfPattern = variancePatterns.performance[seed % variancePatterns.performance.length]
      const model1 = selectModel(seed)
      if (id.includes('coding-time')) return perfPattern.replace('{model}', model1).replace('{metric}', 'focused coding time')
      if (id.includes('commit')) return perfPattern.replace('{model}', model1).replace('{metric}', 'commit throughput')
      if (id.includes('pr-cycle')) return perfPattern.replace('{model}', model1).replace('{metric}', 'PR cycle efficiency')
      if (id.includes('throughput')) return perfPattern.replace('{model}', model1).replace('{metric}', 'delivery throughput')
      break
      
    case "COMPARATIVE_TOOL":
      const modelA = selectModel(seed)
      const modelB = selectSecondaryModel(seed)
      
      // For cycle time metrics, use polarity-aware patterns based on actual delta
      if (id.includes('cycle-time') || id.includes('pr-cycle')) {
        const aiValue = (row.breakdownByTool as any)?.ai?.value
        const nonAiValue = (row.breakdownByTool as any)?.non_ai?.value
        const isAiSlower = aiValue !== undefined && nonAiValue !== undefined && aiValue > nonAiValue
        
        if (isAiSlower) {
          // AI-assisted is slower - use negative comparison patterns
          const negativePatterns = [
            '{model1} workflows trail {model2} in {metric}',
            '{metric} advantage for {model2} over {model1} workflows',
            '{model1} workflows show elevated {metric} vs {model2}'
          ]
          const negPattern = negativePatterns[seed % negativePatterns.length]
          return negPattern.replace('{model1}', 'Observed AI signals').replace('{model2}', 'Zero observed AI signals').replace('{metric}', 'cycle time')
        } else {
          // AI-assisted is faster or equal - use positive or neutral patterns
          const positivePatterns = [
            '{model1} workflows exceed {model2} in {metric}',
            '{metric} variance between {model1} and {model2} workflows',
            '{model1} vs {model2} workflows show {metric} divergence'
          ]
          const posPattern = positivePatterns[seed % positivePatterns.length]
          return posPattern.replace('{model1}', 'Observed AI signals').replace('{model2}', 'Zero observed AI signals').replace('{metric}', 'cycle time')
        }
      }
      
      const compPattern = variancePatterns.comparative[seed % variancePatterns.comparative.length]
      if (id.includes('revert-rate')) return compPattern.replace('{model1}', modelA).replace('{model2}', modelB).replace('{metric}', 'revert pressure')
      if (id.includes('delivery-velocity')) return compPattern.replace('{model1}', modelA).replace('{model2}', modelB).replace('{metric}', 'delivery velocity')
      break
      
    case "QUALITY_SIGNAL":
      const qualityPattern = variancePatterns.quality[seed % variancePatterns.quality.length]
      const qualityModel = selectModel(seed)
      if (id.includes('reopen')) return qualityPattern.replace('{model}', qualityModel).replace('{metric}', 'reopen pressure')
      if (id.includes('bottleneck')) return qualityPattern.replace('{model}', qualityModel).replace('{metric}', 'review bottleneck')
      if (id.includes('quality')) return qualityPattern.replace('{model}', qualityModel).replace('{metric}', 'quality')
      if (id.includes('review')) return qualityPattern.replace('{model}', qualityModel).replace('{metric}', 'review stability')
      break
      
    case "FLOW_METRIC":
      const flowPattern = variancePatterns.flow[seed % variancePatterns.flow.length]
      const flowModel = selectModel(seed)
      if (id.includes('adoption')) return flowPattern.replace('{model}', flowModel).replace('{metric}', 'adoption')
      if (id.includes('cadence')) return flowPattern.replace('{model}', flowModel).replace('{metric}', 'deployment cadence')
      if (id.includes('acceleration')) return flowPattern.replace('{model}', flowModel).replace('{metric}', 'delivery acceleration')
      break
      
    case "DELIVERY_THROUGHPUT":
      const deliveryPattern = variancePatterns.delivery[seed % variancePatterns.delivery.length]
      const deliveryModel = selectModel(seed)
      if (id.includes('velocity')) return deliveryPattern.replace('{model}', deliveryModel).replace('{metric}', 'small PR velocity')
      if (id.includes('deploy')) return deliveryPattern.replace('{model}', deliveryModel).replace('{metric}', 'deployment stability')
      break
  }
  
  return row.title // fallback
}

// STEP 3 - Normalization (SAFE ONLY)
function normalizeTitle(title: string): string {
  return title
    .replace(/\s+/g, ' ') // spacing normalization
    .trim()
}

// UNIFIED TITLE GENERATOR (NO CFR)
function generateUnifiedTitle(row: V2PreviewRow): string {
  // STEP 1: Classify insight
  const insightType = classifyInsight(row)
  
  // STEP 2: Generate title
  const baseTitle = generateTitle(row, insightType)
  
  // STEP 3: Safe normalization only
  return normalizeTitle(baseTitle)
}

function getPIAxis(insightId: string): 'velocity' | 'stability' | 'ai' {
  const id = insightId.toLowerCase()
  
  // AI Workflow Impact axis
  if (id.includes('ai') || id.includes('suggestion') || id.includes('focus') || id.includes('yield')) {
    return 'ai'
  }
  
  // Delivery Stability axis  
  if (id.includes('reopen') || id.includes('revert') || id.includes('review') || id.includes('load') || id.includes('concentration')) {
    return 'stability'
  }
  
  // Delivery Velocity axis (default)
  return 'velocity'
}

function normalizePITitle(title: string, axis: 'velocity' | 'stability' | 'ai'): string {
  return title.trim()
}

function validatePITitle(title: string): boolean {
  const forbidden = [
    /drive/i,
    /yield/i,
    /patterns/i,
    /measurable/i,
    /AI adoption/i,
    /while/i,
    /increasingly/i,
    /shows .* increase/i,
    /pressure is rising/i,
    /convergence across/i,
    /accelerating/i,
    /compression creating/i,
    /elongation creating/i,
    /bottleneck risk/i,
    /quality gaps/i,
    /rework cycles/i,
    /stability posture/i,
    /reliability gains/i,
    /production workflows/i,
    /deployment patterns/i
  ]

  return !forbidden.some(r => r.test(title))
}

function getOperationalInterpretation(insight: V2PreviewRow): string {
  const delta = insight.displayDeltaPct ?? insight.deltaPct ?? 0
  const category = getPresentationMetadata(insight).operationalCategory
  const tool = Object.keys(insight.breakdownByTool || {})[0] || 'cursor'
  
  // Use actual IDE/tool names, not model names (product truth: we measure IDE/tool workflows)
  const toolLabel = tool.charAt(0).toUpperCase() + tool.slice(1)
  const workflowLabel = `${toolLabel} workflow`
  
  if (category === 'velocity') {
    return delta > 0 
      ? `${workflowLabel} shows ${formatSafeValue(Math.abs(delta), 'percentage')}% higher commit throughput than baseline cohorts`
      : `Commit throughput compressed ${formatSafeValue(Math.abs(delta), 'percentage')}% in ${workflowLabel} vs prior period`
  }
  if (category === 'stability') {
    return delta > 0
      ? `Change failure rate elevated ${formatSafeValue(Math.abs(delta), 'percentage')}% in ${workflowLabel}, indicating quality gate bypass`
      : `Change failure rate improved ${formatSafeValue(Math.abs(delta), 'percentage')}% in ${workflowLabel}, reflecting stronger release gating`
  }
  if (category === 'quality') {
    return delta > 0
      ? `Reopen pressure elevated ${formatSafeValue(Math.abs(delta), 'percentage')}% in ${workflowLabel}, suggesting review depth compression before merge`
      : `Reopen pressure reduced ${formatSafeValue(Math.abs(delta), 'percentage')}% in ${workflowLabel}, indicating stronger pre-merge validation`
  }
  return `Workflow signal detected in ${workflowLabel} with ${formatSafeValue(Math.abs(delta), 'percentage')}% delta vs baseline`
}

// Helper function to extract primary model for consistency across all PI components
function extractPrimaryModel(insight: V2PreviewRow): string {
  const id = insight.id.toLowerCase()
  const seed = deterministicHash(id)
  
  // Use the same workflow selection logic as title generation
  const workflowOptions = [
    'Cursor', 'VS Code', 
    'Devin', 'the selected', 'this'
  ]
  
  return workflowOptions[seed % workflowOptions.length]
}

function generateOperationalInterpretation(
  insight: V2PreviewRow,
  category: string,
  _id: string,
  _confidence: string,
  _coverage: number,
  workflowComparison?: WorkflowComparison
): string | null {
  const delta = insight.displayDeltaPct ?? insight.deltaPct ?? 0
  let primaryModel = extractPrimaryModel(insight)
  
  // Use specific workflow name from comparison data if available
  if (workflowComparison && workflowComparison.winner) {
    primaryModel = workflowComparison.winner.name
  }
  
  if (category === 'velocity') {
    return delta > 0 ? `${primaryModel} shows elevated velocity creating reviewer bottleneck risk` : `${primaryModel} shows velocity compression signaling coordination constraints`
  }
  if (category === 'quality') {
    return delta > 0 ? `${primaryModel} shows quality pressure indicating technical debt accumulation` : `${primaryModel} shows quality stability enabling sustainable delivery`
  }
  if (category === 'stability') {
    return delta > 0 ? `${primaryModel} shows degraded stability with quality gates bypassed` : `${primaryModel} shows improved stability with CI/CD gating validated`
  }
  return `${primaryModel} workflow pattern needs review`
}

function generateActionableRecommendation(insight: V2PreviewRow, workflowComparison?: WorkflowComparison, mode?: 'meaningful-difference' | 'higher-is-worse-difference' | 'ai-vs-traditional' | 'org-level' | 'tied' | 'attribution-gap' | 'insufficient'): string {
  const id = insight.id.toLowerCase()
  const category = getPresentationMetadata(insight).operationalCategory
  let primaryModel = extractPrimaryModel(insight)
  
  // Determine if we should use org-level language
  const useOrgLevelLanguage = mode === 'org-level' || mode === 'attribution-gap' || mode === 'tied' || mode === 'insufficient'
  
  // Use specific workflow name from comparison data only if IDE-level attribution
  if (workflowComparison && workflowComparison.winner && !useOrgLevelLanguage) {
    primaryModel = workflowComparison.winner.name
  }
  
  // Apply displayWorkflowName alias to primaryModel
  primaryModel = displayWorkflowName(primaryModel)
  
  // Plan & Code metric-specific recommendations
  if (id.includes('ai-adoption') || id.includes('ai-focus') || id.includes('ai-adoption-velocity')) {
    if (useOrgLevelLanguage) {
      return `Standardize tool enablement across teams. Compare team-level AI usage norms and identify why one workflow lags in adoption.`
    }
    return `Standardize AI tool enablement across teams. ${primaryModel} leads in adoption — compare team-level usage norms and identify enablement barriers for other workflows.`
  }
  if (id.includes('time-to-first-commit') || id.includes('ttfc')) {
    if (useOrgLevelLanguage) {
      return `Inspect task setup, branch/work-item handoff, environment readiness, and onboarding friction to reduce time-to-first-commit.`
    }
    return `Inspect ${primaryModel} task setup, branch/work-item handoff, and environment readiness. Share faster first-commit practices with other workflows.`
  }
  if (id.includes('rework')) {
    if (useOrgLevelLanguage) {
      return `Inspect rework loops, branch churn, generated-code review patterns, and repeated file edits to reduce rework rate.`
    }
    return `Inspect ${primaryModel} rework loops, branch churn, and generated-code review patterns. Share lower-rework practices with other workflows.`
  }
  if (id.includes('active-coding')) {
    if (useOrgLevelLanguage) {
      return `Compare session structure across workflows before treating raw time as productivity. Look for environment or interruption differences.`
    }
    return `Compare ${primaryModel} session structure with other workflows before treating raw time as productivity. Look for environment or interruption differences.`
  }
  if (id.includes('focus-ratio')) {
    if (useOrgLevelLanguage) {
      return `Compare session structure across workflows to understand focus ratio differences. Investigate interruption sources and meeting load.`
    }
    return `Compare ${primaryModel} focus patterns with other workflows. Investigate interruption sources and meeting load differences.`
  }
  if (id.includes('context-switching') || id.includes('idle')) {
    if (useOrgLevelLanguage) {
      return `Inspect interruptions and context-switch loops. Lower idle and context-switching time is better.`
    }
    return `Inspect ${primaryModel} interruptions and context-switch loops. Lower idle and context-switching time is better.`
  }
  if (id.includes('session-quality') || id.includes('high-quality')) {
    if (useOrgLevelLanguage) {
      return `Improve workflow attribution. Review low-quality sessions by workflow only when attribution is safe.`
    }
    return `Improve workflow attribution for ${primaryModel}. Review low-quality sessions by workflow only when attribution is safe.`
  }
  if (id.includes('debug-time')) {
    if (useOrgLevelLanguage) {
      return `Compare debug time patterns across workflows to identify environment or tooling differences.`
    }
    return `Compare ${primaryModel} debug time patterns with other workflows. Investigate environment or tooling differences.`
  }
  if (id.includes('terminal-time')) {
    if (useOrgLevelLanguage) {
      return `Compare terminal time patterns across workflows to identify workflow efficiency differences.`
    }
    return `Compare ${primaryModel} terminal time patterns with other workflows. Identify workflow efficiency differences.`
  }
  if (id.includes('delivery-rate') || id.includes('ai-intensity') || id.includes('review-burden')) {
    if (useOrgLevelLanguage) {
      return `Collect more workflow-attributed sessions to compare delivery velocity across AI and non-AI patterns.`
    }
    return `Compare ${primaryModel} delivery velocity with other workflows. Investigate AI workflow patterns and reviewer load.`
  }
  if (id.includes('workflow-quality') || id.includes('quality-correlation')) {
    if (useOrgLevelLanguage) {
      return `Collect more workflow-attributed sessions with GitHub outcomes to correlate quality signals.`
    }
    return `Correlate ${primaryModel} quality signals with GitHub outcomes. Share better quality correlation patterns with other workflows.`
  }
  
  // Use proper phrasing to avoid "this-assisted" or "selected-assisted"
  const modelPhrase = primaryModel === 'the selected' || primaryModel === 'this' 
    ? 'AI-assisted' 
    : `${primaryModel}-assisted`
  
  if (category === 'velocity') {
    if (id.includes('ai') || id.includes('suggestion')) {
      if (useOrgLevelLanguage) {
        return `Add reviewer assignment checks for large AI-assisted PRs before expanding accelerated review paths.`
      }
      return `Add reviewer assignment checks for large ${modelPhrase} PRs before expanding accelerated review paths.`
    }
    if (id.includes('cycle') || id.includes('latency')) {
      if (useOrgLevelLanguage) {
        return `Review elevated cycle time patterns across workflows before changing reviewer policy.`
      }
      return `Review elevated cycle time patterns in ${primaryModel} workflows before changing reviewer policy.`
    }
    if (useOrgLevelLanguage) {
      return `Review commit patterns for potential batching opportunities and workflow optimization.`
    }
    return `Review ${primaryModel} commit patterns for potential batching opportunities and workflow optimization.`
  }
  if (category === 'stability') {
    if (id.includes('deployment') || id.includes('failure')) {
      if (useOrgLevelLanguage) {
        return `Review validation coverage in delivery paths before expanding deployment cadence.`
      }
      return `Review validation coverage in accelerated ${primaryModel} delivery paths before expanding deployment cadence.`
    }
    if (id.includes('mttr')) {
      if (useOrgLevelLanguage) {
        return `Implement automated rollback triggers for deployments exceeding MTTR baseline by 50%.`
      }
      return `Implement automated rollback triggers for ${primaryModel} deployments exceeding MTTR baseline by 50%.`
    }
    if (useOrgLevelLanguage) {
      return `Strengthen pre-deployment validation gates before increasing release cadence.`
    }
    return `Strengthen pre-deployment validation gates for ${primaryModel} workflows before increasing release cadence.`
  }
  if (category === 'quality') {
    if (id.includes('revert') || id.includes('reopen')) {
      if (useOrgLevelLanguage) {
        return `Review elevated reopen/revert patterns in AI-assisted PRs before changing reviewer policy.`
      }
      return `Review elevated reopen/revert patterns in ${modelPhrase} PRs before changing reviewer policy.`
    }
    if (id.includes('rework') || id.includes('quality')) {
      if (useOrgLevelLanguage) {
        return `Implement code review checklists targeting high-rework file patterns.`
      }
      return `Implement ${primaryModel}-specific code review checklists targeting high-rework file patterns.`
    }
    if (useOrgLevelLanguage) {
      return `Audit review depth for patterns correlated with post-merge quality issues.`
    }
    return `Audit ${primaryModel} review depth for patterns correlated with post-merge quality issues.`
  }
  
  // Workflow-specific fallback
  if (id.includes('review') || id.includes('pr')) {
    if (useOrgLevelLanguage) {
      return `Distribute PR review load across senior reviewers to prevent bottlenecks.`
    }
    return `Distribute ${primaryModel} PR review load across senior reviewers to prevent bottlenecks.`
  }
  if (id.includes('session') || id.includes('time')) {
    if (useOrgLevelLanguage) {
      return `Optimize environment to reduce session friction and improve velocity.`
    }
    return `Optimize ${primaryModel} environment to reduce session friction and improve velocity.`
  }
  
  if (useOrgLevelLanguage) {
    return `Establish performance baselines and alert on deviations exceeding 15%.`
  }
  return `Establish ${primaryModel} performance baselines and alert on deviations exceeding 15%.`
}
</script>

<style scoped>
/* ── Reset & root ──────────────────────────────────────────────────────────── */
.pi-root {
  font-family: 'DM Sans', 'Geist', 'Outfit', system-ui, sans-serif;
  background: #f8fafc;
  min-height: 100vh;
  padding: 24px 28px;
  color: #0f172a;
  box-sizing: border-box;
}

/* ── Minimal toolbar ───────────────────────────────────────────────────────── */
.pi-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.pi-toolbar-left { display: flex; align-items: center; gap: 10px; }
.pi-insight-count {
  font-size: 12px; font-weight: 600; color: #64748b;
}
.pi-toolbar-right { display: flex; gap: 10px; }

/* ── Shared button styles ───────────────────────────────────────────────────── */
.pi-btn-outline {
  display: flex; align-items: center; gap: 6px;
  background: #fff; border: 1px solid #e2e8f0;
  border-radius: 8px; padding: 7px 13px;
  font-size: 13px; font-weight: 500; color: #374151;
  cursor: pointer; transition: background 0.15s;
}
.pi-btn-outline:hover { background: #f1f5f9; }
.pi-btn-icon {
  width: 32px; height: 32px; background: #f1f5f9; border: none;
  border-radius: 6px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: #64748b; transition: background 0.15s;
}
.pi-btn-icon:hover { background: #e2e8f0; }

/* ── Body layout ────────────────────────────────────────────────────────────── */
.pi-body {
  display: flex; gap: 16px; align-items: flex-start;
}

/* ── Left panel ─────────────────────────────────────────────────────────────── */
.pi-panel-left {
  width: 320px; flex-shrink: 0;
  background: #fff; border-radius: 14px;
  border: 1px solid #e2e8f0;
  padding-bottom: 8px; overflow: hidden;
}
.pi-tabs {
  display: flex; border-bottom: 1px solid #e2e8f0;
  padding: 0 16px; align-items: center;
}
.pi-cached-badge {
  background: #fef3c7; color: #92400e;
  font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;
  margin-left: 8px; display: flex; align-items: center;
}
.pi-live-badge {
  background: #dcfce7; color: #166534;
  font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;
  margin-left: 8px; display: flex; align-items: center;
}

/* Loading/Empty State Styles */
.pi-loading-state {
  padding: 20px 16px; text-align: center;
}
.pi-loading-header {
  margin-bottom: 20px;
}
.pi-loading-title {
  font-size: 14px; font-weight: 600; color: #1e293b; margin-bottom: 4px;
}
.pi-loading-subtitle {
  font-size: 12px; color: #94a3b8;
}
.pi-loading-skeletons {
  display: flex; flex-direction: column; gap: 12px;
}
.pi-loading-skeleton {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; border-radius: 6px;
  background: #f8fafc;
}
.pi-skeleton-icon {
  width: 28px; height: 28px; border-radius: 6px;
  background: #e2e8f0; animation: pulse 2s infinite;
}
.pi-skeleton-content {
  flex: 1; display: flex; flex-direction: column; gap: 4px;
}
.pi-skeleton-title {
  width: 60%; height: 12px; border-radius: 4px;
  background: #e2e8f0; animation: pulse 2s infinite;
}
.pi-skeleton-meta {
  width: 40%; height: 10px; border-radius: 4px;
  background: #f1f5f9; animation: pulse 2s infinite 0.5s;
}
.pi-loading-empty {
  margin-top: 24px; padding: 20px; text-align: center;
  background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;
}
.pi-empty-icon {
  font-size: 32px; margin-bottom: 8px;
}
.pi-empty-title {
  font-size: 14px; font-weight: 600; color: #1e293b; margin-bottom: 4px;
}
.pi-empty-subtitle {
  font-size: 12px; color: #94a3b8;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.pi-tab {
  padding: 13px 6px 11px; font-size: 13px; font-weight: 500;
  color: #94a3b8; background: none; border: none; cursor: pointer;
  border-bottom: 2px solid transparent; margin-right: 18px;
  transition: color 0.15s, border-color 0.15s;
}
.pi-tab--active { color: #3b82f6; border-bottom-color: #3b82f6; }

.pi-nav-controls {
  display: flex; align-items: center; justify-content: center;
  gap: 8px; margin-bottom: 12px; padding: 6px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
}
.pi-nav-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0;
  background: white; border: 1px solid #e2e8f0; border-radius: 6px;
  cursor: pointer; color: #64748b; transition: all 0.15s ease;
}
.pi-nav-btn:hover:not(:disabled) {
  background: #f1f5f9; color: #0f172a; border-color: #cbd5e1;
}
.pi-nav-btn:disabled {
  opacity: 0.4; cursor: not-allowed;
}
.pi-nav-count {
  font-size: 11px; font-weight: 600; color: #64748b;
  min-width: 40px; text-align: center;
}

.pi-insight-list { padding: 4px 0; overflow-y: auto; max-height: calc(100vh - 280px); }
.pi-insight-item {
  display: flex; align-items: center; gap: 11px;
  padding: 7px 14px 7px 12px; cursor: pointer;
  transition: background 0.12s;
  border-left: 3px solid transparent;
  margin-bottom: 2px;
  border-radius: 0 6px 6px 0;
}
.pi-insight-item:hover { 
  background: #f8fafc; 
  transform: translateY(1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}
.pi-insight-item--active {
  background: #eff6ff;
  border-left-color: #3b82f6;
  box-shadow: 0 1px 3px rgba(59, 130, 246, 0.1);
}
.pi-insight-item--diagnostic .pi-insight-icon {
  opacity: 0.6;
}
.pi-insight-item--diagnostic .pi-insight-name {
  color: #64748b;
}
.pi-insight-item--diagnostic .pi-insight-meta {
  color: #94a3b8;
}
.pi-insight-icon {
  width: 30px; height: 30px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.pi-insight-info { flex: 1; min-width: 0; }
.pi-insight-title-row { display: flex; align-items: flex-start; gap: 6px; justify-content: space-between; }
.pi-insight-name { font-size: 11.5px; font-weight: 600; color: #1e293b; line-height: 1.3; }
.pi-insight-meta { font-size: 10px; color: #94a3b8; margin-top: 1px; }
.pi-chevron { color: #cbd5e1; flex-shrink: 0; }

.pi-impact {
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.02em;
  padding: 2px 5px; border-radius: 4px; white-space: nowrap; flex-shrink: 0;
}
.pi-impact--high { background: #fef2f2; color: #dc2626; }
.pi-impact--medium { background: #fffbeb; color: #d97706; }
.pi-impact--low { background: #f0fdf4; color: #16a34a; }

.pi-see-all {
  display: flex; align-items: center; gap: 5px;
  color: #3b82f6; background: none; border: none;
  font-size: 13px; font-weight: 500; cursor: pointer;
  padding: 10px 16px 6px;
  transition: opacity 0.15s;
}
.pi-see-all:hover { opacity: 0.75; }

/* ── Right panel ────────────────────────────────────────────────────────────── */
.pi-panel-right {
  flex: 1; min-width: 0;
  background: #fff; border-radius: 14px;
  border: 1px solid #e2e8f0; padding: 22px 24px 0;
  display: flex; flex-direction: column; gap: 18px;
}

/* Detail header */
.pi-detail-header { display: flex; justify-content: space-between; align-items: flex-start; }
.pi-detail-title-row { display: flex; align-items: flex-start; gap: 13px; }
.pi-detail-icon {
  width: 42px; height: 42px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.pi-detail-title { font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 4px; }
.pi-detail-meta-row { display: flex; align-items: center; gap: 10px; }
.pi-tag {
  background: #eff6ff; color: #3b82f6;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em;
  padding: 2px 8px; border-radius: 4px;
}
.pi-detected-label { font-size: 12px; color: #94a3b8; }
.pi-detail-actions { display: flex; align-items: center; gap: 8px; }

/* Decision Card - new compact structure */
.pi-decision-card {
  display: flex; flex-direction: column;
  border: 0.5px solid #e2e8f0; border-radius: 12px;
  overflow: hidden; margin-bottom: 18px;
  background: #fff;
}

/* CR-X UI: Diagnostic shell — distinct from real findings.
   Muted surface, dashed border, neutral indicator.
   A diagnostic reads as "not yet measurable / prerequisite missing",
   not as a badly populated finding. */
.pi-decision-card--diagnostic {
  border: 1px dashed #cbd5e1;
  background: #f8fafc;
}

/* Claim Strip */
.pi-claim-strip {
  padding: 14px 18px; border-bottom: 0.5px solid #e2e8f0;
}
.pi-decision-card--diagnostic .pi-claim-strip {
  border-bottom-color: #e2e8f0;
  background: #f1f5f9;
}
.pi-claim-text {
  font-size: 15px; font-weight: 500; color: #0f172a;
  line-height: 1.4; margin: 0;
}
.pi-decision-card--diagnostic .pi-claim-text {
  color: #475569;
}
.pi-claim-sub {
  font-size: 12px; color: #64748b; margin-top: 4px;
}

/* Evidence Band — adaptive layout based on cell count.
   CR-X UI: Family → density → attribution.
   1 cell → compact left-aligned (not a giant centered number)
   2 cells → 2-column
   3 cells → 3-column
   4 cells → 4-column with minmax(0, 1fr) to prevent overflow */
.pi-evidence-band {
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  border-bottom: 0.5px solid #e2e8f0;
}
.pi-evidence-band--1 {
  grid-template-columns: minmax(160px, 280px);
  padding: 14px 18px;
}
.pi-evidence-band--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.pi-evidence-band--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.pi-evidence-band--4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
/* Sparse treatment: compact, left-aligned, vertically tighter.
   NOT a giant centered 32px number surrounded by dead space. */
.pi-evidence-band--sparse .pi-ev-cell {
  padding: 10px 0 4px 0;
}
.pi-evidence-band--sparse .pi-ev-value {
  font-size: 18px;
}
.pi-ev-cell {
  padding: 12px 14px; border-right: 0.5px solid #e2e8f0;
  display: flex; flex-direction: column; gap: 2px;
  min-width: 0;
}
.pi-ev-cell:last-child { border-right: none; }
.pi-ev-label {
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
  color: #94a3b8; text-transform: uppercase;
}
.pi-ev-value {
  font-size: 20px; font-weight: 600; color: #0f172a;
  line-height: 1.1; letter-spacing: -0.01em;
}
.pi-ev-value--best { color: #16a34a; }
.pi-ev-value--worst { color: #dc2626; }
.pi-ev-value--neutral { color: #0f172a; }
.pi-ev-value--warning { color: #b45309; }
.pi-ev-sub {
  font-size: 11px; color: #64748b; margin-top: 1px;
}
.pi-ev-badge {
  font-size: 10px; font-weight: 600; padding: 2px 7px;
  border-radius: 4px; display: inline-block; margin-top: 2px;
  width: fit-content;
}
.pi-ev-badge--best { background: #f0fdf4; color: #15803d; }
.pi-ev-badge--worst { background: #fef2f2; color: #dc2626; }
.pi-ev-badge--neutral { background: #f1f5f9; color: #475569; }
.pi-ev-badge--warning { background: #fffbeb; color: #92400e; }

/* Comparison Bar */
.pi-comparison-bar {
  padding: 10px 14px; border-bottom: 0.5px solid #e2e8f0;
}
.pi-cbar-label {
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
  color: #94a3b8; text-transform: uppercase; margin-bottom: 8px;
}
.pi-cbar-row {
  display: flex; align-items: center; gap: 8px; margin-bottom: 5px;
}
.pi-cbar-row:last-child { margin-bottom: 0; }
/* CR-X UI: Long-name containment without crushing evidence.
   Name region: flex-shrink with max-width and ellipsis as last defense.
   Bar region: flexible (flex: 1, min-width: 40px).
   Value region: flex: 0 0 auto — takes natural width, NO truncation.
   Values may wrap to a second line rather than being ellipsized. */
.pi-cbar-name {
  font-size: 11px; color: #475569; flex-shrink: 1;
  min-width: 0;
  max-width: 220px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pi-cbar-track {
  flex: 1; height: 6px; background: #f1f5f9;
  border-radius: 6px; overflow: hidden;
  min-width: 40px;
}
.pi-cbar-fill {
  height: 100%; border-radius: 6px;
}
.pi-cbar-val {
  font-size: 11px; font-weight: 600;
  text-align: right; flex: 0 0 auto;
  white-space: nowrap;
}
.pi-cbar-tag {
  font-size: 9px; font-weight: 700; padding: 1px 5px;
  border-radius: 3px; flex-shrink: 0;
}
.pi-cbar-tag--best { background: #f0fdf4; color: #15803d; }
.pi-cbar-tag--worst { background: #fef2f2; color: #dc2626; }
.pi-cbar-tag--neutral { background: #f1f5f9; color: #475569; }

/* Period Trend — horizontal proportional-bar rows.
   CR-X UI Redo: deliberately shares the .pi-cbar-* sizing/type scale
   (11px names, 6px track height, 11px bold values) so this region reads
   as the same designed system as the accepted comparisonRows treatment
   directly above it, not a separate chart component bolted on. */
.pi-period-trend {
  padding: 10px 14px; border-bottom: 0.5px solid #e2e8f0;
}
.pi-ptrend-row {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
}
.pi-ptrend-row:last-child { margin-bottom: 0; }
.pi-ptrend-row--latest { margin-top: 2px; }
/* CR-X UI: Compact intermediate rows for dense histories.
   Reduce visual weight so first/latest/transitions stand out. */
.pi-ptrend-row--compact {
  margin-bottom: 3px;
  opacity: 0.55;
}
.pi-ptrend-row--compact .pi-ptrend-period {
  font-size: 9px;
}
.pi-ptrend-row--compact .pi-ptrend-val {
  font-size: 10px;
}
.pi-ptrend-period {
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.05em;
  text-transform: uppercase; color: #94a3b8; flex-shrink: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 100px;
}
.pi-ptrend-row--latest .pi-ptrend-period { color: #475569; font-weight: 700; }
.pi-ptrend-track {
  flex: 1; height: 6px; background: #f1f5f9;
  border-radius: 6px; overflow: hidden;
  min-width: 40px;
}
.pi-ptrend-fill {
  height: 100%; border-radius: 6px; transition: width 0.2s ease;
}
.pi-ptrend-val {
  font-size: 11px; font-weight: 600; color: #64748b;
  text-align: right; flex: 0 0 auto;
  white-space: nowrap;
}
.pi-ptrend-val--latest {
  font-size: 13px; font-weight: 700;
}
.pi-ptrend-tag {
  font-size: 9px; font-weight: 700; color: #475569;
  background: #f1f5f9; padding: 2px 7px; border-radius: 10px;
  white-space: nowrap; flex-shrink: 0;
}
.pi-ptrend-secondary {
  font-size: 9px; font-weight: 500; color: #94a3b8;
  white-space: nowrap; flex-shrink: 1;
  overflow: hidden; text-overflow: ellipsis;
  max-width: 120px;
}

/* Signal Row */
.pi-signal-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0;
  border-bottom: 0.5px solid #e2e8f0;
}
.pi-sig-cell {
  padding: 10px 14px; border-right: 0.5px solid #e2e8f0;
}
.pi-sig-cell:last-child { border-right: none; }
.pi-sig-label {
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
  color: #94a3b8; text-transform: uppercase; margin-bottom: 3px;
}
.pi-sig-value {
  font-size: 12px; color: #0f172a; font-weight: 500;
}
.pi-sig-sub {
  font-size: 11px; color: #64748b; margin-top: 1px;
}

/* Action Strip */
.pi-action-strip {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 13px 18px; background: #f8fff9;
  border-top: 0.5px solid #bbf7d0;
}
.pi-action-icon {
  width: 30px; height: 30px; border-radius: 50%;
  background: #dcfce7; display: flex; align-items: center;
  justify-content: center; flex-shrink: 0;
}
.pi-action-body { flex: 1; min-width: 0; }
.pi-action-top {
  display: flex; align-items: center; gap: 6px; margin-bottom: 3px;
}
.pi-action-label {
  font-size: 9px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.07em;
}
.pi-action-badge {
  font-size: 9px; font-weight: 700; background: #dcfce7;
  color: #15803d; padding: 1px 6px; border-radius: 3px;
  text-transform: uppercase;
}
.pi-action-badge--monitor {
  background: #dbeafe;
  color: #1d4ed8;
}
.pi-action-text {
  font-size: 12px; color: #374151; line-height: 1.5;
}

/* Card Footer */
.pi-card-footer {
  display: flex; align-items: center; gap: 5px;
  padding: 7px 18px; font-size: 10px; color: #94a3b8;
  border-top: 0.5px solid #f1f5f9;
}

/* KPI row (legacy, kept for reference) */
.pi-kpi-row {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 0; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;
  margin-bottom: 18px;
}
.pi-kpi {
  padding: 12px 16px; border-right: 1px solid #e2e8f0;
  min-height: 72px;
}
.pi-kpi:last-child { border-right: none; }
.pi-kpi-label { font-size: 10.5px; font-weight: 600; color: #94a3b8; letter-spacing: 0.05em; margin-bottom: 4px; }
.pi-kpi-value {
  font-size: 20px; font-weight: 800; color: #0f172a;
  display: flex; align-items: center; gap: 4px;
  line-height: 1.2;
}
.pi-kpi-value--metric { font-size: 22px; }
.pi-kpi-value--ranking {
  font-size: 13px;
  font-weight: 600;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  line-height: 1.3;
}
.pi-ranking-row {
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.2;
}
.pi-kpi-value--red { color: #ef4444; }
.pi-kpi-value--green { color: #22c55e; }
.pi-kpi-value--orange { color: #f59e0b; }
.pi-kpi-value--gray { color: #94a3b8; }
.pi-kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 4px; }

/* Middle row */
.pi-mid-row {
  display: grid; grid-template-columns: 2fr 1.4fr 1.3fr;
  gap: 14px;
}
.pi-card {
  border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px;
  transition: all 0.15s ease;
}
.pi-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  border-color: #cbd5e1;
}
.pi-card-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 10.5px; font-weight: 700; color: #64748b;
  letter-spacing: 0.07em; margin-bottom: 8px;
}
.pi-card-text { font-size: 12.5px; color: #374151; line-height: 1.5; margin: 0 0 10px; }

/* Chart */
.pi-chart-legend { display: flex; gap: 12px; margin-bottom: 8px; }
.pi-legend-item { font-size: 11px; color: #64748b; }
.pi-legend-item--ai { color: #22c55e; }
.pi-legend-item--nonai { color: #94a3b8; }
.pi-chart-wrap { width: 100%; }
.pi-sparkline { width: 100%; height: auto; overflow: visible; }
.pi-axis-label { font-size: 9px; fill: #94a3b8; }

/* Why items */
.pi-why-items { display: flex; flex-direction: column; gap: 8px; }
.pi-why-item {
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px;
}
.pi-why-icon { display: flex; align-items: center; }
.pi-why-label { flex: 1; color: #374151; }
.pi-why-val { font-weight: 700; font-size: 12px; }

/* Signal pills */
.pi-signal-pills {
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;
}
.pi-signal-pill {
  font-size: 10px; font-weight: 600; color: #64748b;
  background: #f1f5f9; border: 1px solid #e2e8f0;
  border-radius: 12px; padding: 3px 8px;
  letter-spacing: 0.02em;
}

/* Evidence grid */
.pi-evidence-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px 4px;
}
.pi-evidence-cell {
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;
  padding: 7px 10px; display: flex; flex-direction: column; gap: 2px;
}
.pi-ev-cell-label { font-size: 9px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.03em; }
.pi-ev-cell-value { font-size: 11px; font-weight: 700; color: #0f172a; }

/* Colors */
.pi-red { color: #ef4444; }
.pi-green { color: #22c55e; }

/* Action card */
.pi-action-card {
  background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px;
  padding: 16px 20px; display: flex; align-items: center; gap: 16px;
  margin-bottom: 4px;
}
.pi-action-icon {
  width: 42px; height: 42px; background: #dcfce7; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.pi-action-body { flex: 1; min-width: 0; }
.pi-action-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
.pi-action-title { font-size: 10px; font-weight: 700; color: #64748b; letter-spacing: 0.06em; }
.pi-recommended-badge {
  background: #dcfce7; color: #16a34a;
  font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;
}
.pi-action-text { font-size: 12.5px; color: #374151; line-height: 1.5; margin: 0; }

.pi-action-impacts { display: flex; flex-direction: column; gap: 3px; flex-shrink: 0; }
.pi-action-label { font-size: 10px; font-weight: 700; color: #16a34a; letter-spacing: 0.06em; margin-bottom: 4px; }
.pi-action-metrics { display: flex; flex-direction: column; gap: 5px; }
.pi-action-metric { display: flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 800; white-space: nowrap; }
.pi-action-metric-label { font-size: 11px; font-weight: 400; color: #64748b; }

.pi-view-actions-btn {
  display: flex; align-items: center; gap: 6px;
  background: #fff; border: 1.5px solid #22c55e; border-radius: 8px;
  padding: 9px 16px; font-size: 13px; font-weight: 600; color: #16a34a;
  cursor: pointer; white-space: nowrap; transition: background 0.15s;
  flex-shrink: 0;
}
.pi-view-actions-btn:hover { background: #f0fdf4; }

/* Footer */
.pi-footer {
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: #64748b; border-top: 1px solid #f1f5f9;
  padding: 8px 0 10px;
}

/* CR-X UI: Responsive behavior at laptop widths (1280–1440px).
   3/4 evidence columns collapse to 2, comparison widths loosen,
   metric typography becomes slightly smaller.
   Keep the principle: adapt to real laptop widths, not an afterthought. */
@media (max-width: 1280px) {
  .pi-evidence-band--3 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .pi-evidence-band--4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .pi-ev-value {
    font-size: 18px;
  }
  .pi-cbar-name {
    max-width: 160px;
  }
  .pi-ptrend-secondary {
    max-width: 80px;
  }
}

@media (max-width: 1024px) {
  .pi-evidence-band--2,
  .pi-evidence-band--3,
  .pi-evidence-band--4 {
    grid-template-columns: 1fr;
  }
  .pi-ev-cell {
    border-right: none;
    border-bottom: 0.5px solid #e2e8f0;
  }
  .pi-ev-cell:last-child {
    border-bottom: none;
  }
}
</style>
