import { describe, it, expect } from 'vitest';
import {
  generateAIIntensityCohortAnalysis,
  generateWithinWorkflowAIEffect,
  generateRepositoryConcentration,
  generateWorkflowSessionDistribution,
  normalizeRepoUrl,
} from '../lib/insights/final/generators/planCode';
import { getCanonicalPIById, resolveCanonicalFamilyId } from '../lib/insights/final/canonicalInsights';
import { resolveFamilyForDiversity } from '../lib/insights/final/utils/ranking';
import type { CanonicalInsightInput } from '../lib/insights/final/types';

function mkSession(overrides: Partial<any> = {}): any {
  return {
    session_id: `s-${Math.random().toString(36).slice(2)}`,
    tool: 'vscode',
    timestamp: '2026-07-15T10:00:00.000000Z',
    duration_ms: 600000,
    active_coding_duration_ms: 300000,
    ai_burst_count: 0,
    session_duration_minutes: 10,
    session_active_coding_duration_minutes: 5,
    session_has_ai_activity: false,
    file_save_count: 3,
    git_repo_url: 'https://github.com/test/repo.git',
    ...overrides,
  };
}

function ti(sessionRows: any[]): CanonicalInsightInput {
  return { sessionRows, granularity: 'month' } as any;
}

// ============================================================
// #1: AI-INTENSITY COHORT ANALYSIS — CLAUDE CODE GENERALIZATION
// ============================================================
describe('CR-X 1A.6B #1: AI-intensity cohort analysis — Claude Code generalization', () => {
  it('emits a Claude Code cohort instance using session duration (not active coding)', () => {
    // Claude Code sessions: active_coding_duration_ms = 0 (not instrumented)
    // ai_burst_count varies to create 4 cohorts
    const sessions: any[] = [];
    // zero-signal: 60 sessions, 3.8 min duration
    for (let i = 0; i < 60; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 0, session_has_ai_activity: false,
      duration_ms: 228000, session_duration_minutes: 3.8, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));
    // low: 15 sessions, 18 min duration
    for (let i = 0; i < 15; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 2, session_has_ai_activity: true,
      duration_ms: 1080000, session_duration_minutes: 18, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));
    // medium: 12 sessions, 51 min duration
    for (let i = 0; i < 12; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 7, session_has_ai_activity: true,
      duration_ms: 3060000, session_duration_minutes: 51, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));
    // high: 30 sessions, 285 min duration
    for (let i = 0; i < 30; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 20, session_has_ai_activity: true,
      duration_ms: 17100000, session_duration_minutes: 285, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));

    const result = generateAIIntensityCohortAnalysis(ti(sessions));
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);

    const ccInstance = result!.find(r => r.id.includes('claude_code'));
    expect(ccInstance).toBeDefined();
    expect(ccInstance!.hasData).toBe(true);
    expect(ccInstance!.isDiagnostic).not.toBe(true);

    // Title must use "non-AI sessions" as the customer-language baseline
    expect(ccInstance!.title).toContain('non-AI sessions');

    // Must use duration values, not active coding
    expect(ccInstance!.title).toContain('285');
    expect(ccInstance!.title).toContain('4'); // ~3.8 rounds to 4

    // Must NOT contain focus ratio language
    expect(ccInstance!.description).not.toMatch(/focus ratio/i);
    expect(ccInstance!.metricDefinition).toContain('duration');
  });

  it('preserves existing VS Code cohort behavior (active-coding/focus-based)', () => {
    const sessions: any[] = [];
    // non-AI: 60 sessions
    for (let i = 0; i < 60; i++) sessions.push(mkSession({
      tool: 'vscode', ai_burst_count: 0, session_has_ai_activity: false,
      session_active_coding_duration_minutes: 2, session_duration_minutes: 10,
    }));
    // low: 15 sessions
    for (let i = 0; i < 15; i++) sessions.push(mkSession({
      tool: 'vscode', ai_burst_count: 2, session_has_ai_activity: true,
      session_active_coding_duration_minutes: 4, session_duration_minutes: 12,
    }));
    // medium: 15 sessions
    for (let i = 0; i < 15; i++) sessions.push(mkSession({
      tool: 'vscode', ai_burst_count: 7, session_has_ai_activity: true,
      session_active_coding_duration_minutes: 6, session_duration_minutes: 15,
    }));
    // high: 30 sessions
    for (let i = 0; i < 30; i++) sessions.push(mkSession({
      tool: 'vscode', ai_burst_count: 20, session_has_ai_activity: true,
      session_active_coding_duration_minutes: 8, session_duration_minutes: 20,
    }));

    const result = generateAIIntensityCohortAnalysis(ti(sessions));
    const vsInstance = result!.find(r => r.id.includes('vscode'));
    expect(vsInstance).toBeDefined();

    // VS Code must still use "non-AI sessions" and focus ratio language
    expect(vsInstance!.title).toContain('non-AI sessions');
    expect(vsInstance!.title).toContain('focus ratio');
    expect(vsInstance!.metricDefinition).toContain('Active coding');
  });

  it('Claude Code cohort exposes cohort denominators', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 60; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 0, session_has_ai_activity: false,
      duration_ms: 228000, session_duration_minutes: 3.8, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));
    for (let i = 0; i < 15; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 2, session_has_ai_activity: true,
      duration_ms: 1080000, session_duration_minutes: 18, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));
    for (let i = 0; i < 12; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 7, session_has_ai_activity: true,
      duration_ms: 3060000, session_duration_minutes: 51, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));
    for (let i = 0; i < 30; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 20, session_has_ai_activity: true,
      duration_ms: 17100000, session_duration_minutes: 285, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));

    const result = generateAIIntensityCohortAnalysis(ti(sessions));
    const ccInstance = result!.find(r => r.id.includes('claude_code'));
    expect(ccInstance).toBeDefined();

    // Cohort field must contain per-cohort counts
    expect(ccInstance!.cohort).toContain('60');
    expect(ccInstance!.cohort).toContain('30');
    expect(ccInstance!.n).toBe(117); // 60+15+12+30

    // Evidence must contain per-cohort N
    for (const ev of ccInstance!.evidence) {
      expect(ev.metric).toMatch(/N=\d+/);
    }
  });

  it('does NOT emit a Claude Code within-workflow-ai-effect instance', () => {
    // This test verifies the directive: no Claude binary within-workflow-ai-effect.
    // The within-workflow-ai-effect generator still excludes Claude Code.
    // We verify by checking that the registry family exists but Claude Code
    // is not in its output.
    const sessions: any[] = [];
    for (let i = 0; i < 30; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 0, session_has_ai_activity: false,
      duration_ms: 228000, session_duration_minutes: 3.8, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));
    for (let i = 0; i < 30; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 10, session_has_ai_activity: true,
      duration_ms: 5340000, session_duration_minutes: 89, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));

    const result = generateWithinWorkflowAIEffect(ti(sessions));
    if (result && Array.isArray(result)) {
      const ccInstance = result.find(r => r.id.includes('claude_code'));
      expect(ccInstance).toBeUndefined();
    } else if (result) {
      expect(result.id).not.toContain('claude_code');
    }
    // null is acceptable (no eligible workflows)
  });
});

