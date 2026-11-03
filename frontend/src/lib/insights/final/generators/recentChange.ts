/**
 * CR-X P1B.2 Wave 1 — Recent Change Generator (Adaptive Temporal Intelligence)
 *
 * Answers the engineering-leader question: "WHAT CHANGED RECENTLY?"
 *
 * CONTRACT:
 * - One canonical `recent-change` family; multiple instances allowed
 * - Deterministic collision-safe instance IDs: `recent-change__{dimension}__{workflow}`
 * - Observed-time authority: windows anchor to max observed timestamp
 * - Mode-correct metrics: human_interactive uses active coding; delegated_agent uses runtime
 * - Materiality before novelty: no noisy findings
 * - Sparse-window safety: zero/sparse intervals are NOT declines
 * - Customer language from birth (Wave 3 title contract)
 * - Max 5 findings, usually fewer
 * - No developer identity work
 */

import type { CanonicalInsightInput, CanonicalInsight } from '../types';
import { getCanonicalPIById } from '../canonicalInsights';
import { piDebugLog } from '../utils/logging';
import { getWorkflowDisplayName, normalizeToCanonicalToolId } from '../../../workflowIdentity';
import { isDelegatedAgentWorkflow, isHumanInteractiveWorkflow } from '../../../surfaceAgentContract';
import {
  selectComparisonWindows,
  isInWindow,
  isWindowAdequatelyPopulated,
  type ComparisonWindows,
  type TemporalWindow,
} from '../helpers/temporalWindows';

// ── Thresholds ───────────────────────────────────────────────────────────

const MIN_SESSIONS_PER_WINDOW = 15;       // minimum sample in each window
const MIN_SESSIONS_PER_WINDOW_WORKFLOW = 15; // per-workflow minimum
const MAX_FINDINGS = 5;                   // bounded portfolio
const MIN_RELATIVE_CHANGE_PCT = 20;       // ≥20% relative change to be material
const MIN_ABSOLUTE_CHANGE_PP = 5;         // ≥5pp for ratio metrics
const MIN_SESSION_DURATION_CHANGE_MIN = 10; // ≥10 min/session for duration
const DAY_MS = 86400000;

// ── Dimension definitions ─────────────────────────────────────────────────

type MetricDimension =
  | 'session_volume'
  | 'session_share'
  | 'active_coding'
  | 'agent_runtime'
  | 'session_duration'
  | 'ai_usage_share'
  | 'repo_concentration';

interface DimensionDef {
  dimension: MetricDimension;
  label: string;           // customer-language label
  appliesTo: 'all' | 'human_interactive' | 'delegated_agent';
  isRatio: boolean;         // ratio (0-1) vs absolute
}

const DIMENSIONS: DimensionDef[] = [
  { dimension: 'session_volume', label: 'session volume', appliesTo: 'all', isRatio: false },
  { dimension: 'session_share', label: 'share of sessions', appliesTo: 'all', isRatio: true },
  { dimension: 'active_coding', label: 'active coding per session', appliesTo: 'human_interactive', isRatio: false },
  { dimension: 'agent_runtime', label: 'runtime per session', appliesTo: 'delegated_agent', isRatio: false },
  { dimension: 'session_duration', label: 'session duration', appliesTo: 'all', isRatio: false },
  { dimension: 'ai_usage_share', label: 'AI-assisted session share', appliesTo: 'all', isRatio: true },
  { dimension: 'repo_concentration', label: 'repo concentration', appliesTo: 'all', isRatio: true },
];

// ── Helper: get workflow display name ────────────────────────────────────
// CR-X FINAL: centralized in workflowIdentity.ts. This file previously
// had a local copy; the import now owns the name authority.

// ── Helper: compute metric value for a set of rows ───────────────────────

interface MetricResult {
  value: number;
  count: number;
}

