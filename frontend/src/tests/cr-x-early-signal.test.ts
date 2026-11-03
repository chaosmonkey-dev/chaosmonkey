import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateEarlySignalWorkflowAdoption, generateEarlySignalDeveloperActivity, generateDeveloperWorkflowCostEfficiencyFrontier } from '../lib/insights/final/generators/earlySignal'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

// Mock localStorage for cost config
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

describe('CR-X Pass 3: Early-Signal Workflow Adoption', () => {
  it('returns null with fewer than 5 sessions', () => {
    const input: CanonicalInsightInput = {
      sessionRows: [
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'vscode', user_id: 'invite:2' },
      ],
      granularity: 'week',
    }
    const result = generateEarlySignalWorkflowAdoption(input)
    expect(result).toBeNull()
  })

  it('fires with 5 sessions and shows workflow distribution', () => {
    const input: CanonicalInsightInput = {
      sessionRows: [
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'vscode', user_id: 'invite:2' },
        { tool: 'vscode', user_id: 'invite:2' },
      ],
      granularity: 'week',
    }
    const result = generateEarlySignalWorkflowAdoption(input)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('early-signal-workflow-adoption')
    expect(result!.hasData).toBe(true)
    expect(result!.current).toBe(5)
    expect(result!.confidence).toBe('low') // <15 sessions → low
    expect(result!.lifecycleClass).toBe('contextual')
    expect(result!.breakdownByTool).toBeDefined()
    expect(result!.breakdownByTool['cursor'].sessions).toBe(3)
    expect(result!.breakdownByTool['vscode'].sessions).toBe(2)
  })

  it('upgrades confidence to medium at 15+ sessions', () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      tool: i < 12 ? 'cursor' : 'vscode',
      user_id: 'invite:1',
    }))
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateEarlySignalWorkflowAdoption(input)
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe('medium')
  })

  it('is neutral polarity (not directional)', () => {
    const sessions = Array.from({ length: 10 }, () => ({ tool: 'cursor', user_id: 'invite:1' }))
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateEarlySignalWorkflowAdoption(input)
    expect(result).not.toBeNull()
    expect(result!.polarity).toBe('neutral')
  })

  // P3: Maturity gate — suppress when any workflow has >= 25 sessions
  it('suppresses (returns null) when any workflow has 25+ sessions (mature tenant)', () => {
    const sessions = [
      ...Array.from({ length: 25 }, () => ({ tool: 'cursor', user_id: 'invite:1' })),
      ...Array.from({ length: 5 }, () => ({ tool: 'vscode', user_id: 'invite:2' })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateEarlySignalWorkflowAdoption(input)
    expect(result).toBeNull() // Mature tenant → suppressed
  })

  it('still fires when no workflow has 25+ sessions (early tenant)', () => {
    const sessions = [
      ...Array.from({ length: 24 }, () => ({ tool: 'cursor', user_id: 'invite:1' })),
      ...Array.from({ length: 24 }, () => ({ tool: 'vscode', user_id: 'invite:2' })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateEarlySignalWorkflowAdoption(input)
    expect(result).not.toBeNull() // No workflow >= 25 → still early signal
  })
})

describe('CR-X Pass 3: Early-Signal Developer Activity', () => {
  it('returns null with fewer than 5 sessions', () => {
    const input: CanonicalInsightInput = {
      sessionRows: [
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'cursor', user_id: 'invite:1' },
      ],
      granularity: 'week',
    }
    const result = generateEarlySignalDeveloperActivity(input)
    expect(result).toBeNull()
  })

  it('fires with 5 sessions and shows developer count', () => {
    const input: CanonicalInsightInput = {
      sessionRows: [
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'cursor', user_id: 'invite:2' },
        { tool: 'vscode', user_id: 'invite:2' },
        { tool: 'vscode', user_id: 'invite:3' },
      ],
      granularity: 'week',
    }
    const result = generateEarlySignalDeveloperActivity(input)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('early-signal-developer-activity')
    expect(result!.hasData).toBe(true)
    expect(result!.current).toBe(3) // 3 distinct developers
    expect(result!.confidence).toBe('low')
  })

  it('reports invite-backed identity coverage', () => {
    const input: CanonicalInsightInput = {
      sessionRows: [
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'cursor', user_id: 'invite:2' },
        { tool: 'vscode', user_id: 'legacy_user' },
        { tool: 'vscode', user_id: 'legacy_user' },
      ],
      granularity: 'week',
    }
    const result = generateEarlySignalDeveloperActivity(input)
    expect(result).not.toBeNull()
    // 2 invite-backed out of 3 total
    expect(result!.coveragePct).toBeCloseTo(66.67, 0)
  })

  it('recommends investigation when identity coverage < 50%', () => {
    const input: CanonicalInsightInput = {
      sessionRows: [
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'cursor', user_id: 'invite:1' },
        { tool: 'cursor', user_id: 'legacy_1' },
        { tool: 'vscode', user_id: 'legacy_2' },
        { tool: 'vscode', user_id: 'legacy_3' },
      ],
      granularity: 'week',
    }
    const result = generateEarlySignalDeveloperActivity(input)
    expect(result).not.toBeNull()
    expect(result!.recommendationState).toBe('investigate')
  })

  // P3: Maturity gate — suppress when total sessions >= 50
  it('suppresses (returns null) when total sessions >= 50 (mature tenant)', () => {
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      tool: 'cursor',
      user_id: `invite:${i % 5}`,
    }))
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateEarlySignalDeveloperActivity(input)
    expect(result).toBeNull() // Mature tenant → suppressed
  })

  it('still fires when total sessions < 50 (early tenant)', () => {
    const sessions = Array.from({ length: 49 }, (_, i) => ({
      tool: 'cursor',
      user_id: `invite:${i % 5}`,
    }))
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateEarlySignalDeveloperActivity(input)
    expect(result).not.toBeNull() // < 50 → still early signal
  })
})

