/**
 * CR-X Pass 3 (B): Early-Signal PI Generators + Developer×Workflow×Metric×Cost
 * Efficiency Frontier PI.
 *
 * These generators are ADDITIVE — they do not modify existing generators.
 * They are designed to fire with smaller data sets (new pilots) where
 * the mature-pilot generators (MIN_SESSIONS=25-50) return null.
 *
 * CONTRACT:
 * - Early-signal PIs fire with as few as 5 sessions per workflow.
 * - Confidence is capped at 'low' for early signals (never 'high').
 * - Polarity is neutral — these are observational, not directional.
 * - No fake delta/baseline — single-snapshot observations only.
 * - Returns null if even the early-signal threshold is not met.
 * - Provenance labels match reality (live vs seeded).
 *
 * EFFICIENCY FRONTIER PI (CORRECTED per P2):
 * - Compares developers using the SAME workflow on the SAME metric.
 * - Does NOT use session volume as a performance metric.
 * - Does NOT have a sessions-only fallback.
 * - If configured cost is unavailable, this PI DOES NOT FIRE.
 * - Pareto frontier across: performance metric AND cost efficiency metric.
 * - No cross-metric composite score. No "best developer."
 * - Gates: authoritative developer identity, same workflow, metric provenance,
 *   minimum developer session N, minimum cohort size, period disclosure,
 *   configured estimate / not billing data, neutral task/repo-mix caveat,
 *   no causal claim, no employee-performance judgment.
 */
import type { CanonicalInsightInput, CanonicalInsight, ConfidenceLevel } from '../types';
import { getCanonicalPIById } from '../canonicalInsights';
import { piDebugLog } from '../utils/logging';
import { normalizeToCanonicalToolId } from '../../../workflowIdentity';
import { normalizeCostConfigInput, costToolIdToCanonicalWorkflowId } from '../../../toolCost';

const EARLY_SIGNAL_MIN_SESSIONS = 5;
const EARLY_SIGNAL_MIN_WORKFLOWS = 1;
const EARLY_SIGNAL_MIN_DEVELOPERS = 1;

// ─── Maturity Gate ───────────────────────────────────────────
// Early-signal PIs are suppressed when the tenant has enough data
// for mature-pilot generators to fire. The mature generators use
// 25-50 sessions per workflow. We use the lowest mature threshold
// (25 sessions per workflow) as the suppression trigger.
// If ANY workflow has >= MATURITY_SESSIONS_PER_WORKFLOW sessions,
// the early-signal workflow adoption PI is suppressed.
// If total sessions >= MATURITY_TOTAL_SESSIONS, the early-signal
// developer activity PI is suppressed.

const MATURITY_SESSIONS_PER_WORKFLOW = 25;
const MATURITY_TOTAL_SESSIONS = 50;

// ─── Efficiency Frontier Thresholds ──────────────────────────

const EFFICIENCY_MIN_SESSIONS_PER_DEVELOPER = 10;
const EFFICIENCY_MIN_COHORT_SIZE = 2; // at least 2 developers using same workflow

// ─── Cost Config (CR-X FINAL Wave 3: backend authority only) ─────────────────

interface CostConfig {
  toolId: string;  // canonical workflow ID
  monthlySpend: number;
  isConfigured: boolean;
}

function resolveCostConfig(input: CanonicalInsightInput, workflowId: string): CostConfig | null {
  const external = input.externalCostConfigs || [];
  if (external.length === 0) return null;

  const canonicalTarget = normalizeToCanonicalToolId(workflowId);
  for (const raw of external) {
    const normalized = normalizeCostConfigInput(raw);
    if (!normalized) continue;
    const canonicalWorkflowId = costToolIdToCanonicalWorkflowId(normalized.toolId);
    if (canonicalWorkflowId === canonicalTarget) {
      return { toolId: canonicalWorkflowId, monthlySpend: normalized.monthlySpend, isConfigured: true };
    }
  }
  return null;
}

function hasConfiguredCost(input: CanonicalInsightInput): boolean {
  const external = input.externalCostConfigs || [];
  for (const raw of external) {
    const normalized = normalizeCostConfigInput(raw);
    if (normalized && normalized.monthlySpend > 0) return true;
  }
  return false;
}

// ─── Helper: Group sessions by canonical workflow ────────────

function groupByWorkflow(sessions: any[], cache?: any): Record<string, any[]> {
  // CR-X FINAL: Use cached workflow grouping when available
  if (cache?.sessionsByWorkflow) return cache.sessionsByWorkflow;
  const groups: Record<string, any[]> = {};
  for (const s of sessions) {
    const tool = normalizeToCanonicalToolId(s.tool ?? s.session_source ?? s.source ?? '');
    if (!tool) continue;
    if (!groups[tool]) groups[tool] = [];
    groups[tool].push(s);
  }
  return groups;
}

function groupByDeveloper(sessions: any[]): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  for (const s of sessions) {
    const dev = s.user_id ?? s.developer_id ?? 'unknown';
    if (!dev) continue;
    const key = String(dev);
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }
  return groups;
}

// ─── Metric definitions for efficiency frontier ──────────────
// Each metric has: field name, extraction function, polarity, label, unit.
// Polarity: 'higher_is_better' for commits/files/active-coding,
//           'lower_is_better' for TTFC.

interface MetricDef {
  key: string;
  label: string;
  unit: string;
  polarity: 'higher_is_better' | 'lower_is_better';
  extract: (session: any) => number | null;
  isEligible: (session: any) => boolean;
}

const METRIC_DEFS: MetricDef[] = [
  {
    key: 'commits_per_session',
    label: 'Commits per session',
    unit: 'commits/session',
    polarity: 'higher_is_better',
    extract: (s) => typeof s.session_commits === 'number' && Number.isFinite(s.session_commits) ? s.session_commits : null,
    isEligible: (s) => typeof s.session_commits === 'number' && Number.isFinite(s.session_commits) && s.session_commits_source === 'observed',
  },
  {
    key: 'active_coding_per_session',
    label: 'Active coding Time per session',
    unit: 'min/session',
    polarity: 'higher_is_better',
    extract: (s) => typeof s.session_active_coding_duration_minutes === 'number' && Number.isFinite(s.session_active_coding_duration_minutes) ? s.session_active_coding_duration_minutes : null,
    isEligible: (s) => typeof s.session_active_coding_duration_minutes === 'number' && Number.isFinite(s.session_active_coding_duration_minutes),
  },
  {
    key: 'ai_activity_per_session',
    label: 'AI Activity per session',
    unit: 'bursts/session',
    polarity: 'higher_is_better',
    extract: (s) => {
      const v = s.session_ai_burst_count ?? s.ai_burst_count ?? null;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    },
    isEligible: (s) => {
      const v = s.session_ai_burst_count ?? s.ai_burst_count ?? null;
      return typeof v === 'number' && Number.isFinite(v);
    },
  },
];

