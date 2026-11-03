/**
 * Tool Cost Utilities - Configured spend tracking
 *
 * CR-X Track C: Org-scoped backend persistence with localStorage fallback.
 * Configured spend is customer-entered cost configuration (seat count × cost/seat).
 * It is NOT billing data — it is the customer's own configured estimate.
 *
 * STORAGE: Backend (org-scoped) with localStorage fallback for offline/dev
 * NORMALIZATION: Devin and Windsurf share the same cost bucket
 */

import api from '../config/api'

export const COST_SUPPORTED_TOOLS = ['cursor', 'devin', 'vscode', 'claude-code', 'github-copilot', 'codex'] as const
export type CostToolId = typeof COST_SUPPORTED_TOOLS[number]

const STORAGE_KEY_PREFIX = 'chaosmonkey_tool_cost_config_'

export type ToolCostConfig = {
  toolId: string
  seatCount: number
  costPerSeatMonthly: number
  monthlySpend: number
  updatedAt: string
}

/**
 * Normalize tool IDs for cost storage
 * Maps all variants to canonical hyphenated IDs
 * Devin and Windsurf share the same cost bucket
 */
export function normalizeCostToolId(toolId: string): CostToolId | string {
  // Generic normalization first: lowercase, trim, replace spaces/underscores with hyphens
  let normalized = toolId.toLowerCase().trim()
  // Replace spaces and underscores with hyphens
  normalized = normalized.replace(/[\s_]+/g, '-')
  // Collapse repeated hyphens
  normalized = normalized.replace(/-+/g, '-')
  // Remove trailing -workflow suffix
  normalized = normalized.replace(/-workflow$/, '')

  // Windsurf telemetry uses Devin cost bucket
  if (normalized === 'windsurf') return 'devin'

  // Canonical ID mapping after generic normalization
  const aliasMap: Record<string, CostToolId> = {
    'claude-code': 'claude-code',
    'claude-code-workflow': 'claude-code',
    'github-copilot': 'github-copilot',
    'github-copilot-workflow': 'github-copilot',
    'copilot': 'github-copilot',
    'vs-code': 'vscode',
    'vscode': 'vscode',
    'vs-code-workflow': 'vscode',
    'cursor': 'cursor',
    'cursor-workflow': 'cursor',
    'devin': 'devin',
    'devin-workflow': 'devin',
    'codex': 'codex',
    'codex-workflow': 'codex',
    'codex-cli': 'codex',
    'openai-codex': 'codex'
  }

  return aliasMap[normalized] || normalized
}

/**
 * CR-X FINAL (Wave 3): Map a cost-storage / API tool ID (hyphenated)
 * to the canonical workflow ID used by telemetry and PI.
 *
 * Storage uses hyphenated IDs: 'claude-code', 'github-copilot'.
 * Workflow identity uses underscored IDs: 'claude_code', 'github_copilot'.
 * This is the ONE boundary where cost identity becomes workflow identity.
 */
export function costToolIdToCanonicalWorkflowId(costToolId: string): string {
  const id = (costToolId || '').toLowerCase().trim()
  const map: Record<string, string> = {
    'claude-code': 'claude_code',
    'github-copilot': 'github_copilot',
    'vscode': 'vscode',
    'vs-code': 'vscode',
    'cursor': 'cursor',
    'devin': 'devin',
    'codex': 'codex',
  }
  return map[id] || id.replace(/-/g, '_')
}

/**
 * CR-X FINAL (Wave 3): Normalize a raw backend cost DTO or a resolved DTO
 * to the canonical ToolCostConfig shape.
 *
 * Handles both snake_case (tool_id, monthly_spend, cost_per_seat_monthly,
 * seat_count) and camelCase (toolId, monthlySpend, costPerSeatMonthly,
 * seatCount) field names. The returned toolId is in the canonical camelCase.
 */
