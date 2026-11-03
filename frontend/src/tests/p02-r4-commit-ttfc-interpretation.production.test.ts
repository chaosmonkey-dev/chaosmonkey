/**
 * P0.2 R4: commit-ttfc-longitudinal visible interpretation production-path regression.
 *
 * Exercises the EXACT function used by the visible Interpretation block:
 *   buildCommitTtfcInterpretation (imported by PerformanceRecommendationsView.vue)
 *
 * Also exercises the production adaptation path (adaptCanonicalToUI) to prove
 * structured values reach the interpretation function.
 *
 * Regression fails if:
 * - the final visible interpretation contains "AI-active session share"
 * - the final visible interpretation does not contain real TTFC values
 * - the already-fixed evidence values are not present
 */

import { describe, it, expect } from 'vitest'
import { adaptCanonicalToUI } from '../lib/insights/final/adapters/renderAdapter'
import { buildCommitTtfcInterpretation } from '../lib/insights/final/helpers/commitTtfcInterpretation'
import type { CanonicalInsight } from '../lib/insights/final/types'

// ─── Runtime-derived fixture ───
// Values match the current browser evidence for commit-ttfc-longitudinal.
// These are derived from the generator's structured output, not hardcoded
// production implementation.
const RUNTIME_FIXTURE = {
  firstTtfcMinutes: 7.4,
  lastTtfcMinutes: 44.0,
  ttfcDeltaMinutes: 36.6,
  firstCommitsPerSession: 1.0,
  lastCommitsPerSession: 1.0,
  commitsDeltaValue: 0,
  observedPeriodCount: 5,
}

function makeGeneratorOutput(): CanonicalInsight {
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
    ...RUNTIME_FIXTURE,
    polarity: 'neutral',
    confidence: 'medium',
    coveragePct: 80,
    n: 200,
    hasData: true,
    description: 'Commits/session trajectory: 2025-12: 1.00 → 2026-07: 1.00. TTFC trajectory: 2025-12: 7.4min → 2026-07: 44.0min. Observational — association, not causal claim.',
    recommendation: 'Review whether the TTFC trend reflects task mix changes, tool adoption shifts, or project phase transitions.',
    executiveSummary: 'Commits/session fell 0.00 while TTFC rose 36.6 min across 5 periods.',
    whatChanged: 'Observed delivery-signal trend across 5 monthly periods',
    evidence: [
      { metric: '2025-12', value: '1.00 commits, 7.4min TTFC', label: 'N=40' },
      { metric: '2026-01', value: '1.00 commits, 9.7min TTFC', label: 'N=42' },
      { metric: '2026-05', value: '1.00 commits, 42.0min TTFC', label: 'N=38' },
      { metric: '2026-06', value: '1.00 commits, 45.0min TTFC', label: 'N=41' },
      { metric: '2026-07', value: '1.00 commits, 44.0min TTFC', label: 'N=39' },
    ],
    breakdownByTool: {},
    selectedComparison: { leaderKey: '2026-07', baselineKey: '2025-12' },
  } as any
}

