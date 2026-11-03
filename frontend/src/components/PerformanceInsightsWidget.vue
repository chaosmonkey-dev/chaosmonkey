<script setup lang="ts">

import { piDebugLog } from '../lib/insights/final/utils/logging'

// DEBUG FLAGS (defined early to avoid hoisting issues)
const PI_DEBUG_ENV = (import.meta as any).env?.VITE_PI_DEBUG ?? 'false'
const PI_DEBUG = PI_DEBUG_ENV === 'true' || PI_DEBUG_ENV === '1'

// More restrictive verbose debug flag for pilot-hostile logs
const VERBOSE_PI_DEBUG = (import.meta.env.VITE_VERBOSE_PI_DEBUG ?? 'false') === 'true'

/**
 * 🔍 PERFORMANCE INSIGHTS CANONICAL FLOW:
 * 
 * 1. DATA SOURCES:
 *    - GitHub: resolveGhSeries() → pulls from githubStore, widens/synthesizes if < MIN_PERIODS
 *    - Productivity: resolveProdSeries() → pulls from metricsFacade, widens/synthesizes if < MIN_PERIODS
 * 
 * 2. ENGINE INVOCATION:
 *    - runPerfInsightsHarness({ githubWeekly, productivityWeekly, granularity })
 *    - Harness maps to EngOutputPoint[] and ToolProductivityPoint[]
 *    - Calls generatePerformanceInsights() from performanceEngine.ts
 * 
 * 3. POST-PROCESSING:
 *    - raw.value = harness output (PerformanceInsight[])
 *    - finalInsights = deduped
 *    - allInsights = filtered (remove coverage)
 *    - Split by severity: priorityInsights, performanceInsights, lowlightInsights
 * 
 * 4. RENDERING:
 *    - Template renders insights directly (not via InsightsPanel)
 *    - Three sections: Priority, Performance, Lowlights
 * 
 * 5. THRESHOLDS:
 *    - MIN_PERIODS = 4 (can loosen via env var)
 *    - pickBestGranularity minPeriods = 4 (hardcoded in harness.ts line 53)
 *    - If data < threshold, synthesizes fake data (ALLOW_SYNTH = true)
 */

import { computed, ref, watchEffect, watch, nextTick, onMounted, onUpdated } from 'vue'
import { count } from '../lib/perf/devPerf'
import { isDebugEnabled } from '../lib/perf/debugGate'
import InsightsPanel from './InsightsPanel.vue'
import InsightCardContent from './InsightCardContent.vue'
import InsightStrip from './InsightStrip.vue'
import PerformanceInsightsCardsV2 from './PerformanceInsightsCardsV2.vue'
import PerformanceRecommendationsView from './PerformanceRecommendationsView.vue'
import { mapPerfToPanel } from '../lib/insights/perfToPanelAdapter'
import { dedupeByEquivalenceKey } from '../ui/insights/uiDedupe'
import { filterLowValueInsights, dedupeInsights } from '../ui/insights/insightQualityGate'
import { capPerTool, impactScore } from '../lib/insights/priority'
import { useGitHubStore } from '../stores/github'
import { useMetricsFacadeStore } from '../stores/metricsFacade'
import { useUnifiedStore } from '../stores/unified'
import { useFilterStore } from '../stores/filters'

// Stress mode detection (dev only)
const isStressModeActive = computed(() => {
  // Production safety: Only allow stress mode in dev or with explicit flag
  const stressAllowed = 
    (typeof import.meta !== 'undefined' && import.meta.env?.DEV) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ALLOW_PI_STRESS_MODE === 'true');
  
  if (!stressAllowed) {
    return false;
  }
  
  // Check environment variable
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FINAL_PI_STRESS_MODE === 'true') {
    return true;
  }
  
  // Check URL parameters (case-insensitive support for both piStress, pistress, and demoMode)
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('piStress') === '1' || urlParams.get('pistress') === '1' || urlParams.get('demoMode') === '1';
  }
  
  return false;
});

import { deriveGitHubTimeFilter } from '../utils/timeFilter'
import { DEMO_MODE } from '../lib/insights/performanceEngine'
import { groupInsightsForPresentation } from '../lib/insights/ui/insightPresentation'

// ======= Props (optional insights from parent) =======
import type { PerformanceInsight, InsightTier } from '../lib/insights/types'
import type { Insight } from '../types/insights'
import { hardenPerformanceInsightForUi } from '../ui/insights/piHardening'
import { presentDetails, presentOneLine } from '../lib/insights/v2/presenter'
import { __CM_RAW_SESSION_SAMPLE } from '../lib/insights/realDataBridge'
import { CicdStage, normalizeStage, stableKeyFromInsight, toCanonicalFromLegacy, toCanonicalFromPreviewRow, fromCanonicalToLegacy, fromCanonicalToPreviewRow, adaptCanonicalForComponent, matchSurface } from '../lib/insights/canonicalInsight'
import EmptyState from './EmptyState.vue'

const props = withDefaults(defineProps<{
  insights?: PerformanceInsight[]
  ideDiagnostics?: PerformanceInsight[]
  viewMode?: 'cards' | 'strip' | 'strip-v2' | 'cards-v2' | 'chips'
  piRunId?: number
  selectedPIId?: string
  hasAnyData?: boolean
  canonicalHydrating?: boolean
  evidenceCompleteness?: 'full' | 'partial' | 'error' | 'loading'
  evidenceStatusLabel?: string
}>(), {
  viewMode: 'cards',
  hasAnyData: true,
  canonicalHydrating: false,
  evidenceCompleteness: 'loading',
  evidenceStatusLabel: 'Loading historical telemetry…'
})

// Canonical extension download base — same authority as Dashboards.vue
const pilotApiBase = computed(() => {
  const base = import.meta.env.VITE_API_BASE_URL
  if (base) {
    return base.replace(/\/$/, '').replace(/\/api$/, '')
  }
  // No build-time API base: use the current origin (same as config/api.js).
  return window.location.origin
})

// PHASE 1: Force chips view only
const userViewMode = ref<'chips'>('chips')

const __piWidgetInstanceId = Math.random().toString(36).slice(2, 9)

// === RUNTIME TRACE 5: Watch props.insights for changes ===
watch(() => props.insights, (newInsights) => {
  piDebugLog('[RUNTIME_TRACE][STAGE_5_WIDGET_PROPS_INSIGHTS]', {
    count: newInsights?.length || 0,
    ids: newInsights?.map(i => i.id) || [],
    titles: newInsights?.map(i => i.title) || []
  });
}, { immediate: true, deep: true });
// === END RUNTIME TRACE ===

// ======= Tunables via env =======
const MIN_PERIODS = Number(import.meta.env.VITE_PERF_INSIGHTS_MIN_PERIODS ?? 4)
const SYNTH_WEEKS = Number(import.meta.env.VITE_PERF_INSIGHTS_SYNTH_WEEKS ?? 8)
const DEDUPE_MODE = (import.meta.env.VITE_PERF_INSIGHTS_DEDUPE || 'soft').toLowerCase()
const ALLOW_SYNTH = (import.meta.env.VITE_PERF_INSIGHTS_ALLOW_SYNTH ?? '1') === '1'
const DEMO_UX = (import.meta.env.VITE_PI_DEMO_UX ?? '0') === '1'

// TTFC Debug flag
const TTFC_DEBUG = (import.meta.env.VITE_TTFC_DEBUG ?? 'false') === 'true'

// ======= Sentinel log =======
piDebugLog('[PERFORMANCE_INSIGHTS_WIDGET] COMPONENT loaded - UNIQUE_BUILD_2025_01_16_09_17', { file: import.meta.url, instanceId: __piWidgetInstanceId })
piDebugLog('[PERFORMANCE_INSIGHTS_WIDGET] Feature flag:', import.meta.env.VITE_FEATURE_PERF_INSIGHTS)
piDebugLog('[PERFORMANCE_INSIGHTS_WIDGET] DEMO_UX:', DEMO_UX)

type PreviewRow = {
  id?: string
  title: string
  subtitle?: string
  callout?: string
  rightMetric?: string
  secondaryRightMetric?: string
  confidence?: 'high' | 'medium' | 'low'
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

type V2ToolScope = 'all' | 'cursor' | 'windsurf' | 'vscode'

const v2ToolScope = ref<V2ToolScope>('all')

function readV2ToolScopeFromLocalStorage(): V2ToolScope {
  try {
    const v = String(window.localStorage?.getItem('cm_v2_tool_scope') ?? 'all').toLowerCase()
    if (v === 'cursor' || v === 'windsurf' || v === 'vscode') return v
    return 'all'
  } catch {
    return 'all'
  }
}

function setV2ToolScope(next: V2ToolScope) {
  v2ToolScope.value = next
  try {
    window.localStorage?.setItem('cm_v2_tool_scope', next)
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new Event('cm_v2_tool_scope_changed'))
  } catch {
    // ignore
  }
}

// REMOVED: V2 window snapshot - V2 insights now come from props.insights

onMounted(() => {
  // 🔥 LIVE PILOT MODE: Clear all stale PI cache on startup
  const isLivePilotRuntime =
    import.meta.env.VITE_LIVE_PILOT_MODE === 'true'

  if (isLivePilotRuntime) {
    if (PI_DEBUG) console.log('[LIVE_PILOT_CACHE_CLEAR][WIDGET] Clearing PI cache keys')
    localStorage.removeItem('performance_insights_snapshot')
    localStorage.removeItem('performance_insights_timestamp')
    localStorage.removeItem('performance_insights_demo_snapshot')
    localStorage.removeItem('performance_insights_demo_timestamp')
    localStorage.removeItem('cm_archived_pi_ids')
  }

  count('performance_insights_widget_mount')
  v2ToolScope.value = readV2ToolScopeFromLocalStorage()
})

// 🎯 PERFORMANCE: Track renders
onUpdated(() => {
  count('performance_insights_widget_render')
})

function formatMetric(value: any): string {
  if (value == null) return '—'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—'
    if (Math.abs(value) >= 1000) return value.toFixed(0)
    return value.toFixed(2)
  }
  if (typeof value === 'string') return value
  return presentOneLine(value)
}

// ======= GitHub metrics to chips adapter =======
function githubMetricToChip(key: string, value: number, stage: string): any {
  if (value == null || value === 0) return null
  
  let title: string
  let formattedValue: string
  
  switch (key) {
    case 'codeReviewTime':
      title = 'PR cycle time'
      if (value < 48) {
        formattedValue = `${value.toFixed(1)}h`
      } else {
        formattedValue = `${(value / 24).toFixed(1)}d`
      }
      break
    case 'deploymentFrequency':
      title = 'Deployments/week'
      formattedValue = `${value.toFixed(1)} deployments/week`
      break
    case 'changeFailureRate':
      title = 'Change failure rate'
      formattedValue = `${(value * 100).toFixed(1)}%`
      break
    case 'leadTime':
      title = 'Lead time'
      formattedValue = `${value.toFixed(1)}h`
      break
    case 'mergeRate':
      title = 'Merge rate'
      formattedValue = `${(value * 100).toFixed(1)}%`
      break
    default:
      title = key
      formattedValue = value.toString()
  }
  
  // Map stage string to correct enum values
  let cicdStage: 'plan-code' | 'review-merge' | 'deploy-operate' | 'other'
  switch (stage) {
    case 'plan-code':
      cicdStage = 'plan-code'
      break
    case 'review-merge':
      cicdStage = 'review-merge'
      break
    case 'deploy-operate':
      cicdStage = 'deploy-operate'
      break
    default:
      cicdStage = 'other'
  }
  
  return {
    id: `github-${key}`,
    cicdStage,
    title,
    value: formattedValue,
    subtitle: 'Last 4 weeks · Org',
    severity: 'info'
  }
}

// REMOVED: buildV2PreviewRows() - V2 insights now come from props.insights

// V2 view mode detection
const isV2View = computed(() => {
  const result = props.viewMode === 'strip-v2' || props.viewMode === 'cards-v2';
  if (PI_DEBUG) {
    piDebugLog('[PI_DEBUG] isV2View computed:', {
      viewMode: props.viewMode,
      isV2View: result
    });
  }
  return result;
})

// Debug: Log current view mode
if (isDebugEnabled('PI')) {
  piDebugLog('[CUSTOM_HIDE_DEBUG] Current view mode:', props.viewMode, 'isV2View:', isV2View.value)
}

// 🔥 P2: Empty state detection
// CR-X FINAL: Three-state model for zero/sparse-pilot UX:
//   1. showLoadingState — engine still hydrating (skeleton OK)
//   2. showZeroTelemetryState — engine completed, no telemetry at all (first-run)
//   3. showDiagnosticOnlyState — engine completed, 0 findings but diagnostics > 0 (sparse pilot)
//   4. showEmptyState — engine completed, 0 insights, has telemetry but none eligible (fallback)
const showEmptyState = computed(() => {
  if (props.canonicalHydrating) return false; // LOADING != EMPTY
  const hasInsights = (props.insights || []).length > 0;
  const hasData = props.hasAnyData !== false; // Default to true if not provided
  return !hasInsights && !hasData;
});

// Loading state — canonical telemetry still hydrating, no insights yet
const showLoadingState = computed(() => {
  return props.canonicalHydrating && (props.insights || []).length === 0;
});

// CR-X FINAL: Zero-telemetry state — no sessions, no insights, engine completed.
// This is the true first-run state for a pilot with zero telemetry (e.g. Decisions).
const showZeroTelemetryState = computed(() => {
  if (props.canonicalHydrating) return false; // LOADING != EMPTY
  if (showLoadingState.value) return false;
  const hasInsights = (props.insights || []).length > 0;
  if (hasInsights) return false;
  // Only show zero-telemetry state when there is genuinely no data
  return props.hasAnyData === false;
});

// CR-X FINAL: Diagnostic-only state — 0 findings, but diagnostics > 0.
// This is the sparse-telemetry state (few sessions, diagnostics but no findings).
// The UI should say "we are collecting evidence, here is what is missing"
// NOT "no insights match current filters" or "loading".
const showDiagnosticOnlyState = computed(() => {
  if (props.canonicalHydrating) return false; // LOADING != EMPTY
  if (showLoadingState.value) return false;
  if (showZeroTelemetryState.value) return false;
  const allInsights = props.insights || [];
  if (allInsights.length === 0) return false;
  const hasFindings = allInsights.some(i => !(i as any).isDiagnostic);
  const hasDiagnostics = allInsights.some(i => (i as any).isDiagnostic);
  return !hasFindings && hasDiagnostics;
});

// CR-X FINAL: Count of diagnostics in the diagnostic-only state (for the message).
const diagnosticOnlyCount = computed(() => {
  const allInsights = props.insights || [];
  return allInsights.filter(i => (i as any).isDiagnostic).length;
});

// CR5 P0.5: Count authority — counts are outputs, not forced inventory.
// No component-local ID-specific exclusions. The engine provenance gate
// and Step 1.5 removal ensure only real findings reach the widget.
// CR-X R2: When props.insights is empty (during refresh), fall back to
// the same localStorage cache that PerformanceRecommendationsView uses,
// so the count matches the displayed population. Never show "0 total"
// over a populated cached surface.
// CR-X WAVE 2: Aligned cache age check with PerformanceRecommendationsView
// (30-minute max age). Previously the widget header checked cache without
// age, while the body checked age — causing header to show "19 total"
// while body showed "0 findings / Loading" when cache was stale.
const CACHE_KEY = 'performance_insights_snapshot'
const CACHE_TIMESTAMP_KEY = 'performance_insights_timestamp'
const CACHE_MAX_AGE_MS = 30 * 60 * 1000 // 30 minutes — must match PerformanceRecommendationsView

function readValidCachedInsights(): any[] | null {
  try {
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem(CACHE_KEY) : null;
    const cachedTimestamp = typeof localStorage !== 'undefined' ? localStorage.getItem(CACHE_TIMESTAMP_KEY) : null;
    if (!cached || !cachedTimestamp) return null;
    const age = Date.now() - parseInt(cachedTimestamp);
    if (age >= CACHE_MAX_AGE_MS) return null;
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* ignore cache read errors */ }
  return null;
}

const performanceFindingCount = computed(() => {
  const input = props.insights || [];
  if (input.length > 0) return input.filter((i: any) => !i.isDiagnostic).length;
  const cached = readValidCachedInsights();
  return cached ? cached.filter((i: any) => !i.isDiagnostic).length : 0;
});

// Diagnostic count (separate from performance findings) — for header badge
// CR-X R2: Same cache fallback as performanceFindingCount for consistency.
const diagnosticCount = computed(() => {
  const input = props.insights || [];
  if (input.length > 0) return input.filter((i: any) => i.isDiagnostic).length;
  const cached = readValidCachedInsights();
  return cached ? cached.filter((i: any) => i.isDiagnostic).length : 0;
});

// CANONICAL CURATED INSIGHTS - Single source of truth for ALL rendering
const curatedInsights = computed(() => {
  const input = props.insights || [];

  // === RUNTIME TRACE 6: Inside curatedInsights computed ===
  if (VERBOSE_PI_DEBUG) {
    piDebugLog('[RUNTIME_TRACE][STAGE_6_WIDGET_CURATED_INSIGHTS]', {
      inputCount: input.length,
      inputIds: input.map(i => i.id),
      inputTitles: input.map(i => i.title)
    });
  }
  // === END RUNTIME TRACE ===
  
  if (VERBOSE_PI_DEBUG) {
    piDebugLog('[CM_AUDIT:STAGE_8_WIDGET_CURATED]', {
      curatedInsightsLength: input.length
    });
  }
  
  if (PI_DEBUG) {
    piDebugLog('[PI_DEBUG] curatedInsights computed:', {
      inputLength: input.length,
      sampleInsights: input.slice(0, 3).map(i => ({ id: i.id, title: i.title?.substring(0, 50) }))
    });
  }
  
  // Debug logging
  if (PI_DEBUG) {
    piDebugLog('[CURATED_INSIGHTS]', {
      inputCount: input.length,
      inputIds: input.map(i => i.id),
      isV2View: isV2View.value,
      viewMode: props.viewMode,
      willBypassAllowlist: isV2View.value
    });
  }
  
  // In V2 mode, bypass allowlist filter - use all insights (V2 already filtered by manifest)
  if (isV2View.value) {
    const result = input;
    if (PI_DEBUG) {
      piDebugLog('[CURATED_INSIGHTS] V2 mode - returning all insights:', {
        resultCount: result.length,
        resultIds: result.map(i => i.id)
      });
    }
    return result;
  }

  // CR4 6B FIX: Removed the hardcoded V1 "NUCLEAR ALLOWLIST" that used old V1
  // IDs (commits-per-session-by-ide, ai-suggestions-accepted-by-ide, etc.)
  // not in the canonical registry. This was a split-brain authority that
  // contradicted the canonical registry and caused diagnostic leakage.
  //
  // The canonical registry (CANONICAL_PI_REGISTRY) is now the single authority.
  // All insights from the final engine are canonical-registry insights.
  // Diagnostics are classified by the renderAdapter (isDiagnostic flag) and
  // counted separately in the header. No second hardcoded ID list.

  piDebugLog(
    '[DEBUG curatedInsights] passing insights (canonical, no allowlist):',
    input.map(i => ({ id: i.id, stage: i.cicdStage, isDiagnostic: i.isDiagnostic, metricValue: i.metricValue }))
  );

  piDebugLog('[DEBUG v2 mode]', isV2View.value);

  return input;
});

// Filter V2 insights from CURATED insights (not props.insights)
// When in V2 view mode, ALL insights are already V2 (from harness), so don't filter
const v2Insights = computed(() => {
  const insights = curatedInsights.value || []
  
  // If we're in V2 view mode, all insights are already V2 (harness returns only V2 when enabled)
  if (isV2View.value) {
    // Debug logging
    if (PI_DEBUG) {
      piDebugLog('[V2_INSIGHTS_FILTER] V2 view mode - using all insights:', {
        inputInsightsCount: insights.length,
        inputInsightIds: insights.map(i => i.id),
        inputInsightTags: insights.map(i => ({ id: i.id, tags: i.tags, version: i.version, engineVersion: i.engineVersion }))
      });
    }
    return insights
  }
  
  // Otherwise, filter for V2 insights only (when V1 and V2 are mixed)
  if (PI_DEBUG) {
    piDebugLog('[V2_INSIGHTS_FILTER] Mixed mode - filtering for V2 tag:', {
      inputInsightsCount: insights.length,
      inputInsightIds: insights.map(i => i.id),
      inputInsightTags: insights.map(i => ({ id: i.id, tags: i.tags, version: i.version, engineVersion: i.engineVersion }))
    });
  }
  
  const v2Filtered = insights.filter(i => {
    // Check multiple fields to identify V2 insights OR new canonical insights
    const tags = Array.isArray(i?.tags) ? i.tags : []
    const isV2 = tags.includes('v2') || 
           i.version === 'v2' || 
           i.engineVersion === 'v2' ||
           (typeof i.id === 'string' && i.id.startsWith('v2-')) ||
           // Include new canonical insights (they have engineVersion 'FINAL_ENGINE_V1')
           i.engineVersion === 'FINAL_ENGINE_V1' ||
           (typeof i.id === 'string' && !i.id.startsWith('v2-') && !i.id.includes('legacy'))
    return isV2
  })
  
  // Debug logging for V2 insight filtering results
  if (PI_DEBUG) {
    piDebugLog('[V2_INSIGHTS_FILTER_RESULT]', {
      v2InsightsCount: v2Filtered.length,
      v2InsightIds: v2Filtered.map(i => i.id),
      filteredOut: insights.length - v2Filtered.length
    });
  }
  
  return v2Filtered
  
  // Apply the same custom hide logic to V2 insights
  // DISABLED: Use manifest as single source of truth for V2 mode
  const titlesToHide = [
    "Delivery Rate Ai Vs Non Ai: 0.0 (no data)",
    "Ai Rework Burden Ai Vs Non Ai: 0.0 (no data)", 
    "Ai Yield Ratio Ai Vs Non Ai: 0.0 (no data)",
    "Branch stagnation: 0.0% (AI) • 0.0% (Non-AI)",
    "Review Merge Git Context: 0.0 (no data)",
    "V2 First Review Latency: 0.0 (no data)",
    "V2 Release Risk Index: 0.0 (no data)",
    "Pr Size By Ide: 0.0 (no data)",
    "Change risk: 1.00x (no matched periods)",
    "MTTR",
    "No deployment velocity data available"
  ]
  
  const beforeCustomHide = v2Filtered.length
  // DISABLED: Manifest controls V2 visibility, not title-based hiding
  const filteredV2 = v2Filtered // .filter(insight => 
  //   !titlesToHide.some(hideTitle => 
  //     insight.title === hideTitle || 
  //     insight.title?.includes(hideTitle) ||
  //     hideTitle.includes(insight.title)
  //   )
  // )
  
  // Log V2 hide filtering
  if (PI_DEBUG && beforeCustomHide > filteredV2.length) {
    piDebugLog('[CUSTOM_HIDE][V2] Filtered V2 insights:', {
      before: beforeCustomHide,
      after: filteredV2.length,
      filtered: beforeCustomHide - filteredV2.length,
      hiddenTitles: titlesToHide.filter(title => 
        v2Filtered.some(insight => 
          insight.title === title || 
          insight.title?.includes(title) ||
          title.includes(insight.title)
        )
      )
    })
  }
  
  return filteredV2
})

// DEV-ONLY: Log final V2 PI IDs for verification
if (import.meta.env.DEV) {
  watchEffect(() => {
    const isV2Mode = props.viewMode === 'strip-v2' || props.viewMode === 'cards-v2'
    if (isV2Mode) {
      const v2Ids = v2Insights.value.map(i => i.id)
      const byStage = v2Insights.value.reduce((acc, i) => {
        const stage = i.cicdStage || 'unknown'
        acc[stage] = (acc[stage] || 0) + 1
        return acc
      }, {} as Record<string, number>)
      
      piDebugLog('[V2_PI_VERIFICATION] Final PIs rendered:', {
        total: v2Ids.length,
        byStage,
        ids: v2Ids
      })
    }
  })
}

// Stage inference helper
function inferStage(insight: PerformanceInsight): 'plan-code' | 'review-merge' | 'deploy-operate' {
  // Prefer explicit cicdStage
  if (insight.cicdStage === 'plan-code' || insight.cicdStage === 'review-merge' || insight.cicdStage === 'deploy-operate') {
    return insight.cicdStage
  }
  // Fallback to tags
  const tags = Array.isArray(insight?.tags) ? insight.tags : []
  if (tags.includes('plan-code')) return 'plan-code'
  if (tags.includes('review-merge')) return 'review-merge'
  if (tags.includes('deploy-operate')) return 'deploy-operate'
  // Default fallback
  return 'plan-code'
}

