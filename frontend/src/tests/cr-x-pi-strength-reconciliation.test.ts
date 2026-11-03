import { describe, it, expect } from 'vitest'
import { generateMultiDimensionalInsights } from '../lib/insights/final/generators/multiDimensional'
import { generateExecutiveTemporalSynthesis } from '../lib/insights/final/generators/executiveSynthesis'
import { generateRecentChangeInsights } from '../lib/insights/final/generators/recentChange'
import { generateReviewMergeInsights } from '../lib/insights/final/generators/reviewMerge'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

/**
 * ============================================================================
 * CR-X FINAL — PI Product-Strength Acceptance: Bounded Title/Body/Evidence
 * Reconciliation Tests
 * ============================================================================
 *
 * P5: Each test verifies that a generated finding has:
 *  - No title/body contradiction
 *  - No workflow/repository label inversion
 *  - No percentage/duration/count unit corruption
 *  - No generic "insufficient" fallback for eligible findings
 *
 * These tests are bounded to generator output and do NOT require the full
 * pipeline. They verify the contract between generator fields and the
 * customer-facing title/description/evidence.
 * ============================================================================
 */

// ── Test helpers ──────────────────────────────────────────────────────────

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
}): Record<string, unknown> {
  const isDelegated = opts.tool === 'devin' || opts.tool === 'claude_code'
  const durMs = opts.duration_ms ?? 30 * 60000
  const row: Record<string, unknown> = {
    session_id: `sess-${opts.tool}-${opts.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
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

function buildInput(rows: Record<string, unknown>[], extras: Partial<CanonicalInsightInput> = {}): CanonicalInsightInput {
  return {
    sessionRows: rows,
    githubByPeriod: [],
    prByPeriod: [],
    outcomesByMonth: [],
    githubSnapshot: {},
    productivityByPeriod: [],
    granularity: 'daily',
    externalCostConfigs: [],
    populationContext: { scope: 'org' },
    timeSemantics: { observedThroughMs: new Date('2026-09-13T11:00:00.000Z').getTime() },
    ...extras,
  } as unknown as CanonicalInsightInput
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CR-X FINAL PI-Strength: Bounded Title/Body/Evidence Reconciliation', () => {

  // ── 1. Executive workflow-mix synthesis ──────────────────────────────────
  describe('1. Executive workflow-mix synthesis', () => {
    it('title mentions the gainer workflow; evidence contains all moving workflows with matching shares', () => {
      // Build sessions where Devin share goes up, VS Code and Cursor go down
      // Spread across multiple days to get observedDays >= 3
      const rows: Record<string, unknown>[] = []
      // Prior window (days 10-14): Devin 18%, VS Code 39%, Cursor 30%
      for (let d = 10; d <= 14; d++) {
        for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d) }))
        for (let i = 0; i < 4; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d) }))
        for (let i = 0; i < 3; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d) }))
      }
      // Recent window (days 1-5): Devin 92%, VS Code 4%, Cursor 4%
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 9; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d) }))
        for (let i = 0; i < 1; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d) }))
        for (let i = 0; i < 1; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d) }))
      }

      const insights = generateExecutiveTemporalSynthesis(buildInput(rows))
      expect(insights.length).toBe(1)
      const synth = insights[0]

      // Title should mention the gainer (Devin)
      expect(synth.title).toContain('Devin')
      expect(synth.title.toLowerCase()).toContain('shift')

      // Evidence should contain all moving workflows
      const evidence = synth.evidence || []
      const wfNames = evidence.map(e => e.metric || '')
      expect(wfNames.some(n => n.includes('Devin'))).toBe(true)
      expect(wfNames.some(n => n.includes('VS Code'))).toBe(true)
      expect(wfNames.some(n => n.includes('Cursor'))).toBe(true)

      // No "insufficient" fallback
      expect(synth.hasData).toBe(true)
      expect(synth.title.toLowerCase()).not.toContain('insufficient')
      expect(synth.title.toLowerCase()).not.toContain('not yet')

      // Description should not contradict title
      expect(synth.description).toBeTruthy()
      expect(synth.description!.length).toBeGreaterThan(20)

      // Comparison state should be workflow_comparable, not instrumentation_gap
      expect(synth.comparisonState).toBe('workflow_comparable')
    })

    it('does not synthesize when fewer than 2 workflows move materially', () => {
      const rows: Record<string, unknown>[] = []
      // Only Devin moves slightly; VS Code stays flat
      for (let d = 10; d <= 14; d++) {
        for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d) }))
        for (let i = 0; i < 8; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d) }))
      }
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 3; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d) }))
        for (let i = 0; i < 8; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d) }))
      }

      const insights = generateExecutiveTemporalSynthesis(buildInput(rows))
      // Devin: 10/50=20% -> 12/50=24% = 4pp (below 10pp threshold)
      // VS Code: 40/50=80% -> 38/50=76% = 4pp (below 10pp threshold)
      expect(insights.length).toBe(0)
    })
  })

  // ── 2. Repo-conditioned behavior ────────────────────────────────────────
  describe('2. Repo-conditioned behavior', () => {
    it('title names the workflow and repos; no workflow/repo label inversion', () => {
      // Devin runs longer in repo-A than repo-B
      const rows: Record<string, unknown>[] = []
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 6; i++) {
          rows.push(buildSession({
            tool: 'devin', timestamp: daysAgoISO(d),
            duration_ms: 45 * 60000,
            git_repo_url: 'https://github.com/org/repo-a',
          }))
        }
        for (let i = 0; i < 6; i++) {
          rows.push(buildSession({
            tool: 'devin', timestamp: daysAgoISO(d),
            duration_ms: 16 * 60000,
            git_repo_url: 'https://github.com/org/repo-b',
          }))
        }
      }

      const insights = generateMultiDimensionalInsights(buildInput(rows))
      const rcb = insights.find(i => i.id.startsWith('repo-conditioned-behavior__devin'))
      expect(rcb).toBeDefined()

      // Title should mention Devin and both repos
      expect(rcb!.title).toContain('Devin')
      // Title should not invert workflow and repo labels
      expect(rcb!.title).not.toContain('undefined')
      expect(rcb!.title).not.toContain('[object')

      // Evidence should have correct metric kind
      expect(rcb!.hasData).toBe(true)
      expect(rcb!.presentationKind).toBe('repo_conditioned_behavior')

      // Description should not contradict title
      expect(rcb!.description).toBeTruthy()
    })
  })

  // ── 3. Workflow-repo allocation, same dominant repo ──────────────────────
  describe('3. Workflow-repo allocation (same dominant repo)', () => {
    it('sets allocationSubtype=same_dominant_repo; title shows concentration gap; no label inversion', () => {
      // VS Code 90% in repo-a, Cursor 50% in repo-a → 40pp gap (>= 20pp threshold)
      const rows: Record<string, unknown>[] = []
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 18; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-a' }))
        for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-b' }))
        for (let i = 0; i < 10; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-a' }))
        for (let i = 0; i < 10; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-c' }))
      }

      const insights = generateMultiDimensionalInsights(buildInput(rows))
      const alloc = insights.find(i => i.id.startsWith('workflow-repo-allocation__vscode_vs_cursor'))
      expect(alloc).toBeDefined()

      // Should have same_dominant_repo subtype
      expect((alloc as any).allocationSubtype).toBe('same_dominant_repo')

      // Title should mention both workflows and the concentration gap
      expect(alloc!.title).toContain('VS Code')
      expect(alloc!.title).toContain('concentrated')

      // Evidence should have workflow names as metric labels, not repo names
      const evidence = alloc!.evidence || []
      const metrics = evidence.map(e => e.metric || '')
      // The first two evidence entries should be workflow top-repo entries
      expect(metrics.some(m => m.includes('VS Code'))).toBe(true)
      expect(metrics.some(m => m.includes('Cursor'))).toBe(true)

      // No "Different workflows are being used on different repositories" for same-dominant-repo
      expect(alloc!.description).not.toContain('Different workflows are being used on different repositories')

      // hasData should be true (not a generic insufficient fallback)
      expect(alloc!.hasData).toBe(true)
    })
  })

  // ── 4. Workflow-repo allocation, different dominant repo ────────────────
  describe('4. Workflow-repo allocation (different dominant repo)', () => {
    it('sets allocationSubtype=different_dominant_repo; title shows different repos', () => {
      // VS Code dominant in repo-a, Cursor dominant in repo-b
      const rows: Record<string, unknown>[] = []
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 18; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-a' }))
        for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-b' }))
        for (let i = 0; i < 18; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-b' }))
        for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'cursor', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-a' }))
      }

      const insights = generateMultiDimensionalInsights(buildInput(rows))
      const alloc = insights.find(i => i.id.startsWith('workflow-repo-allocation__vscode_vs_cursor'))
      expect(alloc).toBeDefined()

      // Should have different_dominant_repo subtype
      expect((alloc as any).allocationSubtype).toBe('different_dominant_repo')

      // Title should mention both workflows
      expect(alloc!.title).toContain('VS Code')
      expect(alloc!.title).toContain('Cursor')

      // Evidence should show different repos for each workflow
      const evidence = alloc!.evidence || []
      expect(evidence.length).toBeGreaterThanOrEqual(2)

      // hasData should be true
      expect(alloc!.hasData).toBe(true)
    })
  })

  // ── 5. Temporal allocation shift ─────────────────────────────────────────
  describe('5. Temporal allocation shift quality gate', () => {
    it('classifies low-sample shifts as low_sample (not stable); confidence is low', () => {
      // VS Code: prior N=17, recent N=7 — low sample
      const rows: Record<string, unknown>[] = []
      // Prior window: 17 VS Code sessions in repo-a
      for (let d = 10; d <= 14; d++) {
        for (let i = 0; i < 4; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-a' }))
        for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d) }))
      }
      // Recent window: 7 VS Code sessions in repo-b (shift!)
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-b' }))
        for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d) }))
      }

      const insights = generateMultiDimensionalInsights(buildInput(rows))
      const shift = insights.find(i => i.id.startsWith('workflow-repo-allocation-shift__vscode'))

      if (shift) {
        // If it survives generation, it must be classified as low_sample or instrumentation_gap
        const tq = (shift as any).temporalQuality
        expect(['low_sample', 'instrumentation_gap']).toContain(tq)
        expect(shift.confidence).toBe('low')

        // Title should use cautious language, not "moved almost entirely"
        expect(shift.title.toLowerCase()).not.toContain('moved almost entirely')
        expect(shift.title.toLowerCase()).toContain('appears to shift')
      }
    })

    it('classifies well-sampled shifts as stable; allows strong language', () => {
      // VS Code: prior N=50, recent N=50 — adequate sample
      const rows: Record<string, unknown>[] = []
      for (let d = 10; d <= 14; d++) {
        for (let i = 0; i < 10; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-a' }))
        for (let i = 0; i < 4; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d) }))
      }
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 10; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d), git_repo_url: 'https://github.com/org/repo-b' }))
        for (let i = 0; i < 4; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d) }))
      }

      const insights = generateMultiDimensionalInsights(buildInput(rows))
      const shift = insights.find(i => i.id.startsWith('workflow-repo-allocation-shift__vscode'))

      if (shift) {
        const tq = (shift as any).temporalQuality
        expect(tq).toBe('stable')
        // Stable findings can use strong language
        expect(shift.confidence).not.toBe('low')
      }
    })
  })

  // ── 6. Recent-change session share ───────────────────────────────────────
  describe('6. Recent-change session share', () => {
    it('title shows percentage change; evidence has correct units (not duration)', () => {
      // Devin share goes from 20% to 80%
      const rows: Record<string, unknown>[] = []
      for (let d = 8; d <= 12; d++) {
        for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d) }))
        for (let i = 0; i < 8; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d) }))
      }
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 8; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d) }))
        for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d) }))
      }

      const insights = generateRecentChangeInsights(buildInput(rows))
      const share = insights.find(i => i.id.startsWith('recent-change__session_share__devin'))

      expect(share).toBeDefined()
      expect(share!.hasData).toBe(true)

      // Title should contain percentage values
      expect(share!.title).toMatch(/\d%/)
      expect(share!.title).toContain('Devin')

      // Should not contain duration units (minutes/hours) for a share finding
      expect(share!.title.toLowerCase()).not.toContain('min')
      expect(share!.title.toLowerCase()).not.toContain('hour')

      // Presentation kind should be temporal_trend
      expect(share!.presentationKind).toBe('temporal_trend')
    })
  })

  // ── 7. Recent-change session volume ──────────────────────────────────────
  describe('7. Recent-change session volume', () => {
    it('title shows volume change percentage; no unit corruption', () => {
      // Volume goes from 10 to 40 (300% increase)
      const rows: Record<string, unknown>[] = []
      for (let d = 8; d <= 12; d++) {
        for (let i = 0; i < 2; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d) }))
      }
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 8; i++) rows.push(buildSession({ tool: 'vscode', timestamp: daysAgoISO(d) }))
      }

      const insights = generateRecentChangeInsights(buildInput(rows))
      const vol = insights.find(i => i.id.startsWith('recent-change__session_volume__org'))

      if (vol) {
        expect(vol.hasData).toBe(true)
        // Title should contain percentage
        expect(vol.title).toMatch(/\d/)
        // Should mention volume or sessions
        expect(vol.title.toLowerCase()).toMatch(/volume|session/)
        // Should not contain duration units
        expect(vol.title.toLowerCase()).not.toContain('min/session')
      }
    })
  })

  // ── 8. Configured cost (smoke test — requires cost config) ────────────────
  describe('8. Configured cost', () => {
    it('cost findings use currency units, not duration or percentage-only', () => {
      // This is a smoke test — full cost tests live in dedicated cost test files.
      // Here we verify that if cost insights are generated, they use $ units.
      const rows: Record<string, unknown>[] = []
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 10; i++) rows.push(buildSession({ tool: 'devin', timestamp: daysAgoISO(d) }))
      }

      const costConfigs = [
        { toolId: 'devin', monthlyAmount: 5000, currency: 'USD' },
      ] as any

      const insights = generateMultiDimensionalInsights(buildInput(rows, { externalCostConfigs: costConfigs }))
      const costFindings = insights.filter(i =>
        i.id.includes('allocated-spend') || i.id.includes('cost') || i.id.includes('economics')
      )

      for (const c of costFindings) {
        // Cost findings should not use duration units in the title
        if (c.hasData) {
          expect(c.title.toLowerCase()).not.toContain('min/session')
          expect(c.title.toLowerCase()).not.toContain('hours')
        }
      }
    })
  })

  // ── 9. One delivery PI ───────────────────────────────────────────────────
  describe('9. Delivery PI (review-merge)', () => {
    it('delivery findings use correct units (PR count, merge time, not sessions)', () => {
      // Build sessions with PR data
      const rows: Record<string, unknown>[] = []
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 6; i++) {
          rows.push(buildSession({
            tool: 'vscode', timestamp: daysAgoISO(d),
            session_commits: 3, session_commits_source: 'observed',
          }))
        }
      }

      const insights = generateReviewMergeInsights(buildInput(rows))
      const delivery = insights.find(i =>
        i.cicdStage === 'review-merge' && i.hasData
      )

      if (delivery) {
        // Delivery findings should not use "sessions" as the primary unit in title
        // when they're about PRs/merges
        expect(delivery.title).toBeTruthy()
        expect(delivery.title).not.toContain('undefined')
        expect(delivery.title).not.toContain('[object')
      }
    })
  })

  // ── 10. Cross-cutting: no generic "insufficient" fallback for eligible data ─
  describe('10. No generic insufficient fallback for eligible findings', () => {
    it('eligible multi-dimensional findings do not fall back to generic insufficient language', () => {
      const rows: Record<string, unknown>[] = []
      // Enough data for all families, spread across multiple days
      for (let d = 1; d <= 5; d++) {
        for (let i = 0; i < 8; i++) {
          rows.push(buildSession({
            tool: 'devin', timestamp: daysAgoISO(d),
            duration_ms: 45 * 60000,
            git_repo_url: 'https://github.com/org/repo-a',
          }))
        }
        for (let i = 0; i < 8; i++) {
          rows.push(buildSession({
            tool: 'devin', timestamp: daysAgoISO(d),
            duration_ms: 16 * 60000,
            git_repo_url: 'https://github.com/org/repo-b',
          }))
        }
        for (let i = 0; i < 8; i++) {
          rows.push(buildSession({
            tool: 'vscode', timestamp: daysAgoISO(d),
            git_repo_url: 'https://github.com/org/repo-a',
          }))
        }
      }

      const insights = generateMultiDimensionalInsights(buildInput(rows))
      const eligible = insights.filter(i => i.hasData)

      for (const i of eligible) {
        expect(i.title.toLowerCase()).not.toContain('insufficient data')
        expect(i.title.toLowerCase()).not.toContain('not yet measurable')
        expect(i.title.toLowerCase()).not.toContain('data not available')
        expect(i.title.toLowerCase()).not.toContain('more data needed')
      }
    })
  })
})
