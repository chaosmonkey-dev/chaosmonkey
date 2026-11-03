/**
 * Render Adapter for Final Canonical Performance Insights
 * 
 * This module adapts canonical insights into the exact shape currently expected by PerformanceInsightsWidget.vue.
 * 
 * INTENDED FUTURE DATA FLOW:
 * 1. Generators produce CanonicalInsight objects
 * 2. Ranking sorts insights by stage and renderOrder
 * 3. RenderAdapter adapts CanonicalInsight to PerformanceInsight (UI contract)
 * 4. PerformanceInsightsWidget.vue receives adapted insights and renders them
 * 
 * CURRENT STATUS: Adapter using canonical inventory
 * - Adapts CanonicalInsight to PerformanceInsight shape
 * - Preserves all fields required by UI
 * - No actual UI changes yet (to be done in Phase D)
 * - Adapter validates the data flow to UI works correctly
 * 
 * No imports from old V2 systems (computeV2PerformanceInsights.ts, piV2Manifest.ts, V2_PREVIEW_ROW_IDS)
 */

import type { CanonicalInsight, CanonicalStage, Evidence, ToolBreakdown } from '../types';
import { validateCanonicalTitle } from '../utils/titleResolver';
import { sanitizeInsight } from '../utils/payloadSanitizer';
import { computeComparisonState, generateTitleFromComparisonState } from '../helpers/comparisonState';
import { getCanonicalWorkflowIdentity } from '../../../workflowIdentity';
import { resolveInsightLifecycle } from '../resolveInsightLifecycle';
import { piDebugLog } from '../utils/logging';
import { normalizeSourceLabel, normalizeBreadcrumbs, computeProvenanceLabel, computeScopeLabel } from '../helpers/sourceLabelNormalizer';

/**
 * Defensive title sanitizer to prevent directional titles on non-comparable insights
 * 
 * Strips directional comparison language when insight is diagnostic, attribution gap,
 * insufficient, not comparable, non-AI unavailable, or has no ranked comparison rows.
 * 
 * @param title - Current insight title
 * @param comparisonState - Computed comparison state
 * @param insight - Full insight object for context
 * @returns Sanitized title with neutral fallback
 */
export function sanitizeDirectionalTitle(
  title: string,
  comparisonState: string,
  insight: CanonicalInsight
): string {
  // Check if insight is non-comparable
  const isNonComparable = [
    'needs_more_data',
    'instrumentation_gap',
    'emerging_sample',
    'org_level_only'
  ].includes(comparisonState);

  // Check if breakdown has ranked comparison rows
  const hasRankedRows = insight.breakdownByTool && 
    Object.values(insight.breakdownByTool).some(data => 
      data && data.count > 0 && typeof data.value === 'number' && data.value > 0
    );

  // CR5 P0.9: Check for AI vs Non-AI data availability — support both
  // simple (non_ai) and within-workflow (*_nonai) key patterns.
  const bdKeys = insight.breakdownByTool ? Object.keys(insight.breakdownByTool) : [];
  const hasNonAIData = (insight.breakdownByTool?.non_ai &&
    insight.breakdownByTool.non_ai.count > 0 &&
    insight.breakdownByTool.non_ai.value !== undefined) ||
    bdKeys.some(k => k.endsWith('_nonai') && insight.breakdownByTool![k]?.count > 0 &&
      insight.breakdownByTool![k]?.value !== undefined);

  // Directional patterns to strip
  const directionalPatterns = [
    /shows higher/gi,
    /shows lower/gi,
    /leads/gi,
    /beats/gi,
    /faster than/gi,
    /slower than/gi,
    /better than/gi,
    /worse than/gi,
    /has lower/gi,
    /has higher/gi,
    /than VS Code/gi,
    /than Cursor/gi,
    /than Devin/gi,
    /than Claude Code/gi,
    /than Windsurf/gi
  ];

  // If non-comparable or no ranked rows, strip directional language
  if (isNonComparable || !hasRankedRows) {
    let sanitizedTitle = title;
    for (const pattern of directionalPatterns) {
      sanitizedTitle = sanitizedTitle.replace(pattern, '');
    }
    
    // Clean up double spaces and trailing words
    sanitizedTitle = sanitizedTitle.replace(/\s+/g, ' ').trim();
    
    // If title became empty or too short, use neutral fallback by metric family
    if (sanitizedTitle.length < 10) {
      sanitizedTitle = getNeutralFallback(insight.id, insight);
    }
    
    return sanitizedTitle;
  }

  // AI vs Non-AI specific check
  if (insight.comparisonMode === 'ai_vs_non_ai') {
    if (!hasNonAIData && title.toLowerCase().includes('non-ai unavailable')) {
      // Title already says unavailable, keep it
      return title;
    }
    if (!hasNonAIData && !title.toLowerCase().includes('non-ai unavailable')) {
      // Non-AI unavailable but title doesn't say it - fix
      return 'AI-assisted workflow metrics: Non-AI baseline unavailable';
    }
    if (hasNonAIData && title.toLowerCase().includes('non-ai unavailable')) {
      // Non-AI available but title says unavailable - fix
      return generateTitleFromComparisonState(insight, title);
    }
  }

  return title;
}

/**
 * Get neutral fallback title by metric family
 */
