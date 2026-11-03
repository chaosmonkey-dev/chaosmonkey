/**
 * CR-X P2 Workflow-Comparison Family Verification
 *
 * For every expected workflow-comparison family, this test either:
 * 1. Fires it on an eligible fixture (calls the generator with synthetic data
 *    that should trigger the finding), OR
 * 2. Documents the exact intentional suppression/blocker.
 *
 * Families verified:
 * - workflow-mix (executive-workflow-mix-synthesis)
 * - workflow-temporal (recent-change)
 * - workflow-cross-comparison (active-coding-time-by-ide, repository-distribution-by-workflow)
 * - repo-concentration (repository-concentration)
 * - repo-cross-comparison (repo-conditioned-behavior)
 * - within-workflow (within-workflow-ai-effect, workflow-session-distribution)
 * - economics (allocated-spend-per-*)
 * - review-cycle (merge-cycle-time, merge-rate, pr-throughput, review-burden)
 * - review-quality (executive-small-pr-workflow-optimization)
 * - delivery-throughput (pr-throughput)
 * - deployment-reliability (change-failure-rate-spike-by-ide, deployment-success-distribution)
 * - release-reliability (release-cadence)
 * - diagnostic (claude-code-runtime-cohort)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateActiveCodingTimeByIDE, generateRepositoryConcentration, generateRepositoryDistributionByWorkflow, generateWithinWorkflowAIEffect, generateWorkflowSessionDistribution } from '../lib/insights/final/generators/planCode'
import { generateRecentChangeInsights } from '../lib/insights/final/generators/recentChange'
import { generateExecutiveTemporalSynthesis } from '../lib/insights/final/generators/executiveSynthesis'
import { generateMultiDimensionalInsights } from '../lib/insights/final/generators/multiDimensional'
import { generateClaudeCodeRuntimeCohort } from '../lib/insights/final/generators/earlySignal'
import { generateMergeCycleTime, generateMergeRate, generatePrThroughput, generateReviewBurden, generateExecutiveSmallPRWorkflowOptimization } from '../lib/insights/final/generators/reviewMerge'
import { generateChangeFailureRateSpikeByIDE, generateDeploymentSuccessDistribution, generateReleaseCadence } from '../lib/insights/final/generators/deployOperate'
import { generateAllocatedSpendPerMergedPR, generateAllocatedSpendPerDeployment, generateAllocatedSpendPerSuccessfulDeployment, generateAllocatedSpendPerFailedDeployment, generateAllocatedSpendPerReviewCycle, generateAllocatedSpendPerRelease } from '../lib/insights/final/generators/unitEconomics'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

// Ensure window/localStorage exists for vitest (Node by default)
if (typeof (globalThis as any).window === 'undefined') {
  ;(globalThis as any).window = { location: { search: '' } } as any
}
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store: Record<string, string> = {}
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
  } as any
}

// ── Session builder helpers ──────────────────────────────────────────────

function buildSession(opts: {
  tool: string
  timestamp: string
  duration_ms?: number
  active_coding_duration_ms?: number | null
  ai_burst_count?: number
  git_repo_url?: string
  session_commits?: number
  session_commits_source?: string
  time_to_first_commit_ms?: number
  ttfc_source?: string
  user_id?: string
  session_has_ai_activity?: boolean
}): Record<string, unknown> {
  const isDelegated = opts.tool === 'devin' || opts.tool === 'claude_code'
  const durMs = opts.duration_ms ?? 30 * 60000
  const row: Record<string, unknown> = {
    session_id: `sess-${opts.tool}-${opts.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    tool: opts.tool,
    session_source: opts.tool,
    timestamp: opts.timestamp,
    duration_ms: durMs,
    user_id: opts.user_id ?? 'dev-1',
    git_repo_url: opts.git_repo_url ?? 'https://github.com/org/repo1',
    git_branch: 'main',
    ai_burst_count: opts.ai_burst_count ?? 0,
    ai_usage_duration_ms: (opts.ai_burst_count ?? 0) * 120000,
    session_commits: opts.session_commits ?? 0,
    session_commits_source: opts.session_commits_source ?? 'observed',
    session_has_ai_activity: opts.session_has_ai_activity ?? (opts.ai_burst_count ?? 0) > 0,
  }
  if (opts.time_to_first_commit_ms !== undefined) {
    row.time_to_first_commit_ms = opts.time_to_first_commit_ms
    row.ttfc_source = opts.ttfc_source ?? 'observed'
  }
  if (isDelegated) {
    row.active_coding_duration_ms = undefined
    row.focus_ratio = undefined
  } else {
    row.active_coding_duration_ms = opts.active_coding_duration_ms ?? durMs * 0.5
  }
  if (typeof row.duration_ms === 'number' && row.duration_ms > 0) {
    row.session_duration_minutes = row.duration_ms / 60000
  }
  if (!isDelegated && typeof row.active_coding_duration_ms === 'number') {
    row.session_active_coding_duration_minutes = row.active_coding_duration_ms / 60000
  }
  return row
}

function daysAgoISO(days: number, hour = 11): string {
  const ref = new Date('2026-09-13T11:00:00.000Z').getTime()
  return new Date(ref - days * 86400000 + hour * 3600000).toISOString()
}

function buildInput(rows: Record<string, unknown>[], overrides: Partial<CanonicalInsightInput> = {}): CanonicalInsightInput {
  return {
    sessionRows: rows,
    githubByPeriod: [],
    prByPeriod: [],
    outcomesByMonth: [],
    githubSnapshot: {},
    productivityByPeriod: [],
    granularity: 'day',
    externalCostConfigs: readLocalCostConfigs(),
    ...overrides,
  } as unknown as CanonicalInsightInput
}

// ── GitHub snapshot helper (live provenance) ──────────────────────────────

function liveGithubSnapshot(overrides: any = {}): any {
  return {
    github_provenance: {
      source: 'github_api',
      historical_data_available: true,
      db_data_available: true,
      live_fetch_ok: true,
      db_pr_data_sources: ['github_api_sync'],
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
    pr_analytics: {
      total_prs: 40,
      pr_size_merge_cycle: {
        small_n: 20,
        large_n: 10,
        small_median_hours: 4,
        large_median_hours: 24,
        ratio: 6,
        merged_total: 30,
      },
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
  }
}

// ── Unit economics helpers ────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = 'chaosmonkey_tool_cost_config_'

function readLocalCostConfigs(): any[] {
  const configs: any[] = []
  for (const tool of ['cursor', 'devin', 'vscode', 'claude-code', 'github-copilot']) {
    const raw = (globalThis as any).localStorage.getItem(`${STORAGE_KEY_PREFIX}${tool}`)
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.monthlySpend === 'number') {
        configs.push({
          toolId: parsed.toolId || tool,
          monthlySpend: parsed.monthlySpend,
          seatCount: parsed.seatCount ?? 1,
          costPerSeatMonthly: parsed.costPerSeatMonthly ?? parsed.monthlySpend,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        })
      }
    } catch { /* ignore */ }
  }
  return configs
}