function computeMetric(
  rows: any[],
  dimension: MetricDimension,
  totalSessionsAll: number,
  windowDurationDays?: number,
): MetricResult | null {
  if (rows.length === 0) return null;

  switch (dimension) {
    case 'session_volume': {
      // Normalize to sessions-per-day when window duration is known.
      // This prevents misleading volume comparisons when windows are
      // different lengths (e.g., 7-day recent vs 21-day prior baseline).
      if (windowDurationDays && windowDurationDays > 0) {
        return { value: rows.length / windowDurationDays, count: rows.length };
      }
      return { value: rows.length, count: rows.length };
    }

    case 'session_share': {
      if (totalSessionsAll <= 0) return null;
      return { value: rows.length / totalSessionsAll, count: rows.length };
    }

    case 'active_coding': {
      // Human-interactive only: active coding minutes per session
      const vals = rows
        .map(r => r.session_active_coding_duration_minutes)
        .filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
      if (vals.length === 0) return null;
      const sum = vals.reduce((a, b) => a + b, 0);
      return { value: sum / vals.length, count: vals.length };
    }

    case 'agent_runtime': {
      // Delegated agent only: session duration (runtime) per session
      const vals = rows
        .map(r => r.session_duration_minutes)
        .filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
      if (vals.length === 0) return null;
      const sum = vals.reduce((a, b) => a + b, 0);
      return { value: sum / vals.length, count: vals.length };
    }

    case 'session_duration': {
      const vals = rows
        .map(r => r.session_duration_minutes)
        .filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
      if (vals.length === 0) return null;
      const sum = vals.reduce((a, b) => a + b, 0);
      return { value: sum / vals.length, count: vals.length };
    }

    case 'ai_usage_share': {
      // Share of sessions with AI activity (ai_burst_count > 0)
      const aiActive = rows.filter(r => {
        const bursts = r.ai_burst_count;
        return typeof bursts === 'number' && bursts > 0;
      }).length;
      if (rows.length === 0) return null;
      return { value: aiActive / rows.length, count: rows.length };
    }

    case 'repo_concentration': {
      // Herfindahl-style concentration: sum of squared repo shares
      const repoCounts: Record<string, number> = {};
      for (const r of rows) {
        const repo = r.git_repo_url || 'unknown';
        repoCounts[repo] = (repoCounts[repo] || 0) + 1;
      }
      const total = rows.length;
      if (total === 0) return null;
      let hhi = 0;
      for (const count of Object.values(repoCounts)) {
        const share = count / total;
        hhi += share * share;
      }
      return { value: hhi, count: rows.length };
    }

    default:
      return null;
  }
}

// ── Helper: format values for customer language ──────────────────────────

function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const hrs = Math.floor(min / 60);
  const mins = Math.round(min % 60);
  return mins === 0 ? `${hrs}h` : `${hrs}h${mins}m`;
}

function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function formatDeltaPct(pct: number): string {
  const rounded = Math.round(Math.abs(pct));
  return `${rounded}%`;
}

function formatDeltaMinutes(min: number): string {
  const abs = Math.abs(min);
  if (abs < 60) return `${Math.round(abs)}m`;
  return formatMinutes(abs);
}

// ── Metric presentation contract ──────────────────────────────────────────
// Each dimension carries explicit value type, unit, and formatting so the
// renderer never has to guess. This prevents the title/body/graph unit
// contradictions seen in the browser (e.g., title says "18% → 92%" but body
// shows "0.2% → 0.9%" because the renderer treats ratio 0.18 as 0.18%).

interface MetricPresentation {
  metricKind: MetricDimension;
  valueType: 'percentage' | 'duration_minutes' | 'count' | 'rate' | 'index';
  unit: string;
  formatValue: (v: number) => string;
  rightMetricLabel: string;
}

