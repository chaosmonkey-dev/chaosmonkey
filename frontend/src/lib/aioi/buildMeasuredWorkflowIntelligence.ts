/**
 * Measured Workflow Intelligence
 *
 * Pure, source-of-truth builder for AI Operational Intelligence (AIOI).
 * Consumes canonical aggregated telemetry rows + metadata and returns ONLY
 * directly measured values per workflow. No fabricated scores, no static
 * provider lists, no card-count limits, no PBT-style sample thresholds.
 *
 * Contract:
 * - Workflow universe is derived from metadata.tools_in_population and
 *   positive metadata.session_count_by_tool entries only.
 * - 'unknown', 'extension', and test-browser tool ids are excluded.
 * - Every metric is either a finite measured number (explicit 0 preserved)
 *   or null when the underlying data is missing/non-finite.
 * - Weighted averages only include rows where that specific metric is
 *   available; unavailable rows never dilute the denominator.
 */

import { normalizeToCanonicalToolId } from '../workflowIdentity'
import { computeWeightedMetric, computeDerivedRatioMetric, type CanonicalRow } from '../canonicalMetricAuthority'
import type { ObservedCommitTtfcAuthority } from '../insights/final/observedCommitAuthority'
import { isMetricInstrumentedForWorkflow, isDelegatedAgentWorkflow, resolveSurface, type OperationalMode } from '../surfaceAgentContract'
import { getToolMonthlySpend, normalizeCostToolId } from '../toolCost'

export interface CanonicalAggregatedRowLike {
  tool?: string;
  session_count?: number;
  average_session_length_minutes?: number;
  total_session_minutes?: number;
  active_coding_time_minutes?: number;
  ai_usage_duration_minutes?: number;
  time_to_first_commit_minutes?: number;
  ai_suggestions_accepted?: number;
  commits_per_session?: number;
  idle_time_minutes?: number;
  focus_ratio?: number;
  [key: string]: unknown;
}

export interface CanonicalAggregatedMetadataLike {
  tools_in_population?: string[];
  session_count_by_tool?: Record<string, number>;
  [key: string]: unknown;
}

export type SignalStrength = 'Emerging' | 'Moderate' | 'Strong';
export type WorkflowModality = 'editor' | 'terminal';

export interface MeasuredWorkflowMetrics {
  toolId: string;
  name: string;
  sessionCount: number;
  modality: WorkflowModality;
  operationalMode: OperationalMode;
  heroMetricKey: string;
  activeCodingMinutesPerSession: number | null;
  averageSessionLengthMinutes: number | null;
  aiActivityPerSession: number | null;
  commitsPerSession: number | null;
  timeToFirstCommitMinutes: number | null;
  activeCodingRatio: number | null;
  focusRatio: number | null;
  aiUsageRatio: number | null;
  idleRatio: number | null;
  signalStrength: SignalStrength;
  // CR-X P1B.2 Production-Value: workflow economics (configured spend, not billing)
  monthlySpend: number | null;       // configured monthly spend, null if not configured
  costPerSession: number | null;     // monthlySpend / sessionCount, null if either missing
  costPerActiveHour: number | null;  // monthlySpend / active-coding-hours, null if either missing (human-interactive only)
  costPerRuntimeHour: number | null; // monthlySpend / runtime-hours, null if either missing (delegated-agent only)
}

const EXCLUDED_TOOL_IDS = new Set([
  'unknown',
  'extension',
  'test_browser',
  'test-browser',
  'testbrowser',
]);

/**
 * Workflow instrumentation capability map.
 *
 * Defines which metrics are actually instrumented for each workflow type.
 * A canonical aggregated value of 0 for a non-instrumented metric means
 * "not measured", not "measured zero". Such values are nulled out so the
 * AIOI panel never renders them as real measurements.
 *
 * Claude Code is a terminal-based AI assistant — it does not have IDE-level
 * keystroke/cursor instrumentation for active-coding time, focus ratio, or
 * idle time. It DOES have AI activity (suggestions accepted) and session
 * duration measurements.
 */
