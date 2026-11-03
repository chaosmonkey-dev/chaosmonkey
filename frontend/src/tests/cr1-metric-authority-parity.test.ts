import { describe, it, expect } from 'vitest'
import { computeWeightedMetric } from '../lib/canonicalMetricAuthority'
import { buildMeasuredWorkflowIntelligence } from '../lib/aioi/buildMeasuredWorkflowIntelligence'
import { generateMetricCards } from '../lib/productivityCards'

const fixtureRows = [
  { tool: 'cursor', session_count: 100, active_coding_time_minutes: 12.5, average_session_length_minutes: 25, time_to_first_commit_minutes: 40, ai_suggestions_accepted: 5, commits_per_session: 0.5, focus_ratio: 0.5, ai_usage_duration_minutes: 10, idle_time_minutes: 5, total_session_minutes: 2500 },
  { tool: 'cursor', session_count: 50, active_coding_time_minutes: 8.0, average_session_length_minutes: 20, time_to_first_commit_minutes: 50, ai_suggestions_accepted: 3, commits_per_session: 0.3, focus_ratio: 0.4, ai_usage_duration_minutes: 6, idle_time_minutes: 4, total_session_minutes: 1000 },
  { tool: 'vscode', session_count: 80, active_coding_time_minutes: 10.0, average_session_length_minutes: 22, time_to_first_commit_minutes: 45, ai_suggestions_accepted: 4, commits_per_session: 0.4, focus_ratio: 0.45, ai_usage_duration_minutes: 8, idle_time_minutes: 3, total_session_minutes: 1760 },
  { tool: 'vscode', session_count: 20, active_coding_time_minutes: 15.0, average_session_length_minutes: 30, time_to_first_commit_minutes: 35, ai_suggestions_accepted: 7, commits_per_session: 0.6, focus_ratio: 0.5, ai_usage_duration_minutes: 12, idle_time_minutes: 6, total_session_minutes: 600 },
]

const fixtureMetadata = {
  tools_in_population: ['cursor', 'vscode'],
  session_count_by_tool: { cursor: 150, vscode: 100 },
}