// ============================================================
// #2: WORKFLOW-SESSION-DISTRIBUTION PI FAMILY
// ============================================================
describe('CR-X 1A.6B #2: workflow-session-distribution PI family', () => {
  it('qualifies a workflow with materially skewed duration distribution', () => {
    // 100 sessions: 80 short (5min), 20 long (600min)
    // p50 = 5, p90 = 600, p90/p50 = 120x >> 5x threshold
    const sessions: any[] = [];
    for (let i = 0; i < 80; i++) sessions.push(mkSession({
      tool: 'claude_code', session_duration_minutes: 5, duration_ms: 300000,
    }));
    for (let i = 0; i < 20; i++) sessions.push(mkSession({
      tool: 'claude_code', session_duration_minutes: 600, duration_ms: 36000000,
    }));

    const result = generateWorkflowSessionDistribution(ti(sessions));
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBeGreaterThanOrEqual(1);

    const instance = result![0];
    expect(instance.id).toContain('workflow-session-distribution');
    expect(instance.id).toContain('claude_code');
    expect(instance.hasData).toBe(true);
    expect(instance.isDiagnostic).not.toBe(true);

    // Title must mention the p90 duration
    expect(instance.title).toMatch(/10.*hours/); // 600min = 10h

    // Evidence must include p50, p90, p90/p50, >4h, >8h
    const metrics = instance.evidence.map(e => e.metric);
    expect(metrics.some(m => m.includes('p50'))).toBe(true);
    expect(metrics.some(m => m.includes('p90'))).toBe(true);
    expect(metrics.some(m => m.includes('p90/p50'))).toBe(true);
    expect(metrics.some(m => m.includes('>4h'))).toBe(true);
    expect(metrics.some(m => m.includes('>8h'))).toBe(true);

    // Must not claim productivity (disclaimer "not productivity" is acceptable)
    expect(instance.description).not.toMatch(/improves? productivity|increases? productivity|productivity gain/i);
    expect(instance.description).toMatch(/not productivity/i); // Must include disclaimer
    expect(instance.recommendation).toMatch(/autonomous|complexity|unattended/i);
  });

  it('does NOT qualify a workflow with normal distribution (p90/p50 < 5x)', () => {
    // 100 sessions: all similar duration (10-13min)
    // p50 = ~11, p90 = ~13, p90/p50 < 2x
    const sessions: any[] = [];
    for (let i = 0; i < 100; i++) sessions.push(mkSession({
      tool: 'vscode', session_duration_minutes: 10 + (i % 4), duration_ms: (10 + (i % 4)) * 60000,
    }));

    const result = generateWorkflowSessionDistribution(ti(sessions));
    // Should return null (no materially skewed workflow)
    expect(result).toBeNull();
  });

  it('does NOT qualify a workflow with insufficient sample size (< 50)', () => {
    // 30 sessions with extreme skew, but N < 50
    const sessions: any[] = [];
    for (let i = 0; i < 25; i++) sessions.push(mkSession({
      tool: 'cursor', session_duration_minutes: 5, duration_ms: 300000,
    }));
    for (let i = 0; i < 5; i++) sessions.push(mkSession({
      tool: 'cursor', session_duration_minutes: 600, duration_ms: 36000000,
    }));

    const result = generateWorkflowSessionDistribution(ti(sessions));
    expect(result).toBeNull();
  });

  it('is registered as a runtime instance family', () => {
    const resolved = resolveCanonicalFamilyId('workflow-session-distribution__claude_code');
    expect(resolved).toBe('workflow-session-distribution');
  });

  it('is mapped to within_workflow_ai diversity family', () => {
    const family = resolveFamilyForDiversity('workflow-session-distribution__claude_code');
    expect(family).toBe('within_workflow_ai');
  });

  it('percentile math is correct — normal distribution does not qualify', () => {
    // 100 sessions: 50 at 10min, 50 at 100min
    // sorted: [10,10,...(50x),100,100,...(50x)]
    // p50 index = 49.5, lo=49 (10), hi=50 (100) → 10 + (100-10)*0.5 = 55
    // p90 index = 89.1, lo=89 (100), hi=90 (100) → 100
    // p90/p50 = 100/55 ≈ 1.8x < 5x → should NOT qualify → null
    const sessions: any[] = [];
    for (let i = 0; i < 50; i++) sessions.push(mkSession({
      tool: 'claude_code', session_duration_minutes: 10, duration_ms: 600000,
    }));
    for (let i = 0; i < 50; i++) sessions.push(mkSession({
      tool: 'claude_code', session_duration_minutes: 100, duration_ms: 6000000,
    }));

    const result = generateWorkflowSessionDistribution(ti(sessions));
    expect(result).toBeNull();
  });
});

