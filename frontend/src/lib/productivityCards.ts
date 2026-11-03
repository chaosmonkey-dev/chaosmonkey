/**
 * Shared utility for generating IDE metric cards
 * Extracted from ProductivityOverTime.vue to ensure single source of truth
 * Used by both Classic (ProductivityOverTime.vue) and V3 (ProductivityByToolV3.vue)
 */

// 🔥 P1: Gate noisy PBT logs behind debug flag
const PBT_DEBUG = (import.meta.env.VITE_PBT_DEBUG ?? 'false') === 'true'

import { resolveTimeSeriesPointField } from './productivity/resolveTimeSeriesPointField'
import { isMetricInstrumentedForWorkflow } from './surfaceAgentContract'

export type MetricAvailability = 'available' | 'no_data' | 'not_instrumented'

export interface MetricCard {
  ide: string
  value: number | null
  isLive: boolean
  usesTelemetry: boolean
  dataSource: string
  telemetryPointCount: number // Number of chart points with telemetry
  totalPointCount: number // Total number of chart points
  sessionCount: number // Actual session count from aggregated telemetry
  hasValue: boolean
  availability: MetricAvailability
  rawToolId?: string // Original series label for cost lookup
  activeCodingMinutes?: number // Total active coding minutes for the period (for cost calculations)
}

export interface GenerateMetricCardsParams {
  dataSource: any[]
  activeMetricId: string
  comparisonMode: string
  selectedMetric: string
  getCanonicalEntityLabel: (label: string, mode: string) => string
  getCanonicalWorkflowIdentity?: (label: string) => string
}

const UNINSTRUMENTED_METRICS_BY_TOOL: Record<string, string[]> = {
  claude_code: [
    'active_coding_time_minutes',
    'active_coding_ratio',
    'idle_time_minutes',
    'idle_ratio',
    // CR-X 1B.1: Additional unavailable metrics per bridge contract
    'files_edited_per_session',
    'focus_ratio',
    'flow_profile',
    'debug_session_count',
    'debug_time_ms',
    // CR-X PI/PBT-TIME P0: ai_suggestions_accepted is NOT suppressed for
    // Claude Code. The canonical aggregated endpoint returns finite observed
    // ai_suggestions_accepted values for Claude Code sessions. AIOI and PBT
    // must show the same metric under the same scope when eligible. Only
    // metrics that genuinely depend on unavailable terminal observability
    // (active-coding/focus/idle) remain gated.
  ],
  // Codex bridge emits aggregate lifecycle telemetry only (duration_ms,
  // session/turn/tool counts). It does not observe AI bursts/suggestions,
  // file saves, git commits, or human-attention signals — token usage is
  // unavailable_lifecycle_hooks. These must never render as measured zeros.
  codex: [
    'active_coding_time_minutes',
    'active_coding_ratio',
    'idle_time_minutes',
    'idle_ratio',
    'files_edited_per_session',
    'focus_ratio',
    'flow_profile',
    'debug_session_count',
    'debug_time_ms',
    'ai_suggestions_accepted',
    'ai_usage_duration_minutes',
    'commits_per_session',
    'time_to_first_commit_minutes',
  ],
}

export function isMetricInstrumentedForTool(toolId: string, metricId: string): boolean {
  const normalizedTool = toolId.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const uninstrumented = UNINSTRUMENTED_METRICS_BY_TOOL[normalizedTool]
  if (!uninstrumented) return true
  return !uninstrumented.includes(metricId)
}

/**
 * Generate metric cards from time series data
 * This is the functional source of truth for card generation logic
 * DO NOT MODIFY without updating both Classic and V3
 */
