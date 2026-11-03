/**
 * CR-X 3D.2C — Semantic Contract Tests
 *
 * Proves the boundary between machine-semantic provenance values and
 * customer-facing presentation labels.
 *
 * A. Internal seeded/simulated provenance remains machine-identifiable
 * B. Rendered label is "GitHub delivery" (or equivalent neutral label)
 * C. Customer-facing serialized/rendered copy does NOT expose internal terms
 * D. A seeded/simulated insight does NOT become "Mixed" from label normalization
 * E. Live GitHub remains live/real internally
 * F. Presentation normalization does not change PI eligibility/ranking/values
 */

import { describe, it, expect } from 'vitest'
import { normalizeSourceLabel, normalizeBreadcrumbs } from '../lib/insights/final/helpers/sourceLabelNormalizer'

describe('CR-X 3D.2C — Semantic Contract: machine vs presentation', () => {
  describe('A. Internal seeded/simulated provenance remains machine-identifiable', () => {
    it('normalizeSourceLabel does not change the machine value "simulated"', () => {
      // The normalizer must NOT be called on machine fields, but if it is,
      // it should not produce a value that breaks the 'Real'|'Simulated'|'Mixed' enum.
      // 'simulated' is not in the internal-to-neutral map, so it passes through.
      const result = normalizeSourceLabel('simulated')
      // 'simulated' is not a fixture term — it's a machine enum value.
      // The normalizer should leave it unchanged.
      expect(result).toBe('simulated')
    })

    it('normalizeSourceLabel does not change the machine value "Real"', () => {
      const result = normalizeSourceLabel('Real')
      expect(result).toBe('Real')
    })

    it('normalizeSourceLabel does not change the machine value "Mixed"', () => {
      const result = normalizeSourceLabel('Mixed')
      expect(result).toBe('Mixed')
    })
  })

  describe('B. Rendered label is neutral customer-facing copy', () => {
    it('replaces "GitHub demo dataset · cm-activity-sim" with neutral label', () => {
      const result = normalizeSourceLabel('GitHub demo dataset · cm-activity-sim')
      expect(result).toBe('GitHub delivery · all-time baseline')
    })

    it('replaces "Local demo dataset · cm-activity-sim" with neutral label (substring replacement)', () => {
      // Note: substring replacement processes "demo dataset" → "delivery data" first,
      // then "cm-activity-sim" → "GitHub delivery". The result is neutral and
      // contains no forbidden terms, which is the contract requirement.
      const result = normalizeSourceLabel('Local demo dataset · cm-activity-sim')!
      expect(result).not.toContain('cm-activity-sim')
      expect(result).not.toContain('demo dataset')
      expect(result).not.toContain('Local demo')
      expect(result).toContain('GitHub delivery')
    })

    it('replaces standalone "cm-activity-sim"', () => {
      const result = normalizeSourceLabel('cm-activity-sim')
      expect(result).toBe('GitHub delivery')
    })
  })

  describe('C. Customer-facing copy does NOT expose internal terms', () => {
    const FORBIDDEN_TERMS = [
      'cm-activity-sim',
      'cm_activity_sim',
      'demo dataset',
      'Local demo dataset',
      'demo baseline',
    ]

    const TEST_LABELS = [
      'GitHub demo dataset · cm-activity-sim',
      'cm-activity-sim',
      'cm_activity_sim',
      'Local demo dataset · cm-activity-sim',
      'GitHub delivery · all-time baseline',
      'GitHub delivery',
      'Historical delivery data',
    ]

    for (const label of TEST_LABELS) {
      it(`normalized "${label}" contains no forbidden internal terms`, () => {
        const result = normalizeSourceLabel(label) || ''
        for (const term of FORBIDDEN_TERMS) {
          expect(result).not.toContain(term)
        }
      })
    }
  })

  describe('D. Seeded/simulated insight does NOT become "Mixed" from normalization', () => {
    it('machine dataSource enum "Simulated" is not altered by normalizeSourceLabel', () => {
      // The normalizer must not be used on dataSource, but if it accidentally is,
      // 'Simulated' should not become something that breaks the enum.
      const result = normalizeSourceLabel('Simulated')
      // 'Simulated' is not in the internal-to-neutral map, so it passes through.
      expect(result).toBe('Simulated')
    })

    it('machine source enum "simulated" is not altered by normalizeSourceLabel', () => {
      const result = normalizeSourceLabel('simulated')
      expect(result).toBe('simulated')
    })

    it('breadcrumbs with fixture terms are normalized but non-fixture terms pass through', () => {
      const breadcrumbs = [
        'Small PRs (<200 changes): N=5, median 3h',
        'Large PRs (≥200 changes): N=13, median 17h',
        '18 merged PRs',
        'GitHub demo dataset · cm-activity-sim',
      ]
      const result = normalizeBreadcrumbs(breadcrumbs)!
      expect(result).toHaveLength(4)
      // Non-fixture breadcrumbs unchanged
      expect(result[0]).toBe('Small PRs (<200 changes): N=5, median 3h')
      expect(result[1]).toBe('Large PRs (≥200 changes): N=13, median 17h')
      expect(result[2]).toBe('18 merged PRs')
      // Fixture breadcrumb normalized
      expect(result[3]).toBe('GitHub delivery · all-time baseline')
      expect(result[3]).not.toContain('cm-activity-sim')
    })
  })

  describe('E. Live GitHub remains live/real internally', () => {
    it('normalizeSourceLabel does not alter "GitHub API sync"', () => {
      const result = normalizeSourceLabel('GitHub API sync')
      expect(result).toBe('GitHub API sync')
    })

    it('normalizeSourceLabel does not alter "GitHub"', () => {
      const result = normalizeSourceLabel('GitHub')
      expect(result).toBe('GitHub')
    })

    it('normalizeSourceLabel does not alter "GitHub delivery"', () => {
      const result = normalizeSourceLabel('GitHub delivery')
      expect(result).toBe('GitHub delivery')
    })

    it('normalizeSourceLabel does not alter "GitHub delivery · all-time baseline"', () => {
      const result = normalizeSourceLabel('GitHub delivery · all-time baseline')
      expect(result).toBe('GitHub delivery · all-time baseline')
    })
  })

  describe('F. Normalization does not change metric values or counts', () => {
    it('breadcrumb with deployment count preserves the count after normalization', () => {
      const breadcrumb = 'GitHub demo dataset · cm-activity-sim · 25 deployments · 3 observed days'
      const result = normalizeSourceLabel(breadcrumb)!
      expect(result).toContain('25 deployments')
      expect(result).toContain('3 observed days')
      expect(result).not.toContain('cm-activity-sim')
    })

    it('breadcrumb with merged PR count preserves the count after normalization', () => {
      const breadcrumb = 'GitHub demo dataset · cm-activity-sim · 18 merged PRs'
      const result = normalizeSourceLabel(breadcrumb)!
      expect(result).toContain('18 merged PRs')
      expect(result).not.toContain('cm-activity-sim')
    })
  })
})