function setCostConfig(toolId: string, monthlySpend: number) {
  ;(globalThis as any).localStorage.setItem(
    `${STORAGE_KEY_PREFIX}${toolId}`,
    JSON.stringify({ toolId, seatCount: 1, costPerSeatMonthly: monthlySpend, monthlySpend, updatedAt: new Date().toISOString() }),
  )
}

function clearAllCostConfigs() {
  for (const tool of ['cursor', 'devin', 'vscode', 'claude-code', 'github-copilot']) {
    ;(globalThis as any).localStorage.removeItem(`${STORAGE_KEY_PREFIX}${tool}`)
  }
}

function mkOutcomesByMonth(entries: Array<{
  month: string
  merged_pr_count?: number
  total_pr_count?: number
  deployment_count?: number
  successful_deployment_count?: number
  failed_deployment_count?: number
  review_cycle_count?: number
  release_count?: number
  source?: string
  data_source?: string
  count_authority?: string
}>): any[] {
  return entries.map(e => ({
    month: e.month,
    merged_pr_count: e.merged_pr_count ?? 0,
    total_pr_count: e.total_pr_count ?? 0,
    deployment_count: e.deployment_count ?? 0,
    successful_deployment_count: e.successful_deployment_count ?? 0,
    failed_deployment_count: e.failed_deployment_count ?? 0,
    review_cycle_count: e.review_cycle_count ?? 0,
    release_count: e.release_count ?? 0,
    source: e.source ?? 'github_api_sync',
    data_source: e.data_source ?? 'live',
    count_authority: e.count_authority ?? 'observed_rows',
  }))
}

