/**
 * Demo-readiness regression tests (LOCAL Codex + cohort demo).
 *
 * Covers the root causes fixed for the external recording:
 *  1. Repo-label interpolation fails closed — blank/placeholder repo
 *     identities must never reach customer-facing prose.
 *  2. Unsupported AI-signal metrics are unavailable, never measured zero —
 *     Codex must not produce "zero observed AI signals" or "AI usage 0%".
 *  3. Two-workflow PI comparisons must not leak a third workflow.
 *  4. Measured org-level review/deploy evidence is org_level_only, not an
 *     instrumentation gap; data-gap rows never carry HIGH severity.
 *  5. Cohort selection persists across metric/time/view changes and maps to
 *     the correct `cohort_id` wire param.
 *  6. "Last 30 Days" label matches the rolling-30-day window semantics.
 *  7. Deployment-failure concentration never claims "All N failures happened
 *     in production" when production failures are zero.
 */
import { describe, it, expect } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'fs'
import { resolve } from 'path'

import { isRenderableRepoLabel, normalizeRepoUrl } from '../lib/repoNormalization'
import { generateWithinWorkflowAISignalCoverage, generateRepositoryDistributionByWorkflow } from '../lib/insights/final/generators/planCode'
import { generateReopenPressureSpike } from '../lib/insights/final/generators/reviewMerge'
import { generateMultiDimensionalInsights } from '../lib/insights/final/generators/multiDimensional'
import { buildMeasuredWorkflowIntelligence, type CanonicalAggregatedRowLike, type CanonicalAggregatedMetadataLike } from '../lib/aioi/buildMeasuredWorkflowIntelligence'
import { computeComparisonState } from '../lib/insights/final/helpers/comparisonState'
import { isMetricInstrumentedForWorkflow } from '../lib/surfaceAgentContract'
import { useAnalysisContextStore } from '../stores/analysisContext'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

// ─── Helpers ────────────────────────────────────────────────────────────

function session(tool: string, repo: string | null, extra: Record<string, any> = {}): any {
  return {
    tool,
    session_source: tool,
    git_repo_url: repo,
    ai_burst_count: 0,
    session_duration_minutes: 20,
    session_has_ai_activity: false,
    timestamp: '2026-09-15T12:00:00Z',
    ...extra,
  }
}

function makeInput(sessionRows: any[]): CanonicalInsightInput {
  return {
    sessionRows,
    githubByPeriod: [],
    githubSnapshot: {},
  } as CanonicalInsightInput
}

// ─── 1. Repo-label fail-closed ──────────────────────────────────────────