export function normalizeCostConfigInput(raw: any): ToolCostConfig | null {
  if (!raw || typeof raw !== 'object') return null

  const toolIdField = typeof raw.toolId === 'string' ? raw.toolId
    : typeof raw.tool_id === 'string' ? raw.tool_id
    : typeof raw.tool === 'string' ? raw.tool
    : null

  const monthlySpend = typeof raw.monthlySpend === 'number' ? raw.monthlySpend
    : typeof raw.monthly_spend === 'number' ? raw.monthly_spend
    : typeof raw.monthly_spend === 'string' ? parseFloat(raw.monthly_spend)
    : null

  if (!toolIdField || monthlySpend === null || !Number.isFinite(monthlySpend)) {
    return null
  }

  return {
    toolId: toolIdField,
    seatCount: Number(raw.seatCount ?? raw.seat_count ?? 0) || 0,
    costPerSeatMonthly: Number(raw.costPerSeatMonthly ?? raw.cost_per_seat_monthly ?? 0) || 0,
    monthlySpend,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? raw.configured_at ?? new Date().toISOString(),
  }
}

/**
 * Get tool cost config from localStorage
 * Returns null if no config exists
 */
export function getToolCostConfig(toolId: string): ToolCostConfig | null {
  try {
    const normalizedId = normalizeCostToolId(toolId)
    const key = `${STORAGE_KEY_PREFIX}${normalizedId}`
    const value = localStorage.getItem(key)

    if (value === null || value === '') return null

    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null

    return {
      toolId: parsed.toolId || normalizedId,
      seatCount: typeof parsed.seatCount === 'number' ? parsed.seatCount : 0,
      costPerSeatMonthly: typeof parsed.costPerSeatMonthly === 'number' ? parsed.costPerSeatMonthly : 0,
      monthlySpend: typeof parsed.monthlySpend === 'number' ? parsed.monthlySpend : 0,
      updatedAt: parsed.updatedAt || new Date().toISOString()
    }
  } catch {
    return null
  }
}

/**
 * Set tool cost config in localStorage
 * Computes monthlySpend = seatCount * costPerSeatMonthly
 */
export function setToolCostConfig(
  toolId: string,
  config: { seatCount: number; costPerSeatMonthly: number }
): ToolCostConfig {
  const normalizedId = normalizeCostToolId(toolId)
  const monthlySpend = config.seatCount * config.costPerSeatMonthly

  const toolConfig: ToolCostConfig = {
    toolId: normalizedId,
    seatCount: config.seatCount,
    costPerSeatMonthly: config.costPerSeatMonthly,
    monthlySpend,
    updatedAt: new Date().toISOString()
  }

  try {
    const key = `${STORAGE_KEY_PREFIX}${normalizedId}`
    localStorage.setItem(key, JSON.stringify(toolConfig))
  } catch (error) {
    console.error('[toolCost] Failed to set cost config:', error)
  }

  return toolConfig
}

/**
 * Clear tool cost config
 */
export function clearToolCostConfig(toolId: string): void {
  try {
    const normalizedId = normalizeCostToolId(toolId)
    const key = `${STORAGE_KEY_PREFIX}${normalizedId}`
    localStorage.removeItem(key)
  } catch (error) {
    console.error('[toolCost] Failed to clear cost config:', error)
  }
}

/**
 * Clear all tool cost configs
 */
export function clearAllToolCostConfigs(): void {
  try {
    for (const toolId of COST_SUPPORTED_TOOLS) {
      clearToolCostConfig(toolId)
    }
  } catch (error) {
    console.error('[toolCost] Failed to clear all cost configs:', error)
  }
}

/**
 * Check if any cost data exists for any tool
 */
