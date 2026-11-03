import { describe, it, expect } from 'vitest'
import { ref, computed, watch, nextTick } from 'vue'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { expandCanonicalToolIds } from '../lib/workflowIdentity'

/**
 * Regression tests for the PBT Time Series "Compare workflows" selector
 * not scoping the visualization.
 *
 * Bug: watch(availableWorkflows) treated the transient empty state that
 * useTimeSeries creates on every query change (data=null while the scoped
 * request is in flight) as a stale selection, and reset selectedWorkflow
 * back to 'compare' in the same flush — so the selector always reverted
 * and only the compare-all request ever hit the network.
 *
 * Secondary issues fixed in the same patch:
 * - The <select> options were built from availableWorkflows (derived from
 *   the fetched series). A workflow-scoped response would collapse the
 *   dropdown to that workflow alone, breaking direct workflow→workflow
 *   switching. Options now come from workflowOptions, refreshed only from
 *   unfiltered (compare-mode) responses.
 * - productivityQuery now expands canonical workflow IDs to raw tool IDs
 *   (devin → [devin, windsurf]) because the canonical endpoint's `tools`
 *   filter matches raw source/editor_source; 'devin' alone would drop the
 *   856 legacy windsurf sessions that belong to the Devin workflow.
 *
 * This harness replicates the component's exact reactive wiring with real
 * Vue refs/watchers so the flush ordering is genuinely exercised. Source
 * assertions bind the replica to ProductivityByToolV3.vue.
 */

const PBT_VUE = readFileSync(
  fileURLToPath(new URL('../components/ProductivityByToolV3.vue', import.meta.url)),
  'utf-8'
)

// ── Mock canonical backend universe (raw tool IDs, mirrors Local data) ───
// The canonical endpoint emits raw tools; metricsFacade merges windsurf
// into the canonical 'devin' series (1264 = 408 devin + 856 windsurf).
const RAW_SERIES = [
  { label: 'devin', sessionCount: 408, points: [{ t: '2026-38', ai_suggestions_accepted: 10 }] },
  { label: 'windsurf', sessionCount: 856, points: [{ t: '2026-38', ai_suggestions_accepted: 12 }] },
  { label: 'claude_code', sessionCount: 647, points: [{ t: '2026-38', ai_suggestions_accepted: 5 }] },
  { label: 'vscode', sessionCount: 606, points: [{ t: '2026-38', ai_suggestions_accepted: 8 }] },
  { label: 'cursor', sessionCount: 329, points: [{ t: '2026-38', ai_suggestions_accepted: 4 }] },
  { label: 'github_copilot', sessionCount: 11, points: [{ t: '2026-38', ai_suggestions_accepted: 1 }] },
]

type Series = { label: string; sessionCount: number; points: any[] }

// metricsFacade buildSeriesFromTelemetryRecords equivalent: merge raw
// series into canonical workflow series (windsurf → devin).
function canonicalMerge(records: Series[]): Series[] {
  const map = new Map<string, Series>()
  for (const r of records) {
    const canonical = r.label === 'windsurf' ? 'devin' : r.label
    const existing = map.get(canonical)
    if (existing) {
      existing.sessionCount += r.sessionCount
      existing.points = [...existing.points, ...r.points]
    } else {
      map.set(canonical, { ...r, label: canonical, points: [...r.points] })
    }
  }
  return Array.from(map.values())
}

/**
 * Minimal replica of the ProductivityByToolV3 workflow-scope chain:
 *   selectedWorkflow → analysisContext.workflowIds → productivityQuery.toolIds
 *     (via real expandCanonicalToolIds) → useTimeSeries (clears data +
 *     isLoading, then resolves filtered data) → timeSeriesDataWithFallback
 *     → availableWorkflows → cleanup watcher → workflowOptions /
 *     effectiveWorkflowId / chart series
 *
 * `guardDuringLoad` toggles the fix: false = pre-fix behavior (reset on any
 * transient-empty availableWorkflows).
 */