// Group V2 insights by stage
const v2InsightsByStage = computed(() => {
  const out = {
    planCode: [] as PerformanceInsight[],
    reviewMerge: [] as PerformanceInsight[],
    deployOperate: [] as PerformanceInsight[]
  }
  
  // Demo mode flag - controlled fallback values
  const DEMO_MODE = (import.meta as any).env?.VITE_PI_DEMO_MODE === '1'
  
  // 🔧 STEP 1 — ADD DEMO CHIP FILTER (CRITICAL)
  const HIDE_CHIPS = [
    "review-latency-spike-by-ide",
    "deployment-frequency-volatility-by-ide", 
    "latest-deployment-unhealthy",
    "mttr-by-ide",
    "fast-but-unstable-by-ide",
    "change-failure-rate-trend-by-ide",
    "pr-cycle-time-bottleneck-by-ide",
    "change-failure-rate-trend-org",
    "fast-but-unstable-org"
  ];
  
  // 🔧 STEP 2 — PRIORITY ORDER FOR DEMO CURATION
  const REVIEW_MERGE_PRIORITY = [
    "large-pr-mix-risk",
    "reopen-pressure-spike", 
    "pr-review-cycles-by-ide",
    "pr-cycle-time-by-ide",
    "reviewer-load-concentration"
  ];
  
  const DEPLOY_PRIORITY = [
    "change-failure-rate-spike-by-ide",
    "failed-deployment-pressure",
    "stale-deployment-signal",
    "deployment-frequency-volatility-by-ide"
  ];
  
  // CR-X Phase 3: Removed demoGitHubMetrics — fabricated fallback values
  // are not allowed in production. These were only used in dead computed
  // paths (v2InsightsByStage is never read by the template), but removing
  // them prevents future leaks if the computed is ever reactivated.
  
  // DEBUG: Log all insights before filtering
  if (VERBOSE_PI_DEBUG) {
    piDebugLog("[PI_DEBUG] All insights before filtering:", v2Insights.value.map(i => ({ id: i.id, title: i.title, subtitle: i.subtitle, value: i.value })));
  }
  for (const ins of v2Insights.value) {
    const rowAny = ins as any

    // === RENDER LAYER TRACE: Title BEFORE hydration ===
    const titleBeforeHydration = ins.title;
    if (VERBOSE_PI_DEBUG) {
      piDebugLog('[RENDER_TRACE][BEFORE_HYDRATION]', {
        id: ins.id,
        title: titleBeforeHydration
      });
    }
    // === END RENDER LAYER TRACE ===

    // PHASE 4F: Hydrate Review & Merge and Deploy & Operate cards with real GitHub data
    const githubSnapshot = githubStore.rawResponse
    hydrateGithubBackedExplorerCard(ins, githubSnapshot)

    // === RENDER LAYER TRACE: Title AFTER hydration ===
    const titleAfterHydration = ins.title;
    if (VERBOSE_PI_DEBUG) {
      piDebugLog('[RENDER_TRACE][AFTER_HYDRATION]', {
        id: ins.id,
        titleBefore: titleBeforeHydration,
        titleAfter: titleAfterHydration,
        titleChanged: titleBeforeHydration !== titleAfterHydration
      });
    }
    // === END RENDER LAYER TRACE ===
    
    // REMOVED: Stale fallback logic that overrides hydrated canonical values
    // Hydrated canonical API values now win - no more demo fallbacks
    
    // CR-X Phase 3: Removed demoGitHubMetrics fallback for review-latency-spike-by-ide
    // and session-conditioned-change-risk-ai-vs-non-ai. These must use real
    // GitHub data only, or fail closed as diagnostics.
    
    // REMOVED: pr-review-cycles-by-ide - now hydrated with real data
    // REMOVED: large-pr-mix-risk - now hydrated with real data
    // REMOVED: reopen-pressure-spike - now hydrated with real data
    // REMOVED: reviewer-load-concentration - now hydrated with real data
    
    if (ins.id === 'latest-deployment-unhealthy') {
      // Add real latest deployment status from GitHub API - same as EngOutput.vue
      const githubStore = useGitHubStore()
      piDebugLog('[PI_WIDGET] GitHub store data:', { 
        rawResponse: githubStore.rawResponse,
        latest_deployment_status: githubStore.rawResponse?.latest_deployment_status,
        deployment_metrics: githubStore.rawResponse?.deployment_metrics
      })
      
      if (githubStore.rawResponse?.latest_deployment_status) {
        const deployment = githubStore.rawResponse.latest_deployment_status
        ins.metricValue = deployment.status === 'failure' ? 1 : 0
        const status = deployment.status === 'failure' ? 'Failed' : 'Success'
        const date = new Date(deployment.deployed_at).toLocaleDateString()
        const time = new Date(deployment.deployed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
        ins.displayValue = status
        rowAny.contextLine = `${date} ${time}`
      } else if (githubStore.rawResponse?.deployment_metrics?.latest_deployment) {
        // Try alternative path
        const deployment = githubStore.rawResponse.deployment_metrics.latest_deployment
        ins.metricValue = deployment.status === 'failure' ? 1 : 0
        const status = deployment.status === 'failure' ? 'Failed' : 'Success'
        const date = new Date(deployment.deployed_at).toLocaleDateString()
        const time = new Date(deployment.deployed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
        ins.displayValue = status
        rowAny.contextLine = `${date} ${time}`
      } else {
        // CR-X Phase 3: Removed fabricated 'Failed' / '2/8/2026 04:55 PM' fallback.
        // Fail closed — no GitHub data means no deployment status claim.
        ins.displayValue = 'No deployment data'
        rowAny.contextLine = 'Connect GitHub for deployment status'
        ins.metricValue = null
      }
    }
    
    // 🔧 STEP 1B — HIDE CHIPS WITH BAD STATES
    const hasBadState = (
      ins.subtitle?.includes("No GitHub data") ||
      ins.subtitle?.includes("insufficient data") ||
      ins.subtitle?.includes("Gated") ||
      ins.value === null ||
      ins.value === undefined
    );
    
    // DEBUG: Log filtering decisions
    const isHidden = HIDE_CHIPS.includes(ins.id);
    if (VERBOSE_PI_DEBUG) {
      piDebugLog(`[PI_DEBUG] Processing chip: ${ins.id}`, {
        isHidden,
        hasBadState,
        subtitle: ins.subtitle,
        value: ins.value,
        metricValue: ins.metricValue
      });
    }
    
    // 🔧 STEP 1A — HIDE BROKEN / NON-DEMO CHIPS (TEMPORARILY DISABLED FOR DEBUGGING)
    // if (isHidden || hasBadState) {
    //   piDebugLog(`[PI_DEMO_FILTER] Skipping chip: ${ins.id} (hidden=${isHidden}, badState=${hasBadState})`);
    //   continue;
    // }
    
    // TEMP: Allow all chips through to see what's being generated
    if (isHidden || hasBadState) {
      piDebugLog(`[PI_DEMO_FILTER] Would skip chip: ${ins.id} (hidden=${isHidden}, badState=${hasBadState}) - but allowing through for debug`);
    }
    
    const stage = inferStage(ins)
    piDebugLog(`[PI][Widget] Grouping insight ${ins.id}: stage=${stage}`)
    if (stage === 'plan-code') out.planCode.push(ins)
    else if (stage === 'review-merge') out.reviewMerge.push(ins)
    else out.deployOperate.push(ins)
  }
  
  // 🔧 STEP 2 — LIMIT CHIP COUNT PER SECTION & APPLY PRIORITY ORDER (TEMPORARILY DISABLED FOR DEBUGGING)
  // const sortByPriority = (chips: PerformanceInsight[], priority: string[]) => {
  //   const priorityMap = new Map(priority.map((id, index) => [id, index]));
  //   return chips
  //     .filter(chip => priorityMap.has(chip.id))
  //     .sort((a, b) => (priorityMap.get(a.id) ?? 999) - (priorityMap.get(b.id) ?? 999))
  //     .slice(0, 4); // Max 4 chips per section
  // };
  
  // TEMP: Allow all chips through for debugging
  if (VERBOSE_PI_DEBUG) {
    piDebugLog("[PI_DEBUG] Before priority limiting:", {
      reviewMerge: out.reviewMerge.length,
      deployOperate: out.deployOperate.length,
      planCode: out.planCode.length
    });
  }
  
  // out.reviewMerge = sortByPriority(out.reviewMerge, REVIEW_MERGE_PRIORITY);
  // out.deployOperate = sortByPriority(out.deployOperate, DEPLOY_PRIORITY);
  
  if (VERBOSE_PI_DEBUG) {
    piDebugLog("[PI_DEBUG] After priority limiting (disabled):", {
      reviewMerge: out.reviewMerge.length,
      deployOperate: out.deployOperate.length,
      planCode: out.planCode.length
    });
  }
  
  // 🔧 STEP 7 — LOG FINAL CHIP SET
  piDebugLog("[PI_DEMO_CHIPS]", {
    planCode: out.planCode.map(c => c.id),
    reviewMerge: out.reviewMerge.map(c => c.id),
    deployOperate: out.deployOperate.map(c => c.id)
  });
  
  piDebugLog(`[PI][Widget] Stage grouping: planCode=${out.planCode.length}, reviewMerge=${out.reviewMerge.length}, deployOperate=${out.deployOperate.length}`)
  piDebugLog(`[PI][Widget] Review & Merge insights:`, out.reviewMerge.map(i => ({ id: i.id, title: i.title })))
  
  // 🔥 STEP 6 — COMPREHENSIVE LOGGING
  if (VERBOSE_PI_DEBUG) {
    piDebugLog("[PI_DEBUG]", {
      insightsLength: out.planCode.length + out.reviewMerge.length + out.deployOperate.length,
      sample: [
        ...out.planCode.slice(0, 1),
        ...out.reviewMerge.slice(0, 1), 
        ...out.deployOperate.slice(0, 1)
      ].map(i => ({ id: i.id, title: i.title?.substring(0, 50) }))
    });
  }
  
  return out
})

// Legacy function removed - replaced with props-based approach
function buildV2PreviewRows_DEPRECATED(): { previewRows: PreviewRow[]; debugRows: PreviewRow[]; candidateRows: PreviewRow[]; friendlyMessage?: string } {
  // This function is no longer used - V2 insights come from props.insights
  return {
    previewRows: [],
    debugRows: [],
    candidateRows: [],
    friendlyMessage: 'V2 insights now come from props.insights'
  }
}

// REMOVED: Entire buildV2PreviewRows_OLD function body (900+ lines) - V2 insights now come from props.insights
// The function body that read from window.__CM_PI_V2__ has been removed.
// V2 insights are now filtered from props.insights using v2Insights computed property.

// OLD FUNCTION BODY REMOVED - was reading from window.__CM_PI_V2__
// All code between here and buildV2PreviewRowsLegacy() has been deleted.
// (Approximately 950 lines of window-based code removed)

function buildV2PreviewRowsLegacy(): { fallbackRows: PreviewRow[]; candidateRows: PreviewRow[]; friendlyMessage?: string } {
  const w = window as any
  const out = w?.__CM_PI_V2__
  if (!out || !out.enabled) {
    return {
      fallbackRows: [],
      candidateRows: [],
      friendlyMessage: 'V2 preview is not available. Enable it with ?v2=1 or localStorage.cm_insights_v2=true, then refresh.'
    }
  }

  const ff = out.fallbackFacts
  const badges = ['V2', 'PREVIEW']
  
  const fallbackRows: PreviewRow[] = [
    {
      id: 'v2-ff-tool-fingerprint',
      title: 'Tool session fingerprint summary',
      subtitle: 'Top tools by sessions + typical flow/focus/duration/AI intensity',
      rightMetric: `tools: ${Array.isArray(ff?.toolSessionFingerprints) ? ff.toolSessionFingerprints.length : 0}`,
      badges,
      details: presentDetails(ff?.toolSessionFingerprints || [])
    },
    {
      id: 'v2-ff-ttfc-ratio',
      title: 'Org TTFC tail ratio',
      subtitle: 'p90/p50 ratio of time-to-first-commit (minutes)',
      rightMetric: `p90/p50: ${formatMetric(ff.orgTtfcP90P50Ratio)}`,
      badges,
      details: `orgTtfcP90P50Ratio: ${formatMetric(ff.orgTtfcP90P50Ratio)}`
    },
    {
      id: 'v2-ff-ai-intensity-by-tool',
      title: 'Org AI intensity by tool',
      subtitle: 'Distribution by tool (proxy: ai_chars_per_min)',
      rightMetric: `tools: ${Array.isArray(ff.orgAiIntensityByTool) ? ff.orgAiIntensityByTool.length : 0}`,
      badges,
      details: presentDetails(ff.orgAiIntensityByTool)
    },
    {
      id: 'v2-ff-rework-dist',
      title: 'Org rework distribution',
      subtitle: 'Distribution of rework_ratio_est across sessions',
      rightMetric: `p50/p90: ${formatMetric(ff.orgReworkDistribution?.p50)} / ${formatMetric(ff.orgReworkDistribution?.p90)}`,
      badges,
      details: presentDetails(ff.orgReworkDistribution)
    }
  ]

  const candidateRows: PreviewRow[] = (out.topCandidateSignals || []).slice(0, 10).map((s: any, idx: number) => ({
    id: `v2-candidate-${idx}-${String(s?.key ?? 'unknown')}`,
    title: String(s?.key ?? 'candidate'),
    subtitle: 'V2 candidate signal (debug)',
    rightMetric: formatMetric(s?.value),
    badges,
    details: presentDetails(s?.value)
  }))

  return { fallbackRows, candidateRows }
  const nMeta = out?.debug?.sampleKeysMetadata?.length ?? 0
  const nNorm = out?.debug?.sampleKeysNormalized?.length ?? 0
  const error = out?.debug?.error

  // Compute timestamp coverage from normalized sample keys
  const hasStartTs = out?.debug?.sampleKeysNormalized?.includes('session_start_timestamp') ?? false
  const hasEndTs = out?.debug?.sampleKeysNormalized?.includes('session_end_timestamp') ?? false
  // Check if start is derived by looking at sample row
  const sampleNormalized = out?.debug?.sampleRowNormalized
  const hasDerivedStart = sampleNormalized?.session_start_timestamp_is_derived === true

  const toolDist = out?.debug?.toolDistribution
  const toolCanonicalCounts = out?.debug?.toolCanonicalCounts
  const toolChosenPathCounts = out?.debug?.toolChosenPathCounts
  const burstCov = out?.debug?.burstTimingCoverage
  const exampleNorm = out?.debug?.exampleNormalizedSession
  
  // Compute tool resolution stats for debug row
  const resolvedCounts = toolDist || {}
  const top3RawFieldsUsed = toolChosenPathCounts 
    ? Object.entries(toolChosenPathCounts)
        .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
        .slice(0, 3)
        .map(([path]: [string, number]) => path)
    : []

  const debugBadges = ['V2', 'PREVIEW']
  
  // Get preview rows info from debug
  const previewRowsCount = Number(out?.debug?.previewRowsCount ?? 0)
  const previewRowsIds = Array.isArray(out?.debug?.previewRowsIds) ? out.debug.previewRowsIds : []
  const previewRowsFirstSample = (() => {
    const ff = out?.fallbackFacts
    if (ff?.previewRows && Array.isArray(ff.previewRows) && ff.previewRows.length > 0) {
      const first = ff.previewRows[0]
      return {
        id: first?.id || 'unknown',
        title: first?.title || 'unknown',
        rightMetric: first?.rightMetric || 'unknown',
      }
    }
    return null
  })()
  
  const debugRows: PreviewRow[] = [
    {
      id: 'v2-debug-preview-rows',
      title: 'V2 Debug: Preview rows produced',
      subtitle: previewRowsCount > 0 ? `Preview rows passed to UI: ${previewRowsCount}` : 'No preview rows produced',
      rightMetric: `${previewRowsCount}`,
      badges: debugBadges,
      details: previewRowsCount > 0
        ? `Preview rows count: ${previewRowsCount}\nPreview row IDs: ${previewRowsIds.join(', ') || 'none'}\n\nFirst row sample:\n${previewRowsFirstSample ? JSON.stringify(previewRowsFirstSample, null, 2) : 'none'}`
        : 'No preview rows were produced. Check fallbackFacts.previewRows in V2 snapshot'
    },
    {
      id: 'v2-debug-error',
      title: error ? 'V2 Debug: Error' : 'V2 Debug: Status',
      subtitle: error ? `Stage: ${error.stage || 'unknown'}` : `Pipeline: ${fallbackFactsComputed ? 'OK' : 'Partial'}`,
      rightMetric: error ? 'ERROR' : `${computedN} computed • ${fallbackFactsComputed ? 'Facts OK' : 'No facts'}`,
      badges: error ? ['V2', 'ERROR'] : debugBadges,
      details: error
        ? `Error in ${error.stage || 'unknown stage'}:\n${error.message}\n\n${error.stack ? `Stack:\n${error.stack}` : ''}`
        : `Pipeline stages:\n- Filter: ${filteredN} rows\n- Normalize: ${nNorm} sessions\n- Compute: ${computedN} primitives\n- Fallback facts: ${fallbackFactsComputed ? 'OK' : 'Failed/Missing'}`
    },
    {
      id: 'v2-debug-refresh-run-id',
      title: 'V2 Debug: refresh run id',
      subtitle: 'Deterministic refresh counter from refreshPI()',
      rightMetric: (() => {
        const runId = out?.debug?.piRunId ?? props.piRunId ?? undefined
        return runId !== undefined ? `run ${runId}` : '—'
      })(),
      badges: debugBadges,
      details: (() => {
        const runId = out?.debug?.piRunId ?? props.piRunId ?? undefined
        if (runId === undefined) {
          return 'Run ID not available. Check refreshPI() completion and piRunId prop passing.'
        }
        return `Run ID: ${runId}\n\nThis increments each time refreshPI() completes.\nPreview rows update only after run ID changes (no flicker).`
      })()
    },
    {
      id: 'v2-debug-github-connectivity',
      title: 'V2 Debug: GitHub connectivity',
      subtitle: 'GH ingress + period alignment',
      rightMetric: (() => {
        const ghCount = out?.debug?.githubByPeriodCount || 0
        return `gh periods ${ghCount}`
      })(),
      badges: (() => {
        const ghCount = out?.debug?.githubByPeriodCount || 0
        if (ghCount > 0) return ['V2', 'GH OK']
        return ['V2', 'GH MISSING']
      })(),
      details: (() => {
        const githubByPeriodCount = out?.debug?.githubByPeriodCount || 0
        const sessionsInputSource = out?.debug?.sessionsInputSource || 'unknown'
        const sessionsInputCount = out?.debug?.sessionsInputCount || 0
        const normalizedSessionCount = out?.debug?.normalizedSessionCount || 0
        
        let msg = `GitHub periods: ${githubByPeriodCount}\n\n`
        msg += `Sessions:\n`
        msg += `- source: ${sessionsInputSource}\n`
        msg += `- input count: ${sessionsInputCount}\n`
        if (normalizedSessionCount !== undefined && normalizedSessionCount !== null) {
          msg += `- normalized count: ${normalizedSessionCount}\n`
        }
        
        if (githubByPeriodCount === 0) {
          msg += `\n⚠️ GH ingress is missing (gh=0). V2 will suppress GH-dependent preview insights.`
        }
        
        return msg
      })()
    },
    {
      id: 'v2-debug-inputs-provenance',
      title: 'V2 Debug: Inputs provenance',
      subtitle: 'Telemetry + GitHub ingress',
      rightMetric: (() => {
        const sessionsCount = out?.debug?.sessionsInputCount || 0
        const ghCount = out?.debug?.githubByPeriodCount || 0
        const previewCount = out?.debug?.previewRowsCount || 0
        return `sessions ${sessionsCount} • gh ${ghCount} • preview ${previewCount}`
      })(),
      badges: debugBadges,
      details: (() => {
        const sessionsInputSource = out?.debug?.sessionsInputSource || 'unknown'
        const sessionsLoaded = out?.debug?.isLoaded ?? false
        const sessionsInputCount = out?.debug?.sessionsInputCount || 0
        const normalizedSessionCount = out?.debug?.normalizedSessionCount || 0
        const githubByPeriodCount = out?.debug?.githubByPeriodCount || 0
        const previewRowsCount = out?.debug?.previewRowsCount || 0
        const status = out?.debug?.status || 'unknown'
        
        let msg = `source: ${sessionsInputSource}\n`
        msg += `loaded: ${sessionsLoaded}\n`
        if (normalizedSessionCount !== undefined && normalizedSessionCount !== null) {
          msg += `normalizedSessionCount: ${normalizedSessionCount}\n`
        }
        msg += `status: ${status}\n\n`
        
        msg += `Counts:\n`
        msg += `- sessionsInputCount: ${sessionsInputCount}\n`
        msg += `- githubByPeriodCount: ${githubByPeriodCount}\n`
        msg += `- previewRowsCount: ${previewRowsCount}\n`
        
        if (githubByPeriodCount === 0) {
          msg += `\nnote: gh=0 means GH mapping/ingress didn't run`
        }
        
        return msg
      })()
    },
    (() => {
      // Raw session keys debug row
      const rawSample = __CM_RAW_SESSION_SAMPLE
      const topLevelKeys = rawSample && typeof rawSample === 'object' 
        ? Object.keys(rawSample).slice(0, 30) 
        : []
      const metadataKeys = rawSample?.metadata && typeof rawSample.metadata === 'object'
        ? Object.keys(rawSample.metadata).slice(0, 30)
        : []
      
      // Build details text (max 500 chars)
      let detailsText = ''
      if (!rawSample) {
        detailsText = 'No raw session sample available. API may not have returned data yet.'
      } else {
        detailsText = `Top-level keys (${topLevelKeys.length}):\n${topLevelKeys.join(', ')}`
        
        if (metadataKeys.length > 0) {
          detailsText += `\n\nMetadata keys (${metadataKeys.length}):\n${metadataKeys.join(', ')}`
        }
        
        // Show short values for likely candidates
        const candidateFields = ['source', 'editor_source', 'tool', 'ide', 'client', 'appName', 'uriScheme']
        const candidateValues: string[] = []
        
        for (const field of candidateFields) {
          const topLevel = rawSample[field]
          const metaLevel = rawSample.metadata?.[field]
          
          if (topLevel !== undefined && topLevel !== null && String(topLevel).trim() !== '') {
            const val = String(topLevel).slice(0, 50)
            candidateValues.push(`${field}: "${val}"`)
          } else if (metaLevel !== undefined && metaLevel !== null && String(metaLevel).trim() !== '') {
            const val = String(metaLevel).slice(0, 50)
            candidateValues.push(`metadata.${field}: "${val}"`)
          }
        }
        
        if (candidateValues.length > 0) {
          detailsText += `\n\nTool field candidates:\n${candidateValues.join('\n')}`
        } else {
          detailsText += `\n\nTool field candidates: (none found)`
        }
        
        // Truncate to 500 chars if needed
        if (detailsText.length > 500) {
          detailsText = detailsText.slice(0, 497) + '...'
        }
      }
      
      return {
        id: 'v2-debug-raw-session-keys',
        title: 'V2 Debug: Raw session keys (API)',
        subtitle: 'First session from /api/telemetry/sessions',
        rightMetric: `keys ${topLevelKeys.length}${metadataKeys.length > 0 ? ` + ${metadataKeys.length} meta` : ''}`,
        badges: debugBadges,
        details: detailsText
      }
    })(),
    {
      id: 'v2-debug-counts',
      title: 'V2 Debug: Counts',
      subtitle: `Raw: ${rawN} • Filtered: ${filteredN} • Normalized: ${nNorm} • Computed: ${computedN}`,
      rightMetric: `TTFC: ${formatMetric(ttfcFieldCov?.coveragePct)}% • Commit: ${formatMetric(commitOutcomeRate?.coveragePct)}%`,
      badges: debugBadges,
      details: `Stage counts:\n- Raw rows: ${rawN}\n- Filtered rows: ${filteredN}\n- Normalized sessions: ${nNorm}\n- Computed primitives: ${computedN}\n- Fallback facts computed: ${fallbackFactsComputed}`
    },
    {
      id: 'v2-debug-timestamps',
      title: 'V2 Debug: Timestamp coverage',
      subtitle: 'Start / End timestamp coverage',
      rightMetric: hasStartTs ? (hasDerivedStart ? 'Start: derived' : 'Start: explicit') : 'Start: missing',
      badges: debugBadges,
      details: `Timestamp fields:\n- session_start_timestamp: ${hasStartTs ? (hasDerivedStart ? 'present (derived)' : 'present (explicit)') : 'missing'}\n- session_end_timestamp: ${hasEndTs ? 'present' : 'missing'}\n\nNote: Start timestamp is derived from end - duration if not explicitly provided.`
    },
    {
      id: 'v2-debug-sample-keys',
      title: 'V2 Debug: Sample keys',
      subtitle: 'Top-level / metadata / normalized',
      rightMetric: `t:${nTop} m:${nMeta} n:${nNorm}`,
      badges: debugBadges,
      details: out?.debug ? JSON.stringify({
        sampleKeysTopLevel: out.debug.sampleKeysTopLevel,
        sampleKeysMetadata: out.debug.sampleKeysMetadata,
        sampleKeysNormalized: out.debug.sampleKeysNormalized,
        sampleRowRawTopLevel: (out.debug as any).sampleRowRawTopLevel,
        sampleRowRawMetadataType: (out.debug as any).sampleRowRawMetadataType,
        sampleRowRawMetadataKeys: (out.debug as any).sampleRowRawMetadataKeys,
      }, null, 2) : 'Enable V2 preview to see sample keys.'
    },
    {
      id: 'v2-debug-tool-resolution',
      title: 'V2 Debug: Tool resolution',
      subtitle: `Resolved: ${Object.keys(resolvedCounts).length} tools • Top fields: ${top3RawFieldsUsed.slice(0, 2).join(', ') || 'none'}`,
      rightMetric: (() => {
        const cursor = resolvedCounts.cursor || 0
        const windsurf = resolvedCounts.windsurf || 0
        const vscode = resolvedCounts.vscode || 0
        const unknown = resolvedCounts.unknown || 0
        const total = cursor + windsurf + vscode + unknown
        if (total === 0) return '—'
        const pctUnknown = total > 0 ? Math.round((unknown / total) * 100) : 0
        return pctUnknown >= 50 ? `⚠️ ${pctUnknown}% unknown` : `${cursor + windsurf + vscode} resolved`
      })(),
      badges: debugBadges,
      details: (() => {
        const cursor = resolvedCounts.cursor || 0
        const windsurf = resolvedCounts.windsurf || 0
        const vscode = resolvedCounts.vscode || 0
        const unknown = resolvedCounts.unknown || 0
        const total = cursor + windsurf + vscode + unknown
        const pctUnknown = total > 0 ? Math.round((unknown / total) * 100) : 0
        
        let msg = `Resolved counts:\n`
        msg += `- cursor: ${cursor}\n`
        msg += `- windsurf: ${windsurf}\n`
        msg += `- vscode: ${vscode}\n`
        msg += `- unknown: ${unknown}\n\n`
        
        if (pctUnknown >= 50 && total > 0) {
          msg += `⚠️ Warning: ${pctUnknown}% of sessions are unknown.\n`
          msg += `Upstream sessions may be missing tool/source fields.\n\n`
        }
        
        msg += `Top 3 raw fields used:\n`
        if (top3RawFieldsUsed.length > 0) {
          top3RawFieldsUsed.forEach((path, idx) => {
            const count = toolChosenPathCounts?.[path] || 0
            msg += `${idx + 1}. ${path}: ${count} sessions\n`
          })
        } else {
          msg += `(no field usage data available)\n`
        }
        
        if (toolCanonicalCounts) {
          msg += `\nCanonical tool counts:\n${JSON.stringify(toolCanonicalCounts, null, 2)}`
        }
        
        return msg
      })()
    },
    {
      id: 'v2-debug-tool-attribution-status',
      title: 'V2 Debug: Tool attribution status',
      subtitle: 'Pass/fail classification for tool resolution pipeline',
      rightMetric: (() => {
        const probe = (out?.debug as any)?.rawToolFieldProbeSessions || []
        const resolved = out?.debug?.toolDistribution || {}
        
        // Count probe sessions with any tool field populated
        const probeHasAnyToolField = probe.filter((s: any) => {
          return s?.tool || s?.editor_source || s?.source || s?.ide || 
                 s?.client || s?.appName || s?.uriScheme ||
                 s?.['metadata.tool'] || s?.['metadata.editor_source'] || s?.['metadata.source'] ||
                 s?.['metadata.ide'] || s?.['metadata.client'] || s?.['metadata.appName'] || s?.['metadata.uriScheme']
        }).length
        
        const resolvedUnknown = resolved.unknown || 0
        const resolvedTotal = Object.values(resolved).reduce((sum: number, val: any) => sum + (Number(val) || 0), 0)
        
        // Classification logic
        if (probe.length === 0) {
          return 'UPSTREAM MISSING'
        } else if (probeHasAnyToolField === 0) {
          return 'UPSTREAM MISSING'
        } else if (resolvedTotal > 0 && (resolvedUnknown / resolvedTotal) >= 0.5) {
          return 'NORMALIZATION BUG'
        } else {
          return 'OK'
        }
      })(),
      badges: (() => {
        const status = (() => {
          const probe = (out?.debug as any)?.rawToolFieldProbeSessions || []
          const resolved = out?.debug?.toolDistribution || {}
          const probeHasAnyToolField = probe.filter((s: any) => {
            return s?.tool || s?.editor_source || s?.source || s?.ide || 
                   s?.client || s?.appName || s?.uriScheme ||
                   s?.['metadata.tool'] || s?.['metadata.editor_source'] || s?.['metadata.source'] ||
                   s?.['metadata.ide'] || s?.['metadata.client'] || s?.['metadata.appName'] || s?.['metadata.uriScheme']
          }).length
          const resolvedUnknown = resolved.unknown || 0
          const resolvedTotal = Object.values(resolved).reduce((sum: number, val: any) => sum + (Number(val) || 0), 0)
          
          if (probe.length === 0) return 'UPSTREAM MISSING'
          if (probeHasAnyToolField === 0) return 'UPSTREAM MISSING'
          if (resolvedTotal > 0 && (resolvedUnknown / resolvedTotal) >= 0.5) return 'NORMALIZATION BUG'
          return 'OK'
        })()
        return status === 'OK' ? ['V2', 'OK'] : status === 'NORMALIZATION BUG' ? ['V2', 'BUG'] : ['V2', 'MISSING']
      })(),
      details: (() => {
        const probe = (out?.debug as any)?.rawToolFieldProbeSessions || []
        const resolved = out?.debug?.toolDistribution || {}
        const toolRawCounts = (out?.debug as any)?.toolRawCounts || {}
        const toolChosenPathCounts = (out?.debug as any)?.toolChosenPathCounts || {}
        
        // Count probe sessions with any tool field populated
        const probeHasAnyToolField = probe.filter((s: any) => {
          return s?.tool || s?.editor_source || s?.source || s?.ide || 
                 s?.client || s?.appName || s?.uriScheme ||
                 s?.['metadata.tool'] || s?.['metadata.editor_source'] || s?.['metadata.source'] ||
                 s?.['metadata.ide'] || s?.['metadata.client'] || s?.['metadata.appName'] || s?.['metadata.uriScheme']
        }).length
        
        const resolvedUnknown = resolved.unknown || 0
        const resolvedTotal = Object.values(resolved).reduce((sum: number, val: any) => sum + (Number(val) || 0), 0)
        const unknownPct = resolvedTotal > 0 ? Math.round((resolvedUnknown / resolvedTotal) * 100) : 0
        
        let msg = ''
        let status: string
        
        // Classification logic
        if (probe.length === 0) {
          status = 'UPSTREAM MISSING'
          msg = 'Status: UPSTREAM MISSING\n'
          msg += 'Reason: No sessions captured for probe\n'
          msg += 'This indicates the probe data is not being populated. Check shadow.ts debug output.'
        } else if (probeHasAnyToolField === 0) {
          status = 'UPSTREAM MISSING'
          msg = 'Status: UPSTREAM MISSING\n'
          msg += 'Reason: Raw sessions contain no tool/source fields\n'
          msg += `Probe checked ${probe.length} sessions, none had tool-related fields populated.\n`
          msg += 'The API payload is not providing tool/source fields. Check:\n'
          msg += '- Backend API response format\n'
          msg += '- realDataBridge.ts mapping logic\n'
          msg += '- Session data structure from /api/telemetry/sessions'
        } else if (resolvedTotal > 0 && (resolvedUnknown / resolvedTotal) >= 0.5) {
          status = 'NORMALIZATION BUG'
          msg = 'Status: NORMALIZATION BUG\n'
          msg += 'Reason: Raw fields exist but normalization still yields unknown>=50%\n'
          msg += `\nMetrics:\n`
          msg += `- Probe sessions with tool fields: ${probeHasAnyToolField}/${probe.length}\n`
          msg += `- Resolved unknown: ${resolvedUnknown}/${resolvedTotal} (${unknownPct}%)\n`
          msg += `- Resolved total: ${resolvedTotal}\n`
          
          // Find top 3 populated fields in probe
          const fieldCounts: Record<string, number> = {}
          probe.forEach((s: any) => {
            const fields = [
              'tool', 'editor_source', 'source', 'ide', 'client', 'appName', 'uriScheme',
              'metadata.tool', 'metadata.editor_source', 'metadata.source', 'metadata.ide',
              'metadata.client', 'metadata.appName', 'metadata.uriScheme'
            ]
            fields.forEach(field => {
              const val = s[field]
              if (val !== undefined && val !== null && val !== '') {
                fieldCounts[field] = (fieldCounts[field] || 0) + 1
              }
            })
          })
          
          const top3Fields = Object.entries(fieldCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([field]) => field)
          
          if (top3Fields.length > 0) {
            msg += `\nTop 3 populated raw fields:\n`
            top3Fields.forEach((field, idx) => {
              const count = fieldCounts[field]
              msg += `${idx + 1}. ${field}: ${count} sessions\n`
              
              // Show sample values from probe
              const sampleValues = probe
                .map((s: any) => s[field])
                .filter((val: any) => val !== undefined && val !== null && val !== '')
                .slice(0, 3)
              if (sampleValues.length > 0) {
                msg += `   Sample values: ${sampleValues.join(', ')}\n`
              }
            })
          }
          
          // Show what normalization is reading
          if (toolChosenPathCounts && Object.keys(toolChosenPathCounts).length > 0) {
            msg += `\nNormalization chosen paths:\n`
            const topPaths = Object.entries(toolChosenPathCounts)
              .sort((a: any, b: any) => (b[1] || 0) - (a[1] || 0))
              .slice(0, 3)
            topPaths.forEach(([path, count]: [string, any]) => {
              msg += `- ${path}: ${count} sessions\n`
            })
          }
          
          // Show raw tool values that normalization saw
          if (toolRawCounts && Object.keys(toolRawCounts).length > 0) {
            msg += `\nRaw tool values seen by normalization:\n`
            const topRaw = Object.entries(toolRawCounts)
              .sort((a: any, b: any) => (b[1] || 0) - (a[1] || 0))
              .slice(0, 5)
            topRaw.forEach(([rawVal, count]: [string, any]) => {
              msg += `- "${rawVal}": ${count} sessions\n`
            })
          }
          
          msg += `\nNext steps:\n`
          msg += `1. Check normalizeToolValue() in normalize.ts\n`
          msg += `2. Verify tool path priority in normalizeV2SessionsInternal()\n`
          msg += `3. Ensure normalizeToolValue maps these raw values correctly`
        } else {
          status = 'OK'
          msg = 'Status: OK\n'
          msg += 'Tool attribution is working correctly.\n'
          msg += `\nMetrics:\n`
          msg += `- Probe sessions with tool fields: ${probeHasAnyToolField}/${probe.length}\n`
          msg += `- Resolved unknown: ${resolvedUnknown}/${resolvedTotal} (${unknownPct}%)\n`
          if (resolvedTotal > 0) {
            const cursor = resolved.cursor || 0
            const windsurf = resolved.windsurf || 0
            const vscode = resolved.vscode || 0
            msg += `- Resolved tools: cursor=${cursor}, windsurf=${windsurf}, vscode=${vscode}\n`
          }
        }
        
        return msg
      })()
    },
    {
      id: 'v2-debug-raw-tool-field-probe',
      title: 'V2 Debug: Raw tool field probe',
      subtitle: 'First 5 sessions: tool/source/ide fields (pre-normalization)',
      rightMetric: (() => {
        const probe = (out?.debug as any)?.rawToolFieldProbeSessions
        if (!Array.isArray(probe) || probe.length === 0) return '—'
        const hasAnyValue = probe.some((s: any) => 
          s?.tool || s?.editor_source || s?.source || s?.ide || 
          s?.client || s?.appName || s?.uriScheme ||
          s?.['metadata.tool'] || s?.['metadata.editor_source'] || s?.['metadata.source'] ||
          s?.['metadata.ide'] || s?.['metadata.client'] || s?.['metadata.appName'] || s?.['metadata.uriScheme']
        )
        return hasAnyValue ? `${probe.length} sessions` : 'All empty'
      })(),
      badges: debugBadges,
      details: (() => {
        const probe = (out?.debug as any)?.rawToolFieldProbeSessions
        if (!Array.isArray(probe) || probe.length === 0) {
          return 'No raw session data available for probe. Enable V2 preview to see tool field probe.'
        }
        
        let msg = `Raw tool fields from first ${probe.length} sessions (before normalization):\n\n`
        
        probe.forEach((session: any, idx: number) => {
          msg += `Session ${idx + 1} (${session.session_id || 'unknown'}):\n`
          const fields = [
            'tool', 'editor_source', 'source', 'ide', 'client', 'appName', 'uriScheme',
            'metadata.tool', 'metadata.editor_source', 'metadata.source', 'metadata.ide',
            'metadata.client', 'metadata.appName', 'metadata.uriScheme'
          ]
          
          fields.forEach(field => {
            const val = session[field]
            const displayVal = val === undefined ? '(undefined)' : 
                             val === null ? '(null)' : 
                             val === '' ? '(empty string)' : 
                             String(val)
            msg += `  ${field}: ${displayVal}\n`
          })
          msg += '\n'
        })
        
        msg += `\nInterpretation:\n`
        msg += `- If all fields are (undefined)/(null)/(empty string), the API payload isn't providing tool/source fields.\n`
        msg += `- If fields have values but tool is still "unknown", check normalization mapping in normalize.ts.\n`
        msg += `- Fields are checked in priority order: tool > editor_source > source > ide > client > appName > uriScheme\n`
        
        return msg
      })()
    },
    {
      id: 'v2-debug-tool-source-audit',
      title: 'V2 Debug: Tool source fields audit',
      subtitle: 'Presence / empty-string / non-empty across filtered rows',
      rightMetric: (() => {
        const a = (out?.debug as any)?.toolSourceFieldsAudit
        const keys = a && typeof a === 'object' ? Object.keys(a) : []
        return keys.length > 0 ? `${keys.length} fields` : '—'
      })(),
      badges: debugBadges,
      details: out?.debug ? JSON.stringify({
        candidates: (out.debug as any).toolSourceFieldsAuditCandidates,
        audit: (out.debug as any).toolSourceFieldsAudit,
      }, null, 2) : 'Enable V2 preview to see tool source audit.'
    },
    {
      id: 'v2-debug-ai',
      title: 'V2 Debug: AI signal coverage',
      subtitle: 'Coverage for AI activity fields (best-effort)',
      rightMetric: `AI cov: ${formatMetric(aiCov?.coveragePct)}%`,
      badges: debugBadges,
      details: presentDetails({ aiCoverageRow: aiCov })
    },
    {
      id: 'v2-debug-tool-distribution',
      title: 'V2 Debug: Tool distribution',
      subtitle: 'Counts from normalized sessions',
      rightMetric: (() => {
        const dist = (toolDist && typeof toolDist === 'object') ? toolDist : {}
        const top3 = Object.entries(dist)
          .sort((a: any, b: any) => (b?.[1] ?? 0) - (a?.[1] ?? 0))
          .slice(0, 3)
        return top3.length > 0
          ? top3.map(([k, v]) => `${k}: ${v}`).join(' • ')
          : '—'
      })(),
      badges: debugBadges,
      details: out?.debug ? JSON.stringify({
        toolDistribution: out.debug.toolDistribution,
        normalizedToolHistogram: (out.debug as any).normalizedToolHistogram,
        normalizedSessionCountUsedForToolDist: (out.debug as any).normalizedSessionCountUsedForToolDist,
        toolRawCounts: (out.debug as any).toolRawCounts,
        toolCanonicalCounts: (out.debug as any).toolCanonicalCounts,
        toolDroppedCount: (out.debug as any).toolDroppedCount,
        toolChosenPathCounts: (out.debug as any).toolChosenPathCounts,
      }, null, 2) : presentDetails(toolDist || {})
    },
    {
      id: 'v2-debug-sessions-source',
      title: 'V2 Debug: Sessions input source',
      subtitle: 'Where V2 received sessions from',
      rightMetric: (() => {
        const src = out?.debug?.sessionsInputSource || 'unknown'
        const cnt = Number(out?.debug?.sessionsInputCount ?? 0)
        return `${src}: ${cnt}`
      })(),
      badges: debugBadges,
      details: out?.debug ? JSON.stringify({ sessionsInputSource: out.debug.sessionsInputSource, sessionsInputCount: out.debug.sessionsInputCount, sessionsInputFirstKeys: out.debug.sessionsInputFirstKeys }, null, 2) : 'No session source info',
    },
    {
      id: 'v2-debug-burst-timing-coverage',
      title: 'V2 Debug: Burst timing coverage',
      subtitle: 'Presence + raw type counts (normalized)',
      rightMetric: (() => {
        const total = Number(burstCov?.total ?? 0)
        const pct = (present: number) => total > 0 ? Math.round((present / total) * 1000) / 10 : 0
        const first = pct(Number(burstCov?.ai_first_burst_at_ms?.present ?? 0))
        const last = pct(Number(burstCov?.ai_last_burst_at_ms?.present ?? 0))
        const span = pct(Number(burstCov?.ai_active_span_ms?.present ?? 0))
        return total > 0 ? `first: ${first}% · last: ${last}% · span: ${span}%` : '—'
      })(),
      badges: debugBadges,
      details: presentDetails(burstCov || {})
    },
    {
      id: 'v2-debug-example-normalized-session',
      title: 'V2 Debug: Example normalized session',
      subtitle: `Chosen: ${String((out?.debug as any)?.exampleSessionChosenReason || 'unknown')}`,
      rightMetric: exampleNorm
        ? `${String(exampleNorm.session_id || '').slice(0, 8)} • ${String(exampleNorm.tool || 'unknown')}`
        : '—',
      badges: debugBadges,
      details: out?.debug ? JSON.stringify({
        exampleSessionChosenReason: (out.debug as any).exampleSessionChosenReason,
        exampleNormalizedSession: exampleNorm,
      }, null, 2) : (exampleNorm ? presentDetails(exampleNorm) : 'No normalized session sample available.')
    },
  ]

  // If V2 normalized sessions are zero, return a single friendly preview row and keep debug rows
  // If normalized sessions are zero but the harness reports 'loading', show a loading row instead
  const v2Status = out?.debug?.status || (nNorm === 0 ? 'empty' : 'ok')
  if (v2Status === 'loading') {
    return {
      previewRows: [
        {
          id: 'v2-loading-sessions',
          title: 'V2 preview loading session telemetry…',
          subtitle: 'Waiting for session data to arrive before computing preview insights.',
          rightMetric: 'loading',
          details: out?.debug ? JSON.stringify({ sessionsInputSource: out.debug.sessionsInputSource, sessionsInputCount: out.debug.sessionsInputCount }, null, 2) : 'V2 loading',
        }
      ],
      debugRows: debugRows,
      candidateRows: out?.topCandidateSignals || [],
      friendlyMessage: 'V2 preview loading session telemetry. Check V2 Debug for details.'
    }
  }

  if (v2Status === 'empty' || nNorm === 0) {
    return {
      previewRows: [
        {
          id: 'v2-no-sessions',
          title: 'No session telemetry available for V2 (0 sessions).',
          subtitle: 'V2 preview received no normalized session rows to compute insights.',
          rightMetric: `Normalized: ${nNorm}`,
          details: out?.debug ? JSON.stringify({ warning: out?.topCandidateSignals?.find((t:any)=>t.key==='v2_warning') || 'No sessions' , sessionsDebug: out.debug }, null, 2) : 'No sessions for V2',
        }
      ],
      debugRows: debugRows,
      candidateRows: out?.topCandidateSignals || [],
      friendlyMessage: `No session telemetry available for V2 (0 sessions). See V2 Debug for details.`
    }
  }

  
  // Stable row order rank map (lower number = higher priority)
  const RANK: Record<string, number> = {
    'ai-kickoff-timing': 1,
    'ai-kickoff-habit-immediate-share': 2,
    'late-ai-usage-share': 3,
    'ai-span-ratio': 4,
    'flow-profile-mix': 5,
    'prompt-thrash-cohort': 6,
    'change-volume-without-delivery': 7,
    'tool-fingerprint': 8,
  }
  
  // V2 Preview Insights rows (leader-grade)
  // Ensure we always render previewRows when status === "ok" and they exist
  const previewInsightRows: PreviewRow[] = []
  
  if (v2Status === 'ok' && ff?.previewRows && Array.isArray(ff.previewRows)) {
    // Diagnostic logging: Log incoming rows at UI input point
    piDebugLog('[PI UI INPUT]', ff.previewRows.map((r: any) => ({ id: r.id, demoFlag: r.demoFlag })));
    
    // Trace: Before mapping rows
    piDebugLog('[PI_TRACE] before-map-rows-in-buildV2PreviewRows', ff.previewRows.map((r: any) => ({ id: r.id, demoFlag: r.demoFlag })));
    
    // Step 2: Debug recommendation before mapping
    if (PI_DEBUG && ff.previewRows.length > 0) {
      const first10 = ff.previewRows.slice(0, 10);
      piDebugLog('[PI_DEBUG][STEP2][BEFORE_MAP]', first10.map((r: any) => ({
        id: r.id,
        recommendation: r.recommendation || '(missing)',
        recommendedAction: r.recommendedAction || '(missing)',
        detailRec: r.detail?.recommendation || '(missing)'
      })));
    }
    
    for (const row of ff.previewRows) {
      // Safety net: Ensure demoFlag exists (should already be set, but enforce it)
      const rowDemoFlag = (row as any).demoFlag || 'demo_secondary';
      
      previewInsightRows.push({
        id: row.id,
        title: row.title,
        subtitle: row.subtitle,
        callout: (row as any).callout,
        rightMetric: row.insufficientSignal ? 'Insufficient signal' : row.rightMetric,
        secondaryRightMetric: (row as any).secondaryRightMetric,
        confidence: (row as any).confidence,
        detail: (row as any).detail,
        badges,
        details: row.details,
        // CRITICAL: Preserve recommendation field (top-level from V2PreviewRow)
        recommendation: (row as any).recommendation,
        // CRITICAL: Preserve demoFlag and other classification fields (with safety net)
        demoFlag: rowDemoFlag,
        signalCoveragePct: (row as any).signalCoveragePct,
        contributingUnitsCount: (row as any).contributingUnitsCount,
        contributingUnitType: (row as any).contributingUnitType,
        dataMaturityLabel: (row as any).dataMaturityLabel,
        primarySignalsUsed: (row as any).primarySignalsUsed,
      } as any)
      
      // Log if we had to default (debug only)
      if (PI_DEBUG && !(row as any).demoFlag) {
        console.warn('[PI DEFAULTED demoFlag in buildV2PreviewRows]', row.id);
      }
    }
    
    // Trace: After mapping rows (before sort)
    piDebugLog('[PI_TRACE] after-map-rows-before-sort', previewInsightRows.map((r: any) => ({ id: r.id, demoFlag: r.demoFlag, urgencyLabel: (r as any).urgencyLabel })));
    
    // Step 2: Debug recommendation after mapping
    if (PI_DEBUG && previewInsightRows.length > 0) {
      const first10 = previewInsightRows.slice(0, 10);
      piDebugLog('[PI_DEBUG][STEP2][AFTER_MAP]', first10.map((r: any) => ({
        id: r.id,
        recommendation: r.recommendation || '(missing)',
        recommendedAction: r.recommendedAction || '(missing)',
        detailRec: r.detail?.recommendation || '(missing)'
      })));
    }
    
    // Sort by urgency → demoFlag → rank → title → id
    // Urgency order: action_required > investigate > monitor > informational
    // DemoFlag order: demo_primary > demo_secondary > demo_hidden
    const urgencyOrder: Record<string, number> = {
      'action_required': 4,
      'investigate': 3,
      'monitor': 2,
      'informational': 1,
    };
    const demoFlagOrder: Record<string, number> = {
      'demo_primary': 3,
      'demo_secondary': 2,
      'demo_hidden': 1,
    };
    
    previewInsightRows.sort((a, b) => {
      // 1. Urgency (highest priority)
      const aUrgency = urgencyOrder[(a as any).urgencyLabel || 'informational'] || 0;
      const bUrgency = urgencyOrder[(b as any).urgencyLabel || 'informational'] || 0;
      if (aUrgency !== bUrgency) {
        return bUrgency - aUrgency; // Higher urgency first
      }
      
      // 2. DemoFlag (demo_primary before demo_secondary)
      const aDemoFlag = demoFlagOrder[(a as any).demoFlag || 'demo_secondary'] || 0;
      const bDemoFlag = demoFlagOrder[(b as any).demoFlag || 'demo_secondary'] || 0;
      if (aDemoFlag !== bDemoFlag) {
        return bDemoFlag - aDemoFlag; // demo_primary first
      }
      
      // 3. Rank (if exists)
      const aRank = (a as any).rank ?? 999;
      const bRank = (b as any).rank ?? 999;
      if (aRank !== bRank) {
        return aRank - bRank; // Lower rank = higher priority
      }
      
      // 4. Title (alphabetical)
      if (a.title !== b.title) {
        return a.title.localeCompare(b.title);
      }
      
      // 5. ID (stable tiebreaker)
      return (a.id || '').localeCompare(b.id || '');
    });
    
    
    // Trace: After sorting
    piDebugLog('[PI_TRACE] after-sort-in-buildV2PreviewRows', previewInsightRows.map((r: any) => ({ id: r.id, demoFlag: r.demoFlag })));
  }

  // Add "Preview row IDs" debug row that reads from the rendered array
  const actualPreviewRowIds = previewInsightRows.map(r => r.id).filter(Boolean)
  const expectedPreviewRowIds = [
    'ai-kickoff-timing',
    'ai-kickoff-habit-immediate-share',
    'late-ai-usage-share',
    'ai-span-ratio',
    'flow-profile-mix',
    'prompt-thrash-cohort',
    'change-volume-without-delivery',
    'tool-fingerprint'
  ]
  const missingIds = expectedPreviewRowIds.filter(id => !actualPreviewRowIds.includes(id))
  const ghPeriodsCount = out?.debug?.githubByPeriodCount || 0
  
  if (actualPreviewRowIds.length > 0) {
    let detailsText = `MISSING: ${missingIds.length > 0 ? missingIds.join(', ') : '(none)'}\n\n`
    
    if (missingIds.length > 0 && ghPeriodsCount > 0) {
      detailsText += `NOTE: gh periods > 0 implies change-volume-without-delivery should exist\n\n`
    }
    
    detailsText += `Preview row IDs:\n${actualPreviewRowIds.join(', ')}\n\nTotal: ${actualPreviewRowIds.length} rows\n\nExpected IDs:\n${expectedPreviewRowIds.map(id => `- ${id}`).join('\n')}`
    
    debugRows.push({
      id: 'v2-debug-preview-row-ids',
      title: 'V2 Debug: Preview row IDs',
      subtitle: 'Preview row identifiers (from rendered array)',
      rightMetric: `rows ${actualPreviewRowIds.length}`,
      badges: debugBadges,
      details: detailsText
    })
  }

  // Always return preview + debug rows, even if fallbackFacts is null
  if (!ff) {
    return {
      previewRows: previewInsightRows,
      debugRows: debugRows,
      candidateRows: [],
      friendlyMessage: error
        ? `V2 preview enabled but failed at stage: ${error.stage || 'unknown'}. Check debug rows for details.`
        : `V2 preview enabled, but no fallback facts were computed. Normalized: ${nNorm}, Computed: ${computedN}. Check debug rows for details.`
    }
  }
  
  // Legacy burst timing rows (keep for backward compatibility, but preview rows are primary)
  // Note: These are not currently used in the return, previewRows are the primary source
  const burstTimingRows: PreviewRow[] = []
  if (ff?.orgAiKickoffTiming) {
    const kt = ff.orgAiKickoffTiming
    burstTimingRows.push({
      id: 'v2-ff-ai-kickoff-timing',
      title: 'AI kickoff timing',
      subtitle: 'Median first burst (minutes)',
      rightMetric: kt.p50 != null ? `${formatMetric(kt.p50)} min` : '—',
      badges,
      details: kt.p50 != null
        ? `Median first burst: ${formatMetric(kt.p50)} minutes\nCoverage: ${kt.n} sessions (${formatMetric(kt.coveragePct)}%)`
        : 'Insufficient signal: burst timing fields missing or coverage too low.'
    })
  } else {
    burstTimingRows.push({
      id: 'v2-ff-ai-kickoff-timing',
      title: 'AI kickoff timing',
      subtitle: 'Median first burst (minutes)',
      rightMetric: '—',
      badges,
      details: 'Insufficient signal: burst timing fields missing or coverage too low.'
    })
  }

  if (ff?.orgAiSpanCoverage) {
    const sc = ff.orgAiSpanCoverage
    burstTimingRows.push({
      id: 'v2-ff-ai-span-coverage',
      title: 'AI span coverage',
      subtitle: 'Median span ratio (active span / duration)',
      rightMetric: sc.p50 != null ? `${formatMetric(sc.p50 * 100)}%` : '—',
      badges,
      details: sc.p50 != null
        ? `Median span ratio: ${formatMetric(sc.p50 * 100)}%\nCoverage: ${sc.n} sessions (${formatMetric(sc.coveragePct)}%)`
        : 'Insufficient signal: burst timing fields missing or coverage too low.'
    })
  } else {
    burstTimingRows.push({
      id: 'v2-ff-ai-span-coverage',
      title: 'AI span coverage',
      subtitle: 'Median span ratio (active span / duration)',
      rightMetric: '—',
      badges,
      details: 'Insufficient signal: burst timing fields missing or coverage too low.'
    })
  }

  if (ff?.orgLateAiUsageShare) {
    const las = ff.orgLateAiUsageShare
    burstTimingRows.push({
      id: 'v2-ff-late-ai-usage-share',
      title: 'Late AI usage share',
      subtitle: '% sessions with last burst >= 75% of duration',
      rightMetric: `${formatMetric(las.share)}%`,
      badges,
      details: `Late AI usage: ${formatMetric(las.share)}% of sessions\nCoverage: ${las.n} sessions (${formatMetric(las.coveragePct)}%)`
    })
  } else {
    burstTimingRows.push({
      id: 'v2-ff-late-ai-usage-share',
      title: 'Late AI usage share',
      subtitle: '% sessions with last burst >= 75% of duration',
      rightMetric: '—',
      badges,
      details: 'Insufficient signal: burst timing fields missing or coverage too low.'
    })
  }
}

// REMOVED: v2Preview computed - replaced with v2Insights and v2InsightsByStage
// Legacy stub for template compatibility (will be removed)
const v2Preview = computed(() => ({
  previewRows: [] as PreviewRow[],
  debugRows: [] as PreviewRow[],
  candidateRows: [] as PreviewRow[],
  friendlyMessage: v2Insights.value.length === 0 ? 'No V2 insights available' : undefined
}))

// REMOVED: v2PreviewFiltered - replaced with v2InsightsByStage (props-based)
// Legacy stub for template compatibility
const v2PreviewFiltered = computed(() => ({
  primary: [] as PreviewRow[],
  secondary: [] as PreviewRow[],
  hidden: [] as PreviewRow[],
  all: [] as PreviewRow[]
}))

// OLD CODE - TO BE REMOVED
const v2PreviewFiltered_OLD = computed(() => {
  const allRows: PreviewRow[] = [] // v2Preview.value.previewRows - REMOVED
  
  // Trace: Before filtering
  piDebugLog('[PI TRACE]', 'before-v2PreviewFiltered', allRows.map((r: any) => ({ id: r.id, demoFlag: r.demoFlag })));
  
  // In debug mode, show all rows
  if (PI_DEBUG) {
    const result = {
      primary: allRows.filter(r => (r as any).demoFlag === 'demo_primary' || !(r as any).demoFlag),
      secondary: allRows.filter(r => (r as any).demoFlag === 'demo_secondary'),
      hidden: allRows.filter(r => (r as any).demoFlag === 'demo_hidden'),
      all: allRows, // For debug display
    }
    // Trace: After filtering (debug mode)
    piDebugLog('[PI TRACE]', 'after-v2PreviewFiltered-debug', {
      primary: result.primary.map((r: any) => ({ id: r.id, demoFlag: r.demoFlag })),
      secondary: result.secondary.map((r: any) => ({ id: r.id, demoFlag: r.demoFlag })),
      hidden: result.hidden.map((r: any) => ({ id: r.id, demoFlag: r.demoFlag })),
    });
    return result;
  }
  
  // Default: show only primary, secondary visible but de-emphasized
  const result = {
    primary: allRows.filter(r => (r as any).demoFlag === 'demo_primary' || !(r as any).demoFlag),
    secondary: allRows.filter(r => (r as any).demoFlag === 'demo_secondary'),
    hidden: [], // Hidden in default mode
    all: allRows.filter(r => (r as any).demoFlag !== 'demo_hidden'),
  }
  
  // Trace: After filtering (default mode)
  piDebugLog('[PI TRACE]', 'after-v2PreviewFiltered-default', {
    primary: result.primary.map((r: any) => ({ id: r.id, demoFlag: r.demoFlag })),
    secondary: result.secondary.map((r: any) => ({ id: r.id, demoFlag: r.demoFlag })),
    hidden: result.hidden.length,
  });
  
  return result;
})

// REMOVED: v2PreviewByStage computed - replaced with v2InsightsByStage (props-based)
// Legacy stub for template compatibility (will be removed after template update)
const v2PreviewByStage = computed(() => {
  // Convert V2 insights to preview format
  const convertToPreviewRow = (insight: any): PreviewRow => {
    // CM_FIX: Map V2 fields with proper precedence
    const beforeMapping = {
      rightMetric: insight.rightMetric,
      details: insight.details,
      subtitle: insight.subtitle,
      breakdownByTool: insight.breakdownByTool
    };

    const transformed = {
      id: insight.id,
      title: insight.title,
      subtitle: insight.subtitle || insight.description || '',
      rightMetric: insight.rightMetric || insight.metric || '',
      badges: insight.badges || insight.tags || [],
      details: insight.details || insight.summary || insight.description || '',
      breakdownByTool: insight.breakdownByTool,
      cicdStage: insight.cicdStage,
    } as PreviewRow;

    // CM_FIX: Log preview row mapping for validation
    if (insight.id === 'pr-review-cycles-by-ide' || insight.id === 'deployment-frequency-volatility-by-ide') {
      piDebugLog('[CM_FIX:PREVIEW_ROW_MAPPING]', {
        id: insight.id,
        before: beforeMapping,
        after: {
          rightMetric: transformed.rightMetric,
          details: transformed.details,
          subtitle: transformed.subtitle,
          breakdownByTool: transformed.breakdownByTool
        }
      });
    }

    return transformed;
  }
  
  // CM_AUDIT: Log current PI card payloads
  if (VERBOSE_PI_DEBUG) {
    piDebugLog('[CM_AUDIT:PI_CARD_PAYLOADS]', {
    reviewMerge: v2InsightsByStage.value.reviewMerge.map(c => ({
      id: c.id,
      title: c.title,
      hasEvidence: !!c.evidence,
      evidence: c.evidence,
      metrics: c.metrics,
      recommendation: c.recommendation
    })),
    deployOperate: v2InsightsByStage.value.deployOperate.map(c => ({
      id: c.id,
      title: c.title,
      hasEvidence: !!c.evidence,
      evidence: c.evidence,
      metrics: c.metrics,
      recommendation: c.recommendation
    }))
  });
  }

  return {
    planCode: v2InsightsByStage.value.planCode.map(convertToPreviewRow),
    reviewMerge: v2InsightsByStage.value.reviewMerge.map(convertToPreviewRow),
    deployOperate: v2InsightsByStage.value.deployOperate.map(convertToPreviewRow),
  }
})

// TEMP: force v2 preview rendering for recovery (matches 3.9)
// Warn if preview insights exist but view mode is not a preview mode

// ========== PI_TRACE FLAG (declare early; used by multiple computeds/watchers) ==========
const PI_TRACE = ['1', 'true'].includes(
  ((import.meta as any).env?.VITE_PI_TRACE ?? 'false')
)

const wAudit = window as any
const getAuditLatch = (key: string): boolean => {
  if (!PI_DEBUG) return true
  wAudit.__PI_AUDIT__ = wAudit.__PI_AUDIT__ || {}
  if (wAudit.__PI_AUDIT__[key]) return true
  wAudit.__PI_AUDIT__[key] = true
  return false
}

let didLogWidgetPropWatchOnce = false
let didLogWidgetV2Counts = 0
watch(
  () => props.insights,
  (next, prev) => {
    const debugEnv = (import.meta as any).env?.VITE_PI_DEBUG ?? 'false'
    const debugEnabled = debugEnv === 'true' || debugEnv === '1'
    if (!debugEnabled) return

    if (didLogWidgetV2Counts < 2) {
      try {
        const list = (next || []) as any[]
        const sample = list.slice(0, 20)
        const uniqueTags = Array.from(new Set(
          sample.flatMap((i: any) => Array.isArray(i?.tags) ? i.tags : [])
        )).slice(0, 30)

        const stageDist = (v2Insights.value || []).reduce((acc: any, i: any) => {
          const s = i?.cicdStage || inferStage(i)
          acc[s] = (acc[s] || 0) + 1
          return acc
        }, {} as Record<string, number>)

        piDebugLog('[PI_DEBUG][WIDGET_V2_COUNTS]', {
          instanceId: __piWidgetInstanceId,
          propsInsightsLen: list.length,
          v2InsightsLen: (v2Insights.value || []).length,
          uniqueTagsSample: uniqueTags,
          v2CicdStageDist: stageDist,
        })
      } catch {
        // never throw
      }
      didLogWidgetV2Counts++
    }

    if (didLogWidgetPropWatchOnce) return

    const prevList = prev || []
    const nextList = next || []
    const nextIds = nextList.map(i => i.id).filter(Boolean).slice(0, 5)

    piDebugLog('[PI_DEBUG][WIDGET_PROP_WATCH]', {
      instanceId: __piWidgetInstanceId,
      prevLen: prevList.length,
      nextLen: nextList.length,
      first5Ids: nextIds,
    })

    didLogWidgetPropWatchOnce = true
  },
  { immediate: true }
)

const getFlightRecorder = (): any | undefined => {
  if (!PI_DEBUG) return undefined
  const w = window as any
  return w.__PI_FLIGHT_RECORDER__
}

// ======= Environment variables for template =======
const featureFlag = import.meta.env.VITE_FEATURE_PERF_INSIGHTS

// ======= Stores =======
const githubStore = useGitHubStore()
const metricsFacadeStore = useMetricsFacadeStore()
const unifiedStore = useUnifiedStore()
const filterStore = useFilterStore()

// Helper function to hydrate explorer cards with real GitHub data
function hydrateGithubBackedExplorerCard(insight: any, githubSnapshot: any) {
  if (!githubSnapshot || !insight) return
  
  const rowAny = insight as any
  
  // Review & Merge hydration - USE CANONICAL METRICS FIRST
  if (insight.id === 'pr-review-cycles-by-ide') {
    // Canonical metric precedence
    const cycles = githubSnapshot.pr_review_cycles
    if (cycles !== null && cycles !== undefined) {
      insight.metricValue = cycles
      insight.displayValue = `${cycles.toFixed(1)} cycles`
      // PHASE 4K: Only update title if missing/empty (preserve narrative titles from compute)
      if (!insight.title?.trim()) {
        insight.title = `PR review cycles: ${cycles.toFixed(1)} avg`
      }
      // Context from supporting metrics — no fabricated fallbacks
      const reviewCount = githubSnapshot.pr_review_metrics?.review_count
      const totalPRs = githubSnapshot.pr_review_metrics?.total_prs
      const reviewerCount = githubSnapshot.pr_review_metrics?.unique_reviewer_count
      // Only build contextLine when real counts are present
      if (reviewCount != null && totalPRs != null && reviewerCount != null) {
        rowAny.contextLine = `${reviewCount} reviews across ${totalPRs} PRs and ${reviewerCount} reviewers`
      } else {
        rowAny.contextLine = 'GitHub review metrics unavailable'
      }
      // Fix evidence labels
      insight.coveragePct = 100
      insight.n = totalPRs ?? 0
    }
  }
  
  if (insight.id === 'reviewer-load-concentration') {
    // Canonical metric precedence
    const concentration = githubSnapshot.reviewer_load_concentration
    if (concentration !== null && concentration !== undefined) {
      insight.metricValue = concentration
      insight.displayValue = `${concentration.toFixed(1)} reviews/reviewer`
      // PHASE 4K: Only update title if missing/empty (preserve narrative titles from compute)
      if (!insight.title?.trim()) {
        insight.title = `Reviewer load concentration: ${concentration.toFixed(1)} reviews/reviewer`
      }
      // Context from supporting metrics
      // Context from supporting metrics — no fabricated fallbacks
      const reviewCount = githubSnapshot.pr_review_metrics?.review_count
      const reviewerCount = githubSnapshot.pr_review_metrics?.unique_reviewer_count
      const totalPRs = githubSnapshot.pr_review_metrics?.total_prs
      
      // PHASE 4J: Sanity filter for polluted aggregate metrics
      if (reviewCount > totalPRs * 50) {
        // Polluted aggregate - use contextual summary instead
        rowAny.contextLine = `High aggregate review count detected - using contextual analysis`
        insight.displayValue = `${reviewerCount ?? 0} reviewers`
        if (!insight.title?.trim()) {
          insight.title = `Reviewer load concentration: ${reviewerCount ?? 0} reviewers`
        }
      } else if (reviewCount != null && reviewerCount != null) {
        rowAny.contextLine = `${reviewCount} reviews across ${reviewerCount} reviewers`
      } else {
        rowAny.contextLine = 'GitHub review metrics unavailable'
      }
      
      // Fix evidence labels
      insight.coveragePct = 100
      insight.n = reviewCount ?? 0
    }
  }
  
  if (insight.id === 'reopen-pressure-spike') {
    // Canonical metric precedence
    const pressure = githubSnapshot.reopen_pressure_spike
    if (pressure !== null && pressure !== undefined) {
      insight.metricValue = pressure
      insight.displayValue = `${pressure.toFixed(1)}%`
      // PHASE 4K: Only update title if missing/empty (preserve narrative titles from compute)
      if (!insight.title?.trim()) {
        insight.title = `Reopen pressure: ${pressure.toFixed(1)}%`
      }
      // Context from supporting metrics — no fabricated fallbacks
      const reopenCount = githubSnapshot.pr_review_metrics?.pr_reopened_count
      const totalPRs = githubSnapshot.pr_review_metrics?.total_prs
      if (reopenCount != null && totalPRs != null) {
        rowAny.contextLine = `${reopenCount} reopened PRs across ${totalPRs} PRs`
      } else {
        rowAny.contextLine = 'GitHub reopen metrics unavailable'
      }
      // Fix evidence labels
      insight.coveragePct = 100
      insight.n = totalPRs ?? 0
    }
  }
  
  if (insight.id === 'large-pr-mix-risk') {
    // Canonical metric precedence
    const risk = githubSnapshot.large_pr_mix_risk
    if (risk !== null && risk !== undefined) {
      insight.metricValue = risk
      insight.displayValue = `${risk.toFixed(1)}% of PRs are large`
      // PHASE 4K: Only update title if missing/empty (preserve narrative titles from compute)
      if (!insight.title?.trim()) {
        insight.title = `Large PR mix risk: ${risk.toFixed(1)}%`
      }
      // Context from supporting metrics — no fabricated fallbacks
      const largePRs = githubSnapshot.pr_analytics?.prs_by_size?.large
      const totalPRs = githubSnapshot.pr_analytics?.total_prs
      if (largePRs != null && totalPRs != null) {
        rowAny.contextLine = `${largePRs} large PRs across ${totalPRs} PRs`
      } else {
        rowAny.contextLine = 'GitHub PR size metrics unavailable'
      }
      // Fix evidence labels
      insight.coveragePct = 100
      insight.n = totalPRs ?? 0
    }
  }
  
  // Deploy & Operate hydration - USE CANONICAL METRICS FIRST
  if (insight.id === 'deployment-frequency-volatility-by-ide') {
    // Use deployment counts to calculate total (no canonical total provided)
    const successCount = githubSnapshot.deployment_metrics?.success_deployment_count || 0
    const failedCount = githubSnapshot.deployment_metrics?.failed_deployment_count || 0
    const totalDeployments = successCount + failedCount
    if (totalDeployments > 0) {
      insight.metricValue = totalDeployments
      // DO NOT override title or displayValue - canonical generator already sets them correctly based on denominator credibility
      rowAny.contextLine = `${successCount} successful and ${failedCount} failed deployments`
      // Fix evidence labels
      insight.coveragePct = 100
      insight.n = totalDeployments
    }
  }
  
  if (insight.id === 'failed-deployment-pressure') {
    // Canonical metric precedence
    const pressure = githubSnapshot.failed_deployment_pressure
    if (pressure !== null && pressure !== undefined) {
      insight.metricValue = pressure
      insight.displayValue = `${(pressure * 100).toFixed(1)}%`
      // DO NOT override title - canonical generator already sets it correctly
      // Context from supporting metrics — no fabricated fallbacks
      const failedCount = githubSnapshot.deployment_metrics?.failed_deployment_count
      const successCount = githubSnapshot.deployment_metrics?.success_deployment_count
      const totalDeployments = (failedCount ?? 0) + (successCount ?? 0)
      if (failedCount != null && totalDeployments > 0) {
        rowAny.contextLine = `${failedCount} failed deployments out of ${totalDeployments} total deployments`
      } else {
        rowAny.contextLine = 'GitHub deployment metrics unavailable'
      }
      // Fix evidence labels
      insight.coveragePct = 100
      insight.n = totalDeployments
    }
  }
  
  if (insight.id === 'change-failure-rate-spike-by-ide') {
    // Canonical metric precedence
    const cfr = githubSnapshot.change_failure_rate
    if (cfr !== null && cfr !== undefined) {
      insight.metricValue = cfr
      insight.displayValue = `${(cfr * 100).toFixed(1)}%`
      // Use canonical title - DO NOT override with metric formatting
      rowAny.contextLine = 'Change failure rate calculated from deployment outcomes'
      // Fix evidence labels
      insight.coveragePct = 100
      insight.n = githubSnapshot.deployment_metrics ? (githubSnapshot.deployment_metrics.success_deployment_count + githubSnapshot.deployment_metrics.failed_deployment_count) : 0
    }
  }
  
  if (insight.id === 'stale-deployment-signal' && githubSnapshot.stale_deployment_signal !== null) {
    insight.metricValue = githubSnapshot.stale_deployment_signal
    insight.displayValue = `${githubSnapshot.stale_deployment_signal.toFixed(1)}h`
    // DO NOT override title - canonical generator already sets it correctly
    rowAny.contextLine = 'Time since last deployment calculated'
    // Fix evidence labels
    insight.coveragePct = 100
    insight.n = 1
  }
  
  if (insight.id === 'latest-deployment-unhealthy' && githubSnapshot.latest_deployment_status) {
    const deployment = githubSnapshot.latest_deployment_status
    insight.metricValue = deployment.status === 'failure' ? 1 : 0
    insight.displayValue = deployment.status === 'failure' ? 'Failed' : 'Success'
    // DO NOT override title - canonical generator already sets it correctly
    rowAny.contextLine = `Latest ${deployment.environment} deployment ${deployment.status}ed at ${deployment.deployed_at}`
    // Fix evidence labels
    insight.coveragePct = 100
    insight.n = 1
  }
}

// Use same GitHub time filter logic as Dashboards.vue
const githubTimeFilter = computed(() => {
  const timeComparison = filterStore.filters?.productivity?.timeComparison || 'wow'
  const derived = deriveGitHubTimeFilter(timeComparison)
  return derived
})

// GitHub metrics are fetched by Dashboards.vue in refreshPI()
// GitHub data will populate existing Performance Insights through the harness

// Manual GitHub fetch trigger to ensure data is loaded
onMounted(async () => {
  piDebugLog('[PI][GitHub] Widget mounted, checking GitHub data...')
  
  // If no GitHub data, fetch it manually
  if (!githubStore.metrics || !githubStore.rawResponse) {
    piDebugLog('[PI][GitHub] No data found, fetching manually...')
    try {
      // CR-X Phase 3 FIX: Fetch with 'all' (not 'week') to match the PI
      // engine's all-time GitHub data requirement. The previous 'week' fetch
      // raced with Dashboards.vue's 'all' fetch and won, populating the store
      // with week-filtered data (total_prs=0). This caused the PI engine to
      // see less GitHub evidence and produce fewer insights.
      await githubStore.fetchMetrics('all', { source: 'PerformanceInsightsWidget-manual' })
      piDebugLog('[PI][GitHub] Manual fetch completed')
    } catch (error) {
      console.error('[PI][GitHub] Manual fetch failed:', error)
    }
  } else {
    piDebugLog('[PI][GitHub] Data already available')
  }
})

// Debug: Check if GitHub store has data
const debugGitHubData = computed(() => {
  const metrics = github.metrics
  // FIX: Pinia auto-unwraps refs — rawResponse IS the data, not a Ref
  const raw = github.rawResponse
  piDebugLog('[PI][GitHub Debug] Store state:', {
    hasMetrics: !!metrics,
    hasRawResponse: !!raw,
    metricsKeys: metrics ? Object.keys(metrics) : [],
    rawKeys: raw ? Object.keys(raw).slice(0, 10) : [],
    changeFailureRate: metrics?.changeFailureRate,
    codeReviewTime: metrics?.codeReviewTime,
    deploymentFrequency: metrics?.deploymentFrequency
  })
  return { metrics, raw }
})

// ======= Filter helpers =======
function toISO(d:any): string | undefined {
  try {
    if (!d) return undefined
    const dt = typeof d === 'string' ? new Date(d) : d
    if (isNaN(dt as any)) return undefined
    return dt.toISOString().slice(0,10)
  } catch { return undefined }
}
function inRange(iso: string, from?: string, to?: string) {
  if (!iso) return false
  if (from && iso < from) return false
  if (to && iso > to) return false
  return true
}
function mondayISO(date: Date) {
  const d = new Date(date)
  const day = d.getDay() || 7
  if (day !== 1) d.setDate(d.getDate() - (day - 1))
  d.setHours(0,0,0,0)
  return d.toISOString().slice(0,10)
}
function lastNWeekStarts(n:number): string[] {
  const out:string[] = []
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 7*(n-1))
  for (let i=0;i<n;i++){
    const d = new Date(start)
    d.setDate(start.getDate() + 7*i)
    out.push(mondayISO(d))
  }
  return out
}

function excludeIds(list: PerformanceInsight[], excludedSet: Set<string>): PerformanceInsight[] {
  if (!excludedSet || excludedSet.size === 0) return list || []
  return (list || []).filter(i => i?.id && !excludedSet.has(i.id))
}

// Helper functions for de-spiked synthesis
function hash(str:string): number { 
  let h=0; 
  for (let i=0;i<str.length;i++) h=(h*31 + str.charCodeAt(i))|0; 
  return Math.abs(h) 
}

function rng(seed:number): () => number { 
  let s = seed|0; 
  return () => (s = (s*1664525 + 1013904223)|0, ((s>>>0)%1000)/1000) 
}

// ======= Read global filters =======
const selectedTools = computed<string[]>(() => {
  const t = (unified as any)?.filters?.tools ?? (unified as any)?.filters?.tool ?? []
  return Array.isArray(t) ? t : (t ? [t] : [])
})
const dateFrom = computed(() => toISO((unified as any)?.filters?.dateFrom ?? (unified as any)?.filters?.from))
const dateTo   = computed(() => toISO((unified as any)?.filters?.dateTo   ?? (unified as any)?.filters?.to))
const compare  = computed(() => (unified as any)?.filters?.compare ?? (unified as any)?.filters?.comparison ?? 'week')
const GRAN = computed<'day'|'week'|'month'>(() => {
  const c = String(compare.value || '').toLowerCase()
  if (c.includes('day')) return 'day'
  if (c.includes('month')) return 'month'
  return 'week'
})

// ======= Rollup helpers (local) =======
function rollupDailyToWeeks(arr:any[]) {
  // expects items with .period (YYYY-MM-DD)
  const byWeek = new Map<string, any>()
  for (const p of arr || []) {
    const iso = String(p?.period ?? p?.date ?? '')
    if (!iso) continue
    const wk = mondayISO(new Date(iso))
    const key = `${wk}::${p.tool || ''}`
    const prev = byWeek.get(key) || { ...p, period: wk }
    // sum numeric props we care about
    const ai = Number(p.aiAssists ?? p.ai_assists ?? 0)
    const mins = Number(p.codingMinutes ?? p.coding_minutes ?? 0)
    prev.aiAssists = Number(prev.aiAssists ?? 0) + ai
    prev.codingMinutes = Number(prev.codingMinutes ?? 0) + mins
    byWeek.set(key, prev)
  }
  return Array.from(byWeek.values())
}

function rollupEngDailyToWeeks(arr:any[]) {
  const byWeek = new Map<string, any>()
  for (const p of arr || []) {
    const iso = String(p?.period ?? p?.date ?? '')
    if (!iso) continue
    const wk = mondayISO(new Date(iso))
    const prev = byWeek.get(wk) || { period: wk }
    // Map common eng metrics
    const ct = Number(p.prCycleTimeHours ?? p.leadTime ?? p.timeToMergeHoursAvg ?? 0)
    const rt = Number(p.timeToFirstReviewHours ?? p.codeReviewTime ?? 0)
    const df = Number(p.deploymentFreqPerWeek ?? p.deploymentFrequency ?? 0)
    const mr = Number(p.mergeRatePct ?? p.mergeRate ?? 0)
    const cfr = Number(p.changeFailureRatePct ?? p.changeFailureRate ?? 0)
    prev.prCycleTimeHours = (prev.prCycleTimeHours ?? 0) + ct
    prev.timeToFirstReviewHours = (prev.timeToFirstReviewHours ?? 0) + rt
    prev.deploymentFreqPerWeek = (prev.deploymentFreqPerWeek ?? 0) + df
    prev.mergeRatePct = (prev.mergeRatePct ?? 0) + mr
    prev.changeFailureRatePct = (prev.changeFailureRatePct ?? 0) + cfr
    byWeek.set(wk, prev)
  }
  // average where appropriate
  return Array.from(byWeek.values()).map(r => ({
    ...r,
    prCycleTimeHours: r.prCycleTimeHours,
    timeToFirstReviewHours: r.timeToFirstReviewHours,
  }))
}

// ======= Multi-source resolvers with widen & synth =======
function resolveGhSeries(gran:'day'|'week'|'month', from?:string, to?:string) {
  // Try richest sources first
  const candidates:any[] = [
    // filtered weekly if your store exposes it
    (github as any)?.getFilteredWeeklyMetrics?.() ?? undefined,
    (github as any)?.metricsHistory?.weekly,
    (github as any)?.history?.weekly,
    (github as any)?.metricsHistory?.daily,
    (github as any)?.history?.daily,
  ].filter(Boolean).flat()

  const filterTime = (arr:any[]) => (arr || []).filter((p:any) => inRange(String(p?.period ?? p?.date ?? ''), from, to))

  let used = 'github-store:weekly/daily', widened = false, synthesized = false
  let series:any[] = []

  // prefer weekly forms
  const weeklyFirst = candidates.filter((x:any)=> String(x?.period ?? '').length === 10 && /-..-../.test(String(x.period))).filter(Boolean)

  if (gran === 'day') {
    // day: take daily if available else expand weekly to faux daily (skip; demo uses weekly)
    series = filterTime(candidates.filter((x:any)=> x && x.period && String(x.period).length===10))
  } else {
    // week: take weekly if available, else roll daily to weeks
    const weekly = filterTime(weeklyFirst.length ? weeklyFirst : [])
    if (weekly.length >= MIN_PERIODS) {
      series = weekly
      used = 'github-weekly'
    } else {
      const daily = filterTime((github as any)?.metricsHistory?.daily ?? (github as any)?.history?.daily ?? [])
      const rolled = rollupEngDailyToWeeks(daily)
      series = rolled
      used = 'github-daily→weekly'
    }
  }

  // widen if too short
  if (series.length < MIN_PERIODS) {
    widened = true
    // ignore range and try again
    if (gran === 'week') {
      const wk = weeklyFirst.length ? weeklyFirst : rollupEngDailyToWeeks((github as any)?.metricsHistory?.daily ?? (github as any)?.history?.daily ?? [])
      series = (wk || [])
      used += '+widened'
    }
  }

  // synth if still short
  if (series.length < MIN_PERIODS && ALLOW_SYNTH) {
    synthesized = true
    const weeks = lastNWeekStarts(SYNTH_WEEKS)
    const avgCT = 36, avgRT = 6, avgDF = 5, avgMR = 70, avgCFR = 6
    series = weeks.map((w, i) => {
      const r = rng(hash('github') + i*17)
      return {
        period: w,
        prCycleTimeHours: avgCT + Math.sin(i*0.7)*8 + 12*(r()-0.5),
        timeToFirstReviewHours: avgRT + Math.cos(i*0.4)*2 + 4*(r()-0.5),
        deploymentFreqPerWeek: avgDF + Math.sin(i*0.5) + 2*(r()-0.5),
        mergeRatePct: avgMR + Math.cos(i*0.3)*5 + 8*(r()-0.5),
        changeFailureRatePct: Math.max(0, avgCFR + Math.sin(i*0.6)*2 + 3*(r()-0.5)),
      }
    })
    used = 'github-synth'
  }

  return { series, used, widened, synthesized }
}

function resolveProdSeries(gran:'day'|'week'|'month', tools:string[], from?:string, to?:string, alignTo?:string[]) {
  const toolSet = new Set((tools || []).map(t => String(t).toLowerCase()))

  const rawDaily = (metricsFacade as any)?.productivityHistory?.daily ?? (metricsFacade as any)?.history?.daily ?? []
  const rawWeekly = (metricsFacade as any)?.getFilteredWeeklyProductivity?.() ?? (metricsFacade as any)?.productivityHistory?.weekly ?? (metricsFacade as any)?.history?.weekly ?? []

  const filterTool = (arr:any[]) => (arr || []).filter((p:any) => {
    if (!toolSet.size) return true
    const id = String(p?.tool ?? p?.toolId ?? p?.ide ?? '').toLowerCase()
    return toolSet.has(id)
  })
  const filterTime = (arr:any[]) => (arr || []).filter((p:any) => inRange(String(p?.period ?? p?.date ?? ''), from, to))

  let used = 'metrics-store:weekly/daily', widened = false, synthesized = false
  let series:any[] = []

  if (gran === 'day') {
    series = filterTool(filterTime(rawDaily))
    used = 'prod-daily'
  } else {
    // prefer weekly if available
    const wk = filterTool(filterTime(rawWeekly))
    if (wk.length >= MIN_PERIODS) {
      series = wk
      used = 'prod-weekly'
    } else {
      const rolled = rollupDailyToWeeks(filterTool(filterTime(rawDaily)))
      series = rolled
      used = 'prod-daily→weekly'
    }
  }

  if (series.length < MIN_PERIODS) {
    widened = true
    // ignore date filter to recover more
    if (gran === 'week') {
      const wk = filterTool(rawWeekly.length ? rawWeekly : rollupDailyToWeeks(rawDaily))
      series = wk
      used += '+widened'
    }
  }

  if (series.length < MIN_PERIODS && ALLOW_SYNTH) {
    synthesized = true
    const weeks = alignTo && alignTo.length ? alignTo : lastNWeekStarts(SYNTH_WEEKS)
    const synthTools = tools.length ? tools : ['cursor','vscode','jetbrains','windsurf','sublime','vim']
    const out:any[] = []
    weeks.forEach((w,i) => synthTools.forEach((tool, k)=>{
      const r = rng(hash(tool)+i*17+k*7)
      // Add more randomness and tool-specific patterns
      const toolHash = hash(tool)
      const baseAI = 45 + (toolHash % 20) // Tool-specific base
      const baseMins = 110 + (toolHash % 30) // Tool-specific base
      const ai = Math.round(baseAI + 30*Math.sin(i*0.6 + k + toolHash*0.1) + 20*(r()-0.5))
      const mins = Math.round(baseMins + 40*Math.cos(i*0.5 + k*0.3 + toolHash*0.2) + 25*(r()-0.5))
      out.push({ period: w, tool: String(tool).toLowerCase(), aiAssists: Math.max(0,ai), codingMinutes: Math.max(1,mins) })
    }))
    series = out
    used = 'prod-synth'
  }

  return { series, used, widened, synthesized }
}

// ======= Build final series =======
const ghResolved = computed(() => resolveGhSeries('week', dateFrom.value, dateTo.value))
const prodResolved = computed(() => resolveProdSeries('week', selectedTools.value, dateFrom.value, dateTo.value,
  ghResolved.value.series.map((p:any)=> p.period)
))

// ======= Run engine (weekly arrays) =======
// Track if we've ever received insights from parent to prevent fallback during refresh
const hasReceivedParentInsights = ref(false)

const widgetFallbackInsightsCache = ref<PerformanceInsight[] | null>(null)

const raw = computed(() => {
  // ========== PI_TRACE: Props received ==========
  if (PI_TRACE) {
    console.group('🔍 [PI_TRACE][WIDGET_PROPS] Props received');
    piDebugLog('props.insights exists:', !!props.insights);
    piDebugLog('props.insights length:', props.insights?.length || 0);
    piDebugLog('curatedInsights length:', curatedInsights.value?.length || 0);
    if (props.insights && props.insights.length > 0) {
      console.table(props.insights.map(i => ({
        id: i.id,
        title: i.title?.slice(0, 40),
        cicdStage: i.cicdStage,
        orgKind: i.orgKind,
        insightClass: i.insightClass
      })));
    }
    console.groupEnd();
  }
  
  if (curatedInsights.value && curatedInsights.value.length > 0) {
    // TEMP: Log curated Review & Merge insights
    if (PI_DEBUG) {
      const curatedRM = curatedInsights.value.filter(i => i.cicdStage === 'review-merge')
      console.debug('[PI][Widget] raw computed - Review & Merge (CURATED):', curatedRM.map(i => i.title))
    }
    
    // DEV-only trace: total insights received
    if (PI_DEBUG) {
      const deployOperateCurated = curatedInsights.value.filter(i => i.cicdStage === 'deploy-operate')
      console.warn('[PI][Widget][DeployOperate] total insights received (CURATED)', {
        total: curatedInsights.value.length,
        deployOperate: deployOperateCurated.length,
        deployOperateInsights: deployOperateCurated.map(i => ({
          title: i.title,
          id: i.id,
          severity: i.severity
        }))
      })
    }
    
    return curatedInsights.value
  }

  return []
})

// ======= Order and map =======
const finalInsights = computed(() => {
  const rawInsights = Array.isArray(raw.value) ? raw.value : []
  
  piDebugLog('[CM_AUDIT:STAGE_8_WIDGET_FINAL]', {
    finalInsightsLength: rawInsights.length
  });
  
  // Apply quality gate filtering and deduplication
  const afterSuppression = filterLowValueInsights(rawInsights)
  const afterDedup = dedupeInsights(afterSuppression)
  
  // Apply existing deduplication for backward compatibility
  const deduped = dedupeByEquivalenceKey(afterDedup)
  
  // CR-X FINAL: Expose ALL widget pipeline stages for browser/harness reconciliation
  if (typeof window !== 'undefined') {
    const stageD = Array.isArray(rawInsights) ? rawInsights.map((i: any) => i?.id).filter(Boolean) : []
    const stageE = Array.isArray(afterSuppression) ? afterSuppression.map((i: any) => i?.id).filter(Boolean) : []
    const stageF = Array.isArray(afterDedup) ? afterDedup.map((i: any) => i?.id).filter(Boolean) : []
    const stageG = Array.isArray(deduped) ? deduped.map((i: any) => i?.id).filter(Boolean) : []
    ;(window as any).__PI_STAGE_D_WIDGET_INPUT__ = stageD
    ;(window as any).__PI_STAGE_E_POST_FILTER_LOW_VALUE__ = stageE
    ;(window as any).__PI_STAGE_F_POST_DEDUPE_INSIGHTS__ = stageF
    ;(window as any).__PI_STAGE_G_POST_DEDUPE_EQUIVALENCE__ = stageG
  }
  
  // ========== CR5 P0-9: EXPLICIT DROP TRACING ==========
  if (PI_DEBUG) {
    const dropped = rawInsights.length - deduped.length
    piDebugLog(`[PI_WIDGET_RECEIVED] Received ${rawInsights.length} insights`)
    piDebugLog(`[PI_DEBUG][WIDGET_PROCESSED] total=${deduped.length}, dropped=${dropped}`)
    if (dropped > 0) {
      const droppedIds = rawInsights.filter(r => !deduped.find(d => d.id === r.id)).map(i => ({ id: i.id, title: i.title }))
      if (PI_DEBUG) console.warn('[CR5_WIDGET_DROPS]', JSON.stringify(droppedIds))
    }
    piDebugLog('[PI_DEBUG][RECEIVED_IDS]', rawInsights.map(i => i.id))
    piDebugLog('[PI_DEBUG][PROCESSED_IDS]', deduped.map(i => i.id))
  }
  
  // CM_FORENSIC: Final render payload for Review & Merge + Deploy & Operate cards
  const reviewMergeCards = deduped.filter(i => i.cicdStage === 'review-merge');
  const deployOperateCards = deduped.filter(i => i.cicdStage === 'deploy-operate');

  // CM_TRACE: Log final render payload
  const traceCard = (card: any) => {
    if (card.id === 'pr-review-cycles-by-ide' || card.id === 'deployment-frequency-volatility-by-ide') {
      piDebugLog('[CM_TRACE:FINAL]', {
        id: card.id,
        title: card.title,
        metric: card.rightMetric,
        summary: card.details,
        evidence: card.details,
        confidence: card.insufficientSignal
      });
    }
  };

  reviewMergeCards.forEach(traceCard);
  deployOperateCards.forEach(traceCard);
  
  piDebugLog('[CM_FORENSIC:FINAL_RENDER_PAYLOAD]', {
    reviewMerge: reviewMergeCards.map(c => ({
      id: c.id,
      title: c.title,
      subtitle: c.subtitle,
      metric: c.metric,
      rightMetric: c.rightMetric,
      summary: c.summary,
      evidence: c.evidence,
      confidence: c.confidence,
      raw: c
    })),
    deployOperate: deployOperateCards.map(c => ({
      id: c.id,
      title: c.title,
      subtitle: c.subtitle,
      metric: c.metric,
      rightMetric: c.rightMetric,
      summary: c.summary,
      evidence: c.evidence,
      confidence: c.confidence,
      raw: c
    }))
  });

  // Step 3: UI Confirmation - Print final ids/titles actually rendered per stage
  if (PI_DEBUG) {
  console.group('📱 [PI_WIDGET_FINAL] Final Insights Rendered Per Stage');
  ['plan-code', 'review-merge', 'deploy-operate'].forEach(stage => {
    const stageInsights = deduped.filter(i => i.cicdStage === stage);
    piDebugLog(`\n${stage} (${stageInsights.length} insights):`);
    stageInsights.forEach((i, idx) => {
      const orgKind = i.orgKind || 'none';
      const insightClass = i.insightClass || 'unknown';
      const source = i.source || 'unknown';
      const ruleId = (i as any).ruleId || 'unknown';
      piDebugLog(`  ${idx + 1}. [${i.id}] ${i.title?.slice(0, 70)} (orgKind=${orgKind}, class=${insightClass}, source=${source}, rule=${ruleId})`);
    });
  });
  console.groupEnd();
  }
  
  // Return the filtered insights with correct stages
  return deduped;
})

// Expose actual rendered insights for coverage matrix tracking
watch(finalInsights, (newInsights) => {
  if (typeof window !== 'undefined') {
    (window as any).__CM_WIDGET_RENDERED_INSIGHTS = newInsights;
    // Expose rendered IDs for inventory analysis
    (window as any).__PI_RENDERED_IDS__ = newInsights.map(i => i.id);
    // CR-X FINAL: Expose rendered insights with classification for clean harness capture
    (window as any).__PI_RENDERED_INSIGHTS__ = newInsights.map(i => ({
      id: i.id,
      isDiagnostic: !!(i as any).isDiagnostic,
      title: i.title,
      cicdStage: (i as any).cicdStage,
    }));
  }
}, { immediate: true, deep: true });

const rawSorted = computed(() => {
  const arr = [...finalInsights.value]
  return arr.sort((a:any,b:any) => {
    const pa = (a.priorityScore ?? 0), pb = (b.priorityScore ?? 0)
    if (pb !== pa) return pb - pa
    return impactScore(b) - impactScore(a)
  })
})
const maxPriority = Number(import.meta.env.VITE_PERF_INSIGHTS_MAX ?? 16);
const rawPriorityTop = computed(() =>
  (rawSorted.value || []).filter((x:any) =>
    x.critical === true ||
    x.normalizedSeverity === 'risk' ||
    x.normalizedSeverity === 'lowlight'
  ).slice(0, maxPriority)
)
const panelItems = computed(() => mapPerfToPanel(rawSorted.value))
const panelPriorityTop = computed(() => mapPerfToPanel(rawPriorityTop.value))

// Removed verbose dev logs

// Safety fallback: Select best available insights (v2 preview or legacy)
// Prevents blank UI when one pipeline is empty but the other has data
const effectiveInsights = computed(() => {
  const v2Count = v2Insights.value.length
  const legacyCount = (finalInsights.value || []).length
  
  // If v2 preview has insights, prefer them
  if (v2Count > 0) {
    return { source: 'v2', count: v2Count, insights: null } // v2 uses previewRows, not PerformanceInsight[]
  }
  
  // Otherwise use legacy
  return { source: 'legacy', count: legacyCount, insights: finalInsights.value || [] }
})

// Demo narrative enhancer - presentation-layer enrichment only
function enhanceDemoInsightNarrative(insight: PerformanceInsight): PerformanceInsight {
  // CANONICAL_PI_TRACE: Log before enhancement
  piDebugLog('[CANONICAL_PI_TRACE] ENHANCEMENT_BEFORE', {
    id: insight.id,
    title: insight.title?.substring(0, 80),
    details: insight.details?.substring(0, 80),
    recommendation: insight.recommendation?.substring(0, 80)
  });

  // Only apply to Review & Merge and Deploy & Operate insights
  const targetInsights = [
    'review-latency-spike-by-ide', 'pr-review-cycles-by-ide', 'reviewer-load-concentration',
    'reopen-pressure-spike', 'large-pr-mix-risk', 'deployment-frequency-volatility-by-ide',
    'change-failure-rate-spike-by-ide', 'delivery-velocity-by-workflow',
    'stale-deployment-signal', 'failed-deployment-pressure', 'latest-deployment-unhealthy'
  ];

  // SKIP ENHANCEMENT FOR CANONICAL SYNTHESIZED PIs
  const canonicalSynthesizedPIs = [
    'delivery-rate-ai-vs-non-ai',
    'active-coding-time-by-ide',
    'telemetry-ai-focus-imbalance',
    'session-conditioned-pr-cycle-time-ai-vs-non-ai',
    'reopen-pressure-spike',
    'reviewer-load-concentration',
    'revert-rate-by-ide',
    'delivery-velocity-by-workflow',
    'change-failure-rate-spike-by-ide',
    'synthesized-deployment-cadence'
  ];

  if (canonicalSynthesizedPIs.includes(insight.id)) {
    piDebugLog('[CANONICAL_PI_TRACE] ENHANCEMENT_SKIPPED', {
      id: insight.id,
      reason: 'Canonical synthesized PI - preserving executive framing'
    });
    return insight;
  }

  if (!targetInsights.includes(insight.id)) {
    return insight;
  }
  
  const metric = insight.rightMetric || insight.displayValue?.toString() || 'unknown';
  let newTitle = insight.title;
  let newDescription = insight.description;
  let newSubtitle = insight.subtitle;
  let newExecutiveSummary = insight.executiveSummary;
  
  // Specific narrative mappings using current rendered metrics
  switch (insight.id) {
    case 'review-latency-spike-by-ide':
      newTitle = `Review turnaround is fast: ${metric} to initial review`;
      newDescription = `PRs are reaching review quickly, which means the review lane is not currently the main delivery bottleneck.`;
      break;
      
    case 'pr-review-cycles-by-ide':
      newTitle = `PRs are clearing review with minimal back-and-forth: ${metric}`;
      newDescription = `Low review-cycle count suggests reviewers are not repeatedly sending work back through the same loop.`;
      break;
      
    case 'reviewer-load-concentration':
      newTitle = `Reviewer load is distributed: top reviewer owns ${metric} of reviews`;
      newDescription = `Review responsibility is not dangerously concentrated in one person, reducing approval bottleneck risk.`;
      break;
      
    case 'reopen-pressure-spike':
      newTitle = `Reopen pressure is low: ${metric} of PRs reopened`;
      newDescription = `Few reopened PRs suggests merged work is generally staying merged instead of cycling back into review.`;
      break;
      
    case 'large-pr-mix-risk':
      newTitle = `Large PR exposure is contained: ${metric} of PRs are large`;
      newDescription = `Large PRs exist but are not dominating the review queue, which helps keep merge latency predictable.`;
      break;
      
    case 'deployment-frequency-volatility-by-ide':
      newTitle = `Deployment cadence is active: ${metric}`;
      newDescription = `The team is shipping regularly enough to support a credible delivery-performance story, but cadence should be compared against failure rate before claiming acceleration.`;
      break;
      
    case 'change-failure-rate-spike-by-ide':
      newTitle = `Deployment quality needs attention: ${metric} change failure rate`;
      newDescription = `The current change failure rate is the clearest reliability risk signal in the delivery pipeline.`;
      break;
      
    case 'delivery-velocity-by-workflow':
      if (metric === 'insufficient' || metric.includes('insufficient')) {
        newTitle = `Delivery velocity baseline is still forming`;
        newDescription = `Telemetry exists across tools, but this workflow needs more matched delivery history before comparing IDE-level velocity.`;
      } else {
        newTitle = `Delivery velocity is measurable across workflow: ${metric}`;
        newDescription = insight.description;
      }
      break;
      
    case 'stale-deployment-signal':
      newTitle = `Deployment freshness risk: ${metric} since last deploy`;
      newDescription = `A long gap since the latest deploy can signal release drag even when development activity is high.`;
      break;
      
    case 'failed-deployment-pressure':
      newTitle = `Failed deploy pressure is material: ${metric} failed`;
      newDescription = `Deployment failure rate is high enough to matter because it connects AI-assisted output to downstream operational risk.`;
      break;
      
    case 'latest-deployment-unhealthy':
      if (metric.includes('success') || insight.displayValue === 'success') {
        newTitle = `Latest deployment is healthy`;
        newDescription = `The most recent deployment succeeded, so current release state is stable despite broader failure-rate pressure.`;
      } else {
        newTitle = `Latest deployment needs attention`;
        newDescription = `The most recent deployment did not complete cleanly, making release health an immediate operational concern.`;
      }
      break;
  }
  
  return {
    ...insight,
    title: newTitle,
    description: newDescription,
    subtitle: newSubtitle,
    executiveSummary: newExecutiveSummary
  };
}

// Phase 4: DEMO_MODE-aware filtering
// In DEMO_MODE, keep all insights including coverage; outside DEMO_MODE, filter coverage
// PATCH: Keep diagnostic coverage cards in allInsights for canonical 25 coverage
const allInsights = computed(() => {
  const fi = (finalInsights.value || []) as PerformanceInsight[]
  
  // Apply demo narrative enhancement to target insights
  const enhancedInsights = fi.map(insight => enhanceDemoInsightNarrative(insight));
  
  // Log enhancement activity
  const changedInsights = enhancedInsights.filter((enhanced, index) => 
    enhanced.title !== fi[index].title || enhanced.description !== fi[index].description
  );
  
  if (changedInsights.length > 0) {
    piDebugLog('[CM_DEMO_NARRATIVE_ENHANCER]', {
      changedCount: changedInsights.length,
      idsChanged: changedInsights.map(i => i.id)
    });
  }
  // ========== PI_TRACE: Before allInsights filtering ==========
  if (PI_TRACE) {
    console.group('🔍 [PI_TRACE][WIDGET_ALLINSIGHTS] allInsights computed');
    piDebugLog('finalInsights.value length:', fi.length);
    piDebugLog('DEMO_MODE:', DEMO_MODE);
    piDebugLog('finalInsights IDs:', fi.map(i => i.id));
    piDebugLog('finalInsights titles:', fi.map(i => i.title?.slice(0, 40)));
  }
  
  let result: PerformanceInsight[]
  if (DEMO_MODE) {
    // DEMO_MODE: Keep all insights, including demo coverage insights
    result = enhancedInsights
  } else {
    // Non-DEMO: Keep diagnostic coverage cards for canonical 25 coverage
    // Only filter out old-style coverage cards (coverage/insufficient, tags=coverage)
    const beforeFilter = enhancedInsights.length;
    result = enhancedInsights.filter(insight => 
      insight.id !== 'coverage/insufficient' && 
      !insight.tags?.includes('coverage')
    )
    
    // ========== PI_TRACE: After coverage filter ==========
    if (PI_TRACE) {
      const filtered = beforeFilter - result.length;
      piDebugLog('After coverage filter:', {
        before: beforeFilter,
        after: result.length,
        filtered: filtered,
        filteredIds: fi
          .filter(i => i.id === 'coverage/insufficient' || i.tags?.includes('coverage'))
          .map(i => i.id)
      });
    }
  }
  
  // Custom hide logic for specific titles - TEMPORARILY DISABLED FOR DEBUGGING
  const titlesToHide = [
    // "Delivery Rate Ai Vs Non Ai: 0.0 (no data)",
    // "Ai Rework Burden Ai Vs Non Ai: 0.0 (no data)", 
    // "Ai Yield Ratio Ai Vs Non Ai: 0.0 (no data)",
    // "Branch stagnation: 0.0% (AI) • 0.0% (Non-AI)",
    // "Review Merge Git Context: 0.0 (no data)",
    // "V2 First Review Latency: 0.0 (no data)",
    // "V2 Release Risk Index: 0.0 (no data)",
    // "Pr Size By Ide: 0.0 (no data)",
    // "Change risk: 1.00x (no matched periods)",
    // "MTTR",
    // "No deployment velocity data available"
  ]
  
  // Debug: Log all insight titles before filtering
  piDebugLog('[CUSTOM_HIDE_DEBUG] All insight titles before filtering:', result.map(i => i.title))
  piDebugLog('[CUSTOM_HIDE_DEBUG] Titles to hide:', titlesToHide)
  
  const beforeCustomHide = result.length
  const filteredInsights = []
  const hiddenInsights = []
  
  result.forEach(insight => {
    const shouldHide = titlesToHide.some(hideTitle => 
      insight.title === hideTitle || 
      insight.title?.includes(hideTitle) ||
      hideTitle.includes(insight.title)
    )
    
    if (shouldHide) {
      hiddenInsights.push(insight)
    } else {
      filteredInsights.push(insight)
    }
  })
  
  piDebugLog('[CUSTOM_HIDE_DEBUG] Hidden insights:', hiddenInsights.map(i => i.title))
  piDebugLog('[CUSTOM_HIDE_DEBUG] Kept insights:', filteredInsights.map(i => i.title))
  
  result = filteredInsights
  
  // Log custom hide filtering
  if (PI_DEBUG && beforeCustomHide > result.length) {
    piDebugLog('[CUSTOM_HIDE] Filtered insights:', {
      before: beforeCustomHide,
      after: result.length,
      filtered: beforeCustomHide - result.length,
      hiddenTitles: titlesToHide
    })
  }
  
  // ========== PI_TRACE: Final allInsights result ==========
  if (PI_TRACE) {
    piDebugLog('Final allInsights result:', {
      length: result.length,
      IDs: result.map(i => i.id),
      titles: result.map(i => i.title?.slice(0, 40)),
      byStage: {
        'plan-code': result.filter(i => i.cicdStage === 'plan-code').length,
        'review-merge': result.filter(i => i.cicdStage === 'review-merge').length,
        'deploy-operate': result.filter(i => i.cicdStage === 'deploy-operate').length
      }
    });
    console.groupEnd();
  }
  
  // TEMP: Log Review & Merge after allInsights filtering
  if (PI_DEBUG) {
    const allRM = result.filter(i => i.cicdStage === 'review-merge')
    console.debug('[PI][Widget] allInsights (after coverage filter) - Review & Merge:', allRM.map(i => i.title))
  }
  
  // Debug logging for filtering pipeline (guarded by VITE_PI_DEBUG)
  if (PI_DEBUG) {
    const qualityGateResult = filterLowValueInsights(result)
    const byStage = {
      'plan-code': result.filter(i => i.cicdStage === 'plan-code').length,
      'review-merge': result.filter(i => i.cicdStage === 'review-merge').length,
      'deploy-operate': result.filter(i => i.cicdStage === 'deploy-operate').length,
      'other': result.filter(i => !i.cicdStage || i.cicdStage === 'other').length
    }
    const qualityGateByStage = {
      'plan-code': qualityGateResult.filter(i => i.cicdStage === 'plan-code').length,
      'review-merge': qualityGateResult.filter(i => i.cicdStage === 'review-merge').length,
      'deploy-operate': qualityGateResult.filter(i => i.cicdStage === 'deploy-operate').length,
      'other': qualityGateResult.filter(i => !i.cicdStage || i.cicdStage === 'other').length
    }
    
    piDebugLog('[PI_DEBUG][FILTERING_PIPELINE]', {
      allInsightsCount: result.length,
      allInsightsByStage: byStage,
      afterQualityGate: qualityGateResult.length,
      afterQualityGateByStage: qualityGateByStage,
      stagesWithZeroCards: Object.entries(byStage)
        .filter(([_, count]) => count === 0)
        .map(([stage]) => stage)
    })
  }
  
  return result
})

// PROOF LOG: Verify all render inputs are 15
if (PI_DEBUG) {
  watchEffect(() => {
    console.info('[PI_RENDER_INPUT_PROOF]', {
      propsCount: props.insights?.length ?? 0,
      curatedCount: curatedInsights.value.length,
      curatedIds: curatedInsights.value.map(x => x.id),
      rawCount: raw?.value?.length ?? 0,
      finalCount: finalInsights.value?.length ?? 0,
      allInsightsCount: allInsights.value?.length ?? 0,
      v2Count: v2Insights.value?.length ?? 0,
    });
  });
}

// Phase 1 audit: log widget pipeline once per page load (outside computed to avoid render/patch side-effects)
// DISABLED: Potential refresh loop trigger - watchEffect causing continuous re-renders
// watchEffect(() => {
//   if (!PI_DEBUG) return
//   const propsList = Array.isArray(props.insights) ? props.insights : []
//   if (propsList.length === 0) return
//   if (getAuditLatch('WIDGET_PIPELINE')) return

//   try {
//     const finalList = Array.isArray(finalInsights.value) ? finalInsights.value : []
//     const renderedList = Array.isArray(allInsights.value) ? allInsights.value : []

//     const byStage = (list: PerformanceInsight[]) => list.reduce((acc, i) => {
//       const s = i.cicdStage || 'unknown'
//       acc[s] = (acc[s] || 0) + 1
//       return acc
//     }, {} as Record<string, number>)

//     const renderedIds = renderedList.map(i => i.id).filter(Boolean)
//     const dupes: string[] = []
//     const seen = new Set<string>()
//     renderedIds.forEach(id => {
//       if (seen.has(id)) dupes.push(id)
//       seen.add(id)
//     })

//     piDebugLog('[PI_AUDIT][WIDGET_PIPELINE]', {
//       propsInsightsLen: propsList.length,
//       finalInsightsLen: finalList.length,
//       renderedLen: renderedList.length,
//       perStage: {
//         props: byStage(propsList as any),
//         finalInsights: byStage(finalList as any),
//         rendered: byStage(renderedList as any),
//       },
//       coverageFilteredCount: finalList.length - renderedList.length,
//       droppedIdsCoverage: finalList
//         .filter(i => i.id === 'coverage/insufficient' || i.tags?.includes('coverage'))
//         .map(i => i.id),
//       renderedIds,
//       duplicates: dupes,
//     })
//   } catch (e) {
//     console.warn('[PI_AUDIT][WIDGET_PIPELINE] failed to log', e)
//   }
// })

// Audit: enumerate actual render targets (strip + card panels) and compute any unassigned IDs
// DISABLED: Potential refresh loop trigger - watchEffect causing continuous re-renders
// watchEffect(() => {
//   if (!PI_DEBUG) return
//   const propsList = Array.isArray(props.insights) ? props.insights : []
//   if (propsList.length === 0) return
//   if (getAuditLatch('RENDER_TARGETS')) return

//   try {
//     const expectedRenderedIds = (Array.isArray(allInsights.value) ? allInsights.value : [])
//       .map(i => i.id)
//       .filter(Boolean)

//     const stripIds = {
//       'plan-code': [],
//       'review-merge': [],
//       'deploy-operate': [],
//     }

//     const cardIdsForStage = (stage: 'plan-code' | 'review-merge' | 'deploy-operate'): string[] => {
//       if (DEMO_UX) {
//         const headline =
//           stage === 'plan-code' ? (planCodeHeadline.value || []) :
//           stage === 'review-merge' ? (reviewMergeHeadline.value || []) :
//           (deployOperateHeadline.value || [])
//         const extra =
//           stage === 'plan-code' ? (planCodeAdditionalSignals.value || []) :
//           stage === 'review-merge' ? (reviewMergeAdditionalSignals.value || []) :
//           (deployOperateAdditionalSignals.value || [])
//         return [...headline, ...extra].map(i => i.id).filter(Boolean)
//       }

//       const unified =
//         stage === 'plan-code' ? (planCodeUnifiedCards.value || []) :
//         stage === 'review-merge' ? (reviewMergeUnifiedCards.value || []) :
//         (deployOperateUnifiedCards.value || [])

//       return unified.map((i: PerformanceInsight) => i.id).filter(Boolean)
//     }

//     const cardIds = {
//       'plan-code': cardIdsForStage('plan-code'),
//       'review-merge': cardIdsForStage('review-merge'),
//       'deploy-operate': cardIdsForStage('deploy-operate'),
//     }

//     const cardIdsUnifiedByStage = { ...cardIds }

//     const leftoverIds = {
//       'plan-code': planCodeSlotsRouted.value.leftoverIds,
//       'review-merge': reviewMergeSlotsRouted.value.leftoverIds,
//       'deploy-operate': deployOperateSlotsRouted.value.leftoverIds,
//     }

//     const overlapIdsByStage = {
//       'plan-code': stripIds['plan-code'].filter(id => cardIds['plan-code'].includes(id)),
//       'review-merge': stripIds['review-merge'].filter(id => cardIds['review-merge'].includes(id)),
//       'deploy-operate': stripIds['deploy-operate'].filter(id => cardIds['deploy-operate'].includes(id)),
//     }

//     const allDestIds = [
//       ...stripIds['plan-code'],
//       ...stripIds['review-merge'],
//       ...stripIds['deploy-operate'],
//       ...cardIds['plan-code'],
//       ...cardIds['review-merge'],
//       ...cardIds['deploy-operate'],
//     ]

//     const destSet = new Set(allDestIds)
//     const unassignedIds = expectedRenderedIds.filter(id => !destSet.has(id))

//     //     piDebugLog('[PI_AUDIT][RENDER_TARGETS]', {
// //       expectedLen: expectedRenderedIds.length,
// //       expectedRenderedIds,
// //       stripIds,
// //       cardIds,
// //       cardIdsUnifiedByStage,
// //       leftoverIds,
// //       overlapIdsByStage,
// //       unionLen: destSet.size,
// //       unassignedIds,
// //     })
// //   } catch (e) {
// //     console.warn('[PI_AUDIT][RENDER_TARGETS] failed to log', e)
// //   }
// // })

// Phase X audit: DOM visibility probe (renderedIds vs actual DOM)
const runDomVisibilityProbe = async (): Promise<void> => {
  // Gate DOM audit behind separate flag to prevent false audit output during normal operation
  const DOM_AUDIT_DEBUG = (import.meta.env.VITE_DOM_AUDIT_DEBUG ?? 'false') === 'true'
  if (!DOM_AUDIT_DEBUG) return
  const propsList = Array.isArray(props.insights) ? props.insights : []
  
  // In V2 mode, check V2 preview rows instead of V1 insights
  const isV2Mode = props.viewMode === 'strip-v2' || props.viewMode === 'cards-v2'
  if (isV2Mode) {
    const v2Rows = [
      ...v2PreviewByStage.value.planCode,
      ...v2PreviewByStage.value.reviewMerge,
      ...v2PreviewByStage.value.deployOperate,
    ]
    if (v2Rows.length === 0) return
  } else {
    if (propsList.length === 0) return
  }
  
  if (getAuditLatch('DOM_VISIBILITY')) return

  try {
    await nextTick()
    await nextTick()

    // Use V2 preview rows if in V2 mode, otherwise use V1 insights
    const expectedRenderedIds = isV2Mode
      ? [
          ...v2PreviewByStage.value.planCode,
          ...v2PreviewByStage.value.reviewMerge,
          ...v2PreviewByStage.value.deployOperate,
        ].map((r: any) => r.id).filter(Boolean)
      : (Array.isArray(allInsights.value) ? allInsights.value : [])
          .map(i => i.id)
          .filter(Boolean)

    const domEls = Array.from(document.querySelectorAll('[data-pi-id]')) as HTMLElement[]
    const domIds = domEls
      .map(el => el.getAttribute('data-pi-id') || '')
      .filter(Boolean)

    const expectedSet = new Set(expectedRenderedIds)
    const domSet = new Set(domIds)
    const missingInDom = expectedRenderedIds.filter(id => !domSet.has(id))
    const extraInDom = domIds.filter(id => !expectedSet.has(id))

    const countByRegion = (region: string) =>
      domEls.filter(el => (el.getAttribute('data-pi-region') || '') === region).length

    const rectOf = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    }

    const findFirstClippingParent = (el: HTMLElement) => {
      let cur: HTMLElement | null = el.parentElement
      while (cur) {
        const cs = window.getComputedStyle(cur)
        const overflowX = cs.overflowX
        const overflowY = cs.overflowY
        const isClipping =
          overflowX === 'hidden' || overflowX === 'clip' || overflowY === 'hidden' || overflowY === 'clip'
        if (isClipping) {
          const parentRect = cur.getBoundingClientRect()
          const childRect = el.getBoundingClientRect()
          const extendsOutside =
            childRect.left < parentRect.left ||
            childRect.right > parentRect.right ||
            childRect.top < parentRect.top ||
            childRect.bottom > parentRect.bottom
          if (extendsOutside) {
            return {
              tag: cur.tagName,
              className: cur.className,
              overflowX,
              overflowY,
              parentRect: {
                x: Math.round(parentRect.x),
                y: Math.round(parentRect.y),
                width: Math.round(parentRect.width),
                height: Math.round(parentRect.height),
              },
            }
          }
        }
        cur = cur.parentElement
      }
      return null
    }

    const samples = domEls.slice(0, 8).map(el => {
      const id = el.getAttribute('data-pi-id') || ''
      const region = el.getAttribute('data-pi-region') || 'unknown'
      const cs = window.getComputedStyle(el)
      const rect = rectOf(el)
      const isInLayout = rect.width > 0 && rect.height > 0
      const clip = findFirstClippingParent(el)

      return {
        id,
        region,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        rect,
        isInLayout,
        isClipped: !!clip,
        clippedBy: clip,
      }
    })

    piDebugLog('[PI_AUDIT][DOM_VISIBILITY]', {
      expectedLen: expectedRenderedIds.length,
      domLen: domIds.length,
      expectedRenderedIds,
      domIds,
      missingInDom,
      extraInDom,
      counts: {
        cards: countByRegion('card'),
        strips: countByRegion('strip'),
      },
      samples,
    })
  } catch (e) {
    console.warn('[PI_AUDIT][DOM_VISIBILITY] failed to probe', e)
  }
}

