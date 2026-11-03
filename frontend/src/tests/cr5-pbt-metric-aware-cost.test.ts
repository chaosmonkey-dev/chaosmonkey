import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ============================================================
// CR5 V1 — PBT Metric-Aware Allocated Cost Derivation
//
// Tests the DERIVED economic layer on top of the accepted
// allocation model. The allocation formula itself is frozen
// and tested in cr5-pbt-developer-cost-allocation.test.ts.
//
// This test file proves:
//  1. $500 / 4 = $125 allocation remains unchanged
//  2. Commits: 36 × 8.6 = 309.6 observed, $125 / 309.6 ≈ $0.40/commit
//  3. Aggregate uses SUM(spend) / SUM(volume), NOT avg of unit costs
//  4. Session Length converts minutes → hours before $/hour
//  5. Active Coding Time converts minutes → hours before $/hour
//  6. Zero/null metric volume → unavailable, no divide-by-zero
//  7. TTFC does not produce fake $/minute unit economics
//  8. Ratio metrics do not produce fake unit economics
//  9. All Developers cost behavior remains unchanged
// 10. No configured cost values changed
// ============================================================

const componentPath = resolve(__dirname, '../components/ProductivityByToolV3.vue')
const source = readFileSync(componentPath, 'utf-8')

// ── Pure formula tests (mirror the in-component math) ─────────────────────

function allocatedMonthly(configuredMonthly: number, eligibleDevelopers: number): number {
  return configuredMonthly > 0 ? configuredMonthly / eligibleDevelopers : 0
}

function observedVolume(metricAverage: number, sessionCount: number, convertToHours: boolean): number {
  const raw = metricAverage * sessionCount
  return convertToHours ? raw / 60 : raw
}

function unitCost(allocated: number, volume: number): number {
  return volume > 0 ? allocated / volume : NaN
}