function createHarness(opts: { guardDuringLoad: boolean }) {
  // Simulated backend: honors the `tools` filter like /api/telemetry/canonical
  // (raw tool IDs in, canonical-merged series out).
  const fetchLog: string[][] = []
  const fakeFetch = (toolIds: string[]): Promise<Series[]> =>
    new Promise(resolve => {
      fetchLog.push([...toolIds])
      setTimeout(() => {
        const raw = toolIds.length === 0
          ? RAW_SERIES
          : RAW_SERIES.filter(s => toolIds.includes(s.label))
        resolve(canonicalMerge(raw))
      }, 0)
    })

  const selectedWorkflow = ref<string>('compare')
  const workflowIds = ref<string[]>([]) // analysisContext.workflowIds
  const timeSeriesData = ref<Series[] | null>(null)
  const isLoading = ref(false)

  // productivityQuery computed (PBTV3 ~L2293): canonical workflowIds → raw toolIds
  const productivityQuery = computed(() => ({
    toolIds: workflowIds.value.length > 0
      ? expandCanonicalToolIds(workflowIds.value)
      : ([] as string[]),
  }))

  // watch(selectedWorkflow) → analysisContext.setWorkflowIds (PBTV3 ~L2148)
  watch(selectedWorkflow, (v) => {
    workflowIds.value = v && v !== 'compare' ? [v] : []
  })

  // useTimeSeries query watcher (useTimeSeries.ts ~L342): on change, clear
  // data + set loading, then fetch with the new toolIds.
  watch(productivityQuery, async (n, o) => {
    if (JSON.stringify(n) === JSON.stringify(o)) return
    timeSeriesData.value = null
    isLoading.value = true
    timeSeriesData.value = await fakeFetch(n.toolIds)
    isLoading.value = false
  }, { deep: true })

  const timeSeriesDataWithFallback = computed(() => ({
    data: timeSeriesData.value && timeSeriesData.value.length > 0 ? timeSeriesData.value : [],
  }))

  const availableWorkflows = computed(() => {
    const seen = new Set<string>()
    const out: Array<{ id: string; label: string; sessions: number }> = []
    for (const s of timeSeriesDataWithFallback.value.data) {
      if (!s?.label || seen.has(s.label)) continue
      seen.add(s.label)
      out.push({ id: s.label, label: s.label, sessions: s.sessionCount || 0 })
    }
    out.sort((a, b) => b.sessions - a.sessions)
    return out
  })

  // FIX: option universe refreshed only from unfiltered responses
  const workflowOptions = ref<Array<{ id: string; label: string; sessions: number }>>([])

  // watch(availableWorkflows) cleanup watcher (PBTV3 ~L2955)
  watch(availableWorkflows, (workflows) => {
    if (selectedWorkflow.value === 'compare' && workflows.length > 0) {
      workflowOptions.value = workflows
    }
    const sw = selectedWorkflow.value
    if (sw === '' || sw === null || sw === undefined) {
      selectedWorkflow.value = 'compare'
      return
    }
    if (opts.guardDuringLoad && isLoading.value) return
    if (sw !== 'compare' && !workflows.some(w => w.id === sw)) {
      selectedWorkflow.value = 'compare'
    }
  })

  const isCompareMode = computed(() => selectedWorkflow.value === 'compare')
  const effectiveWorkflowId = computed(() => {
    if (isCompareMode.value) return ''
    const pick = selectedWorkflow.value
    return availableWorkflows.value.some(w => w.id === pick) ? pick : ''
  })

  // decisionSeriesLineGraphData equivalent: compare = all series in data,
  // single = only the effective workflow's series.
  const chartSeriesLabels = computed(() => {
    const data = timeSeriesDataWithFallback.value.data
    if (isCompareMode.value) return data.map(s => s.label)
    const id = effectiveWorkflowId.value
    return id && data.some(s => s.label === id) ? [id] : []
  })

  const totalSessions = computed(() =>
    timeSeriesDataWithFallback.value.data.reduce((sum, s) => sum + (s.sessionCount || 0), 0))

  const flush = async () => {
    await nextTick()
    await new Promise(r => setTimeout(r, 5)) // let the debounced fetch resolve
    await nextTick()
  }

  return {
    selectedWorkflow, workflowIds, timeSeriesData, isLoading,
    availableWorkflows, workflowOptions, isCompareMode, effectiveWorkflowId,
    chartSeriesLabels, totalSessions, fetchLog, flush,
  }
}

