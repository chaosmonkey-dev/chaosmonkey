<template>
  <!-- 
    V1 CANONICAL EXPANDED ROW STRUCTURE (Source of Truth for UI/UX)
    ================================================================
    This component implements the exact V1 expanded row structure:
    
    1. Header (title + badges: scope, source, severity)
    2. Primary KPI Row (top 2 evidence inline)
    3. Paired Signal Cross-Reference (conditional, Review & Merge only)
    4. Signal Type Label (conditional, Review & Merge only)
    5. What's happening (1 sentence, declarative)
    6. Why it matters (1 sentence, business/delivery impact)
    7. Context (badges: metricId, stage, tags)
    8. Evidence (collapsed by default, top 4 visible, "Show all" toggle)
    9. Related signals (conditional, if supportingContext exists)
    10. Recommendation (MANDATORY: Owner / Action / Timeline)
    
    All sections use V2 data only. No V1 computation logic is referenced.
    Structure, order, labels, and interaction model match V1 exactly.
  -->
  <div class="insight-expanded-panel" :class="[getSeverityAccentClass(), { 'insight-expanded-panel--strip': variant === 'strip' }]">
    <!-- Executive Header - Consolidated title, badges, and inline metadata -->
    <div class="insight-expanded-header-executive">
      <div class="insight-expanded-title-row">
        <h6 class="insight-expanded-title">{{ insight.title }}</h6>
        <!-- Inline severity badge (no separate box) -->
        <span class="insight-expanded-severity-inline" :class="getSeverityBadgeClass()">
          {{ getSeverityLabel() }}
        </span>
      </div>
      <!-- Inline metadata chips (scope, source) - narrative style, not boxes -->
      <div v-if="scopeBadge || sourceBadge" class="insight-expanded-metadata-inline">
        <span v-if="scopeBadge" class="insight-expanded-metadata-chip">{{ scopeBadge }}</span>
        <span v-if="sourceBadge" class="insight-expanded-metadata-chip insight-expanded-metadata-chip--source" :class="getSourceBadgeClass()">
          {{ sourceBadge }}
        </span>
      </div>
    </div>

    <!-- Executive Summary - Combined What's happening + Why it matters (reduces repetitive sections) -->
    <div class="insight-expanded-executive-summary">
      <div class="insight-expanded-summary-content">
        <span class="insight-expanded-summary-label">Executive summary:</span>
        {{ whatsHappeningForDisplay || 'Analyzing performance data across IDEs.' }}
        <span v-if="whyItMatters" class="insight-expanded-summary-why">
          {{ whyItMatters }}
        </span>
      </div>
      <!-- Inline confidence chip (not a separate box) -->
      <div v-if="confidenceLabelForDisplay" class="insight-expanded-confidence-inline">
        {{ confidenceLabelForDisplay }}
      </div>
    </div>

    <!-- Context chips (only if meaningful) -->
    <div v-if="contextItems.length > 0 && contextItems.length <= 4" class="insight-expanded-context-inline">
      <span v-for="(it, idx) in contextItems" :key="idx" class="insight-expanded-context-chip-compact">
        {{ it }}
      </span>
    </div>

    <!-- Evidence Table (condensed, with show all toggle) -->
    <!-- PHASE 5: Only show evidence section if there's visible evidence (after filtering) -->
    <div v-if="visibleEvidence && visibleEvidence.length > 0" class="insight-expanded-section">
      <div class="insight-expanded-evidence-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div class="insight-expanded-section-label">Evidence</div>
        <!-- FINAL HARDENING: Show button when SECONDARY evidence exists (metadata available under "Show more") -->
        <button
          v-if="hasSecondaryEvidence"
          @click="showAllEvidence = !showAllEvidence"
          class="btn btn-link btn-sm p-0 insight-expanded-evidence-toggle"
          type="button"
          style="text-decoration: underline; cursor: pointer; color: #0d6efd; font-size: 0.875rem; margin-left: auto;"
        >
          {{ showAllEvidence ? 'Hide' : `Show diagnostics (${filteredEvidenceCount})` }}
        </button>
      </div>
      <div class="insight-expanded-evidence">
        <div v-for="(ev, idx) in visibleEvidence" :key="idx" class="insight-expanded-evidence-row">
          <!-- FINAL HARDENING: Pass metricId to formatEvidenceLabel to replace "Metric" with actual name -->
          <span class="insight-expanded-evidence-label">{{ formatEvidenceLabel(ev.label, ev.value, props.insight.metricId) }}</span>
          <!-- FINAL HARDENING: Values must be formatted with units matching collapsed row -->
          <span class="insight-expanded-evidence-value">
            {{ formatEvidenceValueTyped(ev.label, ev.value, props.insight.metricId) }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="insight.supportingContext && insight.supportingContext.length > 0" class="insight-expanded-section">
      <div class="insight-expanded-section-label">Related signals ({{ insight.supportingContext.length }})</div>
      <div class="insight-expanded-evidence">
        <div v-for="(ctx, idx) in insight.supportingContext" :key="idx" class="insight-expanded-evidence-row">
          <span class="insight-expanded-evidence-label">{{ ctx.title }}</span>
          <span class="insight-expanded-evidence-value">{{ formatRelatedSignalValue(ctx) }}</span>
        </div>
      </div>
    </div>

      <!-- Recommendation (V1-style: Owner / Action / Timeline) - only for non-diagnostic cards -->
    <div v-if="!isDiagnosticCard && ((recommendedActions && recommendedActions.length > 0) || (actionText && actionText.trim()))" class="insight-expanded-section insight-expanded-action-section">
      <div class="insight-expanded-action">
        <div class="insight-expanded-action-header">
          <i class="bi bi-arrow-right-circle insight-expanded-action-icon"></i>
          <span class="insight-expanded-action-label">Recommendation</span>
        </div>
        <div v-if="recommendedOwners && recommendedOwners.length > 0" class="insight-expanded-action-owner mb-2">
          <strong>Owner:</strong> {{ recommendedOwners.join(', ') }}
        </div>
        <div v-if="recommendedActions && recommendedActions.length > 0" class="insight-expanded-action-content">
          <div v-for="(a, idx) in recommendedActions.slice(0, 2)" :key="idx" class="mb-1">
            <div><strong>Action:</strong> {{ a.label }}</div>
            <a v-if="a.url" :href="a.url" target="_blank" class="btn btn-sm btn-outline-primary mt-1">
              Details
            </a>
          </div>
        </div>
        <div v-else-if="actionText && actionText.trim()" class="insight-expanded-action-content">
          <div><strong>Action:</strong> {{ actionText }}</div>
        </div>
        <div v-if="actionTimeline" class="insight-expanded-action-timeline mt-2">
          <strong>Timeline:</strong> {{ actionTimeline }}
        </div>
        <div v-if="verificationHint || actionLink" class="insight-expanded-action-footer mt-2">
          <span v-if="verificationHint" class="insight-expanded-verification">
            <i class="bi bi-check-circle"></i>
            {{ verificationHint }}
          </span>
          <a v-if="actionLink" :href="actionLink" target="_blank" class="btn btn-sm btn-outline-primary ms-2">
            Details
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Insight } from '../types/insights'
import { extractPrimaryEvidence } from '../lib/insights/evidenceExtractor'
import type { InsightEvidence } from '../lib/insights/types'
import { formatEvidenceValueTyped } from '../ui/insights/valueFormatter'

interface Props {
  insight: Insight | any // Accept both Insight and PerformanceInsight
  primaryEvidence?: InsightEvidence[]
  variant?: 'card' | 'strip'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'card'
})

// Handle both Insight and PerformanceInsight types
const actionText = computed(() => {
  // PerformanceInsight has recommendations array
  if (props.insight.recommendations && Array.isArray(props.insight.recommendations) && props.insight.recommendations.length > 0) {
    return props.insight.recommendations[0].text
  }
  // Insight has recommendedAction string
  return props.insight.recommendedAction
})

const actionLink = computed(() => {
  if (props.insight.recommendations && Array.isArray(props.insight.recommendations) && props.insight.recommendations.length > 0) {
    return props.insight.recommendations[0].link || null
  }
  return null
})

const recommendedActions = computed(() => {
  const xs = (props.insight as any)?.recommendedActions
  if (Array.isArray(xs)) return xs
  return []
})

const recommendedOwners = computed(() => {
  return props.insight.recommendedOwners || []
})

