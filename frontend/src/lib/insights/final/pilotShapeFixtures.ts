/**
 * ============================================================================
 * CR-X P1B.2 — Progressive-Value Pilot Shape Fixtures
 * ============================================================================
 *
 * Deterministic DATA-SHAPE fixtures representing real engineering organizations
 * at different maturity points. These are the architectural acceptance matrix
 * for proving useful intelligence appears progressively as evidence arrives.
 *
 * NOT product demo data. NOT synthetic stress data. These are minimal
 * truthful shapes that exercise the PI engine's value-accrual contract.
 *
 * Shapes (from P1B.2 authority):
 *   A. EARLY_SINGLE_WORKFLOW   — 5-10 devs, 1 workflow, 3-5 days, telemetry only
 *   B. MATURE_SINGLE_WORKFLOW  — ~15 devs, 1 dominant workflow, weeks/months, no cost/delivery
 *   C. EARLY_MULTI_WORKFLOW    — 25-50 devs, several workflows, ~5 days, uneven adoption
 *   D. MATURE_MULTI_WORKFLOW   — multiple mature workflows, long history, repo attribution, cost, optional delivery
 *   E. AGENT_HEAVY             — delegated agents + IDE workflows
 *
 * Each fixture returns CanonicalInsightInput-shaped sessionRows that have
 * ALREADY been through addDerivedSessionFields (focus_ratio, session_duration_minutes,
 * session_active_coding_duration_minutes, ai_intensity_band derived). This
 * mirrors the real pipeline: dataAccess fetches → addDerivedSessionFields → generators.
 *
 * Field contract per workflow mode (from surfaceAgentContract):
 *   human_interactive (vscode, cursor, github_copilot):
 *     duration_ms, active_coding_duration_ms, focus_ratio, file_save_count,
 *     ai_burst_count, ai_usage_duration_ms, time_to_first_commit_ms
 *     session_commits = unavailable (null)
 *   delegated_agent (devin, claude_code):
 *     duration_ms, ai_burst_count, ai_usage_duration_ms, session_commits,
 *     time_to_first_commit_ms, chars_added_total, lines_added_total
 *     active_coding_duration_ms = unavailable (deleted)
 *     focus_ratio = unavailable (deleted)
 *     file_save_count = unavailable (deleted)
 * ============================================================================
 */

import type { CanonicalInsightInput } from './types';

// ── Session row builder helpers ──────────────────────────────────────────────

interface SessionSpec {
  tool: string;
  user_id: string;
  timestamp: string; // ISO
  duration_ms: number;
  active_coding_duration_ms?: number | null; // null for delegated agents
  ai_burst_count?: number;
  ai_usage_duration_ms?: number;
  file_save_count?: number | null;
  focus_ratio?: number | null;
  session_commits?: number | null;
  time_to_first_commit_ms?: number | null;
  chars_added_total?: number | null;
  lines_added_total?: number | null;
  git_repo_url?: string | null;
  git_branch?: string | null;
  session_has_commit_outcome?: boolean;
  vscode_version?: string | null; // CR-X FINAL: Claude Code-under-VS-Code metadata
  extension_version?: string | null;
}

