/**
 * CR-X PI-CLEANUP-7 regression test.
 *
 * buildFrozenGithubDecisionCard() in PerformanceRecommendationsView.vue
 * previously hardcoded the comparison tag/color for the
 * 'change-failure-rate-spike-by-ide' (legacy fallback) and
 * 'reopen-pressure-spike' cards to `tag: 'Above target', tagType: 'worst'`
 * UNCONDITIONALLY — even when the actual measured value was at or below
 * the target. It also asserted a false directional claim in the
 * `interpretation` text ("is above target") when there was no GitHub data
 * at all to support any claim.
 *
 * This function is a module-scope helper inside a <script setup> SFC and
 * is not exported, so this is a source-level regression test (consistent
 * with other PerformanceRecommendationsView/.vue tests in this suite).
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('CR-X PI-CLEANUP-7: GitHub decision card truth (no unconditional overclaiming)', () => {
  const componentPath = path.resolve(__dirname, '../components/PerformanceRecommendationsView.vue')
  const source = fs.readFileSync(componentPath, 'utf-8')

  // Isolate the buildFrozenGithubDecisionCard function body.
  const fnMatch = source.match(
    /function buildFrozenGithubDecisionCard\([\s\S]*?\n\}\n/
  )
  const fnBody = fnMatch ? fnMatch[0] : ''

  it('finds the buildFrozenGithubDecisionCard function', () => {
    expect(fnBody.length).toBeGreaterThan(0)
  })

  it('does not unconditionally hardcode tag: "Above target" / tagType: "worst" for the actual-value comparison row', () => {
    // A conditional (ternary) expression referencing the aboveTarget flags
    // must exist instead of the previous static literal pair.
    expect(fnBody).toContain('cfrAboveTarget')
    expect(fnBody).toContain('reopenAboveTarget')
    // The old unconditional pair must not appear as a literal pair anywhere
    // in this function (it should now be inside a ternary keyed off the
    // real comparison, not a bare static assignment).
    expect(fnBody).not.toMatch(/tag: 'Above target', tagType: 'worst'/)
  })

  it('does not assert a false directional claim when there is no GitHub deployment/PR data', () => {
    expect(fnBody).not.toContain('Deployment failure rate is above target.')
    expect(fnBody).not.toContain('PRs are reopening above target, which points to review quality pressure.')
  })

  it('uses a neutral, truthful no-data interpretation instead', () => {
    expect(fnBody).toContain('No GitHub deployment data available for this period.')
    expect(fnBody).toContain('No GitHub PR data available for this period.')
  })

  it('tag/color reflect both directions (at-or-below-target is representable, not just "worst")', () => {
    expect(fnBody).toContain('At or below target')
    expect(fnBody).toContain("tagType: !hasData ? 'neutral'")
  })
})
