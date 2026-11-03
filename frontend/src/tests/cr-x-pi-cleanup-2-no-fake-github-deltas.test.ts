/**
 * CR-X PI-CLEANUP-2 regression: no fake GitHub delta badges.
 *
 * getGitHubDeltaValue() previously returned hardcoded demo percentage
 * values (review +12, unique reviewers +8, merge time -15, etc.) for
 * every GitHub metric card. The badge rendered when
 * `metric.dataSource === 'github'`, meaning these invented percentages
 * could appear alongside REAL GitHub evidence — violating observational
 * / fail-closed semantics.
 *
 * Wave 3 provenance gating hides them for cm_activity_sim, but that does
 * NOT make the item SUPERSEDED: the badge still renders for real GitHub
 * data, presenting invented numbers as if they were measured.
 *
 * The fix: remove the delta badge entirely and dead-remove the three
 * helper functions (getGitHubDeltaValue, getGitHubDeltaBadgeClass,
 * getGitHubDeltaIcon) since they had no other valid consumer.
 *
 * This regression proves:
 * - no hardcoded percentage map remains on the active render path
 * - the delta badge span is absent from the template
 * - the three helper functions are absent from the source
 * - real GitHub metric value/source label is retained
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('CR-X PI-CLEANUP-2: no fake GitHub delta badges', () => {
  const componentPath = resolve(__dirname, '../components/EngOutput.vue')
  const source = readFileSync(componentPath, 'utf-8')

  it('getGitHubDeltaValue function is removed', () => {
    expect(source).not.toContain('function getGitHubDeltaValue')
    expect(source).not.toContain('getGitHubDeltaValue')
  })

  it('getGitHubDeltaBadgeClass function is removed', () => {
    expect(source).not.toContain('function getGitHubDeltaBadgeClass')
    expect(source).not.toContain('getGitHubDeltaBadgeClass')
  })

  it('getGitHubDeltaIcon function is removed', () => {
    expect(source).not.toContain('function getGitHubDeltaIcon')
    expect(source).not.toContain('getGitHubDeltaIcon')
  })

  it('hardcoded delta map is absent', () => {
    // The specific invented percentage values must not appear
    expect(source).not.toContain("'github-review-count': 12")
    expect(source).not.toContain("'github-unique-reviewers': 8")
    expect(source).not.toContain("'github-merge-time': -15")
    expect(source).not.toContain("'github-pr-count': 18")
    expect(source).not.toContain("'github-deployment-count': 22")
    expect(source).not.toContain("'github-rollback-count': -3")
    // The deltaMap variable itself must be gone
    expect(source).not.toContain('deltaMap')
  })

  it('delta badge span is absent from the template', () => {
    // The span with class "metric-delta" that rendered the badge is gone
    expect(source).not.toContain('class="metric-delta"')
    // The v-if condition that gated the badge on dataSource === 'github'
    // for the delta span is gone (the metric-value-row still exists for
    // the value itself, but the delta-specific span is removed)
    expect(source).not.toMatch(/metric-delta.*getGitHubDelta/)
  })

  it('real GitHub metric value and source label are retained', () => {
    // The metric value ({{ metric.value }}) must still render
    expect(source).toContain('{{ metric.value }}')
    // The data-source-badge (GitHub/Simulated label) must still render
    expect(source).toContain('data-source-badge')
    // The dataSource computed (githubDataSourceInfo) must still exist
    expect(source).toContain('githubDataSourceInfo')
    // The provenance gate (cm_activity_sim → 'simulated') must still exist
    expect(source).toContain('cm_activity_sim')
  })

  it('no fake 0% fallback is introduced for the delta badge', () => {
    // The fix must not render 0% as a fake fallback for the removed badge.
    // Check specifically for delta-related percentage rendering, not CSS
    // gradient stops (which legitimately contain 0%).
    expect(source).not.toMatch(/Delta.*%/)
    expect(source).not.toMatch(/delta.*0%/)
    // No remaining function returns a hardcoded percentage for GitHub metrics
    expect(source).not.toMatch(/function.*[Dd]elta.*%\s*\{/)
  })
})