export function generateMetricCards(params: GenerateMetricCardsParams): MetricCard[] {
  // PERF: Start timing
  const start = performance.now()
  let result: MetricCard[] = []

  try {
    const { dataSource, activeMetricId, comparisonMode, getCanonicalEntityLabel: getLabel } = params

    // 🔥 DEBUG: Log input data
    if (PBT_DEBUG) {
      console.log('[productivityCards] INPUT:', {
        hasDataSource: !!dataSource,
        dataSourceLength: dataSource?.length,
        dataSourceLabels: dataSource?.map((s: any) => s.label),
        sampleSeries: dataSource?.[0]
      })
    }

    // Ensure data exists and is an array
    if (!dataSource || !Array.isArray(dataSource) || dataSource.length === 0) {
      if (PBT_DEBUG) console.log('[productivityCards] RETURNING EMPTY: no data source')
      return []
    }

    // Get the active metric ID to determine if we're showing TTFC
    const isTtfcMetric = activeMetricId === 'ide.time_to_first_commit_minutes'

    // Resolve point field via single source of truth; null means unknown metric
    const pointField = resolveTimeSeriesPointField(activeMetricId)
    if (!pointField) return []
    
    // Get the latest value for each tool/IDE directly from the series
    const cards = dataSource
      .filter((series: any) => series && series.label && series.points && Array.isArray(series.points))
      // 🔥 FIX: Exclude test-browser from workflow universe per Productivity V3 data contract
      .filter((series: any) => series.label !== 'test-browser')
      .map((series: any) => {
        if (series.points.length === 0) {
          const emptyMetricKey = activeMetricId.replace(/^ide\./, '')
          const emptyInstrumented = isMetricInstrumentedForTool(series.label, emptyMetricKey)
          return { ide: series.label, value: null, isLive: false, usesTelemetry: false, dataSource: 'Simulated', telemetryPointCount: 0, totalPointCount: 1, hasValue: false, availability: emptyInstrumented ? 'no_data' as MetricAvailability : 'not_instrumented' as MetricAvailability }
        }
        
        // Use canonical name from comparisonEntities if in models/ides mode
        let displayLabel = series.label
        if (comparisonMode === 'models') {
          displayLabel = getLabel(series.label, comparisonMode)
        } else if (comparisonMode === 'ides') {
          displayLabel = getLabel(series.label, comparisonMode)
        }
        
        let value: number | null
        let isLive = false
        let valueSource = ''
        
        if (isTtfcMetric) {
          // CRITICAL: For TTFC, use session-weighted historical average (matches AIOI authority)
          const weightedPoints = series.points.map((p: any) => {
            const fieldValue = p && typeof p[pointField] === 'number' && p[pointField] != null && !Number.isNaN(p[pointField]) ? p[pointField] : null
            const weight = p && typeof p.session_count === 'number' && p.session_count > 0 ? p.session_count : 0
            return { value: fieldValue, weight }
          })
          const eligible = weightedPoints.filter((wp: any) => wp.value != null && wp.weight > 0)
          const usesTelemetry = 'usesTelemetry' in series && series.usesTelemetry === true
          
          if (!eligible.length) {
            value = null
            isLive = false
            valueSource = 'TTFC_NO_DATA'
          } else {
            // Session-weighted average (authoritative — matches AIOI)
            const numerator = eligible.reduce((sum: number, wp: any) => sum + wp.value * wp.weight, 0)
            const denominator = eligible.reduce((sum: number, wp: any) => sum + wp.weight, 0)
            value = denominator > 0 ? numerator / denominator : null
            isLive = usesTelemetry
            valueSource = 'TTFC_SESSION_WEIGHTED_AVERAGE'
          }
        } else {
          // Session-weighted historical average (matches AIOI canonical metric authority)
          const weightedPoints = series.points
            .map((p: any) => ({
              value: p && p[pointField],
              weight: p && typeof p.session_count === 'number' && p.session_count > 0 ? p.session_count : 0,
            }))
          const eligible = weightedPoints.filter((wp: any) => typeof wp.value === 'number' && Number.isFinite(wp.value) && wp.weight > 0)
          if (eligible.length === 0) {
            value = null
          } else {
            // Session-weighted average (authoritative — matches AIOI)
            const numerator = eligible.reduce((sum: number, wp: any) => sum + wp.value * wp.weight, 0)
            const denominator = eligible.reduce((sum: number, wp: any) => sum + wp.weight, 0)
            value = denominator > 0 ? numerator / denominator : null
          }
          isLive = false
          valueSource = 'SESSION_WEIGHTED_AVERAGE'
        }
        
        // 🔥 FIX: Determine live telemetry status dynamically from actual telemetry data
        // If a workflow has telemetryPointCount > 0, it has canonical telemetry and is "Real"
        // Never label workflows with canonical telemetry as "Demo data" or "Simulated"
        const hasCanonicalTelemetry = (series.telemetryPointCount || series.totalPointCount || 0) > 0
        const dataSource = hasCanonicalTelemetry ? 'Real' : 'Simulated'
        const usesTelemetry = hasCanonicalTelemetry
        
        // 🔥 FIX: Use sessionCount for session-based logic, telemetryPointCount for chart points
        const telemetryPointCount = series.telemetryPointCount || series.totalPointCount || 0
        const totalPointCount = hasCanonicalTelemetry ? telemetryPointCount : 1
        const sessionCount = series.sessionCount || 0

        // 🔥 P0-D FIX: Extract active coding minutes from series for cost calculations
        // Spend per active coding hour must use canonical active coding time, independent of selected metric.
        // Always use series-level aggregate field if available, regardless of selected metric.
        // CR-X 1B.1: Gate by surfaceAgentContract — active_coding is unavailable for
        // terminal-based workflows (Claude Code). Even if the DB has a value (stale/seeded),
        // the contract is authority. activeCodingMinutes must be 0 for uninstrumented workflows.
        let activeCodingMinutes = 0
        const isActiveCodingInstrumented = isMetricInstrumentedForWorkflow(series.label, 'active_coding_time_minutes')

        if (isActiveCodingInstrumented) {
          // First try series-level aggregate field (most reliable)
          if (typeof series.active_coding_time_minutes === 'number') {
            activeCodingMinutes = series.active_coding_time_minutes
          } else if (typeof series.activeCodingMinutes === 'number') {
            activeCodingMinutes = series.activeCodingMinutes
          } else if (series.points && Array.isArray(series.points) && series.points.length > 0) {
            // Fallback: aggregate from point data - try multiple field names
            activeCodingMinutes = series.points.reduce((sum: number, p: any) => {
              // Try multiple possible field names for active coding time in point data
              const activeTime = p.active_coding_time_minutes || p.activeCodingMinutes ||
                                p.active_coding_duration_minutes || p.activeCodingDuration || 0
              return sum + (typeof activeTime === 'number' ? activeTime : 0)
            }, 0)
          }
        }

        const metricKey = activeMetricId.replace(/^ide\./, '')
        // CR-X Day 1B S3: Use surfaceAgentContract as primary authority for
        // metric instrumentation. The hardcoded UNINSTRUMENTED_METRICS_BY_TOOL
        // remains as a fallback for backward compatibility.
        const isInstrumented = isMetricInstrumentedForWorkflow(series.label, metricKey)
          && isMetricInstrumentedForTool(series.label, metricKey)

        let finalValue: number | null
        let availability: MetricAvailability
        let hasValue: boolean

        if (!isInstrumented) {
          finalValue = null
          availability = 'not_instrumented'
          hasValue = false
        } else if (value === null || !Number.isFinite(value)) {
          finalValue = null
          availability = 'no_data'
          hasValue = false
        } else {
          finalValue = value
          availability = 'available'
          hasValue = sessionCount > 0
        }

        return {
          ide: displayLabel,
          value: finalValue,
          isLive: isLive,
          usesTelemetry,
          dataSource,
          telemetryPointCount,
          totalPointCount,
          sessionCount,
          hasValue,
          availability,
          rawToolId: series.label, // Preserve original series label for cost lookup
          activeCodingMinutes, // Total active coding minutes for the period
        }
      })
    
    // 🔥 DEDUPE: Canonicalize and deduplicate workflows by canonical identity
    // Preserve Devin and Windsurf as distinct workflows; canonicalize by tool identity only
    const { getCanonicalWorkflowIdentity } = params
    const canonicalCardMap = new Map()
    
    cards.forEach(card => {
      // Get canonical workflow identity for deduplication key
      const canonicalKey = getCanonicalWorkflowIdentity 
        ? getCanonicalWorkflowIdentity(card.rawToolId || card.ide)
        : card.ide
      
      const existing = canonicalCardMap.get(canonicalKey)
      
      if (!existing) {
        // First occurrence, keep it
        canonicalCardMap.set(canonicalKey, card)
      } else {
        // Duplicate detected: apply deterministic rule
        // 1. Keep card with higher sessionCount
        // 2. If tied, keep card with higher telemetryPointCount
        // 3. If still tied, keep first (existing)
        const existingSessionCount = existing.sessionCount || 0
        const currentSessionCount = card.sessionCount || 0
        const existingTelemetryCount = existing.telemetryPointCount || 0
        const currentTelemetryCount = card.telemetryPointCount || 0
        
        const shouldReplace = currentSessionCount > existingSessionCount ||
          (currentSessionCount === existingSessionCount && currentTelemetryCount > existingTelemetryCount)
        
        if (shouldReplace) {
          if (PBT_DEBUG) console.log(`[PBT_DEDUPE] Collapsed duplicate workflow alias into ${canonicalKey}`)
          canonicalCardMap.set(canonicalKey, card)
        }
      }
    })

    result = Array.from(canonicalCardMap.values())

    return result
  } catch (error) {
    return []
  } finally {
    const end = performance.now()
    const duration = end - start
    if (PBT_DEBUG) console.log(`[PERF] Card Generation | ${duration.toFixed(2)}ms | 1 | ${result.length} cards`)
  }
}

