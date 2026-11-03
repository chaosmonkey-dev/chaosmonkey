/**
 * CR-X Wave 1A — Multi-Dimensional Analysis Families
 *
 * Four additive analysis families that cross dimensions the existing
 * generator-per-metric architecture does not cross:
 *
 * 1. Repo-Conditioned Behavior (W × R × B)
 *    "Does the same workflow behave differently depending on where it is used?"
 *
 * 2. Workflow × Repo Allocation (W × R)
 *    "Where are different workflows actually being used?"
 *
 * 3. Within-Workflow Temporal Behavior (W × B × T)
 *    "What changed in how this workflow is being used?"
 *    (Focuses on observed commits/session and TTFC — active_coding/runtime
 *    temporal change is already handled by generateRecentChangeInsights.)
 *
 * 4. Workflow × Repo Allocation Shift (W × R × T)
 *    "Has where we use this workflow changed?"
 *
 * CONTRACT:
 * - All families consume CanonicalInsightInput only (no direct SQLite/API access)
 * - All findings emit into the SAME downstream canonical PI pipeline
 * - Mode-aware: delegated agents use runtime, human-interactive uses active-coding
 * - Provenance-aware: observed commits/TTFC only, fail-closed on unsupported attribution
 * - Materiality-gated: no findings for immaterial differences
 * - Customer language from birth
 * - No causal language
 */

import type { CanonicalInsightInput, CanonicalInsight } from '../types';
import { getCanonicalPIById } from '../canonicalInsights';
import { piDebugLog } from '../utils/logging';
import { getWorkflowDisplayName, normalizeToCanonicalToolId } from '../../../workflowIdentity';
import { isDelegatedAgentWorkflow, isHumanInteractiveWorkflow } from '../../../surfaceAgentContract';
import { normalizeRepoUrl, isRenderableRepoLabel, repoDisplayLabel } from '../../../repoNormalization';
import {
  selectComparisonWindows,
  isInWindow,
  isWindowAdequatelyPopulated,
} from '../helpers/temporalWindows';

// ── Shared helpers ────────────────────────────────────────────────────────

// CR-X FINAL: workflow display name is centralized in workflowIdentity.ts.

function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const hrs = Math.floor(min / 60);
  const mins = Math.round(min % 60);
  return mins === 0 ? `${hrs}h` : `${hrs}h${mins}m`;
}

function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function repoDisplayName(canonicalRepo: string): string {
  // Customer-facing rule: display the canonical owner/repo identity
  // everywhere (titles, evidence, charts, cards). Short last-segment labels
  // caused the same repo to render as both "am-sim" and
  // "angrymonkeyparty/am-sim" on different surfaces. If a raw URL slips
  // through un-normalized, collapse it to owner/repo before display.
  // Internal source prefixes ('azure:org/repo') are stripped for display.
  const normalized = normalizeRepoUrl(canonicalRepo);
  return repoDisplayLabel(normalized ?? canonicalRepo);
}

function computeDeltaPct(recent: number, prior: number): number {
  if (prior === 0) {
    if (recent < 0.01) return 0;
    return 100;
  }
  return ((recent - prior) / Math.abs(prior)) * 100;
}

/**
 * Minimum measured baseline for a meaningful multiplicative comparison.
 * Below this, a "ratio" would be division by a fabricated denominator —
 * e.g. 1,389.4× where the observed baseline is literally 0.0. Such
 * comparisons must render as absolute comparisons instead.
 */
const ZERO_BASELINE_EPSILON = 0.001;

/**
 * Multiplicative ratio only when the baseline supports one.
 * Returns null for zero or near-zero baselines so callers render an
 * absolute comparison / unavailable-ratio state rather than a
 * false-precision multiplier.
 */
function meaningfulRatio(high: number, low: number): number | null {
  if (!(low >= ZERO_BASELINE_EPSILON)) return null;
  return high / low;
}

interface WorkflowSession {
  toolId: string;
  rows: any[];
}

function partitionByWorkflow(sessionRows: any[], cache?: any): WorkflowSession[] {
  // CR-X FINAL: Use cached workflow grouping when available
  if (cache?.sessionsByWorkflow) {
    return Object.entries(cache.sessionsByWorkflow).map(([toolId, rows]) => ({ toolId, rows } as any));
  }
  const wfMap = new Map<string, any[]>();
  for (const r of sessionRows) {
    const toolId = normalizeToCanonicalToolId(r.tool ?? r.session_source ?? '');
    if (!toolId || toolId === 'unknown') continue;
    if (!wfMap.has(toolId)) wfMap.set(toolId, []);
    wfMap.get(toolId)!.push(r);
  }
  return Array.from(wfMap.entries()).map(([toolId, rows]) => ({ toolId, rows }));
}

function partitionByRepo(rows: any[]): Map<string, any[]> {
  const repoMap = new Map<string, any[]>();
  for (const r of rows) {
    const repo = normalizeRepoUrl(r.git_repo_url);
    if (!repo || !isRenderableRepoLabel(repo)) continue;
    if (!repoMap.has(repo)) repoMap.set(repo, []);
    repoMap.get(repo)!.push(r);
  }
  return repoMap;
}

// ── Metric computation ────────────────────────────────────────────────────

interface MetricResult {
  value: number;
  count: number;
}

function computeActiveCodingMinutes(rows: any[]): MetricResult | null {
  const vals = rows
    .map(r => r.session_active_coding_duration_minutes)
    .filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (vals.length === 0) return null;
  return { value: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length };
}

function computeRuntimeMinutes(rows: any[]): MetricResult | null {
  const vals = rows
    .map(r => r.session_duration_minutes)
    .filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (vals.length === 0) return null;
  return { value: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length };
}

function computeObservedCommitsPerSession(rows: any[]): MetricResult | null {
  const observed = rows.filter(r => r.session_commits_source === 'observed');
  if (observed.length === 0) return null;
  const vals = observed
    .map(r => r.session_commits)
    .filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (vals.length === 0) return null;
  return { value: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length };
}

function computeObservedTTFCMinutes(rows: any[]): MetricResult | null {
  const observed = rows.filter(r => r.ttfc_source === 'observed');
  if (observed.length === 0) return null;
  const vals = observed
    .map(r => r.time_to_first_commit_ms)
    .filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0)
    .map(v => v / 60000);
  if (vals.length === 0) return null;
  return { value: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length };
}

function computeAiBurstPerSession(rows: any[]): MetricResult | null {
  const vals = rows
    .map(r => r.ai_burst_count)
    .filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (vals.length === 0) return null;
  return { value: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length };
}

// ── Mode-aware metric selection ───────────────────────────────────────────

type BehaviorMetric =
  | 'active_coding'
  | 'agent_runtime'
  | 'commits_per_session'
  | 'ttfc'
  | 'ai_burst';

interface MetricDef {
  metric: BehaviorMetric;
  label: string;
  appliesTo: 'human_interactive' | 'delegated_agent' | 'all';
  compute: (rows: any[]) => MetricResult | null;
  formatValue: (v: number) => string;
  polarity: 'higher_is_better' | 'lower_is_better' | 'neutral';
}

const METRIC_DEFS: MetricDef[] = [
  {
    metric: 'active_coding',
    label: 'active coding per session',
    appliesTo: 'human_interactive',
    compute: computeActiveCodingMinutes,
    formatValue: formatMinutes,
    polarity: 'neutral',
  },
  {
    metric: 'agent_runtime',
    label: 'runtime per session',
    appliesTo: 'delegated_agent',
    compute: computeRuntimeMinutes,
    formatValue: formatMinutes,
    polarity: 'neutral',
  },
  {
    metric: 'commits_per_session',
    label: 'commits per session',
    appliesTo: 'all',
    compute: computeObservedCommitsPerSession,
    formatValue: v => v.toFixed(1),
    polarity: 'higher_is_better',
  },
  {
    metric: 'ttfc',
    label: 'time to first commit',
    appliesTo: 'all',
    compute: computeObservedTTFCMinutes,
    formatValue: formatMinutes,
    polarity: 'lower_is_better',
  },
  {
    metric: 'ai_burst',
    label: 'AI bursts per session',
    appliesTo: 'all',
    compute: computeAiBurstPerSession,
    formatValue: v => v.toFixed(1),
    polarity: 'neutral',
  },
];

function metricsForWorkflow(toolId: string): MetricDef[] {
  const isDelegated = isDelegatedAgentWorkflow(toolId);
  const isHuman = isHumanInteractiveWorkflow(toolId);
  return METRIC_DEFS.filter(m => {
    if (m.appliesTo === 'human_interactive') return isHuman;
    if (m.appliesTo === 'delegated_agent') return isDelegated;
    return true;
  });
}

// Derive renderer-facing value type + unit for a behavior metric.
function metricValueType(metric: BehaviorMetric): { valueType: string; unit: string } {
  if (metric === 'active_coding' || metric === 'agent_runtime' || metric === 'ttfc') {
    return { valueType: 'duration_minutes', unit: 'min' };
  }
  // commits_per_session + ai_burst are dimensionless rates
  return { valueType: 'rate', unit: '' };
}

const ALLOCATION_VALUE_TYPE = { valueType: 'percentage', unit: '%' };

// ── Thresholds ────────────────────────────────────────────────────────────

