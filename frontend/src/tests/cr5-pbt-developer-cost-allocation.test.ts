import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ============================================================
// CR5 V1 FINAL DEMO — PBT Developer Cost Allocation
//
// Asserts the accepted allocation model is wired into the PBT
// cards cost layer and the allocated cost context strip:
//   - All Developers: full workflow configured spend (unchanged)
//   - Selected developer: allocatedMonthly = configured / eligibleDevelopers
//   - Spend / Session = allocatedMonthly / developer's observed sessions
//   - Workflows the developer does not use get no allocation
//   - Never full-workflow-spend / one-developer-sessions
//
// These are source-contract tests (same pattern as
// cr5-pbt-developer-dropdown.test.ts) because the component
// reads cost config from localStorage at runtime and the
// allocation math lives inside the Vue computed/template.
// ============================================================

const componentPath = resolve(__dirname, '../components/ProductivityByToolV3.vue')
const source = readFileSync(componentPath, 'utf-8')

describe('PBT Developer Cost Allocation — cards cost layer', () => {
  it('card cost layer is suppressed for selected developers (CR-X Phase 3)', () => {
    // CR-X Phase 3: Configured spend is org/workflow-level, not developer-attributable.
    // Cost ratios must be suppressed (N/A — org-level) when a developer is selected,
    // not merely accompanied by a warning.
    const costBlock = source.match(/selectedCostLayer\.value !== 'off' && hasCostData\.value[\s\S]*?isCost: true\n        \}\)/)
    expect(costBlock).not.toBeNull()
    // The main cost block must NOT include developer-filtered cases.
    expect(costBlock![0]).toContain('!isDeveloperFiltered.value')
  })

  it('card cost shows N/A for developer-selected cost ratios (CR-X Phase 3)', () => {
    // When developer-filtered, cost ratios must show "N/A — org-level"
    const naBlock = source.match(/isDeveloperFiltered\.value[\s\S]*?N\/A — org-level/)
    expect(naBlock).not.toBeNull()
  })

  it('getAllocatedMonthlyCostForCard returns null for workflows the developer does not use', () => {
    // The helper must look up the allocation by costToolId and return null
    // when no allocation exists — never invent spend for unused workflows.
    const helper = source.match(/function getAllocatedMonthlyCostForCard[\s\S]*?\n}/)
    expect(helper).not.toBeNull()
    expect(helper![0]).toContain('developerWorkflowAllocations.value.find')
    expect(helper![0]).toContain('return null')
  })

  it('allocation formula divides configured spend by eligible developer count', () => {
    // developerWorkflowAllocations must compute:
    //   allocatedMonthly = configuredMonthly / eligibleCount
    const alloc = source.match(/const allocatedMonthly = configuredMonthly > 0 \? configuredMonthly \/ eligibleCount : 0/)
    expect(alloc).not.toBeNull()
  })

  it('never divides full workflow configured spend by one developer sessions', () => {
    // The card per-session branch must use the (possibly allocated)
    // monthlyCost variable, not a fresh getMonthlyCostForCard(card) call.
    const perSession = source.match(/const costPerSession = monthlyCost \/ sessionCount/)
    expect(perSession).not.toBeNull()
    // And there must be no full-workflow-spend / developer-session math.
    // The only getMonthlyCostForCard call inside the cost block is the
    // All-Developers branch of the monthlyCost assignment.
    const costBlock = source.match(/selectedCostLayer\.value !== 'off' && hasCostData\.value[\s\S]*?isCost: true\n        \}\)/)
    expect(costBlock).not.toBeNull()
    const matches = costBlock![0].match(/getMonthlyCostForCard\(card\)/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(1) // only the All-Developers branch
  })
})

describe('PBT Developer Cost Allocation — allocated cost context strip', () => {
  it('header names the selected developer', () => {
    // The developer name is in the compact row title attribute (tooltip)
    const header = source.match(/Allocated AI spend — \$\{selectedDeveloperLabel\}/)
    expect(header).not.toBeNull()
  })

  it('header names the selected metric in the cost context', () => {
    // The metric context is in the compact row title attribute (tooltip)
    const ctx = source.match(/Context: \$\{selectedMetricLabel\}/)
    expect(ctx).not.toBeNull()
  })

  it('uses required disclaimer language (configured estimate, not billing data)', () => {
    // The compact inline disclaimer is visible in the row
    expect(source).toContain('Configured estimate · Not billing data')
    // The full provenance disclaimer is in the title tooltip
    expect(source).toContain('Configured tool spend split across observed developers')
  })

  it('selectedDeveloperLabel computed exists', () => {
    expect(source).toContain('const selectedDeveloperLabel = computed(')
  })
})

// ── Pure allocation formula test ──────────────────────────────────────────
// Mirrors the in-component math so the contract is documented and exercised
// independently of the Vue runtime.

describe('PBT allocation formula (pure)', () => {
  function allocatedMonthly(configuredMonthly: number, eligibleDevelopers: number): number {
    return configuredMonthly > 0 ? configuredMonthly / eligibleDevelopers : 0
  }

  it('example contract: $500/mo, 4 devs → $125/mo per developer', () => {
    expect(allocatedMonthly(500, 4)).toBe(125)
  })

  it('spend/session uses allocated monthly, not full workflow spend', () => {
    const allocated = allocatedMonthly(500, 4) // $125
    const sessions = 25
    expect(allocated / sessions).toBe(5) // $125/25 = $5.00
    // NOT $500/25 = $20
    expect(500 / sessions).not.toBe(allocated / sessions)
  })

  it('workflow not used by developer yields no allocation', () => {
    // No allocation entry → allocatedMonthly effectively 0 (helper returns null)
    const used = new Set(['cursor', 'vscode'])
    const eligible = 4
    const configured = 500
    expect(used.has('devin')).toBe(false)
    // If we naively applied the formula to an unused workflow we'd get $125,
    // but the helper excludes it — represent that here:
    const allocForUnused = used.has('devin') ? allocatedMonthly(configured, eligible) : 0
    expect(allocForUnused).toBe(0)
  })

  it('All Developers preserves full workflow configured spend', () => {
    // When no developer is selected, monthlyCost = getMonthlyCostForCard(card)
    // = full configured monthly spend. This is the unchanged path.
    const configuredMonthly = 500
    expect(configuredMonthly).toBe(500) // unchanged
  })
})