// ─── PI 1: Early-Signal Workflow Adoption ────────────────────

export function generateEarlySignalWorkflowAdoption(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    const registryEntry = getCanonicalPIById('early-signal-workflow-adoption');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    const totalSessions = sessionRows.length;

    if (totalSessions < EARLY_SIGNAL_MIN_SESSIONS) {
      piDebugLog('[EARLY_SIGNAL_ADOPTION][INSUFFICIENT]', { totalSessions, threshold: EARLY_SIGNAL_MIN_SESSIONS });
      return null;
    }

    const byWorkflow = groupByWorkflow(sessionRows, input._engineCache);
    const workflowCount = Object.keys(byWorkflow).length;

    if (workflowCount < EARLY_SIGNAL_MIN_WORKFLOWS) return null;

    // MATURITY GATE: Suppress if any workflow has >= MATURITY_SESSIONS_PER_WORKFLOW
    // sessions. Mature-pilot generators should fire instead.
    const maxWorkflowSessions = Math.max(...Object.values(byWorkflow).map(s => s.length));
    if (maxWorkflowSessions >= MATURITY_SESSIONS_PER_WORKFLOW) {
      piDebugLog('[EARLY_SIGNAL_ADOPTION][MATURE]', { maxWorkflowSessions, threshold: MATURITY_SESSIONS_PER_WORKFLOW });
      return null;
    }

    const breakdown: Record<string, { value: number; label: string; sessions: number }> = {};
    for (const [wf, sessions] of Object.entries(byWorkflow)) {
      breakdown[wf] = {
        value: sessions.length,
        label: wf,
        sessions: sessions.length,
      };
    }

    const sorted = Object.entries(breakdown).sort((a, b) => b[1].sessions - a[1].sessions);
    const topWorkflow = sorted[0];
    const topShare = totalSessions > 0 ? (topWorkflow[1].sessions / totalSessions) * 100 : 0;

    const confidence: ConfidenceLevel = totalSessions < 15 ? 'low' : 'medium';

    return {
      id: 'early-signal-workflow-adoption',
      title: 'Workflow adoption (early signal)',
      cicdStage: 'plan-code',
      canonicalPriority: 100,
      renderOrder: 100,
      presentationType: 'breakdown',
      presentationKind: 'org_summary',
      current: totalSessions,
      hasData: true,
      confidence,
      n: totalSessions,
      coveragePct: 100,
      polarity: 'neutral',
      dataSource: 'live',
      description: `${workflowCount} workflow${workflowCount > 1 ? 's' : ''} detected across ${totalSessions} sessions. Top workflow: ${topWorkflow[0]} (${topShare.toFixed(1)}% of sessions).`,
      whatChanged: `Telemetry is flowing from ${workflowCount} workflow${workflowCount > 1 ? 's' : ''}. This is an early signal — patterns will sharpen as more data accumulates.`,
      whyItMatters: 'Early visibility into which tools your team has adopted. As session volume grows, deeper workflow comparison PIs will unlock.',
      evidenceAndContext: `${totalSessions} total sessions across ${workflowCount} workflow${workflowCount > 1 ? 's' : ''}. Session share: ${sorted.map(([wf, d]) => `${wf}=${d.sessions}`).join(', ')}.`,
      operationalImpact: 'No action required yet. Continue normal usage patterns. Deeper PIs unlock at 25+ sessions per workflow.',
      primaryRisk: 'Sample size is too small for directional conclusions. Do not over-interpret early share differences.',
      confidenceReasoning: `Early signal with ${totalSessions} sessions (threshold: ${EARLY_SIGNAL_MIN_SESSIONS}). Confidence capped at '${confidence}' until 25+ sessions per workflow.`,
      operationalRead: `Data is flowing from ${workflowCount} tool${workflowCount > 1 ? 's' : ''}. This confirms instrumentation is working.`,
      urgencyLabel: 'informational',
      metricDefinition: 'Total sessions per workflow, expressed as a share of all observed sessions.',
      recommendationState: 'monitor_only',
      lifecycleClass: 'contextual',
      breakdownByTool: breakdown as any,
      generatorSource: 'generateEarlySignalWorkflowAdoption',
      engineVersion: 'FINAL_ENGINE_V1',
    };
  } catch (e) {
    piDebugLog('[EARLY_SIGNAL_ADOPTION][ERROR]', e);
    return null;
  }
}

// ─── PI 2: Early-Signal Developer Activity ───────────────────

export function generateEarlySignalDeveloperActivity(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    const registryEntry = getCanonicalPIById('early-signal-developer-activity');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    const totalSessions = sessionRows.length;

    if (totalSessions < EARLY_SIGNAL_MIN_SESSIONS) return null;

    // MATURITY GATE: Suppress if total sessions >= MATURITY_TOTAL_SESSIONS.
    // Mature-pilot generators should fire instead.
    if (totalSessions >= MATURITY_TOTAL_SESSIONS) {
      piDebugLog('[EARLY_SIGNAL_DEV_ACTIVITY][MATURE]', { totalSessions, threshold: MATURITY_TOTAL_SESSIONS });
      return null;
    }

    const byDeveloper = groupByDeveloper(sessionRows);
    const developerCount = Object.keys(byDeveloper).length;

    if (developerCount < EARLY_SIGNAL_MIN_DEVELOPERS) return null;

    const developerSessions = Object.entries(byDeveloper)
      .map(([dev, sessions]) => ({ dev, count: sessions.length }))
      .sort((a, b) => b.count - a.count);

    const maxSessions = developerSessions[0]?.count ?? 0;
    const minSessions = developerSessions[developerSessions.length - 1]?.count ?? 0;
    const avgSessions = developerCount > 0 ? totalSessions / developerCount : 0;

    const inviteBacked = developerSessions.filter(d => d.dev.startsWith('invite:')).length;
    const coveragePct = developerCount > 0 ? (inviteBacked / developerCount) * 100 : 0;

    const confidence: ConfidenceLevel = totalSessions < 15 ? 'low' : 'medium';

    return {
      id: 'early-signal-developer-activity',
      title: 'Developer activity (early signal)',
      cicdStage: 'plan-code',
      canonicalPriority: 101,
      renderOrder: 101,
      presentationType: 'breakdown',
      presentationKind: 'org_summary',
      current: developerCount,
      hasData: true,
      confidence,
      n: totalSessions,
      coveragePct,
      polarity: 'neutral',
      dataSource: 'live',
      description: `${developerCount} developer${developerCount > 1 ? 's' : ''} active across ${totalSessions} sessions. Average: ${avgSessions.toFixed(1)} sessions/developer. Invite-backed identity: ${inviteBacked}/${developerCount} (${coveragePct.toFixed(0)}%).`,
      whatChanged: `${developerCount} developer${developerCount > 1 ? 's have' : ' has'} sent telemetry. Activity ranges from ${minSessions} to ${maxSessions} sessions.`,
      whyItMatters: 'Confirms team onboarding is progressing. Invite-backed identity coverage indicates how many developers have completed the enrollment flow.',
      evidenceAndContext: `Developers: ${developerSessions.map(d => `${d.dev}=${d.count}`).join(', ')}. Invite-backed: ${inviteBacked}/${developerCount}.`,
      operationalImpact: coveragePct < 50
        ? `${developerCount - inviteBacked} developer(s) lack invite-backed identity. Encourage enrollment to improve attribution accuracy.`
        : 'Identity coverage is healthy. Continue normal usage.',
      primaryRisk: 'Early activity levels may not represent steady-state patterns. Do not draw productivity conclusions yet.',
      confidenceReasoning: `Early signal with ${developerCount} developer(s) and ${totalSessions} sessions. Confidence capped at '${confidence}'.`,
      operationalRead: `${developerCount} developer${developerCount > 1 ? 's' : ''} onboarded, ${coveragePct.toFixed(0)}% with invite-backed identity.`,
      urgencyLabel: 'informational',
      metricDefinition: 'Distinct developers with at least one telemetry session, with per-developer session counts.',
      recommendationState: coveragePct < 50 ? 'investigate' : 'monitor_only',
      lifecycleClass: 'contextual',
      breakdownByTool: Object.fromEntries(developerSessions.map(d => [d.dev, { value: d.count, label: d.dev, sessions: d.count }])) as any,
      generatorSource: 'generateEarlySignalDeveloperActivity',
      engineVersion: 'FINAL_ENGINE_V1',
    };
  } catch (e) {
    piDebugLog('[EARLY_SIGNAL_DEV_ACTIVITY][ERROR]', e);
    return null;
  }
}

