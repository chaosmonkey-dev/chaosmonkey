/**
 * CR-X Track C/D: Delivery outcome presentation — measured evidence must
 * NOT be misclassified as instrumentation_gap.
 *
 * Proves:
 * - Measured merge cycle time is not an instrumentation gap merely because
 *   workflow attribution is unavailable
 * - Measured merge rate is not an instrumentation gap
 * - Measured PR throughput is not an instrumentation gap
 * - Measured review burden is not an instrumentation gap
 * - Measured deployment distribution is not an instrumentation gap
 * - Genuinely missing release evidence still remains a proper
 *   not-measurable/data-gap state (release-cadence returns null)
 * - Org-level measurement does not imply IDE/workflow attribution
 * - No L1 claim is introduced
 * - The comparisonState helper correctly resolves outcome_threshold and
 *   success_failure_distribution presentationKinds with org_level_only
 *   to 'org_level_only', NOT 'instrumentation_gap'
 */
import { describe, it, expect } from 'vitest'
import {
  generateMergeCycleTime,
  generateMergeRate,
  generatePrThroughput,
  generateReviewBurden,
} from '../lib/insights/final/generators/reviewMerge'
import {
  generateDeploymentSuccessDistribution,
  generateReleaseCadence,
} from '../lib/insights/final/generators/deployOperate'
import { computeComparisonState } from '../lib/insights/final/helpers/comparisonState'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

function liveOrgLevelInput(overrides: any = {}): CanonicalInsightInput {
  return {
    sessionRows: [],
    githubByPeriod: [
      { period: '2026-W01' }, { period: '2026-W02' },
      { period: '2026-W03' }, { period: '2026-W04' },
    ],
    githubSnapshot: {
      github_provenance: {
        source: 'cm_activity_sim',
        historical_data_available: true,
        db_data_available: true,
      },
      github_data_source: 'cm_activity_sim',
      github_team_metrics: {
        time_to_merge: 12.1,
        merged_prs: 18,
        total_prs: 27,
        merge_rate: 66.7,
        reopened_prs: 3,
      },
      merged_pull_requests: 18,
      total_pull_requests: 27,
      pr_review_metrics: {
        review_count: 78,
        unique_reviewer_count: 4,
        pr_reopened_count: 3,
        total_prs: 21,
        first_review_at: '2026-06-20T00:00:00Z',
      },
      deployment_metrics: {
        success_deployment_count: 23,
        failed_deployment_count: 2,
        deployment_reliability: {
          total: 25,
          success: 23,
          failed: 2,
          success_rate: 92,
          production_total: 20,
          production_failed: 2,
          staging_total: 5,
          observed_days: 3,
          rollback_count: 0,
        },
      },
      // release_metrics intentionally absent — proves release-cadence stays null
      ...overrides,
    },
    externalCostConfigs: [],
  }
}

describe('CR-X Track C/D: measured delivery outcomes are not instrumentation gaps', () => {
  it('merge-cycle-time: measured org-level evidence → org_level_only, NOT instrumentation_gap', () => {
    const out = generateMergeCycleTime(liveOrgLevelInput())
    expect(out).not.toBeNull()
    expect(out!.hasData).toBe(true)
    expect(out!.n).toBe(18)
    expect(out!.current).toBe(12.1)
    expect(out!.comparisonState).toBe('org_level_only')
    expect(out!.attributionStatus).toBe('org_level_only')

    const state = computeComparisonState(out as any)
    expect(state).toBe('org_level_only')
    expect(state).not.toBe('instrumentation_gap')
  })

  it('merge-rate: measured org-level evidence → org_level_only, NOT instrumentation_gap', () => {
    const out = generateMergeRate(liveOrgLevelInput())
    expect(out).not.toBeNull()
    expect(out!.hasData).toBe(true)
    expect(out!.current).toBeCloseTo(66.7, 1)
    expect(out!.comparisonState).toBe('org_level_only')

    const state = computeComparisonState(out as any)
    expect(state).toBe('org_level_only')
    expect(state).not.toBe('instrumentation_gap')
  })

  it('pr-throughput: measured org-level evidence → org_level_only, NOT instrumentation_gap', () => {
    const out = generatePrThroughput(liveOrgLevelInput())
    expect(out).not.toBeNull()
    expect(out!.hasData).toBe(true)
    expect(out!.n).toBe(27)
    expect(out!.comparisonState).toBe('org_level_only')

    const state = computeComparisonState(out as any)
    expect(state).toBe('org_level_only')
    expect(state).not.toBe('instrumentation_gap')
  })

  it('review-burden: measured org-level evidence → org_level_only, NOT instrumentation_gap', () => {
    const out = generateReviewBurden(liveOrgLevelInput())
    expect(out).not.toBeNull()
    expect(out!.hasData).toBe(true)
    expect(out!.comparisonState).toBe('org_level_only')

    const state = computeComparisonState(out as any)
    expect(state).toBe('org_level_only')
    expect(state).not.toBe('instrumentation_gap')
  })

  it('deployment-success-distribution: measured org-level evidence → org_level_only, NOT instrumentation_gap', () => {
    const out = generateDeploymentSuccessDistribution(liveOrgLevelInput())
    expect(out).not.toBeNull()
    expect(out!.hasData).toBe(true)
    expect(out!.current).toBeCloseTo(92, 1)
    expect(out!.comparisonState).toBe('org_level_only')

    const state = computeComparisonState(out as any)
    expect(state).toBe('org_level_only')
    expect(state).not.toBe('instrumentation_gap')
  })
})