// Use a past month so it's "complete" (not the current month)
const PAST_MONTH = '2026-07'

// ============================================================================
// FAMILY 1: workflow-mix (executive-workflow-mix-synthesis)
// Gates: ≥5 sessions per window, ≥2 workflows with ≥10pp share change,
//        ≥3 sessions per workflow per window
// ============================================================================
describe('Family: workflow-mix (executive-workflow-mix-synthesis)', () => {
  it('FIRES when ≥2 workflows materially shift share across windows', () => {
    // 28 days. With 14-30 observed days, windows are 7d-vs-7d.
    // Days 14-27: extra history (old pattern). Days 7-13: prior window (old pattern).
    // Days 0-6: recent window (new pattern).
    const rows: any[] = []
    // Extra history (days 14-27): vscode 7/day, cursor 3/day
    for (let d = 14; d < 28; d++) {
      for (let i = 0; i < 7; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d, 9 + i) }))
      for (let i = 0; i < 3; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d, 14 + i) }))
    }
    // Prior window (days 7-13): vscode 7/day, cursor 3/day
    for (let d = 7; d < 14; d++) {
      for (let i = 0; i < 7; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d, 9 + i) }))
      for (let i = 0; i < 3; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d, 14 + i) }))
    }
    // Recent window (days 0-6): cursor 7/day, vscode 3/day (reversed)
    for (let d = 0; d < 7; d++) {
      for (let i = 0; i < 7; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d, 9 + i) }))
      for (let i = 0; i < 3; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d, 14 + i) }))
    }
    const out = generateExecutiveTemporalSynthesis(buildInput(rows))
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].id).toBe('executive-workflow-mix-synthesis')
    expect(out[0].title).toMatch(/workflow mix/i)
  })
})

// ============================================================================
// FAMILY 2: workflow-temporal (recent-change)
// Gates: ≥3 observed days, material change between windows, ≥5 sessions/window
// ============================================================================
describe('Family: workflow-temporal (recent-change)', () => {
  it('FIRES when active coding materially changes between windows', () => {
    const rows: any[] = []
    // Prior 14 days: 20 min active coding
    for (let d = 7; d < 21; d++) {
      for (let i = 0; i < 5; i++) {
        rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d, 9 + i), duration_ms: 45 * 60000, active_coding_duration_ms: 20 * 60000 }))
      }
    }
    // Recent 7 days: 50 min active coding (150% increase)
    for (let d = 0; d < 7; d++) {
      for (let i = 0; i < 5; i++) {
        rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d, 9 + i), duration_ms: 60 * 60000, active_coding_duration_ms: 50 * 60000 }))
      }
    }
    const out = generateRecentChangeInsights(buildInput(rows))
    expect(out.length).toBeGreaterThan(0)
    const acFinding = out.find(r => r.id.includes('active_coding'))
    expect(acFinding).toBeDefined()
  })
})

// ============================================================================
// FAMILY 3: workflow-cross-comparison (active-coding-time-by-ide, repository-distribution-by-workflow)
// ============================================================================
describe('Family: workflow-cross-comparison', () => {
  it('active-coding-time-by-ide FIRES with ≥2 workflows having active coding data', () => {
    const rows: any[] = []
    // 30 vscode sessions with 30 min active coding
    for (let i = 0; i < 30; i++) {
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), duration_ms: 45 * 60000, active_coding_duration_ms: 30 * 60000 }))
    }
    // 30 cursor sessions with 50 min active coding
    for (let i = 0; i < 30; i++) {
      rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(i % 28), duration_ms: 60 * 60000, active_coding_duration_ms: 50 * 60000 }))
    }
    const out = generateActiveCodingTimeByIDE(buildInput(rows))
    expect(out).not.toBeNull()
    expect(out!.id).toBe('active-coding-time-by-ide')
    expect(out!.hasData).toBe(true)
  })

  it('repository-distribution-by-workflow FIRES with material concentration gap', () => {
    const rows: any[] = []
    // Cursor: concentrated in repo-a (90%)
    for (let i = 0; i < 45; i++) {
      rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(i % 28), git_repo_url: 'https://github.com/org/repo-a' }))
    }
    for (let i = 0; i < 5; i++) {
      rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(i % 28), git_repo_url: 'https://github.com/org/repo-b' }))
    }
    // VS Code: spread across 5 repos (low concentration)
    for (let i = 0; i < 10; i++) {
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), git_repo_url: 'https://github.com/org/repo-a' }))
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), git_repo_url: 'https://github.com/org/repo-b' }))
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), git_repo_url: 'https://github.com/org/repo-c' }))
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), git_repo_url: 'https://github.com/org/repo-d' }))
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), git_repo_url: 'https://github.com/org/repo-e' }))
    }
    const out = generateRepositoryDistributionByWorkflow(buildInput(rows))
    expect(out).not.toBeNull()
    expect(out!.id).toBe('repository-distribution-by-workflow')
    expect(out!.hasData).toBe(true)
  })
})

