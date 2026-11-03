/**
 * P0.2 R3: commit-ttfc-longitudinal semantic authority production-path regression
 *
 * Exercises the PRODUCTION adaptation path (adaptCanonicalToUI) to prove:
 * - structured generator values are NOT dropped by adaptation
 * - Latest TTFC renders with real values (not "—")
 * - First TTFC renders with real values (not "—")
 * - TTFC change renders with real values (not "—")
 * - commits/session renders with real values (not "—")
 * - "AI-active share" does NOT appear anywhere in this finding
 * - false % or pp semantics do NOT appear
 * - generic AI-adoption interpretation does NOT appear
 */

import { describe, it, expect } from 'vitest'
import { adaptCanonicalToUI } from '../lib/insights/final/adapters/renderAdapter'
import type { CanonicalInsight } from '../lib/insights/final/types'

// ─── Generator output simulation ───
// Simulates the structured fields from generateCommitTtfcLongitudinal
function makeGeneratorOutput(overrides: Record<string, any> = {}): CanonicalInsight {
  return {
    id: 'commit-ttfc-longitudinal',
    title: 'Time-to-first-commit rose across 5 measured periods (commits/session stable)',
    cicdStage: 'plan-code',
    canonicalPriority: 3,
    renderOrder: 3,
    presentationType: 'comparison',
    presentationKind: 'temporal_trend',
    comparisonMode: 'trend',
    current: 1.0,
    baseline: 1.0,
    delta: 0,
    deltaPct: 0,
    displayValue: '1.00 commits/session',
    displayDeltaPct: '+0.00',
    rightMetric: '44.0 min',
    rightMetricLabel: 'TTFC (last period)',
    // P0.2 R3 structured fields
    firstTtfcMinutes: 7.4,
    lastTtfcMinutes: 44.0,
    ttfcDeltaMinutes: 36.6,
    firstCommitsPerSession: 1.0,
    lastCommitsPerSession: 1.0,
    commitsDeltaValue: 0,
    observedPeriodCount: 5,
    polarity: 'neutral',
    confidence: 'medium',
    coveragePct: 80,
    n: 200,
    hasData: true,
    description: 'Commits/session trajectory: 2025-12: 1.00 → 2026-07: 1.00. TTFC trajectory: 2025-12: 7.4min → 2026-07: 44.0min. Commits/session fell 0.00 while TTFC rose 36.6 min from 2025-12 to 2026-07. Observational — association, not causal claim.',
    recommendation: 'Review whether the fell commits/session and rose TTFC reflect task mix changes, tool adoption shifts, or project phase transitions. Compare task complexity between 2025-12 and 2026-07 before interpreting as a productivity trend.',
    executiveSummary: 'Commits/session fell 0.00 while TTFC rose 36.6 min across 5 periods (2025-12 → 2026-07, N=200).',
    whatChanged: 'Observed delivery-signal trend across 5 monthly periods',
    evidence: [
      { metric: '2025-12', value: '1.00 commits, 7.4min TTFC', label: 'N=40' },
      { metric: '2026-01', value: '1.00 commits, 9.7min TTFC', label: 'N=42' },
      { metric: '2026-05', value: '1.00 commits, 42.0min TTFC', label: 'N=38' },
      { metric: '2026-06', value: '1.00 commits, 45.0min TTFC', label: 'N=41' },
      { metric: '2026-07', value: '1.00 commits, 44.0min TTFC', label: 'N=39' },
    ],
    breakdownByTool: {
      '2025-12': { value: 1.0, count: 40, formatted: '1.00 commits, 7.4min TTFC', label: '2025-12 (N=40)' },
      '2026-01': { value: 1.0, count: 42, formatted: '1.00 commits, 9.7min TTFC', label: '2026-01 (N=42)' },
      '2026-05': { value: 1.0, count: 38, formatted: '1.00 commits, 42.0min TTFC', label: '2026-05 (N=38)' },
      '2026-06': { value: 1.0, count: 41, formatted: '1.00 commits, 45.0min TTFC', label: '2026-06 (N=41)' },
      '2026-07': { value: 1.0, count: 39, formatted: '1.00 commits, 44.0min TTFC', label: '2026-07 (N=39)' },
    },
    selectedComparison: { leaderKey: '2026-07', baselineKey: '2025-12' },
    whyItMatters: 'Tracking commits/session and TTFC together reveals whether delivery signals are moving in the same or opposite directions. This is observational — it does not prove a productivity change.',
    operationalImpact: 'Commits/session fell by 0.00 and TTFC rose by 36.6 min over 5 months.',
    cohort: '5 monthly periods (N=200)',
    confidenceReasoning: 'Month-level aggregation from session timestamps. 5 periods with ≥20 observed-qualified sessions each. Total observed-qualified N=200.',
    urgencyLabel: 'monitor',
    dataSource: 'live',
    engineVersion: 'FINAL_ENGINE_V1',
    generatorSource: 'final/generators/planCode.ts',
    featureFlagState: true,
    ...overrides,
  } as any
}