function getNeutralFallback(insightId: string, insight: CanonicalInsight): string {
  const id = insightId.toLowerCase();
  
  // CR5 P0-7: Tracked AI signal coverage, not "AI adoption"
  if (id.includes('ai-adoption') || id.includes('ai_focus_imbalance')) {
    if (insight.current && typeof insight.current === 'number') {
      return `Tracked AI signal coverage is ${insight.current.toFixed(1)}% across tracked sessions`;
    }
    return 'Tracked AI signal coverage analysis needs workflow attribution';
  }
  
  // Focus Ratio
  if (id.includes('focus-ratio') || id.includes('focus_ratio')) {
    return 'Focus ratio analysis needs complete workflow attribution';
  }
  
  // Session Quality
  if (id.includes('session-quality') || id.includes('session_quality')) {
    return 'Session quality analysis needs complete workflow attribution';
  }
  
  // High-Quality Sessions
  if (id.includes('high-quality') || id.includes('high_quality')) {
    return 'High-quality session analysis needs complete workflow attribution';
  }
  
  // TTFC
  if (id.includes('time-to-first-commit') || id.includes('ttfc')) {
    return 'Time to first commit analysis needs complete workflow attribution';
  }
  
  // AI vs Non-AI
  if (id.includes('ai-vs-non-ai') || id.includes('ai_vs_non_ai')) {
    const hasNonAIData = insight.breakdownByTool?.non_ai && 
      insight.breakdownByTool.non_ai.count > 0;
    if (!hasNonAIData) {
      return 'AI-assisted workflow metrics: Non-AI baseline unavailable';
    }
    return 'AI-assisted workflow metrics analysis';
  }
  
  // Org-level GitHub cards
  if (id.includes('reviewer-load') || id.includes('reviewer_load')) {
    if (insight.current && typeof insight.current === 'number' && insight.current > 0) {
      return `Reviewer load concentration is ${insight.current.toFixed(1)}% across the organization`;
    }
    return 'Reviewer load concentration needs reviewer attribution';
  }
  
  if (id.includes('change-failure') || id.includes('change_failure')) {
    if (insight.current && typeof insight.current === 'number') {
      return `Change failure rate is ${insight.current.toFixed(1)}% across deployments`;
    }
    return 'Change failure rate analysis needs deployment attribution';
  }
  
  if (id.includes('deployment') || id.includes('throughput') || id.includes('cadence')) {
    if (insight.current && typeof insight.current === 'number') {
      return `Deployment throughput is ${insight.current.toFixed(1)} deployments/week`;
    }
    return 'Deployment throughput analysis needs deployment attribution';
  }
  
  if (id.includes('merge-velocity') || id.includes('merge_velocity') || id.includes('small-pr')) {
    return 'Small PR workflow optimization needs PR-size attribution';
  }
  
  // Default fallback
  return `${insight.title.replace(/shows higher|shows lower|leads|beats|faster than|slower than|better than|worse than/gi, '').trim()} analysis needs attribution`;
}

/**
 * Performance Insight (UI contract)
 * 
 * This is the shape expected by PerformanceInsightsWidget.vue
 * We adapt CanonicalInsight to this shape.
 */
export interface PerformanceInsight {
  id: string;
  title: string;
  subtitle?: string;
  rightMetric?: string;
  rightMetricLabel?: string;
  details?: string;
  coveragePct?: number;
  n?: number;
  insufficientSignal?: boolean;
  breakdownByTool?: ToolBreakdown; // Preserve structured ToolBreakdown, not flattened strings
  definition?: string;
  recommendation?: string;
  conceptKey?: string;
  signalCoveragePct?: number;
  primarySignalsUsed?: string[];
  dataMaturityLabel?: 'Early Signal' | 'Directional Signal' | 'Established Signal';
  demoFlag?: 'demo_primary' | 'demo_secondary' | 'demo_hidden';
  contributingUnitsCount?: number;
  contributingUnitType?: 'sessions' | 'prs' | 'deployments';
  owner?: string;
  // Additional fields for canonical insights
  cicdStage?: string;
  canonicalPriority?: number;
  renderOrder?: number;
  presentationType?: string;
  presentationKind?: string; // CR5 P0.8: Semantic card shape
  comparisonMode?: string;
  comparisonState?: string; // Data truth validation state
  polarity?: 'higher_is_better' | 'lower_is_better' | 'neutral';
  isDiagnostic?: boolean;
  isOrgLevelMetric?: boolean;
  // CR-X 2B: Explicit population scope labeling.
  // PIs are always org-level (full canonical population). When PBT filters
  // are active (developer/repo), this field lets the UI explicitly label
  // that PIs describe the org, not the filtered subset.
  populationScope?: 'org_level' | 'workflow_scoped' | 'developer_scoped' | 'scoped';
  // CR-X Track A: Population context label for PI subtitles.
  // Describes the scoped population (e.g., "Last 30d · Developer dev1 · Repo owner/repo1")
  populationContextLabel?: string;
  recommendationAllowed?: boolean;
  isTopInsightEligible?: boolean;
  topInsightRank?: number;
  diagnosticReason?: string;
  diagnosticUnlockPath?: string;
  current?: number | null;
  baseline?: number;
  delta?: number;
  deltaPct?: number;
  displayValue?: string; // Preserve formatted display value
  displayDeltaPct?: string; // Preserve formatted delta percentage
  confidence?: string;
  hasData?: boolean;
  executiveSummary?: string;
  evidence?: Evidence[];
  whatChanged?: string;
  whyItMatters?: string;
  evidenceAndContext?: string;
  operationalImpact?: string;
  primaryRisk?: string;
  cohort?: string;
  confidenceReasoning?: string;
  // CR-X FINAL: orthogonal provenance and scope labels for the UI.
  // Provenance = evidence source(s).  Scope = population the finding describes.
  provenanceLabel?: string;
  scopeLabel?: string;
  // CR-X FINAL: structured allocation fields so the renderer never has to
  // reverse-engineer repository identity from display copy.
  dominantRepo?: string;
  allocationSynthesis?: boolean;
  // Engine provenance fields (for automated verification)
  engineVersion?: 'FINAL_ENGINE_V1' | 'LEGACY_V2';
  generatorSource?: string;
  featureFlagState?: boolean;
  // Recommendation lifecycle fields (preserved from canonical insight)
  recommendationState?: 'action_required' | 'monitor_only' | 'investigate' | string;
  urgencyLabel?: string;
  operationalSignificance?: 'significant' | 'not_significant' | 'unknown';
  // CR-X: Lifecycle class preserved from generator through adapter
  lifecycleClass?: 'decision' | 'contextual' | 'diagnostic' | 'suppress';
  // P0.2 R3: Structured TTFC + commit fields for commit-ttfc-longitudinal
  // semantic-authority rendering. Consumed by PerformanceRecommendationsView
  // to render TTFC in minutes and commits/session without generic AI-active-share semantics.
  firstTtfcMinutes?: number;
  lastTtfcMinutes?: number;
  ttfcDeltaMinutes?: number;
  firstCommitsPerSession?: number;
  lastCommitsPerSession?: number;
  commitsDeltaValue?: number;
  observedPeriodCount?: number;
  // Structured period-count fields for monthly-workflow-share so the renderer
  // can distinguish complete comparison periods from an in-progress partial
  // month that is shown for context only and never counted in the conclusion.
  completePeriodCount?: number;
  hasPartialCurrentPeriod?: boolean;
  // Structured comparison authority — single source of truth for ranking
  comparisonAuthority?: {
    rows: Array<{
      workflowId: string;
      displayName: string;
      value: number;
      formattedValue: string;
      sampleSize: number;
      eligibleForRanking: boolean;
      rank: number;
    }>;
    leader: { workflowId: string; displayName: string; value: number; formattedValue: string; sampleSize: number } | null;
    runnerUp: { workflowId: string; displayName: string; value: number; formattedValue: string; sampleSize: number } | null;
    laggard: { workflowId: string; displayName: string; value: number; formattedValue: string; sampleSize: number } | null;
    minSampleSize: number;
    polarity: 'higher_is_better' | 'lower_is_better' | 'neutral';
    operationallySignificant: boolean;
    significanceReason: string;
  };
  // CR-X UI Polish: Period Strip — compact chronological primitive.
  // Mutually exclusive with comparisonRows in the decision card.
  periodStrip?: {
    label?: string;
    points: Array<{
      periodLabel: string;
      value: string;
      numericValue: number;
      magnitude: number;
      delta?: string;
      deltaDirection?: 'up' | 'down' | 'flat' | null;
    }>;
  };
}