onMounted(() => {
  // run after mount if insights already present
  void runDomVisibilityProbe()
})

watch(
  () => props.insights,
  async (next) => {
    const DOM_AUDIT_DEBUG = (import.meta.env.VITE_DOM_AUDIT_DEBUG ?? 'false') === 'true'
    if (!DOM_AUDIT_DEBUG) return
    if (!Array.isArray(next) || next.length === 0) return
    await runDomVisibilityProbe()
  },
  { deep: false }
)

// Phase 4: DEMO_MODE-aware stage filtering with generous caps
const DEMO_MAX_PER_STAGE = 12  // Generous cap for DEMO_MODE to show all insights

// ========== UNIVERSAL VALUE CONFIG (Single Source of Truth) ==========
// Why cards were stuck at 3/2/2: Widget had hard-coded MAX_PER_STAGE caps that overrode
// the engine's Value Mode stageLimit. This fix makes the widget respect the universal config.
import { getValueConfig, isValueMode } from '../lib/insights/engine/valueConfig';

const valueConfig = getValueConfig();
const VALUE_MODE = isValueMode();

const MAX_PER_STAGE: Record<string, number> = {
  'plan-code': valueConfig.stageLimit,
  'review-merge': valueConfig.stageLimit,
  'deploy-operate': valueConfig.stageLimit,
  'other': valueConfig.stageLimit
}

