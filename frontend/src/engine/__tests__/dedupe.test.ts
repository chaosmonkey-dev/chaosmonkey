import { dedupeKeepPrimaryTool } from '../engine/dedupe';
import type { PerformanceInsight } from '../lib/insights/types';

// Helper function to create test insights
function createTestInsight(
  id: string,
  tool: string,
  targetMetric: string,
  driverMetric: string,
  r: number,
  p: number,
  lagWeeks?: number
): PerformanceInsight {
  return {
    id,
    title: `${tool} ${driverMetric} ${r > 0 ? 'increases' : 'decreases'} ${targetMetric}`,
    description: `Test insight for ${tool}`,
    severity: 'info',
    tags: ['test'],
    related: {
      tools: [tool]
    },
    evidence: [
      { label: 'Correlation (r)', metric: 'correlation', value: r },
      { label: 'p', metric: 'p-value', value: p },
      { label: 'Periods', metric: 'periods', value: lagWeeks || 4 }
    ],
    recommendations: [],
    source: 'mixed'
  };
}

describe('dedupeKeepPrimaryTool', () => {
  test('should dedupe equivalent insights and keep the one with lowest p-value', () => {
    const insights = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.028, 1),
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', 0.41, 0.030, 1),
      createTestInsight('3', 'jetbrains', 'merge_rate', 'productive_time', 0.44, 0.035, 1)
    ];

    const result = dedupeKeepPrimaryTool(insights);

    expect(result).toHaveLength(1);
    expect(result[0].related?.tools?.[0]).toBe('vscode'); // Should pick vscode (lowest p=0.028)
    expect(result[0].description).toContain('Also observed in CURSOR, JETBRAINS');
  });

  test('should not dedupe opposite-sign correlations', () => {
    const insights = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.028, 1),
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', -0.42, 0.025, 1)
    ];

    const result = dedupeKeepPrimaryTool(insights);

    expect(result).toHaveLength(2); // Should keep both (different signs)
  });

  test('should not dedupe different lags', () => {
    const insights = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.028, 1),
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', 0.41, 0.030, 2)
    ];

    const result = dedupeKeepPrimaryTool(insights);

    expect(result).toHaveLength(2); // Should keep both (different lags)
  });

  test('should handle tie on p-value by picking highest |r|', () => {
    const insights = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.030, 1),
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', 0.45, 0.030, 1) // Higher |r|
    ];

    const result = dedupeKeepPrimaryTool(insights);

    expect(result).toHaveLength(1);
    expect(result[0].related?.tools?.[0]).toBe('cursor'); // Should pick cursor (higher |r|)
  });

  test('should handle tie on both p and |r| by stable tool name ordering', () => {
    const insights = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.030, 1),
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', 0.39, 0.030, 1) // Same p and |r|
    ];

    const result = dedupeKeepPrimaryTool(insights);

    expect(result).toHaveLength(1);
    expect(result[0].related?.tools?.[0]).toBe('cursor'); // Should pick cursor (alphabetically first)
  });

  test('should handle different target metrics separately', () => {
    const insights = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.028, 1),
      createTestInsight('2', 'cursor', 'cycle_time', 'productive_time', 0.41, 0.030, 1)
    ];

    const result = dedupeKeepPrimaryTool(insights);

    expect(result).toHaveLength(2); // Should keep both (different target metrics)
  });

  test('should handle different driver families separately', () => {
    const insights = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.028, 1),
      createTestInsight('2', 'cursor', 'merge_rate', 'ai_usage', 0.41, 0.030, 1)
    ];

    const result = dedupeKeepPrimaryTool(insights);

    expect(result).toHaveLength(2); // Should keep both (different driver families)
  });
});



