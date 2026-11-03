import { describe, it, expect } from 'vitest';
import { generateMultiDimensionalInsights } from '../lib/insights/final/generators/multiDimensional';
import type { CanonicalInsightInput } from '../lib/insights/final/types';

// Build fixture sessions: VS Code concentrated in am-sim (70%), others less so
function makeSession(tool: string, repo: string): any {
  return {
    tool,
    session_source: tool,
    git_repo_url: repo,
    session_duration_minutes: 30 + Math.random() * 60,
    session_active_coding_duration_minutes: 10 + Math.random() * 20,
    ai_burst_count: Math.floor(Math.random() * 5),
    time_to_first_commit_ms: 60000 + Math.random() * 120000,
    session_commits: Math.floor(Math.random() * 3),
    session_commits_source: 'observed',
    ttfc_source: 'observed',
    timestamp: new Date().toISOString(),
  };
}

function buildInput(): CanonicalInsightInput {
  const sessions: any[] = [];

  // VS Code: 70% in am-sim, 30% in angrymonkey (100 sessions) — top repo = am-sim
  for (let i = 0; i < 70; i++) sessions.push(makeSession('vscode', 'https://github.com/org/am-sim'));
  for (let i = 0; i < 30; i++) sessions.push(makeSession('vscode', 'https://github.com/org/angrymonkey'));

  // Cursor: 47% in am-sim, 30% in angrymonkey, 23% in other (100 sessions) — top repo = am-sim (47%)
  for (let i = 0; i < 47; i++) sessions.push(makeSession('cursor', 'https://github.com/org/am-sim'));
  for (let i = 0; i < 30; i++) sessions.push(makeSession('cursor', 'https://github.com/org/angrymonkey'));
  for (let i = 0; i < 23; i++) sessions.push(makeSession('cursor', 'https://github.com/org/other-repo'));

  // Devin: 47% in am-sim, 30% in cm-sim, 23% in other (100 sessions) — top repo = am-sim (47%)
  for (let i = 0; i < 47; i++) sessions.push(makeSession('devin', 'https://github.com/org/am-sim'));
  for (let i = 0; i < 30; i++) sessions.push(makeSession('devin', 'https://github.com/org/cm-sim-20251219-1'));
  for (let i = 0; i < 23; i++) sessions.push(makeSession('devin', 'https://github.com/org/other-repo'));

  // Claude Code: 40% in am-sim, 35% in angrymonkey, 25% in other (100 sessions) — top repo = am-sim (40%)
  for (let i = 0; i < 40; i++) sessions.push(makeSession('claude_code', 'https://github.com/org/am-sim'));
  for (let i = 0; i < 35; i++) sessions.push(makeSession('claude_code', 'https://github.com/org/angrymonkey'));
  for (let i = 0; i < 25; i++) sessions.push(makeSession('claude_code', 'https://github.com/org/other-repo'));

  return {
    sessionRows: sessions,
    granularity: 'week',
  };
}

describe('CR-X P1 Story-Level Consolidation: Workflow-Repo Allocation', () => {
  it('synthesizes multi-workflow concentration finding instead of N pairwise cards', () => {
    const input = buildInput();
    const insights = generateMultiDimensionalInsights(input);

    // Filter to workflow-repo-allocation findings
    const allocationFindings = insights.filter(i => i.id.startsWith('workflow-repo-allocation__'));

    console.log('\n=== ALLOCATION FINDINGS ===');
    for (const f of allocationFindings) {
      console.log(`  id=${f.id}`);
      console.log(`  title=${f.title}`);
      console.log(`  allocationSynthesis=${(f as any).allocationSynthesis ?? false}`);
      console.log(`  breakdownByTool=${JSON.stringify((f as any).breakdownByTool ?? 'none')}`);
      console.log('');
    }

    // There should be a synthesized concentration finding
    const synthesis = allocationFindings.find(f => (f as any).allocationSynthesis === true);
    expect(synthesis).toBeDefined();
    expect(synthesis!.title).toContain('much more concentrated in am-sim than the other observed workflows');

    // The synthesis should contain ALL workflows in its breakdownByTool
    const breakdown = (synthesis as any).breakdownByTool;
    expect(breakdown).toBeDefined();
    expect(Object.keys(breakdown).length).toBeGreaterThanOrEqual(3); // VS Code, Cursor, Devin, Claude Code
    expect(breakdown['VS Code']).toBeDefined();
    expect(breakdown['Cursor']).toBeDefined();

    // There should be NO pairwise "VS Code is substantially more concentrated" findings
    // (those would have _vs_ in the ID)
    const pairwiseVsCode = allocationFindings.filter(f =>
      f.id.includes('_vs_') && f.title.includes('VS Code is substantially more concentrated')
    );
    expect(pairwiseVsCode.length).toBe(0);

    // The synthesis should have evidence with all workflows (structured contract:
    // metric = workflow name, value = dominant repo, label = share, context = sessions)
    const evidence = synthesis!.evidence || [];
    const workflowEvidence = evidence.filter(e => e.value === 'am-sim' && e.metric !== 'concentration gap');
    expect(workflowEvidence.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps standalone pairwise findings when different workflows are more concentrated', () => {
    // Build a fixture where different dominant repos create genuinely different stories
    const sessions: any[] = [];

    // VS Code concentrated in repo-A
    for (let i = 0; i < 80; i++) sessions.push(makeSession('vscode', 'https://github.com/org/repo-A'));
    for (let i = 0; i < 20; i++) sessions.push(makeSession('vscode', 'https://github.com/org/repo-B'));

    // Cursor concentrated in repo-B (different dominant repo)
    for (let i = 0; i < 20; i++) sessions.push(makeSession('cursor', 'https://github.com/org/repo-A'));
    for (let i = 0; i < 80; i++) sessions.push(makeSession('cursor', 'https://github.com/org/repo-B'));

    // Devin concentrated in repo-C (disjoint)
    for (let i = 0; i < 100; i++) sessions.push(makeSession('devin', 'https://github.com/org/repo-C'));

    const input: CanonicalInsightInput = {
      sessionRows: sessions,
      granularity: 'week',
    };

    const insights = generateMultiDimensionalInsights(input);
    const allocationFindings = insights.filter(i => i.id.startsWith('workflow-repo-allocation__'));

    console.log('\n=== STANDALONE PAIRWISE FINDINGS ===');
    for (const f of allocationFindings) {
      console.log(`  id=${f.id} | title=${f.title} | synthesis=${(f as any).allocationSynthesis ?? false}`);
    }

    // These should be standalone pairwise findings (different dominant repos / disjoint)
    // No synthesis should fire because no single workflow is more concentrated than multiple others
    // in the same dominant repo
    const synthesis = allocationFindings.find(f => (f as any).allocationSynthesis === true);
    expect(synthesis).toBeUndefined();

    // Should have pairwise findings with _vs_ IDs
    const pairwise = allocationFindings.filter(f => f.id.includes('_vs_'));
    expect(pairwise.length).toBeGreaterThan(0);
  });
});