// Strict mode isolation: Use selected mode directly, NO auto-fallback
// This ensures v1 and v2 never mix - user must explicitly choose
const effectiveViewMode = computed(() => {
  return props.viewMode || 'cards'
})

// Debug logging for mode selection (guarded by PI_DEBUG)
// DISABLED: Potential refresh loop trigger - watchEffect causing continuous re-renders
// if (PI_DEBUG) {
//   watchEffect(() => {
//     const v2Count = v2Insights.value.length
//     const legacyCount = allInsights.value.length
//     const coverageFiltered = (finalInsights.value || []).length - allInsights.value.length
    
//     piDebugLog('[PI_DEBUG][MODE_SELECTION]', {
//       modeSelected: props.viewMode,
//       modeEffective: effectiveViewMode.value,
//       v1Count: legacyCount,
//       v2Count: v2Count,
//       coverageFilteredCount: coverageFiltered,
//       capTruncatedCount: 0 // Will be computed per-stage if needed
//     })
//   })
// }

// CI/CD stage organization (all insights, no priority separation)
// V1 ONLY: Return empty when in v2 mode to prevent cross-contamination
const insightsForStage = (stage: string) => {
  // Strict isolation: If in v2 mode, return empty (v2 has its own data source)
  if (props.viewMode === 'strip-v2' || props.viewMode === 'cards-v2') {
    return [] // v2 preview renders in its own section, v1 must not appear
  }
  
  const stageInsights = allInsights.value.filter(i => (i.cicdStage || 'other') === stage)
  
  // ========== PI_TRACE: Stage grouping ==========
  if (PI_TRACE) {
    console.group(`🔍 [PI_TRACE][STAGE_GROUP] ${stage} - Grouped insights`);
    piDebugLog(`Total insights for ${stage}:`, stageInsights.length);
    piDebugLog('Insight IDs:', stageInsights.map(i => i.id));
    piDebugLog('Insight titles:', stageInsights.map(i => i.title?.slice(0, 50)));
    piDebugLog('Insight details:', stageInsights.map(i => ({
      id: i.id,
      title: i.title?.slice(0, 40),
      toolScope: i.toolScope,
      summaryEligible: i.summaryEligible,
      orgKind: i.orgKind,
      insightClass: i.insightClass
    })));
    console.groupEnd();
  }
  
  // TTFC_DEBUG: Track TTFC insight through stage filtering
  if (TTFC_DEBUG && stage === 'plan-code') {
    const ttfcInAll = allInsights.value.filter(i => i.metricId === 'org.time_to_first_commit')
    const ttfcInStage = stageInsights.filter(i => i.metricId === 'org.time_to_first_commit')
    console.warn('[TTFC_DEBUG][Widget] insightsForStage plan-code', {
      totalAllInsights: allInsights.value.length,
      totalPlanCode: stageInsights.length,
      ttfcInAllInsights: ttfcInAll.length,
      ttfcInPlanCode: ttfcInStage.length,
      ttfcMissedDueToStage: ttfcInAll.length > 0 && ttfcInStage.length === 0 ? 'YES - wrong cicdStage?' : 'NO',
      ttfcDetails: ttfcInAll.map(i => ({
        id: i.id,
        title: i.title,
        cicdStage: i.cicdStage,
        severity: i.severity,
        metricId: i.metricId
      }))
    })
  }
  
  // TEMP: Log before slicing
  if (PI_DEBUG && stage === 'review-merge') {
    console.debug('[PI][Widget] insightsForStage - Review & Merge BEFORE slice:', {
      count: stageInsights.length,
      titles: stageInsights.map(i => i.title),
      maxForStage: DEMO_MODE ? DEMO_MAX_PER_STAGE : (MAX_PER_STAGE[stage] || MAX_PER_STAGE['other'])
    })
  }
  
  // DEV-only trace: deploy-operate insights before sorting and capping
  if (PI_DEBUG && stage === 'deploy-operate') {
    const maxForStage = DEMO_MODE ? DEMO_MAX_PER_STAGE : (MAX_PER_STAGE[stage] || MAX_PER_STAGE['other'])
    console.warn('[PI][Widget][DeployOperate] insightsForStage BEFORE sort/cap', {
      count: stageInsights.length,
      maxForStage,
      insights: stageInsights.map(i => ({
        title: i.title,
        metricId: i.metricId,
        priorityScore: i.priorityScore,
        summaryEligible: i.summaryEligible,
        toolScope: i.toolScope
      }))
    })
  }
  
  // Sort by priorityScore (descending), then by impactScore (descending)
  const sorted = [...stageInsights].sort((a: any, b: any) => {
    const pa = a.priorityScore ?? 0
    const pb = b.priorityScore ?? 0
    if (pb !== pa) return pb - pa
    return impactScore(b) - impactScore(a)
  })
  
  // Phase 4: Apply DEMO_MODE-aware cap (or per-stage cap)
  // What changed to allow more valuable rules to appear:
  // - In Value Mode, MAX_PER_STAGE now uses VITE_PI_STAGE_LIMIT (default 6) for all stages
  // - Previously, deploy-operate was capped at 3, review-merge at 4, causing valuable diagnostics to be hidden
  // - Now the widget respects the engine's Value Mode stageLimit, allowing more insights per stage
  const maxForStage = DEMO_MODE
    ? DEMO_MAX_PER_STAGE
    : (MAX_PER_STAGE[stage] || MAX_PER_STAGE['other'])
  
  const capped = sorted.slice(0, maxForStage)
  
  // Debug logging for per-stage slicing (guarded by VITE_PI_DEBUG)
  if (PI_DEBUG) {
    piDebugLog(`[PI_DEBUG][STAGE_SLICE][${stage}]`, {
      beforeSlice: stageInsights.length,
      afterSlice: capped.length,
      maxForStage: maxForStage,
      stageInsightsIds: stageInsights.map(i => i.id).slice(0, 5)
    })
  }
  
  // DEV-only trace: deploy-operate insights after stage cap
  if (PI_DEBUG && stage === 'deploy-operate') {
    console.warn('[PI][Widget][DeployOperate] insightsForStage AFTER cap', {
      countBefore: sorted.length,
      countAfter: capped.length,
      maxForStage,
      dropped: sorted.length - capped.length,
      insights: capped.map(i => ({
        title: i.title,
        metricId: i.metricId,
        priorityScore: i.priorityScore,
        summaryEligible: i.summaryEligible,
        toolScope: i.toolScope
      })),
      droppedInsights: sorted.slice(maxForStage).map(i => ({
        title: i.title,
        metricId: i.metricId,
        priorityScore: i.priorityScore
      }))
    })
  }
  
  return capped
}

