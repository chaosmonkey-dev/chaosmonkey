/**
 * CR-X PI percentile renderer truth regression.
 *
 * Matt's browser acceptance caught a defect in the VS Code session-tail PI:
 *
 *   Visible card: "VS Code's longest 10% of sessions exceed 2.0 hours"
 *   Tiles: VSCODE_P90 = 2.0 hours, VSCODE_P50 = 22 min, DIFFERENCE = 97.3
 *   But the DIFFERENCE sublabel said "Median (p50)" — semantically wrong.
 *
 * Root cause: the generator sets presentationKind='distribution_shape' but
 * the renderer had no dedicated case for it. The insight fell into the
 * legacy workflow-comparison path, which treated p50/p90 breakdown entries
 * as two separate "workflows", computed a naked delta (97.3) with no unit,
 * and fell back to cleanMetricLabel ("Median (p50)") as the sub label.
 *
 * Fix: a dedicated distribution_shape case in buildDecisionCard that builds
 * evidence cells directly from generator fields with truthful units and
 * a correct "p90 − p50" semantic label.
 *
 * This is a source-level regression test because buildDecisionCard is a
 * module-scope function inside a <script setup> SFC and is not exported.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { generateWorkflowSessionDistribution } from '../lib/insights/final/generators/planCode'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

describe('CR-X PI percentile renderer: distribution_shape unit and semantic truth', () => {
  const componentPath = path.resolve(__dirname, '../components/PerformanceRecommendationsView.vue')
  const source = fs.readFileSync(componentPath, 'utf-8')

  // ─── Generator-level: source values are in minutes ───────────────
  function mkSession(overrides: Partial<any> = {}): any {
    return {
      session_id: `s-${Math.random().toString(36).slice(2)}`,
      tool: 'vscode',
      timestamp: '2026-07-15T10:00:00.000000Z',
      duration_ms: 600000,
      active_coding_duration_ms: 300000,
      ai_burst_count: 0,
      session_duration_minutes: 10,
      session_active_coding_duration_minutes: 5,
      session_has_ai_activity: false,
      file_save_count: 3,
      git_repo_url: 'https://github.com/test/repo.git',
      ...overrides,
    }
  }

  function ti(sessionRows: any[]): CanonicalInsightInput {
    return { sessionRows, granularity: 'month' } as any
  }

  it('generator produces current=p90 (min), baseline=p50 (min), delta=p90-p50 (min)', () => {
    // 100 sessions: 80 at 22.7 min, 20 at 120 min
    // p50 ≈ 22.7, p90 ≈ 120, delta ≈ 97.3
    const sessions: any[] = []
    for (let i = 0; i < 80; i++) sessions.push(mkSession({
      session_duration_minutes: 22.7, duration_ms: 22.7 * 60000,
    }))
    for (let i = 0; i < 20; i++) sessions.push(mkSession({
      session_duration_minutes: 120, duration_ms: 120 * 60000,
    }))

    const result = generateWorkflowSessionDistribution(ti(sessions))
    expect(result).not.toBeNull()
    expect(Array.isArray(result)).toBe(true)
    const instance = result![0]

    // current = p90 in minutes
    expect(typeof instance.current).toBe('number')
    expect(instance.current).toBeCloseTo(120, 0)

    // baseline = p50 in minutes
    expect(typeof instance.baseline).toBe('number')
    expect(instance.baseline).toBeCloseTo(22.7, 0)

    // delta = p90 - p50 in minutes
    expect(typeof instance.delta).toBe('number')
    expect(instance.delta).toBeCloseTo(97.3, 0)

    // rightMetricLabel is "Median (p50)" — this is the p50 tile label, NOT the difference label
    expect(instance.rightMetricLabel).toBe('Median (p50)')

    // presentationKind is distribution_shape
    expect((instance as any).presentationKind).toBe('distribution_shape')
  })

  // ─── Renderer-level: source-level proof of the fix ───────────────

  it('renderer has a dedicated distribution_shape case in the card type logic', () => {
    expect(source).toContain("presentationKind === 'distribution_shape'")
  })

  it('renderer routes distribution_shape to neutral card type (not workflow-comparison)', () => {
    // Find the distribution_shape branch in the card type logic
    const distShapeMatch = source.match(
      /else if \(presentationKind === 'distribution_shape'\)[\s\S]*?cardType = 'neutral'/
    )
    expect(distShapeMatch).not.toBeNull()
    expect(distShapeMatch![0]).toContain("cardType = 'neutral'")
  })

  it('renderer builds a dedicated distribution_shape evidence block in the default case', () => {
    // The default case must check presentationKind === 'distribution_shape'
    // and build evidence cells with p90, p50, Difference, and p90/p50 ratio.
    const defaultBlockMatch = source.match(
      /default: \{[\s\S]*?presentationKind === 'distribution_shape'[\s\S]*?break/
    )
    expect(defaultBlockMatch).not.toBeNull()
    const block = defaultBlockMatch![0]

    // Must have a Difference tile
    expect(block).toContain("'Difference'")

    // Difference value must use deltaFormatted (which includes min or hours unit)
    expect(block).toContain('deltaFormatted')

    // Difference sub must be 'p90 − p50' (the correct semantic label)
    expect(block).toContain('p90 − p50')

    // Must NOT use 'Median (p50)' as the Difference sub label
    // (it can appear as the p50 tile label, but not as the difference sub)
    const diffTileMatch = block.match(
      /label:\s*'Difference'[\s\S]*?sub:\s*'([^']*)'/
    )
    expect(diffTileMatch).not.toBeNull()
    const diffSub = diffTileMatch![1]
    expect(diffSub).toBe('p90 − p50')
    expect(diffSub).not.toBe('Median (p50)')
  })

  it('difference value includes a time unit (min or hours), not a naked number', () => {
    const defaultBlockMatch = source.match(
      /default: \{[\s\S]*?presentationKind === 'distribution_shape'[\s\S]*?break/
    )
    expect(defaultBlockMatch).not.toBeNull()
    const block = defaultBlockMatch![0]

    // deltaFormatted must branch on >= 60 to produce "hours" or "min"
    expect(block).toMatch(/deltaMin\s*>=\s*60/)
    expect(block).toMatch(/hours/)
    expect(block).toMatch(/min/)
  })

  it('claim includes unit-bearing summary (p90 vs p50 · gap)', () => {
    const defaultBlockMatch = source.match(
      /default: \{[\s\S]*?presentationKind === 'distribution_shape'[\s\S]*?break/
    )
    expect(defaultBlockMatch).not.toBeNull()
    const block = defaultBlockMatch![0]

    // Claim must include p90Display, p50Display, and deltaFormatted
    expect(block).toMatch(/claim\s*=/)
    expect(block).toContain('p90Display')
    expect(block).toContain('p50Display')
    expect(block).toContain('deltaFormatted')
    expect(block).toContain('gap')
  })
})
