/**
 * CR-X Track C/D: Review & Merge + Deploy & Operate delivery outcome generators.
 *
 * Proves:
 * - New generators return null when no authoritative evidence (no synthetic fallback)
 * - New generators produce findings with live GitHub delivery evidence
 * - Attribution labeling is org_level_only when no PR commit lineage is available
 * - review-burden is labeled as BURDEN, never "review cycles"
 * - No causal language anywhere
 */
import { describe, it, expect } from 'vitest'
import {
  generateMergeCycleTime,
  generateMergeRate,
  generatePrThroughput,
  generateReviewBurden,
  generateReviewMergeInsights,
} from '../lib/insights/final/generators/reviewMerge'
import {
  generateDeploymentSuccessDistribution,
  generateReleaseCadence,
  generateDeploymentFailureConcentration,
  generateDeployOperateInsights,
} from '../lib/insights/final/generators/deployOperate'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

function liveInput(overrides: any = {}): CanonicalInsightInput {
  return {
    sessionRows: [],
    githubByPeriod: [{ period: '2026-W01' }, { period: '2026-W02' }, { period: '2026-W03' }, { period: '2026-W04' }],
    githubSnapshot: {
      github_provenance: {
        source: 'github_api',
        historical_data_available: true,
        db_data_available: true,
        live_fetch_ok: true,
      },
      github_data_source: 'github_api',
      github_team_metrics: {
        time_to_merge: 36,
        merged_prs: 30,
        total_prs: 40,
        merge_rate: 75,
        reopened_prs: 4,
      },
      merged_pull_requests: 30,
      total_pull_requests: 40,
      pr_review_metrics: {
        review_count: 80,
        unique_reviewer_count: 5,
        pr_reopened_count: 8,
        total_prs: 40,
        first_review_at: '2026-09-01T00:00:00Z',
      },
      deployment_metrics: {
        success_deployment_count: 45,
        failed_deployment_count: 5,
        deployment_frequency: 12.5,
        change_failure_rate: 10,
        deployment_reliability: {
          total: 50,
          success: 45,
          failed: 5,
          success_rate: 90,
          production_total: 20,
          production_failed: 4,
          staging_total: 30,
          observed_days: 28,
          rollback_count: 2,
        },
      },
      release_metrics: {
        total_releases: 8,
        releases_in_period: 8,
        latest_release: { tag_name: 'v1.4.0', published_at: '2026-09-05T00:00:00Z', repo_name: 'org/repo' },
      },
      ...overrides,
    },
    externalCostConfigs: [],
  }
}

const seededInput: CanonicalInsightInput = {
  sessionRows: [],
  githubByPeriod: [],
  githubSnapshot: {
    github_provenance: { source: 'cm_activity_sim', historical_data_available: false },
    github_data_source: 'fixture_fallback',
  },
  externalCostConfigs: [],
}

describe('CR-X Track C: Review & Merge delivery outcomes', () => {
  it('generators return null with no authoritative evidence (no synthetic fallback)', () => {
    expect(generateMergeCycleTime(seededInput)).toBeNull()
    expect(generateMergeRate(seededInput)).toBeNull()
    expect(generatePrThroughput(seededInput)).toBeNull()
    expect(generateReviewBurden(seededInput)).toBeNull()
  })

  it('merge-cycle-time produces a finding from live team metrics', () => {
    const out = generateMergeCycleTime(liveInput())
    expect(out).not.toBeNull()
    expect(out!.id).toBe('merge-cycle-time')
    expect(out!.hasData).toBe(true)
    expect(out!.n).toBe(30)
    expect(out!.current).toBe(36)
    expect(out!.polarity).toBe('lower_is_better')
  })

  it('merge-rate produces a finding from live team metrics', () => {
    const out = generateMergeRate(liveInput())
    expect(out).not.toBeNull()
    expect(out!.id).toBe('merge-rate')
    expect(out!.current).toBeCloseTo(75, 1)
    expect(out!.polarity).toBe('higher_is_better')
  })

  it('pr-throughput produces a finding from live team metrics', () => {
    const out = generatePrThroughput(liveInput())
    expect(out).not.toBeNull()
    expect(out!.id).toBe('pr-throughput')
    expect(out!.n).toBe(40)
  })

  it('review-burden labels as BURDEN, never claims actual review cycles', () => {
    const out = generateReviewBurden(liveInput())
    expect(out).not.toBeNull()
    expect(out!.id).toBe('review-burden')
    expect(out!.title).toMatch(/review burden/i)
    expect(out!.rightMetricLabel).toMatch(/review burden/i)
    // Must disclose that aggregate counts are NOT true review cycles
    const json = JSON.stringify(out!)
    expect(json).toMatch(/not true review cycles/i)
    // Must not present a "review cycle" count as a measured metric
    expect(out!.metricDefinition).not.toMatch(/^review cycle/i)
    expect(out!.displayUnit).not.toMatch(/cycle/i)
  })

  it('attribution is org_level_only when no PR commit lineage is available', () => {
    const out = generateMergeCycleTime(liveInput())
    expect(out!.attributionStatus).toBe('org_level_only')
    expect(out!.comparisonState).toBe('org_level_only')
  })

  it('orchestrator includes the new generators', () => {
    const insights = generateReviewMergeInsights(liveInput())
    const ids = insights.map((i) => i.id)
    expect(ids).toContain('merge-cycle-time')
    expect(ids).toContain('merge-rate')
    expect(ids).toContain('pr-throughput')
    expect(ids).toContain('review-burden')
  })
})

