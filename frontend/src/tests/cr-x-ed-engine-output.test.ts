/**
 * CR-X P0-1: ACTUAL Final Engine output against Ed population.
 *
 * This is NOT a simulator. It runs the real `generateFinalCanonicalInsights`
 * with the real Ed enriched canonical population.
 *
 * Data is fetched directly from Ed's API (bypassing the browser API layer),
 * then passed as input to the actual engine. All engine logic (generators,
 * portfolio consolidation, realism, validation, ranking, Top Insights) runs
 * unmodified.
 *
 * CR-X 3D.2C: This test requires an externally supplied Ed API credential.
 * It is NOT hermetic — it depends on a live Ed instance. The credential must
 * be provided via the ED_TEST_TOKEN environment variable. If not set, the
 * test suite is skipped (not failed) to avoid false negatives from stale
 * hardcoded credentials.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { generateFinalCanonicalInsights } from '../lib/insights/final/index'
import { addDerivedSessionFields } from '../lib/insights/final/dataAccess'
import { classifyLifecycleClass } from '../lib/insights/final/classifyLifecycleClass'
import { normalizeToCanonicalToolId } from '../lib/workflowIdentity'

const ED_BASE = 'https://prioritydispatch.chaosmonkey.dev/api'
const ED_TOKEN = process.env.ED_TEST_TOKEN || ''

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ED_TOKEN}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.json()
}

// Skip the entire suite when no external credential is provided.
// This prevents false failures from stale hardcoded tokens.
const describeOrSkip = ED_TOKEN ? describe : describe.skip

describeOrSkip('CR-X P0-1: ACTUAL Final Engine output against Ed', () => {
  let engineOutput: any[] = []
  let sessionRows: any[] = []
  let topInsights: any[] = []
  let enrichmentMatchCount = 0

  beforeAll(async () => {
    // 1. Fetch canonical membership from Ed
    let canonical: any[] = []
    let page = 1
    while (true) {
      const d = await fetchJSON(`${ED_BASE}/telemetry/canonical?from=2020-01-01&to=2026-08-30T23:59:59.999Z&format=sessions&per_page=200&page=${page}`)
      const rows = d.sessions || d.data || []
      canonical.push(...rows)
      if (rows.length < 200) break
      page++
      if (page > 15) break
    }
    // Dedupe by session_id
    const cmap = new Map<string, any>()
    for (const r of canonical) {
      if (r.session_id != null && !cmap.has(r.session_id)) cmap.set(r.session_id, r)
    }
    canonical = [...cmap.values()]

    // 2. Fetch enriched sessions from Ed
    let enriched: any[] = []
    page = 1
    while (true) {
      const d = await fetchJSON(`${ED_BASE}/telemetry/sessions?days=all&per_page=200&page=${page}`)
      const rows = d.sessions || d.data || []
      enriched.push(...rows)
      if (rows.length < 200) break
      page++
      if (page > 15) break
    }

    // 3. Join canonical with enriched (using the fixed dual-index join)
    const enrichedBySessionId = new Map<string, any>()
    const enrichedById = new Map<string, any>()
    for (const e of enriched) {
      if (e.session_id) enrichedBySessionId.set(e.session_id, e)
      if (e.id) enrichedById.set(e.id, e)
    }
    sessionRows = canonical.map(c => {
      const e = enrichedBySessionId.get(c.session_id) || enrichedById.get(c.session_id)
      if (e) {
        enrichmentMatchCount++
        return { ...c, ...e, ...c } // canonical wins for conflicts
      }
      return c
    })

    // 4. Add derived fields (same as dataAccess.ts does)
    addDerivedSessionFields(sessionRows)

    // 5. Run the ACTUAL Final Engine
    const input = {
      sessionRows,
      githubSnapshot: undefined,
      githubByPeriod: [],
      productivityByPeriod: [],
      granularity: 'week' as const,
    }
    engineOutput = await generateFinalCanonicalInsights(input)

    // 6. Extract Top Insights (stamped by engine)
    topInsights = engineOutput
      .filter(i => i.isTopInsightEligible === true)
      .sort((a, b) => (a.topInsightRank || 999) - (b.topInsightRank || 999))
  }, 180000) // 3 minute timeout

  it('PROVES Ed population: 2364 canonical, 2025 VS Code, 339 Claude, 2364/2364 enriched', () => {
    console.log(`\n=== POPULATION PROOF ===`)
    console.log(`Canonical membership: ${sessionRows.length}`)
    expect(sessionRows.length).toBe(2364)

    const wfCounts: Record<string, number> = {}
    for (const s of sessionRows) {
      const tool = normalizeToCanonicalToolId(s.tool || s.session_source || 'unknown')
      wfCounts[tool] = (wfCounts[tool] || 0) + 1
    }
    console.log(`Workflow counts: ${JSON.stringify(wfCounts)}`)
    expect(wfCounts['vscode']).toBe(2025)
    expect(wfCounts['claude_code']).toBe(339)

    console.log(`Enrichment matches: ${enrichmentMatchCount}/${sessionRows.length}`)
    expect(enrichmentMatchCount).toBe(2364)
  })

  it('DUMPS actual engine output: all findings with lifecycle class', () => {
    console.log('\n========== ACTUAL FINAL ENGINE OUTPUT (Ed) ==========')
    console.log(`Total adapted insights: ${engineOutput.length}`)

    const findings = engineOutput.filter(i => i.isDiagnostic !== true)
    const diagnostics = engineOutput.filter(i => i.isDiagnostic === true)
    console.log(`Findings (non-diagnostic): ${findings.length}`)
    console.log(`Diagnostics: ${diagnostics.length}`)

    console.log('\n--- ALL ADAPTED INSIGHTS (engine output order) ---')
    for (const i of engineOutput) {
      const lc = i.lifecycleClass || classifyLifecycleClass(i as any)
      const rank = i.topInsightRank ? ` [TOP#${i.topInsightRank}]` : ''
      const diag = i.isDiagnostic ? ' [DIAGNOSTIC]' : ''
      console.log(`  ${i.id}${rank}${diag} [${lc}] (${i.cicdStage}): ${i.title?.substring(0, 120)}`)
    }

    console.log('\n--- DIAGNOSTICS ---')
    for (const d of diagnostics) {
      console.log(`  ${d.id}: ${d.title} (reason: ${d.diagnosticReason})`)
    }

    console.log('\n--- TOP INSIGHTS (actual engine ranking) ---')
    for (const t of topInsights) {
      const lc = t.lifecycleClass || classifyLifecycleClass(t as any)
      console.log(`  #${t.topInsightRank}: ${t.id} [${lc}] — ${t.title?.substring(0, 140)}`)
    }

    console.log('========== END ENGINE OUTPUT ==========\n')
    expect(engineOutput.length).toBeGreaterThan(0)
  })

  it('DUMPS actual Top Insights with ranking components', () => {
    console.log('\n========== TOP INSIGHTS DETAIL ==========')
    for (const t of topInsights) {
      const lc = t.lifecycleClass || classifyLifecycleClass(t as any)
      console.log(`\n  #${t.topInsightRank}: ${t.id}`)
      console.log(`    Title: ${t.title}`)
      console.log(`    Stage: ${t.cicdStage}`)
      console.log(`    LifecycleClass: ${lc}`)
      console.log(`    Confidence: ${t.confidence}`)
      console.log(`    N: ${t.n}`)
      console.log(`    Current: ${t.current}`)
      console.log(`    DeltaPct: ${t.deltaPct}`)
      console.log(`    Urgency: ${t.urgencyLabel}`)
      console.log(`    RecommendationState: ${t.recommendationState}`)
      console.log(`    IsExecutiveFinding: ${t.isExecutiveFinding}`)
    }
    console.log('========== END TOP DETAIL ==========\n')
    expect(topInsights.length).toBeGreaterThan(0)
    expect(topInsights.length).toBeLessThanOrEqual(5)
  })
})
