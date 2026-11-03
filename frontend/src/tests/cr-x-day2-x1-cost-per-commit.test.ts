/**
 * CR-X Day 2 X1: Cost-per-commit in PBT cost summary strip
 *
 * Source: CR-X-PILOT-READINESS-AUDIT.md:850
 *   "Cost per commit | YES (accepted) | — | commit event count | No"
 *
 * The PBT cost summary strip must show $/commit using total_commit_count
 * from canonical telemetry metadata as the denominator. This is
 * telemetry-derived (event_type='commit'), not GitHub evidence.
 *
 * Constraints:
 * - Fail closed when developer or repo filter is active (same as $/PR, $/deployment)
 * - Fail closed when no configured spend
 * - Fail closed when total_commit_count is 0 or missing
 * - Available even without GitHub integration
 * - Label format: $X.XX/commit (2 decimal places — commit counts can be large)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pbtPath = resolve(__dirname, '../components/ProductivityByToolV3.vue')
const pbtSource = readFileSync(pbtPath, 'utf-8')

describe('CR-X Day 2 X1: Cost-per-commit in PBT cost summary strip', () => {
  it('costPerDeliveryEvidence computed reads total_commit_count from canonical metadata', () => {
    expect(pbtSource).toContain('total_commit_count')
  })

  it('costPerDeliveryEvidence includes $/commit format with 2 decimal places', () => {
    expect(pbtSource).toMatch(/\$.*toFixed\(2\).*\/commit/)
  })

  it('cost-per-commit is telemetry-derived, not GitHub-dependent', () => {
    // The $/commit part must be computed BEFORE the GitHub evidence check
    // so it renders even when props.githubMetrics is null
    const costComputed = pbtSource.match(/const costPerDeliveryEvidence = computed\([\s\S]*?\n\}\)/)
    expect(costComputed).toBeTruthy()
    const commitSection = costComputed![0]
    const ghCheck = commitSection.indexOf('props.githubMetrics')
    const commitCheck = commitSection.indexOf('total_commit_count')
    expect(commitCheck).toBeGreaterThan(-1)
    expect(ghCheck).toBeGreaterThan(commitCheck)
  })

  it('cost-per-commit fails closed when developer or repo filter is active', () => {
    const costComputed = pbtSource.match(/const costPerDeliveryEvidence = computed\([\s\S]*?\n\}\)/)
    expect(costComputed).toBeTruthy()
    expect(costComputed![0]).toContain('isDeveloperFiltered')
    expect(costComputed![0]).toContain('isRepoFiltered')
  })

  it('cost-per-commit fails closed when total_commit_count is 0 or missing', () => {
    // The code must check totalCommits > 0 before computing the ratio
    expect(pbtSource).toMatch(/totalCommits\s*>\s*0/)
  })

  it('cost-per-commit fails closed when no configured spend', () => {
    const costComputed = pbtSource.match(/const costPerDeliveryEvidence = computed\([\s\S]*?\n\}\)/)
    expect(costComputed).toBeTruthy()
    expect(costComputed![0]).toMatch(/totalSpend\s*<=\s*0/)
  })
})
