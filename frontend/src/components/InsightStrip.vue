<template>
  <div class="insight-strip">
    <div 
      v-for="(insight, idx) in props.insights || []" 
      :key="`canon-${insight.id || idx}`"
      class="insight-strip-row"
      :data-pi-id="insight.id"
      data-pi-region="strip"
      :class="[getSeverityRailClass(insight.severity), { 'insight-strip-row--expanded': expandedIds.has(insight.id) }]"
    >
      <!-- Collapsed Row -->
      <div 
        class="insight-strip-row-collapsed d-flex align-items-center gap-2"
        @click="toggleExpand(insight.id)"
      >
        <!-- Severity Badge -->
        <div class="insight-strip-severity" :class="getSeverityClass(insight.severity)">
          <i :class="getSeverityIcon(insight.severity)"></i>
        </div>

        <!-- Title (truncated) -->
        <div class="insight-strip-title flex-grow-1 min-w-0">
          {{ getDisplayTitle(insight) }}
        </div>

        <!-- V2 Right Metric (for PI V2 rows with rightMetric field) OR Primary Evidence (for legacy insights) -->
        <div v-if="hasRightMetric(insight)" class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
          <span class="insight-strip-evidence-item">
            <span class="insight-strip-evidence-value">{{ getStripRightMetric(insight) }}</span>
          </span>
        </div>
        <div v-else class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
          <template v-for="(ev, evIdx) in stripEvidence(insight)" :key="evIdx">
            <span class="insight-strip-evidence-item">
              <span class="insight-strip-evidence-label">{{ ev.label }}:</span>
              <span class="insight-strip-evidence-value">{{ formatEvidenceValue(ev.label, ev.value) }}</span>
            </span>
          </template>
        </div>

        <span class="badge badge-sm insight-strip-scope-pill" :class="getScopePillClass(insight)">
          {{ getScopeLabel(insight) }}
        </span>

        <span v-if="getSourceBadge(insight)" class="badge badge-sm insight-strip-source-dot" :class="getSourceDotClass(insight)">
          {{ getSourceBadge(insight) }}
        </span>

        <!-- Expand/Collapse Chevron -->
        <i class="bi insight-strip-chevron" :class="expandedIds.has(insight.id) ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
      </div>

      <!-- Expanded Content -->
      <div v-if="expandedIds.has(insight.id)" class="insight-strip-row-expanded">
        <InsightExpandedPanel :insight="convertToInsight(insight)" :variant="'strip'" />
      </div>
    </div>

    <div
      v-for="(row, idx) in previewRows"
      :key="row.id || `preview-${idx}`"
      class="insight-strip-row"
      data-pi-region="strip"
      :class="[
        'insight-strip-row--rail-primary',
        { 'insight-strip-row--expanded': expandedPreviewIds.has(row.id || `preview-${idx}`) }
      ]"
    >
      <!-- Collapsed row: only show if formatter says shouldCollapse=true -->
      <div
        v-if="row._formatted?.shouldCollapse !== false"
        class="insight-strip-row-collapsed d-flex align-items-center gap-2"
        @click="togglePreviewExpand(row.id || `preview-${idx}`)"
      >
        <div class="insight-strip-severity" :class="getPreviewRowSeverityClass(row)">
          <i :class="getPreviewRowIcon(row)"></i>
        </div>

        <div class="insight-strip-title flex-grow-1 min-w-0">
          <div class="d-flex align-items-center gap-2 min-w-0">
            <!-- Use canonical title only - no fallback formatting -->
            <span class="text-truncate">{{ row.title }}</span>
            <!-- Urgency label badge (V1-style) -->
            <span
              v-if="(row as any).urgencyLabel"
              class="badge badge-sm"
              :class="getUrgencyBadgeClass((row as any).urgencyLabel)"
              style="font-size: 0.62rem;"
            >
              <i :class="getUrgencyIcon((row as any).urgencyLabel)" style="margin-right: 0.2rem;"></i>
              {{ getUrgencyLabel((row as any).urgencyLabel) }}
            </span>
            <!-- Trust badges from formatter -->
            <template v-if="row._formatted?.trustBadges && row._formatted.trustBadges.length > 0">
              <span
                v-for="(badge, bIdx) in row._formatted.trustBadges"
                :key="bIdx"
                class="badge badge-sm bg-info-subtle text-info"
                style="font-size: 0.62rem;"
                :title="badge.tooltip || ''"
              >
                {{ badge.label }}
              </span>
            </template>
            <!-- Original badges (V2, etc.) -->
            <template v-if="row.badges && row.badges.length > 0">
              <span
                v-for="(b, bIdx) in row.badges"
                :key="bIdx"
                class="badge badge-sm"
                :class="b === 'V2' ? 'bg-primary-subtle text-primary' : 'bg-secondary-subtle text-secondary'"
                style="font-size: 0.62rem;"
              >
                {{ b }}
              </span>
            </template>
          </div>
          <div v-if="row.subtitle" class="text-muted" style="font-size: 0.75rem; line-height: 1.1;">
            {{ row.subtitle }}
          </div>
          <div v-if="row.callout" class="text-muted" style="font-size: 0.72rem; line-height: 1.1; margin-top: 0.1rem;">
            {{ row.callout }}
          </div>
        </div>

        <div v-if="row.rightMetric" class="insight-strip-evidence d-flex align-items-center gap-2 flex-shrink-0">
          <span class="insight-strip-evidence-item">
            <span class="insight-strip-evidence-value">{{ getCleanRightMetric(row) }}</span>
            <!-- secondaryRightMetric removed: engineering metadata (Range:, N:, Sessions:, etc.) hidden from collapsed view -->
          </span>
        </div>

        <span
          v-if="row.confidence"
          class="badge badge-sm"
          :class="row.confidence === 'high' ? 'bg-success-subtle text-success' : (row.confidence === 'medium' ? 'bg-warning-subtle text-warning' : 'bg-danger-subtle text-danger')"
          style="font-size: 0.62rem;"
        >
          {{ row.confidence }}
        </span>

        <i
          class="bi insight-strip-chevron"
          :class="expandedPreviewIds.has(row.id || `preview-${idx}`) ? 'bi-chevron-up' : 'bi-chevron-down'"
          @click.stop="togglePreviewExpand(row.id || `preview-${idx}`)"
        ></i>
      </div>

      <!-- Expand-only mode for rows with shouldCollapse=false (emerging signals) -->
      <div
        v-else
        class="insight-strip-row-collapsed d-flex align-items-center gap-2"
        style="background-color: #f8f9fa; cursor: pointer;"
        @click="togglePreviewExpand(row.id || `preview-${idx}`)"
      >
        <div class="flex-grow-1 min-w-0">
          <div class="d-flex align-items-center gap-2 min-w-0">
            <span class="text-muted" style="font-size: 0.85rem; font-style: italic;">
              {{ row.title }} (click to expand for details)
            </span>
            <span class="badge badge-sm bg-secondary-subtle text-secondary" style="font-size: 0.62rem;">
              Emerging Signal
            </span>
          </div>
        </div>
        <i
          class="bi insight-strip-chevron"
          :class="expandedPreviewIds.has(row.id || `preview-${idx}`) ? 'bi-chevron-up' : 'bi-chevron-down'"
          @click.stop="togglePreviewExpand(row.id || `preview-${idx}`)"
        ></i>
      </div>

      <div v-if="expandedPreviewIds.has(row.id || `preview-${idx}`)" class="insight-strip-row-expanded">
        <InsightExpandedPanel :insight="convertPreviewRowToInsight(row)" :variant="'strip'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import type { PerformanceInsight, InsightEvidence } from '../lib/insights/types'