async function seed(h: ReturnType<typeof createHarness>) {
  // Initial mount: unfiltered compare-all fetch resolves
  h.timeSeriesData.value = canonicalMerge(RAW_SERIES)
  await h.flush()
}

// ── Source binding: the replica must match the real component ────────────

describe('PBT workflow scope — source contract', () => {
  it('selector options bind to workflowOptions (stable universe), not scoped data', () => {
    expect(PBT_VUE).toContain('v-for="w in workflowOptions"')
  })

  it('availableWorkflows watcher guards the stale-selection reset during fetches', () => {
    const idx = PBT_VUE.indexOf('watch(availableWorkflows')
    expect(idx).toBeGreaterThan(-1)
    const body = PBT_VUE.slice(idx, idx + 1800)
    // The loading guard must appear before the reset assignment in the watcher.
    const guardIdx = body.indexOf('timeSeriesLoading')
    const resetIdx = body.indexOf("selectedWorkflow.value = 'compare'", body.indexOf('workflowOptions.value.some'))
    expect(guardIdx).toBeGreaterThan(-1)
    expect(resetIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(resetIdx)
  })

  it('productivityQuery expands canonical workflow IDs to raw tool IDs', () => {
    expect(PBT_VUE).toContain('expandCanonicalToolIds(analysisContext.workflowIds)')
  })
})

// ── Canonical → raw expansion helper ─────────────────────────────────────

describe('PBT selected workflow option population', () => {
  it('uses scoped canonical population for the selected option without collapsing the stable universe', async () => {
    const selectedWorkflow = ref('devin')
    const isCompareMode = computed(() => selectedWorkflow.value === 'compare')
    const canonicalMetadata = ref<Record<string, any> | null>({ canonical_population_count: 1267 })
    const workflowOptions = ref([
      { id: 'devin', label: 'Devin workflow', sessions: 1266 },
      { id: 'claude_code', label: 'Claude Code', sessions: 647 },
      { id: 'vscode', label: 'VS Code', sessions: 606 },
    ])

    const workflowOptionSessionCount = (workflow: { id: string; sessions: number }) => {
      if (!isCompareMode.value && workflow.id === selectedWorkflow.value) {
        const scoped = canonicalMetadata.value?.canonical_population_count
        if (scoped !== null && scoped !== undefined && scoped !== '') {
          const sessions = Number(scoped)
          if (Number.isFinite(sessions)) return sessions
        }
      }
      return workflow.sessions
    }

    expect(workflowOptionSessionCount(workflowOptions.value[0])).toBe(1267)
    expect(workflowOptionSessionCount(workflowOptions.value[1])).toBe(647)
    expect(workflowOptions.value.map(w => w.id)).toEqual(['devin', 'claude_code', 'vscode'])

    canonicalMetadata.value = { canonical_population_count: 1268 }
    await nextTick()
    expect(workflowOptionSessionCount(workflowOptions.value[0])).toBe(1268)
  })

  it('binds the real selector to the scoped count helper', () => {
    expect(PBT_VUE).toContain('workflowOptionSessionCount(w).toLocaleString()')
    const helperStart = PBT_VUE.indexOf('function workflowOptionSessionCount')
    const helperEnd = PBT_VUE.indexOf('const hasZeroDeveloperAttribution', helperStart)
    const helperBlock = PBT_VUE.slice(helperStart, helperEnd)
    expect(helperBlock).toContain('workflow.id === selectedWorkflow.value')
    expect(helperBlock).toContain('canonicalMetadata.value?.canonical_population_count')
  })
})

describe('expandCanonicalToolIds', () => {
  it('devin expands to include legacy windsurf telemetry', () => {
    expect(expandCanonicalToolIds(['devin'])).toEqual(['devin', 'windsurf'])
  })

  it('unaliased workflows pass through unchanged', () => {
    expect(expandCanonicalToolIds(['claude_code'])).toEqual(['claude_code'])
    expect(expandCanonicalToolIds(['vscode', 'cursor'])).toEqual(['vscode', 'cursor'])
  })

  it('raw alias input collapses to the same canonical set', () => {
    expect(expandCanonicalToolIds(['windsurf'])).toEqual(['devin', 'windsurf'])
  })

  it('empty input returns empty', () => {
    expect(expandCanonicalToolIds([])).toEqual([])
  })
})

// ── Behavioral replica tests ─────────────────────────────────────────────

describe('PBT workflow scope — compare → single → single → compare', () => {
  it('selection survives the refetch it triggers; data and chart scope to the workflow', async () => {
    const h = createHarness({ guardDuringLoad: true })
    await seed(h)

    // A. Compare workflows baseline
    expect(h.selectedWorkflow.value).toBe('compare')
    expect(h.chartSeriesLabels.value).toHaveLength(5)
    expect(h.totalSessions.value).toBe(2857)
    expect(h.workflowOptions.value.map(w => w.id)).toEqual(
      ['devin', 'claude_code', 'vscode', 'cursor', 'github_copilot'])

    // B. Select Claude Code
    h.selectedWorkflow.value = 'claude_code'
    await h.flush()

    expect(h.selectedWorkflow.value).toBe('claude_code') // not reverted
    expect(h.fetchLog.at(-1)).toEqual(['claude_code']) // scoped request fired
    expect(h.availableWorkflows.value.map(w => w.id)).toEqual(['claude_code'])
    expect(h.chartSeriesLabels.value).toEqual(['claude_code']) // 1 series
    expect(h.totalSessions.value).toBe(647) // scoped population
    // Option universe stays complete — Devin is still selectable
    expect(h.workflowOptions.value.map(w => w.id)).toContain('devin')

    // C. Switch directly to Devin (no return to compare required)
    h.selectedWorkflow.value = 'devin'
    await h.flush()

    expect(h.selectedWorkflow.value).toBe('devin')
    expect(h.fetchLog.at(-1)).toEqual(['devin', 'windsurf']) // canonical expansion
    expect(h.chartSeriesLabels.value).toEqual(['devin']) // one merged series
    expect(h.totalSessions.value).toBe(1264) // devin + windsurf

    // D. Return to Compare workflows
    h.selectedWorkflow.value = 'compare'
    await h.flush()

    expect(h.selectedWorkflow.value).toBe('compare')
    expect(h.fetchLog.at(-1)).toEqual([])
    expect(h.chartSeriesLabels.value).toHaveLength(5)
    expect(h.totalSessions.value).toBe(2857)
  })

  it('still resets a genuinely stale selection after the fetch resolves empty', async () => {
    const h = createHarness({ guardDuringLoad: true })
    await seed(h)

    // Workflow that resolves to zero sessions (e.g. repo/dev filter excluded it)
    h.selectedWorkflow.value = 'ghost_workflow'
    await h.flush()

    expect(h.fetchLog).toContainEqual(['ghost_workflow']) // scoped fetch ran
    expect(h.selectedWorkflow.value).toBe('compare') // stale selection cleaned up
  })

  it('pre-fix behavior demonstrates the regression this guard prevents', async () => {
    const h = createHarness({ guardDuringLoad: false })
    await seed(h)

    h.selectedWorkflow.value = 'claude_code'
    await h.flush()

    // Without the guard: the transient empty availableWorkflows reverts the
    // selection to compare — the exact reported bug.
    expect(h.selectedWorkflow.value).toBe('compare')
    expect(h.fetchLog.at(-1)).toEqual([]) // only compare-all request ran
    expect(h.chartSeriesLabels.value).toHaveLength(5)
  })

  it('workflow selection persists across other-filter refetches', async () => {
    const h = createHarness({ guardDuringLoad: true })
    await seed(h)

    h.selectedWorkflow.value = 'claude_code'
    await h.flush()
    expect(h.selectedWorkflow.value).toBe('claude_code')

    // Simulate a developer/repo filter refetch while a workflow is selected:
    // data is cleared and re-resolved scoped; the selection must persist.
    h.timeSeriesData.value = null
    h.isLoading.value = true
    await nextTick()
    h.timeSeriesData.value = canonicalMerge(RAW_SERIES.filter(s => s.label === 'claude_code'))
    h.isLoading.value = false
    await h.flush()

    expect(h.selectedWorkflow.value).toBe('claude_code')
    expect(h.chartSeriesLabels.value).toEqual(['claude_code'])
    expect(h.totalSessions.value).toBe(647)
  })
})
