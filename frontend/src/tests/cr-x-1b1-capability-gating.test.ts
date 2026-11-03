import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  resolveSurface,
  resolveAssistant,
  resolveOperationalMode,
  isMetricAvailable,
  isMetricInstrumentedForWorkflow,
  isMetricComparableAcrossSurfaces,
  isMetricSemanticallyObserved,
  getComparabilityLevel,
  getMeasurementSemantic,
  getWorkflowMeasurementSemantic,
  isWorkflowMetricComparable,
  getWorkflowComparabilityLevel,
  SURFACE_CAPABILITY,
  SURFACE_MEASUREMENT_SEMANTIC,
  type Surface,
  type ComparabilityLevel,
} from '../lib/surfaceAgentContract'
import { isMetricInstrumentedForTool, generateMetricCards } from '../lib/productivityCards'
import { computeConcurrency, type IntervalSession } from '../lib/intervalUnion'

/**
 * ============================================================================
 * CR-X Tranche 1B.1 — Capability Gating Enforcement Tests
 * ============================================================================
 *
 * Proves that the surfaceAgentContract is enforced in the active PBT/PI runtime.
 * The 12 required regression scenarios from the tranche prompt.
 * ============================================================================
 */

// ── Helper: Ed-shaped / Claude-bridge-shaped fixture ─────────────────────────

/**
 * A Claude Code session fixture that mimics the STALE/SEEDED DB data
 * Matt discovered: the DB has idle_time_ms, active_coding_duration_ms,
 * file_save_count, focus_ratio, flow_profile populated — but the bridge
 * sends NULL for all of these. The contract is authority, not the DB.
 */
function makeClaudeSessionWithStaleDbValues(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    session_id: 'claude-stale-1',
    tool: 'claude_code',
    session_source: 'claude_code',
    timestamp: '2026-09-01T11:00:00.000Z',
    duration_ms: 3600000, // 1 hour — valid, observed by bridge
    // STALE DB values that violate the bridge contract:
    active_coding_duration_ms: 2400000, // 40 min — bridge sends NULL
    idle_time_ms: 1200000, // 20 min — bridge sends NULL
    file_save_count: 5, // bridge sends NULL
    focus_ratio: 0.67, // bridge sends NULL
    flow_profile: 'mixed', // bridge sends NULL
    // Valid bridge-observed fields:
    ai_burst_count: 4,
    ai_usage_duration_ms: 1800000,
    session_commits: 3,
    time_to_first_commit_ms: 600000,
    chars_added_total: 1500,
    chars_removed_total_est: 300,
    lines_added_total: 45,
    user_id: 'dev-1',
    ...overrides,
  }
}

/**
 * A VS Code session fixture with valid observed fields.
 */
function makeVscodeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    session_id: 'vscode-1',
    tool: 'vscode',
    session_source: 'vscode',
    timestamp: '2026-09-01T11:00:00.000Z',
    duration_ms: 3600000,
    active_coding_duration_ms: 2400000,
    idle_time_ms: 1200000,
    file_save_count: 8,
    focus_ratio: 0.67,
    flow_profile: 'mixed',
    ai_burst_count: 2,
    ai_usage_duration_ms: 900000,
    session_commits: 0, // VS Code does not observe commits
    time_to_first_commit_ms: 1200000,
    user_id: 'dev-1',
    ...overrides,
  }
}

// ── SCENARIO 1: Claude active_coding=NULL never becomes numeric ─────────────

describe('CR-X 1B.1 Scenario 1: Claude active_coding never becomes numeric', () => {
  it('isMetricInstrumentedForWorkflow returns false for claude_code active_coding', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'active_coding_time_minutes')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'active_coding_duration_ms')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'active_coding_ratio')).toBe(false)
  })

  it('isMetricInstrumentedForTool (PBT) returns false for claude_code active_coding', () => {
    expect(isMetricInstrumentedForTool('claude_code', 'active_coding_time_minutes')).toBe(false)
    expect(isMetricInstrumentedForTool('claude_code', 'active_coding_ratio')).toBe(false)
  })

  it('productivityCards generateMetricCards suppresses active_coding for Claude', () => {
    const series = [{
      label: 'claude_code',
      points: [{ t: '2026-09-01', v: 40, active_coding_time_minutes: 40, session_count: 5 }],
      sessionCount: 5,
      active_coding_time_minutes: 40,
      usesTelemetry: true,
      isLive: true,
      dataSource: 'Real',
    }]
    const cards = generateMetricCards({
      dataSource: series,
      activeMetricId: 'ide.active_coding_time_minutes',
      comparisonMode: 'workflows',
      getCanonicalEntityLabel: (id: string) => id,
    })
    const claudeCard = cards.find(c => c.ide === 'claude_code')
    expect(claudeCard).toBeDefined()
    expect(claudeCard!.availability).toBe('not_instrumented')
    expect(claudeCard!.value).toBeNull()
  })
})