import { extractPrimaryEvidence } from '../lib/insights/evidenceExtractor'
import { getToolLabel } from '../lib/insights/labels'
import InsightExpandedPanel from './InsightExpandedPanel.vue'
import type { Insight } from '../types/insights'
import { hardenPerformanceInsightForUi, normalizeEvidenceLabel } from '../ui/insights/piHardening'
import { formatCollapsedRow, cleanRightMetric, resolvePrimaryMetricDisplay } from '../lib/insights/v2/collapsedRowFormatter'
import { formatPIValue, formatPercent, formatMinutes, formatNumberWithUnit, formatFallback } from '../utils/piFormat'
import { isDebugEnabled } from '../lib/perf/debugGate'
import { formatStripRightMetric } from '../lib/insights/v2/collapsedRowFormatter'

type PreviewRow = {
  id?: string
  title: string
  subtitle?: string
  callout?: string
  rightMetric?: string
  secondaryRightMetric?: string
  confidence?: 'high' | 'medium' | 'low'
  recommendation?: string // Top-level recommendation from V2PreviewRow
  definition?: string
  detail?: {
    definition: string
    coverage: { computableRows: number; totalRows: number; coveragePct: number }
    breakdownByTool?: Array<{ tool: string; value: string; n: number }>
    breakdownByPeriod?: Array<{ periodLabel: string; value: string; n: number }>
    evidenceSample?: Array<{
      session_id: string
      timestamp: string
      tool?: string
      git_repo_url?: string
      git_branch?: string
      keyFields?: Record<string, any>
    }>
    recommendation?: string
  }
  badges?: string[]
  details?: string
}

interface Props {
  insights?: PerformanceInsight[]
  previewRows?: any[]
  allStageInsights?: PerformanceInsight[]
}

const props = defineProps<{
  insights?: PerformanceInsight[]
  previewRows?: any[]
  allStageInsights?: PerformanceInsight[]
}>()

const expandedIds = ref<Set<string>>(new Set())
const expandedPreviewIds = ref<Set<string>>(new Set())

// REMOVED: displayedInsights - now using props.insights directly in template
// const displayedInsights = computed(() => groupStripInsightsForDisplay(props.insights))
const previewRows = computed(() => {
  const rows = props.previewRows || []
  
  // Transform rows using formatter for presentation contract compliance
  return rows.map((row: any) => {
    const formatted = formatCollapsedRow(row);
    
    return {
      ...row,
      _formatted: formatted
    };
  });
})

function getStripRightMetric(insight: any): string {
  if (isDebugEnabled('STRIP')) {
    console.log('🔥 [STRIP DEBUG] getStripRightMetric called for:', {
      id: insight.id,
      hasRightMetric: hasRightMetric(insight),
      rightMetric: insight.rightMetric,
      displayValue: insight.displayValue,
      evidenceCount: insight?.evidence?.length || 0
    });
  }
  
  const result = formatStripRightMetric(insight);
  if (isDebugEnabled('STRIP')) {
    console.log('🔥 [STRIP DEBUG] getStripRightMetric result:', result);
  }
  return result;
}

function toggleExpand(id: string) {
  const newExpanded = new Set(expandedIds.value)
  if (newExpanded.has(id)) {
    newExpanded.delete(id)
  } else {
    // Accordion behavior: expand one at a time
    newExpanded.clear()
    newExpanded.add(id)
  }
  expandedIds.value = newExpanded
}

function togglePreviewExpand(id: string) {
  const newExpanded = new Set(expandedPreviewIds.value)
  if (newExpanded.has(id)) {
    newExpanded.delete(id)
  } else {
    newExpanded.clear()
    newExpanded.add(id)
  }
  expandedPreviewIds.value = newExpanded
}

function hasRightMetric(insight: any): boolean {
  // More inclusive check: use canonical formatter for any insight with rightMetric or displayValue
  const hasRightMetric = !!insight?.rightMetric
  const hasDisplayValue = !!insight?.displayValue
  const hasEvidence = insight?.evidence && Array.isArray(insight.evidence) && insight.evidence.length > 0
  
  // Use canonical formatter if any of these conditions are met
  return hasRightMetric || hasDisplayValue || hasEvidence
}

function checkDataQuality(insight: any): { sufficient: boolean; sessions?: number; coverage?: number } {
  // Extract data quality indicators from evidence
  const evidence = insight?.evidence || []
  let sessions = 0
  let coverage = 0
  
  for (const ev of evidence) {
    const label = String(ev?.label || '').toLowerCase().trim()
    const value = ev?.value
    
    if (label === 'contributing sessions' || label === 'sessions') {
      if (typeof value === 'number') sessions = value
      else if (typeof value === 'string') sessions = parseInt(value) || 0
    }
    if (label === 'coverage' || label === 'signal coverage') {
      if (typeof value === 'string' && value.includes('%')) {
        coverage = parseFloat(value.replace('%', '')) || 0
      } else if (typeof value === 'number') {
        coverage = value
      }
    }
  }
  
  // Data quality thresholds (minimal, MVP)
  const MIN_SESSIONS = 10
  const MIN_COVERAGE = 20
  
  const sufficient = (sessions === 0 || sessions >= MIN_SESSIONS) && (coverage === 0 || coverage >= MIN_COVERAGE)
  
  return { sufficient, sessions, coverage }
}