const actionTimeline = computed(() => {
  // Try to extract timeline from recommendation text
  const recText = actionText.value.toLowerCase()
  if (recText.includes('immediately') || recText.includes('urgent')) {
    return 'Immediate'
  }
  if (recText.includes('next sprint') || recText.includes('this sprint')) {
    return 'Next sprint'
  }
  if (recText.includes('next week')) {
    return 'Next week'
  }
  if (recText.includes('next month')) {
    return 'Next month'
  }
  // Default timeline based on urgency
  const urgency = (props.insight as any)?.urgencyLabel
  if (urgency === 'action_required') {
    return 'Immediate'
  }
  if (urgency === 'investigate') {
    return 'Next sprint'
  }
  return 'Next sprint' // Default
})

// Check if this is a demo_secondary insight for visual de-emphasis
const isDemoSecondary = computed(() => {
  return (props.insight as any)?.demoFlag === 'demo_secondary'
})

// Check if this is a diagnostic card (evidence_only presentation type)
const isDiagnosticCard = computed(() => {
  return (props.insight as any).presentationType === 'evidence_only'
})

// PHASE 1: Context items - ensure Plan & Code insights always have context
const contextItems = computed(() => {
  const out: string[] = []
  const metricId = props.insight?.metricId
  const stage = (props.insight as any)?.cicdStage
  
  // PHASE 1: Always include metricId and stage for Plan & Code insights
  // FINAL HARDENING: Include both Plan & Code and Review & Merge insights
  const v2InsightIds = [
    // Plan & Code
    'commits-per-session-by-ide',
    'active-coding-time-by-ide',
    'ai-suggestions-accepted-by-ide',
    'average-session-length-by-ide',
    'time-to-first-commit-by-ide',
    // Review & Merge
    'pr-cycle-time-by-ide',
    'revert-rate-by-ide',
    'pr-size-by-ide',
    'pr-review-cycles-by-ide',
    'session-conditioned-pr-cycle-time-ai-vs-non-ai',
    'review-latency-spike-by-ide',
    'pr-cycle-time-bottleneck-by-ide'
  ];
  const isV2InsightLocal = metricId && v2InsightIds.includes(metricId);
  
  if (metricId) out.push(String(metricId))
  if (stage) out.push(String(stage))
  
  // PHASE 1: For Plan & Code insights, always include 'v2' tag
  if (isV2InsightLocal) {
    out.push('v2')
  }
  
  const tags = Array.isArray(props.insight?.tags) ? (props.insight.tags as string[]) : []
  for (const t of tags.slice(0, 6)) {
    if (t && !out.includes(String(t))) out.push(String(t))
  }
  
  return out
})

// Paired signal cross-reference (for Review & Merge: Windsurf throughput + reopen insights)
const pairedSignalTitle = computed(() => {
  // Only show for Review & Merge insights
  const stage = (props.insight as any)?.cicdStage
  if (stage !== 'review-merge') return null
  
  const title = String(props.insight?.title || '').toLowerCase()
  const tool = props.insight?.related?.tools?.[0]
  
  // If this is a Windsurf throughput insight, reference the reopen insight
  if (tool && (tool.toLowerCase() === 'windsurf' || tool.toLowerCase() === 'wind')) {
    if (title.includes('throughput') || title.includes('cycle time') || title.includes('time-to-merge')) {
      return 'Related: Windsurf AI intensity also correlates with higher PR reopen rate (quality tradeoff)'
    }
    // If this is a Windsurf reopen insight, reference the throughput insight
    if (title.includes('reopen')) {
      return 'Related: Windsurf AI intensity correlates with slower PR throughput'
    }
  }
  
  return null
})

// Get description - PerformanceInsight uses description, Insight uses summary
const description = computed(() => {
  return props.insight.description || props.insight.summary || ''
})

// PHASE 1: What's happening - use enhanced details for Review & Merge PIs
const whatsHappeningForDisplay = computed(() => {
  const isV2 = isV2Insight(props.insight.metricId);
  
  if (isV2) {
    // PHASE 1: Use enhanced details for Review & Merge PIs, otherwise fall back to explicit field
    const isReviewMerge = props.insight.cicdStage === 'review-merge'
    
    // For Review & Merge PIs, use enhanced details field
    if (isReviewMerge && (props.insight as any).details) {
      const enhancedDetails = (props.insight as any).details
      if (import.meta.env.DEV) {
        console.log('[PHASE1_DEBUG] Using enhanced details for Review & Merge PI', props.insight.metricId, ':', enhancedDetails.substring(0, 100))
      }
      return enhancedDetails.trim()
    }
    
    // For other PIs, use explicit whatsHappening field
    const explicit = (props.insight as any).whatsHappening
    if (explicit && typeof explicit === 'string' && explicit.trim()) {
      // Debug: Log when using explicit whatsHappening
      if (import.meta.env.DEV) {
        console.log('[PHASE1_DEBUG] Using explicit whatsHappening for', props.insight.metricId, ':', explicit.substring(0, 100))
      }
      return explicit.trim()
    }
    
    // Debug: Log if both details and whatsHappening are missing
    if (import.meta.env.DEV) {
      console.warn('[PHASE1_DEBUG] Both details and whatsHappening MISSING for', props.insight.metricId, '- will construct from displayValue')
    }
    
    // Fallback: Construct from displayValue/displayDelta if neither details nor whatsHappening is set
    const displayValue = (props.insight as any).displayValue
    const displayDelta = (props.insight as any).displayDelta
    const displayWinnerLabel = (props.insight as any).displayWinnerLabel
    const displayTimeWindow = (props.insight as any).displayTimeWindow || 'current data window'
    const confidenceLabel = (props.insight as any).confidenceLabel
    
    if (displayValue && displayWinnerLabel) {
      const winnerLabel = displayWinnerLabel.charAt(0).toUpperCase() + displayWinnerLabel.slice(1)
      const metricName = getMetricNameForDisplay(props.insight.metricId || '')
      let sentence = `${winnerLabel} ${metricName} is ${displayValue}`
      if (displayDelta) {
        sentence += `, ${displayDelta}`
      }
      sentence += `, over ${displayTimeWindow}.`
      
      // Add low-confidence clause if present
      if (confidenceLabel && confidenceLabel.toLowerCase().includes('low confidence')) {
        sentence += ` ${confidenceLabel}`
      }
      
      return sentence
    }
  }
  
  // Fallback: Use explicit V2 field or parse from description
  const explicit = (props.insight as any).whatsHappening
  if (explicit && typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim()
  }
  
  const summary = description.value
  if (!summary) return ''
  
  const whyIndex = summary.toLowerCase().indexOf('why it matters')
  if (whyIndex > 0) {
    return summary.substring(0, whyIndex).trim().replace(/\.$/, '')
  }
  
  const firstSentence = summary.split(/[.!?]/)[0].trim()
  return firstSentence || summary
})

// Helper to get metric name for display (used in whatsHappeningForDisplay)
function getMetricNameForDisplay(metricId: string): string {
  const idLower = metricId.toLowerCase()
  if (idLower.includes('commits-per-session')) return 'commits per session'
  if (idLower.includes('active-coding-time')) return 'active coding time'
  if (idLower.includes('ai-suggestions-accepted')) return 'AI suggestions accepted'
  if (idLower.includes('average-session-length')) return 'average session length'
  if (idLower.includes('time-to-first-commit') || idLower.includes('ttfc')) return 'time to first commit'
  return 'metric'
}

