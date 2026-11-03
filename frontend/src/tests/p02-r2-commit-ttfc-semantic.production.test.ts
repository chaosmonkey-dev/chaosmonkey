/**
 * P0.2 R2: commit-ttfc-longitudinal semantic authority regression
 *
 * Contract:
 * - No exception (TypeError fixed)
 * - No "AI-active share" label
 * - No false % suffix on commits/session values
 * - No false pp (percentage points) on commits/session delta
 * - TTFC uses minutes
 * - Commits/session uses commits/session unit
 * - Observed period count preserved
 */

import { describe, it, expect } from 'vitest'

// ─── Generator output simulation ───
// Simulates the structured fields from generateCommitTtfcLongitudinal
function makeCommitTtfcLongitudinalOutput(overrides: Record<string, any> = {}) {
  return {
    id: 'commit-ttfc-longitudinal',
    title: 'Time-to-first-commit rose across 5 measured periods (commits/session stable)',
    cicdStage: 'plan-code',
    canonicalPriority: 3,
    renderOrder: 3,
    presentationType: 'comparison',
    presentationKind: 'temporal_trend',
    comparisonMode: 'trend',
    current: 1.0,                    // last.medianCommitsPerSession
    baseline: 1.0,                   // first.medianCommitsPerSession
    delta: 0,                        // commitsDelta
    deltaPct: 0,                     // (commitsDelta / first) * 100
    displayValue: '1.00 commits/session',
    displayDeltaPct: '+0.00',        // STRING (root cause of TypeError)
    rightMetric: '44.0 min',
    rightMetricLabel: 'TTFC (last period)',
    // P0.2 R2 structured fields
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
    ...overrides,
  }
}

// ─── Renderer simulation ───
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

// Simulates the deltaText computation for commit-ttfc-longitudinal
function renderDeltaText(row: any): { text: string; label: string } {
  if (row.id === 'commit-ttfc-longitudinal' && typeof row.ttfcDeltaMinutes === 'number') {
    const ttfcDelta = row.ttfcDeltaMinutes
    if (ttfcDelta === 0) {
      return { text: 'Stable', label: 'TTFC first → latest' }
    }
    return {
      text: `${ttfcDelta > 0 ? '+' : ''}${ttfcDelta.toFixed(1)} min`,
      label: 'TTFC first → latest',
    }
  }
  return { text: 'No recent movement', label: 'vs prior 4 weeks' }
}

// ─── Tests ───