function formatV2CollapsedMetric(insight: any): string {
  // DEBUG: Log insight object for AI Suggestions
  if (insight?.id === 'ai-suggestions-accepted-by-ide') {
    console.log('🎨 [UI] AI Suggestions Insight Object:', {
      id: insight.id,
      displayValue: insight.displayValue,
      displayDelta: insight.displayDelta,
      displayUnit: insight.displayUnit,
      displayWinnerLabel: insight.displayWinnerLabel,
      rightMetric: insight.rightMetric,
      evidenceLength: insight?.evidence?.length || 0,
    });
  }

  // PREFER structured display fields if available (Plan & Code MVP)
  if (insight?.displayValue) {
    console.log('✅ [UI] Using structured displayValue:', insight.displayValue);
    let result = insight.displayValue;
    
    // Add units to displayValue if missing
    const value = parseFloat(insight.displayValue);
    const unit = insight.displayUnit || '';
    
    if (!isNaN(value) && !result.includes('min') && !result.includes('session') && !result.includes('assists') && !result.includes('%') && !result.includes('focus') && !result.includes('commits') && !result.includes('lines') && !result.includes('cycles') && !result.includes('hours') && !result.includes('days')) {
      if (unit.includes('min') || unit.includes('minute')) {
        result = value >= 60 ? formatMinutesAsHoursMinutes(value) : `${Math.round(value)} min`;
      } else if (unit.includes('hour')) {
        result = formatHoursAsDaysHours(value);
      } else if (unit.includes('session') || unit.includes('count')) {
        result = `${Math.round(value)} sessions`;
      } else if (unit.includes('assists')) {
        result = `${value.toFixed(1)} assists/session`;
      } else if (unit.includes('%') || unit.includes('percent')) {
        result = `${Math.round(value)}%`;
      } else if (unit.includes('commits')) {
        result = `${value.toFixed(1)} commits/session`;
      } else if (unit.includes('lines')) {
        result = `${Math.round(value)} lines`;
      } else if (unit.includes('cycles')) {
        result = `${Math.round(value)} cycles`;
      } else {
        // Try to infer from insight ID if no unit provided
        const insightIdLower = insight.id.toLowerCase()
        if (insightIdLower.includes('commits-per-session')) {
          result = `${value.toFixed(1)} commits/session`;
        } else if (insightIdLower.includes('focus') || insightIdLower.includes('concentration')) {
          result = `${Math.round(value)}% focus`;
        } else if (insightIdLower.includes('session') && !insightIdLower.includes('length')) {
          result = `${Math.round(value)} sessions`;
        } else if (insightIdLower.includes('min') || insightIdLower.includes('time')) {
          result = value >= 60 ? formatMinutesAsHoursMinutes(value) : `${Math.round(value)} min`;
        } else if (insightIdLower.includes('hour') || insightIdLower.includes('pr-cycle') || insightIdLower.includes('review')) {
          result = formatHoursAsDaysHours(value);
        }
      }
    }
    
    if (insight.displayDelta) {
      result += ` (${insight.displayDelta})`;
    }
    if (insight.confidenceLabel) {
      result += ` • ${insight.confidenceLabel}`;
    }
    return result;
  }
  
  console.log('⚠️ [UI] No displayValue, falling back to evidence parsing for:', insight?.id);
  
  // FALLBACK: V2 insights have primary metric buried in evidence array
  // Extract the first tool-specific numeric value (cursor, vscode, windsurf)
  // and format it with appropriate unit
  const evidence = insight?.evidence || []
  const id = insight?.id || ''
  const rightMetric = insight?.rightMetric || ''
  
  const metadataLabels = new Set(['range', 'n', 'sessions', 'org', 'hybrid', 'live', 'points', 'time range', 'period range', 'contributing sessions'])
  
  // Strategy: For "by IDE" insights, show the highest/most meaningful value
  // For AI vs non-AI, show the first comparison value
  const knownTools = new Set(['cursor', 'windsurf', 'vscode', 'jetbrains'])
  const knownComparisonLabels = new Set(['ai-assisted', 'non-ai', 'ai', 'non ai'])
  const excludeLabels = new Set(['coverage', 'signal coverage', 'metric', 'measure', 'contributing prs', 'contributing sessions'])
  const toolValues: Array<{ label: string; value: number; unit?: string }> = []
  
  for (const ev of evidence) {
    const label = String(ev?.label || '').toLowerCase().trim()
    if (metadataLabels.has(label)) continue
    if (excludeLabels.has(label)) continue // Skip coverage%, metric labels, etc.
    
    const value = ev?.value
    // Extract unit from string values (e.g., "5.8 /period", "42.3 min")
    let unit: string | undefined
    
    // Only accept pure numbers, not strings with units like "100%"
    if (typeof value === 'number' && Number.isFinite(value)) {
      toolValues.push({ label, value })
    } else if (typeof value === 'string') {
      // Check if it has a unit suffix
      const trimmed = value.trim()
      const numWithUnitMatch = trimmed.match(/^([\d.]+)\s*(.+)$/)
      if (numWithUnitMatch) {
        const numericValue = parseFloat(numWithUnitMatch[1])
        const unitPart = numWithUnitMatch[2].trim()
        if (Number.isFinite(numericValue) && unitPart && !unitPart.includes('%')) {
          toolValues.push({ label, value: numericValue, unit: unitPart })
        }
      } else if (/^\d+\.?\d*$/.test(trimmed)) {
        // Pure number string
        const numericValue = parseFloat(trimmed)
        if (Number.isFinite(numericValue)) {
          toolValues.push({ label, value: numericValue })
        }
      }
    }
  }
  
  if (toolValues.length === 0) return ''
  
  // For "by IDE" insights, find the tool with the highest value (most interesting)
  // For AI comparisons, use the first value
  let selectedValue: number
  let selectedLabel: string
  let inferredUnit: string | undefined
  
  if (id.includes('by-ide')) {
    // Show the tool with highest value (most significant)
    const sorted = [...toolValues].sort((a, b) => b.value - a.value)
    selectedValue = sorted[0].value
    selectedLabel = sorted[0].label
    inferredUnit = sorted[0].unit
  } else {
    // For AI vs non-AI, use first value
    selectedValue = toolValues[0].value
    selectedLabel = toolValues[0].label
    inferredUnit = toolValues[0].unit
  }
  
  // TTFC data quality gate: Only hide if winner shows 0 AND insufficient signal flag is set
  // Don't hide just because of low coverage - 4 sessions is valid data
  if (id.includes('time-to-first-commit') && selectedValue === 0 && insight?.insufficientSignal) {
    return 'Insufficient data'
  }
  
  // Infer unit from insight ID and format
  let formatted = ''
  
  if (id.includes('commits-per-session')) {
    formatted = `${selectedValue.toFixed(1)} commits/session`
  }
  else if (id.includes('time-to-first-commit')) {
    // TTFC: values < 1 minute should be shown in seconds
    if (selectedValue < 1) {
      formatted = `TTFC: ${(selectedValue * 60).toFixed(1)} sec`
    } else {
      formatted = `TTFC: ${selectedValue.toFixed(1)} min`
    }
  }
  else if (id.includes('active-coding-time')) {
    // Use unit from evidence if available, otherwise default to "min/period"
    const unit = inferredUnit || '/period'
    const denominator = unit.includes('session') ? '/session' : unit.includes('week') ? '/week' : unit.includes('day') ? '/day' : '/period'
    
    // Convert to hours if >= 60 minutes
    if (selectedValue >= 60) {
      const hours = Math.floor(selectedValue / 60)
      const mins = Math.round(selectedValue % 60)
      const timeStr = mins > 0 ? `${formatHoursAsDaysHours(hours)} ${mins} min` : formatHoursAsDaysHours(hours)
      formatted = `${timeStr}${denominator}`
    } else {
      formatted = `${selectedValue.toFixed(1)} min${denominator}`
    }
  }
  else if (id.includes('session-length')) {
    // Convert to hours if >= 60 minutes
    if (selectedValue >= 60) {
      const hours = Math.floor(selectedValue / 60)
      const mins = Math.round(selectedValue % 60)
      formatted = mins > 0 ? `${formatHoursAsDaysHours(hours)} ${mins} min` : formatHoursAsDaysHours(hours)
    } else {
      formatted = `${selectedValue.toFixed(1)} min`
    }
  }
  else if (id.includes('pr-cycle-time') || id.includes('review-time')) {
    formatted = formatHoursAsDaysHours(selectedValue)
  }
  else if (id.includes('suggestions-accepted')) {
    // Use unit from evidence: /period or /session or /week
    const unit = inferredUnit || '/period'
    const denominator = unit.includes('session') ? '/session' : unit.includes('week') ? '/week' : unit.includes('day') ? '/day' : '/period'
    formatted = `${selectedValue.toFixed(1)} assists${denominator}`
  }
  else if (id.includes('focus') || id.includes('concentration')) {
    formatted = `${Math.round(selectedValue)}% focus`
  }
  else if (id.includes('rework') && (id.includes('rate') || id.includes('ratio') || id.includes('burden'))) {
    // Convert decimal to percentage
    const pct = (selectedValue * 100).toFixed(1)
    formatted = `${pct}% rework`
  }
  else if (id.includes('rate') || id.includes('ratio')) {
    formatted = `${selectedValue}%`
  }
  else if (id.includes('pr-size')) {
    formatted = `${Math.round(selectedValue)} lines`
  }
  else if (id.includes('review-cycles')) {
    formatted = `${Math.round(selectedValue)} cycles`
  }
  else {
    // Default case: try to infer units from the selected label or value
    const labelLower = selectedLabel.toLowerCase()
    
    if (labelLower.includes('min') || labelLower.includes('minute')) {
      formatted = selectedValue >= 60 ? formatMinutesAsHoursMinutes(selectedValue) : `${Math.round(selectedValue)} min`
    }
    else if (labelLower.includes('hour')) {
      formatted = formatHoursAsDaysHours(selectedValue)
    }
    else if (labelLower.includes('session')) {
      formatted = `${Math.round(selectedValue)} sessions`
    }
    else if (labelLower.includes('assists') || labelLower.includes('ai')) {
      formatted = `${selectedValue.toFixed(1)} assists/session`
    }
    else if (labelLower.includes('focus') || labelLower.includes('concentration')) {
      formatted = `${Math.round(selectedValue)}% focus`
    }
    else if (labelLower.includes('%') || labelLower.includes('percent') || labelLower.includes('pct')) {
      formatted = `${Math.round(selectedValue)}%`
    }
    else if (labelLower.includes('ratio') || labelLower.includes('×')) {
      formatted = `${selectedValue.toFixed(2)}×`
    }
    else if (selectedValue % 1 === 0) {
      formatted = `${Math.round(selectedValue)}`
    }
    else {
      formatted = `${selectedValue.toFixed(2)}`
    }
  }
  
  return formatted
}