const whyItMatters = computed(() => {
  // PHASE 3: Use enhanced definition for Review & Merge PIs, otherwise fall back to explicit field
  const isReviewMerge = props.insight.cicdStage === 'review-merge'
  
  // For Review & Merge PIs, use enhanced definition field
  if (isReviewMerge && (props.insight as any).definition) {
    const enhancedDefinition = (props.insight as any).definition
    if (import.meta.env.DEV) {
      console.log('[PHASE1_DEBUG] Using enhanced definition for Review & Merge PI', props.insight.metricId, ':', enhancedDefinition.substring(0, 100))
    }
    return enhancedDefinition.trim()
  }
  
  // For other PIs, use explicit whyItMatters field
  const explicit = (props.insight as any).whyItMatters
  if (explicit && typeof explicit === 'string' && explicit.trim()) {
    if (import.meta.env.DEV) {
      console.log('[PHASE1_DEBUG] Using explicit whyItMatters for', props.insight.metricId, ':', explicit.substring(0, 100))
    }
    return explicit.trim()
  }
  
  // Debug: Log if both definition and whyItMatters are missing
  if (import.meta.env.DEV) {
    const v2PlanCodeIds = [
      'commits-per-session-by-ide',
      'active-coding-time-by-ide',
      'ai-suggestions-accepted-by-ide',
      'average-session-length-by-ide',
      'time-to-first-commit-by-ide'
    ];
    const isPlanCodeInsight = props.insight.metricId && v2PlanCodeIds.includes(props.insight.metricId);
    if (isPlanCodeInsight) {
      console.warn('[PHASE1_DEBUG] Both definition and whyItMatters MISSING for', props.insight.metricId, '- will use fallback')
    }
  }
  
  // Fallback: Parse from description (V1 legacy behavior)
  const summary = description.value
  if (!summary) return ''
  
  // Try to extract "Why it matters" section
  const whyIndex = summary.toLowerCase().indexOf('why it matters')
  if (whyIndex >= 0) {
    const afterWhy = summary.substring(whyIndex + 'why it matters'.length).trim()
    // Remove "Why it matters:" prefix if present
    const cleaned = afterWhy.replace(/^:\s*/, '').trim()
    // Take first sentence
    const firstSentence = cleaned.split(/[.!?]/)[0].trim()
    return firstSentence || cleaned
  }
  
  // If no "Why it matters" marker, try to get second sentence
  const sentences = summary.split(/[.!?]/).filter((s: string) => s.trim())
  if (sentences.length > 1) {
    return sentences[1].trim()
  }
  
  return ''
})

// FINAL HARDENING: Helper to check if insight is V2 (Plan & Code or Review & Merge)
const V2_INSIGHT_IDS = [
  // Plan & Code
  'commits-per-session-by-ide',
  'active-coding-time-by-ide',
  'ai-suggestions-accepted-by-ide',
  'average-session-length-by-ide',
  'time-to-first-commit-by-ide',
  // Review & Merge
  'pr-cycle-time-by-ide',
  'revert-rate-by-ide',
  'pr-size-by-ide',
  'pr-review-cycles-by-ide',
  'session-conditioned-pr-cycle-time-ai-vs-non-ai',
  'review-latency-spike-by-ide',
  'pr-cycle-time-bottleneck-by-ide'
] as const;

function isV2Insight(metricId?: string): boolean {
  return metricId ? V2_INSIGHT_IDS.includes(metricId as any) : false;
}

// PHASE 5: Confidence label for display (especially TTFC low-confidence)
const confidenceLabelForDisplay = computed(() => {
  const isV2 = isV2Insight(props.insight.metricId);
  
  if (isV2) {
    const confidenceLabel = (props.insight as any).confidenceLabel;
    if (confidenceLabel && typeof confidenceLabel === 'string' && confidenceLabel.trim()) {
      return confidenceLabel.trim();
    }
  }
  return null;
})

const DEFAULT_EVIDENCE_VISIBLE = 4 // PHASE 2: Show top 3-4 most relevant items by default

// FINAL HARDENING: Evidence ranking - PRIMARY (IDE values) vs SECONDARY (metadata)
function evidenceRank(ev: { label?: string; value?: any }, metricId?: string, displayWinnerLabel?: string): number {
  const label = String(ev.label || '').trim().toLowerCase();
  const value = String(ev.value || '').trim();
  
  // PRIMARY EVIDENCE (100-90): IDE breakdown values tied to the metric
  // Winner always highest
  if (displayWinnerLabel && label === displayWinnerLabel.toLowerCase()) {
    return 100; // Winner always highest
  }
  
  // Other IDE values (runner-up, third, etc.) - PRIMARY EVIDENCE
  const ideNames = ['cursor', 'vscode', 'windsurf', 'jetbrains', 'sublime', 'vim'];
  if (ideNames.some(ide => label === ide || label.includes(ide))) {
    // Check if value is metric-relevant (has unit like commits/session, min per session, assists per session, duration)
    const hasMetricUnit = value.includes('commits/session') || 
                          value.includes('min per session') || 
                          value.includes('assists per session') ||
                          value.includes('h ') || // hours
                          value.includes('m') || // minutes
                          /^\d+h \d+m$/.test(value); // formatted duration
    
    if (hasMetricUnit) {
      return 90; // Runner-up/other IDEs with metric units
    }
    // If it's an IDE but value doesn't have metric unit, still rank it high (will be formatted)
    return 85;
  }
  
  // SECONDARY EVIDENCE (50-10): Metadata - shown under "Show more"
  // Time window / period range
  if (label.includes('time range') || label.includes('time window') || label.includes('period range') || label.includes('weeks in band')) {
    return 50;
  }
  
  // Coverage and signal metadata (lowest priority - always secondary)
  const metadataLabels = ['coverage', 'signal coverage', 'data sources', 'data maturity', 'contributing units', 'points', 'samples', 'n', 'telemetry source', 'signals used', 'sessions by ide', 'telemetry points'];
  if (metadataLabels.some(meta => label.includes(meta))) {
    return 10; // Always secondary
  }
  
  // "Metric" label is forbidden - should be replaced, but if it exists, rank it low
  if (label === 'metric' || label === 'measure') {
    return 5; // Very low - should be filtered or replaced
  }
  
  // Default: medium-low priority (likely secondary)
  return 30;
}