/**
 * Stage mapping from canonical to UI
 * 
 * Maps CanonicalStage to the string format expected by the UI.
 */
const STAGE_MAPPING: Record<CanonicalStage, string> = {
  'plan-code': 'plan-code',
  'review-merge': 'review-merge',
  'deploy-operate': 'deploy-operate'
};

/**
 * Adapt a canonical insight to the PerformanceInsight UI contract
 * 
 * @param canonical - Canonical insight to adapt
 * @returns Performance insight in UI contract shape
 */
export function adaptCanonicalToUI(canonical: CanonicalInsight): PerformanceInsight {
  // PRESERVE: Generator title before any processing
  // Generator titles are specific and data-driven, should be preferred over static registry titles
  const generatorTitle = canonical.title;
  
  // SAFEGUARD DISABLED: Generator titles are evidence-first and metric-native
  // The safeguard was overwriting generator titles with static registry titles
  // Generator titles are the source of truth for runtime display
  // const safeguardedInsight = safeguardCanonicalTitle(canonical);
  const safeguardedInsight = canonical;
  
  // SANITIZE: Prevent badState payloads with safe fallbacks
  const sanitizedInsight = sanitizeInsight(safeguardedInsight);

  // COMPUTE: Comparison state for data truth validation
  const comparisonState = computeComparisonState(sanitizedInsight);

  // TITLE AUTHORITY: Diagnostic insights use the generator's canonical title as-is.
  // Do not run comparison-state title generation or directional sanitization on diagnostics.
  const isDiagnosticFromGenerator = sanitizedInsight.isDiagnostic === true ||
    (sanitizedInsight as any).diagnosticReason !== undefined ||
    sanitizedInsight.presentationType === 'diagnostic';

  // CR5 P0.9: Temporal trend, org_summary, and cohort_comparison PIs preserve
  // the generator title. These presentationKinds have their own title authority
  // and must NOT be reinterpreted by comparison-state title generation.
  const presentationKind = (sanitizedInsight as any).presentationKind;
  const isTemporalTrend = presentationKind === 'temporal_trend';
  const isOrgSummary = presentationKind === 'org_summary';
  const isCohortComparison = presentationKind === 'cohort_comparison';
  const isUnitEconomics = presentationKind === 'unit_economics';

  let finalTitle: string;
  if (isDiagnosticFromGenerator || isTemporalTrend || isOrgSummary || isCohortComparison || isUnitEconomics) {
    finalTitle = generatorTitle;
  } else {
    // GENERATE: Truthful title based on comparison state
    const truthfulTitle = generateTitleFromComparisonState(
      sanitizedInsight,
      generatorTitle,
      sanitizedInsight.title
    );
    // SANITIZE: Defensive title sanitization to prevent directional titles on non-comparable insights
    finalTitle = sanitizeDirectionalTitle(truthfulTitle, comparisonState, sanitizedInsight);
  }

  // Preserve structured ToolBreakdown for UI - do not flatten to strings
  // This preserves count, formatted, label, source metadata for proper comparison display
  let breakdownByTool: ToolBreakdown | undefined;
  if (sanitizedInsight.breakdownByTool) {
    // Validate and preserve the structured breakdown data
    breakdownByTool = {};
    for (const [tool, data] of Object.entries(sanitizedInsight.breakdownByTool)) {
      if (data && typeof data === 'object' && 'value' in data) {
        // Preserve full structured object
        breakdownByTool[tool] = {
          value: data.value,
          count: data.count,
          formatted: data.formatted,
          label: data.label,
          baseline: data.baseline,
          delta: data.delta,
          source: data.source
        };
      } else if (data !== null && typeof data === 'number') {
        // Backwards compatibility: if it's just a number, wrap it
        breakdownByTool[tool] = { value: data, count: 1 };
      }
    }
  }
  
  // CONSTRUCT breakdownByTool for AI vs Non-AI insights from canonical data
  if (sanitizedInsight.comparisonMode === 'ai_vs_non_ai' && !breakdownByTool) {
    const aiValue = sanitizedInsight.current;
    const nonAiValue = sanitizedInsight.baseline;
    const delta = sanitizedInsight.delta;
    
    // Extract session counts from operationalBreadcrumbs if available
    let aiCount = 0;
    let nonAiCount = 0;
    if (sanitizedInsight.operationalBreadcrumbs && Array.isArray(sanitizedInsight.operationalBreadcrumbs)) {
      for (const crumb of sanitizedInsight.operationalBreadcrumbs) {
        if (typeof crumb === 'string') {
          const aiMatch = crumb.match(/AI-assisted:\s*(\d+)\s+sessions/);
          const nonAiMatch = crumb.match(/Non-AI-assisted:\s*(\d+)\s+sessions/);
          if (aiMatch) aiCount = parseInt(aiMatch[1], 10);
          if (nonAiMatch) nonAiCount = parseInt(nonAiMatch[1], 10);
        }
      }
    }
    
    // Only construct if we have valid values
    if (aiValue !== undefined && aiValue !== null && !isNaN(aiValue)) {
      breakdownByTool = {
        ai: {
          value: aiValue,
          count: aiCount,
          formatted: typeof aiValue === 'number' ? aiValue.toFixed(1) : String(aiValue),
          label: 'Observed AI signals',
          baseline: nonAiValue,
          delta: delta,
          source: 'telemetry'
        }
      };
      
      // 🔥 P0-D FIX: Only include non_ai when there's actual data
      // This prevents cards titled "Non-AI data unavailable" from showing Non-AI values
      if (nonAiValue !== undefined && nonAiValue !== null && !isNaN(nonAiValue) && nonAiCount > 0) {
        breakdownByTool.non_ai = {
          value: nonAiValue,
          count: nonAiCount,
          formatted: nonAiValue.toFixed(1),
          label: 'Zero observed AI signals',
          baseline: undefined,
          delta: undefined,
          source: 'telemetry'
        };
      }
    }
  }

  // ENFORCE CANONICAL TITLE AUTHORITY
  // Validate title authority (development safeguard)
  validateCanonicalTitle(sanitizedInsight.id, sanitizedInsight.title);

  // COMPUTE: UI contract fields from canonical data
  // Use string comparison to handle diagnostic states that may not be in ComparisonState type
  const comparisonStateStr = String(comparisonState);
  
  // RUNTIME DIAGNOSTIC RULES:
  // A card is diagnostic only if one of these is true:
  // 1. insight.isDiagnostic === true (explicit runtime diagnostic flag)
  // 2. diagnosticReason is present on the actual emitted insight
  // 3. hasData === false
  // 4. comparisonState is needs_more_data/instrumentation_gap/emerging_sample AND insight lacks real evidence/comparison data
  // 
  // Do NOT classify as diagnostic solely because:
  // - canonical registry entry has isDiagnostic flag (static metadata)
  // - title contains "needs attribution" in registry but generator emitted real runtime insight
  // - PI was historically considered blocked
  // DIAGNOSTIC TITLE SAFETY GATE:
  // A title containing diagnostic states must not be actionable.
  // This is a safety gate, not the complete semantic-content repair.
  const DIAGNOSTIC_TITLE_KEYWORDS = [
    'needs more data',
    'needs more workflow',
    'needs more sample',
    'needs broader',
    'needs attribution',
    'needs complete attribution',
    'needs validation',
    'not captured',
    'not yet measurable',
    'data unavailable',
    'instrumentation gap',
    'insufficient data',
    'insufficient sample',
    'waiting for',
    'emerging sample'
  ];
  const titleLower = (sanitizedInsight.title || '').toLowerCase();
  const hasDiagnosticTitle = DIAGNOSTIC_TITLE_KEYWORDS.some(kw => titleLower.includes(kw));

  // STRUCTURED CLASSIFICATION: lifecycle state is determined by structured fields,
  // not title-word detection. A card is diagnostic when any of these structural
  // conditions hold:
  // 1. insight.isDiagnostic === true (explicit runtime diagnostic flag)
  // 2. diagnosticReason is present
  // 3. hasData === false
  // 4. comparisonState is needs_more_data / instrumentation_gap / emerging_sample
  //    BUT ONLY when hasData is false OR the insight lacks real evidence.
  //    CR-X QUALITY FIX: A card with hasData=true and real evidence is a FINDING
  //    with an attribution/scope caveat, NOT a diagnostic. Classifying it as
  //    diagnostic hides useful observed data behind "needs more data" messaging.
  // 5. title contains diagnostic keywords (safety gate for generator-emitted diagnostic titles)
  // CR-X P0A: hasRealEvidence must not require the optional evidence[] array.
  // Many generators set hasData: true and current: <number> but use
  // description/recommendation/whatChanged instead of evidence[].
  // The semantic requirement for "real evidence" is: hasData is true AND
  // current has a measured value. The evidence[] array is a display
  // convenience, not a semantic requirement.
  const hasRealEvidence = sanitizedInsight.hasData === true &&
    (sanitizedInsight.current !== null && sanitizedInsight.current !== undefined);
  const isDiagnostic =
    (sanitizedInsight.isDiagnostic === true) ||
    ((sanitizedInsight as any).diagnosticReason !== undefined && !hasRealEvidence) ||
    (sanitizedInsight.hasData === false) ||
    ((comparisonStateStr === 'needs_more_data' ||
      comparisonStateStr === 'instrumentation_gap' ||
      comparisonStateStr === 'emerging_sample') && !hasRealEvidence) ||
    (hasDiagnosticTitle);

  const recommendationStateFromGenerator = (sanitizedInsight as any).recommendationState as string | undefined;
  const isMonitorOnly = recommendationStateFromGenerator === 'monitor_only';

  const diagnosticReason = isDiagnostic
    ? (sanitizedInsight as any).diagnosticReason
      || (comparisonStateStr === 'needs_more_data'
        ? 'Required evidence not available'
        : comparisonStateStr === 'instrumentation_gap'
          ? 'Required data fields not available'
          : comparisonStateStr === 'emerging_sample'
            ? 'Emerging sample - not enough data for reliable comparison'
            : 'Insufficient data for insight generation')
    : undefined;

  // COMPUTE: Polarity from metric ID or comparison mode
  // Lower-is-better metrics: context-switching/idle, time_to_first_commit, rework_rate, 
  // PR cycle time, CFR, reopen pressure, reviewer load concentration
  const lowerIsBetterMetrics = [
    'idle-ratio',
    'context-switching',
    'time-to-first-commit',
    'rework-rate',
    'pr-cycle-time',
    'change-failure-rate',
    'reopen-pressure',
    'reviewer-load-concentration'
  ];
  const polarity: 'higher_is_better' | 'lower_is_better' | 'neutral' =
    sanitizedInsight.polarity === 'neutral'
      ? 'neutral'
      : sanitizedInsight.polarity === 'lower_is_better' || sanitizedInsight.polarity === 'higher_is_better'
        ? sanitizedInsight.polarity
        : lowerIsBetterMetrics.some(id => sanitizedInsight.id.includes(id))
          ? 'lower_is_better'
          : 'higher_is_better';

  // BUILD: Structured comparison authority from breakdownByTool
  // This is the single source of truth for ranking — the view must consume
  // this object instead of independently sorting breakdownByTool.
  const MIN_SAMPLE_SIZE = 25;
  let comparisonAuthority: PerformanceInsight['comparisonAuthority'] = undefined;
  // CR4 P0-3: Skip comparison authority for org-level metrics.
  // Org-level metrics (e.g. repository-concentration) have breakdownByTool
  // populated with repository data, NOT workflow data. Building a
  // leader/runner-up from this would manufacture false workflow rankings.
  const isOrgLevelMetric = (sanitizedInsight as any).isOrgLevelMetric === true ||
    comparisonStateStr === 'org_level_only';
  if (breakdownByTool && !isDiagnostic && sanitizedInsight.hasData && !isOrgLevelMetric) {
    const toolEntries = Object.entries(breakdownByTool)
      .filter(([_, data]) => data && typeof data.value === 'number' && !isNaN(data.value))
      .map(([toolId, data]) => ({
        workflowId: toolId,
        // CR-X: Strip internal metric suffixes (e.g. _top3, _repos) before
        // computing the display name so customer-facing copy never leaks
        // internal breakdownByTool keys.
        displayName: getCanonicalWorkflowIdentity(toolId.replace(/_(top3|repos|top_3)$/i, '')),
        value: (data as any).value,
        formattedValue: (data as any).formatted || String((data as any).value),
        sampleSize: (data as any).count || 0,
        eligibleForRanking: ((data as any).count || 0) >= MIN_SAMPLE_SIZE,
        rank: 0
      }));

    if (toolEntries.length >= 2) {
      // CONSUME selectedComparison: when the generator provides an explicit
      // leader/baseline pair, use those keys for leader and runnerUp.
      // Low-sample rows are ordered after eligible primary rows.
      const selectedComp = (sanitizedInsight as any).selectedComparison as
        { leaderKey: string; baselineKey: string } | undefined;

      // Sort: eligible rows first (by value respecting polarity), then
      // ineligible rows after (by value respecting polarity).
      const sortByValue = (a: typeof toolEntries[0], b: typeof toolEntries[0]) =>
        polarity === 'lower_is_better' ? a.value - b.value : b.value - a.value;

      const eligible = toolEntries.filter(e => e.eligibleForRanking).sort(sortByValue);
      const ineligible = toolEntries.filter(e => !e.eligibleForRanking).sort(sortByValue);
      const sorted = [...eligible, ...ineligible];

      // Assign ranks
      sorted.forEach((entry, idx) => { entry.rank = idx + 1; });

      // Determine leader and runnerUp/baseline
      let leader: PerformanceInsight['comparisonAuthority'] extends { leader: infer L } ? L : any = null;
      let runnerUp: PerformanceInsight['comparisonAuthority'] extends { runnerUp: infer R } ? R : any = null;

      if (selectedComp) {
        // Use generator-selected pair — must be from eligible rows
        const leaderEntry = sorted.find(e => e.workflowId === selectedComp.leaderKey);
        const baselineEntry = sorted.find(e => e.workflowId === selectedComp.baselineKey);
        if (leaderEntry) {
          leader = { workflowId: leaderEntry.workflowId, displayName: leaderEntry.displayName, value: leaderEntry.value, formattedValue: leaderEntry.formattedValue, sampleSize: leaderEntry.sampleSize };
        }
        if (baselineEntry) {
          runnerUp = { workflowId: baselineEntry.workflowId, displayName: baselineEntry.displayName, value: baselineEntry.value, formattedValue: baselineEntry.formattedValue, sampleSize: baselineEntry.sampleSize };
        }
      }

      // Fallback: if selectedComparison not present or keys not found, use
      // the prior logic (eligible sorted by value).
      if (!leader && eligible.length >= 1) {
        leader = eligible[0] ? { workflowId: eligible[0].workflowId, displayName: eligible[0].displayName, value: eligible[0].value, formattedValue: eligible[0].formattedValue, sampleSize: eligible[0].sampleSize } : null;
      }
      if (!runnerUp && eligible.length >= 2) {
        runnerUp = eligible[1] ? { workflowId: eligible[1].workflowId, displayName: eligible[1].displayName, value: eligible[1].value, formattedValue: eligible[1].formattedValue, sampleSize: eligible[1].sampleSize } : null;
      }

      const laggard = sorted[sorted.length - 1] ? { workflowId: sorted[sorted.length - 1].workflowId, displayName: sorted[sorted.length - 1].displayName, value: sorted[sorted.length - 1].value, formattedValue: sorted[sorted.length - 1].formattedValue, sampleSize: sorted[sorted.length - 1].sampleSize } : null;

      const gap = leader && runnerUp ? Math.abs(leader.value - runnerUp.value) : 0;
      const isRateMetric = sanitizedInsight.id.includes('adoption') || sanitizedInsight.id.includes('rework') || sanitizedInsight.id.includes('quality');
      // CR5 P0-3: Unit-aware significance threshold.
      // The measured gap is the AUTHORITY for operational significance.
      // recommendationState='monitor_only' is a generator hint about actionability,
      // NOT a significance override. A 51.8-min gap on an 83-min leader IS significant.
      const leaderValueAbs = leader ? Math.abs(leader.value) : 0;
      const narrowGapThreshold = isRateMetric
        ? 5
        : Math.max(0.1, leaderValueAbs * 0.1);
      const operationallySignificant = gap >= narrowGapThreshold;
      const significanceReason = operationallySignificant
        ? `Gap of ${isRateMetric ? gap.toFixed(1) + 'pp' : gap.toFixed(2)} exceeds ${isRateMetric ? '5pp' : narrowGapThreshold.toFixed(2)} threshold`
        : `Gap of ${isRateMetric ? gap.toFixed(1) + 'pp' : gap.toFixed(2)} is within noise range (threshold: ${isRateMetric ? '5pp' : narrowGapThreshold.toFixed(2)})`;

      // CR4 P0-1: Diagnostic logging for comparison-state tracing
      piDebugLog('[COMPARISON_AUTHORITY]', {
        id: sanitizedInsight.id,
        leader: leader ? { name: leader.displayName, value: leader.value, sampleSize: leader.sampleSize } : null,
        runnerUp: runnerUp ? { name: runnerUp.displayName, value: runnerUp.value, sampleSize: runnerUp.sampleSize } : null,
        gap,
        isRateMetric,
        narrowGapThreshold,
        isMonitorOnly,
        recommendationState: recommendationStateFromGenerator,
        operationallySignificant,
        significanceReason,
        eligibleRows: sorted.filter(e => e.eligibleForRanking).length,
        totalRows: sorted.length
      });

      comparisonAuthority = {
        rows: sorted,
        leader,
        runnerUp,
        laggard,
        minSampleSize: MIN_SAMPLE_SIZE,
        polarity,
        operationallySignificant,
        significanceReason
      };
    }
  }

  // PURE LIFECYCLE RESOLUTION: delegate to resolveInsightLifecycle for all flags
  const lifecycleGap = comparisonAuthority?.leader && comparisonAuthority?.runnerUp
    ? Math.abs(comparisonAuthority.leader.value - comparisonAuthority.runnerUp.value)
    : undefined;
  const isRateMetric = sanitizedInsight.id.includes('adoption') || sanitizedInsight.id.includes('rework') || sanitizedInsight.id.includes('quality');
  // CR4 P0-1: Use same unit-aware threshold as comparisonAuthority
  const leaderAbsForThreshold = comparisonAuthority?.leader ? Math.abs(comparisonAuthority.leader.value) : 0;
  const significanceThreshold = isRateMetric
    ? 5
    : Math.max(0.1, leaderAbsForThreshold * 0.1);

  // CR5 P0-3: operationalSignificance is derived from the measured gap,
  // NOT from recommendationState. The generator's recommendationState is
  // about actionability, not about whether the observed difference is real.
  const operationalSignificance: 'significant' | 'not_significant' | 'unknown' =
    comparisonAuthority
      ? (comparisonAuthority.operationallySignificant ? 'significant' : 'not_significant')
      : recommendationStateFromGenerator === 'action_required' ? 'significant' : 'unknown';

  const lifecycle = resolveInsightLifecycle({
    isDiagnostic,
    recommendationState: recommendationStateFromGenerator,
    operationalSignificance,
    comparisonState: comparisonStateStr,
    gap: lifecycleGap,
    significanceThreshold,
    hasData: sanitizedInsight.hasData,
  });

  const recommendationAllowed = lifecycle.recommendationAllowed;
  const isTopInsightEligible = lifecycle.isTopInsightEligible;

  // CR-X FINAL: Compute orthogonal provenance and scope labels at the
  // canonical→UI boundary.  Generators must not call these helpers.
  const provenanceLabel = computeProvenanceLabel(sanitizedInsight);
  const scopeLabel = computeScopeLabel(sanitizedInsight);

  return {
    id: sanitizedInsight.id,
    semanticFamily: (sanitizedInsight as any).semanticFamily,
    title: finalTitle, // Use defensively sanitized title
    cicdStage: STAGE_MAPPING[sanitizedInsight.cicdStage as CanonicalStage],
    
    // Core metrics — null for diagnostic cards with no data (never a false zero)
    current: isDiagnostic && sanitizedInsight.hasData === false ? null : sanitizedInsight.current,
    baseline: sanitizedInsight.baseline,
    delta: sanitizedInsight.delta,
    deltaPct: sanitizedInsight.deltaPct,
    displayValue: sanitizedInsight.displayValue, // Preserve formatted display value
    displayDeltaPct: sanitizedInsight.displayDeltaPct, // Preserve formatted delta
    displayUnit: (sanitizedInsight as any).displayUnit, // CR-X Track C/D: preserve unit for truthful formatting
    rightMetric: sanitizedInsight.rightMetric,
    rightMetricLabel: sanitizedInsight.rightMetricLabel,
    
    // Data quality
    confidence: sanitizedInsight.confidence,
    coveragePct: sanitizedInsight.coveragePct,
    n: sanitizedInsight.n,
    hasData: sanitizedInsight.hasData,
    
    // Content
    details: sanitizedInsight.description, // Map description to details field for UI compatibility
    recommendation: sanitizedInsight.recommendation,
    executiveSummary: sanitizedInsight.executiveSummary,
    evidence: sanitizedInsight.evidence,
    
    // Tool breakdown (converted for UI compatibility)
    breakdownByTool,

    // CR-X PI: Carry the generator's selectedComparison (leader/baseline pair)
    // through the adapter boundary. The cost-efficiency renderer reads this to
    // compute the Difference cell from the headline pair (leader vs baseline),
    // NOT the top-2-by-value rows. Without this pass-through the renderer falls
    // back to evidence[0..1] (top-2 by value), which mismatches the headline pair
    // when 3+ workflows qualify (e.g. Cursor vs Devin headline but top-2 = Cursor
    // vs VS Code).
    selectedComparison: (sanitizedInsight as any).selectedComparison,
    
    // Demo flags
    demoFlag: sanitizedInsight.demoFlag,
    
    // Additional fields expected by UI
    insufficientSignal: !sanitizedInsight.hasData,
    presentationType: sanitizedInsight.presentationType,
    // CR5 P0.8: Carry presentationKind unchanged through the adapter
    presentationKind: (sanitizedInsight as any).presentationKind ||
      (sanitizedInsight.isDiagnostic ? 'diagnostic' :
       (sanitizedInsight as any).isOrgLevelMetric ? 'org_summary' : undefined),
    comparisonMode: sanitizedInsight.comparisonMode,
    comparisonState: comparisonState, // Data truth validation state
    
    // NEW: UI contract fields for renderer obedience
    polarity,
    isDiagnostic,
    isOrgLevelMetric,
    // CR-X Track A: Population scope from canonical insight.
    // Defaults to 'org_level' for backward compatibility.
    // When analysis context is active, PI engine sets 'scoped' and
    // populationContextLabel describes the scoped population.
    populationScope: (sanitizedInsight as any).populationScope || 'org_level' as const,
    populationContextLabel: (sanitizedInsight as any).populationContextLabel as string | undefined,
    // CR-X P0-3: Pass concentrationLevel through for renderer branching
    concentrationLevel: (sanitizedInsight as any).concentrationLevel,
    recommendationAllowed,
    isTopInsightEligible,
    topInsightRank: sanitizedInsight.canonicalPriority,
    diagnosticReason,
    diagnosticUnlockPath: (sanitizedInsight as any).diagnosticUnlockPath,
    
    // Engine provenance fields
    engineVersion: sanitizedInsight.engineVersion,
    generatorSource: sanitizedInsight.generatorSource,
    featureFlagState: sanitizedInsight.featureFlagState,
    
    // Recommendation lifecycle fields (preserved from canonical insight)
    recommendationState: recommendationStateFromGenerator,
    urgencyLabel: (sanitizedInsight as any).urgencyLabel as string | undefined,
    operationalSignificance,

    // Structured comparison authority — single source of truth for ranking
    comparisonAuthority,

    // Enhanced narrative fields
    whatChanged: sanitizedInsight.whatChanged,
    whyItMatters: sanitizedInsight.whyItMatters,
    evidenceAndContext: sanitizedInsight.evidenceAndContext,
    operationalImpact: sanitizedInsight.operationalImpact,
    primaryRisk: sanitizedInsight.primaryRisk,
    cohort: sanitizedInsight.cohort,
    confidenceReasoning: sanitizedInsight.confidenceReasoning,

    // CR-X FINAL: orthogonal provenance and scope labels computed at the
    // canonical→UI boundary.  Provenance = evidence source(s). Scope = population.
    provenanceLabel,
    scopeLabel,
    // CR-X FINAL: structured allocation metadata so the renderer never has to
    // parse repository identity or synthesis state from display copy.
    dominantRepo: (sanitizedInsight as any).dominantRepo,
    allocationSynthesis: (sanitizedInsight as any).allocationSynthesis,

    // CR5 FINAL DOWNSTREAM: Carry source/provenance fields through the adapter
    // so the view model can render truthful source labels for GitHub-only evidence.
    dataDomain: (sanitizedInsight as any).dataDomain,
    // CR-X 3D.2B: Normalize source label at the presentation boundary.
    // Internal provenance (data_source, seed_batch) remains intact in the data layer;
    // only the customer-facing label is normalized to neutral semantic copy.
    sourceLabel: normalizeSourceLabel((sanitizedInsight as any).sourceLabel),
    // CR-X 3D.2B: Normalize operational breadcrumbs at the presentation boundary.
    operationalBreadcrumbs: normalizeBreadcrumbs((sanitizedInsight as any).operationalBreadcrumbs),
    // CR-X Track C/D: Carry sampleUnit through the adapter so the view model
    // can render truthful sample labels (e.g., "18 merged PRs" not "18 sessions").
    sampleUnit: (sanitizedInsight as any).sampleUnit,

    // CR-X: Carry lifecycleClass through the adapter so ranking and display
    // use the generator's authoritative classification, not a reclassification
    // that may disagree (e.g. ai-adoption-rate-by-ide is contextual per generator
    // but would be reclassified as decision due to action_required urgency).
    lifecycleClass: (sanitizedInsight as any).lifecycleClass,

    // CR-X Wave 1B: Metric presentation contract for recent-change and
    // multi-dimensional families. The renderer uses these fields to format
    // values and labels correctly instead of guessing units.
    metricKind: (sanitizedInsight as any).metricKind,
    valueType: (sanitizedInsight as any).valueType,
    unit: (sanitizedInsight as any).unit,
    priorValue: (sanitizedInsight as any).priorValue,
    recentValue: (sanitizedInsight as any).recentValue,
    priorDisplay: (sanitizedInsight as any).priorDisplay,
    recentDisplay: (sanitizedInsight as any).recentDisplay,
    absoluteDelta: (sanitizedInsight as any).absoluteDelta,
    priorSample: (sanitizedInsight as any).priorSample,
    recentSample: (sanitizedInsight as any).recentSample,
    priorWindow: (sanitizedInsight as any).priorWindow,
    recentWindow: (sanitizedInsight as any).recentWindow,
    observedThroughMs: (sanitizedInsight as any).observedThroughMs,

    // CR-X Wave 1B: Allocation subtype for workflow-repo allocation renderer
    // branching. Without this, the renderer cannot distinguish same-dominant-repo
    // from different-dominant-repo findings and produces semantic inversion.
    allocationSubtype: (sanitizedInsight as any).allocationSubtype,
    // PILOT OPS 14-D: Carry allocationShiftSynthesis through the adapter
    // boundary. Without this, the synthesized organizational allocation-shift
    // finding loses its flag and falls through to the pairwise renderer,
    // which maps evidence[2] (comparison window in the synthesized evidence
    // array) to the "Max shift" cell — showing the window label instead of
    // the shift magnitude.
    allocationShiftSynthesis: (sanitizedInsight as any).allocationShiftSynthesis,
    synthesizedWorkflows: (sanitizedInsight as any).synthesizedWorkflows,
    // CR-X P3: Temporal quality classification for allocation-shift findings.
    // The renderer uses this to apply cautious language for low-sample findings.
    temporalQuality: (sanitizedInsight as any).temporalQuality,

    // P0.2 R3: Carry structured TTFC + commit fields through the adapter for
    // commit-ttfc-longitudinal semantic-authority rendering. Without this,
    // the renderer sees undefined and shows "—" for all evidence cells.
    firstTtfcMinutes: (sanitizedInsight as any).firstTtfcMinutes,
    lastTtfcMinutes: (sanitizedInsight as any).lastTtfcMinutes,
    ttfcDeltaMinutes: (sanitizedInsight as any).ttfcDeltaMinutes,
    firstCommitsPerSession: (sanitizedInsight as any).firstCommitsPerSession,
    lastCommitsPerSession: (sanitizedInsight as any).lastCommitsPerSession,
    commitsDeltaValue: (sanitizedInsight as any).commitsDeltaValue,
    observedPeriodCount: (sanitizedInsight as any).observedPeriodCount,
    completePeriodCount: (sanitizedInsight as any).completePeriodCount,
    hasPartialCurrentPeriod: (sanitizedInsight as any).hasPartialCurrentPeriod,

    // Unit Economics V1: structured fields for the UE renderer.
    // These are consumed by the unit_economics presentation branch
    // to render configured spend, outcome count, period, and caveats
    // without parsing title strings.
    ...(isUnitEconomics ? {
      unitEconomics: {
        allocationPeriod: (sanitizedInsight as any).executiveSummary?.split(' · ')[1] || undefined,
        configuredSpend: (sanitizedInsight as any).evidence?.[0]?.value,
        outcomeCount: sanitizedInsight.n,
        outcomeUnit: (sanitizedInsight as any).rightMetricLabel?.replace('Configured spend / ', ''),
        allocationScope: 'Organization-level period allocation',
        sourceLabel: (sanitizedInsight as any).evidence?.[1]?.label?.split(' · ')[0],
        estimateDisclosure: 'Configured estimate · Not billing data · Period-level allocation · Not per-outcome causal attribution',
        outcomeComposition: (sanitizedInsight as any).outcomeComposition || undefined,
      },
    } : {}),

    // CR-X UI Polish: Period Strip — compact chronological primitive.
    // Passed through from generator to view for unit-economics and
    // org-level delivery-outcome cards where multi-month evidence exists.
    // Mutually exclusive with comparisonRows in the decision card.
    periodStrip: (sanitizedInsight as any).periodStrip || undefined,
  };
}

/**
 * Adapt multiple canonical insights to UI contract
 * 
 * @param canonicalInsights - Array of canonical insights to adapt
 * @returns Array of performance insights in UI contract shape
 */
export function adaptCanonicalInsightsToUI(canonicalInsights: CanonicalInsight[]): PerformanceInsight[] {
  return canonicalInsights.map(adaptCanonicalToUI);
}

/**
 * Validate that adapted insights conform to UI contract
 * 
 * @param insights - Array of adapted performance insights
 * @returns Object with validation results
 */
export function validateAdaptedInsights(insights: PerformanceInsight[]): {
  valid: boolean;
  missingFields: Array<{ id: string; missing: string[] }>;
  errors: string[];
} {
  const requiredFields = [
    'id',
    'title',
    'cicdStage'
  ];

  const missingFields: Array<{ id: string; missing: string[] }> = [];
  const errors: string[] = [];

  for (const insight of insights) {
    const missing: string[] = [];
    
    for (const field of requiredFields) {
      if (insight[field as keyof PerformanceInsight] === undefined) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      missingFields.push({ id: insight.id, missing });
      errors.push(
        `Insight ${insight.id} is missing required fields: ${missing.join(', ')}`
      );
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
    errors
  };
}
