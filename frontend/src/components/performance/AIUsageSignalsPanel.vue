<template>
  <!-- ACTIVE CANONICAL COMPONENT - AIUsageSignalsPanel.vue -->
  <!-- This is the production-mounted component for AI Usage Signals -->
  <!-- Render path: Dashboards.vue → AIUsageSignalsSection.vue → AIUsageSignalsPanel.vue -->
  <!-- Measured-only: every value rendered is directly derived from canonical -->
  <!-- aggregated telemetry. No fabricated scores, no static provider lists. -->
  <div class="ai-executive-signals">
    <!-- Unified AI Operational Intelligence Header -->
    <div class="cm-header-dense cicd-section-header d-flex align-items-start justify-content-between gap-2 mb-2">
      <div class="d-flex align-items-start gap-2">
        <div class="stage-icon-wrapper bg-primary">
          <i class="bi bi-robot text-white"></i>
        </div>
        <div>
          <h5 class="mb-0 fw-semibold">AI Operational Intelligence</h5>
          <small class="cm-subtitle-dense text-muted">Measured from canonical telemetry</small>
        </div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <span v-if="props.canonicalHydrating" class="badge badge-sm bg-light text-muted">
          <span class="placeholder placeholder-xs" style="width: 3rem;"></span>
        </span>
        <span v-else class="badge badge-sm bg-primary-subtle text-primary">
          {{ canonicalSessionPopulation }} sessions
        </span>
        <span v-if="props.canonicalHydrating" class="badge badge-sm bg-light text-muted">
          <span class="placeholder placeholder-xs" style="width: 4rem;"></span>
        </span>
        <span v-else class="badge badge-sm bg-secondary-subtle text-secondary">
          {{ allMeasuredWorkflows.length }} tracked workflows
        </span>
        <span v-if="!props.canonicalHydrating && canonicalSessionPopulation === 0" class="badge badge-sm bg-secondary-subtle text-secondary">
          <i class="bi bi-dash-circle me-1"></i>No Data
        </span>
        <span v-else-if="!props.canonicalHydrating && hasInsufficientData" class="badge badge-sm bg-warning-subtle text-warning">
          <i class="bi bi-exclamation-triangle me-1"></i>Limited Data
        </span>
        <span v-else-if="!props.canonicalHydrating && props.evidenceCompleteness === 'partial'" class="badge badge-sm bg-warning-subtle text-warning-emphasis border border-warning">
          <i class="bi bi-exclamation-triangle me-1"></i>Partial evidence
        </span>
        <span v-else-if="!props.canonicalHydrating && props.evidenceCompleteness === 'error'" class="badge badge-sm bg-danger-subtle text-danger-emphasis border border-danger">
          <i class="bi bi-x-circle me-1"></i>Evidence unavailable
        </span>
        <span v-else-if="!props.canonicalHydrating" class="badge badge-sm bg-success-subtle text-success">
          <i class="bi bi-check-circle me-1"></i>Strong Signal
        </span>
        <small class="text-muted" style="font-size: 0.7rem;">{{ trailingStatusLabel }}</small>
      </div>
    </div>

    <!-- Defensive Error Rendering -->
    <div v-if="aiOpsRenderError" class="alert alert-warning mb-3">
      <i class="bi bi-exclamation-triangle-fill me-2"></i>
      AI Operational Intelligence temporarily unavailable. Performance Insights remain active.
    </div>

    <!-- CR-X AH-3: ERROR != EMPTY — canonical fetch failure must not show "Ready for your first telemetry" -->
    <div v-else-if="props.canonicalError" class="aioi-error-state mb-3">
      <div class="d-flex align-items-center gap-2 text-danger">
        <i class="bi bi-exclamation-triangle-fill"></i>
        <span>Workflow intelligence unavailable — telemetry service error. This is a temporary error, not an empty pilot. Please refresh.</span>
      </div>
    </div>

    <!-- Loading state — canonical telemetry still hydrating -->
    <div v-else-if="props.canonicalHydrating" class="aioi-loading-state mb-3">
      <div class="d-flex align-items-center gap-2">
        <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
        <span class="text-muted">Loading workflow intelligence…</span>
      </div>
    </div>

    <!-- Empty state — only after authoritative canonical telemetry returns zero -->
    <div v-else-if="allMeasuredWorkflows.length === 0" class="aioi-empty-state mb-3">
      <h6 class="fw-semibold mb-1">Ready for your first telemetry</h6>
      <p class="text-muted mb-1">Install the ChaosMonkey extension, connect it to this pilot API, and start coding. Your first workflow sessions will appear here automatically.</p>
      <p class="text-muted small mb-0">Pilot API: <code>{{ pilotApiBase }}</code></p>
    </div>

    <!-- Workflow Intelligence Cards — one unified grid -->
    <div v-else>
      <div class="aioi-grid">
        <div
          v-for="ide in orderedWorkflows"
          :key="ide.toolId"
          class="aioi-card"
          :class="{ 'aioi-card-emerging': isEmerging(ide) }"
        >
          <!-- Identity row — workflow name only -->
          <div class="aioi-identity">
            <span class="aioi-name">{{ ide.name }}</span>
          </div>

          <!-- Quiet metadata row — maturity dot + text, surface tag, mode tag -->
          <div class="aioi-meta-row">
            <span
              class="aioi-maturity-dot"
              :class="{ 'aioi-maturity-dot-emerging': isEmerging(ide) }"
              aria-hidden="true"
            ></span>
            <span
              class="aioi-maturity"
              :class="{ 'aioi-maturity-emerging': isEmerging(ide) }"
            >
              {{ isEmerging(ide) ? 'Emerging' : 'Strong' }}
            </span>
            <span
              v-if="ide.modality === 'terminal'"
              class="aioi-surface-tag"
            >
              Terminal
            </span>
            <span
              v-if="ide.operationalMode === 'delegated_agent'"
              class="aioi-mode-tag"
            >
              Delegated agent
            </span>
          </div>

          <!-- Hero -->
          <div class="aioi-hero">
            <span class="aioi-hero-val">{{ getHeroMetricValue(ide) }}</span>
            <span class="aioi-hero-lbl">{{ getHeroMetricLabel(ide) }}</span>
          </div>

          <!-- Session share -->
          <div class="aioi-share-line">
            {{ formatSessionCount(ide.sessionCount) }} sessions · {{ getSessionSharePct(ide) }} of observed sessions
          </div>
          <div v-if="!isEmerging(ide) && getSessionSharePctNum(ide) >= 2" class="aioi-share-bar">
            <div class="aioi-share-bar-fill" :style="{ width: getSessionSharePctNum(ide) + '%' }"></div>
          </div>

          <!-- Emerging: sessions to primary -->
          <div v-if="isEmerging(ide)" class="aioi-to-primary">
            {{ sessionsToPrimary(ide) }} to primary
          </div>

          <!-- Divider before supporting signals -->
          <div class="aioi-divider"></div>

          <!-- Supporting signals — label-over-value pairs -->
          <div class="aioi-signals">
            <div
              v-for="(metric, idx) in getSecondaryMetrics(ide)"
              :key="idx"
              class="aioi-signal-pair"
            >
              <span class="aioi-signal-lbl">{{ metric.label }}</span>
              <span class="aioi-signal-val">{{ metric.value }}</span>
            </div>
          </div>

          <!-- CR-X P1B.2 Production-Value: compact economics line -->
          <!-- Reuses canonical cost authority. Omitted cleanly if no configured cost. -->
          <div v-if="getEconomicsLine(ide)" class="aioi-economics">
            <div class="aioi-economics-divider"></div>
            {{ getEconomicsLine(ide) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// ACTIVE CANONICAL COMPONENT - AIUsageSignalsPanel.vue
// This is the production-mounted component for AI Usage Signals
// Render path: Dashboards.vue → AIUsageSignalsSection.vue → AIUsageSignalsPanel.vue
//
// MEASURED-ONLY CONTRACT: every value rendered here is directly derived from
// canonical aggregated telemetry via buildMeasuredWorkflowIntelligence. No
// fabricated stability/merge/delivery/review scores, no static provider list,
// no card-count limit, no PBT-style 25-session eligibility threshold.

import { computed, ref } from 'vue'
import { getCanonicalWorkflowIdentity } from '@/lib/workflowIdentity'
import { isDelegatedAgentWorkflow, isMetricInstrumentedForWorkflow as isMetricInstrumentedByContract } from '@/lib/surfaceAgentContract'
import { buildMeasuredWorkflowIntelligence } from '@/lib/aioi/buildMeasuredWorkflowIntelligence'
import { getOperationalSignalText } from '@/lib/insights/runtimeMode'

const props = defineProps({
  scope: { type: String, default: 'org' },
  canonicalAggregated: { type: Array as () => any[], default: () => [] },
  canonicalAggregatedMetadata: { type: Object as () => Record<string, any>, default: () => ({}) },
  canonicalHydrating: { type: Boolean, default: false },
  canonicalError: { type: String as () => string | null, default: null },
  evidenceCompleteness: { type: String as () => 'full' | 'partial' | 'error' | 'loading', default: 'loading' },
  evidenceStatusLabel: { type: String, default: 'Loading historical telemetry…' },
  // CR5 WS1 — shared observed commit/TTFC authority. When present (even as
  // an empty Map), commits/session and TTFC come only from this authority.
  // Empty Map => unavailable. NEVER falls back to synthetic aggregated values.
  observedAuthority: { type: Object as () => Map<string, any>, default: () => new Map() },
})

const pilotApiBase = computed(() => {
  const base = import.meta.env.VITE_API_BASE_URL
  if (base) {
    return base.replace(/\/$/, '').replace(/\/api$/, '')
  }
  // No build-time API base: use the current origin (same as config/api.js).
  return window.location.origin
})

// Defensive error state for AI Ops rendering
const aiOpsRenderError = ref(false)
const telemetryStatusLabel = computed(() => getOperationalSignalText())

// Canonical session population, per canonical metadata (source of truth for
// the header badge). Falls back to summing measured workflow session counts
// if metadata is not yet populated.
const canonicalSessionPopulation = computed(() => {
  const fromMetadata = Number(props.canonicalAggregatedMetadata?.canonical_population_count)
  if (Number.isFinite(fromMetadata) && fromMetadata > 0) return fromMetadata
  return allMeasuredWorkflows.value.reduce((sum, ide) => sum + (ide.sessionCount || 0), 0)
})

// Only show "Limited Data" when the canonical population itself is small
const hasInsufficientData = computed(() => canonicalSessionPopulation.value < 10)

// Trailing status text: at canonical zero telemetry the loaded-state labels
// ("Historical telemetry loaded" / "Live telemetry active") are false.
const trailingStatusLabel = computed(() => {
  if (props.canonicalHydrating || props.evidenceCompleteness === 'loading') return 'Loading telemetry…'
  if (canonicalSessionPopulation.value === 0) return 'Waiting for first telemetry'
  return props.evidenceStatusLabel || telemetryStatusLabel.value
})

// Measured workflow intelligence — the single source of truth for AIOI cards.
// No fabricated scores. No static provider list.
// AIOI contract: render every primary measured workflow (>= 25 sessions).
// Emerging workflows (< 25 sessions) are rendered separately.
// The tracked workflow count in the header reflects the full universe.
const PRIMARY_SESSION_THRESHOLD = 25

const allMeasuredWorkflows = computed(() => {
  try {
    return buildMeasuredWorkflowIntelligence(
      props.canonicalAggregated,
      props.canonicalAggregatedMetadata,
      getCanonicalWorkflowIdentity,
      props.observedAuthority
    )
  } catch (error) {
    console.error('[AIOI_MEASURED_RENDER_ERROR] Measured workflow intelligence computation failed:', error)
    aiOpsRenderError.value = true
    return []
  }
})

// One ordered collection: primary workflows first (>= 25 sessions),
// then emerging workflows (< 25 sessions, > 0). Both in the same grid.
const orderedWorkflows = computed(() =>
  allMeasuredWorkflows.value
    .filter(w => w.sessionCount > 0)
    .sort((a, b) => {
      const aEmerging = a.sessionCount < PRIMARY_SESSION_THRESHOLD
      const bEmerging = b.sessionCount < PRIMARY_SESSION_THRESHOLD
      if (aEmerging !== bEmerging) return aEmerging ? 1 : -1
      return b.sessionCount - a.sessionCount
    })
)

function isEmerging(ide: any): boolean {
  return ide.sessionCount < PRIMARY_SESSION_THRESHOLD
}

function sessionsToPrimary(ide: any): number {
  return Math.max(PRIMARY_SESSION_THRESHOLD - ide.sessionCount, 0)
}

// Metric definitions used for the primary KPI and the secondary stats grid.
// CR-X P0-3: Modality-aware hero selection. Terminal workflows (Claude Code)
// use session runtime as hero, NOT active coding (IDE-specific concept).
// Editor workflows use active coding min/session when authoritative.
interface MeasuredMetricDef {
  key: keyof typeof allMeasuredWorkflows.value[number]
  label: string
  format: (value: number) => string
}

const METRIC_DEFS: MeasuredMetricDef[] = [
  { key: 'activeCodingMinutesPerSession', label: 'Active coding / session', format: (v) => `${Math.round(v)}m` },
  { key: 'aiActivityPerSession', label: 'AI activity', format: (v) => v.toFixed(1) + '/session' },
  // 17G.4: commitsPerSession/timeToFirstCommitMinutes come from the shared
  // observed-commit authority — the denominator is only sessions with verified
  // commit evidence (session_has_commit_outcome && !simulated), NOT the full
  // canonical workflow population PBT's "Commits / Session" uses. Labels must
  // make that scope distinction explicit so the two surfaces cannot be mistaken
  // for the same metric.
  { key: 'commitsPerSession', label: 'Commits / observed session', format: (v) => v.toFixed(1) },
  { key: 'averageSessionLengthMinutes', label: 'Avg session', format: (v) => `${Math.round(v)}m` },
  { key: 'timeToFirstCommitMinutes', label: 'Time to first commit (observed)', format: (v) => `${Math.round(v)}m` },
  { key: 'activeCodingRatio', label: 'Active coding ratio', format: (v) => `${Math.round(v * 100)}%` },
  { key: 'aiUsageRatio', label: 'AI usage', format: (v) => `${Math.round(v * 100)}%` },
  { key: 'idleRatio', label: 'Idle ratio', format: (v) => `${Math.round(v * 100)}%` },
]

// CR-X P1B.2 Wave 0: Hero labels are OPERATIONAL-MODE-aware, not surface-aware.
// Delegated agents use "session runtime / session"; human-interactive uses "active coding / session".
const HERO_LABELS_BY_OPERATIONAL_MODE: Record<string, string> = {
  delegated_agent: 'session runtime / session',
  human_interactive: 'active coding / session',
}

// CR-X P1B.2 Wave 0: Secondary metric priority is OPERATIONAL-MODE-aware.
// Delegated agents prioritize AI activity, commits, TTFC, AI usage.
// Human-interactive workflows prioritize commits, AI activity, session length, TTFC.
const SECONDARY_PRIORITY_BY_OPERATIONAL_MODE: Record<string, string[]> = {
  delegated_agent: [
    'aiActivityPerSession',
    'commitsPerSession',
    'timeToFirstCommitMinutes',
    'aiUsageRatio',
    'averageSessionLengthMinutes',
  ],
  human_interactive: [
    'commitsPerSession',
    'aiActivityPerSession',
    'averageSessionLengthMinutes',
    'timeToFirstCommitMinutes',
    'aiUsageRatio',
  ],
}

// CR-X P1B.2 Wave 0: Mode-aware instrumentation gating.
// Delegated agents (Claude Code, Devin, future agents) suppress active-coding,
// focus, and idle metrics because they measure editor-window focus during agent
// operation, not human active coding. Previously this was a hardcoded claude_code set.
const HUMAN_INTERACTIVE_ONLY_METRICS = new Set([
  'activeCodingMinutesPerSession',
  'activeCodingRatio',
  'idleRatio',
  'focusRatio',
])

// Panel metric keys → canonical metric names in the instrumentation contract.
// The contract knows per-workflow exclusions (e.g. Codex emits lifecycle-only
// telemetry: no AI bursts, suggestions, commits, or TTFC evidence).
const CONTRACT_METRIC_NAME: Record<string, string> = {
  activeCodingMinutesPerSession: 'active_coding_time_minutes',
  averageSessionLengthMinutes: 'average_session_length_minutes',
  aiActivityPerSession: 'ai_suggestions_accepted',
  commitsPerSession: 'commits_per_session',
  timeToFirstCommitMinutes: 'time_to_first_commit_minutes',
  activeCodingRatio: 'active_coding_ratio',
  focusRatio: 'focus_ratio',
  aiUsageRatio: 'ai_usage_ratio',
  idleRatio: 'idle_ratio',
}

function isMetricInstrumentedForWorkflow(toolId: string, metricKey: string): boolean {
  // Mode-aware: delegated agents suppress human-interactive-only metrics
  if (isDelegatedAgentWorkflow(toolId) && HUMAN_INTERACTIVE_ONLY_METRICS.has(metricKey)) {
    return false
  }
  const contractMetric = CONTRACT_METRIC_NAME[metricKey]
  if (contractMetric && !isMetricInstrumentedByContract(toolId, contractMetric)) {
    return false
  }
  return true
}

function formatMetricValue(def: MeasuredMetricDef, ide: any): string {
  const raw = ide[def.key as string]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return '—'
  return def.format(raw)
}

// CR-X P0-3: Hero metric is determined by the builder's heroMetricKey,
// which is modality-aware. Terminal workflows use session runtime; editor
// workflows use active coding min/session.
function getHeroMetricDef(ide: any): MeasuredMetricDef | null {
  const heroKey = ide.heroMetricKey
  if (!heroKey) return null
  // Check if the hero metric has a finite value for this card
  const raw = ide[heroKey]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return METRIC_DEFS.find((d) => (d.key as string) === heroKey) ?? null
}

function getHeroMetricValue(ide: any): string {
  const def = getHeroMetricDef(ide)
  if (!def) return `${ide.sessionCount}`
  return formatMetricValue(def, ide)
}

function getHeroMetricLabel(ide: any): string {
  // CR-X P1B.2 Wave 0: Hero label is OPERATIONAL-MODE-aware, not surface-aware.
  const opMode = ide.operationalMode || 'human_interactive'
  const heroKey = ide.heroMetricKey
  if (heroKey === 'averageSessionLengthMinutes' && opMode === 'delegated_agent') {
    return HERO_LABELS_BY_OPERATIONAL_MODE['delegated_agent']
  }
  if (heroKey === 'activeCodingMinutesPerSession' && opMode === 'human_interactive') {
    return HERO_LABELS_BY_OPERATIONAL_MODE['human_interactive']
  }
  const def = getHeroMetricDef(ide)
  if (!def) return 'measured session count'
  return def.label
}

// CR-X P0-3: Session share — derived from displayed workflow session counts.
// Denominator = sum of sessionCount for all workflows in this AIOI section.
// NOT adoption, developer share, team share, or portfolio share.
const totalObservedSessions = computed(() =>
  allMeasuredWorkflows.value.reduce((sum, w) => sum + (w.sessionCount || 0), 0)
)

function getSessionSharePctNum(ide: any): number {
  const total = totalObservedSessions.value
  if (total <= 0) return 0
  return (ide.sessionCount / total) * 100
}

function getSessionSharePct(ide: any): string {
  const pct = getSessionSharePctNum(ide)
  if (pct < 1) return '<1%'
  return Math.round(pct) + '%'
}

function formatSessionCount(count: number): string {
  return count.toLocaleString('en-US')
}

// CR-X P1B.2 Production-Value: Compact economics line for AIOI cards.
// Reuses canonical cost authority (getToolMonthlySpend from toolCost.ts).
// Mode-correct: human-interactive uses cost/active-hour; delegated-agent uses cost/runtime-hour.
// If no configured cost exists, returns null (omitted cleanly from the card).
// Does NOT imply billing data — configured spend is an estimate, not billing.
function getEconomicsLine(ide: any): string | null {
  if (typeof ide.monthlySpend !== 'number' || ide.monthlySpend <= 0) return null
  const monthlySpend = ide.monthlySpend
  const isDelegated = ide.operationalMode === 'delegated_agent'

  // Mode-correct cost-per-hour
  if (isDelegated && typeof ide.costPerRuntimeHour === 'number' && ide.costPerRuntimeHour > 0) {
    return `$${ide.costPerRuntimeHour.toFixed(2)}/runtime-hr · $${monthlySpend.toFixed(0)}/mo configured`
  }
  if (!isDelegated && typeof ide.costPerActiveHour === 'number' && ide.costPerActiveHour > 0) {
    return `$${ide.costPerActiveHour.toFixed(2)}/active-hr · $${monthlySpend.toFixed(0)}/mo configured`
  }

  // Fallback: cost per session if available
  if (typeof ide.costPerSession === 'number' && ide.costPerSession > 0) {
    return `$${ide.costPerSession.toFixed(2)}/session · $${monthlySpend.toFixed(0)}/mo configured`
  }

  // Last resort: just monthly spend
  return `$${monthlySpend.toFixed(0)}/mo configured`
}

// CR-X P0-3: Supporting signals — inline text, no grid/box.
// Mature workflows: exactly 2 supporting signals.
// Emerging workflows: exactly 1 supporting signal.
// Missing metrics are omitted, not rendered as "—".
function getSecondaryMetrics(ide: any): Array<{ label: string; value: string }> {
  const heroKey = ide.heroMetricKey
  const opMode = ide.operationalMode || 'human_interactive'
  const priority = SECONDARY_PRIORITY_BY_OPERATIONAL_MODE[opMode] || SECONDARY_PRIORITY_BY_OPERATIONAL_MODE['human_interactive']
  const maxSignals = isEmerging(ide) ? 1 : 2

  const result: Array<{ label: string; value: string }> = []
  for (const key of priority) {
    if (key === heroKey) continue
    const def = METRIC_DEFS.find((d) => (d.key as string) === key)
    if (!def) continue
    // "Not instrumented" is an explicit availability state, not a measured
    // value — an unsupported metric must never render as 0% or silently vanish.
    if (!isMetricInstrumentedForWorkflow(ide.toolId, key)) {
      result.push({ label: def.label, value: 'Not instrumented' })
      if (result.length >= maxSignals) break
      continue
    }
    const raw = ide[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    result.push({ label: def.label, value: def.format(raw) })
    if (result.length >= maxSignals) break
  }
  return result
}
</script>

<style scoped>
.ai-executive-signals {
  padding: 0.2rem 0;
}

.aioi-error-state {
  padding: 12px 16px;
  background: #fff5f5;
  border: 1px solid #fca5a5;
  border-radius: 8px;
}

/* Shared header classes - match Performance Insights design, calmer */
.stage-icon-wrapper {
  width: 36px;
  height: 36px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  font-size: 1rem;
  flex-shrink: 0;
}

.cm-header-dense {
  padding-bottom: 0.3rem;
  border-bottom: 1px solid #f1f5f9;
  margin-bottom: 0.15rem;
}

.cm-subtitle-dense {
  font-size: 0.72rem;
  line-height: 1.2;
  display: block;
  margin-top: 0.1rem;
}

.cm-stage-dense {
  margin-bottom: 0.5rem;
}

.cicd-section-header {
  padding-bottom: 0.6rem;
  border-bottom: 1px solid #f1f5f9;
}

.signals-header {
  margin-bottom: 0.5rem;
}

.executive-title {
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: #111827;
  text-transform: uppercase;
}

.executive-subtitle {
  font-size: 0.6875rem;
  color: #6b7280;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-weight: 500;
}

/* Executive Signal Bar - REMOVED */

/* Executive Signal Label - Integrated into cards, subtle semantic color */
.executive-signal-label {
  font-size: 0.56rem;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.25rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid #e2e8f0;
}

.executive-signal-label.signal-cursor {
  color: #16a34a;
}

.executive-signal-label.signal-windsurf {
  color: #dc2626;
}

.executive-signal-label.signal-vscode {
  color: #0891b2;
}

/* ── CR-X P0-3: QUIET PROFILE CARD STYLES ── */

/* Grid layout */
.aioi-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

/* Card: neutral hairline border, white background, subtle elevation */
.aioi-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  min-height: 180px;
}

/* Identity row — workflow name only */
.aioi-identity {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.aioi-name {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.25;
}

/* Quiet metadata row — maturity dot + text, surface tag, mode tag */
.aioi-meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.aioi-maturity-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  flex-shrink: 0;
}

.aioi-maturity-dot-emerging {
  background: #f59e0b;
}

.aioi-maturity {
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
}

.aioi-maturity-emerging {
  color: #b45309;
}

/* Surface tag — terminal characteristic */
.aioi-surface-tag {
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 1px 6px;
  line-height: 1.4;
}

/* Mode tag — operational mode */
.aioi-mode-tag {
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 1px 6px;
  line-height: 1.4;
}

/* Hero */
.aioi-hero {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 8px;
}

.aioi-hero-val {
  font-size: 32px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1;
  letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
}

.aioi-hero-lbl {
  font-size: 12px;
  font-weight: 500;
  color: #94a3b8;
}

/* Session share */
.aioi-share-line {
  font-size: 12px;
  font-weight: 400;
  color: #64748b;
  margin-top: 4px;
}

.aioi-share-bar {
  height: 3px;
  background: #f1f5f9;
  border-radius: 1.5px;
  margin-top: 4px;
  overflow: hidden;
}

.aioi-share-bar-fill {
  height: 100%;
  background: #475569;
  border-radius: 1.5px;
}

/* Emerging: sessions to primary */
.aioi-to-primary {
  font-size: 11px;
  font-weight: 400;
  color: #94a3b8;
  margin-top: 2px;
}

/* Divider before supporting signals */
.aioi-divider {
  border-top: 1px solid #f1f5f9;
  margin-top: 4px;
  margin-bottom: 2px;
}

/* Supporting signals — label-over-value pairs */
.aioi-signals {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-top: 4px;
}

.aioi-signal-pair {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.aioi-signal-lbl {
  font-size: 10px;
  font-weight: 500;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.2;
}

.aioi-signal-val {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.3;
}

/* CR-X P1B.2 Production-Value: compact economics line */
.aioi-economics {
  margin-top: auto;
  padding-top: 8px;
  font-size: 11px;
  font-weight: 500;
  color: #94a3b8;
  letter-spacing: 0.01em;
}

.aioi-economics-divider {
  border-top: 1px dashed #e2e8f0;
  margin-bottom: 6px;
}

/* Emerging card: smaller hero */
.aioi-card-emerging .aioi-hero-val {
  font-size: 27px;
}

/* Mobile Responsiveness */
@media (max-width: 768px) {
  .aioi-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1024px) and (min-width: 769px) {
  .aioi-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