// PHASE 2: Evidence visibility - top-first, relevant-first, metadata-last
const showAllEvidence = ref(false)
const visibleEvidence = computed(() => {
  if (!props.insight.evidence || props.insight.evidence.length === 0) {
    if (import.meta.env.DEV) {
      console.log('[PHASE2_DEBUG] No evidence for', props.insight.metricId)
    }
    return []
  }
  
  // PHASE 2 DEBUG: Log incoming evidence
  if (import.meta.env.DEV) {
    const v2PlanCodeIds = [
      'commits-per-session-by-ide',
      'active-coding-time-by-ide',
      'ai-suggestions-accepted-by-ide',
      'average-session-length-by-ide',
      'time-to-first-commit-by-ide'
    ];
    const isPlanCodeInsight = props.insight.metricId && v2PlanCodeIds.includes(props.insight.metricId);
    if (isPlanCodeInsight) {
      console.log('[PHASE2_DEBUG_INCOMING] Evidence for', props.insight.metricId, ':', props.insight.evidence.map((e: any) => ({ label: e.label, value: e.value })))
    }
  }

  // MVP-FAST: Deterministic evidence dedupe for Plan & Code insights
  const v2PlanCodeIds = [
    'commits-per-session-by-ide',
    'active-coding-time-by-ide', 
    'ai-suggestions-accepted-by-ide',
    'average-session-length-by-ide',
    'time-to-first-commit-by-ide',
    'rework-rate-by-ide'
  ];
  const isPlanCodeInsight = props.insight.metricId && v2PlanCodeIds.includes(props.insight.metricId);
  
  let filtered = props.insight.evidence;
  
  if (isPlanCodeInsight) {
    // Group by label and dedupe
    const grouped = filtered.reduce((acc: Record<string, any[]>, item) => {
      const label = String(item.label || '').toLowerCase().trim();
      if (!acc[label]) acc[label] = [];
      acc[label].push(item);
      return acc;
    }, {});
    
    // For each label, pick the best entry
    filtered = Object.entries(grouped).map(([label, entries]) => {
      // Prefer unit-bearing strings (contains letters or specific tokens)
      const unitBearing = entries.find((e: any) => {
        const value = String(e.value || '');
        return /[a-zA-Z]/.test(value) || 
               /min|h|commits|assists|\/session|per week|cycles|days|hours/.test(value);
      });
      
      if (unitBearing) return unitBearing;
      
      // Prefer numeric over percent strings
      const numeric = entries.find((e: any) => typeof e.value === 'number');
      if (numeric) return numeric;
      
      // Fallback to first entry
      return entries[0];
    });
    
    if (import.meta.env.DEV && isPlanCodeInsight) {
      console.log('[PHASE2_DEBUG_DEDUPE] After dedupe for', props.insight.metricId, ':', filtered.map((e: any) => ({ label: e.label, value: e.value })))
    }
  }

  const isV2 = isV2Insight(props.insight.metricId);
  const isTTFC = props.insight.metricId === 'time-to-first-commit-by-ide';
  const displayWinnerLabel = (props.insight as any).displayWinnerLabel;
  const confidenceLabel = (props.insight as any).confidenceLabel;
  const hasLowConfidence = confidenceLabel && confidenceLabel.toLowerCase().includes('low confidence');
  
  // Store original count for debug
  const originalCount = filtered.length;
  
  if (isV2) {
    // PHASE 2: Filter strategy - default view shows top IDE values, "Show all" reveals everything
    // Default view: Only filter out truly noisy metadata
    // Show all: Keep everything except orphan numbers
    const ideNames = ['cursor', 'vscode', 'windsurf', 'jetbrains', 'sublime', 'vim'];
    
    // Default view: Filter out diagnostic/metadata rows, show only tool breakdowns
    // Show all: Keep everything (filtering happens later for orphan numbers only)
    if (!showAllEvidence.value) {
      // CHECKPOINT 1: Hide diagnostics by default - show only tool rows
      const diagnosticLabels = [
        'coverage', 'signal coverage', 'time range', 'time window', 'period range', 'weeks in band',
        'points', 'telemetry source', 'signals used', 'data sources', 'data maturity', 'measure', 'range', 'n', 
        'sessions', 'sessions by ide', 'telemetry points', 'metric', 'value'
      ];
      
      filtered = filtered.filter(ev => {
        const label = String(ev.label || '').trim().toLowerCase();
        const value = String(ev.value || '').trim();
        
        // Always keep IDE tool names (PRIMARY evidence)
        const ideNames = ['cursor', 'vscode', 'windsurf', 'jetbrains', 'sublime', 'vim'];
        if (ideNames.some(ide => label === ide)) {
          return true;
        }
        
        // Filter out all diagnostic/metadata labels
        return !diagnosticLabels.some(diagnostic => label.includes(diagnostic));
      });
    }
    // In "Show all" mode, don't filter here - keep everything and filter only orphan numbers later
    
    // PHASE 2 DEBUG: Log after noise filter
    if (import.meta.env.DEV) {
      console.log('[PHASE2_DEBUG_AFTER_NOISE_FILTER]', {
        mode: showAllEvidence.value ? 'SHOW ALL' : 'DEFAULT',
        originalCount,
        afterNoiseFilter: filtered.length,
        items: filtered.map((ev: any) => ({ label: ev.label, value: ev.value }))
      });
    }
    
    // FINAL HARDENING: TTFC low-confidence special rules
    // PRIMARY evidence: Only winner IDE
    // Hide deltas in PRIMARY KPI (handled in primaryKPIDelta computed)
    // Show confidence label under "What's happening" (already handled)
    if (isTTFC && hasLowConfidence && !showAllEvidence.value) {
      // DEFAULT VIEW: Only winner IDE in PRIMARY evidence
      filtered = filtered.filter(ev => {
        const label = String(ev.label || '').toLowerCase();
        
        // Always show winner
        if (displayWinnerLabel && label === displayWinnerLabel.toLowerCase()) {
          return true;
        }
        
        // Hide all other IDE values in default view (low confidence - only show winner)
        const ideNames = ['cursor', 'vscode', 'windsurf', 'jetbrains'];
        if (ideNames.some(ide => label === ide)) {
          return false; // Hide runner-up and others in default view
        }
        
        // Keep Coverage for context
        if (label === 'coverage') {
          return true;
        }
        
        // Hide everything else in default view
        return false;
      });
    }
    // In "Show all" mode, show everything (PRIMARY + SECONDARY) even for TTFC low-confidence
    
    // FINAL HARDENING: Rank and sort evidence - PRIMARY first, then SECONDARY
    filtered = filtered.map(ev => {
      const rank = evidenceRank(ev, props.insight.metricId, displayWinnerLabel);
      // Debug: Log ranking
      if (import.meta.env.DEV) {
        console.log('[FINAL_HARDENING_RANK]', ev.label, '-> rank:', rank, rank >= 85 ? '(PRIMARY)' : '(SECONDARY)');
      }
      return {
        ...ev,
        _rank: rank,
        _isPrimary: rank >= 85 // PRIMARY: IDE values (85-100), SECONDARY: Metadata (10-50)
      };
    });
    
    // Sort by rank (descending) - PRIMARY evidence (100-85) first, then SECONDARY (50-10)
    filtered.sort((a, b) => {
      // First by rank (PRIMARY before SECONDARY)
      const aRank = (a as any)._rank ?? 0;
      const bRank = (b as any)._rank ?? 0;
      if (bRank !== aRank) {
        return bRank - aRank;
      }
      
      // If same rank and both are IDEs (PRIMARY), sort by value (descending)
      const aLabel = String(a.label || '').toLowerCase();
      const bLabel = String(b.label || '').toLowerCase();
      const ideNames = ['cursor', 'vscode', 'windsurf', 'jetbrains'];
      
      if (ideNames.includes(aLabel) && ideNames.includes(bLabel)) {
        // Extract numeric value for comparison
        const aVal = parseFloat(String(a.value || '').replace(/[^0-9.-]/g, '')) || 0;
        const bVal = parseFloat(String(b.value || '').replace(/[^0-9.-]/g, '')) || 0;
        return bVal - aVal; // Descending (highest first)
      }
      
      // Preserve original order for same rank
      return 0;
    });
    
    // FINAL HARDENING: Separate PRIMARY and SECONDARY (keep rank for now)
    // We'll use these after orphan filter
    // Note: We'll separate again after orphan filter to ensure consistency
    
    // PHASE 2: Filter out orphan numbers (values without units)
    // BUT: Always keep IDE values - format them with units if needed
    // In "Show all" mode, be more lenient - keep items with labels even if value is raw number
    filtered = filtered.filter(ev => {
      const value = String(ev.value || '').trim();
      const label = String(ev.label || '').trim().toLowerCase();
      
      if (!value || value === '0' || value === '0.0') return false;
      
      // PHASE 2: IDE values should always be kept (they will be formatted with units in display)
      const ideNames = ['cursor', 'vscode', 'windsurf', 'jetbrains', 'sublime', 'vim'];
      if (ideNames.includes(label)) {
        // IDE values will be formatted with units by formatEvidenceValueForExpanded
        // Keep them even if they're raw numbers now
        return true;
      }
      
      // In "Show all" mode, keep items with meaningful labels even if value needs formatting
      if (showAllEvidence.value) {
        // Keep items with labels that indicate they're metadata (Coverage, Time range, etc.)
        const meaningfulLabels = ['coverage', 'time range', 'time window', 'telemetry source', 'signals used', 'sessions by ide', 'telemetry points', 'weeks in band', 'points'];
        if (meaningfulLabels.some(ml => label.includes(ml))) {
          return true; // Keep these even if value is raw number - will be formatted
        }
        // In "Show all" mode, be more lenient - keep items with descriptive labels
        // Even if value is a raw number, if the label provides context, keep it
        if (label.length > 3 && !/^\d+$/.test(label)) {
          // Label is descriptive (not just a number) - keep it
          return true;
        }
      }
      
      // For non-IDE values, check for units
      const hasUnit = /[a-zA-Z%]/.test(value) || 
                     value.includes('/') || 
                     value.includes('per') ||
                     value.includes('h ') ||
                     value.includes('m') ||
                     value.includes('min') ||
                     value.includes('sec');
      
      if (!hasUnit && /^\d+(\.\d+)?$/.test(value)) {
        // Debug: Log what we're filtering out
        if (import.meta.env.DEV) {
          console.log('[PHASE2_DEBUG_FILTER] Filtering out orphan number:', { label, value, showAllMode: showAllEvidence.value });
        }
        // In default view, filter out orphan numbers; in "Show all", be more lenient
        if (!showAllEvidence.value) {
          return false; // Hide orphan numbers in default view
        }
        // In "Show all" mode, only filter if label is also meaningless (just a number)
        // If label provides context, keep it (handled above)
        return false; // Filter pure numbers without meaningful labels
      }
      
      return true;
    });
    
    // PHASE 2 DEBUG: Log after orphan filter
    if (import.meta.env.DEV && isV2Insight(props.insight.metricId)) {
      console.log('[PHASE2_DEBUG_AFTER_ORPHAN_FILTER]', filtered.map((ev: any) => ({ label: ev.label, value: ev.value, isPrimary: (ev as any)._isPrimary })));
    }
    
    // FINAL HARDENING: Separate PRIMARY and SECONDARY after all filtering
    // PRIMARY: IDE values (rank >= 85), SECONDARY: Metadata (rank < 85)
    const primaryEvidenceFiltered = filtered.filter((ev: any) => (ev as any)._isPrimary === true);
    const secondaryEvidenceFiltered = filtered.filter((ev: any) => (ev as any)._isPrimary === false);
    
    // Remove rank and isPrimary properties from both
    const primaryEvidence = primaryEvidenceFiltered.map(({ _rank, _isPrimary, ...ev }) => ev);
    const secondaryEvidence = secondaryEvidenceFiltered.map(({ _rank, _isPrimary, ...ev }) => ev);
    
    // FINAL HARDENING: Default view = PRIMARY evidence only (max 4 IDE values)
    // "Show all" reveals SECONDARY evidence (metadata) as well
    const result = showAllEvidence.value 
      ? [...primaryEvidence, ...secondaryEvidence] // Show all: PRIMARY + SECONDARY
      : primaryEvidence.slice(0, DEFAULT_EVIDENCE_VISIBLE); // Default: PRIMARY only (max 4)
    
    // Debug: Log final separation
    if (import.meta.env.DEV) {
      console.log('[FINAL_HARDENING_SEPARATION]', {
        mode: showAllEvidence.value ? 'SHOW ALL' : 'DEFAULT',
        primaryCount: primaryEvidence.length,
        secondaryCount: secondaryEvidence.length,
        visible: result.length,
        primary: primaryEvidence.map((ev: any) => ({ label: ev.label, value: ev.value })),
        secondary: secondaryEvidence.map((ev: any) => ({ label: ev.label, value: ev.value }))
      });
    }
    
    return result;
  }

  // Non-Plan & Code insights: use all filtered evidence
  const result = showAllEvidence.value ? filtered : filtered.slice(0, DEFAULT_EVIDENCE_VISIBLE)
  
  return result
})

