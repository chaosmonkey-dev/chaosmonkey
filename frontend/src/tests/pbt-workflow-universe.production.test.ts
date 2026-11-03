import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFilterStore } from '../stores/filters'
import { fetchAndMapTelemetryToUnified, resetCanonicalTelemetryCache } from '../lib/adapters/telemetryToUnified'
import { deriveCanonicalWorkflowUniverse } from '../lib/productivity/deriveCanonicalWorkflowUniverse'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const pbtSource = readFileSync(join(__dirname, '../components/ProductivityByToolV3.vue'), 'utf-8')

const makeJsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

describe('PBT workflow universe and canonical request truth', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // Reset the module-level canonical telemetry cache between tests
    resetCanonicalTelemetryCache()
    // Test-environment fix: provide a base URL so fetchCanonicalTelemetry can
    // construct a valid URL in Node (no window or VITE_API_BASE_URL by default)
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8010')
    // Provide localStorage mock for authenticatedFetch (Node has no localStorage)
    if (typeof (globalThis as any).localStorage === 'undefined') {
      const store: Record<string, string> = {}
      ;(globalThis as any).localStorage = {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value },
        removeItem: (key: string) => { delete store[key] },
        clear: () => { for (const k of Object.keys(store)) delete store[k] },
      } as any
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('empty filter produces tools=all', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse({
        metadata: { tools_in_population: [], session_count_by_tool: {}, canonical_population_count: 0 },
        data: []
      })
    )
    globalThis.fetch = fetchMock

    const store = useFilterStore()
    await fetchAndMapTelemetryToUnified('week', '2026-01-01', '2026-01-07', store.activeToolIds('productivity'))

    const requested = fetchMock.mock.calls[0][0] as string
    const url = new URL(requested)
    expect(url.searchParams.get('tools')).toBe('all')
  })

  it('explicit selection remains explicit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse({
        metadata: { tools_in_population: ['vscode', 'claude_code'], session_count_by_tool: { vscode: 10, claude_code: 5 }, canonical_population_count: 15 },
        data: []
      })
    )
    globalThis.fetch = fetchMock

    await fetchAndMapTelemetryToUnified('week', '2026-01-01', '2026-01-07', ['vscode', 'claude_code'])

    const requested = fetchMock.mock.calls[0][0] as string
    const url = new URL(requested)
    expect(url.searchParams.get('tools')).toBe('vscode,claude_code')
  })

  it('no request contains the fixed six-provider list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse({
        metadata: { tools_in_population: [], session_count_by_tool: {}, canonical_population_count: 0 },
        data: []
      })
    )
    globalThis.fetch = fetchMock

    const store = useFilterStore()
    await fetchAndMapTelemetryToUnified('week', '2026-01-01', '2026-01-07', store.activeToolIds('productivity'))

    const requested = fetchMock.mock.calls[0][0] as string
    expect(requested).not.toContain('claude_code,cursor,devin,github_copilot,vscode,windsurf')
  })

  it('staging-shaped metadata yields exactly three workflow IDs', () => {
    const series = [{
      label: 'placeholder',
      metadata: {
        tools_in_population: ['devin', 'cursor', 'vscode'],
        session_count_by_tool: { devin: 215, cursor: 38, vscode: 32 }
      }
    }]
    expect(deriveCanonicalWorkflowUniverse(series).sort()).toEqual(['cursor', 'devin', 'vscode'])
  })

  it('windsurf is normalized to devin (no duplicate devin card)', () => {
    const series = [{
      label: 'placeholder',
      metadata: {
        tools_in_population: ['windsurf', 'devin', 'cursor'],
        session_count_by_tool: { windsurf: 840, devin: 131, cursor: 274 }
      }
    }]
    expect(deriveCanonicalWorkflowUniverse(series).sort()).toEqual(['cursor', 'devin'])
  })

  it('windsurf-only metadata yields devin as canonical ID', () => {
    const series = [{
      label: 'placeholder',
      metadata: {
        tools_in_population: ['windsurf'],
        session_count_by_tool: { windsurf: 840 }
      }
    }]
    expect(deriveCanonicalWorkflowUniverse(series)).toEqual(['devin'])
  })

  it('Ed-shaped metadata yields exactly two workflow IDs', () => {
    const series = [{
      label: 'placeholder',
      metadata: {
        tools_in_population: ['vscode', 'claude_code'],
        session_count_by_tool: { vscode: 210, claude_code: 93 }
      }
    }]
    expect(deriveCanonicalWorkflowUniverse(series).sort()).toEqual(['claude_code', 'vscode'])
  })

  it('one-workflow metadata yields exactly one workflow ID', () => {
    const series = [{
      label: 'placeholder',
      metadata: {
        tools_in_population: ['vscode'],
        session_count_by_tool: { vscode: 50 }
      }
    }]
    expect(deriveCanonicalWorkflowUniverse(series)).toEqual(['vscode'])
  })

  it('empty successful metadata yields zero workflow IDs', () => {
    const series = [{ label: 'placeholder', metadata: { tools_in_population: [], session_count_by_tool: {} } }]
    expect(deriveCanonicalWorkflowUniverse(series)).toEqual([])
  })

  it('test-browser and unknown are excluded', () => {
    const series = [{
      label: 'placeholder',
      metadata: {
        tools_in_population: ['vscode', 'test-browser', '', 'unknown'],
        session_count_by_tool: { vscode: 10, 'test-browser': 5, '': 3, unknown: 2 }
      }
    }]
    expect(deriveCanonicalWorkflowUniverse(series)).toEqual(['vscode'])
  })

  it('source does not reference canonicalActualToolIds', () => {
    expect(pbtSource).not.toContain('canonicalActualToolIds')
  })

  it('production validation delegates to deriveCanonicalWorkflowUniverse instead of a hardcoded list', () => {
    expect(pbtSource).toContain('deriveCanonicalWorkflowUniverse')
    expect(pbtSource).not.toMatch(/const canonicalWorkflows\s*=\s*\[[^\]]*'claude_code'[^\]]*\]/)
  })

  // ── PBT Header Loading State Reconciliation ──────────────────────────
  // CR-X R2: PBT header loading should reflect PBT-specific data readiness,
  // NOT the unrelated canonical PI hydration. A populated chart can coexist
  // with canonicalHydrating=true — that is not a PBT loading state.
  // Only show Loading… when PBT's own time series is loading AND no data yet.
  it('PBT header uses pbtHeaderLoading computed (not raw canonicalHydrating)', () => {
    expect(pbtSource).toContain('pbtHeaderLoading')
    expect(pbtSource).not.toMatch(/v-if="props\.canonicalHydrating">Loading/)
  })

  it('pbtHeaderLoading uses timeSeriesLoading and data presence (not canonicalHydrating)', () => {
    expect(pbtSource).toMatch(/pbtHeaderLoading.*computed.*=>/)
    expect(pbtSource).toMatch(/timeSeriesLoading/)
    // CR-X R2: The pbtHeaderLoading computed must NOT reference canonicalHydrating.
    // Extract just the computed block and check it.
    const match = pbtSource.match(/const pbtHeaderLoading = computed\([\s\S]*?\}\)/)
    expect(match).not.toBeNull()
    expect(match![0]).not.toContain('canonicalHydrating')
    expect(match![0]).toContain('timeSeriesLoading')
  })
})