const MIN_SESSIONS_PER_WORKFLOW = 30;
const MIN_SESSIONS_PER_REPO = 15;
const MIN_RELATIVE_DIFF_PCT = 30;
const MIN_RATIO = 1.5;
const MIN_SESSIONS_PER_WINDOW_TEMPORAL = 5;
const MIN_TEMPORAL_CHANGE_PCT = 20;
const MIN_TEMPORAL_TTFC_CHANGE_MIN = 5;
const MIN_ALLOCATION_SHIFT_PP = 15;
const MAX_FINDINGS_PER_FAMILY = 3;

// ── Family 1: Repo-Conditioned Behavior (W × R × B) ──────────────────────

function generateRepoConditionedBehavior(input: CanonicalInsightInput): CanonicalInsight[] {
  const sessionRows = input.sessionRows || [];
  if (sessionRows.length === 0) return [];

  const registryEntry = getCanonicalPIById('repo-conditioned-behavior');
  if (!registryEntry) return [];

  const workflows = partitionByWorkflow(sessionRows, input._engineCache);
  const findings: CanonicalInsight[] = [];

  for (const wf of workflows) {
    if (wf.rows.length < MIN_SESSIONS_PER_WORKFLOW) continue;

    const repoMap = partitionByRepo(wf.rows);
    // Need at least 2 repos with sufficient sample
    const qualifyingRepos: Array<{ repo: string; rows: any[] }> = [];
    for (const [repo, rows] of repoMap) {
      if (rows.length >= MIN_SESSIONS_PER_REPO) {
        qualifyingRepos.push({ repo, rows });
      }
    }
    if (qualifyingRepos.length < 2) continue;

    const wfName = getWorkflowDisplayName(wf.toolId);
    const applicableMetrics = metricsForWorkflow(wf.toolId);

    for (const metricDef of applicableMetrics) {
      // Compute metric for each qualifying repo
      const repoMetrics: Array<{ repo: string; result: MetricResult }> = [];
      for (const qr of qualifyingRepos) {
        const result = metricDef.compute(qr.rows);
        if (result && result.count >= 5) {
          repoMetrics.push({ repo: qr.repo, result });
        }
      }
      if (repoMetrics.length < 2) continue;

      // Find the most material difference
      repoMetrics.sort((a, b) => b.result.value - a.result.value);
      const highest = repoMetrics[0];
      const lowest = repoMetrics[repoMetrics.length - 1];

      const ratio = meaningfulRatio(highest.result.value, lowest.result.value);
      const deltaPct = computeDeltaPct(highest.result.value, lowest.result.value);

      // Zero-baseline comparisons remain eligible via deltaPct — they render
      // an absolute comparison instead of a fabricated multiplier.
      if ((ratio === null || ratio < MIN_RATIO) && Math.abs(deltaPct) < MIN_RELATIVE_DIFF_PCT) continue;

      const highRepoLabel = repoDisplayName(highest.repo);
      const lowRepoLabel = repoDisplayName(lowest.repo);
      // Fail closed: if either repo identity cannot render a real label,
      // suppress this candidate rather than emit "concentrated in  while…"
      // malformed prose. Repo evidence is required for this finding.
      if (!isRenderableRepoLabel(highRepoLabel) || !isRenderableRepoLabel(lowRepoLabel)) continue;
      const highVal = metricDef.formatValue(highest.result.value);
      const lowVal = metricDef.formatValue(lowest.result.value);

      // Customer-language conclusion titles (not database queries)
      const intensity = ratio === null
        ? 'materially more active'
        : ratio >= 3
          ? 'far more active'
          : ratio >= MIN_RATIO
            ? 'substantially more active'
            : 'more active';
      let title: string;
      switch (metricDef.metric) {
        case 'active_coding':
          title = `${wfName} sessions are ${intensity} in ${highRepoLabel} than ${lowRepoLabel} (${highVal} vs ${lowVal}/session)`;
          break;
        case 'commits_per_session':
          title = `${wfName} commits more frequently in ${highRepoLabel} than ${lowRepoLabel} (${highVal} vs ${lowVal} commits/session)`;
          break;
        case 'ttfc':
          title = `${wfName} reaches first commit faster in ${highRepoLabel} than ${lowRepoLabel} (${highVal} vs ${lowVal})`;
          break;
        case 'agent_runtime':
          title = `${wfName} runs longer per session in ${highRepoLabel} than ${lowRepoLabel} (${highVal} vs ${lowVal})`;
          break;
        case 'ai_burst':
          title = `${wfName} uses AI bursts more frequently in ${highRepoLabel} than ${lowRepoLabel} (${highVal} vs ${lowVal}/session)`;
          break;
        default:
          title = `${wfName} ${metricDef.label} differs materially across repos (${highRepoLabel} ${highVal} vs ${lowRepoLabel} ${lowVal})`;
          break;
      }

      const description = `${wfName} shows ${highVal} ${metricDef.label} in ${highRepoLabel} (N=${highest.result.count}) vs ${lowVal} in ${lowRepoLabel} (N=${lowest.result.count}). This is an observational comparison across repositories and may reflect differences in task complexity, codebase size, or team practices rather than tool behavior.`;

      const recommendation = `Investigate whether ${wfName} is being used for different types of work in ${highRepoLabel} vs ${lowRepoLabel}. Differences may reflect task complexity, codebase familiarity, or repo-specific practices rather than tool performance.`;

      const id = `repo-conditioned-behavior__${wf.toolId}__${metricDef.metric}`;

      const { valueType, unit } = metricValueType(metricDef.metric);

      findings.push({
        id,
        title,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        presentationKind: 'repo_conditioned_behavior',
        comparisonMode: 'absolute',
        comparisonState: 'workflow_comparable',
        current: highest.result.value,
        baseline: lowest.result.value,
        delta: highest.result.value - lowest.result.value,
        deltaPct,
        displayValue: highVal,
        displayDeltaPct: `${deltaPct > 0 ? '+' : ''}${Math.round(deltaPct)}%`,
        polarity: metricDef.polarity,
        confidence: highest.result.count >= 20 && lowest.result.count >= 20 ? 'high' : 'medium',
        n: highest.result.count + lowest.result.count,
        hasData: true,
        description,
        recommendation,
        executiveSummary: title,
        metricKind: metricDef.metric,
        valueType,
        unit,
        evidence: [
          { metric: metricDef.label, value: highVal, label: highRepoLabel, context: `N=${highest.result.count}` },
          { metric: metricDef.label, value: lowVal, label: lowRepoLabel, context: `N=${lowest.result.count}` },
          ratio !== null
            ? { metric: 'ratio', value: `${ratio.toFixed(1)}x` }
            : { metric: 'ratio', value: 'n/a — zero baseline' },
          { metric: 'qualifying repos', value: repoMetrics.length },
        ],
        isExecutiveFinding: false,
        dataSource: 'live',
        whatChanged: title,
        whyItMatters: `The same workflow produces materially different ${metricDef.label} depending on the repository. This may indicate different task types, codebase complexity, or team practices across repos.`,
        evidenceAndContext: description,
        urgencyLabel: 'investigate',
        recommendationState: 'investigate',
        lifecycleClass: 'decision',
        generatorSource: 'generateRepoConditionedBehavior',
        engineVersion: 'FINAL_ENGINE_V1',
        featureFlagState: true,
      } as CanonicalInsight);
    }
  }

  // Sort by materiality and bound
  findings.sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));
  return findings.slice(0, MAX_FINDINGS_PER_FAMILY);
}

// ── Family 2: Workflow × Repo Allocation (W × R) ─────────────────────────

