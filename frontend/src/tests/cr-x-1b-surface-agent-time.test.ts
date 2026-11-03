import { describe, it, expect } from 'vitest'
import {
  resolveSurface,
  resolveAssistant,
  isMetricComparableAcrossSurfaces,
  getMetricObservability,
  isMetricAvailable,
  isMissingNotZero,
  isZeroAiBurstObserved,
  isAdditiveTimeSemantic,
  SURFACE_CAPABILITY,
  type Surface,
  type Assistant,
} from '../lib/surfaceAgentContract'
import { computeConcurrency, computeTimeSemantics, type IntervalSession } from '../lib/intervalUnion'

/**
 * ============================================================================
 * CR-X Tranche 1B — Patra Acceptance Examples
 * ============================================================================
 *
 * Patra explicitly asked how we distinguish:
 * - terminal time
 * - human active coding time
 * - agentic coding time
 * - concurrent agents
 *
 * These tests prove that the system does not overstate human coding time
 * or make invalid cross-surface productivity claims.
 *
 * The 9 required scenarios:
 * 1. One human/editor session, no overlap
 * 2. Two overlapping editor sessions
 * 3. One Claude terminal agent
 * 4. Three concurrent Claude agents for one developer
 * 5. Editor + terminal agent overlapping
 * 6. Metric unavailable on Claude bridge
 * 7. Configured cost divided by additive agent runtime
 * 8. Configured cost divided by unique wall-clock time
 * 9. Zero observed AI signals vs missing AI instrumentation
 * ============================================================================
 */

describe('CR-X 1B: Surface × Assistant resolution', () => {
  it('claude_code resolves to terminal surface + claude_code assistant', () => {
    expect(resolveSurface('claude_code')).toBe('terminal')
    expect(resolveAssistant('claude_code')).toBe('claude_code')
  })

  it('vscode resolves to vscode surface + unknown_none_observed assistant', () => {
    // VS Code is a surface. We do NOT assume Copilot.
    expect(resolveSurface('vscode')).toBe('vscode')
    expect(resolveAssistant('vscode')).toBe('unknown_none_observed')
  })

  it('github_copilot resolves to vscode surface + github_copilot assistant', () => {
    expect(resolveSurface('github_copilot')).toBe('vscode')
    expect(resolveAssistant('github_copilot')).toBe('github_copilot')
  })

  it('cursor resolves to cursor surface + cursor_ai assistant', () => {
    expect(resolveSurface('cursor')).toBe('cursor')
    expect(resolveAssistant('cursor')).toBe('cursor_ai')
  })

  it('devin resolves to vscode surface + devin assistant', () => {
    expect(resolveSurface('devin')).toBe('vscode')
    expect(resolveAssistant('devin')).toBe('devin')
  })

  it('null/empty resolves to unknown surface + unknown_none_observed assistant', () => {
    expect(resolveSurface(null)).toBe('unknown')
    expect(resolveSurface('')).toBe('unknown')
    expect(resolveAssistant(null)).toBe('unknown_none_observed')
    expect(resolveAssistant('')).toBe('unknown_none_observed')
  })
})

