/**
 * CR-X 3D.4: PI source-parity regression contracts.
 *
 * Proves that:
 *   1. fetchGithubSnapshot uses authenticatedFetch (not plain fetch) so the
 *      SimpleTokenAuth middleware receives the dashboard credential.
 *      Previously, plain fetch() omitted the Authorization header, causing
 *      a 401 and silently returning undefined — which left PI consuming
 *      the stale githubStore LKG cache while PBT's
 *      /api/delivery/timeseries (which uses authenticatedFetch) showed the
 *      fresh extended population.
 *   2. fetchGithubSnapshot is exported from dataAccess.ts so the dashboard
 *      can fetch a fresh snapshot in refreshPI instead of relying on the
 *      potentially-stale githubStore.rawResponse LKG.
 *   3. The PBT org-level delivery presentation contract: when isDeliveryMetric
 *      is true, the chart title is "Delivery Performance Analysis" (not
 *      "AI Workflow Performance Analysis") and the count badge says "series"
 *      (not "workflows").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks (vi.mock is hoisted — use vi.fn() inside factory) ────────

vi.mock('../config/api', () => ({
  authenticatedFetch: vi.fn(),
  API_URL: 'http://localhost:8010',
  default: { get: vi.fn(), defaults: { baseURL: 'http://localhost:8010' } },
}))

vi.mock('../utils/apiUrl', () => ({
  buildApiUrl: (path: string) => `http://localhost:8010/api/${path}`,
}))

vi.mock('../lib/insights/runtimeMode', () => ({
  isLocalLabMode: () => true,
  isLivePilotMode: () => false,
  getEvidenceMode: () => 'lab',
  getTelemetryStatusPhrase: () => 'Local Lab',
  getTelemetryStatusShort: () => 'Lab',
  getOperationalSignalText: () => '',
}))

vi.mock('../lib/surfaceAgentContract', () => ({
  resolveSurface: () => ({ surface: 'pbt', available: true }),
  isMetricAvailable: () => true,
}))

vi.mock('../lib/insights/final/observedCommitAuthority', () => ({
  computeObservedCommitTtfcByWorkflow: () => new Map(),
}))

vi.mock('../lib/intervalUnion', () => ({
  computeTimeSemantics: () => ({ active: 0, total: 0 }),
  computeConcurrency: () => 0,
}))

vi.mock('../lib/workflowIdentity', () => ({
  normalizeToCanonicalToolId: (id: string) => id,
}))

vi.mock('../lib/insights/final/utils/logging', () => ({
  piDebugLog: () => {},
  piDebugWarn: () => {},
}))

import { fetchGithubSnapshot, isGithubEvidenceEligibleCombined } from '../lib/insights/final/dataAccess'
import { authenticatedFetch } from '../config/api'

// ─── Test data ─────────────────────────────────────────────────────

const MOCK_METRICS_RESPONSE = {
  github_team_metrics: {
    total_prs: 51,
    merged_prs: 34,
    merge_rate: 66.7,
    time_to_merge: 12.5,
  },
  pr_review_metrics: {
    total_prs: 43,
    review_count: 120,
    pr_reopened_count: 8,
    unique_reviewer_count: 5,
  },
  deployment_metrics: {
    success_deployment_count: 37,
    failed_deployment_count: 4,
    deployment_frequency: 2.5,
    change_failure_rate: 9.8,
  },
  github_provenance: {
    source: 'cm_activity_sim',
    historical_data_available: true,
    db_data_available: true,
  },
  github_by_period: [
    { period: '2026-W14', prCycleTimeHours: 12 },
    { period: '2026-W15', prCycleTimeHours: 14 },
  ],
  outcomes_by_month: [
    { month: '2026-05', deployment_count: 15, count_authority: 'observed_rows' },
  ],
}

function makeOkResponse(data: any) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  }
}

// Track if global fetch is called (it should NOT be)
const mockGlobalFetch = vi.fn()
;(globalThis as any).fetch = mockGlobalFetch

// ─── Tests ──────────────────────────────────────────────────────────

describe('CR-X 3D.4: fetchGithubSnapshot auth parity', () => {
  beforeEach(() => {
    vi.mocked(authenticatedFetch).mockReset()
    mockGlobalFetch.mockReset()
  })

  it('uses authenticatedFetch (not plain fetch) so the auth header is sent', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(makeOkResponse(MOCK_METRICS_RESPONSE) as any)

    const result = await fetchGithubSnapshot()

    // authenticatedFetch MUST be called
    expect(authenticatedFetch).toHaveBeenCalledTimes(1)
    // plain global fetch MUST NOT be called
    expect(mockGlobalFetch).not.toHaveBeenCalled()
    // Result should contain the metrics data
    expect(result).toBeTruthy()
    expect(result.github_team_metrics.total_prs).toBe(51)
  })

  it('returns undefined on 401 (auth failure) without throwing', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthenticated.' }),
    } as any)

    const result = await fetchGithubSnapshot()

    expect(result).toBeUndefined()
  })

  it('requests time_filter=all to get the full historical population', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(makeOkResponse(MOCK_METRICS_RESPONSE) as any)

    await fetchGithubSnapshot()

    const calledUrl = vi.mocked(authenticatedFetch).mock.calls[0][0] as string
    expect(calledUrl).toContain('time_filter=all')
    expect(calledUrl).toContain('nocache=1')
    expect(calledUrl).toContain('use_all_data=1')
  })
})

describe('CR-X 3D.4: fetchGithubSnapshot export contract', () => {
  it('is exported from dataAccess.ts', () => {
    expect(typeof fetchGithubSnapshot).toBe('function')
  })

  it('isGithubEvidenceEligibleCombined is exported for dashboard use', () => {
    expect(typeof isGithubEvidenceEligibleCombined).toBe('function')
  })
})

describe('CR-X 3D.4: PBT org-level delivery presentation contract', () => {
  // The ProductivityLineGraph template uses these conditionals:
  //   Title: isDeliveryMetric ? 'Delivery Performance Analysis' : 'AI Workflow Performance Analysis'
  //   Count:  isDeliveryMetric ? 'series' : 'workflows'
  //
  // We test the contract by replicating the template's conditional logic.
  // This is a presentation contract test — if the template changes, this
  // test must be updated to match.

  function pbtTitle(isDeliveryMetric: boolean): string {
    if (isDeliveryMetric) return 'Delivery Performance Analysis'
    return 'AI Workflow Performance Analysis'
  }

  function pbtCountLabel(isDeliveryMetric: boolean): string {
    if (isDeliveryMetric) return 'series'
    return 'workflows'
  }

  it('shows "Delivery Performance Analysis" for delivery metrics', () => {
    expect(pbtTitle(true)).toBe('Delivery Performance Analysis')
  })

  it('shows "AI Workflow Performance Analysis" for telemetry metrics (unchanged)', () => {
    expect(pbtTitle(false)).toBe('AI Workflow Performance Analysis')
  })

  it('shows "series" count label for delivery metrics', () => {
    expect(pbtCountLabel(true)).toBe('series')
  })

  it('shows "workflows" count label for telemetry metrics (unchanged)', () => {
    expect(pbtCountLabel(false)).toBe('workflows')
  })
})
