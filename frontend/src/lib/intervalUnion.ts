/**
 * Interval-Union Utility
 *
 * Computes time semantics from session intervals.
 *
 * Three distinct time semantics:
 * - agent_compute_time: Σ(duration_ms) across sessions — row-additive, unchanged
 * - developer_elapsed_time: union of [start, end] intervals per developer
 * - unique_session_wall_clock_span: union of ALL session intervals (not per-developer)
 *
 * CR-X 2026-08-30 — Concurrency semantics:
 * - additive_agent_runtime = Σ(duration_ms) — same as agent_compute_time
 * - unique_session_wall_clock_span = UNION(all session intervals)
 * - parallelism_factor = additive_agent_runtime / unique_session_wall_clock_span
 * - overlapping_session_count = number of session pairs that overlap
 * - sessions_in_overlap = number of sessions participating in ≥1 overlap
 * - max_concurrent_sessions = maximum number of sessions active at any instant
 *
 * IMPORTANT SEMANTICS (CR-X 2026-08-30):
 * Do NOT call unique interval-union time "developer time", "developer active
 * time", or "developer occupied time." Claude duration can include
 * unattended/autonomous sessions. Use "unique session wall-clock span" and
 * "additive agent runtime" only. Human attention/active time remains
 * unavailable unless explicitly instrumented.
 *
 * No new telemetry fields are required. The interval is derived from
 * existing persisted fields:
 *   start = timestamp (session end, ISO 8601) - duration_ms
 *   end   = timestamp
 *
 * This utility is generic and does not depend on the PI engine.
 */

/**
 * A time interval in epoch milliseconds.
 */
export interface Interval {
  startMs: number;
  endMs: number;
}

/**
 * A session row with the minimum fields needed for interval computation.
 */
export interface IntervalSession {
  timestamp: string;   // ISO 8601 — session END time
  duration_ms: number; // session duration in milliseconds
  user_id?: string | null;
  developer_id?: string | null;
}

/**
 * Result of computing time semantics for a set of sessions.
 */
export interface TimeSemanticsResult {
  agent_compute_time_ms: number;      // Σ(duration_ms) — additive
  developer_elapsed_time_ms: number;  // interval-union per developer, then summed
  developer_count: number;            // number of distinct developers
  intervals_by_developer: Record<string, Interval[]>; // raw intervals per developer
  unioned_by_developer: Record<string, Interval[]>;   // unioned intervals per developer
}

/**
 * Convert a session row to an interval.
 *
 * Returns null if the session has invalid/missing timestamp or duration.
 *
 * @param session - Session with timestamp (ISO 8601, session END) and duration_ms
 * @returns Interval or null if invalid
 */
export function sessionToInterval(session: IntervalSession): Interval | null {
  if (!session.timestamp || !session.duration_ms) return null;
  if (session.duration_ms <= 0) return null;
  if (session.duration_ms > 86400000) return null; // > 24h — invalid

  const endMs = new Date(session.timestamp).getTime();
  if (isNaN(endMs)) return null;

  const startMs = endMs - session.duration_ms;
  if (isNaN(startMs)) return null;

  return { startMs, endMs };
}

/**
 * Union a set of overlapping intervals into a minimal set of non-overlapping intervals.
 *
 * Algorithm: sort by start time, then merge overlapping/adjacent intervals.
 *
 * @param intervals - Array of intervals to union
 * @returns Sorted, non-overlapping intervals covering the same total span
 */
export function unionIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  if (intervals.length === 1) return [{ ...intervals[0] }];

  // Sort by start time
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);

  const merged: Interval[] = [{ startMs: sorted[0].startMs, endMs: sorted[0].endMs }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];

    if (current.startMs <= last.endMs) {
      // Overlapping or adjacent — merge
      last.endMs = Math.max(last.endMs, current.endMs);
    } else {
      // Non-overlapping — new interval
      merged.push({ startMs: current.startMs, endMs: current.endMs });
    }
  }

  return merged;
}