// ─── PI 3: Developer×Workflow×Metric×Cost Efficiency Frontier ─
//
// CORRECTED per P2: Compares developers using the SAME workflow on the
// SAME metric. Does NOT use session volume as performance. Does NOT
// have a sessions-only fallback. If configured cost is unavailable,
// this PI DOES NOT FIRE.
//
// Pareto frontier across:
//   performance metric (e.g., commits/session)
//   AND
//   cost efficiency metric (e.g., $/commit)
//
// For a given workflow + metric:
// - Group sessions by developer (authoritative identity only)
// - Filter to developers with >= EFFICIENCY_MIN_SESSIONS_PER_DEVELOPER
// - Require >= EFFICIENCY_MIN_COHORT_SIZE qualifying developers
// - Compute per-developer: avg metric value, allocated cost, cost per unit
// - Identify Pareto frontier: non-dominated on (metric value, cost efficiency)
// - Report frontier developers with their metric, N, cost basis

export function generateDeveloperWorkflowCostEfficiencyFrontier(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    const registryEntry = getCanonicalPIById('developer-workflow-cost-efficiency-frontier');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    const totalSessions = sessionRows.length;

    if (totalSessions < EARLY_SIGNAL_MIN_SESSIONS) return null;

    // GATE 1: Configured cost must be available. If not, DO NOT FIRE.
    if (!hasConfiguredCost(input)) {
      piDebugLog('[EFFICIENCY_FRONTIER][NO_COST]', 'No configured cost — PI does not fire (no sessions-only fallback).');
      return null;
    }

    // Group sessions by workflow
    const byWorkflow = groupByWorkflow(sessionRows, input._engineCache);

    // Try each metric def. Use the first metric that produces a qualifying cohort.
    for (const metricDef of METRIC_DEFS) {
      piDebugLog('[EFFICIENCY_FRONTIER][TRY_METRIC]', { metric: metricDef.key });

      // For each workflow, build a developer cohort
      for (const [workflow, wfSessions] of Object.entries(byWorkflow)) {
        // Filter to sessions eligible for this metric
        const eligibleSessions = wfSessions.filter(s => metricDef.isEligible(s));
        if (eligibleSessions.length === 0) continue;

        // Group by developer (authoritative identity only — invite-backed)
        const byDev: Record<string, any[]> = {};
        for (const s of eligibleSessions) {
          const dev = String(s.user_id ?? s.developer_id ?? '');
          if (!dev || dev === 'unknown') continue;
          // Only authoritative (invite-backed) developer identity
          if (!dev.startsWith('invite:')) continue;
          if (!byDev[dev]) byDev[dev] = [];
          byDev[dev].push(s);
        }

        // Filter to developers with minimum session count
        const qualifyingDevs = Object.entries(byDev)
          .filter(([_, sessions]) => sessions.length >= EFFICIENCY_MIN_SESSIONS_PER_DEVELOPER)
          .map(([dev, sessions]) => {
            const metricValues = sessions.map(s => metricDef.extract(s)).filter((v): v is number => v !== null);
            const avgMetric = metricValues.length > 0 ? metricValues.reduce((a, b) => a + b, 0) / metricValues.length : 0;

            // Allocated cost: configured monthly spend for this workflow / number of eligible developers
            const costCfg = resolveCostConfig(input, workflow);
            const monthlySpend = costCfg?.monthlySpend ?? 0;
            const eligibleDevCount = Object.keys(byDev).length;
            const allocatedCost = eligibleDevCount > 0 ? monthlySpend / eligibleDevCount : 0;

            // Cost efficiency: $ per unit of metric
            // For higher_is_better: cost per metric unit (lower is better)
            // For lower_is_better: cost per metric unit (lower is better)
            const costPerUnit = avgMetric > 0 && allocatedCost > 0 ? allocatedCost / avgMetric : null;

            return {
              developer: dev,
              workflow,
              metricKey: metricDef.key,
              metricLabel: metricDef.label,
              metricUnit: metricDef.unit,
              polarity: metricDef.polarity,
              avgMetric,
              sessionCount: sessions.length,
              monthlySpend,
              allocatedCost,
              costPerUnit,
            };
          });

        if (qualifyingDevs.length < EFFICIENCY_MIN_COHORT_SIZE) continue;

        // Compute cohort median for comparison context
        const metricValues = qualifyingDevs.map(d => d.avgMetric).sort((a, b) => a - b);
        const median = metricValues.length % 2 === 0
          ? (metricValues[metricValues.length / 2 - 1] + metricValues[metricValues.length / 2]) / 2
          : metricValues[Math.floor(metricValues.length / 2)];

        // Pareto frontier: a developer is on the frontier if no other developer
        // dominates them. Domination for higher_is_better:
        //   other has >= avgMetric AND <= costPerUnit (with at least one strict)
        // For lower_is_better:
        //   other has <= avgMetric AND <= costPerUnit
        const frontier = qualifyingDevs.filter(p => {
          return !qualifyingDevs.some(q => {
            if (q === p) return false;
            if (metricDef.polarity === 'higher_is_better') {
              return q.avgMetric >= p.avgMetric
                && (q.costPerUnit ?? Infinity) <= (p.costPerUnit ?? Infinity)
                && (q.avgMetric > p.avgMetric || (q.costPerUnit ?? Infinity) < (p.costPerUnit ?? Infinity));
            } else {
              return q.avgMetric <= p.avgMetric
                && (q.costPerUnit ?? Infinity) <= (p.costPerUnit ?? Infinity)
                && (q.avgMetric < p.avgMetric || (q.costPerUnit ?? Infinity) < (p.costPerUnit ?? Infinity));
            }
          });
        });

        // Sort frontier by metric value (best first)
        frontier.sort((a, b) => metricDef.polarity === 'higher_is_better'
          ? b.avgMetric - a.avgMetric
          : a.avgMetric - b.avgMetric);

        const topDev = frontier[0];
        if (!topDev) continue;

        // Build breakdown for display
        const breakdown: Record<string, any> = {};
        for (const d of frontier.slice(0, 10)) {
          const key = `${d.developer}×${d.workflow}`;
          breakdown[key] = {
            value: d.avgMetric,
            label: key,
            sessions: d.sessionCount,
            allocatedCost: d.allocatedCost,
            costPerUnit: d.costPerUnit,
            metricLabel: d.metricLabel,
          };
        }

        const confidence: ConfidenceLevel = totalSessions < 50 ? 'low' : 'medium';

        // Compute delta vs cohort median for top developer
        const metricDeltaPct = median > 0
          ? ((topDev.avgMetric - median) / median) * 100
          : null;
        const costDeltaPct = topDev.costPerUnit !== null && median > 0
          ? (() => {
              const medianCostPerUnit = qualifyingDevs
                .map(d => d.costPerUnit)
                .filter((v): v is number => v !== null)
                .sort((a, b) => a - b);
              const medCost = medianCostPerUnit.length % 2 === 0
                ? (medianCostPerUnit[medianCostPerUnit.length / 2 - 1] + medianCostPerUnit[medianCostPerUnit.length / 2]) / 2
                : medianCostPerUnit[Math.floor(medianCostPerUnit.length / 2)];
              return medCost > 0 ? ((topDev.costPerUnit! - medCost) / medCost) * 100 : null;
            })()
          : null;

        const metricDesc = metricDef.polarity === 'higher_is_better'
          ? (metricDeltaPct !== null && metricDeltaPct > 0
            ? `+${metricDeltaPct.toFixed(0)}% ${metricDef.label.toLowerCase()} vs cohort median`
            : `${metricDeltaPct?.toFixed(0) ?? 'N/A'}% ${metricDef.label.toLowerCase()} vs cohort median`)
          : (metricDeltaPct !== null && metricDeltaPct < 0
            ? `${metricDeltaPct.toFixed(0)}% ${metricDef.label.toLowerCase()} vs cohort median (lower is better)`
            : `${metricDeltaPct?.toFixed(0) ?? 'N/A'}% ${metricDef.label.toLowerCase()} vs cohort median`);

        const costDesc = costDeltaPct !== null
          ? `${costDeltaPct > 0 ? '+' : ''}${costDeltaPct.toFixed(0)}% configured cost/${metricDef.unit.split('/')[0]} vs cohort median`
          : 'cost efficiency N/A';

        return {
          id: 'developer-workflow-cost-efficiency-frontier',
          title: `Developer×workflow efficiency frontier (${metricDef.label}, ${workflow})`,
          cicdStage: 'plan-code',
          canonicalPriority: 102,
          renderOrder: 102,
          presentationType: 'breakdown',
          presentationKind: 'org_summary',
          current: frontier.length,
          hasData: true,
          confidence,
          n: qualifyingDevs.reduce((sum, d) => sum + d.sessionCount, 0),
          coveragePct: 100,
          polarity: 'neutral',
          dataSource: 'live',
          description: `${frontier.length} developer${frontier.length > 1 ? 's are' : ' is'} on the Pareto efficiency frontier for ${metricDef.label} using ${workflow}. Top: ${topDev.developer} — ${metricDesc}, ${costDesc}. N=${topDev.sessionCount} ${workflow} sessions.`,
          whatChanged: `Efficiency frontier identifies ${frontier.length} non-dominated developer(s) from a cohort of ${qualifyingDevs.length} qualifying developers using ${workflow} with ≥${EFFICIENCY_MIN_SESSIONS_PER_DEVELOPER} sessions each. Metric: ${metricDef.label}.`,
          whyItMatters: 'The efficiency frontier shows which developers maximize performance per unit configured cost on the SAME workflow with the SAME metric. Developers NOT on the frontier are dominated — equal or better performance is achievable at lower or equal configured cost. This is NOT an employee-performance judgment.',
          evidenceAndContext: `Workflow: ${workflow}. Metric: ${metricDef.label} (${metricDef.polarity}). Cohort: ${qualifyingDevs.length} developers, ${qualifyingDevs.reduce((s, d) => s + d.sessionCount, 0)} total sessions. Frontier: ${frontier.length} non-dominated. Cohort median: ${median.toFixed(2)} ${metricDef.unit}. Configured spend: $${topDev.monthlySpend.toFixed(0)}/mo for ${workflow}, allocated across ${qualifyingDevs.length} developers = $${topDev.allocatedCost.toFixed(2)}/developer/month.`,
          operationalImpact: 'Review dominated developers — could the same metric output be achieved with lower configured cost? Consider task/repo-mix differences before drawing conclusions.',
          primaryRisk: 'Configured estimate, not billing data. Neutral task/repo-mix caveat — developers may work on different complexity tasks. No causal attribution. Not an employee-performance judgment. Sample size affects reliability.',
          confidenceReasoning: `${qualifyingDevs.length} qualifying developers with ≥${EFFICIENCY_MIN_SESSIONS_PER_DEVELOPER} sessions each on ${workflow}. Metric: ${metricDef.label} with ${metricDef.polarity}. Cost: $${topDev.monthlySpend.toFixed(0)}/mo configured for ${workflow}. Confidence: '${confidence}'.`,
          operationalRead: `${frontier.length} efficient developer(s) on ${metricDef.label}×${workflow} frontier. Top: ${topDev.developer} (${metricDesc}, ${costDesc}).`,
          urgencyLabel: 'informational',
          metricDefinition: `Pareto efficiency frontier: developers not dominated on (${metricDef.label}, $/${metricDef.unit.split('/')[0]}) within the same workflow (${workflow}). Cohort median computed from ${qualifyingDevs.length} qualifying developers.`,
          recommendationState: 'investigate',
          lifecycleClass: 'contextual',
          breakdownByTool: breakdown as any,
          generatorSource: 'generateDeveloperWorkflowCostEfficiencyFrontier',
          engineVersion: 'FINAL_ENGINE_V1',
        };
      }
    }

    // No metric + workflow combination produced a qualifying cohort
    piDebugLog('[EFFICIENCY_FRONTIER][NO_QUALIFYING_COHORT]', 'No workflow+metric combination met cohort thresholds.');
    return null;
  } catch (e) {
    piDebugLog('[EFFICIENCY_FRONTIER][ERROR]', e);
    return null;
  }
}

