/**
 * CR-X 3C.1: Downstream release consumer proofs.
 *
 * Proves that backend-observed release authority correctly reaches the
 * two product consumers:
 *
 * A. release-cadence generator
 *    - Local qualifying cm_activity_sim release evidence reaches the generator
 *    - Nonqualifying provenance does not produce a finding
 *    - Live unauthorized release evidence does not produce a finding
 *
 * B. allocated-spend-per-release generator
 *    - Local qualifying cm_activity_sim releases provide the observed
 *      release denominator
 *    - Nonqualifying provenance does not
 *    - Live unauthorized release evidence does not
 *
 * The generators consume backend-provided fields:
 *   release-cadence: githubSnapshot.release_metrics.releases_in_period
 *   allocated-spend-per-release: outcomes_by_month[].release_count
 *
 * The backend provenance gate (isReleaseProvenanceEligible + engineering
 * evidence eligibility) ensures only qualifying release rows reach these
 * fields. These tests prove the frontend generators correctly consume
 * that authority.
 */
import { describe, it, expect } from 'vitest'
import {
  generateReleaseCadence,
} from '../lib/insights/final/generators/deployOperate'
import {
  generateAllocatedSpendPerRelease,
} from '../lib/insights/final/generators/unitEconomics'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

// ─── Local qualifying cm_activity_sim release evidence ──────────────

function localQualifyingReleaseInput(): CanonicalInsightInput {
  return {
    sessionRows: [],
    githubByPeriod: [{ period: '2026-W01' }, { period: '2026-W02' }, { period: '2026-W03' }, { period: '2026-W04' }],
    githubSnapshot: {
      github_provenance: {
        source: 'cm_activity_sim',
        historical_data_available: true,
        db_data_available: true,
      },
      github_data_source: 'cm_activity_sim',
      deployment_metrics: {
        success_deployment_count: 23,
        failed_deployment_count: 2,
      },
      release_metrics: {
        total_releases: 6,
        releases_in_period: 6,
        latest_release: { tag_name: 'v1.0.0', published_at: '2026-06-15T00:00:00Z', repo_name: 'mattmcclintock/cm-activity-sim' },
      },
      outcomes_by_month: [
        {
          month: '2026-06',
          merged_pr_count: 18,
          total_pr_count: 27,
          review_cycle_count: 78,
          deployment_count: 25,
          successful_deployment_count: 23,
          failed_deployment_count: 2,
          release_count: 6,
          source: 'cm_activity_sim',
          data_source: 'seeded',
          count_authority: 'observed_rows',
        },
      ],
    },
    externalCostConfigs: [
      { toolId: 'cursor', monthlySpend: 600 },
    ],
  }
}

// ─── Nonqualifying: no release evidence ─────────────────────────────

function noReleaseEvidenceInput(): CanonicalInsightInput {
  return {
    sessionRows: [],
    githubByPeriod: [{ period: '2026-W01' }, { period: '2026-W02' }, { period: '2026-W03' }, { period: '2026-W04' }],
    githubSnapshot: {
      github_provenance: {
        source: 'cm_activity_sim',
        historical_data_available: true,
        db_data_available: true,
      },
      github_data_source: 'cm_activity_sim',
      deployment_metrics: {
        success_deployment_count: 23,
        failed_deployment_count: 2,
      },
      // release_metrics absent or zero — backend returned no eligible releases
      release_metrics: {
        total_releases: 0,
        releases_in_period: 0,
        latest_release: null,
      },
      outcomes_by_month: [
        {
          month: '2026-06',
          merged_pr_count: 18,
          total_pr_count: 27,
          review_cycle_count: 78,
          deployment_count: 25,
          successful_deployment_count: 23,
          failed_deployment_count: 2,
          release_count: 0, // backend provenance gate excluded all releases
          source: 'cm_activity_sim',
          data_source: 'seeded',
          count_authority: 'observed_rows',
        },
      ],
    },
    externalCostConfigs: [
      { toolId: 'cursor', monthlySpend: 600 },
    ],
  }
}

// ─── Live unauthorized: no engineering evidence ─────────────────────