function generateWorkflowRepoAllocation(input: CanonicalInsightInput): CanonicalInsight[] {
  const sessionRows = input.sessionRows || [];
  if (sessionRows.length === 0) return [];

  const registryEntry = getCanonicalPIById('workflow-repo-allocation');
  if (!registryEntry) return [];

  const workflows = partitionByWorkflow(sessionRows, input._engineCache);
  if (workflows.length < 2) return [];

  // Build repo share distribution per workflow
  interface WfAllocation {
    toolId: string;
    wfName: string;
    totalSessions: number;
    repoShares: Map<string, number>; // repo -> share (0-1)
    topRepo: string;
    topRepoShare: number;
    repoCount: number;
  }

  const allocations: WfAllocation[] = [];
  for (const wf of workflows) {
    if (wf.rows.length < MIN_SESSIONS_PER_WORKFLOW) continue;
    const repoMap = partitionByRepo(wf.rows);
    // A workflow with 0 repos (no git_repo_url) is not useful for allocation
    // comparison. A workflow with 1 repo is valid — it represents 100%
    // concentration, which is a meaningful allocation pattern when contrasted
    // with another workflow that uses a different single repo (disjoint case).
    if (repoMap.size < 1) continue;

    const total = wf.rows.length;
    const repoShares = new Map<string, number>();
    let topRepo = '';
    let topShare = 0;
    for (const [repo, rows] of repoMap) {
      const share = rows.length / total;
      repoShares.set(repo, share);
      if (share > topShare) {
        topShare = share;
        topRepo = repo;
      }
    }
    allocations.push({
      toolId: wf.toolId,
      wfName: getWorkflowDisplayName(wf.toolId),
      totalSessions: total,
      repoShares,
      topRepo,
      topRepoShare: topShare,
      repoCount: repoMap.size,
    });
  }

  if (allocations.length < 2) return [];

  // CR-X P1 STORY-LEVEL CONSOLIDATION:
  // Instead of emitting N pairwise findings when one workflow is more
  // concentrated than multiple others in the same dominant repo, synthesize
  // ONE multi-workflow finding containing all workflows in its evidence.
  // "ONE MATERIAL EXECUTIVE QUESTION / FACT = ONE CARD."
  //
  // Group pairwise candidates by (dominant repo, most-concentrated workflow).
  // If a group has >=2 pairs (same workflow more concentrated than >=2 others
  // in the same repo), synthesize one multi-workflow concentration finding.
  // Single-pair groups and different-dominant-repo/disjoint pairs remain as
  // standalone pairwise findings -- they describe genuinely different stories.

  interface PairwiseCandidate {
    a: WfAllocation;
    b: WfAllocation;
    isDisjoint: boolean;
    sameDominantRepo: boolean;
    concentrationGapPP: number;
    allocationSubtype: 'same_dominant_repo' | 'different_dominant_repo' | 'disjoint';
    title: string;
    description: string;
    whyItMatters: string;
    recommendation: string;
  }

  const pairwiseCandidates: PairwiseCandidate[] = [];
  for (let i = 0; i < allocations.length; i++) {
    for (let j = i + 1; j < allocations.length; j++) {
      const a = allocations[i];
      const b = allocations[j];

      const aRepos = new Set(a.repoShares.keys());
      const bRepos = new Set(b.repoShares.keys());
      const sharedRepos = [...aRepos].filter(r => bRepos.has(r)).length;
      const isDisjoint = sharedRepos === 0;

      const aTopLabel = repoDisplayName(a.topRepo);
      const bTopLabel = repoDisplayName(b.topRepo);
      // Fail closed: a pairwise repo-allocation finding requires renderable
      // repo identities for both workflows. Blank/placeholder labels produce
      // malformed prose ("concentrated in  while…") — suppress instead.
      if (!isRenderableRepoLabel(aTopLabel) || !isRenderableRepoLabel(bTopLabel)) continue;
      const sameDominantRepo = a.topRepo === b.topRepo;
      const concentrationGapPP = Math.round(Math.abs(a.topRepoShare - b.topRepoShare) * 100);

      if (!isDisjoint && sameDominantRepo && concentrationGapPP < 20) continue;

      let title: string;
      let allocationSubtype: 'same_dominant_repo' | 'different_dominant_repo' | 'disjoint';
      if (isDisjoint) {
        allocationSubtype = 'disjoint';
        title = `${a.wfName} and ${b.wfName} are used on entirely different repositories`;
      } else if (sameDominantRepo) {
        allocationSubtype = 'same_dominant_repo';
        const more = a.topRepoShare >= b.topRepoShare ? a : b;
        const less = a.topRepoShare >= b.topRepoShare ? b : a;
        title = `${more.wfName} is substantially more concentrated in ${aTopLabel} than ${less.wfName} (${formatPct(more.topRepoShare)} vs ${formatPct(less.topRepoShare)})`;
      } else {
        allocationSubtype = 'different_dominant_repo';
        title = `${a.wfName} is concentrated in ${aTopLabel} while ${b.wfName} is concentrated in ${bTopLabel}`;
      }

      let description: string;
      let whyItMatters: string;
      if (allocationSubtype === 'same_dominant_repo') {
        description = `Both ${a.wfName} and ${b.wfName} are concentrated in ${aTopLabel}, but ${a.topRepoShare >= b.topRepoShare ? a.wfName : b.wfName} is materially more concentrated there (${formatPct(Math.max(a.topRepoShare, b.topRepoShare))} vs ${formatPct(Math.min(a.topRepoShare, b.topRepoShare))}, ${concentrationGapPP}pp gap). Shared repos: ${sharedRepos}. This is an observational comparison of where different tools are being used.`;
        whyItMatters = `Both workflows share the same dominant repository (${aTopLabel}), but one is materially more concentrated there. This may reflect different task types, team preferences, or tool suitability within the same codebase.`;
      } else if (allocationSubtype === 'disjoint') {
        description = `${a.wfName} sessions: ${a.totalSessions} across ${a.repoCount} repos, top repo ${aTopLabel} at ${formatPct(a.topRepoShare)}. ${b.wfName} sessions: ${b.totalSessions} across ${b.repoCount} repos, top repo ${bTopLabel} at ${formatPct(b.topRepoShare)}. These workflows have no shared repositories. This is an observational comparison of where different tools are being used.`;
        whyItMatters = `These workflows are used on entirely different repositories. This may reflect intentional tool-task alignment or unintentional access/training gaps.`;
      } else {
        description = `${a.wfName} sessions: ${a.totalSessions} across ${a.repoCount} repos, top repo ${aTopLabel} at ${formatPct(a.topRepoShare)}. ${b.wfName} sessions: ${b.totalSessions} across ${b.repoCount} repos, top repo ${bTopLabel} at ${formatPct(b.topRepoShare)}. Shared repos: ${sharedRepos}. This is an observational comparison of where different tools are being used.`;
        whyItMatters = `Different workflows are concentrated in different repositories. This may reflect intentional tool-task alignment or unintentional access/training gaps.`;
      }

      const recommendation = `Investigate whether this allocation is intentional — different tools may be suited for different types of work (e.g., agent tools for backend, IDE tools for frontend). If unintentional, check whether tool access or training gaps are driving the separation.`;

      pairwiseCandidates.push({
        a, b, isDisjoint, sameDominantRepo, concentrationGapPP,
        allocationSubtype, title, description, whyItMatters, recommendation,
      });
    }
  }

  // Group same_dominant_repo candidates by dominant repo ONLY.
  // CR-X P1: When multiple workflows are each "most concentrated" in the same
  // dominant repo, they must produce ONE synthesis, not one per workflow.
  const synthesisGroups = new Map<string, PairwiseCandidate[]>();
  const standaloneCandidates: PairwiseCandidate[] = [];

  for (const cand of pairwiseCandidates) {
    if (cand.allocationSubtype !== 'same_dominant_repo') {
      standaloneCandidates.push(cand);
      continue;
    }
    // Group by dominant repo only — all pairs with the same dominant repo
    // belong to the same synthesis group
    const groupKey = cand.a.topRepo;
    const group = synthesisGroups.get(groupKey) ?? [];
    group.push(cand);
    synthesisGroups.set(groupKey, group);
  }

  const findings: CanonicalInsight[] = [];

  // Emit synthesized multi-workflow concentration findings
  for (const [groupKey, group] of synthesisGroups) {
    if (group.length >= 2) {
      // SYNTHESIZE: one multi-workflow finding per dominant repo
      const dominantRepo = groupKey; // now just the repo (no ::toolId)
      const dominantRepoLabel = repoDisplayName(dominantRepo);
      // Fail closed: synthesis titles interpolate the dominant repo label.
      if (!isRenderableRepoLabel(dominantRepoLabel)) continue;

      // Collect ALL workflows that have sessions in this repo, sorted by concentration
      const workflowsInRepo = allocations
        .filter(a => a.repoShares.has(dominantRepo))
        .map(a => ({
          toolId: a.toolId,
          wfName: a.wfName,
          share: a.repoShares.get(dominantRepo)!,
          totalSessions: a.totalSessions,
          repoCount: a.repoCount,
        }))
        .sort((x, y) => y.share - x.share);

      const leader = workflowsInRepo[0];
      const runnerUp = workflowsInRepo[1];
      const maxGapPP = leader && runnerUp ? Math.round(Math.abs(leader.share - runnerUp.share) * 100) : 0;

      const title = `${leader.wfName} is much more concentrated in ${dominantRepoLabel} than the other observed workflows`;
      const description = `${leader.wfName} concentrates ${formatPct(leader.share)} of its sessions in ${dominantRepoLabel}, while ${workflowsInRepo.slice(1).map(w => `${w.wfName} (${formatPct(w.share)})`).join(', ')}. This is an observational comparison of where different tools are being used.`;
      const whyItMatters = `${leader.wfName} is materially more concentrated in ${dominantRepoLabel} than the other workflows. This may reflect different task types, team preferences, or tool suitability within the same codebase.`;
      const recommendation = `Investigate whether this concentration is intentional — different tools may be suited for different types of work. If unintentional, check whether tool access or training gaps are driving the separation.`;

      // Build breakdownByTool for horizontal comparison bars
      const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
      for (const w of workflowsInRepo) {
        breakdownByTool[w.wfName] = {
          value: Math.round(w.share * 1000) / 10,
          count: w.totalSessions,
          formatted: formatPct(w.share),
          label: `N=${w.totalSessions}`,
        };
      }

      const evidence = workflowsInRepo.map(w => ({
        metric: w.wfName,
        value: repoDisplayName(dominantRepo),
        label: formatPct(w.share),
        context: `${w.totalSessions} sessions`,
      }));
      evidence.push({
        metric: 'concentration gap',
        value: `${maxGapPP}pp`,
        label: 'gap',
        context: `${leader.wfName} vs ${runnerUp?.wfName ?? '—'}`,
      });

      const id = `workflow-repo-allocation__${leader.toolId}__concentration_synthesis`;

      findings.push({
        id,
        title,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        presentationKind: 'workflow_repo_allocation',
        comparisonMode: 'absolute',
        comparisonState: 'workflow_comparable',
        current: leader.share,
        baseline: runnerUp?.share ?? 0,
        delta: leader.share - (runnerUp?.share ?? 0),
        deltaPct: runnerUp ? computeDeltaPct(leader.share, runnerUp.share) : 0,
        displayValue: formatPct(leader.share),
        polarity: 'neutral',
        confidence: workflowsInRepo.every(w => w.totalSessions >= 50) ? 'high' : 'medium',
        n: workflowsInRepo.reduce((sum, w) => sum + w.totalSessions, 0),
        hasData: true,
        description,
        recommendation,
        executiveSummary: title,
        metricKind: 'allocation_share',
        valueType: ALLOCATION_VALUE_TYPE.valueType,
        unit: ALLOCATION_VALUE_TYPE.unit,
        evidence,
        breakdownByTool,
        selectedComparison: {
          leaderKey: leader.wfName,
          baselineKey: runnerUp?.wfName ?? leader.wfName,
        },
        isExecutiveFinding: false,
        dataSource: 'live',
        whatChanged: title,
        whyItMatters,
        allocationSubtype: 'same_dominant_repo',
        allocationSynthesis: true,
        dominantRepo: repoDisplayName(dominantRepo),
        dominantRepoCanonical: dominantRepo,
        synthesizedWorkflows: workflowsInRepo.map(w => w.toolId),
        evidenceAndContext: description,
        urgencyLabel: 'investigate',
        recommendationState: 'investigate',
        lifecycleClass: 'decision',
        generatorSource: 'generateWorkflowRepoAllocation',
        engineVersion: 'FINAL_ENGINE_V1',
        featureFlagState: true,
      } as CanonicalInsight);

      piDebugLog('[MULTI_DIMENSIONAL][ALLOCATION_SYNTHESIS]', {
        dominantRepo,
        mostConcentrated: leader.toolId,
        workflowsInSynthesis: workflowsInRepo.length,
        suppressedPairs: group.length,
      });
    } else {
      standaloneCandidates.push(group[0]);
    }
  }

  // Emit standalone pairwise findings (different-dominant-repo, disjoint, or single same-repo pair)
  for (const cand of standaloneCandidates) {
    const { a, b } = cand;
    const id = `workflow-repo-allocation__${a.toolId}_vs_${b.toolId}`;
    findings.push({
      id,
      title: cand.title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      presentationKind: 'workflow_repo_allocation',
      comparisonMode: 'absolute',
      comparisonState: 'workflow_comparable',
      current: a.topRepoShare,
      baseline: b.topRepoShare,
      delta: a.topRepoShare - b.topRepoShare,
      deltaPct: computeDeltaPct(a.topRepoShare, b.topRepoShare),
      displayValue: formatPct(a.topRepoShare),
      polarity: 'neutral',
      confidence: a.totalSessions >= 50 && b.totalSessions >= 50 ? 'high' : 'medium',
      n: a.totalSessions + b.totalSessions,
      hasData: true,
      description: cand.description,
      recommendation: cand.recommendation,
      executiveSummary: cand.title,
      metricKind: 'allocation_share',
      valueType: ALLOCATION_VALUE_TYPE.valueType,
      unit: ALLOCATION_VALUE_TYPE.unit,
      evidence: [
        { metric: a.wfName, value: repoDisplayName(a.topRepo), label: formatPct(a.topRepoShare), context: `${a.totalSessions} sessions` },
        { metric: b.wfName, value: repoDisplayName(b.topRepo), label: formatPct(b.topRepoShare), context: `${b.totalSessions} sessions` },
        { metric: 'shared repos', value: [...new Set([...a.repoShares.keys(), ...b.repoShares.keys()])].filter(r => a.repoShares.has(r) && b.repoShares.has(r)).length },
        { metric: 'concentration gap', value: `${cand.concentrationGapPP}pp` },
      ],
      isExecutiveFinding: false,
      dataSource: 'live',
      dataDomain: 'telemetry',
      whatChanged: cand.title,
      whyItMatters: cand.whyItMatters,
      allocationSubtype: cand.allocationSubtype,
      allocationSynthesis: false,
      dominantRepo: cand.allocationSubtype === 'same_dominant_repo' ? repoDisplayName(a.topRepo) : undefined,
      dominantRepoCanonical: cand.allocationSubtype === 'same_dominant_repo' ? a.topRepo : undefined,
      evidenceAndContext: cand.description,
      urgencyLabel: 'investigate',
      recommendationState: 'investigate',
      lifecycleClass: 'decision',
      generatorSource: 'generateWorkflowRepoAllocation',
      engineVersion: 'FINAL_ENGINE_V1',
      featureFlagState: true,
    } as CanonicalInsight);
  }

  findings.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
  return findings.slice(0, MAX_FINDINGS_PER_FAMILY);
}