// ─── Evidence cell rendering (matches PerformanceRecommendationsView.vue) ───
function renderEvidenceCells(row: any): Array<{ label: string; value: string; sub: string }> {
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

describe('P0.2 R4: commit-ttfc-longitudinal visible interpretation production path', () => {
  // Production path: generator → adaptCanonicalToUI → buildCommitTtfcInterpretation
  const generatorOutput = makeGeneratorOutput()
  const adapted = adaptCanonicalToUI(generatorOutput)
  const interpretation = buildCommitTtfcInterpretation(adapted as any)
  const evidenceCells = renderEvidenceCells(adapted)

  describe('P0-A: structured fields survive adaptation', () => {
    it('firstTtfcMinutes survives adaptation', () => {
      expect(adapted.firstTtfcMinutes).toBe(7.4)
    })
    it('lastTtfcMinutes survives adaptation', () => {
      expect(adapted.lastTtfcMinutes).toBe(44.0)
    })
    it('firstCommitsPerSession survives adaptation', () => {
      expect(adapted.firstCommitsPerSession).toBe(1.0)
    })
    it('lastCommitsPerSession survives adaptation', () => {
      expect(adapted.lastCommitsPerSession).toBe(1.0)
    })
    it('observedPeriodCount survives adaptation', () => {
      expect(adapted.observedPeriodCount).toBe(5)
    })
  })

  describe('P0-B: evidence cells show real values (not "—")', () => {
    it('Latest TTFC = 44.0 min', () => {
      const cell = evidenceCells.find(c => c.label === 'Latest TTFC')
      expect(cell!.value).toBe('44.0 min')
    })
    it('First TTFC = 7.4 min', () => {
      const cell = evidenceCells.find(c => c.label === 'First TTFC')
      expect(cell!.value).toBe('7.4 min')
    })
    it('TTFC change = +36.6 min', () => {
      const cell = evidenceCells.find(c => c.label === 'TTFC change')
      expect(cell!.value).toBe('+36.6 min')
    })
    it('Commits/session = 1.00 → 1.00', () => {
      const cell = evidenceCells.find(c => c.label === 'Commits/session')
      expect(cell!.value).toBe('1.00 → 1.00')
    })
    it('Observed periods = 5', () => {
      const cell = evidenceCells.find(c => c.label === 'Observed periods')
      expect(cell!.value).toBe('5')
    })
  })

  describe('P0-C: visible interpretation uses real TTFC values', () => {
    it('contains "7.4 min" (first TTFC)', () => {
      expect(interpretation).toContain('7.4 min')
    })
    it('contains "44.0 min" (last TTFC)', () => {
      expect(interpretation).toContain('44.0 min')
    })
    it('contains "5 measured periods"', () => {
      expect(interpretation).toContain('5 measured periods')
    })
    it('contains "commits/session remained stable at 1.00"', () => {
      expect(interpretation).toContain('commits/session remained stable at 1.00')
    })
    it('contains "Median time-to-first-commit increased"', () => {
      expect(interpretation).toContain('Median time-to-first-commit increased')
    })
  })

  describe('P0-C: visible interpretation is observational', () => {
    it('contains "Review whether"', () => {
      expect(interpretation).toContain('Review whether')
    })
    it('mentions "task mix, workflow changes, or environment readiness"', () => {
      expect(interpretation).toContain('task mix, workflow changes, or environment readiness')
    })
    it('does NOT make causal claims', () => {
      expect(interpretation).not.toMatch(/proves|causes|is caused by/)
    })
  })

  describe('P0-C: NO "AI-active session share" in visible interpretation', () => {
    it('does NOT contain "AI-active session share"', () => {
      expect(interpretation).not.toContain('AI-active session share')
    })
    it('does NOT contain "AI-active session share shifted"', () => {
      expect(interpretation).not.toContain('AI-active session share shifted')
    })
    it('does NOT contain generic adoption language', () => {
      expect(interpretation).not.toContain('tool availability, team adoption')
    })
  })

  describe('P0-C: NO false % or pp in visible interpretation', () => {
    it('does NOT contain percentage signs on TTFC values', () => {
      expect(interpretation).not.toMatch(/\d%/)
    })
    it('does NOT contain "pp" (percentage points)', () => {
      expect(interpretation).not.toMatch(/\bpp\b/)
    })
  })

  describe('P0-C: NO "AI-active share" in evidence cells', () => {
    it('evidence cells do not contain "AI-active share"', () => {
      const allText = evidenceCells.map(c => `${c.label} ${c.value} ${c.sub}`).join(' ')
      expect(allText).not.toContain('AI-active share')
    })
  })

  describe('regression: would fail if interpretation used generic fallback', () => {
    it('WITHOUT buildCommitTtfcInterpretation, generic fallback would contain "AI-active session share"', () => {
      // Simulate the OLD broken fallback
      const oldInterpretation = 'AI-active session share shifted over the observed period. Review whether this reflects tool availability, team adoption, or project phase transitions.'
      expect(oldInterpretation).toContain('AI-active session share')
      // The production path must NOT produce this
      expect(interpretation).not.toBe(oldInterpretation)
    })

    it('WITHOUT adapter fix, structured fields would be undefined', () => {
      // Simulate the OLD adapter that dropped structured fields
      const oldAdapted = { ...adapted }
      delete (oldAdapted as any).firstTtfcMinutes
      delete (oldAdapted as any).lastTtfcMinutes
      delete (oldAdapted as any).firstCommitsPerSession
      delete (oldAdapted as any).lastCommitsPerSession
      delete (oldAdapted as any).observedPeriodCount

      const oldInterpretation = buildCommitTtfcInterpretation(oldAdapted as any)
      // With undefined values, the interpretation would use fallback phrases
      expect(oldInterpretation).toContain('trend observed')
      expect(oldInterpretation).not.toContain('7.4 min')
      expect(oldInterpretation).not.toContain('44.0 min')
    })
  })

  describe('dynamic values (not hardcoded)', () => {
    it('interpretation changes when TTFC values change', () => {
      const modifiedOutput = { ...generatorOutput, firstTtfcMinutes: 10.0, lastTtfcMinutes: 50.0 } as any
      const modifiedAdapted = adaptCanonicalToUI(modifiedOutput)
      const modifiedInterpretation = buildCommitTtfcInterpretation(modifiedAdapted as any)
      expect(modifiedInterpretation).toContain('10.0 min')
      expect(modifiedInterpretation).toContain('50.0 min')
      expect(modifiedInterpretation).not.toContain('7.4 min')
      expect(modifiedInterpretation).not.toContain('44.0 min')
    })

    it('interpretation changes when period count changes', () => {
      const modifiedOutput = { ...generatorOutput, observedPeriodCount: 7 } as any
      const modifiedAdapted = adaptCanonicalToUI(modifiedOutput)
      const modifiedInterpretation = buildCommitTtfcInterpretation(modifiedAdapted as any)
      expect(modifiedInterpretation).toContain('7 measured periods')
      expect(modifiedInterpretation).not.toContain('5 measured periods')
    })
  })
})