// ─── PI 4: Workflow Cost vs Delivery Outcome Comparison ──────
//
// CR-X Slice 3: Compares configured cost per workflow against
// observed delivery outcomes (PRs merged, deployments) from
// outcomesByMonth. Answers: "Which workflows have high configured
// cost but no corresponding observed delivery advantage?"
//
// Gates:
// - At least one workflow with configured cost
// - At least one month of delivery outcomes with count_authority === 'observed_rows'
// - Not a causal claim — configured estimate, not billing data
// - Task/repo-mix caveat applies

export function generateWorkflowCostDeliveryComparison(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    const registryEntry = getCanonicalPIById('workflow-cost-delivery-comparison');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length < 20) return null;

    // CR-X R2: FAIL CLOSED — delivery outcomes are org-level (outcomesByMonth).
    // There is no authoritative workflow→delivery attribution today.
    // This generator would present per-workflow cost alongside org-level delivery,
    // which implies workflow ownership of delivery that does not exist.
    // Suppressed until authoritative workflow-level delivery attribution is available.
    piDebugLog('[COST_DELIVERY][FAIL_CLOSED]', 'Delivery outcomes are org-level — no workflow attribution authority. Generator suppressed.');
    return null;

    // Collect configured cost per workflow
    const costByWorkflow: Record<string, { monthlySpend: number; sessions: number }> = {};
    const byWorkflow = groupByWorkflow(sessionRows, input._engineCache);

    let totalConfiguredSpend = 0;
    for (const [workflow, sessions] of Object.entries(byWorkflow)) {
      const cfg = resolveCostConfig(input, workflow);
      if (cfg && cfg.monthlySpend > 0) {
        costByWorkflow[workflow] = { monthlySpend: cfg.monthlySpend, sessions: sessions.length };
        totalConfiguredSpend += cfg.monthlySpend;
      }
    }

    if (totalConfiguredSpend === 0) {
      piDebugLog('[COST_DELIVERY][NO_COST]', 'No configured cost — PI does not fire.');
      return null;
    }

    // Collect delivery outcomes from outcomesByMonth
    const outcomes = input.outcomesByMonth || [];
    const observedOutcomes = outcomes.filter(
      (o: any) => o.count_authority === 'observed_rows'
    );

    if (observedOutcomes.length === 0) {
      piDebugLog('[COST_DELIVERY][NO_OUTCOMES]', 'No observed delivery outcomes.');
      return null;
    }

    // Aggregate delivery totals
    let totalMergedPRs = 0;
    let totalDeployments = 0;
    let totalSuccessfulDeployments = 0;
    for (const o of observedOutcomes) {
      totalMergedPRs += o.merged_pr_count ?? 0;
      totalDeployments += o.deployment_count ?? 0;
      totalSuccessfulDeployments += o.successful_deployment_count ?? 0;
    }

    if (totalMergedPRs === 0 && totalDeployments === 0) {
      piDebugLog('[COST_DELIVERY][ZERO_DELIVERY]', 'No observed delivery activity.');
      return null;
    }

    // Compute cost per merged PR and cost per deployment (org-level)
    const costPerMergedPR = totalMergedPRs > 0 ? totalConfiguredSpend / totalMergedPRs : null;
    const costPerDeployment = totalDeployments > 0 ? totalConfiguredSpend / totalDeployments : null;
    const months = observedOutcomes.length;

    // Build per-workflow breakdown
    const workflowEntries = Object.entries(costByWorkflow)
      .sort((a, b) => b[1].monthlySpend - a[1].monthlySpend);

    const breakdown: Record<string, any> = {};
    for (const [wf, data] of workflowEntries) {
      const costShare = totalConfiguredSpend > 0 ? (data.monthlySpend / totalConfiguredSpend * 100).toFixed(0) : '0';
      breakdown[wf] = {
        value: data.monthlySpend,
        label: wf,
        sessions: data.sessions,
        formatted: `$${data.monthlySpend.toFixed(0)}/mo`,
        costShare: `${costShare}%`,
      };
    }

    const topWorkflow = workflowEntries[0]?.[0] ?? 'unknown';
    const topSpend = workflowEntries[0]?.[1]?.monthlySpend ?? 0;
    const topShare = totalConfiguredSpend > 0
      ? ((topSpend / totalConfiguredSpend) * 100).toFixed(0) : '0';

    const confidence: ConfidenceLevel = sessionRows.length >= 100 && months >= 2 ? 'medium' : 'low';

    return {
      id: 'workflow-cost-delivery-comparison',
      title: `Configured spend: $${totalConfiguredSpend.toFixed(0)}/mo across ${workflowEntries.length} workflow${workflowEntries.length > 1 ? 's' : ''} — ${topWorkflow} is ${topShare}% of spend`,
      cicdStage: 'plan-code',
      canonicalPriority: 103,
      renderOrder: 200,
      presentationType: 'breakdown',
      presentationKind: 'org_summary',
      current: totalConfiguredSpend,
      hasData: true,
      confidence,
      n: sessionRows.length,
      coveragePct: 100,
      polarity: 'neutral',
      dataSource: 'live',
      description: `Total configured AI tool spend is $${totalConfiguredSpend.toFixed(0)}/mo across ${workflowEntries.length} workflow(s). Over ${months} observed month(s): ${totalMergedPRs} merged PRs, ${totalDeployments} deployments (${totalSuccessfulDeployments} successful).${costPerMergedPR !== null ? ` Configured cost per merged PR: $${costPerMergedPR.toFixed(0)}.` : ''}${costPerDeployment !== null ? ` Configured cost per deployment: $${costPerDeployment.toFixed(0)}.` : ''}`,
      whatChanged: `Workflow cost allocation vs observed delivery outcomes. ${topWorkflow} accounts for ${topShare}% of configured spend ($${topSpend.toFixed(0)}/mo).`,
      whyItMatters: 'Comparing configured tool cost against observed delivery outcomes reveals whether high-cost workflows correlate with proportional delivery. This is a configured estimate, not billing data. Delivery outcomes are org-level and cannot be attributed to individual workflows.',
      evidenceAndContext: `Configured spend: ${workflowEntries.map(([wf, d]) => `${wf}=$${d.monthlySpend.toFixed(0)}/mo (${d.sessions} sessions)`).join(', ')}. Observed outcomes (${months} months): ${totalMergedPRs} merged PRs, ${totalDeployments} deployments.${costPerMergedPR !== null ? ` $/merged PR: $${costPerMergedPR.toFixed(0)}.` : ''}${costPerDeployment !== null ? ` $/deployment: $${costPerDeployment.toFixed(0)}.` : ''}`,
      operationalImpact: 'Review whether workflows consuming the largest share of configured spend are associated with proportional delivery activity. Delivery outcomes are org-level — cost-to-delivery ratios are organizational, not per-workflow causal attribution.',
      primaryRisk: 'Configured estimate based on your tool costs. Delivery outcomes are org-level. No causal attribution to individual workflows.',
      confidenceReasoning: `${workflowEntries.length} workflow(s) with configured cost, ${months} month(s) of observed delivery data, ${sessionRows.length} total sessions. Confidence: '${confidence}'.`,
      operationalRead: `$${totalConfiguredSpend.toFixed(0)}/mo configured spend → ${totalMergedPRs} PRs, ${totalDeployments} deployments over ${months} month(s).${costPerMergedPR !== null ? ` $/PR: $${costPerMergedPR.toFixed(0)}.` : ''}`,
      urgencyLabel: totalConfiguredSpend > 1000 && totalMergedPRs < 10 ? 'investigate' : 'monitor',
      metricDefinition: 'Configured tool spend vs observed delivery outcomes (merged PRs, deployments). Org-level attribution only.',
      recommendationState: 'investigate',
      lifecycleClass: 'decision',
      breakdownByTool: breakdown as any,
      generatorSource: 'generateWorkflowCostDeliveryComparison',
      engineVersion: 'FINAL_ENGINE_V1',
    };
  } catch (e) {
    piDebugLog('[COST_DELIVERY][ERROR]', e);
    return null;
  }
}