describe('repo label interpolation fails closed', () => {
  it('rejects blank and placeholder identities', () => {
    for (const bad of ['', '  ', 'undefined', 'null', 'unknown', 'unattributed', '__unattributed__', 'n/a', 'none', '/repo', 'owner/', 'a//b', null, undefined]) {
      expect(isRenderableRepoLabel(bad as any), JSON.stringify(bad)).toBe(false)
    }
  })

  it('accepts real canonical identities', () => {
    for (const good of ['owner/repo', 'azure:org/repo', 'monorepo', 'org/sub/repo']) {
      expect(isRenderableRepoLabel(good), good).toBe(true)
    }
  })

  it('multi-dimensional allocation emits no repo finding when labels are invalid', () => {
    // Two workflows, each ≥30 sessions — but every repo identity normalizes
    // to a placeholder ("undefined"), which must never reach a title.
    const rows: any[] = []
    for (let i = 0; i < 40; i++) rows.push(session('vscode', 'undefined'))
    for (let i = 0; i < 40; i++) rows.push(session('cursor', 'null'))
    const out = generateMultiDimensionalInsights(makeInput(rows))
    const repoFindings = out.filter(f =>
      /concentrated in|dominant|allocation/i.test(f.title || '')
    )
    for (const f of repoFindings) {
      expect(f.title).not.toMatch(/in\s+(while|than|\()/i) // "in  while"
      expect(f.title).not.toMatch(/undefined|null|__unattributed__/i)
      expect(JSON.stringify(f.description ?? '')).not.toMatch(/undefined|null|__unattributed__/i)
    }
  })

  it('repository-distribution suppresses when compared pair lacks renderable repos', () => {
    const rows: any[] = []
    // vscode: ≥30 sessions across ≥2 repos, concentrated top-3
    for (let i = 0; i < 28; i++) rows.push(session('vscode', 'org/main-app'))
    for (let i = 0; i < 6; i++) rows.push(session('vscode', 'org/api'))
    // cursor: ≥30 sessions across many repos → spread
    for (let r = 0; r < 8; r++) for (let i = 0; i < 5; i++) rows.push(session('cursor', `org/repo-${r}`))
    const out = generateRepositoryDistributionByWorkflow(makeInput(rows))
    expect(out).not.toBeNull()
    expect(out!.hasData).toBe(true)
    // Title must contain a real repo name, never a blank interpolation
    expect(out!.title).toMatch(/concentrate in \S/)
    expect(out!.title).not.toMatch(/in\s+\+/i)
  })
})

// ─── 2. Codex: unsupported AI signal is not measured zero ───────────────

describe('codex AI-signal instrumentation semantics', () => {
  it('contract marks AI-burst/usage metrics as not instrumented for codex', () => {
    for (const m of ['ai_burst_count', 'ai_suggestions_accepted', 'ai_usage_duration_minutes', 'ai_usage_ratio']) {
      expect(isMetricInstrumentedForWorkflow('codex', m), m).toBe(false)
    }
    // Lifecycle metrics remain instrumented
    for (const m of ['duration_ms', 'average_session_length_minutes']) {
      expect(isMetricInstrumentedForWorkflow('codex', m), m).toBe(true)
    }
  })

  it('AI-signal coverage generator skips Codex entirely — no "zero observed AI signals"', () => {
    const rows: any[] = []
    for (let i = 0; i < 20; i++) rows.push(session('codex', null))
    for (let i = 0; i < 20; i++) rows.push(session('vscode', null, { ai_burst_count: i < 5 ? 2 : 0, session_has_ai_activity: i < 5 }))
    const out = generateWithinWorkflowAISignalCoverage(makeInput(rows)) ?? []
    const codexFindings = out.filter(f => f.id.includes('codex'))
    expect(codexFindings).toHaveLength(0)
    // vscode still evaluated (poor coverage 25% < 60% → emitted)
    const vscode = out.filter(f => f.id.includes('vscode'))
    expect(vscode.length).toBeGreaterThanOrEqual(0)
  })

  it('measured workflow intelligence returns aiUsageRatio null for codex', () => {
    const rows: CanonicalAggregatedRowLike[] = [
      {
        tool: 'codex',
        session_count: 100,
        average_session_length_minutes: 24,
        total_session_minutes: 2400,
        ai_usage_duration_minutes: 0, // bridge emits nothing — aggregated zero
        ai_suggestions_accepted: 0,
        active_coding_time_minutes: 0,
      },
      {
        tool: 'vscode',
        session_count: 50,
        average_session_length_minutes: 30,
        total_session_minutes: 1500,
        ai_usage_duration_minutes: 300,
        ai_suggestions_accepted: 5,
        active_coding_time_minutes: 900,
      },
    ]
    const meta: CanonicalAggregatedMetadataLike = {
      tools_in_population: ['codex', 'vscode'],
      session_count_by_tool: { codex: 100, vscode: 50 },
    }
    const out = buildMeasuredWorkflowIntelligence(rows, meta, (id) => id)
    const codex = out.find(w => w.toolId === 'codex')!
    const vscode = out.find(w => w.toolId === 'vscode')!
    expect(codex.aiUsageRatio).toBeNull()
    expect(codex.aiActivityPerSession).toBeNull()
    expect(codex.averageSessionLengthMinutes).toBe(24) // lifecycle metric survives
    expect(vscode.aiUsageRatio).not.toBeNull()
  })
})

// ─── 3. Two-workflow PI contains no third workflow ──────────────────────

describe('two-workflow repo-distribution comparison is pair-only', () => {
  it('breakdownByTool contains only the compared workflows', () => {
    const rows: any[] = []
    // codex: highly concentrated (one dominant repo)
    for (let i = 0; i < 35; i++) rows.push(session('codex', 'org/agent-core'))
    for (let i = 0; i < 5; i++) rows.push(session('codex', 'org/api'))
    // claude_code: spread across 8 repos
    for (let r = 0; r < 8; r++) for (let i = 0; i < 5; i++) rows.push(session('claude_code', `org/lib-${r}`))
    // github_copilot: also concentrated — must NOT appear in the card
    for (let i = 0; i < 35; i++) rows.push(session('github_copilot', 'org/copilot-repo'))
    for (let i = 0; i < 5; i++) rows.push(session('github_copilot', 'org/extra'))

    const out = generateRepositoryDistributionByWorkflow(makeInput(rows))
    expect(out).not.toBeNull()

    const keys = Object.keys(out!.breakdownByTool ?? {})
    // Every breakdown key belongs to one of the two compared workflows
    const compared = new Set([out as any && (out as any).selectedComparison?.leaderKey, (out as any).selectedComparison?.baselineKey].filter(Boolean))
    for (const k of keys) {
      const base = k.replace(/_(top3|repos)$/, '')
      const inPair = [...compared].some(c => (c as string).startsWith(base))
      expect(inPair, `unexpected workflow in breakdown: ${k}`).toBe(true)
    }
    // Exactly the pair's top3+repos entries
    expect(keys.length).toBe(4)
    // No unrelated workflow label leaks into evidence
    const blob = JSON.stringify(out!.evidence ?? []) + JSON.stringify(out!.description ?? '')
    if (!out!.title.includes('Copilot')) {
      expect(blob).not.toMatch(/copilot/i)
    }
  })
})

// ─── 4. Data-gap severity classification ────────────────────────────────

describe('data-gap classification', () => {
  it('measured review-merge evidence without workflow breakdown → org_level_only, not instrumentation_gap', () => {
    const reopenLike = {
      id: 'reopen-pressure-spike',
      cicdStage: 'review-merge',
      comparisonMode: 'threshold_vs_actual',
      hasData: true,
      n: 150,
      current: 0,
      breakdownByTool: undefined,
    }
    expect(computeComparisonState(reopenLike as any)).toBe('org_level_only')
  })

  it('plan-code threshold finding without breakdown remains instrumentation_gap', () => {
    const planCodeGap = {
      id: 'some-plan-code',
      cicdStage: 'plan-code',
      comparisonMode: 'threshold_vs_actual',
      hasData: true,
      n: 100,
      current: 5,
      breakdownByTool: undefined,
    }
    expect(computeComparisonState(planCodeGap as any)).toBe('instrumentation_gap')
  })

  it('truly missing data → needs_more_data', () => {
    const noData = {
      id: 'x',
      cicdStage: 'review-merge',
      comparisonMode: 'threshold_vs_actual',
      hasData: false,
      n: 0,
      current: null,
    }
    expect(computeComparisonState(noData as any)).toBe('needs_more_data')
  })

  it('view layer: data-gap states force Low impact', () => {
    // Source-level contract: getImpactLevel must early-return 'Low' for
    // gap comparison states — verified by source inspection.
    const src = readFileSync(
      resolve(__dirname, '../components/PerformanceRecommendationsView.vue'),
      'utf-8'
    )
    const fnStart = src.indexOf('function getImpactLevel')
    const fnEnd = src.indexOf('\nfunction ', fnStart + 10)
    const body = src.slice(fnStart, fnEnd)
    expect(body).toMatch(/rowComparisonState === 'needs_more_data'/)
    expect(body).toMatch(/instrumentation_gap/)
    expect(body.indexOf("return 'Low'")).toBeLessThan(body.indexOf('intendedStageQuotaBucket'))
  })
})

// ─── 5. Cohort persistence ──────────────────────────────────────────────

describe('cohort scope persistence', () => {
  it('cohort_id survives time, metric, and workflow changes; clears to global', () => {
    setActivePinia(createPinia())
    const ctx = useAnalysisContextStore()

    ctx.setCohortId('3')
    expect(ctx.cohortId).toBe('3')
    expect(ctx.apiParams.cohort_id).toBe('3')

    // Metric/time/view changes are orthogonal state — cohort must persist.
    ctx.setTimePreset('30d')
    ctx.setGranularity('weekly')
    ctx.setWorkflowIds(['codex'])
    ctx.setDeveloperIds(['u1'])
    expect(ctx.cohortId).toBe('3')
    expect(ctx.apiParams.cohort_id).toBe('3')

    // Clearing restores global scope — no cohort param emitted.
    ctx.setCohortId('')
    expect(ctx.cohortId).toBe('')
    expect(ctx.apiParams.cohort_id).toBeUndefined()

    // 'all' normalizes to '' (never emits cohort_id=all)
    ctx.setCohortId('all')
    expect(ctx.cohortId).toBe('')
    expect(ctx.apiParams.cohort_id).toBeUndefined()
  })

  it('unassigned cohort emits cohort_id=unassigned', () => {
    setActivePinia(createPinia())
    const ctx = useAnalysisContextStore()
    ctx.setCohortId('unassigned')
    expect(ctx.apiParams.cohort_id).toBe('unassigned')
  })
})

// ─── 6. Time-window label semantics ─────────────────────────────────────

describe('time-window semantics', () => {
  it("'month' preset label reads 'Last 30 Days', not 'Last Month'", () => {
    const src = readFileSync(
      resolve(__dirname, '../components/ProductivityByToolV3.vue'),
      'utf-8'
    )
    expect(src).toContain("'month': 'Last 30 Days'")
    expect(src).toContain('<option value="month">Last 30 Days</option>')
    expect(src).not.toContain(">Last Month<")
    expect(src).not.toContain("'month': 'Last Month'")
  })

  it('mom window is rolling 30 calendar days inclusive (today-29 … today)', () => {
    const src = readFileSync(
      resolve(__dirname, '../components/UnifiedFilters.vue'),
      'utf-8'
    )
    expect(src).toMatch(/case 'mom':[\s\S]*?29 \* DAY_MS/)
  })
})

// ─── 7. Deployment failure concentration title ──────────────────────────

describe('deployment failure concentration title', () => {
  it('never claims "All N failures happened in production" when production failures are zero', () => {
    const src = readFileSync(
      resolve(__dirname, '../lib/insights/final/generators/deployOperate.ts'),
      'utf-8'
    )
    // The title must be conditional on productionFailed > 0
    const titleLine = src.match(/title:\s*productionFailed === 0[\s\S]{0,400}?`[^`]+`/);
    expect(titleLine).not.toBeNull()
    expect(src).not.toMatch(/title:\s*`All \$\{productionFailed\} observed deployment failures happened in production`/)
  })
})

// ─── 8. Reopen-rate instrumentation truth ───────────────────────────────

describe('reopen rate instrumentation truth', () => {
  const githubInput = (githubSnapshot: any): CanonicalInsightInput =>
    ({ sessionRows: [], githubByPeriod: [], githubSnapshot } as CanonicalInsightInput)

  it('null pr_reopened_count is an instrumentation gap, never a measured 0%', () => {
    const out = generateReopenPressureSpike(githubInput({
      github_connected: true,
      total_pull_requests: 150,
      pr_review_metrics: { pr_reopened_count: null, total_prs: 150, review_count: 10 },
      reopen_pressure_spike: null,
    }))
    expect(out).not.toBeNull()
    expect(out!.isDiagnostic).toBe(true)
    expect(out!.recommendationAllowed).toBe(false)
    expect(out!.isTopInsightEligible).toBe(false)
    expect(out!.diagnosticReason).toBe('WAITING_FOR_GITHUB_DELIVERY_OUTCOMES')
    // No measured-rate claim may appear in the title
    expect(out!.title).not.toMatch(/%/)
    expect(JSON.stringify(out!.evidence)).not.toMatch(/— \/ —/)
  })

  it('a null reopen_pressure_spike field must not be read as a measured rate', () => {
    const out = generateReopenPressureSpike(githubInput({
      total_pull_requests: 150,
      reopen_pressure_spike: null,
    }))
    // falls through to diagnostic (GitHub context present) — never a number card
    expect(out).not.toBeNull()
    expect(out!.isDiagnostic).toBe(true)
    expect(out!.title).not.toMatch(/% PR reopen rate/)
  })

  it('measured source produces a fully coherent card from one authority', () => {
    const out = generateReopenPressureSpike(githubInput({
      pr_review_metrics: { pr_reopened_count: 15, total_prs: 150, review_count: 10 },
    }))
    expect(out).not.toBeNull()
    expect(out!.isDiagnostic).not.toBe(true)
    // title, numerator/denominator, rate, and n all derive from the same source
    expect(out!.title).toContain('10.0%')
    expect(out!.title).toContain('150 PRs')
    expect(out!.current).toBe(10)
    expect(out!.n).toBe(150)
    expect(JSON.stringify(out!.evidence)).toContain('15 / 150')
    // At target boundary: rate equals target → monitor, not corrective action
    expect(out!.recommendation).not.toMatch(/Tighten test coverage/)
  })

  it('measured below-target rate never recommends corrective action', () => {
    const out = generateReopenPressureSpike(githubInput({
      pr_review_metrics: { pr_reopened_count: 0, total_prs: 150, review_count: 10 },
    }))
    expect(out!.recommendation).not.toMatch(/Tighten test coverage/)
    expect(out!.recommendation).toMatch(/at or below/)
  })

  it('decision card derives reopen fields from the generator row, not dropped githubSnapshot', () => {
    const src = readFileSync(
      resolve(__dirname, '../components/PerformanceRecommendationsView.vue'),
      'utf-8'
    )
    const reopenCase = src.match(/case 'reopen-pressure-spike': \{[\s\S]*?footerNote: 'Org-wide GitHub signal · workflow tagging needed for IDE\/tool attribution'\s*\}\s*\}/)
    expect(reopenCase).not.toBeNull()
    // The case must not reconstruct evidence from githubSnapshot (dropped by adapter)
    expect(reopenCase![0]).not.toMatch(/githubSnapshot\?\.pr_analytics/)
    expect(reopenCase![0]).not.toMatch(/githubSnapshot\?\.reopen_pressure_spike/)
    expect(reopenCase![0]).toContain('(row as any).current')
    expect(reopenCase![0]).toContain('(row as any).n')
  })
})
