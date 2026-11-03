import { describe, it, expect } from 'vitest'
import { computeWeightedMetric } from '../lib/canonicalMetricAuthority'
import { buildMeasuredWorkflowIntelligence } from '../lib/aioi/buildMeasuredWorkflowIntelligence'
import { generateMetricCards, METRIC_POLARITY, determineLeader, determineLaggard } from '../lib/productivityCards'
import { resolveTimeSeriesPointField } from '../lib/productivity/resolveTimeSeriesPointField'

// Fixture: canonical rows with mixed session counts (some zero — legacy era)
const mixedRows = [
  { tool: 'cursor', session_count: 100, ai_suggestions_accepted: 5, active_coding_time_minutes: 12, average_session_length_minutes: 25, time_to_first_commit_minutes: 40, commits_per_session: 0.5, focus_ratio: 0.5, ai_usage_duration_minutes: 10, idle_time_minutes: 5, total_session_minutes: 2500 },
  { tool: 'cursor', session_count: 0,   ai_suggestions_accepted: 20, active_coding_time_minutes: 30, average_session_length_minutes: 60, time_to_first_commit_minutes: 10, commits_per_session: 2, focus_ratio: 0.9, ai_usage_duration_minutes: 40, idle_time_minutes: 1, total_session_minutes: 0 },
  { tool: 'vscode', session_count: 80,  ai_suggestions_accepted: 4, active_coding_time_minutes: 10, average_session_length_minutes: 22, time_to_first_commit_minutes: 45, commits_per_session: 0.4, focus_ratio: 0.45, ai_usage_duration_minutes: 8, idle_time_minutes: 3, total_session_minutes: 1760 },
]

const mixedMetadata = {
  tools_in_population: ['cursor', 'vscode'],
  session_count_by_tool: { cursor: 100, vscode: 80 },
}

// Helper: build PBT-style series from canonical rows
function buildPbtSeries(rows: typeof mixedRows, tools: string[], field: string) {
  return tools.map((tool) => {
    const toolRows = rows.filter((r) => r.tool === tool)
    return {
      label: tool,
      points: toolRows.map((r) => ({
        t: '2026-01-01',
        v: (r as any)[field],
        session_count: r.session_count,
        [field]: (r as any)[field],
        AI_suggestions_accepted: r.ai_suggestions_accepted,
        ai_suggestions_accepted: r.ai_suggestions_accepted,
        AI_usage_duration_minutes: r.ai_usage_duration_minutes,
        ai_usage_duration_minutes: r.ai_usage_duration_minutes,
        active_coding_time_minutes: r.active_coding_time_minutes,
        average_session_length_minutes: r.average_session_length_minutes,
        time_to_first_commit_minutes: r.time_to_first_commit_minutes,
        commits_per_session: r.commits_per_session,
      })),
      usesTelemetry: true,
      telemetryPointCount: toolRows.length,
      totalPointCount: toolRows.length,
      sessionCount: toolRows.reduce((s, r) => s + r.session_count, 0),
    }
  })
}

describe('CR2 PBT Metric Parity — no simple-average fallback', () => {
  it('PBT returns null when all points have session_count=0 (matches AIOI)', () => {
    const zeroSessionRows = [
      { tool: 'cursor', session_count: 0, ai_suggestions_accepted: 20, active_coding_time_minutes: 30, average_session_length_minutes: 60, time_to_first_commit_minutes: 10, commits_per_session: 2, focus_ratio: 0.9, ai_usage_duration_minutes: 40, idle_time_minutes: 1, total_session_minutes: 0 },
    ]
    const pbtSeries = buildPbtSeries(zeroSessionRows, ['cursor'], 'ai_suggestions_accepted')
    const cards = generateMetricCards({
      dataSource: pbtSeries as any,
      activeMetricId: 'ide.ai_suggestions_accepted',
      comparisonMode: 'workflows',
      selectedMetric: 'ai_suggestions_accepted',
      getCanonicalEntityLabel: (id: string) => id,
      getCanonicalWorkflowIdentity: (id: string) => id,
    })
    const card = cards.find((c: any) => c.rawToolId === 'cursor' || c.ide === 'cursor')
    expect(card).toBeDefined()
    expect(card!.value).toBeNull()
  })

  it('PBT ignores zero-session rows in weighted average (matches AIOI)', () => {
    const authorityResult = computeWeightedMetric(mixedRows, 'cursor', 'ai_suggestions_accepted')
    const aioiResults = buildMeasuredWorkflowIntelligence(mixedRows, mixedMetadata)
    const aioiCursor = aioiResults.find((r) => r.toolId === 'cursor')!

    // AIOI: (5*100 + 20*0) / (100+0) = 500/100 = 5.0 — zero-session row excluded
    expect(authorityResult.weightedValue).toBeCloseTo(5.0, 6)
    expect(aioiCursor.aiActivityPerSession).toBeCloseTo(5.0, 6)

    const pbtSeries = buildPbtSeries(mixedRows, ['cursor'], 'ai_suggestions_accepted')
    const cards = generateMetricCards({
      dataSource: pbtSeries as any,
      activeMetricId: 'ide.ai_suggestions_accepted',
      comparisonMode: 'workflows',
      selectedMetric: 'ai_suggestions_accepted',
      getCanonicalEntityLabel: (id: string) => id,
      getCanonicalWorkflowIdentity: (id: string) => id,
    })
    const card = cards.find((c: any) => c.rawToolId === 'cursor' || c.ide === 'cursor')!
    expect(card.value).toBeCloseTo(5.0, 6)
    expect(card.value).toBeCloseTo(aioiCursor.aiActivityPerSession!, 6)
  })
})

