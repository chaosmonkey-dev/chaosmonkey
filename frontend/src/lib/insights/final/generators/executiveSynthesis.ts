/**
 * CR-X PI Product-Strength Wave — P2: Executive Temporal Synthesis
 *
 * Combines sibling recent-change findings (e.g., Devin share up, VS Code share down,
 * Cursor share down, session volume up) into one stronger executive finding
 * when multiple workflow-mix changes describe the same window.
 *
 * CONTRACT:
 * - Does NOT delete component findings from All Insights
 * - Creates one synthesized finding when ≥2 workflows materially move
 * - Same comparison windows as the component findings
 * - Adequate samples required
 * - Suppress if it would merely restate one isolated change
 * - Executive synthesis should outrank sibling fragments in Top Insights
 * - Observational, never causal
 */

import type { CanonicalInsightInput, CanonicalInsight } from '../types';
import { piDebugLog } from '../utils/logging';
import { getWorkflowDisplayName, normalizeToCanonicalToolId } from '../../../workflowIdentity';
import {
  selectComparisonWindows,
  isInWindow,
  isWindowAdequatelyPopulated,
  type ComparisonWindows,
} from '../helpers/temporalWindows';

const MIN_SESSIONS_PER_WINDOW = 5;
const MIN_MATERIAL_SHARE_CHANGE_PP = 10; // ≥10pp share change to count as "materially moving"
const MIN_MOVING_WORKFLOWS = 2; // need ≥2 moving workflows to synthesize

// CR-X FINAL: workflow display name is centralized in workflowIdentity.ts.

function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

const DAY_MS = 86400000;

interface WorkflowShareChange {
  toolId: string;
  wfName: string;
  priorShare: number;
  recentShare: number;
  priorN: number;
  recentN: number;
  direction: 'up' | 'down';
  changePP: number;
}

/**
 * Generate an executive synthesis finding when multiple workflow-mix changes
 * describe the same temporal window.
 *
 * Returns 0 or 1 CanonicalInsight.
 */