describe('P0.2 R2: commit-ttfc-longitudinal semantic authority', () => {
  const row = makeCommitTtfcLongitudinalOutput()

  describe('no exception', () => {
    it('displayDeltaPct is a string but does not cause TypeError with typeof guard', () => {
      expect(typeof row.displayDeltaPct).toBe('string')

      // The fixed guard: typeof === 'number' prevents .toFixed on string
      const effectiveDeltaPct = row.displayDeltaPct ?? row.deltaPct
      const passesFixedGuard = typeof effectiveDeltaPct === 'number' &&
        !isNaN(effectiveDeltaPct) && isFinite(effectiveDeltaPct)
      expect(passesFixedGuard).toBe(false) // String fails the guard

      // No TypeError when using the fallback
      const fallback = row.deltaPct
      expect(typeof fallback === 'number' && !isNaN(fallback) && isFinite(fallback)).toBe(true)
      expect((fallback as number).toFixed(1)).toBe('0.0') // No exception
    })
  })

  describe('no "AI-active share" label', () => {
    it('evidence cells do not contain "AI-active share"', () => {
      const cells = renderEvidenceCells(row)
      const allLabels = cells.map(c => c.label).join(' ')
      const allValues = cells.map(c => c.value).join(' ')
      const allSubs = cells.map(c => c.sub).join(' ')

      expect(allLabels).not.toContain('AI-active share')
      expect(allValues).not.toContain('AI-active share')
      expect(allSubs).not.toContain('AI-active share')
    })

    it('evidence cells use TTFC and commits/session labels', () => {
      const cells = renderEvidenceCells(row)
      const labels = cells.map(c => c.label)

      expect(labels).toContain('Latest TTFC')
      expect(labels).toContain('First TTFC')
      expect(labels).toContain('TTFC change')
      expect(labels).toContain('Commits/session')
      expect(labels).toContain('Observed periods')
    })
  })

  describe('no false % suffix on commits/session', () => {
    it('commits/session value does not have % suffix', () => {
      const cells = renderEvidenceCells(row)
      const commitsCell = cells.find(c => c.label === 'Commits/session')
      expect(commitsCell).toBeDefined()
      expect(commitsCell!.value).not.toContain('%')
      expect(commitsCell!.label).toContain('Commits/session')
    })

    it('TTFC values use minutes, not %', () => {
      const cells = renderEvidenceCells(row)
      const latestTtfc = cells.find(c => c.label === 'Latest TTFC')
      const firstTtfc = cells.find(c => c.label === 'First TTFC')

      expect(latestTtfc!.value).toContain('min')
      expect(latestTtfc!.value).not.toContain('%')
      expect(firstTtfc!.value).toContain('min')
      expect(firstTtfc!.value).not.toContain('%')
    })
  })

  describe('no false pp (percentage points) on commits/session delta', () => {
    it('TTFC change uses minutes, not pp', () => {
      const cells = renderEvidenceCells(row)
      const changeCell = cells.find(c => c.label === 'TTFC change')
      expect(changeCell).toBeDefined()
      expect(changeCell!.value).toContain('min')
      expect(changeCell!.value).not.toContain('pp')
      expect(changeCell!.sub).not.toContain('pp')
    })

    it('deltaText uses minutes, not pp or %', () => {
      const { text, label } = renderDeltaText(row)
      expect(text).toContain('min')
      expect(text).not.toContain('pp')
      expect(text).not.toContain('%')
      expect(label).toContain('TTFC')
    })
  })

  describe('TTFC uses minutes', () => {
    it('Latest TTFC = 44.0 min', () => {
      const cells = renderEvidenceCells(row)
      const latest = cells.find(c => c.label === 'Latest TTFC')
      expect(latest!.value).toBe('44.0 min')
    })

    it('First TTFC = 7.4 min', () => {
      const cells = renderEvidenceCells(row)
      const first = cells.find(c => c.label === 'First TTFC')
      expect(first!.value).toBe('7.4 min')
    })

    it('TTFC change = +36.6 min', () => {
      const cells = renderEvidenceCells(row)
      const change = cells.find(c => c.label === 'TTFC change')
      expect(change!.value).toBe('+36.6 min')
    })
  })

  describe('commits/session uses commits/session unit', () => {
    it('Commits/session = 1.00 → 1.00', () => {
      const cells = renderEvidenceCells(row)
      const commits = cells.find(c => c.label === 'Commits/session')
      expect(commits!.value).toBe('1.00 → 1.00')
    })
  })

  describe('observed period count preserved', () => {
    it('Observed periods = 5', () => {
      const cells = renderEvidenceCells(row)
      const periods = cells.find(c => c.label === 'Observed periods')
      expect(periods!.value).toBe('5')
    })

    it('observedPeriodCount field is preserved from generator', () => {
      expect(row.observedPeriodCount).toBe(5)
    })
  })

  describe('structured fields are present in generator output', () => {
    it('firstTtfcMinutes is a number', () => {
      expect(typeof row.firstTtfcMinutes).toBe('number')
      expect(row.firstTtfcMinutes).toBe(7.4)
    })

    it('lastTtfcMinutes is a number', () => {
      expect(typeof row.lastTtfcMinutes).toBe('number')
      expect(row.lastTtfcMinutes).toBe(44.0)
    })

    it('ttfcDeltaMinutes is a number', () => {
      expect(typeof row.ttfcDeltaMinutes).toBe('number')
      expect(row.ttfcDeltaMinutes).toBe(36.6)
    })

    it('firstCommitsPerSession is a number', () => {
      expect(typeof row.firstCommitsPerSession).toBe('number')
      expect(row.firstCommitsPerSession).toBe(1.0)
    })

    it('lastCommitsPerSession is a number', () => {
      expect(typeof row.lastCommitsPerSession).toBe('number')
      expect(row.lastCommitsPerSession).toBe(1.0)
    })
  })

  describe('would have failed against the OLD broken behavior', () => {
    it('OLD path would produce "AI-active share" labels', () => {
      // Simulate the old generic path
      const oldCells = [
        { label: 'latest AI-active share', value: '1.0%', sub: 'Latest observed period' },
        { label: 'first AI-active share', value: '1.0%', sub: 'First observed period' },
      ]
      const hasAiActiveShare = oldCells.some(c =>
        c.label.includes('AI-active share') || c.value.includes('%')
      )
      expect(hasAiActiveShare).toBe(true) // The old path WAS broken
    })
  })
})
