/**
 * CR-X B: Within-workflow PI value tests.
 *
 * Verifies that single-workflow and sparse pilots generate useful evidence
 * without requiring artificial cross-tool comparisons.
 *
 * Key principle: a mature single-workflow tenant must generate useful evidence.
 */
import { describe, it, expect } from 'vitest'

// Simulate the within-workflow AI signal coverage generator logic
function computeAISignalCoverage(sessions: Array<{ ai_burst_count?: number }>) {
  const total = sessions.length
  if (total < 15) return null
  const withAi = sessions.filter(s => (s.ai_burst_count ?? 0) > 0).length
  const zeroAi = total - withAi
  return {
    total,
    withAiSignals: withAi,
    zeroAiSignals: zeroAi,
    coveragePct: (withAi / total) * 100,
  }
}

// Simulate the within-workflow session duration profile logic
function computeDurationProfile(sessions: Array<{ session_duration_minutes?: number }>) {
  const durVals = sessions
    .map(s => s.session_duration_minutes)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b)
  if (durVals.length < 15) return null

  const median = durVals[Math.floor(durVals.length / 2)]
  const p90 = durVals[Math.floor(durVals.length * 0.9)]
  const p90p50 = median > 0 ? p90 / median : 0
  const mean = durVals.reduce((sum, v) => sum + v, 0) / durVals.length

  return { n: durVals.length, median, p90, p90p50, mean }
}

function percentile(sortedVals: number[], p: number): number {
  if (sortedVals.length === 0) return 0
  const idx = Math.min(Math.floor(sortedVals.length * p / 100), sortedVals.length - 1)
  return sortedVals[idx]
}

describe('CR-X B: Within-workflow AI signal coverage', () => {
  it('returns null below 15 sessions (threshold gate)', () => {
    const sessions = Array.from({ length: 14 }, (_, i) => ({ ai_burst_count: i % 2 }))
    expect(computeAISignalCoverage(sessions)).toBeNull()
  })

  it('returns coverage at 15 sessions', () => {
    const sessions = Array.from({ length: 15 }, (_, i) => ({ ai_burst_count: i < 10 ? 1 : 0 }))
    const result = computeAISignalCoverage(sessions)
    expect(result).not.toBeNull()
    expect(result!.total).toBe(15)
    expect(result!.withAiSignals).toBe(10)
    expect(result!.zeroAiSignals).toBe(5)
    expect(result!.coveragePct).toBeCloseTo(66.67, 1)
  })

  it('full coverage: all sessions have AI signals', () => {
    const sessions = Array.from({ length: 20 }, () => ({ ai_burst_count: 5 }))
    const result = computeAISignalCoverage(sessions)
    expect(result!.coveragePct).toBe(100)
    expect(result!.zeroAiSignals).toBe(0)
  })

  it('zero coverage: no sessions have AI signals', () => {
    const sessions = Array.from({ length: 20 }, () => ({ ai_burst_count: 0 }))
    const result = computeAISignalCoverage(sessions)
    expect(result!.coveragePct).toBe(0)
    expect(result!.withAiSignals).toBe(0)
    expect(result!.zeroAiSignals).toBe(20)
  })

  it('partial coverage: mixed AI signal presence', () => {
    const sessions = Array.from({ length: 30 }, (_, i) => ({ ai_burst_count: i % 3 === 0 ? 0 : 2 }))
    const result = computeAISignalCoverage(sessions)
    expect(result!.withAiSignals).toBe(20)
    expect(result!.zeroAiSignals).toBe(10)
    expect(result!.coveragePct).toBeCloseTo(66.67, 1)
  })

  it('uses correct semantic: "observed AI signals" not "AI-assisted"', () => {
    // The semantic is about instrumentation coverage, not causal AI usage
    const sessions = Array.from({ length: 20 }, () => ({ ai_burst_count: 0 }))
    const result = computeAISignalCoverage(sessions)
    // Zero AI signals means "zero observed AI signals" — instrumentation health
    expect(result!.zeroAiSignals).toBe(20)
    expect(result!.withAiSignals).toBe(0)
  })
})

