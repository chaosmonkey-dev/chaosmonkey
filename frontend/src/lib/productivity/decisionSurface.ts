/**
 * PBT Decision Surface helpers
 *
 * Pure functions that turn the existing weekly-bucketed PBT time series into
 * engineering-leader decision signals. No new data sources — these operate on
 * the same `timeSeriesData` series/points already produced by the canonical
 * telemetry path (metricsFacade → useTimeSeries).
 *
 * Contracts respected:
 *  - The current (partial) week is NEVER used as a completed WoW comparison period.
 *  - Missing instrumentation is never rendered as a zero series.
 *  - Language is neutral/factual; no causal or "winner" claims.
 */

export interface WeeklyPoint {
  /** ISO week-start timestamp (e.g. "2026-07-07") */
  t: string
  /** Metric value for the selected metric, or null when missing/non-finite */
  value: number | null
  /** Session count for this week (point.session_count) */
  sessionCount: number | null
}

export interface CompleteWeekComparison {
  /** Latest completed-week value (session-weighted), or null */
  latestValue: number | null
  /** Previous completed-week value (session-weighted), or null */
  previousValue: number | null
  /** Sessions supporting the latest completed week */
  latestSessions: number
  /** Sessions supporting the previous completed week */
  previousSessions: number
  /** Absolute delta (latest - previous), or null when not computable */
  absoluteDelta: number | null
  /** Percentage delta, or null when not computable (previous is 0/null) */
  percentDelta: number | null
  /** True only when both complete weeks have finite values */
  hasEnoughData: boolean
}

/**
 * Return the ISO date (YYYY-MM-DD) of the Monday starting the week containing
 * `date`. Weeks are Monday-Sunday. Falls back to the input date on parse error.
 */
export function weekStartISO(date: Date = new Date()): string {
  const d = new Date(date)
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0]
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString().split('T')[0]
}

/**
 * Determine whether a point's week-start timestamp corresponds to the current
 * (still in-progress) week. A week is partial when "today" falls within
 * [weekStart, weekStart + 7 days).
 */
export function isCurrentWeekPartial(pointT: string, now: Date = new Date()): boolean {
  if (!pointT) return false
  const start = new Date(pointT)
  if (isNaN(start.getTime())) return false
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 7)
  return now.getTime() >= start.getTime() && now.getTime() < end.getTime()
}

/**
 * Extract the weekly point series for a single workflow, resolving the metric
 * value via the provided point-field name. Non-finite values become null
 * (never 0).
 */
export function extractWeeklyPoints(
  series: { points?: any[] } | null | undefined,
  pointField: string
): WeeklyPoint[] {
  if (!series || !Array.isArray(series.points)) return []
  return series.points.map((p: any) => {
    const raw = p?.[pointField]
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
    const sc = p?.session_count
    return {
      t: p?.t ?? '',
      value,
      sessionCount: typeof sc === 'number' && Number.isFinite(sc) ? sc : null,
    }
  })
}

/**
 * Session-weighted average of a set of weekly points (finite values only).
 * Returns null when no eligible points exist. Matches the canonical metric
 * authority weighting convention (session_count as weight).
 */
export function sessionWeightedAverage(points: WeeklyPoint[]): number | null {
  let numerator = 0
  let denominator = 0
  for (const p of points) {
    if (p.value === null) continue
    const w = p.sessionCount !== null && p.sessionCount > 0 ? p.sessionCount : 0
    numerator += p.value * (w > 0 ? w : 1)
    denominator += w > 0 ? w : 1
  }
  return denominator > 0 ? numerator / denominator : null
}

/**
 * Compare the latest COMPLETED week against the previous COMPLETED week.
 *
 * The current partial week (if present) is excluded from the comparison. Each
 * "week" is a single weekly bucket, so the value used is the bucket's own
 * metric value (already an aggregate for that week). Sessions are summed from
 * the bucket's session_count.
 */