// ── Family 3: Within-Workflow Temporal Behavior (W × B × T) ───────────────

function generateWithinWorkflowTemporalBehavior(input: CanonicalInsightInput): CanonicalInsight[] {
  const sessionRows = input.sessionRows || [];
  if (sessionRows.length === 0) return [];

  const registryEntry = getCanonicalPIById('within-workflow-temporal-behavior');
  if (!registryEntry) return [];

  const windows = input._engineCache?.temporalWindows !== undefined ? input._engineCache.temporalWindows : selectComparisonWindows(sessionRows);
  if (!windows) return [];

  if (!isWindowAdequatelyPopulated(sessionRows, windows.recent, MIN_SESSIONS_PER_WINDOW_TEMPORAL)) return [];
  if (!isWindowAdequatelyPopulated(sessionRows, windows.prior, MIN_SESSIONS_PER_WINDOW_TEMPORAL)) return [];

  const recentRows = input._engineCache?.recentRows?.length > 0 ? input._engineCache.recentRows : sessionRows.filter(r => isInWindow(r, windows.recent));
  const priorRows = input._engineCache?.priorRows?.length > 0 ? input._engineCache.priorRows : sessionRows.filter(r => isInWindow(r, windows.prior));

  const workflows = partitionByWorkflow(sessionRows, input._engineCache);
  const findings: CanonicalInsight[] = [];

  // Temporal behavior metrics (focus on commits/session and TTFC —
  // active_coding and runtime temporal change are handled by recentChange)
  const temporalMetrics: MetricDef[] = [
    METRIC_DEFS.find(m => m.metric === 'commits_per_session')!,
    METRIC_DEFS.find(m => m.metric === 'ttfc')!,
  ];

  for (const wf of workflows) {
    if (wf.rows.length < MIN_SESSIONS_PER_WORKFLOW) continue;

    const wfName = getWorkflowDisplayName(wf.toolId);
    const wfRecent = recentRows.filter(r =>
      normalizeToCanonicalToolId(r.tool ?? r.session_source ?? '') === wf.toolId
    );
    const wfPrior = priorRows.filter(r =>
      normalizeToCanonicalToolId(r.tool ?? r.session_source ?? '') === wf.toolId
    );

    if (wfRecent.length < MIN_SESSIONS_PER_WINDOW_TEMPORAL) continue;
    if (wfPrior.length < MIN_SESSIONS_PER_WINDOW_TEMPORAL) continue;

    for (const metricDef of temporalMetrics) {
      const recentResult = metricDef.compute(wfRecent);
      const priorResult = metricDef.compute(wfPrior);
      if (!recentResult || !priorResult) continue;

      if (recentResult.count < 3 || priorResult.count < 3) continue;

      const deltaPct = computeDeltaPct(recentResult.value, priorResult.value);

      // Materiality: ≥20% relative change
      if (Math.abs(deltaPct) < MIN_TEMPORAL_CHANGE_PCT) continue;

      // TTFC: also require ≥5 min absolute change
      if (metricDef.metric === 'ttfc') {
        const absMin = Math.abs(recentResult.value - priorResult.value);
        if (absMin < MIN_TEMPORAL_TTFC_CHANGE_MIN) continue;
      }

      const direction = deltaPct > 0 ? 'increased' : 'decreased';
      const recentVal = metricDef.formatValue(recentResult.value);
      const priorVal = metricDef.formatValue(priorResult.value);

      let title: string;
      switch (metricDef.metric) {
        case 'commits_per_session':
          title = `${wfName} commits per session ${direction} from ${priorVal} to ${recentVal} over ${windows.recentLabel}`;
          break;
        case 'ttfc':
          title = `${wfName} time to first commit ${direction} from ${priorVal} to ${recentVal} over ${windows.recentLabel}`;
          break;
        default:
          title = `${wfName} ${metricDef.label} ${direction} from ${priorVal} to ${recentVal} over ${windows.recentLabel}`;
          break;
      }

      const description = `${wfName} ${metricDef.label}: ${recentVal} (N=${recentResult.count}) in ${windows.recentLabel} vs ${priorVal} (N=${priorResult.count}) in ${windows.priorLabel}. Comparison: ${windows.label}. Observed history: ${windows.historyDays} days. This is an observational comparison and may be confounded by task or repo mix changes.`;

      const recommendation = deltaPct > 0
        ? (metricDef.metric === 'ttfc'
          ? `Check whether ${wfName} sessions in the recent window involved more complex tasks or unfamiliar repos that delayed first commits.`
          : `Check whether ${wfName} sessions in the recent window involved more incremental work or different task types that increased commits per session.`)
        : (metricDef.metric === 'ttfc'
          ? `Check whether ${wfName} sessions in the recent window involved more familiar tasks or simpler repos that sped up first commits.`
          : `Check whether ${wfName} sessions in the recent window involved larger, less incremental tasks that reduced commits per session.`);

      const id = `within-workflow-temporal-behavior__${metricDef.metric}__${wf.toolId}`;

      const { valueType, unit } = metricValueType(metricDef.metric);

      findings.push({
        id,
        title,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        presentationKind: 'within_workflow_temporal',
        comparisonMode: 'trend',
        comparisonState: 'workflow_comparable',
        current: recentResult.value,
        baseline: priorResult.value,
        delta: recentResult.value - priorResult.value,
        deltaPct,
        displayValue: recentVal,
        displayDeltaPct: `${deltaPct > 0 ? '+' : ''}${Math.round(deltaPct)}%`,
        polarity: metricDef.polarity,
        confidence: recentResult.count >= 20 && priorResult.count >= 20 ? 'high' : 'medium',
        n: recentResult.count + priorResult.count,
        hasData: true,
        description,
        recommendation,
        executiveSummary: title,
        metricKind: metricDef.metric,
        valueType,
        unit,
        evidence: [
          { metric: metricDef.label, value: recentVal, label: windows.recentLabel, context: `N=${recentResult.count}` },
          { metric: metricDef.label, value: priorVal, label: windows.priorLabel, context: `N=${priorResult.count}` },
          { metric: 'comparison window', value: windows.label },
        ],
        isExecutiveFinding: false,
        dataSource: 'live',
        whatChanged: title,
        whyItMatters: recommendation,
        evidenceAndContext: description,
        urgencyLabel: Math.abs(deltaPct) >= 50 ? 'investigate' : 'monitor',
        recommendationState: Math.abs(deltaPct) >= 50 ? 'investigate' : 'monitor_only',
        lifecycleClass: 'decision',
        generatorSource: 'generateWithinWorkflowTemporalBehavior',
        engineVersion: 'FINAL_ENGINE_V1',
        featureFlagState: true,
      } as CanonicalInsight);
    }
  }

  findings.sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));
  return findings.slice(0, MAX_FINDINGS_PER_FAMILY);
}

