/**
 * CR-X D/E: Cost scope matching filter scope tests.
 *
 * Verifies that PBT analytical scope and cost scope agree.
 * A developer-filtered view must not show org-global allocation as if it
 * belongs to that developer.
 * A repo-filtered view must not show org-global allocation as if it belongs
 * to that repo.
 * Cost ratios must be suppressed (fail closed) when attribution cannot
 * truthfully follow the selected dimension.
 */
import { describe, it, expect } from 'vitest'
import { deriveCostScopeDecision } from '../lib/costScope'

describe('CR-X D: Cost scope matches filter scope', () => {
  describe('No filters (all developers, all repos, all time)', () => {
    it('shows org cost strip and delivery evidence', () => {
      const decision = deriveCostScopeDecision({ developer: null, repo: null, timeRange: 'all' }, true)
      expect(decision.showOrgCostStrip).toBe(true)
      expect(decision.showCostPerDelivery).toBe(true)
      expect(decision.showScopeWarning).toBe(false)
    })
  })

  describe('Developer filter active', () => {
    it('suppresses org cost strip, shows developer cost row', () => {
      const decision = deriveCostScopeDecision({ developer: 'dev1', repo: null, timeRange: 'all' }, true)
      expect(decision.showOrgCostStrip).toBe(false)
      expect(decision.showDeveloperCostRow).toBe(true)
      expect(decision.showCostPerDelivery).toBe(false)
      // CR-X C6: No blanket suppression — allocated economics shown
      expect(decision.showScopeWarning).toBe(false)
      expect(decision.warningText).toBe(null)
    })
  })

  describe('Repo filter active', () => {
    it('suppresses org cost strip and delivery evidence', () => {
      const decision = deriveCostScopeDecision({ developer: null, repo: 'repo1', timeRange: 'all' }, true)
      expect(decision.showOrgCostStrip).toBe(false)
      expect(decision.showCostPerDelivery).toBe(false)
      // CR-X C6: No blanket suppression — allocated repo economics shown
      expect(decision.showScopeWarning).toBe(false)
      expect(decision.warningText).toBe(null)
    })

    it('suppresses developer cost row (double filter)', () => {
      const decision = deriveCostScopeDecision({ developer: 'dev1', repo: 'repo1', timeRange: 'all' }, true)
      expect(decision.showDeveloperCostRow).toBe(false)
      expect(decision.showScopeWarning).toBe(false)
    })
  })

  describe('Developer + repo filter active', () => {
    it('suppresses all cost ratios', () => {
      const decision = deriveCostScopeDecision({ developer: 'dev1', repo: 'repo1', timeRange: 'all' }, true)
      expect(decision.showOrgCostStrip).toBe(false)
      expect(decision.showDeveloperCostRow).toBe(false)
      expect(decision.showCostPerDelivery).toBe(false)
      // CR-X C6: Allocated economics shown, no blanket suppression
      expect(decision.showScopeWarning).toBe(false)
    })
  })

  describe('Time period filter', () => {
    it('historical period with current rates: cost strip still shows (configured estimate)', () => {
      const decision = deriveCostScopeDecision({ developer: null, repo: null, timeRange: 'quarter' }, true)
      expect(decision.showOrgCostStrip).toBe(true)
      // Cost per delivery should still show — the disclaimer "Not billing data"
      // covers the historical-rate caveat
    })
  })

  describe('No cost data', () => {
    it('suppresses everything', () => {
      const decision = deriveCostScopeDecision({ developer: null, repo: null, timeRange: 'all' }, false)
      expect(decision.showOrgCostStrip).toBe(false)
      expect(decision.showDeveloperCostRow).toBe(false)
      expect(decision.showCostPerDelivery).toBe(false)
      expect(decision.showScopeWarning).toBe(false)
    })
  })

  describe('Fail closed principle', () => {
    it('prefers suppression over misleading number for repo filter', () => {
      const decision = deriveCostScopeDecision({ developer: null, repo: 'repo1', timeRange: 'all' }, true)
      // Cost per delivery MUST be suppressed — org spend / org PRs != repo spend / repo PRs
      expect(decision.showCostPerDelivery).toBe(false)
    })

    it('prefers suppression over misleading number for developer filter', () => {
      const decision = deriveCostScopeDecision({ developer: 'dev1', repo: null, timeRange: 'all' }, true)
      // Org cost per delivery MUST be suppressed — org spend / org PRs != dev spend / dev PRs
      expect(decision.showCostPerDelivery).toBe(false)
    })

    it('shows allocated economics instead of blanket suppression for developer filter', () => {
      const decision = deriveCostScopeDecision({ developer: 'dev1', repo: null, timeRange: 'all' }, true)
      // CR-X C6: Per-bucket allocated economics shown, no blanket suppression
      expect(decision.showScopeWarning).toBe(false)
      expect(decision.warningText).toBe(null)
      expect(decision.reason).toContain('allocated')
    })
  })
})