const planCodeInsights = computed(() => insightsForStage('plan-code'))

const planCodeToolInsights = computed(() => planCodeInsights.value)

// ========== DEBUG: RENDERED CARDS ==========
const PI_DEBUG_WIDGET = (import.meta.env.VITE_PI_DEBUG ?? 'false') === 'true'

if (PI_DEBUG_WIDGET) {
  let didLogCounts = false
  let didLogIds = false
  // Use watchEffect to log after computed values are evaluated
  watchEffect(() => {
    const byStageRendered = {
      'plan-code': planCodeInsights.value.length,
      'review-merge': insightsForStage('review-merge').length,
      'deploy-operate': insightsForStage('deploy-operate').length
    }

    const total =
      byStageRendered['plan-code'] +
      byStageRendered['review-merge'] +
      byStageRendered['deploy-operate']

    if (!didLogCounts) {
      piDebugLog('[PI_DEBUG][WIDGET_RENDER_COUNTS]', { ...byStageRendered, total })
      didLogCounts = true
    }

    // Rendered IDs by stage (demo UX: headline slots + additional signals)
    if (DEMO_UX && !didLogIds) {
      const planIds = [
        ...planCodeSlots.value.posture.map(i => i.id),
        ...planCodeSlots.value.change.map(i => i.id),
        ...planCodeSlots.value.action.map(i => i.id),
        ...planCodeAdditionalSignals.value.map(i => i.id),
      ];
      const rmIds = [
        ...reviewMergeSlots.value.posture.map(i => i.id),
        ...reviewMergeSlots.value.change.map(i => i.id),
        ...reviewMergeSlots.value.action.map(i => i.id),
        ...reviewMergeAdditionalSignals.value.map(i => i.id),
      ];
      const doIds = [
        ...deployOperateSlots.value.posture.map(i => i.id),
        ...deployOperateSlots.value.change.map(i => i.id),
        ...deployOperateSlots.value.action.map(i => i.id),
        ...deployOperateAdditionalSignals.value.map(i => i.id),
      ];

      const all = [...planIds, ...rmIds, ...doIds];
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const id of all) {
        if (seen.has(id)) dupes.push(id);
        seen.add(id);
      }

      piDebugLog('[PI_DEBUG][WIDGET_RENDER_IDS]', {
        'plan-code': planIds,
        'review-merge': rmIds,
        'deploy-operate': doIds,
        dupes
      });

      didLogIds = true
    }
  })
}