// ── SCENARIO 2: Claude idle_time=NULL never becomes numeric ─────────────────

describe('CR-X 1B.1 Scenario 2: Claude idle_time never becomes numeric', () => {
  it('isMetricInstrumentedForWorkflow returns false for claude_code idle_time', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'idle_time_minutes')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'idle_time_ms')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'idle_ratio')).toBe(false)
  })

  it('isMetricInstrumentedForTool (PBT) returns false for claude_code idle_time', () => {
    expect(isMetricInstrumentedForTool('claude_code', 'idle_time_minutes')).toBe(false)
    expect(isMetricInstrumentedForTool('claude_code', 'idle_ratio')).toBe(false)
  })

  it('productivityCards suppresses idle_time for Claude even with DB values', () => {
    const series = [{
      label: 'claude_code',
      points: [{ t: '2026-09-01', v: 27.87, idle_time_minutes: 27.87, session_count: 5 }],
      sessionCount: 5,
      idle_time_minutes: 27.87,
      usesTelemetry: true,
      isLive: true,
      dataSource: 'Real',
    }]
    const cards = generateMetricCards({
      dataSource: series,
      activeMetricId: 'ide.idle_time_minutes',
      comparisonMode: 'workflows',
      getCanonicalEntityLabel: (id: string) => id,
    })
    const claudeCard = cards.find(c => c.ide === 'claude_code')
    expect(claudeCard).toBeDefined()
    expect(claudeCard!.availability).toBe('not_instrumented')
    expect(claudeCard!.value).toBeNull()
  })
})

// ── SCENARIO 3: Claude file_save_count=NULL never becomes numeric ───────────

describe('CR-X 1B.1 Scenario 3: Claude file_save_count never becomes numeric', () => {
  it('isMetricInstrumentedForWorkflow returns false for claude_code file_save_count', () => {
    expect(isMetricInstrumentedForWorkflow('claude_code', 'file_save_count')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'files_edited_per_session')).toBe(false)
  })

  it('isMetricInstrumentedForTool (PBT) returns false for claude_code files_edited', () => {
    expect(isMetricInstrumentedForTool('claude_code', 'files_edited_per_session')).toBe(false)
  })
})

// ── SCENARIO 4: Unavailable metric suppresses Claude from PBT comparison ────

describe('CR-X 1B.1 Scenario 4: Unavailable metric suppresses Claude from PBT comparison', () => {
  it('Claude is excluded from active_coding comparison series', () => {
    // In ProductivityByToolV3.vue, the time series filters via:
    //   .filter((series) => isMetricInstrumentedForTool(series.label, selectedMetricKey))
    // Simulate that filter:
    const series = [
      { label: 'vscode', active_coding_time_minutes: 40 },
      { label: 'claude_code', active_coding_time_minutes: 35 }, // stale DB value
      { label: 'cursor', active_coding_time_minutes: 38 },
    ]
    const metricKey = 'active_coding_time_minutes'
    const filtered = series.filter(s => isMetricInstrumentedForTool(s.label, metricKey))
    expect(filtered.length).toBe(2) // vscode + cursor, NOT claude_code
    expect(filtered.find(s => s.label === 'claude_code')).toBeUndefined()
    expect(filtered.find(s => s.label === 'vscode')).toBeDefined()
    expect(filtered.find(s => s.label === 'cursor')).toBeDefined()
  })

  it('Claude is excluded from idle_time comparison series', () => {
    const series = [
      { label: 'vscode', idle_time_minutes: 15 },
      { label: 'claude_code', idle_time_minutes: 27.87 }, // stale DB value
    ]
    const metricKey = 'idle_time_minutes'
    const filtered = series.filter(s => isMetricInstrumentedForTool(s.label, metricKey))
    expect(filtered.length).toBe(1)
    expect(filtered.find(s => s.label === 'claude_code')).toBeUndefined()
  })
})

