/**
 * Inspectable render-evidence dump for the zero-baseline ratio fix.
 *
 * Prints the exact customer-visible strings (title + evidence rows) the
 * dashboard renders for each scenario — the same text that appears in
 * insight cards, evidence tables, and Share Insight payloads. Used for
 * visual/copy acceptance without synthetic production telemetry.
 *
 * Run with: npx tsx src/lib/insights/final/generators/zeroBaselineEvidenceDump.ts
 */

import { generateMultiDimensionalInsights } from './multiDimensional';
import { generateWithinWorkflowCommitsProfile } from './planCode';

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
      host_editor: hostEditor,
      timestamp: `2026-10-25T${String(10 + i).padStart(2, '0')}:00:00Z`,
    })
  );
}

function print(label: string, insights: any[], pick?: (i: any) => boolean) {
  console.log(`\n${'═'.repeat(72)}\n${label}\n${'═'.repeat(72)}`);
  const hits = pick ? insights.filter(pick) : insights;
  if (hits.length === 0) {
    console.log('  (no finding emitted)');
    return;
  }
  for (const f of hits) {
    console.log(`TITLE:      ${f.title}`);
    console.log(`confidence: ${f.confidence}   n=${f.n}   deltaPct=${f.displayDeltaPct}`);
    for (const e of f.evidence ?? []) {
      console.log(`  evidence: ${e.metric} = ${e.value}${e.label ? `  [${e.label} ${e.context ?? ''}]` : ''}`);
    }
    console.log(`desc:       ${f.description}`);
  }
}

// ── Scenario 1: Patra-shaped true-zero AI-burst baseline ─────────────────
print(
  'SCENARIO 1 — repo-conditioned ai_burst, TRUE ZERO baseline (Patra case)',
  generateMultiDimensionalInsights({
    sessionRows: [
      ...rowsFor('agent-platform', 20, 1.4),
      ...rowsFor('delivery-tracker', 20, 0),
    ],
  } as any),
  i => i.metricKind === 'ai_burst'
);

// ── Scenario 2: cross-surface TRUE ZERO baseline ─────────────────────────
print(
  'SCENARIO 2 — cross-surface ai_burst, TRUE ZERO baseline',
  generateMultiDimensionalInsights({
    sessionRows: [
      ...rowsFor('same-repo', 20, 2, 'vscode'),
      ...rowsFor('same-repo', 20, 0, 'terminal'),
    ],
  } as any),
  i => i.presentationKind === 'cross_surface_behavior' && i.metricKind === 'ai_burst'
);

// ── Scenario 3: cross-surface VALID nonzero denominator ──────────────────
print(
  'SCENARIO 3 — cross-surface ai_burst, VALID baseline (multiplier preserved)',
  generateMultiDimensionalInsights({
    sessionRows: [
      ...rowsFor('same-repo', 20, 3, 'vscode'),
      ...rowsFor('same-repo', 20, 1, 'terminal'),
    ],
  } as any),
  i => i.presentationKind === 'cross_surface_behavior' && i.metricKind === 'ai_burst'
);

// ── Scenario 4: commit-variance NEAR-ZERO median ─────────────────────────
{
  // 20 sessions: 9 zero-commit (45%), 5 near-zero (0.05), 6 high (5.0)
  // → median 0.05 (< 0.1), p90 ~5 → high-variance branch, no meaningful ratio.
  const rows = [
    ...Array.from({ length: 9 }, () => sessionRow({ session_commits: 0, session_commits_source: 'observed', git_repo_url: 'https://github.com/acme/r.git' })),
    ...Array.from({ length: 5 }, () => sessionRow({ session_commits: 0.05, session_commits_source: 'observed', git_repo_url: 'https://github.com/acme/r.git' })),
    ...Array.from({ length: 6 }, () => sessionRow({ session_commits: 5, session_commits_source: 'observed', git_repo_url: 'https://github.com/acme/r.git' })),
  ];
  const out = generateWithinWorkflowCommitsProfile({ sessionRows: rows } as any) ?? [];
  print('SCENARIO 4 — commit variance, NEAR-ZERO median', out);
}

// ── Scenario 5: commit variance, VALID median (real ratio preserved) ─────
{
  const rows = [
    ...Array.from({ length: 11 }, () => sessionRow({ session_commits: 1, session_commits_source: 'observed', git_repo_url: 'https://github.com/acme/r.git' })),
    ...Array.from({ length: 9 }, () => sessionRow({ session_commits: 8, session_commits_source: 'observed', git_repo_url: 'https://github.com/acme/r.git' })),
  ];
  const out = generateWithinWorkflowCommitsProfile({ sessionRows: rows } as any) ?? [];
  print('SCENARIO 5 — commit variance, VALID median (real ratio preserved)', out);
}

// ── Scenario 6: missing ai_burst measurement — no fabricated comparison ──
print(
  'SCENARIO 6 — one repo MISSING ai_burst (must emit no ai_burst comparison)',
  generateMultiDimensionalInsights({
    sessionRows: [
      ...rowsFor('repo-a', 20, 2),
      ...Array.from({ length: 20 }, (_, i) =>
        sessionRow({ git_repo_url: 'https://github.com/acme/repo-b.git', ai_burst_count: undefined, timestamp: `2026-10-25T${String(10 + i).padStart(2, '0')}:00:00Z` })
      ),
    ],
  } as any),
  i => i.metricKind === 'ai_burst'
);