const METRIC_PRESENTATION: Record<MetricDimension, MetricPresentation> = {
  session_volume: {
    metricKind: 'session_volume',
    valueType: 'count',
    unit: 'sessions',
    formatValue: (v: number) => Math.round(v).toLocaleString(),
    rightMetricLabel: 'Sessions per day',
  },
  session_share: {
    metricKind: 'session_share',
    valueType: 'percentage',
    unit: '%',
    formatValue: formatPct,
    rightMetricLabel: 'Share of sessions',
  },
  active_coding: {
    metricKind: 'active_coding',
    valueType: 'duration_minutes',
    unit: 'min',
    formatValue: formatMinutes,
    rightMetricLabel: 'Active coding per session',
  },
  agent_runtime: {
    metricKind: 'agent_runtime',
    valueType: 'duration_minutes',
    unit: 'min',
    formatValue: formatMinutes,
    rightMetricLabel: 'Runtime per session',
  },
  session_duration: {
    metricKind: 'session_duration',
    valueType: 'duration_minutes',
    unit: 'min',
    formatValue: formatMinutes,
    rightMetricLabel: 'Session duration',
  },
  ai_usage_share: {
    metricKind: 'ai_usage_share',
    valueType: 'percentage',
    unit: '%',
    formatValue: formatPct,
    rightMetricLabel: 'AI-assisted session share',
  },
  repo_concentration: {
    metricKind: 'repo_concentration',
    valueType: 'index',
    unit: '',
    formatValue: (v: number) => v.toFixed(2),
    rightMetricLabel: 'Repo concentration (HHI)',
  },
};

// ── Helper: build customer-language title ────────────────────────────────

function buildTitle(
  dimension: MetricDimension,
  workflowName: string,
  recentValue: number,
  priorValue: number,
  deltaPct: number,
  windows: ComparisonWindows,
  isOrgWide: boolean,
): string {
  const direction = deltaPct > 0 ? 'increased' : 'decreased';
  const periodLabel = `over ${windows.recentLabel}`;

  switch (dimension) {
    case 'session_volume': {
      if (isOrgWide) {
        return `Session volume ${direction} ${formatDeltaPct(deltaPct)} ${periodLabel}`;
      }
      return `${workflowName} session volume ${direction} ${formatDeltaPct(deltaPct)} ${periodLabel}`;
    }

    case 'session_share': {
      return `${workflowName}'s share of sessions ${direction === 'increased' ? 'grew' : 'fell'} from ${formatPct(priorValue)} to ${formatPct(recentValue)} ${periodLabel}`;
    }

    case 'active_coding': {
      const deltaMin = recentValue - priorValue;
      return `${workflowName} active coding per session ${direction === 'increased' ? 'rose' : 'fell'} ${formatDeltaMinutes(deltaMin)} ${periodLabel}`;
    }

    case 'agent_runtime': {
      const deltaMin = recentValue - priorValue;
      const multiplier = priorValue > 0 ? recentValue / priorValue : 0;
      if (multiplier >= 2 && deltaPct > 0) {
        return `${workflowName} runtime per session rose sharply ${periodLabel}`;
      }
      if (multiplier <= 0.5 && deltaPct < 0) {
        return `${workflowName} runtime per session fell sharply ${periodLabel}`;
      }
      return `${workflowName} runtime per session ${direction === 'increased' ? 'rose' : 'fell'} ${formatDeltaMinutes(deltaMin)} ${periodLabel}`;
    }

    case 'session_duration': {
      const deltaMin = recentValue - priorValue;
      return `${workflowName} session length per session ${direction === 'increased' ? 'rose' : 'fell'} ${formatDeltaMinutes(deltaMin)} ${periodLabel}`;
    }

    case 'ai_usage_share': {
      const deltaPP = Math.round(Math.abs(recentValue - priorValue) * 100);
      return `AI-assisted session share in ${workflowName} ${direction === 'increased' ? 'rose' : 'fell'} ${deltaPP} percentage points ${periodLabel}`;
    }

    case 'repo_concentration': {
      const deltaPP = Math.round(Math.abs(recentValue - priorValue) * 100);
      if (deltaPct > 0) {
        return `Work shifted toward fewer repos ${periodLabel} (${deltaPP} percentage points more concentrated)`;
      }
      return `Work spread across more repos ${periodLabel} (${deltaPP} percentage points less concentrated)`;
    }

    default:
      return `Recent change detected in ${workflowName} ${periodLabel}`;
  }
}