// ============================================================
// #3: REPOSITORY CONCENTRATION NORMALIZATION
// ============================================================
describe('CR-X 1A.6B #3: repository concentration normalization', () => {
  it('normalizeRepoUrl collapses HTTPS vs SSH aliases', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo.git')).toBe('owner/repo');
    expect(normalizeRepoUrl('git@github.com:owner/repo.git')).toBe('owner/repo');
    expect(normalizeRepoUrl('https://github.com/owner/repo')).toBe('owner/repo');
  });

  it('normalizeRepoUrl collapses HTTPS username variants', () => {
    expect(normalizeRepoUrl('https://user@github.com/owner/repo.git')).toBe('owner/repo');
    expect(normalizeRepoUrl('https://brucen-pdc@github.com/prioritydispatch/proqa-backend.git'))
      .toBe('prioritydispatch/proqa-backend');
  });

  it('normalizeRepoUrl handles .git suffix', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo.git')).toBe('owner/repo');
    expect(normalizeRepoUrl('https://github.com/owner/repo')).toBe('owner/repo');
  });

  it('normalizeRepoUrl handles Azure DevOps URLs', () => {
    expect(normalizeRepoUrl('https://user@dev.azure.com/org/project/_git/repo'))
      .toBe('azure:org/repo');
  });

  it('normalizeRepoUrl handles SCP-style without user', () => {
    expect(normalizeRepoUrl('host:owner/repo.git')).toBe('owner/repo');
  });

  it('normalizeRepoUrl returns null for empty/invalid', () => {
    expect(normalizeRepoUrl(null)).toBeNull();
    expect(normalizeRepoUrl('')).toBeNull();
    expect(normalizeRepoUrl(undefined)).toBeNull();
  });

  it('collapses alias groups in repository concentration', () => {
    // Simulate Ed-like alias pattern for proqa-backend
    const sessions: any[] = [];
    // 50 sessions via https
    for (let i = 0; i < 50; i++) sessions.push(mkSession({
      git_repo_url: 'https://github.com/pd/proqa-backend.git',
    }));
    // 30 sessions via https with user
    for (let i = 0; i < 30; i++) sessions.push(mkSession({
      git_repo_url: 'https://brucen-pdc@github.com/pd/proqa-backend.git',
    }));
    // 20 sessions via ssh
    for (let i = 0; i < 20; i++) sessions.push(mkSession({
      git_repo_url: 'git@github.com:pd/proqa-backend.git',
    }));
    // 40 sessions in another repo
    for (let i = 0; i < 40; i++) sessions.push(mkSession({
      git_repo_url: 'https://github.com/pd/proqa-frontend.git',
    }));

    const result = generateRepositoryConcentration(ti(sessions));
    expect(result).not.toBeNull();
    expect(result!.hasData).toBe(true);

    // All 100 proqa-backend sessions should be counted as one repo
    // Total repos = 2 (not 4)
    // Top-2 share = 100% (both repos)
    expect(result!.description).toContain('2 repos');
    // proqa-backend should have 100 sessions, not split across aliases
    expect(result!.description).toContain('100');
  });

  it('normalized distinct repo count is correct', () => {
    const sessions: any[] = [];
    // 3 URL aliases for same repo + 2 other repos = 3 distinct repos
    for (let i = 0; i < 20; i++) sessions.push(mkSession({
      git_repo_url: 'https://github.com/org/repo-a.git',
    }));
    for (let i = 0; i < 15; i++) sessions.push(mkSession({
      git_repo_url: 'git@github.com:org/repo-a.git',
    }));
    for (let i = 0; i < 10; i++) sessions.push(mkSession({
      git_repo_url: 'https://user@github.com/org/repo-a.git',
    }));
    for (let i = 0; i < 25; i++) sessions.push(mkSession({
      git_repo_url: 'https://github.com/org/repo-b.git',
    }));
    for (let i = 0; i < 5; i++) sessions.push(mkSession({
      git_repo_url: 'https://github.com/org/repo-c.git',
    }));

    const result = generateRepositoryConcentration(ti(sessions));
    expect(result).not.toBeNull();
    // 3 distinct repos after normalization (not 5 raw URLs)
    expect(result!.description).toContain('3 repos');
  });
});

