/**
 * CR-X FINAL — PI Runtime Authority Diagnostic
 *
 * Fetches REAL data from the Local API and runs the PI engine to determine
 * the authoritative rendered count. This is the "clean harness" that should
 * match the browser.
 *
 * This test is SKIPPED if the Local API is not running.
 */
import { describe, it, expect } from 'vitest'
import { generateFinalCanonicalInsights } from '../lib/insights/final'
import { resolveCanonicalGithubInput } from '../lib/insights/final/canonicalGithubResolver'
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess'
import type { CanonicalInsightInput } from '../lib/insights/final/types'

const BACKEND = 'http://localhost:8010'

async function getDevAuth(): Promise<{ token: string; user: any }> {
  const res = await fetch(`${BACKEND}/api/dev/verification-auth`)
  if (!res.ok) throw new Error(`auth ${res.status}`)
  return res.json()
}

async function fetchAllSessions(token: string): Promise<any[]> {
  const allSessions: any[] = []
  let page = 1
  const perPage = 1000
  const from = '2000-01-01'
  const to = `${new Date().toISOString().split('T')[0]}T23:59:59.999Z`

  while (page <= 25) {
    const url = `${BACKEND}/api/telemetry/canonical?from=${from}&to=${to}&format=sessions&per_page=${perPage}&page=${page}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) break
    const data = await res.json()
    const sessions = data.data || data.sessions || []
    if (sessions.length === 0) break
    allSessions.push(...sessions)
    const totalPages = data.metadata?.total_pages || 1
    if (page >= totalPages) break
    page++
  }

  return allSessions
}

async function fetchGithubSnapshot(token: string): Promise<any> {
  const url = `${BACKEND}/api/metrics?time_filter=all&use_all_data=1&nocache=1&github_nocache=1`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`metrics ${res.status}`)
  return res.json()
}

async function fetchCostConfigs(token: string): Promise<any[]> {
  try {
    const url = `${BACKEND}/api/org/spend/config`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return []
    const data = await res.json()
    const configs = (data.configs || []).map((c: any) => ({
      toolId: (c.tool_id || '').replace(/[\s_]+/g, '-').toLowerCase().trim(),
      seatCount: c.seat_count || 0,
      costPerSeatMonthly: parseFloat(c.cost_per_seat_monthly) || 0,
      monthlySpend: parseFloat(c.monthly_spend) || 0,
      isConfigured: true,
    })).filter((c: any) => c.monthlySpend > 0)
    return configs
  } catch {
    return []
  }
}

const apiAvailable = await getDevAuth().then(() => true).catch(() => false)

describe.skipIf(!apiAvailable)('CR-X PI Runtime Authority (Real Local API)', () => {
  it('produces authoritative PI count from real Local API data', async () => {
    const auth = await getDevAuth()
    const token = auth.token

    // Fetch all data sources in parallel
    const [allSessions, githubRaw, costConfigs] = await Promise.all([
      fetchAllSessions(token),
      fetchGithubSnapshot(token),
      fetchCostConfigs(token),
    ])

    console.log('=== RUNTIME AUTHORITY DIAGNOSTIC ===')
    console.log(`Session rows: ${allSessions.length}`)
    console.log(`GitHub snapshot keys: ${githubRaw ? Object.keys(githubRaw).length : 0}`)
    console.log(`GitHub provenance source: ${githubRaw?.github_provenance?.source}`)
    console.log(`GitHub historical_data_available: ${githubRaw?.github_provenance?.historical_data_available}`)
    console.log(`GitHub pr_count: ${githubRaw?.github_provenance?.pr_count}`)
    console.log(`Cost configs: ${costConfigs.length}`)
    if (costConfigs.length > 0) {
      console.log(`Cost config tools: ${costConfigs.map((c: any) => `${c.toolId}=$${c.monthlySpend}`).join(', ')}`)
    }

    // Resolve GitHub input through the canonical resolver (same as Dashboards.vue)
    const ghResolution = resolveCanonicalGithubInput(githubRaw, {
      granularity: 'week',
    })

    console.log(`\nGitHub resolution: freshEligible=${ghResolution.freshEligible}, reason=${ghResolution.reason}`)
    console.log(`GitHub by period count: ${ghResolution.githubByPeriod.length}`)

    // Enrich session rows with derived fields (same as fetchSharedEnrichedCanonical)
    addDerivedSessionFields(allSessions)

    // Build the canonical input exactly as Dashboards.vue does
    const canonicalInput: CanonicalInsightInput = {
      sessionRows: allSessions,
      githubSnapshot: ghResolution.githubSnapshot,
      githubByPeriod: ghResolution.githubByPeriod,
      productivityByPeriod: [],
      granularity: 'week',
      analysisContext: {
        timeRange: { from: '', to: '' },
        developerIds: [],
        repoIds: [],
        workflowIds: [],
        githubTimeFilter: 'all',
      },
      externalCostConfigs: costConfigs.length > 0 ? costConfigs : undefined,
    } as any

    // Run the PI engine
    const result = await generateFinalCanonicalInsights(canonicalInput)

    const findings = result.filter((i: any) => !i.isDiagnostic)
    const diagnostics = result.filter((i: any) => i.isDiagnostic)

    console.log(`\n=== AUTHORITATIVE PI COUNT ===`)
    console.log(`Total rendered: ${result.length}`)
    console.log(`Findings: ${findings.length}`)
    console.log(`Diagnostics: ${diagnostics.length}`)

    // Print all rendered IDs with classification
    console.log(`\n=== RENDERED IDs ===`)
    for (const insight of result as any[]) {
      const type = insight.isDiagnostic ? 'DIAG' : 'FIND'
      const stage = insight.cicdStage || insight.stage || '?'
      console.log(`  ${type} | ${stage} | ${insight.id} | ${(insight.title || '').substring(0, 60)}`)
    }

    // This test documents the authoritative count; it always passes.
    expect(result.length).toBeGreaterThan(0)
  }, 60000)
})