// PHASE 2: Count of filtered evidence (for "Show all" button) - uses same filtering logic as visibleEvidence
// This counts ALL filtered evidence items (not just visible ones)
const filteredEvidenceCount = computed(() => {
  if (!props.insight.evidence || props.insight.evidence.length === 0) return 0
  
  const isV2 = isV2Insight(props.insight.metricId);
  const isTTFC = props.insight.metricId === 'time-to-first-commit-by-ide';
  const displayWinnerLabel = (props.insight as any).displayWinnerLabel;
  const confidenceLabel = (props.insight as any).confidenceLabel;
  const hasLowConfidence = confidenceLabel && confidenceLabel.toLowerCase().includes('low confidence');
  
  let filtered = props.insight.evidence;
  
  if (isV2Insight(props.insight.metricId)) {
    // Count uses "Show all" mode filtering (less aggressive) - count what would be available in "Show all"
    // Don't filter noise labels here - only filter orphan numbers
    const ideNames = ['cursor', 'vscode', 'windsurf', 'jetbrains', 'sublime', 'vim'];
    
    // Don't apply TTFC low-confidence filter for counting - count everything that would be available in "Show all"
    
    // Filter orphan numbers (but keep IDE values and meaningful metadata)
    filtered = filtered.filter(ev => {
      const value = String(ev.value || '').trim();
      const label = String(ev.label || '').trim().toLowerCase();
      
      if (!value || value === '0' || value === '0.0') return false;
      
      // Always keep IDE values
      if (ideNames.includes(label)) {
        return true;
      }
      
      // Keep items with meaningful labels (Coverage, Time range, Telemetry source, etc.)
      const meaningfulLabels = ['coverage', 'time range', 'time window', 'telemetry source', 'signals used', 'sessions by ide', 'telemetry points', 'weeks in band', 'points'];
      if (meaningfulLabels.some(ml => label.includes(ml))) {
        return true; // Keep these even if value is raw number
      }
      
      // Keep items with descriptive labels (not just numbers)
      if (label.length > 3 && !/^\d+$/.test(label)) {
        return true; // Label is descriptive - keep it
      }
      
      // For non-IDE values, check for units
      const hasUnit = /[a-zA-Z%]/.test(value) || value.includes('/') || value.includes('per') || value.includes('h ') || value.includes('m') || value.includes('min') || value.includes('sec');
      if (!hasUnit && /^\d+(\.\d+)?$/.test(value)) {
        // Pure number without unit and without meaningful label - filter it
        return false;
      }
      return true;
    });
  }
  
  const count = filtered.length;
  
  // Debug: Log count for troubleshooting
  if (import.meta.env.DEV && isV2Insight(props.insight.metricId)) {
    console.log('[PHASE2_DEBUG_COUNT] Filtered evidence count for', props.insight.metricId, ':', count, '(DEFAULT_VISIBLE:', DEFAULT_EVIDENCE_VISIBLE, ', will show button:', count > DEFAULT_EVIDENCE_VISIBLE, ')');
  }
  
  return count;
})

// FINAL HARDENING: Check if SECONDARY evidence exists (for "Show all" button visibility)
const hasSecondaryEvidence = computed(() => {
  if (!props.insight.evidence || props.insight.evidence.length === 0) return false
  
  const isV2 = isV2Insight(props.insight.metricId);
  if (!isV2) return filteredEvidenceCount.value > DEFAULT_EVIDENCE_VISIBLE;
  
  // For Plan & Code, check if SECONDARY evidence (diagnostics) exists
  const ideNames = ['cursor', 'vscode', 'windsurf', 'jetbrains', 'sublime', 'vim'];
  const diagnosticLabels = [
    'coverage', 'signal coverage', 'time range', 'time window', 'period range', 'weeks in band',
    'points', 'telemetry source', 'signals used', 'data sources', 'data maturity', 'measure', 'range', 'n', 
    'sessions', 'sessions by ide', 'telemetry points', 'metric', 'value'
  ];
  
  const hasSecondary = props.insight.evidence.some((ev: any) => {
    const label = String(ev.label || '').trim().toLowerCase();
    const value = String(ev.value || '').trim();
    
    if (!value || value === '0' || value === '0.0') return false;
    if (ideNames.includes(label)) return false; // PRIMARY, not SECONDARY
    if (label === 'metric' || label === 'measure') return false; // Forbidden
    
    // Check if it's diagnostic metadata (SECONDARY)
    return diagnosticLabels.some(diagnostic => label.includes(diagnostic));
  });
  
  return hasSecondary;
})

// PHASE 5: Primary KPI from collapsed row (displayValue/displayDelta) - single source of truth
const primaryKPIValue = computed(() => {
  const isV2 = isV2Insight(props.insight.metricId);
  
  if (isV2) {
    // Use displayValue from collapsed row (source of truth)
    const displayValue = (props.insight as any).displayValue;
    if (displayValue && typeof displayValue === 'string' && displayValue.trim()) {
      return displayValue.trim();
    }
  }
  return null;
});

const primaryKPILabel = computed(() => {
  const isV2 = isV2Insight(props.insight.metricId);
  
  if (isV2) {
    const displayWinnerLabel = (props.insight as any).displayWinnerLabel;
    if (displayWinnerLabel) {
      return displayWinnerLabel.charAt(0).toUpperCase() + displayWinnerLabel.slice(1);
    }
  }
  return 'Value';
});

const primaryKPIDelta = computed(() => {
  const isV2 = isV2Insight(props.insight.metricId);
  const isTTFC = props.insight.metricId === 'time-to-first-commit-by-ide';
  const confidenceLabel = (props.insight as any).confidenceLabel;
  const hasLowConfidence = confidenceLabel && confidenceLabel.toLowerCase().includes('low confidence');
  
  // PHASE 5: TTFC low-confidence mode - don't show delta
  if (isTTFC && hasLowConfidence) {
    return null;
  }
  
  if (isV2) {
    // Use displayDelta from collapsed row (source of truth)
    const displayDelta = (props.insight as any).displayDelta;
    if (displayDelta && typeof displayDelta === 'string' && displayDelta.trim()) {
      return displayDelta.trim();
    }
  }
  return null;
});

// Compute primary evidence if not provided (fallback for non-Plan & Code insights)
const primaryEvidence = computed(() => {
  // PHASE 5: For Plan & Code insights, don't use primaryEvidence (use displayValue instead)
  const isV2 = isV2Insight(props.insight.metricId);
  if (isV2) {
    return []; // Don't show primaryEvidence for Plan & Code - use displayValue instead
  }
  
  if (props.primaryEvidence) return props.primaryEvidence
  
  // Convert to PerformanceInsight-like format for extractPrimaryEvidence
  try {
    const perfInsight: any = {
      id: props.insight.id,
      title: props.insight.title,
      description: props.insight.description || props.insight.summary || props.insight.title,
      evidence: props.insight.evidence || []
    }
    return extractPrimaryEvidence(perfInsight)
  } catch (error) {
    console.warn('[InsightExpandedPanel] Error extracting primary evidence:', error)
    return props.insight.evidence?.slice(0, 2) || []
  }
})

