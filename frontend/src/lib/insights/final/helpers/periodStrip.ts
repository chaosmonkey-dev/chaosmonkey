/**
 * Period Strip helper — compact chronological primitive for PI decision cards.
 *
 * CONTRACT:
 * - 2–6 settled period points, left-to-right chronological
 * - Human period labels (e.g. "Apr", "May", "Jun")
 * - Formatted metric values
 * - Compact magnitude cue (0–100 proportional bar width)
 * - Optional neutral directional delta where evidence supports it
 * - No axes/grid/large chart
 * - Mutually exclusive with comparisonRows
 *
 * This is a PRESENTATION helper. It does NOT invent periods, denominators,
 * thresholds, or good/bad judgments. It only formats values already
 * computed by the accepted generator/view-model contract.
 */

export interface PeriodStripPoint {
  periodLabel: string
  value: string
  numericValue: number
  magnitude: number
  delta?: string
  deltaDirection?: 'up' | 'down' | 'flat' | null
}

export interface PeriodStripData {
  label?: string
  points: PeriodStripPoint[]
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Short human month label from a YYYY-MM key (e.g. "2026-04" → "Apr").
 */
export function shortMonthLabel(monthKey: string): string {
  const parts = monthKey.split('-')
  const m = parseInt(parts[1], 10)
  if (m >= 1 && m <= 12) return SHORT_MONTHS[m - 1]
  return monthKey
}

/**
 * Current month key (YYYY-MM) in UTC.
 */
export function getCurrentMonthKey(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Select up to `maxMonths` complete (past) months from a list of month keys,
 * filtered to those with a positive count for the given count field.
 * Returns chronological order (oldest first).
 *
 * @param months  Array of { month, ...countFields } with count_authority = 'observed_rows'
 * @param countField  The field to check for a positive count
 * @param maxMonths  Maximum number of months to return (default 6)
 * @returns Array of month entries in chronological order
 */
export function selectRecentCompleteMonths<T extends Record<string, any>>(
  months: T[],
  countField: keyof T,
  maxMonths = 6
): T[] {
  if (!months || months.length === 0) return []

  const currentMonth = getCurrentMonthKey()

  const eligible = months
    .filter(m => {
      if (!m || typeof m.month !== 'string') return false
      if (m.month >= currentMonth) return false // skip current (incomplete) month
      const count = m[countField]
      return typeof count === 'number' && count > 0
    })
    .sort((a, b) => b.month.localeCompare(a.month)) // descending (most recent first)

  // Take up to maxMonths, then reverse to chronological (oldest first)
  return eligible.slice(0, maxMonths).reverse()
}

/**
 * Build a Period Strip from pre-computed monthly values.
 *
 * @param monthlyValues  Array of { monthKey, value (number) } in chronological order
 * @param formatValue  Formatter for the metric value (e.g. cost, rate, count)
 * @param formatDelta  Formatter for the delta between consecutive periods
 * @param label  Optional label for the strip
 * @returns PeriodStripData if ≥2 points, otherwise undefined
 */
export function buildPeriodStrip(
  monthlyValues: Array<{ monthKey: string; value: number }>,
  formatValue: (v: number) => string,
  formatDelta: (diff: number) => string,
  label?: string
): PeriodStripData | undefined {
  if (!monthlyValues || monthlyValues.length < 2) return undefined

  const maxVal = Math.max(...monthlyValues.map(p => p.value))
  const minVal = Math.min(...monthlyValues.map(p => p.value))
  const range = maxVal - minVal

  const points: PeriodStripPoint[] = monthlyValues.map((p, i) => {
    // Magnitude: proportional bar width. If all values are equal, use 100.
    // Otherwise scale relative to max.
    const magnitude = maxVal > 0 ? (p.value / maxVal) * 100 : 0

    let delta: string | undefined
    let deltaDirection: 'up' | 'down' | 'flat' | null = null

    if (i > 0) {
      const prev = monthlyValues[i - 1]
      const diff = p.value - prev.value
      if (range === 0 || Math.abs(diff) < 0.001) {
        delta = '—'
        deltaDirection = 'flat'
      } else {
        delta = formatDelta(diff)
        deltaDirection = diff > 0 ? 'up' : 'down'
      }
    }

    return {
      periodLabel: shortMonthLabel(p.monthKey),
      value: formatValue(p.value),
      numericValue: p.value,
      magnitude,
      delta,
      deltaDirection,
    }
  })

  return { label, points }
}

/**
 * Evidence-cell copy for the "Observed periods" metric on the
 * monthly-workflow-share longitudinal card.
 *
 * An in-progress partial month is context, not a completed comparison
 * period: when present it must be labeled separately and must never be
 * folded into the period count that drove the conclusion.
 */
export function periodCountEvidenceCell(insight: {
  hasPartialCurrentPeriod?: boolean;
  completePeriodCount?: number;
  evidence?: Array<unknown>;
}): { value: string; sub: string } {
  if (insight.hasPartialCurrentPeriod) {
    return {
      value: `${insight.completePeriodCount} complete + 1 partial`,
      sub: 'Complete months; current partial month shown for context',
    };
  }
  return {
    value: String(insight.completePeriodCount ?? insight.evidence?.length ?? 0),
    sub: 'Months with sufficient sample',
  };
}

/**
 * Inline claim-phrase variant of the same contract, e.g.
 * "3 complete periods (+1 partial)" or "3 observed periods".
 */
export function periodCountClaimPhrase(insight: {
  hasPartialCurrentPeriod?: boolean;
  completePeriodCount?: number;
  evidence?: Array<unknown>;
}): string {
  if (insight.hasPartialCurrentPeriod) {
    return `${insight.completePeriodCount} complete periods (+1 partial)`;
  }
  return `${insight.completePeriodCount ?? insight.evidence?.length ?? 0} observed periods`;
}