describe('CR-X Track D: Deploy & Operate delivery outcomes', () => {
  it('generators return null with no authoritative evidence', () => {
    expect(generateDeploymentSuccessDistribution(seededInput)).toBeNull()
    expect(generateReleaseCadence(seededInput)).toBeNull()
    expect(generateDeploymentFailureConcentration(seededInput)).toBeNull()
  })

  it('deployment-success-distribution produces a finding with composition', () => {
    const out = generateDeploymentSuccessDistribution(liveInput())
    expect(out).not.toBeNull()
    expect(out!.id).toBe('deployment-success-distribution')
    expect(out!.presentationType).toBe('distribution')
    expect(out!.current).toBeCloseTo(90, 1)
    expect((out as any).outcomeComposition).toBeDefined()
    expect((out as any).outcomeComposition.success).toBe(45)
    expect((out as any).outcomeComposition.failed).toBe(5)
  })

  it('release-cadence produces a finding from release metrics', () => {
    const out = generateReleaseCadence(liveInput())
    expect(out).not.toBeNull()
    expect(out!.id).toBe('release-cadence')
    expect(out!.n).toBe(8)
  })

  it('deployment-failure-concentration reports production concentration', () => {
    const out = generateDeploymentFailureConcentration(liveInput())
    expect(out).not.toBeNull()
    expect(out!.id).toBe('deployment-failure-concentration')
    expect((out as any).outcomeComposition.productionFailed).toBe(4)
    expect((out as any).outcomeComposition.rollbackCount).toBe(2)
  })

  it('orchestrator includes the new generators', () => {
    const insights = generateDeployOperateInsights(liveInput())
    const ids = insights.map((i) => i.id)
    expect(ids).toContain('deployment-success-distribution')
    expect(ids).toContain('release-cadence')
    expect(ids).toContain('deployment-failure-concentration')
  })
})

describe('CR-X Track C/D: attribution and language integrity', () => {
  it('no causal language in any new generator output', () => {
    const all = [
      ...generateReviewMergeInsights(liveInput()),
      ...generateDeployOperateInsights(liveInput()),
    ].filter((i) =>
      ['merge-cycle-time', 'merge-rate', 'pr-throughput', 'review-burden',
       'deployment-success-distribution', 'release-cadence', 'deployment-failure-concentration'].includes(i.id)
    )
    for (const insight of all) {
      const json = JSON.stringify(insight)
      expect(json).not.toMatch(/\b(causes|caused by|drives|leads to|proves that)\b/i)
    }
  })

  it('attribution degrades to org_level_only without PR lineage, never workflow_attributed', () => {
    const all = [
      ...generateReviewMergeInsights(liveInput()),
      ...generateDeployOperateInsights(liveInput()),
    ].filter((i) =>
      ['merge-cycle-time', 'merge-rate', 'pr-throughput', 'review-burden',
       'deployment-success-distribution', 'release-cadence', 'deployment-failure-concentration'].includes(i.id)
    )
    for (const insight of all) {
      expect(insight.attributionStatus).toBe('org_level_only')
    }
  })
})