// ── Family 4: Workflow × Repo Allocation Shift (W × R × T) ───────────────

function generateWorkflowRepoAllocationShift(input: CanonicalInsightInput): CanonicalInsight[] {
  const sessionRows = input.sessionRows || [];
  if (sessionRows.length === 0) return [];

  const registryEntry = getCanonicalPIById('workflow-repo-allocation-shift');
  if (!registryEntry) return [];

  const windows = input._engineCache?.temporalWindows !== undefined ? input._engineCache.temporalWindows : selectComparisonWindows(sessionRows);
  if (!windows) return [];

  if (!isWindowAdequatelyPopulated(sessionRows, windows.recent, MIN_SESSIONS_PER_WINDOW_TEMPORAL)) return [];
  if (!isWindowAdequatelyPopulated(sessionRows, windows.prior, MIN_SESSIONS_PER_WINDOW_TEMPORAL)) return [];

  const recentRows = input._engineCache?.recentRows?.length > 0 ? input._engineCache.recentRows : sessionRows.filter(r => isInWindow(r, windows.recent));
  const priorRows = input._engineCache?.priorRows?.length > 0 ? input._engineCache.priorRows : sessionRows.filter(r => isInWindow(r, windows.prior));

  const workflows = partitionByWorkflow(sessionRows, input._engineCache);
  const findings: CanonicalInsight[] = [];

  for (const wf of workflows) {
    if (wf.rows.length < MIN_SESSIONS_PER_WORKFLOW) continue;

    const wfName = getWorkflowDisplayName(wf.toolId);
    const wfRecent = recentRows.filter(r =>
      normalizeToCanonicalToolId(r.tool ?? r.session_source ?? '') === wf.toolId
    );
    const wfPrior = priorRows.filter(r =>
      normalizeToCanonicalToolId(r.tool ?? r.session_source ?? '') === wf.toolId
    );

    if (wfRecent.length < MIN_SESSIONS_PER_WINDOW_TEMPORAL) continue;
    if (wfPrior.length < MIN_SESSIONS_PER_WINDOW_TEMPORAL) continue;

    // Compute repo shares for each window
    const recentRepoMap = partitionByRepo(wfRecent);
    const priorRepoMap = partitionByRepo(wfPrior);

    const recentTotal = wfRecent.length;
    const priorTotal = wfPrior.length;

    // Find the most material shift in top repo share
    let maxShiftPP = 0;
    let shiftRepo = '';
    let recentShare = 0;
    let priorShare = 0;
    let newRepos: string[] = [];
    let lostRepos: string[] = [];

    const allRepos = new Set([...recentRepoMap.keys(), ...priorRepoMap.keys()]);
    for (const repo of allRepos) {
      const rShare = (recentRepoMap.get(repo)?.length ?? 0) / recentTotal;
      const pShare = (priorRepoMap.get(repo)?.length ?? 0) / priorTotal;
      const shiftPP = Math.abs(rShare - pShare) * 100;
      if (shiftPP > maxShiftPP) {
        maxShiftPP = shiftPP;
        shiftRepo = repo;
        recentShare = rShare;
        priorShare = pShare;
      }
      if (rShare > 0 && pShare === 0) newRepos.push(repo);
      if (rShare === 0 && pShare > 0) lostRepos.push(repo);
    }

    // Materiality: ≥15pp shift in a repo's share
    if (maxShiftPP < MIN_ALLOCATION_SHIFT_PP && newRepos.length === 0 && lostRepos.length === 0) continue;

    // P3: Temporal sample / instrumentation quality gate
    // Classify the finding's evidence quality based on sample sizes and volume change.
    // Small samples or dramatic volume changes may indicate instrumentation gaps
    // rather than real operational behavior changes.
    const minWindowN = Math.min(recentTotal, priorTotal);
    const maxWindowN = Math.max(recentTotal, priorTotal);
    const volumeChangePct = maxWindowN > 0 ? Math.abs(recentTotal - priorTotal) / maxWindowN : 0;
    let temporalQuality: 'stable' | 'low_sample' | 'instrumentation_gap';
    if (minWindowN < 10 && volumeChangePct > 0.5) {
      temporalQuality = 'instrumentation_gap';
    } else if (minWindowN < 20) {
      temporalQuality = 'low_sample';
    } else {
      temporalQuality = 'stable';
    }

    const shiftRepoLabel = repoDisplayName(shiftRepo);
    // Fail closed: a blank/placeholder repo label must not reach the title.
    if (!isRenderableRepoLabel(shiftRepoLabel)) continue;
    let title: string;
    let description: string;

    if (maxShiftPP >= MIN_ALLOCATION_SHIFT_PP) {
      const direction = recentShare > priorShare ? 'toward' : 'away from';
      if (temporalQuality === 'instrumentation_gap' || temporalQuality === 'low_sample') {
        // Cautious language for suspected instrumentation gaps or low samples.
        // Do NOT append "(instrumentation gap)" or "(low sample)" to the title —
        // these are diagnostic keywords in the render adapter's
        // DIAGNOSTIC_TITLE_KEYWORDS list and would cause the finding to be
        // misclassified as a diagnostic data-gap card. The temporalQuality
        // field and description carry the quality information instead.
        title = `${wfName} allocation appears to shift ${direction} ${shiftRepoLabel} (${formatPct(priorShare)} → ${formatPct(recentShare)}) over ${windows.recentLabel}`;
      } else if (maxShiftPP > 50) {
        title = `${wfName} moved almost entirely ${direction} ${shiftRepoLabel} (${formatPct(priorShare)} → ${formatPct(recentShare)}) over ${windows.recentLabel}`;
      } else {
        title = `${wfName} allocation moved ${direction} ${shiftRepoLabel} (${formatPct(priorShare)} → ${formatPct(recentShare)}) over ${windows.recentLabel}`;
      }
      description = `${wfName} repo allocation: ${shiftRepoLabel} went from ${formatPct(priorShare)} to ${formatPct(recentShare)} of sessions (${Math.round(maxShiftPP)}pp shift). Comparison: ${windows.label}. Recent: ${recentTotal} sessions across ${recentRepoMap.size} repos. Prior: ${priorTotal} sessions across ${priorRepoMap.size} repos.${temporalQuality !== 'stable' ? ` Note: Small sample sizes (recent N=${recentTotal}, prior N=${priorTotal}) — treat as emerging signal, not confirmed behavior change.` : ''}`;
    } else if (newRepos.length > 0) {
      const newRepoLabels = newRepos.map(r => repoDisplayName(r)).filter(isRenderableRepoLabel);
      if (newRepoLabels.length === 0) continue;
      title = `${wfName} expanded into ${newRepoLabels.length} new ${newRepoLabels.length === 1 ? 'repo' : 'repos'} over ${windows.recentLabel}`;
      description = `${wfName} started appearing in ${newRepoLabels.join(', ')} in ${windows.recentLabel}. Prior window had ${priorRepoMap.size} repos; recent has ${recentRepoMap.size} repos. Comparison: ${windows.label}.`;
    } else {
      const lostRepoLabels = lostRepos.map(r => repoDisplayName(r)).filter(isRenderableRepoLabel);
      if (lostRepoLabels.length === 0) continue;
      title = `${wfName} stopped appearing in ${lostRepoLabels.length} ${lostRepoLabels.length === 1 ? 'repo' : 'repos'} over ${windows.recentLabel}`;
      description = `${wfName} no longer appears in ${lostRepoLabels.join(', ')} in ${windows.recentLabel}. Prior window had ${priorRepoMap.size} repos; recent has ${recentRepoMap.size} repos. Comparison: ${windows.label}.`;
    }

    const recommendation = temporalQuality === 'instrumentation_gap'
      ? `Treat as a data-quality signal, not a confirmed behavior change. Check whether instrumentation coverage, agent deployment, or telemetry ingestion changed between windows before interpreting this as a real allocation shift.`
      : `Investigate whether this allocation shift reflects a planned change in tool usage, a project phase transition, or a team restructuring. Check whether the shift correlates with changes in task type or team composition.`;

    const id = `workflow-repo-allocation-shift__${wf.toolId}`;

    findings.push({
      id,
      title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      presentationKind: 'workflow_repo_allocation_shift',
      comparisonMode: 'trend',
      comparisonState: 'workflow_comparable',
      current: recentShare,
      baseline: priorShare,
      delta: recentShare - priorShare,
      deltaPct: computeDeltaPct(recentShare, priorShare),
      displayValue: formatPct(recentShare),
      polarity: 'neutral',
      confidence: temporalQuality === 'stable' ? (recentTotal >= 20 && priorTotal >= 20 ? 'high' : 'medium') : 'low',
      n: recentTotal + priorTotal,
      hasData: true,
      description,
      recommendation,
      executiveSummary: title,
      metricKind: 'allocation_share',
      valueType: ALLOCATION_VALUE_TYPE.valueType,
      unit: ALLOCATION_VALUE_TYPE.unit,
      temporalQuality,
      evidence: [
        { metric: 'recent repos', value: recentRepoMap.size, context: `${recentTotal} sessions` },
        { metric: 'prior repos', value: priorRepoMap.size, context: `${priorTotal} sessions` },
        { metric: 'max share shift', value: `${Math.round(maxShiftPP)}pp`, context: shiftRepo ? shiftRepoLabel : '' },
        { metric: 'new repos', value: newRepos.length },
        { metric: 'lost repos', value: lostRepos.length },
        { metric: 'comparison window', value: windows.label },
      ],
      isExecutiveFinding: false,
      dataSource: 'live',
      whatChanged: title,
      whyItMatters: `Where ${wfName} is being used has changed materially. This may reflect a project transition, team restructuring, or a shift in tool-task alignment.`,
      evidenceAndContext: description,
      urgencyLabel: maxShiftPP >= 30 ? 'investigate' : 'monitor',
      recommendationState: maxShiftPP >= 30 ? 'investigate' : 'monitor_only',
      lifecycleClass: 'decision',
      generatorSource: 'generateWorkflowRepoAllocationShift',
      engineVersion: 'FINAL_ENGINE_V1',
      featureFlagState: true,
    } as CanonicalInsight);
  }

  findings.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

  // CR-X P1 STORY-LEVEL CONSOLIDATION:
  // When ≥2 workflows shift allocation materially in the same window,
  // synthesize ONE organizational shift finding instead of N per-workflow cards.
  // "ONE MATERIAL EXECUTIVE QUESTION / FACT = ONE CARD."
  if (findings.length >= 2) {
    const synthesized = synthesizeAllocationShift(findings, registryEntry, windows);
    if (synthesized) {
      piDebugLog('[MULTI_DIMENSIONAL][ALLOCATION_SHIFT_SYNTHESIS]', {
        workflowsInSynthesis: findings.length,
        suppressedPerWorkflow: findings.length,
      });
      return [synthesized];
    }
  }

  return findings.slice(0, MAX_FINDINGS_PER_FAMILY);
}

