/**
 * Neutral Polarity Test
 *
 * Verifies that the renderAdapter preserves explicit 'neutral' polarity
 * and does not let it fall through to 'higher_is_better'.
 */
import { describe, it, expect } from 'vitest';
import { adaptCanonicalInsightsToUI } from '../lib/insights/final/adapters/renderAdapter';
import type { CanonicalInsight } from '../lib/insights/final/types';

function mkInsight(overrides: Partial<CanonicalInsight> = {}): CanonicalInsight {
  return {
    id: 'allocated-spend-per-deployment',
    title: '$25 configured AI spend per deployment · August 2026',
    cicdStage: 'deploy-operate',
    canonicalPriority: 2,
    renderOrder: 25,
    presentationType: 'synthesized',
    presentationKind: 'unit_economics',
    comparisonMode: 'absolute',
    comparisonState: 'org_level_only',
    current: 25,
    confidence: 'medium',
    hasData: true,
    n: 40,
    polarity: 'neutral',
    description: 'Test description',
    ...overrides,
  } as CanonicalInsight;
}

describe('Neutral polarity contract', () => {
  it('UE insight with polarity=neutral preserves neutral through renderAdapter', () => {
    const insight = mkInsight();
    const adapted = adaptCanonicalInsightsToUI([insight]);
    expect(adapted).toHaveLength(1);
    expect(adapted[0].polarity).toBe('neutral');
  });

  it('existing higher_is_better metric remains higher_is_better', () => {
    const insight = mkInsight({
      id: 'active-coding-time-by-ide',
      polarity: 'higher_is_better',
      presentationKind: 'workflow_comparison',
      comparisonState: 'workflow_comparable',
    });
    const adapted = adaptCanonicalInsightsToUI([insight]);
    expect(adapted[0].polarity).toBe('higher_is_better');
  });

  it('existing lower_is_better metric remains lower_is_better', () => {
    const insight = mkInsight({
      id: 'rework-rate-by-workflow',
      polarity: 'lower_is_better',
      presentationKind: 'workflow_comparison',
      comparisonState: 'workflow_comparable',
    });
    const adapted = adaptCanonicalInsightsToUI([insight]);
    expect(adapted[0].polarity).toBe('lower_is_better');
  });

  it('neutral UE card does not display directional leader/winner semantics', () => {
    const insight = mkInsight();
    const adapted = adaptCanonicalInsightsToUI([insight]);
    const allText = JSON.stringify(adapted[0]);
    // Should not contain directional language
    expect(allText.toLowerCase()).not.toContain('leader');
    expect(allText.toLowerCase()).not.toContain('winner');
    expect(allText.toLowerCase()).not.toContain('good');
    expect(allText.toLowerCase()).not.toContain('bad');
  });
});