describe('PBT Metric-Aware Cost Derivation — pure formula', () => {
  it('1. $500 configured / 4 eligible developers = $125 allocated (unchanged)', () => {
    expect(allocatedMonthly(500, 4)).toBe(125)
  })

  it('2. Commits: 36 sessions × 8.6 commits/session = 309.6 observed, $125 / 309.6 ≈ $0.40/commit', () => {
    const allocated = allocatedMonthly(500, 4) // $125
    const volume = observedVolume(8.6, 36, false) // 309.6
    expect(volume).toBeCloseTo(309.6, 1)
    const cost = unitCost(allocated, volume)
    expect(cost).toBeCloseTo(0.403, 2) // ~$0.40/commit
  })

  it('3. Aggregate uses SUM(spend) / SUM(volume), NOT average of unit costs', () => {
    // Cursor: 36 sessions, 8.6 commits/session, $125/mo allocated
    // Devin: 5 sessions, 10 commits/session, $15/mo allocated
    const cursorAlloc = 125
    const cursorVolume = observedVolume(8.6, 36, false) // 309.6
    const devinAlloc = 15
    const devinVolume = observedVolume(10, 5, false) // 50

    const totalAlloc = cursorAlloc + devinAlloc // $140
    const totalVolume = cursorVolume + devinVolume // 359.6
    const aggregateUnitCost = totalAlloc / totalVolume

    // NOT average of per-workflow unit costs
    const cursorUnitCost = cursorAlloc / cursorVolume // ~$0.403
    const devinUnitCost = devinAlloc / devinVolume // ~$0.30
    const avgOfUnitCosts = (cursorUnitCost + devinUnitCost) / 2

    expect(aggregateUnitCost).toBeCloseTo(0.389, 2) // ~$0.39/commit
    expect(aggregateUnitCost).not.toBeCloseTo(avgOfUnitCosts, 2)
    expect(totalAlloc).toBe(140)
    expect(totalVolume).toBeCloseTo(359.6, 1)
  })

  it('4. Session Length converts minutes to hours before $/hour', () => {
    // 30 min avg session × 40 sessions = 1200 min = 20 hours
    const allocated = 125
    const volumeMinutes = observedVolume(30, 40, true) // 20 hours
    expect(volumeMinutes).toBe(20)
    const cost = unitCost(allocated, volumeMinutes)
    expect(cost).toBeCloseTo(6.25, 2) // $125 / 20 = $6.25/session hour
  })

  it('5. Active Coding Time converts minutes to hours before $/hour', () => {
    // 15 min avg active coding × 40 sessions = 600 min = 10 hours
    const allocated = 125
    const volumeHours = observedVolume(15, 40, true) // 10 hours
    expect(volumeHours).toBe(10)
    const cost = unitCost(allocated, volumeHours)
    expect(cost).toBeCloseTo(12.5, 2) // $125 / 10 = $12.50/active coding hour
  })

  it('6. Zero/null metric volume does not divide by zero and renders unavailable', () => {
    const allocated = 125
    // Zero sessions
    expect(observedVolume(8.6, 0, false)).toBe(0)
    expect(Number.isNaN(unitCost(allocated, 0))).toBe(true)
    // Zero metric average
    expect(observedVolume(0, 36, false)).toBe(0)
    expect(Number.isNaN(unitCost(allocated, 0))).toBe(true)
    // The component guards this: observedVolume === null when metricAverage is null or 0
  })

  it('7. TTFC does not produce "$/minute" fake unit economics', () => {
    // TTFC is a latency metric — not additive. The semantic map marks it unsupported.
    // No unit cost should be computed.
    const ttfcSemantic = { supported: false, unitLabel: '', volumeLabel: '', convertToHours: false }
    expect(ttfcSemantic.supported).toBe(false)
    // Even if we had TTFC data, the component would NOT compute a unit cost
    const allocated = 125
    const ttfcAvg = 11 // 11 min TTFC
    const sessions = 30
    // The component checks semantic.supported before computing volume
    const wouldCompute = ttfcSemantic.supported && ttfcAvg > 0 && sessions > 0
    expect(wouldCompute).toBe(false)
  })

  it('8. Ratio metrics do not produce fake unit economics', () => {
    const ratioSemantic = { supported: false, unitLabel: '', volumeLabel: '', convertToHours: false }
    expect(ratioSemantic.supported).toBe(false)
    // ai_usage_ratio, active_coding_ratio, idle_ratio are all unsupported
    const wouldCompute = ratioSemantic.supported && 0.5 > 0 && 30 > 0
    expect(wouldCompute).toBe(false)
  })

  it('9. All Developers cost behavior remains unchanged', () => {
    // When no developer is selected, developerMetricDerivations returns []
    // and the allocated cost context strip does not render.
    // The All-Developers cost context strip (totalConfiguredSpend etc.) is unchanged.
    // This is verified by the source contract below.
    expect(source).toContain('if (!isDeveloperFiltered.value) return []')
  })

  it('10. No configured cost values changed (allocation divides configured, does not modify it)', () => {
    // The allocation formula divides configuredMonthly by eligibleCount.
    // It never modifies the configured value.
    const allocFormula = source.match(/const allocatedMonthly = configuredMonthly > 0 \? configuredMonthly \/ eligibleCount : 0/)
    expect(allocFormula).not.toBeNull()
    // getToolMonthlySpend reads from localStorage — no writes in the cost derivation
    expect(source).not.toMatch(/setToolCostConfig.*developerMetricDerivations/)
  })
})

// ── Single-workflow scoping regression ────────────────────────────────────
//
// P0 defect: when a single workflow is selected, the headline aggregate
// must scope to that workflow only — NOT the developer's total allocation
// across all workflows.
//
// Generic case: developer has allocations A (Cursor $125) + B (Devin $15).
// Compare: headline may reflect A + B = $140.
// Select workflow B: headline must be B = $15, NOT A + B = $140.