// Scope badge (IDE/Org)
const scopeBadge = computed(() => {
  if (props.insight.scope === 'tool' && props.insight.entityId) {
    // Try to extract IDE name from entityId or tags
    const tags = props.insight.tags || []
    const ideTag = tags.find((t: string) => ['cursor', 'vscode', 'windsurf', 'jetbrains', 'sublime', 'vim'].includes(t.toLowerCase()))
    if (ideTag) {
      return ideTag.charAt(0).toUpperCase() + ideTag.slice(1)
    }
    return props.insight.entityId
  }
  if (props.insight.scope === 'org') {
    return 'Org'
  }
  return null
})

// Source badge (LIVE/HYBRID/SIM)
const sourceBadge = computed(() => {
  if (!props.insight.dataSource) return null
  
  const source = props.insight.dataSource.toLowerCase()
  if (source === 'real' || source === 'observed') return 'LIVE'
  if (source === 'mixed') return 'HYBRID'
  if (source === 'simulated') return 'SIM'
  
  return null
})

// Extract verification hint from action text
const verificationHint = computed(() => {
  const action = actionText.value?.toLowerCase() || ''
  if (action.includes('next week') || action.includes('verify') || action.includes('re-check') || action.includes('track')) {
    return 'Verify next week'
  }
  
  return null
})

// Check if insight has correlation evidence (r value)
const hasCorrelationEvidence = computed(() => {
  if (!props.insight.evidence || props.insight.evidence.length === 0) return false
  return props.insight.evidence.some((ev: any) => {
    const label = String(ev.label || '').toLowerCase()
    return label.includes('r)') || label.includes('correlation') || label.includes('pearson r')
  })
})

// Check if description already includes correlation disclaimer (to avoid duplication)
const descriptionIncludesCorrelationNote = computed(() => {
  const desc = String(description.value || '').toLowerCase()
  return desc.includes('correlation only') || desc.includes('directional, not causal') || desc.includes('correlation ≠ causation') || desc.includes('validate by comparing')
})

// Signal type label for Review & Merge insights (expanded-only)
const signalTypeLabel = computed(() => {
  const stage = (props.insight as any)?.cicdStage
  if (stage !== 'review-merge') return null
  
  const title = String(props.insight?.title || '').toLowerCase()
  const tool = props.insight?.related?.tools?.[0]
  
  // Windsurf throughput = primary signal
  if (tool && (tool.toLowerCase() === 'windsurf' || tool.toLowerCase() === 'wind')) {
    if (title.includes('throughput') || title.includes('cycle time') || title.includes('time-to-merge')) {
      return 'Primary signal'
    }
    // Windsurf reopen = tradeoff
    if (title.includes('reopen')) {
      return 'Tradeoff'
    }
  }
  
  return null
})

// Net effect line for Windsurf throughput/reopen pair (expanded-only)
const netEffectLine = computed(() => {
  const stage = (props.insight as any)?.cicdStage
  if (stage !== 'review-merge') return null
  
  const title = String(props.insight?.title || '').toLowerCase()
  const tool = props.insight?.related?.tools?.[0]
  
  // Show net effect on the throughput insight
  if (tool && (tool.toLowerCase() === 'windsurf' || tool.toLowerCase() === 'wind')) {
    if (title.includes('throughput') || title.includes('cycle time') || title.includes('time-to-merge')) {
      return 'Net effect: faster iteration inside the IDE may be offset by slower merge completion.'
    }
  }
  
  return null
})

function formatEvidenceLabel(label?: string, value?: any, metricId?: string): string {
  const l = String(label ?? '').trim()
  if (!l) return ''
  const key = l.toLowerCase()

  // FINAL HARDENING: "Metric" label is FORBIDDEN - replace with actual metric name
  if (key === 'metric' || key === 'measure') {
    // Use metricId to determine actual metric name
    const metricLower = String(metricId || '').toLowerCase()
    if (metricLower.includes('commits-per-session')) return 'Commits per session'
    if (metricLower.includes('ai-suggestions-accepted')) return 'AI suggestions accepted per session'
    if (metricLower.includes('active-coding-time')) return 'Active coding time per session'
    if (metricLower.includes('average-session-length')) return 'Average session length'
    if (metricLower.includes('time-to-first-commit') || metricLower.includes('ttfc')) return 'Time to first commit'
    
    // Fallback: Try to infer from value
    const valueStr = String(value || '').trim()
    if (valueStr.includes('commits/session')) return 'Commits per session'
    if (valueStr.includes('assists per session')) return 'AI suggestions accepted per session'
    if (valueStr.includes('min per session')) return 'Active coding time per session'
    if (valueStr.includes('h ') && valueStr.includes('m')) return 'Average session length'
    if (valueStr.includes('min') && !valueStr.includes('per')) return 'Time to first commit'
    
    return 'Value' // Last resort fallback
  }

  // Expand abbreviations for expanded view
  if (key === 'stdev' || key.includes('stdev')) return 'Standard deviation'
  if (key === 'cfr' || key.includes('cfr') || key.includes('change failure rate')) return 'Change failure rate'
  if (key.includes('mttr') || key.includes('mean time to recover')) return 'Mean time to recover'
  
  // Replace "Weeks in band" with "Time range" for expanded view
  if (key.includes('weeks in band') || (key.includes('weeks') && key.includes('band'))) {
    return 'Time range'
  }
  
  // Remove redundant scope like "(org)"
  let cleaned = l.replace(/\s*\(org\)\s*/gi, '').trim()

  if (key === 'tools tracked') {
    const n = (typeof value === 'number')
      ? value
      : (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value)))
        ? Number(value)
        : null
    if (n !== null && isFinite(n) && n > 3) return 'IDEs + sources tracked'
    return 'IDEs tracked'
  }
  
  return cleaned
}

function formatValue(label: string, value: any, metricId?: string): string {
  // Use shared formatter - for expanded view, prefer decimals for CFR
  const preferDecimals = label.toLowerCase().includes('cfr') || label.toLowerCase().includes('change failure rate')
  
  // Handle "Time range" label specially for expanded view
  const labelLower = String(label ?? '').toLowerCase()
  if (labelLower.includes('time range')) {
    const numForTime = (typeof value === 'number')
      ? value
      : (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value)))
        ? Number(value)
        : null
    if (numForTime !== null && isFinite(numForTime) && numForTime > 0) {
      return `last ${Math.round(numForTime)} weeks`
    }
  }
  
  return formatEvidenceValueTyped(label, value, metricId || props.insight.metricId, preferDecimals)
}

/**
 * PHASE 3: Format evidence value for expanded view
 * Ensures values from breakdownByTool (already formatted) are used as-is
 * Removes "/period" and normalizes to match collapsed row units
 */