/**
 * Compute the total duration of a set of intervals.
 *
 * @param intervals - Non-overlapping intervals (result of unionIntervals)
 * @returns Total duration in milliseconds
 */
export function totalIntervalDuration(intervals: Interval[]): number {
  return intervals.reduce((sum, iv) => sum + (iv.endMs - iv.startMs), 0);
}

/**
 * Resolve the developer key for a session.
 *
 * Prefers user_id (top-level column, set by backend from API token).
 * Falls back to developer_id (in metadata, from token or client).
 * Falls back to 'unknown' — but 'unknown' sessions are NOT unioned together
 * (they are treated as individual intervals to avoid false merging).
 *
 * @param session - Session with user_id and/or developer_id
 * @returns Developer key string, or null if no identity
 */
export function resolveDeveloperKey(session: IntervalSession): string | null {
  if (session.user_id) return `user:${session.user_id}`;
  if (session.developer_id) return `dev:${session.developer_id}`;
  return null;
}

/**
 * Compute both agent_compute_time and developer_elapsed_time from a set of sessions.
 *
 * - agent_compute_time = Σ(duration_ms) — existing additive semantic, unchanged
 * - developer_elapsed_time = Σ(union interval durations) per developer, then summed
 *
 * Sessions with missing/invalid timestamps or durations are skipped.
 * Sessions with no developer identity are counted in agent_compute_time
 * but NOT in developer_elapsed_time (they cannot be grouped for union).
 *
 * @param sessions - Array of session rows
 * @returns TimeSemanticsResult with both time measures
 */
export function computeTimeSemantics(sessions: IntervalSession[]): TimeSemanticsResult {
  let agentComputeTimeMs = 0;
  const intervalsByDeveloper: Record<string, Interval[]> = {};
  let developerCount = 0;

  for (const session of sessions) {
    // ── agent_compute_time: requires ONLY valid positive duration_ms ──
    // Does NOT require timestamp. Remains row-additive.
    const durationMs = session.duration_ms;
    if (typeof durationMs === 'number' && isFinite(durationMs) && durationMs > 0 && durationMs <= 86400000) {
      agentComputeTimeMs += durationMs;
    } else {
      continue; // invalid duration → skip for both metrics
    }

    // ── developer_elapsed_time: requires valid timestamp + valid duration + developer identity ──
    const interval = sessionToInterval(session);
    if (!interval) continue; // missing/invalid timestamp → skip for developer_elapsed_time

    const devKey = resolveDeveloperKey(session);
    if (devKey) {
      if (!intervalsByDeveloper[devKey]) {
        intervalsByDeveloper[devKey] = [];
      }
      intervalsByDeveloper[devKey].push(interval);
    }
    // If no devKey, session is counted in agent_compute_time but not in developer_elapsed_time
  }

  // Union intervals per developer
  const unionedByDeveloper: Record<string, Interval[]> = {};
  let developerElapsedTimeMs = 0;

  for (const [devKey, intervals] of Object.entries(intervalsByDeveloper)) {
    const unioned = unionIntervals(intervals);
    unionedByDeveloper[devKey] = unioned;
    developerElapsedTimeMs += totalIntervalDuration(unioned);
    developerCount++;
  }

  return {
    agent_compute_time_ms: agentComputeTimeMs,
    developer_elapsed_time_ms: developerElapsedTimeMs,
    developer_count: developerCount,
    intervals_by_developer: intervalsByDeveloper,
    unioned_by_developer: unionedByDeveloper,
  };
}

/**
 * CR-X 2026-08-30 — Concurrency computation result.
 *
 * All time values are in MILLISECONDS.
 *
 * SEMANTICS (mandatory):
 * - additive_agent_runtime_ms = Σ(duration_ms) — row-additive total
 * - unique_session_wall_clock_span_ms = UNION(all intervals) — wall-clock span
 * - parallelism_factor = additive / unique (1.0 = no overlap, >1.0 = parallel)
 * - overlapping_session_count = number of PAIRS that overlap
 * - sessions_in_overlap = number of sessions participating in ≥1 overlap
 * - max_concurrent_sessions = peak concurrent session count
 *
 * Do NOT call unique_session_wall_clock_span "developer time" or "human active
 * time." It is the wall-clock span covered by session intervals. Agent sessions
 * may be unattended/autonomous.
 */