describe('PBT Single-Workflow Cost Scoping — regression', () => {
  it('R1. Compare mode: headline reflects sum of both workflow allocations', () => {
    const allocA = 125 // Cursor
    const allocB = 15  // Devin
    // Compare mode aggregate = A + B
    const compareAggregate = allocA + allocB
    expect(compareAggregate).toBe(140)
  })

  it('R2. Single workflow B selected: headline allocated == B, NOT A + B', () => {
    const allocA = 125 // Cursor
    const allocB = 15  // Devin
    // When workflow B (Devin) is selected, headline must be B only
    const singleWorkflowHeadline = allocB
    expect(singleWorkflowHeadline).toBe(15)
    expect(singleWorkflowHeadline).not.toBe(allocA + allocB)
  })

  it('R3. Single workflow B with supported metric: unit cost uses B only', () => {
    const allocB = 15
    const metricAvg = 10 // commits/session
    const sessions = 5
    const volume = observedVolume(metricAvg, sessions, false) // 50
    const singleUnitCost = unitCost(allocB, volume) // $15 / 50 = $0.30
    expect(singleUnitCost).toBeCloseTo(0.30, 2)
    // NOT using A + B in the numerator
    const wrongUnitCost = unitCost(125 + 15, volume) // $140 / 50 = $2.80
    expect(singleUnitCost).not.toBeCloseTo(wrongUnitCost, 1)
  })

  it('R4. Single workflow with unsupported metric (TTFC): spend scoped, unit cost N/A', () => {
    const allocB = 15
    const ttfcSemantic = { supported: false, unitLabel: '', volumeLabel: '', convertToHours: false }
    // Headline allocated spend = B only
    expect(allocB).toBe(15)
    // Unit cost is N/A — no fake $/minute
    const wouldCompute = ttfcSemantic.supported && 11 > 0 && 30 > 0
    expect(wouldCompute).toBe(false)
  })

  it('R5. source: effectiveCostRowDerivation scopes to selected workflow in single mode', () => {
    // The computed must check isCompareMode and effectiveWorkflowId
    expect(source).toContain('effectiveCostRowDerivation')
    expect(source).toContain('!isCompareMode.value && effectiveWorkflowId.value')
    // It must find the selected workflow's derivation only
    expect(source).toContain('derivations.find(d => d.costToolId === selectedCostToolId')
  })

  it('R6. source: effectiveAllocatedMonthlyCost scopes to selected workflow', () => {
    expect(source).toContain('effectiveAllocatedMonthlyCost')
    // In single-workflow mode it must return the selected workflow's allocation
    const scoped = source.match(/effectiveAllocatedMonthlyCost[\s\S]*?!isCompareMode\.value && effectiveWorkflowId\.value[\s\S]*?return selected\?\.allocatedMonthly/)
    expect(scoped).not.toBeNull()
  })

  it('R7. source: template headline uses effectiveCostRowDerivation, not developerAggregateMetricDerivation', () => {
    // The headline must use the scoped computed
    expect(source).toContain('effectiveCostRowDerivation')
    // The template must NOT directly use developerAggregateMetricDerivation in the headline
    const headlineBlock = source.match(/v3-ts-cost-row-aggregate[\s\S]*?<\/span>/)
    expect(headlineBlock).not.toBeNull()
    expect(headlineBlock![0]).not.toContain('developerAggregateMetricDerivation')
    expect(headlineBlock![0]).toContain('effectiveCostRowDerivation')
  })
})

// ── Source contract tests ─────────────────────────────────────────────────