function liveUnauthorizedReleaseInput(): CanonicalInsightInput {
  return {
    sessionRows: [],
    githubByPeriod: [{ period: '2026-W01' }, { period: '2026-W02' }, { period: '2026-W03' }, { period: '2026-W04' }],
    githubSnapshot: {
      // No authoritative GitHub evidence — engineering OAuth not eligible
      github_provenance: {
        source: 'fixture_fallback',
        historical_data_available: false,
        db_data_available: false,
      },
      github_data_source: 'fixture_fallback',
      deployment_metrics: {
        success_deployment_count: 0,
        failed_deployment_count: 0,
      },
      // Backend returned zeros — calculateReleaseMetrics gated by isEngineeringEvidenceEligible
      release_metrics: {
        total_releases: 0,
        releases_in_period: 0,
        latest_release: null,
      },
      outcomes_by_month: [
        {
          month: '2026-06',
          merged_pr_count: 0,
          total_pr_count: 0,
          review_cycle_count: 0,
          deployment_count: 0,
          successful_deployment_count: 0,
          failed_deployment_count: 0,
          release_count: 0, // aggregateOutcomesByMonth gated by isEngineeringEvidenceEligible
          source: '',
          data_source: '',
          count_authority: 'observed_rows',
        },
      ],
    },
    externalCostConfigs: [
      { toolId: 'cursor', monthlySpend: 600 },
    ],
  }
}

// ─── Live authorized with real release evidence ─────────────────────

function liveAuthorizedReleaseInput(): CanonicalInsightInput {
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
      deployment_metrics: {
        success_deployment_count: 45,
        failed_deployment_count: 5,
      },
      release_metrics: {
        total_releases: 8,
        releases_in_period: 8,
        latest_release: { tag_name: 'v1.4.0', published_at: '2026-09-05T00:00:00Z', repo_name: 'org/repo' },
      },
      outcomes_by_month: [
        {
          month: '2026-06',
          merged_pr_count: 30,
          total_pr_count: 40,
          review_cycle_count: 88,
          deployment_count: 50,
          successful_deployment_count: 45,
          failed_deployment_count: 5,
          release_count: 8,
          source: 'github_api_sync',
          data_source: 'live',
          count_authority: 'observed_rows',
        },
      ],
    },
    externalCostConfigs: [
      { toolId: 'cursor', monthlySpend: 800 },
    ],
  }
}

// ====================================================================
// A. release-cadence downstream consumer
// ====================================================================

describe('CR-X 3C.1: release-cadence downstream consumer', () => {
  it('Local qualifying cm_activity_sim release evidence reaches the generator', () => {
    const out = generateReleaseCadence(localQualifyingReleaseInput())
    expect(out).not.toBeNull()
    expect(out!.id).toBe('release-cadence')
    expect(out!.hasData).toBe(true)
    expect(out!.n).toBe(6)
    expect(out!.rightMetric).toBe('6 releases')
  })

  it('nonqualifying provenance (zero releases) does not produce a finding', () => {
    const out = generateReleaseCadence(noReleaseEvidenceInput())
    expect(out).toBeNull()
  })

  it('live unauthorized release evidence does not produce a finding', () => {
    const out = generateReleaseCadence(liveUnauthorizedReleaseInput())
    expect(out).toBeNull()
  })

  it('live authorized release evidence produces a finding', () => {
    const out = generateReleaseCadence(liveAuthorizedReleaseInput())
    expect(out).not.toBeNull()
    expect(out!.id).toBe('release-cadence')
    expect(out!.n).toBe(8)
  })
})

// ====================================================================
// B. allocated-spend-per-release downstream consumer
// ====================================================================

describe('CR-X 3C.1: allocated-spend-per-release downstream consumer', () => {
  it('Local qualifying cm_activity_sim releases provide the observed release denominator', () => {
    const out = generateAllocatedSpendPerRelease(localQualifyingReleaseInput())
    expect(out).not.toBeNull()
    expect(out!.id).toBe('allocated-spend-per-release')
    expect(out!.hasData).toBe(true)
    // 600 configured spend / 6 releases = 100 per release
    const json = JSON.stringify(out)
    expect(json).toContain('100')
  })

  it('nonqualifying provenance (zero release_count) does not produce a finding', () => {
    const out = generateAllocatedSpendPerRelease(noReleaseEvidenceInput())
    expect(out).toBeNull()
  })

  it('live unauthorized release evidence does not produce a finding', () => {
    const out = generateAllocatedSpendPerRelease(liveUnauthorizedReleaseInput())
    expect(out).toBeNull()
  })

  it('live authorized release evidence produces a finding', () => {
    const out = generateAllocatedSpendPerRelease(liveAuthorizedReleaseInput())
    expect(out).not.toBeNull()
    expect(out!.id).toBe('allocated-spend-per-release')
    // 800 configured spend / 8 releases = 100 per release
    const json = JSON.stringify(out)
    expect(json).toContain('100')
  })
})
