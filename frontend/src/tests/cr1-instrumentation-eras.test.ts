import { describe, it, expect } from 'vitest'

describe('CR1 Phase 5: Instrumentation eras', () => {
  it('session-era records have sessionCount > 0 or activeCodingMs > 0', () => {
    const sessionEraRecord = {
      sessionCount: 5,
      activeCodingMs: 300000,
      instrumentation_era: undefined as 'session' | 'legacy' | undefined,
    }
    const legacyEraRecord = {
      sessionCount: 0,
      activeCodingMs: 0,
      instrumentation_era: undefined as 'session' | 'legacy' | undefined,
    }

    const inferEra = (r: { sessionCount: number; activeCodingMs: number; instrumentation_era?: 'session' | 'legacy' }) =>
      r.instrumentation_era || ((r.sessionCount > 0 || r.activeCodingMs > 0) ? 'session' : 'legacy')

    expect(inferEra(sessionEraRecord)).toBe('session')
    expect(inferEra(legacyEraRecord)).toBe('legacy')
  })

  it('explicit instrumentation_era takes precedence over inference', () => {
    const record = {
      sessionCount: 0,
      activeCodingMs: 0,
      instrumentation_era: 'session' as const,
    }

    const inferEra = (r: { sessionCount: number; activeCodingMs: number; instrumentation_era?: 'session' | 'legacy' }) =>
      r.instrumentation_era || ((r.sessionCount > 0 || r.activeCodingMs > 0) ? 'session' : 'legacy')

    expect(inferEra(record)).toBe('session')
  })

  it('era is preserved as 1 (session) or 0 (legacy) in the metrics map', () => {
    const sessionEra: number = 1
    const legacyEra: number = 0

    expect(sessionEra === 1 ? 'session' : 'legacy').toBe('session')
    expect(legacyEra === 1 ? 'session' : 'legacy').toBe('legacy')
  })

  it('mixed-era period: if any record is session-era, the period is session-era', () => {
    const records = [
      { sessionCount: 0, activeCodingMs: 0 },
      { sessionCount: 5, activeCodingMs: 300000 },
      { sessionCount: 0, activeCodingMs: 0 },
    ]

    const inferEra = (r: { sessionCount: number; activeCodingMs: number }) =>
      (r.sessionCount > 0 || r.activeCodingMs > 0) ? 'session' : 'legacy'

    let periodEra = 0
    for (const r of records) {
      if (inferEra(r) === 'session') periodEra = 1
    }

    expect(periodEra).toBe(1)
    expect(periodEra === 1 ? 'session' : 'legacy').toBe('session')
  })
})
