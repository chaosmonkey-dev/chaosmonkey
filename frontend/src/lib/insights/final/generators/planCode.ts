/**
 * Plan & Code Stage Generators for Final Canonical Performance Insights
 * 
 * This module contains generator functions for the 5 Plan & Code stage canonical PIs.
 * 
 * INTENDED FUTURE DATA FLOW:
 * 1. dataAccess.ts fetches session telemetry and GitHub data
 * 
 * No imports from old V2 systems (computeV2PerformanceInsights.ts, piV2Manifest.ts, V2_PREVIEW_ROW_IDS)
 */

import type { CanonicalInsightInput, CanonicalInsight } from '../types';
import { ConfidenceLevel } from '../types';
import { getCanonicalPIById } from '../canonicalInsights';
import { formatPct, formatMinutes, formatRate, formatDelta, formatHours } from '../utils/formatHelpers';
import { getAIModelById } from '../registry/aiModelRegistry';
import { getIDEContextForModel } from '../helpers/aiModelFirstTitles';
import { softenOracleLanguage, generateMixedModelNarrative } from '../helpers/narrativeVariance';
import { getCanonicalWorkflowIdentity, normalizeToCanonicalToolId } from '../../../workflowIdentity';
import { getSessionsByWorkflow } from '../helpers/engineCache';
import { isStressModeEnabled } from '../../runtimeMode';
import { piDebugLog } from '../utils/logging';
import { computeConcurrency } from '../../../intervalUnion';
import { resolveSurface, getMeasurementSemantic, isDelegatedAgentWorkflow, isHumanInteractiveWorkflow, resolveOperationalMode, isMetricInstrumentedForWorkflow } from '../../../surfaceAgentContract';
import { normalizeRepoUrl, isRenderableRepoLabel, repoDisplayLabel } from '../../../repoNormalization';
import { getCurrentMonthKey } from '../helpers/periodStrip';
import { normalizeCostConfigInput, costToolIdToCanonicalWorkflowId } from '../../../toolCost';

/**
 * Coverage percentage with 1 decimal place precision.
 * Prevents Math.round() from rounding 99.8% up to 100%.
 * Returns 0 when denominator is 0.
 */
function coveragePct1dp(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Normalize IDE name from session data
 * CR4 FINAL: Delegates to the canonical workflow identity authority.
 * Windsurf is legacy Devin telemetry — normalized to devin via canonical alias.
 */
function normalizeIDE(tool: string): string | null {
  if (!tool) return null;
  const canonical = normalizeToCanonicalToolId(tool);
  if (!canonical || canonical === 'unknown' || canonical === 'extension' || canonical === 'undefined') {
    return null;
  }
  return canonical;
}

/**
 * Group sessions by canonical workflow
 * Uses multiple field sources to handle different session data shapes
 */
function groupSessionsByCanonicalWorkflow(sessionRows: any[], cache?: any): Record<string, any[]> {
  // CR-X FINAL: Use shared engine cache when available to avoid repeated full scans
  if (cache?.sessionsByWorkflow) return cache.sessionsByWorkflow;
  const groups: Record<string, any[]> = {}
  let unknownCount = 0

  for (const session of sessionRows) {
    const rawTool = session.tool ?? session.session_source ?? session.editor_source ?? session.source
    const workflow = normalizeToCanonicalToolId(rawTool)

    if (!workflow || workflow === 'unknown' || workflow === 'extension' || workflow === 'undefined') {
      unknownCount++
      continue
    }
    groups[workflow] ||= []
    groups[workflow].push(session)
  }

  if (unknownCount > 0) {
    piDebugLog('[GROUP_SESSIONS][UNKNOWN_EXCLUDED]', { unknownCount, totalSessions: sessionRows.length })
  }

  return groups
}

/**
 * CR-X 1C.1: Get the AI-signal measurement semantic family for a tool.
 * Returns the measurement semantic for ai_burst_count on the tool's surface.
 * Workflows with different AI-signal semantics (Level B) must not be directly
 * compared in cross-surface AI-signal findings.
 *
 * editor_activity_heuristic = VS Code, Cursor, JetBrains (editor extension)
 * agent_authored_known = Claude Code, terminal surfaces
 * not_measured = surfaces that don't observe AI signals
 */
function getAISignalSemanticFamily(toolId: string): string {
  const surface = resolveSurface(toolId);
  return getMeasurementSemantic(surface, 'ai_burst_count') || 'unknown';
}


/**
 * Generate active coding time by PI
 * 
 * MIGRATED LOGIC FROM computeV2PerformanceInsights.ts:
 * - Compute active coding minutes per session by IDE
 * - Use session_active_coding_duration_minutes from session primitives
 * - Calculate active coding ratio (active time / total session time)
 * - Add evidence with sample sizes, confidence, time window
 * - Add recommendations for environment optimization
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateActiveCodingTimeByIDE(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    piDebugLog('[GENERATOR_ACTIVE_CODING_TIME][START]', 'Generating active-coding-time-by-ide');
    const registryEntry = getCanonicalPIById('active-coding-time-by-ide');
    if (!registryEntry) {
      piDebugLog('[GENERATOR_ACTIVE_CODING_TIME][NO_REGISTRY]', 'Registry entry not found');
      return null;
    }

    const sessionRows = input.sessionRows || [];
    const totalSessions = sessionRows.length;

    // Use live data if available, otherwise fallback to seeded values
    const hasLiveData = totalSessions > 0;
    piDebugLog('[GENERATOR_ACTIVE_CODING_TIME][DATA_MODE]', { hasLiveData, totalSessions, sessionRowsSample: sessionRows.slice(0, 2) });

    // TEMPORARY RUNTIME PROOF LOGGING
    piDebugLog('[RUNTIME_PROOF][active-coding-time-by-ide]', {
      insightId: 'active-coding-time-by-ide',
      stage: 'plan-code',
      hasLiveData,
      sessionRowsCount: totalSessions,
      sampleSession: sessionRows[0] ? { 
        active_coding: sessionRows[0].session_active_coding_duration_minutes, 
        duration: sessionRows[0].session_duration_minutes,
        tool: sessionRows[0].tool 
      } : null
    });

    // Define model variables at function scope for use in ternary expressions
    const primaryModel = getAIModelById('claude-sonnet-4.6');
    const secondaryModel = getAIModelById('gpt-5-coding');
    const tertiaryModel = getAIModelById('swe-1.6');

  const activeCodingByWorkflow: Record<string, { value: number; count: number }> = {};
  let delegatedAgentExcluded = 0;

  if (hasLiveData) {
    // Group sessions by IDE and compute active coding time
    const sessionsByIDE = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
    piDebugLog('[GENERATOR_ACTIVE_CODING_TIME][SESSION_SAMPLE]', { totalSessions });
    for (const [ide, sessions] of Object.entries(sessionsByIDE)) {
      if (sessions.length === 0) continue;

      let totalActiveCoding = 0;
      let validSessions = 0;
      let zeroCount = 0;
      let nullCount = 0;

      // ELIGIBILITY CONTRACT for instrumented workflows:
      // - Finite number (including 0) is a measured value and is included.
      // - null / undefined / non-finite values are unavailable (not counted).
      // No fallback to session_duration_minutes or any other timing proxy.
      // Claude Code is not instrumented for active-coding and is skipped below.
      for (const session of sessions) {
        const rawActiveCoding = session.session_active_coding_duration_minutes;
        const isEligible = typeof rawActiveCoding === 'number' && Number.isFinite(rawActiveCoding);

        if (rawActiveCoding === 0) zeroCount++;
        if (rawActiveCoding === null || rawActiveCoding === undefined) nullCount++;

        if (isEligible) {
          totalActiveCoding += rawActiveCoding;
          validSessions++;
        }
      }

      piDebugLog('[GENERATOR_ACTIVE_CODING_TIME][IDE_STATS]', {
        ide,
        totalSessions: sessions.length,
        validSessions,
        zeroCount,
        nullCount,
        totalActiveCoding,
        avgActiveCoding: validSessions > 0 ? totalActiveCoding / validSessions : 0
      });

      // CR-X P1B.2 S1: Mode-aware gating — delegated agents (Devin, Claude Code,
      // and future agents) do not instrument human active-coding by design.
      // Skip them instead of producing a misleading zero.
      if (isDelegatedAgentWorkflow(ide)) { delegatedAgentExcluded++; continue; }

      const avgActiveCoding = validSessions > 0 ? totalActiveCoding / validSessions : 0;
      
      if (validSessions > 0) {
        activeCodingByWorkflow[ide] = { value: avgActiveCoding, count: validSessions };
      }
    }
  } else {
    // No live data and no stress mode — return diagnostic, never use seeded fallback values
    piDebugLog('[GENERATOR_ACTIVE_CODING_TIME][NO_LIVE_DATA]', 'No session data available, returning diagnostic');
    return {
      id: registryEntry.id,
      title: 'Active-coding time needs more data',
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      comparisonMode: 'trend',
      current: 0,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      rightMetric: '—',
      rightMetricLabel: 'Active Coding Time',
      confidence: 'low',
      coveragePct: 0,
      n: 0,
      hasData: false,
      isDiagnostic: true,
      diagnosticReason: 'NEEDS_MORE_TELEMETRY',
      diagnosticUnlockPath: 'Requires more telemetry sessions across workflows to establish reliable baseline',
      description: 'No telemetry sessions available. Active-coding time analysis requires session-level instrumentation data.',
    };
  }

  // Determine winner and runner-up
  // ELIGIBILITY CONTRACT: reuse the shared product sample-strength authority.
  // AIOI and PBT both use 25 sessions as the primary threshold.
  // CR5 P0.9: Reverted from 30 back to 25 — do not create PI-only thresholds.
  const MIN_ELIGIBLE_SESSIONS_FOR_COMPARISON = 25;
  const tools = Object.entries(activeCodingByWorkflow)
    .map(([name, data]) => ({ name, value: data.value, count: data.count }))
    .filter(t => t.count >= MIN_ELIGIBLE_SESSIONS_FOR_COMPARISON);

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();

  if (!isStressMode && hasLiveData && tools.length < 2) {
    // Distinguish instrumentation gap (Claude Code excluded by design)
    // from genuine sample-size issue (multiple workflows instrumented but
    // not enough sessions yet).
    const hasDelegatedAgentSessions = sessionRows.some(s => {
      const toolId = s.tool ?? s.session_source ?? '';
      return isDelegatedAgentWorkflow(toolId);
    });
    const isInstrumentationGap = hasDelegatedAgentSessions && tools.length === 1 && !isDelegatedAgentWorkflow(tools[0].name);
    const eligibleWfNames = tools.map(t => getCanonicalWorkflowIdentity(t.name)).join(', ') || 'none';

    piDebugLog('[GENERATOR_ACTIVE_CODING_TIME][INSUFFICIENT_ELIGIBLE_SAMPLES]', {
      activeCodingByWorkflow, hasLiveData, totalSessions, isInstrumentationGap
    });

    if (isInstrumentationGap) {
      // Specific: Claude Code does not instrument active_coding by design.
      // More Claude Code telemetry will NOT fix this.
      return {
        id: registryEntry.id,
        title: 'Active-coding comparison unavailable for Claude Code',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        presentationKind: 'diagnostic',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Active Coding Time',
        metricDefinition: 'Active coding duration measured from keystroke/cursor activity within sessions',
        operationalBreadcrumbs: [
          `${totalSessions} sessions analyzed`,
          `Active-coding instrumented for: ${eligibleWfNames}`,
          'Claude Code active-coding not instrumented (agent workflow)'
        ],
        confidence: 'low', coveragePct: 0, n: totalSessions, hasData: false,
        description: 'Active-coding duration is instrumented for VS Code but is not currently instrumented for the Claude Code workflow. A cross-tool comparison requires at least two workflows with active-coding instrumentation.',
        whatChanged: 'Claude Code active-coding is not instrumented by design (agent/terminal workflow).',
        whyItMatters: 'Active coding time measures IDE-based keystroke/cursor activity. Claude Code operates as an agent workflow where this metric is not semantically comparable.',
        recommendation: 'Cross-tool active-coding comparison requires a second IDE-instrumented workflow. Claude Code sessions are excluded from active-coding comparisons by design.',
        evidenceAndContext: `Analysis of ${totalSessions} development sessions. Active-coding instrumented for: ${eligibleWfNames}. Claude Code sessions excluded (agent workflow — active_coding not instrumented).`,
        operationalImpact: 'Cross-tool active-coding comparison unavailable — Claude Code does not instrument this metric.',
        primaryRisk: 'None — comparison is suppressed rather than showing a misleading zero value for Claude Code.',
        cohort: 'Workflow Coordination',
        confidenceReasoning: 'Instrumentation gap: Claude Code active-coding is not captured by design.',
        recommendationState: 'monitor_only',
        urgencyLabel: 'monitor',
        engineVersion: 'FINAL_ENGINE_V1',
        generatorSource: 'final/generators/planCode.ts',
        featureFlagState: true,
        evidence: [],
        breakdownByTool: undefined,
        comparisonState: 'needs_more_data',
        isDiagnostic: true,
        diagnosticReason: 'INSTRUMENTATION_NOT_CAPTURED',
        diagnosticUnlockPath: 'Active-coding duration is instrumented for VS Code but is not currently instrumented for the Claude Code workflow. A second IDE-instrumented workflow is needed for cross-tool comparison.',
        isExecutiveFinding: registryEntry.isExecutiveFinding,
        dataSource: 'live'
      };
    }

    // Generic: multiple workflows may be instrumented but not enough sessions yet.
    return {
      id: registryEntry.id,
      title: 'Active-coding time needs more data',
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      presentationKind: 'diagnostic',
      comparisonMode: 'absolute',
      current: 0, baseline: 0, delta: 0, deltaPct: 0,
      rightMetric: '—', rightMetricLabel: 'Active Coding Time',
      metricDefinition: 'Active coding duration measured from keystroke/cursor activity within sessions',
      operationalBreadcrumbs: [
        `${totalSessions} sessions analyzed`,
        `Eligible active-coding workflows: ${eligibleWfNames}`,
        'Insufficient eligible active-coding samples for workflow comparison'
      ],
      confidence: 'low', coveragePct: 0, n: totalSessions, hasData: false,
      description: 'Active-coding time is not yet measured for enough sessions across at least two workflows to produce a comparison.',
      whatChanged: 'Insufficient eligible active-coding data for workflow comparison.',
      whyItMatters: 'Active coding time measures focused keystroke/cursor activity within sessions, but requires a minimum eligible sample size per workflow to compare reliably.',
      recommendation: 'Continue collecting telemetry. This insight will populate once at least two workflows have 25+ sessions with measured active-coding duration.',
      evidenceAndContext: `Analysis of ${totalSessions} development sessions. Eligible active-coding workflows: ${eligibleWfNames || 'none'}; delegated_agent_excluded=${delegatedAgentExcluded}.`,
      operationalImpact: 'Active-coding comparison unavailable until eligible sample size is met.',
      primaryRisk: 'None — insight is suppressed rather than showing a misleading zero value.',
      cohort: 'Workflow Coordination',
      confidenceReasoning: `Low confidence: fewer than ${MIN_ELIGIBLE_SESSIONS_FOR_COMPARISON} eligible sessions in at least one compared workflow.`,
      recommendationState: 'monitor_only',
      urgencyLabel: 'monitor',
      engineVersion: 'FINAL_ENGINE_V1',
      generatorSource: 'final/generators/planCode.ts',
      featureFlagState: true,
      evidence: [],
      breakdownByTool: undefined,
      comparisonState: 'needs_more_data',
      isDiagnostic: true,
      diagnosticReason: 'NEEDS_MORE_TELEMETRY',
      diagnosticUnlockPath: 'Requires more telemetry sessions across workflows to establish reliable baseline',
      isExecutiveFinding: registryEntry.isExecutiveFinding,
      dataSource: 'live'
    };
  }

  if (!isStressMode && tools.length === 0) {
    piDebugLog('[GENERATOR_ACTIVE_CODING_TIME][NO_TOOLS]', 'No workflows have eligible active-coding measurements, returning null', { activeCodingByWorkflow, hasLiveData, totalSessions });
    return null; // Insufficient data
  }

  tools.sort((a, b) => b.value - a.value);
  const winner = tools[0];
  const runnerUp = tools.length > 1 ? tools[1] : tools[0];
  
  const winnerValue = winner.value;
  const runnerUpValue = runnerUp.value;
  const delta = winnerValue - runnerUpValue;
  const deltaPct = runnerUpValue > 0 ? ((winnerValue - runnerUpValue) / runnerUpValue) * 100 : 0;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 30 ? 'high' : totalSessions >= 15 ? 'medium' : 'low';
  const coveragePct = totalSessions > 0 ? coveragePct1dp(tools.reduce((sum, t) => sum + t.count, 0), totalSessions) : 0;

  // CR5 P1.5 P2: Strip " workflow" suffix from titles for executive scannability.
  // CR5 FINAL TITLE DOCTRINE: State the finding (absolute gap), not two values to subtract.
  const tw = (id: string) => getCanonicalWorkflowIdentity(id).replace(' workflow', '');
  let executiveTitle: string;
  if (deltaPct > 30 && runnerUpValue > 0) {
    executiveTitle = `${tw(winner.name)} averages ${delta.toFixed(1)} more active-coding min/session than ${tw(runnerUp.name)}`;
  } else if (winnerValue < 30) {
    executiveTitle = 'Active coding is low across primary workflows';
  } else {
    executiveTitle = 'Active coding varies across primary workflows';
  }

  // Build breakdownByTool with ALL workflows that have data
  const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
  for (const tool of tools) {
    if (tool.count >= 10 || isStressMode) {
      breakdownByTool[tool.name] = {
        value: tool.value,
        count: tool.count,
        formatted: `${formatMinutes(tool.value)}/session`,
        label: `${getCanonicalWorkflowIdentity(tool.name)} (${tool.count} sessions)`
      };
    }
  }

  // Build operational breadcrumbs from real data
  const operationalBreadcrumbs: string[] = [
    `${totalSessions} coding sessions analyzed`,
    ...tools.map(t => `${getCanonicalWorkflowIdentity(t.name)}: ${formatMinutes(t.value)}/session (${t.count} sessions)`)
  ];

  // Generate simpler narrative for live data, AI-model-first for demo mode
  let description: string;
  let whatChanged: string;
  let whyItMatters: string;
  let recommendation: string;

  if (hasLiveData) {
    description = deltaPct > 30
      ? `${getCanonicalWorkflowIdentity(winner.name)} active coding time is ${formatMinutes(winnerValue)}/session vs ${formatMinutes(runnerUpValue)}/session for ${getCanonicalWorkflowIdentity(runnerUp.name)} (${formatDelta(deltaPct)}).`
      : `Active coding time varies across workflows: ${tools.map(t => `${getCanonicalWorkflowIdentity(t.name)} ${formatMinutes(t.value)}/session`).join(', ')}.`;
    whatChanged = deltaPct > 30
      ? `${getCanonicalWorkflowIdentity(winner.name)}: ${formatMinutes(winnerValue)}/session vs ${getCanonicalWorkflowIdentity(runnerUp.name)}: ${formatMinutes(runnerUpValue)}/session (${formatDelta(deltaPct)}) in the observed period, based on ${winner.count} vs ${runnerUp.count} sessions.`
      : `Active coding time across workflows: ${tools.map(t => `${getCanonicalWorkflowIdentity(t.name)} ${formatMinutes(t.value)}/session`).join(', ')}.`;
    whyItMatters = `Active coding time measures focused keystroke/cursor activity within sessions. ${winner.count + runnerUp.count} eligible sessions across ${tools.length} primary workflows (canonical population: ${totalSessions}). Difference of ${formatMinutes(delta)}/session between ${getCanonicalWorkflowIdentity(winner.name)} and ${getCanonicalWorkflowIdentity(runnerUp.name)}.`;
    recommendation = deltaPct > 30
      ? `Compare task mix, session duration and interruption patterns between ${getCanonicalWorkflowIdentity(winner.name)} and ${getCanonicalWorkflowIdentity(runnerUp.name)} before treating the gap as a productivity effect. If those are similar, inspect which workflow practices account for the longer active-coding periods.`
      : winnerValue < 30
      ? `Active coding time is low across workflows (${tools.map(t => `${getCanonicalWorkflowIdentity(t.name)} ${formatMinutes(t.value)}`).join(', ')}). Audit meeting load, review notification policies, optimize environment configuration, or investigate tooling issues to increase focused coding time.`
      : 'Monitor active coding time patterns for consistency. Uneven focus time may indicate workflow friction.';
  } else {
    // Demo mode - AI-model-first narrative
    if (!primaryModel || !secondaryModel || !tertiaryModel) {
      piDebugLog('[GENERATOR_ACTIVE_CODING_TIME][NO_MODELS]', 'IDE data not found, returning null');
      return null;
    }

    const mixedModelNarratives = generateMixedModelNarrative(
      primaryModel,
      [secondaryModel, tertiaryModel],
      'active coding sessions'
    );

    description = softenOracleLanguage(`Measured workflow active-coding data is available for ${tools.map(t => `${getCanonicalWorkflowIdentity(t.name)} at ${formatMinutes(t.value)}/session`).join(', ')}. ${mixedModelNarratives[0]}`);
    whatChanged = softenOracleLanguage(`Measured active-coding values: ${tools.map(t => `${getCanonicalWorkflowIdentity(t.name)} ${formatMinutes(t.value)}/session`).join(', ')}.`);
    whyItMatters = softenOracleLanguage('Workflow variance may affect reviewer distribution and coordination overhead across delivery boundaries.');
    recommendation = softenOracleLanguage(`Review measured workflow differences for ${getCanonicalWorkflowIdentity(winner.name)} and validate them against delivery quality before changing rollout policy.`);
    operationalBreadcrumbs.push(
      ...tools.map(t => `${t.count} ${getCanonicalWorkflowIdentity(t.name)} workflows`)
    );
  }
  
  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    // CR5 P0.8: This is a cross-sectional workflow comparison, NOT a temporal trend.
    presentationKind: 'workflow_comparison',
    comparisonMode: 'absolute',
    current: winnerValue,
    baseline: runnerUpValue,
    delta,
    deltaPct,
    rightMetric: formatMinutes(winnerValue) + '/session',
    rightMetricLabel: 'Active Coding Time',
    metricDefinition: 'Active coding duration measured from keystroke/cursor activity within sessions',
    operationalBreadcrumbs,
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    // Data source classification
    dataDomain: 'telemetry',
    sourceLabel: 'Telemetry',
    sampleUnit: 'sessions',
    sampleLabel: `${totalSessions.toLocaleString()} sessions`,
    attributionStatus: 'ide_attributed',
    comparisonStatus: 'available',
    displayValue: formatMinutes(winnerValue) + '/session',
    displayUnit: 'minutes/session',
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: hasLiveData
      ? `Analysis of ${totalSessions} development sessions. ${tools.map(t => `${getCanonicalWorkflowIdentity(t.name)} averaged ${formatMinutes(t.value)} active coding time`).join(', ')}. Coverage: ${coveragePct}% of sessions.`
      : softenOracleLanguage(`Analysis of ${totalSessions} development sessions across measured workflows. ${tools.map(t => `${getCanonicalWorkflowIdentity(t.name)} averaged ${formatMinutes(t.value)} active coding time`).join(', ')}.`),
    operationalImpact: hasLiveData
      ? deltaPct > 30
        ? `${getCanonicalWorkflowIdentity(winner.name)} averages ${formatMinutes(winnerValue)} active coding/session vs ${getCanonicalWorkflowIdentity(runnerUp.name)} ${formatMinutes(runnerUpValue)}. This may indicate different workflow patterns or environment efficiency.`
        : `Active coding time varies across workflows.`
      : softenOracleLanguage(`Measured active-coding differences require validation against reviewer capacity and delivery quality before rollout decisions.`),
    primaryRisk: hasLiveData
      ? 'Session pacing divergence could create uneven review load if longer sessions produce larger PRs.'
      : softenOracleLanguage('Measured workflow differences could create uneven review load if longer sessions produce larger changes.'),
    cohort: 'Workflow Coordination',
    confidenceReasoning: hasLiveData
      ? `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% data coverage.`
      : 'Measured workflow data requires validation before rollout decisions.',
    recommendationState: deltaPct > 15 ? 'action_required' : 'monitor_only',
    urgencyLabel: deltaPct > 30 ? 'action_required' : deltaPct > 15 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      ...tools.map(t => ({ metric: getCanonicalWorkflowIdentity(t.name), value: formatMinutes(t.value), label: 'Active coding time' })),
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total' }
    ],
    breakdownByTool,
    operationalRead: `${tools.map(t => `${getCanonicalWorkflowIdentity(t.name)}: ${formatMinutes(t.value)}/session`).join(', ')}.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: hasLiveData ? 'live' : 'demo',
    // CR5 WS1.6 P0: Set selectedComparison so the adapter/render layer uses
    // the SAME pair as the title (winner vs runnerUp). Without this, the
    // adapter falls back to eligible[0] vs eligible[1] (sorted by value),
    // which may not match the generator's title pair.
    selectedComparison: { leaderKey: winner.name, baselineKey: runnerUp.name }
  };

  piDebugLog('[GENERATOR_ACTIVE_CODING_TIME][RETURN]', 'Returning insight:', baseInsight.id);
  return baseInsight;
  } catch (error) {
    console.error('[GENERATOR_ACTIVE_CODING_TIME][ERROR]', 'Generator crashed:', error);
    return null;
  }
}

/**
 * Generate delivery rate AI vs Non-AI PI
 */
export function generateDeliveryRateAIVsNonAI(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('delivery-rate-ai-vs-non-ai');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const hasLiveData = totalSessions > 0;

  // CR-X 1C.1: Level-B semantic gate — pool only sessions from the same
  // AI-signal measurement semantic family. editor_activity_heuristic (VS Code)
  // and agent_authored_known (Claude Code) measure AI signals differently.
  // Pooling them into a single "AI-assisted" cohort would mix
  // incompatible semantics. Use the dominant semantic family.
  const semanticFamilyOf = (s: any) => {
    // Cursor Agent bridge rows carry verified agent-authored provenance at the
    // SESSION level (source='cursor-agent') even though tool resolves to
    // 'cursor' — they must not pool with editor-activity heuristic bursts.
    if ((s.source ?? s.session_source) === 'cursor-agent') return 'agent_authored_known';
    const tool = normalizeToCanonicalToolId(s.tool ?? s.session_source ?? s.source ?? '');
    return getAISignalSemanticFamily(tool);
  };
  const familiesInData = new Set(sessionRows.map(semanticFamilyOf));
  // Pick the family with the most sessions
  let dominantFamily = '';
  let dominantFamilyCount = 0;
  for (const fam of familiesInData) {
    const cnt = sessionRows.filter(s => semanticFamilyOf(s) === fam).length;
    if (cnt > dominantFamilyCount) {
      dominantFamily = fam;
      dominantFamilyCount = cnt;
    }
  }
  const scopedSessionRows = sessionRows.filter(s => semanticFamilyOf(s) === dominantFamily);

  // Compute from live session data only (scoped to dominant semantic family)
  const isExplicitAI = (s: any) => s.session_has_ai_activity === true;
  const isExplicitNonAI = (s: any) => s.session_has_ai_activity === false;
  const aiSessions = scopedSessionRows.filter(isExplicitAI);
  const nonAiSessions = scopedSessionRows.filter(isExplicitNonAI);
  const aiSessionCount = aiSessions.length;
  const nonAiSessionCount = nonAiSessions.length;

  // PROVENANCE GATE: Only observed commit events are eligible for actionable commit PIs.
  // aggregated_fallback and session_level_fallback are per-tool averages/backfills,
  // not directly measured commit outcomes.
  const isEligibleCommit = (s: any) =>
    typeof s.session_commits === 'number' && Number.isFinite(s.session_commits) &&
    s.session_commits_source === 'observed';
  const aiCommits = aiSessions.filter(isEligibleCommit).reduce((sum, s) => sum + s.session_commits, 0);
  const aiCommitSamples = aiSessions.filter(isEligibleCommit).length;
  const nonAiCommits = nonAiSessions.filter(isEligibleCommit).reduce((sum, s) => sum + s.session_commits, 0);
  const nonAiCommitSamples = nonAiSessions.filter(isEligibleCommit).length;

  // Require minimum total sessions for directional signal
  if (totalSessions < 20) {
    piDebugLog('[GENERATOR_DELIVERY_RATE_AI_VS_NON_AI][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }

  // Require both cohorts to have minimum measured commit samples
  if (aiCommitSamples < 5 || nonAiCommitSamples < 5) {
    piDebugLog('[GENERATOR_DELIVERY_RATE_AI_VS_NON_AI][INSUFFICIENT_COHORT_DATA]', { aiCommitSamples, nonAiCommitSamples });
    return null;
  }

  const aiDeliveryRate = aiCommitSamples > 0 ? aiCommits / aiCommitSamples : 0;
  const nonAiDeliveryRate = nonAiCommitSamples > 0 ? nonAiCommits / nonAiCommitSamples : 0;

  const delta = aiDeliveryRate - nonAiDeliveryRate;
  const deltaPct = nonAiDeliveryRate > 0 ? ((aiDeliveryRate - nonAiDeliveryRate) / nonAiDeliveryRate) * 100 : 0;

  // Determine confidence based on measured commit samples (low confidence for small cohorts)
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : (aiCommitSamples >= 10 && nonAiCommitSamples >= 10) ? 'medium' : 'low';
  const coveragePct = coveragePct1dp((aiCommitSamples + nonAiCommitSamples), totalSessions);

  // Executive title based on delivery pattern - follow title doctrine
  let executiveTitle: string;
  // Absurd-delta guard: for deltas above 300%, use absolute values with baseline caveat
  if (Math.abs(deltaPct) > 300) {
    // Zero-baseline guard: avoid brittle "0.0 zero-signal baseline" wording
    if (nonAiDeliveryRate < 0.1) {
      executiveTitle = `AI-assisted sessions average ${formatRate(aiDeliveryRate)} commits; zero-signal sample is thin`;
    } else {
      executiveTitle = `AI-assisted sessions show ${formatRate(aiDeliveryRate)} commits/session vs ${formatRate(nonAiDeliveryRate)} zero-signal baseline`;
    }
  } else if (deltaPct > 30) {
    executiveTitle = `AI-assisted sessions average ${formatDelta(deltaPct)} more commits per session than non-AI sessions`;
  } else if (deltaPct < -30) {
    executiveTitle = `Non-AI sessions average ${formatDelta(Math.abs(deltaPct))} more commits per session than AI-assisted`;
  } else {
    executiveTitle = `Commits/session is similar across AI-assisted and non-AI sessions (${formatRate(aiDeliveryRate)} vs ${formatRate(nonAiDeliveryRate)} commits/session)`;
  }

  const description = `AI-assisted sessions average ${formatRate(aiDeliveryRate)} commits per session versus ${formatRate(nonAiDeliveryRate)} for non-AI sessions, based on ${aiCommitSamples} observed-AI-signal and ${nonAiCommitSamples} zero-signal sessions with provenance-qualified observed commits. This is an observational comparison across workflow cohorts and may be confounded by workflow or task mix.`;
  const whatChanged = `Commits per session: AI-assisted ${formatRate(aiDeliveryRate)} vs non-AI sessions ${formatRate(nonAiDeliveryRate)} (${deltaPct > 0 ? formatDelta(deltaPct) + ' higher' : formatDelta(Math.abs(deltaPct)) + ' lower'}), based on ${aiCommitSamples + nonAiCommitSamples} sessions with observed commit provenance.`;
  const whyItMatters = 'This comparison uses the provenance-qualified observed-commit population and is observational. Differences may reflect workflow or task mix rather than a causal AI effect. No reviewer burden or PR/review attribution is available on this environment.';
  const recommendation = deltaPct > 30
    ? `AI-assisted sessions show ${formatDelta(deltaPct)} higher commits/session (${formatRate(aiDeliveryRate)} vs ${formatRate(nonAiDeliveryRate)}). This is observational and may be confounded by workflow/task mix. Investigate whether AI-assisted sessions handle different task types before interpreting as a productivity effect.`
    : 'Commit rates are similar across AI-assisted and non-AI sessions cohorts. Continue monitoring as more observed-commit data accumulates.';

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'ai_vs_non_ai',
    current: aiDeliveryRate,
    baseline: nonAiDeliveryRate,
    delta,
    deltaPct,
    rightMetric: formatRate(aiDeliveryRate) + '/session',
    rightMetricLabel: 'Commits per Session',
    metricDefinition: 'Average commits per development session, comparing AI-assisted sessions vs non-AI sessions',
    operationalBreadcrumbs: [
      `${aiCommitSamples + nonAiCommitSamples} sessions with observed commits`,
      `Observed AI signals: ${aiCommitSamples} sessions (${formatRate(aiDeliveryRate)} commits/session)`,
      `Zero AI-assisted: ${nonAiCommitSamples} sessions (${formatRate(nonAiDeliveryRate)} commits/session)`
    ],
    confidence,
    coveragePct,
    // CR5 WS1.5 P0 FIX: ALL displayed Ns must come from the SAME
    // provenance-qualified commit population. aiSessionCount/nonAiSessionCount
    // count ALL sessions with AI activity (1,657+198=1,855), but only
    // sessions with session_commits_source='observed' contribute to the
    // commit comparison. The card, footer, breakdownByTool, evidence, and
    // n must ALL use the qualified counts so the displayed cohort Ns
    // reconcile to 1,069, not 1,855.
    n: aiCommitSamples + nonAiCommitSamples,
    hasData: true,
    // Data source classification
    dataDomain: 'telemetry',
    sourceLabel: 'Telemetry',
    sampleUnit: 'sessions',
    sampleLabel: `${(aiCommitSamples + nonAiCommitSamples).toLocaleString()} sessions`,
    attributionStatus: 'ide_attributed',
    comparisonStatus: 'available',
    displayValue: formatRate(aiDeliveryRate) + ' commits/session',
    displayUnit: 'commits/session',
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: hasLiveData
      ? `Analysis of ${aiCommitSamples + nonAiCommitSamples} sessions with observed commits. Observed AI signals: ${aiCommitSamples} sessions at ${formatRate(aiDeliveryRate)} commits/session. Zero AI-assisted: ${nonAiCommitSamples} sessions at ${formatRate(nonAiDeliveryRate)} commits/session. Coverage: ${coveragePct}%.`
      : `Analysis of ${aiCommitSamples + nonAiCommitSamples} sessions with observed commits across AI-assisted (${aiCommitSamples} sessions) and non-AI sessions (${nonAiCommitSamples} sessions) cohorts. AI-assisted sessions showed ${formatRate(aiDeliveryRate)} commits/session, non-AI sessions ${formatRate(nonAiDeliveryRate)} commits/session.`,
    operationalImpact: hasLiveData
      ? `${deltaPct > 0 ? formatDelta(deltaPct) + ' higher' : formatDelta(Math.abs(deltaPct)) + ' lower'} commit throughput affects review queue volume.`
      : `Estimated ${formatDelta(deltaPct)} higher commit throughput increases review queue volume asymmetrically.`,
    primaryRisk: 'Higher commit rates create reviewer bottlenecks when PR volume increases but reviewer count stays constant.',
    cohort: 'Workflow Acceleration',
    confidenceReasoning: hasLiveData
      ? `${confidence} confidence based on ${aiCommitSamples + nonAiCommitSamples} sessions with observed commits and ${coveragePct}% data coverage.`
      : 'Medium confidence based on consistent directional signal but limited sample size for AI-assisted vs non-AI sessions comparison.',
    recommendationState: deltaPct > 30 ? 'action_required' : 'monitor_only',
    urgencyLabel: deltaPct > 30 ? 'action_required' : deltaPct > 15 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: hasLiveData
      ? [
          { metric: 'Observed AI signals', value: formatRate(aiDeliveryRate), label: 'commits/session' },
          { metric: 'Zero AI-assisted', value: formatRate(nonAiDeliveryRate), label: 'commits/session' },
          { metric: 'Delta', value: formatDelta(deltaPct), label: 'Observed AI signals advantage' },
          { metric: 'Observed AI signals Sessions', value: aiCommitSamples.toString(), label: 'Sessions with observed commits' },
          { metric: 'Zero AI-assisted Sessions', value: nonAiCommitSamples.toString(), label: 'Sessions with observed commits' }
        ]
      : [
          { metric: 'VS Code', value: formatRate(aiDeliveryRate), label: 'commits/session (AI-assisted)' },
          { metric: 'Zero AI-assisted', value: formatRate(nonAiDeliveryRate), label: 'commits/session (non-AI sessions)' },
          { metric: 'Delta', value: formatDelta(deltaPct), label: 'Observed AI signals advantage' },
          { metric: 'Sessions Analyzed', value: (aiCommitSamples + nonAiCommitSamples).toString(), label: 'Sessions with observed commits' }
        ],
    breakdownByTool: hasLiveData
      ? {
          ai: { value: aiDeliveryRate, count: aiCommitSamples, formatted: `${formatRate(aiDeliveryRate)} commits/session`, label: `Observed AI signals (${aiCommitSamples} sessions)` },
          non_ai: { value: nonAiDeliveryRate, count: nonAiCommitSamples, formatted: `${formatRate(nonAiDeliveryRate)} commits/session`, label: `Zero AI-assisted (${nonAiCommitSamples} sessions)` }
        }
      : {
          vscode: { value: aiDeliveryRate, count: aiCommitSamples, formatted: `${formatRate(aiDeliveryRate)} commits/session`, label: `${getCanonicalWorkflowIdentity('vscode')} (AI-assisted)` },
          non_ai: { value: nonAiDeliveryRate, count: nonAiCommitSamples, formatted: `${formatRate(nonAiDeliveryRate)} commits/session`, label: 'Zero AI-assisted (baseline)' }
        },
    operationalRead: hasLiveData
      ? `Observed AI signals: ${formatRate(aiDeliveryRate)} commits/session vs Zero AI-assisted: ${formatRate(nonAiDeliveryRate)} commits/session (${deltaPct > 0 ? formatDelta(deltaPct) + ' higher' : formatDelta(Math.abs(deltaPct)) + ' lower'}).`
      : `${getCanonicalWorkflowIdentity('vscode')}: ${formatRate(aiDeliveryRate)} commits/session vs Zero AI-assisted: ${formatRate(nonAiDeliveryRate)} commits/session (${formatDelta(deltaPct)} higher). Observed AI signals concentrated in ${getCanonicalWorkflowIdentity('vscode')} workflows.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
  };

  return baseInsight;
}

/**
 * Generate telemetry AI focus imbalance PI
 */
export function generateTelemetryAIFocusImbalance(input: CanonicalInsightInput): CanonicalInsight | null {
  // CR5 WS2 #14 P0-4: OBSOLETE — duplicates ai-adoption-rate-by-ide.
  // Suppressed per Matt directive. Focus ratio + AI-intensity focus
  // behavior are now real findings. Do not generate this insight.
  return null;
}

// --- telemetry-ai-focus-imbalance body removed (consolidated into ai-adoption-rate-by-ide) ---

/* eslint-disable */
// The following dead code was the body of the old generateTelemetryAIFocusImbalance
// function. It is preserved here as a comment block to avoid large diffs.
// DO NOT EXECUTE — the function now returns null above.
/*
  // TEMPORARY RUNTIME PROOF LOGGING
  piDebugLog('[RUNTIME_PROOF][telemetry-ai-focus-imbalance]', {
    insightId: 'telemetry-ai-focus-imbalance',
    stage: 'plan-code',
    hasLiveData,
    sessionRowsCount: totalSessions,
    sampleSession: sessionRows[0] ? { has_ai: sessionRows[0].session_has_ai_activity } : null
  });

  if (!hasLiveData) {
    // No live data — return null, never use seeded fallback values
    piDebugLog('[GENERATOR_AI_FOCUS_IMBALANCE][NO_LIVE_DATA]', 'No session data available, returning null');
    return null;
  }

  // Determine winner and runner-up for AI adoption — build from all workflows in session data
  const allWorkflows = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
  const aiTools: Array<{ name: string; value: number; count: number }> = [];
  for (const [ide, sessions] of Object.entries(allWorkflows)) {
    if (sessions.length === 0) continue;
    const aiSessions = sessions.filter(s => s.session_has_ai_activity === true);
    const aiUsagePct = (aiSessions.length / sessions.length) * 100;
    aiTools.push({ name: ide, value: aiUsagePct, count: sessions.length });
  }

  // Require at least 2 distinct primary workflows (>=25 sessions) for a
  // directional comparison. Low-sample workflows may remain visible as
  // secondary/emerging evidence but cannot control title, winner, runner-up,
  // baseline, delta, recommendation, or interpretation.
  const MIN_PRIMARY_WORKFLOW_SESSIONS = 25;
  const primaryTools = aiTools.filter(t => t.count >= MIN_PRIMARY_WORKFLOW_SESSIONS && t.value > 0);
  const lowSampleTools = aiTools.filter(t => t.count < MIN_PRIMARY_WORKFLOW_SESSIONS);
  if (primaryTools.length < 2) {
    piDebugLog('[GENERATOR_AI_FOCUS_IMBALANCE][INSUFFICIENT_PRIMARY_WORKFLOWS]', {
      primaryCount: primaryTools.length,
      lowSampleCount: lowSampleTools.length,
      totalWorkflows: aiTools.length,
      workflows: aiTools.map(t => ({ name: t.name, value: t.value, count: t.count }))
    });
    return null;
  }

  // Sort primary tools by value for winner/runner-up determination
  primaryTools.sort((a, b) => b.value - a.value);
  const winner = primaryTools[0];
  const runnerUp = primaryTools[1];

  // All eligible tools (primary + low-sample) for evidence/breakdown display
  const eligibleTools = [...primaryTools, ...lowSampleTools.sort((a, b) => b.value - a.value)];
  
  const winnerValue = winner.value;
  const runnerUpValue = runnerUp.value;
  const deltaPct = runnerUpValue > 0 ? ((winnerValue - runnerUpValue) / runnerUpValue) * 100 : 0;

  // Generate comparative title - follow title doctrine with actual values
  // Use rounded values for title to match detail panel display
  const roundedWinnerValue = Math.round(winnerValue);
  const roundedRunnerUpValue = Math.round(runnerUpValue);
  const imbalanceScore = Math.abs(winnerValue - runnerUpValue)
  const comparativeTitle = `AI adoption varies significantly across workflows`
  
  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  // Relax condition for pilot readiness - allow rendering with smaller samples
  if (!isStressMode && totalSessions < 10) {
    piDebugLog('[GENERATOR_AI_FOCUS_IMBALANCE][INSUFFICIENT_DATA]', {
      totalSessions,
      imbalanceScore,
      reason: 'Insufficient sample size in demo mode'
    });
    return null;
  }

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 30 ? 'high' : totalSessions >= 15 ? 'medium' : 'low';
  const coveragePct = totalSessions > 0 ? coveragePct1dp(eligibleTools.reduce((sum, t) => sum + t.count, 0), totalSessions) : 0;

  // Generate narrative from dynamic workflow data
  const description = `AI adoption imbalance of ${Math.round(imbalanceScore)}% between ${getCanonicalWorkflowIdentity(winner.name)} (${Math.round(winnerValue)}%) and ${getCanonicalWorkflowIdentity(runnerUp.name)} (${Math.round(runnerUpValue)}%).`;
  const whatChanged = `${getCanonicalWorkflowIdentity(winner.name)}: ${Math.round(winnerValue)}% AI adoption vs ${getCanonicalWorkflowIdentity(runnerUp.name)}: ${Math.round(runnerUpValue)}% (${formatPct(deltaPct)} higher) in the observed period, based on ${winner.count} vs ${runnerUp.count} sessions.`;
  const whyItMatters = 'AI adoption rate measures the share of AI-assisted sessions per workflow. Uneven adoption may reflect different task mix, team practices, or enablement gaps. This is an observation about adoption distribution, not a causal measure of productivity variance or tool-investment value.';
  const recommendation = imbalanceScore > 50
    ? `AI adoption imbalance is ${formatPct(imbalanceScore)} across workflows. Compare task mix and enablement state across workflows before standardizing AI usage — the gap may reflect different task types rather than an enablement deficit.`
    : 'Monitor AI adoption patterns across workflows. Investigate significant gaps to determine whether they reflect task mix, enablement, or practice differences.';

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: comparativeTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'diagnostic',
    comparisonMode: 'insufficient',
    isDiagnostic: true,
    diagnosticReason: 'A distinct AI focus/intensity measure is required — current implementation duplicates cross-sectional adoption rate from ai-adoption-rate-by-ide',
    current: imbalanceScore,
    baseline: 0,
    delta: imbalanceScore,
    deltaPct: 0,
    rightMetric: formatPct(winnerValue) + ' AI adoption',
    rightMetricLabel: 'AI Adoption Rate',
    metricDefinition: 'AI usage percentage across development environments, measuring adoption consistency',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      ...eligibleTools.map(t => `${getCanonicalWorkflowIdentity(t.name)}: ${Math.round(t.value)}% AI adoption (${t.count} sessions)`)
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    dataDomain: 'telemetry',
    sourceLabel: 'Telemetry',
    sampleUnit: 'sessions',
    sampleLabel: `${totalSessions.toLocaleString()} sessions`,
    attributionStatus: 'ide_attributed',
    comparisonStatus: 'available',
    displayValue: formatPct(winnerValue) + ' AI adoption',
    displayUnit: 'AI adoption %',
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. ${eligibleTools.map(t => `${getCanonicalWorkflowIdentity(t.name)} ${Math.round(t.value)}%`).join(', ')}. Imbalance: ${formatPct(imbalanceScore)}. Coverage: ${coveragePct}%.`,
    operationalImpact: `AI adoption imbalance of ${formatPct(imbalanceScore)} may create workflow variance across IDEs.`,
    primaryRisk: 'Uneven AI adoption across workflows may reflect task-mix or enablement differences. Do not interpret the adoption gap as a productivity measure.',
    cohort: 'Workflow Fragmentation',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% data coverage.`,
    recommendationState: 'monitor_only',
    urgencyLabel: 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      ...eligibleTools.map(t => ({ metric: getCanonicalWorkflowIdentity(t.name), value: `${Math.round(t.value)}%`, label: 'AI adoption' })),
      { metric: 'Imbalance', value: formatPct(imbalanceScore), label: 'IDE variance' },
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total' }
    ],
    breakdownByTool: Object.fromEntries(eligibleTools.map(t => [t.name, { value: t.value, count: t.count, formatted: `${Math.round(t.value)}% AI adoption`, label: `${getCanonicalWorkflowIdentity(t.name)} (${t.count} sessions)` }])),
    operationalRead: `${eligibleTools.map(t => `${getCanonicalWorkflowIdentity(t.name)}: ${Math.round(t.value)}%`).join(', ')}. Imbalance: ${formatPct(imbalanceScore)}.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
    selectedComparison: { leaderKey: winner.name, baselineKey: runnerUp.name }
  };

  return baseInsight;
}
*/
/* eslint-enable */

/**
 * Generate session-conditioned PR cycle time AI vs Non-AI PI
 */
export function generateSessionConditionedPRCycleTimeAIVsNonAI(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('session-conditioned-pr-cycle-time-ai-vs-non-ai');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;

  // CR5 FINAL DOWNSTREAM P0-1: This PI is DIAGNOSTIC ONLY.
  //
  // There is no direct session→PR attribution in the current data model.
  // Session duration is NOT a proxy for PR cycle time. The presence of
  // GitHub PR data does not establish a join between coding sessions and
  // PR lifecycle outcomes.
  //
  // This generator must NEVER produce calculated AI-vs-non-AI PR-cycle
  // values. It always returns a diagnostic explaining the attribution gap.
  piDebugLog('[RUNTIME_PROOF][session-conditioned-pr-cycle-time-ai-vs-non-ai]', {
    insightId: 'session-conditioned-pr-cycle-time-ai-vs-non-ai',
    stage: 'review-merge',
    isDiagnostic: true,
    reason: 'NO_SESSION_TO_PR_ATTRIBUTION',
    totalSessions
  });

  if (totalSessions < 1) {
    return null;
  }

  const isExplicitAI = (s: any) => s.session_has_ai_activity === true;
  const isExplicitNonAI = (s: any) => s.session_has_ai_activity === false;
  const aiSessions = sessionRows.filter(isExplicitAI);
  const nonAiSessions = sessionRows.filter(isExplicitNonAI);
  const aiPRCount = aiSessions.length;
  const nonAiPRCount = nonAiSessions.length;

  const confidence: ConfidenceLevel = 'medium';
  const coveragePct = 0;

  // Distinguish "GitHub connected but no PR evidence" from "GitHub not connected"
  const githubConnected = input.githubSnapshot?.github_connected === true ||
    (input.metricsSnapshot?.github_connected === true);
  const githubPrCount = input.githubSnapshot?.total_pull_requests ??
    input.metricsSnapshot?.total_pull_requests ?? 0;
  const hasGithubButNoPRs = githubConnected && githubPrCount === 0;

  const diagnosticTitle = 'Session-to-PR attribution is needed to compare AI-assisted behavior with PR cycle time';
  const description = `Linking sessions to PR outcomes is required to measure PR cycle time (AI-assisted vs non-AI sessions) and AI intensity delivery velocity. Current telemetry measures session duration and AI intensity, not PR-level outcomes.`;
  const whatChanged = `Session-to-PR attribution missing. PR cycle time and AI intensity delivery velocity both require this linkage.`;
  const whyItMatters = hasGithubButNoPRs
    ? 'GitHub is connected but no PR evidence is available in the current period. Session-to-PR attribution requires PR data to link coding sessions to PR lifecycle outcomes.'
    : 'Cannot measure PR cycle time or AI intensity delivery velocity without session-to-PR attribution. Connect GitHub and ensure PR data is available to enable both analyses.';
  const recommendation = hasGithubButNoPRs
    ? 'GitHub is connected but no PRs were found in the current period. Session-to-PR attribution requires PR activity to link coding sessions to PR outcomes.'
    : 'Connect GitHub to enable session-to-PR attribution for PR cycle time and AI intensity delivery velocity analysis.';

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: diagnosticTitle,
    cicdStage: 'review-merge',
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'ai_vs_non_ai',
    current: 0,
    baseline: 0,
    delta: 0,
    deltaPct: 0,
    rightMetric: '—',
    rightMetricLabel: 'PR Cycle Time',
    metricDefinition: 'PR cycle time requires explicit session-to-PR lifecycle attribution; session duration is not a proxy',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      `Observed AI signals: ${aiPRCount} sessions (— avg)`,
      `Zero AI-assisted: ${nonAiPRCount} sessions (— avg)`
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: false,
    isDiagnostic: true,
    diagnosticReason: 'WAITING_FOR_SESSION_TO_PR_ATTRIBUTION',
    comparisonState: 'needs_more_data',
    dataDomain: 'attribution_gap',
    sourceLabel: 'Telemetry only',
    sampleUnit: 'sessions',
    sampleLabel: `${totalSessions.toLocaleString()} sessions`,
    attributionStatus: 'session_to_pr_missing',
    comparisonStatus: 'insufficient',
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: `Analysis of ${totalSessions} sessions. Observed AI signals: ${aiPRCount} sessions. Zero AI-assisted: ${nonAiPRCount} sessions. GitHub PR linkage missing — cycle time comparison unavailable.`,
    operationalImpact: '—',
    primaryRisk: 'Session-to-PR attribution is needed to compare AI-assisted behavior with PR cycle time.',
    cohort: 'Review Time Reduction',
    confidenceReasoning: 'Diagnostic: session-to-PR attribution gap prevents PR cycle time comparison.',
    recommendationState: 'monitor_only',
    urgencyLabel: 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: 'Observed AI signals', value: '—', label: 'Avg duration' },
      { metric: 'Zero AI-assisted', value: '—', label: 'Avg duration' },
      { metric: 'Delta', value: '—', label: 'AI advantage' },
      { metric: 'AI Sessions', value: aiPRCount.toString(), label: 'Sessions' },
      { metric: 'Zero AI-assisted Sessions', value: nonAiPRCount.toString(), label: 'Sessions' }
    ],
    breakdownByTool: {
      ai: { value: 0, count: aiPRCount, formatted: '—', label: `Observed AI signals (${aiPRCount} sessions)` },
      non_ai: { value: 0, count: nonAiPRCount, formatted: '—', label: `Zero AI-assisted (${nonAiPRCount} sessions)` }
    },
    operationalRead: `Observed AI signals: — vs Zero AI-assisted: —. GitHub PR linkage missing, cycle time comparison unavailable.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live'
  };

  return baseInsight;
}

/**
 * Generate executive AI yield optimization PI
 */
export function generateExecutiveAIYieldOptimization(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('executive-ai-yield-optimization');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const hasLiveData = totalSessions > 0;

  // TEMPORARY RUNTIME PROOF LOGGING
  piDebugLog('[RUNTIME_PROOF][executive-ai-yield-optimization]', {
    insightId: 'executive-ai-yield-optimization',
    stage: 'plan-code',
    hasLiveData,
    sessionRowsCount: totalSessions,
    sampleSession: sessionRows[0] ? { has_ai: sessionRows[0].session_has_ai_activity, commits: sessionRows[0].session_commits } : null
  });

  let overallYieldImprovement = 0;
  let currentAIAdoption = 0;
  let potentialYieldAtFullAdoption = 0;
  let dynamicTitle = registryEntry.title; // Default to canonical title
  let nonAiSessionCount = 0;
  let aiCommitsPerSession: number | null = null;
  let nonAiCommitsPerSession: number | null = null;
  let aiCommitSamples = 0;
  let nonAiCommitSamples = 0;

  if (hasLiveData) {
    // Compute from live session data
    const isExplicitAI = (s: any) => s.session_has_ai_activity === true;
    const isExplicitNonAI = (s: any) => s.session_has_ai_activity === false;
    const aiSessions = sessionRows.filter(isExplicitAI);
    const nonAiSessions = sessionRows.filter(isExplicitNonAI);

    const aiSessionCount = aiSessions.length;
    nonAiSessionCount = nonAiSessions.length;

    currentAIAdoption = totalSessions > 0 ? (aiSessions.length / totalSessions) * 100 : 0;

    // Calculate yield improvement (commits per session comparison)
    const isEligibleCommit = (s: any) =>
      typeof s.session_commits === 'number' && Number.isFinite(s.session_commits) &&
      s.session_commits_source === 'observed';
    const aiCommits = aiSessions.filter(isEligibleCommit).reduce((sum, s) => sum + s.session_commits, 0);
    aiCommitSamples = aiSessions.filter(isEligibleCommit).length;
    const nonAiCommits = nonAiSessions.filter(isEligibleCommit).reduce((sum, s) => sum + s.session_commits, 0);
    nonAiCommitSamples = nonAiSessions.filter(isEligibleCommit).length;
    
    aiCommitsPerSession = aiCommitSamples > 0 ? aiCommits / aiCommitSamples : null;
    nonAiCommitsPerSession = nonAiCommitSamples > 0 ? nonAiCommits / nonAiCommitSamples : null;
    
    if (aiCommitsPerSession === null || nonAiCommitsPerSession === null || aiCommitSamples < 5 || nonAiCommitSamples < 5) { return null; }
    if (nonAiCommitsPerSession <= 0) return null;
    overallYieldImprovement = ((aiCommitsPerSession - nonAiCommitsPerSession) / nonAiCommitsPerSession) * 100;
    potentialYieldAtFullAdoption = overallYieldImprovement;

    // Dynamic title based on cohort data availability
    const hasBothCohorts = aiSessionCount > 0 && nonAiSessionCount > 0;
    if (!hasBothCohorts) {
      if (aiSessionCount > 0) {
        dynamicTitle = 'AI-assisted vs non-AI session comparison needs more zero-signal sample';
      } else if (nonAiSessionCount > 0) {
        dynamicTitle = 'AI-assisted vs non-AI session comparison needs more AI-assisted sample';
      } else {
        dynamicTitle = 'AI-assisted vs non-AI session comparison needs more data';
      }
    } else {
      // Both cohorts have data - use specific comparative title
      dynamicTitle = 'AI-assisted sessions have higher delivery yield than non-AI sessions';
    }
  } else {
    // No live data — return diagnostic, never use seeded fallback values
    piDebugLog('[GENERATOR_EXEC_AI_YIELD][NO_LIVE_DATA]', 'No session data available, returning diagnostic');
    return {
      id: registryEntry.id,
      title: 'AI yield optimization needs more data',
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      comparisonMode: 'absolute',
      current: 0,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      rightMetric: '—',
      rightMetricLabel: 'Delivery Yield',
      confidence: 'low',
      coveragePct: 0,
      n: 0,
      hasData: false,
      isDiagnostic: true,
      diagnosticReason: 'NEEDS_MORE_TELEMETRY',
      diagnosticUnlockPath: 'Requires more telemetry sessions with AI activity and commit data to measure yield improvement',
      description: 'No telemetry sessions available. AI yield optimization analysis requires session-level instrumentation data.',
    };
  }

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 30 ? 'high' : totalSessions >= 15 ? 'medium' : 'low';
  const coveragePct = totalSessions > 0 ? 100 : 78;

  // Generate narrative based on data source
  let description: string;
  let whatChanged: string;
  let whyItMatters: string;
  let recommendation: string;

  if (hasLiveData) {
    description = `AI-assisted workflows are increasing review pressure with ${formatPct(overallYieldImprovement)} higher delivery yield at ${formatPct(currentAIAdoption)} adoption. This acceleration may be creating reviewer bottlenecks. Scaling to full adoption could unlock ${formatPct(potentialYieldAtFullAdoption)} additional yield, but ensure yield gains don't come at the cost of elevated reopen pressure or deployment instability.`;
    whatChanged = `Observed AI signals throughput increased ${formatPct(overallYieldImprovement)} at ${formatPct(currentAIAdoption)} adoption vs non-AI sessions workflows. Acceleration concentrated in AI-assisted sessions.`;
    whyItMatters = 'Observed throughput differences may coincide with reviewer-capacity pressure. This is an association, not proof that AI signals cause the throughput difference or the quality risk.';
    recommendation = currentAIAdoption < 70
      ? 'Review the AI-assisted workflow with elevated throughput before expanding usage. If quality pressure elevates, implement deployment gating before scaling to more teams.'
      : 'Audit AI-assisted workflow yield against quality metrics. If gains correlate with instability, establish release coordination before further expansion.';
  } else {
    description = `Teams with ${formatPct(currentAIAdoption)} AI adoption achieved ${formatPct(overallYieldImprovement)} higher delivery yield than non-AI sessions workflows. AI-assisted workflows drove this acceleration. Scaling to full adoption could unlock ${formatPct(potentialYieldAtFullAdoption)} additional yield, but ensure yield gains don't come at the cost of elevated reopen pressure or deployment instability.`;
    whatChanged = `At ${formatPct(currentAIAdoption)} AI adoption, teams achieved ${formatPct(overallYieldImprovement)} higher delivery yield vs non-AI sessions workflows. Acceleration concentrated in workflows with AI-assisted.`;
    whyItMatters = `Throughput sustainability requires quality guardrails to prevent elevated rework pressure.`;
    recommendation = currentAIAdoption < 70
      ? 'Incremental adoption requires rollout safeguards. If quality pressure elevates, implement deployment gating before scaling.'
      : 'Audit yield against quality metrics. If gains correlate with instability, establish release coordination before further expansion.';
  }

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: dynamicTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'synthesized',
    comparisonMode: 'ai_vs_non_ai',
    current: overallYieldImprovement,
    baseline: 0,
    delta: overallYieldImprovement,
    deltaPct: overallYieldImprovement,
    rightMetric: formatPct(overallYieldImprovement) + ' yield',
    rightMetricLabel: 'Delivery Yield',
    metricDefinition: 'Synthesized delivery yield improvement from AI-assisted vs non-AI sessions workflows',
    operationalBreadcrumbs: [
      `${aiCommitSamples + nonAiCommitSamples} sessions with observed commits`,
      `AI adoption: ${formatPct(currentAIAdoption)}`,
      `Yield improvement: ${formatPct(overallYieldImprovement)}`,
      `Potential at full adoption: ${formatPct(potentialYieldAtFullAdoption)}`
    ],
    confidence,
    coveragePct,
    // CR5 WS1.5 P0 FIX: ALL displayed Ns must use the qualified commit
    // population (aiCommitSamples + nonAiCommitSamples = 1,069), not
    // totalSessions (1,855). The card, footer, evidence, and n must
    // all reconcile to the same provenance-qualified count.
    n: aiCommitSamples + nonAiCommitSamples,
    hasData: true,
    description,
    whatChanged,
    whyItMatters,
    recommendation,
    evidenceAndContext: hasLiveData
      ? `Synthesis of ${aiCommitSamples + nonAiCommitSamples} sessions with observed commits. Observed AI signals: ${aiCommitSamples} sessions (${aiCommitsPerSession?.toFixed(1)} commits/session). Zero AI-assisted: ${nonAiCommitSamples} sessions (${nonAiCommitsPerSession?.toFixed(1)} commits/session). AI adoption: ${formatPct(currentAIAdoption)}. Yield improvement: ${formatPct(overallYieldImprovement)}. Coverage: ${coveragePct}%.`
      : `Synthesis of ${aiCommitSamples + nonAiCommitSamples} sessions with observed commits. AI-assisted workflows showed ${formatPct(overallYieldImprovement)} yield improvement.`,
    operationalImpact: hasLiveData
      ? `Yield difference of ${formatPct(overallYieldImprovement)} at ${formatPct(currentAIAdoption)} adoption between observed-AI-signal and zero-AI-signal workflows. This is an observed association, not a causal productivity claim.`
      : `The estimated ${formatPct(overallYieldImprovement)} yield difference at ${formatPct(currentAIAdoption)} adoption is synthesized from observed commit rates. This is an inferred association, not a causal productivity claim.`,
    primaryRisk: 'Yield differences concentrated in high-adopting workflows may not scale linearly. This is an observed association; scaling adoption does not guarantee the same yield difference. Validate with quality metrics before expanding.',
    cohort: 'Executive Finding',
    confidenceReasoning: hasLiveData
      ? `${confidence} confidence based on ${aiCommitSamples + nonAiCommitSamples} sessions with observed commits and ${coveragePct}% data coverage.`
      : 'Low confidence based on synthesized yield improvement from multiple Plan & Code metrics. Yield improvement is inferred rather than directly measured, requiring validation with quality metrics.',
    recommendationState: overallYieldImprovement > 15 ? 'action_required' : 'monitor_only',
    urgencyLabel: overallYieldImprovement > 25 ? 'action_required' : overallYieldImprovement > 15 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: hasLiveData
      ? [
          { metric: 'AI Adoption', value: formatPct(currentAIAdoption), label: 'Current adoption' },
          { metric: 'Yield Improvement', value: formatPct(overallYieldImprovement), label: 'Observed' },
          { metric: 'Potential Yield', value: formatPct(potentialYieldAtFullAdoption), label: 'At full adoption' },
          { metric: 'Sessions', value: (aiCommitSamples + nonAiCommitSamples).toString(), label: 'Sessions with observed commits' }
        ]
      : [
          { metric: 'Current AI Adoption', value: formatPct(currentAIAdoption), label: 'org adoption rate' },
          { metric: 'Observed Yield Improvement', value: formatPct(overallYieldImprovement), label: 'at current adoption' },
          { metric: 'Potential Yield', value: formatPct(potentialYieldAtFullAdoption), label: 'at full adoption' },
          { metric: 'Yield Opportunity', value: formatPct(potentialYieldAtFullAdoption - overallYieldImprovement), label: 'additional yield available' },
          { metric: 'Sessions Analyzed', value: (aiCommitSamples + nonAiCommitSamples).toString(), label: 'Sessions with observed commits' }
        ],
    breakdownByTool: hasLiveData
      ? {
          ai: { value: aiCommitsPerSession, count: aiCommitSamples, formatted: `${aiCommitsPerSession.toFixed(1)} commits/session`, label: `Observed AI signals` },
          ...(nonAiCommitSamples > 0 && {
            non_ai: { value: nonAiCommitsPerSession, count: nonAiCommitSamples, formatted: `${nonAiCommitsPerSession.toFixed(1)} commits/session`, label: 'Zero AI-assisted' }
          })
        }
      : {
          ai: { value: overallYieldImprovement, count: 0, formatted: `${formatPct(overallYieldImprovement)} yield`, label: 'Observed AI signals' },
          non_ai: { value: null, count: 0, formatted: 'unavailable', label: 'Zero AI-assisted' }
        },
    operationalRead: hasLiveData
      ? `AI adoption: ${formatPct(currentAIAdoption)}. Yield improvement: ${formatPct(overallYieldImprovement)}. Potential at full adoption: ${formatPct(potentialYieldAtFullAdoption)}.`
      : `At ${formatPct(currentAIAdoption)} adoption, workflows with AI-assisted delivered ${formatPct(overallYieldImprovement)} higher yield. If scaling increases reopen pressure or deployment failure, pause and implement quality guardrails. Correlate yield with quality metrics to detect negative tradeoffs.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'telemetry',
  };

  return baseInsight;
}

/**
 * Generate AI Adoption Rate by IDE PI
 * 
 * Computes AI adoption rate as percentage of sessions with AI activity by IDE
 * Uses session_ai_burst_count > 0 as AI activity indicator
 */
export function generateAIAdoptionRateByIDE(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('ai-adoption-rate-by-ide');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const hasLiveData = totalSessions > 0;

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_AI_ADOPTION_RATE][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }

  // Group sessions by IDE and compute AI adoption rate
  const sessionsByIDE = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Calculate AI adoption rate for each IDE
  const adoptionRates: Record<string, { rate: number; total: number; aiSessions: number }> = {};

  for (const [ide, sessions] of Object.entries(sessionsByIDE)) {
    if (sessions.length === 0) continue;

    const aiSessions = sessions.filter(s => s.session_has_ai_activity === true);
    const adoptionRate = (aiSessions.length / sessions.length) * 100;

    adoptionRates[ide] = {
      rate: adoptionRate,
      total: sessions.length,
      aiSessions: aiSessions.length
    };
  }

  // Determine highest and lowest adoption — only primary workflows (>=25 sessions)
  // can control winner/runner-up, title, delta, recommendation, and ranking.
  // Emerging workflows (<25 sessions) remain visible in breakdown but cannot control claims.
  const allPrimaryEntries = Object.entries(adoptionRates).filter(([_, data]) => isStressMode || data.total >= 25);
  if (allPrimaryEntries.length < 2) {
    piDebugLog('[GENERATOR_AI_ADOPTION_RATE][INSUFFICIENT_PRIMARY_IDE_DATA]', { entries: allPrimaryEntries, allWorkflows: Object.entries(adoptionRates) });
    return null;
  }

  // CR-X 1C.1: Level-B semantic gate — only compare workflows with the same
  // AI-signal measurement semantic. editor_activity_heuristic (VS Code, Cursor)
  // vs agent_authored_known (Claude Code) are NOT directly comparable.
  // Group primary entries by semantic family and use the largest family.
  const entriesByFamily: Record<string, [string, { rate: number; total: number; aiSessions: number }][]> = {};
  for (const entry of allPrimaryEntries) {
    const family = getAISignalSemanticFamily(entry[0]);
    (entriesByFamily[family] ||= []).push(entry);
  }
  const familySizes = Object.entries(entriesByFamily).sort((a, b) => b[1].length - a[1].length);
  const largestFamily = familySizes[0];
  if (!largestFamily || largestFamily[1].length < 2) {
    piDebugLog('[GENERATOR_AI_ADOPTION_RATE][NO_COMPARABLE_SEMANTIC_FAMILY]', {
      families: Object.fromEntries(familySizes.map(([f, e]) => [f, e.map(([id]) => id)])),
    });
    return null;
  }
  // Use only the largest same-semantic family for the comparison claim.
  // Other families remain visible in breakdownByTool but cannot control claims.
  const entries = largestFamily[1];
  const excludedBySemanticGate = allPrimaryEntries.filter(([id]) => !entries.find(([eId]) => eId === id));

  entries.sort((a, b) => b[1].rate - a[1].rate);
  const [highestIDE, highestData] = entries[0];
  const [lowestIDE, lowestData] = entries[entries.length - 1];
  const adoptionGap = highestData.rate - lowestData.rate;
  const isSaturatedAdoption = highestData.rate >= 95 && lowestData.rate >= 95; // Both tools at ~100%

  // CR-X FINAL: Healthy coverage across all qualifying primary workflows is not
  // a decision insight. PI is not a measurement inventory. Suppress when the
  // lowest-coverage workflow is still healthy; retain only material poor or
  // zero-coverage evidence gaps.
  // NOTE: adoptionRate is already a percentage (0-100), not a ratio.
  const HEALTHY_COVERAGE_THRESHOLD = 70;
  if (lowestData.rate >= HEALTHY_COVERAGE_THRESHOLD) {
    piDebugLog('[GENERATOR_AI_ADOPTION_RATE][HEALTHY_COVERAGE_SUPPRESSED]', {
      lowest: lowestData.rate,
      highest: highestData.rate,
      threshold: HEALTHY_COVERAGE_THRESHOLD,
    });
    return null;
  }

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const coveragePct = coveragePct1dp(entries.reduce((sum, [_, data]) => sum + data.total, 0), totalSessions);

  // Primary workflows already have >=25 sessions, so comparison data is always sufficient
  const hasSufficientComparisonData = true;
  
  piDebugLog('[AI_ADOPTION_GENERATOR_DEBUG]', {
    insightId: registryEntry.id,
    entries: entries.map(([ide, data]) => ({ ide, total: data.total, aiSessions: data.aiSessions })),
    hasSufficientComparisonData,
    totalSessions,
    adoptionGap,
    highestIDE,
    lowestIDE
  });

  // CR5 P1.5 P1: Tool-first title — actual tool names + values + metric.
  // CR5 P1.5 P2: Strip " workflow" suffix from titles.
  // CR5 FINAL TITLE DOCTRINE: State the finding (spread), not two values to subtract.
  const tw = (id: string) => getCanonicalWorkflowIdentity(id).replace(' workflow', '');
  let executiveTitle: string;
  if (!hasSufficientComparisonData) {
    executiveTitle = 'Tracked AI signal coverage needs more workflow-attributed sessions';
  } else if (isSaturatedAdoption) {
    executiveTitle = 'Tracked AI signal coverage is saturated across top workflows';
  } else {
    executiveTitle = `Observed AI-signal session coverage varies ${adoptionGap.toFixed(1)} percentage points across primary workflows`;
  }

  // Build breakdownByTool with ALL workflows that have data (not just highest/lowest)
  const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
  for (const [ide, data] of Object.entries(adoptionRates)) {
    if (data.total >= 10 || isStressMode) {
      breakdownByTool[ide] = {
        value: data.rate,
        count: data.total,
        formatted: `${formatPct(data.rate)} signal coverage`,
        label: `${getCanonicalWorkflowIdentity(ide)} (${data.aiSessions} AI sessions)`
      };
    }
  }

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    // CR5 P0.8: Cross-sectional workflow comparison, NOT temporal trend
    presentationKind: 'workflow_comparison',
    comparisonMode: 'absolute',
    current: highestData.rate,
    baseline: lowestData.rate,
    delta: adoptionGap,
    deltaPct: lowestData.rate > 0 ? (adoptionGap / lowestData.rate) * 100 : 0,
    rightMetric: formatPct(highestData.rate) + ' signal coverage',
    rightMetricLabel: 'Tracked AI Signal Coverage',
    // CR4 P0-4: Truthful metric definition — this measures tracked AI signal
    // coverage (sessions with detected AI activity), NOT general AI adoption.
    // AI-native tools (Claude Code) will show ~100% by definition.
    metricDefinition: 'Percentage of sessions with detected AI activity (tracked AI signal coverage) by workflow. AI-native tools show near-100% by definition; this measures instrumentation coverage, not whether developers "use AI".',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      ...entries.map(([ide, data]) => `${getCanonicalWorkflowIdentity(ide)}: ${formatPct(data.rate)} AI signal coverage (${data.aiSessions}/${data.total} sessions)`)
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: !hasSufficientComparisonData
      ? `AI signal coverage baseline across ${entries.length} workflows: ${entries.map(([ide, data]) => `${getCanonicalWorkflowIdentity(ide)} ${formatPct(data.rate)} (${data.total} sessions)`).join(', ')}. Comparison requires complete attribution with at least 25 sessions per workflow.`
      : isSaturatedAdoption
      ? `AI signal coverage is saturated across top workflows: ${entries.map(([ide, data]) => `${getCanonicalWorkflowIdentity(ide)} ${formatPct(data.rate)}`).join(', ')}.`
      : `${getCanonicalWorkflowIdentity(highestIDE)} shows ${formatPct(highestData.rate)} AI signal coverage across ${highestData.total} sessions, ${adoptionGap > 20 ? formatDelta(adoptionGap) + ' higher' : 'similar to'} ${getCanonicalWorkflowIdentity(lowestIDE)} at ${formatPct(lowestData.rate)} (${lowestData.total} sessions).`,
    whatChanged: !hasSufficientComparisonData
      ? `AI signal coverage baseline: ${entries.map(([ide, data]) => `${getCanonicalWorkflowIdentity(ide)} ${formatPct(data.rate)} (${data.aiSessions}/${data.total} sessions)`).join('. ')}.`
      : isSaturatedAdoption
      ? `AI signal coverage is consistent across workflows: ${entries.map(([ide, data]) => `${getCanonicalWorkflowIdentity(ide)} ${formatPct(data.rate)}`).join(', ')}.`
      : `AI signal coverage varies by workflow: ${getCanonicalWorkflowIdentity(highestIDE)} ${formatPct(highestData.rate)} vs ${getCanonicalWorkflowIdentity(lowestIDE)} ${formatPct(lowestData.rate)} (${formatDelta(adoptionGap)} gap).`,
    whyItMatters: !hasSufficientComparisonData
      ? `AI signal coverage measurement requires sufficient sample sizes per workflow for reliable comparison. ${entries.length} workflows with data (canonical population: ${totalSessions}).`
      : isSaturatedAdoption
      ? `AI signal coverage is saturated across top workflows. ${entries.map(([ide, data]) => `${getCanonicalWorkflowIdentity(ide)} ${formatPct(data.rate)}`).join(', ')}.`
      : `AI signal coverage varies ${formatDelta(adoptionGap)} between ${getCanonicalWorkflowIdentity(highestIDE)} and ${getCanonicalWorkflowIdentity(lowestIDE)}. This measures the share of sessions with any observed AI signal (AI-assisted sessions), NOT AI usage intensity. Differences may reflect tool instrumentation, workflow design, or AI integration patterns.`,
    recommendation: !hasSufficientComparisonData
      ? `Increase sample collection for ${entries.filter(([_, data]) => data.total < 25).map(([ide, _]) => getCanonicalWorkflowIdentity(ide)).join(', ')} to enable reliable workflow comparison. Target at least 25 sessions per workflow.`
      : isSaturatedAdoption
      ? `AI signal coverage is consistent across workflows. Focus on optimizing AI usage patterns and advanced AI workflows.`
      : adoptionGap > 30
        ? `Investigate why ${getCanonicalWorkflowIdentity(lowestIDE)} shows ${formatPct(adoptionGap)} lower AI signal coverage than ${getCanonicalWorkflowIdentity(highestIDE)}. Check whether this reflects tool access, instrumentation gaps, or workflow design differences.`
        : 'Monitor AI signal coverage patterns for consistency across workflows.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. ${entries.map(([ide, data]) => `${getCanonicalWorkflowIdentity(ide)}: ${formatPct(data.rate)} signal coverage (${data.aiSessions} with AI-assisted / ${data.total} sessions)`).join('. ')}. Coverage: ${coveragePct}%.`,
    operationalImpact: isSaturatedAdoption
      ? 'Consistent AI signal coverage across workflows.'
      : `${adoptionGap > 20 ? formatDelta(adoptionGap) + ' signal coverage gap' : 'Similar signal coverage'} across workflows.`,
    primaryRisk: isSaturatedAdoption
      ? 'Focus shifts from coverage to AI workflow optimization.'
      : 'Inconsistent AI signal coverage may reflect workflow design or instrumentation differences.',
    cohort: 'AI Enablement',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% data coverage across ${entries.length} workflows.`,
    recommendationState: isSaturatedAdoption ? 'monitor_only' : adoptionGap > 30 ? 'action_required' : 'monitor_only',
    urgencyLabel: isSaturatedAdoption ? 'informational' : adoptionGap > 30 ? 'action_required' : 'monitor',
    // CR-X 2026-08-30: AI signal coverage (ai_burst>0 share) is instrumentation/
    // signal-presence context, NOT adoption. A large gap between workflows with
    // different AI-signal semantics (e.g. Claude autonomous sessions produce no
    // bursts) is contextual, not a decision finding. See CR-X-ED-CENSUS-2026-08-30.md.
    lifecycleClass: 'contextual',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      ...entries.map(([ide, data]) => ({ metric: getCanonicalWorkflowIdentity(ide), value: formatPct(data.rate), label: 'AI signal coverage' })),
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total' }
    ],
    breakdownByTool,
    operationalRead: `${entries.map(([ide, data]) => `${getCanonicalWorkflowIdentity(ide)}: ${formatPct(data.rate)} signal coverage`).join(', ')}.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
    selectedComparison: { leaderKey: highestIDE, baselineKey: lowestIDE }
  };

  return baseInsight;
}

/**
 * Generate Focus Ratio by IDE PI
 * 
 * Computes focus ratio (time in primary file / total session time) by IDE
 * Uses focus_ratio field from session data
 */
export function generateFocusRatioByIDE(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('focus-ratio-by-ide');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const hasLiveData = totalSessions > 0;

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_FOCUS_RATIO][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }

  // Group sessions by IDE and compute focus ratio — build from sessions only
  const sessionsByIDE = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Calculate average focus ratio for each IDE
  const focusRatios: Record<string, { ratio: number; total: number; validSessions: number }> = {};

  for (const [ide, sessions] of Object.entries(sessionsByIDE)) {
    if (sessions.length === 0) continue;

    const validSessions = sessions.filter(s => 
      typeof s.focus_ratio === 'number' && 
      s.focus_ratio > 0 && 
      s.focus_ratio <= 1
    );

    if (validSessions.length === 0) continue;

    const avgFocusRatio = validSessions.reduce((sum, s) => sum + s.focus_ratio, 0) / validSessions.length;

    focusRatios[ide] = {
      ratio: avgFocusRatio * 100,
      total: sessions.length,
      validSessions: validSessions.length
    };
  }

  // Determine highest and lowest focus ratio (higher is better for focus efficiency)
  const entries = Object.entries(focusRatios).filter(([_, data]) => isStressMode || data.validSessions >= 10);
  if (entries.length < 2) {
    piDebugLog('[GENERATOR_FOCUS_RATIO][INSUFFICIENT_IDE_DATA]', { entries });
    return null;
  }

  // Sort descending: higher focus ratio (better focus) first
  entries.sort((a, b) => b[1].ratio - a[1].ratio);
  const [highestIDE, highestData] = entries[0];
  const [lowestIDE, lowestData] = entries[entries.length - 1];
  const focusGap = highestData.ratio - lowestData.ratio;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const coveragePct = coveragePct1dp(entries.reduce((sum, [_, data]) => sum + data.validSessions, 0), totalSessions);

  // Executive title based on focus pattern (higher is better) - follow title doctrine (show actual values)
  // CR5 P1.5 P2: Strip " workflow" suffix from titles.
  // CR5 FINAL TITLE DOCTRINE: Neutral pp difference, no causality.
  const tw = (id: string) => getCanonicalWorkflowIdentity(id).replace(' workflow', '');
  let executiveTitle: string;
  // If both ratios are sub-1%, classify as diagnostic with instrumentation caveat
  if (highestData.ratio < 1 && lowestData.ratio < 1) {
    executiveTitle = 'Focus ratio instrumentation needs validation before workflow ranking';
  } else if (focusGap > 10) {
    executiveTitle = `Focus ratio differs ${focusGap.toFixed(1)}pp between ${tw(highestIDE)} and ${tw(lowestIDE)}`;
  } else if (highestData.ratio > 70) {
    executiveTitle = `Focus ratios are high across primary workflows`;
  } else {
    executiveTitle = `Focus ratios vary across primary workflows`;
  }

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    // CR5 P0.8: Cross-sectional workflow comparison
    presentationKind: 'workflow_comparison',
    comparisonMode: 'absolute',
    current: highestData.ratio,
    baseline: lowestData.ratio,
    delta: focusGap,
    deltaPct: lowestData.ratio > 0 ? (focusGap / lowestData.ratio) * 100 : 0,
    rightMetric: formatPct(highestData.ratio) + ' focus',
    rightMetricLabel: 'Focus Ratio',
    // CR5 WS1.5 P0: Document the derivation — focus_ratio is DERIVED from
    // active_coding_duration / session_duration in addDerivedSessionFields.
    // This is the single authoritative focus metric. The raw focus_ratio
    // API field is not instrumented (0 for all sessions); the derived value
    // is legitimate and provenance-traced from observed active_coding_duration_ms
    // and duration_ms fields.
    metricDefinition: 'Derived focus ratio = active_coding_duration / session_duration (computed in addDerivedSessionFields from observed active_coding_duration_ms and duration_ms)',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      `${highestIDE}: ${formatPct(highestData.ratio)} focus ratio (${highestData.validSessions} valid sessions)`,
      `${lowestIDE}: ${formatPct(lowestData.ratio)} focus ratio (${lowestData.validSessions} valid sessions)`
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: `${getCanonicalWorkflowIdentity(highestIDE)} developers maintain ${formatPct(highestData.ratio)} focus ratio, ${focusGap > 10 ? formatDelta(focusGap) + ' higher' : 'similar to'} ${getCanonicalWorkflowIdentity(lowestIDE)} at ${formatPct(lowestData.ratio)}. Focus ratio indicates time spent in primary file vs context switching.`,
    whatChanged: `Focus ratio variance: ${getCanonicalWorkflowIdentity(highestIDE)} ${formatPct(highestData.ratio)} vs ${getCanonicalWorkflowIdentity(lowestIDE)} ${formatPct(lowestData.ratio)} (${focusGap > 10 ? formatDelta(focusGap) + ' difference' : 'similar'}).`,
    whyItMatters: 'Focus ratio measures the share of session time spent in a primary file versus context switching. Lower focus ratios indicate more interruption. This is an observation about work patterns, not a causal measure of delivery velocity or defect rates.',
    recommendation: focusGap > 20
      ? `${getCanonicalWorkflowIdentity(lowestIDE)} focus ratio is ${formatPct(lowestData.ratio)} vs ${getCanonicalWorkflowIdentity(highestIDE)} ${formatPct(highestData.ratio)}, indicating excessive context switching. Implement notification quiet hours, reduce meeting fragmentation, or investigate environment configuration to improve deep work capacity and delivery speed.`
      : 'Focus ratios are healthy. Monitor for decreases that may indicate increased meeting load or workflow fragmentation impacting delivery velocity.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. ${getCanonicalWorkflowIdentity(highestIDE)}: ${formatPct(highestData.ratio)} average focus ratio. ${getCanonicalWorkflowIdentity(lowestIDE)}: ${formatPct(lowestData.ratio)} average focus ratio. Coverage: ${coveragePct}%.`,
    operationalImpact: `${focusGap > 10 ? formatDelta(focusGap) + ' focus gap' : 'Similar focus'} may indicate different workflow patterns or interruption levels.`,
    primaryRisk: 'Lower focus ratios correlate with context switching, which may reduce code quality and increase delivery time.',
    cohort: 'Workflow Focus',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% valid focus ratio data across ${entries.length} IDEs.`,
    recommendationState: focusGap > 20 ? 'action_required' : 'monitor_only',
    urgencyLabel: focusGap > 20 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: getCanonicalWorkflowIdentity(highestIDE), value: formatPct(highestData.ratio), label: 'Focus ratio' },
      { metric: getCanonicalWorkflowIdentity(lowestIDE), value: formatPct(lowestData.ratio), label: 'Focus ratio' },
      { metric: 'Focus Gap', value: formatPct(focusGap), label: 'IDE variance' },
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total' }
    ],
    // CR5 WS1.5 P0: Include ALL workflows with data in breakdownByTool,
    // not just highest/lowest. This ensures the rendering layer can build
    // comparison rows and show the real finding instead of falling back
    // to "needs more data" text.
    breakdownByTool: Object.fromEntries(
      Object.entries(focusRatios)
        .filter(([_, data]) => isStressMode || data.validSessions >= 10)
        .map(([ide, data]) => [ide, {
          value: data.ratio,
          count: data.validSessions,
          formatted: `${formatPct(data.ratio)} focus`,
          label: `${getCanonicalWorkflowIdentity(ide)} (${data.validSessions} sessions)`
        }])
    ),
    operationalRead: `${getCanonicalWorkflowIdentity(highestIDE)}: ${formatPct(highestData.ratio)} focus vs ${getCanonicalWorkflowIdentity(lowestIDE)}: ${formatPct(lowestData.ratio)} focus (${focusGap > 0.1 ? formatDelta(focusGap * 100) + ' difference' : 'similar'}).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
    // CR5 WS1.6 P0: Set selectedComparison so the adapter/render layer uses
    // the SAME pair as the title. Without this, the adapter falls back to
    // eligible[0] vs eligible[1] (sorted by value), which may differ from
    // the generator's highest/lowest pair.
    selectedComparison: { leaderKey: highestIDE, baselineKey: lowestIDE }
  };

  return baseInsight;
}

/**
 * Generate Debug Time by IDE PI
 * 
 * Computes average debug time per session by IDE
 * Uses debug_time_ms field from session data
 */
export function generateDebugTimeByIDE(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('debug-time-by-ide');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const hasLiveData = totalSessions > 0;

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_DEBUG_TIME][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }
  
  // Check if session_debug_ratio field exists in session data (derived from debug_time_ms)
  const sampleSession = sessionRows[0];
  piDebugLog('[GENERATOR_DEBUG_TIME][FIELD_CHECK]', {
    hasSessionDebugRatio: 'session_debug_ratio' in sampleSession,
    sessionDebugRatioValue: sampleSession?.session_debug_ratio,
    hasDebugTimeMs: 'debug_time_ms' in sampleSession,
    debugTimeMsValue: sampleSession?.debug_time_ms,
    sampleKeys: Object.keys(sampleSession).slice(0, 20)
  });

  // Group sessions by IDE using canonical grouping (includes devin, cursor, vscode, etc.)
  const sessionsByIDE = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Calculate average debug time for each IDE
  // Prefer session_debug_ratio (derived field) over raw debug_time_ms
  const debugTimes: Record<string, { avgMinutes: number; total: number; validSessions: number }> = {};

  for (const [ide, sessions] of Object.entries(sessionsByIDE)) {
    if (sessions.length === 0) continue;

    // Use session_debug_ratio if available, otherwise fall back to debug_time_ms
    const validSessions = sessions.filter(s => 
      (typeof s.session_debug_ratio === 'number' && s.session_debug_ratio > 0) ||
      (typeof s.debug_time_ms === 'number' && s.debug_time_ms > 0)
    );

    if (validSessions.length === 0) continue;

    // Calculate from session_debug_ratio (preferred) or debug_time_ms (fallback)
    const totalDebugMs = validSessions.reduce((sum, s) => {
      if (typeof s.session_debug_ratio === 'number' && s.session_debug_ratio > 0) {
        return sum + (s.session_debug_ratio * (s.duration_ms || 0));
      }
      return sum + (s.debug_time_ms || 0);
    }, 0);
    const avgDebugMinutes = (totalDebugMs / validSessions.length) / 60000; // Convert to minutes

    debugTimes[ide] = {
      avgMinutes: avgDebugMinutes,
      total: sessions.length,
      validSessions: validSessions.length
    };
  }

  // Determine highest and lowest debug time
  const entries = Object.entries(debugTimes).filter(([_, data]) => isStressMode || data.validSessions >= 10);
  if (entries.length < 2) {
    piDebugLog('[GENERATOR_DEBUG_TIME][INSUFFICIENT_IDE_DATA]', { entries });
    return null;
  }

  entries.sort((a, b) => b[1].avgMinutes - a[1].avgMinutes);
  const [highestIDE, highestData] = entries[0];
  const [lowestIDE, lowestData] = entries[entries.length - 1];
  const debugGap = highestData.avgMinutes - lowestData.avgMinutes;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const coveragePct = coveragePct1dp(entries.reduce((sum, [_, data]) => sum + data.validSessions, 0), totalSessions);

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: registryEntry.title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'trend',
    current: highestData.avgMinutes,
    baseline: lowestData.avgMinutes,
    delta: debugGap,
    deltaPct: lowestData.avgMinutes > 0 ? (debugGap / lowestData.avgMinutes) * 100 : 0,
    rightMetric: formatMinutes(highestData.avgMinutes) + '/session',
    rightMetricLabel: 'Debug Time',
    metricDefinition: 'Average time spent debugging per development session (telemetry visibility)',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      `${highestIDE}: ${formatMinutes(highestData.avgMinutes)} debug time/session (${highestData.validSessions} sessions)`,
      `${lowestIDE}: ${formatMinutes(lowestData.avgMinutes)} debug time/session (${lowestData.validSessions} sessions)`
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: `${getCanonicalWorkflowIdentity(highestIDE)} developers average ${formatMinutes(highestData.avgMinutes)} debug time per session, ${debugGap > 5 ? formatDelta(debugGap) + ' higher' : 'similar to'} ${getCanonicalWorkflowIdentity(lowestIDE)} at ${formatMinutes(lowestData.avgMinutes)}. Debug time indicates troubleshooting activity and code complexity.`,
    whatChanged: `Debug time variance: ${getCanonicalWorkflowIdentity(highestIDE)} ${formatMinutes(highestData.avgMinutes)}/session vs ${getCanonicalWorkflowIdentity(lowestIDE)} ${formatMinutes(lowestData.avgMinutes)}/session (${debugGap > 5 ? formatDelta(debugGap) + ' difference' : 'similar'}).`,
    whyItMatters: 'Debug time measures troubleshooting activity within sessions. Higher debug time may reflect code complexity, test-coverage gaps, or technical debt. This is an observation about where troubleshooting time is concentrated, not a causal measure of productivity loss or delivery impact.',
    recommendation: debugGap > 15
      ? `${getCanonicalWorkflowIdentity(highestIDE)} shows significantly higher debug time (${formatMinutes(highestData.avgMinutes)}/session vs ${formatMinutes(lowestData.avgMinutes)}), indicating code complexity or technical debt. Investigate test coverage gaps, refactor complex code paths, or improve documentation to reduce troubleshooting time and accelerate delivery velocity.`
      : 'Debug time patterns are healthy. Monitor for increases that may indicate growing complexity or technical debt accumulation impacting delivery timelines.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. ${getCanonicalWorkflowIdentity(highestIDE)}: ${formatMinutes(highestData.avgMinutes)} avg debug time. ${getCanonicalWorkflowIdentity(lowestIDE)}: ${formatMinutes(lowestData.avgMinutes)} avg debug time. Coverage: ${coveragePct}%.`,
    operationalImpact: `${debugGap > 5 ? formatDelta(debugGap) + ' debug time gap' : 'Similar debug time'} may indicate different code complexity or testing practices.`,
    primaryRisk: 'High debug time correlates with code complexity and may slow delivery if not addressed through better testing or code quality practices.',
    cohort: 'Code Quality',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% debug time data across ${entries.length} IDEs.`,
    recommendationState: debugGap > 15 ? 'investigate' : 'monitor_only',
    urgencyLabel: debugGap > 15 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: getCanonicalWorkflowIdentity(highestIDE), value: formatMinutes(highestData.avgMinutes), label: 'Debug time/session' },
      { metric: getCanonicalWorkflowIdentity(lowestIDE), value: formatMinutes(lowestData.avgMinutes), label: 'Debug time/session' },
      { metric: 'Debug Gap', value: formatMinutes(debugGap), label: 'IDE variance' },
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total' }
    ],
    breakdownByTool: {
      [highestIDE]: { value: highestData.avgMinutes, count: highestData.validSessions, formatted: `${formatMinutes(highestData.avgMinutes)}/session`, label: `${getCanonicalWorkflowIdentity(highestIDE)} (${highestData.validSessions} sessions)` },
      [lowestIDE]: { value: lowestData.avgMinutes, count: lowestData.validSessions, formatted: `${formatMinutes(lowestData.avgMinutes)}/session`, label: `${getCanonicalWorkflowIdentity(lowestIDE)} (${lowestData.validSessions} sessions)` }
    },
    operationalRead: `${getCanonicalWorkflowIdentity(highestIDE)}: ${formatMinutes(highestData.avgMinutes)}/session vs ${getCanonicalWorkflowIdentity(lowestIDE)}: ${formatMinutes(lowestData.avgMinutes)}/session (${debugGap > 5 ? formatDelta(debugGap) + ' difference' : 'similar'}).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live'
  };

  return baseInsight;
}

/**
 * Generate Terminal Time by IDE PI
 * 
 * Computes average terminal time per session by IDE
 * Uses terminal_active_time_ms field from session data
 */
export function generateTerminalTimeByIDE(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('terminal-time-by-ide');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const hasLiveData = totalSessions > 0;

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_TERMINAL_TIME][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }
  
  // Check if session_terminal_ratio field exists in session data (derived from terminal_active_time_ms)
  const sampleSession = sessionRows[0];
  piDebugLog('[GENERATOR_TERMINAL_TIME][FIELD_CHECK]', {
    hasSessionTerminalRatio: 'session_terminal_ratio' in sampleSession,
    sessionTerminalRatioValue: sampleSession?.session_terminal_ratio,
    hasTerminalActiveTimeMs: 'terminal_active_time_ms' in sampleSession,
    terminalActiveTimeMsValue: sampleSession?.terminal_active_time_ms,
    sampleKeys: Object.keys(sampleSession).slice(0, 20)
  });

  // Group sessions by IDE — build from sessions only
  const sessionsByIDE = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Calculate average terminal time for each IDE
  // Prefer session_terminal_ratio (derived field) over raw terminal_active_time_ms
  const terminalTimes: Record<string, { avgMinutes: number; total: number; validSessions: number }> = {};

  for (const [ide, sessions] of Object.entries(sessionsByIDE)) {
    if (sessions.length === 0) continue;

    // Use session_terminal_ratio if available, otherwise fall back to terminal_active_time_ms
    const validSessions = sessions.filter(s => 
      (typeof s.session_terminal_ratio === 'number' && s.session_terminal_ratio > 0) ||
      (typeof s.terminal_active_time_ms === 'number' && s.terminal_active_time_ms > 0)
    );

    if (validSessions.length === 0) continue;

    // Calculate from session_terminal_ratio (preferred) or terminal_active_time_ms (fallback)
    const totalTerminalMs = validSessions.reduce((sum, s) => {
      if (typeof s.session_terminal_ratio === 'number' && s.session_terminal_ratio > 0) {
        return sum + (s.session_terminal_ratio * (s.duration_ms || 0));
      }
      return sum + (s.terminal_active_time_ms || 0);
    }, 0);
    const avgTerminalMinutes = (totalTerminalMs / validSessions.length) / 60000; // Convert to minutes

    terminalTimes[ide] = {
      avgMinutes: avgTerminalMinutes,
      total: sessions.length,
      validSessions: validSessions.length
    };
  }

  // Determine highest and lowest terminal time
  const entries = Object.entries(terminalTimes).filter(([_, data]) => isStressMode || data.validSessions >= 10);
  if (entries.length < 2) {
    piDebugLog('[GENERATOR_TERMINAL_TIME][INSUFFICIENT_IDE_DATA]', { entries });
    return null;
  }

  entries.sort((a, b) => b[1].avgMinutes - a[1].avgMinutes);
  const [highestIDE, highestData] = entries[0];
  const [lowestIDE, lowestData] = entries[entries.length - 1];
  const terminalGap = highestData.avgMinutes - lowestData.avgMinutes;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const coveragePct = coveragePct1dp(entries.reduce((sum, [_, data]) => sum + data.validSessions, 0), totalSessions);

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: registryEntry.title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'trend',
    current: highestData.avgMinutes,
    baseline: lowestData.avgMinutes,
    delta: terminalGap,
    deltaPct: lowestData.avgMinutes > 0 ? (terminalGap / lowestData.avgMinutes) * 100 : 0,
    rightMetric: formatMinutes(highestData.avgMinutes) + '/session',
    rightMetricLabel: 'Terminal Time',
    metricDefinition: 'Average time spent in terminal per development session (telemetry visibility)',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      `${highestIDE}: ${formatMinutes(highestData.avgMinutes)} terminal time/session (${highestData.validSessions} sessions)`,
      `${lowestIDE}: ${formatMinutes(lowestData.avgMinutes)} terminal time/session (${lowestData.validSessions} sessions)`
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: `${highestIDE} developers average ${formatMinutes(highestData.avgMinutes)} terminal time per session, ${terminalGap > 5 ? formatDelta(terminalGap) + ' higher' : 'similar to'} ${lowestIDE} at ${formatMinutes(lowestData.avgMinutes)}. Terminal time indicates command-line workflow patterns.`,
    whatChanged: `Terminal time variance: ${highestIDE} ${formatMinutes(highestData.avgMinutes)}/session vs ${lowestIDE} ${formatMinutes(lowestData.avgMinutes)}/session (${terminalGap > 5 ? formatDelta(terminalGap) + ' difference' : 'similar'}).`,
    whyItMatters: 'Terminal time measures command-line activity within sessions. Higher terminal time may reflect CLI-heavy workflows, automation practices, or environment friction. This is an observation about workflow patterns, not a causal measure of delivery velocity or productivity.',
    recommendation: terminalGap > 15
      ? `${highestIDE} shows significantly higher terminal time (${formatMinutes(highestData.avgMinutes)}/session vs ${formatMinutes(lowestData.avgMinutes)}), indicating CLI-heavy workflows or environment friction. Investigate automation opportunities, optimize build scripts, or streamline deployment processes to reduce manual terminal work and accelerate delivery.`
      : 'Terminal time patterns are healthy. Monitor for increases that may indicate workflow inefficiency or lack of automation impacting productivity.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. ${highestIDE}: ${formatMinutes(highestData.avgMinutes)} avg terminal time. ${lowestIDE}: ${formatMinutes(lowestData.avgMinutes)} avg terminal time. Coverage: ${coveragePct}%.`,
    operationalImpact: `${terminalGap > 5 ? formatDelta(terminalGap) + ' terminal time gap' : 'Similar terminal time'} may indicate different workflow patterns or automation levels.`,
    primaryRisk: 'Significant terminal time variance may indicate inconsistent workflow patterns or tooling across IDEs.',
    cohort: 'Workflow Patterns',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% terminal time data across ${entries.length} IDEs.`,
    recommendationState: terminalGap > 15 ? 'investigate' : 'monitor_only',
    urgencyLabel: terminalGap > 15 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: highestIDE, value: formatMinutes(highestData.avgMinutes), label: 'Terminal time/session' },
      { metric: lowestIDE, value: formatMinutes(lowestData.avgMinutes), label: 'Terminal time/session' },
      { metric: 'Terminal Gap', value: formatMinutes(terminalGap), label: 'IDE variance' },
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total' }
    ],
    breakdownByTool: {
      [highestIDE]: { value: highestData.avgMinutes, count: highestData.validSessions, formatted: `${formatMinutes(highestData.avgMinutes)}/session`, label: `${highestIDE} (${highestData.validSessions} sessions)` },
      [lowestIDE]: { value: lowestData.avgMinutes, count: lowestData.validSessions, formatted: `${formatMinutes(lowestData.avgMinutes)}/session`, label: `${lowestIDE} (${lowestData.validSessions} sessions)` }
    },
    operationalRead: `${highestIDE}: ${formatMinutes(highestData.avgMinutes)}/session vs ${lowestIDE}: ${formatMinutes(lowestData.avgMinutes)}/session (${terminalGap > 5 ? formatDelta(terminalGap) + ' difference' : 'similar'}).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live'
  };

  return baseInsight;
}

/**
 * Generate Time to First Commit by IDE PI
 * 
 * Computes median time to first commit by IDE
 * Uses time_to_first_commit_ms field from session data
 */
export function generateTimeToFirstCommitByIDE(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('time-to-first-commit-by-ide');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const hasLiveData = totalSessions > 0;

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_TTFC][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }

  // Group sessions by IDE — build from sessions only
  const sessionsByIDE = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Calculate median TTFC for each IDE
  const ttfcData: Record<string, { medianMinutes: number; total: number; validSessions: number }> = {};

  for (const [ide, sessions] of Object.entries(sessionsByIDE)) {
    if (sessions.length === 0) continue;

    // CR5 WS1.4 P0 FIX: Only observed TTFC (from proven commit events) is
    // eligible. The PI engine now receives enriched rows with ttfc_source
    // classification. Fallback TTFC (canonical-only, not enriched) and
    // simulated TTFC must NOT enter the observed comparison denominator.
    // This makes the generator denominator exactly match the proven
    // authority (1,069 observed TTFC-qualified sessions).
    const validSessions = sessions.filter(s =>
      typeof s.time_to_first_commit_ms === 'number' &&
      s.time_to_first_commit_ms > 0 &&
      s.ttfc_source === 'observed'
    );

    if (validSessions.length === 0) continue;

    const ttfcMinutes = validSessions.map(s => s.time_to_first_commit_ms / 60000); // Convert to minutes
    ttfcMinutes.sort((a, b) => a - b);
    const medianTTFC = ttfcMinutes[Math.floor(ttfcMinutes.length / 2)];

    ttfcData[ide] = {
      medianMinutes: medianTTFC,
      total: sessions.length,
      validSessions: validSessions.length
    };
  }

  // Determine fastest and slowest TTFC (lower is better for onboarding efficiency)
  const entries = Object.entries(ttfcData).filter(([_, data]) => isStressMode || data.validSessions >= 10);
  if (entries.length < 2) {
    piDebugLog('[GENERATOR_TTFC][INSUFFICIENT_IDE_DATA]', { entries });
    return null;
  }

  // Sort ascending: lower TTFC (faster onboarding) first
  entries.sort((a, b) => a[1].medianMinutes - b[1].medianMinutes);
  const [fastestIDE, fastestData] = entries[0];
  const [slowestIDE, slowestData] = entries[entries.length - 1];
  const ttfcGap = slowestData.medianMinutes - fastestData.medianMinutes;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  // CR5 WS2 #14 P0-2: coveragePct = observed-qualified N / canonical population.
  // This is the correct semantic: "% of canonical population with observed TTFC."
  const observedQualifiedN = entries.reduce((sum, [_, data]) => sum + data.validSessions, 0);
  const coveragePct = coveragePct1dp(observedQualifiedN, totalSessions);

  // CR5 P0.9: Decision-grade title with values and N.
  let executiveTitle: string;
  if (ttfcGap > 5) {
    const ratio = (slowestData.medianMinutes / fastestData.medianMinutes).toFixed(1);
    executiveTitle = `${getCanonicalWorkflowIdentity(slowestIDE)} shows ${ratio}x longer median time-to-first-commit vs ${getCanonicalWorkflowIdentity(fastestIDE)} (${formatMinutes(slowestData.medianMinutes)} vs ${formatMinutes(fastestData.medianMinutes)}, N=${slowestData.validSessions} vs ${fastestData.validSessions})`;
  } else if (fastestData.medianMinutes < 5) {
    executiveTitle = 'Time-to-first-commit is fast across primary workflows';
  } else {
    executiveTitle = 'Time-to-first-commit varies across primary workflows';
  }

  // Build breakdownByTool with ALL workflows that have data
  const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
  for (const [ide, data] of Object.entries(ttfcData)) {
    if (data.validSessions >= 10 || isStressMode) {
      breakdownByTool[ide] = {
        value: data.medianMinutes,
        count: data.validSessions,
        formatted: `${formatMinutes(data.medianMinutes)} median`,
        label: `${getCanonicalWorkflowIdentity(ide)} (${data.validSessions} sessions)`
      };
    }
  }

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    // CR5 P0.9: Cross-sectional workflow comparison
    presentationKind: 'workflow_comparison',
    comparisonMode: 'absolute',
    current: slowestData.medianMinutes,
    baseline: fastestData.medianMinutes,
    delta: ttfcGap,
    deltaPct: fastestData.medianMinutes > 0 ? (ttfcGap / fastestData.medianMinutes) * 100 : 0,
    rightMetric: formatMinutes(slowestData.medianMinutes) + ' median',
    rightMetricLabel: 'Time to First Commit',
    metricDefinition: 'Median time from session start to first commit (onboarding efficiency indicator)',
    operationalBreadcrumbs: [
      `${observedQualifiedN} observed-TTFC sessions analyzed (of ${totalSessions} canonical)`,
      ...entries.map(([ide, data]) => `${ide}: ${formatMinutes(data.medianMinutes)} median TTFC (${data.validSessions} sessions)`)
    ],
    confidence,
    coveragePct,
    // CR5 WS2 #14 P0-2: n = observed-qualified N (1,069), NOT canonical total (1,855).
    // The card, footer, ranking sample weight, and confidence must all use
    // the provenance-qualified evidence population actually used in the
    // calculation.
    n: observedQualifiedN,
    hasData: true,
    description: ttfcGap > 30
      ? `${slowestIDE} developers take ${formatMinutes(slowestData.medianMinutes)} median time to first commit, ${formatDelta(ttfcGap)} longer than ${fastestIDE} at ${formatMinutes(fastestData.medianMinutes)}. TTFC indicates onboarding efficiency and workflow setup time.`
      : `TTFC varies across workflows: ${entries.map(([ide, data]) => `${ide} ${formatMinutes(data.medianMinutes)} median`).join(', ')}.`,
    whatChanged: ttfcGap > 30
      ? `TTFC variance: ${fastestIDE} ${formatMinutes(fastestData.medianMinutes)} median vs ${slowestIDE} ${formatMinutes(slowestData.medianMinutes)} median (${formatDelta(ttfcGap)} difference).`
      : `TTFC across workflows: ${entries.map(([ide, data]) => `${ide} ${formatMinutes(data.medianMinutes)} median`).join(', ')}.`,
    whyItMatters: `Time to first commit measures the elapsed time from session start to first commit. ${observedQualifiedN} observed-TTFC sessions across ${entries.length} workflows (canonical population: ${totalSessions}). Difference of ${formatMinutes(ttfcGap)} between fastest and slowest workflows.`,
    recommendation: ttfcGap > 5
      ? `Compare task types and session contexts between ${getCanonicalWorkflowIdentity(fastestIDE)} and ${getCanonicalWorkflowIdentity(slowestIDE)} to understand the TTFC gap. Check whether longer TTFC reflects more complex setup, different task types, or environment configuration differences. Do not equate fastest first commit with higher productivity.`
      : fastestData.medianMinutes < 5
      ? 'TTFC patterns are consistent across workflows. Monitor for changes that may indicate environment complexity shifts.'
      : 'Monitor TTFC patterns for consistency across workflows.',
    evidenceAndContext: `Analysis of ${observedQualifiedN} observed-TTFC sessions (of ${totalSessions} canonical). ${entries.map(([ide, data]) => `${ide}: ${formatMinutes(data.medianMinutes)} median TTFC`).join('. ')}. Coverage: ${coveragePct}%.`,
    operationalImpact: `${ttfcGap > 5 ? formatDelta(ttfcGap) + ' TTFC gap' : 'Similar TTFC'} may indicate different onboarding efficiency or environment setup.`,
    primaryRisk: 'Long TTFC correlates with slower onboarding and may reduce developer productivity, especially for new team members.',
    cohort: 'Onboarding Efficiency',
    confidenceReasoning: `${confidence} confidence based on ${observedQualifiedN} observed-TTFC sessions with ${coveragePct}% coverage across ${entries.length} IDEs.`,
    recommendationState: ttfcGap > 15 ? 'investigate' : 'monitor_only',
    urgencyLabel: ttfcGap > 15 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      ...entries.map(([ide, data]) => ({ metric: ide, value: formatMinutes(data.medianMinutes), label: 'Median TTFC' })),
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total' }
    ],
    breakdownByTool,
    operationalRead: `${entries.map(([ide, data]) => `${ide}: ${formatMinutes(data.medianMinutes)} median`).join(', ')}.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
    // CR5 WS1.6 P0: Set selectedComparison so the adapter/render layer uses
    // the SAME pair as the title (fastest vs slowest). Without this, the
    // adapter falls back to eligible[0] vs eligible[1] (sorted by value),
    // which for TTFC (lower_is_better) would be fastest vs second-fastest,
    // not fastest vs slowest.
    selectedComparison: { leaderKey: fastestIDE, baselineKey: slowestIDE }
  };

  return baseInsight;
}

/**
 * Generate Rework Rate by Workflow PI
 * 
 * Computes rework rate (lines removed / (lines added + lines removed)) by workflow
 * Uses lines_added_total and lines_removed_total_est from session data
 * 
 * EXECUTIVE QUESTION: Which workflows create the most rework?
 */
export function generateReworkRateByWorkflow(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('rework-rate-by-workflow');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const hasLiveData = totalSessions > 0;

  piDebugLog('[RUNTIME_PROOF][rework-rate-by-workflow]', {
    insightId: 'rework-rate-by-workflow',
    stage: 'plan-code',
    hasLiveData,
    sessionRowsCount: totalSessions,
    sampleSession: sessionRows[0] ? { 
      lines_added: sessionRows[0].lines_added_total, 
      lines_removed: sessionRows[0].lines_removed_total_est,
      tool: sessionRows[0].tool 
    } : null
  });

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_REWORK_RATE][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }

  // Group sessions by workflow — build from sessions only
  const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Calculate rework rate for each workflow
  const reworkRates: Record<string, { rate: number; total: number; validSessions: number; totalAdded: number; totalRemoved: number }> = {};

  for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
    if (sessions.length === 0) continue;

    const validSessions = sessions.filter(s => 
      typeof s.lines_added_total === 'number' && s.lines_added_total > 0 &&
      typeof s.lines_removed_total_est === 'number' && s.lines_removed_total_est >= 0
    );

    if (validSessions.length === 0) continue;

    const totalAdded = validSessions.reduce((sum, s) => sum + s.lines_added_total, 0);
    const totalRemoved = validSessions.reduce((sum, s) => sum + s.lines_removed_total_est, 0);
    const totalLines = totalAdded + totalRemoved;
    const reworkRate = totalLines > 0 ? (totalRemoved / totalLines) * 100 : 0;

    reworkRates[workflow] = {
      rate: reworkRate,
      total: sessions.length,
      validSessions: validSessions.length,
      totalAdded,
      totalRemoved
    };
  }

  // Determine lowest and highest rework rate (lower is better for code quality)
  const entries = Object.entries(reworkRates).filter(([_, data]) => isStressMode || data.validSessions >= 10);
  if (entries.length < 2) {
    piDebugLog('[GENERATOR_REWORK_RATE][INSUFFICIENT_WORKFLOW_DATA]', { entries });
    return null;
  }

  // Sort ascending: lower rework rate (better quality) first
  entries.sort((a, b) => a[1].rate - b[1].rate);
  const [lowestWorkflow, lowestData] = entries[0];
  const [highestWorkflow, highestData] = entries[entries.length - 1];
  const reworkGap = highestData.rate - lowestData.rate;
  const reworkRatio = lowestData.rate > 0 ? highestData.rate / lowestData.rate : 1;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const coveragePct = coveragePct1dp(entries.reduce((sum, [_, data]) => sum + data.validSessions, 0), totalSessions);

  // Executive title based on rework pattern (lower is better) - follow title doctrine (show actual values)
  let executiveTitle: string;
  // Noise-gap guard: for percentage gaps below 5%, use absolute values with noise caveat
  const reworkGapPts = highestData.rate - lowestData.rate;
  if (reworkGapPts < 5) {
    executiveTitle = `${getCanonicalWorkflowIdentity(lowestWorkflow)} rework is ${formatPct(lowestData.rate)} vs ${getCanonicalWorkflowIdentity(highestWorkflow)} ${formatPct(highestData.rate)}; treat as directional`;
  } else if (reworkRatio > 1.5) {
    executiveTitle = `${getCanonicalWorkflowIdentity(lowestWorkflow)} rework is ${formatPct(lowestData.rate)} vs ${getCanonicalWorkflowIdentity(highestWorkflow)} ${formatPct(highestData.rate)}`;
  } else if (highestData.rate > 40) {
    executiveTitle = `Rework rates are elevated across primary workflows (${formatPct(highestData.rate)} average)`;
  } else {
    executiveTitle = `Rework rates are stable across primary workflows (${formatPct(highestData.rate)} average)`;
  }

  // Build breakdownByTool with ALL workflows that have data (not just highest/lowest)
  const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
  for (const [workflow, data] of Object.entries(reworkRates)) {
    if (data.validSessions >= 10 || isStressMode) {
      breakdownByTool[workflow] = {
        value: data.rate,
        count: data.validSessions,
        formatted: `${formatPct(data.rate)} rework`,
        label: `${getCanonicalWorkflowIdentity(workflow)} (${data.validSessions} sessions)`
      };
    }
  }

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'trend',
    current: highestData.rate,
    baseline: lowestData.rate,
    delta: reworkGap,
    deltaPct: lowestData.rate > 0 ? ((highestData.rate - lowestData.rate) / lowestData.rate) * 100 : 0,
    rightMetric: formatPct(highestData.rate) + ' rework',
    rightMetricLabel: 'Rework Rate',
    metricDefinition: 'Percentage of code that is rewritten (lines removed / total lines)',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      ...entries.map(([workflow, data]) => `${getCanonicalWorkflowIdentity(workflow)}: ${formatPct(data.rate)} rework rate (${data.validSessions} valid sessions)`)
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: reworkRatio > 1.5
      ? `${getCanonicalWorkflowIdentity(lowestWorkflow)} generates ${formatPct(lowestData.rate)} rework rate, ${formatDelta(reworkRatio)}x lower than ${getCanonicalWorkflowIdentity(highestWorkflow)} at ${formatPct(highestData.rate)}. High rework indicates revision overhead and lower delivery efficiency.`
      : highestData.rate > 40
      ? `Primary workflows show similarly high rework rates (${entries.map(([w, d]) => `${getCanonicalWorkflowIdentity(w)} ${formatPct(d.rate)}`).join(', ')}). The issue may be process quality, review policy, or prompt/workflow design rather than one isolated IDE.`
      : `Rework rates are stable across primary workflows (${entries.map(([w, d]) => `${getCanonicalWorkflowIdentity(w)} ${formatPct(d.rate)}`).join(', ')}). Monitor for increases that may indicate requirement ambiguity or technical debt accumulation.`,
    whatChanged: reworkRatio > 1.5
      ? `Across historical telemetry, ${getCanonicalWorkflowIdentity(lowestWorkflow)} ${formatPct(lowestData.rate)} vs ${getCanonicalWorkflowIdentity(highestWorkflow)} ${formatPct(highestData.rate)} (${formatDelta(reworkRatio)}x difference).`
      : `Across historical telemetry, ${entries.map(([w, d]) => `${getCanonicalWorkflowIdentity(w)} ${formatPct(d.rate)}`).join(', ')} (similar).`,
    whyItMatters: 'Rework rate measures the share of changed lines that replace recently added lines within a session. Higher rework may indicate unclear requirements, insufficient design review, or testing gaps. This is an observation about revision overhead, not a causal measure of delivery delay or budget waste.',
    recommendation: reworkRatio > 1.5
      ? `${getCanonicalWorkflowIdentity(highestWorkflow)} shows elevated rework rate (${formatPct(highestData.rate)}), indicating unclear requirements, insufficient design review, or testing gaps. Implement requirement sign-off processes, add architecture review gates, or increase test coverage to reduce rework cycles and accelerate delivery.`
      : highestData.rate > 40
      ? `Primary workflows show similarly high rework rates. The issue may be process quality, review policy, or prompt/workflow design rather than one isolated IDE. Compare review comments, reopened PRs, and file churn for all workflows before expanding to more developers.`
      : 'Rework rates are healthy. Monitor for increases that may indicate requirement ambiguity or technical debt accumulation impacting delivery timelines.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. ${entries.map(([workflow, data]) => `${getCanonicalWorkflowIdentity(workflow)}: ${formatPct(data.rate)} average rework rate (${data.totalAdded} lines added, ${data.totalRemoved} lines removed)`).join('. ')}. Coverage: ${coveragePct}%.`,
    operationalImpact: `${reworkRatio > 1.5 ? formatDelta(reworkRatio) + 'x rework difference' : 'Similar rework'} may indicate different development practices or code quality standards.`,
    primaryRisk: 'Higher rework rates may indicate requirements or review-process gaps. Investigate causes before treating the rate as a delivery-speed measure.',
    cohort: 'Code Quality',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% valid line change data across ${entries.length} workflows.`,
    recommendationState: reworkGapPts < 5 ? 'monitor_only' : (reworkRatio > 1.5 ? 'action_required' : 'monitor_only'),
    urgencyLabel: reworkGapPts < 5 ? 'monitor' : (reworkRatio > 1.5 ? 'investigate' : 'monitor'),
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      ...entries.map(([workflow, data]) => ({ metric: getCanonicalWorkflowIdentity(workflow), value: formatPct(data.rate), label: 'Rework rate' })),
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total' }
    ],
    breakdownByTool,
    operationalRead: `${entries.map(([workflow, data]) => `${getCanonicalWorkflowIdentity(workflow)}: ${formatPct(data.rate)} rework`).join(', ')}.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live'
  };

  return baseInsight;
}

/**
 * Generate Active Coding Ratio by Workflow PI
 * 
 * Computes active coding ratio (active coding time / total session time) by workflow
 * Uses session_active_coding_duration_minutes and session_duration_minutes from session data
 * 
 * EXECUTIVE QUESTION: How much time is wasted on context switching?
 */
export function generateActiveCodingRatioByWorkflow(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('active-coding-ratio-by-workflow');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const hasLiveData = totalSessions > 0;

  piDebugLog('[RUNTIME_PROOF][active-coding-ratio-by-workflow]', {
    insightId: 'active-coding-ratio-by-workflow',
    stage: 'plan-code',
    hasLiveData,
    sessionRowsCount: totalSessions,
    sampleSession: sessionRows[0] ? { 
      active_coding: sessionRows[0].session_active_coding_duration_minutes, 
      duration: sessionRows[0].session_duration_minutes,
      tool: sessionRows[0].tool 
    } : null
  });

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_ACTIVE_CODING_RATIO][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }

  // Group sessions by workflow — build from sessions only
  const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Calculate active coding ratio for each workflow
  const activeCodingRatios: Record<string, { ratio: number; total: number; validSessions: number; totalActiveMinutes: number; totalDurationMinutes: number }> = {};

  for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
    if (sessions.length === 0) continue;

    const validSessions = sessions.filter(s => 
      typeof s.session_active_coding_duration_minutes === 'number' && s.session_active_coding_duration_minutes > 0 &&
      typeof s.session_duration_minutes === 'number' && s.session_duration_minutes > 0
    );

    if (validSessions.length === 0) continue;

    const totalActiveMinutes = validSessions.reduce((sum, s) => sum + s.session_active_coding_duration_minutes, 0);
    const totalDurationMinutes = validSessions.reduce((sum, s) => sum + s.session_duration_minutes, 0);
    const activeCodingRatio = totalDurationMinutes > 0 ? (totalActiveMinutes / totalDurationMinutes) * 100 : 0;

    activeCodingRatios[workflow] = {
      ratio: activeCodingRatio,
      total: sessions.length,
      validSessions: validSessions.length,
      totalActiveMinutes,
      totalDurationMinutes
    };
  }

  // Determine highest and lowest active coding ratio
  const entries = Object.entries(activeCodingRatios).filter(([_, data]) => isStressMode || data.validSessions >= 10);
  if (entries.length < 2) {
    piDebugLog('[GENERATOR_ACTIVE_CODING_RATIO][INSUFFICIENT_WORKFLOW_DATA]', { entries });
    return null;
  }

  entries.sort((a, b) => b[1].ratio - a[1].ratio);
  const [highestWorkflow, highestData] = entries[0];
  const [lowestWorkflow, lowestData] = entries[entries.length - 1];
  const ratioGap = highestData.ratio - lowestData.ratio;
  const ratioImprovement = lowestData.ratio > 0 ? ((highestData.ratio - lowestData.ratio) / lowestData.ratio) * 100 : 0;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const coveragePct = coveragePct1dp(entries.reduce((sum, [_, data]) => sum + data.validSessions, 0), totalSessions);

  // Executive title based on active coding ratio pattern - follow title doctrine (show actual rates)
  let executiveTitle: string;
  if (ratioGap > 20) {
    executiveTitle = `${getCanonicalWorkflowIdentity(highestWorkflow)} coding ratio is ${formatPct(highestData.ratio)} vs ${getCanonicalWorkflowIdentity(lowestWorkflow)} ${formatPct(lowestData.ratio)}`;
  } else if (highestData.ratio < 50) {
    executiveTitle = 'Active coding ratio is low across primary workflows';
  } else {
    executiveTitle = 'Active coding ratio varies across primary workflows';
  }

  // Build breakdownByTool with ALL workflows that have data
  const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
  for (const [workflow, data] of Object.entries(activeCodingRatios)) {
    if (data.validSessions >= 10 || isStressMode) {
      breakdownByTool[workflow] = {
        value: data.ratio,
        count: data.validSessions,
        formatted: `${formatPct(data.ratio)} active`,
        label: `${getCanonicalWorkflowIdentity(workflow)} (${data.validSessions} sessions)`
      };
    }
  }

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'trend',
    current: highestData.ratio,
    baseline: lowestData.ratio,
    delta: ratioGap,
    deltaPct: ratioImprovement,
    rightMetric: formatPct(highestData.ratio) + ' active',
    rightMetricLabel: 'Active Coding Ratio',
    metricDefinition: 'Percentage of session time spent actively coding (vs idle or context switching)',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      ...entries.map(([workflow, data]) => `${getCanonicalWorkflowIdentity(workflow)}: ${formatPct(data.ratio)} active coding ratio (${data.validSessions} valid sessions)`)
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: ratioGap > 20
      ? `${getCanonicalWorkflowIdentity(highestWorkflow)} developers spend ${formatPct(highestData.ratio)} of session time actively coding, ${formatDelta(ratioImprovement)} more than ${getCanonicalWorkflowIdentity(lowestWorkflow)} at ${formatPct(lowestData.ratio)}. Lower active coding ratios indicate workflow friction or interruptions.`
      : `Active coding ratio varies across workflows: ${entries.map(([w, d]) => `${getCanonicalWorkflowIdentity(w)} ${formatPct(d.ratio)}`).join(', ')}.`,
    whatChanged: ratioGap > 20
      ? `Active coding ratio variance: ${getCanonicalWorkflowIdentity(highestWorkflow)} ${formatPct(highestData.ratio)} vs ${getCanonicalWorkflowIdentity(lowestWorkflow)} ${formatPct(lowestData.ratio)} (${formatDelta(ratioImprovement)} difference).`
      : `Active coding ratio across workflows: ${entries.map(([w, d]) => `${getCanonicalWorkflowIdentity(w)} ${formatPct(d.ratio)}`).join(', ')}.`,
    whyItMatters: 'Low active coding ratios may indicate context switching, environment friction, or interruptions reducing focused coding time.',
    recommendation: ratioImprovement > 30
      ? `${getCanonicalWorkflowIdentity(lowestWorkflow)} active coding ratio is ${formatPct(lowestData.ratio)} vs ${getCanonicalWorkflowIdentity(highestWorkflow)} ${formatPct(highestData.ratio)}, indicating workflow friction. Review notification policies, reduce meeting fragmentation, or optimize environment configuration for this workflow before expanding to more teams.`
      : highestData.ratio < 50
      ? 'Active coding ratios are low across workflows. Review notification policies, reduce meeting fragmentation, or optimize environment configuration to increase focused coding time.'
      : 'Active coding ratios are healthy. Monitor for decreases that may indicate increased meeting load or environment friction.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. ${entries.map(([workflow, data]) => `${getCanonicalWorkflowIdentity(workflow)}: ${formatPct(data.ratio)} average active coding ratio (${data.totalActiveMinutes.toFixed(0)} active / ${data.totalDurationMinutes.toFixed(0)} total minutes)`).join('. ')}. Coverage: ${coveragePct}%.`,
    operationalImpact: `${ratioImprovement > 30 ? formatDelta(ratioImprovement) + ' active coding difference' : 'Similar active coding'} may indicate different workflow patterns or interruption levels.`,
    primaryRisk: 'Low active coding ratios correlate with context switching, which reduces effective engineering time.',
    cohort: 'Workflow Activity',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% valid active coding data across ${entries.length} workflows.`,
    recommendationState: ratioImprovement > 30 ? 'action_required' : 'monitor_only',
    urgencyLabel: ratioImprovement > 30 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      ...entries.map(([workflow, data]) => ({ metric: getCanonicalWorkflowIdentity(workflow), value: formatPct(data.ratio), label: 'Active coding ratio' })),
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total' }
    ],
    breakdownByTool,
    operationalRead: `${entries.map(([workflow, data]) => `${getCanonicalWorkflowIdentity(workflow)}: ${formatPct(data.ratio)} active`).join(', ')}.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live'
  };

  return baseInsight;
}

/**
 * Generate rework loop detection PI
 * 
 * Identifies individual developers trapped in rework cycles by analyzing session-level rework ratios.
 * Uses session_rework_ratio_est, rework_band, session_quality_score, and user_id.
 * Correlates with GitHub reopen_pressure_spike and pr_review_cycles.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateReworkLoopDetection(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('rework-loop-detection');
  if (!registryEntry) {
    piDebugLog('[GENERATOR_REWORK_LOOP_DETECTION][NO_REGISTRY]', 'Registry entry not found');
    return null;
  }

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};

  piDebugLog('[GENERATOR_REWORK_LOOP_DETECTION][START]', 'Generating rework-loop-detection');
  piDebugLog('[RUNTIME_PROOF][rework-loop-detection]', {
    insightId: 'rework-loop-detection',
    stage: 'plan-code',
    totalSessions,
    sampleSession: sessionRows[0] ? {
      rework_ratio: sessionRows[0].session_rework_ratio_est,
      rework_band: sessionRows[0].rework_band,
      quality_score: sessionRows[0].session_quality_score,
      user_id: sessionRows[0].user_id
    } : null
  });

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_REWORK_LOOP_DETECTION][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }

  // Group sessions by user_id to identify individual developer patterns
  const sessionsByUser: Record<string, any[]> = {};
  for (const session of sessionRows) {
    const userId = session.user_id ?? session.developer_id;
    if (userId && typeof session.session_rework_ratio_est === 'number') {
      if (!sessionsByUser[userId]) {
        sessionsByUser[userId] = [];
      }
      sessionsByUser[userId].push(session);
    }
  }

  // Calculate average rework ratio per user
  const userReworkStats: Record<string, { avgReworkRatio: number; sessionCount: number; avgQualityScore: number; tool: string }> = {};
  for (const [userId, sessions] of Object.entries(sessionsByUser)) {
    if (sessions.length < 5) continue; // Need at least 5 sessions per user

    // session_quality_score may not exist in all telemetry regimes;
    // use rework_ratio_est alone when quality score is unavailable
    const validSessions = sessions.filter(s => typeof s.session_rework_ratio_est === 'number');
    if (validSessions.length < 5) continue;

    const avgReworkRatio = validSessions.reduce((sum, s) => sum + s.session_rework_ratio_est, 0) / validSessions.length;
    const qualitySessions = validSessions.filter(s => typeof s.session_quality_score === 'number');
    const avgQualityScore = qualitySessions.length > 0
      ? qualitySessions.reduce((sum, s) => sum + s.session_quality_score, 0) / qualitySessions.length
      : 0;
    const tool = validSessions[0].tool || 'unknown';

    userReworkStats[userId] = {
      avgReworkRatio,
      sessionCount: validSessions.length,
      avgQualityScore,
      tool
    };
  }

  // Identify users with high rework ratios (> 40% or 2x team average)
  const entries = Object.entries(userReworkStats);
  if (entries.length < 2) {
    piDebugLog('[GENERATOR_REWORK_LOOP_DETECTION][INSUFFICIENT_USER_DATA]', { entries });
    return null;
  }

  const teamAvgReworkRatio = entries.reduce((sum, [_, stats]) => sum + stats.avgReworkRatio, 0) / entries.length;
  const highReworkUsers = entries.filter(([_, stats]) => stats.avgReworkRatio > Math.max(0.4, teamAvgReworkRatio * 2));

  if (highReworkUsers.length === 0) {
    piDebugLog('[GENERATOR_REWORK_LOOP_DETECTION][NO_HIGH_REWORK_USERS]', { teamAvgReworkRatio });
    return null;
  }

  // Sort by rework ratio (highest first)
  highReworkUsers.sort((a, b) => b[1].avgReworkRatio - a[1].avgReworkRatio);
  const [highestUserId, highestStats] = highReworkUsers[0];

  // Get GitHub reopen rate for correlation
  const reopenRate = githubSnapshot.reopen_pressure_spike || 0;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const coveragePct = coveragePct1dp(entries.reduce((sum, [_, stats]) => sum + stats.sessionCount, 0), totalSessions);

  const reworkRatioVsTeam = teamAvgReworkRatio > 0 ? (highestStats.avgReworkRatio / teamAvgReworkRatio) : 1;

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: registryEntry.title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'trend',
    current: highestStats.avgReworkRatio,
    baseline: teamAvgReworkRatio,
    delta: highestStats.avgReworkRatio - teamAvgReworkRatio,
    deltaPct: teamAvgReworkRatio > 0 ? ((highestStats.avgReworkRatio - teamAvgReworkRatio) / teamAvgReworkRatio) * 100 : 0,
    rightMetric: formatPct(highestStats.avgReworkRatio) + ' rework',
    rightMetricLabel: 'Rework Ratio',
    metricDefinition: 'Percentage of code rewritten (lines removed / total lines) at individual developer level',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed across ${entries.length} developers`,
      `Developer ${highestUserId}: ${formatPct(highestStats.avgReworkRatio)} rework ratio (${highestStats.sessionCount} sessions)`,
      `Team average: ${formatPct(teamAvgReworkRatio)} rework ratio`,
      `Quality score: ${highestStats.avgQualityScore.toFixed(0)}/100`
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: `Developer ${highestUserId} shows ${formatPct(highestStats.avgReworkRatio)} rework ratio, ${reworkRatioVsTeam > 2 ? formatDelta(reworkRatioVsTeam * 100) + ' higher' : 'elevated vs'} team average of ${formatPct(teamAvgReworkRatio)}. This may indicate rework loops requiring targeted coaching.`,
    whatChanged: `Individual rework ratio variance: Developer ${highestUserId} ${formatPct(highestStats.avgReworkRatio)} vs team average ${formatPct(teamAvgReworkRatio)} (${reworkRatioVsTeam > 2 ? formatDelta(reworkRatioVsTeam * 100) + ' difference' : 'elevated'}).`,
    whyItMatters: 'High individual rework ratios may indicate developers stuck in rework cycles, which is associated with reduced delivery throughput.',
    recommendation: reworkRatioVsTeam > 2
      ? `Developer ${highestUserId} shows ${formatPct(highestStats.avgReworkRatio)} rework ratio (${highestStats.tool}). Provide targeted coaching on code planning, test-driven development, or design review.`
      : 'Monitor developers with elevated rework ratios for patterns and provide proactive guidance.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions across ${entries.length} developers. Developer ${highestUserId}: ${formatPct(highestStats.avgReworkRatio)} average rework ratio (${highestStats.sessionCount} sessions, quality score ${highestStats.avgQualityScore.toFixed(0)}/100). Team average: ${formatPct(teamAvgReworkRatio)}. Coverage: ${coveragePct}%. GitHub reopen rate: ${formatPct(reopenRate)}.`,
    operationalImpact: `${reworkRatioVsTeam > 2 ? formatDelta(reworkRatioVsTeam * 100) + ' rework difference' : 'Elevated rework'} may indicate individual developer patterns requiring coaching intervention.`,
    primaryRisk: 'High individual rework ratios correlate with lower productivity and higher PR reopen rates.',
    cohort: 'Individual Developer',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% valid rework data across ${entries.length} developers.`,
    recommendationState: reworkRatioVsTeam > 2 ? 'action_required' : 'monitor_only',
    urgencyLabel: reworkRatioVsTeam > 2 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: `Developer ${highestUserId}`, value: formatPct(highestStats.avgReworkRatio), label: 'Rework ratio' },
      { metric: 'Team average', value: formatPct(teamAvgReworkRatio), label: 'Rework ratio' },
      { metric: 'Quality score', value: highestStats.avgQualityScore.toFixed(0), label: 'Session quality' },
      { metric: 'Sessions', value: highestStats.sessionCount.toString(), label: 'Analyzed' }
    ],
    breakdownByTool: {
      [highestStats.tool]: { value: highestStats.avgReworkRatio, count: highestStats.sessionCount, formatted: `${formatPct(highestStats.avgReworkRatio)} rework`, label: `${highestStats.tool} (${highestStats.sessionCount} sessions)` }
    },
    operationalRead: `Developer ${highestUserId}: ${formatPct(highestStats.avgReworkRatio)} rework ratio vs team average ${formatPct(teamAvgReworkRatio)} (${reworkRatioVsTeam > 2 ? formatDelta(reworkRatioVsTeam * 100) + ' difference' : 'elevated'}).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live'
  };

  return baseInsight;
}

/**
 * Generate workflow quality correlation PI
 * 
 * Correlates session quality scores with GitHub outcomes (change_failure_rate, reopen_pressure_spike, pr_review_cycles).
 * Uses session_quality_score, session_quality_band, flow_profile, and tool.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateWorkflowQualityCorrelation(input: CanonicalInsightInput): CanonicalInsight | null {
  // CR5 WS2 #14 P0-4c: CONSOLIDATED into session-quality-merge-success.
  // Both require GitHub delivery outcomes. Return null — the consolidated
  // diagnostic in generateSessionQualityMergeSuccess covers both.
  return null;
}

// --- workflow-quality-correlation body removed (consolidated into session-quality-merge-success) ---

/* eslint-disable */
/*
  const registryEntry = getCanonicalPIById('workflow-quality-correlation');
  if (!registryEntry) {
    piDebugLog('[GENERATOR_WORKFLOW_QUALITY_CORRELATION][NO_REGISTRY]', 'Registry entry not found');
    return null;
  }

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};

  piDebugLog('[GENERATOR_WORKFLOW_QUALITY_CORRELATION][START]', 'Generating workflow-quality-correlation');
  piDebugLog('[RUNTIME_PROOF][workflow-quality-correlation]', {
    insightId: 'workflow-quality-correlation',
    stage: 'plan-code',
    totalSessions,
    sampleSession: sessionRows[0] ? {
      quality_score: sessionRows[0].session_quality_score,
      quality_band: sessionRows[0].session_quality_band,
      flow_profile: sessionRows[0].flow_profile,
      tool: sessionRows[0].tool
    } : null
  });

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_WORKFLOW_QUALITY_CORRELATION][INSUFFICIENT_DATA]', { totalSessions });
    // Return canonical insight with neutral description instead of null
    return {
      id: registryEntry.id,
      title: registryEntry.title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      comparisonMode: 'trend',
      current: 0,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      rightMetric: '—',
      rightMetricLabel: 'Session Quality Score',
      metricDefinition: 'Session quality score (0-100) correlated with GitHub delivery outcomes',
      operationalBreadcrumbs: [
        `${totalSessions} sessions analyzed`,
        'Insufficient data for workflow comparison'
      ],
      confidence: 'low',
      coveragePct: 0,
      n: totalSessions,
      hasData: false,
      description: 'Session quality analysis needs complete workflow attribution.',
      whatChanged: 'Insufficient data for workflow comparison.',
      whyItMatters: 'Session quality scores correlate with lower change failure rates and faster PR cycle times.',
      recommendation: 'Monitor this metric and investigate if the pattern persists over multiple periods.',
      evidenceAndContext: `Analysis of ${totalSessions} development sessions. Insufficient data for workflow ranking.`,
      operationalImpact: 'Session quality analysis needs complete workflow attribution.',
      primaryRisk: 'Low session quality scores correlate with higher change failure rates and longer review cycles.',
      cohort: 'Workflow Quality',
      confidenceReasoning: `Low confidence based on ${totalSessions} sessions (minimum 30 required for workflow comparison).`,
      recommendationState: 'monitor_only',
      urgencyLabel: 'monitor',
      engineVersion: 'FINAL_ENGINE_V1',
      generatorSource: 'final/generators/planCode.ts',
      featureFlagState: true,
      evidence: [],
      breakdownByTool: undefined,
      comparisonState: 'needs_more_data'
    };
  }

  // Group sessions by workflow — build from sessions only
  const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Calculate average quality score per workflow
  const workflowQualityStats: Record<string, { avgQualityScore: number; sessionCount: number; highQualityCount: number; lowQualityCount: number }> = {};

  for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
    if (sessions.length === 0) continue;

    const validSessions = sessions.filter(s => typeof s.session_quality_score === 'number' && Number.isFinite(s.session_quality_score));
    if (validSessions.length === 0) continue;

    const avgQualityScore = validSessions.reduce((sum, s) => sum + s.session_quality_score, 0) / validSessions.length;
    const highQualityCount = validSessions.filter(s => s.session_quality_score >= 80).length;
    const lowQualityCount = validSessions.filter(s => s.session_quality_score < 60).length;

    workflowQualityStats[workflow] = {
      avgQualityScore,
      sessionCount: validSessions.length,
      highQualityCount,
      lowQualityCount
    };
  }

  // Determine highest and lowest quality workflows
  // ELIGIBILITY CONTRACT: a workflow only qualifies for a numeric
  // session-quality comparison when it has at least 5 eligible quality values
  // (typeof session_quality_score === 'number' && Number.isFinite(...)).
  const MIN_ELIGIBLE_QUALITY_SAMPLES = 5;
  const entries = Object.entries(workflowQualityStats).filter(([_, data]) => isStressMode || data.sessionCount >= MIN_ELIGIBLE_QUALITY_SAMPLES);
  if (entries.length < 2) {
    piDebugLog('[GENERATOR_WORKFLOW_QUALITY_CORRELATION][INSUFFICIENT_WORKFLOW_DATA]', { entries });
    // Do not emit a numeric workflow quality comparison and do not display 0/100.
    // Return the existing needs-more-data diagnostic form.
    return {
      id: registryEntry.id,
      title: registryEntry.title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      comparisonMode: 'trend',
      current: 0,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      rightMetric: '—',
      rightMetricLabel: 'Session Quality Score',
      metricDefinition: 'Session quality score (0-100) correlated with GitHub delivery outcomes',
      operationalBreadcrumbs: [
        `${totalSessions} sessions analyzed`,
        'Insufficient eligible session-quality samples for workflow comparison'
      ],
      confidence: 'low',
      coveragePct: 0,
      n: totalSessions,
      hasData: false,
      description: 'Session quality analysis needs complete workflow attribution.',
      whatChanged: 'Insufficient data for workflow comparison.',
      whyItMatters: 'Session quality scores correlate with lower change failure rates and faster PR cycle times.',
      recommendation: 'Monitor this metric and investigate if the pattern persists over multiple periods.',
      evidenceAndContext: `Analysis of ${totalSessions} development sessions. Insufficient eligible quality-score data for workflow ranking.`,
      operationalImpact: 'Session quality analysis needs complete workflow attribution.',
      primaryRisk: 'Low session quality scores correlate with higher change failure rates and longer review cycles.',
      cohort: 'Workflow Quality',
      confidenceReasoning: `Low confidence: fewer than ${MIN_ELIGIBLE_QUALITY_SAMPLES} eligible session-quality values in at least one compared workflow.`,
      recommendationState: 'monitor_only',
      urgencyLabel: 'monitor',
      engineVersion: 'FINAL_ENGINE_V1',
      generatorSource: 'final/generators/planCode.ts',
      featureFlagState: true,
      evidence: [],
      breakdownByTool: undefined,
      comparisonState: 'needs_more_data'
    };
  }

  entries.sort((a, b) => b[1].avgQualityScore - a[1].avgQualityScore);
  const [highestWorkflow, highestData] = entries[0];
  const [lowestWorkflow, lowestData] = entries[entries.length - 1];
  const qualityGap = highestData.avgQualityScore - lowestData.avgQualityScore;

  // Get GitHub outcomes for correlation
  const changeFailureRate = githubSnapshot.change_failure_rate || 0;
  const reopenRate = githubSnapshot.reopen_pressure_spike || 0;
  const reviewCycleTime = githubSnapshot.pr_review_cycles || 0;

  // CR5 WS1.7 P0: This PI claims to CORRELATE session quality with GitHub
  // delivery outcomes. Without GitHub outcomes (change_failure_rate,
  // reopen_rate, review_cycle_time all zero/unavailable), the PI cannot
  // assert a numeric quality comparison — it would present a derived
  // session_quality_score as if it were a measured outcome correlation.
  // Return needs_more_data diagnostic instead of a numeric 99/100 vs 89/100.
  const hasGitHubOutcomes = changeFailureRate > 0 || reopenRate > 0 || reviewCycleTime > 0;
  if (!hasGitHubOutcomes && !isStressMode) {
    piDebugLog('[GENERATOR_WORKFLOW_QUALITY_CORRELATION][NO_GITHUB_OUTCOMES]', {
      changeFailureRate, reopenRate, reviewCycleTime
    });
    return {
      id: registryEntry.id,
      title: 'Workflow quality correlation needs GitHub delivery outcomes',
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      comparisonMode: 'trend',
      current: 0,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      rightMetric: '—',
      rightMetricLabel: 'Session Quality Score',
      metricDefinition: 'Session quality score (0-100) correlated with GitHub delivery outcomes — requires GitHub PR/review/deploy evidence',
      operationalBreadcrumbs: [
        `${totalSessions} sessions analyzed`,
        'GitHub delivery outcomes unavailable — cannot correlate quality with outcomes'
      ],
      confidence: 'low',
      coveragePct: 0,
      n: totalSessions,
      hasData: false,
      isDiagnostic: true,
      diagnosticReason: 'WAITING_FOR_GITHUB',
      diagnosticUnlockPath: 'Requires GitHub connection to access PR, review, and deployment data for quality-outcome correlation',
      description: 'Session quality scores are available, but GitHub delivery outcomes (change failure rate, reopen rate, review cycle time) are not. Without outcome data, a numeric quality comparison would assert a correlation that cannot be measured.',
      whatChanged: 'GitHub delivery outcomes unavailable for quality correlation.',
      whyItMatters: 'Session quality scores are a derived signal, not a measured outcome. Correlating them with GitHub delivery outcomes requires actual PR/review/deploy evidence.',
      recommendation: 'Connect GitHub to enable quality-outcome correlation analysis.',
      evidenceAndContext: `Analysis of ${totalSessions} development sessions. Session quality scores available for ${entries.length} workflows, but GitHub delivery outcomes are zero/unavailable.`,
      operationalImpact: 'Quality-outcome correlation unavailable without GitHub evidence.',
      primaryRisk: 'Presenting a derived quality score as a measured outcome correlation would be misleading.',
      cohort: 'Workflow Quality',
      confidenceReasoning: 'Low confidence: GitHub delivery outcomes unavailable for quality correlation.',
      recommendationState: 'monitor_only',
      urgencyLabel: 'monitor',
      engineVersion: 'FINAL_ENGINE_V1',
      generatorSource: 'final/generators/planCode.ts',
      featureFlagState: true,
      evidence: [],
      breakdownByTool: undefined,
      comparisonState: 'needs_more_data'
    };
  }

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const coveragePct = coveragePct1dp(entries.reduce((sum, [_, data]) => sum + data.sessionCount, 0), totalSessions);

  // Executive title based on quality score pattern - follow title doctrine (show actual values)
  const executiveTitle = `${getCanonicalWorkflowIdentity(highestWorkflow)} has ${highestData.avgQualityScore.toFixed(0)}/100 session quality vs ${getCanonicalWorkflowIdentity(lowestWorkflow)} ${lowestData.avgQualityScore.toFixed(0)}/100`;

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'trend',
    current: highestData.avgQualityScore,
    baseline: lowestData.avgQualityScore,
    delta: qualityGap,
    deltaPct: lowestData.avgQualityScore > 0 ? ((highestData.avgQualityScore - lowestData.avgQualityScore) / lowestData.avgQualityScore) * 100 : 0,
    rightMetric: highestData.avgQualityScore.toFixed(0) + '/100 quality',
    rightMetricLabel: 'Session Quality Score',
    metricDefinition: 'Session quality score (0-100) correlated with GitHub delivery outcomes',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      `${getCanonicalWorkflowIdentity(highestWorkflow)}: ${highestData.avgQualityScore.toFixed(0)}/100 quality (${highestData.sessionCount} sessions, ${highestData.highQualityCount} high-quality)`,
      `${getCanonicalWorkflowIdentity(lowestWorkflow)}: ${lowestData.avgQualityScore.toFixed(0)}/100 quality (${lowestData.sessionCount} sessions, ${lowestData.lowQualityCount} low-quality)`,
      `GitHub outcomes: ${formatPct(changeFailureRate)} failure rate, ${formatPct(reopenRate)} reopen rate`
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: `${getCanonicalWorkflowIdentity(highestWorkflow)} workflows achieve ${highestData.avgQualityScore.toFixed(0)}/100 session quality score, ${qualityGap > 15 ? formatDelta(qualityGap) + ' higher' : 'similar to'} ${getCanonicalWorkflowIdentity(lowestWorkflow)} at ${lowestData.avgQualityScore.toFixed(0)}/100. Higher quality sessions correlate with better GitHub outcomes.`,
    whatChanged: `Session quality variance: ${getCanonicalWorkflowIdentity(highestWorkflow)} ${highestData.avgQualityScore.toFixed(0)}/100 vs ${getCanonicalWorkflowIdentity(lowestWorkflow)} ${lowestData.avgQualityScore.toFixed(0)}/100 (${qualityGap > 15 ? formatDelta(qualityGap) + ' difference' : 'similar'}).`,
    whyItMatters: 'High session quality scores correlate with lower change failure rates and faster PR cycle times, indicating better engineering practices.',
    recommendation: qualityGap > 15
      ? `${getCanonicalWorkflowIdentity(lowestWorkflow)} session quality is ${lowestData.avgQualityScore.toFixed(0)}/100 vs ${getCanonicalWorkflowIdentity(highestWorkflow)} ${highestData.avgQualityScore.toFixed(0)}/100. Investigate workflow patterns, AI tool configuration, or code review practices.`
      : 'Session quality scores are consistent across workflows. Monitor for decreases that may indicate process degradation.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. ${getCanonicalWorkflowIdentity(highestWorkflow)}: ${highestData.avgQualityScore.toFixed(0)}/100 average quality (${highestData.highQualityCount} high-quality, ${lowestData.lowQualityCount} low-quality). ${getCanonicalWorkflowIdentity(lowestWorkflow)}: ${lowestData.avgQualityScore.toFixed(0)}/100 average quality (${lowestData.highQualityCount} high-quality, ${lowestData.lowQualityCount} low-quality). GitHub outcomes: ${formatPct(changeFailureRate)} failure rate, ${formatPct(reopenRate)} reopen rate, ${reviewCycleTime.toFixed(1)} day review cycle. Coverage: ${coveragePct}%.`,
    operationalImpact: `${qualityGap > 15 ? formatDelta(qualityGap) + ' quality difference' : 'Similar quality'} may indicate different workflow effectiveness and engineering practices.`,
    primaryRisk: 'Low session quality scores correlate with higher change failure rates and longer review cycles.',
    cohort: 'Workflow Quality',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% valid quality data across ${entries.length} workflows.`,
    recommendationState: qualityGap > 15 ? 'action_required' : 'monitor_only',
    urgencyLabel: qualityGap > 15 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: getCanonicalWorkflowIdentity(highestWorkflow), value: highestData.avgQualityScore.toFixed(0) + '/100', label: 'Quality score' },
      { metric: getCanonicalWorkflowIdentity(lowestWorkflow), value: lowestData.avgQualityScore.toFixed(0) + '/100', label: 'Quality score' },
      { metric: 'Quality Gap', value: qualityGap.toFixed(0), label: 'Score difference' },
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total' }
    ],
    breakdownByTool: {
      [highestWorkflow]: { value: highestData.avgQualityScore, count: highestData.sessionCount, formatted: `${highestData.avgQualityScore.toFixed(0)}/100 quality`, label: `${getCanonicalWorkflowIdentity(highestWorkflow)} (${highestData.sessionCount} sessions)` },
      [lowestWorkflow]: { value: lowestData.avgQualityScore, count: lowestData.sessionCount, formatted: `${lowestData.avgQualityScore.toFixed(0)}/100 quality`, label: `${getCanonicalWorkflowIdentity(lowestWorkflow)} (${lowestData.sessionCount} sessions)` }
    },
    operationalRead: `${getCanonicalWorkflowIdentity(highestWorkflow)}: ${highestData.avgQualityScore.toFixed(0)}/100 quality vs ${getCanonicalWorkflowIdentity(lowestWorkflow)}: ${lowestData.avgQualityScore.toFixed(0)}/100 quality (${qualityGap > 15 ? formatDelta(qualityGap) + ' difference' : 'similar'}).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live'
  };

  return baseInsight;
}
*/
/* eslint-enable */

/**
 * Generate session quality to merge success PI
 * 
 * Correlates session quality patterns with merge success (pr_review_cycles, reopen_pressure_spike, large_pr_mix_risk).
 * Uses session_quality_score, session_quality_band, session_quality_factors, and tool.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateSessionQualityMergeSuccess(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('session-quality-merge-success');
  if (!registryEntry) {
    piDebugLog('[GENERATOR_SESSION_QUALITY_MERGE_SUCCESS][NO_REGISTRY]', 'Registry entry not found');
    return null;
  }

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};

  piDebugLog('[GENERATOR_SESSION_QUALITY_MERGE_SUCCESS][START]', 'Generating session-quality-merge-success');
  piDebugLog('[RUNTIME_PROOF][session-quality-merge-success]', {
    insightId: 'session-quality-merge-success',
    stage: 'plan-code',
    totalSessions,
    sampleSession: sessionRows[0] ? {
      quality_score: sessionRows[0].session_quality_score,
      quality_band: sessionRows[0].session_quality_band,
      quality_factors: sessionRows[0].session_quality_factors,
      tool: sessionRows[0].tool
    } : null
  });

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_SESSION_QUALITY_MERGE_SUCCESS][INSUFFICIENT_DATA]', { totalSessions });
    return {
      id: registryEntry.id,
      title: 'GitHub delivery outcomes needed to correlate quality with workflow outcomes',
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      comparisonMode: 'trend',
      current: 0,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      rightMetric: '—',
      rightMetricLabel: 'High-Quality Sessions',
      metricDefinition: 'Percentage of sessions with quality score >= 80 correlated with merge success',
      operationalBreadcrumbs: [
        `${totalSessions} sessions analyzed`,
        'Insufficient data for merge-success correlation (minimum 30 sessions required)'
      ],
      confidence: 'low',
      coveragePct: 0,
      n: totalSessions,
      hasData: false,
      isDiagnostic: true,
      diagnosticReason: 'WAITING_FOR_GITHUB_DELIVERY_OUTCOMES',
      description: 'Linking session quality to GitHub merge outcomes (change failure rate, reopen rate) is required to correlate workflow quality with delivery effectiveness. Current session quality is a derived heuristic and cannot independently predict merge success.',
      whatChanged: 'Insufficient data for quality-vs-merge correlation.',
      whyItMatters: 'High-quality sessions correlate with faster PR cycle times and lower reopen rates, but this requires GitHub delivery outcome data.',
      recommendation: 'Connect GitHub to enable session-quality-to-merge-outcome correlation and workflow effectiveness analysis.',
      evidenceAndContext: `Analysis of ${totalSessions} development sessions. Insufficient data for merge-success correlation (minimum 30 required).`,
      operationalImpact: 'Session quality correlation unavailable until GitHub delivery outcomes are linked.',
      primaryRisk: 'Low session quality scores correlate with higher change failure rates and longer review cycles.',
      cohort: 'Session Quality',
      confidenceReasoning: `Low confidence based on ${totalSessions} sessions (minimum 30 required).`,
      recommendationState: 'monitor_only',
      urgencyLabel: 'monitor',
      engineVersion: 'FINAL_ENGINE_V1',
      generatorSource: 'final/generators/planCode.ts',
      featureFlagState: true,
      evidence: [],
      breakdownByTool: undefined,
      comparisonState: 'needs_more_data'
    };
  }

  // QUALITY COHORT SOURCE OF TRUTH: derive cohort membership from
  // session_quality_score (finite number), NOT from session_quality_band.
  // High-quality: score >= 80. Low-quality: score < 60.
  // Medium (60-79) are eligible measured scores but not in either compared cohort.
  const eligibleQualitySessions = sessionRows.filter(s => typeof s.session_quality_score === 'number' && Number.isFinite(s.session_quality_score));
  const highQualitySessions = eligibleQualitySessions.filter(s => s.session_quality_score >= 80);
  const lowQualitySessions = eligibleQualitySessions.filter(s => s.session_quality_score < 60);

  // ELIGIBILITY CONTRACT: a session-quality value is eligible only when
  // typeof session_quality_score === 'number' && Number.isFinite(...).
  // Missing or null is unavailable and must not be coerced to zero.
  const MIN_ELIGIBLE_QUALITY_SAMPLES = 5;
  if (!isStressMode && eligibleQualitySessions.length < MIN_ELIGIBLE_QUALITY_SAMPLES) {
    piDebugLog('[GENERATOR_SESSION_QUALITY_MERGE_SUCCESS][INSUFFICIENT_ELIGIBLE_SAMPLES]', { eligibleCount: eligibleQualitySessions.length });
    // Do not emit a numeric quality comparison and do not display 0/100.
    return {
      id: registryEntry.id,
      title: registryEntry.title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      comparisonMode: 'trend',
      current: 0,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      rightMetric: '—',
      rightMetricLabel: 'High-Quality Sessions',
      metricDefinition: 'Percentage of sessions with quality score >= 80 correlated with merge success',
      operationalBreadcrumbs: [
        `${totalSessions} sessions analyzed`,
        'Insufficient eligible session-quality samples for merge-success correlation'
      ],
      confidence: 'low',
      coveragePct: 0,
      n: totalSessions,
      hasData: false,
      isDiagnostic: true,
      diagnosticReason: 'WAITING_FOR_GITHUB_DELIVERY_OUTCOMES',
      description: 'Session quality is not yet measured for enough sessions to correlate with merge success.',
      whatChanged: 'Insufficient eligible session-quality data for merge-success correlation.',
      whyItMatters: 'High-quality sessions correlate with faster PR cycle times and lower reopen rates, but requires a minimum eligible sample size.',
      recommendation: 'Continue collecting telemetry. This insight will populate once at least 5 sessions have a measured session_quality_score.',
      evidenceAndContext: `Analysis of ${totalSessions} development sessions. Eligible session-quality samples: ${eligibleQualitySessions.length}.`,
      operationalImpact: 'Session quality correlation unavailable until eligible sample size is met.',
      primaryRisk: 'None — insight is suppressed rather than showing a misleading zero value.',
      cohort: 'Session Quality',
      confidenceReasoning: `Low confidence: fewer than ${MIN_ELIGIBLE_QUALITY_SAMPLES} eligible session-quality values.`,
      recommendationState: 'monitor_only',
      urgencyLabel: 'monitor',
      engineVersion: 'FINAL_ENGINE_V1',
      generatorSource: 'final/generators/planCode.ts',
      featureFlagState: true,
      evidence: [],
      breakdownByTool: undefined,
      comparisonState: 'needs_more_data'
    };
  }

  // Tool distribution for the high-quality cohort (score >= 80, not band field)
  const highQualityToolDistribution: Record<string, number> = {};
  for (const s of highQualitySessions) {
    const tool = normalizeIDE(s.tool) || 'unknown';
    highQualityToolDistribution[tool] = (highQualityToolDistribution[tool] || 0) + 1;
  }

  // Get GitHub outcomes for correlation
  const reviewCycleTime = githubSnapshot.pr_review_cycles || 0;
  const reopenRate = githubSnapshot.reopen_pressure_spike || 0;
  const largePRMixRisk = githubSnapshot.large_pr_mix_risk || 0;

  // CR-X P0-B: This PI claims to CORRELATE session quality with GitHub
  // delivery outcomes (merge cycles, reopen rates). When GitHub evidence
  // is ineligible (input.githubSnapshot === undefined), the correlation
  // claim is unsupported. Suppress to diagnostic — do NOT render a numeric
  // quality-ratio finding with merge/reopen language.
  const hasGithubSnapshot = !!input.githubSnapshot;
  const hasGitHubOutcomes = reviewCycleTime > 0 || reopenRate > 0 || largePRMixRisk > 0;
  if (!hasGithubSnapshot || !hasGitHubOutcomes) {
    if (!isStressMode) {
      piDebugLog('[GENERATOR_SESSION_QUALITY_MERGE_SUCCESS][NO_GITHUB_OUTCOMES]', {
        hasGithubSnapshot,
        reviewCycleTime,
        reopenRate,
        largePRMixRisk
      });
      return {
        id: registryEntry.id,
        title: 'Session quality correlation needs GitHub delivery outcomes',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'trend',
        current: 0,
        baseline: 0,
        delta: 0,
        deltaPct: 0,
        rightMetric: '—',
        rightMetricLabel: 'High-Quality Sessions',
        metricDefinition: 'Percentage of sessions with quality score >= 80 correlated with merge success — requires GitHub PR/review/deploy evidence',
        operationalBreadcrumbs: [
          `${totalSessions} sessions analyzed`,
          'GitHub delivery outcomes unavailable — cannot correlate quality with merge outcomes'
        ],
        confidence: 'low',
        coveragePct: 0,
        n: totalSessions,
        hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'WAITING_FOR_GITHUB_DELIVERY_OUTCOMES',
        diagnosticUnlockPath: 'Requires GitHub connection to access PR, review, and deployment data for quality-outcome correlation',
        description: 'Session quality scores are available, but GitHub delivery outcomes (merge cycles, reopen rates) are not. Without outcome data, a numeric quality comparison would assert a correlation that cannot be measured.',
        whatChanged: 'GitHub delivery outcomes unavailable for quality-outcome correlation.',
        whyItMatters: 'Session quality scores are a derived signal, not a measured outcome. Correlating them with GitHub delivery outcomes requires actual PR/review/deploy evidence.',
        recommendation: 'Connect GitHub to enable session-quality-to-merge-outcome correlation.',
        evidenceAndContext: `Analysis of ${totalSessions} development sessions. Session quality scores available, but GitHub delivery outcomes are unavailable.`,
        operationalImpact: 'Quality-outcome correlation unavailable without GitHub evidence.',
        primaryRisk: 'Presenting a derived quality score as a measured outcome correlation would be misleading.',
        cohort: 'Session Quality',
        confidenceReasoning: 'Low confidence: GitHub delivery outcomes unavailable for quality-outcome correlation.',
        recommendationState: 'monitor_only',
        urgencyLabel: 'monitor',
        engineVersion: 'FINAL_ENGINE_V1',
        generatorSource: 'final/generators/planCode.ts',
        featureFlagState: true,
        evidence: [],
        breakdownByTool: undefined,
        comparisonState: 'needs_more_data'
      };
    }
  }

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const highQualityCount = highQualitySessions.length;
  const lowQualityCount = lowQualitySessions.length;
  const coveragePct = coveragePct1dp((highQualityCount + lowQualityCount), totalSessions);

  // COHORT ELIGIBILITY CONTRACT: require at least 5 eligible sessions in
  // both high and low quality cohorts before emitting a numeric comparison.
  // If either cohort has fewer than 5, return needs-more-data diagnostic.
  const MIN_COHORT_SIZE = 5;
  if (!isStressMode && (highQualityCount < MIN_COHORT_SIZE || lowQualityCount < MIN_COHORT_SIZE)) {
    piDebugLog('[GENERATOR_SESSION_QUALITY_MERGE_SUCCESS][INSUFFICIENT_COHORT_SAMPLES]', { highQualityCount, lowQualityCount });
    return {
      id: registryEntry.id,
      title: registryEntry.title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      comparisonMode: 'trend',
      current: 0,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      rightMetric: '—',
      rightMetricLabel: 'High-Quality Sessions',
      metricDefinition: 'Percentage of sessions with quality score >= 80 correlated with merge success',
      operationalBreadcrumbs: [
        `${totalSessions} sessions analyzed`,
        `High-quality cohort: ${highQualityCount} sessions (need ${MIN_COHORT_SIZE})`,
        `Low-quality cohort: ${lowQualityCount} sessions (need ${MIN_COHORT_SIZE})`,
        'Insufficient cohort sizes for quality-vs-merge comparison'
      ],
      confidence: 'low',
      coveragePct: 0,
      n: totalSessions,
      hasData: false,
      isDiagnostic: true,
      diagnosticReason: 'WAITING_FOR_GITHUB_DELIVERY_OUTCOMES',
      description: 'Session quality cohorts need more data to correlate with merge success.',
      whatChanged: 'Insufficient eligible session-quality data in both high and low cohorts.',
      whyItMatters: 'High-quality sessions correlate with faster PR cycle times and lower reopen rates, but requires at least 5 eligible sessions in each cohort.',
      recommendation: 'Continue collecting telemetry. This insight will populate once both high-quality and low-quality cohorts have at least 5 sessions with measured session_quality_score.',
      evidenceAndContext: `Analysis of ${totalSessions} development sessions. High-quality cohort: ${highQualityCount} sessions. Low-quality cohort: ${lowQualityCount} sessions. Minimum ${MIN_COHORT_SIZE} required in each.`,
      operationalImpact: 'Session quality correlation unavailable until both cohorts meet minimum sample size.',
      primaryRisk: 'None — insight is suppressed rather than showing a misleading 0% vs 100% or 100% vs 0% split.',
      cohort: 'Session Quality',
      confidenceReasoning: `Low confidence: high-quality cohort has ${highQualityCount} sessions, low-quality cohort has ${lowQualityCount} sessions (minimum ${MIN_COHORT_SIZE} required in each).`,
      recommendationState: 'monitor_only',
      urgencyLabel: 'monitor',
      engineVersion: 'FINAL_ENGINE_V1',
      generatorSource: 'final/generators/planCode.ts',
      featureFlagState: true,
      evidence: [],
      breakdownByTool: undefined,
      comparisonState: 'needs_more_data'
    };
  }

  // Determine if high-quality sessions correlate with better outcomes
  const highQualityRatio = totalSessions > 0 ? (highQualityCount / totalSessions) * 100 : 0;
  const lowQualityRatio = totalSessions > 0 ? (lowQualityCount / totalSessions) * 100 : 0;

  // Dynamic title based on quality mix - follow title doctrine
  // Use rate-based language instead of implying quality leadership from raw counts
  const dynamicTitle = lowQualityRatio > 50
    ? `Low-quality sessions are ${formatPct(lowQualityRatio)} vs high-quality ${formatPct(highQualityRatio)}`
    : highQualityRatio > 50
    ? `High-quality sessions are ${formatPct(highQualityRatio)} vs low-quality ${formatPct(lowQualityRatio)}`
    : `Session quality is ${formatPct(highQualityRatio)} high-quality vs ${formatPct(lowQualityRatio)} low-quality`;

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: dynamicTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'trend',
    current: highQualityRatio,
    baseline: lowQualityRatio,
    delta: highQualityRatio - lowQualityRatio,
    deltaPct: lowQualityRatio > 0 ? ((highQualityRatio - lowQualityRatio) / lowQualityRatio) * 100 : 0,
    rightMetric: formatPct(highQualityRatio) + ' high-quality',
    rightMetricLabel: 'High-Quality Sessions',
    metricDefinition: 'Percentage of sessions with quality score >= 80 correlated with merge success',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      `High-quality sessions: ${highQualityCount} (${formatPct(highQualityRatio)})`,
      `Low-quality sessions: ${lowQualityCount} (${formatPct(lowQualityRatio)})`,
      `GitHub outcomes: ${reviewCycleTime.toFixed(1)} day review cycle, ${formatPct(reopenRate)} reopen rate`
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: `${formatPct(highQualityRatio)} of sessions achieve high quality (score >= 80), ${highQualityRatio > lowQualityRatio + 20 ? formatDelta(highQualityRatio - lowQualityRatio) + ' more' : 'similar to'} low-quality sessions at ${formatPct(lowQualityRatio)}. ${lowQualityRatio > 50 ? 'Low-quality session mix may be limiting merge reliability.' : 'High-quality sessions correlate with faster merge cycles and lower reopen rates.'}`,
    whatChanged: `Session quality distribution: ${formatPct(highQualityRatio)} high-quality vs ${formatPct(lowQualityRatio)} low-quality (${highQualityRatio > lowQualityRatio + 20 ? formatDelta(highQualityRatio - lowQualityRatio) + ' difference' : 'similar'}).`,
    whyItMatters: lowQualityRatio > 50
      ? 'Low-quality session mix may be limiting merge reliability and increasing review cycles.'
      : 'High-quality sessions correlate with faster PR cycle times and lower reopen rates, indicating better code quality and engineering practices.',
    recommendation: lowQualityRatio > 50
      ? `${formatPct(lowQualityRatio)} of sessions are low-quality, which may be limiting merge reliability. Investigate which workflow has the worst quality mix and review workflow patterns, AI tool configuration, or code review practices for that workflow.`
      : highQualityRatio < 50
      ? `Only ${formatPct(highQualityRatio)} of sessions are high-quality. Investigate workflow patterns, AI tool configuration, or code review practices to improve session quality.`
      : 'Session quality distribution is healthy. Monitor for decreases that may indicate process degradation.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. High-quality (>= 80): ${highQualityCount} sessions (${formatPct(highQualityRatio)}). Low-quality (< 60): ${lowQualityCount} sessions (${formatPct(lowQualityRatio)}). GitHub outcomes: ${reviewCycleTime.toFixed(1)} day review cycle, ${formatPct(reopenRate)} reopen rate, ${largePRMixRisk}% large PR mix risk. Coverage: ${coveragePct}%.`,
    operationalImpact: `${highQualityRatio < 50 ? 'Low' : 'Healthy'} session quality distribution may impact merge velocity and code review efficiency.`,
    primaryRisk: 'Low session quality correlates with longer review cycles and higher PR reopen rates.',
    cohort: 'Session Quality',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% valid quality data.`,
    recommendationState: highQualityRatio < 50 ? 'action_required' : 'monitor_only',
    urgencyLabel: highQualityRatio < 50 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: 'High-quality', value: formatPct(highQualityRatio), label: 'Sessions' },
      { metric: 'Low-quality', value: formatPct(lowQualityRatio), label: 'Sessions' },
      { metric: 'Review cycle', value: reviewCycleTime.toFixed(1) + ' days', label: 'GitHub' },
      { metric: 'Reopen rate', value: formatPct(reopenRate), label: 'GitHub' }
    ],
    breakdownByTool: Object.keys(highQualityToolDistribution).length > 0 ? Object.fromEntries(
      Object.entries(highQualityToolDistribution).map(([tool, count]) => [
        tool,
        { value: count, count, formatted: `${count} sessions`, label: `${getCanonicalWorkflowIdentity(tool) || tool} (${count} sessions)` }
      ])
    ) : {},
    operationalRead: `${formatPct(highQualityRatio)} high-quality sessions vs ${formatPct(lowQualityRatio)} low-quality sessions (${highQualityRatio > lowQualityRatio + 20 ? formatDelta(highQualityRatio - lowQualityRatio) + ' difference' : 'similar'}).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live'
  };

  return baseInsight;
}

/**
 * Generate context switching impact PI
 * 
 * Quantifies the cost of context switching by correlating idle_ratio and focus_ratio with delivery velocity and review cycle time.
 * Uses idle_ratio, focus_ratio, flow_profile, session_duration_minutes, and tool.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateContextSwitchingImpact(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('context-switching-impact');
  if (!registryEntry) {
    piDebugLog('[GENERATOR_CONTEXT_SWITCHING_IMPACT][NO_REGISTRY]', 'Registry entry not found');
    return null;
  }

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};

  piDebugLog('[GENERATOR_CONTEXT_SWITCHING_IMPACT][START]', 'Generating context-switching-impact');
  piDebugLog('[RUNTIME_PROOF][context-switching-impact]', {
    insightId: 'context-switching-impact',
    stage: 'plan-code',
    totalSessions,
    sampleSession: sessionRows[0] ? {
      idle_ratio: sessionRows[0].idle_ratio,
      focus_ratio: sessionRows[0].focus_ratio,
      flow_profile: sessionRows[0].flow_profile,
      tool: sessionRows[0].tool
    } : null
  });

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_CONTEXT_SWITCHING_IMPACT][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }

  // Group sessions by workflow using canonical grouping (includes devin, cursor, vscode, etc.)
  const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Calculate average idle and focus ratios per workflow
  const workflowContextStats: Record<string, { avgIdleRatio: number; avgFocusRatio: number; sessionCount: number; idleHeavyCount: number; codingHeavyCount: number }> = {};

  for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
    if (sessions.length === 0) continue;

    const validSessions = sessions.filter(s => typeof s.idle_ratio === 'number' && typeof s.focus_ratio === 'number');
    if (validSessions.length === 0) continue;

    const avgIdleRatio = validSessions.reduce((sum, s) => sum + s.idle_ratio, 0) / validSessions.length;
    const avgFocusRatio = validSessions.reduce((sum, s) => sum + s.focus_ratio, 0) / validSessions.length;
    const idleHeavyCount = validSessions.filter(s => s.idle_ratio > 0.5).length;
    const codingHeavyCount = validSessions.filter(s => s.focus_ratio > 0.6).length;

    workflowContextStats[workflow] = {
      avgIdleRatio,
      avgFocusRatio,
      sessionCount: validSessions.length,
      idleHeavyCount,
      codingHeavyCount
    };
  }

  // Determine highest and lowest context switching workflows (lower idle is better)
  const entries = Object.entries(workflowContextStats).filter(([_, data]) => isStressMode || data.sessionCount >= 10);
  if (entries.length < 2) {
    piDebugLog('[GENERATOR_CONTEXT_SWITCHING_IMPACT][INSUFFICIENT_WORKFLOW_DATA]', { entries });
    return null;
  }

  // Sort ascending: lower idle ratio (better focus) first
  entries.sort((a, b) => a[1].avgIdleRatio - b[1].avgIdleRatio);
  const [lowestWorkflow, lowestData] = entries[0];
  const [highestWorkflow, highestData] = entries[entries.length - 1];
  const idleGap = highestData.avgIdleRatio - lowestData.avgIdleRatio;

  // Hide PI if all compared values are zero (no evidence) - fix sub-1% smell test
  if (!isStressMode && highestData.avgIdleRatio < 0.01 && lowestData.avgIdleRatio < 0.01) {
    piDebugLog('[GENERATOR_CONTEXT_SWITCHING_IMPACT][ZERO_EVIDENCE]', { highestData: highestData.avgIdleRatio, lowestData: lowestData.avgIdleRatio });
    return null;
  }

  // Get GitHub outcomes for correlation
  const reviewCycleTime = githubSnapshot.pr_review_cycles || 0;
  const deliveryVelocity = githubSnapshot.delivery_velocity_by_workflow || 0;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const coveragePct = coveragePct1dp(entries.reduce((sum, [_, data]) => sum + data.sessionCount, 0), totalSessions);

  // Executive title based on idle pattern (lower is better) - follow title doctrine (show actual values)
  let executiveTitle: string;
  // CR5 P0.7: idle_ratio is decimal (0-1), formatPct expects percent (0-100)
  const lowestIdlePct = lowestData.avgIdleRatio * 100;
  const highestIdlePct = highestData.avgIdleRatio * 100;
  // If both ratios are sub-1%, classify as diagnostic with instrumentation caveat
  if (highestIdlePct < 1 && lowestIdlePct < 1) {
    executiveTitle = 'Idle ratio instrumentation needs validation before workflow ranking';
  } else if (idleGap > 0.2) {
    executiveTitle = `${getCanonicalWorkflowIdentity(lowestWorkflow)} idle signal is ${formatPct(lowestIdlePct)} vs ${getCanonicalWorkflowIdentity(highestWorkflow)} ${formatPct(highestIdlePct)}`;
  } else if (lowestIdlePct < 30) {
    executiveTitle = `Context switching is low across primary workflows (${formatPct(lowestIdlePct)} vs ${formatPct(highestIdlePct)})`;
  } else {
    executiveTitle = `Context switching varies across primary workflows (${formatPct(lowestIdlePct)} vs ${formatPct(highestIdlePct)})`;
  }

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    // CR5 P0.8: Cross-sectional workflow comparison
    presentationKind: 'workflow_comparison',
    // CR5 P0.7: This is a cross-sectional workflow comparison (idle ratio
    // across workflows), not a temporal trend. Use 'absolute' mode.
    comparisonMode: 'absolute',
    current: lowestData.avgIdleRatio,
    baseline: highestData.avgIdleRatio,
    delta: idleGap,
    deltaPct: lowestData.avgIdleRatio > 0 ? ((highestData.avgIdleRatio - lowestData.avgIdleRatio) / lowestData.avgIdleRatio) * 100 : 0,
    rightMetric: formatPct(lowestIdlePct) + ' idle',
    rightMetricLabel: 'Idle Ratio',
    metricDefinition: 'Percentage of session time spent idle (context switching) correlated with delivery outcomes',
    polarity: 'lower_is_better' as const, // Higher idle ratio is worse (lower is better)
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      `${getCanonicalWorkflowIdentity(lowestWorkflow)}: ${formatPct(lowestIdlePct)} idle ratio (${lowestData.sessionCount} sessions, ${lowestData.codingHeavyCount} coding-heavy)`,
      `${getCanonicalWorkflowIdentity(highestWorkflow)}: ${formatPct(highestIdlePct)} idle ratio (${highestData.sessionCount} sessions, ${highestData.idleHeavyCount} idle-heavy)`,
      `GitHub outcomes: ${reviewCycleTime.toFixed(1)} day review cycle`
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: `${getCanonicalWorkflowIdentity(lowestWorkflow)} workflows spend ${formatPct(lowestIdlePct)} of session time idle, ${idleGap > 0.2 ? formatDelta(idleGap * 100) + ' less' : 'similar to'} ${getCanonicalWorkflowIdentity(highestWorkflow)} at ${formatPct(highestIdlePct)}. Lower context switching correlates with faster delivery.`,
    whatChanged: `Context switching variance: ${getCanonicalWorkflowIdentity(lowestWorkflow)} ${formatPct(lowestIdlePct)} idle vs ${getCanonicalWorkflowIdentity(highestWorkflow)} ${formatPct(highestIdlePct)} idle (${idleGap > 0.2 ? formatDelta(idleGap * 100) + ' difference' : 'similar'}).`,
    whyItMatters: 'Lower context switching (less idle time) correlates with faster delivery velocity and better engineering efficiency.',
    recommendation: idleGap > 0.2
      ? `${getCanonicalWorkflowIdentity(highestWorkflow)} shows high context switching (${formatPct(highestIdlePct)} idle). Review meeting policies, notification settings, or workflow fragmentation for this workflow before expanding to more teams.`
      : 'Context switching levels are consistent across workflows. Monitor for increases that may indicate process degradation.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. ${getCanonicalWorkflowIdentity(lowestWorkflow)}: ${formatPct(lowestIdlePct)} average idle ratio (${lowestData.codingHeavyCount} coding-heavy sessions). ${getCanonicalWorkflowIdentity(highestWorkflow)}: ${formatPct(highestIdlePct)} average idle ratio (${highestData.idleHeavyCount} idle-heavy sessions). GitHub outcomes: ${reviewCycleTime.toFixed(1)} day review cycle, ${deliveryVelocity.toFixed(1)} commits/day. Coverage: ${coveragePct}%.`,
    operationalImpact: `${idleGap > 0.2 ? 'High' : 'Similar'} context switching may impact delivery velocity and review efficiency.`,
    primaryRisk: 'High context switching correlates with slower delivery velocity and longer review cycles.',
    cohort: 'Context Switching',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% valid context data across ${entries.length} workflows.`,
    recommendationState: idleGap > 0.2 ? 'action_required' : 'monitor_only',
    urgencyLabel: idleGap > 0.2 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: getCanonicalWorkflowIdentity(lowestWorkflow), value: formatPct(lowestIdlePct), label: 'Idle ratio' },
      { metric: getCanonicalWorkflowIdentity(highestWorkflow), value: formatPct(highestIdlePct), label: 'Idle ratio' },
      { metric: 'Idle Gap', value: formatPct(idleGap * 100), label: 'Variance' },
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total sessions' }
    ],
    breakdownByTool: {
      [lowestWorkflow]: { value: lowestIdlePct, count: lowestData.sessionCount, formatted: `${formatPct(lowestIdlePct)} idle`, label: `${getCanonicalWorkflowIdentity(lowestWorkflow)} (${lowestData.sessionCount} sessions)` },
      [highestWorkflow]: { value: highestIdlePct, count: highestData.sessionCount, formatted: `${formatPct(highestIdlePct)} idle`, label: `${getCanonicalWorkflowIdentity(highestWorkflow)} (${highestData.sessionCount} sessions)` }
    },
    operationalRead: `${getCanonicalWorkflowIdentity(lowestWorkflow)}: ${formatPct(lowestData.avgIdleRatio)} idle vs ${getCanonicalWorkflowIdentity(highestWorkflow)}: ${formatPct(highestData.avgIdleRatio)} idle (${idleGap > 0.2 ? formatDelta(idleGap * 100) + ' difference' : 'similar'}).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live'
  };

  return baseInsight;
}

/**
 * Generate AI intensity to delivery velocity PI
 * 
 * Correlates AI intensity patterns with delivery velocity, reviewer load, and PR size.
 * Uses ai_intensity_band, ai_burst_chars_total, ai_burst_lines_total, ai_usage_duration_ms, and tool.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateAIIntensityDeliveryVelocity(input: CanonicalInsightInput): CanonicalInsight | null {
  // CR5 WS2 #14 P0-4b: CONSOLIDATED into session-conditioned-pr-cycle-time-ai-vs-non-ai.
  // Both require session→PR attribution. Return null — the consolidated
  // diagnostic in generateSessionConditionedPRCycleTimeAIVsNonAI covers both.
  return null;
}

// --- ai-intensity-delivery-velocity body removed (consolidated into session-conditioned-pr-cycle-time) ---

/* eslint-disable */
/*
  const registryEntry = getCanonicalPIById('ai-intensity-delivery-velocity');
  if (!registryEntry) {
    piDebugLog('[GENERATOR_AI_INTENSITY_DELIVERY_VELOCITY][NO_REGISTRY]', 'Registry entry not found');
    return null;
  }

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};

  piDebugLog('[GENERATOR_AI_INTENSITY_DELIVERY_VELOCITY][START]', 'Generating ai-intensity-delivery-velocity');
  piDebugLog('[RUNTIME_PROOF][ai-intensity-delivery-velocity]', {
    insightId: 'ai-intensity-delivery-velocity',
    stage: 'plan-code',
    totalSessions,
    sampleSession: sessionRows[0] ? {
      ai_intensity_band: sessionRows[0].ai_intensity_band,
      ai_burst_chars_total: sessionRows[0].ai_burst_chars_total,
      ai_burst_lines_total: sessionRows[0].ai_burst_lines_total,
      tool: sessionRows[0].tool
    } : null
  });

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  // Only suppress if truly impossible/broken - no sessions at all
  if (!isStressMode && totalSessions === 0) {
    piDebugLog('[GENERATOR_AI_INTENSITY_DELIVERY_VELOCITY][NO_DATA]', { totalSessions });
    return null;
  }

  // Group sessions by AI intensity band
  const sessionsByIntensity: Record<string, any[]> = {
    high: [],
    medium: [],
    low: [],
    none: []
  };

  for (const session of sessionRows) {
    const intensity = session.ai_intensity_band?.toLowerCase();
    if (intensity && sessionsByIntensity[intensity]) {
      sessionsByIntensity[intensity].push(session);
    }
  }

  // Calculate metrics per intensity band
  const intensityStats: Record<string, { sessionCount: number; avgCharsTotal: number; avgLinesTotal: number; avgDuration: number; toolDistribution: Record<string, number> }> = {};

  for (const [intensity, sessions] of Object.entries(sessionsByIntensity)) {
    if (sessions.length === 0) continue;

    const validSessions = sessions.filter(s => typeof s.ai_burst_chars_total === 'number' && typeof s.ai_burst_lines_total === 'number');
    if (validSessions.length === 0) continue;

    const avgCharsTotal = validSessions.reduce((sum, s) => sum + s.ai_burst_chars_total, 0) / validSessions.length;
    const avgLinesTotal = validSessions.reduce((sum, s) => sum + s.ai_burst_lines_total, 0) / validSessions.length;
    const avgDuration = validSessions.reduce((sum, s) => sum + (s.ai_usage_duration_ms || 0), 0) / validSessions.length;
    const toolDistribution: Record<string, number> = {};
    for (const s of validSessions) {
      const tool = normalizeIDE(s.tool) || 'unknown';
      toolDistribution[tool] = (toolDistribution[tool] || 0) + 1;
    }

    intensityStats[intensity] = {
      sessionCount: validSessions.length,
      avgCharsTotal,
      avgLinesTotal,
      avgDuration,
      toolDistribution
    };
  }

  // Get GitHub outcomes for correlation
  const deliveryVelocity = githubSnapshot.delivery_velocity_by_workflow || 0;
  const reviewerLoad = githubSnapshot.reviewer_load_concentration || 0;
  const reviewCycleTime = githubSnapshot.pr_review_cycles || 0;
  const largePRMixRisk = githubSnapshot.large_pr_mix_risk || 0;

  const highIntensityCount = sessionsByIntensity.high?.length || 0;
  const lowIntensityCount = sessionsByIntensity.low?.length || 0;
  const coveragePct = totalSessions > 0 ? coveragePct1dp((highIntensityCount + lowIntensityCount), totalSessions) : 0;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';

  // Determine if high intensity correlates with better/worse outcomes
  const highIntensityRatio = totalSessions > 0 ? (highIntensityCount / totalSessions) * 100 : 0;
  const lowIntensityRatio = totalSessions > 0 ? (lowIntensityCount / totalSessions) * 100 : 0;

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: registryEntry.title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'trend',
    current: highIntensityRatio,
    baseline: lowIntensityRatio,
    delta: highIntensityRatio - lowIntensityRatio,
    deltaPct: lowIntensityRatio > 0 ? ((highIntensityRatio - lowIntensityRatio) / lowIntensityRatio) * 100 : 0,
    rightMetric: formatPct(highIntensityRatio) + ' high-intensity',
    rightMetricLabel: 'High-Intensity AI Sessions',
    metricDefinition: 'Percentage of sessions with high AI intensity (telemetry-only)',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      `High-intensity AI: ${highIntensityCount} sessions (${formatPct(highIntensityRatio)})`,
      `Low-intensity AI: ${lowIntensityCount} sessions (${formatPct(lowIntensityRatio)})`,
      'Telemetry-only · no GitHub review evidence'
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: `${formatPct(highIntensityRatio)} of sessions use high-intensity AI, ${highIntensityRatio > lowIntensityRatio + 20 ? formatDelta(highIntensityRatio - lowIntensityRatio) + ' more' : 'similar to'} low-intensity at ${formatPct(lowIntensityRatio)}. Telemetry-only — no cohort-attributed reviewer-load evidence available.`,
    whatChanged: `AI intensity distribution: ${formatPct(highIntensityRatio)} high-intensity vs ${formatPct(lowIntensityRatio)} low-intensity (${highIntensityRatio > lowIntensityRatio + 20 ? formatDelta(highIntensityRatio - lowIntensityRatio) + ' difference' : 'similar'}).`,
    whyItMatters: 'AI intensity patterns vary across sessions. This is a telemetry-only finding — no cohort-attributed reviewer-load or delivery-velocity evidence is available for this comparison.',
    recommendation: 'Monitor AI intensity distribution. Differences may reflect task mix, tool adoption stage, or workflow design — not tool quality.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. High-intensity AI: ${highIntensityCount} sessions (${formatPct(highIntensityRatio)}). Low-intensity AI: ${lowIntensityCount} sessions (${formatPct(lowIntensityRatio)}). Telemetry-only — no GitHub review evidence. Coverage: ${coveragePct}%.`,
    operationalImpact: 'AI intensity distribution observed across sessions. Telemetry-only — no reviewer-load evidence available.',
    primaryRisk: 'AI intensity concentration may indicate uneven adoption patterns.',
    cohort: 'AI Intensity',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% valid AI intensity data.`,
    recommendationState: 'monitor_only',
    urgencyLabel: 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: 'High-intensity', value: formatPct(highIntensityRatio), label: 'AI sessions' },
      { metric: 'Low-intensity', value: formatPct(lowIntensityRatio), label: 'AI sessions' }
    ],
    breakdownByTool: intensityStats.high?.toolDistribution ? Object.fromEntries(
      Object.entries(intensityStats.high.toolDistribution).map(([tool, count]) => [
        tool,
        { value: count, count, formatted: `${count} sessions`, label: `${tool}` }
      ])
    ) : {},
    operationalRead: `${formatPct(highIntensityRatio)} high-intensity AI vs ${formatPct(lowIntensityRatio)} low-intensity AI (${highIntensityRatio > lowIntensityRatio + 20 ? formatDelta(highIntensityRatio - lowIntensityRatio) + ' difference' : 'similar'}).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live'
  };

  return baseInsight;
}
*/
/* eslint-enable */

/**
 * Generate review burden by AI pattern PI
 * 
 * Correlates AI usage patterns with reviewer load concentration and review cycle time.
 * Uses ai_intensity_band, ai_burst_chars_total, ai_burst_lines_total, and tool.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateReviewBurdenByAIPattern(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('review-burden-by-ai-pattern');
  if (!registryEntry) {
    piDebugLog('[GENERATOR_REVIEW_BURDEN_BY_AI_PATTERN][NO_REGISTRY]', 'Registry entry not found');
    return null;
  }

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};

  piDebugLog('[GENERATOR_REVIEW_BURDEN_BY_AI_PATTERN][START]', 'Generating review-burden-by-ai-pattern');
  piDebugLog('[RUNTIME_PROOF][review-burden-by-ai-pattern]', {
    insightId: 'review-burden-by-ai-pattern',
    stage: 'plan-code',
    totalSessions,
    sampleSession: sessionRows[0] ? {
      ai_intensity_band: sessionRows[0].ai_intensity_band,
      ai_burst_chars_total: sessionRows[0].ai_burst_chars_total,
      ai_burst_lines_total: sessionRows[0].ai_burst_lines_total,
      tool: sessionRows[0].tool
    } : null
  });

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_REVIEW_BURDEN_BY_AI_PATTERN][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }

  // Group sessions by workflow using canonical grouping (includes devin, cursor, vscode, etc.)
  const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Calculate AI intensity metrics per workflow
  const workflowAIStats: Record<string, { sessionCount: number; highIntensityCount: number; avgCharsTotal: number; avgLinesTotal: number }> = {};

  for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
    if (sessions.length === 0) continue;

    const validSessions = sessions.filter(s => typeof s.ai_burst_chars_total === 'number' && typeof s.ai_burst_lines_total === 'number');
    if (validSessions.length === 0) continue;

    const avgCharsTotal = validSessions.reduce((sum, s) => sum + s.ai_burst_chars_total, 0) / validSessions.length;
    const avgLinesTotal = validSessions.reduce((sum, s) => sum + s.ai_burst_lines_total, 0) / validSessions.length;
    const highIntensityCount = validSessions.filter(s => s.ai_intensity_band?.toLowerCase() === 'high').length;

    workflowAIStats[workflow] = {
      sessionCount: validSessions.length,
      highIntensityCount,
      avgCharsTotal,
      avgLinesTotal
    };
  }

  // Get GitHub outcomes for correlation
  const reviewerLoad = githubSnapshot.reviewer_load_concentration || 0;
  const reviewCycleTime = githubSnapshot.pr_review_cycles || 0;
  const largePRMixRisk = githubSnapshot.large_pr_mix_risk || 0;

  // Determine highest and lowest AI intensity workflows
  const entries = Object.entries(workflowAIStats).filter(([_, data]) => isStressMode || data.sessionCount >= 10);
  if (entries.length < 2) {
    piDebugLog('[GENERATOR_REVIEW_BURDEN_BY_AI_PATTERN][INSUFFICIENT_WORKFLOW_DATA]', { entries });
    return null;
  }

  entries.sort((a, b) => b[1].highIntensityCount - a[1].highIntensityCount);
  const [highestWorkflow, highestData] = entries[0];
  const [lowestWorkflow, lowestData] = entries[entries.length - 1];
  const highIntensityRatio = highestData.sessionCount > 0 ? (highestData.highIntensityCount / highestData.sessionCount) * 100 : 0;
  const lowIntensityRatio = lowestData.sessionCount > 0 ? (lowestData.highIntensityCount / lowestData.sessionCount) * 100 : 0;
  const intensityGap = highIntensityRatio - lowIntensityRatio;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const coveragePct = coveragePct1dp(entries.reduce((sum, [_, data]) => sum + data.sessionCount, 0), totalSessions);

  // CR5 WS1.5 P0 FIX: This is a telemetry-only AI-behavior finding (Plan & Code).
  // It must NOT imply review burden or GitHub semantics when no GitHub review
  // evidence exists. The title, description, whyItMatters, and recommendation
  // are framed as AI intensity patterns, not review burden.
  // The title must reflect the ACTUAL measured gap — a 19.4pp gap is NOT
  // "balanced". Threshold lowered from 30 to 10pp for "variance" classification.
  const hasGithubReviewEvidence = reviewerLoad > 0 || reviewCycleTime > 0;
  const tw = (id: string) => getCanonicalWorkflowIdentity(id).replace(' workflow', '');

  // Dynamic title — telemetry-only when no GitHub evidence
  // CR5 WS1.5: Title doctrine — show actual values and gap, not vague labels
  const dynamicTitle = hasGithubReviewEvidence && reviewerLoad > 15 && intensityGap > 30
    ? `High AI intensity increased reviewer load (${tw(highestWorkflow)} ${formatPct(highIntensityRatio)} vs ${tw(lowestWorkflow)} ${formatPct(lowIntensityRatio)})`
    : hasGithubReviewEvidence && reviewerLoad > 15 && intensityGap <= 10
    ? `AI workflows correlate with reviewer load (${tw(highestWorkflow)} ${formatPct(highIntensityRatio)} vs ${tw(lowestWorkflow)} ${formatPct(lowIntensityRatio)})`
    : intensityGap > 10
    ? `AI intensity varies ${intensityGap.toFixed(1)}pp across workflows (${tw(highestWorkflow)} ${formatPct(highIntensityRatio)} vs ${tw(lowestWorkflow)} ${formatPct(lowIntensityRatio)})`
    : 'AI intensity patterns are similar across workflows';

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: dynamicTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'evidence_only',
    comparisonMode: 'trend',
    current: highIntensityRatio,
    baseline: lowIntensityRatio,
    delta: intensityGap,
    deltaPct: lowIntensityRatio > 0 ? ((highIntensityRatio - lowIntensityRatio) / lowIntensityRatio) * 100 : 0,
    rightMetric: formatPct(highIntensityRatio) + ' high-intensity',
    rightMetricLabel: 'High-Intensity AI',
    metricDefinition: 'Percentage of sessions with high AI intensity across workflows (telemetry-only)',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      `${tw(highestWorkflow)}: ${formatPct(highIntensityRatio)} high-intensity AI (${highestData.sessionCount} sessions, ${highestData.highIntensityCount} high-intensity)`,
      `${tw(lowestWorkflow)}: ${formatPct(lowIntensityRatio)} high-intensity AI (${lowestData.sessionCount} sessions, ${lowestData.highIntensityCount} high-intensity)`,
      'Telemetry-only · no GitHub review evidence'
    ],
    confidence,
    coveragePct,
    n: totalSessions,
    hasData: true,
    description: `High-intensity AI appears in ${formatPct(highIntensityRatio)} of ${tw(highestWorkflow)} sessions versus ${formatPct(lowIntensityRatio)} of ${tw(lowestWorkflow)} sessions, a ${intensityGap.toFixed(1)}pp difference. This comparison is observational and telemetry-only.`,
    whatChanged: `AI intensity variance: ${tw(highestWorkflow)} ${formatPct(highIntensityRatio)} high-intensity vs ${tw(lowestWorkflow)} ${formatPct(lowIntensityRatio)} high-intensity (${intensityGap.toFixed(1)}pp difference).`,
    whyItMatters: 'AI intensity patterns vary across workflows. Understanding these patterns helps identify where AI assistance is most concentrated. This is a telemetry-only finding — no cohort-attributed reviewer-load evidence is available for this comparison.',
    recommendation: 'Monitor AI intensity patterns across workflows. Differences may reflect task mix, team structure, or tool adoption stage — not tool quality.',
    evidenceAndContext: `Analysis of ${totalSessions} development sessions. ${tw(highestWorkflow)}: ${formatPct(highIntensityRatio)} high-intensity AI (${highestData.highIntensityCount} of ${highestData.sessionCount} sessions, avg ${highestData.avgCharsTotal.toFixed(0)} chars). ${tw(lowestWorkflow)}: ${formatPct(lowIntensityRatio)} high-intensity AI (${lowestData.highIntensityCount} of ${lowestData.sessionCount} sessions, avg ${lowestData.avgCharsTotal.toFixed(0)} chars). Telemetry-only — no GitHub review evidence. Coverage: ${coveragePct}%.`,
    operationalImpact: `${intensityGap > 30 ? 'High' : 'Moderate'} AI intensity variance across workflows. Telemetry-only — no reviewer-load evidence available.`,
    primaryRisk: 'AI intensity concentration in specific workflows may indicate uneven adoption patterns.',
    cohort: 'AI Intensity Patterns',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions with ${coveragePct}% valid AI data across ${entries.length} workflows.`,
    recommendationState: 'monitor_only',
    urgencyLabel: 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: tw(highestWorkflow), value: formatPct(highIntensityRatio), label: 'High-intensity AI' },
      { metric: tw(lowestWorkflow), value: formatPct(lowIntensityRatio), label: 'High-intensity AI' },
      { metric: 'Sessions', value: totalSessions.toString(), label: 'Total' }
    ],
    breakdownByTool: {
      [highestWorkflow]: { value: highIntensityRatio, count: highestData.sessionCount, formatted: `${formatPct(highIntensityRatio)} high-intensity`, label: `${tw(highestWorkflow)} (${highestData.sessionCount} sessions)` },
      [lowestWorkflow]: { value: lowIntensityRatio, count: lowestData.sessionCount, formatted: `${formatPct(lowIntensityRatio)} high-intensity`, label: `${tw(lowestWorkflow)} (${lowestData.sessionCount} sessions)` }
    },
    operationalRead: `${tw(highestWorkflow)}: ${formatPct(highIntensityRatio)} high-intensity AI vs ${tw(lowestWorkflow)}: ${formatPct(lowIntensityRatio)} high-intensity AI (${intensityGap.toFixed(1)}pp difference).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live'
  };

  return baseInsight;
}

/**
 * Generate AI adoption velocity PI
 * 
 * Tracks AI adoption rate over time by analyzing ai_burst_count, session_has_ai_activity, and timestamp.
 * Correlates with delivery velocity and review cycle time.
 * 
 * @param input - Canonical insight input data
 * @returns Canonical insight or null if insufficient data
 */
export function generateAIAdoptionVelocity(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('ai-adoption-velocity');
  if (!registryEntry) {
    piDebugLog('[GENERATOR_AI_ADOPTION_VELOCITY][NO_REGISTRY]', 'Registry entry not found');
    return null;
  }

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  const githubSnapshot = input.githubSnapshot || {};

  piDebugLog('[GENERATOR_AI_ADOPTION_VELOCITY][START]', 'Generating ai-adoption-velocity');
  piDebugLog('[RUNTIME_PROOF][ai-adoption-velocity]', {
    insightId: 'ai-adoption-velocity',
    stage: 'plan-code',
    totalSessions,
    sampleSession: sessionRows[0] ? {
      ai_burst_count: sessionRows[0].ai_burst_count,
      session_has_ai_activity: sessionRows[0].session_has_ai_activity,
      timestamp: sessionRows[0].timestamp,
      tool: sessionRows[0].tool
    } : null
  });

  // In Demo Mode, relax conditions to allow rendering
  const isStressMode = isStressModeEnabled();
  
  if (!isStressMode && totalSessions < 30) {
    piDebugLog('[GENERATOR_AI_ADOPTION_VELOCITY][INSUFFICIENT_DATA]', { totalSessions });
    return null;
  }

  // Group sessions by workflow — build from sessions only
  const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);

  // Calculate AI adoption rate per workflow
  const workflowAdoptionStats: Record<string, { sessionCount: number; aiSessionCount: number; adoptionRate: number; avgBurstCount: number }> = {};

  for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
    if (sessions.length === 0) continue;

    const validSessions = sessions.filter(s => typeof s.session_ai_burst_count === 'number' || typeof s.ai_burst_count === 'number');
    if (validSessions.length === 0) continue;

    const getBurstCount = (s: any) => s.session_ai_burst_count ?? s.ai_burst_count ?? 0;
    const aiSessionCount = validSessions.filter(s => getBurstCount(s) > 0).length;
    const adoptionRate = (aiSessionCount / validSessions.length) * 100;
    const avgBurstCount = validSessions.reduce((sum, s) => sum + getBurstCount(s), 0) / validSessions.length;

    workflowAdoptionStats[workflow] = {
      sessionCount: validSessions.length,
      aiSessionCount,
      adoptionRate,
      avgBurstCount
    };
  }

  // Determine highest and lowest adoption workflows
  const entries = Object.entries(workflowAdoptionStats).filter(([_, data]) => isStressMode || data.sessionCount >= 25);
  if (entries.length < 2) {
    piDebugLog('[GENERATOR_AI_ADOPTION_VELOCITY][INSUFFICIENT_WORKFLOW_DATA]', { entries });
    return null;
  }

  entries.sort((a, b) => b[1].adoptionRate - a[1].adoptionRate);
  const [highestWorkflow, highestData] = entries[0];
  const [lowestWorkflow, lowestData] = entries[entries.length - 1];
  const adoptionGap = highestData.adoptionRate - lowestData.adoptionRate;

  // Get GitHub outcomes for correlation
  const deliveryVelocity = githubSnapshot.delivery_velocity_by_workflow || 0;
  const reviewCycleTime = githubSnapshot.pr_review_cycles || 0;

  // Determine confidence based on sample size
  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const coveragePct = coveragePct1dp(entries.reduce((sum, [_, data]) => sum + data.sessionCount, 0), totalSessions);

  // Check if we have sufficient comparison data for directional claims
  // Need at least 20 sessions per workflow for reliable comparison
  const hasSufficientComparisonData = entries.every(([_, data]) => data.sessionCount >= 20);

  // CR5 P0.6: Compute REAL period-over-period adoption velocity.
  // With the full historical population (Nov 2025 – Jul 2026), we can
  // compare adoption rates between the first and last calendar months
  // that have sufficient sample (≥ 20 sessions).
  // CR5 P1.3 P7: Define getBurstCount at function scope so all blocks can use it.
  // CR-X Pass 3: Zero is measured data, not missing. Sessions with missing
  // ai_burst_count (undefined/null/NaN) are excluded from adoption rate
  // calculation, not defaulted to 0.
  const getBurstCount = (s: any) => s.session_ai_burst_count ?? s.ai_burst_count ?? null;
  const hasMeasuredBursts = (s: any) => {
    const v = getBurstCount(s);
    return typeof v === 'number' && Number.isFinite(v);
  };

  const sessionsByMonth: Record<string, typeof sessionRows> = {};
  for (const s of sessionRows) {
    const ts = s.timestamp || (s as any).session_timestamp;
    if (!ts) continue;
    const month = String(ts).slice(0, 7); // YYYY-MM
    if (!sessionsByMonth[month]) sessionsByMonth[month] = [];
    sessionsByMonth[month].push(s);
  }
  const sortedMonths = Object.keys(sessionsByMonth).sort();
  // PARTIAL-PERIOD RULE: the in-progress calendar month can never serve as a
  // period endpoint — it is not a complete comparable period.
  const currentMonthKey = getCurrentMonthKey();
  const monthsWithSufficientSample = sortedMonths.filter(m => m !== currentMonthKey && sessionsByMonth[m].length >= 20);

  let periodAdoptionFirst = 0;
  let periodAdoptionLast = 0;
  let periodFirstLabel = '';
  let periodLastLabel = '';
  let periodDeltaPct = 0;
  let hasPeriodComparison = false;

  if (monthsWithSufficientSample.length >= 2) {
    const firstMonth = monthsWithSufficientSample[0];
    const lastMonth = monthsWithSufficientSample[monthsWithSufficientSample.length - 1];
    // CR-X semantic fix: Use the SAME population as the trajectory (all sessions
    // in the month, not just hasMeasuredBursts). Sessions with missing
    // ai_burst_count are counted as non-AI in the adoption rate, matching the
    // trajectory display. Previously, the delta used only measured-burst sessions
    // (which were 100% AI-active), producing a 0.0pp "unchanged" finding while
    // the trajectory showed real change.
    const firstSessions = sessionsByMonth[firstMonth];
    const lastSessions = sessionsByMonth[lastMonth];

    if (firstSessions.length > 0 && lastSessions.length > 0) {
      const firstAI = firstSessions.filter(s => {
        const v = getBurstCount(s);
        return typeof v === 'number' && v > 0;
      }).length;
      const lastAI = lastSessions.filter(s => {
        const v = getBurstCount(s);
        return typeof v === 'number' && v > 0;
      }).length;
      periodAdoptionFirst = (firstAI / firstSessions.length) * 100;
      periodAdoptionLast = (lastAI / lastSessions.length) * 100;
      periodFirstLabel = firstMonth;
      periodLastLabel = lastMonth;
      periodDeltaPct = periodAdoptionLast - periodAdoptionFirst;
      hasPeriodComparison = true;
    }
  }

  // If we have period-over-period data, produce a real finding.
  // Otherwise fall back to diagnostic with cross-sectional evidence.
  if (hasPeriodComparison) {
    // CR5 P1 P8: Show the FULL monthly trajectory, not just first/last.
    // Build evidence for every month with sufficient sample.
    const monthlyEvidence = monthsWithSufficientSample.map(m => {
      const ss = sessionsByMonth[m].filter(hasMeasuredBursts);
      if (ss.length === 0) return { metric: `${m} adoption`, value: '—', label: `N=0 (no measured ai_burst_count)` };
      const ai = ss.filter(s => getBurstCount(s) > 0).length;
      const rate = (ai / ss.length) * 100;
      return { metric: `${m} adoption`, value: formatPct(rate), label: `N=${ss.length}` };
    });

    // Build breakdownByTool with every month
    const monthlyBreakdown: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
    for (const m of monthsWithSufficientSample) {
      const ss = sessionsByMonth[m];
      const ai = ss.filter(s => getBurstCount(s) > 0).length;
      const rate = (ai / ss.length) * 100;
      monthlyBreakdown[m] = {
        value: rate,
        count: ss.length,
        formatted: `${formatPct(rate)} adoption`,
        label: `${m} (N=${ss.length})`,
      };
    }

    const trajectoryStr = monthsWithSufficientSample.map(m => {
      const ss = sessionsByMonth[m];
      const ai = ss.filter(s => getBurstCount(s) > 0).length;
      const rate = (ai / ss.length) * 100;
      return `${m}: ${formatPct(rate)}`;
    }).join(' → ');

    const direction = periodDeltaPct > 0 ? 'increased' : (periodDeltaPct < 0 ? 'decreased' : 'unchanged');
    const baseInsight: CanonicalInsight = {
      id: registryEntry.id,
      title: `AI-assisted session share ${direction} ${Math.abs(periodDeltaPct).toFixed(1)}pp over ${monthsWithSufficientSample.length} months`,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'comparison',
      presentationKind: 'temporal_trend',
      comparisonMode: 'trend',
      isDiagnostic: false,
      current: periodAdoptionLast,
      baseline: periodAdoptionFirst,
      currentLabel: periodLastLabel,
      baselineLabel: periodFirstLabel,
      delta: periodDeltaPct,
      deltaPct: periodAdoptionFirst > 0 ? ((periodAdoptionLast - periodAdoptionFirst) / periodAdoptionFirst) * 100 : 0,
      displayValue: formatPct(periodAdoptionLast),
      displayDeltaPct: `${periodDeltaPct > 0 ? '+' : ''}${periodDeltaPct.toFixed(1)}pp`,
      rightMetric: formatPct(periodAdoptionFirst),
      rightMetricLabel: `${periodFirstLabel} baseline`,
      polarity: 'higher_is_better',
      confidence,
      coveragePct,
      n: totalSessions,
      hasData: true,
      description: `Observed AI signals session rate across ${monthsWithSufficientSample.length} monthly periods: ${trajectoryStr}. ${periodDeltaPct > 0 ? 'Increase' : periodDeltaPct < 0 ? 'Decrease' : 'No change'} of ${Math.abs(periodDeltaPct).toFixed(1)}pp from ${periodFirstLabel} to ${periodLastLabel}. Gaps between months with <20 sessions are excluded from the trajectory. Association, not causal claim.`,
      recommendation: `Review whether the ${direction} AI activity reflects tool availability changes, team adoption shifts, or project phase transitions. Compare task complexity and outcomes between high-adoption and low-adoption months.`,
      executiveSummary: `AI activity ${direction} ${Math.abs(periodDeltaPct).toFixed(1)}pp across ${monthsWithSufficientSample.length} months (${periodFirstLabel} → ${periodLastLabel}).`,
      evidence: monthlyEvidence,
      breakdownByTool: monthlyBreakdown,
      selectedComparison: {
        leaderKey: periodLastLabel,
        baselineKey: periodFirstLabel,
      },
      whatChanged: `AI adoption trajectory across ${monthsWithSufficientSample.length} monthly periods`,
      whyItMatters: `Monthly trajectory reveals whether AI adoption is accelerating, plateauing, or declining. This is more actionable than a single snapshot.`,
      operationalImpact: `AI activity ${direction} by ${Math.abs(periodDeltaPct).toFixed(1)}pp over ${monthsWithSufficientSample.length} months.`,
      cohort: `${monthsWithSufficientSample.length} monthly periods (N=${totalSessions})`,
      confidenceReasoning: `Month-level aggregation from session timestamps. ${monthsWithSufficientSample.length} periods with ≥20 sessions each. Total N=${totalSessions}.`,
      operationalRead: trajectoryStr,
      urgencyLabel: 'monitor',
      metricDefinition: 'Percentage of sessions with AI activity (ai_burst_count > 0) by month',
      isExecutiveFinding: registryEntry.isExecutiveFinding,
      dataSource: 'live',
    };
    return baseInsight;
  } else {
    // ADOPTION VELOCITY LIFECYCLE: Without comparable periods, this
    // generator only has a cross-sectional snapshot, which duplicates
    // ai-adoption-rate-by-ide. Diagnostic until temporal data exists.
    return {
      id: registryEntry.id,
      title: 'AI adoption velocity requires comparable periods for period-over-period measurement',
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'diagnostic',
      presentationKind: 'diagnostic',
      comparisonMode: 'insufficient',
      isDiagnostic: true,
      diagnosticReason: 'NEEDS_COMPARABLE_PERIODS',
      recommendationState: 'monitor_only',
      current: highestData.adoptionRate,
      baseline: lowestData.adoptionRate,
      delta: adoptionGap,
      deltaPct: lowestData.adoptionRate > 0 ? ((highestData.adoptionRate - lowestData.adoptionRate) / lowestData.adoptionRate) * 100 : 0,
      rightMetric: formatPct(highestData.adoptionRate) + ' adoption',
      rightMetricLabel: 'AI Adoption Rate',
      confidence,
      coveragePct,
      n: totalSessions,
      hasData: true,
      description: 'AI adoption velocity requires comparable periods (e.g., month-over-month) to measure adoption trend. Currently only a cross-sectional snapshot is available, which is covered by ai-adoption-rate-by-ide.',
      evidence: [
        { metric: getCanonicalWorkflowIdentity(highestWorkflow), value: formatPct(highestData.adoptionRate), label: 'AI adoption rate' },
        { metric: getCanonicalWorkflowIdentity(lowestWorkflow), value: formatPct(lowestData.adoptionRate), label: 'AI adoption rate' },
        { metric: 'Sessions', value: totalSessions.toString(), label: 'Total sessions' }
      ],
      urgencyLabel: 'monitor',
      metricDefinition: 'Percentage of sessions with AI activity by month',
      isExecutiveFinding: registryEntry.isExecutiveFinding,
      dataSource: 'live',
    };
  }
}

// ============================================================
// CR4 FINAL — NEW GENERIC PI FAMILIES
// Validated across Local (7 months, 1855 sessions),
// Staging (6 weeks, 682 sessions), and Ed (7 weeks, 1811 sessions)
// ============================================================

/**
 * Helper: compute median of a numeric array
 */
function medianValue(vals: number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Generate within-workflow AI effect insight
 *
 * Compares AI-active vs non-AI sessions WITHIN the same workflow.
 * This is stronger than tool-vs-tool comparison because workflow is controlled.
 *
 * VALIDATED ACROSS ALL THREE DATASETS:
 * - Local: windsurf AI=772/NonAI=68, vscode AI=467/NonAI=81, cursor AI=226/NonAI=48
 * - Staging: devin AI=398/NonAI=183
 * - Ed: vscode AI=1074/NonAI=431
 *
 * Key finding: AI-active sessions consistently show 2-4x more active coding time
 * and higher active coding ratio than non-AI sessions within the same workflow.
 */
export function generateWithinWorkflowAIEffect(input: CanonicalInsightInput): CanonicalInsight[] | null {
  try {
    piDebugLog('[GENERATOR_WITHIN_WORKFLOW_AI][START]', 'Generating within-workflow-ai-effect per-workflow instances');
    const registryEntry = getCanonicalPIById('within-workflow-ai-effect');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'Within-workflow AI effect needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'ai_vs_non_ai',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Active Coding Time',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires sessions with both AI-assisted and non-AI sessions within the same workflow',
        description: 'No telemetry sessions available for within-workflow AI effect analysis.',
      }];
    }

    const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
    const workflowResults: Array<{
      workflow: string;
      aiCount: number;
      nonAiCount: number;
      aiMedActiveCoding: number;
      nonAiMedActiveCoding: number;
      aiMedDuration: number;
      nonAiMedDuration: number;
      aiMedRatio: number;
      nonAiMedRatio: number;
      deltaPct: number;
      aiMedTtfc: number | null;
      nonAiMedTtfc: number | null;
      aiTtfcN: number;
      nonAiTtfcN: number;
    }> = [];

    for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
      // CR-X P1B.2 S1: Mode-aware gating — delegated agents (Claude Code,
      // Devin, future agents) excluded from active-coding-based AI-vs-non-AI
      // comparison. active_coding_duration_ms is not semantically comparable
      // across operational modes. dataAccess.ts strips it for terminal surfaces.
      if (isDelegatedAgentWorkflow(workflow)) continue;

      // CR5 WS1.7: Use ONLY session_has_ai_activity (canonical authority).
      // No redundant ai_burst_count fallback — the derivation in
      // addDerivedSessionFields already uses ai_burst_count > 0.
      const aiActive = sessions.filter(s => s.session_has_ai_activity === true);
      const nonAi = sessions.filter(s => s.session_has_ai_activity === false);

      // Need at least 10 sessions in each cohort for a reliable comparison
      if (aiActive.length < 10 || nonAi.length < 10) continue;

      const aiActiveCoding = aiActive
        .map(s => s.session_active_coding_duration_minutes)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
      const nonAiActiveCoding = nonAi
        .map(s => s.session_active_coding_duration_minutes)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);

      if (aiActiveCoding.length < 10 || nonAiActiveCoding.length < 10) continue;

      const aiDuration = aiActive
        .map(s => s.session_duration_minutes)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
      const nonAiDuration = nonAi
        .map(s => s.session_duration_minutes)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);

      const aiMedAC = medianValue(aiActiveCoding);
      const nonAiMedAC = medianValue(nonAiActiveCoding);
      const aiMedDur = medianValue(aiDuration);
      const nonAiMedDur = medianValue(nonAiDuration);
      const aiMedRatio = aiMedDur > 0 ? aiMedAC / aiMedDur : 0;
      const nonAiMedRatio = nonAiMedDur > 0 ? nonAiMedAC / nonAiMedDur : 0;

      const deltaPct = nonAiMedAC > 0 ? ((aiMedAC - nonAiMedAC) / nonAiMedAC) * 100 : 0;

      // CR5 WS2 #14 P0-6b: Enrich with observed TTFC evidence.
      // Only compute if both cohorts have ≥10 observed-TTFC sessions.
      // ttfc_source === 'observed' is the provenance gate.
      const aiTtfcVals = aiActive
        .filter(s => s.ttfc_source === 'observed' &&
          typeof s.time_to_first_commit_ms === 'number' && Number.isFinite(s.time_to_first_commit_ms) && s.time_to_first_commit_ms > 0)
        .map(s => s.time_to_first_commit_ms / 60000);
      const nonAiTtfcVals = nonAi
        .filter(s => s.ttfc_source === 'observed' &&
          typeof s.time_to_first_commit_ms === 'number' && Number.isFinite(s.time_to_first_commit_ms) && s.time_to_first_commit_ms > 0)
        .map(s => s.time_to_first_commit_ms / 60000);
      const aiMedTtfc = aiTtfcVals.length >= 10 ? medianValue(aiTtfcVals) : null;
      const nonAiMedTtfc = nonAiTtfcVals.length >= 10 ? medianValue(nonAiTtfcVals) : null;

      workflowResults.push({
        workflow,
        aiCount: aiActive.length,
        nonAiCount: nonAi.length,
        aiMedActiveCoding: aiMedAC,
        nonAiMedActiveCoding: nonAiMedAC,
        aiMedDuration: aiMedDur,
        nonAiMedDuration: nonAiMedDur,
        aiMedRatio,
        nonAiMedRatio,
        deltaPct,
        aiMedTtfc,
        nonAiMedTtfc,
        aiTtfcN: aiTtfcVals.length,
        nonAiTtfcN: nonAiTtfcVals.length,
      });
    }

    if (workflowResults.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'Within-workflow AI effect needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'ai_vs_non_ai',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Active Coding Time',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires at least 10 AI-assisted sessions and 10 with non-AI sessions within the same workflow',
        description: 'No workflow has sufficient sessions with both AI-assisted and non-AI sessions for within-workflow comparison.',
      }];
    }

    // CR5 P1: Sort by total sample size descending — most evidence first
    workflowResults.sort((a, b) => (b.aiCount + b.nonAiCount) - (a.aiCount + a.nonAiCount));

    // CR5 P1: Produce one insight instance per eligible workflow.
    // Each instance has a unique ID (base__workflow) and unique renderOrder.
    // The frozen ai-vs-traditional card shows exactly 2 cohorts per card.
    const instances: CanonicalInsight[] = [];
    for (let i = 0; i < workflowResults.length; i++) {
      const wr = workflowResults[i];
      const wfName = getCanonicalWorkflowIdentity(wr.workflow).replace(' workflow', '');
      const deltaPct = Math.round(wr.deltaPct);
      const polarity = deltaPct > 0 ? 'higher_is_better' : 'lower_is_better';
      const ratio = wr.nonAiMedActiveCoding > 0 ? (wr.aiMedActiveCoding / wr.nonAiMedActiveCoding).toFixed(1) : '—';
      const totalN = wr.aiCount + wr.nonAiCount;

      // CR-X FINAL: Customer-facing title. The headline states the
      // engineering conclusion, not the implementation vocabulary.
      const medGap = wr.aiMedActiveCoding - wr.nonAiMedActiveCoding;
      const withinTitle = medGap > 0
        ? `${wfName} sessions with AI activity show ${medGap.toFixed(0)} minutes more active coding than sessions without it`
        : `${wfName} sessions with AI activity show ${Math.abs(medGap).toFixed(0)} minutes less active coding than sessions without it`;

      instances.push({
        id: `${registryEntry.id}__${wr.workflow}`,
        title: withinTitle,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder + i / 100, // CR5 P1.2 P5: Preserve family ordering, unique per instance
        presentationType: 'comparison',
        presentationKind: 'cohort_comparison',
        comparisonMode: 'ai_vs_non_ai',
        comparisonState: 'ai_non_ai_comparable',
        current: wr.aiMedActiveCoding,
        baseline: wr.nonAiMedActiveCoding,
        delta: wr.aiMedActiveCoding - wr.nonAiMedActiveCoding,
        deltaPct,
        displayValue: `${wr.aiMedActiveCoding.toFixed(1)} min`,
        displayDeltaPct: `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`,
        rightMetric: `${wr.nonAiMedActiveCoding.toFixed(1)} min`,
        rightMetricLabel: 'Zero AI-assisted median',
        polarity,
        confidence: totalN >= 100 ? 'high' : 'medium',
        coveragePct: coveragePct1dp(totalN, sessionRows.length),
        n: totalN,
        hasData: true,
        description: `Within ${wfName}, AI-assisted sessions (N=${wr.aiCount}) show ${wr.aiMedActiveCoding.toFixed(1)} min median active coding vs ${wr.nonAiMedActiveCoding.toFixed(1)} min for non-AI sessions (N=${wr.nonAiCount}). Focus ratio: ${formatPct(wr.aiMedRatio * 100)} (AI-assisted) vs ${formatPct(wr.nonAiMedRatio * 100)} (non-AI sessions). Session duration: ${wr.aiMedDuration.toFixed(1)} min (AI-assisted) vs ${wr.nonAiMedDuration.toFixed(1)} min (non-AI sessions).${wr.aiMedTtfc !== null && wr.nonAiMedTtfc !== null ? ` TTFC: ${wr.aiMedTtfc.toFixed(1)} min (AI-assisted, N=${wr.aiTtfcN}) vs ${wr.nonAiMedTtfc.toFixed(1)} min (non-AI sessions, N=${wr.nonAiTtfcN}).` : ''} Association, not causal claim.`,
        recommendation: `Compare task mix, session duration, and interruption patterns between AI-assisted and non-AI sessions in ${wfName} before treating the gap as a productivity effect.`,
        executiveSummary: `${wfName}: AI-assisted sessions show ${ratio}x more active coding than non-AI sessions (${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%, N=${totalN}).`,
        evidence: [
          { metric: 'Observed AI signals', value: `${wr.aiMedActiveCoding.toFixed(1)} min`, label: `${wfName} AI-assisted (N=${wr.aiCount})` },
          { metric: 'Zero AI-assisted', value: `${wr.nonAiMedActiveCoding.toFixed(1)} min`, label: `${wfName} non-AI sessions (N=${wr.nonAiCount})` },
          { metric: 'Focus ratio (AI-assisted)', value: formatPct(wr.aiMedRatio * 100), label: 'Observed AI signals' },
          { metric: 'Focus ratio (non-AI sessions)', value: formatPct(wr.nonAiMedRatio * 100), label: 'Zero AI-assisted' },
          // CR5 WS2 #14 P0-6b: Enrich with observed TTFC evidence where both cohort Ns pass.
          ...(wr.aiMedTtfc !== null && wr.nonAiMedTtfc !== null ? [
            { metric: 'TTFC (AI-assisted)', value: `${wr.aiMedTtfc.toFixed(1)} min`, label: `${wfName} AI-assisted (N=${wr.aiTtfcN})` },
            { metric: 'TTFC (non-AI sessions)', value: `${wr.nonAiMedTtfc.toFixed(1)} min`, label: `${wfName} non-AI sessions (N=${wr.nonAiTtfcN})` },
          ] : []),
        ],
        breakdownByTool: {
          [`${wr.workflow}_ai`]: { value: wr.aiMedActiveCoding, count: wr.aiCount, formatted: `${wr.aiMedActiveCoding.toFixed(1)} min`, label: `${wfName} AI-assisted (${wr.aiCount})` },
          [`${wr.workflow}_nonai`]: { value: wr.nonAiMedActiveCoding, count: wr.nonAiCount, formatted: `${wr.nonAiMedActiveCoding.toFixed(1)} min`, label: `${wfName} non-AI sessions (${wr.nonAiCount})` },
        },
        selectedComparison: {
          leaderKey: `${wr.workflow}_ai`,
          baselineKey: `${wr.workflow}_nonai`,
        },
        whatChanged: `Observed AI signals vs non-AI sessions comparison within ${wfName}`,
        whyItMatters: `Within-workflow comparison controls for tool differences, isolating the observed AI signal effect within a single workflow.`,
        operationalImpact: `${wfName} AI-assisted sessions show ${ratio}x more active coding per session. The effect is ${deltaPct > 100 ? 'substantial' : 'moderate'} in magnitude.`,
        cohort: `${wfName} (AI-assisted=${wr.aiCount}, non-AI sessions=${wr.nonAiCount})`,
        confidenceReasoning: `Median-based comparison within ${wfName}. Sample sizes: AI-assisted=${wr.aiCount}, non-AI sessions=${wr.nonAiCount}.`,
        operationalRead: `${wfName}: AI-assisted ${wr.aiMedActiveCoding.toFixed(1)}min vs non-AI sessions ${wr.nonAiMedActiveCoding.toFixed(1)}min (${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%). Focus: ${formatPct(wr.aiMedRatio * 100)} vs ${formatPct(wr.nonAiMedRatio * 100)}.`,
        urgencyLabel: 'monitor',
        metricDefinition: 'Median active coding minutes per session, AI-assisted vs non-AI sessions within a single workflow',
        isExecutiveFinding: registryEntry.isExecutiveFinding,
        dataSource: 'live',
      });
    }

    return instances;
  } catch (err) {
    piDebugLog('[GENERATOR_WITHIN_WORKFLOW_AI][ERROR]', err);
    return null;
  }
}

/**
 * Generate AI intensity cohort analysis insight
 *
 * Groups sessions within a single workflow into non-AI / low / medium / high
 * AI intensity cohorts based on ai_burst_count, then compares active coding
 * time, session duration, active coding ratio, and file save activity.
 *
 * VALIDATED ACROSS ALL THREE DATASETS:
 * - Local (windsurf): non-AI→high shows 10.9m→50.8m duration, 20%→52% AC ratio
 * - Staging (devin): non-AI→high shows 11.7m→40.4m duration, 25%→56% AC ratio
 * - Ed (vscode): non-AI→high shows 10.9m→25.2m duration, 19%→42% AC ratio
 *
 * Key finding: Higher AI intensity correlates with longer sessions AND higher
 * active coding ratio — a nonlinear relationship that is more useful than
 * a simple AI adoption percentage.
 */
export function generateAIIntensityCohortAnalysis(input: CanonicalInsightInput): CanonicalInsight[] | null {
  try {
    piDebugLog('[GENERATOR_AI_INTENSITY_COHORT][START]', 'Generating ai-intensity-cohort-analysis per-workflow instances');
    const registryEntry = getCanonicalPIById('ai-intensity-cohort-analysis');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'AI intensity cohort analysis needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Active Coding Ratio',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires sessions with varying AI intensity (ai_burst_count) within a workflow',
        description: 'No telemetry sessions available for AI intensity cohort analysis.',
      }];
    }

    const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
    const COHORT_BOUNDS = [
      { band: 'non-AI', lo: 0, hi: 0 },
      { band: 'low', lo: 1, hi: 3 },
      { band: 'medium', lo: 4, hi: 10 },
      { band: 'high', lo: 11, hi: Infinity },
    ];

    // CR5 P1: Produce one insight instance per eligible workflow.
    // Each instance shows that workflow's 4 cohorts (non-AI/low/medium/high).
    const allWorkflowCohorts: Array<{
      workflow: string;
      cohorts: Array<{ band: string; count: number; medAC: number; medDur: number; medRatio: number; medSaves: number | null; saveN: number }>;
    }> = [];

    for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
      // CR-X P1B.2 S1: Mode-aware — delegated agents use session_duration_minutes
      // as the primary metric when active_coding_duration_minutes is unavailable.
      // This generalizes to any future delegated agent, not just Claude Code.
      const isAgentWorkflow = isDelegatedAgentWorkflow(workflow);

      const cohorts = COHORT_BOUNDS.map(({ band, lo, hi }) => {
        const cohort = sessions.filter(s => {
          // CR-X Pass 3: Zero is measured data, not missing. Only
          // undefined/null/NaN is missing. Sessions with missing
          // ai_burst_count are excluded from all cohorts, not defaulted to 0.
          if (typeof s.ai_burst_count !== 'number' || !Number.isFinite(s.ai_burst_count)) return false;
          return s.ai_burst_count >= lo && s.ai_burst_count <= hi;
        });
        if (cohort.length < 5) return { band, count: 0, medAC: 0, medDur: 0, medRatio: 0, medSaves: null, saveN: 0 };

        const acVals = cohort
          .map(s => s.session_active_coding_duration_minutes)
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
        const durVals = cohort
          .map(s => s.session_duration_minutes)
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);

        // CR5 WS2 #14 P0-6: Enrich with file-save evidence (file_save_count).
        // file_save_count is a save event count, NOT distinct files edited.
        // Only compute if at least 5 sessions in the cohort have measured saves.
        const saveVals = cohort
          .map(s => s.file_save_count)
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);
        const medSaves = saveVals.length >= 5 ? medianValue(saveVals) : null;

        const medAC = medianValue(acVals);
        const medDur = medianValue(durVals);
        const medRatio = medDur > 0 && medAC > 0 ? medAC / medDur : 0;
        return { band, count: cohort.length, medAC, medDur, medRatio, medSaves, saveN: saveVals.length };
      }).filter(c => c.count >= 5);

      if (cohorts.length >= 3) {
        allWorkflowCohorts.push({ workflow, cohorts });
      }
    }

    allWorkflowCohorts.sort((a, b) =>
      b.cohorts.reduce((sum, c) => sum + c.count, 0) - a.cohorts.reduce((sum, c) => sum + c.count, 0)
    );

    if (allWorkflowCohorts.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'AI intensity cohort analysis needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Active Coding Ratio',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires at least 3 AI intensity cohorts with 5+ sessions each within a workflow',
        description: 'No workflow has sufficient AI intensity variation for cohort analysis.',
      }];
    }

    // CR5 P1: Produce one insight per eligible workflow.
    // Each card shows exactly that workflow's cohorts — no cross-workflow overstuffing.
    // CR-X 1A.6B: Agent workflows (Claude Code) use session_duration_minutes as
    // the primary metric when active_coding_duration_minutes is unavailable.
    // IDE workflows preserve existing active-coding/focus semantics exactly.
    const instances: CanonicalInsight[] = [];
    for (let i = 0; i < allWorkflowCohorts.length; i++) {
      const wfc = allWorkflowCohorts[i];
      const wfName = getCanonicalWorkflowIdentity(wfc.workflow).replace(' workflow', '');
      const nonAi = wfc.cohorts.find(c => c.band === 'non-AI');
      const high = wfc.cohorts.find(c => c.band === 'high');
      const totalN = wfc.cohorts.reduce((sum, c) => sum + c.count, 0);

      // CR-X 1A.6B: Detect whether this workflow has active-coding evidence.
      // Agent workflows (Claude Code) have active_coding_duration_ms = 0/null
      // by design — use session_duration_minutes as the primary metric instead.
      const hasActiveCoding = wfc.cohorts.some(c => c.medAC > 0);
      // CR-X P1B.2 S1: Mode-aware — any delegated agent uses runtime, not active-coding.
      const isAgentWorkflow = isDelegatedAgentWorkflow(wfc.workflow) || !hasActiveCoding;

      // CR-X 1A.6B: For agent workflows, use "non-AI sessions" instead
      // of "non-AI" for the zero-burst cohort. Claude Code is AI-native; zero
      // ai_burst_count means zero observed AI-authored file-edit signals, not
      // absence of AI interaction.
      const zeroLabel = isAgentWorkflow ? 'non-AI sessions' : 'non-AI sessions';

      if (isAgentWorkflow) {
        // === AGENT WORKFLOW PATH (duration-based) ===
        const durRatioNum = nonAi && high && nonAi.medDur > 0 ? (high.medDur / nonAi.medDur) : 0;
        const durRatio = durRatioNum > 0 ? durRatioNum.toFixed(1) : '—';
        // CR-X 2026-08-30 P0-3: Bimodal observed session-runtime modes.
        // When the duration ratio between zero-signal and high-signal cohorts
        // is material (>5x), this is a decision-grade finding about observed
        // session-runtime modes. Uses observational language only — does NOT
        // claim sessions are unattended, autonomous, or that AI causes longer
        // sessions. Describes what is observed, not inferred intent.
        const isBimodalMaterial = durRatioNum >= 5;

        const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
        for (const c of wfc.cohorts) {
          const bandLabel = c.band === 'non-AI' ? 'Zero AI-assisted' : `${c.band.charAt(0).toUpperCase() + c.band.slice(1)} AI-signal intensity`;
          breakdownByTool[`${wfc.workflow}_${c.band}`] = {
            value: c.medDur,
            count: c.count,
            formatted: `${c.medDur.toFixed(1)} min duration`,
            label: `${wfName} · ${bandLabel} (${c.count})`,
          };
        }

        instances.push({
          id: `${registryEntry.id}__${wfc.workflow}`,
          title: isBimodalMaterial
            ? `${wfName} shows distinct session-runtime modes: ${high?.medDur.toFixed(0) ?? '—'} min median for high-signal sessions vs ${nonAi?.medDur.toFixed(0) ?? '—'} min for ${zeroLabel} (${durRatio}x)`
            : `High-signal ${wfName} sessions have a ${high?.medDur.toFixed(0) ?? '—'} min median duration vs ${nonAi?.medDur.toFixed(0) ?? '—'} min for ${zeroLabel}`,
          cicdStage: registryEntry.stage,
          canonicalPriority: registryEntry.canonicalPriority,
          renderOrder: registryEntry.renderOrder + i / 100,
          presentationType: 'comparison',
          presentationKind: 'cohort_comparison',
          comparisonMode: 'absolute',
          comparisonState: 'workflow_comparable',
          current: high?.medDur ?? 0,
          baseline: nonAi?.medDur ?? 0,
          delta: (high?.medDur ?? 0) - (nonAi?.medDur ?? 0),
          deltaPct: nonAi && nonAi.medDur > 0 && high ? Math.round(((high.medDur - nonAi.medDur) / nonAi.medDur) * 100) : 0,
          displayValue: `${high?.medDur.toFixed(0) ?? '—'} min`,
          displayDeltaPct: nonAi && high ? `${high.medDur > nonAi.medDur ? '+' : ''}${Math.round(((high.medDur - nonAi.medDur) / nonAi.medDur) * 100)}%` : '—',
          rightMetric: `${nonAi?.medDur.toFixed(0) ?? '—'} min`,
          rightMetricLabel: `${zeroLabel} baseline`,
          polarity: 'neutral',
          confidence: totalN >= 100 ? 'high' : 'medium',
          coveragePct: coveragePct1dp(totalN, sessionRows.length),
          n: totalN,
          hasData: true,
          description: `Within ${wfName}, AI-signal intensity shows a duration gradient: ${wfc.cohorts.map(c => `${c.band === 'non-AI' ? zeroLabel : c.band}=${c.medDur.toFixed(1)}min (N=${c.count})`).join(', ')}. Duration ${durRatio}x from ${zeroLabel} to high. This describes observed session-runtime modes, not productivity, delivery impact, or developer intent. Session duration is observed session runtime, not active-coding time.`,
          recommendation: isBimodalMaterial
            ? `${wfName} shows distinct observed session-runtime modes: short ${zeroLabel} sessions (${nonAi?.medDur.toFixed(0)}min median) vs long high-signal sessions (${high?.medDur.toFixed(0)}min median). The ${durRatio}x ratio is a structural observation about how session runtime correlates with AI-signal intensity. This does not imply sessions are unattended or autonomous — it describes what was observed.`
            : `Compare task complexity and session context across ${wfName} intensity cohorts. The duration gradient is an observation about session-runtime modes, not a claim about productivity or developer intent.`,
          executiveSummary: `${wfName} AI-signal intensity gradient: ${wfc.cohorts.map(c => `${c.band === 'non-AI' ? zeroLabel : c.band}=${c.medDur.toFixed(0)}min`).join(' → ')} median duration. ${durRatio}x from ${zeroLabel} to high.`,
          evidence: wfc.cohorts.map(c => ({
            metric: `${c.band === 'non-AI' ? zeroLabel : c.band} (N=${c.count})`,
            value: `${c.medDur.toFixed(1)} min duration`,
            label: `${c.band === 'non-AI' ? 'Zero AI signals' : `${c.band} intensity`}`,
          })),
          breakdownByTool,
          selectedComparison: {
            leaderKey: `${wfc.workflow}_${high?.band ?? 'high'}`,
            baselineKey: `${wfc.workflow}_${nonAi?.band ?? 'non-AI'}`,
          },
          whatChanged: `AI-signal intensity cohort gradient within ${wfName} (${wfc.cohorts.length} cohorts, N=${totalN})`,
          whyItMatters: isBimodalMaterial
            ? `Distinct observed session-runtime modes: ${wfName} sessions split into short ${zeroLabel} (${nonAi?.medDur.toFixed(0)}min) and long high-signal (${high?.medDur.toFixed(0)}min) cohorts. The ${durRatio}x ratio is a structural observation about how session runtime correlates with AI-signal intensity. This does not imply sessions are unattended, autonomous, or that AI causes longer sessions.`
            : `Within-workflow intensity gradient reveals whether AI-signal activity correlates with longer observed session runtime. This is workflow shape, not productivity.`,
          operationalImpact: `${wfName} high-signal sessions show ${durRatio}x median observed runtime vs ${zeroLabel}.`,
          cohort: `${wfName} (${wfc.cohorts.map(c => `${c.band === 'non-AI' ? zeroLabel : c.band}=${c.count}`).join(', ')})`,
          confidenceReasoning: `Cohort analysis with 5+ sessions per band within ${wfName}. Total N=${totalN}. Median-based. Duration metric (active coding not instrumented for agent workflows).`,
          operationalRead: `${wfName}: ${wfc.cohorts.map(c => `${c.band === 'non-AI' ? zeroLabel : c.band} ${c.medDur.toFixed(1)}min`).join(' | ')}`,
          urgencyLabel: isBimodalMaterial ? 'investigate' : 'monitor',
          recommendationState: isBimodalMaterial ? 'investigate' : 'monitor_only',
          // CR-X 2026-08-30: Distinct session-runtime modes are decision-grade when material
          lifecycleClass: isBimodalMaterial ? 'decision' : 'contextual',
          metricDefinition: 'Session duration minutes by AI-signal intensity cohort (zero observed signals/low/medium/high) within a single agent workflow. Duration is observed session runtime, not active-coding time.',
          isExecutiveFinding: registryEntry.isExecutiveFinding,
          dataSource: 'live',
        });
      } else {
        // === IDE WORKFLOW PATH (active-coding/focus-based, unchanged) ===
        const acRatio = nonAi && high && nonAi.medAC > 0 ? (high.medAC / nonAi.medAC).toFixed(1) : '—';
        const focusDelta = nonAi && high ? (high.medRatio - nonAi.medRatio) * 100 : 0;

        const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
        for (const c of wfc.cohorts) {
          const bandLabel = c.band === 'non-AI' ? 'Zero AI-assisted' : `${c.band.charAt(0).toUpperCase() + c.band.slice(1)} AI intensity`;
          breakdownByTool[`${wfc.workflow}_${c.band}`] = {
            value: c.medAC,
            count: c.count,
            formatted: `${c.medAC.toFixed(1)} min / ${formatPct(c.medRatio * 100)} focus`,
            label: `${wfName} · ${bandLabel} (${c.count})`,
          };
        }

        // CR5 FINAL TITLE DOCTRINE: High vs non-AI pp gap as headline.
        // Do NOT say AI "improves", "causes", or "drives" focus.
        const focusGapPp = nonAi && high ? (high.medRatio - nonAi.medRatio) * 100 : 0;
        instances.push({
          id: `${registryEntry.id}__${wfc.workflow}`,
          title: `High-intensity ${wfName} sessions show ${focusGapPp.toFixed(1)}pp higher focus ratio than non-AI sessions`,
          cicdStage: registryEntry.stage,
          canonicalPriority: registryEntry.canonicalPriority,
          renderOrder: registryEntry.renderOrder + i / 100, // CR5 P1.2 P5: Preserve family ordering
          presentationType: 'comparison',
          presentationKind: 'cohort_comparison',
          comparisonMode: 'absolute',
          comparisonState: 'workflow_comparable',
          current: high?.medAC ?? 0,
          baseline: nonAi?.medAC ?? 0,
          delta: (high?.medAC ?? 0) - (nonAi?.medAC ?? 0),
          deltaPct: nonAi && nonAi.medAC > 0 && high ? Math.round(((high.medAC - nonAi.medAC) / nonAi.medAC) * 100) : 0,
          displayValue: `${high?.medAC.toFixed(1) ?? '—'} min`,
          displayDeltaPct: nonAi && high ? `${high.medAC > nonAi.medAC ? '+' : ''}${Math.round(((high.medAC - nonAi.medAC) / nonAi.medAC) * 100)}%` : '—',
          rightMetric: `${nonAi?.medAC.toFixed(1) ?? '—'} min`,
          rightMetricLabel: 'Non-AI baseline',
          polarity: 'higher_is_better',
          confidence: totalN >= 100 ? 'high' : 'medium',
          coveragePct: coveragePct1dp(totalN, sessionRows.length),
          n: totalN,
          hasData: true,
          description: `Within ${wfName}, AI intensity shows a monotonic gradient: ${wfc.cohorts.map(c => `${c.band === 'non-AI' ? zeroLabel : c.band}=${c.medAC.toFixed(1)}min/${formatPct(c.medRatio * 100)}focus (N=${c.count})`).join(', ')}. Active coding ${acRatio}x from ${zeroLabel} to high. Focus ratio +${focusDelta.toFixed(0)}pp.${wfc.cohorts.some(c => c.medSaves !== null) ? ` File saves/session: ${wfc.cohorts.filter(c => c.medSaves !== null).map(c => `${c.band === 'non-AI' ? zeroLabel : c.band}=${c.medSaves!.toFixed(1)}`).join(', ')}.` : ''} Association, not causal claim.`,
          recommendation: `Compare task complexity and session intent across ${wfName} intensity cohorts. Higher-intensity sessions may reflect harder problems, not AI causing better focus.`,
          executiveSummary: `${wfName} AI intensity gradient: ${wfc.cohorts.map(c => `${c.band === 'non-AI' ? zeroLabel : c.band}=${formatPct(c.medRatio * 100)}`).join(' → ')} focus ratio. ${acRatio}x active coding from ${zeroLabel} to high.`,
          evidence: [
            ...wfc.cohorts.map(c => ({
              metric: `${c.band} (N=${c.count})`,
              value: `${c.medAC.toFixed(1)} min AC, ${formatPct(c.medRatio * 100)} focus`,
              label: `${c.band} intensity`,
            })),
            // CR5 WS2 #14 P0-6: Enrich with file-save evidence where measured gates pass.
            // file_save_count = save events, NOT distinct files edited.
            ...wfc.cohorts
              .filter(c => c.medSaves !== null)
              .map(c => ({
                metric: `${c.band} file saves (N=${c.saveN})`,
                value: `${c.medSaves!.toFixed(1)} saves/session`,
                label: `${c.band} save activity`,
              })),
          ],
          breakdownByTool,
          selectedComparison: {
            leaderKey: `${wfc.workflow}_${high?.band ?? 'high'}`,
            baselineKey: `${wfc.workflow}_${nonAi?.band ?? 'non-AI'}`,
          },
          whatChanged: `AI intensity cohort gradient within ${wfName} (${wfc.cohorts.length} cohorts, N=${totalN})`,
          whyItMatters: `Within-workflow intensity gradient reveals whether AI usage enables deeper focus within a single tool context.`,
          operationalImpact: `${wfName} high-intensity sessions show ${acRatio}x active coding and +${focusDelta.toFixed(0)}pp focus ratio vs ${zeroLabel}.`,
          cohort: `${wfName} (${wfc.cohorts.map(c => `${c.band}=${c.count}`).join(', ')})`,
          confidenceReasoning: `Cohort analysis with 5+ sessions per band within ${wfName}. Total N=${totalN}. Median-based.`,
          operationalRead: `${wfName}: ${wfc.cohorts.map(c => `${c.band} ${c.medAC.toFixed(1)}min/${formatPct(c.medRatio * 100)}`).join(' | ')}`,
          urgencyLabel: 'monitor',
          metricDefinition: 'Active coding minutes and ratio by AI intensity cohort (non-AI/low/medium/high) within a single workflow',
          isExecutiveFinding: registryEntry.isExecutiveFinding,
          dataSource: 'live',
        });
      }
    }

    return instances;
  } catch (err) {
    piDebugLog('[GENERATOR_AI_INTENSITY_COHORT][ERROR]', err);
    return null;
  }
}

/**
 * Normalize a git_repo_url to a canonical repository identity.
 *
 * Collapses common URL aliases that refer to the same repository:
 * - HTTPS vs SSH/SCP transport
 * - HTTPS username variants (e.g. https://user@github.com/...)
 * - .git suffix present vs absent
 * - Azure DevOps URLs (normalized to azure:org/repo)
 *
 * Returns null for empty/invalid input. Does NOT mutate stored telemetry —
 * normalization is applied at PI generation time only.
 *
 * CR-X 1A.6B: This is the single repo normalization authority for the PI
 * engine. Do not create a second normalization system.
 */
// CR-X F: normalizeRepoUrl is now imported from the shared utility
// (frontend/src/lib/repoNormalization.ts). Re-export for backward compatibility.
export { normalizeRepoUrl };

/**
 * Generate repository concentration insight
 *
 * Analyzes session concentration by git_repo_url — what share of sessions
 * are in the top repositories, and how workflows are distributed across repos.
 *
 * CR-X 1A.6B: Repository identity is normalized via normalizeRepoUrl() before
 * counting. This collapses HTTPS/SSH/SCP aliases, username variants, and .git
 * suffix differences that previously inflated the distinct repo count.
 *
 * VALIDATED:
 * - Local: 18 repos, top 2 repos = 85.7% of sessions
 * - Staging: 2 repos, top 2 = 99.7%
 * - Ed: 34 repos (normalized from 41 raw URLs), top 2 = 37.5%
 *
 * Uses sanitized labels (Top Repository, Repository B, etc.) to avoid
 * exposing private repo names in demo-facing UI.
 */
export function generateRepositoryConcentration(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    piDebugLog('[GENERATOR_REPO_CONCENTRATION][START]', 'Generating repository-concentration');
    const registryEntry = getCanonicalPIById('repository-concentration');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length === 0) {
      return {
        id: registryEntry.id,
        title: 'Repository concentration needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Session Share',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires sessions with git_repo_url attribution',
        description: 'No telemetry sessions available for repository concentration analysis.',
      };
    }

    // Count sessions by repo (normalized identity)
    // CR-X 1A.6B: Use normalizeRepoUrl() to collapse URL aliases before counting.
    const repoCounts: Record<string, number> = {};
    const repoAiCounts: Record<string, number> = {};
    const repoWorkflows: Record<string, Record<string, number>> = {};
    let totalWithRepo = 0;

    for (const s of sessionRows) {
      const repo = normalizeRepoUrl(s.git_repo_url);
      // Skip placeholder/invalid identities — they would render as blank or
      // garbage labels in concentration titles and evidence.
      if (!repo || !isRenderableRepoLabel(repo)) continue;
      totalWithRepo++;
      repoCounts[repo] = (repoCounts[repo] || 0) + 1;
      // CR5 WS1.7: Use ONLY session_has_ai_activity (canonical authority)
      if (s.session_has_ai_activity === true) {
        repoAiCounts[repo] = (repoAiCounts[repo] || 0) + 1;
      }
      const wf = normalizeToCanonicalToolId(s.tool ?? s.session_source ?? s.editor_source ?? s.source ?? 'unknown');
      if (!repoWorkflows[repo]) repoWorkflows[repo] = {};
      repoWorkflows[repo][wf] = (repoWorkflows[repo][wf] || 0) + 1;
    }

    if (totalWithRepo < 10) {
      return {
        id: registryEntry.id,
        title: 'Repository concentration needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Session Share',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires at least 10 sessions with git_repo_url attribution',
        description: 'Insufficient sessions with repository attribution for concentration analysis.',
      };
    }

    // Sort repos by session count
    const sortedRepos = Object.entries(repoCounts).sort((a, b) => b[1] - a[1]);
    const totalRepos = sortedRepos.length;
    const topRepo = sortedRepos[0];
    // CR5 P0.7: Store shares as PERCENT (0-100), not decimal (0-1).
    // formatPct expects values already in percent form.
    const top2Share = (sortedRepos.slice(0, 2).reduce((sum, [, c]) => sum + c, 0) / totalWithRepo) * 100;
    const top5Share = (sortedRepos.slice(0, 5).reduce((sum, [, c]) => sum + c, 0) / totalWithRepo) * 100;

    // CR5 P1.5 P0: Display names are the normalized repo identity (owner/repo).
    // CR-X 1A.6B: repo keys are already normalized by normalizeRepoUrl().
    // No more demo sanitization — the authenticated org dashboard has the repo names.

    // CR5 P1.5 P0.1: breakdownByTool must contain ALL attributed repos, not just top 5.
    // The presentation layer collapses them visually to top-2 + other.
    const allReposData = sortedRepos.map(([repo, count], i) => {
      const aiCount = repoAiCounts[repo] || 0;
      const aiShare = count > 0 ? (aiCount / count) * 100 : 0;
      const workflows = Object.entries(repoWorkflows[repo] || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([wf, c]) => `${getCanonicalWorkflowIdentity(wf)}=${c}`)
        .join(', ');
      return {
        label: repoDisplayLabel(repo),
        count,
        share: (count / totalWithRepo) * 100,
        aiShare,
        workflows,
      };
    });

    // Keep topReposData for evidence (top 5 for evidence band)
    const topReposData = allReposData.slice(0, 5);

    // CR5 P0.7: top2Share is now in percent form (0-100)
    const concentrationLevel = top2Share > 80 ? 'high' : top2Share > 50 ? 'moderate' : 'distributed';
    const topRepoShare = (topRepo[1] / totalWithRepo) * 100;

    const evidence = topReposData.map(r => ({
      metric: r.label,
      value: `${formatPct(r.share)} of sessions (${r.count})`,
      label: `${r.aiShare > 0 ? formatPct(r.aiShare) + ' AI-assisted' : 'non-AI sessions'}, ${r.workflows}`,
    }));

    // CR5 P1.5 P0.1: breakdownByTool contains ALL attributed repos (not just top 5).
    // The presentation layer collapses them to top-2 + other.
    const breakdownByTool: any = {};
    for (const r of allReposData) {
      breakdownByTool[r.label] = {
        value: r.share,
        count: r.count,
        formatted: `${formatPct(r.share)} (${r.count} sessions)`,
        label: r.label,
      };
    }

    const baseInsight: CanonicalInsight = {
      id: registryEntry.id,
      title: concentrationLevel === 'distributed'
        ? `Sessions span ${totalRepos} repositories with no material concentration (top-2 = ${formatPct(top2Share)})`
        : concentrationLevel === 'moderate'
          ? `Top 2 repositories account for ${formatPct(top2Share)} of attributed sessions across ${totalRepos} repos`
          : `${formatPct(top2Share)} of attributed sessions are concentrated in 2 repositories`,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      // CR5 P0.8: Org-level summary metric
      presentationKind: 'org_summary',
      comparisonMode: 'absolute',
      // CR4 P0-3: Explicit org-level flag — prevents renderAdapter from
      // manufacturing leader/runner-up/workflow ranking for this insight.
      isOrgLevelMetric: true,
      // CR-X P0-3: Expose concentrationLevel so the renderer can branch
      concentrationLevel,
      current: top2Share,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      // CR5 P0.5: displayValue must match its label. The primary metric is
      // repository count, not concentration share. The share is evidence.
      displayValue: `${totalRepos} repos`,
      displayDeltaPct: '—',
      rightMetric: formatPct(top2Share),
      rightMetricLabel: 'Top-2 concentration',
      polarity: concentrationLevel === 'distributed' ? 'neutral' : 'lower_is_better',
      confidence: totalWithRepo >= 100 ? 'high' : 'medium',
      coveragePct: coveragePct1dp(totalWithRepo, sessionRows.length),
      n: totalWithRepo,
      hasData: true,
      description: `${totalRepos} repositories tracked across ${totalWithRepo} repo-attributed sessions (canonical population: ${sessionRows.length}). Top repository: ${topReposData[0].label} (${formatPct(topRepoShare)}). Top 2 = ${formatPct(top2Share)}. ${topReposData[0].workflows}.`,
      recommendation: concentrationLevel === 'distributed'
        ? `Sessions are broadly distributed across ${totalRepos} repositories (top-2 = ${formatPct(top2Share)}). No concentration concern. Continue monitoring for shifts in workflow mix.`
        : `${formatPct(top2Share)} of attributed sessions are concentrated in two repositories. Confirm whether this concentration matches current engineering priorities. If not, inspect whether instrumentation coverage or project allocation is skewing the observed workflow mix.`,
      executiveSummary: `${totalRepos} repos tracked. Top 2 = ${formatPct(top2Share)} of ${totalWithRepo} attributed sessions.`,
      evidence,
      breakdownByTool,
      whatChanged: `Repository concentration: ${formatPct(top2Share)} of ${totalWithRepo} attributed sessions in top 2 repos across ${totalRepos} repositories.`,
      whyItMatters: concentrationLevel === 'distributed'
        ? `A distributed repository footprint (${totalRepos} repos, top-2 = ${formatPct(top2Share)}) is an observational summary, not a concentration risk.`
        : `${formatPct(top2Share)} of attributed sessions are concentrated in two repositories. This is an observational summary, not a risk indicator. Confirm whether this matches current engineering priorities.`,
      operationalImpact: concentrationLevel === 'distributed'
        ? `Top-2 share is ${formatPct(top2Share)}; activity is spread across ${totalRepos} tracked repositories.`
        : `${formatPct(top2Share)} of sessions in top 2 repos. ${topReposData[0].label} has ${topReposData[0].count} sessions (${formatPct(topReposData[0].aiShare)} AI-assisted).`,
      cohort: `${totalRepos} repos, ${totalWithRepo} attributed sessions`,
      confidenceReasoning: `Repository attribution from git_repo_url field. ${totalWithRepo}/${sessionRows.length} sessions have repo attribution (${coveragePct1dp(totalWithRepo, sessionRows.length)}% coverage).`,
      operationalRead: `${totalRepos} repos. Top: ${topReposData.map(r => `${r.label}=${formatPct(r.share)}`).join(', ')}.`,
      urgencyLabel: concentrationLevel === 'high' ? 'investigate' : 'informational',
      metricDefinition: 'Share of sessions in top repositories by git_repo_url attribution',
      isExecutiveFinding: registryEntry.isExecutiveFinding,
      dataSource: 'live',
    };

    return baseInsight;
  } catch (err) {
    piDebugLog('[GENERATOR_REPO_CONCENTRATION][ERROR]', err);
    return null;
  }
}

/**
 * CR5 P1: Generate commits-per-session-by-ide insight
 *
 * Compares median commits per session across primary workflows.
 * Census evidence: Cursor 5.0 vs VS Code 1.0 (5x ratio, N=272/404).
 */
export function generateCommitsPerSessionByIDE(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    const registryEntry = getCanonicalPIById('commits-per-session-by-ide');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    const isStressMode = isStressModeEnabled();

    if (!isStressMode && sessionRows.length < 30) return null;

    const sessionsByIDE = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
    const commitData: Record<string, { medianCommits: number; validSessions: number; total: number }> = {};

    for (const [ide, sessions] of Object.entries(sessionsByIDE)) {
      if (sessions.length === 0) continue;
      // CR5 WS2 #14 P0-2b: Harden provenance predicate to observed-only.
      // Uses session_commits_source === 'observed' + session_commits (not
      // commit_count which includes synthetic/fallback values).
      // NOTE: This generator is NOT activated in the runtime generator set.
      // This hardening ensures correctness if it is ever re-enabled.
      const validSessions = sessions.filter(s =>
        s.session_commits_source === 'observed' &&
        typeof s.session_commits === 'number' && Number.isFinite(s.session_commits)
      );
      if (validSessions.length === 0) continue;

      const commits = validSessions.map(s => s.session_commits).sort((a, b) => a - b);
      const median = commits[Math.floor(commits.length / 2)];

      commitData[ide] = { medianCommits: median, validSessions: validSessions.length, total: sessions.length };
    }

    const entries = Object.entries(commitData).filter(([_, d]) => isStressMode || d.validSessions >= 10);
    if (entries.length < 2) {
      piDebugLog('[GENERATOR_COMMITS_PER_SESSION][INSUFFICIENT_IDE_DATA]', { entries });
      return null;
    }

    entries.sort((a, b) => b[1].medianCommits - a[1].medianCommits);
    const [leaderIDE, leaderData] = entries[0];
    const [trailerIDE, trailerData] = entries[entries.length - 1];
    const gap = leaderData.medianCommits - trailerData.medianCommits;
    const ratio = trailerData.medianCommits > 0 ? (leaderData.medianCommits / trailerData.medianCommits).toFixed(1) : '—';

    const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
    for (const [ide, data] of entries) {
      breakdownByTool[ide] = {
        value: data.medianCommits,
        count: data.validSessions,
        formatted: `${data.medianCommits} commits/session`,
        label: `${getCanonicalWorkflowIdentity(ide)} (${data.validSessions} sessions)`,
      };
    }

    const totalN = entries.reduce((sum, [_, d]) => sum + d.validSessions, 0);

    return {
      id: registryEntry.id,
      title: `${getCanonicalWorkflowIdentity(leaderIDE)} shows ${ratio}x more commits/session than ${getCanonicalWorkflowIdentity(trailerIDE)} (${leaderData.medianCommits} vs ${trailerData.medianCommits}, N=${leaderData.validSessions} vs ${trailerData.validSessions})`,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'comparison',
      presentationKind: 'workflow_comparison',
      comparisonMode: 'workflow_vs_workflow',
      comparisonState: 'workflow_comparable',
      current: leaderData.medianCommits,
      baseline: trailerData.medianCommits,
      delta: gap,
      deltaPct: trailerData.medianCommits > 0 ? Math.round((gap / trailerData.medianCommits) * 100) : 0,
      displayValue: `${leaderData.medianCommits} commits/session`,
      displayDeltaPct: `+${Math.round((gap / trailerData.medianCommits) * 100)}%`,
      rightMetric: `${trailerData.medianCommits} commits/session`,
      rightMetricLabel: getCanonicalWorkflowIdentity(trailerIDE),
      polarity: 'higher_is_better',
      confidence: totalN >= 100 ? 'high' : 'medium',
      coveragePct: coveragePct1dp(totalN, sessionRows.length),
      n: totalN,
      hasData: true,
      description: `Median commits per session across ${entries.length} primary workflows. ${entries.map(([ide, d]) => `${getCanonicalWorkflowIdentity(ide)}: ${d.medianCommits} (N=${d.validSessions})`).join(', ')}.`,
      recommendation: `Compare task granularity and commit habits across workflows. Higher commit frequency may reflect smaller task decomposition, not higher productivity.`,
      executiveSummary: `Commit frequency varies ${ratio}x across workflows. ${getCanonicalWorkflowIdentity(leaderIDE)} leads at ${leaderData.medianCommits}/session.`,
      evidence: entries.map(([ide, d]) => ({
        metric: getCanonicalWorkflowIdentity(ide),
        value: `${d.medianCommits} commits/session`,
        label: `N=${d.validSessions}`,
      })),
      breakdownByTool,
      selectedComparison: { leaderKey: leaderIDE, baselineKey: trailerIDE },
      whatChanged: `Commits per session comparison across ${entries.length} workflows`,
      whyItMatters: `Commit frequency reflects task decomposition and delivery cadence. Large differences may indicate different working styles, not different productivity.`,
      operationalImpact: `${getCanonicalWorkflowIdentity(leaderIDE)} produces ${ratio}x more commits per session than ${getCanonicalWorkflowIdentity(trailerIDE)}.`,
      cohort: `${entries.length} workflows (total N=${totalN})`,
      confidenceReasoning: `Median-based comparison across ${entries.length} workflows with ≥10 sessions each. Total N=${totalN}.`,
      operationalRead: entries.map(([ide, d]) => `${getCanonicalWorkflowIdentity(ide)}: ${d.medianCommits}/session (N=${d.validSessions})`).join(' | '),
      urgencyLabel: 'informational',
      metricDefinition: 'Median commits per session by workflow',
      isExecutiveFinding: false,
      dataSource: 'live',
    };
  } catch (err) {
    piDebugLog('[GENERATOR_COMMITS_PER_SESSION][ERROR]', err);
    return null;
  }
}

/**
 * CR5 P1: Generate multi-tool-day-effect insight
 *
 * Compares sessions on days when multiple tools were used vs single-tool days.
 * Local-only finding: same developer used multiple tools across 144 days.
 * Census evidence: 18.8min vs 6.1min active coding (3.08x, N=979/876).
 */
export function generateMultiToolDayEffect(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    const registryEntry = getCanonicalPIById('multi-tool-day-effect');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length < 30) return null;

    // Group sessions by day (from timestamp)
    const sessionsByDay: Record<string, any[]> = {};
    for (const s of sessionRows) {
      const ts = s.timestamp || s.session_start_time;
      if (!ts) continue;
      const day = String(ts).slice(0, 10); // YYYY-MM-DD
      if (!sessionsByDay[day]) sessionsByDay[day] = [];
      sessionsByDay[day].push(s);
    }

    // Classify days as multi-tool or single-tool
    const multiToolSessions: any[] = [];
    const singleToolSessions: any[] = [];

    for (const [day, sessions] of Object.entries(sessionsByDay)) {
      const tools = new Set(sessions.map(s => normalizeToCanonicalToolId(s.tool ?? s.session_source ?? '')));
      if (tools.size > 1) {
        multiToolSessions.push(...sessions);
      } else {
        singleToolSessions.push(...sessions);
      }
    }

    if (multiToolSessions.length < 20 || singleToolSessions.length < 20) {
      piDebugLog('[GENERATOR_MULTI_TOOL_DAY][INSUFFICIENT_DATA]', {
        multiTool: multiToolSessions.length,
        singleTool: singleToolSessions.length,
      });
      return null;
    }

    // Compute median active coding for each group
    const multiAC = multiToolSessions
      .map(s => s.session_active_coding_duration_minutes)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
    const singleAC = singleToolSessions
      .map(s => s.session_active_coding_duration_minutes)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);

    if (multiAC.length < 10 || singleAC.length < 10) return null;

    const multiMed = medianValue(multiAC);
    const singleMed = medianValue(singleAC);
    const delta = multiMed - singleMed;
    const ratio = singleMed > 0 ? (multiMed / singleMed).toFixed(1) : '—';

    // Count days
    const multiDays = Object.values(sessionsByDay).filter(ss => new Set(ss.map(s => normalizeToCanonicalToolId(s.tool ?? ''))).size > 1).length;
    const singleDays = Object.values(sessionsByDay).filter(ss => new Set(ss.map(s => normalizeToCanonicalToolId(s.tool ?? ''))).size === 1).length;

    return {
      id: registryEntry.id,
      title: `Multi-tool days show ${ratio}x more active coding than single-tool days (${multiMed.toFixed(1)} vs ${singleMed.toFixed(1)} min/session, N=${multiAC.length}/${singleAC.length})`,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'comparison',
      presentationKind: 'cohort_comparison',
      comparisonMode: 'ai_vs_non_ai', // binary cohort comparison
      comparisonState: 'ai_non_ai_comparable',
      current: multiMed,
      baseline: singleMed,
      delta,
      deltaPct: singleMed > 0 ? Math.round((delta / singleMed) * 100) : 0,
      displayValue: `${multiMed.toFixed(1)} min`,
      displayDeltaPct: `+${Math.round((delta / singleMed) * 100)}%`,
      rightMetric: `${singleMed.toFixed(1)} min`,
      rightMetricLabel: 'Single-tool days',
      polarity: 'higher_is_better',
      confidence: (multiAC.length + singleAC.length) >= 100 ? 'high' : 'medium',
      coveragePct: coveragePct1dp((multiAC.length + singleAC.length), sessionRows.length),
      n: multiAC.length + singleAC.length,
      hasData: true,
      description: `Across ${multiDays + singleDays} active days, ${multiDays} involved multiple tools and ${singleDays} used a single tool. Multi-tool day sessions show ${multiMed.toFixed(1)} min median active coding vs ${singleMed.toFixed(1)} min for single-tool days. Association, not causal claim.`,
      recommendation: `Investigate whether multi-tool days reflect more complex tasks (requiring different tools) or whether tool switching itself enables longer focused periods.`,
      executiveSummary: `Multi-tool days show ${ratio}x more active coding per session. ${multiDays} multi-tool days vs ${singleDays} single-tool days.`,
      evidence: [
        { metric: 'Multi-tool day sessions', value: `${multiMed.toFixed(1)} min`, label: `N=${multiAC.length} across ${multiDays} days` },
        { metric: 'Single-tool day sessions', value: `${singleMed.toFixed(1)} min`, label: `N=${singleAC.length} across ${singleDays} days` },
      ],
      breakdownByTool: {
        'multi_tool': { value: multiMed, count: multiAC.length, formatted: `${multiMed.toFixed(1)} min`, label: `Multi-tool days (${multiAC.length} sessions, ${multiDays} days)` },
        'single_tool': { value: singleMed, count: singleAC.length, formatted: `${singleMed.toFixed(1)} min`, label: `Single-tool days (${singleAC.length} sessions, ${singleDays} days)` },
      },
      selectedComparison: { leaderKey: 'multi_tool', baselineKey: 'single_tool' },
      whatChanged: `Multi-tool vs single-tool day comparison (${multiDays} vs ${singleDays} days)`,
      whyItMatters: `This is a Local-specific finding enabled by the same developer using multiple tools across a long period. It reveals whether tool diversity correlates with engagement.`,
      operationalImpact: `Multi-tool days produce ${ratio}x more active coding per session. The effect may reflect task complexity rather than tool switching itself.`,
      cohort: `Multi-tool: ${multiDays} days / ${multiAC.length} sessions, Single-tool: ${singleDays} days / ${singleAC.length} sessions`,
      confidenceReasoning: `Day-level classification from session timestamps. Median-based comparison. Total N=${multiAC.length + singleAC.length}.`,
      operationalRead: `Multi-tool days: ${multiMed.toFixed(1)}min AC (N=${multiAC.length}, ${multiDays} days). Single-tool: ${singleMed.toFixed(1)}min (N=${singleAC.length}, ${singleDays} days). Ratio: ${ratio}x.`,
      urgencyLabel: 'monitor',
      metricDefinition: 'Median active coding minutes per session, multi-tool days vs single-tool days',
      isExecutiveFinding: false,
      dataSource: 'live',
    };
  } catch (err) {
    piDebugLog('[GENERATOR_MULTI_TOOL_DAY][ERROR]', err);
    return null;
  }
}

/**
 * CR5 P1: Generate monthly-workflow-share insight
 *
 * Shows how workflow share has changed over time across monthly periods.
 * Census evidence: Devin 31%→79%→17%→70%→41%→100% across 7 months.
 */
export function generateMonthlyWorkflowShare(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    const registryEntry = getCanonicalPIById('monthly-workflow-share');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length < 30) return null;

    // Group sessions by month
    const monthWorkflowCounts: Record<string, Record<string, number>> = {};
    for (const s of sessionRows) {
      const ts = s.timestamp || s.session_start_time;
      if (!ts) continue;
      const month = String(ts).slice(0, 7); // YYYY-MM
      if (!monthWorkflowCounts[month]) monthWorkflowCounts[month] = {};
      const wf = normalizeToCanonicalToolId(s.tool ?? s.session_source ?? '');
      if (!wf || wf === 'unknown') continue;
      monthWorkflowCounts[month][wf] = (monthWorkflowCounts[month][wf] || 0) + 1;
    }

    const months = Object.keys(monthWorkflowCounts).sort();
    if (months.length < 3) {
      piDebugLog('[GENERATOR_MONTHLY_WORKFLOW_SHARE][INSUFFICIENT_PERIODS]', { months: months.length });
      return null;
    }

    // PARTIAL-PERIOD RULE: the in-progress calendar month must never be a
    // trend endpoint or drive the shift conclusion. Endpoints are computed
    // from completed months only; the current month still renders in the
    // period strip, explicitly labeled as partial.
    const currentMonthKey = getCurrentMonthKey();
    const completeMonths = months.filter(m => m !== currentMonthKey);
    const endpointMonths = completeMonths.length >= 2 ? completeMonths : months;
    const hasPartialCurrentMonth = months.includes(currentMonthKey);

    // Build breakdownByTool with each month-workflow combination
    const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
    const evidence: Array<{ metric: string; value: string; label: string }> = [];

    for (const month of months) {
      const wfCounts = monthWorkflowCounts[month];
      const total = Object.values(wfCounts).reduce((sum, n) => sum + n, 0);
      if (total === 0) continue;

      for (const [wf, count] of Object.entries(wfCounts)) {
        const sharePct = (count / total) * 100;
        const key = `${month}_${wf}`;
        breakdownByTool[key] = {
          value: sharePct,
          count,
          formatted: `${sharePct.toFixed(0)}% (${count} sessions)`,
          label: `${month} · ${getCanonicalWorkflowIdentity(wf)}`,
        };
      }

      const topWf = Object.entries(wfCounts).sort((a, b) => b[1] - a[1])[0];
      const topShare = (topWf[1] / total) * 100;
      evidence.push({
        metric: month,
        value: `${topShare.toFixed(0)}% ${getCanonicalWorkflowIdentity(topWf[0])}`,
        label: month === currentMonthKey ? `N=${total} · partial month` : `N=${total}`,
      });
    }

    // Compute the headline: first vs last COMPLETED month dominant workflow
    const firstMonth = endpointMonths[0];
    const lastMonth = endpointMonths[endpointMonths.length - 1];
    const firstTotal = Object.values(monthWorkflowCounts[firstMonth]).reduce((s, n) => s + n, 0);
    const lastTotal = Object.values(monthWorkflowCounts[lastMonth]).reduce((s, n) => s + n, 0);
    const firstTop = Object.entries(monthWorkflowCounts[firstMonth]).sort((a, b) => b[1] - a[1])[0];
    const lastTop = Object.entries(monthWorkflowCounts[lastMonth]).sort((a, b) => b[1] - a[1])[0];
    const firstShare = (firstTop[1] / firstTotal) * 100;
    const lastShare = (lastTop[1] / lastTotal) * 100;

    const totalN = sessionRows.length;

    // CR-X semantic integrity: A "shift" finding requires the dominant workflow
    // to actually change between the first and last observed period. If the
    // same workflow remains dominant, emit a truthful retained-dominance
    // finding (only if the share change is materially useful), or suppress
    // the finding entirely if it adds no decision value.
    const firstWfIdentity = getCanonicalWorkflowIdentity(firstTop[0]).replace(' workflow', '');
    const lastWfIdentity = getCanonicalWorkflowIdentity(lastTop[0]).replace(' workflow', '');
    const sameDominantWorkflow = firstTop[0] === lastTop[0];
    const shareDelta = lastShare - firstShare;

    // If the same workflow is dominant and the share change is trivial (<5pp),
    // suppress the finding — it adds no decision value.
    if (sameDominantWorkflow && Math.abs(shareDelta) < 5) {
      piDebugLog('[GENERATOR_MONTHLY_WORKFLOW_SHARE][SAME_WORKFLOW_TRIVIAL_DELTA]', {
        workflow: firstWfIdentity, shareDelta,
      });
      return null;
    }

    // PARTIAL-PERIOD TRUTH: when the in-progress month was excluded from
    // endpoints, the conclusion count must be the COMPLETE-period count and
    // must say so. The partial month stays visible in the period strip,
    // explicitly labeled, but never counts toward the conclusion.
    const partialPeriodActive = hasPartialCurrentMonth && completeMonths.length >= 2;
    const periodPhrase = partialPeriodActive
      ? `${completeMonths.length} complete periods`
      : `${endpointMonths.length} observed periods`;

    const title = sameDominantWorkflow
      ? `${firstWfIdentity} remained the dominant workflow across ${periodPhrase}`
      : `Dominant workflow shifted from ${firstWfIdentity} to ${lastWfIdentity} across ${periodPhrase}`;

    const executiveSummary = sameDominantWorkflow
      ? `${firstWfIdentity} remained dominant across ${periodPhrase}. Share changed from ${firstShare.toFixed(0)}% to ${lastShare.toFixed(0)}%.`
      : `Workflow share shifted across ${periodPhrase}. ${getCanonicalWorkflowIdentity(firstTop[0])} ${firstShare.toFixed(0)}% → ${getCanonicalWorkflowIdentity(lastTop[0])} ${lastShare.toFixed(0)}%.`;

    const operationalImpact = sameDominantWorkflow
      ? `${firstWfIdentity} retained dominance; share changed ${shareDelta >= 0 ? '+' : ''}${shareDelta.toFixed(0)}pp over ${periodPhrase}.`
      : `Workflow dominance shifted ${Math.abs(shareDelta).toFixed(0)}pp over ${periodPhrase}.`;

    return {
      id: registryEntry.id,
      // CR5 P1.5 P2: Strip " workflow" suffix from title.
      // CR5 FINAL TITLE DOCTRINE: Include observation span.
      title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'comparison',
      presentationKind: 'temporal_trend',
      comparisonMode: 'absolute',
      comparisonState: 'workflow_comparable',
      current: lastShare,
      baseline: firstShare,
      currentLabel: lastMonth,
      baselineLabel: firstMonth,
      // CR5 P1.5 P1.2: Expose dominant workflow names for claim/evidence labels.
      currentWorkflow: getCanonicalWorkflowIdentity(lastTop[0]).replace(' workflow', ''),
      baselineWorkflow: getCanonicalWorkflowIdentity(firstTop[0]).replace(' workflow', ''),
      delta: lastShare - firstShare,
      deltaPct: firstShare > 0 ? Math.round(((lastShare - firstShare) / firstShare) * 100) : 0,
      displayValue: `${lastShare.toFixed(0)}%`,
      displayDeltaPct: `${lastShare > firstShare ? '+' : ''}${(lastShare - firstShare).toFixed(0)}pp`,
      rightMetric: `${firstShare.toFixed(0)}%`,
      rightMetricLabel: `${firstMonth} baseline`,
      polarity: 'neutral',
      confidence: endpointMonths.length >= 4 ? 'high' : 'medium',
      coveragePct: 100,
      n: totalN,
      hasData: true,
      completePeriodCount: completeMonths.length,
      hasPartialCurrentPeriod: partialPeriodActive,
      description: `Workflow share across ${periodPhrase}${partialPeriodActive ? ', with the in-progress month shown for context' : ''}. ${months.map(m => {
        const counts = monthWorkflowCounts[m];
        const total = Object.values(counts).reduce((s, n) => s + n, 0);
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        return `${m}${m === currentMonthKey ? ' (partial)' : ''}: ${getCanonicalWorkflowIdentity(top[0])} ${((top[1]/total)*100).toFixed(0)}% (N=${total})`;
      }).join(', ')}.`,
      recommendation: `Review whether workflow transitions correlate with project phases, tool evaluations, or team process changes.`,
      executiveSummary,
      evidence,
      breakdownByTool,
      selectedComparison: { leaderKey: `${lastMonth}_${lastTop[0]}`, baselineKey: `${firstMonth}_${firstTop[0]}` },
      whatChanged: `Monthly workflow share trajectory across ${periodPhrase}`,
      whyItMatters: `Workflow share transitions reveal tool adoption patterns and project phase changes. This is a Local-specific finding enabled by long historical coverage.`,
      operationalImpact,
      cohort: `${periodPhrase} (N=${totalN})`,
      confidenceReasoning: `Month-level aggregation from session timestamps. ${periodPhrase} with total N=${totalN}.`,
      operationalRead: months.map(m => {
        const counts = monthWorkflowCounts[m];
        const total = Object.values(counts).reduce((s, n) => s + n, 0);
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        return `${m}${m === currentMonthKey ? ' (partial)' : ''}: ${getCanonicalWorkflowIdentity(top[0])} ${((top[1]/total)*100).toFixed(0)}%`;
      }).join(' → '),
      // CR-X P0-C: explicit trend data so the UI sparkline draws from the
      // same dominant-workflow record as the START/END evidence cells.
      // Each point binds period, dominant workflow, and share together.
      trendData: months.map(m => {
        const counts = monthWorkflowCounts[m];
        const total = Object.values(counts).reduce((s, n) => s + n, 0);
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        return {
          value: total > 0 ? (top[1] / total) * 100 : 0,
          label: m === currentMonthKey ? `${m} · partial` : m,
          workflow: getCanonicalWorkflowIdentity(top[0]).replace(' workflow', ''),
        };
      }),
      urgencyLabel: 'informational',
      metricDefinition: 'Workflow share (%) by month, showing tool adoption transitions over time',
      isExecutiveFinding: false,
      dataSource: 'live',
    };
  } catch (err) {
    piDebugLog('[GENERATOR_MONTHLY_WORKFLOW_SHARE][ERROR]', err);
    return null;
  }
}

/**
 * CR5 WS2 — Generate files-edited-by-ide (file-save activity by IDE)
 *
 * Measures the average number of file save events per session across
 * primary workflows. Uses file_save_count from enriched sessions.
 * This is a distinct dimension from active-coding time and commits —
 * it measures save activity, not the depth or frequency of coding.
 *
 * CR5 WS2 P0-2 CORRECTION: file_save_count = 0 is MEASURED data (the
 * session saved zero files), not missing. Only undefined/null/NaN is
 * treated as missing. The canonical field `files_edited` is declared
 * in the schema but is NOT populated in the DB — file_save_count is
 * the authoritative field. Measured coverage = 1,607/1,855 = 86.6%.
 */
export function generateFilesEditedByIDE(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('files-edited-by-ide');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  if (totalSessions < 20) return null;

  // CR5 WS2 #12 P0-1: DEV-only trace over the exact Final Engine input.
  // Proves per-workflow file_save_count distribution before any filtering.
  const allWfTrace = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
  const traceRows: Array<Record<string, unknown>> = [];
  let traceTotal = 0, traceFinite = 0, traceZero = 0, traceMissing = 0;
  for (const [wf, sessions] of Object.entries(allWfTrace)) {
    let wfFinite = 0, wfZero = 0, wfMissing = 0, wfSum = 0;
    for (const s of sessions) {
      const fsc = s.file_save_count;
      if (typeof fsc === 'number' && Number.isFinite(fsc)) {
        wfFinite++;
        if (fsc === 0) wfZero++;
        wfSum += fsc;
      } else {
        wfMissing++;
      }
    }
    traceTotal += sessions.length;
    traceFinite += wfFinite;
    traceZero += wfZero;
    traceMissing += wfMissing;
    traceRows.push({
      workflow: wf,
      canonical_total: sessions.length,
      finite_file_save_count: wfFinite,
      zero: wfZero,
      missing: wfMissing,
      avg_file_save_count: wfFinite > 0 ? (wfSum / wfFinite).toFixed(2) : 'N/A',
    });
  }
  piDebugLog('[FILES_EDITED_INPUT_TRACE]', JSON.stringify({
    perWorkflow: traceRows,
    totals: { total_input_rows: traceTotal, total_finite: traceFinite, total_zero: traceZero, total_missing: traceMissing },
  }, null, 2));
  if (typeof window !== 'undefined') {
    if (!(window as any).__CM_DEBUG__) (window as any).__CM_DEBUG__ = {};
    (window as any).__CM_DEBUG__.filesEditedInputTrace = { perWorkflow: traceRows, totals: { total_input_rows: traceTotal, total_finite: traceFinite, total_zero: traceZero, total_missing: traceMissing } };
  }

  const allWorkflows = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
  const workflowStats: Array<{ name: string; avgFiles: number; count: number; total: number }> = [];

  for (const [ide, sessions] of Object.entries(allWorkflows)) {
    if (sessions.length === 0) continue;
    // P0-2: file_save_count = 0 is measured data, not missing.
    // Only exclude undefined/null/NaN.
    const measuredSessions = sessions.filter(s =>
      typeof s.file_save_count === 'number' && Number.isFinite(s.file_save_count)
    );
    if (measuredSessions.length < 5) continue;
    const avgFiles = measuredSessions.reduce((sum, s) => sum + s.file_save_count, 0) / measuredSessions.length;
    workflowStats.push({ name: ide, avgFiles, count: measuredSessions.length, total: sessions.length });
  }

  // Need at least 2 primary workflows for comparison.
  // CR5 WS2 #11 P0-2: Primary eligibility must require ≥25 MEASURED
  // file_save_count sessions per controlling workflow, not merely ≥25
  // total workflow sessions. This prevents a workflow with many sessions
  // but low file_save_count coverage from controlling the comparison.
  const MIN_MEASURED_PRIMARY = 25;
  const primaryWorkflows = workflowStats.filter(w => w.count >= MIN_MEASURED_PRIMARY);
  if (primaryWorkflows.length < 2) {
    piDebugLog('[GENERATOR_FILES_EDITED_BY_IDE][INSUFFICIENT_WORKFLOWS]', {
      primaryWorkflows: primaryWorkflows.length,
      workflowDetails: workflowStats.map(w => ({ name: w.name, measured: w.count, total: w.total })),
    });
    return null;
  }

  primaryWorkflows.sort((a, b) => b.avgFiles - a.avgFiles);
  const highest = primaryWorkflows[0];
  const lowest = primaryWorkflows[primaryWorkflows.length - 1];
  const gap = highest.avgFiles - lowest.avgFiles;
  const gapPct = lowest.avgFiles > 0 ? ((highest.avgFiles - lowest.avgFiles) / lowest.avgFiles) * 100 : 0;
  const ratio = lowest.avgFiles > 0 ? highest.avgFiles / lowest.avgFiles : 0;

  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  // P0-2: Coverage = measured sessions / total sessions (includes zero-save sessions as measured)
  const totalMeasured = primaryWorkflows.reduce((sum, w) => sum + w.count, 0);
  const coveragePct = coveragePct1dp(totalMeasured, totalSessions);

  const executiveTitle = `${getCanonicalWorkflowIdentity(highest.name)} sessions show ${highest.avgFiles.toFixed(1)} file saves/session vs ${getCanonicalWorkflowIdentity(lowest.name)} ${lowest.avgFiles.toFixed(1)} (${ratio.toFixed(1)}x save activity)`;

  const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
  for (const w of primaryWorkflows) {
    breakdownByTool[w.name] = {
      value: w.avgFiles,
      count: w.count,
      formatted: `${w.avgFiles.toFixed(1)} saves/session`,
      label: `${getCanonicalWorkflowIdentity(w.name)} (${w.count} sessions)`,
    };
  }

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'comparison',
    presentationKind: 'workflow_comparison',
    comparisonMode: 'workflow_vs_workflow',
    current: highest.avgFiles,
    baseline: lowest.avgFiles,
    delta: gap,
    deltaPct: gapPct,
    rightMetric: `${highest.avgFiles.toFixed(1)} saves/session`,
    rightMetricLabel: 'File Saves per Session',
    metricDefinition: 'Average number of file save events per development session by workflow',
    operationalBreadcrumbs: [
      `${totalSessions} sessions analyzed`,
      `${getCanonicalWorkflowIdentity(highest.name)}: ${highest.avgFiles.toFixed(1)} saves/session (${highest.count} sessions)`,
      `${getCanonicalWorkflowIdentity(lowest.name)}: ${lowest.avgFiles.toFixed(1)} saves/session (${lowest.count} sessions)`,
    ],
    confidence,
    coveragePct,
    n: totalMeasured,
    hasData: true,
    dataDomain: 'telemetry',
    sourceLabel: 'Telemetry',
    sampleUnit: 'sessions',
    sampleLabel: `${totalMeasured} sessions with file_save_count`,
    attributionStatus: 'ide_attributed',
    comparisonStatus: 'available',
    displayValue: `${highest.avgFiles.toFixed(1)} saves/session`,
    displayUnit: 'saves/session',
    description: `${getCanonicalWorkflowIdentity(highest.name)} sessions show ${highest.avgFiles.toFixed(1)} file saves on average, ${ratio.toFixed(1)}x more than ${getCanonicalWorkflowIdentity(lowest.name)} at ${lowest.avgFiles.toFixed(1)}. This measures save activity — higher save rates may indicate different task complexity or working style.`,
    whatChanged: `File save activity: ${getCanonicalWorkflowIdentity(highest.name)} ${highest.avgFiles.toFixed(1)} vs ${getCanonicalWorkflowIdentity(lowest.name)} ${lowest.avgFiles.toFixed(1)} saves/session.`,
    whyItMatters: 'Higher save activity may reflect different working styles or task complexity. Understanding workflow differences helps optimize development practices.',
    recommendation: gap > 5
      ? `${getCanonicalWorkflowIdentity(highest.name)} sessions show ${gap.toFixed(1)} more file saves than ${getCanonicalWorkflowIdentity(lowest.name)}. Consider whether higher save rates reflect task complexity or different working styles.`
      : 'File save counts are similar across workflows. Monitor for changes that may indicate shifting task complexity.',
    evidenceAndContext: `Analysis of ${totalMeasured} sessions with file_save_count data (zero-save sessions included as measured). ${getCanonicalWorkflowIdentity(highest.name)}: ${highest.avgFiles.toFixed(1)} saves/session (${highest.count} sessions). ${getCanonicalWorkflowIdentity(lowest.name)}: ${lowest.avgFiles.toFixed(1)} saves/session (${lowest.count} sessions). Coverage: ${coveragePct}%.`,
    operationalImpact: `${ratio.toFixed(1)}x save activity difference may reflect different task patterns.`,
    primaryRisk: 'Consistently higher save rates may indicate tasks that could be decomposed differently, but save count is not a direct quality measure.',
    cohort: 'Cross-Tool Behavior',
    confidenceReasoning: `${confidence} confidence based on ${totalMeasured} sessions with file_save_count data across ${primaryWorkflows.length} workflows.`,
    recommendationState: gap > 5 ? 'investigate' : 'monitor_only',
    urgencyLabel: gap > 5 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: getCanonicalWorkflowIdentity(highest.name), value: highest.avgFiles.toFixed(1), label: 'saves/session' },
      { metric: getCanonicalWorkflowIdentity(lowest.name), value: lowest.avgFiles.toFixed(1), label: 'saves/session' },
      { metric: 'Ratio', value: `${ratio.toFixed(1)}x`, label: 'save activity' },
    ],
    breakdownByTool,
    selectedComparison: { leaderKey: highest.name, baselineKey: lowest.name },
    operationalRead: `${getCanonicalWorkflowIdentity(highest.name)}: ${highest.avgFiles.toFixed(1)} saves/session vs ${getCanonicalWorkflowIdentity(lowest.name)}: ${lowest.avgFiles.toFixed(1)} (${ratio.toFixed(1)}x).`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    comparisonState: 'workflow_comparable',
  };

  return baseInsight;
}

/**
 * CR5 WS2 P0-3 — Generate session-profile-by-ide (composite cross-tool session profile)
 *
 * Combines session_duration_minutes and active_coding_duration_minutes into a
 * single multi-dimensional comparison across primary workflows. This avoids
 * creating a separate session-duration-by-ide card while still surfacing the
 * duration dimension that AIOI already renders truthfully.
 *
 * CR5 WS2 #11 P0-1 MISSING-DATA INTEGRITY:
 * - session duration may be used when measured
 * - active-coding/focus supporting evidence may be used only when measured
 *   for BOTH members of the selected comparison pair
 * - never render missing active/focus as 0
 * - if selected pair lacks supporting dimensions, frame the card as
 *   session-duration/session-length comparison rather than full composite
 * - if a true composite requires all dimensions, only fully measured
 *   workflows may control that composite
 *
 * Authority proof: duration_ms is a CANONICAL field on session rows (from
 * telemetry_events). The backend sessions endpoint returns it per row.
 * addDerivedSessionFields converts it to session_duration_minutes. AIOI
 * renders average_session_length_minutes from the same underlying data.
 *
 * If duration_ms is not populated on the enriched canonical rows (all zero
 * or all missing), this generator returns null and records the proof.
 */
export function generateSessionProfileByIDE(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('session-profile-by-ide');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;
  if (totalSessions < 20) return null;

  // Authority check: verify session_duration_minutes is actually populated.
  const sessionsWithDuration = sessionRows.filter(s =>
    typeof s.session_duration_minutes === 'number' &&
    Number.isFinite(s.session_duration_minutes) &&
    s.session_duration_minutes > 0
  );

  if (sessionsWithDuration.length < 20) {
    piDebugLog('[GENERATOR_SESSION_PROFILE][NO_DURATION_DATA]', {
      totalSessions,
      sessionsWithDuration: sessionsWithDuration.length,
      proof: 'session_duration_minutes not populated on enriched canonical rows — duration_ms may be 0 or missing',
    });
    return null;
  }

  const allWorkflows = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
  const workflowStats: Array<{
    name: string;
    avgDuration: number;
    medDuration: number;
    p90Duration: number;
    skewRatio: number;
    isMateriallySkewed: boolean;
    avgActiveCoding: number | null;  // null = not measured (missing ≠ zero)
    focusRatio: number | null;       // null = not measured (missing ≠ zero)
    hasActiveCoding: boolean;
    count: number;
    total: number;
  }> = [];

  for (const [ide, sessions] of Object.entries(allWorkflows)) {
    if (sessions.length === 0) continue;

    // Duration: all workflows have duration_ms (canonical field)
    const durationSessions = sessions.filter(s =>
      typeof s.session_duration_minutes === 'number' &&
      Number.isFinite(s.session_duration_minutes) &&
      s.session_duration_minutes > 0
    );
    if (durationSessions.length < 5) continue;

    const avgDuration = durationSessions.reduce((sum, s) => sum + s.session_duration_minutes, 0) / durationSessions.length;

    // CR-X P0-2: Skew-aware synthesis — compute median and p90 alongside mean.
    // When a workflow has a material long-tail (p90/p50 > 5x), the arithmetic
    // mean is dominated by outliers and misrepresents typical session length.
    // Use median as the headline metric for skewed workflows.
    const sortedDurations = durationSessions.map(s => s.session_duration_minutes).sort((a, b) => a - b);
    const medDuration = medianValue(sortedDurations);
    const p90Duration = percentile(sortedDurations, 90);
    const skewRatio = medDuration > 0 ? p90Duration / medDuration : 0;
    const isMateriallySkewed = skewRatio >= 5;

    // Active coding: not instrumented for Claude Code, or may be missing for other workflows.
    // P0-1: missing active coding is null, NOT zero.
    let avgActiveCoding: number | null = null;
    let focusRatio: number | null = null;
    let hasActiveCoding = false;

    const activeSessions = sessions.filter(s =>
      typeof s.session_active_coding_duration_minutes === 'number' &&
      Number.isFinite(s.session_active_coding_duration_minutes) &&
      s.session_active_coding_duration_minutes > 0
    );
    if (activeSessions.length >= 5) {
      avgActiveCoding = activeSessions.reduce((sum, s) => sum + s.session_active_coding_duration_minutes, 0) / activeSessions.length;
      focusRatio = avgDuration > 0 ? (avgActiveCoding / avgDuration) * 100 : null;
      hasActiveCoding = true;
    }

    workflowStats.push({
      name: ide,
      avgDuration,
      medDuration,
      p90Duration,
      skewRatio,
      isMateriallySkewed,
      avgActiveCoding,
      focusRatio,
      hasActiveCoding,
      count: durationSessions.length,
      total: sessions.length,
    });
  }

  const MIN_PRIMARY = 25;
  const primaryWorkflows = workflowStats.filter(w => w.total >= MIN_PRIMARY);
  if (primaryWorkflows.length < 2) {
    piDebugLog('[GENERATOR_SESSION_PROFILE][INSUFFICIENT_WORKFLOWS]', { primaryWorkflows: primaryWorkflows.length });
    return null;
  }

  primaryWorkflows.sort((a, b) => b.avgDuration - a.avgDuration);
  const highest = primaryWorkflows[0];
  const lowest = primaryWorkflows[primaryWorkflows.length - 1];
  const gap = highest.avgDuration - lowest.avgDuration;
  const gapPct = lowest.avgDuration > 0 ? ((highest.avgDuration - lowest.avgDuration) / lowest.avgDuration) * 100 : 0;
  const ratio = lowest.avgDuration > 0 ? highest.avgDuration / lowest.avgDuration : 0;

  // CR-X P0-2: Skew-aware headline — when either comparison member has a
  // materially skewed duration distribution (p90/p50 ≥ 5x), use median
  // instead of mean in the headline. The arithmetic mean is dominated by
  // long-tail outliers and misrepresents typical session length.
  const eitherSkewed = highest.isMateriallySkewed || lowest.isMateriallySkewed;
  const headlineHighest = eitherSkewed ? highest.medDuration : highest.avgDuration;
  const headlineLowest = eitherSkewed ? lowest.medDuration : lowest.avgDuration;
  const headlineRatio = headlineLowest > 0 ? headlineHighest / headlineLowest : 0;
  const headlineMetric = eitherSkewed ? 'median' : 'average';

  // P0-1: Determine whether both comparison-pair members have active-coding evidence.
  // If either lacks it, frame as session-length comparison, not full composite.
  const bothHaveActiveCoding = highest.hasActiveCoding && lowest.hasActiveCoding;
  const isComposite = bothHaveActiveCoding;

  const confidence: ConfidenceLevel = totalSessions >= 50 ? 'high' : 'medium';
  const totalMeasured = primaryWorkflows.reduce((sum, w) => sum + w.count, 0);
  const coveragePct = coveragePct1dp(totalMeasured, totalSessions);

  // P0-1: Title and description adapt to available dimensions
  // CR-X P0-2: Use skew-aware headline (median when skewed, mean otherwise)
  const cardLabel = isComposite ? 'session profile' : 'session length';
  const executiveTitle = eitherSkewed
    ? `${getCanonicalWorkflowIdentity(highest.name)} sessions ${headlineMetric} ${headlineHighest.toFixed(0)} min vs ${getCanonicalWorkflowIdentity(lowest.name)} ${headlineLowest.toFixed(0)} min (${headlineRatio.toFixed(1)}x ${cardLabel}, long-tail adjusted)`
    : `${getCanonicalWorkflowIdentity(highest.name)} sessions average ${highest.avgDuration.toFixed(0)} min vs ${getCanonicalWorkflowIdentity(lowest.name)} ${lowest.avgDuration.toFixed(0)} min (${ratio.toFixed(1)}x ${cardLabel})`;

  const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
  for (const w of primaryWorkflows) {
    breakdownByTool[w.name] = {
      value: w.avgDuration,
      count: w.count,
      formatted: `${w.avgDuration.toFixed(0)} min/session`,
      label: `${getCanonicalWorkflowIdentity(w.name)} (${w.count} sessions)`,
    };
  }

  // P0-1: Build dimension-aware breadcrumbs and descriptions
  function formatWorkflowDimensions(w: typeof highest): string {
    const parts = [`${w.avgDuration.toFixed(0)} min`];
    if (w.hasActiveCoding && w.avgActiveCoding !== null) {
      parts.push(`${w.avgActiveCoding.toFixed(0)} min active`);
    }
    if (w.hasActiveCoding && w.focusRatio !== null) {
      parts.push(`${w.focusRatio.toFixed(0)}% focus`);
    }
    return parts.join(', ');
  }

  const operationalBreadcrumbs = [
    `${totalSessions} sessions analyzed`,
    `${getCanonicalWorkflowIdentity(highest.name)}: ${formatWorkflowDimensions(highest)}`,
    `${getCanonicalWorkflowIdentity(lowest.name)}: ${formatWorkflowDimensions(lowest)}`,
  ];

  // CR-X P0-2: Skew-aware context — when a workflow has a heavy long-tail,
  // note it so the headline median is not misread as "all sessions are this long."
  const skewContext = eitherSkewed
    ? ` Note: ${highest.isMateriallySkewed ? getCanonicalWorkflowIdentity(highest.name) : getCanonicalWorkflowIdentity(lowest.name)} has a heavy long-session tail (p90=${(highest.isMateriallySkewed ? highest.p90Duration : lowest.p90Duration).toFixed(0)}min vs median=${(highest.isMateriallySkewed ? highest.medDuration : lowest.medDuration).toFixed(0)}min). The headline uses median to represent typical session length, not the arithmetic mean which is inflated by outlier sessions.`
    : '';

  const description = isComposite
    ? `${getCanonicalWorkflowIdentity(highest.name)} sessions ${eitherSkewed ? headlineMetric : 'average'} ${eitherSkewed ? headlineHighest.toFixed(0) : highest.avgDuration.toFixed(0)} minutes (${highest.avgActiveCoding!.toFixed(0)} min active coding, ${highest.focusRatio!.toFixed(0)}% focus ratio), ${eitherSkewed ? headlineRatio.toFixed(1) : ratio.toFixed(1)}x longer than ${getCanonicalWorkflowIdentity(lowest.name)} at ${eitherSkewed ? headlineLowest.toFixed(0) : lowest.avgDuration.toFixed(0)} minutes. This composite profile combines duration, active coding, and focus ratio into a single cross-tool comparison.${skewContext}`
    : `${getCanonicalWorkflowIdentity(highest.name)} sessions ${eitherSkewed ? headlineMetric : 'average'} ${eitherSkewed ? headlineHighest.toFixed(0) : highest.avgDuration.toFixed(0)} minutes, ${eitherSkewed ? headlineRatio.toFixed(1) : ratio.toFixed(1)}x longer than ${getCanonicalWorkflowIdentity(lowest.name)} at ${eitherSkewed ? headlineLowest.toFixed(0) : lowest.avgDuration.toFixed(0)} minutes. Active coding and focus ratio are not available for all workflows in this comparison — this card presents session length only.${skewContext}`;

  const evidenceAndContext = isComposite
    ? `Composite session profile across ${primaryWorkflows.length} primary workflows. ${getCanonicalWorkflowIdentity(highest.name)}: ${eitherSkewed ? headlineHighest.toFixed(0) : highest.avgDuration.toFixed(0)} min duration, ${highest.avgActiveCoding!.toFixed(0)} min active coding, ${highest.focusRatio!.toFixed(0)}% focus. ${getCanonicalWorkflowIdentity(lowest.name)}: ${eitherSkewed ? headlineLowest.toFixed(0) : lowest.avgDuration.toFixed(0)} min duration, ${lowest.avgActiveCoding!.toFixed(0)} min active coding, ${lowest.focusRatio!.toFixed(0)}% focus. Coverage: ${coveragePct}%.${skewContext}`
    : `Session length comparison across ${primaryWorkflows.length} primary workflows. ${getCanonicalWorkflowIdentity(highest.name)}: ${eitherSkewed ? headlineHighest.toFixed(0) : highest.avgDuration.toFixed(0)} min. ${getCanonicalWorkflowIdentity(lowest.name)}: ${eitherSkewed ? headlineLowest.toFixed(0) : lowest.avgDuration.toFixed(0)} min. Active coding/focus not measured for both comparison members — card presents duration only. Coverage: ${coveragePct}%.${skewContext}`;

  const operationalRead = isComposite
    ? `${getCanonicalWorkflowIdentity(highest.name)}: ${highest.avgDuration.toFixed(0)} min vs ${getCanonicalWorkflowIdentity(lowest.name)}: ${lowest.avgDuration.toFixed(0)} (${ratio.toFixed(1)}x). Active coding: ${highest.focusRatio!.toFixed(0)}% vs ${lowest.focusRatio!.toFixed(0)}% focus.`
    : `${getCanonicalWorkflowIdentity(highest.name)}: ${highest.avgDuration.toFixed(0)} min vs ${getCanonicalWorkflowIdentity(lowest.name)}: ${lowest.avgDuration.toFixed(0)} (${ratio.toFixed(1)}x). Active coding/focus not available for both members.`;

  // CR5 WS2 #14 P0-7: COMBINE repo-mix risk context into this card.
  // Check if the top-2 repos have ≥50 sessions each. If so, compute per-repo
  // per-workflow median duration. If the direction reverses within any repo,
  // add a risk-context note. Do NOT create a standalone repo-conditioned card.
  let repoMixRiskContext = '';
  const repoCounts: Record<string, number> = {};
  for (const s of sessionRows) {
    const repo = s.repo || s.repository || (s as any).git_repo;
    if (!repo) continue;
    repoCounts[repo] = (repoCounts[repo] || 0) + 1;
  }
  const topRepos = Object.entries(repoCounts)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, count]) => count >= 50)
    .slice(0, 2)
    .map(([repo]) => repo);

  if (topRepos.length >= 2) {
    // Compute per-repo per-workflow median duration for the highest/lowest pair
    for (const repo of topRepos) {
      const repoSessions = sessionRows.filter(s =>
        (s.repo === repo || s.repository === repo || (s as any).git_repo === repo) &&
        typeof s.session_duration_minutes === 'number' &&
        Number.isFinite(s.session_duration_minutes) &&
        s.session_duration_minutes > 0
      );
      const repoHigh = repoSessions.filter(s => normalizeToCanonicalToolId(s.tool ?? s.session_source ?? '') === highest.name);
      const repoLow = repoSessions.filter(s => normalizeToCanonicalToolId(s.tool ?? s.session_source ?? '') === lowest.name);

      if (repoHigh.length >= 10 && repoLow.length >= 10) {
        const repoHighMed = medianValue(repoHigh.map(s => s.session_duration_minutes));
        const repoLowMed = medianValue(repoLow.map(s => s.session_duration_minutes));
        // Direction reversal: if highest < lowest within this repo (opposite of aggregate)
        if (repoHighMed < repoLowMed) {
          repoMixRiskContext = `Risk context: Within ${repoDisplayLabel(normalizeRepoUrl(repo) ?? repo)}, ${getCanonicalWorkflowIdentity(highest.name)} duration is ${repoHighMed.toFixed(1)}min vs ${getCanonicalWorkflowIdentity(lowest.name)} ${repoLowMed.toFixed(1)}min — the aggregate comparison may reflect repo/task mix, not workflow behavior.`;
          break;
        }
      }
    }
  }

  // Append repo-mix risk context to description and evidenceAndContext
  const descriptionWithRepoMix = repoMixRiskContext
    ? `${description} ${repoMixRiskContext}`
    : description;
  const evidenceAndContextWithRepoMix = repoMixRiskContext
    ? `${evidenceAndContext} ${repoMixRiskContext}`
    : evidenceAndContext;
  const primaryRiskWithRepoMix = repoMixRiskContext
    ? `${repoMixRiskContext} Longer sessions without proportionally more active coding may indicate idle time or context-switching overhead.`
    : 'Longer sessions without proportionally more active coding may indicate idle time or context-switching overhead.';

  // CR5 WS3 P0: Selective enrichment — add one short configured-cost context
  // sentence when BOTH compared workflows have valid configured cost.
  // Do NOT add cost to every PI. This is the only enriched PI.
  let costContextSentence = '';
  const highestCostConfig = getConfiguredCostForWorkflow(input, highest.name);
  const lowestCostConfig = getConfiguredCostForWorkflow(input, lowest.name);
  if (highestCostConfig?.isConfigured && lowestCostConfig?.isConfigured) {
    costContextSentence = ` Configured cost context: ${getCanonicalWorkflowIdentity(highest.name)} $${highestCostConfig.monthlySpend.toFixed(0)}/mo vs ${getCanonicalWorkflowIdentity(lowest.name)} $${lowestCostConfig.monthlySpend.toFixed(0)}/mo (configured estimate, not billing data).`;
  }
  const descriptionWithCost = costContextSentence
    ? `${descriptionWithRepoMix}${costContextSentence}`
    : descriptionWithRepoMix;
  const evidenceAndContextWithCost = costContextSentence
    ? `${evidenceAndContextWithRepoMix}${costContextSentence}`
    : evidenceAndContextWithRepoMix;

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title: executiveTitle,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'comparison',
    presentationKind: 'workflow_comparison',
    comparisonMode: 'workflow_vs_workflow',
    current: highest.avgDuration,
    baseline: lowest.avgDuration,
    delta: gap,
    deltaPct: gapPct,
    rightMetric: `${highest.avgDuration.toFixed(0)} min/session`,
    rightMetricLabel: 'Session Length (min)',
    metricDefinition: isComposite
      ? 'Average session duration (minutes) per workflow, composited with active coding time and focus ratio'
      : 'Average session duration (minutes) per workflow (session-length comparison — active coding/focus not available for all comparison members)',
    operationalBreadcrumbs,
    confidence,
    coveragePct,
    n: totalMeasured,
    hasData: true,
    dataDomain: 'telemetry',
    sourceLabel: 'Telemetry',
    sampleUnit: 'sessions',
    sampleLabel: `${totalMeasured} sessions with session_duration_minutes`,
    attributionStatus: 'ide_attributed',
    comparisonStatus: 'available',
    displayValue: `${highest.avgDuration.toFixed(0)} min/session`,
    displayUnit: 'min/session',
    description: descriptionWithCost,
    whatChanged: `Session ${cardLabel}: ${getCanonicalWorkflowIdentity(highest.name)} ${highest.avgDuration.toFixed(0)} min vs ${getCanonicalWorkflowIdentity(lowest.name)} ${lowest.avgDuration.toFixed(0)} min.`,
    whyItMatters: isComposite
      ? 'Session length differences reflect workflow patterns — longer sessions may indicate deeper focus or more complex tasks, but may also signal context-switching overhead. The composite view pairs duration with active coding and focus ratio for a complete picture.'
      : (isDelegatedAgentWorkflow(highest.name) || isDelegatedAgentWorkflow(lowest.name))
        ? 'Session length differences reflect different workflow types — IDE sessions and agent sessions have structurally different shapes. This is not a productivity comparison. Delegated agent sessions run autonomously; IDE sessions are interactive. Duration differences reflect workflow design, not engineering productivity.'
        : 'Session length differences reflect workflow patterns — longer sessions may indicate deeper focus or more complex tasks. Active coding and focus ratio are not available for all workflows in this comparison.',
    recommendation: gap > 15
      ? `${getCanonicalWorkflowIdentity(highest.name)} sessions are ${(eitherSkewed ? headlineHighest - headlineLowest : gap).toFixed(0)} minutes longer than ${getCanonicalWorkflowIdentity(lowest.name)}. ${(isDelegatedAgentWorkflow(highest.name) || isDelegatedAgentWorkflow(lowest.name)) ? 'This reflects different workflow types (IDE vs delegated agent), not a productivity difference. ' : ''}${isComposite ? 'Pair with active coding and focus ratio to determine whether longer sessions produce proportionally more active coding or more idle time.' : 'Monitor for whether longer sessions correlate with different task complexity.'}${repoMixRiskContext ? ' Note: repo-mix analysis suggests the aggregate gap may partly reflect task/repo distribution, not workflow behavior alone.' : ''}`
      : 'Session lengths are similar across workflows. Monitor for divergence that may indicate changing work patterns.',
    evidenceAndContext: evidenceAndContextWithCost,
    operationalImpact: `${ratio.toFixed(1)}x session length difference affects focus time allocation and context-switching cost.`,
    primaryRisk: primaryRiskWithRepoMix,
    cohort: 'Cross-Tool Behavior',
    confidenceReasoning: `${confidence} confidence based on ${totalMeasured} sessions with duration data across ${primaryWorkflows.length} workflows. ${isComposite ? 'Composite includes active coding and focus ratio.' : 'Active coding/focus not available for both comparison members — duration-only comparison.'}`,
    recommendationState: gap > 15 ? 'investigate' : 'monitor_only',
    urgencyLabel: gap > 15 ? 'investigate' : 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [
      { metric: `${getCanonicalWorkflowIdentity(highest.name)} duration`, value: highest.avgDuration.toFixed(0), label: 'min/session' },
      { metric: `${getCanonicalWorkflowIdentity(lowest.name)} duration`, value: lowest.avgDuration.toFixed(0), label: 'min/session' },
      { metric: 'Ratio', value: `${ratio.toFixed(1)}x`, label: cardLabel },
    ],
    breakdownByTool,
    selectedComparison: { leaderKey: highest.name, baselineKey: lowest.name },
    operationalRead,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    comparisonState: 'workflow_comparable',
  };

  return baseInsight;
}

/**
 * CR5 WS2 #14 P0-5: Composite observed longitudinal finding.
 *
 * Measures commits/session and time-to-first-commit (TTFC) over time using
 * observed provenance only. Neutral semantics — "observed delivery-signal
 * trend," NOT "engineering friction." No causal/productivity claim.
 *
 * Gates:
 * - observed commit provenance (session_commits_source === 'observed')
 * - observed TTFC provenance (ttfc_source === 'observed')
 * - ≥3 comparable monthly periods
 * - ≥20 provenance-qualified sessions per period (both metrics)
 * - BOTH trends must clear explicit materiality gates
 * - if either trend is weak/flat/noisy, return null
 */
export function generateCommitTtfcLongitudinal(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('commit-ttfc-longitudinal');
  if (!registryEntry) {
    piDebugLog('[GENERATOR_COMMIT_TTFC_LONGITUDINAL][NO_REGISTRY]', 'Registry entry not found');
    return null;
  }

  const sessionRows = input.sessionRows || [];
  const totalSessions = sessionRows.length;

  piDebugLog('[GENERATOR_COMMIT_TTFC_LONGITUDINAL][START]', { totalSessions });

  if (totalSessions < 60) {
    piDebugLog('[GENERATOR_COMMIT_TTFC_LONGITUDINAL][INSUFFICIENT_TOTAL]', { totalSessions });
    return null;
  }

  // Group sessions by month, filter to observed commits AND observed TTFC
  const sessionsByMonth: Record<string, any[]> = {};
  for (const s of sessionRows) {
    const ts = s.timestamp || (s as any).session_timestamp;
    if (!ts) continue;
    const month = String(ts).slice(0, 7); // YYYY-MM
    if (!sessionsByMonth[month]) sessionsByMonth[month] = [];
    sessionsByMonth[month].push(s);
  }

  const sortedMonths = Object.keys(sessionsByMonth).sort();

  // Build per-month stats using ONLY sessions with BOTH observed commits AND observed TTFC
  const MIN_PERIOD_N = 20;
  const monthlyStats: Array<{
    month: string;
    qualifiedN: number;
    medianCommitsPerSession: number;
    medianTtfcMinutes: number;
  }> = [];

  // PARTIAL-PERIOD RULE: the in-progress calendar month can never be a
  // longitudinal endpoint — it is not a complete comparable period.
  const currentMonthKey = getCurrentMonthKey();
  for (const month of sortedMonths) {
    if (month === currentMonthKey) continue;
    const sessions = sessionsByMonth[month];
    // Both provenance gates must pass for a session to qualify
    const qualified = sessions.filter(s =>
      s.session_commits_source === 'observed' &&
      typeof s.session_commits === 'number' && Number.isFinite(s.session_commits) &&
      s.ttfc_source === 'observed' &&
      typeof s.time_to_first_commit_ms === 'number' && Number.isFinite(s.time_to_first_commit_ms) && s.time_to_first_commit_ms > 0
    );

    if (qualified.length < MIN_PERIOD_N) continue;

    const commits = qualified.map(s => s.session_commits).sort((a, b) => a - b);
    const ttfcMinutes = qualified.map(s => s.time_to_first_commit_ms / 60000).sort((a, b) => a - b);

    const medianCommits = commits.length > 0 ? commits[Math.floor(commits.length / 2)] : 0;
    const medianTtfc = ttfcMinutes.length > 0 ? ttfcMinutes[Math.floor(ttfcMinutes.length / 2)] : 0;

    monthlyStats.push({
      month,
      qualifiedN: qualified.length,
      medianCommitsPerSession: medianCommits,
      medianTtfcMinutes: medianTtfc,
    });
  }

  if (monthlyStats.length < 3) {
    piDebugLog('[GENERATOR_COMMIT_TTFC_LONGITUDINAL][INSUFFICIENT_PERIODS]', {
      qualifyingPeriods: monthlyStats.length,
      minRequired: 3,
      periods: monthlyStats.map(m => ({ month: m.month, n: m.qualifiedN })),
    });
    return null;
  }

  // Compute first vs last period values
  const first = monthlyStats[0];
  const last = monthlyStats[monthlyStats.length - 1];

  const commitsDelta = last.medianCommitsPerSession - first.medianCommitsPerSession;
  const ttfcDelta = last.medianTtfcMinutes - first.medianTtfcMinutes;

  // Materiality gates: EITHER trend must clear an explicit threshold.
  // Commits: ≥0.1 commits/session change (material at session level)
  // TTFC: ≥2 minutes change (material for onboarding efficiency)
  // Both are independent operational signals — a material change in either
  // is worth surfacing. The finding describes both trends; the headline
  // leads with whichever trend is material.
  const COMMITS_MATERIALITY = 0.1;
  const TTFC_MATERIALITY_MINUTES = 2;

  const commitsTrendMaterial = Math.abs(commitsDelta) >= COMMITS_MATERIALITY;
  const ttfcTrendMaterial = Math.abs(ttfcDelta) >= TTFC_MATERIALITY_MINUTES;

  if (!commitsTrendMaterial && !ttfcTrendMaterial) {
    piDebugLog('[GENERATOR_COMMIT_TTFC_LONGITUDINAL][WEAK_TREND]', {
      commitsDelta,
      ttfcDelta,
      commitsTrendMaterial,
      ttfcTrendMaterial,
      periods: monthlyStats.map(m => ({
        month: m.month,
        n: m.qualifiedN,
        commits: m.medianCommitsPerSession,
        ttfc: m.medianTtfcMinutes,
      })),
    });
    return null;
  }

  // Build the finding — neutral observational language, no causal claim
  const commitsDirection = commitsDelta > 0 ? 'rose' : 'fell';
  const ttfcDirection = ttfcDelta > 0 ? 'rose' : 'fell';

  const totalQualifiedN = monthlyStats.reduce((sum, m) => sum + m.qualifiedN, 0);
  const numPeriods = monthlyStats.length;

  // Lead the headline with whichever signal is material. When both are
  // material, describe the joint trajectory. When only one is material,
  // headline that signal and note the other as stable.
  let title: string;
  if (commitsTrendMaterial && ttfcTrendMaterial) {
    title = `Observed commits/session ${commitsDirection} while time-to-first-commit ${ttfcDirection} across ${numPeriods} measured periods`;
  } else if (commitsTrendMaterial) {
    title = `Observed commits/session ${commitsDirection} across ${numPeriods} measured periods (TTFC stable)`;
  } else {
    title = `Time-to-first-commit ${ttfcDirection} across ${numPeriods} measured periods (commits/session stable)`;
  }

  // Build monthly evidence. A trailing month whose observed data ends before
  // the calendar month does is labeled partial so incomplete-period readings
  // are not mistaken for full-period trend evidence.
  const lastMonthKey = monthlyStats[monthlyStats.length - 1].month;
  const monthlyEvidence = monthlyStats.map(m => {
    let monthLabel = m.month;
    if (m.month === lastMonthKey) {
      const [yy, mm] = m.month.split('-').map(Number);
      const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      const latestDay = (sessionsByMonth[m.month] || []).reduce((max, s) => {
        const ts = s.timestamp || (s as any).session_timestamp;
        const d = ts ? new Date(ts).getUTCDate() : 0;
        return Number.isFinite(d) && d > max ? d : max;
      }, 0);
      if (latestDay > 0 && latestDay < daysInMonth) {
        monthLabel = `${m.month} (partial)`;
      }
    }
    return {
      metric: monthLabel,
      value: `${m.medianCommitsPerSession.toFixed(2)} commits, ${m.medianTtfcMinutes.toFixed(1)}min TTFC`,
      label: `N=${m.qualifiedN}`,
    };
  });

  const monthlyBreakdown: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
  for (const m of monthlyStats) {
    monthlyBreakdown[m.month] = {
      value: m.medianCommitsPerSession,
      count: m.qualifiedN,
      formatted: `${m.medianCommitsPerSession.toFixed(2)} commits, ${m.medianTtfcMinutes.toFixed(1)}min TTFC`,
      label: `${m.month} (N=${m.qualifiedN})`,
    };
  }

  const trajectoryCommits = monthlyStats.map(m => `${m.month}: ${m.medianCommitsPerSession.toFixed(2)}`).join(' → ');
  const trajectoryTtfc = monthlyStats.map(m => `${m.month}: ${m.medianTtfcMinutes.toFixed(1)}min`).join(' → ');

  const confidence: ConfidenceLevel = totalQualifiedN >= 200 ? 'high' : 'medium';

  piDebugLog('[GENERATOR_COMMIT_TTFC_LONGITUDINAL][FINDING]', {
    numPeriods,
    totalQualifiedN,
    firstMonth: first.month,
    lastMonth: last.month,
    firstCommits: first.medianCommitsPerSession,
    lastCommits: last.medianCommitsPerSession,
    firstTtfc: first.medianTtfcMinutes,
    lastTtfc: last.medianTtfcMinutes,
    commitsDelta,
    ttfcDelta,
    title,
  });

  return {
    id: registryEntry.id,
    title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'comparison',
    presentationKind: 'temporal_trend',
    comparisonMode: 'trend',
    // CR5 WS2 #14 P0-1: temporal findings may have comparisonState === undefined.
    // This is intentional — the finding is eligible by evidence, not by
    // workflow_comparable state.
    current: last.medianCommitsPerSession,
    baseline: first.medianCommitsPerSession,
    delta: commitsDelta,
    deltaPct: first.medianCommitsPerSession > 0 ? (commitsDelta / first.medianCommitsPerSession) * 100 : 0,
    displayValue: `${last.medianCommitsPerSession.toFixed(2)} commits/session`,
    displayDeltaPct: `${commitsDelta > 0 ? '+' : ''}${commitsDelta.toFixed(2)}`,
    rightMetric: `${last.medianTtfcMinutes.toFixed(1)} min`,
    rightMetricLabel: 'TTFC (last period)',
    // Structured TTFC + commit fields for semantic-authority rendering.
    // The renderer must consume these instead of routing through generic
    // AI-active-share / percentage-point semantics.
    firstTtfcMinutes: first.medianTtfcMinutes,
    lastTtfcMinutes: last.medianTtfcMinutes,
    ttfcDeltaMinutes: ttfcDelta,
    firstCommitsPerSession: first.medianCommitsPerSession,
    lastCommitsPerSession: last.medianCommitsPerSession,
    commitsDeltaValue: commitsDelta,
    observedPeriodCount: numPeriods,
    polarity: 'neutral',
    confidence,
    coveragePct: coveragePct1dp(totalQualifiedN, totalSessions),
    n: totalQualifiedN,
    hasData: true,
    description: `Commits/session trajectory: ${trajectoryCommits}. TTFC trajectory: ${trajectoryTtfc}. Commits/session ${commitsDirection} ${Math.abs(commitsDelta).toFixed(2)} while TTFC ${ttfcDirection} ${Math.abs(ttfcDelta).toFixed(1)} min from ${first.month} to ${last.month}. Observational — association, not causal claim.`,
    recommendation: `Review whether the ${commitsDirection} commits/session and ${ttfcDirection} TTFC reflect task mix changes, tool adoption shifts, or project phase transitions. Compare task complexity between ${first.month} and ${last.month} before interpreting as a productivity trend.`,
    executiveSummary: `Commits/session ${commitsDirection} ${Math.abs(commitsDelta).toFixed(2)} while TTFC ${ttfcDirection} ${Math.abs(ttfcDelta).toFixed(1)} min across ${numPeriods} periods (${first.month} → ${last.month}, N=${totalQualifiedN}).`,
    whatChanged: `Observed delivery-signal trend across ${numPeriods} monthly periods`,
    evidence: monthlyEvidence,
    breakdownByTool: monthlyBreakdown,
    selectedComparison: {
      leaderKey: last.month,
      baselineKey: first.month,
    },
    whyItMatters: `Tracking commits/session and TTFC together reveals whether delivery signals are moving in the same or opposite directions. This is observational — it does not prove a productivity change.`,
    operationalImpact: `Commits/session ${commitsDirection} by ${Math.abs(commitsDelta).toFixed(2)} and TTFC ${ttfcDirection} by ${Math.abs(ttfcDelta).toFixed(1)} min over ${numPeriods} months.`,
    cohort: `${numPeriods} monthly periods (N=${totalQualifiedN})`,
    confidenceReasoning: `Month-level aggregation from session timestamps. ${numPeriods} periods with ≥${MIN_PERIOD_N} observed-qualified sessions each. Total observed-qualified N=${totalQualifiedN}.`,
    operationalRead: `Commits: ${trajectoryCommits}. TTFC: ${trajectoryTtfc}.`,
    urgencyLabel: 'monitor',
    metricDefinition: 'Median commits/session and median time-to-first-commit by month (observed provenance only)',
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    dataSource: 'live',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
  };
}

// ============================================================
// CR5 WS3 P0: CONFIGURED COST EFFICIENCY
//
// Configured estimate ≠ billing data. NEVER labeled ROI.
// Uses PBT's configured-cost authority (localStorage via toolCost.ts).
// Applies configured monthly rate to a single qualifying calendar month.
// Cost/active-hour is the headline metric.
// Explicitly configured $0 is NOT missing — uses absolute-dollar headline.
// Gates: ≥2 primary workflows with ≥25 sessions in the same qualifying month.
// Emerging workflows cannot control the headline.
// ============================================================

//

/**
 * CR-X FINAL (Wave 3): Get configured cost for a canonical workflow from the
 * single backend cost authority (input.externalCostConfigs).
 *
 * Returns { monthlySpend, seatCount, costPerSeatMonthly, isConfigured } or null.
 * - isConfigured = true when a config entry exists with positive monthlySpend.
 * - $0 monthlySpend is treated as unconfigured (fail-closed) in PI.
 * - Cost tool IDs (hyphenated) are mapped to canonical workflow IDs (underscore)
 *   at the single boundary here.
 */

function getConfiguredCostForWorkflow(
  input: CanonicalInsightInput,
  workflowId: string
): {
  monthlySpend: number;
  seatCount: number;
  costPerSeatMonthly: number;
  isConfigured: boolean;
} | null {
  const external = input.externalCostConfigs || [];
  if (external.length === 0) return null;

  const target = normalizeToCanonicalToolId(workflowId);
  for (const raw of external) {
    const normalized = normalizeCostConfigInput(raw);
    if (!normalized) continue;
    const canonicalWorkflowId = costToolIdToCanonicalWorkflowId(normalized.toolId);
    if (canonicalWorkflowId === target) {
      return {
        monthlySpend: normalized.monthlySpend,
        seatCount: normalized.seatCount,
        costPerSeatMonthly: normalized.costPerSeatMonthly,
        isConfigured: normalized.monthlySpend > 0,
      };
    }
  }
  return null;
}

export function generateConfiguredCostEfficiencyByWorkflow(input: CanonicalInsightInput): CanonicalInsight | null {
  const registryEntry = getCanonicalPIById('configured-cost-efficiency-by-workflow');
  if (!registryEntry) return null;

  const sessionRows = input.sessionRows || [];
  if (sessionRows.length < 20) return null;

  // Step 1: Group sessions by calendar month and canonical workflow
  const monthWorkflow: Record<string, Record<string, any[]>> = {};
  for (const s of sessionRows) {
    const ts = s.timestamp || (s as any).session_started_at || (s as any).created_at;
    if (!ts) continue;
    const month = String(ts).slice(0, 7); // YYYY-MM
    if (!month || month.length !== 7) continue;
    const wf = normalizeToCanonicalToolId(s.tool ?? s.editor_source ?? s.session_source ?? '');
    if (!wf) continue;
    if (!monthWorkflow[month]) monthWorkflow[month] = {};
    if (!monthWorkflow[month][wf]) monthWorkflow[month][wf] = [];
    monthWorkflow[month][wf].push(s);
  }

  // Step 2: Find the most recent qualifying calendar month where ≥2 primary
  // workflows have ≥25 sessions AND have configured cost.
  // Primary workflows exclude emerging workflows (Copilot, Claude Code with <60 sessions).
  const EMERGING_WORKFLOWS = new Set(['github_copilot']);
  const MIN_SESSIONS_PER_WORKFLOW = 25;

  const sortedMonths = Object.keys(monthWorkflow).sort((a, b) => b.localeCompare(a));

  let qualifyingMonth: string | null = null;
  let qualifyingWorkflows: Array<{
    workflow: string;
    sessions: any[];
    sessionCount: number;
    activeCodingMinutes: number;
    runtimeMinutes: number;
    isDelegated: boolean;
    costConfig: { monthlySpend: number; seatCount: number; costPerSeatMonthly: number; isConfigured: boolean };
  }> = [];

  const currentMonthKey = getCurrentMonthKey();
  for (const month of sortedMonths) {
    // PARTIAL-PERIOD RULE: never qualify on the in-progress calendar month —
    // a partial month is not a comparable configured-cost period.
    if (month === currentMonthKey) continue;
    const wfSessions = monthWorkflow[month];
    const candidates: typeof qualifyingWorkflows = [];

    for (const [wf, sessions] of Object.entries(wfSessions)) {
      if (sessions.length < MIN_SESSIONS_PER_WORKFLOW) continue;

      // Skip emerging workflows from controlling the headline
      if (EMERGING_WORKFLOWS.has(wf)) continue;

      const costConfig = getConfiguredCostForWorkflow(input, wf);
      if (!costConfig || !costConfig.isConfigured) continue;

      // Compute active coding minutes for this month/workflow
      const acMinutes = sessions
        .map(s => s.session_active_coding_duration_minutes ?? (s.active_coding_duration_ms ? s.active_coding_duration_ms / 60000 : 0))
        .filter((v: number) => typeof v === 'number' && Number.isFinite(v) && v > 0)
        .reduce((sum: number, v: number) => sum + v, 0);

      // Compute runtime minutes for delegated-agent workflows
      const rtMinutes = sessions
        .map(s => s.session_duration_minutes ?? (s.duration_ms ? s.duration_ms / 60000 : 0))
        .filter((v: number) => typeof v === 'number' && Number.isFinite(v) && v > 0)
        .reduce((sum: number, v: number) => sum + v, 0);

      const isDelegated = isDelegatedAgentWorkflow(wf);

      candidates.push({
        workflow: wf,
        sessions,
        sessionCount: sessions.length,
        activeCodingMinutes: acMinutes,
        runtimeMinutes: rtMinutes,
        isDelegated,
        costConfig,
      });
    }

    // CR-X FINAL (Wave 3): need ≥2 workflows in the SAME operational mode
    const humanCount = candidates.filter(c => !c.isDelegated).length;
    const delegatedCount = candidates.filter(c => c.isDelegated).length;
    if (humanCount >= 2 || delegatedCount >= 2) {
      qualifyingMonth = month;
      qualifyingWorkflows = candidates;
      break;
    }
  }

  // Step 3: If no qualifying month, suppress cleanly
  if (!qualifyingMonth || qualifyingWorkflows.length < 2) {
    piDebugLog('[GENERATOR_COST_EFFICIENCY][NO_QUALIFYING_MONTH]', {
      totalSessions: sessionRows.length,
      monthsChecked: sortedMonths.length,
      reason: 'No month with ≥2 primary workflows having ≥25 sessions AND configured cost',
    });
    return null;
  }

  // Step 4: Compute mode-correct cost metrics for each qualifying workflow
  // Human-interactive: cost/active-hour (active coding is the meaningful denominator)
  // Delegated-agent: cost/runtime-hour (runtime is the meaningful denominator)
  // Never compare across modes — active hour and runtime hour are not equivalent
  const costData = qualifyingWorkflows.map(w => {
    const monthlyCost = w.costConfig.monthlySpend;
    const costPerSession = w.sessionCount > 0 ? monthlyCost / w.sessionCount : 0;
    const activeCodingHours = w.activeCodingMinutes / 60;
    const runtimeHours = w.runtimeMinutes / 60;
    const costPerActiveHour = !w.isDelegated && activeCodingHours > 0 ? monthlyCost / activeCodingHours : null;
    const costPerRuntimeHour = w.isDelegated && runtimeHours > 0 ? monthlyCost / runtimeHours : null;

    return {
      workflow: w.workflow,
      sessionCount: w.sessionCount,
      activeCodingMinutes: w.activeCodingMinutes,
      activeCodingHours,
      runtimeHours,
      isDelegated: w.isDelegated,
      monthlyCost,
      seatCount: w.costConfig.seatCount,
      costPerSeatMonthly: w.costConfig.costPerSeatMonthly,
      costPerSession,
      costPerActiveHour,
      costPerRuntimeHour,
    };
  });

  // Step 5: Only compare within the same operational mode
  // Split into human-interactive and delegated-agent groups
  const humanWorkflows = costData.filter(w => !w.isDelegated && w.costPerActiveHour !== null);
  const delegatedWorkflows = costData.filter(w => w.isDelegated && w.costPerRuntimeHour !== null);

  // Need at least 2 workflows in the same mode to compare
  let comparisonGroup: typeof costData;
  let comparisonMetric: 'costPerActiveHour' | 'costPerRuntimeHour';
  let metricLabel: string;

  if (humanWorkflows.length >= 2) {
    comparisonGroup = humanWorkflows;
    comparisonMetric = 'costPerActiveHour';
    metricLabel = 'cost/active hour';
  } else if (delegatedWorkflows.length >= 2) {
    comparisonGroup = delegatedWorkflows;
    comparisonMetric = 'costPerRuntimeHour';
    metricLabel = 'cost/runtime hour';
  } else {
    // No valid within-mode comparison possible — suppress rather than compare incompatible denominators
    piDebugLog('[GENERATOR_COST_EFFICIENCY][NO_WITHIN_MODE_PAIR]', {
      humanCount: humanWorkflows.length,
      delegatedCount: delegatedWorkflows.length,
      reason: 'Need ≥2 workflows in the same operational mode with configured cost',
    });
    return null;
  }

  // Sort by the mode-correct metric descending
  comparisonGroup.sort((a, b) => {
    const aVal = a[comparisonMetric] as number | null;
    const bVal = b[comparisonMetric] as number | null;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return bVal - aVal;
  });

  const highest = comparisonGroup[0];
  const lowest = comparisonGroup[comparisonGroup.length - 1];

  // Step 6: Build headline using mode-correct metric
  const hasZeroCost = highest.monthlyCost === 0 || lowest.monthlyCost === 0;
  const headlineMetric = highest[comparisonMetric] as number | null;
  const baselineMetric = lowest[comparisonMetric] as number | null;

  let title: string;
  let ratio = 0;

  if (hasZeroCost || baselineMetric === null || baselineMetric === 0 || headlineMetric === null) {
    title = `Configured ${metricLabel} varies across primary workflows · ${qualifyingMonth}`;
  } else {
    ratio = headlineMetric / baselineMetric;
    if (ratio > 1.05) {
      title = `Configured ${metricLabel} is ${ratio.toFixed(1)}× higher for ${getCanonicalWorkflowIdentity(highest.workflow)} than ${getCanonicalWorkflowIdentity(lowest.workflow)}`;
    } else if (ratio < 0.95) {
      title = `Configured ${metricLabel} is ${(1 / ratio).toFixed(1)}× higher for ${getCanonicalWorkflowIdentity(lowest.workflow)} than ${getCanonicalWorkflowIdentity(highest.workflow)}`;
    } else {
      title = `Configured ${metricLabel} is similar across primary workflows · ${qualifyingMonth}`;
    }
  }

  // Step 7: Build evidence, description, recommendation
  const totalSessions = comparisonGroup.reduce((sum, w) => sum + w.sessionCount, 0);
  const totalActiveHours = comparisonGroup.reduce((sum, w) => sum + w.activeCodingHours, 0);
  const confidence: ConfidenceLevel = totalSessions >= 100 ? 'high' : 'medium';

  const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
  for (const w of comparisonGroup) {
    const metricVal = w[comparisonMetric] as number | null;
    breakdownByTool[w.workflow] = {
      value: metricVal ?? 0,
      count: w.sessionCount,
      formatted: metricVal !== null ? `$${metricVal.toFixed(2)}/hr` : 'No data',
      label: `${getCanonicalWorkflowIdentity(w.workflow)} (${w.sessionCount} sessions, $${w.monthlyCost.toFixed(0)}/mo)`,
    };
  }

  const evidence = comparisonGroup.map(w => {
    const metricVal = w[comparisonMetric] as number | null;
    const hoursLabel = w.isDelegated
      ? `${w.runtimeHours.toFixed(1)} runtime hrs`
      : `${w.activeCodingHours.toFixed(1)} active hrs`;
    return {
      metric: `${getCanonicalWorkflowIdentity(w.workflow)} ${metricLabel}`,
      value: metricVal !== null ? `$${metricVal.toFixed(2)}/hr` : 'No data',
      label: `${w.sessionCount} sessions, ${hoursLabel}, $${w.monthlyCost.toFixed(0)}/mo configured`,
    };
  });

  // Supporting evidence: cost/session
  const costPerSessionEvidence = comparisonGroup.map(w => ({
    metric: `${getCanonicalWorkflowIdentity(w.workflow)} cost/session`,
    value: `$${w.costPerSession.toFixed(2)}`,
    label: `${w.sessionCount} sessions, $${w.monthlyCost.toFixed(0)}/mo configured`,
  }));

  const description = `Configured rates applied to observed usage · ${qualifyingMonth}. ` +
    `${metricLabel}: ${comparisonGroup.map(w => {
      const v = w[comparisonMetric] as number | null;
      return `${getCanonicalWorkflowIdentity(w.workflow)}=$${v !== null ? v.toFixed(2) : '—'}/hr`;
    }).join(', ')}. ` +
    `Cost/session: ${comparisonGroup.map(w => `${getCanonicalWorkflowIdentity(w.workflow)}=$${w.costPerSession.toFixed(2)}`).join(', ')}. ` +
    `Configured monthly costs: ${comparisonGroup.map(w => `${getCanonicalWorkflowIdentity(w.workflow)}=$${w.monthlyCost.toFixed(0)}`).join(', ')}. ` +
    `Comparison is within ${comparisonGroup[0].isDelegated ? 'delegated-agent' : 'human-interactive'} mode only — cross-mode cost/hour denominators are not equivalent. ` +
    `Current configured rates applied retrospectively to ${qualifyingMonth} observed usage — these are not historical invoices. ` +
    `Configured estimate · Not billing data.`;

  // CR-X P0-B: mode-appropriate recommendation — delegated agents never use
  // active-coding/focus semantics.
  const isDelegatedComparison = comparisonGroup[0].isDelegated;
  const recommendation = isDelegatedComparison
    ? `Compare the configured ${metricLabel} difference with session runtime, task duration, and seat configuration before changing tool policy. ` +
        `If comparable work shows similar engineering behavior, investigate whether the higher configured-cost workflow is justified for specific task classes rather than broad deployment. ` +
        `Configured estimate · Not billing data.`
    : `Compare the configured ${metricLabel} difference with active-coding time, focus, and task mix before changing tool policy. ` +
        `If comparable work shows similar engineering behavior, investigate whether the higher configured-cost workflow is justified for specific task classes rather than broad deployment. ` +
        `Configured estimate · Not billing data.`;

  const executiveSummary = hasZeroCost
    ? `Configured ${metricLabel}: ${comparisonGroup.map(w => {
        const v = w[comparisonMetric] as number | null;
        return `${getCanonicalWorkflowIdentity(w.workflow)}=$${v !== null ? v.toFixed(2) : '—'}/hr`;
      }).join(', ')} · ${qualifyingMonth}`
    : ratio > 1.05
    ? `${getCanonicalWorkflowIdentity(highest.workflow)} configured ${metricLabel} is ${ratio.toFixed(1)}× ${getCanonicalWorkflowIdentity(lowest.workflow)} · ${qualifyingMonth}`
    : ratio < 0.95
    ? `${getCanonicalWorkflowIdentity(lowest.workflow)} configured ${metricLabel} is ${(1 / ratio).toFixed(1)}× ${getCanonicalWorkflowIdentity(highest.workflow)} · ${qualifyingMonth}`
    : `Configured ${metricLabel} is similar across primary workflows · ${qualifyingMonth}`;

  const baseInsight: CanonicalInsight = {
    id: registryEntry.id,
    title,
    cicdStage: registryEntry.stage,
    canonicalPriority: registryEntry.canonicalPriority,
    renderOrder: registryEntry.renderOrder,
    presentationType: 'comparison',
    presentationKind: 'cost_efficiency_comparison',
    comparisonMode: 'workflow_vs_workflow',
    comparisonState: 'workflow_comparable',
    current: headlineMetric ?? 0,
    baseline: baselineMetric ?? 0,
    delta: (headlineMetric ?? 0) - (baselineMetric ?? 0),
    deltaPct: baselineMetric && baselineMetric > 0 ? ((headlineMetric! - baselineMetric) / baselineMetric) * 100 : 0,
    rightMetric: headlineMetric !== null ? `$${headlineMetric.toFixed(2)}/hr` : '—',
    rightMetricLabel: metricLabel,
    metricDefinition: `Configured monthly cost divided by observed ${comparisonGroup[0].isDelegated ? 'runtime' : 'active-coding'} hours in the qualifying month. Configured estimate, not billing data.`,
    displayValue: headlineMetric !== null ? `$${headlineMetric.toFixed(2)}/hr` : '—',
    displayUnit: comparisonGroup[0].isDelegated ? '$/runtime-hour' : '$/active-hour',
    displayDeltaPct: !hasZeroCost && baselineMetric && baselineMetric > 0 ? `${ratio > 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(0)}%` : '—',
    polarity: 'neutral', // Cost efficiency is neutral — higher cost is not "worse"
    operationalBreadcrumbs: [
      `Configured rates applied to observed usage · ${qualifyingMonth}`,
      `${comparisonGroup.length} primary workflows with configured cost (${comparisonGroup[0].isDelegated ? 'delegated-agent' : 'human-interactive'} mode)`,
      `${totalSessions} sessions, ${totalActiveHours.toFixed(1)} ${comparisonGroup[0].isDelegated ? 'runtime' : 'active-coding'} hours in ${qualifyingMonth}`,
    ],
    confidence,
    coveragePct: coveragePct1dp(totalSessions, sessionRows.length),
    n: totalSessions,
    hasData: true,
    dataDomain: ['telemetry', 'configured_cost'],
    sourceLabel: 'Configured Cost (PBT localStorage)',
    sampleUnit: 'sessions',
    sampleLabel: `${totalSessions} sessions in ${qualifyingMonth}`,
    attributionStatus: 'ide_attributed',
    comparisonStatus: 'available',
    description,
    whatChanged: `Configured ${metricLabel}: ${getCanonicalWorkflowIdentity(highest.workflow)} $${headlineMetric !== null ? headlineMetric.toFixed(2) : '—'}/hr vs ${getCanonicalWorkflowIdentity(lowest.workflow)} $${baselineMetric !== null ? baselineMetric.toFixed(2) : '—'}/hr · ${qualifyingMonth}`,
    whyItMatters: `Configured ${metricLabel} normalizes configured spend by observed ${comparisonGroup[0].isDelegated ? 'runtime' : 'active-coding'} use. Differences may reflect tool pricing, seat configuration, session duration, ${comparisonGroup[0].isDelegated ? 'runtime' : 'active-coding'} patterns, or task mix — not productivity. Comparison is within ${comparisonGroup[0].isDelegated ? 'delegated-agent' : 'human-interactive'} mode only. Configured estimate · Not billing data.`,
    recommendation,
    executiveSummary,
    evidenceAndContext: `${description} Period: ${qualifyingMonth}. Configured rates are current and applied retrospectively — not historical invoices.`,
    operationalImpact: `Configured ${metricLabel} difference of ${!hasZeroCost && ratio > 0 ? ratio.toFixed(1) + '×' : 'varies'} across primary workflows in ${qualifyingMonth}.`,
    primaryRisk: 'Configured cost differences may reflect seat count, pricing tier, or task mix — not tool efficiency. Do not interpret as productivity or spend truth.',
    cohort: 'Cross-Tool Cost',
    confidenceReasoning: `${confidence} confidence based on ${totalSessions} sessions across ${comparisonGroup.length} primary workflows in ${qualifyingMonth}. Configured cost from PBT localStorage authority.`,
    recommendationState: 'monitor_only', // Cost is always monitor_only — never action_required
    urgencyLabel: 'monitor',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    evidence: [...evidence, ...costPerSessionEvidence],
    breakdownByTool,
    selectedComparison: { leaderKey: highest.workflow, baselineKey: lowest.workflow },
    operationalRead: `${getCanonicalWorkflowIdentity(highest.workflow)}: $${headlineMetric !== null ? headlineMetric.toFixed(2) : '—'}/hr vs ${getCanonicalWorkflowIdentity(lowest.workflow)}: $${baselineMetric !== null ? baselineMetric.toFixed(2) : '—'}/hr · ${qualifyingMonth}. Configured estimate · Not billing data.`,
    isExecutiveFinding: registryEntry.isExecutiveFinding,
    isDiagnostic: false,
  };

  return baseInsight;
}

/**
 * Generate workflow-session-distribution insight (one per qualifying workflow).
 *
 * CR-X 1A.6B: Analyzes the session-duration distribution shape within a single
 * workflow. Identifies workflows with materially skewed distributions (long
 * session tails) that reveal agent-workflow characteristics.
 *
 * Gates:
 * - Minimum 50 sessions per workflow (adequate sample size)
 * - p90/p50 ratio > 5x (material skew threshold)
 * - No known instrumentation artifact dominating the finding
 *
 * Produces one insight per qualifying workflow. Workflows with normal
 * distributions (p90/p50 < 5x) do NOT produce a card — this is not a
 * routine distribution report, it is a material-skew finding.
 *
 * Metric: session_duration_minutes
 * No productivity claim. Describes workflow shape.
 */
export function generateWorkflowSessionDistribution(input: CanonicalInsightInput): CanonicalInsight[] | null {
  try {
    piDebugLog('[GENERATOR_SESSION_DISTRIBUTION][START]', 'Generating workflow-session-distribution per-workflow instances');
    const registryEntry = getCanonicalPIById('workflow-session-distribution');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'Session distribution analysis needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Distribution Shape',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires at least 50 sessions within a workflow with materially skewed duration distribution',
        description: 'No telemetry sessions available for session distribution analysis.',
      }];
    }

    // Group sessions by workflow
    const sessionsByWorkflow: Record<string, any[]> = {};
    for (const s of sessionRows) {
      const wf = normalizeToCanonicalToolId(s.tool ?? s.session_source ?? s.editor_source ?? s.source ?? 'unknown');
      if (!sessionsByWorkflow[wf]) sessionsByWorkflow[wf] = [];
      sessionsByWorkflow[wf].push(s);
    }

    const MIN_SESSIONS = 50;
    const MATERIAL_SKEW_THRESHOLD = 5; // p90/p50 > 5x

    const allWorkflowDistributions: Array<{
      workflow: string;
      n: number;
      p50: number;
      p90: number;
      p90p50: number;
      over4h: number;
      over4hPct: number;
      over8h: number;
      over8hPct: number;
    }> = [];

    for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
      if (sessions.length < MIN_SESSIONS) continue;

      const durVals = sessions
        .map(s => s.session_duration_minutes)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b);

      if (durVals.length < MIN_SESSIONS) continue;

      const p50 = percentile(durVals, 50);
      const p90 = percentile(durVals, 90);
      const p90p50 = p50 > 0 ? p90 / p50 : 0;

      // Only emit for materially skewed distributions
      if (p90p50 < MATERIAL_SKEW_THRESHOLD) continue;

      const over4h = durVals.filter(v => v >= 240).length;
      const over8h = durVals.filter(v => v >= 480).length;

      allWorkflowDistributions.push({
        workflow,
        n: durVals.length,
        p50,
        p90,
        p90p50,
        over4h,
        over4hPct: (over4h / durVals.length) * 100,
        over8h,
        over8hPct: (over8h / durVals.length) * 100,
      });
    }

    // Sort by skew (most skewed first)
    allWorkflowDistributions.sort((a, b) => b.p90p50 - a.p90p50);

    if (allWorkflowDistributions.length === 0) {
      // No workflow has a materially skewed distribution — return null (no card)
      // This is NOT a diagnostic; it means the data is healthy/normal.
      return null;
    }

    const instances: CanonicalInsight[] = [];
    for (let i = 0; i < allWorkflowDistributions.length; i++) {
      const wd = allWorkflowDistributions[i];
      const wfName = getCanonicalWorkflowIdentity(wd.workflow).replace(' workflow', '');

      // Format p90 in human-readable units
      const p90Formatted = wd.p90 >= 60
        ? `${(wd.p90 / 60).toFixed(1)} hours`
        : `${wd.p90.toFixed(0)} min`;
      const p50Formatted = wd.p50 >= 60
        ? `${(wd.p50 / 60).toFixed(1)} hours`
        : `${wd.p50.toFixed(0)} min`;

      instances.push({
        id: `${registryEntry.id}__${wd.workflow}`,
        title: `${wfName}'s longest 10% of sessions exceed ${p90Formatted}`,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder + i / 100,
        presentationType: 'evidence_only',
        presentationKind: 'distribution_shape',
        comparisonMode: 'absolute',
        comparisonState: 'workflow_comparable',
        current: wd.p90,
        baseline: wd.p50,
        delta: wd.p90 - wd.p50,
        deltaPct: wd.p50 > 0 ? Math.round(((wd.p90 - wd.p50) / wd.p50) * 100) : 0,
        displayValue: p90Formatted,
        displayDeltaPct: `${wd.p90p50.toFixed(1)}× longer than median`,
        rightMetric: p50Formatted,
        rightMetricLabel: 'Median (p50)',
        polarity: 'neutral',
        confidence: wd.n >= 100 ? 'high' : 'medium',
        coveragePct: coveragePct1dp(wd.n, sessionRows.length),
        n: wd.n,
        hasData: true,
        description: `${wfName} session duration distribution: p50=${p50Formatted}, p90=${p90Formatted}, p90/p50=${wd.p90p50.toFixed(1)}x. ${wd.over4hPct.toFixed(1)}% of sessions exceed 4 hours, ${wd.over8hPct.toFixed(1)}% exceed 8 hours. This describes workflow shape, not productivity or delivery impact.`,
        recommendation: `Investigate whether long-running ${wfName} sessions represent intended autonomous agent work, task complexity, or sessions left open/unattended. The long-session tail (${wd.over4hPct.toFixed(1)}% >4h) may reflect agent workflow characteristics distinct from IDE session patterns.`,
        executiveSummary: `${wfName} distribution shape: p50=${p50Formatted}, p90=${p90Formatted} (${wd.p90p50.toFixed(1)}x ratio). ${wd.over4hPct.toFixed(1)}% of sessions >4h.`,
        evidence: [
          { metric: 'Median (p50)', value: p50Formatted, label: 'Session duration p50' },
          { metric: '90th percentile (p90)', value: p90Formatted, label: 'Session duration p90' },
          { metric: 'p90/p50 ratio', value: `${wd.p90p50.toFixed(1)}x`, label: 'Distribution skew' },
          { metric: 'Sessions >4h', value: `${wd.over4h} (${wd.over4hPct.toFixed(1)}%)`, label: 'Long-session tail' },
          { metric: 'Sessions >8h', value: `${wd.over8h} (${wd.over8hPct.toFixed(1)}%)`, label: 'Extended-session tail' },
          { metric: 'Sample size', value: `${wd.n} sessions`, label: 'Workflow population' },
        ],
        breakdownByTool: {
          [`${wd.workflow}_p50`]: { value: wd.p50, count: wd.n, formatted: p50Formatted, label: `${wfName} · Median (p50)` },
          [`${wd.workflow}_p90`]: { value: wd.p90, count: wd.n, formatted: p90Formatted, label: `${wfName} · p90` },
        },
        whatChanged: `Session duration distribution shape within ${wfName} (N=${wd.n}, p90/p50=${wd.p90p50.toFixed(1)}x)`,
        whyItMatters: `A materially skewed duration distribution reveals workflow characteristics unique to ${wfName}. The long-session tail may represent autonomous agent work, complex tasks, or unattended sessions.`,
        operationalImpact: `${wfName} p90 sessions (${p90Formatted}) are ${wd.p90p50.toFixed(1)}x longer than median sessions (${p50Formatted}).`,
        cohort: `${wfName} (N=${wd.n})`,
        confidenceReasoning: `Distribution analysis with ${wd.n} sessions within ${wfName}. Percentile-based. Material skew threshold: p90/p50 > ${MATERIAL_SKEW_THRESHOLD}x.`,
        operationalRead: `${wfName}: p50=${p50Formatted}, p90=${p90Formatted}, ${wd.over4hPct.toFixed(1)}% >4h, ${wd.over8hPct.toFixed(1)}% >8h`,
        urgencyLabel: 'monitor',
        metricDefinition: 'Session duration distribution shape (p50, p90, p90/p50 ratio, long-session tail) within a single workflow',
        isExecutiveFinding: registryEntry.isExecutiveFinding,
        dataSource: 'live',
      });
    }

    return instances;
  } catch (err) {
    piDebugLog('[GENERATOR_SESSION_DISTRIBUTION][ERROR]', err);
    return null;
  }
}

/**
 * Percentile helper — returns the p-th percentile from a sorted array.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  // Linear interpolation
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * CR-X 2026-08-30 — Generate observed session overlap and concurrency insight.
 *
 * Reports org-wide observed session overlap metrics per workflow:
 * - additive observed session runtime (Σ duration)
 * - unique wall-clock span (UNION of intervals)
 * - overlap factor (additive / unique)
 * - max simultaneously observed sessions
 * - sessions participating in overlap
 *
 * CRITICAL SEMANTICS (P0-2):
 * Org-wide overlap is NOT evidence of one engineer operating multiple agents
 * concurrently. Overlapping sessions across an organization may belong to
 * different developers. Only same-developer overlap (when developer identity
 * is stable) may be classified as a decision finding.
 *
 * Identity stability check:
 * - If user_id is unique per session (sessions/user_id ≈ 1.0), identity is
 *   NOT stable. Org-wide overlap is contextual only.
 * - If user_id is stable (sessions/user_id > 3.0), same-developer overlap
 *   is computed and may be decision-grade.
 *
 * This is generic and identity-aware — foundational to the concurrent-agent
 * time question.
 *
 * Gates:
 * - Minimum 30 sessions per workflow with valid intervals
 * - overlap_factor > 1.2 (material overlap threshold)
 * - sessions_in_overlap >= 10
 */
export function generateObservedSessionOverlap(input: CanonicalInsightInput): CanonicalInsight[] | null {
  try {
    piDebugLog('[GENERATOR_SESSION_OVERLAP][START]', 'Generating observed-session-overlap per-workflow instances');
    const registryEntry = getCanonicalPIById('observed-session-overlap');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'Observed session overlap needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Overlap factor',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires sessions with timestamp + duration_ms for overlap analysis',
        description: 'No telemetry sessions available for observed session overlap analysis.',
      }];
    }

    // Group sessions by workflow
    const sessionsByWorkflow: Record<string, any[]> = {};
    for (const s of sessionRows) {
      const wf = normalizeToCanonicalToolId(s.tool ?? s.session_source ?? s.editor_source ?? s.source ?? 'unknown');
      if (!sessionsByWorkflow[wf]) sessionsByWorkflow[wf] = [];
      sessionsByWorkflow[wf].push(s);
    }

    const MIN_SESSIONS = 30;
    const MATERIAL_OVERLAP = 1.2;
    const MIN_OVERLAP_SESSIONS = 10;
    // Identity stability: if sessions per user_id < 3, identity is not stable
    const IDENTITY_STABILITY_THRESHOLD = 3.0;

    const instances: CanonicalInsight[] = [];
    let instanceIndex = 0;

    for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
      if (sessions.length < MIN_SESSIONS) continue;

      const concurrency = computeConcurrency(sessions);

      if (concurrency.valid_interval_sessions < MIN_SESSIONS) continue;
      if (concurrency.parallelism_factor < MATERIAL_OVERLAP) continue;
      if (concurrency.sessions_in_overlap < MIN_OVERLAP_SESSIONS) continue;

      const wfName = getCanonicalWorkflowIdentity(workflow).replace(' workflow', '');
      const additiveHours = concurrency.additive_agent_runtime_ms / 3600000;
      const uniqueHours = concurrency.unique_session_wall_clock_span_ms / 3600000;
      const overlapPct = Math.round((concurrency.sessions_in_overlap / concurrency.valid_interval_sessions) * 100);

      // CR-X P0-2: Identity stability check
      // Check if user_id is a stable developer identity for this workflow
      const userIds = sessions.map(s => s.user_id).filter(Boolean);
      const distinctUserIds = new Set(userIds);
      const sessionsPerUserId = distinctUserIds.size > 0
        ? sessions.length / distinctUserIds.size
        : 0;
      const identityStable = sessionsPerUserId >= IDENTITY_STABILITY_THRESHOLD;

      // Compute same-developer overlap when identity is stable
      let sameDeveloperOverlapPairs = 0;
      let sameDeveloperMaxConcurrent = 0;
      let sameDeveloperSessionsInOverlap = 0;
      if (identityStable) {
        // Group sessions by user_id and compute overlap within each developer
        const sessionsByDev: Record<string, any[]> = {};
        for (const s of sessions) {
          const uid = s.user_id;
          if (!uid) continue;
          if (!sessionsByDev[uid]) sessionsByDev[uid] = [];
          sessionsByDev[uid].push(s);
        }
        for (const devSessions of Object.values(sessionsByDev)) {
          if (devSessions.length < 2) continue;
          const devConcurrency = computeConcurrency(devSessions);
          sameDeveloperOverlapPairs += devConcurrency.overlapping_session_count;
          sameDeveloperMaxConcurrent = Math.max(sameDeveloperMaxConcurrent, devConcurrency.max_concurrent_sessions);
          sameDeveloperSessionsInOverlap += devConcurrency.sessions_in_overlap;
        }
      }

      // CR-X P0-B: FAIL CLOSED — concurrency insight must NOT claim
      // "same-developer" concurrency or enter Top Insights until developer
      // identity + workflow attribution + concurrency semantics are
      // authoritative. user_id stability (sessionsPerUserId >= 3) is
      // necessary but NOT sufficient — user_id may be a synthetic/org-level
      // identifier, not a proven developer identity. Overlapping session
      // intervals do not prove one developer operated multiple agents.
      //
      // Classification: ALWAYS diagnostic/contextual.
      // - isDiagnostic: true → excluded from Top Insights by ranking.ts
      // - isTopInsightEligible: false → explicit guard
      // - recommendationState: 'monitor_only' → no action claim
      // - lifecycleClass: 'contextual' → not a decision finding
      // - Title: observational, no "same-developer" claim, no named workflow
      const lifecycleClass = 'contextual';

      const title = `Observed session overlap: ${additiveHours.toFixed(0)}h additive runtime over ${uniqueHours.toFixed(0)}h wall-clock span (overlap factor ${concurrency.parallelism_factor.toFixed(2)}x, max ${concurrency.max_concurrent_sessions} simultaneous)`;

      instances.push({
        id: `${registryEntry.id}__${workflow}`,
        title,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder + instanceIndex / 100,
        presentationType: 'evidence_only',
        presentationKind: 'org_summary',
        comparisonMode: 'absolute',
        comparisonState: 'workflow_comparable',
        current: concurrency.parallelism_factor,
        baseline: 1.0,
        delta: concurrency.parallelism_factor - 1.0,
        deltaPct: Math.round((concurrency.parallelism_factor - 1.0) * 100),
        displayValue: `${concurrency.parallelism_factor.toFixed(2)}x`,
        displayDeltaPct: `+${Math.round((concurrency.parallelism_factor - 1.0) * 100)}%`,
        rightMetric: `${concurrency.max_concurrent_sessions}`,
        rightMetricLabel: 'Max simultaneous',
        polarity: 'neutral',
        confidence: concurrency.valid_interval_sessions >= 100 ? 'high' : 'medium',
        coveragePct: coveragePct1dp(concurrency.valid_interval_sessions, sessions.length),
        n: concurrency.valid_interval_sessions,
        hasData: true,
        breakdownByTool: {
          [`${workflow}_overlap`]: {
            value: concurrency.parallelism_factor,
            count: concurrency.valid_interval_sessions,
            formatted: `${concurrency.parallelism_factor.toFixed(2)}x`,
            label: `${wfName} overlap factor`,
          },
          [`${workflow}_additive`]: {
            value: additiveHours,
            count: concurrency.valid_interval_sessions,
            formatted: `${additiveHours.toFixed(1)}h`,
            label: `${wfName} additive runtime`,
          },
          [`${workflow}_unique`]: {
            value: uniqueHours,
            count: concurrency.valid_interval_sessions,
            formatted: `${uniqueHours.toFixed(1)}h`,
            label: `${wfName} wall-clock span`,
          },
        },
        description: `Observed session overlap: ${overlapPct}% of ${concurrency.valid_interval_sessions} sessions overlap with at least one other. Additive observed session runtime: ${additiveHours.toFixed(1)}h. Unique wall-clock span: ${uniqueHours.toFixed(1)}h. Overlap factor: ${concurrency.parallelism_factor.toFixed(2)}x. Max simultaneously observed: ${concurrency.max_concurrent_sessions} sessions. These are observed session intervals, NOT human active time. Org-wide overlap does NOT prove one developer operated multiple agents concurrently. Developer identity attribution is not authoritative enough to claim same-developer concurrency.`,
        recommendation: `Observed session overlap (factor ${concurrency.parallelism_factor.toFixed(2)}x) is an observational metric. Overlapping sessions across an organization may belong to different developers. Do not infer that one engineer operated multiple agents concurrently from org-wide overlap alone. Developer identity attribution and concurrency semantics are not yet authoritative.`,
        executiveSummary: `Overlap: factor ${concurrency.parallelism_factor.toFixed(2)}x (${additiveHours.toFixed(0)}h additive / ${uniqueHours.toFixed(0)}h unique). Max ${concurrency.max_concurrent_sessions} simultaneous. Diagnostic — developer identity not authoritative.`,
        evidence: [
          { metric: 'Additive observed session runtime', value: `${additiveHours.toFixed(1)}h`, label: 'Σ(session duration)' },
          { metric: 'Unique wall-clock span', value: `${uniqueHours.toFixed(1)}h`, label: 'UNION(session intervals)' },
          { metric: 'Overlap factor', value: `${concurrency.parallelism_factor.toFixed(2)}x`, label: 'additive / unique' },
          { metric: 'Max simultaneously observed', value: `${concurrency.max_concurrent_sessions}`, label: 'peak simultaneous sessions (org-wide)' },
          { metric: 'Sessions in overlap', value: `${concurrency.sessions_in_overlap}/${concurrency.valid_interval_sessions}`, label: `${overlapPct}% participate in ≥1 overlap` },
          { metric: 'Developer identity', value: 'NOT AUTHORITATIVE', label: 'user_id stability insufficient for same-developer claims' },
        ],
        whatChanged: `Observed session overlap: overlap factor ${concurrency.parallelism_factor.toFixed(2)}x across ${concurrency.valid_interval_sessions} sessions`,
        whyItMatters: `Sessions overlap at the org level (factor ${concurrency.parallelism_factor.toFixed(2)}x). Org-wide overlap does NOT prove same-developer concurrent agent execution. This is observed session interval overlap, NOT human active time or developer attention. Developer identity attribution is not authoritative enough to claim same-developer concurrency.`,
        operationalImpact: `${additiveHours.toFixed(0)}h additive observed runtime over ${uniqueHours.toFixed(0)}h wall-clock span. Max ${concurrency.max_concurrent_sessions} simultaneous (org-wide). Developer identity not authoritative.`,
        cohort: `N=${concurrency.valid_interval_sessions}, ${concurrency.overlapping_session_count} overlapping pairs, developer identity not authoritative`,
        confidenceReasoning: `Sweep-line overlap analysis on ${concurrency.valid_interval_sessions} sessions with valid timestamp + duration. Overlap factor ${concurrency.parallelism_factor.toFixed(2)}x exceeds material threshold (${MATERIAL_OVERLAP}x). Developer identity attribution is NOT authoritative — user_id stability (${sessionsPerUserId.toFixed(1)} sessions/user) is necessary but not sufficient. Same-developer concurrency claims are suppressed until identity semantics are proven.`,
        operationalRead: `Overlap factor ${concurrency.parallelism_factor.toFixed(2)}x, ${additiveHours.toFixed(0)}h additive / ${uniqueHours.toFixed(0)}h unique, max ${concurrency.max_concurrent_sessions} simultaneous, ${overlapPct}% overlap, diagnostic — developer identity not authoritative`,
        urgencyLabel: 'monitor',
        recommendationState: 'monitor_only',
        isDiagnostic: true,
        isTopInsightEligible: false,
        diagnosticReason: 'DEVELOPER_IDENTITY_NOT_AUTHORITATIVE',
        diagnosticUnlockPath: 'Requires authoritative developer identity + workflow attribution + concurrency semantics before same-developer claims',
        lifecycleClass,
        metricDefinition: 'Overlap factor = additive observed session runtime (Σ duration) / unique wall-clock span (UNION of intervals). Org-wide overlap is NOT same-developer concurrency. Observed session runtime is NOT human active time. Developer identity attribution is not authoritative.',
        isExecutiveFinding: false,
        dataSource: 'live',
      });
      instanceIndex++;
    }

    if (instances.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'No material observed session overlap detected',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Overlap factor',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: `Requires a workflow with ${MIN_SESSIONS}+ sessions, overlap factor > ${MATERIAL_OVERLAP}x, and ${MIN_OVERLAP_SESSIONS}+ sessions in overlap`,
        description: 'No workflow shows material observed session overlap (overlap factor > 1.2x with sufficient overlapping sessions).',
      }];
    }

    return instances;
  } catch (err) {
    piDebugLog('[GENERATOR_SESSION_OVERLAP][ERROR]', err);
    return null;
  }
}

/**
 * CR-X 2026-08-30 P0-4 — Generate repository distribution by workflow insight.
 *
 * Compares how sessions are distributed across repositories between workflows.
 * When workflows show materially different repo concentration patterns
 * (e.g., Claude concentrated in backend repos while VS Code is spread across
 * frontend repos), this is a decision-grade finding about workflow-task
 * allocation.
 *
 * Gates:
 * - Minimum 30 sessions per workflow with repo attribution
 * - Top-3 repo concentration differs by ≥15pp between workflows
 * - At least 2 workflows with sufficient data
 */
export function generateRepositoryDistributionByWorkflow(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    piDebugLog('[GENERATOR_REPO_DIST_BY_WF][START]', 'Generating repository-distribution-by-workflow');
    const registryEntry = getCanonicalPIById('repository-distribution-by-workflow');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length === 0) {
      return {
        id: registryEntry.id,
        title: 'Repository distribution by workflow needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Concentration gap',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires sessions with git_repo_url attribution across multiple workflows',
        description: 'No telemetry sessions available for repository distribution analysis.',
      };
    }

    // Group sessions by workflow and count repos per workflow
    const MIN_SESSIONS = 30;
    const workflowRepoCounts: Record<string, Record<string, number>> = {};
    const workflowTotalWithRepo: Record<string, number> = {};

    for (const s of sessionRows) {
      const wf = normalizeToCanonicalToolId(s.tool ?? s.session_source ?? s.editor_source ?? s.source ?? 'unknown');
      const repo = normalizeRepoUrl(s.git_repo_url);
      if (!repo || !isRenderableRepoLabel(repo)) continue;
      if (!workflowRepoCounts[wf]) {
        workflowRepoCounts[wf] = {};
        workflowTotalWithRepo[wf] = 0;
      }
      workflowRepoCounts[wf][repo] = (workflowRepoCounts[wf][repo] || 0) + 1;
      workflowTotalWithRepo[wf]++;
    }

    // Filter to workflows with sufficient data
    const qualifyingWorkflows = Object.entries(workflowRepoCounts)
      .filter(([wf, repos]) => workflowTotalWithRepo[wf] >= MIN_SESSIONS && Object.keys(repos).length >= 2)
      .map(([wf, repos]) => ({ workflow: wf, repos, total: workflowTotalWithRepo[wf] }));

    if (qualifyingWorkflows.length < 2) {
      return {
        id: registryEntry.id,
        title: 'Repository distribution by workflow needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Concentration gap',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: `Requires at least 2 workflows with ${MIN_SESSIONS}+ sessions each with repo attribution`,
        description: 'Insufficient workflows with repository attribution for cross-workflow comparison.',
      };
    }

    // Compute top-3 concentration for each workflow
    const workflowConcentrations = qualifyingWorkflows.map(({ workflow, repos, total }) => {
      const sorted = Object.entries(repos).sort((a, b) => b[1] - a[1]);
      const top3Share = (sorted.slice(0, 3).reduce((sum, [, c]) => sum + c, 0) / total) * 100;
      const topRepo = sorted[0];
      const topRepoShare = (topRepo[1] / total) * 100;
      return {
        workflow,
        sortedRepos: sorted,
        top3Share,
        topRepo,
        topRepoShare,
        total,
        distinctRepos: sorted.length,
      };
    });

    // Find the maximum concentration gap between any two workflows
    let maxGap = 0;
    let maxGapPair: [typeof workflowConcentrations[0], typeof workflowConcentrations[0]] | null = null;
    for (let i = 0; i < workflowConcentrations.length; i++) {
      for (let j = i + 1; j < workflowConcentrations.length; j++) {
        const gap = Math.abs(workflowConcentrations[i].top3Share - workflowConcentrations[j].top3Share);
        if (gap > maxGap) {
          maxGap = gap;
          maxGapPair = [workflowConcentrations[i], workflowConcentrations[j]];
        }
      }
    }

    const MATERIAL_GAP = 15; // 15 percentage points
    if (maxGap < MATERIAL_GAP || !maxGapPair) {
      // No material difference in repo distribution between workflows — suppress
      // this low-value baseline. It is not independently decision-useful.
      return null;
    }

    // Material gap detected — build the decision finding
    const [higher, lower] = maxGapPair[0].top3Share > maxGapPair[1].top3Share
      ? [maxGapPair[0], maxGapPair[1]]
      : [maxGapPair[1], maxGapPair[0]];

    const higherName = getCanonicalWorkflowIdentity(higher.workflow).replace(' workflow', '');
    const lowerName = getCanonicalWorkflowIdentity(lower.workflow).replace(' workflow', '');

    // Build top-3 repo descriptions for each workflow
    const higherTop3 = higher.sortedRepos.slice(0, 3).map(([repo, count]) => ({
      repo,
      count,
      share: (count / higher.total * 100).toFixed(1),
    }));
    const lowerTop3 = lower.sortedRepos.slice(0, 3).map(([repo, count]) => ({
      repo,
      count,
      share: (count / lower.total * 100).toFixed(1),
    }));

    // Fail closed: every repo identity interpolated into the title/description
    // must render a real label. Blank/placeholder identities produce malformed
    // prose ("concentrate in  + 2 repos") — suppress the finding instead.
    if (!higherTop3.every(r => isRenderableRepoLabel(r.repo)) ||
        !lowerTop3.every(r => isRenderableRepoLabel(r.repo))) {
      return null;
    }

    const higherTop3Str = higherTop3.map(r => `${repoDisplayLabel(r.repo)} (${r.share}%)`).join(', ');
    const lowerTop3Str = lowerTop3.map(r => `${repoDisplayLabel(r.repo)} (${r.share}%)`).join(', ');

    const title = `${higherName} sessions concentrate in ${repoDisplayLabel(higherTop3[0].repo)} + 2 repos (${higher.top3Share.toFixed(0)}% top-3) while ${lowerName} spreads across ${lower.distinctRepos} repos (${lower.top3Share.toFixed(0)}% top-3) — ${maxGap.toFixed(0)}pp gap`;

    // This finding compares exactly two workflows (the max-gap pair). The
    // breakdown must contain ONLY that pair — emitting every qualifying
    // workflow leaks unrelated third workflows into the detail grid.
    const breakdownByTool: Record<string, { value: number; count: number; formatted: string; label: string }> = {};
    for (const wc of [higher, lower]) {
      const wfName = getCanonicalWorkflowIdentity(wc.workflow).replace(' workflow', '');
      breakdownByTool[`${wc.workflow}_top3`] = {
        value: wc.top3Share,
        count: wc.total,
        formatted: `${wc.top3Share.toFixed(1)}%`,
        label: `${wfName} top-3 repo concentration`,
      };
      breakdownByTool[`${wc.workflow}_repos`] = {
        value: wc.distinctRepos,
        count: wc.total,
        formatted: `${wc.distinctRepos}`,
        label: `${wfName} distinct repos`,
      };
    }

    return {
      id: registryEntry.id,
      title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'comparison',
      presentationKind: 'workflow_comparison',
      comparisonMode: 'absolute',
      comparisonState: 'workflow_comparable',
      selectedComparison: {
        leaderKey: `${higher.workflow}_top3`,
        baselineKey: `${lower.workflow}_top3`,
      },
      current: higher.top3Share,
      baseline: lower.top3Share,
      delta: maxGap,
      deltaPct: Math.round((maxGap / lower.top3Share) * 100),
      displayValue: `${higher.top3Share.toFixed(0)}%`,
      displayDeltaPct: `+${maxGap.toFixed(0)}pp`,
      rightMetric: `${lower.top3Share.toFixed(0)}%`,
      rightMetricLabel: `${lowerName} top-3`,
      polarity: 'neutral',
      confidence: qualifyingWorkflows.reduce((s, w) => s + w.total, 0) >= 100 ? 'high' : 'medium',
      coveragePct: coveragePct1dp(qualifyingWorkflows.reduce((s, w) => s + w.total, 0), sessionRows.length),
      n: qualifyingWorkflows.reduce((s, w) => s + w.total, 0),
      hasData: true,
      breakdownByTool,
      description: `${higherName} sessions concentrate in ${higherTop3Str} (${higher.top3Share.toFixed(1)}% top-3, ${higher.distinctRepos} distinct repos, N=${higher.total}). ${lowerName} sessions spread across ${lowerTop3Str} (${lower.top3Share.toFixed(1)}% top-3, ${lower.distinctRepos} distinct repos, N=${lower.total}). The ${maxGap.toFixed(1)}pp concentration gap indicates materially different workflow-task allocation patterns.`,
      recommendation: `${higherName} is concentrated in fewer repositories (${higher.distinctRepos} repos, top-3 = ${higher.top3Share.toFixed(0)}%) while ${lowerName} spreads across more (${lower.distinctRepos} repos, top-3 = ${lower.top3Share.toFixed(0)}%). This may reflect intentional workflow-task allocation (e.g., agentic tools for complex backend work, IDE for broad frontend work) or an opportunity to expand ${higherName} usage to additional repos. Investigate whether the concentration is strategic or a coverage gap.`,
      executiveSummary: `${higherName} top-3 repo concentration: ${higher.top3Share.toFixed(0)}% (${higher.distinctRepos} repos). ${lowerName}: ${lower.top3Share.toFixed(0)}% (${lower.distinctRepos} repos). Gap: ${maxGap.toFixed(0)}pp.`,
      evidence: [
        { metric: `${higherName} top-3 concentration`, value: `${higher.top3Share.toFixed(1)}%`, label: `${higher.distinctRepos} distinct repos, N=${higher.total}` },
        { metric: `${lowerName} top-3 concentration`, value: `${lower.top3Share.toFixed(1)}%`, label: `${lower.distinctRepos} distinct repos, N=${lower.total}` },
        { metric: 'Concentration gap', value: `${maxGap.toFixed(1)}pp`, label: 'top-3 share difference' },
        { metric: `${higherName} top repos`, value: higherTop3Str, label: 'top-3 by session count' },
        { metric: `${lowerName} top repos`, value: lowerTop3Str, label: 'top-3 by session count' },
      ],
      whatChanged: `Repository distribution gap of ${maxGap.toFixed(0)}pp detected between ${higherName} and ${lowerName}`,
      whyItMatters: `Workflows show materially different repository concentration patterns. ${higherName} concentrates in ${higher.distinctRepos} repos (${higher.top3Share.toFixed(0)}% top-3) while ${lowerName} spreads across ${lower.distinctRepos} repos (${lower.top3Share.toFixed(0)}% top-3). This reflects different workflow-task allocation — investigate whether it's strategic or a coverage gap.`,
      operationalImpact: `${higherName}: ${higher.top3Share.toFixed(0)}% in top-3 repos. ${lowerName}: ${lower.top3Share.toFixed(0)}% in top-3. Gap: ${maxGap.toFixed(0)}pp.`,
      cohort: `${higherName} (N=${higher.total}, ${higher.distinctRepos} repos) vs ${lowerName} (N=${lower.total}, ${lower.distinctRepos} repos)`,
      confidenceReasoning: `Cross-workflow repo distribution comparison. ${qualifyingWorkflows.length} workflows with ≥${MIN_SESSIONS} sessions each. Concentration gap ${maxGap.toFixed(1)}pp exceeds material threshold (${MATERIAL_GAP}pp). Repo URLs normalized via normalizeRepoUrl().`,
      operationalRead: `${higherName}: ${higher.top3Share.toFixed(0)}% top-3 (${higher.distinctRepos} repos). ${lowerName}: ${lower.top3Share.toFixed(0)}% top-3 (${lower.distinctRepos} repos). Gap: ${maxGap.toFixed(0)}pp.`,
      urgencyLabel: 'investigate',
      recommendationState: 'investigate',
      lifecycleClass: 'decision',
      metricDefinition: 'Top-3 repository concentration = (sum of top-3 repos by session count / total sessions with repo attribution) × 100. Concentration gap = |top3_A - top3_B|. Repository identity normalized via normalizeRepoUrl().',
      isExecutiveFinding: registryEntry.isExecutiveFinding,
      dataSource: 'live',
    };
  } catch (err) {
    piDebugLog('[GENERATOR_REPO_DIST_BY_WF][ERROR]', err);
    return null;
  }
}

/**
 * CR-X B: Within-workflow AI signal coverage.
 *
 * Shows what percentage of sessions within a single workflow have observed
 * AI signals (ai_burst_count > 0) vs non-AI sessions.
 *
 * This is INSTRUMENTATION HEALTH, not a causal AI-vs-non-AI comparison.
 * Semantic: "AI-assisted sessions" / "non-AI sessions"
 * NOT "AI-assisted vs traditional" (which implies a causal/control distinction
 * the instrumentation does not prove).
 *
 * Works for single-workflow pilots — no cross-tool comparison required.
 * Threshold: 15 sessions per workflow (lower than within-workflow-ai-effect's 20).
 */
export function generateWithinWorkflowAISignalCoverage(input: CanonicalInsightInput): CanonicalInsight[] | null {
  try {
    piDebugLog('[GENERATOR_AI_SIGNAL_COVERAGE][START]', 'Generating within-workflow-ai-signal-coverage per-workflow instances');
    const registryEntry = getCanonicalPIById('within-workflow-ai-signal-coverage');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'AI usage coverage needs more sessions to measure',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'AI Signal Coverage',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires at least 15 sessions within a workflow to assess AI signal coverage',
        description: 'No telemetry sessions available for AI signal coverage analysis.',
      }];
    }

    const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
    const MIN_SESSIONS = 15;
    let skippedForInstrumentation = false;
    const allWorkflowCoverage: Array<{
      workflow: string;
      total: number;
      withAiSignals: number;
      zeroAiSignals: number;
      coveragePct: number;
    }> = [];

    for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
      if (sessions.length < MIN_SESSIONS) continue;

      // CR-X DEMO: The AI-signal metric must only run on workflows whose
      // bridge actually instruments ai_burst_count. Lifecycle-only bridges
      // (e.g. Codex) never emit AI-burst signals — a 0% coverage finding
      // ("zero observed AI signals") would falsely claim measured evidence
      // that the workflow "may not use AI". Unsupported != measured zero.
      if (!isMetricInstrumentedForWorkflow(workflow, 'ai_burst_count')) {
        skippedForInstrumentation = true;
        continue;
      }

      // CR-X Pass 3: Zero is measured data, not missing. Sessions with
      // missing ai_burst_count (undefined/null/NaN) are excluded from both
      // the "with AI signals" and "zero AI signals" counts. The coverage
      // percentage is computed over sessions with measured ai_burst_count.
      const measuredSessions = sessions.filter(s =>
        typeof s.ai_burst_count === 'number' && Number.isFinite(s.ai_burst_count)
      );
      const withAiSignals = measuredSessions.filter(s => s.ai_burst_count > 0).length;
      const zeroAiSignals = measuredSessions.filter(s => s.ai_burst_count === 0).length;
      const missingAiSignals = sessions.length - measuredSessions.length;
      const measuredTotal = measuredSessions.length;
      // CR-X semantic fix: coveragePct is the fraction of ALL sessions (total)
      // that have AI-assisted, not just measured sessions. The title
      // says "X% of sessions have AI-assisted" — the denominator must
      // match "sessions" (total), not "measured sessions". Previously used
      // withAiSignals / measuredTotal, which produced 100% when all measured
      // sessions had AI signals even though many sessions had missing
      // ai_burst_count.
      const pct = sessions.length > 0 ? (withAiSignals / sessions.length) * 100 : 0;

      allWorkflowCoverage.push({
        workflow,
        total: sessions.length,
        withAiSignals,
        zeroAiSignals,
        coveragePct: pct,
      });
    }

    if (allWorkflowCoverage.length === 0) {
      // Every eligible workflow was skipped because its bridge does not
      // instrument ai_burst_count (e.g. Codex lifecycle-only telemetry).
      // Suppress entirely — a "needs more sessions" diagnostic would falsely
      // imply the metric becomes available once volume grows.
      if (skippedForInstrumentation) return [];
      return [{
        id: registryEntry.id,
        title: 'AI usage coverage needs more sessions to measure',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'AI Signal Coverage',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: `Requires at least ${MIN_SESSIONS} sessions within a workflow to assess AI signal coverage`,
        description: 'No workflow has enough sessions for AI signal coverage analysis.',
      }];
    }

    // CR-X FINAL: Healthy coverage (>60%) is not a Performance Insight.
    // Only emit when coverage is materially poor (low) or zero, which
    // indicates an instrumentation or adoption gap worth investigating.
    const POOR_COVERAGE_THRESHOLD = 60;
    const qualifying = allWorkflowCoverage.filter(wc => wc.coveragePct < POOR_COVERAGE_THRESHOLD);
    if (qualifying.length === 0) return [];

    return qualifying.map((wc, instanceIndex) => {
      const wfLabel = getCanonicalWorkflowIdentity(wc.workflow);
      const coverageRounded = Math.round(wc.coveragePct * 10) / 10;
      // CR-X semantic fix: "all sessions" requires numerator == denominator.
      // Previously used zeroAiSignals === 0, but zeroAiSignals only counts
      // sessions with measured ai_burst_count === 0. Sessions with missing
      // ai_burst_count are excluded from zeroAiSignals but still counted in
      // total, so the title falsely said "all sessions" when only a subset
      // had measured AI signals.
      const missingAiSignals = wc.total - wc.withAiSignals - wc.zeroAiSignals;
      const hasFullCoverage = wc.withAiSignals === wc.total && missingAiSignals === 0;
      const hasZeroCoverage = wc.withAiSignals === 0;

      let title: string;
      let description: string;
      let recommendation: string;
      let whatChanged: string;

      if (hasFullCoverage) {
        title = `${wfLabel}: all sessions show observed AI signals`;
        description = `${wc.withAiSignals} of ${wc.total} sessions in ${wfLabel} have observed AI signals (ai_burst_count > 0). This indicates active AI instrumentation across all sessions. Note: this measures instrumentation coverage, not AI effectiveness.`;
        recommendation = 'AI signal instrumentation is healthy. Use within-workflow AI effect analysis to compare session outcomes by AI intensity cohort.';
        whatChanged = `AI signal coverage: ${coverageRounded}% (${wc.withAiSignals}/${wc.total} sessions with observed AI signals).`;
      } else if (hasZeroCoverage) {
        title = `${wfLabel}: zero observed AI signals`;
        description = `${wc.total} sessions in ${wfLabel} show zero observed AI signals (ai_burst_count = 0). This may indicate: (1) the workflow is not AI-instrumented, (2) the extension is not capturing AI activity, or (3) the workflow genuinely has no AI usage. Investigate instrumentation before concluding no AI usage.`;
        recommendation = 'Verify extension instrumentation is active and capturing AI signals. If instrumentation is confirmed, this workflow may not use AI features.';
        whatChanged = `AI signal coverage: 0% (0/${wc.total} sessions with observed AI signals).`;
      } else {
        title = `${wfLabel}: ${coverageRounded}% of sessions have observed AI signals`;
        const missingNote = missingAiSignals > 0
          ? ` ${missingAiSignals} sessions have missing ai_burst_count (not counted as zero or AI-active).`
          : '';
        description = `${wc.withAiSignals} of ${wc.total} sessions in ${wfLabel} have observed AI signals (ai_burst_count > 0); ${wc.zeroAiSignals} sessions show zero observed AI signals.${missingNote} Partial coverage may indicate intermittent instrumentation, mixed AI/non-AI usage patterns, or sessions where AI features were not invoked.`;
        recommendation = 'Review sessions with zero observed AI signals to determine if instrumentation gaps exist or if these are genuinely non-AI sessions. Use AI intensity cohort analysis for deeper investigation.';
        whatChanged = `AI signal coverage: ${coverageRounded}% (${wc.withAiSignals}/${wc.total} sessions with observed AI signals, ${wc.zeroAiSignals} with zero observed AI signals).`;
      }

      return {
        id: `${registryEntry.id}__${wc.workflow}`,
        title,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder + instanceIndex / 100,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: coverageRounded,
        baseline: 0,
        delta: 0,
        deltaPct: 0,
        rightMetric: `${wc.withAiSignals}/${wc.total}`,
        rightMetricLabel: 'Sessions with AI signals',
        confidence: wc.total >= 30 ? 'high' : 'medium',
        coveragePct: coverageRounded,
        n: wc.total,
        hasData: true,
        isDiagnostic: false,
        lifecycleClass: 'contextual',
        description,
        recommendation,
        whatChanged,
        workflowContext: wc.workflow,
      } as CanonicalInsight;
    });
  } catch (err) {
    piDebugLog('[GENERATOR_AI_SIGNAL_COVERAGE][ERROR]', String(err));
    return null;
  }
}

/**
 * CR-X B: Within-workflow session duration profile.
 *
 * Shows median, p90, and long-tail characteristics within a single workflow.
 * Lower threshold than workflow-session-distribution (15 sessions vs 50).
 * Works for sparse/single-workflow pilots where 50 sessions is too high a bar.
 *
 * Emits one insight per qualifying workflow. Does NOT require cross-tool
 * comparison. Reports the shape of the duration distribution.
 */
export function generateWithinWorkflowSessionDurationProfile(input: CanonicalInsightInput): CanonicalInsight[] | null {
  try {
    piDebugLog('[GENERATOR_DURATION_PROFILE][START]', 'Generating within-workflow-session-duration-profile per-workflow instances');
    const registryEntry = getCanonicalPIById('within-workflow-session-duration-profile');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'Session duration profile needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Duration Profile',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires at least 15 sessions within a workflow to profile duration distribution',
        description: 'No telemetry sessions available for session duration profile analysis.',
      }];
    }

    const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
    const MIN_SESSIONS = 15;
    const allWorkflowProfiles: Array<{
      workflow: string;
      n: number;
      median: number;
      p90: number;
      p90p50: number;
      mean: number;
      over4h: number;
      over4hPct: number;
    }> = [];

    for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
      if (sessions.length < MIN_SESSIONS) continue;

      const durVals = sessions
        .map(s => s.session_duration_minutes)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b);

      if (durVals.length < MIN_SESSIONS) continue;

      const med = percentile(durVals, 50);
      const p90 = percentile(durVals, 90);
      const p90p50 = med > 0 ? p90 / med : 0;
      const mean = durVals.reduce((sum, v) => sum + v, 0) / durVals.length;
      const over4h = durVals.filter(v => v >= 240).length;

      // Only emit when the distribution has an operational tail
      if (p90p50 < 3) continue;

      allWorkflowProfiles.push({
        workflow,
        n: durVals.length,
        median: med,
        p90,
        p90p50,
        mean,
        over4h,
        over4hPct: (over4h / durVals.length) * 100,
      });
    }

    if (allWorkflowProfiles.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'Session duration profile needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Duration Profile',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: `Requires at least ${MIN_SESSIONS} sessions within a workflow to profile duration distribution`,
        description: 'No workflow has enough sessions for duration profile analysis.',
      }];
    }

    return allWorkflowProfiles.map((wp, instanceIndex) => {
      const wfLabel = getCanonicalWorkflowIdentity(wp.workflow);
      const hasLongTail = wp.p90p50 >= 3;
      const hasHeavyTail = wp.p90p50 >= 5;

      let title: string;
      let description: string;
      let recommendation: string;
      let whatChanged: string;

      if (hasHeavyTail) {
        title = `A small share of ${wfLabel} sessions runs far longer than typical`;
        description = `${wfLabel} sessions show a heavy-tailed duration distribution: median ${formatMinutes(wp.median)}, p90 ${formatMinutes(wp.p90)}, ratio ${wp.p90p50.toFixed(1)}x. ${wp.over4h} sessions (${wp.over4hPct.toFixed(1)}%) exceed 4 hours. This suggests some sessions run significantly longer than typical, possibly due to long-running tasks, abandoned sessions, or agent workflows with extended activity.`;
        recommendation = 'Investigate long-duration sessions (>4h) to determine if they represent productive work, abandoned sessions, or agent workflows. Consider session timeout policies for non-productive long sessions.';
        whatChanged = `Session duration: median ${formatMinutes(wp.median)}, p90 ${formatMinutes(wp.p90)}, p90/p50 = ${wp.p90p50.toFixed(1)}x, ${wp.over4hPct.toFixed(1)}% over 4h.`;
      } else if (hasLongTail) {
        title = `${wfLabel} session length has a moderate long tail`;
        description = `${wfLabel} sessions show a moderate-tailed duration distribution: median ${formatMinutes(wp.median)}, p90 ${formatMinutes(wp.p90)}, ratio ${wp.p90p50.toFixed(1)}x. ${wp.over4h} sessions (${wp.over4hPct.toFixed(1)}%) exceed 4 hours. The distribution has a longer tail than a normal distribution but is not extreme.`;
        recommendation = 'Monitor long-duration sessions for productivity patterns. The moderate tail is typical for mixed-task workflows.';
        whatChanged = `Session duration: median ${formatMinutes(wp.median)}, p90 ${formatMinutes(wp.p90)}, p90/p50 = ${wp.p90p50.toFixed(1)}x.`;
      } else {
        title = `${wfLabel} session length is unusually consistent`;
        description = `${wfLabel} sessions show a consistent duration distribution: median ${formatMinutes(wp.median)}, p90 ${formatMinutes(wp.p90)}, ratio ${wp.p90p50.toFixed(1)}x. Mean ${formatMinutes(wp.mean)}. Sessions are tightly clustered around the median, indicating predictable workflow patterns.`;
        recommendation = 'Session duration is consistent. Use this baseline to identify outliers or changes in workflow patterns over time.';
        whatChanged = `Session duration: median ${formatMinutes(wp.median)}, p90 ${formatMinutes(wp.p90)}, p90/p50 = ${wp.p90p50.toFixed(1)}x, mean ${formatMinutes(wp.mean)}.`;
      }

      return {
        id: `${registryEntry.id}__${wp.workflow}`,
        title,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder + instanceIndex / 100,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: Math.round(wp.median),
        baseline: Math.round(wp.p90),
        delta: Math.round(wp.p90 - wp.median),
        deltaPct: wp.median > 0 ? Math.round(((wp.p90 - wp.median) / wp.median) * 100) : 0,
        rightMetric: `p90/p50=${wp.p90p50.toFixed(1)}x`,
        rightMetricLabel: 'Long-tail ratio',
        confidence: wp.n >= 30 ? 'high' : 'medium',
        coveragePct: coveragePct1dp(wp.n, sessionRows.length),
        n: wp.n,
        hasData: true,
        isDiagnostic: false,
        lifecycleClass: 'contextual',
        description,
        recommendation,
        whatChanged,
        workflowContext: wp.workflow,
      } as CanonicalInsight;
    });
  } catch (err) {
    piDebugLog('[GENERATOR_DURATION_PROFILE][ERROR]', String(err));
    return null;
  }
}

/**
 * CR-X 2A: Within-workflow commits/session profile.
 *
 * Shows median, p90, and distribution of commits per session within a
 * single workflow. Works for single-workflow pilots — no cross-tool
 * comparison required. Requires observed commit provenance.
 *
 * Threshold: 15 sessions with observed commits within a workflow.
 * Emits one insight per qualifying workflow.
 */
export function generateWithinWorkflowCommitsProfile(input: CanonicalInsightInput): CanonicalInsight[] | null {
  try {
    piDebugLog('[GENERATOR_COMMITS_PROFILE][START]', 'Generating within-workflow-commits-profile per-workflow instances');
    const registryEntry = getCanonicalPIById('within-workflow-commits-profile');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'Commits per session profile needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Commits/Session',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires at least 15 sessions with observed commits within a workflow',
        description: 'No telemetry sessions available for commits per session profile analysis.',
      }];
    }

    const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
    const MIN_SESSIONS = 15;
    const allWorkflowProfiles: Array<{
      workflow: string;
      n: number;
      median: number;
      p90: number;
      mean: number;
      zeroCommitSessions: number;
      zeroCommitPct: number;
    }> = [];

    for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
      // Only sessions with observed commit provenance
      const observedCommitSessions = sessions.filter(s =>
        typeof s.session_commits === 'number' && Number.isFinite(s.session_commits) &&
        s.session_commits_source === 'observed'
      );
      if (observedCommitSessions.length < MIN_SESSIONS) continue;

      const commitVals = observedCommitSessions
        .map(s => s.session_commits as number)
        .sort((a, b) => a - b);

      const med = percentile(commitVals, 50);
      const p90 = percentile(commitVals, 90);
      const mean = commitVals.reduce((sum, v) => sum + v, 0) / commitVals.length;
      const zeroCommitSessions = commitVals.filter(v => v === 0).length;

      allWorkflowProfiles.push({
        workflow,
        n: commitVals.length,
        median: med,
        p90,
        mean,
        zeroCommitSessions,
        zeroCommitPct: (zeroCommitSessions / commitVals.length) * 100,
      });
    }

    if (allWorkflowProfiles.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'Commits per session profile needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'Commits/Session',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: `Requires at least ${MIN_SESSIONS} sessions with observed commits within a workflow`,
        description: 'No workflow has enough observed-commit sessions for commits per session profile analysis.',
      }];
    }

    const anomalous = allWorkflowProfiles.filter(wp => wp.zeroCommitPct > 50 || (wp.p90 > wp.median * 3));
    if (anomalous.length === 0) return [];

    return anomalous.map((wp, instanceIndex) => {
      const wfLabel = getCanonicalWorkflowIdentity(wp.workflow);
      const hasHighVariance = wp.p90 > wp.median * 3;
      const medFormatted = wp.median.toFixed(1);
      const p90Formatted = wp.p90.toFixed(1);
      const meanFormatted = wp.mean.toFixed(1);

      let title: string;
      let description: string;
      let recommendation: string;
      let whatChanged: string;

      if (wp.zeroCommitPct > 50) {
        title = `Most ${wfLabel} sessions show no observed commits`;
        description = `${wp.zeroCommitPct.toFixed(0)}% of ${wp.n} sessions in ${wfLabel} have zero observed commits. Median: ${medFormatted} commits/session. This may indicate short exploratory sessions, work that doesn't result in commits, or sessions where commit capture is incomplete.`;
        recommendation = 'Investigate whether zero-commit sessions are genuinely non-committing work or an instrumentation gap. Compare with session duration profile to check if zero-commit sessions are shorter.';
        whatChanged = `Commits/session: median ${medFormatted}, p90 ${p90Formatted}, ${wp.zeroCommitPct.toFixed(0)}% zero-commit sessions.`;
      } else if (hasHighVariance) {
        title = `A small share of ${wfLabel} sessions produces far more commits than typical`;
        // A near-zero median cannot support a meaningful multiplier —
        // dividing by a clamp fabricates precision. Render the absolute
        // comparison instead.
        const tailComparison = wp.median >= 0.1
          ? `The p90/median ratio of ${(wp.p90 / wp.median).toFixed(1)}x indicates a long tail of high-commit sessions.`
          : `p90 (${p90Formatted}) far exceeds the near-zero median (${medFormatted}), indicating a long tail of high-commit sessions.`;
        const tailComparisonShort = wp.median >= 0.1
          ? `p90/median = ${(wp.p90 / wp.median).toFixed(1)}x`
          : `p90 ${p90Formatted} vs median ${medFormatted}`;
        description = `${wp.n} sessions in ${wfLabel} show wide commit variance. Median: ${medFormatted}, p90: ${p90Formatted}, mean: ${meanFormatted} commits/session. ${wp.zeroCommitPct.toFixed(0)}% of sessions have zero observed commits. ${tailComparison}`;
        recommendation = 'High commit variance may reflect diverse task types. Investigate whether high-commit sessions correspond to specific repos or task categories.';
        whatChanged = `Commits/session: median ${medFormatted}, p90 ${p90Formatted}, mean ${meanFormatted}. High variance (${tailComparisonShort}).`;
      } else {
        title = `${wfLabel}: median ${medFormatted} commits/session across ${wp.n} sessions`;
        description = `${wp.n} sessions in ${wfLabel} show median ${medFormatted} commits/session (p90: ${p90Formatted}, mean: ${meanFormatted}). ${wp.zeroCommitPct.toFixed(0)}% of sessions have zero observed commits. Commit behavior is relatively consistent.`;
        recommendation = 'Commit pattern is stable. Use this baseline to compare against future periods or other workflows when available.';
        whatChanged = `Commits/session: median ${medFormatted}, p90 ${p90Formatted}, mean ${meanFormatted}. ${wp.zeroCommitPct.toFixed(0)}% zero-commit sessions.`;
      }

      return {
        id: `${registryEntry.id}__${wp.workflow}`,
        title,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder + instanceIndex / 100,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: wp.median,
        baseline: 0,
        delta: 0,
        deltaPct: 0,
        rightMetric: `${medFormatted} median`,
        rightMetricLabel: 'Commits/Session',
        confidence: wp.n >= 30 ? 'high' : 'medium',
        coveragePct: coveragePct1dp(wp.n, sessionRows.length),
        n: wp.n,
        hasData: true,
        isDiagnostic: false,
        lifecycleClass: 'contextual',
        description,
        recommendation,
        whatChanged,
        workflowContext: wp.workflow,
      } as CanonicalInsight;
    });
  } catch (err) {
    piDebugLog('[GENERATOR_COMMITS_PROFILE][ERROR]', String(err));
    return null;
  }
}

/**
 * CR-X 2A: Within-workflow TTFC profile.
 *
 * Shows median, p90 time-to-first-commit within a single workflow.
 * Requires observed commit provenance and valid time_to_first_commit_ms.
 * Works for single-workflow pilots.
 *
 * Threshold: 15 sessions with observed TTFC within a workflow.
 * Emits one insight per qualifying workflow.
 */
export function generateWithinWorkflowTTFCProfile(input: CanonicalInsightInput): CanonicalInsight[] | null {
  try {
    piDebugLog('[GENERATOR_TTFC_PROFILE][START]', 'Generating within-workflow-ttfc-profile per-workflow instances');
    const registryEntry = getCanonicalPIById('within-workflow-ttfc-profile');
    if (!registryEntry) return null;

    const sessionRows = input.sessionRows || [];
    if (sessionRows.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'Time to first commit profile needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'TTFC (min)',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: 'Requires at least 15 sessions with observed time-to-first-commit within a workflow',
        description: 'No telemetry sessions available for time to first commit profile analysis.',
      }];
    }

    const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
    const MIN_SESSIONS = 15;
    const allWorkflowProfiles: Array<{
      workflow: string;
      n: number;
      median: number;
      p90: number;
      mean: number;
      fastCommitPct: number;
    }> = [];

    for (const [workflow, sessions] of Object.entries(sessionsByWorkflow)) {
      // Only sessions with observed TTFC
      const ttfcSessions = sessions.filter(s => {
        const ttfc = s.time_to_first_commit_ms;
        return typeof ttfc === 'number' && Number.isFinite(ttfc) && ttfc > 0 &&
               s.session_commits_source === 'observed';
      });
      if (ttfcSessions.length < MIN_SESSIONS) continue;

      // Convert to minutes
      const ttfcVals = ttfcSessions
        .map(s => (s.time_to_first_commit_ms as number) / 60000)
        .sort((a, b) => a - b);

      const med = percentile(ttfcVals, 50);
      const p90 = percentile(ttfcVals, 90);
      const mean = ttfcVals.reduce((sum, v) => sum + v, 0) / ttfcVals.length;
      const fastCommit = ttfcVals.filter(v => v <= 15).length; // ≤15 min = fast

      allWorkflowProfiles.push({
        workflow,
        n: ttfcVals.length,
        median: med,
        p90,
        mean,
        fastCommitPct: (fastCommit / ttfcVals.length) * 100,
      });
    }

    if (allWorkflowProfiles.length === 0) {
      return [{
        id: registryEntry.id,
        title: 'Time to first commit profile needs more data',
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: 0, baseline: 0, delta: 0, deltaPct: 0,
        rightMetric: '—', rightMetricLabel: 'TTFC (min)',
        confidence: 'low', coveragePct: 0, n: 0, hasData: false,
        isDiagnostic: true,
        diagnosticReason: 'NEEDS_MORE_TELEMETRY',
        diagnosticUnlockPath: `Requires at least ${MIN_SESSIONS} sessions with observed time-to-first-commit within a workflow`,
        description: 'No workflow has enough observed-TTFC sessions for time to first commit profile analysis.',
      }];
    }

    // CR-X FINAL: PI is not a measurement inventory. Only emit TTFC profiles
    // with material operational implication: slow median (>60 min) or a long
    // tail where p90 is more than 3× the median. Healthy/fast/moderate baselines
    // are not findings.
    const notableProfiles = allWorkflowProfiles.filter(wp => wp.median > 60 || wp.p90 > wp.median * 3);
    if (notableProfiles.length === 0) {
      return [];
    }

    return notableProfiles.map((wp, instanceIndex) => {
      const wfLabel = getCanonicalWorkflowIdentity(wp.workflow);
      const medFormatted = wp.median.toFixed(1);
      const p90Formatted = wp.p90.toFixed(1);

      let title: string;
      let description: string;
      let recommendation: string;
      let whatChanged: string;

      const isSlow = wp.median > 60;

      if (isSlow) {
        title = `${wfLabel}: slow time to first commit (median ${medFormatted} min)`;
        description = `${wp.n} sessions in ${wfLabel} show median ${medFormatted} min to first commit (p90: ${p90Formatted} min). Only ${wp.fastCommitPct.toFixed(0)}% of sessions reach first commit within 15 minutes. This may indicate complex setup, large scope sessions, or exploratory work before committing.`;
        recommendation = 'Investigate whether slow TTFC reflects task complexity or workflow friction. Compare with session duration profile to understand if longer sessions correlate with slower TTFC.';
        whatChanged = `TTFC: median ${medFormatted} min, p90 ${p90Formatted} min. ${wp.fastCommitPct.toFixed(0)}% under 15 min.`;
      } else {
        // Workflows reach here only because they have a material long tail
        // (p90 > 3× median). The median itself is not slow, so the headline
        // must describe the variance implication, not the baseline.
        title = `A small share of ${wfLabel} sessions takes far longer than typical to reach first commit`;
        description = `Most ${wfLabel} sessions reach first commit within ${medFormatted} min (median), but the longest 10% take ${p90Formatted} min or more. Only ${wp.fastCommitPct.toFixed(0)}% reach first commit within 15 minutes. This may indicate a subset of sessions with unusual startup friction or large initial scope.`;
        recommendation = 'Investigate the subset of sessions with unusually long time to first commit to identify whether it reflects task complexity, setup friction, or outlier workflow patterns.';
        whatChanged = `TTFC: median ${medFormatted} min, p90 ${p90Formatted} min. ${wp.fastCommitPct.toFixed(0)}% under 15 min.`;
      }

      return {
        id: `${registryEntry.id}__${wp.workflow}`,
        title,
        cicdStage: registryEntry.stage,
        canonicalPriority: registryEntry.canonicalPriority,
        renderOrder: registryEntry.renderOrder + instanceIndex / 100,
        presentationType: 'evidence_only',
        comparisonMode: 'absolute',
        current: wp.median,
        baseline: 0,
        delta: 0,
        deltaPct: 0,
        rightMetric: `${medFormatted} min median`,
        rightMetricLabel: 'TTFC',
        confidence: wp.n >= 30 ? 'high' : 'medium',
        coveragePct: coveragePct1dp(wp.n, sessionRows.length),
        n: wp.n,
        hasData: true,
        isDiagnostic: false,
        lifecycleClass: 'contextual',
        description,
        recommendation,
        whatChanged,
        workflowContext: wp.workflow,
      } as CanonicalInsight;
    });
  } catch (err) {
    piDebugLog('[GENERATOR_TTFC_PROFILE][ERROR]', String(err));
    return null;
  }
}

/**
 * CR-X 2A: Pilot maturity progression.
 *
 * Contextual PI that shows what evidence stage the pilot is in and what
 * additional findings unlock as more data accumulates. Works from DAY 0.
 *
 * Stages:
 * - DAY_0: No telemetry yet
 * - FIRST_EVENTS: Telemetry flowing but < 5 sessions
 * - FIRST_COMPLETED_SESSIONS: 5-14 sessions (early-signal PIs fire)
 * - ONE_WORKFLOW_MATURE: 15+ sessions in one workflow (within-workflow PIs fire)
 * - MATURE_ONE_WORKFLOW: 25+ sessions in one workflow (cross-workflow PIs start)
 * - MULTIPLE_WORKFLOWS: 2+ workflows with 25+ sessions (comparison PIs fire)
 *
 * This is NOT a diagnostic — it's a useful contextual finding about pilot state.
 */
export function generatePilotMaturityProgression(input: CanonicalInsightInput): CanonicalInsight | null {
  try {
    piDebugLog('[GENERATOR_MATURITY_PROGRESSION][START]', 'Generating pilot-maturity-progression');
    const registryEntry = getCanonicalPIById('pilot-maturity-progression');
    if (!registryEntry) return null;

    // CR-X FINAL: Pilot maturity is a status, not a Performance Insight.
    // The surrounding product already surfaces evidence maturity; do not
    // render it in the PI portfolio.
    return null;

    const sessionRows = input.sessionRows || [];
    const totalSessions = sessionRows.length;

    // Determine maturity stage
    const sessionsByWorkflow = groupSessionsByCanonicalWorkflow(sessionRows, input._engineCache);
    const workflowSessionCounts = Object.entries(sessionsByWorkflow)
      .map(([wf, sessions]) => ({ workflow: wf, count: sessions.length }))
      .sort((a, b) => b.count - a.count);

    const maxWorkflowSessions = workflowSessionCounts[0]?.count ?? 0;
    const workflowsWith25Plus = workflowSessionCounts.filter(w => w.count >= 25).length;
    const workflowsWith15Plus = workflowSessionCounts.filter(w => w.count >= 15).length;

    type MaturityStage = 'DAY_0' | 'FIRST_EVENTS' | 'FIRST_COMPLETED_SESSIONS' | 'ONE_WORKFLOW_MATURE' | 'MATURE_ONE_WORKFLOW' | 'MULTIPLE_WORKFLOWS';
    let stage: MaturityStage;
    let title: string;
    let description: string;
    let whatChanged: string;
    let whyItMatters: string;
    let recommendation: string;
    let nextUnlock: string;

    if (totalSessions === 0) {
      stage = 'DAY_0';
      title = 'Pilot status: no telemetry yet';
      description = 'No telemetry sessions have been received. Install the ChaosMonkey extension and start coding to begin collecting evidence.';
      whatChanged = 'Waiting for first telemetry events.';
      whyItMatters = 'Telemetry is the foundation for all insights. Once sessions start flowing, early-signal findings will appear within 5 sessions.';
      recommendation = 'Install the extension via the Team page invite flow. Verify the connection is active in VS Code.';
      nextUnlock = 'First sessions (5+) → early-signal workflow adoption and developer activity findings';
    } else if (totalSessions < 5) {
      stage = 'FIRST_EVENTS';
      title = `Pilot status: first events received (${totalSessions} session${totalSessions > 1 ? 's' : ''})`;
      description = `${totalSessions} telemetry session${totalSessions > 1 ? 's have' : ' has'} been received from ${workflowSessionCounts.length} workflow${workflowSessionCounts.length > 1 ? 's' : ''}. Early-signal findings will appear once 5+ sessions are collected.`;
      whatChanged = `Telemetry is flowing: ${totalSessions} sessions from ${workflowSessionCounts.length} workflow(s).`;
      whyItMatters = 'Instrumentation is working. A few more sessions will unlock early-signal findings about workflow adoption and developer activity.';
      recommendation = 'Continue normal coding patterns. No action needed — findings will appear automatically.';
      nextUnlock = '5+ sessions → early-signal workflow adoption and developer activity findings';
    } else if (totalSessions < 15 || workflowsWith15Plus === 0) {
      stage = 'FIRST_COMPLETED_SESSIONS';
      title = `Pilot status: early signal active (${totalSessions} sessions)`;
      const topWf = workflowSessionCounts[0];
      description = `${totalSessions} sessions from ${workflowSessionCounts.length} workflow(s). Top workflow: ${getCanonicalWorkflowIdentity(topWf.workflow)} (${topWf.count} sessions). Early-signal findings are active. Within-workflow profile findings (duration, commits, TTFC) unlock at 15+ sessions per workflow.`;
      whatChanged = `Early-signal findings active. ${totalSessions} sessions across ${workflowSessionCounts.length} workflow(s).`;
      whyItMatters = 'Early-signal findings provide initial visibility into workflow adoption and developer activity. Deeper within-workflow analysis unlocks as session volume grows.';
      recommendation = 'Continue normal usage. Within-workflow findings will appear when a workflow reaches 15+ sessions.';
      nextUnlock = `15+ sessions in one workflow → duration profile, commits profile, TTFC profile, AI signal coverage`;
    } else if (workflowsWith25Plus === 0) {
      stage = 'ONE_WORKFLOW_MATURE';
      title = `Pilot status: within-workflow analysis active (${totalSessions} sessions, ${workflowsWith15Plus} mature workflow${workflowsWith15Plus > 1 ? 's' : ''})`;
      description = `${totalSessions} sessions. ${workflowsWith15Plus} workflow(s) have 15+ sessions, enabling within-workflow profile findings (duration, commits, TTFC, AI signal coverage). Cross-workflow comparison findings unlock at 25+ sessions per workflow.`;
      whatChanged = `Within-workflow findings active. ${workflowsWith15Plus} workflow(s) with 15+ sessions.`;
      whyItMatters = 'Within-workflow findings provide meaningful evidence about session patterns, commit behavior, and AI signal coverage without requiring cross-tool comparison.';
      recommendation = 'Continue usage. Cross-workflow comparison findings will unlock when a second workflow reaches 25+ sessions.';
      nextUnlock = '25+ sessions in 2+ workflows → cross-workflow comparison findings (active coding, TTFC, AI adoption rate)';
    } else if (workflowsWith25Plus < 2) {
      stage = 'MATURE_ONE_WORKFLOW';
      title = `Pilot status: mature single-workflow analysis (${totalSessions} sessions)`;
      description = `${totalSessions} sessions. ${workflowsWith25Plus} workflow has 25+ sessions, enabling mature within-workflow findings. Cross-workflow comparison requires 2+ workflows with 25+ sessions each.`;
      whatChanged = `Mature within-workflow findings active. 1 workflow with 25+ sessions.`;
      whyItMatters = 'A mature single workflow provides strong longitudinal evidence. Cross-workflow comparison will add comparative context when a second workflow matures.';
      recommendation = 'If the team uses multiple tools, encourage adoption to enable cross-workflow comparison. Otherwise, single-workflow findings remain valuable.';
      nextUnlock = '2+ workflows with 25+ sessions → cross-workflow comparison findings';
    } else {
      stage = 'MULTIPLE_WORKFLOWS';
      title = `Pilot status: multi-workflow comparison active (${totalSessions} sessions, ${workflowsWith25Plus} mature workflows)`;
      description = `${totalSessions} sessions. ${workflowsWith25Plus} workflows have 25+ sessions, enabling cross-workflow comparison findings alongside within-workflow analysis.`;
      whatChanged = `Multi-workflow comparison active. ${workflowsWith25Plus} workflows with 25+ sessions.`;
      whyItMatters = 'Multi-workflow comparison provides the richest evidence base. Both within-workflow and cross-workflow findings are active.';
      recommendation = 'All finding families are active. Focus on actionable insights from the findings portfolio.';
      nextUnlock = 'Continue accumulating data for higher confidence and longitudinal trend analysis';
    }

    return {
      id: registryEntry.id,
      title,
      cicdStage: registryEntry.stage,
      canonicalPriority: registryEntry.canonicalPriority,
      renderOrder: registryEntry.renderOrder,
      presentationType: 'evidence_only',
      presentationKind: 'org_summary',
      comparisonMode: 'absolute',
      comparisonState: 'org_level_only',
      // CONTRACT: 'current' is the primary metric slot. For a semantic-state PI,
      // the primary value is the stage itself (carried in rightMetric), NOT the
      // session count. Session count is sample evidence in 'n' and
      // 'evidenceAndContext'. Setting current=0 (not totalSessions) prevents the
      // renderer from mapping a session count into the "Maturity Stage" label.
      // The renderer uses rightMetric (non-numeric string) as the primary display.
      current: 0,
      baseline: 0,
      delta: 0,
      deltaPct: 0,
      rightMetric: stage.replace(/_/g, ' '),
      rightMetricLabel: 'Maturity Stage',
      polarity: 'neutral',
      confidence: totalSessions >= 25 ? 'high' : totalSessions >= 5 ? 'medium' : 'low',
      coveragePct: 100,
      n: totalSessions,
      hasData: true,
      isDiagnostic: false,
      description,
      whatChanged,
      whyItMatters,
      recommendation,
      evidenceAndContext: `Stage: ${stage}. Sessions: ${totalSessions}. Workflows: ${workflowSessionCounts.length}. Workflows with 15+ sessions: ${workflowsWith15Plus}. Workflows with 25+ sessions: ${workflowsWith25Plus}. Next unlock: ${nextUnlock}.`,
      operationalImpact: nextUnlock,
      primaryRisk: 'Maturity stage is contextual — it describes evidence availability, not productivity or performance.',
      confidenceReasoning: `Maturity assessment based on ${totalSessions} sessions across ${workflowSessionCounts.length} workflow(s).`,
      operationalRead: `Stage: ${stage}. ${totalSessions} sessions. Next: ${nextUnlock}.`,
      urgencyLabel: 'informational',
      metricDefinition: 'Pilot maturity stage based on session volume and workflow distribution. Describes what evidence is available and what findings unlock next.',
      recommendationState: 'monitor_only',
      lifecycleClass: 'contextual',
      breakdownByTool: Object.fromEntries(workflowSessionCounts.slice(0, 5).map(w => [w.workflow, { value: w.count, label: getCanonicalWorkflowIdentity(w.workflow), sessions: w.count }])),
      generatorSource: 'generatePilotMaturityProgression',
      engineVersion: 'FINAL_ENGINE_V1',
    };
  } catch (err) {
    piDebugLog('[GENERATOR_MATURITY_PROGRESSION][ERROR]', String(err));
    return null;
  }
}

/**
 * CR-X Production-Value: Generate workflow behavior comparison findings.
 *
 * Compares workflows WITHIN the same operational mode:
 * - Human-interactive: active coding/session (the meaningful behavior metric)
 * - Delegated-agent: runtime/session (the meaningful behavior metric)
 *
 * Only emits when there is a MATERIAL gap (≥30% relative difference, ≥10 min absolute).
 * Never compares across modes (active coding vs runtime are not equivalent).
 * Uses customer language: "Claude Code runs 2.8× longer per session than Devin"
 *
 * Gates:
 * - Minimum 25 sessions per workflow
 * - At least 2 workflows in the same mode with sufficient data
 * - Material gap (≥30% relative AND ≥10 min absolute)
 */
export function generateWorkflowBehaviorComparison(input: CanonicalInsightInput): CanonicalInsight[] {
  try {
    piDebugLog('[GENERATOR_WF_BEHAVIOR_CMP][START]', 'Generating workflow behavior comparison');
    const sessionRows = input.sessionRows || [];
    if (sessionRows.length === 0) return [];

    const MIN_SESSIONS = 25;
    const MATERIAL_RELATIVE = 30;
    const MATERIAL_ABSOLUTE_MIN = 10;

    const workflowData: Record<string, { sessions: any[]; isDelegated: boolean }> = {};
    for (const s of sessionRows) {
      const wf = normalizeToCanonicalToolId(s.tool ?? s.session_source ?? '');
      if (!wf || wf === 'unknown') continue;
      if (!workflowData[wf]) {
        workflowData[wf] = { sessions: [], isDelegated: isDelegatedAgentWorkflow(wf) };
      }
      workflowData[wf].sessions.push(s);
    }

    const workflowMetrics = Object.entries(workflowData)
      .filter(([, d]) => d.sessions.length >= MIN_SESSIONS)
      .map(([wf, d]) => {
        const isDelegated = d.isDelegated;
        const sessions = d.sessions;
        let metricValue: number | null = null;
        let metricLabel: string;

        if (isDelegated) {
          const durations = sessions
            .map(s => typeof s.session_duration_minutes === 'number' ? s.session_duration_minutes :
                        typeof s.duration_ms === 'number' ? s.duration_ms / 60000 : null)
            .filter((v): v is number => v !== null && v > 0);
          metricValue = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
          metricLabel = 'runtime per session';
        } else {
          const activeCoding = sessions
            .map(s => typeof s.session_active_coding_duration_minutes === 'number' ? s.session_active_coding_duration_minutes :
                        typeof s.active_coding_duration_ms === 'number' ? s.active_coding_duration_ms / 60000 : null)
            .filter((v): v is number => v !== null && v > 0);
          metricValue = activeCoding.length > 0 ? activeCoding.reduce((a, b) => a + b, 0) / activeCoding.length : null;
          metricLabel = 'active coding per session';
        }

        return {
          workflow: wf,
          name: getCanonicalWorkflowIdentity(wf).replace(' workflow', ''),
          isDelegated,
          metricValue,
          metricLabel,
          sessionCount: sessions.length,
          validMetricCount: isDelegated
            ? sessions.filter(s => (s.session_duration_minutes ?? s.duration_ms) != null).length
            : sessions.filter(s => (s.session_active_coding_duration_minutes ?? s.active_coding_duration_ms) != null).length,
        };
      })
      .filter(d => d.metricValue !== null && d.validMetricCount >= MIN_SESSIONS);

    if (workflowMetrics.length < 2) return [];

    const findings: CanonicalInsight[] = [];

    for (const isDelegated of [true, false]) {
      const modeWorkflows = workflowMetrics.filter(d => d.isDelegated === isDelegated);
      if (modeWorkflows.length < 2) continue;

      modeWorkflows.sort((a, b) => (b.metricValue! - a.metricValue!));

      let maxGap = 0;
      let maxPair: [typeof modeWorkflows[0], typeof modeWorkflows[0]] | null = null;
      for (let i = 0; i < modeWorkflows.length - 1; i++) {
        const gap = modeWorkflows[i].metricValue! - modeWorkflows[i + 1].metricValue!;
        if (gap > maxGap) { maxGap = gap; maxPair = [modeWorkflows[i], modeWorkflows[i + 1]]; }
      }

      if (!maxPair || maxGap < MATERIAL_ABSOLUTE_MIN) continue;

      const higher = maxPair[0];
      const lower = maxPair[1];
      const relativePct = lower.metricValue! > 0
        ? Math.round(((higher.metricValue! - lower.metricValue!) / lower.metricValue!) * 100) : 0;
      if (relativePct < MATERIAL_RELATIVE) continue;

      const ratio = lower.metricValue! > 0 ? (higher.metricValue! / lower.metricValue!).toFixed(1) : '—';
      const metricTerm = isDelegated ? 'runtime' : 'active coding';
      const title = ratio !== '—' && parseFloat(ratio) >= 2
        ? `${higher.name} ${metricTerm} is ${ratio}× longer per session than ${lower.name}`
        : `${higher.name} sessions require ${Math.round(maxGap)} more minutes of ${metricTerm} per session than ${lower.name}`;

      const id = `workflow-behavior-comparison__${isDelegated ? 'delegated' : 'human'}__${higher.workflow}_${lower.workflow}`;

      findings.push({
        id, title,
        cicdStage: 'plan-code', canonicalPriority: 50, renderOrder: 120,
        presentationType: 'comparison', presentationKind: 'workflow_comparison',
        comparisonMode: 'workflow_vs_workflow', comparisonState: 'workflow_comparable',
        current: higher.metricValue!, baseline: lower.metricValue!, delta: maxGap, deltaPct: relativePct,
        displayValue: `${Math.round(higher.metricValue!)}m`, displayDeltaPct: `+${relativePct}%`,
        rightMetric: `${Math.round(lower.metricValue!)}m`, rightMetricLabel: lower.name,
        polarity: 'neutral',
        confidence: (higher.sessionCount + lower.sessionCount) >= 100 ? 'high' : 'medium',
        coveragePct: 0, n: higher.sessionCount + lower.sessionCount, hasData: true, isDiagnostic: false,
        description: `${higher.name} ${metricTerm} averages ${Math.round(higher.metricValue!)}m per session vs ${Math.round(lower.metricValue!)}m for ${lower.name} (${ratio}× longer, ${relativePct}% higher). Based on ${higher.sessionCount} ${higher.name} sessions and ${lower.sessionCount} ${lower.name} sessions.`,
        recommendation: `Compare task and repo mix between ${higher.name} and ${lower.name} to understand whether the ${metricTerm} difference reflects different work types or different working styles. Do not infer productivity from ${metricTerm} alone.`,
        executiveSummary: `${higher.name} ${metricTerm} is ${ratio}× longer per session than ${lower.name}`,
        evidence: [
          { metric: higher.name, value: `${Math.round(higher.metricValue!)}m`, label: `${metricLabel} (N=${higher.sessionCount})` },
          { metric: lower.name, value: `${Math.round(lower.metricValue!)}m`, label: `${metricLabel} (N=${lower.sessionCount})` },
          { metric: 'Gap', value: `${Math.round(maxGap)}m`, label: `${relativePct}% relative` },
        ],
        breakdownByTool: {
          [higher.workflow]: { value: higher.metricValue!, count: higher.sessionCount, formatted: `${Math.round(higher.metricValue!)}m`, label: `${higher.name} (${higher.sessionCount} sessions)` },
          [lower.workflow]: { value: lower.metricValue!, count: lower.sessionCount, formatted: `${Math.round(lower.metricValue!)}m`, label: `${lower.name} (${lower.sessionCount} sessions)` },
        },
        selectedComparison: { leaderKey: higher.workflow, baselineKey: lower.workflow },
        whatChanged: `${metricTerm} per session: ${higher.name} ${Math.round(higher.metricValue!)}m vs ${lower.name} ${Math.round(lower.metricValue!)}m`,
        whyItMatters: `Different ${metricTerm} per session may reflect different task types, repo complexity, or working styles. This is an operational observation, not a productivity measure.`,
        operationalImpact: `${higher.name} sessions use ${Math.round(maxGap)}m more ${metricTerm} per session than ${lower.name}.`,
        cohort: `${modeWorkflows.length} workflows in ${isDelegated ? 'delegated-agent' : 'human-interactive'} mode`,
        confidenceReasoning: `Comparison of ${higher.sessionCount + lower.sessionCount} sessions across 2 workflows in the same operational mode.`,
        operationalRead: `${higher.name}: ${Math.round(higher.metricValue!)}m ${metricTerm}/session (N=${higher.sessionCount}) | ${lower.name}: ${Math.round(lower.metricValue!)}m (N=${lower.sessionCount})`,
        urgencyLabel: 'investigate', metricDefinition: `Average ${metricTerm} per session, comparing workflows within the same operational mode (${isDelegated ? 'delegated-agent' : 'human-interactive'}).`,
        recommendationState: 'investigate', lifecycleClass: 'decision', isExecutiveFinding: false,
        engineVersion: 'FINAL_ENGINE_V1', generatorSource: 'final/generators/planCode.ts',
        featureFlagState: true, dataSource: 'live',
      });
    }

    return findings;
  } catch (err) {
    piDebugLog('[GENERATOR_WF_BEHAVIOR_CMP][ERROR]', err);
    return [];
  }
}

/**
 * Generate all Plan & Code stage canonical insights
 */
export function generatePlanCodeInsights(input: CanonicalInsightInput): CanonicalInsight[] {
  piDebugLog('[FINAL_PI_TRACE][PLAN_CODE_GENERATOR_START]', 'Starting Plan & Code generation with 17 PIs (CR4 FINAL)');

  const generatorCalls = [
    // ── KEEP: Genuinely useful comparative/change/anomaly findings ────────
    // Core pilot insights (high confidence, real data)
    { name: 'generateActiveCodingTimeByIDE', id: 'active-coding-time-by-ide', fn: () => generateActiveCodingTimeByIDE(input) },
    // CR4 FINAL — NEW GENERIC PI FAMILIES (validated across Local, Staging, Ed)
    { name: 'generateWithinWorkflowAIEffect', id: 'within-workflow-ai-effect', fn: () => generateWithinWorkflowAIEffect(input) },
    { name: 'generateRepositoryConcentration', id: 'repository-concentration', fn: () => generateRepositoryConcentration(input) },
    // CR-X 1A.6B: Within-workflow session-duration distribution shape
    { name: 'generateWorkflowSessionDistribution', id: 'workflow-session-distribution', fn: () => generateWorkflowSessionDistribution(input) },
    // CR-X 2026-08-30 P0-4: Repository distribution by workflow
    { name: 'generateRepositoryDistributionByWorkflow', id: 'repository-distribution-by-workflow', fn: () => generateRepositoryDistributionByWorkflow(input) },
    // CR-X: within-workflow profile PIs (mature single-workflow unlock)
    { name: 'generateWithinWorkflowAISignalCoverage', id: 'within-workflow-ai-signal-coverage', fn: () => generateWithinWorkflowAISignalCoverage(input) || [] },
    { name: 'generateWithinWorkflowSessionDurationProfile', id: 'within-workflow-session-duration-profile', fn: () => generateWithinWorkflowSessionDurationProfile(input) || [] },
    { name: 'generateWithinWorkflowCommitsProfile', id: 'within-workflow-commits-profile', fn: () => generateWithinWorkflowCommitsProfile(input) || [] },
    { name: 'generateWithinWorkflowTTFCProfile', id: 'within-workflow-ttfc-profile', fn: () => generateWithinWorkflowTTFCProfile(input) || [] },
    // CR-X: pilot maturity progression (contextual org-level status)
    { name: 'generatePilotMaturityProgression', id: 'pilot-maturity-progression', fn: () => generatePilotMaturityProgression(input) },
    // CR5 WS2 #14 P0-5: Composite observed longitudinal finding (neutral semantics)
    { name: 'generateCommitTtfcLongitudinal', id: 'commit-ttfc-longitudinal', fn: () => generateCommitTtfcLongitudinal(input) },
    { name: 'generateMonthlyWorkflowShare', id: 'monthly-workflow-share', fn: () => generateMonthlyWorkflowShare(input) },
    { name: 'generateTimeToFirstCommitByIDE', id: 'time-to-first-commit-by-ide', fn: () => generateTimeToFirstCommitByIDE(input) },
    // Telemetry moat insights (require debug_ratio, terminal_ratio from session primitives)
    { name: 'generateDebugTimeByIDE', id: 'debug-time-by-ide', fn: () => generateDebugTimeByIDE(input) },
    { name: 'generateTerminalTimeByIDE', id: 'terminal-time-by-ide', fn: () => generateTerminalTimeByIDE(input) },
    // CR5 WS3 P0: Configured cost efficiency (uses PBT localStorage configured-cost authority)
    { name: 'generateConfiguredCostEfficiencyByWorkflow', id: 'configured-cost-efficiency-by-workflow', fn: () => generateConfiguredCostEfficiencyByWorkflow(input) },
    // CR-X Production-Value: Mode-correct workflow behavior comparison (active coding vs runtime)
    { name: 'generateWorkflowBehaviorComparison', id: 'workflow-behavior-comparison', fn: () => generateWorkflowBehaviorComparison(input) },
    // CR-X: cross-workflow AI adoption comparison (unlocks with 2+ mature workflows)
    { name: 'generateAIAdoptionRateByIDE', id: 'ai-adoption-rate-by-ide', fn: () => generateAIAdoptionRateByIDE(input) },

    // ── INTENTIONALLY OMITTED FROM THIS GENERATOR RUN ────────────────────
    // The following canonical capabilities remain registered but are not
    // customer-facing findings here. Some are called by other stage
    // generators; others are measurement-only/primitive capabilities:
    // generateAIIntensityCohortAnalysis, generateObservedSessionOverlap,
    // generateDeliveryRateAIVsNonAI, generateSessionConditionedPRCycleTimeAIVsNonAI,
    // generateExecutiveAIYieldOptimization, generateTelemetryAIFocusImbalance,
    // generateFocusRatioByIDE, generateWorkflowQualityCorrelation,
    // generateSessionQualityMergeSuccess, generateAIIntensityDeliveryVelocity,
    // generateReviewBurdenByAIPattern, generateAIAdoptionVelocity,
    // generateFilesEditedByIDE, generateSessionProfileByIDE.
  ];

  const insights: (CanonicalInsight | null)[] = [];
  const results: Array<{id: string, name: string, success: boolean, reason?: string, suppressionDiagnostic?: any}> = [];

  for (const call of generatorCalls) {
    try {
      piDebugLog(`[PI_TRACE][GENERATOR_START]`, `id=${call.id}`);
      const result = call.fn();
      
      // CR5 P1: Support generators that return arrays of insights (per-workflow instances)
      if (Array.isArray(result)) {
        const valid = result.filter((r): r is CanonicalInsight => r !== null);
        if (valid.length > 0) {
          insights.push(...valid);
          piDebugLog(`[PI_TRACE][GENERATOR_RESULT]`, `id=${call.id}`, `result=INSIGHT_ARRAY (${valid.length} instances)`);
          piDebugLog(`[PI_TRACE][VALIDATION]`, `id=${call.id}`, `result=PASS`);
          piDebugLog(`[PI_TRACE][FINAL]`, `id=${call.id}`, `result=RENDERED (${valid.length})`);
          results.push({ id: call.id, name: call.name, success: true });
        } else {
          piDebugLog(`[PI_TRACE][GENERATOR_RESULT]`, `id=${call.id}`, `result=NULL_ARRAY`);
          piDebugLog(`[PI_TRACE][VALIDATION]`, `id=${call.id}`, `result=FAIL`, `reason=All instances null`);
          piDebugLog(`[PI_TRACE][FINAL]`, `id=${call.id}`, `result=FILTERED`);
          results.push({ id: call.id, name: call.name, success: false, reason: 'All instances null' });
        }
      } else if (result !== null) {
        insights.push(result);
        piDebugLog(`[PI_TRACE][GENERATOR_RESULT]`, `id=${call.id}`, `result=INSIGHT`);
        piDebugLog(`[PI_TRACE][VALIDATION]`, `id=${call.id}`, `result=PASS`);
        piDebugLog(`[PI_TRACE][FINAL]`, `id=${call.id}`, `result=RENDERED`);
        results.push({ id: call.id, name: call.name, success: true });
      } else {
        piDebugLog(`[PI_TRACE][GENERATOR_RESULT]`, `id=${call.id}`, `result=NULL`);
        piDebugLog(`[PI_TRACE][VALIDATION]`, `id=${call.id}`, `result=FAIL`, `reason=Generator returned null`);
        piDebugLog(`[PI_TRACE][FINAL]`, `id=${call.id}`, `result=FILTERED`);
        
        // Structured suppression diagnostic
        const suppressionDiagnostic = {
          insightId: call.id,
          generatorName: call.name,
          suppressionReason: 'Generator returned null',
          inputData: {
            sessionRowsCount: input.sessionRows?.length || 0,
            githubByPeriodCount: input.githubByPeriod?.length || 0,
            hasGithubSnapshot: !!input.githubSnapshot
          },
          timestamp: new Date().toISOString()
        };
        
        piDebugLog(`[PI_SUPPRESSION_DIAGNOSTIC]`, JSON.stringify(suppressionDiagnostic));
        results.push({ id: call.id, name: call.name, success: false, reason: 'Generator returned null', suppressionDiagnostic });
      }
    } catch (err) {
      piDebugLog(`[PI_TRACE][GENERATOR_RESULT]`, `id=${call.id}`, `result=NULL`);
      piDebugLog(`[PI_TRACE][VALIDATION]`, `id=${call.id}`, `result=FAIL`, `reason=${err instanceof Error ? err.message : String(err)}`);
      piDebugLog(`[PI_TRACE][FINAL]`, `id=${call.id}`, `result=FILTERED`);
      
      // Structured suppression diagnostic for errors
      const suppressionDiagnostic = {
        insightId: call.id,
        generatorName: call.name,
        suppressionReason: 'Generator threw error',
        error: err instanceof Error ? err.message : String(err),
        inputData: {
          sessionRowsCount: input.sessionRows?.length || 0,
          githubByPeriodCount: input.githubByPeriod?.length || 0,
          hasGithubSnapshot: !!input.githubSnapshot
        },
        timestamp: new Date().toISOString()
      };
      
      piDebugLog(`[PI_SUPPRESSION_DIAGNOSTIC]`, JSON.stringify(suppressionDiagnostic));
      results.push({ id: call.id, name: call.name, success: false, reason: err instanceof Error ? err.message : String(err), suppressionDiagnostic });
    }
  }

  piDebugLog('[FINAL_PI_TRACE][PLAN_CODE_GENERATOR_COMPLETE]', {
    totalCalled: generatorCalls.length,
    successful: insights.length,
    failed: generatorCalls.length - insights.length,
    successfulIds: insights.map(i => i?.id).filter((id): id is string => !!id),
    failedResults: results.filter(r => !r.success).map(r => ({
      id: r.id,
      name: r.name,
      reason: r.reason
    }))
  });

  const baseInsights = insights.filter((insight): insight is CanonicalInsight => insight !== null);

  return baseInsights;
}