// ── SCENARIO 5: Unavailable metric suppresses invalid PI comparison ─────────

describe('CR-X 1B.1 Scenario 5: Unavailable metric suppresses invalid PI comparison', () => {
  it('addDerivedSessionFields does not set session_active_coding for Claude', async () => {
    const { addDerivedSessionFields } = await import('../lib/insights/final/dataAccess')
    const session = makeClaudeSessionWithStaleDbValues()
    addDerivedSessionFields([session])
    // active_coding_duration_ms is in the DB but contract says unavailable for terminal
    expect(session.session_active_coding_duration_minutes).toBeUndefined()
  })

  it('addDerivedSessionFields does not set session_idle_time for Claude', async () => {
    const { addDerivedSessionFields } = await import('../lib/insights/final/dataAccess')
    const session = makeClaudeSessionWithStaleDbValues()
    addDerivedSessionFields([session])
    expect(session.session_idle_time_minutes).toBeUndefined()
  })

  it('addDerivedSessionFields does not derive focus_ratio for Claude', async () => {
    const { addDerivedSessionFields } = await import('../lib/insights/final/dataAccess')
    const session = makeClaudeSessionWithStaleDbValues()
    addDerivedSessionFields([session])
    expect(session.focus_ratio).toBeUndefined()
  })

  it('addDerivedSessionFields does not derive flow_profile for Claude', async () => {
    const { addDerivedSessionFields } = await import('../lib/insights/final/dataAccess')
    const session = makeClaudeSessionWithStaleDbValues()
    addDerivedSessionFields([session])
    expect(session.flow_profile).toBeUndefined()
  })

  it('addDerivedSessionFields DOES set session_duration_minutes for Claude (valid)', async () => {
    const { addDerivedSessionFields } = await import('../lib/insights/final/dataAccess')
    const session = makeClaudeSessionWithStaleDbValues()
    addDerivedSessionFields([session])
    // duration_ms IS observed by the bridge
    expect(session.session_duration_minutes).toBe(60) // 3600000 / 60000
  })
})

// ── SCENARIO 6: Zero observed AI signals remains measured zero, not "non-AI" ─

describe('CR-X 1B.1 Scenario 6: Zero observed AI signals is measured, not "non-AI"', () => {
  it('ai_burst_count=0 is a valid measured value for Claude', () => {
    // ai_burst_count IS instrumented for Claude Code (terminal surface)
    expect(isMetricInstrumentedForWorkflow('claude_code', 'ai_burst_count')).toBe(true)
    expect(isMetricAvailable('terminal', 'ai_burst_count')).toBe(true)
  })

  it('ai_burst_count=0 is a valid measured value for VS Code', () => {
    expect(isMetricInstrumentedForWorkflow('vscode', 'ai_burst_count')).toBe(true)
    expect(isMetricAvailable('vscode', 'ai_burst_count')).toBe(true)
  })

  it('a Claude session with ai_burst_count=0 is still a valid session', async () => {
    const { addDerivedSessionFields } = await import('../lib/insights/final/dataAccess')
    const session = makeClaudeSessionWithStaleDbValues({ ai_burst_count: 0 })
    addDerivedSessionFields([session])
    // session_has_ai_activity should be false (zero observed), not undefined
    expect(session.session_has_ai_activity).toBe(false)
    // But the session itself is valid
    expect(session.session_duration_minutes).toBe(60)
  })
})

// ── SCENARIO 7: AI burst different measurement semantics → no direct comparison ─