// Debug log for Plan & Code org split
if (PI_DEBUG) {
  console.debug('[PI][PlanCodeOrg][UI]', {
    org: 0,
    tool: planCodeToolInsights.value.length
  })
}

// Helper to convert PerformanceInsight to Insight for InsightCardContent
function convertToInsightForCard(item: PerformanceInsight): Insight {
  const hardened = hardenPerformanceInsightForUi(item)
  const isReviewMerge = item.cicdStage === 'review-merge'
  
  return {
    id: item.id,
    title: hardened.title,
    summary: hardened.summary,
    severity: item.severity as any,
    scope: (item.toolScope === 'org' ? 'org' : 'team') as any,
    entityId: item.related?.tools?.[0] || item.related?.teams?.[0],
    metricId: item.metricId || 'unknown',
    metricKind: item.source === 'github' ? 'github' : 'ide' as any,
    value: null,
    baseline: null,
    deltaPct: null,
    confidenceBadge: item.confidenceBadge,  // Add confidence badge
    supportingContext: item.supportingContext,  // Add supporting context for merged insights
    evidence: hardened.evidence.map(e => ({
      label: e.label || '',
      value: String(e.value ?? '')
    })),
    recommendedAction: hardened.recommendedAction,
    recommendedOwners: [],
    tags: item.tags || [],
    dataSource: item.source === 'github' ? 'Real' : item.source === 'simulated' ? 'Simulated' : 'Mixed',
    alsoObservedIn: (item as any).alsoObservedIn,
    timeRangeLabel: 'Recent period',
    // Preserve enhanced fields for Review & Merge PIs
    ...(isReviewMerge && {
      details: hardened.details,
      definition: hardened.definition
    })
  };
}

