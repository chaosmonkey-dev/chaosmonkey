/**
 * CR-X ECON-1: Backend cost authority regression tests.
 *
 * Proves:
 * 1. saveOrgToolCostConfig does NOT silently fall back to localStorage on backend failure
 * 2. clearOrgToolCostConfig calls backend DELETE (not localStorage)
 * 3. clearAllOrgToolCostConfigs calls backend DELETE-all (not localStorage)
 * 4. PBT editor load reads from backend-resolved pbtCostConfigs (source contract)
 * 5. PBT editor save calls saveOrgToolCostConfig (source contract)
 * 6. PBT editor clear calls clearAllOrgToolCostConfigs (source contract)
 * 7. PBT summary/card reads use pbtCostConfigs, not getToolCostConfig (source contract)
 * 8. Dashboards stores full cost config (seatCount, costPerSeatMonthly) (source contract)
 * 9. Dashboards listens for refresh-cost-configs event (source contract)
 * 10. ConnectIDEs uses backend authority (source contract)
 * 11. Backend SpendController validates canonical tool_id (source contract)
 * 12. Backend has destroyAll endpoint (source contract)
 * 13. toolCost uses canonical api client (not raw fetch with wrong token)
 * 14. toolCost does NOT use auth_token (must use api_token via api client)
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

import {
  saveOrgToolCostConfig,
  clearOrgToolCostConfig,
  clearAllOrgToolCostConfigs,
  fetchOrgToolCostConfigsWithAuthority,
  setToolCostConfig,
  getToolCostConfig,
} from '../lib/toolCost'

describe('CR-X ECON-1: Backend cost authority', () => {
  beforeEach(() => {
    if (typeof (globalThis as any).localStorage === 'undefined') {
      ;(globalThis as any).localStorage = (window as any).localStorage
    }
    if (typeof window !== 'undefined') {
      window.localStorage.clear()
    }
    ;(globalThis as any).localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (typeof window !== 'undefined') {
      window.localStorage.clear()
    }
    ;(globalThis as any).localStorage.clear()
  })

  // ── saveOrgToolCostConfig ────────────────────────────────────────

  it('saveOrgToolCostConfig returns config on backend success', async () => {
    apiMock.put.mockResolvedValue({ status: 200, data: {} })
    const result = await saveOrgToolCostConfig('cursor', { seatCount: 10, costPerSeatMonthly: 20 })
    expect(result).not.toBeNull()
    expect(result!.toolId).toBe('cursor')
    expect(result!.monthlySpend).toBe(200)
  })

  it('saveOrgToolCostConfig emits the expected PUT payload for non-zero values', async () => {
    apiMock.put.mockResolvedValue({ status: 200, data: {} })
    await saveOrgToolCostConfig('cursor', { seatCount: 10, costPerSeatMonthly: 20 })
    expect(apiMock.put).toHaveBeenCalledWith('/api/org/spend/config', {
      tool_id: 'cursor',
      seat_count: 10,
      cost_per_seat_monthly: 20,
    })
  })

  it('saveOrgToolCostConfig does NOT silently fall back to localStorage on backend failure', async () => {
    // Pre-seed localStorage with a stale config
    setToolCostConfig('cursor', { seatCount: 99, costPerSeatMonthly: 99 })
    // Mock backend failure
    apiMock.put.mockRejectedValue(new Error('Network error'))
    const result = await saveOrgToolCostConfig('cursor', { seatCount: 10, costPerSeatMonthly: 20 })
    // Must return null (fail visibly), NOT fall back to localStorage
    expect(result).toBeNull()
    // localStorage must NOT have been updated with the new values
    const lsConfig = getToolCostConfig('cursor')
    expect(lsConfig?.seatCount).toBe(99)
    expect(lsConfig?.seatCount).not.toBe(10)
  })

  it('saveOrgToolCostConfig returns null on backend non-ok response', async () => {
    apiMock.put.mockResolvedValue({ status: 500, data: { error: 'Internal server error' } })
    const result = await saveOrgToolCostConfig('cursor', { seatCount: 10, costPerSeatMonthly: 20 })
    expect(result).toBeNull()
  })

  // ── clearOrgToolCostConfig ───────────────────────────────────────

  it('clearOrgToolCostConfig calls backend DELETE and returns true on success', async () => {
    apiMock.delete.mockResolvedValue({ status: 200, data: {} })
    const result = await clearOrgToolCostConfig('cursor')
    expect(result).toBe(true)
    expect(apiMock.delete).toHaveBeenCalledWith('/api/org/spend/config/cursor')
  })

  it('clearOrgToolCostConfig returns false on backend failure', async () => {
    apiMock.delete.mockRejectedValue(new Error('Network error'))
    const result = await clearOrgToolCostConfig('cursor')
    expect(result).toBe(false)
  })

  it('clearOrgToolCostConfig treats 404 as success', async () => {
    apiMock.delete.mockResolvedValue({ status: 404, data: {} })
    const result = await clearOrgToolCostConfig('cursor')
    expect(result).toBe(true)
  })

  // ── clearAllOrgToolCostConfigs ───────────────────────────────────

  it('clearAllOrgToolCostConfigs calls backend DELETE-all and returns true on success', async () => {
    apiMock.delete.mockResolvedValue({ status: 200, data: { message: 'all deleted', deleted_count: 3 } })
    const result = await clearAllOrgToolCostConfigs()
    expect(result).toBe(true)
    expect(apiMock.delete).toHaveBeenCalledWith('/api/org/spend/config')
  })

  it('clearAllOrgToolCostConfigs returns false on backend failure', async () => {
    apiMock.delete.mockRejectedValue(new Error('Network error'))
    const result = await clearAllOrgToolCostConfigs()
    expect(result).toBe(false)
  })

  // ── fetchOrgToolCostConfigsWithAuthority ───────────────────────

  it('fetchOrgToolCostConfigsWithAuthority uses canonical api client (not raw fetch)', async () => {
    apiMock.get.mockResolvedValue({ status: 200, data: { configs: [] } })
    await fetchOrgToolCostConfigsWithAuthority()
    expect(apiMock.get).toHaveBeenCalledWith('/api/org/spend/config')
  })

  it('fetchOrgToolCostConfigsWithAuthority returns backend_empty on success with no configs', async () => {
    apiMock.get.mockResolvedValue({ status: 200, data: { configs: [] } })
    const result = await fetchOrgToolCostConfigsWithAuthority()
    expect(result.authority).toBe('backend_empty')
    expect(result.configs).toEqual([])
  })

  it('fetchOrgToolCostConfigsWithAuthority returns backend_persisted when configs exist', async () => {
    apiMock.get.mockResolvedValue({
      status: 200,
      data: { configs: [{ tool_id: 'cursor', seat_count: 5, cost_per_seat_monthly: 20, monthly_spend: 100 }] },
    })
    const result = await fetchOrgToolCostConfigsWithAuthority()
    expect(result.authority).toBe('backend_persisted')
    expect(result.configs.length).toBe(1)
    expect(result.configs[0].toolId).toBe('cursor')
  })

  it('fetchOrgToolCostConfigsWithAuthority returns backend_unavailable on failure', async () => {
    apiMock.get.mockRejectedValue(new Error('Network error'))
    const result = await fetchOrgToolCostConfigsWithAuthority()
    expect(result.authority).toBe('backend_unavailable')
  })

  // ── Canonical api client contract (P2 fix) ──────────────────────

  it('toolCost.ts imports the canonical api client (not raw fetch)', () => {
    const toolCostSource = fs.readFileSync(
      path.resolve(__dirname, '../lib/toolCost.ts'),
      'utf-8'
    )
    expect(toolCostSource).toContain("import api from '../config/api'")
    // Must NOT use raw fetch for spend/config endpoints
    expect(toolCostSource).not.toContain('fetch(`${apiBase}/api/org/spend/config')
    // Must NOT use auth_token (the wrong token — must use api_token via api client)
    expect(toolCostSource).not.toContain("getItem('auth_token')")
  })

  it('toolCost.ts does NOT contain raw fetch calls for spend endpoints', () => {
    const toolCostSource = fs.readFileSync(
      path.resolve(__dirname, '../lib/toolCost.ts'),
      'utf-8'
    )
    // No raw fetch to /api/org/spend/config anywhere
    const fetchMatches = toolCostSource.match(/fetch\([^)]*spend\/config/g)
    expect(fetchMatches).toBeNull()
  })

  // ── PBT source contracts ─────────────────────────────────────────

  it('PBT editor load reads from pbtCostConfigs (not getToolCostConfig)', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    // Editor load watcher must reference pbtCostConfigs
    expect(pbtSource).toMatch(/watch\(showCostEditor[\s\S]*?pbtCostConfigs\.value/)
    // Must NOT call getToolCostConfig inside the editor load watcher
    const editorLoadSection = pbtSource.match(/watch\(showCostEditor[\s\S]*?\}\)\s*\n\s*\n/)
    expect(editorLoadSection).toBeTruthy()
    expect(editorLoadSection![0]).not.toContain('getToolCostConfig(toolId)')
  })

  it('PBT editor save calls saveOrgToolCostConfig (not setToolCostConfig)', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(pbtSource).toContain('saveOrgToolCostConfig')
    // saveCostEditor must NOT call setToolCostConfig
    const saveSection = pbtSource.match(/const saveCostEditor[\s\S]*?\n}\n/)
    expect(saveSection).toBeTruthy()
    expect(saveSection![0]).not.toContain('setToolCostConfig')
    // Must emit refresh-cost-configs
    expect(saveSection![0]).toContain("emit('refresh-cost-configs')")
  })

  it('PBT editor save only sends rows with non-zero values', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    const saveSection = pbtSource.match(/const saveCostEditor[\s\S]*?\n}\n/)
    expect(saveSection).toBeTruthy()
    expect(saveSection![0]).toContain('costEditorState.value[toolId]')
    expect(saveSection![0]).toContain('config.seatCount > 0 || config.costPerSeatMonthly > 0')
    expect(saveSection![0]).toContain('savePromises.push(saveOrgToolCostConfig')
  })

  it('PBT editor save surfaces failure and keeps the modal open', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    const saveSection = pbtSource.match(/const saveCostEditor[\s\S]*?\n}\n/)
    expect(saveSection).toBeTruthy()
    expect(saveSection![0]).toContain('costSaveError')
    expect(saveSection![0]).toMatch(/results\.filter\(r => r === null\)\.length/)
    expect(saveSection![0]).toMatch(/if \(\s*failures\s*>\s*0\s*\)/)
    // showCostEditor.value = false must only appear after the failure guard
    expect(saveSection![0]).toMatch(/if \(failures > 0\)[\s\S]*?return[\s\S]*?showCostEditor\.value = false/)
  })

  it('PBT editor clear calls clearAllOrgToolCostConfigs (not clearToolCostConfig)', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(pbtSource).toContain('clearAllOrgToolCostConfigs')
    // clearCostEditor must NOT call clearToolCostConfig
    const clearSection = pbtSource.match(/const clearCostEditor[\s\S]*?\n}\n/)
    expect(clearSection).toBeTruthy()
    expect(clearSection![0]).not.toContain('clearToolCostConfig')
    // Must emit refresh-cost-configs
    expect(clearSection![0]).toContain("emit('refresh-cost-configs')")
  })

  it('PBT totalMonthlySpend reads from pbtCostConfigs (not getToolCostConfig)', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    const totalSection = pbtSource.match(/const totalMonthlySpend = computed[\s\S]*?\n}\n/)
    expect(totalSection).toBeTruthy()
    expect(totalSection![0]).toContain('pbtCostConfigs.value')
    expect(totalSection![0]).not.toContain('getToolCostConfig')
  })

  it('PBT highestSpendTool reads from pbtCostConfigs (not getToolCostConfig)', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    const toolSection = pbtSource.match(/const highestSpendTool = computed[\s\S]*?\n}\n/)
    expect(toolSection).toBeTruthy()
    expect(toolSection![0]).toContain('pbtCostConfigs.value')
    expect(toolSection![0]).not.toContain('getToolCostConfig')
  })

  it('PBT highestSpendAmount reads from pbtCostConfigs (not getToolCostConfig)', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    const amountSection = pbtSource.match(/const highestSpendAmount = computed[\s\S]*?\n}\n/)
    expect(amountSection).toBeTruthy()
    expect(amountSection![0]).toContain('pbtCostConfigs.value')
    expect(amountSection![0]).not.toContain('getToolCostConfig')
  })

  it('PBT getMonthlyCostForCard uses authority-aware getResolvedCostConfig', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(pbtSource).toContain('function getResolvedCostConfig')
    expect(pbtSource).toContain('pbtCostConfigs.value.find')
    // getMonthlyCostForCard must use getResolvedCostConfig
    const costForCardSection = pbtSource.match(/function getMonthlyCostForCard[\s\S]*?\n}\n/)
    expect(costForCardSection).toBeTruthy()
    expect(costForCardSection![0]).toContain('getResolvedCostConfig')
    expect(costForCardSection![0]).not.toContain('getToolCostConfig')
  })

  it('PBT getIDEMonthlyCost uses authority-aware getResolvedCostConfig', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    const ideSection = pbtSource.match(/function getIDEMonthlyCost[\s\S]*?\n}\n/)
    expect(ideSection).toBeTruthy()
    expect(ideSection![0]).toContain('getResolvedCostConfig')
    expect(ideSection![0]).not.toContain('getToolCostConfig')
  })

  it('PBT developerWorkflowAllocations reads from pbtCostConfigs (not getToolMonthlySpend)', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    const allocSection = pbtSource.match(/const developerWorkflowAllocations = computed[\s\S]*?\n}\n/)
    expect(allocSection).toBeTruthy()
    expect(allocSection![0]).toContain('pbtCostConfigs.value')
    expect(allocSection![0]).not.toContain('getToolMonthlySpend')
  })

  it('PBT emits refresh-cost-configs', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(pbtSource).toContain("defineEmits(['refresh-cost-configs'])")
  })

  it('PBT pbtCostConfigs uses full backend config (seatCount, costPerSeatMonthly)', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    const configsSection = pbtSource.match(/const pbtCostConfigs = computed[\s\S]*?\n}\n/)
    expect(configsSection).toBeTruthy()
    expect(configsSection![0]).toContain('c.seatCount')
    expect(configsSection![0]).toContain('c.costPerSeatMonthly')
  })

  // ── Dashboards source contracts ─────────────────────────────────

  it('Dashboards stores full cost config (seatCount, costPerSeatMonthly)', () => {
    const dashSource = fs.readFileSync(
      path.resolve(__dirname, '../pages/Dashboards.vue'),
      'utf-8'
    )
    expect(dashSource).toContain('seatCount: c.seatCount')
    expect(dashSource).toContain('costPerSeatMonthly: c.costPerSeatMonthly')
  })

  it('Dashboards listens for refresh-cost-configs event', () => {
    const dashSource = fs.readFileSync(
      path.resolve(__dirname, '../pages/Dashboards.vue'),
      'utf-8'
    )
    expect(dashSource).toContain('@refresh-cost-configs')
    expect(dashSource).toContain('refreshCostConfigs')
  })

  it('Dashboards refreshCostConfigs re-fetches backend authority', () => {
    const dashSource = fs.readFileSync(
      path.resolve(__dirname, '../pages/Dashboards.vue'),
      'utf-8'
    )
    const refreshSection = dashSource.match(/const refreshCostConfigs = async[\s\S]*?\n}\n/)
    expect(refreshSection).toBeTruthy()
    expect(refreshSection![0]).toContain('fetchOrgToolCostConfigsWithAuthority')
    expect(refreshSection![0]).toContain('seatCount: c.seatCount')
    expect(refreshSection![0]).toContain('costPerSeatMonthly: c.costPerSeatMonthly')
  })

  // 18B.4 regression: cost persistence failure reproduced in browser.
  // Hard refresh landing on #productivity sets pbtActive=true, which makes
  // scheduleRefreshPI skip refreshPI — and the cost-config fetch lived
  // exclusively inside refreshPI. resolvedCostConfigs stayed empty, so
  // pbtCostConfigs fell back to stale localStorage and the editor showed
  // pre-save values after the PUT had already persisted. The PBT surface
  // must fetch cost authority independent of refreshPI.

  it('Dashboards fetches cost authority when PBT mounts (not only inside refreshPI)', () => {
    const dashSource = fs.readFileSync(
      path.resolve(__dirname, '../pages/Dashboards.vue'),
      'utf-8'
    )
    const mountSection = dashSource.match(/function onPbtMounted[\s\S]*?\n}\n/)
    expect(mountSection).toBeTruthy()
    expect(mountSection![0]).toContain('refreshCostConfigs')
  })

  it('Dashboards fetches cost authority when the Productivity tab activates', () => {
    const dashSource = fs.readFileSync(
      path.resolve(__dirname, '../pages/Dashboards.vue'),
      'utf-8'
    )
    const tabSection = dashSource.match(/shown\.bs\.tab[\s\S]*?targetPane === '#productivity'[\s\S]*?refreshCostConfigs/)
    expect(tabSection).toBeTruthy()
  })

  it('cost authority fetch has a call site outside refreshPI (pbtActive skip cannot starve it)', () => {
    const dashSource = fs.readFileSync(
      path.resolve(__dirname, '../pages/Dashboards.vue'),
      'utf-8'
    )
    // The pbtActive skip guard must still exist (17G.8 contract)
    expect(dashSource).toContain('skipped-pbt-active')
    // refreshCostConfigs() must be invoked at least twice outside its own
    // definition: PBT mount + tab activation (the emit binding is a
    // template attribute, not a call site).
    const callSites = dashSource.match(/refreshCostConfigs\(\)/g) || []
    expect(callSites.length).toBeGreaterThanOrEqual(2)
  })

  // ── ConnectIDEs source contracts ─────────────────────────────────

  it('ConnectIDEs uses backend authority for load', () => {
    const ideSource = fs.readFileSync(
      path.resolve(__dirname, '../pages/ConnectIDEs.vue'),
      'utf-8'
    )
    expect(ideSource).toContain('fetchOrgToolCostConfigsWithAuthority')
    // Must NOT use setToolCostConfig
    expect(ideSource).not.toContain('setToolCostConfig')
    // Must NOT use clearAllToolCostConfigs (localStorage)
    expect(ideSource).not.toContain('clearAllToolCostConfigs')
  })

  it('ConnectIDEs uses backend authority for save', () => {
    const ideSource = fs.readFileSync(
      path.resolve(__dirname, '../pages/ConnectIDEs.vue'),
      'utf-8'
    )
    expect(ideSource).toContain('saveOrgToolCostConfig')
    expect(ideSource).toContain('clearOrgToolCostConfig')
  })

  it('ConnectIDEs uses backend authority for clear-all', () => {
    const ideSource = fs.readFileSync(
      path.resolve(__dirname, '../pages/ConnectIDEs.vue'),
      'utf-8'
    )
    expect(ideSource).toContain('clearAllOrgToolCostConfigs')
  })

  // ── Backend source contracts ─────────────────────────────────────

  it('Backend SpendController validates canonical tool_id', () => {
    const controllerSource = fs.readFileSync(
      path.resolve(__dirname, '../../../backend/app/Http/Controllers/SpendController.php'),
      'utf-8'
    )
    expect(controllerSource).toContain('in:cursor,devin,vscode,claude-code,github-copilot')
  })

  it('Backend SpendController has destroyAll method', () => {
    const controllerSource = fs.readFileSync(
      path.resolve(__dirname, '../../../backend/app/Http/Controllers/SpendController.php'),
      'utf-8'
    )
    expect(controllerSource).toContain('public function destroyAll')
  })

  it('Backend routes register DELETE /api/org/spend/config (destroyAll)', () => {
    const routesSource = fs.readFileSync(
      path.resolve(__dirname, '../../../backend/routes/api.php'),
      'utf-8'
    )
    expect(routesSource).toContain("SpendController::class, 'destroyAll'")
  })

  it('Backend routes register destroyAll before {tool_id} (no route conflict)', () => {
    const routesSource = fs.readFileSync(
      path.resolve(__dirname, '../../../backend/routes/api.php'),
      'utf-8'
    )
    const destroyAllIdx = routesSource.indexOf("SpendController::class, 'destroyAll'")
    const destroyIdx = routesSource.indexOf("SpendController::class, 'destroy'")
    expect(destroyAllIdx).toBeGreaterThan(-1)
    expect(destroyIdx).toBeGreaterThan(-1)
    // destroyAll must appear before destroy (the {tool_id} route)
    expect(destroyAllIdx).toBeLessThan(destroyIdx)
  })

  // ── Customer-facing copy truth (ECON-1) ──────────────────────────

  it('PBT cost editor subtitle says "Saved for this organization" (not "Stored locally for pilot")', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    // CR-X ECON-1: cost config is backend-persisted (org-scoped), not localStorage
    expect(pbtSource).toContain('Saved for this organization')
    // Must NOT claim localStorage / local-only storage to the customer
    expect(pbtSource).not.toContain('Stored locally for pilot')
    expect(pbtSource).not.toContain('Stored locally for this browser')
    expect(pbtSource).not.toContain('Saved locally for pilot')
  })

  // ── 18B.6: per-tool 0/0 must clear the persisted backend row ─────
  // Root cause of the Ed zero/save failure: the save loop only emitted a
  // PUT for nonzero rows, so zeroing a persisted tool produced no request
  // and the stale nonzero row resurrected on reload. 0/0 must DELETE.

  it('PBT saveCostEditor issues clearOrgToolCostConfig for persisted rows zeroed to 0/0', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    const saveBody = pbtSource.slice(
      pbtSource.indexOf('const saveCostEditor'),
      pbtSource.indexOf('const clearCostEditor')
    )
    expect(saveBody).toContain('clearOrgToolCostConfig(toolId)')
    expect(saveBody).toContain('persistedToolIds.has(toolId)')
    // The persisted set must come from backend authority, not localStorage.
    expect(saveBody).toContain('pbtCostConfigs.value.map')
    expect(saveBody).not.toContain('getLocalToolCostConfigs')
  })

  it('PBT saveCostEditor still PUTs nonzero rows and skips never-configured zero rows', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    const saveBody = pbtSource.slice(
      pbtSource.indexOf('const saveCostEditor'),
      pbtSource.indexOf('const clearCostEditor')
    )
    // Nonzero rows still PUT
    expect(saveBody).toContain('saveOrgToolCostConfig(toolId')
    // Zero rows only DELETE when a persisted backend config exists —
    // a never-configured 0/0 row must not emit a useless request.
    expect(saveBody).toMatch(/seatCount > 0 \|\| config\.costPerSeatMonthly > 0/)
    expect(saveBody).toContain('} else if (persistedToolIds.has(toolId))')
  })

  it('PBT imports clearOrgToolCostConfig (per-tool DELETE helper)', () => {
    const pbtSource = fs.readFileSync(
      path.resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(pbtSource).toMatch(/import \{[^}]*clearOrgToolCostConfig[^}]*\} from '@\/lib\/toolCost'/)
  })
})
