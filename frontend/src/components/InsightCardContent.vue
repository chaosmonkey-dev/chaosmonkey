<template>
  <div 
    class="insight-card insight-card--executive"
    :class="[
      getSeverityLayoutClass(getDisplaySeverity(insight)),
      getCategoryLayoutClass(),
      {
        'insight-card--high-severity': isHighSeverity,
        'insight-card--medium-severity': isMediumSeverity,
        'insight-card--low-severity': isLowSeverity,
        'insight-card--high-confidence': isHighConfidence,
        'insight-card--low-confidence': isLowConfidence
      }
    ]"
    :data-insight-id="insight.id || insight.metricId"
  >
    <div class="card-body insight-card__body-executive" :class="getSeverityBodyClass()">
      <!-- HIGH SEVERITY: Heavy, urgent, asymmetric layout -->
      <template v-if="isHighSeverity">
        <div class="insight-card__high-severity-header mb-2">
          <div class="d-flex align-items-start gap-2">
            <div class="severity-indicator insight-card__verdict-icon insight-card__verdict-icon--large" :class="getSeverityClass(getDisplaySeverity(insight))">
              <i :class="getSeverityIcon(getDisplaySeverity(insight))"></i>
            </div>
            <div class="flex-grow-1 min-w-0">
              <h5 class="insight-card__verdict-title insight-card__verdict-title--urgent mb-1">{{ getVerdictTitle() }}</h5>
              <div v-if="getVerdictTrend()" class="insight-card__verdict-trend insight-card__verdict-trend--urgent">
                <i :class="getTrendIcon(getVerdictTrend() || '')"></i>
                <span>{{ getVerdictTrend() }}</span>
              </div>
            </div>
            <span class="badge insight-card__verdict-badge insight-card__verdict-badge--urgent" :class="getSeverityBadgeClass(getDisplaySeverity(insight))">
              {{ getDisplaySeverityLabel(insight) }}
            </span>
          </div>
        </div>

        <!-- High severity: always show why line with emphasis -->
        <div v-if="insight.summary" class="insight-card__why-line insight-card__why-line--heavy mb-2">
          <p class="insight-card__why-text insight-card__why-text--urgent mb-0">{{ getWhySentence() }}</p>
        </div>

        <!-- High severity: expanded evidence density -->
        <div v-if="hasCompactEvidence()" class="insight-card__evidence-line insight-card__evidence-line--heavy mb-2">
          <div class="insight-card__evidence-compact insight-card__evidence-compact--dense">
            <i class="bi bi-database insight-card__evidence-icon insight-card__evidence-icon--prominent"></i>
            <span class="insight-card__evidence-text">{{ executiveEvidenceString || getCompactEvidence() }}</span>
            <MiniSparkline
              v-if="isTemporalTrend"
              :points="temporalSparklinePoints"
              :width="100"
              :height="28"
              :show-labels="false"
              line-color="#dc2626"
              class="ms-2"
            />
          </div>
        </div>

        <!-- High severity: operational tool breakdowns with downstream implications -->
        <div v-if="hasOperationalToolBreakdowns" class="insight-card__tool-narratives insight-card__tool-narratives--heavy mb-2">
          <div v-if="toolBreakdownNarratives.length === 2" class="tool-narrative-compact-comparison tool-narrative-compact-comparison--heavy">
            <div 
              v-for="(narrative, index) in toolBreakdownNarratives" 
              :key="narrative.tool"
              class="tool-narrative-item tool-narrative--compact"
              :class="{ 'tool-narrative--top': index === 0 }"
            >
              <div class="tool-narrative-header">
                <span class="tool-narrative-name">{{ getToolLabel(narrative.tool) }}</span>
                <span class="tool-narrative-value">{{ narrative.value }}</span>
              </div>
              <div class="tool-narrative-text">{{ narrative.narrative }}</div>
              <div v-if="narrative.operationalContext" class="tool-narrative-implication">
                <span class="tool-narrative-implication-label">{{ getOperationalImplicationLabel() }}:</span>
                {{ getDownstreamImplication(narrative, toolBreakdownNarratives) }}
              </div>
            </div>
          </div>
          <div v-else class="tool-narrative-vertical tool-narrative-vertical--heavy">
            <div 
              v-for="(narrative, index) in toolBreakdownNarratives.slice(0, 3)" 
              :key="narrative.tool"
              class="tool-narrative-item"
              :class="{ 'tool-narrative--top': index === 0 }"
            >
              <div class="tool-narrative-header">
                <span class="tool-narrative-name">{{ getToolLabel(narrative.tool) }}</span>
                <span class="tool-narrative-value">{{ narrative.value }}</span>
              </div>
              <div class="tool-narrative-text">{{ narrative.narrative }}</div>
              <div v-if="narrative.operationalContext" class="tool-narrative-implication">
                <span class="tool-narrative-implication-label">{{ getOperationalImplicationLabel() }}:</span>
                {{ getDownstreamImplication(narrative, toolBreakdownNarratives) }}
              </div>
            </div>
          </div>
        </div>

        <!-- High severity: prominent action with urgency (only for non-diagnostic cards) -->
        <div v-if="insight.recommendedAction && !isDiagnosticCard" class="insight-card__action-line insight-card__action-line--urgent mb-1">
          <div class="insight-card__action-executive insight-card__action-executive--heavy">
            <i class="bi bi-exclamation-triangle insight-card__action-icon insight-card__action-icon--urgent"></i>
            <span class="insight-card__action-text insight-card__action-text--urgent">{{ getPrimaryAction() }}</span>
          </div>
        </div>

        <!-- High severity: cross-system organizational consequence (only if meaningful) -->
        <div v-if="hasOperationalConsequence && crossSystemSynthesis" class="insight-card__organizational-consequence mb-2">
          <div class="insight-card__consequence-header">
            <i class="bi bi-diagram-3 insight-card__consequence-icon"></i>
            <span class="insight-card__consequence-label">Operational consequence</span>
          </div>
          <div class="insight-card__consequence-content">
            <div class="insight-card__consequence-metric">
              <span class="insight-card__consequence-metric-label">{{ crossSystemSynthesis.upstreamMetric }}</span>
              <i class="bi bi-arrow-right insight-card__consequence-arrow"></i>
              <span class="insight-card__consequence-metric-value">{{ crossSystemSynthesis.downstreamMetric }}</span>
            </div>
            <p class="insight-card__consequence-implication mb-0">{{ crossSystemSynthesis.operationalImplication }}</p>
            <p class="insight-card__consequence-organizational mb-0">{{ crossSystemSynthesis.organizationalConsequence }}</p>
          </div>
        </div>
      </template>

      <!-- MEDIUM SEVERITY: Standard layout -->
      <template v-else-if="isMediumSeverity">
        <div class="insight-card__verdict-line mb-2">
          <div class="d-flex align-items-center gap-2">
            <div class="severity-indicator insight-card__verdict-icon" :class="getSeverityClass(getDisplaySeverity(insight))">
              <i :class="getSeverityIcon(getDisplaySeverity(insight))"></i>
            </div>
            <div class="flex-grow-1 min-w-0">
              <h5 class="insight-card__verdict-title mb-0">{{ getVerdictTitle() }}</h5>
              <div v-if="getVerdictTrend()" class="insight-card__verdict-trend">
                <i :class="getTrendIcon(getVerdictTrend() || '')"></i>
                <span>{{ getVerdictTrend() }}</span>
              </div>
            </div>
            <span class="badge badge-sm insight-card__verdict-badge" :class="getSeverityBadgeClass(getDisplaySeverity(insight))">
              {{ getDisplaySeverityLabel(insight) }}
            </span>
          </div>
        </div>

        <div v-if="insight.summary" class="insight-card__why-line mb-2">
          <p class="insight-card__why-text mb-0">{{ getWhySentence() }}</p>
        </div>

        <div v-if="hasCompactEvidence()" class="insight-card__evidence-line mb-2">
          <div class="insight-card__evidence-compact">
            <i class="bi bi-database insight-card__evidence-icon"></i>
            <span class="insight-card__evidence-text">{{ executiveEvidenceString || getCompactEvidence() }}</span>
            <MiniSparkline
              v-if="isTemporalTrend"
              :points="temporalSparklinePoints"
              :width="100"
              :height="28"
              :show-labels="false"
              line-color="#2563eb"
              class="ms-2"
            />
          </div>
        </div>

        <!-- CR-X Slice 4: Standalone temporal sparkline for insights without compact evidence -->
        <div v-else-if="isTemporalTrend" class="insight-card__temporal-sparkline mb-2">
          <MiniSparkline
            :points="temporalSparklinePoints"
            :width="140"
            :height="32"
            :show-labels="true"
            line-color="#2563eb"
          />
        </div>

        <!-- CR-X Track E: Distribution bar for delivery outcome PIs -->
        <div v-else-if="isDistributionCard" class="insight-card__distribution mb-2">
          <DistributionBar :segments="distributionSegments" :aria-label="(insight as any).title" />
        </div>

        <div v-if="hasOperationalToolBreakdowns" class="insight-card__tool-narratives mb-2">
          <div v-if="toolBreakdownNarratives.length === 2" class="tool-narrative-compact-comparison">
            <div 
              v-for="(narrative, index) in toolBreakdownNarratives" 
              :key="narrative.tool"
              class="tool-narrative-item tool-narrative--compact"
              :class="{ 'tool-narrative--top': index === 0 }"
            >
              <div class="tool-narrative-header">
                <span class="tool-narrative-name">{{ getToolLabel(narrative.tool) }}</span>
                <span class="tool-narrative-value">{{ narrative.value }}</span>
              </div>
              <div class="tool-narrative-text">{{ narrative.narrative }}</div>
            </div>
          </div>
          <div v-else class="tool-narrative-vertical">
            <div 
              v-for="(narrative, index) in toolBreakdownNarratives.slice(0, 3)" 
              :key="narrative.tool"
              class="tool-narrative-item"
              :class="{ 'tool-narrative--top': index === 0 }"
            >
              <div class="tool-narrative-header">
                <span class="tool-narrative-name">{{ getToolLabel(narrative.tool) }}</span>
                <span class="tool-narrative-value">{{ narrative.value }}</span>
              </div>
              <div class="tool-narrative-text">{{ narrative.narrative }}</div>
            </div>
          </div>
        </div>

        <div v-if="insight.recommendedAction && !isDiagnosticCard" class="insight-card__action-line mb-2">
          <div class="insight-card__action-executive">
            <i class="bi bi-lightbulb insight-card__action-icon"></i>
            <span class="insight-card__action-text">{{ getPrimaryAction() }}</span>
          </div>
        </div>
      </template>

      <!-- LOW SEVERITY: Compressed, collapsed layout -->
      <template v-else>
        <div class="insight-card__low-severity-header mb-1">
          <div class="d-flex align-items-center gap-2">
            <div class="severity-indicator insight-card__verdict-icon insight-card__verdict-icon--subtle" :class="getSeverityClass(getDisplaySeverity(insight))">
              <i :class="getSeverityIcon(getDisplaySeverity(insight))"></i>
            </div>
            <div class="flex-grow-1 min-w-0">
              <h5 class="insight-card__verdict-title insight-card__verdict-title--subtle mb-0">{{ getVerdictTitle() }}</h5>
            </div>
            <span class="badge badge-sm insight-card__verdict-badge insight-card__verdict-badge--subtle" :class="getSeverityBadgeClass(getDisplaySeverity(insight))">
              {{ getDisplaySeverityLabel(insight) }}
            </span>
          </div>
        </div>

        <!-- Low severity: collapsed why line (single line, no paragraph) -->
        <div v-if="insight.summary" class="insight-card__why-line insight-card__why-line--collapsed mb-1">
          <span class="insight-card__why-text insight-card__why-text--subtle">{{ getWhySentence() }}</span>
        </div>

        <!-- Low severity: minimal evidence (icon only, no box) -->
        <div v-if="hasCompactEvidence()" class="insight-card__evidence-line insight-card__evidence-line--subtle mb-1">
          <i class="bi bi-database insight-card__evidence-icon insight-card__evidence-icon--subtle"></i>
          <span class="insight-card__evidence-text insight-card__evidence-text--subtle">{{ executiveEvidenceString || getCompactEvidence() }}</span>
        </div>

        <!-- CR-X Track E: Distribution bar for delivery outcome PIs (low severity) -->
        <div v-if="isDistributionCard" class="insight-card__distribution insight-card__distribution--subtle mb-1">
          <DistributionBar :segments="distributionSegments" :aria-label="(insight as any).title" />
        </div>

        <!-- Low severity: no tool breakdowns by default (too much noise for low severity) -->
        <!-- Only show if explicitly expanded -->

        <!-- Low severity: minimal action (inline, no box) - only for non-diagnostic cards -->
        <div v-if="insight.recommendedAction && !isDiagnosticCard" class="insight-card__action-line insight-card__action-line--subtle mb-0">
          <span class="insight-card__action-text insight-card__action-text--subtle">{{ getPrimaryAction() }}</span>
        </div>
      </template>
      
      <!-- "View Details" Progressive Disclosure -->
      <div v-if="hasExpandableContent()" class="insight-card__details-section">
        <button 
          @click="descriptionExpanded = true; actionExpanded = true"
          class="btn btn-link btn-sm p-0 text-primary insight-card__details-toggle"
          type="button"
        >
          <i class="bi bi-chevron-down me-1"></i>
          View Details
        </button>
      </div>
      
      <!-- Expanded Panel (Full Details) -->
      <div v-if="isExpanded" class="insight-card-expanded-panel">
        <InsightExpandedPanel :insight="insight" :variant="'card'" />
      </div>
      
      <!-- Fallback: Original Layout for Missing Fields -->
      <template v-if="!hasRequiredFields()">
        <!-- Original header as fallback -->
        <div class="d-flex align-items-center justify-content-between gap-3 mb-2 insight-card__header-compact">
          <div class="d-flex align-items-center gap-2 flex-grow-1 min-w-0">
            <div class="severity-indicator insight-card__header-icon" :class="getSeverityClass(getDisplaySeverity(insight))">
              <i :class="getSeverityIcon(getDisplaySeverity(insight))"></i>
            </div>
            <h5 class="card-title mb-0 fw-bold insight-card__header-title">{{ formatTeamPrefix(insight.entityId) }}{{ displayInsightTitle(insight) }}</h5>
          </div>
          <div class="d-flex align-items-center gap-2 flex-shrink-0">
            <span v-if="showContextTag" class="badge badge-sm insight-card__context-badge">
              Context
            </span>
            <span class="badge badge-sm insight-card__header-badge" :class="getSeverityBadgeClass(getDisplaySeverity(insight))">
              {{ getDisplaySeverityLabel(insight) }}
            </span>
          </div>
        </div>
        
        <!-- Original description and evidence -->
        <div v-if="!isExpanded" class="mb-2 insight-card__description-wrapper">
          <p 
            class="card-text text-muted small mb-0 insight-card__description" 
            :class="{ 
              'insight-card__description--clamped': !descriptionExpanded && !props.demoUx,
              'insight-card__description--expanded': descriptionExpanded || props.demoUx
            }"
          >
            {{ insight.summary }}
          </p>
          <button 
            v-if="!props.demoUx && ((insight.summary && insight.summary.trim().length > 0) || (insight.evidence && insight.evidence.length > 0) || insight.recommendedAction)"
            @click="descriptionExpanded = true; actionExpanded = true"
            class="btn btn-link btn-sm p-0 mt-1 text-primary insight-card__toggle"
            type="button"
          >
            View Details
          </button>
        </div>
        
        <!-- Original evidence grid -->
        <div v-if="!isExpanded && normalizedEvidence && normalizedEvidence.length > 0" class="evidence-section-compact mb-2">
          <div class="evidence-grid-compact">
            <div v-for="(ev, index) in primaryEvidence" :key="index" class="evidence-item-compact">
              <small class="evidence-label-compact">{{ ev.label }}</small>
              <strong class="evidence-value-compact">{{ formatEvidenceValueTyped(ev.label, ev.value, props.insight.metricId) }}</strong>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import type { Insight, InsightSeverity, InsightScope } from '../types/insights'
