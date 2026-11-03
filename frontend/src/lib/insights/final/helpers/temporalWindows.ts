/**
 * CR-X P1B.2 Wave 1 — Adaptive Temporal Window Selection
 *
 * Selects truthful comparison windows based on OBSERVED data density, not
 * browser wall-clock time. Anchors to the max authoritative observed timestamp.
 *
 * CONTRACT:
 * - Observed-time authority: windows anchor to max observed timestamp, NEVER Date.now()
 * - Sparse-window safety: a zero/sparse interval caused by missing telemetry
 *   must NOT be interpreted as an operational decline
 * - "Observed days" (data-bearing periods) matter more than empty calendar intervals
 *
 * Window policy (adaptive, based on observed history depth):
 *   <3 observed days:  no temporal comparison (return null)
 *   ~3-14 days:        recent sufficient interval vs preceding sufficient interval
 *   ~14-30 days:       recent 7 observed days vs prior 7 observed days
 *   ~30-90 days:       recent week vs meaningful preceding baseline
 *   mature multi-month: recent 14d vs prior 14d
 */

export interface TemporalWindow {
  startMs: number;
  endMs: number;
}

export interface ComparisonWindows {
  recent: TemporalWindow;
  prior: TemporalWindow;
  label: string;           // human-readable comparison basis, e.g. "recent 7d vs prior 7d"
  recentLabel: string;     // e.g. "recent 7 days"
  priorLabel: string;      // e.g. "prior 7 days"
  observedThroughMs: number; // the max observed timestamp (anchor)
  historyDays: number;     // observed span in days
}

const DAY_MS = 86400000;

/**
 * Compute the max observed timestamp from session rows.
 * This is the OBSERVED-TIME AUTHORITY — never use Date.now().
 */
export function getObservedThroughMs(sessionRows: any[]): number {
  let max = 0;
  for (const s of sessionRows) {
    const ts = s.timestamp ?? s.session_start ?? s.created_at;
    if (!ts) continue;
    const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
    if (Number.isFinite(ms) && ms > max) max = ms;
  }
  return max;
}

/**
 * Compute the min observed timestamp from session rows.
 */
export function getObservedFromMs(sessionRows: any[]): number {
  let min = Infinity;
  for (const s of sessionRows) {
    const ts = s.timestamp ?? s.session_start ?? s.created_at;
    if (!ts) continue;
    const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
    if (Number.isFinite(ms) && ms < min) min = ms;
  }
  return min === Infinity ? 0 : min;
}

/**
 * Count the number of data-bearing (observed) days in the session data.
 * This counts distinct calendar days that have at least one session,
 * NOT the wall-clock span between min and max.
 */
export function countObservedDays(sessionRows: any[]): number {
  const days = new Set<string>();
  for (const s of sessionRows) {
    const ts = s.timestamp ?? s.session_start ?? s.created_at;
    if (!ts) continue;
    const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
    if (!Number.isFinite(ms)) continue;
    days.add(new Date(ms).toISOString().split('T')[0]);
  }
  return days.size;
}

/**
 * Select adaptive comparison windows based on observed data density.
 *
 * Returns null if there is insufficient observed history for any
 * temporal comparison (< 3 observed days).
 */
