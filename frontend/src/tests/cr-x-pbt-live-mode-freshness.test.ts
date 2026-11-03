import { describe, it, expect, vi } from 'vitest'

/**
 * P0 regression: PBT Time Series must not fall back to the simulator on a
 * production (non-localhost) pilot, because the simulator stops at the end of
 * its synthetic scaffold and appears to "cut off" real telemetry around the
 * last synthetic bucket. This test exercises the full pipeline from
 * `getProductivityTimeSeries` through `fetchCanonicalTelemetry` ->
 * `buildSeriesFromTelemetryOnly` with a canonical payload that includes the
 * post-Aug 21/24 weeks 2026-35 and 2026-36.
 */

describe('CR-X P0 PBT live-mode freshness on non-localhost', () => {
  it('keeps 2026-35 and 2026-36 weekly periods in the rendered series when env vars are not set', async () => {
    // Simulate Ed / production: no explicit live env var, non-localhost hostname.
    vi.stubEnv('VITE_CM_TELEMETRY_LIVE', 'false')
    vi.stubEnv('VITE_LIVE_PILOT_MODE', 'false')
    vi.stubEnv('VITE_API_BASE_URL', 'http://ed.test')

    globalThis.window = {
      location: {
        hostname: 'prioritydispatch.chaosmonkey.dev',
        origin: 'http://prioritydispatch.chaosmonkey.dev:5174',
        href: 'http://prioritydispatch.chaosmonkey.dev:5174/productivity',
      },
    } as any

    globalThis.localStorage = { getItem: vi.fn(() => null) } as any

    const fixture = {
      data: [
        {
          tool: 'vscode',
          period: '2026-36',
          session_count: 335,
          average_session_length_minutes: 16.04,
          total_session_minutes: 5374,
          active_coding_time_minutes: 5.24,
          ai_usage_duration_minutes: 2.83,
          time_to_first_commit_minutes: 44.74,
          ai_suggestions_accepted: 4,
          files_edited_per_session: 1.64,
          commits_per_session: 0.51,
          idle_time_minutes: 10.8,
          focus_ratio: 0.33,
        },
        {
          tool: 'vscode',
          period: '2026-35',
          session_count: 316,
          average_session_length_minutes: 15.38,
          total_session_minutes: 4859,
          active_coding_time_minutes: 4.97,
          ai_usage_duration_minutes: 2.69,
          time_to_first_commit_minutes: 44.18,
          ai_suggestions_accepted: 3,
          files_edited_per_session: 1.93,
          commits_per_session: 0.49,
          idle_time_minutes: 10.41,
          focus_ratio: 0.32,
        },
        {
          tool: 'claude_code',
          period: '2026-36',
          session_count: 22,
          average_session_length_minutes: 309.54,
          total_session_minutes: 6809,
          active_coding_time_minutes: 0,
          ai_usage_duration_minutes: 1.18,
          time_to_first_commit_minutes: 39.33,
          ai_suggestions_accepted: 0,
          files_edited_per_session: 0.82,
          commits_per_session: 0.56,
          idle_time_minutes: 0,
          focus_ratio: 0,
        },
        {
          tool: 'claude_code',
          period: '2026-35',
          session_count: 10,
          average_session_length_minutes: 493.29,
          total_session_minutes: 4932,
          active_coding_time_minutes: 0,
          ai_usage_duration_minutes: 256.68,
          time_to_first_commit_minutes: 21.93,
          ai_suggestions_accepted: 26,
          files_edited_per_session: 26.3,
          commits_per_session: 0,
          idle_time_minutes: 0,
          focus_ratio: 0,
        },
      ],
      metadata: {
        canonical_population_count: 683,
        session_count_by_tool: { vscode: 651, claude_code: 32 },
        tools_in_population: ['vscode', 'claude_code'],
        periods_returned: 2,
        tools_returned: 2,
        period: 'week',
        format: 'aggregated',
        time_range: { from: '2026-01-01T00:00:00.000Z', to: '2026-09-06T23:59:59.999Z' },
        filters_applied: {},
        query_hash: 'deadbeef',
        source_table: 'telemetry_events',
      },
    }

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => fixture,
    }))
    globalThis.fetch = fetchMock as any

    vi.resetModules()
    const { getProductivityTimeSeries } = await import('../services/metricsFacade')

    const result = await getProductivityTimeSeries({
      from: '2026-01-01',
      to: '2026-09-06',
      viewBucket: 'weekly',
      scope: 'org',
      repos: [],
      metricId: 'ide.active_coding_time_minutes',
      metricIds: ['ide.active_coding_time_minutes'],
    } as any)

    expect(result.dataSource).toBe('Real')
    expect(fetchMock).toHaveBeenCalled()

    const vscodeSeries = result.series.find((s: any) => s.label === 'vscode')
    const claudeSeries = result.series.find((s: any) => s.label === 'claude_code')

    expect(vscodeSeries).toBeDefined()
    expect(claudeSeries).toBeDefined()

    const vscodeTimestamps = vscodeSeries!.points.map((p: any) => p.t).sort()
    const claudeTimestamps = claudeSeries!.points.map((p: any) => p.t).sort()

    // 2026-35 maps to 2026-08-24; 2026-36 maps to 2026-08-31
    expect(vscodeTimestamps).toContain('2026-08-24T04:00:00.000Z')
    expect(vscodeTimestamps).toContain('2026-08-31T04:00:00.000Z')
    expect(claudeTimestamps).toContain('2026-08-24T04:00:00.000Z')
    expect(claudeTimestamps).toContain('2026-08-31T04:00:00.000Z')
  })
})