import { getToolLabel } from '../lib/insights/labels'
import { formatTeamPrefix } from '../ui/insights/format'
import InsightExpandedPanel from './InsightExpandedPanel.vue'
import MiniSparkline from './performance/MiniSparkline.vue'
import type { SparklinePoint } from './performance/MiniSparkline.vue'
import DistributionBar from './performance/DistributionBar.vue'
import type { DistributionSegment } from './performance/DistributionBar.vue'
import { shouldShowContextTag } from '../lib/insights/ui/insightPresentation'
import { generateToolBreakdownNarratives, generateEvidenceDensity, formatEvidenceDensityCompact, formatConfidenceWithLabel, type ToolBreakdownNarrative, type EvidenceDensity, type OperationalNarrativeConfig } from '../lib/insights/v2/operationalNarrativeGenerator'
import { computeCodingToDeliverySynthesis, computeAIToReviewSynthesis, computeReworkToFailureSynthesis, computeReviewToDeploymentSynthesis, type CrossSystemSynthesis, classifyInsightCategory, type InsightCategory, type CategoryClassification } from '../lib/insights/v2/computeV2PerformanceInsights'

interface Props {
  insight: Insight
  compact?: boolean
  hideAction?: boolean
  hideFooter?: boolean
  demoUx?: boolean
  allStageInsights?: any[] // PerformanceInsight[] from parent (original format)
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
  hideAction: false,
  hideFooter: false,
  demoUx: false,
  allStageInsights: () => []
})

// Compact layout state
const descriptionExpanded = ref(false)
const isExpanded = computed(() => descriptionExpanded.value || actionExpanded.value)

// CR-X Slice 4: Temporal sparkline for insights with presentationKind === 'temporal_trend'
const temporalSparklinePoints = computed<SparklinePoint[]>(() => {
  const raw = props.insight as any
  if (raw.presentationKind !== 'temporal_trend') return []
  // CR-X P0-C: use generator-provided trendData when available. It binds
  // period + dominant workflow + share, so the sparkline matches the
  // START/FIRST and END/LATEST evidence cells. Fallback to breakdownByTool
  // only for older generators that have not emitted trendData.
  if (Array.isArray(raw.trendData) && raw.trendData.length >= 2) {
    return raw.trendData.map((p: any) => ({
      value: typeof p?.value === 'number' ? p.value : 0,
      label: typeof p?.label === 'string' ? p.label : String(p?.label ?? ''),
    }))
  }
  // Fallback: breakdownByTool keyed by month/period
  const breakdown = raw.breakdownByTool
  if (!breakdown || typeof breakdown !== 'object') return []
  const entries = Object.entries(breakdown).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length < 2) return []
  return entries.map(([key, data]: [string, any]) => ({
    value: typeof data?.value === 'number' ? data.value : 0,
    label: key,
  }))
})
const isTemporalTrend = computed(() => temporalSparklinePoints.value.length >= 2)

// CR-X Track E: Distribution visualization for delivery outcome PIs.
// Renders a success/failure (or failure-concentration) bar from outcomeComposition.
const distributionSegments = computed<DistributionSegment[]>(() => {
  const raw = props.insight as any
  const kind = raw.presentationKind
  const comp = raw.outcomeComposition
  if (!comp || typeof comp !== 'object') return []
  if (kind === 'success_failure_distribution') {
    const success = Number(comp.success) || 0
    const failed = Number(comp.failed) || 0
    if (success + failed <= 0) return []
    return [
      { label: 'Successful', value: success },
      { label: 'Failed', value: failed },
    ]
  }
  if (kind === 'failure_concentration') {
    const prodFailed = Number(comp.productionFailed) || 0
    const rollbackCount = Number(comp.rollbackCount) || 0
    const failed = Number(comp.failed) || 0
    const otherFailed = Math.max(0, failed - prodFailed)
    if (failed <= 0) return []
    return [
      { label: 'Production failures', value: prodFailed },
      { label: 'Other failures', value: otherFailed },
      { label: 'Rollbacks', value: rollbackCount },
    ]
  }
  return []
})
const isDistributionCard = computed(() => distributionSegments.value.length > 0)

