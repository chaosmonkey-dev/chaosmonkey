import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fetchAndMapTelemetryToUnified, resetCanonicalTelemetryCache } from '../lib/adapters/telemetryToUnified'
import { generateMetricCards, isMetricInstrumentedForTool } from '../lib/productivityCards'
import { isMetricInstrumentedForWorkflow } from '../lib/surfaceAgentContract'
import { resolveTimeSeriesPointField } from '../lib/productivity/resolveTimeSeriesPointField'

const pbtSource = readFileSync(fileURLToPath(new URL('../components/ProductivityByToolV3.vue', import.meta.url)), 'utf-8')
const graphSource = readFileSync(fileURLToPath(new URL('../components/ProductivityLineGraph.vue', import.meta.url)), 'utf-8')

const response = () => new Response(JSON.stringify({
  metadata: {
    canonical_population_count: 3,
    tools_in_population: ['claude_code'],
    session_count_by_tool: { claude_code: 3 },
    group_by: 'developer',
    groups_in_population: [90002],
    session_count_by_group: { 90002: 2 },
    developer_attributed_sessions: 2,
    developer_unattributed_sessions: 1,
  },
  data: [{
    period: '2026-35', tool: 'claude_code', developer: 90002, session_count: 2,
    average_session_length_minutes: 10, ai_suggestions_accepted: 4,
  }],
}), { status: 200, headers: { 'content-type': 'application/json' } })