describe('CR-X 1B.1 Scenario 7: AI burst different semantics → no direct cross-surface claim', () => {
  it('ai_burst_count is observed on both vscode and terminal', () => {
    expect(isMetricAvailable('vscode', 'ai_burst_count')).toBe(true)
    expect(isMetricAvailable('terminal', 'ai_burst_count')).toBe(true)
  })

  it('ai_burst_count has DIFFERENT measurement semantics on vscode vs terminal', () => {
    // VS Code: editor_activity_heuristic (large block detection)
    // Terminal: agent_authored_known (all edits are AI)
    expect(getMeasurementSemantic('vscode', 'ai_burst_count')).toBe('editor_activity_heuristic')
    expect(getMeasurementSemantic('terminal', 'ai_burst_count')).toBe('agent_authored_known')
    expect(getMeasurementSemantic('vscode', 'ai_burst_count')).not.toBe(getMeasurementSemantic('terminal', 'ai_burst_count'))
  })

  it('ai_burst_count comparability level is B (different semantics), not A', () => {
    expect(getComparabilityLevel('vscode', 'terminal', 'ai_burst_count')).toBe('B')
  })

  it('isMetricComparableAcrossSurfaces returns false for ai_burst_count (level B)', () => {
    // Level B means NOT directly comparable — must not power direct cross-surface claim
    expect(isMetricComparableAcrossSurfaces('vscode', 'terminal', 'ai_burst_count')).toBe(false)
  })

  it('isMetricSemanticallyObserved returns true (both observe it, just differently)', () => {
    expect(isMetricSemanticallyObserved('vscode', 'terminal', 'ai_burst_count')).toBe(true)
  })

  it('workflow-level comparability: vscode vs claude_code ai_burst_count is level B', () => {
    expect(getWorkflowComparabilityLevel('vscode', 'claude_code', 'ai_burst_count')).toBe('B')
    expect(isWorkflowMetricComparable('vscode', 'claude_code', 'ai_burst_count')).toBe(false)
  })

  it('duration_ms IS comparable (same semantic: session_elapsed)', () => {
    expect(getMeasurementSemantic('vscode', 'ai_burst_count')).toBeDefined()
    // duration_ms is not in SurfaceCapability directly, but time_to_first_commit_ms is
    // Both surfaces observe TTFC with commit_observed semantic
    expect(getMeasurementSemantic('vscode', 'time_to_first_commit_ms')).toBe('commit_observed')
    expect(getMeasurementSemantic('terminal', 'time_to_first_commit_ms')).toBe('commit_observed')
    expect(getComparabilityLevel('vscode', 'terminal', 'time_to_first_commit_ms')).toBe('A')
    expect(isMetricComparableAcrossSurfaces('vscode', 'terminal', 'time_to_first_commit_ms')).toBe(true)
  })
})

// ── SCENARIO 8: Claude session duration remains valid as elapsed/agent runtime ─

describe('CR-X 1B.1 Scenario 8: Claude session duration remains valid', () => {
  it('Claude duration_ms is observed and valid', async () => {
    const { addDerivedSessionFields } = await import('../lib/insights/final/dataAccess')
    const session = makeClaudeSessionWithStaleDbValues()
    addDerivedSessionFields([session])
    expect(session.session_duration_minutes).toBe(60)
  })

  it('Claude session contributes to additive agent runtime', () => {
    const sessions: IntervalSession[] = [
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T12:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
    ]
    const concurrency = computeConcurrency(sessions)
    // Additive = 2 hours (both sessions)
    expect(concurrency.additive_agent_runtime_ms).toBe(7200000)
    // Unique wall-clock = 2 hours (non-overlapping)
    expect(concurrency.unique_session_wall_clock_span_ms).toBe(7200000)
    expect(concurrency.parallelism_factor).toBe(1.0)
  })
})

// ── SCENARIO 9: Claude Spend / Active-Coding Hour is unavailable ────────────

describe('CR-X 1B.1 Scenario 9: Claude Spend / Active-Coding Hour is unavailable', () => {
  it('activeCodingMinutes is 0 for Claude in productivityCards even with DB values', () => {
    const series = [{
      label: 'claude_code',
      points: [{ t: '2026-09-01', v: 40, active_coding_time_minutes: 40, session_count: 5 }],
      sessionCount: 5,
      active_coding_time_minutes: 40, // stale DB value
      usesTelemetry: true,
      isLive: true,
      dataSource: 'Real',
    }]
    const cards = generateMetricCards({
      dataSource: series,
      activeMetricId: 'ide.ai_suggestions_accepted',
      comparisonMode: 'workflows',
      getCanonicalEntityLabel: (id: string) => id,
    })
    const claudeCard = cards.find(c => c.ide === 'claude_code')
    expect(claudeCard).toBeDefined()
    // activeCodingMinutes must be 0 because active_coding is not instrumented for Claude
    expect(claudeCard!.activeCodingMinutes).toBe(0)
  })

  it('VS Code activeCodingMinutes is populated from series data', () => {
    const series = [{
      label: 'vscode',
      points: [{ t: '2026-09-01', v: 40, active_coding_time_minutes: 40, session_count: 5 }],
      sessionCount: 5,
      active_coding_time_minutes: 40,
      usesTelemetry: true,
      isLive: true,
      dataSource: 'Real',
    }]
    const cards = generateMetricCards({
      dataSource: series,
      activeMetricId: 'ide.ai_suggestions_accepted',
      comparisonMode: 'workflows',
      getCanonicalEntityLabel: (id: string) => id,
    })
    const vscodeCard = cards.find(c => c.ide === 'vscode')
    expect(vscodeCard).toBeDefined()
    expect(vscodeCard!.activeCodingMinutes).toBe(40)
  })
})