// Debug logging for "View Details" button visibility (guarded by VITE_PI_DEBUG)
if ((import.meta as any).env?.VITE_PI_DEBUG === '1') {
  watchEffect(() => {
    const hasSummary = props.insight.summary && props.insight.summary.trim().length > 0
    const hasEvidence = props.insight.evidence && props.insight.evidence.length > 0
    const hasAction = !!props.insight.recommendedAction
    const shouldShow = !props.demoUx && (hasSummary || hasEvidence || hasAction)
    
    console.log(`[PI_DEBUG][VIEW_DETAILS_BUTTON][${props.insight.id}]`, {
      demoUx: props.demoUx,
      hasSummary,
      summaryLength: props.insight.summary?.length || 0,
      hasEvidence,
      evidenceCount: props.insight.evidence?.length || 0,
      hasAction,
      shouldShow
    })
  })
}

// Convert Insight back to PerformanceInsight format for context tag checking
const showContextTag = computed(() => {
  if (!props.allStageInsights || props.allStageInsights.length === 0) {
    return false
  }
  try {
    // Find the matching PerformanceInsight by ID (allStageInsights should be PerformanceInsight[])
    const matchingInsight = props.allStageInsights.find((item: any) => item.id === props.insight.id)
    if (!matchingInsight) {
      // Fallback: create minimal PerformanceInsight from Insight
      const insightAsPerf: any = {
        id: props.insight.id,
        title: props.insight.title,
        description: props.insight.summary || props.insight.title,
        severity: props.insight.severity,
        tags: props.insight.tags || [],
        related: {
          tools: props.insight.entityId ? [props.insight.entityId] : [],
          teams: [],
          repos: []
        },
        evidence: props.insight.evidence || [],
        recommendations: props.insight.recommendedAction ? [{ text: props.insight.recommendedAction }] : [],
        source: props.insight.dataSource === 'Real' ? 'github' : props.insight.dataSource === 'Simulated' ? 'simulated' : 'mixed',
        metricId: props.insight.metricId,
        toolScope: props.insight.scope === 'tool' ? 'single-ide' : 'org'
      }
      return shouldShowContextTag(insightAsPerf, props.allStageInsights as PerformanceInsight[])
    }
    return shouldShowContextTag(matchingInsight as PerformanceInsight, props.allStageInsights as PerformanceInsight[])
  } catch (error) {
    console.warn('[InsightCardContent] Error checking context tag:', error)
    return false
  }
})
const actionExpanded = ref(false)

// PHASE 4 DIAGNOSTIC: Log metrics for all insights
watchEffect(() => {
  const tool = props.insight.tags?.find(t => ['cursor', 'vscode', 'jetbrains', 'windsurf', 'sublime', 'vim'].includes(t.toLowerCase()))
  console.log('[PI_CARD_METRICS]', {
    id: props.insight.id,
    title: props.insight.title,
    tool: tool,
    dataSource: props.insight.dataSource,
    tags: props.insight.tags,
    evidence: props.insight.evidence
  })
})

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

function getSeverityBadgeClass(severity: InsightSeverity): string {
  const classes: Record<InsightSeverity, string> = {
    'critical': 'bg-danger text-white',
    'high': 'bg-warning text-dark',
    'moderate': 'bg-info text-white',
    'watchlist': 'bg-secondary text-white',
    'risk': 'bg-danger text-white',
    'lowlight': 'bg-warning text-dark',
    'opportunity': 'bg-primary text-white',
    'highlight': 'bg-success text-white',
    'info': 'bg-info text-white',
    'warning': 'bg-warning text-dark'
  }
  return classes[severity] || 'bg-secondary text-white'
}

function getSeverityBorderClass(severity: InsightSeverity): string {
  const classes: Record<InsightSeverity, string> = {
    'critical': 'border-danger border-start border-3',
    'high': 'border-warning border-start border-3',
    'moderate': 'border-info border-start border-3',
    'watchlist': 'border-secondary border-start border-3',
    'risk': 'border-danger border-start border-3',
    'lowlight': 'border-warning border-start border-3',
    'opportunity': 'border-primary border-start border-3',
    'highlight': 'border-success border-start border-3',
    'info': 'border-info border-start border-3',
    'warning': 'border-warning border-start border-3'
  }
  return classes[severity] || 'border-secondary border-start border-3'
}

function getScopeLabel(scope: InsightScope): string {
  const labels = {
    'org': 'Organization',
    'team': 'Team',
    'dev': 'Developer',
    'tool': 'Tool'
  }
  return labels[scope] || scope
}