/**
 * Metric polarity: higher-is-better vs lower-is-better
 */
export const METRIC_POLARITY: Record<string, 'higher' | 'lower'> = {
  // Higher is better
  'AI_suggestions_accepted': 'higher',
  'ai_suggestions_accepted': 'higher',
  'ai_burst_count': 'higher',
  'AI_throughput': 'higher',
  'AI_usage_duration_minutes': 'higher',
  'ai_usage_duration_minutes': 'higher',
  'files_edited_per_session': 'higher',
  'commits_per_session': 'higher',
  'average_session_length_minutes': 'higher',
  'active_coding_time_minutes': 'higher',
  'focus_efficiency': 'higher',
  'focus_ratio': 'higher',
  'active_coding_ratio': 'higher',
  'ai_usage_ratio': 'higher',
  
  // Lower is better
  'idle_time_minutes': 'lower',
  'idle_ratio': 'lower',
  'time_to_first_commit_minutes': 'lower',
  'pr_cycle_time': 'lower',
  'review_wait_time': 'lower',
  'merge_latency': 'lower',
  'deployment_recovery_time': 'lower',
  'context_switching': 'lower',

  // CR-X Slice 1: Delivery metrics
  'merged_pr_count': 'higher',
  'deployment_count': 'higher',
  'deploy_success_rate': 'higher',
  'median_merge_cycle_hours': 'lower',
  // CR-X PBT-CLEANUP-3: Complete delivery polarity authority
  'release_count': 'higher',
  'review_count': 'higher',
  'pr_review_cycles': 'higher',
  'merge_rate': 'higher',
}