/**
 * CR-X P1: Synthesize per-workflow allocation shifts into one organizational shift finding.
 * Combines N per-workflow shift findings into one multi-workflow finding with all
 * workflows' shifts in its evidence and breakdownByTool for bars.
 */
function synthesizeAllocationShift(
  perWorkflowFindings: CanonicalInsight[],
  registryEntry: any,
  windows: any,
): CanonicalInsight | null {
  if (perWorkflowFindings.length < 2) return null;

  // Extract shift data from each per-workflow finding
  interface ShiftData {
    wfName: string;
    toolId: string;
    title: string;
    description: string;
    maxShiftPP: number;
    recentShare: number;
    priorShare: number;
    shiftRepoLabel: string;
    direction: 'toward' | 'away from';
    n: number;
    confidence: string;
    temporalQuality: string;
  }

  const shifts: ShiftData[] = [];
  for (const f of perWorkflowFindings) {
    const wfName = f.title.split(' ')[0]; // First word is workflow name
    const toolId = f.id.replace('workflow-repo-allocation-shift__', '');
    const maxShiftEv = f.evidence?.find(e => e.metric === 'max share shift');
    const maxShiftPP = parseInt((maxShiftEv?.value as string || '0').replace('pp', '')) || 0;
    const recentShare = f.current ?? 0;
    const priorShare = f.baseline ?? 0;
    const shiftRepoLabel = maxShiftEv?.context || '';
    const direction = recentShare > priorShare ? 'toward' : 'away from';

    shifts.push({
      wfName,
      toolId,
      title: f.title,
      description: f.description || '',
      maxShiftPP,
      recentShare,
      priorShare,
      shiftRepoLabel,
      direction,
      n: f.n ?? 0,
      confidence: f.confidence || 'medium',
      temporalQuality: (f as any).temporalQuality || 'stable',
    });
  }

  // Sort by shift magnitude (largest first)
  shifts.sort((a, b) => b.maxShiftPP - a.maxShiftPP);

  const title = `Repository allocation shifted materially across ${shifts.length} workflows over ${windows.recentLabel}`;
  const description = `Multiple workflows shifted repo allocation over ${windows.recentLabel}. ${shifts.map(s => `${s.wfName}: ${s.direction} ${s.shiftRepoLabel} (${formatPct(s.priorShare)} → ${formatPct(s.recentShare)}, ${s.maxShiftPP}pp)`).join('. ')}. This is an observational comparison. The organization's repo allocation changed materially across workflows.`;
  const whyItMatters = `Multiple workflows shifted allocation in the same window. This may reflect a coordinated project transition, team restructuring, or a shift in tool-task alignment.`;
  const recommendation = `Investigate whether these shifts reflect a planned organizational change, project phase transition, or team restructuring. Check whether the shifts correlate with changes in task type or team composition.`;

  // Build breakdownByTool for horizontal comparison bars (shift magnitude per workflow)
  const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
  for (const s of shifts) {
    breakdownByTool[s.wfName] = {
      value: s.maxShiftPP,
      count: s.n,
      formatted: `${s.maxShiftPP}pp`,
      label: `${s.direction} ${s.shiftRepoLabel}`,
    };
  }

  // Evidence: each workflow's shift
  const evidence = shifts.map(s => ({
    metric: `${s.wfName} allocation shift`,
    value: `${formatPct(s.priorShare)} → ${formatPct(s.recentShare)}`,
    label: `${s.maxShiftPP}pp ${s.direction}`,
    context: `${s.shiftRepoLabel} · N=${s.n}`,
  }));
  evidence.push({
    metric: 'comparison window',
    value: windows.label,
    label: 'prior → recent',
    context: windows.recentLabel,
  });

  const id = 'workflow-repo-allocation-shift__organizational_synthesis';
  const maxShift = shifts[0]?.maxShiftPP ?? 0;
  const totalN = shifts.reduce((sum, s) => sum + s.n, 0);

  return {
    id,
    title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    presentationKind: 'workflow_repo_allocation_shift',
    comparisonMode: 'trend',
    comparisonState: 'workflow_comparable',
    current: shifts[0]?.recentShare ?? 0,
    baseline: shifts[0]?.priorShare ?? 0,
    delta: (shifts[0]?.recentShare ?? 0) - (shifts[0]?.priorShare ?? 0),
    deltaPct: maxShift,
    displayValue: `${maxShift}pp`,
    polarity: 'neutral',
    confidence: shifts.every(s => s.confidence === 'high') ? 'high' : 'medium',
    n: totalN,
    hasData: true,
    description,
    recommendation,
    executiveSummary: title,
    metricKind: 'allocation_share',
    valueType: ALLOCATION_VALUE_TYPE.valueType,
    unit: ALLOCATION_VALUE_TYPE.unit,
    evidence,
    breakdownByTool,
    isExecutiveFinding: false,
    dataSource: 'live',
    whatChanged: title,
    whyItMatters,
    allocationShiftSynthesis: true,
    synthesizedWorkflows: shifts.map(s => s.toolId),
    evidenceAndContext: description,
    urgencyLabel: maxShift >= 30 ? 'investigate' : 'monitor',
    recommendationState: maxShift >= 30 ? 'investigate' : 'monitor_only',
    lifecycleClass: 'decision',
    generatorSource: 'generateWorkflowRepoAllocationShift',
    engineVersion: 'FINAL_ENGINE_V1',
    featureFlagState: true,
  } as CanonicalInsight;
}

/**
 * Generate all multi-dimensional analysis family insights.
 * Returns a combined array from all four families.
 */
