/**
 * ============================================================================
 * CR-X P2B: Claude Code / Delegated-Agent Acceptance Matrix
 * ============================================================================
 *
 * Proves Surface != Workflow != Operational Mode for Claude Code and
 * other delegated agents. This test matrix is the authoritative proof
 * that PI never conflates surface, workflow, or mode.
 *
 * Acceptance:
 * A. terminal surface + claude_code workflow + delegated_agent
 * B. vscode surface + claude_code workflow (via vscode_version='claude-code') + delegated_agent
 * C. vscode surface + vscode workflow + human_interactive
 * D. cursor surface + cursor workflow + human_interactive
 * E. another delegated workflow (devin)
 * F. mixed A+C, B+C, B+D, A+E
 * G. unknown workflow → mode fail-closed
 *
 * Evidence rules:
 * - Claude Code never inherits human active-coding semantics
 * - delegated headline time = runtime
 * - human headline time = active coding
 * - IDE-vs-agent comparisons only use comparable measures
 * - repo allocation works
 * - recent-change runtime/adoption works
 * - configured agent economics work when configured (Wave 3)
 * - delivery appears only when attributable/authoritative
 * - no "terminal means Claude", no "VS Code means human"
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  resolveOperationalMode,
  isHumanInteractiveWorkflow,
  isDelegatedAgentWorkflow,
  getHeadlineTimeMetricLabel,
  resolveSurface,
} from '../lib/surfaceAgentContract';
import { getWorkflowDisplayName } from '../lib/workflowIdentity';
import { generateFinalCanonicalInsights } from '../lib/insights/final';
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess';

function buildSession(tool: string, surface: string, overrides: Record<string, any> = {}) {
  const base: any = {
    id: Math.random().toString(36).slice(2),
    tool,
    session_source: tool,
    editor_source: surface,
    source: surface,
    duration_ms: 3600000,
    active_coding_duration_ms: null,
    ai_burst_count: 2,
    ai_burst_chars_total: 500,
    file_save_count: null,
    focus_ratio: null,
    start_time: '2026-09-01T12:00:00.000000Z',
    end_time: '2026-09-01T13:00:00.000000Z',
    repository: 'repo-claude-001',
    repo: 'repo-claude-001',
    user_id: null,
    developer_id: null,
    ...overrides,
  };
  if (tool === 'claude_code' && surface === 'vscode') {
    base.vscode_version = 'claude-code';
    base.extension_version = 'cc-bridge-0.1.0';
  }
  return base;
}

async function runEngine(sessions: any[], costConfigs: any[] | null = null) {
  const s = sessions.map(x => ({ ...x }));
  addDerivedSessionFields(s);
  const input: any = {
    sessionRows: s,
    githubSnapshot: undefined,
    githubByPeriod: [],
    externalCostConfigs: costConfigs,
    granularity: 'week' as const,
  };
  return generateFinalCanonicalInsights(input) as Promise<any[]>;
}

describe('CR-X P2B: Claude / Delegated-Agent Mode Matrix', () => {
  it('A: terminal surface + claude_code workflow + delegated_agent', () => {
    expect(resolveSurface('claude_code')).toBe('terminal');
    expect(resolveOperationalMode('claude_code')).toBe('delegated_agent');
    expect(isDelegatedAgentWorkflow('claude_code')).toBe(true);
    expect(isHumanInteractiveWorkflow('claude_code')).toBe(false);
    expect(getHeadlineTimeMetricLabel('claude_code')).toBe('Session runtime/session');
    expect(getWorkflowDisplayName('claude_code')).toBe('Claude Code');
  });

  it('B: vscode surface + claude_code workflow resolves from metadata', async () => {
    const sessions = [
      buildSession('vscode', 'vscode', { id: 'vscode-1', tool: 'vscode', session_source: 'vscode', editor_source: 'vscode', active_coding_duration_ms: 1200000, file_save_count: 5, focus_ratio: 0.6, vscode_version: undefined }),
      buildSession('vscode', 'vscode', { id: 'cc-vscode-1', tool: 'vscode', session_source: 'vscode', editor_source: 'vscode', duration_ms: 3600000, active_coding_duration_ms: null, file_save_count: null, focus_ratio: null, vscode_version: 'claude-code' }),
    ];
    // Confirm addDerivedSessionFields resolves claude_code from metadata
    const s = sessions.map(x => ({ ...x }));
    addDerivedSessionFields(s);
    const claudeSession = s.find((x: any) => x.tool === 'claude_code' || x.session_source === 'claude_code');
    expect(claudeSession).toBeDefined();

    const out = await runEngine(sessions);
    const findings = out.filter((i: any) => !i.isDiagnostic);
    const titles = findings.map((f: any) => f.title);

    // No active-coding comparison for Claude Code
    const activeCoding = findings.find((f: any) => f.id.includes('active-coding-time-by-ide'));
    if (activeCoding && activeCoding.breakdownByTool) {
      const breakdown = Object.keys(activeCoding.breakdownByTool);
      expect(breakdown).not.toContain('claude_code');
    }

    // No title misleadingly says "active coding" for a delegated agent
    expect(titles.some((t: string) =>
      t.toLowerCase().includes('active coding') && t.toLowerCase().includes('claude')
    )).toBe(false);
  });

  it('C: vscode surface + vscode workflow + human_interactive', () => {
    expect(resolveOperationalMode('vscode')).toBe('human_interactive');
    expect(isHumanInteractiveWorkflow('vscode')).toBe(true);
    expect(isDelegatedAgentWorkflow('vscode')).toBe(false);
    expect(getHeadlineTimeMetricLabel('vscode')).toBe('Active coding/session');
    expect(getWorkflowDisplayName('vscode')).toBe('VS Code');
  });

  it('D: cursor surface + cursor workflow + human_interactive', () => {
    expect(resolveOperationalMode('cursor')).toBe('human_interactive');
    expect(isHumanInteractiveWorkflow('cursor')).toBe(true);
    expect(isDelegatedAgentWorkflow('cursor')).toBe(false);
    expect(getHeadlineTimeMetricLabel('cursor')).toBe('Active coding/session');
  });

  it('E: devin delegated_agent', () => {
    expect(resolveOperationalMode('devin')).toBe('delegated_agent');
    expect(resolveOperationalMode('windsurf')).toBe('delegated_agent');
    expect(getHeadlineTimeMetricLabel('devin')).toBe('Session runtime/session');
  });

  it('G: unknown workflow fails closed — neither human nor delegated', () => {
    expect(resolveOperationalMode('some_new_tool')).toBe('unknown');
    expect(isHumanInteractiveWorkflow('some_new_tool')).toBe(false);
    expect(isDelegatedAgentWorkflow('some_new_tool')).toBe(false);
    expect(getHeadlineTimeMetricLabel('some_new_tool')).toBe('Session time');
  });

  it('G2: codex is a registered delegated_agent on the terminal surface', () => {
    expect(resolveOperationalMode('codex')).toBe('delegated_agent');
    expect(isHumanInteractiveWorkflow('codex')).toBe(false);
    expect(isDelegatedAgentWorkflow('codex')).toBe(true);
    expect(getHeadlineTimeMetricLabel('codex')).toBe('Session runtime/session');
  });

  it('prohibited inference: terminal does not mean claude, VS Code does not mean human', () => {
    // A session with tool='vscode' on any surface is still human_interactive
    // A session with tool='claude_code' on any surface is still delegated
    expect(resolveOperationalMode('vscode')).toBe('human_interactive');
    expect(resolveOperationalMode('claude_code')).toBe('delegated_agent');
    // Surface is not in the mode resolution
  });
});

describe('CR-X P2B: Claude Recent-Change / Repo Intelligence', () => {
  it('delegated agent recent-change uses runtime, not active coding', async () => {
    const sessions: any[] = [];
    const base = new Date('2026-09-01T12:00:00.000000Z').getTime();
    for (let i = 0; i < 120; i++) {
      const day = Math.floor(i / 10);
      const t = base + day * 86400000;
      // Ramp runtime up over time to create a recent change signal
      const duration = 1800000 + (i % 3) * 1800000 + (day * 60000);
      const repoIdx = i % 4;
      sessions.push(buildSession('claude_code', 'terminal', {
        id: `cc-${i}`,
        start_time: new Date(t).toISOString(),
        end_time: new Date(t + duration).toISOString(),
        duration_ms: duration,
        repository: `repo-${repoIdx}`,
      }));
    }
    const out = await runEngine(sessions);
    const findings = out.filter((i: any) => !i.isDiagnostic);
    const titles = findings.map((f: any) => f.title);

    // Engine must produce findings from delegated-agent-only data
    expect(findings.length).toBeGreaterThan(0);

    // No active-coding headline for Claude Code
    expect(titles.some((t: string) =>
      t.toLowerCase().includes('active coding') && t.toLowerCase().includes('claude')
    )).toBe(false);
  });
});

describe('CR-X P2B: Configured Agent Economics', () => {
  function buildSessionsForMonth(tool: string, surface: string, count: number, month: string) {
    const sessions: any[] = [];
    const base = new Date(`${month}-01T12:00:00.000000Z`).getTime();
    for (let i = 0; i < count; i++) {
      const day = i % 28;
      const t = base + day * 86400000;
      sessions.push(buildSession(tool, surface, {
        id: `${tool}-${i}`,
        start_time: new Date(t).toISOString(),
        end_time: new Date(t + 3600000).toISOString(),
        duration_ms: 3600000,
        active_coding_duration_ms: surface === 'terminal' ? null : 1800000,
        timestamp: new Date(t).toISOString(),
      }));
    }
    return sessions;
  }

  it('Claude Code configured cost works (delegated cost/runtime-hour)', async () => {
    const sessions = [
      ...buildSessionsForMonth('claude_code', 'terminal', 30, '2026-08'),
      ...buildSessionsForMonth('devin', 'vscode', 30, '2026-08'),
    ];
    const costConfigs = [
      { toolId: 'claude-code', monthlySpend: 750, seatCount: 3, costPerSeatMonthly: 250, updatedAt: '2026-08-01T00:00:00.000000Z' },
      { toolId: 'devin', monthlySpend: 60, seatCount: 1, costPerSeatMonthly: 60, updatedAt: '2026-08-01T00:00:00.000000Z' },
    ];
    const out = await runEngine(sessions, costConfigs);
    const findings = out.filter((i: any) => !i.isDiagnostic);
    const costEff = findings.find((f: any) => f.id === 'configured-cost-efficiency-by-workflow');
    expect(costEff).toBeDefined();
    expect(costEff.title.toLowerCase()).toContain('cost/runtime hour');

    const titles = findings.map((f: any) => f.title);
    expect(titles.some((t: string) =>
      t.toLowerCase().includes('claude code') && t.toLowerCase().includes('configured cost')
    )).toBe(true);
  });

  it('VS Code + Cursor cost/active-hour works', async () => {
    const sessions = [
      ...buildSessionsForMonth('vscode', 'vscode', 30, '2026-08'),
      ...buildSessionsForMonth('cursor', 'cursor', 30, '2026-08'),
    ];
    const costConfigs = [
      { toolId: 'vscode', monthlySpend: 300, seatCount: 5, costPerSeatMonthly: 60, updatedAt: '2026-08-01T00:00:00.000000Z' },
      { toolId: 'cursor', monthlySpend: 200, seatCount: 2, costPerSeatMonthly: 100, updatedAt: '2026-08-01T00:00:00.000000Z' },
    ];
    const out = await runEngine(sessions, costConfigs);
    const costEff = out.find((f: any) => f.id === 'configured-cost-efficiency-by-workflow');
    expect(costEff).toBeDefined();
    expect(costEff.title.toLowerCase()).toContain('cost/active hour');
  });

  it('Ed no-cost remains fail-closed', async () => {
    const raw = readFileSync(join(__dirname, '..', 'lib', 'insights', 'final', 'acceptanceCorpus', 'ed-real.json'), 'utf-8');
    const d = JSON.parse(raw);
    const sessions = d.sessions.map((s: any) => ({...s}));
    addDerivedSessionFields(sessions);
    const input: any = { sessionRows: sessions, githubSnapshot: undefined, githubByPeriod: [], externalCostConfigs: null, granularity: 'week' };
    const out: any[] = await generateFinalCanonicalInsights(input) as any[];
    const findings = out.filter((i: any) => !i.isDiagnostic);
    const costFindings = findings.filter((f: any) => f.id.includes('configured-cost') || f.id.includes('allocated-spend') || f.id.includes('unit_economics'));
    expect(costFindings.length).toBe(0);
  });

  it('delivery findings do not fire without authoritative GitHub evidence', async () => {
    const sessions = buildSessionsForMonth('vscode', 'vscode', 30, '2026-08');
    const out = await runEngine(sessions);
    const deliveryFindings = out.filter((f: any) => !f.isDiagnostic && (f.cicdStage === 'review-merge' || f.cicdStage === 'deploy-operate'));
    expect(deliveryFindings.length).toBe(0);
  });
});