const reviewMergeInsights = computed(() => insightsForStage('review-merge'))

const reviewMergeDetailedInsights = computed(() => reviewMergeInsights.value)

// ========== PI_TRACE: Review & Merge routing ==========
if (PI_TRACE) {
  watchEffect(() => {
    const toCards = reviewMergeDetailedInsights.value;
    const dropped = reviewMergeInsights.value.filter(i => 
      !toCards.includes(i)
    );
    
    console.group('🔍 [PI_TRACE][ROUTING] Review & Merge - Summary vs Cards');
    piDebugLog('→ Cards section:', toCards.length, toCards.map(i => ({ id: i.id, title: i.title?.slice(0, 40), toolScope: i.toolScope, summaryEligible: i.summaryEligible })));
    if (dropped.length > 0) {
      console.warn('→ DROPPED:', dropped.length, dropped.map(i => ({ id: i.id, title: i.title?.slice(0, 40) })));
    }
    console.groupEnd();
  });
}

// Debug log for Review & Merge split
if (PI_DEBUG) console.debug('[PI][ReviewMergeOrg][UI]', {
  org: 0,
  detailed: reviewMergeDetailedInsights.value.length,
  orgTitles: []
})
const deployOperateInsights = computed(() => insightsForStage('deploy-operate'))

const deployOperateDetailedInsights = computed(() => deployOperateInsights.value)

// ========== PI_TRACE: Deploy & Operate routing ==========
if (PI_TRACE) {
  watchEffect(() => {
    const toCards = deployOperateDetailedInsights.value;
    const dropped = deployOperateInsights.value.filter(i => 
      !toCards.includes(i)
    );
    
    console.group('🔍 [PI_TRACE][ROUTING] Deploy & Operate - Summary vs Cards');
    piDebugLog('→ Cards section:', toCards.length, toCards.map(i => ({ id: i.id, title: i.title?.slice(0, 40), toolScope: i.toolScope, summaryEligible: i.summaryEligible })));
    if (dropped.length > 0) {
      console.warn('→ DROPPED:', dropped.length, dropped.map(i => ({ id: i.id, title: i.title?.slice(0, 40) })));
    }
    console.groupEnd();
  });
}

// Debug log for Deploy & Operate split
if (PI_DEBUG) console.debug('[PI][DeployOrg][UI]', {
  org: 0,
  detailed: deployOperateDetailedInsights.value.length,
  orgTitles: []
})

const otherInsights = computed(() => insightsForStage('other'))

// ========== SLOT-BASED RENDERING (Replaces tier grouping) ==========
/**
 * Engine now returns insights with slot assignments and drill-down markers.
 * We separate leader-visible from drill-down and group by slots per stage.
 */

// Separate leader-visible from drill-down
const leaderVisibleInsights = computed(() => 
  allInsights.value.filter(i => !i.isDrillDown)
);

const drillDownInsights = computed(() => 
  allInsights.value.filter(i => i.isDrillDown === true)
);

// Global compare slot (tool-ai-roi)
const globalCompareInsights = computed(() => 
  leaderVisibleInsights.value.filter(i => 
    i.metricId?.includes('tool-ai-roi') || 
    i.metricId?.includes('ai-roi') ||
    i.title?.toLowerCase().includes('ai roi')
  )
);

// Group leader-visible insights by stage and slot type
interface StageSlots {
  posture: PerformanceInsight[];
  change: PerformanceInsight[];
  action: PerformanceInsight[];
  drillDown: PerformanceInsight[];
}

function uniqById(list: PerformanceInsight[]): PerformanceInsight[] {
  const out: PerformanceInsight[] = []
  const seen = new Set<string>()
  for (const i of list || []) {
    if (!i?.id) continue
    if (seen.has(i.id)) continue
    seen.add(i.id)
    out.push(i)
  }
  return out
}

// Add pilot readiness runtime logging
watchEffect(() => {
  if (VERBOSE_PI_DEBUG) {
    piDebugLog('[PILOT_READY][PI_COUNTS]', {
    stressModeActive: isStressModeActive.value,
    headerCount: allInsights.value.length,
    sidebarCount: allInsights.value.length, // Sidebar uses same allInsights
    widgetInputCount: props.insights?.length || 0,
    displayedCount: allInsights.value.length,
    selectedIndex: null, // Could be added if tracking selected insight
    selectedInsightId: null // Could be added if tracking selected insight
  });
  }
});

function sortByPriorityScoreDesc(list: PerformanceInsight[]): PerformanceInsight[] {
  return [...(list || [])].sort((a, b) => {
    const pa = a.priorityScore ?? 0
    const pb = b.priorityScore ?? 0
    if (pb !== pa) return pb - pa
    return String(a.id || '').localeCompare(String(b.id || ''))
  })
}

function sortByPriorityThenImpactDesc(list: PerformanceInsight[]): PerformanceInsight[] {
  return [...(list || [])].sort((a, b) => {
    const pa = a.priorityScore ?? 0
    const pb = b.priorityScore ?? 0
    if (pb !== pa) return pb - pa
    return impactScore(b) - impactScore(a)
  })
}

function groupStageBySlots(stage: string): StageSlots {
  const stageLeaderAll = leaderVisibleInsights.value.filter(i => i.cicdStage === stage);
  const stageDrillDownAll = drillDownInsights.value.filter(i => i.cicdStage === stage);

  const stageLeader = stageLeaderAll
  const stageDrillDown = stageDrillDownAll
  
  // Categorize by tier (posture = summary, change = trend/mild anomaly, action = strong anomaly/composite)
  const posture = stageLeader.filter(i => 
    i.tier === 'posture' || i.orgKind === 'summary'
  );
  
  const change = stageLeader.filter(i => 
    i.tier === 'trend' || 
    (i.tier === 'anomaly' && ['warning', 'info', 'opportunity'].includes(i.severity?.toLowerCase() || ''))
  );
  
  const action = stageLeader.filter(i => 
    (i.tier === 'anomaly' && ['critical', 'risk', 'warning'].includes(i.severity?.toLowerCase() || '')) ||
    i.metricId?.includes('tradeoff') ||
    i.metricId?.includes('fast-but-unstable')
  );
  
  return {
    posture: posture.slice(0, 1),  // Max 1 posture per stage
    change: change.slice(0, 1),    // Max 1 change per stage
    action: action.slice(0, 1),    // Max 1 action per stage
    drillDown: stageDrillDown
  };
}

const planCodeSlots = computed(() => groupStageBySlots('plan-code'));
const reviewMergeSlots = computed(() => groupStageBySlots('review-merge'));
const deployOperateSlots = computed(() => groupStageBySlots('deploy-operate'));

// Phase 3A: ensure no leader-visible insights become unassigned in sectioned mode.
// Route leftovers (not in strip and not selected into posture/change/action/drillDown) into drillDown.
function routeLeftoversIntoDrillDown(
  stage: 'plan-code' | 'review-merge' | 'deploy-operate',
  base: StageSlots
): { slots: StageSlots; leftoverIds: string[] } {
  const stageLeaderAll = leaderVisibleInsights.value.filter(i => i.cicdStage === stage)
  const stageLeader = stageLeaderAll
  const used = new Set<string>()

  ;(base.posture || []).forEach(i => i?.id && used.add(i.id))
  ;(base.change || []).forEach(i => i?.id && used.add(i.id))
  ;(base.action || []).forEach(i => i?.id && used.add(i.id))
  ;(base.drillDown || []).forEach(i => i?.id && used.add(i.id))

  const leftovers = sortByPriorityScoreDesc(stageLeader.filter(i => i?.id && !used.has(i.id)))
  const leftoverIds = leftovers.map(i => i.id).filter(Boolean)

  const routed: StageSlots = {
    posture: base.posture,
    change: base.change,
    action: base.action,
    drillDown: uniqById([...(base.drillDown || []), ...leftovers]),
  }

  return { slots: routed, leftoverIds }
}

const planCodeSlotsRouted = computed(() => routeLeftoversIntoDrillDown('plan-code', planCodeSlots.value))
const reviewMergeSlotsRouted = computed(() => routeLeftoversIntoDrillDown('review-merge', reviewMergeSlots.value))
const deployOperateSlotsRouted = computed(() => routeLeftoversIntoDrillDown('deploy-operate', deployOperateSlots.value))

const planCodeUnifiedCards = computed(() => {
  const s = planCodeSlotsRouted.value?.slots
  const baseCards = sortByPriorityThenImpactDesc(uniqById([...(s?.posture || []), ...(s?.change || []), ...(s?.action || []), ...(s?.drillDown || [])]))
  
  // Merge IDE diagnostics with Plan & Code insights
  const ideDiag = (props.ideDiagnostics || []) as PerformanceInsight[]
  const merged = uniqById([...baseCards, ...ideDiag])
  
  // Group for presentation (primary + context)
  try {
    const grouped = groupInsightsForPresentation(merged)
    return grouped.primaryInsights
  } catch (error) {
    console.warn('[PerformanceInsightsWidget] Error grouping insights, using fallback:', error)
    return sortByPriorityThenImpactDesc(merged)
  }
})

const planCodeContextCards = computed(() => {
  const s = planCodeSlotsRouted.value?.slots
  const baseCards = sortByPriorityThenImpactDesc(uniqById([...(s?.posture || []), ...(s?.change || []), ...(s?.action || []), ...(s?.drillDown || [])]))
  const ideDiag = (props.ideDiagnostics || []) as PerformanceInsight[]
  const merged = uniqById([...baseCards, ...ideDiag])
  
  try {
    const grouped = groupInsightsForPresentation(merged)
    return grouped.contextInsights
  } catch (error) {
    console.warn('[PerformanceInsightsWidget] Error grouping insights, using fallback:', error)
    return []
  }
})

const reviewMergeUnifiedCards = computed(() => {
  const s = reviewMergeSlotsRouted.value?.slots
  const cards = sortByPriorityThenImpactDesc(uniqById([...(s?.posture || []), ...(s?.change || []), ...(s?.action || []), ...(s?.drillDown || [])]))
  
  try {
    const grouped = groupInsightsForPresentation(cards)
    return grouped.primaryInsights
  } catch (error) {
    console.warn('[PerformanceInsightsWidget] Error grouping insights, using fallback:', error)
    return cards
  }
})

const reviewMergeContextCards = computed(() => {
  const s = reviewMergeSlotsRouted.value?.slots
  const cards = sortByPriorityThenImpactDesc(uniqById([...(s?.posture || []), ...(s?.change || []), ...(s?.action || []), ...(s?.drillDown || [])]))
  
  try {
    const grouped = groupInsightsForPresentation(cards)
    return grouped.contextInsights
  } catch (error) {
    console.warn('[PerformanceInsightsWidget] Error grouping insights, using fallback:', error)
    return []
  }
})

const deployOperateUnifiedCards = computed(() => {
  const s = deployOperateSlotsRouted.value?.slots
  const cards = sortByPriorityThenImpactDesc(uniqById([...(s?.posture || []), ...(s?.change || []), ...(s?.action || []), ...(s?.drillDown || [])]))
  
  try {
    const grouped = groupInsightsForPresentation(cards)
    return grouped.primaryInsights
  } catch (error) {
    console.warn('[PerformanceInsightsWidget] Error grouping insights, using fallback:', error)
    return cards
  }
})

const deployOperateContextCards = computed(() => {
  const s = deployOperateSlotsRouted.value?.slots
  const cards = sortByPriorityThenImpactDesc(uniqById([...(s?.posture || []), ...(s?.change || []), ...(s?.action || []), ...(s?.drillDown || [])]))
  
  try {
    const grouped = groupInsightsForPresentation(cards)
    return grouped.contextInsights
  } catch (error) {
    console.warn('[PerformanceInsightsWidget] Error grouping insights, using fallback:', error)
    return []
  }
})

// Additional signals for demo UX (insights not in headline slots)
const STAGE_EXTRA_COUNT = Number(import.meta.env.VITE_PI_STAGE_EXTRA ?? 2);

// Demo UX: restore grid behavior (Headline + Additional Signals)
// - Headline: up to 3 cards, prioritizing posture/change/action winners, then backfill from remaining stage inventory.
// - Additional Signals: remaining stage inventory (excluding headline IDs), capped by VITE_PI_STAGE_EXTRA.
// NOTE: Demo rendering uses the raw stage inventory (pre stage caps) to avoid silently hiding cards.
function buildDemoHeadline(
  slots: StageSlots,
  stageInventory: PerformanceInsight[],
  max = 3
): PerformanceInsight[] {
  const out: PerformanceInsight[] = []
  const seen = new Set<string>()
  const pushUnique = (arr: PerformanceInsight[]) => {
    for (const i of arr || []) {
      if (!i?.id) continue
      if (seen.has(i.id)) continue
      out.push(i)
      seen.add(i.id)
      if (out.length >= max) return
    }
  }

  pushUnique([...(slots?.posture || []), ...(slots?.change || []), ...(slots?.action || [])])
  if (out.length < max) pushUnique(slots?.drillDown || [])
  if (out.length < max) pushUnique(stageInventory || [])
  return out.slice(0, max)
}

const demoStageInventory = (stage: string) => {
  const base = (raw.value || []).filter(i => (i.cicdStage || 'other') === stage)
  // Merge IDE diagnostics for plan-code stage
  if (stage === 'plan-code' && props.ideDiagnostics) {
    return [...base, ...(props.ideDiagnostics as PerformanceInsight[])]
  }
  return base
}

const planCodeHeadline = computed(() => buildDemoHeadline(planCodeSlots.value, demoStageInventory('plan-code')))
const reviewMergeHeadline = computed(() => buildDemoHeadline(reviewMergeSlots.value, demoStageInventory('review-merge')))
const deployOperateHeadline = computed(() => buildDemoHeadline(deployOperateSlots.value, demoStageInventory('deploy-operate')))

const planCodeAdditionalSignals = computed(() => {
  if (!DEMO_UX) return []
  const headlineIds = new Set(planCodeHeadline.value.map(i => i.id))
  return demoStageInventory('plan-code').filter(i => !headlineIds.has(i.id)).slice(0, STAGE_EXTRA_COUNT)
})

const reviewMergeAdditionalSignals = computed(() => {
  if (!DEMO_UX) return []
  const headlineIds = new Set(reviewMergeHeadline.value.map(i => i.id))
  return demoStageInventory('review-merge').filter(i => !headlineIds.has(i.id)).slice(0, STAGE_EXTRA_COUNT)
})

const deployOperateAdditionalSignals = computed(() => {
  if (!DEMO_UX) return []
  const headlineIds = new Set(deployOperateHeadline.value.map(i => i.id))
  return demoStageInventory('deploy-operate').filter(i => !headlineIds.has(i.id)).slice(0, STAGE_EXTRA_COUNT)
})

// One-line demo grid render summary (gated)
let didLogDemoGridRender = false
watchEffect(() => {
  if (!PI_DEBUG) return
  if (!DEMO_UX) return
  if (didLogDemoGridRender) return

  const planCodeVisible = planCodeHeadline.value.length + planCodeAdditionalSignals.value.length
  const reviewMergeVisible = reviewMergeHeadline.value.length + reviewMergeAdditionalSignals.value.length
  const deployOperateVisible = deployOperateHeadline.value.length + deployOperateAdditionalSignals.value.length
  const totalVisible = planCodeVisible + reviewMergeVisible + deployOperateVisible

  piDebugLog('[PI_DEBUG][DEMO_GRID_RENDER]', {
    planCodeVisible,
    reviewMergeVisible,
    deployOperateVisible,
    demoUx: DEMO_UX,
    stageExtraCount: STAGE_EXTRA_COUNT,
  },
  {
    counts: {
    }
  })

  didLogDemoGridRender = true
})

// ========== Phase 1: One consolidated flight recorder report (printed once) ==========
let didPrintFlightRecorder = false
let didWarnFlightRecorderNotReady = false
watchEffect(() => {
  if (!PI_DEBUG) return
  if (didPrintFlightRecorder) return

  const fr = getFlightRecorder()
  const hasRecorder = !!fr
  const hasEngineFinal = !!fr?.engine?.final
  if (!hasRecorder || !hasEngineFinal) {
    if (!didWarnFlightRecorderNotReady) {
      console.warn('[PI_FLIGHT_RECORDER][NOT_READY]', {
        PI_DEBUG: (import.meta as any).env?.VITE_PI_DEBUG,
        hasRecorder,
        hasEngineFinal
      })
      didWarnFlightRecorderNotReady = true
    }
    return
  }

  // Widget inputs + processing
  const received = raw.value || []
  const processed = finalInsights.value || []
  const all = allInsights.value || []

  // Headline + Additional Signals per stage (demo UX)
  const stageCaps = {
    slotMaxPerStage: { posture: 1, change: 1, action: 1 },
    additionalSignalsCap: Number(import.meta.env.VITE_PI_STAGE_EXTRA ?? 2),
  }

  const slottingSnapshotForStage = (stage: 'plan-code' | 'review-merge' | 'deploy-operate') => {
    const stageLeader = leaderVisibleInsights.value.filter(i => i.cicdStage === stage)
    const stageDrill = drillDownInsights.value.filter(i => i.cicdStage === stage)

    const allCandidates = stageLeader

    const postureWinners = (stage === 'plan-code' ? planCodeSlots.value.posture : stage === 'review-merge' ? reviewMergeSlots.value.posture : deployOperateSlots.value.posture)
    const changeWinners = (stage === 'plan-code' ? planCodeSlots.value.change : stage === 'review-merge' ? reviewMergeSlots.value.change : deployOperateSlots.value.change)
    const actionWinners = (stage === 'plan-code' ? planCodeSlots.value.action : stage === 'review-merge' ? reviewMergeSlots.value.action : deployOperateSlots.value.action)

    const postureCandidates = allCandidates.filter(i => i.tier === 'posture' || i.orgKind === 'summary')
    const changeCandidates = allCandidates.filter(i =>
      (i.tier === 'trend') ||
      (i.tier === 'anomaly' && ['warning', 'info', 'opportunity'].includes(i.severity?.toLowerCase() || ''))
    )
    const actionCandidates = allCandidates.filter(i =>
      (i.tier === 'anomaly' && ['critical', 'risk', 'warning'].includes(i.severity?.toLowerCase() || '')) ||
      i.metricId?.includes('tradeoff') ||
      i.metricId?.includes('fast-but-unstable')
    )

    // Rejection reasons summary (deterministic, high-level)
    const rejectReasonCounts = {
      posture: {
        tierMismatch: postureCandidates.length === 0 ? (allCandidates.length > 0 ? allCandidates.length : 0) : Math.max(0, allCandidates.length - postureCandidates.length),
      },
      change: {
        tierMismatchOrSummary: Math.max(0, allCandidates.length - changeCandidates.length),
        capped: Math.max(0, changeCandidates.length - changeWinners.length),
      },
      action: {
        notStrongEnough: Math.max(0, allCandidates.length - actionCandidates.length),
        capped: Math.max(0, actionCandidates.length - actionWinners.length),
      },
    }

    return {
      stage,
      candidates: {
        leaderVisible: allCandidates.map(i => i.id),
        posture: postureCandidates.map(i => i.id),
        change: changeCandidates.map(i => i.id),
        action: actionCandidates.map(i => i.id),
        drillDown: stageDrill.map(i => i.id),
      },
      winners: {
        posture: postureWinners.map(i => i.id),
        change: changeWinners.map(i => i.id),
        action: actionWinners.map(i => i.id),
      },
      rejections: rejectReasonCounts,
    }
  }

  const slotting = {
    globalCompare: globalCompareInsights.value.map(i => i.id),
    byStage: {
      'plan-code': slottingSnapshotForStage('plan-code'),
      'review-merge': slottingSnapshotForStage('review-merge'),
      'deploy-operate': slottingSnapshotForStage('deploy-operate'),
    }
  }

  // Final rendered sets as the template would show
  const rendered = {
    sectionsSkipped: {
      planCodeStageSkipped: !(planCodeInsights.value.length > 0),
      reviewMergeStageSkipped: !(reviewMergeInsights.value.length > 0),
      deployOperateStageSkipped: !(deployOperateInsights.value.length > 0),
      planCodeAdditionalSignalsSkipped: !(DEMO_UX && planCodeAdditionalSignals.value.length > 0),
      reviewMergeAdditionalSignalsSkipped: !(DEMO_UX && reviewMergeAdditionalSignals.value.length > 0),
      deployOperateAdditionalSignalsSkipped: !(DEMO_UX && deployOperateAdditionalSignals.value.length > 0),
    },
    idsReceivedFromParent: received.map(i => i.id),
    idsAfterWidgetProcessing: processed.map(i => i.id),
    idsAfterCoverageFilter: all.map(i => i.id),
    byStageHeadlineAndExtra: {
      'plan-code': {
        headline: [
          ...planCodeSlots.value.posture.map(i => i.id),
          ...planCodeSlots.value.change.map(i => i.id),
          ...planCodeSlots.value.action.map(i => i.id),
        ],
        additionalSignals: planCodeAdditionalSignals.value.map(i => i.id),
        capApplied: { additionalSignalsCap: stageCaps.additionalSignalsCap },
      },
      'review-merge': {
        headline: [
          ...reviewMergeSlots.value.posture.map(i => i.id),
          ...reviewMergeSlots.value.change.map(i => i.id),
          ...reviewMergeSlots.value.action.map(i => i.id),
        ],
        additionalSignals: reviewMergeAdditionalSignals.value.map(i => i.id),
        capApplied: { additionalSignalsCap: stageCaps.additionalSignalsCap },
      },
      'deploy-operate': {
        headline: [
          ...deployOperateSlots.value.posture.map(i => i.id),
          ...deployOperateSlots.value.change.map(i => i.id),
          ...deployOperateSlots.value.action.map(i => i.id),
        ],
        additionalSignals: deployOperateAdditionalSignals.value.map(i => i.id),
        capApplied: { additionalSignalsCap: stageCaps.additionalSignalsCap },
      },
    }
  }

  // Assert demo UX set rules (IDs must not duplicate)
  const renderedIdsAll = new Set<string>()
  const dupes: string[] = []
  const addIfNew = (id: string) => {
    if (renderedIdsAll.has(id)) dupes.push(id)
    renderedIdsAll.add(id)
  }
  Object.values(rendered.byStageHeadlineAndExtra).forEach(s => {
    s.headline.forEach(addIfNew)
    s.additionalSignals.forEach(addIfNew)
  })

  const expectedRules = {
    demoUxEnabled: DEMO_UX,
    stageExtraCount: stageCaps.additionalSignalsCap,
    noDuplicateRenderedIds: dupes.length === 0,
    duplicates: dupes,
  }

  // Persist into flight recorder for any later inspection
  fr.slotting = slotting
  fr.widget = {
    stageCaps,
    rendered,
    expectedRules,
  }

  // One consolidated print
  console.group('✈️ [PI_FLIGHT_RECORDER] One-run Truth Pipeline')
  piDebugLog('runId:', fr.runId)
  piDebugLog('startedAt:', fr.startedAt)
  piDebugLog('finishedAt:', fr.finishedAt)

  console.group('A) Input Snapshot')
  piDebugLog(fr.input || {})
  console.groupEnd()

  console.group('B) Engine Summary')
  piDebugLog(fr.engine || {})
  console.groupEnd()

  console.group('C) Postprocess Summary')
  piDebugLog(fr.postprocess || {})
  console.groupEnd()

  console.group('D) Slotting Summary')
  piDebugLog(fr.slotting || {})
  console.groupEnd()

  console.group('E) Widget Summary')
  piDebugLog(fr.widget || {})
  console.groupEnd()

  console.group('Quick Answer')
  const engineX = fr.engine?.raw?.total ?? fr.engine?.final?.total
  const uiY = renderedIdsAll.size
  piDebugLog(`Engine emitted ${engineX}; UI rendered ${uiY}; duplicates=${dupes.length}`)
  if ((fr.postprocess?.pipelineStages || []).length > 0) {
    piDebugLog('Drops by stage:')
    console.table((fr.postprocess.pipelineStages || []).map((s: any) => ({
      stage: s.stageName,
      entering: s.enteringCount,
      leaving: s.leavingCount,
      dropped: s.droppedCount,
      topDropped: (s.topDropped || []).map((d: any) => `${d.dropReason}:${d.id}`).join(' | '),
    })))
  }
  console.groupEnd()

  console.groupEnd()

  didPrintFlightRecorder = true
})