/**
 * Determine leader from metric cards (respects metric polarity)
 * Leader is the best performer: highest value for higher-is-better, lowest for lower-is-better
 * Requires minimum sample size (25 sessions) for full card eligibility
 * Unified with AI Ops eligibility rules for consistency across surfaces
 */
export function determineLeader(cards: MetricCard[], metricId: string): MetricCard | null {
  if (!cards || cards.length === 0) return null
  
  // Filter to cards with meaningful sample size (>= 25 sessions for full cards)
  // This ensures consistency with AI Ops card eligibility rules
  const MIN_SAMPLE_THRESHOLD = 25
  const cardsWithSample = cards.filter(c => {
    const sessionCount = c.sessionCount || 0 // 🔥 FIX: Use sessionCount, not telemetryPointCount
    return c.hasValue && c.value !== null && sessionCount >= MIN_SAMPLE_THRESHOLD
  })
  
  if (cardsWithSample.length === 0) return null
  
  const polarity = METRIC_POLARITY[metricId] || 'higher'
  
  // Find card with best value based on polarity
  let leader: MetricCard | null = null
  for (const card of cardsWithSample) {
    if (!leader) {
      leader = card
    } else if (card.value !== null && leader.value !== null) {
      if (polarity === 'higher') {
        if (card.value > leader.value) leader = card
      } else {
        if (card.value < leader.value) leader = card
      }
    }
  }
  
  // Check for ties: if multiple cards have the same value as leader, no leader
  if (leader) {
    const tieCount = cardsWithSample.filter(c => c.value === leader.value).length
    if (tieCount > 1) return null // Tie detected, no leader
  }
  
  return leader
}

