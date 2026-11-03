import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  generateExecutiveSmallPRWorkflowOptimization,
  generateReopenPressureSpike,
  generateReviewerLoadConcentration,
} from '../lib/insights/final/generators/reviewMerge'
import { generateDeliveryVelocityByWorkflow } from '../lib/insights/final/generators/deployOperate'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

function mkInput(overrides: Partial<CanonicalInsightInput> = {}): CanonicalInsightInput {
  return {
    sessionRows: [],
    githubSnapshot: {
      github_provenance: {
        data_source: 'live',
        live_fetch_ok: true,
        historical_data_available: false,
        db_data_available: false,
      },
      pr_analytics: {
        total_prs: 0,
      },
    },
    granularity: 'all',
    ...overrides,
  } as CanonicalInsightInput
}

function prSizeMergeCycle(small_n: number, large_n: number) {
  return {
    small_n,
    large_n,
    small_median_hours: small_n,
    large_median_hours: large_n * 2,
    ratio: 2,
    merged_total: small_n + large_n,
  }
}

describe('CR-X 18B: executive small-PR fallback', () => {
  it('wrong/unapproved repo authority produces no promoted GitHub finding', () => {
    const input = mkInput({
      githubSnapshot: {
        github_provenance: {
          data_source: 'fixture_fallback',
          live_fetch_ok: false,
          historical_data_available: false,
          db_data_available: false,
        },
        pr_analytics: {
          total_prs: 1,
          prs_by_size: { small: 1 },
          pr_size_merge_cycle: prSizeMergeCycle(10, 10),
        },
      },
    })
    const result = generateExecutiveSmallPRWorkflowOptimization(input)
    expect(result).toBeNull()
  })

  it('one authoritative PR produces no promoted optimization finding', () => {
    const input = mkInput({
      githubSnapshot: {
        github_provenance: {
          data_source: 'live',
          live_fetch_ok: true,
          historical_data_available: false,
          db_data_available: false,
        },
        pr_analytics: {
          total_prs: 1,
          prs_by_size: { small: 1 },
        },
      },
    })
    const result = generateExecutiveSmallPRWorkflowOptimization(input)
    expect(result).toBeNull()
  })

  it('below small-PR cohort threshold suppresses the finding', () => {
    const input = mkInput({
      githubSnapshot: {
        github_provenance: {
          data_source: 'live',
          live_fetch_ok: true,
          historical_data_available: false,
          db_data_available: false,
        },
        pr_analytics: {
          total_prs: 19,
          prs_by_size: { small: 9, large: 10 },
          pr_size_merge_cycle: prSizeMergeCycle(9, 10),
        },
      },
    })
    const result = generateExecutiveSmallPRWorkflowOptimization(input)
    expect(result).toBeNull()
  })

  it('exactly the small-PR cohort threshold produces a finding', () => {
    const input = mkInput({
      githubSnapshot: {
        github_provenance: {
          data_source: 'live',
          live_fetch_ok: true,
          historical_data_available: false,
          db_data_available: false,
        },
        pr_analytics: {
          total_prs: 20,
          prs_by_size: { small: 10, large: 10 },
          pr_size_merge_cycle: prSizeMergeCycle(10, 10),
        },
      },
    })
    const result = generateExecutiveSmallPRWorkflowOptimization(input)
    expect(result).not.toBeNull()
    expect(result?.title).toContain('longer to merge')
    expect(JSON.stringify(result)).not.toContain('14.2')
    expect(JSON.stringify(result)).not.toContain('28.5')
  })

  it('above the small-PR cohort threshold still produces a finding', () => {
    const input = mkInput({
      githubSnapshot: {
        github_provenance: {
          data_source: 'live',
          live_fetch_ok: true,
          historical_data_available: false,
          db_data_available: false,
        },
        pr_analytics: {
          total_prs: 40,
          prs_by_size: { small: 20, large: 20 },
          pr_size_merge_cycle: prSizeMergeCycle(20, 20),
        },
      },
    })
    const result = generateExecutiveSmallPRWorkflowOptimization(input)
    expect(result).not.toBeNull()
    expect(result?.title).toContain('longer to merge')
    expect(JSON.stringify(result)).not.toContain('14.2')
    expect(JSON.stringify(result)).not.toContain('28.5')
  })

  it('does not emit hardcoded 14.2 or 28.5 live output', () => {
    const input = mkInput({
      githubSnapshot: {
        github_provenance: {
          data_source: 'live',
          live_fetch_ok: true,
          historical_data_available: false,
          db_data_available: false,
        },
        pr_analytics: {
          total_prs: 1,
          prs_by_size: { small: 1 },
        },
      },
    })
    const result = generateExecutiveSmallPRWorkflowOptimization(input)
    expect(JSON.stringify(result)).not.toContain('14.2')
    expect(JSON.stringify(result)).not.toContain('28.5')
  })
})