// ── Family 5: Cross-Surface Behavior (W × S) ──────────────────────────────
// Generic same-workflow, cross-surface comparison. Works for any workflow
// with sessions on more than one surface (host_editor). No hardcoded tools.
function generateCrossSurfaceBehavior(input: CanonicalInsightInput): CanonicalInsight[] {
  const sessionRows = input.sessionRows || [];
  if (sessionRows.length === 0) return [];

  const registryEntry = getCanonicalPIById('cross-surface-behavior');
  if (!registryEntry) return [];

  const MIN_SESSIONS_PER_SURFACE = 5;
  const MIN_SURFACE_RATIO = 1.5;
  const MIN_SURFACE_DELTA_PCT = 50;
  const MAX_CROSS_SURFACE = 5;

  function surfaceDisplayName(surface: string): string {
    const s = String(surface).toLowerCase();
    if (s === 'claude_code') return 'terminal';
    if (s === 'codex') return 'terminal';
    if (s === 'vscode') return 'VS Code';
    if (s === 'cursor') return 'Cursor';
    if (s === 'devin') return 'Devin';
    if (s === 'github_copilot') return 'GitHub Copilot';
    return surface;
  }

  function partitionBySurface(rows: any[]): Map<string, any[]> {
    const map = new Map<string, any[]>();
    for (const r of rows) {
      const surface = r.host_editor ?? r.editor_source ?? r.tool;
      if (!surface) continue;
      if (!map.has(surface)) map.set(surface, []);
      map.get(surface)!.push(r);
    }
    return map;
  }

  const workflows = partitionByWorkflow(sessionRows, input._engineCache);
  const findings: CanonicalInsight[] = [];

  for (const wf of workflows) {
    if (wf.rows.length < MIN_SESSIONS_PER_WORKFLOW) continue;

    const surfaceMap = partitionBySurface(wf.rows);
    const qualifying: Array<{ surface: string; rows: any[] }> = [];
    for (const [surface, rows] of surfaceMap) {
      if (rows.length >= MIN_SESSIONS_PER_SURFACE) {
        qualifying.push({ surface, rows });
      }
    }
    if (qualifying.length < 2) continue;

    const wfName = getWorkflowDisplayName(wf.toolId);
    const applicableMetrics = metricsForWorkflow(wf.toolId);

    for (const metricDef of applicableMetrics) {
      const surfaceMetrics: Array<{ surface: string; result: MetricResult }> = [];
      for (const q of qualifying) {
        const result = metricDef.compute(q.rows);
        if (result && result.count >= 5) {
          surfaceMetrics.push({ surface: q.surface, result });
        }
      }
      if (surfaceMetrics.length < 2) continue;

      surfaceMetrics.sort((a, b) => b.result.value - a.result.value);
      const highest = surfaceMetrics[0];
      const lowest = surfaceMetrics[surfaceMetrics.length - 1];

      const ratio = meaningfulRatio(highest.result.value, lowest.result.value);
      const deltaPct = computeDeltaPct(highest.result.value, lowest.result.value);

      if ((ratio === null || ratio < MIN_SURFACE_RATIO) && Math.abs(deltaPct) < MIN_SURFACE_DELTA_PCT) continue;

      const highLabel = surfaceDisplayName(highest.surface);
      const lowLabel = surfaceDisplayName(lowest.surface);
      const highVal = metricDef.formatValue(highest.result.value);
      const lowVal = metricDef.formatValue(lowest.result.value);

      // Null ratio = zero/near-zero baseline: title falls back to an
      // absolute comparison (values are still shown) rather than a
      // fabricated multiplier.
      const relClause = ratio !== null ? `${ratio.toFixed(1)}× ` : '';

      let title: string;
      switch (metricDef.metric) {
        case 'active_coding':
          title = `${wfName} active-coding time is ${relClause}longer on ${highLabel} than ${lowLabel} (${highVal} vs ${lowVal})`;
          break;
        case 'commits_per_session':
          title = `${wfName} commits ${relClause}more per session on ${highLabel} than ${lowLabel} (${highVal} vs ${lowVal})`;
          break;
        case 'ttfc':
          title = `${wfName} reaches first commit ${relClause}faster on ${highLabel} than ${lowLabel} (${highVal} vs ${lowVal})`;
          break;
        case 'agent_runtime':
          title = `${wfName} runs are ${relClause}longer on ${highLabel} than ${lowLabel} (${highVal} vs ${lowVal})`;
          break;
        case 'ai_burst':
          title = `${wfName} uses AI bursts ${relClause}more per session on ${highLabel} than ${lowLabel} (${highVal} vs ${lowVal})`;
          break;
        default:
          title = `${wfName} ${metricDef.label} differs materially by surface (${highLabel} ${highVal} vs ${lowLabel} ${lowVal})`;
      }

      const description = `${wfName} shows ${highVal} ${metricDef.label} on ${highLabel} (N=${highest.result.count}) vs ${lowVal} on ${lowLabel} (N=${lowest.result.count}). This is an observational comparison across surfaces and may reflect different usage modes, task types, or team practices rather than tool behavior.`;

      const recommendation = `Investigate whether ${wfName} is used for different tasks on ${highLabel} vs ${lowLabel}. Differences may reflect surface-specific usage patterns rather than tool performance.`;

      const id = `cross-surface-behavior__${wf.toolId}__${metricDef.metric}`;
      const { valueType, unit } = metricValueType(metricDef.metric);

      findings.push({
        id,
        title,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        presentationKind: 'cross_surface_behavior',
        comparisonMode: 'absolute',
        comparisonState: 'workflow_comparable',
        current: highest.result.value,
        baseline: lowest.result.value,
        delta: highest.result.value - lowest.result.value,
        deltaPct,
        displayValue: highVal,
        displayDeltaPct: `${deltaPct > 0 ? '+' : ''}${Math.round(deltaPct)}%`,
        polarity: metricDef.polarity,
        confidence: highest.result.count >= 20 && lowest.result.count >= 20 ? 'high' : 'medium',
        n: highest.result.count + lowest.result.count,
        hasData: true,
        description,
        recommendation,
        executiveSummary: title,
        metricKind: metricDef.metric,
        valueType,
        unit,
        evidence: [
          { metric: metricDef.label, value: highVal, label: highLabel, context: `N=${highest.result.count}` },
          { metric: metricDef.label, value: lowVal, label: lowLabel, context: `N=${lowest.result.count}` },
          ratio !== null
            ? { metric: 'ratio', value: `${ratio.toFixed(1)}x` }
            : { metric: 'ratio', value: 'n/a — zero baseline' },
          { metric: 'qualifying surfaces', value: surfaceMetrics.length },
        ],
        isExecutiveFinding: false,
        dataSource: 'live',
        whatChanged: title,
        whyItMatters: `The same workflow produces materially different ${metricDef.label} depending on the surface. This may indicate different usage modes, task types, or team practices across surfaces.`,
        evidenceAndContext: description,
        urgencyLabel: 'investigate',
        recommendationState: 'investigate',
        lifecycleClass: 'decision',
        generatorSource: 'generateCrossSurfaceBehavior',
        engineVersion: 'FINAL_ENGINE_V1',
        featureFlagState: true,
      } as CanonicalInsight);
    }
  }

  findings.sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));
  return findings.slice(0, MAX_CROSS_SURFACE);
}

function median(values: number[]): number | null {
  const sorted = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number | null {
  const valid = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function computeTopRepoShare(rows: any[]): { share: number; topRepo: string } | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const repo = normalizeRepoUrl(r.git_repo_url);
    if (!repo || !isRenderableRepoLabel(repo)) continue;
    counts.set(repo, (counts.get(repo) || 0) + 1);
    total++;
  }
  if (total === 0) return null;
  let topRepo = '';
  let topCount = 0;
  for (const [repo, c] of counts) {
    if (c > topCount) {
      topCount = c;
      topRepo = repo;
    }
  }
  return { share: topCount / total, topRepo };
}

const LONGITUDINAL_WINDOW_CANDIDATES = [
  { days: 14, label: '2 weeks' },
  { days: 28, label: '4 weeks' },
  { days: 56, label: '8 weeks' },
];

