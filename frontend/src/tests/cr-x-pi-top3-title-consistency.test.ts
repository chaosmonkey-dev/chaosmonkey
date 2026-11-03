/**
 * CR-X PI repository-distribution top-3 title vs interpretation consistency.
 *
 * Generator → adapter → renderer-path regression.
 *
 * Matt's browser acceptance found that the cross-workflow repository
 * concentration card rendered:
 *
 *   Title:         "Claude Code top-3 differs across workflows"
 *   Interpretation: "All workflows show similar Claude Code top-3.
 *                   The observed gap is within noise range — monitor but
 *                   do not reorganize teams around this difference."
 *
 * Root cause: with 3+ workflows the adapter's comparisonAuthority picked
 * the top-2 breakdownByTool entries by value (e.g. cursor_top3=80,
 * vscode_top3=77.5, gap=2.5) instead of the generator's max-gap pair
 * (cursor_top3=80, claude_code_top3=38, gap=42).  The small adapter gap
 * produced operationallySignificant=false → isNarrowGap=true (interpretation
 * says "similar") while the material-gap title (which does NOT contain
 * "similar") fell through the renderer's tied-branch fallback, producing
 * "{metricName} differs across workflows".
 *
 * Fix:
 *  1. Generator now sets selectedComparison for both similar and
 *     material-gap branches so the adapter uses the correct pair.
 *  2. Renderer now forces isNarrowGap=true when the canonical title
 *     already says "similar" or "no material", preventing the adapter's
 *     10%-of-leader threshold from contradicting the generator's
 *     materiality assessment.
 */
import { describe, it, expect } from 'vitest'
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = { location: { search: '' } } as any
}
import { generateRepositoryDistributionByWorkflow } from '../lib/insights/final/generators/planCode'
import { adaptCanonicalToUI } from '../lib/insights/final/adapters/renderAdapter'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

/** Build session rows for a single workflow with a target top-3 concentration. */
function buildSessions(workflow: string, total: number, top3Count: number, repoCount: number): any[] {
  const rows: any[] = []
  for (let i = 0; i < top3Count; i++) {
    rows.push({
      session_id: `s-${workflow}-${i}`,
      tool: workflow,
      timestamp: '2026-08-15T10:00:00.000000Z',
      git_repo_url: `https://github.com/org/top${i % 3}`,
    })
  }
  const remaining = total - top3Count
  for (let i = 0; i < remaining; i++) {
    rows.push({
      session_id: `s-${workflow}-x${i}`,
      tool: workflow,
      timestamp: '2026-08-15T10:00:00.000000Z',
      git_repo_url: `https://github.com/org/other${i % repoCount}`,
    })
  }
  return rows
}

/**
 * Simulate the renderer's title-normalization decision for workflow-comparison
 * insights.  This mirrors the logic in PerformanceRecommendationsView.vue:
 *  - comparisonMode 'meaningful-difference' → pass through canonical title
 *  - comparisonMode 'tied' + title contains "similar"/"no material" → pass through
 *  - comparisonMode 'tied' + otherwise → "{metricName} differs across workflows"
 */
function simulateRendererTitle(adapted: any): string {
  const ca = adapted.comparisonAuthority
  const hasEnough = ca && ca.rows && ca.rows.filter((r: any) => r.eligibleForRanking).length >= 2
  const comparisonMode = hasEnough
    ? (ca.operationallySignificant ? 'meaningful-difference' : 'tied')
    : 'insufficient'
  const canonicalTitle = adapted.title || ''
  const metricName = adapted.rightMetricLabel || canonicalTitle.split(' ').slice(0, 3).join(' ') || 'Metric'

  if (comparisonMode === 'meaningful-difference') {
    return canonicalTitle
  }
  if (comparisonMode === 'tied') {
    if (/similar|no material/i.test(canonicalTitle)) {
      return canonicalTitle
    }
    return `${metricName} differs across workflows`
  }
  return canonicalTitle
}

/**
 * Simulate the renderer's isNarrowGap decision, including the CR-X override
 * that forces isNarrowGap=true when the canonical title says "similar".
 */
function simulateIsNarrowGap(adapted: any): boolean {
  const caOpSig = adapted.comparisonAuthority?.operationallySignificant
  let isNarrowGap = caOpSig === false
  if (!isNarrowGap && /similar|no material/i.test(adapted.title || '')) {
    isNarrowGap = true
  }
  return isNarrowGap
}