export function compareCompleteWeeks(
  points: WeeklyPoint[],
  now: Date = new Date()
): CompleteWeekComparison {
  const empty: CompleteWeekComparison = {
    latestValue: null,
    previousValue: null,
    latestSessions: 0,
    previousSessions: 0,
    absoluteDelta: null,
    percentDelta: null,
    hasEnoughData: false,
  }

  if (!points || points.length === 0) return empty

  // Sort chronologically by week start
  const sorted = [...points].sort(
    (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime()
  )

  // Drop the current partial week from the tail for comparison purposes
  let lastIdx = sorted.length - 1
  while (lastIdx >= 0 && isCurrentWeekPartial(sorted[lastIdx].t, now)) {
    lastIdx--
  }
  if (lastIdx < 0) return empty

  const latest = sorted[lastIdx]
  const previous = lastIdx - 1 >= 0 ? sorted[lastIdx - 1] : null

  const latestValue = latest.value
  const previousValue = previous ? previous.value : null
  const latestSessions = latest.sessionCount ?? 0
  const previousSessions = previous?.sessionCount ?? 0

  let absoluteDelta: number | null = null
  let percentDelta: number | null = null
  let hasEnoughData = false

  if (
    latestValue !== null &&
    previousValue !== null &&
    Number.isFinite(latestValue) &&
    Number.isFinite(previousValue)
  ) {
    absoluteDelta = latestValue - previousValue
    if (previousValue !== 0) {
      percentDelta = ((latestValue - previousValue) / Math.abs(previousValue)) * 100
    }
    hasEnoughData = true
  }

  return {
    latestValue,
    previousValue,
    latestSessions,
    previousSessions,
    absoluteDelta,
    percentDelta,
    hasEnoughData,
  }
}

/**
 * Build the neutral "what changed" summary string.
 *
 * Never claims good/bad or causation. Uses absolute or percentage delta as
 * appropriate (percentage is suppressed when it would be misleading, e.g. when
 * the previous value was 0 or the percentage exceeds a sane bound).
 */
export function buildWhatChangedSummary(
  metricLabel: string,
  cmp: CompleteWeekComparison,
  formatValue: (v: number) => string
): string {
  if (!cmp.hasEnoughData) {
    return 'Not enough complete-week data to calculate a trend.'
  }

  const latest = cmp.latestValue!
  const previous = cmp.previousValue!
  const latestStr = formatValue(latest)
  const previousStr = formatValue(previous)

  const direction = cmp.absoluteDelta! > 0
    ? 'increased'
    : cmp.absoluteDelta! < 0
      ? 'decreased'
      : 'held steady'

  // Use percentage when it is meaningful and bounded; otherwise absolute.
  const PERCENT_CAP = 200
  let changePhrase: string
  if (cmp.percentDelta !== null && Math.abs(cmp.percentDelta) <= PERCENT_CAP) {
    const pct = Math.abs(cmp.percentDelta).toFixed(0)
    changePhrase = cmp.absoluteDelta === 0
      ? `held steady at ${latestStr}`
      : `${direction} ${pct}% (${previousStr} → ${latestStr})`
  } else {
    const absStr = formatValue(Math.abs(cmp.absoluteDelta!))
    changePhrase = cmp.absoluteDelta === 0
      ? `held steady at ${latestStr}`
      : `${direction} by ${absStr} (${previousStr} → ${latestStr})`
  }

  return `${metricLabel} ${changePhrase} across the last two complete weeks. ` +
    `${cmp.latestSessions} sessions (latest) vs ${cmp.previousSessions} sessions (previous).`
}

/**
 * Build the concise scope summary line shown above the chart.
 *
 * Example: "VS Code · Rework · Last 4 complete weeks · All repos · 1,100 sessions"
 */
export function buildScopeSummary(params: {
  workflowLabel: string
  metricLabel: string
  timeRangeLabel: string
  repoLabel: string
  sessionCount: number
}): string {
  const { workflowLabel, metricLabel, timeRangeLabel, repoLabel, sessionCount } = params
  const sessionStr = sessionCount.toLocaleString()
  return `${workflowLabel} · ${metricLabel} · ${timeRangeLabel} · ${repoLabel} · ${sessionStr} sessions`
}
