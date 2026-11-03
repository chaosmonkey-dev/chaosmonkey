/**
 * CR-X Track C: Backend cost authority survives localStorage loss.
 *
 * Proves that PBT cost display can reconstruct the five-tool configuration
 * from backend authority after frontend/local fallback state is absent.
 *
 * This test mocks the backend GET to return the persisted 5-tool config
 * and verifies that:
 * 1. authority = 'backend_persisted' (not 'backend_unavailable')
 * 2. All 5 tools are present with correct monthly spend
 * 3. Total = $2660
 * 4. localStorage is NOT consulted (it's empty)
 * 5. PBT pbtCostConfigs would use backend authority, not fallback
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the canonical api client BEFORE importing toolCost
const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))
vi.mock('../config/api', () => ({
  default: apiMock,
  __esModule: true,
}))

import { fetchOrgToolCostConfigsWithAuthority } from '../lib/toolCost'

describe('CR-X Track C: Backend authority survives localStorage loss', () => {
  beforeEach(() => {
    if (typeof (globalThis as any).localStorage === 'undefined') {
      ;(globalThis as any).localStorage = (window as any).localStorage
    }
    ;(globalThis as any).localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    ;(globalThis as any).localStorage.clear()
  })

  it('returns backend_persisted with 5 tools when backend has configs, even with empty localStorage', async () => {
    // localStorage is empty — no fallback data
    expect((globalThis as any).localStorage.getItem('chaosmonkey_tool_cost_config_cursor')).toBeNull()

    // Mock backend GET returning the persisted 5-tool config
    const backendConfigs = [
      { tool_id: 'cursor', seat_count: 1, cost_per_seat_monthly: '500.00', monthly_spend: '500.00', configured_at: '2026-09-05T18:45:53.000000Z' },
      { tool_id: 'devin', seat_count: 3, cost_per_seat_monthly: '20.00', monthly_spend: '60.00', configured_at: '2026-09-05T18:45:53.000000Z' },
      { tool_id: 'vscode', seat_count: 4, cost_per_seat_monthly: '75.00', monthly_spend: '300.00', configured_at: '2026-09-05T18:45:53.000000Z' },
      { tool_id: 'claude-code', seat_count: 3, cost_per_seat_monthly: '250.00', monthly_spend: '750.00', configured_at: '2026-09-05T18:45:53.000000Z' },
      { tool_id: 'github-copilot', seat_count: 6, cost_per_seat_monthly: '175.00', monthly_spend: '1050.00', configured_at: '2026-09-05T18:45:53.000000Z' },
    ]

    apiMock.get.mockResolvedValue({ status: 200, data: { configs: backendConfigs, total_monthly_spend: 2660 } })

    const result = await fetchOrgToolCostConfigsWithAuthority()

    // Authority must be backend_persisted, not fallback
    expect(result.authority).toBe('backend_persisted')

    // All 5 tools present
    expect(result.configs).toHaveLength(5)

    // Exact per-tool values
    const byTool = Object.fromEntries(result.configs.map(c => [c.toolId, c.monthlySpend]))
    expect(byTool['cursor']).toBe(500)
    expect(byTool['devin']).toBe(60)
    expect(byTool['vscode']).toBe(300)
    expect(byTool['claude-code']).toBe(750)
    expect(byTool['github-copilot']).toBe(1050)

    // Total
    const total = result.configs.reduce((sum, c) => sum + c.monthlySpend, 0)
    expect(total).toBe(2660)

    // Highest = GitHub Copilot
    const highest = result.configs.reduce((max, c) => c.monthlySpend > max.monthlySpend ? c : max)
    expect(highest.toolId).toBe('github-copilot')
    expect(highest.monthlySpend).toBe(1050)
  })

  it('does NOT consult localStorage when backend_persisted', async () => {
    // Put stale data in localStorage
    ;(globalThis as any).localStorage.setItem(
      'chaosmonkey_tool_cost_config_cursor',
      JSON.stringify({ toolId: 'cursor', seatCount: 999, costPerSeatMonthly: 999, monthlySpend: 999, updatedAt: '2020-01-01' })
    )

    // Mock backend GET returning correct config
    apiMock.get.mockResolvedValue({
      status: 200,
      data: {
        configs: [
          { tool_id: 'cursor', seat_count: 1, cost_per_seat_monthly: '500.00', monthly_spend: '500.00', configured_at: '2026-09-05T18:45:53.000000Z' },
        ],
        total_monthly_spend: 500,
      },
    })

    const result = await fetchOrgToolCostConfigsWithAuthority()

    expect(result.authority).toBe('backend_persisted')
    // Backend value ($500), NOT stale localStorage ($999)
    expect(result.configs[0].monthlySpend).toBe(500)
    expect(result.configs[0].monthlySpend).not.toBe(999)
  })

  it('backend_empty does NOT fall back to localStorage as org truth', async () => {
    // Put data in localStorage
    ;(globalThis as any).localStorage.setItem(
      'chaosmonkey_tool_cost_config_cursor',
      JSON.stringify({ toolId: 'cursor', seatCount: 10, costPerSeatMonthly: 100, monthlySpend: 1000, updatedAt: '2026-01-01' })
    )

    // Mock backend success but empty configs
    apiMock.get.mockResolvedValue({ status: 200, data: { configs: [], total_monthly_spend: 0 } })

    const result = await fetchOrgToolCostConfigsWithAuthority()

    expect(result.authority).toBe('backend_empty')
    expect(result.configs).toHaveLength(0)
    // localStorage data must NOT appear
    expect(result.configs.some(c => c.toolId === 'cursor')).toBe(false)
  })
})
