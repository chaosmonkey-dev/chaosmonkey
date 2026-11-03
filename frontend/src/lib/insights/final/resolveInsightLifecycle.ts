/**
 * Pure production lifecycle resolver for Performance Insights.
 *
 * Consumed by renderAdapter, PerformanceRecommendationsView.vue, and production tests.
 * Establishes one authority for recommendationAllowed, isTopInsightEligible,
 * showActionStrip, and lifecycle state.
 *
 * Rules:
 * 1. isDiagnostic=true → recommendationAllowed=false, isTopInsightEligible=false, showActionStrip=false
 * 2. recommendationState=monitor_only → recommendationAllowed=false, isTopInsightEligible=false, showActionStrip=false
 * 3. operationalSignificance=not_significant → recommendationAllowed=false, isTopInsightEligible=false, showActionStrip=false
 * 4. A recommendation may not instruct the user to reach a threshold the current value already satisfies.
 */

export type LifecycleState =
  | 'diagnostic'
  | 'monitor_only'
  | 'not_significant'
  | 'action_required'
  | 'actionable';

export type PresentationState = 'neutral' | 'directional';

export interface LifecycleInput {
  isDiagnostic?: boolean;
  recommendationState?: string;
  operationalSignificance?: 'significant' | 'not_significant' | 'unknown';
  comparisonState?: string;
  gap?: number;
  significanceThreshold?: number;
  targetThreshold?: number;
  hasData?: boolean;
}

export interface LifecycleResult {
  recommendationAllowed: boolean;
  isTopInsightEligible: boolean;
  showActionStrip: boolean;
  lifecycleState: LifecycleState;
  presentation: PresentationState;
}

export function resolveInsightLifecycle(input: LifecycleInput): LifecycleResult {
  const isDiagnostic = input.isDiagnostic === true;
  const isMonitorOnly = input.recommendationState === 'monitor_only';
  const isNotSignificant = input.operationalSignificance === 'not_significant';
  const hasData = input.hasData !== false;

  // Rule 1: Diagnostic
  if (isDiagnostic) {
    return {
      recommendationAllowed: false,
      isTopInsightEligible: false,
      showActionStrip: false,
      lifecycleState: 'diagnostic',
      presentation: 'neutral',
    };
  }

  // Rule 2: monitor_only
  if (isMonitorOnly) {
    return {
      recommendationAllowed: false,
      isTopInsightEligible: false,
      showActionStrip: false,
      lifecycleState: 'monitor_only',
      presentation: 'neutral',
    };
  }

  // Rule 3: not_significant
  if (isNotSignificant) {
    return {
      recommendationAllowed: false,
      isTopInsightEligible: false,
      showActionStrip: false,
      lifecycleState: 'not_significant',
      presentation: 'neutral',
    };
  }

  // Rule 4: Gap below significance threshold
  if (input.gap !== undefined && input.significanceThreshold !== undefined &&
      input.gap < input.significanceThreshold) {
    return {
      recommendationAllowed: false,
      isTopInsightEligible: false,
      showActionStrip: false,
      lifecycleState: 'not_significant',
      presentation: 'neutral',
    };
  }

  // Rule 5: Target already satisfied — gap below target threshold
  if (input.gap !== undefined && input.targetThreshold !== undefined &&
      input.gap < input.targetThreshold) {
    return {
      recommendationAllowed: false,
      isTopInsightEligible: false,
      showActionStrip: false,
      lifecycleState: 'monitor_only',
      presentation: 'neutral',
    };
  }

  // No data
  if (!hasData) {
    return {
      recommendationAllowed: false,
      isTopInsightEligible: false,
      showActionStrip: false,
      lifecycleState: 'diagnostic',
      presentation: 'neutral',
    };
  }

  // Actionable
  return {
    recommendationAllowed: true,
    isTopInsightEligible: true,
    showActionStrip: true,
    lifecycleState: 'actionable',
    presentation: 'directional',
  };
}
