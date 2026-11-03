/**
 * Final Canonical Performance Insights Registry
 * 
 * This is the SINGLE SOURCE OF TRUTH for canonical Performance Insights.
 * 
 * Replaces:
 * - CANONICAL_PI_REGISTRY.ts (old V2 registry)
 * - piV2Manifest.ts (MVP allowlist)
 * - V2_PREVIEW_ROW_IDS.ts (old canonical set)
 * - PI_REGISTRY.ts (old registry)
 * 
 * No imports from computeV2PerformanceInsights.ts or old V2 systems.
 * No dependencies on MVP_ALLOWLIST, shadow fallback logic, or legacy manifests.
 * 
 * REGISTRY COUNT: Derives from CANONICAL_PI_REGISTRY at runtime — no fixed count.
 * The assertFinalCanonicalInventory() function validates contract correctness
 * (unique IDs, required fields, stage membership) by deriving expectations
 * from the registry itself, NOT from a stale hand-written ID list.
 */

import type { CanonicalPIEntry, CanonicalStage } from './types';
import { piDebugInfo } from './utils/logging';

/**
 * The canonical Performance Insights (CR4 FINAL — MULTI-DATASET SHAPED)
 *
 * Organized by stage with renderOrder for UI display.
 *
 * CR4 FINAL CHANGES (multi-dataset provenance verification):
 * - PRESERVED: focus-ratio-by-ide (restored — distinct product concept from active-coding-time)
 * - PRESERVED: rework-rate-by-workflow (restored — diagnostic when lines_removed_total_est is estimated)
 * - PRESERVED: active-coding-ratio-by-workflow (restored — distinct ratio metric from absolute time)
 * - PRESERVED: rework-loop-detection (restored — diagnostic when developer_id not populated)
 * - ADDED: within-workflow-ai-effect (AI-active vs non-AI within same workflow — validated across 3 datasets)
 * - ADDED: ai-intensity-cohort-analysis (non-AI/low/medium/high cohorts — validated across 3 datasets)
 * - ADDED: repository-concentration (repo concentration from git_repo_url — validated on Local + Ed)
 * - DEMOTED: delivery-rate-ai-vs-non-ai (commit_count is synthetic — backfill generated)
 * - DEMOTED: executive-ai-yield-optimization (same synthetic commit data)
 * - DEMOTED: time-to-first-commit-by-ide (TTFC is synthetic — all values are exact multiples of 60000)
 *
 * Plan & Code (21 insights):
 * - active-coding-time-by-ide
 * - within-workflow-ai-effect (NEW - CR4 FINAL)
 * - ai-intensity-cohort-analysis (NEW - CR4 FINAL)
 * - repository-concentration (NEW - CR4 FINAL)
 * - delivery-rate-ai-vs-non-ai (DEMOTED to diagnostic — synthetic commit data)
 * - telemetry-ai-focus-imbalance
 * - session-conditioned-pr-cycle-time-ai-vs-non-ai
 * - executive-ai-yield-optimization (DEMOTED to diagnostic — synthetic commit data)
 * - ai-adoption-rate-by-ide
 * - focus-ratio-by-ide (PRESERVED — diagnostic when data insufficient)
 * - debug-time-by-ide
 * - terminal-time-by-ide
 * - time-to-first-commit-by-ide (DEMOTED to diagnostic — synthetic TTFC)
 * - rework-rate-by-workflow (PRESERVED — diagnostic when lines_removed estimated)
 * - active-coding-ratio-by-workflow (PRESERVED — diagnostic when data insufficient)
 * - rework-loop-detection (PRESERVED — diagnostic when developer_id not populated)
 * - workflow-quality-correlation
 * - session-quality-merge-success
 * - context-switching-impact
 * - ai-intensity-delivery-velocity
 * - review-burden-by-ai-pattern
 * - ai-adoption-velocity
 *
 * Review & Merge (3 insights):
 * - reviewer-load-concentration
 * - executive-small-pr-workflow-optimization
 * - reopen-pressure-spike
 *
 * Deploy & Operate (3 insights):
 * - delivery-velocity-by-workflow
 * - change-failure-rate-spike-by-ide
 * - synthesized-deployment-cadence
 *
 * DISABLED (3 PIs - require backend computation):
 * - revert-rate-by-ide (requires revert_metrics)
 * - executive-ai-reopen-pressure-risk (requires ai_reopen_rate, non_ai_reopen_rate)
 * - executive-stable-deployment-acceleration (requires success_rate, by_ide)
 */