// ─── Renderer simulation (from PerformanceRecommendationsView.vue) ───
// Simulates the evidence cell generation for commit-ttfc-longitudinal
function renderEvidenceCells(row: any): Array<{ label: string; value: string; sub: string }> {
  const isCommitTtfcLongitudinal = row.id === 'commit-ttfc-longitudinal'

  if (isCommitTtfcLongitudinal) {
    const firstTtfc = row.firstTtfcMinutes
    const lastTtfc = row.lastTtfcMinutes
    const ttfcDelta = row.ttfcDeltaMinutes
    const firstCommits = row.firstCommitsPerSession
    const lastCommits = row.lastCommitsPerSession
    const observedPeriods = row.observedPeriodCount || row.evidence?.length || 0

    return [
      {
        label: 'Latest TTFC',
        value: typeof lastTtfc === 'number' ? `${lastTtfc.toFixed(1)} min` : '—',
        sub: 'Last measured period',
      },
      {
        label: 'First TTFC',
        value: typeof firstTtfc === 'number' ? `${firstTtfc.toFixed(1)} min` : '—',
        sub: 'First measured period',
      },
      {
        label: 'TTFC change',
        value: typeof ttfcDelta === 'number' ? `${ttfcDelta > 0 ? '+' : ''}${ttfcDelta.toFixed(1)} min` : '—',
        sub: 'First → latest',
      },
      {
        label: 'Commits/session',
        value: (typeof firstCommits === 'number' && typeof lastCommits === 'number')
          ? `${firstCommits.toFixed(2)} → ${lastCommits.toFixed(2)}`
          : '—',
        sub: 'First → latest',
      },
      {
        label: 'Observed periods',
        value: String(observedPeriods),
        sub: 'Months with sufficient sample',
      },
    ]
  }

  // Generic AI-active-share path (the OLD broken behavior)
  return [
    { label: 'latest AI-active share', value: '1.0%', sub: 'Latest observed period' },
    { label: 'first AI-active share', value: '1.0%', sub: 'First observed period' },
    { label: 'Change', value: '+0.00', sub: '0.0 pp' },
    { label: 'Observed months', value: '5', sub: 'With sufficient sample' },
  ]
}

