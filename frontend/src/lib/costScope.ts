/**
 * CR-X Slice 2: Cost Scope & Attribution Authority
 *
 * Shared contract for cost visibility decisions across PBT and PI.
 * Extracted from test-only types in cr-x-cost-scope.test.ts into a
 * production module so both PBT (ProductivityByToolV3.vue) and PI
 * (unitEconomics.ts, planCode.ts) can reference the same contract.
 *
 * Key invariants:
 * 1. showOrgCostStrip only when scope === 'org' (no dev/repo filter)
 * 2. showDeveloperCostRow only when scope === 'developer' (no repo filter)
 * 3. showCostPerDelivery only when scope === 'org'
 * 4. showScopeWarning when filters prevent truthful attribution
 * 5. Fail closed: suppress cost ratios rather than show misleading numbers
 *
 * Authority: cost config lives in localStorage (toolCost.ts).
 * Server cannot determine cost state (pilot health returns UNKNOWN).
 */

// ── Types ────────────────────────────────────────────────────────────────

/** Analytical scope at which cost is being displayed */
export type CostScope =
  | 'org'             // no developer/repo filter — full org view
  | 'developer'       // single developer selected, no repo filter
  | 'repo'            // single repo selected (cost cannot be attributed)
  | 'unattributable'  // double filter (developer + repo) or missing data

/** How the cost figure was derived */
export type CostAttributionBasis =
  | 'configured_per_seat'              // seatCount * costPerSeatMonthly (toolCost.ts)
  | 'configured_per_workflow'          // monthlySpend for the canonical tool
  | 'allocated_per_eligible_developer' // configuredMonthly / eligibleDevelopers
  | 'observed_session_count'           // monthlyCost / sessionCount
  | 'observed_active_hour'             // monthlyCost / active coding hours
  | 'github_outcome_count'             // totalMonthlySpend / merged_pr | deployment
  | 'not_attributable'                 // fail-closed (scope mismatch)

/** Runtime decision: which cost surfaces to show/suppress */
export interface CostScopeDecision {
  scope: CostScope
  showOrgCostStrip: boolean
  showDeveloperCostRow: boolean
  showCostPerDelivery: boolean
  showScopeWarning: boolean
  warningText: string | null
  reason: string
}

/** Per-workflow cost attribution (for cards & metric-aware unit cost) */
export interface CostAttribution {
  toolId: string
  isConfigured: boolean
  monthlySpend: number
  seatCount: number
  costPerSeatMonthly: number
  allocatedMonthly?: number          // when scoped to a developer
  scopeMatchedCost?: number | null   // pro-rated to time filter
  proRatingFactor?: number | null
  denominator?: number               // sessions | active hours | PRs | deployments
  unitCost?: number | null
  unitLabel?: string
  basis: CostAttributionBasis
  disclaimer: 'Configured estimate · Not billing data'
}

// ── Cost pro-rating factors ──────────────────────────────────────────────

/** Map time filter to monthly pro-rating factor */
export function costProRatingFactor(
  timeRange: 'day' | 'week' | 'month' | 'quarter' | 'all',
  observedDays?: number
): number | null {
  switch (timeRange) {
    case 'day':     return 1 / 30
    case 'week':    return 1 / 4.345
    case 'month':   return 1
    case 'quarter': return 3
    case 'all':     return observedDays ? observedDays / 30 : null
  }
}

// ── Decision function ────────────────────────────────────────────────────

/**
 * Derive the cost scope decision from current filter state.
 *
 * This is the single source of truth for cost visibility.
 * PBT's scattered v-if checks should delegate to this function.
 */
export function deriveCostScopeDecision(
  filters: { developer: string | null; repo: string | null; timeRange: string },
  hasCostData: boolean
): CostScopeDecision {
  const isDeveloperFiltered = filters.developer !== null && filters.developer !== ''
  const isRepoFiltered = filters.repo !== null && filters.repo !== ''

  if (!hasCostData) {
    return {
      scope: 'org',
      showOrgCostStrip: false,
      showDeveloperCostRow: false,
      showCostPerDelivery: false,
      showScopeWarning: false,
      warningText: null,
      reason: 'No cost data configured',
    }
  }

  // Determine scope
  const scope: CostScope = isDeveloperFiltered && isRepoFiltered
    ? 'unattributable'
    : isDeveloperFiltered ? 'developer'
    : isRepoFiltered ? 'repo'
    : 'org'

  // Org-level cost strip: only when no developer AND no repo filter
  const showOrgCostStrip = scope === 'org'

  // Developer cost row: only when developer filter active AND no repo filter
  const showDeveloperCostRow = scope === 'developer'

  // Cost per delivery: only when no developer AND no repo filter
  const showCostPerDelivery = scope === 'org'

  // CR-X C6: Per-bucket allocation supports repo/developer filters.
  // No blanket suppression — allocated economics are shown when supported.
  const showScopeWarning = false
  const warningText = null

  return {
    scope,
    showOrgCostStrip,
    showDeveloperCostRow,
    showCostPerDelivery,
    showScopeWarning,
    warningText,
    reason: scope === 'unattributable'
      ? 'Both developer and repo filtered: per-bucket allocated economics shown'
      : scope === 'developer'
      ? 'Developer filtered: per-bucket allocated developer economics shown'
      : scope === 'repo'
      ? 'Repo filtered: per-bucket allocated repo economics shown'
      : 'No filters: org-level cost strip and delivery evidence eligible',
  }
}