export interface ConcurrencyResult {
  additive_agent_runtime_ms: number;
  unique_session_wall_clock_span_ms: number;
  parallelism_factor: number;
  overlapping_session_count: number;
  sessions_in_overlap: number;
  max_concurrent_sessions: number;
  total_sessions: number;
  valid_interval_sessions: number;
}

/**
 * CR-X 2026-08-30 — Compute concurrency metrics from a set of sessions.
 *
 * Uses a sweep-line algorithm to count overlapping pairs, sessions in overlap,
 * and max concurrent sessions. Then computes the interval union for the
 * unique wall-clock span.
 *
 * This is generic across any workflow where interval evidence (timestamp +
 * duration_ms) exists. It does NOT group by developer — all sessions are
 * treated as potentially concurrent.
 *
 * @param sessions - Array of session rows with timestamp and duration_ms
 * @returns ConcurrencyResult with all concurrency metrics
 */
export function computeConcurrency(sessions: IntervalSession[]): ConcurrencyResult {
  // Build valid intervals
  const intervals: Interval[] = [];
  for (const session of sessions) {
    const interval = sessionToInterval(session);
    if (interval) intervals.push(interval);
  }

  if (intervals.length === 0) {
    return {
      additive_agent_runtime_ms: 0,
      unique_session_wall_clock_span_ms: 0,
      parallelism_factor: 0,
      overlapping_session_count: 0,
      sessions_in_overlap: 0,
      max_concurrent_sessions: 0,
      total_sessions: sessions.length,
      valid_interval_sessions: 0,
    };
  }

  // Additive agent runtime = Σ(duration)
  const additiveMs = intervals.reduce((sum, iv) => sum + (iv.endMs - iv.startMs), 0);

  // Unique wall-clock span = UNION(intervals)
  const unioned = unionIntervals(intervals);
  const uniqueMs = totalIntervalDuration(unioned);

  // Sweep-line for overlap counting and max concurrent
  // Events: (time, type) where type 0 = start, 1 = end
  // Sort by time, with ENDS before STARTS at the same time (half-open interval
  // semantics: [10:00, 10:01] and [10:01, 10:02] do NOT overlap — they touch)
  type Event = [number, 0 | 1, number]; // [timeMs, type, sessionIndex]
  const events: Event[] = [];
  for (let i = 0; i < intervals.length; i++) {
    events.push([intervals[i].startMs, 0, i]);
    events.push([intervals[i].endMs, 1, i]);
  }
  events.sort((a, b) => a[0] - b[0] || b[1] - a[1]); // ends (1) before starts (0)

  const active = new Set<number>();
  let overlapPairs = 0;
  const sessionsInOverlap = new Set<number>();
  let maxConcurrent = 0;

  for (const [, type, idx] of events) {
    if (type === 0) {
      // Start: count overlaps with all currently active
      for (const j of active) {
        overlapPairs++;
        sessionsInOverlap.add(idx);
        sessionsInOverlap.add(j);
      }
      active.add(idx);
      maxConcurrent = Math.max(maxConcurrent, active.size);
    } else {
      active.delete(idx);
    }
  }

  const parallelism = uniqueMs > 0 ? additiveMs / uniqueMs : 0;

  return {
    additive_agent_runtime_ms: additiveMs,
    unique_session_wall_clock_span_ms: uniqueMs,
    parallelism_factor: parallelism,
    overlapping_session_count: overlapPairs,
    sessions_in_overlap: sessionsInOverlap.size,
    max_concurrent_sessions: maxConcurrent,
    total_sessions: sessions.length,
    valid_interval_sessions: intervals.length,
  };
}