function getEntityLabel(entityId: string, scope: InsightScope): string {
  if (scope === 'tool') {
    return getToolLabel(entityId)
  }
  
  return entityId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatDataSource(dataSource?: string): string {
  if (!dataSource) return 'Unknown'
  
  const formatted: Record<string, string> = {
    'real': 'Real',
    'mixed': 'Mixed',
    'sim': 'Sim',
    'unknown': 'Unknown',
    'placeholder': 'Placeholder'
  }
  
  return formatted[dataSource.toLowerCase()] || dataSource.charAt(0).toUpperCase() + dataSource.slice(1)
}

/**
 * Normalize evidence array by filtering out empty/null/undefined values and cleaning strings
 * @param evidence - Array of evidence items (may be undefined/null)
 * @returns Filtered and cleaned evidence array
 */
function normalizeEvidence(evidence?: Array<{ label: string; value?: number | string }>): Array<{ label: string; value: number | string }> {
  if (!evidence || !Array.isArray(evidence)) {
    return []
  }
  
  return evidence
    .filter(ev => {
      // Filter out items with null/undefined/empty values
      if (ev.value === null || ev.value === undefined) {
        return false
      }
      
      // Filter out empty strings
      if (typeof ev.value === 'string' && ev.value.trim() === '') {
        return false
      }
      
      // Filter out the string 'undefined'
      if (typeof ev.value === 'string' && ev.value.trim().toLowerCase() === 'undefined') {
        return false
      }
      
      return true
    })
    .map(ev => {
      // Clean string values: trim and collapse whitespace
      if (typeof ev.value === 'string') {
        return {
          ...ev,
          value: ev.value.trim().replace(/\s+/g, ' ')
        }
      }
      
      // Return as-is for numbers
      return ev as { label: string; value: number | string }
    })
}

// Computed property for normalized evidence
const normalizedEvidence = computed(() => normalizeEvidence(props.insight.evidence))

const TOOL_CONTEXT_LABELS = [
  'telemetry ides in window',
  'top ides by ai assists/min (7d)',
  'coding minutes share (7d)',
  'telemetry ides',
  'top ai/min',
  'coding minutes share'
]

function isToolContextEvidence(label: string): boolean {
  const l = String(label ?? '').trim().toLowerCase()
  return TOOL_CONTEXT_LABELS.some(k => l.includes(k))
}

function compactToolList(value: string): string {
  const raw = String(value ?? '').trim()
  if (!raw) return raw
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
  const hasKnown = parts.some(p => !/^unknown\b/i.test(p))
  const filtered = hasKnown ? parts.filter(p => !/^unknown\b/i.test(p)) : parts
  const renamed = filtered.map(p => (/^unknown\b/i.test(p) ? p.replace(/^unknown\b/i, 'Other') : p))
  return renamed.join(', ')
}

const toolContextEvidence = computed(() => {
  return normalizedEvidence.value.filter(ev => isToolContextEvidence(ev.label))
})

const nonToolEvidence = computed(() => {
  return normalizedEvidence.value.filter(ev => !isToolContextEvidence(ev.label))
})

const toolContextSummary = computed(() => {
  const evs = toolContextEvidence.value
  if (!evs.length) return null
  const get = (needle: string) => evs.find(e => String(e.label).toLowerCase().includes(needle))

  const telemetry = get('telemetry ides')
  const topAi = get('top ides by ai assists/min') || get('top ai/min')
  const share = get('coding minutes share')

  const telemetryIdes = telemetry?.value ? compactToolList(String(telemetry.value)) : ''
  const topAiVal = topAi?.value ? compactToolList(String(topAi.value)) : ''
  const shareVal = share?.value ? compactToolList(String(share.value)) : ''

  if (!telemetryIdes && !topAiVal && !shareVal) return null
  return {
    telemetryIdes,
    topAi: topAiVal,
    codingShare: shareVal
  }
})

const primaryEvidence = computed(() => {
  // Keep the main card compact: prefer non-tool evidence first
  return nonToolEvidence.value.slice(0, 6)
})

const secondaryEvidence = computed(() => {
  // Anything beyond the compact view goes behind "More" (excluding tool context which has its own section)
  return nonToolEvidence.value.slice(6)
})

// Check if this is a demo/coverage insight
// Only true demo/coverage insights should show the demo note
// Real or mixed data insights (e.g., VSCode AI rules, deploy rules) should not show this note
const isDemoInsight = computed(() => {
  const tags = props.insight.tags || []
  const ds = props.insight.dataSource?.toLowerCase()
  
  // Tags include 'demo' or 'coverage' -> definitely demo
  if (tags.includes('demo') || tags.includes('coverage')) {
    return true
  }
  
  // Pure sim insights (but NOT mixed) -> optional demo flag
  if (ds === 'sim') {
    return true
  }
  
  // Mixed or real data -> not demo
  return false
})

// Get tool name for demo note
function getToolName(): string {
  if (props.insight.entityId && props.insight.scope === 'tool') {
    return getToolLabel(props.insight.entityId).toUpperCase()
  }
  // Try to extract from tags or entityId
  const toolTag = props.insight.tags?.find(t => ['cursor', 'vscode', 'jetbrains', 'windsurf', 'sublime', 'vim'].includes(t.toLowerCase()))
  if (toolTag) {
    return toolTag.toUpperCase()
  }
  return 'this IDE'
}

/**
 * Map 'info' severity to semantic label based on insight content.
 * This is UI-only mapping - does not change the underlying severity value.
 */
function getDisplaySeverityLabel(insight: Insight): string {
  // Determine semantic label from content
  const title = (insight.title || '').toLowerCase()
  const description = (insight.summary || '').toLowerCase()
  const combined = `${title} ${description}`

  // Positive/healthy patterns → Highlight
  if (
    combined.includes('healthy') ||
    combined.includes('above average') ||
    combined.includes('strong') ||
    combined.includes('improving') ||
    combined.includes('looks healthy') ||
    combined.includes('shows strong')
  ) {
    return 'Highlight'
  }

  // Clear problems/instability → Warning
  if (
    combined.includes('high failure') ||
    combined.includes('instability') ||
    combined.includes('slow') ||
    combined.includes('elevated') ||
    combined.includes('high-risk') ||
    combined.includes('failure rate') ||
    combined.includes('unstable')
  ) {
    return 'Warning'
  }

  // Concerning but not critical → Risk
  if (
    combined.includes('decline') ||
    combined.includes('drop') ||
    combined.includes('reduced') ||
    combined.includes('lower') ||
    combined.includes('decreasing') ||
    combined.includes('deteriorating')
  ) {
    return 'Risk'
  }

  // Default to Opportunity for improvement areas
  return 'Opportunity'
}

/**
 * Get the mapped severity for styling purposes (UI-only).
 * Maps 'info' to the semantic equivalent for badge/border classes.
 */
// Executive Layout Methods

/**
 * Get verdict title combining metric name and primary value
 */
function getVerdictTitle(): string {
  const title = props.insight.title || ''
  const primaryEvidence = getPrimaryMetricValue()
  
  if (primaryEvidence) {
    return `${title}: ${primaryEvidence}`
  }
  
  return title
}

/**
 * Get primary metric value from evidence for verdict line
 */
function getPrimaryMetricValue(): string | null {
  if (!props.insight.evidence || props.insight.evidence.length === 0) {
    return null
  }
  
  // Look for common metric patterns in evidence
  const metricEvidence = props.insight.evidence.find(ev => {
    const label = (ev.label || '').toLowerCase()
    return label.includes('commits') || 
           label.includes('minutes') || 
           label.includes('rate') || 
           label.includes('time') ||
           label.includes('sessions') ||
           label.includes('suggestions') ||
           label.includes('ratio')
  })
  
  if (metricEvidence && metricEvidence.value !== null && metricEvidence.value !== undefined) {
    return formatEvidenceValueTyped(metricEvidence.label, metricEvidence.value, props.insight.metricId)
  }
  
  // Fallback to first evidence item
  const firstEvidence = props.insight.evidence[0]
  if (firstEvidence && firstEvidence.value !== null && firstEvidence.value !== undefined) {
    return formatEvidenceValueTyped(firstEvidence.label, firstEvidence.value, props.insight.metricId)
  }
  
  return null
}

/**
 * Get trend information if available
 */
function getVerdictTrend(): string | null {
  // Look for trend indicators in evidence or displayDelta
  if ((props.insight as any).displayDelta) {
    return (props.insight as any).displayDelta
  }
  
  // Check evidence for trend-like values
  const trendEvidence = props.insight.evidence?.find(ev => {
    const label = (ev.label || '').toLowerCase()
    return label.includes('change') || label.includes('trend') || label.includes('vs')
  })
  
  if (trendEvidence && trendEvidence.value) {
    return String(trendEvidence.value)
  }
  
  return null
}

/**
 * Check if metric is lower-is-better (polarity)
 */
function isLowerIsBetter(insightId: string): boolean {
  const lowerIsBetterMetrics = [
    'time-to-first-commit-by-ide',
    'ttfc',
    'idle-ratio',
    'rework-rate',
    'rework-rate-by-workflow',
    'change-failure-rate',
    'change-failure-rate-spike-by-ide',
    'reopen-pressure-spike',
    'reviewer-load-concentration'
  ]
  return lowerIsBetterMetrics.some(id => insightId.includes(id))
}

/**
 * Get trend icon based on trend value and metric polarity
 */
function getTrendIcon(trend: string): string {
  const trendLower = trend.toLowerCase()
  const isIncrease = trendLower.includes('↑') || trendLower.includes('increase') || trendLower.includes('up') || trendLower.includes('+')
  const isDecrease = trendLower.includes('↓') || trendLower.includes('decrease') || trendLower.includes('down') || trendLower.includes('-')
  
  if (!isIncrease && !isDecrease) {
    return 'bi-dash-circle text-muted'
  }
  
  // Check metric polarity
  const lowerIsBetter = isLowerIsBetter(props.insight.id || '')
  
  // For lower-is-better metrics: decrease = good (green), increase = bad (red)
  // For higher-is-better metrics: increase = good (green), decrease = bad (red)
  if (lowerIsBetter) {
    if (isDecrease) {
      return 'bi-arrow-down-circle-fill text-success' // Decrease is good
    }
    if (isIncrease) {
      return 'bi-arrow-up-circle-fill text-danger' // Increase is bad
    }
  } else {
    if (isIncrease) {
      return 'bi-arrow-up-circle-fill text-success' // Increase is good
    }
    if (isDecrease) {
      return 'bi-arrow-down-circle-fill text-danger' // Decrease is bad
    }
  }
  
  return 'bi-dash-circle text-muted'
}

/**
 * Get why sentence from summary (first sentence only)
 */
function getWhySentence(): string {
  if (!props.insight.summary) {
    return ''
  }
  
  // Extract first sentence
  const sentences = props.insight.summary.split(/[.!?]+/)
  const firstSentence = sentences[0]?.trim()
  
  if (firstSentence) {
    return firstSentence + (props.insight.summary.includes('.') ? '.' : '')
  }
  
  return props.insight.summary
}

/**
 * Check if card has compact evidence to display
 */
function hasCompactEvidence(): boolean {
  return !!(props.insight.evidence && props.insight.evidence.length > 0)
}

/**
 * Get compact evidence string in format: "142 sessions • 85% coverage • 30 days"
 */
function getCompactEvidence(): string {
  if (!props.insight.evidence || props.insight.evidence.length === 0) {
    return ''
  }
  
  const evidenceParts: string[] = []
  
  // Extract key evidence types
  props.insight.evidence.forEach(ev => {
    if (!ev.value) return
    
    const label = (ev.label || '').toLowerCase()
    const value = String(ev.value)
    
    // Map common evidence types to compact format
    if (label.includes('sessions') || label.includes('sample')) {
      evidenceParts.push(`${value} sessions`)
    } else if (label.includes('coverage')) {
      evidenceParts.push(`${value} coverage`)
    } else if (label.includes('days') || label.includes('weeks') || label.includes('time window')) {
      evidenceParts.push(`${value}`)
    } else if (label.includes('confidence')) {
      evidenceParts.push(`${value} confidence`)
    }
  })
  
  // Limit to 3 most important pieces
  return evidenceParts.slice(0, 3).join(' • ')
}

/**
 * Get primary action text (truncated if too long)
 */
function getPrimaryAction(): string {
  if (!props.insight.recommendedAction) {
    return ''
  }
  
  const action = props.insight.recommendedAction
  
  // Truncate very long actions
  if (action.length > 120) {
    return action.substring(0, 117) + '...'
  }
  
  return action
}

/**
 * Check if card has expandable content for "View Details"
 */
function hasExpandableContent(): boolean {
  return !!(
    props.insight.evidence && props.insight.evidence.length > 3 ||
    props.insight.supportingContext && props.insight.supportingContext.length > 0 ||
    props.insight.confidenceBadge ||
    props.insight.alsoObservedIn && props.insight.alsoObservedIn.length > 0 ||
    toolContextSummary.value
  )
}

/**
 * Check if card has required fields for executive layout
 */
function hasRequiredFields(): boolean {
  return !!(
    props.insight.title &&
    props.insight.severity
  )
}

function getDisplaySeverity(insight: Insight): InsightSeverity {
  // Map semantic label to InsightSeverity types for styling
  const label = getDisplaySeverityLabel(insight)
  const labelLower = label.toLowerCase()
  
  // Map semantic labels to InsightSeverity types
  if (labelLower === 'highlight') return 'highlight'
  if (labelLower === 'risk') return 'risk'
  if (labelLower === 'opportunity') return 'opportunity'
  
  // Fallback
  return 'opportunity'
}

// Demo narrative title enhancer - display layer only
function displayInsightTitle(insight: Insight): string {
  const primaryMetric = getPrimaryMetricValue() || insight.title || ''
  
  // Hardcoded display-title overrides by insight.id
  switch (insight.id) {
    case 'large-pr-mix-risk':
      return `Large PR exposure is contained: ${primaryMetric}`
    case 'deployment-frequency-volatility-by-ide':
      return `Deployment cadence is active: ${primaryMetric}`
    case 'change-failure-rate-spike-by-ide':
      return `Deployment quality needs attention: ${primaryMetric} change failure rate`
    case 'delivery-velocity-by-workflow':
      return `Delivery velocity baseline is still forming`
    case 'stale-deployment-signal':
      return `Deployment freshness risk: ${primaryMetric} since last deploy`
    case 'failed-deployment-pressure':
      return `Failed deployment rate elevated: ${primaryMetric} failed`
    case 'latest-deployment-unhealthy':
      return `Latest deployment is healthy`
    case 'review-latency-spike-by-ide':
      return `Review turnaround is fast: ${primaryMetric} to initial review`
    case 'pr-review-cycles-by-ide':
      return `PRs are clearing review with minimal back-and-forth: ${primaryMetric}`
    case 'reviewer-load-concentration':
      return `Reviewer load is distributed: top reviewer owns ${primaryMetric} of reviews`
    case 'reopen-pressure-spike':
      return `Reopen rate elevated: ${primaryMetric} of PRs reopened`
    default:
      return insight.title
  }
}

// Executive Findings-style operational narratives for tool breakdowns
const toolBreakdownNarratives = computed<ToolBreakdownNarrative[]>(() => {
  const breakdownByTool = (props.insight as any).breakdownByTool
  if (!breakdownByTool || typeof breakdownByTool !== 'object') {
    return []
  }

  // Determine context type from metric ID
  const metricId = props.insight.metricId || ''
  let contextType: OperationalNarrativeConfig['contextType'] = 'velocity'
  let higherIsBetter = true

  if (metricId.includes('commit') || metricId.includes('delivery')) {
    contextType = 'delivery'
    higherIsBetter = true
  } else if (metricId.includes('ai') || metricId.includes('suggestion')) {
    contextType = 'ai'
    higherIsBetter = true
  } else if (metricId.includes('coding') || metricId.includes('active')) {
    contextType = 'coding'
    higherIsBetter = true
  } else if (metricId.includes('rework') || metricId.includes('failure') || metricId.includes('reopen')) {
    contextType = 'quality'
    higherIsBetter = false
  } else if (metricId.includes('velocity') || metricId.includes('throughput')) {
    contextType = 'velocity'
    higherIsBetter = true
  }

  return generateToolBreakdownNarratives(breakdownByTool, {
    metricId,
    higherIsBetter,
    contextType
  })
})

// Executive Findings-style evidence density
const evidenceDensity = computed(() => {
  // Extract session count from evidence if available
  const sessionEvidence = props.insight.evidence?.find(ev => 
    ev.label?.toLowerCase().includes('session') || ev.label?.toLowerCase().includes('sample')
  )
  const sessionCount = sessionEvidence ? parseInt(String(sessionEvidence.value)) || 0 : 0

  // Extract PR count if available
  const prEvidence = props.insight.evidence?.find(ev => 
    ev.label?.toLowerCase().includes('pr')
  )
  const prCount = prEvidence ? parseInt(String(prEvidence.value)) || 0 : 0

  // Extract coverage if available
  const coverageEvidence = props.insight.evidence?.find(ev => 
    ev.label?.toLowerCase().includes('coverage')
  )
  const coverage = coverageEvidence ? String(coverageEvidence.value) : undefined

  // Extract confidence if available
  const confidenceEvidence = props.insight.evidence?.find(ev => 
    ev.label?.toLowerCase().includes('confidence')
  )
  const confidenceStr = confidenceEvidence ? String(confidenceEvidence.value).toLowerCase() : undefined
  const confidence = confidenceStr?.includes('high') ? 'high' : 
                     confidenceStr?.includes('medium') ? 'medium' : 'low'

  return {
    sessionCount,
    prCount,
    coverage,
    confidence,
    timeWindow: 'Last 4 weeks'
  }
})

// Executive Findings-style compact evidence string
const executiveEvidenceString = computed(() => {
  const density = evidenceDensity.value
  const parts: string[] = []

  if (density.sessionCount > 0) parts.push(`${density.sessionCount} sessions`)
  if (density.prCount > 0) parts.push(`${density.prCount} PRs`)
  if (density.coverage) parts.push(`${density.coverage} coverage`)
  if (density.confidence) parts.push(`${density.confidence} confidence`)
  parts.push(density.timeWindow)

  return parts.join(' • ')
})

// Check if insight has operational tool breakdowns to display
const hasOperationalToolBreakdowns = computed(() => {
  return toolBreakdownNarratives.value.length > 1
})

// Severity detection for asymmetric layouts
const isHighSeverity = computed(() => {
  const severity = getDisplaySeverity(props.insight)
  return severity === 'risk' || severity === 'lowlight'
})

const isMediumSeverity = computed(() => {
  const severity = getDisplaySeverity(props.insight)
  return severity === 'opportunity'
})

const isLowSeverity = computed(() => {
  const severity = getDisplaySeverity(props.insight)
  return severity === 'highlight'
})

// Confidence detection for rendering variations
const isHighConfidence = computed(() => {
  const density = evidenceDensity.value
  return density.confidence === 'high'
})

const isLowConfidence = computed(() => {
  const density = evidenceDensity.value
  return density.confidence === 'low'
})

// Severity-based layout classes
function getSeverityLayoutClass(severity: InsightSeverity): string {
  if (severity === 'risk' || severity === 'lowlight') {
    return 'insight-card--high-severity'
  }
  if (severity === 'opportunity') {
    return 'insight-card--medium-severity'
  }
  return 'insight-card--low-severity'
}

function getSeverityBodyClass(): string {
  if (isHighSeverity.value) return 'insight-card__body--heavy'
  if (isLowSeverity.value) return 'insight-card__body--subtle'
  return ''
}

function getConfidenceLayoutClass(): string {
  if (isLowConfidence.value) return 'insight-card--low-confidence'
  if (isHighConfidence.value) return 'insight-card--high-confidence'
  return ''
}

// Get metric-specific operational implication label
function getOperationalImplicationLabel(): string {
  const metricId = props.insight.metricId || ''

  if (metricId.includes('commit') || metricId.includes('delivery')) {
    return 'Delivery impact'
  }
  if (metricId.includes('coding') || metricId.includes('active')) {
    return 'Workflow impact'
  }
  if (metricId.includes('ai') || metricId.includes('suggestion')) {
    return 'AI adoption impact'
  }
  if (metricId.includes('rework') || metricId.includes('failure')) {
    return 'Quality impact'
  }
  if (metricId.includes('review') || metricId.includes('cycle')) {
    return 'Review impact'
  }

  return 'Downstream impact'
}

// Downstream implications for tool breakdowns (second-order effects)
function getDownstreamImplication(
  narrative: ToolBreakdownNarrative,
  allNarratives: ToolBreakdownNarrative[]
): string {
  const metricId = props.insight.metricId || ''
  const isTop = allNarratives[0]?.tool === narrative.tool

  // Context-specific downstream implications
  if (metricId.includes('commit') || metricId.includes('delivery')) {
    if (isTop) {
      return 'High commit volume not translating proportionally to deployment throughput suggests downstream delivery bottlenecks.'
    } else {
      return 'Lower commit velocity may indicate workflow friction or process delays before commit stage.'
    }
  }

  if (metricId.includes('coding') || metricId.includes('active')) {
    if (isTop) {
      return 'Sustained coding focus not yielding proportional delivery gains suggests review or deployment bottlenecks.'
    } else {
      return 'Reduced coding intensity may indicate environmental friction or context switching overhead.'
    }
  }

  if (metricId.includes('ai') || metricId.includes('suggestion')) {
    if (isTop) {
      return 'High AI adoption not accelerating delivery suggests workflow integration gaps or quality controls.'
    } else {
      return 'Underutilized AI assistance represents missed acceleration opportunities in review and delivery cycles.'
    }
  }

  if (metricId.includes('rework') || metricId.includes('failure')) {
    if (isTop) {
      return 'Elevated rework creates cascading delays in review cycles and deployment cadence.'
    } else {
      return 'Lower rework suggests stronger upstream quality practices reducing downstream coordination cost.'
    }
  }

  return 'Review delivery workflow patterns for operational bottlenecks.'
}

// Cross-system synthesis computation (organizational consequence framing)
const crossSystemSynthesis = computed((): CrossSystemSynthesis | null => {
  const metricId = props.insight.metricId || ''
  const breakdownByTool = props.insight.breakdownByTool as Record<string, number> | undefined
  const sessionRows = props.allStageInsights?.flatMap((i: any) => i.sessionRows || []) || []

  // Coding velocity → deployment throughput synthesis
  if (metricId.includes('commit') || metricId.includes('coding')) {
    const deploymentVelocity = props.allStageInsights?.find((i: any) => 
      i.metricId?.includes('deployment') || i.metricId?.includes('deploy')
    )?.canonicalMetricValue as number | null
    const prCycleTime = props.allStageInsights?.find((i: any) => 
      i.metricId?.includes('cycle') || i.metricId?.includes('pr')
    )?.canonicalMetricValue as number | null

    return computeCodingToDeliverySynthesis(
      breakdownByTool,
      deploymentVelocity,
      prCycleTime,
      sessionRows
    )
  }

  // AI adoption → review depth synthesis
  if (metricId.includes('ai') || metricId.includes('suggestion')) {
    const prReviewCycles = props.allStageInsights?.find((i: any) => 
      i.metricId?.includes('review') || i.metricId?.includes('cycle')
    )?.canonicalMetricValue as number | null
    const prSize = props.allStageInsights?.find((i: any) => 
      i.metricId?.includes('size') || i.metricId?.includes('pr')
    )?.canonicalMetricValue as number | null

    return computeAIToReviewSynthesis(
      breakdownByTool,
      prReviewCycles,
      prSize,
      sessionRows
    )
  }

  // Rework → change failure synthesis
  if (metricId.includes('rework') || metricId.includes('churn')) {
    const changeFailureRate = props.allStageInsights?.find((i: any) => 
      i.metricId?.includes('failure') || i.metricId?.includes('cfr')
    )?.canonicalMetricValue as number | null
    const revertRate = props.allStageInsights?.find((i: any) => 
      i.metricId?.includes('revert')
    )?.canonicalMetricValue as number | null

    return computeReworkToFailureSynthesis(
      props.insight.canonicalMetricValue as number | null,
      changeFailureRate,
      revertRate
    )
  }

  // Review cycles → deployment stability synthesis
  if (metricId.includes('review') || metricId.includes('cycle')) {
    const changeFailureRate = props.allStageInsights?.find((i: any) => 
      i.metricId?.includes('failure') || i.metricId?.includes('cfr')
    )?.canonicalMetricValue as number | null
    const deploymentVelocity = props.allStageInsights?.find((i: any) => 
      i.metricId?.includes('deployment') || i.metricId?.includes('deploy')
    )?.canonicalMetricValue as number | null

    return computeReviewToDeploymentSynthesis(
      props.insight.canonicalMetricValue as number | null,
      changeFailureRate,
      deploymentVelocity
    )
  }

  return null
})

// Check if cross-system synthesis has meaningful operational consequence
const hasOperationalConsequence = computed(() => {
  return crossSystemSynthesis.value?.correlation !== 'none' && 
         crossSystemSynthesis.value?.confidence === 'high'
})

// Check if this is a diagnostic card (evidence_only presentation type)
const isDiagnosticCard = computed(() => {
  return (props.insight as any).presentationType === 'evidence_only'
})

// Category classification for differentiated rendering
const insightCategory = computed((): CategoryClassification => {
  return classifyInsightCategory(props.insight, crossSystemSynthesis.value)
})

// Category-based rendering helpers
const isCriticalRisk = computed(() => insightCategory.value.category === 'CRITICAL_RISK')
const isWorkflowBottleneck = computed(() => insightCategory.value.category === 'WORKFLOW_BOTTLENECK')
const isEmergingSignal = computed(() => insightCategory.value.category === 'EMERGING_SIGNAL')
const isOptimizationOpportunity = computed(() => insightCategory.value.category === 'OPTIMIZATION_OPPORTUNITY')
const isDeliveryBottleneck = computed(() => insightCategory.value.category === 'DELIVERY_BOTTLENECK')

// Category-based layout classes
function getCategoryLayoutClass(): string {
  const category = insightCategory.value.category
  if (category === 'CRITICAL_RISK') return 'insight-card--critical-risk'
  if (category === 'DELIVERY_BOTTLENECK') return 'insight-card--delivery-bottleneck'
  if (category === 'WORKFLOW_BOTTLENECK') return 'insight-card--workflow-bottleneck'
  if (category === 'EMERGING_SIGNAL') return 'insight-card--emerging-signal'
  if (category === 'OPTIMIZATION_OPPORTUNITY') return 'insight-card--optimization'
  return ''
}
</script>

<style scoped>
/* Executive Layout Styles */
.insight-card--executive {
  border-radius: 0.75rem;
  transition: all 0.2s ease-in-out;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #e9ecef;
}

/* HIGH SEVERITY: Heavy, urgent, asymmetric layout */
.insight-card--high-severity {
  border-left: 4px solid #dc2626;
  border-width: 2px;
  box-shadow: 0 4px 16px rgba(220, 38, 38, 0.15);
}

.insight-card--high-severity:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(220, 38, 38, 0.25);
  border-left-width: 5px;
}