export const CANONICAL_PI_REGISTRY: readonly CanonicalPIEntry[] = [
  // ============================================================
  // PLAN & CODE STAGE (19 canonical insights)
  // ============================================================
  {
    id: 'active-coding-time-by-ide',
    title: 'Active coding time by IDE',
    stage: 'plan-code',
    canonicalPriority: 1,
    renderOrder: 1,
    generatorKey: 'generateActiveCodingTimeByIDE',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: undefined,
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  // CR4 FINAL — NEW GENERIC PI FAMILIES (validated across Local, Staging, Ed)
  {
    id: 'within-workflow-ai-effect',
    title: 'AI-active vs non-AI sessions within the same workflow',
    stage: 'plan-code',
    canonicalPriority: 2,
    renderOrder: 2,
    generatorKey: 'generateWithinWorkflowAIEffect',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'within-workflow-ai',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact — controls for workflow, isolates AI effect
  },
  {
    id: 'ai-intensity-cohort-analysis',
    title: 'AI intensity cohort analysis within workflow',
    stage: 'plan-code',
    canonicalPriority: 3,
    renderOrder: 3,
    generatorKey: 'generateAIIntensityCohortAnalysis',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'ai-intensity-cohort',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact — nonlinear AI usage relationship
  },
  {
    id: 'repository-concentration',
    title: 'Repository concentration and workflow distribution',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 4,
    generatorKey: 'generateRepositoryConcentration',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'repo-concentration',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact — repo concentration risk
  },
  // CR-X 2026-08-30 P0-4: Repository distribution by workflow.
  // Compares how sessions are distributed across repositories between
  // workflows. When workflows show materially different repo concentration
  // patterns (e.g., Claude concentrated in backend repos while VS Code is
  // spread across frontend repos), this is a decision-grade finding about
  // workflow-task allocation.
  {
    id: 'repository-distribution-by-workflow',
    title: 'Repository distribution by workflow',
    stage: 'plan-code',
    canonicalPriority: 3,
    renderOrder: 31,
    generatorKey: 'generateRepositoryDistributionByWorkflow',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'repo-distribution',
    minimumConfidence: 'medium',
    demoRequired: false,
    suppressIfWeak: true,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // HIGH impact — workflow-task allocation
  },
  // CR-X 1A.6B: Within-workflow session-duration distribution shape.
  // Produces one instance per qualifying workflow (runtime instance family).
  // Gates: adequate N, materially skewed distribution, no known artifact.
  {
    id: 'workflow-session-distribution',
    title: 'Session duration distribution shape within workflow',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 29,
    generatorKey: 'generateWorkflowSessionDistribution',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'session-distribution',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: true,
    suppressIfBaseline: true,
    suppressIfNoDelta: true,
    intendedStageQuotaBucket: 2 // HIGH impact — workflow shape signal
  },
  // CR-X B — Within-workflow AI signal coverage.
  // Shows what percentage of sessions within a workflow have observed AI
  // signals vs zero observed AI signals. This is instrumentation health,
  // NOT a causal AI-vs-non-AI comparison. Works for single-workflow pilots.
  // Semantic: "sessions with observed AI signals" / "zero observed AI signals"
  {
    id: 'within-workflow-ai-signal-coverage',
    title: 'AI signal coverage within workflow',
    stage: 'plan-code',
    canonicalPriority: 3,
    renderOrder: 103,
    generatorKey: 'generateWithinWorkflowAISignalCoverage',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'within-workflow-ai-signal',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact — instrumentation health
  },
  // CR-X B — Within-workflow session duration profile.
  // Shows median, p90, and long-tail characteristics within a single workflow.
  // Lower threshold than workflow-session-distribution (15 sessions vs 50).
  // Works for sparse/single-workflow pilots.
  {
    id: 'within-workflow-session-duration-profile',
    title: 'Session duration profile within workflow',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 104,
    generatorKey: 'generateWithinWorkflowSessionDurationProfile',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'within-workflow-duration',
    minimumConfidence: 'low',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact — workflow shape baseline
  },
  // CR-X 2A: Within-workflow commits/session profile.
  // Shows median, p90, and distribution of commits per session within a
  // single workflow. Works for single-workflow pilots. Requires observed
  // commit provenance (session_commits_source === 'observed').
  {
    id: 'within-workflow-commits-profile',
    title: 'Commits per session profile within workflow',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 105,
    generatorKey: 'generateWithinWorkflowCommitsProfile',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'within-workflow-commits',
    minimumConfidence: 'low',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },
  // CR-X 2A: Within-workflow TTFC profile.
  // Shows median, p90 time-to-first-commit within a single workflow.
  // Requires observed commit provenance. Works for single-workflow pilots.
  {
    id: 'within-workflow-ttfc-profile',
    title: 'Time to first commit profile within workflow',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 106,
    generatorKey: 'generateWithinWorkflowTTFCProfile',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'within-workflow-ttfc',
    minimumConfidence: 'low',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },
  // CR-X 2A: Pilot maturity progression.
  // Contextual PI that shows what evidence stage the pilot is in and what
  // additional findings unlock as more data accumulates. Works from DAY 0.
  // Not a diagnostic — it's a useful contextual finding about pilot state.
  {
    id: 'pilot-maturity-progression',
    title: 'Pilot maturity progression',
    stage: 'plan-code',
    canonicalPriority: 5,
    renderOrder: 107,
    generatorKey: 'generatePilotMaturityProgression',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'pilot-maturity',
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  // CR-X 2026-08-30 — Observed session overlap and concurrency.
  // Produces one instance per qualifying workflow where interval evidence
  // (timestamp + duration_ms) exists and meaningful overlap is observed.
  // Reports additive observed session runtime, unique wall-clock span,
  // overlap factor, max simultaneously observed sessions, and — when
  // developer identity is stable — same-developer overlap.
  // SEMANTICS: Org-wide overlap is NOT evidence of one engineer operating
  // multiple agents. Only same-developer overlap (when identity is stable)
  // may be a decision finding. Org-wide overlap is contextual.
  {
    id: 'observed-session-overlap',
    title: 'Observed session overlap and concurrency',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 30,
    generatorKey: 'generateObservedSessionOverlap',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'concurrency',
    minimumConfidence: 'medium',
    demoRequired: false,
    suppressIfWeak: true,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },
  // CR5 P1 — NEW finding families from data-first census
  {
    id: 'commits-per-session-by-ide',
    title: 'Commits per session by IDE',
    stage: 'plan-code',
    canonicalPriority: 5,
    renderOrder: 22,
    generatorKey: 'generateCommitsPerSessionByIDE',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'commits-per-session',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },
  {
    id: 'multi-tool-day-effect',
    title: 'Multi-tool vs single-tool day effect',
    stage: 'plan-code',
    canonicalPriority: 6,
    renderOrder: 23,
    generatorKey: 'generateMultiToolDayEffect',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'multi-tool-day',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },
  {
    id: 'monthly-workflow-share',
    title: 'Monthly workflow share transition',
    stage: 'plan-code',
    canonicalPriority: 7,
    renderOrder: 24,
    generatorKey: 'generateMonthlyWorkflowShare',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'workflow-share',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },
  {
    id: 'delivery-rate-ai-vs-non-ai',
    title: 'Delivery rate: AI-assisted vs Non-AI',
    stage: 'plan-code',
    canonicalPriority: 2,
    renderOrder: 20,
    generatorKey: 'generateDeliveryRateAIVsNonAI',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'delivery-rate',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1, // MEDIUM impact - operational throughput
    maturity: 'pilot-validated'
  },
  {
    id: 'telemetry-ai-focus-imbalance',
    title: 'AI adoption spread across workflows',
    stage: 'plan-code',
    canonicalPriority: 5,
    renderOrder: 21,
    generatorKey: 'generateTelemetryAIFocusImbalance',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'ai-focus',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1, // MEDIUM impact - workflow fragmentation
    maturity: 'pilot-ready'
  },
  {
    id: 'session-conditioned-pr-cycle-time-ai-vs-non-ai',
    title: 'Session-to-PR attribution needed for delivery velocity and PR cycle time analysis',
    stage: 'review-merge',
    canonicalPriority: 4,
    renderOrder: 4,
    generatorKey: 'generateSessionConditionedPRCycleTimeAIVsNonAI',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'pr-cycle-time',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  {
    id: 'executive-ai-yield-optimization',
    title: 'AI yield optimization not yet measurable',
    stage: 'plan-code',
    canonicalPriority: 3,
    renderOrder: 5,
    generatorKey: 'generateExecutiveAIYieldOptimization',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'executive-yield',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact - strategic AI throughput finding
  },
  // NEW WAVE 1 INSIGHTS
  {
    id: 'ai-adoption-rate-by-ide',
    title: 'AI adoption rate across workflows',
    stage: 'plan-code',
    canonicalPriority: 6,
    renderOrder: 6,
    generatorKey: 'generateAIAdoptionRateByIDE',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'ai-adoption',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - AI enablement
  },
  // RESTORED CANONICAL PI (CR4 preservation rule: do not retire a canonical PI family
  // merely because current data cannot support it. focus-ratio-by-ide is a distinct
  // product concept — focus RATIO is a different metric than active-coding TIME.
  // When data is insufficient, the generator returns a diagnostic.)
  {
    id: 'focus-ratio-by-ide',
    title: 'Focus ratio by IDE',
    stage: 'plan-code',
    canonicalPriority: 7,
    renderOrder: 7,
    generatorKey: 'generateFocusRatioByIDE',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'focus-ratio',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - workflow focus
  },
  // NEW WAVE 2 INSIGHTS (TELEMETRY MOAT)
  {
    id: 'debug-time-by-ide',
    title: 'Debug time instrumentation not captured yet',
    stage: 'plan-code',
    canonicalPriority: 8,
    renderOrder: 8,
    generatorKey: 'generateDebugTimeByIDE',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'debug-time',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - code quality, HIGH telemetry moat
  },
  {
    id: 'terminal-time-by-ide',
    title: 'Terminal time instrumentation not captured yet',
    stage: 'plan-code',
    canonicalPriority: 9,
    renderOrder: 9,
    generatorKey: 'generateTerminalTimeByIDE',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'terminal-time',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - workflow patterns, HIGH telemetry moat
  },
  // NEW WAVE 3 INSIGHT
  {
    id: 'time-to-first-commit-by-ide',
    title: 'Time to first commit analysis needs workflow attribution',
    stage: 'plan-code',
    canonicalPriority: 10,
    renderOrder: 10,
    generatorKey: 'generateTimeToFirstCommitByIDE',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'ttfc',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - onboarding efficiency
  },
  // RESTORED CANONICAL PIs (CR4 preservation rule: data limitations make these
  // DIAGNOSTIC, not retired. The PI families are valid product concepts.)
  {
    id: 'rework-rate-by-workflow',
    title: 'Rework rate analysis needs broader workflow sample',
    stage: 'plan-code',
    canonicalPriority: 11,
    renderOrder: 11,
    generatorKey: 'generateReworkRateByWorkflow',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'rework-rate',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - code quality, HIGH telemetry moat
  },
  {
    id: 'active-coding-ratio-by-workflow',
    title: 'Active coding ratio analysis needs broader workflow sample',
    stage: 'plan-code',
    canonicalPriority: 12,
    renderOrder: 12,
    generatorKey: 'generateActiveCodingRatioByWorkflow',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'active-coding-ratio',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - workflow focus, HIGH telemetry moat
  },
  {
    id: 'rework-loop-detection',
    title: 'Rework loop detection needs broader workflow sample',
    stage: 'plan-code',
    canonicalPriority: 13,
    renderOrder: 13,
    generatorKey: 'generateReworkLoopDetection',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'rework-loop',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact - individual developer productivity
  },
  {
    id: 'workflow-quality-correlation',
    title: 'Workflow quality correlation needs session-to-PR attribution',
    stage: 'plan-code',
    canonicalPriority: 14,
    renderOrder: 14,
    generatorKey: 'generateWorkflowQualityCorrelation',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'workflow-quality',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact - workflow effectiveness
  },
  {
    id: 'session-quality-merge-success',
    title: 'GitHub delivery outcomes needed to correlate quality with workflow outcomes',
    stage: 'plan-code',
    canonicalPriority: 15,
    renderOrder: 15,
    generatorKey: 'generateSessionQualityMergeSuccess',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'session-quality',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact - code quality outcomes
  },
  {
    id: 'context-switching-impact',
    title: 'Context switching analysis needs broader workflow sample',
    stage: 'plan-code',
    canonicalPriority: 16,
    renderOrder: 16,
    generatorKey: 'generateContextSwitchingImpact',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'context-switching',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact - productivity impact
  },
  {
    id: 'ai-intensity-delivery-velocity',
    title: 'AI intensity impact waiting for session-to-PR attribution',
    stage: 'plan-code',
    canonicalPriority: 17,
    renderOrder: 17,
    generatorKey: 'generateAIIntensityDeliveryVelocity',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'ai-intensity-velocity',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact - AI ROI
  },
  {
    id: 'review-burden-by-ai-pattern',
    title: 'Review burden by AI pattern waiting for PR attribution',
    stage: 'plan-code',
    canonicalPriority: 18,
    renderOrder: 18,
    generatorKey: 'generateReviewBurdenByAIPattern',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'review-burden-ai',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact - reviewer capacity
  },
  {
    id: 'ai-adoption-velocity',
    title: 'AI adoption velocity across workflows',
    stage: 'plan-code',
    canonicalPriority: 19,
    renderOrder: 19,
    generatorKey: 'generateAIAdoptionVelocity',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'ai-adoption-velocity',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact - AI enablement
  },
  // CR5 WS2: File save activity by IDE — file_save_count per session across workflows
  // P0-2: renderOrder 25 (previously 20, collided with delivery-rate-ai-vs-non-ai)
  {
    id: 'files-edited-by-ide',
    title: 'File saves per session by IDE',
    stage: 'plan-code',
    canonicalPriority: 25,
    renderOrder: 25,
    generatorKey: 'generateFilesEditedByIDE',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: undefined,
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  // CR5 WS2 P0-3: Composite cross-tool session-profile — combines session_duration_minutes
  // with active_coding_duration_minutes into a single multi-dimensional comparison.
  // P0-2: renderOrder 26 (previously 21, collided with telemetry-ai-focus-imbalance)
  {
    id: 'session-profile-by-ide',
    title: 'Session profile by IDE (duration + active coding)',
    stage: 'plan-code',
    canonicalPriority: 26,
    renderOrder: 26,
    generatorKey: 'generateSessionProfileByIDE',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: undefined,
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0
  },
  // CR5 WS2 #14 P0-5: Composite observed longitudinal finding.
  // Neutral semantics — observed delivery-signal trend, NOT "engineering friction."
  // Gates: observed commit + TTFC provenance, ≥3 comparable periods, ≥20
  // qualified sessions per period, BOTH trends must clear materiality gates.
  {
    id: 'commit-ttfc-longitudinal',
    title: 'Observed delivery-signal trend: commits/session and time-to-first-commit over time',
    stage: 'plan-code',
    canonicalPriority: 27,
    renderOrder: 27,
    generatorKey: 'generateCommitTtfcLongitudinal',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'longitudinal-delivery',
    minimumConfidence: 'medium',
    demoRequired: false,
    suppressIfWeak: true,
    suppressIfBaseline: false,
    suppressIfNoDelta: true,
    intendedStageQuotaBucket: 1
  },

  // CR5 WS3 P0: Configured cost efficiency — composite cross-tool cost PI.
  // Uses PBT's configured-cost authority (localStorage via toolCost.ts).
  // Configured estimate ≠ billing data. NEVER labeled ROI.
  // Applies configured monthly rate to a single qualifying calendar month.
  // Cost/active-hour is the headline metric (normalizes cost by observed active use).
  // Explicitly configured $0 is NOT missing — uses absolute-dollar headline.
  // Gates: ≥2 primary workflows with ≥25 sessions in the same qualifying month.
  // Emerging workflows (Copilot, Claude Code) cannot control the headline.
  {
    id: 'configured-cost-efficiency-by-workflow',
    title: 'Configured cost efficiency across primary workflows',
    stage: 'plan-code',
    canonicalPriority: 28,
    renderOrder: 28,
    generatorKey: 'generateConfiguredCostEfficiencyByWorkflow',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'cost-efficiency',
    minimumConfidence: 'medium',
    demoRequired: false,
    suppressIfWeak: true,
    suppressIfBaseline: false,
    suppressIfNoDelta: true,
    intendedStageQuotaBucket: 1
  },
  // CR-X P1B.2 Wave 1: Adaptive temporal intelligence — "WHAT CHANGED?"
  // Single canonical family; multiple instances with deterministic IDs.
  // presentationKind: temporal_trend. Participates in normal ranking/portfolio.
  {
    id: 'recent-change',
    title: 'Recent change in engineering activity',
    stage: 'plan-code',
    canonicalPriority: 3,
    renderOrder: 39,
    generatorKey: 'generateRecentChangeInsights',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'recent-change',
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  // CR-X Wave 1B — Multi-dimensional analysis families.
  // These cross dimensions the per-metric generator architecture does not cross.
  // Each emits instance IDs of the form `<familyId>__<suffix>` and is registered
  // in RUNTIME_INSTANCE_FAMILIES so the canonical filter accepts them.
  // All consume CanonicalInsightInput only and emit into the same downstream
  // pipeline (dedupe → portfolio → canonical filter → ranking → render).
  // Family 1: Repo-Conditioned Behavior (W × R × B)
  // "Does the same workflow behave differently depending on which repository
  //  it is being used in?"
  // Mode-aware: human-interactive uses active-coding; delegated-agent uses runtime.
  // Observed commits/TTFC only. No causal claims.
  {
    id: 'repo-conditioned-behavior',
    title: 'Workflow behavior conditioned by repository',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 40,
    generatorKey: 'generateRepoConditionedBehavior',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'repo-conditioned-behavior',
    minimumConfidence: 'medium',
    demoRequired: false,
    suppressIfWeak: true,
    suppressIfBaseline: true,
    suppressIfNoDelta: true,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  // CR-X FINAL P0.6: Cross-surface behavior (W × S)
  // "Does the same workflow behave differently depending on the surface it runs on?"
  // Generic: works for any workflow with >1 surface (terminal vs IDE, editor vs CLI).
  // Mode-aware: delegated agents compare runtime; human-interactive compares active-coding.
  // No causal claims. No hardcoded workflow names.
  {
    id: 'cross-surface-behavior',
    title: 'Workflow behavior conditioned by surface',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 39,
    generatorKey: 'generateCrossSurfaceBehavior',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'cross-surface-behavior',
    minimumConfidence: 'medium',
    demoRequired: false,
    suppressIfWeak: true,
    suppressIfBaseline: true,
    suppressIfNoDelta: true,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  // CR-X FINAL P0.7: Within-workflow longitudinal behavior (W × T)
  // "How is this workflow changing over time?"
  // Generic mature-workflow longitudinal intelligence. Compares a recent window
  // to an equally-sized prior window for the same workflow. Adaptive window
  // sizing based on available history. Works for delegated and human-interactive
  // workflows. No hardcoded workflow names. No cross-mode comparisons.
  {
    id: 'within-workflow-longitudinal-behavior',
    title: 'Workflow behavior changing over time',
    stage: 'plan-code',
    canonicalPriority: 3,
    renderOrder: 38,
    generatorKey: 'generateWithinWorkflowLongitudinal',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'within-workflow-longitudinal',
    minimumConfidence: 'medium',
    demoRequired: false,
    suppressIfWeak: true,
    suppressIfBaseline: true,
    suppressIfNoDelta: true,
    intendedStageQuotaBucket: 2,
    maturity: 'experimental'
  },
  // Family 2: Workflow × Repo Allocation (W × R)
  // "Where are our different AI workflows actually being used?"
  // Exposes material allocation patterns, concentration, specialization, or
  // contrast across workflows and repos. No hardcoded pilot/repo names.
  {
    id: 'workflow-repo-allocation',
    title: 'Workflow allocation across repositories',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 41,
    generatorKey: 'generateWorkflowRepoAllocation',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'workflow-repo-allocation',
    minimumConfidence: 'medium',
    demoRequired: false,
    suppressIfWeak: true,
    suppressIfBaseline: true,
    suppressIfNoDelta: true,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  // Family 3: Within-Workflow Temporal Behavior (W × B × T)
  // "What changed in how this workflow behaves?"
  // Distinct from recent-change (adoption/volume). Focuses on mode-legal
  // behavior measures: observed commits/session and observed TTFC.
  // Active-coding/runtime temporal change is handled by recent-change.
  {
    id: 'within-workflow-temporal-behavior',
    title: 'Within-workflow behavior change over time',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 42,
    generatorKey: 'generateWithinWorkflowTemporalBehavior',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'within-workflow-temporal-behavior',
    minimumConfidence: 'medium',
    demoRequired: false,
    suppressIfWeak: true,
    suppressIfBaseline: true,
    suppressIfNoDelta: true,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  // Family 4: Workflow × Repo Allocation Shift (W × R × T)
  // "Has where we're using this workflow changed?"
  // Bounded share/delta comparison with clear minimum samples. No generic
  // statistics framework. No hardcoded pilot names.
  {
    id: 'workflow-repo-allocation-shift',
    title: 'Workflow repository allocation shift over time',
    stage: 'plan-code',
    canonicalPriority: 4,
    renderOrder: 43,
    generatorKey: 'generateWorkflowRepoAllocationShift',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'workflow-repo-allocation-shift',
    minimumConfidence: 'medium',
    demoRequired: false,
    suppressIfWeak: true,
    suppressIfBaseline: true,
    suppressIfNoDelta: true,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  // CR-X PI Product-Strength Wave: Executive temporal synthesis
  // Combines sibling recent-change findings into one executive finding
  // when multiple workflow-mix changes describe the same window.
  // This is a single-instance ID (not a runtime-instance family).
  {
    id: 'executive-workflow-mix-synthesis',
    title: 'Workflow mix shifted sharply',
    stage: 'plan-code',
    canonicalPriority: 95,
    renderOrder: 0,
    generatorKey: 'generateExecutiveTemporalSynthesis',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'executive-workflow-mix-synthesis',
    minimumConfidence: 'medium',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0,
    maturity: 'experimental'
  },

  // ============================================================
  // REVIEW & MERGE STAGE (3 canonical insights - PILOT READY)
  // ============================================================
  {
    id: 'reviewer-load-concentration',
    title: 'Reviewer load concentration',
    stage: 'review-merge',
    canonicalPriority: 2,
    renderOrder: 6,
    generatorKey: 'generateReviewerLoadConcentration',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'reviewer-scaling',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - reviewer bottleneck risk
  },
  {
    id: 'executive-small-pr-workflow-optimization',
    title: 'Small PR workflow optimization',
    stage: 'review-merge',
    canonicalPriority: 5,
    renderOrder: 7,
    generatorKey: 'generateExecutiveSmallPRWorkflowOptimization',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'executive-pr-workflow',
    minimumConfidence: 'high',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - workflow optimization finding
  },
  {
    id: 'reopen-pressure-spike',
    title: 'PR reopen rate elevated across workflows',
    stage: 'review-merge',
    canonicalPriority: 3,
    renderOrder: 8,
    generatorKey: 'generateReopenPressureSpike',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'reopen-pressure',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - quality risk
  },
  // DISABLED: revert-rate-by-ide (RED - requires revert_metrics)
  // DISABLED: executive-ai-reopen-pressure-risk (RED - requires ai_reopen_rate, non_ai_reopen_rate)

  // ── CR-X Track C: Review & Merge delivery outcomes ──────────
  // Org-level delivery evidence until L1/L2 attribution is available.
  // review_count + reopen_count is REVIEW BURDEN, never "review cycles".
  {
    id: 'merge-cycle-time',
    title: 'Merge cycle time',
    stage: 'review-merge',
    canonicalPriority: 1,
    renderOrder: 32,
    generatorKey: 'generateMergeCycleTime',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'merge-cycle',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2
  },
  {
    id: 'merge-rate',
    title: 'Merge rate',
    stage: 'review-merge',
    canonicalPriority: 2,
    renderOrder: 33,
    generatorKey: 'generateMergeRate',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'merge-rate',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },
  {
    id: 'pr-throughput',
    title: 'PR throughput',
    stage: 'review-merge',
    canonicalPriority: 3,
    renderOrder: 34,
    generatorKey: 'generatePrThroughput',
    isFallbackAllowed: false,
    isExecutiveFinding: false,
    dedupeGroup: 'pr-throughput',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },
  {
    id: 'review-burden',
    title: 'Review burden',
    stage: 'review-merge',
    canonicalPriority: 3,
    renderOrder: 35,
    generatorKey: 'generateReviewBurden',
    isFallbackAllowed: false,
    isExecutiveFinding: false,
    dedupeGroup: 'review-burden',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },

  // ============================================================
  // DEPLOY & OPERATE STAGE (3 canonical insights - PILOT READY)
  // ============================================================
  {
    id: 'delivery-velocity-by-workflow',
    title: 'Deployment throughput across the organization',
    stage: 'deploy-operate',
    canonicalPriority: 1,
    renderOrder: 9,
    generatorKey: 'generateDeliveryVelocityByWorkflow',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'deployment-cadence', // Share dedupeGroup with synthesized-deployment-cadence to prevent duplicate cards
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - operational cycle time
  },
  {
    id: 'change-failure-rate-spike-by-ide',
    title: 'Change failure rate across deployments',
    stage: 'deploy-operate',
    canonicalPriority: 2,
    renderOrder: 10,
    generatorKey: 'generateChangeFailureRateSpikeByIDE',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'failure-rate',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1 // MEDIUM impact - operational deployment stability
  },
  {
    id: 'synthesized-deployment-cadence',
    title: 'Deployment cadence and failure rate tradeoff',
    stage: 'deploy-operate',
    canonicalPriority: 3,
    renderOrder: 20,
    generatorKey: 'generateDeploymentReliabilityPressure',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: 'deployment-cadence',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 2 // HIGH impact - strategic velocity-stability tradeoff
  },
  // DISABLED: executive-stable-deployment-acceleration (RED - requires success_rate, by_ide)

  // ── CR-X Track D: Deploy & Operate delivery outcomes ────────
  // Org-level delivery evidence until L1/L2 attribution is available.
  {
    id: 'deployment-success-distribution',
    title: 'Deployment success and failure distribution',
    stage: 'deploy-operate',
    canonicalPriority: 2,
    renderOrder: 36,
    generatorKey: 'generateDeploymentSuccessDistribution',
    isFallbackAllowed: false,
    isExecutiveFinding: false,
    dedupeGroup: 'deployment-distribution',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },
  {
    id: 'release-cadence',
    title: 'Release cadence',
    stage: 'deploy-operate',
    canonicalPriority: 3,
    renderOrder: 37,
    generatorKey: 'generateReleaseCadence',
    isFallbackAllowed: false,
    isExecutiveFinding: false,
    dedupeGroup: 'release-cadence',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },
  {
    id: 'deployment-failure-concentration',
    title: 'Deployment failure concentration',
    stage: 'deploy-operate',
    canonicalPriority: 3,
    renderOrder: 38,
    generatorKey: 'generateDeploymentFailureConcentration',
    isFallbackAllowed: false,
    isExecutiveFinding: false,
    dedupeGroup: 'failure-concentration',
    minimumConfidence: 'medium',
    demoRequired: true,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1
  },

  // ── UNIT ECONOMICS V1: Allocated unit economics ──────────────
  // Configured AI spend divided by delivery outcomes in the same time window.
  // Period-level allocation, NOT per-outcome causal attribution.
  // Never labeled ROI. Never labeled "actual cost". Always "configured estimate".
  {
    id: 'allocated-spend-per-merged-pr',
    title: 'Configured AI spend per merged PR',
    stage: 'review-merge',
    canonicalPriority: 2,
    renderOrder: 25,
    generatorKey: 'generateAllocatedSpendPerMergedPR',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'unit-economics',
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  {
    id: 'allocated-spend-per-deployment',
    title: 'Configured AI spend per deployment',
    stage: 'deploy-operate',
    canonicalPriority: 2,
    renderOrder: 25,
    generatorKey: 'generateAllocatedSpendPerDeployment',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'unit-economics',
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  {
    id: 'allocated-spend-per-successful-deployment',
    title: 'Configured AI spend per successful deployment',
    stage: 'deploy-operate',
    canonicalPriority: 2,
    renderOrder: 26,
    generatorKey: 'generateAllocatedSpendPerSuccessfulDeployment',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'unit-economics',
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  {
    id: 'allocated-spend-per-failed-deployment',
    title: 'Configured AI spend per failed deployment',
    stage: 'deploy-operate',
    canonicalPriority: 2,
    renderOrder: 27,
    generatorKey: 'generateAllocatedSpendPerFailedDeployment',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'unit-economics',
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  {
    id: 'allocated-spend-per-review-cycle',
    title: 'Configured AI spend per review burden event',
    stage: 'review-merge',
    canonicalPriority: 2,
    renderOrder: 28,
    generatorKey: 'generateAllocatedSpendPerReviewCycle',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'unit-economics',
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  {
    id: 'allocated-spend-per-release',
    title: 'Configured AI spend per release',
    stage: 'deploy-operate',
    canonicalPriority: 2,
    renderOrder: 29,
    generatorKey: 'generateAllocatedSpendPerRelease',
    isExecutiveFinding: true,
    isFallbackAllowed: false,
    dedupeGroup: 'unit-economics',
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 1,
    maturity: 'experimental'
  },
  // ============================================================
  // CR-X PASS 3 — EARLY-SIGNAL PIs (new pilot coverage)
  // These fire with as few as 5 sessions, providing visibility
  // before mature-pilot PIs (MIN_SESSIONS=25-50) unlock.
  // ============================================================
  {
    id: 'early-signal-workflow-adoption',
    title: 'Workflow adoption (early signal)',
    stage: 'plan-code',
    canonicalPriority: 100,
    renderOrder: 100,
    generatorKey: 'generateEarlySignalWorkflowAdoption',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: undefined,
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0,
    maturity: 'experimental'
  },
  {
    id: 'early-signal-developer-activity',
    title: 'Developer activity (early signal)',
    stage: 'plan-code',
    canonicalPriority: 101,
    renderOrder: 101,
    generatorKey: 'generateEarlySignalDeveloperActivity',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: undefined,
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0,
    maturity: 'experimental'
  },
  {
    id: 'claude-code-runtime-cohort',
    title: 'Claude Code runtime modes and AI-signal cohorts',
    stage: 'plan-code',
    canonicalPriority: 103,
    renderOrder: 108,
    generatorKey: 'generateClaudeCodeRuntimeCohort',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: undefined,
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0,
    maturity: 'experimental'
  },
  {
    id: 'developer-workflow-cost-efficiency-frontier',
    title: 'Developer×workflow efficiency frontier',
    stage: 'plan-code',
    canonicalPriority: 102,
    renderOrder: 102,
    generatorKey: 'generateDeveloperWorkflowCostEfficiencyFrontier',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: undefined,
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0,
    maturity: 'experimental'
  },
  // CR-X Slice 3: Workflow cost × delivery outcome comparison
  {
    id: 'workflow-cost-delivery-comparison',
    title: 'Workflow cost vs delivery outcomes',
    stage: 'plan-code',
    canonicalPriority: 103,
    renderOrder: 200,
    generatorKey: 'generateWorkflowCostDeliveryComparison',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: undefined,
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0,
    maturity: 'experimental'
  },
  // CR-X Slice 3: Workflow delivery efficiency (cost per merged PR / deployment)
  {
    id: 'workflow-delivery-efficiency',
    title: 'Workflow delivery efficiency',
    stage: 'deploy-operate',
    canonicalPriority: 104,
    renderOrder: 201,
    generatorKey: 'generateWorkflowDeliveryEfficiency',
    isExecutiveFinding: false,
    isFallbackAllowed: false,
    dedupeGroup: undefined,
    minimumConfidence: 'low',
    demoRequired: false,
    suppressIfWeak: false,
    suppressIfBaseline: false,
    suppressIfNoDelta: false,
    intendedStageQuotaBucket: 0,
    maturity: 'experimental'
  },
] as const;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get a canonical PI entry by ID
 */
export function getCanonicalPIById(id: string): CanonicalPIEntry | undefined {
  return CANONICAL_PI_REGISTRY.find(entry => entry.id === id);
}

/**
 * Get all canonical PIs for a specific stage
 */
export function getCanonicalPIsByStage(stage: CanonicalStage): CanonicalPIEntry[] {
  return CANONICAL_PI_REGISTRY
    .filter(entry => entry.stage === stage)
    .sort((a, b) => a.renderOrder - b.renderOrder);
}

/**
 * Get all executive findings
 */
export function getExecutiveFindings(): CanonicalPIEntry[] {
  return CANONICAL_PI_REGISTRY
    .filter(entry => entry.isExecutiveFinding)
    .sort((a, b) => a.renderOrder - b.renderOrder);
}

/**
 * Get all canonical PI IDs as a Set
 */
export function getCanonicalPIIds(): Set<string> {
  return new Set(CANONICAL_PI_REGISTRY.map(entry => entry.id));
}

// ============================================================
// CR5 P1.2 — CANONICAL FAMILY RESOLUTION (SINGLE AUTHORITY)
// ============================================================

/**
 * Registry families that support per-workflow runtime instances.
 * Their generators return CanonicalInsight[] (array) and produce
 * instance IDs of the form `baseId__workflowId`.
 *
 * A family is listed here ONLY when its generator is designed to
 * instantiate once per eligible workflow/cohort.
 */
const RUNTIME_INSTANCE_FAMILIES: ReadonlySet<string> = new Set([
  'within-workflow-ai-effect',
  'ai-intensity-cohort-analysis',
  'workflow-session-distribution',
  'observed-session-overlap',
  // CR-X 2A: Within-workflow profile families (one instance per qualifying workflow)
  'within-workflow-ai-signal-coverage',
  'within-workflow-session-duration-profile',
  'within-workflow-commits-profile',
  'within-workflow-ttfc-profile',
  // CR-X P1B.2 Wave 1: recent-change emits `recent-change__{dimension}__{workflow}`
  // instances. Without this entry, resolveCanonicalFamilyId() returned null for
  // all recent-change IDs and the canonical filter silently dropped every
  // temporal finding. This was a pre-existing bug discovered during Wave 1A.
  'recent-change',
  // CR-X Wave 1B: Multi-dimensional analysis families. Each emits instance IDs
  // of the form `<familyId>__<suffix>`. They must be registered here or the
  // canonical filter will silently drop their findings.
  'repo-conditioned-behavior',
  'workflow-repo-allocation',
  'within-workflow-temporal-behavior',
  'workflow-repo-allocation-shift',
]);

/**
 * Resolve a runtime insight ID to its canonical family ID.
 *
 * - Exact registered ID → returns itself
 * - Instance ID (`base__suffix`) → returns the base ID if the base
 *   is registered AND the family supports runtime instances
 * - Unregistered / invalid → returns null
 *
 * This is the SINGLE authority for canonical family resolution.
 * All canonical-membership tests must use this helper.
 */
export function resolveCanonicalFamilyId(insightId: string): string | null {
  // Rule 1: exact registered ID
  const exact = getCanonicalPIById(insightId);
  if (exact) return insightId;

  // Rule 2: instance ID with "__" separator
  const sepIdx = insightId.indexOf('__');
  if (sepIdx < 0) return null;

  const baseId = insightId.slice(0, sepIdx);
  const suffix = insightId.slice(sepIdx + 2);

  // Suffix must be non-empty
  if (!suffix) return null;

  // Base ID must be registered
  const baseEntry = getCanonicalPIById(baseId);
  if (!baseEntry) return null;

  // Family must support runtime instances
  if (!RUNTIME_INSTANCE_FAMILIES.has(baseId)) return null;

  return baseId;
}

/**
 * Check whether a runtime insight ID is canonically valid
 * (either an exact registered ID or a valid instance ID).
 */
export function isCanonicalInsightId(insightId: string): boolean {
  return resolveCanonicalFamilyId(insightId) !== null;
}

/**
 * Get the set of family IDs that support runtime instances.
 */
export function getRuntimeInstanceFamilies(): ReadonlySet<string> {
  return RUNTIME_INSTANCE_FAMILIES;
}

/**
 * Get fallback-allowed PIs
 */
export function getFallbackAllowedPIs(): CanonicalPIEntry[] {
  return CANONICAL_PI_REGISTRY.filter(entry => entry.isFallbackAllowed);
}

/**
 * Get dedupe groups mapping
 */
export function getDedupeGroups(): Map<string, CanonicalPIEntry[]> {
  const groups = new Map<string, CanonicalPIEntry[]>();
  for (const entry of CANONICAL_PI_REGISTRY) {
    if (entry.dedupeGroup) {
      if (!groups.has(entry.dedupeGroup)) {
        groups.set(entry.dedupeGroup, []);
      }
      groups.get(entry.dedupeGroup)!.push(entry);
    }
  }
  return groups;
}

/**
 * Validation function to verify canonical inventory is correct
 *
 * CR4 6D FIX: Removed brittle fixed-count assertions (28/21/4/3).
 * The registry IS the authority — validation now checks structural
 * correctness only, not a hardcoded inventory size.
 *
 * Verifies:
 * - No duplicate IDs
 * - Every PI has required fields (title, stage, priority, renderOrder, generatorKey)
 * - Every stage is a legal canonical stage
 * - Every generatorKey is non-empty
 *
 * Throws an error if validation fails.
 */
export function assertFinalCanonicalInventory(): void {
  const errors: string[] = [];

  // Check for duplicate IDs
  const ids = CANONICAL_PI_REGISTRY.map(entry => entry.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    errors.push(`Duplicate IDs found: ${duplicates.join(', ')}`);
  }

  // Legal canonical stages
  const legalStages = new Set(['plan-code', 'review-merge', 'deploy-operate']);

  // Check required fields and legal stage membership
  for (const entry of CANONICAL_PI_REGISTRY) {
    if (!entry.title) {
      errors.push(`PI ${entry.id} is missing title`);
    }
    if (!entry.stage) {
      errors.push(`PI ${entry.id} is missing stage`);
    } else if (!legalStages.has(entry.stage)) {
      errors.push(`PI ${entry.id} has illegal stage '${entry.stage}'`);
    }
    if (entry.canonicalPriority === undefined) {
      errors.push(`PI ${entry.id} is missing canonicalPriority`);
    }
    if (entry.renderOrder === undefined) {
      errors.push(`PI ${entry.id} is missing renderOrder`);
    }
    if (!entry.generatorKey) {
      errors.push(`PI ${entry.id} is missing generatorKey`);
    }
  }

  // CR4 6D: No fixed count assertions. The registry derives its own size.
  // No second hand-written ID list. No split-brain authority.

  // Throw if any errors
  if (errors.length > 0) {
    console.error('[CANONICAL_INVENTORY_VALIDATION_FAILED]', errors);
    throw new Error(`Canonical inventory validation failed:\n${errors.join('\n')}`);
  }

  const planCodeCount = CANONICAL_PI_REGISTRY.filter(entry => entry.stage === 'plan-code').length;
  const reviewMergeCount = CANONICAL_PI_REGISTRY.filter(entry => entry.stage === 'review-merge').length;
  const deployOperateCount = CANONICAL_PI_REGISTRY.filter(entry => entry.stage === 'deploy-operate').length;

  piDebugInfo('[CANONICAL_INVENTORY_VALIDATION_PASSED]', {
    total: CANONICAL_PI_REGISTRY.length,
    planCode: planCodeCount,
    reviewMerge: reviewMergeCount,
    deployOperate: deployOperateCount,
    executiveFindings: getExecutiveFindings().length,
    pilotReady: true
  });
}

/**
 * Get all canonical insight IDs
 */
export function getCanonicalInsightIds(): Set<string> {
  return new Set(CANONICAL_PI_REGISTRY.map(entry => entry.id));
}

/**
 * Get disabled canonical insight IDs (commented out in registry)
 */
export function getDisabledCanonicalInsightIds(): Set<string> {
  return new Set([
    'revert-rate-by-ide',
    'executive-ai-reopen-pressure-risk',
    'executive-stable-deployment-acceleration'
  ]);
}

/**
 * Get active canonical insight IDs (registered - disabled)
 */
export function getActiveCanonicalInsightIds(): Set<string> {
  const allIds = getCanonicalInsightIds();
  const disabledIds = getDisabledCanonicalInsightIds();
  
  return new Set([...allIds].filter(id => !disabledIds.has(id)));
}

/**
 * Validate canonical titles for gibberish or corrupted strings
 * Throws error if any title contains non-alphabetic corruption patterns
 */
export function validateCanonicalTitles(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  for (const entry of CANONICAL_PI_REGISTRY) {
    const title = entry.title;
    
    // Check for gibberish patterns (repeated characters, keyboard mash)
    if (/(.)\1{4,}/.test(title)) {
      errors.push(`Gibberish title detected for ${entry.id}: "${title}" (repeated characters)`);
    }
    
    // Check for keyboard mash patterns (adjacent keys)
    const keyboardMashPatterns = /asdf|qwer|zxcv|jkl;/i;
    if (keyboardMashPatterns.test(title)) {
      errors.push(`Keyboard mash detected for ${entry.id}: "${title}"`);
    }
    
    // Check for impossible strings (corrupted encodings)
    if (/[^a-zA-Z0-9\s\-\:\(\)\,\.\/\&]/.test(title)) {
      errors.push(`Corrupted characters in title for ${entry.id}: "${title}"`);
    }
    
    // Check for empty or whitespace-only titles
    if (!title || title.trim().length === 0) {
      errors.push(`Empty title for ${entry.id}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get canonical insights by stage
 */
export function getCanonicalInsightsByStage(): Record<string, CanonicalPIEntry[]> {
  const byStage: Record<string, CanonicalPIEntry[]> = {
    'plan-code': [],
    'review-merge': [],
    'deploy-operate': []
  };
  
  for (const entry of CANONICAL_PI_REGISTRY) {
    if (byStage[entry.stage]) {
      byStage[entry.stage].push(entry);
    }
  }
  
  return byStage;
}