// ─── PI 5: Workflow Delivery Efficiency ──────────────────────
//
// CR-X Slice 3: Analyzes delivery efficiency per workflow by
// comparing sessions, merge cycle time, and observed outcomes.
// Answers: "Which workflows appear expensive per successful
// deployment?" and "Which workflow/repo combinations show
// long merge cycles?"
//
// This generator uses outcomesByMonth for delivery data and
// sessionRows for workflow attribution. No causal claim.

export function generateWorkflowDeliveryEfficiency(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    const registryEntry = getCanonicalPIById('workflow-delivery-efficiency');
    if (!registryEntry) return null;

    // CR-X R2: FAIL CLOSED — delivery outcomes are org-level (outcomesByMonth).
    // This generator would compute per-workflow sessionsPerMergedPR / sessionsPerDeploy
    // using org-level delivery totals, which implies a per-workflow delivery relationship
    // that does not exist. Suppressed until authoritative workflow-level delivery
    // attribution is available.
    piDebugLog('[DELIVERY_EFFICIENCY][FAIL_CLOSED]', 'Delivery outcomes are org-level — no workflow attribution authority. Generator suppressed.');
    return null;

    const byWorkflow = groupByWorkflow(sessionRows, input._engineCache);
    const workflowNames = Object.keys(byWorkflow);
    if (workflowNames.length < 2) return null; // need comparison

    // Collect delivery outcomes
    const outcomes = input.outcomesByMonth || [];
    const observedOutcomes = outcomes.filter(
      (o: any) => o.count_authority === 'observed_rows'
    );
    if (observedOutcomes.length === 0) return null;

    let totalMergedPRs = 0;
    let totalDeployments = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    for (const o of observedOutcomes) {
      totalMergedPRs += o.merged_pr_count ?? 0;
      totalDeployments += o.deployment_count ?? 0;
      totalSuccessful += o.successful_deployment_count ?? 0;
      totalFailed += o.failed_deployment_count ?? 0;
    }

    if (totalMergedPRs === 0 && totalDeployments === 0) return null;

    // Per-workflow session volume + cost
    const workflowStats: Array<{
      workflow: string; sessions: number; pctSessions: number;
      monthlySpend: number; hasCost: boolean;
      sessionsPerMergedPR: number | null; sessionsPerDeploy: number | null;
    }> = [];

    for (const [wf, sessions] of Object.entries(byWorkflow)) {
      const cfg = resolveCostConfig(input, wf);
      const pctSessions = sessionRows.length > 0 ? (sessions.length / sessionRows.length) * 100 : 0;
      workflowStats.push({
        workflow: wf,
        sessions: sessions.length,
        pctSessions,
        monthlySpend: cfg?.monthlySpend ?? 0,
        hasCost: !!(cfg && cfg.monthlySpend > 0),
        sessionsPerMergedPR: totalMergedPRs > 0 ? sessions.length / totalMergedPRs : null,
        sessionsPerDeploy: totalDeployments > 0 ? sessions.length / totalDeployments : null,
      });
    }

    workflowStats.sort((a, b) => b.sessions - a.sessions);

    const deploySuccessRate = totalDeployments > 0
      ? (totalSuccessful / totalDeployments * 100).toFixed(0) : null;

    // Build breakdown
    const breakdown: Record<string, any> = {};
    for (const ws of workflowStats) {
      breakdown[ws.workflow] = {
        value: ws.sessions,
        label: ws.workflow,
        sessions: ws.sessions,
        pctSessions: `${ws.pctSessions.toFixed(0)}%`,
        monthlySpend: ws.hasCost ? `$${ws.monthlySpend.toFixed(0)}/mo` : 'not configured',
        sessionsPerPR: ws.sessionsPerMergedPR !== null ? ws.sessionsPerMergedPR.toFixed(1) : 'N/A',
        sessionsPerDeploy: ws.sessionsPerDeploy !== null ? ws.sessionsPerDeploy.toFixed(1) : 'N/A',
      };
    }

    const months = observedOutcomes.length;
    const prsPerMonth = months > 0 ? (totalMergedPRs / months).toFixed(1) : '0';
    const deploysPerMonth = months > 0 ? (totalDeployments / months).toFixed(1) : '0';

    const confidence: ConfidenceLevel = sessionRows.length >= 100 && months >= 2 ? 'medium' : 'low';

    return {
      id: 'workflow-delivery-efficiency',
      title: `${totalMergedPRs} PRs merged, ${totalDeployments} deployments over ${months} month(s)${deploySuccessRate ? ` — ${deploySuccessRate}% deploy success` : ''}`,
      cicdStage: 'deploy-operate',
      canonicalPriority: 104,
      renderOrder: 201,
      presentationType: 'breakdown',
      presentationKind: 'org_summary',
      current: totalMergedPRs,
      baseline: totalDeployments,
      hasData: true,
      confidence,
      n: sessionRows.length,
      coveragePct: 100,
      polarity: 'neutral',
      dataSource: 'live',
      description: `Over ${months} observed month(s): ${totalMergedPRs} merged PRs (${prsPerMonth}/mo), ${totalDeployments} deployments (${deploysPerMonth}/mo, ${totalSuccessful} successful, ${totalFailed} failed).${deploySuccessRate ? ` Deploy success rate: ${deploySuccessRate}%.` : ''} Session volume by workflow: ${workflowStats.map(ws => `${ws.workflow}=${ws.sessions} (${ws.pctSessions.toFixed(0)}%)`).join(', ')}.`,
      whatChanged: `Delivery efficiency across ${workflowNames.length} workflows. ${totalMergedPRs} PRs and ${totalDeployments} deployments observed.`,
      whyItMatters: 'Correlating session volume by workflow with org-level delivery outcomes shows which workflows are most active during high-delivery periods. This is association, not causal attribution.',
      evidenceAndContext: `Workflows: ${workflowStats.map(ws => `${ws.workflow}: ${ws.sessions} sessions (${ws.pctSessions.toFixed(0)}%)${ws.hasCost ? `, $${ws.monthlySpend.toFixed(0)}/mo` : ''}`).join(' | ')}. Delivery (${months} months): ${totalMergedPRs} merged PRs, ${totalDeployments} deploys (${totalSuccessful} success, ${totalFailed} failed).`,
      operationalImpact: `Review workflow session distribution relative to delivery velocity. ${prsPerMonth} PRs/mo and ${deploysPerMonth} deploys/mo.${totalFailed > 0 ? ` ${totalFailed} failed deployment(s) warrant investigation.` : ''}`,
      primaryRisk: 'Delivery outcomes are org-level and cannot be attributed to individual workflows. Session volume correlates with usage, not with output. No causal claim.',
      confidenceReasoning: `${workflowNames.length} workflows, ${months} month(s) of observed delivery data, ${sessionRows.length} total sessions. Confidence: '${confidence}'.`,
      operationalRead: `${totalMergedPRs} PRs, ${totalDeployments} deploys (${deploysPerMonth}/mo).${deploySuccessRate ? ` Success: ${deploySuccessRate}%.` : ''} Top workflow: ${workflowStats[0]?.workflow} (${workflowStats[0]?.pctSessions.toFixed(0)}% of sessions).`,
      urgencyLabel: totalFailed > 5 ? 'investigate' : 'monitor',
      metricDefinition: 'Observed delivery outcomes (merged PRs, deployments) correlated with workflow session volume. Org-level association.',
      recommendationState: totalFailed > 0 ? 'investigate' : 'monitor_only',
      lifecycleClass: 'decision',
      breakdownByTool: breakdown as any,
      generatorSource: 'generateWorkflowDeliveryEfficiency',
      engineVersion: 'FINAL_ENGINE_V1',
    };
  } catch (e) {
    piDebugLog('[DELIVERY_EFFICIENCY][ERROR]', e);
    return null;
  }
}