.insight-card__body--heavy {
  padding: 1rem !important;
  background: linear-gradient(135deg, #fef2f2 0%, #ffffff 100%);
}

.insight-card__high-severity-header {
  border-bottom: 2px solid #fee2e2;
  padding-bottom: 0.5rem;
}

.insight-card__verdict-icon--large {
  width: 32px;
  height: 32px;
  font-size: 1.1rem;
}

.insight-card__verdict-title--urgent {
  font-size: 1.15rem;
  font-weight: 800;
  color: #991b1b;
  letter-spacing: -0.03em;
}

.insight-card__verdict-trend--urgent {
  font-size: 0.9rem;
  font-weight: 700;
  color: #b91c1c;
}

.insight-card__verdict-badge--urgent {
  font-size: 0.75rem;
  font-weight: 800;
  padding: 0.4rem 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  border-radius: 0.3rem;
}

.insight-card__why-line--heavy {
  background: #fee2e2;
  border-left: 3px solid #dc2626;
  padding: 0.6rem 0.8rem;
  border-radius: 0.3rem;
}

.insight-card__why-text--urgent {
  font-size: 0.95rem;
  font-weight: 600;
  color: #7f1d1d;
  line-height: 1.4;
}

.insight-card__evidence-line--heavy {
  background: #fef3c7;
  border-left: 3px solid #d97706;
  padding: 0.6rem 0.8rem;
  border-radius: 0.3rem;
}

.insight-card__evidence-compact--dense {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.insight-card__evidence-icon--prominent {
  font-size: 1rem;
  color: #d97706;
}

.insight-card__tool-narratives--heavy {
  background: #f0fdf4;
  border-left: 4px solid #059669;
  padding: 0.7rem 0.8rem;
  border-radius: 0.3rem;
}

.tool-narrative-compact-comparison--heavy,
.tool-narrative-vertical--heavy {
  gap: 0.5rem;
}

.tool-narrative-implication {
  margin-top: 0.4rem;
  padding-top: 0.4rem;
  border-top: 1px dashed #059669;
  font-size: 0.75rem;
  line-height: 1.3;
  color: #047857;
}

.tool-narrative-implication-label {
  font-weight: 700;
  color: #065f46;
}

.insight-card__action-line--urgent {
  background: #fef2f2;
  border: 2px solid #dc2626;
  padding: 0.6rem 0.8rem;
  border-radius: 0.3rem;
}

.insight-card__action-executive--heavy {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
}

.insight-card__action-icon--urgent {
  font-size: 1rem;
  color: #dc2626;
  flex-shrink: 0;
}

.insight-card__action-text--urgent {
  font-size: 0.9rem;
  font-weight: 700;
  color: #991b1b;
  line-height: 1.3;
}

/* Cross-system organizational consequence (high severity only) */
.insight-card__organizational-consequence {
  background: linear-gradient(135deg, #fef3c7 0%, #fef9e3 100%);
  border-left: 4px solid #d97706;
  border-right: 2px solid #fcd34d;
  padding: 0.7rem 0.8rem;
  border-radius: 0.3rem;
  box-shadow: 0 2px 8px rgba(217, 119, 6, 0.15);
}

.insight-card__consequence-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.insight-card__consequence-icon {
  font-size: 1rem;
  color: #d97706;
}

.insight-card__consequence-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #92400e;
}

.insight-card__consequence-content {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.insight-card__consequence-metric {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: #78350f;
}

.insight-card__consequence-metric-label {
  font-weight: 600;
}

.insight-card__consequence-arrow {
  font-size: 0.75rem;
  color: #b45309;
}

.insight-card__consequence-metric-value {
  font-weight: 600;
}

.insight-card__consequence-implication {
  font-size: 0.85rem;
  line-height: 1.3;
  color: #92400e;
  font-weight: 500;
}

.insight-card__consequence-organizational {
  font-size: 0.8rem;
  line-height: 1.3;
  color: #b45309;
  font-style: italic;
  font-weight: 500;
}

/* CATEGORY-BASED LAYOUTS */

/* CRITICAL_RISK: Dense, heavy, urgent, operational consequence focus */
.insight-card--critical-risk {
  border-left: 5px solid #dc2626;
  background: linear-gradient(135deg, #fef2f2 0%, #ffffff 100%);
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.15);
}

.insight-card--critical-risk:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 20px rgba(220, 38, 38, 0.25);
  border-color: #dc2626;
}

.insight-card--critical-risk .insight-card__verdict-title {
  font-weight: 800;
  color: #991b1b;
}

.insight-card--critical-risk .insight-card__body {
  padding: 1rem 0.9rem;
}

/* DELIVERY_BOTTLENECK: Downstream impact emphasis, dependency framing */
.insight-card--delivery-bottleneck {
  border-left: 5px solid #ea580c;
  background: linear-gradient(135deg, #fff7ed 0%, #ffffff 100%);
  box-shadow: 0 4px 12px rgba(234, 88, 12, 0.12);
}

.insight-card--delivery-bottleneck:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(234, 88, 12, 0.2);
  border-color: #ea580c;
}

.insight-card--delivery-bottleneck .insight-card__verdict-title {
  font-weight: 700;
  color: #c2410c;
}

/* WORKFLOW_BOTTLENECK: Process friction, review/merge focus */
.insight-card--workflow-bottleneck {
  border-left: 4px solid #7c3aed;
  background: linear-gradient(135deg, #f5f3ff 0%, #ffffff 100%);
  box-shadow: 0 3px 10px rgba(124, 58, 237, 0.1);
}

.insight-card--workflow-bottleneck:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 14px rgba(124, 58, 237, 0.18);
  border-color: #7c3aed;
}

.insight-card--workflow-bottleneck .insight-card__verdict-title {
  font-weight: 700;
  color: #6d28d9;
}

/* EMERGING_SIGNAL: Light, exploratory, compressed, uncertainty emphasis */
.insight-card--emerging-signal {
  border-left: 3px solid #9ca3af;
  background: #f9fafb;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
  opacity: 0.85;
}

.insight-card--emerging-signal:hover {
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.08);
}

.insight-card--emerging-signal .insight-card__verdict-title {
  font-weight: 600;
  color: #4b5563;
}

.insight-card--emerging-signal .insight-card__body {
  padding: 0.8rem 0.9rem;
}

/* OPTIMIZATION_OPPORTUNITY: Throughput-oriented, positive, workflow-focused */
.insight-card--optimization {
  border-left: 4px solid #059669;
  background: linear-gradient(135deg, #ecfdf5 0%, #ffffff 100%);
  box-shadow: 0 3px 10px rgba(5, 150, 105, 0.1);
}

.insight-card--optimization:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 14px rgba(5, 150, 105, 0.18);
  border-color: #059669;
}

.insight-card--optimization .insight-card__verdict-title {
  font-weight: 700;
  color: #047857;
}

/* MEDIUM SEVERITY: Standard layout */
.insight-card--medium-severity {
  border-left: 3px solid #4f46e5;
}

.insight-card--medium-severity:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  border-color: #dee2e6;
}