describe('CR-X PI top-3 title: generator → adapter → renderer path', () => {
  describe('material-gap branch (3 workflows, adapter must use selectedComparison)', () => {
    const sessions = [
      ...buildSessions('cursor', 40, 32, 10),       // 80% top-3
      ...buildSessions('vscode', 40, 31, 10),        // 77.5% top-3
      ...buildSessions('claude_code', 40, 15, 10),   // 37.5% top-3
    ]
    const input = { sessionRows: sessions, granularity: 'month' } as any as CanonicalInsightInput
    const canonical = generateRepositoryDistributionByWorkflow(input)!
    const adapted = adaptCanonicalToUI(canonical)

    it('generator sets selectedComparison to the max-gap pair', () => {
      expect((canonical as any).selectedComparison).toBeDefined()
      expect((canonical as any).selectedComparison.leaderKey).toBe('cursor_top3')
      expect((canonical as any).selectedComparison.baselineKey).toBe('claude_code_top3')
    })

    it('adapter uses selectedComparison pair, not top-2 by value', () => {
      const ca = (adapted as any).comparisonAuthority
      expect(ca.leader.workflowId).toBe('cursor_top3')
      expect(ca.runnerUp.workflowId).toBe('claude_code_top3')
      expect(ca.operationallySignificant).toBe(true)
    })

    it('renderer title is the material-gap title (not "differs across workflows")', () => {
      const title = simulateRendererTitle(adapted)
      expect(title).not.toContain('differs across workflows')
      expect(title).toContain('concentrate')
    })

    it('interpretation says "differs" (isNarrowGap=false)', () => {
      expect(simulateIsNarrowGap(adapted)).toBe(false)
    })
  })

  describe('similar branch (3 workflows, gap < 15pp) → suppressed', () => {
    const sessions = [
      ...buildSessions('cursor', 40, 24, 10),        // 60% top-3
      ...buildSessions('vscode', 40, 23, 10),        // 57.5% top-3
      ...buildSessions('claude_code', 40, 22, 10),   // 55% top-3
    ]
    const input = { sessionRows: sessions, granularity: 'month' } as any as CanonicalInsightInput
    const canonical = generateRepositoryDistributionByWorkflow(input)

    it('generator returns null for non-material gaps', () => {
      expect(canonical).toBeNull()
    })
  })

  describe('similar branch with adapter threshold edge case → suppressed', () => {
    const sessions = [
      ...buildSessions('cursor', 40, 32, 10),       // 80% top-3
      ...buildSessions('vscode', 40, 27, 10),        // 67.5% top-3  → gap=12.5pp
    ]
    const input = { sessionRows: sessions, granularity: 'month' } as any as CanonicalInsightInput
    const canonical = generateRepositoryDistributionByWorkflow(input)

    it('generator returns null for non-material gaps', () => {
      expect(canonical).toBeNull()
    })
  })

  describe('internal-key leakage regression (customer-facing copy)', () => {
    // CR-X: No internal breakdownByTool keys (*_top3, *_repos) may appear
    // in any customer-facing field: title, description, recommendation,
    // comparisonAuthority displayNames, evidence labels, or gap labels.
    const sessions = [
      ...buildSessions('cursor', 40, 32, 10),       // 80% top-3
      ...buildSessions('vscode', 40, 31, 10),        // 77.5% top-3
      ...buildSessions('claude_code', 40, 15, 10),   // 37.5% top-3
    ]
    const input = { sessionRows: sessions, granularity: 'month' } as any as CanonicalInsightInput
    const canonical = generateRepositoryDistributionByWorkflow(input)!
    const adapted = adaptCanonicalToUI(canonical)

    const INTERNAL_KEY_PATTERN = /_top3|_repos|_top_3|claude_code_top3|devin_top3|cursor_top3|vscode_top3/i

    it('canonical title does not leak internal keys', () => {
      expect(canonical.title).not.toMatch(INTERNAL_KEY_PATTERN)
    })

    it('canonical description does not leak internal keys', () => {
      expect((canonical as any).description || '').not.toMatch(INTERNAL_KEY_PATTERN)
    })

    it('canonical recommendation does not leak internal keys', () => {
      expect((canonical as any).recommendation || '').not.toMatch(INTERNAL_KEY_PATTERN)
    })

    it('adapter comparisonAuthority displayNames do not leak internal keys', () => {
      const ca = (adapted as any).comparisonAuthority
      if (ca?.leader?.displayName) {
        expect(ca.leader.displayName).not.toMatch(INTERNAL_KEY_PATTERN)
      }
      if (ca?.runnerUp?.displayName) {
        expect(ca.runnerUp.displayName).not.toMatch(INTERNAL_KEY_PATTERN)
      }
      if (ca?.rows) {
        for (const row of ca.rows) {
          expect(row.displayName || '').not.toMatch(INTERNAL_KEY_PATTERN)
        }
      }
    })

    it('adapter title does not leak internal keys', () => {
      expect(adapted.title || '').not.toMatch(INTERNAL_KEY_PATTERN)
    })

    it('adapter description does not leak internal keys', () => {
      expect((adapted as any).description || '').not.toMatch(INTERNAL_KEY_PATTERN)
    })

    it('adapter recommendation does not leak internal keys', () => {
      expect((adapted as any).recommendation || '').not.toMatch(INTERNAL_KEY_PATTERN)
    })

    it('renderer recommendation (getMetricSpecificAction path) does not leak internal keys', () => {
      // Simulate the renderer's recommendation path for repo-distribution
      const ca = (adapted as any).comparisonAuthority
      const leaderName = ca?.leader?.displayName || ''
      const runnerUpName = ca?.runnerUp?.displayName || ''
      // The repo-distribution-specific recommendation from getMetricSpecificAction
      const rec = `Compare repository concentration between ${leaderName} and ${runnerUpName}. Investigate whether the difference reflects task mix, session structure, or workflow behavior before treating it as a productivity difference.`
      expect(rec).not.toMatch(INTERNAL_KEY_PATTERN)
    })
  })
})
