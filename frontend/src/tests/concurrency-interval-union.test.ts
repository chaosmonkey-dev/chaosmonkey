/**
 * Concurrency / Interval-Union Tests
 *
 * Tests 13-18 from the Unit Economics V1 test plan.
 *
 * Verifies that developer_elapsed_time (interval-union) and
 * agent_compute_time (additive) are computed correctly.
 */
import { describe, it, expect } from 'vitest';
import {
  sessionToInterval,
  unionIntervals,
  totalIntervalDuration,
  computeTimeSemantics,
  type IntervalSession,
} from '../lib/intervalUnion';

function mkSession(
  timestamp: string,
  durationMs: number,
  developer: string = 'dev-1'
): IntervalSession {
  return { timestamp, duration_ms: durationMs, user_id: developer, developer_id: developer };
}

describe('Concurrency / Interval-Union', () => {
  // Test 13: one 60s session → compute=60s, developer elapsed=60s
  it('13. one 60s session → compute=60s, developer elapsed=60s', () => {
    const sessions = [mkSession('2026-08-01T10:01:00.000Z', 60000)];
    const result = computeTimeSemantics(sessions);
    expect(result.agent_compute_time_ms).toBe(60000);
    expect(result.developer_elapsed_time_ms).toBe(60000);
    expect(result.developer_count).toBe(1);
  });

  // Test 14: five fully overlapping 60s sessions same developer
  // → compute=300s, developer elapsed=60s
  it('14. five fully overlapping 60s sessions same developer → compute=300s, developer elapsed=60s', () => {
    // All sessions end at 10:01:00 and last 60s → all cover [10:00:00, 10:01:00]
    const sessions = Array.from({ length: 5 }, () =>
      mkSession('2026-08-01T10:01:00.000Z', 60000)
    );
    const result = computeTimeSemantics(sessions);
    expect(result.agent_compute_time_ms).toBe(300000); // 5 × 60s
    expect(result.developer_elapsed_time_ms).toBe(60000); // union = 60s
    expect(result.developer_count).toBe(1);
  });

  // Test 15: five non-overlapping sessions → compute=300s, developer elapsed=300s
  it('15. five non-overlapping sessions → compute=300s, developer elapsed=300s', () => {
    // 5 sessions, each 60s, sequential (no overlap)
    // Session 1: 10:00:00 - 10:01:00
    // Session 2: 10:01:00 - 10:02:00
    // etc.
    const sessions = Array.from({ length: 5 }, (_, i) =>
      mkSession(`2026-08-01T10:0${i + 1}:00.000Z`, 60000)
    );
    const result = computeTimeSemantics(sessions);
    expect(result.agent_compute_time_ms).toBe(300000); // 5 × 60s
    expect(result.developer_elapsed_time_ms).toBe(300000); // no overlap → 300s
    expect(result.developer_count).toBe(1);
  });

  // Test 16: partial overlap correctly unions intervals
  // [0, 60] + [30, 90] → union = 90s
  it('16. partial overlap correctly unions intervals', () => {
    // Session 1: ends at 10:01:00, duration 60s → [10:00:00, 10:01:00]
    // Session 2: ends at 10:01:30, duration 60s → [10:00:30, 10:01:30]
    // Union: [10:00:00, 10:01:30] = 90s
    const sessions = [
      mkSession('2026-08-01T10:01:00.000Z', 60000),
      mkSession('2026-08-01T10:01:30.000Z', 60000),
    ];
    const result = computeTimeSemantics(sessions);
    expect(result.agent_compute_time_ms).toBe(120000); // 2 × 60s
    expect(result.developer_elapsed_time_ms).toBe(90000); // union = 90s
  });

  // Test 17: different developers are NOT unioned together
  it('17. different developers are NOT unioned together', () => {
    // Two developers, each with one fully overlapping session
    // If incorrectly unioned across developers, elapsed would be 60s
    // Correct: each developer has 60s → total 120s
    const sessions = [
      mkSession('2026-08-01T10:01:00.000Z', 60000, 'dev-A'),
      mkSession('2026-08-01T10:01:00.000Z', 60000, 'dev-B'),
    ];
    const result = computeTimeSemantics(sessions);
    expect(result.agent_compute_time_ms).toBe(120000);
    expect(result.developer_elapsed_time_ms).toBe(120000); // 60s + 60s, not unioned
    expect(result.developer_count).toBe(2);
  });

  // Test 18: missing/invalid timestamps fail safely
  it('18. missing/invalid timestamps fail safely', () => {
    const sessions: IntervalSession[] = [
      { timestamp: '', duration_ms: 60000, user_id: 'dev-1', developer_id: 'dev-1' },
      { timestamp: '2026-08-01T10:01:00.000Z', duration_ms: 0, user_id: 'dev-2', developer_id: 'dev-2' },
      { timestamp: '2026-08-01T10:01:00.000Z', duration_ms: -1000, user_id: 'dev-3', developer_id: 'dev-3' },
      { timestamp: 'invalid-date', duration_ms: 60000, user_id: 'dev-4', developer_id: 'dev-4' },
      { timestamp: '2026-08-01T10:01:00.000Z', duration_ms: 99999999999, user_id: 'dev-5', developer_id: 'dev-5' }, // >24h → invalid
    ];
    const result = computeTimeSemantics(sessions);
    // Sessions 2,3,5 have invalid duration (0, negative, >24h) → skipped for both metrics
    // Sessions 1,4 have valid duration (60s) but invalid/missing timestamp
    // → agent_compute_time counts them (60+60=120s), developer_elapsed_time excludes them
    expect(result.agent_compute_time_ms).toBe(120000); // sessions 1 and 4 have valid duration
    expect(result.developer_elapsed_time_ms).toBe(0); // no valid timestamps
    expect(result.developer_count).toBe(0);
  });

  // Additional edge case: sessions with no developer identity
  it('18b. sessions with no developer identity are counted in compute but not elapsed', () => {
    const sessions: IntervalSession[] = [
      { timestamp: '2026-08-01T10:01:00.000Z', duration_ms: 60000, user_id: null, developer_id: null },
      { timestamp: '2026-08-01T10:01:00.000Z', duration_ms: 60000, user_id: null, developer_id: null },
    ];
    const result = computeTimeSemantics(sessions);
    expect(result.agent_compute_time_ms).toBe(120000); // counted
    expect(result.developer_elapsed_time_ms).toBe(0); // no developer → not unioned
    expect(result.developer_count).toBe(0);
  });

  // P1: valid duration + missing timestamp → agent compute counts it, developer elapsed excludes it
  it('18c. valid duration + missing timestamp → agent compute counts, developer elapsed excludes', () => {
    const sessions: IntervalSession[] = [
      // Valid session with timestamp
      { timestamp: '2026-08-01T10:01:00.000Z', duration_ms: 60000, user_id: 'dev-1', developer_id: 'dev-1' },
      // Valid duration but NO timestamp → should count in agent_compute_time but NOT developer_elapsed_time
      { timestamp: '', duration_ms: 60000, user_id: 'dev-1', developer_id: 'dev-1' },
      { timestamp: null as any, duration_ms: 60000, user_id: 'dev-1', developer_id: 'dev-1' },
    ];
    const result = computeTimeSemantics(sessions);
    // agent_compute_time = 60 + 60 + 60 = 180s (all have valid duration)
    expect(result.agent_compute_time_ms).toBe(180000);
    // developer_elapsed_time = 60s (only the one with valid timestamp)
    expect(result.developer_elapsed_time_ms).toBe(60000);
    expect(result.developer_count).toBe(1);
  });
});
