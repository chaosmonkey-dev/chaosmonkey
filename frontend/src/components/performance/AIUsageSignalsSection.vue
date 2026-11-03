<template>
  <!-- TRANSITIONAL COMPONENT - AIUsageSignalsSection.vue -->
  <!-- Container component with v-if switch between panel and legacy implementation -->
  <!-- ACTIVE CANONICAL COMPONENT: AIUsageSignalsPanel.vue (usePanel = true) -->
  <!-- LEGACY COMPONENT: Legacy row implementation (usePanel = false, not recommended) -->
  <div class="ai-usage-signals-section">
    <!-- NEW PANEL IMPLEMENTATION -->
    <AIUsageSignalsPanel
      v-if="usePanel"
      :scope="scope"
      :canonical-aggregated="canonicalAggregated"
      :canonical-aggregated-metadata="canonicalAggregatedMetadata"
      :canonical-hydrating="canonicalHydrating"
      :evidence-completeness="evidenceCompleteness"
      :evidence-status-label="evidenceStatusLabel"
      :observed-authority="observedAuthority"
      @signal-click="handleSignalClick"
    />

    <!-- LEGACY ROW IMPLEMENTATION (kept for fallback) -->
    <template v-else>
      <!-- STEP A: SECTION HEADER (match Performance Insights stage header exactly) -->
      <div class="cicd-stage-section">
        <div class="cicd-section-header cicd-section-header--compact d-flex align-items-start justify-content-between gap-2 mb-2">
          <div class="d-flex align-items-start gap-2">
            <div class="stage-icon-wrapper bg-info">
              <i class="bi bi-robot text-white"></i>
            </div>
            <div class="d-flex flex-column">
              <div class="d-flex align-items-center gap-2">
                <h5 class="mb-0 fw-bold">AI Usage Signals</h5>
                <span class="badge bg-info-subtle text-info">6</span>
              </div>
              <small class="text-muted">How actively and effectively AI tools are used across IDEs</small>
            </div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="badge badge-sm bg-info-subtle text-info">Telemetry</span>
            <span class="badge badge-sm bg-secondary-subtle text-secondary">ORG</span>
          </div>
        </div>

      <!-- STEP E: GUARDRAIL LINE -->
      <div class="mb-2 small text-muted">
        <i class="bi bi-info-circle me-1"></i>
        Usage signals reflect how AI tools are used.
      </div>

      <!-- STEP B: SIGNAL STRIPS (PI-style rows) -->
      <div class="insight-strip">
      <!-- Coverage Row -->
      <div class="insight-strip-row" data-pi-region="strip">
        <div class="insight-strip-row-collapsed d-flex align-items-center gap-2" @click="toggleExpand('coverage')">
          <div class="insight-strip-severity severity-info">
            <i class="bi bi-activity"></i>
          </div>
          <div class="insight-strip-title flex-grow-1 min-w-0">
            <div class="d-flex align-items-center gap-2 min-w-0">
              <span class="text-truncate">Telemetry coverage by IDE</span>
            </div>
            <div class="text-muted" style="font-size: 0.75rem; line-height: 1.1;">Per-IDE session counts and active minutes</div>
          </div>
          <div class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
            <span class="insight-strip-evidence-item">
              <span class="insight-strip-evidence-value">{{ coverageSummary }}</span>
            </span>
          </div>
          <span class="badge badge-sm insight-strip-scope-pill" :class="coverageStatusClass">{{ coverageStatus }}</span>
          <i class="bi insight-strip-chevron" :class="expandedIds.has('coverage') ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
        </div>
        <div v-if="expandedIds.has('coverage')" class="insight-strip-row-expanded">
          <div class="insight-expanded-panel">
            <div class="insight-expanded-header">
              <h6 class="insight-expanded-title">Telemetry coverage by IDE</h6>
              <div class="insight-expanded-badges">
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--scope">ORG</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--source bg-info-subtle text-info">TELEMETRY</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--severity bg-info-subtle text-info">INFO</span>
              </div>
            </div>
            <div class="insight-expanded-section insight-expanded-description-section">
              <div class="insight-expanded-section-label">What's happening</div>
              <div class="insight-expanded-section-content insight-expanded-description">{{ coverageWhatHappening }}</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Why it matters</div>
              <div class="insight-expanded-section-content">Coverage determines which IDEs contribute to AI usage signals and confidence in comparisons.</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Evidence</div>
              <div class="insight-expanded-section-content">
                <div class="insight-expanded-evidence">
                  <div v-for="ide in coverageEvidence" :key="ide.label" class="insight-expanded-evidence-row">
                    <span class="insight-expanded-evidence-label">{{ ide.label }}</span>
                    <span class="insight-expanded-evidence-value">{{ ide.value }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Recommendation</div>
              <div class="insight-expanded-section-content">{{ coverageRecommendation }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Assist Rate Row -->
      <div v-if="assistRateAvailable" class="insight-strip-row" data-pi-region="strip">
        <div class="insight-strip-row-collapsed d-flex align-items-center gap-2" @click="toggleExpand('assist-rate')">
          <div class="insight-strip-severity severity-highlight">
            <i class="bi bi-speedometer2"></i>
          </div>
          <div class="insight-strip-title flex-grow-1 min-w-0">
            <div class="d-flex align-items-center gap-2 min-w-0">
              <span class="text-truncate">{{ assistRateTitle }}</span>
            </div>
            <div class="text-muted" style="font-size: 0.75rem; line-height: 1.1;">Accepted assists per active coding minute</div>
          </div>
          <div class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
            <span class="insight-strip-evidence-item">
              <span class="insight-strip-evidence-value">{{ assistRateValue }}{{ assistRateDelta }}</span>
            </span>
          </div>
          <span class="badge badge-sm insight-strip-scope-pill bg-success-subtle text-success">LIVE</span>
          <i class="bi insight-strip-chevron" :class="expandedIds.has('assist-rate') ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
        </div>
        <div v-if="expandedIds.has('assist-rate')" class="insight-strip-row-expanded">
          <div class="insight-expanded-panel insight-expanded-panel--strip">
            <div class="insight-expanded-header">
              <h6 class="insight-expanded-title">{{ assistRateTitle }}</h6>
              <div class="insight-expanded-badges">
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--scope">ORG</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--source bg-info-subtle text-info">TELEMETRY</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--severity bg-warning-subtle text-warning">WARNING</span>
              </div>
            </div>
            <div class="insight-expanded-section insight-expanded-description-section">
              <div class="insight-expanded-section-label">What's happening</div>
              <div class="insight-expanded-section-content insight-expanded-description">{{ assistRateWhatHappening }}</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Why it matters</div>
              <div class="insight-expanded-section-content">Indicates heavier accepted-suggestion usage; not a measure of quality/impact.</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Evidence</div>
              <div class="insight-expanded-section-content">
                <div class="insight-expanded-evidence">
                  <div v-for="ide in assistRateEvidence" :key="ide.label" class="insight-expanded-evidence-row">
                    <span class="insight-expanded-evidence-label">{{ ide.label }}</span>
                    <span class="insight-expanded-evidence-value">{{ ide.value }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Recommendation</div>
              <div class="insight-expanded-section-content">{{ assistRateRecommendation }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Acceptance Share Row -->
      <div v-if="acceptanceShareAvailable" class="insight-strip-row" data-pi-region="strip">
        <div class="insight-strip-row-collapsed d-flex align-items-center gap-2" @click="toggleExpand('acceptance-share')">
          <div class="insight-strip-severity severity-info">
            <i class="bi bi-pie-chart"></i>
          </div>
          <div class="insight-strip-title flex-grow-1 min-w-0">
            <div class="d-flex align-items-center gap-2 min-w-0">
              <span class="text-truncate">{{ acceptanceShareTitle }}</span>
            </div>
            <div class="text-muted" style="font-size: 0.75rem; line-height: 1.1;">Share of accepted assists attributed to each IDE</div>
          </div>
          <div class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
            <span class="insight-strip-evidence-item">
              <span class="insight-strip-evidence-value">{{ acceptanceShareValue }}{{ acceptanceShareDelta }}</span>
            </span>
          </div>
          <span class="badge badge-sm insight-strip-scope-pill bg-success-subtle text-success">LIVE</span>
          <i class="bi insight-strip-chevron" :class="expandedIds.has('acceptance-share') ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
        </div>
        <div v-if="expandedIds.has('acceptance-share')" class="insight-strip-row-expanded">
          <div class="insight-expanded-panel insight-expanded-panel--strip">
            <div class="insight-expanded-header">
              <h6 class="insight-expanded-title">{{ acceptanceShareTitle }}</h6>
              <div class="insight-expanded-badges">
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--scope">ORG</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--source bg-info-subtle text-info">TELEMETRY</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--severity bg-info-subtle text-info">INFO</span>
              </div>
            </div>
            <div class="insight-expanded-section insight-expanded-description-section">
              <div class="insight-expanded-section-label">What's happening</div>
              <div class="insight-expanded-section-content insight-expanded-description">{{ acceptanceShareWhatHappening }}</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Why it matters</div>
              <div class="insight-expanded-section-content">Shows which IDEs dominate AI acceptance; useful for workflow standardization.</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Evidence</div>
              <div class="insight-expanded-section-content">
                <div class="insight-expanded-evidence">
                  <div v-for="ide in acceptanceShareEvidence" :key="ide.label" class="insight-expanded-evidence-row">
                    <span class="insight-expanded-evidence-label">{{ ide.label }}</span>
                    <span class="insight-expanded-evidence-value">{{ ide.value }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Recommendation</div>
              <div class="insight-expanded-section-content">{{ acceptanceShareRecommendation }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Trend Row (conditional) -->
      <div v-if="trendAvailable" class="insight-strip-row" data-pi-region="strip">
        <div class="insight-strip-row-collapsed d-flex align-items-center gap-2" @click="toggleExpand('trend')">
          <div class="insight-strip-severity severity-opportunity">
            <i class="bi bi-graph-up"></i>
          </div>
          <div class="insight-strip-title flex-grow-1 min-w-0">
            <div class="d-flex align-items-center gap-2 min-w-0">
              <span class="text-truncate">AI assist rate trend (30d)</span>
            </div>
            <div class="text-muted" style="font-size: 0.75rem; line-height: 1.1;">Direction over the last 30 days</div>
          </div>
          <div class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
            <span class="insight-strip-evidence-item">
              <span class="insight-strip-evidence-value">{{ trendValue }}</span>
            </span>
          </div>
          <span class="badge badge-sm insight-strip-scope-pill bg-success-subtle text-success">LIVE</span>
          <i class="bi insight-strip-chevron" :class="expandedIds.has('trend') ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
        </div>
        <div v-if="expandedIds.has('trend')" class="insight-strip-row-expanded">
          <div class="ai-signal-expanded">
            <div class="ai-signal-section">
              <h6 class="ai-signal-section-title">WHAT'S HAPPENING</h6>
              <p class="ai-signal-text">{{ trendWhatHappening }}</p>
            </div>
            <div class="ai-signal-section">
              <h6 class="ai-signal-section-title">WHY IT MATTERS</h6>
              <p class="ai-signal-text">Trend indicates adoption patterns; validate with sampling and instrumentation consistency.</p>
            </div>
            <div class="ai-signal-section">
              <h6 class="ai-signal-section-title">EVIDENCE</h6>
              <div class="ai-evidence-table">
                <div class="evidence-row">
                  <span class="evidence-label">Current window</span>
                  <span class="evidence-value">{{ trendEvidence.current }}</span>
                </div>
                <div class="evidence-row">
                  <span class="evidence-label">Prior window</span>
                  <span class="evidence-value">{{ trendEvidence.prior }}</span>
                </div>
              </div>
            </div>
            <div class="ai-signal-section">
              <h6 class="ai-signal-section-title">RECOMMENDATION</h6>
              <p class="ai-signal-text">{{ trendRecommendation }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Review Presence Row -->
      <div class="insight-strip-row" data-pi-region="strip">
        <div class="insight-strip-row-collapsed d-flex align-items-center gap-2" @click="toggleExpand('review-presence')">
          <div class="insight-strip-severity" :class="reviewPresenceSeverityClass">
            <i class="bi bi-eye"></i>
          </div>
          <div class="insight-strip-title flex-grow-1 min-w-0">
            <div class="d-flex align-items-center gap-2 min-w-0">
              <span class="text-truncate">AI-assisted code in reviews</span>
            </div>
            <div class="text-muted" style="font-size: 0.75rem; line-height: 1.1;">Whether AI-assisted code appears in PR reviews</div>
          </div>
          <div class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
            <span class="insight-strip-evidence-item">
              <span class="insight-strip-evidence-value">{{ reviewPresenceValue }}</span>
            </span>
          </div>
          <span class="badge badge-sm insight-strip-scope-pill" :class="reviewPresenceStatusClass">{{ reviewPresenceStatus }}</span>
          <i class="bi insight-strip-chevron" :class="expandedIds.has('review-presence') ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
        </div>
        <div v-if="expandedIds.has('review-presence')" class="insight-strip-row-expanded">
          <div class="insight-expanded-panel insight-expanded-panel--strip">
            <div class="insight-expanded-header">
              <h6 class="insight-expanded-title">AI-assisted code in reviews</h6>
              <div class="insight-expanded-badges">
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--scope">ORG</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--source bg-secondary-subtle text-secondary">INSTRUMENTATION</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--severity bg-warning-subtle text-warning">WARNING</span>
              </div>
            </div>
            <div class="insight-expanded-section insight-expanded-description-section">
              <div class="insight-expanded-section-label">What's happening</div>
              <div class="insight-expanded-section-content insight-expanded-description">{{ reviewPresenceWhatHappening }}</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Why it matters</div>
              <div class="insight-expanded-section-content">Review presence indicates whether AI assistance reaches collaborative review stages.</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Evidence</div>
              <div class="insight-expanded-section-content">
                <div class="insight-expanded-evidence">
                  <div class="insight-expanded-evidence-row">
                    <span class="insight-expanded-evidence-label">Status</span>
                    <span class="insight-expanded-evidence-value">{{ reviewPresenceEvidence.status }}</span>
                  </div>
                  <div v-if="reviewPresenceEvidence.coverage" class="insight-expanded-evidence-row">
                    <span class="insight-expanded-evidence-label">Coverage</span>
                    <span class="insight-expanded-evidence-value">{{ reviewPresenceEvidence.coverage }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Recommendation</div>
              <div class="insight-expanded-section-content">{{ reviewPresenceRecommendation }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Delivery Cadence Signal Row -->
      <div class="insight-strip-row" data-pi-region="strip">
        <div class="insight-strip-row-collapsed d-flex align-items-center gap-2" @click="toggleExpand('delivery-cadence')">
          <div class="insight-strip-severity severity-info">
            <i class="bi bi-speedometer"></i>
          </div>
          <div class="insight-strip-title flex-grow-1 min-w-0">
            <div class="d-flex align-items-center gap-2 min-w-0">
              <span class="text-truncate">{{ deliveryCadenceTitle }}</span>
            </div>
            <div class="text-muted" style="font-size: 0.75rem; line-height: 1.1;">{{ deliveryCadenceSubtitle }}</div>
          </div>
          <div class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
            <span class="insight-strip-evidence-item">
              <span class="insight-strip-evidence-value">{{ deliveryCadenceValue }}</span>
            </span>
          </div>
          <span class="badge badge-sm insight-strip-scope-pill" :class="deliveryCadenceStatusClass">{{ deliveryCadenceStatus }}</span>
          <i class="bi insight-strip-chevron" :class="expandedIds.has('delivery-cadence') ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
        </div>
        <div v-if="expandedIds.has('delivery-cadence')" class="insight-strip-row-expanded">
          <div class="insight-expanded-panel insight-expanded-panel--strip">
            <div class="insight-expanded-header">
              <h6 class="insight-expanded-title">{{ deliveryCadenceTitle }}</h6>
              <div class="insight-expanded-badges">
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--scope">ORG</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--source bg-info-subtle text-info">DORA</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--severity" :class="deliveryCadenceStatusClass">{{ deliveryCadenceStatus }}</span>
              </div>
            </div>
            <div class="insight-expanded-section insight-expanded-description-section">
              <div class="insight-expanded-section-label">What's happening</div>
              <div class="insight-expanded-section-content insight-expanded-description">{{ deliveryCadenceWhatHappening }}</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Why it matters</div>
              <div class="insight-expanded-section-content">{{ deliveryCadenceWhyItMatters }}</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Evidence</div>
              <div class="insight-expanded-section-content">
                <div class="insight-expanded-evidence">
                  <div v-for="evidence in deliveryCadenceEvidence" :key="evidence.label" class="insight-expanded-evidence-row">
                    <span class="insight-expanded-evidence-label">{{ evidence.label }}</span>
                    <span class="insight-expanded-evidence-value">{{ evidence.value }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Recommendation</div>
              <div class="insight-expanded-section-content">{{ deliveryCadenceRecommendation }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Release Risk Signal Row -->
      <div class="insight-strip-row" data-pi-region="strip">
        <div class="insight-strip-row-collapsed d-flex align-items-center gap-2" @click="toggleExpand('release-risk')">
          <div class="insight-strip-severity" :class="releaseRiskSeverityClass">
            <i class="bi bi-shield-exclamation"></i>
          </div>
          <div class="insight-strip-title flex-grow-1 min-w-0">
            <div class="d-flex align-items-center gap-2 min-w-0">
              <span class="text-truncate">{{ releaseRiskTitle }}</span>
            </div>
            <div class="text-muted" style="font-size: 0.75rem; line-height: 1.1;">{{ releaseRiskSubtitle }}</div>
          </div>
          <div class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
            <span class="insight-strip-evidence-item">
              <span class="insight-strip-evidence-value">{{ releaseRiskValue }}</span>
            </span>
          </div>
          <span class="badge badge-sm insight-strip-scope-pill" :class="releaseRiskStatusClass">{{ releaseRiskStatus }}</span>
          <i class="bi insight-strip-chevron" :class="expandedIds.has('release-risk') ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
        </div>
        <div v-if="expandedIds.has('release-risk')" class="insight-strip-row-expanded">
          <div class="insight-expanded-panel insight-expanded-panel--strip">
            <div class="insight-expanded-header">
              <h6 class="insight-expanded-title">{{ releaseRiskTitle }}</h6>
              <div class="insight-expanded-badges">
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--scope">ORG</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--source bg-info-subtle text-info">DORA</span>
                <span class="badge badge-sm insight-expanded-badge insight-expanded-badge--severity" :class="releaseRiskStatusClass">{{ releaseRiskStatus }}</span>
              </div>
            </div>
            <div class="insight-expanded-section insight-expanded-description-section">
              <div class="insight-expanded-section-label">What's happening</div>
              <div class="insight-expanded-section-content insight-expanded-description">{{ releaseRiskWhatHappening }}</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Why it matters</div>
              <div class="insight-expanded-section-content">{{ releaseRiskWhyItMatters }}</div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Evidence</div>
              <div class="insight-expanded-section-content">
                <div class="insight-expanded-evidence">
                  <div v-for="evidence in releaseRiskEvidence" :key="evidence.label" class="insight-expanded-evidence-row">
                    <span class="insight-expanded-evidence-label">{{ evidence.label }}</span>
                    <span class="insight-expanded-evidence-value">{{ evidence.value }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="insight-expanded-section">
              <div class="insight-expanded-section-label">Recommendation</div>
              <div class="insight-expanded-section-content">{{ releaseRiskRecommendation }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import AIUsageSignalsPanel from './AIUsageSignalsPanel.vue'

if (import.meta.env.DEV && import.meta.env.VITE_PI_DEBUG === 'true') console.log('[ACTIVE_COMPONENT] AIUsageSignalsSection.vue mounted')

// Flag to switch between panel and legacy implementation
const usePanel = true

// Handle signal click - scroll to linked Performance Insights
const emit = defineEmits<{
  signalClick: [signalId: string, linkedInsights: string[]]
}>()

function handleSignalClick(signalId: string, linkedInsights: string[]) {
  emit('signalClick', signalId, linkedInsights)
  
  // Scroll to Performance Insights section
  const piSection = document.querySelector('.performance-insights-section')
  if (piSection) {
    piSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

/*
 * PHASE 1 - LIVE DATA SOURCE IDENTIFIED:
 * AI signals source: useMetricsFacadeStore().getProductivityTimeSeries()
 * Live Payload Keys used:
 * - prodSeries[].tool (IDE identifier: cursor, vscode, windsurf, etc.)
 * - prodSeries[].aiAssists (number of accepted AI suggestions)
 * - prodSeries[].codingMinutes (active coding time minutes)
 * - prodSeries[].commits (number of commits)
 * - prodSeries[].sessionMinutes (total session minutes)
 * - prodSeries[].source ('live'|'sim'|'hybrid')
 * - prodSeries[].period (time period identifier)
 * - doraMetrics[].name/value/source/confidence (for delivery context)
 */

const props = defineProps({
  scope: { type: String, default: 'org' },
  metrics: { type: Array as () => any[], default: () => [] },
  doraMetrics: { type: Array as () => any[], default: () => [] },
  prodSeries: { type: Array as () => any[], default: () => [] }, // ToolProductivityPoint[]
  prevProdSeries: { type: Array as () => any[], default: () => [] }, // Previous period data
  sessions: { type: Array as () => any[], default: () => [] },
  canonicalAggregated: { type: Array as () => any[], default: () => [] },
  canonicalAggregatedMetadata: { type: Object as () => Record<string, any>, default: () => ({}) },
  // CR5 WS1.6 P0: Pass canonicalHydrating through to AIUsageSignalsPanel
  // so LOADING != EMPTY. Without this, the panel defaults to
  // canonicalHydrating=false and renders "0 sessions" / "Ready for your
  // first telemetry" during initial load.
  canonicalHydrating: { type: Boolean, default: false },
  // CR-X FREEZE: Evidence-completeness must flow to the panel or it will
  // default to 'loading' and show a stale 'Loading historical telemetry…' copy
  // after AIOI and PI have already resolved.
  evidenceCompleteness: { type: String as () => 'full' | 'partial' | 'error' | 'loading', default: 'loading' },
  evidenceStatusLabel: { type: String, default: '' },
  // CR5 WS1 — shared observed commit/TTFC authority. When provided (even as
  // an empty Map), AIOI commits/session and TTFC come only from this authority.
  // Empty Map => unavailable. NEVER falls back to synthetic aggregated values.
  observedAuthority: { type: Object as () => Map<string, any>, default: () => new Map() },
})

// PHASE 2 - MINIMUM VIEW-MODEL ADAPTER
const aiSignalsModel = computed(() => {
  const points = props.prodSeries || []
  
  // 🔥 STATE: Mark that we've attempted to load telemetry data
  hasAttemptedLoad.value = true
  
  // Group by tool for calculations
  const byTool = new Map<string, {
    toolId: string
    sessions: number
    codingMinutes: number
    acceptedAssists: number
    commits: number
    sessionMinutes: number
    sources: Set<string>
  }>()
  
  for (const point of points) {
    const toolId = String(point.tool || 'unknown').toLowerCase()
    if (!byTool.has(toolId)) {
      byTool.set(toolId, {
        toolId,
        sessions: 0,
        codingMinutes: 0,
        acceptedAssists: 0,
        commits: 0,
        sessionMinutes: 0,
        sources: new Set()
      })
    }
    
    const tool = byTool.get(toolId)!
    tool.sessions += 1
    tool.codingMinutes += Number(point.codingMinutes || 0)
    tool.acceptedAssists += Number(point.aiAssists || 0)
    tool.commits += Number(point.commits || 0)
    tool.sessionMinutes += Number(point.sessionMinutes || 0)
    
    if (point.source) tool.sources.add(point.source)
  }
  
  const toolsArray = Array.from(byTool.values())
  
  // Calculate assist rate (assists per 100 active minutes)
  const toolsWithRate = toolsArray.map(tool => ({
    ...tool,
    assistRatePer100Min: tool.codingMinutes > 0 ? (tool.acceptedAssists / tool.codingMinutes) * 100 : 0
  }))
  
  // Sort by assist rate to find winner
  const sortedByRate = [...toolsWithRate].sort((a, b) => b.assistRatePer100Min - a.assistRatePer100Min)
  const winner = sortedByRate[0]
  const runnerUp = sortedByRate[1]
  
  // Calculate acceptance share (share of total assists)
  const totalAssists = toolsArray.reduce((sum, tool) => sum + tool.acceptedAssists, 0)
  const acceptanceShares = totalAssists > 0 ? toolsArray.map(tool => ({
    toolId: tool.toolId,
    sharePct: (tool.acceptedAssists / totalAssists) * 100,
    acceptedAssists: tool.acceptedAssists
  })).sort((a, b) => b.sharePct - a.sharePct) : []
  
  const acceptanceWinner = acceptanceShares[0]
  const acceptanceRunnerUp = acceptanceShares[1]
  
  // Coverage by IDE (always present)
  const coverageByIde = toolsArray.map(tool => ({
    toolId: tool.toolId,
    sessions: tool.sessions,
    codingMinutes: tool.codingMinutes,
    acceptedAssists: tool.acceptedAssists
  }))
  
  // Assist rate (null if no data)
  const assistRate = winner && winner.assistRatePer100Min > 0 ? {
    winnerToolId: winner.toolId,
    valuePer100Min: winner.assistRatePer100Min,
    runnerUpToolId: runnerUp?.toolId,
    deltaPctVsRunnerUp: runnerUp ? ((winner.assistRatePer100Min - runnerUp.assistRatePer100Min) / Math.max(runnerUp.assistRatePer100Min, 0.001)) * 100 : 0,
    sessionsTotal: toolsArray.reduce((sum, tool) => sum + tool.sessions, 0)
  } : null
  
  // Acceptance share (null if no data)
  const acceptanceShare = acceptanceWinner ? {
    winnerToolId: acceptanceWinner.toolId,
    winnerSharePct: acceptanceWinner.sharePct,
    runnerUpToolId: acceptanceRunnerUp?.toolId,
    deltaPctPoints: acceptanceRunnerUp ? acceptanceWinner.sharePct - acceptanceRunnerUp.sharePct : 0
  } : null
  
  // Trend (null - no trend data in current payload)
  const trend30d = null
  
  // Review presence (null - no review instrumentation in current payload)
  const reviewPresence = null
  
  // DORA context
  const doraContext = (props.doraMetrics || []).map(metric => ({
    name: metric.name,
    valueText: metric.value || metric.missingState || 'Insufficient data',
    sourceText: metric.source || 'Unknown',
    confidence: (metric.confidence || 'Unknown').charAt(0).toUpperCase() + (metric.confidence || 'Unknown').slice(1).toLowerCase() as "High" | "Medium" | "Low" | "Unknown"
  }))
  
  // Debug keys for development
  const debugKeys = [
    'prodSeries[].{tool,aiAssists,codingMinutes,source}',
    props.doraMetrics?.length ? `doraMetrics[].{name,value,source,confidence}` : null
  ].filter(Boolean).join(' | ')
  
  return {
    timeRangeLabel: points.length > 0 ? `Last ${points.length} data points` : undefined,
    coverageByIde,
    assistRate,
    acceptanceShare,
    trend30d,
    reviewPresence,
    doraContext,
    debugKeys
  }
})

// PHASE 3 - RESTORE MISSING TEMPLATE DEPENDENCIES

// 🔥 STATE: Track if we've attempted to load telemetry data
const hasAttemptedLoad = ref(false)

// Expansion state management
const expandedIds = ref<Set<string>>(new Set())

function toggleExpand(id: string) {
  if (expandedIds.value.has(id)) {
    expandedIds.value.delete(id)
  } else {
    expandedIds.value.clear()
    expandedIds.value.add(id)
  }
}

function isExpanded(id: string): boolean {
  return expandedIds.value.has(id)
}

// Utility functions
function getToolLabelLocal(toolId: string): string {
  const labels: Record<string, string> = {
    'cursor': 'Cursor',
    'vscode': 'VS Code', 
    'windsurf': 'Windsurf',
    'jetbrains': 'JetBrains',
    'sublime': 'Sublime',
    'vim': 'Vim'
  }
  return labels[toolId.toLowerCase()] || toolId.charAt(0).toUpperCase() + toolId.slice(1)
}

// Executive formatting functions
function formatMinutes(minutes: number): string {
  if (minutes < 10) return `${minutes.toFixed(1)} min`
  return `${Math.round(minutes)} min`
}

function formatAssists(assists: number): string {
  return `${Math.round(assists)} assists`
}

function formatAssistsPer100Min(rate: number): string {
  return `${rate.toFixed(1)} assists/100min`
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`
}

function formatSessions(sessions: number): string {
  return `${Math.round(sessions)} sessions`
}

function formatDelta(deltaPct: number, vsLabel: string): string {
  if (deltaPct === 0) return ''
  const sign = deltaPct > 0 ? '+' : ''
  return ` (${sign}${deltaPct.toFixed(0)}% vs ${vsLabel})`
}

function getSourceClass(sourceText: string): string {
  const source = sourceText.toLowerCase()
  if (source === 'live') return 'bg-success-subtle text-success'
  if (source === 'sim') return 'bg-secondary-subtle text-secondary'
  if (source === 'hybrid') return 'bg-info-subtle text-info'
  return 'bg-secondary-subtle text-secondary'
}

function getConfidenceClass(conf: string): string {
  const confidence = conf.toLowerCase()
  if (confidence === 'high') return 'bg-success-subtle text-success'
  if (confidence === 'medium') return 'bg-warning-subtle text-warning'
  if (confidence === 'low') return 'bg-danger-subtle text-danger'
  return 'bg-secondary-subtle text-secondary'
}

// Development flag
const isDev = (import.meta.env as any)?.DEV || false

// Coverage row computed properties
const coverageSummary = computed(() => {
  const coverage = aiSignalsModel.value.coverageByIde || []
  const totalSessions = coverage.reduce((sum, ide) => sum + ide.sessions, 0)
  const totalMinutes = coverage.reduce((sum, ide) => sum + ide.codingMinutes, 0)
  
  if (totalSessions === 0) return 'No telemetry coverage'
  
  // Show top 3 IDEs by sessions for executive scannability
  const sortedBySessions = [...coverage].sort((a, b) => b.sessions - a.sessions).slice(0, 3)
  const topIdes = sortedBySessions.map(ide => {
    const label = getToolLabelLocal(ide.toolId)
    return `${label}: ${formatSessions(ide.sessions)}`
  })
  
  const summary = topIdes.join(' • ')
  const additionalCount = coverage.length - topIdes.length
  return additionalCount > 0 ? `${summary} +${additionalCount} more` : summary
})

const coverageStatus = computed(() => {
  const coverage = aiSignalsModel.value.coverageByIde || []
  const hasData = coverage.length > 0 && coverage.some(ide => ide.sessions > 0)
  return hasData ? 'LIVE' : 'INCOMPLETE'
})

const coverageStatusClass = computed(() => {
  const status = coverageStatus.value
  return status === 'LIVE' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'
})

const coverageWhatHappening = computed(() => {
  const coverage = aiSignalsModel.value.coverageByIde || []
  const totalSessions = coverage.reduce((sum, ide) => sum + ide.sessions, 0)
  const totalMinutes = coverage.reduce((sum, ide) => sum + ide.codingMinutes, 0)
  const toolsWithData = coverage.filter(ide => ide.sessions > 0).map(ide => getToolLabelLocal(ide.toolId))
  
  // 🔥 GUARD: Don't show "No IDE telemetry detected" until we've attempted loading
  if (!hasAttemptedLoad.value) {
    return 'Loading AI usage signals...'
  }
  
  if (totalSessions === 0) {
    return 'No IDE telemetry detected. Enable IDE telemetry to see AI usage signals.'
  }
  
  return `${toolsWithData.join(', ')} have ${totalSessions} sessions with ${totalMinutes} active minutes of telemetry.`
})

const coverageEvidence = computed(() => {
  return aiSignalsModel.value.coverageByIde.map(ide => ({
    label: getToolLabelLocal(ide.toolId),
    value: `${formatSessions(ide.sessions)} • ${formatMinutes(ide.codingMinutes)}${ide.acceptedAssists > 0 ? ` • ${formatAssists(ide.acceptedAssists)}` : ''}`
  }))
})

const coverageRecommendation = computed(() => {
  const coverage = aiSignalsModel.value.coverageByIde || []
  const toolsWithData = coverage.filter(ide => ide.sessions > 0)
  const toolsWithoutData = coverage.filter(ide => ide.sessions === 0)
  
  if (toolsWithData.length === 0) {
    return 'Enable IDE telemetry for at least one IDE to see AI usage signals.'
  }
  
  if (toolsWithoutData.length > 0) {
    const missingTools = toolsWithoutData.map(ide => getToolLabelLocal(ide.toolId)).join(', ')
    return `Enable telemetry for ${missingTools} to analyze AI usage patterns.`
  }
  
  return 'Telemetry coverage is sufficient for AI usage signals analysis.'
})

// Assist rate row computed properties
const assistRateAvailable = computed(() => aiSignalsModel.value.assistRate !== null)

const assistRateTitle = computed(() => {
  const assistRate = aiSignalsModel.value.assistRate
  if (!assistRate) return 'AI assist rate by IDE'
  const winnerLabel = getToolLabelLocal(assistRate.winnerToolId)
  return `${winnerLabel} shows highest AI assist rate`
})

const assistRateValue = computed(() => {
  const assistRate = aiSignalsModel.value.assistRate
  if (!assistRate) return 'Insufficient coverage'
  return formatAssistsPer100Min(assistRate.valuePer100Min)
})

const assistRateDelta = computed(() => {
  const assistRate = aiSignalsModel.value.assistRate
  if (!assistRate || !assistRate.runnerUpToolId) return ''
  const runnerUpLabel = getToolLabelLocal(assistRate.runnerUpToolId)
  return formatDelta(assistRate.deltaPctVsRunnerUp, runnerUpLabel)
})

const assistRateWhatHappening = computed(() => {
  const assistRate = aiSignalsModel.value.assistRate
  if (!assistRate) return 'No AI assist rate data available.'
  
  const winnerLabel = getToolLabelLocal(assistRate.winnerToolId)
  const rate = assistRate.valuePer100Min.toFixed(1)
  const sessions = assistRate.sessionsTotal
  
  let text = `${winnerLabel} has the highest AI assist rate at ${rate} assists/100min`
  
  if (assistRate.runnerUpToolId) {
    const runnerUpLabel = getToolLabelLocal(assistRate.runnerUpToolId)
    const delta = assistRate.deltaPctVsRunnerUp.toFixed(0)
    text += `, ${delta}% higher than ${runnerUpLabel}`
  }
  
  text += `. Based on ${sessions} total sessions.`
  
  return text
})

const assistRateEvidence = computed(() => {
  const coverage = aiSignalsModel.value.coverageByIde || []
  return coverage.map(ide => {
    const rate = ide.codingMinutes > 0 ? (ide.acceptedAssists / ide.codingMinutes) * 100 : 0
    return {
      label: getToolLabelLocal(ide.toolId),
      value: `${formatAssistsPer100Min(rate)} • ${formatAssists(ide.acceptedAssists)} • ${formatMinutes(ide.codingMinutes)}`
    }
  })
})

const assistRateRecommendation = computed(() => {
  const assistRate = aiSignalsModel.value.assistRate
  if (!assistRate) return 'Connect IDE telemetry to surface assist rates.'
  
  if (assistRate.sessionsTotal < 50) {
    return 'Increase telemetry coverage to 50+ sessions before acting on AI assist rate insights.'
  }
  
  const winnerLabel = getToolLabelLocal(assistRate.winnerToolId)
  return `Document ${winnerLabel} workflow settings and AI configuration; trial in other IDEs; re-check in 2 weeks.`
})

// Acceptance share row computed properties
const acceptanceShareAvailable = computed(() => aiSignalsModel.value.acceptanceShare !== null)

const acceptanceShareTitle = computed(() => {
  const acceptance = aiSignalsModel.value.acceptanceShare
  if (!acceptance) return 'AI acceptance share by IDE'
  const winnerLabel = getToolLabelLocal(acceptance.winnerToolId)
  return `${winnerLabel} has highest AI acceptance (share)`
})

const acceptanceShareValue = computed(() => {
  const acceptance = aiSignalsModel.value.acceptanceShare
  if (!acceptance) return 'Insufficient coverage'
  const winnerLabel = getToolLabelLocal(acceptance.winnerToolId)
  return `${winnerLabel} ${formatPct(acceptance.winnerSharePct)}`
})

const acceptanceShareDelta = computed(() => {
  const acceptance = aiSignalsModel.value.acceptanceShare
  if (!acceptance || !acceptance.runnerUpToolId) return ''
  const runnerUpLabel = getToolLabelLocal(acceptance.runnerUpToolId)
  return formatDelta(acceptance.deltaPctPoints, runnerUpLabel)
})

const acceptanceShareWhatHappening = computed(() => {
  const acceptance = aiSignalsModel.value.acceptanceShare
  if (!acceptance) return 'No AI acceptance share data available.'
  
  const winnerLabel = getToolLabelLocal(acceptance.winnerToolId)
  const share = acceptance.winnerSharePct.toFixed(0)
  const assists = acceptance.winnerSharePct * (aiSignalsModel.value.coverageByIde.reduce((sum, ide) => sum + ide.acceptedAssists, 0)) / 100
  
  let text = `${winnerLabel} accounts for ${share}% of all accepted AI assists`
  
  if (acceptance.runnerUpToolId) {
    const runnerUpLabel = getToolLabelLocal(acceptance.runnerUpToolId)
    const delta = acceptance.deltaPctPoints.toFixed(0)
    text += `, ${delta}% more than ${runnerUpLabel}`
  }
  
  text += `. Total of ${assists.toFixed(0)} accepted assists attributed.`
  
  return text
})

const acceptanceShareEvidence = computed(() => {
  const coverage = aiSignalsModel.value.coverageByIde || []
  const totalAssists = coverage.reduce((sum, ide) => sum + ide.acceptedAssists, 0)
  
  return coverage.map(ide => {
    const share = totalAssists > 0 ? (ide.acceptedAssists / totalAssists) * 100 : 0
    return {
      label: getToolLabelLocal(ide.toolId),
      value: `${formatPct(share)} • ${formatAssists(ide.acceptedAssists)}`
    }
  })
})

const acceptanceShareRecommendation = computed(() => {
  const acceptance = aiSignalsModel.value.acceptanceShare
  if (!acceptance) return 'Collect IDE telemetry to compute acceptance shares.'
  
  const winnerLabel = getToolLabelLocal(acceptance.winnerToolId)
  return `Review ${winnerLabel} AI acceptance patterns and verify assist attribution accuracy.`
})

// Trend row computed properties (hidden when no data)
const trendAvailable = computed(() => false) // No trend data available

const trendValue = computed(() => 'No trend data')

const trendWhatHappening = computed(() => 'Trend analysis requires time-series data which is not currently available.')

const trendEvidence = computed(() => ({
  current: 'Not available',
  prior: 'Not available'
}))

const trendRecommendation = computed(() => 'Enable time-series data collection to analyze AI usage trends over time.')

// Review presence row computed properties
const reviewPresenceValue = computed(() => 'AI review signal unavailable')

const reviewPresenceStatus = computed(() => 'INCOMPLETE')

const reviewPresenceStatusClass = computed(() => 'bg-warning-subtle text-warning')

const reviewPresenceSeverityClass = computed(() => 'severity-warning')

const reviewPresenceWhatHappening = computed(() => 'AI review signal is not yet available. This metric requires review-level instrumentation to detect AI-assisted code in PR reviews.')

const reviewPresenceEvidence = computed(() => ({
  status: 'AI review signal unavailable',
  coverage: 'No coverage data available'
}))

const reviewPresenceRecommendation = computed(() => 'Implement review instrumentation to track AI-assisted code presence in collaborative review stages.')

// DORA helper functions
function getDora(metricName: string) {
  const metric = (props.doraMetrics || []).find(m => 
    m.name?.toLowerCase().includes(metricName.toLowerCase()) || 
    m.metricId?.toLowerCase().includes(metricName.toLowerCase()) ||
    // Handle specific mappings for mock data
    (metricName.toLowerCase() === 'lead time' && m.name?.toLowerCase().includes('lead time for changes')) ||
    (metricName.toLowerCase() === 'deploy frequency' && m.name?.toLowerCase().includes('deployment frequency')) ||
    (metricName.toLowerCase() === 'change failure rate' && m.name?.toLowerCase().includes('change failure rate')) ||
    (metricName.toLowerCase() === 'mean time to recovery' && m.name?.toLowerCase().includes('mean time to recovery'))
  )
  
  if (!metric) {
    return { 
      value: 'Insufficient data', 
      source: 'Unknown', 
      confidence: 'Unknown' 
    }
  }
  
  return {
    value: metric.value || metric.missingState || 'Insufficient data',
    source: metric.source || 'Unknown',
    confidence: (metric.confidence || 'Unknown').charAt(0).toUpperCase() + (metric.confidence || 'Unknown').slice(1).toLowerCase()
  }
}

// Format DORA values for display
function formatLeadTime(value: string): string {
  if (value === 'Insufficient data' || !value) return 'Insufficient data'
  // Convert to days if it's in hours
  const num = parseFloat(value)
  if (isNaN(num)) return value
  return num < 24 ? `${Math.round(num)}h` : `${(num / 24).toFixed(1)} days`
}

function formatDeployFrequency(value: string): string {
  if (value === 'Insufficient data' || !value) return 'Insufficient data'
  const num = parseFloat(value)
  if (isNaN(num)) return value
  return `${num.toFixed(1)}/week`
}

function formatCFR(value: string): string {
  if (value === 'Insufficient data' || !value) return 'Insufficient data'
  const num = parseFloat(value)
  if (isNaN(num)) return value
  return `${num.toFixed(1)}%`
}

function formatMTTR(value: string): string {
  if (value === 'Insufficient data' || !value || value === 'insufficient_history') return 'Insufficient history'
  const num = parseFloat(value)
  if (isNaN(num)) return value
  return num < 24 ? `${Math.round(num)}h` : `${(num / 24).toFixed(1)}d`
}

// Delivery Cadence Signal (Lead Time + Deploy Frequency)
const deliveryCadenceData = computed(() => {
  const leadTime = getDora('lead time')
  const deployFreq = getDora('deploy frequency')
  
  const leadTimeFormatted = formatLeadTime(leadTime.value)
  const deployFreqFormatted = formatDeployFrequency(deployFreq.value)
  
  // Determine cadence status - require Medium+ confidence for both metrics
  let status = 'unclear'
  const hasGoodConfidence = (leadTime.confidence === 'High' || leadTime.confidence === 'Medium') &&
                          (deployFreq.confidence === 'High' || deployFreq.confidence === 'Medium')
  const hasData = leadTime.value !== 'Insufficient data' && deployFreq.value !== 'Insufficient data'
  
  if (hasData && hasGoodConfidence) {
    const leadTimeNum = parseFloat(leadTime.value)
    const deployFreqNum = parseFloat(deployFreq.value)
    if (leadTimeNum > 7 || deployFreqNum < 1) status = 'slowed'
    else if (leadTimeNum < 3 && deployFreqNum > 3) status = 'fast'
    else status = 'stable'
  }
  
  return {
    status,
    leadTime: { ...leadTime, formatted: leadTimeFormatted },
    deployFreq: { ...deployFreq, formatted: deployFreqFormatted },
    hasData: hasData,
    hasGoodConfidence
  }
})

const deliveryCadenceTitle = computed(() => {
  const data = deliveryCadenceData.value
  return `Delivery cadence signal: ${data.status}`
})

const deliveryCadenceSubtitle = computed(() => {
  const data = deliveryCadenceData.value
  return `Lead time: ${data.leadTime.formatted} · Deploys: ${data.deployFreq.formatted} (context signal only)`
})

const deliveryCadenceValue = computed(() => {
  const data = deliveryCadenceData.value
  return `${data.leadTime.formatted} · ${data.deployFreq.formatted}`
})

const deliveryCadenceStatus = computed(() => {
  const data = deliveryCadenceData.value
  return data.hasGoodConfidence && data.hasData ? 'LIVE' : 'INFO'
})

const deliveryCadenceStatusClass = computed(() => {
  const status = deliveryCadenceStatus.value
  return status === 'LIVE' ? 'bg-success-subtle text-success' : 'bg-info-subtle text-info'
})

const deliveryCadenceWhatHappening = computed(() => {
  const data = deliveryCadenceData.value
  return `Lead time for changes is ${data.leadTime.formatted} and deployment frequency is ${data.deployFreq.formatted} for the current window. These are delivery context signals and are not attributed to AI usage.`
})

const deliveryCadenceWhyItMatters = computed(() => {
  return 'Use this to decide whether to investigate adoption/rollout timing, staffing changes, or process constraints.'
})

const deliveryCadenceEvidence = computed(() => {
  const data = deliveryCadenceData.value
  return [
    { label: 'Lead Time for Changes', value: `${data.leadTime.formatted} (${data.leadTime.source}, ${data.leadTime.confidence})` },
    { label: 'Deployment Frequency', value: `${data.deployFreq.formatted} (${data.deployFreq.source}, ${data.deployFreq.confidence})` }
  ]
})

const deliveryCadenceRecommendation = computed(() => {
  const data = deliveryCadenceData.value
  const hasLowConfidence = data.leadTime.confidence === 'Low' || data.deployFreq.confidence === 'Low'
  
  if (data.status === 'slowed') {
    return `Next sprint: review PR batching, queue depth, and release gate friction; verify CI deploy events are fully instrumented.${hasLowConfidence ? ' Consider improving data confidence.' : ''}`
  } else {
    return `Next sprint: keep cadence stable; add lightweight change review to detect drift.${hasLowConfidence ? ' Instrument deployment events to raise confidence.' : ''}`
  }
})

// Release Risk Signal (CFR + MTTR)
const releaseRiskData = computed(() => {
  const cfr = getDora('change failure rate')
  const mttr = getDora('mttr')
  
  const cfrFormatted = formatCFR(cfr.value)
  const mttrFormatted = formatMTTR(mttr.value)
  
  // Determine risk status - CFR drives the label, MTTR is supporting context
  let status = 'unclear'
  const hasGoodConfidence = cfr.confidence === 'High' || cfr.confidence === 'Medium'
  const hasData = cfr.value !== 'Insufficient data'
  
  if (hasData && hasGoodConfidence) {
    const cfrNum = parseFloat(cfr.value)
    if (cfrNum >= 15) status = 'elevated'
    else status = 'stable'
  }
  
  return {
    status,
    cfr: { ...cfr, formatted: cfrFormatted },
    mttr: { ...mttr, formatted: mttrFormatted },
    hasData: hasData,
    hasGoodConfidence
  }
})

const releaseRiskTitle = computed(() => {
  const data = releaseRiskData.value
  return `Release risk signal: ${data.status}`
})

const releaseRiskSubtitle = computed(() => {
  const data = releaseRiskData.value
  const mttrNote = data.mttr.value === 'Insufficient history' ? ' (instrumentation gap)' : ''
  return `Deployment failure rate: ${data.cfr.formatted} · Mean time to recovery: ${data.mttr.formatted}${mttrNote} (confidence: ${data.cfr.confidence})`
})

const releaseRiskValue = computed(() => {
  const data = releaseRiskData.value
  return data.cfr.formatted
})

const releaseRiskStatus = computed(() => {
  const data = releaseRiskData.value
  const cfrNum = parseFloat(data.cfr.value)
  const hasGoodMTTR = data.mttr.value !== 'Insufficient history'
  
  // WARNING only for CFR >= 15% with Medium+ confidence
  if (cfrNum >= 15 && data.hasGoodConfidence) return 'WARNING'
  // INFO if CFR confidence is Low/Unknown or MTTR insufficient
  if (!data.hasGoodConfidence || !hasGoodMTTR) return 'INFO'
  return 'LIVE'
})

const releaseRiskStatusClass = computed(() => {
  const status = releaseRiskStatus.value
  if (status === 'WARNING') return 'bg-warning-subtle text-warning'
  if (status === 'LIVE') return 'bg-success-subtle text-success'
  return 'bg-info-subtle text-info'
})

const releaseRiskSeverityClass = computed(() => {
  const status = releaseRiskStatus.value
  if (status === 'WARNING') return 'severity-warning'
  if (status === 'LIVE') return 'severity-highlight'
  return 'severity-info'
})

const releaseRiskWhatHappening = computed(() => {
  const data = releaseRiskData.value
  return `Change Failure Rate is ${data.cfr.formatted} (source: ${data.cfr.source}, confidence: ${data.cfr.confidence}). MTTR is ${data.mttr.formatted} (source: ${data.mttr.source}, confidence: ${data.mttr.confidence}). These are delivery context signals only.`
})

const releaseRiskWhyItMatters = computed(() => {
  return 'Use this to prioritize incident linkage, rollback instrumentation, and release gating reviews.'
})

const releaseRiskEvidence = computed(() => {
  const data = releaseRiskData.value
  const evidence = [
    { label: 'Change Failure Rate', value: `${data.cfr.formatted} (${data.cfr.source}, ${data.cfr.confidence})` },
    { label: 'MTTR', value: `${data.mttr.formatted} (${data.mttr.source}, ${data.mttr.confidence})` }
  ]
  
  if (data.mttr.value === 'Insufficient history') {
    evidence.push({ label: 'Data Note', value: 'MTTR insufficient history - instrument incident linkage and rollback markers' })
  }
  
  return evidence
})

const releaseRiskRecommendation = computed(() => {
  const data = releaseRiskData.value
  const cfrNum = parseFloat(data.cfr.value)
  const hasLowConfidence = data.cfr.confidence === 'Low' || data.mttr.confidence === 'Low'
  
  if (cfrNum > 15 && (data.cfr.confidence === 'High' || data.cfr.confidence === 'Medium')) {
    return `Next sprint: tighten release checks + ensure incident/rollback linkage; sample recent failures for common patterns.${hasLowConfidence ? ' Improve failure detection instrumentation.' : ''}`
  } else if (data.mttr.value === 'Insufficient history') {
    return `Next sprint: instrument incident linkage + rollback markers to raise confidence.`
  } else {
    return `Next sprint: maintain current release quality; continue monitoring failure patterns.${hasLowConfidence ? ' Enhance incident tracking.' : ''}`
  }
})

// DORA context computed property (kept for debug)
const doraContext = computed(() => aiSignalsModel.value.doraContext)

// Dev-only debug logging
if ((import.meta.env as any)?.DEV) {
  const debugKeys = computed(() => aiSignalsModel.value.debugKeys)
  if (import.meta.env.DEV && import.meta.env.VITE_PI_DEBUG === 'true') console.log('[AI Usage Signals Debug]', debugKeys.value)
}
</script>

<style scoped>
.ai-usage-section { font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial }

/* Match Performance Insights stage icon wrapper styling exactly */
.stage-icon-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ai-usage-panel { border-radius: 10px }
.ai-usage-panel-header { padding: 0.5rem 0.8rem }
.ai-usage-panel-body { padding: 0.5rem 0.8rem }
.delivery-inline { padding: 0.6rem }

/* PI Strip Styles - matching InsightStrip.vue exactly */
.insight-strip { display: flex; flex-direction: column; gap: 0.25rem }
.insight-strip-row { background: #fff; border: 1px solid rgba(16,24,40,0.06); border-radius: 0.5rem; margin-bottom: 0.25rem }
.insight-strip-row:last-child { margin-bottom: 0 }
.insight-strip-row-collapsed { border-radius: 0.375rem; transition: box-shadow 120ms ease; padding: 0.5rem 0.75rem; min-height: 2.5rem; cursor: pointer }
.insight-strip-row-collapsed:hover { box-shadow: 0 8px 22px rgba(2,6,23,0.06) }
.insight-strip-row-expanded { padding: 0 0.75rem 0.75rem 0.75rem }

.insight-strip-severity { width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center; border-radius: 0.25rem; font-size: 0.75rem }
.insight-strip-severity.severity-info { background: #0dcaf0; color: #212529 }
.insight-strip-severity.severity-highlight { background: #198754; color: white }
.insight-strip-severity.severity-warning { background: #ffc107; color: #212529 }
.insight-strip-severity.severity-opportunity { background: #6f42c1; color: white }

.insight-strip-title { font-size: 0.875rem; font-weight: 500 }
.insight-strip-evidence { text-align: right; font-size: 0.8125rem }
.insight-strip-evidence-item { display: flex; align-items: center; gap: 0.25rem }
.insight-strip-evidence-label { color: #6c757d; font-size: 0.75rem }
.insight-strip-evidence-value { font-weight: 600 }

.insight-strip-scope-pill { font-size: 0.65rem; padding: 0.2rem 0.35rem }
.insight-strip-chevron { color: rgba(0,0,0,0.35); font-size: 0.75rem }

.badge-sm { padding: 0.2rem 0.35rem; font-size: 0.65rem; border-radius: 6px }

/* Expanded Panel Styles - matching InsightExpandedPanel.vue exactly */
.insight-expanded-panel { background: #f8f9fa; border-radius: 0.375rem; padding: 1rem; margin-top: 0.5rem }
.insight-expanded-panel--strip { background: #fafbfc; border: 1px solid rgba(16,24,40,0.04) }
.insight-expanded-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem }
.insight-expanded-title { font-size: 0.875rem; font-weight: 600; margin: 0 }
.insight-expanded-badges { display: flex; gap: 0.5rem }
.insight-expanded-badge { font-size: 0.625rem; padding: 0.25rem 0.5rem; border-radius: 0.25rem }
.insight-expanded-badge--scope { background: #e9ecef; color: #495057 }
.insight-expanded-badge--source { background: #d1ecf1; color: #0c5460 }
.insight-expanded-badge--severity { background: #d1ecf1; color: #0c5460 }

.insight-expanded-section { margin-bottom: 1rem }
.insight-expanded-section:last-child { margin-bottom: 0 }
.insight-expanded-section-label { font-size: 0.75rem; font-weight: 600; color: #6c757d; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem }
.insight-expanded-section-content { font-size: 0.8125rem; line-height: 1.5 }
.insight-expanded-description { font-weight: 500 }

.insight-expanded-evidence { display: flex; flex-direction: column; gap: 0.5rem }
.insight-expanded-evidence-row { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; background: #fff; border-radius: 0.25rem; border: 1px solid rgba(16,24,40,0.04) }
.insight-expanded-evidence-label { font-weight: 500; color: #495057 }
.insight-expanded-evidence-value { font-weight: 600; color: #212529 }
.ai-rows-list { display: flex; flex-direction: column }
.ai-usage-section .stage-icon-wrapper { width: 40px; height: 40px; display:flex; align-items:center; justify-content:center; border-radius:8px }
.ai-cards-grid AIUsageSignalCard, .dora-cards-grid DoraMetricCard { min-width: 220px }
.delivery-inline { border: 1px solid rgba(13,110,253,0.06) }
/* Modernized unified panel styling */
.ai-usage-panel { background: #fff; box-shadow: 0 1px 2px rgba(16,24,40,0.04); border: 1px solid rgba(16,24,40,0.04); }
.ai-usage-panel-header { background: linear-gradient(180deg, rgba(13,110,253,0.02), rgba(13,110,253,0.01)); }
.ai-usage-panel-body { padding: 0.5rem 1rem 1rem 1rem; }
.ai-rows-list .insight-strip-row-collapsed { padding: 0.65rem 0.6rem; }
.delivery-inline-bg { background: linear-gradient(180deg, rgba(13,110,253,0.02), rgba(13,110,253,0.01)); border: 1px solid rgba(13,110,253,0.06); }
.insight-strip-evidence { min-width: 110px; text-align: right }
.insight-strip-title { padding-right: 0.5rem }
.insight-strip-scope-pill { margin-left: 0.5rem }

/* Executive summary card */
.exec-summary-card {
  background: linear-gradient(180deg, rgba(255,255,255,1), rgba(250,250,250,1));
  border-radius: 8px;
  padding: 0.5rem;
  min-width: 220px;
  box-shadow: 0 6px 18px rgba(2,6,23,0.03);
}
.exec-summary-card h6 { margin: 0 0 0.25rem 0; font-size: 0.9rem }
.exec-summary-card ul { margin: 0; padding-left: 0.95rem }
.exec-summary-card li { margin-bottom: 0.25rem; font-size: 0.88rem }

/* Delivery context miniature */
.delivery-mini { background: rgba(13,110,253,0.03); border-radius: 8px; padding: 0.4rem; min-width: 160px }
.delivery-mini h6 { margin: 0 0 0.2rem 0; font-size: 0.85rem }
.delivery-mini .muted { font-size: 0.78rem; color: #6c757d }

/* layout for the merged header area */
.panel-merged-top { display:flex; gap: 0.75rem; align-items:flex-start; margin-bottom: 0.4rem }
@media (max-width: 880px) { .panel-merged-top { flex-direction: column } }

/* Compact presentation styles for AI Usage Signals */
.ai-usage-panel { background: transparent; border: none; box-shadow: none }
.ai-usage-panel-body { padding: 0 }
.compact-rows { display:flex; flex-direction:column; gap: 0.35rem }
.compact-row { padding: 0.45rem; background: #fff; border: 1px solid rgba(16,24,40,0.04); border-radius: 8px; align-items:center }
.compact-title { font-weight:600; font-size:0.92rem }
.compact-sub { font-size:0.78rem; color: #6c757d }
.compact-right { display:flex; align-items:center; gap:0.5rem }
.compact-value { font-weight:700; font-size:0.95rem }
.delivery-context { background: linear-gradient(180deg, rgba(255,255,255,1), rgba(248,249,250,1)); border: 1px solid rgba(13,110,253,0.06); font-size:0.82rem }
.delivery-context div { padding: 2px 0 }
.badge-sm { padding: 0.25rem 0.45rem; font-size: 0.68rem; border-radius: 6px }

@media (max-width: 880px) {
  .compact-row { padding: 0.4rem }
  .compact-sub { display:block }
}

/* Mobile-first responsive improvements */
@media (max-width: 768px) {
  /* Header adjustments */
  .cicd-section-header {
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 0.75rem !important;
  }
  
  .cicd-section-header .d-flex {
    flex-wrap: wrap;
  }
  
  /* Stage icon smaller on mobile */
  .stage-icon-wrapper {
    width: 36px !important;
    height: 36px !important;
    font-size: 0.875rem;
  }
  
  /* Title adjustments */
  .cicd-section-header h5 {
    font-size: 1rem !important;
  }
  
  .cicd-section-header small {
    font-size: 0.75rem !important;
  }
  
  /* Badge adjustments */
  .badge-sm {
    font-size: 0.6rem !important;
    padding: 0.15rem 0.3rem !important;
  }
  
  /* Insight strip rows - mobile friendly */
  .insight-strip-row-collapsed {
    padding: 0.75rem !important;
    min-height: auto !important;
  }
  
  .insight-strip-row-collapsed .d-flex {
    flex-wrap: wrap;
    gap: 0.5rem !important;
  }
  
  /* Title and evidence stacking */
  .insight-strip-title {
    flex: 1 !important;
    min-width: 0 !important;
    padding-right: 0 !important;
  }
  
  .insight-strip-evidence {
    min-width: auto !important;
    text-align: left !important;
    flex: 1 !important;
  }
  
  /* Chevron positioning */
  .insight-strip-chevron {
    position: absolute;
    right: 0.75rem;
    top: 0.75rem;
  }
  
  /* Expanded panels */
  .insight-expanded-panel {
    padding: 0.75rem !important;
  }
  
  .insight-expanded-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
  
  .insight-expanded-badges {
    flex-wrap: wrap;
  }
  
  /* Evidence rows */
  .insight-expanded-evidence-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 0.5rem;
  }
  
  /* Compact rows */
  .compact-row {
    padding: 0.5rem !important;
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 0.5rem !important;
  }
  
  .compact-right {
    width: 100%;
    justify-content: space-between;
  }
  
  /* Panel layouts */
  .panel-merged-top {
    flex-direction: column !important;
    gap: 0.5rem !important;
  }
  
  /* Executive summary cards */
  .exec-summary-card {
    min-width: auto !important;
    width: 100%;
  }
  
  /* Delivery context */
  .delivery-mini {
    min-width: auto !important;
    width: 100%;
  }
}

/* Extra small mobile devices */
@media (max-width: 480px) {
  /* Even more compact headers */
  .cicd-section-header {
    padding: 0.5rem !important;
  }
  
  .stage-icon-wrapper {
    width: 32px !important;
    height: 32px !important;
    font-size: 0.75rem;
  }
  
  .cicd-section-header h5 {
    font-size: 0.9rem !important;
  }
  
  .cicd-section-header small {
    font-size: 0.7rem !important;
  }
  
  /* Insight strips */
  .insight-strip-row-collapsed {
    padding: 0.5rem !important;
  }
  
  .insight-strip-title {
    font-size: 0.8rem !important;
  }
  
  .insight-strip-title .text-muted {
    font-size: 0.7rem !important;
  }
  
  .insight-strip-evidence {
    font-size: 0.75rem !important;
  }
  
  /* Expanded content */
  .insight-expanded-panel {
    padding: 0.5rem !important;
  }
  
  .insight-expanded-title {
    font-size: 0.8rem !important;
  }
  
  .insight-expanded-section-content {
    font-size: 0.75rem !important;
  }
  
  /* Compact adjustments */
  .compact-title {
    font-size: 0.85rem !important;
  }
  
  .compact-sub {
    font-size: 0.75rem !important;
  }
  
  .compact-value {
    font-size: 0.85rem !important;
  }
  
  .delivery-context {
    font-size: 0.75rem !important;
  }
}

/* Landscape mobile adjustments */
@media (max-width: 768px) and (orientation: landscape) {
  .insight-strip-row-collapsed {
    min-height: 2rem !important;
  }
  
  .insight-expanded-panel {
    padding: 0.5rem !important;
  }
  
  .insight-expanded-section {
    margin-bottom: 0.5rem !important;
  }
}
</style>
