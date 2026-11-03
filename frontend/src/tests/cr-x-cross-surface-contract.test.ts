import { describe, it, expect } from 'vitest';
import { generateMultiDimensionalInsights } from '../lib/insights/final/generators/multiDimensional';
import type { CanonicalInsightInput } from '../lib/insights/final/types';

function makeSession(tool: string, hostEditor: string, aiBurst: number, durationMinutes: number) {
  return {
    session_id: Math.random().toString(36).slice(2),
    tool,
    session_source: tool,
    host_editor: hostEditor,
    duration_ms: durationMinutes * 60000,
    session_duration_minutes: durationMinutes,
    ai_burst_count: aiBurst,
    ai_suggestions_shown: 0,
    commit_count: 1,
    git_repo_url: 'https://github.com/northstar/sample-repo',
    timestamp: '2026-09-01T00:00:00.000Z',
  };
}

describe('CR-X FINAL: cross-surface behavior (W × S) contract', () => {
  it('emits a cross-surface finding for a delegated workflow on >1 surface with material difference', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 40; i++) sessions.push(makeSession('claude_code', 'claude_code', 14, 95));
    for (let i = 0; i < 12; i++) sessions.push(makeSession('claude_code', 'vscode', 6, 55));

    const input = { sessionRows: sessions } as CanonicalInsightInput;
    const insights = generateMultiDimensionalInsights(input);
    const crossSurface = insights.find(i => i.id.startsWith('cross-surface-behavior__claude_code'));

    expect(crossSurface).toBeDefined();
    expect(crossSurface!.title.toLowerCase()).toContain('claude code');
    expect(crossSurface!.title.toLowerCase()).toContain('vs code');
    expect(crossSurface!.evidence.some(e => e.label === 'terminal' || e.label === 'VS Code')).toBe(true);
  });

  it('does not emit cross-surface findings when secondary surface is sparse', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 40; i++) sessions.push(makeSession('claude_code', 'claude_code', 14, 95));
    for (let i = 0; i < 2; i++) sessions.push(makeSession('claude_code', 'vscode', 6, 55));

    const input = { sessionRows: sessions } as CanonicalInsightInput;
    const insights = generateMultiDimensionalInsights(input);

    expect(insights.some(i => i.id.startsWith('cross-surface-behavior'))).toBe(false);
  });

  it('preserves workflow identity across surfaces (VS Code bridge does not collapse to terminal)', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 20; i++) sessions.push(makeSession('claude_code', 'claude_code', 12, 90));
    for (let i = 0; i < 15; i++) sessions.push(makeSession('claude_code', 'vscode', 5, 50));

    const input = { sessionRows: sessions } as CanonicalInsightInput;
    const insights = generateMultiDimensionalInsights(input);

    // Even with a strong bridge-derived tool identity, the original surface (host_editor) is retained.
    const crossSurface = insights.find(i => i.id.startsWith('cross-surface-behavior__claude_code'));
    expect(crossSurface).toBeDefined();
  });

  it('works for an arbitrary future delegated workflow across two surfaces', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 35; i++) sessions.push(makeSession('agent_x', 'agent_x', 10, 80));
    for (let i = 0; i < 10; i++) sessions.push(makeSession('agent_x', 'ide', 4, 40));

    const input = { sessionRows: sessions } as CanonicalInsightInput;
    const insights = generateMultiDimensionalInsights(input);

    expect(insights.some(i => i.id.startsWith('cross-surface-behavior__agent_x'))).toBe(true);
  });
});