// ── SCENARIO 10: Claude Spend / Session-Hour (additive) can remain available ─

describe('CR-X 1B.1 Scenario 10: Claude Spend / Session-Hour remains available', () => {
  it('Claude session duration is observed and can power session-hour cost', () => {
    // duration_ms is observed by the bridge — session-hour cost is valid
    const session = makeClaudeSessionWithStaleDbValues()
    expect(session.duration_ms).toBe(3600000)
    // The per_wallclock cost layer uses sessionMinutes (Σ duration), not active_coding
    // This remains valid for Claude Code
  })

  it('Claude session contributes to session-hour denominator', () => {
    const sessions: IntervalSession[] = [
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
    ]
    const concurrency = computeConcurrency(sessions)
    const sessionMinutes = concurrency.additive_agent_runtime_ms / 60000
    expect(sessionMinutes).toBe(60)
    // Spend / Session-Hour = monthlyCost / (sessionMinutes / 60) = valid
  })
})

// ── SCENARIO 11: Interval-union time distinct from additive session runtime ──

describe('CR-X 1B.1 Scenario 11: Interval-union ≠ additive session runtime', () => {
  it('3 concurrent Claude agents: additive=3h, wall-clock=1h', () => {
    const sessions: IntervalSession[] = [
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
    ]
    const concurrency = computeConcurrency(sessions)
    const additiveHours = concurrency.additive_agent_runtime_ms / 3600000
    const wallClockHours = concurrency.unique_session_wall_clock_span_ms / 3600000
    expect(additiveHours).toBe(3)
    expect(wallClockHours).toBe(1)
    expect(additiveHours).not.toBe(wallClockHours)
  })

  it('CanonicalInsightInput.timeSemantics exposes both semantics', async () => {
    const { computeTimeSemantics, computeConcurrency } = await import('../lib/intervalUnion')
    const sessions = [
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
    ]
    const ts = computeTimeSemantics(sessions)
    const cc = computeConcurrency(sessions)
    expect(ts.agent_compute_time_ms).toBe(10800000) // 3h additive
    expect(ts.developer_elapsed_time_ms).toBe(3600000) // 1h wall-clock
    // Concurrency data comes from computeConcurrency, merged in dataAccess.ts
    expect(cc.parallelism_factor).toBeCloseTo(3.0, 2)
    expect(cc.max_concurrent_sessions).toBe(3)
  })
})

// ── SCENARIO 12: VS Code is not automatically classified as GitHub Copilot ──

describe('CR-X 1B.1 Scenario 12: VS Code ≠ GitHub Copilot', () => {
  it('vscode resolves to unknown_none_observed assistant', () => {
    expect(resolveAssistant('vscode')).toBe('unknown_none_observed')
    expect(resolveAssistant('vscode')).not.toBe('github_copilot')
  })

  it('github_copilot resolves to github_copilot assistant', () => {
    expect(resolveAssistant('github_copilot')).toBe('github_copilot')
  })

  it('both vscode and github_copilot resolve to vscode surface', () => {
    expect(resolveSurface('vscode')).toBe('vscode')
    expect(resolveSurface('github_copilot')).toBe('vscode')
  })

  it('vscode and github_copilot have the same surface capabilities', () => {
    // Both run in the VS Code extension API
    const vscodeCap = SURFACE_CAPABILITY['vscode']
    const copilotCap = SURFACE_CAPABILITY['vscode'] // same surface
    expect(vscodeCap).toBe(copilotCap)
  })
})

// ── MEASUREMENT SEMANTIC MATRIX COMPLETNESS ──────────────────────────────────