// ============================================================================
// FAMILY 4: repo-concentration (repository-concentration)
// Gates: ≥10 sessions with git_repo_url
// ============================================================================
describe('Family: repo-concentration (repository-concentration)', () => {
  it('FIRES with ≥10 sessions having repo attribution', () => {
    const rows: any[] = []
    // 30 sessions across 3 repos, with repo-a dominant
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), git_repo_url: 'https://github.com/org/repo-a' }))
    }
    for (let i = 0; i < 5; i++) {
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), git_repo_url: 'https://github.com/org/repo-b' }))
    }
    for (let i = 0; i < 5; i++) {
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), git_repo_url: 'https://github.com/org/repo-c' }))
    }
    const out = generateRepositoryConcentration(buildInput(rows))
    expect(out).not.toBeNull()
    expect(out!.id).toBe('repository-concentration')
    expect(out!.hasData).toBe(true)
  })
})

// ============================================================================
// FAMILY 5: repo-cross-comparison (repo-conditioned-behavior)
// Gates: same workflow with ≥2 repos, ≥20 sessions per repo, material difference
// ============================================================================
describe('Family: repo-cross-comparison (repo-conditioned-behavior)', () => {
  it('FIRES when same workflow behaves materially differently across repos', () => {
    const rows: any[] = []
    // Cursor in repo-a: 20 sessions, 60 min active coding
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(i % 28), active_coding_duration_ms: 60 * 60000, git_repo_url: 'https://github.com/org/repo-a' }))
    }
    // Cursor in repo-b: 20 sessions, 15 min active coding (4x difference)
    for (let i = 0; i < 20; i++) {
      rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(i % 28), active_coding_duration_ms: 15 * 60000, git_repo_url: 'https://github.com/org/repo-b' }))
    }
    const out = generateMultiDimensionalInsights(buildInput(rows))
    const rcb = out.filter(f => f.id.startsWith('repo-conditioned-behavior__'))
    expect(rcb.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// FAMILY 6: within-workflow (within-workflow-ai-effect, workflow-session-distribution)
// ============================================================================
describe('Family: within-workflow', () => {
  it('within-workflow-ai-effect FIRES with ≥10 AI and ≥10 non-AI sessions', () => {
    const rows: any[] = []
    // 15 AI-active vscode sessions with 40 min active coding
    for (let i = 0; i < 15; i++) {
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), duration_ms: 60 * 60000, active_coding_duration_ms: 40 * 60000, ai_burst_count: 3, session_has_ai_activity: true }))
    }
    // 15 non-AI vscode sessions with 20 min active coding
    for (let i = 0; i < 15; i++) {
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), duration_ms: 45 * 60000, active_coding_duration_ms: 20 * 60000, ai_burst_count: 0, session_has_ai_activity: false }))
    }
    const out = generateWithinWorkflowAIEffect(buildInput(rows))
    expect(out).not.toBeNull()
    expect(out!.length).toBeGreaterThan(0)
    const finding = out!.find(f => f.id.startsWith('within-workflow-ai-effect__'))
    expect(finding).toBeDefined()
    expect(finding!.hasData).toBe(true)
  })

  it('workflow-session-distribution FIRES with ≥50 sessions and p90/p50 > 5x', () => {
    const rows: any[] = []
    // 50 sessions with highly skewed distribution: 44 short (10 min), 6 long (300 min)
    // p50 at index 24.5 = 10, p90 at index 44.1 = 300 → p90/p50 = 30x
    for (let i = 0; i < 44; i++) {
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), duration_ms: 10 * 60000 }))
    }
    for (let i = 0; i < 6; i++) {
      rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(i % 28), duration_ms: 300 * 60000 }))
    }
    const out = generateWorkflowSessionDistribution(buildInput(rows))
    expect(out).not.toBeNull()
    expect(out!.length).toBeGreaterThan(0)
    const finding = out!.find(f => f.id.startsWith('workflow-session-distribution__'))
    expect(finding).toBeDefined()
    expect(finding!.hasData).toBe(true)
  })
})