describe('PBT workflow developer drilldown', () => {
  beforeEach(() => {
    resetCanonicalTelemetryCache()
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8010')
    ;(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} }
  })

  afterEach(() => vi.restoreAllMocks())

  it('sends group_by=developer and maps the explicit developer key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response())
    globalThis.fetch = fetchMock

    const result = await fetchAndMapTelemetryToUnified(
      'week', '2026-01-01', '2026-12-31', ['claude_code'], [], [], undefined, undefined, 'TEST', 'developer'
    )

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.searchParams.get('group_by')).toBe('developer')
    expect(url.searchParams.get('tools')).toBe('claude_code')
    expect(result.records[0].developer).toBe('90002')
    expect(result.metadata?.developer_attributed_sessions).toBe(2)
    expect(result.metadata?.groups_in_population).toEqual(['90002'])
    expect(result.metadata?.session_count_by_group).toEqual({ '90002': 2 })
  })

  it('keeps workflow and developer grouping in separate cache identities', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response())
    globalThis.fetch = fetchMock

    await fetchAndMapTelemetryToUnified('week', '2026-01-01', '2026-12-31', ['claude_code'])
    await fetchAndMapTelemetryToUnified('week', '2026-01-01', '2026-12-31', ['claude_code'], [], [], undefined, undefined, 'TEST', 'developer')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('requests developer grouping only for a selected Time Series workflow', () => {
    expect(pbtSource).toContain("groupBy: selectedView.value === 'timeseries' && selectedWorkflow.value !== 'compare'")
    expect(pbtSource).toContain("? 'developer'")
    expect(pbtSource).toContain('expandCanonicalToolIds(analysisContext.workflowIds)')
  })

  it('uses curated roster labels and filters unknown developer keys', () => {
    expect(pbtSource).toContain("developerLabelById.value.has(String(series.label ?? ''))")
    expect(pbtSource).toContain("developerLabelById.value.get(String(series.label ?? ''))")
    expect(pbtSource).toContain('authoritativeDeveloperSeries.value.forEach')
  })

  it('shows truthful coverage and the zero-attribution state', () => {
    expect(pbtSource).toContain('developer_attributed_sessions')
    expect(pbtSource).toContain('developer-attributed')
    expect(pbtSource).toContain('No developer-attributed time series available for this workflow.')
  })

  it('hides workflow scope in Cards and clears shared workflow IDs', () => {
    expect(pbtSource).toContain("v-if=\"selectedView === 'timeseries' && !isDeliveryMetric\"")
    expect(pbtSource).toContain("newView === 'cards' && (selectedWorkflow.value !== 'compare' || analysisContext.workflowIds.length > 0)")
    expect(pbtSource).toContain("selectedWorkflow.value = 'compare'")
    expect(pbtSource).toContain('analysisContext.setWorkflowIds([])')
  })

  it('passes an explicit developer/workflow series dimension to the graph', () => {
    expect(pbtSource).toContain(':seriesDimension="seriesDimension"')
    expect(graphSource).toContain("props.seriesDimension === 'developer'")
    expect(graphSource).toContain('Developer Performance Over Time')
  })

  it('keeps freshness tracing dimension-safe and non-fatal', () => {
    expect(pbtSource).toContain("seriesDimension.value !== 'workflow'")
    expect(pbtSource).toContain("String(s?.label ?? '').toLowerCase()")
    expect(pbtSource).toContain('publishFreshnessTrace()')
    expect(pbtSource).toContain("error: 'freshness_trace_unavailable'")
  })

  it('uses resolver-based grouped coverage and selected-workflow header semantics', () => {
    expect(pbtSource).toContain("metadata.group_by === 'developer'")
    expect(pbtSource).toContain('developerCoverage.attributed')
    expect(pbtSource).toContain('developerCoverage.isDeveloperGrouped')
    expect(pbtSource).toContain('<span>unattributed</span>')
    expect(pbtSource).toContain('{{ selectedWorkflowLabel }} · {{ totalSessions.toLocaleString() }} sessions · {{ developerAttributedSessions.toLocaleString() }} developer-attributed')
  })

  it('keeps metric-only developer switching local and reactive', () => {
    const queryStart = pbtSource.indexOf('const productivityQuery = computed')
    const queryEnd = pbtSource.indexOf('const { data: timeSeriesData', queryStart)
    const queryBlock = pbtSource.slice(queryStart, queryEnd)
    expect(queryBlock).toContain('metricIds: allProductivityMetrics')
    expect(queryBlock).not.toMatch(/^\s*metricId\s*:/m)

    const decisionStart = pbtSource.indexOf('const decisionSeriesLineGraphData = computed')
    const decisionEnd = pbtSource.indexOf('// Transform time series data to chart format', decisionStart)
    const decisionBlock = pbtSource.slice(decisionStart, decisionEnd)
    expect(decisionBlock).toContain('resolveTimeSeriesPointField(selectedMetric.value)')
    expect(decisionBlock).toContain('authoritativeDeveloperSeries.value.forEach')
    expect(decisionBlock).toContain('const raw = p?.[pointField]')
  })

  it('keeps selected workflow identity independent from metric capability', () => {
    const capabilityStart = pbtSource.indexOf('function workflowInstrumentedForMetric')
    const capabilityEnd = pbtSource.indexOf('// Whether the Time Series is in Compare mode', capabilityStart)
    const capabilityBlock = pbtSource.slice(capabilityStart, capabilityEnd)
    expect(capabilityBlock).toContain('isMetricInstrumentedForWorkflow(workflowId, metricKey)')
    expect(capabilityBlock).toContain('isMetricInstrumentedForTool(workflowId, metricKey)')

    const identityStart = pbtSource.indexOf('const effectiveWorkflowId = computed')
    const identityEnd = pbtSource.indexOf('// Workflows eligible for the current metric', identityStart)
    const identityBlock = pbtSource.slice(identityStart, identityEnd)
    expect(identityBlock).not.toContain('workflowInstrumentedForMetric')
    expect(identityBlock).toContain('workflows.some(w => w.id === userPick)')

    const gateStart = pbtSource.indexOf('const metricNotInstrumentedForWorkflow = computed')
    const gateEnd = pbtSource.indexOf('// Weekly points for the effective workflow', gateStart)
    const gateBlock = pbtSource.slice(gateStart, gateEnd)
    expect(gateBlock).toContain('workflowInstrumentedForMetric(id, selectedMetric.value)')
    expect(pbtSource).toContain('v-if="!metricNotInstrumentedForWorkflow"')
  })

  it('keeps Cards and single-workflow Time Series capability decisions in parity', () => {
    const pilotWorkflows = ['claude_code', 'devin', 'vscode', 'cursor', 'github_copilot']
    const pilotMetrics = [
      'active_coding_time_minutes',
      'active_coding_ratio',
      'ai_usage_duration_minutes',
      'ai_usage_ratio',
      'average_session_length_minutes',
      'idle_time_minutes',
      'idle_ratio',
      'time_to_first_commit_minutes',
      'files_edited_per_session',
      'commits_per_session',
      'ai_suggestions_accepted',
    ]

    for (const workflow of pilotWorkflows) {
      for (const metric of pilotMetrics) {
        const pointField = resolveTimeSeriesPointField(metric)
        const cards = generateMetricCards({
          dataSource: [{
            label: workflow,
            sessionCount: 1,
            points: [{ t: '2026-38', ...(pointField ? { [pointField]: 1 } : {}) }],
          }],
          activeMetricId: `ide.${metric}`,
          comparisonMode: 'workflows',
          selectedMetric: metric,
          getCanonicalEntityLabel: (label: string) => label,
          getCanonicalWorkflowIdentity: (label: string) => label,
        })

        const cardsGate = cards[0]?.availability !== 'not_instrumented'
        const timeSeriesGate = isMetricInstrumentedForWorkflow(workflow, metric)
          && isMetricInstrumentedForTool(workflow, metric)
        expect(cardsGate, `${workflow}/${metric}`).toBe(timeSeriesGate)
      }
    }
  })
})