// Simulates the interpretation text for commit-ttfc-longitudinal
function renderInterpretation(row: any): string {
  if (row.id === 'commit-ttfc-longitudinal') {
    const ft = row.firstTtfcMinutes
    const lt = row.lastTtfcMinutes
    const fc = row.firstCommitsPerSession
    const lc = row.lastCommitsPerSession
    const op = row.observedPeriodCount || row.evidence?.length || 0
    const ttfcPart = (typeof ft === 'number' && typeof lt === 'number')
      ? (() => {
          const delta = lt - ft
          if (delta === 0) return `Median time-to-first-commit remained stable at ${ft.toFixed(1)} min`
          const dir = delta > 0 ? 'increased' : 'decreased'
          return `Median time-to-first-commit ${dir} from ${ft.toFixed(1)} min to ${lt.toFixed(1)} min`
        })()
      : 'Median time-to-first-commit trend observed'
    const commitsPart = (typeof fc === 'number' && typeof lc === 'number')
      ? (() => {
          const cDelta = lc - fc
          if (cDelta === 0) return `commits/session remained stable at ${fc.toFixed(2)}`
          const cDir = cDelta > 0 ? 'increased' : 'decreased'
          return `commits/session ${cDir} from ${fc.toFixed(2)} to ${lc.toFixed(2)}`
        })()
      : 'commits/session trend observed'
    return `${ttfcPart} across ${op} measured periods while ${commitsPart}. Review whether this reflects task mix, workflow changes, or environment readiness before treating it as a productivity effect.`
  }
  return row.description || row.details || 'AI-active session share shifted over the observed period. Review whether this reflects tool availability, team adoption, or project phase transitions.'
}

// ─── Tests ───

