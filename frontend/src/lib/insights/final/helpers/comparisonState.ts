/**
 * Comparison State Computation Helper
 * 
 * This module computes the comparison state for canonical insights based on data availability.
 * The comparison state indicates whether the insight's data supports the rendered comparison language.
 * 
 * COMPARISON STATES:
 * - workflow_comparable: Can compare IDEs/workflows with measured values (≥2 workflows with sufficient data)
 * - ai_non_ai_comparable: Can compare AI vs Non-AI cohorts with measured values
 * - org_level_only: No IDE attribution, org-level metric only
 * - needs_more_data: Insufficient data for any comparison
 * - instrumentation_gap: Missing required fields for comparison
 * - emerging_sample: Low sample size, cannot claim leader/winner
 */

import type { CanonicalInsight, ComparisonState } from '../types';

/**
 * Minimum sample thresholds for comparison states
 */
export const MIN_SAMPLES_FOR_COMPARISON = 10;
export const MIN_SAMPLES_FOR_HIGH_CONFIDENCE = 30;
const MIN_WORKFLOWS_FOR_COMPARISON = 2;

/**
 * Compute comparison state based on insight data
 * 
 * @param insight - Canonical insight with data
 * @returns Comparison state indicating data truth
 */
export function computeComparisonState(insight: CanonicalInsight): ComparisonState {
  const { breakdownByTool, comparisonMode, n, hasData, cicdStage } = insight;

  // Check if insight has any data at all
  if (!hasData || n === 0) {
    return 'needs_more_data';
  }

  // CR5 FINAL DOWNSTREAM: Respect the generator's explicit comparisonState
  // for downstream_comparison PIs. These are org-level GitHub findings
  // (PR-size/merge-cycle, deployment reliability) with their own evidence
  // shapes that should NOT be reclassified as emerging_sample by the
  // workflow-oriented sample thresholds below.
  const presentationKind = (insight as any).presentationKind;
  const explicitComparisonState = (insight as any).comparisonState;
  if (presentationKind === 'downstream_comparison' && explicitComparisonState === 'org_level_only') {
    return 'org_level_only';
  }

  // CR-X 2A.1: Respect explicit org_level_only for org_summary PIs.
  // Contextual PIs like pilot-maturity-progression use presentationKind='org_summary'
  // with comparisonState='org_level_only'. They are NOT workflow comparisons and
  // should NOT be reclassified as needs_more_data/emerging_sample by the
  // workflow-oriented sample thresholds below.
  if (presentationKind === 'org_summary' && explicitComparisonState === 'org_level_only') {
    return 'org_level_only';
  }

  // CR-X Track F: Respect explicit org_level_only for cohort_comparison PIs.
  // Claude Code runtime cohort uses presentationKind='cohort_comparison' with
  // comparisonState='org_level_only'. It is an observational cohort summary,
  // NOT a workflow comparison. Without this guard it falls through to the
  // instrumentation_gap fallback (no breakdownByTool), which causes the render
  // adapter to misclassify a populated 67-session cohort as a diagnostic
  // "Not yet measurable / Data not available" card.
  if (presentationKind === 'cohort_comparison' && explicitComparisonState === 'org_level_only') {
    return 'org_level_only';
  }

  // CR-X Track C/D: Respect explicit org_level_only for outcome_threshold and
  // success_failure_distribution PIs. These are org-level delivery outcomes
  // (merge cycle time, merge rate, PR throughput, review burden, deployment
  // success distribution) with comparisonMode='threshold_vs_actual' but NO
  // breakdownByTool — they are org-level metrics, NOT workflow comparisons.
  // Without this guard, the threshold_vs_actual check below returns
  // instrumentation_gap (no breakdownByTool), which causes the render adapter
  // to misclassify measured org-level evidence as a diagnostic
  // "Not yet measurable / Data not available" card.
  //
  // A delivery outcome can be MEASURED at org/repo/period level without being
  // attributable to a specific IDE/workflow/session. That does NOT make the
  // outcome "not measurable."
  if (
    (presentationKind === 'outcome_threshold' || presentationKind === 'success_failure_distribution') &&
    explicitComparisonState === 'org_level_only'
  ) {
    return 'org_level_only';
  }

  // CR-X Product-Strength Wave: Executive synthesis and multi-dimensional
  // families use their own evidence structures, not breakdownByTool. They
  // must NOT be classified as instrumentation_gap merely because they lack
  // breakdownByTool. Respect the generator's explicit comparisonState.
  if (
    presentationKind === 'executive_synthesis' ||
    presentationKind === 'repo_conditioned_behavior' ||
    presentationKind === 'workflow_repo_allocation' ||
    presentationKind === 'within_workflow_temporal' ||
    presentationKind === 'workflow_repo_allocation_shift'
  ) {
    return explicitComparisonState || 'workflow_comparable';
  }

  // Check for instrumentation gap (missing breakdown when expected)
  if (comparisonMode === 'threshold_vs_actual' || comparisonMode === 'trend') {
    // These modes should have breakdownByTool for workflow comparison
    if (!breakdownByTool || Object.keys(breakdownByTool).length === 0) {
      // Org-level delivery stages (review-merge, deploy-operate) legitimately
      // measure evidence without workflow attribution — e.g. a reopen rate
      // computed across 150 PRs with no per-workflow join. A measured
      // org-level finding is NOT an instrumentation gap; the stage block
      // below classifies it as org_level_only.
      if (cicdStage === 'deploy-operate' || cicdStage === 'review-merge') {
        // fall through to the org-level stage check below
      } else {
        return 'instrumentation_gap';
      }
    }
  }

  // AI vs Non-AI comparison mode
  if (comparisonMode === 'ai_vs_non_ai') {
    // CR5 P0.6: Check for both AI and non-AI cohorts with data.
    // Generators may use either:
    //   - breakdownByTool.ai / breakdownByTool.non_ai (simple keys)
    //   - breakdownByTool.<workflow>_ai / breakdownByTool.<workflow>_nonai (within-workflow keys)
    // Both patterns represent valid AI vs non-AI cohort comparisons.
    const hasAI = breakdownByTool?.ai && breakdownByTool.ai.count > 0;
    const hasNonAI = breakdownByTool?.non_ai && breakdownByTool.non_ai.count > 0;

    // Check within-workflow pattern: any key ending in _ai paired with _nonai
    const workflowKeys = breakdownByTool ? Object.keys(breakdownByTool) : [];
    const hasWorkflowAI = workflowKeys.some(k => k.endsWith('_ai') && breakdownByTool![k]?.count > 0);
    const hasWorkflowNonAI = workflowKeys.some(k => k.endsWith('_nonai') && breakdownByTool![k]?.count > 0);

    if ((!hasAI || !hasNonAI) && (!hasWorkflowAI || !hasWorkflowNonAI)) {
      return 'needs_more_data';
    }

    // Check sample size for cohort comparison
    // Use whichever pattern is present
    let totalCohortSamples: number;
    if (hasAI && hasNonAI) {
      totalCohortSamples = (breakdownByTool?.ai?.count || 0) + (breakdownByTool?.non_ai?.count || 0);
    } else {
      // Sum the within-workflow cohort counts
      totalCohortSamples = workflowKeys
        .filter(k => k.endsWith('_ai') || k.endsWith('_nonai'))
        .reduce((sum, k) => sum + (breakdownByTool![k]?.count || 0), 0);
    }
    if (totalCohortSamples < MIN_SAMPLES_FOR_COMPARISON) {
      return 'emerging_sample';
    }

    return 'ai_non_ai_comparable';
  }

  // Org-level metrics (no IDE attribution)
  if (cicdStage === 'deploy-operate' || cicdStage === 'review-merge') {
    // Check if breakdownByTool has real per-workflow data or just seeded demo data
    if (breakdownByTool) {
      const workflowKeys = Object.keys(breakdownByTool);
      const hasRealWorkflowData = workflowKeys.some(key => {
        const data = breakdownByTool[key];
        return data && data.count > 0 && n !== undefined && data.count < n; // Real data if count < total (not just seeded)
      });

      if (!hasRealWorkflowData) {
        return 'org_level_only';
      }
    }

    // If no breakdownByTool or all data is org-level
    if (!breakdownByTool || Object.keys(breakdownByTool).length === 0) {
      return 'org_level_only';
    }
  }

  // Workflow comparison mode (default)
  if (breakdownByTool) {
    const workflowEntries = Object.entries(breakdownByTool);
    const workflowsWithData = workflowEntries.filter(([_, data]) => data && data.count >= MIN_SAMPLES_FOR_COMPARISON);

    if (workflowsWithData.length < MIN_WORKFLOWS_FOR_COMPARISON) {
      if (workflowsWithData.length === 0) {
        return 'needs_more_data';
      }
      return 'emerging_sample';
    }

    // Check if any workflow has zero or near-zero values (indicates missing data)
    const hasZeroValue = workflowEntries.some(([_, data]) => data && (data.value === 0 || data.value === undefined || isNaN(data.value)));
    if (hasZeroValue) {
      return 'needs_more_data';
    }

    // Check if total sample size is sufficient for high confidence
    if (n !== undefined && n < MIN_SAMPLES_FOR_HIGH_CONFIDENCE) {
      return 'emerging_sample';
    }

    return 'workflow_comparable';
  }

  // CR-X P0A: Measured evidence without cross-workflow breakdown is NOT an
  // instrumentation gap. If hasData is true and we reached this fallback,
  // the insight has measured values (e.g., within-workflow AI-signal
  // coverage, session duration profile) but no cross-workflow comparison
  // (no breakdownByTool). Classify as org_level_only (measured context,
  // not cross-workflow comparable) rather than instrumentation_gap
  // ("data fields not available"). The measurement IS available; only
  // cross-workflow comparison is not.
  //
  // This preserves the distinction:
  //   - instrumentation_gap = required data fields genuinely not available
  //   - org_level_only     = measured evidence without cross-workflow comparison
  //
  // True instrumentation gaps (hasData=false) are already caught at line 35.
  if (hasData) {
    return 'org_level_only';
  }

  // True fallback: no measured data at all (should not normally reach here
  // because line 35 catches !hasData, but kept as a safe default).
  return 'instrumentation_gap';
}