describe('CR-X Track C/D: genuinely missing evidence remains a proper data gap', () => {
  it('release-cadence returns null when no release evidence exists', () => {
    const out = generateReleaseCadence(liveOrgLevelInput())
    expect(out).toBeNull()
  })

  it('release-cadence returns null when release_metrics has zero releases', () => {
    const inp = liveOrgLevelInput({
      release_metrics: {
        total_releases: 0,
        releases_in_period: 0,
        latest_release: null,
      },
    })
    const out = generateReleaseCadence(inp)
    expect(out).toBeNull()
  })
})

describe('CR-X Track C/D: org-level measurement does not imply workflow attribution', () => {
  it('no generator output claims workflow attribution when only org-level evidence exists', () => {
    const all = [
      generateMergeCycleTime(liveOrgLevelInput()),
      generateMergeRate(liveOrgLevelInput()),
      generatePrThroughput(liveOrgLevelInput()),
      generateReviewBurden(liveOrgLevelInput()),
      generateDeploymentSuccessDistribution(liveOrgLevelInput()),
    ].filter((i) => i !== null) as any[]

    for (const insight of all) {
      expect(insight.attributionStatus).toBe('org_level_only')
      expect(insight.comparisonState).toBe('org_level_only')
    }
  })

  it('no generator output contains L1 session→PR attribution language', () => {
    const all = [
      generateMergeCycleTime(liveOrgLevelInput()),
      generateMergeRate(liveOrgLevelInput()),
      generatePrThroughput(liveOrgLevelInput()),
      generateReviewBurden(liveOrgLevelInput()),
      generateDeploymentSuccessDistribution(liveOrgLevelInput()),
    ].filter((i) => i !== null) as any[]

    for (const insight of all) {
      const json = JSON.stringify(insight)
      expect(json).not.toMatch(/session.*pr.*attribut/i)
      expect(json).not.toMatch(/l1.*attribut/i)
      expect(json).not.toMatch(/causal/i)
      expect(json).not.toMatch(/\bcauses\b/i)
      expect(json).not.toMatch(/\bdrives\b/i)
    }
  })
})

describe('CR-X Track C/D: computeComparisonState presentationKind guard', () => {
  it('outcome_threshold + org_level_only → org_level_only (not instrumentation_gap)', () => {
    const insight = {
      hasData: true,
      n: 18,
      breakdownByTool: {},
      comparisonMode: 'threshold_vs_actual',
      presentationKind: 'outcome_threshold',
      comparisonState: 'org_level_only',
      cicdStage: 'review-merge',
    }
    expect(computeComparisonState(insight as any)).toBe('org_level_only')
  })

  it('success_failure_distribution + org_level_only → org_level_only (not instrumentation_gap)', () => {
    const insight = {
      hasData: true,
      n: 25,
      breakdownByTool: {},
      comparisonMode: 'threshold_vs_actual',
      presentationKind: 'success_failure_distribution',
      comparisonState: 'org_level_only',
      cicdStage: 'deploy-operate',
    }
    expect(computeComparisonState(insight as any)).toBe('org_level_only')
  })

  it('outcome_threshold without explicit org_level_only resolves org_level_only for review-merge (not instrumentation_gap)', () => {
    const insight = {
      hasData: true,
      n: 10,
      breakdownByTool: {},
      comparisonMode: 'threshold_vs_actual',
      presentationKind: 'outcome_threshold',
      // No explicit comparisonState
      cicdStage: 'review-merge',
    }
    // Review-merge delivery evidence is legitimately org-level: a measured
    // outcome without a workflow breakdown is org_level_only, not an
    // instrumentation gap ("required data fields not available").
    expect(computeComparisonState(insight as any)).toBe('org_level_only')
  })
})

/**
 * CR-X Track C/D: sample unit + source label + display unit semantics.
 *
 * Proves:
 * - merge-cycle-time sampleUnit = 'merged PRs', not 'sessions'
 * - merge-rate sampleUnit = 'PRs', not 'sessions'
 * - pr-throughput sampleUnit = 'PRs', not 'sessions'
 * - review-burden sampleUnit = 'PRs', not 'sessions'
 * - pr-throughput displayValue is a rate (e.g. "2.7/week"), not a percent
 * - review-burden displayUnit is 'events/PR', not '%'
 * - sourceLabel is 'GitHub delivery', not 'Telemetry'
 * - dataDomain is 'github_delivery', not 'telemetry'
 */