/**
 * Metrics that are human-interactive-only — not meaningful as labeled metrics
 * for delegated agents even if the surface can observe them.
 *
 * CR-X P1B.2 S1: Mode-aware. Previously this was a hardcoded claude_code set.
 * Now any delegated agent (Devin, Claude Code, future agents) suppresses
 * active-coding/focus/idle as labeled metrics because they measure
 * editor-window focus during agent operation, not human active coding.
 */
const HUMAN_INTERACTIVE_ONLY_METRICS = new Set([
  'activeCodingMinutesPerSession',
  'activeCodingRatio',
  'focusRatio',
  'idleRatio',
]);

function isMetricInstrumented(toolId: string, metricKey: string): boolean {
  // Mode-aware: delegated agents suppress human-interactive-only metrics
  if (isDelegatedAgentWorkflow(toolId) && HUMAN_INTERACTIVE_ONLY_METRICS.has(metricKey)) {
    return false;
  }
  return true;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeToolId(rawId: unknown): string {
  return normalizeToCanonicalToolId(String(rawId ?? ''));
}

export function computeSignalStrength(sessionCount: number): SignalStrength {
  if (sessionCount >= 50) return 'Strong';
  if (sessionCount >= 10) return 'Moderate';
  return 'Emerging';
}

/**
 * Derive the measured workflow universe strictly from canonical metadata.
 * Never falls back to a static provider list. Never truncates.
 */
export function deriveMeasuredWorkflowUniverse(
  metadata: CanonicalAggregatedMetadataLike | undefined | null
): string[] {
  const fromPopulation = Array.isArray(metadata?.tools_in_population)
    ? (metadata!.tools_in_population as unknown[])
    : [];

  const fromCounts = metadata?.session_count_by_tool
    ? Object.entries(metadata.session_count_by_tool)
        .filter(([, count]) => isFiniteNumber(count) && count > 0)
        .map(([toolId]) => normalizeToCanonicalToolId(toolId))
    : [];

  const universe = new Set<string>();
  for (const rawId of [...fromPopulation, ...fromCounts]) {
    const normalized = normalizeToCanonicalToolId(String(rawId ?? ''));
    if (!normalized || EXCLUDED_TOOL_IDS.has(normalized)) continue;
    universe.add(normalized);
  }

  return Array.from(universe);
}

/**
 * Build measured workflow intelligence from canonical aggregated rows.
 *
 * @param rows Canonical aggregated telemetry rows (any period granularity)
 * @param metadata Canonical aggregated metadata (source of workflow universe)
 * @param getName Optional resolver for display name (defaults to raw toolId)
 * @param observedAuthority CR5 WS1 — shared observed commit/TTFC authority.
 *   When provided, `commitsPerSession` and `timeToFirstCommitMinutes` are
 *   taken ONLY from this authority (null when a workflow lacks qualified
 *   observed evidence). The synthetic canonical aggregated `commits_per_session`
 *   and rounded `time_to_first_commit_minutes` are NEVER used as a fallback
 *   when the authority is present. When absent (test-only path), the builder
 *   falls back to the aggregated-row weighted metrics for those two fields.
 */
export function buildMeasuredWorkflowIntelligence(
  rows: CanonicalAggregatedRowLike[] | undefined | null,
  metadata: CanonicalAggregatedMetadataLike | undefined | null,
  getName: (toolId: string) => string = (id) => id,
  observedAuthority?: ObservedCommitTtfcAuthority
): MeasuredWorkflowMetrics[] {
  const universe = deriveMeasuredWorkflowUniverse(metadata);
  if (universe.length === 0) return [];

  const rowsByTool = new Map<string, CanonicalAggregatedRowLike[]>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const toolId = normalizeToolId(row?.tool);
    if (!toolId || EXCLUDED_TOOL_IDS.has(toolId)) continue;
    if (!rowsByTool.has(toolId)) rowsByTool.set(toolId, []);
    rowsByTool.get(toolId)!.push(row);
  }

  return universe
    .map((toolId) => {
      const toolRows = rowsByTool.get(toolId) || [];

      const rawCounts = metadata?.session_count_by_tool || {};
      const metadataCount = Object.entries(rawCounts)
        .filter(([rawKey]) => normalizeToCanonicalToolId(rawKey) === toolId)
        .reduce((sum, [, count]) => sum + (isFiniteNumber(Number(count)) ? Number(count) : 0), 0);
      const rowsCount = toolRows.reduce((sum, row) => {
        const count = Number(row?.session_count);
        return isFiniteNumber(count) ? sum + count : sum;
      }, 0);
      const sessionCount = isFiniteNumber(metadataCount) && metadataCount > 0
        ? metadataCount
        : rowsCount;

      const toolRowsAsCanonical: CanonicalRow[] = toolRows

      const activeCodingResult = computeWeightedMetric(toolRowsAsCanonical, toolId, 'active_coding_time_minutes')
      const activeCodingMinutesPerSession = activeCodingResult.weightedValue

      const sessionLengthResult = computeWeightedMetric(toolRowsAsCanonical, toolId, 'average_session_length_minutes')
      const averageSessionLengthMinutes = sessionLengthResult.weightedValue

      const aiActivityResult = computeWeightedMetric(toolRowsAsCanonical, toolId, 'ai_suggestions_accepted')
      // CR-X PI/PBT-TIME P0: AIOI and PBT both use observed ai_suggestions_accepted
      // authority for AI Activity / Session. The canonical aggregated endpoint
      // returns finite observed ai_suggestions_accepted values for Claude Code
      // sessions, so the surface contract now marks ai_suggestions_accepted as
      // directly_observed for the terminal surface. Only metrics that genuinely
      // depend on unavailable terminal observability (active-coding/focus/idle)
      // remain gated. This preserves AIOI/PBT parity under the same scope.
      const aiActivityPerSession = isMetricInstrumentedForWorkflow(toolId, 'ai_suggestions_accepted')
        ? aiActivityResult.weightedValue
        : null

      const commitsResult = computeWeightedMetric(toolRowsAsCanonical, toolId, 'commits_per_session')
      const ttfcResult = computeWeightedMetric(toolRowsAsCanonical, toolId, 'time_to_first_commit_minutes')

      // CR5 WS1 P0 FIX #3 — commits/session and TTFC come ONLY from the
      // shared observed authority. There is NO fallback to synthetic
      // aggregated commit_count or rounded TTFC. Ever.
      //
      // - Populated authority → observed values
      // - Empty authority → unavailable (null)
      // - Missing/undefined authority → unavailable (null)
      // - Failed authority → unavailable (null)
      //
      // The aggregated weighted metrics (commitsResult, ttfcResult) are
      // computed for other consumers but are NEVER used for commits/session
      // or TTFC in the canonical measured builder.
      const authEntry = (observedAuthority instanceof Map)
        ? observedAuthority.get(toolId)
        : undefined;
      const commitsPerSession = authEntry?.commitsPerSession ?? null;
      const timeToFirstCommitMinutes = authEntry?.ttfcMinutes ?? null;

      const focusRatioResult = computeWeightedMetric(toolRowsAsCanonical, toolId, 'focus_ratio')
      const activeCodingRatio = focusRatioResult.weightedValue

      const aiUsageRatioResult = computeDerivedRatioMetric(toolRowsAsCanonical, toolId, 'ai_usage_duration_minutes', 'total_session_minutes')
      // Codex (and any lifecycle-only bridge) never emits AI-usage duration —
      // the derived ratio would be a fake measured 0%. Gate on the capability
      // contract so unsupported instrumentation renders as unavailable (null),
      // never as a measured zero.
      const aiUsageRatio = isMetricInstrumentedForWorkflow(toolId, 'ai_usage_ratio')
        ? aiUsageRatioResult.weightedValue
        : null

      const idleRatioResult = computeDerivedRatioMetric(toolRowsAsCanonical, toolId, 'idle_time_minutes', 'total_session_minutes')
      const idleRatio = idleRatioResult.weightedValue

      // CR-X P1B.2 Wave 0: modality is SURFACE-DERIVED, not operational-mode-derived.
      // Devin runs on a vscode surface → modality='editor'.
      // Claude Code runs on a terminal surface → modality='terminal'.
      // This preserves the independent dimensions: surface ≠ operational mode.
      const surface = resolveSurface(toolId)
      const modality: WorkflowModality = surface === 'terminal' ? 'terminal' : 'editor'

      // CR-X P1B.2 S1: Hero metric selection is OPERATIONAL-MODE-aware.
      // Delegated agents (Claude Code, Devin, future agents) use session runtime
      // as hero, NOT active coding (which is a human-interactive IDE concept).
      // Human-interactive workflows use active coding min/session when authoritative.
      const isDelegatedAgent = isDelegatedAgentWorkflow(toolId)
      const operationalMode: OperationalMode = isDelegatedAgent ? 'delegated_agent' : 'human_interactive'
      const heroMetricKey = isDelegatedAgent
        ? 'averageSessionLengthMinutes'
        : 'activeCodingMinutesPerSession'

      // CR-X P1B.2 Production-Value: workflow economics using canonical cost authority.
      // Reuses getToolMonthlySpend from toolCost.ts (localStorage fallback for dev).
      // Does NOT divide by all-time sessions — uses the same sessionCount authority.
      // Does NOT imply billing data — configured spend is an estimate, not billing.
      // If no configured cost exists, all economics fields are null (omit cleanly).
      const costToolId = normalizeCostToolId(toolId) as string
      const monthlySpend = getToolMonthlySpend(costToolId)
      const costPerSession = (monthlySpend !== null && sessionCount > 0)
        ? monthlySpend / sessionCount
        : null
      // Mode-correct cost-per-hour: human-interactive uses active coding hours,
      // delegated-agent uses runtime hours. Never cross modes.
      const activeCodingHours = activeCodingMinutesPerSession !== null
        ? (activeCodingMinutesPerSession * sessionCount) / 60
        : 0
      const runtimeHours = averageSessionLengthMinutes !== null
        ? (averageSessionLengthMinutes * sessionCount) / 60
        : 0
      const costPerActiveHour = (!isDelegatedAgent && monthlySpend !== null && activeCodingHours > 0)
        ? monthlySpend / activeCodingHours
        : null
      const costPerRuntimeHour = (isDelegatedAgent && monthlySpend !== null && runtimeHours > 0)
        ? monthlySpend / runtimeHours
        : null

      return {
        toolId,
        name: getName(toolId),
        sessionCount,
        modality,
        operationalMode,
        heroMetricKey,
        activeCodingMinutesPerSession: isMetricInstrumented(toolId, 'activeCodingMinutesPerSession') ? activeCodingMinutesPerSession : null,
        averageSessionLengthMinutes,
        aiActivityPerSession,
        commitsPerSession,
        timeToFirstCommitMinutes,
        activeCodingRatio: isMetricInstrumented(toolId, 'activeCodingRatio') ? activeCodingRatio : null,
        focusRatio: isMetricInstrumented(toolId, 'focusRatio') ? focusRatioResult.weightedValue : null,
        aiUsageRatio,
        idleRatio: isMetricInstrumented(toolId, 'idleRatio') ? idleRatio : null,
        signalStrength: computeSignalStrength(sessionCount),
        monthlySpend,
        costPerSession,
        costPerActiveHour,
        costPerRuntimeHour,
      };
    })
    .sort((a, b) => b.sessionCount - a.sessionCount);
}