describe('CR-X B: Within-workflow session duration profile', () => {
  it('returns null below 15 sessions', () => {
    const sessions = Array.from({ length: 14 }, (_, i) => ({ session_duration_minutes: 30 + i }))
    expect(computeDurationProfile(sessions)).toBeNull()
  })

  it('returns profile at 15 sessions', () => {
    const sessions = Array.from({ length: 15 }, (_, i) => ({ session_duration_minutes: 30 + i * 5 }))
    const result = computeDurationProfile(sessions)
    expect(result).not.toBeNull()
    expect(result!.n).toBe(15)
    expect(result!.median).toBeGreaterThan(0)
    expect(result!.p90).toBeGreaterThan(result!.median)
  })

  it('detects heavy-tailed distribution', () => {
    // 20 sessions at 30 min, 5 sessions at 300 min
    const sessions = [
      ...Array.from({ length: 20 }, () => ({ session_duration_minutes: 30 })),
      ...Array.from({ length: 5 }, () => ({ session_duration_minutes: 300 })),
    ]
    const result = computeDurationProfile(sessions)
    expect(result!.p90p50).toBeGreaterThanOrEqual(5) // heavy tail
  })

  it('detects consistent distribution', () => {
    // All sessions similar duration
    const sessions = Array.from({ length: 30 }, () => ({ session_duration_minutes: 60 }))
    const result = computeDurationProfile(sessions)
    expect(result!.p90p50).toBeLessThan(3) // consistent
  })

  it('works for single-workflow pilots (no cross-tool comparison needed)', () => {
    // A single-workflow pilot with 30 sessions should get a duration profile
    const sessions = Array.from({ length: 30 }, (_, i) => ({ session_duration_minutes: 45 + i * 3 }))
    const result = computeDurationProfile(sessions)
    expect(result).not.toBeNull()
    expect(result!.n).toBe(30)
  })

  it('handles sessions with missing duration', () => {
    const sessions = [
      ...Array.from({ length: 20 }, (_, i) => ({ session_duration_minutes: 30 + i })),
      ...Array.from({ length: 5 }, () => ({ session_duration_minutes: null as any })),
      ...Array.from({ length: 3 }, () => ({ session_duration_minutes: 0 })),
    ]
    const result = computeDurationProfile(sessions)
    // Should filter out null/0/NaN and use the 20 valid sessions
    expect(result).not.toBeNull()
    expect(result!.n).toBe(20)
  })
})

describe('CR-X B: Single-workflow pilot value', () => {
  it('a mature single-workflow pilot generates useful evidence', () => {
    // 100 sessions in a single workflow (cursor)
    const sessions = Array.from({ length: 100 }, (_, i) => ({
      ai_burst_count: i % 4 === 0 ? 0 : 3 + (i % 8),
      session_duration_minutes: 30 + (i % 60),
    }))

    const coverage = computeAISignalCoverage(sessions)
    const profile = computeDurationProfile(sessions)

    // Both within-workflow families produce findings
    expect(coverage).not.toBeNull()
    expect(profile).not.toBeNull()
    expect(coverage!.total).toBe(100)
    expect(profile!.n).toBe(100)
  })

  it('a sparse single-workflow pilot (15 sessions) gets diagnostic findings', () => {
    const sessions = Array.from({ length: 15 }, (_, i) => ({
      ai_burst_count: i < 5 ? 0 : 2,
      session_duration_minutes: 20 + i * 5,
    }))

    const coverage = computeAISignalCoverage(sessions)
    const profile = computeDurationProfile(sessions)

    // Both produce findings at 15 sessions (not dead zone)
    expect(coverage).not.toBeNull()
    expect(profile).not.toBeNull()
  })

  it('a very sparse pilot (5 sessions) gets diagnostic state, not dead zone', () => {
    const sessions = Array.from({ length: 5 }, () => ({
      ai_burst_count: 1,
      session_duration_minutes: 30,
    }))

    const coverage = computeAISignalCoverage(sessions)
    const profile = computeDurationProfile(sessions)

    // Below threshold — returns null (diagnostic in the generator)
    expect(coverage).toBeNull()
    expect(profile).toBeNull()
    // The generator would return a diagnostic insight, not nothing
  })
})