function buildSession(spec: SessionSpec): Record<string, unknown> {
  const isDelegated = spec.tool === 'devin' || spec.tool === 'claude_code';
  const row: Record<string, unknown> = {
    session_id: `sess-${spec.tool}-${spec.user_id}-${spec.timestamp}`,
    tool: spec.tool,
    session_source: spec.tool,
    editor_source: spec.tool,
    timestamp: spec.timestamp,
    duration_ms: spec.duration_ms,
    user_id: spec.user_id,
    git_repo_url: spec.git_repo_url ?? null,
    git_branch: spec.git_branch ?? 'main',
    ai_burst_count: spec.ai_burst_count ?? 0,
    ai_usage_duration_ms: spec.ai_usage_duration_ms ?? 0,
    time_to_first_commit_ms: spec.time_to_first_commit_ms ?? null,
    session_has_commit_outcome: spec.session_has_commit_outcome ?? false,
    vscode_version: spec.vscode_version ?? null,
    extension_version: spec.extension_version ?? null,
  };

  // Mode-aware field population (mirrors addDerivedSessionFields contract gating)
  if (isDelegated) {
    // Delegated agents: active_coding/focus/file_save are unavailable → deleted
    row.active_coding_duration_ms = undefined;
    row.focus_ratio = undefined;
    row.file_save_count = undefined;
    row.session_commits = spec.session_commits ?? null;
    row.chars_added_total = spec.chars_added_total ?? null;
    row.lines_added_total = spec.lines_added_total ?? null;
  } else {
    // Human-interactive IDE: active_coding/focus/file_save observed
    row.active_coding_duration_ms = spec.active_coding_duration_ms ?? 0;
    row.file_save_count = spec.file_save_count ?? 0;
    row.session_commits = null; // VS Code does not observe commits
    row.chars_added_total = null;
    row.lines_added_total = null;
  }

  // Derived fields (mirrors addDerivedSessionFields output)
  if (typeof row.duration_ms === 'number' && row.duration_ms > 0) {
    row.session_duration_minutes = row.duration_ms / 60000;
  }
  if (!isDelegated && typeof row.active_coding_duration_ms === 'number') {
    row.session_active_coding_duration_minutes = (row.active_coding_duration_ms as number) / 60000;
    if (row.session_duration_minutes && (row.session_duration_minutes as number) > 0) {
      row.focus_ratio = (row.session_active_coding_duration_minutes as number) / (row.session_duration_minutes as number);
    }
  }

  // ai_intensity_band derivation (mirrors addDerivedSessionFields)
  if (typeof row.ai_burst_count === 'number' && typeof row.session_duration_minutes === 'number') {
    const burstsPerMin = (row.ai_burst_count as number) / (row.session_duration_minutes as number);
    if (burstsPerMin > 0.5) row.ai_intensity_band = 'high';
    else if (burstsPerMin > 0.2) row.ai_intensity_band = 'medium';
    else if ((row.ai_burst_count as number) > 0) row.ai_intensity_band = 'low';
    else row.ai_intensity_band = 'none';
  }

  return row;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function daysAgoISO(days: number, hour = 11): string {
  // Fixed reference: 2026-09-13T11:00:00Z (the "today" of the fixture matrix)
  const ref = new Date('2026-09-13T11:00:00.000Z').getTime();
  return new Date(ref - days * 86400000 + hour * 3600000).toISOString();
}

function dateOnlyDaysAgo(days: number): string {
  return daysAgoISO(days, 0).split('T')[0];
}

// ── SHAPE A: EARLY_SINGLE_WORKFLOW ──────────────────────────────────────────

/**
 * 7 developers, 1 workflow (vscode), 4 days, telemetry only.
 * Expected: useful baseline/cohort/repo/adoption intelligence.
 * Expected: NO fake longitudinal claim, NO cross-workflow claim.
 */
export function shapeA_EarlySingleWorkflow(): CanonicalInsightInput {
  const sessions: Record<string, unknown>[] = [];
  const devs = ['dev-1', 'dev-2', 'dev-3', 'dev-4', 'dev-5', 'dev-6', 'dev-7'];
  const repos = [
    'https://github.com/org/web-frontend',
    'https://github.com/org/api-backend',
    'https://github.com/org/data-svc',
  ];
  // 4 days, ~3 sessions/dev/day = ~84 sessions
  for (let d = 0; d < 4; d++) {
    for (const dev of devs) {
      const sessionsPerDay = 2 + (d % 2); // 2-3
      for (let s = 0; s < sessionsPerDay; s++) {
        const repo = repos[(d + s) % repos.length];
        const durMin = 25 + ((d + s) * 7) % 50; // 25-74 min
        const acMin = durMin * (0.4 + ((d + s) % 5) * 0.08); // 40-72% focus
        const aiBursts = s === 0 ? 3 + (d % 4) : (d % 3);
        sessions.push(buildSession({
          tool: 'vscode',
          user_id: dev,
          timestamp: daysAgoISO(3 - d, 9 + s * 3),
          duration_ms: durMin * 60000,
          active_coding_duration_ms: acMin * 60000,
          ai_burst_count: aiBursts,
          ai_usage_duration_ms: aiBursts * 120000,
          file_save_count: 2 + (s * 3) % 8,
          git_repo_url: repo,
        }));
      }
    }
  }
  return { sessionRows: sessions, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' };
}

// ── SHAPE B: MATURE_SINGLE_WORKFLOW (Ed-like) ───────────────────────────────

/**
 * ~15 developers, 1 dominant workflow (vscode), 10 weeks, multiple repos,
 * no cost, no delivery. Mirrors Ed's real shape.
 * Expected: recent-change/longitudinal intelligence, within-workflow cohorts,
 *           repo intelligence. NO cross-workflow fabrication.
 */
export function shapeB_MatureSingleWorkflow(): CanonicalInsightInput {
  const sessions: Record<string, unknown>[] = [];
  const devs = Array.from({ length: 15 }, (_, i) => `cm-dev-${1000 + i}`);
  const repos = [
    'https://github.com/prioritydispatch/proqa-backend',
    'https://github.com/prioritydispatch/proqa-frontend',
    'https://github.com/prioritydispatch/admin-api',
    'https://github.com/VelociMatch/velocimatch-platform',
  ];
  // 10 weeks, ~3 sessions/dev/week = ~450 sessions
  // Recent weeks show rising AI adoption and longer sessions — a real
  // mature pilot would show some temporal evolution, not perfect uniformity.
  for (let w = 0; w < 10; w++) {
    for (let di = 0; di < devs.length; di++) {
      const dev = devs[di];
      const sessionsPerWeek = 2 + (di % 3); // 2-4
      for (let s = 0; s < sessionsPerWeek; s++) {
        const repo = repos[(di + s) % repos.length];
        // Recent weeks (w >= 7): longer sessions, more AI bursts
        const recentBoost = w >= 7 ? 1.4 : 1.0;
        const durMin = Math.round((30 + ((w + di + s) * 11) % 90) * recentBoost);
        const acMin = durMin * (0.35 + ((w + s) % 6) * 0.07);
        const aiBursts = w >= 7 ? (w + di + s) % 4 + 3 : (w + di + s) % 4;
        sessions.push(buildSession({
          tool: 'vscode',
          user_id: dev,
          timestamp: daysAgoISO((9 - w) * 7 + (s * 2), 9 + s * 3),
          duration_ms: durMin * 60000,
          active_coding_duration_ms: acMin * 60000,
          ai_burst_count: aiBursts,
          ai_usage_duration_ms: aiBursts * 150000,
          file_save_count: 1 + ((w + s) * 3) % 12,
          git_repo_url: repo,
        }));
      }
    }
  }
  return { sessionRows: sessions, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'week' };
}

// ── SHAPE C: EARLY_MULTI_WORKFLOW ───────────────────────────────────────────

/**
 * 30 developers, 4 workflows (vscode, cursor, devin, github_copilot),
 * 5 days, uneven adoption. No cost, no delivery.
 * Expected: valid cross-workflow comparisons where sample gates permit,
 *           single-workflow fallbacks for immature workflows.
 */
export function shapeC_EarlyMultiWorkflow(): CanonicalInsightInput {
  const sessions: Record<string, unknown>[] = [];
  const devs = Array.from({ length: 30 }, (_, i) => `dev-${i + 1}`);
  const repos = [
    'https://github.com/org/web-app',
    'https://github.com/org/api-svc',
    'https://github.com/org/infra',
  ];
  // 5 days. Adoption: vscode 60%, cursor 25%, devin 10%, copilot 5%
  for (let d = 0; d < 5; d++) {
    for (let di = 0; di < devs.length; di++) {
      const dev = devs[di];
      const r = (di * 7 + d) % 20;
      let tool: string;
      if (r < 12) tool = 'vscode';
      else if (r < 17) tool = 'cursor';
      else if (r < 19) tool = 'devin';
      else tool = 'github_copilot';
      const sessionsPerDay = 1 + (d % 2);
      for (let s = 0; s < sessionsPerDay; s++) {
        const repo = repos[(di + d + s) % repos.length];
        const durMin = 20 + ((di + d + s) * 9) % 70;
        const isDelegated = tool === 'devin';
        sessions.push(buildSession({
          tool,
          user_id: dev,
          timestamp: daysAgoISO(4 - d, 9 + s * 4),
          duration_ms: durMin * 60000,
          active_coding_duration_ms: isDelegated ? null : durMin * 0.5 * 60000,
          ai_burst_count: tool === 'devin' ? 5 + (d % 3) : (d + s) % 3,
          ai_usage_duration_ms: (tool === 'devin' ? 8 : 2) * 60000,
          file_save_count: isDelegated ? null : 2 + (s * 4) % 6,
          session_commits: isDelegated ? (d % 2) : null,
          time_to_first_commit_ms: isDelegated ? (10 + d * 5) * 60000 : null,
          chars_added_total: isDelegated ? 200 + d * 50 : null,
          lines_added_total: isDelegated ? 20 + d * 5 : null,
          git_repo_url: repo,
        }));
      }
    }
  }
  return { sessionRows: sessions, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'day' };
}

// ── SHAPE D: MATURE_MULTI_WORKFLOW ──────────────────────────────────────────

/**
 * Multiple mature workflows (vscode, cursor, devin), 12 weeks, repo attribution,
 * cost configured, optional delivery.
 * Expected: decision-grade workflow comparisons, economics, longitudinal migration.
 */
export function shapeD_MatureMultiWorkflow(): CanonicalInsightInput {
  const sessions: Record<string, unknown>[] = [];
  const devs = Array.from({ length: 20 }, (_, i) => `dev-${i + 1}`);
  const repos = [
    'https://github.com/org/platform',
    'https://github.com/org/payments',
    'https://github.com/org/mobile',
    'https://github.com/org/ml-infra',
  ];
  const tools = ['vscode', 'cursor', 'devin'];
  // 12 weeks, ~4 sessions/dev/week across tools = ~960 sessions
  for (let w = 0; w < 12; w++) {
    for (let di = 0; di < devs.length; di++) {
      const dev = devs[di];
      // Each dev uses 1-2 tools; adoption shifts toward cursor over time
      const toolIdx = (di + Math.floor(w / 4)) % tools.length;
      const tool = tools[toolIdx];
      const sessionsPerWeek = 3 + (di % 2);
      for (let s = 0; s < sessionsPerWeek; s++) {
        const repo = repos[(di + s) % repos.length];
        const durMin = 30 + ((w + di + s) * 13) % 100;
        const isDelegated = tool === 'devin';
        const acRatio = 0.4 + ((w + s) % 5) * 0.08;
        sessions.push(buildSession({
          tool,
          user_id: dev,
          timestamp: daysAgoISO((11 - w) * 7 + s, 9 + s * 3),
          duration_ms: durMin * 60000,
          active_coding_duration_ms: isDelegated ? null : durMin * acRatio * 60000,
          ai_burst_count: isDelegated ? 6 + (w % 4) : (w + s) % 4,
          ai_usage_duration_ms: (isDelegated ? 10 : 3) * 60000,
          file_save_count: isDelegated ? null : 2 + ((w + s) * 3) % 10,
          session_commits: isDelegated ? (w % 3) : null,
          time_to_first_commit_ms: isDelegated ? (8 + (w % 6)) * 60000 : null,
          chars_added_total: isDelegated ? 150 + w * 20 : null,
          lines_added_total: isDelegated ? 15 + w * 3 : null,
          git_repo_url: repo,
          session_has_commit_outcome: isDelegated && (w % 3) > 0,
        }));
      }
    }
  }
  return { sessionRows: sessions, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'week' };
}

// ── SHAPE E: AGENT_HEAVY ─────────────────────────────────────────────────────

/**
 * Delegated agents (devin, claude_code) + IDE workflows (vscode, cursor).
 * 8 weeks. Tests mode-aware gating: NO human-active-coding on delegated agents.
 * Expected: agent runtime semantics, valid cross-mode normalized comparisons only.
 */
export function shapeE_AgentHeavy(): CanonicalInsightInput {
  const sessions: Record<string, unknown>[] = [];
  const devs = Array.from({ length: 12 }, (_, i) => `dev-${i + 1}`);
  const repos = [
    'https://github.com/org/agent-platform',
    'https://github.com/org/agent-tools',
  ];
  const tools = ['devin', 'claude_code', 'vscode', 'cursor'];
  // 8 weeks, agent-heavy: 50% devin, 25% claude_code, 15% vscode, 10% cursor
  for (let w = 0; w < 8; w++) {
    for (let di = 0; di < devs.length; di++) {
      const dev = devs[di];
      const r = (di * 3 + w) % 20;
      let tool: string;
      if (r < 10) tool = 'devin';
      else if (r < 15) tool = 'claude_code';
      else if (r < 17) tool = 'vscode';
      else tool = 'cursor';
      const sessionsPerWeek = 2 + (di % 2);
      for (let s = 0; s < sessionsPerWeek; s++) {
        const repo = repos[(di + s) % repos.length];
        const durMin = tool === 'claude_code' ? 120 + ((w + s) * 20) % 60 : 30 + ((w + s) * 11) % 80;
        const isDelegated = tool === 'devin' || tool === 'claude_code';
        sessions.push(buildSession({
          tool,
          user_id: dev,
          timestamp: daysAgoISO((7 - w) * 7 + s, 9 + s * 3),
          duration_ms: durMin * 60000,
          active_coding_duration_ms: isDelegated ? null : durMin * 0.5 * 60000,
          ai_burst_count: isDelegated ? 8 + (w % 5) : (w + s) % 3,
          ai_usage_duration_ms: (isDelegated ? 15 : 3) * 60000,
          file_save_count: isDelegated ? null : 3 + (s * 2) % 7,
          session_commits: isDelegated ? (w % 3) + s : null,
          time_to_first_commit_ms: isDelegated ? (5 + (w % 8)) * 60000 : null,
          chars_added_total: isDelegated ? 300 + w * 30 : null,
          lines_added_total: isDelegated ? 25 + w * 4 : null,
          git_repo_url: repo,
          session_has_commit_outcome: isDelegated && (w % 2) === 0,
        }));
      }
    }
  }
  return { sessionRows: sessions, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'week' };
}

// ── SHAPE F: ED_PRIORITY_DISPATCH (Ed-shaped VS Code + Claude Code) ────────

/**
 * Ed-shaped pilot: VS Code human-interactive + Claude Code delegated-agent
 * activity encoded through the VS Code telemetry shape (vscode_version='claude-code').
 * 10 weeks, ~3k sessions. Multiple repos. Sparse/ineligible delivery evidence.
 *
 * This exercises the canonical workflow-resolution path that recognizes
 * Claude Code-under-VS-Code metadata. Grouping only by editor_source would
 * hide Claude Code and incorrectly make Ed look single-workflow.
 *
 * NO invented Devin/Cursor requirement. Ed truth is VS Code + Claude Code.
 *
 * Mode contract:
 *   VS Code sessions: tool='vscode', active_coding_duration_ms populated
 *   Claude Code sessions: tool='vscode' + vscode_version='claude-code',
 *     active_coding_duration_ms = null (delegated agent),
 *     session_commits, chars_added, lines_added populated
 */
export function shapeF_EdPriorityDispatch(): CanonicalInsightInput {
  const sessions: Record<string, unknown>[] = [];
  const devs = Array.from({ length: 20 }, (_, i) => `ed-dev-${i + 1}`);
  const repos = [
    'https://github.com/ed/priority-dispatch',
    'https://github.com/ed/dispatch-api',
    'https://github.com/ed/dispatch-web',
  ];
  // 10 weeks, ~300 sessions/week = ~3000 total
  // Ed truth: ~60% VS Code human-interactive, ~40% Claude Code (via VS Code metadata)
  for (let w = 0; w < 10; w++) {
    for (let di = 0; di < devs.length; di++) {
      const dev = devs[di];
      const r = (di * 7 + w) % 10;
      // 60% vscode human-interactive, 40% claude-code (via vscode metadata)
      const isClaudeCode = r >= 6;
      const tool = 'vscode'; // Raw editor source is always VS Code
      const sessionsPerWeek = 2 + (di % 3);
      for (let s = 0; s < sessionsPerWeek; s++) {
        const repo = repos[(di + s) % repos.length];
        const durMin = isClaudeCode
          ? 90 + ((w + s) * 17) % 80   // Claude Code: longer delegated sessions
          : 25 + ((w + s) * 7) % 60;   // VS Code: shorter interactive sessions
        sessions.push(buildSession({
          tool,
          user_id: dev,
          timestamp: daysAgoISO((9 - w) * 7 + s, 9 + s * 3),
          duration_ms: durMin * 60000,
          // Claude Code (delegated agent): active_coding unavailable
          active_coding_duration_ms: isClaudeCode ? null : durMin * 0.55 * 60000,
          ai_burst_count: isClaudeCode ? 8 + (w % 5) : (w + s) % 3,
          ai_usage_duration_ms: (isClaudeCode ? 15 : 2) * 60000,
          file_save_count: isClaudeCode ? null : 2 + ((w + s) * 3) % 8,
          session_commits: isClaudeCode ? (w % 3) + s : null,
          time_to_first_commit_ms: isClaudeCode ? (6 + (w % 7)) * 60000 : null,
          chars_added_total: isClaudeCode ? 250 + w * 25 : null,
          lines_added_total: isClaudeCode ? 22 + w * 4 : null,
          git_repo_url: repo,
          session_has_commit_outcome: isClaudeCode && (w % 2) === 0,
          // CR-X FINAL: Claude Code encoded through VS Code metadata path
          vscode_version: isClaudeCode ? 'claude-code' : null,
        }));
      }
    }
  }
  return { sessionRows: sessions, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'week' };
}

// ── SHAPE G: RYAN_DECISIONS (single-workflow, mature, decision-focused) ─────

/**
 * Ryan-shaped pilot: single dominant workflow (cursor), 12 weeks.
 * Tests mature single-workflow progressive value.
 */
export function shapeG_MatureSingleWorkflowCursor(): CanonicalInsightInput {
  const sessions: Record<string, unknown>[] = [];
  const devs = Array.from({ length: 8 }, (_, i) => `ryan-dev-${i + 1}`);
  const repos = [
    'https://github.com/ryan/decisions-core',
    'https://github.com/ryan/decisions-ui',
  ];
  for (let w = 0; w < 12; w++) {
    for (let di = 0; di < devs.length; di++) {
      const dev = devs[di];
      const sessionsPerWeek = 3 + (di % 2);
      for (let s = 0; s < sessionsPerWeek; s++) {
        const repo = repos[(di + s) % repos.length];
        const durMin = 35 + ((w + s) * 11) % 70;
        sessions.push(buildSession({
          tool: 'cursor',
          user_id: dev,
          timestamp: daysAgoISO((11 - w) * 7 + s, 10 + s * 3),
          duration_ms: durMin * 60000,
          active_coding_duration_ms: durMin * 0.6 * 60000,
          ai_burst_count: 2 + (w + s) % 5,
          ai_usage_duration_ms: 4 * 60000,
          file_save_count: 3 + ((w + s) * 2) % 9,
          session_commits: null,
          time_to_first_commit_ms: null,
          git_repo_url: repo,
        }));
      }
    }
  }
  return { sessionRows: sessions, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'week' };
}

// ── SHAPE H: KASEY_GLOO (multi-workflow + configured cost) ───────────────────

/**
 * Kasey/Gloo-shaped pilot: multi-workflow (vscode, cursor, claude_code) with
 * configured cost. 8 weeks. Tests economics without billing fabrication.
 */
export function shapeH_MultiWorkflowConfiguredCost(): CanonicalInsightInput {
  const sessions: Record<string, unknown>[] = [];
  const devs = Array.from({ length: 15 }, (_, i) => `gloo-dev-${i + 1}`);
  const repos = [
    'https://github.com/gloo/platform',
    'https://github.com/gloo/services',
    'https://github.com/gloo/infra',
  ];
  const tools = ['vscode', 'cursor', 'claude_code'];
  for (let w = 0; w < 8; w++) {
    for (let di = 0; di < devs.length; di++) {
      const dev = devs[di];
      const tool = tools[di % tools.length];
      const sessionsPerWeek = 2 + (di % 2);
      for (let s = 0; s < sessionsPerWeek; s++) {
        const repo = repos[(di + s) % repos.length];
        const isDelegated = tool === 'claude_code';
        const durMin = isDelegated ? 90 + ((w + s) * 15) % 60 : 30 + ((w + s) * 9) % 50;
        sessions.push(buildSession({
          tool,
          user_id: dev,
          timestamp: daysAgoISO((7 - w) * 7 + s, 9 + s * 3),
          duration_ms: durMin * 60000,
          active_coding_duration_ms: isDelegated ? null : durMin * 0.5 * 60000,
          ai_burst_count: isDelegated ? 7 + (w % 4) : (w + s) % 3,
          ai_usage_duration_ms: (isDelegated ? 14 : 3) * 60000,
          file_save_count: isDelegated ? null : 2 + (s * 3) % 6,
          session_commits: isDelegated ? (w % 2) + s : null,
          time_to_first_commit_ms: isDelegated ? (7 + (w % 5)) * 60000 : null,
          chars_added_total: isDelegated ? 250 + w * 20 : null,
          lines_added_total: isDelegated ? 22 + w * 3 : null,
          git_repo_url: repo,
          session_has_commit_outcome: isDelegated && s > 0,
        }));
      }
    }
  }
  return {
    sessionRows: sessions,
    githubSnapshot: undefined,
    githubByPeriod: [],
    productivityByPeriod: [],
    granularity: 'week',
    externalCostConfigs: [
      { toolId: 'vscode', monthlySpend: 400 },
      { toolId: 'cursor', monthlySpend: 200 },
      { toolId: 'claude_code', monthlySpend: 600 },
    ],
  } as any;
}

// ── SHAPE I: SYNTHETIC_SCALE (large population for pagination/scaling) ──────

/**
 * Synthetic scale pilot: ~2k sessions across 4 workflows, 12 weeks.
 * Tests that the engine scales without portfolio explosion.
 */
export function shapeI_SyntheticScale(): CanonicalInsightInput {
  const sessions: Record<string, unknown>[] = [];
  const devs = Array.from({ length: 40 }, (_, i) => `scale-dev-${i + 1}`);
  const repos = [
    'https://github.com/scale/repo-1',
    'https://github.com/scale/repo-2',
    'https://github.com/scale/repo-3',
    'https://github.com/scale/repo-4',
  ];
  const tools = ['vscode', 'cursor', 'devin', 'claude_code'];
  // 12 weeks × 40 devs × ~4 sessions/week = ~1920 sessions
  for (let w = 0; w < 12; w++) {
    for (let di = 0; di < devs.length; di++) {
      const dev = devs[di];
      const tool = tools[di % tools.length];
      const sessionsPerWeek = 4;
      for (let s = 0; s < sessionsPerWeek; s++) {
        const repo = repos[(di + s + w) % repos.length];
        const isDelegated = tool === 'devin' || tool === 'claude_code';
        const durMin = isDelegated ? 60 + ((w + s) * 17) % 80 : 25 + ((w + s) * 7) % 55;
        sessions.push(buildSession({
          tool,
          user_id: dev,
          timestamp: daysAgoISO((11 - w) * 7 + s, 9 + s * 2),
          duration_ms: durMin * 60000,
          active_coding_duration_ms: isDelegated ? null : durMin * 0.5 * 60000,
          ai_burst_count: isDelegated ? 6 + (w % 5) : (w + s) % 4,
          ai_usage_duration_ms: (isDelegated ? 13 : 3) * 60000,
          file_save_count: isDelegated ? null : 2 + ((w + s) * 3) % 8,
          session_commits: isDelegated ? (w % 3) + s : null,
          time_to_first_commit_ms: isDelegated ? (6 + (w % 6)) * 60000 : null,
          chars_added_total: isDelegated ? 220 + w * 22 : null,
          lines_added_total: isDelegated ? 21 + w * 3 : null,
          git_repo_url: repo,
          session_has_commit_outcome: isDelegated && (w % 2) === 0,
        }));
      }
    }
  }
  return { sessionRows: sessions, githubSnapshot: undefined, githubByPeriod: [], productivityByPeriod: [], granularity: 'week' };
}

// ── Fixture registry ─────────────────────────────────────────────────────────

export type PilotShapeId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';

export interface PilotShapeDescriptor {
  id: PilotShapeId;
  name: string;
  description: string;
  expectedValue: string[];
  forbidden: string[];
  build: () => CanonicalInsightInput;
}

export const PILOT_SHAPES: PilotShapeDescriptor[] = [
  {
    id: 'A',
    name: 'Early Single Workflow',
    description: '7 devs, 1 workflow (vscode), 4 days, telemetry only',
    expectedValue: [
      'useful baseline/cohort/repo/adoption intelligence',
      'within-workflow session profile',
    ],
    forbidden: ['fake longitudinal claim', 'cross-workflow claim', 'empty portfolio'],
    build: shapeA_EarlySingleWorkflow,
  },
  {
    id: 'B',
    name: 'Mature Single Workflow (Ed-like)',
    description: '15 devs, 1 dominant workflow, 10 weeks, no cost/delivery',
    expectedValue: [
      'recent-change/longitudinal intelligence',
      'within-workflow cohorts',
      'repo intelligence',
    ],
    forbidden: ['cross-workflow fabrication', 'developer rankings without identity authority'],
    build: shapeB_MatureSingleWorkflow,
  },
  {
    id: 'C',
    name: 'Early Multi-Workflow',
    description: '30 devs, 4 workflows, 5 days, uneven adoption',
    expectedValue: [
      'valid cross-workflow comparisons where sample gates permit',
      'single-workflow fallbacks for immature workflows',
    ],
    forbidden: ['arbitrary requirement for months of history'],
    build: shapeC_EarlyMultiWorkflow,
  },
  {
    id: 'D',
    name: 'Mature Multi-Workflow',
    description: 'Multiple mature workflows, 12 weeks, repo attribution, cost',
    expectedValue: [
      'decision-grade workflow comparisons',
      'economics',
      'longitudinal migration',
    ],
    forbidden: [],
    build: shapeD_MatureMultiWorkflow,
  },
  {
    id: 'E',
    name: 'Agent-Heavy',
    description: 'Delegated agents + IDE workflows, 8 weeks',
    expectedValue: [
      'agent runtime semantics (no human-active-coding on delegated agents)',
      'valid cross-mode normalized comparisons only',
    ],
    forbidden: ['human-active-coding semantics on delegated agents', 'unlike time comparison'],
    build: shapeE_AgentHeavy,
  },
  {
    id: 'F',
    name: 'Ed / Priority Dispatch',
    description: '20 devs, VS Code + Claude Code (via VS Code metadata), 10 weeks, ~3k sessions',
    expectedValue: [
      'Claude Code recognized through vscode_version metadata (not hidden as VS Code)',
      'mode-aware workflow comparisons (no human-active-coding on Claude Code)',
      'repo concentration intelligence',
    ],
    forbidden: ['human-active-coding on Claude Code', 'invented Devin/Cursor', 'empty portfolio'],
    build: shapeF_EdPriorityDispatch,
  },
  {
    id: 'G',
    name: 'Mature Single-Workflow (Cursor-dominant)',
    description: '8 devs, single dominant workflow (cursor), 12 weeks',
    expectedValue: [
      'mature single-workflow progressive value',
      'within-workflow temporal/repo intelligence',
    ],
    forbidden: ['cross-workflow fabrication', 'empty portfolio'],
    build: shapeG_MatureSingleWorkflowCursor,
  },
  {
    id: 'H',
    name: 'Multi-Workflow + Configured Cost',
    description: '15 devs, multi-workflow (vscode, cursor, claude_code) + configured cost, 8 weeks',
    expectedValue: [
      'configured economics (not billing actuals)',
      'cross-workflow comparisons',
      'mode-aware agent semantics',
    ],
    forbidden: ['billing actuals', 'fabricated cost', 'human-active-coding on claude_code'],
    build: shapeH_MultiWorkflowConfiguredCost,
  },
  {
    id: 'I',
    name: 'Synthetic Scale',
    description: '40 devs, 4 workflows, 12 weeks, ~2k sessions',
    expectedValue: [
      'bounded portfolio (no linear explosion)',
      'all stages represented when evidence exists',
      'pagination-safe scale',
    ],
    forbidden: ['unbounded UI growth', 'portfolio explosion'],
    build: shapeI_SyntheticScale,
  },
];

export function getPilotShape(id: PilotShapeId): CanonicalInsightInput {
  const shape = PILOT_SHAPES.find(s => s.id === id);
  if (!shape) throw new Error(`Unknown pilot shape: ${id}`);
  return shape.build();
}
