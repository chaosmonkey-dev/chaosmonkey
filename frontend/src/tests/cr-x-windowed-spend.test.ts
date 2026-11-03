import { describe, it, expect } from 'vitest'
import {
  computeWindowSpend,
  computeSpendPerOutcome,
  computeSpendPerSession,
  computeSpendPerActiveHour,
  computeSpendPerMergedPR,
  computeSpendPerDeployment,
  computeSpendPerSuccessfulDeployment,
  computeSpendPerFailedDeployment,
  computeSpendPerRelease,
  computeSpendPerReviewCycle,
  normalizeCostToolId,
  formatCurrency,
} from '../lib/toolCost'

describe('Track C3: Windowed Spend Computation', () => {
  it('computeWindowSpend returns monthly spend for all-time (no range)', () => {
    expect(computeWindowSpend(1000)).toBe(1000)
    expect(computeWindowSpend(1000, '', '')).toBe(1000)
  })

  it('computeWindowSpend returns 0 for no spend', () => {
    expect(computeWindowSpend(0, '2026-01-01', '2026-02-01')).toBe(0)
    expect(computeWindowSpend(-100, '2026-01-01', '2026-02-01')).toBe(0)
  })

  it('computeWindowSpend computes 30-day window as ~1 month', () => {
    const result = computeWindowSpend(1000, '2026-01-01', '2026-01-31')
    expect(result).toBeCloseTo(1000, 0) // ~30 days = ~1 month
  })

  it('computeWindowSpend computes 90-day window as ~3 months', () => {
    const result = computeWindowSpend(1000, '2026-01-01', '2026-04-01')
    expect(result).toBeCloseTo(3000, -2) // ~90 days = ~3 months
  })

  it('computeWindowSpend computes 7-day window as ~0.23 months', () => {
    const result = computeWindowSpend(1000, '2026-01-01', '2026-01-08')
    expect(result).toBeCloseTo(233.33, -1) // 7/30 * 1000
  })

  it('computeSpendPerOutcome returns null for no spend', () => {
    expect(computeSpendPerOutcome(0, 10, '2026-01-01', '2026-02-01')).toBeNull()
  })

  it('computeSpendPerOutcome returns null for no outcomes', () => {
    expect(computeSpendPerOutcome(1000, 0, '2026-01-01', '2026-02-01')).toBeNull()
  })

  it('computeSpendPerOutcome computes correctly for 30-day window', () => {
    const result = computeSpendPerOutcome(1000, 10, '2026-01-01', '2026-01-31')
    expect(result).toBeCloseTo(100, 0) // ~1000 / 10
  })

  it('computeSpendPerMergedPR computes correctly', () => {
    // 90 days = 3 months, window_spend = 3000 * 3 = 9000, per 15 PRs = 600
    const result = computeSpendPerMergedPR(3000, 15, '2026-01-01', '2026-04-01')
    expect(result).toBeCloseTo(600, -1) // ~9000 / 15 = 600
  })

  it('computeSpendPerDeployment computes correctly', () => {
    const result = computeSpendPerDeployment(1000, 5, '2026-01-01', '2026-01-31')
    expect(result).toBeCloseTo(200, 0) // ~1000 / 5
  })

  it('computeSpendPerSuccessfulDeployment computes correctly', () => {
    const result = computeSpendPerSuccessfulDeployment(1000, 4, '2026-01-01', '2026-01-31')
    expect(result).toBeCloseTo(250, 0) // ~1000 / 4
  })

  it('computeSpendPerFailedDeployment computes correctly', () => {
    const result = computeSpendPerFailedDeployment(1000, 1, '2026-01-01', '2026-01-31')
    expect(result).toBeCloseTo(1000, 0) // ~1000 / 1
  })

  it('computeSpendPerRelease computes correctly', () => {
    const result = computeSpendPerRelease(1000, 2, '2026-01-01', '2026-01-31')
    expect(result).toBeCloseTo(500, 0) // ~1000 / 2
  })

  it('computeSpendPerReviewCycle computes correctly', () => {
    const result = computeSpendPerReviewCycle(1000, 8, '2026-01-01', '2026-01-31')
    expect(result).toBeCloseTo(125, 0) // ~1000 / 8
  })
})

describe('Track C2: Tool Cost Utilities (existing)', () => {
  it('normalizeCostToolId maps windsurf to devin', () => {
    expect(normalizeCostToolId('windsurf')).toBe('devin')
  })

  it('normalizeCostToolId maps claude-code-workflow to claude-code', () => {
    expect(normalizeCostToolId('claude-code-workflow')).toBe('claude-code')
  })

  it('normalizeCostToolId maps copilot to github-copilot', () => {
    expect(normalizeCostToolId('copilot')).toBe('github-copilot')
  })

  it('computeSpendPerSession returns em dash for no spend', () => {
    expect(computeSpendPerSession(0, 100)).toBe('—')
  })

  it('computeSpendPerSession returns em dash for no sessions', () => {
    expect(computeSpendPerSession(1000, 0)).toBe('—')
  })

  it('computeSpendPerSession computes correctly', () => {
    expect(computeSpendPerSession(1000, 100)).toBe('$10.00')
  })

  it('computeSpendPerActiveHour computes correctly', () => {
    expect(computeSpendPerActiveHour(1000, 600)).toBe('$100.00') // 10 hours
  })

  it('formatCurrency formats correctly', () => {
    expect(formatCurrency(10.5)).toBe('$10.50')
    expect(formatCurrency(0)).toBe('$0.00')
  })
})