function getCleanRightMetric(row: any): string {
  // Use canonical resolver — single source of truth for metric display
  const canonical = resolvePrimaryMetricDisplay(row)

  if (canonical.isInsufficient) {
    return 'Insufficient data'
  }

  // Build: "Label: valueText (comparisonText)"
  let result = `${canonical.label}: ${canonical.valueText}`
  if (canonical.comparisonText) {
    result += ` (${canonical.comparisonText})`
  }
  return result
}

function primaryEvidence(insight: PerformanceInsight): InsightEvidence[] {
  return extractPrimaryEvidence(insight)
}

function stripEvidence(insight: PerformanceInsight): InsightEvidence[] {
  const banned = new Set([
    'tools tracked',
    'ides tracked',
    'ides + sources tracked',
    'context',
    'metric',
    'measure',
    'compare',
    'evidence',
    'signals used',
    'points', // V2 metadata
    'n',
    'range',
    'time range',
    'period range'
  ])

  const MAX_STRIP_EVIDENCE = 5
  const knownTools = new Set(['cursor', 'windsurf', 'vscode', 'claude_code', 'codex', 'github_copilot', 'jetbrains', 'sublime', 'vim'])

  const isNumericLike = (value: any): boolean => {
    if (value === null || value === undefined) return false
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value === 'string') {
      const s = value.trim()
      if (!s) return false
      const pct = s.endsWith('%') ? s.slice(0, -1) : s
      return Number.isFinite(Number(pct))
    }
    return false
  }

  const normalizeEv = (ev: any): InsightEvidence => ({
    label: normalizeEvidenceLabel(String(ev?.label || '').trim()),
    value: ev?.value as any
  })

  const rawEvidence = Array.isArray((insight as any)?.evidence) ? (insight as any).evidence : []
  const normalizedEvidence = rawEvidence
    .map(normalizeEv)
    .filter((ev: any) => ev.label && !banned.has(String(ev.label).toLowerCase()))

  const compactStripLabel = (label: string): string => {
    const l = String(label || '').trim()
    const lc = l.toLowerCase()
    if (lc === 'time range') return 'Range'
    if (lc === 'period range') return 'Range'
    if (lc === 'points') return 'N'
    if (lc === 'weeks in band') return 'Weeks'
    if (lc === 'contributing prs') return 'PRs'
    if (lc === 'contributing sessions') return 'Sessions'
    if (lc === 'coverage') return 'Cov'
    if (lc === 'signal coverage') return 'Sig'
    if (knownTools.has(lc)) return lc
    return l
  }

  const pushUnique = (out: InsightEvidence[], ev: InsightEvidence) => {
    const lk = String(ev.label || '').trim().toLowerCase()
    if (!lk) return
    if (out.some((x) => String(x.label || '').trim().toLowerCase() === lk)) return
    out.push({ label: compactStripLabel(ev.label), value: ev.value } as any)
  }

  const out: InsightEvidence[] = []

  // 1) Always try to include time/period range first (high clarity, v6-like)
  const timeRange = normalizedEvidence.find((ev: any) => String(ev.label).toLowerCase() === 'time range' || String(ev.label).toLowerCase() === 'period range')
  if (timeRange) pushUnique(out, timeRange)

  // 2) Include a sample size / denominator (Points, PRs, Sessions, Weeks)
  const denom = normalizedEvidence.find((ev: any) => {
    const l = String(ev.label).toLowerCase()
    return l === 'points' || l === 'contributing prs' || l === 'contributing sessions' || l === 'weeks in band'
  })
  if (denom) pushUnique(out, denom)

  // 3) Include top tool numeric evidence (cursor/windsurf/vscode)
  const toolNums = normalizedEvidence
    .filter((ev: any) => knownTools.has(String(ev.label).toLowerCase()) && isNumericLike(ev.value))
    .slice(0, 3)
  for (const ev of toolNums) pushUnique(out, ev)

  // 4) If still sparse, fall back to primary evidence (keeps existing behavior but allows more than 1–2)
  if (out.length < MAX_STRIP_EVIDENCE) {
    const base = (primaryEvidence(insight) || [])
      .map(normalizeEv)
      .filter((ev: any) => ev.label && !banned.has(String(ev.label).toLowerCase()))
    for (const ev of base) {
      if (out.length >= MAX_STRIP_EVIDENCE) break
      if (isNumericLike(ev.value) || String(ev.label).toLowerCase().includes('range')) {
        pushUnique(out, ev)
      }
    }
  }

  // 5) If still empty, show nothing
  if (out.length === 0) return []

  // Keep paired stats together when appropriate
  const allowTwo = isCoupledEvidencePair(out)
  if (allowTwo) return out.slice(0, Math.min(2, out.length))
  return out.slice(0, MAX_STRIP_EVIDENCE)
}

function isCoupledEvidencePair(evs: Array<{ label: string; value?: any }>): boolean {
  if (evs.length < 2) return false
  const a = evs[0].label.toLowerCase()
  const b = evs[1].label.toLowerCase()
  const has = (s: string, needle: string) => s.includes(needle)

  const p50p90 = (has(a, 'p50') && has(b, 'p90')) || (has(a, 'p90') && has(b, 'p50'))
  const meanCv = (has(a, 'mean') && has(b, 'cv')) || (has(a, 'cv') && has(b, 'mean'))
  const avgStd = (has(a, 'avg') && has(b, 'std')) || (has(a, 'std') && has(b, 'avg'))
  return p50p90 || meanCv || avgStd
}

function formatEvidenceValue(label: string, value: number | string | undefined): string {
  if (value === undefined || value === null) return '--'
  
  // CLEAN METADATA from string values before formatting
  if (typeof value === 'string') {
    value = cleanRightMetric(value)
  }
  
  const labelLower = String(label ?? '').toLowerCase()

  const isPercentText = typeof value === 'string' && value.trim().endsWith('%')
  const num = (typeof value === 'number')
    ? value
    : (typeof value === 'string' && value.trim() !== '' && isFinite(Number(isPercentText ? value.trim().slice(0, -1) : value)))
      ? Number(isPercentText ? value.trim().slice(0, -1) : value)
      : null

  if (num !== null && (labelLower.includes('min') || labelLower.includes('minute'))) {
    if (num >= 60) return formatMinutesAsHoursMinutes(num)
    return Math.round(num).toString() + ' min'
  }

  if (num !== null && labelLower.includes('hour')) {
    return formatHoursAsDaysHours(num)
  }

  if (num !== null) {
    if (labelLower.includes('ai assists/min') || labelLower.includes('assists/min') || labelLower.includes('cv') || labelLower.includes('ratio')) {
      return num.toFixed(2) + ' assists/min'
    }
    if (isPercentText || labelLower.includes('%') || labelLower.includes('pct') || labelLower.includes('percent')) {
      if (Math.abs(num) < 1) return num.toFixed(1) + '%'
      return Math.round(num).toString() + '%'
    }
    if (labelLower.includes('session') || labelLower.includes('sessions')) {
      return Math.round(num).toString() + ' sessions'
    }
    if (labelLower.includes('focus')) {
      return Math.round(num).toString() + '% focus'
    }
    if (num % 1 === 0) return num.toString()
    return num.toFixed(2)
  }

  return String(value)
}

function formatMinutesAsHoursMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  
  // Handle days for large hour values
  if (h >= 24) {
    const days = Math.floor(h / 24)
    const remainingHours = h % 24
    if (remainingHours > 0 && m > 0) {
      return `${days} days ${remainingHours}h ${m.toString().padStart(2, '0')}m`
    } else if (remainingHours > 0) {
      return `${days} days ${remainingHours}h`
    } else if (m > 0) {
      return `${days} days ${m.toString().padStart(2, '0')}m`
    } else {
      return `${days} days`
    }
  }
  
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

function formatHoursAsDaysHours(hours: number): string {
  const total = Math.max(0, Math.round(hours))
  
  // Handle days for large hour values
  if (total >= 24) {
    const days = Math.floor(total / 24)
    const remainingHours = total % 24
    if (remainingHours > 0) {
      return `${days} days ${remainingHours} hours`
    } else {
      return `${days} days`
    }
  }
  
  return `${total} hours`
}

function getSeverityClass(severity: string): string {
  // CREDIBILITY FIX: Reduce red overload - only critical gets red background
  // Use more subtle colors for lower severity to improve executive scanning
  const severityMap: Record<string, string> = {
    'critical': 'severity-critical',
    'risk': 'severity-risk-subtle', // Less aggressive red
    'warning': 'severity-warning-subtle', // Less aggressive orange
    'lowlight': 'severity-lowlight-subtle', // Subtle yellow
    'opportunity': 'severity-opportunity-subtle', // Subtle blue
    'highlight': 'severity-highlight-subtle', // Subtle green
    'info': 'severity-info-subtle' // Subtle gray
  }
  return severityMap[severity] || 'severity-info-subtle'
}

function getSeverityIcon(severity: string): string {
  // CREDIBILITY FIX: Use iconography beyond color for ADA accessibility
  // Add border icons and more distinctive icons for each severity level
  const iconMap: Record<string, string> = {
    'critical': 'bi-exclamation-octagon-fill', // Distinctive octagon for critical
    'risk': 'bi-exclamation-triangle-fill', // Triangle for risk
    'warning': 'bi-exclamation-circle-fill', // Circle for warning
    'lowlight': 'bi-dash-circle-fill', // Dash for lowlight
    'opportunity': 'bi-lightning-fill', // Lightning for opportunity (actionable)
    'highlight': 'bi-star-fill', // Star for highlight (positive)
    'info': 'bi-info-circle-fill' // Standard info
  }
  return iconMap[severity] || 'bi-info-circle-fill'
}

// Urgency label helpers (V1-style)
function getUrgencyIcon(urgencyLabel?: string): string {
  const iconMap: Record<string, string> = {
    'action_required': 'bi-exclamation-triangle-fill',
    'investigate': 'bi-exclamation-circle-fill',
    'monitor': 'bi-eye-fill',
    'informational': 'bi-info-circle-fill'
  }
  return iconMap[urgencyLabel || 'informational'] || 'bi-info-circle-fill'
}

function getUrgencyLabel(urgencyLabel?: string): string {
  const labelMap: Record<string, string> = {
    'action_required': 'Action Required',
    'investigate': 'Investigate',
    'monitor': 'Monitor',
    'informational': 'Informational'
  }
  return labelMap[urgencyLabel || 'informational'] || 'Informational'
}

// Additional methods for tile design
function getSeverityIconClass(severity: string): string {
  const classMap: Record<string, string> = {
    'critical': 'severity-critical',
    'risk': 'severity-risk', 
    'warning': 'severity-warning',
    'lowlight': 'severity-lowlight',
    'opportunity': 'severity-opportunity',
    'highlight': 'severity-highlight',
    'info': 'severity-info'
  }
  return classMap[severity] || 'severity-info'
}

function getPrimaryEvidenceValue(insight: any): string {
  const evidence = stripEvidence(insight)
  if (evidence.length > 0) {
    return formatEvidenceValue(evidence[0].label, evidence[0].value)
  }
  return 'N/A'
}

function hasDescription(insight: any): boolean {
  return !!(insight.description || insight.whatHappening)
}

function getInsightDescription(insight: any): string {
  return insight.description || insight.whatHappening || ''
}

function getUrgencyBadgeClass(urgencyLabel?: string): string {
  const classMap: Record<string, string> = {
    'action_required': 'bg-danger-subtle text-danger',
    'investigate': 'bg-warning-subtle text-warning',
    'monitor': 'bg-info-subtle text-info',
    'informational': 'bg-secondary-subtle text-secondary'
  }
  return classMap[urgencyLabel || 'informational'] || 'bg-secondary-subtle text-secondary'
}

function getPreviewRowIcon(row: PreviewRow): string {
  const id = (row.id || '').toLowerCase()
  
  // Map V2 row IDs to icons matching V1's severity-based icon approach
  // V1 uses: bi-exclamation-triangle-fill, bi-exclamation-circle-fill, bi-arrow-up-circle-fill, 
  //          bi-check-circle-fill, bi-info-circle-fill, bi-code-square, bi-git, bi-clock-history, etc.
  
  // Exact ID matching for all canonical V2 preview rows
  // Icons chosen to match V1's semantic meaning and severity-based icon choices
  const iconMap: Record<string, string> = {
    // Commits and delivery metrics (info severity - cyan)
    'commits-per-session-by-ide': 'bi-code-square',
    'delivery-rate-ai-vs-non-ai': 'bi-check-circle-fill', // Positive metric - use check circle like V1 highlight
    
    // PR metrics (info severity - cyan)
    'pr-cycle-time-by-ide': 'bi-git',
    'session-conditioned-pr-cycle-time-ai-vs-non-ai': 'bi-git',
    'pr-size-by-ide': 'bi-file-earmark-code',
    
    // Revert and failure metrics (warning/risk severity - yellow/red)
    'revert-rate-by-ide': 'bi-exclamation-triangle-fill', // Warning severity icon
    'session-conditioned-change-risk-ai-vs-non-ai': 'bi-exclamation-triangle-fill', // Risk severity icon
    
    // Time metrics (info severity - cyan)
    'time-to-first-commit-by-ide': 'bi-clock-history',
    
    // Rework and quality metrics (warning severity - yellow)
    'ai-rework-burden-ai-vs-non-ai': 'bi-exclamation-circle-fill', // Warning severity icon
    'ai-yield-ratio-ai-vs-non-ai': 'bi-arrow-up-circle-fill', // Opportunity severity icon - positive metric
    
    // Branch and abandonment metrics (lowlight/warning severity - yellow)
    'branch-stagnation-risk-ai-vs-non-ai': 'bi-info-circle-fill', // Lowlight severity icon
    'commit-abandonment-rate-ai-vs-non-ai': 'bi-exclamation-circle-fill', // Warning severity icon
    
    // New V2 PIs (promoted from V1 with enhancements)
    'deployment-frequency-volatility-by-ide': 'bi-graph-up-arrow', // Info severity - deployment cadence
    'change-failure-rate-trend-by-ide': 'bi-exclamation-triangle-fill', // Warning/risk severity - quality trend
    'change-failure-rate-spike-by-ide': 'bi-exclamation-triangle-fill', // Risk severity - quality spike
    'review-latency-spike-by-ide': 'bi-clock-history', // Warning severity - review bottleneck
    'pr-cycle-time-bottleneck-by-ide': 'bi-git', // Warning severity - PR bottleneck
    'fast-but-unstable-by-ide': 'bi-exclamation-circle-fill', // Warning severity - velocity/reliability tradeoff
    'mttr-by-ide': 'bi-arrow-counterclockwise', // Info severity - recovery time
  }
  
  // Try exact match first
  if (iconMap[id]) {
    return iconMap[id]
  }
  
  // Fallback to pattern matching for any non-canonical rows
  if (id.includes('commits-per-session')) return 'bi-code-square'
  if (id.includes('delivery-rate')) return 'bi-check-circle-fill'
  if (id.includes('pr-cycle-time') || id.includes('session-conditioned-pr-cycle-time')) return 'bi-git'
  if (id.includes('pr-size')) return 'bi-file-earmark-code'
  if (id.includes('revert-rate')) return 'bi-exclamation-triangle-fill'
  if (id.includes('change-risk') || id.includes('change-failure')) return 'bi-exclamation-triangle-fill'
  if (id.includes('time-to-first-commit') || id.includes('ttfc')) return 'bi-clock-history'
  if (id.includes('rework-burden') || id.includes('rework')) return 'bi-exclamation-circle-fill'
  if (id.includes('yield-ratio')) return 'bi-arrow-up-circle-fill'
  if (id.includes('branch-stagnation') || id.includes('stagnation')) return 'bi-info-circle-fill'
  if (id.includes('commit-abandonment') || id.includes('abandonment')) return 'bi-exclamation-circle-fill'
  if (id.includes('deployment-frequency-volatility')) return 'bi-graph-up-arrow'
  if (id.includes('change-failure-rate-trend')) return 'bi-exclamation-triangle-fill'
  if (id.includes('change-failure-rate-spike')) return 'bi-exclamation-triangle-fill'
  if (id.includes('review-latency-spike')) return 'bi-clock-history'
  if (id.includes('pr-cycle-time-bottleneck')) return 'bi-git'
  if (id.includes('fast-but-unstable')) return 'bi-exclamation-circle-fill'
  if (id.includes('mttr')) return 'bi-arrow-counterclockwise'
  
  // Default: use V1's info icon (matches V1's default for info severity)
  return 'bi-info-circle-fill'
}