describe('CR2 PBT Routing — resolveTimeSeriesPointField, no v-fallback', () => {
  it('resolveTimeSeriesPointField returns null for unknown metric', () => {
    expect(resolveTimeSeriesPointField('ide.unknown_metric')).toBeNull()
    expect(resolveTimeSeriesPointField('unknown_metric')).toBeNull()
  })

  it('resolveTimeSeriesPointField handles case variants for AI metrics', () => {
    expect(resolveTimeSeriesPointField('ide.ai_suggestions_accepted')).toBe('AI_suggestions_accepted')
    expect(resolveTimeSeriesPointField('ide.AI_suggestions_accepted')).toBe('AI_suggestions_accepted')
    expect(resolveTimeSeriesPointField('ai_suggestions_accepted')).toBe('AI_suggestions_accepted')
    expect(resolveTimeSeriesPointField('AI_suggestions_accepted')).toBe('AI_suggestions_accepted')
  })

  it('generateMetricCards returns empty array for unknown metric (no v-fallback)', () => {
    const pbtSeries = buildPbtSeries(mixedRows, ['cursor'], 'ai_suggestions_accepted')
    const cards = generateMetricCards({
      dataSource: pbtSeries as any,
      activeMetricId: 'ide.unknown_metric',
      comparisonMode: 'workflows',
      selectedMetric: 'unknown_metric',
      getCanonicalEntityLabel: (id: string) => id,
      getCanonicalWorkflowIdentity: (id: string) => id,
    })
    expect(cards).toHaveLength(0)
  })
})

describe('CR2 PBT Polarity — lowercase metric ID lookups', () => {
  it('METRIC_POLARITY resolves lowercase ai_suggestions_accepted to higher', () => {
    expect(METRIC_POLARITY['ai_suggestions_accepted']).toBe('higher')
  })

  it('METRIC_POLARITY resolves lowercase ai_usage_duration_minutes to higher', () => {
    expect(METRIC_POLARITY['ai_usage_duration_minutes']).toBe('higher')
  })

  it('METRIC_POLARITY resolves lowercase time_to_first_commit_minutes to lower', () => {
    expect(METRIC_POLARITY['time_to_first_commit_minutes']).toBe('lower')
  })

  it('determineLeader uses correct polarity for lowercase metric ID', () => {
    const cards = [
      { ide: 'cursor', value: 5, isLive: true, usesTelemetry: true, dataSource: 'Real', telemetryPointCount: 1, totalPointCount: 1, hasValue: true, availability: 'available', sessionCount: 100, rawToolId: 'cursor' },
      { ide: 'vscode', value: 10, isLive: true, usesTelemetry: true, dataSource: 'Real', telemetryPointCount: 1, totalPointCount: 1, hasValue: true, availability: 'available', sessionCount: 80, rawToolId: 'vscode' },
    ] as any

    // For higher-is-better, leader should be vscode (value=10)
    const leader = determineLeader(cards, 'ai_suggestions_accepted')
    expect(leader).toBeDefined()
    expect(leader!.ide).toBe('vscode')

    // For lower-is-better, leader should be cursor (value=5)
    const ttfcCards = [
      { ide: 'cursor', value: 40, isLive: true, usesTelemetry: true, dataSource: 'Real', telemetryPointCount: 1, totalPointCount: 1, hasValue: true, availability: 'available', sessionCount: 100, rawToolId: 'cursor' },
      { ide: 'vscode', value: 45, isLive: true, usesTelemetry: true, dataSource: 'Real', telemetryPointCount: 1, totalPointCount: 1, hasValue: true, availability: 'available', sessionCount: 80, rawToolId: 'vscode' },
    ] as any
    const ttfcLeader = determineLeader(ttfcCards, 'time_to_first_commit_minutes')
    expect(ttfcLeader).toBeDefined()
    expect(ttfcLeader!.ide).toBe('cursor')
  })
})