// ── Helper: build recommendation ──────────────────────────────────────────

function buildRecommendation(
  dimension: MetricDimension,
  workflowName: string,
  deltaPct: number,
  isOrgWide: boolean,
): string {
  switch (dimension) {
    case 'session_volume':
      if (deltaPct > 0) {
        return isOrgWide
          ? 'Check whether a new project phase, onboarding, or tool rollout is driving the increase.'
          : `Check whether ${workflowName} adoption changed — new developers, new project phase, or tool rollout.`;
      }
      return isOrgWide
        ? 'Check whether a project milestone, holiday, or tool issue reduced session activity.'
        : `Check whether ${workflowName} usage dropped from a tool issue, project milestone, or team change.`;

    case 'session_share':
      return `Compare task and repo mix to understand whether ${workflowName} adoption genuinely shifted or work moved to different repos.`;

    case 'active_coding':
      return deltaPct > 0
        ? `Check whether ${workflowName} sessions involved larger tasks or different repo mix that required more active coding.`
        : `Check whether ${workflowName} sessions shifted to smaller tasks, more review, or different repos.`;

    case 'agent_runtime':
      return deltaPct > 0
        ? `Check whether ${workflowName} sessions involved larger tasks. Longer agent runtimes may correlate with bigger changes.`
        : `Check whether ${workflowName} sessions involved smaller or more incremental tasks.`;

    case 'session_duration':
      return deltaPct > 0
        ? `Check whether longer ${workflowName} sessions reflect larger tasks, more complex repos, or context-switching overhead.`
        : `Check whether shorter ${workflowName} sessions reflect smaller tasks or more focused work.`;

    case 'ai_usage_share':
      return deltaPct > 0
        ? `Check whether ${workflowName} AI-assisted sessions expanded to more developers or task types.`
        : `Check whether fewer ${workflowName} sessions showed AI-burst activity from tool issues, task changes, or developer turnover.`;

    case 'repo_concentration':
      return deltaPct > 0
        ? 'Determine whether repo concentration reflects planned work focus or an unintended dependency.'
        : 'Determine whether repo spread reflects planned diversification or loss of focus.';

    default:
      return 'Investigate the underlying cause of this change.';
  }
}

// ── Helper: materiality check ────────────────────────────────────────────

function isMaterial(
  dimension: MetricDimension,
  recentValue: number,
  priorValue: number,
  deltaPct: number,
): boolean {
  const isRatio = DIMENSIONS.find(d => d.dimension === dimension)?.isRatio ?? false;

  if (isRatio) {
    // Ratio metrics: ≥5pp absolute change
    const absPP = Math.abs(recentValue - priorValue) * 100;
    if (absPP < MIN_ABSOLUTE_CHANGE_PP) return false;
    // Also require relative change to avoid noise at very low baselines
    if (Math.abs(deltaPct) < MIN_RELATIVE_CHANGE_PCT) return false;
    return true;
  }

  // Absolute metrics: ≥20% relative change
  if (Math.abs(deltaPct) < MIN_RELATIVE_CHANGE_PCT) return false;

  // Duration metrics: also require ≥10 min absolute change
  if (dimension === 'active_coding' || dimension === 'agent_runtime' || dimension === 'session_duration') {
    const absMin = Math.abs(recentValue - priorValue);
    if (absMin < MIN_SESSION_DURATION_CHANGE_MIN) return false;
  }

  return true;
}

// ── Helper: compute delta percentage safely ──────────────────────────────