export function selectComparisonWindows(sessionRows: any[]): ComparisonWindows | null {
  if (!sessionRows || sessionRows.length === 0) return null;

  const observedThrough = getObservedThroughMs(sessionRows);
  if (observedThrough <= 0) return null;

  const observedFrom = getObservedFromMs(sessionRows);
  if (observedFrom <= 0) return null;

  const observedDays = countObservedDays(sessionRows);
  if (observedDays < 3) return null;

  // Wall-clock span (for window sizing, but observed days are the authority)
  const wallClockSpanDays = (observedThrough - observedFrom) / DAY_MS;

  // ── Window selection by observed data density ──────────────────────

  if (observedDays < 14) {
    // Very early: recent sufficient interval vs immediately preceding sufficient interval
    // Split the observed history in half: recent = second half, prior = first half
    const midpoint = observedFrom + (observedThrough - observedFrom) / 2;
    return {
      recent: { startMs: midpoint, endMs: observedThrough },
      prior: { startMs: observedFrom, endMs: midpoint },
      label: 'recent vs preceding period',
      recentLabel: 'the last period',
      priorLabel: 'the preceding period',
      observedThroughMs: observedThrough,
      historyDays: observedDays,
    };
  }

  if (observedDays < 30) {
    // ~2-4 weeks: recent 7 observed days vs prior 7 observed days
    const recentStart = observedThrough - 7 * DAY_MS;
    const priorStart = recentStart - 7 * DAY_MS;
    // Guard: if prior window would go before observed data, shrink to available
    if (priorStart < observedFrom) {
      // Fall back to half-split if not enough data for two 7-day windows
      const midpoint = observedFrom + (observedThrough - observedFrom) / 2;
      return {
        recent: { startMs: midpoint, endMs: observedThrough },
        prior: { startMs: observedFrom, endMs: midpoint },
        label: 'recent vs preceding period',
        recentLabel: 'recent period',
        priorLabel: 'preceding period',
        observedThroughMs: observedThrough,
        historyDays: observedDays,
      };
    }
    return {
      recent: { startMs: recentStart, endMs: observedThrough },
      prior: { startMs: priorStart, endMs: recentStart },
      label: 'the last 7 days vs the prior 7 days',
      recentLabel: 'the last 7 days',
      priorLabel: 'the prior 7 days',
      observedThroughMs: observedThrough,
      historyDays: observedDays,
    };
  }

  if (observedDays < 90) {
    // ~30-90 days: recent week vs meaningful preceding baseline (prior 21 days)
    const recentStart = observedThrough - 7 * DAY_MS;
    const priorStart = recentStart - 21 * DAY_MS;
    if (priorStart < observedFrom) {
      // Fall back: use available preceding data
      return {
        recent: { startMs: recentStart, endMs: observedThrough },
        prior: { startMs: observedFrom, endMs: recentStart },
        label: 'the last week vs the preceding baseline',
        recentLabel: 'the last week',
        priorLabel: 'the preceding baseline',
        observedThroughMs: observedThrough,
        historyDays: observedDays,
      };
    }
    return {
      recent: { startMs: recentStart, endMs: observedThrough },
      prior: { startMs: priorStart, endMs: recentStart },
        label: 'the last week vs the prior 3 weeks',
        recentLabel: 'the last week',
        priorLabel: 'the prior 3 weeks',
      observedThroughMs: observedThrough,
      historyDays: observedDays,
    };
  }

  // Mature multi-month: recent 14d vs prior 14d
  const recentStart = observedThrough - 14 * DAY_MS;
  const priorStart = recentStart - 14 * DAY_MS;
  return {
    recent: { startMs: recentStart, endMs: observedThrough },
    prior: { startMs: priorStart, endMs: recentStart },
    label: 'the last 2 weeks vs the prior 2 weeks',
    recentLabel: 'the last 2 weeks',
    priorLabel: 'the prior 2 weeks',
    observedThroughMs: observedThrough,
    historyDays: observedDays,
  };
}

/**
 * Check if a session row falls within a temporal window.
 */
export function isInWindow(row: any, window: TemporalWindow): boolean {
  const ts = row.timestamp ?? row.session_start ?? row.created_at;
  if (!ts) return false;
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms >= window.startMs && ms < window.endMs;
}

/**
 * Sparse-window safety: check if a window has adequate data density.
 * A window with fewer than minSessions is considered sparse/empty and
 * must NOT be used for comparison (to prevent fake declines).
 */
export function isWindowAdequatelyPopulated(
  rows: any[],
  window: TemporalWindow,
  minSessions: number
): boolean {
  let count = 0;
  for (const r of rows) {
    if (isInWindow(r, window)) {
      count++;
      if (count >= minSessions) return true;
    }
  }
  return count >= minSessions;
}