/* LOW SEVERITY: Compressed, collapsed layout */
.insight-card--low-severity {
  border-left: 2px solid #9ca3af;
  border-width: 1px;
  opacity: 0.85;
}

.insight-card--low-severity:hover {
  opacity: 1;
  transform: translateY(-1px);
}

.insight-card__body--subtle {
  padding: 0.5rem !important;
}

.insight-card__low-severity-header {
  margin-bottom: 0.25rem;
}

.insight-card__verdict-icon--subtle {
  width: 20px;
  height: 20px;
  font-size: 0.75rem;
}

.insight-card__verdict-title--subtle {
  font-size: 0.9rem;
  font-weight: 500;
  color: #6b7280;
}

.insight-card__verdict-badge--subtle {
  font-size: 0.65rem;
  font-weight: 500;
  padding: 0.15rem 0.4rem;
  opacity: 0.7;
}

.insight-card__why-line--collapsed {
  display: inline;
}

.insight-card__why-text--subtle {
  font-size: 0.8rem;
  color: #6b7280;
  font-style: italic;
}

.insight-card__evidence-line--subtle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: none;
  padding: 0;
}

.insight-card__evidence-icon--subtle {
  font-size: 0.75rem;
  color: #9ca3af;
}

.insight-card__evidence-text--subtle {
  font-size: 0.75rem;
  color: #6b7280;
}

.insight-card__action-line--subtle {
  background: none;
  border: none;
  padding: 0;
}

.insight-card__action-text--subtle {
  font-size: 0.75rem;
  color: #6b7280;
  font-style: italic;
}