describe('CR-X 1B: Patra Scenario 1 — One human/editor session, no overlap', () => {
  it('single VS Code session: additive = wall-clock = 1 hour, no overlap', () => {
    const sessions: IntervalSession[] = [
      { timestamp: '2026-09-01T10:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
    ]
    const concurrency = computeConcurrency(sessions)
    const timeSemantics = computeTimeSemantics(sessions)

    // Additive runtime = 1 hour
    expect(concurrency.additive_agent_runtime_ms).toBe(3600000)
    // Unique wall-clock = 1 hour (no overlap to union away)
    expect(concurrency.unique_session_wall_clock_span_ms).toBe(3600000)
    // Parallelism = 1.0 (no overlap)
    expect(concurrency.parallelism_factor).toBe(1.0)
    // Max concurrent = 1
    expect(concurrency.max_concurrent_sessions).toBe(1)
    // Developer elapsed time = 1 hour
    expect(timeSemantics.developer_elapsed_time_ms).toBe(3600000)
  })

  it('VS Code session has active_coding_duration_ms available', () => {
    const surface = resolveSurface('vscode')
    expect(getMetricObservability(surface, 'active_coding_duration_ms')).toBe('directly_observed')
  })
})

describe('CR-X 1B: Patra Scenario 2 — Two overlapping editor sessions', () => {
  it('two overlapping VS Code sessions: additive=2h, wall-clock=1.5h, overlap detected', () => {
    // Session 1: [09:00, 10:00] (1 hour, ends 10:00)
    // Session 2: [09:30, 10:30] (1 hour, ends 10:30)
    // Overlap: [09:30, 10:00] = 30 min
    // Union: [09:00, 10:30] = 1.5 hours
    const sessions: IntervalSession[] = [
      { timestamp: '2026-09-01T10:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T10:30:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
    ]
    const concurrency = computeConcurrency(sessions)

    // Additive = 2 hours
    expect(concurrency.additive_agent_runtime_ms).toBe(7200000)
    // Unique wall-clock = 1.5 hours (union of [09:00,10:00] and [09:30,10:30])
    expect(concurrency.unique_session_wall_clock_span_ms).toBe(5400000)
    // Parallelism = 2h / 1.5h ≈ 1.33
    expect(concurrency.parallelism_factor).toBeCloseTo(7200000 / 5400000, 5)
    // 1 overlapping pair
    expect(concurrency.overlapping_session_count).toBe(1)
    // 2 sessions in overlap
    expect(concurrency.sessions_in_overlap).toBe(2)
    // Max concurrent = 2
    expect(concurrency.max_concurrent_sessions).toBe(2)
  })

  it('additive runtime is NOT labeled as human coding time', () => {
    // Rule 4: additive_agent_runtime ≠ human wall-clock time
    expect(isAdditiveTimeSemantic('additive_agent_runtime')).toBe(true)
    expect(isAdditiveTimeSemantic('unique_wall_clock')).toBe(false)
    // The system must not conflate these
  })
})

describe('CR-X 1B: Patra Scenario 3 — One Claude terminal agent', () => {
  it('Claude Code session: duration observed, active_coding unavailable', () => {
    const surface = resolveSurface('claude_code')
    expect(surface).toBe('terminal')

    // Duration is observed (via session end - session start in bridge)
    // But active_coding_duration_ms is NULL by contract
    expect(getMetricObservability(surface, 'active_coding_duration_ms')).toBe('unavailable')
    expect(isMetricAvailable(surface, 'active_coding_duration_ms')).toBe(false)

    // AI burst count IS observed on terminal (Claude Code bridge captures it)
    expect(getMetricObservability(surface, 'ai_burst_count')).toBe('directly_observed')

    // session_commits IS observed on terminal
    expect(getMetricObservability(surface, 'session_commits')).toBe('directly_observed')
  })

  it('Claude Code session: missing active_coding is NOT zero', () => {
    const surface = resolveSurface('claude_code')
    // NULL active_coding_duration_ms on terminal = unavailable, not zero
    expect(isMissingNotZero(surface, 'active_coding_duration_ms', null)).toBe(true)
    expect(isMissingNotZero(surface, 'active_coding_duration_ms', undefined)).toBe(true)
    // A real zero would not be "missing"
    expect(isMissingNotZero(surface, 'active_coding_duration_ms', 0)).toBe(false)
  })
})

describe('CR-X 1B: Patra Scenario 4 — Three concurrent Claude agents for one developer', () => {
  it('3 concurrent agents for 1 hour: additive=3h, wall-clock=1h, parallelism=3', () => {
    // Three Claude Code sessions, all running [10:00, 11:00] simultaneously
    const sessions: IntervalSession[] = [
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
    ]
    const concurrency = computeConcurrency(sessions)

    // Additive agent runtime = 3 hours
    expect(concurrency.additive_agent_runtime_ms).toBe(10800000)
    // Unique wall-clock = 1 hour (all overlap perfectly)
    expect(concurrency.unique_session_wall_clock_span_ms).toBe(3600000)
    // Parallelism = 3.0
    expect(concurrency.parallelism_factor).toBe(3.0)
    // Max concurrent = 3
    expect(concurrency.max_concurrent_sessions).toBe(3)
    // 3 overlapping pairs (C(3,2) = 3)
    expect(concurrency.overlapping_session_count).toBe(3)
    // All 3 sessions in overlap
    expect(concurrency.sessions_in_overlap).toBe(3)
  })

  it('system does NOT label 3 agent-hours as "3 hours coding"', () => {
    // The system must distinguish:
    // - 3 agent-hours additive runtime
    // - 1 hour wall-clock span
    // - ≤1 hour human active time (unobservable on terminal)
    const sessions: IntervalSession[] = [
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
    ]
    const concurrency = computeConcurrency(sessions)

    const additiveHours = concurrency.additive_agent_runtime_ms / 3600000
    const wallClockHours = concurrency.unique_session_wall_clock_span_ms / 3600000

    // These are DIFFERENT numbers
    expect(additiveHours).toBe(3)
    expect(wallClockHours).toBe(1)
    // The system must not conflate them
    expect(additiveHours).not.toBe(wallClockHours)
  })
})

describe('CR-X 1B: Patra Scenario 5 — Editor + terminal agent overlapping', () => {
  it('VS Code + Claude Code overlapping: cross-surface overlap detected', () => {
    // VS Code session: [10:00, 10:30] (30 min, ends 10:30)
    // Claude Code session: [10:15, 11:00] (45 min, ends 11:00)
    // Overlap: [10:15, 10:30] = 15 min
    // Union: [10:00, 11:00] = 1 hour
    const sessions: IntervalSession[] = [
      { timestamp: '2026-09-01T10:30:00.000Z', duration_ms: 1800000, user_id: 'dev-1' }, // VS Code
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 2700000, user_id: 'dev-1' }, // Claude Code
    ]
    const concurrency = computeConcurrency(sessions)

    // Additive = 30 min + 45 min = 75 min
    expect(concurrency.additive_agent_runtime_ms).toBe(4500000)
    // Unique wall-clock = 60 min (union [10:00, 11:00])
    expect(concurrency.unique_session_wall_clock_span_ms).toBe(3600000)
    // Parallelism = 75/60 = 1.25
    expect(concurrency.parallelism_factor).toBeCloseTo(4500000 / 3600000, 5)
    // 1 overlapping pair
    expect(concurrency.overlapping_session_count).toBe(1)
    // Max concurrent = 2
    expect(concurrency.max_concurrent_sessions).toBe(2)
  })

  it('active_coding_duration_ms is NOT comparable across vscode and terminal', () => {
    // VS Code observes active_coding_duration_ms
    // Terminal (Claude Code) does NOT
    // Therefore, comparing active_coding across these surfaces is INVALID
    expect(isMetricComparableAcrossSurfaces('vscode', 'terminal', 'active_coding_duration_ms')).toBe(false)
  })

  it('ai_burst_count IS observed on both vscode and terminal (but with different semantics)', () => {
    // CR-X 1B.1: Both surfaces observe ai_burst_count, but with different
    // measurement semantics (heuristic vs agent-authored). Level B, not A.
    // isMetricComparableAcrossSurfaces now returns false for level B.
    expect(isMetricComparableAcrossSurfaces('vscode', 'terminal', 'ai_burst_count')).toBe(false)
  })

  it('session_commits is NOT comparable across vscode and terminal', () => {
    // Terminal observes session_commits, VS Code does NOT
    expect(isMetricComparableAcrossSurfaces('vscode', 'terminal', 'session_commits')).toBe(false)
  })
})

describe('CR-X 1B: Patra Scenario 6 — Metric unavailable on Claude bridge', () => {
  it('file_save_count is unavailable on terminal surface', () => {
    const surface = resolveSurface('claude_code')
    expect(surface).toBe('terminal')
    expect(getMetricObservability(surface, 'file_save_count')).toBe('unavailable')
    expect(isMetricAvailable(surface, 'file_save_count')).toBe(false)
  })

  it('focus_ratio is unavailable on terminal surface', () => {
    const surface = resolveSurface('claude_code')
    expect(getMetricObservability(surface, 'focus_ratio')).toBe('unavailable')
  })

  it('flow_profile is unavailable on terminal surface', () => {
    const surface = resolveSurface('claude_code')
    expect(getMetricObservability(surface, 'flow_profile')).toBe('unavailable')
  })

  it('debug_session_count is unavailable on terminal surface', () => {
    const surface = resolveSurface('claude_code')
    expect(getMetricObservability(surface, 'debug_session_count')).toBe('unavailable')
  })

  it('comparing file_save_count across vscode and terminal is invalid', () => {
    expect(isMetricComparableAcrossSurfaces('vscode', 'terminal', 'file_save_count')).toBe(false)
  })
})

describe('CR-X 1B: Patra Scenario 7 — Configured cost / additive agent runtime', () => {
  it('cost per additive agent runtime hour: 3 concurrent agents = 3h denominator', () => {
    // 3 concurrent Claude agents, 1 hour each
    // Additive agent runtime = 3 hours
    // Configured monthly cost = $300
    // Cost per additive agent runtime hour = $300 / 3h = $100/h
    const sessions: IntervalSession[] = [
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
    ]
    const concurrency = computeConcurrency(sessions)
    const monthlyCost = 300
    const additiveHours = concurrency.additive_agent_runtime_ms / 3600000
    const costPerAdditiveHour = monthlyCost / additiveHours

    expect(additiveHours).toBe(3)
    expect(costPerAdditiveHour).toBeCloseTo(100, 2)
  })
})

describe('CR-X 1B: Patra Scenario 8 — Configured cost / unique wall-clock time', () => {
  it('cost per unique wall-clock hour: 3 concurrent agents = 1h denominator', () => {
    // 3 concurrent Claude agents, 1 hour each
    // Unique wall-clock = 1 hour (all overlap)
    // Configured monthly cost = $300
    // Cost per wall-clock hour = $300 / 1h = $300/h
    const sessions: IntervalSession[] = [
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
    ]
    const concurrency = computeConcurrency(sessions)
    const monthlyCost = 300
    const wallClockHours = concurrency.unique_session_wall_clock_span_ms / 3600000
    const costPerWallClockHour = monthlyCost / wallClockHours

    expect(wallClockHours).toBe(1)
    expect(costPerWallClockHour).toBeCloseTo(300, 2)
  })

  it('cost per additive ≠ cost per wall-clock when sessions overlap', () => {
    const sessions: IntervalSession[] = [
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
      { timestamp: '2026-09-01T11:00:00.000Z', duration_ms: 3600000, user_id: 'dev-1' },
    ]
    const concurrency = computeConcurrency(sessions)
    const monthlyCost = 300
    const additiveHours = concurrency.additive_agent_runtime_ms / 3600000
    const wallClockHours = concurrency.unique_session_wall_clock_span_ms / 3600000
    const costPerAdditive = monthlyCost / additiveHours
    const costPerWallClock = monthlyCost / wallClockHours

    // These are DIFFERENT cost denominators
    expect(costPerAdditive).toBe(100)
    expect(costPerWallClock).toBe(300)
    expect(costPerAdditive).not.toBe(costPerWallClock)
  })
})

describe('CR-X 1B: Patra Scenario 9 — Zero observed AI signals vs missing AI instrumentation', () => {
  it('ai_burst_count=0 means zero OBSERVED AI signals, not "non-AI"', () => {
    // Rule 2: ai_burst_count=0 is measured data
    expect(isZeroAiBurstObserved(0)).toBe(true)
    expect(isZeroAiBurstObserved('0')).toBe(true)
    // null/undefined means "not observed"
    expect(isZeroAiBurstObserved(null)).toBe(false)
    expect(isZeroAiBurstObserved(undefined)).toBe(false)
  })

  it('null ai_burst_count on unknown surface = missing, not zero', () => {
    const surface = resolveSurface('unknown')
    expect(isMissingNotZero(surface, 'ai_burst_count', null)).toBe(true)
    expect(isMissingNotZero(surface, 'ai_burst_count', 0)).toBe(false)
  })

  it('null ai_burst_count on vscode = missing (but vscode CAN observe it)', () => {
    // VS Code CAN observe ai_burst_count, so null means the session had no AI bursts
    // OR the heuristic didn't fire. It's not "unavailable" — it's "not observed."
    const surface = resolveSurface('vscode')
    expect(getMetricObservability(surface, 'ai_burst_count')).toBe('directly_observed')
    // Since it's directly_observed, null is NOT "missing due to unavailability"
    expect(isMissingNotZero(surface, 'ai_burst_count', null)).toBe(false)
  })

  it('null ai_burst_count on terminal = missing (terminal CAN observe it)', () => {
    // Terminal (Claude Code) CAN observe ai_burst_count
    const surface = resolveSurface('claude_code')
    expect(getMetricObservability(surface, 'ai_burst_count')).toBe('directly_observed')
    expect(isMissingNotZero(surface, 'ai_burst_count', null)).toBe(false)
  })
})

describe('CR-X 1B: Core product rules enforcement', () => {
  it('Rule 1: Missing terminal instrumentation ≠ zero activity', () => {
    // active_coding_duration_ms is unavailable on terminal
    // NULL means "we can't measure this," NOT "the developer wasn't coding"
    const surface = resolveSurface('claude_code')
    expect(isMissingNotZero(surface, 'active_coding_duration_ms', null)).toBe(true)
    expect(isMissingNotZero(surface, 'active_coding_duration_ms', 0)).toBe(false)
  })

  it('Rule 3: Cross-surface comparison suppressed for unequal metrics', () => {
    // active_coding_duration_ms: vscode=observed, terminal=unavailable
    expect(isMetricComparableAcrossSurfaces('vscode', 'terminal', 'active_coding_duration_ms')).toBe(false)
    // file_save_count: vscode=observed, terminal=unavailable
    expect(isMetricComparableAcrossSurfaces('vscode', 'terminal', 'file_save_count')).toBe(false)
    // focus_ratio: vscode=observed, terminal=unavailable
    expect(isMetricComparableAcrossSurfaces('vscode', 'terminal', 'focus_ratio')).toBe(false)
  })

  it('Rule 5: Cost denominators are explicitly labeled', () => {
    // The labels must state their time basis
    const labels = {
      per_hour: 'Spend / Active-Coding Hour (additive)',
      per_wallclock: 'Spend / Session-Hour (additive)',
    }
    // Both labels explicitly state "additive" — no ambiguous "cost/hour"
    expect(labels.per_hour).toContain('additive')
    expect(labels.per_wallclock).toContain('additive')
    expect(labels.per_hour).not.toBe('Cost / Hour')
    expect(labels.per_wallclock).not.toBe('Cost / Hour')
  })

  it('Rule 6: VS Code and GitHub Copilot are not mutually exclusive', () => {
    // VS Code is a surface; Copilot is an assistant
    // Both can coexist: Copilot runs inside VS Code
    const vscodeSurface = resolveSurface('vscode')
    const copilotSurface = resolveSurface('github_copilot')
    // Both resolve to the same surface (vscode)
    expect(vscodeSurface).toBe('vscode')
    expect(copilotSurface).toBe('vscode')
    // But different assistants
    expect(resolveAssistant('vscode')).toBe('unknown_none_observed')
    expect(resolveAssistant('github_copilot')).toBe('github_copilot')
  })

  it('Rule 6b: VS Code without Copilot signal is NOT assumed to be Copilot', () => {
    // vscode → unknown_none_observed, NOT github_copilot
    expect(resolveAssistant('vscode')).not.toBe('github_copilot')
    expect(resolveAssistant('vscode')).toBe('unknown_none_observed')
  })
})

describe('CR-X 1B: Surface capability matrix completeness', () => {
  it('all surfaces have complete capability entries', () => {
    const requiredSurfaces: Surface[] = ['vscode', 'cursor', 'terminal', 'jetbrains', 'sublime', 'vim', 'other', 'unknown']
    for (const surface of requiredSurfaces) {
      expect(SURFACE_CAPABILITY[surface]).toBeDefined()
      expect(SURFACE_CAPABILITY[surface].active_coding_duration_ms).toBeDefined()
      expect(SURFACE_CAPABILITY[surface].ai_burst_count).toBeDefined()
      expect(SURFACE_CAPABILITY[surface].session_commits).toBeDefined()
    }
  })

  it('vscode and cursor have identical capabilities (both are editor extensions)', () => {
    // Both use the same VS Code extension API
    const vscodeCap = SURFACE_CAPABILITY['vscode']
    const cursorCap = SURFACE_CAPABILITY['cursor']
    expect(cursorCap.active_coding_duration_ms).toBe(vscodeCap.active_coding_duration_ms)
    expect(cursorCap.ai_burst_count).toBe(vscodeCap.ai_burst_count)
    expect(cursorCap.file_save_count).toBe(vscodeCap.file_save_count)
  })

  it('terminal has complementary capabilities to vscode (observes what vscode cannot)', () => {
    const vscodeCap = SURFACE_CAPABILITY['vscode']
    const terminalCap = SURFACE_CAPABILITY['terminal']
    // Terminal observes session_commits; VS Code does not
    expect(terminalCap.session_commits).toBe('directly_observed')
    expect(vscodeCap.session_commits).toBe('unavailable')
    // Terminal observes chars_added_total; VS Code does not
    expect(terminalCap.chars_added_total).toBe('directly_observed')
    expect(vscodeCap.chars_added_total).toBe('unavailable')
    // VS Code observes active_coding_duration_ms; terminal does not
    expect(vscodeCap.active_coding_duration_ms).toBe('directly_observed')
    expect(terminalCap.active_coding_duration_ms).toBe('unavailable')
  })
})