import { adaptCanonicalToUI as adaptCanonicalInsight } from '../lib/insights/final/adapters/renderAdapter'

describe('CR-X Track C/D: sample unit + source label + display unit semantics', () => {
  it('merge-cycle-time: sampleUnit = merged PRs, sourceLabel = GitHub delivery', () => {
    const out = generateMergeCycleTime(liveOrgLevelInput())
    expect(out).not.toBeNull()
    expect(out!.sampleUnit).toBe('merged PRs')
    expect(out!.sourceLabel).toBe('GitHub delivery')
    expect(out!.dataDomain).toBe('github_delivery')
    // displayValue already formatted with 'h' suffix
    expect(out!.displayValue).toMatch(/h$/)
  })

  it('merge-rate: sampleUnit = PRs, sourceLabel = GitHub delivery', () => {
    const out = generateMergeRate(liveOrgLevelInput())
    expect(out).not.toBeNull()
    expect(out!.sampleUnit).toBe('PRs')
    expect(out!.sourceLabel).toBe('GitHub delivery')
    expect(out!.dataDomain).toBe('github_delivery')
    // displayValue is a percentage (correct for merge rate)
    expect(out!.displayValue).toMatch(/%$/)
    expect(out!.displayUnit).toBe('%')
  })

  it('pr-throughput: sampleUnit = PRs, displayValue is rate not percent', () => {
    const out = generatePrThroughput(liveOrgLevelInput())
    expect(out).not.toBeNull()
    expect(out!.sampleUnit).toBe('PRs')
    expect(out!.sourceLabel).toBe('GitHub delivery')
    expect(out!.dataDomain).toBe('github_delivery')
    // displayValue must be a rate like "2.7/week", NOT a percent
    expect(out!.displayValue).toMatch(/\/week$/)
    expect(out!.displayValue).not.toMatch(/%/)
    expect(out!.displayUnit).toBe('PRs/week')
  })

  it('review-burden: sampleUnit = PRs, displayUnit is events/PR not percent', () => {
    const out = generateReviewBurden(liveOrgLevelInput())
    expect(out).not.toBeNull()
    expect(out!.sampleUnit).toBe('PRs')
    expect(out!.sourceLabel).toBe('GitHub delivery')
    expect(out!.dataDomain).toBe('github_delivery')
    // displayValue is a numeric string (e.g. "3.7")
    expect(out!.displayValue).not.toMatch(/%/)
    expect(out!.displayUnit).toBe('events/PR')
  })

  it('deployment-success-distribution: sampleUnit + sourceLabel preserved', () => {
    const out = generateDeploymentSuccessDistribution(liveOrgLevelInput())
    expect(out).not.toBeNull()
    expect(out!.sourceLabel).toBe('GitHub delivery')
    expect(out!.dataDomain).toBe('github_delivery')
  })
})

describe('CR-X Track C/D: render adapter carries sampleUnit + displayUnit through', () => {
  it('adapter preserves sampleUnit for merge-cycle-time', () => {
    const out = generateMergeCycleTime(liveOrgLevelInput())
    const adapted = adaptCanonicalInsight(out as any)
    expect((adapted as any).sampleUnit).toBe('merged PRs')
    expect((adapted as any).sourceLabel).toBe('GitHub delivery')
  })

  it('adapter preserves sampleUnit + displayUnit for pr-throughput', () => {
    const out = generatePrThroughput(liveOrgLevelInput())
    const adapted = adaptCanonicalInsight(out as any)
    expect((adapted as any).sampleUnit).toBe('PRs')
    expect((adapted as any).displayUnit).toBe('PRs/week')
    expect((adapted as any).displayValue).toMatch(/\/week$/)
  })

  it('adapter preserves sampleUnit + displayUnit for review-burden', () => {
    const out = generateReviewBurden(liveOrgLevelInput())
    const adapted = adaptCanonicalInsight(out as any)
    expect((adapted as any).sampleUnit).toBe('PRs')
    expect((adapted as any).displayUnit).toBe('events/PR')
    expect((adapted as any).displayValue).not.toMatch(/%/)
  })

  it('adapter preserves sourceLabel for all five affected cards', () => {
    const cards = [
      generateMergeCycleTime(liveOrgLevelInput()),
      generateMergeRate(liveOrgLevelInput()),
      generatePrThroughput(liveOrgLevelInput()),
      generateReviewBurden(liveOrgLevelInput()),
      generateDeploymentSuccessDistribution(liveOrgLevelInput()),
    ].filter((i) => i !== null) as any[]

    for (const card of cards) {
      const adapted = adaptCanonicalInsight(card as any)
      expect((adapted as any).sourceLabel).toBe('GitHub delivery')
      expect((adapted as any).sourceLabel).not.toBe('Telemetry')
    }
  })
})
