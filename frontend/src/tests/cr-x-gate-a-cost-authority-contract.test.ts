/**
 * CR-X Gate A (reopened): Cost-authority contract — one explicit authority.
 *
 * Proves:
 * 1. fetchOrgToolCostConfigsWithAuthority returns authority state
 * 2. backend_persisted: backend configs are authoritative
 * 3. backend_empty: localStorage is NOT presented as org truth
 * 4. backend_unavailable: localStorage is graceful degradation fallback
 * 5. PBT pbtCostConfigs respects backend_empty (returns [])
 * 6. Repo normalization: normalizeRepoUrl matches canonical IDs
 * 7. Filtered repo economics uses normalizeRepoUrl (source contract)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

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

import { fetchOrgToolCostConfigsWithAuthority, getToolCostConfig, setToolCostConfig } from '../lib/toolCost'
import { normalizeRepoUrl } from '../lib/repoNormalization'

describe('CR-X Gate A (reopened): Cost-authority contract', () => {
  beforeEach(() => {
    // Ensure globalThis.localStorage exists (node test env only has window.localStorage)
    if (typeof (globalThis as any).localStorage === 'undefined') {
      ;(globalThis as any).localStorage = (window as any).localStorage
    }
    // Clear localStorage
    if (typeof window !== 'undefined') {
      window.localStorage.clear()
    }
    ;(globalThis as any).localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (typeof window !== 'undefined') {
      window.localStorage.clear()
    }
    ;(globalThis as any).localStorage.clear()
  })

  it('fetchOrgToolCostConfigsWithAuthority returns authority state', async () => {
    // Mock backend unavailable
    apiMock.get.mockRejectedValue(new Error('Network error'))
    const result = await fetchOrgToolCostConfigsWithAuthority()
    expect(result).toHaveProperty('authority')
    expect(result).toHaveProperty('configs')
    expect(['backend_persisted', 'backend_empty', 'backend_unavailable']).toContain(result.authority)
  })

  it('backend_unavailable: localStorage is graceful degradation fallback', async () => {
    // Set localStorage config
    setToolCostConfig('cursor', { seatCount: 10, costPerSeatMonthly: 20 })
    // Mock backend unavailable
    apiMock.get.mockRejectedValue(new Error('Network error'))
    const result = await fetchOrgToolCostConfigsWithAuthority()
    expect(result.authority).toBe('backend_unavailable')
    expect(result.configs.length).toBeGreaterThan(0)
    // The config from localStorage should be present
    expect(result.configs.some(c => c.toolId === 'cursor')).toBe(true)
  })

  it('backend_empty: localStorage is NOT presented as org truth', async () => {
    // Set localStorage config
    setToolCostConfig('cursor', { seatCount: 10, costPerSeatMonthly: 20 })
    // Mock backend success but empty configs
    apiMock.get.mockResolvedValue({ status: 200, data: { configs: [], total_monthly_spend: 0 } })
    const result = await fetchOrgToolCostConfigsWithAuthority()
    expect(result.authority).toBe('backend_empty')
    expect(result.configs).toHaveLength(0)
    // localStorage config must NOT appear as org truth
    expect(result.configs.some(c => c.toolId === 'cursor')).toBe(false)
  })

  it('backend_persisted: backend configs are authoritative', async () => {
    // Mock backend success with persisted configs
    apiMock.get.mockResolvedValue({
      status: 200,
      data: {
        configs: [{
          tool_id: 'cursor',
          seat_count: 50,
          cost_per_seat_monthly: 20,
          monthly_spend: 1000,
          configured_at: '2026-01-01T00:00:00Z',
        }],
        total_monthly_spend: 1000,
      },
    })
    const result = await fetchOrgToolCostConfigsWithAuthority()
    expect(result.authority).toBe('backend_persisted')
    expect(result.configs).toHaveLength(1)
    expect(result.configs[0].monthlySpend).toBe(1000)
  })

  it('normalizeRepoUrl matches canonical IDs from raw URLs', () => {
    expect(normalizeRepoUrl('https://github.com/mattmcclintock/angrymonkey')).toBe('mattmcclintock/angrymonkey')
    expect(normalizeRepoUrl('https://github.com/mattmcclintock/angrymonkey.git')).toBe('mattmcclintock/angrymonkey')
    expect(normalizeRepoUrl('git@github.com:mattmcclintock/angrymonkey.git')).toBe('mattmcclintock/angrymonkey')
    expect(normalizeRepoUrl('mattmcclintock/angrymonkey')).toBe('mattmcclintock/angrymonkey')
    expect(normalizeRepoUrl(null)).toBeNull()
    expect(normalizeRepoUrl('')).toBeNull()
  })

  it('PBT filtered repo economics uses normalizeRepoUrl (source contract)', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    // The filtered repo economics must normalize the session repo URL
    // before comparing to selectedRepo.value
    expect(pbtSource).toContain('normalizeRepoUrl(String(rawRepo))')
    expect(pbtSource).toContain('normalized === selectedRepo.value')
  })

  it('PBT costConfigAuthority prop exists and is consumed', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(pbtSource).toContain('costConfigAuthority')
    expect(pbtSource).toContain('backend_empty')
    expect(pbtSource).toContain('backend_unavailable')
    expect(pbtSource).toContain('backend_persisted')
    // Must NOT present localStorage as org truth when backend_empty
    expect(pbtSource).toMatch(/backend_empty[\s\S]*?return \[\]/)
  })

  it('PBT surfaces truthful unavailable state when filtered but no cost data', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(pbtSource).toContain('costUnavailableMessage')
    expect(pbtSource).toContain('v3-cost-scope-unavailable')
    // Must NOT show contradictory "allocated" banner + "No cost data"
    // The unavailable banner only shows when !hasCostData
    expect(pbtSource).toMatch(/!hasCostData[\s\S]*?costUnavailableMessage/)
  })

  it('Dashboards.vue passes costConfigAuthority to PBT', () => {
    const dashSource = fs.readFileSync(
      path.resolve(__dirname, '../pages/Dashboards.vue'),
      'utf-8'
    )
    expect(dashSource).toContain('cost-config-authority')
    expect(dashSource).toContain('costConfigAuthority')
    expect(dashSource).toContain('fetchOrgToolCostConfigsWithAuthority')
  })
})
