import { describe, it, expect } from 'vitest';
import { generateMultiDimensionalInsights } from '../lib/insights/final/generators/multiDimensional';
import type { CanonicalInsightInput } from '../lib/insights/final/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-15T00:00:00.000Z').getTime();

function makeSession(tool: string, daysAgo: number, overrides: Record<string, any> = {}) {
  const t = new Date(NOW - daysAgo * MS_PER_DAY).toISOString();
  return {
    session_id: Math.random().toString(36).slice(2),
    tool,
    session_source: tool,
    timestamp: t,
    duration_ms: (overrides.duration_minutes ?? 60) * 60000,
    session_duration_minutes: overrides.duration_minutes ?? 60,
    session_active_coding_duration_minutes: overrides.active_coding_minutes ?? 45,
    ai_burst_count: overrides.ai_burst_count ?? 5,
    ai_suggestions_shown: 0,
    commit_count: 1,
    git_repo_url: overrides.git_repo_url ?? 'https://github.com/northstar/sample-repo',
    ...overrides,
  };
}

describe('CR-X FINAL: within-workflow longitudinal (W × T) contract', () => {
  it('emits a longitudinal finding for a mature delegated workflow when runtime changes', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 25; i++) sessions.push(makeSession('claude_code', i % 14, { duration_minutes: 100, ai_burst_count: 10 }));
    for (let i = 0; i < 25; i++) sessions.push(makeSession('claude_code', 14 + (i % 14), { duration_minutes: 50, ai_burst_count: 4 }));

    const input = { sessionRows: sessions } as CanonicalInsightInput;
    const insights = generateMultiDimensionalInsights(input);
    const found = insights.find(i => i.id.startsWith('within-workflow-longitudinal-behavior__claude_code'));

    expect(found).toBeDefined();
    expect(found!.title.toLowerCase()).toContain('claude code');
  });

  it('uses active-coding metric for human-interactive workflows, not delegated runtime', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 25; i++) sessions.push(makeSession('vscode', i % 14, { active_coding_minutes: 120, duration_minutes: 130 }));
    for (let i = 0; i < 25; i++) sessions.push(makeSession('vscode', 14 + (i % 14), { active_coding_minutes: 60, duration_minutes: 70 }));

    const input = { sessionRows: sessions } as CanonicalInsightInput;
    const insights = generateMultiDimensionalInsights(input);
    const found = insights.find(i => i.id.startsWith('within-workflow-longitudinal-behavior__vscode'));

    expect(found).toBeDefined();
    // Must not label as a delegated-runtime comparison for a human-interactive workflow.
    expect(found!.title.toLowerCase()).not.toContain('runs became');
    expect(found!.metricKind).toContain('active');
  });

  it('emits nothing when the history is flat across windows', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 60; i++) sessions.push(makeSession('claude_code', i % 28, { duration_minutes: 60, ai_burst_count: 5 }));

    const input = { sessionRows: sessions } as CanonicalInsightInput;
    const insights = generateMultiDimensionalInsights(input);

    expect(insights.some(i => i.id.startsWith('within-workflow-longitudinal-behavior'))).toBe(false);
  });

  it('emits nothing when the prior window is too sparse', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 40; i++) sessions.push(makeSession('claude_code', i % 14, { duration_minutes: 100 }));
    for (let i = 0; i < 2; i++) sessions.push(makeSession('claude_code', 14 + i, { duration_minutes: 50 }));

    const input = { sessionRows: sessions } as CanonicalInsightInput;
    const insights = generateMultiDimensionalInsights(input);

    expect(insights.some(i => i.id.startsWith('within-workflow-longitudinal-behavior'))).toBe(false);
  });

  it('works for an arbitrary future workflow with no hardcoded list membership', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 30; i++) sessions.push(makeSession('agent_x', i % 14, { ai_burst_count: 12 }));
    for (let i = 0; i < 30; i++) sessions.push(makeSession('agent_x', 14 + (i % 14), { ai_burst_count: 5 }));

    const input = { sessionRows: sessions } as CanonicalInsightInput;
    const insights = generateMultiDimensionalInsights(input);

    expect(insights.some(i => i.id.startsWith('within-workflow-longitudinal-behavior__agent_x'))).toBe(true);
  });

  it('does not compare human active-coding to delegated runtime semantics', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 25; i++) sessions.push(makeSession('vscode', i % 14, { active_coding_minutes: 10, duration_minutes: 200 }));
    for (let i = 0; i < 25; i++) sessions.push(makeSession('vscode', 14 + (i % 14), { active_coding_minutes: 5, duration_minutes: 100 }));

    const input = { sessionRows: sessions } as CanonicalInsightInput;
    const insights = generateMultiDimensionalInsights(input);
    const found = insights.find(i => i.id.startsWith('within-workflow-longitudinal-behavior__vscode'));

    expect(found).toBeDefined();
    // VS Code active coding is small; the large duration is delegated semantics and must not drive the title.
    const titleLower = found!.title.toLowerCase();
    expect(titleLower).toContain('active');
    expect(titleLower).not.toContain('runs became');
  });
});