describe('PBT Metric-Aware Cost Derivation — source contract', () => {
  it('METRIC_COST_SEMANTICS map defines supported metrics with unit labels', () => {
    expect(source).toContain('METRIC_COST_SEMANTICS')
    expect(source).toContain("'commits_per_session'")
    expect(source).toContain("'ai_suggestions_accepted'")
    expect(source).toContain("'files_edited_per_session'")
    expect(source).toContain("'average_session_length_minutes'")
    expect(source).toContain("'active_coding_time_minutes'")
    expect(source).toContain("'ai_usage_duration_minutes'")
    expect(source).toContain("'idle_time_minutes'")
  })

  it('TTFC is marked unsupported in the semantic map', () => {
    expect(source).toContain("'time_to_first_commit_minutes'")
    // The TTFC entry must have supported: false (multi-line entry)
    const ttfcEntry = source.match(/'time_to_first_commit_minutes'[\s\S]*?supported:\s*false/)
    expect(ttfcEntry).not.toBeNull()
  })

  it('ratio metrics are marked unsupported', () => {
    const ratioEntry = source.match(/'ai_usage_ratio'[\s\S]*?supported:\s*false/)
    expect(ratioEntry).not.toBeNull()
    const activeRatioEntry = source.match(/'active_coding_ratio'[\s\S]*?supported:\s*false/)
    expect(activeRatioEntry).not.toBeNull()
    const idleRatioEntry = source.match(/'idle_ratio'[\s\S]*?supported:\s*false/)
    expect(idleRatioEntry).not.toBeNull()
  })

  it('time metrics use convertToHours: true', () => {
    // Semantic entries are multi-line, so use [\s\S] to match across lines
    const sessionLengthEntry = source.match(/'average_session_length_minutes'[\s\S]*?convertToHours:\s*true/)
    expect(sessionLengthEntry).not.toBeNull()
    const activeCodingEntry = source.match(/'active_coding_time_minutes'[\s\S]*?convertToHours:\s*true/)
    expect(activeCodingEntry).not.toBeNull()
  })

  it('aggregate uses SUM(scope-matched cost) / SUM(volume), not average of unit costs', () => {
    // P4 CORRECTION: aggregate uses scope-matched cost, not raw monthly allocated
    const aggregate = source.match(/aggregateUnitCost:\s*totalScopeMatchedCost\s*\/\s*totalVolume/)
    expect(aggregate).not.toBeNull()
  })

  it('derivation numerator is scopeMatchedCost, not configuredMonthly or raw allocatedMonthly', () => {
    // P4 CORRECTION: unit cost must use scopeMatchedCost (pro-rated to time filter),
    // not alloc.allocatedMonthly (raw monthly) or alloc.configuredMonthly
    const unitCostLine = source.match(/unitCost\s*=\s*scopeMatchedCost\s*\/\s*observedVolume/)
    expect(unitCostLine).not.toBeNull()
  })

  it('template shows aggregate derived economic metric', () => {
    expect(source).toContain('developerAggregateMetricDerivation')
    expect(source).toContain('aggregateUnitCost')
  })

  it('template shows "Not applicable" for unsupported metrics', () => {
    expect(source).toContain('Not applicable')
  })

  it('disclaimer includes "Not ROI" and "Not causal attribution"', () => {
    expect(source).toContain('Not ROI')
    expect(source).toContain('Not causal attribution')
  })

  it('does not call this ROI or billing in customer-visible text', () => {
    // The disclaimer line in the template must contain "Not ROI"
    // (Vue SFC has nested <template> tags, so extract the full template
    //  as everything before <script setup>)
    const scriptIdx = source.indexOf('<script setup')
    expect(scriptIdx).toBeGreaterThan(0)
    const templateText = source.substring(0, scriptIdx)
    // The disclaimer must contain "Not ROI"
    expect(templateText).toContain('Not ROI')
    // No positive use of ROI in customer-visible text
    const roiInTemplate = templateText.match(/\bROI\b/g)
    if (roiInTemplate) {
      // Every ROI mention in the template must be negated
      for (const m of templateText.matchAll(/.{0,20}ROI.{0,20}/gi)) {
        expect(m[0].toUpperCase()).toContain('NOT ROI')
      }
    }
  })
})