/* CONFIDENCE-BASED RENDERING VARIATIONS */
.insight-card--high-confidence {
  border-left-width: 3px;
}

.insight-card--low-confidence {
  border-left-width: 1px;
  opacity: 0.75;
}

.insight-card--low-confidence:hover {
  opacity: 0.9;
}

/* Executive body - reduced padding for higher density */
.insight-card__body-executive {
  padding: 0.75rem !important;
}

/* Verdict Line - Primary executive information with enhanced hierarchy */
.insight-card__verdict-line {
  margin-bottom: 0.6rem !important;
}

.insight-card__verdict-icon {
  width: 28px;
  height: 28px;
  font-size: 0.9rem;
  flex-shrink: 0;
}

.insight-card__verdict-title {
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.25;
  color: #111827;
  margin: 0;
  letter-spacing: -0.02em;
}

.insight-card__verdict-trend {
  font-size: 0.85rem;
  font-weight: 600;
  margin-top: 0.15rem;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  color: #4b5563;
}

.insight-card__verdict-trend i {
  font-size: 1rem;
}

.insight-card__verdict-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.3rem 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-radius: 0.25rem;
}

/* Why Line - Single sentence explanation */
.insight-card__why-line {
  margin-bottom: 0.5rem !important;
}

.insight-card__why-text {
  font-size: 0.9rem;
  line-height: 1.3;
  color: #495057;
  font-weight: 400;
}

/* Compact Evidence Line */
.insight-card__evidence-line {
  margin-bottom: 0.5rem !important;
}

.insight-card__evidence-compact {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #f8f9fa;
  border-radius: 0.3rem;
  padding: 0.4rem 0.5rem;
  border-left: 3px solid #6c757d;
}

.insight-card__evidence-icon {
  color: #6c757d;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.insight-card__evidence-text {
  font-size: 0.85rem;
  color: #495057;
  font-weight: 500;
  line-height: 1.2;
}

/* CR-X Slice 4: Temporal sparkline container */
.insight-card__temporal-sparkline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #f8f9fa;
  border-radius: 0.3rem;
  padding: 0.4rem 0.5rem;
  border-left: 3px solid #2563eb;
}

/* CR-X Track E: Distribution bar container */
.insight-card__distribution {
  background: #f8f9fa;
  border-radius: 0.3rem;
  padding: 0.5rem 0.6rem;
  border-left: 3px solid #64748b;
}
.insight-card__distribution--subtle {
  padding: 0.35rem 0.5rem;
}

/* Operational Tool Narratives (Executive Findings-style) */
.insight-card__tool-narratives {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  background: #fafbfc;
  border-radius: 0.3rem;
  padding: 0.5rem;
  border-left: 3px solid #4f46e5;
}

/* Compact comparison view for 2 tools (side-by-side) */
.tool-narrative-compact-comparison {
  display: flex;
  gap: 0.3rem;
  flex-wrap: nowrap;
}

.tool-narrative--compact {
  flex: 1;
  min-width: 0;
  padding: 0.2rem 0.3rem;
  background: white;
  border-radius: 0.2rem;
  border: 1px solid #e5e7eb;
}

.tool-narrative--compact.tool-narrative--top {
  border-color: #059669;
  border-width: 2px;
  background: rgba(5, 150, 105, 0.05);
  box-shadow: 0 1px 2px rgba(5, 150, 105, 0.1);
}

/* Vertical view for 3+ tools */
.tool-narrative-vertical {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.tool-narrative-item {
  padding: 0.3rem 0;
  border-bottom: 1px solid #e5e7eb;
}

.tool-narrative-item:last-child {
  border-bottom: none;
}

.tool-narrative--top {
  border-left: 2px solid #059669;
  padding-left: 0.4rem;
  background: linear-gradient(90deg, rgba(5, 150, 105, 0.05) 0%, transparent 100%);
}

.tool-narrative-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.2rem;
}

.tool-narrative-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: #374151;
  text-transform: capitalize;
}

.tool-narrative-value {
  font-size: 0.8rem;
  font-weight: 600;
  color: #4f46e5;
}

.tool-narrative-text {
  font-size: 0.8rem;
  line-height: 1.3;
  color: #6b7280;
  font-weight: 400;
}

/* Primary Action Line */
.insight-card__action-line {
  margin-bottom: 0.5rem !important;
}

.insight-card__action-executive {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  background: #e3f2fd;
  border-radius: 0.3rem;
  padding: 0.4rem 0.5rem;
  border-left: 3px solid #0d6efd;
}

.insight-card__action-icon {
  color: #0d6efd;
  font-size: 0.85rem;
  flex-shrink: 0;
  margin-top: 0.1rem;
}

.insight-card__action-text {
  font-size: 0.85rem;
  color: #1565c0;
  font-weight: 500;
  line-height: 1.3;
}

/* View Details Section */
.insight-card__details-section {
  margin-top: 0.5rem;
}

.insight-card__details-toggle {
  font-size: 0.8rem;
  text-decoration: none;
  padding: 0.2rem 0;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 500;
}

.insight-card__details-toggle:hover {
  text-decoration: underline;
  color: #0b5ed7 !important;
}

/* Match existing dashboard metric card style */
.insight-card {
  border-radius: 1rem;
  transition: all 0.2s ease-in-out;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  border: 1px solid #e9ecef;
}

.insight-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}

/* Dense mode - reduced padding and spacing (higher specificity to override Bootstrap) */
.insight-card.insight-card--dense .card-body {
  padding: 0.75rem !important;
}

.insight-card.insight-card--dense .card-title {
  line-height: 1.3;
  margin-bottom: 0.25rem;
}

.insight-card.insight-card--dense .card-text {
  line-height: 1.4;
}

/* ========================================
   COMPACT LAYOUT - Repackaged Content
   ======================================== */

/* Compact card typography */
.insight-card--compact {
  font-size: 0.9rem;
}

.insight-card--compact .card-body {
  padding: 0.7rem !important;
}

/* Card body: relative positioning for absolute badge */
.insight-card__body {
  position: relative;
}

/* Severity badge: top-right corner */
.insight-card__severity-badge {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 10;
  white-space: nowrap;
}

/* Header: icon + title (full width, no truncation) */
.insight-card__header-compact {
  margin-bottom: 0.5rem;
  padding-right: 4rem; /* Space for badge */
}

.insight-card__header-icon {
  width: 28px;
  height: 28px;
  font-size: 0.9rem;
  flex-shrink: 0;
}