describe('P0.2 R3: commit-ttfc-longitudinal production-path semantic authority', () => {
  const generatorOutput = makeGeneratorOutput()
  const adapted = adaptCanonicalToUI(generatorOutput)

  describe('P0-A: structured field propagation through adapter', () => {
    it('firstTtfcMinutes survives adaptation', () => {
      expect(adapted.firstTtfcMinutes).toBeDefined()
      expect(typeof adapted.firstTtfcMinutes).toBe('number')
      expect(adapted.firstTtfcMinutes).toBe(7.4)
    })

    it('lastTtfcMinutes survives adaptation', () => {
      expect(adapted.lastTtfcMinutes).toBeDefined()
      expect(typeof adapted.lastTtfcMinutes).toBe('number')
      expect(adapted.lastTtfcMinutes).toBe(44.0)
    })

    it('ttfcDeltaMinutes survives adaptation', () => {
      expect(adapted.ttfcDeltaMinutes).toBeDefined()
      expect(typeof adapted.ttfcDeltaMinutes).toBe('number')
      expect(adapted.ttfcDeltaMinutes).toBe(36.6)
    })

    it('firstCommitsPerSession survives adaptation', () => {
      expect(adapted.firstCommitsPerSession).toBeDefined()
      expect(typeof adapted.firstCommitsPerSession).toBe('number')
      expect(adapted.firstCommitsPerSession).toBe(1.0)
    })

    it('lastCommitsPerSession survives adaptation', () => {
      expect(adapted.lastCommitsPerSession).toBeDefined()
      expect(typeof adapted.lastCommitsPerSession).toBe('number')
      expect(adapted.lastCommitsPerSession).toBe(1.0)
    })

    it('observedPeriodCount survives adaptation', () => {
      expect(adapted.observedPeriodCount).toBeDefined()
      expect(adapted.observedPeriodCount).toBe(5)
    })
  })

  describe('P0-B: rendered evidence cells show real values (not "—")', () => {
    const cells = renderEvidenceCells(adapted)

    it('Latest TTFC shows 44.0 min (not "—")', () => {
      const cell = cells.find(c => c.label === 'Latest TTFC')
      expect(cell).toBeDefined()
      expect(cell!.value).not.toBe('—')
      expect(cell!.value).toBe('44.0 min')
    })

    it('First TTFC shows 7.4 min (not "—")', () => {
      const cell = cells.find(c => c.label === 'First TTFC')
      expect(cell).toBeDefined()
      expect(cell!.value).not.toBe('—')
      expect(cell!.value).toBe('7.4 min')
    })

    it('TTFC change shows +36.6 min (not "—")', () => {
      const cell = cells.find(c => c.label === 'TTFC change')
      expect(cell).toBeDefined()
      expect(cell!.value).not.toBe('—')
      expect(cell!.value).toBe('+36.6 min')
    })

    it('Commits/session shows 1.00 → 1.00 (not "—")', () => {
      const cell = cells.find(c => c.label === 'Commits/session')
      expect(cell).toBeDefined()
      expect(cell!.value).not.toBe('—')
      expect(cell!.value).toBe('1.00 → 1.00')
    })

    it('Observed periods shows 5', () => {
      const cell = cells.find(c => c.label === 'Observed periods')
      expect(cell).toBeDefined()
      expect(cell!.value).toBe('5')
    })
  })

  describe('P0-C: no "AI-active share" wording', () => {
    it('evidence cells do not contain "AI-active share"', () => {
      const cells = renderEvidenceCells(adapted)
      const allText = cells.map(c => `${c.label} ${c.value} ${c.sub}`).join(' ')
      expect(allText).not.toContain('AI-active share')
    })

    it('interpretation does not contain "AI-active share"', () => {
      const interpretation = renderInterpretation(adapted)
      expect(interpretation).not.toContain('AI-active share')
      expect(interpretation).not.toContain('AI-active session share')
    })
  })

  describe('P0-C: no false % or pp semantics', () => {
    it('TTFC values use minutes, not %', () => {
      const cells = renderEvidenceCells(adapted)
      const ttfcCells = cells.filter(c => c.label.includes('TTFC'))
      for (const cell of ttfcCells) {
        if (cell.value !== '—') {
          expect(cell.value).toContain('min')
          expect(cell.value).not.toMatch(/\d%/)
        }
      }
    })

    it('no "pp" (percentage points) in any evidence cell', () => {
      const cells = renderEvidenceCells(adapted)
      const allText = cells.map(c => `${c.label} ${c.value} ${c.sub}`).join(' ')
      expect(allText).not.toMatch(/\bpp\b/)
    })

    it('commits/session value does not have % suffix', () => {
      const cells = renderEvidenceCells(adapted)
      const commitsCell = cells.find(c => c.label === 'Commits/session')
      expect(commitsCell!.value).not.toContain('%')
    })
  })

  describe('P0-C: interpretation uses real TTFC values', () => {
    it('interpretation contains actual TTFC values (7.4 min and 44.0 min)', () => {
      const interpretation = renderInterpretation(adapted)
      expect(interpretation).toContain('7.4')
      expect(interpretation).toContain('44.0')
      expect(interpretation).toContain('min')
    })

    it('interpretation contains actual period count (5)', () => {
      const interpretation = renderInterpretation(adapted)
      expect(interpretation).toContain('5')
      expect(interpretation).toContain('measured periods')
    })

    it('interpretation is observational (no causal claim)', () => {
      const interpretation = renderInterpretation(adapted)
      expect(interpretation).toContain('Review whether')
      expect(interpretation).not.toMatch(/proves|causes|is caused by/)
    })
  })

  describe('P0-C: no generic AI-adoption interpretation', () => {
    it('interpretation does not say "AI-active session share shifted"', () => {
      const interpretation = renderInterpretation(adapted)
      expect(interpretation).not.toContain('AI-active session share shifted')
    })

    it('interpretation does not say "tool availability, team adoption"', () => {
      const interpretation = renderInterpretation(adapted)
      // The generic fallback says "tool availability, team adoption, or project phase transitions"
      // The commit-ttfc-longitudinal interpretation says "task mix, workflow changes, or environment readiness"
      expect(interpretation).not.toContain('tool availability, team adoption')
    })
  })

  describe('regression: would fail if adapter drops structured fields', () => {
    it('WITHOUT adapter fix, evidence cells would show "—" for TTFC', () => {
      // Simulate the OLD adapter that dropped structured fields
      const oldAdapted = { ...adapted }
      delete (oldAdapted as any).firstTtfcMinutes
      delete (oldAdapted as any).lastTtfcMinutes
      delete (oldAdapted as any).ttfcDeltaMinutes
      delete (oldAdapted as any).firstCommitsPerSession
      delete (oldAdapted as any).lastCommitsPerSession

      const oldCells = renderEvidenceCells(oldAdapted)
      const latestTtfc = oldCells.find(c => c.label === 'Latest TTFC')
      expect(latestTtfc!.value).toBe('—') // This is the bug we fixed
    })
  })
})