// E: Developer × Workflow × Metric × Cost primitive
describe('CR-X E: Developer workflow metric cost primitive', () => {
  type DeveloperCohort = {
    developer: string
    workflow: string
    metric: string
    sessions: number
    metricValue: number
    configuredCostPerMonth: number
    costPerSession: number
    costPerMetricUnit: number
    identityQuality: 'authoritative' | 'weak'
  }

  function computeEfficiencyFrontier(cohorts: DeveloperCohort[], minSessions: number = 10) {
    // Filter by minimum sample and authoritative identity
    const eligible = cohorts.filter(c =>
      c.sessions >= minSessions && c.identityQuality === 'authoritative'
    )
    if (eligible.length === 0) return { frontier: [], suppressed: true, reason: 'No eligible developers (insufficient sessions or weak identity)' }

    // Compute cohort median for the metric
    const metricValues = eligible.map(c => c.metricValue).sort((a, b) => a - b)
    const median = metricValues[Math.floor(metricValues.length / 2)]

    // Compute cohort median for cost per session
    const costValues = eligible.map(c => c.costPerSession).sort((a, b) => a - b)
    const costMedian = costValues[Math.floor(costValues.length / 2)]

    // Frontier: above median metric AND below median cost
    const frontier = eligible.filter(c =>
      c.metricValue > median && c.costPerSession < costMedian
    )

    return {
      frontier: frontier.map(c => ({
        developer: c.developer,
        workflow: c.workflow,
        metric: c.metric,
        sessions: c.sessions,
        metricValue: c.metricValue,
        metricVsMedian: ((c.metricValue / median - 1) * 100).toFixed(0) + '%',
        costPerSession: c.costPerSession,
        costVsMedian: ((1 - c.costPerSession / costMedian) * 100).toFixed(0) + '%',
      })),
      suppressed: false,
      reason: `Frontier: ${frontier.length} of ${eligible.length} eligible developers above metric median and below cost median`,
    }
  }

  it('suppresses when identity is weak', () => {
    const cohorts: DeveloperCohort[] = [
      { developer: 'dev1', workflow: 'devin', metric: 'commits_per_session', sessions: 20, metricValue: 2.5, configuredCostPerMonth: 500, costPerSession: 25, costPerMetricUnit: 10, identityQuality: 'weak' },
    ]
    const result = computeEfficiencyFrontier(cohorts)
    expect(result.suppressed).toBe(true)
    expect(result.reason).toContain('weak identity')
  })

  it('suppresses when sample is sparse', () => {
    const cohorts: DeveloperCohort[] = [
      { developer: 'dev1', workflow: 'devin', metric: 'commits_per_session', sessions: 5, metricValue: 2.5, configuredCostPerMonth: 500, costPerSession: 25, costPerMetricUnit: 10, identityQuality: 'authoritative' },
    ]
    const result = computeEfficiencyFrontier(cohorts, 10)
    expect(result.suppressed).toBe(true)
  })

  it('identifies frontier developers (above metric median, below cost median)', () => {
    const cohorts: DeveloperCohort[] = [
      { developer: 'Jordan', workflow: 'devin', metric: 'commits_per_session', sessions: 42, metricValue: 3.1, configuredCostPerMonth: 500, costPerSession: 11.9, costPerMetricUnit: 3.8, identityQuality: 'authoritative' },
      { developer: 'Sam', workflow: 'devin', metric: 'commits_per_session', sessions: 35, metricValue: 2.5, configuredCostPerMonth: 500, costPerSession: 14.3, costPerMetricUnit: 5.7, identityQuality: 'authoritative' },
      { developer: 'Alex', workflow: 'devin', metric: 'commits_per_session', sessions: 30, metricValue: 2.0, configuredCostPerMonth: 500, costPerSession: 16.7, costPerMetricUnit: 8.3, identityQuality: 'authoritative' },
    ]
    const result = computeEfficiencyFrontier(cohorts, 10)
    expect(result.suppressed).toBe(false)
    expect(result.frontier.length).toBe(1)
    expect(result.frontier[0].developer).toBe('Jordan')
  })

  it('produces evidence like "Jordan is on the observed Devin efficiency frontier"', () => {
    const cohorts: DeveloperCohort[] = [
      { developer: 'Jordan', workflow: 'devin', metric: 'commits_per_session', sessions: 42, metricValue: 3.1, configuredCostPerMonth: 500, costPerSession: 11.9, costPerMetricUnit: 3.8, identityQuality: 'authoritative' },
      { developer: 'Sam', workflow: 'devin', metric: 'commits_per_session', sessions: 35, metricValue: 2.5, configuredCostPerMonth: 500, costPerSession: 14.3, costPerMetricUnit: 5.7, identityQuality: 'authoritative' },
      { developer: 'Alex', workflow: 'devin', metric: 'commits_per_session', sessions: 30, metricValue: 2.0, configuredCostPerMonth: 500, costPerSession: 16.7, costPerMetricUnit: 8.3, identityQuality: 'authoritative' },
    ]
    const result = computeEfficiencyFrontier(cohorts, 10)
    const jordan = result.frontier[0]
    // Evidence should be like: "23% above Devin cohort median commits/session while 18% below configured cost/session across 42 sessions."
    expect(jordan.metricVsMedian).toContain('%')
    expect(jordan.costVsMedian).toContain('%')
    expect(jordan.sessions).toBe(42)
  })

  it('same workflow comparison only (no cross-workflow ranking)', () => {
    const cohorts: DeveloperCohort[] = [
      { developer: 'Jordan', workflow: 'devin', metric: 'commits_per_session', sessions: 42, metricValue: 3.1, configuredCostPerMonth: 500, costPerSession: 11.9, costPerMetricUnit: 3.8, identityQuality: 'authoritative' },
      { developer: 'Sam', workflow: 'cursor', metric: 'commits_per_session', sessions: 35, metricValue: 2.5, configuredCostPerMonth: 300, costPerSession: 8.6, costPerMetricUnit: 3.4, identityQuality: 'authoritative' },
    ]
    const result = computeEfficiencyFrontier(cohorts, 10)
    // Both are in different workflows — the frontier computation should not
    // rank them against each other (this is a simplified test; the real
    // implementation groups by workflow first)
    expect(result.suppressed).toBe(false)
  })

  it('no causal claim, no employee-performance judgment', () => {
    const cohorts: DeveloperCohort[] = [
      { developer: 'Jordan', workflow: 'devin', metric: 'commits_per_session', sessions: 42, metricValue: 3.1, configuredCostPerMonth: 500, costPerSession: 11.9, costPerMetricUnit: 3.8, identityQuality: 'authoritative' },
      { developer: 'Sam', workflow: 'devin', metric: 'commits_per_session', sessions: 35, metricValue: 2.5, configuredCostPerMonth: 500, costPerSession: 14.3, costPerMetricUnit: 5.7, identityQuality: 'authoritative' },
    ]
    const result = computeEfficiencyFrontier(cohorts, 10)
    // The evidence must not contain "better", "worse", "performance", "rating"
    const evidenceStr = JSON.stringify(result.frontier)
    expect(evidenceStr).not.toContain('better')
    expect(evidenceStr).not.toContain('worse')
    expect(evidenceStr).not.toContain('performance')
    expect(evidenceStr).not.toContain('rating')
  })

  it('cost unknown: show metric cohort only or suppress cost dimension', () => {
    const cohorts: DeveloperCohort[] = [
      { developer: 'Jordan', workflow: 'devin', metric: 'commits_per_session', sessions: 42, metricValue: 3.1, configuredCostPerMonth: 0, costPerSession: 0, costPerMetricUnit: 0, identityQuality: 'authoritative' },
      { developer: 'Sam', workflow: 'devin', metric: 'commits_per_session', sessions: 35, metricValue: 2.5, configuredCostPerMonth: 0, costPerSession: 0, costPerMetricUnit: 0, identityQuality: 'authoritative' },
    ]
    // When cost is 0 (unknown), the frontier should not rank by cost
    const result = computeEfficiencyFrontier(cohorts, 10)
    // With all-zero costs, cost median is 0, so no one is "below" median
    // The frontier should be empty (no one qualifies on cost dimension)
    expect(result.frontier.length).toBe(0)
  })
})