// ─── 18B.6: no fabricated sample counts in customer-facing findings ───
// Live generators previously emitted invented N values (||95, ||87, ||124,
// ||92, ||118, sessions*0.9, uniqueReviewers=12) when observed counts were
// absent/zero. A measurement product must not present invented N as fact.

describe('CR-X 18B.6: fabricated sample-count removal', () => {
  const GEN_DIR = path.resolve(__dirname, '../lib/insights/final/generators')

  it('live generators contain no hardcoded sample-count fallbacks', () => {
    for (const file of ['reviewMerge.ts', 'deployOperate.ts']) {
      const src = fs.readFileSync(path.join(GEN_DIR, file), 'utf-8')
      // No "n: <var> || <nonzero number>" fabricated sample fields
      // (|| 0 is an explicit-zero default, not a fabrication)
      expect(src, `${file}: n-fallback`).not.toMatch(/\bn:\s*\w+\s*\|\|\s*[1-9]/)
      // No banned literal fallbacks anywhere
      expect(src, `${file}: banned literal`).not.toMatch(/\|\|\s*(87|92|95|118|124|135|165)\b/)
      // No counts synthesized from session volume
      expect(src, `${file}: session multiplier`).not.toMatch(/totalSessions\s*\*\s*[\d.]+/)
      expect(src, `${file}: hardcoded reviewers`).not.toContain('uniqueReviewers = 12')
    }
  })

  it('reopen-pressure-spike emits the observed total_prs as n (never a hardcoded count)', () => {
    const insight = generateReopenPressureSpike({
      sessionRows: [],
      githubSnapshot: {
        github_data_source: 'github_oauth',
        pr_review_metrics: {
          total_prs: 17,
          review_count: 40,
          unique_reviewer_count: 4,
          pr_reopened_count: 0,
        },
      },
    } as any)
    expect(insight).not.toBeNull()
    expect(insight!.n).toBe(17)
  })

  it('reopen-pressure-spike fails closed (null) when total PRs is zero', () => {
    const insight = generateReopenPressureSpike({
      sessionRows: [],
      githubSnapshot: {
        github_data_source: 'github_oauth',
        pr_review_metrics: {
          total_prs: 0,
          review_count: 0,
          unique_reviewer_count: 0,
          pr_reopened_count: 0,
        },
      },
    } as any)
    expect(insight).toBeNull()
  })

  it('reviewer-load-concentration emits n=0 (not 95/12) in concentration-score-only mode', () => {
    const insight = generateReviewerLoadConcentration({
      sessionRows: [{} as any, {} as any],
      githubSnapshot: {
        github_data_source: 'github_oauth',
        reviewer_load_concentration: 62,
      },
    } as any)
    expect(insight).not.toBeNull()
    expect(insight!.n).toBe(0)
    const json = JSON.stringify(insight)
    expect(json).not.toContain('95 reviews')
    expect(json).not.toContain('12 unique reviewers')
  })

  it('delivery-velocity-by-workflow emits n=0 (not 95) when deployment counts are observed zero', () => {
    const insight = generateDeliveryVelocityByWorkflow({
      sessionRows: [],
      githubByPeriod: [],
      granularity: 'week',
      githubSnapshot: {
        github_data_source: 'github_oauth',
        github_provenance: {
          source: 'github_oauth',
          historical_data_available: true,
          db_data_available: true,
          live_fetch_ok: false,
          generated_fallback_used: false,
        },
        deployment_metrics: {
          success_deployment_count: 0,
          failed_deployment_count: 0,
          change_failure_rate: 0,
        },
      },
    } as any)
    // Fail-closed (null) or honest zero-N are both acceptable — never 95.
    if (insight !== null) {
      expect(insight.n).toBe(0)
      expect(JSON.stringify(insight)).not.toMatch(/\b95\b/)
    }
  })
})