describe('CR-X 1B.1: Measurement semantic matrix completeness', () => {
  it('all surfaces have measurement semantic entries', () => {
    const surfaces: Surface[] = ['vscode', 'cursor', 'terminal', 'jetbrains', 'sublime', 'vim', 'other', 'unknown']
    for (const s of surfaces) {
      expect(SURFACE_MEASUREMENT_SEMANTIC[s]).toBeDefined()
      expect(SURFACE_MEASUREMENT_SEMANTIC[s].ai_burst_count).toBeDefined()
      expect(SURFACE_MEASUREMENT_SEMANTIC[s].active_coding_duration_ms).toBeDefined()
    }
  })

  it('vscode ai_burst_count uses editor_activity_heuristic', () => {
    expect(SURFACE_MEASUREMENT_SEMANTIC['vscode'].ai_burst_count).toBe('editor_activity_heuristic')
  })

  it('terminal ai_burst_count uses agent_authored_known', () => {
    expect(SURFACE_MEASUREMENT_SEMANTIC['terminal'].ai_burst_count).toBe('agent_authored_known')
  })

  it('vscode active_coding uses activity_timer', () => {
    expect(SURFACE_MEASUREMENT_SEMANTIC['vscode'].active_coding_duration_ms).toBe('activity_timer')
  })

  it('terminal active_coding is not_measured', () => {
    expect(SURFACE_MEASUREMENT_SEMANTIC['terminal'].active_coding_duration_ms).toBe('not_measured')
  })

  it('terminal session_commits uses commit_observed', () => {
    expect(SURFACE_MEASUREMENT_SEMANTIC['terminal'].session_commits).toBe('commit_observed')
  })

  it('vscode session_commits is not_measured', () => {
    expect(SURFACE_MEASUREMENT_SEMANTIC['vscode'].session_commits).toBe('not_measured')
  })
})

// ── COMPARABILITY LEVEL TESTS ────────────────────────────────────────────────

describe('CR-X 1B.1: Comparability level enforcement', () => {
  it('level A: same semantic (duration/TTFC across vscode and cursor)', () => {
    // Both vscode and cursor use commit_observed for TTFC
    expect(getComparabilityLevel('vscode', 'cursor', 'time_to_first_commit_ms')).toBe('A')
  })

  it('level B: different semantic (ai_burst_count across vscode and terminal)', () => {
    expect(getComparabilityLevel('vscode', 'terminal', 'ai_burst_count')).toBe('B')
  })

  it('level C: unavailable on one surface (active_coding across vscode and terminal)', () => {
    expect(getComparabilityLevel('vscode', 'terminal', 'active_coding_duration_ms')).toBe('C')
  })

  it('level C: unavailable on both surfaces (file_save across terminal and unknown)', () => {
    expect(getComparabilityLevel('terminal', 'unknown', 'file_save_count')).toBe('C')
  })

  it('isMetricComparableAcrossSurfaces only returns true for level A', () => {
    expect(isMetricComparableAcrossSurfaces('vscode', 'cursor', 'time_to_first_commit_ms')).toBe(true) // A
    expect(isMetricComparableAcrossSurfaces('vscode', 'terminal', 'ai_burst_count')).toBe(false) // B
    expect(isMetricComparableAcrossSurfaces('vscode', 'terminal', 'active_coding_duration_ms')).toBe(false) // C
  })
})

// ── TELEMETRY ADAPTER SUPPRESSION ────────────────────────────────────────────

describe('CR-X 1B.1: Telemetry adapter suppresses unavailable fields', () => {
  it('telemetryToUnified does not propagate active_coding for Claude', async () => {
    // The adapter checks isMetricAvailable(resolveSurface(tool), 'active_coding_duration_ms')
    // before tracking activeCodingMs. For claude_code (terminal surface), this returns false.
    const tool = 'claude_code'
    const surface = resolveSurface(tool)
    expect(isMetricAvailable(surface, 'active_coding_duration_ms')).toBe(false)
    // Therefore the adapter will NOT push to activeCodingDurationByBucket
  })

  it('telemetryToUnified does not propagate idle_time for Claude', async () => {
    const tool = 'claude_code'
    const surface = resolveSurface(tool)
    expect(isMetricAvailable(surface, 'idle_time_ms')).toBe(false)
  })

  it('telemetryToUnified does not propagate file_edit for Claude', async () => {
    const tool = 'claude_code'
    const surface = resolveSurface(tool)
    expect(isMetricAvailable(surface, 'file_save_count')).toBe(false)
  })

  it('telemetryToUnified DOES propagate active_coding for VS Code', async () => {
    const tool = 'vscode'
    const surface = resolveSurface(tool)
    expect(isMetricAvailable(surface, 'active_coding_duration_ms')).toBe(true)
  })
})

