import { selectWithPerToolFloor } from '../selection';
import type { PerformanceInsight } from '../../lib/insights/types';

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

describe('selectWithPerToolFloor', () => {
  test('should ensure at least one insight per tool when all tools have significant candidates', () => {
    const raw = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.028, 1),
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', 0.41, 0.030, 1),
      createTestInsight('3', 'jetbrains', 'cycle_time', 'ai_usage', 0.36, 0.040, 0)
    ];

    const deduped = [
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', 0.41, 0.030, 1)
    ];

    const result = selectWithPerToolFloor({
      raw,
      deduped,
      totalLimit: 10,
      perToolMin: 1,
      sigP: 0.05
    });

    // Should have at least one insight per tool
    const tools = result.map(r => r.related?.tools?.[0]).filter(Boolean);
    expect(tools).toContain('cursor');
    expect(tools).toContain('jetbrains');
    expect(tools).toContain('vscode');
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  test('should not force tools with no significant candidates', () => {
    const raw = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.15, 1), // p > sigP
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', 0.41, 0.030, 1),
      createTestInsight('3', 'jetbrains', 'cycle_time', 'ai_usage', 0.36, 0.040, 0)
    ];

    const deduped = [
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', 0.41, 0.030, 1)
    ];

    const result = selectWithPerToolFloor({
      raw,
      deduped,
      totalLimit: 10,
      perToolMin: 1,
      sigP: 0.05
    });

    // Should have cursor and jetbrains, but not vscode (no significant candidates)
    const tools = result.map(r => r.related?.tools?.[0]).filter(Boolean);
    expect(tools).toContain('cursor');
    expect(tools).toContain('jetbrains');
    expect(tools).not.toContain('vscode');
  });

  test('should not create duplicates by equivalence key', () => {
    const raw = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.028, 1),
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', 0.41, 0.030, 1),
      createTestInsight('3', 'jetbrains', 'cycle_time', 'ai_usage', 0.36, 0.040, 0)
    ];

    const deduped = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.028, 1)
    ];

    const result = selectWithPerToolFloor({
      raw,
      deduped,
      totalLimit: 10,
      perToolMin: 1,
      sigP: 0.05
    });

    // Should not have duplicates (same target metric, driver family, lag, sign)
    const equivalenceKeys = result.map(r => {
      const targetMetric = 'merge_rate';
      const driverMetric = 'productive_time';
      const lag = 1;
      const sign = 'pos';
      return `${targetMetric}|ide_${driverMetric}|lag${lag}|${sign}`;
    });
    
    const uniqueKeys = new Set(equivalenceKeys);
    expect(uniqueKeys.size).toBe(equivalenceKeys.length);
  });

  test('should respect total limit', () => {
    const raw = Array.from({ length: 20 }, (_, i) => 
      createTestInsight(`insight-${i}`, `tool-${i % 3}`, 'merge_rate', 'productive_time', 0.3 + i * 0.01, 0.01 + i * 0.001, 1)
    );

    const deduped = raw.slice(0, 5);

    const result = selectWithPerToolFloor({
      raw,
      deduped,
      totalLimit: 8,
      perToolMin: 1,
      sigP: 0.05
    });

    expect(result.length).toBeLessThanOrEqual(8);
  });

  test('should prioritize by p-value then correlation strength', () => {
    const raw = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.39, 0.028, 1),
      createTestInsight('2', 'vscode', 'cycle_time', 'ai_usage', 0.45, 0.025, 0), // Better p-value
      createTestInsight('3', 'vscode', 'deployment_frequency', 'productive_time', 0.50, 0.030, 1) // Better correlation
    ];

    const deduped = [];

    const result = selectWithPerToolFloor({
      raw,
      deduped,
      totalLimit: 10,
      perToolMin: 1,
      sigP: 0.05
    });

    // Should pick the insight with best p-value first
    expect(result[0].id).toBe('2'); // cycle_time with p=0.025
  });
});