function getPreviewRowSeverityClass(row: PreviewRow): string {
  const id = (row.id || '').toLowerCase()
  
  // Map V2 row IDs to severity classes matching V1's severity-based color approach
  // V1 severity colors:
  // - critical/risk: red (#dc3545)
  // - warning/lowlight: yellow (#ffc107)
  // - opportunity: blue (#0d6efd)
  // - highlight: green (#198754)
  // - info: cyan (#0dcaf0)
  
  // Risk/warning metrics (negative indicators)
  if (id.includes('revert-rate')) return 'severity-warning'
  if (id.includes('change-risk') || id.includes('change-failure')) return 'severity-risk'
  if (id.includes('commit-abandonment') || id.includes('abandonment')) return 'severity-warning'
  if (id.includes('branch-stagnation') || id.includes('stagnation')) return 'severity-lowlight'
  if (id.includes('rework-burden') || id.includes('rework')) return 'severity-warning'
  
  // Positive metrics (good outcomes)
  if (id.includes('delivery-rate')) return 'severity-highlight'
  if (id.includes('yield-ratio')) return 'severity-opportunity'
  
  // Neutral metrics (informational)
  if (id.includes('commits-per-session')) return 'severity-info'
  if (id.includes('pr-cycle-time') || id.includes('session-conditioned-pr-cycle-time')) return 'severity-info'
  if (id.includes('pr-size')) return 'severity-info'
  if (id.includes('time-to-first-commit') || id.includes('ttfc')) return 'severity-info'
  if (id.includes('deployment-frequency-volatility')) return 'severity-info'
  if (id.includes('mttr')) return 'severity-info'
  
  // Warning metrics (require attention)
  if (id.includes('review-latency-spike')) return 'severity-warning'
  if (id.includes('pr-cycle-time-bottleneck')) return 'severity-warning'
  if (id.includes('fast-but-unstable')) return 'severity-warning'
  if (id.includes('change-failure-rate-trend')) return 'severity-warning'
  
  // Risk metrics (critical issues)
  if (id.includes('change-failure-rate-spike')) return 'severity-risk'
  
  // Default: use V1's info severity (cyan background)
  return 'severity-info'
}

function getScopeLabel(insight: PerformanceInsight): string {
  const tools = insight.related?.tools || []
  if (tools.length === 1) return `IDE: ${getToolLabel(tools[0])}`
  return 'ORG'
}

function getScopePillClass(insight: PerformanceInsight): string {
  const tools = insight.related?.tools || []
  if (tools.length > 0) return 'bg-light text-dark border'
  return 'bg-secondary-subtle text-secondary'
}

function getSourceDotClass(insight: PerformanceInsight): string {
  if (!insight.dataSource) return 'bg-secondary-subtle text-secondary'
  if (insight.dataSource === 'real') return 'bg-success-subtle text-success'
  if (insight.dataSource === 'mixed') return 'bg-info-subtle text-info'
  return 'bg-secondary-subtle text-secondary'
}

function isSessionLengthDiagnostic(insight: PerformanceInsight): boolean {
  const detector = insight.tags?.find(t => t === 'session-length-increase' || t === 'session-length-decrease')
  return insight.metricId === 'ide.session_length' && !!detector && (insight.related?.tools?.length || 0) === 1
}

function parseNumericEvidence(insight: PerformanceInsight, labelIncludes: string): number | null {
  const needle = labelIncludes.toLowerCase()
  const ev = (insight.evidence || []).find(e => (e.label || '').toLowerCase().includes(needle))
  if (!ev) return null
  const raw = ev.value
  if (typeof raw === 'number' && isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '' && isFinite(Number(raw))) return Number(raw)
  return null
}

function computeSessionLengthDeltaPct(insight: PerformanceInsight): number | null {
  const current = parseNumericEvidence(insight, 'avg session')
  const baseline = parseNumericEvidence(insight, 'baseline')
  if (!current || !baseline || baseline <= 0) return null
  return ((current - baseline) / baseline) * 100
}

function groupStripInsightsForDisplay(items: PerformanceInsight[]): PerformanceInsight[] {
  const insights = Array.isArray(items) ? [...items] : []
  const sessionLen = insights.filter(isSessionLengthDiagnostic)
  if (sessionLen.length <= 1) return insights

  const byDir = new Map<'increase' | 'decrease', PerformanceInsight[]>()
  byDir.set('increase', [])
  byDir.set('decrease', [])
  for (const it of sessionLen) {
    const dir = it.tags?.includes('session-length-increase') ? 'increase' : 'decrease'
    byDir.get(dir as any)!.push(it)
  }

  const combined: PerformanceInsight[] = []
  for (const dir of ['increase', 'decrease'] as const) {
    const group = byDir.get(dir) || []
    if (group.length <= 1) continue

    const withDelta = [...group]
      .map(i => ({ i, delta: computeSessionLengthDeltaPct(i) ?? (dir === 'increase' ? 0 : 0) }))
      .sort((a, b) => dir === 'increase' ? (b.delta - a.delta) : (a.delta - b.delta))

    const most = withDelta[0]?.i
    if (!most) continue

    const parts = withDelta.slice(0, 2).map(x => {
      const tool = x.i.related?.tools?.[0] ? getToolLabel(x.i.related.tools[0]) : 'IDE'
      const sign = x.delta >= 0 ? '+' : ''
      return `${tool} ${sign}${Math.round(x.delta)}%`
    })

    const title = dir === 'increase'
      ? `Org session length increased by IDE (${parts.join(', ')})`
      : `Org session length decreased by IDE (${parts.join(', ')})`

    const combinedInsight: PerformanceInsight = {
      ...most,
      id: `strip-group-session-length-${dir}`,
      title,
      description: most.description,
      related: { tools: [] },
      toolScope: 'cross-ide',
      tags: Array.from(new Set([...(most.tags || []), 'strip-group'])),
      supportingContext: group.map(g => ({
        id: g.id,
        title: g.title,
        metricId: g.metricId,
        evidence: g.evidence || []
      }))
    }

    combined.push(combinedInsight)
  }

  if (combined.length === 0) return insights

  const groupedIds = new Set(sessionLen.map(i => i.id))
  const remaining = insights.filter(i => !groupedIds.has(i.id))
  return [...combined, ...remaining]
}

