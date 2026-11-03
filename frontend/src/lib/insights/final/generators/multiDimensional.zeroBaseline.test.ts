/**
 * Zero-baseline ratio regression tests for:
 * - generateRepoConditionedBehavior (W × R × B)
 * - generateCrossSurfaceBehavior (W × S)
 *
 * Regression context (fleet audit): a repo comparison rendered
 * a 1,389.4× AI-burst multiplier when the comparison repo's observed value
 * was literally 0.0. The multiplier came from dividing by a 0.001 clamp —
 * false precision, not measurement. A zero or near-zero baseline cannot
 * support a ratio; the finding must render an absolute comparison or an
 * explicit unavailable-ratio state instead.
 *
 * Run with: ./node_modules/.bin/tsx src/lib/insights/final/generators/multiDimensional.zeroBaseline.test.ts
 */

import { generateMultiDimensionalInsights } from './multiDimensional';
import type { CanonicalInsight } from '../types';

let failures = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failures++;
    console.error(`  FAIL: ${message}`);
  } else {
    console.log(`  ok: ${message}`);
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────

function sessionRow(overrides: Record<string, unknown>): any {
  return {
    tool: 'claude_code',
    timestamp: '2026-10-25T12:00:00Z',
    session_duration_minutes: 30,
    ai_burst_count: 1,
    ...overrides,
  };
}

function rowsFor(repo: string, n: number, aiBurst: number, hostEditor?: string): any[] {
  return Array.from({ length: n }, (_, i) =>
    sessionRow({
      git_repo_url: `https://github.com/acme/${repo}.git`,
      ai_burst_count: aiBurst,
      session_duration_minutes: 30,
      host_editor: hostEditor,
      timestamp: `2026-10-25T${String(10 + i).padStart(2, '0')}:00:00Z`,
    })
  );
}

function ratioEvidence(insight: CanonicalInsight | undefined) {
  return insight?.evidence?.find((e: any) => e.metric === 'ratio');
}

function repoConditionedAiBurst(insights: CanonicalInsight[]) {
  return insights.find(
    i => i.presentationKind === 'repo_conditioned_behavior' && i.metricKind === 'ai_burst'
  );
}

function crossSurfaceAiBurst(insights: CanonicalInsight[]) {
  return insights.find(
    i => i.presentationKind === 'cross_surface_behavior' && i.metricKind === 'ai_burst'
  );
}

// ── Cases ────────────────────────────────────────────────────────────────

console.log('Zero-baseline ratio guards — repo-conditioned + cross-surface');

// 1. TRUE ZERO baseline: repo A avg 1.4, repo B avg 0.0.
//    The finding may exist (absolute comparison is meaningful) but must not
//    display a fabricated multiplier.
{
  const rows = [
    ...rowsFor('agent-platform', 20, 1.4),
    ...rowsFor('delivery-tracker', 20, 0),
  ];
  const findings = generateMultiDimensionalInsights({ sessionRows: rows } as any);
  const f = repoConditionedAiBurst(findings);
  assert(!!f, 'Z1 zero baseline: repo-conditioned ai_burst finding still emitted');
  const r = ratioEvidence(f);
  assert(r && !/x$/.test(String(r.value)), 'Z2 zero baseline: ratio evidence is not a multiplier');
  assert(
    r && /zero baseline/i.test(String(r.value)),
    'Z3 zero baseline: ratio evidence states the unavailable-ratio reason'
  );
  assert(
    f ? /1\.4/.test(f.title) && /0\.0/.test(f.title) : false,
    'Z4 zero baseline: title shows the honest absolute comparison (1.4 vs 0.0)'
  );
  assert(
    f ? !/1,\d{3}|\d{3,}\.\dx|Infinity|NaN/.test(f.title) : false,
    'Z5 zero baseline: title contains no fabricated large multiplier'
  );
}

// 2. VALID NONZERO baseline: ratio remains a real multiplier.
{
  const rows = [
    ...rowsFor('repo-high', 20, 3),
    ...rowsFor('repo-low', 20, 1),
  ];
  const findings = generateMultiDimensionalInsights({ sessionRows: rows } as any);
  const f = repoConditionedAiBurst(findings);
  const r = ratioEvidence(f);
  assert(r && String(r.value) === '3.0x', 'V1 valid baseline: ratio renders real 3.0x multiplier');
}

// 3. NEAR-ZERO baseline (< epsilon): still treated as absent baseline.
{
  const rows = [
    ...rowsFor('repo-high', 20, 1.4),
    ...rowsFor('repo-tiny', 20, 0.0005),
  ];
  const findings = generateMultiDimensionalInsights({ sessionRows: rows } as any);
  const f = repoConditionedAiBurst(findings);
  const r = ratioEvidence(f);
  assert(r && !/x$/.test(String(r.value)), 'N1 near-zero baseline: no multiplier for sub-epsilon denominator');
}

// 4. MISSING metric values on one repo: no ai_burst comparison fabricated.
{
  const withSignal = rowsFor('repo-high', 20, 2);
  const missing = Array.from({ length: 20 }, (_, i) =>
    sessionRow({
      git_repo_url: 'https://github.com/acme/repo-missing.git',
      ai_burst_count: undefined,
      session_duration_minutes: 30,
      timestamp: `2026-10-25T${String(10 + i).padStart(2, '0')}:00:00Z`,
    })
  );
  const findings = generateMultiDimensionalInsights({ sessionRows: [...withSignal, ...missing] } as any);
  const f = repoConditionedAiBurst(findings);
  assert(!f, 'M1 missing denominator: no ai_burst comparison when one repo has no measured signal');
}

// 5. CROSS-SURFACE zero baseline: same workflow on two surfaces, one with
//    zero AI bursts — title must not contain a fabricated multiplier.
{
  const rows = [
    ...rowsFor('same-repo', 20, 2, 'vscode'),
    ...rowsFor('same-repo', 20, 0, 'terminal'),
  ];
  const findings = generateMultiDimensionalInsights({ sessionRows: rows } as any);
  const f = crossSurfaceAiBurst(findings);
  const r = ratioEvidence(f);
  assert(r && !/x$/.test(String(r.value)), 'C1 cross-surface zero baseline: ratio evidence is not a multiplier');
  assert(
    f ? !/×/.test(f.title) : true,
    'C2 cross-surface zero baseline: title contains no × multiplier'
  );
  assert(
    f ? /2\.0/.test(f.title) && /0\.0/.test(f.title) : false,
    'C3 cross-surface zero baseline: title shows the honest absolute comparison'
  );
}

// 6. CROSS-SURFACE valid baseline: multiplier preserved.
{
  const rows = [
    ...rowsFor('same-repo', 20, 3, 'vscode'),
    ...rowsFor('same-repo', 20, 1, 'terminal'),
  ];
  const findings = generateMultiDimensionalInsights({ sessionRows: rows } as any);
  const f = crossSurfaceAiBurst(findings);
  const r = ratioEvidence(f);
  assert(r && String(r.value) === '3.0x', 'C4 cross-surface valid baseline: real 3.0x multiplier preserved');
  assert(f ? /3\.0×/.test(f.title) : false, 'C5 cross-surface valid baseline: title keeps real multiplier');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll zero-baseline ratio assertions passed.');
  process.exit(0);
}