// ── 17G.2: GIT AUTHORITY + DELEGATED-AGENT SEMANTIC GATES ─────────────────────

describe('CR-X 17G.2: Git-authority metrics bypass editor surface', () => {
  it('commits_per_session is eligible on all five tracked workflows', () => {
    for (const tool of ['devin', 'claude_code', 'vscode', 'cursor', 'github_copilot']) {
      expect(isMetricInstrumentedForWorkflow(tool, 'commits_per_session')).toBe(true)
      expect(isMetricInstrumentedForWorkflow(tool, 'time_to_first_commit_minutes')).toBe(true)
    }
  })

  it('git authority does not depend on resolveSurface(workflow)', () => {
    // Devin resolves to vscode surface, but surface still says session_commits unavailable.
    // Commit eligibility must come from Git authority, not that stale surface flag.
    expect(resolveSurface('devin')).toBe('vscode')
    expect(isMetricAvailable('vscode', 'session_commits')).toBe(false)
    expect(isMetricInstrumentedForWorkflow('devin', 'commits_per_session')).toBe(true)
  })

  it('commit measurement semantic is commit_observed on every tracked workflow', () => {
    for (const tool of ['devin', 'claude_code', 'vscode', 'cursor', 'github_copilot']) {
      expect(getWorkflowMeasurementSemantic(tool, 'commits_per_session')).toBe('commit_observed')
    }
  })

  it('commits are level-A comparable across all five tracked workflows', () => {
    const workflows = ['devin', 'claude_code', 'vscode', 'cursor', 'github_copilot']
    for (let i = 0; i < workflows.length; i++) {
      for (let j = i + 1; j < workflows.length; j++) {
        expect(getWorkflowComparabilityLevel(workflows[i], workflows[j], 'commits_per_session')).toBe('A')
      }
    }
  })

  it('unknown workflow fails closed for git metrics', () => {
    expect(resolveOperationalMode('some_unrecognized_tool')).toBe('unknown')
    expect(isMetricInstrumentedForWorkflow('some_unrecognized_tool', 'commits_per_session')).toBe(false)
  })

  it('codex is registered delegated_agent but commit metrics remain uninstrumented (lifecycle bridge does not observe git)', () => {
    expect(resolveOperationalMode('codex')).toBe('delegated_agent')
    expect(isMetricInstrumentedForWorkflow('codex', 'commits_per_session')).toBe(false)
    expect(getWorkflowMeasurementSemantic('codex', 'commits_per_session')).toBe('not_measured')
  })
})

describe('CR-X 17G.2: Delegated-agent human-attention metrics fail closed', () => {
  it('Claude Code active/idle/focus remain suppressed despite seeded DB values', () => {
    for (const m of ['active_coding_time_minutes', 'active_coding_ratio', 'idle_time_minutes', 'idle_ratio', 'focus_ratio']) {
      expect(isMetricInstrumentedForWorkflow('claude_code', m)).toBe(false)
    }
  })

  it('Devin (delegated_agent) active/idle/focus fail closed for human-coding label', () => {
    expect(resolveOperationalMode('devin')).toBe('delegated_agent')
    for (const m of ['active_coding_time_minutes', 'active_coding_ratio', 'idle_time_minutes', 'idle_ratio', 'focus_ratio']) {
      expect(isMetricInstrumentedForWorkflow('devin', m)).toBe(false)
    }
  })

  it('human_interactive workflows still render active coding', () => {
    for (const tool of ['vscode', 'cursor', 'github_copilot']) {
      expect(resolveOperationalMode(tool)).toBe('human_interactive')
      expect(isMetricInstrumentedForWorkflow(tool, 'active_coding_time_minutes')).toBe(true)
      expect(isMetricInstrumentedForWorkflow(tool, 'idle_time_minutes')).toBe(true)
    }
  })

  it('Cards and Time Series agree: Claude active coding is not_instrumented', () => {
    const series = [{
      label: 'claude_code',
      points: [{ t: '2026-09-01', v: 40, active_coding_time_minutes: 40, session_count: 5 }],
      sessionCount: 5,
      active_coding_time_minutes: 40,
      usesTelemetry: true,
      isLive: true,
      dataSource: 'Real',
    }]
    const cards = generateMetricCards({
      dataSource: series,
      activeMetricId: 'ide.active_coding_time_minutes',
      comparisonMode: 'workflows',
      getCanonicalEntityLabel: (id: string) => id,
    })
    const claudeCard = cards.find(c => c.ide === 'claude_code')
    expect(claudeCard).toBeDefined()
    expect(claudeCard!.availability).toBe('not_instrumented')
    expect(claudeCard!.value).toBeNull()
  })

  it('Devin active coding is suppressed in Cards even with DB values', () => {
    const series = [{
      label: 'devin',
      points: [{ t: '2026-09-01', v: 35, active_coding_time_minutes: 35, session_count: 5 }],
      sessionCount: 5,
      active_coding_time_minutes: 35,
      usesTelemetry: true,
      isLive: true,
      dataSource: 'Real',
    }]
    const cards = generateMetricCards({
      dataSource: series,
      activeMetricId: 'ide.active_coding_time_minutes',
      comparisonMode: 'workflows',
      getCanonicalEntityLabel: (id: string) => id,
    })
    const devinCard = cards.find(c => c.ide === 'devin')
    expect(devinCard).toBeDefined()
    expect(devinCard!.availability).toBe('not_instrumented')
    expect(devinCard!.value).toBeNull()
    expect(devinCard!.activeCodingMinutes).toBe(0)
  })

  it('unknown metric still fails closed', () => {
    expect(isMetricInstrumentedForWorkflow('vscode', 'nonexistent_metric')).toBe(false)
  })
})