function getDisplayTitle(insight: PerformanceInsight): string {
  return hardenPerformanceInsightForUi(insight).title
}

function getSourceBadge(insight: PerformanceInsight): string | undefined {
  if (!insight.dataSource) return undefined
  const sourceMap: Record<string, string | undefined> = {
    'real': 'LIVE',
    'mixed': 'HYBRID',
    'sim': 'SIM',
    'unknown': undefined
  }
  return sourceMap[insight.dataSource] || undefined
}

function getSourceBadgeClass(insight: PerformanceInsight): string {
  if (!insight.dataSource) return ''
  if (insight.dataSource === 'real') return 'bg-success'
  if (insight.dataSource === 'mixed') return 'bg-info'
  return 'bg-secondary'
}

function getSeverityRailClass(severity: string): string {
  const s = String(severity || '').toLowerCase()
  // Only CRITICAL gets red - MEDIUM items use neutral/amber/gray
  if (s === 'critical') return 'insight-strip-row--rail-danger'
  if (s === 'risk') return 'insight-strip-row--rail-warning'
  if (s === 'warning' || s === 'lowlight') return 'insight-strip-row--rail-neutral'
  if (s === 'highlight') return 'insight-strip-row--rail-success'
  return 'insight-strip-row--rail-primary'
}
function convertToInsight(insight: PerformanceInsight): Insight {
  const hardened = hardenPerformanceInsightForUi(insight)
  return {
    id: insight.id,
    title: hardened.title,
    summary: hardened.summary,
    severity: insight.severity as any,
    scope: (insight.toolScope === 'org' ? 'org' : 'tool') as any,
    entityId: insight.related?.tools?.[0] || insight.related?.teams?.[0],
    metricId: insight.metricId || 'unknown',
    metricKind: insight.source === 'github' ? 'github' : 'productivity' as any,
    value: null,
    baseline: null,
    deltaPct: null,
    evidence: hardened.evidence.map(e => ({
      label: e.label || '',
      value: e.value ?? ''
    })),
    recommendedAction: hardened.recommendedAction,
    recommendedOwners: [],
    tags: insight.tags || [],
    dataSource: insight.source === 'github' ? 'Real' : insight.source === 'simulated' ? 'Simulated' : 'Mixed',
    alsoObservedIn: (insight as any).alsoObservedIn,
    timeRangeLabel: 'Recent period'
  } as any
}

function convertPreviewRowToInsight(row: PreviewRow): Insight {
  // V1-style structure for ALL insights (no distinction between demo_primary and demo_secondary)
  // Convert V2 preview row to Insight format for InsightExpandedPanel
  const evidence: Array<{ label: string; value: string | number }> = []
  
  // PART C: Format unit count helper (replaces "N periods" with "last N weeks")
  // Declare once at the top of the function
  const formatUnitCount = (count: number, unitType: 'sessions' | 'periods' | 'prs', granularity: 'weekly' | 'daily' | 'monthly' = 'weekly'): string => {
    if (unitType === 'sessions') {
      return `${count} session${count !== 1 ? 's' : ''}`;
    }
    if (unitType === 'prs') {
      return `${count} PR${count !== 1 ? 's' : ''}`;
    }
    // unitType === 'periods'
    if (granularity === 'weekly') {
      return `last ${count} week${count !== 1 ? 's' : ''}`;
    }
    if (granularity === 'daily') {
      return `last ${count} day${count !== 1 ? 's' : ''}`;
    }
    if (granularity === 'monthly') {
      return `last ${count} month${count !== 1 ? 's' : ''}`;
    }
    return `${count} period${count !== 1 ? 's' : ''}`;
  };
  
  // V1-style structure: What's happening → Why it matters → Evidence → Recommendation
  // 1. What's happening (1 sentence from title + rightMetric)
  const takeaway = row.title || row.subtitle || ''
    
    // 2. Evidence summary (counts, coverage %, tools involved)
    const coveragePct = (row as any).signalCoveragePct ?? (row as any).coveragePct ?? 0
    const contributingUnits = (row as any).contributingUnitsCount ?? (row as any).n ?? 0
    const unitType = (row as any).contributingUnitType ?? 'sessions'
    const dataMaturity = (row as any).dataMaturityLabel ?? 'Early Signal'
    const primarySignals = (row as any).primarySignalsUsed ?? []
    
    // Add evidence summary (coverage, units, maturity) - PART C: Use formatUnitCount
    if (coveragePct > 0 || contributingUnits > 0) {
      evidence.push({
        label: 'Signal coverage',
        value: `${coveragePct.toFixed(1)}%`
      })
      const timeWindow = formatUnitCount(contributingUnits, unitType, 'weekly');
      evidence.push({
        label: 'Contributing units',
        value: timeWindow
      })
    }
    if (primarySignals.length > 0) {
      evidence.push({
        label: 'Data sources',
        value: primarySignals.join(', ')
      })
    }
    evidence.push({
      label: 'Data maturity',
      value: dataMaturity
    })
    
    // 3. Breakdown by tool or AI vs non-AI (top 3 only)
    if (row.detail?.breakdownByTool && Array.isArray(row.detail.breakdownByTool)) {
      const topTools = [...row.detail.breakdownByTool]
        .sort((a, b) => (b.n || 0) - (a.n || 0))
        .slice(0, 3)
      for (const breakdown of topTools) {
        evidence.push({
          label: `${breakdown.tool}`,
          value: `${breakdown.value} (${breakdown.n} ${unitType})`
        })
      }
    } else if (row.detail?.breakdownByTool && typeof row.detail.breakdownByTool === 'object') {
      const entries = Object.entries(row.detail.breakdownByTool)
        .slice(0, 3)
      for (const [tool, value] of entries) {
        evidence.push({
          label: tool,
          value: String(value)
        })
      }
    }
    
    // Breakdown by period (most recent 2 only) - PART C: Replace "periods" with time
    if (row.detail?.breakdownByPeriod && Array.isArray(row.detail.breakdownByPeriod)) {
      const recentPeriods = row.detail.breakdownByPeriod.slice(-2)
      for (const breakdown of recentPeriods) {
        const unitType = (row as any).contributingUnitType || 'periods';
        const timeWindow = formatUnitCount(breakdown.n || 0, unitType, 'weekly');
        evidence.push({
          label: breakdown.periodLabel,
          value: `${breakdown.value} (${timeWindow})`
        })
      }
    }
    
    // PHASE 1: Use explicit whatsHappening and whyItMatters from row (V2 fields)
    // DO NOT combine into summary - pass as separate fields for V2 insights
    const whatsHappening = (row as any).whatsHappening || '';
    const whyItMatters = (row as any).whyItMatters || '';
    
    // Fallback summary for legacy V1 insights (only if explicit fields are missing)
    const summary = (!whatsHappening && !whyItMatters) 
      ? (takeaway && row.rightMetric
          ? `${takeaway}. Current value: ${row.rightMetric}.`
          : takeaway || row.subtitle || row.definition || row.detail?.definition || '')
      : [whatsHappening, whyItMatters].filter(Boolean).join(' ')
    
    // Extract Owner from row (V1-style actionability)
    const owner = (row as any).owner
    const recommendedOwners = Array.isArray(owner) ? owner : (owner ? [owner] : ['Engineering team'])
    
    // Step 3: Helper function to get recommendation text (precedence: top-level > recommendedAction > detail.recommendation)
    function getRecommendationText(r: any): string | undefined {
      return r.recommendation ?? r.recommendedAction ?? r.detail?.recommendation ?? undefined
    }
    
    const recommendationText = getRecommendationText(row)
    
    // Step 3: Debug recommendation in adapter
    const PI_DEBUG_ENV = (import.meta as any).env?.VITE_PI_DEBUG ?? 'false'
    const PI_DEBUG = PI_DEBUG_ENV === 'true' || PI_DEBUG_ENV === '1'
    if (PI_DEBUG) {
      console.log('[PI_DEBUG][STEP3][ADAPTER]', {
        id: row.id,
        rowRecommendation: (row as any).recommendation || '(missing)',
        insightRecommendedAction: recommendationText || '(missing)'
      });
    }
    
    return {
      id: row.id || 'preview-row',
      title: row.title,
      summary: summary || row.subtitle || '',
      severity: 'info' as any,
      scope: 'org' as any,
      entityId: undefined,
      metricId: row.id || 'unknown',
      metricKind: 'github' as any,
      value: null,
      baseline: null,
      deltaPct: null,
      evidence: evidence,
      recommendedAction: recommendationText,
      recommendedOwners: recommendedOwners, // Owner field (V1-style actionability)
      tags: row.badges || [],
      dataSource: 'Real',
      demoFlag: (row as any).demoFlag || undefined, // Pass through demoFlag for expanded panel
      alsoObservedIn: [],
      timeRangeLabel: 'Recent period',
      // PHASE 1: Pass explicit V2 narrative fields (separate from summary)
      whatsHappening: whatsHappening || undefined,
      whyItMatters: whyItMatters || undefined
    } as any
}
</script>