export function hasToolCostData(): boolean {
  try {
    for (const toolId of COST_SUPPORTED_TOOLS) {
      const config = getToolCostConfig(toolId)
      if (config && config.monthlySpend > 0) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Get monthly spend for a tool from config
 * Returns null if no cost data exists
 */
export function getToolMonthlySpend(toolId: string): number | null {
  const config = getToolCostConfig(toolId)
  if (!config || config.monthlySpend <= 0) return null
  return config.monthlySpend
}

/**
 * Compute spend per session
 * Returns em dash if no cost data or invalid inputs
 */
export function computeSpendPerSession(monthlySpend: number, sessionCount: number): string {
  if (!monthlySpend || monthlySpend <= 0) return '—'
  if (!sessionCount || sessionCount <= 0) return '—'

  const costPerSession = monthlySpend / sessionCount
  return formatCurrency(costPerSession)
}

/**
 * Compute spend per active coding hour
 * Returns em dash if no cost data or invalid inputs
 */
export function computeSpendPerActiveHour(monthlySpend: number, activeCodingMinutes: number): string {
  if (!monthlySpend || monthlySpend <= 0) return '—'
  if (!activeCodingMinutes || activeCodingMinutes <= 0) return '—'

  const activeCodingHours = activeCodingMinutes / 60
  const costPerHour = monthlySpend / activeCodingHours
  return formatCurrency(costPerHour)
}

/**
 * Compute cost efficiency label
 * Returns efficiency rating based on cost per session
 */
export function computeCostEfficiencyLabel(costPerSession: number): 'Excellent' | 'Good' | 'Fair' | 'Review' {
  if (costPerSession < 1) return 'Excellent'
  if (costPerSession < 2) return 'Good'
  if (costPerSession < 5) return 'Fair'
  return 'Review'
}

/**
 * Format currency value
 */
export function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`
}

/**
 * Cost-editor monthly-spend cell display — shared truth rule.
 *
 * Absent persisted configuration is NOT equivalent to configured $0:
 * - No persisted config AND untouched 0/0 draft → 'Not configured'
 * - No persisted config BUT admin entered a meaningful draft → computed preview
 * - Persisted config (including legitimate explicit $0.00) → computed value
 */
export function costMonthlySpendDisplay(opts: {
  persisted: boolean
  seatCount?: number | null
  costPerSeatMonthly?: number | null
}): string {
  const seats = opts.seatCount ?? 0
  const rate = opts.costPerSeatMonthly ?? 0
  if (!opts.persisted && seats <= 0 && rate <= 0) return 'Not configured'
  return formatCurrency(seats * rate)
}

// ============================================================
// CR-X Track C2-C3: Backend-persisted org-scoped cost config
// with localStorage fallback + windowed spend computation
// ============================================================

/**
 * Fetch all tool cost configs from backend (org-scoped).
 * Falls back to localStorage if backend unavailable.
 */
export async function fetchOrgToolCostConfigs(): Promise<ToolCostConfig[]> {
  const result = await fetchOrgToolCostConfigsWithAuthority()
  return result.configs
}

/**
 * CR-X Gate A: Cost-authority contract.
 * Returns configs with explicit authority state:
 * - 'backend_persisted': backend GET succeeded + persisted configs exist → backend is authoritative
 * - 'backend_empty': backend GET succeeded + no persisted configs → do NOT present localStorage as org truth
 * - 'backend_unavailable': backend GET failed → local fallback is graceful degradation only
 */
export type CostConfigAuthority = 'backend_persisted' | 'backend_empty' | 'backend_unavailable'

export interface CostConfigsWithAuthority {
  configs: ToolCostConfig[]
  authority: CostConfigAuthority
}

export async function fetchOrgToolCostConfigsWithAuthority(): Promise<CostConfigsWithAuthority> {
  try {
    const response = await api.get('/api/org/spend/config')
    if (response.status >= 400) {
      // Backend unavailable — graceful degradation to localStorage
      return { configs: getLocalToolCostConfigs(), authority: 'backend_unavailable' }
    }
    const data = response.data
    const configs: ToolCostConfig[] = (data.configs || []).map((c: any) => ({
      toolId: normalizeCostToolId(c.tool_id),
      seatCount: c.seat_count || 0,
      costPerSeatMonthly: parseFloat(c.cost_per_seat_monthly) || 0,
      monthlySpend: parseFloat(c.monthly_spend) || 0,
      updatedAt: c.configured_at || c.updated_at || new Date().toISOString(),
    }))
    if (configs.length > 0) {
      return { configs, authority: 'backend_persisted' }
    }
    // Backend succeeded but has no persisted configs
    return { configs: [], authority: 'backend_empty' }
  } catch {
    // Backend unavailable — graceful degradation to localStorage
    return { configs: getLocalToolCostConfigs(), authority: 'backend_unavailable' }
  }
}

/**
 * Save tool cost config to backend (org-scoped).
 * CR-X ECON-1: Does NOT silently fall back to localStorage.
 * Returns the saved config on success, or null on failure (caller must handle visibly).
 */
export async function saveOrgToolCostConfig(
  toolId: string,
  config: { seatCount: number; costPerSeatMonthly: number }
): Promise<ToolCostConfig | null> {
  const normalizedId = normalizeCostToolId(toolId)
  const monthlySpend = config.seatCount * config.costPerSeatMonthly

  try {
    const response = await api.put('/api/org/spend/config', {
      tool_id: normalizedId,
      seat_count: config.seatCount,
      cost_per_seat_monthly: config.costPerSeatMonthly,
    })
    if (response.status >= 400) {
      // CR-X ECON-1: fail visibly — do NOT silently write localStorage as shared persistence
      console.error('[toolCost] Backend save failed for', normalizedId, '— not falling back to localStorage')
      return null
    }
    return {
      toolId: normalizedId,
      seatCount: config.seatCount,
      costPerSeatMonthly: config.costPerSeatMonthly,
      monthlySpend,
      updatedAt: new Date().toISOString(),
    }
  } catch {
    // CR-X ECON-1: fail visibly — do NOT silently write localStorage as shared persistence
    console.error('[toolCost] Backend save threw for', normalizedId, '— not falling back to localStorage')
    return null
  }
}

/**
 * Clear a single tool cost config from backend (org-scoped).
 * CR-X ECON-1: Does NOT silently fall back to localStorage.
 * Returns true on success, false on failure.
 */
export async function clearOrgToolCostConfig(toolId: string): Promise<boolean> {
  const normalizedId = normalizeCostToolId(toolId)
  try {
    const response = await api.delete(`/api/org/spend/config/${normalizedId}`)
    if (response.status >= 400 && response.status !== 404) {
      console.error('[toolCost] Backend delete failed for', normalizedId)
      return false
    }
    return true
  } catch {
    console.error('[toolCost] Backend delete threw for', normalizedId)
    return false
  }
}

/**
 * Clear ALL tool cost configs from backend (org-scoped).
 * CR-X ECON-1: Does NOT silently fall back to localStorage.
 * Returns true on success, false on failure.
 */
export async function clearAllOrgToolCostConfigs(): Promise<boolean> {
  try {
    const response = await api.delete('/api/org/spend/config')
    if (response.status >= 400) {
      console.error('[toolCost] Backend delete-all failed')
      return false
    }
    return true
  } catch {
    console.error('[toolCost] Backend delete-all threw')
    return false
  }
}

/**
 * Get all tool cost configs from localStorage (fallback)
 */
function getLocalToolCostConfigs(): ToolCostConfig[] {
  const configs: ToolCostConfig[] = []
  for (const toolId of COST_SUPPORTED_TOOLS) {
    const config = getToolCostConfig(toolId)
    if (config && config.monthlySpend > 0) {
      configs.push(config)
    }
  }
  return configs
}

/**
 * CR-X Track C3: Compute windowed spend for a time range.
 * allocated_spend = monthly_spend × (window_days / 30)
 * This is period-level allocation, not causal attribution.
 *
 * @param monthlySpend - Configured monthly spend for the tool
 * @param fromDate - Start date (ISO YYYY-MM-DD) or empty for all-time
 * @param toDate - End date (ISO YYYY-MM-DD) or empty for all-time
 * @returns Allocated spend for the window, or monthlySpend if all-time
 */
export function computeWindowSpend(
  monthlySpend: number,
  fromDate?: string,
  toDate?: string
): number {
  if (!monthlySpend || monthlySpend <= 0) return 0
  // All-time or no range: return monthly spend (not multiplied)
  if (!fromDate || !toDate || fromDate === '' || toDate === '') return monthlySpend

  const fromMs = new Date(fromDate).getTime()
  const toMs = new Date(toDate).getTime()
  if (isNaN(fromMs) || isNaN(toMs)) return monthlySpend

  const windowDays = Math.max(1, Math.ceil((toMs - fromMs) / 86400000))
  const windowMonths = windowDays / 30
  return monthlySpend * windowMonths
}

/**
 * Compute spend per outcome for a window
 * allocated_spend_per_outcome = window_spend / outcome_count
 */
export function computeSpendPerOutcome(
  monthlySpend: number,
  outcomeCount: number,
  fromDate?: string,
  toDate?: string
): number | null {
  if (!monthlySpend || monthlySpend <= 0) return null
  if (!outcomeCount || outcomeCount <= 0) return null
  const windowSpend = computeWindowSpend(monthlySpend, fromDate, toDate)
  return windowSpend / outcomeCount
}

/**
 * Compute spend per commit for a window
 */
export function computeSpendPerCommit(
  monthlySpend: number,
  commitCount: number,
  fromDate?: string,
  toDate?: string
): number | null {
  return computeSpendPerOutcome(monthlySpend, commitCount, fromDate, toDate)
}

/**
 * Compute spend per PR for a window
 */
export function computeSpendPerPR(
  monthlySpend: number,
  prCount: number,
  fromDate?: string,
  toDate?: string
): number | null {
  return computeSpendPerOutcome(monthlySpend, prCount, fromDate, toDate)
}

/**
 * Compute spend per merged PR for a window
 */
export function computeSpendPerMergedPR(
  monthlySpend: number,
  mergedPRCount: number,
  fromDate?: string,
  toDate?: string
): number | null {
  return computeSpendPerOutcome(monthlySpend, mergedPRCount, fromDate, toDate)
}

/**
 * Compute spend per deployment for a window
 */
export function computeSpendPerDeployment(
  monthlySpend: number,
  deploymentCount: number,
  fromDate?: string,
  toDate?: string
): number | null {
  return computeSpendPerOutcome(monthlySpend, deploymentCount, fromDate, toDate)
}

/**
 * Compute spend per successful deployment for a window
 */
export function computeSpendPerSuccessfulDeployment(
  monthlySpend: number,
  successfulDeploymentCount: number,
  fromDate?: string,
  toDate?: string
): number | null {
  return computeSpendPerOutcome(monthlySpend, successfulDeploymentCount, fromDate, toDate)
}

/**
 * Compute spend per failed deployment for a window
 */
export function computeSpendPerFailedDeployment(
  monthlySpend: number,
  failedDeploymentCount: number,
  fromDate?: string,
  toDate?: string
): number | null {
  return computeSpendPerOutcome(monthlySpend, failedDeploymentCount, fromDate, toDate)
}

/**
 * Compute spend per release for a window
 */
export function computeSpendPerRelease(
  monthlySpend: number,
  releaseCount: number,
  fromDate?: string,
  toDate?: string
): number | null {
  return computeSpendPerOutcome(monthlySpend, releaseCount, fromDate, toDate)
}

/**
 * Compute spend per review cycle for a window
 */
export function computeSpendPerReviewCycle(
  monthlySpend: number,
  reviewCycleCount: number,
  fromDate?: string,
  toDate?: string
): number | null {
  return computeSpendPerOutcome(monthlySpend, reviewCycleCount, fromDate, toDate)
}