describe('CR-X Pass 3 (P2 CORRECTED): Developer×Workflow×Metric×Cost Efficiency Frontier', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  // P2 CORRECTION: No sessions-only fallback. If no cost configured, PI does NOT fire.
  it('returns null when no cost is configured (no sessions-only fallback)', () => {
    const sessions = [
      ...Array.from({ length: 12 }, (_, i) => ({
        tool: 'cursor',
        user_id: 'invite:devA',
        session_commits: 2,
        session_commits_source: 'observed',
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        tool: 'cursor',
        user_id: 'invite:devB',
        session_commits: 3,
        session_commits_source: 'observed',
      })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [] }
    const result = generateDeveloperWorkflowCostEfficiencyFrontier(input)
    expect(result).toBeNull() // No cost → does NOT fire
  })

  it('returns null with fewer than 5 total sessions', () => {
    localStorageMock.setItem('chaosmonkey_tool_cost_config_cursor', JSON.stringify({ monthlySpend: 100 }))
    const input: CanonicalInsightInput = {
      sessionRows: [
        { tool: 'cursor', user_id: 'invite:1', session_commits: 1, session_commits_source: 'observed' },
        { tool: 'cursor', user_id: 'invite:1', session_commits: 1, session_commits_source: 'observed' },
      ],
      granularity: 'week',
    }
    const result = generateDeveloperWorkflowCostEfficiencyFrontier(input)
    expect(result).toBeNull()
  })

  it('returns null when developer has fewer than 10 sessions (cohort threshold)', () => {
    localStorageMock.setItem('chaosmonkey_tool_cost_config_cursor', JSON.stringify({ monthlySpend: 100 }))
    const sessions = [
      ...Array.from({ length: 8 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devA',
        session_commits: 2,
        session_commits_source: 'observed',
      })),
      ...Array.from({ length: 8 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devB',
        session_commits: 3,
        session_commits_source: 'observed',
      })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateDeveloperWorkflowCostEfficiencyFrontier(input)
    expect(result).toBeNull() // Both devs < 10 sessions
  })

  it('returns null when only 1 developer qualifies (cohort min = 2)', () => {
    localStorageMock.setItem('chaosmonkey_tool_cost_config_cursor', JSON.stringify({ monthlySpend: 100 }))
    const sessions = [
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devA',
        session_commits: 2,
        session_commits_source: 'observed',
      })),
      ...Array.from({ length: 5 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devB',
        session_commits: 3,
        session_commits_source: 'observed',
      })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateDeveloperWorkflowCostEfficiencyFrontier(input)
    expect(result).toBeNull() // Only devA qualifies (12 >= 10), devB has 5 < 10
  })

  it('fires with cost configured + 2 qualifying developers + commits metric', () => {
    localStorageMock.setItem('chaosmonkey_tool_cost_config_cursor', JSON.stringify({ monthlySpend: 100 }))
    const sessions = [
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devA',
        session_commits: 2,
        session_commits_source: 'observed',
      })),
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devB',
        session_commits: 3,
        session_commits_source: 'observed',
      })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateDeveloperWorkflowCostEfficiencyFrontier(input)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('developer-workflow-cost-efficiency-frontier')
    expect(result!.hasData).toBe(true)
    expect(result!.polarity).toBe('neutral')
    // devB has higher commits/session (3 > 2), same allocated cost → devB on frontier
    expect(result!.current).toBeGreaterThanOrEqual(1)
  })

  it('uses real performance metric (commits/session), NOT session volume', () => {
    localStorageMock.setItem('chaosmonkey_tool_cost_config_cursor', JSON.stringify({ monthlySpend: 100 }))
    // devA: 15 sessions, 1 commit each → avg 1.0 commits/session
    // devB: 12 sessions, 4 commits each → avg 4.0 commits/session
    // devB should dominate devA on commits/session at same allocated cost
    const sessions = [
      ...Array.from({ length: 15 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devA',
        session_commits: 1,
        session_commits_source: 'observed',
      })),
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devB',
        session_commits: 4,
        session_commits_source: 'observed',
      })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateDeveloperWorkflowCostEfficiencyFrontier(input)
    expect(result).not.toBeNull()
    // devB (4 commits/session, same cost) dominates devA (1 commit/session, same cost)
    // So only devB is on the frontier
    expect(result!.current).toBe(1)
    // Title should mention "Commits per session" metric, not sessions
    expect(result!.title.toLowerCase()).toContain('commits per session')
  })

  it('identifies Pareto frontier correctly (non-dominated developers)', () => {
    localStorageMock.setItem('chaosmonkey_tool_cost_config_cursor', JSON.stringify({ monthlySpend: 100 }))
    // devA: 12 sessions, 5 commits each → avg 5.0, allocated $50, cost/commit = $10
    // devB: 12 sessions, 2 commits each → avg 2.0, allocated $50, cost/commit = $25
    // devC: 12 sessions, 5 commits each → avg 5.0, allocated $50, cost/commit = $10
    // devA and devC tie → both on frontier. devB dominated.
    const sessions = [
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devA',
        session_commits: 5,
        session_commits_source: 'observed',
      })),
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devB',
        session_commits: 2,
        session_commits_source: 'observed',
      })),
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devC',
        session_commits: 5,
        session_commits_source: 'observed',
      })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateDeveloperWorkflowCostEfficiencyFrontier(input)
    expect(result).not.toBeNull()
    // devA and devC both at 5.0 commits/session, $10/commit → both non-dominated
    // devB at 2.0 commits/session, $25/commit → dominated by both
    expect(result!.current).toBe(2) // devA + devC on frontier
  })

  it('excludes non-invite-backed developer identity', () => {
    localStorageMock.setItem('chaosmonkey_tool_cost_config_cursor', JSON.stringify({ monthlySpend: 100 }))
    // devA: invite-backed, 12 sessions
    // legacy_dev: NOT invite-backed, 12 sessions → should be excluded
    const sessions = [
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devA',
        session_commits: 2,
        session_commits_source: 'observed',
      })),
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'legacy_dev',
        session_commits: 5,
        session_commits_source: 'observed',
      })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateDeveloperWorkflowCostEfficiencyFrontier(input)
    // Only devA qualifies (invite-backed). legacy_dev excluded.
    // Cohort = 1 < 2 → returns null
    expect(result).toBeNull()
  })

  it('falls back to active_coding metric when commits unavailable', () => {
    localStorageMock.setItem('chaosmonkey_tool_cost_config_cursor', JSON.stringify({ monthlySpend: 100 }))
    // No session_commits field, but session_active_coding_duration_minutes is present
    const sessions = [
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devA',
        session_active_coding_duration_minutes: 30,
      })),
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devB',
        session_active_coding_duration_minutes: 60,
      })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateDeveloperWorkflowCostEfficiencyFrontier(input)
    expect(result).not.toBeNull()
    expect(result!.title.toLowerCase()).toContain('active coding')
  })

  it('discloses configured estimate caveat (not billing data)', () => {
    localStorageMock.setItem('chaosmonkey_tool_cost_config_cursor', JSON.stringify({ monthlySpend: 100 }))
    const sessions = [
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devA',
        session_commits: 2,
        session_commits_source: 'observed',
      })),
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devB',
        session_commits: 3,
        session_commits_source: 'observed',
      })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateDeveloperWorkflowCostEfficiencyFrontier(input)
    expect(result).not.toBeNull()
    // Must disclose configured estimate, not billing data
    expect(result!.primaryRisk.toLowerCase()).toContain('configured estimate')
    expect(result!.primaryRisk.toLowerCase()).toContain('not billing')
    // Must disclose neutral task/repo-mix caveat
    expect(result!.primaryRisk.toLowerCase()).toContain('task/repo-mix')
    // Must state NOT employee-performance judgment
    expect(result!.primaryRisk.toLowerCase()).toContain('not an employee-performance judgment')
  })

  it('does not claim causal attribution', () => {
    localStorageMock.setItem('chaosmonkey_tool_cost_config_cursor', JSON.stringify({ monthlySpend: 100 }))
    const sessions = [
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devA',
        session_commits: 2,
        session_commits_source: 'observed',
      })),
      ...Array.from({ length: 12 }, () => ({
        tool: 'cursor',
        user_id: 'invite:devB',
        session_commits: 3,
        session_commits_source: 'observed',
      })),
    ]
    const input: CanonicalInsightInput = { sessionRows: sessions, granularity: 'week', externalCostConfigs: [{ toolId: 'cursor', monthlySpend: 100, seatCount: 1, costPerSeatMonthly: 100, updatedAt: '2026-07-01T00:00:00Z' }] }
    const result = generateDeveloperWorkflowCostEfficiencyFrontier(input)
    expect(result).not.toBeNull()
    expect(result!.primaryRisk.toLowerCase()).toContain('no causal')
  })
})