export function generateExecutiveTemporalSynthesis(input: CanonicalInsightInput): CanonicalInsight[] {
  const sessionRows = input.sessionRows || [];
  if (sessionRows.length === 0) return [];

  // CR-X FINAL: Use cached temporal windows when available
  const windows = input._engineCache?.temporalWindows !== undefined
    ? input._engineCache.temporalWindows
    : selectComparisonWindows(sessionRows);
  if (!windows) return [];

  if (!isWindowAdequatelyPopulated(sessionRows, windows.recent, MIN_SESSIONS_PER_WINDOW)) return [];
  if (!isWindowAdequatelyPopulated(sessionRows, windows.prior, MIN_SESSIONS_PER_WINDOW)) return [];

  // CR-X FINAL: Use cached recent/prior rows when available
  const recentRows = input._engineCache?.recentRows?.length > 0
    ? input._engineCache.recentRows
    : sessionRows.filter(r => isInWindow(r, windows.recent));
  const priorRows = input._engineCache?.priorRows?.length > 0
    ? input._engineCache.priorRows
    : sessionRows.filter(r => isInWindow(r, windows.prior));

  const totalRecent = recentRows.length;
  const totalPrior = priorRows.length;
  if (totalRecent < MIN_SESSIONS_PER_WINDOW || totalPrior < MIN_SESSIONS_PER_WINDOW) return;

  // Compute workflow shares for each window — use cached workflow grouping when available
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

  const changes: WorkflowShareChange[] = [];

  for (const toolId of workflowSet) {
    const wfRecent = recentRows.filter(r => normalizeToCanonicalToolId(r.tool ?? r.session_source ?? '') === toolId);
    const wfPrior = priorRows.filter(r => normalizeToCanonicalToolId(r.tool ?? r.session_source ?? '') === toolId);

    if (wfRecent.length < 3 || wfPrior.length < 3) continue;

    const recentShare = wfRecent.length / totalRecent;
    const priorShare = wfPrior.length / totalPrior;
    const changePP = Math.round(Math.abs(recentShare - priorShare) * 100);

    if (changePP < MIN_MATERIAL_SHARE_CHANGE_PP) continue;

    changes.push({
      toolId,
      wfName: getWorkflowDisplayName(toolId),
      priorShare,
      recentShare,
      priorN: wfPrior.length,
      recentN: wfRecent.length,
      direction: recentShare > priorShare ? 'up' : 'down',
      changePP,
    });
  }

  if (changes.length < MIN_MOVING_WORKFLOWS) {
    piDebugLog('[EXEC_SYNTHESIS]', `Only ${changes.length} materially moving workflows (need ${MIN_MOVING_WORKFLOWS}) — no synthesis`);
    return [];
  }

  // Sort by magnitude of change (largest first)
  changes.sort((a, b) => b.changePP - a.changePP);

  // Determine the dominant direction and the "story" workflow
  const upWorkflows = changes.filter(c => c.direction === 'up');
  const downWorkflows = changes.filter(c => c.direction === 'down');

  // Build the title
  const topChange = changes[0];
  const isShiftToward = upWorkflows.length === 1 && downWorkflows.length >= 1;

  let title: string;
  if (isShiftToward) {
    const gainer = upWorkflows[0];
    title = `Workflow mix shifted sharply toward ${gainer.wfName} over ${windows.recentLabel}`;
  } else if (upWorkflows.length > 1 && downWorkflows.length === 0) {
    title = `Workflow mix expanded over ${windows.recentLabel}`;
  } else if (downWorkflows.length > 1 && upWorkflows.length === 0) {
    title = `Workflow mix contracted over ${windows.recentLabel}`;
  } else {
    title = `Workflow mix changed materially over ${windows.recentLabel}`;
  }

  // Build evidence
  const evidenceEntries = changes.map(c => ({
    metric: `${c.wfName} share`,
    value: `${formatPct(c.priorShare)} → ${formatPct(c.recentShare)}`,
    label: `${c.changePP}pp ${c.direction}`,
    context: `N=${c.priorN} → N=${c.recentN}`,
  }));

  // Add total volume — normalized to sessions/week when the windows cover
  // different spans (e.g. last week vs prior 3 weeks), so raw totals are not
  // presented as an apples-to-apples volume decline.
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const priorWeeks = Math.max(0.5, (windows.prior.endMs - windows.prior.startMs) / WEEK_MS);
  const recentWeeks = Math.max(0.5, (windows.recent.endMs - windows.recent.startMs) / WEEK_MS);
  const priorPerWeek = Math.round(totalPrior / priorWeeks);
  const recentPerWeek = Math.round(totalRecent / recentWeeks);
  const sameSpanWindows = Math.abs(priorWeeks - recentWeeks) < 0.75;

  evidenceEntries.push({
    metric: 'Observed session volume',
    value: sameSpanWindows
      ? `${totalPrior} → ${totalRecent}`
      : `~${priorPerWeek}/wk → ~${recentPerWeek}/wk`,
    label: sameSpanWindows ? 'prior → recent' : 'sessions/week (window-normalized)',
    context: `${windows.label} · raw: ${totalPrior} → ${totalRecent}`,
  });

  const volumePhrase = sameSpanWindows
    ? `Total sessions: ${totalPrior} → ${totalRecent}.`
    : `Session volume: ~${priorPerWeek}/wk (${windows.priorLabel}, ${totalPrior} sessions) → ~${recentPerWeek}/wk (${windows.recentLabel}, ${totalRecent} sessions).`;

  const description = `Workflow mix changed materially over ${windows.recentLabel}. ${changes.map(c => `${c.wfName}: ${formatPct(c.priorShare)} → ${formatPct(c.recentShare)} (${c.changePP}pp ${c.direction})`).join('. ')}. ${volumePhrase} This is an observational comparison. The organization's observed workflow mix changed materially.`;

  const recommendation = `Determine whether this reflects deliberate rollout, project phase, tool availability, team composition, or instrumentation coverage before treating it as a productivity conclusion. This is observational, not causal.`;

  const id = 'executive-workflow-mix-synthesis';

  // CR-X FINAL: Explicit storyKey for parent/child dominance.
  // The synthesis finding and its component workflow-share findings
  // (recent-change__session_share__<workflow>) share this key.
  // When the synthesis passes evidence/materiality gates, the component
  // mirror cards are suppressed from rendered findings.
  const storyKey = `workflow-mix:${windows.label}`;

  // Build the synthesized insight
  const insight: CanonicalInsight = {
    id,
    storyKey,
    title,
    cicdStage: 'plan-code' as const,
    canonicalPriority: 95, // High priority — should outrank sibling fragments
    renderOrder: 0, // Unique — must not collide with active-coding-time-by-ide (renderOrder: 1)
    presentationType: 'evidence_only' as const,
    presentationKind: 'executive_synthesis' as const,
    comparisonMode: 'trend' as const,
    comparisonState: 'workflow_comparable' as const,
    current: totalRecent,
    baseline: totalPrior,
    delta: totalRecent - totalPrior,
    // Materiality for ranking: use the MAX workflow share change (in pp),
    // not total volume change. A mix shift from 18%→92% (74pp) is far more
    // decision-relevant than a volume change of 5%.
    deltaPct: changes.length > 0 ? Math.max(...changes.map(c => c.changePP)) : 0,
    // Displayed volume delta uses window-normalized sessions/week so a
    // 1-week vs 3-week comparison does not render a misleading raw drop.
    displayValue: sameSpanWindows
      ? `${totalPrior} → ${totalRecent}`
      : `~${priorPerWeek}/wk → ~${recentPerWeek}/wk`,
    displayDeltaPct: `${priorPerWeek > 0 ? (recentPerWeek > priorPerWeek ? '+' : '') : ''}${priorPerWeek > 0 ? Math.round(((recentPerWeek - priorPerWeek) / priorPerWeek) * 100) : 0}%`,
    polarity: 'neutral' as const,
    confidence: totalRecent >= 20 && totalPrior >= 20 ? 'high' : 'medium',
    coveragePct: 100,
    n: totalRecent + totalPrior,
    hasData: true,
    description,
    recommendation,
    executiveSummary: title,
    evidence: evidenceEntries,
    isExecutiveFinding: true,
    dataSource: 'live' as const,
    whatChanged: title,
    whyItMatters: recommendation,
    evidenceAndContext: description,
    urgencyLabel: 'investigate' as const,
    recommendationState: 'investigate' as const,
    lifecycleClass: 'decision' as const,
    generatorSource: 'generateExecutiveTemporalSynthesis',
    engineVersion: 'FINAL_ENGINE_V1' as const,
    featureFlagState: true,
    // Synthesis-specific fields
    metricKind: 'workflow_mix_shift',
    valueType: 'percentage',
    unit: '%',
    priorWindow: windows.priorLabel,
    recentWindow: windows.recentLabel,
    observedThroughMs: windows.observedThroughMs,
    componentFindings: changes.map(c => `recent-change__session_share__${c.toolId}`),
  } as CanonicalInsight;

  piDebugLog('[EXEC_SYNTHESIS]', `Synthesized ${changes.length} workflow-mix changes into executive finding: ${title}`);

  return [insight];
}