// ============================================================
// FROZEN PROVENANCE GATES
// ============================================================
describe('CR-X 1A.6B: frozen provenance gates', () => {
  it('workflow-session-distribution does not reference commit/TTFC evidence', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 80; i++) sessions.push(mkSession({
      tool: 'claude_code', session_duration_minutes: 5, duration_ms: 300000,
    }));
    for (let i = 0; i < 20; i++) sessions.push(mkSession({
      tool: 'claude_code', session_duration_minutes: 600, duration_ms: 36000000,
    }));

    const result = generateWorkflowSessionDistribution(ti(sessions));
    expect(result).not.toBeNull();
    const inst = result![0];
    expect(inst.description).not.toMatch(/commit|TTFC|time.to.first.commit/i);
    expect(inst.recommendation).not.toMatch(/commit|TTFC|time.to.first.commit/i);
  });

  it('Claude Code cohort does not reference commit/TTFC evidence', () => {
    const sessions: any[] = [];
    for (let i = 0; i < 60; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 0, session_has_ai_activity: false,
      duration_ms: 228000, session_duration_minutes: 3.8, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));
    for (let i = 0; i < 15; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 2, session_has_ai_activity: true,
      duration_ms: 1080000, session_duration_minutes: 18, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));
    for (let i = 0; i < 12; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 7, session_has_ai_activity: true,
      duration_ms: 3060000, session_duration_minutes: 51, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));
    for (let i = 0; i < 30; i++) sessions.push(mkSession({
      tool: 'claude_code', ai_burst_count: 20, session_has_ai_activity: true,
      duration_ms: 17100000, session_duration_minutes: 285, active_coding_duration_ms: 0,
      session_active_coding_duration_minutes: 0,
    }));

    const result = generateAIIntensityCohortAnalysis(ti(sessions));
    const ccInstance = result!.find(r => r.id.includes('claude_code'));
    expect(ccInstance).toBeDefined();
    expect(ccInstance!.description).not.toMatch(/commit|TTFC|time.to.first.commit/i);
  });
});