// ── Family 6: Within-Workflow Longitudinal Behavior (W × T) ───────────────
// Generic mature-workflow longitudinal intelligence. No hardcoded workflows.
// Compares a recent window to an equally-sized prior window for the same
// workflow. Works for delegated and human-interactive workflows.
function generateWithinWorkflowLongitudinal(input: CanonicalInsightInput): CanonicalInsight[] {
  const sessionRows = input.sessionRows || [];
  if (sessionRows.length === 0) return [];

  const registryEntry = getCanonicalPIById('within-workflow-longitudinal-behavior');
  if (!registryEntry) return [];

  const MIN_WINDOW_SESSIONS = 15;
  const MIN_RATIO = 1.25;
  const MIN_DELTA_PCT = 25;
  const MIN_REPO_SHARE_PP = 15;
  const MAX_FINDINGS_PER_WORKFLOW = 2;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const workflows = partitionByWorkflow(sessionRows, input._engineCache);
  const findings: CanonicalInsight[] = [];

  for (const wf of workflows) {
    if (wf.rows.length < MIN_SESSIONS_PER_WORKFLOW) continue;

    const timestamps = wf.rows
      .map(r => new Date(r.timestamp).getTime())
      .filter(t => !isNaN(t));
    if (timestamps.length === 0) continue;

    // Use the latest observed date as the reference point for windows.
    const now = Math.max(...timestamps);

    let selectedWindow: { recent: any[]; prior: any[]; days: number; label: string } | null = null;
    for (const w of LONGITUDINAL_WINDOW_CANDIDATES) {
      const recent = wf.rows.filter(r => {
        const t = new Date(r.timestamp).getTime();
        return t > now - w.days * MS_PER_DAY && t <= now;
      });
      const prior = wf.rows.filter(r => {
        const t = new Date(r.timestamp).getTime();
        return t > now - 2 * w.days * MS_PER_DAY && t <= now - w.days * MS_PER_DAY;
      });
      if (recent.length >= MIN_WINDOW_SESSIONS && prior.length >= MIN_WINDOW_SESSIONS) {
        selectedWindow = { recent, prior, days: w.days, label: w.label };
        break;
      }
    }
    if (!selectedWindow) continue;

    const { recent, prior } = selectedWindow;
    const isDelegated = isDelegatedAgentWorkflow(wf.toolId);
    const wfName = getWorkflowDisplayName(wf.toolId);

    const candidates: Array<{ idSuffix: string; metric: string; current: number; baseline: number; valueType: string; unit: string; format: (v: number) => string; title: string }> = [];

    // 1. Session volume
    {
      const current = recent.length;
      const baseline = prior.length;
      const ratio = current / Math.max(baseline, 0.001);
      const deltaPct = ((current - baseline) / Math.max(baseline, 0.001)) * 100;
      if (ratio >= MIN_RATIO || Math.abs(deltaPct) >= MIN_DELTA_PCT) {
        const dir = current > baseline ? 'increased' : 'decreased';
        candidates.push({
          idSuffix: 'sessions',
          metric: 'sessions',
          current,
          baseline,
          valueType: 'count',
          unit: 'sessions',
          format: v => `${Math.round(v)}`,
          title: `${wfName} usage ${dir} ${Math.round(Math.abs(deltaPct))}% over the last ${selectedWindow.label} (${Math.round(current)} vs ${Math.round(baseline)} sessions)`,
        });
      }
    }

    // 2. Headline time metric (runtime for delegated, active-coding for human)
    {
      const field = isDelegated ? 'session_duration_minutes' : 'session_active_coding_duration_minutes';
      const label = isDelegated ? 'runtime per session' : 'active coding per session';
      const recentVals = recent.map(r => r[field]).filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
      const priorVals = prior.map(r => r[field]).filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
      const currentM = median(recentVals);
      const baselineM = median(priorVals);
      if (currentM !== null && baselineM !== null && baselineM > 0) {
        const ratio = currentM / baselineM;
        const deltaPct = (ratio - 1) * 100;
        if (ratio >= MIN_RATIO || Math.abs(deltaPct) >= MIN_DELTA_PCT) {
          const dir = currentM > baselineM ? 'longer' : 'shorter';
          candidates.push({
            idSuffix: isDelegated ? 'agent_runtime' : 'active_coding',
            metric: label,
            current: currentM,
            baseline: baselineM,
            valueType: 'duration_minutes',
            unit: 'min',
            format: formatMinutes,
            title: `${wfName} ${label} became ${dir} over the last ${selectedWindow.label} (${formatMinutes(currentM)} vs ${formatMinutes(baselineM)})`,
          });
        }
      }
    }

    // 3. AI burst density (all workflows where authoritative)
    {
      const current = mean(recent.map(r => r.ai_burst_count).filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0));
      const baseline = mean(prior.map(r => r.ai_burst_count).filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0));
      if (current !== null && baseline !== null && baseline > 0) {
        const ratio = current / baseline;
        const deltaPct = (ratio - 1) * 100;
        if (ratio >= MIN_RATIO || Math.abs(deltaPct) >= MIN_DELTA_PCT) {
          const dir = current > baseline ? 'increased' : 'decreased';
          candidates.push({
            idSuffix: 'ai_burst',
            metric: 'AI bursts per session',
            current,
            baseline,
            valueType: 'rate',
            unit: '',
            format: v => v.toFixed(1),
            title: `${wfName} AI-burst density ${dir} ${Math.round(Math.abs(deltaPct))}% over the last ${selectedWindow.label} (${current.toFixed(1)} vs ${baseline.toFixed(1)} per session)`,
          });
        }
      }
    }

    // 4. Repository concentration
    {
      const recentRepo = computeTopRepoShare(recent);
      const priorRepo = computeTopRepoShare(prior);
      if (recentRepo && priorRepo) {
        const currentShare = recentRepo.share;
        const baselineShare = priorRepo.share;
        const deltaPP = (currentShare - baselineShare) * 100;
        if (Math.abs(deltaPP) >= MIN_REPO_SHARE_PP) {
          const dir = currentShare > baselineShare ? 'more' : 'less';
          const topRepoLabel = repoDisplayName(recentRepo.topRepo);
          if (!isRenderableRepoLabel(topRepoLabel)) continue;
          candidates.push({
            idSuffix: 'repo_concentration',
            metric: 'top repo share',
            current: currentShare,
            baseline: baselineShare,
            valueType: 'percentage',
            unit: '%',
            format: v => `${Math.round(v * 100)}%`,
            title: `${wfName} work became ${dir} concentrated in ${topRepoLabel} over the last ${selectedWindow.label} (${Math.round(currentShare * 100)}% vs ${Math.round(baselineShare * 100)}%)`,
          });
        }
      }
    }

    // 5. Repository spread
    {
      const current = new Set(recent.map(r => normalizeRepoUrl(r.git_repo_url)).filter(Boolean)).size;
      const baseline = new Set(prior.map(r => normalizeRepoUrl(r.git_repo_url)).filter(Boolean)).size;
      if (baseline > 0) {
        const ratio = current / baseline;
        const deltaPct = (ratio - 1) * 100;
        if (ratio >= MIN_RATIO || Math.abs(deltaPct) >= MIN_DELTA_PCT) {
          const dir = current > baseline ? 'expanded into' : 'contracted to';
          candidates.push({
            idSuffix: 'repo_spread',
            metric: 'active repositories',
            current,
            baseline,
            valueType: 'count',
            unit: 'repos',
            format: v => `${Math.round(v)}`,
            title: `${wfName} ${dir} ${Math.round(current)} repositories over the last ${selectedWindow.label} (from ${Math.round(baseline)})`,
          });
        }
      }
    }

    // Rank candidates by materiality and keep the strongest two per workflow
    candidates.sort((a, b) => Math.abs(b.current - b.baseline) - Math.abs(a.current - a.baseline));
    for (const c of candidates.slice(0, MAX_FINDINGS_PER_WORKFLOW)) {
      const delta = c.current - c.baseline;
      const deltaPct = c.baseline !== 0 ? (delta / Math.abs(c.baseline)) * 100 : (delta > 0 ? 100 : -100);
      const displayDelta = `${deltaPct > 0 ? '+' : ''}${Math.round(deltaPct)}%`;
      const description = `${wfName} shows ${c.format(c.current)} ${c.metric} in the most recent ${selectedWindow.label} compared to the prior ${selectedWindow.label}. This is an observational period-over-period comparison and may reflect changing usage patterns, team focus, or task types rather than tool behavior.`;

      findings.push({
        id: `within-workflow-longitudinal-behavior__${wf.toolId}__${c.idSuffix}`,
        title: c.title,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        presentationKind: 'temporal_trend',
        comparisonMode: 'period_over_period',
        comparisonState: 'workflow_longitudinal',
        current: c.current,
        baseline: c.baseline,
        delta,
        deltaPct,
        displayValue: c.format(c.current),
        displayDeltaPct: displayDelta,
        polarity: c.idSuffix === 'repo_concentration' ? 'neutral' : (c.idSuffix === 'active_coding' ? 'higher_is_better' : 'higher_is_better'),
        confidence: (recent.length >= 30 && prior.length >= 30) ? 'high' : 'medium',
        n: recent.length + prior.length,
        hasData: true,
        description,
        recommendation: `Investigate whether ${wfName} usage patterns are shifting over the last ${selectedWindow.label}. Changes may reflect evolving adoption, task mix, or team practices.`,
        executiveSummary: c.title,
        metricKind: c.metric,
        valueType: c.valueType,
        unit: c.unit,
        evidence: [
          { metric: c.metric, value: c.format(c.current), label: `recent ${selectedWindow.label}`, context: `N=${recent.length}` },
          { metric: c.metric, value: c.format(c.baseline), label: `prior ${selectedWindow.label}`, context: `N=${prior.length}` },
          { metric: 'change', value: displayDelta, label: 'period-over-period' },
        ],
        isExecutiveFinding: false,
        dataSource: 'live',
        whatChanged: c.title,
        whyItMatters: `Understanding how ${wfName} is changing over time helps identify adoption trends, shifting work focus, or workflow maturity.`,
        evidenceAndContext: description,
        urgencyLabel: 'investigate',
        recommendationState: 'investigate',
        lifecycleClass: 'decision',
        generatorSource: 'generateWithinWorkflowLongitudinal',
        engineVersion: 'FINAL_ENGINE_V1',
        featureFlagState: true,
      } as CanonicalInsight);
    }
  }

  findings.sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));
  return findings.slice(0, 8);
}

export function generateMultiDimensionalInsights(input: CanonicalInsightInput): CanonicalInsight[] {
  const family1 = generateRepoConditionedBehavior(input) ?? [];
  const family2 = generateWorkflowRepoAllocation(input) ?? [];
  const family3 = generateWithinWorkflowTemporalBehavior(input) ?? [];
  const family4 = generateWorkflowRepoAllocationShift(input) ?? [];
  const family5 = generateCrossSurfaceBehavior(input) ?? [];
  const family6 = generateWithinWorkflowLongitudinal(input) ?? [];

  const all = [...family1, ...family2, ...family3, ...family4, ...family5, ...family6];

  piDebugLog('[MULTI_DIMENSIONAL]', {
    repoConditionedBehavior: family1.length,
    workflowRepoAllocation: family2.length,
    withinWorkflowTemporal: family3.length,
    workflowRepoAllocationShift: family4.length,
    crossSurfaceBehavior: family5.length,
    withinWorkflowLongitudinal: family6.length,
    total: all.length,
    ids: all.map(i => i.id),
  });

  return all;
}