/**
 * Determine laggard from metric cards (respects metric polarity)
 * Laggard is the worst performer: lowest value for higher-is-better, highest for lower-is-better
 * Requires minimum sample size (25 sessions) for full card eligibility
 * Unified with AI Ops eligibility rules for consistency across surfaces
 * 🔥 P0-B FIX: Requires at least 2 eligible entities to prevent leader === laggard
 */
export function determineLaggard(cards: MetricCard[], metricId: string): MetricCard | null {
  if (!cards || cards.length === 0) return null
  
  // Filter to cards with meaningful sample size (>= 25 sessions for full cards)
  // This ensures consistency with AI Ops card eligibility rules
  const MIN_SAMPLE_THRESHOLD = 25
  const cardsWithSample = cards.filter(c => {
    const sessionCount = c.sessionCount || 0 // 🔥 FIX: Use sessionCount, not telemetryPointCount
    return c.hasValue && c.value !== null && sessionCount >= MIN_SAMPLE_THRESHOLD
  })
  
  // 🔥 P0-B FIX: Require at least 2 eligible entities for laggard
  // If only 1 entity is eligible, it's the leader and there's no laggard
  if (cardsWithSample.length < 2) return null
  
  const polarity = METRIC_POLARITY[metricId] || 'higher'
  
  // Find card with worst value based on polarity
  let laggard: MetricCard | null = null
  for (const card of cardsWithSample) {
    if (!laggard) {
      laggard = card
    } else if (card.value !== null && laggard.value !== null) {
      if (polarity === 'higher') {
        if (card.value < laggard.value) laggard = card
      } else {
        if (card.value > laggard.value) laggard = card
      }
    }
  }
  
  // Check for ties: if multiple cards have the same value as laggard, no laggard
  if (laggard) {
    const tieCount = cardsWithSample.filter(c => c.value === laggard.value).length
    if (tieCount > 1) return null // Tie detected, no laggard
  }
  
  return laggard
}

/**
 * Determine winner from metric cards (legacy, use determineLeader instead)
 * @deprecated Use determineLeader with metric polarity instead
 */
export function determineWinner(cards: MetricCard[]): MetricCard | null {
  if (!cards || cards.length === 0) return null
  
  const cardsWithValue = cards.filter(c => c.hasValue)
  if (cardsWithValue.length === 0) return null
  
  // Find card with highest value
  let winner: MetricCard | null = null
  for (const card of cardsWithValue) {
    if (!winner || (card.value !== null && winner.value !== null && card.value > winner.value)) {
      winner = card
    }
  }
  return winner
}

/**
 * Check if a workflow is eligible for primary card display
 * Primary cards require minimum sample size (>= 25 canonical sessions)
 * This ensures consistency across AI Ops and Productivity V3 surfaces
 */
export function isPrimaryCardEligible(card: MetricCard): boolean {
  const MIN_SAMPLE_THRESHOLD = 25
  const sessionCount = card.sessionCount || 0 // 🔥 FIX: Use sessionCount, not telemetryPointCount
  const isEligible = sessionCount >= MIN_SAMPLE_THRESHOLD

  return isEligible
}

/**
 * Filter cards to primary workflows only (>= 25 canonical sessions)
 * Used for card view to prevent low-volume workflows from appearing as full cards
 */
export function filterPrimaryCards(cards: MetricCard[]): MetricCard[] {
  return cards.filter(card => isPrimaryCardEligible(card))
}

/**
 * Filter cards to emerging workflows only (< 25 canonical sessions)
 * Used for emerging workflow sections or compact display
 */
export function filterEmergingCards(cards: MetricCard[]): MetricCard[] {
  const filtered = cards.filter(card => !isPrimaryCardEligible(card))
  return filtered
}