.insight-card__header-title {
  font-size: 0.95rem;
  line-height: 1.3;
  flex: 1;
  /* No truncation - allow title to wrap if needed */
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* Expanded panel container (full width, completely flush - breaks out of card-body padding) */
.insight-card-expanded-panel {
  position: relative;
  margin-top: 0.5rem;
  margin-left: -0.7rem;
  margin-right: -0.7rem;
  margin-bottom: -0.7rem;
  width: calc(100% + 1.4rem);
  max-width: none;
}

/* Handle different padding values based on which class wins */
.insight-card--dense:not(.insight-card--compact) .insight-card-expanded-panel {
  margin-left: -0.75rem;
  margin-right: -0.75rem;
  margin-bottom: -0.75rem;
  width: calc(100% + 1.5rem);
}

.insight-card--compact-prop .insight-card-expanded-panel {
  margin-left: -0.9rem;
  margin-right: -0.9rem;
  margin-bottom: -0.75rem;
  width: calc(100% + 1.8rem);
}

/* Description: clamped with toggle */
.insight-card__description-wrapper {
  margin-bottom: 0.5rem;
}

.insight-card__description {
  font-size: 0.85rem;
  line-height: 1.4;
}

.insight-card__description--clamped {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.insight-card__toggle {
  font-size: 0.75rem;
  text-decoration: none;
  padding: 0;
  height: auto;
  line-height: 1;
}

.insight-card__toggle:hover {
  text-decoration: underline;
}

/* Evidence: compact stat grid */
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

.tool-context-compact {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding-top: 0.4rem;
}

.tool-context-row {
  display: grid;
  grid-template-columns: minmax(110px, 38%) minmax(0, 62%);
  gap: 0.5rem;
  padding: 0.15rem 0.25rem;
}

.tool-context-details summary {
  list-style: none;
}

.tool-context-details summary::-webkit-details-marker {
  display: none;
}

.evidence-more summary {
  list-style: none;
}

.evidence-more summary::-webkit-details-marker {
  display: none;
}

/* Action: compact inline callout */
.action-section-compact {
  background: #e3f2fd;
  border-left: 3px solid #0d6efd;
  border-radius: 0.4rem;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
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

.action-toggle-compact {
  font-size: 0.7rem;
  text-decoration: none;
  padding: 0;
  height: auto;
  line-height: 1;
}

.action-toggle-compact:hover {
  text-decoration: underline;
}

.action-text-compact {
  color: #495057;
  font-size: 0.85rem;
  line-height: 1.4;
}

.action-text-compact--clamped {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.demo-note-compact {
  font-size: 0.75rem;
  font-style: italic;
  margin-top: 0.25rem;
}

/* Footer: small chips in one row */
.insight-card__footer-compact {
  border-top: 1px solid #e9ecef;
  padding-top: 0.5rem;
  margin-top: 0.5rem;
}

.badge-chip-compact {
  font-size: 0.65rem;
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
  font-weight: 500;
}

.badge-chip-compact i {
  font-size: 0.7rem;
  margin-right: 0.2rem;
}

.insight-card__footer-source {
  font-size: 0.7rem;
  flex-shrink: 0;
}

.insight-card__footer-source i {
  font-size: 0.7rem;
  margin-right: 0.2rem;
}

/* Compact variant (prop-based, legacy) */
.insight-card--compact-prop {
  padding: 0.75rem 0.9rem;
  border-radius: 10px;
  font-size: 0.85rem;
}

.insight-card--compact-prop .card-body {
  padding: 0.75rem 0.9rem !important;
}

.insight-card--compact-prop .card-title {
  font-size: 0.95rem;
  line-height: 1.3;
}

.insight-card--compact-prop .card-text {
  font-size: 0.8rem;
  line-height: 1.4;
}

/* 1-line clamp for description in compact prop mode */
.insight-card__description--compact {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Evidence section - tighter in dense mode */
.insight-card--dense .evidence-section {
  padding: 0.6rem;
}

/* Evidence row tighter layout in compact prop mode */
.insight-card__evidence--compact {
  margin-top: 0.35rem;
  padding: 0.5rem !important;
}

.insight-card--compact-prop .evidence-item {
  padding: 0.3rem 0.4rem;
  font-size: 0.8rem;
}

.insight-card--compact-prop .evidence-item small {
  font-size: 0.7rem;
}

.insight-card--compact-prop .evidence-item strong {
  font-size: 0.85rem;
}

/* Action line clamped to 2 lines in compact prop mode */
.insight-card__action--compact {
  margin-top: 0.45rem;
  padding: 0.5rem !important;
}

.insight-card__action-text--compact {
  font-size: 0.8rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.insight-card--compact-prop .action-header {
  font-size: 0.75rem;
  margin-bottom: 0.2rem;
}

.insight-card--compact-prop .severity-indicator {
  width: 24px;
  height: 24px;
  font-size: 0.85rem;
}

.insight-card--compact-prop .badge-sm {
  font-size: 0.65rem;
  padding: 0.2rem 0.4rem;
}

/* Severity border accent */
.border-danger { border-left-color: #dc3545 !important; }
.border-warning { border-left-color: #ffc107 !important; }
.border-primary { border-left-color: #0d6efd !important; }
.border-info { border-left-color: #0dcaf0 !important; }
.border-success { border-left-color: #198754 !important; }

.severity-indicator {
  width: 32px;
  height: 32px;
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

/* Evidence grid (horizontal) */
.evidence-section {
  background: #f8f9fa;
  border-radius: 0.5rem;
  padding: 0.75rem;
}

.evidence-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 0.75rem;
}

.evidence-item {
  text-align: center;
}

.evidence-item small {
  font-size: 0.75rem;
}

.evidence-item strong {
  font-size: 1rem;
}

/* Action section */
.action-section {
  background: #e3f2fd;
  border-left: 3px solid #0d6efd;
  border-radius: 0.5rem;
  padding: 0.75rem;
}

/* Action section - tighter in dense mode */
.insight-card.insight-card--dense .action-section {
  padding: 0.6rem !important;
}

.action-header {
  color: #0d6efd;
  font-weight: 600;
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
}

.insight-card.insight-card--dense .action-header {
  margin-bottom: 0.15rem;
}

.insight-card.insight-card--dense .action-header i {
  margin-right: 0.4rem;
}

.action-text {
  color: #495057;
  line-height: 1.4;
}

/* Alert styles */
.alert-sm {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  margin-bottom: 0;
}

.badge-sm {
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.demo-note {
  border-top: 1px solid #e9ecef;
  padding-top: 0.5rem;
  margin-top: 0.5rem;
}

/* ========================================
   RESPONSIVE ADJUSTMENTS - All Screen Sizes
   ======================================== */

/* Extra Small Devices (phones, < 576px) */
@media (max-width: 575.98px) {
  .insight-card {
    margin-bottom: 1rem;
  }
  
  /* Slightly reduced padding for mobile (but still comfortable) */
  .insight-card--dense .card-body,
  .insight-card--compact .card-body {
    padding: 0.9rem !important;
  }
  
  /* Header: allow wrapping on very small screens */
  .insight-card__header-compact {
    padding-right: 3.5rem; /* Less space for smaller badge on mobile */
  }
  
  .insight-card__header-title {
    font-size: 0.85rem;
    line-height: 1.2;
    min-width: 0;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  
  .insight-card__severity-badge {
    top: 0.4rem;
    right: 0.4rem;
    font-size: 0.65rem;
    padding: 0.2rem 0.4rem;
  }
  
  .insight-card__header-icon {
    width: 26px;
    height: 26px;
    font-size: 0.85rem;
  }
  
  .badge-sm {
    font-size: 0.65rem;
    padding: 0.2rem 0.4rem;
  }
  
  /* Description: 3 lines on mobile */
  .insight-card__description {
    font-size: 0.875rem;
  }
  
  .insight-card__description--clamped {
    -webkit-line-clamp: 3;
  }
  
  .insight-card__toggle {
    font-size: 0.8rem;
    padding: 0.25rem 0;
    min-height: 32px; /* Touch target */
  }
  
  /* Evidence stays as two-column rows */
  
  .evidence-section-compact {
    padding: 0.6rem;
  }
  
  .evidence-label-compact {
    font-size: 0.6rem;
  }
  
  .evidence-value-compact {
    font-size: 0.8rem;
  }
  
  /* Action: full width, comfortable spacing */
  .action-section-compact {
    padding: 0.6rem;
  }
  
  .action-icon-compact {
    font-size: 0.85rem;
  }
  
  .action-label-compact {
    font-size: 0.75rem;
  }
  
  .action-text-compact {
    font-size: 0.8rem;
  }
  
  .action-toggle-compact {
    font-size: 0.75rem;
    padding: 0.25rem 0;
    min-height: 32px; /* Touch target */
  }
  
  /* Footer: stack on very small screens */
  .insight-card__footer-compact {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
  
  .badge-chip-compact {
    font-size: 0.6rem;
    padding: 0.25rem 0.35rem;
  }
  
  .insight-card__footer-source {
    font-size: 0.65rem;
  }
  
  /* Alert: full width */
  .alert-sm {
    padding: 0.6rem 0.75rem;
    font-size: 0.85rem;
  }
  
  /* Severity indicator: touch-friendly */
  .severity-indicator {
    width: 28px;
    height: 28px;
    font-size: 0.9rem;
  }
}

/* Small Devices (landscape phones, 576px - 767.98px) */
@media (min-width: 576px) and (max-width: 767.98px) {
  .insight-card--dense .card-body,
  .insight-card--compact .card-body {
    padding: 0.85rem !important;
  }
  
  .insight-card__header-compact {
    padding-right: 3.5rem;
  }
  
  .insight-card__header-title {
    font-size: 0.88rem;
    min-width: 0;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  
  .insight-card__header-icon {
    width: 30px;
    height: 30px;
    font-size: 0.95rem;
  }
  
  .insight-card__severity-badge {
    font-size: 0.7rem;
    padding: 0.2rem 0.45rem;
  }
  
  /* Evidence stays as two-column rows; just reduce label column slightly */
  .evidence-item-compact,
  .tool-context-row {
    grid-template-columns: minmax(95px, 40%) minmax(0, 60%);
  }
  
  .evidence-section-compact {
    padding: 0.55rem;
  }
  
  .action-section-compact {
    padding: 0.55rem;
  }
  
  .insight-card__description {
    font-size: 0.88rem;
  }
  
  .action-text-compact {
    font-size: 0.88rem;
  }
}

/* Medium Devices (tablets, 768px - 991.98px) */
@media (min-width: 768px) and (max-width: 991.98px) {
  .insight-card--dense .card-body,
  .insight-card--compact .card-body {
    padding: 0.75rem !important;
  }
  
  .insight-card__header-compact {
    padding-right: 4rem;
  }
  
  .evidence-item-compact,
  .tool-context-row {
    grid-template-columns: minmax(120px, 36%) minmax(0, 64%);
  }
  
  .insight-card__header-title {
    font-size: 0.92rem;
  }
  
  .insight-card__description {
    font-size: 0.85rem;
  }
  
  .action-text-compact {
    font-size: 0.85rem;
  }
}

/* Large Devices (desktops, 992px - 1199.98px) */
@media (min-width: 992px) and (max-width: 1199.98px) {
  .insight-card--dense .card-body,
  .insight-card--compact .card-body {
    padding: 0.7rem !important;
  }
  
  .insight-card__header-compact {
    padding-right: 4rem;
  }
  
  .insight-card__header-title {
    font-size: 0.9rem;
    min-width: 0;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  
  /* Evidence stays as two-column rows */
}

/* Extra Large Devices (large desktops, ≥ 1200px) */
@media (min-width: 1200px) {
  .insight-card--dense .card-body,
  .insight-card--compact .card-body {
    padding: 0.7rem !important;
  }
  
  .insight-card__header-compact {
    padding-right: 4rem;
  }
  
  .evidence-item-compact,
  .tool-context-row {
    grid-template-columns: minmax(140px, 34%) minmax(0, 66%);
  }
  
  /* Slightly larger text on large screens for readability */
  .insight-card__header-title {
    font-size: 0.92rem;
  }
  
  .insight-card__description {
    font-size: 0.86rem;
  }
  
  .action-text-compact {
    font-size: 0.86rem;
  }
}

/* Ultra-wide screens (≥ 1400px) - maintain density */
@media (min-width: 1400px) {
  .insight-card--dense .card-body,
  .insight-card--compact .card-body {
    padding: 0.7rem !important;
  }
}

/* Landscape orientation adjustments */
@media (orientation: landscape) and (max-height: 600px) {
  /* Reduce vertical spacing in landscape on small screens */
  .insight-card__header-compact {
    margin-bottom: 0.4rem;
  }
  
  .insight-card__description-wrapper {
    margin-bottom: 0.4rem;
  }
  
  .evidence-section-compact {
    margin-bottom: 0.4rem;
    padding: 0.5rem;
  }
  
  .action-section-compact {
    margin-bottom: 0.4rem;
    padding: 0.5rem;
  }
  
  .insight-card__footer-compact {
    margin-top: 0.4rem;
    padding-top: 0.4rem;
  }
}

/* High DPI / Retina displays */
@media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
  .insight-card {
    border-width: 0.5px; /* Thinner borders on retina */
  }
  
  .insight-card__footer-compact {
    border-top-width: 0.5px;
  }
  
  .action-section-compact {
    border-left-width: 2px;
  }
}

/* Print styles */
@media print {
  .insight-card {
    box-shadow: none;
    border: 1px solid #000;
    page-break-inside: avoid;
  }
  
  .insight-card__toggle,
  .action-toggle-compact {
    display: none; /* Hide toggles in print */
  }
  
  .insight-card__description--clamped,
  .action-text-compact--clamped {
    -webkit-line-clamp: unset; /* Show full text in print */
    display: block;
  }
}
</style>