/**
 * Generate title based on comparison state and data
 * 
 * PRESERVES generator titles unless they are missing or explicitly unsafe.
 * Registry title is used as fallback when generator title is generic/missing.
 * Only generates fallback titles when both titles are unsafe.
 * 
 * @param insight - Canonical insight with data
 * @param generatorTitle - The title from the generator (data-driven, preferred)
 * @param registryTitle - The canonical title from registry (fallback)
 * @returns Truthful title based on comparison state
 */
export function generateTitleFromComparisonState(
  insight: CanonicalInsight,
  generatorTitle: string,
  registryTitle?: string
): string {
  const comparisonState = computeComparisonState(insight);
  const { breakdownByTool, comparisonMode } = insight;

  // PRESERVE generator title if it's already specific and data-ready
  // Only override if generator title is generic, missing, or explicitly unsafe
  const isGeneratorTitleSpecific =
    generatorTitle.length > 20 &&
    !generatorTitle.includes('not captured yet') &&
    !generatorTitle.includes('needs attribution') &&
    !generatorTitle.includes('waiting for') &&
    !generatorTitle.includes('needs broader sample') &&
    !generatorTitle.includes('not yet measurable') &&
    !generatorTitle.includes(':'); // Avoid colon-label titles

  // If insight is comparable and generator title is specific, preserve it
  if (comparisonState === 'workflow_comparable' ||
      comparisonState === 'ai_non_ai_comparable' ||
      comparisonState === 'org_level_only') {
    if (isGeneratorTitleSpecific) {
      return generatorTitle;
    }
  }

  // FALLBACK: Use registry title if generator title is unsafe
  const fallbackTitle = registryTitle || generatorTitle;
  const isFallbackTitleSpecific = 
    fallbackTitle.length > 20 && 
    !fallbackTitle.includes('not captured yet') &&
    !fallbackTitle.includes('needs attribution') &&
    !fallbackTitle.includes('waiting for') &&
    !fallbackTitle.includes('needs broader sample') &&
    !fallbackTitle.includes('not yet measurable');

  // If insight is comparable and fallback title is specific, use it
  if (comparisonState === 'workflow_comparable' || 
      comparisonState === 'ai_non_ai_comparable' ||
      comparisonState === 'org_level_only') {
    if (isFallbackTitleSpecific) {
      return fallbackTitle;
    }
  }

  // If insight is not comparable, use non-comparative title
  // Do NOT append to fallback title since it may contain comparative language
  if (comparisonState === 'needs_more_data') {
    // For AI vs Non-AI comparisons, check which cohort has data and title accordingly
    if (comparisonMode === 'ai_vs_non_ai' && breakdownByTool) {
      // CR5 P0.6: Check both simple (ai/non_ai) and within-workflow (*_ai/*_nonai) key patterns
      const workflowKeys = Object.keys(breakdownByTool);
      const hasAI = (breakdownByTool.ai && (breakdownByTool.ai.count > 0 || breakdownByTool.ai.value > 0)) ||
        workflowKeys.some(k => k.endsWith('_ai') && (breakdownByTool[k].count > 0 || breakdownByTool[k].value > 0));
      const hasNonAI = (breakdownByTool.non_ai && (breakdownByTool.non_ai.count > 0 || breakdownByTool.non_ai.value > 0)) ||
        workflowKeys.some(k => k.endsWith('_nonai') && (breakdownByTool[k].count > 0 || breakdownByTool[k].value > 0));

      // If both cohorts have data, use the fallback title (it should already be specific)
      if (hasAI && hasNonAI) {
        return fallbackTitle;
      }

      if (hasAI && !hasNonAI) {
        return 'AI vs Non-AI comparison needs more non-AI sample';
      }
      if (!hasAI && hasNonAI) {
        return 'AI vs Non-AI comparison needs more AI sample';
      }
    }
    // Extract the metric name from fallback title without comparative language
    // Remove comparative phrases like "increased", "accelerated", "leads", "faster", "higher", "lower"
    const metricName = fallbackTitle
      .replace(/increased|accelerated|leads|faster|higher|lower|better|worse/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `${metricName} (needs more data)`;
  }

  if (comparisonState === 'instrumentation_gap') {
    // Extract the metric name from fallback title without comparative language
    const metricName = fallbackTitle
      .replace(/increased|accelerated|leads|faster|higher|lower|better|worse/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `${metricName} (instrumentation gap)`;
  }

  if (comparisonState === 'emerging_sample') {
    // Extract the metric name from fallback title without comparative language
    const metricName = fallbackTitle
      .replace(/increased|accelerated|leads|faster|higher|lower|better|worse/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `${metricName} (emerging sample)`;
  }

  if (comparisonState === 'org_level_only') {
    // For org-level metrics, keep the fallback title but ensure it doesn't imply workflow comparison
    return fallbackTitle;
  }

  // For comparable insights, use the fallback title (generators should set truthful titles)
  return fallbackTitle;
}

/**
 * Validate that a title is truthful given the comparison state
 * 
 * @param title - The title to validate
 * @param comparisonState - The computed comparison state
 * @returns true if title is truthful for the comparison state
 */
export function validateTitleForComparisonState(title: string, comparisonState: ComparisonState): boolean {
  const comparativeKeywords = ['leads', 'higher', 'lower', 'faster', 'slower', 'best', 'worst', 'vs', 'versus'];

  // Non-comparable states should not have comparative language
  if (comparisonState === 'needs_more_data' || 
      comparisonState === 'instrumentation_gap' || 
      comparisonState === 'emerging_sample') {
    return !comparativeKeywords.some(keyword => title.toLowerCase().includes(keyword));
  }

  // Org-level only should not imply workflow comparison
  if (comparisonState === 'org_level_only') {
    const workflowKeywords = ['cursor', 'windsurf', 'vscode', 'ide', 'workflow'];
    return !workflowKeywords.some(keyword => title.toLowerCase().includes(keyword));
  }

  // Comparable states can have comparative language
  return true;
}