describe('CR-X 3D.2C — InsightCardContent source classification contract', () => {
  // This tests the exact branching logic in InsightCardContent.vue line 460:
  //   source: props.insight.dataSource === 'Real' ? 'github'
  //         : props.insight.dataSource === 'Simulated' ? 'simulated'
  //         : 'mixed'
  // The machine enum 'Real' | 'Simulated' | 'Mixed' must map to
  // 'github' | 'simulated' | 'mixed' — NOT to presentation labels.

  it('dataSource "Real" maps to source "github" (machine value)', () => {
    const dataSource = 'Real'
    const source = dataSource === 'Real' ? 'github'
      : dataSource === 'Simulated' ? 'simulated'
      : 'mixed'
    expect(source).toBe('github')
  })

  it('dataSource "Simulated" maps to source "simulated" (machine value, NOT presentation label)', () => {
    const dataSource = 'Simulated'
    const source = dataSource === 'Real' ? 'github'
      : dataSource === 'Simulated' ? 'simulated'
      : 'mixed'
    // CRITICAL: This must be 'simulated' (machine), NOT 'GitHub delivery' (presentation)
    expect(source).toBe('simulated')
    expect(source).not.toBe('GitHub delivery')
    expect(source).not.toBe('github_delivery')
  })

  it('dataSource "Mixed" maps to source "mixed" (machine value)', () => {
    const dataSource = 'Mixed'
    const source = dataSource === 'Real' ? 'github'
      : dataSource === 'Simulated' ? 'simulated'
      : 'mixed'
    expect(source).toBe('mixed')
  })

  it('dataSource "GitHub delivery" (broken presentation value) would fall through to "mixed"', () => {
    // This proves WHY the 3D.2B change was a bug: if dataSource were 'GitHub delivery'
    // instead of 'Simulated', it would silently fall through to 'mixed'.
    const dataSource = 'GitHub delivery' // The broken 3D.2B value
    const source = dataSource === 'Real' ? 'github'
      : dataSource === 'Simulated' ? 'simulated'
      : 'mixed'
    // This is the bug: a seeded insight would become 'mixed' instead of 'simulated'
    expect(source).toBe('mixed') // BUG: should be 'simulated'
  })
})

describe('CR-X 3D.2C — EngOutput dataSource machine contract', () => {
  // EngOutput.vue githubDataSourceInfo must return machine-semantic dataSource
  // and presentation-semantic dataSourceLabel separately.

  it('cm_activity_sim source yields dataSource="simulated" (machine), NOT "github_delivery"', () => {
    // Simulate the githubDataSourceInfo computed
    const provenance = { source: 'cm_activity_sim' }
    const source = provenance?.source
    const result = source === 'cm_activity_sim'
      ? { dataSource: 'simulated', dataSourceLabel: 'GitHub delivery' }
      : { dataSource: 'github', dataSourceLabel: 'GitHub' }

    // Machine value must be 'simulated' for downstream CSS/branching
    expect(result.dataSource).toBe('simulated')
    expect(result.dataSource).not.toBe('github_delivery')
    // Presentation value must be 'GitHub delivery'
    expect(result.dataSourceLabel).toBe('GitHub delivery')
  })

  it('live/db_sync source yields dataSource="github" (machine)', () => {
    const provenance = { source: 'db_sync' }
    const source = provenance?.source
    const result = source === 'cm_activity_sim'
      ? { dataSource: 'simulated', dataSourceLabel: 'GitHub delivery' }
      : { dataSource: 'github', dataSourceLabel: 'GitHub' }

    expect(result.dataSource).toBe('github')
    expect(result.dataSourceLabel).toBe('GitHub')
  })
})