// ─── CR-X Track F: Claude Code runtime cohort intelligence ─────
// Treats Claude Code as a terminal/agent workflow, NOT an IDE.
// Claude Code bridge sends active_coding_duration_ms: null by contract
// (not observable from Claude Code hooks). Therefore this generator does
// NOT emit any "agent runtime share" or "active-coding ratio" — that would
// label a permanently-null field as if it measured something.
// Never implies zero observed AI signals means "non-AI" — zero is measured
// data, not absence. null/undefined/missing = UNKNOWN, not zero.

const CC_MIN_SESSIONS = 5;
const CC_SHORT_MODE_MINUTES = 30; // < 30min wall-clock = short delegated run

type AiSignalCohort = 'unknown' | 'zero' | 'low' | 'medium' | 'high';

function aiSignalCohort(aiBurstCount: number | null | undefined): AiSignalCohort {
  if (aiBurstCount === null || aiBurstCount === undefined) return 'unknown';
  if (aiBurstCount === 0) return 'zero';
  if (aiBurstCount <= 3) return 'low';
  if (aiBurstCount <= 12) return 'medium';
  return 'high';
}

/**
 * Claude Code runtime modes and AI-signal cohorts.
 *
 * Surfaces: short vs long delegated run mode split, AI-signal cohort
 * distribution (zero/low/medium/high), repo concentration, observed commits.
 * No causal language. Never claims zero AI signals = non-AI. Cohort only —
 * not workflow attribution of delivery outcomes.
 */
