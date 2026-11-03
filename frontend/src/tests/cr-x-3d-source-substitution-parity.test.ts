/**
 * CR-X 3D: Source-substitution contract — PI parity proof.
 *
 * Proves that equivalent business facts produce equivalent PI findings
 * regardless of provenance (Local seeded cm_activity_sim vs live
 * github_api_sync with engineering authorization).
 *
 * The measurement semantics are the same. The only acceptable differences
 * are provenance labels, auth state, and github_connected state.
 *
 * Also proves the empty-pilot contract: no evidence → no invented PIs.
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
import {
  generateAllocatedSpendPerMergedPR,
  generateAllocatedSpendPerDeployment,
  generateAllocatedSpendPerSuccessfulDeployment,
  generateAllocatedSpendPerRelease,
} from '../lib/insights/final/generators/unitEconomics'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

// ─── Shared business facts ───────────────────────────────────────────
// These are the SAME underlying facts, just with different provenance.

const SHARED_PR_FACTS = {
  merged_pull_requests: 18,
  total_pull_requests: 27,
  github_team_metrics: {
    time_to_merge: 12.1,
    merged_prs: 18,
    total_prs: 27,
    merge_rate: 66.7,
    reopened_prs: 3,
  },
  pr_review_metrics: {
    review_count: 72,
    unique_reviewer_count: 5,
    pr_reopened_count: 6,
    total_prs: 21,
    first_review_at: '2026-06-01T00:00:00Z',
  },
}

const SHARED_DEPLOY_FACTS = {
  deployment_metrics: {
    success_deployment_count: 23,
    failed_deployment_count: 2,
    deployment_frequency: 6.25,
    change_failure_rate: 8,
    deployment_reliability: {
      total: 25,
      success: 23,
      failed: 2,
      success_rate: 92,
      production_total: 20,
      production_failed: 2,
      staging_total: 5,
      observed_days: 30,
      rollback_count: 0,
    },
  },
}

const SHARED_RELEASE_FACTS = {
  release_metrics: {
    total_releases: 6,
    releases_in_period: 6,
    latest_release: { tag_name: 'v1.0.0', published_at: '2026-06-20T00:00:00Z', repo_name: 'org/repo' },
  },
}

const SHARED_OUTCOMES_BY_MONTH = (source: string, dataSource: string) => [
  {
    month: '2026-06',
    merged_pr_count: 18,
    total_pr_count: 27,
    review_cycle_count: 78,
    deployment_count: 25,
    successful_deployment_count: 23,
    failed_deployment_count: 2,
    release_count: 6,
    source,
    data_source: dataSource,
    count_authority: 'observed_rows',
  },
]

const SHARED_COST_CONFIGS = [
  { toolId: 'cursor', monthlySpend: 600 },
]

const SHARED_PERIODS = [
  { period: '2026-W01' }, { period: '2026-W02' }, { period: '2026-W03' }, { period: '2026-W04' },
]

// ─── Local seeded input (cm_activity_sim) ────────────────────────────

function localSeededInput(): CanonicalInsightInput {
  return {
    sessionRows: [],
    githubByPeriod: SHARED_PERIODS,
    githubSnapshot: {
      github_provenance: {
        source: 'cm_activity_sim',
        historical_data_available: true,
        db_data_available: true,
      },
      github_data_source: 'cm_activity_sim',
      ...SHARED_PR_FACTS,
      ...SHARED_DEPLOY_FACTS,
      ...SHARED_RELEASE_FACTS,
      outcomes_by_month: SHARED_OUTCOMES_BY_MONTH('cm_activity_sim', 'seeded'),
    },
    externalCostConfigs: SHARED_COST_CONFIGS,
  }
}

// ─── Live authorized input (github_api_sync + engineering auth) ──────

function liveAuthorizedInput(): CanonicalInsightInput {
  return {
    sessionRows: [],
    githubByPeriod: SHARED_PERIODS,
    githubSnapshot: {
      github_provenance: {
        source: 'github_api',
        historical_data_available: true,
        db_data_available: true,
        live_fetch_ok: true,
      },
      github_data_source: 'github_api',
      ...SHARED_PR_FACTS,
      ...SHARED_DEPLOY_FACTS,
      ...SHARED_RELEASE_FACTS,
      outcomes_by_month: SHARED_OUTCOMES_BY_MONTH('github_api_sync', 'live'),
    },
    externalCostConfigs: SHARED_COST_CONFIGS,
  }
}

// ─── Empty pilot input (no evidence at all) ──────────────────────────

function emptyPilotInput(): CanonicalInsightInput {
  return {
    sessionRows: [],
    githubByPeriod: [],
    githubSnapshot: {
      github_provenance: {
        source: 'fixture_fallback',
        historical_data_available: false,
        db_data_available: false,
      },
      github_data_source: 'fixture_fallback',
    },
    externalCostConfigs: [],
  }
}

// ─── Helper: extract key numeric fields from an insight ──────────────

function insightKey(insight: any): { id: string; current: number; n: number; hasData: boolean } | null {
  if (!insight) return null
  return {
    id: insight.id,
    current: insight.current,
    n: insight.n,
    hasData: insight.hasData,
  }
}

// ====================================================================
// PHASE F: PI parity — Review & Merge
// ====================================================================

describe('CR-X 3D: PI parity — Review & Merge', () => {
  it('merge-cycle-time produces equivalent findings', () => {
    const local = generateMergeCycleTime(localSeededInput())
    const live = generateMergeCycleTime(liveAuthorizedInput())
    const lk = insightKey(local)
    const lvk = insightKey(live)
    expect(lk).not.toBeNull()
    expect(lvk).not.toBeNull()
    expect(lk!.current).toBe(lvk!.current)
    expect(lk!.n).toBe(lvk!.n)
    expect(lk!.hasData).toBe(lvk!.hasData)
  })

  it('merge-rate produces equivalent findings', () => {
    const local = generateMergeRate(localSeededInput())
    const live = generateMergeRate(liveAuthorizedInput())
    expect(insightKey(local)).toEqual(insightKey(live))
  })

  it('pr-throughput produces equivalent findings', () => {
    const local = generatePrThroughput(localSeededInput())
    const live = generatePrThroughput(liveAuthorizedInput())
    expect(insightKey(local)).toEqual(insightKey(live))
  })

  it('review-burden produces equivalent findings', () => {
    const local = generateReviewBurden(localSeededInput())
    const live = generateReviewBurden(liveAuthorizedInput())
    expect(insightKey(local)).toEqual(insightKey(live))
  })
})

// ====================================================================
// PHASE F: PI parity — Deploy & Operate
// ====================================================================

describe('CR-X 3D: PI parity — Deploy & Operate', () => {
  it('deployment-success-distribution produces equivalent findings', () => {
    const local = generateDeploymentSuccessDistribution(localSeededInput())
    const live = generateDeploymentSuccessDistribution(liveAuthorizedInput())
    expect(insightKey(local)).toEqual(insightKey(live))
  })

  it('release-cadence produces equivalent findings', () => {
    const local = generateReleaseCadence(localSeededInput())
    const live = generateReleaseCadence(liveAuthorizedInput())
    expect(insightKey(local)).toEqual(insightKey(live))
  })

  it('deployment-failure-concentration produces equivalent findings', () => {
    const local = generateDeploymentFailureConcentration(localSeededInput())
    const live = generateDeploymentFailureConcentration(liveAuthorizedInput())
    expect(insightKey(local)).toEqual(insightKey(live))
  })
})

// ====================================================================
// PHASE F: PI parity — Unit Economics
// ====================================================================

describe('CR-X 3D: PI parity — Unit Economics', () => {
  it('allocated-spend-per-merged-pr produces equivalent findings', () => {
    const local = generateAllocatedSpendPerMergedPR(localSeededInput())
    const live = generateAllocatedSpendPerMergedPR(liveAuthorizedInput())
    expect(insightKey(local)).toEqual(insightKey(live))
  })

  it('allocated-spend-per-deployment produces equivalent findings', () => {
    const local = generateAllocatedSpendPerDeployment(localSeededInput())
    const live = generateAllocatedSpendPerDeployment(liveAuthorizedInput())
    expect(insightKey(local)).toEqual(insightKey(live))
  })

  it('allocated-spend-per-successful-deployment produces equivalent findings', () => {
    const local = generateAllocatedSpendPerSuccessfulDeployment(localSeededInput())
    const live = generateAllocatedSpendPerSuccessfulDeployment(liveAuthorizedInput())
    expect(insightKey(local)).toEqual(insightKey(live))
  })

  it('allocated-spend-per-release produces equivalent findings', () => {
    const local = generateAllocatedSpendPerRelease(localSeededInput())
    const live = generateAllocatedSpendPerRelease(liveAuthorizedInput())
    expect(insightKey(local)).toEqual(insightKey(live))
  })
})

// ====================================================================
// PHASE F: PI parity — full generator output parity
// ====================================================================

describe('CR-X 3D: PI parity — full Review & Merge insight set', () => {
  it('equivalent local and live inputs produce equivalent insight IDs', () => {
    const localInsights = generateReviewMergeInsights(localSeededInput())
    const liveInsights = generateReviewMergeInsights(liveAuthorizedInput())
    const localIds = localInsights.map(i => i.id).sort()
    const liveIds = liveInsights.map(i => i.id).sort()
    expect(localIds).toEqual(liveIds)
  })
})

describe('CR-X 3D: PI parity — full Deploy & Operate insight set', () => {
  it('equivalent local and live inputs produce equivalent insight IDs', () => {
    const localInsights = generateDeployOperateInsights(localSeededInput())
    const liveInsights = generateDeployOperateInsights(liveAuthorizedInput())
    const localIds = localInsights.map(i => i.id).sort()
    const liveIds = liveInsights.map(i => i.id).sort()
    expect(localIds).toEqual(liveIds)
  })
})

// ====================================================================
// PHASE G: Empty pilot contract
// ====================================================================

describe('CR-X 3D: Empty pilot contract — no evidence yields no invented PIs', () => {
  it('all Review & Merge generators return null with no evidence', () => {
    const input = emptyPilotInput()
    expect(generateMergeCycleTime(input)).toBeNull()
    expect(generateMergeRate(input)).toBeNull()
    expect(generatePrThroughput(input)).toBeNull()
    expect(generateReviewBurden(input)).toBeNull()
  })

  it('all Deploy & Operate generators return null with no evidence', () => {
    const input = emptyPilotInput()
    expect(generateDeploymentSuccessDistribution(input)).toBeNull()
    expect(generateReleaseCadence(input)).toBeNull()
    expect(generateDeploymentFailureConcentration(input)).toBeNull()
  })

  it('all Unit Economics generators return null with no evidence or no cost config', () => {
    const input = emptyPilotInput()
    expect(generateAllocatedSpendPerMergedPR(input)).toBeNull()
    expect(generateAllocatedSpendPerDeployment(input)).toBeNull()
    expect(generateAllocatedSpendPerSuccessfulDeployment(input)).toBeNull()
    expect(generateAllocatedSpendPerRelease(input)).toBeNull()
  })

  it('Review & Merge insight set is empty with no evidence', () => {
    const insights = generateReviewMergeInsights(emptyPilotInput())
    expect(insights).toHaveLength(0)
  })

  it('Deploy & Operate insight set is empty with no evidence', () => {
    const insights = generateDeployOperateInsights(emptyPilotInput())
    expect(insights).toHaveLength(0)
  })
})

// ====================================================================
// PHASE G: Empty pilot → evidence arrives naturally
// ====================================================================

describe('CR-X 3D: Evidence arrives naturally after empty pilot', () => {
  it('GitHub evidence arriving activates GitHub PIs', () => {
    // Start empty
    expect(generateMergeCycleTime(emptyPilotInput())).toBeNull()
    // GitHub evidence arrives
    const withEvidence = liveAuthorizedInput()
    expect(generateMergeCycleTime(withEvidence)).not.toBeNull()
    expect(generateDeploymentSuccessDistribution(withEvidence)).not.toBeNull()
    expect(generateReleaseCadence(withEvidence)).not.toBeNull()
  })

  it('configured spend arriving activates unit economics', () => {
    // No cost config → no UE
    const noCost = { ...liveAuthorizedInput(), externalCostConfigs: [] }
    expect(generateAllocatedSpendPerMergedPR(noCost)).toBeNull()
    // Cost config arrives
    const withCost = { ...liveAuthorizedInput(), externalCostConfigs: SHARED_COST_CONFIGS }
    expect(generateAllocatedSpendPerMergedPR(withCost)).not.toBeNull()
    expect(generateAllocatedSpendPerRelease(withCost)).not.toBeNull()
  })
})