function computeDeltaPct(recent: number, prior: number): number {
  if (prior === 0) {
    // Zero-baseline: if recent is also ~0, no change. If recent > 0, infinite % — cap at 100%
    if (recent < 0.01) return 0;
    return 100;
  }
  return ((recent - prior) / Math.abs(prior)) * 100;
}

// ── Main generator ────────────────────────────────────────────────────────

/**
 * Generate recent-change temporal insights.
 *
 * Returns an array of CanonicalInsight instances (0 to MAX_FINDINGS).
 * Each instance has a deterministic ID: `recent-change__{dimension}__{workflow}`
 * For org-wide dimensions (no specific workflow), the ID is `recent-change__{dimension}__org`.
 */
export function generateRecentChangeInsights(input: CanonicalInsightInput): CanonicalInsight[] {
  const sessionRows = input.sessionRows || [];
  if (sessionRows.length === 0) return [];

  // CR-X FINAL: Use cached temporal windows when available
  const windows = input._engineCache?.temporalWindows !== undefined
    ? input._engineCache.temporalWindows
    : selectComparisonWindows(sessionRows);
  if (!windows) {
    piDebugLog('[RECENT_CHANGE]', 'Insufficient observed history for temporal comparison');
    return [];
  }

  // Sparse-window safety: check both windows have adequate data
  if (!isWindowAdequatelyPopulated(sessionRows, windows.recent, MIN_SESSIONS_PER_WINDOW)) {
    piDebugLog('[RECENT_CHANGE]', 'Recent window too sparse — no temporal comparison');
    return [];
  }
  if (!isWindowAdequatelyPopulated(sessionRows, windows.prior, MIN_SESSIONS_PER_WINDOW)) {
    piDebugLog('[RECENT_CHANGE]', 'Prior window too sparse — no temporal comparison');
    return [];
  }

  // CR-X FINAL: Use cached recent/prior rows when available
  const recentRows = input._engineCache?.recentRows?.length > 0
    ? input._engineCache.recentRows
    : sessionRows.filter(r => isInWindow(r, windows.recent));
  const priorRows = input._engineCache?.priorRows?.length > 0
    ? input._engineCache.priorRows
    : sessionRows.filter(r => isInWindow(r, windows.prior));

  const totalRecent = recentRows.length;
  const totalPrior = priorRows.length;

  // Get unique workflows — use cached workflow grouping when available
  const workflowSet = new Set<string>();
  if (input._engineCache?.sessionsByWorkflow) {
    for (const wf of Object.keys(input._engineCache.sessionsByWorkflow)) {
      workflowSet.add(wf);
    }
  } else {
    for (const r of sessionRows) {
      const tool = normalizeToCanonicalToolId(r.tool ?? r.session_source ?? '');
      if (tool && tool !== 'unknown') workflowSet.add(tool);
    }
  }

  // ── Candidate generation ──────────────────────────────────────────────

  interface Candidate {
    id: string;
    dimension: MetricDimension;
    workflow: string; // 'org' for org-wide
    workflowName: string;
    isOrgWide: boolean;
    recentValue: number;
    priorValue: number;
    deltaPct: number;
    recentN: number;
    priorN: number;
    title: string;
    recommendation: string;
    materialityScore: number;
  }

  const candidates: Candidate[] = [];

  // Org-wide dimensions (session_volume, repo_concentration)
  for (const dim of DIMENSIONS) {
    if (dim.dimension !== 'session_volume' && dim.dimension !== 'repo_concentration') continue;

    // For session_volume, normalize to sessions-per-day to handle unequal windows
    const recentDurationDays = dim.dimension === 'session_volume'
      ? (windows.recent.endMs - windows.recent.startMs) / DAY_MS : undefined
    const priorDurationDays = dim.dimension === 'session_volume'
      ? (windows.prior.endMs - windows.prior.startMs) / DAY_MS : undefined

    const recentResult = computeMetric(recentRows, dim.dimension, totalRecent, recentDurationDays);
    const priorResult = computeMetric(priorRows, dim.dimension, totalPrior, priorDurationDays);
    if (!recentResult || !priorResult) continue;
    if (recentResult.count < MIN_SESSIONS_PER_WINDOW || priorResult.count < MIN_SESSIONS_PER_WINDOW) continue;

    const deltaPct = computeDeltaPct(recentResult.value, priorResult.value);
    if (!isMaterial(dim.dimension, recentResult.value, priorResult.value, deltaPct)) continue;

    const id = `recent-change__${dim.dimension}__org`;
    const title = buildTitle(dim.dimension, '', recentResult.value, priorResult.value, deltaPct, windows, true);
    const recommendation = buildRecommendation(dim.dimension, '', deltaPct, true);

    candidates.push({
      id, dimension: dim.dimension, workflow: 'org', workflowName: '',
      isOrgWide: true,
      recentValue: recentResult.value, priorValue: priorResult.value, deltaPct,
      recentN: recentResult.count, priorN: priorResult.count,
      title, recommendation,
      materialityScore: Math.abs(deltaPct),
    });
  }

  // Per-workflow dimensions
  for (const toolId of workflowSet) {
    const isDelegated = isDelegatedAgentWorkflow(toolId);
    const isHuman = isHumanInteractiveWorkflow(toolId);
    const wfName = getWorkflowDisplayName(toolId);

    const wfRecent = recentRows.filter(r => normalizeToCanonicalToolId(r.tool ?? r.session_source ?? '') === toolId);
    const wfPrior = priorRows.filter(r => normalizeToCanonicalToolId(r.tool ?? r.session_source ?? '') === toolId);

    for (const dim of DIMENSIONS) {
      // Mode-aware dimension filtering
      if (dim.appliesTo === 'human_interactive' && !isHuman) continue;
      if (dim.appliesTo === 'delegated_agent' && !isDelegated) continue;

      // Skip org-wide dimensions here (handled above)
      if (dim.dimension === 'session_volume' || dim.dimension === 'repo_concentration') continue;

      // Delegated-agent duplicate suppression:
      // For delegated agents, agent_runtime and session_duration both use
      // session_duration_minutes as the underlying metric. They represent
      // the same movement. agent_runtime is the customer-facing semantic
      // authority. Suppress session_duration for delegated agents.
      if (isDelegated && dim.dimension === 'session_duration') continue;

      const recentResult = computeMetric(wfRecent, dim.dimension, totalRecent);
      const priorResult = computeMetric(wfPrior, dim.dimension, totalPrior);
      if (!recentResult || !priorResult) continue;

      // Per-workflow minimum sample
      if (recentResult.count < MIN_SESSIONS_PER_WINDOW_WORKFLOW || priorResult.count < MIN_SESSIONS_PER_WINDOW_WORKFLOW) continue;

      const deltaPct = computeDeltaPct(recentResult.value, priorResult.value);
      if (!isMaterial(dim.dimension, recentResult.value, priorResult.value, deltaPct)) continue;

      const id = `recent-change__${dim.dimension}__${toolId}`;
      const title = buildTitle(dim.dimension, wfName, recentResult.value, priorResult.value, deltaPct, windows, false);
      const recommendation = buildRecommendation(dim.dimension, wfName, deltaPct, false);

      candidates.push({
        id, dimension: dim.dimension, workflow: toolId, workflowName: wfName,
        isOrgWide: false,
        recentValue: recentResult.value, priorValue: priorResult.value, deltaPct,
        recentN: recentResult.count, priorN: priorResult.count,
        title, recommendation,
        materialityScore: Math.abs(deltaPct),
      });
    }
  }

  // ── Selection: materiality-rank and emit bounded portfolio ────────────

  // Sort by materiality score (descending)
  candidates.sort((a, b) => b.materialityScore - a.materialityScore);

  // Deduplicate by ID (deterministic — same dimension+workflow = same ID)
  const seenIds = new Set<string>();
  const selected: Candidate[] = [];
  for (const c of candidates) {
    if (seenIds.has(c.id)) continue;
    seenIds.add(c.id);
    selected.push(c);
    if (selected.length >= MAX_FINDINGS) break;
  }

  // ── Build CanonicalInsight objects ────────────────────────────────────

  const registryEntry = getCanonicalPIById('recent-change');
  if (!registryEntry) {
    piDebugLog('[RECENT_CHANGE]', 'recent-change not found in canonical registry');
    return [];
  }

  return selected.map(c => {
    const mp = METRIC_PRESENTATION[c.dimension];
    const displayValue = mp.formatValue(c.recentValue);
    const priorDisplay = mp.formatValue(c.priorValue);

    const description = `Recent: ${displayValue} (N=${c.recentN}) vs prior: ${priorDisplay} (N=${c.priorN}). Comparison: ${windows.label}. Observed history: ${windows.historyDays} days. This is an observational comparison and may be confounded by workflow, task, or repo mix changes.`;

    return {
      id: c.id,
      // CR-X FINAL: Explicit storyKey for session_share findings.
      // When the executive-workflow-mix-synthesis finding passes evidence
      // gates, it shares this key and suppresses these component mirror
      // cards from rendered findings. The numbers remain in the synthesis.
      storyKey: c.dimension === 'session_share' ? `workflow-mix:${windows.label}` : undefined,
      title: c.title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only' as const,
      presentationKind: 'temporal_trend' as const,
      comparisonMode: 'trend' as const,
      comparisonState: 'workflow_comparable' as const,
      current: c.recentValue,
      baseline: c.priorValue,
      delta: c.recentValue - c.priorValue,
      deltaPct: c.deltaPct,
      displayValue,
      displayDeltaPct: `${c.deltaPct > 0 ? '+' : ''}${Math.round(c.deltaPct)}%`,
      polarity: 'neutral' as const,
      confidence: c.recentN >= 20 && c.priorN >= 20 ? 'high' : c.recentN >= 10 && c.priorN >= 10 ? 'medium' : 'low',
      coveragePct: Math.round((c.recentN + c.priorN) / (totalRecent + totalPrior) * 100),
      n: c.recentN + c.priorN,
      hasData: true,
      description,
      recommendation: c.recommendation,
      executiveSummary: c.title,
      evidence: [
        { metric: mp.rightMetricLabel, value: displayValue, label: windows.recentLabel, context: `N=${c.recentN}` },
        { metric: mp.rightMetricLabel, value: priorDisplay, label: windows.priorLabel, context: `N=${c.priorN}` },
        { metric: 'comparison window', value: windows.label },
      ],
      isExecutiveFinding: false,
      dataSource: 'live' as const,
      whatChanged: c.title,
      whyItMatters: c.recommendation,
      evidenceAndContext: description,
      urgencyLabel: Math.abs(c.deltaPct) >= 50 ? 'investigate' : 'monitor' as const,
      recommendationState: Math.abs(c.deltaPct) >= 50 ? 'investigate' : 'monitor_only' as const,
      lifecycleClass: 'decision' as const,
      generatorSource: 'generateRecentChangeInsights',
      engineVersion: 'FINAL_ENGINE_V1' as const,
      featureFlagState: true,
      // ── Metric presentation contract ──────────────────────────────────
      // Explicit contract so the renderer never guesses units or labels.
      metricKind: mp.metricKind,
      valueType: mp.valueType,
      unit: mp.unit,
      rightMetricLabel: mp.rightMetricLabel,
      priorValue: c.priorValue,
      recentValue: c.recentValue,
      priorDisplay,
      recentDisplay: displayValue,
      absoluteDelta: c.recentValue - c.priorValue,
      priorSample: c.priorN,
      recentSample: c.recentN,
      priorWindow: windows.priorLabel,
      recentWindow: windows.recentLabel,
      observedThroughMs: windows.observedThroughMs,
    } as CanonicalInsight;
  });
}