// ============================================================================
// FAMILY 7: economics (allocated-spend-per-*)
// Gates: cost config + GitHub evidence + outcomes_by_month with observed_rows
// ============================================================================
describe('Family: economics (allocated-spend-per-*)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'))
    clearAllCostConfigs()
    setCostConfig('cursor', 500)
  })

  afterEach(() => {
    vi.useRealTimers()
    clearAllCostConfigs()
  })

  it('allocated-spend-per-merged-pr FIRES with cost config + outcomes', () => {
    const gh = liveGithubSnapshot()
    const obm = mkOutcomesByMonth([{ month: PAST_MONTH, merged_pr_count: 40, total_pr_count: 50 }])
    const input = buildInput([], { githubSnapshot: gh, outcomesByMonth: obm, granularity: 'month' })
    const out = generateAllocatedSpendPerMergedPR(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('allocated-spend-per-merged-pr')
    expect(out!.hasData).toBe(true)
  })

  it('allocated-spend-per-deployment FIRES with cost config + outcomes', () => {
    const gh = liveGithubSnapshot()
    const obm = mkOutcomesByMonth([{ month: PAST_MONTH, deployment_count: 100, successful_deployment_count: 92, failed_deployment_count: 8 }])
    const input = buildInput([], { githubSnapshot: gh, outcomesByMonth: obm, granularity: 'month' })
    const out = generateAllocatedSpendPerDeployment(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('allocated-spend-per-deployment')
    expect(out!.hasData).toBe(true)
  })

  it('allocated-spend-per-successful-deployment FIRES', () => {
    const gh = liveGithubSnapshot()
    const obm = mkOutcomesByMonth([{ month: PAST_MONTH, deployment_count: 100, successful_deployment_count: 92, failed_deployment_count: 8 }])
    const input = buildInput([], { githubSnapshot: gh, outcomesByMonth: obm, granularity: 'month' })
    const out = generateAllocatedSpendPerSuccessfulDeployment(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('allocated-spend-per-successful-deployment')
  })

  it('allocated-spend-per-failed-deployment FIRES', () => {
    const gh = liveGithubSnapshot()
    const obm = mkOutcomesByMonth([{ month: PAST_MONTH, deployment_count: 100, successful_deployment_count: 92, failed_deployment_count: 8 }])
    const input = buildInput([], { githubSnapshot: gh, outcomesByMonth: obm, granularity: 'month' })
    const out = generateAllocatedSpendPerFailedDeployment(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('allocated-spend-per-failed-deployment')
  })

  it('allocated-spend-per-review-cycle FIRES', () => {
    const gh = liveGithubSnapshot()
    const obm = mkOutcomesByMonth([{ month: PAST_MONTH, review_cycle_count: 120, merged_pr_count: 40 }])
    const input = buildInput([], { githubSnapshot: gh, outcomesByMonth: obm, granularity: 'month' })
    const out = generateAllocatedSpendPerReviewCycle(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('allocated-spend-per-review-cycle')
  })

  it('allocated-spend-per-release FIRES', () => {
    const gh = liveGithubSnapshot()
    const obm = mkOutcomesByMonth([{ month: PAST_MONTH, release_count: 8 }])
    const input = buildInput([], { githubSnapshot: gh, outcomesByMonth: obm, granularity: 'month' })
    const out = generateAllocatedSpendPerRelease(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('allocated-spend-per-release')
  })
})

// ============================================================================
// FAMILY 8: review-cycle (merge-cycle-time, merge-rate, pr-throughput, review-burden)
// Gates: live GitHub evidence with team metrics
// ============================================================================
describe('Family: review-cycle', () => {
  it('merge-cycle-time FIRES with live team metrics', () => {
    const input = buildInput([], { githubSnapshot: liveGithubSnapshot() })
    const out = generateMergeCycleTime(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('merge-cycle-time')
    expect(out!.hasData).toBe(true)
  })

  it('merge-rate FIRES with live team metrics', () => {
    const input = buildInput([], { githubSnapshot: liveGithubSnapshot() })
    const out = generateMergeRate(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('merge-rate')
    expect(out!.hasData).toBe(true)
  })

  it('pr-throughput FIRES with live team metrics', () => {
    const input = buildInput([], { githubSnapshot: liveGithubSnapshot() })
    const out = generatePrThroughput(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('pr-throughput')
    expect(out!.hasData).toBe(true)
  })

  it('review-burden FIRES with live review metrics', () => {
    const input = buildInput([], { githubSnapshot: liveGithubSnapshot() })
    const out = generateReviewBurden(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('review-burden')
    expect(out!.hasData).toBe(true)
  })
})

// ============================================================================
// FAMILY 9: review-quality (executive-small-pr-workflow-optimization)
// Gates: live GitHub evidence with pr_analytics.pr_size_merge_cycle
// ============================================================================
describe('Family: review-quality (executive-small-pr-workflow-optimization)', () => {
  it('FIRES with live pr_size_merge_cycle data', () => {
    const input = buildInput([], { githubSnapshot: liveGithubSnapshot() })
    const out = generateExecutiveSmallPRWorkflowOptimization(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('executive-small-pr-workflow-optimization')
    expect(out!.hasData).toBe(true)
  })
})

// ============================================================================
// FAMILY 10: delivery-throughput (pr-throughput)
// Same generator as review-cycle — verified above, documented here for completeness
// ============================================================================
describe('Family: delivery-throughput (pr-throughput)', () => {
  it('FIRES (same generator as review-cycle pr-throughput)', () => {
    const input = buildInput([], { githubSnapshot: liveGithubSnapshot() })
    const out = generatePrThroughput(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('pr-throughput')
  })
})

// ============================================================================
// FAMILY 11: deployment-reliability (change-failure-rate-spike-by-ide, deployment-success-distribution)
// Gates: live GitHub evidence with deployment_metrics
// ============================================================================
describe('Family: deployment-reliability', () => {
  it('change-failure-rate-spike-by-ide FIRES with live deployment_reliability', () => {
    const input = buildInput([], { githubSnapshot: liveGithubSnapshot() })
    const out = generateChangeFailureRateSpikeByIDE(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('change-failure-rate-spike-by-ide')
    expect(out!.hasData).toBe(true)
  })

  it('deployment-success-distribution FIRES with live deployment metrics', () => {
    const input = buildInput([], { githubSnapshot: liveGithubSnapshot() })
    const out = generateDeploymentSuccessDistribution(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('deployment-success-distribution')
    expect(out!.hasData).toBe(true)
  })
})

// ============================================================================
// FAMILY 12: release-reliability (release-cadence)
// Gates: live GitHub evidence with release_metrics
// ============================================================================
describe('Family: release-reliability (release-cadence)', () => {
  it('FIRES with live release metrics', () => {
    const input = buildInput([], { githubSnapshot: liveGithubSnapshot() })
    const out = generateReleaseCadence(input)
    expect(out).not.toBeNull()
    expect(out!.id).toBe('release-cadence')
    expect(out!.hasData).toBe(true)
  })
})

// ============================================================================
// FAMILY 13: diagnostic (claude-code-runtime-cohort)
// Gates: ≥5 Claude Code sessions
// ============================================================================
describe('Family: diagnostic (claude-code-runtime-cohort)', () => {
  it('FIRES with ≥5 Claude Code sessions', () => {
    const sessions = [
      buildSession({ tool: 'claude_code', timestamp: daysAgoISO(0), duration_ms: 10 * 60000, ai_burst_count: 0 }),
      buildSession({ tool: 'claude_code', timestamp: daysAgoISO(1), duration_ms: 15 * 60000, ai_burst_count: 2 }),
      buildSession({ tool: 'claude_code', timestamp: daysAgoISO(2), duration_ms: 90 * 60000, ai_burst_count: 8 }),
      buildSession({ tool: 'claude_code', timestamp: daysAgoISO(3), duration_ms: 120 * 60000, ai_burst_count: 20 }),
      buildSession({ tool: 'claude_code', timestamp: daysAgoISO(4), duration_ms: 12 * 60000, ai_burst_count: 1 }),
    ]
    const out = generateClaudeCodeRuntimeCohort(buildInput(sessions))
    expect(out).not.toBeNull()
    expect(out!.id).toBe('claude-code-runtime-cohort')
    expect(out!.n).toBe(5)
    expect(out!.hasData).toBe(true)
  })
})
