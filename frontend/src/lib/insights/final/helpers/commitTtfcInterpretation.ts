/**
 * P0.2 R4: commit-ttfc-longitudinal interpretation semantic authority.
 *
 * Extracted from PerformanceRecommendationsView.vue buildDecisionCard to make
 * the exact visible interpretation path testable without mounting the full
 * Vue component.
 *
 * This is the SINGLE source of truth for the interpretation text shown on
 * commit-ttfc-longitudinal cards. It derives from structured TTFC + commit
 * evidence (not generic AI-active-share language).
 */

export interface CommitTtfcInterpretationInput {
  id: string
  firstTtfcMinutes?: number
  lastTtfcMinutes?: number
  firstCommitsPerSession?: number
  lastCommitsPerSession?: number
  observedPeriodCount?: number
  evidence?: Array<{ metric: string; value: string; label: string }>
}

/**
 * Build the visible Interpretation text for commit-ttfc-longitudinal.
 *
 * Observational language only — no causal claims, no AI-active-share wording,
 * no false % or pp semantics.
 */
export function buildCommitTtfcInterpretation(row: CommitTtfcInterpretationInput): string {
  const ft = row.firstTtfcMinutes
  const lt = row.lastTtfcMinutes
  const fc = row.firstCommitsPerSession
  const lc = row.lastCommitsPerSession
  const op = row.observedPeriodCount || row.evidence?.length || 0

  const ttfcPart = (typeof ft === 'number' && typeof lt === 'number')
    ? (() => {
        const delta = lt - ft
        const direction = delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'remained stable'
        if (delta === 0) {
          return `Median time-to-first-commit remained stable at ${ft.toFixed(1)} min`
        }
        return `Median time-to-first-commit ${direction} from ${ft.toFixed(1)} min to ${lt.toFixed(1)} min`
      })()
    : 'Median time-to-first-commit trend observed'

  const commitsPart = (typeof fc === 'number' && typeof lc === 'number')
    ? (() => {
        const cDelta = lc - fc
        const cDirection = cDelta > 0 ? 'increased' : cDelta < 0 ? 'decreased' : 'remained stable'
        if (cDelta === 0) {
          return `commits/session remained stable at ${fc.toFixed(2)}`
        }
        return `commits/session ${cDirection} from ${fc.toFixed(2)} to ${lc.toFixed(2)}`
      })()
    : 'commits/session trend observed'

  return `${ttfcPart} across ${op} measured periods while ${commitsPart}. Review whether this reflects task mix, workflow changes, or environment readiness before treating it as a productivity effect.`
}