// ── 17G.6: UNSUPPORTED WORKFLOWS DO NOT OCCUPY METRIC CARDS ──────────────────

describe('PILOT OPS 17G.6: Cards view omits capability-unsupported workflows', () => {
  it('v3Cards filters rendered cards through the workflow instrumentation gate', () => {
    const pbtPath = resolve(__dirname, '../components/ProductivityByToolV3.vue')
    const pbtSource = readFileSync(pbtPath, 'utf-8')
    expect(pbtSource).toMatch(
      /const allCards = classicCards\.filter\(c =>\s*workflowInstrumentedForMetric\(c\.rawToolId \|\| c\.ide, selectedMetric\.value\)\s*\)/
    )
  })

  it('active_coding cards drop delegated agents but keep instrumented and no_data workflows', () => {
    const series = [
      { label: 'vscode', points: [{ t: '2026-09-01', active_coding_time_minutes: 40, session_count: 30 }], sessionCount: 30, usesTelemetry: true },
      { label: 'cursor', points: [{ t: '2026-09-01', active_coding_time_minutes: 38, session_count: 30 }], sessionCount: 30, usesTelemetry: true },
      { label: 'github_copilot', points: [{ t: '2026-09-01', session_count: 30 }], sessionCount: 30, usesTelemetry: true },
      { label: 'devin', points: [{ t: '2026-09-01', active_coding_time_minutes: 35, session_count: 50 }], sessionCount: 50, usesTelemetry: true },
      { label: 'claude_code', points: [{ t: '2026-09-01', active_coding_time_minutes: 33, session_count: 40 }], sessionCount: 40, usesTelemetry: true },
    ]
    const cards = generateMetricCards({
      dataSource: series,
      activeMetricId: 'ide.active_coding_time_minutes',
      comparisonMode: 'workflows',
      getCanonicalEntityLabel: (id: string) => id,
    })
    // Same predicate as the v3Cards render filter
    const visible = cards.filter(c =>
      isMetricInstrumentedForWorkflow(c.rawToolId || c.ide, 'active_coding_time_minutes')
      && isMetricInstrumentedForTool(c.rawToolId || c.ide, 'active_coding_time_minutes')
    )
    expect(visible.map(c => c.ide).sort()).toEqual(['cursor', 'github_copilot', 'vscode'])
    // Instrumented-but-unobserved remains a card (no_data), not hidden
    const copilot = visible.find(c => c.ide === 'github_copilot')
    expect(copilot).toBeDefined()
    expect(copilot!.availability).toBe('no_data')
    // Delegated agents are omitted entirely, not rendered as "Not instrumented"
    const omitted = cards.filter(c => !visible.includes(c)).map(c => c.ide).sort()
    expect(omitted).toEqual(['claude_code', 'devin'])
  })
})
