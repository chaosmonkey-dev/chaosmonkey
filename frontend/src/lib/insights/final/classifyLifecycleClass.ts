/**
 * CR-X 2026-08-30 — Lifecycle classification (A/B/C/D).
 *
 * Classifies each canonical insight into one of four lifecycle classes:
 *   A. 'decision'   — measured pattern warranting a decision/action
 *   B. 'contextual' — truthful observation, not actionable on its own
 *   C. 'diagnostic' — missing/ineligible evidence
 *   D. 'suppress'   — weak/noisy signal, monitor-only
 *
 * Classification rules (applied in order, first match wins):
 *   1. isDiagnostic === true OR hasData === false → 'diagnostic'
 *   2. lifecycleClass already set by generator → respect it
 *   3. urgencyLabel === 'informational' → 'contextual'
 *   4. recommendationState === 'no_action' → 'contextual'
 *   5. recommendationState === 'monitor_only' AND effect size below
 *      materiality threshold (5 pp/%) → 'suppress'
 *   6. Title contains "no material" or "no concern" → 'contextual'
 *   7. Otherwise → 'decision'
 *
 * Ranking contract (enforced in getTopInsights):
 *   - 'diagnostic' and 'suppress' are NEVER Top-eligible
 *   - 'decision' findings always outrank 'contextual' findings
 *   - 'contextual' may fill a Top slot ONLY when no 'decision' candidate
 *     remains for that slot
 *   - Fewer than 5 Top Insights is correct when fewer than 5 decision-grade
 *     findings exist
 */

import type { CanonicalInsight } from './types';

/**
 * Materiality threshold for suppress classification.
 * Below this effect size (in pp or %), a monitor-only finding is suppressed
 * from Top Insights rather than consuming a slot.
 */
const SUPPRESS_MATERIALITY_FLOOR = 5;

/**
 * Title patterns that indicate a contextual "no concern" finding.
 */
const CONTEXTUAL_TITLE_PATTERNS = [
  'no material concentration',
  'no concentration concern',
  'no concern',
  'broadly distributed',
];

/**
 * Classify a single insight's lifecycle class. If the insight already has
 * a lifecycleClass set by its generator, that is respected (generators
 * have the most context about what they measure).
 *
 * @param insight - The canonical insight to classify
 * @returns The lifecycle class ('decision' | 'contextual' | 'diagnostic' | 'suppress')
 */
export function classifyLifecycleClass(insight: CanonicalInsight): 'decision' | 'contextual' | 'diagnostic' | 'suppress' {
  // Rule 1: Diagnostic / data gap
  if (insight.isDiagnostic === true || insight.hasData === false) {
    return 'diagnostic';
  }

  // Rule 2: Respect generator-set lifecycleClass
  if (insight.lifecycleClass) {
    return insight.lifecycleClass;
  }

  // Rule 3: Informational urgency → contextual
  if (insight.urgencyLabel === 'informational') {
    return 'contextual';
  }

  // Rule 4: No-action recommendation → contextual
  if (insight.recommendationState === 'no_action') {
    return 'contextual';
  }

  // Rule 5: Monitor-only with weak effect → suppress
  if (insight.recommendationState === 'monitor_only' || insight.urgencyLabel === 'monitor') {
    const effectSize = getEffectSize(insight);
    if (effectSize < SUPPRESS_MATERIALITY_FLOOR) {
      return 'suppress';
    }
    // Monitor-only but above floor → still contextual (not decision)
    return 'contextual';
  }

  // Rule 6: Title patterns indicating "no concern" → contextual
  const title = (insight.title || '').toLowerCase();
  if (CONTEXTUAL_TITLE_PATTERNS.some(p => title.includes(p))) {
    return 'contextual';
  }

  // Rule 7: Default — decision finding
  return 'decision';
}

/**
 * Compute effect size for classification. Uses |deltaPct| as primary,
 * |delta| as fallback, |current| as last resort.
 */
function getEffectSize(insight: CanonicalInsight): number {
  if (typeof insight.deltaPct === 'number' && Math.abs(insight.deltaPct) > 0) {
    return Math.abs(insight.deltaPct);
  }
  if (typeof insight.delta === 'number' && Math.abs(insight.delta) > 0) {
    return Math.abs(insight.delta);
  }
  if (typeof insight.current === 'number') {
    return Math.abs(insight.current);
  }
  return 0;
}

/**
 * Classify all insights in a population. Mutates each insight to set
 * its lifecycleClass field (if not already set by the generator).
 *
 * @param insights - Array of canonical insights to classify
 * @returns The same array (mutated in place) for convenience
 */
export function classifyAllLifecycleClasses(insights: CanonicalInsight[]): CanonicalInsight[] {
  for (const insight of insights) {
    if (!insight.lifecycleClass) {
      insight.lifecycleClass = classifyLifecycleClass(insight);
    }
  }
  return insights;
}
