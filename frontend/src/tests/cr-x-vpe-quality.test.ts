import { describe, it, expect } from 'vitest'
import {
  generateWithinWorkflowAISignalCoverage,
  generateWithinWorkflowCommitsProfile,
  generateWithinWorkflowTTFCProfile,
  generatePilotMaturityProgression,
} from '../lib/insights/final/generators/planCode'
import { generateRecentChangeInsights } from '../lib/insights/final/generators/recentChange'

describe('CR-X VPE quality pass', () => {
  function s(session_id: string, overrides: Record<string, any> = {}): any {
    return { session_id, tool: 'vscode', ...overrides }
  }

  it('healthy AI-signal coverage does not become a standalone PI', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      s(`ai-${i}`, { ai_burst_count: 1 })
    )
    const result = generateWithinWorkflowAISignalCoverage({ sessionRows: sessions } as any) || []
    expect(result.length).toBe(0)
  })

  it('zero AI-signal coverage still surfaces as an anomaly', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      s(`ai0-${i}`, { ai_burst_count: 0 })
    )
    const result = generateWithinWorkflowAISignalCoverage({ sessionRows: sessions } as any) || []
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].title.toLowerCase()).toContain('zero')
  })

  it('baseline commits/session does not become a standalone PI', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      s(`c-${i}`, { session_commits: 1, session_commits_source: 'observed' })
    )
    const result = generateWithinWorkflowCommitsProfile({ sessionRows: sessions } as any) || []
    expect(result.length).toBe(0)
  })

  it('high commit variance still surfaces as an operational tail', () => {
    const sessions = [
      ...Array.from({ length: 18 }, (_, i) =>
        s(`cv-${i}`, { session_commits: 1, session_commits_source: 'observed' })
      ),
      ...[
        s('cv-outlier-1', { session_commits: 100, session_commits_source: 'observed' }),
        s('cv-outlier-2', { session_commits: 120, session_commits_source: 'observed' }),
      ],
    ]
    const result = generateWithinWorkflowCommitsProfile({ sessionRows: sessions } as any) || []
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].title.toLowerCase()).toContain('small share')
  })

  it('pilot maturity progression is not emitted as a PI', () => {
    const sessions = Array.from({ length: 50 }, (_, i) => s(`m-${i}`))
    const result = generatePilotMaturityProgression({ sessionRows: sessions } as any)
    expect(result).toBeNull()
  })

  it('sparse per-workflow temporal windows (4 vs 17) emit nothing', () => {
    const recent = Array.from({ length: 4 }, (_, i) =>
      s(`r-${i}`, { timestamp: `2026-09-1${i}T12:00:00.000000Z` })
    )
    const prior = Array.from({ length: 17 }, (_, i) =>
      s(`p-${i}`, { timestamp: `2026-08-2${i % 10}T12:00:00.000000Z` })
    )
    const result = generateRecentChangeInsights({
      sessionRows: [...recent, ...prior],
      _engineCache: {
        temporalWindows: {
          recent: {
            start: new Date('2026-09-10T00:00:00Z'),
            end: new Date('2026-09-14T23:59:59Z'),
            recentLabel: 'the last 2 weeks',
          },
          prior: {
            start: new Date('2026-08-27T00:00:00Z'),
            end: new Date('2026-09-09T23:59:59Z'),
            priorLabel: 'the prior 2 weeks',
          },
        },
        recentRows: recent,
        priorRows: prior,
      } as any,
    } as any)
    expect(result).toBeDefined()
    expect(
      result.some((insight: any) =>
        insight.title.toLowerCase().includes('vscode active coding')
      )
    ).toBe(false)
  })

  const ttfcMins = (v: number): number => v * 60000

  it('moderate healthy TTFC is not a PI', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      s(`ttfc-m-${i}`, {
        time_to_first_commit_ms: i < 18 ? ttfcMins(45) : ttfcMins(48),
        session_commits_source: 'observed',
      })
    )
    const result = generateWithinWorkflowTTFCProfile({ sessionRows: sessions } as any) || []
    expect(result.length).toBe(0)
  })

  it('fast healthy TTFC is not a PI', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      s(`ttfc-f-${i}`, {
        time_to_first_commit_ms: i < 18 ? ttfcMins(10) : ttfcMins(12),
        session_commits_source: 'observed',
      })
    )
    const result = generateWithinWorkflowTTFCProfile({ sessionRows: sessions } as any) || []
    expect(result.length).toBe(0)
  })

  it('median >60 min TTFC still surfaces as slow', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      s(`ttfc-s-${i}`, {
        time_to_first_commit_ms: i < 18 ? ttfcMins(70) : ttfcMins(80),
        session_commits_source: 'observed',
      })
    )
    const result = generateWithinWorkflowTTFCProfile({ sessionRows: sessions } as any) || []
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].title.toLowerCase()).toContain('slow')
  })

  it('high variance TTFC surfaces as a long-tail finding, not a median baseline', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      s(`ttfc-v-${i}`, {
        time_to_first_commit_ms: i < 18 ? ttfcMins(15) : ttfcMins(350),
        session_commits_source: 'observed',
      })
    )
    const result = generateWithinWorkflowTTFCProfile({ sessionRows: sessions } as any) || []
    expect(result.length).toBeGreaterThan(0)
    const title = result[0].title.toLowerCase()
    expect(title).toContain('small share')
    expect(title).toContain('far longer')
    expect(title).not.toContain('median 15')
  })

  it('insufficient observed TTFC returns the data-gap diagnostic', () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      s(`ttfc-i-${i}`, {
        time_to_first_commit_ms: ttfcMins(45),
        session_commits_source: 'observed',
      })
    )
    const result = generateWithinWorkflowTTFCProfile({ sessionRows: sessions } as any)
    expect(result).toBeTruthy()
    expect(result!.length).toBe(1)
    expect(result![0].isDiagnostic).toBe(true)
    expect(result![0].title.toLowerCase()).toContain('needs more data')
  })
})