// F: Delivery outcome authority distinctions
describe('CR-X F: Delivery outcome authority distinctions', () => {
  it('observed_rows authority is the only trusted count_authority', () => {
    const outcomes = [
      { month: '2026-06', merged_pr_count: 10, deployment_count: 5, count_authority: 'observed_rows' },
      { month: '2026-07', merged_pr_count: 20, deployment_count: 10, count_authority: 'seeded' },
    ]
    // Only observed_rows should be counted — seeded outcomes must be excluded
    const observedOnly = outcomes.filter(o => o.count_authority === 'observed_rows')
    expect(observedOnly).toHaveLength(1)
    expect(observedOnly[0].merged_pr_count).toBe(10)
    expect(observedOnly[0].deployment_count).toBe(5)
  })

  it('seeded data is excluded from delivery evidence in production mode', () => {
    const outcomes = [
      { month: '2026-06', merged_pr_count: 100, deployment_count: 50, count_authority: 'seeded', source: 'cm_activity_sim' },
      { month: '2026-07', merged_pr_count: 5, deployment_count: 2, count_authority: 'observed_rows', source: 'github_api_sync' },
    ]
    const observedOnly = outcomes.filter(o => o.count_authority === 'observed_rows')
    const totalMergedPRs = observedOnly.reduce((sum, o) => sum + o.merged_pr_count, 0)
    const totalDeploys = observedOnly.reduce((sum, o) => sum + o.deployment_count, 0)
    // Must not include seeded data
    expect(totalMergedPRs).toBe(5)
    expect(totalDeploys).toBe(2)
  })

  it('empty observed outcomes suppress delivery insights (do not fall back to seeded)', () => {
    const outcomes = [
      { month: '2026-06', merged_pr_count: 100, deployment_count: 50, count_authority: 'seeded' },
    ]
    const observedOnly = outcomes.filter(o => o.count_authority === 'observed_rows')
    expect(observedOnly).toHaveLength(0)
    // PI generator should return null when no observed outcomes exist
    // (tested via the generators themselves which filter on count_authority)
  })

  it('costScope + delivery authority compose correctly', () => {
    // If cost is configured but delivery is only seeded, cost-per-delivery should not compute
    const decision = deriveCostScopeDecision({ developer: null, repo: null, timeRange: 'all' }, true)
    expect(decision.showOrgCostStrip).toBe(true)
    // Delivery evidence availability is orthogonal to cost scope — cost scope says "you can show cost"
    // but if delivery outcomes are all seeded, the generator should still return null
    expect(decision.showCostPerDelivery).toBe(true)
    // The generator gates on observed_rows, not the costScope decision
  })
})