export function generateClaudeCodeRuntimeCohort(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('claude-code-runtime-cohort');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const ccSessions = sessionRows.filter((s) => {
    const tool = normalizeToCanonicalToolId(s.tool ?? s.session_source ?? s.source ?? '');
    return tool === 'claude_code';
  });

  if (ccSessions.length < CC_MIN_SESSIONS) {
    piDebugLog('[GENERATOR_CC_RUNTIME_COHORT][NO_DATA]', { ccSessions: ccSessions.length, required: CC_MIN_SESSIONS });
    return null;
  }

  const total = ccSessions.length;

  // Mode split: short vs long delegated run (wall-clock duration_ms)
  let shortMode = 0;
  let longMode = 0;
  let totalWallClockMs = 0;
  for (const s of ccSessions) {
    const durMs = typeof s.duration_ms === 'number' ? s.duration_ms : 0;
    totalWallClockMs += durMs;
    const minutes = durMs / 60000;
    if (minutes > 0 && minutes < CC_SHORT_MODE_MINUTES) shortMode++;
    else if (minutes >= CC_SHORT_MODE_MINUTES) longMode++;
  }
  const shortPct = total > 0 ? (shortMode / total) * 100 : 0;
  const longPct = total > 0 ? (longMode / total) * 100 : 0;

  // AI-signal cohort distribution.
  // unknown = null/undefined/missing ai_burst_count (NOT zero).
  // zero = explicitly observed 0 AI bursts (measured data).
  const cohorts = { unknown: 0, zero: 0, low: 0, medium: 0, high: 0 };
  for (const s of ccSessions) {
    cohorts[aiSignalCohort(s.ai_burst_count)]++;
  }
  const observedAiDenominator = total - cohorts.unknown;

  // Repo concentration
  const repoCounts: Record<string, number> = {};
  for (const s of ccSessions) {
    const repo = s.git_repo_url ?? s.repo;
    if (!repo) continue;
    repoCounts[repo] = (repoCounts[repo] || 0) + 1;
  }
  const repoEntries = Object.entries(repoCounts).sort((a, b) => b[1] - a[1]);
  const topRepo = repoEntries[0];
  const repoConcentrationPct = topRepo && total > 0 ? (topRepo[1] / total) * 100 : 0;

  // Observed commits
  const observedCommitSessions = ccSessions.filter((s) => s.session_commits_source === 'observed');
  const totalObservedCommits = observedCommitSessions.reduce((sum, s) => sum + (typeof s.session_commits === 'number' ? s.session_commits : 0), 0);

  const avgWallClockMin = total > 0 ? (totalWallClockMs / total) / 60000 : 0;
  // Confidence is intentionally low: this is an observational cohort PI,
  // not a causal or attributed finding. Sample size does not elevate it.
  const confidence: ConfidenceLevel = 'low';

  const dominantMode = shortPct >= longPct ? 'short delegated run' : 'long delegated run';
  const dominantCohort = (Object.entries(cohorts).sort((a, b) => b[1] - a[1])[0] || ['unknown', 0])[0];

  // CR-X FINAL: Executive-language title. Claude Code is a delegated agent —
  // never use "interactive" for delegated-agent activity. Use "delegated run"
  // for short sessions and "long delegated run" for long sessions.
  const title = dominantMode === 'long delegated run'
    ? `Claude Code is being used primarily for long delegated runs`
    : `Claude Code is being used primarily for short delegated runs`;

  const aiCohortBreakdown = `zero: ${cohorts.zero}, low: ${cohorts.low}, medium: ${cohorts.medium}, high: ${cohorts.high}`;
  const unknownNote = cohorts.unknown > 0
    ? ` ${cohorts.unknown} session(s) have unknown AI-signal (missing ai_burst_count) — excluded from the ${observedAiDenominator}-session observed-AI denominator.`
    : '';

  const description = `${total} Claude Code sessions observed. Mode split: ${shortMode} short delegated run (${shortPct.toFixed(0)}%), ${longMode} long delegated run (${longPct.toFixed(0)}%). AI-signal cohorts (observed denominator: ${observedAiDenominator}) — ${aiCohortBreakdown}.${unknownNote} Average wall-clock: ${avgWallClockMin.toFixed(1)} min.` +
    (topRepo ? ` Top repo: ${topRepo[0]} (${repoConcentrationPct.toFixed(0)}% of sessions).` : '') +
    (observedCommitSessions.length > 0 ? ` Observed commits: ${totalObservedCommits} across ${observedCommitSessions.length} sessions.` : '') +
    ` Zero AI-signal sessions are measured data, not non-AI usage.`;

  return {
    id: registryEntry.id,
    title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'cohort_summary',
    presentationKind: 'cohort_comparison',
    comparisonMode: 'absolute',
    comparisonState: 'org_level_only',
    attributionStatus: 'org_level_only',
    current: total,
    baseline: 0,
    delta: 0,
    deltaPct: 0,
    rightMetric: `${total} sessions`,
    rightMetricLabel: 'Claude Code Sessions',
    metricValue: total,
    displayValue: String(total),
    displayUnit: 'sessions',
    metricDefinition: 'Claude Code session cohort analysis: runtime mode split (wall-clock), AI-signal cohort distribution (observed denominator excludes unknown), repo concentration, observed commits. Cohort only — not workflow attribution of delivery outcomes.',
    polarity: 'neutral',
    operationalBreadcrumbs: [
      `${shortMode} short / ${longMode} long`,
      `AI: ${cohorts.zero}z ${cohorts.low}l ${cohorts.medium}m ${cohorts.high}h${cohorts.unknown > 0 ? ` ${cohorts.unknown}?` : ''}`,
      `${avgWallClockMin.toFixed(0)} min avg wall-clock`,
    ],
    confidence,
    coveragePct: 100,
    n: total,
    hasData: true,
    dataDomain: 'telemetry',
    sourceLabel: 'Telemetry',
    sampleUnit: 'sessions',
    sampleLabel: `${total} Claude Code sessions`,
    description,
    whatChanged: `Claude Code: ${dominantMode} dominant mode, ${avgWallClockMin.toFixed(1)} min avg wall-clock${cohorts.unknown > 0 ? `, ${cohorts.unknown} sessions have missing AI-signal data` : ''}.`,
    whyItMatters: 'Claude Code runtime modes characterize how the workflow is used, distinct from IDE-based coding.',
    recommendation: 'Use cohort patterns to contextualize Claude Code adoption. Associate with Review & Merge and Deploy & Operate outcomes only where provenance permits.',
    evidenceAndContext: description,
    operationalImpact: `Claude Code cohort of ${total} sessions with ${dominantMode} dominant mode.`,
    primaryRisk: 'Zero AI-signal sessions are measured data, not non-AI usage. Unknown AI-signal sessions have missing ai_burst_count, not zero. Cohort patterns are observational, not causal.',
    cohort: 'Claude Code',
    confidenceReasoning: `Low confidence (experimental, cohort-only) based on ${total} Claude Code sessions. Not workflow attribution of delivery outcomes.`,
    recommendationState: 'monitor_only',
    urgencyLabel: 'informational',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/earlySignal.ts',
    featureFlagState: true,
    evidence: [
      { metric: 'Total sessions', value: String(total), label: 'Sample' },
      { metric: 'Short / long mode', value: `${shortMode} / ${longMode}`, label: 'Delegated run split' },
      { metric: 'AI cohorts (z/l/m/h)', value: `${cohorts.zero}/${cohorts.low}/${cohorts.medium}/${cohorts.high}`, label: 'AI signal' },
      ...(cohorts.unknown > 0 ? [{ metric: 'Unknown AI-signal', value: String(cohorts.unknown), label: 'Missing' }] : []),
      { metric: 'Observed AI denominator', value: String(observedAiDenominator), label: 'Denominator' },
      { metric: 'Avg wall-clock', value: `${avgWallClockMin.toFixed(1)} min`, label: 'Duration' },
      ...(topRepo ? [{ metric: 'Top repo', value: `${repoConcentrationPct.toFixed(0)}%`, label: 'Concentration' }] : []),
      ...(observedCommitSessions.length > 0 ? [{ metric: 'Observed commits', value: String(totalObservedCommits), label: 'Commits' }] : []),
    ],
    outcomeComposition: {
      total,
      shortMode,
      longMode,
      shortPct,
      longPct,
      cohorts,
      observedAiDenominator,
      avgWallClockMin,
      topRepo: topRepo ? topRepo[0] : null,
      repoConcentrationPct,
      observedCommitSessions: observedCommitSessions.length,
      totalObservedCommits,
    } as any,
    operationalRead: `Claude Code: ${total} sessions, ${dominantMode} dominant, ${avgWallClockMin.toFixed(0)} min avg wall-clock${cohorts.unknown > 0 ? `, ${cohorts.unknown} sessions have missing AI-signal data` : ''}.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
  };
}
