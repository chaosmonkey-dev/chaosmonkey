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

describe('Quick Test Seed Scenario', () => {
  test('should handle the specific test case: VS Code vs Cursor vs JetBrains', () => {
    const raw = [
      createTestInsight('1', 'vscode', 'merge_rate', 'productive_time', 0.41, 0.03, 1),
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', 0.39, 0.028, 1),
      createTestInsight('3', 'jetbrains', 'cycle_time', 'ai_usage', 0.36, 0.04, 0)
    ];

    // Deduped picks Cursor for the productive_time→merge_rate class (lowest p=0.028)
    const deduped = [
      createTestInsight('2', 'cursor', 'merge_rate', 'productive_time', 0.39, 0.028, 1)
    ];

    const result = selectWithPerToolFloor({
      raw,
      deduped,
      totalLimit: 10,
      perToolMin: 1,
      sigP: 0.05
    });

    // Final selection should include:
    // - Cursor (merge_rate/productive_time) - from deduped
    // - JetBrains (cycle_time/ai_usage) - floor-filled
    // - VS Code gets another non-equivalent top candidate from raw if present
    
    const tools = result.map(r => r.related?.tools?.[0]).filter(Boolean);
    expect(tools).toContain('cursor');
    expect(tools).toContain('jetbrains');
    
    // Should have at least 2 insights (cursor + jetbrains)
    expect(result.length).toBeGreaterThanOrEqual(2);
    
    // Verify no duplicates by equivalence key
    const equivalenceKeys = result.map(r => {
      const title = r.title.toLowerCase();
      if (title.includes('merge_rate') && title.includes('productive_time')) {
        return 'merge_rate|ide_productive_time|lag1|pos';
      }
      if (title.includes('cycle_time') && title.includes('ai_usage')) {
        return 'cycle_time|ide_ai_usage|lag0|pos';
      }
      return 'unknown';
    });
    
    const uniqueKeys = new Set(equivalenceKeys);
    expect(uniqueKeys.size).toBe(equivalenceKeys.length);
  });
});