function formatEvidenceValueForExpanded(ev: { label?: string; value?: any }, metricId?: string): string {
  const value = ev.value;
  const label = String(ev.label || '').trim();
  let valueStr = String(value || '').trim();
  
  // PHASE 3: Remove "/period" and replace with normalized units
  if (valueStr.includes('/period')) {
    const metricLower = String(metricId || '').toLowerCase();
    if (metricLower.includes('ai-suggestions') || metricLower.includes('assists')) {
      valueStr = valueStr.replace('/period', ' per week');
    } else if (metricLower.includes('active-coding-time')) {
      valueStr = valueStr.replace('/period', ' per week');
    } else {
      valueStr = valueStr.replace('/period', ' per week'); // Default to per week
    }
  }
  
  // PHASE 3: If value is already a formatted string with unit (from breakdownByTool), use it as-is
  // breakdownByTool values are formatted like "3.1 commits/session", "27.5 min per week", "4h 27m"
  if (valueStr && /[a-zA-Z%]/.test(valueStr)) {
    // Already has unit or formatting - use as-is (after /period replacement)
    return valueStr;
  }
  
  // PHASE 3: If it's a raw number, format it based on metric type to ensure units
  const num = typeof value === 'number' 
    ? value 
    : (typeof value === 'string' && isFinite(Number(valueStr))) 
      ? Number(valueStr) 
      : null;
  
  if (num === null || !isFinite(num)) {
    return valueStr || '--';
  }
  
  // PHASE 3: Format based on metric type to ensure units (match collapsed row format)
  const metricLower = String(metricId || '').toLowerCase();
  const labelLower = label.toLowerCase();
  
  // Duration metrics - format as Xh Ym
  // For average session length, values are typically in hours (5, 4)
  // For time-to-first-commit, values are typically in minutes
  if (metricLower.includes('session-length')) {
    // Average session length: values are in hours
    if (num >= 1) {
      const h = Math.floor(num);
      const m = Math.round((num - h) * 60);
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    // If less than 1 hour, show as minutes
    return `${Math.round(num * 60)}m`;
  }
  
  if (metricLower.includes('time-to-first-commit') || metricLower.includes('ttfc')) {
    // Time to first commit: values are in minutes
    if (num >= 60) {
      const h = Math.floor(num / 60);
      const m = Math.round(num % 60);
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${Math.round(num)}m`;
  }
  
  // FINAL HARDENING: Unit consistency - must match collapsed row units
  // AI assists - always "assists per session" (matches collapsed row)
  if (metricLower.includes('ai-suggestions') || metricLower.includes('assists')) {
    return `${num.toFixed(1)} assists per session`;
  }
  
  // Commits - always "commits/session" (matches collapsed row)
  if (metricLower.includes('commits-per-session') || labelLower.includes('commit')) {
    return `${num.toFixed(1)} commits/session`;
  }
  
  // Active coding time - always "min per session" (matches collapsed row)
  if (metricLower.includes('active-coding-time') || labelLower.includes('coding time')) {
    return `${num.toFixed(1)} min per session`;
  }
  
  // Default: return as-is (shouldn't happen for Plan & Code insights)
  return valueStr;
}

function formatMinutesAsHoursMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

function formatRelatedSignalValue(ctx: any): string {
  const evs = (ctx?.evidence || []) as Array<{ label?: string; value?: any }>
  if (!Array.isArray(evs) || evs.length === 0) return ''

  const numeric = evs.filter(e => {
    if (e?.value === undefined || e?.value === null) return false
    if (typeof e.value === 'number') return isFinite(e.value)
    if (typeof e.value === 'string') {
      const s = e.value.trim()
      if (!s) return false
      const pct = s.endsWith('%') ? s.slice(0, -1) : s
      return isFinite(Number(pct))
    }
    return false
  })
  if (numeric.length === 0) return ''

  const best = numeric[0]
  const label = formatEvidenceLabel(best.label, best.value)
  const value = formatValue(label, best.value, ctx?.metricId)
  if (!label || !value) return ''
  return `${label}: ${value}`
}

function getSeverityLabel(): string {
  const severity = props.insight.severity?.toLowerCase() || 'info'
  const labels: Record<string, string> = {
    'critical': 'Critical',
    'risk': 'Risk',
    'warning': 'Warning',
    'lowlight': 'Monitor',
    'opportunity': 'Opportunity',
    'highlight': 'Strong',
    'info': 'Info'
  }
  return labels[severity] || 'Info'
}

function getSeverityBadgeClass(): string {
  const severity = props.insight.severity?.toLowerCase() || 'info'
  const classes: Record<string, string> = {
    'critical': 'bg-danger text-white',
    'high': 'bg-warning text-dark',
    'moderate': 'bg-info text-white',
    'watchlist': 'bg-secondary text-white',
    'risk': 'bg-danger text-white',
    'warning': 'bg-warning text-dark',
    'lowlight': 'bg-warning-subtle text-warning',
    'opportunity': 'bg-primary-subtle text-primary',
    'highlight': 'bg-success-subtle text-success',
    'info': 'bg-info-subtle text-info'
  }
  return classes[severity] || 'bg-secondary-subtle text-secondary'
}

function getSeverityAccentClass(): string {
  const severity = props.insight.severity?.toLowerCase() || 'info'
  return `insight-expanded-panel--${severity}`
}

function getSourceBadgeClass(): string {
  if (!sourceBadge.value) return ''
  
  const source = sourceBadge.value.toLowerCase()
  if (source === 'live') return 'bg-success-subtle text-success'
  if (source === 'hybrid') return 'bg-info-subtle text-info'
  if (source === 'sim') return 'bg-secondary-subtle text-secondary'
  
  return ''
}
</script>

<style scoped>
.insight-expanded-panel {
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.75rem 0;
  margin-top: 0;
  margin-bottom: 0;
  margin-left: 0;
  margin-right: 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  position: relative;
  overflow-wrap: anywhere;
  word-break: break-word;
  width: 100%;
  max-width: none;
  box-sizing: border-box;
}

/* Add side padding back only for strip variant */
.insight-expanded-panel--strip {
  padding-left: 0.55rem;
  padding-right: 0.55rem;
}

/* Card variant: full width, completely flush - no side borders or padding */
.insight-expanded-panel:not(.insight-expanded-panel--strip) {
  border-left: none;
  border-right: none;
  border-top: 1px solid #e9ecef;
  border-bottom: 1px solid #e9ecef;
  border-radius: 0;
  margin-left: 0 !important;
  margin-right: 0 !important;
  margin-top: 0;
  margin-bottom: 0;
  padding-left: 0;
  padding-right: 0;
  width: 100%;
  max-width: none !important;
}

.insight-expanded-panel::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 0;
}

/* Severity accent colors */
.insight-expanded-panel--critical::before,
.insight-expanded-panel--risk::before {
  background: #dc3545;
}

.insight-expanded-panel--warning::before {
  background: #ffc107;
}

.insight-expanded-panel--lowlight::before {
  background: #fd7e14;
}

.insight-expanded-panel--opportunity::before {
  background: #0d6efd;
}

.insight-expanded-panel--highlight::before {
  background: #198754;
}

.insight-expanded-panel--info::before {
  background: #0dcaf0;
}

/* Strip variant - narrower, indented, has side padding */
.insight-expanded-panel--strip {
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  margin-top: 0.35rem;
  margin-left: 0;
  max-width: none;
}

/* Header Row (compact) - Improved spacing */
.insight-expanded-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.5rem;
  padding-left: 0.75rem;
  padding-right: 0.75rem;
}

.insight-expanded-title {
  font-size: 1rem; /* Increased for dominance */
  font-weight: 800; /* Extra bold */
  color: #0f172a; /* Darker for contrast */
  line-height: 1.25;
  margin: 0;
  flex: 1;
  min-width: 0;
}

.insight-expanded-badges {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
  margin-left: 0.5rem;
}

/* Executive Header - FINAL PASS: Stronger hierarchy, tighter spacing */
.insight-expanded-header-executive {
  margin-bottom: 0.4rem; /* Tighter */
  padding-left: 0.6rem;
  padding-right: 0.6rem;
}

.insight-expanded-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem; /* Tighter */
}

.insight-expanded-severity-inline {
  font-size: 0.65rem; /* Slightly reduced */
  font-weight: 700; /* Increased */
  padding: 0.25rem 0.6rem; /* Slightly tighter */
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  flex-shrink: 0;
  margin-left: 0.5rem;
  border: 1px solid currentColor; /* Add border for visibility */
}

.insight-expanded-metadata-inline {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.insight-expanded-metadata-chip {
  font-size: 0.65rem; /* Reduced */
  padding: 0.12rem 0.35rem; /* Tighter */
  background: #f1f5f9; /* Slightly darker */
  border: 1px solid #e2e8f0;
  color: #475569; /* Darker for contrast */
  border-radius: 3px;
  font-weight: 600; /* Increased */
  opacity: 0.85; /* Reduced dominance */
}

.insight-expanded-metadata-chip--source.real {
  background: #d1fae5;
  border-color: #a7f3d0;
  color: #065f46;
}

.insight-expanded-metadata-chip--source.simulated {
  background: #fef3c7;
  border-color: #fde68a;
  color: #92400e;
}

.insight-expanded-metadata-chip--source.mixed {
  background: #e0e7ff;
  border-color: #c7d2fe;
  color: #3730a3;
}

/* Executive Summary - FINAL PASS: Specific operational observations, tighter */
.insight-expanded-executive-summary {
  background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);
  border-left: 3px solid #4f46e5; /* Slightly darker */
  padding: 0.5rem 0.7rem; /* Tighter */
  margin: 0.4rem 0.75rem; /* Tighter */
  border-radius: 6px;
}

.insight-expanded-summary-content {
  font-size: 0.82rem; /* Reduced */
  line-height: 1.35; /* Tighter */
  color: #334155; /* Darker for contrast */
}

.insight-expanded-summary-label {
  font-weight: 800; /* Increased */
  color: #1f2937;
  margin-right: 0.3rem;
}

/* Executive summary - FINAL PASS: Max 3 bullets, 1 line each, specific operational */
.insight-expanded-summary-why {
  display: block;
  margin-top: 0.2rem; /* Tighter */
  padding-left: 0.9rem; /* Tighter */
  position: relative;
  color: #475569; /* Darker for contrast */
  font-size: 0.8rem; /* Reduced */
  line-height: 1.25; /* Tighter */
  max-height: 3.75em; /* Max 3 lines */
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
}

.insight-expanded-summary-why::before {
  content: "→";
  position: absolute;
  left: 0;
  color: #9ca3af;
  font-weight: 600;
}

.insight-expanded-confidence-inline {
  margin-top: 0.3rem; /* Tighter */
  font-size: 0.7rem; /* Reduced */
  color: #64748b; /* Darker for contrast */
  font-style: italic;
  font-weight: 500; /* Increased */
}

/* Context chips - Compact inline style */
.insight-expanded-context-inline {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  margin: 0.3rem 0.6rem 0.5rem 0.6rem;
}

.insight-expanded-context-chip-compact {
  font-size: 0.65rem;
  padding: 0.1rem 0.35rem;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  color: #6b7280;
  border-radius: 0.15rem;
  font-weight: 500;
}

.insight-expanded-badge--scope {
  background: #6c757d;
  color: white;
}

/* Primary KPI Row - FINAL PASS: Visually dominate, unit/timeframe/comparison visible */
.insight-expanded-kpis {
  display: flex;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
  padding-left: 0.75rem;
  padding-right: 0.75rem;
  flex-wrap: wrap;
}

.insight-expanded-kpi {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.6rem 0.75rem;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #cbd5e1; /* Stronger border */
  border-radius: 8px;
  min-width: 110px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08); /* Stronger shadow */
  flex: 1;
  position: relative;
}

.insight-expanded-kpi-label {
  font-size: 0.62rem;
  color: #475569; /* Darker for contrast */
  text-transform: uppercase;
  letter-spacing: 0.6px;
  font-weight: 700; /* Increased */
  line-height: 1.2;
}

.insight-expanded-kpi-value {
  font-size: 1.25rem; /* Increased for dominance */
  font-weight: 800; /* Extra bold */
  color: #0f172a; /* Darkest for contrast */
  word-break: break-word;
  line-height: 1.1;
}

/* Delta/trend indicator for KPIs */
.insight-expanded-kpi-delta {
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1.2;
  margin-top: 0.1rem;
}

.insight-expanded-kpi-delta.positive {
  color: #059669;
}

.insight-expanded-kpi-delta.negative {
  color: #dc2626;
}

.insight-expanded-kpi-delta.neutral {
  color: #64748b;
}

/* Sections - SECOND PASS: Tighter spacing */
.insight-expanded-section {
  margin-bottom: 0.4rem; /* Tighter */
  padding-left: 0.6rem;
  padding-right: 0.6rem;
}

.insight-expanded-section:last-child {
  margin-bottom: 0;
}

.insight-expanded-section-label {
  font-size: 0.68rem; /* Slightly reduced */
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  margin-bottom: 0.2rem; /* Tighter */
}

.insight-expanded-context {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.insight-expanded-context-chip {
  font-size: 0.6rem;
  padding: 0.15rem 0.35rem;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid #dee2e6;
  color: #495057;
  font-weight: 600;
}

/* Paired signal cross-reference */
.insight-expanded-paired-signal {
  background: rgba(13, 110, 253, 0.05);
  border-left: 3px solid #0d6efd;
  padding: 0.5rem 0.6rem;
  margin-bottom: 0.45rem;
  border-radius: 0.25rem;
}

.insight-expanded-paired-signal-content {
  font-size: 0.8rem;
  font-style: italic;
  color: #495057;
}

/* Correlation note */
.insight-expanded-correlation-note {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: #6c757d;
  font-style: italic;
  padding-top: 0.5rem;
  border-top: 1px solid #e9ecef;
}

/* Signal type label (expanded-only, Review & Merge) */
.insight-expanded-signal-type {
  padding: 0.25rem 0.6rem;
  margin-bottom: 0.3rem;
}

.insight-expanded-signal-type-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #495057;
  margin-bottom: 0;
}

/* Net effect line */
.insight-expanded-net-effect {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: #495057;
  padding: 0.4rem 0.6rem;
  background: rgba(13, 110, 253, 0.08);
  border-left: 3px solid #0d6efd;
  border-radius: 0.25rem;
}

.insight-expanded-section-content {
  color: #4b5563;
  line-height: 1.4; /* Tighter */
  word-wrap: break-word;
  overflow-wrap: anywhere;
  font-size: 0.78rem; /* Reduced */
}

.insight-expanded-description-section {
  margin-bottom: 0.5rem;
}

.insight-expanded-description {
  font-size: 0.78rem; /* Reduced */
  line-height: 1.4; /* Tighter */
  margin: 0;
  color: #4b5563;
}

/* PHASE 5: Confidence label styling (for TTFC low-confidence) */
.insight-expanded-confidence-label {
  font-size: 0.75rem;
  color: #856404;
  font-style: italic;
  margin-top: 0.25rem;
  padding-left: 0.5rem;
  border-left: 2px solid #ffc107;
}

/* Evidence Table - SECOND PASS: Tighter spacing */
.insight-expanded-evidence-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.3rem; /* Tighter */
}

.insight-expanded-evidence-toggle {
  font-size: 0.7rem;
  color: #0d6efd;
  text-decoration: none;
  padding: 0;
  margin: 0;
  line-height: 1;
}

.insight-expanded-evidence-toggle:hover {
  text-decoration: underline;
}

.insight-expanded-evidence {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.35rem; /* Tighter */
}

.insight-expanded-evidence-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.3rem 0.35rem; /* Tighter */
  border-bottom: 1px solid #f3f4f6;
  line-height: 1.3;
}

.insight-expanded-evidence-row:last-child {
  border-bottom: none;
}

.insight-expanded-evidence-label {
  font-size: 0.7rem; /* Reduced */
  color: #6b7280;
  font-weight: 600; /* Increased */
  min-width: 5rem;
  flex-shrink: 0;
}

.insight-expanded-evidence-value {
  font-size: 0.78rem; /* Reduced */
  color: #111827;
  font-weight: 700; /* Increased */
  flex: 1;
  word-break: break-word;
  overflow-wrap: anywhere;
}

/* Action Section - FINAL PASS: Short operational directives, max 1 line, imperative */
.insight-expanded-action-section {
  margin-top: 0.6rem;
  padding-top: 0.5rem;
  border-top: 1px solid #e2e8f0; /* Stronger */
}

.insight-expanded-action {
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border-left: 4px solid #059669; /* Stronger */
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
}

.insight-expanded-action-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.3rem;
}

.insight-expanded-action-icon {
  color: #059669;
  font-size: 0.9rem;
}

.insight-expanded-action-label {
  font-size: 0.68rem; /* Reduced */
  font-weight: 800; /* Increased */
  color: #047857;
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.insight-expanded-action-content {
  font-size: 0.82rem; /* Reduced */
  color: #1e293b; /* Darker for contrast */
  line-height: 1.3;
  font-weight: 600; /* Increased */
  max-height: 2.6em; /* Max 2 lines */
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.insight-expanded-action-owner {
  font-size: 0.7rem;
  color: #475569;
  margin-bottom: 0.25rem;
  font-weight: 600;
}

.insight-expanded-action-timeline {
  font-size: 0.68rem;
  color: #64748b;
  font-weight: 500;
}

.insight-expanded-action-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(13, 110, 253, 0.15);
}

.insight-expanded-verification {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: #198754;
  font-weight: 500;
}

.insight-expanded-verification i {
  font-size: 0.85rem;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .insight-expanded-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .insight-expanded-evidence-row {
    flex-direction: column;
    gap: 0.25rem;
  }

  .insight-expanded-evidence-label {
    min-width: auto;
  }

  .insight-expanded-kpis {
    flex-direction: column;
  }
  
  .insight-expanded-panel--strip {
    margin-left: 0;
    max-width: none;
  }
}
</style>