describe('CR2 PBT Cost Eligibility — 25-session threshold', () => {
  it('determineLeader excludes cards with < 25 sessions', () => {
    const cards = [
      { ide: 'cursor', value: 100, isLive: true, usesTelemetry: true, dataSource: 'Real', telemetryPointCount: 1, totalPointCount: 1, hasValue: true, availability: 'available', sessionCount: 50, rawToolId: 'cursor' },
      { ide: 'copilot', value: 200, isLive: true, usesTelemetry: true, dataSource: 'Real', telemetryPointCount: 1, totalPointCount: 1, hasValue: true, availability: 'available', sessionCount: 6, rawToolId: 'github-copilot' },
    ] as any

    const leader = determineLeader(cards, 'ai_suggestions_accepted')
    expect(leader).toBeDefined()
    expect(leader!.ide).toBe('cursor') // copilot excluded despite higher value
  })

  it('determineLaggard excludes cards with < 25 sessions', () => {
    const cards = [
      { ide: 'cursor', value: 100, isLive: true, usesTelemetry: true, dataSource: 'Real', telemetryPointCount: 1, totalPointCount: 1, hasValue: true, availability: 'available', sessionCount: 50, rawToolId: 'cursor' },
      { ide: 'vscode', value: 50, isLive: true, usesTelemetry: true, dataSource: 'Real', telemetryPointCount: 1, totalPointCount: 1, hasValue: true, availability: 'available', sessionCount: 80, rawToolId: 'vscode' },
      { ide: 'copilot', value: 1, isLive: true, usesTelemetry: true, dataSource: 'Real', telemetryPointCount: 1, totalPointCount: 1, hasValue: true, availability: 'available', sessionCount: 6, rawToolId: 'github-copilot' },
    ] as any

    const laggard = determineLaggard(cards, 'ai_suggestions_accepted')
    expect(laggard).toBeDefined()
    expect(laggard!.ide).toBe('vscode') // copilot excluded, cursor is leader, vscode is laggard
  })
})

describe('CR2 PBT/AIOI Full Parity — AI Activity across mixed session eras', () => {
  it('AIOI and PBT produce identical AI Activity values with mixed session eras', () => {
    const aioiResults = buildMeasuredWorkflowIntelligence(mixedRows, mixedMetadata)
    const aioiCursor = aioiResults.find((r) => r.toolId === 'cursor')!
    const aioiVscode = aioiResults.find((r) => r.toolId === 'vscode')!

    const pbtSeries = buildPbtSeries(mixedRows, ['cursor', 'vscode'], 'ai_suggestions_accepted')
    const cards = generateMetricCards({
      dataSource: pbtSeries as any,
      activeMetricId: 'ide.ai_suggestions_accepted',
      comparisonMode: 'workflows',
      selectedMetric: 'ai_suggestions_accepted',
      getCanonicalEntityLabel: (id: string) => id,
      getCanonicalWorkflowIdentity: (id: string) => id,
    })

    const cursorCard = cards.find((c: any) => c.rawToolId === 'cursor' || c.ide === 'cursor')!
    const vscodeCard = cards.find((c: any) => c.rawToolId === 'vscode' || c.ide === 'vscode')!

    // Both should match AIOI exactly
    expect(cursorCard.value).toBeCloseTo(aioiCursor.aiActivityPerSession!, 6)
    expect(vscodeCard.value).toBeCloseTo(aioiVscode.aiActivityPerSession!, 6)

    // Cursor: (5*100) / 100 = 5.0 (zero-session row excluded)
    expect(cursorCard.value).toBeCloseTo(5.0, 6)
    // VSCode: (4*80) / 80 = 4.0
    expect(vscodeCard.value).toBeCloseTo(4.0, 6)
  })
})