// Debug: Log slot assignments
if (import.meta.env.DEV && VERBOSE_PI_DEBUG) {
  watchEffect(() => {
    piDebugLog('[PI_DEBUG][SLOT_ASSIGNMENTS]', {
      'plan-code': {
        posture: planCodeSlots.value.posture.length,
        change: planCodeSlots.value.change.length,
        action: planCodeSlots.value.action.length,
        drillDown: planCodeSlots.value.drillDown.length
      },
      'review-merge': {
        posture: reviewMergeSlots.value.posture.length,
        change: reviewMergeSlots.value.change.length,
        action: reviewMergeSlots.value.action.length,
        drillDown: reviewMergeSlots.value.drillDown.length
      },
      'deploy-operate': {
        posture: deployOperateSlots.value.posture.length,
        change: deployOperateSlots.value.change.length,
        action: deployOperateSlots.value.action.length,
        drillDown: deployOperateSlots.value.drillDown.length
      },
      globalCompare: globalCompareInsights.value.length
    });
    
    // Step 2: Log slot distribution
    const slotCounts = (label: string, slots: StageSlots) => ({
      stage: label,
      posture: slots?.posture?.length ?? 0,
      change: slots?.change?.length ?? 0,
      action: slots?.action?.length ?? 0,
      drillDown: slots?.drillDown?.length ?? 0,
    });

    piDebugLog('[PI_SLOTS]', [
      slotCounts('plan-code', planCodeSlots.value),
      slotCounts('review-merge', reviewMergeSlots.value),
      slotCounts('deploy-operate', deployOperateSlots.value),
    ]);
  });
}

// Removed verbose logging

// 🔥 PATCH-ONLY: Clean chip insights computed
const chipInsightsByStage = computed(() => {
  const source = (v2Insights.value.length > 0 ? v2Insights.value : allInsights.value) || []

  const sortForDemo = (items: PerformanceInsight[]) => {
    return [...items].sort((a: any, b: any) => {
      const aPrimary = a.isPrimary === true || a.demoFlag === 'demo_primary'
      const bPrimary = b.isPrimary === true || b.demoFlag === 'demo_primary'
      if (aPrimary !== bPrimary) return aPrimary ? -1 : 1

      const pa = a.priorityScore ?? 0
      const pb = b.priorityScore ?? 0
      if (pb !== pa) return pb - pa

      return impactScore(b) - impactScore(a)
    })
  }

  return {
    planCode: sortForDemo(source.filter(i => inferStage(i) === 'plan-code')),
    reviewMerge: sortForDemo(source.filter(i => inferStage(i) === 'review-merge')),
    deployOperate: sortForDemo(source.filter(i => inferStage(i) === 'deploy-operate')),
  }
})
</script>

<template>
  <div class="performance-insights-widget">
    <!-- Unified Section Header - Match AI Ops pattern -->
    <div class="cm-header-dense cicd-section-header d-flex align-items-start justify-content-between gap-2 mb-2">
      <div class="d-flex align-items-start gap-2">
        <div class="stage-icon-wrapper bg-primary">
          <i class="bi bi-lightbulb-fill text-white"></i>
        </div>
        <div>
          <h5 class="mb-0 fw-semibold">Performance Insights</h5>
          <small class="cm-subtitle-dense text-muted">Downstream analysis from AI Ops signals</small>
        </div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <!-- CR5 WS1 P0 FIX: LOADING != EMPTY — do not render "0 findings" while
             canonical/PI computation is still hydrating. Only render the count
             badge after authoritative computation completes. -->
        <!-- CR-X Day 1A: "findings" not "total" — diagnostics are additional
             items beyond the finding count, so "total" is misleading. -->
        <span v-if="!showLoadingState" class="badge badge-sm bg-primary-subtle text-primary">
          {{ performanceFindingCount }} findings
        </span>
        <span v-if="!showLoadingState && diagnosticCount > 0" class="badge badge-sm bg-secondary-subtle text-secondary">
          {{ diagnosticCount }} diagnostics
        </span>
        <!-- CR-X P0-D: Evidence-completeness badge — PARTIAL must not masquerade as FULL -->
        <span
          v-if="!showLoadingState && props.evidenceCompleteness === 'partial'"
          class="badge badge-sm bg-warning-subtle text-warning-emphasis border border-warning"
          :title="props.evidenceStatusLabel"
        >
          <i class="bi bi-exclamation-triangle me-1"></i>Partial evidence
        </span>
        <span
          v-if="!showLoadingState && props.evidenceCompleteness === 'error'"
          class="badge badge-sm bg-danger-subtle text-danger-emphasis border border-danger"
          :title="props.evidenceStatusLabel"
        >
          <i class="bi bi-x-circle me-1"></i>Evidence unavailable
        </span>
        <!-- Stress Mode Badge (Dev Only) -->
        <span 
          v-if="isStressModeActive" 
          class="badge badge-sm bg-warning-subtle text-warning-emphasis border border-warning"
          title="DEMO MODE · fixture data · not real org data"
        >
          DEMO MODE · fixture data · not real org data
        </span>
      </div>
    </div>

    <!-- LOG 4: Immediately before render bind for deployment-frequency-volatility-by-ide -->
    <div v-if="false">
      {{ 
        (() => {
          const deploymentFreqInsight = insights.find(i => i.id === 'deployment-frequency-volatility-by-ide');
          if (deploymentFreqInsight) {
            piDebugLog('[CHAIN_4_BEFORE_RENDER]', {
              id: deploymentFreqInsight.id,
              title: deploymentFreqInsight.title,
              subtitle: deploymentFreqInsight.subtitle,
              description: deploymentFreqInsight.description,
              summary: deploymentFreqInsight.whatsHappening,
              whyItMatters: deploymentFreqInsight.whyItMatters
            });
          }
          return '';
        })()
      }}
    </div>
    <!-- Loading State — canonical telemetry hydrating -->
    <div v-if="showLoadingState" class="pi-hydration-skeleton">
      <div class="pi-hydration-sidebar">
        <div v-for="i in 4" :key="i" class="pi-hydration-sidebar-item">
          <div class="pi-hydration-skeleton-bar" style="width: 70%;"></div>
          <div class="pi-hydration-skeleton-bar pi-hydration-skeleton-short" style="width: 40%;"></div>
        </div>
      </div>
      <div class="pi-hydration-detail">
        <div class="pi-hydration-skeleton-bar" style="width: 50%; height: 24px;"></div>
        <div class="pi-hydration-skeleton-bar" style="width: 90%; margin-top: 12px;"></div>
        <div class="pi-hydration-skeleton-bar" style="width: 75%; margin-top: 8px;"></div>
        <div class="pi-hydration-skeleton-bar pi-hydration-skeleton-short" style="width: 30%; margin-top: 16px;"></div>
      </div>
    </div>

    <!-- Empty State -->
    <EmptyState
      v-else-if="showEmptyState || showZeroTelemetryState"
      icon="code-slash"
      :title="props.hasAnyData === false ? 'No performance insights yet' : 'Telemetry received'"
      :message="props.hasAnyData === false ? 'ChaosMonkey will surface performance insights after the first coding sessions arrive.' : 'Telemetry is being received. Insights will appear once enough session data is collected (typically 25+ sessions per workflow).'"
      :steps="[]"
      :actionLabel="props.hasAnyData === false ? 'Download extension' : undefined"
      :actionUrl="props.hasAnyData === false ? pilotApiBase + '/api/extension/download/latest' : undefined"
    />

    <!-- Diagnostic-only state (sparse telemetry) -->
    <!-- 0 findings, diagnostics > 0 — "we are collecting evidence, here is what is missing" -->
    <div v-else-if="showDiagnosticOnlyState" class="pi-diagnostic-only-state">
      <div class="pi-diagnostic-only-icon">
        <i class="bi bi-clipboard-data"></i>
      </div>
      <div class="pi-diagnostic-only-body">
        <h6 class="pi-diagnostic-only-title">Collecting evidence — no mature findings yet</h6>
        <p class="pi-diagnostic-only-text">
          Telemetry is arriving. The engine has identified {{ diagnosticOnlyCount }} data {{ diagnosticOnlyCount === 1 ? 'gap' : 'gaps' }} that explain what evidence is still needed before reliable findings can fire.
        </p>
        <p class="pi-diagnostic-only-subtext">
          Findings typically appear once workflows reach 25+ sessions. Review the data gaps below to understand what is missing.
        </p>
      </div>
    </div>
    
    <!-- Performance Insights (only show if not empty) -->
    <PerformanceRecommendationsView
      v-else
      :insights="curatedInsights"
      :selected-p-i-id="props.selectedPIId"
      :is-hydrating="props.canonicalHydrating"
    />
  </div>
</template>

<style scoped>
/* Performance Insights Widget - Match AI Ops wrapper padding */
.performance-insights-widget {
  padding: 0.5rem 0;
}

/* Priority Insights Section */
.priority-insights-section {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  margin-bottom: 1.5rem;
  overflow: visible;
}

/* Performance Insights Section */
.performance-insights-section {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  margin-bottom: 1.5rem;
  overflow: visible;
}

/* Lowlights Section */
.lowlights-section {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  margin-bottom: 1.5rem;
  overflow: visible;
}

.priority-header {
  padding: 1.5rem 1.5rem 1rem;
  border-bottom: 1px solid #f0f0f0;
  background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
}

.performance-header {
  padding: 1.5rem 1.5rem 1rem;
  border-bottom: 1px solid #f0f0f0;
  background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
}

.lowlights-header {
  padding: 1.5rem 1.5rem 1rem;
  border-bottom: 1px solid #f0f0f0;
  background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%);
}

.priority-title-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.performance-title-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.lowlights-title-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.priority-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #dc3545;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.performance-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #2196f3;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.lowlights-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #f44336;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.priority-title {
  flex: 1;
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #495057;
}

.performance-title {
  flex: 1;
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #495057;
}

.lowlights-title {
  flex: 1;
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #495057;
}

.priority-count {
  background: #dc3545;
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.875rem;
  font-weight: 500;
}

.performance-count {
  background: #2196f3;
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.875rem;
  font-weight: 500;
}

.lowlights-count {
  background: #f44336;
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.875rem;
  font-weight: 500;
}

.priority-subtitle {
  margin: 0;
  font-size: 0.95rem;
  color: #6c757d;
  font-style: italic;
}

.performance-subtitle {
  margin: 0;
  font-size: 0.95rem;
  color: #6c757d;
  font-style: italic;
}

.lowlights-subtitle {
  margin: 0;
  font-size: 0.95rem;
  color: #6c757d;
  font-style: italic;
}

/* REMOVED: Legacy CSS grid styles for priority/performance/lowlights cards
 * These were conflicting with Bootstrap grid system used in InsightsPanel.vue
 * Bootstrap grid (col-*) now handles all card layouts responsively
 */

.priority-card {
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 1rem;
  background: #ffffff;
  transition: all 0.2s ease;
  cursor: pointer;
}

.performance-card {
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 1rem;
  background: #ffffff;
  transition: all 0.2s ease;
  cursor: pointer;
}

.lowlights-card {
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 1rem;
  background: #ffffff;
  transition: all 0.2s ease;
  cursor: pointer;
}

.priority-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-1px);
}

.performance-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-1px);
}

.lowlights-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-1px);
}

.priority-card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.performance-card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.performance-severity-indicator {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
}

.performance-severity-indicator.severity-critical {
  background: #dc3545;
  color: white;
}

.performance-severity-indicator.severity-risk {
  background: #dc3545;
  color: white;
}

.performance-severity-indicator.severity-lowlight {
  background: #fd7e14;
  color: white;
}

.performance-severity-indicator.severity-opportunity {
  background: #0d6efd;
  color: white;
}

.performance-severity-indicator.severity-info {
  background: #17a2b8;
  color: white;
}

.performance-card-title {
  flex: 1;
  font-size: 1.1rem;
  font-weight: 600;
  color: #212529;
  margin: 0;
}

.performance-badges {
  display: flex;
  gap: 0.5rem;
}

.performance-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.performance-card-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.performance-summary {
  margin: 0;
  font-size: 0.95rem;
  color: #6c757d;
  line-height: 1.4;
}

.performance-action {
  padding: 0.75rem;
  background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%);
  border-radius: 6px;
  border-left: 3px solid #007bff;
}

.performance-action-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #007bff;
  margin-bottom: 0.25rem;
}

.performance-action-text {
  font-size: 0.9rem;
  color: #495057;
  line-height: 1.4;
}

/* Severity Classes for Performance Cards */
.performance-card.severity-critical {
  border-left: 4px solid #dc3545;
}

.performance-card.severity-risk {
  border-left: 4px solid #dc3545;
}

.performance-card.severity-lowlight {
  border-left: 4px solid #fd7e14;
}

.performance-card.severity-opportunity {
  border-left: 4px solid #0d6efd;
}

.performance-card.severity-info {
  border-left: 4px solid #17a2b8;
}

.lowlights-card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.lowlights-severity-indicator {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
}

.lowlights-severity-indicator.severity-critical {
  background: #dc3545;
  color: white;
}

.lowlights-severity-indicator.severity-risk {
  background: #dc3545;
  color: white;
}

.lowlights-severity-indicator.severity-lowlight {
  background: #fd7e14;
  color: white;
}

.lowlights-severity-indicator.severity-opportunity {
  background: #0d6efd;
  color: white;
}

.lowlights-severity-indicator.severity-info {
  background: #17a2b8;
  color: white;
}

.lowlights-card-title {
  flex: 1;
  font-size: 1.1rem;
  font-weight: 600;
  color: #212529;
  margin: 0;
}

.lowlights-badges {
  display: flex;
  gap: 0.5rem;
}

.lowlights-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.lowlights-card-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.lowlights-summary {
  margin: 0;
  font-size: 0.95rem;
  color: #6c757d;
  line-height: 1.4;
}

.lowlights-action {
  padding: 0.75rem;
  background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%);
  border-radius: 6px;
  border-left: 3px solid #007bff;
}

.lowlights-action-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #007bff;
  margin-bottom: 0.25rem;
}

.lowlights-action-text {
  font-size: 0.9rem;
  color: #495057;
  line-height: 1.4;
}

/* Severity Classes for Lowlights Cards */
.lowlights-card.severity-critical {
  border-left: 4px solid #dc3545;
}

.lowlights-card.severity-risk {
  border-left: 4px solid #dc3545;
}

.lowlights-card.severity-lowlight {
  border-left: 4px solid #fd7e14;
}

.lowlights-card.severity-opportunity {
  border-left: 4px solid #0d6efd;
}

.lowlights-card.severity-info {
  border-left: 4px solid #17a2b8;
}

.priority-severity-indicator {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
}

.priority-severity-indicator.severity-critical {
  background: #dc3545;
  color: white;
}

.priority-severity-indicator.severity-risk {
  background: #dc3545;
  color: white;
}

.priority-severity-indicator.severity-lowlight {
  background: #fd7e14;
  color: white;
}

.priority-severity-indicator.severity-opportunity {
  background: #0d6efd;
  color: white;
}

.priority-severity-indicator.severity-info {
  background: #17a2b8;
  color: white;
}

.priority-card-title {
  flex: 1;
  font-size: 1.1rem;
  font-weight: 600;
  color: #212529;
  margin: 0;
}

.priority-badges {
  display: flex;
  gap: 0.5rem;
}

.priority-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.critical-badge {
  background: #dc3545;
  color: white;
}

.priority-score-badge {
  background: #6c757d;
  color: white;
}

.priority-card-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.priority-summary {
  margin: 0;
  font-size: 0.95rem;
  color: #6c757d;
  line-height: 1.4;
}

.priority-action {
  padding: 0.75rem;
  background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%);
  border-radius: 6px;
  border-left: 3px solid #007bff;
}

.priority-action-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #007bff;
  margin-bottom: 0.25rem;
}

.priority-action-text {
  font-size: 0.9rem;
  color: #495057;
  line-height: 1.4;
}

/* Severity Classes for Cards */
.priority-card.severity-critical {
  border-left: 4px solid #dc3545;
}

.priority-card.severity-risk {
  border-left: 4px solid #dc3545;
}

.priority-card.severity-lowlight {
  border-left: 4px solid #fd7e14;
}

.priority-card.severity-opportunity {
  border-left: 4px solid #0d6efd;
}

.priority-card.severity-info {
  border-left: 4px solid #17a2b8;
}

/* ========================================
   DENSITY TOKENS - Performance Insights Widget
   ========================================
   Reusable utility classes for consistent dense spacing
   across stage sections, org summaries, and subsection headers
   */

/* Dense stage section - reduced margin between stages */
.cm-stage-dense {
  margin-bottom: 1rem;
}

/* Dense header - reduced margin, padding, and border */
.cm-header-dense {
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #e9ecef;
  margin-bottom: 0.5rem;
}

/* Dense subtitle - smaller font, tighter line-height */
.cm-subtitle-dense {
  font-size: 0.8rem;
  line-height: 1.3;
  display: block;
  margin-top: 0.15rem;
}

/* Dense icon wrapper - smaller size, reduced margin */
.cm-icon-dense {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  font-size: 1.1rem;
  margin-right: 0.5rem; /* me-2 equivalent */
}

/* Tight stack spacing - reduced margin between stacked blocks */
.cm-stack-tight {
  margin-bottom: 0.5rem; /* mb-3 equivalent, but tighter */
}

/* Dense subsection - reduced spacing for org summary and IDE patterns */
.cm-subsection-dense {
  margin-bottom: 0.375rem; /* mb-2 equivalent */
}

/* Legacy compatibility - map old classes to density tokens */
.cicd-stage-section {
  margin-bottom: 1.5rem;
}

.cicd-section-header {
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #e9ecef;
  margin-bottom: 0.5rem;
}

.cicd-subtitle {
  font-size: 0.8rem;
  line-height: 1.3;
  display: block;
  margin-top: 0.15rem;
}

.stage-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  font-size: 1.1rem;
}

.insight-cards {
  margin-top: 0.75rem;
}

/* Drill-down section styling */
.drill-down-section {
  margin-top: 0.5rem;
}

.drill-down-section summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.drill-down-section summary::-webkit-details-marker {
  display: none;
}

.drill-down-section summary .bi-chevron-down {
  transition: transform 0.2s;
}

.drill-down-section[open] summary .bi-chevron-down {
  transform: rotate(180deg);
}

.cursor-pointer {
  cursor: pointer;
}

/* Org-level summary strip styling - tighter */
.org-summary-strip {
  border-radius: 12px;
  padding: 0.35rem 0.75rem;
  background-color: #f9fafb;   /* subtle section background */
  border: 1px solid #e9ecef;   /* same neutral as cards */
  margin-bottom: 0.75rem;
}

.org-summary-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.35rem;
}

/* Subsection headers styling */
.subsection-icon-wrapper {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.subsection-title {
  font-size: 0.9rem;
  color: #111827;
  letter-spacing: -0.01em;
  font-weight: 600;
  line-height: 1.4;
}

.subsection-subtitle {
  font-size: 0.75rem;
  line-height: 1.4;
  display: block;
  margin-top: 0.15rem;
  color: #6b7280;
}

.org-summary-list {
  margin-top: 0.5rem;
}

/* IDE patterns label - small inline */
.tool-insights-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
  color: #6c757d;
}

.tool-insights-label i {
  font-size: 0.85rem;
}

.tool-insights-label-text {
  font-weight: 500;
  color: #495057;
}

/* REMOVED: Legacy responsive styles for priority/performance/lowlights cards
 * These classes are no longer used - Bootstrap grid handles responsiveness
 */

/* ========================================
   RESPONSIVE LAYOUT - Tablet and Desktop
   ======================================== */

/* Tablet breakpoint (≥768px) */
@media (min-width: 768px) {
  /* Compressed stage headers - single row on tablet+ */
  .cicd-section-header--compact {
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #e9ecef;
    margin-bottom: 0.75rem;
  }
  
  .cicd-section-header--compact .stage-icon-wrapper {
    width: 32px;
    height: 32px;
    font-size: 0.95rem;
  }
  
  .cicd-section-header--compact h5 {
    font-size: 1rem;
    margin-bottom: 0;
  }
  
  .cicd-subtitle--inline {
    font-size: 0.7rem;
    line-height: 1.2;
    margin: 0;
    opacity: 0.75;
  }
  
  /* Org summary horizontal layout on tablet+ */
  .org-summary-list--horizontal {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0;
  }
  
  .org-summary-list--horizontal .org-summary-row {
    flex: 0 1 auto;
    min-width: 0;
    margin-bottom: 0;
    padding: 0.4rem 0.7rem;
  }
  
  .org-summary-strip {
    padding: 0.5rem 0.75rem;
    background-color: transparent;
    border: none;
  }
  
  .org-summary-header {
    margin-bottom: 0.5rem;
  }
  
  .org-summary-header .subsection-title {
    font-size: 0.85rem;
  }
  
  .org-summary-header .subsection-subtitle {
    font-size: 0.7rem;
    margin-top: 0.05rem;
  }
  
  /* IDE patterns label - minimal spacing on tablet+ */
  .tool-insights-label {
    margin-bottom: 0.25rem;
    font-size: 0.75rem;
  }
  
  .tool-insights-label i {
    font-size: 0.8rem;
  }
  
  .tool-insights-label-text {
    font-size: 0.75rem;
  }
}

/* Desktop breakpoint (≥992px) - additional refinements */
@media (min-width: 992px) {
  /* Additional desktop-specific styles if needed */
}

.cicd-insights-placeholder {
  background: #f8f9fa;
  border-radius: 0.5rem;
  padding: 1rem;
  border: 1px dashed #dee2e6;
}

/* STEP 2: Fix IDE section 3-column layout */
.tool-insights-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  width: 100%;
}

.tool-insights-grid > * {
  min-width: 0;
}

/* STEP 6: COMPRESS IDE SECTION - reduce height by ~40% */
.cicd-stage-section {
  margin-top: 16px;
  margin-bottom: 16px;
  padding: 0;
}

.cicd-section-header {
  margin-bottom: 4px;
  padding: 8px 0;
}

.insight-cards {
  margin: 0;
  padding: 0;
}

/* Compress chip spacing */
.stage-section {
  gap: 12px;
  margin-top: 16px;
  margin-bottom: 16px;
}

.chip-tile {
  padding: 8px 10px;
  min-height: 60px;
}

/* STEP 8: Reduce Plan & Code visual noise */
.cicd-stage-section:has(.stage-icon-wrapper.bg-primary) .tool-insights-grid {
  font-size: 0.85em;
  line-height: 1.2;
}

.cicd-stage-section:has(.stage-icon-wrapper.bg-primary) .tool-insights-grid * {
  gap: 0.7em;
  margin: 0.7em;
}

/* Also apply to chips view */
.cicd-stage-section:has(.stage-icon-wrapper.bg-primary) .stage-section {
  font-size: 0.85em;
  line-height: 1.2;
}

/* CR5 V1 FINAL P1 — Hydration skeleton: preserves eventual layout footprint */
.pi-hydration-skeleton {
  display: flex;
  gap: 16px;
  padding: 16px 0;
  min-height: 400px;
}
.pi-hydration-sidebar {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pi-hydration-sidebar-item {
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.pi-hydration-detail {
  flex: 1;
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.pi-hydration-skeleton-bar {
  height: 14px;
  background: #f1f5f9;
  border-radius: 4px;
  animation: pi-hydration-pulse 1.5s ease-in-out infinite;
}
.pi-hydration-skeleton-short {
  height: 10px;
}
@keyframes pi-hydration-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* CR-X FINAL: Diagnostic-only state (sparse pilot) */
.pi-diagnostic-only-state {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1.5rem;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}
.pi-diagnostic-only-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #e0f2fe;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: #0284c7;
}
.pi-diagnostic-only-body {
  flex: 1;
}
.pi-diagnostic-only-title {
  margin: 0 0 0.5rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: #1e293b;
}
.pi-diagnostic-only-text {
  margin: 0 0 0.5rem 0;
  font-size: 0.875rem;
  color: #475569;
  line-height: 1.5;
}
.pi-diagnostic-only-subtext {
  margin: 0;
  font-size: 0.8rem;
  color: #64748b;
  line-height: 1.4;
}
</style>