<style scoped>
.insight-strip {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.insight-strip-row {
  border: 1px solid #e9ecef;
  border-radius: 0.375rem;
  background: #ffffff;
  transition: all 0.2s ease;
}

.insight-strip-row:hover {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

.insight-strip-row-collapsed {
  padding: 0.4rem 0.6rem; /* Tighter padding */
  cursor: pointer;
  min-height: 2rem; /* Reduced */
  border-radius: 6px;
  transition: all 0.15s ease;
}

.insight-strip-preview-clickable {
  cursor: pointer;
}

.insight-strip-preview-clickable:hover {
  background: rgba(13, 110, 253, 0.03);
}

.insight-strip-severity {
  width: 1.35rem; /* Reduced */
  height: 1.35rem; /* Reduced */
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 0.7rem; /* Reduced */
}

.insight-strip-severity.severity-critical {
  background: #dc3545;
  color: white;
}

.insight-strip-severity.severity-risk {
  background: rgba(220, 53, 69, 0.4); /* Reduced red intensity by 60% */
  color: #dc3545;
}

.insight-strip-severity.severity-warning {
  background: rgba(255, 193, 7, 0.3); /* Reduced orange intensity */
  color: #856404;
}

.insight-strip-severity.severity-lowlight {
  background: rgba(255, 193, 7, 0.2); /* Subtle yellow */
  color: #856404;
}

.insight-strip-severity.severity-opportunity {
  background: #0d6efd;
  color: white;
}

.insight-strip-severity.severity-highlight {
  background: #198754;
  color: white;
}

.insight-strip-severity.severity-info {
  background: #0dcaf0;
  color: #212529;
}

.insight-strip-scope-pill {
  font-size: 0.6rem; /* Reduced */
  padding: 0.15rem 0.35rem; /* Tighter */
  opacity: 0.85; /* Reduced dominance */
}

.insight-strip-source-dot {
  font-size: 0.55rem; /* Reduced */
  padding: 0.1rem 0.3rem; /* Tighter */
  opacity: 0.75; /* Reduced dominance */
}

.insight-strip-row {
  border-left: 3px solid transparent;
  border-radius: 6px;
  margin-bottom: 0.3rem; /* Tighter spacing */
  background: white;
  border: 1px solid #e2e8f0; /* Stronger */
  transition: all 0.2s ease;
}

.insight-strip-row:hover {
  transform: translateX(2px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  border-color: #cbd5e1;
}

/* SDLC phase indicator - visually strengthened */
.insight-strip-row[data-pi-stage="plan-code"] {
  border-left-color: #0ea5e9;
}

.insight-strip-row[data-pi-stage="review-merge"] {
  border-left-color: #8b5cf6;
}

.insight-strip-row[data-pi-stage="deploy-operate"] {
  border-left-color: #f97316;
}

/* Priority indicator - visually strengthened */
.insight-strip-row[data-pi-priority="critical"] {
  border-left-color: #dc2626;
}

.insight-strip-row[data-pi-priority="high"] {
  border-left-color: #f59e0b;
}

.insight-strip-row--rail-danger { border-left-color: #dc2626; background: #fef2f2; }
.insight-strip-row--rail-warning { border-left-color: #d97706; background: #fffbeb; }
.insight-strip-row--rail-neutral { border-left-color: #64748b; }
.insight-strip-row--rail-success { border-left-color: #16a34a; background: #f0fdf4; }
.insight-strip-row--rail-primary { border-left-color: #3b82f6; background: #eff6ff; }

/* Selected state - FINAL PASS: Active operational incident/intelligence item */
.insight-strip-row.selected {
  border-left-width: 5px;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.3);
  border-color: #2563eb;
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  transform: translateX(2px);
}

.insight-strip-row.selected:hover {
  box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.35);
  transform: translateX(3px);
}

.insight-strip-row.selected .insight-strip-title {
  color: #1e3a8a;
  font-weight: 800; /* Extra bold */
}

.insight-strip-title {
  font-weight: 700; /* Increased */
  font-size: 0.8rem; /* Reduced */
  color: #1e293b; /* Darker for contrast */
  line-height: 1.25; /* Tighter */
  max-height: 3.75em; /* Max 3 lines */
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
}

.insight-strip-evidence {
  font-size: 0.8125rem;
}

.insight-strip-evidence-item {
  white-space: nowrap;
  font-size: 0.68rem; /* Reduced */
  color: #475569; /* Darker for contrast */
}

.insight-strip-evidence-label {
  color: #64748b; /* Darker for contrast */
  margin-right: 0.25rem;
  font-weight: 700; /* Increased */
}

.insight-strip-evidence-value {
  color: #0f172a; /* Darkest for contrast */
  font-weight: 800; /* Extra bold */
}

.insight-strip-context-badge {
  font-size: 0.65rem;
  padding: 0.2rem 0.4rem;
  background: #6c757d;
  color: white;
}

.insight-strip-ide-badge,
.insight-strip-source-badge {
  font-size: 0.65rem;
  padding: 0.2rem 0.4rem;
}

.insight-strip-chevron {
  color: #94a3b8; /* Darker for contrast */
  font-size: 0.65rem; /* Reduced */
  flex-shrink: 0;
  opacity: 0.7; /* Reduced prominence */
}

.insight-strip-row-expanded {
  padding: 0.75rem;
  padding-top: 0;
  border-top: 1px solid #e9ecef;
  margin-top: 0.5rem;
}

.insight-strip-description {
  font-size: 0.875rem;
  color: #495057;
  line-height: 1.5;
}

.insight-strip-evidence-full {
  font-size: 0.8125rem;
}

.insight-strip-evidence-full-item {
  display: flex;
  align-items: center;
}

.insight-strip-action {
  font-size: 0.875rem;
}

.insight-strip-action-text {
  color: #495057;
  margin-top: 0.25rem;
}

/* Mobile responsive */
@media (max-width: 768px) {
  .insight-strip-row-collapsed {
    flex-wrap: wrap;
    min-height: auto;
  }

  .insight-strip-title {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    width: 100%;
    margin-bottom: 0.25rem;
  }

  .insight-strip-evidence {
    flex-wrap: wrap;
  }
}
</style>