describe('CR1 Phase 2: One Metric Authority — AIOI/PBT parity', () => {
  it('computeWeightedMetric matches AIOI buildMeasuredWorkflowIntelligence for active coding time', () => {
    const authorityResult = computeWeightedMetric(fixtureRows, 'cursor', 'active_coding_time_minutes')
    const aioiResults = buildMeasuredWorkflowIntelligence(fixtureRows, fixtureMetadata)
    const aioiCursor = aioiResults.find((r) => r.toolId === 'cursor')

    expect(aioiCursor).toBeDefined()
    expect(authorityResult.weightedValue).not.toBeNull()
    expect(aioiCursor!.activeCodingMinutesPerSession).not.toBeNull()

    // Both use session-weighted average: (12.5*100 + 8.0*50) / (100+50) = 1650/150 = 11.0
    expect(authorityResult.weightedValue).toBeCloseTo(11.0, 6)
    expect(aioiCursor!.activeCodingMinutesPerSession).toBeCloseTo(11.0, 6)
    expect(authorityResult.weightedValue).toBeCloseTo(aioiCursor!.activeCodingMinutesPerSession!, 6)
  })

  it('computeWeightedMetric matches PBT generateMetricCards for active coding time', () => {
    const authorityResult = computeWeightedMetric(fixtureRows, 'cursor', 'active_coding_time_minutes')

    // Build PBT-style series from the same rows
    const pbtSeries = [
      {
        label: 'cursor',
        points: fixtureRows
          .filter((r) => r.tool === 'cursor')
          .map((r) => ({
            t: '2026-01-01',
            v: r.active_coding_time_minutes,
            session_count: r.session_count,
            active_coding_time_minutes: r.active_coding_time_minutes,
          })),
        usesTelemetry: true,
        telemetryPointCount: 2,
        totalPointCount: 2,
        sessionCount: 150,
      },
    ]

    const cards = generateMetricCards({
      dataSource: pbtSeries as any,
      activeMetricId: 'ide.active_coding_time_minutes',
      comparisonMode: 'workflows',
      selectedMetric: 'active_coding_time_minutes',
      getCanonicalEntityLabel: (id: string) => id,
      getCanonicalWorkflowIdentity: (id: string) => id,
    })

    const cursorCard = cards.find((c: any) => c.rawToolId === 'cursor' || c.ide === 'cursor')
    expect(cursorCard).toBeDefined()
    expect(cursorCard!.value).not.toBeNull()
    expect(authorityResult.weightedValue).toBeCloseTo(cursorCard!.value!, 6)
  })

  it('AIOI and PBT produce identical values for all tested metrics', () => {
    const aioiResults = buildMeasuredWorkflowIntelligence(fixtureRows, fixtureMetadata)
    const aioiCursor = aioiResults.find((r) => r.toolId === 'cursor')!
    const aioiVscode = aioiResults.find((r) => r.toolId === 'vscode')!

    // Build PBT series for both tools
    const pbtSeries = ['cursor', 'vscode'].map((tool) => ({
      label: tool,
      points: fixtureRows
        .filter((r) => r.tool === tool)
        .map((r) => ({
          t: '2026-01-01',
          v: r.active_coding_time_minutes,
          session_count: r.session_count,
          active_coding_time_minutes: r.active_coding_time_minutes,
          average_session_length_minutes: r.average_session_length_minutes,
          time_to_first_commit_minutes: r.time_to_first_commit_minutes,
          ai_suggestions_accepted: r.ai_suggestions_accepted,
          commits_per_session: r.commits_per_session,
          focus_ratio: r.focus_ratio,
        })),
      usesTelemetry: true,
      telemetryPointCount: fixtureRows.filter((r) => r.tool === tool).length,
      totalPointCount: fixtureRows.filter((r) => r.tool === tool).length,
      sessionCount: fixtureRows.filter((r) => r.tool === tool).reduce((s, r) => s + r.session_count, 0),
    }))

    // CR5 provenance contract: AIOI returns null for timeToFirstCommitMinutes
    // and commitsPerSession when no observedAuthority is provided (these require
    // observed commit-event attribution). PBT's generateMetricCards computes
    // session-weighted averages from the fixture rows without observed authority.
    // These two metrics are intentionally excluded from parity assertions when
    // no observedAuthority is passed — the systems diverge by design on
    // provenance-gated metrics.
    const metricsToTest: Array<{ pbtId: string; aioiKey: keyof typeof aioiCursor; field: any }> = [
      { pbtId: 'ide.active_coding_time_minutes', aioiKey: 'activeCodingMinutesPerSession', field: 'active_coding_time_minutes' },
      { pbtId: 'ide.average_session_length_minutes', aioiKey: 'averageSessionLengthMinutes', field: 'average_session_length_minutes' },
      // Excluded: time_to_first_commit_minutes (AIOI requires observedAuthority)
      { pbtId: 'ide.ai_suggestions_accepted', aioiKey: 'aiActivityPerSession', field: 'ai_suggestions_accepted' },
      // Excluded: commits_per_session (AIOI requires observedAuthority)
    ]

    for (const { pbtId, aioiKey, field } of metricsToTest) {
      const cards = generateMetricCards({
        dataSource: pbtSeries as any,
        activeMetricId: pbtId,
        comparisonMode: 'workflows',
        selectedMetric: field,
        getCanonicalEntityLabel: (id: string) => id,
        getCanonicalWorkflowIdentity: (id: string) => id,
      })

      for (const tool of ['cursor', 'vscode']) {
        const card = cards.find((c: any) => c.rawToolId === tool || c.ide === tool)
        const aioiResult = tool === 'cursor' ? aioiCursor : aioiVscode
        const aioiValue = aioiResult[aioiKey] as number | null

        if (aioiValue === null) {
          expect(card!.value).toBeNull()
        } else if (card!.value !== null) {
          expect(card!.value).toBeCloseTo(aioiValue, 4)
        }
      }
    }
  })
})
